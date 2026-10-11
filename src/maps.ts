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
  /** image-based light strength (default 0.55): low for night maps so nothing glows grey */
  env?: number;
  /** bloom strength (default 0.9) */
  bloom?: number;
  /** ground is a height field (see terrainHeight) instead of a flat floor */
  terrain?: boolean;
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
    terrain: true,
    radius: 27,
    spawnPlayer: [2, 20],
    spawnEnemy: [-2, 14],
    background: '#b9c8d8',
    fog: [45, 260],
    hemi: ['#d6e3f2', '#3e4c60', 0.8],
    keyColor: '#fff1dd',
    keyIntensity: 2.6,
    exposure: 0.72,
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
    name: '长安上元夜',
    subtitle: '上元节，唐长安满城灯火，打在宫城殿宇的屋顶上',
    icon: '🏮',
    mechanics: [
      '五座殿顶由廊道连成一片，屋檐平缓，越往屋脊越陡，往上爬要耗体力',
      '正殿屋脊最高，站上去居高临下；但上元节的烟花会落在正殿屋脊上，看到天上有烟花弹落下、屋脊冒火星就快下来',
      '四角是天井，被打进天井会摔伤，再被送回屋顶',
      '走路不会自己掉下去，被击飞才会',
    ],
    homeClass: 'Ranger',
    homeClassName: '暗器',
    homeBonus: '伤害 +10%',
    available: true,
    terrain: true,
    radius: 14,
    spawnPlayer: [0, 9.2],
    spawnEnemy: [0, -9.2],
    background: '#1a1426',
    fog: [40, 420],
    hemi: ['#56619a', '#6a3418', 0.7],
    keyColor: '#aebcff',
    keyIntensity: 1.1,
    exposure: 1.1,
    env: 0.12,
    bloom: 1.35,
    cardGradient: 'from-indigo-900/70 via-slate-900/80 to-black/90',
  },
  summit: {
    id: 'summit',
    name: '天阙之巅',
    subtitle: '云海之上的白玉浮台，打着打着就碎了',
    icon: '☁️',
    mechanics: [
      '开局是三圈白玉台，外圈 35 秒后碎裂坠入云海，中圈 75 秒后碎裂',
      '碎裂前地面会出现裂纹并发光，提前三秒',
      '被击飞出台面直接判负；最后只剩中心小圆台决胜负',
      '四根悬空玉柱可以跳上去，碎裂后也还在',
    ],
    homeClass: 'Berserker',
    homeClassName: '狂刃',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 13,
    spawnPlayer: [0, 6.5],
    spawnEnemy: [0, -6.5],
    background: '#c9d6e8',
    fog: [90, 520],
    hemi: ['#dfe9ff', '#8a7f74', 0.55],
    keyColor: '#ffe9c8',
    keyIntensity: 2.2,
    exposure: 0.72,
    env: 0.35,
    cardGradient: 'from-sky-300/40 via-indigo-300/30 to-zinc-900/90',
    // floating jade posts just outside the inner disc: they survive the collapse
    pillars: ring(4, 6.6, 0.7, Math.PI / 4).map((p) => ({ ...p, h: 2.2 })),
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
  ridgeWarn: 0, // 雨夜屋顶: 0..1 static building up on the main ridge before a strike
  boltT: 0, // 1 -> 0 while a lightning bolt is visible
  boltX: 0,
  boltZ: 0,
  summitStage: 0, // 天阙之巅: rings already fallen (0, 1 = outer gone, 2 = middle gone)
  summitWarn: 0, // 0..1 cracks glowing on the ring that is about to go
  summitFall: 0, // seconds since the last ring broke (drives the falling pieces)
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
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
/** smooth value noise, 0..1 */
function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Natural mountain height as a function of distance from the summit */
function coneH(r: number) {
  // an even slope (about 0.95) from foot to summit, with the foot and the summit rounded off,
  // so no stretch of the mountain is much steeper than the rest
  const v = Math.max(0, Math.min(1, 1 - (r - 1.5) / (GLACIER.footR - 1.5)));
  const a = 0.1;
  let g: number;
  if (v < a) g = (v * v) / (2 * a);
  else if (v > 1 - a) g = 1 - a - ((1 - v) * (1 - v)) / (2 * a) + (a / 2) * 0 + a / 2 - a / 2;
  else g = v - a / 2;
  return (GLACIER.summitH * g) / (1 - a);
}
// The road spirals up from the valley floor on the south-east to just under the peak.
const GLACIER_TURNS = 2.2;
(function buildPath() {
  const [sx, sz] = GLACIER.summit;
  const n = 420;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = 0.35 + t * Math.PI * 2 * GLACIER_TURNS; // starts east-south-east, winds round 2.2 times
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
  const n = pts.length - 1;
  const test = (i: number) => {
    if (i < 0 || i > n) return;
    const dx = x - pts[i][0];
    const dz = z - pts[i][1];
    const d = dx * dx + dz * dz;
    if (d < best) {
      best = d;
      bh = pts[i][2];
    }
  };
  // the road is a spiral: only the turns passing this bearing can be close, so test those stretches
  const [sx, sz] = GLACIER.summit;
  let th = Math.atan2(z - sz, x - sx) - 0.35;
  th = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (Math.hypot(x - sx, z - sz) < 8) for (let i = 0; i <= n; i++) test(i);
  else
    for (let k = 0; k < 3; k++) {
      const i0 = Math.round(((th + Math.PI * 2 * k) / (Math.PI * 2 * GLACIER_TURNS)) * n);
      if (i0 < -22 || i0 > n + 22) continue;
      for (let j = -22; j <= 22; j++) test(i0 + j);
    }
  test(0);
  test(n);
  const d = Math.sqrt(best);
  return { d, h: bh, on: 1 - sstep(GLACIER.pathHalf, GLACIER.pathHalf + 2.2, d) };
}
/** Ground height of 雪岭冰峰 at (x, z) */
export function glacierHeight(x: number, z: number) {
  const [sx, sz] = GLACIER.summit;
  const r = Math.hypot(x - sx, z - sz);
  const h0 = coneH(r);
  // terraces: mostly flat ledges, then a steep riser up to the next one
  const s = GLACIER.stepH;
  // ledges wander up and down round the mountain instead of making perfect rings
  const f = h0 / s + (vnoise(x * 0.11 + 3.1, z * 0.11 - 1.7) - 0.5) * 1.1 + (vnoise(x * 0.31, z * 0.31) - 0.5) * 0.25;
  const terr = (Math.floor(f) + sstep(0.35, 1.0, f - Math.floor(f))) * s;
  let h = h0 + (terr - h0) * 0.42 * sstep(0.5, 3, h0);
  // ridges and gullies running down the flanks
  const a = Math.atan2(z - sz, x - sx);
  h += (Math.sin(a * 7 + r * 0.25) * 0.45 + Math.sin(a * 13 - r * 0.4) * 0.15) * sstep(0.3, 4, h0) * (1 - sstep(GLACIER.summitH - 3, GLACIER.summitH, h0));
  // the road is cut level across the slope
  const p = glacierPath(x, z);
  if (p.on > 0) h += (p.h - h) * p.on * 0.7;
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

// ----------------------------------------------------------------------
// 雨夜屋顶 terrain: five tiled hall roofs joined by flat corridor roofs.
// ----------------------------------------------------------------------
export interface Hall {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** direction the ridge runs */
  axis: 'x' | 'z';
  ridge: number;
  eave: number;
}
export const ROOF = {
  street: -9,
  corridor: 2.6,
  halls: [
    { x0: -8, x1: 8, z0: -5, z1: 5, axis: 'x', ridge: 6.2, eave: 3.4 }, // 正殿
    { x0: -8, x1: 8, z0: -14, z1: -6, axis: 'x', ridge: 4.7, eave: 2.6 }, // 后殿
    { x0: -8, x1: 8, z0: 6, z1: 14, axis: 'x', ridge: 4.7, eave: 2.6 }, // 前殿
    { x0: -14, x1: -9, z0: -8, z1: 8, axis: 'z', ridge: 4.4, eave: 2.6 }, // 西配殿
    { x0: 9, x1: 14, z0: -8, z1: 8, axis: 'z', ridge: 4.4, eave: 2.6 }, // 东配殿
  ] as Hall[],
  /** flat corridor roofs linking the halls */
  corridors: [
    [-8, 8, -6, -5],
    [-8, 8, 5, 6],
    [-9, -8, -8, 8],
    [8, 9, -8, 8],
  ] as [number, number, number, number][],
  /** above this height you are on the main ridge, where lightning strikes */
  strikeY: 5.3,
};
/** Height of a hall roof at (x, z), or null outside it */
export function hallHeight(hl: Hall, x: number, z: number): number | null {
  if (x < hl.x0 || x > hl.x1 || z < hl.z0 || z > hl.z1) return null;
  const cx = (hl.x0 + hl.x1) / 2;
  const cz = (hl.z0 + hl.z1) / 2;
  const [a, b, ha, hb] = hl.axis === 'x' ? [Math.abs(z - cz), Math.abs(x - cx), (hl.z1 - hl.z0) / 2, (hl.x1 - hl.x0) / 2] : [Math.abs(x - cx), Math.abs(z - cz), (hl.x1 - hl.x0) / 2, (hl.z1 - hl.z0) / 2];
  // hip roof: the ends slope at the same pitch as the sides
  const u = Math.min(1, Math.max(0, a / ha, (b - (hb - ha)) / ha));
  // concave Chinese roof: steep near the ridge, flattening out to the eaves
  let h = hl.eave + (hl.ridge - hl.eave) * Math.pow(1 - u, 1.6);
  // 飞檐: the eaves sweep up at the four corners
  const dc = Math.min(Math.hypot(x - hl.x0, z - hl.z0), Math.hypot(x - hl.x0, z - hl.z1), Math.hypot(x - hl.x1, z - hl.z0), Math.hypot(x - hl.x1, z - hl.z1));
  h += 0.7 * sstep(0.55, 1, u) * Math.pow(Math.max(0, 1 - dc / 3.4), 2);
  // ridge beam: a narrow flat walkway on top
  if (a < 0.32 && b < hb - ha + 0.3) h = hl.ridge + 0.3;
  return h;
}
export function roofHeight(x: number, z: number) {
  let h = -1e9;
  for (const hl of ROOF.halls) {
    const v = hallHeight(hl, x, z);
    if (v !== null && v > h) h = v;
  }
  for (const [x0, x1, z0, z1] of ROOF.corridors) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) h = Math.max(h, ROOF.corridor);
  return h > -1e8 ? h : ROOF.street;
}

/** Floor height for maps with a height field (0 for flat maps) */
export function terrainHeight(id: MapId, x: number, z: number) {
  if (id === 'glacier') return glacierHeight(x, z);
  if (id === 'rooftop') return roofHeight(x, z);
  return 0;
}
/** Uphill gradient of the walkable surface. Sheer drops (roof edge to street) are ignored so nobody slides off an edge. */
export function terrainGradient(id: MapId, x: number, z: number): [number, number] {
  if (id === 'glacier') return glacierGradient(x, z);
  if (id !== 'rooftop') return [0, 0];
  const e = 0.25;
  const h0 = roofHeight(x, z);
  const s = (dx: number, dz: number) => {
    const v = roofHeight(x + dx, z + dz);
    return v < h0 - 1.2 ? h0 : v;
  };
  return [(s(e, 0) - s(-e, 0)) / (2 * e), (s(0, e) - s(0, -e)) / (2 * e)];
}

// ----------------------------------------------------------------------
// 天阙之巅: three concentric jade rings that break away during the round.
// ----------------------------------------------------------------------
export const SUMMIT = {
  rings: [13, 9.2, 5.6] as const, // outer radius of the floor at stage 0, 1, 2
  breakAt: [35, 75] as const, // seconds into the round
  warn: 3,
};
