// dom.js: 画面UI・HUD・ロビー・待機室・超ミニマルエントリーシールドの動的生成モジュール
// ★ 確定仕様（ソロプレイ「1人で遊ぶ」即時起動 ＆ 超ミニマルエントリーシールド完全連動版）：
//   1. 【「1人で遊ぶ（#btn-start-solo）」タップ即時ゲーム始動の実装】
//      タップ時に UIController.showGame()、ロビー画面完全非表示化、スロット0バインド、
//      launchGameEngine() を確実にキックし、1人で遊ぶが確実に起動するように修正。
//      スマホ実機でのタップ抜けを防ぐため touchend と click の双方を確実にバインド。
//      防壁（try-catch）により、他モジュールの例外で起動が中断される事故を物理遮断。
//   2. 【初期スタイル強制非表示によるFOUC完全遮断】
//      #test-lobby-overlay の初期スタイルを display: none !important; に設定。
//      ローダー消去から判定完了までの間に素のロビー画面が露出する事故を物理的に根絶。
//   3. 【超ミニマル・エントリーシールド（#entry-shield）の完全維持】
//   4. 【緑チームバッジ（.slot-green: #10b981）の完全定義】

import { updatePlayerName, bindLocalPlayerSlot } from './character.js';

/**
 * 必要なスタイル（CSS）をheadタグ内に動的注入する
 */
export function injectStyles() {
  let style = document.getElementById('gravity-bridge-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'gravity-bridge-styles';
    document.head.appendChild(style);
  }

  style.textContent = `
    * {
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
      touch-action: none;
      box-sizing: border-box;
    }
    #canvas-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 1;
    }
    #touch-control-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 10;
      touch-action: none;
    }

    /* ロビー画面 ＆ 待機画面：ポップで爽やかな青空・マリンフロストデザイン */
    .gravity-screen-overlay,
    #test-lobby-overlay {
      position: absolute;
      inset: 0;
      z-index: 100;
      display: none !important;
      flex-direction: column;
      align-items: center;
      background: radial-gradient(circle at 50% 10%, rgba(14, 165, 233, 0.95) 0%, rgba(15, 23, 42, 0.97) 100%) !important;
      color: #ffffff;
      padding: 16px 22px;
      padding-top: max(112px, env(safe-area-inset-top, 44px) + 64px) !important;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .gravity-screen-overlay.active-screen,
    #test-lobby-overlay.active-screen {
      display: flex !important;
    }
    .gravity-screen-overlay.hidden,
    #test-lobby-overlay.hidden {
      display: none !important;
    }
    .gravity-card,
    .lobby-card {
      width: 100%;
      max-width: 380px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
    }

    /* メインボタン「1人で遊ぶ」 */
    .btn-solo-hero {
      width: 100%;
      padding: 18px 24px;
      background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%) !important;
      color: #ffffff !important;
      font-size: 19px !important;
      font-weight: 900 !important;
      letter-spacing: 0.04em;
      border: 2px solid rgba(255, 255, 255, 0.5) !important;
      border-radius: 18px !important;
      cursor: pointer;
      box-shadow: 0 8px 22px rgba(2, 132, 199, 0.45), 0 2px 4px rgba(0, 0, 0, 0.2) !important;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: transform 0.1s ease, box-shadow 0.15s ease;
    }
    .btn-solo-hero:active {
      transform: scale(0.96) !important;
      box-shadow: 0 4px 12px rgba(2, 132, 199, 0.35) !important;
    }

    /* サブボタン：公開ルーム作成 */
    .gravity-btn-green,
    .btn-green {
      width: 100%;
      padding: 15px 20px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      color: #ffffff !important;
      font-size: 15px !important;
      font-weight: 800 !important;
      border: 1px solid rgba(255, 255, 255, 0.3) !important;
      border-radius: 14px !important;
      cursor: pointer;
      box-shadow: 0 5px 16px rgba(16, 185, 129, 0.35) !important;
      transition: transform 0.1s ease;
    }
    .gravity-btn-green:active,
    .btn-green:active {
      transform: scale(0.97);
    }

    /* サブボタン：プライベート作成 */
    .btn-private {
      background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%) !important;
      box-shadow: 0 5px 16px rgba(13, 148, 136, 0.35) !important;
    }

    /* 公開ルーム一覧カード */
    .room-list-box {
      width: 100%;
      background: rgba(255, 255, 255, 0.08) !important;
      border: 1px solid rgba(255, 255, 255, 0.18) !important;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 16px !important;
      padding: 18px 16px;
      margin-top: 6px;
    }

    #room-list-container {
      max-height: 210px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      padding-right: 4px;
      margin-top: 8px;
    }

    #room-list-container::-webkit-scrollbar {
      width: 4px;
    }
    #room-list-container::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
    }
    #room-list-container::-webkit-scrollbar-thumb {
      background: rgba(56, 189, 248, 0.4);
      border-radius: 4px;
    }

    .gravity-room-item {
      width: 100%;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      gap: 10px;
    }
    .gravity-member-slot {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
    }
    .slot-tag {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 900;
      color: #fff;
    }
    .slot-blue { background-color: #0284c7; }
    .slot-red { background-color: #ef4444; }
    .slot-yellow { background-color: #f59e0b; }
    .slot-green { background-color: #10b981; }

    /* 超ミニマル・エントリーシールド */
    .entry-shield-minimal {
      position: absolute;
      inset: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: radial-gradient(circle at 50% 30%, rgba(14, 165, 233, 0.94) 0%, rgba(15, 23, 42, 0.98) 100%);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      transition: opacity 0.3s ease;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .entry-shield-minimal.hidden {
      display: none !important;
    }
    .shield-mini-spinner {
      width: 36px;
      height: 36px;
      border: 3px solid rgba(56, 189, 248, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: mini-shield-spin 0.8s linear infinite;
    }
    @keyframes mini-shield-spin {
      to { transform: rotate(360deg); }
    }
    .shield-mini-room {
      font-size: 16px;
      font-weight: 800;
      color: #38bdf8;
      letter-spacing: 0.05em;
      text-shadow: 0 0 10px rgba(56, 189, 248, 0.5);
    }
    .shield-mini-status {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.75);
    }
  `;
}

