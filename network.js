// network.js: AgentSDKラッパー ＆ 動的スロット・相互可視化・10Hz位置同期エンジン
// ★ Phase 1 実装版：
//   1. joinRoom 時のハードコード「ホスト」文字を完全撤廃（本人の正規ユーザー名を適用）
//   2. 左下リスタート時の window.currentSceneRef 保証（ステージ消失バグ完全遮断）
//   3. safeShowGameScreen の画面消去強化（ロビー幕の強制 display: none !important 化）

import { characters, createNameplateMesh, updatePlayerName, bindLocalPlayerSlot, refreshCharacterStackVisuals } from './character.js';
import { STAGES, buildWorld, manageBlockSpawns, bridges } from './world.js';
import { resetParticlePools, floorBlockPool } from './particles.js';

/**
 * 未入室時の exit() による無限待機（Pendingフリーズ）を確実に防ぐ安全退出ヘルパー
 */
async function safeExitCurrentRoom() {
  if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room) return;
  try {
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 200));
    await Promise.race([window.AgentSDK.room.exit(), timeoutPromise]);
  } catch (e) {
    console.warn('[network.js] safeExitCurrentRoom caught:', e);
  }
}

/**
 * 画面切り替えの例外安全ヘルパー（ロビー幕・オーバーレイを確実に消し去る）
 * ★【Phase 1 強化】静的・動的問わず全てのロビー要素を物理的に非表示化
 */
function safeShowGameScreen() {
  try {
    if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.showGame === 'function') {
      window.UIController.showGame();
    }
  } catch (e) {
    console.warn('[network.js] UIController.showGame deferred:', e);
  }

  // 1. 静的ロビー（gravity_loader.html 直書き）
  const staticLobby = document.getElementById('test-lobby-overlay');
  if (staticLobby) {
    staticLobby.style.setProperty('display', 'none', 'important');
    staticLobby.classList.add('hidden');
  }

  // 2. 動的ロビー（dom.js 生成）
  const dynamicLobby = document.getElementById('screen-lobby');
  if (dynamicLobby) {
    dynamicLobby.style.setProperty('display', 'none', 'important');
    dynamicLobby.classList.add('hidden');
  }

  // 3. 全ての .gravity-screen-overlay 要素を強制非表示
  const allOverlays = document.querySelectorAll('.gravity-screen-overlay');
  allOverlays.forEach(overlay => {
    overlay.style.setProperty('display', 'none', 'important');
    overlay.classList.add('hidden');
  });

  const waitingScreen = document.getElementById('screen-waiting');
  if (waitingScreen) {
    waitingScreen.style.setProperty('display', 'none', 'important');
    waitingScreen.classList.add('hidden');
  }

  const startModal = document.getElementById('modal-start');
  if (startModal) {
    startModal.style.setProperty('display', 'none', 'important');
    startModal.classList.add('hidden');
  }

  const startBtn = document.getElementById('btn-start');
  if (startBtn) {
    startBtn.click();
  }
}

/**
 * ホスト端末の世界状態（現在の床ブロック・設置済み階段段板）を収集
 */
function captureWorldSnapshot() {
  const blocks = [];
  if (Array.isArray(floorBlockPool)) {
    floorBlockPool.forEach((b, idx) => {
      if (b && b.active && !b.attracting && b.pos) {
        blocks.push({
          poolIdx: idx,
          stageIdx: b.stageIdx || 0,
          x: Number(b.pos.x.toFixed(2)),
          y: Number(b.pos.y.toFixed(2)),
          z: Number(b.pos.z.toFixed(2)),
          teamId: (b.team && b.team.id) ? b.team.id : 'neutral'
        });
      }
    });
  }

  const planks = [];
  if (Array.isArray(bridges)) {
    bridges.forEach(b => {
      if (b && Array.isArray(b.planks) && !b.isSlide && !b.isJump) {
        b.planks.forEach((p, pIdx) => {
          if (p && p.teamId) {
            planks.push({
              stageIdx: b.stageIdx,
              laneIdx: b.laneIdx,
              plankIdx: pIdx,
              teamId: p.teamId
            });
          }
        });
      }
    });
  }

  return { blocks, planks };
}

