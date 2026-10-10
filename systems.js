// 物理移動判定・階段敷設・タックル衝突・ゲート判定・誘導弾・アイテム処理
import {
  TEAMS,
  TRAMPOLINE_TIERS,
  LANES
} from './constants.js';
import {
  sharedMats,
  blockGeometry,
  COLOR_NEUTRAL_PLANK,
  COLOR_BLUE_PLANK,
  COLOR_RED_PLANK,
  COLOR_YELLOW_PLANK,
  _tempVec3A,
  _tempVec3B,
  _tempVec3C,
  disposeHierarchy
} from './materials.js';
import {
  characters,
  player,
  addBrickToCharacter,
  removeBrickFromCharacter
} from './character.js';
import {
  STAGES,
  bridges,
  modifierGates,
  activeMagnetBlocks,
  floorItems,
  getFloorBlocksForStage,
  setAttackCamTimer,
  incMagnetDockStep
} from './world.js';
import {
  triggerLandingShockwave,
  projectilePool,
  drainBlockPool
} from './particles.js';

let soundRef = null;
let updateHUDRef = null;
let onPlankPlacedCallback = null;

const dummyPlankObj = new THREE.Object3D();

export function setSystemCallbacks(sound, updateHUD, onPlankPlaced = null) {
  soundRef = sound;
  updateHUDRef = updateHUD;
  onPlankPlacedCallback = onPlankPlaced;
}

export function scatterBricks(scene, char, countToDrop) {
  const count = Math.min(char.stackCount, countToDrop);
  const stage = STAGES[char.currentStage] || STAGES[0];
  const floorY = stage.y + 0.25;
  const maxR = stage.r - 1.0;
  const stageBlocks = getFloorBlocksForStage(char.currentStage);

  for (let i = 0; i < count; i++) {
    removeBrickFromCharacter(char, updateHUDRef);

    const angle = i * 2.39996 + Math.random() * 0.35;
    const dist = 1.6 + Math.sqrt(i + 1) * 0.85;
    let dropX = char.pos.x + Math.cos(angle) * dist;
    let dropZ = char.pos.z + Math.sin(angle) * dist;

    const distFromCenter = Math.hypot(dropX, dropZ - stage.z);
    if (distFromCenter > maxR && distFromCenter > 0.001) {
      dropX = (dropX / distFromCenter) * maxR;
      dropZ = stage.z + ((dropZ - stage.z) / distFromCenter) * maxR;
    }

    const dropMesh = new THREE.Mesh(blockGeometry, sharedMats.blockNeutral);
    dropMesh.position.set(dropX, floorY, dropZ);
    dropMesh.rotation.y = Math.random() * Math.PI;
    scene.add(dropMesh);

    stageBlocks.push({
      mesh: dropMesh,
      team: TEAMS.NEUTRAL,
      pos: dropMesh.position,
      active: true,
      stageIdx: char.currentStage
    });
  }
}

export function checkGateCollisions(scene, char) {
  if (!char.isPlayer) return;

  for (let i = 0; i < modifierGates.length; i++) {
    const gate = modifierGates[i];
    if (gate.consumed || gate.stageIdx !== char.currentStage) continue;

    const dx = Math.abs(char.pos.x - gate.pos.x);
    const dz = Math.abs(char.pos.z - gate.pos.z);
    if (dx < 1.4 && dz < 0.9) {
      gate.consumed = true;
      disposeHierarchy(gate.meshGroup);
      scene.remove(gate.meshGroup);

      if (gate.opType === 'multiply') {
        const currentCount = char.stackCount;
        const targetCount = currentCount * gate.value;
        const addCount = targetCount - currentCount;
        if (addCount > 0) {
          addBrickToCharacter(char, char.team, addCount, soundRef, updateHUDRef);
          if (soundRef) soundRef.playGateBoost();
        }
      } else if (gate.opType === 'divide') {
        const currentCount = char.stackCount;
        const targetCount = Math.floor(currentCount / gate.value);
        const dropCount = currentCount - targetCount;
        if (dropCount > 0) {
          scatterBricks(scene, char, dropCount);
          if (soundRef) soundRef.playTackle();
        }
      } else if (gate.opType === 'add') {
        addBrickToCharacter(char, char.team, gate.value, soundRef, updateHUDRef);
        if (soundRef) soundRef.playGateBoost();
      } else if (gate.opType === 'subtract') {
        scatterBricks(scene, char, gate.value);
        if (soundRef) soundRef.playTackle();
      }
      break;
    }
  }
}

