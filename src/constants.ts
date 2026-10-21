/** fighter slots: up to six heroes, plus 长安上元夜's emperor and his four guards (11), with one spare */
export const SLOTS = 12;
/** [0, 1, ... SLOTS - 1] */
export const SLOT_IDS = Array.from({ length: SLOTS }, (_, k) => k);

export const CONFIG = {
  // Game meta
  title: {
    value: '天阙 (Tian Que 3D)',
    type: 'string',
    label: 'Game Title',
    group: 'GAME',
  },
  baseCanvasWidth: {
    value: 1280,
    type: 'number',
    label: 'Base Canvas Width',
    group: 'GAME',
  },
  baseCanvasHeight: {
    value: 720,
    type: 'number',
    label: 'Base Canvas Height',
    group: 'GAME',
  },

  // Target FPS & Physics
  targetFPS: {
    value: 60,
    type: 'number',
    label: 'Target FPS',
    group: 'SYSTEM',
  },
  baseMoveSpeed: {
    value: 8.5,
    type: 'number',
    label: 'Base Movement Speed',
    group: 'Physics',
  },
  jumpVelocity: {
    value: 11.0,
    type: 'number',
    label: 'Jump Impulse Force',
    group: 'Physics',
  },
  gravity: {
    value: 26.0,
    type: 'number',
    label: 'Gravity Acceleration',
    group: 'Physics',
  },
  dodgeSpeed: {
    value: 16.0,
    type: 'number',
    label: 'Dodge Roll Speed Impulse',
    group: 'Physics',
  },
  dodgeDuration: {
    value: 0.42,
    type: 'number',
    label: 'Dodge Roll Duration (s)',
    group: 'Physics',
  },
  dodgeIframeDuration: {
    value: 0.32,
    type: 'number',
    label: 'Dodge Invulnerability Frame (s)',
    group: 'Physics',
  },
  dodgeCooldown: {
    value: 1.2,
    type: 'number',
    label: 'Dodge Cooldown (s)',
    group: 'Physics',
  },
  arenaRadius: {
    value: 22.0,
    type: 'number',
    label: 'Arena Outer Radius',
    group: 'World',
  },

  // Third-Person Over-The-Shoulder Camera Settings
  mouseSensitivity: {
    value: 0.0024,
    type: 'number',
    label: 'Mouse Look Sensitivity',
    group: 'Camera',
  },
  cameraMinPitchDeg: {
    value: 10.0,
    type: 'number',
    label: 'Camera Min Pitch (Deg)',
    group: 'Camera',
  },
  cameraMaxPitchDeg: {
    value: 70.0,
    type: 'number',
    label: 'Camera Max Pitch (Deg)',
    group: 'Camera',
  },
  cameraMinDist: {
    value: 2.8,
    type: 'number',
    label: 'Camera Min Zoom Distance',
    group: 'Camera',
  },
  cameraMaxDist: {
    value: 9.5,
    type: 'number',
    label: 'Camera Max Zoom Distance',
    group: 'Camera',
  },
  cameraDefaultDist: {
    value: 5.2,
    type: 'number',
    label: 'Camera Default Distance',
    group: 'Camera',
  },
  shoulderOffsetX: {
    value: 0.85,
    type: 'number',
    label: 'Over The Shoulder X Offset',
    group: 'Camera',
  },
  shoulderOffsetY: {
    value: 1.6,
    type: 'number',
    label: 'Over The Shoulder Y Offset',
    group: 'Camera',
  },

  // Class 1: 狂刃 (Berserker - 霍岩)
  berserkerHp: { value: 1600, type: 'number', label: '狂刃 Max HP', group: 'Berserker' },
  berserkerMp: { value: 100, type: 'number', label: '狂刃 Max MP', group: 'Berserker' },
  berserkerSpeedRatio: { value: 0.75, type: 'number', label: '狂刃 Move Speed Ratio', group: 'Berserker' },
  berserkerBlockReduction: { value: 0.60, type: 'number', label: '狂刃 Block Damage Reduction', group: 'Berserker' },

  // Class 2: 夜鸮 (Sniper - 沈默)
  sniperHp: { value: 800, type: 'number', label: '夜鸮 Max HP', group: 'Sniper' },
  sniperMp: { value: 100, type: 'number', label: '夜鸮 Max MP', group: 'Sniper' },
  sniperSpeedRatio: { value: 0.90, type: 'number', label: '夜鸮 Move Speed Ratio', group: 'Sniper' },
  sniperMagazine: { value: 5, type: 'number', label: '夜鸮 Magazine Capacity', group: 'Sniper' },

  // Class 3: 梵音 (Buddhist Mage - 了尘)
  mageHp: { value: 900, type: 'number', label: '梵音 Max HP', group: 'BuddhistMage' },
  mageMp: { value: 160, type: 'number', label: '梵音 Max MP', group: 'BuddhistMage' },
  mageSpeedRatio: { value: 1.0, type: 'number', label: '梵音 Move Speed Ratio', group: 'BuddhistMage' },

  // Class 4: 灵雀 (Light Healer - 小满)
  lightHealerHp: { value: 850, type: 'number', label: '灵雀 Max HP', group: 'LightHealer' },
  lightHealerMp: { value: 140, type: 'number', label: '灵雀 Max MP', group: 'LightHealer' },
  lightHealerSpeedRatio: { value: 1.15, type: 'number', label: '灵雀 Move Speed Ratio', group: 'LightHealer' },

  // Class 5: 慈航 (Heavy Healer - 苏慈)
  heavyHealerHp: { value: 1000, type: 'number', label: '慈航 Max HP', group: 'HeavyHealer' },
  heavyHealerMp: { value: 150, type: 'number', label: '慈航 Max MP', group: 'HeavyHealer' },
  heavyHealerSpeedRatio: { value: 0.85, type: 'number', label: '慈航 Move Speed Ratio', group: 'HeavyHealer' },

  // Lighting & Environment
  ambientIntensity: {
    value: 1.6,
    type: 'number',
    label: 'Ambient Intensity',
    group: 'Lighting',
  },
  sunIntensity: {
    value: 3.8,
    type: 'number',
    label: 'Sun Light Intensity',
    group: 'Lighting',
  },
  hemiSkyColor: {
    value: '#38bdf8',
    type: 'color',
    label: 'Hemisphere Sky Color',
    group: 'Lighting',
  },
  hemiGroundColor: {
    value: '#1e293b',
    type: 'color',
    label: 'Hemisphere Ground Color',
    group: 'Lighting',
  },
  hemiIntensity: {
    value: 1.8,
    type: 'number',
    label: 'Hemisphere Intensity',
    group: 'Lighting',
  },
};

const { playgroundConfig } = globalThis as {
  playgroundConfig?: Record<string, unknown>;
};
if (playgroundConfig) {
  for (const [key, value] of Object.entries(playgroundConfig)) {
    if (key in CONFIG) {
      Object.assign(CONFIG[key as keyof typeof CONFIG], { value });
    }
  }
}

export type ConfigKey = keyof typeof CONFIG;

export function getConfig<K extends ConfigKey>(
  key: K,
): (typeof CONFIG)[K]['value'] {
  return CONFIG[key].value;
}
