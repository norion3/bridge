// 描画リソース・共有マテリアル・ジオメトリ・キャッシュ・破棄管理
import {
  TEAMS,
  MAX_VISUAL_STACK,
  ELEVATOR_CONFIG,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG,
  FREEFALL_CONFIG,
  ITEM_COLORS
} from './constants.js';

export const COLOR_NEUTRAL_PLANK = new THREE.Color(0xd1d5db);
export const COLOR_BLUE_PLANK = new THREE.Color(TEAMS.BLUE.hex);
export const COLOR_RED_PLANK = new THREE.Color(TEAMS.RED.hex);
export const COLOR_YELLOW_PLANK = new THREE.Color(TEAMS.YELLOW.hex);

// 共有ジオメトリ
export const blockGeometry = new THREE.BoxGeometry(0.95, 0.36, 0.60);
export const plankGeo = new THREE.BoxGeometry(3.6, 0.65, 1.6);
export const verticalPlankGeo = new THREE.BoxGeometry(3.6, 1.25, 1.8);
export const islandGeo = new THREE.CylinderGeometry(1, 1, 0.5, 36);

// アイテム形状ジオメトリ
export const itemCrystalGeo = new THREE.OctahedronGeometry(0.68, 0);       
export const itemSpeedGeo = new THREE.TetrahedronGeometry(0.75, 1);        
export const itemMagnetGeo = new THREE.DodecahedronGeometry(0.72, 0);      

export const itemBeaconRingGeo = new THREE.RingGeometry(0.55, 0.95, 32);
itemBeaconRingGeo.rotateX(-Math.PI / 2);

export const speedStepRingGeo = new THREE.RingGeometry(0.35, 0.68, 24);
speedStepRingGeo.rotateX(-Math.PI / 2);
export const puffCloudGeo = new THREE.SphereGeometry(0.24, 8, 8);
export const attackTrailSphereGeo = new THREE.SphereGeometry(0.32, 8, 8);
export const attackRingGeo = new THREE.TorusGeometry(0.72, 0.08, 8, 24);

export const baseShockwaveGeo = new THREE.RingGeometry(0.3, 0.65, 32);
baseShockwaveGeo.rotateX(-Math.PI / 2);

// エレベーター展望リフト用ジオメトリ（邪魔なワイヤー類を完全撤去しホバーリフトへ）
export const elevatorPlatformFloorGeo = new THREE.BoxGeometry(2.4, 0.16, 2.0);
export const elevatorHandrailPostGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8);
export const elevatorHandrailBarGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8);

// スカイダイブ（頭先行）用ジオメトリ
export const catapultRampGeo = new THREE.BoxGeometry(3.6, 0.28, 5.2);
export const catapultTrimGeo = new THREE.CylinderGeometry(0.065, 0.065, 5.2, 8);
catapultTrimGeo.rotateX(Math.PI / 2);

// ドロップタワー・スカイゲート用ジオメトリ
export const dropDeckGeo = new THREE.CylinderGeometry(2.8, 2.8, 0.18, 32);         
export const dropPylonGeo = new THREE.BoxGeometry(0.35, 7.5, 0.35);                
export const dropIndicatorGeo = new THREE.BoxGeometry(0.12, 6.2, 0.12);            
export const gatePedestalGeo = new THREE.CylinderGeometry(0.32, 0.42, 0.35, 16);  

// トラップドア（足先行）ハッチ用ジオメトリ（後方互換用）
export const hatchFrameGeo = new THREE.BoxGeometry(3.6, 0.22, 3.6);
export const hatchDoorGeo = new THREE.BoxGeometry(1.65, 0.14, 3.3);
export const windStreakGeo = new THREE.CylinderGeometry(0.025, 0.025, 2.8, 6);

// 計算用共通一時ベクトル（Zero-Allocation）
export const _tempVec3A = new THREE.Vector3();
export const _tempVec3B = new THREE.Vector3();
export const _tempVec3C = new THREE.Vector3();
export const _tempVec3D = new THREE.Vector3();
export const _tempAvoidResult = { x: 0, z: 0 };

