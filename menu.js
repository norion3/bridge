// menu.js: ボトムシートメニュー・右下サイドMENUボタン・親指下部チャット・走者＆製作者完全一本化プロフィール起動・参加者履歴管理
// ★ メモ帳URL連携 ＆ 走者実績コード完全一本化版：
//   1. 【なぜメモ帳からは開けてゲームから開けなかったのかの完全解決】
//      メモ帳はOSがUniversal Linkとしてアプリを直接起動できるが、WebView内JavaScriptからの
//      URL遷移はAppleのWebKit仕様によりブロックされ、Webページロードとして自爆していた。
//   2. 【走者タブで100%成功している実績あるスキームへ製作者も完全一本化】
//      走者一覧で norion を開いた実績のある内部ルーティング（slme://internal?type=5&ani=1&url=usercenter...）を
//      製作者ボタン（本垢: 2736445531 / 開発垢: 887811163）でも全く同一に非表示 iframe からキック。
//   3. 【メモ帳公式短縮URLとのハイブリッドバインド】
//      メモ帳で動作確認済みの公式URL（api.gravity.place/gravity/url/...）をフォールバックに配備。
//   4. 【スマホ実機のタップ抜け防止（touchend + click）】
//      スクロール時の誤キャンセルを防ぎ、指が触れた瞬間に確実にネイティブ画面をオーバーレイ起動。
//   5. 【走者重複根絶 ＆ ルーム招待被り96px余白の完全維持】

import { injectMenuStyles } from './menu_styles.js';

// 製作者アカウント定数定義（数字ID ＆ メモ帳で確認済みの公式Universal Link）
export const CREATOR_ACCOUNTS = {
  main: {
    id: '2736445531',
    url: 'https://api.gravity.place/gravity/url/yH2Wc',
    title: '👤 製作者の本アカウントを見る ↗',
    subtitle: 'メインの活動・交流・フォローはこちら'
  },
  sub: {
    id: '887811163',
    url: 'https://api.gravity.place/gravity/url/IH2Wc',
    title: '🛠️ 開発・ご要望用アカウントを見る ↗',
    subtitle: 'ゲームの要望やコメントはこちらへどうぞ'
  }
};

/**
 * GRAVITYアプリ内ネイティブ画面遷移ルーター
 * ★ 走者・製作者完全共通：走者タブで100%実績のある非表示 iframe キック方式
 */
export const GravityRouter = {
  openProfile(userId, fallbackUrl = null) {
    if (!userId) return;
    const target = String(userId).trim();
    if (!target || target === 'local_user' || target === 'null') return;

    // 数字のユーザーIDのみを抽出
    const cleanId = target.replace(/[^0-9]/g, '');
    if (!cleanId) return;

    try {
      // 1. 走者タブで100%実績のあるネイティブ連携パラメータを構築
      const paramObj = {
        uid: Number(cleanId) || cleanId,
        selectedIndex: 0,
        web_url: fallbackUrl || ('https://www.gravity.place/user/' + cleanId),
        s: 'web',
        b: 'user'
      };
      const encodedJson = encodeURIComponent(JSON.stringify(paramObj));
      const innerUrl = 'usercenter?0=' + encodedJson;
      const deepLink = 'slme://internal?type=5&ani=1&url=' + encodeURIComponent(innerUrl);

      // 2. 非表示 iframe による安全キック（WebView自体のページ遷移を物理遮断）
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

      <!-- 3. 製作者タブ（メモ帳URL連携 ＆ 走者実績スキーム完全一本化） -->
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

    // ★【完全一本化】走者と全く同一の openProfile をキック（touchend + click の両方で確実に補足）
    const jumpMain = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      GravityRouter.openProfile(CREATOR_ACCOUNTS.main.id, CREATOR_ACCOUNTS.main.url);
    };
    const btnMain = document.getElementById('btn-jump-creator-main');
    btnMain?.addEventListener('click', jumpMain);
    btnMain?.addEventListener('touchend', jumpMain);

    const jumpSub = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      GravityRouter.openProfile(CREATOR_ACCOUNTS.sub.id, CREATOR_ACCOUNTS.sub.url);
    };
    const btnSub = document.getElementById('btn-jump-creator-sub');
    btnSub?.addEventListener('click', jumpSub);
    btnSub?.addEventListener('touchend', jumpSub);
  }
}

// 自動初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGameMenuDOM);
} else {
  initGameMenuDOM();
}