export function getTopInset() {
  const isGravity = typeof window !== 'undefined' && !!window.AgentSDK;
  if (!isGravity) return 24;
  return window.innerHeight >= 812 ? 112 : 96;
}

export async function syncGravityUserName() {
  let displayName = 'プレイヤー';

  if (typeof window !== 'undefined' && window.AgentSDK && window.AgentSDK.user) {
    try {
      const res = await window.AgentSDK.user.getMyUserInfo();
      if (res && res.data && res.data.name) {
        displayName = res.data.name;
        window.GRAVITY_USER_NAME = displayName;
        
        try {
          updatePlayerName(displayName);
        } catch (e) {
          console.warn('[dom.js] updatePlayerName call deferred:', e);
        }
      }
    } catch (err) {
      console.warn('[dom.js] Failed to get user info from AgentSDK:', err);
    }
  }

  const dynamicGreeting = document.getElementById('lobby-user-greeting');
  if (dynamicGreeting) {
    dynamicGreeting.innerHTML = `ようこそ <span style="color: #fde047; font-weight: 800;">${displayName}</span> さん`;
  }

  const staticGreeting = document.querySelector('#test-lobby-overlay .lobby-card > div:nth-child(2)');
  if (staticGreeting) {
    staticGreeting.innerHTML = `ようこそ <span style="color: #fde047; font-weight: 800;">${displayName}</span> さん`;
  }
}