// 斜めグラデーションによるタイリング境界（つぎはぎ線）を完全消滅させるシームレス波光キャンバス
export function createSeaTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 512;
  cvs.height = 512;
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, 512, 512);

  const radialGrad = ctx.createRadialGradient(256, 256, 30, 256, 256, 256);
  radialGrad.addColorStop(0, '#0369a1');
  radialGrad.addColorStop(0.85, '#0284c7');
  radialGrad.addColorStop(1, '#0284c7');
  ctx.fillStyle = radialGrad;
  ctx.fillRect(0, 0, 512, 512);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 28; i++) {
    const cx = (i * 128 + 64) % 512;
    const cy = (i * 182 + 64) % 512;
    const r = 24 + ((i * 17) % 32);
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.1; a += Math.PI / 4) {
      const dist = r + Math.sin(a * 3 + i) * 5;
      const px = cx + Math.cos(a) * dist;
      const py = cy + Math.sin(a) * dist;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16); 
  return tex;
}

export const seaTexture = createSeaTexture();

// 上品なサイバーブルーLEDフレームテクスチャ
export function createCyberFrameTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 128;
  cvs.height = 128;
  const ctx = cvs.getContext('2d');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = '#0066ff';
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 116, 116);

  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, 100, 100);

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

export const cyberFrameTexture = createCyberFrameTexture();
export const hazardTexture = cyberFrameTexture;

// 共有マテリアル
export const sharedMats = {
  island: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }),
  islandBorder: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.3 }),
  anchorWire: new THREE.MeshBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.35, depthWrite: false }),
  cloud: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, transparent: true, opacity: 0.90, depthWrite: false }),
  sea: new THREE.MeshStandardMaterial({
    map: seaTexture,
    color: 0x38bdf8,
    roughness: 0.08,
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
  slideSurface: new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    roughness: 0.12,
    metalness: 0.25,
    emissive: 0x0369a1,
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide
  }),
  slideRail: new THREE.MeshStandardMaterial({
    color: 0xf97316,
    roughness: 0.20,
    metalness: 0.40 
  }),
  gateFrame: new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.2 }),
  gatePedestal: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.3, metalness: 0.6 }),

  bluePlank: new THREE.MeshStandardMaterial({ color: TEAMS.BLUE.hex, emissive: TEAMS.BLUE.emissive, emissiveIntensity: 0.20, roughness: 0.28 }),
  redPlank: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, emissive: TEAMS.RED.emissive, emissiveIntensity: 0.15, roughness: 0.3 }),
  yellowPlank: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, emissive: TEAMS.YELLOW.emissive, emissiveIntensity: 0.15, roughness: 0.3 }),

  blockBlue: new THREE.MeshStandardMaterial({ color: TEAMS.BLUE.hex, emissive: TEAMS.BLUE.emissive, emissiveIntensity: 0.25, roughness: 0.30, metalness: 0.05 }),
  blockRed: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, emissive: TEAMS.RED.emissive, emissiveIntensity: 0.2, roughness: 0.35 }),
  blockYellow: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, emissive: TEAMS.YELLOW.emissive, emissiveIntensity: 0.2, roughness: 0.35 }),
  blockNeutral: new THREE.MeshStandardMaterial({ color: TEAMS.NEUTRAL.hex, emissive: TEAMS.NEUTRAL.emissive, emissiveIntensity: 0.2, roughness: 0.35 }),

  // ★ キャラクターのトイ・フィギュア化マテリアル
  charBlue: new THREE.MeshStandardMaterial({
    color: TEAMS.BLUE.hex,
    emissive: TEAMS.BLUE.emissive,
    emissiveIntensity: 0.15,
    roughness: 0.28,
    metalness: 0.12
  }),
  charRed: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, roughness: 0.3, metalness: 0.1 }),
  charYellow: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, roughness: 0.3, metalness: 0.1 }),
  
  // キャラの顔（バイザー）と手足のアクセント用マテリアル
  charVisor: new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1, metalness: 0.85 }),
  charAccent: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.05 }),

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
    color: ITEM_COLORS.SPEED.hex,
    emissive: ITEM_COLORS.SPEED.emissive,
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
    color: ITEM_COLORS.ATTACK.hex,
    emissive: ITEM_COLORS.ATTACK.emissive,
    emissiveIntensity: 0.85,
    roughness: 0.05,
    metalness: 0.2
  }),
  // ★ 起動不能バグの修正：`MeshBasicMaterial` -> `THREE.MeshBasicMaterial` に変更
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
    color: ITEM_COLORS.MAGNET.hex,
    emissive: ITEM_COLORS.MAGNET.emissive,
    emissiveIntensity: 1.25, 
    roughness: 0.04,
    metalness: 0.35
  }),
  itemMagnetBeaconRing: new THREE.MeshBasicMaterial({
    color: ITEM_COLORS.MAGNET.beaconHex,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false
  }),
  magnetInwardRing: new THREE.MeshBasicMaterial({
    color: ITEM_COLORS.MAGNET.beaconHex,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  }),

  elevatorDeckPlate: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.15 }),
  elevatorHandrailSteel: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.20, metalness: 0.75 }),
  elevatorFast: new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.70, roughness: 0.2 }),
  elevatorMid: new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xeab308, emissiveIntensity: 0.70, roughness: 0.2 }),
  elevatorSlow: new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xb91c1c, emissiveIntensity: 0.70, roughness: 0.2 }),

  catapultDeck: new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.18,
    metalness: 0.15
  }),
  catapultNeonRail: new THREE.MeshStandardMaterial({
    color: 0x0066ff,
    emissive: 0x1d4ed8,
    emissiveIntensity: 0.85,
    roughness: 0.10,
    metalness: 0.20
  }),
  skydiveSlipstream: new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.60,
    depthWrite: false
  }),

  dropGlassFloor: new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    emissive: 0x0369a1,
    emissiveIntensity: 0.25,
    roughness: 0.08,
    metalness: 0.30,
    transparent: true,
    opacity: 0.55 
  }),
  dropPylonSteel: new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.20,
    metalness: 0.85
  }),
  dropIndicatorNeon: new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 1.2
  }),

  hatchFrameBorder: new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    emissive: 0x0891b2,
    emissiveIntensity: 0.65,
    roughness: 0.2,
    metalness: 0.3
  }),
  hatchHazardWarning: new THREE.MeshStandardMaterial({
    map: cyberFrameTexture, 
    roughness: 0.25,
    metalness: 0.20
  }),
  hatchDoorSurface: new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0x0284c7,
    emissiveIntensity: 0.18,
    roughness: 0.20,
    metalness: 0.15
  }),
  hatchInnerVoid: new THREE.MeshBasicMaterial({
    color: 0x0284c7,
    transparent: true,
    opacity: 0.80
  }),
  windStreakMat: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.50, depthWrite: false })
};

