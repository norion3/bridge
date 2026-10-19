// network.js: AgentSDKラッパー ＆ 動的スロット・相互可視化・10Hz位置同期エンジン
// GRAVITY公式回答準拠: sendMessage({ message }) ＆ receiveMessage(payload.data.msg_data)

import { characters, createNameplateMesh, updatePlayerName, bindLocalPlayerSlot } from './character.js';
import { STAGES } from './world.js';

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

export const NetworkManager = {
  isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
  currentRoomId: null,
  myUser: { name: 'YOU', user_id: 'local_user', portrait: '' },
  
  // スロット配列（0:青, 1:赤, 2:黄）
  // 各スロット: { slot: number, userId: string|null, name: string, isAI: boolean }
  slots: [
    { slot: 0, userId: null, name: 'norion', isAI: false },
    { slot: 1, userId: null, name: 'CPU 1', isAI: true },
    { slot: 2, userId: null, name: 'CPU 2', isAI: true }
  ],
  
  isHost: false,
  isMultiplayerActive: false,
  mySlot: 0, // 自端末の担当スロット（ホスト:0, ゲスト1:1, ゲスト2:2）

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
   * 公開ルーム一覧の取得（連打防止の3秒クールダウン付き）
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
        return res.data.list;
      }
    } catch (err) {
      console.error('[NetworkManager] Failed to get public rooms:', err);
    }
    return [];
  },

  /**
   * 公開ルーム作成（ホスト: スロット0「青」担当）
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
   * ルーム参加（ゲスト: 空きスロットへ割り当て）
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
    // 初期の仮スロットは1(赤)
    this.mySlot = 1;
    this.isMultiplayerActive = true;

    safeShowGameScreen();

    // 端末B自身の自操作キャラを「スロット1（赤）」へ即座にバインド
    if (typeof bindLocalPlayerSlot === 'function') {
      bindLocalPlayerSlot(1);
    } else if (typeof window.bindLocalPlayerSlot === 'function') {
      window.bindLocalPlayerSlot(1);
    }

    // ホストに対して「入室完了通知＆スロット同期リクエスト」を送信
    this._sendCustomMessage({
      event: 'REQUEST_ROOM_SYNC',
      userId: this.myUser.user_id,
      name: this.myUser.name
    });

    this._startPositionBroadcasting();
    return true;
  },

  /**
   * ゲストが入室した時の処理（ホスト側で即時スロット1へ割り当て）
   */
  _handleUserJoined(data) {
    if (!data) return;
    const userId = String(data.user_id || '');
    if (!userId || userId === String(this.myUser.user_id)) return;

    const guestName = data.user_name || 'ゲスト';

    // ホスト側：空きスロットを探してゲストを割り当て
    if (this.isHost) {
      let targetSlot = -1;
      if (this.slots[1].isAI) {
        targetSlot = 1; // 赤
      } else if (this.slots[2].isAI) {
        targetSlot = 2; // 黄
      }

      if (targetSlot !== -1) {
        this.slots[targetSlot] = {
          slot: targetSlot,
          userId: userId,
          name: guestName,
          isAI: false
        };

        this._bindRemoteSlot(targetSlot, guestName);

        // Welcomeハンドシェイク：新入室者および全員に最新スロット構成を配信
        this._sendCustomMessage({
          event: 'ROOM_MEMBERS_SYNC',
          slots: this.slots
        });
      }
    }
  },

  /**
   * ★ カスタムメッセージ受信ハンドラ（GRAVITY公式回答準拠）
   * payload.data.msg_data から取り出して JSON.parse
   */
  _handleCustomMessage(data) {
    if (!data) return;
    try {
      // 公式仕様: data.msg_data に文字列が格納されている
      const rawStr = (typeof data.msg_data === 'string')
        ? data.msg_data
        : (typeof data === 'string' ? data : (data.message || ''));

      if (!rawStr) return;
      const packet = JSON.parse(rawStr);
      if (!packet || !packet.event) return;

      switch (packet.event) {
        // ① ホストから届いたスロット構成の完全同期（相互可視化）
        case 'ROOM_MEMBERS_SYNC':
          this._applyRoomMembersSync(packet.slots);
          break;

        // ② 新入室者からの同期リクエスト（ホストが最新状態を即時返信）
        case 'REQUEST_ROOM_SYNC':
          if (this.isHost) {
            const reqUserId = String(packet.userId || '');
            if (reqUserId && reqUserId !== String(this.myUser.user_id)) {
              let targetSlot = -1;
              if (this.slots[1].isAI) targetSlot = 1;
              else if (this.slots[2].isAI) targetSlot = 2;

              if (targetSlot !== -1) {
                this.slots[targetSlot] = {
                  slot: targetSlot,
                  userId: reqUserId,
                  name: packet.name || 'ゲスト',
                  isAI: false
                };
                this._bindRemoteSlot(targetSlot, packet.name || 'ゲスト');
              }
            }

            this._sendCustomMessage({
              event: 'ROOM_MEMBERS_SYNC',
              slots: this.slots
            });
          }
          break;

        // ③ 10Hzリアルタイム位置パケットの受信
        case 'POS':
          this._handleRemotePosition(packet);
          break;

        // ④ 全員同時リスタート
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
   * ホストから受信したスロット構成を自画面に反映（端末Bでも端末Aが見えるようになる！）
   */
  _applyRoomMembersSync(syncedSlots) {
    if (!Array.isArray(syncedSlots)) return;
    this.slots = syncedSlots;

    syncedSlots.forEach((s) => {
      // 自分がどのスロットにいるか確定
      if (String(s.userId) === String(this.myUser.user_id)) {
        this.mySlot = s.slot;
        window.MY_PLAYER_SLOT = s.slot;
        if (typeof bindLocalPlayerSlot === 'function') {
          bindLocalPlayerSlot(s.slot);
        } else if (typeof window.bindLocalPlayerSlot === 'function') {
          window.bindLocalPlayerSlot(s.slot);
        }
      } else if (!s.isAI && s.userId) {
        // 他のプレイヤー（リモート走者）としてセットアップ
        this._bindRemoteSlot(s.slot, s.name);
      } else if (s.isAI) {
        // AIとして復帰
        this._restoreSlotToAI(s.slot);
      }
    });
  },

  /**
   * 指定スロットをリモートプレイヤーとしてバインド（AI停止＆ネームプレート表示）
   */
  _bindRemoteSlot(slotIndex, playerName) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    targetChar.isPlayer = false;
    targetChar.isAI = false;
    targetChar.isRemote = true; // リモートプレイヤーフラグ
    targetChar.aiState = 'REMOTE_IDLE';
    targetChar.aiDirX = 0;
    targetChar.aiDirZ = 0;
    targetChar.name = playerName;

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
    if (packet.slot === this.mySlot) return; // 自分のパケットは無視

    const targetChar = characters[packet.slot];
    if (!targetChar) return;

    // 次のフレームでLerp補間するためのターゲット座標
    if (!targetChar.targetNetPos) {
      targetChar.targetNetPos = new THREE.Vector3();
    }
    targetChar.targetNetPos.set(packet.x, packet.y, packet.z);
    targetChar.targetNetRotY = packet.rotY;

    // スタック数に変化があれば同期
    if (targetChar.stackCount !== packet.stack) {
      targetChar.stackCount = packet.stack;
      if (typeof window.refreshRemoteStackVisuals === 'function') {
        window.refreshRemoteStackVisuals(targetChar);
      }
    }
  },

  /**
   * ★ カスタムメッセージ送信ヘルパー（GRAVITY公式回答準拠）
   * 引数は room_id 不要、キー名は message のみ！
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
   * プレイヤー退出ハンドラ（退出したスロットを即座にAIへ復元！）
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

      // ホストなら最新スロット構成を全員に再ブロードキャスト
      if (this.isHost) {
        this._sendCustomMessage({
          event: 'ROOM_MEMBERS_SYNC',
          slots: this.slots
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