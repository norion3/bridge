// menu.js: ボトムシートメニュー・チャット入力・製作者カード・いいね誘導・参加者一覧・GRAVITYプロフィールジャンプ
// ★ 新規作成モジュール：
//   1. 【画面下部中央の台形メニューボタン】
//      リスタートと音量ボタンの中間に配置。タップ時に小気味よく沈み込み、下からボトムシートをスライドアップ。
//   2. 【ぬるっとスライドアップするボトムシートモーダル】
//      イージング（cubic-bezier(0.16, 1, 0.3, 1)）とすりガラス（backdrop-filter）による滑らかな開閉。
//   3. 【チャット入力欄（最大15文字制限）】
//      スマホキーボードに配慮した軽量入力欄。送信時にコールバックを発火。
//   4. 【製作者の声 ＆ 右上「いいね誘導」パルスアロー演出】
//      製作者タブ展開時、画面右上（GRAVITY標準「...」ボタン直下）へ小さなネオンシアン矢印・吹き出しを点滅浮遊表示。
//   5. 【参加者一覧（現在＆過去）スクロールリスト】
//      ルームに参加した全プレイヤーの履歴をスクロール表示。
//   6. 【GRAVITYネイティブプロフィール遷移（GravityRouter）内蔵】
//      slme://internal スキーム（usercenter）により、ユーザーアイコン・名前タップで該当ユーザーのマイページへ遷移。

