// dom.js: 画面UI・HUD・ロビー・待機室の動的生成モジュール
// 既存のゲームコードには一切干渉せず、指定されたコンテナ内にUI要素を安全に構築します。

/**
 * 必要なスタイル（CSS）をheadタグ内に動的注入する
 */
export function injectStyles() {
  if (document.getElementById('gravity-bridge-styles')) return;

  const style = document.createElement('style');
  style.id = 'gravity-bridge-styles';
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
    .gravity-screen-overlay {
      position: absolute;
      inset: 0;
      z-index: 50;
      display: flex;
      flex-direction: column;
      align-items: center;
      background: radial-gradient(circle at top, #1e293b 0%, #090d16 100%);
      color: #ffffff;
      padding: 16px 20px;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .gravity-screen-overlay.hidden {
      display: none !important;
    }
    .gravity-card {
      width: 100%;
      max-width: 380px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
    .gravity-btn-green {
      width: 100%;
      padding: 15px 20px;
      background-color: #5bb35d;
      color: #ffffff;
      font-size: 16px;
      font-weight: 800;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(91, 179, 93, 0.35);
      transition: transform 0.1s ease, background-color 0.15s ease;
    }
    .gravity-btn-green:active {
      transform: scale(0.97);
      background-color: #4da34f;
    }
    .gravity-btn-gray {
      width: 100%;
      padding: 15px 20px;
      background-color: #64748b;
      color: #ffffff;
      font-size: 15px;
      font-weight: 800;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transition: transform 0.1s ease, background-color 0.15s ease;
    }
    .gravity-btn-gray:active {
      transform: scale(0.97);
      background-color: #475569;
    }
    .gravity-btn-blue {
      width: 100%;
      padding: 15px 20px;
      background-color: #0284c7;
      color: #ffffff;
      font-size: 16px;
      font-weight: 800;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);
      transition: transform 0.1s ease, background-color 0.15s ease;
    }
    .gravity-btn-blue:active {
      transform: scale(0.97);
      background-color: #0369a1;
    }
    .gravity-btn-disabled {
      width: 100%;
      padding: 15px 20px;
      background-color: #334155;
      color: #64748b;
      font-size: 15px;
      font-weight: 800;
      border: none;
      border-radius: 12px;
      cursor: not-allowed;
      box-shadow: none;
    }
    .gravity-room-item {
      width: 100%;
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .gravity-member-slot {
      background: rgba(30, 41, 59, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.12);
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
    .slot-blue { background-color: #0066ff; }
    .slot-red { background-color: #ef4444; }
    .slot-yellow { background-color: #f59e0b; }
  `;
  document.head.appendChild(style);
}

/**
 * GRAVITYアプリの上部インセット（除外エリア）を取得
 */
export function getTopInset() {
  const isGravity = typeof window !== 'undefined' && !!window.AgentSDK;
  if (!isGravity) return 16;
  return window.innerHeight >= 812 ? 98 : 74;
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
    <div id="screen-lobby" class="gravity-screen-overlay" style="padding-top: ${topInset + 12}px;">
      <div class="gravity-card">
        <div style="font-size: 26px; font-weight: 900; letter-spacing: 0.05em; margin: 4px 0;">マルチプレイロビー</div>
        <div id="lobby-user-greeting" style="font-size: 14px; color: #94a3b8; margin-bottom: 8px;">ようこそ プレイヤー さん</div>
        <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.12); margin-bottom: 8px;"></div>

        <button id="btn-create-public" type="button" class="gravity-btn-green">公開ルームを作成</button>
        <button id="btn-create-private" type="button" class="gravity-btn-green" style="background-color: #4da34f;">プライベートルームを作成</button>
        <button id="btn-start-solo" type="button" class="gravity-btn-gray">ソロモードで開始 (フォールバック)</button>

        <div style="width: 100%; margin-top: 16px; display: flex; flex-direction: column;">
          <div style="font-size: 18px; font-weight: 800; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <span>公開ルーム一覧</span>
            <button id="btn-refresh-rooms" type="button" style="background: none; border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; color: #94a3b8; font-size: 12px; padding: 4px 10px; cursor: pointer;">更新</button>
          </div>
          <div id="room-list-container" style="width: 100%;">
            <div style="font-size: 14px; color: #94a3b8; padding: 24px 0; text-align: center;">公開ルームはありません</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 画面2: 待機部屋画面 -->
    <div id="screen-waiting" class="gravity-screen-overlay hidden" style="padding-top: ${topInset + 12}px;">
      <div class="gravity-card">
        <div id="waiting-room-tag" style="font-size: 13px; color: #38bdf8; font-weight: 700;">ROOM #-----</div>
        <div style="font-size: 22px; font-weight: 900; margin: 4px 0;">マッチング待機中</div>
        <div style="width: 100%; height: 1px; background: rgba(255,255,255,0.12); margin-bottom: 8px;"></div>

        <div id="waiting-members-list" style="width: 100%; display: flex; flex-direction: column; gap: 10px; margin: 16px 0;">
          <!-- 動的スロット要素 -->
        </div>

        <button id="btn-host-start" type="button" class="gravity-btn-blue">ゲーム開始</button>
        <button id="btn-leave-room" type="button" class="gravity-btn-gray" style="margin-top: 8px;">ロビーへ戻る</button>
      </div>
    </div>
  `;
}

/**
 * UIステート表示切り替え制御
 */
export const UIController = {
  // ロビー画面を表示
  showLobby() {
    document.getElementById('screen-lobby')?.classList.remove('hidden');
    document.getElementById('screen-waiting')?.classList.add('hidden');
    this._setHUDVisible(false);
  },

  // 待機部屋画面を表示
  showWaitingRoom(roomId) {
    document.getElementById('screen-lobby')?.classList.add('hidden');
    document.getElementById('screen-waiting')?.classList.remove('hidden');
    const tag = document.getElementById('waiting-room-tag');
    if (tag) tag.innerText = `ROOM #${roomId}`;
    this._setHUDVisible(false);
  },

  // ゲーム本編画面を表示（ロビーを隠してHUDを表示）
  showGame() {
    document.getElementById('screen-lobby')?.classList.add('hidden');
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