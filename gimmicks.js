// gimmicks.js: 特殊アトラクション搭乗中の物理挙動・姿勢制御・ボーナス回収・着地処理モジュール（完全分離レイヤー）
// ★ Phase 4 実装版（ドロップタワー・ハッチ開放視覚同期 ＆ JUMP/アトラクション外観完全整合）：
//   1. 【ハッチ開放連動】リモート走者が `TRAPDOOR` 状態になった際、該当ステージの強化ガラスハッチ（doorLeftPivot, doorRightPivot）を開放。
//      相手が閉じている床をすり抜けて落下する違和感を解消し、着地・復帰時にはハッチを自動で閉鎖。
//   2. 【JUMP状態の付帯物クリア】大ジャンプ（`JUMP`）時にトロリーやエレベーターカゴの非表示、荷物パッキングを正常化。
//   3. 既存のボーナス消費同期（applyRemoteBonusConsumed）、滑空・落下・エレベーター・ジップライン・S字スライダー物理は100%維持。

import {
  LANES,
  ELEVATOR_CONFIG,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import {
  _tempVec3A,
  _tempVec3C
} from './materials.js';
import { 
  STAGES,
  bridgesByStage,
  skydiveBonusBlocks,
  ziplineBonusBlocks,
  curvedSlideBonusBlocks,
  slideBonusBlocks
} from './world.js';
import {
  addBrickToCharacter,
  applySkydivePose,
  applyTrapdoorPose,
  resetCharacterPose,
  packCharacterLuggage
} from './character.js';
import { triggerLandingShockwave } from './particles.js';

/**
 * ★【Phase 4 拡張】リモート走者（他端末またはホストAI）のアトラクション状態ビットに応じた外観・メッシュ連動
 */
export function applyRemoteGimmickVisuals(char, state, timeSec) {
  if (!char || !char.meshObj) return;

  const mo = char.meshObj;

  // ★【Phase 4 核心】TRAPDOOR終了時のハッチ自動閉鎖判定
  if (char._lastRemoteActionState === 'TRAPDOOR' && state !== 'TRAPDOOR') {
    for (let sIdx = Math.max(0, char.currentStage - 1); sIdx <= char.currentStage + 1; sIdx++) {
      const stageBridges = bridgesByStage.get(sIdx) || [];
      const trapB = stageBridges.find(b => b.isTrapdoor || b.isFreefall);
      if (trapB && trapB.doorLeftPivot && trapB.doorRightPivot) {
        trapB.isHatchOpen = false;
        trapB.hatchOpenProgress = 0;
        trapB.doorLeftPivot.rotation.z = 0;
        trapB.doorRightPivot.rotation.z = 0;
      }
    }
  }
  char._lastRemoteActionState = state;

  if (state === 'SKYDIVE') {
    if (mo.trolleyGroup) mo.trolleyGroup.visible = false;
    if (mo.elevatorGroup) mo.elevatorGroup.visible = false;
    packCharacterLuggage(char, 1.0);
    applySkydivePose(char, 0, 0);
  } else if (state === 'TRAPDOOR') {
    if (mo.trolleyGroup) mo.trolleyGroup.visible = false;
    if (mo.elevatorGroup) mo.elevatorGroup.visible = false;
    packCharacterLuggage(char, 1.0);
    applyTrapdoorPose(char, 0, timeSec);

    // ★【Phase 4 核心】リモート走者がドロップタワーに落下した際、該当ステージのハッチ扉を開放
    for (let sIdx = Math.max(0, char.currentStage - 1); sIdx <= char.currentStage + 1; sIdx++) {
      const stageBridges = bridgesByStage.get(sIdx) || [];
      const trapB = stageBridges.find(b => b.isTrapdoor || b.isFreefall);
      if (trapB && trapB.doorLeftPivot && trapB.doorRightPivot) {
        trapB.isHatchOpen = true;
        const maxOpenAngle = Math.PI * 0.53;
        trapB.doorLeftPivot.rotation.z = maxOpenAngle;
        trapB.doorRightPivot.rotation.z = -maxOpenAngle;
      }
    }
  } else if (state === 'ELEVATOR') {
    if (mo.elevatorGroup) mo.elevatorGroup.visible = true;
    if (mo.trolleyGroup) mo.trolleyGroup.visible = false;
    packCharacterLuggage(char, 0);
    mo.leftArm.position.set(-0.42, 0.82, -0.35);
    mo.rightArm.position.set(0.42, 0.82, -0.35);
    mo.leftArm.rotation.set(0.7, 0, -0.15);
    mo.rightArm.rotation.set(0.7, 0, 0.15);
    mo.leftLeg.rotation.set(0, 0, 0);
    mo.rightLeg.rotation.set(0, 0, 0);
  } else if (state === 'ZIPLINE') {
    if (mo.trolleyGroup) mo.trolleyGroup.visible = true;
    if (mo.elevatorGroup) mo.elevatorGroup.visible = false;
    mo.stackGroup.scale.set(0.65, 0.65, 0.65);
    mo.stackGroup.rotation.x = -Math.PI * 0.28;
    mo.stackGroup.position.set(0, 0.55, -0.45);
    const legKick = Math.sin(timeSec * 16) * 0.65;
    mo.leftLeg.rotation.x = legKick - 0.25;
    mo.rightLeg.rotation.x = -legKick - 0.25;
    mo.leftArm.position.set(-0.56, 1.275, 0.06);
    mo.rightArm.position.set(0.56, 1.275, 0.06);
    mo.leftArm.scale.set(0.85, 3.80, 0.85);
    mo.rightArm.scale.set(0.85, 3.80, 0.85);
    mo.leftArm.rotation.set(-0.15, 0, 0.314);
    mo.rightArm.rotation.set(-0.15, 0, -0.314);
  } else if (state === 'SLIDE') {
    if (mo.trolleyGroup) mo.trolleyGroup.visible = false;
    if (mo.elevatorGroup) mo.elevatorGroup.visible = false;
    packCharacterLuggage(char, 0);
    mo.leftLeg.rotation.x = -0.35;
    mo.rightLeg.rotation.x = -0.35;
    mo.leftArm.rotation.x = -0.65;
    mo.rightArm.rotation.x = -0.65;
    mo.body.position.y = 0.50;
    mo.head.position.y = 1.15;
    mo.root.rotation.x = 0.22;
  } else if (state === 'JUMP') {
    if (mo.trolleyGroup) mo.trolleyGroup.visible = false;
    if (mo.elevatorGroup) mo.elevatorGroup.visible = false;
    packCharacterLuggage(char, 0);
  } else {
    // NORMAL
    if (mo.trolleyGroup && mo.trolleyGroup.visible) mo.trolleyGroup.visible = false;
    if (mo.elevatorGroup && mo.elevatorGroup.visible) mo.elevatorGroup.visible = false;
    packCharacterLuggage(char, 0);
  }
}

// 1. スカイダイブ（前進放物線滑空・エアコントロール・ロール・ボーナス回収・着地）
export function updateSkydiveMovement(scene, char, dirX, dt, soundRef, updateHUDRef) {
  const b = char.activeSkydive;
  const totalFlyTime = SKYDIVE_CONFIG.PHYSICS.totalDuration;
  char.skydiveProgress += dt / totalFlyTime;

  if (b.bonusBlocks && b.bonusBlocks.length > 0) {
    for (let si = 0; si < b.bonusBlocks.length; si++) {
      const blk = b.bonusBlocks[si];
      if (!blk.collected) {
        const progDiff = Math.abs(blk.t - char.skydiveProgress);
        const xDiff = Math.abs(blk.x - char.skydiveX);
        if (progDiff < 0.055 && xDiff < 1.45) {
          blk.collected = true;
          scene.remove(blk.mesh);
          addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);
          if (char.isPlayer && soundRef) {
            soundRef.playCollect(1.2 + blk.t * 0.8);
          }

          const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
          const shouldBroadcastPick = char.isPlayer || (isHost && char.isAI);
          if (shouldBroadcastPick && typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive) {
            if (blk.bonusId) {
              window.NetworkManager.broadcastConsumeObject(blk.bonusId, 'bonus');
            }
          }
        }
      }
    }
  }

  if (char.skydiveProgress >= 1.0) {
    char.onSkydive = false;
    char.currentStage = b.nextStageIdx;
    const nextStageObj = STAGES[b.nextStageIdx];
    const destCenterX = nextStageObj ? (nextStageObj.x || 0.0) : 0.0;
    char.pos.set(destCenterX, nextStageObj.y, nextStageObj.z + nextStageObj.r * 0.4);
    char.slideCooldown = 0.5;
    char.lastPlankIdx = -1;
    char.activeSkydive = null;

    triggerLandingShockwave(char.pos.x, char.pos.y, char.pos.z, 3.8, 0x0066ff);
    if (char.isPlayer && soundRef) {
      soundRef.playLanding();
      soundRef.stopSkydiveGlide();
    }

    resetCharacterPose(char);

    if (!char.isPlayer) {
      char.aiState = 'COLLECT';
      char.targetLane = undefined;
      char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
    }
  } else {
    const t = Math.min(0.999, Math.max(0, char.skydiveProgress));

    const packProg = Math.min(1.0, char.skydiveProgress / (0.40 / totalFlyTime));
    packCharacterLuggage(char, packProg);

    const airSpeed = SKYDIVE_CONFIG.PHYSICS.horizontalAirControlSpeed;
    const maxAirX = SKYDIVE_CONFIG.PHYSICS.maxAirOffsetX;
    const launchX = b.launchPoint ? b.launchPoint.x : 0;
    char.skydiveX = Math.max(launchX - maxAirX, Math.min(launchX + maxAirX, char.skydiveX + dirX * airSpeed * dt));

    const targetRoll = -dirX * SKYDIVE_CONFIG.PHYSICS.maxRollAngle;
    char.skydiveRoll = THREE.MathUtils.lerp(char.skydiveRoll || 0, targetRoll, 0.25);

    const pZ = THREE.MathUtils.lerp(b.startZ, b.endZ, t);
    const fallPower = SKYDIVE_CONFIG.PHYSICS.gravityPower;
    const hop = Math.sin(t * Math.PI) * (SKYDIVE_CONFIG.PHYSICS.hopHeight || 3.5);
    const pY = b.startY + (b.endY - b.startY) * Math.pow(t, fallPower) + hop;
    char.pos.set(char.skydiveX, pY, pZ);

    applySkydivePose(char, dirX, char.skydiveRoll);
  }
  char.meshObj.root.position.copy(char.pos);
}

