// チーム設定、コース構成規格、およびエレベーター・フリーフォール新物理定数
export const TEAMS = {
  BLUE: { id: 'blue', name: 'あなた (青)', hex: 0x06b6d4, emissive: 0x0891b2 },
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

// ★ エレベーター刷新仕様定数（昇降タワー・加減速物理）
export const ELEVATOR_CONFIG = {
  // レーン別の昇降所要時間（秒）と識別カラー
  LANES: [
    { laneIdx: 0, speedTier: 'fast', duration: 2.6, label: 'FAST (2.6s)', colorHex: 0x10b981, emissiveHex: 0x059669 },
    { laneIdx: 1, speedTier: 'mid',  duration: 4.0, label: 'MID (4.0s)',  colorHex: 0xfacc15, emissiveHex: 0xeab308 },
    { laneIdx: 2, speedTier: 'slow', duration: 5.6, label: 'SLOW (5.6s)', colorHex: 0xef4444, emissiveHex: 0xb91c1c }
  ],
  // 物理イージング（始動時の加速タメ・到着時のクッションバウンド）
  EASING: {
    accelPhase: 0.18, // 始動加速にかける割合
    decelPhase: 0.22, // 到着減速にかける割合
    arrivalBounceHeight: 0.12 // 到着時の機械的バウンド幅
  },
  // 構造物規格
  TOWER: {
    postRadius: 0.14,
    cageWidth: 2.5,
    cageDepth: 2.2,
    cageHeight: 2.4,
    roofHeight: 2.5
  }
};

// ★ フリーフォール刷新仕様定数（ダイブ台・放物線重力落下・空中スラローム）
export const FREEFALL_CONFIG = {
  // 落下コースの幾何規格（急降下感を生む落差・前進比率）
  PHYSICS: {
    minHeightDrop: 24.0, // 最低落差（従来の倍近くに拡大）
    forwardDistance: 32.0, // 前進移動距離（従来の55mから短縮して垂直感を強調）
    totalDuration: 2.8, // 滞空時間（秒）
    gravityPower: 2.2, // 落下加速カーブの指数（終盤にかけて急加速）
    horizontalAirControlSpeed: 14.0, // 左右エアコントロール横移動速度 (m/s)
    maxAirOffsetX: 5.2, // 空中制御の最大左右幅
    bankRollMax: 0.55 // 左右移動時の機体ロール角（ラジアン）
  },
  // ダイビング発射台の規格
  LAUNCH_PLATFORM: {
    length: 6.0,
    width: 7.0,
    railHeight: 1.1,
    tipOverhang: 1.5 // 崖先への突き出し量
  },
  // 空中配置ブロック（誘導リング・スラローム）
  BONUS_TRACK: {
    blockCount: 16,
    ringRadius: 1.8,
    pickupRadiusSq: 4.84 // 2.2m以内回収
  }
};