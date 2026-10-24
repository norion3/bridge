// network.js: AgentSDK公式仕様完全準拠 ＆ 極小タプルパッカー（約115B・68%削減）＆ スマートDelta送信 ＆ ゼロアロケーション純粋算術丸めエンジン
// ★ Phase 4 完全同期＆アクション安定化版（ボーナススナップショット網羅 ＆ スマートDelta適正化）：
//   1. 【初期スナップショットにボーナス回収状態（consumedBonusIds）を完全網羅】
//      captureFullWorldSnapshot() にスライダーやアトラクションの回収済み白ブロックID配列を含め、
//      途中入室時にホスト側で既に回収された白ブロックがゲスト側で満タン復活する不整合を完全根絶。
//   2. 【静止時スマートDelta待機周波数の適正化（2Hz -> 5Hz）】
//      走者が立ち止まって様子を見ている間の間引き頻度を 500ms（2Hz）から 200ms（5Hz）へ安全緩和。
//      静止状態からの被弾・衝突・スキル初動の通信遅滞を最大0.5秒から0.2秒へ短縮し、アクション同期を極限まで安定化。
//   3. 【11要素フラットタプル配列 ＆ ゼロアロケーション純粋算術丸め（round1/round2）の完全維持】
//      ヒープ文字列生成ゼロ、パケットサイズ極小化、透過的デコーダーを100%維持。
//   4. 【動的ライフサイクル耐性（途中入退室・ホスト昇格・再入室）の完全維持】
//      スロット不変型ホスト昇格、リスナー単一登録の永続化、セマンティック・チャンキングを100%維持。

import {
  player,
  characters,
  createNameplateMesh,
  updatePlayerName,
  bindLocalPlayerSlot,
  refreshCharacterStackVisuals,
  resetCharacterToStageZero
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
  applyRemoteBonusConsumed
} from './world.js';
import { resetParticlePools, floorBlockPool } from './particles.js';

// --- 高速・ゼロアロケーション純粋算術丸めヘルパー（文字列インスタンス生成ゼロ） ---
// 小数第1位丸め（10cm単位精度）
const round1 = (val) => Math.round(val * 10) / 10;
// 小数第2位丸め（1cm単位精度）
const round2 = (val) => Math.round(val * 100) / 100;

// --- アクション状態IDおよびビットマスク定数マッピング ---
const ACTION_STATE_TO_ID = {
  NORMAL: 0,
  JUMP: 1,
  SKYDIVE: 2,
  ELEVATOR: 3,
  TRAPDOOR: 4,
  ZIPLINE: 5,
  SLIDE: 6
};

const ID_TO_ACTION_STATE = [
  'NORMAL',
  'JUMP',
  'SKYDIVE',
  'ELEVATOR',
  'TRAPDOOR',
  'ZIPLINE',
  'SLIDE'
];

/**
 * 未入室時の exit() による無限保留（Promiseハング）を確実に防ぐ安全退出ヘルパー
 */
