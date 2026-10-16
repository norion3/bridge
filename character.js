// 3Dキャラクター外観構築・手足メッシュ・スタックプール・トロリー・ホバー展望リフト・スカイダイブ＆トラップドア姿勢管理・スマートネームプレート
import {
  TEAMS,
  MAX_VISUAL_STACK,
  ELEVATOR_CONFIG,
  SKYDIVE_CONFIG,
  TRAPDOOR_CONFIG
} from './constants.js';
import {
  sharedMats,
  blockGeometry,
  playerStackMaterials,
  botRedStackMaterials,
  botYellowStackMaterials,
  updatePlayerStackMaterials,
  elevatorPlatformFloorGeo,
  elevatorHandrailPostGeo,
  elevatorHandrailBarGeo
} from './materials.js';

export let characters = [];
export let player = null;

let soundRef = null;
let updateHUDRef = null;

export function setCharacterCallbacks(sound, updateHUD) {
  soundRef = sound;
  updateHUDRef = updateHUD;
}

// 背景の濃さを適正化し、白い島でも水色階段でも文字が100%際立つ洗練フロスト調ネームプレート
export function createNameplateSprite(nameText, isLocalPlayer = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  // 背景：濃すぎず薄すぎないダークフロスト（透過度約40%で白島でも文字を埋もれさせない）
  ctx.fillStyle = isLocalPlayer ? 'rgba(15, 23, 42, 0.45)' : 'rgba(15, 23, 42, 0.38)';
  ctx.beginPath();
  ctx.roundRect(16, 16, 352, 64, 32);
  ctx.fill();

  // 枠線：自キャラのみ上品なシアン枠
  if (isLocalPlayer) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 2.0;
    ctx.stroke();
  }

  // 文字描画（純白・くっきりシャドウで遠近問わず視認性を最大化）
  const maxTextWidth = 320;
  let fontSize = 34;
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  let textWidth = ctx.measureText(nameText).width;
  while (textWidth > maxTextWidth && fontSize > 16) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    textWidth = ctx.measureText(nameText).width;
  }

  ctx.shadowColor = 'rgba(0, 0, 0, 0.90)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(nameText, 192, 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.55, 1.0);
  return sprite;
}

// 見下ろしカメラ視角に合わせた高さクリアランス拡大 ＆ 全アクション姿勢完全同期
export function updateNameplatePosition(char) {
  if (!char || !char.nameplateSprite) return;

  let targetX = char.pos.x;
  let targetY = char.pos.y;
  let targetZ = char.pos.z;

  const visibleStacks = Math.min(char.stackCount || 0, MAX_VISUAL_STACK);
  const isShrunk = (char.shrinkTimer > 0);

  // ちびキャラ化（shrinkTimer > 0）時のスケール連動
  if (isShrunk) {
    char.nameplateSprite.scale.set(1.2, 0.30, 1.0);
  } else {
    char.nameplateSprite.scale.set(2.2, 0.55, 1.0);
  }

  if (isShrunk) {
    // ちびキャラ時：ミニ頭部（Y=0.6m）のすぐ上にジャスト追従
    targetY = char.pos.y + 0.95;
  } else if (char.onZipline) {
    // ジップライン中（画像8の解消）：滑車バーの上空へしっかり引き上げ
    targetY = char.pos.y + 2.35;
  } else if (char.onSkydive) {
    targetY = char.pos.y + 1.15;
    targetZ = char.pos.z - 0.25;
  } else if (char.onTrapdoor || char.onFreefall) {
    targetY = char.pos.y + 1.85;
  } else if (char.onElevator) {
    const stackH = visibleStacks * 0.44;
    targetY = char.pos.y + (visibleStacks > 0 ? (0.65 + stackH + 0.85) : 1.95);
  } else if (char.stunTimer > 0) {
    targetY = char.pos.y + 1.85;
  } else {
    // 通常時（地上走行・階段建設）
    if (visibleStacks === 0) {
      // ブロック0個時（画像10の解消）：頭部（Y=1.25m）から頭1個分しっかり離す
      targetY = char.pos.y + 1.95;
    } else {
      // ブロック積載時（画像9の解消）：最上段ブロック天面から +0.85m 上空に配置
      targetY = char.pos.y + 0.65 + (visibleStacks * 0.44) + 0.85;
    }
  }

  char.nameplateSprite.position.set(targetX, targetY, targetZ);
}

