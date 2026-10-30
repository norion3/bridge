// menu.js: ボトムシートメニュー・右下サイドMENUボタン・親指下部チャット・走者プロフィール安全起動・製作者本番プロフィール導線（内部UID完全対応版）
// ★ 内部UID確定・本番完成版：
//   1. 【公式AI回答に基づく「真の内部 user_id」を恒久設定】
//      ・上段「製作者プロフィール」: norion様の本物内部UID「1540889251」
//      ・下段「ゲーム開発・告知」  : のりおん様の本物内部UID「1542253108」
//   2. 【走者一覧と100%同一の<div>構造・イベント処理（e.stopPropagation() のみ）】
//   3. 【初期表示（デフォルト）で親アプリの「ルーム招待 ⇧」ボタンと干渉ゼロ（被りなし）】
//   4. 【製作者以外の全機能（走者一覧・チャット・UIスタイル等）の完全温存】

import { injectMenuStyles } from './menu_styles.js';

// ★ 製作者アカウントの真の内部 user_id 定数
const CREATOR_MAIN_INTERNAL_UID = '1540889251'; // norion (メイン窓口)
const CREATOR_SUB_INTERNAL_UID  = '1542253108'; // のりおん (ゲーム開発・告知)

/**
 * GRAVITYアプリ内ネイティブ画面遷移ルーター
 * ★ 走者・製作者共通：実績ある非表示 iframe キック方式（slme://internal...）
 */
export const GravityRouter = {
  openProfile(userId) {
    if (!userId) return;
    const target = String(userId).trim();
    if (!target || target === 'local_user' || target === 'null') return;

    // 数字のユーザーIDのみを抽出
    const cleanId = target.replace(/[^0-9]/g, '');
    if (!cleanId) return;

    try {
      const paramObj = {
        uid: Number(cleanId) || cleanId,
        selectedIndex: 0,
        web_url: 'https://www.gravity.place/user/' + cleanId,
        s: 'web',
        b: 'user'
      };
      const encodedJson = encodeURIComponent(JSON.stringify(paramObj));
      const innerUrl = 'usercenter?0=' + encodedJson;
      const deepLink = 'slme://internal?type=5&ani=1&url=' + encodeURIComponent(innerUrl);

      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;border:none;display:none;';
      iframe.src = deepLink;
      document.body.appendChild(iframe);

      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1000);
    } catch (err) {
      console.warn('[GravityRouter] Navigation failed:', err);
    }
  }
};

if (typeof window !== 'undefined') {
  window.GravityRouter = GravityRouter;
}

// 参加者履歴キャッシュ（セッション中に参加した全ユーザー）
const sessionParticipants = new Map();

// チャット送信時コールバック
let onSendChatCallback = null;

export function setChatSendCallback(fn) {
  onSendChatCallback = fn;
}

/**
 * 参加者履歴の登録・更新
 * ★ 仮キー（host_slot_0等）と本ID（実ID）の自動マージにより走者重複（norion増殖）を根絶
 */
export function recordParticipant(userId, name, portrait, teamId, isActive = true) {
  if (!userId || userId === 'local_user') return;
  const key = String(userId);
  const cleanName = name || 'プレイヤー';

  // 本ID（数字や固有ID）が届いた際、古い先行仮キー（host_slot_0 / guest_slot_*）を自動消去して統合
  if (key !== 'host_slot_0' && !key.startsWith('guest_slot_')) {
    for (const [existingKey, p] of sessionParticipants.entries()) {
      if ((existingKey === 'host_slot_0' || existingKey.startsWith('guest_slot_')) && p.name === cleanName) {
        sessionParticipants.delete(existingKey);
      }
    }
  }

  const existing = sessionParticipants.get(key) || {};
  sessionParticipants.set(key, {
    userId: key,
    name: cleanName,
    portrait: portrait || existing.portrait || '',
    teamId: teamId || existing.teamId || 'neutral',
    isActive: Boolean(isActive),
    lastSeen: Date.now()
  });
  renderParticipantsList();
}

