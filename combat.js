// combat.js: タックル衝突・ノックアウト・攻撃スキル・ブロック散乱専用モジュール
// ★ 確定仕様（ゼロバースト・決定論的圧縮アーキテクチャ）：
//   1. 【スキル発射 ＆ ノックアウトの生 sendMessage 直打ち完全根絶】
//      fireHomingCrystal / fireThunderStrike / executeSingleKnockout 内で起きていた
//      生の単発 sendMessage 呼び出しを撤廃。NetworkManager.queueSkillFire および
//      NetworkManager.queueKnockout へ切り替え、100ms周期の POS パケットに完全集約。
//   2. 【ゼロレイテンシ（操作遅延0ms）の完全維持】
//      スキル発射音、自端末での弾丸生成、カメラワーク、被弾衝撃波などのローカル演出は
//      入力／衝突フレームで即座（0ms）に実行。相手への通知のみを10Hzキューに預ける。
//   3. 【散乱ブロック（scatterBricks）の極小フラット配列化 ＆ 決定論的ID生成】
//      散乱ブロックIDを [ステージ番号] + [走者スロット番号] + [短縮基点ID] + [連番] の
//      決定論的ルールで生成し、フラットな2D座標配列 [[x, z], ...] として同封。
//      散乱直後に拾われた場合でも、全端末で完全な O(1) 参照・消去の整合性を担保。

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
 * network.js で決定論的に復元された { blockId, x, z } の配列を受け取って床面に配置
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
    poolItem.blockId = b.blockId;
    poolItem.attracting = false;

    stageBlocks.push(poolItem);
  });
}

/**
 * リモートからノックアウト被弾通知を受信した際のリアクションハンドラ
 * 確定着地座標へ強制移動し、直前の移動補間による引き戻し（ラバーバンド）を遮断
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

if (typeof window !== 'undefined') {
  window.applyRemoteScatterBlocks = applyRemoteScatterBlocks;
  window.applyRemoteKnockout = applyRemoteKnockout;
}

/**
 * タックル被弾・ゲート通過時の所持ブロック床面散乱
 * 決定論的ID（s_{stage}_{slot}_{baseId}_{i}）とフラット座標配列 [[x, z], ...] を生成してキューイング
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

  const charSlot = characters.indexOf(char) >= 0 ? characters.indexOf(char) : 0;
  // 6桁短縮タイムスタンプを基点IDとして使用
  const baseId = Math.floor(Date.now() % 1000000);
  const flatCoords = [];

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

    // 決定論的ブロックIDの生成
    const uniqueScatterId = `s_${char.currentStage}_${charSlot}_${baseId}_${i}`;

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

    // 通信用フラット2D座標配列
    flatCoords.push([Number(dropX.toFixed(2)), Number(dropZ.toFixed(2))]);
  }

  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  const shouldBroadcast = isMulti && (forceBroadcast || char.isPlayer || (isHost && char.isAI));

  if (shouldBroadcast && flatCoords.length > 0 && typeof window !== 'undefined' && window.NetworkManager) {
    if (typeof window.NetworkManager.queueScatterBlocks === 'function') {
      window.NetworkManager.queueScatterBlocks(char.currentStage, charSlot, baseId, flatCoords);
    }
  }
}

/**
 * ホーミングクリスタル発射スキル（生送信を完全排除しキューイング化）
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

    if (shouldBroadcast && typeof window !== 'undefined' && window.NetworkManager) {
      const shooterSlot = characters.indexOf(char);
      const targetSlot = selectedTarget ? characters.indexOf(selectedTarget) : -1;
      if (shooterSlot !== -1 && typeof window.NetworkManager.queueSkillFire === 'function') {
        // 0: homing
        window.NetworkManager.queueSkillFire(0, shooterSlot, targetSlot);
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
 * サンダー落雷発射スキル（生送信を完全排除しキューイング化）
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

    if (shouldBroadcast && typeof window !== 'undefined' && window.NetworkManager) {
      const shooterSlot = characters.indexOf(userChar);
      const targetSlot = target ? characters.indexOf(target) : -1;
      if (shooterSlot !== -1 && typeof window.NetworkManager.queueSkillFire === 'function') {
        // 1: thunder
        window.NetworkManager.queueSkillFire(1, shooterSlot, targetSlot);
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
 * キャラクター同士のタックル衝突判定（ホスト権限調停）
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
 * 単一キャラクターのノックアウト確定実行ヘルパー（生送信を完全排除しキューイング化）
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

  // 生 sendMessage を完全撤廃し、NetworkManager.queueKnockout へ切り替え
  if (isMulti && typeof window !== 'undefined' && window.NetworkManager) {
    const loserSlot = characters.indexOf(charObj);
    if (loserSlot !== -1 && typeof window.NetworkManager.queueKnockout === 'function') {
      window.NetworkManager.queueKnockout(
        loserSlot,
        Number(pushX.toFixed(2)),
        Number(pushZ.toFixed(2)),
        Number(finalX.toFixed(2)),
        Number(finalZ.toFixed(2))
      );
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