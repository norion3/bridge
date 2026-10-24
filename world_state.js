// world_state.js: コースデータストア・共有配列・古いステージの自動破棄ライフサイクル専用モジュール
// ★ world.js から状態管理・メモリクリーンアップロジックを完全分離（Package 4）
//   1. 【単一データストア】
//      STAGES, CONNECTIONS, bridges, floorItems, obstacleMobs 等の共有配列を一元管理。
//   2. 【循環参照ゼロの最下層データ層】
//      上位の生成・物理ロジックに依存せず、純粋なデータ参照と破棄（cleanupOldData）に専念。

import { disposeHierarchy } from './materials.js';
import { characters, player } from './character.js';
import { floorBlocksByStage } from './blocks.js';

// --- ワールド構成データ配列 ---
export const STAGES = [];
export const CONNECTIONS = [];
export const stageMeshes = [];
export const modifierGates = [];
export const cloudObjects = [];
export const oceanIslands = [];
export const bridges = [];
export const floorItems = [];
export const curvedSlideBonusBlocks = [];
export const ziplineBonusBlocks = [];
export const skydiveBonusBlocks = [];
export const slideBonusBlocks = [];
export const activeMagnetBlocks = [];
export const bridgesByStage = new Map();
export const obstacleMobs = [];

// 海面メッシュ保持用
export let seaMesh = null;
export function setSeaMesh(mesh) {
  seaMesh = mesh;
}

// お邪魔キャラ出現カウンター
export let stagesSinceLastObstacle = 0;
export function setStagesSinceLastObstacle(val) {
  stagesSinceLastObstacle = val;
}
export function incStagesSinceLastObstacle() {
  stagesSinceLastObstacle++;
}

// 演出タイマー・ステップカウンター
export let magnetDockStepCounter = 0;
export let attackCamTimer = 0;

export function setAttackCamTimer(v) { attackCamTimer = v; }
export function decrementAttackCamTimer(dt) { attackCamTimer = Math.max(0, attackCamTimer - dt); }
export function incMagnetDockStep() { return magnetDockStepCounter++; }
export function resetMagnetDockStep() { magnetDockStepCounter = 0; }

/**
 * 画面後方に離れた古い浮島・橋・アイテム・モブの安全な破棄（VRAM・ヒープメモリ保護）
 */
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