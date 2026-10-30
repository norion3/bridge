/**
 * ==============================================================================
 * 『くねくねバトル オンライン』Phase 5 メインオーケストレーター (main.js)
 * ・AgentSDK 8人マルチプレイ ＆ 42体AI（計50体）完全結合
 * ・Host-Authoritative AI（ホスト主権AI ＆ ゲスト受信補間）
 * ・マルチプレイロビー（公開/プライベート部屋作成・参加・一覧更新）
 * ・マッチング待機室（参加者スロット同期 ＆ ホストゲーム開始権限）
 * ・10Hz 送出ループ（自機 ＋ ホスト管理AI 14体時分割インターリーブ相乗り）
 * ・餌取得・散布肉片同期 ＆ ゼロアロケーション空間ハッシュ衝突判定
 * ==============================================================================
 */

import { injectStyles } from './style.js';
injectStyles();

import { mountDOM } from './dom.js';
mountDOM();

import {
    MAP_SIZE,
    TOTAL_SNAKES,
    SAFE_INSET_TOP_GRAVITY,
    SAFE_INSET_TOP_WEB,
    SNAKE_COLORS
} from './constants.js';

import { Sound } from './audio.js';
import { InputManager } from './input.js';
import { HUDManager } from './hud.js';
import { Danmaku } from './danmaku.js';
import { Menu } from './menu.js';

import { Snake } from './snake.js';
import { SpatialCollisionEngine } from './combat.js';
import { WorldManager } from './world.js';
import { AIManager } from './ai.js';
import { NetworkManager } from './network.js';

// --- プラットフォーム環境検知 ---
export const PlatformDetector = {
    inGravity: false,
    hasAgentSDK: false,
    check() {
        this.hasAgentSDK = typeof window.AgentSDK !== 'undefined';
        this.inGravity = this.hasAgentSDK || (window.parent && window.parent !== window) || /gravity/i.test(navigator.userAgent);
    }
};
PlatformDetector.check();

// --- 画面リサイズとセーフエリア管理 ---
function updateLayout() {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const root = document.documentElement;
    if (PlatformDetector.inGravity) {
        root.style.setProperty('--safe-top', `${SAFE_INSET_TOP_GRAVITY}px`);
        root.style.setProperty('--safe-bottom', '24px');
    } else {
        root.style.setProperty('--safe-top', `${SAFE_INSET_TOP_WEB}px`);
        root.style.setProperty('--safe-bottom', '20px');
    }
}
window.addEventListener('resize', updateLayout);
updateLayout();

// --- iOS WebKit ブラウザジェスチャー遮断 ---
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', (e) => e.preventDefault(), { passive: false });

// --- ゲームエンジンコア初期化 ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d', { alpha: false });

const input = new InputManager();
input.init(canvas, (isBoosting) => {
    if (isBoosting) {
        Sound.startBoostSound();
    } else {
        Sound.stopBoostSound();
    }
});

const hud = new HUDManager();
hud.init();

Danmaku.init();

const collisionEngine = new SpatialCollisionEngine();
const world = new WorldManager();
const aiManager = new AIManager();

// --- エンティティ管理 ---
let player = new Snake(true, 0, 'あなた', SNAKE_COLORS[0], 'normal');
let remoteSnakes = new Map(); // slot (1..49) -> Snake instance
let allSnakes = [];
let sortedSnakes = [];

let gameState = 'lobby'; // 'lobby' | 'waiting' | 'playing' | 'gameover'
let gameStartTime = Date.now();
let frameCount = 0;
let cameraScale = 1.0;

// グローバル参照（network.js から 10Hz POS 送信時に参照）
window.localPlayerInstance = player;
window.allAISnakesInstance = aiManager.ais;

