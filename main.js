// メインエントリポイント：Three.js初期化・カメラ追従・全画面入力・メインループ
import { SoundEngine } from './audio.js';
import { TEAMS } from './constants.js';
import {
  _tempVec3A,
  _tempVec3B,
  disposeHierarchy
} from './materials.js';
import {
  player,
  characters,
  setupCharacters,
  resetCharacters,
  setCharacterCallbacks,
  addBrickToCharacter
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

const input = { x: 0, y: 0, active: false };

export function updateHUD() {
  const countEl = document.getElementById('hud-stack-count');
  const scoreEl = document.getElementById('hud-score');
  if (countEl && player) countEl.innerText = player.stackCount;
  if (scoreEl) scoreEl.innerText = placedPlankCount;
}

export function updateTimerHUD(force = false) {
  const currentSecInt = Math.floor(timeLeft);
  if (!force && currentSecInt === lastDisplayedSec) return;
  lastDisplayedSec = currentSecInt;
  const min = Math.floor(currentSecInt / 60).toString().padStart(2, '0');
  const sec = (currentSecInt % 60).toString().padStart(2, '0');
  const timerEl = document.getElementById('hud-timer');
  if (timerEl) timerEl.innerText = `${min}:${sec}`;
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
    
    // 復元: デッドゾーンの追加（指を中心に少し戻した時は完全に停止する）
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

  const soundBtn = document.getElementById('btn-sound');
  const iconSoundOff = document.getElementById('icon-sound-off');
  const iconSoundOn = document.getElementById('icon-sound-on');
  if (soundBtn) {
    soundBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sound.init();
      const isMuted = sound.toggleMute();
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

  scene.add(new THREE.HemisphereLight(0xffffff, 0x0284c7, 0.9));
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
  });

  for (let i = 0; i < 60; i++) manageBlockSpawns(scene, isGameOver);
  setupControls();

  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

let lastTime = performance.now();
let blockSpawnTimer = 0;
let cleanupTimer = 0;

export function animate(currentTime) {
  requestAnimationFrame(animate);
  const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
  lastTime = currentTime;

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

    const timeSec = currentTime * 0.001;
    const playerZ = player ? player.pos.z : 0;

    floorItems.forEach(item => {
      if (item.active && item.group) {
        if (Math.abs(item.pos.z - playerZ) > 95) return;
        if (item.crystal) {
          item.crystal.rotation.y = timeSec * 3.2;
          item.crystal.rotation.z = Math.sin(timeSec * 2.5) * 0.25;
          if (item.type !== 'magnet') {
            item.crystal.position.y = 1.35 + Math.sin(timeSec * 4.5 + item.stageIdx) * 0.22;
          } else {
            item.crystal.position.y = 1.15 + Math.sin(timeSec * 4.5 + item.stageIdx) * 0.22;
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
      }

      const t = Math.min(1.0, p.progress);
      _tempVec3A.lerpVectors(p.startPos, p.targetPos, t);
      _tempVec3A.y += Math.sin(t * Math.PI) * 5.2;
      p.group.position.copy(_tempVec3A);

      if (p.crystal) {
        p.crystal.rotation.x += dt * 22;
        p.crystal.rotation.y += dt * 28;
      }
      if (p.ring1) p.ring1.rotation.z += dt * 14;
      if (p.ring2) p.ring2.rotation.y += dt * 18;

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
            item.material.opacity = (1.0 - t * 0.2) * lifeFade * 0.92;
          }
        }
      }

      if (p.progress >= 1.0) {
        sound.playAttackHit();

        triggerLandingShockwave(p.targetPos.x, p.targetPos.y - 0.8, p.targetPos.z, 3.8, 0xf43f5e);

        if (p.target) {
          p.target.stunTimer = 1.4;
          scatterBricks(scene, p.target, 3);

          const drainCount = 4;
          let spawned = 0;
          for (let d = 0; d < drainBlockPool.length && spawned < drainCount; d++) {
            const db = drainBlockPool[d];
            if (!db.active) {
              db.active = true;
              db.targetChar = p.shooter;
              db.index = spawned;
              db.delay = spawned * 0.09;
              db.progress = 0;
              db.duration = 0.75;

              const sOffset = _tempVec3B.set(
                (Math.random() - 0.5) * 1.5,
                1.0 + Math.random() * 1.0,
                (Math.random() - 0.5) * 1.5
              );
              db.startPos.copy(p.target.pos).add(sOffset);
              db.mesh.position.copy(db.startPos);
              db.mesh.scale.set(1.15, 1.15, 1.15);
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
      _tempVec3B.y += Math.sin(prog * Math.PI) * 3.6;
      d.mesh.position.copy(_tempVec3B);

      const flightScale = 1.0 + Math.sin(prog * Math.PI) * 0.25;
      d.mesh.scale.set(flightScale, flightScale, flightScale);
      d.mesh.rotation.y += dt * 14;
      d.mesh.rotation.x += dt * 10;

      if (d.progress >= 1.0) {
        addBrickToCharacter(d.targetChar, d.targetChar.team, 1);
        if (d.targetChar.isPlayer) {
          sound.playDrainCollect(d.index || 0);
          triggerLandingShockwave(_tempVec3A.x, _tempVec3A.y, _tempVec3A.z, 0.9, 0xf472b6);
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
          triggerLandingShockwave(_tempVec3A.x, _tempVec3A.y, _tempVec3A.z, 0.95, 0x34d399);
        }
        mb.targetChar.dockBounceTimer = 0.085;
        mb.targetChar.meshObj.stackGroup.scale.set(1.10, 1.15, 1.10);

        // ★ フェーズ3: scene.remove を廃止し、プールへ返却
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
    const isJumping = player.isJumping;

    let targetCamX = player.pos.x * 0.2;
    let targetCamY = player.pos.y + 24;
    let targetCamZ = player.pos.z + 12;
    let targetLookX = player.pos.x * 0.1;
    let targetLookY = player.pos.y;
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
      targetCamY = player.pos.y + 18;
      targetCamZ = player.pos.z + 9;
      targetLookY = player.pos.y - 1;
      targetFOV = 63;
    }

    const lerpFactorPos = isJumping ? 0.10 : 0.14;
    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetCamX, lerpFactorPos);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetCamY, 0.16);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetCamZ, lerpFactorPos);

    if (Math.abs(camera.fov - targetFOV) > 0.1) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFOV, 0.08);
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