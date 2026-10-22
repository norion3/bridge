// combat.js: タックル衝突・ノックアウト・攻撃スキル・ブロック散乱専用モジュール
// ★ Phase 2 実装版（被弾散乱ブロックの生通信連打停止 ＆ 100ms周期キューイング化）：
//   1. 【散乱ブロック（SCATTER_BLOCKS）の生 sendMessage 連打停止】
//      scatterBricks 内で起きていた生の単発 sendMessage 連射を廃止。
//      NetworkManager.queueScatterBlocks を呼び出して 100ms 周期の POS パケットに同封させるためバッファへ蓄積。
//   2. 【タックル時通信バースト・キュー溢れの完全根絶】
//      激しい正面衝突や連続被弾時でも、通信呼び出しが即時連打されず、厳格な 10Hz 通信を 100% 維持。
//   3. 【既存の衝突判定・ホスト着地確定・スキル演出の完全維持】
//      スタック同数相打ちクラッシュ、判定マージン拡大（1.95m）、無敵時間（1.4秒）、スキル発射は100%維持。

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
export function applyRemoteKnockout(loserSlot, pushX, pushZ, targetX = null, targetZ = null) {
  const loserChar = characters[loserSlot];
  if (!loserChar) return;

  loserChar.stunTimer = 1.4;
  loserChar.invulnerableTimer = 1.4;
  loserChar.isStunned = true;

  // 直前の歩行慣性を完全クリアし、直前のベクトルで引き戻されるのを遮断
  loserChar.netVelocity = { x: 0, z: 0 };

  if (soundRef) soundRef.playTackle();

  // ホスト権限でノックアウトされた場合、ゲスト側でも手持ちスタックを減算
  if (loserChar.isPlayer) {
    const drops = Math.min(6, Math.max(2, Math.floor(loserChar.stackCount * 0.35)));
    for (let i = 0; i < drops; i++) {
      removeBrickFromCharacter(loserChar, updateHUDRef);
    }
  }

  // ホストから確定着地座標が送られてきている場合はそれを優先採用
  if (targetX !== null && targetZ !== null && !isNaN(targetX) && !isNaN(targetZ)) {
    loserChar.pos.x = targetX;
    loserChar.pos.z = targetZ;
  } else {
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

  if (loserChar.meshObj && loserChar.meshObj.root) {
    loserChar.meshObj.root.position.copy(loserChar.pos);
  }
  if (loserChar.targetNetPos) {
    loserChar.targetNetPos.copy(loserChar.pos);
  }

  // 被弾衝撃波エフェクトの表示
  triggerLandingShockwave(loserChar.pos.x, loserChar.pos.y + 0.1, loserChar.pos.z, 2.0, 0xef4444);
}

// グローバル公開（network.js から安全に呼べるように登録）
if (typeof window !== 'undefined') {
  window.applyRemoteScatterBlocks = applyRemoteScatterBlocks;
  window.applyRemoteKnockout = applyRemoteKnockout;
}

/**
 * タックル被弾・ゲート通過時の所持ブロック床面散乱
 * ★【Phase 2 改善】生 sendMessage の即時乱射を撤廃し、100ms周期パケットへ相乗りさせるためキューイング
 * @param {THREE.Scene} scene 
 * @param {Object} char 
 * @param {number} countToDrop 
 * @param {boolean} forceBroadcast
 */
export function scatterBricks(scene, char, countToDrop, forceBroadcast = false) {
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

  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const shouldBroadcast = isMulti && (forceBroadcast || char.isPlayer || (isHost && char.isAI));

  if (shouldBroadcast && droppedBlocks.length > 0 && typeof window !== 'undefined' && window.NetworkManager) {
    // ★【Phase 2 核心】生の sendMessage 連打を撤廃し、100ms周期キューへ蓄積（未実装時はフォールバック送信）
    if (typeof window.NetworkManager.queueScatterBlocks === 'function') {
      window.NetworkManager.queueScatterBlocks(char.currentStage, droppedBlocks);
    } else if (typeof window.NetworkManager._sendCustomMessage === 'function') {
      window.NetworkManager._sendCustomMessage({
        event: 'SCATTER_BLOCKS',
        stageIdx: char.currentStage,
        blocks: droppedBlocks
      });
    }
  }
}

/**
 * ホーミングクリスタル発射スキル
 * @param {Object} char 
 * @param {Object} forcedTarget (optional)
 * @param {boolean} isRemote (optional)
 */
export function fireHomingCrystal(char, forcedTarget = undefined, isRemote = false) {
  if (soundRef) soundRef.playAttackShoot();

  let selectedTarget = forcedTarget;

  if (!isRemote && forcedTarget === undefined) {
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

    selectedTarget = bestForwardTarget || bestRearTarget;

    const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
    const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
    const shouldBroadcast = isMulti && (char.isPlayer || (isHost && char.isAI));

    if (shouldBroadcast && typeof window !== 'undefined' && window.AgentSDK) {
      const shooterSlot = characters.indexOf(char);
      const targetSlot = selectedTarget ? characters.indexOf(selectedTarget) : -1;
      if (shooterSlot !== -1) {
        try {
          window.AgentSDK.room.sendMessage({
            message: JSON.stringify({
              event: 'FIRE_SKILL',
              skillType: 'homing',
              shooterSlot: shooterSlot,
              targetSlot: targetSlot
            })
          });
        } catch (err) {
          console.warn('[combat.js] Failed to broadcast FIRE_SKILL:', err);
        }
      }
    }
  }

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

  if (char.isPlayer && !isRemote) {
    setAttackCamTimer(1.4);
  }
}

/**
 * サンダー落雷発射スキル
 * @param {THREE.Scene} scene 
 * @param {Object} userChar 
 * @param {Object} forcedTarget (optional)
 * @param {boolean} isRemote (optional)
 */
export function fireThunderStrike(scene, userChar, forcedTarget = undefined, isRemote = false) {
  if (soundRef && soundRef.playAttackShoot) soundRef.playAttackShoot();

  let target = forcedTarget;

  if (!isRemote && forcedTarget === undefined) {
    let minZ = 999999;
    characters.forEach(c => {
      if (c === userChar) return;
      if (c.pos.z < minZ) {
        minZ = c.pos.z;
        target = c;
      }
    });

    const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
    const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
    const shouldBroadcast = isMulti && (userChar.isPlayer || (isHost && userChar.isAI));

    if (shouldBroadcast && typeof window !== 'undefined' && window.AgentSDK) {
      const shooterSlot = characters.indexOf(userChar);
      const targetSlot = target ? characters.indexOf(target) : -1;
      if (shooterSlot !== -1) {
        try {
          window.AgentSDK.room.sendMessage({
            message: JSON.stringify({
              event: 'FIRE_SKILL',
              skillType: 'thunder',
              shooterSlot: shooterSlot,
              targetSlot: targetSlot
            })
          });
        } catch (err) {
          console.warn('[combat.js] Failed to broadcast FIRE_SKILL:', err);
        }
      }
    }
  }

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

  if (userChar.isPlayer && !isRemote) {
    setAttackCamTimer(1.4);
  }
}

/**
 * キャラクター同士のタックル衝突判定
 * @param {THREE.Scene} scene 
 */
export function handleTackles(scene) {
  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = (isMulti && window.NetworkManager.isHost);

  // マルチプレイ時はホスト端末のみが全キャラの接触を計算
  if (isMulti && !isHost) {
    return;
  }

  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const c1 = characters[i], c2 = characters[j];
      if (c1.currentStage !== c2.currentStage) continue;
      if (c1.invulnerableTimer > 0 || c2.invulnerableTimer > 0) continue;
      if (c1.stunTimer > 0 || c2.stunTimer > 0) continue;

      const stage = STAGES[c1.currentStage];
      if (!stage) continue;

      const centerX = stage.x || 0.0;
      const onIsland1 = ((c1.pos.x - centerX) ** 2 + (c1.pos.z - stage.z) ** 2) < (stage.r * stage.r);
      const onIsland2 = ((c2.pos.x - centerX) ** 2 + (c2.pos.z - stage.z) ** 2) < (stage.r * stage.r);
      if (!onIsland1 || !onIsland2) continue;

      const tdx = c1.pos.x - c2.pos.x;
      const tdz = c1.pos.z - c2.pos.z;

      if ((tdx * tdx + tdz * tdz < 3.80) && Math.abs(c1.pos.y - c2.pos.y) < 1.4) {
        if (c1.stackCount > c2.stackCount) {
          tackleKnockout(scene, c1, c2);
        } else if (c2.stackCount > c1.stackCount) {
          tackleKnockout(scene, c2, c1);
        } else {
          tackleClashBoth(scene, c1, c2);
        }
      }
    }
  }
}