export function createZiplineTrolleyMesh() {
  const group = new THREE.Group();

  const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.08, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const w1 = new THREE.Mesh(wheelGeo, sharedMats.ziplineTrolley);
  w1.position.set(0, 0.12, -0.20);
  group.add(w1);
  const w2 = w1.clone();
  w2.position.z = 0.20;
  group.add(w2);

  const houseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.14, 0.62), sharedMats.ziplinePylonTrim);
  houseMesh.position.set(0, 0.14, 0);
  group.add(houseMesh);

  const rodH = 0.32;
  const rodGeo = new THREE.CylinderGeometry(0.045, 0.045, rodH, 10);
  const rod = new THREE.Mesh(rodGeo, sharedMats.gateFrame);
  rod.position.set(0, -rodH / 2, 0.08);
  group.add(rod);

  const barWidth = 1.55;
  const barGeo = new THREE.CylinderGeometry(0.052, 0.052, barWidth, 12);
  barGeo.rotateZ(Math.PI / 2);
  const barMesh = new THREE.Mesh(barGeo, sharedMats.ziplineTrolley);
  barMesh.position.set(0, -rodH, 0.08);
  group.add(barMesh);

  const gripRingGeo = new THREE.CylinderGeometry(0.062, 0.062, 0.16, 10);
  gripRingGeo.rotateZ(Math.PI / 2);
  const gLeft = new THREE.Mesh(gripRingGeo, sharedMats.gateFrame);
  gLeft.position.set(-0.74, -rodH, 0.08);
  group.add(gLeft);

  const gRight = new THREE.Mesh(gripRingGeo, sharedMats.gateFrame);
  gRight.position.set(0.74, -rodH, 0.08);
  group.add(gRight);

  const capGeo = new THREE.SphereGeometry(0.085, 12, 12);
  const capL = new THREE.Mesh(capGeo, sharedMats.ziplinePylonTrim);
  capL.position.set(-barWidth / 2, -rodH, 0.08);
  group.add(capL);

  const capR = capL.clone();
  capR.position.x = barWidth / 2;
  group.add(capR);

  return group;
}

// 邪魔なワイヤーを完全撤去したオープンホバー展望リフト
export function createElevatorCageMesh() {
  const lift = new THREE.Group();

  const floorMesh = new THREE.Mesh(elevatorPlatformFloorGeo, sharedMats.elevatorDeckPlate);
  floorMesh.position.y = -0.08;
  floorMesh.castShadow = true;
  floorMesh.receiveShadow = true;
  lift.add(floorMesh);

  const postH = ELEVATOR_CONFIG.LIFT.handrailHeight;
  const corners = [
    [-1.08, -0.88],
    [1.08, -0.88],
    [-1.08, 0.88],
    [1.08, 0.88]
  ];
  corners.forEach(([cx, cz]) => {
    const post = new THREE.Mesh(elevatorHandrailPostGeo, sharedMats.elevatorHandrailSteel);
    post.position.set(cx, postH / 2 - 0.08, cz);
    lift.add(post);
  });

  const backRail = new THREE.Mesh(elevatorHandrailBarGeo, sharedMats.elevatorHandrailSteel);
  backRail.position.set(0, postH - 0.08, -0.88);
  backRail.rotation.z = Math.PI / 2;
  lift.add(backRail);

  const sideBarGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.8, 8);
  sideBarGeo.rotateX(Math.PI / 2);

  const leftSideRail = new THREE.Mesh(sideBarGeo, sharedMats.elevatorHandrailSteel);
  leftSideRail.position.set(-1.08, postH - 0.08, 0);
  lift.add(leftSideRail);

  const rightSideRail = leftSideRail.clone();
  rightSideRail.position.x = 1.08;
  lift.add(rightSideRail);

  const frontGrip = new THREE.Mesh(elevatorHandrailBarGeo, sharedMats.ziplinePylonTrim);
  frontGrip.position.set(0, postH - 0.12, 0.88);
  frontGrip.rotation.z = Math.PI / 2;
  lift.add(frontGrip);

  lift.visible = false;
  return lift;
}

