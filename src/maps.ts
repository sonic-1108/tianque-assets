import { CharacterClassId } from './types';

export type MapId = 'temple' | 'lavacliff' | 'sea' | 'glacier' | 'bamboo' | 'rooftop' | 'summit' | 'forest';

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** top height a fighter can stand on (undefined = too tall, solid) */
  h?: number;
  /** a platform round a trunk: you stand on the ring between r and deck at height h, the trunk stays solid */
  deck?: number;
  /** can be climbed (青冥古林 lookout trees) */
  climb?: boolean;
  /** angle round the trunk where its rope ladder hangs */
  ladder?: number;
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
  /** map size class: 10Q arenas, 50Q open battlefields */
  sizeClass?: '10Q' | '50Q';
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

// ----------------------------------------------------------------------
// 青冥古林 (50Q): a big clearing among thousand-year-old trees with a river
// across the middle. Deep water is swum, the ford is waded, the bridge is
// walked; some of the giants carry hunters' lookouts you can climb up to.
// ----------------------------------------------------------------------
function frand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** the river's centre line: z as a function of x */
export function riverZ(x: number) {
  return 2 + 6 * Math.sin(x * 0.045 + 0.4) + 2 * Math.sin(x * 0.11 + 1.3);
}
export const FOREST = {
  radius: 58,
  waterY: -0.55, // river surface
  swimY: -1.5, // a swimmer's feet: body level with the surface
  deepHalf: 4.2, // half width of the deep channel
  bankHalf: 8.0, // where the banks meet the forest floor
  bedY: -3.0,
  ford: [-34, -24] as [number, number], // x range where the river runs shallow (waist-deep wading)
  bridge: { x: 21, half: 1.6, deck: 0.7 }, // footbridge across the river at x = 21 (+-half), deck height at the middle
  /** giant trees: x, z, trunk radius, lookout deck height (0 = no deck) */
  trees: [] as [number, number, number, number][],
  logs: [] as [number, number, number, number][],
  logR: 0.72,
  logH: 1.15,
  /** stepping stones across the ford (x, z) */
  stones: [] as [number, number][],
  deckR: 1.25, // how far the lookout platform reaches beyond the trunk
  /** boulders: x, z, size, yaw */
  rocks: [] as [number, number, number, number][],
  /** the hill with the old temple on top */
  hill: { x: -30, z: -38, r: 16, top: 8.6, h: 5.5 },
  /** temple hall on the hilltop (local frame: +z faces the map centre) */
  temple: { w: 8, d: 6 },
  /** where the candle-shade can be hidden (temple-local x, z) */
  shadeSpots: [
    [-2.6, -2.2],
    [2.9, -2.4],
    [-5.2, 3.4],
    [5.4, 1.2],
  ] as [number, number][],
};
/** temple frame: hilltop centre, facing toward the middle of the map */
export const TEMPLE_YAW = Math.atan2(-FOREST.hill.x, -FOREST.hill.z);
/** temple-local (x, z) to world (x, z) */
export function templeToWorld(lx: number, lz: number): [number, number] {
  const c = Math.cos(TEMPLE_YAW);
  const s = Math.sin(TEMPLE_YAW);
  return [FOREST.hill.x + lx * c + lz * s, FOREST.hill.z - lx * s + lz * c];
}
/** world to temple-local */
export function worldToTemple(x: number, z: number): [number, number] {
  const dx = x - FOREST.hill.x;
  const dz = z - FOREST.hill.z;
  const c = Math.cos(TEMPLE_YAW);
  const s = Math.sin(TEMPLE_YAW);
  return [dx * c - dz * s, dx * s + dz * c];
}
/** under the temple roof (sheltered from the rain) */
export function underTempleRoof(x: number, z: number, y: number) {
  const [lx, lz] = worldToTemple(x, z);
  return Math.abs(lx) < FOREST.temple.w / 2 + 0.6 && Math.abs(lz) < FOREST.temple.d / 2 + 0.6 && y > FOREST.hill.h - 0.5 && y < FOREST.hill.h + 3.5;
}
/** the altar's world position (candles are taken here) */
export function altarPos(): [number, number] {
  return templeToWorld(0, -1.4);
}
(() => {
  const rand = frand(1234);
  const ok = (x: number, z: number, pad: number) => {
    if (Math.hypot(x, z) > FOREST.radius - 4) return false;
    if (Math.abs(z - riverZ(x)) < FOREST.bankHalf + pad) return false;
    if (Math.hypot(x, z - 30) < 7 || Math.hypot(x, z + 28) < 7) return false; // spawns
    if (Math.abs(x - FOREST.bridge.x) < 6 && Math.abs(z - riverZ(x)) < 14) return false; // bridge approaches
    if (Math.hypot(x - FOREST.hill.x, z - FOREST.hill.z) < FOREST.hill.r + 2 + pad) return false; // the temple hill
    return true;
  };
  // hand-placed lookout trees first (both sides of the river, near the action), then fill
  const lookouts: [number, number][] = [
    [-14, 18],
    [16, 22],
    [-6, -17],
    [24, -16],
    [-34, -14],
    [36, 12],
    [-40, 22],
  ];
  for (const [x, z] of lookouts) FOREST.trees.push([x, z, 1.9 + rand() * 0.4, 7.5 + rand() * 2]);
  for (let k = 0; k < 600 && FOREST.trees.length < 22; k++) {
    const a = rand() * Math.PI * 2;
    const d = 10 + Math.sqrt(rand()) * 44;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!ok(x, z, 1)) continue;
    if (FOREST.trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 10)) continue;
    FOREST.trees.push([x, z, 1.5 + rand() * 0.6, 0]);
  }
  for (let k = 0; k < 600 && FOREST.logs.length < 6; k++) {
    const a = rand() * Math.PI * 2;
    const d = 8 + Math.sqrt(rand()) * 42;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const ang = rand() * Math.PI;
    const L = 5 + rand() * 3;
    const x1 = x + Math.cos(ang) * L;
    const z1 = z + Math.sin(ang) * L;
    if (!ok(x, z, 0.5) || !ok(x1, z1, 0.5)) continue;
    const near = (px: number, pz: number) => FOREST.trees.some(([tx, tz, r]) => Math.hypot(tx - px, tz - pz) < r + 3) || FOREST.logs.some(([a0, b0, a1, b1]) => Math.hypot((a0 + a1) / 2 - px, (b0 + b1) / 2 - pz) < 8);
    if (near(x, z) || near(x1, z1) || near((x + x1) / 2, (z + z1) / 2)) continue;
    FOREST.logs.push([x, z, x1, z1]);
  }
  // boulders: crowding the banks and the edge, the fighting ground stays clear. You can step up onto them.
  {
    const rr = frand(97);
    const blockedT = (x: number, z: number, pad: number) => FOREST.trees.some(([tx, tz, r]) => Math.hypot(x - tx, z - tz) < r + pad);
    for (let k = 0; k < 2000 && FOREST.rocks.length < 90; k++) {
      const a = rr() * Math.PI * 2;
      const d = 6 + rr() * (FOREST.radius + 4);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (blockedT(x, z, 1)) continue;
      if (Math.hypot(x - FOREST.hill.x, z - FOREST.hill.z) < FOREST.hill.r + 1) continue;
      const bank = Math.abs(Math.abs(z - riverZ(x)) - FOREST.deepHalf - 1.5) < 2.5;
      if (!bank && d < FOREST.radius - 2 && rr() < 0.8) continue;
      const sc = 0.25 + rr() * (bank ? 0.9 : 0.5);
      FOREST.rocks.push([x, z, sc, rr() * 6]);
    }
  }
  // stepping stones zig-zag across the ford
  const [f0, f1] = FOREST.ford;
  const fx = (f0 + f1) / 2;
  for (let k = -3; k <= 3; k++) FOREST.stones.push([fx + (k % 2 ? 1.1 : -1.1), riverZ(fx) + k * 2.1]);
})();

