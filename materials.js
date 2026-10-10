// 描画リソース・共有マテリアル・ジオメトリ・キャッシュ・破棄管理
import { TEAMS, MAX_VISUAL_STACK } from './constants.js';

export const COLOR_NEUTRAL_PLANK = new THREE.Color(0xd1d5db);
export const COLOR_BLUE_PLANK = new THREE.Color(TEAMS.BLUE.hex);
export const COLOR_RED_PLANK = new THREE.Color(TEAMS.RED.hex);
export const COLOR_YELLOW_PLANK = new THREE.Color(TEAMS.YELLOW.hex);

// 共有ジオメトリ
export const blockGeometry = new THREE.BoxGeometry(0.95, 0.36, 0.60);
export const plankGeo = new THREE.BoxGeometry(3.6, 0.65, 1.6);
export const verticalPlankGeo = new THREE.BoxGeometry(3.6, 1.25, 1.8);
export const islandGeo = new THREE.CylinderGeometry(1, 1, 0.5, 36);

export const itemCrystalGeo = new THREE.OctahedronGeometry(0.68, 0);
export const itemBeaconRingGeo = new THREE.RingGeometry(0.55, 0.95, 32);
itemBeaconRingGeo.rotateX(-Math.PI / 2);

export const speedStepRingGeo = new THREE.RingGeometry(0.35, 0.68, 24);
speedStepRingGeo.rotateX(-Math.PI / 2);
export const puffCloudGeo = new THREE.SphereGeometry(0.24, 8, 8);
export const attackTrailSphereGeo = new THREE.SphereGeometry(0.32, 8, 8);
export const attackRingGeo = new THREE.TorusGeometry(0.72, 0.08, 8, 24);

export const baseShockwaveGeo = new THREE.RingGeometry(0.3, 0.65, 32);
baseShockwaveGeo.rotateX(-Math.PI / 2);

// 計算用共通一時ベクトル（Zero-Allocation）
export const _tempVec3A = new THREE.Vector3();
export const _tempVec3B = new THREE.Vector3();
export const _tempVec3C = new THREE.Vector3();
export const _tempVec3D = new THREE.Vector3();
export const _tempAvoidResult = { x: 0, z: 0 };

export function createSeaTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 512;
  cvs.height = 512;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 3.5;
  for (let x = 0; x < 512; x += 64) {
    ctx.beginPath();
    for (let y = 0; y <= 512; y += 32) {
      const offsetX = Math.sin((y + x) * 0.05) * 12;
      if (y === 0) ctx.moveTo(x + offsetX, y);
      else ctx.lineTo(x + offsetX, y);
    }
    ctx.stroke();
  }
  for (let y = 0; y < 512; y += 64) {
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 32) {
      const offsetY = Math.cos((x + y) * 0.05) * 12;
      if (y === 0) ctx.moveTo(x, y + offsetY);
      else ctx.lineTo(x, y + offsetY);
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(48, 48);
  return tex;
}

export const seaTexture = createSeaTexture();

