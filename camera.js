// camera.js: ダイナミック並走カメラ専用モジュール
// ★ 天空のロング下り階段（Downhill Skywalk）シネマティックパノラマ視界導入版（Phase 2 修正）：
//   1. 【天空のロング下り階段走行時のシネマティック注視点補正 (isDownhillSkywalk)】
//      Stage 6 の高台（Y=+18m）から Stage 7 の低島（Y=+2m）へ駆け下りる際、
//      注視点（LookAt）を前方奥（Z = player.pos.z - 11.5m）および下方（Y = player.pos.y - 2.2m）へシフト。
//      カメラ高度も程よく下げ（Y = player.pos.y + 20m）、前方の水平線と着地先の島が
//      画面中央〜上部40%ライン（黄金比）に収まる圧倒的な開放感とスピード感を演出。
//   2. 【着地後のシームレス・スムーズ復帰】
//      Stage 7 に上陸した瞬間、LERP補間（0.12〜0.14）によりガタつきなく
//      通常のレース追従カメラへシルクのように自然復帰。
//   3. 【カウントダウン待機中の4走者画面中央センタリング完全維持】
//   4. 【全6大アトラクション（スカイダイブ、トラップドア、エレベーター、ジップライン、スライダー、ジャンプ）の完全維持】

import {
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import {
  STAGES,
  CONNECTIONS,
  bridges,
  attackCamTimer,
  decrementAttackCamTimer
} from './world.js';

let trapdoorLandingRecoveryTimer = 0;
let wasTrapdoorLastFrame = false;

/**
 * リスタート時にカメラ内部タイマーをリセット
 */
export function resetCameraState() {
  trapdoorLandingRecoveryTimer = 0;
  wasTrapdoorLastFrame = false;
}

/**
 * 毎フレームのダイナミック追従カメラ計算
 * @param {Object} player 
 * @param {THREE.Camera} camera 
 * @param {number} dt 
 * @param {THREE.DirectionalLight} dirLight 
 * @param {THREE.Mesh} seaMesh 
 * @param {boolean} isCountdown カウントダウン待機中フラグ（任意）
 */
export function updateDynamicCamera(player, camera, dt, dirLight, seaMesh, isCountdown = false) {
  if (!player || !camera) return;

  if (dirLight) {
    dirLight.position.set(player.pos.x + 30, player.pos.y + 70, player.pos.z + 25);
    dirLight.target.position.set(player.pos.x, player.pos.y, player.pos.z);
  }

  // カウントダウン待機状態の判定（引数またはグローバルフラグから安全取得）
  const isCountdownActive = Boolean(
    isCountdown ||
    (typeof window !== 'undefined' && window.isCountdownActive)
  );

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

  // ★【Phase 2 核心】天空のロング下り階段（Downhill Skywalk）走行判定
  // 現在のステージから次の島への接続が下り階段であり、島の手前〜階段を駆け下りている状態を検出
  const isDownhillSkywalk = Boolean(
    nextConn &&
    nextConn.isDownhill &&
    !isSlideRiding &&
    !isElevator &&
    !isSkydive &&
    !isTrapdoor &&
    !isJumping &&
    !isZiplining &&
    (currentStageObj ? player.pos.z < (currentStageObj.z - currentStageObj.r * 0.4) : true)
  );

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

  // 連続的でシルクのように滑らかな追従（カクつきゼロ）
  let targetCamX = player.pos.x * 0.75;
  let targetCamY = player.pos.y + 24 + stackLift;
  let targetCamZ = player.pos.z + 12 + (stackLift * 0.6);
  let targetLookX = player.pos.x * 0.65;
  let targetLookY = player.pos.y + (stackLift * 0.3);
  let targetLookAheadZ = player.pos.z - 5;
  let targetFOV = player.speedBoostActive ? 65 : 60;

  // ★ カウントダウン待機中の専用センタリング構図
  if (isCountdownActive && player.currentStage === 0) {
    const stage0Y = currentStageObj ? currentStageObj.y : 0;
    targetCamX = 0.0;
    targetCamY = stage0Y + 16.5;
    targetCamZ = player.pos.z + 13.5;
    targetLookX = 0.0;
    targetLookY = stage0Y + 0.9;
    targetLookAheadZ = player.pos.z - 1.8;
    targetFOV = 58;
  } else if (attackCamTimer > 0) {
    decrementAttackCamTimer(dt);
    targetCamZ += 3.5;
    targetCamY += 2.0;
    targetFOV = 68;
  } else if (isJumping && player.activeJumpTier) {
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
  } else if (isDownhillSkywalk) {
    // ★【Phase 2 核心】天空のロング下り階段走行時のパノラマ注視点＆高度補正
    // 目線を海面側・前方奥へ大きく抜き、前方の海と着地先の島を画面の黄金比ラインに収める
    targetCamY = player.pos.y + 20.0 + (stackLift * 0.45);
    targetCamZ = player.pos.z + 11.2;
    targetLookY = player.pos.y - 2.2;
    targetLookAheadZ = player.pos.z - 11.5;
    targetFOV = player.speedBoostActive ? 68 : 63;
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
  const lerpFactorY = isTrapdoor ? trapdoorLerp : (isApproachingTrapdoor ? 0.20 : (isSkydive ? 0.40 : (isJumping ? 0.16 : (trapdoorLandingRecoveryTimer > 0 ? 0.18 : (isDownhillSkywalk ? 0.14 : 0.12)))));
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