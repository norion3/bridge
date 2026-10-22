// entities.js: 飛翔体・雷・ドレイン・マグネット・演出パーティクル・浮遊雲の毎フレーム更新モジュール
// ★ Phase C 実装版（画面外アイテム・ボーナスブロックの不要アニメーション計算間引き）：
//   1. 【視界外アイテム・ボーナスのアニメーション更新スキップ】
//      プレイヤーから前後40m以上離れたアイテム（floorItems）やボーナスブロック（slide/zipline/skydive）の
//      毎フレーム三角関数（Math.sin）や自転回転計算、無駄な行列更新を完全バイパス。
//   2. 【浮遊雲の計算カリング適正化】
//      遠方の雲（前後55m超）の浮遊アニメーション更新を間引き、GPU/CPUの無駄な負荷を抑制。
//   3. 既存のホーミング弾・サンダー・ドレイン・マグネット・衝撃波などの各種演出・オブジェクトプール管理は100%維持。

import {
  sharedMats,
  _tempVec3A,
  _tempVec3B,
  lightningPillarGeo
} from './materials.js';
import {
  addBrickToCharacter
} from './character.js';
import {
  floorItems,
  curvedSlideBonusBlocks,
  ziplineBonusBlocks,
  skydiveBonusBlocks,
  slideBonusBlocks,
  activeMagnetBlocks,
  cloudObjects,
  incMagnetDockStep
} from './world.js';
import {
  puffCloudPool,
  speedStepRingPool,
  shockwavePool,
  projectilePool,
  thunderProjectilePool,
  drainBlockPool,
  lightningPillarPool,
  triggerLandingShockwave
} from './particles.js';
import {
  scatterBricks
} from './systems.js';

/**
 * シーン内の飛翔体、エフェクト、雲、アイテム演出を一括更新
 * @param {THREE.Scene} scene 
 * @param {number} dt 
 * @param {number} timeSec 
 * @param {Object} player 
 * @param {Object} sound 
 */
