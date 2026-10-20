// combat.js: タックル衝突・ノックアウト・攻撃スキル・ブロック散乱専用モジュール
// ★ Step 9 実装版（タックル判定の一方向化・無限増殖防止）：
//   1. handleTackles の接触判定確定権限を一元化：
//      - マルチプレイ時は「勝者側端末」または「ホスト端末（AI勝者時）」のみがノックアウトと散乱を確定・発信
//      - 敗者側端末での重複判定を遮断し、双方判定による「ブロック倍増・無限増殖」「二重散乱パケット合戦」を根絶
//   2. KNOCKOUT イベントを新設し、被弾側端末でのスタン・吹き飛ばしリアクションを安全にトリガー
//   3. 単体プレイ（ソロ）時の当たり判定・アイテムスキル動作は100%維持

import { TEAMS } from './constants.js';
import {
  sharedMats,
  _tempVec3A
} from './materials.js';
import {
  characters,
  removeBrickFromCharacter
} from './character.js';
import {
  STAGES,
  getFloorBlocksForStage,
  setAttackCamTimer
} from './world.js';
import {
  triggerLandingShockwave,
  projectilePool,
  thunderProjectilePool,
  floorBlockPool
} from './particles.js';

let soundRef = null;
let updateHUDRef = null;

/**
 * サウンドおよびHUD更新コールバックの登録
 */
export function setCombatCallbacks(sound, updateHUD) {
  soundRef = sound;
  updateHUDRef = updateHUD;
}

/**
 * 相手端末で発生したブロック散乱（タックル・ゲート・被弾）の受取反映ハンドラ
 */
export function applyRemoteScatterBlocks(stageIdx, blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return;
  const stage = STAGES[stageIdx] || STAGES[0];
  const stageBlocks = getFloorBlocksForStage(stageIdx);

  blocks.forEach(b => {
    // 既存ブロックとの近接（0.55m以内）二重生成チェック
    for (let i = 0; i < stageBlocks.length; i++) {
      const existing = stageBlocks[i];
      if (existing.active && Math.hypot(existing.pos.x - b.x, existing.pos.z - b.z) < 0.55) {
        return;
      }
    }

    let poolItem = floorBlockPool.find(item => !item.active);
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

    poolItem.mesh.material = sharedMats.blockNeutral;
    poolItem.mesh.position.set(b.x, b.y !== undefined ? b.y : (stage.y + 0.29), b.z);
    poolItem.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    poolItem.mesh.visible = true;

    poolItem.active = true;
    poolItem.team = TEAMS.NEUTRAL;
    poolItem.pos = poolItem.mesh.position;
    poolItem.stageIdx = stageIdx;
    poolItem.blockId = b.blockId || `scatter_${stageIdx}_${b.x.toFixed(2)}_${b.z.toFixed(2)}`;
    poolItem.attracting = false;

    stageBlocks.push(poolItem);
  });
}

/**
 * リモートからノックアウト被弾通知を受信した際のリアクションハンドラ
 */
export function applyRemoteKnockout(loserSlot, pushX, pushZ) {
  const loserChar = characters[loserSlot];
  if (!loserChar) return;

  loserChar.stunTimer = 1.4;
  if (loserChar.isPlayer && soundRef) soundRef.playTackle();

  const stage = STAGES[loserChar.currentStage];
  if (stage) {
    const centerX = stage.x || 0.0;
    const nextX = loserChar.pos.x + pushX;
    const nextZ = loserChar.pos.z + pushZ;
    const distToCenter = Math.hypot(nextX - centerX, nextZ - stage.z);
    if (distToCenter > stage.r) {
      const normX = (nextX - centerX) / distToCenter;
      const normZ = (nextZ - stage.z) / distToCenter;
      loserChar.pos.x = centerX + normX * (stage.r - 0.5);
      loserChar.pos.z = stage.z + normZ * (stage.r - 0.5);
    } else {
      loserChar.pos.x = nextX;
      loserChar.pos.z = nextZ;
    }
  } else {
    loserChar.pos.x += pushX;
    loserChar.pos.z += pushZ;
  }
}

// グローバル公開（network.js から安全に呼べるように登録）
if (typeof window !== 'undefined') {
  window.applyRemoteScatterBlocks = applyRemoteScatterBlocks;
  window.applyRemoteKnockout = applyRemoteKnockout;
}

