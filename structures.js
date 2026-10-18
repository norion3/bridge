// 静的構造物・アトラクション施設・浮島・装飾メッシュ・目鼻なし愛嬌お邪魔キャラ生成モジュール（完全分離レイヤー）
import {
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import {
  sharedMats,
  islandGeo,
  gatePedestalGeo,
  elevatorPlatformFloorGeo,
  elevatorHandrailPostGeo,
  catapultRampGeo,
  catapultTrimGeo,
  dropDeckGeo,
  dropPylonGeo,
  dropIndicatorGeo,
  hatchDoorGeo,
  getOrCreateGateMaterials
} from './materials.js';

let _modifierGatesRef = null;

// world.js の modifierGates 配列参照を受け取り、循環参照をゼロに保つセッター
export function setModifierGatesReference(list) {
  _modifierGatesRef = list;
}

// 1. 修飾ゲート生成
export function createModifierGate(scene, stageIdx, posX, posZ, posY, opType, value, label) {
  const isPositive = (opType === 'add' || opType === 'multiply');
  const group = new THREE.Group();

  const materials = getOrCreateGateMaterials(label, isPositive);
  const panelMesh = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 0.15), materials);
  panelMesh.position.y = 1.3;
  panelMesh.castShadow = true;
  group.add(panelMesh);

  const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.4, 12);
  const p1 = new THREE.Mesh(postGeo, sharedMats.gateFrame);
  p1.position.set(-1.3, 1.2, 0);
  group.add(p1);
  const p2 = p1.clone();
  p2.position.x = 1.3;
  group.add(p2);

  const ringGeo = new THREE.TorusGeometry(0.12, 0.025, 8, 16);
  ringGeo.rotateX(Math.PI / 2);
  const rL1 = new THREE.Mesh(ringGeo, sharedMats.ziplinePylonTrim);
  rL1.position.set(-1.3, 0.35, 0);
  group.add(rL1);
  const rR1 = rL1.clone();
  rR1.position.x = 1.3;
  group.add(rR1);

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

  if (_modifierGatesRef) {
    _modifierGatesRef.push(gateData);
  }

  return gateData;
}

// 2. トランポリンメッシュ生成
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

// 3. エレベーター駅舎・標識生成
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