// 合意済みの単色ポップ造形（バイザー・手足アクセントなどの余計な装飾なし）を厳格維持
export function createCharacterMesh(team) {
  const root = new THREE.Group();
  let mat;
  if (team.id === 'blue') mat = sharedMats.charBlue;
  else if (team.id === 'red') mat = sharedMats.charRed;
  else mat = sharedMats.charYellow;

  const bodyGeo = new THREE.SphereGeometry(0.42, 20, 20);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.scale.set(1.0, 1.15, 0.95);
  body.position.y = 0.65;
  body.castShadow = true;
  root.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.50, 24, 24), mat);
  head.position.y = 1.25;
  head.castShadow = true;
  root.add(head);

  const legGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.32, 16);
  const leftLeg = new THREE.Mesh(legGeo, mat);
  leftLeg.position.set(-0.20, 0.16, 0);
  leftLeg.castShadow = true;
  root.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.20;
  rightLeg.castShadow = true;
  root.add(rightLeg);

  const armGeo = new THREE.SphereGeometry(0.16, 16, 16);
  const leftArm = new THREE.Mesh(armGeo, mat);
  leftArm.position.set(-0.48, 0.68, 0);
  leftArm.castShadow = true;
  root.add(leftArm);
  const rightArm = leftArm.clone();
  rightArm.position.x = 0.48;
  rightArm.castShadow = true;
  root.add(rightArm);

  const footAuraGeo = new THREE.RingGeometry(0.38, 0.64, 24);
  footAuraGeo.rotateX(-Math.PI / 2);
  const footAuraMat = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.65,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const footAura = new THREE.Mesh(footAuraGeo, footAuraMat);
  footAura.position.y = 0.05;
  footAura.visible = false;
  root.add(footAura);

  const magnetAuraGeo = new THREE.RingGeometry(0.35, 0.55, 24);
  magnetAuraGeo.rotateX(-Math.PI / 2);
  const magnetAuraMat = sharedMats.magnetInwardRing.clone();
  const magnetAura = new THREE.Mesh(magnetAuraGeo, magnetAuraMat);
  magnetAura.position.y = 0.06;
  magnetAura.visible = false;
  root.add(magnetAura);

  const stackGroup = new THREE.Group();
  stackGroup.position.set(0, 0.65, -0.42);
  root.add(stackGroup);

  const stackPool = [];
  let defaultMat;
  if (team.id === 'red') defaultMat = botRedStackMaterials[0];
  else if (team.id === 'yellow') defaultMat = botYellowStackMaterials[0];
  else defaultMat = playerStackMaterials[0];

  for (let i = 0; i < MAX_VISUAL_STACK; i++) {
    const itemMat = (team.id === 'blue') ? playerStackMaterials[i] : defaultMat;
    const bMesh = new THREE.Mesh(blockGeometry, itemMat);
    bMesh.castShadow = (i < 2);
    const stackHeight = i * 0.44;
    const xOffset = (i % 2 === 0) ? -0.015 : 0.015;
    bMesh.position.set(xOffset, stackHeight, 0);
    bMesh.visible = false;
    stackGroup.add(bMesh);
    stackPool.push(bMesh);
  }

  const trolleyGroup = createZiplineTrolleyMesh();
  trolleyGroup.position.set(0, 2.15, 0);
  trolleyGroup.visible = false;
  root.add(trolleyGroup);

  const elevatorGroup = createElevatorCageMesh();
  elevatorGroup.position.set(0, 0, 0);
  root.add(elevatorGroup);

  return {
    root,
    body,
    head,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    stackGroup,
    trolleyGroup,
    elevatorGroup,
    footAura,
    magnetAura,
    stackPool
  };
}

export function getBrickMaterialForStackIndex(char, index) {
  const safeIdx = Math.min(index, MAX_VISUAL_STACK - 1);
  if (!char.isPlayer) {
    if (char.team.id === 'red') return botRedStackMaterials[safeIdx];
    if (char.team.id === 'yellow') return botYellowStackMaterials[safeIdx];
    return sharedMats.blockNeutral;
  }
  return playerStackMaterials[safeIdx];
}

