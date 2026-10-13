// ... existing code ...
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

export function spawnItem(scene, stageIdx, type = 'speed') {
// ... existing code ...
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
      isSkydive: false, isTrapdoor: false, isCurvedSlide: false, isZipline: false, isElevator: false,
      ghostMesh: null, solidMesh: null
    };

    if (isSlide) {
// ... existing code ...
    } else if (isJump) {
// ... existing code ...
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
// ... existing code ...