export function patchExistingLobbyLabels() {
  const overlay = document.getElementById('test-lobby-overlay');
  if (!overlay) return;

  const card = overlay.querySelector('.lobby-card');
  if (!card) return;

  const titleEl = card.querySelector('div:nth-child(1)');
  if (titleEl) {
    titleEl.textContent = '階段を架けろ！';
    titleEl.style.fontSize = '30px';
    titleEl.style.fontWeight = '900';
    titleEl.style.letterSpacing = '0.05em';
    titleEl.style.color = '#ffffff';
    titleEl.style.textShadow = '0 3px 12px rgba(2, 132, 199, 0.8), 0 2px 4px rgba(0, 0, 0, 0.4)';
    titleEl.style.margin = '4px 0 2px 0';
  }

  const greetingEl = card.querySelector('div:nth-child(2)');
  if (greetingEl) {
    greetingEl.style.color = '#bae6fd';
    greetingEl.style.fontSize = '14px';
    greetingEl.style.marginBottom = '6px';
  }

  const soloBtn = document.getElementById('btn-start-solo');
  if (soloBtn) {
    soloBtn.textContent = '▶ 1人で遊ぶ';
    soloBtn.className = 'btn-solo-hero';

    if (!soloBtn._hasSoloListener) {
      soloBtn._hasSoloListener = true;

      const onSoloStart = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }

        // 1. ユーザー名同期
        try {
          if (window.GRAVITY_USER_NAME) {
            updatePlayerName(window.GRAVITY_USER_NAME);
          }
        } catch (err) {
          console.warn('[dom.js] updatePlayerName safe catch:', err);
        }

        // 2. ソロプレイモードの確定
        try {
          if (window.NetworkManager) {
            window.NetworkManager.isMultiplayerActive = false;
            window.NetworkManager.isHost = true;
            window.NetworkManager.mySlot = 0;
          }
          if (typeof bindLocalPlayerSlot === 'function') {
            bindLocalPlayerSlot(0);
          } else if (typeof window.bindLocalPlayerSlot === 'function') {
            window.bindLocalPlayerSlot(0);
          }
        } catch (err) {
          console.warn('[dom.js] bindLocalPlayerSlot safe catch:', err);
        }

        // 3. ロビー画面および全オーバーレイの完全消去
        try {
          if (typeof UIController !== 'undefined' && typeof UIController.showGame === 'function') {
            UIController.showGame();
          } else if (window.UIController && typeof window.UIController.showGame === 'function') {
            window.UIController.showGame();
          }
        } catch (err) {
          console.warn('[dom.js] UIController.showGame safe catch:', err);
        }

        const allOverlays = document.querySelectorAll('.gravity-screen-overlay, #test-lobby-overlay');
        allOverlays.forEach(ol => {
          ol.classList.remove('active-screen');
          ol.classList.add('hidden');
          ol.style.setProperty('display', 'none', 'important');
        });

        const startModal = document.getElementById('modal-start');
        if (startModal) {
          startModal.classList.add('hidden');
          startModal.style.setProperty('display', 'none', 'important');
        }

        // 4. ゲームエンジンの起動
        try {
          if (typeof window.launchGameEngine === 'function') {
            window.launchGameEngine();
          }
        } catch (err) {
          console.warn('[dom.js] launchGameEngine safe catch:', err);
        }

        const startBtn = document.getElementById('btn-start');
        if (startBtn) {
          try {
            startBtn.click();
          } catch (err) {
            console.warn('[dom.js] startBtn.click safe catch:', err);
          }
        }
      };

      soloBtn.addEventListener('touchend', onSoloStart, { passive: false });
      soloBtn.addEventListener('click', onSoloStart);
    }
  }

  if (soloBtn && greetingEl && soloBtn.previousElementSibling !== greetingEl) {
    greetingEl.after(soloBtn);
  }

  const allButtons = card.querySelectorAll('button');
  allButtons.forEach(btn => {
    const text = btn.textContent || '';
    if (text.includes('公開ルーム')) {
      btn.id = 'btn-create-public';
      btn.removeAttribute('onclick');
      btn.onclick = null;
      btn.className = 'gravity-btn-green';
    } else if (text.includes('プライベート')) {
      btn.id = 'btn-create-private';
      btn.removeAttribute('onclick');
      btn.onclick = null;
      btn.className = 'gravity-btn-green btn-private';
    }
  });

  const roomSection = card.querySelector('div:last-child');
  if (roomSection) {
    roomSection.classList.add('room-list-box');
    const header = roomSection.querySelector('div:first-child');
    if (header) {
      header.style.color = '#e0f2fe';
      header.style.fontSize = '16px';
      header.style.fontWeight = '800';

      let refreshBtn = header.querySelector('button');
      if (!refreshBtn) {
        refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.id = 'btn-refresh-rooms';
        refreshBtn.textContent = '更新';
        refreshBtn.style.cssText = 'background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: #ffffff; font-size: 12px; font-weight: 700; padding: 4px 10px; cursor: pointer; float: right;';
        header.appendChild(refreshBtn);
      } else {
        refreshBtn.id = 'btn-refresh-rooms';
      }
    }

    const listBody = roomSection.querySelector('div:last-child');
    if (listBody) {
      listBody.id = 'room-list-container';
    }
  }
}