export function refreshCharacterStackVisuals(char) {
  if (char.isPlayer) {
    updatePlayerStackMaterials(char.stackCount);
  }
  const pool = char.meshObj.stackPool;
  const visibleLimit = Math.min(char.stackCount, MAX_VISUAL_STACK);

  for (let i = 0; i < MAX_VISUAL_STACK; i++) {
    const bMesh = pool[i];
    if (i < visibleLimit) {
      bMesh.visible = true;
      bMesh.material = getBrickMaterialForStackIndex(char, i);
    } else {
      bMesh.visible = false;
    }
  }
}

// スカイダイブ時に頭や体の一部が突き抜けないよう、背中側（-Z方向）に安全にオフセット配置
export function packCharacterLuggage(char, packProgress) {
  if (!char || !char.meshObj || !char.meshObj.stackGroup) return;
  
  const t = Math.max(0, Math.min(1, packProgress));
  const easeT = 1 - Math.pow(1 - t, 3);
  
  const targetScaleX = 0.45, targetScaleY = 0.20, targetScaleZ = 0.45;
  const targetOffsetY = 0.65, targetOffsetZ = -0.48;
  const targetRotX = -0.05;
  
  const curScaleX = 1.0 + (targetScaleX - 1.0) * easeT;
  const curScaleY = 1.0 + (targetScaleY - 1.0) * easeT;
  const curScaleZ = 1.0 + (targetScaleZ - 1.0) * easeT;
  
  const curOffsetY = 0.65 + (targetOffsetY - 0.65) * easeT;
  const curOffsetZ = -0.42 + (targetOffsetZ - -0.42) * easeT;
  const curRotX = 0 + (targetRotX - 0) * easeT;

  char.meshObj.stackGroup.scale.set(curScaleX, curScaleY, curScaleZ);
  char.meshObj.stackGroup.position.set(0, curOffsetY, curOffsetZ);
  char.meshObj.stackGroup.rotation.x = curRotX;
}

export function setStackGhostMode(char, isGhost) {
  char.isGhostStacked = false;
}

// スカイダイブ専用ポーズ（北向き Y=Math.PI、うつ伏せダイブ姿勢）
export function applySkydivePose(char, dirX, rollAngle) {
  char.meshObj.root.rotation.order = 'YXZ';
  char.meshObj.root.rotation.set(1.1, Math.PI, rollAngle);

  char.meshObj.leftArm.position.set(-0.40, 0.46, -0.32);
  char.meshObj.rightArm.position.set(0.40, 0.46, -0.32);
  char.meshObj.leftArm.rotation.set(-1.42, 0, 0.18);
  char.meshObj.rightArm.rotation.set(-1.42, 0, -0.18);

  const timeSec = performance.now() * 0.001;
  const flutter = Math.sin(timeSec * 28) * 0.12;
  char.meshObj.leftLeg.rotation.set(0.12 + flutter, 0, -0.05);
  char.meshObj.rightLeg.rotation.set(0.12 - flutter, 0, 0.05);

  char.meshObj.body.position.y = 0.54;
  char.meshObj.head.position.y = 1.10;
}

// トラップドア専用ポーズ：コミカルな必死の空中ジタバタあがきアニメーション
export function applyTrapdoorPose(char, dirX, timeSec) {
  char.meshObj.root.rotation.order = 'XYZ';
  
  const bodyShake = Math.sin(timeSec * 32) * 0.08;
  char.meshObj.root.rotation.set(0.08 + bodyShake, Math.PI, -dirX * 0.15 + Math.cos(timeSec * 28) * 0.06);

  const armFlapL = Math.sin(timeSec * 30) * 0.65;
  const armFlapR = Math.cos(timeSec * 30) * 0.65;
  char.meshObj.leftArm.position.set(-0.54, 0.78 + Math.sin(timeSec * 28) * 0.08, 0.05);
  char.meshObj.rightArm.position.set(0.54, 0.78 + Math.cos(timeSec * 28) * 0.08, 0.05);
  char.meshObj.leftArm.rotation.set(armFlapL, 0.2, -0.55 + armFlapR * 0.4);
  char.meshObj.rightArm.rotation.set(-armFlapR, -0.2, 0.55 - armFlapL * 0.4);

  const legKickL = Math.sin(timeSec * 34) * 0.75;
  const legKickR = Math.sin(timeSec * 34 + Math.PI) * 0.75;
  char.meshObj.leftLeg.rotation.set(legKickL, 0, -0.12);
  char.meshObj.rightLeg.rotation.set(legKickR, 0, 0.12);

  char.meshObj.body.position.y = 0.65 + Math.sin(timeSec * 32) * 0.03;
  char.meshObj.head.position.y = 1.25 + Math.sin(timeSec * 32) * 0.04;
}