const sstepF = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** How deep the channel is cut here (0 = full depth, 1 = shallow ford) */
function fordAmount(x: number) {
  const [f0, f1] = FOREST.ford;
  return sstepF(f0 - 6, f0, x) * (1 - sstepF(f1, f1 + 6, x));
}
/** River bed / forest floor height (without the bridge) */
export function forestFloor(x: number, z: number) {
  const d = Math.abs(z - riverZ(x));
  // gentle swells on the forest floor, flattened toward the river
  let h = (Math.sin(x * 0.09 + 1.1) * Math.cos(z * 0.08 - 0.7) * 0.5 + Math.sin(x * 0.21 - z * 0.17) * 0.18) * sstepF(FOREST.bankHalf, FOREST.bankHalf + 6, d);
  // the channel: steepest at mid-bank, a flat bed in the middle
  const bed = FOREST.bedY + (FOREST.waterY - 0.35 - FOREST.bedY) * fordAmount(x);
  const k = sstepF(FOREST.deepHalf - 1.2, FOREST.bankHalf, d);
  h = bed + (h - bed) * k;
  // the temple hill: a round-shouldered mound with a flat top
  const H = FOREST.hill;
  const hd = Math.hypot(x - H.x, z - H.z);
  if (hd < H.r) h = Math.max(h, H.h * sstepF(H.r, H.top, hd));
  // the forest floor rises into the trees beyond the arena
  const r = Math.hypot(x, z);
  h += sstepF(FOREST.radius, FOREST.radius + 14, r) * 4;
  return h;
}
/** Is (x, z) on the footbridge deck? Returns the deck height, or null */
export function bridgeDeck(x: number, z: number) {
  const B = FOREST.bridge;
  if (Math.abs(x - B.x) > B.half) return null;
  const d = z - riverZ(B.x);
  const span = FOREST.bankHalf + 1.5;
  if (Math.abs(d) > span) return null;
  // a shallow arch from bank to bank
  return Math.max(forestFloor(x, z), B.deck * Math.cos(((d / span) * Math.PI) / 2) + 0.05);
}
export function forestHeight(x: number, z: number) {
  const b = bridgeDeck(x, z);
  return b ?? forestFloor(x, z);
}
/** water depth at (x, z): 0 on dry land */
export function waterDepth(x: number, z: number) {
  if (bridgeDeck(x, z) !== null) return 0;
  return Math.max(0, FOREST.waterY - forestFloor(x, z));
}
/** where the rope ladder hangs on the n-th lookout tree (shared by the mesh and the climbing) */
export function ladderAngle(n: number) {
  return (n * 1.7) % (Math.PI * 2);
}
function forestPillars(): Circle[] {
  // collision a touch wider than the drawn trunk so the root flare never swallows a foot
  let deckIdx = 0;
  const out: Circle[] = FOREST.trees.map(([x, z, r, deck]) => (deck > 0 ? { x, z, r: r * 1.08, h: deck, deck: r + FOREST.deckR, climb: true, ladder: ladderAngle(deckIdx++) } : { x, z, r: r * 1.08 }));
  for (const [x0, z0, x1, z1] of FOREST.logs) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(L / 1.0));
    for (let k = 0; k <= n; k++) out.push({ x: x0 + ((x1 - x0) * k) / n, z: z0 + ((z1 - z0) * k) / n, r: FOREST.logR, h: FOREST.logH + forestFloor(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n) });
  }
  for (const [x, z] of FOREST.stones) out.push({ x, z, r: 0.62, h: FOREST.waterY + 0.2 });
  // temple: eight columns, back and side walls (a row of circles), the altar, the statue, the bell pavilion posts
  {
    const T = FOREST.temple;
    const add = (lx: number, lz: number, r: number, h?: number) => {
      const [x, z] = templeToWorld(lx, lz);
      out.push(h === undefined ? { x, z, r } : { x, z, r, h: FOREST.hill.h + h });
    };
    for (const lx of [-T.w / 2, -T.w / 6, T.w / 6, T.w / 2]) for (const lz of [-T.d / 2, T.d / 2]) add(lx, lz, 0.32);
    for (let lx = -T.w / 2; lx <= T.w / 2 + 0.01; lx += 0.6) add(lx, -T.d / 2 - 0.05, 0.32); // back wall
    for (let lz = -T.d / 2; lz <= T.d / 2 - 1.4; lz += 0.6) {
      add(-T.w / 2 - 0.05, lz, 0.32);
      add(T.w / 2 + 0.05, lz, 0.32);
    }
    add(0, -1.4, 0.8, 1.0); // altar: you can hop onto it
    add(0, -2.4, 0.75); // statue
    for (const [px, pz] of [[-6.4, 2.0], [-4.6, 2.0], [-6.4, 3.8], [-4.6, 3.8]]) add(px, pz, 0.15); // bell pavilion
    add(0, 4.6, 0.55, 1.1); // incense burner
  }
  // small stones you step onto; big boulders are solid (a flat standing top over a rounded rock reads as floating)
  for (const [x, z, sc] of FOREST.rocks) out.push(sc < 0.5 ? { x, z, r: sc * 1.1, h: forestFloor(x, z) + sc * 0.75 } : { x, z, r: sc * 1.15 });
  return out;
}

