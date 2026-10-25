// systems_remote.js: 他端末・ホストから届いたアクションパケットのシーン反映ハンドラ専用モジュール
// ★ 4人プレイ拡張版（緑チーム架橋カラー同期対応）：
//   1. 【緑チーム（GREEN: #10b981）架橋カラー同期対応】
//      COLOR_GREEN_PLANK を materials.js からインポート。
//      applyRemotePlankBuilt において teamId === 'green' の場合に
//      solidMesh.setColorAt(plankIdx, COLOR_GREEN_PLANK) を反映。
//   2. 【二股分岐 Pattern B 左右レーン分離（左: 0, 右: 2）の完全維持】
//   3. 【床ブロック取得・消費・モブ吹き飛び受信ハンドラの100%維持】

import { LANES } from './constants.js';
import {
  COLOR_BLUE_PLANK,
  COLOR_RED_PLANK,
  COLOR_YELLOW_PLANK,
  COLOR_GREEN_PLANK
} from './materials.js';
import {
  characters,
  removeBrickFromCharacter
} from './character.js';
import {
  STAGES,
  bridgesByStage,
  modifierGates,
  activeMagnetBlocks,
  floorItems,
  getFloorBlocksForStage,
  obstacleMobs
} from './world.js';
import { triggerLandingShockwave } from './particles.js';

const dummyPlankObj = new THREE.Object3D();

/**
 * リモートプレイヤーが階段を設置した際の受信ハンドラ（段板カラー即時同期 ＆ スタック整合）
 * ★ 4色対応（青・赤・黄・緑）
 */
export function applyRemotePlankBuilt(stageIdx, laneIdx, plankIdx, teamId) {
  const localBridges = bridgesByStage.get(stageIdx) || [];
  // 左右で分離された laneIdx (左=0, 右=2, 通常3レーン=0,1,2) により確実に目的の橋がヒット
  const onBridge = localBridges.find(b => b.laneIdx === laneIdx);
  if (!onBridge || !onBridge.solidMesh || !onBridge.ghostMesh) return;

  const currentP = onBridge.planks[plankIdx];
  if (!currentP) return;

  currentP.teamId = teamId;

  const fromStg = STAGES[onBridge.stageIdx];
  const bCenterX = fromStg ? (fromStg.x || 0.0) : 0.0;
  const currentLaneX = (onBridge.actualBridgeX !== undefined)
    ? onBridge.actualBridgeX
    : (bCenterX + (LANES[onBridge.laneIdx] !== undefined ? LANES[onBridge.laneIdx] : 0.0));

  // ゴースト非表示
  dummyPlankObj.position.set(currentLaneX, currentP.y, currentP.z);
  dummyPlankObj.rotation.set(0, 0, 0);
  dummyPlankObj.scale.set(0, 0, 0);
  dummyPlankObj.updateMatrix();
  onBridge.ghostMesh.setMatrixAt(plankIdx, dummyPlankObj.matrix);
  onBridge.ghostMesh.instanceMatrix.needsUpdate = true;

  // 実体段板表示 ＆ カラー反映
  dummyPlankObj.scale.set(1, 1, 1);
  dummyPlankObj.updateMatrix();
  onBridge.solidMesh.setMatrixAt(plankIdx, dummyPlankObj.matrix);
  onBridge.solidMesh.instanceMatrix.needsUpdate = true;

  // ★ 4チーム対応カラー分岐（緑チーム追加）
  if (teamId === 'blue') onBridge.solidMesh.setColorAt(plankIdx, COLOR_BLUE_PLANK);
  else if (teamId === 'red') onBridge.solidMesh.setColorAt(plankIdx, COLOR_RED_PLANK);
  else if (teamId === 'yellow') onBridge.solidMesh.setColorAt(plankIdx, COLOR_YELLOW_PLANK);
  else if (teamId === 'green') onBridge.solidMesh.setColorAt(plankIdx, COLOR_GREEN_PLANK);

  if (onBridge.solidMesh.instanceColor) {
    onBridge.solidMesh.instanceColor.needsUpdate = true;
  }

  const builderChar = characters.find(c => !c.isPlayer && c.team && c.team.id === teamId);
  if (builderChar && builderChar.stackCount > 0) {
    removeBrickFromCharacter(builderChar);
  }
}

/**
 * リモートプレイヤーまたはホスト側AIが床ブロックを拾った際の受信ハンドラ
 */