// ニュートラル姿勢への完全リセット
export function resetCharacterPose(char) {
  char.meshObj.root.rotation.order = 'XYZ';
  char.meshObj.root.rotation.set(0, Math.PI, 0);
  char.meshObj.leftArm.position.set(-0.48, 0.68, 0);
  char.meshObj.rightArm.position.set(0.48, 0.68, 0);
  char.meshObj.leftArm.rotation.set(0, 0, 0);
  char.meshObj.rightArm.rotation.set(0, 0, 0);
  char.meshObj.leftLeg.rotation.set(0, 0, 0);
  char.meshObj.rightLeg.rotation.set(0, 0, 0);
  char.meshObj.body.position.y = 0.65;
  char.meshObj.head.position.y = 1.25;
  
  packCharacterLuggage(char, 0);
}

export function addBrickToCharacter(char, team, count = 1, sound = null, updateHUD = null) {
  char.stackCount += count;
  refreshCharacterStackVisuals(char);
  updateNameplatePosition(char);
  const s = sound || soundRef;
  const hud = updateHUD || updateHUDRef;
  if (char.isPlayer) {
    if (s && s.playCollect) s.playCollect(1 + Math.min(char.stackCount * 0.015, 0.8));
    if (hud) hud();
  }
}

export function removeBrickFromCharacter(char, updateHUD = null) {
  if (char.stackCount <= 0) return null;
  char.stackCount--;
  refreshCharacterStackVisuals(char);
  updateNameplatePosition(char);
  const hud = updateHUD || updateHUDRef;
  if (char.isPlayer && hud) hud();
  return true;
}