export function fireHomingCrystal(char) {
  if (soundRef) soundRef.playAttackShoot();

  let bestForwardTarget = null, minForwardDist = 999999;
  let bestRearTarget = null, minRearDist = 999999;

  characters.forEach(c => {
    if (c === char) return;
    const dz = char.pos.z - c.pos.z;
    const totalDistSq = (char.pos.x - c.pos.x) ** 2 + (char.pos.z - c.pos.z) ** 2;

    if (dz > 0.5) {
      if (totalDistSq < minForwardDist) {
        minForwardDist = totalDistSq;
        bestForwardTarget = c;
      }
    } else if (dz < -0.5) {
      if (totalDistSq < minRearDist) {
        minRearDist = totalDistSq;
        bestRearTarget = c;
      }
    }
  });

  const selectedTarget = bestForwardTarget || bestRearTarget;
  let isRearShot = false;

  const targetPosVec = _tempVec3A;
  if (selectedTarget) {
    targetPosVec.copy(selectedTarget.pos);
    isRearShot = (char.pos.z < selectedTarget.pos.z);
  } else {
    targetPosVec.set(char.pos.x, char.pos.y, char.pos.z - 30);
  }

  triggerLandingShockwave(char.pos.x, char.pos.y + 0.1, char.pos.z, 2.8, 0xf43f5e);

  let proj = projectilePool.find(p => !p.active);
  if (!proj) {
    proj = projectilePool[0];
    let maxProg = proj.progress;
    for (let i = 1; i < projectilePool.length; i++) {
      if (projectilePool[i].progress > maxProg) {
        maxProg = projectilePool[i].progress;
        proj = projectilePool[i];
      }
    }
  }

  proj.active = true;
  proj.shooter = char;
  proj.target = selectedTarget;
  proj.isRear = isRearShot;
  proj.progress = 0;
  proj.duration = 0.82;

  proj.startPos.copy(char.pos);
  proj.startPos.y += 1.3;
  proj.targetPos.copy(targetPosVec);
  if (selectedTarget) proj.targetPos.y += 1.0;

  proj.group.position.copy(proj.startPos);
  proj.group.visible = true;

  for (let h = 0; h < proj.history.length; h++) {
    proj.history[h].copy(proj.startPos);
  }

  for (let j = 0; j < proj.trailSpheres.length; j++) {
    const item = proj.trailSpheres[j];
    item.mesh.position.copy(proj.startPos);
    item.mesh.visible = true;
    const lifeFade = 1.0 - (j / proj.trailSpheres.length);
    item.material.opacity = lifeFade * 0.92;
  }

  if (char.isPlayer) {
    setAttackCamTimer(0.95);
  }
}

