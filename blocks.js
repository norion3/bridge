// blocks.js: 床ブロック管理・補充・スポーン・一意キー（blockId）マルチ同期専用モジュール
// ★ Phase 2 完全復旧版（初期島ブロック枯渇根絶 ＆ 公式SDK準拠・軽量バッチ通信）：
//   1. 【現在ステージの強制リサイクル強奪を完全遮断】
//      プール枯渇時に現在走者が滞在しているステージ（Stage 0など）のブロックが奥の島へ
//      強制テレポートされて画面から全消滅する致命的欠陥を根絶。現在走者がいるステージは絶対にリサイクル除外。
//   2. 【公式SDK仕様準拠の軽量バッチ送信】
//      1個ずつのマシンガン通信を撤廃し、ステージごとの補充ブロックを必要最小限の軽量データに圧縮して1通に集約。
//      JSBridgeのパケットサイズ制限（数百バイト以内）を厳格にクリア。
//   3. 【確定論的ブロックID ＆ 重複ガード】
//      ミリ秒時刻に依存しない連番ID（b_${stageIdx}_${globalBlockSpawnCounter}）による完全一致管理。

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
 * 安全なプールアイテムの取得ヘルパー
 * ★ 走者が現在滞在しているステージのアクティブブロックは絶対にリサイクルしない
 */
function findSafePoolItem() {
  // 1. 非アクティブな空きアイテムを最優先
  let poolItem = floorBlockPool.find(b => !b.active);
  if (poolItem) return poolItem;

  // 2. 空きがない場合、全キャラが現在滞在しているステージ以外の古いブロックからリサイクル
  const activeStages = new Set();
  if (Array.isArray(characters)) {
    characters.forEach(c => {
      if (c && typeof c.currentStage === 'number') {
        activeStages.add(c.currentStage);
      }
    });
  }

  let bestRecycleIdx = -1;
  let minStageIdx = 999999;

  for (let k = 0; k < floorBlockPool.length; k++) {
    const blk = floorBlockPool[k];
    // 現在走者がいるステージ、または吸引中のブロックは絶対に奪わない
    if (blk.active && !blk.attracting && !activeStages.has(blk.stageIdx)) {
      if (blk.stageIdx < minStageIdx) {
        minStageIdx = blk.stageIdx;
        bestRecycleIdx = k;
      }
    }
  }

  if (bestRecycleIdx >= 0) {
    poolItem = floorBlockPool[bestRecycleIdx];
    const oldStageBlocks = getFloorBlocksForStage(poolItem.stageIdx);
    const oldIdx = oldStageBlocks.indexOf(poolItem);
    if (oldIdx !== -1) oldStageBlocks.splice(oldIdx, 1);
    return poolItem;
  }

  return null;
}

/**
 * ホストから新ブロック補充パケット（blockId付き）を受信した際の反映ハンドラ（単体）
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

  // 3. 安全なプールアイテムの確保
  const poolItem = findSafePoolItem();
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

/**
 * ホストからの一括（バッチ）ブロック補充パケット受信ハンドラ
 */
export function applyRemoteBlocksBatch(stageIdx, blocksArray) {
  if (!Array.isArray(blocksArray) || blocksArray.length === 0) return;
  for (let i = 0; i < blocksArray.length; i++) {
    const b = blocksArray[i];
    applyRemoteBlockSpawned(
      b.stageIdx !== undefined ? b.stageIdx : stageIdx,
      b.poolIdx,
      b.x,
      b.y,
      b.z,
      b.teamId,
      b.blockId
    );
  }
}

if (typeof window !== 'undefined') {
  window.applyRemoteBlockSpawned = applyRemoteBlockSpawned;
  window.applyRemoteBlocksBatch = applyRemoteBlocksBatch;
}

/**
 * 単一床ブロックの出現位置判定および内部配置
 */
export function spawnSingleBlock(scene, stageIdx, targetTeam = null, shouldBroadcastImmediately = true) {
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return null;

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

  if (!validPos) return null;

  const poolItem = findSafePoolItem();
  if (!poolItem) return null;

  const team = targetTeam || BLOCK_TYPES[Math.floor(seededRandom() * BLOCK_TYPES.length)];
  let mat;
  if (team.id === 'blue') mat = sharedMats.blockBlue;
  else if (team.id === 'red') mat = sharedMats.blockRed;
  else if (team.id === 'yellow') mat = sharedMats.blockYellow;
  else mat = sharedMats.blockNeutral;

  globalBlockSpawnCounter++;
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

  const blockRecord = {
    stageIdx: stageIdx,
    poolIdx: floorBlockPool.indexOf(poolItem),
    x: Number(validPos.x.toFixed(2)),
    y: Number(spawnY.toFixed(2)),
    z: Number(validPos.z.toFixed(2)),
    teamId: team.id,
    blockId: uniqueBlockId
  };

  if (shouldBroadcastImmediately) {
    const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
    const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
    if (isMulti && isHost && window.NetworkManager && typeof window.NetworkManager.broadcastSpawnBlock === 'function') {
      window.NetworkManager.broadcastSpawnBlock(
        stageIdx,
        blockRecord.poolIdx,
        blockRecord.x,
        blockRecord.y,
        blockRecord.z,
        blockRecord.teamId,
        blockRecord.blockId
      );
    }
  }

  return blockRecord;
}

/**
 * 全走者の滞在ステージに応じた床ブロック定期補充
 * ★ 補充されたブロックをステージごとにまとめ、1通の軽量バッチでブロードキャスト
 */
export function manageBlockSpawns(scene, isGameOver = false) {
  if (isGameOver) return;

  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);

  // ゲスト端末はホストからのパケットのみを受信するためローカル補充は行わない
  if (isMulti && !isHost) return;

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
    const newlySpawnedInStage = [];

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

      const needed = targetCount - currentCount;
      // 1回の周期で過剰なバーストが起きないよう上限を4個までに抑制
      const spawnLimit = Math.min(needed, 4);

      for (let k = 0; k < spawnLimit; k++) {
        const spawned = spawnSingleBlock(scene, s, team, false);
        if (spawned) {
          newlySpawnedInStage.push(spawned);
        }
      }
    }

    // ステージごとに1通だけバッチブロードキャスト送信（パケットサイズ数百バイト以内）
    if (isMulti && isHost && newlySpawnedInStage.length > 0 && window.NetworkManager) {
      if (typeof window.NetworkManager.broadcastSpawnBlocksBatch === 'function') {
        window.NetworkManager.broadcastSpawnBlocksBatch(s, newlySpawnedInStage);
      } else if (typeof window.NetworkManager.broadcastSpawnBlock === 'function') {
        newlySpawnedInStage.forEach(b => {
          window.NetworkManager.broadcastSpawnBlock(s, b.poolIdx, b.x, b.y, b.z, b.teamId, b.blockId);
        });
      }
    }
  }
}