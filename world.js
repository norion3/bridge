// コース伸長・浮島・橋・スライド・ジップライン・エレベーター・スカイダイブ・ドロップタワー施設・幾何学ジュエル配置・破棄
import {
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
  sharedMats,
  blockGeometry,
  plankGeo,
  verticalPlankGeo,
  islandGeo,
  itemCrystalGeo,
  itemSpeedGeo,
  itemMagnetGeo,
  itemBeaconRingGeo,
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
  hatchDoorGeo,
  COLOR_NEUTRAL_PLANK,
  COLOR_BLUE_PLANK,
  COLOR_RED_PLANK,
  COLOR_YELLOW_PLANK,
  getOrCreateGateMaterials,
  disposeHierarchy
} from './materials.js';
import { resetParticlePools, floorBlockPool } from './particles.js';
import { createZiplineTrolleyMesh, characters, player } from './character.js';

export const STAGES = [];
export const CONNECTIONS = [];
export const stageMeshes = [];
export const modifierGates = [];
export const cloudObjects = [];
export const oceanIslands = [];
export let seaMesh = null;
export const bridges = [];
export const floorItems = [];
export const curvedSlideBonusBlocks = [];
export const ziplineBonusBlocks = [];
export const activeMagnetBlocks = [];
export const floorBlocksByStage = new Map();
export const bridgesByStage = new Map();

export let speedItemIslandCounter = 0;
export const ITEM_ROTATION = ['speed', 'attack', 'magnet'];
export let itemRotationIndex = 0;
export let magnetDockStepCounter = 0;
export let attackCamTimer = 0;

export function setAttackCamTimer(v) { attackCamTimer = v; }
export function decrementAttackCamTimer(dt) { attackCamTimer = Math.max(0, attackCamTimer - dt); }
export function incMagnetDockStep() { return magnetDockStepCounter++; }

const dummyPlankObj = new THREE.Object3D();

// ★ シャッフルバッグ方式（偏り・同一ギミック連続の物理的完全根絶）
const DESCENT_GIMMICKS = ['slide', 'skydive', 'trapdoor', 'curved_slide', 'zipline'];
const ASCENT_GIMMICKS = ['elevator', 'vertical', 'jump', 'bridge'];
let descentBag = [];
let ascentBag = [];
let lastGimmickType = null;

function getNextDescentGimmick() {
  if (descentBag.length === 0) {
    descentBag = [...DESCENT_GIMMICKS];
    for (let i = descentBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [descentBag[i], descentBag[j]] = [descentBag[j], descentBag[i]];
    }
    // 直前に選ばれたギミックと同じものが先頭（末尾pop対象）にある場合は入れ替えて連続を防止
    if (descentBag[descentBag.length - 1] === lastGimmickType && descentBag.length > 1) {
      const swapIdx = Math.floor(Math.random() * (descentBag.length - 1));
      [descentBag[descentBag.length - 1], descentBag[swapIdx]] = [descentBag[swapIdx], descentBag[descentBag.length - 1]];
    }
  }
  const picked = descentBag.pop();
  lastGimmickType = picked;
  return picked;
}

function getNextAscentGimmick() {
  if (ascentBag.length === 0) {
    ascentBag = [...ASCENT_GIMMICKS];
    for (let i = ascentBag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ascentBag[i], ascentBag[j]] = [ascentBag[j], ascentBag[i]];
    }
    if (ascentBag[ascentBag.length - 1] === lastGimmickType && ascentBag.length > 1) {
      const swapIdx = Math.floor(Math.random() * (ascentBag.length - 1));
      [ascentBag[ascentBag.length - 1], ascentBag[swapIdx]] = [ascentBag[swapIdx], ascentBag[ascentBag.length - 1]];
    }
  }
  const picked = ascentBag.pop();
  lastGimmickType = picked;
  return picked;
}

export function getFloorBlocksForStage(stageIdx) {
  let bucket = floorBlocksByStage.get(stageIdx);
  if (!bucket) {
    bucket = [];
    floorBlocksByStage.set(stageIdx, bucket);
  }
  return bucket;
}

export function createModifierGate(scene, stageIdx, posX, posZ, posY, opType, value, label) {
  const isPositive = (opType === 'add' || opType === 'multiply');
  const group = new THREE.Group();

  const materials = getOrCreateGateMaterials(label, isPositive);
  const panelMesh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 0.15), materials);
  panelMesh.position.y = 1.3;
  panelMesh.castShadow = true;
  group.add(panelMesh);

  // 門の柱：ホワイトスチール支柱
  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.4, 12);
  const p1 = new THREE.Mesh(postGeo, sharedMats.gateFrame);
  p1.position.set(-1.3, 1.2, 0);
  group.add(p1);
  const p2 = p1.clone();
  p2.position.x = 1.3;
  group.add(p2);

  // 支柱上下のオレンジアクセントリング
  const ringGeo = new THREE.TorusGeometry(0.12, 0.025, 8, 16);
  ringGeo.rotateX(Math.PI / 2);
  const rL1 = new THREE.Mesh(ringGeo, sharedMats.ziplinePylonTrim);
  rL1.position.set(-1.3, 0.35, 0);
  group.add(rL1);
  const rR1 = rL1.clone();
  rR1.position.x = 1.3;
  group.add(rR1);

  // 白大理石フロア直結クリーンベース
  const pedL = new THREE.Mesh(gatePedestalGeo, sharedMats.gatePedestal);
  pedL.position.set(-1.3, 0.08, 0);
  group.add(pedL);
  const pedR = pedL.clone();
  pedR.position.x = 1.3;
  group.add(pedR);

  const topBarGeo = new THREE.CylinderGeometry(0.08, 0.08, 2.7, 12);
  topBarGeo.rotateZ(Math.PI / 2);
  const topBar = new THREE.Mesh(topBarGeo, sharedMats.gateFrame);
  topBar.position.y = 2.4;
  group.add(topBar);

  group.position.set(posX, posY, posZ);
  scene.add(group);

  const gateData = {
    meshGroup: group,
    stageIdx: stageIdx,
    pos: new THREE.Vector3(posX, posY, posZ),
    opType: opType,
    value: value,
    label: label,
    isPositive: isPositive,
    consumed: false
  };
  modifierGates.push(gateData);
}

export function createTrampolineMesh(x, y, z, tier) {
  const group = new THREE.Group();

  const ringGeo = new THREE.TorusGeometry(1.75, 0.22, 16, 32);
  ringGeo.rotateX(Math.PI / 2);
  const ringMat = new THREE.MeshStandardMaterial({
    color: tier.ringColor,
    roughness: 0.25,
    metalness: 0.2
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.52;
  ring.castShadow = true;
  group.add(ring);

  const netGeo = new THREE.CylinderGeometry(1.65, 1.65, 0.08, 32);
  const netMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.8
  });
  const net = new THREE.Mesh(netGeo, netMat);
  net.position.y = 0.50;
  net.receiveShadow = true;
  group.add(net);

  const targetGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.1, 24);
  const targetMat = new THREE.MeshStandardMaterial({
    color: tier.targetColor,
    roughness: 0.35,
    emissive: tier.targetEmissive,
    emissiveIntensity: 0.25
  });
  const target = new THREE.Mesh(targetGeo, targetMat);
  target.position.y = 0.51;
  group.add(target);

  const legGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.55, 12);
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.25,
    metalness: 0.75
  });

  const angles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
  angles.forEach(ang => {
    const leg = new THREE.Mesh(legGeo, legMat);
    const legR = 1.65;
    leg.position.set(Math.cos(ang) * legR, 0.26, Math.sin(ang) * legR);
    group.add(leg);
  });

  group.position.set(x, y, z);
  return { group, net, ring };
}

