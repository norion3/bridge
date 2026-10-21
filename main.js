// main.js: ゲーム全体の起動指揮・Three.js初期化・メインループ・入力・HUD制御
// ★ Phase 2 完全実装版（リモート描画 ＆ ゲームタイマー完全同期）：
//   1. 【JUMP空中大ジャンプ連動】相手が `remState === 'JUMP'` の時、ローカル同様の宙返り回転と手足オープン姿勢を描画。
//   2. 【マグネット紫オーラ同期】相手が `c.magnetActive` の時、足元の紫吸引オーラ（c.meshObj.magnetAura）を点灯・パルス拡縮。
//   3. 【無敵時間キャラ点滅】相手が `c.isInvulnerable` の時、メッシュをチラチラ高速点滅させて無敵状態を完全可視化。
//   4. 【タイマー＆タイムアップ同期】ホストの残り秒数による定期補正、およびホストからの TIME_UP 受信による両画面同時リザルト表示を完全保証。
//   5. 既存のサンダー小人化スケール、スピードオーラ・煙、スタン揺れ、AI思考遮断、Lerp速度予測補間は100%維持。

import { mountAllUI } from './dom.js';

import { SoundEngine } from './audio.js';
import {
  seaTexture
} from './materials.js';
import {
  player,
  characters,
  setupCharacters,
  resetCharacters,
  setCharacterCallbacks,
  updateNameplatePosition,
  refreshCharacterStackVisuals
} from './character.js';

import {
  STAGES,
  buildWorld,
  cleanupOldData,
  manageBlockSpawns,
  extendCourse,
  seaMesh
} from './world.js';
import {
  initParticlePools,
  spawnPuffCloud,
  spawnSpeedStepRing
} from './particles.js';
import {
  setSystemCallbacks,
  updateSingleCharacter,
  handleTackles
} from './systems.js';
import { updateAICharacter } from './ai.js';
import { updateDynamicCamera, resetCameraState } from './camera.js';
import { updateSceneEntities } from './entities.js';
import { applyRemoteGimmickVisuals } from './gimmicks.js';

// network.js から相手のスタック数変化時に呼び出せるようグローバルフックを登録
if (typeof window !== 'undefined') {
  window.refreshRemoteStackVisuals = refreshCharacterStackVisuals;
}

// GRAVITY環境 / 通常ブラウザ（GitHub Pages）の自動判別スイッチ
export const IS_GRAVITY_APP = typeof window !== 'undefined' && !!window.AgentSDK;

// 将来のマルチプレイ同期用ステート
export const NetworkState = {
  isMultiplayer: false,
  isHost: true,
  roomId: null,
  myUserId: 'local_player'
};

const sound = new SoundEngine();

let scene = null;
let camera = null;
let renderer = null;
let dirLight = null;

let timeLeft = 300;
let isGameOver = false;
let gameStarted = false;
let placedPlankCount = 0;
let lastDisplayedSec = -1;

/**
 * ★【Phase 2 追加】ホストから送信されたゲーム残り時間を受け取って補正するハンドラ
 */
export function applyRemoteTimeSync(remoteTimeLeft) {
  if (typeof remoteTimeLeft === 'number' && !isNaN(remoteTimeLeft)) {
    // ズレが0.7秒以上ある場合のみスムーズに補正
    if (Math.abs(timeLeft - remoteTimeLeft) > 0.7) {
      timeLeft = remoteTimeLeft;
      updateTimerHUD(true);
    }
  }
}

/**
 * ★【Phase 2 追加】ホストからタイムアップ宣告を受信した際のハンドラ
 */
export function applyRemoteTimeUp() {
  if (!isGameOver) {
    timeLeft = 0;
    updateTimerHUD(true);
    onTimeUp();
  }
}

/**
 * ★【Phase 2 追加】network.js から現在の残り秒数を取得するためのゲッター
 */
