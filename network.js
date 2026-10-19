// network.js: AgentSDKラッパー ＆ シームレス途中参加（ドロップイン）型マルチプレイ管理モジュール
// GRAVITY音声ルーム連携最適化：待機室なし即出走 ＆ ゲスト入室時にAIを安全消去してスタート地点配置

import { UIController } from './dom.js';
import { characters, createNameplateMesh, updatePlayerName } from './character.js';
import { STAGES } from './world.js';

export const NetworkManager = {
  isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
  currentRoomId: null,
  myUser: { name: 'YOU', user_id: 'local_user', portrait: '' },
  roomMembers: [],
  isHost: false,
  isMultiplayerActive: false,
  mySlot: 0, // 0: 青(ホスト), 1: 赤(ゲスト1), 2: 黄(ゲスト2)

  _hasRegisteredListener: false,
  _lastRefreshTime: 0,

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
          user_id: res.data.user_id,
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
      return null; // クールダウン中
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
   * 公開ルーム作成（待機室なしで即座にゲーム本編へ出走！）
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
    this.roomMembers = [this.myUser];
    this.isHost = true;
    this.mySlot = 0;
    this.isMultiplayerActive = true;

    // ロビー画面を閉じて即座にゲーム画面を表示
    UIController.showGame();

    // 自キャラの名前を即時反映
    if (window.GRAVITY_USER_NAME) {
      updatePlayerName(window.GRAVITY_USER_NAME);
    }

    // スタートモーダルが存在する場合は自動タップして出走
    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.click();
    }

    return this.currentRoomId;
  },

  /**
   * ルーム参加（ゲストとしてスタート地点 Stage 0 から出走）
   */
  async joinRoom(roomId) {
    if (!roomId) return false;
    await this.init();

    if (this.isSDKAvailable) {
      try {
        const res = await window.AgentSDK.room.join({ room_id: roomId });
        if (!res || res.code !== 0) {
          console.warn('[NetworkManager] Join room rejected:', res);
          return false;
        }
      } catch (err) {
        console.error('[NetworkManager] Join room failed:', err);
        return false;
      }
    }

    this.currentRoomId = roomId;
    this.isHost = false;
    this.mySlot = 1; // ゲスト1は赤スロット
    this.isMultiplayerActive = true;

    // ロビーを閉じて即座に出走
    UIController.showGame();

    // ゲスト自身の自キャラを赤スロットとしてスタートラインに整列
    this._setupGuestLocalCharacter();

    // スタートモーダルを自動スキップして即走れる状態にする
    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
      startBtn.click();
    }

    return true;
  },

  /**
   * ゲストが入室した時の処理（走っていたAIを消去し、ゲストをスタート地点に配置）
   */
  _handleUserJoined(data) {
    const userId = data.user_id;
    if (!userId || userId === this.myUser.user_id) return;

    const guestName = data.user_name || 'ゲスト';
    const guestPortrait = data.portrait || data.portait || '';

    const existingIdx = this.roomMembers.findIndex(m => String(m.user_id) === String(userId));
    if (existingIdx === -1) {
      this.roomMembers.push({
        user_id: userId,
        name: guestName,
        portrait: guestPortrait
      });
    }

    // 入室してきたスロットを判定（2人目ならスロット1:赤、3人目ならスロット2:黄）
    const targetSlot = this.roomMembers.length - 1;
    if (targetSlot === 1 || targetSlot === 2) {
      this._replaceAIWithGuest(targetSlot, guestName);
    }
  },

  /**
   * 指定スロットの自律AIを停止・消去し、入室したゲストをスタート地点（Stage 0）に配置
   */
  _replaceAIWithGuest(slotIndex, guestName) {
    const targetChar = characters[slotIndex];
    if (!targetChar) return;

    // 1. AIの自律走行ルーチンを完全停止
    targetChar.isAI = false;
    targetChar.aiState = 'HUMAN_CONTROLLED';
    targetChar.name = guestName;

    // 2. 所持ブロックと階段スタックをリセット
    targetChar.stackCount = 0;
    if (targetChar.meshObj && targetChar.meshObj.stackPool) {
      targetChar.meshObj.stackPool.forEach(b => { b.visible = false; });
    }

    // 3. スタート地点（Stage 0）へ配置
    if (STAGES && STAGES[0]) {
      const offsetX = (slotIndex === 1) ? -4.0 : 4.0;
      targetChar.pos.set(offsetX, STAGES[0].y, STAGES[0].z + 4);
      targetChar.meshObj.root.position.copy(targetChar.pos);
      targetChar.currentStage = 0;
    }

    // 4. 足元のネームプレートをゲストの本名で再生成して差し替え
    if (targetChar.nameplateSprite) {
      if (targetChar.nameplateSprite.material && targetChar.nameplateSprite.material.map) {
        targetChar.nameplateSprite.material.map.dispose();
      }
      const newMesh = createNameplateMesh(guestName, false);
      targetChar.nameplateSprite.material = newMesh.material;
      targetChar.nameplateSprite.visible = true;
      targetChar.nameplateSprite.position.set(targetChar.pos.x, targetChar.pos.y + 0.05, targetChar.pos.z + 1.15);
    }
  },

  /**
   * ゲスト端末側：自分が操作するキャラクターをスタート地点に整列
   */
  _setupGuestLocalCharacter() {
    // ゲスト端末では赤（スロット1）を自キャラとしてスタート地点に配置
    const myChar = characters[this.mySlot] || characters[0];
    if (myChar && STAGES && STAGES[0]) {
      myChar.pos.set(-4.0, STAGES[0].y, STAGES[0].z + 4);
      myChar.meshObj.root.position.copy(myChar.pos);
      myChar.currentStage = 0;
      myChar.stackCount = 0;

      if (window.GRAVITY_USER_NAME) {
        myChar.name = window.GRAVITY_USER_NAME;
        if (myChar.nameplateSprite) {
          if (myChar.nameplateSprite.material && myChar.nameplateSprite.material.map) {
            myChar.nameplateSprite.material.map.dispose();
          }
          const newMesh = createNameplateMesh(window.GRAVITY_USER_NAME, true);
          myChar.nameplateSprite.material = newMesh.material;
          myChar.nameplateSprite.visible = true;
        }
      }
    }
  },

  /**
   * プレイヤー退出ハンドラ
   */
  _handleUserExited(data) {
    const userId = data.user_id;
    const idx = this.roomMembers.findIndex(m => String(m.user_id) === String(userId));
    if (idx !== -1) {
      this.roomMembers.splice(idx, 1);
      // 退出した枠をAIに戻す処理（安全維持）
      if (idx === 1 && characters[1]) {
        characters[1].isAI = true;
        characters[1].name = 'CPU 1';
      }
    }
  },

  /**
   * カスタムメッセージ受信ハンドラ
   */
  _handleCustomMessage(data) {
    if (!data || !data.msg_data) return;
    try {
      const packet = JSON.parse(data.msg_data);
      if (packet.event === 'RESTART_GAME' && typeof window.onRemoteRestartReceived === 'function') {
        window.onRemoteRestartReceived(packet);
      }
    } catch (e) {
      console.warn('[NetworkManager] Failed to parse message:', e);
    }
  },

  /**
   * ルーム退出
   */
  async exitRoom() {
    if (this.isSDKAvailable) {
      try {
        await window.AgentSDK.room.exit();
      } catch (e) {}
    }
    this.currentRoomId = null;
    this.roomMembers = [];
    this.isHost = false;
    this.isMultiplayerActive = false;
    this.mySlot = 0;
    UIController.showLobby();
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