export function createElevatorStationStructure(scene, startX, startY, startZ, endY, endZ, laneCfg) {
  const group = new THREE.Group();

  const startDeck = new THREE.Mesh(elevatorPlatformFloorGeo, sharedMats.elevatorDeckPlate);
  startDeck.position.set(startX, startY + 0.09, startZ + 1.0);
  startDeck.receiveShadow = true;
  group.add(startDeck);

  let padMat;
  if (laneCfg.speedTier === 'fast') padMat = sharedMats.elevatorFast;
  else if (laneCfg.speedTier === 'mid') padMat = sharedMats.elevatorMid;
  else padMat = sharedMats.elevatorSlow;

  const padGeo = new THREE.BoxGeometry(2.1, 0.18, 1.7);
  const speedPad = new THREE.Mesh(padGeo, padMat);
  speedPad.position.set(startX, startY + 0.10, startZ + 1.0);
  group.add(speedPad);

  const postL = new THREE.Mesh(elevatorHandrailPostGeo, sharedMats.elevatorHandrailSteel);
  postL.position.set(startX - 1.15, startY + 1.1, startZ + 1.8);
  group.add(postL);

  const postR = postL.clone();
  postR.position.x = startX + 1.15;
  group.add(postR);

  const signMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.45, 0.12), padMat);
  signMesh.position.set(startX, startY + 2.05, startZ + 1.8);
  group.add(signMesh);

  const arrivalDeck = new THREE.Mesh(elevatorPlatformFloorGeo, sharedMats.elevatorDeckPlate);
  arrivalDeck.position.set(startX, endY + 0.09, endZ - 1.0);
  arrivalDeck.receiveShadow = true;
  group.add(arrivalDeck);

  const arrPad = new THREE.Mesh(padGeo, padMat);
  arrPad.position.set(startX, endY + 0.10, endZ - 1.0);
  group.add(arrPad);

  scene.add(group);
  return group;
}

// ★ スカイダイブ発射台：7.2m コースター滑走路規格（水色床面・シェブロン矢印・太いオレンジ安全パイプレール）
export function createSkydiveCatapultStructure(scene, posX, posY, posZ) {
  const group = new THREE.Group();
  const rampLen = SKYDIVE_CONFIG.CATAPULT.length; // 7.2m
  const slopeAng = SKYDIVE_CONFIG.CATAPULT.slopeAngle;

  // 1. スカイブルー滑走路床面
  const rampMesh = new THREE.Mesh(catapultRampGeo, sharedMats.catapultDeck);
  rampMesh.position.set(posX, posY + 0.08, posZ - rampLen * 0.45);
  rampMesh.rotation.x = slopeAng;
  rampMesh.receiveShadow = true;
  rampMesh.castShadow = true;
  group.add(rampMesh);

  // 2. 太いオレンジ安全パイプレール
  const railL = new THREE.Mesh(catapultTrimGeo, sharedMats.catapultNeonRail);
  railL.position.set(posX - 1.82, posY + 0.32, posZ - rampLen * 0.45);
  railL.rotation.x = slopeAng;
  group.add(railL);

  const railR = railL.clone();
  railR.position.x = posX + 1.82;
  group.add(railR);

  // 3. 滑走面上のシェブロン矢印ガイドライン（加速誘導サイン）
  const numChevrons = 4;
  const chevronGeo = new THREE.BoxGeometry(1.1, 0.04, 0.16);
  for (let ci = 0; ci < numChevrons; ci++) {
    const cz = posZ - 1.4 - ci * 1.35;
    const cy = posY + 0.22 + (posZ - cz) * Math.sin(slopeAng);

    const chevL = new THREE.Mesh(chevronGeo, sharedMats.catapultNeonRail);
    chevL.position.set(posX - 0.45, cy, cz);
    chevL.rotation.set(slopeAng, 0.42, 0);
    group.add(chevL);

    const chevR = new THREE.Mesh(chevronGeo, sharedMats.catapultNeonRail);
    chevR.position.set(posX + 0.45, cy, cz);
    chevR.rotation.set(slopeAng, -0.42, 0);
    group.add(chevR);
  }

  // 4. 先端エッジトリム
  const tipEdgeGeo = new THREE.BoxGeometry(3.8, 0.16, 0.35);
  const tipEdge = new THREE.Mesh(tipEdgeGeo, sharedMats.catapultNeonRail);
  tipEdge.position.set(posX, posY - 0.28, posZ - rampLen * 0.92);
  group.add(tipEdge);

  group.position.set(0, 0, 0);
  scene.add(group);

  return {
    group,
    launchPoint: new THREE.Vector3(posX, posY, posZ)
  };
}

// ★ ドロップタワー・スカイゲート施設：白スチールトラス支柱＆最上部オレンジ滑車プーリー（完全垂直落下仕様）
export function createTrapdoorHatchStructure(scene, posX, posY, hatchZ, approachStartZ) {
  const group = new THREE.Group();

  // 手前島からハッチ位置（hatchZ）まで伸びる透明ガラスのアプローチスカイウォーク
  if (approachStartZ > hatchZ + 0.5) {
    const walkLen = approachStartZ - hatchZ;
    const walkGeo = new THREE.BoxGeometry(3.2, 0.14, walkLen);
    const walkMesh = new THREE.Mesh(walkGeo, sharedMats.dropGlassFloor);
    walkMesh.position.set(posX, posY + 0.08, (approachStartZ + hatchZ) / 2);
    walkMesh.receiveShadow = true;
    group.add(walkMesh);

    // スカイウォークのサイドパイプレール
    const sideRailGeo = new THREE.CylinderGeometry(0.06, 0.06, walkLen, 8);
    sideRailGeo.rotateX(Math.PI / 2);
    const sRailL = new THREE.Mesh(sideRailGeo, sharedMats.catapultNeonRail);
    sRailL.position.set(posX - 1.6, posY + 0.45, (approachStartZ + hatchZ) / 2);
    group.add(sRailL);
    const sRailR = sRailL.clone();
    sRailR.position.x = 1.6;
    group.add(sRailR);
  }

  // 1. せり出し円形強化ガラスデッキ
  const deck = new THREE.Mesh(dropDeckGeo, sharedMats.dropGlassFloor);
  deck.position.set(posX, posY + 0.08, hatchZ);
  deck.receiveShadow = true;
  group.add(deck);

  // 2. 外周スチールリム
  const rimGeo = new THREE.TorusGeometry(2.8, 0.08, 8, 32);
  rimGeo.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, sharedMats.dropPylonSteel);
  rim.position.set(posX, posY + 0.16, hatchZ);
  group.add(rim);

  // 3. 左右にそびえ立つ白スチールトラス支柱 ＆ シアンブルーネオンインジケーター
  const pylonL = new THREE.Mesh(dropPylonGeo, sharedMats.dropPylonSteel);
  pylonL.position.set(posX - 2.2, posY + 3.75, hatchZ);
  pylonL.castShadow = true;
  group.add(pylonL);

  const indL = new THREE.Mesh(dropIndicatorGeo, sharedMats.dropIndicatorNeon);
  indL.position.set(posX - 2.2, posY + 3.75, hatchZ + 0.18);
  group.add(indL);

  const pylonR = new THREE.Mesh(dropPylonGeo, sharedMats.dropPylonSteel);
  pylonR.position.set(posX + 2.2, posY + 3.75, hatchZ);
  pylonR.castShadow = true;
  group.add(pylonR);

  const indR = new THREE.Mesh(dropIndicatorGeo, sharedMats.dropIndicatorNeon);
  indR.position.set(posX + 2.2, posY + 3.75, hatchZ + 0.18);
  group.add(indR);

  // 4. タワー上部クロスバー
  const topCrossBarGeo = new THREE.BoxGeometry(4.8, 0.32, 0.32);
  const topCrossBar = new THREE.Mesh(topCrossBarGeo, sharedMats.dropPylonSteel);
  topCrossBar.position.set(posX, posY + 7.3, hatchZ);
  group.add(topCrossBar);

  // 5. 最上部オレンジ滑車プーリー（絶叫タワー構造）
  const pulleyL = new THREE.Mesh(dropPulleyGeo, sharedMats.dropPulleySteel);
  pulleyL.position.set(posX - 1.8, posY + 7.3, hatchZ);
  group.add(pulleyL);

  const pulleyR = new THREE.Mesh(dropPulleyGeo, sharedMats.dropPulleySteel);
  pulleyR.position.set(posX + 1.8, posY + 7.3, hatchZ);
  group.add(pulleyR);

  // 6. 左右に開放するガラスハッチ扉（ピボット制御）
  const doorLeftPivot = new THREE.Group();
  doorLeftPivot.position.set(posX - 1.5, posY + 0.10, hatchZ);
  const doorL = new THREE.Mesh(hatchDoorGeo, sharedMats.dropGlassFloor);
  doorL.position.set(0.75, 0, 0);
  doorLeftPivot.add(doorL);
  group.add(doorLeftPivot);

  const doorRightPivot = new THREE.Group();
  doorRightPivot.position.set(posX + 1.5, posY + 0.10, hatchZ);
  const doorR = new THREE.Mesh(hatchDoorGeo, sharedMats.dropGlassFloor);
  doorRightPivot.add(doorR);
  doorR.position.set(-0.75, 0, 0);
  group.add(doorRightPivot);

  group.position.set(0, 0, 0);
  scene.add(group);

  return {
    group,
    doorLeftPivot,
    doorRightPivot,
    hatchCenter: new THREE.Vector3(posX, posY, hatchZ)
  };
}

