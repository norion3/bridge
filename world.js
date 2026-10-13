// コース伸長・浮島・橋・スライド・ジップライン・エレベーター・スカイダイブ・ドロップタワー施設・幾何学ジュエル配置・ブロック管理・破棄
import {
  TEAMS,
  BLOCK_TYPES,
  TRAMPOLINE_TIERS,
  LANES,
  PLANK_LENGTH,
  STAGE_TYPES,
  ELEVATOR_CONFIG,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG,
  ITEM_COLORS
} from './constants.js';
import {
  COLOR_NEUTRAL_PLANK,
  COLOR_BLUE_PLANK,
  COLOR_RED_PLANK,
  COLOR_YELLOW_PLANK,
  sharedMats,
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
  dropPulleyGeo,
  gatePedestalGeo,
  hatchFrameGeo,
  hatchDoorGeo,
  windStreakGeo,
  _tempVec3A,
  _tempVec3B,
  _tempVec3C,
  _tempVec3D,
  disposeHierarchy,
  getOrCreateGateMaterials
} from './materials.js';
import { floorBlockPool } from './particles.js';

export const STAGES = [];
export const CONNECTIONS = [];
export const bridges = [];
export const bridgesByStage = new Map();
export const modifierGates = [];
export const floorItems = [];
export const curvedSlideBonusBlocks = [];
export const ziplineBonusBlocks = [];
export const activeMagnetBlocks = [];
export const cloudObjects = [];
export let seaMesh = null;

export let attackCamTimer = 0;
let magnetDockStep = 0;

// ★ ワールド生成物のみを安全に追跡・管理するコレクション（ライト・パーティクル・キャラクターの保護用）
const trackedWorldObjects = new Set();

function addWorldObject(scene, obj) {
  scene.add(obj);
  trackedWorldObjects.add(obj);
  return obj;
}

export function setAttackCamTimer(val) {
  attackCamTimer = val;
}

export function decrementAttackCamTimer(dt) {
  attackCamTimer = Math.max(0, attackCamTimer - dt);
}

export function incMagnetDockStep() {
  magnetDockStep = (magnetDockStep + 1) % 6;
  return magnetDockStep;
}

const dummyPlankObj = new THREE.Object3D();

// ★ 浮島メッシュ：海底へ垂れ下がるアンカーワイヤーを完全撤去（すっきりした南国スカイアイランド）
export function createIslandMesh(r, y, z) {
  const group = new THREE.Group();
  const plat = new THREE.Mesh(islandGeo, sharedMats.island);
  plat.scale.set(r, 1, r);
  plat.position.set(0, y - 0.25, z);
  plat.receiveShadow = true;
  group.add(plat);

  const torusGeo = new THREE.TorusGeometry(r, 0.2, 8, 36);
  torusGeo.rotateX(Math.PI / 2);
  const border = new THREE.Mesh(torusGeo, sharedMats.islandBorder);
  // ★ 修正：リング上面を床面 +2cm (y + 0.02) に収め、フロアの縁取りとしてフラットかつ自然に配置
  border.position.set(0, y - 0.18, z);
  group.add(border);

  return group;
}

// 雲オブジェクトの生成
export function createCloudCluster(x, y, z, scale = 1.0) {
  const group = new THREE.Group();
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(1.4 * scale, 8, 8);
    const m = new THREE.Mesh(geo, sharedMats.cloud);
    m.position.set(
      (Math.random() - 0.5) * 3.2 * scale,
      (Math.random() - 0.5) * 0.8 * scale,
      (Math.random() - 0.5) * 2.2 * scale
    );
    group.add(m);
  }
  group.position.set(x, y, z);
  return group;
}

// 海面メッシュの初期化
export function initSea(scene) {
  if (seaMesh) {
    scene.remove(seaMesh);
    trackedWorldObjects.delete(seaMesh);
    if (seaMesh.geometry) seaMesh.geometry.dispose();
  }
  const seaGeo = new THREE.PlaneGeometry(1600, 1600);
  seaGeo.rotateX(-Math.PI / 2);
  seaMesh = new THREE.Mesh(seaGeo, sharedMats.sea);
  seaMesh.position.set(0, -140, -300);
  seaMesh.receiveShadow = true;
  addWorldObject(scene, seaMesh);
}

