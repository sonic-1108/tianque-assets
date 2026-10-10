import { CharacterClassId } from './types';

export type MapId = 'temple' | 'lavacliff' | 'forge' | 'bamboo' | 'rooftop' | 'summit';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  subtitle: string;
  icon: string;
  mechanics: string[];
  homeClass: CharacterClassId;
  homeClassName: string;
  homeBonus: string;
  available: boolean;
  radius: number;
  spawnPlayer: [number, number];
  spawnEnemy: [number, number];
  background: string;
  fog: [number, number];
  hemi: [string, string, number];
  keyColor: string;
  keyIntensity: number;
  exposure: number;
  cardGradient: string;
  pillars?: Circle[];
  vents?: Circle[];
  islands?: Circle[];
}

/** Damage multiplier when the fighter's class matches the map's home class */
export const HOME_BONUS = 1.1;

const ring = (n: number, radius: number, r: number, offset = 0): Circle[] =>
  Array.from({ length: n }, (_, i) => {
    const a = offset + (i / n) * Math.PI * 2;
    return { x: Math.cos(a) * radius, z: Math.sin(a) * radius, r };
  });

export const MAPS: Record<MapId, MapDef> = {
  temple: {
    id: 'temple',
    name: '天阙演武场',
    subtitle: '石柱环立的古老演武场',
    icon: '🏛️',
    mechanics: ['外圈石墙 + 六根石柱', '被击飞撞上墙或柱子：额外受伤并眩晕', '蛮牛冲、旋风刃把人逼到墙角最强'],
    homeClass: 'Berserker',
    homeClassName: '狂刃',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 13.5,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#1a1f2b',
    fog: [26, 70],
    hemi: ['#cfe3ff', '#3a2f28', 0.9],
    keyColor: '#ffe2c4',
    keyIntensity: 2.6,
    exposure: 1.15,
    cardGradient: 'from-amber-900/80 via-stone-800/80 to-zinc-900/90',
    pillars: ring(6, 8.2, 0.8, Math.PI / 6),
  },
  lavacliff: {
    id: 'lavacliff',
    name: '熔岩断崖',
    subtitle: '悬在岩浆海上的玄武岩台',
    icon: '🌋',
    mechanics: ['平台边缘没有护栏，被打下悬崖直接判负', '地面火口会先亮红光，随后喷发火柱', '击退技能在这里就是杀招'],
    homeClass: 'Berserker',
    homeClassName: '狂刃',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 11.5,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#1c0904',
    fog: [18, 60],
    hemi: ['#ffb37a', '#3a0d02', 0.75],
    keyColor: '#ffb27a',
    keyIntensity: 2.2,
    exposure: 1.1,
    cardGradient: 'from-red-900/80 via-orange-900/70 to-zinc-950/90',
    vents: [{ x: 0, z: 0, r: 1.7 }, ...ring(4, 6.5, 1.7, Math.PI / 4)],
  },
  forge: {
    id: 'forge',
    name: '熔炉地心',
    subtitle: '地底巨炉，岩浆正在上涨',
    icon: '🔥',
    mechanics: ['每 18 秒岩浆上涨一圈，最后只剩中央和三块石台', '站在岩浆里每秒掉血', '越打越挤，把对手逼进岩浆'],
    homeClass: 'HeavyHealer',
    homeClassName: '慈航',
    homeBonus: '治疗量 +10%（职业开发中）',
    available: true,
    radius: 14.5,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#160803',
    fog: [16, 55],
    hemi: ['#ffc48a', '#2a0c03', 0.7],
    keyColor: '#ffbf80',
    keyIntensity: 2.0,
    exposure: 1.1,
    cardGradient: 'from-orange-800/80 via-red-950/80 to-black/90',
    islands: ring(3, 9.5, 2.3, Math.PI / 2),
  },
  bamboo: {
    id: 'bamboo',
    name: '雪夜竹林',
    subtitle: '积雪会滑，竹子挡住视线和弹道',
    icon: '🎋',
    mechanics: ['翻滚和冲刺会在雪上滑行', '竹子可以被劈断'],
    homeClass: 'Sniper',
    homeClassName: '夜鸮',
    homeBonus: '待职业上线',
    available: false,
    radius: 14,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#0d1420',
    fog: [12, 40],
    hemi: ['#cfe3ff', '#1d2633', 0.8],
    keyColor: '#cfe0ff',
    keyIntensity: 1.6,
    exposure: 1.1,
    cardGradient: 'from-sky-900/70 via-slate-800/80 to-zinc-950/90',
  },
  rooftop: {
    id: 'rooftop',
    name: '雨夜屋顶',
    subtitle: '古城屋脊上的高低差对决',
    icon: '🏯',
    mechanics: ['可以跳上屋脊居高临下', '打雷时闪电照亮全场'],
    homeClass: 'LightHealer',
    homeClassName: '灵雀',
    homeBonus: '待职业上线',
    available: false,
    radius: 14,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#0b0f18',
    fog: [12, 45],
    hemi: ['#9fb3d9', '#141821', 0.7],
    keyColor: '#b9c8ff',
    keyIntensity: 1.5,
    exposure: 1.1,
    cardGradient: 'from-indigo-900/70 via-slate-900/80 to-black/90',
  },
  summit: {
    id: 'summit',
    name: '天阙之巅',
    subtitle: '云海浮台，场地会碎裂缩小',
    icon: '☁️',
    mechanics: ['打到一半外圈碎裂', '最后在小圆台上决胜负'],
    homeClass: 'BuddhistMage',
    homeClassName: '梵音',
    homeBonus: '待职业上线',
    available: false,
    radius: 14,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#a9c3e6',
    fog: [20, 80],
    hemi: ['#ffffff', '#8aa0c0', 1.0],
    keyColor: '#fff3dc',
    keyIntensity: 2.4,
    exposure: 1.1,
    cardGradient: 'from-sky-300/40 via-indigo-300/30 to-zinc-900/90',
  },
};

export const MAP_ORDER: MapId[] = ['temple', 'lavacliff', 'forge', 'bamboo', 'rooftop', 'summit'];

/** Forge: radius beyond which the floor is lava, per stage */
export const FORGE_STAGE_TIMES = [18, 36, 54];
export const FORGE_STAGE_RADII = [99, 11.5, 7.5, 4.2];

export function forgeStage(t: number) {
  let s = 0;
  for (const st of FORGE_STAGE_TIMES) if (t >= st) s++;
  return s;
}

export function inForgeLava(x: number, z: number, lavaR: number, islands: Circle[]) {
  if (Math.hypot(x, z) <= lavaR) return false;
  for (const i of islands) if (Math.hypot(x - i.x, z - i.z) <= i.r) return false;
  return true;
}

/** Shared per-frame values the map visuals read (written by the game loop) */
export const mapRuntime = {
  lavaR: 99,
  ventHeat: [] as number[], // 0..1 warning glow per vent
};
