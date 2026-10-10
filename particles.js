// パーティクル・エフェクト・飛翔体・ドレインブロックのオブジェクトプール
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
export const NUM_TRAILS_PER_PROJ = 14;
export const DRAIN_POOL_SIZE = 8;

export const puffCloudPool = [];
export const speedStepRingPool = [];
export const shockwavePool = [];
export const projectilePool = [];
export const drainBlockPool = [];

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
  sw.scale = 1.0;
  sw.targetRadiusScale = customRadius / 1.5;
  sw.mesh.position.set(x, y + 0.08, z);
  sw.mesh.scale.set(1.0, 1.0, 1.0);
  sw.mesh.material.opacity = 0.9;
  sw.mesh.material.color.setHex(customColorHex || 0x38bdf8);
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

      const crystalMesh = new THREE.Mesh(itemCrystalGeo, sharedMats.itemAttackCrystal);
      crystalMesh.scale.set(1.2, 1.2, 1.2);
      crystalMesh.castShadow = true;
      projGroup.add(crystalMesh);

      const ring1 = new THREE.Mesh(attackRingGeo, sharedMats.attackRingMat);
      projGroup.add(ring1);
      const ring2 = new THREE.Mesh(attackRingGeo, sharedMats.attackRingMat);
      ring2.rotation.x = Math.PI / 2;
      projGroup.add(ring2);

      scene.add(projGroup);

      const trailSpheres = [];
      for (let i = 0; i < NUM_TRAILS_PER_PROJ; i++) {
        const tMat = sharedMats.attackTrailMat.clone();
        sharedMaterialsSet.add(tMat);
        const tMesh = new THREE.Mesh(attackTrailSphereGeo, tMat);
        tMesh.visible = false;
        const s = Math.max(0.2, (1.0 - (i / NUM_TRAILS_PER_PROJ)) * 0.95);
        tMesh.scale.set(s, s, s);
        scene.add(tMesh);
        trailSpheres.push({
          mesh: tMesh,
          material: tMat,
          historyOffset: i + 1
        });
      }

      const history = [];
      for (let h = 0; h < 20; h++) {
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
        duration: 0.82,
        active: false
      });
    }
  }

  if (drainBlockPool.length === 0) {
    for (let d = 0; d < DRAIN_POOL_SIZE; d++) {
      const drainMesh = new THREE.Mesh(blockGeometry, sharedMats.drainBlockMat);
      drainMesh.scale.set(1.0, 1.0, 1.0);
      drainMesh.visible = false;
      scene.add(drainMesh);
      drainBlockPool.push({
        mesh: drainMesh,
        startPos: new THREE.Vector3(),
        targetChar: null,
        index: 0,
        delay: 0,
        progress: 0,
        duration: 0.75, // ★ 視認性向上のため飛行時間を 0.55s から 0.75s に延長
        active: false
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