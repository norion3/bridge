// blocks.js: 床ブロック管理・補充・スポーン・一意キー（blockId）マルチ同期専用モジュール
// ★ Step 7 実装版（ブロック一意キー化・座標丸め誤差による消失防止）：
//   1. 端末間でズレる配列インデックス（poolIdx）依存を完全撤廃し、ステージ番号＋連番の一意キー（blockId: "stage_counter"）を導入
//   2. applyRemoteBlockSpawned / applyRemoteBlockPicked で blockId による完全一致マッチングを行い、隣接ブロックの誤消去をゼロ化
//   3. ホスト側のみが定期スポーン（SPAWN_BLOCK）の主導権を持ち、一意キー付きで生成パケットをブロードキャスト
//   4. 既存のランダム回転、アイテム・ギミック除外半径、ソロプレイ動作は100%維持

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

// 一意ブロックID生成用カウンター
let globalBlockSpawnCounter = 0;

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
 * ★【Step 7 核心】ホストから新ブロック補充パケット（blockId付き）を受信した際の反映ハンドラ
 * 配列インデックスへの盲従を撤廃し、一意キーによる厳格管理と安全なプール割り当てを実施
 */
export function applyRemoteBlockSpawned(stageIdx, poolIdx, x, y, z, teamId, blockId = null) {
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return;

  const stageBlocks = getFloorBlocksForStage(stageIdx);
  const resolvedBlockId = blockId || `b_${stageIdx}_${x.toFixed(2)}_${z.toFixed(2)}`;

  // 1. 同一 blockId が既にアクティブに存在している場合は二重生成を防止
  for (let i = 0; i < stageBlocks.length; i++) {
    const existing = stageBlocks[i];
    if (existing.active && existing.blockId === resolvedBlockId) {
      return;
    }
  }

  // 2. 近接（0.45m以内）同一座標の重複ガード
  for (let i = 0; i < stageBlocks.length; i++) {
    const b = stageBlocks[i];
    if (b.active && Math.hypot(b.pos.x - x, b.pos.z - z) < 0.45) {
      return;
    }
  }

  // 3. 安全なプールアイテムの確保（非アクティブな要素を最優先）
  let poolItem = floorBlockPool.find(b => !b.active);
  if (!poolItem) {
    let bestRecycleIdx = -1;
    let minStageIdx = 999999;
    for (let k = 0; k < floorBlockPool.length; k++) {
      const blk = floorBlockPool[k];
      if (blk.active && !blk.attracting && blk.stageIdx < minStageIdx) {
        minStageIdx = blk.stageIdx;
        bestRecycleIdx = k;
      }
    }
    if (bestRecycleIdx >= 0) {
      poolItem = floorBlockPool[bestRecycleIdx];
      const oldStageBlocks = getFloorBlocksForStage(poolItem.stageIdx);
      const oldIdx = oldStageBlocks.indexOf(poolItem);
      if (oldIdx !== -1) oldStageBlocks.splice(oldIdx, 1);
    }
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
  poolItem.mesh.rotation.set(0, Math.random() * Math.PI, 0);
  poolItem.mesh.visible = true;

  poolItem.active = true;
  poolItem.team = team;
  poolItem.pos = poolItem.mesh.position;
  poolItem.stageIdx = stageIdx;
  poolItem.blockId = resolvedBlockId;
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
 * 単一床ブロックの出現判定および配置（ホスト端末またはソロプレイで実行）
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
  if (!poolItem) {
    let bestRecycleIdx = -1;
    let minStageIdx = 999999;
    for (let k = 0; k < floorBlockPool.length; k++) {
      const blk = floorBlockPool[k];
      if (blk.active && !blk.attracting && blk.stageIdx < minStageIdx) {
        minStageIdx = blk.stageIdx;
        bestRecycleIdx = k;
      }
    }
    if (bestRecycleIdx >= 0) {
      poolItem = floorBlockPool[bestRecycleIdx];
      const oldStageBlocks = getFloorBlocksForStage(poolItem.stageIdx);
      const oldIdx = oldStageBlocks.indexOf(poolItem);
      if (oldIdx !== -1) oldStageBlocks.splice(oldIdx, 1);
    }
  }
  if (!poolItem) return;

  const team = targetTeam || BLOCK_TYPES[Math.floor(seededRandom() * BLOCK_TYPES.length)];
  let mat;
  if (team.id === 'blue') mat = sharedMats.blockBlue;
  else if (team.id === 'red') mat = sharedMats.blockRed;
  else if (team.id === 'yellow') mat = sharedMats.blockYellow;
  else mat = sharedMats.blockNeutral;

  globalBlockSpawnCounter++;
  const uniqueBlockId = `b_${stageIdx}_${globalBlockSpawnCounter}_${Date.now().toString(36)}`;

  poolItem.mesh.material = mat;
  poolItem.mesh.position.set(validPos.x, stageInfo.y + 0.25, validPos.z);
  poolItem.mesh.rotation.set(0, seededRandom() * Math.PI, 0);
  poolItem.mesh.visible = true;

  poolItem.active = true;
  poolItem.team = team;
  poolItem.pos = poolItem.mesh.position;
  poolItem.stageIdx = stageIdx;
  poolItem.blockId = uniqueBlockId;
  poolItem.attracting = false;

  stageBlocks.push(poolItem);

  // マルチプレイ時、ホストが補充したブロック情報を一意ID付きで他端末へブロードキャスト
  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  if (isMulti && isHost && typeof window !== 'undefined' && window.AgentSDK) {
    const poolIdx = floorBlockPool.indexOf(poolItem);
    try {
      window.AgentSDK.room.sendMessage({
        message: JSON.stringify({
          event: 'SPAWN_BLOCK',
          blockId: uniqueBlockId,
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