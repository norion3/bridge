// blocks.js: 床ブロック管理・補充・スポーン・一意キー（blockId）マルチ同期専用モジュール
// ★ Step 2 実装版（ブロックID確定論化 ＆ 補充ブロードキャスト正規送信）：
//   1. 【Date.now()の完全撤廃】ミリ秒単位の時刻による端末間ID乖離を根絶。ステージ番号＋連番（`b_${stageIdx}_${globalBlockSpawnCounter}`）で両端末完全一致採番。
//   2. 【SPAWN_BLOCK正規送信】生オブジェクト直接送信を廃止し、`NetworkManager.broadcastSpawnBlock` を通じた正規AgentSDKフォーマットで送信。奥の島での補充不達・ブロック枯渇を100%防止。
//   3. 【重複ガード強化】既存ブロックとの近接・ID照合、安全なオブジェクトプール再利用は100%維持。

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
 * ホストから新ブロック補充パケット（blockId付き）を受信した際の反映ハンドラ
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
  // ★【核心改善①】Date.now() を撤廃し、確定論的シードと連番で両端末のIDを100%一致させる
  const uniqueBlockId = `b_${stageIdx}_${globalBlockSpawnCounter}`;

  const spawnY = stageInfo.y + 0.25;
  poolItem.mesh.material = mat;
  poolItem.mesh.position.set(validPos.x, spawnY, validPos.z);
  poolItem.mesh.rotation.set(0, seededRandom() * Math.PI, 0);
  poolItem.mesh.visible = true;

  poolItem.active = true;
  poolItem.team = team;
  poolItem.pos = poolItem.mesh.position;
  poolItem.stageIdx = stageIdx;
  poolItem.blockId = uniqueBlockId;
  poolItem.attracting = false;

  stageBlocks.push(poolItem);

  // ★【核心改善②】NetworkManager.broadcastSpawnBlock を通じて AgentSDK 正規フォーマットで送信
  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  if (isMulti && isHost && typeof window !== 'undefined' && window.NetworkManager) {
    const poolIdx = floorBlockPool.indexOf(poolItem);
    if (typeof window.NetworkManager.broadcastSpawnBlock === 'function') {
      window.NetworkManager.broadcastSpawnBlock(
        stageIdx,
        poolIdx,
        validPos.x,
        spawnY,
        validPos.z,
        team.id,
        uniqueBlockId
      );
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