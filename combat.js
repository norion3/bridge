// combat.js: タックル衝突・ノックアウト・攻撃スキル・ブロック散乱・攻撃ヒットログ弾幕連携専用モジュール
// ★ 既存チャットUIフォーマット準拠 攻撃ヒットログ（弾幕連携）完全実装版：
//   1. 【既存チャット先頭バッジを活用した極限ミニマルヒットログ (notifyCombatHit)】
//      danmaku.js の先頭バッジ（チームカラー枠・背景・名前）を活用し、
//      メッセージ本文側の攻撃者名重複を完全排除。
//      - ホーミング弾着弾：[攻撃者バッジ] > 被弾者 HIT
//      - サンダー落雷直撃：[攻撃者バッジ] > 被弾者 THUNDER
//      絵文字・余計な修飾を一切排除した半角英数ミニマル表記により、
//      レース走行中の視界を1ミリも塞がず、0.1秒で「誰が・誰に・何を当てたか」を脳に伝達。
//   2. 【着地・被弾調停ハンドラ (applyHomingHit / applyThunderHit)】
//      着弾時のスタン、小人化、ブロック散乱、サウンド、衝撃波、および弾幕通知を統合。
//      ソロプレイ（VS CPU Bot）およびマルチプレイ（VS 実プレイヤー）双方で完全自動発火。
//   3. 【真横並走（-0.5 <= dz <= 0.5）ロックオン捕捉の完全維持】
//   4. 【散乱ブロードキャスト条件整合＆タックル早期定数判定の完全維持】

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
import { spawnDanmaku } from './danmaku.js';

// --- 高速・ゼロアロケーション純粋算術丸めヘルパー（文字列インスタンス生成ゼロ） ---
const round2 = (val) => Math.round(val * 100) / 100;

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
 * 攻撃アイテム着弾通知（弾幕チャット連携）
 * 既存チャットUIの先頭チームカラーバッジ（攻撃者名）をそのまま活かし、
 * 本文は「> 被弾者名 アクション種別」のみに絞り込んだ極限ミニマルキルログ
 * @param {Object} shooterChar 攻撃者
 * @param {Object} targetChar 被弾者
 * @param {string} actionType 'HIT' | 'THUNDER'
 */
export function notifyCombatHit(shooterChar, targetChar, actionType = 'HIT') {
  if (!targetChar || !shooterChar) return;

  const shooterName = shooterChar.name || 'YOU';
  const targetName = targetChar.name || 'YOU';
  const shooterTeam = (shooterChar.team && shooterChar.team.id) ? shooterChar.team.id : 'blue';

  // ★ 先頭に [shooterName] バッジが出るため、本文は「> 被弾者 アクション」のみ！
  const logText = `> ${targetName} ${actionType}`;
  spawnDanmaku(logText, shooterName, shooterTeam);
}

/**
 * ホーミング弾着弾時の被弾調停 ＆ 弾幕ログ通知
 * @param {Object} targetChar 被弾キャラクター
 * @param {Object} shooterChar 発射キャラクター
 * @param {THREE.Scene} scene (optional)
 */
export function applyHomingHit(targetChar, shooterChar, scene = null) {
  if (!targetChar) return;

  targetChar.stunTimer = 1.4;
  targetChar.invulnerableTimer = 1.4;
  targetChar.isStunned = true;
  targetChar.netVelocity = { x: 0, z: 0 };

  if (soundRef && soundRef.playAttackHit) {
    soundRef.playAttackHit();
  }

  triggerLandingShockwave(targetChar.pos.x, targetChar.pos.y + 0.1, targetChar.pos.z, 2.0, 0xf43f5e);

  const activeScene = scene || (typeof window !== 'undefined' ? window.currentSceneRef : null);
  if (activeScene) {
    scatterBricks(activeScene, targetChar, 3, true);
  }

  // ★ 弾幕チャットヒットログ通知: [shooterName] > targetName HIT
  if (shooterChar) {
    notifyCombatHit(shooterChar, targetChar, 'HIT');
  }
}

/**
 * サンダー落雷直撃時の被弾調停 ＆ 弾幕ログ通知
 * @param {Object} targetChar 被弾キャラクター
 * @param {Object} shooterChar 発射キャラクター
 * @param {THREE.Scene} scene (optional)
 */
export function applyThunderHit(targetChar, shooterChar, scene = null) {
  if (!targetChar) return;

  targetChar.shrinkTimer = 5.0;
  targetChar.isShrunk = true;
  targetChar.stunTimer = 0.8;
  targetChar.invulnerableTimer = 1.2;
  targetChar.isStunned = true;
  targetChar.netVelocity = { x: 0, z: 0 };

  if (soundRef && soundRef.playThunderStrike) {
    soundRef.playThunderStrike();
  }

  triggerLandingShockwave(targetChar.pos.x, targetChar.pos.y + 0.1, targetChar.pos.z, 2.4, 0xfacc15);

  const activeScene = scene || (typeof window !== 'undefined' ? window.currentSceneRef : null);
  if (activeScene) {
    scatterBricks(activeScene, targetChar, 4, true);
  }

  // ★ 弾幕チャットヒットログ通知: [shooterName] > targetName THUNDER
  if (shooterChar) {
    notifyCombatHit(shooterChar, targetChar, 'THUNDER');
  }
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

  // 被弾衝撃波エフェクトの表示（新接触半径に合わせて 1.8m へ調整）
  triggerLandingShockwave(loserChar.pos.x, loserChar.pos.y + 0.1, loserChar.pos.z, 1.8, 0xef4444);
}