export function createZiplinePylonMesh(x, y, z, topAnchorY, isDeparture = true) {
  const group = new THREE.Group();
  const pylonH = topAnchorY - y;

  const postRadius = 0.18;
  const legGeo = new THREE.CylinderGeometry(postRadius, postRadius, pylonH, 16);

  const leftLeg = new THREE.Mesh(legGeo, sharedMats.ziplinePylonPost);
  leftLeg.position.set(-1.35, pylonH / 2, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, sharedMats.ziplinePylonPost);
  rightLeg.position.set(1.35, pylonH / 2, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  const baseGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.45, 16);
  const bLeft = new THREE.Mesh(baseGeo, sharedMats.ziplinePylonTrim);
  bLeft.position.set(-1.35, 0.22, 0);
  group.add(bLeft);
  const bRight = bLeft.clone();
  bRight.position.x = 1.35;
  group.add(bRight);

  const topBarGeo = new THREE.CylinderGeometry(0.18, 0.18, 3.2, 16);
  topBarGeo.rotateZ(Math.PI / 2);
  const topBar = new THREE.Mesh(topBarGeo, sharedMats.ziplinePylonTrim);
  topBar.position.set(0, pylonH - 0.08, 0);
  group.add(topBar);

  const midBarGeo = new THREE.CylinderGeometry(0.10, 0.10, 2.7, 12);
  midBarGeo.rotateZ(Math.PI / 2);
  const midBar = new THREE.Mesh(midBarGeo, sharedMats.ziplinePylonPost);
  midBar.position.set(0, pylonH * 0.42, 0);
  group.add(midBar);

  const pulleyBoxGeo = new THREE.BoxGeometry(0.60, 0.45, 0.60);
  const pulleyBox = new THREE.Mesh(pulleyBoxGeo, sharedMats.ziplineTrolley);
  pulleyBox.position.set(0, pylonH - 0.15, 0);
  group.add(pulleyBox);

  const ringDecoGeo = new THREE.TorusGeometry(0.24, 0.06, 12, 24);
  const ringDeco = new THREE.Mesh(ringDecoGeo, sharedMats.ziplinePylonTrim);
  ringDeco.position.set(0, pylonH - 0.15, 0.32);
  group.add(ringDeco);

  group.position.set(x, y, z);
  return group;
}

export function createCloudMesh() {
  const cloud = new THREE.Group();
  const p1 = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 12), sharedMats.cloud);
  p1.scale.set(1.4, 0.8, 1.0);
  cloud.add(p1);

  const p2 = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 12), sharedMats.cloud);
  p2.position.set(1.4, 0.2, 0);
  p2.scale.set(1.1, 0.9, 0.9);
  cloud.add(p2);

  const p3 = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 12), sharedMats.cloud);
  p3.position.set(-1.3, -0.1, 0.2);
  p3.scale.set(1.0, 0.7, 0.9);
  cloud.add(p3);

  return cloud;
}

export function createOceanIsletMesh(scale = 1.0, type = 'tropical') {
  const group = new THREE.Group();

  const sandR = (4.0 + Math.random() * 2.0) * scale;
  const sandGeo = new THREE.CylinderGeometry(sandR * 0.9, sandR, 0.8, 14);
  const sandMesh = new THREE.Mesh(sandGeo, sharedMats.oceanSand);
  sandMesh.position.y = 0.35;
  sandMesh.receiveShadow = false;
  group.add(sandMesh);

  const grassR = sandR * 0.62;
  const grassGeo = new THREE.CylinderGeometry(grassR * 0.8, grassR, 0.55, 12);
  const grassMesh = new THREE.Mesh(grassGeo, sharedMats.oceanGrass);
  grassMesh.position.y = 0.85;
  grassMesh.receiveShadow = false;
  group.add(grassMesh);

  if (type === 'tropical') {
    const trunkH = (3.2 + Math.random() * 1.5) * scale;
    const trunkGeo = new THREE.CylinderGeometry(0.18 * scale, 0.28 * scale, trunkH, 6);
    const trunk = new THREE.Mesh(trunkGeo, sharedMats.oceanPalmTrunk);
    trunk.position.set(0.4 * scale, 1.0 + trunkH / 2, 0.3 * scale);
    trunk.rotation.z = 0.12;
    group.add(trunk);

    const topY = 1.0 + trunkH;
    for (let a = 0; a < 5; a++) {
      const leafAng = (a * Math.PI * 2) / 5;
      const leafGeo = new THREE.BoxGeometry(2.0 * scale, 0.15 * scale, 0.55 * scale);
      const leaf = new THREE.Mesh(leafGeo, sharedMats.oceanPalmLeaf);
      leaf.position.set(
        0.4 * scale + Math.cos(leafAng) * 0.85 * scale,
        topY - 0.2,
        0.3 * scale + Math.sin(leafAng) * 0.85 * scale
      );
      leaf.rotation.y = leafAng;
      leaf.rotation.z = 0.35;
      group.add(leaf);
    }
  } else {
    const rockGeo = new THREE.DodecahedronGeometry(1.3 * scale, 0);
    const rock = new THREE.Mesh(rockGeo, sharedMats.oceanRock);
    rock.position.set(0.2 * scale, 1.2 * scale, 0.2 * scale);
    rock.rotation.set(0.4, 0.6, 0.2);
    group.add(rock);

    const subRock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8 * scale, 0), sharedMats.oceanRock);
    subRock.position.set(-1.2 * scale, 0.8 * scale, 0.5 * scale);
    group.add(subRock);
  }

  return group;
}

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
  border.position.set(0, y, z);
  group.add(border);

  return group;
}

export function spawnItem(scene, stageIdx, type = 'speed') {
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return;

  const minClearanceSq = 1.6 * 1.6;
  let validPos = null;
  let attempts = 0;
  const stageBlocks = getFloorBlocksForStage(stageIdx);

  while (attempts < 20) {
    const r = Math.sqrt(Math.random()) * (stageInfo.r - 2.8);
    const theta = Math.random() * Math.PI * 2;
    const candX = Math.cos(theta) * r;
    const candZ = stageInfo.z + Math.sin(theta) * r;

    let isOverlapping = false;
    for (let i = 0; i < stageBlocks.length; i++) {
      const b = stageBlocks[i];
      if (b.active) {
        const dx = b.pos.x - candX;
        const dz = b.pos.z - candZ;
        if (dx * dx + dz * dz < minClearanceSq) {
          isOverlapping = true;
          break;
        }
      }
    }
    if (!isOverlapping) {
      validPos = { x: candX, z: candZ };
      break;
    }
    attempts++;
  }
  if (!validPos) return;

  const itemGroup = new THREE.Group();
  let crystalMat, ringMat;
  let crystalGeoToUse = itemCrystalGeo;

  if (type === 'attack') {
    crystalMat = sharedMats.itemAttackCrystal;
    ringMat = sharedMats.itemAttackBeaconRing;
    crystalGeoToUse = itemCrystalGeo;
  } else if (type === 'magnet') {
    crystalMat = sharedMats.itemMagnetCrystal;
    ringMat = sharedMats.itemMagnetBeaconRing;
    crystalGeoToUse = itemMagnetGeo;
  } else {
    crystalMat = sharedMats.itemCrystal;
    ringMat = sharedMats.itemBeaconRing;
    crystalGeoToUse = itemSpeedGeo;
  }

  const crystal = new THREE.Mesh(crystalGeoToUse, crystalMat);
  crystal.position.y = 1.35;
  if (type === 'magnet') {
    crystal.rotation.x = -Math.PI / 2;
  }
  crystal.castShadow = true;
  itemGroup.add(crystal);

  const beaconRing = new THREE.Mesh(itemBeaconRingGeo, ringMat);
  beaconRing.position.y = 0.04;
  itemGroup.add(beaconRing);

  itemGroup.position.set(validPos.x, stageInfo.y, validPos.z);
  scene.add(itemGroup);

  floorItems.push({
    group: itemGroup,
    crystal: crystal,
    beaconRing: beaconRing,
    mesh: itemGroup,
    type: type,
    pos: itemGroup.position,
    active: true,
    stageIdx: stageIdx,
    baseY: stageInfo.y
  });
}

