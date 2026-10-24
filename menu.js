// menu.js: ボトムシートメニュー・右下サイドMENUボタン・親指下部チャット・製作者プロフィール直結ボタン・ネオンいいね誘導
// ★ UI/UX全面刷新 ＆ 崩れリスク物理ゼロ版：
//   1. 【MENUボタンの英語化 ＆ 右下親指サイド配置】
//      画面中央下部から撤退し、スワイプ操作エリアを全面開放。
//      右下「サウンド（🔊）」ボタンの真上にスリムな半角英字「MENU」ボタンを配置し誤爆をゼロ化。
//   2. 【いいね誘導のネオンシアン配色維持 ＆ 被り・本文矢印解消】
//      上部ネイティブヘッダーとの重なりを解消し、本文内の「↗」を削除。上向きパルス矢印（▲）のみで直感誘導。
//   3. 【製作者タブ：ボタン特化型スリムUI（崩れリスク物理ゼロ）】
//      外部API取得や画像読み込みを全廃し、本アカウント（2736445531）と開発サブ垢（887811163）へ
//      ワンタップで確実にジャンプする2大専用ボタンへ刷新。
//   4. 【ハート絵文字の適正化 ＆ メッセージ1行完結】
//      タブや装飾のハートを全廃（✦ 製作者）。ハート（❤️）は「いいね」の文脈でのみ上品に使用。
//   5. 【チャットタブ：親指下部配置 ＆ 定型文8種への拡充 ＆ 説明文削除】
//      不要な説明文を全廃。ボトムシート最下部に入力欄と送信ボタンを配置し、タップ即送信のクイックチップを拡充。

/**
 * GRAVITYアプリ内ネイティブ画面遷移ルーター
 */
export const GravityRouter = {
  _sendToApp(command, paramObj) {
    try {
      const encodedJson = encodeURIComponent(JSON.stringify(paramObj));
      const innerUrl = command + '?0=' + encodedJson;
      const deepLink = 'slme://internal?type=5&ani=1&url=' + encodeURIComponent(innerUrl);

      try {
        if (window.top && window.top.location) {
          window.top.location.href = deepLink;
        } else {
          window.location.href = deepLink;
        }
      } catch (e) {
        const ifr = document.createElement('iframe');
        ifr.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;border:none;';
        ifr.src = deepLink;
        document.body.appendChild(ifr);
        setTimeout(() => {
          try { ifr.remove(); } catch (err) {}
        }, 5000);
      }
    } catch (err) {
      console.warn('[GravityRouter] Navigation failed:', err);
    }
  },

  openProfile(userId) {
    if (!userId) return;
    const cleanId = String(userId).trim();
    if (!cleanId || cleanId === 'local_user' || cleanId === 'null') return;

    const paramObj = {
      uid: Number(cleanId) || cleanId,
      selectedIndex: 0,
      web_url: 'https://www.gravity.place/user/' + cleanId,
      s: 'web',
      b: 'user'
    };
    this._sendToApp('usercenter', paramObj);
  }
};

if (typeof window !== 'undefined') {
  window.GravityRouter = GravityRouter;
}

// 製作者アカウント定数
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

// 参加者履歴キャッシュ（セッション中に参加した全ユーザー）
const sessionParticipants = new Map();

// チャット送信時コールバック
let onSendChatCallback = null;

export function setChatSendCallback(fn) {
  onSendChatCallback = fn;
}

/**
 * 参加者履歴の登録・更新
 */
