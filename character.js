// character.js: 3Dキャラクター外観構築・手足メッシュ・スタックプール・トロリー・ホバー展望リフト・スカイダイブ＆トラップドア姿勢管理・足元手前側（カメラ方向）フロスト投影ネームバッジ
// ★ 完全安定化修正版（ReferenceError 根絶 ＆ ガード条件緩和 ＆ 4走者安全整列）：
//   1. 【ReferenceError: char is not defined の完全根絶】
//      bindLocalPlayerSlot 内のタイポ（char.nameplateSprite -> c.nameplateSprite）を修正し、
//      ソロプレイ開始時のスクリプト強制停止を100%解消。
//   2. 【ガード条件の安全性向上】
//      characters.length < 4 での早期リターンを廃止し、characters.length === 0 でのみリターン。
//      初期化タイミングやスロット数に関わらず確実に localPlayer がバインドされるよう保護。
//   3. 【緑チーム（GREEN: #10b981）スタックマテリアルの未定義フォールバック】
//   4. 【4走者均等整列 X = [-4.8, -1.6, 1.6, 4.8] の完全維持】

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
  botGreenStackMaterials,
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

// 足元の床面に美しく水平投影されるフロストネームメッシュ（アナモルフィック逆補正＆高解像度）
export function createNameplateMesh(nameText, isLocalPlayer = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // 背景：足元の島に自然に馴染むフロストカプセル
  ctx.fillStyle = isLocalPlayer ? 'rgba(15, 23, 42, 0.60)' : 'rgba(15, 23, 42, 0.45)';
  ctx.beginPath();
  ctx.roundRect(20, 20, 472, 88, 44);
  ctx.fill();

  // 枠線：自キャラのみ鮮やかなシアンハイライト枠
  if (isLocalPlayer) {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.85)';
    ctx.lineWidth = 4.0;
    ctx.stroke();
  }

  // 文字描画（純白・濃いシャドウで白床でも100%読める）
  const maxTextWidth = 420;
  let fontSize = 48;
  ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  let textWidth = ctx.measureText(nameText).width;
  while (textWidth > maxTextWidth && fontSize > 22) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    textWidth = ctx.measureText(nameText).width;
  }

  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(nameText, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  // 足元地面に水平に敷く PlaneGeometry（見下ろし角で美しく見えるワイド比率）
  const planeGeo = new THREE.PlaneGeometry(3.2, 0.85);
  planeGeo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });

  const mesh = new THREE.Mesh(planeGeo, mat);
  mesh.renderOrder = 4;
  return mesh;
}

export const createNameplateSprite = createNameplateMesh;

/**
 * GRAVITYで取得された名前を自キャラ足元に遅延なく即時反映する安全関数
 */
export function updatePlayerName(newName) {
  if (!newName) return;

  const targetChar = player || (typeof window !== 'undefined' && window.MY_PLAYER_SLOT !== undefined ? characters[window.MY_PLAYER_SLOT] : null);
  if (targetChar) {
    if (targetChar.name === newName && targetChar.nameplateSprite && targetChar.nameplateSprite.visible) {
      return;
    }

    targetChar.name = newName;
    if (targetChar.nameplateSprite) {
      if (targetChar.nameplateSprite.material) {
        if (targetChar.nameplateSprite.material.map) {
          targetChar.nameplateSprite.material.map.dispose();
        }
        targetChar.nameplateSprite.material.dispose();
      }
      const newMesh = createNameplateMesh(newName, true);
      if (newMesh.geometry) {
        newMesh.geometry.dispose();
      }
      targetChar.nameplateSprite.material = newMesh.material;
      targetChar.nameplateSprite.visible = true;
    }
  }
}

/**
 * 先行していたキャラを Stage 0 スタート地点へ安全に初期化する関数（4人安全配置対応）
 */