// 2. トラップドア・フリーフォール（ハッチ開放・垂直超重力自由落下・あがき姿勢・着地）
export function updateTrapdoorMovement(scene, char, dirX, dt, soundRef) {
  const b = char.activeTrapdoor || char.activeFreefall;

  if (b.doorLeftPivot && b.doorRightPivot) {
    b.hatchOpenProgress = Math.min(1.0, (b.hatchOpenProgress || 0) + dt / TRAPDOOR_CONFIG.HATCH.openDuration);
    const maxOpenAngle = Math.PI * 0.53;
    const angle = b.hatchOpenProgress * maxOpenAngle;
    b.doorLeftPivot.rotation.z = angle;
    b.doorRightPivot.rotation.z = -angle;
  }

  const totalFlyTime = TRAPDOOR_CONFIG.PHYSICS.totalDuration;
  char.trapdoorProgress = (char.trapdoorProgress || char.freefallProgress || 0) + dt / totalFlyTime;

  if (char.trapdoorProgress >= 1.0) {
    char.onTrapdoor = false;
    char.onFreefall = false;
    char.currentStage = b.nextStageIdx;
    const nextStageObj = STAGES[b.nextStageIdx];
    const destCenterX = nextStageObj ? (nextStageObj.x || 0.0) : 0.0;
    char.pos.set(destCenterX, nextStageObj.y, nextStageObj.z + nextStageObj.r * 0.4);
    char.slideCooldown = 0.5;
    char.lastPlankIdx = -1;

    b.isHatchOpen = false;
    b.hatchOpenProgress = 0;
    if (b.doorLeftPivot && b.doorRightPivot) {
      b.doorLeftPivot.rotation.z = 0;
      b.doorRightPivot.rotation.z = 0;
    }

    char.activeTrapdoor = null;
    char.activeFreefall = null;

    triggerLandingShockwave(char.pos.x, char.pos.y, char.pos.z, 3.8, 0x0284c7);
    if (char.isPlayer && soundRef) {
      soundRef.playLanding();
      soundRef.stopTrapdoorFall();
    }

    resetCharacterPose(char);

    if (!char.isPlayer) {
      char.aiState = 'COLLECT';
      char.targetLane = undefined;
      char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
    }
  } else {
    const t = Math.min(0.999, Math.max(0, char.trapdoorProgress));

    const packProg = Math.min(1.0, char.trapdoorProgress / (0.35 / totalFlyTime));
    packCharacterLuggage(char, packProg);

    const airSpeed = TRAPDOOR_CONFIG.PHYSICS.horizontalAirControlSpeed;
    const maxAirX = TRAPDOOR_CONFIG.PHYSICS.maxAirOffsetX;
    const hatchX = b.hatchCenter ? b.hatchCenter.x : 0;
    if (t < 0.28) {
      char.trapdoorX = hatchX;
    } else {
      char.trapdoorX = Math.max(hatchX - maxAirX, Math.min(hatchX + maxAirX, (char.trapdoorX || hatchX) + dirX * airSpeed * dt));
    }

    const pZ = b.startZ;

    const introT = 0.22;
    let effectiveFallT = 0;
    if (t < introT) {
      effectiveFallT = Math.pow(t / introT, 1.4) * 0.08;
    } else {
      const frac = (t - introT) / (1.0 - introT);
      effectiveFallT = 0.08 + Math.pow(frac, 2.4) * 0.92;
    }

    const pY = b.startY + (b.endY - b.startY) * effectiveFallT;
    char.pos.set(char.trapdoorX, pY, pZ);

    const timeSec = performance.now() * 0.001;
    applyTrapdoorPose(char, dirX, timeSec);
  }
  char.meshObj.root.position.copy(char.pos);
}