// 4. スカイダイブ発射台生成
export function createSkydiveCatapultStructure(scene, posX, posY, posZ) {
  const group = new THREE.Group();
  const rampLen = SKYDIVE_CONFIG.CATAPULT.length;
  const slopeAng = SKYDIVE_CONFIG.CATAPULT.slopeAngle;

  const rampMesh = new THREE.Mesh(catapultRampGeo, sharedMats.catapultDeck);
  rampMesh.position.set(posX, posY + 0.08, posZ - rampLen * 0.45);
  rampMesh.rotation.x = slopeAng;
  rampMesh.receiveShadow = true;
  rampMesh.castShadow = true;
  group.add(rampMesh);

  const railL = new THREE.Mesh(catapultTrimGeo, sharedMats.catapultNeonRail);
  railL.position.set(posX - 1.82, posY + 0.32, posZ - rampLen * 0.45);
  railL.rotation.x = slopeAng;
  group.add(railL);

  const railR = railL.clone();
  railR.position.x = posX + 1.82;
  group.add(railR);

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

// 5. ドロップタワー・スカイゲート施設生成
export function createTrapdoorHatchStructure(scene, posX, posY, hatchZ, approachStartZ) {
  const group = new THREE.Group();

  const walkEndZ = hatchZ + 1.6;
  if (approachStartZ > walkEndZ + 0.5) {
    const walkLen = approachStartZ - walkEndZ;
    const walkMidZ = (approachStartZ + walkEndZ) / 2;
    const walkGeo = new THREE.BoxGeometry(3.2, 0.14, walkLen);
    const walkMesh = new THREE.Mesh(walkGeo, sharedMats.dropGlassFloor);
    walkMesh.position.set(posX, posY + 0.08, walkMidZ);
    walkMesh.receiveShadow = true;
    group.add(walkMesh);

    const sideRailGeo = new THREE.CylinderGeometry(0.06, 0.06, walkLen, 8);
    sideRailGeo.rotateX(Math.PI / 2);
    const sRailL = new THREE.Mesh(sideRailGeo, sharedMats.catapultNeonRail);
    sRailL.position.set(posX - 1.6, posY + 0.45, walkMidZ);
    group.add(sRailL);
    const sRailR = sRailL.clone();
    sRailR.position.x = 1.6;
    group.add(sRailR);
  }

  const deck = new THREE.Mesh(dropDeckGeo, sharedMats.dropGlassFloor);
  deck.position.set(posX, posY + 0.08, hatchZ);
  deck.receiveShadow = true;
  group.add(deck);

  const rimGeo = new THREE.TorusGeometry(2.8, 0.08, 8, 32);
  rimGeo.rotateX(Math.PI / 2);
  const rim = new THREE.Mesh(rimGeo, sharedMats.dropPylonSteel);
  rim.position.set(posX, posY + 0.16, hatchZ);
  group.add(rim);

  const pylonL = new THREE.Mesh(dropPylonGeo, sharedMats.dropPylonSteel);
  pylonL.position.set(-2.2, posY + 3.75, hatchZ);
  pylonL.castShadow = true;
  group.add(pylonL);

  const indL = new THREE.Mesh(dropIndicatorGeo, sharedMats.dropIndicatorNeon);
  indL.position.set(-2.2, posY + 3.75, hatchZ + 0.18);
  group.add(indL);

  const pylonR = new THREE.Mesh(dropPylonGeo, sharedMats.dropPylonSteel);
  pylonR.position.set(2.2, posY + 3.75, hatchZ);
  pylonR.castShadow = true;
  group.add(pylonR);

  const indR = new THREE.Mesh(dropIndicatorGeo, sharedMats.dropIndicatorNeon);
  indR.position.set(2.2, posY + 3.75, hatchZ + 0.18);
  group.add(indR);

  const pylonCapGeo = new THREE.BoxGeometry(0.55, 0.28, 0.55);
  const capL = new THREE.Mesh(pylonCapGeo, sharedMats.dropPylonSteel);
  capL.position.set(-2.2, posY + 7.5, hatchZ);
  group.add(capL);

  const capR = new THREE.Mesh(pylonCapGeo, sharedMats.dropPylonSteel);
  capR.position.set(2.2, posY + 7.5, hatchZ);
  group.add(capR);

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

// 6. ジップライン鉄塔生成
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

// 7. 立体雲生成
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

// 8. 海上装飾島生成（ミニチュア環礁・エメラルド浅瀬リーフリング追加）
export function createOceanIsletMesh(scale = 1.0, type = 'tropical') {
  const group = new THREE.Group();

  const sandR = (4.0 + Math.random() * 2.0) * scale;

  const reefR = sandR * 1.55;
  const reefGeo = new THREE.CylinderGeometry(reefR * 0.95, reefR, 0.2, 16);
  const reefMesh = new THREE.Mesh(reefGeo, sharedMats.oceanReef);
  reefMesh.position.y = 0.08;
  reefMesh.receiveShadow = false;
  group.add(reefMesh);

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

// 9. ステージ浮島メッシュ生成（中心 X 座標サポート）
export function createIslandMesh(r, y, z, x = 0.0) {
  const group = new THREE.Group();
  const plat = new THREE.Mesh(islandGeo, sharedMats.island);
  plat.scale.set(r, 1, r);
  plat.position.set(x, y - 0.25, z);
  plat.receiveShadow = true;
  group.add(plat);

  const torusGeo = new THREE.TorusGeometry(r, 0.2, 8, 36);
  torusGeo.rotateX(Math.PI / 2);
  const border = new THREE.Mesh(torusGeo, sharedMats.islandBorder);
  border.position.set(x, y, z);
  group.add(border);

  return group;
}

// ★ 10. 目鼻なし（ノンフェイシャル）・愛嬌お邪魔キャラ「トゲトゲ・ポヨポヨ」メッシュ生成
// 自キャラの世界観（目鼻口なしのピクトグラム調）に合わせ、目・鼻・バイザーを完全排除！
// 床ブロック（青・赤・黄）と絶対に被らない鮮やかな「ネオンバイオレット（パープル）」＋「コーラル警告スタッド」＋「ピコピコ警告アンテナ」＋「足元デンジャーリング」
export function createObstacleMobMesh(posX, posY, posZ) {
  const group = new THREE.Group();

  // 1. ツルツルなめらかなネオンパープルの丸っこいボディ（自キャラと同じ滑らか単色質感）
  const bodyGeo = new THREE.SphereGeometry(0.62, 22, 22);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xa855f7, // 鮮やかなネオンバイオレット（床の青・赤・黄と100%被らない！）
    roughness: 0.22,
    metalness: 0.10
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.68;
  body.castShadow = true;
  group.add(body);

  // 2. 丸みのある痛そうな警告スタッド（ネオンコーラルレッドの小コーン）
  const spikeGeo = new THREE.ConeGeometry(0.12, 0.30, 8);
  const spikeMat = new THREE.MeshStandardMaterial({
    color: 0xf43f5e, // 鮮烈なコーラルレッド
    emissive: 0xe11d48,
    emissiveIntensity: 0.35,
    roughness: 0.2
  });

  const spikeAngles = [
    { pitch: 0.48, yaw: 0 },
    { pitch: 0.48, yaw: Math.PI / 2 },
    { pitch: 0.48, yaw: Math.PI },
    { pitch: 0.48, yaw: -Math.PI / 2 },
    { pitch: -0.15, yaw: Math.PI / 4 },
    { pitch: -0.15, yaw: (3 * Math.PI) / 4 },
    { pitch: -0.15, yaw: (-3 * Math.PI) / 4 },
    { pitch: -0.15, yaw: -Math.PI / 4 }
  ];

  spikeAngles.forEach(ang => {
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    spike.position.set(
      Math.sin(ang.yaw) * Math.cos(ang.pitch) * 0.62,
      0.68 + Math.sin(ang.pitch) * 0.62,
      Math.cos(ang.yaw) * Math.cos(ang.pitch) * 0.62
    );
    spike.rotation.x = -ang.pitch + Math.PI / 2;
    spike.rotation.y = ang.yaw;
    group.add(spike);
  });

  // 3. 頭頂部のピコピコ警告アンテナ（目鼻の代わりに愛らしく点滅する自律トイの記号）
  const poleGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.32, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.3 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(0, 1.40, 0);
  group.add(pole);

  const bulbGeo = new THREE.SphereGeometry(0.09, 12, 12);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
  const bulb = new THREE.Mesh(bulbGeo, bulbMat);
  bulb.position.set(0, 1.58, 0);
  group.add(bulb);

  // 4. 足元のデンジャー警告リング（床面スレスレに薄く投影される赤い点線風サークル）
  const ringGeo = new THREE.RingGeometry(1.25, 1.38, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const dangerRing = new THREE.Mesh(ringGeo, ringMat);
  dangerRing.position.y = 0.04;
  group.add(dangerRing);

  // 5. 足元の回転ホバー台座
  const hoverRingGeo = new THREE.CylinderGeometry(0.38, 0.46, 0.10, 16);
  const hoverRingMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.35,
    metalness: 0.3
  });
  const hoverRing = new THREE.Mesh(hoverRingGeo, hoverRingMat);
  hoverRing.position.y = 0.08;
  hoverRing.receiveShadow = true;
  group.add(hoverRing);

  group.position.set(posX, posY, posZ);

  return {
    group,
    bulb,
    dangerRing
  };
}