export const EntryShield = {
  show(roomText = 'CONNECTING...', statusText = 'ルームへ合流中...') {
    let el = document.getElementById('entry-shield');
    if (!el) {
      const container = document.getElementById('app-container') || document.body;
      el = document.createElement('div');
      el.id = 'entry-shield';
      el.className = 'entry-shield-minimal';
      el.innerHTML = `
        <div class="shield-mini-spinner"></div>
        <div id="shield-room-text" class="shield-mini-room">${roomText}</div>
        <div id="shield-status-text" class="shield-mini-status">${statusText}</div>
      `;
      container.appendChild(el);
    }
    const roomEl = document.getElementById('shield-room-text');
    const statusEl = document.getElementById('shield-status-text');
    if (roomEl && roomText) roomEl.textContent = roomText;
    if (statusEl && statusText) statusEl.textContent = statusText;

    el.classList.remove('hidden');
    el.style.removeProperty('display');
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
  },

  update(roomText, statusText) {
    const roomEl = document.getElementById('shield-room-text');
    const statusEl = document.getElementById('shield-status-text');
    if (roomEl && roomText) roomEl.textContent = roomText;
    if (statusEl && statusText) statusEl.textContent = statusText;
  },

  hide() {
    const el = document.getElementById('entry-shield');
    if (!el) return;
    el.style.transition = 'opacity 0.3s ease';
    el.style.opacity = '0';
    el.style.pointerEvents = 'none';
    setTimeout(() => {
      el.classList.add('hidden');
      el.style.setProperty('display', 'none', 'important');
    }, 300);
  }
};

if (typeof window !== 'undefined') {
  window.EntryShield = EntryShield;
}

export function mountAllUI(container) {
  if (!container) return;
  injectStyles();
  const topInset = getTopInset();

  if (!document.getElementById('canvas-container')) {
    container.innerHTML = `
      <div id="canvas-container"></div>
      <div id="touch-control-layer"></div>
    `;
  }

  if (!document.getElementById('screen-waiting')) {
    const waitScreen = document.createElement('div');
    waitScreen.id = 'screen-waiting';
    waitScreen.className = 'gravity-screen-overlay hidden';
    waitScreen.innerHTML = `
      <div class="gravity-card">
        <div id="waiting-room-tag" style="font-size: 13px; color: #38bdf8; font-weight: 800; background: rgba(56, 189, 248, 0.15); padding: 4px 12px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.4);">ROOM #-----</div>
        <div style="font-size: 24px; font-weight: 900; margin: 4px 0; color: #ffffff; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">マッチング待機中</div>
        <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.2); margin-bottom: 8px;"></div>
        <div id="waiting-members-list" style="width: 100%; display: flex; flex-direction: column; gap: 10px; margin: 16px 0;"></div>
        <button id="btn-host-start" type="button" class="btn-solo-hero" style="font-size: 18px !important;">ゲーム開始</button>
        <button id="btn-leave-room" type="button" class="gravity-btn-gray" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); color: #ffffff; padding: 14px; border-radius: 14px; font-weight: 800;">ロビーへ戻る</button>
      </div>
    `;
    container.appendChild(waitScreen);
  }

  if (!document.getElementById('entry-shield')) {
    const shield = document.createElement('div');
    shield.id = 'entry-shield';
    shield.className = 'entry-shield-minimal hidden';
    shield.innerHTML = `
      <div class="shield-mini-spinner"></div>
      <div id="shield-room-text" class="shield-mini-room">CONNECTING...</div>
      <div id="shield-status-text" class="shield-mini-status">ルームへ合流中...</div>
    `;
    container.appendChild(shield);
  }

  patchExistingLobbyLabels();
  syncGravityUserName();

  const leaveBtn = document.getElementById('btn-leave-room');
  if (leaveBtn && !leaveBtn._hasCustomListener) {
    leaveBtn._hasCustomListener = true;
    leaveBtn.addEventListener('click', () => {
      if (window.NetworkManager && typeof window.NetworkManager.exitRoom === 'function') {
        window.NetworkManager.exitRoom();
      } else {
        UIController.showLobby();
      }
    });
  }

  if (typeof window !== 'undefined' && window.NetworkManager && typeof window.hookLobbyNetworkEvents === 'function') {
    window.hookLobbyNetworkEvents();
  }
}

