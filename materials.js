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

// 共有基本ジオメトリ
export const blockGeometry = new THREE.BoxGeometry(0.95, 0.36, 0.60);
export const plankGeo = new THREE.BoxGeometry(3.6, 0.65, 1.6);
export const verticalPlankGeo = new THREE.BoxGeometry(3.6, 1.25, 1.8);
export const islandGeo = new THREE.CylinderGeometry(1, 1, 0.5, 36);

// アイテム形状ジオメトリ
export const itemCrystalGeo = new THREE.OctahedronGeometry(0.68, 0);       // アタック（八面体ダイヤ）
export const itemSpeedGeo = new THREE.TetrahedronGeometry(0.75, 1);        // スピード（四面体クリスタル）
export const itemMagnetGeo = new THREE.DodecahedronGeometry(0.72, 0);      // 磁石（12面体幾何学ジュエル）

export const itemBeaconRingGeo = new THREE.RingGeometry(0.55, 0.95, 32);
itemBeaconRingGeo.rotateX(-Math.PI / 2);

export const speedStepRingGeo = new THREE.RingGeometry(0.35, 0.68, 24);
speedStepRingGeo.rotateX(-Math.PI / 2);
export const puffCloudGeo = new THREE.SphereGeometry(0.24, 8, 8);
export const attackTrailSphereGeo = new THREE.SphereGeometry(0.32, 8, 8);
export const attackRingGeo = new THREE.TorusGeometry(0.72, 0.08, 8, 24);

export const baseShockwaveGeo = new THREE.RingGeometry(0.3, 0.65, 32);
baseShockwaveGeo.rotateX(-Math.PI / 2);

// エレベーター展望リフト用ジオメトリ
export const elevatorPlatformFloorGeo = new THREE.BoxGeometry(2.4, 0.16, 2.0);
export const elevatorHandrailPostGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8);
export const elevatorHandrailBarGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.3, 8);
export const elevatorCableWireGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.0, 8);

// スカイダイブ（ジェットカタパルト・ランウェイ）用ジオメトリ（スケール拡張 7.2m 対応）
export const catapultRampGeo = new THREE.BoxGeometry(3.8, 0.28, 7.2);
export const catapultTrimGeo = new THREE.CylinderGeometry(0.065, 0.065, 7.2, 8);
catapultTrimGeo.rotateX(Math.PI / 2);
export const catapultPipeRailGeo = new THREE.CylinderGeometry(0.12, 0.12, 7.2, 12);
catapultPipeRailGeo.rotateX(Math.PI / 2);
export const catapultBoosterNozzleGeo = new THREE.CylinderGeometry(0.22, 0.16, 0.45, 16);
catapultBoosterNozzleGeo.rotateX(Math.PI / 2);

// ドロップタワー・スカイデッキ用ジオメトリ
export const dropDeckGeo = new THREE.CylinderGeometry(2.8, 2.8, 0.18, 32);         // 強化ガラス円形デッキ
export const dropPylonGeo = new THREE.BoxGeometry(0.35, 7.5, 0.35);                // ツインタワー支柱
export const dropIndicatorGeo = new THREE.BoxGeometry(0.12, 6.2, 0.12);            // シアンブルー発光インジケーター
export const dropTrussPostGeo = new THREE.CylinderGeometry(0.16, 0.16, 7.5, 16);  // 白スチールトラス支柱
export const dropPulleyGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.22, 24);    // 最上部滑車プーリー
dropPulleyGeo.rotateZ(Math.PI / 2);
export const dropPulleyCableGeo = new THREE.CylinderGeometry(0.028, 0.028, 7.0, 8); // 懸架ケーブル
export const hatchDoorGeo = new THREE.BoxGeometry(1.65, 0.14, 3.3);

// ゲート用リゾートジオメトリ
export const gateDomeBaseGeo = new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2); // 白大理石ポップ半球ベース
export const gatePostSteelGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.4, 12);                        // ホワイトスチール支柱
export const gateTrimRingGeo = new THREE.TorusGeometry(0.13, 0.035, 8, 16);                             // オレンジトリムリング
gateTrimRingGeo.rotateX(Math.PI / 2);
export const gateTopBarGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.7, 12);
gateTopBarGeo.rotateZ(Math.PI / 2);

// 計算用共通一時ベクトル（Zero-Allocation）
export const _tempVec3A = new THREE.Vector3();
export const _tempVec3B = new THREE.Vector3();
export const _tempVec3C = new THREE.Vector3();
export const _tempVec3D = new THREE.Vector3();
export const _tempAvoidResult = { x: 0, z: 0 };