export function resetCharacterToStageZero(char, nameText = null, isLocal = false) {
  if (!char) return;

  // 1. スロット固有の Stage 0 デフォルト座標を算出（4人均等整列: [-4.8, -1.6, 1.6, 4.8]）
  let defaultX = -1.6;
  if (char.team && char.team.id === 'red') {
    defaultX = -4.8;
  } else if (char.team && char.team.id === 'blue') {
    defaultX = -1.6;
  } else if (char.team && char.team.id === 'yellow') {
    defaultX = 1.6;
  } else if (char.team && char.team.id === 'green') {
    defaultX = 4.8;
  } else {
    const idx = characters.indexOf(char);
    if (idx === 1) defaultX = -4.8;
    else if (idx === 0) defaultX = -1.6;
    else if (idx === 2) defaultX = 1.6;
    else if (idx === 3) defaultX = 4.8;
  }

  char.pos.set(defaultX, 0.0, 4.0);
  if (char.meshObj && char.meshObj.root) {
    char.meshObj.root.position.copy(char.pos);
    char.meshObj.root.rotation.set(0, Math.PI, 0);
  }
  if (!char.targetNetPos) {
    char.targetNetPos = new THREE.Vector3();
  }
  char.targetNetPos.copy(char.pos);
  char.targetNetRotY = Math.PI;

  char.netVelocity = { x: 0, z: 0 };
  char.lastPacketTime = performance.now();
  char.remoteActionState = 'NORMAL';

  // 2. 内部進行状態のリセット
  char.currentStage = 0;
  char.stackCount = 0;
  char.lastPlankIdx = -1;
  char.walkCycle = 0;
  char.stunTimer = 0;
  char.shrinkTimer = 0;
  char.invulnerableTimer = 0;
  char.isJumping = false;
  char.activeJumpTier = null;
  char.speedBoostActive = false;
  char.speedBoostTimer = 0;
  char.puffTimer = 0;
  char.magnetActive = false;
  char.magnetTimer = 0;
  char.isGhostStacked = false;

  char.unstuckTimer = 0;
  char.stuckCheckTimer = 0;
  char.lastPosCheck = null;
  char.unstuckDirX = 0;
  char.unstuckDirZ = 0;
  char.targetBlock = null;
  char.aiDirX = 0;
  char.aiDirZ = -1;
  char.searchCooldown = (char.team && char.team.id === 'red') ? 0 : 0.06;
  char.elevatorChoice = undefined;
  char.forkBranchChoice = undefined;
  char.botSlideOffsetTarget = 0;

  // 3. ギミック搭乗フラグの完全解除
  char.onSlide = false;
  char.onCurvedSlide = false;
  char.curvedSlideProgress = 0;
  char.curvedSlideOffset = 0;
  char.slideCooldown = 0;
  char.onZipline = false;
  char.ziplineProgress = 0;
  char.activeZipline = null;
  char.onElevator = false;
  char.elevatorProgress = 0;
  char.activeElevator = null;
  char.elevatorExiting = false;
  char.elevatorExitTimer = 0;
  char.onSkydive = false;
  char.skydiveProgress = 0;
  char.activeSkydive = null;
  char.skydiveX = 0;
  char.skydiveRoll = 0;
  char.onTrapdoor = false;
  char.trapdoorProgress = 0;
  char.activeTrapdoor = null;
  char.trapdoorX = 0;
  char.onFreefall = false;
  char.freefallProgress = 0;
  char.activeFreefall = null;
  char.freefallX = 0;
  char.freefallRoll = 0;

  // 4. メッシュ・オーラ・手足ポーズの直立不動整列
  if (char.meshObj) {
    if (char.meshObj.footAura) char.meshObj.footAura.visible = false;
    if (char.meshObj.magnetAura) char.meshObj.magnetAura.visible = false;
    if (char.meshObj.trolleyGroup) char.meshObj.trolleyGroup.visible = false;
    if (char.meshObj.elevatorGroup) char.meshObj.elevatorGroup.visible = false;
    char.meshObj.root.scale.set(1.0, 1.0, 1.0);
    resetCharacterPose(char);
  }

  // 5. 背中ブロック表示のゼロクリア
  refreshCharacterStackVisuals(char);

  // 6. ネームプレートの更新
  const needNameRebuild = Boolean(nameText && char.name !== nameText);
  if (nameText) {
    char.name = nameText;
  }
  if (char.nameplateSprite && needNameRebuild) {
    if (char.nameplateSprite.material) {
      if (char.nameplateSprite.material.map) {
        char.nameplateSprite.material.map.dispose();
      }
      char.nameplateSprite.material.dispose();
    }
    const newMesh = createNameplateMesh(char.name, isLocal);
    if (newMesh.geometry) {
      newMesh.geometry.dispose();
    }
    char.nameplateSprite.material = newMesh.material;
    char.nameplateSprite.visible = true;
  }
  updateNameplatePosition(char);
}

