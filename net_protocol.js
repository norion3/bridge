// net_protocol.js: ゼロアロケーション純粋算術丸め・ビットマスク・極小タプルパッカー専用モジュール
// ★ network.js から計算・配列シリアライズロジックを完全分離（Package 3）
//   1. 【外部依存ゼロの純粋関数群】
//      Three.js や DOM、ネットワークソケットに一切依存せず、単体での信頼性と可読性を最大化。
//   2. 【ゼロアロケーション純粋算術丸め】
//      round1（10cm単位）、round2（1cm/0.01rad単位）による一時文字列オブジェクト生成ゼロ化。
//   3. 【11要素タプルパック・透過デコード】
//      走者座標・ステータスフラグ（5種ビットマスク）・ギミック状態の相互変換。

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
 * スロット番号に応じたチームカラーID取得ヘルパー
 */
export function getTeamIdBySlot(slot) {
  if (slot === 0) return 'blue';
  if (slot === 1) return 'red';
  if (slot === 2) return 'yellow';
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