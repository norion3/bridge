// チーム設定、コース構成規格、およびエレベーター・スカイダイブ・ドロップタワー物理・カメラ定数
export const TEAMS = {
  // 自キャラ（青）を白飛びするシアンから鮮烈で力強い「ヴィヴィッド・ロイヤルブルー」へ設定
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
  SKYDIVE: 'skydive',       // 頭先行高速ダイビング（ジェットカタパルト射出）
  TRAPDOOR: 'trapdoor'      // 足先行ドロップタワー（垂直急速フリーフォール）
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

// スカイダイブ仕様定数（ジェットカタパルト・ランウェイ・頭先行高速滑空）
export const SKYDIVE_CONFIG = {
  PHYSICS: {
    minHeightDrop: 30.0,            // 垂直落差 (-30m)
    forwardDistance: 36.0,          // 前進距離 (放物線)
    totalDuration: 2.2,             // 滞空飛行時間（秒）
    gravityPower: 1.95,             // 重力加速カーブ（前進初速から滑らかな急降下）
    horizontalAirControlSpeed: 10.5,// 左右エアコントロール速度
    maxAirOffsetX: 4.8,             // 左右最大シフト幅
    maxRollAngle: Math.PI * 0.18    // 左右スワイプ時の最大バンク角（ロール傾き 約32度）
  },
  CATAPULT: {
    length: 5.6,                    // ランウェイ突き出し長
    width: 3.8,                     // 滑走路幅
    slopeAngle: 0.14,               // 前方下り傾斜
    exclusionRadius: 5.0            // ランウェイ周辺の床ブロック生成禁止半径
  }
};

// ドロップタワー仕様定数（足先行・急速垂直急降下・ラゲッジホールド）
export const TRAPDOOR_CONFIG = {
  PHYSICS: {
    minHeightDrop: 38.0,            // 垂直落差 (-38m)
    forwardDistance: 10.0,          // 前進距離を抑えた垂直直下落下
    totalDuration: 1.18,            // 爆速垂直落下時間（約1.2秒）
    gravityPower: 1.6,              // 初速から一気に引きずり込まれる重力カーブ
    horizontalAirControlSpeed: 7.5, // 左右エアスライド速度（直立維持）
    maxAirOffsetX: 3.4              // 空中微調整の最大左右幅
  },
  HATCH: {
    size: 3.6,                      // デッキ開口部サイズ
    deckRadius: 2.8,                // せり出し強化ガラスデッキ半径
    pylonHeight: 7.5,               // トラス支柱の高さ
    doorOpenAngle: Math.PI * 0.48,  // ガラス扉の下方開放角
    openDuration: 0.12,             // 扉開放所要時間（瞬時開放）
    exclusionRadius: 5.0            // 施設周辺の床ブロック生成禁止半径
  },
  // ラゲッジ・ホールド（落下突入時にブロックタワーを背中にキュッと収めるパッキング比率）
  LUGGAGE_HOLD: {
    scaleX: 0.40,                   // 水平幅縮小
    scaleY: 0.18,                   // 垂直高さ大幅圧縮（天高く伸びるタワーを瞬時にリュック化）
    scaleZ: 0.40,
    offsetY: 0.42,                  // 背中への吸着高さ
    offsetZ: -0.26                  // 背中への密着オフセット
  },
  // サイド・クォーターチェイスカメラ定数（上の島を一瞬で画面上部外へ置き去りにする）
  CAMERA: {
    offsetX: 5.2,                   // 自キャラの右斜め後方 +5.2m
    offsetY: 5.8,                   // 高さ +5.8m
    offsetZ: 7.5,                   // 後方 +7.5m
    lookOffsetX: 0.0,               // 注視点 X
    lookOffsetY: -3.2,              // 注視点 Y（深淵と水平線の中間を捉える）
    lookAheadZ: -20.0,              // 前方奥 -20.0m
    lagPhase1Duration: 0.14,        // Phase 1: 開放瞬間の上空切り離しディレイ（0.14秒）
    fovStart: 62,                   // 開始時FOV
    fovDrop: 78                     // 追従加速時FOV（広大な大気感）
  }
};

// 既存コードとの後方互換用エイリアス
export const FREEFALL_CONFIG = TRAPDOOR_CONFIG;

// アイテム固有カラー
export const ITEM_COLORS = {
  SPEED: { hex: 0xfde047, emissive: 0xeab308 },
  ATTACK: { hex: 0xf43f5e, emissive: 0xd946ef },
  MAGNET: { hex: 0xc084fc, emissive: 0x9333ea, beaconHex: 0xd8b4fe }
};