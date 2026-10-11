import { CharacterClassId } from './types';

export type MapId = 'temple' | 'lavacliff' | 'sea' | 'glacier' | 'bamboo' | 'rooftop' | 'summit';

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** top height a fighter can stand on (undefined = too tall, solid) */
  h?: number;
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
  /** rectangular play area (half extents) instead of a circle */
  rect?: { hx: number; hz: number };
}

/** Distant volcano for 熔岩断崖 (crater position) */
export const VOLCANO_CRATER: [number, number, number] = [-55, 34, -80];

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
    subtitle: '云海之上，夕阳里的山巅白玉台',
    icon: '🏛️',
    mechanics: ['外圈石墙 + 六根石柱（三根完整、三根断柱，可以跳上去）', '被击飞撞上墙或柱子：额外受伤并眩晕', '蛮牛冲、旋风刃把人逼到墙角最强'],
    homeClass: 'Berserker',
    homeClassName: '狂刃',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 13.5,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#eaa978',
    fog: [55, 320],
    hemi: ['#ffd8b4', '#4a3a44', 0.95],
    keyColor: '#ffc78f',
    keyIntensity: 3.0,
    exposure: 0.92,
    cardGradient: 'from-amber-900/80 via-stone-800/80 to-zinc-900/90',
    // alternate full pillars (top 5.25 m) and broken stumps (2.6 m): stepping stones for double jumps
    pillars: ring(6, 8.2, 0.8, 0).map((p, i) => ({ ...p, h: i % 2 ? 2.6 : 5.25 })),
  },
  lavacliff: {
    id: 'lavacliff',
    name: '熔岩断崖',
    subtitle: '悬在岩浆海上的玄武岩台',
    icon: '🌋',
    mechanics: ['远处火山每隔十几秒爆发，火山弹从天而降，落点先出现红圈', '平台边缘没有护栏，被打下悬崖直接判负', '地面火口偶尔喷发火柱'],
    homeClass: 'Berserker',
    homeClassName: '狂刃',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 11.5,
    spawnPlayer: [0, 3],
    spawnEnemy: [0, -3],
    background: '#3a1309',
    fog: [30, 230],
    hemi: ['#ffb37a', '#3a0d02', 0.75],
    keyColor: '#ffb27a',
    keyIntensity: 2.2,
    exposure: 1.1,
    cardGradient: 'from-red-900/80 via-orange-900/70 to-zinc-950/90',
    vents: [{ x: 0, z: 0, r: 1.7 }, ...ring(4, 6.5, 1.7, Math.PI / 4)],
  },
  sea: {
    id: 'sea',
    name: '怒海战船',
    subtitle: '风暴夜里，大海上的古战船甲板',
    icon: '🌊',
    mechanics: ['长条甲板，两侧是船舷，有桅杆和货箱挡路', '巨浪会从一侧拍上甲板，把所有人冲向另一边', '被冲到船舷上会撞伤眩晕，格挡可以站稳'],
    homeClass: 'LightHealer',
    homeClassName: '灵雀',
    homeBonus: '移速 +10%（职业开发中）',
    available: true,
    radius: 13,
    rect: { hx: 4.4, hz: 12.2 },
    spawnPlayer: [0, 6],
    spawnEnemy: [0, -6],
    background: '#1b2530',
    fog: [30, 200],
    hemi: ['#8fb3d9', '#10202c', 0.85],
    keyColor: '#9fb8d8',
    keyIntensity: 1.3,
    exposure: 1.15,
    cardGradient: 'from-sky-900/80 via-cyan-950/80 to-slate-950/90',
    pillars: [
      { x: 0, z: -4.8, r: 0.42 },
      { x: 0, z: 3.8, r: 0.42 },
      { x: 2.7, z: -9.2, r: 0.75, h: 1.1 },
      { x: -2.8, z: 8.6, r: 0.75, h: 1.1 },
      { x: -2.9, z: -0.6, r: 0.7, h: 1.1 },
    ],
  },
  glacier: {
    id: 'glacier',
    name: '雪岭冰峰',
    subtitle: '暴雪中的一整座雪山，从山脚一路打上山顶',
    icon: '🏔️',
    mechanics: [
      '山脚是雪谷，整座雪山一层层台阶一样往上，山顶 19 米高',
      '直接爬陡坡会持续消耗体力，耗尽就滑下去；绕山的盘山路坡缓，走路几乎不耗体力',
      '南坡会发生雪崩，从山腰一路冲到谷底',
      '居高临下：站得比对手高，近战够不到你',
    ],
    homeClass: 'Ranger',
    homeClassName: '暗器',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 27,
    spawnPlayer: [2, 20],
    spawnEnemy: [-2, 14],
    background: '#b9c8d8',
    fog: [40, 200],
    hemi: ['#d6e3f2', '#3e4c60', 0.8],
    keyColor: '#fff1dd',
    keyIntensity: 2.6,
    exposure: 0.78,
    cardGradient: 'from-sky-200/40 via-slate-500/50 to-slate-900/90',
    pillars: [
      { x: -9, z: 17, r: 0.9, h: 1.6 },
      { x: 8, z: 19, r: 0.75, h: 1.2 },
    ],
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

export const MAP_ORDER: MapId[] = ['temple', 'lavacliff', 'sea', 'glacier', 'rooftop', 'summit'];

/** Shared per-frame values the map visuals read (written by the game loop) */
export const mapRuntime = {
  ventHeat: [] as number[], // 0..1 warning glow per vent
  eruption: 0, // 0..1 volcano eruption intensity (sky tint, crater glow)
  waveSide: 0, // -1 / +1 side the big wave comes from, 0 = none
  waveRise: 0, // 0..1 how high the incoming wave is
  lightning: 0, // 0..1 lightning flash
  shipRoll: 0, // radians, 怒海战船 deck roll
  shipPitch: 0,
  avalancheZ: -999, // 雪岭冰峰: z of the avalanche front (-999 = none)
  avalancheWarn: 0, // 0..1 rumble before it breaks loose
};

// ----------------------------------------------------------------------
// 雪岭冰峰 terrain: a whole snow mountain you can fight your way up.
// Shared by the physics (Game) and the mesh (Maps3D).
// ----------------------------------------------------------------------
export const GLACIER = {
  summit: [0, -13] as [number, number], // x, z of the peak
  summitH: 19, // height of the peak
  footR: 22, // radius (from the summit) where the mountain meets the valley floor
  stepH: 4, // terrace height: flat ledges to rest on, steep risers to climb
  pathHalf: 1.7, // half-width of the switchback road
  avalancheX: [-7, 7] as [number, number], // avalanches pour down this band of the south face
  avalancheTop: -9, // z where they break loose
  avalancheEnd: 18, // z where they run out on the valley floor
  pathPts: [] as [number, number, number][], // x, z, height along the road (bottom to top)
};
const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Natural mountain height as a function of distance from the summit */
function coneH(r: number) {
  return GLACIER.summitH * Math.pow(1 - sstep(1.5, GLACIER.footR, r), 1.15);
}
// The road spirals up from the valley floor on the south-east to just under the peak.
(function buildPath() {
  const [sx, sz] = GLACIER.summit;
  const n = 260;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = 0.35 + t * Math.PI * 2.35; // starts south-east, winds round anticlockwise
    const r = 20.5 - t * 17.5;
    const x = sx + Math.cos(ang) * r;
    const z = sz + Math.sin(ang) * r;
    GLACIER.pathPts.push([x, z, coneH(r)]);
  }
})();
/** Distance from (x, z) to the road, and the road's height at the nearest point */
export function glacierPath(x: number, z: number) {
  let best = 1e9;
  let bh = 0;
  const pts = GLACIER.pathPts;
  for (let i = 0; i < pts.length; i++) {
    const dx = x - pts[i][0];
    const dz = z - pts[i][1];
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      bh = pts[i][2];
    }
  }
  const d = Math.sqrt(best);
  return { d, h: bh, on: 1 - sstep(GLACIER.pathHalf, GLACIER.pathHalf + 1.3, d) };
}
/** Ground height of 雪岭冰峰 at (x, z) */
export function glacierHeight(x: number, z: number) {
  const [sx, sz] = GLACIER.summit;
  const r = Math.hypot(x - sx, z - sz);
  const h0 = coneH(r);
  // terraces: mostly flat ledges, then a steep riser up to the next one
  const s = GLACIER.stepH;
  const f = h0 / s;
  const terr = (Math.floor(f) + sstep(0.5, 1.0, f - Math.floor(f))) * s;
  let h = h0 + (terr - h0) * 0.68 * sstep(0.5, 3, h0);
  // ridges and gullies running down the flanks
  const a = Math.atan2(z - sz, x - sx);
  h += (Math.sin(a * 7 + r * 0.25) * 0.55 + Math.sin(a * 13 - r * 0.4) * 0.25) * sstep(0.3, 4, h0) * (1 - sstep(GLACIER.summitH - 3, GLACIER.summitH, h0));
  // the road is cut level across the slope
  const p = glacierPath(x, z);
  if (p.on > 0) h += (p.h - h) * p.on;
  // drifts on the valley floor
  const ro = Math.hypot(x, z);
  h += Math.sin(x * 0.45 + 1.3) * Math.cos(z * 0.38) * 0.3 * (1 - sstep(0, 2, h0));
  // mountains walling the whole valley in (outside the play area)
  // a forested snow shelf ringing the valley (outside the play area), with the far ranges beyond
  if (ro > 27) h += sstep(27, 36, ro) * 9 + sstep(44, 70, ro) * 16 + Math.sin(Math.atan2(z, x) * 7 + ro * 0.15) * sstep(27, 40, ro) * 1.5;
  return h;
}
/** Uphill gradient (dh/dx, dh/dz) */
export function glacierGradient(x: number, z: number): [number, number] {
  const e = 0.25;
  return [(glacierHeight(x + e, z) - glacierHeight(x - e, z)) / (2 * e), (glacierHeight(x, z + e) - glacierHeight(x, z - e)) / (2 * e)];
}
