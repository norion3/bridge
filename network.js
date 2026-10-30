// ==============================================================================
// 『くねくねバトル オンライン』AgentSDK公式マルチプレイ通信マネージャー (network.js)
// ・AgentSDK (v1.0.2) 公式仕様完全準拠
// ・10Hz 単一パケット集約送出ループ（1KB制限完全クリア）
// ・5秒無通信検知による自律ホスト昇格ウォッチドッグ (Host Migration)
// ・入退室・リスタート時のセッション完全初期化 (purgeLocalWorldState)
// ・安全退出ガード (safeExitCurrentRoom: Promise.race 700ms)
// ==============================================================================

import {
    round1,
    generateClientId,
    encodeSnakeToTuple,
    decodeTupleToSnake,
    packFoodPickTuple,
    unpackFoodPickTuple,
    packDropFoodTuple,
    unpackDropFoodTuple,
    packChatTuple,
    unpackChatTuple
} from './net_protocol.js';

import { Danmaku } from './danmaku.js';
import { Menu } from './menu.js';
import { SNAKE_COLORS } from './constants.js';

/**
 * 未入室時の exit() による無限保留（Promiseハング）を防ぐ安全退出ヘルパー
 */
async function safeExitCurrentRoom(targetRoomId = null) {
    if (typeof window === 'undefined' || !window.AgentSDK || !window.AgentSDK.room) return;
    try {
        if (typeof window.AgentSDK.room.getRoomId === 'function') {
            const res = await window.AgentSDK.room.getRoomId();
            const activeRoomId = (res && typeof res.room_id === 'string')
                ? res.room_id
                : (res && res.data && res.data.room_id ? res.data.room_id : '');
            if (!activeRoomId || activeRoomId === '') return;
            if (targetRoomId && String(activeRoomId) === String(targetRoomId)) return;
        }
        const exitPromise = window.AgentSDK.room.exit();
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 700));
        await Promise.race([exitPromise, timeoutPromise]);
        await new Promise(r => setTimeout(r, 200));
    } catch (e) {
        console.warn('[network.js] safeExitCurrentRoom caught:', e);
    }
}