export const MAPS = {
  temple: {
    id: 'temple',
    name: '天阙演武场',
    subtitle: '云海之上，夕阳里的山巅白玉台',
    icon: '🏛️',
    mechanics: ['外圈石栏 + 内外两圈共十四根石柱（完整的和断柱交替，都能跳上去）', '被击飞撞上墙或柱子：额外受伤并眩晕', '蛮牛冲、旋风刃把人逼到墙角最强'],
    homeClass: 'Berserker',
    homeClassName: '狂刃',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 24,
    spawnPlayer: [0, 7],
    spawnEnemy: [0, -7],
    background: '#eaa978',
    fog: [55, 320],
    hemi: ['#ffd8b4', '#4a3a44', 0.95],
    keyColor: '#ffc78f',
    keyIntensity: 3.0,
    exposure: 0.92,
    cardGradient: 'from-amber-900/80 via-stone-800/80 to-zinc-900/90',
    // two rings of pillars: full columns (top 5.25 m) alternate with broken stumps (2.6 m),
    // stepping stones for double jumps
    pillars: [
      ...ring(6, 9.5, 0.8, 0).map((p, i) => ({ ...p, h: i % 2 ? 2.6 : 5.25 })),
      ...ring(8, 17.5, 0.8, Math.PI / 8).map((p, i) => ({ ...p, h: i % 2 ? 5.25 : 2.6 })),
    ],
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
    radius: 21,
    spawnPlayer: [0, 6],
    spawnEnemy: [0, -6],
    background: '#3a1309',
    fog: [30, 230],
    hemi: ['#ffb37a', '#3a0d02', 0.75],
    keyColor: '#ffb27a',
    keyIntensity: 2.2,
    exposure: 1.1,
    cardGradient: 'from-red-900/80 via-orange-900/70 to-zinc-950/90',
    vents: [{ x: 0, z: 0, r: 1.7 }, ...ring(6, 12, 1.7, Math.PI / 6)],
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
    radius: 21,
    rect: { hx: 7, hz: 19 },
    spawnPlayer: [0, 9],
    spawnEnemy: [0, -9],
    background: '#1b2530',
    fog: [40, 240],
    hemi: ['#8fb3d9', '#10202c', 0.85],
    keyColor: '#9fb8d8',
    keyIntensity: 1.3,
    exposure: 1.15,
    cardGradient: 'from-sky-900/80 via-cyan-950/80 to-slate-950/90',
    pillars: [
      // two masts
      { x: 0, z: -8, r: 0.5 },
      { x: 0, z: 6, r: 0.5 },
      // cargo: single crates (1.1 m) and two stacks (2.2 m) to climb on
      { x: 4.3, z: -14, r: 0.8, h: 1.1 },
      { x: -4.4, z: 13, r: 0.8, h: 1.1 },
      { x: -4.6, z: -2.5, r: 0.75, h: 1.1 },
      { x: 4.7, z: 2.5, r: 0.75, h: 1.1 },
      { x: -4.2, z: -11, r: 0.9, h: 2.2 },
      { x: 4.2, z: 11, r: 0.9, h: 2.2 },
      { x: 1.8, z: 15.5, r: 0.7, h: 1.1 },
      { x: -1.6, z: -16.5, r: 0.7, h: 1.1 },
    ],
  },
  glacier: {
    id: 'glacier',
    name: '雪岭冰峰',
    subtitle: '暴雪中的一整座雪山，从山脚一路打上山顶',
    icon: '🏔️',
    mechanics: [
      '山脚是宽阔的雪谷，整座雪山一层层往上，山顶 25 米高',
      '直接爬陡坡会持续消耗体力，耗尽就滑下去；绕山的盘山路坡缓，走路几乎不耗体力',
      '南坡会发生雪崩，从山腰一路冲到谷底',
      '居高临下：站得比对手高，近战够不到你',
    ],
    homeClass: 'Ranger',
    homeClassName: '暗器',
    homeBonus: '伤害 +10%',
    available: true,
    terrain: true,
    radius: 40,
    spawnPlayer: [3, 28],
    spawnEnemy: [-3, 21],
    background: '#b9c8d8',
    fog: [45, 260],
    hemi: ['#d6e3f2', '#3e4c60', 0.8],
    keyColor: '#fff1dd',
    keyIntensity: 2.6,
    exposure: 0.72,
    cardGradient: 'from-sky-200/40 via-slate-500/50 to-slate-900/90',
    pillars: [
      { x: -12, z: 29, r: 0.9, h: 1.6 },
      { x: 11, z: 31, r: 0.75, h: 1.2 },
      { x: -22, z: 20, r: 1.0, h: 1.9 },
      { x: 21, z: 22, r: 0.85, h: 1.4 },
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
      '殿宇之间是天井，被打进天井会摔伤，再被送回屋顶',
      '走路不会自己掉下去，被击飞才会',
    ],
    homeClass: 'Ranger',
    homeClassName: '暗器',
    homeBonus: '伤害 +10%',
    available: true,
    terrain: true,
    radius: 26,
    spawnPlayer: [0, 14],
    spawnEnemy: [0, -14],
    background: '#1a1426',
    fog: [40, 420],
    hemi: ['#56619a', '#6a3418', 0.7],
    keyColor: '#aebcff',
    keyIntensity: 1.1,
    exposure: 1.1,
    bloom: 1.35,
    cardGradient: 'from-indigo-900/70 via-slate-900/80 to-black/90',
  },
  summit: {
    id: 'summit',
    name: '天阙之巅',
    subtitle: '云海之上的白玉浮台，打着打着就碎了',
    icon: '☁️',
    mechanics: [
      '开局是三圈白玉台，外圈 45 秒后碎裂坠入云海，中圈 95 秒后碎裂',
      '碎裂前地面会出现裂纹并发光，提前三秒',
      '被击飞出台面直接判负；最后只剩中心小圆台决胜负',
      '十根悬空玉柱可以跳上去，地板碎了它们也还在，成了最后的落脚点',
    ],
    homeClass: 'BuddhistMage',
    homeClassName: '梵音',
    homeBonus: '伤害 +10%',
    available: true,
    radius: 22,
    spawnPlayer: [0, 11],
    spawnEnemy: [0, -11],
    background: '#b7c7df',
    fog: [110, 560],
    hemi: ['#bcd2ff', '#6a5a4c', 0.38],
    keyColor: '#ffd6a0',
    keyIntensity: 2.8,
    exposure: 0.8,
    cardGradient: 'from-sky-300/40 via-indigo-300/30 to-zinc-900/90',
    // floating jade posts just outside the inner disc: they survive the collapse
    pillars: [...ring(4, 10.6, 0.7, Math.PI / 4).map((p) => ({ ...p, h: 2.2 })), ...ring(6, 18.3, 0.8, 0).map((p) => ({ ...p, h: 2.6 }))],
  },
} as Record<MapId, MapDef>;