export function handleCourseMovement(char, nextX, nextZ, inputDirX, inputDirZ) {
  char.onSlide = false;
  const isMovingDownwardOrBackward = (nextZ >= char.pos.z - 0.001) || (inputDirZ >= -0.05);
  const isForwardIntent = !isMovingDownwardOrBackward && (inputDirZ < -0.05);

  const curStageObj = STAGES[char.currentStage];

  const isFarFromBridges = curStageObj &&
    char.lastPlankIdx < 0 &&
    !char.onSlide && !char.onCurvedSlide && !char.onZipline &&
    (nextZ > curStageObj.z - curStageObj.r * 0.72) &&
    (char.pos.z > curStageObj.z - curStageObj.r * 0.72);

  if (!isFarFromBridges) {
    const zipB = bridges.find(b => b.isZipline && b.stageIdx === char.currentStage);
    if (zipB && char.slideCooldown <= 0) {
      const distToStart = Math.hypot(nextX, nextZ - zipB.startZ);
      if (distToStart < 3.2 && isForwardIntent) {
        char.onZipline = true;
        char.ziplineProgress = 0;
        char.activeZipline = zipB;
        return;
      }
    }

    const curvedB = bridges.find(b => b.isCurvedSlide && b.stageIdx === char.currentStage);
    if (curvedB && char.slideCooldown <= 0) {
      const distToStart = Math.hypot(nextX, nextZ - curvedB.startZ);
      if (distToStart < 3.2 && isForwardIntent) {
        char.onCurvedSlide = true;
        char.curvedSlideProgress = 0;
        char.curvedSlideOffset = Math.max(-1.5, Math.min(1.5, nextX));
        char.activeCurvedBridge = curvedB;
        if (!char.isPlayer) {
          char.botSlideOffsetTarget = (Math.random() - 0.5) * 1.5;
        }
        return;
      }
    }

    let onBridge = null;
    for (let b of bridges) {
      if (b.isCurvedSlide || b.isZipline) continue;

      if (char.currentStage !== b.stageIdx && char.currentStage !== b.nextStageIdx) continue;

      if (Math.abs(nextX - LANES[b.laneIdx]) > 1.85) continue;
      if (nextZ > b.startZ + 0.15 || nextZ < b.endZ - 0.8) continue;

      if (char.currentStage === b.nextStageIdx) {
        const isBridgeOpen = b.isSlide || b.isJump || b.planks.every(p => p.teamId !== null);
        if (!isBridgeOpen && nextZ > b.endZ) {
          continue;
        }
      }

      if (nextZ <= b.startZ + 0.15 && nextZ >= b.endZ - 0.2) {
        onBridge = b;
        break;
      }
    }

    if (onBridge) {
      if (char.currentStage === onBridge.nextStageIdx) {
        const isBridgeOpen = onBridge.isSlide || onBridge.isJump || onBridge.planks.every(p => p.teamId !== null);
        if (!isBridgeOpen) {
          char.pos.z = Math.min(char.pos.z, onBridge.endZ - 0.2);
          return;
        }
      }

      if (char.pos.z <= onBridge.endZ + 0.2 && isMovingDownwardOrBackward) {
        const isBridgeOpen = onBridge.isSlide || onBridge.isJump || onBridge.planks.every(p => p.teamId !== null);
        if (!isBridgeOpen) {
          char.pos.z = onBridge.endZ - 0.2;
          return;
        }
      }

      if (nextZ <= onBridge.endZ + 0.8) {
        const lastPlank = onBridge.planks[onBridge.planks.length - 1];
        const canPassEnd = onBridge.isSlide || onBridge.isJump || (lastPlank && lastPlank.teamId === char.team.id);
        if (canPassEnd) {
          char.currentStage = onBridge.nextStageIdx;
          if (onBridge.isSlide) {
            const maxR = STAGES[onBridge.nextStageIdx].r - 1.5;
            char.pos.x = Math.max(-maxR, Math.min(maxR, nextX));
          } else {
            char.pos.x = LANES[onBridge.laneIdx];
          }
          char.pos.z = nextZ;
          char.pos.y = STAGES[onBridge.nextStageIdx].y;
          char.lastPlankIdx = -1;
          char.onSlide = false;

          if (!char.isPlayer) {
            char.aiState = 'COLLECT';
            char.targetLane = undefined;
            char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
          }
          return;
        }
      }

      if (nextZ >= onBridge.startZ) {
        char.currentStage = onBridge.stageIdx;
        char.pos.x = LANES[onBridge.laneIdx];
        char.pos.z = nextZ;
        char.pos.y = STAGES[onBridge.stageIdx].y;
        char.lastPlankIdx = -1;
        char.onSlide = false;
        return;
      }

      const progress = Math.min(Math.max((onBridge.startZ - nextZ) / (onBridge.startZ - onBridge.endZ), 0), 0.999);
      const plankIdx = Math.floor(progress * onBridge.planks.length);

      if (plankIdx >= 0 && plankIdx < onBridge.planks.length) {
        const plank = onBridge.planks[plankIdx];

        if (plank.isJumpPad) {
          if (isForwardIntent) {
            char.isJumping = true;
            char.jumpProgress = 0;
            char.jumpStartX = char.pos.x;
            char.jumpStartY = char.pos.y;
            char.jumpStartZ = char.pos.z;
            char.jumpTargetStage = onBridge.nextStageIdx;
            char.jumpTargetX = LANES[onBridge.laneIdx];
            char.lastPlankIdx = -1;
            char.activeJumpTier = plank.jumpTier || TRAMPOLINE_TIERS.normal;

            const dipY = char.activeJumpTier.dip || -0.15;
            if (plank.netMesh) {
              plank.netMesh.scale.set(1.15, 0.2, 1.15);
              plank.netMesh.position.y = 0.50 + dipY;
              setTimeout(() => {
                if (plank.netMesh) {
                  plank.netMesh.scale.set(1.0, 1.0, 1.0);
                  plank.netMesh.position.y = 0.50;
                }
              }, 180);
            }
            if (char.isPlayer && soundRef) soundRef.playJump(char.activeJumpTier.id);
          }
          return;
        }

        if (onBridge.isSlide) {
          const laneCenterX = LANES[onBridge.laneIdx];
          const maxOffset = 1.35;
          char.pos.x = Math.max(laneCenterX - maxOffset, Math.min(laneCenterX + maxOffset, nextX));
          char.pos.z = nextZ;
          char.pos.y = plank.y;
          char.onSlide = true;
          char.lastPlankIdx = plankIdx;
          return;
        }

        if (isForwardIntent) {
          if (char.currentStage !== onBridge.stageIdx && char.lastPlankIdx < 0) {
            return;
          }

          const startIdx = (char.lastPlankIdx >= 0 && char.lastPlankIdx <= plankIdx) ? char.lastPlankIdx : 0;
          let blocked = false;

          for (let pIndex = startIdx; pIndex <= plankIdx; pIndex++) {
            const currentP = onBridge.planks[pIndex];

            if (pIndex > 0 && onBridge.planks[pIndex - 1].teamId === null) {
              blocked = true;
              const blockedZ = onBridge.startZ - ((pIndex - 1) / onBridge.planks.length) * (onBridge.startZ - onBridge.endZ);
              char.pos.x = LANES[onBridge.laneIdx];
              char.pos.z = blockedZ + 0.12; 
              char.pos.y = onBridge.planks[pIndex - 1].y;
              if (!char.isPlayer) {
                char.aiState = 'COLLECT';
                char.targetLane = undefined;
              }
              break;
            }

            if (currentP.teamId !== char.team.id) {
              if (char.stackCount > 0) {
                removeBrickFromCharacter(char, updateHUDRef);
                currentP.teamId = char.team.id;

                if (onBridge.solidMesh && onBridge.ghostMesh) {
                  dummyPlankObj.position.set(LANES[onBridge.laneIdx], currentP.y, currentP.z);
                  dummyPlankObj.rotation.set(0, 0, 0);
                  dummyPlankObj.scale.set(0, 0, 0);
                  dummyPlankObj.updateMatrix();
                  onBridge.ghostMesh.setMatrixAt(pIndex, dummyPlankObj.matrix);
                  onBridge.ghostMesh.instanceMatrix.needsUpdate = true;

                  dummyPlankObj.scale.set(1, 1, 1);
                  dummyPlankObj.updateMatrix();
                  onBridge.solidMesh.setMatrixAt(pIndex, dummyPlankObj.matrix);
                  onBridge.solidMesh.instanceMatrix.needsUpdate = true;

                  if (char.team.id === 'blue') onBridge.solidMesh.setColorAt(pIndex, COLOR_BLUE_PLANK);
                  else if (char.team.id === 'red') onBridge.solidMesh.setColorAt(pIndex, COLOR_RED_PLANK);
                  else if (char.team.id === 'yellow') onBridge.solidMesh.setColorAt(pIndex, COLOR_YELLOW_PLANK);

                  if (onBridge.solidMesh.instanceColor) {
                    onBridge.solidMesh.instanceColor.needsUpdate = true;
                  }
                }

                if (char.isPlayer) {
                  if (soundRef) soundRef.playBuildPlank();
                  if (onPlankPlacedCallback) onPlankPlacedCallback();
                  if (updateHUDRef) updateHUDRef();
                }
              } else {
                blocked = true;
                const blockedZ = onBridge.startZ - (pIndex / onBridge.planks.length) * (onBridge.startZ - onBridge.endZ);
                char.pos.x = LANES[onBridge.laneIdx];
                char.pos.z = blockedZ + 0.12; 
                char.pos.y = currentP.y;
                if (!char.isPlayer) {
                  char.aiState = 'COLLECT';
                  char.targetLane = undefined;
                }
                break;
              }
            }
          }

          if (!blocked) {
            char.pos.x = LANES[onBridge.laneIdx];
            char.pos.z = nextZ;
            char.pos.y = plank.y;
            char.lastPlankIdx = plankIdx;
          }
        } else {
          char.pos.x = LANES[onBridge.laneIdx];
          char.pos.z = nextZ;
          char.pos.y = plank.y;
          char.lastPlankIdx = plankIdx;
        }
      }
      return;
    }
  }

  let onStage = null;
  for (let i = Math.max(0, char.currentStage - 1); i < STAGES.length; i++) {
    const stage = STAGES[i];
    const dx = nextX;
    const dz = nextZ - stage.z;
    const inCircle = (dx * dx + dz * dz) < ((stage.r + 1.0) * (stage.r + 1.0));
    if (inCircle) {
      onStage = i;
      break;
    }
  }

  if (onStage !== null) {
    char.pos.x = nextX;
    char.pos.z = nextZ;
    char.pos.y = STAGES[onStage].y;
    char.currentStage = onStage;
    char.lastPlankIdx = -1;
    char.onSlide = false;
    return;
  }

  if (!char.isPlayer) {
    const curStage = STAGES[char.currentStage];
    if (curStage) {
      const dx = nextX;
      const dz = nextZ - curStage.z;
      const dist = Math.hypot(dx, dz);
      const safeR = curStage.r - 0.45;
      if (dist > safeR && dist > 0.001) {
        char.pos.x = (dx / dist) * safeR;
        char.pos.z = curStage.z + (dz / dist) * safeR;
        char.pos.y = curStage.y;
        char.lastPlankIdx = -1;
        char.onSlide = false;
      }
    }
  }
}