export function recordParticipant(userId, name, portrait, teamId, isActive = true) {
  if (!userId || userId === 'local_user') return;
  const key = String(userId);
  sessionParticipants.set(key, {
    userId: key,
    name: name || 'プレイヤー',
    portrait: portrait || '',
    teamId: teamId || 'neutral',
    isActive: isActive,
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
 * メニュースタイルの動的注入
 */
function injectMenuStyles() {
  if (document.getElementById('gravity-game-menu-styles')) return;

  const style = document.createElement('style');
  style.id = 'gravity-game-menu-styles';
  style.textContent = `
    /* ★ 右下サイド MENUボタン（親指誤爆ゼロ・英語カプセル） */
    #btn-open-game-menu {
      position: fixed;
      right: 16px;
      bottom: max(68px, env(safe-area-inset-bottom, 16px) + 52px);
      z-index: 45;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: linear-gradient(135deg, rgba(14, 165, 233, 0.92) 0%, rgba(2, 132, 199, 0.98) 100%);
      color: #ffffff;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: 0.04em;
      border: 1.5px solid rgba(255, 255, 255, 0.45);
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.45), 0 0 10px rgba(56, 189, 248, 0.35);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      cursor: pointer;
      transition: transform 0.12s ease, filter 0.12s ease;
      touch-action: manipulation;
    }
    #btn-open-game-menu:active {
      transform: scale(0.92);
      filter: brightness(0.9);
    }
    #btn-open-game-menu .menu-icon-mini {
      font-size: 13px;
      line-height: 1;
    }
    #btn-open-game-menu .menu-text-mini {
      font-size: 9px;
      font-weight: 900;
      letter-spacing: 0.02em;
      line-height: 1;
    }

    /* ボトムシート オーバーレイ（背景暗転） */
    #game-menu-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.60);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 80;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
    }
    #game-menu-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    /* ボトムシート メインパネル */
    #game-menu-sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      max-width: 460px;
      margin: 0 auto;
      height: 70vh;
      max-height: 520px;
      background: radial-gradient(circle at 50% 0%, rgba(14, 165, 233, 0.96) 0%, rgba(15, 23, 42, 0.98) 100%);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-bottom: none;
      border-radius: 22px 22px 0 0;
      box-shadow: 0 -10px 35px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.4);
      z-index: 85;
      transform: translateY(105%);
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Kaku Gothic ProN", sans-serif;
    }
    #game-menu-sheet.open {
      transform: translateY(0%);
    }

    /* パネル上部グラブバー＆ヘッダー */
    .menu-sheet-grabber {
      width: 36px;
      height: 4px;
      background: rgba(255, 255, 255, 0.35);
      border-radius: 2px;
      margin: 8px auto 2px auto;
      flex-shrink: 0;
    }
    .menu-sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 16px 8px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      flex-shrink: 0;
    }
    .menu-sheet-title {
      font-size: 15px;
      font-weight: 900;
      letter-spacing: 0.05em;
      color: #ffffff;
      text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    .menu-sheet-close {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      cursor: pointer;
    }

    /* タブ切り替えバー */
    .menu-tab-bar {
      display: flex;
      background: rgba(0, 0, 0, 0.25);
      padding: 4px;
      margin: 8px 14px;
      border-radius: 12px;
      gap: 4px;
      flex-shrink: 0;
    }
    .menu-tab-btn {
      flex: 1;
      padding: 7px 4px;
      font-size: 12.5px;
      font-weight: 800;
      color: #bae6fd;
      background: transparent;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: center;
    }
    .menu-tab-btn.active {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      color: #ffffff;
      box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);
    }

    /* タブコンテンツ表示領域 */
    .menu-tab-content {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding: 8px 16px;
      padding-bottom: max(16px, env(safe-area-inset-bottom, 12px));
      display: none;
    }
    .menu-tab-content.active {
      display: flex;
      flex-direction: column;
    }

    /* ★ 1. チャットタブ UI（親指下部配置 ＆ 定型文拡充） */
    .chat-tab-container {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 100%;
      gap: 10px;
    }
    .chat-top-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .chat-section-label {
      font-size: 11px;
      font-weight: 800;
      color: #7dd3fc;
      letter-spacing: 0.03em;
    }
    .quick-chat-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }
    .chat-chip {
      background: rgba(255, 255, 255, 0.10);
      border: 1px solid rgba(255, 255, 255, 0.20);
      color: #e0f2fe;
      padding: 10px 8px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      text-align: center;
      transition: background 0.12s ease, transform 0.1s ease;
    }
    .chat-chip:active {
      background: rgba(56, 189, 248, 0.35);
      transform: scale(0.97);
    }

    /* 親指で最も押しやすい最下部入力バー */
    .chat-input-bottom-bar {
      margin-top: auto;
      display: flex;
      gap: 8px;
      padding-top: 6px;
    }
    .chat-input-field {
      flex: 1;
      height: 42px;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(56, 189, 248, 0.5);
      border-radius: 12px;
      padding: 0 12px;
      color: #ffffff;
      font-size: 13.5px;
      font-weight: 700;
      outline: none;
    }
    .chat-input-field:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }
    .chat-send-btn {
      width: 68px;
      height: 42px;
      background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%);
      color: #ffffff;
      font-size: 13px;
      font-weight: 900;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(2, 132, 199, 0.4);
      flex-shrink: 0;
    }
    .chat-send-btn:active {
      transform: scale(0.95);
    }

    /* ★ 2. 製作者タブ UI（ボタン特化型スリムUI・崩れリスク物理ゼロ） */
    .creator-section-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 4px;
    }
    .creator-message-card {
      background: rgba(15, 23, 42, 0.60);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 14px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .creator-message-line {
      font-size: 12.5px;
      line-height: 1.45;
      color: #e0f2fe;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .creator-message-line.highlight {
      color: #fde047;
      font-weight: 800;
    }

    /* 本垢・サブ垢の2大アクションボタン */
    .creator-action-btn-card {
      width: 100%;
      border-radius: 14px;
      padding: 12px 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
      transition: transform 0.12s ease, filter 0.12s ease;
      touch-action: manipulation;
      text-align: left;
    }
    .creator-action-btn-card:active {
      transform: scale(0.98);
      filter: brightness(0.92);
    }
    .creator-action-btn-card.card-main {
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.85) 0%, rgba(3, 105, 161, 0.95) 100%);
      border: 1.5px solid #38bdf8;
      box-shadow: 0 4px 16px rgba(2, 132, 199, 0.4), 0 0 10px rgba(56, 189, 248, 0.25);
    }
    .creator-action-btn-card.card-sub {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.85) 0%, rgba(5, 150, 105, 0.95) 100%);
      border: 1.5px solid #34d399;
      box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35), 0 0 10px rgba(52, 211, 153, 0.25);
    }
    .creator-btn-title {
      font-size: 14px;
      font-weight: 900;
      color: #ffffff;
      letter-spacing: 0.02em;
    }
    .creator-btn-subtitle {
      font-size: 11.5px;
      color: #e0f2fe;
      font-weight: 600;
    }

    /* 3. 参加者一覧タブ UI */
    .participants-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 300px;
      overflow-y: auto;
      padding-right: 4px;
    }
    .participant-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(255, 255, 255, 0.10);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 12px;
      padding: 8px 12px;
      gap: 10px;
      cursor: pointer;
      transition: background 0.12s ease;
    }
    .participant-row:active {
      background: rgba(255, 255, 255, 0.20);
    }
    .participant-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .participant-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #0284c7;
      border: 2px solid rgba(255, 255, 255, 0.5);
      object-fit: cover;
      flex-shrink: 0;
    }
    .participant-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .participant-name {
      font-size: 13px;
      font-weight: 800;
      color: #ffffff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .participant-status {
      font-size: 11px;
      color: #94a3b8;
    }
    .status-active {
      color: #34d399 !important;
      font-weight: 700;
    }
    .participant-jump-icon {
      font-size: 15px;
      color: #38bdf8;
      flex-shrink: 0;
    }

    /* ★ 右上「いいね誘導」ネオンシアン配色維持 ＆ 被り・本文矢印解消 */
    #like-guide-anchor {
      position: fixed;
      top: max(56px, env(safe-area-inset-top, 24px) + 42px);
      right: 14px;
      z-index: 95;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-6px);
      transition: opacity 0.22s ease, transform 0.22s ease;
    }
    #like-guide-anchor.show {
      opacity: 1;
      transform: translateY(0);
    }
    .like-guide-arrow {
      width: 0;
      height: 0;
      border-left: 7px solid transparent;
      border-right: 7px solid transparent;
      border-bottom: 9px solid #38bdf8;
      margin-right: 18px;
      animation: likeArrowPulse 0.8s ease-in-out infinite alternate;
    }
    .like-guide-bubble {
      background: linear-gradient(135deg, rgba(2, 132, 199, 0.95) 0%, rgba(3, 105, 161, 0.98) 100%);
      border: 1.5px solid #38bdf8;
      border-radius: 14px;
      padding: 8px 14px;
      color: #ffffff;
      font-size: 12px;
      font-weight: 800;
      box-shadow: 0 4px 18px rgba(2, 132, 199, 0.5), 0 0 10px rgba(56, 189, 248, 0.4);
      text-align: right;
      line-height: 1.4;
    }
    @keyframes likeArrowPulse {
      0% { transform: translateY(0); }
      100% { transform: translateY(-4px); }
    }
  `;
  document.head.appendChild(style);
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

    // アバター描画：画像があればimg、なければフォールバック青丸
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

  // 製作者タブ選択時：右上のいいね誘導を表示
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

  // 送信後、視界確保のためメニューを閉じる
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

  // 1. 右下サイド MENUボタン（スワイプ誤爆ゼロ・英語カプセル）
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

  // 2. 右上「いいね誘導」アンカー（ネオンシアン・矢印重複排除）
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

      <!-- 1. チャットタブ（親指下部配置 ＆ 定型文8種 ＆ 説明文削除） -->
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

      <!-- 3. 製作者タブ（ボタン特化型スリムUI・崩れリスク物理ゼロ） -->
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

    // 定型文チップ（タップ即送信）
    const chips = sheet.querySelectorAll('.chat-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const msg = chip.dataset.msg;
        if (msg) handleSendMessage(msg);
      });
    });

    // 製作者プロフィール直結ボタン
    document.getElementById('btn-jump-creator-main')?.addEventListener('click', () => {
      GravityRouter.openProfile(CREATOR_ACCOUNTS.main.id);
    });
    document.getElementById('btn-jump-creator-sub')?.addEventListener('click', () => {
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