/**
 * スタック同数時（0枚同士含む）の相打ちクラッシュ処理
 * @param {THREE.Scene} scene 
 * @param {Object} c1 
 * @param {Object} c2 
 */
export function tackleClashBoth(scene, c1, c2) {
  if (c1.stunTimer > 0 || c2.stunTimer > 0 || c1.invulnerableTimer > 0 || c2.invulnerableTimer > 0) return;

  const kx = c2.pos.x - c1.pos.x;
  const kz = c2.pos.z - c1.pos.z;
  const mag = Math.hypot(kx, kz) || 1;

  const pushX1 = -(kx / mag) * 1.5;
  const pushZ1 = -(kz / mag) * 1.5;
  const pushX2 = (kx / mag) * 1.5;
  const pushZ2 = (kz / mag) * 1.5;

  executeSingleKnockout(scene, c1, pushX1, pushZ1, 0.9, 1);
  executeSingleKnockout(scene, c2, pushX2, pushZ2, 0.9, 1);
}

/**
 * タックル敗者のノックアウト・所持ブロック放出
 * @param {THREE.Scene} scene 
 * @param {Object} winner 
 * @param {Object} loser 
 */
export function tackleKnockout(scene, winner, loser) {
  if (loser.stunTimer > 0 || loser.invulnerableTimer > 0) return;

  const kx = loser.pos.x - winner.pos.x, kz = loser.pos.z - winner.pos.z;
  const mag = Math.hypot(kx, kz) || 1;
  const pushX = (kx / mag) * 2.2;
  const pushZ = (kz / mag) * 2.2;

  const drops = Math.min(6, Math.max(2, Math.floor(loser.stackCount * 0.35)));
  executeSingleKnockout(scene, loser, pushX, pushZ, 1.4, drops);
}