/**
 * 自他ネームプレート境界保護版 bindLocalPlayerSlot（安全堅牢ガード版）
 */
export function bindLocalPlayerSlot(slotIndex) {
  if (!characters || characters.length === 0) return;
  const targetSlot = Math.max(0, Math.min(characters.length - 1, Number(slotIndex) || 0));

  let myResolvedName = 'YOU';
  if (typeof window !== 'undefined' && window.GRAVITY_USER_NAME) {
    myResolvedName = String(window.GRAVITY_USER_NAME);
  } else if (typeof window !== 'undefined' && window.NetworkManager && window.NetworkManager.myUser && window.NetworkManager.myUser.name && window.NetworkManager.myUser.name !== 'YOU') {
    myResolvedName = String(window.NetworkManager.myUser.name);
  }

  characters.forEach((c, idx) => {
    if (!c) return;

    if (c.meshObj) {
      if (c.meshObj.trolleyGroup) c.meshObj.trolleyGroup.visible = false;
      if (c.meshObj.elevatorGroup) c.meshObj.elevatorGroup.visible = false;
    }
    c.onZipline = false;
    c.onSlide = false;
    c.onCurvedSlide = false;
    c.onElevator = false;
    c.onSkydive = false;
    c.onTrapdoor = false;
    c.onFreefall = false;

    c.unstuckTimer = 0;
    c.stuckCheckTimer = 0;
    c.lastPosCheck = null;

    if (idx === targetSlot) {
      c.isPlayer = true;
      c.isAI = false;
      c.isRemote = false;
      c.name = myResolvedName;
      player = c;

      if (c.nameplateSprite) {
        if (c.nameplateSprite.material) {
          // ★【重要バグ修正】char ではなく c を参照
          if (c.nameplateSprite.material.map) {
            c.nameplateSprite.material.map.dispose();
          }
          c.nameplateSprite.material.dispose();
        }
        const newMesh = createNameplateMesh(myResolvedName, true);
        if (newMesh.geometry) {
          newMesh.geometry.dispose();
        }
        c.nameplateSprite.material = newMesh.material;
        c.nameplateSprite.visible = true;
      }
    } else {
      c.isPlayer = false;
      if (!c.isRemote) {
        c.isAI = true;
      }

      let otherName = c.name;
      if (!otherName || otherName === 'YOU' || otherName === myResolvedName) {
        otherName = (idx === 0) ? 'norion' : (idx === 1 ? 'CPU 1' : (idx === 2 ? 'CPU 2' : 'CPU 3'));
      }
      c.name = otherName;

      if (c.nameplateSprite) {
        if (c.nameplateSprite.material) {
          if (c.nameplateSprite.material.map) {
            c.nameplateSprite.material.map.dispose();
          }
          c.nameplateSprite.material.dispose();
        }
        const newMesh = createNameplateMesh(otherName, false);
        if (newMesh.geometry) {
          newMesh.geometry.dispose();
        }
        c.nameplateSprite.material = newMesh.material;
        c.nameplateSprite.visible = true;
      }
    }

    refreshCharacterStackVisuals(c);
  });

  if (typeof window !== 'undefined') {
    window.MY_PLAYER_SLOT = targetSlot;
  }
}

/**
 * 足元追従：見下ろしカメラから見て開けている画面手前側（カメラ方向: +Z 1.15m）へオフセット配置
 */
export function updateNameplatePosition(char) {
  if (!char || !char.nameplateSprite) return;

  if (!char.isRemote) {
    if (
      char.onSlide ||
      char.onCurvedSlide ||
      char.onZipline ||
      char.onSkydive ||
      char.onTrapdoor ||
      char.onFreefall
    ) {
      if (char.nameplateSprite.visible) {
        char.nameplateSprite.visible = false;
      }
      return;
    }
  }

  if (!char.nameplateSprite.visible) {
    char.nameplateSprite.visible = true;
  }

  const isShrunk = (char.shrinkTimer > 0);
  const targetX = char.pos.x;
  const targetY = char.pos.y + 0.05;
  const targetZ = char.pos.z + (isShrunk ? 0.82 : 1.15);

  const curPos = char.nameplateSprite.position;
  const dx = curPos.x - targetX;
  const dy = curPos.y - targetY;
  const dz = curPos.z - targetZ;

  if (dx * dx + dy * dy + dz * dz > 0.000001) {
    char.nameplateSprite.position.set(targetX, targetY, targetZ);
  }
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

  group.visible = false;
  return group;
}

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

