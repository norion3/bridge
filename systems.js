// systems.js: 自機・AIの物理移動計算・島内判定・階段架橋登攀判定・アトラクション進入判定司令塔
// ★ Package 2 受信ハンドラ分離＆スリム化司令塔版（systems_remote.js 統合）
//   1. 【受信ハンドラを systems_remote.js へ完全外注】
//      applyRemotePlankBuilt, applyRemoteBlockPicked, applyRemoteObjectConsumed, applyRemoteBlowMob を
//      systems_remote.js からインポート＆再エクスポートし、後方互換性100%を維持。
//   2. 【自機・AI移動・階段物理計算への専念】
//      二股分岐における左右レーン（左: 0, 右: 2）の actualBridgeX 基準登攀判定、
//      6大アトラクション進入判定、お邪魔モブ・ゲート衝突判定に特化。
//   3. 【GCスパイク防止の静的再利用バッファ完全維持】
//      reusableLocalBridges による配列生成ゼロ化、衝突調停は100%維持。

import {
  TRAMPOLINE_TIERS,
  LANES,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import {
  COLOR_BLUE_PLANK,
  COLOR_RED_PLANK,
  COLOR_YELLOW_PLANK,
  disposeHierarchy
} from './materials.js';
import {
  characters,
  addBrickToCharacter,
  removeBrickFromCharacter
} from './character.js';
import {
  STAGES,
  bridgesByStage,
  modifierGates,
  activeMagnetBlocks,
  floorItems,
  getFloorBlocksForStage,
  obstacleMobs,
  updateObstacleMobs
} from './world.js';
import {
  triggerLandingShockwave,
  floorBlockPool
} from './particles.js';
import {
  updateSkydiveMovement,
  updateTrapdoorMovement,
  updateElevatorMovement,
  updateZiplineMovement,
  updateCurvedSlideMovement
} from './gimmicks.js';
import {
  setCombatCallbacks,
  scatterBricks,
  fireHomingCrystal,
  fireThunderStrike,
  handleTackles,
  tackleKnockout
} from './combat.js';

// ★ systems_remote.js から受信ハンドラをインポート
import {
  applyRemotePlankBuilt,
  applyRemoteBlockPicked,
  applyRemoteObjectConsumed,
  applyRemoteBlowMob
} from './systems_remote.js';

// 他モジュールへの後方互換再エクスポート（外部からの import を100%保証）
export {
  applyRemotePlankBuilt,
  applyRemoteBlockPicked,
  applyRemoteObjectConsumed,
  applyRemoteBlowMob,
  scatterBricks,
  fireHomingCrystal,
  fireThunderStrike,
  handleTackles,
  tackleKnockout
};

let soundRef = null;
let updateHUDRef = null;
let onPlankPlacedCallback = null;

const dummyPlankObj = new THREE.Object3D();
// ★ GCスパイク防止用の静的再利用ブリッジ配列
const reusableLocalBridges = [];

export function setSystemCallbacks(sound, updateHUD, onPlankPlaced = null) {
  soundRef = sound;
  updateHUDRef = updateHUD;
  onPlankPlacedCallback = onPlankPlaced;
  setCombatCallbacks(sound, updateHUD);
}

export function checkGateCollisions(scene, char) {
  if (!char.isPlayer) return;

  for (let i = 0; i < modifierGates.length; i++) {
    const gate = modifierGates[i];
    if (gate.consumed || gate.stageIdx !== char.currentStage) continue;

    const dx = Math.abs(char.pos.x - gate.pos.x);
    const dz = Math.abs(char.pos.z - gate.pos.z);
    if (dx < 1.4 && dz < 0.9) {
      gate.consumed = true;
      disposeHierarchy(gate.meshGroup);
      scene.remove(gate.meshGroup);

      const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
      if (isMulti && gate.gateId && typeof window.NetworkManager.queueConsumeObject === 'function') {
        window.NetworkManager.queueConsumeObject(gate.gateId, 'gate');
      }

      if (gate.opType === 'multiply') {
        const currentCount = char.stackCount;
        const targetCount = currentCount * gate.value;
        const addCount = targetCount - currentCount;
        if (addCount > 0) {
          addBrickToCharacter(char, char.team, addCount, soundRef, updateHUDRef);
          if (soundRef) soundRef.playGateBoost();
        }
      } else if (gate.opType === 'divide') {
        const currentCount = char.stackCount;
        const targetCount = Math.floor(currentCount / gate.value);
        const dropCount = currentCount - targetCount;
        if (dropCount > 0) {
          scatterBricks(scene, char, dropCount);
          if (soundRef) soundRef.playTackle();
        }
      } else if (gate.opType === 'add') {
        addBrickToCharacter(char, char.team, gate.value, soundRef, updateHUDRef);
        if (soundRef) soundRef.playGateBoost();
      } else if (gate.opType === 'subtract') {
        scatterBricks(scene, char, gate.value);
        if (soundRef) soundRef.playTackle();
      }
      break;
    }
  }
}

/**
 * お邪魔キャラとの衝突・吹き飛ばし判定
 */
export function checkObstacleMobCollisions(scene, char) {
  if (char.invulnerableTimer > 0) return;

  for (let i = 0; i < obstacleMobs.length; i++) {
    const mob = obstacleMobs[i];
    if (!mob.active || mob.blownAway || mob.stageIdx !== char.currentStage) continue;

    const dx = char.pos.x - mob.currentX;
    const dz = char.pos.z - mob.baseZ;
    const distSq = dx * dx + dz * dz;

    if (distSq < 1.69 && Math.abs(char.pos.y - mob.baseY) < 1.4) {
      if (char.speedBoostActive) {
        mob.blownAway = true;
        const pushDirX = Math.sign(dx) || 1.0;
        mob.blowVelocity.set(pushDirX * 12.0, 16.0, -18.0);

        triggerLandingShockwave(mob.currentX, char.pos.y + 0.2, mob.baseZ, 2.5, 0xf97316);
        if (char.isPlayer && soundRef) soundRef.playTackle();

        const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
        const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
        const shouldBroadcast = isMulti && (char.isPlayer || (isHost && char.isAI));
        if (shouldBroadcast && window.NetworkManager && typeof window.NetworkManager.queueBlowMob === 'function') {
          window.NetworkManager.queueBlowMob(i, mob.stageIdx, pushDirX);
        }

        scatterBricks(scene, char, 0);
        break;
      } else {
        char.stunTimer = 0.45;
        char.invulnerableTimer = 1.4;
        if (char.isPlayer && soundRef) soundRef.playTackle();

        scatterBricks(scene, char, 2);

        const pushMag = Math.hypot(dx, dz) || 1.0;
        char.pos.x += (dx / pushMag) * 1.5;
        char.pos.z += (dz / pushMag) * 1.5;
        break;
      }
    }
  }
}

export function handleCourseMovement(scene, char, nextX, nextZ, inputDirX, inputDirZ) {
  char.onSlide = false;
  const isMovingDownwardOrBackward = (nextZ >= char.pos.z - 0.001) || (inputDirZ >= -0.05);
  const isForwardIntent = !isMovingDownwardOrBackward && (inputDirZ < -0.05);

  const curStageObj = STAGES[char.currentStage];
  const centerX = curStageObj ? (curStageObj.x || 0.0) : 0.0;

  const isFarFromBridges = curStageObj &&
    char.lastPlankIdx < 0 &&
    !char.onSlide && !char.onCurvedSlide && !char.onZipline && !char.onElevator && !char.onSkydive && !char.onTrapdoor &&
    (nextZ > curStageObj.z - curStageObj.r * 0.72) &&
    (char.pos.z > curStageObj.z - curStageObj.r * 0.72);

  // ★【GC最適化】毎フレームの配列アロケーション（new Array）を防止
  reusableLocalBridges.length = 0;
  if (bridgesByStage.has(char.currentStage)) {
    const curStageBridges = bridgesByStage.get(char.currentStage);
    for (let bi = 0; bi < curStageBridges.length; bi++) {
      reusableLocalBridges.push(curStageBridges[bi]);
    }
  }
  if (char.slideCooldown <= 0 && char.currentStage > 0 && bridgesByStage.has(char.currentStage - 1)) {
    const prevStageBridges = bridgesByStage.get(char.currentStage - 1);
    for (let bi = 0; bi < prevStageBridges.length; bi++) {
      reusableLocalBridges.push(prevStageBridges[bi]);
    }
  }
  const localBridges = reusableLocalBridges;

  if (!isFarFromBridges) {
    // 1. スカイダイブ進入判定
    const skyB = localBridges.find(b => b.isSkydive && b.stageIdx === char.currentStage);
    if (skyB && char.slideCooldown <= 0) {
      const launchX = skyB.launchPoint ? skyB.launchPoint.x : (skyB.actualBridgeX !== undefined ? skyB.actualBridgeX : centerX);
      const distToCatapult = Math.hypot(nextX - launchX, nextZ - skyB.startZ);
      if (distToCatapult < 2.8 && isForwardIntent) {
        char.onSkydive = true;
        char.skydiveProgress = 0;
        char.activeSkydive = skyB;
        char.skydiveX = char.pos.x;
        char.skydiveRoll = 0;

        if (char.isPlayer && soundRef) {
          soundRef.playSkydiveLaunch();
          soundRef.startSkydiveGlide(SKYDIVE_CONFIG.PHYSICS.totalDuration);
        }
        return;
      }
    }

    // 2. ドロップタワー進入判定
    const trapB = localBridges.find(b => b.isTrapdoor && b.stageIdx === char.currentStage);
    if (trapB && char.slideCooldown <= 0) {
      const approachStart = trapB.approachStartZ !== undefined ? trapB.approachStartZ : (trapB.startZ + 14.0);
      const hatchCenterZ = trapB.startZ;
      const hatchX = trapB.hatchCenter ? trapB.hatchCenter.x : (trapB.actualBridgeX !== undefined ? trapB.actualBridgeX : centerX);

      const inSkywalkX = Math.abs(nextX - hatchX) <= 1.7;
      const inSkywalkZ = (nextZ <= approachStart + 0.6) && (nextZ >= hatchCenterZ - 1.8);

      if (inSkywalkX && inSkywalkZ) {
        const distToHatch = Math.hypot(nextX - hatchX, nextZ - hatchCenterZ);
        if (distToHatch < 2.0 && isForwardIntent) {
          char.onTrapdoor = true;
          char.trapdoorProgress = 0;
          char.activeTrapdoor = trapB;
          char.trapdoorX = 0;
          char.pos.x = hatchX;
          trapB.isHatchOpen = true;

          if (char.isPlayer && soundRef) {
            soundRef.playTrapdoorOpen();
            soundRef.startTrapdoorFall(TRAPDOOR_CONFIG.PHYSICS.totalDuration);
          }
          return;
        }

        char.pos.x = Math.max(hatchX - 1.5, Math.min(hatchX + 1.5, nextX));
        char.pos.z = nextZ;
        char.pos.y = trapB.startY;
        char.lastPlankIdx = -1;
        char.onSlide = false;
        return;
      }
    }

    // 3. ジップライン進入判定
    const zipB = localBridges.find(b => b.isZipline && b.stageIdx === char.currentStage);
    if (zipB && char.slideCooldown <= 0) {
      const startPtX = zipB.startPt ? zipB.startPt.x : (zipB.actualBridgeX !== undefined ? zipB.actualBridgeX : centerX);
      const distToStart = Math.hypot(nextX - startPtX, nextZ - zipB.startZ);
      if (distToStart < 3.2 && isForwardIntent) {
        char.onZipline = true;
        char.ziplineProgress = 0;
        char.activeZipline = zipB;
        return;
      }
    }

    // 4. S字カーブスライダー進入判定
    const curvedB = localBridges.find(b => b.isCurvedSlide && b.stageIdx === char.currentStage);
    if (curvedB && char.slideCooldown <= 0) {
      const cBridgeX = (curvedB.actualBridgeX !== undefined) ? curvedB.actualBridgeX : centerX;
      const distToStart = Math.hypot(nextX - cBridgeX, nextZ - curvedB.startZ);
      if (distToStart < 3.2 && isForwardIntent) {
        char.onCurvedSlide = true;
        char.curvedSlideProgress = 0;
        char.curvedSlideOffset = Math.max(-1.5, Math.min(1.5, nextX - cBridgeX));
        char.activeCurvedBridge = curvedB;
        if (!char.isPlayer) {
          char.botSlideOffsetTarget = (Math.random() - 0.5) * 1.5;
        }
        return;
      }
    }

    // 5. エレベーター進入判定
    const eleB = localBridges.find(b => b.isElevator && b.stageIdx === char.currentStage);
    if (eleB && char.slideCooldown <= 0 && !char.elevatorExiting) {
      let onLane = false;
      let closestLane = 0;
      let minDist = 999;
      for (let i = 0; i < 3; i++) {
        const d = Math.abs(nextX - (centerX + LANES[i]));
        if (d < 1.6) onLane = true;
        if (d < minDist) { minDist = d; closestLane = i; }
      }
      if (onLane && nextZ <= eleB.startZ + 1.8 && isForwardIntent) {
        char.onElevator = true;
        char.elevatorProgress = 0;
        char.activeElevator = eleB;
        char.elevatorLane = closestLane;
        char.elevatorExiting = false;
        char.elevatorExitTimer = 0;

        if (char.isPlayer && soundRef) soundRef.playElevatorStart();
        return;
      }
    }

    // 6. 通常階段・直線スライダー・ジャンプ台
    let onBridge = null;
    for (let b of localBridges) {
      if (b.isCurvedSlide || b.isZipline || b.isElevator || b.isSkydive || b.isTrapdoor) continue;
      if (char.currentStage !== b.stageIdx && char.currentStage !== b.nextStageIdx) continue;

      if (b.isSlide && char.currentStage === b.nextStageIdx && char.slideCooldown > 0) continue;

      const fromStg = STAGES[b.stageIdx];
      const bCenterX = fromStg ? (fromStg.x || 0.0) : 0.0;
      const expectedLaneX = (b.actualBridgeX !== undefined)
        ? b.actualBridgeX
        : (bCenterX + (LANES[b.laneIdx] !== undefined ? LANES[b.laneIdx] : 0.0));

      if (Math.abs(nextX - expectedLaneX) > 1.95) continue;
      if (nextZ > b.startZ + 0.15 || nextZ < b.endZ - 0.8) continue;

      if (char.currentStage === b.nextStageIdx) {
        const isBridgeOpen = b.isSlide || b.isJump || b.planks.every(p => p.teamId !== null);
        if (!isBridgeOpen && nextZ > b.endZ) {
          continue;
        }
      }

      if (nextZ <= b.startZ + 0.15 && nextZ >= b.endZ - 0.2) {
        onBridge = b;
        break;
      }
    }

    if (onBridge) {
      const fromStg = STAGES[onBridge.stageIdx];
      const bCenterX = fromStg ? (fromStg.x || 0.0) : 0.0;
      const currentLaneX = (onBridge.actualBridgeX !== undefined)
        ? onBridge.actualBridgeX
        : (bCenterX + (LANES[onBridge.laneIdx] !== undefined ? LANES[onBridge.laneIdx] : 0.0));

      if (char.currentStage === onBridge.nextStageIdx) {
        const isBridgeOpen = onBridge.isSlide || onBridge.isJump || onBridge.planks.every(p => p.teamId !== null);
        if (!isBridgeOpen) {
          char.pos.z = Math.min(char.pos.z, onBridge.endZ - 0.2);
          return;
        }
      }

      if (char.pos.z <= onBridge.endZ + 0.2 && isMovingDownwardOrBackward) {
        const isBridgeOpen = onBridge.isSlide || onBridge.isJump || onBridge.planks.every(p => p.teamId !== null);
        if (!isBridgeOpen) {
          char.pos.z = onBridge.endZ - 0.2;
          return;
        }
      }

      // 終点島への上陸判定：自チームの色になっている場合のみ上陸を許可
      if (nextZ <= onBridge.endZ - 0.1) {
        const lastPlank = onBridge.planks[onBridge.planks.length - 1];
        const canPassEnd = onBridge.isSlide || onBridge.isJump || (lastPlank && lastPlank.teamId === char.team.id);

        if (canPassEnd) {
          char.currentStage = onBridge.nextStageIdx;
          const toStg = STAGES[onBridge.nextStageIdx];
          const destCenterX = toStg ? (toStg.x || 0.0) : 0.0;

          if (onBridge.isSlide) {
            const maxR = toStg.r - 2.5;
            char.pos.x = THREE.MathUtils.lerp(nextX, destCenterX, 0.45);
            char.pos.x = Math.max(destCenterX - maxR, Math.min(destCenterX + maxR, char.pos.x));
            char.pos.z = Math.min(nextZ, onBridge.endZ - 2.0);
            char.slideCooldown = 0.65;
          } else {
            char.pos.x = currentLaneX;
            char.pos.z = Math.min(nextZ, onBridge.endZ - 1.2);
            char.slideCooldown = 0.4;
          }
          char.pos.y = toStg.y;
          char.lastPlankIdx = -1;
          char.onSlide = false;

          if (!char.isPlayer) {
            char.aiState = 'COLLECT';
            char.targetLane = undefined;
            char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
          }
          return;
        } else {
          // 自チームの色でない場合は境界で前進をブロック
          char.pos.z = Math.max(char.pos.z, onBridge.endZ + 0.12);
          char.pos.x = currentLaneX;
          if (onBridge.planks.length > 0) {
            char.pos.y = onBridge.planks[onBridge.planks.length - 1].y;
          }
          return;
        }
      }

      // 始点島への引き返し
      if (nextZ >= onBridge.startZ) {
        char.currentStage = onBridge.stageIdx;
        char.pos.x = currentLaneX;
        char.pos.z = nextZ;
        char.pos.y = STAGES[onBridge.stageIdx].y;
        char.lastPlankIdx = -1;
        char.onSlide = false;
        return;
      }

      const progress = Math.min(Math.max((onBridge.startZ - nextZ) / (onBridge.startZ - onBridge.endZ), 0), 0.999);
      const plankIdx = Math.floor(progress * onBridge.planks.length);

      if (plankIdx >= 0 && plankIdx < onBridge.planks.length) {
        const plank = onBridge.planks[plankIdx];

        if (plank.isJumpPad) {
          if (isForwardIntent) {
            char.isJumping = true;
            char.jumpProgress = 0;
            char.jumpStartX = char.pos.x;
            char.jumpStartY = char.pos.y;
            char.jumpStartZ = char.pos.z;
            char.jumpTargetStage = onBridge.nextStageIdx;
            char.jumpTargetX = currentLaneX;
            char.lastPlankIdx = -1;
            char.activeJumpTier = plank.jumpTier || TRAMPOLINE_TIERS.normal;

            const dipY = char.activeJumpTier.dip || -0.15;
            if (plank.netMesh) {
              plank.netMesh.scale.set(1.15, 0.2, 1.15);
              plank.netMesh.position.y = 0.50 + dipY;
              setTimeout(() => {
                if (plank.netMesh) {
                  plank.netMesh.scale.set(1.0, 1.0, 1.0);
                  plank.netMesh.position.y = 0.50;
                }
              }, 180);
            }
            if (char.isPlayer && soundRef) soundRef.playJump(char.activeJumpTier.id);
          }
          return;
        }

        if (onBridge.isSlide) {
          const maxOffset = 1.35;
          char.pos.x = Math.max(currentLaneX - maxOffset, Math.min(currentLaneX + maxOffset, nextX));
          char.pos.z = nextZ;
          char.pos.y = plank.y;
          char.onSlide = true;
          char.lastPlankIdx = plankIdx;

          // 直線スライダー上のボーナスブロック回収 ＆ キューイング
          if (scene && onBridge.bonusBlocks && onBridge.bonusBlocks.length > 0) {
            for (let sbi = 0; sbi < onBridge.bonusBlocks.length; sbi++) {
              const blk = onBridge.bonusBlocks[sbi];
              if (!blk.collected) {
                if (Math.abs(char.pos.z - blk.z) < 1.35 && Math.abs(char.pos.x - blk.laneX) < 1.3) {
                  blk.collected = true;
                  scene.remove(blk.mesh);
                  addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);
                  if (char.isPlayer && soundRef) {
                    soundRef.playCollect(1.2 + blk.prog * 0.6);
                  }

                  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
                  const shouldBroadcastBonus = char.isPlayer || (isHost && char.isAI);
                  if (shouldBroadcastBonus && typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive) {
                    if (blk.bonusId && typeof window.NetworkManager.queueConsumeObject === 'function') {
                      window.NetworkManager.queueConsumeObject(blk.bonusId, 'bonus');
                    }
                  }
                }
              }
            }
          }
          return;
        }

        if (isForwardIntent) {
          if (char.currentStage !== onBridge.stageIdx && char.lastPlankIdx < 0) {
            return;
          }

          const startIdx = (char.lastPlankIdx >= 0 && char.lastPlankIdx <= plankIdx) ? char.lastPlankIdx : 0;
          let blocked = false;

          for (let pIndex = startIdx; pIndex <= plankIdx; pIndex++) {
            const currentP = onBridge.planks[pIndex];

            if (pIndex > 0 && onBridge.planks[pIndex - 1].teamId === null) {
              blocked = true;
              const blockedZ = onBridge.startZ - ((pIndex - 1) / onBridge.planks.length) * (onBridge.startZ - onBridge.endZ);
              char.pos.x = currentLaneX;
              char.pos.z = blockedZ + 0.12;
              char.pos.y = onBridge.planks[pIndex - 1].y;
              if (!char.isPlayer) {
                char.aiState = 'COLLECT';
                char.targetLane = undefined;
              }
              break;
            }

            if (currentP.teamId !== char.team.id) {
              if (char.stackCount > 0) {
                removeBrickFromCharacter(char, updateHUDRef);
                currentP.teamId = char.team.id;

                if (onBridge.solidMesh && onBridge.ghostMesh) {
                  dummyPlankObj.position.set(currentLaneX, currentP.y, currentP.z);
                  dummyPlankObj.rotation.set(0, 0, 0);
                  dummyPlankObj.scale.set(0, 0, 0);
                  dummyPlankObj.updateMatrix();
                  onBridge.ghostMesh.setMatrixAt(pIndex, dummyPlankObj.matrix);
                  onBridge.ghostMesh.instanceMatrix.needsUpdate = true;

                  dummyPlankObj.scale.set(1, 1, 1);
                  dummyPlankObj.updateMatrix();
                  onBridge.solidMesh.setMatrixAt(pIndex, dummyPlankObj.matrix);
                  onBridge.solidMesh.instanceMatrix.needsUpdate = true;

                  if (char.team.id === 'blue') onBridge.solidMesh.setColorAt(pIndex, COLOR_BLUE_PLANK);
                  else if (char.team.id === 'red') onBridge.solidMesh.setColorAt(pIndex, COLOR_RED_PLANK);
                  else if (char.team.id === 'yellow') onBridge.solidMesh.setColorAt(pIndex, COLOR_YELLOW_PLANK);

                  if (onBridge.solidMesh.instanceColor) {
                    onBridge.solidMesh.instanceColor.needsUpdate = true;
                  }
                }

                // 分離された固有レーン番号 (左: 0, 右: 2, 通常: 0/1/2) でパケット送信
                const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
                const shouldBroadcastPlank = char.isPlayer || (isHost && char.isAI);

                if (shouldBroadcastPlank && typeof window !== 'undefined' && window.NetworkManager) {
                  if (typeof window.NetworkManager.queuePlankBuild === 'function') {
                    window.NetworkManager.queuePlankBuild(onBridge.stageIdx, onBridge.laneIdx, pIndex, char.team.id);
                  }
                }

                if (char.isPlayer) {
                  if (soundRef) soundRef.playBuildPlank();
                  if (onPlankPlacedCallback) onPlankPlacedCallback();
                  if (updateHUDRef) updateHUDRef();
                }
              } else {
                blocked = true;
                const blockedZ = onBridge.startZ - (pIndex / onBridge.planks.length) * (onBridge.startZ - onBridge.endZ);
                char.pos.x = currentLaneX;
                char.pos.z = blockedZ + 0.12;
                char.pos.y = currentP.y;
                if (!char.isPlayer) {
                  char.aiState = 'COLLECT';
                  char.targetLane = undefined;
                }
                break;
              }
            }
          }

          if (!blocked) {
            char.pos.x = currentLaneX;
            char.pos.z = nextZ;
            char.pos.y = plank.y;
            char.lastPlankIdx = plankIdx;
          }
        } else {
          char.pos.x = currentLaneX;
          char.pos.z = nextZ;
          char.pos.y = plank.y;
          char.lastPlankIdx = plankIdx;
        }
      }
      return;
    }
  }

  // 7. 島内滞在判定
  let onStage = null;

  const curStage = STAGES[char.currentStage];
  if (curStage) {
    const curCenterX = curStage.x || 0.0;
    const curDx = nextX - curCenterX;
    const curDz = nextZ - curStage.z;
    const curInCircle = (curDx * curDx + curDz * curDz) < ((curStage.r + 1.2) * (curStage.r + 1.2));
    const curHeightMatch = Math.abs(char.pos.y - curStage.y) < 3.5;
    if (curInCircle && curHeightMatch) {
      onStage = char.currentStage;
    }
  }

  if (onStage === null) {
    for (let i = Math.max(0, char.currentStage - 1); i < STAGES.length; i++) {
      const stage = STAGES[i];
      const heightDiff = Math.abs(char.pos.y - stage.y);
      if (heightDiff >= 3.5) continue;

      const stgCenterX = stage.x || 0.0;
      const dx = nextX - stgCenterX;
      const dz = nextZ - stage.z;
      const inCircle = (dx * dx + dz * dz) < ((stage.r + 1.2) * (stage.r + 1.2));
      if (inCircle) {
        onStage = i;
        break;
      }
    }
  }

  if (onStage !== null) {
    char.pos.x = nextX;
    char.pos.z = nextZ;
    char.pos.y = STAGES[onStage].y;
    char.currentStage = onStage;
    char.lastPlankIdx = -1;
    char.onSlide = false;
    return;
  }

  // 8. AI外周クランプ
  if (!char.isPlayer) {
    const curStage = STAGES[char.currentStage];
    if (curStage) {
      const stageBridges = bridgesByStage.get(char.currentStage) || [];
      const stgCenterX = curStage.x || 0.0;

      const isApproachingAnyBridge = (nextZ < curStage.z) && stageBridges.some(b => {
        if (b.isTrapdoor || b.isFreefall) {
          const approachStart = b.approachStartZ !== undefined ? b.approachStartZ : (b.startZ + 16.0);
          return Math.abs(char.pos.x - stgCenterX) < 2.5 && (char.pos.z <= approachStart + 2.0 && char.pos.z >= b.startZ - 2.5);
        }
        if (b.isSkydive) {
          const lX = b.launchPoint ? b.launchPoint.x : (b.actualBridgeX !== undefined ? b.actualBridgeX : stgCenterX);
          return Math.abs(char.pos.x - lX) < 2.5 && (char.pos.z <= b.startZ + 3.0 && char.pos.z >= b.startZ - 4.0);
        }
        const laneX = (b.actualBridgeX !== undefined)
          ? b.actualBridgeX
          : ((b.isCurvedSlide || b.isZipline) ? stgCenterX : (stgCenterX + (LANES[b.laneIdx] !== undefined ? LANES[b.laneIdx] : 0.0)));
        return Math.abs(char.pos.x - laneX) < 2.2 && (char.pos.z <= b.startZ + 2.5 && char.pos.z >= b.endZ - 1.0);
      });

      if (!isApproachingAnyBridge) {
        const dx = nextX - stgCenterX;
        const dz = nextZ - curStage.z;
        const dist = Math.hypot(dx, dz);
        const safeR = curStage.r - 0.45;
        if (dist > safeR && dist > 0.001) {
          char.pos.x = stgCenterX + (dx / dist) * safeR;
          char.pos.z = curStage.z + (dz / dist) * safeR;
          char.pos.y = curStage.y;
          char.lastPlankIdx = -1;
          char.onSlide = false;
        }
      } else {
        char.pos.x = nextX;
        char.pos.z = nextZ;
        char.pos.y = curStage.y;
      }
    }
  }
}

