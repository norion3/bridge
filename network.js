// network.js: AgentSDK公式仕様完全準拠 ＆ 10Hz POS 送受信ループ ＆ 自律ホスト昇格 ＆ スナップショット復元司令塔
// ★ 完全独立決定論ハッシュ・リスタート防護 ＆ プール完全隔離版：
//   1. 【リスタート時の Catch-up 誤爆完全防止】
//      RESTART_GAME 受信時および broadcastRestartGame 時に、全端末で _hasCaughtUp = true を確約し、
//      通信遅延パケット（古い hostStage）による誤ったステージワープを物理遮断。
//   2. 【floorBlockPool 全400個の強制隔離（pos.y = -999）＆完全パージ】
//      purgeLocalWorldState において、全ブロックの blockId, stageIdx を完全消去し、
//      再利用時に奥の虚空（Z=-300m）にブロックが残留するゴースト化を100%根絶。
//   3. 【お邪魔モブ・飛翔体・保留キューの完全破棄】
//   4. 【自機および全走者の stackCount = 0 ＆ 全バフデバフタイマーゼロクリア】
//   5. 【タイムアップ結果画面（#modal-result）の強制非表示】

import {
  player,
  characters,
  createNameplateMesh,
  updatePlayerName,
  bindLocalPlayerSlot,
  refreshCharacterStackVisuals,
  resetCharacterToStageZero,
  resetCharacterPose
} from './character.js';
import {
  STAGES,
  buildWorld,
  manageBlockSpawns,
  bridges,
  floorBlocksByStage,
  floorItems,
  spawnItem,
  slideBonusBlocks,
  curvedSlideBonusBlocks,
  ziplineBonusBlocks,
  skydiveBonusBlocks,
  activeMagnetBlocks,
  applyRemoteBonusConsumed
} from './world.js';
import {
  bridgesByStage,
  obstacleMobs
} from './world_state.js';
import {
  resetParticlePools,
  floorBlockPool,
  projectilePool,
  thunderProjectilePool,
  drainBlockPool,
  lightningPillarPool
} from './particles.js';
import { pendingConsumedBonusIds } from './gimmicks.js';
import { spawnDanmaku } from './danmaku.js';
import {
  setChatSendCallback,
  recordParticipant,
  markParticipantInactive
} from './menu.js';
import { disposeHierarchy } from './materials.js';

// ★ net_protocol.js から純粋計算・タプル変換関数をインポート
import {
  round1,
  round2,
  getTeamIdBySlot,
  generateClientId,
  encodeCharacterToTuple,
  decodeTupleToCharacterPacket,
  packBlockTuple,
  unpackBlockTuple,
  packPickTuple,
  unpackPickTuple
} from './net_protocol.js';

// ★ world_generator.js からギミック抽選バッグ・二股分岐履歴リセット関数をインポート
import { resetGimmickBags } from './world_generator.js';

// ★ net_lobby_hooks.js からロビーイベントフックをインポート＆再エクスポート
import { hookLobbyNetworkEvents } from './net_lobby_hooks.js';

export { hookLobbyNetworkEvents };

/**
 * 入退室時・新セッション開始時に前セッションの全オブジェクト（ブロック・アイテム・ボーナス・お邪魔モブ・飛翔体）
 * およびコース生成器の内部状態（二股分岐履歴・抽選バッグ）を完全破棄・隔離・初期化するヘルパー
 */
function purgeLocalWorldState() {
  const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;

  // 1. 床ブロックの完全隔離（全400個のID・ステージ番号を完全抹消し、y=-999mへ物理隔離）
  if (Array.isArray(floorBlockPool)) {
    for (let i = 0; i < floorBlockPool.length; i++) {
      const b = floorBlockPool[i];
      if (b) {
        b.active = false;
        b.attracting = false;
        b.stageIdx = -1;
        b.blockId = null;
        if (b.mesh) {
          b.mesh.visible = false;
          b.mesh.position.set(0, -999, 0); // 描画空間から完全に隔離
        }
      }
    }
  }
  if (floorBlocksByStage && typeof floorBlocksByStage.clear === 'function') {
    floorBlocksByStage.clear();
  }

  // 2. 床アイテム（floorItems）の完全消去・非表示化（ゾンビアイテムの根絶）
  if (Array.isArray(floorItems)) {
    for (let i = 0; i < floorItems.length; i++) {
      const it = floorItems[i];
      if (it) {
        it.active = false;
        if (it.mesh) {
          it.mesh.visible = false;
          it.mesh.position.set(0, -999, 0);
          if (it.mesh.parent) {
            it.mesh.parent.remove(it.mesh);
          }
        }
      }
    }
    floorItems.length = 0;
  }

  // 3. 4大ボーナスブロック全配列の完全リセット（最初から消えているバグの防止）
  const bonusArrays = [slideBonusBlocks, curvedSlideBonusBlocks, ziplineBonusBlocks, skydiveBonusBlocks];
  for (let a = 0; a < bonusArrays.length; a++) {
    const arr = bonusArrays[a];
    if (Array.isArray(arr)) {
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i];
        if (b) {
          b.collected = false;
          if (b.mesh) {
            b.mesh.visible = false;
            b.mesh.position.set(0, -999, 0);
            if (b.mesh.parent) {
              b.mesh.parent.remove(b.mesh);
            }
          }
        }
      }
      arr.length = 0;
    }
  }

  // 4. 吸引中ブロックリストのクリア
  if (Array.isArray(activeMagnetBlocks)) {
    activeMagnetBlocks.length = 0;
  }

  // 5. 遅延消去保留キューの完全クリア（前セッションの消滅IDによる汚染防止）
  if (pendingConsumedBonusIds && typeof pendingConsumedBonusIds.clear === 'function') {
    pendingConsumedBonusIds.clear();
  }

  // 6. お邪魔キャラ（obstacleMobs）のシーングラフ破棄＆配列全消去
  if (Array.isArray(obstacleMobs)) {
    for (let i = 0; i < obstacleMobs.length; i++) {
      const mob = obstacleMobs[i];
      if (mob && mob.group) {
        mob.active = false;
        if (typeof disposeHierarchy === 'function') {
          disposeHierarchy(mob.group);
        }
        if (activeScene) {
          activeScene.remove(mob.group);
        }
      }
    }
    obstacleMobs.length = 0;
  }

  // 7. ステージ別ブリッジ参照Map（bridgesByStage）の完全クリア
  if (bridgesByStage && typeof bridgesByStage.clear === 'function') {
    bridgesByStage.clear();
  }

  // 8. 飛翔体・サンダー・ドレイン・雷柱プールの完全非アクティブ化
  const projectilePools = [projectilePool, thunderProjectilePool, drainBlockPool, lightningPillarPool];
  for (let pi = 0; pi < projectilePools.length; pi++) {
    const pPool = projectilePools[pi];
    if (Array.isArray(pPool)) {
      for (let pj = 0; pj < pPool.length; pj++) {
        const item = pPool[pj];
        if (item) {
          item.active = false;
          if (item.group) item.group.visible = false;
          if (item.mesh) item.mesh.visible = false;
          if (item.reticle) item.reticle.visible = false;
        }
      }
    }
  }

  // 9. コース生成器の内部状態の完全リセット
  if (typeof resetGimmickBags === 'function') {
    resetGimmickBags();
  }

  // 10. パーティクルプールのリセット
  if (typeof resetParticlePools === 'function') {
    resetParticlePools();
  }
}

/**
 * 走者が特殊アトラクション（ギミック）搭乗中であるかを判定するヘルパー
 */
function isPlayerOnAttraction(char) {
  if (!char) return false;
  return Boolean(
    char.onSkydive ||
    char.onElevator ||
    char.onCurvedSlide ||
    char.onSlide ||
    char.onZipline ||
    char.onTrapdoor ||
    char.onFreefall
  );
}

/**
 * 未入室時の exit() による無限保留（Promiseハング）および本命ルーム誤退室を防ぐ安全退出ヘルパー
 */
async function safeExitCurrentRoom(targetRoomId = null) {
  if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room) return;
  try {
    if (typeof window.AgentSDK.room.getRoomId === 'function') {
      const res = await window.AgentSDK.room.getRoomId();
      const activeRoomId = (res && typeof res.room_id === 'string')
        ? res.room_id
        : (res && res.data && res.data.room_id ? res.data.room_id : '');
      if (!activeRoomId || activeRoomId === '') {
        return;
      }
      if (targetRoomId && String(activeRoomId) === String(targetRoomId)) {
        console.log(`[network.js] Already in target room #${activeRoomId}. Skipping redundant exit().`);
        return;
      }
    }
    const exitPromise = window.AgentSDK.room.exit();
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 700));
    await Promise.race([exitPromise, timeoutPromise]);
    await new Promise(r => setTimeout(r, 250));
  } catch (e) {
    console.warn('[network.js] safeExitCurrentRoom caught:', e);
  }
}

/**
 * 画面切り替え ＆ ゲームループ始動確約ヘルパー
 */
function safeShowGameScreen() {
  try {
    if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.showGame === 'function') {
      window.UIController.showGame();
    }
  } catch (e) {
    console.warn('[network.js] UIController.showGame deferred:', e);
  }

  const allOverlays = document.querySelectorAll('.gravity-screen-overlay, #test-lobby-overlay');
  allOverlays.forEach(overlay => {
    overlay.style.setProperty('display', 'none', 'important');
    overlay.classList.add('hidden');
  });

  const startModal = document.getElementById('modal-start');
  if (startModal) {
    startModal.style.setProperty('display', 'none', 'important');
    startModal.classList.add('hidden');
  }

  const resultModal = document.getElementById('modal-result');
  if (resultModal) {
    resultModal.style.setProperty('display', 'none', 'important');
    resultModal.classList.add('hidden');
  }

  if (typeof window !== 'undefined' && typeof window.launchGameEngine === 'function') {
    window.launchGameEngine();
  }

  const startBtn = document.getElementById('btn-start');
  if (startBtn) {
    startBtn.click();
  }
}

