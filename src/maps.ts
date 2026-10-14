import { CharacterClassId } from './types';

export type MapId = 'temple' | 'lavacliff' | 'sea' | 'glacier' | 'bamboo' | 'rooftop' | 'summit' | 'forest' | 'desert';

export interface Circle {
  x: number;
  z: number;
  r: number;
  /** top height a fighter can stand on (undefined = too tall, solid) */
  h?: number;
  /** bottom: what it stands on (怒海战船 crates sit on a deck; below that deck they aren't there). Default: all the way down */
  y0?: number;
  /** a platform round a trunk: you stand on the ring between r and deck at height h, the trunk stays solid */
  deck?: number;
  /** 怒海战船: which ship it belongs to, and its ship-local x */
  ship?: number;
  lx?: number;
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

/** the arenas were made 1.3x roomier (layout spread out; pillars, rails and props keep their size) */
export const GROW = 1.3;
const g1 = (v: number) => Math.round(v * GROW * 100) / 100;

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
  const u = x / GROW; // the whole forest was spread out 1.3x: the river's meanders with it
  return GROW * (2 + 6 * Math.sin(u * 0.045 + 0.4) + 2 * Math.sin(u * 0.11 + 1.3));
}
export const FOREST = {
  radius: g1(58),
  waterY: -0.55, // river surface
  swimY: -1.5, // a swimmer's feet: body level with the surface
  deepHalf: 4.2, // half width of the deep channel
  bankHalf: 8.0, // where the banks meet the forest floor
  bedY: -3.0,
  ford: [g1(-34), g1(-24)] as [number, number], // x range where the river runs shallow (waist-deep wading)
  bridge: { x: g1(21), half: 1.6, deck: 0.7 }, // footbridge across the river at x = 21 (+-half), deck height at the middle
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
  hill: { x: g1(-26), z: g1(-33), r: 20, top: 13, h: 5.5 },
  /** temple hall on the hilltop (local frame: +z faces the map centre) */
  temple: { w: 14, d: 10, podium: 0.9, col: 6.2 },
  /** where the candle-shade can be hidden (temple-local x, z) */
  shadeSpots: [
    [-5.8, -3.8],
    [5.9, -4.0],
    [-7.2, 8.6],
    [4.8, 8.8],
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
  return Math.abs(lx) < FOREST.temple.w / 2 + 1.6 && Math.abs(lz) < FOREST.temple.d / 2 + 1.6 && y > FOREST.hill.h - 0.5 && y < FOREST.hill.h + 10;
}
/** under any roof on the hill (the hall, or the bell pavilion): dry floor, and lightning can't reach you */
export function sheltered(x: number, z: number, y: number) {
  if (underTempleRoof(x, z, y)) return true;
  const [lx, lz] = worldToTemple(x, z);
  return Math.abs(lx + 7.2) < 1.9 && Math.abs(lz - 8.6) < 1.9 && y > FOREST.hill.h - 0.5 && y < FOREST.hill.h + 5;
}
/** a candle or a candle-shade that someone has put down */
export interface PlacedItem {
  kind: 'candle' | 'shade';
  x: number;
  y: number;
  z: number;
  /** candle: burning */
  lit: boolean;
  /** candle: a shade sits over it (rain can't put it out) */
  shade: boolean;
  /** index into TREE_HOOKS when hung on a lookout tree, else -1 */
  hook: number;
}
/** the prayer cushions in the hall (temple-local x, z): sit on one to recover, once a day */
export const CUSHIONS: [number, number][] = [
  [-2.4, 0.6],
  [-0.8, 0.6],
  [0.8, 0.6],
  [2.4, 0.6],
];
/** meditation: how long the sitting lasts, and the share of lost HP it gives back */
export const MEDITATE = { secs: 4, share: 0.1 };
/** most things that can lie about at once */
export const MAX_ITEMS = 8;
/** how far a candle lights up around itself (metres): carried, set down, hung high in a tree */
export const CANDLE_LIGHT = { hand: 10, ground: 9, hook: 28, stand: 18 };
/** the altar's world position (candles are taken here) */
export function altarPos(): [number, number] {
  return templeToWorld(0, -2.4);
}
/** where a candle can be taken / relit: the altar and the two candle racks (temple-local) */
export const CANDLE_POINTS: [number, number][] = [
  [0, -2.4],
  [-2.6, -1.5],
  [2.6, -1.5],
];
(() => {
  const rand = frand(1234);
  const ok = (x: number, z: number, pad: number) => {
    if (Math.hypot(x, z) > FOREST.radius - 4) return false;
    if (Math.abs(z - riverZ(x)) < FOREST.bankHalf + pad) return false;
    if (Math.hypot(x, z - g1(30)) < 7 || Math.hypot(x, z + g1(28)) < 7) return false; // spawns
    if (Math.abs(x - FOREST.bridge.x) < 6 && Math.abs(z - riverZ(x)) < 14) return false; // bridge approaches
    // the temple hill, with room so no limb or crown reaches over the temple
    if (Math.hypot(x - FOREST.hill.x, z - FOREST.hill.z) < FOREST.hill.r + 6 + pad) return false;
    return true;
  };
  // hand-placed lookout trees first (both sides of the river, near the action), then fill
  const lookouts: [number, number][] = [
    [-14, 18],
    [16, 22],
    [-6, -17],
    [24, -16],
    [-47, 8],
    [36, 12],
    [-40, 22],
  ];
  for (const [x, z] of lookouts) FOREST.trees.push([g1(x), g1(z), 1.9 + rand() * 0.4, 7.5 + rand() * 2]);
  for (let k = 0; k < 900 && FOREST.trees.length < 30; k++) {
    const a = rand() * Math.PI * 2;
    const d = (10 + Math.sqrt(rand()) * 44) * GROW;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!ok(x, z, 1)) continue;
    if (FOREST.trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 10)) continue;
    FOREST.trees.push([x, z, 1.5 + rand() * 0.6, 0]);
  }
  for (let k = 0; k < 900 && FOREST.logs.length < 8; k++) {
    const a = rand() * Math.PI * 2;
    const d = (8 + Math.sqrt(rand()) * 42) * GROW;
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
/** steps=false: the bare hillside under the stairs (for the ground mesh, which the stair blocks then sit in) */
export function forestFloor(x: number, z: number, steps = true) {
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
  // the temple's stone podium, its front steps, and the flight of stairs down the hill: real flat treads, so feet
  // land on the stone instead of sinking into it
  if (hd < H.r + 1) {
    const [lx, lz] = worldToTemple(x, z);
    const T = FOREST.temple;
    if (Math.abs(lx) < T.w / 2 + 1.4 && Math.abs(lz) < T.d / 2 + 1.4) h = H.h + T.podium;
    else if (!steps) {
      /* bare slope */
    } else if (Math.abs(lx) < PODIUM_STEPS.half && lz > 0 && lz < T.d / 2 + 1.4 + PODIUM_STEPS.n * PODIUM_STEPS.dz) {
      // walked as a ramp through the middle of the treads: feet stay within half a riser of the stone, and nobody
      // hops 30 cm a step (the drawn steps are the real treads)
      const f = (lz - T.d / 2 - 1.4) / PODIUM_STEPS.dz;
      h = H.h + T.podium * Math.min(1, Math.max(0, 1 - (f + 0.5) / (PODIUM_STEPS.n + 1)));
    } else if (Math.abs(lx) < HILL_STAIRS.half) {
      const t = hillStairRamp(lz);
      if (t !== null) h = Math.max(h, t);
    }
  }
  // the forest floor rises into the trees beyond the arena
  const r = Math.hypot(x, z);
  h += sstepF(FOREST.radius, FOREST.radius + 14, r) * 4;
  return h;
}
/** the podium's front steps (temple-local): n treads of depth dz between the forecourt and the podium top */
export const PODIUM_STEPS = { half: 2.2, n: 2, dz: 0.45 };
/** the stone stairs down the hill's front slope (temple-local, along +z) */
export const HILL_STAIRS = { half: 1.6, z0: 13, rise: 0.3 };
/** height of the stair tread at temple-local lz, or null off the flight */
export function hillStairTread(lz: number): number | null {
  const H = FOREST.hill;
  const S = HILL_STAIRS;
  if (lz < S.z0 || lz > H.r - 0.15) return null;
  // equal risers: the slope is cut into flat treads, never below the hillside
  const nat = H.h * sstepF(H.r, H.top, lz);
  return Math.min(H.h, Math.ceil(nat / S.rise - 1e-4) * S.rise);
}
/** the hill stairs as walked: a smooth slope through the middle of the treads (null off the flight) */
export function hillStairRamp(lz: number): number | null {
  const H = FOREST.hill;
  const S = HILL_STAIRS;
  if (lz < S.z0 || lz > H.r - 0.15) return null;
  return Math.min(H.h, H.h * sstepF(H.r, H.top, lz) + S.rise / 2);
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
/** the two incense stands (香火台) in the forecourt before the temple (temple-local x, z) */
export const INCENSE_STANDS: [number, number][] = [
  [-3.2, 9.8],
  [3.2, 9.8],
];
/**
 * Where a candle can be put up: a lantern hook on each lookout tree's trunk (opposite the ladder, at head height
 * above the deck), then the incense stands before the temple (stand: true; a little roof keeps the rain off too)
 */
export const TREE_HOOKS: { x: number; y: number; z: number; deck: number; a: number; stand?: boolean }[] = [
  ...FOREST.trees
    .filter((t) => t[3] > 0)
    .map(([x, z, r, deck], n) => {
      const a = ladderAngle(n) + Math.PI;
      return { x: x + Math.cos(a) * (r + 0.18), y: deck + 1.45, z: z + Math.sin(a) * (r + 0.18), deck, a };
    }),
  ...INCENSE_STANDS.map(([lx, lz]) => {
    const [x, z] = templeToWorld(lx, lz);
    return { x, y: FOREST.hill.h + 1.55, z, deck: FOREST.hill.h, a: TEMPLE_YAW, stand: true };
  }),
];
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
  // temple: columns, thick back and side walls, lattice screens in the outer front bays, altar, Buddhas,
  // candle racks, bell pavilion posts, incense burner (rows of circles: the collision is a set of round posts)
  {
    const T = FOREST.temple;
    const P = FOREST.hill.h + T.podium;
    const add = (lx: number, lz: number, r: number, top?: number) => {
      const [x, z] = templeToWorld(lx, lz);
      out.push(top === undefined ? { x, z, r } : { x, z, r, h: top });
    };
    const cols = [-T.w / 2, -T.w / 6, T.w / 6, T.w / 2];
    for (const lx of cols) for (const lz of [-T.d / 2, T.d / 2]) add(lx, lz, 0.42);
    for (let lx = -T.w / 2; lx <= T.w / 2 + 0.01; lx += 0.55) add(lx, -T.d / 2 - 0.12, 0.32); // back wall
    for (let lz = -T.d / 2; lz <= T.d / 2 + 0.01; lz += 0.55) {
      add(-T.w / 2 - 0.12, lz, 0.32);
      add(T.w / 2 + 0.12, lz, 0.32);
    }
    for (const sx of [-1, 1]) for (let lx = T.w / 6 + 0.5; lx < T.w / 2 - 0.2; lx += 0.55) add(sx * lx, T.d / 2, 0.25); // lattice screens
    add(0, -2.4, 1.0, P + 1.1); // altar: you can hop onto it
    add(0, -4.0, 1.4); // the great Buddha
    add(-3.7, -4.0, 0.95); // side Buddhas
    add(3.7, -4.0, 0.95);
    add(-2.6, -1.5, 0.5); // candle racks
    add(2.6, -1.5, 0.5);
    for (const [px, pz] of [[-8.2, 7.6], [-6.2, 7.6], [-8.2, 9.6], [-6.2, 9.6]]) add(px, pz, 0.17); // bell pavilion
    add(0, 8.4, 0.62, FOREST.hill.h + 1.1); // incense burner
    for (const [sx, sz] of INCENSE_STANDS) add(sx, sz, 0.42); // incense stands
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
    radius: g1(24),
    spawnPlayer: [0, g1(7)],
    spawnEnemy: [0, -g1(7)],
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
      ...ring(6, g1(9.5), 0.8, 0).map((p, i) => ({ ...p, h: i % 2 ? 2.6 : 5.25 })),
      ...ring(8, g1(17.5), 0.8, Math.PI / 8).map((p, i) => ({ ...p, h: i % 2 ? 5.25 : 2.6 })),
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
    radius: g1(21),
    spawnPlayer: [0, g1(6)],
    spawnEnemy: [0, -g1(6)],
    background: '#3a1309',
    fog: [30, 230],
    hemi: ['#ffb37a', '#3a0d02', 0.75],
    keyColor: '#ffb27a',
    keyIntensity: 2.2,
    exposure: 1.1,
    cardGradient: 'from-red-900/80 via-orange-900/70 to-zinc-950/90',
    vents: [{ x: 0, z: 0, r: 1.7 }, ...ring(6, g1(12), 1.7, Math.PI / 6)],
  },
  sea: {
    id: 'sea',
    name: '怒海战船',
    subtitle: '风暴夜里，大海上的古战船甲板',
    icon: '🌊',
    mechanics: [
      '两艘五层楼船并排漂在海上，两队各占一艘：甲板下有货舱，船尾高塔四层，两舷楼梯上下',
      '主甲板船尾前有船舵：站过去按住 F 把船往对面开，两船贴上就能翻过船舷跳到对方船上开打；贴着的时候按住 F 是把船开远',
      '掉进两船之间的海里：掉 120 血，被捞回自己船上',
      '货舱里有一桌饭菜，按 F 吃一口回复已损失气血的 10%',
      '每艘船船头楼和船尾高塔各一台床弩，按 F 抢占射击，能转过来打对面的船，箭能把人钉住',
      '巨浪会拍上主甲板把人冲走；躲进船舱或站上高处就不怕',
    ],
    homeClass: 'LightHealer',
    homeClassName: '灵雀',
    homeBonus: '移速 +10%（职业开发中）',
    available: true,
    radius: 42,
    rect: { hx: 40, hz: 40 },
    terrain: true,
    spawnPlayer: [3, 9],
    spawnEnemy: [-3, -14],
    background: '#1b2530',
    fog: [40, 240],
    hemi: ['#8fb3d9', '#10202c', 0.85],
    keyColor: '#9fb8d8',
    keyIntensity: 1.3,
    exposure: 1.15,
    cardGradient: 'from-sky-900/80 via-cyan-950/80 to-slate-950/90',
    pillars: [
      // two masts
      { x: 0, z: -15, r: 0.7 },
      { x: 0, z: 9, r: 0.7 },
      // cargo on the main deck (h is the top, measured from the main deck)
      { x: 5.5, z: -9, r: 0.8, h: 1.1 },
      { x: -6, z: -2, r: 0.8, h: 1.1 },
      { x: 6, z: 3, r: 0.75, h: 1.1 },
      { x: -5, z: -21, r: 0.9, h: 2.2 },
      { x: 5, z: -21, r: 0.8, h: 1.1 },
      { x: -6, z: 8, r: 0.9, h: 2.2 },
      { x: 4, z: 12, r: 0.7, h: 1.1 },
      // down in the hold
      { x: -8, z: -18, r: 0.9, h: -3.3 },
      { x: 8, z: -10, r: 0.9, h: -3.3 },
      { x: -8, z: 6, r: 1.0, h: -2.2 },
      { x: 7.5, z: 8, r: 0.8, h: -3.3 },
      { x: -7.5, z: -6, r: 0.7, h: -3.3 },
      // the cabins
      { x: -7, z: -33, r: 0.75, h: 1.1 },
      { x: 7, z: -30, r: 0.7, h: 1.1 },
      { x: -8, z: 34, r: 0.8, h: 1.1 },
      { x: 5, z: 26, r: 0.9, h: 0.85 }, // the chart table in the great cabin
      // up on the forecastle and the quarterdeck
      { x: 6, z: -34, r: 0.7, h: 5.5 },
      { x: -5, z: 17, r: 0.7, h: 5.5 },
      // the two mounted crossbows
      { x: 0, z: -31.5, r: 0.5, h: 5.5 },
      { x: 0, z: 30.5, r: 0.45, h: 14.3 },
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
    radius: g1(40),
    spawnPlayer: [g1(3), g1(28)],
    spawnEnemy: [g1(-3), g1(21)],
    background: '#b9c8d8',
    fog: [45, 260],
    hemi: ['#d6e3f2', '#3e4c60', 0.8],
    keyColor: '#fff1dd',
    keyIntensity: 2.6,
    exposure: 0.72,
    cardGradient: 'from-sky-200/40 via-slate-500/50 to-slate-900/90',
    pillars: [
      { x: g1(-12), z: g1(29), r: 0.9, h: 1.6 },
      { x: g1(11), z: g1(31), r: 0.75, h: 1.2 },
      { x: g1(-22), z: g1(20), r: 1.0, h: 1.9 },
      { x: g1(21), z: g1(22), r: 0.85, h: 1.4 },
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
    radius: g1(26),
    spawnPlayer: [0, g1(14)],
    spawnEnemy: [0, -g1(14)],
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
    radius: g1(22),
    spawnPlayer: [0, g1(11)],
    spawnEnemy: [0, -g1(11)],
    background: '#b7c7df',
    fog: [110, 560],
    hemi: ['#bcd2ff', '#6a5a4c', 0.38],
    keyColor: '#ffd6a0',
    keyIntensity: 2.8,
    exposure: 0.8,
    cardGradient: 'from-sky-300/40 via-indigo-300/30 to-zinc-900/90',
    // floating jade posts just outside the inner disc: they survive the collapse
    pillars: [...ring(4, g1(10.6), 0.7, Math.PI / 4).map((p) => ({ ...p, h: 2.2 })), ...ring(6, g1(18.3), 0.8, 0).map((p) => ({ ...p, h: 2.6 }))],
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
    '雷暴时天上劈雷，落点先冒电光：雷专劈站得最高的人（瞭望台最危险），劈在河边会沿水导电，泡在水里的人一起挨电',
    '梯子：走到梯子下按住 F 往上爬，S 往下，空格跳下来',
    '寺门前有两座香火台：拿着点燃的蜡烛走过去按 F 供上，寺前一片都亮了（有顶棚，不怕雨）',
    '山风一起，枯枝会砸下来，落点先出现红圈',
  ],
  homeClass: 'Ranger',
  homeClassName: '暗器',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: FOREST.radius,
  spawnPlayer: [0, g1(30)],
  spawnEnemy: [0, g1(-28)],
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


// ----------------------------------------------------------------------
// 大漠玉门关 (50Q): a rammed-earth frontier fort in the middle of the dunes.
//   The fort is a square of walls 6 m high and 4 m thick with a walkway on top. Gates in the
//   north and south walls (a gate tower each side of the gap), a collapsed stretch in the west
//   wall you can hop over, and four ramps (马道) up the inside of the east and west walls.
//   In the middle stands the beacon tower (烽火台), reached by two ramps. Out in the dunes,
//   a flat-topped yardang mesa east and west, each with a sand ramp up its fort side.
//   One team camps south of the fort, the other north.
// Everything is one height field (desertHeight); the walls' faces are sheer: you can only get up
// by the ramps (or hop the low bits), and walking never takes you over an edge.
// ----------------------------------------------------------------------
export const DESERT = {
  radius: g1(58),
  /** fort: outer half size, wall thickness, walkway height, gate half width, gate tower out to, parapet */
  fort: { half: 20, wall: 4, h: 6, gate: 2.6, tower: 6.4, towerH: 9.5, parapet: 1.45, corner: 7.2 },
  /** the collapsed stretch of the west wall: rubble you can hop onto */
  breach: { z: 3.2, h: 1.0 },
  /** ramps up the inside of the east and west walls: from |z| = z0 (ground) to z1 (walkway), inner edge x */
  ramp: { z0: 3, z1: 16, inner: 12.6 },
  /** beacon tower in the middle: platform half size and height, ramps north and south */
  beacon: { half: 3, h: 3.2, rampTo: 10.5, rampHalfW: 1.35 },
  /** courtyard wells (F: a drink heals 10% of lost HP) */
  wells: [
    [-8.5, 0],
    [8.5, 0],
  ] as [number, number][],
  /** yardang mesas: centre x, half extents, top height; a ramp on the fort side */
  mesas: [
    { x: 50, hx: 6.5, hz: 9, h: 4.6, rampFrom: 37, rampHalfW: 3 },
    { x: -50, hx: 6.5, hz: 9, h: 4.6, rampFrom: -37, rampHalfW: 3 },
  ],
  /** barracks (营房) against the inside of the north and south walls: x range (east side; mirrored west), z from inner edge to the wall, a door in the courtyard side */
  barracks: { x0: 5.8, x1: 12.2, z0: 11.2, wall: 0.45, h: 3.4, door: 0.9, roof: 3.3 },
  spawnS: [0, 50] as [number, number],
  spawnN: [0, -50] as [number, number],
  /** sandstorm cycle (seconds): calm, warning, storm, easing off */
  storm: { calm: 50, warn: 7, storm: 30, ease: 7 },
  /** beacon: seconds of holding F to light (or put out) it, how long it burns, then cooldown */
  beaconHold: 2.5,
  beaconBurn: 25,
  beaconCool: 15,
  beaconDmg: 1.12,
  /** 飞虫沙暴: chance per round, warning seconds, how long the swarm stays, seconds outdoors before it gets you, how long being eaten takes */
  swarm: { chance: 0.2, warn: 12, dur: 14, grace: 0.5, eat: 2.6 },
};

/** inside a barracks room (x, z within the walls) */
export function inBarracks(x: number, z: number) {
  const K = DESERT.barracks;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  return ax > K.x0 + K.wall && ax < K.x1 - K.wall && az > K.z0 + K.wall && az < DESERT.fort.half - DESERT.fort.wall;
}
/** under a roof: a barracks room, or the gate passage under the gate tower */
export function desertIndoor(x: number, z: number, y: number) {
  const F = DESERT.fort;
  if (y > 3) return false;
  if (inBarracks(x, z)) return true;
  return Math.abs(x) < F.gate + 0.05 && Math.abs(z) > F.half - F.wall + 0.3 && Math.abs(z) < F.half - 0.3;
}
/** underside of the roof over (x, z) (the camera keeps under it), or a large number in the open */
export function desertCeil(x: number, z: number) {
  if (inBarracks(x, z)) return DESERT.barracks.roof;
  const F = DESERT.fort;
  if (Math.abs(x) < F.gate && Math.abs(z) > F.half - F.wall && Math.abs(z) < F.half) return 5.1;
  return 999;
}

/** rolling dunes; flat packed earth round the fort and in the two camps */
export function desertDunes(x: number, z: number) {
  const m = Math.max(Math.abs(x), Math.abs(z));
  const fortFade = Math.min(1, Math.max(0, (m - 25) / 10));
  const campS = Math.hypot(x - DESERT.spawnS[0], z - DESERT.spawnS[1]);
  const campN = Math.hypot(x - DESERT.spawnN[0], z - DESERT.spawnN[1]);
  const campFade = Math.min(1, Math.max(0, (Math.min(campS, campN) - 9) / 8));
  const d =
    Math.sin(x * 0.21 + Math.sin(z * 0.09) * 1.7) * 0.75 +
    Math.sin(z * 0.17 - x * 0.07 + 1.3) * 0.55 +
    Math.sin((x + z) * 0.37 + 0.6) * 0.18 +
    0.9;
  // dunes swell into big sand banks at the edge of the battlefield
  const edge = Math.max(0, Math.hypot(x, z) - DESERT.radius + 8) * 0.35;
  return Math.max(0, d) * fortFade * campFade + edge;
}

/** Walkable height of 大漠玉门关 at (x, z) */
export function desertHeight(x: number, z: number) {
  const F = DESERT.fort;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const m = Math.max(ax, az);
  let h = desertDunes(x, z);
  for (const M of DESERT.mesas) {
    const dx = Math.abs(x - M.x);
    if (dx < M.hx && az < M.hz) h = Math.max(h, M.h);
    // ramp of drifted sand up the fort side
    const toward = Math.sign(M.rampFrom - M.x);
    const edgeX = M.x + toward * M.hx;
    const t = (x - M.rampFrom) / (edgeX - M.rampFrom);
    if (t > 0 && t <= 1 && az < M.rampHalfW) h = Math.max(h, M.h * t);
  }
  if (m >= F.half - F.wall && m <= F.half) {
    // the wall ring
    if (az >= F.half - F.wall && ax < F.gate) return 0; // gate passage
    if (az >= F.half - F.wall && ax < F.tower) return F.towerH; // gate towers
    if (x < 0 && ax >= F.half - F.wall && az < DESERT.breach.z) return Math.max(h, DESERT.breach.h * (0.75 + 0.25 * Math.cos(z * 1.3))); // collapsed stretch
    const corner = ax >= F.half - F.wall && az >= F.half - F.wall;
    const top = corner ? F.corner : F.h;
    return m > F.half - 0.6 ? top + F.parapet : top;
  }
  if (m < F.half - F.wall) {
    const K = DESERT.barracks;
    if (ax >= K.x0 && ax <= K.x1 && az >= K.z0) {
      // barracks walls (the back wall is the fort wall); a door in the middle of the courtyard side
      const inside = ax > K.x0 + K.wall && ax < K.x1 - K.wall && az > K.z0 + K.wall;
      const door = az < K.z0 + K.wall && Math.abs(ax - (K.x0 + K.x1) / 2) < K.door;
      if (!inside && !door) return K.h;
      return 0;
    }
    const B = DESERT.beacon;
    if (ax < B.half && az < B.half) return B.h;
    if (ax < B.rampHalfW && az >= B.half && az < B.rampTo) return Math.max(0, (B.h * (B.rampTo - az)) / (B.rampTo - B.half));
    const R = DESERT.ramp;
    if (ax > R.inner && az > R.z0) return Math.min(F.h, (F.h * (az - R.z0)) / (R.z1 - R.z0));
    return 0;
  }
  return h;
}

/** inside the fort's walls, out of the wind */
export function desertSheltered(x: number, z: number, y: number) {
  const F = DESERT.fort;
  return Math.max(Math.abs(x), Math.abs(z)) < F.half - F.wall && y < F.h - 1.5;
}

function desertPillars(): Circle[] {
  const out: Circle[] = [];
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  // yardang rocks: wind-carved ridges standing out of the sand (solid)
  const rocks: [number, number, number][] = [
    [30, 30, 2.2], [-31, 28, 2.6], [33, -29, 2.4], [-29, -32, 2.1], [62, 22, 2.8], [-60, -24, 2.6], [58, -30, 2.0], [-62, 26, 2.4],
    [18, 40, 1.4], [-20, -40, 1.4], [-16, 38, 1.2], [21, -37, 1.3],
  ];
  for (const [x, z, r] of rocks) out.push({ x, z, r });
  // dead poplars (胡杨)
  for (const [x, z] of [[26, 14], [-26, -12], [-27, 15], [27, -16], [12, 58], [-12, -58], [40, 52], [-42, -50]] as [number, number][]) out.push({ x, z, r: 0.45 });
  // the camps: tents and carts
  for (const sz of [1, -1]) {
    const cz = sz > 0 ? DESERT.spawnS[1] : DESERT.spawnN[1];
    out.push({ x: -8, z: cz + sz * 3, r: 1.9 }, { x: 8, z: cz + sz * 3, r: 1.9 }, { x: -6, z: cz - sz * 5, r: 0.9, h: 1.1 }, { x: 6.5, z: cz - sz * 4.5, r: 0.9, h: 1.1 });
  }
  // crates and wells in the courtyard (crates you can hop onto)
  for (const [x, z] of [[-6, 9], [6.5, -9.5], [-11, -7], [11, 7.5]] as [number, number][]) out.push({ x, z, r: 0.75, h: 1.0 });
  for (const [x, z] of DESERT.wells) out.push({ x, z, r: 0.85, h: 0.85 });
  void rand;
  return out;
}

MAPS.desert = {
  id: 'desert',
  name: '大漠玉门关',
  subtitle: '春风不度玉门关。黄沙里的夯土关城，两队各守一边营地。50Q 大地图',
  icon: '🏜️',
  sizeClass: '50Q',
  mechanics: [
    '50Q 大地图：两队营地在关城南北两头，关城在正中',
    '关城有南北两道城门；西墙塌了一段，跳一下就能翻过去；东西两面城墙内侧各有两条马道上城头',
    '城头一圈走道连着四角的角楼，居高临下；外侧有垛口挡着，被打出城墙会摔进沙里',
    '正中是烽火台：站上台顶按住 F 点燃烽火，己方 25 秒内伤害 +12%，沙暴里也能看清每个敌人；敌人站上去按住 F 能把火踩灭',
    '城里东西各一口井：F 摇辘轳把水桶放下去打水，提上来捧着喝，回复已损失气血 10%（动一下或挨打就中断）',
    '沙暴：大约一分半一次，起风前天边先发黄。沙暴里看不清远处的人，城外和城头会被风吹着走；在外面待满 3 秒开始掉血（每秒 30），躲进城里或屋里就没事',
    '龙卷风：浓沙暴里会从上风处卷起一股龙卷风，在城外沙丘上游走（进不了城）。靠近 3 米就会被卷进去，转着圈带上十几米高再甩出去，摔下来掉 150 血并倒地',
    '东西两头各有一座雅丹土台，顺着沙坡爬上去；风蚀的土柱和枯胡杨挡路也挡暗器',
    '飞虫沙暴：每局有五分之一的机会来一次。天边黑压压一片涌过来时只有 12 秒，必须躲进屋里（城墙内侧的四间营房，或者城门洞底下）。留在外面的人会被虫群吃掉：从头开始化成沙粒随风散去，当场倒下，队友也扶不起来',
  ],
  homeClass: 'Shadowblade',
  homeClassName: '影刃',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: DESERT.radius,
  spawnPlayer: DESERT.spawnS,
  spawnEnemy: DESERT.spawnN,
  background: '#e7c79a',
  fog: [60, 260],
  hemi: ['#ffe2b8', '#7a5a3a', 0.85],
  keyColor: '#ffd29a',
  keyIntensity: 2.3,
  exposure: 0.9,
  bloom: 0.75,
  cardGradient: 'from-amber-700/70 via-orange-900/70 to-zinc-950/90',
  pillars: desertPillars(),
};

export const MAP_ORDER: MapId[] = ['temple', 'lavacliff', 'sea', 'glacier', 'forest', 'desert', 'rooftop', 'summit'];

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
  /** which hiding place the candle-shade is in this round (-1 = it has been taken from there) */
  shadeSpot: 0,
  /** candles and shades put down somewhere (on the ground or hung on a lookout tree) */
  items: [] as PlacedItem[],
  /** 怒海战船 mounted crossbows: aim, who is on it (-1 nobody), reload 0..1, recoil kick */
  ballistae: [] as { yaw: number; user: number; load: number; kick: number }[],
  /** 怒海战船: world x of each ship (the helms move them), and how hard each helm is being worked (0..1) */
  shipX: [-24, 24] as [number, number],
  helm: [0, 0] as [number, number],
  /** crossbow bolts in flight or stuck in the planks (t: seconds left; stuck: embedded) */
  bolts: [] as { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; stuck: boolean; slot: number }[],
  /** where the local player is (scenery uses it to show F markers near things you can use) */
  viewX: 0,
  viewY: 0,
  viewZ: 0,
  /** what the local player carries: 0 nothing, 1 a candle, 2 only the shade */
  viewCarry: 0,
  /** 大漠玉门关: sandstorm 0..1, warning glow on the horizon 0..1, wind along x (+1 / -1); the beacon: lit by side (-1 none), seconds left, cooldown */
  /** the local player's side (scenery colours the beacon flag ours / theirs) */
  viewSide: 0,
  desert: { sand: 0, warn: 0, wind: 1, beaconSide: -1, beaconT: 0, beaconCool: 0, swarmAt: -1, swarmWarn: 0, swarm: 0, swarmLeft: 0, wells: [] as { t: number; x: number; y: number; z: number; yaw: number }[], tornado: null as null | { x: number; z: number; vx: number; vz: number; a: number; life: number } },
};

// ----------------------------------------------------------------------
// 雪岭冰峰 terrain: a whole snow mountain you can fight your way up.
// Shared by the physics (Game) and the mesh (Maps3D).
// ----------------------------------------------------------------------
export const GLACIER = {
  summit: [0, g1(-16)] as [number, number], // x, z of the peak
  summitH: 25, // height of the peak
  footR: g1(30), // radius (from the summit) where the mountain meets the valley floor
  stepH: 4, // terrace height: flat ledges to rest on, steep risers to climb
  pathHalf: 2.0, // half-width of the switchback road
  avalancheX: [g1(-8), g1(8)] as [number, number], // avalanches pour down this band of the south face
  avalancheTop: g1(-12), // z where they break loose
  avalancheEnd: g1(27), // z where they run out on the valley floor
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
  const G = GROW;
  if (ro > 40 * G) h += sstep(40 * G, 50 * G, ro) * 9 + sstep(58 * G, 92 * G, ro) * 18 + Math.sin(Math.atan2(z, x) * 7 + ro * 0.15) * sstep(40 * G, 54 * G, ro) * 1.5;
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
    const r = (41.5 + Math.pow(rand(), 0.8) * 55) * GROW;
    GLACIER_PINES.push([Math.cos(a) * r, Math.sin(a) * r, 1.0 + rand() * 1.2]);
  }
  for (let k = 0; k < 400 && GLACIER_PINES.length < 500; k++) {
    const a = rand() * Math.PI * 2;
    const r = (9 + rand() * 20) * GROW;
    const x = sx + Math.cos(a) * r;
    const z = sz + Math.sin(a) * r;
    if (Math.hypot(x, z) > 38.5 * GROW) continue;
    if (glacierPath(x, z).d < GLACIER.pathHalf + 2.4) continue;
    if (x > GLACIER.avalancheX[0] - 2 && x < GLACIER.avalancheX[1] + 2 && z > GLACIER.avalancheTop) continue;
    GLACIER_PINES.push([x, z, 0.7 + rand() * 0.5]);
  }
  for (let k = 0; k < 60; k++) {
    const a = rand() * Math.PI * 2;
    const r = (38 + rand() * 3) * GROW;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.hypot(x - sx, z - sz) < GLACIER.footR + 2) continue;
    GLACIER_PINES.push([x, z, 0.9 + rand() * 0.6]);
  }
  rand = frand(44);
  for (let k = 0; k < 120 && GLACIER_ROCKS.length < 45; k++) {
    const a = rand() * Math.PI * 2;
    const r = (5 + rand() * 22) * GROW;
    const x = sx + Math.cos(a) * r;
    const z = sz + Math.sin(a) * r;
    if (Math.hypot(x, z) > 38 * GROW) continue;
    if (glacierPath(x, z).d < GLACIER.pathHalf + 2.2) continue;
    if (x > GLACIER.avalancheX[0] - 1 && x < GLACIER.avalancheX[1] + 1 && z > GLACIER.avalancheTop) continue;
    const s = 0.6 + rand() * 1.1;
    GLACIER_ROCKS.push({ x, z, y: glacierHeight(x, z) - s * 0.35, sx: s * (1 + rand()), sy: s * (0.6 + rand() * 0.5), sz: s * (0.8 + rand() * 0.6), rx: rand() * 0.4, ry: rand() * 6, rz: rand() * 0.4 });
  }
  // solid (no standing on them: on the slopes they would be steps up the mountain)
  const P = MAPS.glacier.pillars!;
  for (const [x, z, sc] of GLACIER_PINES) if (Math.hypot(x, z) < 41.5 * GROW) P.push({ x, z, r: 1.05 * sc });
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
export const ROOF_RAW = {
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
/** the palace 1.3x bigger: every hall and corridor footprint spread out from the centre */
export const ROOF = {
  ...ROOF_RAW,
  halls: ROOF_RAW.halls.map((h) => ({ ...h, x0: g1(h.x0), x1: g1(h.x1), z0: g1(h.z0), z1: g1(h.z1) })),
  corridors: ROOF_RAW.corridors.map(([a, b, c, d]) => [g1(a), g1(b), g1(c), g1(d)] as [number, number, number, number]),
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
  if (id === 'sea') return shipFloorAt(x, z, 99);
  if (id === 'glacier') return glacierHeight(x, z);
  if (id === 'forest') return forestHeight(x, z);
  if (id === 'rooftop') return roofHeight(x, z);
  if (id === 'desert') return desertHeight(x, z);
  return 0;
}
/** Uphill gradient of the walkable surface. Sheer drops (roof edge to street) are ignored so nobody slides off an edge. */
export function terrainGradient(id: MapId, x: number, z: number): [number, number] {
  if (id === 'glacier') return glacierGradient(x, z);
  if (id === 'forest') {
    const e = 0.25;
    return [(forestHeight(x + e, z) - forestHeight(x - e, z)) / (2 * e), (forestHeight(x, z + e) - forestHeight(x, z - e)) / (2 * e)];
  }
  if (id !== 'rooftop' && id !== 'desert') return [0, 0];
  const e = 0.25;
  const hf = id === 'desert' ? desertHeight : roofHeight;
  const h0 = hf(x, z);
  const s = (dx: number, dz: number) => {
    const v = hf(x + dx, z + dz);
    if (id === 'desert' && Math.abs(v - h0) > 0.5) return h0; // a wall face or ledge, not a slope
    return v < h0 - 1.2 ? h0 : v;
  };
  return [(s(e, 0) - s(-e, 0)) / (2 * e), (s(0, e) - s(0, -e)) / (2 * e)];
}

// ----------------------------------------------------------------------
// 怒海战船: a great war junk, five storeys of cabins. The ship is a set of solid boxes
// (deck slabs, cabin walls, stair treads, filled-in hull); everything stands on them.
//   -1  the hold under the main deck (a hatch and stairs in the middle of the deck), a table of food
//    0  the main deck; the fore cabin and the great cabin
//    1  the forecastle; the quarterdeck, over the captain's cabin
//    2  the poop deck, over the hall
//    3  the castle deck, over the lookout cabin
//    4  the roof of the stern tower
// Every raised deck is reached by stairs running fore-and-aft along both bulwarks.
// ----------------------------------------------------------------------
export interface ShipBox { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; kind: 'slab' | 'wall' | 'tread' | 'block' | 'fill' | 'table' | 'rail'; flight?: ShipFlight }
export interface ShipFlight { foot: number; head: number; y0: number; rise: number; n: number; side: boolean }
const H = 4.4;
export const SHIP_LAYOUT = {
  W: 12.4, // boxes run out to here (inside the hull)
  slab: 0.4,
  H,
  holdY: -H,
  hold: { z0: -25.6, z1: 13.6, side: 10.4, hole: { x: 1.8, z0: -4.2, z1: 4.2 } },
  fore: { edge: -26, y: H },
  /** the stern tower: where each deck begins (its front edge) and its height; the cabin of the level below sits under it */
  tiers: [
    { edge: 14, y: H },
    { edge: 22, y: 2 * H },
    { edge: 28, y: 3 * H },
    { edge: 33, y: 4 * H },
  ],
  sternEnd: 39.8,
  foreEnd: -38,
  wallT: 0.35,
  door: 1.6,
  lintel: 3.0,
  stairX: 8.8,
  flights: [
    { foot: -16, head: -26, y0: 0, rise: H, n: 15, side: true },
    { foot: 4, head: 14, y0: 0, rise: H, n: 15, side: true },
    { foot: 15, head: 22, y0: H, rise: H, n: 15, side: true },
    { foot: 22.6, head: 28, y0: 2 * H, rise: H, n: 15, side: true },
    { foot: 28.6, head: 33, y0: 3 * H, rise: H, n: 15, side: true },
    // down through the hatch into the hold (the bottom toward the bow)
    { foot: -4.2, head: 4.2, y0: -H, rise: H, n: 15, side: false },
  ] as ShipFlight[],
  /** the food in the hold: F to eat, heals 10% of what you've lost */
  table: { x: 0, z: -11.8, hx: 2.2, hz: 1.2, h: 0.8 },
  meal: { share: 0.1, cooldown: 12 },
  /** mounted crossbows: where they stand, which way they face by default (yaw) */
  ballistae: [
    { x: 0, z: -31.5, y: H, yaw: Math.PI },
    { x: 0, z: 30.5, y: 3 * H, yaw: 0 },
  ],
  ballistaArc: 1.75, // ±100°: fore and aft, and across at the other ship
  /** the two-storey pavilion on the roof (solid) */
  pavilion: { hw: 8, z0: 36.2, z1: 39.8, h: 2.9 },
};
function buildShipBoxes() {
  const L = SHIP_LAYOUT;
  const W = L.W;
  const s = L.slab;
  const out: ShipBox[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, kind: ShipBox['kind']) => out.push({ x0, x1, y0, y1, z0, z1, kind });
  const hold = L.hold;
  // the hull below the main deck is filled in, except the hold
  box(-W, W, L.holdY, 0, -80, hold.z0, 'fill');
  box(-W, W, L.holdY, 0, hold.z1, 80, 'fill');
  box(-W, -hold.side, L.holdY, -s, hold.z0, hold.z1, 'block');
  box(hold.side, W, L.holdY, -s, hold.z0, hold.z1, 'block');
  // the main deck over the hold, with the hatch
  box(-W, W, -s, 0, hold.z0, hold.hole.z0, 'slab');
  box(-W, W, -s, 0, hold.hole.z1, hold.z1, 'slab');
  box(-W, -hold.hole.x, -s, 0, hold.hole.z0, hold.hole.z1, 'slab');
  box(hold.hole.x, W, -s, 0, hold.hole.z0, hold.hole.z1, 'slab');
  // a waist-high railing round three sides of the hatch (the stairs go down from its open, sternward side)
  const hh = hold.hole;
  box(-hh.x - 0.2, -hh.x, 0, 1.0, hh.z0 - 0.2, hh.z1, 'rail');
  box(hh.x, hh.x + 0.2, 0, 1.0, hh.z0 - 0.2, hh.z1, 'rail');
  box(-hh.x - 0.2, hh.x + 0.2, 0, 1.0, hh.z0 - 0.2, hh.z0, 'rail');
  // the pavilion on the roof of the stern tower
  const P = L.pavilion;
  box(-P.hw, P.hw, L.tiers[3].y, L.tiers[3].y + P.h, P.z0, P.z1, 'block');
  // the table of food
  const T = L.table;
  box(T.x - T.hx, T.x + T.hx, L.holdY, L.holdY + T.h, T.z - T.hz, T.z + T.hz, 'table');
  // a cabin front: wall either side of a door, and a beam over it
  const front = (z: number, y0: number, y1: number, outward: 1 | -1) => {
    const za = outward > 0 ? z - L.wallT : z;
    const zb = outward > 0 ? z : z + L.wallT;
    box(-W, -L.door, y0, y1, za, zb, 'wall');
    box(L.door, W, y0, y1, za, zb, 'wall');
    box(-L.door, L.door, y0 + L.lintel, y1, za, zb, 'wall');
  };
  // forecastle over the fore cabin; the bow beyond the cabin is solid
  box(-W, W, L.fore.y - s, L.fore.y, -80, L.fore.edge, 'slab');
  front(L.fore.edge, 0, L.fore.y - s, 1);
  box(-W, W, 0, L.fore.y - s, -80, L.foreEnd, 'block');
  // the stern tower: one deck per tier, the cabin under it opening onto the deck in front
  L.tiers.forEach((t, i) => {
    const below = i === 0 ? 0 : L.tiers[i - 1].y;
    box(-W, W, t.y - s, t.y, t.edge, 80, 'slab');
    front(t.edge, below, t.y - s, -1);
  });
  // stairs
  for (const f of L.flights)
    for (const sd of f.side ? [-1, 1] : [0])
      for (let k = 0; k < f.n; k++) {
        const za = f.foot + ((f.head - f.foot) * k) / f.n;
        const zb = f.foot + ((f.head - f.foot) * (k + 1)) / f.n;
        const x0 = sd > 0 ? L.stairX : sd < 0 ? -W : -hold.hole.x;
        const x1 = sd > 0 ? W : sd < 0 ? -L.stairX : hold.hole.x;
        // (a hair of overlap so there's never a crack between two steps)
        box(x0, x1, f.y0, f.y0 + (f.rise * (k + 1)) / f.n, Math.min(za, zb) - 0.01, Math.max(za, zb) + 0.01, 'tread');
        out[out.length - 1].flight = f;
      }
  return out;
}
export const SHIP_BOXES = buildShipBoxes();
const inXZ = (b: ShipBox, x: number, z: number, r = 0) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r;
// a coarse grid over the ship: each 2 m cell lists the boxes within reach of it, so a floor / wall query looks at a
// handful of boxes instead of all ~300 (the camera alone asks twenty times a frame)
const SG = { cell: 2, x0: -14, z0: -82, nx: 14, nz: 82, pad: 0.6 };
const SHIP_GRID: ShipBox[][] = (() => {
  const g: ShipBox[][] = Array.from({ length: SG.nx * SG.nz }, () => []);
  for (const b of SHIP_BOXES) {
    const i0 = Math.max(0, Math.floor((b.x0 - SG.pad - SG.x0) / SG.cell));
    const i1 = Math.min(SG.nx - 1, Math.floor((b.x1 + SG.pad - SG.x0) / SG.cell));
    const j0 = Math.max(0, Math.floor((b.z0 - SG.pad - SG.z0) / SG.cell));
    const j1 = Math.min(SG.nz - 1, Math.floor((b.z1 + SG.pad - SG.z0) / SG.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) g[j * SG.nx + i].push(b);
  }
  return g;
})();
/** the boxes that can matter at (x, z) (reach up to SG.pad) */
function shipNear(x: number, z: number): ShipBox[] {
  const i = Math.floor((x - SG.x0) / SG.cell);
  const j = Math.floor((z - SG.z0) / SG.cell);
  if (i < 0 || j < 0 || i >= SG.nx || j >= SG.nz) return SHIP_BOXES;
  return SHIP_GRID[j * SG.nx + i];
}
/** the highest surface under (x, z) that a fighter whose feet are at y stands on (steps up to 0.6 m count) */
export function shipFloorAtL(x: number, z: number, y: number) {
  let g = SHIP_LAYOUT.holdY;
  for (const b of shipNear(x, z)) {
    if (!inXZ(b, x, z)) continue;
    // a stair is walked as a ramp through the middle of its treads (no 30 cm hop per step)
    const top = b.flight ? stairRamp(b.flight, z) : b.y1;
    if (top <= y + 0.6 && top > g) g = top;
  }
  return g;
}
function stairRamp(f: ShipFlight, z: number) {
  const t = Math.min(1, Math.max(0, (z - f.foot) / (f.head - f.foot) + 0.5 / f.n));
  return f.y0 + f.rise * t;
}
/** the underside of whatever is overhead (a deck above a cabin); Infinity in the open */
export function shipCeilAtL(x: number, z: number, y: number) {
  let c = Infinity;
  for (const b of shipNear(x, z)) if (b.y0 >= y + 0.3 && b.y0 < c && inXZ(b, x, z)) c = b.y0;
  return c;
}
/** would a fighter (radius r) with feet at y overlap something solid here? Low steps don't count */
export function shipBlockedL(x: number, z: number, y: number, r = 0.38) {
  // stair treads are shallow: a smaller reach there, so the next step up never counts as a wall
  for (const b of r <= SG.pad ? shipNear(x, z) : SHIP_BOXES) if (b.y1 > y + 0.55 && b.y0 < y + 1.75 && inXZ(b, x, z, b.kind === 'tread' ? Math.min(r, 0.05) : r)) return true;
  return false;
}
/** is the point inside a solid (camera, projectiles) */
export function shipSolidAtL(x: number, y: number, z: number, r = 0, skipSteps = false) {
  for (const b of r <= SG.pad ? shipNear(x, z) : SHIP_BOXES) if (!(skipSteps && (b.kind === 'tread' || b.kind === 'rail')) && y > b.y0 - r && y < b.y1 + r && inXZ(b, x, z, r)) return true;
  return false;
}
// the crates and crossbow posts stand on whatever deck is under them, and only there
for (const p of MAPS.sea.pillars || []) if (p.h !== undefined) p.y0 = shipFloorAtL(p.x, p.z, p.h - 0.9);

// ----------------------------------------------------------------------
// 怒海战船 is fought between TWO junks lying side by side, one per team. Each ship's geometry is the same
// (ship-local coordinates above); a ship sits at world x = mapRuntime.shipX[k]. The helms close or open the gap.
// Every query below takes world coordinates and asks the ship whose side of the gap the point is on.
// ----------------------------------------------------------------------
export const SHIP_GAP = { start: 48, min: 26.1, max: 56, speed: 1.7 }; // min: the hulls (12.9 m half beam) just touching
/** the helm (船舵) on each ship: on the main deck just forward of the great cabin (ship-local) */
export const SHIP_HELM = { x: 0, z: 11.4, r: 0.55 };
export function shipOf(x: number) {
  const s = mapRuntime.shipX;
  return x < (s[0] + s[1]) / 2 ? 0 : 1;
}
/** is (x, z) over a ship's hull (rather than open water between or beside them) */
export function overShip(x: number, z: number) {
  const k = shipOf(x);
  return Math.abs(x - mapRuntime.shipX[k]) < SHIP_LAYOUT.W + 0.2 && z > -52 && z < 41;
}
export function shipFloorAt(x: number, z: number, y: number) {
  const k = shipOf(x);
  return shipFloorAtL(x - mapRuntime.shipX[k], z, y);
}
export function shipCeilAt(x: number, z: number, y: number) {
  const k = shipOf(x);
  return shipCeilAtL(x - mapRuntime.shipX[k], z, y);
}
export function shipBlocked(x: number, z: number, y: number, r = 0.38) {
  const k = shipOf(x);
  return shipBlockedL(x - mapRuntime.shipX[k], z, y, r);
}
export function shipSolidAt(x: number, y: number, z: number, r = 0, skipSteps = false) {
  const k = shipOf(x);
  return shipSolidAtL(x - mapRuntime.shipX[k], y, z, r, skipSteps);
}
/** the sea map's pillars as laid out on one ship (masts, crates, crossbow posts) */
export const SEA_PILLARS_LOCAL: Circle[] = (MAPS.sea.pillars || []).map((p) => ({ ...p }));
/** both ships' pillars in world coordinates (moved with the ships by syncShips) */
MAPS.sea.pillars = [0, 1].flatMap((k) => SEA_PILLARS_LOCAL.map((p) => ({ ...p, ship: k, lx: p.x })));
/** world positions of every crossbow (ship 0's, then ship 1's), kept in step with the ships */
export const SEA_BALLISTAE: { x: number; y: number; z: number; yaw: number; ship: number }[] = [0, 1].flatMap((k) => SHIP_LAYOUT.ballistae.map((b) => ({ ...b, ship: k })));
/** after the ships move: pillars and crossbows follow */
export function syncShips() {
  for (const p of MAPS.sea.pillars!) p.x = (p.lx ?? 0) + mapRuntime.shipX[p.ship ?? 0];
  const n = SHIP_LAYOUT.ballistae.length;
  SEA_BALLISTAE.forEach((b, i) => (b.x = SHIP_LAYOUT.ballistae[i % n].x + mapRuntime.shipX[b.ship]));
}
/** the hold's food table on ship k (world) */
export function shipTable(k: number) {
  const T = SHIP_LAYOUT.table;
  return { ...T, x: T.x + mapRuntime.shipX[k] };
}
/** which room or deck a point is on (for the AI's routing) */
export type ShipRegion = 'hold' | 'deck' | 'foreCabin' | 'fore' | 'greatCabin' | 'quarter' | 'captain' | 'poop' | 'hall' | 'castle' | 'lookout' | 'roof';
export function shipLevel(y: number) {
  return Math.floor((y + 1.6) / SHIP_LAYOUT.H);
}
export function shipRegion(x: number, y: number, z: number): ShipRegion {
  const L = SHIP_LAYOUT;
  const lv = shipLevel(y);
  const inside = (edge: number) => z > edge + L.wallT * 0.5;
  if (lv <= -1) return 'hold';
  if (lv === 0) {
    if (z < L.fore.edge - L.wallT * 0.5) return 'foreCabin';
    if (inside(L.tiers[0].edge)) return 'greatCabin';
    return 'deck';
  }
  if (lv === 1) {
    if (z < 0) return 'fore';
    return inside(L.tiers[1].edge) ? 'captain' : 'quarter';
  }
  if (lv === 2) return inside(L.tiers[2].edge) ? 'hall' : 'poop';
  if (lv === 3) return inside(L.tiers[3].edge) ? 'lookout' : 'castle';
  return 'roof';
}
// ----------------------------------------------------------------------
// 天阙之巅: three concentric jade rings that break away during the round.
// ----------------------------------------------------------------------
export const SUMMIT = {
  rings: [g1(22), g1(15), g1(8.5)] as const, // outer radius of the floor at stage 0, 1, 2
  breakAt: [45, 95] as const, // seconds into the round
  warn: 3,
};
