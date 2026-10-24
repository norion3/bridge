// world.js: ワールド初期化・アトラクションボーナス消去ハンドラ・ワールド生成司令塔モジュール
// ★ Package 4 アトミック分割・スリム化司令塔版（world_state.js ＆ world_generator.js 統合）：
//   1. 【データストア・クリーンアップを world_state.js へ完全外注】
//      STAGES, CONNECTIONS, stageMeshes, modifierGates, cloudObjects, oceanIslands, seaMesh,
//      bridges, floorItems, 各種ボーナス配列, activeMagnetBlocks, bridgesByStage, obstacleMobs, cleanupOldData を委譲。
//   2. 【決定論的PRNG・コース伸長・各ギミック生成を world_generator.js へ完全外注】
//      Mulberry32 PRNG (currentWorldSeed, setWorldSeed, seededRandom)、
//      spawnItem, spawnGatesOnIsland, spawnObstacleMobOnStage, updateObstacleMobs,
//      createBridgeLinks, extendCourseForkPatternB, extendCourse を委譲。
//   3. 【外部向けエクスポート100%完全維持】
//      他モジュール（main.js, systems.js, network.js, entities.js など）からの参照パスとインターフェースを無修正で保証。

import {
  sharedMats,
  disposeHierarchy
} from './materials.js';
import { resetParticlePools } from './particles.js';
import { createIslandMesh, createOceanIsletMesh } from './structures.js';
import {
  floorBlocksByStage,
  getFloorBlocksForStage,
  applyRemoteBlockSpawned,
  spawnSingleBlock,
  manageBlockSpawns
} from './blocks.js';
import {
  pendingConsumedBonusIds
} from './gimmicks.js';

// ★ world_state.js からデータ配列・破棄関数をインポート＆再エクスポート
import {
  STAGES,
  CONNECTIONS,
  stageMeshes,
  modifierGates,
  cloudObjects,
  oceanIslands,
  seaMesh,
  setSeaMesh,
  bridges,
  floorItems,
  curvedSlideBonusBlocks,
  ziplineBonusBlocks,
  skydiveBonusBlocks,
  slideBonusBlocks,
  activeMagnetBlocks,
  bridgesByStage,
  obstacleMobs,
  stagesSinceLastObstacle,
  setStagesSinceLastObstacle,
  magnetDockStepCounter,
  attackCamTimer,
  setAttackCamTimer,
  decrementAttackCamTimer,
  incMagnetDockStep,
  resetMagnetDockStep,
  cleanupOldData
} from './world_state.js';

// ★ world_generator.js から生成・乱数関数をインポート＆再エクスポート
import {
  currentWorldSeed,
  setWorldSeed,
  seededRandom,
  getDeterministicItemType,
  resetGimmickBags,
  spawnItem,
  spawnGatesOnIsland,
  getForkThemeGates,
  spawnObstacleMobOnStage,
  updateObstacleMobs,
  createBridgeLinks,
  extendCourseForkPatternB,
  extendCourse
} from './world_generator.js';

// 他モジュールへの100%後方互換再エクスポート
export {
  STAGES,
  CONNECTIONS,
  stageMeshes,
  modifierGates,
  cloudObjects,
  oceanIslands,
  seaMesh,
  setSeaMesh,
  bridges,
  floorItems,
  curvedSlideBonusBlocks,
  ziplineBonusBlocks,
  skydiveBonusBlocks,
  slideBonusBlocks,
  activeMagnetBlocks,
  bridgesByStage,
  obstacleMobs,
  stagesSinceLastObstacle,
  magnetDockStepCounter,
  attackCamTimer,
  setAttackCamTimer,
  decrementAttackCamTimer,
  incMagnetDockStep,
  cleanupOldData,
  currentWorldSeed,
  setWorldSeed,
  seededRandom,
  getDeterministicItemType,
  spawnItem,
  spawnGatesOnIsland,
  getForkThemeGates,
  spawnObstacleMobOnStage,
  updateObstacleMobs,
  createBridgeLinks,
  extendCourseForkPatternB,
  extendCourse,
  floorBlocksByStage,
  getFloorBlocksForStage,
  applyRemoteBlockSpawned,
  spawnSingleBlock,
  manageBlockSpawns
};

/**
 * リモート走者が回収したアトラクションボーナスブロック（白ブロック）の消去ハンドラ
 */
export function applyRemoteBonusConsumed(bonusId) {
  if (!bonusId) return;

  const arrays = [skydiveBonusBlocks, ziplineBonusBlocks, curvedSlideBonusBlocks, slideBonusBlocks];
  let found = false;

  for (let a = 0; a < arrays.length; a++) {
    const arr = arrays[a];
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (b.bonusId === bonusId && !b.collected) {
        b.collected = true;
        if (b.mesh) {
          b.mesh.visible = false;
          if (b.mesh.parent) b.mesh.parent.remove(b.mesh);
        }
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    pendingConsumedBonusIds.add(bonusId);
  } else {
    pendingConsumedBonusIds.delete(bonusId);
  }
}

if (typeof window !== 'undefined') {
  window.applyRemoteBonusConsumed = applyRemoteBonusConsumed;
}

/**
 * ワールド全体の初期化・シード適用・初期島群構築
 */
export function buildWorld(scene, seed = null) {
  setWorldSeed(seed);

  resetGimmickBags();
  setStagesSinceLastObstacle(0);
  resetMagnetDockStep();
  setAttackCamTimer(0);

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
    setSeaMesh(null);
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
  const newSeaMesh = new THREE.Mesh(seaGeo, sharedMats.sea);
  newSeaMesh.rotation.x = -Math.PI / 2;
  newSeaMesh.position.set(0, -42, -500);
  newSeaMesh.receiveShadow = false;
  scene.add(newSeaMesh);
  setSeaMesh(newSeaMesh);

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