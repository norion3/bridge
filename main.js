// main.js: ゲーム全体の起動指揮・Three.js初期化・メインループ・入力・HUD制御・DM招待リンク自動入室
// ★ 確定仕様（DM招待Auto-Join ＆ GRAVITY公式スコア送信 ＆ スロット不変型ホスト昇格完全対応版）：
//   1. 【DM招待リンク起動時の完全直列自動入室（Auto-Join Pipeline）】
//      起動時に AgentSDK.room.getRoomId() を検知。招待 room_id が存在する場合、
//      ロビー画面（「1人で遊ぶ」「部屋作成」等）を完全スキップし、自動で joinRoom() をキックして
//      対象の3D対戦空間へ直接スポーン・合流。満員や解散時は安全にロビーへフォールバック。
//   2. 【GRAVITY公式ランキング（スコア送信）完全準拠】
//      window.parent.postMessage({ type: 'gameOver', score: placedPlankCount }, '*') による
//      公式仕様に100%準拠したスコア送信ハンドラ submitGravityScore() を維持。
//   3. 【ホスト昇格動的検知 ＆ リスタートボタン表示権限の自動追従】
//      animate ループ内で isHost の動的変化を監視し、昇格時に左下リセットボタンを確実に表示。
//   4. 【AI自律思考復帰の完全保証（硬直・フリーズ根絶フェイルセーフ）】
//      ホスト端末時、人間不搭乗のAIスロットの残存補間目標やリモートフラグを自動パージし、自律走行を100%継続。
//   5. 【スロット不変型リスタート時のカメラ初期位置最適化】
//      リスタート時、自キャラの現在座標に合わせてカメラ初期位置を整列。

import { mountAllUI, UIController, EntryShield } from './dom.js';

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
  seaMesh,
  floorBlocksByStage,
  floorItems,
  spawnItem
} from './world.js';
import {
  initParticlePools,
  spawnPuffCloud,
  spawnSpeedStepRing,
  floorBlockPool,
  resetParticlePools
} from './particles.js';
import {
  setSystemCallbacks,
  updateSingleCharacter,
  handleTackles
} from './systems.js';
import { updateAICharacter } from './ai.js';
import { updateDynamicCamera, resetCameraState } from './camera.js';
import { updateSceneEntities } from './entities.js';
import { applyRemoteGimmickVisuals, flushPendingBonusConsumes } from './gimmicks.js';
import { NetworkManager } from './network.js';

// network.js から相手のスタック数変化時に呼び出せるようグローバルフックを登録
if (typeof window !== 'undefined') {
  window.refreshRemoteStackVisuals = refreshCharacterStackVisuals;
}

// GRAVITY環境 / 通常ブラウザ（GitHub Pages）の自動判別スイッチ
export const IS_GRAVITY_APP = typeof window !== 'undefined' && !!window.AgentSDK;

// 将来のマルチプレイ同期用ステート（後方互換用）
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

// ホスト権限の動的変化を検知するための状態キャッシュ
let lastRecordedHostState = null;

/**
 * リスタートボタン（クイックリスタート＆結果モーダル）の表示権限更新関数
 * シングルプレイ、またはマルチのホストのみ表示し、ゲスト端末では完全に非表示にする
 */
export function updateRestartButtonVisibility() {
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = Boolean(isMulti && window.NetworkManager.isHost);

  const quickRestartBtn = document.getElementById('btn-restart-quick');
  if (quickRestartBtn) {
    if (!isMulti || isHost) {
      quickRestartBtn.style.setProperty('display', 'flex', 'important');
      quickRestartBtn.classList.remove('hidden');
    } else {
      quickRestartBtn.style.setProperty('display', 'none', 'important');
      quickRestartBtn.classList.add('hidden');
    }
  }

  const resultRestartBtn = document.getElementById('btn-restart');
  if (resultRestartBtn) {
    if (!isMulti || isHost) {
      resultRestartBtn.style.setProperty('display', 'block', 'important');
    } else {
      resultRestartBtn.style.setProperty('display', 'none', 'important');
    }
  }
}

if (typeof window !== 'undefined') {
  window.updateRestartButtonVisibility = updateRestartButtonVisibility;
}

/**
 * ★【GRAVITY公式仕様準拠】親アプリ（ネイティブ層）へスコアを送信
 * @param {number} score 確定した階段数（placedPlankCount）
 */
export function submitGravityScore(score) {
  const safeScore = Math.max(0, Math.floor(Number(score) || 0));
  try {
    if (typeof window !== 'undefined' && window.parent) {
      window.parent.postMessage({
        type: 'gameOver',
        score: safeScore
      }, '*');
      console.log(`[GravityScore] Score (${safeScore}) submitted successfully via postMessage.`);
    }
  } catch (err) {
    console.warn('[GravityScore] Failed to postMessage score to GRAVITY native:', err);
  }
}