export function spawnGatesOnIsland(scene, stageIdx, islandZ, islandY) {
  if (stageIdx % 2 !== 1) return;

  const gateZ = islandZ - 1.2;
  const playerCount = player ? player.stackCount : 0;
  let p;

  if (playerCount >= 51) {
    const cautionPatterns = [
      { left: { op: 'add', val: 4, label: '+4' }, right: { op: 'divide', val: 2, label: '÷2' } },
      { left: { op: 'divide', val: 2, label: '÷2' }, right: { op: 'add', val: 6, label: '+6' } },
      { left: { op: 'subtract', val: 6, label: '-6' }, right: { op: 'add', val: 4, label: '+4' } },
      { left: { op: 'add', val: 6, label: '+6' }, right: { op: 'subtract', val: 8, label: '-8' } },
      { left: { op: 'divide', val: 2, label: '÷2' }, right: { op: 'subtract', val: 4, label: '-4' } }
    ];
    p = cautionPatterns[Math.floor(Math.random() * cautionPatterns.length)];
  } else if (playerCount >= 26) {
    if (Math.random() < 0.15) {
      if (Math.random() < 0.5) {
        p = { left: { op: 'multiply', val: 2, label: '×2' }, right: { op: 'divide', val: 2, label: '÷2' } };
      } else {
        p = { left: { op: 'divide', val: 2, label: '÷2' }, right: { op: 'multiply', val: 2, label: '×2' } };
      }
    } else {
      const stablePatterns = [
        { left: { op: 'add', val: 6, label: '+6' }, right: { op: 'subtract', val: 4, label: '-4' } },
        { left: { op: 'subtract', val: 6, label: '-6' }, right: { op: 'add', val: 6, label: '+6' } },
        { left: { op: 'add', val: 4, label: '+4' }, right: { op: 'subtract', val: 4, label: '-4' } },
        { left: { op: 'add', val: 6, label: '+6' }, right: { op: 'add', val: 4, label: '+4' } }
      ];
      p = stablePatterns[Math.floor(Math.random() * stablePatterns.length)];
    }
  } else {
    if (Math.random() < 0.05) {
      if (Math.random() < 0.5) {
        p = { left: { op: 'multiply', val: 2, label: '×2' }, right: { op: 'subtract', val: 4, label: '-4' } };
      } else {
        p = { left: { op: 'add', val: 4, label: '+4' }, right: { op: 'multiply', val: 2, label: '×2' } };
      }
    } else {
      const boostPatterns = [
        { left: { op: 'add', val: 6, label: '+6' }, right: { op: 'add', val: 4, label: '+4' } },
        { left: { op: 'add', val: 8, label: '+8' }, right: { op: 'subtract', val: 4, label: '-4' } },
        { left: { op: 'subtract', val: 4, label: '-4' }, right: { op: 'add', val: 6, label: '+6' } },
        { left: { op: 'add', val: 4, label: '+4' }, right: { op: 'subtract', val: 2, label: '-2' } }
      ];
      p = boostPatterns[Math.floor(Math.random() * boostPatterns.length)];
    }
  }

  createModifierGate(scene, stageIdx, -3.2, gateZ, islandY, p.left.op, p.left.val, p.left.label);
  createModifierGate(scene, stageIdx, 3.2, gateZ, islandY, p.right.op, p.right.val, p.right.label);
}

