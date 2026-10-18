// メインエントリポイント：Three.js初期化・ダイナミックロックオン並走カメラ（完全連続滑らかLERP追従・カクつきゼロ）・メインループ・ネームプレート連動・スコアMicro-Pop＆30秒タイマー色変化・左下リスタート＆GRAVITY動的余白骨組み対応
import { SoundEngine } from './audio.js';
import {
  TEAMS,
  ELEVATOR_CONFIG,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import {
  sharedMats,
  _tempVec3A,
  _tempVec3B,
  disposeHierarchy,
  seaTexture,
  lightningPillarGeo
} from './materials.js';
import {
  player,
  characters,
  setupCharacters,
  resetCharacters,
  setCharacterCallbacks,
  addBrickToCharacter,
  updateNameplatePosition
} from './character.js';

import {
  STAGES,
  CONNECTIONS,
  bridges,
  buildWorld,
  cleanupOldData,
  manageBlockSpawns,
  extendCourse,
  floorItems,
  curvedSlideBonusBlocks,
  ziplineBonusBlocks,
  skydiveBonusBlocks,
  slideBonusBlocks,
  activeMagnetBlocks,
  cloudObjects,
  seaMesh,
  attackCamTimer,
  decrementAttackCamTimer,
  incMagnetDockStep
} from './world.js';
import {
  initParticlePools,
  puffCloudPool,
  speedStepRingPool,
  shockwavePool,
  projectilePool,
  thunderProjectilePool,
  drainBlockPool,
  spawnPuffCloud,
  spawnSpeedStepRing,
  triggerLandingShockwave
} from './particles.js';
import {
  setSystemCallbacks,
  updateSingleCharacter,
  handleTackles,
  scatterBricks
} from './systems.js';
import { updateAICharacter } from './ai.js';

// ★ GRAVITY環境 / 通常ブラウザ（GitHub Pages）の自動判別スイッチ（骨組み）
export const IS_GRAVITY_APP = typeof window !== 'undefined' && !!window.AgentSDK;

// ★ 将来のマルチプレイ同期用ステート（GitHub上では本人がホストのシングルプレイとして常時稼働）
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

let trapdoorLandingRecoveryTimer = 0;
let wasTrapdoorLastFrame = false;

// ★ 階段スコア連続加算アンチシェイク（Micro-Pop & Scale Clamp）用タイマー・タイムスタンプ
let scorePopTimer = null;
let lastPlankPlacedTime = 0;

const input = { x: 0, y: 0, active: false };

// ★ GRAVITY環境の上部立ち入り禁止エリア動的オフセット（SDK存在時は74/98px、GitHub時は広々レイアウト）
export function applyGravityTopInset() {
  const hudContainer = document.getElementById('hud-top-container');
  if (!hudContainer) return;

  if (IS_GRAVITY_APP) {
    const isTall = window.innerHeight >= 812;
    const topInset = isTall ? 98 : 74;
    hudContainer.style.paddingTop = `${topInset + 8}px`;
  } else {
    hudContainer.style.paddingTop = ''; // CSS の safe-top-padding をそのまま使用
  }
}

// ★ 階段スコアの小気味よいポップ演出（連続設置でも数字が激しく揺れず見やすい設計）
export function triggerScorePop() {
  const scoreEl = document.getElementById('hud-score');
  if (!scoreEl) return;

  const now = performance.now();
  const timeSinceLast = now - lastPlankPlacedTime;
  lastPlankPlacedTime = now;

  if (scorePopTimer) {
    clearTimeout(scorePopTimer);
  }

  // 連続設置時（直前の設置から140ms以内）は多重拡大を防止し、最大1.15倍でクランプ
  if (timeSinceLast < 140) {
    scoreEl.classList.remove('score-pop');
    scoreEl.classList.add('score-clamped');
  } else {
    scoreEl.classList.remove('score-clamped');
    scoreEl.classList.add('score-pop');
  }

  // 設置が止まってから140ms後にスッと滑らかに等倍（1.0倍）へ戻す
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

// ★ 残り30秒で文字色をネオンレッドへ切り替え、心拍のようなパルス演出を開始
export function updateTimerHUD(force = false) {
  const currentSecInt = Math.floor(timeLeft);
  if (!force && currentSecInt === lastDisplayedSec) return;
  lastDisplayedSec = currentSecInt;
  const min = Math.floor(currentSecInt / 60).toString().padStart(2, '0');
  const sec = (currentSecInt % 60).toString().padStart(2, '0');
  const timerEl = document.getElementById('hud-timer');
  if (timerEl) {
    timerEl.innerText = `${min}:${sec}`;

    // 残り30秒以下で鮮やかな警告レッドに切り替え＆微細パルス
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
  trapdoorLandingRecoveryTimer = 0;
  wasTrapdoorLastFrame = false;

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

  // ★ 左下リスタートボタン（GitHub上ではF5リロード不要で即時リトライ可能！）
  const quickRestartBtn = document.getElementById('btn-restart-quick');
  if (quickRestartBtn) {
    // 権限制御の骨組み：ホストまたはシングルプレイ時は表示
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
    gameStarted = true;
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
    triggerScorePop(); // ★ 階段設置時にフォントのMicro-Pop演出を起動
  });

  for (let i = 0; i < 60; i++) manageBlockSpawns(scene, isGameOver);
  setupControls();
  applyGravityTopInset(); // ★ 初期表示時の動的トップインセット適用

  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyGravityTopInset(); // リサイズ時も安全にインセット更新
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

    if (player) {
      updateSingleCharacter(scene, player, moveDirX, moveDirZ, dt, spawnPuffCloud, spawnSpeedStepRing);
    }
    for (let cIdx = 0; cIdx < characters.length; cIdx++) {
      const c = characters[cIdx];
      if (!c.isPlayer) {
        updateAICharacter(scene, c, dt, spawnPuffCloud, spawnSpeedStepRing);
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
      manageBlockSpawns(scene, isGameOver);
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

    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      onTimeUp();
    }
    updateTimerHUD();

    const playerZ = player ? player.pos.z : 0;

    floorItems.forEach(item => {
      if (item.active && item.group) {
        if (Math.abs(item.pos.z - playerZ) > 95) return;
        if (item.crystal) {
          item.crystal.rotation.y = timeSec * 3.2;
          item.crystal.rotation.z = Math.sin(timeSec * 2.5) * 0.25;
          if (item.type !== 'magnet') {
            item.crystal.position.y = 1.35 + Math.sin(timeSec * 4.5 + item.stageIdx) * 0.35;
          } else {
            item.crystal.position.y = 1.15 + Math.sin(timeSec * 4.5 + item.stageIdx) * 0.35;
          }
        }
        if (item.beaconRing) {
          const pulse = 1.0 + Math.sin(timeSec * 5.0) * 0.25;
          item.beaconRing.scale.set(pulse, pulse, pulse);
        }
      }
    });

    for (let i = 0; i < projectilePool.length; i++) {
      const p = projectilePool[i];
      if (!p.active) continue;

      p.progress += dt / p.duration;

      if (p.target) {
        p.targetPos.copy(p.target.pos);
        p.targetPos.y += 1.0;

        if (p.reticle) {
          p.reticle.position.set(p.target.pos.x, p.target.pos.y + 0.08, p.target.pos.z);
          const pulseScale = 1.0 + Math.sin(timeSec * 22) * 0.25;
          p.reticle.scale.set(pulseScale, pulseScale, pulseScale);
        }
      }

      const t = Math.min(1.0, p.progress);
      _tempVec3A.lerpVectors(p.startPos, p.targetPos, t);
      _tempVec3A.y += Math.sin(t * Math.PI) * 8.5;
      p.group.position.copy(_tempVec3A);

      if (p.crystal) {
        p.crystal.rotation.x += dt * 24;
        p.crystal.rotation.y += dt * 32;
      }
      if (p.ring1) p.ring1.rotation.z += dt * 18;
      if (p.ring2) p.ring2.rotation.y += dt * 22;

      if (p.history && p.history.length > 0) {
        const recycledVec = p.history.pop();
        recycledVec.copy(_tempVec3A);
        p.history.unshift(recycledVec);
      }

      if (p.trailSpheres) {
        for (let j = 0; j < p.trailSpheres.length; j++) {
          const item = p.trailSpheres[j];
          const histIdx = Math.min(p.history.length - 1, item.historyOffset);
          if (p.history[histIdx]) {
            item.mesh.position.copy(p.history[histIdx]);
            item.mesh.visible = true;
            const lifeFade = 1.0 - (j / p.trailSpheres.length);
            item.material.opacity = (1.0 - t * 0.15) * lifeFade * 0.95;
          }
        }
      }

      if (p.progress >= 1.0) {
        sound.playAttackHit();

        triggerLandingShockwave(p.targetPos.x, p.targetPos.y - 0.8, p.targetPos.z, 4.5, 0xf43f5e);

        if (p.reticle) p.reticle.visible = false;

        if (p.target) {
          p.target.stunTimer = 1.4;
          p.target.meshObj.root.rotation.x = 0.55;
          scatterBricks(scene, p.target, 3);

          const drainCount = 4;
          let spawned = 0;
          for (let d = 0; d < drainBlockPool.length && spawned < drainCount; d++) {
            const db = drainBlockPool[d];
            if (!db.active) {
              db.active = true;
              db.targetChar = p.shooter;
              db.index = spawned;
              db.delay = spawned * 0.08;
              db.progress = 0;
              db.duration = 0.80;

              if (p.shooter && p.shooter.team && p.shooter.team.id === 'blue') {
                db.mesh.material = sharedMats.blockBlue;
              } else if (p.shooter && p.shooter.team && p.shooter.team.id === 'red') {
                db.mesh.material = sharedMats.blockRed;
              } else if (p.shooter && p.shooter.team && p.shooter.team.id === 'yellow') {
                db.mesh.material = sharedMats.blockYellow;
              } else {
                db.mesh.material = sharedMats.blockNeutral;
              }

              const sOffset = _tempVec3B.set(
                (Math.random() - 0.5) * 1.2,
                1.2 + Math.random() * 0.8,
                (Math.random() - 0.5) * 1.2
              );
              db.startPos.copy(p.target.pos).add(sOffset);
              db.mesh.position.copy(db.startPos);
              db.mesh.scale.set(1.3, 1.3, 1.3);
              db.mesh.visible = true;
              spawned++;
            }
          }
        }

        p.active = false;
        p.group.visible = false;
        if (p.trailSpheres) {
          for (let j = 0; j < p.trailSpheres.length; j++) {
            p.trailSpheres[j].mesh.visible = false;
          }
        }
      }
    }

    for (let i = 0; i < thunderProjectilePool.length; i++) {
      const tp = thunderProjectilePool[i];
      if (!tp.active) continue;

      tp.progress += dt / tp.duration;

      if (tp.target) {
        tp.targetPos.copy(tp.target.pos);
        tp.targetPos.y += 1.0;

        if (tp.reticle) {
          tp.reticle.position.set(tp.target.pos.x, tp.target.pos.y + 0.08, tp.target.pos.z);
          const pulseScale = 1.0 + Math.sin(timeSec * 22) * 0.25;
          tp.reticle.scale.set(pulseScale, pulseScale, pulseScale);
        }
      }

      const t = Math.min(1.0, tp.progress);
      _tempVec3A.lerpVectors(tp.startPos, tp.targetPos, t);
      _tempVec3A.y += Math.sin(t * Math.PI) * 8.5;
      tp.group.position.copy(_tempVec3A);

      if (tp.sphere) {
        tp.sphere.rotation.x += dt * 20;
        tp.sphere.rotation.y += dt * 28;
      }
      if (tp.ring1) tp.ring1.rotation.z += dt * 18;
      if (tp.ring2) tp.ring2.rotation.y += dt * 22;

      if (tp.history && tp.history.length > 0) {
        const recycledVec = tp.history.pop();
        recycledVec.copy(_tempVec3A);
        tp.history.unshift(recycledVec);
      }

      if (tp.trailSpheres) {
        for (let j = 0; j < tp.trailSpheres.length; j++) {
          const item = tp.trailSpheres[j];
          const histIdx = Math.min(tp.history.length - 1, item.historyOffset);
          if (tp.history[histIdx]) {
            item.mesh.position.copy(tp.history[histIdx]);
            item.mesh.visible = true;
            const lifeFade = 1.0 - (j / tp.trailSpheres.length);
            item.material.opacity = (1.0 - t * 0.15) * lifeFade * 0.95;
          }
        }
      }

      if (tp.progress >= 1.0) {
        sound.playThunderStrike();

        triggerLandingShockwave(tp.targetPos.x, tp.targetPos.y - 0.8, tp.targetPos.z, 3.2, 0xfacc15);

        if (tp.reticle) tp.reticle.visible = false;

        const boltMesh = new THREE.Mesh(lightningPillarGeo, sharedMats.lightningBolt);
        boltMesh.position.set(tp.targetPos.x, tp.targetPos.y + 13.0, tp.targetPos.z);
        scene.add(boltMesh);
        setTimeout(() => {
          try { scene.remove(boltMesh); } catch (e) {}
        }, 130);

        if (tp.target) {
          tp.target.shrinkTimer = 5.5;
          tp.target.stunTimer = 1.0;
          tp.target.meshObj.root.rotation.x = 0.45;
          scatterBricks(scene, tp.target, 2);

          const drainCount = 4;
          let spawned = 0;
          for (let d = 0; d < drainBlockPool.length && spawned < drainCount; d++) {
            const db = drainBlockPool[d];
            if (!db.active) {
              db.active = true;
              db.targetChar = tp.shooter;
              db.index = spawned;
              db.delay = spawned * 0.08;
              db.progress = 0;
              db.duration = 0.80;

              if (tp.shooter && tp.shooter.team && tp.shooter.team.id === 'blue') {
                db.mesh.material = sharedMats.blockBlue;
              } else if (tp.shooter && tp.shooter.team && tp.shooter.team.id === 'red') {
                db.mesh.material = sharedMats.blockRed;
              } else if (tp.shooter && tp.shooter.team && tp.shooter.team.id === 'yellow') {
                db.mesh.material = sharedMats.blockYellow;
              } else {
                db.mesh.material = sharedMats.blockNeutral;
              }

              const sOffset = _tempVec3B.set(
                (Math.random() - 0.5) * 1.2,
                1.2 + Math.random() * 0.8,
                (Math.random() - 0.5) * 1.2
              );
              db.startPos.copy(tp.target.pos).add(sOffset);
              db.mesh.position.copy(db.startPos);
              db.mesh.scale.set(1.3, 1.3, 1.3);
              db.mesh.visible = true;
              spawned++;
            }
          }
        }

        tp.active = false;
        tp.group.visible = false;
        if (tp.trailSpheres) {
          for (let j = 0; j < tp.trailSpheres.length; j++) {
            tp.trailSpheres[j].mesh.visible = false;
          }
        }
      }
    }

    for (let i = 0; i < drainBlockPool.length; i++) {
      const d = drainBlockPool[i];
      if (!d.active) continue;

      if (d.delay > 0) {
        d.delay -= dt;
        continue;
      }
      d.progress += dt / d.duration;
      const prog = Math.min(1.0, d.progress);

      _tempVec3A.copy(d.targetChar.pos);
      _tempVec3A.y += 1.4;
      _tempVec3A.z += 0.2;

      const easeT = prog * prog * (3 - 2 * prog);
      _tempVec3B.lerpVectors(d.startPos, _tempVec3A, easeT);
      _tempVec3B.y += Math.sin(prog * Math.PI) * 4.2;
      d.mesh.position.copy(_tempVec3B);

      const flightScale = 1.0 + Math.sin(prog * Math.PI) * 0.35;
      d.mesh.scale.set(flightScale, flightScale, flightScale);
      d.mesh.rotation.y += dt * 14;
      d.mesh.rotation.x += dt * 10;

      if (d.progress >= 1.0) {
        addBrickToCharacter(d.targetChar, d.targetChar.team, 1);
        if (d.targetChar.isPlayer) {
          sound.playDrainCollect(d.index || 0);
          triggerLandingShockwave(_tempVec3A.x, _tempVec3A.y, _tempVec3A.z, 1.0, 0x0284c7);
        }
        d.active = false;
        d.mesh.visible = false;
      }
    }

    for (let i = activeMagnetBlocks.length - 1; i >= 0; i--) {
      const mb = activeMagnetBlocks[i];
      const flightDuration = Math.max(mb.duration || 0.36, 0.55);
      mb.progress += dt / flightDuration;
      const prog = Math.min(1.0, mb.progress);

      _tempVec3A.copy(mb.targetChar.pos);
      const stackH = Math.min(mb.targetChar.stackCount * 0.22, 3.2);
      _tempVec3A.y += 0.85 + stackH;
      _tempVec3A.z -= 0.35;

      const easeT = prog * prog * (3 - 2 * prog);
      _tempVec3B.lerpVectors(mb.startPos, _tempVec3A, easeT);
      _tempVec3B.y += Math.sin(prog * Math.PI) * 3.2;
      mb.mesh.position.copy(_tempVec3B);

      const pulseScale = 1.0 + Math.sin(prog * Math.PI) * 0.28;
      mb.mesh.scale.set(pulseScale, pulseScale, pulseScale);
      mb.mesh.rotation.y += dt * 12;
      mb.mesh.rotation.x += dt * 9;

      if (mb.progress >= 1.0) {
        addBrickToCharacter(mb.targetChar, mb.targetChar.team, 1);
        if (mb.targetChar.isPlayer) {
          sound.playMagnetDock(incMagnetDockStep());
          triggerLandingShockwave(_tempVec3A.x, _tempVec3A.y, _tempVec3A.z, 0.95, 0xa855f7);
        }
        mb.targetChar.dockBounceTimer = 0.085;
        mb.targetChar.meshObj.stackGroup.scale.set(1.10, 1.15, 1.10);

        if (mb.poolItem) {
          mb.poolItem.active = false;
          mb.poolItem.mesh.visible = false;
          mb.poolItem.attracting = false;
        }

        activeMagnetBlocks.splice(i, 1);
      }
    }

    for (let i = 0; i < puffCloudPool.length; i++) {
      const puff = puffCloudPool[i];
      if (!puff.active) continue;
      puff.life += dt;
      const prog = puff.life / puff.maxLife;
      if (prog >= 1.0) {
        puff.active = false;
        puff.mesh.visible = false;
      } else {
        const currentScale = puff.initScale * (1.0 - prog * 0.85);
        puff.mesh.scale.set(currentScale, currentScale, currentScale);
        puff.mesh.position.y += dt * 0.45;
      }
    }

    for (let i = 0; i < speedStepRingPool.length; i++) {
      const sRing = speedStepRingPool[i];
      if (!sRing.active) continue;
      sRing.life += dt;
      const prog = sRing.life / sRing.maxLife;
      if (prog >= 1.0) {
        sRing.active = false;
        sRing.mesh.visible = false;
      } else {
        sRing.scale += dt * 3.4;
        sRing.mesh.scale.set(sRing.scale, sRing.scale, sRing.scale);
        sRing.mesh.material.opacity = (1.0 - prog) * 0.75;
      }
    }

    curvedSlideBonusBlocks.forEach(blk => {
      if (!blk.collected && blk.mesh) {
        if (Math.abs(blk.mesh.position.z - playerZ) > 95) return;
        blk.mesh.rotation.y = timeSec * 2.8 + blk.t * 4.0;
      }
    });

    ziplineBonusBlocks.forEach(blk => {
      if (!blk.collected && blk.mesh) {
        if (Math.abs(blk.mesh.position.z - playerZ) > 95) return;
        blk.mesh.rotation.y = timeSec * 3.2 + blk.t * 4.5;
        blk.mesh.position.y = blk.baseY + Math.sin(timeSec * 3.5 + blk.zi) * 0.14;
      }
    });

    skydiveBonusBlocks.forEach(blk => {
      if (!blk.collected && blk.mesh) {
        if (Math.abs(blk.mesh.position.z - playerZ) > 95) return;
        blk.mesh.rotation.y = timeSec * 3.2 + blk.t * 4.0;
        blk.mesh.position.y = blk.baseY + Math.sin(timeSec * 3.0 + blk.si) * 0.12;
      }
    });

    slideBonusBlocks.forEach(blk => {
      if (!blk.collected && blk.mesh) {
        if (Math.abs(blk.mesh.position.z - playerZ) > 95) return;
        blk.mesh.rotation.y = timeSec * 2.8 + blk.prog * 3.0;
      }
    });

    cloudObjects.forEach(c => {
      if (Math.abs(c.mesh.position.z - playerZ) > 115) return;
      c.mesh.position.y = c.baseY + Math.sin(timeSec + c.offset) * 0.4;
      c.mesh.rotation.y = Math.sin(timeSec * 0.3 + c.offset) * 0.08;
    });

    for (let i = 0; i < shockwavePool.length; i++) {
      const sw = shockwavePool[i];
      if (!sw.active) continue;
      sw.life += dt;
      const growRate = (sw.targetRadiusScale || 1.0) * 6.5;
      sw.scale += dt * growRate;
      sw.mesh.scale.set(sw.scale, sw.scale, sw.scale);
      sw.mesh.material.opacity = Math.max(0, 0.9 - sw.life * 2.2);
      if (sw.life > 0.45) {
        sw.active = false;
        sw.mesh.visible = false;
      }
    }
  }

  if (player && camera) {
    if (dirLight) {
      dirLight.position.set(player.pos.x + 30, player.pos.y + 70, player.pos.z + 25);
      dirLight.target.position.set(player.pos.x, player.pos.y, player.pos.z);
    }

    const currentStageObj = STAGES[player.currentStage];
    const nextConn = CONNECTIONS.find(c => c.from === player.currentStage);
    const isVerticalClimb = (nextConn && nextConn.type === 'vertical' && player.pos.z < (currentStageObj ? currentStageObj.z - currentStageObj.r * 0.8 : 0));
    const isSlideRiding = player.onSlide;
    const isCurvedRiding = player.onCurvedSlide;
    const isZiplining = player.onZipline;
    const isElevator = player.onElevator;
    const isJumping = player.isJumping;
    const isSkydive = player.onSkydive;
    const isTrapdoor = (player.onTrapdoor || player.onFreefall);

    if (wasTrapdoorLastFrame && !isTrapdoor) {
      trapdoorLandingRecoveryTimer = 1.2;
    }
    wasTrapdoorLastFrame = isTrapdoor;

    if (trapdoorLandingRecoveryTimer > 0) {
      trapdoorLandingRecoveryTimer = Math.max(0, trapdoorLandingRecoveryTimer - dt);
    }

    const isApproachingTrapdoor = (() => {
      if (isTrapdoor) return null;
      const localTrapB = bridges.find(b => b.isTrapdoor && b.stageIdx === player.currentStage);
      if (localTrapB) {
        const approachStart = localTrapB.approachStartZ !== undefined ? localTrapB.approachStartZ : (localTrapB.startZ + 14.0);
        const hatchX = localTrapB.hatchCenter ? localTrapB.hatchCenter.x : (currentStageObj ? (currentStageObj.x || 0.0) : 0.0);
        if (player.pos.z <= approachStart + 0.8 && player.pos.z >= localTrapB.startZ - 1.8 && Math.abs(player.pos.x - hatchX) < 2.5) {
          return localTrapB;
        }
      }
      return null;
    })();

    const stackLift = Math.min((player.stackCount || 0) * 0.08, 3.2);

    // ★ 境界による if/else を完全撤廃し、連続的でシルクのように滑らかな追従（カクつきゼロ）
    let targetCamX = player.pos.x * 0.75;
    let targetCamY = player.pos.y + 24 + stackLift;
    let targetCamZ = player.pos.z + 12 + (stackLift * 0.6);
    let targetLookX = player.pos.x * 0.65;
    let targetLookY = player.pos.y + (stackLift * 0.3);
    let targetLookAheadZ = player.pos.z - 5;
    let targetFOV = player.speedBoostActive ? 65 : 60;

    if (attackCamTimer > 0) {
      decrementAttackCamTimer(dt);
      targetCamZ += 3.5;
      targetCamY += 2.0;
      targetFOV = 68;
    }

    if (isJumping && player.activeJumpTier) {
      const jTier = player.activeJumpTier;
      const t = player.jumpProgress;
      if (jTier.id === 'mega') {
        targetCamY = player.pos.y + 14;
        targetCamZ = player.pos.z + 16;
        targetLookY = player.pos.y - 6;
        targetLookAheadZ = player.pos.z - 30;
        targetFOV = 60 + Math.sin(t * Math.PI) * 18;
      } else if (jTier.id === 'high') {
        targetCamY = player.pos.y + 18;
        targetCamZ = player.pos.z + 14;
        targetLookY = player.pos.y - 2;
        targetLookAheadZ = player.pos.z - 18;
        targetFOV = 60 + Math.sin(t * Math.PI) * 6;
      } else {
        targetCamY = player.pos.y + 20;
        targetCamZ = player.pos.z + 12;
        targetFOV = 60;
      }
    } else if (isVerticalClimb) {
      targetCamY = player.pos.y + 26;
      targetCamZ = player.pos.z + 16;
      targetLookY = player.pos.y + 4;
      targetFOV = 65;
    } else if (isZiplining) {
      targetCamX = player.pos.x + 5.6;
      targetCamY = player.pos.y + 4.2;
      targetCamZ = player.pos.z + 11.5;
      targetLookX = player.pos.x - 0.4;
      targetLookY = player.pos.y + 0.6;
      targetLookAheadZ = player.pos.z - 18;
      targetFOV = 68;
    } else if (isCurvedRiding) {
      targetCamY = player.pos.y + 16;
      targetCamZ = player.pos.z + 9;
      targetLookY = player.pos.y - 1.2;
      targetFOV = 67;
    } else if (isSlideRiding) {
      targetCamX = player.pos.x * 0.85;
      targetCamY = player.pos.y + 18;
      targetCamZ = player.pos.z + 9;
      targetLookX = player.pos.x * 0.80;
      targetLookY = player.pos.y - 1;
      targetFOV = 63;
    } else if (isElevator) {
      targetCamX = player.pos.x * 0.35;
      targetCamY = player.pos.y + 7.2 + stackLift;
      targetCamZ = player.pos.z + 12.0;
      targetLookX = player.pos.x * 0.15;
      targetLookY = player.pos.y + 1.8;
      targetLookAheadZ = player.pos.z - 12.0;
      targetFOV = 64;
    } else if (isSkydive) {
      const airX = player.skydiveX !== undefined ? player.skydiveX : player.pos.x;
      const camCfg = SKYDIVE_CONFIG.CAMERA;
      targetCamX = airX * 0.75;
      targetCamY = player.pos.y + camCfg.offsetY;
      targetCamZ = player.pos.z + camCfg.offsetZ;
      targetLookX = airX * 0.65;
      targetLookY = player.pos.y - 0.8;
      targetLookAheadZ = player.pos.z + camCfg.lookAheadZ;
      targetFOV = camCfg.fovDrop;
    } else if (isApproachingTrapdoor) {
      targetCamX = player.pos.x + 7.5;
      targetCamY = player.pos.y + 4.2;
      targetCamZ = player.pos.z + 3.0;
      targetLookX = player.pos.x - 0.8;
      targetLookY = player.pos.y + 1.0;
      targetLookAheadZ = player.pos.z - 2.5;
      targetFOV = 64;
    } else if (isTrapdoor) {
      const b = player.activeTrapdoor || player.activeFreefall;
      const prog = player.trapdoorProgress || player.freefallProgress || 0;
      const camCfg = TRAPDOOR_CONFIG.CAMERA;
      const hatchX = b.hatchCenter ? b.hatchCenter.x : 0;

      if (b && prog < 0.22) {
        targetCamX = hatchX;
        targetCamY = b.startY + 11.5;
        targetCamZ = b.startZ;
        targetLookX = hatchX;
        targetLookY = player.pos.y;
        targetLookAheadZ = b.startZ;
        targetFOV = camCfg.fovStart;
      } else if (b && prog < 0.80) {
        const chaseBlend = THREE.MathUtils.smoothstep(prog, 0.22, 0.42);

        const fromCamX = hatchX;
        const fromCamY = b.startY + 11.5;
        const fromCamZ = b.startZ;
        const fromLookX = hatchX;
        const fromLookY = player.pos.y;
        const fromLookZ = b.startZ;

        const toCamX = player.pos.x * 0.35 + camCfg.offsetX * 0.4;
        const toCamY = player.pos.y + camCfg.offsetY;
        const toCamZ = player.pos.z + camCfg.offsetZ;
        const toLookX = player.pos.x * 0.2;
        const toLookY = player.pos.y + camCfg.lookOffsetY;
        const toLookZ = player.pos.z + camCfg.lookAheadZ;

        targetCamX = THREE.MathUtils.lerp(fromCamX, toCamX, chaseBlend);
        targetCamY = THREE.MathUtils.lerp(fromCamY, toCamY, chaseBlend);
        targetCamZ = THREE.MathUtils.lerp(fromCamZ, toCamZ, chaseBlend);
        targetLookX = THREE.MathUtils.lerp(fromLookX, toLookX, chaseBlend);
        targetLookY = THREE.MathUtils.lerp(fromLookY, toLookY, chaseBlend);
        targetLookAheadZ = THREE.MathUtils.lerp(fromLookZ, toLookZ, chaseBlend);
        targetFOV = THREE.MathUtils.lerp(camCfg.fovStart, camCfg.fovDrop, chaseBlend);
      } else if (b) {
        const landRatio = (prog - 0.80) / 0.20;
        targetCamX = THREE.MathUtils.lerp(player.pos.x * 0.35 + camCfg.offsetX * 0.4, hatchX, landRatio);
        targetCamY = THREE.MathUtils.lerp(player.pos.y + camCfg.offsetY, b.endY + 7.5, landRatio);
        targetCamZ = THREE.MathUtils.lerp(player.pos.z + camCfg.offsetZ, b.endZ + 11.5, landRatio);
        targetLookX = hatchX;
        targetLookY = b.endY + 1.0;
        targetLookAheadZ = b.endZ - 5.0;
        targetFOV = THREE.MathUtils.lerp(camCfg.fovDrop, 62, landRatio);
      }
    }

    if (trapdoorLandingRecoveryTimer > 0) {
      const recRatio = trapdoorLandingRecoveryTimer / 1.2;
      const recCamY = player.pos.y + 9.5;
      const recCamZ = player.pos.z + 14.5;
      const recLookY = player.pos.y + 1.2;
      const recLookAheadZ = player.pos.z - 6.0;

      targetCamY = THREE.MathUtils.lerp(targetCamY, recCamY, recRatio);
      targetCamZ = THREE.MathUtils.lerp(targetCamZ, recCamZ, recRatio);
      targetLookY = THREE.MathUtils.lerp(targetLookY, recLookY, recRatio);
      targetLookAheadZ = THREE.MathUtils.lerp(targetLookAheadZ, recLookAheadZ, recRatio);
      targetFOV = THREE.MathUtils.lerp(targetFOV, 62, recRatio);
    }

    const prog = player.trapdoorProgress || player.freefallProgress || 0;
    const trapdoorLerp = isTrapdoor
      ? (prog < 0.22 ? 0.32 : (prog < 0.42 ? TRAPDOOR_CONFIG.CAMERA.lerpFactorLead : TRAPDOOR_CONFIG.CAMERA.lerpFactorChase))
      : 0.14;

    const lerpFactorX = isTrapdoor ? trapdoorLerp : (isApproachingTrapdoor ? 0.20 : (isSkydive ? 0.40 : (trapdoorLandingRecoveryTimer > 0 ? 0.18 : 0.12)));
    const lerpFactorY = isTrapdoor ? trapdoorLerp : (isApproachingTrapdoor ? 0.20 : (isSkydive ? 0.40 : (isJumping ? 0.16 : (trapdoorLandingRecoveryTimer > 0 ? 0.18 : 0.12))));
    const lerpFactorZ = isTrapdoor ? trapdoorLerp : (isApproachingTrapdoor ? 0.20 : (isSkydive ? 0.44 : (trapdoorLandingRecoveryTimer > 0 ? 0.18 : 0.12)));

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, lerpFactorX);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, lerpFactorY);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, lerpFactorZ);

    if (Math.abs(camera.fov - targetFOV) > 0.1) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.12);
      camera.updateProjectionMatrix();
    }

    camera.lookAt(targetLookX, targetLookY, targetLookAheadZ);

    if (seaMesh) {
      seaMesh.position.z = player.pos.z - 200;
    }
  }
  if (renderer && scene && camera) renderer.render(scene, camera);
}

export function bootGame() {
  if (window._gameEngineBooted) return;
  window._gameEngineBooted = true;
  try {
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