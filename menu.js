// menu.js: ボトムシートメニュー・右下サイドMENUボタン・親指下部チャット・製作者プロフィール安全キック・参加者履歴管理
// ★ もともと成功していた走者方式への完全統一版（外部Webサイト誤遷移の完全根絶）：
//   1. 【Web URL遷移（外部サイト化）の完全撤廃】
//      window.top.location.href や window.open による外部ブラウザ／Web版GRAVITYへの遷移を全廃。
//   2. 【もともと走者で成功していた非表示 iframe キックへ完全一本化】
//      走者タップ時も製作者ボタンも、全く同一の cleanId（数字ID）を渡し、
//      非表示 iframe から slme://internal?type=5&ani=1&url=usercenter... を安全にキック。
//      ゲーム画面を一切壊さず、アプリ内ネイティブのマイページを直接オーバーレイ起動します。
//   3. 【分割後アーキテクチャ（menu_styles.js 連携）の完全維持】
//      スタイルシートは menu_styles.js へ外注し、可読性と保守性を維持。
//   4. 【走者重複根絶 ＆ ルーム招待被り96px余白の完全維持】

import { injectMenuStyles } from './menu_styles.js';

// 製作者アカウント定数定義（数字IDベース）
export const CREATOR_ACCOUNTS = {
  main: {
    id: '2736445531',
    title: '👤 製作者の本アカウントを見る ↗',
    subtitle: 'メインの活動・交流・フォローはこちら'
  },
  sub: {
    id: '887811163',
    title: '🛠️ 開発・ご要望用アカウントを見る ↗',
    subtitle: 'ゲームの要望やコメントはこちらへどうぞ'
  }
};

/**
 * GRAVITYアプリ内ネイティブ画面遷移ルーター
 * ★ 走者・製作者共通：もともと走者で成功していた非表示 iframe キック方式に完全統一
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
      // 1. もともと走者で動作していたネイティブ連携パラメータを構築
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

      // 2. 非表示 iframe による安全キック（外部サイトへの遷移を物理遮断し、ネイティブ画面をオーバーレイ起動）
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;border:none;display:none;';
      iframe.src = deepLink;
      document.body.appendChild(iframe);

      // 3. クリーンアップ（1秒後に安全にDOMから除去）
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1000);
    } catch (err) {
      console.warn('[GravityRouter] Navigation failed gracefully:', err);
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

    // 走者タップ時：数字の userId を渡してネイティブプロフィールを起動
    row.addEventListener('click', () => {
      GravityRouter.openProfile(p.userId);
    });

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

      <!-- 3. 製作者タブ（もともと走者で成功していた非表示iframeネイティブ起動） -->
      <div id="menu-tab-creator" class="menu-tab-content">
        <div class="creator-section-container">
          <div class="creator-message-card">
            <div class="creator-message-line">遊んでくれてありがとうございます！</div>
            <div class="creator-message-line highlight">楽しかったら右上の［…］から いいね を押してね</div>
            <div class="creator-message-line">ご意見やご要望もお気軽にどうぞ！</div>
          </div>

          <!-- 本アカウント直結ボタン -->
          <div class="creator-action-btn-card card-main" id="btn-jump-creator-main">
            <span class="creator-btn-title">${CREATOR_ACCOUNTS.main.title}</span>
            <span class="creator-btn-subtitle">${CREATOR_ACCOUNTS.main.subtitle}</span>
          </div>

          <!-- 開発・要望用サブ垢直結ボタン -->
          <div class="creator-action-btn-card card-sub" id="btn-jump-creator-sub">
            <span class="creator-btn-title">${CREATOR_ACCOUNTS.sub.title}</span>
            <span class="creator-btn-subtitle">${CREATOR_ACCOUNTS.sub.subtitle}</span>
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

    // ★【走者の処理に完全統一】Web URLやwindow.topは触らず、もともと走者で成功していた非表示iframeキックを実行
    document.getElementById('btn-jump-creator-main')?.addEventListener('click', (e) => {
      e.stopPropagation();
      GravityRouter.openProfile(CREATOR_ACCOUNTS.main.id);
    });
    document.getElementById('btn-jump-creator-sub')?.addEventListener('click', (e) => {
      e.stopPropagation();
      GravityRouter.openProfile(CREATOR_ACCOUNTS.sub.id);
    });
  }
}

// 自動初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGameMenuDOM);
} else {
  initGameMenuDOM();
}