export function setupCharacters(scene, STAGES) {
  characters.length = 0;

  // 1. ローカルプレイヤーの生成（名前解決: window.GRAVITY_USER_NAME があれば優先、なければ 'YOU'）
  const playerName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME) ? String(window.GRAVITY_USER_NAME) : 'YOU';
  const pMesh = createCharacterMesh(TEAMS.BLUE);
  pMesh.root.rotation.set(0, Math.PI, 0);
  scene.add(pMesh.root);

  const pNameplate = createNameplateSprite(playerName, true);
  scene.add(pNameplate);

  player = {
    isPlayer: true,
    name: playerName,
    nameplateSprite: pNameplate,
    team: TEAMS.BLUE,
    meshObj: pMesh,
    pos: new THREE.Vector3(0, STAGES[0].y, STAGES[0].z + 4),
    rotation: Math.PI,
    stackCount: 0,
    currentStage: 0,
    stunTimer: 0,
    shrinkTimer: 0,
    invulnerableTimer: 0,
    walkCycle: 0,
    isJumping: false,
    activeJumpTier: null,
    onSlide: false,
    onCurvedSlide: false,
    curvedSlideProgress: 0,
    curvedSlideOffset: 0,
    slideCooldown: 0,
    onZipline: false,
    ziplineProgress: 0,
    activeZipline: null,
    onElevator: false,
    elevatorProgress: 0,
    activeElevator: null,
    elevatorLane: 0,
    elevatorExiting: false,
    elevatorExitTimer: 0,

    onSkydive: false,
    skydiveProgress: 0,
    activeSkydive: null,
    skydiveX: 0,
    skydiveRoll: 0,

    onTrapdoor: false,
    trapdoorProgress: 0,
    activeTrapdoor: null,
    trapdoorX: 0,

    onFreefall: false,
    freefallProgress: 0,
    activeFreefall: null,
    freefallX: 0,
    freefallRoll: 0,

    isGhostStacked: false,
    jumpProgress: 0,
    lastPlankIdx: -1,
    speedBoostActive: false,
    speedBoostTimer: 0,
    puffTimer: 0,
    magnetActive: false,
    magnetTimer: 0
  };
  pMesh.root.position.copy(player.pos);
  updateNameplatePosition(player);
  characters.push(player);

  // 2. 赤Bot（CPU 1）の生成
  const b1Mesh = createCharacterMesh(TEAMS.RED);
  b1Mesh.root.rotation.set(0, Math.PI, 0);
  scene.add(b1Mesh.root);

  const b1Nameplate = createNameplateSprite('CPU 1', false);
  scene.add(b1Nameplate);

  const bot1 = {
    isPlayer: false,
    name: 'CPU 1',
    nameplateSprite: b1Nameplate,
    team: TEAMS.RED,
    meshObj: b1Mesh,
    pos: new THREE.Vector3(-4.0, STAGES[0].y, STAGES[0].z + 4),
    rotation: Math.PI,
    stackCount: 0,
    currentStage: 0,
    aiState: 'COLLECT',
    aiCapacityGoal: 15,
    stunTimer: 0,
    shrinkTimer: 0,
    invulnerableTimer: 0,
    walkCycle: 0,
    isJumping: false,
    activeJumpTier: null,
    onSlide: false,
    onCurvedSlide: false,
    curvedSlideProgress: 0,
    curvedSlideOffset: 0,
    slideCooldown: 0,
    onZipline: false,
    ziplineProgress: 0,
    activeZipline: null,
    onElevator: false,
    elevatorProgress: 0,
    activeElevator: null,
    elevatorLane: 0,
    elevatorChoice: undefined,
    elevatorExiting: false,
    elevatorExitTimer: 0,

    onSkydive: false,
    skydiveProgress: 0,
    activeSkydive: null,
    skydiveX: 0,
    skydiveRoll: 0,

    onTrapdoor: false,
    trapdoorProgress: 0,
    activeTrapdoor: null,
    trapdoorX: 0,

    onFreefall: false,
    freefallProgress: 0,
    activeFreefall: null,
    freefallX: 0,
    freefallRoll: 0,

    isGhostStacked: false,
    jumpProgress: 0,
    lastPlankIdx: -1,
    botSlideOffsetTarget: 0,
    speedBoostActive: false,
    speedBoostTimer: 0,
    puffTimer: 0,
    magnetActive: false,
    magnetTimer: 0,
    aiDirX: 0,
    aiDirZ: -1,
    searchCooldown: 0,
    targetBlock: null
  };
  b1Mesh.root.position.copy(bot1.pos);
  updateNameplatePosition(bot1);
  characters.push(bot1);

  // 3. 黄Bot（CPU 2）の生成
  const b2Mesh = createCharacterMesh(TEAMS.YELLOW);
  b2Mesh.root.rotation.set(0, Math.PI, 0);
  scene.add(b2Mesh.root);

  const b2Nameplate = createNameplateSprite('CPU 2', false);
  scene.add(b2Nameplate);

  const bot2 = {
    isPlayer: false,
    name: 'CPU 2',
    nameplateSprite: b2Nameplate,
    team: TEAMS.YELLOW,
    meshObj: b2Mesh,
    pos: new THREE.Vector3(4.0, STAGES[0].y, STAGES[0].z + 4),
    rotation: Math.PI,
    stackCount: 0,
    currentStage: 0,
    aiState: 'COLLECT',
    aiCapacityGoal: 17,
    stunTimer: 0,
    shrinkTimer: 0,
    invulnerableTimer: 0,
    walkCycle: 0,
    isJumping: false,
    activeJumpTier: null,
    onSlide: false,
    onCurvedSlide: false,
    curvedSlideProgress: 0,
    curvedSlideOffset: 0,
    slideCooldown: 0,
    onZipline: false,
    ziplineProgress: 0,
    activeZipline: null,
    onElevator: false,
    elevatorProgress: 0,
    activeElevator: null,
    elevatorLane: 0,
    elevatorChoice: undefined,
    elevatorExiting: false,
    elevatorExitTimer: 0,

    onSkydive: false,
    skydiveProgress: 0,
    activeSkydive: null,
    skydiveX: 0,
    skydiveRoll: 0,

    onTrapdoor: false,
    trapdoorProgress: 0,
    activeTrapdoor: null,
    trapdoorX: 0,

    onFreefall: false,
    freefallProgress: 0,
    activeFreefall: null,
    freefallX: 0,
    freefallRoll: 0,

    isGhostStacked: false,
    jumpProgress: 0,
    lastPlankIdx: -1,
    botSlideOffsetTarget: 0,
    speedBoostActive: false,
    speedBoostTimer: 0,
    puffTimer: 0,
    magnetActive: false,
    magnetTimer: 0,
    aiDirX: 0,
    aiDirZ: -1,
    searchCooldown: 0.06,
    targetBlock: null
  };
  b2Mesh.root.position.copy(bot2.pos);
  updateNameplatePosition(bot2);
  characters.push(bot2);

  return { player, characters };
}

