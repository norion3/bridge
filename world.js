// world.js: コース伸長・浮島・橋・スライド・ジップライン・エレベーター・スカイダイブ・ドロップタワー施設・二股分岐＆合流・目鼻なし愛嬌お邪魔キャラ
// ★ Phase 1 実装版（二股分岐ステージ Fork Pattern B の完全決定論ハッシュ化 ＆ PRNG消費ゼロ）：
//   1. 【分岐ステージのPRNG履歴依存を完全撤廃】
//      extendCourseForkPatternB 内のテーマペア選択、左右テーマ割り当て、アイテム種別、
//      出口ギミック（スロープ vs スカイダイブ）に残存していた seededRandom() を全廃。
//      分岐ステージ番号 forkIdx から数学的固定ハッシュにより一意決定。
//   2. 【二股分岐島・合流島のアイテム＆ギミック完全一致】
//      左右の島に現れるクリスタルアイテムや出口アトラクションが両端末で100%確定一致。
//   3. 【幾何構造・通常ステージ・お掃除処理の完全維持】
//      決定論的コース形状生成、全アトラクション物理用データ構造、cleanupOldData は100%維持。

import {
  TRAMPOLINE_TIERS,
  LANES,
  PLANK_LENGTH,
  ELEVATOR_CONFIG,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import {
  sharedMats,
  blockGeometry,
  plankGeo,
  verticalPlankGeo,
  itemCrystalGeo,
  itemSpeedGeo,
  itemMagnetGeo,
  itemThunderGeo,
  itemBeaconRingGeo,
  COLOR_NEUTRAL_PLANK,
  disposeHierarchy
} from './materials.js';
import { resetParticlePools } from './particles.js';
import { createZiplineTrolleyMesh, characters, player } from './character.js';
import {
  createModifierGate,
  setModifierGatesReference,
  createTrampolineMesh,
  createElevatorStationStructure,
  createSkydiveCatapultStructure,
  createTrapdoorHatchStructure,
  createZiplinePylonMesh,
  createCloudMesh,
  createOceanIsletMesh,
  createIslandMesh,
  createObstacleMobMesh
} from './structures.js';
import {
  floorBlocksByStage,
  getFloorBlocksForStage,
  applyRemoteBlockSpawned,
  spawnSingleBlock,
  manageBlockSpawns
} from './blocks.js';

// 後方互換再エクスポート
export {
  createModifierGate,
  floorBlocksByStage,
  getFloorBlocksForStage,
  applyRemoteBlockSpawned,
  spawnSingleBlock,
  manageBlockSpawns
};

// 確定論的疑似乱数生成器（Mulberry32 PRNG）
export let currentWorldSeed = 12345678;
let _prngState = 12345678;

export function setWorldSeed(seed = null) {
  currentWorldSeed = (seed !== null && seed !== undefined) ? (seed >>> 0) : ((Math.random() * 0xFFFFFFFF) >>> 0);
  _prngState = currentWorldSeed;
  return currentWorldSeed;
}

export function seededRandom() {
  _prngState = (_prngState + 0x6D2B79F5) | 0;
  let t = Math.imul(_prngState ^ (_prngState >>> 15), 1 | _prngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

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
export const skydiveBonusBlocks = [];
export const slideBonusBlocks = [];
export const activeMagnetBlocks = [];
export const bridgesByStage = new Map();

// お邪魔キャラ管理配列 ＆ スマート・ディレクター用カウンター
export const obstacleMobs = [];
let stagesSinceLastObstacle = 0;

setModifierGatesReference(modifierGates);

const BASE_ITEMS = ['speed', 'attack', 'magnet', 'thunder'];

/**
 * ステージ番号固有の決定論的アイテム種別決定関数
 * 乱数消費履歴に一切依存せず、stageIdx と currentWorldSeed から数学的に一意決定
 */
export function getDeterministicItemType(stageIdx) {
  const hash = Math.imul(stageIdx ^ 0x5DEECE66, (currentWorldSeed + 37) | 1);
  const positiveHash = Math.abs(hash);
  return BASE_ITEMS[positiveHash % BASE_ITEMS.length];
}

export let magnetDockStepCounter = 0;
export let attackCamTimer = 0;

export function setAttackCamTimer(v) { attackCamTimer = v; }
export function decrementAttackCamTimer(dt) { attackCamTimer = Math.max(0, attackCamTimer - dt); }
export function incMagnetDockStep() { return magnetDockStepCounter++; }

const dummyPlankObj = new THREE.Object3D();

const DESCENT_GIMMICKS = ['slide', 'skydive', 'trapdoor', 'curved_slide', 'zipline'];
const ASCENT_GIMMICKS = ['elevator', 'vertical', 'jump', 'bridge'];
let descentBag = [];
let ascentBag = [];
let lastGimmickCategory = 'descent';
let lastMergeStageIdx = -1;

function getNextDescentGimmick() {
  if (descentBag.length === 0) {
    descentBag = [...DESCENT_GIMMICKS];
    for (let i = descentBag.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [descentBag[i], descentBag[j]] = [descentBag[j], descentBag[i]];
    }
  }
  return descentBag.pop();
}

function getNextAscentGimmick() {
  if (ascentBag.length === 0) {
    ascentBag = [...ASCENT_GIMMICKS];
    for (let i = ascentBag.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [ascentBag[i], ascentBag[j]] = [ascentBag[j], ascentBag[i]];
    }
  }
  return ascentBag.pop();
}

/**
 * 床アイテム生成の完全決定論化
 * PRNGの内部状態を消費せず、stageIdx 固有の固定幾何ハッシュで座標・種別を生成
 */
export function spawnItem(scene, stageIdx, forcedType = null) {
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo) return;

  const itemType = forcedType || getDeterministicItemType(stageIdx);
  const centerX = stageInfo.x || 0.0;

  const angleSeed = ((stageIdx * 73 + 19) % 360) * (Math.PI / 180);
  const distRatio = 0.35 + (((stageIdx * 41 + 13) % 40) / 100);
  const candX = centerX + Math.cos(angleSeed) * (stageInfo.r * distRatio);
  const candZ = stageInfo.z + Math.sin(angleSeed) * (stageInfo.r * distRatio);

  const itemGroup = new THREE.Group();
  let crystalMat, ringMat;
  let crystalGeoToUse = itemCrystalGeo;

  if (itemType === 'attack') {
    crystalMat = sharedMats.itemAttackCrystal;
    ringMat = sharedMats.itemAttackBeaconRing;
    crystalGeoToUse = itemCrystalGeo;
  } else if (itemType === 'magnet') {
    crystalMat = sharedMats.itemMagnetCrystal;
    ringMat = sharedMats.itemMagnetBeaconRing;
    crystalGeoToUse = itemMagnetGeo;
  } else if (itemType === 'thunder') {
    crystalMat = sharedMats.itemThunderCrystal;
    ringMat = sharedMats.itemThunderBeaconRing;
    crystalGeoToUse = itemThunderGeo;
  } else {
    crystalMat = sharedMats.itemCrystal;
    ringMat = sharedMats.itemBeaconRing;
    crystalGeoToUse = itemSpeedGeo;
  }

  const crystal = new THREE.Mesh(crystalGeoToUse, crystalMat);
  crystal.position.y = 1.35;
  if (itemType === 'magnet') {
    crystal.rotation.x = -Math.PI / 2;
  }
  crystal.castShadow = true;
  itemGroup.add(crystal);

  const beaconRing = new THREE.Mesh(itemBeaconRingGeo, ringMat);
  beaconRing.position.y = 0.04;
  itemGroup.add(beaconRing);

  itemGroup.position.set(candX, stageInfo.y, candZ);
  scene.add(itemGroup);

  floorItems.push({
    group: itemGroup,
    crystal: crystal,
    beaconRing: beaconRing,
    mesh: itemGroup,
    type: itemType,
    pos: itemGroup.position,
    active: true,
    stageIdx: stageIdx,
    baseY: stageInfo.y,
    itemId: `item_${stageIdx}_${Math.round(candX * 100)}_${Math.round(candZ * 100)}`
  });
}

export function spawnGatesOnIsland(scene, stageIdx, islandZ, islandY, islandX = 0.0) {
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
    p = cautionPatterns[Math.floor(seededRandom() * cautionPatterns.length)];
  } else if (playerCount >= 26) {
    if (seededRandom() < 0.15) {
      if (seededRandom() < 0.5) {
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
      p = stablePatterns[Math.floor(seededRandom() * stablePatterns.length)];
    }
  } else {
    if (seededRandom() < 0.05) {
      if (seededRandom() < 0.5) {
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
      p = boostPatterns[Math.floor(seededRandom() * boostPatterns.length)];
    }
  }

  createModifierGate(scene, stageIdx, islandX - 3.2, gateZ, islandY, p.left.op, p.left.val, p.left.label);
  modifierGates[modifierGates.length - 1].gateId = `gate_${stageIdx}_${Math.round((islandX - 3.2) * 100)}_${Math.round(gateZ * 100)}`;

  createModifierGate(scene, stageIdx, islandX + 3.2, gateZ, islandY, p.right.op, p.right.val, p.right.label);
  modifierGates[modifierGates.length - 1].gateId = `gate_${stageIdx}_${Math.round((islandX + 3.2) * 100)}_${Math.round(gateZ * 100)}`;
}

function getForkThemeGates(themeRole) {
  const playerCount = player ? player.stackCount : 0;

  if (themeRole === 'shortcut') {
    if (playerCount >= 51) {
      return [
        { op: 'add', val: 4, label: '+4' },
        { op: 'divide', val: 2, label: '÷2' }
      ];
    } else if (playerCount >= 26) {
      return [
        { op: 'add', val: 6, label: '+6' },
        { op: 'subtract', val: 4, label: '-4' }
      ];
    } else {
      return [
        { op: 'add', val: 6, label: '+6' },
        { op: 'add', val: 4, label: '+4' }
      ];
    }
  } else if (themeRole === 'rich') {
    if (playerCount >= 51) {
      return [
        { op: 'add', val: 6, label: '+6' },
        { op: 'subtract', val: 4, label: '-4' }
      ];
    } else if (playerCount >= 26) {
      return [
        { op: 'add', val: 8, label: '+8' },
        { op: 'subtract', val: 4, label: '-4' }
      ];
    } else {
      return [
        { op: 'add', val: 10, label: '+10' },
        { op: 'add', val: 6, label: '+6' }
      ];
    }
  } else {
    if (playerCount >= 51) {
      return [
        { op: 'add', val: 4, label: '+4' },
        { op: 'subtract', val: 6, label: '-6' }
      ];
    } else if (playerCount >= 26) {
      return [
        { op: 'add', val: 6, label: '+6' },
        { op: 'subtract', val: 4, label: '-4' }
      ];
    } else {
      return [
        { op: 'add', val: 8, label: '+8' },
        { op: 'subtract', val: 2, label: '-2' }
      ];
    }
  }
}

export function spawnObstacleMobOnStage(scene, stageIdx, islandZ, islandY, islandX = 0.0) {
  if (stageIdx <= 3) return;
  const stageInfo = STAGES[stageIdx];
  if (!stageInfo || stageInfo.r < 9.0 || stageInfo.isFork || stageInfo.isMerge) return;

  if (stagesSinceLastObstacle < 4) {
    stagesSinceLastObstacle++;
    return;
  }

  const spawnChance = (stagesSinceLastObstacle >= 6) ? 1.0 : 0.35;
  if (seededRandom() < spawnChance) {
    stagesSinceLastObstacle = 0;

    const hasGates = (stageIdx % 2 === 1);
    const spawnZ = hasGates ? (islandZ + 1.2) : islandZ;
    const mobObj = createObstacleMobMesh(islandX, islandY, spawnZ);
    scene.add(mobObj.group);

    obstacleMobs.push({
      group: mobObj.group,
      bulb: mobObj.bulb,
      dangerRing: mobObj.dangerRing,
      stageIdx: stageIdx,
      baseY: islandY,
      baseZ: spawnZ,
      centerX: islandX,
      rangeX: 3.2,
      currentX: islandX,
      direction: (seededRandom() < 0.5 ? 1 : -1),
      speed: 2.8,
      active: true,
      blownAway: false,
      blowVelocity: new THREE.Vector3()
    });
  } else {
    stagesSinceLastObstacle++;
  }
}

export function updateObstacleMobs(dt, scene) {
  const timeSec = performance.now() * 0.001;

  for (let i = obstacleMobs.length - 1; i >= 0; i--) {
    const mob = obstacleMobs[i];
    if (!mob.active) continue;

    if (mob.blownAway) {
      mob.blowVelocity.y -= 38.0 * dt;
      mob.group.position.addScaledVector(mob.blowVelocity, dt);
      mob.group.rotation.x += dt * 14.0;
      mob.group.rotation.y += dt * 18.0;

      if (mob.group.position.y < -42.0) {
        mob.active = false;
        disposeHierarchy(mob.group);
        scene.remove(mob.group);
        obstacleMobs.splice(i, 1);
      }
    } else {
      mob.currentX += mob.direction * mob.speed * dt;
      if (Math.abs(mob.currentX - mob.centerX) >= mob.rangeX) {
        mob.direction *= -1;
        mob.currentX = mob.centerX + Math.sign(mob.currentX - mob.centerX) * mob.rangeX;
      }

      const bounceCycle = Math.abs(Math.sin(timeSec * 7.5 + mob.stageIdx)) * 0.14;
      mob.group.position.set(mob.currentX, mob.baseY + bounceCycle, mob.baseZ);
      mob.group.rotation.y = (mob.direction > 0) ? (Math.PI / 2) : (-Math.PI / 2);

      if (mob.bulb) {
        mob.bulb.visible = (Math.floor(timeSec * 6.0) % 2 === 0);
      }

      if (mob.dangerRing) {
        const ringPulse = 1.0 + Math.sin(timeSec * 4.5) * 0.05;
        mob.dangerRing.scale.set(ringPulse, ringPulse, ringPulse);
      }
    }
  }
}

export function createBridgeLinks(scene, stageIdx, nextStageIdx, prevIslandZ, nextIslandZ, prevR, nextR, startY, endY, type, islandCenterX = 0.0, singleLaneOnly = false) {
  if (type === 'skydive') {
    const startZ = prevIslandZ - prevR + 1.2;
    const endZ = nextIslandZ + nextR - 1.2;

    const catapult = createSkydiveCatapultStructure(scene, islandCenterX, startY, startZ);

    const skydiveBridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [],
      visualMeshes: [catapult.group],
      startZ, endZ, startY, endY,
      launchPoint: catapult.launchPoint,
      isSkydive: true, isTrapdoor: false, isElevator: false, isZipline: false,
      isCurvedSlide: false, isSlide: false, isJump: false, isVertical: false,
      bonusBlocks: []
    };

    const numSkydiveBlocks = 7;
    for (let si = 0; si < numSkydiveBlocks; si++) {
      const t = 0.18 + (si / (numSkydiveBlocks - 1)) * 0.68;
      const bZ = THREE.MathUtils.lerp(startZ, endZ, t);
      const fallPower = SKYDIVE_CONFIG.PHYSICS.gravityPower || 2.0;
      const hop = Math.sin(t * Math.PI) * (SKYDIVE_CONFIG.PHYSICS.hopHeight || 3.5);
      const bY = startY + (endY - startY) * Math.pow(t, fallPower) + hop + 0.35;
      const bX = islandCenterX + Math.sin(si * 1.5) * 2.4;

      const bMesh = new THREE.Mesh(blockGeometry, sharedMats.blockNeutral);
      bMesh.position.set(bX, bY, bZ);
      scene.add(bMesh);

      const bonusId = `bonus_skydive_${stageIdx}_${si}`;
      const bonusData = {
        mesh: bMesh,
        t: t,
        x: bX,
        baseY: bY,
        si: si,
        collected: false,
        stageIdx: stageIdx,
        bonusId: bonusId
      };
      skydiveBridge.bonusBlocks.push(bonusData);
      skydiveBonusBlocks.push(bonusData);
    }

    if (!bridgesByStage.has(stageIdx)) bridgesByStage.set(stageIdx, []);
    bridgesByStage.get(stageIdx).push(skydiveBridge);
    bridges.push(skydiveBridge);
    return;
  }

  if (type === 'trapdoor' || type === 'freefall') {
    const approachStartZ = prevIslandZ - prevR + 1.2;
    const targetDropZ = nextIslandZ + nextR - 1.2;

    const hatch = createTrapdoorHatchStructure(scene, islandCenterX, startY, targetDropZ, approachStartZ);

    const landingPad = new THREE.Group();
    const landingRimGeo = new THREE.TorusGeometry(2.4, 0.08, 8, 32);
    landingRimGeo.rotateX(Math.PI / 2);
    const landingRim = new THREE.Mesh(landingRimGeo, sharedMats.dropPylonSteel);
    landingRim.position.set(islandCenterX, endY + 0.08, targetDropZ);
    landingPad.add(landingRim);

    const landingRingGeo = new THREE.RingGeometry(1.6, 2.2, 32);
    landingRingGeo.rotateX(-Math.PI / 2);
    const landingRing = new THREE.Mesh(landingRingGeo, sharedMats.dropIndicatorNeon);
    landingRing.position.set(islandCenterX, endY + 0.09, targetDropZ);
    landingPad.add(landingRing);

    scene.add(landingPad);

    const trapdoorBridge = {
      stageIdx, nextStageIdx, laneIdx: 1, planks: [],
      visualMeshes: [hatch.group, landingPad],
      startZ: targetDropZ,
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

    const shuffledLanes = ELEVATOR_CONFIG.LANES.map((cfg, idx) => ({ ...cfg, laneIdx: idx }));
    for (let i = shuffledLanes.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
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
      const laneX = islandCenterX + LANES[cfg.laneIdx];
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

    const depPylon = createZiplinePylonMesh(islandCenterX, startY, startZ, departureTopY, true);
    scene.add(depPylon);
    const arrPylon = createZiplinePylonMesh(islandCenterX, endY, endZ, arrivalTopY, false);
    scene.add(arrPylon);

    const startPt = new THREE.Vector3(islandCenterX, departureTopY - 0.2, startZ);
    const endPt = new THREE.Vector3(islandCenterX, arrivalTopY - 0.2, endZ);
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

      const bonusId = `bonus_zipline_${stageIdx}_${zi}`;
      const bonusData = {
        mesh: bMesh,
        t: t,
        baseY: bPos.y,
        zi: zi,
        collected: false,
        stageIdx: stageIdx,
        bonusId: bonusId
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
    const startZ = prevIslandZ - prevR + 0.4;
    const endZ = nextIslandZ + nextR - 2.0;
    const distZ = startZ - endZ;
    const dropY = startY - endY;
    const sDir = (stageIdx % 2 === 0 ? 1 : -1);

    const p0 = new THREE.Vector3(islandCenterX, startY + 0.28, startZ);
    const p1 = new THREE.Vector3(islandCenterX + sDir * 7.5, startY - dropY * 0.28, startZ - distZ * 0.28);
    const p2 = new THREE.Vector3(islandCenterX - sDir * 5.8, startY - dropY * 0.72, startZ - distZ * 0.72);
    const p3 = new THREE.Vector3(islandCenterX, endY + 0.28, endZ);
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

      const bonusId = `bonus_curved_${stageIdx}_${bi}`;
      const bonusData = {
        mesh: bMesh,
        t: t,
        offset: offsetVal,
        collected: false,
        stageIdx: stageIdx,
        bonusId: bonusId
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
  const isStairs = (!isJump && !isSlide && !isVertical);
  const isStepBridge = (isStairs || isVertical);

  let jumpTiers = [];
  if (isJump) {
    jumpTiers = [TRAMPOLINE_TIERS.normal, TRAMPOLINE_TIERS.high, TRAMPOLINE_TIERS.mega];
    for (let i = jumpTiers.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [jumpTiers[i], jumpTiers[j]] = [jumpTiers[j], jumpTiers[i]];
    }
  }

  const laneIndices = singleLaneOnly ? [1] : [0, 1, 2];

  for (let lIdx = 0; lIdx < laneIndices.length; lIdx++) {
    const laneIdx = laneIndices[lIdx];

    const actualBridgeX = singleLaneOnly ? islandCenterX : (islandCenterX + LANES[laneIdx]);

    const fromStageObj = STAGES[stageIdx];
    const fromStageCenterX = fromStageObj ? (fromStageObj.x || 0.0) : 0.0;
    const toStageObj = STAGES[nextStageIdx];
    const toStageCenterX = toStageObj ? (toStageObj.x || 0.0) : 0.0;

    const relFromX = actualBridgeX - fromStageCenterX;
    const relToX = actualBridgeX - toStageCenterX;

    const prevInsetZ = Math.sqrt(Math.max(1, prevR * prevR - relFromX * relFromX));
    const nextInsetZ = Math.sqrt(Math.max(1, nextR * nextR - relToX * relToX));

    const stairsEndOffset = isStepBridge ? (laneIdx === 1 ? -0.4 : +0.03) : (isSlide && singleLaneOnly ? -0.5 : -1.2);
    const startZ = prevIslandZ - prevInsetZ + (isStepBridge ? 0.35 : 1.2);
    const endZ = nextIslandZ + nextInsetZ + stairsEndOffset;
    const distZ = startZ - endZ;

    const startX = actualBridgeX;

    const dist3D = Math.hypot(distZ, endY - startY);
    const numPlanks = isJump ? 1 : Math.max(12, Math.floor(dist3D / (PLANK_LENGTH * 0.75)));

    const bridge = {
      stageIdx, nextStageIdx, laneIdx, planks: [], visualMeshes: [],
      startZ, endZ, isJump, isSlide, isVertical,
      isSkydive: false, isTrapdoor: false, isCurvedSlide: false, isZipline: false,
      actualBridgeX: actualBridgeX,
      ghostMesh: null, solidMesh: null,
      bonusBlocks: []
    };

    if (isSlide) {
      const sStartZ = prevIslandZ - prevInsetZ;
      const sEndZ = nextIslandZ + nextInsetZ - (singleLaneOnly ? 0.5 : 0.0);

      const slopeOverlap = 0.45;
      const slopeDistZ = (sStartZ - sEndZ) + slopeOverlap * 2;
      const slopeDistY = endY - startY;
      const slopeLength = Math.hypot(slopeDistZ, slopeDistY);
      const slopeGeo = new THREE.BoxGeometry(3.6, 0.22, slopeLength);
      const slopeMesh = new THREE.Mesh(slopeGeo, sharedMats.slideSurface);

      const midZ = (sStartZ + sEndZ) / 2;
      const midY = (startY + endY) / 2 + 0.10;
      slopeMesh.position.set(startX, midY, midZ);
      const angleX = Math.atan2(slopeDistY, slopeDistZ);
      slopeMesh.rotation.x = angleX;
      slopeMesh.receiveShadow = true;
      scene.add(slopeMesh);
      bridge.visualMeshes.push(slopeMesh);

      const numSlideBlocks = 4;
      for (let sbi = 0; sbi < numSlideBlocks; sbi++) {
        const prog = 0.22 + (sbi / (numSlideBlocks - 1)) * 0.58;
        const bZ = sStartZ - prog * (sStartZ - sEndZ);
        const bY = startY + prog * (endY - startY) + 0.34;

        const bMesh = new THREE.Mesh(blockGeometry, sharedMats.blockNeutral);
        bMesh.position.set(startX, bY, bZ);
        bMesh.rotation.x = angleX;
        scene.add(bMesh);

        const bonusId = `bonus_slide_${stageIdx}_${laneIdx}_${sbi}`;
        const bonusData = {
          mesh: bMesh,
          laneIdx: laneIdx,
          laneX: startX,
          prog: prog,
          z: bZ,
          baseY: bY,
          sbi: sbi,
          collected: false,
          stageIdx: stageIdx,
          bonusId: bonusId
        };
        bridge.bonusBlocks.push(bonusData);
        slideBonusBlocks.push(bonusData);
      }

      const railOffsets = singleLaneOnly ? [-1.85, 1.85] : (laneIdx === 0 ? [-5.85, -2.0, 2.0, 5.85] : []);
      railOffsets.forEach(rOff => {
        const rActualX = singleLaneOnly ? (startX + rOff) : (islandCenterX + rOff);
        const rRelFromX = rActualX - fromStageCenterX;
        const rRelToX = rActualX - toStageCenterX;
        const rPrevInset = Math.sqrt(Math.max(1, prevR * prevR - (rRelFromX * rRelFromX)));
        const rNextInset = Math.sqrt(Math.max(1, nextR * nextR - (rRelToX * rRelToX)));

        const rP1 = new THREE.Vector3(rActualX, startY + 0.28, prevIslandZ - rPrevInset + 0.35);
        const rP2 = new THREE.Vector3(rActualX, endY + 0.28, nextIslandZ + rNextInset - 0.35);

        const railVec = new THREE.Vector3().subVectors(rP2, rP1);
        const railLen = railVec.length();
        const railMid = new THREE.Vector3().addVectors(rP1, rP2).multiplyScalar(0.5);

        const railGeo = new THREE.CylinderGeometry(0.15, 0.15, railLen, 8);
        const railMesh = new THREE.Mesh(railGeo, sharedMats.slideRail);
        railMesh.position.copy(railMid);
        railMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), railVec.clone().normalize());
        scene.add(railMesh);
        bridge.visualMeshes.push(railMesh);
      });

      for (let i = 0; i < numPlanks; i++) {
        const progress = (i + 0.5) / numPlanks;
        const pZ = startZ - progress * distZ;
        const pY = startY + progress * (endY - startY);
        bridge.planks.push({ teamId: 'slide_free', index: i, y: pY, z: pZ });
      }
    } else if (isJump) {
      let jumpTier = jumpTiers[laneIdx];

      const tramp = createTrampolineMesh(startX, startY, startZ - 1.8, jumpTier);
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
      const plankH = isVertical ? 1.25 : 0.65;
      const plankCenterOffsetY = 0.20 - plankH / 2;

      const ghostMesh = new THREE.InstancedMesh(geoToUse, sharedMats.ghostPlank, numPlanks);
      ghostMesh.receiveShadow = true;

      const solidMesh = new THREE.InstancedMesh(geoToUse, sharedMats.solidPlank, numPlanks);
      solidMesh.castShadow = true;
      solidMesh.receiveShadow = true;

      for (let i = 0; i < numPlanks; i++) {
        const progress = (i + 0.5) / numPlanks;
        let pZ = startZ - progress * distZ;

        let pY = startY + progress * (endY - startY);
        if (isStepBridge) {
          pY = (startY + plankCenterOffsetY) + progress * (endY - startY);

          if (i === numPlanks - 1) {
            const topOffset = (singleLaneOnly ? -0.25 : ((laneIdx === 1) ? -0.25 : +0.18));
            pZ = nextIslandZ + nextInsetZ + topOffset;
            pY = endY + plankCenterOffsetY;
          }
        }

        dummyPlankObj.position.set(startX, pY, pZ);
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

/**
 * ★【Phase 1 核心】二股分岐パターンB（Fork Pattern B）の完全決定論ハッシュ化
 * seededRandom() の消費をゼロにし、forkIdx と worldSeed から数学的に一意決定
 */
export function extendCourseForkPatternB(scene) {
  const forkIdx = STAGES.length;
  const prev = STAGES[forkIdx - 1];

  _prngState = (currentWorldSeed + forkIdx * 10007) | 0;

  const forkDistZ = 36.0;
  const forkZ = prev.z - forkDistZ;
  const forkY = Math.max(8.0, prev.y + 4.0);
  const forkR = 11.5;

  const forkStage = {
    z: forkZ,
    y: forkY,
    x: 0.0,
    r: forkR,
    type: 'fork_hub',
    isFork: true
  };
  STAGES.push(forkStage);

  const forkMeshGroup = createIslandMesh(forkR, forkY, forkZ, 0.0);
  scene.add(forkMeshGroup);
  stageMeshes.push({ meshGroup: forkMeshGroup, stageIdx: forkIdx });

  CONNECTIONS.push({ from: forkIdx - 1, to: forkIdx, type: 'bridge' });
  createBridgeLinks(scene, forkIdx - 1, forkIdx, prev.z, forkZ, prev.r, forkR, prev.y, forkY, 'bridge', 0.0, false);

  // ★ forkIdx から数学的固定ハッシュ値を算出（PRNG消費ゼロ）
  const forkHash = Math.abs(Math.imul(forkIdx ^ 0x6D2B79F5, (currentWorldSeed + 13) | 1));

  const themeBItemType = (forkHash % 2 === 0) ? 'thunder' : 'magnet';
  const themeCExitType = ((forkHash >> 1) % 2 === 0) ? 'skydive' : 'slide';

  const themeA = {
    id: 'theme_a',
    name: 'Rush & Dive',
    role: 'shortcut',
    deltaY: 26.0,
    connType: 'vertical',
    exitType: 'skydive',
    itemType: 'speed'
  };

  const themeB = {
    id: 'theme_b',
    name: 'Rich & Boost',
    role: 'rich',
    deltaY: 6.0,
    connType: 'bridge',
    exitType: 'slide',
    itemType: themeBItemType
  };

  const themeC = {
    id: 'theme_c',
    name: 'Technical & Gimmick',
    role: 'technical',
    deltaY: 14.0,
    connType: 'jump',
    exitType: themeCExitType,
    itemType: 'attack'
  };

  const candidatePairs = [
    [themeA, themeB],
    [themeB, themeC],
    [themeA, themeC]
  ];
  // 決定論的ペア選択
  const pairIdx = ((forkHash >> 2) % candidatePairs.length);
  const chosenPair = candidatePairs[pairIdx];

  // 決定論的左右割り当て
  const shuffleLeft = ((forkHash >> 4) % 2 === 0);
  const leftTheme = shuffleLeft ? chosenPair[0] : chosenPair[1];
  const rightTheme = shuffleLeft ? chosenPair[1] : chosenPair[0];

  const leftMidDistZ = 38.0;
  const leftMidZ = forkZ - leftMidDistZ;
  const leftMidY = forkY + leftTheme.deltaY;
  const leftMidR = 8.5;
  const leftMidX = -6.5;

  const leftStageIdx = STAGES.length;
  const leftStage = {
    z: leftMidZ,
    y: leftMidY,
    x: leftMidX,
    r: leftMidR,
    type: 'fork_left',
    branchRole: leftTheme.role
  };
  STAGES.push(leftStage);

  const leftMesh = createIslandMesh(leftMidR, leftMidY, leftMidZ, leftMidX);
  scene.add(leftMesh);
  stageMeshes.push({ meshGroup: leftMesh, stageIdx: leftStageIdx });

  CONNECTIONS.push({ from: forkIdx, to: leftStageIdx, type: leftTheme.connType, branch: 'left' });
  createBridgeLinks(scene, forkIdx, leftStageIdx, forkZ, leftMidZ, forkR, leftMidR, forkY, leftMidY, leftTheme.connType, leftMidX, true);

  const leftGates = getForkThemeGates(leftTheme.role);
  // 決定論的ゲート配置反転判定
  if ((forkHash >> 5) % 2 === 1) {
    const tmp = leftGates[0]; leftGates[0] = leftGates[1]; leftGates[1] = tmp;
  }
  createModifierGate(scene, leftStageIdx, leftMidX - 2.8, leftMidZ - 0.8, leftMidY, leftGates[0].op, leftGates[0].val, leftGates[0].label);
  modifierGates[modifierGates.length - 1].gateId = `gate_${leftStageIdx}_${Math.round((leftMidX - 2.8) * 100)}_${Math.round((leftMidZ - 0.8) * 100)}`;
  createModifierGate(scene, leftStageIdx, leftMidX + 2.8, leftMidZ - 0.8, leftMidY, leftGates[1].op, leftGates[1].val, leftGates[1].label);
  modifierGates[modifierGates.length - 1].gateId = `gate_${leftStageIdx}_${Math.round((leftMidX + 2.8) * 100)}_${Math.round((leftMidZ - 0.8) * 100)}`;

  if (leftTheme.itemType) {
    spawnItem(scene, leftStageIdx, leftTheme.itemType);
  }

  const rightMidDistZ = 38.0;
  const rightMidZ = forkZ - rightMidDistZ;
  const rightMidY = forkY + rightTheme.deltaY;
  const rightMidR = 8.5;
  const rightMidX = 6.5;

  const rightStageIdx = STAGES.length;
  const rightStage = {
    z: rightMidZ,
    y: rightMidY,
    x: rightMidX,
    r: rightMidR,
    type: 'fork_right',
    branchRole: rightTheme.role
  };
  STAGES.push(rightStage);

  const rightMesh = createIslandMesh(rightMidR, rightMidY, rightMidZ, rightMidX);
  scene.add(rightMesh);
  stageMeshes.push({ meshGroup: rightMesh, stageIdx: rightStageIdx });

  CONNECTIONS.push({ from: forkIdx, to: rightStageIdx, type: rightTheme.connType, branch: 'right' });
  createBridgeLinks(scene, forkIdx, rightStageIdx, forkZ, rightMidZ, forkR, rightMidR, forkY, rightMidY, rightTheme.connType, rightMidX, true);

  const rightGates = getForkThemeGates(rightTheme.role);
  // 決定論的ゲート配置反転判定
  if ((forkHash >> 6) % 2 === 1) {
    const tmp = rightGates[0]; rightGates[0] = rightGates[1]; rightGates[1] = tmp;
  }
  createModifierGate(scene, rightStageIdx, rightMidX - 2.8, rightMidZ - 0.8, rightMidY, rightGates[0].op, rightGates[0].val, rightGates[0].label);
  modifierGates[modifierGates.length - 1].gateId = `gate_${rightStageIdx}_${Math.round((rightMidX - 2.8) * 100)}_${Math.round((rightMidZ - 0.8) * 100)}`;
  createModifierGate(scene, rightStageIdx, rightMidX + 2.8, rightMidZ - 0.8, rightMidY, rightGates[1].op, rightGates[1].val, rightGates[1].label);
  modifierGates[modifierGates.length - 1].gateId = `gate_${rightStageIdx}_${Math.round((rightMidX + 2.8) * 100)}_${Math.round((rightMidZ - 0.8) * 100)}`;

  if (rightTheme.itemType) {
    spawnItem(scene, rightStageIdx, rightTheme.itemType);
  }

  const mergeDistZ = 46.0;
  const mergeZ = Math.min(leftMidZ, rightMidZ) - mergeDistZ;
  const mergeY = forkY;
  const mergeR = 12.0;

  const mergeStageIdx = STAGES.length;
  const mergeStage = {
    z: mergeZ,
    y: mergeY,
    x: 0.0,
    r: mergeR,
    type: 'fork_merge',
    isMerge: true
  };
  STAGES.push(mergeStage);

  const mergeMeshGroup = createIslandMesh(mergeR, mergeY, mergeZ, 0.0);
  scene.add(mergeMeshGroup);
  stageMeshes.push({ meshGroup: mergeMeshGroup, stageIdx: mergeStageIdx });

  CONNECTIONS.push({ from: leftStageIdx, to: mergeStageIdx, type: leftTheme.exitType, branch: 'left' });
  createBridgeLinks(scene, leftStageIdx, mergeStageIdx, leftMidZ, mergeZ, leftMidR, mergeR, leftMidY, mergeY, leftTheme.exitType, leftMidX, true);

  CONNECTIONS.push({ from: rightStageIdx, to: mergeStageIdx, type: rightTheme.exitType, branch: 'right' });
  createBridgeLinks(scene, rightStageIdx, mergeStageIdx, rightMidZ, mergeZ, rightMidR, mergeR, rightMidY, mergeY, rightTheme.exitType, rightMidX, true);

  spawnGatesOnIsland(scene, mergeStageIdx, mergeZ, mergeY, 0.0);
  // 合流島のアイテムも完全決定論化
  spawnItem(scene, mergeStageIdx);

  lastGimmickCategory = 'descent';
  lastMergeStageIdx = mergeStageIdx;
}

export function extendCourse(scene) {
  const idx = STAGES.length;
  const prev = STAGES[idx - 1];

  _prngState = (currentWorldSeed + idx * 10007) | 0;

  const stagesSinceLastMerge = (lastMergeStageIdx === -1) ? (idx - 6) : (idx - lastMergeStageIdx);
  const shouldSpawnFork = (lastMergeStageIdx === -1 && idx === 6) || (lastMergeStageIdx !== -1 && stagesSinceLastMerge >= 8);

  if (shouldSpawnFork) {
    extendCourseForkPatternB(scene);
    return;
  }

  let type, nextY, r, distZ;

  if (idx === 1) {
    type = 'bridge';
    nextY = prev.y + 7.0;
    distZ = 34;
    r = 10;
    lastGimmickCategory = 'ascent';
  } else if (idx === 2) {
    type = 'jump';
    nextY = prev.y + 1.0;
    distZ = 30;
    r = 9.5;
    lastGimmickCategory = 'ascent';
  } else if (idx === 3) {
    type = 'slide';
    nextY = Math.max(5.0, prev.y - 8.5);
    distZ = 42;
    r = 11;
    lastGimmickCategory = 'descent';
  } else if (idx === 4) {
    type = 'vertical';
    nextY = prev.y + 12.0;
    distZ = 24;
    r = 10;
    lastGimmickCategory = 'ascent';
  } else if (idx === 5) {
    type = 'zipline';
    nextY = Math.max(7.0, prev.y - 10.5);
    distZ = 68;
    r = 10.5;
    lastGimmickCategory = 'descent';
  } else {
    let pickDescent = (lastGimmickCategory === 'ascent');
    if (prev.y <= 7.0) pickDescent = false;
    if (prev.y >= 38.0) pickDescent = true;

    if (pickDescent) {
      type = getNextDescentGimmick();
      lastGimmickCategory = 'descent';
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
      } else {
        nextY = Math.max(7.0, prev.y - 12.0);
        distZ = 68;
        r = 10.5;
      }
    } else {
      type = getNextAscentGimmick();
      lastGimmickCategory = 'ascent';
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
      } else {
        nextY = prev.y + 7.0;
        distZ = 34;
        r = 10;
      }
    }
  }

  nextY = Math.max(5.0, nextY);
  const nextZ = prev.z - distZ;
  const currentIslandX = prev.x || 0.0;
  const stageInfo = { z: nextZ, y: nextY, x: currentIslandX, r: r, type: type };
  STAGES.push(stageInfo);

  const islandMeshGroup = createIslandMesh(r, nextY, nextZ, currentIslandX);
  scene.add(islandMeshGroup);
  stageMeshes.push({ meshGroup: islandMeshGroup, stageIdx: idx });

  CONNECTIONS.push({ from: idx - 1, to: idx, type: type });
  createBridgeLinks(scene, idx - 1, idx, prev.z, nextZ, prev.r, r, prev.y, nextY, type, currentIslandX, false);

  if (idx >= 1) {
    spawnGatesOnIsland(scene, idx, nextZ, nextY, currentIslandX);

    if (idx % 2 === 1) {
      spawnItem(scene, idx);
    }

    spawnObstacleMobOnStage(scene, idx, nextZ, nextY, currentIslandX);
  }

  if (idx % 2 === 0) {
    const cloudSide = (idx % 4 === 0) ? 1 : -1;
    const cloudMesh = createCloudMesh();
    const cloudX = currentIslandX + cloudSide * (16 + seededRandom() * 8);
    const cloudY = (prev.y + nextY) / 2 + (seededRandom() * 4 - 2);
    const cloudZ = (prev.z + nextZ) / 2;
    cloudMesh.position.set(cloudX, cloudY, cloudZ);
    scene.add(cloudMesh);
    cloudObjects.push({ mesh: cloudMesh, stageIdx: idx, baseY: cloudY, offset: seededRandom() * 10 });
  }

  if (Math.max(prev.y, nextY) >= 16.0 && seededRandom() < 0.65) {
    const midCloudMesh = createCloudMesh();
    const midCloudSide = seededRandom() < 0.5 ? 1 : -1;
    const midCloudX = currentIslandX + midCloudSide * (15.0 + seededRandom() * 16.0);
    const midCloudY = 6.0 + seededRandom() * 5.0;
    const midCloudZ = (prev.z + nextZ) / 2 + (seededRandom() * 18.0 - 9.0);
    midCloudMesh.position.set(midCloudX, midCloudY, midCloudZ);
    scene.add(midCloudMesh);
    cloudObjects.push({ mesh: midCloudMesh, stageIdx: idx, baseY: midCloudY, offset: seededRandom() * 10 });
  }

  const distanceZones = [
    { minX: 16, maxX: 23, weight: 0.60, minScale: 0.80, maxScale: 1.15 },
    { minX: 28, maxX: 42, weight: 0.50, minScale: 0.65, maxScale: 0.95 },
    { minX: 48, maxX: 68, weight: 0.40, minScale: 0.55, maxScale: 0.85 }
  ];

  distanceZones.forEach(zone => {
    if (seededRandom() < zone.weight) {
      const side = seededRandom() < 0.5 ? 1 : -1;
      const isletScale = zone.minScale + seededRandom() * (zone.maxScale - zone.minScale);
      const isletMesh = createOceanIsletMesh(
        isletScale,
        seededRandom() < 0.68 ? 'tropical' : 'rocky'
      );
      const isletX = currentIslandX + side * (zone.minX + seededRandom() * (zone.maxX - zone.minX));
      const isletZ = nextZ + (seededRandom() * 24.0 - 12.0);
      isletMesh.position.set(isletX, -42, isletZ);
      scene.add(isletMesh);
      oceanIslands.push({ meshGroup: isletMesh, stageIdx: idx });
    }
  });
}

export function buildWorld(scene, seed = null) {
  setWorldSeed(seed);

  descentBag.length = 0;
  ascentBag.length = 0;
  lastGimmickCategory = 'descent';
  lastMergeStageIdx = -1;
  stagesSinceLastObstacle = 0;

  floorBlocksByStage.forEach(bucket => {
    bucket.forEach(b => {
      b.active = false;
      b.mesh.visible = false;
      b.attracting = false;
      b.mesh.rotation.set(0, 0, 0);
    });
  });
  floorBlocksByStage.clear();
  bridgesByStage.clear();

  stageMeshes.forEach(m => {
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
  skydiveBonusBlocks.forEach(b => {
    if (b.mesh) {
      disposeHierarchy(b.mesh);
      scene.remove(b.mesh);
    }
  });
  slideBonusBlocks.forEach(b => {
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

  obstacleMobs.forEach(mob => {
    if (mob.group) {
      disposeHierarchy(mob.group);
      scene.remove(mob.group);
    }
  });
  obstacleMobs.length = 0;

  activeMagnetBlocks.forEach(mb => {
    if (mb.poolItem) {
      mb.poolItem.active = false;
      mb.poolItem.mesh.visible = false;
      mb.poolItem.attracting = false;
      mb.poolItem.mesh.rotation.set(0, 0, 0);
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
  skydiveBonusBlocks.length = 0;
  slideBonusBlocks.length = 0;

  STAGES.length = 0;
  STAGES.push({ z: 0, y: 0, x: 0.0, r: 12 });

  scene.background = new THREE.Color(0x7dd3fc);
  scene.fog = new THREE.FogExp2(0x7dd3fc, 0.0032);

  const seaGeo = new THREE.PlaneGeometry(1600, 2400);
  seaMesh = new THREE.Mesh(seaGeo, sharedMats.sea);
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(0, -42, -500);
  seaMesh.receiveShadow = false;
  scene.add(seaMesh);

  const initialIslets = [
    { x: -18, z: -15, scale: 1.05, type: 'tropical' },
    { x: 20, z: 10, scale: 0.95, type: 'rocky' },
    { x: -36, z: 22, scale: 0.85, type: 'tropical' },
    { x: 38, z: -40, scale: 0.90, type: 'tropical' },
    { x: -58, z: -60, scale: 0.75, type: 'tropical' },
    { x: 55, z: -10, scale: 0.70, type: 'rocky' }
  ];
  initialIslets.forEach(cfg => {
    const islet = createOceanIsletMesh(cfg.scale, cfg.type);
    islet.position.set(cfg.x, -42, cfg.z);
    scene.add(islet);
    oceanIslands.push({ meshGroup: islet, stageIdx: 0 });
  });

  const startIslandGroup = createIslandMesh(12, 0, 0, 0.0);
  scene.add(startIslandGroup);
  stageMeshes.push({ meshGroup: startIslandGroup, stageIdx: 0 });

  for (let i = 0; i < 6; i++) extendCourse(scene);
}

export function cleanupOldData(scene) {
  if (!player) return;

  let minActiveStage = player.currentStage;
  for (let i = 0; i < characters.length; i++) {
    if (characters[i].currentStage < minActiveStage) {
      minActiveStage = characters[i].currentStage;
    }
  }
  const safeStage = Math.max(0, minActiveStage - 2);

  for (let i = obstacleMobs.length - 1; i >= 0; i--) {
    if (obstacleMobs[i].stageIdx < safeStage) {
      if (obstacleMobs[i].group) {
        disposeHierarchy(obstacleMobs[i].group);
        scene.remove(obstacleMobs[i].group);
      }
      obstacleMobs.splice(i, 1);
    }
  }

  for (let i = activeMagnetBlocks.length - 1; i >= 0; i--) {
    const mb = activeMagnetBlocks[i];
    if (mb.targetChar && mb.targetChar.currentStage < safeStage) {
      if (mb.poolItem) {
        mb.poolItem.active = false;
        mb.poolItem.mesh.visible = false;
        mb.poolItem.attracting = false;
        mb.poolItem.mesh.rotation.set(0, 0, 0);
      }
      activeMagnetBlocks.splice(i, 1);
    }
  }

  for (let i = stageMeshes.length - 1; i >= 0; i--) {
    if (stageMeshes[i].stageIdx < safeStage) {
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
        b.mesh.rotation.set(0, 0, 0);
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
  for (let i = skydiveBonusBlocks.length - 1; i >= 0; i--) {
    if (skydiveBonusBlocks[i].stageIdx < safeStage) {
      if (skydiveBonusBlocks[i].mesh) {
        disposeHierarchy(skydiveBonusBlocks[i].mesh);
        scene.remove(skydiveBonusBlocks[i].mesh);
      }
      skydiveBonusBlocks.splice(i, 1);
    }
  }
  for (let i = slideBonusBlocks.length - 1; i >= 0; i--) {
    if (slideBonusBlocks[i].stageIdx < safeStage) {
      if (slideBonusBlocks[i].mesh) {
        disposeHierarchy(slideBonusBlocks[i].mesh);
        scene.remove(slideBonusBlocks[i].mesh);
      }
      slideBonusBlocks.splice(i, 1);
    }
  }
}