/**
 * リスタートボタンなどの表示権限更新を安全に呼び出すヘルパー
 */
function notifyRestartButtonVisibility() {
  if (typeof window !== 'undefined' && typeof window.updateRestartButtonVisibility === 'function') {
    try {
      window.updateRestartButtonVisibility();
    } catch (e) {
      console.warn('[network.js] updateRestartButtonVisibility failed:', e);
    }
  }
}

/**
 * ホスト端末の全進行ステージを網羅した完全世界状態を収集
 */
function captureFullWorldSnapshot() {
  let maxStage = 0;
  if (Array.isArray(characters)) {
    characters.forEach(c => {
      if (c && typeof c.currentStage === 'number' && c.currentStage > maxStage) {
        maxStage = c.currentStage;
      }
    });
  }
  const allowedStageLimit = Math.max(2, maxStage + 2);

  const blocks = [];
  if (Array.isArray(floorBlockPool)) {
    for (let idx = 0; idx < floorBlockPool.length; idx++) {
      const b = floorBlockPool[idx];
      // ★ 通常床ブロック（b_ で始まるもの）のみを収集し、散乱ブロックのID化けを防ぐ
      if (b && b.active && !b.attracting && b.pos && b.pos.y > -100 && b.stageIdx <= allowedStageLimit) {
        if (!b.blockId || b.blockId.startsWith('b_')) {
          const tuple = packBlockTuple({
            stageIdx: b.stageIdx || 0,
            x: b.pos.x,
            z: b.pos.z,
            teamId: (b.team && b.team.id) ? b.team.id : 'neutral',
            blockId: b.blockId || null
          });
          blocks.push(tuple);
        }
      }
    }
  }

  const planks = [];
  if (Array.isArray(bridges)) {
    for (let bi = 0; bi < bridges.length; bi++) {
      const b = bridges[bi];
      if (b && b.stageIdx <= allowedStageLimit && Array.isArray(b.planks) && !b.isSlide && !b.isJump) {
        for (let pIdx = 0; pIdx < b.planks.length; pIdx++) {
          const p = b.planks[pIdx];
          if (p && p.teamId) {
            planks.push({
              stageIdx: b.stageIdx,
              laneIdx: b.laneIdx,
              plankIdx: pIdx,
              teamId: p.teamId
            });
          }
        }
      }
    }
  }

  const items = [];
  if (Array.isArray(floorItems)) {
    for (let ii = 0; ii < floorItems.length; ii++) {
      const it = floorItems[ii];
      if (it && it.active && it.pos && it.pos.y > -100 && it.stageIdx <= allowedStageLimit) {
        items.push({
          itemId: it.itemId,
          stageIdx: it.stageIdx,
          type: it.type,
          x: round2(it.pos.x),
          y: round2(it.pos.y),
          z: round2(it.pos.z)
        });
      }
    }
  }

  const bonuses = [];
  const bonusArrays = [slideBonusBlocks, curvedSlideBonusBlocks, ziplineBonusBlocks, skydiveBonusBlocks];
  for (let a = 0; a < bonusArrays.length; a++) {
    const arr = bonusArrays[a];
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      const b = arr[i];
      if (b.collected && b.bonusId && b.stageIdx <= allowedStageLimit) {
        bonuses.push(b.bonusId);
      }
    }
  }

  return { blocks, planks, items, bonuses };
}