// 3. エレベーター（デッキ昇降・イージングバウンス・手すり掴み姿勢・下車歩行）
export function updateElevatorMovement(char, dt, soundRef) {
  const b = char.activeElevator;
  const laneData = b.elevators.find(e => e.laneIdx === char.elevatorLane) || b.elevators[0];
  const curStg = STAGES[b.stageIdx];
  const bCenterX = curStg ? (curStg.x || 0.0) : 0.0;

  if (char.elevatorExiting) {
    char.elevatorExitTimer -= dt;
    const exitProgress = 1.0 - (char.elevatorExitTimer / ELEVATOR_CONFIG.EASING.exitDelay);

    char.pos.z = b.endZ - 1.0 - exitProgress * 1.8;
    char.pos.y = STAGES[b.nextStageIdx].y;

    char.meshObj.root.rotation.set(0, Math.PI, 0);

    const armSwing = Math.sin(exitProgress * 14) * 0.55;
    char.meshObj.leftArm.position.set(-0.48, 0.68, 0);
    char.meshObj.rightArm.position.set(0.48, 0.68, 0);
    char.meshObj.leftArm.rotation.set(armSwing, 0, 0);
    char.meshObj.rightArm.rotation.set(-armSwing, 0, 0);
    char.meshObj.leftLeg.rotation.set(-armSwing, 0, 0);
    char.meshObj.rightLeg.rotation.set(armSwing, 0, 0);

    if (char.elevatorExitTimer <= 0) {
      char.onElevator = false;
      char.elevatorExiting = false;
      char.currentStage = b.nextStageIdx;
      const nextStageObj = STAGES[b.nextStageIdx];
      const destCenterX = nextStageObj ? (nextStageObj.x || 0.0) : 0.0;
      char.pos.set(destCenterX + LANES[char.elevatorLane] * 0.6, nextStageObj.y, nextStageObj.z + nextStageObj.r * 0.4);
      char.slideCooldown = 0.5;
      char.lastPlankIdx = -1;
      char.activeElevator = null;
      char.meshObj.elevatorGroup.visible = false;

      resetCharacterPose(char);

      if (!char.isPlayer) {
        char.aiState = 'COLLECT';
        char.targetLane = undefined;
        char.elevatorChoice = undefined;
        char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
      }
    }
    char.meshObj.root.position.copy(char.pos);
    return;
  }

  char.elevatorProgress += dt / laneData.duration;
  char.meshObj.elevatorGroup.visible = true;

  if (char.elevatorProgress >= 1.0) {
    char.elevatorExiting = true;
    char.elevatorExitTimer = ELEVATOR_CONFIG.EASING.exitDelay;
    char.pos.set(bCenterX + LANES[char.elevatorLane], b.endY + 0.10, b.endZ - 1.0);

    triggerLandingShockwave(char.pos.x, b.endY, b.endZ - 1.0, 1.8);
    if (char.isPlayer && soundRef) soundRef.playElevatorArrival();
  } else {
    const rawT = Math.min(0.999, Math.max(0, char.elevatorProgress));

    const easeT = rawT < 0.5
      ? 2 * rawT * rawT
      : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

    const pZ = THREE.MathUtils.lerp(b.startZ + 1.0, b.endZ - 1.0, easeT);
    let pY = THREE.MathUtils.lerp(b.startY, b.endY, easeT);

    if (rawT > 0.88) {
      const bouncePhase = (rawT - 0.88) / 0.12;
      pY += Math.sin(bouncePhase * Math.PI) * ELEVATOR_CONFIG.EASING.arrivalBounceHeight;
    }

    char.pos.set(bCenterX + LANES[char.elevatorLane], pY + 0.10, pZ);

    char.meshObj.root.rotation.set(0, Math.PI, 0);
    char.meshObj.leftLeg.rotation.set(0, 0, 0);
    char.meshObj.rightLeg.rotation.set(0, 0, 0);

    char.meshObj.leftArm.position.set(-0.42, 0.82, -0.35);
    char.meshObj.rightArm.position.set(0.42, 0.82, -0.35);
    char.meshObj.leftArm.rotation.set(0.7, 0, -0.15);
    char.meshObj.rightArm.rotation.set(0.7, 0, 0.15);
    char.meshObj.body.position.y = 0.65;
    char.meshObj.head.position.y = 1.25;

    if (char.isPlayer && soundRef) {
      const speedRatio = Math.sin(rawT * Math.PI);
      soundRef.playElevatorMotor(speedRatio);
    }
  }

  char.meshObj.root.position.copy(char.pos);
}

