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

// ★ エレベーター刷新仕様定数（黒い斜め柱を撤去し、オープン展望リフト＆到着デッキへ）
export const ELEVATOR_CONFIG = {
  // レーン別の昇降所要時間（秒）と識別カラー
  LANES: [
    { laneIdx: 0, speedTier: 'fast', duration: 2.6, label: 'FAST (2.6s)', colorHex: 0x10b981, emissiveHex: 0x059669 },
    { laneIdx: 1, speedTier: 'mid',  duration: 4.0, label: 'MID (4.0s)',  colorHex: 0xfacc15, emissiveHex: 0xeab308 },
    { laneIdx: 2, speedTier: 'slow', duration: 5.6, label: 'SLOW (5.6s)', colorHex: 0xef4444, emissiveHex: 0xb91c1c }
  ],
  // 物理イージング（始動加速・到着クッション・到着後下車トランジション）
  EASING: {
    accelPhase: 0.16,
    decelPhase: 0.20,
    arrivalBounceHeight: 0.08,
    exitDelay: 0.35 // 上の島へ到着後にリフトから降り立つ余韻時間（秒）
  },
  // オープン展望ゴンドラ規格（屋根を撤去してブロック突き抜けを完全防止）
  LIFT: {
    platformWidth: 2.4,
    platformDepth: 2.0,
    handrailHeight: 0.95, // 腰高セーフティ手すり
    cableRadius: 0.025 // スリムな光沢ガイドケーブル
  }
};

// ★ フリーフォール刷新仕様定数（足元が開くトラップドアハッチ・直立垂直落下）
export const FREEFALL_CONFIG = {
  // 落下コース物理（前進を抑え、垂直な落差を強調）
  PHYSICS: {
    minHeightDrop: 26.0,      // 最低垂直落差
    forwardDistance: 16.0,    // 前進距離（大幅短縮でほぼ真下への垂直落下を演出）
    totalDuration: 2.2,       // 落下滞空時間（秒）
    gravityPower: 2.6,        // 急降下加速カーブ
    horizontalAirControlSpeed: 7.5, // 左右エアスライド速度 (直立姿勢のまま微調整)
    maxAirOffsetX: 3.8        // 空中制御の最大左右幅
  },
  // トラップドア（足元ハッチ）規格
  HATCH: {
    size: 3.4,                // ハッチ外枠サイズ
    doorOpenAngle: Math.PI * 0.48, // ドアが下へパカッと開く角度
    openDuration: 0.22,       // 扉が開く所要時間（秒）
    exclusionRadius: 4.5      // ハッチ周囲の床ブロック生成禁止半径（散乱を完全防止）
  }
};

// ★ アイテム固有カラー（磁石をゲート・植物の緑と競合しない高輝度パープルへ設定）
export const ITEM_COLORS = {
  SPEED: { hex: 0xfde047, emissive: 0xeab308 },
  ATTACK: { hex: 0xf43f5e, emissive: 0xd946ef },
  MAGNET: { hex: 0xa855f7, emissive: 0xc084fc, beaconHex: 0xc084fc }
};