// アイテム生成（スピード、攻撃、マグネット）
export function spawnItem(scene, stageIdx, type = 'speed') {
  const stage = STAGES[stageIdx];
  if (!stage) return;

  const group = new THREE.Group();
  let crystalGeo = itemCrystalGeo;
  let crystalMat = sharedMats.itemCrystal;
  let ringMat = sharedMats.itemBeaconRing;

  if (type === 'attack') {
    crystalMat = sharedMats.itemAttackCrystal;
    ringMat = sharedMats.itemAttackBeaconRing;
  } else if (type === 'magnet') {
    crystalGeo = itemMagnetGeo;
    crystalMat = sharedMats.itemMagnetCrystal;
    ringMat = sharedMats.itemMagnetBeaconRing;
  } else {
    crystalGeo = itemSpeedGeo;
  }

  const crystal = new THREE.Mesh(crystalGeo, crystalMat);
  crystal.position.y = 1.35;
  crystal.castShadow = true;
  group.add(crystal);

  const ring = new THREE.Mesh(itemBeaconRingGeo, ringMat);
  ring.position.y = 0.08;
  group.add(ring);

  const angle = Math.random() * Math.PI * 2;
  const dist = Math.random() * (stage.r - 2.8);
  const posX = Math.cos(angle) * dist;
  const posZ = stage.z + Math.sin(angle) * dist;
  const posY = stage.y;

  group.position.set(posX, posY, posZ);
  addWorldObject(scene, group);

  const itemObj = {
    group,
    crystal,
    beaconRing: ring,
    type,
    stageIdx,
    active: true,
    pos: group.position
  };
  floorItems.push(itemObj);
  return itemObj;
}

// 算術ゲート生成
export function spawnGatesOnIsland(scene, stageIdx) {
  if (stageIdx % 2 !== 1) return;
  const stage = STAGES[stageIdx];
  if (!stage || stage.r < 7.0) return;

  const ops = [
    { opType: 'multiply', value: 2, label: '×2', isPositive: true },
    { opType: 'add', value: 6, label: '+6', isPositive: true },
    { opType: 'add', value: 4, label: '+4', isPositive: true },
    { opType: 'subtract', value: 3, label: '-3', isPositive: false },
    { opType: 'divide', value: 2, label: '÷2', isPositive: false }
  ];

  const posOp = ops[Math.floor(Math.random() * 3)];
  const negOp = ops[3 + Math.floor(Math.random() * 2)];

  const gatePairs = Math.random() < 0.5 ? [posOp, negOp] : [negOp, posOp];
  const gateXOffsets = [-2.4, 2.4];
  const gateZ = stage.z - stage.r * 0.15;

  for (let gIdx = 0; gIdx < 2; gIdx++) {
    const op = gatePairs[gIdx];
    const gateGroup = new THREE.Group();

    const frameW = 2.4, frameH = 2.6;
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, frameH, 12);
    const postL = new THREE.Mesh(postGeo, sharedMats.gateFrame);
    postL.position.set(-frameW / 2, frameH / 2, 0);
    postL.castShadow = true;
    gateGroup.add(postL);

    const postR = postL.clone();
    postR.position.x = frameW / 2;
    gateGroup.add(postR);

    const topBarGeo = new THREE.CylinderGeometry(0.08, 0.08, frameW + 0.16, 12);
    topBarGeo.rotateZ(Math.PI / 2);
    const topBar = new THREE.Mesh(topBarGeo, sharedMats.gateFrame);
    topBar.position.set(0, frameH, 0);
    gateGroup.add(topBar);

    const pedL = new THREE.Mesh(gatePedestalGeo, sharedMats.gatePedestal);
    pedL.position.set(-frameW / 2, 0.08, 0);
    gateGroup.add(pedL);
    const pedR = pedL.clone();
    pedR.position.x = frameW / 2;
    gateGroup.add(pedR);

    const panelGeo = new THREE.BoxGeometry(frameW - 0.22, frameH - 0.45, 0.12);
    const panelMats = getOrCreateGateMaterials(op.label, op.isPositive);
    const panelMesh = new THREE.Mesh(panelGeo, panelMats);
    panelMesh.position.set(0, frameH / 2 + 0.1, 0);
    gateGroup.add(panelMesh);

    const gx = gateXOffsets[gIdx];
    gateGroup.position.set(gx, stage.y, gateZ);
    addWorldObject(scene, gateGroup);

    modifierGates.push({
      meshGroup: gateGroup,
      stageIdx,
      opType: op.opType,
      value: op.value,
      pos: gateGroup.position,
      consumed: false
    });
  }
}