// 4. ジップライン（ケーブル滑走・トロリー追従・足バタバタ・ボーナス回収・着地）
export function updateZiplineMovement(scene, char, dt, soundRef, updateHUDRef) {
  const zip = char.activeZipline;
  const totalFlyTime = 3.25;
  char.ziplineProgress += dt / totalFlyTime;

  char.meshObj.stackGroup.scale.set(0.65, 0.65, 0.65);
  char.meshObj.stackGroup.rotation.x = -Math.PI * 0.28;
  char.meshObj.stackGroup.position.set(0, 0.55, -0.45);

  if (char.meshObj.trolleyGroup) {
    char.meshObj.trolleyGroup.visible = true;
  }

  if (zip.bonusBlocks && zip.bonusBlocks.length > 0) {
    for (let bi = 0; bi < zip.bonusBlocks.length; bi++) {
      const blk = zip.bonusBlocks[bi];
      if (!blk.collected) {
        if (Math.abs(blk.t - char.ziplineProgress) < 0.048) {
          blk.collected = true;
          scene.remove(blk.mesh);
          addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);
          if (char.isPlayer && soundRef) {
            soundRef.playCollect(1.25 + blk.t * 0.65);
          }

          const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
          const shouldBroadcastPick = char.isPlayer || (isHost && char.isAI);
          if (shouldBroadcastPick && typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive) {
            if (blk.bonusId) {
              window.NetworkManager.broadcastConsumeObject(blk.bonusId, 'bonus');
            }
          }
        }
      }
    }
  }

  if (char.ziplineProgress >= 1.0) {
    char.onZipline = false;
    char.currentStage = zip.nextStageIdx;
    const nextStageObj = STAGES[zip.nextStageIdx];

    const landZ = nextStageObj.z + nextStageObj.r * 0.45;
    const destCenterX = nextStageObj.x || 0.0;
    char.pos.set(destCenterX, nextStageObj.y, landZ);
    char.slideCooldown = 0.5;
    char.lastPlankIdx = -1;
    char.activeZipline = null;

    if (char.meshObj.trolleyGroup) {
      char.meshObj.trolleyGroup.visible = false;
    }
    char.meshObj.stackGroup.scale.set(1.0, 1.0, 1.0);
    char.meshObj.stackGroup.rotation.x = 0;
    char.meshObj.stackGroup.position.set(0, 0.65, -0.42);

    resetCharacterPose(char);

    triggerLandingShockwave(char.pos.x, nextStageObj.y, landZ, 1.8);
    if (char.isPlayer && soundRef) {
      soundRef.playLanding();
    }

    if (!char.isPlayer) {
      char.aiState = 'COLLECT';
      char.targetLane = undefined;
      char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
    }
  } else {
    const t = Math.min(0.999, Math.max(0, char.ziplineProgress));
    _tempVec3A.lerpVectors(zip.startPt, zip.endPt, t);

    char.pos.set(_tempVec3A.x, _tempVec3A.y - 2.15, _tempVec3A.z);

    const nowSec = performance.now() * 0.001;
    const legKick = Math.sin(nowSec * 16) * 0.65;
    char.meshObj.leftLeg.rotation.x = legKick - 0.25;
    char.meshObj.rightLeg.rotation.x = -legKick - 0.25;

    char.meshObj.leftArm.position.set(-0.56, 1.275, 0.06);
    char.meshObj.rightArm.position.set(0.56, 1.275, 0.06);
    char.meshObj.leftArm.scale.set(0.85, 3.80, 0.85);
    char.meshObj.rightArm.scale.set(0.85, 3.80, 0.85);
    char.meshObj.leftArm.rotation.set(-0.15, 0, 0.314);
    char.meshObj.rightArm.rotation.set(-0.15, 0, -0.314);

    char.meshObj.root.rotation.y = Math.PI;
    char.meshObj.root.rotation.x = 0.18;
    char.meshObj.root.rotation.z = Math.sin(nowSec * 7) * 0.12;

    if (char.isPlayer && soundRef) {
      soundRef.playZipline(t);
    }
  }

  char.meshObj.root.position.copy(char.pos);
}

