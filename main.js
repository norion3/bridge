// main.js: ゲーム全体の起動指揮・Three.js初期化・メインループ・DM招待リンク自動合流司令塔
// ★ Package 5 操作入力＆HUD分離・スリム化司令塔版（main_controls.js ＆ main_hud.js 統合）：
//   1. 【入力・タッチ操作を main_controls.js へ完全外注】
//      setupControls, input を委譲。
//   2. 【タイマー・スコア・HUDを main_hud.js へ完全外注】
//      updateHUD, updateTimerHUD, triggerScorePop, updateRestartButtonVisibility, submitGravityScore 等を委譲。
//   3. 【Three.js初期化・レンダーループ・DM招待Auto-Joinへの専念】
//      120fps/60fpsメインループ、シーングラフ最適化、カメラ制御、ゲーム起動シーケンスを統括。
//   4. 【外部向けエクスポート100%完全維持】

import { mountAllUI, UIController, EntryShield } from './dom.js';
import { SoundEngine } from './audio.js';
import { seaTexture } from './materials.js';
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
  bridgesByStage,
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

// ★ main_controls.js から入力操作をインポート
import { input, setupControls } from './main_controls.js';

// ★ main_hud.js からHUD・タイマー・スコア制御をインポート＆再エクスポート
import {
  timeLeft,
  isGameOver,
  placedPlankCount,
  lastDisplayedSec,
  setTimeLeft,
  decrementTimeLeft,
  setIsGameOver,
  setPlacedPlankCount,
  incPlacedPlankCount,
  setLastDisplayedSec,
  resetHUDTimers,
  updateRestartButtonVisibility,
  submitGravityScore,
  applyRemoteTimeSync,
  applyRemoteTimeUp,
  applyGravityTopInset,
  triggerScorePop,
  updateHUD,
  updateTimerHUD,
  onTimeUp
} from './main_hud.js';

export {
  updateRestartButtonVisibility,
  submitGravityScore,
  applyRemoteTimeSync,
  applyRemoteTimeUp,
  applyGravityTopInset,
  triggerScorePop,
  updateHUD,
  updateTimerHUD,
  onTimeUp,
  setupControls
};

if (typeof window !== 'undefined') {
  window.refreshRemoteStackVisuals = refreshCharacterStackVisuals;
}

export const IS_GRAVITY_APP = typeof window !== 'undefined' && !!window.AgentSDK;

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

let gameStarted = false;
let lastRecordedHostState = null;

export function launchGameEngine() {
  gameStarted = true;
  setIsGameOver(false);
  if (sound) {
    sound.init();
  }
  updateRestartButtonVisibility();
}

if (typeof window !== 'undefined') {
  window.launchGameEngine = launchGameEngine;
  window.onRemoteRestartReceived = (packet) => {
    if (packet && packet.seed) {
      resetGame(packet.seed, packet.snapshot);
    } else {
      resetGame();
    }
  };
}

