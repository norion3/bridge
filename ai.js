// Bot AI自律思考ロジック・レーン評価・ゲート回避ベクトル・タイムスライス探索
import { LANES } from './constants.js';
import { _tempAvoidResult } from './materials.js';
import { characters, player, addBrickToCharacter } from './character.js';
import { STAGES, CONNECTIONS, bridgesByStage, modifierGates, getFloorBlocksForStage, floorItems } from './world.js';
import { updateSingleCharacter } from './systems.js';

export function evaluateBestLaneForBot(bot) {
  const laneScores = [0, 0, 0];
  let validBridgeCount = 0;

  const stageBridges = bridgesByStage.get(bot.currentStage) || [];

  for (let bIdx = 0; bIdx < stageBridges.length; bIdx++) {
    const b = stageBridges[bIdx];
    if (b.isJump || b.isSlide || b.isCurvedSlide || b.isZipline || b.isElevator) {
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
  if (bot.onCurvedSlide || bot.onZipline || bot.onElevator) {
    const targetOffset = bot.botSlideOffsetTarget || 0;
    const diff = targetOffset - bot.curvedSlideOffset;
    const steerX = bot.onCurvedSlide ? (Math.abs(diff) > 0.08 ? Math.sign(diff) * 0.45 : 0) : 0;
    updateSingleCharacter(scene, bot, steerX, -1.0, dt, spawnPuffCloud, spawnSpeedStepRing);
    return;
  }

  if (player && bot.currentStage < player.currentStage - 1) {
    bot.currentStage = player.currentStage;
    const stage = STAGES[bot.currentStage];
    if (stage) {
      bot.pos.x = (Math.random() - 0.5) * 6;
      bot.pos.z = stage.z + stage.r * 0.85;
      bot.pos.y = stage.y;
      bot.meshObj.root.position.copy(bot.pos);
      bot.invulnerableTimer = 1.0;
      bot.aiState = 'COLLECT';
      bot.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
      bot.lastPlankIdx = -1;
      bot.targetBlock = null;
      bot.elevatorChoice = undefined;
      bot.searchCooldown = (bot.team.id === 'red') ? 0 : 0.06;
      while (bot.stackCount < 4) { addBrickToCharacter(bot, bot.team); }
    }
    return;
  }

  const stage = STAGES[bot.currentStage];
  if (!stage) return;

  const stageBridges = bridgesByStage.get(bot.currentStage) || [];
  const activeBridge = stageBridges.find(b =>
    !b.isCurvedSlide && !b.isZipline && !b.isElevator &&
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
    } else if (nextConn.type === 'curved_slide' || nextConn.type === 'zipline' || nextConn.type === 'elevator') {
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
    const threshold = isVerticalNext ? Math.max(18, bot.aiCapacityGoal) : bot.aiCapacityGoal;
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
      updateSingleCharacter(scene, bot, 0, 1.0, dt, spawnPuffCloud, spawnSpeedStepRing);
      return;
    }
    if (bot.pos.z > stage.z + stage.r * 0.85) {
      updateSingleCharacter(scene, bot, 0, -1, dt, spawnPuffCloud, spawnSpeedStepRing);
      return;
    }

    const stageBlocks = getFloorBlocksForStage(bot.currentStage);

    bot.searchCooldown = (bot.searchCooldown || 0) - dt;
    if (bot.searchCooldown <= 0 || !bot.targetBlock || !bot.targetBlock.active || bot.targetBlock.stageIdx !== bot.currentStage) {
      bot.searchCooldown = 0.12;
      let best = null, minDistSq = 999999;

      // ★ 新要素: AIがアイテム（スピード、マグネット、攻撃）を優先して横取りするロジック
      for (let i = 0; i < floorItems.length; i++) {
        const item = floorItems[i];
        if (item.active && item.stageIdx === bot.currentStage) {
          const dx = item.pos.x - bot.pos.x;
          const dz = item.pos.z - bot.pos.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < 64.0) { // 半径8m以内のアイテムは最優先（距離スコアを大幅に減算）
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
    updateSingleCharacter(scene, bot, bot.aiDirX / dirMag, bot.aiDirZ / dirMag, dt, spawnPuffCloud, spawnSpeedStepRing);

  } else if (bot.aiState === 'BUILD') {
    if (bot.stackCount === 0 && !stageBridges.find(br => br.isElevator || br.isZipline || br.isCurvedSlide)) {
      bot.aiState = 'COLLECT';
      bot.targetBlock = null;
      bot.elevatorChoice = undefined;
      bot.searchCooldown = (bot.team.id === 'red') ? 0 : 0.06;
      return;
    }

    const b = stageBridges.find(br => (br.isCurvedSlide || br.isZipline || br.isElevator || br.laneIdx === bot.targetLane));
    if (b) {
      let targetX = LANES[bot.targetLane];
      
      if (b.isCurvedSlide || b.isZipline) {
        targetX = 0;
      } else if (b.isElevator) {
        // ★ 新要素: AIのエレベーター（最速レーン）選択ロジック
        if (bot.elevatorChoice === undefined) {
          if (Math.random() < 0.20) {
            // 20%の確率で判断を誤り、適当なレーンに乗る
            bot.elevatorChoice = Math.floor(Math.random() * 3);
          } else {
            // 基本は一番速い（durationが短い）レーンを確実に見抜く
            let minDur = 999;
            let bestL = 0;
            for(let i=0; i<3; i++) {
              if (b.elevators[i].duration < minDur) {
                minDur = b.elevators[i].duration;
                bestL = i;
              }
            }
            bot.elevatorChoice = bestL;
          }
        }
        targetX = LANES[bot.elevatorChoice];
      }

      const targetZ = bot.pos.z < b.startZ ? bot.pos.z - 2 : b.startZ - 0.5;
      const dx = targetX - bot.pos.x, dz = targetZ - bot.pos.z;
      const lenSq = dx * dx + dz * dz;
      const len = lenSq > 0.0001 ? Math.sqrt(lenSq) : 1;

      const oldZ = bot.pos.z;
      const steer = avoidGateObstacles(bot, dx / len, dz / len);
      bot.aiDirX = THREE.MathUtils.lerp(bot.aiDirX || 0, steer.x, 0.22);
      bot.aiDirZ = THREE.MathUtils.lerp(bot.aiDirZ || -1, steer.z, 0.22);
      const dirMagSq = bot.aiDirX * bot.aiDirX + bot.aiDirZ * bot.aiDirZ;
      const dirMag = dirMagSq > 0.0001 ? Math.sqrt(dirMagSq) : 1;
      updateSingleCharacter(scene, bot, bot.aiDirX / dirMag, bot.aiDirZ / dirMag, dt, spawnPuffCloud, spawnSpeedStepRing);

      if (bot.aiState !== 'COLLECT' && Math.abs(bot.pos.z - oldZ) < 0.0005) {
        if (b.isZipline || b.isCurvedSlide || b.isSlide || b.isJump || b.isElevator) {
          bot.pos.z -= 0.06;
        } else {
          bot.aiState = 'COLLECT';
          bot.aiCapacityGoal = isVerticalNext ? (20 + Math.floor(Math.random() * 4)) : (14 + Math.floor(Math.random() * 5));
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