if (typeof window !== 'undefined') {
  window.getGameTimeLeft = () => timeLeft;
  window.applyRemoteTimeSync = applyRemoteTimeSync;
  window.applyRemoteTimeUp = applyRemoteTimeUp;
}

/**
 * 外部（network.js / dom.js）からゲームループを確実に始動させる安全関数
 * 存在しないDOMボタンの擬似クリックに依存せず、マルチ・ソロ問わずゲームを即座に動かす
 */
export function launchGameEngine() {
  gameStarted = true;
  isGameOver = false;
  if (sound) {
    sound.init();
  }
}

if (typeof window !== 'undefined') {
  window.launchGameEngine = launchGameEngine;
}

// 階段スコア連続加算アンチシェイク用タイマー
let scorePopTimer = null;
let lastPlankPlacedTime = 0;

const input = { x: 0, y: 0, active: false };

// GRAVITY環境の上部立ち入り禁止エリア動的オフセット
export function applyGravityTopInset() {
  const hudContainer = document.getElementById('hud-top-container');
  if (!hudContainer) return;

  if (IS_GRAVITY_APP) {
    const isTall = window.innerHeight >= 812;
    const topInset = isTall ? 98 : 74;
    hudContainer.style.paddingTop = `${topInset + 8}px`;
  } else {
    hudContainer.style.paddingTop = '';
  }
}

// 階段スコアの小気味よいポップ演出
export function triggerScorePop() {
  const scoreEl = document.getElementById('hud-score');
  if (!scoreEl) return;

  const now = performance.now();
  const timeSinceLast = now - lastPlankPlacedTime;
  lastPlankPlacedTime = now;

  if (scorePopTimer) {
    clearTimeout(scorePopTimer);
  }

  if (timeSinceLast < 140) {
    scoreEl.classList.remove('score-pop');
    scoreEl.classList.add('score-clamped');
  } else {
    scoreEl.classList.remove('score-pop');
    scoreEl.classList.add('score-pop');
  }

  scorePopTimer = setTimeout(() => {
    scoreEl.classList.remove('score-pop', 'score-clamped');
    scorePopTimer = null;
  }, 140);
}

export function updateHUD() {
  const countEl = document.getElementById('hud-stack-count');
  const scoreEl = document.getElementById('hud-score');
  if (countEl && player) countEl.innerText = player.stackCount;
  if (scoreEl) scoreEl.innerText = placedPlankCount;
}

// 残り30秒で文字色をネオンレッドへ切り替え
export function updateTimerHUD(force = false) {
  const currentSecInt = Math.floor(timeLeft);
  if (!force && currentSecInt === lastDisplayedSec) return;
  lastDisplayedSec = currentSecInt;
  const min = Math.floor(currentSecInt / 60).toString().padStart(2, '0');
  const sec = (currentSecInt % 60).toString().padStart(2, '0');
  const timerEl = document.getElementById('hud-timer');
  if (timerEl) {
    timerEl.innerText = `${min}:${sec}`;

    if (timeLeft <= 30 && timeLeft > 0) {
      if (!timerEl.classList.contains('timer-critical')) {
        timerEl.classList.add('timer-critical');
        timerEl.style.textShadow = '0 0 12px rgba(244, 63, 94, 0.85), 0 2px 6px rgba(0, 0, 0, 0.95)';
      }
    } else {
      if (timerEl.classList.contains('timer-critical')) {
        timerEl.classList.remove('timer-critical');
      }
      timerEl.style.textShadow = '0 2px 8px rgba(0, 0, 0, 0.95), 0 0 4px rgba(0, 0, 0, 0.9)';
    }
  }
}

export function onTimeUp() {
  if (isGameOver) return;
  isGameOver = true;

  // ホスト端末の場合、ゲスト全員へタイムアップを通知
  if (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive && window.NetworkManager.isHost) {
    if (typeof window.NetworkManager.broadcastTimeUp === 'function') {
      window.NetworkManager.broadcastTimeUp();
    }
  }

  sound.playVictory();
  const rankEl = document.getElementById('modal-rank');
  if (rankEl) rankEl.innerText = placedPlankCount + ' 段';
  const resultModal = document.getElementById('modal-result');
  if (resultModal) {
    resultModal.classList.remove('hidden');
    resultModal.style.display = 'flex';
  }
}

