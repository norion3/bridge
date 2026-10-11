// チーム設定、コース構成規格、およびエレベーター・スカイダイブ・ドロップタワー物理・カメラ定数
export const TEAMS = {
  // 自キャラ（青）：白飛びするシアンから鮮烈で力強い「ヴィヴィッド・ロイヤルブルー」
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
  SKYDIVE: 'skydive',       // 前方高速滑空（ジェットカタパルト射出・放物線）
  TRAPDOOR: 'trapdoor'      // 垂直急速フリーフォール（ドロップタワーデッキ）
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

// =========================================================================
// 【最高峰刷新】スカイダイブ仕様定数
// 滞空時間 3.1秒 ＆ 前進52m・落差-42m（時速86kmを維持しながらたっぷり魅せる）
// =========================================================================
export const SKYDIVE_CONFIG = {
  PHYSICS: {
    minHeightDrop: 42.0,            // 垂直落差を -30m から -42m へ拡張
    forwardDistance: 52.0,          // 前進距離を 36m から 52m へ大幅拡大（空中直線距離 約67m）
    totalDuration: 3.1,             // 滞空時間を 2.2秒 から ジップライン並みの 3.1秒 へ伸長
    gravityPower: 1.85,             // 伸びやかな放物線急降下重力カーブ
    horizontalAirControlSpeed: 11.5,// 左右エアコントロール感度
    maxAirOffsetX: 5.2,             // 左右最大シフト幅
    maxRollAngle: Math.PI * 0.18    // 左右バンク角（ロール傾き 最大 ±32度）
  },
  CATAPULT: {
    length: 7.2,                    // 滑走路長を 5.6m から 7.2m へ延長（雄大な助走空間）
    width: 3.8,                     // 滑走路幅
    slopeAngle: 0.14,               // 前方下り傾斜
    exclusionRadius: 5.5            // ランウェイ周辺の床ブロック生成禁止半径
  },
  // 手すり遮蔽を100%根絶する3段タイムシフトカメラ
  CAMERA: {
    // Phase 1 (0.0s〜0.6s / prog < 0.19): カタパルト手前上空にその場固定（ステージ見送り）
    farewellProgLimit: 0.19,        // 0.6秒相当 (0.6 / 3.1)
    farewellOffsetX: 3.8,           // 横 +3.8m
    farewellOffsetY: 5.5,           // 高さ +5.5m
    farewellOffsetZ: 6.5,           // 後方 +6.5m（島側手前）
    lookAheadZ: -24.0,              // 前方注視点

    // Phase 2 (0.6s〜2.5s / 0.19 <= prog < 0.81): サイドワイドチェイス（並走ゾーン）
    chaseProgLimit: 0.81,           // 2.5秒相当 (2.5 / 3.1)
    chaseOffsetX: 5.2,              // 横 +5.2m
    chaseOffsetY: 4.2,              // 高さ +4.2m
    chaseOffsetZ: 8.2,              // 後方 +8.2m
    fovStart: 64,                   // 見送り時FOV
    fovChase: 78,                   // 滑空並走時ワイドFOV（雄大な空と海）
    fovLand: 66                     // 着地先回りFOV
  }
};

// =========================================================================
// 【最高峰刷新】ドロップタワー仕様定数
// 落下時間 2.4秒 ＆ 落差-58m（瞬殺落下から倍増、時速100km超の超高層スリル）
// =========================================================================
export const TRAPDOOR_CONFIG = {
  PHYSICS: {
    minHeightDrop: 58.0,            // 垂直落差を -38m から 超高層ビル級の -58m へ超高層化
    forwardDistance: 12.0,          // 垂直落下を強調した前進距離
    totalDuration: 2.4,             // 落下時間を 1.18秒 から 2.4秒 へ倍増（落ちるスリルを存分に見せる）
    gravityPower: 1.6,              // 初速からストンと虚空へ引きずり込まれる重力カーブ (t^1.6)
    horizontalAirControlSpeed: 7.5, // 左右エアスライド速度（直立維持）
    maxAirOffsetX: 3.6              // 空中微調整の最大左右幅
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
  // 3段タイムシフトカメラ（ハッチ覗き込み見送り ➜ サイド垂直並走チェイス ➜ 先行着地）
  CAMERA: {
    // Phase 1 (0.0s〜0.5s / prog < 0.21): デッキ上空から開いた穴越しに落ちる瞬間を見送る
    farewellProgLimit: 0.21,        // 0.5秒相当 (0.5 / 2.4)
    farewellOffsetY: 6.0,           // 上のデッキ高さ +6.0m
    farewellOffsetZ: 4.5,           // 後方 +4.5m

    // Phase 2 (0.5s〜1.9s / 0.21 <= prog < 0.79): 自キャラの右斜め横から垂直並走チェイス
    chaseProgLimit: 0.79,           // 1.9秒相当 (1.9 / 2.4)
    chaseOffsetX: 5.2,              // 横 +5.2m
    chaseOffsetY: 4.0,              // 高さ +4.0m
    chaseOffsetZ: 6.5,              // 後方 +6.5m
    lookOffsetX: 0.0,
    lookOffsetY: -3.5,              // 深淵と迫る着地島の中間を捉える
    lookAheadZ: -16.0,
    fovStart: 62,                   // 開始時FOV
    fovDrop: 78                     // 落下加速時ワイドFOV（時速100km超のパノラマ視差）
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