export function createCharacterMesh(team) {
  const root = new THREE.Group();
  let mat;
  if (team.id === 'blue') mat = sharedMats.charBlue;
  else if (team.id === 'red') mat = sharedMats.charRed;
  else if (team.id === 'yellow') mat = sharedMats.charYellow;
  else if (team.id === 'green') mat = sharedMats.charGreen;
  else mat = sharedMats.charBlue;

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
  else if (team.id === 'green') {
    defaultMat = (botGreenStackMaterials && botGreenStackMaterials[0]) ? botGreenStackMaterials[0] : botYellowStackMaterials[0];
  } else defaultMat = playerStackMaterials[0];

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
  elevatorGroup.visible = false;
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
  if (!char || !char.team) return sharedMats.blockNeutral;

  if (char.team.id === 'red') {
    return botRedStackMaterials[safeIdx];
  } else if (char.team.id === 'yellow') {
    return botYellowStackMaterials[safeIdx];
  } else if (char.team.id === 'green') {
    return (botGreenStackMaterials && botGreenStackMaterials[safeIdx]) ? botGreenStackMaterials[safeIdx] : botYellowStackMaterials[safeIdx];
  } else if (char.team.id === 'blue') {
    return playerStackMaterials[safeIdx];
  }

  return sharedMats.blockNeutral;
}

