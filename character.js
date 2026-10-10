// 3Dキャラクター外観構築・手足メッシュ・スタックプール・トロリー・姿勢管理
import { TEAMS, MAX_VISUAL_STACK } from './constants.js';
import {
  sharedMats,
  blockGeometry,
  playerStackMaterials,
  updatePlayerStackMaterials
} from './materials.js';

export let characters = [];
export let player = null;

let soundRef = null;
let updateHUDRef = null;

export function setCharacterCallbacks(sound, updateHUD) {
  soundRef = sound;
  updateHUDRef = updateHUD;
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
  if (team.id === 'red') defaultMat = sharedMats.blockRed;
  else if (team.id === 'yellow') defaultMat = sharedMats.blockYellow;
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

  const elevatorGroup = new THREE.Group();
  const platGeo = new THREE.BoxGeometry(2.0, 0.15, 2.0);
  const platMesh = new THREE.Mesh(platGeo, sharedMats.gateFrame);
  platMesh.position.y = -0.075;
  platMesh.castShadow = true;
  elevatorGroup.add(platMesh);

  const pipeGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.0, 8);
  pipeGeo.rotateZ(Math.PI / 2);
  const p1 = new THREE.Mesh(pipeGeo, sharedMats.slideRail);
  p1.position.set(0, 0.6, -0.9);
  elevatorGroup.add(p1);
  const p2 = p1.clone();
  p2.position.set(0, 0.6, 0.9);
  elevatorGroup.add(p2);
  
  const hangerGeo = new THREE.CylinderGeometry(0.03, 0.03, 3.2, 8);
  const hanger = new THREE.Mesh(hangerGeo, sharedMats.slideRail);
  hanger.position.set(0, 1.6, 0);
  elevatorGroup.add(hanger);

  elevatorGroup.visible = false;
  root.add(elevatorGroup);

  return { root, body, head, leftLeg, rightLeg, leftArm, rightArm, stackGroup, trolleyGroup, elevatorGroup, footAura, magnetAura, stackPool };
}