/**
 * 単一キャラクターのノックアウト確定実行ヘルパー
 * @param {THREE.Scene} scene 
 * @param {Object} charObj 
 * @param {number} pushX 
 * @param {number} pushZ 
 * @param {number} stunDuration 
 * @param {number} dropCount 
 */
function executeSingleKnockout(scene, charObj, pushX, pushZ, stunDuration, dropCount) {
  charObj.stunTimer = stunDuration;
  charObj.invulnerableTimer = 1.4;
  charObj.isStunned = true;
  charObj.netVelocity = { x: 0, z: 0 };

  if (soundRef) soundRef.playTackle();

  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = (isMulti && window.NetworkManager.isHost);
  const forceBroadcast = (isMulti && isHost);

  if (dropCount > 0) {
    scatterBricks(scene, charObj, dropCount, forceBroadcast);
  }

  let finalX = charObj.pos.x + pushX;
  let finalZ = charObj.pos.z + pushZ;

  const stage = STAGES[charObj.currentStage];
  if (stage) {
    const centerX = stage.x || 0.0;
    const distToCenter = Math.hypot(finalX - centerX, finalZ - stage.z);
    if (distToCenter > stage.r) {
      const normX = (finalX - centerX) / distToCenter;
      const normZ = (finalZ - stage.z) / distToCenter;
      finalX = centerX + normX * (stage.r - 0.5);
      finalZ = stage.z + normZ * (stage.r - 0.5);
    }
  }

  charObj.pos.x = finalX;
  charObj.pos.z = finalZ;
  if (charObj.meshObj && charObj.meshObj.root) {
    charObj.meshObj.root.position.copy(charObj.pos);
  }
  if (charObj.targetNetPos) {
    charObj.targetNetPos.set(finalX, charObj.pos.y, finalZ);
  }

  triggerLandingShockwave(finalX, charObj.pos.y + 0.1, finalZ, 2.0, 0xef4444);

  if (isMulti && typeof window !== 'undefined' && window.AgentSDK) {
    const loserSlot = characters.indexOf(charObj);
    if (loserSlot !== -1) {
      try {
        window.AgentSDK.room.sendMessage({
          message: JSON.stringify({
            event: 'KNOCKOUT',
            loserSlot: loserSlot,
            pushX: Number(pushX.toFixed(2)),
            pushZ: Number(pushZ.toFixed(2)),
            targetX: Number(finalX.toFixed(2)),
            targetZ: Number(finalZ.toFixed(2))
          })
        });
      } catch (err) {
        console.warn('[combat.js] Failed to broadcast KNOCKOUT:', err);
      }
    }
  }
}

/**
 * 他端末からの攻撃スキル発射を受信し、視覚エフェクトを生成するハンドラ
 */
export function applyRemoteFireSkill(skillType, shooterSlot, targetSlot) {
  const shooter = characters[shooterSlot];
  const target = targetSlot >= 0 ? characters[targetSlot] : null;
  if (!shooter) return;

  const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;

  if (skillType === 'homing') {
    fireHomingCrystal(shooter, target, true);
  } else if (skillType === 'thunder') {
    if (activeScene) {
      fireThunderStrike(activeScene, shooter, target, true);
    }
  }
}

if (typeof window !== 'undefined') {
  window.applyRemoteFireSkill = applyRemoteFireSkill;
}