// =========================================================================
// 【海面のオーガニック化】多角形直線を完全撤廃し、三日月型波頭を描くテクスチャ
// =========================================================================
export function createSeaTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 512;
  cvs.height = 512;
  const ctx = cvs.getContext('2d');

  // 南国の透明感と深みを湛えたベースブルー
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, 512, 512);

  // ゆったりとした水深の階調
  const radialGrad = ctx.createRadialGradient(256, 256, 20, 256, 256, 256);
  radialGrad.addColorStop(0, '#0369a1');
  radialGrad.addColorStop(0.75, '#0284c7');
  radialGrad.addColorStop(1, '#0284c7');
  ctx.fillStyle = radialGrad;
  ctx.fillRect(0, 0, 512, 512);

  // 三日月型（クレッセント）のやわらかな白波を描く補助関数（境界折り返し対応）
  function drawOrganicWave(cx, cy, radius, width, alpha) {
    const offsets = [
      [0, 0],
      [512, 0], [-512, 0], [0, 512], [0, -512]
    ];

    offsets.forEach(([ox, oy]) => {
      const x = cx + ox;
      const y = cy + oy;
      if (x < -100 || x > 612 || y < -100 || y > 612) return;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.15); // 波のうねりに合わせた緩やかな斜め角

      // 主波頭（やわらかな三日月の弧線）
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.38, 0, Math.PI * 0.12, Math.PI * 0.88, false);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();

      // 内側の薄いさざ波ライン
      ctx.beginPath();
      ctx.ellipse(0, -radius * 0.14, radius * 0.62, radius * 0.22, 0, Math.PI * 0.18, Math.PI * 0.82, false);
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.45})`;
      ctx.lineWidth = width * 0.65;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.restore();
    });
  }

  // 有機的・自然に散らばる白波群を描画
  const waveSeeds = [
    { x: 74, y: 88, r: 42, w: 2.2, a: 0.14 },
    { x: 236, y: 52, r: 32, w: 1.8, a: 0.11 },
    { x: 398, y: 110, r: 48, w: 2.4, a: 0.15 },
    { x: 156, y: 210, r: 36, w: 2.0, a: 0.13 },
    { x: 324, y: 238, r: 44, w: 2.2, a: 0.14 },
    { x: 472, y: 276, r: 34, w: 1.8, a: 0.11 },
    { x: 86, y: 362, r: 46, w: 2.4, a: 0.15 },
    { x: 248, y: 394, r: 38, w: 2.0, a: 0.13 },
    { x: 412, y: 442, r: 42, w: 2.2, a: 0.14 },
    { x: 168, y: 478, r: 30, w: 1.6, a: 0.10 }
  ];

  waveSeeds.forEach(w => {
    drawOrganicWave(w.x, w.y, w.r, w.w, w.a);
  });

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 16);
  return tex;
}

export const seaTexture = createSeaTexture();

// カタパルト・ランウェイ用滑走路ラインテクスチャ
export function createRunwayTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 128;
  cvs.height = 256;
  const ctx = cvs.getContext('2d');

  // 鮮やかなスカイブルー床面
  ctx.fillStyle = '#0284c7';
  ctx.fillRect(0, 0, 128, 256);

  // 前方へ疾走するホワイト＆オレンジの加速ガイドライン
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(24, 0); ctx.lineTo(24, 256);
  ctx.moveTo(104, 0); ctx.lineTo(104, 256);
  ctx.stroke();

  // 中央のシェブロン（前進矢印）
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let y = 32; y < 256; y += 64) {
    ctx.beginPath();
    ctx.moveTo(42, y + 16);
    ctx.lineTo(64, y);
    ctx.lineTo(86, y + 16);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(cvs);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  return tex;
}

export const runwayTexture = createRunwayTexture();

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

  // ゲート用：白大理石ベース ＆ ホワイトスチール支柱 ＆ オレンジトリム
  gateBasePlate: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.20, metalness: 0.05 }),
  gateWhiteSteel: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.18, metalness: 0.12 }),
  gateOrangeTrim: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.25, metalness: 0.20 }),
  gateFrame: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.20 }),
  gatePedestal: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.20 }),

  bluePlank: new THREE.MeshStandardMaterial({ color: TEAMS.BLUE.hex, emissive: TEAMS.BLUE.emissive, emissiveIntensity: 0.20, roughness: 0.28 }),
  redPlank: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, emissive: TEAMS.RED.emissive, emissiveIntensity: 0.15, roughness: 0.3 }),
  yellowPlank: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, emissive: TEAMS.YELLOW.emissive, emissiveIntensity: 0.15, roughness: 0.3 }),

  // 床ブロック共有マテリアル（Botから絶対に上書きされない永久100%ソリッド定義）
  blockBlue: new THREE.MeshStandardMaterial({ color: TEAMS.BLUE.hex, emissive: TEAMS.BLUE.emissive, emissiveIntensity: 0.25, roughness: 0.30, metalness: 0.05 }),
  blockRed: new THREE.MeshStandardMaterial({ color: TEAMS.RED.hex, emissive: TEAMS.RED.emissive, emissiveIntensity: 0.22, roughness: 0.32 }),
  blockYellow: new THREE.MeshStandardMaterial({ color: TEAMS.YELLOW.hex, emissive: TEAMS.YELLOW.emissive, emissiveIntensity: 0.22, roughness: 0.32 }),
  blockNeutral: new THREE.MeshStandardMaterial({ color: TEAMS.NEUTRAL.hex, emissive: TEAMS.NEUTRAL.emissive, emissiveIntensity: 0.2, roughness: 0.35 }),

  // キャラクター本体マテリアル
  charBlue: new THREE.MeshStandardMaterial({
    color: TEAMS.BLUE.hex,
    emissive: TEAMS.BLUE.emissive,
    emissiveIntensity: 0.22,
    roughness: 0.22,
    metalness: 0.08
  }),
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

  // 磁石アイテム：12面体幾何学ジュエル用ネオンパープル
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

  // エレベーター用マテリアル
  elevatorDeckPlate: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.25, metalness: 0.15 }),
  elevatorHandrailSteel: new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.20, metalness: 0.75 }),
  elevatorGuideCable: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.70 }),
  elevatorFast: new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.70, roughness: 0.2 }),
  elevatorMid: new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xeab308, emissiveIntensity: 0.70, roughness: 0.2 }),
  elevatorSlow: new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xb91c1c, emissiveIntensity: 0.70, roughness: 0.2 }),

  // スカイダイブ（ジェットカタパルト・ランウェイ）用マテリアル
  catapultDeck: new THREE.MeshStandardMaterial({
    map: runwayTexture,
    color: 0xffffff,
    roughness: 0.18,
    metalness: 0.15
  }),
  catapultPipeRail: new THREE.MeshStandardMaterial({
    color: 0xf97316,
    roughness: 0.20,
    metalness: 0.35
  }),
  catapultNeonRail: new THREE.MeshStandardMaterial({
    color: 0x0066ff,
    emissive: 0x1d4ed8,
    emissiveIntensity: 0.85,
    roughness: 0.10,
    metalness: 0.20
  }),
  catapultBoosterMetal: new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.15,
    metalness: 0.85
  }),

  // ドロップタワー・スカイデッキ用マテリアル
  dropGlassFloor: new THREE.MeshStandardMaterial({
    color: 0x0284c7,
    emissive: 0x0369a1,
    emissiveIntensity: 0.25,
    roughness: 0.08,
    metalness: 0.30,
    transparent: true,
    opacity: 0.55
  }),
  dropTowerWhiteSteel: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.18,
    metalness: 0.12
  }),
  dropPulleyOrange: new THREE.MeshStandardMaterial({
    color: 0xf97316,
    roughness: 0.22,
    metalness: 0.45
  }),
  dropIndicatorNeon: new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00e5ff,
    emissiveIntensity: 1.2
  }),
  dropPylonSteel: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.18,
    metalness: 0.12
  }),
  hatchInnerVoid: new THREE.MeshBasicMaterial({
    color: 0x001a4d,
    transparent: true,
    opacity: 0.90
  })
};

// プレイヤー専用スタックマテリアル配列（白飛び防止ディープブルー）
export const playerStackMaterials = [];
for (let i = 0; i < MAX_VISUAL_STACK; i++) {
  playerStackMaterials.push(new THREE.MeshStandardMaterial({
    roughness: 0.28,
    metalness: 0.08
  }));
}

// Bot専用背負いマテリアル配列（床ブロック共有マテリアルを汚染しない独立インスタンス）
export const botRedStackMaterials = [];
export const botYellowStackMaterials = [];
for (let i = 0; i < MAX_VISUAL_STACK; i++) {
  botRedStackMaterials.push(new THREE.MeshStandardMaterial({
    color: TEAMS.RED.hex,
    emissive: TEAMS.RED.emissive,
    emissiveIntensity: 0.22,
    roughness: 0.32
  }));
  botYellowStackMaterials.push(new THREE.MeshStandardMaterial({
    color: TEAMS.YELLOW.hex,
    emissive: TEAMS.YELLOW.emissive,
    emissiveIntensity: 0.22,
    roughness: 0.32
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
botRedStackMaterials.forEach(mat => sharedMaterialsSet.add(mat));
botYellowStackMaterials.forEach(mat => sharedMaterialsSet.add(mat));

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
  elevatorCableWireGeo,
  catapultRampGeo,
  catapultTrimGeo,
  catapultPipeRailGeo,
  catapultBoosterNozzleGeo,
  dropDeckGeo,
  dropPylonGeo,
  dropIndicatorGeo,
  dropTrussPostGeo,
  dropPulleyGeo,
  dropPulleyCableGeo,
  hatchDoorGeo,
  gateDomeBaseGeo,
  gatePostSteelGeo,
  gateTrimRingGeo,
  gateTopBarGeo
]);

export const gateTextureCache = new Map();
export const gateMaterialsCache = new Map();

// 看板パネル本体の文字テクスチャ
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
  if (mat.map && mat.map !== seaTexture && mat.map !== runwayTexture) {
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