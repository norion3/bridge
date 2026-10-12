// チーム設定、コース構成規格、およびエレベーター・スカイダイブ・トラップドア物理・カメラ定数
export const TEAMS = {
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

// エレベーター仕様定数（オープン展望ホバーリフト規格・ワイヤー撤去）
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
    handrailHeight: 0.95
  }
};

// ★ 看板ステージ1：スカイダイブ仕様定数（頭先行・高速滑空・前進52m/落差-42m/3.1秒）
export const SKYDIVE_CONFIG = {
  PHYSICS: {
    minHeightDrop: 42.0,            // 雄大な垂直落差 (-42m)
    forwardDistance: 52.0,          // 雄大な前進距離 (時速86kmを維持する伸びやかな放物線)
    totalDuration: 3.1,             // 滞空飛行時間（3.1秒：アクションをたっぷり堪能）
    gravityPower: 2.0,              // 重力加速カーブ（滑らかな放物線）
    horizontalAirControlSpeed: 10.0,// 左右エアコントロール速度
    maxAirOffsetX: 4.8,             // 左右最大シフト幅
    maxRollAngle: Math.PI * 0.18    // 左右スワイプ時の最大バンク角（ロール傾き 約32度）
  },
  CATAPULT: {
    length: 7.2,                    // コースター発射台規格長（7.2mへ復元）
    width: 3.6,                     // スロープ幅
    slopeAngle: 0.12,               // 前方下り傾斜
    exclusionRadius: 5.5            // ダイブ台周辺の床ブロック生成禁止半径
  },
  // ★ ダイナミック・ロックオンカメラ
  CAMERA: {
    offsetY: 4.5,                   // 高すぎずキャラに追随
    offsetZ: 8.5,                   // キャラをしっかり視界に収める
    lookAheadZ: -28.0,              // パノラマを見晴らすための奥の注視点
    fovStart: 60,                   // 開始時FOV
    fovDrop: 78                     // 加速時ワイドFOVで猛スピード感を演出
  }
};

// ★ 看板ステージ2：ドロップタワー・スカイゲート仕様定数（超高層落差-58m・2.4秒自由落下）
export const TRAPDOOR_CONFIG = {
  PHYSICS: {
    minHeightDrop: 58.0,            // 圧倒的な超高層垂直落差 (-58m)
    forwardDistance: 12.0,          // 前進距離を抑えた垂直落下
    totalDuration: 2.4,             // 落下滞空時間（2.4秒：落ちるスリルを存分に魅せる）
    gravityPower: 1.6,              // 初速からストンと落ちる重力加速
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
  // ★ 斜め上クォーターチェイスカメラ（キャラを置き去りにせず、背景がぶっ飛ぶ）
  CAMERA: {
    offsetX: 4.5,                   // キャラを少し左にずらしつつ真後ろを避ける
    offsetY: 6.5,                   // 上から見守る高度
    offsetZ: 7.0,                   // 離れすぎずロックオン
    lookOffsetY: -2.5,              // 水平線と着地島の中間を注視
    lookAheadZ: -12.0,              // 前方奥
    lagPhase1Duration: 0.20,        // 開放直後の上空置き去り遅延時間
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
  MAGNET: { hex: 0xc084fc, emissive: 0x9333ea, beaconHex: 0xd8b4fe }
};