// --- 画面状態遷移ヘルパー ---
export const UIController = {
    showLobby() {
        gameState = 'lobby';
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const overScreen = document.getElementById('over-screen');
        const hudEl = document.getElementById('hud');

        if (lobby) lobby.style.display = 'flex';
        if (waiting) waiting.style.display = 'none';
        if (overScreen) overScreen.style.display = 'none';
        if (hudEl) hudEl.style.display = 'none';

        this.refreshLobbyGreeting();
    },

    showWaitingRoom(roomId) {
        gameState = 'waiting';
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const tag = document.getElementById('waiting-room-tag');
        const startBtn = document.getElementById('btn-waiting-start');

        if (lobby) lobby.style.display = 'none';
        if (waiting) waiting.style.display = 'flex';
        if (tag) tag.innerText = `ROOM #${String(roomId).slice(-5)}`;

        if (startBtn) {
            startBtn.style.display = NetworkManager.isHost ? 'block' : 'none';
        }

        this.updateWaitingMembersList();
    },

    showGame() {
        gameState = 'playing';
        const lobby = document.getElementById('lobby-overlay');
        const waiting = document.getElementById('waiting-overlay');
        const overScreen = document.getElementById('over-screen');
        const hudEl = document.getElementById('hud');

        if (lobby) lobby.style.display = 'none';
        if (waiting) waiting.style.display = 'none';
        if (overScreen) overScreen.style.display = 'none';
        if (hudEl) hudEl.style.display = 'flex';
    },

    refreshLobbyGreeting() {
        const greeting = document.getElementById('lobby-greeting');
        if (greeting && NetworkManager.myUser) {
            greeting.innerText = `ようこそ ${NetworkManager.myUser.name} さん`;
        }
    },

    updateWaitingMembersList() {
        const listEl = document.getElementById('waiting-members-list');
        if (!listEl) return;

        listEl.innerHTML = NetworkManager.slots.slice(0, 8).map(s => {
            const isMe = s.slot === NetworkManager.mySlot;
            const isHost = s.slot === 0;
            const badgeText = isMe ? 'YOU' : (s.isAI ? 'CPU' : `P${s.slot + 1}`);

            return `
                <div class="waiting-slot">
                    <div class="waiting-slot-left">
                        <div class="waiting-slot-badge" style="background-color: ${s.color};">${badgeText}</div>
                        <div class="waiting-slot-name">${s.name} ${isMe ? '(あなた)' : ''}</div>
                    </div>
                    ${isHost ? '<div class="waiting-slot-host">HOST</div>' : ''}
                </div>
            `;
        }).join('');
    }
};

// --- ゲーム初期化 ---
function initGame() {
    UIController.showGame();

    gameStartTime = Date.now();
    frameCount = 0;

    // 自機リセット
    const spawnX = MAP_SIZE / 2 + (Math.random() - 0.5) * 4000;
    const spawnY = MAP_SIZE / 2 + (Math.random() - 0.5) * 4000;
    player.reset(spawnX, spawnY);
    player.name = NetworkManager.myUser.name || 'あなた';
    player.color = SNAKE_COLORS[NetworkManager.mySlot % SNAKE_COLORS.length];

    // AI 42体初期化（ホスト端末のみ物理シミュレーション）
    aiManager.init(42, player.x, player.y);
    window.allAISnakesInstance = aiManager.ais;

    // リモートスネーク初期化
    remoteSnakes.clear();

    // 全スネーク配列構築
    allSnakes = [player, ...aiManager.ais];
    sortedSnakes = [...allSnakes];

    // ワールドリセット
    world.clear();

    // 走者一覧更新
    Menu.updateParticipants(NetworkManager.slots.filter(s => !s.isAI));
}

// --- マルチプレイ通信コールバック登録 ---
NetworkManager.setCallbacks({
    // 他プレイヤー / ホストAIのスネーク座標受信
    onRemoteSnakeUpdate(data) {
        if (data.slot === NetworkManager.mySlot) return;

        let remote = remoteSnakes.get(data.slot);
        if (!remote) {
            const isPlayerSlot = data.slot < 8;
            const color = SNAKE_COLORS[data.slot % SNAKE_COLORS.length];
            const name = NetworkManager.slots[data.slot] ? NetworkManager.slots[data.slot].name : (isPlayerSlot ? `P${data.slot + 1}` : `CPU ${data.slot - 7}`);

            remote = new Snake(false, data.slot, name, color, 'normal');
            remote.reset(data.x, data.y);
            remoteSnakes.set(data.slot, remote);

            // allSnakes に追加（既存AIスロットと置換または追加）
            if (!allSnakes.includes(remote)) {
                allSnakes.push(remote);
            }
        }

        // 状態同期 ＆ 補間ターゲット設定
        remote.targetNetX = data.x;
        remote.targetNetY = data.y;
        remote.targetAngle = data.angle;
        remote.speed = data.speed;
        remote.targetLength = data.length;
        remote.score = data.score;
        remote.isBoosting = data.isBoosting;
        remote.isDead = data.isDead;
        remote.kills = data.kills;
        remote.recalculateSize();
    },

    // 餌取得同期
    onFoodPicked(pick) {
        const key = `${pick.gx}_${pick.gy}`;
        const list = world.foodGrid.get(key);
        if (list && list[pick.index]) {
            list.splice(pick.index, 1);
        }
    },

    // 散布肉片同期
    onDropSpawned(drop) {
        world.dropFoods.push({
            x: drop.x,
            y: drop.y,
            val: drop.val,
            size: 7,
            isBig: true,
            color: SNAKE_COLORS[drop.colorIdx % SNAKE_COLORS.length]
        });
    },

    // シード値受信（ワールド同期）
    onSeedReceived(seed) {
        world.clear();
        Danmaku.push('同期', 'ワールドシードを同期しました', '#00e5ff', true);
    }
});

