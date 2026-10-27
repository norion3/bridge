// net_protocol.js: ゼロアロケーション純粋算術丸め・ビットマスク・極小タプルパッカー専用モジュール
// ★ マルチプレイ通信最適化・ブロック取得（pk）2要素タプル規格統合版（推奨案A / Phase 1）：
//   1. 【ブロック取得タプル化（packPickTuple / unpackPickTuple）】
//      形式: [stageIdx, idNum | rawId]
//      JSONオブジェクト（約52バイト）から極小配列（約8バイト）へ約84.6%の通信量削減を実現。
//      通常ブロック（b_0_42等）は数値部（42）のみをパックし、散乱ブロック等の特殊IDも完全可逆保護。
//   2. 【ブロック5要素タプル化（packBlockTuple / unpackBlockTuple）の完全維持】
//      形式: [stageIdx, x, z, teamCode, idNum]
//   3. 【チームカラーコード・フロアアイテム用タプル規格の完全維持】
//   4. 【走者11要素タプル・純粋算術丸めヘルパー（round1 / round2）の100%維持】

// --- 高速・ゼロアロケーション純粋算術丸めヘルパー（文字列インスタンス生成ゼロ） ---
export const round1 = (val) => Math.round(val * 10) / 10;
export const round2 = (val) => Math.round(val * 100) / 100;

// --- アクション状態IDおよびビットマスク定数マッピング ---
export const ACTION_STATE_TO_ID = {
  NORMAL: 0,
  JUMP: 1,
  SKYDIVE: 2,
  ELEVATOR: 3,
  TRAPDOOR: 4,
  ZIPLINE: 5,
  SLIDE: 6
};

export const ID_TO_ACTION_STATE = [
  'NORMAL',
  'JUMP',
  'SKYDIVE',
  'ELEVATOR',
  'TRAPDOOR',
  'ZIPLINE',
  'SLIDE'
];

// --- チームカラーIDおよび整数コード対応マップ ---
export const TEAM_CODES = ['blue', 'red', 'yellow', 'green'];
export const TEAM_ID_TO_CODE = {
  blue: 0,
  red: 1,
  yellow: 2,
  green: 3
};

// --- フロアアイテム種別IDおよび整数コード対応マップ ---
export const ITEM_TYPE_CODES = ['magnet', 'speed', 'bomb'];
export const ITEM_TYPE_TO_CODE = {
  magnet: 0,
  speed: 1,
  bomb: 2
};

/**
 * スロット番号に応じたチームカラーID取得ヘルパー（4人対戦対応）
 */
export function getTeamIdBySlot(slot) {
  if (slot === 0) return 'blue';
  if (slot === 1) return 'red';
  if (slot === 2) return 'yellow';
  if (slot === 3) return 'green';
  return 'neutral';
}

/**
 * クライアント固有のランダムID生成ヘルパー
 */
export function generateClientId() {
  return 'client_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
}

/**
 * キャラクターの現在アクション状態判定
 */
