// net_protocol.js: ゼロアロケーション純粋算術丸め・ビットマスク・極小タプルパッカー専用モジュール
// ★ 4人プレイ拡張版（緑チーム追加）：
//   1. getTeamIdBySlot(slot) に slot === 3 -> 'green' を追加（4色完全対応）。
//   2. 外部依存ゼロの純粋関数群・ゼロアロケーション純粋算術丸め（round1/round2）の完全維持。
//   3. 11要素タプルパック・透過デコードの100%維持。

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