async function safeExitCurrentRoom() {
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
 * ★【核心改修】回収済みボーナスブロックID（bonuses）をスナップショットに網羅
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
      if (b && b.active && !b.attracting && b.pos && b.stageIdx <= allowedStageLimit) {
        blocks.push({
          poolIdx: idx,
          stageIdx: b.stageIdx || 0,
          x: round2(b.pos.x),
          y: round2(b.pos.y),
          z: round2(b.pos.z),
          teamId: (b.team && b.team.id) ? b.team.id : 'neutral',
          blockId: b.blockId || null
        });
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
      if (it && it.active && it.pos && it.stageIdx <= allowedStageLimit) {
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

  // ★【核心改修】既に回収された全アトラクションの白ブロックIDを収集
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

/**
 * 端末固有のセッションIDを生成
 */
function generateClientId() {
  return 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
}

/**
 * キャラクターの現在の搭乗・アクション状態文字列を取得するヘルパー
 */
function getCharacterActionState(c) {
  if (!c) return 'NORMAL';
  if (c.isJumping) return 'JUMP';
  if (c.onSkydive) return 'SKYDIVE';
  if (c.onElevator) return 'ELEVATOR';
  if (c.onTrapdoor || c.onFreefall) return 'TRAPDOOR';
  if (c.onZipline) return 'ZIPLINE';
  if (c.onSlide || c.onCurvedSlide) return 'SLIDE';
  return 'NORMAL';
}

/**
 * 走者オブジェクトを11要素のフラットタプル配列へ極小パック
 * フォーマット: [slot, x, y, z, vx, vz, rotY, stack, stage, stateId, flags, (e)]
 */
function encodeCharacterToTuple(charObj, slotIndex, vx = 0, vz = 0) {
  const stateStr = getCharacterActionState(charObj);
  const stateId = ACTION_STATE_TO_ID[stateStr] !== undefined ? ACTION_STATE_TO_ID[stateStr] : 0;

  // 5つのブール値を1バイト整数（ビットマスク: 0〜31）へ圧縮
  let flags = 0;
  if (charObj.speedBoostActive) flags |= 1;           // bit 0: boost
  if (charObj.stunTimer > 0) flags |= 2;             // bit 1: stun
  if (charObj.shrinkTimer > 0) flags |= 4;           // bit 2: shrink
  if (charObj.magnetActive) flags |= 8;              // bit 3: magnet
  if (charObj.invulnerableTimer > 0) flags |= 16;    // bit 4: invuln

  const rawRotY = (charObj.meshObj && charObj.meshObj.root)
    ? charObj.meshObj.root.rotation.y
    : (charObj.rotation || 0);
  const rotY = round2(rawRotY);

  const tuple = [
    slotIndex,
    round1(charObj.pos.x),
    round1(charObj.pos.y),
    round1(charObj.pos.z),
    round1(vx),
    round1(vz),
    rotY,
    charObj.stackCount || 0,
    charObj.currentStage || 0,
    stateId,
    flags
  ];

  // エレベーター搭乗中のみ、レーン番号（0〜2）を末尾に付与（1バイト）
  if (stateId === 3 && typeof charObj.elevatorLane === 'number') {
    tuple.push(charObj.elevatorLane);
  }

  return tuple;
}

/**
 * 受信したフラットタプル配列を従来の完全オブジェクトへ透過復元
 */
function decodeTupleToCharacterPacket(item) {
  if (!Array.isArray(item)) {
    return item;
  }

  const slot = item[0];
  const x = item[1];
  const y = item[2];
  const z = item[3];
  const vx = item[4] || 0;
  const vz = item[5] || 0;
  const rotY = item[6] || 0;
  const stack = item[7] || 0;
  const stage = item[8] || 0;
  const stateId = item[9] || 0;
  const flags = item[10] || 0;
  const elevatorLane = item[11] !== undefined ? item[11] : undefined;

  return {
    slot: slot,
    x: x,
    y: y,
    z: z,
    vx: vx,
    vz: vz,
    rotY: rotY,
    stack: stack,
    stage: stage,
    state: ID_TO_ACTION_STATE[stateId] || 'NORMAL',
    boost: Boolean(flags & 1),
    stun: Boolean(flags & 2),
    shrink: Boolean(flags & 4),
    magnet: Boolean(flags & 8),
    invuln: Boolean(flags & 16),
    e: elevatorLane
  };
}

export const NetworkManager = {
  isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
  currentRoomId: null,
  clientId: generateClientId(),
  myUser: { name: 'YOU', user_id: 'local_user', portrait: '' },
  
  slots: [
    { slot: 0, clientId: null, userId: null, name: 'norion', isAI: false },
    { slot: 1, clientId: null, userId: null, name: 'CPU 1', isAI: true },
    { slot: 2, clientId: null, userId: null, name: 'CPU 2', isAI: true }
  ],
  
  isHost: false,
  isMultiplayerActive: false,
  mySlot: 0,
  isSlotConfirmed: false,
  currentSeed: 12345678,
  _seedApplied: false,

  _hasRegisteredListener: false,
  _lastRefreshTime: 0,
  _syncIntervalId: null,
  _timeSyncCounter: 0,

  _isCreatingRoom: false,
  _isJoiningRoom: false,

  // ★ ハートビート（無通信監視）タイマー関連（2段階安全緩和）
  _lastHostPacketTime: 0,
  _watchdogIntervalId: null,
  _hasReceivedFirstHostPacket: false,
  _isPromoting: false,

  // ★ スナップショット時分割送信キュー（1通あたり最大25〜30件にスライス）
  _snapshotQueue: [],

  // ★ 静止時スマートDelta送信制御用キャッシュ
  _lastSentSnapshot: null,
  _idleKeepAliveCounter: 0,

  // ★ 100ms周期パケットへ完全集約するためのアクション蓄積キュー
  _pendingPlanks: [],     // pl: 階段設置
  _pendingPicks: [],      // pk: ブロック取得
  _pendingConsumes: [],   // co: オブジェクト消費
  _pendingBlows: [],      // bl: モブ吹き飛ばし
  _pendingSkills: [],     // sk: スキル発射
  _pendingKnockouts: [],  // ko: ノックアウト確定
  _pendingScatters: [],   // sc: 散乱ブロック
  _pendingSpawns: [],     // sp: 床ブロック補充（ホスト専用）

  captureWorldSnapshot: captureFullWorldSnapshot,

  // --- アクション蓄積キュー登録API ---

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
    this._pendingPicks.push({
      id: blockId,
      s: stageIdx,
      pi: poolIdx,
      x: round1(x),
      z: round1(z)
    });
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
      t: skillTypeInt, // 0: homing, 1: thunder
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
      let tNum = 3; // neutral
      if (b.teamId === 'blue') tNum = 0;
      else if (b.teamId === 'red') tNum = 1;
      else if (b.teamId === 'yellow') tNum = 2;

      this._pendingSpawns.push({
        s: b.stageIdx,
        pi: b.poolIdx,
        x: round1(b.x),
        z: round1(b.z),
        t: tNum,
        id: b.blockId
      });
    }
  },

  async init() {
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
      const timeoutThreshold = this._hasReceivedFirstHostPacket ? 3500 : 6000;

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
      slotData.name = (i === 0) ? 'CPU 0' : (i === 1 ? 'CPU 1' : 'CPU 2');

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
          const max = Number(r.max_players) || 3;
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
      await safeExitCurrentRoom();

      let createdRoomId = 'local_room_' + Math.floor(Math.random() * 1000);

      if (this.isSDKAvailable) {
        try {
          const permission = isPrivate ? 1 : 0;
          const res = await window.AgentSDK.room.create({ max_players: 3, room_permission: permission });

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

      this._stopHostWatchdog();
      if (this._syncIntervalId) {
        clearInterval(this._syncIntervalId);
        this._syncIntervalId = null;
      }
      this._snapshotQueue.length = 0;
      this._lastSentSnapshot = null;
      this._idleKeepAliveCounter = 0;

      // バッファ初期化
      this._pendingPlanks.length = 0;
      this._pendingPicks.length = 0;
      this._pendingConsumes.length = 0;
      this._pendingBlows.length = 0;
      this._pendingSkills.length = 0;
      this._pendingKnockouts.length = 0;
      this._pendingScatters.length = 0;
      this._pendingSpawns.length = 0;

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

      this.slots[0] = { slot: 0, clientId: this.clientId, userId: this.myUser.user_id, name: this.myUser.name, isAI: false };
      this.slots[1] = { slot: 1, clientId: null, userId: null, name: 'CPU 1', isAI: true };
      this.slots[2] = { slot: 2, clientId: null, userId: null, name: 'CPU 2', isAI: true };

      const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;
      if (activeScene) {
        try {
          if (floorBlocksByStage && typeof floorBlocksByStage.clear === 'function') {
            floorBlocksByStage.clear();
          }
          resetParticlePools();
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
      await safeExitCurrentRoom();

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

      if (this._syncIntervalId) {
        clearInterval(this._syncIntervalId);
        this._syncIntervalId = null;
      }
      this._snapshotQueue.length = 0;
      this._lastSentSnapshot = null;
      this._idleKeepAliveCounter = 0;

      // バッファ初期化
      this._pendingPlanks.length = 0;
      this._pendingPicks.length = 0;
      this._pendingConsumes.length = 0;
      this._pendingBlows.length = 0;
      this._pendingSkills.length = 0;
      this._pendingKnockouts.length = 0;
      this._pendingScatters.length = 0;
      this._pendingSpawns.length = 0;

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

      this._bindRemoteSlot(0, 'norion');

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
          isAI: false
        };
        this._bindRemoteSlot(targetSlot, guestName);
      }

      this._sendCustomMessage({
        event: 'ROOM_MEMBERS_SYNC',
        slots: this.slots,
        seed: this.currentSeed,
        hasChunks: true
      });

      const fullSnapshot = captureFullWorldSnapshot();
      this._snapshotQueue.length = 0;

      if (Array.isArray(fullSnapshot.planks) && fullSnapshot.planks.length > 0) {
        const BATCH_SIZE = 30;
        for (let i = 0; i < fullSnapshot.planks.length; i += BATCH_SIZE) {
          this._snapshotQueue.push({
            t: 'planks',
            list: fullSnapshot.planks.slice(i, i + BATCH_SIZE)
          });
        }
      }

      if (Array.isArray(fullSnapshot.blocks) && fullSnapshot.blocks.length > 0) {
        const BATCH_SIZE = 25;
        for (let i = 0; i < fullSnapshot.blocks.length; i += BATCH_SIZE) {
          this._snapshotQueue.push({
            t: 'blocks',
            list: fullSnapshot.blocks.slice(i, i + BATCH_SIZE)
          });
        }
      }

      if (Array.isArray(fullSnapshot.items) && fullSnapshot.items.length > 0) {
        const BATCH_SIZE = 20;
        for (let i = 0; i < fullSnapshot.items.length; i += BATCH_SIZE) {
          this._snapshotQueue.push({
            t: 'items',
            list: fullSnapshot.items.slice(i, i + BATCH_SIZE)
          });
        }
      }

      // ★【核心改修】回収済みボーナスブロック配列のスライス送信キューイング
      if (Array.isArray(fullSnapshot.bonuses) && fullSnapshot.bonuses.length > 0) {
        const BATCH_SIZE = 25;
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
      chunk.list.forEach(b => {
        if (typeof window.applyRemoteBlockSpawned === 'function') {
          window.applyRemoteBlockSpawned(b.stageIdx, b.poolIdx, b.x, b.y, b.z, b.teamId, b.blockId);
        }
      });
    } else if (chunk.t === 'items' && activeScene) {
      chunk.list.forEach(si => {
        const existing = floorItems.find(li => li.active && (li.itemId === si.itemId || (li.stageIdx === si.stageIdx && li.type === si.type)));
        if (!existing) {
          spawnItem(activeScene, si.stageIdx, si.type);
        }
      });
    } else if (chunk.t === 'bonuses') {
      // ★【核心改修】途中入室時にホストで回収済みのボーナスブロックを即座に消去
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

      // 自機タプルのエンコード
      const myTuple = encodeCharacterToTuple(myChar, this.mySlot, vx, vz);
      const tuplesList = [myTuple];

      // ホストであれば、人間が接続していない全自律AIの座標もタプル化して同封
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

      // バッファから各アクションを切り出し
      const outgoingPlanks = this._pendingPlanks.length > 0 ? [...this._pendingPlanks] : undefined;
      const outgoingPicks = this._pendingPicks.length > 0 ? [...this._pendingPicks] : undefined;
      const outgoingConsumes = this._pendingConsumes.length > 0 ? [...this._pendingConsumes] : undefined;
      const outgoingBlows = this._pendingBlows.length > 0 ? [...this._pendingBlows] : undefined;
      const outgoingSkills = this._pendingSkills.length > 0 ? [...this._pendingSkills] : undefined;
      const outgoingKnockouts = this._pendingKnockouts.length > 0 ? [...this._pendingKnockouts] : undefined;
      const outgoingScatters = this._pendingScatters.length > 0 ? [...this._pendingScatters] : undefined;
      const outgoingSpawns = this._pendingSpawns.length > 0 ? [...this._pendingSpawns] : undefined;

      const hasPendingActions = Boolean(
        outgoingPlanks || outgoingPicks || outgoingConsumes || outgoingBlows ||
        outgoingSkills || outgoingKnockouts || outgoingScatters || outgoingSpawns ||
        (this.isHost && this._snapshotQueue.length > 0)
      );

      // ★【Phase 4 核心】静止時スマートDeltaの送信頻度適正化（500ms -> 200ms）
      // 5回（500ms）間引きから 2回（200ms / 5Hz）へ安全緩和し、様子見からのアクション初動ラグを解消
      const isPlayerMoving = Math.hypot(vx, vz) > 0.15;
      const isPlayerStunnedOrBuffed = (myTuple[10] !== 0); // flags: boost, stun, shrink, magnet, invuln
      const isPlayerInSpecialGimmick = (myTuple[9] !== 0); // stateId !== NORMAL
      const isActivelyRunning = isPlayerMoving || isPlayerStunnedOrBuffed || isPlayerInSpecialGimmick || anyAIActive;

      if (!hasPendingActions && !isActivelyRunning && this._lastSentSnapshot) {
        this._idleKeepAliveCounter++;
        // 2回に1回（200ms・5Hzの安全Keep-Alive）以外は送信をスキップ
        if (this._idleKeepAliveCounter < 2) {
          return;
        }
      }

      this._idleKeepAliveCounter = 0;
      this._lastSentSnapshot = myTuple;

      // バッファのクリア
      this._pendingPlanks.length = 0;
      this._pendingPicks.length = 0;
      this._pendingConsumes.length = 0;
      this._pendingBlows.length = 0;
      this._pendingSkills.length = 0;
      this._pendingKnockouts.length = 0;
      this._pendingScatters.length = 0;
      this._pendingSpawns.length = 0;

      const posMessage = {
        e: 'P',
        l: tuplesList
      };

      // タイマー同期（ホストが10カウント＝1.0秒に1回のみ同封）
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

      // 相乗りアクションの付与
      if (outgoingPlanks) posMessage.pl = outgoingPlanks;
      if (outgoingPicks) posMessage.pk = outgoingPicks;
      if (outgoingConsumes) posMessage.co = outgoingConsumes;
      if (outgoingBlows) posMessage.bl = outgoingBlows;
      if (outgoingSkills) posMessage.sk = outgoingSkills;
      if (outgoingKnockouts) posMessage.ko = outgoingKnockouts;
      if (outgoingScatters) posMessage.sc = outgoingScatters;
      if (outgoingSpawns) posMessage.sp = outgoingSpawns;

      // 分割スナップショットキューがあれば相乗り
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
        // 0. snap (分割スナップショットの即時反映)
        if (packet.snap) {
          this._applySnapshotChunk(packet.snap);
        }

        // 1. l / list (走者座標のタプルデコード ＆ 補間目標更新)
        const incomingList = packet.l || packet.list;
        if (Array.isArray(incomingList)) {
          for (let i = 0; i < incomingList.length; i++) {
            const decodedPacket = decodeTupleToCharacterPacket(incomingList[i]);
            this._handleRemotePosition(decodedPacket);
          }
        } else if (packet.slot !== undefined) {
          this._handleRemotePosition(packet);
        }

        // 2. sc (散乱ブロックの生成・床面配置)
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

        // 3. pk (ブロック取得の反映・消去)
        const picksList = packet.pk || packet.picks;
        if (Array.isArray(picksList) && picksList.length > 0) {
          picksList.forEach(pk => {
            if (typeof window.applyRemoteBlockPicked === 'function') {
              window.applyRemoteBlockPicked(pk.s, pk.pi, pk.x, pk.z, pk.id);
            }
          });
        }

        // 階段設置の反映
        const planksList = packet.pl || packet.planks;
        if (Array.isArray(planksList) && planksList.length > 0) {
          planksList.forEach(p => {
            if (typeof window.applyRemotePlankBuilt === 'function') {
              window.applyRemotePlankBuilt(p.s, p.l, p.p, p.t);
            }
          });
        }

        // 4. co (アイテム・ゲート・ボーナス消費)
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

        // 5. bl (敵モブ吹き飛ばし演出)
        const blowsList = packet.bl || packet.blows;
        if (Array.isArray(blowsList) && blowsList.length > 0) {
          blowsList.forEach(bl => {
            if (typeof window.applyRemoteBlowMob === 'function') {
              window.applyRemoteBlowMob(bl.m, bl.s, bl.d);
            }
          });
        }

        // 6. sp (ホストからのブロック補充バッチ)
        const spawnsList = packet.sp;
        if (Array.isArray(spawnsList) && spawnsList.length > 0 && typeof window.applyRemoteBlockSpawned === 'function') {
          spawnsList.forEach(sp => {
            const teamStr = (sp.t === 0) ? 'blue' : (sp.t === 1 ? 'red' : (sp.t === 2 ? 'yellow' : 'neutral'));
            window.applyRemoteBlockSpawned(sp.s, sp.pi, sp.x, undefined, sp.z, teamStr, sp.id);
          });
        }

        // 7. ko (ノックアウト被弾・着地座標の強制確定)
        const knockoutsList = packet.ko;
        if (Array.isArray(knockoutsList) && knockoutsList.length > 0) {
          knockoutsList.forEach(ko => {
            if (typeof window.applyRemoteKnockout === 'function') {
              window.applyRemoteKnockout(ko.l, ko.px, ko.pz, ko.tx, ko.tz);
            }
          });
        }

        // 8. sk (攻撃スキル弾頭生成・発射演出)
        const skillsList = packet.sk;
        if (Array.isArray(skillsList) && skillsList.length > 0) {
          skillsList.forEach(sk => {
            if (typeof window.applyRemoteFireSkill === 'function') {
              const sType = (sk.t === 0) ? 'homing' : 'thunder';
              window.applyRemoteFireSkill(sType, sk.s, sk.tg);
            }
          });
        }

        // 9. tl (タイマー同期)
        if (packet.tl !== undefined && !this.isHost && typeof window.applyRemoteTimeSync === 'function') {
          window.applyRemoteTimeSync(packet.tl);
        }
        return;
      }

      switch (eventType) {
        case 'ROOM_MEMBERS_SYNC':
          this._applyRoomMembersSync(packet.slots, packet.seed, packet.snapshot);
          if (!this.isHost && this.isMultiplayerActive && !this._syncIntervalId) {
            this._startPositionBroadcasting();
          }
          break;

        case 'RESTART_GAME':
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

  _applyRoomMembersSync(syncedSlots, seed, snapshot = null) {
    if (!Array.isArray(syncedSlots)) return;
    this.slots = syncedSlots;

    const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;

    if (seed && (!this._seedApplied || this.currentSeed !== seed) && !this.isHost) {
      this.currentSeed = seed;
      this._seedApplied = true;
      if (activeScene) {
        resetParticlePools();
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

          snapshot.blocks.forEach(b => {
            if (typeof window.applyRemoteBlockSpawned === 'function') {
              window.applyRemoteBlockSpawned(b.stageIdx, b.poolIdx, b.x, b.y, b.z, b.teamId, b.blockId);
            }
          });
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
            const existing = floorItems.find(li => li.active && (li.itemId === si.itemId || (li.stageIdx === si.stageIdx && li.type === si.type)));
            if (!existing) {
              spawnItem(activeScene, si.stageIdx, si.type);
            }
          });
        }

        // ★【核心改修】同期スナップショット内に回収済みボーナスIDが含まれていれば即座に反映
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
        notifyRestartButtonVisibility();
        return;
      }

      if (!s.isAI && (s.clientId || s.userId || (!this.isHost && s.slot === 0))) {
        this._bindRemoteSlot(s.slot, s.name);
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

    if (this.slots && this.slots[slotIndex]) {
      this.slots[slotIndex].isAI = false;
    }
    
    if (playerName && playerName !== 'YOU' && playerName !== 'null') {
      targetChar.name = playerName;
    } else if (!targetChar.name || targetChar.name === 'YOU') {
      targetChar.name = (slotIndex === 0 ? 'norion' : (slotIndex === 1 ? 'ゲスト1' : 'ゲスト2'));
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

    if (typeof resetCharacterToStageZero === 'function') {
      resetCharacterToStageZero(targetChar, targetChar.name, false);
    } else if (typeof window.resetCharacterToStageZero === 'function') {
      window.resetCharacterToStageZero(targetChar, targetChar.name, false);
    } else {
      const defaultX = (slotIndex === 1) ? -4.0 : (slotIndex === 2 ? 4.0 : 0.0);
      const stage0Y = (STAGES[0] ? STAGES[0].y : 0);
      const stage0Z = (STAGES[0] ? (STAGES[0].z + 4.0) : 4.0);
      targetChar.currentStage = 0;
      targetChar.pos.set(defaultX, stage0Y, stage0Z);
      if (targetChar.meshObj && targetChar.meshObj.root) {
        targetChar.meshObj.root.position.copy(targetChar.pos);
        targetChar.meshObj.root.rotation.set(0, Math.PI, 0);
      }
    }

    if (!targetChar.targetNetPos) {
      targetChar.targetNetPos = new THREE.Vector3();
    }
    targetChar.targetNetPos.copy(targetChar.pos);
    targetChar.netVelocity = { x: 0, z: 0 };
    targetChar.lastPacketTime = performance.now();
  },

  _restoreSlotToAI(slotIndex) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    targetChar.isPlayer = false;
    targetChar.isAI = true;
    targetChar.isRemote = false;
    targetChar.aiState = 'COLLECT';
    targetChar.targetNetPos = null;
    targetChar.name = (slotIndex === 0) ? 'CPU 0' : (slotIndex === 1 ? 'CPU 1' : 'CPU 2');

    targetChar.netVelocity = { x: 0, z: 0 };
    targetChar.remoteActionState = 'NORMAL';

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
      resolvedName = (packet.slot === 0 ? 'norion' : (packet.slot === 1 ? 'ゲスト1' : 'ゲスト2'));
    }

    const isGenericGuestName = (targetChar.name === 'ゲスト' || targetChar.name === 'ゲスト1' || targetChar.name === 'ゲスト2' || targetChar.name === 'CPU 0');
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
    const finalSnapshot = snapshot || captureFullWorldSnapshot();
    this.currentSeed = newSeed;
    this._sendCustomMessage({
      event: 'RESTART_GAME',
      seed: newSeed,
      snapshot: finalSnapshot
    });
  },

  // --- 後方互換・外部呼び出し対応 ---

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
      const isExitedSlotHost = (exitedSlotIdx === 0 && !this.isHost);

      this.slots[exitedSlotIdx] = {
        slot: exitedSlotIdx,
        clientId: null,
        userId: null,
        name: (exitedSlotIdx === 0) ? 'CPU 0' : (exitedSlotIdx === 1 ? 'CPU 1' : 'CPU 2'),
        isAI: true
      };

      this._restoreSlotToAI(exitedSlotIdx);

      if (isExitedSlotHost) {
        console.warn(`[NetworkManager] Host (Slot 0) exited room. Promoting to Host...`);
        this.promoteToHost();
      } else if (this.isHost) {
        this._sendCustomMessage({
          event: 'ROOM_MEMBERS_SYNC',
          slots: this.slots,
          seed: this.currentSeed,
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

    await safeExitCurrentRoom();
    this.currentRoomId = null;
    this.isHost = false;
    this.isMultiplayerActive = false;
    this.mySlot = 0;
    this.isSlotConfirmed = false;
    this._seedApplied = false;
    this._hasReceivedFirstHostPacket = false;

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

let lastCreateActionTime = 0;

export function hookLobbyNetworkEvents() {
  const btnCreatePublic = document.getElementById('btn-create-public');
  if (btnCreatePublic && !btnCreatePublic._hasNetHook) {
    btnCreatePublic._hasNetHook = true;

    const onCreateHandler = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const now = Date.now();
      if (now - lastCreateActionTime < 1000) {
        return;
      }
      lastCreateActionTime = now;
      NetworkManager.createRoom(false);
    };

    btnCreatePublic.addEventListener('touchend', onCreateHandler, { passive: false });
    btnCreatePublic.addEventListener('click', onCreateHandler);
  }

  const btnCreatePrivate = document.getElementById('btn-create-private');
  if (btnCreatePrivate && !btnCreatePrivate._hasNetHook) {
    btnCreatePrivate._hasNetHook = true;

    const onCreatePrivateHandler = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const now = Date.now();
      if (now - lastCreateActionTime < 1000) {
        return;
      }
      lastCreateActionTime = now;
      NetworkManager.createRoom(true);
    };

    btnCreatePrivate.addEventListener('touchend', onCreatePrivateHandler, { passive: false });
    btnCreatePrivate.addEventListener('click', onCreatePrivateHandler);
  }

  const btnRefresh = document.getElementById('btn-refresh-rooms');
  if (btnRefresh && !btnRefresh._hasNetHook) {
    btnRefresh._hasNetHook = true;

    let lastRefreshActionTime = 0;
    const onRefreshHandler = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const now = Date.now();
      if (now - lastRefreshActionTime < 1000) {
        return;
      }
      lastRefreshActionTime = now;

      btnRefresh.textContent = '更新中...';
      const rooms = await NetworkManager.getPublicRooms();
      btnRefresh.textContent = '更新';

      const container = document.getElementById('room-list-container');
      if (!container || !rooms) return;

      if (rooms.length === 0) {
        container.innerHTML = '<div style="font-size: 14px; color: #bae6fd; padding: 20px 0; text-align: center;">公開ルームはありません</div>';
        return;
      }

      container.innerHTML = '';
      rooms.forEach((r) => {
        const item = document.createElement('div');
        item.className = 'gravity-room-item';
        const strRoomId = String(r.room_id);
        item.innerHTML = `
          <div style="min-width: 0; flex: 1; margin-right: 10px; display: flex; flex-direction: column; gap: 2px;">
            <span style="font-weight: 800; color: #ffffff; font-size: 13px; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">ROOM #${strRoomId}</span>
            <span style="font-size: 12px; color: #bae6fd;">走者: ${r.gamer_num || 1} / ${r.max_players || 3}名</span>
          </div>
          <button type="button" class="gravity-btn-green" style="flex-shrink: 0; width: auto; padding: 6px 14px; font-size: 13px; border-radius: 8px;">参加</button>
        `;
        const joinBtn = item.querySelector('button');

        let lastJoinTime = 0;
        const onJoinHandler = (ev) => {
          if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
          }
          const jNow = Date.now();
          if (jNow - lastJoinTime < 1000) {
            return;
          }
          lastJoinTime = jNow;

          if (typeof window !== 'undefined' && window.launchGameEngine) {
            window.launchGameEngine();
          }

          NetworkManager.joinRoom(strRoomId);
        };

        joinBtn.addEventListener('touchend', onJoinHandler, { passive: false });
        joinBtn.addEventListener('click', onJoinHandler);
        container.appendChild(item);
      });
    };

    btnRefresh.addEventListener('touchend', onRefreshHandler, { passive: false });
    btnRefresh.addEventListener('click', onRefreshHandler);
  }
}

if (typeof window !== 'undefined') {
  window.hookLobbyNetworkEvents = hookLobbyNetworkEvents;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hookLobbyNetworkEvents);
} else {
  hookLobbyNetworkEvents();
}