// --- UIイベントバインド ---

// 1. ロビー画面
const btnLobbySolo = document.getElementById('btn-lobby-solo');
if (btnLobbySolo) {
    btnLobbySolo.onclick = () => {
        NetworkManager.isMultiplayerActive = false;
        NetworkManager.isHost = true;
        NetworkManager.mySlot = 0;
        initGame();
    };
}

const btnLobbyPublic = document.getElementById('btn-lobby-public');
if (btnLobbyPublic) {
    btnLobbyPublic.onclick = async () => {
        btnLobbyPublic.innerText = '作成中...';
        const roomId = await NetworkManager.createRoom(false);
        btnLobbyPublic.innerText = '公開ルーム作成';
        if (roomId) {
            UIController.showWaitingRoom(roomId);
        }
    };
}

const btnLobbyPrivate = document.getElementById('btn-lobby-private');
if (btnLobbyPrivate) {
    btnLobbyPrivate.onclick = async () => {
        btnLobbyPrivate.innerText = '作成中...';
        const roomId = await NetworkManager.createRoom(true);
        btnLobbyPrivate.innerText = 'プライベート作成';
        if (roomId) {
            UIController.showWaitingRoom(roomId);
        }
    };
}

const btnRefreshRooms = document.getElementById('btn-refresh-rooms');
if (btnRefreshRooms) {
    btnRefreshRooms.onclick = async () => {
        btnRefreshRooms.innerText = '更新中...';
        const rooms = await NetworkManager.getPublicRooms();
        btnRefreshRooms.innerText = '更新';

        const container = document.getElementById('room-list-container');
        if (!container) return;

        if (!rooms || rooms.length === 0) {
            container.innerHTML = '<div class="room-list-empty">公開ルームはありません</div>';
            return;
        }

        container.innerHTML = rooms.map(r => `
            <div class="room-item">
                <div class="room-item-info">
                    <span class="room-item-id">ROOM #${String(r.room_id).slice(-5)}</span>
                    <span class="room-item-count">参加者: ${r.gamer_num || 1} / 8名</span>
                </div>
                <button type="button" class="btn-join-room" data-room="${r.room_id}">参加</button>
            </div>
        `).join('');

        container.querySelectorAll('.btn-join-room').forEach(btn => {
            btn.onclick = async () => {
                const rid = btn.dataset.room;
                btn.innerText = '入室中...';
                const success = await NetworkManager.joinRoom(rid);
                if (success) {
                    UIController.showWaitingRoom(rid);
                } else {
                    btn.innerText = '満員';
                }
            };
        });
    };
}

// 2. マッチング待機室画面
const btnWaitingStart = document.getElementById('btn-waiting-start');
if (btnWaitingStart) {
    btnWaitingStart.onclick = () => {
        if (!NetworkManager.isHost) return;
        initGame();
    };
}

const btnWaitingLeave = document.getElementById('btn-waiting-leave');
if (btnWaitingLeave) {
    btnWaitingLeave.onclick = async () => {
        await NetworkManager.exitRoom();
        UIController.showLobby();
    };
}

// 3. インゲーム・カスタム着せ替え
Menu.init((face, color) => {
    player.face = face;
    player.color = color;
    Danmaku.push('システム', 'アバターを変更しました', '#ffdd00', true);
});