/**
 * タックル被弾・ゲート通過時の所持ブロック床面散乱
 * ★ round2 による純粋算術丸めで文字列オブジェクト生成を完全排除
 * ★ forceBroadcast フラグ判定の適正化（スキル着弾時にも確実にブロードキャスト）
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

    // ★ 純粋算術丸め（round2）により一時文字列オブジェクト生成を完全ゼロ化
    flatCoords.push([round2(dropX), round2(dropZ)]);
  }

  const isMulti = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isMultiplayerActive);
  const isHost = (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.isHost);
  // ★ forceBroadcast が true なら被弾者がホスト・ゲスト・AI問わず確実に送信キューへ預ける
  const shouldBroadcast = isMulti && (forceBroadcast || char.isPlayer || (isHost && char.isAI));

  if (shouldBroadcast && flatCoords.length > 0 && typeof window !== 'undefined' && window.NetworkManager) {
    if (typeof window.NetworkManager.queueScatterBlocks === 'function') {
      window.NetworkManager.queueScatterBlocks(char.currentStage, charSlot, baseId, flatCoords);
    }
  }
}

/**
 * ホーミングクリスタル発射スキル
 * ★【核心改修】真横並走（-0.5 <= dz <= 0.5）の敵を確実にロックオン捕捉
 * @param {Object} char 
 * @param {Object} forcedTarget (optional)
 * @param {boolean} isRemote (optional)
 */
export function fireHomingCrystal(char, forcedTarget = undefined, isRemote = false) {
  if (soundRef) soundRef.playAttackShoot();

  let selectedTarget = forcedTarget;

  if (!isRemote && forcedTarget === undefined) {
    let bestTarget = null;
    let minDistanceSq = 999999;
    let bestForwardTarget = null;
    let minForwardDist = 999999;

    characters.forEach(c => {
      if (c === char) return;
      const dz = char.pos.z - c.pos.z; // 前方なら dz > 0
      const totalDistSq = (char.pos.x - c.pos.x) ** 2 + (char.pos.z - c.pos.z) ** 2;

      // 全体での最短距離候補（真横・並走含む）
      if (totalDistSq < minDistanceSq) {
        minDistanceSq = totalDistSq;
        bestTarget = c;
      }

      // 明確な前方ターゲット（先行している敵）
      if (dz > 0.3) {
        if (totalDistSq < minForwardDist) {
          minForwardDist = totalDistSq;
          bestForwardTarget = c;
        }
      }
    });

    // ★ 前方に敵がいるなら前方優先、真横並走または後方なら全体最短ターゲットを確実にロックオン
    selectedTarget = bestForwardTarget || bestTarget;

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
 * ★ Phase 4: 通常時（95%以上）の早期定数分岐により浮動小数点乗算・平方演算を完全バイパス
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

      // ★【早期定数分岐】双方が通常サイズ時は定数 1.90 を直接採用し、小人化走者が関与する時のみ動的乗算を実行
      let collisionDistSq = 1.90;
      if (c1.shrinkTimer > 0 || c2.shrinkTimer > 0) {
        const scale1 = (c1.shrinkTimer > 0) ? 0.42 : 1.0;
        const scale2 = (c2.shrinkTimer > 0) ? 0.42 : 1.0;
        const effectiveScale = (scale1 + scale2) * 0.5;
        collisionDistSq = 1.90 * (effectiveScale * effectiveScale);
      }

      if ((tdx * tdx + tdz * tdz < collisionDistSq) && Math.abs(c1.pos.y - c2.pos.y) < 1.4) {
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

  const pushX1 = -(kx / mag) * 1.2;
  const pushZ1 = -(kz / mag) * 1.2;
  const pushX2 = (kx / mag) * 1.2;
  const pushZ2 = (kz / mag) * 1.2;

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
  const pushX = (kx / mag) * 1.8;
  const pushZ = (kz / mag) * 1.8;

  const drops = Math.min(6, Math.max(2, Math.floor(loser.stackCount * 0.35)));
  executeSingleKnockout(scene, loser, pushX, pushZ, 1.4, drops);
}

/**
 * 単一キャラクターのノックアウト確定実行ヘルパー
 * ★ round2 による純粋算術丸めで文字列オブジェクト生成を完全排除
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

  triggerLandingShockwave(finalX, charObj.pos.y + 0.1, finalZ, 1.8, 0xef4444);

  // ★ 純粋算術丸め（round2）により一時文字列オブジェクト生成を完全ゼロ化
  if (isMulti && typeof window !== 'undefined' && window.NetworkManager) {
    const loserSlot = characters.indexOf(charObj);
    if (loserSlot !== -1 && typeof window.NetworkManager.queueKnockout === 'function') {
      window.NetworkManager.queueKnockout(
        loserSlot,
        round2(pushX),
        round2(pushZ),
        round2(finalX),
        round2(finalZ)
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
  window.applyRemoteScatterBlocks = applyRemoteScatterBlocks;
  window.applyRemoteKnockout = applyRemoteKnockout;
  window.applyRemoteFireSkill = applyRemoteFireSkill;
  window.applyHomingHit = applyHomingHit;
  window.applyThunderHit = applyThunderHit;
  window.notifyCombatHit = notifyCombatHit;
}