export function updateSingleCharacter(scene, char, dirX, dirZ, dt, spawnPuffCloud, spawnSpeedStepRing) {
  if (char.invulnerableTimer > 0) {
    char.invulnerableTimer -= dt;
    char.meshObj.root.visible = (Math.floor(Date.now() / 90) % 2 === 0);
  } else {
    char.meshObj.root.visible = true;
  }

  if (char.slideCooldown > 0) {
    char.slideCooldown -= dt;
  }

  if (char.speedBoostActive) {
    char.speedBoostTimer = (char.speedBoostTimer || 0) - dt;
    if (char.speedBoostTimer <= 0) {
      char.speedBoostActive = false;
      char.speedBoostTimer = 0;
      if (char.meshObj.footAura) char.meshObj.footAura.visible = false;
    }
  }

  const stageBlocks = getFloorBlocksForStage(char.currentStage);

  if (char.magnetActive) {
    char.magnetTimer = (char.magnetTimer || 0) - dt;
    if (char.magnetTimer <= 0) {
      char.magnetActive = false;
      char.magnetTimer = 0;
      if (char.meshObj.magnetAura) char.meshObj.magnetAura.visible = false;
    } else {
      if (char.meshObj.magnetAura) {
        char.meshObj.magnetAura.visible = true;
        const pulseT = (performance.now() * 0.0032) % 1.0;
        const inwardScale = 2.6 * (1.0 - pulseT) + 0.35;
        char.meshObj.magnetAura.scale.set(inwardScale, inwardScale, inwardScale);
        char.meshObj.magnetAura.material.opacity = pulseT * 0.85;
      }

      const magnetRadiusSq = 7.0 * 7.0;
      for (let i = stageBlocks.length - 1; i >= 0; i--) {
        const blk = stageBlocks[i];
        if (!blk.active || blk.attracting) continue;
        if (blk.team.id === char.team.id || blk.team.id === 'neutral') {
          const dx = char.pos.x - blk.pos.x;
          const dz = char.pos.z - blk.pos.z;
          if (dx * dx + dz * dz < magnetRadiusSq && Math.abs(char.pos.y - blk.pos.y) < 3.2) {
            blk.attracting = true;
            blk.active = false;
            stageBlocks.splice(i, 1);

            const startVec = new THREE.Vector3(blk.mesh.position.x, blk.mesh.position.y, blk.mesh.position.z);
            activeMagnetBlocks.push({
              mesh: blk.mesh,
              targetChar: char,
              team: blk.team,
              startPos: startVec,
              progress: 0,
              duration: 0.55
            });
          }
        }
      }
    }
  }

  if (char.isJumping) {
    const tier = char.activeJumpTier || TRAMPOLINE_TIERS.normal;
    char.jumpProgress += dt * tier.speedRate;

    if (char.jumpProgress >= 1) {
      char.isJumping = false;
      char.currentStage = char.jumpTargetStage;
      char.pos.x = char.jumpTargetX;
      char.pos.z = STAGES[char.currentStage].z + STAGES[char.currentStage].r * 0.4;
      char.pos.y = STAGES[char.currentStage].y;
      char.lastPlankIdx = -1;
      char.meshObj.root.rotation.x = 0;
      char.meshObj.leftArm.rotation.z = 0;
      char.meshObj.rightArm.rotation.z = 0;
      char.meshObj.leftLeg.rotation.z = 0;
      char.meshObj.rightLeg.rotation.z = 0;
      char.meshObj.leftLeg.rotation.x = 0;
      char.meshObj.rightLeg.rotation.x = 0;

      triggerLandingShockwave(char.pos.x, char.pos.y, char.pos.z, tier.shockRadius);
      
      // 復元: トランポリン着地直後の理不尽タックル被弾を防ぐ保護無敵時間（1.5秒へ延長）
      char.invulnerableTimer = Math.max(char.invulnerableTimer, 1.5);
      
      // 復元: リスキル防止のための着地ノックバック処理
      for (let i = 0; i < characters.length; i++) {
        const other = characters[i];
        if (other !== char && other.currentStage === char.currentStage) {
          const dx = other.pos.x - char.pos.x;
          const dz = other.pos.z - char.pos.z;
          const distSq = dx * dx + dz * dz;
          if (distSq < 9.0) { // 半径3m以内を安全地帯として押し出す
            const dist = Math.sqrt(distSq) || 1;
            other.pos.x += (dx / dist) * 1.5;
            other.pos.z += (dz / dist) * 1.5;
            other.stunTimer = Math.max(other.stunTimer, 0.8);
          }
        }
      }

      if (char.isPlayer) {
        if (soundRef) soundRef.playLanding();
        char.activeJumpTier = null;
      }
      if (!char.isPlayer) {
        char.aiState = 'COLLECT';
        char.targetLane = undefined;
        char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
      }
    } else {
      const t = char.jumpProgress;
      char.pos.x = THREE.MathUtils.lerp(char.jumpStartX, char.jumpTargetX, t);
      char.pos.z = THREE.MathUtils.lerp(char.jumpStartZ, STAGES[char.jumpTargetStage].z, t);
      const jumpHeight = tier.height;
      char.pos.y = THREE.MathUtils.lerp(char.jumpStartY, STAGES[char.jumpTargetStage].y, t) + Math.sin(t * Math.PI) * jumpHeight;

      const totalRot = tier.rotations * Math.PI * -2;
      char.meshObj.root.rotation.x = Math.sin(t * Math.PI) * totalRot;

      if (tier.id === 'high') {
        const kick = Math.sin(t * Math.PI * 4) * 0.55;
        char.meshObj.leftLeg.rotation.x = kick;
        char.meshObj.rightLeg.rotation.x = -kick;
      } else if (tier.id === 'mega') {
        if (t > 0.35 && t < 0.65) {
          char.meshObj.leftArm.rotation.z = -0.85;
          char.meshObj.rightArm.rotation.z = 0.85;
          char.meshObj.leftLeg.rotation.z = -0.32;
          char.meshObj.rightLeg.rotation.z = 0.32;
        } else {
          char.meshObj.leftArm.rotation.z = 0;
          char.meshObj.rightArm.rotation.z = 0;
          char.meshObj.leftLeg.rotation.z = 0;
          char.meshObj.rightLeg.rotation.z = 0;
        }
      }
    }
    char.meshObj.root.position.copy(char.pos);
    return;
  }

  if (char.stunTimer > 0) {
    char.stunTimer -= dt;
    char.meshObj.root.rotation.z = Math.sin(Date.now() * 0.02) * 0.4;
    char.meshObj.root.rotation.x = 0;
    return;
  }
  char.meshObj.root.rotation.z = 0;

  if (char.onZipline && char.activeZipline) {
    const zip = char.activeZipline;
    const totalFlyTime = 3.25;
    char.ziplineProgress += dt / totalFlyTime;

    char.meshObj.stackGroup.scale.set(0.65, 0.65, 0.65);
    char.meshObj.stackGroup.rotation.x = -Math.PI * 0.28;
    char.meshObj.stackGroup.position.set(0, 0.55, -0.45);

    if (char.meshObj.trolleyGroup) {
      char.meshObj.trolleyGroup.visible = true;
    }

    if (zip.bonusBlocks && zip.bonusBlocks.length > 0) {
      for (let bi = 0; bi < zip.bonusBlocks.length; bi++) {
        const blk = zip.bonusBlocks[bi];
        if (!blk.collected) {
          if (Math.abs(blk.t - char.ziplineProgress) < 0.048) {
            blk.collected = true;
            scene.remove(blk.mesh);
            addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);
            if (char.isPlayer && soundRef) {
              soundRef.playCollect(1.25 + blk.t * 0.65);
            }
          }
        }
      }
    }

    if (char.ziplineProgress >= 1.0) {
      char.onZipline = false;
      char.currentStage = zip.nextStageIdx;
      const nextStageObj = STAGES[zip.nextStageIdx];

      const landZ = nextStageObj.z + nextStageObj.r * 0.45;
      char.pos.set(char.pos.x * 0.3, nextStageObj.y, landZ);
      char.slideCooldown = 0.5;
      char.lastPlankIdx = -1;
      char.activeZipline = null;

      if (char.meshObj.trolleyGroup) {
        char.meshObj.trolleyGroup.visible = false;
      }
      char.meshObj.stackGroup.scale.set(1.0, 1.0, 1.0);
      char.meshObj.stackGroup.rotation.x = 0;
      char.meshObj.stackGroup.position.set(0, 0.65, -0.42);

      char.meshObj.leftArm.position.set(-0.48, 0.68, 0);
      char.meshObj.rightArm.position.set(0.48, 0.68, 0);
      char.meshObj.leftArm.scale.set(1.0, 1.0, 1.0);
      char.meshObj.rightArm.scale.set(1.0, 1.0, 1.0);
      char.meshObj.leftArm.rotation.set(0, 0, 0);
      char.meshObj.rightArm.rotation.set(0, 0, 0);
      char.meshObj.leftLeg.rotation.set(0, 0, 0);
      char.meshObj.rightLeg.rotation.set(0, 0, 0);
      char.meshObj.body.position.y = 0.65;
      char.meshObj.head.position.y = 1.25;
      char.meshObj.root.rotation.x = 0;
      char.meshObj.root.rotation.z = 0;

      triggerLandingShockwave(char.pos.x, nextStageObj.y, landZ, 1.8);
      if (char.isPlayer && soundRef) {
        soundRef.playLanding();
      }

      if (!char.isPlayer) {
        char.aiState = 'COLLECT';
        char.targetLane = undefined;
        char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
      }
    } else {
      const t = Math.min(0.999, Math.max(0, char.ziplineProgress));
      _tempVec3A.lerpVectors(zip.startPt, zip.endPt, t);

      char.pos.set(_tempVec3A.x, _tempVec3A.y - 2.15, _tempVec3A.z);

      const nowSec = performance.now() * 0.001;
      const legKick = Math.sin(nowSec * 16) * 0.65;
      char.meshObj.leftLeg.rotation.x = legKick - 0.25;
      char.meshObj.rightLeg.rotation.x = -legKick - 0.25;

      char.meshObj.leftArm.position.set(-0.56, 1.275, 0.06);
      char.meshObj.rightArm.position.set(0.56, 1.275, 0.06);
      char.meshObj.leftArm.scale.set(0.85, 3.80, 0.85);
      char.meshObj.rightArm.scale.set(0.85, 3.80, 0.85);
      char.meshObj.leftArm.rotation.set(-0.15, 0, 0.314);
      char.meshObj.rightArm.rotation.set(-0.15, 0, -0.314);

      char.meshObj.root.rotation.y = Math.PI;
      char.meshObj.root.rotation.x = 0.18;
      char.meshObj.root.rotation.z = Math.sin(nowSec * 7) * 0.12;

      if (char.isPlayer && soundRef) {
        soundRef.playZipline(t);
      }
    }

    char.meshObj.root.position.copy(char.pos);
    return;
  }

  if (char.onCurvedSlide && char.activeCurvedBridge) {
    const b = char.activeCurvedBridge;
    const slideSpeed = 31.0;
    const progressDelta = (slideSpeed * dt) / Math.max(10, b.curveLength);
    char.curvedSlideProgress += progressDelta;

    if (char.curvedSlideProgress >= 1.0) {
      char.onCurvedSlide = false;
      char.currentStage = b.nextStageIdx;
      const nextStageObj = STAGES[b.nextStageIdx];
      char.pos.set(char.curvedSlideOffset * 0.6, nextStageObj.y, nextStageObj.z + nextStageObj.r * 0.4);
      char.slideCooldown = 1.4;
      char.lastPlankIdx = -1;
      char.activeCurvedBridge = null;

      if (!char.isPlayer) {
        char.aiState = 'COLLECT';
        char.targetLane = undefined;
        char.aiCapacityGoal = 14 + Math.floor(Math.random() * 5);
      }
    } else {
      const t = Math.min(0.999, Math.max(0, char.curvedSlideProgress));

      let ptX, ptY, ptZ, tanX, tanZ;
      if (b.lutSamples && b.lutSamples.length > 1) {
        const lutCount = b.lutSamples.length - 1;
        const fIdx = t * lutCount;
        const i0 = Math.floor(fIdx);
        const i1 = Math.min(i0 + 1, lutCount);
        const frac = fIdx - i0;
        const s0 = b.lutSamples[i0];
        const s1 = b.lutSamples[i1];

        ptX = s0.x + (s1.x - s0.x) * frac;
        ptY = s0.y + (s1.y - s0.y) * frac;
        ptZ = s0.z + (s1.z - s0.z) * frac;
        _tempVec3C.x = s0.nx + (s1.nx - s0.nx) * frac;
        _tempVec3C.y = 0;
        _tempVec3C.z = s0.nz + (s1.nz - s0.nz) * frac;
        tanX = s0.tx + (s1.tx - s0.tx) * frac;
        tanZ = s0.tz + (s1.tz - s0.tz) * frac;
      } else {
        const pt = b.curve.getPointAt(t);
        const tangent = b.curve.getTangentAt(t).normalize();
        ptX = pt.x; ptY = pt.y; ptZ = pt.z;
        tanX = tangent.x; tanZ = tangent.z;
        _tempVec3C.set(-tangent.z, 0, tangent.x).normalize();
      }

      char.curvedSlideOffset = Math.max(-1.6, Math.min(1.6, char.curvedSlideOffset + dirX * 12 * dt));

      char.pos.set(
        ptX + _tempVec3C.x * char.curvedSlideOffset,
        ptY + 0.18,
        ptZ + _tempVec3C.z * char.curvedSlideOffset
      );

      if (b.bonusBlocks && b.bonusBlocks.length > 0) {
        for (let bi = 0; bi < b.bonusBlocks.length; bi++) {
          const blk = b.bonusBlocks[bi];
          if (!blk.collected) {
            const progDiff = Math.abs(blk.t - char.curvedSlideProgress);
            const offsetDiff = Math.abs(blk.offset - char.curvedSlideOffset);
            if (progDiff < 0.045 && offsetDiff < 0.95) {
              blk.collected = true;
              scene.remove(blk.mesh);
              addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);
              if (char.isPlayer && soundRef) {
                soundRef.playCollect(1.2 + blk.t * 0.6);
              }
            }
          }
        }
      }

      char.rotation = Math.atan2(tanX, tanZ);
      char.meshObj.root.rotation.y = char.rotation;
      char.meshObj.root.rotation.z = -dirX * 0.35 - (_tempVec3C.x * 0.2);
      char.meshObj.root.rotation.x = 0.25;

      char.meshObj.leftLeg.rotation.x = -0.35;
      char.meshObj.rightLeg.rotation.x = -0.35;
      char.meshObj.leftArm.rotation.x = -0.65;
      char.meshObj.rightArm.rotation.x = -0.65;
      char.meshObj.body.position.y = 0.50;
      char.meshObj.head.position.y = 1.15;

      if (char.isPlayer && soundRef) soundRef.playSlide();
    }

    char.meshObj.root.position.copy(char.pos);
    return;
  }

  let speed = char.speedBoostActive ? 17.0 : 10.5;

  if (char.onSlide) {
    speed = 28;
    if (char.isPlayer && soundRef) soundRef.playSlide();
  }

  let effectiveDirX = dirX;
  let effectiveDirZ = dirZ;
  if (char.onSlide) {
    effectiveDirZ = -1.0;
    effectiveDirX = dirX * 0.8;
  }

  const moveMag = Math.hypot(effectiveDirX, effectiveDirZ);
  if (moveMag > 0.08 || char.onSlide) {
    const turnLerp = (char.speedBoostActive && !char.onSlide) ? 0.40 : 0.22;
    char.rotation = THREE.MathUtils.lerp(char.rotation, Math.atan2(effectiveDirX, effectiveDirZ), turnLerp);
    char.meshObj.root.rotation.y = char.rotation;

    const nextX = char.pos.x + effectiveDirX * speed * dt;
    const nextZ = char.pos.z + effectiveDirZ * speed * dt;

    handleCourseMovement(char, nextX, nextZ, effectiveDirX, effectiveDirZ);

    const walkCycleSpeed = (char.onSlide ? 0 : 16) * (char.speedBoostActive ? 1.75 : 1.0);
    char.walkCycle += dt * walkCycleSpeed;

    if (char.onSlide) {
      char.meshObj.leftLeg.rotation.x = -0.3;
      char.meshObj.rightLeg.rotation.x = -0.3;
      char.meshObj.leftArm.rotation.x = -0.6;
      char.meshObj.rightArm.rotation.x = -0.6;
      char.meshObj.body.position.y = 0.50;
      char.meshObj.head.position.y = 1.15;
      char.meshObj.root.rotation.x = 0.22;
      char.meshObj.root.rotation.z = -effectiveDirX * 0.35;
    } else {
      const swing = Math.sin(char.walkCycle) * 0.75;
      char.meshObj.leftLeg.rotation.x = swing;
      char.meshObj.rightLeg.rotation.x = -swing;
      char.meshObj.leftArm.rotation.x = -swing;
      char.meshObj.rightArm.rotation.x = swing;

      const bounce = Math.abs(Math.sin(char.walkCycle * 2)) * 0.12;
      char.meshObj.body.position.y = 0.65 + bounce;
      char.meshObj.head.position.y = 1.25 + bounce;

      char.meshObj.root.rotation.x = char.speedBoostActive ? 0.20 : 0;
      char.meshObj.root.rotation.z = 0;
    }
    char.meshObj.stackGroup.rotation.z = Math.sin(char.walkCycle) * 0.05;

    if (char.speedBoostActive && !char.onSlide) {
      char.puffTimer = (char.puffTimer || 0) + dt;
      if (char.puffTimer > 0.085) {
        char.puffTimer = 0;
        const backDist = 0.45;
        const puffX = char.pos.x - Math.sin(char.rotation) * backDist;
        const puffZ = char.pos.z - Math.cos(char.rotation) * backDist;
        if (spawnPuffCloud) spawnPuffCloud(puffX, char.pos.y, puffZ);
        if (spawnSpeedStepRing) spawnSpeedStepRing(char.pos.x, char.pos.y, char.pos.z);
      }
    }
  } else {
    char.meshObj.leftLeg.rotation.x = THREE.MathUtils.lerp(char.meshObj.leftLeg.rotation.x, 0, 0.2);
    char.meshObj.rightLeg.rotation.x = THREE.MathUtils.lerp(char.meshObj.rightLeg.rotation.x, 0, 0.2);
    char.meshObj.leftArm.rotation.x = THREE.MathUtils.lerp(char.meshObj.leftArm.rotation.x, 0, 0.2);
    char.meshObj.rightArm.rotation.x = THREE.MathUtils.lerp(char.meshObj.rightArm.rotation.x, 0, 0.2);
    char.meshObj.root.rotation.x = 0;
    char.meshObj.root.rotation.z = 0;
  }

  if (char.meshObj.footAura) {
    if (char.speedBoostActive) {
      char.meshObj.footAura.visible = true;
      const auraPulse = 1.0 + Math.sin(performance.now() * 0.008) * 0.12;
      char.meshObj.footAura.scale.set(auraPulse, auraPulse, auraPulse);
    } else {
      char.meshObj.footAura.visible = false;
    }
  }

  if (!char.onSlide && !char.onCurvedSlide && !char.onZipline) {
    for (let i = stageBlocks.length - 1; i >= 0; i--) {
      const blk = stageBlocks[i];
      if (!blk.active) continue;
      if ((blk.team.id === char.team.id || blk.team.id === 'neutral') && Math.abs(char.pos.y - blk.pos.y) < 1.4) {
        const dx = char.pos.x - blk.pos.x;
        const dz = char.pos.z - blk.pos.z;
        if (dx * dx + dz * dz < 2.25) {
          blk.active = false;
          scene.remove(blk.mesh);
          stageBlocks.splice(i, 1);
          addBrickToCharacter(char, char.team, 1, soundRef, updateHUDRef);
        }
      }
    }

    for (let i = floorItems.length - 1; i >= 0; i--) {
      const item = floorItems[i];
      if (!item.active || item.stageIdx !== char.currentStage) continue;
      if (Math.abs(char.pos.y - item.pos.y) < 2.2) {
        const dx = char.pos.x - item.pos.x;
        const dz = char.pos.z - item.pos.z;
        if (dx * dx + dz * dz < 2.89) {
          item.active = false;
          if (item.group) {
            disposeHierarchy(item.group);
            scene.remove(item.group);
          }
          floorItems.splice(i, 1);

          if (item.type === 'speed') {
            char.speedBoostActive = true;
            char.speedBoostTimer = 12.0;
            if (char.meshObj.footAura) char.meshObj.footAura.visible = true;
            addBrickToCharacter(char, char.team, 3, soundRef, updateHUDRef);
            if (char.isPlayer && soundRef) soundRef.playItemGet();
          } else if (item.type === 'attack') {
            fireHomingCrystal(char);
          } else if (item.type === 'magnet') {
            char.magnetActive = true;
            char.magnetTimer = 6.5;
            if (char.meshObj.magnetAura) char.meshObj.magnetAura.visible = true;
            if (char.isPlayer && soundRef) soundRef.playMagnetCharge();
          }
        }
      }
    }

    checkGateCollisions(scene, char);
  }

  const currentStageObj = STAGES[char.currentStage];
  const nextStageObj = STAGES[char.currentStage + 1];
  const lowestAllowedY = Math.min(
    currentStageObj ? currentStageObj.y : 0,
    nextStageObj ? nextStageObj.y : 0
  ) - 10.0;

  if (!char.isJumping && !char.onCurvedSlide && !char.onZipline && char.pos.y < lowestAllowedY) {
    if (currentStageObj) {
      char.pos.set(0, currentStageObj.y, currentStageObj.z);
      char.onSlide = false;
      char.invulnerableTimer = 1.0;
    }
  }

  char.meshObj.root.position.copy(char.pos);
}

