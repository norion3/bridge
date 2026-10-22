// network.js: AgentSDK公式仕様完全準拠 ＆ ルーム入退室ライフサイクル・通信同期エンジン
// ★ Phase 2 実装版（突発イベント100ms周期アグリゲーション ＆ 完全10Hz固定）：
//   1. 【突発イベントの100ms集約同封】
//      アイテム/ゲート消費（CONSUME_OBJECT）およびモブ吹き飛ばし（BLOW_MOB）の単発即時送信を
//      100ms周期の定期 POS パケット（consumes / blows）に相乗りさせて一括送信。
//   2. 【全通信の完全10Hz（毎秒10回以下）固定】
//      階段設置、ブロック回収、アイテム消費、モブ衝突などゲーム中すべてのアクションが
//      100msタイマー1通へ集約され、JSBridge のパケット詰まり・キュー溢れを100%防止。
//   3. 【後方互換・受信ハンドラの完全連動】
//      POS パケット受信時に同封された consumes / blows を自動展開し、
//      既存の applyRemoteObjectConsumed / applyRemoteBlowMob を安全に実行。

import {
  player,
  characters,
  createNameplateMesh,
  updatePlayerName,
  bindLocalPlayerSlot,
  refreshCharacterStackVisuals,
  resetCharacterToStageZero
} from './character.js';
import { STAGES, buildWorld, manageBlockSpawns, bridges, floorBlocksByStage } from './world.js';
import { resetParticlePools, floorBlockPool } from './particles.js';

/**
 * ★【公式仕様準拠】未入室時の exit() による無限保留（Promiseハング）を確実に防ぐ安全退出ヘルパー
 */
async function safeExitCurrentRoom() {
  if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room) return;
  try {
    if (typeof window.AgentSDK.room.getRoomId === 'function') {
      const res = await window.AgentSDK.room.getRoomId();
      const activeRoomId = (res && typeof res.room_id === 'string') ? res.room_id : (res && res.data && res.data.room_id ? res.data.room_id : '');
      if (!activeRoomId || activeRoomId === '') {
        return;
      }
    }
    const exitPromise = window.AgentSDK.room.exit();
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 700));
    await Promise.race([exitPromise, timeoutPromise]);
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
 * ホスト端末の世界状態を軽量収集
 */
