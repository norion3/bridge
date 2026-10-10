// チーム設定および定数定義
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