// 4. サウンド切替
const soundBtn = document.getElementById('btn-sound');
if (soundBtn) {
    soundBtn.onclick = (e) => {
        e.stopPropagation();
        const isMuted = Sound.toggleMute();
        soundBtn.classList.toggle('sound-on', !isMuted);
        const iconOff = document.getElementById('icon-sound-off');
        const iconOn = document.getElementById('icon-sound-on');
        if (iconOff) iconOff.style.display = isMuted ? 'block' : 'none';
        if (iconOn) iconOn.style.display = isMuted ? 'none' : 'block';
    };
}

// 5. リザルト画面
const btnRetry = document.getElementById('btn-retry');
if (btnRetry) {
    btnRetry.onclick = () => {
        if (NetworkManager.isMultiplayerActive) {
            UIController.showWaitingRoom(NetworkManager.currentRoomId);
        } else {
            initGame();
        }
    };
}

const btnSubmit = document.getElementById('btn-submit-score');
if (btnSubmit) {
    btnSubmit.onclick = () => {
        try {
            if (window.parent) {
                window.parent.postMessage({
                    type: 'gameOver',
                    score: Math.floor(player.score)
                }, '*');
                Danmaku.push('システム', '得点を送信しました！', '#34d399', true);
            }
        } catch (err) {
            console.warn('Score submission error:', err);
        }
    };
}

// ゲームオーバー処理
function handleGameOver() {
    gameState = 'gameover';
    Sound.stopBoostSound();
    Sound.playCrash();

    const overScreen = document.getElementById('over-screen');
    if (!overScreen) return;

    const rank = sortedSnakes.filter(s => !s.isDead).findIndex(s => s === player) + 1 || sortedSnakes.length;
    const duration = Math.floor((Date.now() - gameStartTime) / 1000);

    document.getElementById('res-rank').innerText = `${rank} 位`;
    document.getElementById('res-score').innerText = Math.floor(player.score);
    document.getElementById('res-kills').innerText = player.kills;
    document.getElementById('res-time').innerText = `${duration} 秒`;
    document.getElementById('res-size').innerText = Math.floor(player.maxSize);

    overScreen.style.display = 'flex';
}

// --- DM招待リンク自動合流チェック ---
async function checkAutoJoinLink() {
    try {
        await NetworkManager.init();
        UIController.refreshLobbyGreeting();

        if (window.AgentSDK && window.AgentSDK.room && typeof window.AgentSDK.room.getRoomId === 'function') {
            const res = await window.AgentSDK.room.getRoomId();
            const targetRoomId = (res && typeof res.room_id === 'string')
                ? res.room_id
                : (res && res.data && typeof res.data.room_id === 'string' ? res.data.room_id : '');

            if (targetRoomId && targetRoomId !== '') {
                console.log(`[AutoJoin] DM招待リンク検知: Room #${targetRoomId} へ自動合流開始`);
                const success = await NetworkManager.joinRoom(targetRoomId);
                if (success) {
                    UIController.showWaitingRoom(targetRoomId);
                    return;
                }
            }
        }
    } catch (err) {
        console.warn('[AutoJoin] 自動合流エラー:', err);
    }
    UIController.showLobby();
}