function captureWorldSnapshot() {
  const blocks = [];
  if (Array.isArray(floorBlockPool)) {
    for (let idx = 0; idx < floorBlockPool.length; idx++) {
      const b = floorBlockPool[idx];
      if (b && b.active && !b.attracting && b.pos && (b.stageIdx === 0 || b.stageIdx === 1)) {
        blocks.push({
          poolIdx: idx,
          stageIdx: b.stageIdx || 0,
          x: Number(b.pos.x.toFixed(2)),
          y: Number(b.pos.y.toFixed(2)),
          z: Number(b.pos.z.toFixed(2)),
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
      if (b && (b.stageIdx === 0 || b.stageIdx === 1) && Array.isArray(b.planks) && !b.isSlide && !b.isJump) {
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

  return { blocks, planks };
}

/**
 * 端末固有のセッションIDを生成
 */
function generateClientId() {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    let saved = window.sessionStorage.getItem('bridge_client_id');
    if (!saved) {
      saved = 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
      window.sessionStorage.setItem('bridge_client_id', saved);
    }
    return saved;
  }
  return 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
}

/**
 * キャラクターの現在の搭乗・アクション状態を取得するヘルパー
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
  _retrySyncIntervalId: null,
  _timeSyncCounter: 0,

  _isCreatingRoom: false,
  _isJoiningRoom: false,

  // 100ms周期パケットへ相乗りさせるためのローカルアクション蓄積バッファ
  _pendingPlanks: [],
  _pendingPicks: [],
  _pendingConsumes: [],
  _pendingBlows: [],

  /**
   * 階段設置アクションを一時バッファに積む
   */
  queuePlankBuild(stageIdx, laneIdx, plankIdx, teamId) {
    if (!this.isMultiplayerActive) return;
    this._pendingPlanks.push({
      s: stageIdx,
      l: laneIdx,
      p: plankIdx,
      t: teamId
    });
  },

  /**
   * ブロック取得アクションを一時バッファに積む
   */
  queueBlockPick(blockId, stageIdx, poolIdx, x, z) {
    if (!this.isMultiplayerActive) return;
    this._pendingPicks.push({
      id: blockId,
      s: stageIdx,
      pi: poolIdx,
      x: Number(x.toFixed(2)),
      z: Number(z.toFixed(2))
    });
  },

  /**
   * ★【Phase 2 新設】アイテム・ゲート消費アクションを一時バッファに積む
   */
  queueConsumeObject(objectId, objectType) {
    if (!this.isMultiplayerActive || !objectId) return;
    this._pendingConsumes.push({
      id: objectId,
      t: objectType
    });
  },

  /**
   * ★【Phase 2 新設】敵モブ吹き飛ばしアクションを一時バッファに積む
   */
  queueBlowMob(mobIndex, stageIdx, pushDirX) {
    if (!this.isMultiplayerActive) return;
    this._pendingBlows.push({
      m: mobIndex,
      s: stageIdx,
      d: Number(pushDirX.toFixed(2))
    });
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

  /**
   * メッセージリスナー登録
   */
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
            if (payload.msg_data || payload.message || payload.event || (payload.data && (payload.data.msg_data || payload.data.message))) {
              this._handleCustomMessage(payload);
            }
            break;
        }
      });
    } catch (err) {
      console.warn('[NetworkManager] receiveMessage setup failed:', err);
    }
  },

  /**
   * 公開ルーム一覧の自前除外フィルタリング
   */
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
      this.ensureMessageListener();

      this.isHost = true;
      this.mySlot = 0;
      this.isSlotConfirmed = true;
      this.isMultiplayerActive = true;
      this._seedApplied = true;

      this._pendingPlanks = [];
      this._pendingPicks = [];
      this._pendingConsumes = [];
      this._pendingBlows = [];

      safeShowGameScreen();

      if (typeof bindLocalPlayerSlot === 'function') {
        bindLocalPlayerSlot(0);
      } else if (typeof window.bindLocalPlayerSlot === 'function') {
        window.bindLocalPlayerSlot(0);
      }

      if (window.GRAVITY_USER_NAME) {
        updatePlayerName(window.GRAVITY_USER_NAME);
      }

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
      this.ensureMessageListener();

      this.isHost = false;
      this.isMultiplayerActive = true;
      this._seedApplied = false;

      this._pendingPlanks = [];
      this._pendingPicks = [];
      this._pendingConsumes = [];
      this._pendingBlows = [];

      this.mySlot = 1;
      this.isSlotConfirmed = true;
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

      let retries = 0;
      if (this._retrySyncIntervalId) {
        clearInterval(this._retrySyncIntervalId);
        this._retrySyncIntervalId = null;
      }

      const sendSyncReq = () => {
        this._sendCustomMessage({
          event: 'REQUEST_ROOM_SYNC',
          clientId: this.clientId,
          userId: this.myUser.user_id,
          name: myRealName,
          suggestedSlot: 1
        });
      };

      sendSyncReq();

      this._retrySyncIntervalId = setInterval(() => {
        retries++;
        sendSyncReq();
        if (retries >= 6) {
          clearInterval(this._retrySyncIntervalId);
          this._retrySyncIntervalId = null;
        }
      }, 300);

      this._startPositionBroadcasting();
      return true;
    } finally {
      setTimeout(() => {
        this._isJoiningRoom = false;
      }, 600);
    }
  },

  _handleUserJoined(data) {
    if (!data) return;
    const userId = String(data.user_id || data.userId || data.uid || '');
    if (!userId || userId === String(this.myUser.user_id)) return;

    if (this.isHost) {
      const guestName = (data.name && data.name !== 'ゲスト') ? data.name : (data.user_name || 'ゲスト');
      let targetSlot = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

      if (targetSlot === -1) {
        if (this.slots[1].isAI) targetSlot = 1;
        else if (this.slots[2].isAI) targetSlot = 2;
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
        snapshot: captureWorldSnapshot()
      });
    }
  },

  /**
   * 受信パーサー
   */
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

      if (!packet && typeof data === 'object' && data.event) {
        packet = data;
      } else if (!packet && data.data && typeof data.data === 'object' && data.data.event) {
        packet = data.data;
      }

      if (!packet || !packet.event) return;

      switch (packet.event) {
        case 'ROOM_MEMBERS_SYNC':
          if (this._retrySyncIntervalId) {
            clearInterval(this._retrySyncIntervalId);
            this._retrySyncIntervalId = null;
          }
          this._applyRoomMembersSync(packet.slots, packet.seed, packet.snapshot);
          break;

        case 'REQUEST_ROOM_SYNC':
          if (this.isHost) {
            const reqClientId = packet.clientId;
            const reqUserId = String(packet.userId || '');
            const reqName = (packet.name && packet.name !== 'ゲスト' && packet.name !== 'YOU') ? packet.name : 'ゲスト1';

            let targetSlot = -1;
            if (reqClientId) {
              targetSlot = this.slots.findIndex(s => s.clientId === reqClientId);
            }

            if (targetSlot === -1 && reqUserId && reqUserId !== 'local_user') {
              targetSlot = this.slots.findIndex(s => s.userId && String(s.userId) === reqUserId);
            }

            if (targetSlot === -1) {
              if (this.slots[1].isAI) {
                targetSlot = 1;
              } else if (this.slots[2].isAI) {
                targetSlot = 2;
              }
            }

            if (targetSlot !== -1) {
              this.slots[targetSlot] = {
                slot: targetSlot,
                clientId: reqClientId,
                userId: reqUserId || this.slots[targetSlot].userId,
                name: reqName,
                isAI: false
              };
              this._bindRemoteSlot(targetSlot, reqName);
            }

            this._sendCustomMessage({
              event: 'ROOM_MEMBERS_SYNC',
              slots: this.slots,
              seed: this.currentSeed,
              snapshot: captureWorldSnapshot()
            });
          }
          break;

        case 'POS':
          if (Array.isArray(packet.planks) && packet.planks.length > 0) {
            packet.planks.forEach(p => {
              if (typeof window.applyRemotePlankBuilt === 'function') {
                window.applyRemotePlankBuilt(p.s, p.l, p.p, p.t);
              }
            });
          }

          if (Array.isArray(packet.picks) && packet.picks.length > 0) {
            packet.picks.forEach(pk => {
              if (typeof window.applyRemoteBlockPicked === 'function') {
                window.applyRemoteBlockPicked(pk.s, pk.pi, pk.x, pk.z, pk.id);
              }
            });
          }

          // ★【Phase 2 新設】同封されたアイテム/ゲート消費の一括展開
          if (Array.isArray(packet.consumes) && packet.consumes.length > 0) {
            packet.consumes.forEach(c => {
              if (c.t === 'bonus' && typeof window.applyRemoteBonusConsumed === 'function') {
                window.applyRemoteBonusConsumed(c.id);
              } else if (typeof window.applyRemoteObjectConsumed === 'function') {
                window.applyRemoteObjectConsumed(c.id, c.t);
              }
            });
          }

          // ★【Phase 2 新設】同封された敵モブ吹き飛ばしの一括展開
          if (Array.isArray(packet.blows) && packet.blows.length > 0) {
            packet.blows.forEach(bl => {
              if (typeof window.applyRemoteBlowMob === 'function') {
                window.applyRemoteBlowMob(bl.m, bl.s, bl.d);
              }
            });
          }

          if (Array.isArray(packet.list)) {
            packet.list.forEach(p => this._handleRemotePosition(p));
          } else {
            this._handleRemotePosition(packet);
          }
          break;

        case 'BUILD_PLANK':
          if (typeof window.applyRemotePlankBuilt === 'function') {
            window.applyRemotePlankBuilt(packet.stageIdx, packet.laneIdx, packet.plankIdx, packet.teamId);
          }
          break;

        case 'PICK_BLOCK':
          if (typeof window.applyRemoteBlockPicked === 'function') {
            window.applyRemoteBlockPicked(packet.stageIdx, packet.poolIdx, packet.x, packet.z, packet.blockId);
          }
          break;

        case 'SPAWN_BLOCKS_BATCH':
          if (Array.isArray(packet.blocks) && typeof window.applyRemoteBlocksBatch === 'function') {
            window.applyRemoteBlocksBatch(packet.stageIdx, packet.blocks);
          } else if (Array.isArray(packet.blocks) && typeof window.applyRemoteBlockSpawned === 'function') {
            packet.blocks.forEach(b => {
              window.applyRemoteBlockSpawned(
                b.stageIdx !== undefined ? b.stageIdx : packet.stageIdx,
                b.poolIdx,
                b.x,
                b.y,
                b.z,
                b.teamId,
                b.blockId
              );
            });
          }
          break;

        case 'SPAWN_BLOCK':
          if (typeof window.applyRemoteBlockSpawned === 'function') {
            window.applyRemoteBlockSpawned(packet.stageIdx, packet.poolIdx, packet.x, packet.y, packet.z, packet.teamId, packet.blockId);
          }
          break;

        case 'SCATTER_BLOCKS':
          if (typeof window.applyRemoteScatterBlocks === 'function') {
            window.applyRemoteScatterBlocks(packet.stageIdx, packet.blocks);
          }
          break;

        case 'KNOCKOUT':
          if (typeof window.applyRemoteKnockout === 'function') {
            window.applyRemoteKnockout(packet.loserSlot, packet.pushX, packet.pushZ, packet.targetX, packet.targetZ);
          }
          break;

        case 'RESTART_GAME':
          if (typeof window.onRemoteRestartReceived === 'function') {
            window.onRemoteRestartReceived(packet);
          }
          break;

        case 'CONSUME_OBJECT':
          if (packet.objectType === 'bonus') {
            if (typeof window.applyRemoteBonusConsumed === 'function') {
              window.applyRemoteBonusConsumed(packet.objectId);
            }
          } else {
            if (typeof window.applyRemoteObjectConsumed === 'function') {
              window.applyRemoteObjectConsumed(packet.objectId, packet.objectType);
            }
          }
          break;

        case 'FIRE_SKILL':
          if (typeof window.applyRemoteFireSkill === 'function') {
            window.applyRemoteFireSkill(packet.skillType, packet.shooterSlot, packet.targetSlot);
          }
          break;

        case 'TIME_SYNC':
          if (!this.isHost && typeof window.applyRemoteTimeSync === 'function') {
            window.applyRemoteTimeSync(packet.timeLeft);
          }
          break;

        case 'TIME_UP':
          if (typeof window.applyRemoteTimeUp === 'function') {
            window.applyRemoteTimeUp();
          }
          break;

        case 'BLOW_MOB':
          if (typeof window.applyRemoteBlowMob === 'function') {
            window.applyRemoteBlowMob(packet.mobIndex, packet.stageIdx, packet.pushDirX);
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
      }
    } else if (!this.isHost && snapshot && Array.isArray(snapshot.planks)) {
      snapshot.planks.forEach(p => {
        if (typeof window.applyRemotePlankBuilt === 'function') {
          window.applyRemotePlankBuilt(p.stageIdx, p.laneIdx, p.plankIdx, p.teamId);
        }
      });
    }

    syncedSlots.forEach((s) => {
      let isMyClient = false;

      if (this.isHost) {
        isMyClient = (s.slot === 0);
      } else {
        if (s.slot !== 0) {
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
      }

      if (isMyClient) {
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
        return;
      }

      if (!s.isAI && (s.clientId || s.userId || (!this.isHost && s.slot === 0))) {
        this._bindRemoteSlot(s.slot, s.name);
      } else if (s.isAI) {
        this._restoreSlotToAI(s.slot);
      }
    });
  },

  _bindRemoteSlot(slotIndex, playerName) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    const wasAlreadyRemote = targetChar.isRemote && !targetChar.isAI;

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

    if (!wasAlreadyRemote) {
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
        if (!targetChar.targetNetPos) targetChar.targetNetPos = new THREE.Vector3();
        targetChar.targetNetPos.copy(targetChar.pos);
      }
    }
  },

  _restoreSlotToAI(slotIndex) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    targetChar.isPlayer = false;
    targetChar.isAI = true;
    targetChar.isRemote = false;
    targetChar.aiState = 'COLLECT';
    targetChar.name = (slotIndex === 1) ? 'CPU 1' : 'CPU 2';

    targetChar.netVelocity = { x: 0, z: 0 };
    targetChar.remoteActionState = 'NORMAL';
    if (targetChar.targetNetPos) {
      targetChar.targetNetPos.copy(targetChar.pos);
    }

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

  /**
   * 10Hz 位置情報ブロードキャスト ＆ アクションアグリゲーション
   */
  _startPositionBroadcasting() {
    if (this._syncIntervalId) clearInterval(this._syncIntervalId);

    let lastMyPos = null;
    let lastTime = performance.now();

    this._syncIntervalId = setInterval(() => {
      if (!this.isMultiplayerActive || !this.isSDKAvailable) return;

      const myChar = characters[this.mySlot];
      if (!myChar) return;

      const now = performance.now();
      const dtSec = Math.max(0.001, (now - lastTime) / 1000);
      lastTime = now;

      let vx = 0, vz = 0;
      if (lastMyPos) {
        vx = Number(((myChar.pos.x - lastMyPos.x) / dtSec).toFixed(2));
        vz = Number(((myChar.pos.z - lastMyPos.z) / dtSec).toFixed(2));
      } else {
        lastMyPos = new THREE.Vector3();
      }
      lastMyPos.copy(myChar.pos);

      const myName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
        ? String(window.GRAVITY_USER_NAME)
        : (this.myUser ? this.myUser.name : 'YOU');

      const posList = [];

      posList.push({
        slot: this.mySlot,
        clientId: this.clientId,
        name: myName,
        x: Number(myChar.pos.x.toFixed(2)),
        y: Number(myChar.pos.y.toFixed(2)),
        z: Number(myChar.pos.z.toFixed(2)),
        vx: vx,
        vz: vz,
        rotY: Number(myChar.meshObj.root.rotation.y.toFixed(2)),
        stack: myChar.stackCount || 0,
        stage: myChar.currentStage || 0,
        state: getCharacterActionState(myChar),
        boost: Boolean(myChar.speedBoostActive),
        stun: Boolean(myChar.stunTimer > 0),
        shrink: Boolean(myChar.shrinkTimer > 0),
        magnet: Boolean(myChar.magnetActive),
        invuln: Boolean(myChar.invulnerableTimer > 0)
      });

      if (this.isHost) {
        this.slots.forEach(s => {
          if (s.slot === this.mySlot) return;

          const charObj = characters[s.slot];
          if (!charObj) return;

          const isHumanPlayer = charObj.isRemote || Boolean(charObj.targetNetPos) || !s.isAI;
          if (s.isAI && !isHumanPlayer) {
            posList.push({
              slot: s.slot,
              clientId: this.clientId,
              name: s.name || (s.slot === 1 ? 'CPU 1' : 'CPU 2'),
              x: Number(charObj.pos.x.toFixed(2)),
              y: Number(charObj.pos.y.toFixed(2)),
              z: Number(charObj.pos.z.toFixed(2)),
              vx: 0,
              vz: 0,
              rotY: Number(charObj.meshObj.root.rotation.y.toFixed(2)),
              stack: charObj.stackCount || 0,
              stage: charObj.currentStage || 0,
              state: getCharacterActionState(charObj),
              boost: Boolean(charObj.speedBoostActive),
              stun: Boolean(charObj.stunTimer > 0),
              shrink: Boolean(charObj.shrinkTimer > 0),
              magnet: Boolean(charObj.magnetActive),
              invuln: Boolean(charObj.invulnerableTimer > 0)
            });
          }
        });

        // 1秒周期の TIME_SYNC パケット送信
        this._timeSyncCounter = (this._timeSyncCounter || 0) + 1;
        if (this._timeSyncCounter >= 10) {
          this._timeSyncCounter = 0;
          if (typeof window !== 'undefined' && typeof window.getGameTimeLeft === 'function') {
            const currentSec = window.getGameTimeLeft();
            if (typeof currentSec === 'number' && !isNaN(currentSec)) {
              this._sendCustomMessage({
                event: 'TIME_SYNC',
                timeLeft: Number(currentSec.toFixed(1))
              });
            }
          }
        }
      }

      // バッファに溜まっている階段設置およびブロック取得情報をアグリゲーションして同封
      const outgoingPlanks = this._pendingPlanks.length > 0 ? [...this._pendingPlanks] : undefined;
      const outgoingPicks = this._pendingPicks.length > 0 ? [...this._pendingPicks] : undefined;
      // ★【Phase 2 新設】アイテム消費・モブ吹き飛ばしも 100ms周期パケットへ同封
      const outgoingConsumes = this._pendingConsumes.length > 0 ? [...this._pendingConsumes] : undefined;
      const outgoingBlows = this._pendingBlows.length > 0 ? [...this._pendingBlows] : undefined;

      this._pendingPlanks.length = 0;
      this._pendingPicks.length = 0;
      this._pendingConsumes.length = 0;
      this._pendingBlows.length = 0;

      const posMessage = {
        event: 'POS',
        clientId: this.clientId,
        list: posList
      };

      if (outgoingPlanks) posMessage.planks = outgoingPlanks;
      if (outgoingPicks) posMessage.picks = outgoingPicks;
      if (outgoingConsumes) posMessage.consumes = outgoingConsumes;
      if (outgoingBlows) posMessage.blows = outgoingBlows;

      this._sendCustomMessage(posMessage);
    }, 100);
  },

  /**
   * リモート座標の反映
   */
  _handleRemotePosition(packet) {
    if (this.isHost && packet.slot === 0) return;
    if (!this.isHost && packet.slot === this.mySlot) return;

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

    const isGenericGuestName = (targetChar.name === 'ゲスト' || targetChar.name === 'ゲスト1' || targetChar.name === 'ゲスト2');
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

  /**
   * 純粋送信
   */
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

  broadcastSpawnBlocksBatch(stageIdx, blocksArray) {
    if (!this.isMultiplayerActive || !Array.isArray(blocksArray) || blocksArray.length === 0) return;
    this._sendCustomMessage({
      event: 'SPAWN_BLOCKS_BATCH',
      stageIdx: stageIdx,
      blocks: blocksArray
    });
  },

  broadcastSpawnBlock(stageIdx, poolIdx, x, y, z, teamId, blockId) {
    if (!this.isMultiplayerActive) return;
    this._sendCustomMessage({
      event: 'SPAWN_BLOCK',
      stageIdx: stageIdx,
      poolIdx: poolIdx,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      z: Number(z.toFixed(2)),
      teamId: teamId,
      blockId: blockId
    });
  },

  broadcastPickBlock(blockId, stageIdx, poolIdx, x, z) {
    if (!this.isMultiplayerActive) return;
    // 互換性維持：即時送信ではなく 100ms周期キューへ積む
    this.queueBlockPick(blockId, stageIdx, poolIdx, x, z);
  },

  broadcastConsumeObject(objectId, objectType) {
    if (!this.isMultiplayerActive) return;
    // ★【Phase 2 核心】即時 sendMessage 連打を停止し、100ms周期キューへ蓄積
    this.queueConsumeObject(objectId, objectType);
  },

  broadcastBlowMob(mobIndex, stageIdx, pushDirX) {
    if (!this.isMultiplayerActive) return;
    // ★【Phase 2 核心】即時 sendMessage 連打を停止し、100ms周期キューへ蓄積
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
    const userId = String(data.user_id || '');
    const exitedSlotIdx = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

    if (exitedSlotIdx !== -1 && exitedSlotIdx !== 0) {
      this.slots[exitedSlotIdx] = {
        slot: exitedSlotIdx,
        clientId: null,
        userId: null,
        name: (exitedSlotIdx === 1) ? 'CPU 1' : 'CPU 2',
        isAI: true
      };

      this._restoreSlotToAI(exitedSlotIdx);

      if (this.isHost) {
        this._sendCustomMessage({
          event: 'ROOM_MEMBERS_SYNC',
          slots: this.slots,
          seed: this.currentSeed,
          snapshot: captureWorldSnapshot()
        });
      }
    }
  },

  async exitRoom() {
    if (this._syncIntervalId) {
      clearInterval(this._syncIntervalId);
      this._syncIntervalId = null;
    }
    if (this._retrySyncIntervalId) {
      clearInterval(this._retrySyncIntervalId);
      this._retrySyncIntervalId = null;
    }
    await safeExitCurrentRoom();
    this.currentRoomId = null;
    this.isHost = false;
    this.isMultiplayerActive = false;
    this.mySlot = 0;
    this.isSlotConfirmed = false;
    this._seedApplied = false;

    this._hasRegisteredListener = false;

    if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.showLobby === 'function') {
      window.UIController.showLobby();
    }
  }
};

if (typeof window !== 'undefined') {
  window.NetworkManager = NetworkManager;
}

/**
 * dom.js 内のボタンと NetworkManager を安全に接続するフック
 */
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
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-weight: 800; color: #ffffff; font-size: 14px;">ROOM #${strRoomId}</span>
            <span style="font-size: 12px; color: #bae6fd;">走者: ${r.gamer_num || 1} / 3名</span>
          </div>
          <button type="button" class="gravity-btn-green" style="width: auto; padding: 6px 14px; font-size: 13px; border-radius: 8px;">参加</button>
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