// パーティクル・エフェクト・飛翔体・床ブロックプール（視界を塞ぐ空中パーティクルノイズを完全撤廃・高初速着地インパクト・視認性を極限まで高めた攻撃エフェクト）
import {
  sharedMats,
  sharedMaterialsSet,
  puffCloudGeo,
  speedStepRingGeo,
  baseShockwaveGeo,
  itemCrystalGeo,
  attackRingGeo,
  attackTrailSphereGeo,
  blockGeometry
} from './materials.js';

export const PUFF_POOL_SIZE = 24;
export const RING_POOL_SIZE = 18;
export const SHOCKWAVE_POOL_SIZE = 16;
export const PROJECTILE_POOL_SIZE = 3;
export const NUM_TRAILS_PER_PROJ = 18; // トレイル球体数を増やして途切れのない滑らかな光の帯へ
export const DRAIN_POOL_SIZE = 8;
export const FLOOR_BLOCK_POOL_SIZE = 400;

export const puffCloudPool = [];
export const speedStepRingPool = [];
export const shockwavePool = [];
export const projectilePool = [];
export const drainBlockPool = [];
export const floorBlockPool = [];

// 既存コードとの後方互換用（空配列として安全に保持し、描画負荷と視覚ノイズをゼロ化）
export const windStreakPool = [];
export const draftRingPool = [];

export function triggerLandingShockwave(x, y, z, customRadius = 1.5, customColorHex = null) {
  let sw = shockwavePool.find(item => !item.active);
  if (!sw) {
    sw = shockwavePool[0];
    let maxLife = sw.life;
    for (let i = 1; i < shockwavePool.length; i++) {
      if (shockwavePool[i].life > maxLife) {
        maxLife = shockwavePool[i].life;
        sw = shockwavePool[i];
      }
    }
  }

  sw.active = true;
  sw.life = 0;
  sw.scale = 0.8;
  // 時速80〜100km超からの着地に対応した力強い拡大幅
  sw.targetRadiusScale = Math.max(1.0, customRadius / 1.4);
  sw.mesh.position.set(x, y + 0.08, z);
  sw.mesh.scale.set(0.8, 0.8, 0.8);
  sw.mesh.material.opacity = 0.95;
  sw.mesh.material.color.setHex(customColorHex || 0x0284c7);
  sw.mesh.visible = true;
}

export function initParticlePools(scene) {
  if (puffCloudPool.length === 0) {
    for (let i = 0; i < PUFF_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(puffCloudGeo, sharedMats.puffCloud);
      mesh.visible = false;
      scene.add(mesh);
      puffCloudPool.push({
        mesh: mesh,
        active: false,
        life: 0,
        maxLife: 0.34,
        initScale: 1.0
      });
    }
  }

  if (speedStepRingPool.length === 0) {
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const ringMat = sharedMats.speedStepRing.clone();
      sharedMaterialsSet.add(ringMat);
      const mesh = new THREE.Mesh(speedStepRingGeo, ringMat);
      mesh.visible = false;
      scene.add(mesh);
      speedStepRingPool.push({
        mesh: mesh,
        active: false,
        scale: 0.6,
        life: 0,
        maxLife: 0.35
      });
    }
  }

  if (shockwavePool.length === 0) {
    for (let i = 0; i < SHOCKWAVE_POOL_SIZE; i++) {
      const swMat = sharedMats.landingShockwave.clone();
      sharedMaterialsSet.add(swMat);
      const mesh = new THREE.Mesh(baseShockwaveGeo, swMat);
      mesh.visible = false;
      scene.add(mesh);
      shockwavePool.push({
        mesh: mesh,
        active: false,
        scale: 1.0,
        life: 0,
        targetRadiusScale: 1.0
      });
    }
  }

  if (projectilePool.length === 0) {
    for (let pIdx = 0; pIdx < PROJECTILE_POOL_SIZE; pIdx++) {
      const projGroup = new THREE.Group();
      projGroup.visible = false;

      // 飛翔クリスタル本体を 1.6 倍に拡大して遠距離でも明確に視認可能に
      const crystalMesh = new THREE.Mesh(itemCrystalGeo, sharedMats.itemAttackCrystal);
      crystalMesh.scale.set(1.65, 1.65, 1.65);
      crystalMesh.castShadow = true;
      projGroup.add(crystalMesh);

      const ring1 = new THREE.Mesh(attackRingGeo, sharedMats.attackRingMat);
      ring1.scale.set(1.25, 1.25, 1.25);
      projGroup.add(ring1);
      const ring2 = new THREE.Mesh(attackRingGeo, sharedMats.attackRingMat);
      ring2.scale.set(1.25, 1.25, 1.25);
      ring2.rotation.x = Math.PI / 2;
      projGroup.add(ring2);

      scene.add(projGroup);

      const trailSpheres = [];
      for (let i = 0; i < NUM_TRAILS_PER_PROJ; i++) {
        const tMat = sharedMats.attackTrailMat.clone();
        sharedMaterialsSet.add(tMat);
        const tMesh = new THREE.Mesh(attackTrailSphereGeo, tMat);
        tMesh.visible = false;
        // 太く鮮やかな彗星のようなフェードアウトスケール
        const s = Math.max(0.28, (1.0 - (i / NUM_TRAILS_PER_PROJ)) * 1.35);
        tMesh.scale.set(s, s, s);
        scene.add(tMesh);
        trailSpheres.push({
          mesh: tMesh,
          material: tMat,
          historyOffset: i + 1
        });
      }

      const history = [];
      for (let h = 0; h < 26; h++) {
        history.push(new THREE.Vector3());
      }

      projectilePool.push({
        group: projGroup,
        crystal: crystalMesh,
        ring1: ring1,
        ring2: ring2,
        trailSpheres: trailSpheres,
        history: history,
        startPos: new THREE.Vector3(),
        targetPos: new THREE.Vector3(),
        shooter: null,
        target: null,
        isRear: false,
        progress: 0,
        duration: 1.35,
        active: false
      });
    }
  }

  if (drainBlockPool.length === 0) {
    for (let d = 0; d < DRAIN_POOL_SIZE; d++) {
      const drainMesh = new THREE.Mesh(blockGeometry, sharedMats.blockBlue);
      drainMesh.scale.set(1.15, 1.15, 1.15);
      drainMesh.visible = false;
      scene.add(drainMesh);
      drainBlockPool.push({
        mesh: drainMesh,
        startPos: new THREE.Vector3(),
        targetChar: null,
        index: 0,
        delay: 0,
        progress: 0,
        duration: 0.85,
        active: false
      });
    }
  }

  if (floorBlockPool.length === 0) {
    for (let i = 0; i < FLOOR_BLOCK_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(blockGeometry, sharedMats.blockNeutral);
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      floorBlockPool.push({
        mesh: mesh,
        active: false,
        team: null,
        pos: mesh.position,
        stageIdx: -1,
        attracting: false
      });
    }
  }
}

