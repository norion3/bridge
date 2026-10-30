// ==============================================================================
// 『くねくねバトル オンライン』マルチプレイ通信プロトコル ＆ 極小タプルパッカー (net_protocol.js)
// ・ゼロアロケーション純粋算術丸め（文字列インスタンス生成ゼロ）
// ・スネーク走者9要素タプル規格（1人あたり約32バイト、1KB制限完全クリア）
// ・餌取得・散布肉片・チャットの極小タプルシリアライザー
// ==============================================================================

// --- 高速・ゼロアロケーション純粋算術丸めヘルパー ---
export const round1 = (val) => Math.round(val * 10) / 10;
export const round2 = (val) => Math.round(val * 100) / 100;

// --- クライアント固有の一意ID生成 ---
export function generateClientId() {
    return 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
}

/**
 * スネーク走者オブジェクトを9要素の極小タプル配列へエンコード
 * 形式: [slot, x, y, angle, speed, length, score, flags, kills]
 * 
 * @param {Object} snake スネークインスタンス
 * @param {number} slot スロット番号 (0〜49)
 * @param {boolean} isHost ホスト端末フラグ
 * @returns {Array} 9要素タプル配列
 */
export function encodeSnakeToTuple(snake, slot, isHost = false) {
    let flags = 0;
    if (snake.isBoosting) flags |= 1;  // Bit 0: ブースト加速中
    if (snake.isDead)     flags |= 2;  // Bit 1: 死亡
    if (isHost)           flags |= 4;  // Bit 2: ルームホスト
    if (!snake.isPlayer)  flags |= 8;  // Bit 3: 自律AI

    return [
        slot,
        round1(snake.x),
        round1(snake.y),
        round2(snake.angle),
        round1(snake.speed),
        Math.floor(snake.targetLength || 10),
        Math.floor(snake.score || 50),
        flags,
        Math.floor(snake.kills || 0)
    ];
}

/**
 * 9要素タプル配列を受信側オブジェクトへデコード
 * 
 * @param {Array} tuple 9要素タプル配列
 * @returns {Object} デコード済みスネーク情報
 */
export function decodeTupleToSnake(tuple) {
    if (!Array.isArray(tuple)) return tuple;

    const slot = tuple[0];
    const x = tuple[1];
    const y = tuple[2];
    const angle = tuple[3];
    const speed = tuple[4];
    const length = tuple[5];
    const score = tuple[6];
    const flags = tuple[7] || 0;
    const kills = tuple[8] || 0;

    return {
        slot: slot,
        x: x,
        y: y,
        angle: angle,
        speed: speed,
        length: length,
        score: score,
        isBoosting: Boolean(flags & 1),
        isDead: Boolean(flags & 2),
        isHost: Boolean(flags & 4),
        isAI: Boolean(flags & 8),
        kills: kills
    };
}

/**
 * 餌取得イベントを3要素タプルへエンコード
 * 形式: [gx, gy, foodIndex]
 */
export function packFoodPickTuple(gx, gy, foodIndex) {
    return [gx, gy, foodIndex];
}

/**
 * 餌取得タプルを受信側形式へデコード
 */
export function unpackFoodPickTuple(tuple) {
    if (!Array.isArray(tuple)) return tuple;
    return {
        gx: tuple[0],
        gy: tuple[1],
        index: tuple[2]
    };
}

/**
 * 死亡時・ブースト散布肉片を4要素タプルへエンコード
 * 形式: [x, y, val, colorIdx]
 */
export function packDropFoodTuple(x, y, val, colorIdx = 0) {
    return [
        round1(x),
        round1(y),
        Math.floor(val),
        colorIdx
    ];
}

/**
 * 散布肉片タプルを受信側形式へデコード
 */
export function unpackDropFoodTuple(tuple) {
    if (!Array.isArray(tuple)) return tuple;
    return {
        x: tuple[0],
        y: tuple[1],
        val: tuple[2],
        colorIdx: tuple[3] || 0
    };
}

/**
 * チャットパケットを2要素タプルへエンコード
 * 形式: [slot, message]
 */
export function packChatTuple(slot, message) {
    const cleanMsg = String(message || '').trim().slice(0, 15);
    return [slot, cleanMsg];
}

/**
 * チャットタプルを受信側形式へデコード
 */
export function unpackChatTuple(tuple) {
    if (!Array.isArray(tuple)) return tuple;
    return {
        slot: tuple[0],
        message: tuple[1]
    };
}