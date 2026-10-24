// menu.js: ボトムシートメニュー・右下サイドMENUボタン・親指下部チャット・製作者プロフィール公式フック・参加者履歴管理
// ★ アプリ内ネイティブプロフィール直接起動版（走者＆製作者の完全一本化）：
//   1. 【Web URL遷移（外部ブラウザ化）を完全根絶】
//      window.top.location.href = 'https://...' によるWeb版GRAVITY（アプリ誘導バナー）への誤遷移を全廃。
//   2. 【もともとの走者方式（ネイティブ起動）へ製作者も完全統合】
//      走者（p.userId）も製作者（本垢: 2736445531 / 開発垢: 887811163）も、
//      すべて数字の user_id を渡す統一インターフェースへ一本化。
//   3. 【AgentSDKネイティブブリッジ ＆ slme://usercenter スキーム連動】
//      AgentSDK.user.openUserProfile 等のネイティブブリッジを最優先実行し、
//      フォールバックとして不可視iframe経由で GRAVITY内部スキーム（slme://usercenter?uid=xxx）をキック。
//      ゲーム画面を壊さず、アプリ内ネイティブのマイページを直接起動します。

import { injectMenuStyles } from './menu_styles.js';

// 製作者アカウント定数定義（数字IDベース）
export const CREATOR_ACCOUNTS = {
  main: {
    id: '2736445531',
    shareUrl: 'https://api.gravity.place/gravity/url/yH2Wc',
    title: '👤 製作者の本アカウントを見る ↗',
    subtitle: 'メインの活動・交流・フォローはこちら'
  },
  sub: {
    id: '887811163',
    shareUrl: 'https://api.gravity.place/gravity/url/IH2Wc',
    title: '🛠️ 開発・ご要望用アカウントを見る ↗',
    subtitle: 'ゲームの要望やコメントはこちらへどうぞ'
  }
};

/**
 * GRAVITYアプリ内ネイティブ画面遷移ルーター
 * ★ 走者・製作者共通：アプリ内ネイティブプロフィールを直接オーバーレイ起動
 */
export const GravityRouter = {
  openProfile(userIdOrUrl) {
    if (!userIdOrUrl) return;
    const target = String(userIdOrUrl).trim();
    if (!target || target === 'local_user' || target === 'null') return;

    // 1. 数字のユーザーIDを抽出（URLが渡された場合もIDを優先抽出）
    let cleanId = target.replace(/[^0-9]/g, '');

    // URL形式でIDが含まれていない場合は短縮URLとみなす
    const isUrl = target.startsWith('http://') || target.startsWith('https://');

    console.log('[GravityRouter] アプリ内ネイティブプロフィール起動を試行: ID =', cleanId || target);

    // 2. 【優先度1】AgentSDK の公式ネイティブブリッジメソッドを検証・実行
    if (typeof window !== 'undefined' && window.AgentSDK) {
      try {
        const targetIdStr = cleanId || target;

        // パターンA: AgentSDK.user.openUserProfile
        if (window.AgentSDK.user && typeof window.AgentSDK.user.openUserProfile === 'function') {
          window.AgentSDK.user.openUserProfile({ user_id: targetIdStr, uid: targetIdStr });
          return;
        }
        // パターンB: AgentSDK.user.openUser
        if (window.AgentSDK.user && typeof window.AgentSDK.user.openUser === 'function') {
          window.AgentSDK.user.openUser({ user_id: targetIdStr, uid: targetIdStr });
          return;
        }
        // パターンC: AgentSDK.app.openProfile
        if (window.AgentSDK.app && typeof window.AgentSDK.app.openProfile === 'function') {
          window.AgentSDK.app.openProfile({ user_id: targetIdStr, uid: targetIdStr });
          return;
        }
        // パターンD: AgentSDK.room.openUserProfile
        if (window.AgentSDK.room && typeof window.AgentSDK.room.openUserProfile === 'function') {
          window.AgentSDK.room.openUserProfile({ user_id: targetIdStr, uid: targetIdStr });
          return;
        }
      } catch (sdkErr) {
        console.warn('[GravityRouter] AgentSDK native openProfile call failed:', sdkErr);
      }
    }

    // 3. 【優先度2】GRAVITY ネイティブ内部スキーム（slme://usercenter）をキック
    // ※ 不可視 iframe 経由でキックすることで、ゲーム画面の白濁やリロードを防ぎ、ネイティブ画面を被せる
    if (cleanId) {
      try {
        const ifr = document.createElement('iframe');
        ifr.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none;border:none;display:none;';
        ifr.src = `slme://usercenter?uid=${cleanId}`;
        document.body.appendChild(ifr);

        // 1秒後にiframeを掃除
        setTimeout(() => {
          if (document.body.contains(ifr)) {
            document.body.removeChild(ifr);
          }
        }, 1000);

        // GRAVITYアプリ内環境（AgentSDK存在時）であればここで完了
        if (typeof window !== 'undefined' && window.AgentSDK) {
          return;
        }
      } catch (schemeErr) {
        console.warn('[GravityRouter] Native scheme launch failed:', schemeErr);
      }
    }

    // 4. 【優先度3】PCブラウザ等の非アプリ環境（検証時）のみ Web URL を開く
    if (typeof window !== 'undefined' && !window.AgentSDK) {
      const fallbackUrl = isUrl ? target : `https://www.gravity.place/user/${cleanId}`;
      window.open(fallbackUrl, '_blank');
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

    // ★ 走者タップ時：数字の userId を渡してネイティブプロフィールを起動
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

      <!-- 3. 製作者タブ（走者と完全に同じネイティブ起動方式） -->
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

    // ★【核心改善】製作者プロフィール直結ボタン：Web URLではなく「数字ID」を渡してもともとの走者方式でネイティブ起動
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