// ドロップタワー（スカイゲート・トラップドア）構造の構築
export function createTrapdoorHatchStructure(scene, stageIdx, posX, posY, startZ, endY, endZ) {
  const group = new THREE.Group();

  const deck = new THREE.Mesh(dropDeckGeo, sharedMats.dropGlassFloor);
  deck.position.set(posX, posY + 0.09, startZ);
  deck.receiveShadow = true;
  group.add(deck);

  const approachStart = startZ + 14.0;
  const walkGeo = new THREE.BoxGeometry(3.4, 0.18, 14.0);
  const walkMesh = new THREE.Mesh(walkGeo, sharedMats.dropGlassFloor);
  walkMesh.position.set(posX, posY + 0.09, startZ + 7.0);
  walkMesh.receiveShadow = true;
  group.add(walkMesh);

  const postL = new THREE.Mesh(dropPylonGeo, sharedMats.dropPylonSteel);
  postL.position.set(posX - 1.9, posY + 3.75, startZ);
  postL.castShadow = true;
  group.add(postL);

  const postR = postL.clone();
  postR.position.x = posX + 1.9;
  group.add(postR);

  const pulleyL = new THREE.Mesh(dropPulleyGeo, sharedMats.dropPulleySteel);
  pulleyL.position.set(posX - 1.9, posY + 7.4, startZ);
  group.add(pulleyL);

  const pulleyR = pulleyL.clone();
  pulleyR.position.x = posX + 1.9;
  group.add(pulleyR);

  const indL = new THREE.Mesh(dropIndicatorGeo, sharedMats.dropIndicatorNeon);
  indL.position.set(posX - 1.9, posY + 3.75, startZ + 0.18);
  group.add(indL);

  const indR = indL.clone();
  indR.position.x = posX + 1.9;
  group.add(indR);

  const doorLPivot = new THREE.Group();
  doorLPivot.position.set(posX - 1.5, posY + 0.02, startZ);
  const doorLMesh = new THREE.Mesh(hatchDoorGeo, sharedMats.dropGlassFloor);
  doorLMesh.position.set(0.825, 0, 0);
  doorLPivot.add(doorLMesh);
  group.add(doorLPivot);

  const doorRPivot = new THREE.Group();
  doorRPivot.position.set(posX + 1.5, posY + 0.02, startZ);
  const doorRMesh = new THREE.Mesh(hatchDoorGeo, sharedMats.dropGlassFloor);
  doorRMesh.position.set(-0.825, 0, 0);
  doorRPivot.add(doorRMesh);
  group.add(doorRPivot);

  addWorldObject(scene, group);

  return {
    group,
    doorLeftPivot: doorLPivot,
    doorRightPivot: doorRPivot,
    approachStartZ: approachStart
  };
}

// スカイダイブ（カタパルト発射台）構造の構築
export function createSkydiveCatapultStructure(scene, posX, posY, startZ) {
  const group = new THREE.Group();

  const ramp = new THREE.Mesh(catapultRampGeo, sharedMats.catapultDeck);
  ramp.position.set(posX, posY + 0.14, startZ - 3.6);
  ramp.rotation.x = -SKYDIVE_CONFIG.CATAPULT.slopeAngle;
  ramp.receiveShadow = true;
  group.add(ramp);

  const trimL = new THREE.Mesh(catapultTrimGeo, sharedMats.catapultNeonRail);
  trimL.position.set(posX - 1.8, posY + 0.28, startZ - 3.6);
  trimL.rotation.x = -SKYDIVE_CONFIG.CATAPULT.slopeAngle;
  group.add(trimL);

  const trimR = trimL.clone();
  trimR.position.x = posX + 1.8;
  group.add(trimR);

  addWorldObject(scene, group);
  return group;
}