// 共有マテリアル
export const sharedMats = {
  island: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }),
  islandBorder: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.3 }),
  anchorWire: new THREE.MeshBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.35, depthWrite: false }),
  cloud: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.90, depthWrite: false }),
  sea: new THREE.MeshStandardMaterial({
    map: seaTexture,
    color: 0x38bdf8,
    roughness: 0.1,
    metalness: 0.05
  }),
  oceanSand: new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.85 }),
  oceanGrass: new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.6 }),
  oceanRock: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.75 }),
  oceanPalmTrunk: new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 }),
  oceanPalmLeaf: new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.5 }),

  ghostPlank: new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.5,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  }),
  solidPlank: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.05
  }),

  neutralPlank: new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.7 }),
  slideSurface: new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.08, metalness: 0.15, emissive: 0x0284c7, emissiveIntensity: 0.2, side: THREE.DoubleSide }),
  slideRail: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.3 }),
  gateFrame: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.2 }),
  bluePlank: new THREE.MeshStandardMaterial({ color: TEAMS.BLUE.hex, emissive: TEAMS.BLUE.emissive, emissiveIntensity: 0.15, roughness: 0.3 }),
  redPlank: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, emissive: TEAMS.RED.emissive, emissiveIntensity: 0.15, roughness: 0.3 }),
  yellowPlank: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, emissive: TEAMS.YELLOW.emissive, emissiveIntensity: 0.15, roughness: 0.3 }),

  blockBlue: new THREE.MeshStandardMaterial({ color: 0x2563eb, emissive: 0x1d4ed8, emissiveIntensity: 0.2, roughness: 0.35, metalness: 0.05 }),
  blockRed: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, emissive: TEAMS.RED.emissive, emissiveIntensity: 0.2, roughness: 0.35 }),
  blockYellow: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, emissive: TEAMS.YELLOW.emissive, emissiveIntensity: 0.2, roughness: 0.35 }),
  blockNeutral: new THREE.MeshStandardMaterial({ color: TEAMS.NEUTRAL.hex, emissive: TEAMS.NEUTRAL.emissive, emissiveIntensity: 0.2, roughness: 0.35 }),

  charBlue: new THREE.MeshStandardMaterial({ color: TEAMS.BLUE.hex, roughness: 0.25, metalness: 0.05 }),
  charRed: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, roughness: 0.25, metalness: 0.05 }),
  charYellow: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, roughness: 0.25, metalness: 0.05 }),

  ziplinePylonPost: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.05 }),
  ziplinePylonTrim: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.25, metalness: 0.15 }),
  ziplineCable: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xf1f5f9,
    emissiveIntensity: 0.35,
    roughness: 0.32,
    metalness: 0.12
  }),
  ziplineTrolley: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.2, metalness: 0.5 }),

  landingShockwave: new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  }),

  itemCrystal: new THREE.MeshStandardMaterial({
    color: 0xfde047,
    emissive: 0xeab308,
    emissiveIntensity: 0.55,
    roughness: 0.1,
    metalness: 0.15
  }),
  itemBeaconRing: new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false
  }),

  itemAttackCrystal: new THREE.MeshStandardMaterial({
    color: 0xf43f5e,
    emissive: 0xd946ef,
    emissiveIntensity: 0.85,
    roughness: 0.05,
    metalness: 0.2
  }),
  itemAttackBeaconRing: new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  attackRingMat: new THREE.MeshBasicMaterial({
    color: 0xf472b6,
    transparent: true,
    opacity: 0.90,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  attackTrailMat: new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  }),
  attackBlastRing: new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  drainBlockMat: new THREE.MeshStandardMaterial({
    color: 0xf472b6,
    emissive: 0xd946ef,
    emissiveIntensity: 0.85,
    roughness: 0.1
  }),

  speedStepRing: new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  puffCloud: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.15,
    transparent: true,
    opacity: 0.88,
    depthWrite: false
  }),

  itemMagnetCrystal: new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x059669,
    emissiveIntensity: 0.85,
    roughness: 0.1,
    metalness: 0.15
  }),
  itemMagnetBeaconRing: new THREE.MeshBasicMaterial({
    color: 0x34d399,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  magnetInwardRing: new THREE.MeshBasicMaterial({
    color: 0x34d399,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false
  })
};

export const playerStackMaterials = [];
for (let i = 0; i < MAX_VISUAL_STACK; i++) {
  playerStackMaterials.push(new THREE.MeshStandardMaterial({
    roughness: 0.3,
    metalness: 0.1
  }));
}

export function updatePlayerStackMaterials(stackCount) {
  const bColor = new THREE.Color();
  const tColor = new THREE.Color();
  const emColor = new THREE.Color();
  let emIntensity = 0.2;
  let rough = 0.3;
  let metal = 0.1;

  if (stackCount < 30) {
    bColor.setHex(0x2563eb);
    tColor.setHex(0x60a5fa);
    emColor.setHex(0x1d4ed8);
    emIntensity = 0.15;
    rough = 0.35;
    metal = 0.05;
  } else if (stackCount < 60) {
    bColor.setHex(0x0284c7);
    tColor.setHex(0x38bdf8);
    emColor.setHex(0x0369a1);
    emIntensity = 0.20;
    rough = 0.25;
    metal = 0.10;
  } else {
    bColor.setHex(0x0ea5e9);
    tColor.setHex(0xa5f3fc);
    emColor.setHex(0x38bdf8);
    emIntensity = 0.25;
    rough = 0.15;
    metal = 0.15;
  }

  for (let i = 0; i < MAX_VISUAL_STACK; i++) {
    const t = i / (MAX_VISUAL_STACK - 1);
    const mat = playerStackMaterials[i];
    mat.color.copy(bColor).lerp(tColor, t);
    mat.emissive.copy(emColor);
    mat.emissiveIntensity = emIntensity;
    mat.roughness = rough;
    mat.metalness = metal;
  }
}
updatePlayerStackMaterials(0);

export const sharedMaterialsSet = new Set();
Object.values(sharedMats).forEach(mat => sharedMaterialsSet.add(mat));
playerStackMaterials.forEach(mat => sharedMaterialsSet.add(mat));

export const sharedGeometriesSet = new Set([
  blockGeometry,
  plankGeo,
  verticalPlankGeo,
  islandGeo,
  itemCrystalGeo,
  itemBeaconRingGeo,
  speedStepRingGeo,
  puffCloudGeo,
  attackTrailSphereGeo,
  attackRingGeo,
  baseShockwaveGeo
]);

export const gateTextureCache = new Map();
export const gateMaterialsCache = new Map();

export function getOrCreateGateTexture(label, isPositive) {
  const cacheKey = `${label}_${isPositive}`;
  if (gateTextureCache.has(cacheKey)) {
    return gateTextureCache.get(cacheKey);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isPositive ? 'rgba(16, 185, 129, 0.78)' : 'rgba(239, 68, 68, 0.78)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 10;

  const r = 24, w = 236, h = 236, x = 10, y = 10;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y + r, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 128, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  gateTextureCache.set(cacheKey, texture);
  return texture;
}

export function getOrCreateGateMaterials(label, isPositive) {
  const cacheKey = `${label}_${isPositive}`;
  if (gateMaterialsCache.has(cacheKey)) {
    return gateMaterialsCache.get(cacheKey);
  }

  const panelTex = getOrCreateGateTexture(label, isPositive);
  const edgeColor = isPositive ? 0x10b981 : 0xef4444;
  const edgeMat = new THREE.MeshStandardMaterial({
    color: edgeColor,
    roughness: 0.15,
    metalness: 0.1
  });
  const faceMat = new THREE.MeshBasicMaterial({
    map: panelTex,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  });

  sharedMaterialsSet.add(edgeMat);
  sharedMaterialsSet.add(faceMat);

  const materials = [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, faceMat];
  gateMaterialsCache.set(cacheKey, materials);
  return materials;
}

export function disposeMaterial(mat) {
  if (!mat || sharedMaterialsSet.has(mat)) return;
  if (mat.map && mat.map !== seaTexture) {
    mat.map.dispose();
  }
  mat.dispose();
}

export function disposeHierarchy(node) {
  if (!node) return;
  node.traverse(child => {
    if (child.isMesh) {
      if (child.geometry && !sharedGeometriesSet.has(child.geometry)) {
        child.geometry.dispose();
      }
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => disposeMaterial(mat));
        } else {
          disposeMaterial(child.material);
        }
      }
    }
  });
}