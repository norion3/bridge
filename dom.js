// dom.js: 画面UI・HUD・ロビー・待機室の動的生成モジュール
// 既存のゲームコードには一切干渉せず、指定されたコンテナ内にUI要素を安全に構築します。
// ★ Phase 3.5: 取得した名前を即座に自キャラ足元ネームプレートへ反映する連携
// ★ Phase 4: network.js との安全結合（循環参照根絶 ＆ 既存ボタンへのフック保証）

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
      /* ゲーム本編の青空・海と一体感のあるリッチなマリンブルーグラデーション */
      background: radial-gradient(circle at 50% 10%, rgba(14, 165, 233, 0.95) 0%, rgba(15, 23, 42, 0.97) 100%) !important;
      color: #ffffff;
      padding: 16px 22px;
      /* GRAVITYアプリ上部UIバー（ノッチ・戻る・拡大・共有）との被りを完全に根絶する安全余白 */
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

    /* ★ メインボタン「1人で遊ぶ」：自キャラカラーの鮮やかなポップブルー＆ゴールドシャドウ */
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

    /* サブボタン：爽やかなエメラルドミント（公開ルーム作成） */
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

    /* サブボタン：落ち着いたティールグリーン（プライベート作成） */
    .btn-private {
      background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%) !important;
      box-shadow: 0 5px 16px rgba(13, 148, 136, 0.35) !important;
    }

    /* 公開ルーム一覧カード：透明感のあるすっきりしたホワイトフロスト調 */
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
        
        // 名前が取得できた瞬間に、3D空間内の自キャラ足元ネームプレートを即座に書き換え
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
 * ★ Phase 4: network.js が確実にフックできるよう ID を付与
 */
export function patchExistingLobbyLabels() {
  const overlay = document.getElementById('test-lobby-overlay');
  if (!overlay) return;

  const card = overlay.querySelector('.lobby-card');
  if (!card) return;

  // タイトル：「階段を架けろ！」（ポップな立体スタイル）
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

  // 挨拶テキストのスタイリング
  const greetingEl = card.querySelector('div:nth-child(2)');
  if (greetingEl) {
    greetingEl.style.color = '#bae6fd';
    greetingEl.style.fontSize = '14px';
    greetingEl.style.marginBottom = '6px';
  }

  // ボタンの順序入れ替え：【1人で遊ぶ】を一番上に配置！
  const soloBtn = document.getElementById('btn-start-solo');
  const createPublicBtn = card.querySelector('button:nth-of-type(1)');
  const createPrivateBtn = card.querySelector('button:nth-of-type(2)');

  if (soloBtn) {
    soloBtn.textContent = '▶ 1人で遊ぶ';
    soloBtn.className = 'btn-solo-hero';
    
    soloBtn.addEventListener('click', () => {
      if (window.GRAVITY_USER_NAME) {
        updatePlayerName(window.GRAVITY_USER_NAME);
      }
    });
  }

  // ★ Phase 4: 静的ローダーの「公開ルーム作成」ボタンに ID を付与し、onclick の alert を除去
  if (createPublicBtn && createPublicBtn !== soloBtn) {
    createPublicBtn.id = 'btn-create-public';
    createPublicBtn.removeAttribute('onclick');
    createPublicBtn.className = 'gravity-btn-green';
  }
  if (createPrivateBtn && createPrivateBtn !== soloBtn) {
    createPrivateBtn.id = 'btn-create-private';
    createPrivateBtn.removeAttribute('onclick');
    createPrivateBtn.className = 'gravity-btn-green btn-private';
  }

  // DOMツリー上で soloBtn を挨拶文（2番目の要素）の直後へ移動
  if (soloBtn && greetingEl && soloBtn.previousElementSibling !== greetingEl) {
    greetingEl.after(soloBtn);
  }

  // 公開ルーム一覧の外観調整 ＆ 更新ボタンに ID を付与
  const roomSection = card.querySelector('div:last-child');
  if (roomSection) {
    roomSection.classList.add('room-list-box');
    const header = roomSection.querySelector('div:first-child');
    if (header) {
      header.style.color = '#e0f2fe';
      header.style.fontSize = '16px';
      header.style.fontWeight = '800';

      // 更新ボタンが存在しない場合は作成、既存の場合はID割り当て
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

    // ルームリストコンテナに ID を付与
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
        <!-- ★ タイトル：「階段を架けろ！」 -->
        <div style="font-size: 30px; font-weight: 900; letter-spacing: 0.05em; margin: 4px 0 2px 0; color: #ffffff; text-shadow: 0 3px 12px rgba(2, 132, 199, 0.8), 0 2px 4px rgba(0, 0, 0, 0.4);">階段を架けろ！</div>
        <div id="lobby-user-greeting" style="font-size: 14px; color: #bae6fd; margin-bottom: 6px;">ようこそ プレイヤー さん</div>

        <!-- ★ メインボタン：「1人で遊ぶ」を最優先で一番上に配置！ -->
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
          <!-- 動的スロット要素 -->
        </div>

        <button id="btn-host-start" type="button" class="btn-solo-hero" style="font-size: 18px !important;">ゲーム開始</button>
        <button id="btn-leave-room" type="button" class="gravity-btn-gray" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.25); color: #ffffff; padding: 14px; border-radius: 14px; font-weight: 800;">ロビーへ戻る</button>
      </div>
    </div>
  `;

  // マウント後にユーザーネームを同期
  syncGravityUserName();
}

/**
 * UIステート表示切り替え制御
 */
export const UIController = {
  // ロビー画面を表示
  showLobby() {
    const screenLobby = document.getElementById('screen-lobby');
    const staticOverlay = document.getElementById('test-lobby-overlay');
    if (screenLobby) screenLobby.classList.remove('hidden');
    if (staticOverlay) staticOverlay.style.display = 'flex';
    document.getElementById('screen-waiting')?.classList.add('hidden');
    this._setHUDVisible(false);
  },

  // 待機部屋画面を表示
  showWaitingRoom(roomId) {
    document.getElementById('screen-lobby')?.classList.add('hidden');
    const staticOverlay = document.getElementById('test-lobby-overlay');
    if (staticOverlay) staticOverlay.style.display = 'none';
    document.getElementById('screen-waiting')?.classList.remove('hidden');
    const tag = document.getElementById('waiting-room-tag');
    if (tag) tag.innerText = `ROOM #${roomId}`;
    this._setHUDVisible(false);
  },

  // ゲーム本編画面を表示（ロビーを隠してHUDを表示）
  showGame() {
    document.getElementById('screen-lobby')?.classList.add('hidden');
    const staticOverlay = document.getElementById('test-lobby-overlay');
    if (staticOverlay) staticOverlay.style.display = 'none';
    document.getElementById('screen-waiting')?.classList.add('hidden');
    this._setHUDVisible(true);
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

// ★ Phase 4 循環参照根絶: network.js からも安全に呼べるよう window に登録
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

// スクリプト読み込み時に安全に自動実行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDOMEnhancements);
} else {
  initDOMEnhancements();
}

// ★ Phase 4: network.js を安全に読み込んでイベントをバインド
import('./network.js').then(module => {
  if (module && typeof module.hookLobbyNetworkEvents === 'function') {
    module.hookLobbyNetworkEvents();
  }
}).catch(err => {
  console.warn('[dom.js] Dynamic import of network.js deferred:', err);
});