// 橋およびアトラクションリンクの生成
export function createBridgeLinks(scene, stageIdx, nextStageIdx, type) {
  const prev = STAGES[stageIdx];
  const next = STAGES[nextStageIdx];
  if (!prev || !next) return;

  const prevIslandZ = prev.z;
  const nextIslandZ = next.z;
  const prevR = prev.r;
  const nextR = next.r;
  const startY = prev.y;
  const endY = next.y;

  const isJump = (type === 'jump');
  const isSlide = (type === 'slide');
  const isVertical = (type === 'vertical');
  const isCurvedSlide = (type === 'curved_slide');
  const isZipline = (type === 'zipline');
  const isElevator = (type === 'elevator');
  const isSkydive = (type === 'skydive');
  const isTrapdoor = (type === 'trapdoor');

  if (isSkydive) {
    const startZ = prevIslandZ - prevR * 0.95;
    const endZ = nextIslandZ + nextR * 0.4;
    createSkydiveCatapultStructure(scene, 0, startY, startZ);

    const bridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [], visualMeshes: [],
      startZ, endZ, startY, endY,
      isJump: false, isSlide: false, isVertical: false, isCurvedSlide: false,
      isZipline: false, isElevator: false, isSkydive: true, isTrapdoor: false, isFreefall: false
    };
    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(bridge);
    bridges.push(bridge);
    return;
  }

  if (isTrapdoor) {
    const startZ = prevIslandZ - prevR * 0.85;
    const endZ = nextIslandZ;
    const hatchStructure = createTrapdoorHatchStructure(scene, stageIdx, 0, startY, startZ, endY, endZ);

    const bridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [], visualMeshes: [],
      startZ, endZ, startY, endY,
      approachStartZ: hatchStructure.approachStartZ,
      doorLeftPivot: hatchStructure.doorLeftPivot,
      doorRightPivot: hatchStructure.doorRightPivot,
      isHatchOpen: false, hatchOpenProgress: 0,
      isJump: false, isSlide: false, isVertical: false, isCurvedSlide: false,
      isZipline: false, isElevator: false, isSkydive: false, isTrapdoor: true, isFreefall: false
    };
    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(bridge);
    bridges.push(bridge);
    return;
  }

  if (isZipline) {
    const startZ = prevIslandZ - prevR * 0.85;
    const endZ = nextIslandZ + nextR * 0.85;
    const startPt = new THREE.Vector3(0, startY + 4.2, startZ);
    const endPt = new THREE.Vector3(0, endY + 2.4, endZ);

    const pylonGeo = new THREE.CylinderGeometry(0.18, 0.24, 5.0, 12);
    const pylon1 = new THREE.Mesh(pylonGeo, sharedMats.ziplinePylonPost);
    pylon1.position.set(0, startY + 2.5, startZ);
    pylon1.castShadow = true;
    addWorldObject(scene, pylon1);

    const pylon2 = new THREE.Mesh(pylonGeo, sharedMats.ziplinePylonPost);
    pylon2.position.set(0, endY + 2.5, endZ);
    pylon2.castShadow = true;
    addWorldObject(scene, pylon2);

    const cableLen = startPt.distanceTo(endPt);
    const cableGeo = new THREE.CylinderGeometry(0.042, 0.042, cableLen, 8);
    cableGeo.rotateX(Math.PI / 2);
    const cableMesh = new THREE.Mesh(cableGeo, sharedMats.ziplineCable);
    cableMesh.position.lerpVectors(startPt, endPt, 0.5);
    cableMesh.lookAt(endPt);
    addWorldObject(scene, cableMesh);

    const bonusBlocks = [];
    const bonusCount = 12;
    for (let bi = 0; bi < bonusCount; bi++) {
      const t = (bi + 1) / (bonusCount + 1);
      const bPos = new THREE.Vector3().lerpVectors(startPt, endPt, t);
      const bMesh = new THREE.Mesh(blockGeometry, sharedMats.blockBlue);
      bMesh.position.set(bPos.x, bPos.y - 1.25, bPos.z);
      bMesh.scale.set(1.15, 1.15, 1.15);
      addWorldObject(scene, bMesh);
      const bObj = { mesh: bMesh, t, zi: bi, baseY: bPos.y - 1.25, collected: false };
      bonusBlocks.push(bObj);
      ziplineBonusBlocks.push(bObj);
    }

    const bridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [], visualMeshes: [pylon1, pylon2, cableMesh],
      startZ, endZ, startPt, endPt, bonusBlocks,
      isJump: false, isSlide: false, isVertical: false, isCurvedSlide: false,
      isZipline: true, isElevator: false, isSkydive: false, isTrapdoor: false, isFreefall: false
    };
    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(bridge);
    bridges.push(bridge);
    return;
  }

  if (isCurvedSlide) {
    const startZ = prevIslandZ - prevR * 0.90;
    const endZ = nextIslandZ + nextR * 0.90;
    const distZ = startZ - endZ;

    const curvePoints = [
      new THREE.Vector3(0, startY + 0.1, startZ),
      new THREE.Vector3(7.5, startY - (startY - endY) * 0.35, startZ - distZ * 0.33),
      new THREE.Vector3(-7.5, startY - (startY - endY) * 0.70, startZ - distZ * 0.67),
      new THREE.Vector3(0, endY + 0.1, endZ)
    ];
    const curve = new THREE.CatmullRomCurve3(curvePoints);
    const curveLength = curve.getLength();

    const slideGeo = new THREE.TubeGeometry(curve, 64, 2.2, 12, false);
    const slideMesh = new THREE.Mesh(slideGeo, sharedMats.slideSurface);
    slideMesh.receiveShadow = true;
    addWorldObject(scene, slideMesh);

    const bonusBlocks = [];
    const bonusCount = 14;
    for (let bi = 0; bi < bonusCount; bi++) {
      const t = (bi + 1) / (bonusCount + 1);
      const pt = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t).normalize();
      const norm = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const offset = (Math.sin(bi * 1.7) > 0 ? 1 : -1) * 0.85;

      const bMesh = new THREE.Mesh(blockGeometry, sharedMats.blockBlue);
      bMesh.position.set(pt.x + norm.x * offset, pt.y + 0.5, pt.z + norm.z * offset);
      addWorldObject(scene, bMesh);
      const bObj = { mesh: bMesh, t, offset, collected: false };
      bonusBlocks.push(bObj);
      curvedSlideBonusBlocks.push(bObj);
    }

    const bridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [], visualMeshes: [slideMesh],
      startZ, endZ, curve, curveLength, bonusBlocks,
      isJump: false, isSlide: false, isVertical: false, isCurvedSlide: true,
      isZipline: false, isElevator: false, isSkydive: false, isTrapdoor: false, isFreefall: false
    };
    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(bridge);
    bridges.push(bridge);
    return;
  }

  if (isElevator) {
    const startZ = prevIslandZ - prevR * 0.90;
    const endZ = nextIslandZ + nextR * 0.90;

    const elevators = ELEVATOR_CONFIG.LANES.map(laneCfg => {
      const railGeo = new THREE.BoxGeometry(0.15, Math.abs(endY - startY) + 4.0, 0.15);
      const rail = new THREE.Mesh(railGeo, sharedMats.gateFrame);
      rail.position.set(LANES[laneCfg.laneIdx], (startY + endY) / 2, (startZ + endZ) / 2);
      addWorldObject(scene, rail);

      return {
        laneIdx: laneCfg.laneIdx,
        duration: laneCfg.duration,
        speedTier: laneCfg.speedTier,
        railMesh: rail
      };
    });

    const bridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [], visualMeshes: elevators.map(e => e.railMesh),
      startZ, endZ, startY, endY, elevators,
      isJump: false, isSlide: false, isVertical: false, isCurvedSlide: false,
      isZipline: false, isElevator: true, isSkydive: false, isTrapdoor: false, isFreefall: false
    };
    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(bridge);
    bridges.push(bridge);
    return;
  }

  // 3レーン形式（通常階段、垂直壁、トランポリン、直線スライダー）
  for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
    const laneX = LANES[laneIdx];
    const prevInsetZ = Math.sqrt(Math.max(1, prevR * prevR - laneX * laneX));
    // ★ 修正：左右レーンの内側円弧せり出し (X = ±2.2m) に配慮したマージン補正
    const effectiveLaneX = (laneIdx === 1) ? 0 : (Math.abs(laneX) - 0.6);
    const nextInsetZ = Math.sqrt(Math.max(1, nextR * nextR - effectiveLaneX * effectiveLaneX));
    const startZ = prevIslandZ - prevInsetZ + 1.2;
    // ★ 修正：階段終点を島エッジ内側 (-0.8m) へ適正化し、最上段が島フロアに確実に乗り上げて隙間なく登れるよう架橋
    const endZ = nextIslandZ + nextInsetZ - 0.8;
    const distZ = startZ - endZ;

    const dist3D = Math.hypot(distZ, endY - startY);
    const numPlanks = isJump ? 1 : Math.max(12, Math.floor(dist3D / (PLANK_LENGTH * 0.75)));

    const bridge = {
      stageIdx, nextStageIdx, laneIdx, planks: [], visualMeshes: [],
      startZ, endZ, isJump, isSlide, isVertical,
      isSkydive: false, isTrapdoor: false, isCurvedSlide: false, isZipline: false, isElevator: false, isFreefall: false,
      ghostMesh: null, solidMesh: null
    };

    if (isSlide) {
      const slideLength = Math.hypot(distZ, endY - startY);
      const slideSlopeAngle = Math.atan2(startY - endY, distZ);

      const surfaceGeo = new THREE.BoxGeometry(3.6, 0.16, slideLength);
      surfaceGeo.rotateX(-slideSlopeAngle);
      const surfaceMesh = new THREE.Mesh(surfaceGeo, sharedMats.slideSurface);
      surfaceMesh.position.set(laneX, (startY + endY) / 2 + 0.08, (startZ + endZ) / 2);
      surfaceMesh.receiveShadow = true;
      addWorldObject(scene, surfaceMesh);
      bridge.visualMeshes.push(surfaceMesh);

      // ★ 直線スライダー：4本レール（X = -5.85, -2.00, +2.00, +5.85）の適正配置
      if (laneIdx === 0) {
        const railCoords = [-5.85, -2.0, 2.0, 5.85];
        railCoords.forEach(rx => {
          const railGeo = new THREE.CylinderGeometry(0.12, 0.12, slideLength, 12);
          railGeo.rotateX(Math.PI / 2 - slideSlopeAngle);
          const rMesh = new THREE.Mesh(railGeo, sharedMats.slideRail);
          rMesh.position.set(rx, (startY + endY) / 2 + 0.32, (startZ + endZ) / 2);
          addWorldObject(scene, rMesh);
          bridge.visualMeshes.push(rMesh);
        });
      }

      for (let i = 0; i < numPlanks; i++) {
        const progress = (i + 0.5) / numPlanks;
        const pZ = startZ - progress * distZ;
        const pY = startY + progress * (endY - startY);
        bridge.planks.push({ teamId: TEAMS.NEUTRAL.id, index: i, y: pY, z: pZ });
      }
    } else if (isJump) {
      const tiers = [TRAMPOLINE_TIERS.normal, TRAMPOLINE_TIERS.high, TRAMPOLINE_TIERS.mega];
      const tier = tiers[laneIdx % 3];

      const trampGroup = new THREE.Group();
      const ringGeo = new THREE.TorusGeometry(1.6, 0.18, 12, 32);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshStandardMaterial({ color: tier.ringColor, roughness: 0.25, metalness: 0.35 });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.52;
      trampGroup.add(ringMesh);

      const netGeo = new THREE.CylinderGeometry(1.48, 1.48, 0.12, 24);
      const netMat = new THREE.MeshStandardMaterial({
        color: tier.targetColor,
        emissive: tier.targetEmissive,
        emissiveIntensity: 0.45,
        roughness: 0.3
      });
      const netMesh = new THREE.Mesh(netGeo, netMat);
      netMesh.position.y = 0.50;
      trampGroup.add(netMesh);

      trampGroup.position.set(laneX, startY, startZ - 1.2);
      addWorldObject(scene, trampGroup);
      bridge.visualMeshes.push(trampGroup);

      bridge.planks.push({
        teamId: TEAMS.NEUTRAL.id,
        index: 0,
        y: startY,
        z: startZ - 1.2,
        isJumpPad: true,
        jumpTier: tier,
        netMesh
      });
    } else {
      const geoToUse = isVertical ? verticalPlankGeo : plankGeo;

      const ghostMesh = new THREE.InstancedMesh(geoToUse, sharedMats.ghostPlank, numPlanks);
      ghostMesh.receiveShadow = true;

      const solidMesh = new THREE.InstancedMesh(geoToUse, sharedMats.solidPlank, numPlanks);
      solidMesh.castShadow = true;
      solidMesh.receiveShadow = true;

      for (let i = 0; i < numPlanks; i++) {
        const progress = (i + 0.5) / numPlanks;
        const pZ = startZ - progress * distZ;
        // ★ 修正：最上段とその手前段（上から2段）を踊り場として endY - 0.16m でフラットに揃え、
        // 浮島円弧リング（上面 endY + 0.02m）を上から14cmのマージンですっぽり跨いで完全に覆い隠す
        const normStep = (numPlanks > 2) ? Math.min(1.0, i / (numPlanks - 2)) : 1.0;
        const pY = startY + normStep * ((endY - 0.16) - startY);

        dummyPlankObj.position.set(LANES[laneIdx], pY, pZ);
        dummyPlankObj.rotation.set(0, 0, 0);
        dummyPlankObj.scale.set(1, 1, 1);
        dummyPlankObj.updateMatrix();
        ghostMesh.setMatrixAt(i, dummyPlankObj.matrix);

        dummyPlankObj.scale.set(0, 0, 0);
        dummyPlankObj.updateMatrix();
        solidMesh.setMatrixAt(i, dummyPlankObj.matrix);
        solidMesh.setColorAt(i, COLOR_NEUTRAL_PLANK);

        bridge.planks.push({ teamId: null, index: i, y: pY, z: pZ });
      }

      ghostMesh.instanceMatrix.needsUpdate = true;
      solidMesh.instanceMatrix.needsUpdate = true;
      if (solidMesh.instanceColor) solidMesh.instanceColor.needsUpdate = true;

      addWorldObject(scene, ghostMesh);
      addWorldObject(scene, solidMesh);
      bridge.ghostMesh = ghostMesh;
      bridge.solidMesh = solidMesh;
      bridge.visualMeshes.push(ghostMesh, solidMesh);
    }

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(bridge);
    bridges.push(bridge);
  }
}

