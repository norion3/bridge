// blocks.js: 床ブロック管理・補充・スポーン・決定論的一意キー（blockId）マルチ同期専用モジュール
// ★ パケット通信最適化・5要素タプル＆旧形式ハイブリッド安全デコード対応版（Phase 3 修正）：
//   1. 【新旧ハイブリッド安全デコード (applyRemoteBlocksBatch / applyRemoteBlockSpawned)】
//      受信パケットが5要素タプル [s, x, z, t, idNum] であっても旧JSONオブジェクトであっても、
//      net_protocol.js の unpackBlockTuple と連動して自動判別・透過デコード。
//      受信側での例外停止（TypeError等）をゼロ化し、100%確実に床面へブロックを実体化。
//   2. 【Stage 0 スタートライン・ネームプレート周辺ブロックスポーン進入禁止除外ガード】
//      spawnSingleBlock において、Stage 0 の 4走者整列ラインおよびネームプレート手前
//      （candZ >= 2.2m かつ |candX - centerX| <= 6.0m）へのブロックスポーンを完全に禁止。
//      走者の足元や名前の真上にブロックが重なる事象を根本予防し、綺麗なスタートエリアを形成。
//   3. 【緑チーム（GREEN: #10b981）ブロック補充・スポーン完全対応】
//      applyRemoteBlockSpawned および spawnSingleBlock において、
//      teamId === 'green' の場合に sharedMats.blockGreen をバインド。
//      BLOCK_TYPES（4色）と自動連動し、4走者全員の色のブロックが均等に散らばる島を形成。
//   4. 【次ステージへの事前ブロック補充 (ハゲ山・目の前ポップ根絶)】
//      走者の現在地ステージだけでなく、進行方向の先行ステージ（直列次の島および二股分岐先の左右島）へ
//      走者が到着する前からブロックを自動補充。
//   5. 【先行ステージブロックのプール回収保護】
//      findSafePoolItem における activeStages 除外セットに先行ステージ（nextStageIdx）を追加。
//   6. 【PRNG汚染遮断 ＆ ゼロアロケーション純粋算術丸めの完全維持】

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
  activeMagnetBlocks
} from './world.js';
import {
  unpackBlockTuple
} from './net_protocol.js';

// --- 高速・ゼロアロケーション純粋算術丸めヘルパー（文字列インスタンス生成ゼロ） ---
const round2 = (val) => Math.round(val * 100) / 100;

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
 * ★ 走者が現在滞在しているステージおよび直近の先行ステージのアクティブブロックは絶対にリサイクルしない
 */