if (typeof window !== 'undefined') {
  window.submitGravityScore = submitGravityScore;
}

/**
 * ホストから 10Hz POS パケット（tl キー）で届いた残り秒数を平滑同期
 */
export function applyRemoteTimeSync(remoteTimeLeft) {
  if (typeof remoteTimeLeft === 'number' && !isNaN(remoteTimeLeft)) {
    const diff = Math.abs(timeLeft - remoteTimeLeft);
    if (diff > 0.4) {
      if (diff > 2.0) {
        timeLeft = remoteTimeLeft;
      } else {
        timeLeft = THREE.MathUtils.lerp(timeLeft, remoteTimeLeft, 0.4);
      }
      updateTimerHUD(true);
    }
  }
}

/**
 * ホストからタイムアップ宣告を受信した際のハンドラ
 */
export function applyRemoteTimeUp() {
  if (!isGameOver) {
    timeLeft = 0;
    updateTimerHUD(true);
    onTimeUp();
  }
}

if (typeof window !== 'undefined') {
  window.getGameTimeLeft = () => timeLeft;
  window.applyRemoteTimeSync = applyRemoteTimeSync;
  window.applyRemoteTimeUp = applyRemoteTimeUp;
  
  // ホストからリスタート指示（シード＆スナップショット同封）を受信した際の連携ハンドラ
  window.onRemoteRestartReceived = (packet) => {
    if (packet && packet.seed) {
      resetGame(packet.seed, packet.snapshot);
    } else {
      resetGame();
    }
  };
}

/**
 * 外部（network.js / dom.js）からゲームループを確実に始動させる安全関数
 */
export function launchGameEngine() {
  gameStarted = true;
  isGameOver = false;
  if (sound) {
    sound.init();
  }
  updateRestartButtonVisibility();
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

  // 1. ホストであればタイムアップ宣告を同報
  if (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive && window.NetworkManager.isHost) {
    if (typeof window.NetworkManager.broadcastTimeUp === 'function') {
      window.NetworkManager.broadcastTimeUp();
    }
  }

  sound.playVictory();

  // 2. 結果モーダルへの段数反映
  const rankEl = document.getElementById('modal-rank');
  if (rankEl) rankEl.innerText = placedPlankCount + ' 段';
  const resultModal = document.getElementById('modal-result');
  if (resultModal) {
    resultModal.classList.remove('hidden');
    resultModal.style.display = 'flex';
  }
  updateRestartButtonVisibility();

  // 3. ★【GRAVITY公式仕様】親アプリへ自身の確定スコア（階段数）をpostMessage送信
  submitGravityScore(placedPlankCount);
}

/**
 * リスタート実行関数（新シード値およびスナップショットの完全同期反映）
 * @param {number|null} remoteSeed ホストから届いた新シード値（ゲスト受取時）
 * @param {Object|null} remoteSnapshot ホストから届いた初期島スナップショット（ブロック・アイテム・階段）
 */