export function resetGame() {
  const resultModal = document.getElementById('modal-result');
  if (resultModal) {
    resultModal.classList.add('hidden');
    resultModal.style.display = 'none';
  }
  isGameOver = false;
  placedPlankCount = 0;
  timeLeft = 300;
  lastDisplayedSec = -1;

  resetCameraState();

  if (scorePopTimer) {
    clearTimeout(scorePopTimer);
    scorePopTimer = null;
  }
  lastPlankPlacedTime = 0;
  const scoreEl = document.getElementById('hud-score');
  if (scoreEl) scoreEl.classList.remove('score-pop', 'score-clamped');

  const timerEl = document.getElementById('hud-timer');
  if (timerEl) timerEl.classList.remove('timer-critical');

  buildWorld(scene);
  resetCharacters(STAGES);

  camera.position.set(0, STAGES[0].y + 24, STAGES[0].z + 12);
  camera.lookAt(0, STAGES[0].y, STAGES[0].z - 5);

  for (let i = 0; i < 30; i++) manageBlockSpawns(scene, isGameOver);
  updateHUD();
  updateTimerHUD(true);
}

export function setupControls() {
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
    sound.init();
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

  const quickRestartBtn = document.getElementById('btn-restart-quick');
  if (quickRestartBtn) {
    if (!NetworkState.isMultiplayer || NetworkState.isHost) {
      quickRestartBtn.style.display = 'flex';
    } else {
      quickRestartBtn.style.display = 'none';
    }

    const onQuickRestart = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      sound.init();
      resetGame();
    };
    quickRestartBtn.addEventListener('click', onQuickRestart);
    quickRestartBtn.addEventListener('touchend', onQuickRestart);
  }

  const soundBtn = document.getElementById('btn-sound');
  const iconSoundOff = document.getElementById('icon-sound-off');
  const iconSoundOn = document.getElementById('icon-sound-on');
  if (soundBtn) {
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
    sound.init();
    const modal = document.getElementById('modal-start');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
    launchGameEngine();
  }
  if (startBtn) {
    startBtn.addEventListener('click', onStartClick);
    startBtn.addEventListener('touchend', onStartClick);
  }

  const restartBtn = document.getElementById('btn-restart');
  if (restartBtn) {
    restartBtn.addEventListener('click', resetGame);
    restartBtn.addEventListener('touchend', resetGame);
  }
}

export function initThree() {
  const container = document.getElementById('canvas-container');
  if (!container) return;

  scene = new THREE.Scene();
  if (typeof window !== 'undefined') {
    window.currentSceneRef = scene;
  }
  scene.background = new THREE.Color(0x7dd3fc);
  scene.fog = new THREE.FogExp2(0x7dd3fc, 0.0032);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0284c7, 0.95));
  dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight.position.set(30, 70, 25);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.left = -22;
  dirLight.shadow.camera.right = 22;
  dirLight.shadow.camera.top = 22;
  dirLight.shadow.camera.bottom = -22;
  dirLight.shadow.camera.near = 10;
  dirLight.shadow.camera.far = 135;
  dirLight.shadow.bias = -0.0006;
  scene.add(dirLight);
  scene.add(dirLight.target);

  initParticlePools(scene);
  buildWorld(scene);
  setupCharacters(scene, STAGES);
  setCharacterCallbacks(sound, updateHUD);
  setSystemCallbacks(sound, updateHUD, () => {
    placedPlankCount++;
    updateHUD();
    triggerScorePop();
  });

  for (let i = 0; i < 60; i++) manageBlockSpawns(scene, isGameOver);
  setupControls();
  applyGravityTopInset();

  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyGravityTopInset();
  });
}