export const UIController = {
  showLobby() {
    const screenLobby = document.getElementById('screen-lobby');
    const staticOverlay = document.getElementById('test-lobby-overlay');
    if (screenLobby) {
      screenLobby.classList.remove('hidden');
      screenLobby.classList.add('active-screen');
      screenLobby.style.setProperty('display', 'flex', 'important');
    }
    if (staticOverlay) {
      staticOverlay.classList.remove('hidden');
      staticOverlay.classList.add('active-screen');
      staticOverlay.style.setProperty('display', 'flex', 'important');
    }
    document.getElementById('screen-waiting')?.classList.add('hidden');
    this._setHUDVisible(false);
  },

  showWaitingRoom(roomId) {
    this._hideAllLobbyOverlays();
    const waitScreen = document.getElementById('screen-waiting');
    if (waitScreen) {
      waitScreen.classList.remove('hidden');
      waitScreen.classList.add('active-screen');
      waitScreen.style.setProperty('display', 'flex', 'important');
    }
    const tag = document.getElementById('waiting-room-tag');
    if (tag) tag.innerText = `ROOM #${roomId}`;
    this._setHUDVisible(false);
  },

  showGame() {
    this._hideAllLobbyOverlays();

    const waitScreen = document.getElementById('screen-waiting');
    if (waitScreen) {
      waitScreen.classList.remove('active-screen');
      waitScreen.classList.add('hidden');
      waitScreen.style.setProperty('display', 'none', 'important');
    }

    const startModal = document.getElementById('modal-start');
    if (startModal) {
      startModal.classList.add('hidden');
      startModal.style.setProperty('display', 'none', 'important');
    }

    this._setHUDVisible(true);
  },

  _hideAllLobbyOverlays() {
    const staticOverlay = document.getElementById('test-lobby-overlay');
    if (staticOverlay) {
      staticOverlay.classList.remove('active-screen');
      staticOverlay.classList.add('hidden');
      staticOverlay.style.setProperty('display', 'none', 'important');
    }

    const screenLobby = document.getElementById('screen-lobby');
    if (screenLobby) {
      screenLobby.classList.remove('active-screen');
      screenLobby.classList.add('hidden');
      screenLobby.style.setProperty('display', 'none', 'important');
    }

    const allOverlays = document.querySelectorAll('.gravity-screen-overlay');
    allOverlays.forEach(overlay => {
      overlay.classList.remove('active-screen');
      overlay.classList.add('hidden');
      overlay.style.setProperty('display', 'none', 'important');
    });
  },

  _setHUDVisible(visible) {
    const displayVal = visible ? 'flex' : 'none';
    const hudTop = document.getElementById('hud-top-container');
    const hudRestart = document.getElementById('hud-restart-layer');
    const hudSound = document.getElementById('hud-sound-layer');
    if (hudTop) hudTop.style.display = displayVal;
    if (hudRestart) hudRestart.style.display = displayVal;
    if (hudSound) hudSound.style.display = displayVal;
  }
};

if (typeof window !== 'undefined') {
  window.UIController = UIController;
}

export function initDOMEnhancements() {
  injectStyles();
  patchExistingLobbyLabels();
  syncGravityUserName();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDOMEnhancements);
} else {
  initDOMEnhancements();
}

import('./network.js').then(module => {
  if (module && typeof module.hookLobbyNetworkEvents === 'function') {
    window.hookLobbyNetworkEvents = module.hookLobbyNetworkEvents;
    module.hookLobbyNetworkEvents();
  }
}).catch(err => {
  console.warn('[dom.js] Dynamic import of network.js deferred:', err);
});