export function resetGame(remoteSeed = null, remoteSnapshot = null) {
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

  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = Boolean(isMulti && window.NetworkManager.isHost);

  // 1. シード値の確定
  let targetSeed = remoteSeed;
  if (!targetSeed) {
    targetSeed = Math.floor(Math.random() * 90000000) + 10000000;
  }

  // 2. 新しいシード値で世界を完全再構築
  buildWorld(scene, targetSeed);
  resetCharacters(STAGES);

  // 3. 視点カメラの初期化（スロット不変型：自キャラの現在X座標に合わせてカメラ初期位置を整列）
  if (camera) {
    const focusX = (player && player.pos) ? player.pos.x : 0.0;
    camera.position.set(focusX, STAGES[0].y + 24, STAGES[0].z + 12);
    camera.lookAt(focusX, STAGES[0].y, STAGES[0].z - 5);
  }

  // 4. 世界状態の復元または新規補充
  if (!isHost && isMulti && remoteSnapshot) {
    // 【ゲスト端末】：ホストから届いたスナップショットのブロック・階段・アイテムを完全復元
    if (Array.isArray(remoteSnapshot.blocks)) {
      floorBlockPool.forEach(b => {
        b.active = false;
        b.mesh.visible = false;
        b.attracting = false;
      });
      if (floorBlocksByStage && typeof floorBlocksByStage.forEach === 'function') {
        floorBlocksByStage.forEach(bucket => { bucket.length = 0; });
      }

      remoteSnapshot.blocks.forEach(b => {
        if (typeof window.applyRemoteBlockSpawned === 'function') {
          window.applyRemoteBlockSpawned(b.stageIdx, b.poolIdx, b.x, b.y, b.z, b.teamId, b.blockId);
        }
      });
    }

    if (Array.isArray(remoteSnapshot.planks)) {
      remoteSnapshot.planks.forEach(p => {
        if (typeof window.applyRemotePlankBuilt === 'function') {
          window.applyRemotePlankBuilt(p.stageIdx, p.laneIdx, p.plankIdx, p.teamId);
        }
      });
    }

    if (Array.isArray(remoteSnapshot.items) && scene) {
      remoteSnapshot.items.forEach(si => {
        const existing = floorItems.find(li => li.active && (li.itemId === si.itemId || (li.stageIdx === si.stageIdx && li.type === si.type)));
        if (!existing) {
          spawnItem(scene, si.stageIdx, si.type);
        }
      });
    }
  } else {
    // 【ホスト端末またはシングルプレイ】：ローカルで初期ブロックを補充
    for (let i = 0; i < 30; i++) {
      manageBlockSpawns(scene, false);
    }

    // ホスト端末の場合は、確定した新シード値と初期配置スナップショットを1通に同封して送出
    if (isMulti && isHost && window.NetworkManager && typeof window.NetworkManager.broadcastRestartGame === 'function') {
      const snap = (typeof window.NetworkManager.captureWorldSnapshot === 'function')
        ? window.NetworkManager.captureWorldSnapshot()
        : null;
      window.NetworkManager.broadcastRestartGame(targetSeed, snap);
    }
  }

  updateHUD();
  updateTimerHUD(true);
  updateRestartButtonVisibility();
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
    restartBtn.addEventListener('click', () => resetGame());
    restartBtn.addEventListener('touchend', () => resetGame());
  }

  updateRestartButtonVisibility();
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
let courseCheckTimer = 0;

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
    const isHost = Boolean(isMulti && window.NetworkManager.isHost);
    const isGuest = Boolean(isMulti && !isHost);

    // ホスト昇格自動検知：ゲストからホストへの昇格時にリスタートボタン表示を即時更新
    if (lastRecordedHostState !== isHost) {
      lastRecordedHostState = isHost;
      updateRestartButtonVisibility();
    }

    if (player) {
      if (typeof window !== 'undefined') {
        window.localPlayerInstance = player;
      }
      updateSingleCharacter(scene, player, moveDirX, moveDirZ, dt, spawnPuffCloud, spawnSpeedStepRing);
      updateNameplatePosition(player);
    }

    for (let cIdx = 0; cIdx < characters.length; cIdx++) {
      const c = characters[cIdx];
      if (c === player || c.isPlayer) continue;

      const slotData = (isMulti && window.NetworkManager && Array.isArray(window.NetworkManager.slots))
        ? window.NetworkManager.slots[cIdx]
        : null;

      const isHumanSlot = isMulti && slotData && !slotData.isAI;
      const hasReceivedNetPos = Boolean(c.targetNetPos && isMulti);
      const isRemotePlayer = Boolean(c.isRemote || isHumanSlot || hasReceivedNetPos);

      // リモートフラグの昇格を毎フレーム確実に同期
      if ((hasReceivedNetPos || isHumanSlot) && (!c.isRemote || c.isAI)) {
        c.isRemote = true;
        c.isAI = false;
      }

      // AI自律復帰フェイルセーフ：ホスト時、人間不搭乗スロットの残存補間目標・リモートフラグをパージ
      if (isHost && slotData && slotData.isAI) {
        if (c.targetNetPos) {
          c.targetNetPos = null;
        }
        if (c.isRemote || !c.isAI) {
          c.isRemote = false;
          c.isAI = true;
        }
      }

      // ホスト上であっても、人間プレイヤー（あるいはパケット受信中の走者）に対する AI 思考は100%遮断
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

        // 無敵時間中のキャラクター点滅同期
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

        // 目標位置との3D距離乖離ガード ＆ 素直で滑らかなLerp追従
        const dist3DSq = (c.targetNetPos.x - c.pos.x) ** 2 + (c.targetNetPos.y - c.pos.y) ** 2 + (c.targetNetPos.z - c.pos.z) ** 2;

        if (dist3DSq > 25.0) {
          c.pos.copy(c.targetNetPos);
        } else {
          const lerpFactor = Math.min(1.0, dt * 14.0);
          c.pos.x = THREE.MathUtils.lerp(c.pos.x, c.targetNetPos.x, lerpFactor);
          c.pos.y = THREE.MathUtils.lerp(c.pos.y, c.targetNetPos.y, lerpFactor);
          c.pos.z = THREE.MathUtils.lerp(c.pos.z, c.targetNetPos.z, lerpFactor);
        }
        c.meshObj.root.position.copy(c.pos);

        if (c.targetNetRotY !== undefined) {
          c.meshObj.root.rotation.y = THREE.MathUtils.lerp(c.meshObj.root.rotation.y, c.targetNetRotY, Math.min(1.0, dt * 14.0));
        }

        const remState = c.remoteActionState || 'NORMAL';
        applyRemoteGimmickVisuals(c, remState, timeSec);

        const stepDist = Math.hypot(c.pos.x - prevX, c.pos.z - prevZ);
        const hasNetVelocity = c.netVelocity && (Math.abs(c.netVelocity.x) > 0.08 || Math.abs(c.netVelocity.z) > 0.08);

        // スピードブースト演出の同期
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

        // マグネット吸引オーラ（紫リング）の同期
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

        const isRemoteStunned = Boolean(c.isStunned || (c.stunTimer && c.stunTimer > 0));

        if (isRemoteStunned) {
          c.meshObj.root.rotation.z = Math.sin(currentTime * 0.02) * 0.4;
          c.meshObj.root.rotation.x = 0;
          c.meshObj.leftLeg.rotation.x = 0;
          c.meshObj.rightLeg.rotation.x = 0;
          c.meshObj.leftArm.rotation.x = 0;
          c.meshObj.rightArm.rotation.x = 0;
        } else if (remState === 'JUMP') {
          c.meshObj.root.rotation.z = 0;
          c.meshObj.root.rotation.x += dt * -12.5;
          c.meshObj.leftArm.rotation.z = -0.75;
          c.meshObj.rightArm.rotation.z = 0.75;
          c.meshObj.leftLeg.rotation.z = -0.30;
          c.meshObj.rightLeg.rotation.z = 0.30;
        } else if (remState === 'NORMAL') {
          c.meshObj.root.rotation.z = 0;
          c.meshObj.root.rotation.x = (c.speedBoostActive) ? 0.20 : 0;

          c.meshObj.leftArm.rotation.z = 0;
          c.meshObj.rightArm.rotation.z = 0;
          c.meshObj.leftLeg.rotation.z = 0;
          c.meshObj.rightLeg.rotation.z = 0;

          c.meshObj.body.position.y = 0.65;
          c.meshObj.head.position.y = 1.25;

          if (stepDist > 0.005 || hasNetVelocity) {
            const walkSpeedMult = c.speedBoostActive ? 1.75 : 1.0;
            const effectiveStep = Math.max(stepDist, dt * 1.8);
            c.walkCycle = (c.walkCycle || 0) + effectiveStep * 5.5 * walkSpeedMult;
            const swing = Math.sin(c.walkCycle) * 0.75;
            c.meshObj.leftLeg.rotation.x = swing;
            c.meshObj.rightLeg.rotation.x = -swing;
            c.meshObj.leftArm.rotation.x = -swing * 0.8;
            c.meshObj.rightArm.rotation.x = swing * 0.8;
          } else {
            c.meshObj.leftLeg.rotation.x = THREE.MathUtils.lerp(c.meshObj.leftLeg.rotation.x, 0, 0.2);
            c.meshObj.rightLeg.rotation.x = THREE.MathUtils.lerp(c.meshObj.rightLeg.rotation.x, 0, 0.2);
            c.meshObj.leftArm.rotation.x = THREE.MathUtils.lerp(c.meshObj.leftArm.rotation.x, 0, 0.2);
            c.meshObj.rightArm.rotation.x = THREE.MathUtils.lerp(c.meshObj.rightArm.rotation.x, 0, 0.2);
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

    // 先行AIの進行に合わせた確実なステージ伸長 ＆ 保留ボーナス消去の即時適用
    courseCheckTimer += dt;
    if (courseCheckTimer > 0.25) {
      courseCheckTimer = 0;
      let maxStage = 0;
      for (let cIdx = 0; cIdx < characters.length; cIdx++) {
        const charStage = characters[cIdx].currentStage || 0;
        if (charStage > maxStage) {
          maxStage = charStage;
        }
      }
      if (maxStage >= STAGES.length - 4) {
        extendCourse(scene);
        flushPendingBonusConsumes();
      }
    }

    // タイマー減算とタイムアップのホスト主導化
    if (!isGuest) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        onTimeUp();
      }
    } else {
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

/**
 * ★【核心】DM招待リンク経由の自動入室判定（Auto-Join Pipeline）
 * 公式仕様: AgentSDK.room.getRoomId() が有効な room_id を返した場合、
 * ロビー画面をスキップして直接対象ルームへ joinRoom() をキックし、ゲーム画面へ合流。
 */
async function checkAndHandleAutoJoin() {
  if (typeof window === 'undefined') return;

  try {
    // 1. 初期シールドを展開（ロビーは裏で初期スタイル非表示のまま待機）
    if (typeof EntryShield !== 'undefined' && EntryShield.show) {
      EntryShield.show('CONNECTING...', 'ルームへ合流中...');
    }

    // 2. ユーザープロファイル取得 ＆ 認証セッション完全確立（必須）
    if (window.NetworkManager && typeof window.NetworkManager.init === 'function') {
      await window.NetworkManager.init();
    }

    // 3. ネイティブ層からディープリンクパラメータ（room_id）を取得
    let targetRoomId = '';
    if (window.AgentSDK && window.AgentSDK.room && typeof window.AgentSDK.room.getRoomId === 'function') {
      const res = await window.AgentSDK.room.getRoomId();
      targetRoomId = (res && typeof res.room_id === 'string')
        ? res.room_id
        : (res && res.data && typeof res.data.room_id === 'string' ? res.data.room_id : '');
    }

    // 4. 招待 room_id が存在する場合のみ自動合流を実行
    if (targetRoomId && targetRoomId !== '') {
      const shortId = targetRoomId.length > 5 ? targetRoomId.slice(-5) : targetRoomId;
      console.log(`[AutoJoin] DM招待リンクを検知: Room #${targetRoomId} へ自動入室します`);

      if (typeof EntryShield !== 'undefined' && EntryShield.update) {
        EntryShield.update(`ROOM #${shortId}`, 'ルームへ合流中...');
      }

      // ゲームエンジンを即時始動
      launchGameEngine();

      if (window.NetworkManager && typeof window.NetworkManager.joinRoom === 'function') {
        const success = await window.NetworkManager.joinRoom(targetRoomId);
        if (success) {
          // 入室成功: シールドを滑らかに解除して3D対戦フィールドへ直接着地
          setTimeout(() => {
            if (typeof EntryShield !== 'undefined' && EntryShield.hide) {
              EntryShield.hide();
            }
          }, 350);
        } else {
          console.warn('[AutoJoin] 自動入室に失敗しました（満員・解散など）。ロビー画面へ戻します。');
          if (typeof EntryShield !== 'undefined' && EntryShield.hide) {
            EntryShield.hide();
          }
          if (typeof UIController !== 'undefined' && typeof UIController.showLobby === 'function') {
            UIController.showLobby();
          } else if (window.UIController && typeof window.UIController.showLobby === 'function') {
            window.UIController.showLobby();
          }
        }
      } else {
        if (typeof EntryShield !== 'undefined' && EntryShield.hide) EntryShield.hide();
        if (typeof UIController !== 'undefined' && typeof UIController.showLobby === 'function') UIController.showLobby();
      }
    } else {
      console.log('[AutoJoin] 通常起動のためロビー待機');
      // 通常起動: シールドを即座に解除し、通常ロビー画面を表示
      if (typeof EntryShield !== 'undefined' && EntryShield.hide) {
        EntryShield.hide();
      }
      if (typeof UIController !== 'undefined' && typeof UIController.showLobby === 'function') {
        UIController.showLobby();
      } else if (window.UIController && typeof window.UIController.showLobby === 'function') {
        window.UIController.showLobby();
      }
    }
  } catch (err) {
    console.warn('[AutoJoin] 自動入室判定エラー:', err);
    if (typeof EntryShield !== 'undefined' && EntryShield.hide) {
      EntryShield.hide();
    }
    if (typeof UIController !== 'undefined' && typeof UIController.showLobby === 'function') {
      UIController.showLobby();
    } else if (window.UIController && typeof window.UIController.showLobby === 'function') {
      window.UIController.showLobby();
    }
  }
}

export function bootGame() {
  if (window._gameEngineBooted) return;
  window._gameEngineBooted = true;
  try {
    const appContainer = document.getElementById('app-container') || document.body;
    if (!document.getElementById('canvas-container')) {
      mountAllUI(appContainer);
    }

    // 起動直後にシールドを展開し、FOUCを完全遮断
    if (typeof EntryShield !== 'undefined' && EntryShield.show) {
      EntryShield.show('CONNECTING...', 'ルームへ合流中...');
    }

    initThree();
    animate(performance.now());

    // Three.js 初期化完了後、直列にDM招待リンク自動合流を判定
    checkAndHandleAutoJoin();
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