export const playerStackMaterials = [];
for (let i = 0; i < MAX_VISUAL_STACK; i++) {
  playerStackMaterials.push(new THREE.MeshStandardMaterial({
    roughness: 0.28,
    metalness: 0.08
  }));
}

export function updatePlayerStackMaterials(stackCount) {
  const bColor = new THREE.Color();
  const tColor = new THREE.Color();
  const emColor = new THREE.Color();
  let emIntensity = 0.22;
  let rough = 0.28;
  let metal = 0.08;

  if (stackCount < 30) {
    bColor.setHex(0x0052cc); 
    tColor.setHex(0x0066ff); 
    emColor.setHex(0x1d4ed8);
    emIntensity = 0.20;
    rough = 0.30;
    metal = 0.05;
  } else if (stackCount < 80) {
    bColor.setHex(0x0066ff);
    tColor.setHex(0x0284c7); 
    emColor.setHex(0x0369a1);
    emIntensity = 0.24;
    rough = 0.25;
    metal = 0.10;
  } else {
    bColor.setHex(0x0052cc);
    tColor.setHex(0x0ea5e9);
    emColor.setHex(0x0284c7);
    emIntensity = 0.26;
    rough = 0.22;
    metal = 0.12;
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
  itemSpeedGeo,
  itemMagnetGeo,
  itemBeaconRingGeo,
  speedStepRingGeo,
  puffCloudGeo,
  attackTrailSphereGeo,
  attackRingGeo,
  baseShockwaveGeo,
  elevatorPlatformFloorGeo,
  elevatorHandrailPostGeo,
  elevatorHandrailBarGeo,
  catapultRampGeo,
  catapultTrimGeo,
  dropDeckGeo,
  dropPylonGeo,
  dropIndicatorGeo,
  gatePedestalGeo,
  hatchFrameGeo,
  hatchDoorGeo,
  windStreakGeo
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

  ctx.fillStyle = isPositive ? 'rgba(16, 185, 129, 0.94)' : 'rgba(239, 68, 68, 0.94)';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 14;

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

  ctx.shadowColor = 'rgba(0, 0, 0, 0.88)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 96px system-ui, -apple-system, sans-serif';
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
    opacity: 0.96,
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
  if (mat.map && mat.map !== seaTexture && mat.map !== cyberFrameTexture) {
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