export function resetCharacters(STAGES) {
  characters.forEach(c => {
    c.stackCount = 0;
    refreshCharacterStackVisuals(c);
    c.stunTimer = 0;
    c.shrinkTimer = 0;
    c.meshObj.root.scale.set(1.0, 1.0, 1.0);
    c.invulnerableTimer = 0;
    c.currentStage = 0;
    c.isJumping = false;
    c.activeJumpTier = null;
    c.onSlide = false;
    c.onCurvedSlide = false;
    c.curvedSlideProgress = 0;
    c.curvedSlideOffset = 0;
    c.slideCooldown = 0;
    c.onZipline = false;
    c.ziplineProgress = 0;
    c.activeZipline = null;
    c.onElevator = false;
    c.elevatorProgress = 0;
    c.activeElevator = null;
    c.elevatorExiting = false;
    c.elevatorExitTimer = 0;

    c.onSkydive = false;
    c.skydiveProgress = 0;
    c.activeSkydive = null;
    c.skydiveX = 0;
    c.skydiveRoll = 0;

    c.onTrapdoor = false;
    c.trapdoorProgress = 0;
    c.activeTrapdoor = null;
    c.trapdoorX = 0;

    c.onFreefall = false;
    c.freefallProgress = 0;
    c.activeFreefall = null;
    c.freefallX = 0;
    c.freefallRoll = 0;

    c.isGhostStacked = false;
    c.lastPlankIdx = -1;
    c.speedBoostActive = false;
    c.speedBoostTimer = 0;
    c.puffTimer = 0;
    c.magnetActive = false;
    c.magnetTimer = 0;

    if (c.meshObj.footAura) c.meshObj.footAura.visible = false;
    if (c.meshObj.magnetAura) c.meshObj.magnetAura.visible = false;

    if (!c.isPlayer) {
      c.botSlideOffsetTarget = 0;
      c.aiDirX = 0;
      c.aiDirZ = -1;
      c.searchCooldown = (c.team.id === 'red') ? 0 : 0.06;
      c.targetBlock = null;
      c.elevatorChoice = undefined;
    }

    c.meshObj.trolleyGroup.visible = false;
    c.meshObj.elevatorGroup.visible = false;
    
    resetCharacterPose(c);
  });

  if (player && STAGES[0]) {
    player.pos.set(0, STAGES[0].y, STAGES[0].z + 4);
    player.meshObj.root.position.copy(player.pos);
    updateNameplatePosition(player);
  }
  if (characters[1] && STAGES[0]) {
    characters[1].pos.set(-4.0, STAGES[0].y, STAGES[0].z + 4);
    characters[1].meshObj.root.position.copy(characters[1].pos);
    updateNameplatePosition(characters[1]);
  }
  if (characters[2] && STAGES[0]) {
    characters[2].pos.set(4.0, STAGES[0].y, STAGES[0].z + 4);
    characters[2].meshObj.root.position.copy(characters[2].pos);
    updateNameplatePosition(characters[2]);
  }
}