export function updateSceneEntities(scene, dt, timeSec, player, sound) {
  const playerZ = player ? player.pos.z : 0;

  // 1. 床置きアイテムの自転・浮遊アニメーション（★ 前後40m以内の視界内のみ計算）
  for (let i = 0; i < floorItems.length; i++) {
    const item = floorItems[i];
    if (item.active && item.group) {
      if (Math.abs(item.pos.z - playerZ) > 40) continue;
      if (item.crystal) {
        item.crystal.rotation.y = timeSec * 3.2;
        item.crystal.rotation.z = Math.sin(timeSec * 2.5) * 0.25;
        if (item.type !== 'magnet') {
          item.crystal.position.y = 1.35 + Math.sin(timeSec * 4.5 + item.stageIdx) * 0.35;
        } else {
          item.crystal.position.y = 1.15 + Math.sin(timeSec * 4.5 + item.stageIdx) * 0.35;
        }
      }
      if (item.beaconRing) {
        const pulse = 1.0 + Math.sin(timeSec * 5.0) * 0.25;
        item.beaconRing.scale.set(pulse, pulse, pulse);
      }
    }
  }

  // 2. ホーミングクリスタル弾の追従・着弾更新
  for (let i = 0; i < projectilePool.length; i++) {
    const p = projectilePool[i];
    if (!p.active) continue;

    p.progress += dt / p.duration;

    if (p.target) {
      p.targetPos.copy(p.target.pos);
      p.targetPos.y += 1.0;

      if (p.reticle) {
        p.reticle.position.set(p.target.pos.x, p.target.pos.y + 0.08, p.target.pos.z);
        const pulseScale = 1.0 + Math.sin(timeSec * 22) * 0.25;
        p.reticle.scale.set(pulseScale, pulseScale, pulseScale);
      }
    }

    const t = Math.min(1.0, p.progress);
    _tempVec3A.lerpVectors(p.startPos, p.targetPos, t);
    _tempVec3A.y += Math.sin(t * Math.PI) * 8.5;
    p.group.position.copy(_tempVec3A);

    if (p.crystal) {
      p.crystal.rotation.x += dt * 24;
      p.crystal.rotation.y += dt * 32;
    }
    if (p.ring1) p.ring1.rotation.z += dt * 18;
    if (p.ring2) p.ring2.rotation.y += dt * 22;

    if (p.history && p.history.length > 0) {
      const recycledVec = p.history.pop();
      recycledVec.copy(_tempVec3A);
      p.history.unshift(recycledVec);
    }

    if (p.trailSpheres) {
      for (let j = 0; j < p.trailSpheres.length; j++) {
        const item = p.trailSpheres[j];
        const histIdx = Math.min(p.history.length - 1, item.historyOffset);
        if (p.history[histIdx]) {
          item.mesh.position.copy(p.history[histIdx]);
          item.mesh.visible = true;
          const lifeFade = 1.0 - (j / p.trailSpheres.length);
          item.material.opacity = (1.0 - t * 0.15) * lifeFade * 0.95;
        }
      }
    }

    if (p.progress >= 1.0) {
      if (sound) sound.playAttackHit();

      triggerLandingShockwave(p.targetPos.x, p.targetPos.y - 0.8, p.targetPos.z, 4.5, 0xf43f5e);

      if (p.reticle) p.reticle.visible = false;

      if (p.target) {
        p.target.stunTimer = 1.4;
        p.target.meshObj.root.rotation.x = 0.55;
        scatterBricks(scene, p.target, 3);

        const drainCount = 4;
        let spawned = 0;
        for (let d = 0; d < drainBlockPool.length && spawned < drainCount; d++) {
          const db = drainBlockPool[d];
          if (!db.active) {
            db.active = true;
            db.targetChar = p.shooter;
            db.index = spawned;
            db.delay = spawned * 0.08;
            db.progress = 0;
            db.duration = 0.80;

            if (p.shooter && p.shooter.team && p.shooter.team.id === 'blue') {
              db.mesh.material = sharedMats.blockBlue;
            } else if (p.shooter && p.shooter.team && p.shooter.team.id === 'red') {
              db.mesh.material = sharedMats.blockRed;
            } else if (p.shooter && p.shooter.team && p.shooter.team.id === 'yellow') {
              db.mesh.material = sharedMats.blockYellow;
            } else {
              db.mesh.material = sharedMats.blockNeutral;
            }

            const sOffset = _tempVec3B.set(
              (Math.random() - 0.5) * 1.2,
              1.2 + Math.random() * 0.8,
              (Math.random() - 0.5) * 1.2
            );
            db.startPos.copy(p.target.pos).add(sOffset);
            db.mesh.position.copy(db.startPos);
            db.mesh.scale.set(1.3, 1.3, 1.3);
            db.mesh.visible = true;
            spawned++;
          }
        }
      }

      p.active = false;
      p.group.visible = false;
      if (p.trailSpheres) {
        for (let j = 0; j < p.trailSpheres.length; j++) {
          p.trailSpheres[j].mesh.visible = false;
        }
      }
    }
  }

  // 3. サンダー弾頭の追従・落雷エフェクト更新
  for (let i = 0; i < thunderProjectilePool.length; i++) {
    const tp = thunderProjectilePool[i];
    if (!tp.active) continue;

    tp.progress += dt / tp.duration;

    if (tp.target) {
      tp.targetPos.copy(tp.target.pos);
      tp.targetPos.y += 1.0;

      if (tp.reticle) {
        tp.reticle.position.set(tp.target.pos.x, tp.target.pos.y + 0.08, tp.target.pos.z);
        const pulseScale = 1.0 + Math.sin(timeSec * 22) * 0.25;
        tp.reticle.scale.set(pulseScale, pulseScale, pulseScale);
      }
    }

    const t = Math.min(1.0, tp.progress);
    _tempVec3A.lerpVectors(tp.startPos, tp.targetPos, t);
    _tempVec3A.y += Math.sin(t * Math.PI) * 8.5;
    tp.group.position.copy(_tempVec3A);

    if (tp.sphere) {
      tp.sphere.rotation.x += dt * 20;
      tp.sphere.rotation.y += dt * 28;
    }
    if (tp.ring1) tp.ring1.rotation.z += dt * 18;
    if (tp.ring2) tp.ring2.rotation.y += dt * 22;

    if (tp.history && tp.history.length > 0) {
      const recycledVec = tp.history.pop();
      recycledVec.copy(_tempVec3A);
      tp.history.unshift(recycledVec);
    }

    if (tp.trailSpheres) {
      for (let j = 0; j < tp.trailSpheres.length; j++) {
        const item = tp.trailSpheres[j];
        const histIdx = Math.min(tp.history.length - 1, item.historyOffset);
        if (tp.history[histIdx]) {
          item.mesh.position.copy(tp.history[histIdx]);
          item.mesh.visible = true;
          const lifeFade = 1.0 - (j / tp.trailSpheres.length);
          item.material.opacity = (1.0 - t * 0.15) * lifeFade * 0.95;
        }
      }
    }

    if (tp.progress >= 1.0) {
      if (sound) sound.playThunderStrike();

      triggerLandingShockwave(tp.targetPos.x, tp.targetPos.y - 0.8, tp.targetPos.z, 3.2, 0xfacc15);

      if (tp.reticle) tp.reticle.visible = false;

      let bolt = lightningPillarPool.find(p => !p.active);
      if (!bolt) bolt = lightningPillarPool[0];
      if (bolt) {
        bolt.active = true;
        bolt.life = 0;
        bolt.mesh.position.set(tp.targetPos.x, tp.targetPos.y + 13.0, tp.targetPos.z);
        bolt.mesh.material.opacity = 0.95;
        bolt.mesh.visible = true;
      }

      if (tp.target) {
        tp.target.shrinkTimer = 5.5;
        tp.target.stunTimer = 1.0;
        tp.target.meshObj.root.rotation.x = 0.45;
        scatterBricks(scene, tp.target, 2);

        const drainCount = 4;
        let spawned = 0;
        for (let d = 0; d < drainBlockPool.length && spawned < drainCount; d++) {
          const db = drainBlockPool[d];
          if (!db.active) {
            db.active = true;
            db.targetChar = tp.shooter;
            db.index = spawned;
            db.delay = spawned * 0.08;
            db.progress = 0;
            db.duration = 0.80;

            if (tp.shooter && tp.shooter.team && tp.shooter.team.id === 'blue') {
              db.mesh.material = sharedMats.blockBlue;
            } else if (tp.shooter && tp.shooter.team && tp.shooter.team.id === 'red') {
              db.mesh.material = sharedMats.blockRed;
            } else if (tp.shooter && tp.shooter.team && tp.shooter.team.id === 'yellow') {
              db.mesh.material = sharedMats.blockYellow;
            } else {
              db.mesh.material = sharedMats.blockNeutral;
            }

            const sOffset = _tempVec3B.set(
              (Math.random() - 0.5) * 1.2,
              1.2 + Math.random() * 0.8,
              (Math.random() - 0.5) * 1.2
            );
            db.startPos.copy(tp.target.pos).add(sOffset);
            db.mesh.position.copy(db.startPos);
            db.mesh.scale.set(1.3, 1.3, 1.3);
            db.mesh.visible = true;
            spawned++;
          }
        }
      }

      tp.active = false;
      tp.group.visible = false;
      if (tp.trailSpheres) {
        for (let j = 0; j < tp.trailSpheres.length; j++) {
          tp.trailSpheres[j].mesh.visible = false;
        }
      }
    }
  }

  // 4. 被弾ドレインブロックの吸引飛行更新
  for (let i = 0; i < drainBlockPool.length; i++) {
    const d = drainBlockPool[i];
    if (!d.active) continue;

    if (d.delay > 0) {
      d.delay -= dt;
      continue;
    }
    d.progress += dt / d.duration;
    const prog = Math.min(1.0, d.progress);

    _tempVec3A.copy(d.targetChar.pos);
    _tempVec3A.y += 1.4;
    _tempVec3A.z += 0.2;

    const easeT = prog * prog * (3 - 2 * prog);
    _tempVec3B.lerpVectors(d.startPos, _tempVec3A, easeT);
    _tempVec3B.y += Math.sin(prog * Math.PI) * 4.2;
    d.mesh.position.copy(_tempVec3B);

    const flightScale = 1.0 + Math.sin(prog * Math.PI) * 0.35;
    d.mesh.scale.set(flightScale, flightScale, flightScale);
    d.mesh.rotation.y += dt * 14;
    d.mesh.rotation.x += dt * 10;

    if (d.progress >= 1.0) {
      addBrickToCharacter(d.targetChar, d.targetChar.team, 1);
      if (d.targetChar.isPlayer) {
        if (sound) sound.playDrainCollect(d.index || 0);
        triggerLandingShockwave(_tempVec3A.x, _tempVec3A.y, _tempVec3A.z, 1.0, 0x0284c7);
      }
      d.active = false;
      d.mesh.visible = false;
    }
  }

  // 5. マグネット吸引ブロックの背中への誘導飛行更新
  for (let i = activeMagnetBlocks.length - 1; i >= 0; i--) {
    const mb = activeMagnetBlocks[i];
    const flightDuration = Math.max(mb.duration || 0.36, 0.55);
    mb.progress += dt / flightDuration;
    const prog = Math.min(1.0, mb.progress);

    _tempVec3A.copy(mb.targetChar.pos);
    const stackH = Math.min(mb.targetChar.stackCount * 0.22, 3.2);
    _tempVec3A.y += 0.85 + stackH;
    _tempVec3A.z -= 0.35;

    const easeT = prog * prog * (3 - 2 * prog);
    _tempVec3B.lerpVectors(mb.startPos, _tempVec3A, easeT);
    _tempVec3B.y += Math.sin(prog * Math.PI) * 3.2;
    mb.mesh.position.copy(_tempVec3B);

    const pulseScale = 1.0 + Math.sin(prog * Math.PI) * 0.28;
    mb.mesh.scale.set(pulseScale, pulseScale, pulseScale);
    mb.mesh.rotation.y += dt * 12;
    mb.mesh.rotation.x += dt * 9;

    if (mb.progress >= 1.0) {
      addBrickToCharacter(mb.targetChar, mb.targetChar.team, 1);
      if (mb.targetChar.isPlayer) {
        if (sound) sound.playMagnetDock(incMagnetDockStep());
        triggerLandingShockwave(_tempVec3A.x, _tempVec3A.y, _tempVec3A.z, 0.95, 0xa855f7);
      }
      mb.targetChar.dockBounceTimer = 0.085;
      mb.targetChar.meshObj.stackGroup.scale.set(1.10, 1.15, 1.10);

      if (mb.poolItem) {
        mb.poolItem.active = false;
        mb.poolItem.mesh.visible = false;
        mb.poolItem.attracting = false;
      }

      activeMagnetBlocks.splice(i, 1);
    }
  }

  // 6. ダッシュ足元パフ煙の減衰消去
  for (let i = 0; i < puffCloudPool.length; i++) {
    const puff = puffCloudPool[i];
    if (!puff.active) continue;
    puff.life += dt;
    const prog = puff.life / puff.maxLife;
    if (prog >= 1.0) {
      puff.active = false;
      puff.mesh.visible = false;
    } else {
      const currentScale = puff.initScale * (1.0 - prog * 0.85);
      puff.mesh.scale.set(currentScale, currentScale, currentScale);
      puff.mesh.position.y += dt * 0.45;
    }
  }

  // 7. ダッシュステップリングの拡大フェード消去
  for (let i = 0; i < speedStepRingPool.length; i++) {
    const sRing = speedStepRingPool[i];
    if (!sRing.active) continue;
    sRing.life += dt;
    const prog = sRing.life / sRing.maxLife;
    if (prog >= 1.0) {
      sRing.active = false;
      sRing.mesh.visible = false;
    } else {
      sRing.scale += dt * 3.4;
      sRing.mesh.scale.set(sRing.scale, sRing.scale, sRing.scale);
      sRing.mesh.material.opacity = (1.0 - prog) * 0.75;
    }
  }

  // 8. アトラクションボーナスブロックの自転・浮遊（★ 前後40m以内の視界内のみ計算）
  for (let i = 0; i < curvedSlideBonusBlocks.length; i++) {
    const blk = curvedSlideBonusBlocks[i];
    if (!blk.collected && blk.mesh) {
      if (Math.abs(blk.mesh.position.z - playerZ) > 40) continue;
      blk.mesh.rotation.y = timeSec * 2.8 + blk.t * 4.0;
    }
  }

  for (let i = 0; i < ziplineBonusBlocks.length; i++) {
    const blk = ziplineBonusBlocks[i];
    if (!blk.collected && blk.mesh) {
      if (Math.abs(blk.mesh.position.z - playerZ) > 40) continue;
      blk.mesh.rotation.y = timeSec * 3.2 + blk.t * 4.5;
      blk.mesh.position.y = blk.baseY + Math.sin(timeSec * 3.5 + blk.zi) * 0.14;
    }
  }

  for (let i = 0; i < skydiveBonusBlocks.length; i++) {
    const blk = skydiveBonusBlocks[i];
    if (!blk.collected && blk.mesh) {
      if (Math.abs(blk.mesh.position.z - playerZ) > 40) continue;
      blk.mesh.rotation.y = timeSec * 3.2 + blk.t * 4.0;
      blk.mesh.position.y = blk.baseY + Math.sin(timeSec * 3.0 + blk.si) * 0.12;
    }
  }

  for (let i = 0; i < slideBonusBlocks.length; i++) {
    const blk = slideBonusBlocks[i];
    if (!blk.collected && blk.mesh) {
      if (Math.abs(blk.mesh.position.z - playerZ) > 40) continue;
      blk.mesh.rotation.y = timeSec * 2.8 + blk.prog * 3.0;
    }
  }

  // 9. 浮遊雲のふわふわ揺れ（★ 前後55m以内の視界内のみ計算）
  for (let i = 0; i < cloudObjects.length; i++) {
    const c = cloudObjects[i];
    if (Math.abs(c.mesh.position.z - playerZ) > 55) continue;
    c.mesh.position.y = c.baseY + Math.sin(timeSec + c.offset) * 0.4;
    c.mesh.rotation.y = Math.sin(timeSec * 0.3 + c.offset) * 0.08;
  }

  // 10. 着地・被弾衝撃波の拡大消散
  for (let i = 0; i < shockwavePool.length; i++) {
    const sw = shockwavePool[i];
    if (!sw.active) continue;
    sw.life += dt;
    const growRate = (sw.targetRadiusScale || 1.0) * 6.5;
    sw.scale += dt * growRate;
    sw.mesh.scale.set(sw.scale, sw.scale, sw.scale);
    sw.mesh.material.opacity = Math.max(0, 0.9 - sw.life * 2.2);
    if (sw.life > 0.45) {
      sw.active = false;
      sw.mesh.visible = false;
    }
  }

  // 11. 雷の柱エフェクトのフェード消去
  for (let i = 0; i < lightningPillarPool.length; i++) {
    const bolt = lightningPillarPool[i];
    if (!bolt.active) continue;
    bolt.life += dt;
    if (bolt.life > bolt.maxLife) {
      bolt.active = false;
      bolt.mesh.visible = false;
    } else {
      bolt.mesh.material.opacity = 0.95 * (1.0 - (bolt.life / bolt.maxLife));
    }
  }
}