function findSafePoolItem() {
  // 1. 非アクティブな空きアイテムを最優先
  let poolItem = floorBlockPool.find(b => !b.active);
  if (poolItem) return poolItem;

  // 2. 空きがない場合、現在滞在ステージおよび先行ステージ以外の古いブロックからリサイクル
  const activeStages = new Set();
  if (Array.isArray(characters)) {
    characters.forEach(c => {
      if (c && typeof c.currentStage === 'number') {
        activeStages.add(c.currentStage);
        // 先行ステージ（二股分岐含む）もリサイクル保護対象に追加
        const stageBridges = bridgesByStage.get(c.currentStage);
        if (stageBridges && stageBridges.length > 0) {
          stageBridges.forEach(b => {
            if (typeof b.nextStageIdx === 'number') {
              activeStages.add(b.nextStageIdx);
            }
          });
        } else {
          activeStages.add(c.currentStage + 1);
        }
      }
    });
  }

  let bestRecycleIdx = -1;
  let minStageIdx = 999999;

  for (let k = 0; k < floorBlockPool.length; k++) {
    const blk = floorBlockPool[k];
    // 保護ステージ、または吸引中のブロックは絶対に奪わない
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
 * ★ 5要素タプル・旧オブジェクト形式の双方に対応するフェイルセーフを内包
 * ★ 4色対応（青・赤・黄・緑）
 */
export function applyRemoteBlockSpawned(stageIdx, poolIdx, x, y, z, teamId, blockId = null) {
  // 引数が5要素タプル [s, x, z, t, idNum] またはオブジェクト形式で渡された場合の自己救済展開
  if (Array.isArray(stageIdx)) {
    const unpacked = unpackBlockTuple(stageIdx);
    return applyRemoteBlockSpawned(unpacked.stageIdx, unpacked.poolIdx || 0, unpacked.x, unpacked.y, unpacked.z, unpacked.teamId, unpacked.blockId);
  } else if (stageIdx && typeof stageIdx === 'object' && stageIdx.stageIdx !== undefined) {
    const obj = stageIdx;
    return applyRemoteBlockSpawned(obj.stageIdx, obj.poolIdx || 0, obj.x, obj.y, obj.z, obj.teamId, obj.blockId);
  }

  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return;

  const stageBlocks = getFloorBlocksForStage(stageIdx);
  const resolvedBlockId = blockId || `b_${stageIdx}_${round2(x)}_${round2(z)}`;

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
  else if (teamId === 'green') mat = sharedMats.blockGreen;
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
 * ★ 新規格（5要素タプル配列）と旧規格（オブジェクト配列）を自動判別して安全に展開
 */
export function applyRemoteBlocksBatch(stageIdx, blocksArray) {
  if (!Array.isArray(blocksArray) || blocksArray.length === 0) return;
  for (let i = 0; i < blocksArray.length; i++) {
    const item = blocksArray[i];
    if (Array.isArray(item)) {
      // 新規格: 5要素タプル [s, x, z, t, idNum]
      const b = unpackBlockTuple(item);
      applyRemoteBlockSpawned(b.stageIdx, 0, b.x, undefined, b.z, b.teamId, b.blockId);
    } else if (item && typeof item === 'object') {
      // 旧規格フォールバック
      applyRemoteBlockSpawned(
        item.stageIdx !== undefined ? item.stageIdx : stageIdx,
        item.poolIdx || 0,
        item.x,
        item.y,
        item.z,
        item.teamId,
        item.blockId
      );
    }
  }
}

if (typeof window !== 'undefined') {
  window.applyRemoteBlockSpawned = applyRemoteBlockSpawned;
  window.applyRemoteBlocksBatch = applyRemoteBlocksBatch;
}

/**
 * 単一床ブロックの出現位置判定および内部配置
 * ★ 4色対応（青・赤・黄・緑）
 * ★ Stage 0 スタートライン足元・ネームプレート周辺除外ガード配備
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
    const r = Math.sqrt(Math.random()) * (stageInfo.r - 2.2);
    const theta = Math.random() * Math.PI * 2;
    const candX = centerX + Math.cos(theta) * r;
    const candZ = stageInfo.z + Math.sin(theta) * r;

    // ★ Stage 0: 4走者の初期整列ライン（Z=4.0m）およびネームプレート周辺（Z >= 2.2m かつ |X| <= 6.0m）へのスポーンを禁止
    if (stageIdx === 0) {
      if (candZ >= 2.2 && Math.abs(candX - centerX) <= 6.0) {
        attempts++;
        continue;
      }
    }

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

  const team = targetTeam || BLOCK_TYPES[Math.floor(Math.random() * BLOCK_TYPES.length)];
  let mat;
  if (team.id === 'blue') mat = sharedMats.blockBlue;
  else if (team.id === 'red') mat = sharedMats.blockRed;
  else if (team.id === 'yellow') mat = sharedMats.blockYellow;
  else if (team.id === 'green') mat = sharedMats.blockGreen;
  else mat = sharedMats.blockNeutral;

  globalBlockSpawnCounter++;
  const uniqueBlockId = `b_${stageIdx}_${globalBlockSpawnCounter}`;
  const spawnY = stageInfo.y + 0.25;

  poolItem.mesh.material = mat;
  poolItem.mesh.position.set(validPos.x, spawnY, validPos.z);
  poolItem.mesh.rotation.set(0, Math.random() * Math.PI, 0);
  poolItem.mesh.visible = true;

  poolItem.active = true;
  poolItem.team = team;
  poolItem.pos = poolItem.mesh.position;
  poolItem.stageIdx = stageIdx;
  poolItem.blockId = uniqueBlockId;
  poolItem.attracting = false;

  stageBlocks.push(poolItem);

  // ★ 純粋算術丸め（round2）により一時文字列オブジェクト生成を完全ゼロ化
  const blockRecord = {
    stageIdx: stageIdx,
    poolIdx: floorBlockPool.indexOf(poolItem),
    x: round2(validPos.x),
    y: round2(spawnY),
    z: round2(validPos.z),
    teamId: team.id,
    blockId: uniqueBlockId
  };

  if (shouldBroadcastImmediately) {
    const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
    const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
    if (isMulti && isHost && window.NetworkManager && typeof window.NetworkManager.queueSpawnBlocks === 'function') {
      window.NetworkManager.queueSpawnBlocks([blockRecord]);
    }
  }

  return blockRecord;
}

/**
 * 全走者の滞在ステージおよび先行ステージに応じた床ブロック定期補充（4色対応）
 */
export function manageBlockSpawns(scene, isGameOver = false) {
  if (isGameOver) return;

  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);

  // ゲスト端末はホストからのパケットのみを受信するためローカル補充は行わない
  if (isMulti && !isHost) return;

  // 走者現在地ステージと、その直近の先行ステージ（二股分岐含む）を収集
  const currentStagesSet = new Set();
  const stagesToSpawn = new Set();

  for (let cIdx = 0; cIdx < characters.length; cIdx++) {
    const s = characters[cIdx].currentStage;
    if (typeof s === 'number') {
      currentStagesSet.add(s);
      stagesToSpawn.add(s);

      // 先行ステージ（次の島・二股分岐の左右島）も補充対象に追加
      const stageBridges = bridgesByStage.get(s);
      if (stageBridges && stageBridges.length > 0) {
        stageBridges.forEach(b => {
          if (typeof b.nextStageIdx === 'number' && b.nextStageIdx < STAGES.length) {
            stagesToSpawn.add(b.nextStageIdx);
          }
        });
      } else if (s + 1 < STAGES.length) {
        stagesToSpawn.add(s + 1);
      }
    }
  }

  // 全ステージで新しく生成されたブロックを単一配列に集約
  const allNewlySpawned = [];

  stagesToSpawn.forEach(s => {
    const isCurrentStage = currentStagesSet.has(s);
    const stageBlocks = getFloorBlocksForStage(s);

    for (let tIdx = 0; tIdx < BLOCK_TYPES.length; tIdx++) {
      const team = BLOCK_TYPES[tIdx];
      // 自機（青）は多め、ライバル（赤・黄・緑）も均等にたっぷり事前配置
      const targetCount = isCurrentStage
        ? ((team.id === 'blue') ? 13 : 7)
        : ((team.id === 'blue') ? 10 : 6);

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
      if (needed <= 0) continue;

      // 1回の周期で過剰なバーストが起きないよう上限を抑制
      const spawnLimit = Math.min(needed, isCurrentStage ? 4 : 3);

      for (let k = 0; k < spawnLimit; k++) {
        const spawned = spawnSingleBlock(scene, s, team, false);
        if (spawned) {
          allNewlySpawned.push(spawned);
        }
      }
    }
  });

  // 生送信を完全排除し、NetworkManager.queueSpawnBlocks 経由で次の100msパケットへ同封
  if (isMulti && isHost && allNewlySpawned.length > 0 && window.NetworkManager) {
    if (typeof window.NetworkManager.queueSpawnBlocks === 'function') {
      window.NetworkManager.queueSpawnBlocks(allNewlySpawned);
    }
  }
}