export function updateSingleCharacter(scene, char, dirX, dirZ, dt, spawnPuffCloud, spawnSpeedStepRing) {
  if (char.isPlayer) {
    updateObstacleMobs(dt, scene);
  }

  if (char.invulnerableTimer > 0) {
    char.invulnerableTimer -= dt;
    char.meshObj.root.visible = (Math.floor(Date.now() / 90) % 2 === 0);
  } else {
    char.meshObj.root.visible = true;
  }

  if (char.shrinkTimer > 0) {
    char.shrinkTimer -= dt;
    const shrinkScale = 0.42;
    char.meshObj.root.scale.set(shrinkScale, shrinkScale, shrinkScale);
    if (char.shrinkTimer <= 0) {
      char.shrinkTimer = 0;
      char.meshObj.root.scale.set(1.0, 1.0, 1.0);
    }
  }

  if (char.slideCooldown > 0) {
    char.slideCooldown -= dt;
  }

  if (char.speedBoostActive) {
    char.speedBoostTimer = (char.speedBoostTimer || 0) - dt;
    if (char.speedBoostTimer <= 0) {
      char.speedBoostActive = false;
      char.speedBoostTimer = 0;
      if (char.meshObj.footAura) char.meshObj.footAura.visible = false;
    }
  }

  const stageBlocks = getFloorBlocksForStage(char.currentStage);

  if (char.magnetActive) {
    char.magnetTimer = (char.magnetTimer || 0) - dt;
    if (char.magnetTimer <= 0) {
      char.magnetActive = false;
      char.magnetTimer = 0;
      if (char.meshObj.magnetAura) char.meshObj.magnetAura.visible = false;
    } else {
      if (char.meshObj.magnetAura) {
        char.meshObj.magnetAura.visible = true;
        const pulseT = (performance.now() * 0.0032) % 1.0;
        const inwardScale = 2.6 * (1.0 - pulseT) + 0.35;
        char.meshObj.magnetAura.scale.set(inwardScale, inwardScale, inwardScale);
        char.meshObj.magnetAura.material.opacity = pulseT * 0.85;
      }

      const magnetRadiusSq = 7.0 * 7.0;
      for (let i = stageBlocks.length - 1; i >= 0; i--) {
        const blk = stageBlocks[i];
        if (!blk.active || blk.attracting) continue;
        if (blk.team.id === char.team.id || blk.team.id === 'neutral') {
          const dx = char.pos.x - blk.pos.x;
          const dz = char.pos.z - blk.pos.z;
          if (dx * dx + dz * dz < magnetRadiusSq && Math.abs(char.pos.y - blk.pos.y) < 3.2) {
            const poolIdx = (blk.poolIdx !== undefined) ? blk.poolIdx : floorBlockPool.indexOf(blk);
            const blockX = blk.pos.x;
            const blockZ = blk.pos.z;
            const blockId = blk.blockId || null;

            blk.attracting = true;
            blk.active = false;
            stageBlocks.splice(i, 1);

            const startVec = new THREE.Vector3(blk.mesh.position.x, blk.mesh.position.y, blk.mesh.position.z);
            activeMagnetBlocks.push({
              poolItem: blk,
              mesh: blk.mesh,
              targetChar: char,
              team: blk.team,
              startPos: startVec,
              progress: 0,
              duration: 0.55
            });

            const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
            const shouldBroadcastMagnet = char.isPlayer || (isHost && char.isAI);
            if (shouldBroadcastMagnet && typeof window !== 'undefined' && window.NetworkManager) {
              if (typeof window.NetworkManager.queueBlockPick === 'function') {
                window.NetworkManager.queueBlockPick(blockId, char.currentStage, poolIdx, blockX, blockZ);
              }
            }
          }
        }
      }
    }
  }

  // 1. スカイダイブ搭乗中物理・姿勢制御
  if (char.onSkydive && char.activeSkydive) {
    updateSkydiveMovement(scene, char, dirX, dt, soundRef, updateHUDRef);
    return;
  }

  // 2. トラップドア・フリーフォール搭乗中物理・姿勢制御
  if ((char.onTrapdoor && char.activeTrapdoor) || (char.onFreefall && char.activeFreefall)) {
    updateTrapdoorMovement(scene, char, dirX, dt, soundRef);
    return;
  }

  // 3. エレベーター搭乗中物理・姿勢制御
  if (char.onElevator && char.activeElevator) {
    updateElevatorMovement(char, dt, soundRef);
    return;
  }

  if (char.isJumping) {
    const tier = char.activeJumpTier || TRAMPOLINE_TIERS.normal;
    char.jumpProgress += dt * tier.speedRate;

    if (char.jumpProgress >= 1) {
      char.isJumping = false;
      char.currentStage = char.jumpTargetStage;
      char.pos.x = char.jumpTargetX;
      char.pos.z = STAGES[char.currentStage].z + STAGES[char.currentStage].r * 0.4;
      char.pos.y = STAGES[char.currentStage].y;
      char.lastPlankIdx = -1;
      resetCharacterPose(char);

      triggerLandingShockwave(char.pos.x, char.pos.y, char.pos.z, tier.shockRadius);

      for (let i = 0; i < characters.length; i++) {
        const other = characters[i];
        if (other !== char && other.currentStage === char.currentStage) {
          const dx = other.pos.x - char.pos.x;
          const dz = other.pos.z - char.pos.z;
          const distSq = dx * dx + dz * dz;
          if (distSq < 9.0) {
            const dist = Math.sqrt(distSq) || 1;
            other.pos.x += (dx / dist) * 1.5;
            other.pos.z += (dz / dist) * 1.5;
            other.stunTimer = Math.max(other.stunTimer, 0.8);
          }
        }
      }

      if (char.isPlayer) {
        if (soundRef) soundRef.playLanding();
        char.activeJumpTier = null;
      }
      if (!char.isPlayer) {
        char.aiState = 'COLLECT';
        char.targetLane = undefined;
        char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
      }
    } else {
      const t = char.jumpProgress;
      char.pos.x = THREE.MathUtils.lerp(char.jumpStartX, char.jumpTargetX, t);
      char.pos.z = THREE.MathUtils.lerp(char.jumpStartZ, STAGES[char.jumpTargetStage].z, t);
      const jumpHeight = tier.height;
      char.pos.y = THREE.MathUtils.lerp(char.jumpStartY, STAGES[char.jumpTargetStage].y, t) + Math.sin(t * Math.PI) * jumpHeight;

      const totalRot = tier.rotations * Math.PI * -2;
      char.meshObj.root.rotation.x = Math.sin(t * Math.PI) * totalRot;

      if (tier.id === 'high') {
        const kick = Math.sin(t * Math.PI * 4) * 0.55;
        char.meshObj.leftLeg.rotation.x = kick;
        char.meshObj.rightLeg.rotation.x = -kick;
      } else if (tier.id === 'mega') {
        if (t > 0.35 && t < 0.65) {
          char.meshObj.leftArm.rotation.z = -0.85;
          char.meshObj.rightArm.rotation.z = 0.85;
          char.meshObj.leftLeg.rotation.z = -0.32;
          char.meshObj.rightLeg.rotation.z = 0.32;
        } else {
          char.meshObj.leftArm.rotation.z = 0;
          char.meshObj.rightArm.rotation.z = 0;
          char.meshObj.leftLeg.rotation.z = 0;
          char.meshObj.rightLeg.rotation.z = 0;
        }
      }
    }
    char.meshObj.root.position.copy(char.pos);
    return;
  }

  if (char.stunTimer > 0) {
    char.stunTimer -= dt;
    char.meshObj.root.rotation.z = Math.sin(Date.now() * 0.02) * 0.4;
    char.meshObj.root.rotation.x = 0;

    if (char.onSlide) {
      const slideSpeed = 28;
      const nextZ = char.pos.z - slideSpeed * dt;
      handleCourseMovement(scene, char, char.pos.x, nextZ, 0, -1.0);
      char.meshObj.root.position.copy(char.pos);
    }
    return;
  }
  char.meshObj.root.rotation.z = 0;

  // 4. ジップライン搭乗中物理・姿勢制御
  if (char.onZipline && char.activeZipline) {
    updateZiplineMovement(scene, char, dt, soundRef, updateHUDRef);
    return;
  }

  // 5. S字カーブスライダー搭乗中物理・姿勢制御
  if (char.onCurvedSlide && char.activeCurvedBridge) {
    updateCurvedSlideMovement(scene, char, dirX, dt, soundRef, updateHUDRef);
    return;
  }

  let speed = char.speedBoostActive ? 17.0 : 10.5;

  if (char.onSlide) {
    speed = 28;
    if (char.isPlayer && soundRef) soundRef.playSlide();
  } else if (char.shrinkTimer > 0) {
    speed = 6.5;
  }

  let effectiveDirX = dirX;
  let effectiveDirZ = dirZ;
  if (char.onSlide) {
    effectiveDirZ = -1.0;
    effectiveDirX = dirX * 0.8;
  }

  const moveMag = Math.hypot(effectiveDirX, effectiveDirZ);
  if (moveMag > 0.08 || char.onSlide) {
    const turnLerp = (char.speedBoostActive && !char.onSlide) ? 0.40 : 0.22;
    char.rotation = THREE.MathUtils.lerp(char.rotation, Math.atan2(effectiveDirX, effectiveDirZ), turnLerp);
    char.meshObj.root.rotation.y = char.rotation;

    const nextX = char.pos.x + effectiveDirX * speed * dt;
    const nextZ = char.pos.z + effectiveDirZ * speed * dt;

    handleCourseMovement(scene, char, nextX, nextZ, effectiveDirX, effectiveDirZ);

    const walkCycleSpeed = (char.onSlide ? 0 : 16) * (char.speedBoostActive ? 1.75 : 1.0);
    char.walkCycle += dt * walkCycleSpeed;

    if (char.onSlide) {
      char.meshObj.leftLeg.rotation.x = -0.3;
      char.meshObj.rightLeg.rotation.x = -0.3;
      char.meshObj.leftArm.rotation.x = -0.6;
      char.meshObj.rightArm.rotation.x = -0.6;
      char.meshObj.body.position.y = 0.50;
      char.meshObj.head.position.y = 1.15;
      char.meshObj.root.rotation.x = 0.22;
      char.meshObj.root.rotation.z = -effectiveDirX * 0.35;
    } else {
      const swing = Math.sin(char.walkCycle) * 0.75;
      char.meshObj.leftLeg.rotation.x = swing;
      char.meshObj.rightLeg.rotation.x = -swing;
      char.meshObj.leftArm.rotation.x = -swing;
      char.meshObj.rightArm.rotation.x = swing;

      const bounce = Math.abs(Math.sin(char.walkCycle * 2)) * 0.12;
      char.meshObj.body.position.y = 0.65 + bounce;
      char.meshObj.head.position.y = 1.25 + bounce;

      char.meshObj.root.rotation.x = char.speedBoostActive ? 0.20 : 0;
      char.meshObj.root.rotation.z = 0;
    }
    char.meshObj.stackGroup.rotation.z = Math.sin(char.walkCycle) * 0.05;

    if (char.speedBoostActive && !char.onSlide) {
      char.puffTimer = (char.puffTimer || 0) + dt;
      if (char.puffTimer > 0.085) {
        char.puffTimer = 0;
        const backDist = 0.45;
        const puffX = char.pos.x - Math.sin(char.rotation) * backDist;
        const puffZ = char.pos.z - Math.cos(char.rotation) * backDist;
        if (spawnPuffCloud) spawnPuffCloud(puffX, char.pos.y, puffZ);
        if (spawnSpeedStepRing) spawnSpeedStepRing(char.pos.x, char.pos.y, char.pos.z);
      }
    }
  } else {
    char.meshObj.leftLeg.rotation.x = THREE.MathUtils.lerp(char.meshObj.leftLeg.rotation.x, 0, 0.2);
    char.meshObj.rightLeg.rotation.x = THREE.MathUtils.lerp(char.meshObj.rightLeg.rotation.x, 0, 0.2);
    char.meshObj.leftArm.rotation.x = THREE.MathUtils.lerp(char.meshObj.leftArm.rotation.x, 0, 0.2);
    char.meshObj.rightArm.rotation.x = THREE.MathUtils.lerp(char.meshObj.rightArm.rotation.x, 0, 0.2);
    char.meshObj.root.rotation.x = 0;
    char.meshObj.root.rotation.z = 0;
  }

  if (char.meshObj.footAura) {
    if (char.speedBoostActive) {
      char.meshObj.footAura.visible = true;
      const auraPulse = 1.0 + Math.sin(performance.now() * 0.008) * 0.12;
      char.meshObj.footAura.scale.set(auraPulse, auraPulse, auraPulse);
    } else {
      char.meshObj.footAura.visible = false;
    }
  }

  if (!char.onSlide && !char.onCurvedSlide && !char.onZipline && !char.onElevator && !char.onSkydive && !char.onTrapdoor) {
    for (let i = stageBlocks.length - 1; i >= 0; i--) {
      const blk = stageBlocks[i];
      if (!blk.active) continue;
      if ((blk.team.id === char.team.id || blk.team.id === 'neutral') && Math.abs(char.pos.y - blk.pos.y) < 1.4) {
        const dx = char.pos.x - blk.pos.x;
        const dz = char.pos.z - blk.pos.z;
        if (dx * dx + dz * dz < 2.25) {
          const poolIdx = (blk.poolIdx !== undefined) ? blk.poolIdx : floorBlockPool.indexOf(blk);
          const blockX = blk.pos.x;
          const blockZ = blk.pos.z;
          const blockId = blk.blockId || null;

          blk.active = false;
          blk.mesh.visible = false;
          blk.attracting = false;
          stageBlocks.splice(i, 1);
          addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);

          const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
          const shouldBroadcastPick = char.isPlayer || (isHost && char.isAI);
          if (shouldBroadcastPick && typeof window !== 'undefined' && window.NetworkManager) {
            if (typeof window.NetworkManager.queueBlockPick === 'function') {
              window.NetworkManager.queueBlockPick(blockId, char.currentStage, poolIdx, blockX, blockZ);
            }
          }
        }
      }
    }

    for (let i = floorItems.length - 1; i >= 0; i--) {
      const item = floorItems[i];
      if (!item.active || item.stageIdx !== char.currentStage) continue;
      if (Math.abs(char.pos.y - item.pos.y) < 2.2) {
        const dx = char.pos.x - item.pos.x;
        const dz = char.pos.z - item.pos.z;
        if (dx * dx + dz * dz < 2.89) {
          item.active = false;
          if (item.group) {
            disposeHierarchy(item.group);
            scene.remove(item.group);
          }
          const removedItem = floorItems.splice(i, 1)[0];

          const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
          const shouldBroadcastPick = char.isPlayer || (isHost && char.isAI);
          if (shouldBroadcastPick && typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive) {
            if (removedItem.itemId && typeof window.NetworkManager.queueConsumeObject === 'function') {
              window.NetworkManager.queueConsumeObject(removedItem.itemId, 'item');
            }
          }

          if (item.type === 'speed') {
            char.speedBoostActive = true;
            char.speedBoostTimer = 12.0;
            if (char.meshObj.footAura) char.meshObj.footAura.visible = true;
            addBrickToCharacter(char, char.team, 3, soundRef, updateHUDRef);
            if (char.isPlayer && soundRef) soundRef.playItemGet();
          } else if (item.type === 'attack') {
            fireHomingCrystal(char);
          } else if (item.type === 'magnet') {
            char.magnetActive = true;
            char.magnetTimer = 6.5;
            if (char.meshObj.magnetAura) char.meshObj.magnetAura.visible = true;
            if (char.isPlayer && soundRef) soundRef.playMagnetCharge();
          } else if (item.type === 'thunder') {
            fireThunderStrike(scene, char);
          }
        }
      }
    }

    checkGateCollisions(scene, char);

    checkObstacleMobCollisions(scene, char);
  }

  if (!char.isPlayer && !char.onSlide && !char.onCurvedSlide && !char.onZipline && !char.onElevator && !char.isJumping && !char.onSkydive && !char.onTrapdoor) {
    const curStage = STAGES[char.currentStage];
    if (curStage) {
      const stageBridges = bridgesByStage.get(char.currentStage) || [];
      const stgCenterX = curStage.x || 0.0;
      const distFromIsland = Math.hypot(char.pos.x - stgCenterX, char.pos.z - curStage.z);

      const isProtectedInTransit = stageBridges.some(b => {
        if (b.isTrapdoor || b.isFreefall) {
          const approachStart = b.approachStartZ !== undefined ? b.approachStartZ : (b.startZ + 16.0);
          return Math.abs(char.pos.x - stgCenterX) < 2.5 && (char.pos.z <= approachStart + 2.0 && char.pos.z >= b.startZ - 2.5);
        }
        if (b.isSkydive) {
          const lX = b.launchPoint ? b.launchPoint.x : (b.actualBridgeX !== undefined ? b.actualBridgeX : stgCenterX);
          return Math.abs(char.pos.x - lX) < 2.5 && (char.pos.z <= b.startZ + 3.0 && char.pos.z >= b.startZ - 4.0);
        }
        const laneX = (b.actualBridgeX !== undefined)
          ? b.actualBridgeX
          : ((b.isCurvedSlide || b.isZipline) ? stgCenterX : (stgCenterX + (LANES[b.laneIdx] !== undefined ? LANES[b.laneIdx] : 0.0)));
        return Math.abs(char.pos.x - laneX) < 2.2 && (char.pos.z <= b.startZ + 2.5 && char.pos.z >= b.endZ - 1.0);
      });

      if (distFromIsland > curStage.r + 2.0 && char.lastPlankIdx < 0 && !isProtectedInTransit) {
        char.pos.set(stgCenterX, curStage.y, curStage.z);
        char.lastPlankIdx = -1;
      }
    }
  }

  const currentStageObj = STAGES[char.currentStage];
  
  let targetDestY = currentStageObj ? currentStageObj.y : 0;
  const stageBridges = bridgesByStage.get(char.currentStage) || [];
  if (stageBridges.length > 0) {
    let minBridgeDestY = 999999;
    for (let bi = 0; bi < stageBridges.length; bi++) {
      const bObj = stageBridges[bi];
      const destStg = STAGES[bObj.nextStageIdx];
      if (destStg && destStg.y < minBridgeDestY) {
        minBridgeDestY = destStg.y;
      }
    }
    if (minBridgeDestY < 999999) {
      targetDestY = Math.min(targetDestY, minBridgeDestY);
    }
  } else {
    const nextStageObj = STAGES[char.currentStage + 1];
    if (nextStageObj) targetDestY = Math.min(targetDestY, nextStageObj.y);
  }
  const lowestAllowedY = targetDestY - 10.0;

  if (
    !char.onSlide &&
    !char.isJumping &&
    !char.onCurvedSlide &&
    !char.onZipline &&
    !char.onElevator &&
    !char.onSkydive &&
    !char.onTrapdoor &&
    char.pos.y < lowestAllowedY
  ) {
    if (currentStageObj) {
      const resetX = currentStageObj.x || 0.0;
      char.pos.set(resetX, currentStageObj.y, currentStageObj.z);
      char.onSlide = false;
      char.invulnerableTimer = 1.0;
    }
  }

  char.meshObj.root.position.copy(char.pos);
}