// ステージの床ブロック取得
export function getFloorBlocksForStage(stageIdx) {
  const stage = STAGES[stageIdx];
  if (!stage) return [];
  if (!stage.floorBlocks) stage.floorBlocks = [];
  return stage.floorBlocks;
}

// 浮島上のブロック配置管理
export function spawnFloorBlocksOnIsland(scene, stageIdx, desiredCount = 28) {
  const stage = STAGES[stageIdx];
  if (!stage) return;
  const stageBlocks = getFloorBlocksForStage(stageIdx);

  const needed = desiredCount - stageBlocks.length;
  if (needed <= 0) return;

  const types = BLOCK_TYPES;
  for (let i = 0; i < needed; i++) {
    let poolItem = floorBlockPool.find(b => !b.active);
    if (!poolItem) break;

    const t = types[Math.floor(Math.random() * types.length)];
    if (t.id === 'blue') poolItem.mesh.material = sharedMats.blockBlue;
    else if (t.id === 'red') poolItem.mesh.material = sharedMats.blockRed;
    else poolItem.mesh.material = sharedMats.blockYellow;

    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * (stage.r - 1.8);
    const px = Math.cos(angle) * dist;
    const pz = stage.z + Math.sin(angle) * dist;
    const py = stage.y + 0.18;

    poolItem.mesh.position.set(px, py, pz);
    poolItem.mesh.rotation.set(0, Math.random() * Math.PI, 0);
    poolItem.mesh.visible = true;

    poolItem.active = true;
    poolItem.team = t;
    poolItem.pos = poolItem.mesh.position;
    poolItem.stageIdx = stageIdx;
    poolItem.attracting = false;

    stageBlocks.push(poolItem);
  }
}