export const NetworkManager = {
  isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
  currentRoomId: null,
  clientId: generateClientId(),
  myUser: { name: 'YOU', user_id: 'local_user', portrait: '' },
  
  slots: [
    { slot: 0, clientId: null, userId: null, name: 'norion', portrait: '', isAI: false, joinTime: 0 },
    { slot: 1, clientId: null, userId: null, name: 'CPU 1', portrait: '', isAI: true, joinTime: 0 },
    { slot: 2, clientId: null, userId: null, name: 'CPU 2', portrait: '', isAI: true, joinTime: 0 },
    { slot: 3, clientId: null, userId: null, name: 'CPU 3', portrait: '', isAI: true, joinTime: 0 }
  ],
  
  isHost: false,
  isMultiplayerActive: false,
  mySlot: 0,
  isSlotConfirmed: false,
  currentSeed: 12345678,
  _seedApplied: false,
  _hasCaughtUp: false,

  _hasRegisteredListener: false,
  _lastRefreshTime: 0,
  _syncIntervalId: null,
  _timeSyncCounter: 0,

  _isCreatingRoom: false,
  _isJoiningRoom: false,

  _lastHostPacketTime: 0,
  _watchdogIntervalId: null,
  _hasReceivedFirstHostPacket: false,
  _isPromoting: false,

  _snapshotQueue: [],

  _lastSentSnapshot: null,
  _idleKeepAliveCounter: 0,

  // アクション蓄積キュー
  _pendingPlanks: [],
  _pendingPicks: [],
  _pendingConsumes: [],
  _pendingBlows: [],
  _pendingSkills: [],
  _pendingKnockouts: [],
  _pendingScatters: [],
  _pendingSpawns: [],
  _pendingChats: [],

  captureWorldSnapshot: captureFullWorldSnapshot,

  queueChat(messageText) {
    if (!messageText) return;
    const cleanText = String(messageText).trim().slice(0, 15);
    if (!cleanText) return;

    const myName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
      ? window.GRAVITY_USER_NAME
      : this.myUser.name;
    const myTeam = getTeamIdBySlot(this.mySlot);
    spawnDanmaku(cleanText, myName, myTeam);

    if (this.isMultiplayerActive) {
      this._pendingChats.push({
        s: this.mySlot,
        m: cleanText
      });
    }
  },

  queuePlankBuild(stageIdx, laneIdx, plankIdx, teamId) {
    if (!this.isMultiplayerActive) return;
    this._pendingPlanks.push({
      s: stageIdx,
      l: laneIdx,
      p: plankIdx,
      t: teamId
    });
  },

  queueBlockPick(blockId, stageIdx, poolIdx, x, z) {
    if (!this.isMultiplayerActive) return;
    const tuple = packPickTuple(stageIdx, blockId);
    this._pendingPicks.push(tuple);
  },

  queueConsumeObject(objectId, objectType) {
    if (!this.isMultiplayerActive || !objectId) return;
    this._pendingConsumes.push({
      id: objectId,
      t: objectType
    });
  },

  queueBlowMob(mobIndex, stageIdx, pushDirX) {
    if (!this.isMultiplayerActive) return;
    this._pendingBlows.push({
      m: mobIndex,
      s: stageIdx,
      d: round1(pushDirX)
    });
  },

  queueSkillFire(skillTypeInt, shooterSlot, targetSlot) {
    if (!this.isMultiplayerActive) return;
    this._pendingSkills.push({
      t: skillTypeInt,
      s: shooterSlot,
      tg: targetSlot
    });
  },

  queueKnockout(loserSlot, pushX, pushZ, targetX, targetZ) {
    if (!this.isMultiplayerActive) return;
    this._pendingKnockouts.push({
      l: loserSlot,
      px: round1(pushX),
      pz: round1(pushZ),
      tx: round1(targetX),
      tz: round1(targetZ)
    });
  },

  queueScatterBlocks(stageIdx, slotIdx, baseId, blocksArray) {
    if (!this.isMultiplayerActive || !Array.isArray(blocksArray) || blocksArray.length === 0) return;
    this._pendingScatters.push({
      s: stageIdx,
      sl: slotIdx,
      bid: baseId,
      b: blocksArray
    });
  },

  queueSpawnBlocks(spawnedArray) {
    if (!this.isMultiplayerActive || !this.isHost || !Array.isArray(spawnedArray) || spawnedArray.length === 0) return;
    for (let i = 0; i < spawnedArray.length; i++) {
      const b = spawnedArray[i];
      const tuple = packBlockTuple(b);
      this._pendingSpawns.push(tuple);
    }
  },

  async init() {
    setChatSendCallback((msg) => {
      this.queueChat(msg);
    });

    if (!this.isSDKAvailable) {
      console.warn('[NetworkManager] AgentSDK is not available. Standalone mode.');
      return this.myUser;
    }
    try {
      const res = await window.AgentSDK.user.getMyUserInfo();
      if (res && res.data) {
        this.myUser = {
          user_id: String(res.data.user_id),
          name: res.data.name || 'プレイヤー',
          portrait: res.data.portrait || res.data.portait || ''
        };
        window.GRAVITY_USER_NAME = this.myUser.name;
        recordParticipant(this.myUser.user_id, this.myUser.name, this.myUser.portrait, 'blue', true);
      }
    } catch (err) {
      console.warn('[NetworkManager] Failed to get user info:', err);
    }
    return this.myUser;
  },

  ensureMessageListener() {
    if (!this.isSDKAvailable || this._hasRegisteredListener) return;
    this._hasRegisteredListener = true;

    try {
      window.AgentSDK.room.receiveMessage((payload) => {
        if (!payload) return;
        const type = payload.type || (payload.data && payload.data.type);
        const data = payload.data !== undefined ? payload.data : payload;

        switch (type) {
          case 'aitools_game_joinroom':
            this._handleUserJoined(data);
            break;
          case 'aitools_game_exitroom':
            this._handleUserExited(data);
            break;
          case 'aitools_game_sendmsg':
            this._handleCustomMessage(payload);
            break;
          default:
            if (payload.msg_data || payload.message || payload.event || payload.e || (payload.data && (payload.data.msg_data || payload.data.message))) {
              this._handleCustomMessage(payload);
            }
            break;
        }
      });
    } catch (err) {
      console.warn('[NetworkManager] receiveMessage setup failed:', err);
    }
  },

  _startHostWatchdog() {
    this._stopHostWatchdog();
    this._lastHostPacketTime = performance.now();
    this._hasReceivedFirstHostPacket = false;

    this._watchdogIntervalId = setInterval(() => {
      if (!this.isMultiplayerActive || this.isHost) {
        this._stopHostWatchdog();
        return;
      }

      const elapsed = performance.now() - this._lastHostPacketTime;
      const timeoutThreshold = this._hasReceivedFirstHostPacket ? 5000 : 8000;

      if (elapsed > timeoutThreshold) {
        console.warn(`[NetworkManager] Host packet timeout (${Math.round(elapsed)}ms). Promoting to Host...`);
        this.promoteToHost();
      }
    }, 500);
  },

  _stopHostWatchdog() {
    if (this._watchdogIntervalId) {
      clearInterval(this._watchdogIntervalId);
      this._watchdogIntervalId = null;
    }
  },

  promoteToHost() {
    if (this._isPromoting || this.isHost) return;
    this._isPromoting = true;
    this._stopHostWatchdog();

    console.log(`[NetworkManager] promoteToHost: Slot ${this.mySlot} becoming Host.`);

    this._snapshotQueue.length = 0;

    this.isHost = true;
    notifyRestartButtonVisibility();
    this._restoreAllVacantSlotsToAI();
    this._startPositionBroadcasting();

    this._isPromoting = false;
  },

  _restoreAllVacantSlotsToAI() {
    for (let i = 0; i < this.slots.length; i++) {
      if (i === this.mySlot) continue;

      const slotData = this.slots[i];
      const char = characters[i];
      if (!slotData || !char) continue;

      slotData.isAI = true;
      slotData.clientId = null;
      slotData.userId = null;
      slotData.portrait = '';
      slotData.name = (i === 0) ? 'CPU 0' : (i === 1 ? 'CPU 1' : (i === 2 ? 'CPU 2' : 'CPU 3'));
      slotData.joinTime = 0;

      char.isPlayer = false;
      char.isAI = true;
      char.isRemote = false;
      char.targetNetPos = null;
      char.netVelocity = { x: 0, z: 0 };
      char.aiState = 'COLLECT';
      char.searchCooldown = 0;
      char.unstuckTimer = 0;
      char.stuckCheckTimer = 0;
      char.lastPosCheck = null;
      char.elevatorChoice = undefined;
      char.forkBranchChoice = undefined;
      char.botSlideOffsetTarget = 0;

      char.currentStage = 0;
      char.stackCount = 0;
      char.stunTimer = 0;
      char.shrinkTimer = 0;
      char.invulnerableTimer = 0;
      char.speedBoostActive = false;
      char.speedBoostTimer = 0;
      char.magnetActive = false;
      char.magnetTimer = 0;

      char.onZipline = false;
      char.onSlide = false;
      char.onCurvedSlide = false;
      char.onElevator = false;
      char.onSkydive = false;
      char.onTrapdoor = false;
      char.onFreefall = false;

      const currentStageObj = STAGES[0];
      if (currentStageObj) {
        const centerX = currentStageObj.x || 0.0;
        let defaultX = -1.6;
        if (i === 1) defaultX = -4.8;
        else if (i === 2) defaultX = 1.6;
        else if (i === 3) defaultX = 4.8;
        char.pos.set(centerX + defaultX, currentStageObj.y, currentStageObj.z + 1.8);
        if (char.meshObj && char.meshObj.root) {
          char.meshObj.root.position.copy(char.pos);
        }
      }

      resetCharacterPose(char);
      refreshCharacterStackVisuals(char);

      if (char.nameplateSprite) {
        char.name = slotData.name;
        if (char.nameplateSprite.material) {
          if (char.nameplateSprite.material.map) {
            char.nameplateSprite.material.map.dispose();
          }
          char.nameplateSprite.material.dispose();
        }
        const newMesh = createNameplateMesh(slotData.name, false);
        if (newMesh.geometry) newMesh.geometry.dispose();
        char.nameplateSprite.material = newMesh.material;
        char.nameplateSprite.visible = true;
      }
    }
  },

  async getPublicRooms() {
    if (!this.isSDKAvailable) return [];
    const now = Date.now();
    if (now - this._lastRefreshTime < 1500) {
      return null;
    }
    this._lastRefreshTime = now;

    try {
      const res = await window.AgentSDK.room.getPublicRoomList();
      let list = null;
      if (res) {
        if (Array.isArray(res)) list = res;
        else if (res.data && Array.isArray(res.data.list)) list = res.data.list;
        else if (res.data && Array.isArray(res.data)) list = res.data;
        else if (Array.isArray(res.list)) list = res.list;
      }

      if (Array.isArray(list)) {
        return list.filter(r => {
          const count = Number(r.gamer_num) || 0;
          const max = Number(r.max_players) || 4;
          return count > 0 && count < max;
        });
      }
    } catch (err) {
      console.error('[NetworkManager] Failed to get public rooms:', err);
    }
    return [];
  },

  async createRoom(isPrivate = false) {
    if (this._isCreatingRoom || this._isJoiningRoom) {
      console.warn('[NetworkManager] Room transaction is already in progress.');
      return null;
    }
    this._isCreatingRoom = true;

    try {
      await this.init();
      await safeExitCurrentRoom(null);

      if (Array.isArray(characters)) {
        characters.forEach((c) => {
          if (!c) return;
          c.stackCount = 0;
          c.currentStage = 0;
          c.stunTimer = 0;
          c.shrinkTimer = 0;
          c.invulnerableTimer = 0;
          c.speedBoostActive = false;
          c.speedBoostTimer = 0;
          c.magnetActive = false;
          c.magnetTimer = 0;
          if (typeof resetCharacterPose === 'function') resetCharacterPose(c);
          if (typeof refreshCharacterStackVisuals === 'function') refreshCharacterStackVisuals(c);
        });
      }

      purgeLocalWorldState();

      let createdRoomId = 'local_room_' + Math.floor(Math.random() * 1000);

      if (this.isSDKAvailable) {
        try {
          const permission = isPrivate ? 1 : 0;
          const res = await window.AgentSDK.room.create({ max_players: 4, room_permission: permission });

          let isSuccess = false;
          if (res) {
            if (res.errno === 0 || res.errno === '0' || res.code === 0 || res.code === '0') {
              isSuccess = true;
            } else if (res.data && (res.data.room_id || res.data.roomId)) {
              isSuccess = true;
            } else if (res.room_id || res.roomId) {
              isSuccess = true;
            }
          }

          if (!isSuccess && res && (res.errno !== undefined || res.code !== undefined)) {
            const errMsg = res.errmsg || res.msg || res.message || '部屋の作成に失敗しました';
            console.error(`[NetworkManager] Failed to create room: ${errMsg}`);
            return null;
          }

          if (res && res.data && res.data.room_id) {
            createdRoomId = String(res.data.room_id);
          } else if (res && res.room_id) {
            createdRoomId = String(res.room_id);
          }
        } catch (err) {
          console.error('[NetworkManager] Create room exception:', err);
          return null;
        }
      }

      this.currentRoomId = createdRoomId;
      this.clientId = generateClientId();
      this.ensureMessageListener();

      this.isHost = true;
      this.mySlot = 0;
      this.isSlotConfirmed = true;
      this.isMultiplayerActive = true;
      this._seedApplied = true;
      this._hasCaughtUp = true;

      this._stopHostWatchdog();
      if (this._syncIntervalId) {
        clearInterval(this._syncIntervalId);
        this._syncIntervalId = null;
      }
      this._snapshotQueue.length = 0;
      this._lastSentSnapshot = null;
      this._idleKeepAliveCounter = 0;

      this._pendingPlanks.length = 0;
      this._pendingPicks.length = 0;
      this._pendingConsumes.length = 0;
      this._pendingBlows.length = 0;
      this._pendingSkills.length = 0;
      this._pendingKnockouts.length = 0;
      this._pendingScatters.length = 0;
      this._pendingSpawns.length = 0;
      this._pendingChats.length = 0;

      safeShowGameScreen();

      if (typeof bindLocalPlayerSlot === 'function') {
        bindLocalPlayerSlot(0);
      } else if (typeof window.bindLocalPlayerSlot === 'function') {
        window.bindLocalPlayerSlot(0);
      }

      if (window.GRAVITY_USER_NAME) {
        updatePlayerName(window.GRAVITY_USER_NAME);
      }

      notifyRestartButtonVisibility();

      this.currentSeed = (typeof createdRoomId === 'string')
        ? Math.abs(createdRoomId.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0))
        : Math.floor(Math.random() * 90000000) + 10000000;

      this.slots[0] = {
        slot: 0,
        clientId: this.clientId,
        userId: this.myUser.user_id,
        name: this.myUser.name,
        portrait: this.myUser.portrait || '',
        isAI: false,
        joinTime: performance.now()
      };
      this.slots[1] = { slot: 1, clientId: null, userId: null, name: 'CPU 1', portrait: '', isAI: true, joinTime: 0 };
      this.slots[2] = { slot: 2, clientId: null, userId: null, name: 'CPU 2', portrait: '', isAI: true, joinTime: 0 };
      this.slots[3] = { slot: 3, clientId: null, userId: null, name: 'CPU 3', portrait: '', isAI: true, joinTime: 0 };

      recordParticipant(this.myUser.user_id, this.myUser.name, this.myUser.portrait, 'blue', true);

      const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;
      if (activeScene) {
        try {
          purgeLocalWorldState();
          buildWorld(activeScene, this.currentSeed);
          manageBlockSpawns(activeScene, false);
        } catch (e) {
          console.warn('[network.js] buildWorld deferred:', e);
        }
      }

      this._startPositionBroadcasting();
      return this.currentRoomId;
    } finally {
      setTimeout(() => {
        this._isCreatingRoom = false;
      }, 600);
    }
  },

  async joinRoom(roomId) {
    if (!roomId) return false;
    if (this._isCreatingRoom || this._isJoiningRoom) {
      console.warn('[NetworkManager] Room transaction is already in progress.');
      return false;
    }
    this._isJoiningRoom = true;
    const safeRoomId = String(roomId);

    try {
      await this.init();
      await safeExitCurrentRoom(safeRoomId);

      if (Array.isArray(characters)) {
        characters.forEach((c) => {
          if (!c) return;
          c.stackCount = 0;
          c.currentStage = 0;
          c.stunTimer = 0;
          c.shrinkTimer = 0;
          c.invulnerableTimer = 0;
          c.speedBoostActive = false;
          c.speedBoostTimer = 0;
          c.magnetActive = false;
          c.magnetTimer = 0;
          if (typeof resetCharacterPose === 'function') resetCharacterPose(c);
          if (typeof refreshCharacterStackVisuals === 'function') refreshCharacterStackVisuals(c);
        });
      }

      purgeLocalWorldState();

      if (this.isSDKAvailable) {
        try {
          const res = await window.AgentSDK.room.join({ room_id: safeRoomId });

          let isSuccess = false;
          if (res) {
            if (res.errno === 0 || res.errno === '0' || res.code === 0 || res.code === '0') {
              isSuccess = true;
            } else if (res.data && (res.data.room_id || res.data.roomId)) {
              isSuccess = true;
            }
          }

          if (!isSuccess && res && (res.errno !== undefined || res.code !== undefined)) {
            const errMsg = res.errmsg || res.msg || res.message || '入室できませんでした';
            console.error(`[NetworkManager] Failed to join room: ${errMsg}`);
            return false;
          }
        } catch (err) {
          console.error('[NetworkManager] Join room exception:', err);
          return false;
        }
      }

      this.currentRoomId = safeRoomId;
      this.clientId = generateClientId();
      this.ensureMessageListener();

      this.isHost = false;
      this.isMultiplayerActive = true;
      this._seedApplied = false;
      this._hasCaughtUp = false;

      this.currentSeed = null;

      if (this._syncIntervalId) {
        clearInterval(this._syncIntervalId);
        this._syncIntervalId = null;
      }
      this._snapshotQueue.length = 0;
      this._lastSentSnapshot = null;
      this._idleKeepAliveCounter = 0;

      this._pendingPlanks.length = 0;
      this._pendingPicks.length = 0;
      this._pendingConsumes.length = 0;
      this._pendingBlows.length = 0;
      this._pendingSkills.length = 0;
      this._pendingKnockouts.length = 0;
      this._pendingScatters.length = 0;
      this._pendingSpawns.length = 0;
      this._pendingChats.length = 0;

      this.mySlot = 1;
      this.isSlotConfirmed = false;
      window.MY_PLAYER_SLOT = 1;

      const myRealName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
        ? String(window.GRAVITY_USER_NAME)
        : this.myUser.name;

      if (typeof bindLocalPlayerSlot === 'function') {
        bindLocalPlayerSlot(1);
      } else if (typeof window.bindLocalPlayerSlot === 'function') {
        window.bindLocalPlayerSlot(1);
      }
      updatePlayerName(myRealName);

      recordParticipant(this.myUser.user_id, myRealName, this.myUser.portrait, 'red', true);

      this._bindRemoteSlot(0, 'norion');
      recordParticipant('host_slot_0', 'norion', '', 'blue', true);

      safeShowGameScreen();
      notifyRestartButtonVisibility();
      this._startHostWatchdog();

      return true;
    } finally {
      setTimeout(() => {
        this._isJoiningRoom = false;
      }, 600);
    }
  },

  _handleUserJoined(data) {
    if (!this.isHost || !data) return;
    const userId = String(data.user_id || data.userId || data.uid || '');
    if (!userId || userId === String(this.myUser.user_id)) return;

    if (this.isHost) {
      const guestName = (data.name && data.name !== 'ゲスト') ? data.name : (data.user_name || 'ゲスト');
      const portrait = data.portrait || data.portait || '';
      
      let targetSlot = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

      if (targetSlot === -1) {
        for (let i = 0; i < this.slots.length; i++) {
          if (i !== this.mySlot && this.slots[i].isAI) {
            targetSlot = i;
            break;
          }
        }
      }

      if (targetSlot !== -1) {
        this.slots[targetSlot] = {
          slot: targetSlot,
          clientId: data.clientId || this.slots[targetSlot].clientId || null,
          userId: userId,
          name: guestName,
          portrait: portrait,
          isAI: false,
          joinTime: performance.now()
        };
        this._bindRemoteSlot(targetSlot, guestName);

        recordParticipant(userId, guestName, portrait, getTeamIdBySlot(targetSlot), true);
      }

      if (this.slots[0]) {
        this.slots[0].portrait = this.myUser.portrait || this.slots[0].portrait || '';
      }

      let hostCurrentStage = (player && typeof player.currentStage === 'number') ? player.currentStage : 0;
      if (isPlayerOnAttraction(player)) {
        const maxStageAllowed = (Array.isArray(STAGES) && STAGES.length > 0) ? (STAGES.length - 1) : (hostCurrentStage + 1);
        hostCurrentStage = Math.min(maxStageAllowed, hostCurrentStage + 1);
      }

      this._sendCustomMessage({
        event: 'ROOM_MEMBERS_SYNC',
        slots: this.slots,
        seed: this.currentSeed,
        hostStage: hostCurrentStage,
        hasChunks: true
      });

      const fullSnapshot = captureFullWorldSnapshot();
      this._snapshotQueue.length = 0;

      if (Array.isArray(fullSnapshot.planks) && fullSnapshot.planks.length > 0) {
        const BATCH_SIZE = 10;
        for (let i = 0; i < fullSnapshot.planks.length; i += BATCH_SIZE) {
          this._snapshotQueue.push({
            t: 'planks',
            list: fullSnapshot.planks.slice(i, i + BATCH_SIZE)
          });
        }
      }

      if (Array.isArray(fullSnapshot.blocks) && fullSnapshot.blocks.length > 0) {
        const BATCH_SIZE = 6;
        for (let i = 0; i < fullSnapshot.blocks.length; i += BATCH_SIZE) {
          this._snapshotQueue.push({
            t: 'blocks',
            list: fullSnapshot.blocks.slice(i, i + BATCH_SIZE)
          });
        }
      }

      if (Array.isArray(fullSnapshot.items) && fullSnapshot.items.length > 0) {
        const BATCH_SIZE = 8;
        for (let i = 0; i < fullSnapshot.items.length; i += BATCH_SIZE) {
          this._snapshotQueue.push({
            t: 'items',
            list: fullSnapshot.items.slice(i, i + BATCH_SIZE)
          });
        }
      }

      if (Array.isArray(fullSnapshot.bonuses) && fullSnapshot.bonuses.length > 0) {
        const BATCH_SIZE = 15;
        for (let i = 0; i < fullSnapshot.bonuses.length; i += BATCH_SIZE) {
          this._snapshotQueue.push({
            t: 'bonuses',
            list: fullSnapshot.bonuses.slice(i, i + BATCH_SIZE)
          });
        }
      }
    }
  },

  _applySnapshotChunk(chunk) {
    if (!chunk || !chunk.t || !Array.isArray(chunk.list)) return;
    const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;

    if (chunk.t === 'planks') {
      chunk.list.forEach(p => {
        if (typeof window.applyRemotePlankBuilt === 'function') {
          window.applyRemotePlankBuilt(p.stageIdx, p.laneIdx, p.plankIdx, p.teamId);
        }
      });
    } else if (chunk.t === 'blocks') {
      if (typeof window.applyRemoteBlocksBatch === 'function') {
        window.applyRemoteBlocksBatch(0, chunk.list);
      } else if (typeof window.applyRemoteBlockSpawned === 'function') {
        chunk.list.forEach(b => {
          const unpacked = unpackBlockTuple(b);
          window.applyRemoteBlockSpawned(
            unpacked.stageIdx,
            unpacked.poolIdx || 0,
            unpacked.x,
            unpacked.y,
            unpacked.z,
            unpacked.teamId,
            unpacked.blockId
          );
        });
      }
    } else if (chunk.t === 'items' && activeScene) {
      chunk.list.forEach(si => {
        const existing = floorItems.find(li => li.active && li.itemId === si.itemId);
        if (!existing) {
          const newItem = spawnItem(activeScene, si.stageIdx, si.type);
          if (newItem) {
            newItem.itemId = si.itemId;
            newItem.pos.set(si.x, si.y, si.z);
            if (newItem.mesh) newItem.mesh.position.copy(newItem.pos);
          }
        }
      });
    } else if (chunk.t === 'bonuses') {
      chunk.list.forEach(bonusId => {
        if (typeof applyRemoteBonusConsumed === 'function') {
          applyRemoteBonusConsumed(bonusId);
        } else if (typeof window.applyRemoteBonusConsumed === 'function') {
          window.applyRemoteBonusConsumed(bonusId);
        }
      });
    }
  },

  _startPositionBroadcasting() {
    if (this._syncIntervalId) clearInterval(this._syncIntervalId);

    let lastMyPos = null;
    let lastTime = performance.now();
    this._idleKeepAliveCounter = 0;

    this._syncIntervalId = setInterval(() => {
      if (!this.isMultiplayerActive || !this.isSDKAvailable) return;

      const myChar = characters[this.mySlot];
      if (!myChar) return;

      const now = performance.now();
      const dtSec = Math.max(0.001, (now - lastTime) / 1000);
      lastTime = now;

      let vx = 0, vz = 0;
      if (lastMyPos) {
        vx = (myChar.pos.x - lastMyPos.x) / dtSec;
        vz = (myChar.pos.z - lastMyPos.z) / dtSec;
      } else {
        lastMyPos = new THREE.Vector3();
      }
      lastMyPos.copy(myChar.pos);

      const myTuple = encodeCharacterToTuple(myChar, this.mySlot, vx, vz);
      const tuplesList = [myTuple];

      let anyAIActive = false;
      if (this.isHost) {
        for (let sIdx = 0; sIdx < this.slots.length; sIdx++) {
          const s = this.slots[sIdx];
          if (s.slot === this.mySlot) continue;

          const charObj = characters[s.slot];
          if (!charObj) continue;

          const isHumanPlayer = charObj.isRemote || Boolean(charObj.targetNetPos) || !s.isAI;
          if (s.isAI && !isHumanPlayer) {
            const aiTuple = encodeCharacterToTuple(charObj, s.slot, 0, 0);
            tuplesList.push(aiTuple);

            if (charObj.aiState !== 'IDLE' && charObj.aiState !== 'REMOTE_IDLE') {
              anyAIActive = true;
            }
          }
        }
      }

      const outgoingPlanks = this._pendingPlanks.length > 0 ? [...this._pendingPlanks] : undefined;
      const outgoingPicks = this._pendingPicks.length > 0 ? [...this._pendingPicks] : undefined;
      const outgoingConsumes = this._pendingConsumes.length > 0 ? [...this._pendingConsumes] : undefined;
      const outgoingBlows = this._pendingBlows.length > 0 ? [...this._pendingBlows] : undefined;
      const outgoingSkills = this._pendingSkills.length > 0 ? [...this._pendingSkills] : undefined;
      const outgoingKnockouts = this._pendingKnockouts.length > 0 ? [...this._pendingKnockouts] : undefined;
      const outgoingScatters = this._pendingScatters.length > 0 ? [...this._pendingScatters] : undefined;
      
      let outgoingSpawns = undefined;
      if (this._pendingSpawns.length > 0) {
        outgoingSpawns = this._pendingSpawns.splice(0, 4);
      }

      const outgoingChats = this._pendingChats.length > 0 ? [...this._pendingChats] : undefined;

      const hasPendingActions = Boolean(
        outgoingPlanks || outgoingPicks || outgoingConsumes || outgoingBlows ||
        outgoingSkills || outgoingKnockouts || outgoingScatters || outgoingSpawns ||
        outgoingChats || (this.isHost && this._snapshotQueue.length > 0)
      );

      const isPlayerMoving = Math.hypot(vx, vz) > 0.15;
      const isPlayerStunnedOrBuffed = (myTuple[10] !== 0);
      const isPlayerInSpecialGimmick = (myTuple[9] !== 0);
      const isActivelyRunning = isPlayerMoving || isPlayerStunnedOrBuffed || isPlayerInSpecialGimmick || anyAIActive;

      if (!hasPendingActions && !isActivelyRunning && this._lastSentSnapshot) {
        this._idleKeepAliveCounter++;
        if (this._idleKeepAliveCounter < 2) {
          return;
        }
      }

      this._idleKeepAliveCounter = 0;
      this._lastSentSnapshot = myTuple;

      this._pendingPlanks.length = 0;
      this._pendingPicks.length = 0;
      this._pendingConsumes.length = 0;
      this._pendingBlows.length = 0;
      this._pendingSkills.length = 0;
      this._pendingKnockouts.length = 0;
      this._pendingScatters.length = 0;
      this._pendingChats.length = 0;

      const posMessage = {
        e: 'P',
        l: tuplesList
      };

      if (this.isHost) {
        this._timeSyncCounter = (this._timeSyncCounter || 0) + 1;
        if (this._timeSyncCounter >= 10) {
          this._timeSyncCounter = 0;
          if (typeof window !== 'undefined' && typeof window.getGameTimeLeft === 'function') {
            const currentSec = window.getGameTimeLeft();
            if (typeof currentSec === 'number' && !isNaN(currentSec)) {
              posMessage.tl = round1(currentSec);
            }
          }
        }
      }

      if (outgoingPlanks) posMessage.pl = outgoingPlanks;
      if (outgoingPicks) posMessage.pk = outgoingPicks;
      if (outgoingConsumes) posMessage.co = outgoingConsumes;
      if (outgoingBlows) posMessage.bl = outgoingBlows;
      if (outgoingSkills) posMessage.sk = outgoingSkills;
      if (outgoingKnockouts) posMessage.ko = outgoingKnockouts;
      if (outgoingScatters) posMessage.sc = outgoingScatters;
      if (outgoingSpawns) posMessage.sp = outgoingSpawns;
      if (outgoingChats) posMessage.ch = outgoingChats;

      if (this.isHost && this._snapshotQueue.length > 0) {
        posMessage.snap = this._snapshotQueue.shift();
      }

      this._sendCustomMessage(posMessage);
    }, 100);
  },

  _handleCustomMessage(data) {
    if (!data) return;
    try {
      let rawStr = '';

      if (data.data && typeof data.data.msg_data === 'string') {
        rawStr = data.data.msg_data;
      } else if (typeof data.msg_data === 'string') {
        rawStr = data.msg_data;
      } else if (data.data && typeof data.data.message === 'string') {
        rawStr = data.data.message;
      } else if (typeof data.message === 'string') {
        rawStr = data.message;
      } else if (typeof data === 'string') {
        rawStr = data;
      }

      let packet = null;
      if (rawStr) {
        try {
          packet = JSON.parse(rawStr);
        } catch (pe) {
          packet = null;
        }
      }

      if (!packet && typeof data === 'object') {
        if (data.event || data.e) packet = data;
        else if (data.data && typeof data.data === 'object' && (data.data.event || data.data.e)) {
          packet = data.data;
        }
      }

      if (!packet) return;
      const eventType = packet.e || packet.event;
      if (!eventType) return;

      this._lastHostPacketTime = performance.now();
      if (!this._hasReceivedFirstHostPacket) {
        this._hasReceivedFirstHostPacket = true;
      }

      if (eventType === 'P' || eventType === 'POS') {
        if (packet.snap) {
          this._applySnapshotChunk(packet.snap);
        }

        const incomingList = packet.l || packet.list;
        if (Array.isArray(incomingList)) {
          for (let i = 0; i < incomingList.length; i++) {
            const decodedPacket = decodeTupleToCharacterPacket(incomingList[i]);
            this._handleRemotePosition(decodedPacket);
          }
        } else if (packet.slot !== undefined) {
          this._handleRemotePosition(packet);
        }

        const chatsList = packet.ch;
        if (Array.isArray(chatsList) && chatsList.length > 0) {
          chatsList.forEach(c => {
            if (c && c.m) {
              const senderSlot = (c.s !== undefined) ? c.s : 1;
              const senderChar = characters[senderSlot];
              const senderName = senderChar ? senderChar.name : (this.slots[senderSlot] ? this.slots[senderSlot].name : 'ゲスト');
              const teamId = getTeamIdBySlot(senderSlot);
              spawnDanmaku(c.m, senderName, teamId);
            }
          });
        }

        const scattersList = packet.sc || packet.scatters;
        if (Array.isArray(scattersList) && scattersList.length > 0) {
          scattersList.forEach(sc => {
            if (typeof window.applyRemoteScatterBlocks === 'function') {
              if (Array.isArray(sc.b)) {
                const reconstructedBlocks = [];
                const slotNum = (sc.sl !== undefined) ? sc.sl : 0;
                const baseId = sc.bid || 0;
                for (let bi = 0; bi < sc.b.length; bi++) {
                  const coord = sc.b[bi];
                  reconstructedBlocks.push({
                    blockId: `s_${sc.s}_${slotNum}_${baseId}_${bi}`,
                    x: coord[0],
                    z: coord[1]
                  });
                }
                window.applyRemoteScatterBlocks(sc.s, reconstructedBlocks);
              } else if (Array.isArray(sc.blocks)) {
                window.applyRemoteScatterBlocks(sc.s || sc.stageIdx, sc.blocks);
              }
            }
          });
        }

        const picksList = packet.pk || packet.picks;
        if (Array.isArray(picksList) && picksList.length > 0) {
          picksList.forEach(pk => {
            if (typeof window.applyRemoteBlockPicked === 'function') {
              const unpacked = unpackPickTuple(pk);
              window.applyRemoteBlockPicked(unpacked.s, unpacked.pi, unpacked.x, unpacked.z, unpacked.id);
            }
          });
        }

        const planksList = packet.pl || packet.planks;
        if (Array.isArray(planksList) && planksList.length > 0) {
          planksList.forEach(p => {
            if (typeof window.applyRemotePlankBuilt === 'function') {
              window.applyRemotePlankBuilt(p.s, p.l, p.p, p.t);
            }
          });
        }

        const consumesList = packet.co || packet.consumes;
        if (Array.isArray(consumesList) && consumesList.length > 0) {
          consumesList.forEach(c => {
            if (c.t === 'bonus' && typeof applyRemoteBonusConsumed === 'function') {
              applyRemoteBonusConsumed(c.id);
            } else if (c.t === 'bonus' && typeof window.applyRemoteBonusConsumed === 'function') {
              window.applyRemoteBonusConsumed(c.id);
            } else if (typeof window.applyRemoteObjectConsumed === 'function') {
              window.applyRemoteObjectConsumed(c.id, c.t);
            }
          });
        }

        const blowsList = packet.bl || packet.blows;
        if (Array.isArray(blowsList) && blowsList.length > 0) {
          blowsList.forEach(bl => {
            if (typeof window.applyRemoteBlowMob === 'function') {
              window.applyRemoteBlowMob(bl.m, bl.s, bl.d);
            }
          });
        }

        const spawnsList = packet.sp;
        if (Array.isArray(spawnsList) && spawnsList.length > 0) {
          if (typeof window.applyRemoteBlocksBatch === 'function') {
            window.applyRemoteBlocksBatch(0, spawnsList);
          } else if (typeof window.applyRemoteBlockSpawned === 'function') {
            spawnsList.forEach(sp => {
              const b = unpackBlockTuple(sp);
              window.applyRemoteBlockSpawned(b.stageIdx, b.poolIdx || 0, b.x, b.y, b.z, b.teamId, b.blockId);
            });
          }
        }

        const knockoutsList = packet.ko;
        if (Array.isArray(knockoutsList) && knockoutsList.length > 0) {
          knockoutsList.forEach(ko => {
            if (typeof window.applyRemoteKnockout === 'function') {
              window.applyRemoteKnockout(ko.l, ko.px, ko.pz, ko.tx, ko.tz);
            }
          });
        }

        const skillsList = packet.sk;
        if (Array.isArray(skillsList) && skillsList.length > 0) {
          skillsList.forEach(sk => {
            if (typeof window.applyRemoteFireSkill === 'function') {
              const sType = (sk.t === 0) ? 'homing' : 'thunder';
              window.applyRemoteFireSkill(sType, sk.s, sk.tg);
            }
          });
        }

        if (packet.tl !== undefined && !this.isHost && typeof window.applyRemoteTimeSync === 'function') {
          window.applyRemoteTimeSync(packet.tl);
        }
        return;
      }

      switch (eventType) {
        case 'ROOM_MEMBERS_SYNC':
          this._applyRoomMembersSync(packet.slots, packet.seed, packet.snapshot, packet.hostStage);
          if (!this.isHost && this.isMultiplayerActive && !this._syncIntervalId) {
            this._startPositionBroadcasting();
          }
          break;

        case 'RESTART_GAME':
          // ★★★ リスタート受信時の Catch-up 誤爆防止 ★★★
          // リスタート信号を受信した瞬間、全端末で Catch-up 完了フラグを確約し、
          // 通信遅延で届いた古い hostStage による位置飛び・誤伸長を完全に遮断する！
          this._hasCaughtUp = true;
          this.currentSeed = packet.seed || this.currentSeed;
          if (typeof window.onRemoteRestartReceived === 'function') {
            window.onRemoteRestartReceived(packet);
          }
          break;

        case 'TIME_UP':
          if (typeof window.applyRemoteTimeUp === 'function') {
            window.applyRemoteTimeUp();
          }
          break;
      }
    } catch (e) {
      console.warn('[NetworkManager] Failed to parse message:', e);
    }
  },

  _applyRoomMembersSync(syncedSlots, seed, snapshot = null, hostStage = 0) {
    if (!Array.isArray(syncedSlots)) return;
    this.slots = syncedSlots;

    const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;

    if (seed && (!this._seedApplied || this.currentSeed !== seed) && !this.isHost) {
      this.currentSeed = seed;
      this._seedApplied = true;
      if (activeScene) {
        purgeLocalWorldState();
        buildWorld(activeScene, seed);

        if (snapshot && Array.isArray(snapshot.blocks)) {
          floorBlockPool.forEach(b => {
            b.active = false;
            b.mesh.visible = false;
            b.attracting = false;
          });
          if (floorBlocksByStage && typeof floorBlocksByStage.forEach === 'function') {
            floorBlocksByStage.forEach(bucket => { bucket.length = 0; });
          }

          if (typeof window.applyRemoteBlocksBatch === 'function') {
            window.applyRemoteBlocksBatch(0, snapshot.blocks);
          } else {
            snapshot.blocks.forEach(b => {
              if (typeof window.applyRemoteBlockSpawned === 'function') {
                const unpacked = unpackBlockTuple(b);
                window.applyRemoteBlockSpawned(unpacked.stageIdx, unpacked.poolIdx || 0, unpacked.x, unpacked.y, unpacked.z, unpacked.teamId, unpacked.blockId);
              }
            });
          }
        }

        if (snapshot && Array.isArray(snapshot.planks)) {
          snapshot.planks.forEach(p => {
            if (typeof window.applyRemotePlankBuilt === 'function') {
              window.applyRemotePlankBuilt(p.stageIdx, p.laneIdx, p.plankIdx, p.teamId);
            }
          });
        }

        if (snapshot && Array.isArray(snapshot.items) && activeScene) {
          snapshot.items.forEach(si => {
            const existing = floorItems.find(li => li.active && li.itemId === si.itemId);
            if (!existing) {
              const newItem = spawnItem(activeScene, si.stageIdx, si.type);
              if (newItem) {
                newItem.itemId = si.itemId;
                newItem.pos.set(si.x, si.y, si.z);
                if (newItem.mesh) newItem.mesh.position.copy(newItem.pos);
              }
            }
          });
        }

        if (snapshot && Array.isArray(snapshot.bonuses)) {
          snapshot.bonuses.forEach(bId => {
            if (typeof applyRemoteBonusConsumed === 'function') {
              applyRemoteBonusConsumed(bId);
            } else if (typeof window.applyRemoteBonusConsumed === 'function') {
              window.applyRemoteBonusConsumed(bId);
            }
          });
        }
      }
    }

    syncedSlots.forEach((s) => {
      let isMyClient = false;

      if (this.isHost) {
        isMyClient = (s.slot === this.mySlot);
      } else {
        const isClientIdMatch = !!(s.clientId && s.clientId === this.clientId);
        const isUserIdMatch = !!(
          s.userId &&
          this.myUser &&
          this.myUser.user_id &&
          s.userId !== 'local_user' &&
          String(s.userId) === String(this.myUser.user_id)
        );
        const isGuestFallback = (s.slot === this.mySlot);
        isMyClient = isClientIdMatch || isUserIdMatch || isGuestFallback;
      }

      if (isMyClient) {
        this.isSlotConfirmed = true;
        if (this.mySlot !== s.slot) {
          this.mySlot = s.slot;
          window.MY_PLAYER_SLOT = s.slot;

          if (typeof bindLocalPlayerSlot === 'function') {
            bindLocalPlayerSlot(s.slot);
          } else if (typeof window.bindLocalPlayerSlot === 'function') {
            window.bindLocalPlayerSlot(s.slot);
          }

          const myRealName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
            ? String(window.GRAVITY_USER_NAME)
            : this.myUser.name;
          updatePlayerName(myRealName);
        }

        // ★★★ 途中合流（Catch-up）判定：ホストが実際に進行中（hostStage > 0）かつ自分が未合流の場合のみ発火
        if (!this.isHost && !this._hasCaughtUp && typeof hostStage === 'number' && hostStage > 0 && player) {
          this._hasCaughtUp = true;

          if (activeScene && typeof window.extendCourse === 'function') {
            while (STAGES.length <= hostStage + 2) {
              window.extendCourse(activeScene);
            }
            if (typeof window.flushPendingBonusConsumes === 'function') {
              window.flushPendingBonusConsumes();
            }
          }

          player.currentStage = hostStage;

          const targetStageObj = STAGES[hostStage] || STAGES[0];
          if (targetStageObj) {
            const centerX = targetStageObj.x || 0.0;
            let spawnXOffset = -1.6;
            if (this.mySlot === 1) spawnXOffset = -4.8;
            else if (this.mySlot === 2) spawnXOffset = 1.6;
            else if (this.mySlot === 3) spawnXOffset = 4.8;

            const spawnX = centerX + spawnXOffset;
            const spawnY = targetStageObj.y;
            const spawnZ = targetStageObj.z + 1.8;

            player.pos.set(spawnX, spawnY, spawnZ);
            if (player.meshObj && player.meshObj.root) {
              player.meshObj.root.position.copy(player.pos);
              player.meshObj.root.rotation.set(0, Math.PI, 0);
            }

            if (typeof window.currentCameraRef !== 'undefined' && window.currentCameraRef) {
              const cam = window.currentCameraRef;
              cam.position.set(spawnX * 0.75, spawnY + 24, spawnZ + 12);
              cam.lookAt(spawnX * 0.65, spawnY, spawnZ - 5);
            }

            console.log(`[NetworkManager] Catch-up Spawn 成功: ホスト現在地 (Stage ${hostStage}, Z=${Math.round(spawnZ)}m) へ即時合流完了`);
          }
        }

        recordParticipant(this.myUser.user_id, this.myUser.name, this.myUser.portrait, getTeamIdBySlot(this.mySlot), true);
        notifyRestartButtonVisibility();
        return;
      }

      if (!s.isAI && (s.clientId || s.userId || (!this.isHost && s.slot === 0))) {
        this._bindRemoteSlot(s.slot, s.name);
        
        const resolvedUserId = (s.userId && s.userId !== 'local_user' && s.userId !== 'null')
          ? String(s.userId)
          : (s.slot === 0 ? 'host_slot_0' : `guest_slot_${s.slot}`);

        const avatarUrl = s.portrait || (s.slot === 0 ? (s.portrait || '') : '');
        recordParticipant(resolvedUserId, s.name, avatarUrl, getTeamIdBySlot(s.slot), true);
      } else if (s.isAI) {
        this._restoreSlotToAI(s.slot);
      }
    });

    notifyRestartButtonVisibility();
  },

  _bindRemoteSlot(slotIndex, playerName) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    targetChar.isPlayer = false;
    targetChar.isAI = false;
    targetChar.isRemote = true;
    targetChar.aiState = 'REMOTE_IDLE';
    targetChar.aiDirX = 0;
    targetChar.aiDirZ = 0;
    targetChar.targetBlock = null;
    targetChar.searchCooldown = 999999;

    targetChar.onSlide = false;
    targetChar.onCurvedSlide = false;
    targetChar.curvedSlideProgress = 0;
    targetChar.curvedSlideOffset = 0;
    targetChar.slideCooldown = 0;
    targetChar.onZipline = false;
    targetChar.ziplineProgress = 0;
    targetChar.activeZipline = null;
    targetChar.onElevator = false;
    targetChar.elevatorProgress = 0;
    targetChar.activeElevator = null;
    targetChar.elevatorExiting = false;
    targetChar.elevatorExitTimer = 0;
    targetChar.onSkydive = false;
    targetChar.skydiveProgress = 0;
    targetChar.activeSkydive = null;
    targetChar.onTrapdoor = false;
    targetChar.trapdoorProgress = 0;
    targetChar.activeTrapdoor = null;
    targetChar.onFreefall = false;
    targetChar.freefallProgress = 0;
    targetChar.activeFreefall = null;

    targetChar.remoteActionState = 'NORMAL';
    targetChar._lastRemoteActionState = 'NORMAL';

    if (this.slots && this.slots[slotIndex]) {
      this.slots[slotIndex].isAI = false;
    }
    
    if (playerName && playerName !== 'YOU' && playerName !== 'null') {
      targetChar.name = playerName;
    } else if (!targetChar.name || targetChar.name === 'YOU') {
      targetChar.name = (slotIndex === 0 ? 'norion' : (slotIndex === 1 ? 'ゲスト1' : (slotIndex === 2 ? 'ゲスト2' : 'ゲスト3')));
    }

    if (targetChar.nameplateSprite) {
      if (targetChar.nameplateSprite.material && targetChar.nameplateSprite.material.map) {
        targetChar.nameplateSprite.material.map.dispose();
      }
      targetChar.nameplateSprite.material.dispose();
      const newMesh = createNameplateMesh(targetChar.name, false);
      if (newMesh.geometry) newMesh.geometry.dispose();
      targetChar.nameplateSprite.material = newMesh.material;
      targetChar.nameplateSprite.visible = true;
    }

    let hostCurrentStage = (this.isHost && player && typeof player.currentStage === 'number') ? player.currentStage : 0;
    if (this.isHost && isPlayerOnAttraction(player)) {
      const maxStageAllowed = (Array.isArray(STAGES) && STAGES.length > 0) ? (STAGES.length - 1) : (hostCurrentStage + 1);
      hostCurrentStage = Math.min(maxStageAllowed, hostCurrentStage + 1);
    }

    if (hostCurrentStage > 0 && STAGES[hostCurrentStage]) {
      const stageObj = STAGES[hostCurrentStage];
      const centerX = stageObj.x || 0.0;
      let spawnXOffset = -1.6;
      if (slotIndex === 1) spawnXOffset = -4.8;
      else if (slotIndex === 2) spawnXOffset = 1.6;
      else if (slotIndex === 3) spawnXOffset = 4.8;

      const spawnX = centerX + spawnXOffset;
      const spawnY = stageObj.y;
      const spawnZ = stageObj.z + 1.8;

      targetChar.currentStage = hostCurrentStage;
      targetChar.pos.set(spawnX, spawnY, spawnZ);

      if (targetChar.meshObj && targetChar.meshObj.root) {
        targetChar.meshObj.root.position.copy(targetChar.pos);
        targetChar.meshObj.root.rotation.set(0, Math.PI, 0);
        targetChar.meshObj.root.visible = true;
      }
    } else {
      if (typeof resetCharacterToStageZero === 'function') {
        resetCharacterToStageZero(targetChar, targetChar.name, false);
      } else if (typeof window.resetCharacterToStageZero === 'function') {
        window.resetCharacterToStageZero(targetChar, targetChar.name, false);
      } else {
        let defaultX = -1.6;
        if (slotIndex === 1) defaultX = -4.8;
        else if (slotIndex === 2) defaultX = 1.6;
        else if (slotIndex === 3) defaultX = 4.8;

        const stage0Y = (STAGES[0] ? STAGES[0].y : 0);
        const stage0Z = (STAGES[0] ? (STAGES[0].z + 4.0) : 4.0);
        targetChar.currentStage = 0;
        targetChar.pos.set(defaultX, stage0Y, stage0Z);
        if (targetChar.meshObj && targetChar.meshObj.root) {
          targetChar.meshObj.root.position.copy(targetChar.pos);
          targetChar.meshObj.root.rotation.set(0, Math.PI, 0);
          targetChar.meshObj.root.visible = true;
        }
      }
    }

    if (!targetChar.targetNetPos) {
      targetChar.targetNetPos = new THREE.Vector3();
    }
    targetChar.targetNetPos.copy(targetChar.pos);
    targetChar.targetNetRotY = Math.PI;
    targetChar.netVelocity = { x: 0, z: 0 };
    targetChar.lastPacketTime = performance.now();

    resetCharacterPose(targetChar);
    refreshCharacterStackVisuals(targetChar);
  },

  _restoreSlotToAI(slotIndex) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    targetChar.isPlayer = false;
    targetChar.isAI = true;
    targetChar.isRemote = false;
    targetChar.aiState = 'COLLECT';
    targetChar.targetNetPos = null;
    targetChar.name = (slotIndex === 0) ? 'CPU 0' : (slotIndex === 1 ? 'CPU 1' : (slotIndex === 2 ? 'CPU 2' : 'CPU 3'));

    targetChar.netVelocity = { x: 0, z: 0 };
    targetChar.remoteActionState = 'NORMAL';
    targetChar._lastRemoteActionState = 'NORMAL';

    targetChar.unstuckTimer = 0;
    targetChar.stuckCheckTimer = 0;
    targetChar.lastPosCheck = null;
    targetChar.unstuckDirX = 0;
    targetChar.unstuckDirZ = 0;

    targetChar.targetBlock = null;
    targetChar.aiDirX = 0;
    targetChar.aiDirZ = -1;
    targetChar.elevatorChoice = undefined;
    targetChar.forkBranchChoice = undefined;
    targetChar.botSlideOffsetTarget = 0;
    targetChar.searchCooldown = (targetChar.team && targetChar.team.id === 'red') ? 0 : 0.06;

    targetChar.currentStage = 0;
    targetChar.stackCount = 0;
    targetChar.stunTimer = 0;
    targetChar.shrinkTimer = 0;
    targetChar.invulnerableTimer = 0;
    targetChar.speedBoostActive = false;
    targetChar.speedBoostTimer = 0;
    targetChar.magnetActive = false;
    targetChar.magnetTimer = 0;

    targetChar.onZipline = false;
    targetChar.onSlide = false;
    targetChar.onCurvedSlide = false;
    targetChar.onElevator = false;
    targetChar.onSkydive = false;
    targetChar.onTrapdoor = false;
    targetChar.onFreefall = false;

    const currentStageObj = STAGES[0];
    if (currentStageObj) {
      const centerX = currentStageObj.x || 0.0;
      let defaultX = -1.6;
      if (slotIndex === 1) defaultX = -4.8;
      else if (slotIndex === 2) defaultX = 1.6;
      else if (slotIndex === 3) defaultX = 4.8;

      const safeSpawnZ = currentStageObj.z + 1.8;
      targetChar.pos.set(centerX + defaultX, currentStageObj.y, safeSpawnZ);

      if (targetChar.meshObj && targetChar.meshObj.root) {
        targetChar.meshObj.root.position.copy(targetChar.pos);
        targetChar.meshObj.root.rotation.set(0, Math.PI, 0);
        targetChar.meshObj.root.visible = true;
      }
    }

    resetCharacterPose(targetChar);
    refreshCharacterStackVisuals(targetChar);

    if (targetChar.nameplateSprite) {
      if (targetChar.nameplateSprite.material && targetChar.nameplateSprite.material.map) {
        targetChar.nameplateSprite.material.map.dispose();
      }
      targetChar.nameplateSprite.material.dispose();
      const newMesh = createNameplateMesh(targetChar.name, false);
      if (newMesh.geometry) newMesh.geometry.dispose();
      targetChar.nameplateSprite.material = newMesh.material;
      targetChar.nameplateSprite.visible = true;
    }
  },

  _handleRemotePosition(packet) {
    if (packet.slot === this.mySlot) return;

    const targetChar = characters[packet.slot];
    if (!targetChar) return;

    targetChar.isRemote = true;
    targetChar.isAI = false;
    targetChar.aiState = 'REMOTE_IDLE';

    if (this.slots && this.slots[packet.slot]) {
      this.slots[packet.slot].isAI = false;
      if (packet.clientId) this.slots[packet.slot].clientId = packet.clientId;
    }

    const packetName = (packet.name && packet.name !== 'YOU' && packet.name !== 'null') ? packet.name : null;
    let resolvedName = packetName || targetChar.name;
    if (!resolvedName || resolvedName === 'YOU') {
      resolvedName = (packet.slot === 0 ? 'norion' : (packet.slot === 1 ? 'ゲスト1' : (packet.slot === 2 ? 'ゲスト2' : 'ゲスト3')));
    }

    const isGenericGuestName = (targetChar.name === 'ゲスト' || targetChar.name === 'ゲスト1' || targetChar.name === 'ゲスト2' || targetChar.name === 'ゲスト3' || targetChar.name === 'CPU 0');
    const isUpgradedToRealName = isGenericGuestName && packetName && packetName !== targetChar.name;

    if (targetChar.name !== resolvedName || isUpgradedToRealName) {
      targetChar.name = resolvedName;

      if (this.slots && this.slots[packet.slot]) {
        this.slots[packet.slot].name = resolvedName;
      }

      if (targetChar.nameplateSprite) {
        if (targetChar.nameplateSprite.material && targetChar.nameplateSprite.material.map) {
          targetChar.nameplateSprite.material.map.dispose();
        }
        targetChar.nameplateSprite.material.dispose();
        const newMesh = createNameplateMesh(resolvedName, false);
        if (newMesh.geometry) newMesh.geometry.dispose();
        targetChar.nameplateSprite.material = newMesh.material;
        targetChar.nameplateSprite.visible = true;
      }
    }

    if (packet.stage !== undefined && targetChar.currentStage !== packet.stage) {
      targetChar.currentStage = packet.stage;
      targetChar.pos.set(packet.x, packet.y, packet.z);
      if (targetChar.meshObj && targetChar.meshObj.root) {
        targetChar.meshObj.root.position.copy(targetChar.pos);
      }
    }

    if (!targetChar.targetNetPos) {
      targetChar.targetNetPos = new THREE.Vector3();
    }
    targetChar.targetNetPos.set(packet.x, packet.y, packet.z);
    targetChar.targetNetRotY = packet.rotY;

    targetChar.netVelocity = {
      x: packet.vx || 0,
      z: packet.vz || 0
    };
    targetChar.remoteActionState = packet.state || 'NORMAL';
    targetChar.lastPacketTime = performance.now();

    if (packet.state === 'ELEVATOR') {
      if (packet.e !== undefined && typeof packet.e === 'number') {
        targetChar.elevatorLane = packet.e;
      }
    } else {
      if (targetChar.elevatorLane !== undefined && targetChar.remoteActionState !== 'ELEVATOR') {
        targetChar.elevatorLane = undefined;
      }
    }

    targetChar.speedBoostActive = Boolean(packet.boost);
    targetChar.isStunned = Boolean(packet.stun);

    if (!packet.stun) {
      targetChar.stunTimer = 0;
    }

    targetChar.isShrunk = Boolean(packet.shrink);
    if (!packet.shrink) {
      targetChar.shrinkTimer = 0;
    }

    targetChar.magnetActive = Boolean(packet.magnet);
    targetChar.isInvulnerable = Boolean(packet.invuln);
    if (!packet.invuln) {
      targetChar.invulnerableTimer = 0;
    }

    if (targetChar.stackCount !== packet.stack) {
      targetChar.stackCount = packet.stack;
      refreshCharacterStackVisuals(targetChar);
    }
  },

  _sendCustomMessage(msgObj) {
    if (!this.isSDKAvailable || !window.AgentSDK.room || typeof window.AgentSDK.room.sendMessage !== 'function') return;
    try {
      const msgStr = JSON.stringify(msgObj);
      window.AgentSDK.room.sendMessage({
        message: msgStr
      });
    } catch (e) {
      console.warn('[NetworkManager] sendMessage failed:', e);
    }
  },

  broadcastRestartGame(newSeed, snapshot = null) {
    if (!this.isMultiplayerActive || !this.isHost) return;
    this.currentSeed = newSeed;
    // ★ ホスト自身も Catch-up 完了フラグを確約
    this._hasCaughtUp = true;
    this._sendCustomMessage({
      event: 'RESTART_GAME',
      seed: newSeed,
      snapshot: null
    });
  },

  broadcastSpawnBlocksBatch(stageIdx, blocksArray) {
    this.queueSpawnBlocks(blocksArray);
  },

  broadcastSpawnBlock(stageIdx, poolIdx, x, y, z, teamId, blockId) {
    this.queueSpawnBlocks([{ stageIdx, poolIdx, x, y, z, teamId, blockId }]);
  },

  broadcastPickBlock(blockId, stageIdx, poolIdx, x, z) {
    this.queueBlockPick(blockId, stageIdx, poolIdx, x, z);
  },

  broadcastConsumeObject(objectId, objectType) {
    this.queueConsumeObject(objectId, objectType);
  },

  broadcastBlowMob(mobIndex, stageIdx, pushDirX) {
    this.queueBlowMob(mobIndex, stageIdx, pushDirX);
  },

  broadcastTimeUp() {
    if (!this.isMultiplayerActive || !this.isHost) return;
    this._sendCustomMessage({
      event: 'TIME_UP'
    });
  },

  _handleUserExited(data) {
    if (!data) return;
    const userId = String(data.user_id || data.userId || '');
    const exitedSlotIdx = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

    if (exitedSlotIdx !== -1) {
      const slotObj = this.slots[exitedSlotIdx];
      const timeSinceJoin = performance.now() - (slotObj.joinTime || 0);
      if (timeSinceJoin < 2000 && !slotObj.isAI) {
        console.warn(`[NetworkManager] Ignored false user exit (grace period ${Math.round(timeSinceJoin)}ms): Slot ${exitedSlotIdx}, User ${userId}`);
        return;
      }

      const isExitedSlotHost = (exitedSlotIdx === 0 && !this.isHost);

      this.slots[exitedSlotIdx] = {
        slot: exitedSlotIdx,
        clientId: null,
        userId: null,
        name: (exitedSlotIdx === 0) ? 'CPU 0' : (exitedSlotIdx === 1 ? 'CPU 1' : (exitedSlotIdx === 2 ? 'CPU 2' : 'CPU 3')),
        portrait: '',
        isAI: true,
        joinTime: 0
      };

      this._restoreSlotToAI(exitedSlotIdx);

      markParticipantInactive(userId);

      if (isExitedSlotHost) {
        console.warn(`[NetworkManager] Host (Slot 0) exited room. Promoting to Host...`);
        this.promoteToHost();
      } else if (this.isHost) {
        let hostCurrentStage = (player && typeof player.currentStage === 'number') ? player.currentStage : 0;
        if (isPlayerOnAttraction(player)) {
          const maxStageAllowed = (Array.isArray(STAGES) && STAGES.length > 0) ? (STAGES.length - 1) : (hostCurrentStage + 1);
          hostCurrentStage = Math.min(maxStageAllowed, hostCurrentStage + 1);
        }

        this._sendCustomMessage({
          event: 'ROOM_MEMBERS_SYNC',
          slots: this.slots,
          seed: this.currentSeed,
          hostStage: hostCurrentStage,
          hasChunks: false
        });
      }
    }
    notifyRestartButtonVisibility();
  },

  async exitRoom() {
    this._stopHostWatchdog();
    if (this._syncIntervalId) {
      clearInterval(this._syncIntervalId);
      this._syncIntervalId = null;
    }
    this._snapshotQueue.length = 0;
    this._lastSentSnapshot = null;
    this._idleKeepAliveCounter = 0;
    this._hasCaughtUp = false;

    this._pendingPlanks.length = 0;
    this._pendingPicks.length = 0;
    this._pendingConsumes.length = 0;
    this._pendingBlows.length = 0;
    this._pendingSkills.length = 0;
    this._pendingKnockouts.length = 0;
    this._pendingScatters.length = 0;
    this._pendingSpawns.length = 0;
    this._pendingChats.length = 0;

    if (Array.isArray(characters)) {
      characters.forEach((c) => {
        if (!c) return;
        c.stackCount = 0;
        c.currentStage = 0;
        c.stunTimer = 0;
        c.shrinkTimer = 0;
        c.invulnerableTimer = 0;
        c.speedBoostActive = false;
        c.speedBoostTimer = 0;
        c.magnetActive = false;
        c.magnetTimer = 0;
        if (typeof resetCharacterPose === 'function') resetCharacterPose(c);
        if (typeof refreshCharacterStackVisuals === 'function') refreshCharacterStackVisuals(c);
      });
    }

    purgeLocalWorldState();

    if (this.myUser && this.myUser.user_id) {
      markParticipantInactive(this.myUser.user_id);
    }

    await safeExitCurrentRoom(null);
    this.currentRoomId = null;
    this.isHost = false;
    this.isMultiplayerActive = false;
    this.mySlot = 0;
    this.isSlotConfirmed = false;
    this._seedApplied = false;
    this._hasReceivedFirstHostPacket = false;

    this.currentSeed = null;

    if (typeof bindLocalPlayerSlot === 'function') {
      bindLocalPlayerSlot(0);
    } else if (typeof window.bindLocalPlayerSlot === 'function') {
      window.bindLocalPlayerSlot(0);
    }

    notifyRestartButtonVisibility();

    if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.showLobby === 'function') {
      window.UIController.showLobby();
    }
  }
};

if (typeof window !== 'undefined') {
  window.NetworkManager = NetworkManager;
}