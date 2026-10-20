// blocks.js: 床ブロック管理・補充・スポーン・ホスト補充マルチ同期専用モジュール
// world.js から床ブロック関連の責務を分離
// ★ Phase 1 強化版:
//   - applyRemoteBlockSpawned におけるブロック向きのバラバラ化（ランダム回転設定）
//   - 同一座標近接二重生成ガード ＆ 安全な空きスロット配置
//   - window.NetworkManager 連携による SPAWN_BLOCK ブロードキャスト確約

import {
  BLOCK_TYPES,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG,
  ELEVATOR_CONFIG
} from './constants.js';
import {
  sharedMats
} from './materials.js';
import {
  floorBlockPool
} from './particles.js';
import {
  characters
} from './character.js';
import {
  STAGES,
  bridgesByStage,
  activeMagnetBlocks,
  seededRandom
} from './world.js';

export const floorBlocksByStage = new Map();

/**
 * 指定ステージの床ブロック配列を取得（未存在時は初期化）
 * @param {number} stageIdx 
 * @returns {Array}
 */
export function getFloorBlocksForStage(stageIdx) {
  let bucket = floorBlocksByStage.get(stageIdx);
  if (!bucket) {
    bucket = [];
    floorBlocksByStage.set(stageIdx, bucket);
  }
  return bucket;
}

/**
 * ★【Phase 1 強化】ホストから新ブロック補充パケットを受信した際の反映ハンドラ
 * 向きをランダム（バラバラ）に設定し、ゲスト側の真横整列バグを解消
 */
export function applyRemoteBlockSpawned(stageIdx, poolIdx, x, y, z, teamId) {
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return;

  const stageBlocks = getFloorBlocksForStage(stageIdx);

  // 既に同一座標付近（0.6m以内）にアクティブブロックがある場合は二重配置しない
  for (let i = 0; i < stageBlocks.length; i++) {
    const b = stageBlocks[i];
    if (b.active && Math.hypot(b.pos.x - x, b.pos.z - z) < 0.6) {
      return;
    }
  }

  let poolItem = null;
  if (poolIdx >= 0 && poolIdx < floorBlockPool.length && !floorBlockPool[poolIdx].active) {
    poolItem = floorBlockPool[poolIdx];
  } else {
    poolItem = floorBlockPool.find(b => !b.active);
  }
  if (!poolItem) return;

  const team = BLOCK_TYPES.find(t => t.id === teamId) || BLOCK_TYPES[0];
  let mat;
  if (teamId === 'blue') mat = sharedMats.blockBlue;
  else if (teamId === 'red') mat = sharedMats.blockRed;
  else if (teamId === 'yellow') mat = sharedMats.blockYellow;
  else mat = sharedMats.blockNeutral;

  poolItem.mesh.material = mat;
  poolItem.mesh.position.set(x, y !== undefined ? y : (stageInfo.y + 0.25), z);
  // ★【真因 ① 解消】一定方向（真横 0, 0, 0）固定を撤廃し、バラバラな自然な角度で散らばるように設定！
  poolItem.mesh.rotation.set(0, Math.random() * Math.PI, 0);
  poolItem.mesh.visible = true;

  poolItem.active = true;
  poolItem.team = team;
  poolItem.pos = poolItem.mesh.position;
  poolItem.stageIdx = stageIdx;
  poolItem.attracting = false;

  if (!stageBlocks.includes(poolItem)) {
    stageBlocks.push(poolItem);
  }
}

// グローバル公開（network.js から安全に呼べるように登録）
if (typeof window !== 'undefined') {
  window.applyRemoteBlockSpawned = applyRemoteBlockSpawned;
}

/**
 * 単一床ブロックの出現判定および配置
 * @param {THREE.Scene} scene 
 * @param {number} stageIdx 
 * @param {Object|null} targetTeam 
 */
