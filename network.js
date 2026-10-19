// network.js: AgentSDKラッパー ＆ 動的スロット・相互可視化・10Hz位置同期エンジン
// ★ Phase 1 実装版：勝手な移動根絶（自律AI乗っ取り遮断）＆ キャラあべこべ根絶（clientId動的任命）＆ 入室不能根絶（事前クリーンアップ）
// ★ ワールドスナップショット・階段架け(BUILD_PLANK)＆床ブロック取得(PICK_BLOCK)＆新ブロック補充(SPAWN_BLOCK)完全準拠

import { characters, createNameplateMesh, updatePlayerName, bindLocalPlayerSlot, refreshCharacterStackVisuals } from './character.js';
import { STAGES, buildWorld, manageBlockSpawns, bridges } from './world.js';
import { resetParticlePools, floorBlockPool } from './particles.js';

/**
 * 画面切り替えの例外安全ヘルパー（ロビー幕を確実に消し去る）
 */
function safeShowGameScreen() {
  try {
    if (typeof window !== 'undefined' && window.UIController && typeof window.UIController.showGame === 'function') {
      window.UIController.showGame();
    }
  } catch (e) {
    console.warn('[network.js] UIController.showGame deferred:', e);
  }

  const staticLobby = document.getElementById('test-lobby-overlay');
  if (staticLobby) staticLobby.style.setProperty('display', 'none', 'important');

  const dynamicLobby = document.getElementById('screen-lobby');
  if (dynamicLobby) dynamicLobby.classList.add('hidden');

  const waitingScreen = document.getElementById('screen-waiting');
  if (waitingScreen) waitingScreen.classList.add('hidden');

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
  clientId: generateClientId(), // ★ 端末固有セッショントークン
  myUser: { name: 'YOU', user_id: 'local_user', portrait: '' },
  
  // スロット配列（0:青, 1:赤, 2:黄）
  // 厳格ルール: ホストが権威サーバーとして空きスロットへ動的任命
  slots: [
    { slot: 0, clientId: null, userId: null, name: 'norion', isAI: false },
    { slot: 1, clientId: null, userId: null, name: 'CPU 1', isAI: true },
    { slot: 2, clientId: null, userId: null, name: 'CPU 2', isAI: true }
  ],
  
  isHost: false,
  isMultiplayerActive: false,
  mySlot: 0, // 自端末の担当スロット（ホスト:0, ゲスト1:1, ゲスト2:2）
  currentSeed: 12345678, // ワールド共有用乱数シード
  _seedApplied: false,

  _hasRegisteredListener: false,
  _lastRefreshTime: 0,
  _syncIntervalId: null,

  /**
   * 初期化：ユーザー情報取得およびメッセージリスナー登録
   */
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

  /**
   * メッセージリスナーの一重登録（シングルトン保証）
   */
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

  /**
   * 公開ルーム一覧の取得（連打防止の3秒クールダウン付き ＆ 幽霊部屋フィルタリング）
   */
  async getPublicRooms() {
    if (!this.isSDKAvailable) return [];
    const now = Date.now();
    if (now - this._lastRefreshTime < 3000) {
      return null;
    }
    this._lastRefreshTime = now;

    try {
      const res = await window.AgentSDK.room.getPublicRoomList();
      if (res && res.data && Array.isArray(res.data.list)) {
        // gamer_num === 0（誰もいない幽霊部屋）および満員部屋を除外
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
   * 公開ルーム作成（ホスト: スロット0「青」担当 ＆ 直前exitでゴースト解放）
   */
  async createRoom(isPrivate = false) {
    await this.init();

    // ★【入室不能根絶】直前の残留切断セッションを解放してから新規作成
    if (this.isSDKAvailable) {
      try {
        await window.AgentSDK.room.exit();
      } catch (e) {}
    }

    let createdRoomId = 'local_room_' + Math.floor(Math.random() * 1000);

    if (this.isSDKAvailable) {
      try {
        const permission = isPrivate ? 1 : 0;
        const res = await window.AgentSDK.room.create({ max_players: 3, room_permission: permission });
        if (res && res.data && res.data.room_id) {
          createdRoomId = res.data.room_id;
        }
      } catch (err) {
        console.error('[NetworkManager] Create room failed:', err);
      }
    }

    this.currentRoomId = createdRoomId;
    this.isHost = true;
    this.mySlot = 0; // ホストは青(スロット0)
    this.isMultiplayerActive = true;
    this._seedApplied = true;

    // ホスト自身で乱数シードを固定決定
    this.currentSeed = (typeof createdRoomId === 'string')
      ? Math.abs(createdRoomId.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0))
      : Math.floor(Math.random() * 90000000) + 10000000;

    // ホスト自身も決定したシードで床ブロックプールを全リセットし、同一シードで再整列！
    if (typeof window !== 'undefined' && window.currentSceneRef) {
      resetParticlePools();
      buildWorld(window.currentSceneRef, this.currentSeed);
      for (let i = 0; i < 60; i++) manageBlockSpawns(window.currentSceneRef, false);
    }

    // ホストのスロット0を自身の clientId で厳格固定
    this.slots[0] = { slot: 0, clientId: this.clientId, userId: this.myUser.user_id, name: this.myUser.name, isAI: false };
    this.slots[1] = { slot: 1, clientId: null, userId: null, name: 'CPU 1', isAI: true };
    this.slots[2] = { slot: 2, clientId: null, userId: null, name: 'CPU 2', isAI: true };

    safeShowGameScreen();

    // ホストの自操作キャラをスロット0（青）へバインド
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
   * ルーム参加（ゲスト: 直前exitでゴースト解放 ＆ 一意なclientIdで申請）
   */
  async joinRoom(roomId) {
    if (!roomId) return false;
    await this.init();

    // ★【入室不能根絶】直前の残留切断セッションを解放してから参加
    if (this.isSDKAvailable) {
      try {
        await window.AgentSDK.room.exit();
      } catch (e) {}
    }

    if (this.isSDKAvailable) {
      try {
        const res = await window.AgentSDK.room.join({ room_id: roomId });
        console.log('[NetworkManager] join room response:', res);
      } catch (err) {
        console.error('[NetworkManager] Join room API call error:', err);
      }
    }

    this.currentRoomId = roomId;
    this.isHost = false;
    this.mySlot = 1; // 初期フォールバックはスロット1(赤)
    this.isMultiplayerActive = true;
    this._seedApplied = false;

    // ★【勝手な移動根絶】参加した瞬間、スロット0（ホスト）を即座にリモート固定し自端末AIによる乗っ取りを物理遮断
    this._bindRemoteSlot(0, 'ホスト');

    safeShowGameScreen();

    // ホストに対して一意な clientId を含めた同期リクエストを送信
    this._sendCustomMessage({
      event: 'REQUEST_ROOM_SYNC',
      clientId: this.clientId,
      userId: this.myUser.user_id,
      name: this.myUser.name
    });

    this._startPositionBroadcasting();
    return true;
  },

  /**
   * ゲストが入室した時の処理（ホスト側）
   */
  _handleUserJoined(data) {
    if (!data) return;
    const userId = String(data.user_id || '');
    if (!userId || userId === String(this.myUser.user_id)) return;

    if (this.isHost) {
      // ゲストからの REQUEST_ROOM_SYNC (clientId付き) を待って正確に割り当てるため、
      // ここでは既存の最新構成をウェルカム配信
      this._sendCustomMessage({
        event: 'ROOM_MEMBERS_SYNC',
        slots: this.slots,
        seed: this.currentSeed,
        snapshot: captureWorldSnapshot()
      });
    }
  },

  /**
   * カスタムメッセージ受信ハンドラ
   */
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
        // ① ホストから届いたスロット構成＆マップシード＆世界状態スナップショットの完全同期
        case 'ROOM_MEMBERS_SYNC':
          this._applyRoomMembersSync(packet.slots, packet.seed, packet.snapshot);
          break;

        // ② ★【キャラあべこべ根絶】新入室者からのリクエスト（ホストがclientIdに基づき空きスロットを動的任命）
        case 'REQUEST_ROOM_SYNC':
          if (this.isHost) {
            const reqClientId = packet.clientId;
            const reqUserId = String(packet.userId || '');
            const reqName = packet.name || 'ゲスト';

            // 自身の端末からのエコーは除外
            if (reqClientId && reqClientId !== this.clientId) {
              // 既に割り当て済みか確認
              let targetSlot = this.slots.findIndex(s => s.clientId === reqClientId);

              if (targetSlot === -1) {
                // 空いているスロット（isAI === true）を順番に任命（1:赤 ➔ 2:黄）
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

                // ホスト側画面でも即座に該当キャラを完全リモート化（AI乗っ取りを物理遮断）
                this._bindRemoteSlot(targetSlot, reqName);
              }
            }

            // 任命結果と最新世界状態を全員へ配信
            this._sendCustomMessage({
              event: 'ROOM_MEMBERS_SYNC',
              slots: this.slots,
              seed: this.currentSeed,
              snapshot: captureWorldSnapshot()
            });
          }
          break;

        // ③ 10Hzリアルタイム位置パケットの受信
        case 'POS':
          this._handleRemotePosition(packet);
          break;

        // ④ 階段設置パケットのリアルタイム受信
        case 'BUILD_PLANK':
          if (typeof window.applyRemotePlankBuilt === 'function') {
            window.applyRemotePlankBuilt(packet.stageIdx, packet.laneIdx, packet.plankIdx, packet.teamId);
          }
          break;

        // ⑤ 相手が床ブロックを拾った際のリアルタイム受信
        case 'PICK_BLOCK':
          if (typeof window.applyRemoteBlockPicked === 'function') {
            window.applyRemoteBlockPicked(packet.stageIdx, packet.poolIdx, packet.x, packet.z);
          }
          break;

        // ⑥ ホストが新ブロックを補充した際のリアルタイム受信
        case 'SPAWN_BLOCK':
          if (typeof window.applyRemoteBlockSpawned === 'function') {
            window.applyRemoteBlockSpawned(packet.stageIdx, packet.poolIdx, packet.x, packet.y, packet.z, packet.teamId);
          }
          break;

        // ⑦ 全員同時リスタート
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

  /**
   * ★【キャラあべこべ＆勝手な移動根絶】同期パケット適用ハンドラ
   */
  _applyRoomMembersSync(syncedSlots, seed, snapshot = null) {
    if (!Array.isArray(syncedSlots)) return;
    this.slots = syncedSlots;

    // 初回シード同期時：ワールド構築 ＆ ホストのスナップショットで現在の床ブロックと階段を一括完全再現
    if (seed && (!this._seedApplied || this.currentSeed !== seed) && !this.isHost) {
      this.currentSeed = seed;
      this._seedApplied = true;
      if (typeof window !== 'undefined' && window.currentSceneRef) {
        resetParticlePools();
        buildWorld(window.currentSceneRef, seed);

        if (snapshot && Array.isArray(snapshot.blocks)) {
          snapshot.blocks.forEach(b => {
            if (typeof window.applyRemoteBlockSpawned === 'function') {
              window.applyRemoteBlockSpawned(b.stageIdx, b.poolIdx, b.x, b.y, b.z, b.teamId);
            }
          });
        } else {
          for (let i = 0; i < 60; i++) manageBlockSpawns(window.currentSceneRef, false);
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

    // ★【最重要】clientId による自端末スロットの確定（同一アカウント norion 同士でも絶対に被らない）
    syncedSlots.forEach((s) => {
      const isMyClient = (s.clientId && s.clientId === this.clientId) || (!s.clientId && this.isHost && s.slot === 0);

      if (isMyClient) {
        // 自操作キャラ確定
        this.mySlot = s.slot;
        window.MY_PLAYER_SLOT = s.slot;
        if (typeof bindLocalPlayerSlot === 'function') {
          bindLocalPlayerSlot(s.slot);
        } else if (typeof window.bindLocalPlayerSlot === 'function') {
          window.bindLocalPlayerSlot(s.slot);
        }
      } else if (!s.isAI && (s.clientId || s.userId)) {
        // ★【勝手な移動根絶】他人間プレイヤーのスロットは、直ちに自端末AI思考を完全停止しリモート固定！
        this._bindRemoteSlot(s.slot, s.name);
      } else if (s.isAI) {
        // 人間がいないスロットのみCPUとして自律走行
        this._restoreSlotToAI(s.slot);
      }
    });
  },

  /**
   * ★【勝手な移動根絶】指定スロットを自律AI思考から完全に切り離し、完全静止（リモート受信待ち）に固定
   */
  _bindRemoteSlot(slotIndex, playerName) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    // 自端末の ai.js による自動操作を物理遮断
    targetChar.isPlayer = false;
    targetChar.isAI = false;
    targetChar.isRemote = true;
    targetChar.aiState = 'REMOTE_IDLE';
    targetChar.aiDirX = 0;
    targetChar.aiDirZ = 0;
    targetChar.targetBlock = null;
    targetChar.searchCooldown = 999999;
    targetChar.name = playerName;

    // 相手が操作していない時に勝手に歩かないよう、直ちに静止ポーズへ整列
    targetChar.walkCycle = 0;
    if (targetChar.meshObj) {
      if (targetChar.meshObj.leftLeg) targetChar.meshObj.leftLeg.rotation.x = 0;
      if (targetChar.meshObj.rightLeg) targetChar.meshObj.rightLeg.rotation.x = 0;
      if (targetChar.meshObj.leftArm) targetChar.meshObj.leftArm.rotation.x = 0;
      if (targetChar.meshObj.rightArm) targetChar.meshObj.rightArm.rotation.x = 0;
    }

    // リモートプレイヤーの背中スタック色を更新
    refreshCharacterStackVisuals(targetChar);

    // ネームプレートの更新
    if (targetChar.nameplateSprite) {
      if (targetChar.nameplateSprite.material && targetChar.nameplateSprite.material.map) {
        targetChar.nameplateSprite.material.map.dispose();
      }
      const newMesh = createNameplateMesh(playerName, false);
      targetChar.nameplateSprite.material = newMesh.material;
      targetChar.nameplateSprite.visible = true;
    }
  },

  /**
   * 指定スロットを自律AI（CPU）へ安全に復帰
   */
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

  /**
   * 10Hz（100ms周期）での自キャラ位置ブロードキャスト
   */
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

  /**
   * 受信したリモートキャラの最新座標を格納（main.js のLerp補間用）
   */
  _handleRemotePosition(packet) {
    if (packet.slot === this.mySlot || packet.clientId === this.clientId) return;

    const targetChar = characters[packet.slot];
    if (!targetChar) return;

    // パケットを受信したスロットは確実にリモート属性を維持
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

  /**
   * カスタムメッセージ送信ヘルパー
   */
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

  /**
   * プレイヤー退出ハンドラ
   */
  _handleUserExited(data) {
    if (!data) return;
    const userId = String(data.user_id || '');
    const exitedSlotIdx = this.slots.findIndex(s => String(s.userId) === userId);

    if (exitedSlotIdx !== -1 && exitedSlotIdx !== 0) {
      console.log(`[NetworkManager] User exited from slot ${exitedSlotIdx}, restoring AI.`);
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

  /**
   * ルーム退出
   */
  async exitRoom() {
    if (this._syncIntervalId) {
      clearInterval(this._syncIntervalId);
      this._syncIntervalId = null;
    }
    if (this.isSDKAvailable) {
      try {
        await window.AgentSDK.room.exit();
      } catch (e) {}
    }
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
 * ページ離脱・リロード・画面バック時に確実に room.exit() を投げて幽霊部屋の残留を激減させる
 */
if (typeof window !== 'undefined') {
  const onSafeLeave = () => {
    if (NetworkManager.isMultiplayerActive && NetworkManager.isSDKAvailable) {
      try {
        window.AgentSDK.room.exit().catch(() => {}).finally(() => {});
      } catch (e) {}
    }
  };
  window.addEventListener('pagehide', onSafeLeave);
  window.addEventListener('beforeunload', onSafeLeave);
}

/**
 * dom.js 内のボタンと NetworkManager を自動接続するフック
 */
export function hookLobbyNetworkEvents() {
  const btnCreatePublic = document.getElementById('btn-create-public');
  if (btnCreatePublic && !btnCreatePublic._hasNetHook) {
    btnCreatePublic._hasNetHook = true;
    btnCreatePublic.addEventListener('click', () => {
      NetworkManager.createRoom(false);
    });
  }

  const btnRefresh = document.getElementById('btn-refresh-rooms');
  if (btnRefresh && !btnRefresh._hasNetHook) {
    btnRefresh._hasNetHook = true;
    btnRefresh.addEventListener('click', async () => {
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
        item.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span style="font-weight: 800; color: #ffffff; font-size: 14px;">ROOM #${r.room_id}</span>
            <span style="font-size: 12px; color: #bae6fd;">走者: ${r.gamer_num || 1} / 3名</span>
          </div>
          <button type="button" class="gravity-btn-green" style="width: auto; padding: 6px 14px; font-size: 13px; border-radius: 8px;">参加</button>
        `;
        const joinBtn = item.querySelector('button');
        joinBtn.addEventListener('click', () => {
          NetworkManager.joinRoom(r.room_id);
        });
        container.appendChild(item);
      });
    });
  }
}

// ロード完了時に自動フック
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hookLobbyNetworkEvents);
} else {
  hookLobbyNetworkEvents();
}