export function getBrickMaterialForStackIndex(char, index) {
  if (!char.isPlayer) {
    if (char.team.id === 'red') return sharedMats.blockRed;
    if (char.team.id === 'yellow') return sharedMats.blockYellow;
    return sharedMats.blockNeutral;
  }
  return playerStackMaterials[Math.min(index, MAX_VISUAL_STACK - 1)];
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

export function addBrickToCharacter(char, team, count = 1, sound = null, updateHUD = null) {
  char.stackCount += count;
  refreshCharacterStackVisuals(char);
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
  const hud = updateHUD || updateHUDRef;
  if (char.isPlayer && hud) hud();
  return true;
}

export function setupCharacters(scene, STAGES) {
  characters.length = 0;
  const pMesh = createCharacterMesh(TEAMS.BLUE);
  scene.add(pMesh.root);
  player = {
    isPlayer: true, team: TEAMS.BLUE, meshObj: pMesh,
    pos: new THREE.Vector3(0, STAGES[0].y, STAGES[0].z + 4),
    rotation: 0, stackCount: 0, currentStage: 0, stunTimer: 0, invulnerableTimer: 0, walkCycle: 0,
    isJumping: false, activeJumpTier: null, onSlide: false, onCurvedSlide: false, curvedSlideProgress: 0, curvedSlideOffset: 0, slideCooldown: 0,
    onZipline: false, ziplineProgress: 0, activeZipline: null,
    onElevator: false, elevatorProgress: 0, activeElevator: null, elevatorLane: 0,
    // ★ ステップ2: フリーフォール用のステート追加
    onFreefall: false, freefallProgress: 0, activeFreefall: null, freefallX: 0,
    jumpProgress: 0, lastPlankIdx: -1,
    speedBoostActive: false, speedBoostTimer: 0, puffTimer: 0,
    magnetActive: false, magnetTimer: 0
  };
  pMesh.root.position.copy(player.pos);
  characters.push(player);

  const b1Mesh = createCharacterMesh(TEAMS.RED);
  scene.add(b1Mesh.root);
  const bot1 = {
    isPlayer: false, team: TEAMS.RED, meshObj: b1Mesh,
    pos: new THREE.Vector3(-4.0, STAGES[0].y, STAGES[0].z + 4),
    rotation: 0, stackCount: 0, currentStage: 0,
    aiState: 'COLLECT', aiCapacityGoal: 15, stunTimer: 0, invulnerableTimer: 0, walkCycle: 0,
    isJumping: false, activeJumpTier: null, onSlide: false, onCurvedSlide: false, curvedSlideProgress: 0, curvedSlideOffset: 0, slideCooldown: 0,
    onZipline: false, ziplineProgress: 0, activeZipline: null,
    onElevator: false, elevatorProgress: 0, activeElevator: null, elevatorLane: 0, elevatorChoice: undefined,
    onFreefall: false, freefallProgress: 0, activeFreefall: null, freefallX: 0,
    jumpProgress: 0, lastPlankIdx: -1, botSlideOffsetTarget: 0,
    speedBoostActive: false, speedBoostTimer: 0, puffTimer: 0,
    magnetActive: false, magnetTimer: 0,
    aiDirX: 0, aiDirZ: -1,
    searchCooldown: 0, targetBlock: null
  };
  b1Mesh.root.position.copy(bot1.pos);
  characters.push(bot1);

  const b2Mesh = createCharacterMesh(TEAMS.YELLOW);
  scene.add(b2Mesh.root);
  const bot2 = {
    isPlayer: false, team: TEAMS.YELLOW, meshObj: b2Mesh,
    pos: new THREE.Vector3(4.0, STAGES[0].y, STAGES[0].z + 4),
    rotation: 0, stackCount: 0, currentStage: 0,
    aiState: 'COLLECT', aiCapacityGoal: 17, stunTimer: 0, invulnerableTimer: 0, walkCycle: 0,
    isJumping: false, activeJumpTier: null, onSlide: false, onCurvedSlide: false, curvedSlideProgress: 0, curvedSlideOffset: 0, slideCooldown: 0,
    onZipline: false, ziplineProgress: 0, activeZipline: null,
    onElevator: false, elevatorProgress: 0, activeElevator: null, elevatorLane: 0, elevatorChoice: undefined,
    onFreefall: false, freefallProgress: 0, activeFreefall: null, freefallX: 0,
    jumpProgress: 0, lastPlankIdx: -1, botSlideOffsetTarget: 0,
    speedBoostActive: false, speedBoostTimer: 0, puffTimer: 0,
    magnetActive: false, magnetTimer: 0,
    aiDirX: 0, aiDirZ: -1,
    searchCooldown: 0.06, targetBlock: null
  };
  b2Mesh.root.position.copy(bot2.pos);
  characters.push(bot2);

  return { player, characters };
}

export function resetCharacters(STAGES) {
  characters.forEach(c => {
    c.stackCount = 0;
    refreshCharacterStackVisuals(c);
    c.stunTimer = 0; c.invulnerableTimer = 0; c.currentStage = 0;
    c.isJumping = false; c.activeJumpTier = null;
    c.onSlide = false;
    c.onCurvedSlide = false; c.curvedSlideProgress = 0; c.curvedSlideOffset = 0; c.slideCooldown = 0;
    c.onZipline = false; c.ziplineProgress = 0; c.activeZipline = null;
    c.onElevator = false; c.elevatorProgress = 0; c.activeElevator = null;
    c.onFreefall = false; c.freefallProgress = 0; c.activeFreefall = null; c.freefallX = 0;
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
    c.meshObj.stackGroup.scale.set(1.0, 1.0, 1.0);
    c.meshObj.stackGroup.rotation.x = 0;
    c.meshObj.stackGroup.position.set(0, 0.65, -0.42);

    c.meshObj.leftArm.position.set(-0.48, 0.68, 0);
    c.meshObj.rightArm.position.set(0.48, 0.68, 0);
    c.meshObj.leftArm.scale.set(1.0, 1.0, 1.0);
    c.meshObj.rightArm.scale.set(1.0, 1.0, 1.0);
    c.meshObj.leftArm.rotation.set(0, 0, 0);
    c.meshObj.rightArm.rotation.set(0, 0, 0);
    c.meshObj.leftLeg.rotation.set(0, 0, 0);
    c.meshObj.rightLeg.rotation.set(0, 0, 0);
    c.meshObj.body.position.y = 0.65;
    c.meshObj.head.position.y = 1.25;
  });
  if (player && STAGES[0]) {
    player.pos.set(0, STAGES[0].y, STAGES[0].z + 4);
    player.meshObj.root.position.copy(player.pos);
  }
  if (characters[1] && STAGES[0]) {
    characters[1].pos.set(-4.0, STAGES[0].y, STAGES[0].z + 4);
    characters[1].meshObj.root.position.copy(characters[1].pos);
  }
  if (characters[2] && STAGES[0]) {
    characters[2].pos.set(4.0, STAGES[0].y, STAGES[0].z + 4);
    characters[2].meshObj.root.position.copy(characters[2].pos);
  }
}