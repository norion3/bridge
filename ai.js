// Bot AI自律思考ロジック・レーン評価・スカイダイブ＆ドロップタワー進入・空中姿勢同期・自然な自律追走・スタック回避・進入アライメント誘導
import {
  LANES,
  ELEVATOR_CONFIG,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import { _tempAvoidResult } from './materials.js';
import { characters, player, addBrickToCharacter } from './character.js';
import {
  STAGES,
  CONNECTIONS,
  bridgesByStage,
  modifierGates,
  getFloorBlocksForStage,
  floorItems
} from './world.js';
import { updateSingleCharacter } from './systems.js';

export function evaluateBestLaneForBot(bot) {
  const laneScores = [0, 0, 0];
  let validBridgeCount = 0;

  const stageBridges = bridgesByStage.get(bot.currentStage) || [];

  for (let bIdx = 0; bIdx < stageBridges.length; bIdx++) {
    const b = stageBridges[bIdx];
    if (
      b.isJump ||
      b.isSlide ||
      b.isCurvedSlide ||
      b.isZipline ||
      b.isElevator ||
      b.isSkydive ||
      b.isTrapdoor ||
      b.isFreefall
    ) {
      continue;
    }

    validBridgeCount++;
    const lane = b.laneIdx;
    let myPlanks = 0, playerPlanks = 0, emptyPlanks = 0, otherBotPlanks = 0;

    for (let pIdx = 0; pIdx < b.planks.length; pIdx++) {
      const teamId = b.planks[pIdx].teamId;
      if (teamId === bot.team.id) myPlanks++;
      else if (teamId === 'blue') playerPlanks++;
      else if (!teamId) emptyPlanks++;
      else otherBotPlanks++;
    }

    laneScores[lane] += myPlanks * 2.8;
    if (myPlanks === 0 && playerPlanks === 0 && otherBotPlanks === 0) laneScores[lane] += 6.5;
    if (playerPlanks > 0 && bot.stackCount >= 8) laneScores[lane] += 3.5;

    for (let cIdx = 0; cIdx < characters.length; cIdx++) {
      const otherChar = characters[cIdx];
      if (!otherChar.isPlayer && otherChar !== bot && otherChar.currentStage === bot.currentStage) {
        if (otherChar.aiState === 'BUILD' && otherChar.targetLane === lane) {
          laneScores[lane] -= 8;
        }
      }
    }

    laneScores[lane] += Math.random() * 3.0;
  }

  if (validBridgeCount === 0) return Math.floor(Math.random() * 3);

  let bestLane = 0, maxScore = -999;
  for (let i = 0; i < 3; i++) {
    if (laneScores[i] > maxScore) { maxScore = laneScores[i]; bestLane = i; }
  }
  return bestLane;
}

export function avoidGateObstacles(bot, dirX, dirZ) {
  let avoidX = 0, avoidZ = 0;
  for (let i = 0; i < modifierGates.length; i++) {
    const g = modifierGates[i];
    if (g.consumed || g.stageIdx !== bot.currentStage) continue;
    const posts = [g.pos.x - 1.3, g.pos.x + 1.3];
    for (let j = 0; j < posts.length; j++) {
      const px = posts[j], pz = g.pos.z;
      const dx = bot.pos.x - px, dz = bot.pos.z - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq < 1.44 && distSq > 0.000001) {
        const dist = Math.sqrt(distSq);
        const push = (1.20 - dist) / 1.20;
        avoidX += (dx / dist) * push * 1.8;
        avoidZ += (dz / dist) * push * 1.8;
        const tangentSign = (dx >= 0) ? 1.0 : -1.0;
        avoidX += (-dz / dist) * push * 1.2 * tangentSign;
        avoidZ += (dx / dist) * push * 1.2 * tangentSign;
      }
    }
  }
  const finalX = dirX + avoidX;
  const finalZ = dirZ + avoidZ;
  const magSq = finalX * finalX + finalZ * finalZ;
  const mag = magSq > 0.0001 ? Math.sqrt(magSq) : 1;
  _tempAvoidResult.x = finalX / mag;
  _tempAvoidResult.z = finalZ / mag;
  return _tempAvoidResult;
}