/**
 * 端末固有のセッションIDを生成（同一アカウントテストでも互いを100%別人として識別）
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
  currentSeed: 12345678,
  _seedApplied: false,

  _hasRegisteredListener: false,
  _lastRefreshTime: 0,
  _syncIntervalId: null,

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

    this.ensureMessageListener();
    return this.myUser;
  },

  ensureMessageListener() {
    if (!this.isSDKAvailable || this._hasRegisteredListener) return;
    this._hasRegisteredListener = true;

    try {
      window.AgentSDK.room.receiveMessage((payload) => {
        if (!payload) return;
        const { type, data } = payload;
        switch (type) {
          case 'aitools_game_joinroom':
            this._handleUserJoined(data);
            break;
          case 'aitools_game_exitroom':
            this._handleUserExited(data);
            break;
          case 'aitools_game_sendmsg':
            this._handleCustomMessage(data);
            break;
        }
      });
    } catch (err) {
      console.warn('[NetworkManager] receiveMessage setup failed:', err);
    }
  },

  async getPublicRooms() {
    if (!this.isSDKAvailable) return [];
    const now = Date.now();
    if (now - this._lastRefreshTime < 2000) {
      return null;
    }
    this._lastRefreshTime = now;

    try {
      const res = await window.AgentSDK.room.getPublicRoomList();
      if (res && res.errno === 0 && res.data && Array.isArray(res.data.list)) {
        return res.data.list.filter(r => {
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

  /**
   * 公開ルーム作成（ホスト）
   */
  async createRoom(isPrivate = false) {
    await this.init();
    await safeExitCurrentRoom();

    let createdRoomId = 'local_room_' + Math.floor(Math.random() * 1000);

    if (this.isSDKAvailable) {
      try {
        const permission = isPrivate ? 1 : 0;
        const res = await window.AgentSDK.room.create({ max_players: 3, room_permission: permission });
        console.log('[NetworkManager] room.create response:', res);

        if (!res || res.errno !== 0) {
          const errMsg = (res && res.errmsg) ? res.errmsg : '不明なエラー';
          console.error(`[NetworkManager] Failed to create room: ${errMsg}`);
          return null;
        }

        if (res.data && res.data.room_id) {
          createdRoomId = String(res.data.room_id);
        }
      } catch (err) {
        console.error('[NetworkManager] Create room exception:', err);
        return null;
      }
    }

    this.currentRoomId = createdRoomId;
    this.isHost = true;
    this.mySlot = 0; // ホストは青(スロット0)
    this.isMultiplayerActive = true;
    this._seedApplied = true;

    // ホスト自身で乱数シードを決定
    this.currentSeed = (typeof createdRoomId === 'string')
      ? Math.abs(createdRoomId.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0))
      : Math.floor(Math.random() * 90000000) + 10000000;

    // ★【Phase 1 強化】window.currentSceneRef が確実に存在することを検証してワールド再構築
    const activeScene = (typeof window !== 'undefined' && window.currentSceneRef) ? window.currentSceneRef : null;
    if (activeScene) {
      resetParticlePools();
      buildWorld(activeScene, this.currentSeed);
      for (let i = 0; i < 60; i++) manageBlockSpawns(activeScene, false);
    }

    // ホストのスロット0を固定
    this.slots[0] = { slot: 0, clientId: this.clientId, userId: this.myUser.user_id, name: this.myUser.name, isAI: false };
    this.slots[1] = { slot: 1, clientId: null, userId: null, name: 'CPU 1', isAI: true };
    this.slots[2] = { slot: 2, clientId: null, userId: null, name: 'CPU 2', isAI: true };

    // ゲーム本編へ遷移
    safeShowGameScreen();

    // 自操作キャラをスロット0（青）へバインド
    if (typeof bindLocalPlayerSlot === 'function') {
      bindLocalPlayerSlot(0);
    } else if (typeof window.bindLocalPlayerSlot === 'function') {
      window.bindLocalPlayerSlot(0);
    }

    if (window.GRAVITY_USER_NAME) {
      updatePlayerName(window.GRAVITY_USER_NAME);
    }

    this._startPositionBroadcasting();
    return this.currentRoomId;
  },

  /**
   * ルーム参加（ゲスト）
   * ★【Phase 1 修正】ハードコード「ホスト」文字を完全撤廃し、自身の名前を即時維持
   */
  async joinRoom(roomId) {
    if (!roomId) return false;
    const safeRoomId = String(roomId);

    await this.init();
    await safeExitCurrentRoom();

    if (this.isSDKAvailable) {
      try {
        const res = await window.AgentSDK.room.join({ room_id: safeRoomId });
        console.log('[NetworkManager] join room response:', res);

        if (!res || res.errno !== 0) {
          const errMsg = (res && res.errmsg) ? res.errmsg : '入室できませんでした';
          console.error(`[NetworkManager] Failed to join room: ${errMsg}`);
          return false;
        }
      } catch (err) {
        console.error('[NetworkManager] Join room exception:', err);
        return false;
      }
    }

    this.currentRoomId = safeRoomId;
    this.isHost = false;
    this.mySlot = 1; // 初期フォールバックはスロット1(赤)
    this.isMultiplayerActive = true;
    this._seedApplied = false;

    // ★【Phase 1 修正】スロット0に「ホスト」という固定文字を代入するのを完全撤廃！
    // 相手キャラ（スロット0）はリモート走者として初期化し、自キャラ（スロット1）には本人の正規ユーザー名を即時適用
    const myRealName = (typeof window !== 'undefined' && window.GRAVITY_USER_NAME)
      ? String(window.GRAVITY_USER_NAME)
      : this.myUser.name;

    // スロット0（相手）を静止リモート化（名前は同期完了時にホストの本名へ自動置換）
    this._bindRemoteSlot(0, 'Player');

    // スロット1（自分）を即座に自操作バインドし、本名ネームプレートを直ちに適用
    if (typeof bindLocalPlayerSlot === 'function') {
      bindLocalPlayerSlot(1);
    } else if (typeof window.bindLocalPlayerSlot === 'function') {
      window.bindLocalPlayerSlot(1);
    }
    updatePlayerName(myRealName);

    safeShowGameScreen();

    this._sendCustomMessage({
      event: 'REQUEST_ROOM_SYNC',
      clientId: this.clientId,
      userId: this.myUser.user_id,
      name: myRealName
    });

    this._startPositionBroadcasting();
    return true;
  },

  _handleUserJoined(data) {
    if (!data) return;
    const userId = String(data.user_id || '');
    if (!userId || userId === String(this.myUser.user_id)) return;

    if (this.isHost) {
      this._sendCustomMessage({
        event: 'ROOM_MEMBERS_SYNC',
        slots: this.slots,
        seed: this.currentSeed,
        snapshot: captureWorldSnapshot()
      });
    }
  },

  _handleCustomMessage(data) {
    if (!data) return;
    try {
      const rawStr = (typeof data.msg_data === 'string')
        ? data.msg_data
        : (typeof data === 'string' ? data : (data.message || ''));

      if (!rawStr) return;
      const packet = JSON.parse(rawStr);
      if (!packet || !packet.event) return;

      switch (packet.event) {
        case 'ROOM_MEMBERS_SYNC':
          this._applyRoomMembersSync(packet.slots, packet.seed, packet.snapshot);
          break;

        case 'REQUEST_ROOM_SYNC':
          if (this.isHost) {
            const reqClientId = packet.clientId;
            const reqUserId = String(packet.userId || '');
            const reqName = packet.name || 'ゲスト';

            if (reqClientId && reqClientId !== this.clientId) {
              let targetSlot = this.slots.findIndex(s => s.clientId === reqClientId);

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
                  userId: reqUserId,
                  name: reqName,
                  isAI: false
                };
                this._bindRemoteSlot(targetSlot, reqName);
              }
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
          this._handleRemotePosition(packet);
          break;

        case 'BUILD_PLANK':
          if (typeof window.applyRemotePlankBuilt === 'function') {
            window.applyRemotePlankBuilt(packet.stageIdx, packet.laneIdx, packet.plankIdx, packet.teamId);
          }
          break;

        case 'PICK_BLOCK':
          if (typeof window.applyRemoteBlockPicked === 'function') {
            window.applyRemoteBlockPicked(packet.stageIdx, packet.poolIdx, packet.x, packet.z);
          }
          break;

        case 'SPAWN_BLOCK':
          if (typeof window.applyRemoteBlockSpawned === 'function') {
            window.applyRemoteBlockSpawned(packet.stageIdx, packet.poolIdx, packet.x, packet.y, packet.z, packet.teamId);
          }
          break;

        case 'RESTART_GAME':
          if (typeof window.onRemoteRestartReceived === 'function') {
            window.onRemoteRestartReceived(packet);
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
          snapshot.blocks.forEach(b => {
            if (typeof window.applyRemoteBlockSpawned === 'function') {
              window.applyRemoteBlockSpawned(b.stageIdx, b.poolIdx, b.x, b.y, b.z, b.teamId);
            }
          });
        } else {
          for (let i = 0; i < 60; i++) manageBlockSpawns(activeScene, false);
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
      const isMyClient = (s.clientId && s.clientId === this.clientId) || (!s.clientId && this.isHost && s.slot === 0);

      if (isMyClient) {
        this.mySlot = s.slot;
        window.MY_PLAYER_SLOT = s.slot;
        if (typeof bindLocalPlayerSlot === 'function') {
          bindLocalPlayerSlot(s.slot);
        } else if (typeof window.bindLocalPlayerSlot === 'function') {
          window.bindLocalPlayerSlot(s.slot);
        }
        if (window.GRAVITY_USER_NAME) {
          updatePlayerName(window.GRAVITY_USER_NAME);
        }
      } else if (!s.isAI && (s.clientId || s.userId)) {
        this._bindRemoteSlot(s.slot, s.name);
      } else if (s.isAI) {
        this._restoreSlotToAI(s.slot);
      }
    });
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
    targetChar.name = playerName;

    targetChar.walkCycle = 0;
    if (targetChar.meshObj) {
      if (targetChar.meshObj.leftLeg) targetChar.meshObj.leftLeg.rotation.x = 0;
      if (targetChar.meshObj.rightLeg) targetChar.meshObj.rightLeg.rotation.x = 0;
      if (targetChar.meshObj.leftArm) targetChar.meshObj.leftArm.rotation.x = 0;
      if (targetChar.meshObj.rightArm) targetChar.meshObj.rightArm.rotation.x = 0;
    }

    refreshCharacterStackVisuals(targetChar);

    if (targetChar.nameplateSprite) {
      if (targetChar.nameplateSprite.material && targetChar.nameplateSprite.material.map) {
        targetChar.nameplateSprite.material.map.dispose();
      }
      const newMesh = createNameplateMesh(playerName, false);
      targetChar.nameplateSprite.material = newMesh.material;
      targetChar.nameplateSprite.visible = true;
    }
  },

  _restoreSlotToAI(slotIndex) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    targetChar.isPlayer = false;
    targetChar.isAI = true;
    targetChar.isRemote = false;
    targetChar.aiState = 'COLLECT';
    targetChar.searchCooldown = 0;
    targetChar.name = (slotIndex === 1) ? 'CPU 1' : 'CPU 2';

    refreshCharacterStackVisuals(targetChar);

    if (targetChar.nameplateSprite) {
      if (targetChar.nameplateSprite.material && targetChar.nameplateSprite.material.map) {
        targetChar.nameplateSprite.material.map.dispose();
      }
      const newMesh = createNameplateMesh(targetChar.name, false);
      targetChar.nameplateSprite.material = newMesh.material;
      targetChar.nameplateSprite.visible = true;
    }
  },

  _startPositionBroadcasting() {
    if (this._syncIntervalId) clearInterval(this._syncIntervalId);

    this._syncIntervalId = setInterval(() => {
      if (!this.isMultiplayerActive || !this.isSDKAvailable) return;

      const myChar = characters[this.mySlot];
      if (!myChar) return;

      this._sendCustomMessage({
        event: 'POS',
        slot: this.mySlot,
        clientId: this.clientId,
        x: Number(myChar.pos.x.toFixed(2)),
        y: Number(myChar.pos.y.toFixed(2)),
        z: Number(myChar.pos.z.toFixed(2)),
        rotY: Number(myChar.meshObj.root.rotation.y.toFixed(2)),
        stack: myChar.stackCount || 0,
        stage: myChar.currentStage || 0
      });
    }, 100);
  },

  _handleRemotePosition(packet) {
    if (packet.slot === this.mySlot || packet.clientId === this.clientId) return;

    const targetChar = characters[packet.slot];
    if (!targetChar) return;

    targetChar.isRemote = true;
    targetChar.isAI = false;

    if (!targetChar.targetNetPos) {
      targetChar.targetNetPos = new THREE.Vector3();
    }
    targetChar.targetNetPos.set(packet.x, packet.y, packet.z);
    targetChar.targetNetRotY = packet.rotY;

    if (targetChar.stackCount !== packet.stack) {
      targetChar.stackCount = packet.stack;
      refreshCharacterStackVisuals(targetChar);
    }
  },

  _sendCustomMessage(msgObj) {
    if (!this.isSDKAvailable) return;
    try {
      window.AgentSDK.room.sendMessage({
        message: JSON.stringify(msgObj)
      });
    } catch (e) {
      console.warn('[NetworkManager] sendMessage failed:', e);
    }
  },

  _handleUserExited(data) {
    if (!data) return;
    const userId = String(data.user_id || '');
    const exitedSlotIdx = this.slots.findIndex(s => String(s.userId) === userId);

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
    await safeExitCurrentRoom();
    this.currentRoomId = null;
    this.isHost = false;
    this.isMultiplayerActive = false;
    this.mySlot = 0;
    this._seedApplied = false;
    if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.showLobby === 'function') {
      window.UIController.showLobby();
    }
  }
};