/**
 * タックル被弾・ゲート通過時の所持ブロック床面散乱
 * @param {THREE.Scene} scene 
 * @param {Object} char 
 * @param {number} countToDrop 
 */
export function scatterBricks(scene, char, countToDrop) {
  const count = Math.min(char.stackCount, countToDrop);
  const stage = STAGES[char.currentStage] || STAGES[0];
  const floorY = stage.y + 0.29;
  const maxR = stage.r - 1.0;
  const stageBlocks = getFloorBlocksForStage(char.currentStage);
  const centerX = stage.x || 0.0;
  const droppedBlocks = [];

  for (let i = 0; i < count; i++) {
    removeBrickFromCharacter(char, updateHUDRef);

    const angle = i * 2.39996 + Math.random() * 0.35;
    const dist = 1.6 + Math.sqrt(i + 1) * 0.85;
    let dropX = char.pos.x + Math.cos(angle) * dist;
    let dropZ = char.pos.z + Math.sin(angle) * dist;

    const distFromCenter = Math.hypot(dropX - centerX, dropZ - stage.z);
    if (distFromCenter > maxR && distFromCenter > 0.001) {
      dropX = centerX + ((dropX - centerX) / distFromCenter) * maxR;
      dropZ = stage.z + ((dropZ - stage.z) / distFromCenter) * maxR;
    }

    let poolItem = floorBlockPool.find(b => !b.active);
    if (!poolItem) {
      let bestRecycleIdx = -1;
      let minStageIdx = 999999;
      for (let k = 0; k < floorBlockPool.length; k++) {
        const blk = floorBlockPool[k];
        if (blk.active && !blk.attracting) {
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
      }
    }
    if (!poolItem) break;

    const uniqueScatterId = `s_${char.currentStage}_${Date.now().toString(36)}_${i}`;

    poolItem.mesh.material = sharedMats.blockNeutral;
    poolItem.mesh.position.set(dropX, floorY, dropZ);
    poolItem.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    poolItem.mesh.visible = true;

    poolItem.active = true;
    poolItem.team = TEAMS.NEUTRAL;
    poolItem.pos = poolItem.mesh.position;
    poolItem.stageIdx = char.currentStage;
    poolItem.blockId = uniqueScatterId;
    poolItem.attracting = false;

    stageBlocks.push(poolItem);

    droppedBlocks.push({
      blockId: uniqueScatterId,
      x: Number(dropX.toFixed(2)),
      y: Number(floorY.toFixed(2)),
      z: Number(dropZ.toFixed(2)),
      teamId: 'neutral'
    });
  }

  // マルチプレイ時、判定権限を持つ端末のみが散乱情報をブロードキャスト
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const shouldBroadcast = isMulti && (char.isPlayer || (isHost && char.isAI));

  if (shouldBroadcast && droppedBlocks.length > 0 && typeof window !== 'undefined' && window.AgentSDK) {
    try {
      window.AgentSDK.room.sendMessage({
        message: JSON.stringify({
          event: 'SCATTER_BLOCKS',
          stageIdx: char.currentStage,
          blocks: droppedBlocks
        })
      });
    } catch (err) {
      console.warn('[combat.js] Failed to broadcast SCATTER_BLOCKS:', err);
    }
  }
}

/**
 * ホーミングクリスタル発射スキル
 * @param {Object} char 
 */
export function fireHomingCrystal(char) {
  if (soundRef) soundRef.playAttackShoot();

  let bestForwardTarget = null, minForwardDist = 999999;
  let bestRearTarget = null, minRearDist = 999999;

  characters.forEach(c => {
    if (c === char) return;
    const dz = char.pos.z - c.pos.z;
    const totalDistSq = (char.pos.x - c.pos.x) ** 2 + (char.pos.z - c.pos.z) ** 2;

    if (dz > 0.5) {
      if (totalDistSq < minForwardDist) {
        minForwardDist = totalDistSq;
        bestForwardTarget = c;
      }
    } else if (dz < -0.5) {
      if (totalDistSq < minRearDist) {
        minRearDist = totalDistSq;
        bestRearTarget = c;
      }
    }
  });

  const selectedTarget = bestForwardTarget || bestRearTarget;
  let isRearShot = false;

  const targetPosVec = _tempVec3A;
  if (selectedTarget) {
    targetPosVec.copy(selectedTarget.pos);
    isRearShot = (char.pos.z < selectedTarget.pos.z);
  } else {
    targetPosVec.set(char.pos.x, char.pos.y, char.pos.z - 30);
  }

  triggerLandingShockwave(char.pos.x, char.pos.y + 0.1, char.pos.z, 2.8, 0xf43f5e);

  let proj = projectilePool.find(p => !p.active);
  if (!proj) {
    proj = projectilePool[0];
    let maxProg = proj.progress;
    for (let i = 1; i < projectilePool.length; i++) {
      if (projectilePool[i].progress > maxProg) {
        maxProg = projectilePool[i].progress;
        proj = projectilePool[i];
      }
    }
  }

  proj.active = true;
  proj.shooter = char;
  proj.target = selectedTarget;
  proj.isRear = isRearShot;
  proj.progress = 0;
  proj.duration = 1.35;

  proj.startPos.copy(char.pos);
  proj.startPos.y += 1.3;
  proj.targetPos.copy(targetPosVec);
  if (selectedTarget) proj.targetPos.y += 1.0;

  proj.group.position.copy(proj.startPos);
  proj.group.visible = true;

  if (selectedTarget && proj.reticle) {
    proj.reticle.position.set(selectedTarget.pos.x, selectedTarget.pos.y + 0.08, selectedTarget.pos.z);
    proj.reticle.visible = true;
  }

  for (let h = 0; h < proj.history.length; h++) {
    proj.history[h].copy(proj.startPos);
  }

  for (let j = 0; j < proj.trailSpheres.length; j++) {
    const item = proj.trailSpheres[j];
    item.mesh.position.copy(proj.startPos);
    item.mesh.visible = true;
    const lifeFade = 1.0 - (j / proj.trailSpheres.length);
    item.material.opacity = lifeFade * 0.95;
  }

  if (char.isPlayer) {
    setAttackCamTimer(1.4);
  }
}

/**
 * サンダー落雷発射スキル
 * @param {THREE.Scene} scene 
 * @param {Object} userChar 
 */
export function fireThunderStrike(scene, userChar) {
  if (soundRef && soundRef.playAttackShoot) soundRef.playAttackShoot();

  let target = null;
  let minZ = 999999;
  characters.forEach(c => {
    if (c === userChar) return;
    if (c.pos.z < minZ) {
      minZ = c.pos.z;
      target = c;
    }
  });

  if (!target) return;

  let tp = thunderProjectilePool.find(p => !p.active);
  if (!tp) {
    tp = thunderProjectilePool[0];
    let maxProg = tp.progress;
    for (let i = 1; i < thunderProjectilePool.length; i++) {
      if (thunderProjectilePool[i].progress > maxProg) {
        maxProg = thunderProjectilePool[i].progress;
        tp = thunderProjectilePool[i];
      }
    }
  }

  tp.active = true;
  tp.shooter = userChar;
  tp.target = target;
  tp.progress = 0;
  tp.duration = 1.35;

  tp.startPos.copy(userChar.pos);
  tp.startPos.y += 1.3;
  tp.targetPos.copy(target.pos);
  tp.targetPos.y += 1.0;

  tp.group.position.copy(tp.startPos);
  tp.group.visible = true;

  if (target && tp.reticle) {
    tp.reticle.position.set(target.pos.x, target.pos.y + 0.08, target.pos.z);
    tp.reticle.visible = true;
  }

  for (let h = 0; h < tp.history.length; h++) {
    tp.history[h].copy(tp.startPos);
  }

  for (let j = 0; j < tp.trailSpheres.length; j++) {
    const item = tp.trailSpheres[j];
    item.mesh.position.copy(tp.startPos);
    item.mesh.visible = true;
    const lifeFade = 1.0 - (j / tp.trailSpheres.length);
    item.material.opacity = lifeFade * 0.95;
  }

  triggerLandingShockwave(userChar.pos.x, userChar.pos.y + 0.1, userChar.pos.z, 2.2, 0xfacc15);

  if (userChar.isPlayer) {
    setAttackCamTimer(1.4);
  }
}

/**
 * キャラクター同士のタックル衝突判定
 * ★【Step 9 核心】判定確定権限の一元化（勝者側端末 または ホスト端末のみが確定実行）
 * @param {THREE.Scene} scene 
 */
export function handleTackles(scene) {
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = (isMulti && window.NetworkManager.isHost);

  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const c1 = characters[i], c2 = characters[j];
      if (c1.currentStage !== c2.currentStage) continue;
      if (c1.invulnerableTimer > 0 || c2.invulnerableTimer > 0) continue;

      const stage = STAGES[c1.currentStage];
      if (!stage) continue;

      const centerX = stage.x || 0.0;
      const onIsland1 = ((c1.pos.x - centerX) ** 2 + (c1.pos.z - stage.z) ** 2) < (stage.r * stage.r);
      const onIsland2 = ((c2.pos.x - centerX) ** 2 + (c2.pos.z - stage.z) ** 2) < (stage.r * stage.r);
      if (!onIsland1 || !onIsland2) continue;

      const tdx = c1.pos.x - c2.pos.x;
      const tdz = c1.pos.z - c2.pos.z;
      if ((tdx * tdx + tdz * tdz < 1.69) && Math.abs(c1.pos.y - c2.pos.y) < 1.0) {
        let winner = null;
        let loser = null;

        if (c1.stackCount > c2.stackCount) {
          winner = c1;
          loser = c2;
        } else if (c2.stackCount > c1.stackCount) {
          winner = c2;
          loser = c1;
        }

        if (winner && loser) {
          // マルチプレイ時は「勝者が自操作キャラ」または「ホスト端末でAIが勝者」の場合のみ判定確定権限を持つ
          const hasAuthority = !isMulti || winner.isPlayer || (isHost && winner.isAI);
          if (hasAuthority) {
            tackleKnockout(scene, winner, loser);
          }
        }
      }
    }
  }
}