/**
 * 参加者の退室状態更新
 */
export function markParticipantInactive(userId) {
  if (!userId) return;
  const key = String(userId);
  if (sessionParticipants.has(key)) {
    sessionParticipants.get(key).isActive = false;
    renderParticipantsList();
  }
}

/**
 * 参加者一覧リストの再描画
 */
function renderParticipantsList() {
  const container = document.getElementById('menu-participants-list');
  if (!container) return;

  const countBadge = document.getElementById('menu-tab-participants-count');
  if (countBadge) {
    countBadge.textContent = `(${sessionParticipants.size})`;
  }

  if (sessionParticipants.size === 0) {
    container.innerHTML = `
      <div style="font-size: 12px; color: #bae6fd; text-align: center; padding: 24px 0;">
        参加者履歴はありません
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  sessionParticipants.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'participant-row';
    const statusText = p.isActive ? '● プレイ中' : '退室済み';
    const statusClass = p.isActive ? 'participant-status status-active' : 'participant-status';
    const avatarSrc = p.portrait || '';

    const avatarHtml = avatarSrc
      ? `<img class="participant-avatar" src="${avatarSrc}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><div class="participant-avatar" style="display:none;background:#0284c7;"></div>`
      : `<div class="participant-avatar" style="background:#0284c7;"></div>`;

    row.innerHTML = `
      <div class="participant-left">
        ${avatarHtml}
        <div class="participant-info">
          <span class="participant-name">${escapeHtml(p.name)}</span>
          <span class="${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="participant-jump-icon">↗</div>
    `;

    // 走者タップ時：実績ある openProfile をキック
    const onRowClick = (e) => {
      e.stopPropagation();
      GravityRouter.openProfile(p.userId);
    };
    row.addEventListener('click', onRowClick);
    row.addEventListener('touchend', onRowClick);

    container.appendChild(row);
  });
}

/**
 * タブ切り替え処理
 */
function switchTab(tabId) {
  const allBtns = document.querySelectorAll('.menu-tab-btn');
  const allContents = document.querySelectorAll('.menu-tab-content');
  const likeGuide = document.getElementById('like-guide-anchor');

  allBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  allContents.forEach(content => {
    content.classList.toggle('active', content.id === `menu-tab-${tabId}`);
  });

  if (tabId === 'creator') {
    if (likeGuide) likeGuide.classList.add('show');
  } else {
    if (likeGuide) likeGuide.classList.remove('show');
  }

  if (tabId === 'participants') {
    renderParticipantsList();
  }
}

/**
 * ボトムシートメニューの開閉制御
 */
export const GameMenu = {
  isOpen: false,

  open() {
    this.isOpen = true;
    const backdrop = document.getElementById('game-menu-backdrop');
    const sheet = document.getElementById('game-menu-sheet');
    if (backdrop) backdrop.classList.add('open');
    if (sheet) sheet.classList.add('open');
  },

  close() {
    this.isOpen = false;
    const backdrop = document.getElementById('game-menu-backdrop');
    const sheet = document.getElementById('game-menu-sheet');
    const likeGuide = document.getElementById('like-guide-anchor');
    if (backdrop) backdrop.classList.remove('open');
    if (sheet) sheet.classList.remove('open');
    if (likeGuide) likeGuide.classList.remove('show');
  },

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
};

/**
 * チャット送信処理（最大15文字）
 */
function handleSendMessage(customText = null) {
  const inputEl = document.getElementById('menu-chat-input');
  const textToSend = customText || (inputEl ? inputEl.value : '');
  const rawText = String(textToSend).trim();
  if (!rawText) return;

  const safeText = rawText.slice(0, 15);
  if (inputEl) inputEl.value = '';

  if (typeof onSendChatCallback === 'function') {
    onSendChatCallback(safeText);
  }

  GameMenu.close();
}

/**
 * XSS防止サニタイズ
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * DOM構造の生成・マウント
 */