MAPS.forest = {
  id: 'forest',
  name: '青冥古林',
  subtitle: '千年古树遮天蔽日，一条大河横穿林间。第一张 50Q 大地图',
  icon: '🌲',
  sizeClass: '50Q',
  mechanics: [
    '50Q 大地图：面积是普通地图的五倍多，开局两人隔河相望',
    '大河横穿中间：深水区要游泳（游得慢、不能出招，只能翻滚潜游），西边有浅滩可以蹚过去，东边有一座木桥',
    '七棵古树上搭着猎人瞭望台：朝树跑过去按跳跃，施展「梯云纵」三步蹬上树顶（耗体力，途中被打会掉下来），站在台上居高临下；走到台边再跳就下来',
    '古树挡路也挡暗器，被击飞撞上树干会额外受伤并眩晕；倒木和河边的石头可以站上去',
    '天气会变：晴 → 转阴 → 下雨 → 暴雨雷暴 → 放晴，大约两分钟一轮',
    '摩擦力：每人鞋底抓地力不同（梵音最稳，霍岩次之，沈惊鸿最轻）。下雨、河边泥地会让地面变滑：起步刹车打滑，被打飞得更远；太滑时急转、急停、连续翻滚、高处落地都会失衡，失衡满了就摔倒',
    '雷暴时天上劈雷，落点先冒电光：雷专劈站得最高的人（瞭望台最危险），劈在河边会沿水导电，泡在水里的人一起挨电',
    '梯子：走到梯子下按住 F 往上爬，S 往下，空格跳下来',
    '山风一起，枯枝会砸下来，落点先出现红圈',
  ],
  homeClass: 'Ranger',
  homeClassName: '暗器',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: FOREST.radius,
  spawnPlayer: [0, 30],
  spawnEnemy: [0, -28],
  background: '#9fae8c',
  fog: [30, 170],
  hemi: ['#d9e8c0', '#2c3a22', 0.75],
  keyColor: '#ffe2a8',
  keyIntensity: 2.6,
  exposure: 0.95,
  bloom: 0.8,
  cardGradient: 'from-emerald-900/80 via-green-900/70 to-zinc-950/90',
  pillars: forestPillars(),
};

