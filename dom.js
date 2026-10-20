// dom.js: 画面UI・HUD・ロビー・待機室の動的生成モジュール
// 既存のゲームコードには一切干渉せず、指定されたコンテナ内にUI要素を安全に構築します。
// ★ Phase 3 実装版（イベントリスナー一本化・多重発火デバウンス仕上げ）：
//   1. 「公開ルームを作成」ボタンのタップイベントに600msデバウンスガードを導入（touchend+clickの連動二重発火を完全防止）
//   2. network.js のフックと重複しないようイベント登録を一元化・安全化
//   3. UIController.showGame() での全オーバーレイ非表示（display: none !important）徹底

import { updatePlayerName } from './character.js';

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
      display: flex;
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
    .gravity-screen-overlay.hidden {
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

    .gravity-room-item {
      width: 100%;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
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
  `;
}

/**
 * GRAVITYアプリの上部インセット（除外エリア）を取得
 */
export function getTopInset() {
  const isGravity = typeof window !== 'undefined' && !!window.AgentSDK;
  if (!isGravity) return 24;
  return window.innerHeight >= 812 ? 112 : 96;
}

/**
 * GRAVITY AgentSDKからユーザー名を取得してロビー画面および自キャラ足元に即座に反映する
 */
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

  // 1. 動的テンプレート内の要素を更新
  const dynamicGreeting = document.getElementById('lobby-user-greeting');
  if (dynamicGreeting) {
    dynamicGreeting.innerHTML = `ようこそ <span style="color: #fde047; font-weight: 800;">${displayName}</span> さん`;
  }

  // 2. gravity_loader.html にすでにある既存ロビー要素も更新
  const staticGreeting = document.querySelector('#test-lobby-overlay .lobby-card > div:nth-child(2)');
  if (staticGreeting) {
    staticGreeting.innerHTML = `ようこそ <span style="color: #fde047; font-weight: 800;">${displayName}</span> さん`;
  }
}

/**
 * 既存の静的要素（gravity_loader.html）が存在する場合のテキスト・レイアウト・順序自動補正
 * ★【Phase 3 仕上げ】イベント二重登録の整理 ＆ デバウンスガード付きトリガー
 */
let lastDomCreateTime = 0;

export function patchExistingLobbyLabels() {
  const overlay = document.getElementById('test-lobby-overlay');
  if (!overlay) return;

  const card = overlay.querySelector('.lobby-card');
  if (!card) return;

  // タイトル：「階段を架けろ！」
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

  // 挨拶テキスト
  const greetingEl = card.querySelector('div:nth-child(2)');
  if (greetingEl) {
    greetingEl.style.color = '#bae6fd';
    greetingEl.style.fontSize = '14px';
    greetingEl.style.marginBottom = '6px';
  }

  // ボタンの順序入れ替え：【1人で遊ぶ】を一番上に配置
  const soloBtn = document.getElementById('btn-start-solo');
  if (soloBtn) {
    soloBtn.textContent = '▶ 1人で遊ぶ';
    soloBtn.className = 'btn-solo-hero';
    
    if (!soloBtn._hasCustomListener) {
      soloBtn._hasCustomListener = true;
      soloBtn.addEventListener('click', () => {
        if (window.GRAVITY_USER_NAME) {
          updatePlayerName(window.GRAVITY_USER_NAME);
        }
      });
    }
  }

  // DOMツリー上で soloBtn を挨拶文の直後へ移動
  if (soloBtn && greetingEl && soloBtn.previousElementSibling !== greetingEl) {
    greetingEl.after(soloBtn);
  }

  // ボタンテキストで確実に「公開ルームを作成」「プライベートルームを作成」を特定
  const allButtons = card.querySelectorAll('button');
  allButtons.forEach(btn => {
    const text = btn.textContent || '';
    if (text.includes('公開ルーム')) {
      btn.id = 'btn-create-public';
      btn.removeAttribute('onclick');
      btn.onclick = null;
      btn.className = 'gravity-btn-green';

      // ★【Phase 3】多重発火・二重実行を防止するデバウンス付きフック
      if (!btn._hasDirectHook) {
        btn._hasDirectHook = true;
        const triggerCreate = async (e) => {
          const now = Date.now();
          if (now - lastDomCreateTime < 600) {
            if (e) {
              e.preventDefault();
              e.stopPropagation();
            }
            return;
          }
          lastDomCreateTime = now;

          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }

          if (window.NetworkManager && typeof window.NetworkManager.createRoom === 'function') {
            window.NetworkManager.createRoom(false);
          } else {
            try {
              const netModule = await import('./network.js');
              if (netModule && netModule.NetworkManager) {
                netModule.NetworkManager.createRoom(false);
              }
            } catch (err) {
              console.error('[dom.js] Failed to load network.js on button click:', err);
            }
          }
        };

        btn.addEventListener('touchend', triggerCreate, { passive: false });
        btn.addEventListener('click', triggerCreate);
      }
    } else if (text.includes('プライベート')) {
      btn.id = 'btn-create-private';
      btn.removeAttribute('onclick');
      btn.onclick = null;
      btn.className = 'gravity-btn-green btn-private';
    }
  });

  // 公開ルーム一覧の外観調整 ＆ 更新ボタンに ID を付与
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

/**
 * 指定されたコンテナ要素内に、全画面UI（3Dコンテナ、HUD、ロビー、待機室）を一括マウント
 * @param {HTMLElement} container 
 */
export function mountAllUI(container) {
  if (!container) return;
  injectStyles();
  const topInset = getTopInset();

  container.innerHTML = `
    <!-- 3Dレンダリング用コンテナ -->
    <div id="canvas-container"></div>

    <!-- タッチ入力レイヤー -->
    <div id="touch-control-layer"></div>

    <!-- ゲーム内HUD（スコア・タイマー・ブロック数） -->
    <div id="hud-top-container" style="position: fixed; top: 0; left: 0; right: 0; z-index: 20; display: none; justify-content: space-between; align-items: flex-start; padding: 16px; padding-top: ${topInset + 8}px; pointer-events: none;">
      <div style="text-shadow: 0 2px 8px rgba(0,0,0,0.85); display: flex; align-items: baseline; gap: 6px;">
        <span style="font-size: 12px; font-weight: 900; color: #fde047;">SCORE</span>
        <span id="hud-score" style="font-size: 20px; font-weight: 900; color: #fbbf24;">0</span>
        <span style="font-size: 11px; font-weight: 700; color: #fef08a;">段</span>
      </div>
      <div style="text-shadow: 0 2px 8px rgba(0,0,0,0.85);">
        <span id="hud-timer" style="font-size: 20px; font-weight: 900; color: #ffffff; letter-spacing: 0.1em;">05:00</span>
      </div>
      <div style="text-shadow: 0 2px 8px rgba(0,0,0,0.85); display: flex; align-items: baseline; gap: 4px;">
        <span id="hud-stack-count" style="font-size: 20px; font-weight: 900; color: #38bdf8;">0</span>
        <span style="font-size: 11px; font-weight: 700; color: #bae6fd;">個</span>
      </div>
    </div>

    <!-- 左下リスタートボタン -->
    <div id="hud-restart-layer" style="position: fixed; bottom: 0; left: 0; z-index: 20; padding: 20px; pointer-events: none; display: none;">
      <button id="btn-restart-quick" type="button" aria-label="Restart"
        style="pointer-events: auto; width: 44px; height: 44px; border-radius: 50%; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.4); cursor: pointer;">
        <svg style="width: 20px; height: 20px; color: #fde047; fill: none; stroke: currentColor;" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
    </div>

    <!-- 右下サウンドボタン -->
    <div id="hud-sound-layer" style="position: fixed; bottom: 0; right: 0; z-index: 20; padding: 20px; pointer-events: none; display: none;">
      <button id="btn-sound" type="button" aria-label="Sound"
        style="pointer-events: auto; width: 44px; height: 44px; border-radius: 50%; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.4); cursor: pointer;">
        <svg id="icon-sound-off" style="width: 20px; height: 20px; color: #94a3b8; fill: none; stroke: currentColor;" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
        </svg>
        <svg id="icon-sound-on" style="width: 20px; height: 20px; color: #38bdf8; fill: none; stroke: currentColor; display: none;" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
      </button>
    </div>

    <!-- 画面1: マルチプレイロビー -->
    <div id="screen-lobby" class="gravity-screen-overlay">
      <div class="gravity-card">
        <div style="font-size: 30px; font-weight: 900; letter-spacing: 0.05em; margin: 4px 0 2px 0; color: #ffffff; text-shadow: 0 3px 12px rgba(2, 132, 199, 0.8), 0 2px 4px rgba(0, 0, 0, 0.4);">階段を架けろ！</div>
        <div id="lobby-user-greeting" style="font-size: 14px; color: #bae6fd; margin-bottom: 6px;">ようこそ プレイヤー さん</div>

        <button id="btn-start-solo" type="button" class="btn-solo-hero">▶ 1人で遊ぶ</button>

        <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.2); margin: 4px 0;"></div>

        <button id="btn-create-public" type="button" class="gravity-btn-green">公開ルームを作成</button>
        <button id="btn-create-private" type="button" class="gravity-btn-green btn-private">プライベートルームを作成</button>

        <div class="room-list-box" style="width: 100%; margin-top: 8px;">
          <div style="font-size: 16px; font-weight: 800; color: #e0f2fe; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <span>公開ルーム一覧</span>
            <button id="btn-refresh-rooms" type="button" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 8px; color: #ffffff; font-size: 12px; font-weight: 700; padding: 4px 10px; cursor: pointer;">更新</button>
          </div>
          <div id="room-list-container" style="width: 100%;">
            <div style="font-size: 14px; color: #bae6fd; padding: 20px 0; text-align: center;">公開ルームはありません</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 画面2: 待機部屋画面 -->
    <div id="screen-waiting" class="gravity-screen-overlay hidden">
      <div class="gravity-card">
        <div id="waiting-room-tag" style="font-size: 13px; color: #38bdf8; font-weight: 800; background: rgba(56, 189, 248, 0.15); padding: 4px 12px; border-radius: 20px; border: 1px solid rgba(56, 189, 248, 0.4);">ROOM #-----</div>
        <div style="font-size: 24px; font-weight: 900; margin: 4px 0; color: #ffffff; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">マッチング待機中</div>
        <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.2); margin-bottom: 8px;"></div>

        <div id="waiting-members-list" style="width: 100%; display: flex; flex-direction: column; gap: 10px; margin: 16px 0;">
        </div>

        <button id="btn-host-start" type="button" class="btn-solo-hero" style="font-size: 18px !important;">ゲーム開始</button>
        <button id="btn-leave-room" type="button" class="gravity-btn-gray" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); color: #ffffff; padding: 14px; border-radius: 14px; font-weight: 800;">ロビーへ戻る</button>
      </div>
    </div>
  `;

  syncGravityUserName();
}

/**
 * UIステート表示切り替え制御
 * 静的・動的・すべてのオーバーレイ幕を例外なく物理消去（display: none !important）
 */
export const UIController = {
  showLobby() {
    const screenLobby = document.getElementById('screen-lobby');
    const staticOverlay = document.getElementById('test-lobby-overlay');
    if (screenLobby) {
      screenLobby.classList.remove('hidden');
      screenLobby.style.removeProperty('display');
    }
    if (staticOverlay) {
      staticOverlay.classList.remove('hidden');
      staticOverlay.style.removeProperty('display');
      staticOverlay.style.display = 'flex';
    }
    document.getElementById('screen-waiting')?.classList.add('hidden');
    this._setHUDVisible(false);
  },

  showWaitingRoom(roomId) {
    this._hideAllLobbyOverlays();
    const waitScreen = document.getElementById('screen-waiting');
    if (waitScreen) {
      waitScreen.classList.remove('hidden');
      waitScreen.style.removeProperty('display');
      waitScreen.style.display = 'flex';
    }
    const tag = document.getElementById('waiting-room-tag');
    if (tag) tag.innerText = `ROOM #${roomId}`;
    this._setHUDVisible(false);
  },

  showGame() {
    // 1. 静的・動的問わず全オーバーレイ幕を確実に完全剥離
    this._hideAllLobbyOverlays();

    // 2. 待機部屋も確実に完全非表示化
    const waitScreen = document.getElementById('screen-waiting');
    if (waitScreen) {
      waitScreen.classList.add('hidden');
      waitScreen.style.setProperty('display', 'none', 'important');
    }

    // 3. スタートモーダルも安全に非表示化
    const startModal = document.getElementById('modal-start');
    if (startModal) {
      startModal.classList.add('hidden');
      startModal.style.setProperty('display', 'none', 'important');
    }

    // 4. ゲーム内HUD（スコア・タイマー・リスタート・サウンド）を表示
    this._setHUDVisible(true);
  },

  /**
   * DOM上に存在する全種類のロビー幕を物理的に完全に隠滅するヘルパー
   */
  _hideAllLobbyOverlays() {
    // ① 静的ローダーオーバーレイ
    const staticOverlay = document.getElementById('test-lobby-overlay');
    if (staticOverlay) {
      staticOverlay.classList.add('hidden');
      staticOverlay.style.setProperty('display', 'none', 'important');
    }

    // ② 動的生成ロビーオーバーレイ
    const screenLobby = document.getElementById('screen-lobby');
    if (screenLobby) {
      screenLobby.classList.add('hidden');
      screenLobby.style.setProperty('display', 'none', 'important');
    }

    // ③ クラス指定で存在する可能性のあるすべての全画面幕
    const allOverlays = document.querySelectorAll('.gravity-screen-overlay');
    allOverlays.forEach(overlay => {
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

/**
 * 初期化実行ルーチン（自動フック）
 */
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

// network.js を安全に読み込んでイベントをバインド
import('./network.js').then(module => {
  if (module && typeof module.hookLobbyNetworkEvents === 'function') {
    module.hookLobbyNetworkEvents();
  }
}).catch(err => {
  console.warn('[dom.js] Dynamic import of network.js deferred:', err);
});