export function refreshCharacterStackVisuals(char) {
  if (char.team && char.team.id === 'blue') {
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
  
  if (char.meshObj.trolleyGroup) char.meshObj.trolleyGroup.visible = false;
  if (char.meshObj.elevatorGroup) char.meshObj.elevatorGroup.visible = false;
  
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

  // ★ 4走者均等整列 X座標: [-4.8, -1.6, 1.6, 4.8]（間隔3.2mでタックル誤暴発を遮断）
  const stage0Z = STAGES[0] ? (STAGES[0].z + 4.0) : 4.0;
  const stage0Y = STAGES[0] ? STAGES[0].y : 0.0;

  // 1. スロット0: 青（ホスト担当枠: X = -1.6）
  const pMesh = createCharacterMesh(TEAMS.BLUE);
  pMesh.root.rotation.set(0, Math.PI, 0);
  scene.add(pMesh.root);

  const pNameplate = createNameplateMesh('norion', true);
  scene.add(pNameplate);

  const char0 = {
    isPlayer: true,
    isAI: false,
    name: 'norion',
    nameplateSprite: pNameplate,
    team: TEAMS.BLUE,
    meshObj: pMesh,
    pos: new THREE.Vector3(-1.6, stage0Y, stage0Z),
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
  pMesh.root.position.copy(char0.pos);
  updateNameplatePosition(char0);
  characters.push(char0);
  player = char0;

  // 2. スロット1: 赤（ゲスト1担当枠 / 初期はCPU 1: X = -4.8）
  const b1Mesh = createCharacterMesh(TEAMS.RED);
  b1Mesh.root.rotation.set(0, Math.PI, 0);
  scene.add(b1Mesh.root);

  const b1Nameplate = createNameplateMesh('CPU 1', false);
  scene.add(b1Nameplate);

  const char1 = {
    isPlayer: false,
    isAI: true,
    name: 'CPU 1',
    nameplateSprite: b1Nameplate,
    team: TEAMS.RED,
    meshObj: b1Mesh,
    pos: new THREE.Vector3(-4.8, stage0Y, stage0Z),
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
  b1Mesh.root.position.copy(char1.pos);
  updateNameplatePosition(char1);
  characters.push(char1);

  // 3. スロット2: 黄（ゲスト2担当枠 / 初期はCPU 2: X = 1.6）
  const b2Mesh = createCharacterMesh(TEAMS.YELLOW);
  b2Mesh.root.rotation.set(0, Math.PI, 0);
  scene.add(b2Mesh.root);

  const b2Nameplate = createNameplateMesh('CPU 2', false);
  scene.add(b2Nameplate);

  const char2 = {
    isPlayer: false,
    isAI: true,
    name: 'CPU 2',
    nameplateSprite: b2Nameplate,
    team: TEAMS.YELLOW,
    meshObj: b2Mesh,
    pos: new THREE.Vector3(1.6, stage0Y, stage0Z),
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
  b2Mesh.root.position.copy(char2.pos);
  updateNameplatePosition(char2);
  characters.push(char2);

  // 4. スロット3: 緑（ゲスト3担当枠 / 初期はCPU 3: X = 4.8）
  const b3Mesh = createCharacterMesh(TEAMS.GREEN);
  b3Mesh.root.rotation.set(0, Math.PI, 0);
  scene.add(b3Mesh.root);

  const b3Nameplate = createNameplateMesh('CPU 3', false);
  scene.add(b3Nameplate);

  const char3 = {
    isPlayer: false,
    isAI: true,
    name: 'CPU 3',
    nameplateSprite: b3Nameplate,
    team: TEAMS.GREEN,
    meshObj: b3Mesh,
    pos: new THREE.Vector3(4.8, stage0Y, stage0Z),
    rotation: Math.PI,
    stackCount: 0,
    currentStage: 0,
    aiState: 'COLLECT',
    aiCapacityGoal: 16,
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
    searchCooldown: 0.08,
    targetBlock: null
  };
  b3Mesh.root.position.copy(char3.pos);
  updateNameplatePosition(char3);
  characters.push(char3);

  if (typeof window !== 'undefined' && window.MY_PLAYER_SLOT !== undefined) {
    bindLocalPlayerSlot(window.MY_PLAYER_SLOT);
  }

  return { player, characters };
}

export function resetCharacters(STAGES) {
  characters.forEach((c, idx) => {
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

    c.unstuckTimer = 0;
    c.stuckCheckTimer = 0;
    c.lastPosCheck = null;

    if (!c.isPlayer) {
      c.botSlideOffsetTarget = 0;
      c.aiDirX = 0;
      c.aiDirZ = -1;
      c.searchCooldown = (c.team.id === 'red') ? 0 : 0.06;
      c.targetBlock = null;
      c.elevatorChoice = undefined;
    }

    if (c.meshObj.trolleyGroup) c.meshObj.trolleyGroup.visible = false;
    if (c.meshObj.elevatorGroup) c.meshObj.elevatorGroup.visible = false;
    
    resetCharacterPose(c);
  });

  const stage0Z = STAGES[0] ? (STAGES[0].z + 4.0) : 4.0;
  const stage0Y = STAGES[0] ? STAGES[0].y : 0.0;

  // 4走者の初期位置整列
  if (characters[0] && STAGES[0]) {
    characters[0].pos.set(-1.6, stage0Y, stage0Z);
    characters[0].meshObj.root.position.copy(characters[0].pos);
    updateNameplatePosition(characters[0]);
  }
  if (characters[1] && STAGES[0]) {
    characters[1].pos.set(-4.8, stage0Y, stage0Z);
    characters[1].meshObj.root.position.copy(characters[1].pos);
    updateNameplatePosition(characters[1]);
  }
  if (characters[2] && STAGES[0]) {
    characters[2].pos.set(1.6, stage0Y, stage0Z);
    characters[2].meshObj.root.position.copy(characters[2].pos);
    updateNameplatePosition(characters[2]);
  }
  if (characters[3] && STAGES[0]) {
    characters[3].pos.set(4.8, stage0Y, stage0Z);
    characters[3].meshObj.root.position.copy(characters[3].pos);
    updateNameplatePosition(characters[3]);
  }

  if (player && typeof window !== 'undefined' && window.GRAVITY_USER_NAME) {
    updatePlayerName(window.GRAVITY_USER_NAME);
  }
}

if (typeof window !== 'undefined') {
  window.bindLocalPlayerSlot = bindLocalPlayerSlot;
  window.resetCharacterToStageZero = resetCharacterToStageZero;
}