export function updateAICharacter(scene, bot, dt, spawnPuffCloud, spawnSpeedStepRing) {
  // ★ 自然なキャッチアップ走破：プレイヤーより後ろのステージにいる場合、ワープではなく走行・走破速度を1.25倍に自然ブースト
  const isLaggingBehind = (player && bot.currentStage < player.currentStage);
  const effectiveDt = isLaggingBehind ? dt * 1.25 : dt;

  if (
    bot.onSkydive ||
    bot.onTrapdoor ||
    bot.onCurvedSlide ||
    bot.onZipline ||
    bot.onElevator ||
    bot.onFreefall
  ) {
    let steerX = 0;

    if (bot.onSkydive && bot.activeSkydive) {
      const timeSec = performance.now() * 0.0018 + bot.team.hex;
      steerX = Math.sin(timeSec) * 0.35;
    } else if (bot.onTrapdoor && bot.activeTrapdoor) {
      const currentX = bot.trapdoorX || 0;
      steerX = -Math.sign(currentX) * Math.min(0.35, Math.abs(currentX) * 0.5);
    } else if (bot.onCurvedSlide) {
      const targetOffset = bot.botSlideOffsetTarget || 0;
      const diff = targetOffset - bot.curvedSlideOffset;
      steerX = Math.abs(diff) > 0.08 ? Math.sign(diff) * 0.45 : 0;
    } else if (bot.onFreefall && bot.activeFreefall) {
      const currentX = bot.freefallX || 0;
      steerX = -Math.sign(currentX) * 0.3;
    }

    updateSingleCharacter(scene, bot, steerX, -1.0, effectiveDt, spawnPuffCloud, spawnSpeedStepRing);
    return;
  }

  // ★ Unstuck回避ステップ実行中の処理（障害物や引っかかりから即時脱出）
  if (bot.unstuckTimer > 0) {
    bot.unstuckTimer -= effectiveDt;
    updateSingleCharacter(scene, bot, bot.unstuckDirX, bot.unstuckDirZ, effectiveDt, spawnPuffCloud, spawnSpeedStepRing);
    return;
  }

  // ★ AIスタック（棒立ち・停止）検知ルーチン（0.3秒で0.18m未満しか進めていない場合に発動）
  if (!bot.lastPosCheck) {
    bot.lastPosCheck = new THREE.Vector3().copy(bot.pos);
    bot.stuckCheckTimer = 0;
  }

  bot.stuckCheckTimer = (bot.stuckCheckTimer || 0) + effectiveDt;
  if (bot.stuckCheckTimer >= 0.30) {
    const movedDist = Math.hypot(bot.pos.x - bot.lastPosCheck.x, bot.pos.z - bot.lastPosCheck.z);
    if (movedDist < 0.18) {
      // 0.3秒間でほぼ前進できていない（壁・柱・外周エッジに引っかかりデッドロック）
      bot.unstuckTimer = 0.35;
      const curDirX = bot.aiDirX || 0;
      const curDirZ = bot.aiDirZ || -1;
      const sideSign = (Math.random() < 0.5 ? 1 : -1);
      // 側方・斜め後方へ迂回脱出するステップベクトルを生成
      bot.unstuckDirX = -curDirZ * sideSign * 0.85 - curDirX * 0.35;
      bot.unstuckDirZ = curDirX * sideSign * 0.85 - curDirZ * 0.35;
      const uMag = Math.hypot(bot.unstuckDirX, bot.unstuckDirZ) || 1;
      bot.unstuckDirX /= uMag;
      bot.unstuckDirZ /= uMag;

      // ターゲットをリセットして停滞原因を完全解除
      bot.targetBlock = null;
      bot.searchCooldown = 0;
    }
    bot.lastPosCheck.copy(bot.pos);
    bot.stuckCheckTimer = 0;
  }

  const stage = STAGES[bot.currentStage];
  if (!stage) return;

  const stageBridges = bridgesByStage.get(bot.currentStage) || [];
  const activeBridge = stageBridges.find(b =>
    !b.isCurvedSlide &&
    !b.isZipline &&
    !b.isElevator &&
    !b.isSkydive &&
    !b.isTrapdoor &&
    !b.isFreefall &&
    bot.pos.z <= b.startZ + 1.5 &&
    bot.pos.z >= b.endZ - 0.5 &&
    Math.abs(bot.pos.x - LANES[b.laneIdx]) < 2.5
  );

  const nextConn = CONNECTIONS.find(c => c.from === bot.currentStage);
  const isVerticalNext = (nextConn && nextConn.type === 'vertical');

  if (nextConn) {
    if (nextConn.type === 'slide') {
      bot.aiState = 'BUILD';
      if (bot.targetLane === undefined) bot.targetLane = Math.floor(Math.random() * 3);
    } else if (
      nextConn.type === 'skydive' ||
      nextConn.type === 'trapdoor' ||
      nextConn.type === 'curved_slide' ||
      nextConn.type === 'zipline' ||
      nextConn.type === 'elevator' ||
      nextConn.type === 'freefall'
    ) {
      bot.aiState = 'BUILD';
      bot.targetLane = 1;
      bot.aiCapacityGoal = 0;
    } else if (nextConn.type === 'jump') {
      bot.aiState = 'BUILD';
      if (bot.targetLane === undefined) bot.targetLane = Math.floor(Math.random() * 3);
      bot.aiCapacityGoal = 0;
    } else if (isVerticalNext) {
      if (bot.aiCapacityGoal < 18) bot.aiCapacityGoal = 18 + Math.floor(Math.random() * 4);
    }
  }

  if (bot.aiState === 'COLLECT') {
    // 遅れている時はブロックを集めすぎず、迅速に階段へ向かえるようゴール数を効率化
    const effectiveGoal = isLaggingBehind ? Math.min(bot.aiCapacityGoal, 12) : bot.aiCapacityGoal;
    const threshold = isVerticalNext ? Math.max(18, effectiveGoal) : effectiveGoal;
    if (bot.stackCount >= threshold) {
      bot.aiState = 'BUILD';
      bot.targetLane = evaluateBestLaneForBot(bot);
      bot.targetBlock = null;
      bot.elevatorChoice = undefined;
      return;
    }

    if (activeBridge && bot.pos.z < activeBridge.startZ) {
      bot.aiDirX = 0;
      bot.aiDirZ = 1.0;
      updateSingleCharacter(scene, bot, 0, 1.0, effectiveDt, spawnPuffCloud, spawnSpeedStepRing);
      return;
    }
    if (bot.pos.z > stage.z + stage.r * 0.85) {
      updateSingleCharacter(scene, bot, 0, -1, effectiveDt, spawnPuffCloud, spawnSpeedStepRing);
      return;
    }

    const stageBlocks = getFloorBlocksForStage(bot.currentStage);

    bot.searchCooldown = (bot.searchCooldown || 0) - effectiveDt;
    if (
      bot.searchCooldown <= 0 ||
      !bot.targetBlock ||
      !bot.targetBlock.active ||
      bot.targetBlock.stageIdx !== bot.currentStage
    ) {
      bot.searchCooldown = isLaggingBehind ? 0.06 : 0.12;
      let best = null, minDistSq = 999999;

      for (let i = 0; i < floorItems.length; i++) {
        const item = floorItems[i];
        if (item.active && item.stageIdx === bot.currentStage) {
          const dx = item.pos.x - bot.pos.x;
          const dz = item.pos.z - bot.pos.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < 64.0) {
            if (dSq - 1000 < minDistSq) {
              minDistSq = dSq - 1000;
              best = item;
            }
          }
        }
      }

      for (let bIdx = 0; bIdx < stageBlocks.length; bIdx++) {
        const blk = stageBlocks[bIdx];
        if (blk.active && (blk.team.id === bot.team.id || blk.team.id === 'neutral')) {
          const dx = blk.pos.x - bot.pos.x;
          const dz = blk.pos.z - bot.pos.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < minDistSq) { minDistSq = dSq; best = blk; }
        }
      }
      bot.targetBlock = best;
    }

    let rawDx = 0, rawDz = 0;
    if (bot.targetBlock && bot.targetBlock.active) {
      rawDx = bot.targetBlock.pos.x - bot.pos.x;
      rawDz = bot.targetBlock.pos.z - bot.pos.z;
    } else {
      const timeSec = performance.now() * 0.0015;
      const patrolX = Math.sin(timeSec + bot.team.hex) * 4.2;
      const patrolZ = stage.z + Math.cos(timeSec * 0.8 + bot.team.hex) * 4.2;
      rawDx = patrolX - bot.pos.x;
      rawDz = patrolZ - bot.pos.z;
    }
    const lenSq = rawDx * rawDx + rawDz * rawDz;
    const len = lenSq > 0.0001 ? Math.sqrt(lenSq) : 1;
    const steer = avoidGateObstacles(bot, rawDx / len, rawDz / len);

    bot.aiDirX = THREE.MathUtils.lerp(bot.aiDirX || 0, steer.x, 0.16);
    bot.aiDirZ = THREE.MathUtils.lerp(bot.aiDirZ || -1, steer.z, 0.16);
    const dirMagSq = bot.aiDirX * bot.aiDirX + bot.aiDirZ * bot.aiDirZ;
    const dirMag = dirMagSq > 0.0001 ? Math.sqrt(dirMagSq) : 1;
    updateSingleCharacter(scene, bot, bot.aiDirX / dirMag, bot.aiDirZ / dirMag, effectiveDt, spawnPuffCloud, spawnSpeedStepRing);

  } else if (bot.aiState === 'BUILD') {
    const isSpecialGimmickAhead = stageBridges.some(
      br =>
        br.isSkydive ||
        br.isTrapdoor ||
        br.isElevator ||
        br.isZipline ||
        br.isCurvedSlide ||
        br.isFreefall
    );

    if (bot.stackCount === 0 && !isSpecialGimmickAhead) {
      bot.aiState = 'COLLECT';
      bot.targetBlock = null;
      bot.elevatorChoice = undefined;
      bot.searchCooldown = (bot.team.id === 'red') ? 0 : 0.06;
      return;
    }

    const b = stageBridges.find(
      br =>
        br.isSkydive ||
        br.isTrapdoor ||
        br.isCurvedSlide ||
        br.isZipline ||
        br.isElevator ||
        br.isFreefall ||
        br.laneIdx === bot.targetLane
    );

    if (b) {
      let targetX = LANES[bot.targetLane];

      if (b.isSkydive || b.isTrapdoor || b.isCurvedSlide || b.isZipline || b.isFreefall) {
        targetX = 0;
      } else if (b.isElevator) {
        if (bot.elevatorChoice === undefined) {
          if (Math.random() < 0.25) {
            bot.elevatorChoice = Math.floor(Math.random() * 3);
          } else {
            let minDur = 999;
            let bestLaneIdx = 0;
            for (let i = 0; i < b.elevators.length; i++) {
              if (b.elevators[i].duration < minDur) {
                minDur = b.elevators[i].duration;
                bestLaneIdx = b.elevators[i].laneIdx;
              }
            }
            bot.elevatorChoice = bestLaneIdx;
          }
        }
        targetX = LANES[bot.elevatorChoice];
      }

      // ドロップタワーの場合はハッチ中心（b.startZ）へ向かって直進
      const targetZ = b.isTrapdoor ? (b.startZ - 0.2) : (bot.pos.z < b.startZ ? bot.pos.z - 2 : b.startZ - 0.5);
      let dx = targetX - bot.pos.x;
      const dz = targetZ - bot.pos.z;

      // ★ 特殊ギミック＆階段進入アライメント誘導：
      // 島のエッジ（入口手前）に近づいたら、X方向のズレを優先的に補正して中央軸から真っ直ぐ進入
      const distToCenterAxis = Math.abs(targetX - bot.pos.x);
      if (bot.pos.z < stage.z - stage.r * 0.35 && distToCenterAxis > 0.35) {
        dx = (targetX - bot.pos.x) * 1.8;
      }

      const lenSq = dx * dx + dz * dz;
      const len = lenSq > 0.0001 ? Math.sqrt(lenSq) : 1;

      const oldZ = bot.pos.z;
      const steer = avoidGateObstacles(bot, dx / len, dz / len);
      bot.aiDirX = THREE.MathUtils.lerp(bot.aiDirX || 0, steer.x, 0.25);
      bot.aiDirZ = THREE.MathUtils.lerp(bot.aiDirZ || -1, steer.z, 0.25);
      const dirMagSq = bot.aiDirX * bot.aiDirX + bot.aiDirZ * bot.aiDirZ;
      const dirMag = dirMagSq > 0.0001 ? Math.sqrt(dirMagSq) : 1;
      updateSingleCharacter(scene, bot, bot.aiDirX / dirMag, bot.aiDirZ / dirMag, effectiveDt, spawnPuffCloud, spawnSpeedStepRing);

      if (bot.aiState !== 'COLLECT' && Math.abs(bot.pos.z - oldZ) < 0.0005) {
        if (
          b.isSkydive ||
          b.isTrapdoor ||
          b.isZipline ||
          b.isCurvedSlide ||
          b.isSlide ||
          b.isJump ||
          b.isElevator ||
          b.isFreefall
        ) {
          bot.pos.z -= 0.06;
        } else {
          bot.aiState = 'COLLECT';
          bot.aiCapacityGoal = isVerticalNext
            ? 20 + Math.floor(Math.random() * 4)
            : 14 + Math.floor(Math.random() * 5);
          bot.targetLane = evaluateBestLaneForBot(bot);
          bot.targetBlock = null;
          bot.elevatorChoice = undefined;
          bot.searchCooldown = (bot.team.id === 'red') ? 0 : 0.06;
        }
      }
    } else {
      bot.aiState = 'COLLECT';
    }
  }
}