export function getCharacterActionState(c) {
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
 * キャラクターオブジェクトを11要素の極小タプル配列へエンコード
 */
export function encodeCharacterToTuple(charObj, slotIndex, vx = 0, vz = 0) {
  const stateStr = getCharacterActionState(charObj);
  const stateId = ACTION_STATE_TO_ID[stateStr] !== undefined ? ACTION_STATE_TO_ID[stateStr] : 0;

  let flags = 0;
  if (charObj.speedBoostActive) flags |= 1;
  if (charObj.stunTimer > 0) flags |= 2;
  if (charObj.shrinkTimer > 0) flags |= 4;
  if (charObj.magnetActive) flags |= 8;
  if (charObj.invulnerableTimer > 0) flags |= 16;

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

  if (stateId === 3 && typeof charObj.elevatorLane === 'number') {
    tuple.push(charObj.elevatorLane);
  }

  return tuple;
}

/**
 * 11要素タプル配列を受信側オブジェクトへ透過デコード
 */
export function decodeTupleToCharacterPacket(item) {
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

/**
 * ブロック生成レコードを5要素タプル配列へエンコード
 * @param {Object} blockRecord { stageIdx, x, z, teamId, blockId }
 * @returns {Array} [s, x, z, t, idNum]
 */
export function packBlockTuple(blockRecord) {
  if (Array.isArray(blockRecord)) return blockRecord;

  const s = blockRecord.stageIdx || 0;
  const x = round1(blockRecord.x || 0);
  const z = round1(blockRecord.z || 0);
  const t = TEAM_ID_TO_CODE[blockRecord.teamId] !== undefined ? TEAM_ID_TO_CODE[blockRecord.teamId] : 0;

  // blockId ("b_0_42") から末尾の連番数値を抽出
  let idNum = 0;
  if (typeof blockRecord.blockId === 'string') {
    const lastUnderscore = blockRecord.blockId.lastIndexOf('_');
    if (lastUnderscore !== -1) {
      const numPart = parseInt(blockRecord.blockId.substring(lastUnderscore + 1), 10);
      if (!isNaN(numPart)) idNum = numPart;
    }
  } else if (typeof blockRecord.blockId === 'number') {
    idNum = blockRecord.blockId;
  }

  return [s, x, z, t, idNum];
}

/**
 * 5要素タプル配列（または旧オブジェクト）を受信側ブロック形式へデコード
 * @param {Array|Object} tuple [s, x, z, t, idNum] または旧オブジェクト
 * @returns {Object}
 */
export function unpackBlockTuple(tuple) {
  if (!Array.isArray(tuple)) {
    return tuple; // 旧オブジェクト互換
  }

  const s = tuple[0];
  const x = tuple[1];
  const z = tuple[2];
  const teamId = TEAM_CODES[tuple[3]] || 'blue';
  const idNum = tuple[4];
  const blockId = `b_${s}_${idNum}`;

  return {
    stageIdx: s,
    poolIdx: 0,
    x: x,
    y: undefined,
    z: z,
    teamId: teamId,
    blockId: blockId
  };
}

/**
 * フロアアイテム生成レコードを5要素タプル配列へエンコード
 * @param {Object} itemRecord { itemId, stageIdx, type, x, z }
 * @returns {Array} [itemId, stageIdx, typeCode, x, z]
 */
export function packItemTuple(itemRecord) {
  if (Array.isArray(itemRecord)) return itemRecord;

  const itemId = itemRecord.itemId || 0;
  const stageIdx = itemRecord.stageIdx || 0;
  const typeCode = ITEM_TYPE_TO_CODE[itemRecord.type] !== undefined ? ITEM_TYPE_TO_CODE[itemRecord.type] : 0;
  const x = round1(itemRecord.x || 0);
  const z = round1(itemRecord.z || 0);

  return [itemId, stageIdx, typeCode, x, z];
}

/**
 * フロアアイテム用タプルを受信側オブジェクトへデコード
 * @param {Array|Object} tuple
 * @returns {Object}
 */
export function unpackItemTuple(tuple) {
  if (!Array.isArray(tuple)) {
    return tuple;
  }

  return {
    itemId: tuple[0],
    stageIdx: tuple[1],
    type: ITEM_TYPE_CODES[tuple[2]] || 'magnet',
    x: tuple[3],
    z: tuple[4]
  };
}

/**
 * ブロック取得レコードを2要素タプル配列へエンコード
 * @param {number|Object} stageIdx ステージ番号、または取得レコードオブジェクト
 * @param {string|number} blockId ブロックID
 * @returns {Array} [stageIdx, idNum | rawId]
 */
export function packPickTuple(stageIdx, blockId = null) {
  if (Array.isArray(stageIdx)) return stageIdx; // 既にタプルの場合はパススルー

  let s = 0;
  let rawId = blockId;

  if (typeof stageIdx === 'object' && stageIdx !== null) {
    s = (stageIdx.s !== undefined) ? stageIdx.s : (stageIdx.stageIdx || 0);
    rawId = stageIdx.id || stageIdx.blockId || rawId;
  } else if (typeof stageIdx === 'number') {
    s = stageIdx;
  }

  if (typeof rawId === 'number') {
    return [s, rawId];
  }

  if (typeof rawId === 'string') {
    // "b_0_42" 形式の通常床ブロックは末尾の整数を抽出して極小化
    if (rawId.startsWith('b_')) {
      const lastUnderscore = rawId.lastIndexOf('_');
      if (lastUnderscore !== -1) {
        const numPart = parseInt(rawId.substring(lastUnderscore + 1), 10);
        if (!isNaN(numPart)) {
          return [s, numPart];
        }
      }
    }
    // 散乱ブロック ("s_0_...") などの特殊プレフィックスは文字列のまま安全保持
    return [s, rawId];
  }

  return [s, 0];
}

/**
 * ブロック取得タプル配列（または旧オブジェクト）を受信側形式へデコード
 * @param {Array|Object} tuple [stageIdx, idNum | rawId] または旧オブジェクト
 * @returns {Object} { s, id, pi, x, z }
 */
export function unpackPickTuple(tuple) {
  if (!Array.isArray(tuple)) {
    return tuple; // 旧オブジェクト互換
  }

  const s = tuple[0] || 0;
  const idVal = tuple[1];
  let blockId = '';

  if (typeof idVal === 'number') {
    blockId = `b_${s}_${idVal}`;
  } else if (typeof idVal === 'string') {
    blockId = idVal;
  } else {
    blockId = `b_${s}_0`;
  }

  return {
    s: s,
    id: blockId,
    pi: 0,
    x: 0,
    z: 0
  };
}