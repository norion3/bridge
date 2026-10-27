// main_controls.js: タッチ・マウス操作・バーチャルスティック・ジェスチャー抑制・リスタート連打防止モジュール
// ★ 完全安定化版（Phase 4 修正）：
//   1. 【リスタートボタン多重発火・連打完全防止（lastRestartTime ガード）】
//      クイックリスタート（#btn-restart-quick）およびリザルト画面（#btn-restart）において、
//      スマホ実機で発生しやすい touchend と click の微小時間差（数十ms）による二重実行、
//      およびプレイヤーの連打による resetGame() 多重キックを 600ms デバウンスで遮断。
//   2. 【入力イベントリスナー・ジェスチャー抑制の完全維持】
//      タッチ、マウスドラッグ、ピンチ・ジェスチャー抑制、ダブルタップ拡大防止。
//   3. 【サウンド切替・スタートボタン排他受付の完全維持】

export const input = { x: 0, y: 0, active: false };

/**
 * 操作入力およびUIボタンイベントの初期化
 */
export function setupControls(sound, callbacks = {}) {
  const { onResetGame, onLaunchGame, onRestartVisibilityUpdate } = callbacks;

  const zone = document.getElementById('touch-control-layer');
  let touchId = null, startX = 0, startY = 0;

  const preventDefaultHandler = (e) => {
    if (e.cancelable) e.preventDefault();
  };

  document.addEventListener('gesturestart', preventDefaultHandler, { passive: false });
  document.addEventListener('gesturechange', preventDefaultHandler, { passive: false });
  document.addEventListener('gestureend', preventDefaultHandler, { passive: false });

  window.addEventListener('contextmenu', preventDefaultHandler, { passive: false });

  let lastTouchEndTime = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEndTime <= 300) {
      if (!e.target.closest('button')) {
        if (e.cancelable) e.preventDefault();
      }
    }
    lastTouchEndTime = now;
  }, { passive: false });

  function onPointerStart(x, y, id) {
    if (sound) sound.init();
    touchId = id;
    startX = x;
    startY = y;
    input.active = true;
  }

  function onPointerMove(x, y) {
    if (!input.active) return;
    const dx = x - startX, dy = y - startY;
    const dist = Math.hypot(dx, dy), maxDist = 55;

    if (dist > 5) {
      const clamped = Math.min(dist, maxDist);
      input.x = Math.cos(Math.atan2(dy, dx)) * (clamped / maxDist);
      input.y = Math.sin(Math.atan2(dy, dx)) * (clamped / maxDist);
    } else {
      input.x = 0;
      input.y = 0;
    }
  }

  function onPointerEnd() {
    input.active = false;
    input.x = 0;
    input.y = 0;
    touchId = null;
  }

  if (zone) {
    zone.addEventListener('touchstart', e => {
      if (e.cancelable) e.preventDefault();
      if (e.touches.length > 0) {
        onPointerStart(e.touches[0].clientX, e.touches[0].clientY, e.touches[0].identifier);
      }
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      if (!input.active) return;
      for (let i = 0; i < e.touches.length; i++) {
        if (e.touches[i].identifier === touchId) {
          onPointerMove(e.touches[i].clientX, e.touches[i].clientY);
          break;
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', onPointerEnd, { passive: false });
    window.addEventListener('touchcancel', onPointerEnd, { passive: false });

    zone.addEventListener('mousedown', e => {
      if (e.button === 0) onPointerStart(e.clientX, e.clientY, 'mouse');
    });

    window.addEventListener('mousemove', e => {
      if (input.active && touchId === 'mouse') onPointerMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', () => {
      if (touchId === 'mouse') onPointerEnd();
    });
  }

  // ★ リスタート実行時の共通デバウンス（二重実行・連打ガード）用タイムスタンプ
  let lastRestartTime = 0;

  const quickRestartBtn = document.getElementById('btn-restart-quick');
  if (quickRestartBtn) {
    const onQuickRestart = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const now = Date.now();
      if (now - lastRestartTime < 600) {
        return;
      }
      lastRestartTime = now;

      if (sound) sound.init();
      if (onResetGame) onResetGame();
    };
    quickRestartBtn.addEventListener('click', onQuickRestart);
    quickRestartBtn.addEventListener('touchend', onQuickRestart);
  }

  const soundBtn = document.getElementById('btn-sound');
  const iconSoundOff = document.getElementById('icon-sound-off');
  const iconSoundOn = document.getElementById('icon-sound-on');
  if (soundBtn && sound) {
    soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      const isMuted = sound.toggleMute();
      if (!isMuted) {
        sound.rebuild();
        sound.playCollect(1.0);
      }

      if (iconSoundOff && iconSoundOn) {
        if (isMuted) {
          iconSoundOff.classList.remove('hidden');
          iconSoundOn.classList.add('hidden');
        } else {
          iconSoundOff.classList.add('hidden');
          iconSoundOn.classList.remove('hidden');
        }
      }
    });
  }

  const startBtn = document.getElementById('btn-start');
  function onStartClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (sound) sound.init();
    const modal = document.getElementById('modal-start');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    if (onLaunchGame) onLaunchGame();
  }
  if (startBtn) {
    startBtn.addEventListener('click', onStartClick);
    startBtn.addEventListener('touchend', onStartClick);
  }

  const restartBtn = document.getElementById('btn-restart');
  if (restartBtn) {
    const onResultRestart = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const now = Date.now();
      if (now - lastRestartTime < 600) {
        return;
      }
      lastRestartTime = now;

      if (sound) sound.init();
      if (onResetGame) onResetGame();
    };
    restartBtn.addEventListener('click', onResultRestart);
    restartBtn.addEventListener('touchend', onResultRestart);
  }

  if (onRestartVisibilityUpdate) onRestartVisibilityUpdate();
}