// --- メインゲームループ ---
function gameLoop() {
    requestAnimationFrame(gameLoop);
    frameCount++;

    if (gameState === 'playing') {
        // 1. 自機物理更新
        let inputAngle = null;
        if (input.active && (input.x !== 0 || input.y !== 0)) {
            inputAngle = Math.atan2(input.y, input.x);
        }
        player.updatePhysics(inputAngle, input.boost);

        // 2. リモートスネークの滑らかな線形補間（推測航法）
        remoteSnakes.forEach(remote => {
            if (remote.isDead) return;
            if (remote.targetNetX !== undefined && remote.targetNetY !== undefined) {
                const distSq = (remote.targetNetX - remote.x) ** 2 + (remote.targetNetY - remote.y) ** 2;
                if (distSq > 160000) {
                    remote.x = remote.targetNetX;
                    remote.y = remote.targetNetY;
                } else {
                    remote.x += (remote.targetNetX - remote.x) * 0.25;
                    remote.y += (remote.targetNetY - remote.y) * 0.25;
                }
            }
            remote.updatePhysics(remote.targetAngle, remote.isBoosting);
        });

        // 3. AI更新（Host-Authoritative: ホストまたはソロのみ実行）
        if (!NetworkManager.isMultiplayerActive || NetworkManager.isHost) {
            aiManager.update(player, allSnakes, frameCount);
        }

        // 4. 視界カリング計算
        const viewRange = (canvas.width / cameraScale) * 1.5;
        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s === player) continue;
            const dist = Math.hypot(s.x - player.x, s.y - player.y);
            s.isVisible = dist < viewRange;
        }

        // 5. 動的チャンク餌生成 ＆ パーティクル更新
        world.updateChunks(player.x, player.y, viewRange);
        world.updateParticles();

        // 6. 餌捕食判定
        for (let i = 0; i < allSnakes.length; i++) {
            const s = allSnakes[i];
            if (s.isDead || !s.isVisible) continue;
            world.checkFoodConsumption(s, (eater, food) => {
                if (eater.isPlayer) {
                    if (food.isBig) Sound.playEatBig();
                    else Sound.playEatSmall();
                }
            });
        }

        // 7. 空間ハッシュ衝突判定
        collisionEngine.registerBodies(allSnakes);
        collisionEngine.checkHeadCollisions(allSnakes, (killer, victim) => {
            world.spawnDeathDrop(victim);
            if (victim.isPlayer) {
                handleGameOver();
            } else if (killer.isPlayer) {
                Sound.playCrash();
                Danmaku.push('撃破！', `${victim.name} を倒した！ (+150)`, '#ff3366');
            }
        });

        // 8. 定期ソート ＆ ランキングHUD更新（10フレーム周期）
        if (frameCount % 10 === 0) {
            sortedSnakes = [...allSnakes].sort((a, b) => b.score - a.score);
            const myRank = sortedSnakes.filter(s => !s.isDead).findIndex(s => s === player) + 1;
            const totalAlive = sortedSnakes.filter(s => !s.isDead).length;
            hud.updateStats(myRank || 1, totalAlive, player.score);

            const listEl = document.getElementById('leaderboard-list');
            if (listEl && listEl.parentElement.style.display !== 'none') {
                const topList = sortedSnakes.filter(s => !s.isDead).slice(0, 8);
                listEl.innerHTML = topList.map((s, idx) => `
                    <div style="display:flex; justify-content:space-between; color:${s === player ? '#ffdd00' : '#ffffff'}; font-weight:${s === player ? 'bold' : 'normal'};">
                        <span>${idx + 1}. ${s.name}</span>
                        <span>${Math.floor(s.score)}</span>
                    </div>
                `).join('');
            }
        }
    }

    // カメラズーム計算
    const baseTargetScale = 60.0 / (60.0 + (player.size - 12) * 0.85);
    const finalTargetScale = baseTargetScale * input.zoomMultiplier;
    cameraScale += (finalTargetScale - cameraScale) * 0.05;

    // --- 描画処理 ---
    ctx.fillStyle = '#0b051a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing' || gameState === 'gameover') {
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(cameraScale, cameraScale);
        ctx.translate(-player.x, -player.y);

        const viewW = canvas.width / cameraScale;
        const viewH = canvas.height / cameraScale;
        const cameraLeft = player.x - viewW / 2;
        const cameraTop = player.y - viewH / 2;

        // 宇宙グリッド線
        const step = 200;
        const startX = Math.floor(cameraLeft / step) * step;
        const endX = startX + viewW + step * 2;
        const startY = Math.floor(cameraTop / step) * step;
        const endY = startY + viewH + step * 2;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let x = startX; x < endX; x += step) {
            ctx.moveTo(x, startY); ctx.lineTo(x, endY);
        }
        for (let y = startY; y < endY; y += step) {
            ctx.moveTo(startX, y); ctx.lineTo(endX, y);
        }
        ctx.stroke();

        // 宇宙外壁境界線
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 8;
        ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

        // 餌 ＆ パーティクル描画
        world.draw(ctx, cameraLeft, cameraTop, viewW, viewH, frameCount);

        // スネーク描画
        for (let i = sortedSnakes.length - 1; i >= 0; i--) {
            const s = sortedSnakes[i];
            if (s === player || s.isVisible) {
                s.draw(ctx, frameCount, cameraScale);
            }
        }

        ctx.restore();

        // ミニマップ直接描画
        const safeTop = PlatformDetector.inGravity ? SAFE_INSET_TOP_GRAVITY : SAFE_INSET_TOP_WEB;
        hud.drawRadar(ctx, canvas.width, safeTop, player, sortedSnakes, MAP_SIZE);
    }
}

// 起動シーケンス開始
checkAutoJoinLink();
requestAnimationFrame(gameLoop);