export function initGameMenuDOM() {
  injectMenuStyles();

  // 1. 右下サイド MENUボタン
  if (!document.getElementById('btn-open-game-menu')) {
    const menuBtn = document.createElement('button');
    menuBtn.id = 'btn-open-game-menu';
    menuBtn.type = 'button';
    menuBtn.innerHTML = `
      <span class="menu-icon-mini">💬</span>
      <span class="menu-text-mini">MENU</span>
    `;
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      GameMenu.toggle();
    });
    document.body.appendChild(menuBtn);
  }

  // 2. 右上「いいね誘導」アンカー
  if (!document.getElementById('like-guide-anchor')) {
    const likeAnchor = document.createElement('div');
    likeAnchor.id = 'like-guide-anchor';
    likeAnchor.innerHTML = `
      <div class="like-guide-arrow"></div>
      <div class="like-guide-bubble">
        メニューから<br>「❤️いいね」してね！
      </div>
    `;
    document.body.appendChild(likeAnchor);
  }

  // 3. ボトムシート背景オーバーレイ
  if (!document.getElementById('game-menu-backdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'game-menu-backdrop';
    backdrop.addEventListener('click', () => GameMenu.close());
    document.body.appendChild(backdrop);
  }

  // 4. ボトムシート メインパネル
  if (!document.getElementById('game-menu-sheet')) {
    const sheet = document.createElement('div');
    sheet.id = 'game-menu-sheet';
    sheet.innerHTML = `
      <div class="menu-sheet-grabber"></div>
      <div class="menu-sheet-header">
        <span class="menu-sheet-title">GAME MENU</span>
        <button type="button" class="menu-sheet-close" id="btn-close-game-menu">✕</button>
      </div>

      <!-- タブ切り替えボタン -->
      <div class="menu-tab-bar">
        <button type="button" class="menu-tab-btn active" data-tab="chat">💬 CHAT</button>
        <button type="button" class="menu-tab-btn" data-tab="participants">👥 走者 <span id="menu-tab-participants-count">(0)</span></button>
        <button type="button" class="menu-tab-btn" data-tab="creator">✦ 製作者</button>
      </div>

      <!-- 1. チャットタブ -->
      <div id="menu-tab-chat" class="menu-tab-content active">
        <div class="chat-tab-container">
          <div class="chat-top-section">
            <span class="chat-section-label">タップで即送信</span>
            <div class="quick-chat-grid">
              <button type="button" class="chat-chip" data-msg="よろしく！">よろしく！</button>
              <button type="button" class="chat-chip" data-msg="ナイス！">ナイス！</button>
              <button type="button" class="chat-chip" data-msg="ありがとう！">ありがとう！</button>
              <button type="button" class="chat-chip" data-msg="ごめんね！">ごめんね！</button>
              <button type="button" class="chat-chip" data-msg="まってー！">まってー！</button>
              <button type="button" class="chat-chip" data-msg="おつかれさま！">おつかれさま！</button>
              <button type="button" class="chat-chip" data-msg="ドンマイ！">ドンマイ！</button>
              <button type="button" class="chat-chip" data-msg="もう1回！">もう1回！</button>
            </div>
          </div>
          <div class="chat-input-bottom-bar">
            <input type="text" id="menu-chat-input" class="chat-input-field" maxlength="15" placeholder="メッセージを入力...">
            <button type="button" id="btn-send-chat" class="chat-send-btn">送信</button>
          </div>
        </div>
      </div>

      <!-- 2. 参加者一覧タブ -->
      <div id="menu-tab-participants" class="menu-tab-content">
        <div id="menu-participants-list" class="participants-container"></div>
      </div>

      <!-- 3. 製作者タブ（現行メッセージカード完全維持 ＋ 走者一覧完全互換div導線） -->
      <div id="menu-tab-creator" class="menu-tab-content">
        <div class="creator-section-container">
          <!-- 現行メッセージカード（文章・スタイル・クラス完全維持） -->
          <div class="creator-message-card">
            <div class="creator-message-line">遊んでくれてありがとうございます！</div>
            <div class="creator-message-line highlight">楽しかったら右上の［…］から いいね を押してね</div>
            <div class="creator-message-line">ご意見やご要望もお気軽にどうぞ！</div>
          </div>

          <!-- 追加：走者一覧と完全同一の div 構造による2行導線（合計高さ約88px・招待ボタン干渉ゼロ） -->
          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; margin-top: 12px;">
            <!-- 上段：製作者プロフィール (内部UID: 1540889251) -->
            <div id="btn-creator-main" class="participant-row" style="background: linear-gradient(135deg, rgba(2, 132, 199, 0.45) 0%, rgba(3, 105, 161, 0.45) 100%); border: 1px solid rgba(56, 189, 248, 0.4); margin-bottom: 0; cursor: pointer;">
              <div class="participant-left">
                <div class="participant-avatar" style="background: #0284c7; display: flex; align-items: center; justify-content: center; font-size: 14px;">👤</div>
                <div class="participant-info">
                  <span class="participant-name" style="font-size: 13px; font-weight: 800; color: #ffffff;">製作者プロフィール</span>
                </div>
              </div>
              <div class="participant-jump-icon">↗</div>
            </div>

            <!-- 下段：ゲーム開発・告知 (内部UID: 1542253108) -->
            <div id="btn-creator-sub" class="participant-row" style="background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.18); margin-bottom: 0; cursor: pointer;">
              <div class="participant-left">
                <div class="participant-avatar" style="background: #475569; display: flex; align-items: center; justify-content: center; font-size: 14px;">📢</div>
                <div class="participant-info">
                  <span class="participant-name" style="font-size: 13px; font-weight: 800; color: #bae6fd;">ゲーム開発・告知</span>
                </div>
              </div>
              <div class="participant-jump-icon">↗</div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(sheet);

    // イベントバインド
    document.getElementById('btn-close-game-menu')?.addEventListener('click', () => GameMenu.close());
    
    // タブ切り替え
    const tabBtns = sheet.querySelectorAll('.menu-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // チャット送信
    const sendBtn = document.getElementById('btn-send-chat');
    const inputEl = document.getElementById('menu-chat-input');
    sendBtn?.addEventListener('click', () => handleSendMessage());
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSendMessage();
      }
    });

    // 定型文チップ
    const chips = sheet.querySelectorAll('.chat-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const msg = chip.dataset.msg;
        if (msg) handleSendMessage(msg);
      });
    });

    // ★ 上段：製作者プロフィール導線 (内部UID: 1540889251)
    const btnCreatorMain = document.getElementById('btn-creator-main');
    if (btnCreatorMain && !btnCreatorMain._hasListener) {
      btnCreatorMain._hasListener = true;
      let lastTapMain = 0;
      const onMainClick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastTapMain < 800) return;
        lastTapMain = now;

        GravityRouter.openProfile(CREATOR_MAIN_INTERNAL_UID);
      };
      btnCreatorMain.addEventListener('click', onMainClick);
      btnCreatorMain.addEventListener('touchend', onMainClick);
    }

    // ★ 下段：ゲーム開発・告知導線 (内部UID: 1542253108)
    const btnCreatorSub = document.getElementById('btn-creator-sub');
    if (btnCreatorSub && !btnCreatorSub._hasListener) {
      btnCreatorSub._hasListener = true;
      let lastTapSub = 0;
      const onSubClick = (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        const now = Date.now();
        if (now - lastTapSub < 800) return;
        lastTapSub = now;

        GravityRouter.openProfile(CREATOR_SUB_INTERNAL_UID);
      };
      btnCreatorSub.addEventListener('click', onSubClick);
      btnCreatorSub.addEventListener('touchend', onSubClick);
    }
  }
}

// 自動初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGameMenuDOM);
} else {
  initGameMenuDOM();
}