export function spawnSingleBlock(scene, stageIdx, targetTeam = null) {
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return;

  const minClearanceSq = 1.35 * 1.35;
  let validPos = null;
  let attempts = 0;
  const stageBlocks = getFloorBlocksForStage(stageIdx);
  const centerX = stageInfo.x || 0.0;

  const stageBridges = bridgesByStage.get(stageIdx) || [];
  const skydiveB = stageBridges.find(b => b.isSkydive);
  const trapdoorB = stageBridges.find(b => b.isTrapdoor);
  const eleB = stageBridges.find(b => b.isElevator);

  while (attempts < 25) {
    const r = Math.sqrt(seededRandom()) * (stageInfo.r - 2.2);
    const theta = seededRandom() * Math.PI * 2;
    const candX = centerX + Math.cos(theta) * r;
    const candZ = stageInfo.z + Math.sin(theta) * r;

    if (skydiveB) {
      const dSkySq = (candX - (skydiveB.launchPoint ? skydiveB.launchPoint.x : centerX)) ** 2 + (candZ - skydiveB.startZ) ** 2;
      if (dSkySq < (SKYDIVE_CONFIG.CATAPULT.exclusionRadius * SKYDIVE_CONFIG.CATAPULT.exclusionRadius)) {
        attempts++;
        continue;
      }
    }

    if (trapdoorB) {
      const dHatchSq = (candX - centerX) ** 2 + (candZ - trapdoorB.startZ) ** 2;
      if (dHatchSq < (TRAPDOOR_CONFIG.HATCH.exclusionRadius * TRAPDOOR_CONFIG.HATCH.exclusionRadius)) {
        attempts++;
        continue;
      }
    }

    if (eleB) {
      if (candZ < stageInfo.z - stageInfo.r * 0.45 && Math.abs(candX - centerX) < 5.5) {
        attempts++;
        continue;
      }
    }

    let isOverlapping = false;
    for (let i = 0; i < stageBlocks.length; i++) {
      const b = stageBlocks[i];
      if (b.active) {
        const dx = b.pos.x - candX;
        const dz = b.pos.z - candZ;
        if (dx * dx + dz * dz < minClearanceSq) {
          isOverlapping = true;
          break;
        }
      }
    }

    if (!isOverlapping) {
      validPos = { x: candX, z: candZ };
      break;
    }
    attempts++;
  }

  if (!validPos) return;

  let poolItem = floorBlockPool.find(b => !b.active);
  if (!poolItem) return;

  const team = targetTeam || BLOCK_TYPES[Math.floor(seededRandom() * BLOCK_TYPES.length)];
  let mat;
  if (team.id === 'blue') mat = sharedMats.blockBlue;
  else if (team.id === 'red') mat = sharedMats.blockRed;
  else if (team.id === 'yellow') mat = sharedMats.blockYellow;
  else mat = sharedMats.blockNeutral;

  poolItem.mesh.material = mat;
  poolItem.mesh.position.set(validPos.x, stageInfo.y + 0.25, validPos.z);
  poolItem.mesh.rotation.set(0, seededRandom() * Math.PI, 0);
  poolItem.mesh.visible = true;

  poolItem.active = true;
  poolItem.team = team;
  poolItem.pos = poolItem.mesh.position;
  poolItem.stageIdx = stageIdx;
  poolItem.attracting = false;

  stageBlocks.push(poolItem);

  // マルチプレイ時、ホストが補充したブロック情報を他端末へ即時ブロードキャスト
  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  if (isMulti && isHost && typeof window !== 'undefined' && window.AgentSDK) {
    const poolIdx = floorBlockPool.indexOf(poolItem);
    try {
      window.AgentSDK.room.sendMessage({
        message: JSON.stringify({
          event: 'SPAWN_BLOCK',
          poolIdx: poolIdx,
          stageIdx: stageIdx,
          x: Number(validPos.x.toFixed(2)),
          y: Number((stageInfo.y + 0.25).toFixed(2)),
          z: Number(validPos.z.toFixed(2)),
          teamId: team.id
        })
      });
    } catch (err) {
      console.warn('[blocks.js] Failed to broadcast SPAWN_BLOCK:', err);
    }
  }
}

/**
 * 全走者の滞在ステージに応じた床ブロック定期補充
 * @param {THREE.Scene} scene 
 * @param {boolean} isGameOver 
 */
export function manageBlockSpawns(scene, isGameOver = false) {
  if (isGameOver) return;

  for (let cIdx = 0; cIdx < characters.length; cIdx++) {
    const s = characters[cIdx].currentStage;

    let alreadyChecked = false;
    for (let prevIdx = 0; prevIdx < cIdx; prevIdx++) {
      if (characters[prevIdx].currentStage === s) {
        alreadyChecked = true;
        break;
      }
    }
    if (alreadyChecked) continue;

    const stageBlocks = getFloorBlocksForStage(s);

    for (let tIdx = 0; tIdx < BLOCK_TYPES.length; tIdx++) {
      const team = BLOCK_TYPES[tIdx];
      const targetCount = (team.id === 'blue') ? 13 : 7;

      let currentCount = 0;
      for (let bIdx = 0; bIdx < stageBlocks.length; bIdx++) {
        const b = stageBlocks[bIdx];
        if (b.active && b.team.id === team.id) {
          currentCount++;
        }
      }

      for (let mIdx = 0; mIdx < activeMagnetBlocks.length; mIdx++) {
        const mb = activeMagnetBlocks[mIdx];
        if (mb.targetChar && mb.targetChar.currentStage === s && mb.team && mb.team.id === team.id) {
          currentCount++;
        }
      }

      if (currentCount < targetCount) {
        spawnSingleBlock(scene, s, team);
      }
    }
  }
}