export function manageBlockSpawns(scene, isGameOver) {
  if (isGameOver) return;
  for (let i = 0; i < STAGES.length; i++) {
    spawnFloorBlocksOnIsland(scene, i, 26);
  }
}

// 初期ワールドの構築
export function buildWorld(scene) {
  // ★ 修正：ライトやパーティクル、キャラクターを巻き込まず、ワールドオブジェクトのみを安全にクリーンアップ
  for (const obj of trackedWorldObjects) {
    scene.remove(obj);
    disposeHierarchy(obj);
  }
  trackedWorldObjects.clear();

  STAGES.length = 0;
  CONNECTIONS.length = 0;
  bridges.length = 0;
  bridgesByStage.clear();
  modifierGates.length = 0;
  floorItems.length = 0;
  curvedSlideBonusBlocks.length = 0;
  ziplineBonusBlocks.length = 0;
  activeMagnetBlocks.length = 0;
  cloudObjects.length = 0;

  initSea(scene);

  const initialStages = [
    { id: 0, x: 0, y: 0, z: 0, r: 9.0 },
    { id: 1, x: 0, y: 7.0, z: -36.0, r: 10.0 },
    { id: 2, x: 0, y: 14.0, z: -74.0, r: 10.0 },
    { id: 3, x: 0, y: 2.0, z: -132.0, r: 10.0 },
    { id: 4, x: 0, y: 16.0, z: -172.0, r: 10.0 },
    { id: 5, x: 0, y: -26.0, z: -224.0, r: 11.0 },
    { id: 6, x: 0, y: 6.0, z: -266.0, r: 10.0 },
    { id: 7, x: 0, y: -64.0, z: -266.0, r: 12.0 }
  ];

  const initialConns = [
    { from: 0, to: 1, type: 'bridge' },
    { from: 1, to: 2, type: 'bridge' },
    { from: 2, to: 3, type: 'curved_slide' },
    { from: 3, to: 4, type: 'elevator' },
    { from: 4, to: 5, type: 'skydive' },
    { from: 5, to: 6, type: 'vertical' },
    { from: 6, to: 7, type: 'trapdoor' }
  ];

  initialStages.forEach(st => {
    st.floorBlocks = [];
    STAGES.push(st);
    const islandMesh = createIslandMesh(st.r, st.y, st.z);
    addWorldObject(scene, islandMesh);
  });

  initialConns.forEach(c => {
    CONNECTIONS.push(c);
    createBridgeLinks(scene, c.from, c.to, c.type);
  });

  // ゲートおよびアイテムの初期配置
  spawnGatesOnIsland(scene, 1);
  spawnGatesOnIsland(scene, 3);
  spawnGatesOnIsland(scene, 5);

  spawnItem(scene, 1, 'speed');
  spawnItem(scene, 2, 'attack');
  spawnItem(scene, 4, 'magnet');

  // 背景の雲クラスタ配置
  for (let ci = 0; ci < 16; ci++) {
    const cx = (Math.random() - 0.5) * 220;
    const cy = 20 + Math.random() * 65;
    const cz = -ci * 25 + 10;
    const cloud = createCloudCluster(cx, cy, cz, 1.2 + Math.random() * 0.8);
    addWorldObject(scene, cloud);
    cloudObjects.push({ mesh: cloud, baseY: cy, offset: Math.random() * Math.PI * 2 });
  }
}