export function resetGame(remoteSeed = null, remoteSnapshot = null) {
  const resultModal = document.getElementById('modal-result');
  if (resultModal) {
    resultModal.classList.add('hidden');
    resultModal.style.display = 'none';
  }
  setIsGameOver(false);
  setPlacedPlankCount(0);
  setTimeLeft(300);
  setLastDisplayedSec(-1);

  resetCameraState();
  resetHUDTimers();

  const scoreEl = document.getElementById('hud-score');
  if (scoreEl) scoreEl.classList.remove('score-pop', 'score-clamped');

  const timerEl = document.getElementById('hud-timer');
  if (timerEl) timerEl.classList.remove('timer-critical');

  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = Boolean(isMulti && window.NetworkManager.isHost);

  let targetSeed = remoteSeed;
  if (!targetSeed) {
    targetSeed = Math.floor(Math.random() * 90000000) + 10000000;
  }

  buildWorld(scene, targetSeed);
  resetCharacters(STAGES);

  if (camera) {
    const focusX = (player && player.pos) ? player.pos.x : 0.0;
    camera.position.set(focusX, STAGES[0].y + 24, STAGES[0].z + 12);
    camera.lookAt(focusX, STAGES[0].y, STAGES[0].z - 5);
  }

  if (!isHost && isMulti && remoteSnapshot) {
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
    for (let i = 0; i < 30; i++) {
      manageBlockSpawns(scene, false);
    }

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
    incPlacedPlankCount();
    updateHUD();
    triggerScorePop();
  });

  for (let i = 0; i < 60; i++) manageBlockSpawns(scene, isGameOver);

  setupControls(sound, {
    onResetGame: () => resetGame(),
    onLaunchGame: () => launchGameEngine(),
    onRestartVisibilityUpdate: () => updateRestartButtonVisibility()
  });

  applyGravityTopInset(IS_GRAVITY_APP);

  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyGravityTopInset(IS_GRAVITY_APP);
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

    if (lastRecordedHostState !== isHost) {
      lastRecordedHostState = isHost;
      updateRestartButtonVisibility();
    }

    if (player) {
      if (typeof window !== 'undefined') {
        window.localPlayerInstance = player;
      }

      if (player.dockBounceTimer > 0) {
        player.dockBounceTimer -= dt;
        if (player.dockBounceTimer <= 0) {
          player.dockBounceTimer = 0;
          if (player.meshObj && player.meshObj.stackGroup) {
            player.meshObj.stackGroup.scale.set(1.0, 1.0, 1.0);
          }
        } else {
          const bp = player.dockBounceTimer / 0.15;
          const sy = 1.0 + Math.sin(bp * Math.PI) * 0.22;
          const sxz = 1.0 + Math.sin(bp * Math.PI) * 0.12;
          if (player.meshObj && player.meshObj.stackGroup) {
            player.meshObj.stackGroup.scale.set(sxz, sy, sxz);
          }
        }
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

      if ((hasReceivedNetPos || isHumanSlot) && (!c.isRemote || c.isAI)) {
        c.isRemote = true;
        c.isAI = false;
      }

      if (isHost && slotData && slotData.isAI) {
        if (c.targetNetPos) {
          c.targetNetPos = null;
        }
        if (c.isRemote || !c.isAI) {
          c.isRemote = false;
          c.isAI = true;
        }
      }

      const shouldRunAI = (!isMulti || isHost) && !isRemotePlayer && c.isAI === true && !c.targetNetPos;

      if (shouldRunAI) {
        updateAICharacter(scene, c, dt, spawnPuffCloud, spawnSpeedStepRing);
      } else if (c.targetNetPos) {
        const prevX = c.pos.x;
        const prevZ = c.pos.z;

        if (c.stunTimer > 0) {
          c.stunTimer -= dt;
          if (c.stunTimer <= 0) {
            c.stunTimer = 0;
            c.isStunned = false;
          }
        }

        if (c.shrinkTimer > 0) {
          c.shrinkTimer -= dt;
          if (c.shrinkTimer <= 0) {
            c.shrinkTimer = 0;
            c.isShrunk = false;
          }
        }
        const isRemoteShrunk = Boolean(c.isShrunk || (c.shrinkTimer && c.shrinkTimer > 0));
        const targetScale = isRemoteShrunk ? 0.42 : 1.0;
        if (c._lastAppliedScale !== targetScale) {
          c._lastAppliedScale = targetScale;
          c.meshObj.root.scale.set(targetScale, targetScale, targetScale);
        }

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

        if (remState === 'TRAPDOOR') {
          const stageBridges = bridgesByStage.get(c.currentStage);
          if (stageBridges) {
            const trapB = stageBridges.find(b => b.isTrapdoor);
            if (trapB && !trapB.isHatchOpen) {
              trapB.isHatchOpen = true;
            }
          }
        }

        if (remState === 'JUMP' && c.prevRemoteActionState !== 'JUMP') {
          const stageBridges = bridgesByStage.get(c.currentStage);
          if (stageBridges) {
            for (let bi = 0; bi < stageBridges.length; bi++) {
              const b = stageBridges[bi];
              if (b && Array.isArray(b.planks)) {
                for (let pi = 0; pi < b.planks.length; pi++) {
                  const plank = b.planks[pi];
                  if (plank && plank.isJumpPad && plank.netMesh) {
                    plank.netMesh.scale.set(1.15, 0.2, 1.15);
                    plank.netMesh.position.y = 0.35;
                    setTimeout(() => {
                      if (plank.netMesh) {
                        plank.netMesh.scale.set(1.0, 1.0, 1.0);
                        plank.netMesh.position.y = 0.50;
                      }
                    }, 180);
                  }
                }
              }
            }
          }
        }
        c.prevRemoteActionState = remState;

        const stepDist = Math.hypot(c.pos.x - prevX, c.pos.z - prevZ);
        const hasNetVelocity = c.netVelocity && (Math.abs(c.netVelocity.x) > 0.08 || Math.abs(c.netVelocity.z) > 0.08);

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

      if (c.prevStackCount === undefined) {
        c.prevStackCount = c.stackCount || 0;
      } else if ((c.stackCount || 0) > c.prevStackCount) {
        c.dockBounceTimer = 0.15;
      }
      c.prevStackCount = c.stackCount || 0;

      if (c.dockBounceTimer > 0) {
        c.dockBounceTimer -= dt;
        if (c.dockBounceTimer <= 0) {
          c.dockBounceTimer = 0;
          if (c.meshObj && c.meshObj.stackGroup) {
            c.meshObj.stackGroup.scale.set(1.0, 1.0, 1.0);
          }
        } else {
          const bp = c.dockBounceTimer / 0.15;
          const sy = 1.0 + Math.sin(bp * Math.PI) * 0.22;
          const sxz = 1.0 + Math.sin(bp * Math.PI) * 0.12;
          if (c.meshObj && c.meshObj.stackGroup) {
            c.meshObj.stackGroup.scale.set(sxz, sy, sxz);
          }
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

    if (!isGuest) {
      decrementTimeLeft(dt);
      if (timeLeft <= 0) {
        setTimeLeft(0);
        onTimeUp(sound);
      }
    } else {
      if (timeLeft > 0) {
        decrementTimeLeft(dt);
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

async function checkAndHandleAutoJoin() {
  if (typeof window === 'undefined') return;

  try {
    if (typeof EntryShield !== 'undefined' && EntryShield.show) {
      EntryShield.show('CONNECTING...', 'ルームへ合流中...');
    }

    if (window.NetworkManager && typeof window.NetworkManager.init === 'function') {
      await window.NetworkManager.init();
    }

    let targetRoomId = '';
    if (window.AgentSDK && window.AgentSDK.room && typeof window.AgentSDK.room.getRoomId === 'function') {
      const res = await window.AgentSDK.room.getRoomId();
      targetRoomId = (res && typeof res.room_id === 'string')
        ? res.room_id
        : (res && res.data && typeof res.data.room_id === 'string' ? res.data.room_id : '');
    }

    if (targetRoomId && targetRoomId !== '') {
      const shortId = targetRoomId.length > 5 ? targetRoomId.slice(-5) : targetRoomId;
      console.log(`[AutoJoin] DM招待リンクを検知: Room #${targetRoomId} へ自動入室します`);

      if (typeof EntryShield !== 'undefined' && EntryShield.update) {
        EntryShield.update(`ROOM #${shortId}`, 'ルームへ合流中...');
      }

      launchGameEngine();

      if (window.NetworkManager && typeof window.NetworkManager.joinRoom === 'function') {
        const success = await window.NetworkManager.joinRoom(targetRoomId);
        if (success) {
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

    if (typeof EntryShield !== 'undefined' && EntryShield.show) {
      EntryShield.show('CONNECTING...', 'ルームへ合流中...');
    }

    initThree();
    animate(performance.now());

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