// 5. S字カーブスライダー（スプラインLUT補間滑走・左右シフト・バンクロール・ボーナス回収・着地）
export function updateCurvedSlideMovement(scene, char, dirX, dt, soundRef, updateHUDRef) {
  const b = char.activeCurvedBridge;
  const slideSpeed = 31.0;
  const progressDelta = (slideSpeed * dt) / Math.max(10, b.curveLength);
  char.curvedSlideProgress += progressDelta;

  if (char.curvedSlideProgress >= 1.0) {
    char.onCurvedSlide = false;
    char.currentStage = b.nextStageIdx;
    const nextStageObj = STAGES[b.nextStageIdx];
    const destCenterX = nextStageObj.x || 0.0;
    char.pos.set(destCenterX + char.curvedSlideOffset * 0.6, nextStageObj.y, nextStageObj.z + nextStageObj.r * 0.4);
    char.slideCooldown = 1.4;
    char.lastPlankIdx = -1;
    char.activeCurvedBridge = null;

    if (!char.isPlayer) {
      char.aiState = 'COLLECT';
      char.targetLane = undefined;
      char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
    }
  } else {
    const t = Math.min(0.999, Math.max(0, char.curvedSlideProgress));

    let ptX, ptY, ptZ, tanX, tanZ;
    if (b.lutSamples && b.lutSamples.length > 1) {
      const lutCount = b.lutSamples.length - 1;
      const fIdx = t * lutCount;
      const i0 = Math.floor(fIdx);
      const i1 = Math.min(i0 + 1, lutCount);
      const frac = fIdx - i0;
      const s0 = b.lutSamples[i0];
      const s1 = b.lutSamples[i1];

      ptX = s0.x + (s1.x - s0.x) * frac;
      ptY = s0.y + (s1.y - s0.y) * frac;
      ptZ = s0.z + (s1.z - s0.z) * frac;
      _tempVec3C.x = s0.nx + (s1.nx - s0.nx) * frac;
      _tempVec3C.y = 0;
      _tempVec3C.z = s0.nz + (s1.nz - s0.nz) * frac;
      tanX = s0.tx + (s1.tx - s0.tx) * frac;
      tanZ = s0.tz + (s1.tz - s0.tz) * frac;
    } else {
      const pt = b.curve.getPointAt(t);
      const tangent = b.curve.getTangentAt(t).normalize();
      ptX = pt.x; ptY = pt.y; ptZ = pt.z;
      tanX = tangent.x; tanZ = tangent.z;
      _tempVec3C.set(-tangent.z, 0, tangent.x).normalize();
    }

    char.curvedSlideOffset = Math.max(-1.6, Math.min(1.6, char.curvedSlideOffset + dirX * 12 * dt));

    char.pos.set(
      ptX + _tempVec3C.x * char.curvedSlideOffset,
      ptY + 0.18,
      ptZ + _tempVec3C.z * char.curvedSlideOffset
    );

    if (b.bonusBlocks && b.bonusBlocks.length > 0) {
      for (let bi = 0; bi < b.bonusBlocks.length; bi++) {
        const blk = b.bonusBlocks[bi];
        if (!blk.collected) {
          const progDiff = Math.abs(blk.t - char.curvedSlideProgress);
          const offsetDiff = Math.abs(blk.offset - char.curvedSlideOffset);
          if (progDiff < 0.045 && offsetDiff < 0.95) {
            blk.collected = true;
            scene.remove(blk.mesh);
            addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);
            if (char.isPlayer && soundRef) {
              soundRef.playCollect(1.2 + blk.t * 0.6);
            }

            const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
            const shouldBroadcastPick = char.isPlayer || (isHost && char.isAI);
            if (shouldBroadcastPick && typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive) {
              if (blk.bonusId) {
                window.NetworkManager.broadcastConsumeObject(blk.bonusId, 'bonus');
              }
            }
          }
        }
      }
    }

    char.rotation = Math.atan2(tanX, tanZ);
    char.meshObj.root.rotation.y = char.rotation;
    char.meshObj.root.rotation.z = -dirX * 0.35 - (_tempVec3C.x * 0.2);
    char.meshObj.root.rotation.x = 0.25;

    char.meshObj.leftLeg.rotation.x = -0.35;
    char.meshObj.rightLeg.rotation.x = -0.35;
    char.meshObj.leftArm.rotation.x = -0.65;
    char.meshObj.rightArm.rotation.x = -0.65;
    char.meshObj.body.position.y = 0.50;
    char.meshObj.head.position.y = 1.15;

    if (char.isPlayer && soundRef) soundRef.playSlide();
  }

  char.meshObj.root.position.copy(char.pos);
}

/**
 * 他端末で消費されたボーナスブロックの強制消去ハンドラ
 */
export function applyRemoteBonusConsumed(objectId) {
  if (!objectId) return;
  const arrays = [skydiveBonusBlocks, ziplineBonusBlocks, curvedSlideBonusBlocks, slideBonusBlocks];
  for (let i = 0; i < arrays.length; i++) {
    const arr = arrays[i];
    if (!arr) continue;
    const idx = arr.findIndex(b => b.bonusId === objectId);
    if (idx !== -1) {
      const blk = arr[idx];
      if (!blk.collected) {
        blk.collected = true;
        if (blk.mesh) {
          blk.mesh.visible = false;
          if (blk.mesh.parent) {
            blk.mesh.parent.remove(blk.mesh);
          }
        }
      }
      break;
    }
  }
}

if (typeof window !== 'undefined') {
  window.applyRemoteBonusConsumed = applyRemoteBonusConsumed;
}