export const MAP_ORDER: MapId[] = ['temple', 'lavacliff', 'sea', 'glacier', 'forest', 'rooftop', 'summit'];

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
  /** 青冥古林: branches coming down. t < 0: warning (falls during the last 0.45 s), 0 = impact, then lies there */
  branches: [] as { x: number; z: number; t: number; a: number }[],
  gust: 0, // 0..1 wind gust shaking the canopy
  /** 青冥古林 weather: 0 clear .. 1 downpour */
  rain: 0,
  /** 0..1 thunderstorm (lightning strikes) */
  storm: 0,
  /** 0..1 static gathering at (boltX, boltZ) before a strike */
  strikeWarn: 0,
  boltY: 0, // ground height of the last strike
  /** 0 day .. 1 deep night */
  night: 0,
  /** distant sheet lightning in the clouds (no strike) */
  skyFlash: 0,
  /** which hiding place the candle-shade is in this round (-1 = someone took it) */
  shadeSpot: 0,
};

// ----------------------------------------------------------------------
// 雪岭冰峰 terrain: a whole snow mountain you can fight your way up.
// Shared by the physics (Game) and the mesh (Maps3D).
// ----------------------------------------------------------------------
export const GLACIER = {
  summit: [0, -16] as [number, number], // x, z of the peak
  summitH: 25, // height of the peak
  footR: 30, // radius (from the summit) where the mountain meets the valley floor
  stepH: 4, // terrace height: flat ledges to rest on, steep risers to climb
  pathHalf: 2.0, // half-width of the switchback road
  avalancheX: [-8, 8] as [number, number], // avalanches pour down this band of the south face
  avalancheTop: -12, // z where they break loose
  avalancheEnd: 27, // z where they run out on the valley floor
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
const GLACIER_TURNS = 3;
(function buildPath() {
  const [sx, sz] = GLACIER.summit;
  const n = 640;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = 0.35 + t * Math.PI * 2 * GLACIER_TURNS; // starts east-south-east, winds round 2.2 times
    const r = GLACIER.footR - 1.5 - t * (GLACIER.footR - 4.5);
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
  if (ro > 40) h += sstep(40, 50, ro) * 9 + sstep(58, 92, ro) * 18 + Math.sin(Math.atan2(z, x) * 7 + ro * 0.15) * sstep(40, 54, ro) * 1.5;
  return h;
}
/** Uphill gradient (dh/dx, dh/dz) */
export function glacierGradient(x: number, z: number): [number, number] {
  const e = 0.25;
  return [(glacierHeight(x + e, z) - glacierHeight(x - e, z)) / (2 * e), (glacierHeight(x, z + e) - glacierHeight(x, z - e)) / (2 * e)];
}

/**
 * 雪岭 scenery that you can bump into: spruces and rock outcrops. Generated here (same seeds the renderer used)
 * so the physics and the meshes agree; both become solid pillars.
 */
export const GLACIER_PINES: [number, number, number][] = [];
export const GLACIER_ROCKS: { x: number; y: number; z: number; sx: number; sy: number; sz: number; rx: number; ry: number; rz: number }[] = [];
(() => {
  const [sx, sz] = GLACIER.summit;
  let rand = frand(88);
  for (let k = 0; k < 420; k++) {
    const a = rand() * Math.PI * 2;
    const r = 41.5 + Math.pow(rand(), 0.8) * 55;
    GLACIER_PINES.push([Math.cos(a) * r, Math.sin(a) * r, 1.0 + rand() * 1.2]);
  }
  for (let k = 0; k < 400 && GLACIER_PINES.length < 500; k++) {
    const a = rand() * Math.PI * 2;
    const r = 9 + rand() * 20;
    const x = sx + Math.cos(a) * r;
    const z = sz + Math.sin(a) * r;
    if (Math.hypot(x, z) > 38.5) continue;
    if (glacierPath(x, z).d < GLACIER.pathHalf + 2.4) continue;
    if (x > GLACIER.avalancheX[0] - 2 && x < GLACIER.avalancheX[1] + 2 && z > GLACIER.avalancheTop) continue;
    GLACIER_PINES.push([x, z, 0.7 + rand() * 0.5]);
  }
  for (let k = 0; k < 60; k++) {
    const a = rand() * Math.PI * 2;
    const r = 38 + rand() * 3;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - sx, z - sz) < GLACIER.footR + 2) continue;
    GLACIER_PINES.push([x, z, 0.9 + rand() * 0.6]);
  }
  rand = frand(44);
  for (let k = 0; k < 120 && GLACIER_ROCKS.length < 45; k++) {
    const a = rand() * Math.PI * 2;
    const r = 5 + rand() * 22;
    const x = sx + Math.cos(a) * r;
    const z = sz + Math.sin(a) * r;
    if (Math.hypot(x, z) > 38) continue;
    if (glacierPath(x, z).d < GLACIER.pathHalf + 2.2) continue;
    if (x > GLACIER.avalancheX[0] - 1 && x < GLACIER.avalancheX[1] + 1 && z > GLACIER.avalancheTop) continue;
    const s = 0.6 + rand() * 1.1;
    GLACIER_ROCKS.push({ x, z, y: glacierHeight(x, z) - s * 0.35, sx: s * (1 + rand()), sy: s * (0.6 + rand() * 0.5), sz: s * (0.8 + rand() * 0.6), rx: rand() * 0.4, ry: rand() * 6, rz: rand() * 0.4 });
  }
  // solid (no standing on them: on the slopes they would be steps up the mountain)
  const P = MAPS.glacier.pillars!;
  for (const [x, z, sc] of GLACIER_PINES) if (Math.hypot(x, z) < 41.5) P.push({ x, z, r: 1.05 * sc });
  for (const rk of GLACIER_ROCKS) P.push({ x: rk.x, z: rk.z, r: Math.max(0.5, ((rk.sx + rk.sz) / 2) * 0.82) });
})();

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
  corridor: 3.0,
  halls: [
    { x0: -10, x1: 10, z0: -6, z1: 6, axis: 'x', ridge: 7.4, eave: 4.0 }, // 正殿
    { x0: -9, x1: 9, z0: -19, z1: -9, axis: 'x', ridge: 5.7, eave: 3.0 }, // 后殿
    { x0: -9, x1: 9, z0: 9, z1: 19, axis: 'x', ridge: 5.7, eave: 3.0 }, // 前殿
    { x0: -23, x1: -13, z0: -9, z1: 9, axis: 'z', ridge: 5.5, eave: 3.0 }, // 西配殿
    { x0: 13, x1: 23, z0: -9, z1: 9, axis: 'z', ridge: 5.5, eave: 3.0 }, // 东配殿
    { x0: 13, x1: 20, z0: -20, z1: -13, axis: 'x', ridge: 6.4, eave: 3.2 }, // 角楼
    { x0: -20, x1: -13, z0: -20, z1: -13, axis: 'x', ridge: 6.4, eave: 3.2 },
    { x0: 13, x1: 20, z0: 13, z1: 20, axis: 'x', ridge: 6.4, eave: 3.2 },
    { x0: -20, x1: -13, z0: 13, z1: 20, axis: 'x', ridge: 6.4, eave: 3.2 },
  ] as Hall[],
  /** flat corridor roofs linking the halls */
  corridors: [
    [-8, 8, -9, -6],
    [-8, 8, 6, 9],
    [-13, -10, -5, 5],
    [10, 13, -5, 5],
    [9, 13, -17.5, -14.5],
    [-13, -9, -17.5, -14.5],
    [9, 13, 14.5, 17.5],
    [-13, -9, 14.5, 17.5],
    [15, 18, -13, -9],
    [15, 18, 9, 13],
    [-18, -15, -13, -9],
    [-18, -15, 9, 13],
  ] as [number, number, number, number][],
  /** above this height you are on the main ridge, where the fireworks land */
  strikeY: 6.5,
  /** top of the main ridge beam */
  ridgeTop: 7.7,
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
  if (id === 'forest') return forestHeight(x, z);
  if (id === 'rooftop') return roofHeight(x, z);
  return 0;
}
/** Uphill gradient of the walkable surface. Sheer drops (roof edge to street) are ignored so nobody slides off an edge. */
export function terrainGradient(id: MapId, x: number, z: number): [number, number] {
  if (id === 'glacier') return glacierGradient(x, z);
  if (id === 'forest') {
    const e = 0.25;
    return [(forestHeight(x + e, z) - forestHeight(x - e, z)) / (2 * e), (forestHeight(x, z + e) - forestHeight(x, z - e)) / (2 * e)];
  }
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
  rings: [22, 15, 8.5] as const, // outer radius of the floor at stage 0, 1, 2
  breakAt: [45, 95] as const, // seconds into the round
  warn: 3,
};