/**
 * dom.js 内のボタンと NetworkManager を自動接続するフック
 */
export function hookLobbyNetworkEvents() {
  const btnCreatePublic = document.getElementById('btn-create-public');
  if (btnCreatePublic && !btnCreatePublic._hasNetHook) {
    btnCreatePublic._hasNetHook = true;
    const onCreateHandler = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      NetworkManager.createRoom(false);
    };
    btnCreatePublic.addEventListener('click', onCreateHandler);
    btnCreatePublic.addEventListener('touchend', onCreateHandler);
  }

  const btnRefresh = document.getElementById('btn-refresh-rooms');
  if (btnRefresh && !btnRefresh._hasNetHook) {
    btnRefresh._hasNetHook = true;
    const onRefreshHandler = async (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
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
        const onJoinHandler = (ev) => {
          if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
          }
          NetworkManager.joinRoom(strRoomId);
        };
        joinBtn.addEventListener('click', onJoinHandler);
        joinBtn.addEventListener('touchend', onJoinHandler);
        container.appendChild(item);
      });
    };
    btnRefresh.addEventListener('click', onRefreshHandler);
    btnRefresh.addEventListener('touchend', onRefreshHandler);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hookLobbyNetworkEvents);
} else {
  hookLobbyNetworkEvents();
}