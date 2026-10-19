// network.js: AgentSDKラッパー ＆ 動的スロット・相互可視化・10Hz位置同期エンジン
// ★ マスターコード完全準拠版：幽霊部屋除外フィルタ・安全退出・階段架け(BUILD_PLANK)＆床ブロック取得(PICK_BLOCK)＆新ブロック補充(SPAWN_BLOCK)受信フック完全接続版
// ★ ステップ2：ゲスト入室時のワールドスナップショット（床ブロック・設置階段）一括同期組み込み版

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
 * ★【ステップ2 新設】ホスト端末の世界状態（現在の床ブロック・設置済み階段段板）を収集
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

export const NetworkManager = {
  isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
  currentRoomId: null,
  myUser: { name: 'YOU', user_id: 'local_user', portrait: '' },
  
  // スロット配列（0:青, 1:赤, 2:黄）
  // 厳格ルール: スロット0=ホスト(青), スロット1=ゲスト1(赤), スロット2=CPU2(黄)またはゲスト2
  slots: [
    { slot: 0, userId: null, name: 'norion', isAI: false },
    { slot: 1, userId: null, name: 'CPU 1', isAI: true },
    { slot: 2, userId: null, name: 'CPU 2', isAI: true }
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
        // ★【GRAVITY公式回答準拠】gamer_num === 0（誰もいない幽霊部屋）および満員部屋を除外
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
   * 公開ルーム作成（ホスト: スロット0「青」担当 ＆ ワールド乱数シード生成＆ホスト自身も同一シード再生成）
   */
  async createRoom(isPrivate = false) {
    await this.init();
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

    // ★ ホスト自身も決定したシードで床ブロックプールを全リセットし、同一シードで再整列！
    if (typeof window !== 'undefined' && window.currentSceneRef) {
      resetParticlePools();
      buildWorld(window.currentSceneRef, this.currentSeed);
      for (let i = 0; i < 60; i++) manageBlockSpawns(window.currentSceneRef, false);
    }

    this.slots[0] = { slot: 0, userId: this.myUser.user_id, name: this.myUser.name, isAI: false };
    this.slots[1] = { slot: 1, userId: null, name: 'CPU 1', isAI: true };
    this.slots[2] = { slot: 2, userId: null, name: 'CPU 2', isAI: true };

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
   * ルーム参加（ゲスト1: スロット1「赤」へ厳格バインド）
   */
  async joinRoom(roomId) {
    if (!roomId) return false;
    await this.init();

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
    this.mySlot = 1; // 最初のゲストは例外なくスロット1(赤)に固定
    this.isMultiplayerActive = true;
    this._seedApplied = false;

    safeShowGameScreen();

    // 端末B自身の自操作キャラを「スロット1（赤）」へ即座にバインド！
    if (typeof bindLocalPlayerSlot === 'function') {
      bindLocalPlayerSlot(1);
    } else if (typeof window.bindLocalPlayerSlot === 'function') {
      window.bindLocalPlayerSlot(1);
    }

    // ホストに対して「入室完了通知＆スロット・シード同期リクエスト」を送信
    this._sendCustomMessage({
      event: 'REQUEST_ROOM_SYNC',
      userId: this.myUser.user_id,
      name: this.myUser.name
    });

    this._startPositionBroadcasting();
    return true;
  },

  /**
   * ゲストが入室した時の処理（ホスト側: スロット1「赤」へ確実に割り当て ＆ 現在の世界状態スナップショット配信）
   */
  _handleUserJoined(data) {
    if (!data) return;
    const userId = String(data.user_id || '');
    if (!userId || userId === String(this.myUser.user_id)) return;

    const guestName = data.user_name || 'ゲスト';

    if (this.isHost) {
      // 2人対戦時は確実にスロット1(赤)へゲストを割り当て
      let targetSlot = 1;
      if (!this.slots[1].isAI && this.slots[1].userId !== userId) {
        targetSlot = 2; // 3人目の場合のみ黄へ
      }

      this.slots[targetSlot] = {
        slot: targetSlot,
        userId: userId,
        name: guestName,
        isAI: false
      };

      // 黄(スロット2)が巻き込まれて書き換わらないようCPU 2を明示保護
      if (targetSlot === 1) {
        this.slots[2] = { slot: 2, userId: null, name: 'CPU 2', isAI: true };
      }

      this._bindRemoteSlot(targetSlot, guestName);

      // ★ Welcomeハンドシェイク：ホストのワールド乱数シード、スロット構成、現在の世界状態スナップショットを配信！
      this._sendCustomMessage({
        event: 'ROOM_MEMBERS_SYNC',
        slots: this.slots,
        seed: this.currentSeed,
        snapshot: captureWorldSnapshot()
      });
    }
  },

  /**
   * ★ カスタムメッセージ受信ハンドラ（GRAVITY公式回答準拠）
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

        // ② 新入室者からの同期リクエスト（ホストが最新状態とシードとスナップショットを即時返信）
        case 'REQUEST_ROOM_SYNC':
          if (this.isHost) {
            const reqUserId = String(packet.userId || '');
            if (reqUserId && reqUserId !== String(this.myUser.user_id)) {
              let targetSlot = 1;
              if (!this.slots[1].isAI && this.slots[1].userId !== reqUserId) {
                targetSlot = 2;
              }

              this.slots[targetSlot] = {
                slot: targetSlot,
                userId: reqUserId,
                name: packet.name || 'ゲスト',
                isAI: false
              };

              if (targetSlot === 1) {
                this.slots[2] = { slot: 2, userId: null, name: 'CPU 2', isAI: true };
              }

              this._bindRemoteSlot(targetSlot, packet.name || 'ゲスト');
            }

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

        // ④ ★ 階段設置パケットのリアルタイム受信（段板を即時塗り替え！）
        case 'BUILD_PLANK':
          if (typeof window.applyRemotePlankBuilt === 'function') {
            window.applyRemotePlankBuilt(packet.stageIdx, packet.laneIdx, packet.plankIdx, packet.teamId);
          }
          break;

        // ⑤ ★ 相手が床ブロックを拾った際のリアルタイム受信（床ブロック即時消去）
        case 'PICK_BLOCK':
          if (typeof window.applyRemoteBlockPicked === 'function') {
            window.applyRemoteBlockPicked(packet.stageIdx, packet.poolIdx, packet.x, packet.z);
          }
          break;

        // ⑥ ★ ホストが新ブロックを補充した際のリアルタイム受信（ゲスト側へ即時出現反映）
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
   * ★【ステップ2 改善】ホストから受信したスロット構成、シード値、世界状態スナップショットを自画面に反映
   */
  _applyRoomMembersSync(syncedSlots, seed, snapshot = null) {
    if (!Array.isArray(syncedSlots)) return;
    this.slots = syncedSlots;

    // 初回シード同期時：ワールド構築 ＆ ホストのスナップショットで現在の床ブロックと階段を一括完全再現！
    if (seed && (!this._seedApplied || this.currentSeed !== seed) && !this.isHost) {
      this.currentSeed = seed;
      this._seedApplied = true;
      if (typeof window !== 'undefined' && window.currentSceneRef) {
        resetParticlePools();
        buildWorld(window.currentSceneRef, seed);

        if (snapshot && Array.isArray(snapshot.blocks)) {
          // ホストの現在のアクティブ床ブロック一覧を正確に再現配置（初期生成乱数に頼らず現物同期）
          snapshot.blocks.forEach(b => {
            if (typeof window.applyRemoteBlockSpawned === 'function') {
              window.applyRemoteBlockSpawned(b.stageIdx, b.poolIdx, b.x, b.y, b.z, b.teamId);
            }
          });
        } else {
          for (let i = 0; i < 60; i++) manageBlockSpawns(window.currentSceneRef, false);
        }

        // 入室前にホストや先行走者が架けた階段段板を一括復元
        if (snapshot && Array.isArray(snapshot.planks)) {
          snapshot.planks.forEach(p => {
            if (typeof window.applyRemotePlankBuilt === 'function') {
              window.applyRemotePlankBuilt(p.stageIdx, p.laneIdx, p.plankIdx, p.teamId);
            }
          });
        }
      }
    } else if (!this.isHost && snapshot && Array.isArray(snapshot.planks)) {
      // 既に初期化済みの場合でも階段段板データを安全に上書き反映
      snapshot.planks.forEach(p => {
        if (typeof window.applyRemotePlankBuilt === 'function') {
          window.applyRemotePlankBuilt(p.stageIdx, p.laneIdx, p.plankIdx, p.teamId);
        }
      });
    }

    syncedSlots.forEach((s) => {
      if (String(s.userId) === String(this.myUser.user_id)) {
        this.mySlot = s.slot;
        window.MY_PLAYER_SLOT = s.slot;
        if (typeof bindLocalPlayerSlot === 'function') {
          bindLocalPlayerSlot(s.slot);
        } else if (typeof window.bindLocalPlayerSlot === 'function') {
          window.bindLocalPlayerSlot(s.slot);
        }
      } else if (!s.isAI && s.userId) {
        this._bindRemoteSlot(s.slot, s.name);
      } else if (s.isAI) {
        this._restoreSlotToAI(s.slot);
      }
    });
  },

  /**
   * 指定スロットをリモートプレイヤーとしてバインド
   */
  _bindRemoteSlot(slotIndex, playerName) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    targetChar.isPlayer = false;
    targetChar.isAI = false;
    targetChar.isRemote = true;
    targetChar.aiState = 'REMOTE_IDLE';
    targetChar.aiDirX = 0;
    targetChar.aiDirZ = 0;
    targetChar.name = playerName;

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
    if (packet.slot === this.mySlot) return;

    const targetChar = characters[packet.slot];
    if (!targetChar) return;

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
   * ★ カスタムメッセージ送信ヘルパー（GRAVITY公式回答準拠）
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

    if (exitedSlotIdx !== -1) {
      console.log(`[NetworkManager] User exited from slot ${exitedSlotIdx}, restoring AI.`);
      this.slots[exitedSlotIdx] = {
        slot: exitedSlotIdx,
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
 * ★【GRAVITY公式回答ベストプラクティス】
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