export function createBridgeLinks(scene, stageIdx, nextStageIdx, prevIslandZ, nextIslandZ, prevR, nextR, startY, endY, type) {
  // スカイダイブ（頭先行・カタパルト台・前方放物線）
  if (type === 'skydive') {
    const startZ = prevIslandZ - prevR + 1.2;
    const endZ = nextIslandZ + nextR - 1.2;

    const catapult = createSkydiveCatapultStructure(scene, 0, startY, startZ);

    const skydiveBridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [],
      visualMeshes: [catapult.group],
      startZ, endZ, startY, endY,
      launchPoint: catapult.launchPoint,
      isSkydive: true, isTrapdoor: false, isElevator: false, isZipline: false,
      isCurvedSlide: false, isSlide: false, isJump: false, isVertical: false
    };

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(skydiveBridge);
    bridges.push(skydiveBridge);
    return;
  }

  // ★ ドロップタワー（足先行・真下の着地デッキへ完全垂直落下）
  if (type === 'trapdoor' || type === 'freefall') {
    const approachStartZ = prevIslandZ - prevR + 1.2;
    // ハッチの位置を着地デッキの真上（endZ）に配置し、水平スライドを0にして真下へ一直線に落とす
    const targetDropZ = nextIslandZ + nextR - 1.2;

    const hatch = createTrapdoorHatchStructure(scene, 0, startY, targetDropZ, approachStartZ);

    // ★ 修正：真下の着地点（下層島）のターゲット着地デッキ（白スチールリム＋シアンインジケーター）
    // 開口部から下を見下ろした時に、着地点が遠くからでもクッキリと識別できます
    const landingPad = new THREE.Group();
    const landingRimGeo = new THREE.TorusGeometry(2.4, 0.08, 8, 32);
    landingRimGeo.rotateX(Math.PI / 2);
    const landingRim = new THREE.Mesh(landingRimGeo, sharedMats.dropPylonSteel);
    landingRim.position.set(0, endY + 0.08, targetDropZ);
    landingPad.add(landingRim);

    const landingRingGeo = new THREE.RingGeometry(1.6, 2.2, 32);
    landingRingGeo.rotateX(-Math.PI / 2);
    const landingRing = new THREE.Mesh(landingRingGeo, sharedMats.dropIndicatorNeon);
    landingRing.position.set(0, endY + 0.09, targetDropZ);
    landingPad.add(landingRing);

    scene.add(landingPad);

    const trapdoorBridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [],
      visualMeshes: [hatch.group, landingPad],
      startZ: targetDropZ, // ★ 落下開始Zと着地Zを同一にして純粋な垂直落下を実現
      endZ: targetDropZ,
      approachStartZ: approachStartZ,
      startY, endY,
      hatchCenter: hatch.hatchCenter,
      doorLeftPivot: hatch.doorLeftPivot,
      doorRightPivot: hatch.doorRightPivot,
      hatchOpenProgress: 0,
      isHatchOpen: false,
      isSkydive: false, isTrapdoor: true, isElevator: false, isZipline: false,
      isCurvedSlide: false, isSlide: false, isJump: false, isVertical: false
    };

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(trapdoorBridge);
    bridges.push(trapdoorBridge);
    return;
  }

  // エレベーター（オープン展望ホバーリフト）
  if (type === 'elevator') {
    const startZ = prevIslandZ - prevR + 1.2;
    const endZ = nextIslandZ + nextR - 1.2;

    const elevatorBridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [], visualMeshes: [],
      startZ, endZ, startY, endY,
      isSkydive: false, isTrapdoor: false, isElevator: true, isZipline: false,
      isCurvedSlide: false, isSlide: false, isJump: false, isVertical: false,
      elevators: []
    };

    // ★ 修正：毎回同じ「緑・黄・赤」固定を廃止し、生成ごとに3レーンの速度属性をランダムシャッフル
    const shuffledLanes = ELEVATOR_CONFIG.LANES.map((cfg, idx) => ({ ...cfg, laneIdx: idx }));
    for (let i = shuffledLanes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tempTier = shuffledLanes[i].speedTier;
      const tempDur = shuffledLanes[i].duration;
      const tempLabel = shuffledLanes[i].label;
      shuffledLanes[i].speedTier = shuffledLanes[j].speedTier;
      shuffledLanes[i].duration = shuffledLanes[j].duration;
      shuffledLanes[i].label = shuffledLanes[j].label;
      shuffledLanes[j].speedTier = tempTier;
      shuffledLanes[j].duration = tempDur;
      shuffledLanes[j].label = tempLabel;
    }

    shuffledLanes.forEach(cfg => {
      const laneX = LANES[cfg.laneIdx];
      const stationMesh = createElevatorStationStructure(scene, laneX, startY, startZ, endY, endZ, cfg);
      elevatorBridge.visualMeshes.push(stationMesh);

      elevatorBridge.elevators.push({
        laneIdx: cfg.laneIdx,
        duration: cfg.duration,
        speedTier: cfg.speedTier,
        label: cfg.label
      });
    });

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(elevatorBridge);
    bridges.push(elevatorBridge);
    return;
  }

  if (type === 'zipline') {
    const startZ = prevIslandZ - prevR + 1.2;
    const endZ = nextIslandZ + nextR - 1.2;
    const departureTopY = startY + 5.5;
    const arrivalTopY = endY + 4.5;

    const depPylon = createZiplinePylonMesh(0, startY, startZ, departureTopY, true);
    scene.add(depPylon);
    const arrPylon = createZiplinePylonMesh(0, endY, endZ, arrivalTopY, false);
    scene.add(arrPylon);

    const startPt = new THREE.Vector3(0, departureTopY - 0.2, startZ);
    const endPt = new THREE.Vector3(0, arrivalTopY - 0.2, endZ);
    const cableVec = new THREE.Vector3().subVectors(endPt, startPt);
    const cableLen = cableVec.length();

    const cableGeo = new THREE.CylinderGeometry(0.042, 0.042, cableLen, 8);
    const cableMesh = new THREE.Mesh(cableGeo, sharedMats.ziplineCable);
    const midPt = new THREE.Vector3().addVectors(startPt, endPt).multiplyScalar(0.5);
    cableMesh.position.copy(midPt);
    cableMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cableVec.clone().normalize());
    scene.add(cableMesh);

    const stationTrolley = createZiplineTrolleyMesh();
    stationTrolley.position.copy(startPt);
    scene.add(stationTrolley);

    const ziplineBridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [],
      visualMeshes: [depPylon, arrPylon, cableMesh, stationTrolley],
      startZ, endZ, startPt, endPt, cableLen,
      isSkydive: false, isTrapdoor: false, isElevator: false, isZipline: true,
      isCurvedSlide: false, isSlide: false, isJump: false, isVertical: false,
      bonusBlocks: []
    };

    const numZiplineBlocks = 6;
    for (let zi = 0; zi < numZiplineBlocks; zi++) {
      const t = 0.20 + (zi / (numZiplineBlocks - 1)) * 0.62;
      const bPos = new THREE.Vector3().lerpVectors(startPt, endPt, t);
      bPos.y -= 1.80;
      bPos.x += Math.sin(zi * 2.2) * 0.35;

      const bMesh = new THREE.Mesh(blockGeometry, sharedMats.blockNeutral);
      bMesh.position.copy(bPos);
      scene.add(bMesh);

      const bonusData = {
        mesh: bMesh,
        t: t,
        baseY: bPos.y,
        zi: zi,
        collected: false,
        stageIdx: stageIdx
      };
      ziplineBridge.bonusBlocks.push(bonusData);
      ziplineBonusBlocks.push(bonusData);
    }

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(ziplineBridge);
    bridges.push(ziplineBridge);
    return;
  }

  if (type === 'curved_slide') {
    const startZ = prevIslandZ - prevR + 1.2;
    const endZ = nextIslandZ + nextR - 1.2;
    const distZ = startZ - endZ;
    const dropY = startY - endY;
    const sDir = (stageIdx % 2 === 0 ? 1 : -1);

    const p0 = new THREE.Vector3(0, startY + 0.15, startZ);
    const p1 = new THREE.Vector3(sDir * 7.5, startY - dropY * 0.28, startZ - distZ * 0.28);
    const p2 = new THREE.Vector3(-sDir * 5.8, startY - dropY * 0.72, startZ - distZ * 0.72);
    const p3 = new THREE.Vector3(0, endY + 0.15, endZ);
    const spline = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);

    const steps = 55;
    const points = spline.getPoints(steps);
    const curveLength = spline.getLength();

    const posArr = [];
    const normArr = [];
    const idxArr = [];
    const leftRailPts = [];
    const rightRailPts = [];

    const profile = [
      { x: -2.4, y: 0.85 },
      { x: -2.0, y: 0.0 },
      { x: 2.0, y: 0.0 },
      { x: 2.4, y: 0.85 }
    ];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const center = points[i];
      const tangent = spline.getTangent(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      profile.forEach(p => {
        const vx = center.x + normal.x * p.x;
        const vy = center.y + p.y;
        const vz = center.z + normal.z * p.x;
        posArr.push(vx, vy, vz);
        normArr.push(0, 1, 0);
      });

      leftRailPts.push(new THREE.Vector3(center.x - normal.x * 2.4, center.y + 0.85, center.z - normal.z * 2.4));
      rightRailPts.push(new THREE.Vector3(center.x + normal.x * 2.4, center.y + 0.85, center.z + normal.z * 2.4));
    }

    for (let i = 0; i < steps; i++) {
      for (let j = 0; j < 3; j++) {
        const a = i * 4 + j;
        const b = (i + 1) * 4 + j;
        const c = (i + 1) * 4 + (j + 1);
        const d = i * 4 + (j + 1);
        idxArr.push(a, b, d);
        idxArr.push(b, c, d);
      }
    }

    const troughGeo = new THREE.BufferGeometry();
    troughGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    troughGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normArr, 3));
    troughGeo.setIndex(idxArr);
    troughGeo.computeVertexNormals();

    const troughMesh = new THREE.Mesh(troughGeo, sharedMats.slideSurface);
    troughMesh.receiveShadow = true;
    scene.add(troughMesh);

    const leftRailCurve = new THREE.CatmullRomCurve3(leftRailPts);
    const rightRailCurve = new THREE.CatmullRomCurve3(rightRailPts);
    const railGeoLeft = new THREE.TubeGeometry(leftRailCurve, 50, 0.18, 8, false);
    const railGeoRight = new THREE.TubeGeometry(rightRailCurve, 50, 0.18, 8, false);

    const leftRailMesh = new THREE.Mesh(railGeoLeft, sharedMats.slideRail);
    const rightRailMesh = new THREE.Mesh(railGeoRight, sharedMats.slideRail);
    scene.add(leftRailMesh);
    scene.add(rightRailMesh);

    const lutSamples = [];
    const lutResolution = 100;
    for (let li = 0; li <= lutResolution; li++) {
      const lt = li / lutResolution;
      const lPt = spline.getPointAt(lt);
      const lTangent = spline.getTangentAt(lt).normalize();
      const lNormal = new THREE.Vector3(-lTangent.z, 0, lTangent.x).normalize();
      lutSamples.push({
        x: lPt.x, y: lPt.y, z: lPt.z,
        nx: lNormal.x, ny: 0, nz: lNormal.z,
        tx: lTangent.x, ty: lTangent.y, tz: lTangent.z
      });
    }

    const curvedBridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [],
      visualMeshes: [troughMesh, leftRailMesh, rightRailMesh],
      startZ, endZ,
      isSkydive: false, isTrapdoor: false, isElevator: false, isZipline: false,
      isCurvedSlide: true, isSlide: false, isJump: false, isVertical: false,
      curve: spline, curveLength: curveLength,
      lutSamples: lutSamples,
      bonusBlocks: []
    };

    const numBonuses = 8;
    for (let bi = 0; bi < numBonuses; bi++) {
      const t = 0.22 + (bi / (numBonuses - 1)) * 0.58;
      const pt = spline.getPointAt(t);
      const tangent = spline.getTangentAt(t).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      const offsetVal = Math.sin(bi * 1.55) * 1.1;
      const bPos = pt.clone().addScaledVector(normal, offsetVal);
      bPos.y += 0.42;

      const bMesh = new THREE.Mesh(blockGeometry, sharedMats.blockNeutral);
      bMesh.position.copy(bPos);
      scene.add(bMesh);

      const bonusData = {
        mesh: bMesh,
        t: t,
        offset: offsetVal,
        collected: false,
        stageIdx: stageIdx
      };
      curvedBridge.bonusBlocks.push(bonusData);
      curvedSlideBonusBlocks.push(bonusData);
    }

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(curvedBridge);
    bridges.push(curvedBridge);
    return;
  }

  const isJump = (type === 'jump');
  const isSlide = (type === 'slide');
  const isVertical = (type === 'vertical');

  let jumpTiers = [];
  if (isJump) {
    jumpTiers = [TRAMPOLINE_TIERS.normal, TRAMPOLINE_TIERS.high, TRAMPOLINE_TIERS.mega];
    for (let i = jumpTiers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jumpTiers[i], jumpTiers[j]] = [jumpTiers[j], jumpTiers[i]];
    }
  }

  for (let laneIdx = 0; laneIdx < 3; laneIdx++) {
    const laneX = LANES[laneIdx];
    const prevInsetZ = Math.sqrt(Math.max(1, prevR * prevR - laneX * laneX));
    const nextInsetZ = Math.sqrt(Math.max(1, nextR * nextR - laneX * laneX));
    const startZ = prevIslandZ - prevInsetZ + 1.2;
    const endZ = nextIslandZ + nextInsetZ - 1.2;
    const distZ = startZ - endZ;

    const dist3D = Math.hypot(distZ, endY - startY);
    const numPlanks = isJump ? 1 : Math.max(12, Math.floor(dist3D / (PLANK_LENGTH * 0.75)));

    const bridge = {
      stageIdx, nextStageIdx, laneIdx, planks: [], visualMeshes: [],
      startZ, endZ, isJump, isSlide, isVertical,
      isSkydive: false, isTrapdoor: false, isCurvedSlide: false, isZipline: false, isElevator: false,
      ghostMesh: null, solidMesh: null
    };

    if (isSlide) {
      const slopeLength = Math.hypot(distZ, endY - startY) + 2.0;
      const slopeGeo = new THREE.BoxGeometry(3.6, 0.4, slopeLength);
      const slopeMesh = new THREE.Mesh(slopeGeo, sharedMats.slideSurface);

      const midZ = (startZ + endZ) / 2;
      const midY = (startY + endY) / 2;
      slopeMesh.position.set(LANES[laneIdx], midY - 0.1, midZ);
      const angleX = Math.atan2(endY - startY, startZ - endZ);
      slopeMesh.rotation.x = angleX;
      slopeMesh.receiveShadow = true;
      scene.add(slopeMesh);
      bridge.visualMeshes.push(slopeMesh);

      // ★ 修正：レーンごとに両側にパイプを作ると中間に重複して密集するため、
      // 最左端（レーン0の左）と最右端（レーン2の右）のみに外枠レールを配置し、余計な仕切りを全廃
      const railGeo = new THREE.CylinderGeometry(0.15, 0.15, slopeLength, 8);
      railGeo.rotateX(Math.PI / 2);

      if (laneIdx === 0) {
        const leftRail = new THREE.Mesh(railGeo, sharedMats.slideRail);
        leftRail.position.set(LANES[laneIdx] - 1.85, midY + 0.3, midZ);
        leftRail.rotation.x = angleX;
        scene.add(leftRail);
        bridge.visualMeshes.push(leftRail);
      }

      if (laneIdx === 2) {
        const rightRail = new THREE.Mesh(railGeo, sharedMats.slideRail);
        rightRail.position.set(LANES[laneIdx] + 1.85, midY + 0.3, midZ);
        rightRail.rotation.x = angleX;
        scene.add(rightRail);
        bridge.visualMeshes.push(rightRail);
      }

      for (let i = 0; i < numPlanks; i++) {
        const progress = (i + 0.5) / numPlanks;
        const pZ = startZ - progress * distZ;
        const pY = startY + progress * (endY - startY);
        bridge.planks.push({ teamId: 'slide_free', index: i, y: pY, z: pZ });
      }
    } else if (isJump) {
      let jumpTier = jumpTiers[laneIdx];

      const tramp = createTrampolineMesh(LANES[laneIdx], startY, startZ - 1.8, jumpTier);
      scene.add(tramp.group);
      bridge.visualMeshes.push(tramp.group);
      bridge.planks.push({
        mesh: tramp.group,
        netMesh: tramp.net,
        teamId: 'neutral',
        index: 0,
        y: startY + 0.52,
        z: startZ - 1.8,
        isJumpPad: true,
        jumpTier: jumpTier
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
        const pY = startY + progress * (endY - startY);

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

      scene.add(ghostMesh);
      scene.add(solidMesh);
      bridge.ghostMesh = ghostMesh;
      bridge.solidMesh = solidMesh;
      bridge.visualMeshes.push(ghostMesh, solidMesh);
    }

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(bridge);
    bridges.push(bridge);
  }
}

export function extendCourse(scene) {
  const idx = STAGES.length;
  const prev = STAGES[idx - 1];
  let type, nextY, r, distZ;

  if (idx === 1) {
    type = 'bridge';
    nextY = prev.y + 7.0;
    distZ = 34;
    r = 10;
  } else if (idx === 2) {
    type = 'jump';
    nextY = prev.y + 1.0;
    distZ = 30;
    r = 9.5;
  } else if (idx === 3) {
    // 序盤のStage 3に直線スライダーを配置してシンプル＆爽快な滑走を早期体験
    type = 'slide';
    nextY = Math.max(5.0, prev.y - 8.5);
    distZ = 42;
    r = 11;
  } else if (idx === 4) {
    type = 'vertical';
    nextY = prev.y + 12.0;
    distZ = 24;
    r = 10;
  } else if (idx === 5) {
    type = 'zipline';
    nextY = Math.max(7.0, prev.y - 10.5);
    distZ = 68;
    r = 10.5;
  } else {
    // ★ シャッフルバッグ方式により、全ギミックが均等周期で選出され重複・偏りを完全根絶
    if (prev.y >= 14.0) {
      type = getNextDescentGimmick();
      if (type === 'slide') {
        nextY = Math.max(5.0, prev.y - 10.0);
        distZ = 42;
        r = 11;
      } else if (type === 'skydive') {
        nextY = Math.max(5.0, prev.y - SKYDIVE_CONFIG.PHYSICS.minHeightDrop);
        distZ = SKYDIVE_CONFIG.PHYSICS.forwardDistance;
        r = 11.5;
      } else if (type === 'trapdoor') {
        nextY = Math.max(5.0, prev.y - TRAPDOOR_CONFIG.PHYSICS.minHeightDrop);
        distZ = 36.0;
        r = 12.0;
      } else if (type === 'curved_slide') {
        nextY = Math.max(6.0, prev.y - 8.0);
        distZ = 46;
        r = 11;
      } else { // 'zipline'
        nextY = Math.max(7.0, prev.y - 12.0);
        distZ = 68;
        r = 10.5;
      }
    } else {
      type = getNextAscentGimmick();
      if (type === 'elevator') {
        nextY = prev.y + 16.0;
        distZ = 30;
        r = 11;
      } else if (type === 'vertical') {
        nextY = prev.y + 11.0;
        distZ = 24;
        r = 10;
      } else if (type === 'jump') {
        nextY = prev.y + 1.0;
        distZ = 30;
        r = 9.5;
      } else { // 'bridge'
        nextY = prev.y + 7.0;
        distZ = 34;
        r = 10;
      }
    }
  }

  nextY = Math.max(5.0, nextY);
  const nextZ = prev.z - distZ;
  const stageInfo = { z: nextZ, y: nextY, r: r, type: type };
  STAGES.push(stageInfo);

  const islandMeshGroup = createIslandMesh(r, nextY, nextZ);
  scene.add(islandMeshGroup);
  stageMeshes.push({ meshGroup: islandMeshGroup, stageIdx: idx });

  CONNECTIONS.push({ from: idx - 1, to: idx, type: type });
  createBridgeLinks(scene, idx - 1, idx, prev.z, nextZ, prev.r, r, prev.y, nextY, type);

  if (idx >= 1) {
    spawnGatesOnIsland(scene, idx, nextZ, nextY);

    speedItemIslandCounter++;
    let shouldSpawnItem = false;
    if (idx === 1 || speedItemIslandCounter >= 3) {
      shouldSpawnItem = true;
      speedItemIslandCounter = 0;
    } else if (speedItemIslandCounter >= 2 && Math.random() < 0.65) {
      shouldSpawnItem = true;
      speedItemIslandCounter = 0;
    }

    if (shouldSpawnItem) {
      const typeToSpawn = ITEM_ROTATION[itemRotationIndex % ITEM_ROTATION.length];
      itemRotationIndex++;
      spawnItem(scene, idx, typeToSpawn);
    }
  }

  if (idx % 2 === 0) {
    const cloudSide = (idx % 4 === 0) ? 1 : -1;
    const cloudMesh = createCloudMesh();
    const cloudX = cloudSide * (16 + Math.random() * 8);
    const cloudY = (prev.y + nextY) / 2 + (Math.random() * 4 - 2);
    const cloudZ = (prev.z + nextZ) / 2;
    cloudMesh.position.set(cloudX, cloudY, cloudZ);
    scene.add(cloudMesh);
    cloudObjects.push({ mesh: cloudMesh, stageIdx: idx, baseY: cloudY, offset: Math.random() * 10 });
  }

  [-1, 1].forEach(side => {
    if (Math.random() < 0.65) {
      const isletMesh = createOceanIsletMesh(
        0.8 + Math.random() * 0.7,
        Math.random() < 0.6 ? 'tropical' : 'rocky'
      );
      const isletX = side * (26 + Math.random() * 16);
      const isletZ = nextZ + (Math.random() * 14 - 7);
      isletMesh.position.set(isletX, -42, isletZ);
      scene.add(isletMesh);
      oceanIslands.push({ meshGroup: isletMesh, stageIdx: idx });
    }
  });
}

export function buildWorld(scene) {
  descentBag.length = 0;
  ascentBag.length = 0;
  lastGimmickType = null;

  floorBlocksByStage.forEach(bucket => {
    bucket.forEach(b => {
      b.active = false;
      b.mesh.visible = false;
      b.attracting = false;
      b.mesh.rotation.set(0, 0, 0); // 角度を確実にリセット
    });
  });
  floorBlocksByStage.clear();
  bridgesByStage.clear();

  stageMeshes.forEach(m => {
    disposeHierarchy(m.meshGroup);
    scene.remove(m.meshGroup);
  });
  bridges.forEach(b => {
    b.visualMeshes.forEach(vm => {
      disposeHierarchy(vm);
      scene.remove(vm);
    });
  });
  modifierGates.forEach(g => {
    disposeHierarchy(g.meshGroup);
    scene.remove(g.meshGroup);
  });
  cloudObjects.forEach(c => {
    disposeHierarchy(c.mesh);
    scene.remove(c.mesh);
  });
  oceanIslands.forEach(oi => {
    disposeHierarchy(oi.meshGroup);
    scene.remove(oi.meshGroup);
  });
  if (seaMesh) {
    disposeHierarchy(seaMesh);
    scene.remove(seaMesh);
  }
  curvedSlideBonusBlocks.forEach(b => {
    if (b.mesh) {
      disposeHierarchy(b.mesh);
      scene.remove(b.mesh);
    }
  });
  ziplineBonusBlocks.forEach(b => {
    if (b.mesh) {
      disposeHierarchy(b.mesh);
      scene.remove(b.mesh);
    }
  });
  floorItems.forEach(item => {
    if (item.group) {
      disposeHierarchy(item.group);
      scene.remove(item.group);
    }
  });

  activeMagnetBlocks.forEach(mb => {
    if (mb.poolItem) {
      mb.poolItem.active = false;
      mb.poolItem.mesh.visible = false;
      mb.poolItem.attracting = false;
      mb.poolItem.mesh.rotation.set(0, 0, 0); // 角度を確実にリセット
    }
  });
  resetParticlePools();

  activeMagnetBlocks.length = 0;
  magnetDockStepCounter = 0;
  attackCamTimer = 0;
  floorItems.length = 0;
  modifierGates.length = 0;
  bridges.length = 0;
  stageMeshes.length = 0;
  cloudObjects.length = 0;
  oceanIslands.length = 0;
  curvedSlideBonusBlocks.length = 0;
  ziplineBonusBlocks.length = 0;
  speedItemIslandCounter = 0;
  itemRotationIndex = 0;

  STAGES.length = 0;
  STAGES.push({ z: 0, y: 0, r: 12 });

  scene.background = new THREE.Color(0x7dd3fc);
  scene.fog = new THREE.FogExp2(0x7dd3fc, 0.0032);

  const seaGeo = new THREE.PlaneGeometry(1600, 2400);
  seaMesh = new THREE.Mesh(seaGeo, sharedMats.sea);
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(0, -42, -500);
  seaMesh.receiveShadow = false;
  scene.add(seaMesh);

  const initialIslets = [
    { x: -30, z: -15, scale: 1.2, type: 'tropical' },
    { x: 32, z: 10, scale: 1.0, type: 'rocky' },
    { x: -28, z: 25, scale: 0.9, type: 'tropical' },
    { x: 34, z: -35, scale: 1.3, type: 'tropical' }
  ];
  initialIslets.forEach(cfg => {
    const islet = createOceanIsletMesh(cfg.scale, cfg.type);
    islet.position.set(cfg.x, -42, cfg.z);
    scene.add(islet);
    oceanIslands.push({ meshGroup: islet, stageIdx: 0 });
  });

  const startIslandGroup = createIslandMesh(12, 0, 0);
  scene.add(startIslandGroup);
  stageMeshes.push({ meshGroup: startIslandGroup, stageIdx: 0 });

  for (let i = 0; i < 6; i++) extendCourse(scene);
}

export function cleanupOldData(scene) {
  if (!player) return;
  const safeStage = Math.max(0, player.currentStage - 3);

  for (let i = activeMagnetBlocks.length - 1; i >= 0; i--) {
    const mb = activeMagnetBlocks[i];
    if (mb.targetChar && mb.targetChar.currentStage < safeStage) {
      if (mb.poolItem) {
        mb.poolItem.active = false;
        mb.poolItem.mesh.visible = false;
        mb.poolItem.attracting = false;
        mb.poolItem.mesh.rotation.set(0, 0, 0); // 角度を確実にリセット
      }
      activeMagnetBlocks.splice(i, 1);
    }
  }

  for (let i = stageMeshes.length - 1; i >= 0; i--) {
    if (stageMeshes[i].stageIdx < safeStage) {
      disposeHierarchy(stageMeshes[i].meshGroup);
      scene.remove(stageMeshes[i].meshGroup);
      stageMeshes.splice(i, 1);
    }
  }
  for (let i = bridges.length - 1; i >= 0; i--) {
    if (bridges[i].stageIdx < safeStage) {
      bridges[i].visualMeshes.forEach(vm => {
        disposeHierarchy(vm);
        scene.remove(vm);
      });
      bridges.splice(i, 1);
    }
  }

  for (let key of bridgesByStage.keys()) {
    if (key < safeStage) bridgesByStage.delete(key);
  }

  for (let i = CONNECTIONS.length - 1; i >= 0; i--) {
    if (CONNECTIONS[i].to < safeStage) {
      CONNECTIONS.splice(i, 1);
    }
  }
  for (let sIdx = 0; sIdx < safeStage - 1; sIdx++) {
    if (STAGES[sIdx] && STAGES[sIdx]._pruned !== true) {
      STAGES[sIdx]._pruned = true;
    }
  }

  floorBlocksByStage.forEach((bucket, stageKey) => {
    if (stageKey < safeStage) {
      bucket.forEach(b => {
        b.active = false;
        b.mesh.visible = false;
        b.attracting = false;
        b.mesh.rotation.set(0, 0, 0); // 角度を確実にリセット
      });
      floorBlocksByStage.delete(stageKey);
    }
  });

  for (let i = floorItems.length - 1; i >= 0; i--) {
    if (floorItems[i].stageIdx < safeStage) {
      if (floorItems[i].group) {
        disposeHierarchy(floorItems[i].group);
        scene.remove(floorItems[i].group);
      }
      floorItems.splice(i, 1);
    }
  }
  for (let i = modifierGates.length - 1; i >= 0; i--) {
    if (modifierGates[i].stageIdx < safeStage) {
      if (!modifierGates[i].consumed) {
        disposeHierarchy(modifierGates[i].meshGroup);
        scene.remove(modifierGates[i].meshGroup);
      }
      modifierGates.splice(i, 1);
    }
  }
  for (let i = cloudObjects.length - 1; i >= 0; i--) {
    if (cloudObjects[i].stageIdx < safeStage) {
      disposeHierarchy(cloudObjects[i].mesh);
      scene.remove(cloudObjects[i].mesh);
      cloudObjects.splice(i, 1);
    }
  }
  for (let i = oceanIslands.length - 1; i >= 0; i--) {
    if (oceanIslands[i].stageIdx < safeStage) {
      disposeHierarchy(oceanIslands[i].meshGroup);
      scene.remove(oceanIslands[i].meshGroup);
      oceanIslands.splice(i, 1);
    }
  }
  for (let i = curvedSlideBonusBlocks.length - 1; i >= 0; i--) {
    if (curvedSlideBonusBlocks[i].stageIdx < safeStage) {
      if (curvedSlideBonusBlocks[i].mesh) {
        disposeHierarchy(curvedSlideBonusBlocks[i].mesh);
        scene.remove(curvedSlideBonusBlocks[i].mesh);
      }
      curvedSlideBonusBlocks.splice(i, 1);
    }
  }
  for (let i = ziplineBonusBlocks.length - 1; i >= 0; i--) {
    if (ziplineBonusBlocks[i].stageIdx < safeStage) {
      if (ziplineBonusBlocks[i].mesh) {
        disposeHierarchy(ziplineBonusBlocks[i].mesh);
        scene.remove(ziplineBonusBlocks[i].mesh);
      }
      ziplineBonusBlocks.splice(i, 1);
    }
  }
}

export function spawnSingleBlock(scene, stageIdx, targetTeam = null) {
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return;

  const minClearanceSq = 1.35 * 1.35;
  let validPos = null;
  let attempts = 0;
  const stageBlocks = getFloorBlocksForStage(stageIdx);

  const stageBridges = bridgesByStage.get(stageIdx) || [];
  const skydiveB = stageBridges.find(b => b.isSkydive);
  const trapdoorB = stageBridges.find(b => b.isTrapdoor);
  const eleB = stageBridges.find(b => b.isElevator);

  while (attempts < 25) {
    const r = Math.sqrt(Math.random()) * (stageInfo.r - 2.2);
    const theta = Math.random() * Math.PI * 2;
    const candX = Math.cos(theta) * r;
    const candZ = stageInfo.z + Math.sin(theta) * r;

    // カタパルト台周辺（助走エリア）のブロック生成禁止
    if (skydiveB) {
      const dSkySq = candX * candX + (candZ - skydiveB.startZ) * (candZ - skydiveB.startZ);
      if (dSkySq < (SKYDIVE_CONFIG.CATAPULT.exclusionRadius * SKYDIVE_CONFIG.CATAPULT.exclusionRadius)) {
        attempts++;
        continue;
      }
    }

    // ドロップタワー・スカイゲート施設周辺のブロック生成禁止
    if (trapdoorB) {
      const dHatchSq = candX * candX + (candZ - trapdoorB.startZ) * (candZ - trapdoorB.startZ);
      if (dHatchSq < (TRAPDOOR_CONFIG.HATCH.exclusionRadius * TRAPDOOR_CONFIG.HATCH.exclusionRadius)) {
        attempts++;
        continue;
      }
    }

    // エレベーター乗り場デッキ周辺のブロック生成禁止
    if (eleB) {
      if (candZ < stageInfo.z - stageInfo.r * 0.45 && Math.abs(candX) < 5.5) {
        attempts++;
        continue;
      }
    }

    let isOverlapping = false;
    for (let i = 0; i < stageBlocks.length; i++) {
      const b = stageBlocks[i];
      if (b.active) {
        const dx = b.pos.x - candX;
        const dz = b.pos.z - candZ;
        if (dx * dx + dz * dz < minClearanceSq) {
          isOverlapping = true;
          break;
        }
      }
    }

    if (!isOverlapping) {
      validPos = { x: candX, z: candZ };
      break;
    }
    attempts++;
  }

  if (!validPos) return;

  let poolItem = floorBlockPool.find(b => !b.active);
  if (!poolItem) return;

  const team = targetTeam || BLOCK_TYPES[Math.floor(Math.random() * BLOCK_TYPES.length)];
  let mat;
  if (team.id === 'blue') mat = sharedMats.blockBlue;
  else if (team.id === 'red') mat = sharedMats.blockRed;
  else if (team.id === 'yellow') mat = sharedMats.blockYellow;
  else mat = sharedMats.blockNeutral;

  poolItem.mesh.material = mat;
  poolItem.mesh.position.set(validPos.x, stageInfo.y + 0.25, validPos.z);
  // ★ 修正：X/Z回転角を確実に0にリセットし、床に斜めに突き刺さる現象を完全根絶
  poolItem.mesh.rotation.set(0, Math.random() * Math.PI, 0);
  poolItem.mesh.visible = true;

  poolItem.active = true;
  poolItem.team = team;
  poolItem.pos = poolItem.mesh.position;
  poolItem.stageIdx = stageIdx;
  poolItem.attracting = false;

  stageBlocks.push(poolItem);
}

export function manageBlockSpawns(scene, isGameOver = false) {
  if (isGameOver) return;

  for (let cIdx = 0; cIdx < characters.length; cIdx++) {
    const s = characters[cIdx].currentStage;

    let alreadyChecked = false;
    for (let prevIdx = 0; prevIdx < cIdx; prevIdx++) {
      if (characters[prevIdx].currentStage === s) {
        alreadyChecked = true;
        break;
      }
    }
    if (alreadyChecked) continue;

    const stageBlocks = getFloorBlocksForStage(s);

    for (let tIdx = 0; tIdx < BLOCK_TYPES.length; tIdx++) {
      const team = BLOCK_TYPES[tIdx];
      const targetCount = (team.id === 'blue') ? 13 : 7;

      let currentCount = 0;
      for (let bIdx = 0; bIdx < stageBlocks.length; bIdx++) {
        const b = stageBlocks[bIdx];
        if (b.active && b.team.id === team.id) {
          currentCount++;
        }
      }

      for (let mIdx = 0; mIdx < activeMagnetBlocks.length; mIdx++) {
        const mb = activeMagnetBlocks[mIdx];
        if (mb.targetChar && mb.targetChar.currentStage === s && mb.team && mb.team.id === team.id) {
          currentCount++;
        }
      }

      if (currentCount < targetCount) {
        spawnSingleBlock(scene, s, team);
      }
    }
  }
}