let lastTime = performance.now();
let blockSpawnTimer = 0;
let cleanupTimer = 0;

export function animate(currentTime) {
  requestAnimationFrame(animate);
  const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
  lastTime = currentTime;

  const timeSec = currentTime * 0.001;

  if (seaTexture) {
    seaTexture.offset.y += dt * 0.012;
    seaTexture.offset.x += Math.sin(timeSec * 0.4) * 0.0003;
  }

  if (gameStarted && !isGameOver) {
    const moveDirX = input.active ? input.x : 0;
    const moveDirZ = input.active ? input.y : 0;

    const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
    const isHost = isMulti && window.NetworkManager.isHost;
    const isGuest = isMulti && !isHost;

    if (player) {
      updateSingleCharacter(scene, player, moveDirX, moveDirZ, dt, spawnPuffCloud, spawnSpeedStepRing);
      updateNameplatePosition(player);
    }

    for (let cIdx = 0; cIdx < characters.length; cIdx++) {
      const c = characters[cIdx];
      if (c === player || c.isPlayer) continue;

      const isHumanSlot = isMulti && window.NetworkManager && Array.isArray(window.NetworkManager.slots) &&
        window.NetworkManager.slots[cIdx] && !window.NetworkManager.slots[cIdx].isAI;

      const hasReceivedNetPos = Boolean(c.targetNetPos && isMulti);
      const isRemotePlayer = Boolean(c.isRemote || isHumanSlot || hasReceivedNetPos);

      if (hasReceivedNetPos && (!c.isRemote || c.isAI)) {
        c.isRemote = true;
        c.isAI = false;
      }

      const shouldRunAI = (!isMulti || isHost) && !isRemotePlayer && c.isAI === true && !c.targetNetPos;

      if (shouldRunAI) {
        updateAICharacter(scene, c, dt, spawnPuffCloud, spawnSpeedStepRing);
      } else if (c.targetNetPos) {
        const prevX = c.pos.x;
        const prevZ = c.pos.z;

        // リモート走者のローカル stunTimer の毎フレーム減算
        if (c.stunTimer > 0) {
          c.stunTimer -= dt;
          if (c.stunTimer <= 0) {
            c.stunTimer = 0;
            c.isStunned = false;
          }
        }

        // リモート走者の小人化タイマー減算 ＆ メッシュスケール連動
        if (c.shrinkTimer > 0) {
          c.shrinkTimer -= dt;
          if (c.shrinkTimer <= 0) {
            c.shrinkTimer = 0;
            c.isShrunk = false;
          }
        }
        const isRemoteShrunk = Boolean(c.isShrunk || (c.shrinkTimer && c.shrinkTimer > 0));
        const targetScale = isRemoteShrunk ? 0.42 : 1.0;
        c.meshObj.root.scale.set(targetScale, targetScale, targetScale);

        // ★【Phase 2 改善①】無敵時間中のキャラクター点滅同期
        if (c.invulnerableTimer > 0) {
          c.invulnerableTimer -= dt;
          if (c.invulnerableTimer <= 0) {
            c.invulnerableTimer = 0;
            c.isInvulnerable = false;
          }
        }
        const isInvuln = Boolean(c.isInvulnerable || (c.invulnerableTimer && c.invulnerableTimer > 0));
        if (isInvuln) {
          c.meshObj.root.visible = (Math.floor(currentTime / 90) % 2 === 0);
        } else {
          c.meshObj.root.visible = true;
        }

        const lerpFactor = Math.min(1.0, dt * 14.0);

        let predTargetX = c.targetNetPos.x;
        let predTargetZ = c.targetNetPos.z;

        if (c.netVelocity && (Math.abs(c.netVelocity.x) > 0.1 || Math.abs(c.netVelocity.z) > 0.1)) {
          const timeSincePacket = Math.min(0.12, (currentTime - (c.lastPacketTime || currentTime)) * 0.001);
          predTargetX += c.netVelocity.x * timeSincePacket * 0.5;
          predTargetZ += c.netVelocity.z * timeSincePacket * 0.5;
        }

        c.pos.x = THREE.MathUtils.lerp(c.pos.x, predTargetX, lerpFactor);
        c.pos.y = THREE.MathUtils.lerp(c.pos.y, c.targetNetPos.y, lerpFactor);
        c.pos.z = THREE.MathUtils.lerp(c.pos.z, predTargetZ, lerpFactor);
        c.meshObj.root.position.copy(c.pos);

        if (c.targetNetRotY !== undefined) {
          c.meshObj.root.rotation.y = THREE.MathUtils.lerp(c.meshObj.root.rotation.y, c.targetNetRotY, lerpFactor);
        }

        // リモート走者のアトラクション状態ビット（remoteActionState）とメッシュの連動
        const remState = c.remoteActionState || 'NORMAL';
        applyRemoteGimmickVisuals(c, remState, timeSec);

        const stepDist = Math.hypot(c.pos.x - prevX, c.pos.z - prevZ);

        // スピードブースト演出の同期（オーラ点灯 ＆ 煙パーティクル）
        if (c.meshObj.footAura) {
          if (c.speedBoostActive) {
            c.meshObj.footAura.visible = true;
            const auraPulse = 1.0 + Math.sin(currentTime * 0.008) * 0.12;
            c.meshObj.footAura.scale.set(auraPulse, auraPulse, auraPulse);
          } else {
            c.meshObj.footAura.visible = false;
          }
        }

        if (c.speedBoostActive && remState === 'NORMAL' && stepDist > 0.015) {
          c.puffTimer = (c.puffTimer || 0) + dt;
          if (c.puffTimer > 0.085) {
            c.puffTimer = 0;
            const backDist = 0.45;
            const rotY = (c.targetNetRotY !== undefined) ? c.targetNetRotY : c.meshObj.root.rotation.y;
            const puffX = c.pos.x - Math.sin(rotY) * backDist;
            const puffZ = c.pos.z - Math.cos(rotY) * backDist;
            spawnPuffCloud(puffX, c.pos.y, puffZ);
            spawnSpeedStepRing(c.pos.x, c.pos.y, c.pos.z);
          }
        }

        // ★【Phase 2 改善②】マグネット吸引オーラ（紫リング）の同期
        if (c.meshObj.magnetAura) {
          if (c.magnetActive) {
            c.meshObj.magnetAura.visible = true;
            const pulseT = (currentTime * 0.0032) % 1.0;
            const inwardScale = 2.6 * (1.0 - pulseT) + 0.35;
            c.meshObj.magnetAura.scale.set(inwardScale, inwardScale, inwardScale);
            c.meshObj.magnetAura.material.opacity = pulseT * 0.85;
          } else {
            c.meshObj.magnetAura.visible = false;
          }
        }

        // スタンやられ姿勢の同期（解除時の完全ニュートラル復帰）
        const isRemoteStunned = Boolean(c.isStunned || (c.stunTimer && c.stunTimer > 0));

        if (isRemoteStunned) {
          // 歩行を止め、ローカル同様のやられ振動と前傾を適用
          c.meshObj.root.rotation.z = Math.sin(currentTime * 0.02) * 0.4;
          c.meshObj.root.rotation.x = 0;
          c.meshObj.leftLeg.rotation.x = 0;
          c.meshObj.rightLeg.rotation.x = 0;
          c.meshObj.leftArm.rotation.x = 0;
          c.meshObj.rightArm.rotation.x = 0;
        } else if (remState === 'JUMP') {
          // ★【Phase 2 改善③】トランポリン大ジャンプ時の空中宙返り回転と手足オープン姿勢
          c.meshObj.root.rotation.z = 0;
          c.meshObj.root.rotation.x += dt * -12.5; // 空中前方回転
          c.meshObj.leftArm.rotation.z = -0.75;
          c.meshObj.rightArm.rotation.z = 0.75;
          c.meshObj.leftLeg.rotation.z = -0.30;
          c.meshObj.rightLeg.rotation.z = 0.30;
        } else {
          c.meshObj.root.rotation.z = 0;
          c.meshObj.root.rotation.x = (c.speedBoostActive && remState === 'NORMAL') ? 0.20 : 0;

          if (remState === 'NORMAL') {
            c.meshObj.leftArm.rotation.z = 0;
            c.meshObj.rightArm.rotation.z = 0;
            c.meshObj.leftLeg.rotation.z = 0;
            c.meshObj.rightLeg.rotation.z = 0;

            if (stepDist > 0.008) {
              const walkSpeedMult = c.speedBoostActive ? 1.75 : 1.0;
              c.walkCycle = (c.walkCycle || 0) + stepDist * 5.5 * walkSpeedMult;
              const swing = Math.sin(c.walkCycle) * 0.75;
              c.meshObj.leftLeg.rotation.x = swing;
              c.meshObj.rightLeg.rotation.x = -swing;
              c.meshObj.leftArm.rotation.x = -swing * 0.8;
              c.meshObj.rightArm.rotation.x = swing * 0.8;
            } else {
              c.meshObj.leftLeg.rotation.x = 0;
              c.meshObj.rightLeg.rotation.x = 0;
              c.meshObj.leftArm.rotation.x = 0;
              c.meshObj.rightArm.rotation.x = 0;
            }
          }
        }
      } else if (!c.targetNetPos) {
        c.meshObj.leftLeg.rotation.x = 0;
        c.meshObj.rightLeg.rotation.x = 0;
        c.meshObj.leftArm.rotation.x = 0;
        c.meshObj.rightArm.rotation.x = 0;
      }

      if (c.dockBounceTimer > 0) {
        c.dockBounceTimer -= dt;
        if (c.dockBounceTimer <= 0) {
          c.meshObj.stackGroup.scale.set(1.0, 1.0, 1.0);
        }
      }
      updateNameplatePosition(c);
    }

    handleTackles(scene);

    blockSpawnTimer += dt;
    if (blockSpawnTimer > 0.5) {
      if (!isGuest) {
        manageBlockSpawns(scene, isGameOver);
      }
      blockSpawnTimer = 0;
    }

    cleanupTimer += dt;
    if (cleanupTimer > 2.0) {
      cleanupOldData(scene);
      cleanupTimer = 0;
    }

    let maxStage = 0;
    for (let cIdx = 0; cIdx < characters.length; cIdx++) {
      if (characters[cIdx].currentStage > maxStage) {
        maxStage = characters[cIdx].currentStage;
      }
    }
    if (maxStage >= STAGES.length - 3) extendCourse(scene);

    // ★【Phase 2 改善④】タイマー減算とタイムアップのホスト主導化
    if (!isGuest) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        onTimeUp();
      }
    } else {
      // ゲスト端末はローカルでも微減算しつつ、ホストからの TIME_SYNC で定期補正
      if (timeLeft > 0) {
        timeLeft -= dt;
      }
    }
    updateTimerHUD();

    updateSceneEntities(scene, dt, timeSec, player, sound);
  }

  if (player && camera) {
    updateDynamicCamera(player, camera, dt, dirLight, seaMesh);
  }

  if (renderer && scene && camera) renderer.render(scene, camera);
}

export function bootGame() {
  if (window._gameEngineBooted) return;
  window._gameEngineBooted = true;
  try {
    const appContainer = document.getElementById('app-container') || document.body;
    if (!document.getElementById('canvas-container')) {
      mountAllUI(appContainer);
    }

    initThree();
    animate(performance.now());
  } catch (err) {
    console.error("Game boot failed:", err);
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  bootGame();
} else {
  document.addEventListener('DOMContentLoaded', bootGame);
  window.addEventListener('load', bootGame);
}