export function handleTackles(scene) {
  for (let i = 0; i < characters.length; i++) {
    for (let j = i + 1; j < characters.length; j++) {
      const c1 = characters[i], c2 = characters[j];
      if (c1.currentStage !== c2.currentStage) continue;
      if (c1.invulnerableTimer > 0 || c2.invulnerableTimer > 0) continue;

      const stage = STAGES[c1.currentStage];
      if (!stage) continue;

      const onIsland1 = (c1.pos.x * c1.pos.x + (c1.pos.z - stage.z) * (c1.pos.z - stage.z)) < (stage.r * stage.r);
      const onIsland2 = (c2.pos.x * c2.pos.x + (c2.pos.z - stage.z) * (c2.pos.z - stage.z)) < (stage.r * stage.r);
      if (!onIsland1 || !onIsland2) continue;

      const tdx = c1.pos.x - c2.pos.x;
      const tdz = c1.pos.z - c2.pos.z;
      if ((tdx * tdx + tdz * tdz < 1.69) && Math.abs(c1.pos.y - c2.pos.y) < 1.0) {
        if (c1.stackCount > c2.stackCount) tackleKnockout(scene, c1, c2);
        else if (c2.stackCount > c1.stackCount) tackleKnockout(scene, c2, c1);
      }
    }
  }
}