export function applyRemoteBlockPicked(stageIdx, poolIdx, x, z, blockId = null) {
  const stageBlocks = getFloorBlocksForStage(stageIdx);
  let targetBlock = null;

  // 1. 【最優先】一意の blockId が指定されている場合は完全一致で検索
  if (blockId) {
    targetBlock = stageBlocks.find(b => b.active && b.blockId === blockId);
  }

  // 2. blockId で見つからない、または旧パケットの場合は近接座標マッチング（距離 1.2m 以内）
  if (!targetBlock && x !== undefined && z !== undefined) {
    let minDistSq = 1.2 * 1.2;
    for (let i = 0; i < stageBlocks.length; i++) {
      const b = stageBlocks[i];
      if (b.active) {
        const dx = b.pos.x - x;
        const dz = b.pos.z - z;
        const distSq = dx * dx + dz * dz;
        if (distSq < minDistSq) {
          minDistSq = distSq;
          targetBlock = b;
        }
      }
    }
  }

  if (targetBlock) {
    // 該当ステージ内でマグネットを発動しているキャラクターを探索
    let magnetChar = null;
    let minCharDistSq = 9.5 * 9.5;

    for (let c = 0; c < characters.length; c++) {
      const ch = characters[c];
      if (ch.currentStage === stageIdx && ch.magnetActive && ch.pos) {
        const cdx = ch.pos.x - targetBlock.pos.x;
        const cdz = ch.pos.z - targetBlock.pos.z;
        const cDistSq = cdx * cdx + cdz * cdz;
        if (cDistSq < minCharDistSq) {
          minCharDistSq = cDistSq;
          magnetChar = ch;
        }
      }
    }

    if (magnetChar && !targetBlock.attracting) {
      targetBlock.attracting = true;
      targetBlock.active = false;
      const sIdx = stageBlocks.indexOf(targetBlock);
      if (sIdx !== -1) {
        stageBlocks.splice(sIdx, 1);
      }

      const startVec = new THREE.Vector3(targetBlock.mesh.position.x, targetBlock.mesh.position.y, targetBlock.mesh.position.z);
      activeMagnetBlocks.push({
        poolItem: targetBlock,
        mesh: targetBlock.mesh,
        targetChar: magnetChar,
        team: targetBlock.team,
        startPos: startVec,
        progress: 0,
        duration: 0.55
      });
    } else {
      targetBlock.active = false;
      targetBlock.mesh.visible = false;
      targetBlock.attracting = false;
      const sIdx = stageBlocks.indexOf(targetBlock);
      if (sIdx !== -1) {
        stageBlocks.splice(sIdx, 1);
      }
    }
  }
}

/**
 * 相手端末で消費されたアイテム・ゲートの強制消去ハンドラ
 */
export function applyRemoteObjectConsumed(objectId, objectType) {
  if (!objectId || !objectType) return;

  if (objectType === 'item') {
    const idx = floorItems.findIndex(i => i.itemId === objectId);
    if (idx !== -1) {
      const item = floorItems[idx];
      item.active = false;
      if (item.group) {
        item.group.visible = false;
      }
      floorItems.splice(idx, 1);
    }
  } else if (objectType === 'gate') {
    const gate = modifierGates.find(g => g.gateId === objectId);
    if (gate && !gate.consumed) {
      gate.consumed = true;
      if (gate.meshGroup) {
        gate.meshGroup.visible = false;
      }
    }
  }
}

/**
 * 他端末で敵モブが吹き飛ばされた際の受信ハンドラ
 */
export function applyRemoteBlowMob(mobIndex, stageIdx, pushDirX = 1.0) {
  let targetMob = null;

  if (mobIndex !== undefined && mobIndex >= 0 && mobIndex < obstacleMobs.length) {
    const m = obstacleMobs[mobIndex];
    if (m && m.active && !m.blownAway && m.stageIdx === stageIdx) {
      targetMob = m;
    }
  }

  if (!targetMob) {
    targetMob = obstacleMobs.find(m => m.active && !m.blownAway && m.stageIdx === stageIdx);
  }

  if (targetMob) {
    targetMob.blownAway = true;
    const dirX = (typeof pushDirX === 'number' && !isNaN(pushDirX)) ? pushDirX : 1.0;
    targetMob.blowVelocity.set(dirX * 12.0, 16.0, -18.0);
    triggerLandingShockwave(targetMob.currentX, targetMob.baseY + 0.2, targetMob.baseZ, 2.5, 0xf97316);
  }
}

// グローバル互換バインド（network.js や他ファイルからの window.applyRemote... 参照を100%保証）
if (typeof window !== 'undefined') {
  window.applyRemotePlankBuilt = applyRemotePlankBuilt;
  window.applyRemoteBlockPicked = applyRemoteBlockPicked;
  window.applyRemoteObjectConsumed = applyRemoteObjectConsumed;
  window.applyRemoteBlowMob = applyRemoteBlowMob;
}