/**
 * GRAVITYアプリ内ネイティブ画面遷移ルーター
 * 実績のある slme://internal ディープリンクハックを安全に呼び出し
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
        // iframe / WebView 内で location 変更がブロックされた場合のフォールバック
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
    /* 下部中央 台形メニューボタン */
    #btn-open-game-menu {
      position: fixed;
      bottom: max(16px, env(safe-area-inset-bottom, 16px));
      left: 50%;
      transform: translateX(-50%);
      z-index: 25;
      height: 42px;
      padding: 0 24px;
      background: linear-gradient(180deg, rgba(14, 165, 233, 0.90) 0%, rgba(2, 132, 199, 0.95) 100%);
      color: #ffffff;
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.05em;
      border: 1px solid rgba(255, 255, 255, 0.4);
      border-bottom: none;
      clip-path: polygon(8% 0%, 92% 0%, 100% 100%, 0% 100%);
      box-shadow: 0 -4px 18px rgba(2, 132, 199, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      transition: transform 0.12s ease, filter 0.12s ease;
      touch-action: manipulation;
    }
    #btn-open-game-menu:active {
      transform: translateX(-50%) scale(0.94);
      filter: brightness(0.9);
    }

    /* ボトムシート オーバーレイ（背景暗転） */
    #game-menu-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 80;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.28s ease;
    }
    #game-menu-backdrop.open {
      opacity: 1;
      pointer-events: auto;
    }

    /* ボトムシート メインパネル（ぬるっとスライドアップ） */
    #game-menu-sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      max-width: 480px;
      margin: 0 auto;
      height: 68vh;
      max-height: 520px;
      background: radial-gradient(circle at 50% 0%, rgba(14, 165, 233, 0.96) 0%, rgba(15, 23, 42, 0.98) 100%);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-bottom: none;
      border-radius: 24px 24px 0 0;
      box-shadow: 0 -10px 35px rgba(0, 0, 0, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.4);
      z-index: 85;
      transform: translateY(105%);
      transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #game-menu-sheet.open {
      transform: translateY(0%);
    }

    /* パネル上部グラブバー＆ヘッダー */
    .menu-sheet-grabber {
      width: 40px;
      height: 5px;
      background: rgba(255, 255, 255, 0.35);
      border-radius: 3px;
      margin: 10px auto 4px auto;
      flex-shrink: 0;
    }
    .menu-sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 18px 10px 18px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      flex-shrink: 0;
    }
    .menu-sheet-title {
      font-size: 16px;
      font-weight: 900;
      letter-spacing: 0.04em;
      color: #ffffff;
      text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }
    .menu-sheet-close {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      cursor: pointer;
    }

    /* タブ切り替えバー */
    .menu-tab-bar {
      display: flex;
      background: rgba(0, 0, 0, 0.25);
      padding: 4px;
      margin: 10px 16px;
      border-radius: 12px;
      gap: 4px;
      flex-shrink: 0;
    }
    .menu-tab-btn {
      flex: 1;
      padding: 8px 4px;
      font-size: 13px;
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
      padding: 8px 18px 24px 18px;
      display: none;
    }
    .menu-tab-content.active {
      display: flex;
      flex-direction: column;
    }

    /* 1. チャットタブ UI */
    .chat-tab-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      height: 100%;
    }
    .chat-desc {
      font-size: 12px;
      color: #bae6fd;
      line-height: 1.5;
      background: rgba(255, 255, 255, 0.08);
      padding: 10px 12px;
      border-radius: 10px;
    }
    .chat-input-row {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }
    .chat-input-field {
      flex: 1;
      height: 44px;
      background: rgba(15, 23, 42, 0.65);
      border: 1px solid rgba(56, 189, 248, 0.5);
      border-radius: 12px;
      padding: 0 14px;
      color: #ffffff;
      font-size: 14px;
      font-weight: 700;
      outline: none;
    }
    .chat-input-field:focus {
      border-color: #38bdf8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }
    .chat-send-btn {
      width: 72px;
      height: 44px;
      background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%);
      color: #ffffff;
      font-size: 13px;
      font-weight: 900;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.4);
    }
    .chat-send-btn:active {
      transform: scale(0.95);
    }

    /* 定型文チップ */
    .quick-chat-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .chat-chip {
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #e0f2fe;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .chat-chip:active {
      background: rgba(56, 189, 248, 0.3);
    }

    /* 2. 製作者の声タブ UI */
    .creator-card {
      background: rgba(255, 255, 255, 0.10);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 12px;
    }
    .creator-avatar-wrap {
      position: relative;
      cursor: pointer;
    }
    .creator-avatar {
      width: 68px;
      height: 68px;
      border-radius: 50%;
      border: 3px solid #38bdf8;
      box-shadow: 0 0 16px rgba(56, 189, 248, 0.5);
      object-fit: cover;
      background: #0284c7;
    }
    .creator-profile-badge {
      position: absolute;
      bottom: -4px;
      right: -4px;
      background: #10b981;
      color: #fff;
      font-size: 10px;
      font-weight: 900;
      padding: 2px 6px;
      border-radius: 10px;
      border: 1px solid #ffffff;
    }
    .creator-name {
      font-size: 16px;
      font-weight: 900;
      color: #ffffff;
    }
    .creator-message {
      font-size: 13px;
      color: #e0f2fe;
      line-height: 1.6;
      background: rgba(0, 0, 0, 0.25);
      padding: 12px;
      border-radius: 12px;
      border-left: 3px solid #38bdf8;
      text-align: left;
      width: 100%;
    }
    .creator-jump-btn {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff;
      font-size: 13px;
      font-weight: 800;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }

    /* 3. 参加者一覧タブ UI */
    .participants-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 280px;
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
      font-size: 16px;
      color: #38bdf8;
      flex-shrink: 0;
    }

    /* ★ 右上「いいね誘導」ネオンアロー＆吹き出し演出 */
    #like-guide-anchor {
      position: fixed;
      top: max(48px, env(safe-area-inset-top, 24px) + 38px);
      right: 14px;
      z-index: 95;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-8px);
      transition: opacity 0.25s ease, transform 0.25s ease;
    }
    #like-guide-anchor.show {
      opacity: 1;
      transform: translateY(0);
    }
    .like-guide-arrow {
      width: 0;
      height: 0;
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-bottom: 10px solid #38bdf8;
      margin-right: 18px;
      animation: likeArrowPulse 0.9s ease-in-out infinite alternate;
    }
    .like-guide-bubble {
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      border: 2px solid #38bdf8;
      border-radius: 14px;
      padding: 8px 12px;
      color: #ffffff;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.02em;
      box-shadow: 0 4px 18px rgba(56, 189, 248, 0.6);
      text-align: right;
      line-height: 1.35;
      animation: likeBubbleGlow 1.4s ease-in-out infinite alternate;
    }
    @keyframes likeArrowPulse {
      0% { transform: translateY(0); }
      100% { transform: translateY(-5px); }
    }
    @keyframes likeBubbleGlow {
      0% { box-shadow: 0 0 10px rgba(56, 189, 248, 0.4); }
      100% { box-shadow: 0 0 20px rgba(56, 189, 248, 0.85); }
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
    const avatarSrc = p.portrait || 'https://norion3.github.io/bridge/assets/avatar_placeholder.png';

    row.innerHTML = `
      <div class="participant-left">
        <img class="participant-avatar" src="${avatarSrc}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22><circle cx=%2220%22 cy=%2220%22 r=%2220%22 fill=%22%230284c7%22/></svg>'">
        <div class="participant-info">
          <span class="participant-name">${p.name}</span>
          <span class="${statusClass}">${statusText}</span>
        </div>
      </div>
      <div class="participant-jump-icon">↗</div>
    `;

    // タップでGRAVITYプロフィールへジャンプ
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

  // 製作者タブのときのみ右上のいいね誘導を表示
  if (likeGuide) {
    if (tabId === 'creator') {
      likeGuide.classList.add('show');
    } else {
      likeGuide.classList.remove('show');
    }
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
function handleSendMessage() {
  const inputEl = document.getElementById('menu-chat-input');
  if (!inputEl) return;

  const rawText = inputEl.value.trim();
  if (!rawText) return;

  // 全角15文字（半角30文字）へ厳格カット
  const safeText = rawText.slice(0, 15);
  inputEl.value = '';

  if (typeof onSendChatCallback === 'function') {
    onSendChatCallback(safeText);
  }

  // 送信後、ゲーム画面を見渡せるようメニューを自動クローズ
  GameMenu.close();
}

/**
 * DOM構造の生成・マウント
 */
export function initGameMenuDOM() {
  injectMenuStyles();

  // 1. 下部中央の台形メニューボタン
  if (!document.getElementById('btn-open-game-menu')) {
    const menuBtn = document.createElement('button');
    menuBtn.id = 'btn-open-game-menu';
    menuBtn.type = 'button';
    menuBtn.innerHTML = `💬 MENU`;
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
        ここから<br>いいねしてね！↗
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
        <button type="button" class="menu-tab-btn active" data-tab="chat">💬 チャット</button>
        <button type="button" class="menu-tab-btn" data-tab="participants">👥 走者 <span id="menu-tab-participants-count">(0)</span></button>
        <button type="button" class="menu-tab-btn" data-tab="creator">💖 製作者</button>
      </div>

      <!-- 1. チャットタブ -->
      <div id="menu-tab-chat" class="menu-tab-content active">
        <div class="chat-tab-container">
          <div class="chat-desc">
            送ったメッセージは画面上にニコニコ風に流れます！（最大15文字）
          </div>
          <div class="chat-input-row">
            <input type="text" id="menu-chat-input" class="chat-input-field" maxlength="15" placeholder="メッセージを入力（最大15文字）">
            <button type="button" id="btn-send-chat" class="chat-send-btn">送信</button>
          </div>
          <div class="quick-chat-chips">
            <button type="button" class="chat-chip" data-msg="よろしく！">よろしく！</button>
            <button type="button" class="chat-chip" data-msg="ナイス！">ナイス！</button>
            <button type="button" class="chat-chip" data-msg="まってー！">まってー！</button>
            <button type="button" class="chat-chip" data-msg="おつかれさま！">おつかれさま！</button>
            <button type="button" class="chat-chip" data-msg="階段奪うねｗ">階段奪うねｗ</button>
            <button type="button" class="chat-chip" data-msg="サンダー撃つよ！">サンダー撃つよ！</button>
          </div>
        </div>
      </div>

      <!-- 2. 参加者一覧タブ -->
      <div id="menu-tab-participants" class="menu-tab-content">
        <div id="menu-participants-list" class="participants-container"></div>
      </div>

      <!-- 3. 製作者の声タブ -->
      <div id="menu-tab-creator" class="menu-tab-content">
        <div class="creator-card">
          <div class="creator-avatar-wrap" id="creator-avatar-trigger">
            <img class="creator-avatar" src="https://norion3.github.io/bridge/assets/norion_icon.png" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 68 68%22><circle cx=%2234%22 cy=%2234%22 r=%2234%22 fill=%22%230284c7%22/><text x=%2234%22 y=%2240%22 font-size=%2222%22 font-weight=%22bold%22 fill=%22white%22 text-anchor=%22middle%22>N</text></svg>'">
            <span class="creator-profile-badge">製作者</span>
          </div>
          <div class="creator-name">norion (のりおん)</div>
          <div class="creator-message">
            『Bridge Dash 3D』を遊んでくれてありがとうございます！✨<br><br>
            もし面白かったら、右上のメニューからぜひ<b>いいね＆フォロー</b>をお願いします！更新の大きな励みになります💖
          </div>
          <button type="button" id="btn-jump-creator-profile" class="creator-jump-btn">
            👤 製作者プロフィールを見る ↗
          </button>
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
    sendBtn?.addEventListener('click', handleSendMessage);
    inputEl?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSendMessage();
      }
    });

    // 定型文チップ
    const chips = sheet.querySelectorAll('.chat-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        if (inputEl) {
          inputEl.value = chip.dataset.msg || '';
          handleSendMessage();
        }
      });
    });

    // 製作者プロフィールジャンプ（norion の user_id を指定）
    const creatorJumpAction = () => {
      // 製作者の GRAVITY user_id（後から変更可能）
      const CREATOR_USER_ID = 'norion_creator';
      GravityRouter.openProfile(CREATOR_USER_ID);
    };
    document.getElementById('creator-avatar-trigger')?.addEventListener('click', creatorJumpAction);
    document.getElementById('btn-jump-creator-profile')?.addEventListener('click', creatorJumpAction);
  }
}

// 自動初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initGameMenuDOM);
} else {
  initGameMenuDOM();
}