/**
 * タックル敗者のノックアウト・所持ブロック放出
 * ★【Step 9 改善】被弾側へ KNOCKOUT イベントを通知し、散乱ブロックの二重生成を完全防止
 * @param {THREE.Scene} scene 
 * @param {Object} winner 
 * @param {Object} loser 
 */
export function tackleKnockout(scene, winner, loser) {
  if (loser.stunTimer > 0 || loser.invulnerableTimer > 0) return;
  loser.stunTimer = 1.4;
  if (loser.isPlayer && soundRef) soundRef.playTackle();

  const drops = Math.min(6, Math.max(2, Math.floor(loser.stackCount * 0.35)));
  scatterBricks(scene, loser, drops);

  const kx = loser.pos.x - winner.pos.x, kz = loser.pos.z - winner.pos.z;
  const mag = Math.hypot(kx, kz) || 1;
  const pushX = (kx / mag) * 2.0;
  const pushZ = (kz / mag) * 2.0;

  const stage = STAGES[loser.currentStage];
  if (stage) {
    const centerX = stage.x || 0.0;
    const nextX = loser.pos.x + pushX;
    const nextZ = loser.pos.z + pushZ;
    const distToCenter = Math.hypot(nextX - centerX, nextZ - stage.z);
    if (distToCenter > stage.r) {
      const normX = (nextX - centerX) / distToCenter;
      const normZ = (nextZ - stage.z) / distToCenter;
      loser.pos.x = centerX + normX * (stage.r - 0.5);
      loser.pos.z = stage.z + normZ * (stage.r - 0.5);
    } else {
      loser.pos.x = nextX;
      loser.pos.z = nextZ;
    }
  } else {
    loser.pos.x += pushX;
    loser.pos.z += pushZ;
  }

  // マルチプレイ時、被弾側端末へノックアウト（スタン＆吹き飛び）を通知
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  if (isMulti && typeof window !== 'undefined' && window.AgentSDK) {
    const loserSlot = characters.indexOf(loser);
    if (loserSlot !== -1) {
      try {
        window.AgentSDK.room.sendMessage({
          message: JSON.stringify({
            event: 'KNOCKOUT',
            loserSlot: loserSlot,
            pushX: Number(pushX.toFixed(2)),
            pushZ: Number(pushZ.toFixed(2))
          })
        });
      } catch (err) {
        console.warn('[combat.js] Failed to broadcast KNOCKOUT:', err);
      }
    }
  }
}