export function tackleKnockout(scene, winner, loser) {
  if (loser.stunTimer > 0 || loser.invulnerableTimer > 0) return;
  loser.stunTimer = 1.4;
  if (soundRef) soundRef.playTackle();
  const drops = Math.max(2, Math.floor(loser.stackCount * 0.5));
  scatterBricks(scene, loser, drops);
  const kx = loser.pos.x - winner.pos.x, kz = loser.pos.z - winner.pos.z;
  const mag = Math.hypot(kx, kz) || 1;
  const pushX = (kx / mag) * 2.0;
  const pushZ = (kz / mag) * 2.0;
  const stage = STAGES[loser.currentStage];
  if (stage) {
    const nextX = loser.pos.x + pushX;
    const nextZ = loser.pos.z + pushZ;
    const distToCenter = Math.hypot(nextX, nextZ - stage.z);
    if (distToCenter > stage.r) {
      const normX = nextX / distToCenter;
      const normZ = (nextZ - stage.z) / distToCenter;
      loser.pos.x = normX * (stage.r - 0.5);
      loser.pos.z = stage.z + normZ * (stage.r - 0.5);
    } else {
      loser.pos.x = nextX;
      loser.pos.z = nextZ;
    }
  } else {
    loser.pos.x += pushX;
    loser.pos.z += pushZ;
  }
}