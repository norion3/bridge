// チーム設定、コース構成規格、およびエレベーター・スカイダイブ・トラップドア物理・カメラ定数
export const TEAMS = {
  // ★ 自キャラ（青）を白飛びするシアンから鮮烈で力強い「ヴィヴィッド・ロイヤルブルー」へ刷新
  BLUE: { id: 'blue', name: 'あなた (青)', hex: 0x0066ff, emissive: 0x1d4ed8 },
  RED: { id: 'red', name: '赤Bot', hex: 0xef4444, emissive: 0xb91c1c },
  YELLOW: { id: 'yellow', name: '黄Bot', hex: 0xf59e0b, emissive: 0xb45309 },
  NEUTRAL: { id: 'neutral', name: '中立', hex: 0x94a3b8, emissive: 0x475569 }
};

export const BLOCK_TYPES = [TEAMS.BLUE, TEAMS.RED, TEAMS.YELLOW];
export const MAX_VISUAL_STACK = 20;

export const TRAMPOLINE_TIERS = {
  normal: {
    id: 'normal',
    name: '標準ジャンプ',
    height: 10.0,
    speedRate: 1.33,
    ringColor: 0x10b981,
    targetColor: 0x4ade80,
    targetEmissive: 0x22c55e,
    dip: -0.15,
    shockRadius: 1.5,
    rotations: 1.0,
    camFov: 60
  },
  high: {
    id: 'high',
    name: 'ハイジャンプ',
    height: 18.5,
    speedRate: 0.87,
    ringColor: 0xf97316,
    targetColor: 0xfacc15,
    targetEmissive: 0xeab308,
    dip: -0.24,
    shockRadius: 2.6,
    rotations: 1.5,
    camFov: 66
  },
  mega: {
    id: 'mega',
    name: 'スーパージャンプ',
    height: 30.0,
    speedRate: 0.60,
    ringColor: 0xd946ef,
    targetColor: 0x38bdf8,
    targetEmissive: 0x0284c7,
    dip: -0.36,
    shockRadius: 4.2,
    rotations: 2.0,
    camFov: 78
  }
};

export const LANES = [-4.0, 0, 4.0];
export const PLANK_LENGTH = 1.6;

// ステージ種別識別子
export const STAGE_TYPES = {
  BRIDGE: 'bridge',
  JUMP: 'jump',
  SLIDE: 'slide',
  CURVED_SLIDE: 'curved_slide',
  VERTICAL: 'vertical',
  ZIPLINE: 'zipline',
  ELEVATOR: 'elevator',
  SKYDIVE: 'skydive',       // 頭先行高速ダイビング（前進放物線）
  TRAPDOOR: 'trapdoor'      // 足先行ドロップタワー（爆速垂直急降下）
};

// エレベーター仕様定数（オープン展望リフト規格）
export const ELEVATOR_CONFIG = {
  LANES: [
    { laneIdx: 0, speedTier: 'fast', duration: 2.6, label: 'FAST (2.6s)', colorHex: 0x10b981, emissiveHex: 0x059669 },
    { laneIdx: 1, speedTier: 'mid',  duration: 4.0, label: 'MID (4.0s)',  colorHex: 0xfacc15, emissiveHex: 0xeab308 },
    { laneIdx: 2, speedTier: 'slow', duration: 5.6, label: 'SLOW (5.6s)', colorHex: 0xef4444, emissiveHex: 0xb91c1c }
  ],
  EASING: {
    accelPhase: 0.16,
    decelPhase: 0.20,
    arrivalBounceHeight: 0.08,
    exitDelay: 0.35 // 上の島到着後の下車歩行トランジション時間
  },
  LIFT: {
    platformWidth: 2.4,
    platformDepth: 2.0,
    handrailHeight: 0.95,
    cableRadius: 0.025
  }
};

// ★ 看板ステージ1：スカイダイブ仕様定数（頭先行・高速滑空・前進放物線）
export const SKYDIVE_CONFIG = {
  PHYSICS: {
    minHeightDrop: 30.0,            // 垂直落差 (-30m)
    forwardDistance: 36.0,          // 前進距離 (伸びやかな放物線)
    totalDuration: 2.3,             // 滞空飛行時間（秒）
    gravityPower: 2.0,              // 重力加速カーブ（滑らかな放物線）
    horizontalAirControlSpeed: 10.0,// 左右エアコントロール速度
    maxAirOffsetX: 4.8,             // 左右最大シフト幅
    maxRollAngle: Math.PI * 0.18    // 左右スワイプ時の最大バンク角（ロール傾き 約32度）
  },
  CATAPULT: {
    length: 5.2,                    // ダイブ台突き出し長
    width: 3.6,                     // スロープ幅
    slopeAngle: 0.12,               // 前方下り傾斜
    exclusionRadius: 4.8            // ダイブ台周辺の床ブロック生成禁止半径
  }
};

// ★ 看板ステージ2：ドロップタワー・スカイゲート仕様定数（爆速1.2秒・垂直急降下・スリル最大化）
export const TRAPDOOR_CONFIG = {
  PHYSICS: {
    minHeightDrop: 38.0,            // 圧倒的な垂直落差 (-38m)
    forwardDistance: 10.0,          // 前進距離を極限まで抑えた垂直落下
    totalDuration: 1.2,             // ★ 2.1秒から1.2秒へ爆速化（初速からストンと落ちる絶叫速度）
    gravityPower: 1.6,              // ★ t^2.8 から t^1.6 へ変更（開始直後から一気に重力加速）
    horizontalAirControlSpeed: 7.5, // 左右エアスライド速度（直立維持）
    maxAirOffsetX: 3.4              // 空中微調整の最大左右幅
  },
  HATCH: {
    size: 3.6,                      // ドロップタワー・スカイデッキ直径
    deckRadius: 2.8,                // せり出し強化ガラスデッキ半径
    pylonHeight: 7.5,               // ツインタワー柱の高さ
    doorOpenAngle: Math.PI * 0.48,  // ガラス扉の下方開放角
    openDuration: 0.14,             // 扉開放所要時間（瞬時開放）
    exclusionRadius: 5.0            // 施設周辺の床ブロック生成禁止半径
  },
  // ★ ハイ・クォーター・パノラマカメラ定数（爆速1.2秒急降下にジャストフィット）
  CAMERA: {
    offsetX: 5.5,                   // 自キャラの右斜め後方 +5.5m（キャラを画面左上に配置）
    offsetY: 6.5,                   // 高さ +6.5m
    offsetZ: 8.0,                   // 後方 +8.0m
    lookOffsetX: 0.0,               // 注視点 X
    lookOffsetY: -2.5,              // 注視点 Y（水平線と着地島の中間を注視）
    lookAheadZ: -18.0,              // 前方奥 -18.0m
    lagPhase1Duration: 0.20,        // Phase 1: 開放直後の上空置き去り遅延時間（1.2秒に合わせ0.20秒）
    fovStart: 62,                   // 開始時FOV
    fovDrop: 76                     // 追従加速時FOV（ワイドパノラマ）
  }
};

// 既存コードとの後方互換用エイリアス
export const FREEFALL_CONFIG = TRAPDOOR_CONFIG;

// アイテム固有カラー
export const ITEM_COLORS = {
  SPEED: { hex: 0xfde047, emissive: 0xeab308 },
  ATTACK: { hex: 0xf43f5e, emissive: 0xd946ef },
  // ★ 磁石アイテム：美しい12面体幾何学ジュエル用ネオンパープル
  MAGNET: { hex: 0xc084fc, emissive: 0x9333ea, beaconHex: 0xd8b4fe }
};