export const NetworkManager = {
    isSDKAvailable: typeof window !== 'undefined' && !!window.AgentSDK,
    currentRoomId: null,
    clientId: generateClientId(),
    myUser: { name: 'あなた', user_id: 'local_user', portrait: '' },

    // 最大8人のプレイヤー枠（スロット 0〜7）
    slots: Array.from({ length: 8 }, (_, i) => ({
        slot: i,
        clientId: null,
        userId: null,
        name: i === 0 ? 'あなた' : `プレイヤー ${i + 1}`,
        color: SNAKE_COLORS[i % SNAKE_COLORS.length],
        isAI: i !== 0,
        joinTime: 0
    })),

    isHost: false,
    isMultiplayerActive: false,
    mySlot: 0,
    currentSeed: 12345678,

    _hasRegisteredListener: false,
    _syncIntervalId: null,
    _watchdogIntervalId: null,
    _lastHostPacketTime: 0,
    _hasReceivedFirstHostPacket: false,
    _isPromoting: false,

    // AIスネーク送出用の時分割インターリーブインデックス
    _aiSliceIndex: 0,

    // アクション蓄積キュー（100ms周期の単一パケットに同封）
    _pendingPicks: [],
    _pendingDrops: [],
    _pendingChats: [],

    // 外部参照コールバック（main.js から登録）
    callbacks: {
        onRemoteSnakeUpdate: null,  // (snakeData) => void
        onFoodPicked: null,         // (pickData) => void
        onDropSpawned: null,        // (dropData) => void
        onSeedReceived: null        // (seed) => void
    },

    setCallbacks(cb) {
        this.callbacks = { ...this.callbacks, ...cb };
    },

    queueFoodPick(gx, gy, foodIndex) {
        if (!this.isMultiplayerActive) return;
        this._pendingPicks.push(packFoodPickTuple(gx, gy, foodIndex));
    },

    queueDropFood(x, y, val, colorIdx) {
        if (!this.isMultiplayerActive) return;
        this._pendingDrops.push(packDropFoodTuple(x, y, val, colorIdx));
    },

    queueChat(messageText) {
        if (!messageText) return;
        const cleanText = String(messageText).trim().slice(0, 15);
        if (!cleanText) return;

        const myName = this.myUser.name;
        const myColor = SNAKE_COLORS[this.mySlot % SNAKE_COLORS.length];
        Danmaku.push(myName, cleanText, myColor);

        if (this.isMultiplayerActive) {
            this._pendingChats.push(packChatTuple(this.mySlot, cleanText));
        }
    },

    async init() {
        if (!this.isSDKAvailable) {
            console.warn('[NetworkManager] AgentSDK unavailable. Standalone mode.');
            return this.myUser;
        }

        try {
            const res = await window.AgentSDK.user.getMyUserInfo();
            if (res && res.data) {
                this.myUser = {
                    user_id: String(res.data.user_id),
                    name: res.data.name || 'あなた',
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
                        if (payload.msg_data || payload.message || payload.e || (payload.data && (payload.data.msg_data || payload.data.message))) {
                            this._handleCustomMessage(payload);
                        }
                        break;
                }
            });
        } catch (err) {
            console.warn('[NetworkManager] receiveMessage setup failed:', err);
        }
    },

    async createRoom(isPrivate = false) {
        try {
            await this.init();
            await safeExitCurrentRoom(null);
            this.purgeLocalWorldState();

            let createdRoomId = 'local_room_' + Math.floor(Math.random() * 1000);

            if (this.isSDKAvailable) {
                const permission = isPrivate ? 1 : 0;
                const res = await window.AgentSDK.room.create({ max_players: 8, room_permission: permission });

                let isSuccess = false;
                if (res) {
                    if (res.errno === 0 || res.errno === '0' || res.code === 0 || res.code === '0') isSuccess = true;
                    else if (res.data && (res.data.room_id || res.data.roomId)) isSuccess = true;
                    else if (res.room_id || res.roomId) isSuccess = true;
                }

                if (!isSuccess && res && (res.errno !== undefined || res.code !== undefined)) {
                    console.error('[NetworkManager] Create room failed:', res.errmsg || res.message);
                    return null;
                }

                if (res && res.data && res.data.room_id) createdRoomId = String(res.data.room_id);
                else if (res && res.room_id) createdRoomId = String(res.room_id);
            }

            this.currentRoomId = createdRoomId;
            this.clientId = generateClientId();
            this.ensureMessageListener();

            this.isHost = true;
            this.mySlot = 0;
            this.isMultiplayerActive = true;
            this.currentSeed = Math.floor(Math.random() * 90000000) + 10000000;

            this.slots[0] = {
                slot: 0,
                clientId: this.clientId,
                userId: this.myUser.user_id,
                name: this.myUser.name,
                color: SNAKE_COLORS[0],
                isAI: false,
                joinTime: performance.now()
            };

            this._stopHostWatchdog();
            this._startBroadcasting();
            Danmaku.push('システム', `ルーム #${createdRoomId.slice(-4)} を作成しました`, '#00e5ff', true);

            return this.currentRoomId;
        } catch (err) {
            console.error('[NetworkManager] createRoom exception:', err);
            return null;
        }
    },

    async joinRoom(roomId) {
        if (!roomId) return false;
        const safeRoomId = String(roomId);

        try {
            await this.init();
            await safeExitCurrentRoom(safeRoomId);
            this.purgeLocalWorldState();

            if (this.isSDKAvailable) {
                const res = await window.AgentSDK.room.join({ room_id: safeRoomId });
                let isSuccess = false;
                if (res) {
                    if (res.errno === 0 || res.errno === '0' || res.code === 0 || res.code === '0') isSuccess = true;
                    else if (res.data && (res.data.room_id || res.data.roomId)) isSuccess = true;
                }
                if (!isSuccess && res && (res.errno !== undefined || res.code !== undefined)) {
                    console.error('[NetworkManager] Join room failed:', res.errmsg || res.message);
                    return false;
                }
            }

            this.currentRoomId = safeRoomId;
            this.clientId = generateClientId();
            this.ensureMessageListener();

            this.isHost = false;
            this.isMultiplayerActive = true;
            this.mySlot = 1; // 初期フォールバック

            this._startHostWatchdog();
            this._startBroadcasting();
            Danmaku.push('システム', `ルーム #${safeRoomId.slice(-4)} に合流しました`, '#34d399', true);

            return true;
        } catch (err) {
            console.error('[NetworkManager] joinRoom exception:', err);
            return false;
        }
    },

    async getPublicRooms() {
        if (!this.isSDKAvailable) return [];
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
                return list.filter(r => (Number(r.gamer_num) || 0) > 0 && (Number(r.gamer_num) || 0) < 8);
            }
        } catch (err) {
            console.warn('[NetworkManager] Failed to get public room list:', err);
        }
        return [];
    },

    _handleUserJoined(data) {
        if (!this.isHost || !data) return;
        const userId = String(data.user_id || data.userId || '');
        if (!userId || userId === String(this.myUser.user_id)) return;

        const guestName = data.name || data.user_name || 'ゲスト';
        let targetSlot = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

        if (targetSlot === -1) {
            for (let i = 1; i < this.slots.length; i++) {
                if (this.slots[i].isAI) {
                    targetSlot = i;
                    break;
                }
            }
        }

        if (targetSlot !== -1) {
            this.slots[targetSlot] = {
                slot: targetSlot,
                clientId: data.clientId || null,
                userId: userId,
                name: guestName,
                color: SNAKE_COLORS[targetSlot % SNAKE_COLORS.length],
                isAI: false,
                joinTime: performance.now()
            };

            // 全員へスロット一覧とシード値を再同期
            this._sendCustomMessage({
                e: 'SYNC_MEMBERS',
                slots: this.slots,
                seed: this.currentSeed
            });

            Danmaku.push('参加', `${guestName} が対戦に参加しました`, this.slots[targetSlot].color);
        }
    },

    _handleUserExited(data) {
        if (!data) return;
        const userId = String(data.user_id || data.userId || '');
        const slotIdx = this.slots.findIndex(s => s.userId && String(s.userId) === userId);

        if (slotIdx !== -1) {
            const exitedName = this.slots[slotIdx].name;
            const isHostExited = (slotIdx === 0 && !this.isHost);

            this.slots[slotIdx] = {
                slot: slotIdx,
                clientId: null,
                userId: null,
                name: `CPU ${slotIdx + 1}`,
                color: SNAKE_COLORS[slotIdx % SNAKE_COLORS.length],
                isAI: true,
                joinTime: 0
            };

            Danmaku.push('退室', `${exitedName} が退出しました`, '#94a3b8');

            if (isHostExited) {
                console.warn('[NetworkManager] ホストが退出しました。自律ホスト昇格を実行します。');
                this.promoteToHost();
            } else if (this.isHost) {
                this._sendCustomMessage({
                    e: 'SYNC_MEMBERS',
                    slots: this.slots,
                    seed: this.currentSeed
                });
            }
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
                console.warn(`[NetworkManager] ホストからのパケット途絶検知 (${Math.round(elapsed)}ms)。自律ホスト昇格を実行`);
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

        this.isHost = true;
        this.mySlot = 0;
        this.slots[0] = {
            slot: 0,
            clientId: this.clientId,
            userId: this.myUser.user_id,
            name: this.myUser.name,
            color: SNAKE_COLORS[0],
            isAI: false,
            joinTime: performance.now()
        };

        Danmaku.push('システム', 'あなたが新しいホストに昇格しました', '#ffdd00', true);
        this._isPromoting = false;
    },

    // 10Hz（100ms周期）の単一集約パケット送出ループ
    _startBroadcasting() {
        if (this._syncIntervalId) clearInterval(this._syncIntervalId);

        this._syncIntervalId = setInterval(() => {
            if (!this.isMultiplayerActive || !this.isSDKAvailable) return;
            if (typeof window.localPlayerInstance === 'undefined' || !window.localPlayerInstance) return;

            const mySnake = window.localPlayerInstance;
            const myTuple = encodeSnakeToTuple(mySnake, this.mySlot, this.isHost);
            const tuplesList = [myTuple];

            // ホスト端末の場合：管理下のAIスネーク42体を3フレーム分割（14体ずつ）して時分割相乗り
            if (this.isHost && Array.isArray(window.allAISnakesInstance)) {
                const ais = window.allAISnakesInstance;
                const BATCH_SIZE = 14;
                const startIndex = (this._aiSliceIndex * BATCH_SIZE) % ais.length;
                this._aiSliceIndex = (this._aiSliceIndex + 1) % 3;

                for (let i = startIndex; i < startIndex + BATCH_SIZE && i < ais.length; i++) {
                    const ai = ais[i];
                    if (ai && !ai.isDead) {
                        const aiTuple = encodeSnakeToTuple(ai, 8 + i, false);
                        tuplesList.push(aiTuple);
                    }
                }
            }

            const outgoingPicks = this._pendingPicks.length > 0 ? [...this._pendingPicks] : undefined;
            const outgoingDrops = this._pendingDrops.length > 0 ? [...this._pendingDrops] : undefined;
            const outgoingChats = this._pendingChats.length > 0 ? [...this._pendingChats] : undefined;

            this._pendingPicks.length = 0;
            this._pendingDrops.length = 0;
            this._pendingChats.length = 0;

            const packet = {
                e: 'P',
                l: tuplesList
            };

            if (outgoingPicks) packet.pk = outgoingPicks;
            if (outgoingDrops) packet.dp = outgoingDrops;
            if (outgoingChats) packet.ch = outgoingChats;

            this._sendCustomMessage(packet);
        }, 100);
    },

    _handleCustomMessage(data) {
        if (!data) return;
        try {
            let rawStr = '';
            if (data.data && typeof data.data.msg_data === 'string') rawStr = data.data.msg_data;
            else if (typeof data.msg_data === 'string') rawStr = data.msg_data;
            else if (data.data && typeof data.data.message === 'string') rawStr = data.data.message;
            else if (typeof data.message === 'string') rawStr = data.message;
            else if (typeof data === 'string') rawStr = data;

            let packet = null;
            if (rawStr) {
                try { packet = JSON.parse(rawStr); } catch (e) { packet = null; }
            }
            if (!packet && typeof data === 'object') {
                if (data.e || data.event) packet = data;
                else if (data.data && typeof data.data === 'object') packet = data.data;
            }
            if (!packet) return;

            const eventType = packet.e || packet.event;
            this._lastHostPacketTime = performance.now();
            this._hasReceivedFirstHostPacket = true;

            // 10Hz POS 受信ハンドラ
            if (eventType === 'P' || eventType === 'POS') {
                const incomingList = packet.l || packet.list;
                if (Array.isArray(incomingList)) {
                    for (let i = 0; i < incomingList.length; i++) {
                        const decoded = decodeTupleToSnake(incomingList[i]);
                        if (decoded && decoded.slot !== this.mySlot && this.callbacks.onRemoteSnakeUpdate) {
                            this.callbacks.onRemoteSnakeUpdate(decoded);
                        }
                    }
                }

                // 餌取得同期
                if (Array.isArray(packet.pk)) {
                    packet.pk.forEach(tuple => {
                        const pick = unpackFoodPickTuple(tuple);
                        if (this.callbacks.onFoodPicked) this.callbacks.onFoodPicked(pick);
                    });
                }

                // 散布肉片同期
                if (Array.isArray(packet.dp)) {
                    packet.dp.forEach(tuple => {
                        const drop = unpackDropFoodTuple(tuple);
                        if (this.callbacks.onDropSpawned) this.callbacks.onDropSpawned(drop);
                    });
                }

                // 弾幕チャット受信
                if (Array.isArray(packet.ch)) {
                    packet.ch.forEach(tuple => {
                        const chat = unpackChatTuple(tuple);
                        if (chat && chat.slot !== this.mySlot) {
                            const senderSlot = chat.slot;
                            const senderName = this.slots[senderSlot] ? this.slots[senderSlot].name : `P${senderSlot + 1}`;
                            const badgeColor = SNAKE_COLORS[senderSlot % SNAKE_COLORS.length];
                            Danmaku.push(senderName, chat.message, badgeColor);
                        }
                    });
                }
                return;
            }

            // ルームメンバー同期
            if (eventType === 'SYNC_MEMBERS') {
                if (Array.isArray(packet.slots)) {
                    this.slots = packet.slots;
                    // 自スロット番号の同定
                    const mySlotData = this.slots.find(s => s.userId && String(s.userId) === String(this.myUser.user_id));
                    if (mySlotData) {
                        this.mySlot = mySlotData.slot;
                    }
                    Menu.updateParticipants(this.slots.filter(s => !s.isAI));
                }
                if (packet.seed && packet.seed !== this.currentSeed) {
                    this.currentSeed = packet.seed;
                    if (this.callbacks.onSeedReceived) this.callbacks.onSeedReceived(packet.seed);
                }
            }
        } catch (err) {
            console.warn('[NetworkManager] handleCustomMessage error:', err);
        }
    },

    _sendCustomMessage(msgObj) {
        if (!this.isSDKAvailable || !window.AgentSDK.room || typeof window.AgentSDK.room.sendMessage !== 'function') return;
        try {
            window.AgentSDK.room.sendMessage({ message: JSON.stringify(msgObj) });
        } catch (e) {
            console.warn('[NetworkManager] sendMessage error:', e);
        }
    },

    // セッション跨ぎ時のメモリ完全初期化
    purgeLocalWorldState() {
        this._stopHostWatchdog();
        if (this._syncIntervalId) {
            clearInterval(this._syncIntervalId);
            this._syncIntervalId = null;
        }

        this._pendingPicks.length = 0;
        this._pendingDrops.length = 0;
        this._pendingChats.length = 0;
        this._lastHostPacketTime = 0;
        this._hasReceivedFirstHostPacket = false;
        this._isPromoting = false;
    },

    async exitRoom() {
        this.purgeLocalWorldState();
        await safeExitCurrentRoom(null);
        this.currentRoomId = null;
        this.isHost = false;
        this.isMultiplayerActive = false;
        this.mySlot = 0;
        Danmaku.push('システム', 'ルームを退出しました', '#94a3b8', true);
    }
};

if (typeof window !== 'undefined') {
    window.NetworkManager = NetworkManager;
}