export function resetParticlePools() {
  for (let i = 0; i < puffCloudPool.length; i++) {
    puffCloudPool[i].active = false;
    puffCloudPool[i].mesh.visible = false;
  }
  for (let i = 0; i < speedStepRingPool.length; i++) {
    speedStepRingPool[i].active = false;
    speedStepRingPool[i].mesh.visible = false;
  }
  for (let i = 0; i < shockwavePool.length; i++) {
    shockwavePool[i].active = false;
    shockwavePool[i].mesh.visible = false;
  }
  for (let i = 0; i < projectilePool.length; i++) {
    const p = projectilePool[i];
    p.active = false;
    p.group.visible = false;
    for (let j = 0; j < p.trailSpheres.length; j++) {
      p.trailSpheres[j].mesh.visible = false;
    }
  }
  for (let i = 0; i < drainBlockPool.length; i++) {
    const d = drainBlockPool[i];
    d.active = false;
    d.mesh.visible = false;
    d.mesh.scale.set(1.0, 1.0, 1.0);
  }
  for (let i = 0; i < floorBlockPool.length; i++) {
    floorBlockPool[i].active = false;
    floorBlockPool[i].mesh.visible = false;
    floorBlockPool[i].attracting = false;
  }
}

// 落下中・滑空中にキャラにまとわりつく白煙・気圧リングノイズを完全撤去（視界100%クリア化）
export function spawnSkydiveStream(charX, charY, charZ, rollAngle = 0) {
  // 意図的に no-op とし、画面を遮るラインノイズを排除
}

export function spawnTrapdoorDraftRing(charX, charY, charZ) {
  // 意図的に no-op とし、画面中央のリングノイズを排除
}

export function spawnWindStreak(charX, charY, charZ, rollAngle = 0) {
  // 意図的に no-op とし、画面の視覚的ゴミを一掃
}

export function spawnPuffCloud(x, y, z) {
  let puff = puffCloudPool.find(p => !p.active);
  if (!puff) {
    puff = puffCloudPool[0];
    let maxProg = puff.life / puff.maxLife;
    for (let i = 1; i < puffCloudPool.length; i++) {
      const prog = puffCloudPool[i].life / puffCloudPool[i].maxLife;
      if (prog > maxProg) {
        maxProg = prog;
        puff = puffCloudPool[i];
      }
    }
  }

  const baseScale = 0.8 + Math.random() * 0.4;
  puff.active = true;
  puff.life = 0;
  puff.maxLife = 0.34;
  puff.initScale = baseScale;
  puff.mesh.position.set(x + (Math.random() - 0.5) * 0.35, y + 0.12, z + (Math.random() - 0.5) * 0.2);
  puff.mesh.scale.set(baseScale, baseScale, baseScale);
  puff.mesh.visible = true;
}

export function spawnSpeedStepRing(x, y, z) {
  let ring = speedStepRingPool.find(r => !r.active);
  if (!ring) {
    ring = speedStepRingPool[0];
    let maxProg = ring.life / ring.maxLife;
    for (let i = 1; i < speedStepRingPool.length; i++) {
      const prog = speedStepRingPool[i].life / speedStepRingPool[i].maxLife;
      if (prog > maxProg) {
        maxProg = prog;
        ring = speedStepRingPool[i];
      }
    }
  }

  ring.active = true;
  ring.life = 0;
  ring.scale = 0.6;
  ring.maxLife = 0.35;
  ring.mesh.position.set(x, y + 0.05, z);
  ring.mesh.scale.set(0.6, 0.6, 0.6);
  ring.mesh.material.opacity = 0.75;
  ring.mesh.visible = true;
}