// コースの動的延伸（シャッフルバッグ・黄金比率）
export function extendCourse(scene) {
  const lastStage = STAGES[STAGES.length - 1];
  const newId = STAGES.length;

  let type = 'bridge';
  let nextY = lastStage.y;
  let nextZ = lastStage.z;
  let nextR = 10.0;

  // 下り・上りの状態に応じてギミックを選出
  if (lastStage.y >= 14.0) {
    const downGimmicks = ['slide', 'skydive', 'trapdoor', 'curved_slide', 'zipline'];
    type = downGimmicks[Math.floor(Math.random() * downGimmicks.length)];

    if (type === 'skydive') {
      nextY = lastStage.y - SKYDIVE_CONFIG.PHYSICS.minHeightDrop;
      nextZ = lastStage.z - SKYDIVE_CONFIG.PHYSICS.forwardDistance;
      nextR = 11.5;
    } else if (type === 'trapdoor') {
      nextY = lastStage.y - TRAPDOOR_CONFIG.PHYSICS.minHeightDrop;
      nextZ = lastStage.z; // 垂直直下
      nextR = 12.0;
    } else if (type === 'zipline') {
      nextY = lastStage.y - 12.0;
      nextZ = lastStage.z - 68.0;
      nextR = 10.5;
    } else if (type === 'curved_slide') {
      nextY = lastStage.y - 16.0;
      nextZ = lastStage.z - 58.0;
      nextR = 10.0;
    } else {
      nextY = lastStage.y - 10.0;
      nextZ = lastStage.z - 42.0;
      nextR = 10.0;
    }
  } else {
    const upGimmicks = ['elevator', 'vertical', 'jump', 'bridge'];
    type = upGimmicks[Math.floor(Math.random() * upGimmicks.length)];

    if (type === 'elevator') {
      nextY = lastStage.y + 16.0;
      nextZ = lastStage.z - 44.0;
      nextR = 10.5;
    } else if (type === 'vertical') {
      nextY = lastStage.y + 12.0;
      nextZ = lastStage.z - 36.0;
      nextR = 10.0;
    } else if (type === 'jump') {
      nextY = lastStage.y + 8.0;
      nextZ = lastStage.z - 42.0;
      nextR = 10.0;
    } else {
      nextY = lastStage.y + 7.0;
      nextZ = lastStage.z - 38.0;
      nextR = 10.0;
    }
  }

  const newStage = { id: newId, x: 0, y: nextY, z: nextZ, r: nextR, floorBlocks: [] };
  STAGES.push(newStage);

  const islandMesh = createIslandMesh(newStage.r, newStage.y, newStage.z);
  addWorldObject(scene, islandMesh);

  CONNECTIONS.push({ from: lastStage.id, to: newId, type });
  createBridgeLinks(scene, lastStage.id, newId, type);

  if (newId % 2 === 1) {
    spawnGatesOnIsland(scene, newId);
  }

  if (newId % 3 === 0) {
    const itemTypes = ['speed', 'attack', 'magnet'];
    const itType = itemTypes[(newId / 3) % 3];
    spawnItem(scene, newId, itType);
  }

  // 雲クラスタの追加
  for (let c = 0; c < 2; c++) {
    const cx = (Math.random() - 0.5) * 220;
    const cy = nextY + 25 + Math.random() * 45;
    const cz = nextZ + (Math.random() - 0.5) * 30;
    const cloud = createCloudCluster(cx, cy, cz, 1.2 + Math.random() * 0.8);
    addWorldObject(scene, cloud);
    cloudObjects.push({ mesh: cloud, baseY: cy, offset: Math.random() * Math.PI * 2 });
  }
}

// 過去データのクリーンアップ
export function cleanupOldData(scene) {
  // 必要に応じて後方の不要ステージを回収
}