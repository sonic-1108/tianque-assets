import { CharacterClassId } from './types';

export type MapId = 'experimental' | 'quarry' | 'temple' | 'lavacliff' | 'sea' | 'glacier' | 'bamboo' | 'rooftop' | 'summit' | 'forest' | 'desert' | 'plankway' | 'wending' | 'coast' | 'losangeles';

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
  /** where the sun is (a direction toward it); the key light comes from there instead of the usual high right */
  sunDir?: [number, number, number];
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

/** 青冥古林 is spread out much further than the arenas: its radius is 200 m (58 m before any growing) */
export const FGROW = 200 / 58;
const gf = (v: number) => Math.round(v * FGROW * 100) / 100;

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
  const u = x / FGROW; // the whole forest is spread out FGROW times: the river's meanders with it
  return FGROW * (2 + 6 * Math.sin(u * 0.045 + 0.4) + 2 * Math.sin(u * 0.11 + 1.3));
}
export const FOREST = {
  radius: gf(58),
  /** the two camps, either side of the river (closer in than the edge, so a round doesn't open with a long march) */
  spawnZ: [70, -68] as [number, number],
  waterY: -0.55, // river surface
  swimY: -1.5, // a swimmer's feet: body level with the surface
  deepHalf: 4.2, // half width of the deep channel
  bankHalf: 8.0, // where the banks meet the forest floor
  bedY: -3.0,
  ford: [gf(-34), gf(-24)] as [number, number], // x range where the river runs shallow (waist-deep wading)
  bridge: { x: gf(21), half: 1.6, deck: 0.7 }, // footbridge across the river at x = 21 (+-half), deck height at the middle
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
  hill: { x: gf(-26), z: gf(-33), r: 20, top: 13, h: 5.5 },
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
/**
 * 青冥古林's newer corners (all in world metres):
 *   瀑布: a rock bluff on the east edge; the river comes over it into a deep pool. A cave runs in behind the falling
 *         water (its mouth just north of the fall): dry, out of the rain and the lightning, an oil lamp inside.
 *         A rubble ramp climbs the bluff's north end to a lookout over the fall.
 *   猎户营地: tents round a campfire (it lights the clearing at night), a rack of hunters' traps (F takes one).
 *   竹林: a dense bamboo grove; the 石灯笼 path runs from the north camp down past it to the ford, lit at night.
 *   古塔: a ruined pagoda, a stone platform and the broken first and second storeys, climbed by rubble slopes.
 *   沼泽: a sunken bog of black water and reeds. Wading in it is slow and it poisons; its mist hides you.
 */
export const FOREST_X = {
  bluff: { x0: 183, x1: 230, z0: -18, z1: 60, h: 12 },
  pool: { x: 171, z: riverZ(171), r: 11 },
  fall: { x: 181.2, z0: riverZ(182) - 4, z1: riverZ(182) + 4 },
  cave: { x0: 183, x1: 193, z0: riverZ(182) - 6, z1: riverZ(182) + 8.5, mouth: [riverZ(182) + 4.5, riverZ(182) + 8.5] as [number, number], floor: 0.3, roof: 4.2 },
  /** the rubble ramp up the bluff's north end: from (x0, z) at the bottom to (x1, z) at the top */
  ramp: { x0: 160, x1: 184, z: 56.5, half: 2.2 },
  camp: { x: 108, z: -96, r: 15, fire: [108, -96] as [number, number], rack: [116.5, -91] as [number, number], tents: [[100, -103, 0.6], [116, -103, -0.7], [99, -88, 2.4]] as [number, number, number][] },
  bamboo: { x: -128, z: 72, r: 30, clumps: [] as [number, number, number][] },
  /** the stone lantern path: lanterns at these points */
  lanterns: [] as [number, number][],
  lanternPath: [[-30, 74], [-58, 62], [-84, 46], [-98, 26], [-102, 4]] as [number, number][],
  pagoda: { x: 42, z: -122, base: 9.5, baseH: 1.0, s1: 7, s1H: 4.6, s2: 3.8, s2H: 6.8 },
  swamp: { x: 132, z: -36, r: 27, snags: [] as [number, number, number][] },
  /** the pagoda's fallen spire: drums lying in the grass south-west of it (x, z, radius, yaw) */
  spire: [[30.5, -133, 1.25, 0.7], [27.2, -136.5, 1.05, 0.75], [24.4, -139.4, 0.85, 0.8]] as [number, number, number, number][],
  /** log seats round the campfire */
  seats: [] as [number, number, number][],
  /** where herbs can grow (a few at a time) and where the hunters left traps */
  herbSpots: [] as [number, number][],
  trapSpots: [] as [number, number][],
  /** zip lines between lookout decks: indexes into the lookout trees (FOREST.trees with a deck) */
  zips: [] as [number, number][],
};
/** the lights that burn all night: the campfire, the lanterns, the cave lamp (x, z, reach) */
export const FOREST_LIGHTS: [number, number, number][] = [];
// stone lanterns every 11 m along the path
{
  const P = FOREST_X.lanternPath;
  let carry = 4;
  for (let k = 0; k + 1 < P.length; k++) {
    const [ax, az] = P[k];
    const [bx, bz] = P[k + 1];
    const L = Math.hypot(bx - ax, bz - az);
    for (let d = carry; d < L; d += 11) {
      const t = d / L;
      // a lantern each side, alternating, a little off the path
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      const side = FOREST_X.lanterns.length % 2 ? 1 : -1;
      FOREST_X.lanterns.push([ax + (bx - ax) * t + nx * 1.9 * side, az + (bz - az) * t + nz * 1.9 * side]);
      carry = d + 11 - L;
    }
  }
  for (const [x, z] of FOREST_X.lanterns) FOREST_LIGHTS.push([x, z, 8]);
  // bamboo clumps fill the grove; dead snags stand in the bog; three logs to sit on by the fire
  const rb = frand(777);
  const B = FOREST_X.bamboo;
  for (let k = 0; k < 3000 && B.clumps.length < 95; k++) {
    const a = rb() * Math.PI * 2;
    const d = Math.sqrt(rb()) * (B.r - 1);
    const x = B.x + Math.cos(a) * d;
    const z = B.z + Math.sin(a) * d;
    if (B.clumps.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 3.6)) continue;
    B.clumps.push([x, z, 0.7 + rb() * 0.35]);
  }
  const S = FOREST_X.swamp;
  for (let k = 0; k < 400 && S.snags.length < 9; k++) {
    const a = rb() * Math.PI * 2;
    const d = 3 + Math.sqrt(rb()) * (S.r - 5);
    const x = S.x + Math.cos(a) * d;
    const z = S.z + Math.sin(a) * d;
    if (S.snags.some(([cx, cz]) => Math.hypot(cx - x, cz - z) < 7)) continue;
    S.snags.push([x, z, rb() * Math.PI * 2]);
  }
  const [fx, fz] = FOREST_X.camp.fire;
  for (const a of [0.4, 2.5, 4.4]) FOREST_X.seats.push([fx + Math.cos(a) * 3.3, fz + Math.sin(a) * 3.3, a + Math.PI / 2]);
  FOREST_LIGHTS.push([FOREST_X.camp.fire[0], FOREST_X.camp.fire[1], 17]);
  FOREST_LIGHTS.push([(FOREST_X.cave.x0 + FOREST_X.cave.x1) / 2 + 1, (FOREST_X.cave.z0 + FOREST_X.cave.z1) / 2, 7]);
}
/** is (x, z) inside one of the new features (keeps trees, logs and boulders out of them) */
export function inForestFeature(x: number, z: number, pad = 0) {
  const X = FOREST_X;
  const B = X.bluff;
  if (x > B.x0 - 6 - pad && z > B.z0 - 6 - pad && z < B.z1 + 6 + pad) return true;
  if (Math.hypot(x - X.pool.x, z - X.pool.z) < X.pool.r + 4 + pad) return true;
  if (Math.abs(z - X.ramp.z) < X.ramp.half + 3 + pad && x > X.ramp.x0 - 4 && x < X.ramp.x1) return true;
  if (Math.hypot(x - X.camp.x, z - X.camp.z) < X.camp.r + pad) return true;
  if (Math.hypot(x - X.pagoda.x, z - X.pagoda.z) < X.pagoda.base + 7 + pad) return true;
  if (Math.hypot(x - X.swamp.x, z - X.swamp.z) < X.swamp.r + 2 + pad) return true;
  if (Math.hypot(x - X.bamboo.x, z - X.bamboo.z) < X.bamboo.r + 2 + pad) return true;
  for (const [lx, lz] of X.lanterns) if (Math.hypot(x - lx, z - lz) < 2.5 + pad) return true;
  return false;
}
const sstepX = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** pagoda storey heights at (x, z): an octagon of radius r (to its flats) */
function octIn(dx: number, dz: number, r: number) {
  const a = Math.abs(dx);
  const b = Math.abs(dz);
  return a <= r && b <= r && a + b <= r * 1.414;
}
/** the rubble slopes up the pagoda: from the ground over the platform up to storey 1 (south side), and from
 * storey 1's floor up to the broken storey 2 (east side). Null off them. */
export function pagodaSlope(dx: number, dz: number): number | null {
  const P = FOREST_X.pagoda;
  if (Math.abs(dx) < 1.9 && dz <= -P.s1 + 0.3 && dz > -P.base - 5) {
    const t = (-dz - P.s1 + 0.3) / (P.base + 5 - P.s1 + 0.3);
    return P.s1H * (1 - t);
  }
  if (Math.abs(dz - 1.2) < 1.5 && dx >= P.s2 - 0.2 && dx < P.s1 - 0.3) {
    const t = (P.s1 - 0.3 - dx) / (P.s1 - 0.3 - (P.s2 - 0.2));
    return P.s1H + (P.s2H - P.s1H) * t;
  }
  return null;
}
/** extra ground from the new features (null where there's nothing) */
export function forestFeatureHeight(x: number, z: number, h: number): number {
  const X = FOREST_X;
  // the pool below the fall: deep in the middle, a shelving rim
  const pd = Math.hypot(x - X.pool.x, z - X.pool.z);
  if (pd < X.pool.r + 3) h = Math.min(h, -0.2 - 3.2 * (1 - sstepX(X.pool.r * 0.45, X.pool.r + 2.5, pd)));
  // the swamp: black water a hand deep or two, hummocks of dry ground
  const sd = Math.hypot(x - X.swamp.x, z - X.swamp.z);
  if (sd < X.swamp.r + 4) {
    const hum = Math.sin(x * 0.31 + 1.7) * Math.cos(z * 0.27 - 0.4) + Math.sin(x * 0.13 - z * 0.17) * 0.6;
    const bog = -1.15 + Math.max(0, hum - 0.55) * 1.4;
    h = h + (bog - h) * (1 - sstepX(X.swamp.r - 3, X.swamp.r + 4, sd));
  }
  // the bluff: sheer faces, a flat top (the river runs in a notch to the lip)
  const B = X.bluff;
  const inB = x > B.x0 && z > B.z0 && z < B.z1;
  if (inB) {
    let top = B.h + Math.sin(z * 0.2) * 0.3;
    if (Math.abs(z - X.pool.z) < 3.5 && x < B.x0 + 9) top = B.h - 1.2; // the notch the water pours from
    h = Math.max(h, top);
    // the cave: a hollow behind the fall; the rock face (its first metre) is open only at the mouth
    const C = X.cave;
    if (x < C.x1 && z > C.z0 && z < C.z1 && (x > B.x0 + 1.2 || (z >= C.mouth[0] && z <= C.mouth[1]))) h = C.floor;
  }
  // the ramp up the north end of the bluff
  const R = X.ramp;
  if (Math.abs(z - R.z) < R.half && x > R.x0 && x < R.x1 + 1) h = Math.max(h, B.h * Math.max(0, Math.min(1, (x - R.x0) / (R.x1 - R.x0))));
  // the pagoda: platform, two storeys, the rubble between
  const P = X.pagoda;
  const dx = x - P.x;
  const dz = z - P.z;
  if (octIn(dx, dz, P.base)) {
    let ph = P.baseH;
    if (octIn(dx, dz, P.s1)) ph = P.s1H;
    if (octIn(dx, dz, P.s2) && dx + dz > -1.5) ph = P.s2H; // storey 2 stands on its north-east half only (the rest fell)
    h = Math.max(h, ph);
  }
  const sl = pagodaSlope(dx, dz);
  if (sl !== null) h = Math.max(h, sl);
  return h;
}
/** a zip line: anchors on the two lookout decks (hand height), deck heights, length */
export function zipLine(k: number) {
  const decks = FOREST.trees.filter((t) => t[3] > 0);
  const [a, b] = FOREST_X.zips[k];
  const A = decks[a];
  const B = decks[b];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const ux = (B[0] - A[0]) / L;
  const uz = (B[1] - A[1]) / L;
  const ra = A[2] + 0.75;
  const rb = B[2] + 0.75;
  return { ax: A[0] + ux * ra, az: A[1] + uz * ra, ay: A[3] + 2.45, deckA: A[3], bx: B[0] - ux * rb, bz: B[1] - uz * rb, by: B[3] + 2.45, deckB: B[3], len: L - ra - rb };
}
/** the rope at fraction t (0 = end a, 1 = end b), sagging in the middle */
export function zipAt(k: number, t: number): [number, number, number] {
  const Z = zipLine(k);
  return [Z.ax + (Z.bx - Z.ax) * t, Z.ay + (Z.by - Z.ay) * t - 0.035 * Z.len * Math.sin(Math.PI * t), Z.az + (Z.bz - Z.az) * t];
}
/** inside the cave behind the waterfall */
export function inCave(x: number, z: number, y: number) {
  const C = FOREST_X.cave;
  return x > FOREST_X.bluff.x0 - 0.2 && x < C.x1 && z > C.z0 && z < C.z1 && y < C.floor + C.roof;
}
/** the rock over the cave: its top (the bluff's) where (x, z) is over the cave, else null */
export function caveRoofAt(x: number, z: number): number | null {
  const C = FOREST_X.cave;
  if (x > FOREST_X.bluff.x0 && x < C.x1 && z > C.z0 && z < C.z1) return FOREST_X.bluff.h + Math.sin(z * 0.2) * 0.3;
  return null;
}
/** in the swamp's black water (wading) */
export function inSwamp(x: number, z: number) {
  const S = FOREST_X.swamp;
  return Math.hypot(x - S.x, z - S.z) < S.r;
}
/** a lit night light (campfire, lantern, cave lamp) reaches (x, z) */
export function fixedLightAt(x: number, z: number) {
  for (const [lx, lz, r] of FOREST_LIGHTS) if (Math.hypot(x - lx, z - lz) < r) return true;
  return false;
}

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
  if (inCave(x, z, y)) return true;
  const [lx, lz] = worldToTemple(x, z);
  return Math.abs(lx + 7.2) < 1.9 && Math.abs(lz - 8.6) < 1.9 && y > FOREST.hill.h - 0.5 && y < FOREST.hill.h + 5;
}
/**
 * 青冥古林's three 祖坛 (ancestral altars): stand at one with nobody from the other side there and you light its incense
 * (SHRINE.capture seconds from bare, twice that to turn one of theirs). Each one you hold scores every second; the first
 * side to SHRINE.goal wins. Being cut down only costs you time: you're back at your camp after SHRINE.respawn seconds.
 */
export const SHRINE = { r: 3.2, capture: 5, goal: 100, respawn: 8, rate: [0, 1, 2.5, 5], koBonus: 5 };
export const SHRINES: { name: string; x: number; y: number; z: number }[] = (() => {
  const [tx, tz] = templeToWorld(0, 10.6);
  const P = FOREST_X.pagoda;
  const C = FOREST_X.cave;
  return [
    { name: '古寺', x: tx, y: FOREST.hill.h, z: tz },
    { name: '古塔', x: P.x - 3.4, y: P.s1H, z: P.z - 3.4 },
    { name: '山洞', x: (C.x0 + C.x1) / 2 + 1.5, y: C.floor, z: (C.z0 + C.z1) / 2 },
  ];
})();
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
    if (inForestFeature(x, z, pad + 2)) return false;
    if (Math.hypot(x, z - FOREST.spawnZ[0]) < 7 || Math.hypot(x, z - FOREST.spawnZ[1]) < 7) return false; // spawns
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
    [8, 42],
    [-30, -46],
    [36, -30],
    [40, 30],
    [-50, -12],
  ];
  for (const [x, z] of lookouts) {
    const r = 1.9 + rand() * 0.4;
    const deck = 7.5 + rand() * 2;
    if (ok(gf(x), gf(z), 1)) FOREST.trees.push([gf(x), gf(z), r, deck]);
  }
  for (let k = 0; k < 6000 && FOREST.trees.length < 110; k++) {
    const a = rand() * Math.PI * 2;
    const d = (10 + Math.sqrt(rand()) * 44) * FGROW;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (!ok(x, z, 1)) continue;
    if (FOREST.trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 10)) continue;
    FOREST.trees.push([x, z, 1.5 + rand() * 0.6, 0]);
  }
  for (let k = 0; k < 4000 && FOREST.logs.length < 26; k++) {
    const a = rand() * Math.PI * 2;
    const d = (8 + Math.sqrt(rand()) * 42) * FGROW;
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
    for (let k = 0; k < 9000 && FOREST.rocks.length < 260; k++) {
      const a = rr() * Math.PI * 2;
      const d = 6 + rr() * (FOREST.radius + 4);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (blockedT(x, z, 1)) continue;
      if (Math.hypot(x - FOREST.hill.x, z - FOREST.hill.z) < FOREST.hill.r + 1) continue;
      if (inForestFeature(x, z, 0)) continue;
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
  // herbs and traps: open ground, off the paths of the big features
  const rs = frand(4321);
  const clear = (x: number, z: number, list: [number, number][], gap: number) =>
    ok(x, z, 1.5) && !FOREST.trees.some(([tx, tz, r]) => Math.hypot(tx - x, tz - z) < r + 2) && !list.some(([a, b]) => Math.hypot(a - x, b - z) < gap);
  for (let k = 0; k < 4000 && FOREST_X.herbSpots.length < 26; k++) {
    const a = rs() * Math.PI * 2;
    const d = 14 + Math.sqrt(rs()) * (FOREST.radius - 22);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (clear(x, z, FOREST_X.herbSpots, 16)) FOREST_X.herbSpots.push([x, z]);
  }
  for (let k = 0; k < 4000 && FOREST_X.trapSpots.length < 14; k++) {
    const a = rs() * Math.PI * 2;
    const d = 20 + Math.sqrt(rs()) * (FOREST.radius - 30);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (clear(x, z, FOREST_X.trapSpots, 22) && !FOREST_X.herbSpots.some(([a2, b2]) => Math.hypot(a2 - x, b2 - z) < 5)) FOREST_X.trapSpots.push([x, z]);
  }
  // zip lines: lookout to lookout, 35 to 90 m apart, clear of the temple hill, each deck with two lines at most
  const decks = FOREST.trees.map((t, i) => [t, i] as const).filter(([t]) => t[3] > 0);
  const pairs: [number, number, number][] = [];
  for (let a = 0; a < decks.length; a++)
    for (let b = a + 1; b < decks.length; b++) {
      const [A] = decks[a];
      const [Bt] = decks[b];
      const L = Math.hypot(A[0] - Bt[0], A[1] - Bt[1]);
      if (L < 30 || L > 100) continue;
      // nothing tall in the way: the hill, the pagoda, the other giants
      let blocked = false;
      for (let s2 = 0.08; s2 < 0.92; s2 += 0.04) {
        const x = A[0] + (Bt[0] - A[0]) * s2;
        const z = A[1] + (Bt[1] - A[1]) * s2;
        if (Math.hypot(x - FOREST.hill.x, z - FOREST.hill.z) < FOREST.hill.r + 4 || Math.hypot(x - FOREST_X.pagoda.x, z - FOREST_X.pagoda.z) < FOREST_X.pagoda.base + 2) blocked = true;
        if (FOREST.trees.some((t) => t !== A && t !== Bt && Math.hypot(t[0] - x, t[1] - z) < t[2] + 0.8)) blocked = true;
      }
      if (!blocked) pairs.push([a, b, L]);
    }
  pairs.sort((p, q) => p[2] - q[2]);
  const used = new Map<number, number>();
  for (const [a, b] of pairs) {
    if ((used.get(a) ?? 0) >= 2 || (used.get(b) ?? 0) >= 2 || FOREST_X.zips.length >= 7) continue;
    FOREST_X.zips.push([a, b]);
    used.set(a, (used.get(a) ?? 0) + 1);
    used.set(b, (used.get(b) ?? 0) + 1);
  }
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
  return forestFeatureHeight(x, z, h);
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
  // the newer corners: tents, the trap rack, lanterns, bamboo, snags in the bog, the fallen spire, log seats
  {
    const X = FOREST_X;
    for (const [x, z] of X.camp.tents) out.push({ x, z, r: 2.0 });
    out.push({ x: X.camp.rack[0], z: X.camp.rack[1], r: 0.6 });
    for (const [x, z, a] of X.seats) for (const k of [-1, 0, 1]) out.push({ x: x + Math.cos(a) * k * 0.6, z: z + Math.sin(a) * k * 0.6, r: 0.36, h: forestFloor(x, z) + 0.45 });
    for (const [x, z] of X.lanterns) out.push({ x, z, r: 0.38 });
    for (const [x, z] of X.bamboo.clumps) out.push({ x, z, r: 0.85 });
    for (const [x, z] of X.swamp.snags) out.push({ x, z, r: 0.45 });
    for (const [x, z, r] of X.spire) out.push({ x, z, r, h: forestFloor(x, z) + r * 1.6 });
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
      '船舵在主甲板船尾大舱门前（地上有金色光圈）：走过去按 F 掌舵，朝对面船的方向推（WASD）就把自己的船开过去，往回推就拉开；两船贴上自动放下两块跳板，掌舵的人自动松手去冲杀；再掌舵往回推会先收跳板再分开；F 松开船舵，挨打也会被打下来',
      '从跳板边上掉进海里：掉 120 血，被捞回自己船上',
      '货舱里有一桌饭菜，按 F 吃一口回复已损失气血的 10%',
      '每艘船船头楼和船尾高塔各一台床弩，按 F 抢占射击，能转过来打对面的船：一箭150伤害，还能把人钉住',
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
      '宫城四周一圈长街，张灯结彩，两边铺子里挤满看灯的百姓；殿宇之间的巷子和廊桥底下都能走',
      '在这张图上谁都能二段跳：街上连跳两下就能上偏殿的房顶，正殿更高，要从廊桥上去；从房顶跳下来不会摔伤',
      '五座殿顶由廊桥连成一片，越往屋脊越陡，往上爬要耗体力',
      '正殿屋脊最高，站上去居高临下；但上元节的烟花会落在正殿屋脊上，看到屋脊冒火星就快下来',
      '皇上出巡：皇上带着四个御林军在长街上绕宫城巡游，中立，谁靠近打谁，御林军会用长枪护驾（可以先杀护卫）。金甲护体，打不飞打不倒；有人近身会放「龙威」震开，离得远会被「御林箭雨」点名（脚下红圈，快躲）；血少了会龙颜大怒',
      '这张图只看传国玉玺分胜负：斩下皇上，玉玺掉在他倒下的地方，抢到手守住 30 秒就赢；拿着玉玺的人倒下，玉玺就掉了，谁都能抢',
      '可以把对面砍倒，但砍光了也不算赢，还得去拿玉玺；两边都倒下（比如被皇上收拾了）就是平局',
    ],
    homeClass: 'Ranger',
    homeClassName: '暗器',
    homeBonus: '伤害 +10%',
    available: true,
    terrain: true,
    radius: g1(26),
    spawnPlayer: [0, g1(14)],
    spawnEnemy: [0, -g1(14)],
    rect: { hx: 41, hz: 41 }, // CHANGAN_EDGE
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
    '胜负：古寺、古塔、瀑布山洞各有一座祖坛，站上去点香就归你，对面在场就点不了。占得越多分涨得越快，先到 100 分赢；打倒对手加 5 分，倒下的人 8 秒后在营地重生',
    '50Q 大地图：方圆两百米，面积是演武场的四十倍，开局两人隔河相望',
    '大河横穿中间：深水区要游泳（游得慢、不能出招，只能翻滚潜游），西边有浅滩可以蹚过去，东边有一座木桥',
    '七棵古树上搭着猎人瞭望台：朝树跑过去按跳跃，施展「梯云纵」三步蹬上树顶（耗体力，途中被打会掉下来），站在台上居高临下；走到台边再跳就下来',
    '古树挡路也挡暗器，被击飞撞上树干会额外受伤并眩晕；倒木和河边的石头可以站上去',
    '天气会变：晴 → 转阴 → 下雨 → 暴雨雷暴 → 放晴，大约两分钟一轮',
    '雷暴时天上劈雷，落点先冒电光：雷专劈站得最高的人（瞭望台最危险），劈在河边会沿水导电，泡在水里的人一起挨电',
    '梯子：走到梯子下按住 F 往上爬，S 往下，空格跳下来',
    '寺门前有两座香火台：拿着点燃的蜡烛走过去按 F 供上，寺前一片都亮了（有顶棚，不怕雨）',
    '山风一起，枯枝会砸下来，落点先出现红圈',
    '东边断崖上挂着瀑布，瀑布旁的山洞能躲雨躲雷，崖北头有一道碎石坡可以爬上崖顶',
    '几棵瞭望树之间拉着滑索：站在树台上按 F 滑到另一棵，滑的时候挨打会掉下去',
    '林子里会长出发光的草药：红的血参回血，蓝的疾风果让你跑得更快，采了过一会儿换个地方再长',
    '草里藏着猎人的捕兽夹，走近几步才看得见，踩中动不了两秒；东南猎户营地的架子上可以拿夹子自己布',
    '东南有一片沼泽：蹚进去又慢又中瘴毒，雾里互相看不清，适合埋伏',
    '西北竹林密得能藏人；石灯笼小路和营地篝火夜里会亮，走进光里就会被看见',
    '南边有座倒塌的古塔，顺着碎砖坡能爬上半截塔身居高临下（打雷时最危险）',
  ],
  homeClass: 'Ranger',
  homeClassName: '暗器',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: FOREST.radius,
  spawnPlayer: [0, FOREST.spawnZ[0]],
  spawnEnemy: [0, FOREST.spawnZ[1]],
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

// ----------------------------------------------------------------------
// 大漠玉门关 city gates: two leaves at the courtyard mouth of each gate passage (south = 0, north = 1),
// hinged on the gate towers. mapRuntime.desert.gate[g] is how far shut they are (0 open, flat against the
// towers; 1 shut across the passage). They're solid: walls in the height field, so walking, the camera,
// darts and the AI's grid all treat them like the rest of the fort.
// ----------------------------------------------------------------------
export const GATE_DOOR = { thick: 0.22, h: 5.0, hinge: 0.11, inset: 0.1 };
/** hinge (x, z) and unit direction of leaf `sx` (-1 west, +1 east) of gate g at shut fraction f */
export function gateLeaf(g: number, sx: number, f: number) {
  const F = DESERT.fort;
  const sz = g === 0 ? 1 : -1;
  const a = (f * Math.PI) / 2;
  return {
    hx: sx * (F.gate - GATE_DOOR.hinge),
    hz: sz * (F.half - F.wall - GATE_DOOR.inset),
    dx: -sx * Math.sin(a),
    dz: -sz * Math.cos(a),
    len: F.gate - GATE_DOOR.hinge,
  };
}
/** distance from (x, z) to the nearest gate leaf, and the nearest point on it */
export function gateDoorDist(x: number, z: number) {
  const F = DESERT.fort;
  const gs = mapRuntime.desert?.gate;
  let best = 1e9;
  let px = 0;
  let pz = 0;
  if (!gs || Math.abs(x) > F.gate + 0.5) return { d: best, px, pz };
  const az = Math.abs(z);
  const H0 = F.half - F.wall;
  if (az < H0 - F.gate - 0.6 || az > H0 + 0.6) return { d: best, px, pz };
  for (let g = 0; g < 2; g++) {
    if ((g === 0) !== z > 0) continue;
    for (const sx of [-1, 1]) {
      const L = gateLeaf(g, sx, gs[g] ?? 0);
      const t = Math.max(0, Math.min(L.len, (x - L.hx) * L.dx + (z - L.hz) * L.dz));
      const qx = L.hx + L.dx * t;
      const qz = L.hz + L.dz * t;
      const d = Math.hypot(x - qx, z - qz);
      if (d < best) {
        best = d;
        px = qx;
        pz = qz;
      }
    }
  }
  return { d: best, px, pz };
}

/** Walkable height of 大漠玉门关 at (x, z) */
export function desertHeight(x: number, z: number) {
  const F = DESERT.fort;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (ax < F.gate + 0.4 && az < F.half - F.wall + 0.4 && az > F.half - F.wall - F.gate - 0.4 && gateDoorDist(x, z).d < GATE_DOOR.thick / 2 + 0.06) return GATE_DOOR.h;
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


/** Shared scenery/collision layout for the first gathering expedition. */
export const QUARRY_ROCKS = [
  { x: -10, z: -5, r: 2.4, h: 2.8 }, { x: 11, z: -9, r: 3, h: 3.8 },
  { x: -15, z: 7, r: 2.1, h: 2.5 }, { x: 14, z: 9, r: 1.8, h: 2.2 },
  { x: -6, z: -19, r: 2.7, h: 3.3 }, { x: 6, z: -21, r: 2.4, h: 2.7 },
];
MAPS.quarry = {
  id: 'quarry', name: '青岚采石场', subtitle: '山谷营地、青石矿脉与试炼守卫。第一段单人寻材冒险。',
  icon: '⛏️', mechanics: ['单人寻材：沿石径挑战守卫', '击败守卫后靠近标本拾取追踪原材', '原材与改造持续保留；按 M 回大厅', '造物志选择寻材目标，制作改造后下次出发生效'],
  homeClass: 'Berserker', homeClassName: '狂刃', homeBonus: '单人寻材试验', available: true,
  radius: 27, spawnPlayer: [0, 17], spawnEnemy: [0, -6],
  background: '#adc8c4', fog: [48, 135], hemi: ['#d9eee3', '#625443', 1.8],
  keyColor: '#ffe0a5', keyIntensity: 2.7, exposure: 1.05, env: .55, bloom: .3,
  cardGradient: 'linear-gradient(135deg,#153c3c,#698e7c,#d8ba78)', sizeClass: '10Q',
  pillars: [...QUARRY_ROCKS, { x: -5, z: 19, r: .4 }, { x: 5, z: 19, r: .4 }, { x: -9, z: 15, r: 1.5 }],
};

MAPS.experimental = { ...MAPS.quarry, id:'experimental', name:'青岚遗谷 · 实验地图', subtitle:'与工匠交谈，寻访矿脉与古炉，把原材带回营地。', spawnPlayer:[0,18], spawnEnemy:[0,-10], background:'#879c98', fog:[38,100], keyColor:'#ffdda5', homeBonus:'实验寻材', pillars:[], mechanics:['营地与石师傅交谈接受委托','靠近矿脉停留片刻采集，至少寻找两处','守卫为可选挑战，额外奖励追踪原材','回营地交付才会保存；倒下五秒后回营，样本保留'] };

export const MAP_ORDER: MapId[] = ['quarry', 'losangeles', 'temple', 'wending', 'lavacliff', 'sea', 'glacier', 'forest', 'desert', 'rooftop', 'summit', 'plankway'];

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
  /** who is at each ship's helm (fighter index, -1 nobody) */
  helmUser: [-1, -1] as [number, number],
  /** 长安上元夜 传国玉玺: state 0 not dropped yet (the emperor lives), 1 lying on the roof, 2 held by fighter `holder` for t seconds */
  seal: { state: 0, x: 0, y: 0, z: 0, holder: -1, t: 0 },
  /** boarding: mode 0 apart, 1 closing, 2 alongside, 3 casting off; plank 0..1 how far the planks are down */
  board: { mode: 0, plank: 0 },
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
  /** 悬空栈道: bridge planks (hp per plank, 0 = broken; regrow seconds left), the mountain wind, who is on the chain */
  plank: { hp: [] as number[][], regrow: [] as number[][], gustWarn: 0, gust: 0, gustDir: [0, 1] as [number, number], gustNext: 20 },
  /** 青冥古林: herbs growing (kind 0 血参 heals, 1 疾风果 hastens; t: seconds until it grows back when picked), traps
   * on the ground (owner side, -1 = the hunters'; sprung: seconds since it snapped, -1 = still set) */
  /** 祖坛: owner side per altar (-1 nobody), how far its capture has got (-1 .. 1: toward side 0 is +), who's on it, the score */
  shrine: { own: [-1, -1, -1] as number[], prog: [0, 0, 0] as number[], busy: [0, 0, 0] as number[], score: [0, 0] as number[], on: false },
  /** 问鼎原: drum (seconds until it sounds; ready when <= 0; who's taking it and how far), towers' shots, boulders, lever cooldowns */
  war: { drumT: 20, drumBy: -1, drumHold: 0, shots: [] as { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number }[], boulders: [] as { x: number; z: number; dir: number; y: number; spin: number; by: number; hit: number[] }[], leverCd: [0, 0] as number[], towerCd: [0, 0] as number[] },
  /** 洛城午后: cash and watches lying about (kind is a LOOT id) */
  la: { loot: [] as { kind: string; x: number; y: number; z: number }[], next: 3 },
  /** per fighter: can the local player see them right now (night, the bog's mist, stealth); the minimap uses it */
  seen: [] as boolean[],
  /** the camera's yaw (the minimap turns with it) */
  camYaw: 0,
  wood: { herbs: [] as { x: number; z: number; kind: number; t: number }[], traps: [] as { x: number; z: number; owner: number; sprung: number }[] },
  desert: { sand: 0, warn: 0, wind: 1, beaconSide: -1, beaconT: 0, beaconCool: 0, swarmAt: -1, swarmWarn: 0, swarm: 0, swarmLeft: 0, gate: [0, 0] as number[], gateTo: [0, 0] as number[], gateCd: [0, 0] as number[], wells: [] as { t: number; x: number; y: number; z: number; yaw: number }[], tornado: null as null | { x: number; z: number; vx: number; vz: number; a: number; life: number } },
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
  street: -1.6, // the street: two jumps up to a side hall's eaves
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

/** 长安上元夜: the square of streets around the palace ends here (shop fronts beyond) */
export const CHANGAN_EDGE = 41;
/** the emperor's procession goes round the palace along the middle of the avenue */
export const PARADE_R = 35.5;
/** under one of the covered bridges (廊桥) that link the halls */
export function inCorridor(x: number, z: number) {
  for (const [x0, x1, z0, z1] of ROOF.corridors) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return true;
  return false;
}
/** what you stand on at (x, z) coming from height y: a bridge deck if you're up on it, the street if you're under it */
export function roofFloorAt(x: number, z: number, y: number) {
  let h = -1e9;
  for (const hl of ROOF.halls) {
    const v = hallHeight(hl, x, z);
    // the eaves overhang the street by EAVE_OVER: down there you walk under them, up there you stand on them
    if (v !== null && y < hl.eave - 1.2 && Math.min(x - hl.x0, hl.x1 - x, z - hl.z0, hl.z1 - z) < EAVE_OVER) continue;
    if (v !== null && v > h) h = v;
  }
  if (h > -1e8) return h;
  if (inCorridor(x, z) && y > ROOF.corridor - 1.2) return ROOF.corridor;
  return ROOF.street;
}
/**
 * 长安 camera: is (x, y, z) inside something solid? A hall is solid from the street up to its roof surface,
 * except the open space under its eaves (where you walk round it); a covered bridge is a slab.
 */
export function roofCamSolid(x: number, y: number, z: number) {
  for (const hl of ROOF.halls) {
    const v = hallHeight(hl, x, z);
    if (v === null || y > v + 0.15) continue;
    const edge = Math.min(x - hl.x0, hl.x1 - x, z - hl.z0, hl.z1 - z);
    if (edge < EAVE_OVER && y < hl.eave - 0.6) continue; // under the eaves: open air
    return true;
  }
  if (inCorridor(x, z) && y > ROOF.corridor - 0.6 && y < ROOF.corridor + 0.15) return true;
  return false;
}
/** the underside of a bridge or an eave overhead (999 when open sky) */
export function roofCeilAt(x: number, z: number, y: number) {
  if (inCorridor(x, z) && y < ROOF.corridor - 1.2) return ROOF.corridor - 0.5;
  for (const hl of ROOF.halls) if (y < hl.eave - 1.2 && x > hl.x0 && x < hl.x1 && z > hl.z0 && z < hl.z1) return hl.eave - 0.9;
  return 999;
}
/** how far a hall's eaves reach out past its walls */
export const EAVE_OVER = 0.9;
/** a point along the procession route, t in metres from the east side, going round anticlockwise (seen from above) */
export function paradeAt(t: number): [number, number] {
  const L = PARADE_R * 2;
  const P = L * 4;
  let u = ((t % P) + P) % P;
  const side = Math.floor(u / L);
  u -= side * L;
  const a = -PARADE_R + u;
  if (side === 0) return [PARADE_R, a];
  if (side === 1) return [-a, PARADE_R];
  if (side === 2) return [-PARADE_R, -a];
  return [a, -PARADE_R];
}
/** the route distance of the point of the route nearest (x, z) */
export function paradeNearest(x: number, z: number) {
  let best = 0;
  let bd = 1e9;
  for (let t = 0; t < PARADE_R * 8; t += 1) {
    const [px, pz] = paradeAt(t);
    const d = Math.hypot(px - x, pz - z);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** Floor height for maps with a height field (0 for flat maps) */
// ----------------------------------------------------------------------
// 悬空栈道: a plank road pinned to a sheer cliff face, high over a sea of cloud. The cliff runs along the
// north (z < cliffZ); the road (栈道) along its foot; a broad rock ledge at each end (the two camps). Out in
// the chasm stands a lone rock peak (孤峰) with a pavilion, reached by two rope bridges whose planks can be
// broken, or by an iron chain (铁索) from a stone step in the middle of the road. Everything else is a drop.
// ----------------------------------------------------------------------
export const PLANK = {
  radius: 34,
  cliffZ: -10,
  roadZ: -6.5, // the road's outer (chasm) edge
  roadX: 22,
  ledge: { x0: 12, x1: 22.5, z0: -10, z1: -1, r: 2.2 },
  peak: { x: 0, z: 9, r: 5.6, h: 0.8 },
  step: { x0: -2.6, x1: 2.6, z0: -10, z1: -8.3, h: 1.1 },
  /** rope bridges: ledge end (a) to peak end (b) */
  bridges: [
    { ax: -15.2, az: -1.7, bx: -4.5, bz: 6.2 },
    { ax: 15.2, az: -1.7, bx: 4.5, bz: 6.2 },
  ],
  bridgeHalfW: 1.1,
  plankLen: 1.0,
  sag: 0.45,
  plankHp: 3,
  regrow: 14,
  /** the iron chain: from the stone step out to the peak (anchors on the ground; the chain runs 2.4 m above) */
  chain: { ax: 0, az: -9.0, bx: 0, bz: 4.6, high: 2.4, ride: 1.25 },
  wall: 30,
  abyss: -40,
  /** 山风: every so often a gust out over the edge (warned a few seconds before) */
  gust: { every: [22, 34] as [number, number], warn: 3.5, dur: 2.6, push: 3.4 },
  spawnW: [-17, -5] as [number, number],
  spawnE: [17, -5] as [number, number],
};
const bridgeLen = (b: (typeof PLANK.bridges)[number]) => Math.hypot(b.bx - b.ax, b.bz - b.az);
/** how many planks bridge k has */
export const plankCount = (k: number) => Math.round(bridgeLen(PLANK.bridges[k]) / PLANK.plankLen);
/** heights at the bridge ends */
const bridgeEnds = () => [0, PLANK.peak.h] as const;
/** where (x, z) is on a bridge: which bridge, which plank, how far along (0..1) and across (metres), or null */
export function plankAt(x: number, z: number) {
  for (let k = 0; k < PLANK.bridges.length; k++) {
    const b = PLANK.bridges[k];
    const L = bridgeLen(b);
    const ux = (b.bx - b.ax) / L;
    const uz = (b.bz - b.az) / L;
    const along = (x - b.ax) * ux + (z - b.az) * uz;
    const across = -(x - b.ax) * uz + (z - b.az) * ux;
    if (along < 0 || along > L || Math.abs(across) > PLANK.bridgeHalfW) continue;
    const n = plankCount(k);
    const i = Math.min(n - 1, Math.floor((along / L) * n));
    return { k, i, t: along / L, across };
  }
  return null;
}
/** height of the bridge deck at fraction t (sagging in the middle) */
export function bridgeY(t: number) {
  const [ha, hb] = bridgeEnds();
  return ha + (hb - ha) * t - PLANK.sag * Math.sin(Math.PI * t);
}
function inRoundRect(x: number, z: number, x0: number, x1: number, z0: number, z1: number, r: number) {
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cz = Math.max(z0 + r, Math.min(z1 - r, z));
  return x >= x0 && x <= x1 && z >= z0 && z <= z1 && Math.hypot(x - cx, z - cz) <= r;
}
/** Walkable height of 悬空栈道 at (x, z): the cliff (a wall), the road, the ledges, the peak, the bridges, or the drop */
export function plankHeight(x: number, z: number) {
  const P = PLANK;
  if (z < P.cliffZ) return P.wall;
  const S = P.step;
  if (x > S.x0 && x < S.x1 && z < S.z1) return S.h;
  if (z <= P.roadZ && Math.abs(x) <= P.roadX) return 0;
  const L = P.ledge;
  if (inRoundRect(Math.abs(x), z, L.x0 - 3, L.x1, L.z0 - 1, L.z1, L.r)) return 0;
  if (Math.hypot(x - P.peak.x, z - P.peak.z) <= P.peak.r) return P.peak.h;
  const q = plankAt(x, z);
  if (q) {
    const hp = mapRuntime.plank?.hp?.[q.k]?.[q.i];
    if (hp === undefined || hp > 0) return bridgeY(q.t);
  }
  return P.abyss;
}

MAPS.plankway = {
  id: 'plankway',
  name: '悬空栈道',
  subtitle: '千仞绝壁上的一条木栈道，脚下是万丈云海',
  icon: '🧗',
  mechanics: [
    '栈道钉在绝壁上，外侧没有护栏：走路不会掉下去，被打飞出边缘直接坠崖判负',
    '两座吊桥通往云海中的孤峰：桥板挨打会裂，打断了人就掉下去，14 秒后新桥板补上',
    '栈道中间的石台上有一条铁索直通孤峰：站在索头按 F 滑过去，滑行时被打中会松手坠落',
    '山风：每隔半分钟左右刮一阵大风，起风前三秒有提示。风把人往崖外吹，按住格挡能站稳',
  ],
  homeClass: 'Ranger',
  homeClassName: '暗器',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: PLANK.radius,
  spawnPlayer: PLANK.spawnW,
  spawnEnemy: PLANK.spawnE,
  background: '#c9d3e0',
  fog: [70, 380],
  hemi: ['#dfe8f5', '#5a5048', 0.8],
  keyColor: '#ffe0b0',
  keyIntensity: 2.6,
  exposure: 0.88,
  bloom: 0.7,
  cardGradient: 'from-slate-500/60 via-stone-700/70 to-zinc-950/90',
  pillars: [
    // the pavilion's four posts on the peak, and the two chain anchors
    ...[[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]].map(([dx, dz]) => ({ x: PLANK.peak.x + dx, z: PLANK.peak.z + 1.2 + dz, r: 0.22 })),
  ],
} as MapDef;

// ----------------------------------------------------------------------
// 问鼎原: a team-fight field, mirrored north and south. Each side has a palisaded camp with a watchtower
// that shoots intruders; between them three lanes split by rocky ridges. In the middle stands the
// 问鼎台, a raised stone terrace with a war drum: hold it to take 战意 (more damage, a little more speed).
// Out on the flanks: a 回春泉 spring that heals whoever stands in it alone, and a lever in each side lane
// that sends a boulder rolling down the lane toward the other camp.
// Side 0 camps in the south (+z), side 1 in the north (-z).
// ----------------------------------------------------------------------
export const WAR = {
  radius: 50,
  /** the terrace: flat top radius, foot radius, height */
  mound: { top: 5.5, foot: 12.5, h: 2.0 },
  /** 战意: every so often the drum is ready; stand on its stone alone for `hold` s to take it */
  drum: { r: 2.4, hold: 1.5, every: 40, first: 20, buffT: 20, dmg: 1.2, speed: 1.12 },
  springs: [[-31, 0], [31, 0]] as [number, number][],
  springR: 3.4,
  /** heal per second (share of max HP) while you're in a spring with nobody of the other side in it */
  springRate: 0.03,
  /** camps: centre (x, z) for side 0 and side 1; the palisade arc radius; the tower inside it */
  camps: [[0, 38], [0, -38]] as [number, number][],
  campR: 10,
  towers: [[0, 44], [0, -44]] as [number, number][],
  towerRange: 15,
  towerEvery: 1.6,
  towerDmg: 45,
  /** ridges: rows of rock between the lanes (x, z0, z1) */
  ridges: [[-14, -17, -6], [-14, 6, 17], [14, -17, -6], [14, 6, 17]] as [number, number, number][],
  /** levers in the side lanes; the boulder rolls along x = lane toward the puller's foe */
  levers: [[-23, 0], [23, 0]] as [number, number][],
  boulder: { r: 1.35, speed: 12, dmg: 110, every: 22 },
  spawns: [[0, 33], [0, -33]] as [number, number][],
};
const smoothW = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function warHeight(x: number, z: number) {
  const M = WAR.mound;
  const d = Math.hypot(x, z);
  let h = M.h * (1 - smoothW(M.top, M.foot, d));
  // gentle swells out in the field, flat inside the camps and by the springs
  const flat = Math.min(...WAR.camps.map(([cx, cz]) => Math.hypot(x - cx, z - cz))) < WAR.campR + 3 || WAR.springs.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < WAR.springR + 2);
  if (!flat && d > M.foot) h += (Math.sin(x * 0.17 + 0.6) * Math.cos(z * 0.13 - 0.3) * 0.35 + Math.sin(x * 0.07 - z * 0.05) * 0.2) * smoothW(M.foot, M.foot + 6, d);
  // the springs sit in shallow stone basins
  for (const [sx, sz] of WAR.springs) {
    const sd = Math.hypot(x - sx, z - sz);
    if (sd < WAR.springR + 1.2) h = Math.min(h, -0.25 * (1 - smoothW(WAR.springR - 0.6, WAR.springR + 1.2, sd)));
  }
  // the land rises gently beyond the edge
  h += smoothW(WAR.radius, WAR.radius + 10, d) * 3;
  return h;
}
function warPillars(): Circle[] {
  const out: Circle[] = [];
  // ridges: overlapping rocks you can't pass
  for (const [x, z0, z1] of WAR.ridges) for (let z = z0; z <= z1 + 0.01; z += 1.6) out.push({ x: x + Math.sin(z * 1.3) * 0.4, z, r: 1.15 });
  // palisades: an arc round each camp, open toward the middle (a 130 degree mouth)
  WAR.camps.forEach(([cx, cz], sd) => {
    const facing = sd === 0 ? -Math.PI / 2 : Math.PI / 2; // toward the middle
    for (let a = 0; a < Math.PI * 2; a += 0.075) {
      let da = Math.abs(((a - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da < (130 / 2) * (Math.PI / 180)) continue;
      out.push({ x: cx + Math.cos(a) * WAR.campR, z: cz + Math.sin(a) * WAR.campR, r: 0.4 });
    }
  });
  // the watchtowers' four legs
  for (const [tx, tz] of WAR.towers) for (const [dx, dz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) out.push({ x: tx + dx, z: tz + dz, r: 0.3 });
  // the drum stand, a lever post each side
  out.push({ x: 0, z: 0, r: 0.9, h: WAR.mound.h + 1.0 });
  for (const [x, z] of WAR.levers) out.push({ x: x + 0.9, z, r: 0.25 });
  return out;
}

MAPS.wending = {
  id: 'wending',
  name: '问鼎原',
  subtitle: '两军对垒的团体赛主场：中路高台战鼓，两翼回春泉与滚石机关',
  icon: '🥁',
  mechanics: [
    '团体赛地图：二打二最好玩，一打一也行。两边营寨南北相对，把对面全部打倒就赢，倒下的队友可以扶起来',
    '中间的问鼎台上有一面战鼓：每 40 秒响一次，独自站上鼓台 1.5 秒就拿到「战意」，20 秒内伤害 +20%、跑得更快',
    '营寨的箭楼会射进营的敌人，别在对面营门口久留',
    '两翼各有一眼回春泉：站进去慢慢回血，对面有人也在泉里就停',
    '两侧小路中间各有一根滚石机关：按 F 放下巨石，顺着小路滚向对面营寨，被砸中会飞出去',
    '三条路之间隔着乱石岗，只能从两头和中间的缺口绕过去',
  ],
  homeClass: 'Berserker',
  homeClassName: '狂刃',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: WAR.radius,
  spawnPlayer: WAR.spawns[0],
  spawnEnemy: WAR.spawns[1],
  background: '#c8d4dc',
  fog: [60, 220],
  hemi: ['#e6eef2', '#5b6440', 0.85],
  keyColor: '#fff0d0',
  keyIntensity: 2.7,
  exposure: 0.95,
  bloom: 0.75,
  cardGradient: 'from-amber-700/60 via-stone-700/70 to-zinc-950/90',
  pillars: warPillars(),
} as MapDef;

// ----------------------------------------------------------------------
// 落日海岸: a headland on the Big Sur coast at golden hour. The fight is on a meadow of dry golden grass
// and wildflowers on top of the cliffs; the Pacific is to the west (-x), the sun going down over it.
// Off the cliff is a long way down into the sea (a ring-out). Inland the golden hills roll up with oaks
// on them, Highway 1 winds along them and crosses a canyon to the north on an arched concrete bridge;
// a lighthouse stands on the point to the south.
// ----------------------------------------------------------------------
export const COAST = {
  radius: 46,
  sea: -12,
  floor: -17,
  spawns: [[8, 24], [8, -24]] as [number, number][],
  /** highway: x along z, and the canyon it bridges */
  road: { x: 64, half: 4.2 },
  canyon: { z: -98, half: 13 },
  lighthouse: [-44, 82] as [number, number],
  /** trees on the meadow (x, z, size, lean) and boulders (x, z, size, kind) */
  trees: [[-18, 30, 1.1, 0.5], [-24, -14, 1.25, 0.35], [-12, -34, 0.95, 0.6], [26, 8, 1.0, 0.2], [20, -30, 0.9, 0.25], [-8, 6, 0.8, 0.45]] as [number, number, number, number][],
  rocks: [[4, 4, 1.6, 0], [-14, 18, 1.2, 1], [14, -12, 1.4, 2], [-4, -22, 1.0, 1], [30, 26, 1.8, 0], [-20, -2, 0.9, 2], [24, -4, 1.0, 1]] as [number, number, number, number][],
};
/** the cliff edge: land is east of this x (it wanders with z), and the point juts out to the south */
export function coastX(z: number) {
  let x = -30 + 5 * Math.sin(z * 0.06 + 0.5) + 2.5 * Math.sin(z * 0.15 + 2);
  // the lighthouse point juts out to the west
  const [, lz] = COAST.lighthouse;
  x -= 17 * Math.exp(-(((z - lz) / 15) ** 2));
  return x;
}
const ssC = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** the land before the cliff is cut: meadow, hills, the canyon, the road's bench */
function coastLand(x: number, z: number) {
  // the meadow: soft swells, a little higher toward the middle, a dip running down to the cliff
  let h = 0.7 * Math.sin(x * 0.055 + z * 0.035) * Math.cos(z * 0.05 - 0.4) + 0.35 * Math.sin(x * 0.13 - z * 0.11 + 1.1);
  // inland: the golden hills
  const hill = ssC(30, 150, x) * (30 + 16 * Math.sin(z * 0.017 + 1.3) * Math.cos(x * 0.012)) + ssC(70, 260, x) * 40 * (0.6 + 0.4 * Math.sin(z * 0.009 - 0.7));
  h += hill + ssC(40, 120, x) * (2.2 * Math.sin(x * 0.07 + z * 0.05) + 1.4 * Math.sin(z * 0.11 - x * 0.03));
  // the highway's bench, cut along the hillside
  const R = COAST.road;
  const rx = roadX(z);
  const dr = Math.abs(x - rx);
  const roadY = roadHeight(z);
  if (dr < R.half + 10) h = h + (roadY - h) * (1 - ssC(R.half, R.half + 10, dr));
  // the canyon to the north, running down to the sea
  const C = COAST.canyon;
  const dc = Math.abs(z - C.z + Math.sin(x * 0.03) * 4);
  const cut = 1 - ssC(C.half * 0.25, C.half, dc);
  if (cut > 0) h = h + (Math.min(h, COAST.floor + 4 + Math.max(0, x) * 0.12) - h) * cut;
  return h;
}
export function roadX(z: number) {
  return COAST.road.x + 7 * Math.sin(z * 0.012 + 0.8) + 3 * Math.sin(z * 0.031);
}
export function roadHeight(z: number) {
  return 9 + 3 * Math.sin(z * 0.01 + 0.4);
}
/** the walkable ground (and the sea floor off the cliff) */
export function coastHeight(x: number, z: number) {
  const land = coastLand(x, z);
  const t = x - coastX(z); // metres inland of the edge
  if (t >= 0) return land + ssC(2.5, 0, t) * 0.25; // a slight lip at the edge
  // the cliff: almost sheer, down to the boulders at its foot and the sea floor
  const edge = coastLand(coastX(z), z);
  const k = ssC(0, 4.5, -t);
  return edge + (COAST.floor - edge) * k;
}

MAPS.coast = {
  id: 'coast',
  name: '落日海岸',
  subtitle: '加州一号公路边的海岬，金色草坡、海风柏树，太平洋上的落日',
  icon: '🌅',
  mechanics: [
    '海岬上的金色草坡，西边是几十米高的悬崖，下面就是太平洋：被打下悬崖就坠海出局',
    '走路不会掉下去，只有被打飞、翻滚、冲撞才会越过崖边',
    '草坡上有几棵被海风吹歪的柏树和大石头，可以绕着躲',
    '一打一或组队都能玩，把对面打倒就赢',
  ],
  homeClass: 'Ranger',
  homeClassName: '暗器',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: COAST.radius,
  spawnPlayer: COAST.spawns[0],
  spawnEnemy: COAST.spawns[1],
  background: '#c9976e',
  fog: [140, 1500],
  hemi: ['#ffd9b0', '#5a4a38', 0.75],
  keyColor: '#ffb070',
  keyIntensity: 3.0,
  exposure: 0.62,
  bloom: 0.6,
  env: 0.55,
  sunDir: [-0.93, 0.16, 0.33],
  cardGradient: 'from-orange-400/50 via-rose-700/50 to-zinc-950/90',
  pillars: [
    ...COAST.trees.map(([x, z, s]) => ({ x, z, r: 0.55 * s })),
    ...COAST.rocks.map(([x, z, s]) => ({ x, z, r: 1.15 * s })),
  ],
} as MapDef;

// ----------------------------------------------------------------------
// 洛城午后: Los Angeles around 2000, a late-summer afternoon, one big map:
//   the middle: an Echo Park-style lake (shallow: you wade it), palms all round, a fountain, lotus, paddle boats
//   north: a hillside of Spanish houses with red tile roofs on terraced streets, cars parked along them
//   west: a farm, rows of orange trees, a red barn and a windmill
//   east: the slope down to the Harbor Freeway, solid with traffic, and downtown's towers beyond it
// Cash and watches turn up around the map (see LOOT): pick them up, drop them when you're cut down.
// ----------------------------------------------------------------------
export const LA = {
  radius: 165,
  lake: { x: -8, z: 12, rx: 46, rz: 28, water: -0.15, bed: -0.95 },
  fwy: { x0: 186, x1: 220, y: -10 },
  overpass: { z: -70, y: -0.6, half: 7 },
  /** the hillside streets (z) and the house lots along them */
  streets: [-92, -116, -140] as number[],
  houses: [] as { x: number; z: number; w: number; d: number; yaw: number; y: number; kind: number }[],
  /** the farm: fields and the grove (a box), the barn and the windmill */
  farm: { x0: -158, x1: -82, z0: -40, z1: 120 },
  barn: [-120, 92] as [number, number],
  mill: [-140, 64] as [number, number],
  palms: [] as [number, number, number, number][],
  grove: [] as [number, number][],
  beds: [] as [number, number, number][],
  parked: [] as { x: number; z: number; yaw: number; c: number }[],
  spawns: [[60, 70], [60, -50]] as [number, number][],
};
const ssL = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** how far inside the lake's oval (< 1 inside) */
export function lakeE(x: number, z: number) {
  const L = LA.lake;
  return Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz);
}
/** the land before the house pads and streets are cut in */
function laBase(x: number, z: number) {
  let h = 0.35 * Math.sin(x * 0.045 + 0.4) * Math.cos(z * 0.04) + 0.2 * Math.sin(x * 0.11 - z * 0.07);
  // the hill to the north
  h += ssL(-75, -170, z) * 22 * (0.85 + 0.15 * Math.sin(x * 0.02));
  // the farm is flat
  const F = LA.farm;
  const inFarm = ssL(F.x0 - 10, F.x0 + 6, x) * (1 - ssL(F.x1 - 6, F.x1 + 10, x)) * ssL(F.z0 - 10, F.z0 + 6, z) * (1 - ssL(F.z1 - 6, F.z1 + 10, z));
  h = h * (1 - inFarm) + 0.1 * inFarm;
  // east: down the planted slope to the freeway, which runs in a trench; downtown is up on its hill beyond it
  const W = LA.fwy;
  h = h + (W.y - h) * ssL(150, W.x0 - 2, x);
  if (x > W.x0 - 2) h = W.y;
  if (x > DT.wallX) h = DT.y;
  return h;
}

// ----------------------------------------------------------------------
// 洛城午后 downtown: a footbridge over the freeway to a plaza, and the four finance houses along an avenue.
// Each has a glass lobby and two floors up by lift: a trading floor (40) and the banking floor (80).
// Fighters stand on floors, desks and the like through laFloorAt (which knows the height you're at), and
// walls, desks and people are boxes pushed against in laWalls.
// ----------------------------------------------------------------------
export const DT = {
  y: 0,
  /** the trench wall on the freeway's east side: the plaza starts here */
  wallX: 221.5,
  bridge: { z: 0, half: 3.2, x0: 140, x1: 224 },
  rect: { x0: 222, x1: 336, z0: -56, z1: 56 },
  /** floor levels inside the towers: the lobby, the trading floor, the banking floor */
  levels: [0, 40, 80] as number[],
  lobbyH: 8,
  floorH: 5.5,
  fountain: [284, 0] as [number, number],
};
export interface Firm {
  id: string;
  name: string;
  cn: string;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  /** which way the door faces: +1 = the +z face, -1 = the -z face (both open on the avenue at z = 0) */
  s: number;
  glass: string;
  frame: string;
  accent: string;
  /** what's on its floors (names for the HUD and the lift) */
  floors: string[];
}
export const FIRMS: Firm[] = [
  { id: 'gs', name: 'GOLDMAN SACHS', cn: '高盛', x: 258, z: -32, w: 36, d: 36, h: 250, s: 1, glass: '#3e5a72', frame: '#c9c4b8', accent: '#7399c6', floors: ['大堂', '40 层 交易大厅', '80 层 投行部'] },
  { id: 'ms', name: 'MORGAN STANLEY', cn: '摩根士丹利', x: 258, z: 32, w: 36, d: 36, h: 215, s: -1, glass: '#22303c', frame: '#7c2f2a', accent: '#3a6fb8', floors: ['大堂', '40 层 交易大厅', '80 层 投行部 · 董事会议室'] },
  { id: 'citadel', name: 'CITADEL', cn: 'Citadel', x: 308, z: -31, w: 32, d: 34, h: 235, s: 1, glass: '#5b7f93', frame: '#d6d3cc', accent: '#2f6db5', floors: ['大堂', '40 层 交易大厅', '80 层 投研部'] },
  { id: 'imc', name: 'IMC TRADING', cn: 'IMC', x: 308, z: 30, w: 30, d: 32, h: 165, s: -1, glass: '#2f4f5e', frame: '#adb3b5', accent: '#d8402f', floors: ['大堂', '40 层 交易大厅', '80 层 量化研究'] },
];
/** a solid box: walls (y1 far up), desks and tables (top: you can stand on it), people */
export interface LBox {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  top?: boolean;
}
/** firm-local (u along x, v toward the avenue) to world */
export const firmXZ = (F: Firm, u: number, v: number): [number, number] => [F.x + u, F.z + F.s * v];
const CORE = { hu: 5, hv: 4, alcove: 1.6, deep: 2.6 };
/** the lift alcove in the core's face toward the door: the up car (u < 0) and the down car (u > 0) */
export function liftCar(F: Firm, up: boolean): [number, number] {
  return firmXZ(F, up ? -0.8 : 0.8, CORE.hv - CORE.deep / 2);
}
export function inLift(F: Firm, x: number, z: number) {
  const u = x - F.x;
  const v = (z - F.z) * F.s;
  return Math.abs(u) < CORE.alcove - 0.1 && v > CORE.hv - CORE.deep && v < CORE.hv + 0.3;
}
export type NpcPose = 0 | 1 | 2; // 0 standing on the phone, 1 seated at the screens, 2 standing, shouting and waving
export interface Npc {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pose: NpcPose;
  suit: number;
}
export interface Desk {
  x: number;
  y: number;
  z: number;
  len: number;
  /** trading desks carry a bank of four screens a seat; banking desks two */
  kind: 0 | 1;
}
/** everything inside the towers, per firm: boxes, desks, people, and the quest's spots */
export const FIRM_IN: { boxes: LBox[]; desks: Desk[]; npcs: Npc[]; tables: { x: number; y: number; z: number; w: number; d: number }[]; glass: LBox[] }[] = [];
/** the 投行家 quest's spots */
export const IB_SPOTS = {} as Record<'reception' | 'printer' | 'desk' | 'trade' | 'board' | 'client', [number, number, number]>;
type P3 = [number, number, number];
/** every tower's working spots: the front desk, the printer and a free desk seat (80), the boardroom's head, a free trading seat (40) */
export const FIRM_SPOTS: { reception: P3; printer: P3; desk: P3; board: P3; trade: P3 }[] = [];
/** where clients wait, out in the city (x, z; y from the ground) */
export const CLIENT_SPOTS: { x: number; z: number; name: string }[] = [
  { x: 37, z: -6, name: '湖边小路' },
  { x: -120, z: 79, name: '农场红谷仓门口' },
  { x: -133, z: 58, name: '风车底下' },
  { x: 10, z: -92, name: '北坡住宅区的街上' },
  { x: 286, z: 7, name: '市中心喷泉旁' },
  { x: 120, z: 40, name: '公园东边的棕榈大道' },
];
{
  const rnd = (() => {
    let s = 4242;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  const BIG = 1e4;
  FIRMS.forEach((F, fi) => {
    const boxes: LBox[] = [];
    const desks: Desk[] = [];
    const npcs: Npc[] = [];
    const tables: { x: number; y: number; z: number; w: number; d: number }[] = [];
    const glass: LBox[] = [];
    // a box from firm-local corners
    const box = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, top = false) => {
      const [ax, az] = firmXZ(F, u0, v0);
      const [bx, bz] = firmXZ(F, u1, v1);
      const b: LBox = { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz), y0, y1, top };
      boxes.push(b);
      return b;
    };
    const hw = F.w / 2;
    const hd = F.d / 2;
    const T = 0.4;
    // the outer walls: the lobby's (glass, with the door in the avenue face) and the floors above (no way out)
    const door = 3.2;
    box(-hw, hw, -hd, -hd + T, -2, DT.lobbyH);
    box(-hw, -hw + T, -hd, hd, -2, DT.lobbyH);
    box(hw - T, hw, -hd, hd, -2, DT.lobbyH);
    box(-hw, -door, hd - T, hd, -2, DT.lobbyH);
    box(door, hw, hd - T, hd, -2, DT.lobbyH);
    box(-hw, hw, -hd, -hd + T, DT.lobbyH, BIG);
    box(-hw, -hw + T, -hd, hd, DT.lobbyH, BIG);
    box(hw - T, hw, -hd, hd, DT.lobbyH, BIG);
    box(-hw, hw, hd - T, hd, DT.lobbyH, BIG);
    // the core, with the lift alcove facing the door
    const C = CORE;
    box(-C.hu, -C.alcove, -C.hv, C.hv, -2, BIG);
    box(C.alcove, C.hu, -C.hv, C.hv, -2, BIG);
    box(-C.alcove, C.alcove, -C.hv, C.hv - C.deep, -2, BIG);
    // lobby: the front desk between the lift and the door
    const L0 = 0;
    box(-3.2, 3.2, C.hv + 3.0, C.hv + 4.2, L0, L0 + 1.1, true);
    npcs.push({ ...xyz(F, 0, C.hv + 2.4, L0), yaw: F.s > 0 ? 0 : Math.PI, pose: 0, suit: 3 });
    const [rx, rz] = firmXZ(F, 0, C.hv + 5.4);
    const reception: P3 = [rx, L0, rz];
    // turnstiles either side of the walk from the door to the lift
    for (const su of [-1, 1]) for (let k = 0; k < 3; k++) box(su * (2 + k * 1.3), su * (2 + k * 1.3) + su * 0.25, C.hv + 7, C.hv + 8.4, L0, L0 + 1.0);
    // a few people waiting in the lobby
    for (let k = 0; k < 6; k++) {
      const u = (rnd() - 0.5) * (F.w - 6);
      const v = -hd + 3 + rnd() * (hd - 3 - C.hv - 1);
      if (Math.abs(u) < C.hu + 1.5 && v > -C.hv - 1.5) continue;
      npcs.push({ ...xyz(F, u, v, L0), yaw: rnd() * 6.28, pose: 0, suit: Math.floor(rnd() * 5) });
    }
    // the floors above
    const deskRow = (L: number, kind: 0 | 1, avoid: (u: number, v: number) => boolean) => {
      const len = kind === 0 ? 6 : 4.8;
      const dep = kind === 0 ? 1.6 : 1.4;
      for (let u = -hw + 2 + len / 2; u <= hw - 2 - len / 2 + 0.01; u += len + 2.2)
        for (let v = -hd + 2.6; v <= hd - 2.6; v += dep + 2.4) {
          if (Math.abs(u) < C.hu + 2.2 + len / 2 && Math.abs(v) < C.hv + 2.6) continue; // round the core
          if (Math.abs(u) < 2.2 + len / 2 && v > 0) continue; // the walk from the lift to the windows
          if (avoid(u, v)) continue;
          const [x, z] = firmXZ(F, u, v);
          const b = box(u - len / 2, u + len / 2, v - dep / 2, v + dep / 2, L, L + 0.78, true);
          desks.push({ x, y: L, z, len, kind });
          // seats along both sides
          const per = kind === 0 ? 3 : 2;
          for (const side of [-1, 1])
            for (let k = 0; k < per; k++) {
              if (rnd() < (kind === 0 ? 0.18 : 0.35)) continue;
              const su = u + (k - (per - 1) / 2) * (len / per);
              const sv = v + side * (dep / 2 + 0.55);
              const stand = rnd() < (kind === 0 ? 0.42 : 0.15);
              const pose: NpcPose = stand ? (kind === 0 && rnd() < 0.45 ? 2 : 0) : 1;
              const yaw = Math.atan2(0, -side * F.s) ; // facing the desk
              npcs.push({ ...xyz(F, su, sv + (stand ? side * 0.15 : 0), L), yaw, pose, suit: Math.floor(rnd() * 5) });
              const [px, pz] = firmXZ(F, su, sv);
              boxes.push({ x0: px - 0.3, x1: px + 0.3, z0: pz - 0.3, z1: pz + 0.3, y0: L, y1: L + (stand ? 1.8 : 1.3) });
            }
          void b;
        }
    };
    // 40: the trading floor, desks everywhere
    const L1 = DT.levels[1];
    deskRow(L1, 0, () => false);
    // 80: the banking floor: a glass boardroom at the back, desks in front, a printer by the core
    const L2 = DT.levels[2];
    const bv = -hd + 6;
    deskRow(L2, 1, (u, v) => Math.abs(u) < 9.5 && v < bv + 5);
    for (const [u0, u1, v0, v1] of [
      [-8, 8, bv - 4.2, bv - 4.0],
      [-8, -7.8, bv - 4.2, bv + 4.2],
      [7.8, 8, bv - 4.2, bv + 4.2],
      [-8, -1.5, bv + 4.0, bv + 4.2],
      [1.5, 8, bv + 4.0, bv + 4.2],
    ]) {
      const b = box(u0, u1, v0, v1, L2, L2 + 3.2);
      glass.push(b);
    }
    box(-4.5, 4.5, bv - 1.2, bv + 1.2, L2, L2 + 0.78, true);
    tables.push({ ...xyz(F, 0, bv, L2), w: 9, d: 2.4 });
    for (const su of [-3.6, -1.2, 1.2, 3.6]) {
      npcs.push({ ...xyz(F, su, bv - 1.75, L2), yaw: Math.atan2(0, F.s), pose: 1, suit: Math.floor(rnd() * 5) });
      if (Math.abs(su) > 2) npcs.push({ ...xyz(F, su, bv + 1.75, L2), yaw: Math.atan2(0, -F.s), pose: 1, suit: Math.floor(rnd() * 5) });
    }
    box(C.hu + 0.6, C.hu + 1.8, -0.5, 0.5, L2, L2 + 1.2, true); // the printer
    // a free seat at the desk nearest the lift on a floor: whoever sat there gets up
    const freeSeat = (L: number, dep: number): P3 => {
      const d = desks.filter((k) => k.y === L).sort((a, b) => Math.hypot(a.x - F.x, a.z - (F.z + F.s * 8)) - Math.hypot(b.x - F.x, b.z - (F.z + F.s * 8)))[0];
      const dx = d.x;
      const dz = d.z + F.s * (dep / 2 + 0.55);
      for (let k = npcs.length - 1; k >= 0; k--) if (Math.hypot(npcs[k].x - dx, npcs[k].z - dz) < 1.3 && npcs[k].y === L) npcs.splice(k, 1);
      for (let k = boxes.length - 1; k >= 0; k--) {
        const b = boxes[k];
        if (!b.top && b.y0 === L && b.x1 - b.x0 < 0.7 && Math.hypot((b.x0 + b.x1) / 2 - dx, (b.z0 + b.z1) / 2 - dz) < 1.3) boxes.splice(k, 1);
      }
      return [dx, L, dz];
    };
    const [px, pz] = firmXZ(F, C.hu + 2.6, 0);
    const [bx, bz] = firmXZ(F, 0, bv + 2.2);
    FIRM_SPOTS.push({ reception, printer: [px, L2, pz], desk: freeSeat(L2, 1.4), board: [bx, L2, bz], trade: freeSeat(L1, 1.6) });
    FIRM_IN.push({ boxes, desks, npcs, tables, glass });
  });
  IB_SPOTS.reception = FIRM_SPOTS[0].reception;
  IB_SPOTS.printer = FIRM_SPOTS[0].printer;
  IB_SPOTS.desk = FIRM_SPOTS[0].desk;
  IB_SPOTS.board = FIRM_SPOTS[1].board;
  IB_SPOTS.trade = FIRM_SPOTS[2].trade;
  IB_SPOTS.client = [37, 0, -6];
  function xyz(F: Firm, u: number, v: number, y: number) {
    const [x, z] = firmXZ(F, u, v);
    return { x, y, z };
  }
}
/** which tower (x, z) is in (its walls included), -1 outside them all */
export function firmAt(x: number, z: number, m = 0) {
  for (let k = 0; k < FIRMS.length; k++) {
    const F = FIRMS[k];
    if (Math.abs(x - F.x) < F.w / 2 + m && Math.abs(z - F.z) < F.d / 2 + m) return k;
  }
  return -1;
}
/** the floor level a fighter at height y inside a tower is on (0 lobby, 1, 2); -1 outside */
export function firmLevel(x: number, z: number, y: number) {
  if (firmAt(x, z) < 0) return -1;
  let lv = 0;
  DT.levels.forEach((L, k) => {
    if (y >= L - 0.6) lv = k;
  });
  return lv;
}
const inBox = (b: LBox, x: number, z: number, m = 0) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m;
/** 洛城午后 floor at (x, z) for something at height y: the ground, the bridge, a tower floor, a desk top */
export function laFloorAt(x: number, z: number, y: number) {
  let g = laHeight(x, z);
  const k = firmAt(x, z);
  if (k < 0) return g;
  for (const L of DT.levels) if (L > 0 && y >= L - 0.6) g = Math.max(g, L);
  for (const b of FIRM_IN[k].boxes) if (b.top && b.y1 <= y + 0.6 && b.y1 > g && inBox(b, x, z)) g = b.y1;
  return g;
}
/** the ceiling over someone at height y (999 out in the open) */
export function laCeilAt(x: number, z: number, y: number) {
  if (firmAt(x, z) < 0) return 999;
  if (y < DT.lobbyH - 0.4) return DT.lobbyH;
  for (const L of DT.levels) if (L > 0 && y >= L - 0.6 && y < L + DT.floorH) return L + DT.floorH;
  return 999;
}
/** is a body of radius r with feet at y inside a wall, desk or person here? Low tops (a step) don't count */
export function laBlocked(x: number, z: number, y: number, r = 0.38) {
  const k = firmAt(x, z, r + 0.5);
  if (k < 0) return false;
  for (const b of FIRM_IN[k].boxes) if (b.y1 > y + 0.55 && b.y0 < y + 1.75 && inBox(b, x, z, r)) return true;
  return false;
}
/** push a body out of the boxes it overlaps (the nearest way out); returns true if it moved */
export function laPushOut(p: number[], r = 0.38) {
  const k = firmAt(p[0], p[2], r + 0.5);
  if (k < 0) return false;
  let moved = false;
  for (const b of FIRM_IN[k].boxes) {
    if (!(b.y1 > p[1] + 0.55 && b.y0 < p[1] + 1.75)) continue;
    const cx = Math.max(b.x0, Math.min(b.x1, p[0]));
    const cz = Math.max(b.z0, Math.min(b.z1, p[2]));
    const dx = p[0] - cx;
    const dz = p[2] - cz;
    const d = Math.hypot(dx, dz);
    if (d >= r) continue;
    if (d > 1e-4) {
      p[0] = cx + (dx / d) * r;
      p[2] = cz + (dz / d) * r;
    } else {
      // the centre is inside: out by the shortest way
      const opts = [p[0] - b.x0, b.x1 - p[0], p[2] - b.z0, b.z1 - p[2]];
      const m = opts.indexOf(Math.min(...opts));
      if (m === 0) p[0] = b.x0 - r;
      else if (m === 1) p[0] = b.x1 + r;
      else if (m === 2) p[2] = b.z0 - r;
      else p[2] = b.z1 + r;
    }
    moved = true;
  }
  return moved;
}
/** where you may walk: the park's circle, the footbridge, the plaza (towers are inside the plaza) */
export function laInside(x: number, z: number) {
  if (Math.hypot(x, z) <= LA.radius) return true;
  const B = DT.bridge;
  if (x >= B.x0 && x <= B.x1 && Math.abs(z - B.z) <= B.half) return true;
  const R = DT.rect;
  return x >= R.x0 && x <= R.x1 && z >= R.z0 && z <= R.z1;
}
/** the nearest walkable point to (x, z) */
export function laClamp(x: number, z: number): [number, number] {
  if (laInside(x, z)) return [x, z];
  const c: [number, number][] = [];
  const d = Math.hypot(x, z) || 1;
  c.push([(x * (LA.radius - 0.05)) / d, (z * (LA.radius - 0.05)) / d]);
  const B = DT.bridge;
  c.push([Math.max(B.x0, Math.min(B.x1, x)), Math.max(B.z - B.half + 0.02, Math.min(B.z + B.half - 0.02, z))]);
  const R = DT.rect;
  c.push([Math.max(R.x0 + 0.02, Math.min(R.x1 - 0.02, x)), Math.max(R.z0 + 0.02, Math.min(R.z1 - 0.02, z))]);
  let best = c[0];
  let bd = Infinity;
  for (const p of c) {
    const dd = Math.hypot(p[0] - x, p[1] - z);
    if (dd < bd && laInside(p[0], p[1])) {
      bd = dd;
      best = p;
    }
  }
  return best;
}
/** a market: one price path per symbol, the same for the wall screens and the trading desk (t in seconds) */
const mHash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const mNoise = (t: number, seed: number) => {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return mHash(i + seed * 101.3) * (1 - u) + mHash(i + 1 + seed * 101.3) * u - 0.5;
};
export function marketPx(sym: number, t: number, base = 100) {
  const a = mNoise(t / 22, sym) * 0.11 + mNoise(t / 7, sym + 7) * 0.045 + mNoise(t / 2.1, sym + 13) * 0.016 + mNoise(t * 1.3, sym + 19) * 0.005;
  return base * Math.exp(a);
}
export const MARKET_SYMS = [
  { s: 'NASDAQ', base: 4963 },
  { s: 'DOW', base: 11497 },
  { s: 'S&P 500', base: 1469 },
  { s: 'MSFT', base: 116 },
  { s: 'CSCO', base: 77 },
  { s: 'INTC', base: 66 },
  { s: 'ORCL', base: 39 },
  { s: 'YHOO', base: 179 },
  { s: 'AOL', base: 57 },
  { s: 'QCOM', base: 89 },
  { s: 'SUNW', base: 97 },
  { s: 'AMZN', base: 76 },
];
/** the clock the market runs on (shared by the screens and the desk) */
export const marketT = () => performance.now() / 1000;
{
  // houses: lots along the hillside streets, each on its own flat pad
  const rnd = (() => {
    let s = 777;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  })();
  for (const sz of LA.streets)
    for (const side of [-1, 1]) {
      for (let x = -70; x <= 120; x += 17 + rnd() * 5) {
        const w = 10 + rnd() * 4;
        const d = 8 + rnd() * 3;
        const z = sz + side * (4 + 2 + d / 2 + 1.5);
        LA.houses.push({ x, z, w, d, yaw: side > 0 ? Math.PI : 0, y: laBase(x, z), kind: Math.floor(rnd() * 3) });
        // a car at the kerb outside most of them
        if (rnd() < 0.75) LA.parked.push({ x: x + (rnd() - 0.5) * 6, z: sz + side * 2.6, yaw: Math.PI / 2 + (rnd() < 0.5 ? 0 : Math.PI), c: Math.floor(rnd() * 8) });
      }
    }
  // palms: a ring round the lake, an avenue down to it, others about the park
  const L = LA.lake;
  for (let k = 0; k < 26; k++) {
    const a = (k / 26) * Math.PI * 2 + rnd() * 0.08;
    LA.palms.push([L.x + Math.cos(a) * (L.rx + 7), L.z + Math.sin(a) * (L.rz + 7), 18 + rnd() * 9, k % 3 === 0 ? 1 : 0]);
  }
  for (let z = -60; z <= 90; z += 15) LA.palms.push([90, z, 20 + rnd() * 6, 0], [104, z + 7, 20 + rnd() * 6, 0]);
  for (let k = 0; k < 18; k++) {
    const x = -70 + rnd() * 200;
    const z = -70 + rnd() * 150;
    if (lakeE(x, z) < 1.35 || Math.abs(x - 97) < 12) continue;
    LA.palms.push([x, z, 10 + rnd() * 14, rnd() < 0.5 ? 1 : 0]);
  }
  // the orange grove
  const F = LA.farm;
  for (let x = F.x0 + 6; x < F.x1 - 30; x += 5.5) for (let z = F.z0 + 6; z < F.z1 - 40; z += 5) LA.grove.push([x + (rnd() - 0.5) * 0.6, z + (rnd() - 0.5) * 0.6]);
  // flower beds in the park
  for (let k = 0; k < 14; k++) {
    const x = -60 + rnd() * 170;
    const z = -60 + rnd() * 140;
    if (lakeE(x, z) < 1.3) continue;
    LA.beds.push([x, z, 1.8 + rnd() * 1.6]);
  }
}
/** the ground as it is drawn (no footbridge: that's its own mesh, over the freeway) */
export function laTerrain(x: number, z: number) {
  let h = laBase(x, z);
  // the lake: a shallow bowl
  const e = lakeE(x, z);
  if (e < 1.12) h = h + (LA.lake.bed - h) * (1 - ssL(0.82, 1.12, e));
  // the streets: cut level along the hill
  for (const sz of LA.streets) {
    const dz = Math.abs(z - sz);
    if (dz < 9 && x > -82 && x < 132) h = h + (laBase(x, sz) - h) * (1 - ssL(4.5, 9, dz));
  }
  // house pads
  for (const H of LA.houses) {
    const dx = Math.abs(x - H.x) - H.w / 2;
    const dz = Math.abs(z - H.z) - H.d / 2;
    const out = Math.max(dx, dz);
    if (out < 4) h = h + (H.y - h) * (1 - ssL(0.5, 4, out));
  }
  return h;
}
export function laHeight(x: number, z: number) {
  let h = laTerrain(x, z);
  // the footbridge: level with the plaza, easing into the park at its west end
  const B = DT.bridge;
  if (x > B.x0 && x < B.x1 + 1 && Math.abs(z - B.z) < B.half + 0.3) h = h + (DT.y - h) * ssL(B.x0, B.x0 + 10, x);
  return h;
}
/** shallow lake water at (x, z): depth, 0 on dry land */
export function laWater(x: number, z: number) {
  return Math.max(0, LA.lake.water - laHeight(x, z));
}
/** solid footprints as rows of circles (houses, barn) */
function boxCircles(x: number, z: number, w: number, d: number, yaw: number): Circle[] {
  const out: Circle[] = [];
  const r = Math.min(w, d) / 4;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (let u = -w / 2 + r; u <= w / 2 - r + 0.01; u += r * 1.2)
    for (let v = -d / 2 + r; v <= d / 2 - r + 0.01; v += r * 1.2) out.push({ x: x + u * c + v * s, z: z - u * s + v * c, r });
  return out;
}
/** cash and watches: what turns up, what it's worth (in 两 of silver, the game's money) */
export const LOOT = {
  kinds: [
    { id: 'cash', name: '一沓钞票', value: 100, weight: 70 },
    { id: 'cashBig', name: '一捆钞票', value: 500, weight: 20 },
    { id: 'rolex', name: 'Rolex 腕表', value: 8000, weight: 5 },
    { id: 'iwc', name: 'IWC 腕表', value: 6000, weight: 4 },
    { id: 'patek', name: 'Patek Philippe 腕表', value: 30000, weight: 1 },
  ],
  max: 26,
  every: 4,
};

MAPS.losangeles = {
  id: 'losangeles',
  name: '洛城午后',
  subtitle: '千禧年的洛杉矶：湖边棕榈公园、山坡住宅、橙子农场、高速公路和市中心金融区',
  icon: '🌴',
  mechanics: [
    '超大地图：中间一个湖（水浅，能蹚过去但走得慢），北坡是住宅区，西边是橙子农场，东边坡下是车流不断的高速公路，再往东是市中心的金融大楼',
    '地图上会不停冒出钞票，偶尔还有 Rolex、IWC、百达翡丽的表，走过去就捡起来',
    '被打倒时身上捡的东西会掉一地，谁都能抢；回合结束时你身上的东西会存进「身家」（大厅里能看到）',
    '公园东边有座天桥跨过高速，通到市中心广场：Goldman Sachs、Morgan Stanley、Citadel、IMC Trading 四栋楼都能走进去，大堂中间坐电梯（左边上楼、右边下楼）去 40 层交易大厅和 80 层投行部',
    '投行家任务线：从实习生做起，报到、送 pitchbook、熬夜改模型、在 Citadel 交易台做单、签收购协议，一路升到 MD，奖励直接进身家（左上角有任务提示，金色光柱指路）',
    '一打一或组队都能玩，把对面打倒就赢',
  ],
  homeClass: 'Shadowblade',
  homeClassName: '影刃',
  homeBonus: '伤害 +10%',
  available: true,
  terrain: true,
  radius: LA.radius,
  spawnPlayer: LA.spawns[0],
  spawnEnemy: LA.spawns[1],
  background: '#c9c4b4',
  fog: [260, 2600],
  hemi: ['#cfe3ff', '#6b6a4a', 0.7],
  keyColor: '#fff0d8',
  keyIntensity: 3.1,
  exposure: 0.72,
  bloom: 0.55,
  env: 0.7,
  sunDir: [-0.55, 0.62, 0.56],
  cardGradient: 'from-sky-500/50 via-amber-600/40 to-zinc-950/90',
  pillars: [
    ...LA.palms.map(([x, z, , k]) => ({ x, z, r: k ? 0.35 : 0.42 })),
    ...LA.beds.map(([x, z, r]) => ({ x, z, r, h: 0.55 })),
    ...LA.grove.map(([x, z]) => ({ x, z, r: 0.35 })),
    ...LA.houses.flatMap((h) => boxCircles(h.x, h.z, h.w, h.d, h.yaw)),
    ...boxCircles(LA.barn[0], LA.barn[1], 14, 20, 0),
    { x: LA.mill[0], z: LA.mill[1], r: 1.2 },
    ...LA.parked.map((c) => ({ x: c.x, z: c.z, r: 1.1, h: 1.4 })),
    // the plaza's fountain (you can stand on its rim)
    { x: DT.fountain[0], z: DT.fountain[1], r: 4.2, h: 0.7 },
  ],
} as MapDef;

export function terrainHeight(id: MapId, x: number, z: number) {
  if (id === 'losangeles') return laHeight(x, z);
  if (id === 'coast') return coastHeight(x, z);
  if (id === 'wending') return warHeight(x, z);
  if (id === 'sea') return shipFloorAt(x, z, 99);
  if (id === 'glacier') return glacierHeight(x, z);
  if (id === 'forest') return forestHeight(x, z);
  if (id === 'rooftop') return roofHeight(x, z);
  if (id === 'desert') return desertHeight(x, z);
  if (id === 'plankway') return plankHeight(x, z);
  return 0;
}
/** Uphill gradient of the walkable surface. Sheer drops (roof edge to street) are ignored so nobody slides off an edge. */
export function terrainGradient(id: MapId, x: number, z: number): [number, number] {
  if (id === 'glacier') return glacierGradient(x, z);
  if (id === 'losangeles') {
    const e = 0.25;
    return [(laHeight(x + e, z) - laHeight(x - e, z)) / (2 * e), (laHeight(x, z + e) - laHeight(x, z - e)) / (2 * e)];
  }
  if (id === 'coast') {
    const e = 0.25;
    const g = (a: number, b: number) => (coastX(b) > a ? coastHeight(coastX(b) + 0.01, b) : coastHeight(a, b)); // the cliff face is not a slope
    return [(g(x + e, z) - g(x - e, z)) / (2 * e), (g(x, z + e) - g(x, z - e)) / (2 * e)];
  }
  if (id === 'wending') {
    const e = 0.25;
    return [(warHeight(x + e, z) - warHeight(x - e, z)) / (2 * e), (warHeight(x, z + e) - warHeight(x, z - e)) / (2 * e)];
  }
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
    if (id === 'rooftop' && v > h0 + 1.2) return h0; // a hall's wall seen from the street
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
export const SHIP_GAP = { start: 46, min: 26.4, max: 46, speed: 2.0 }; // min: the hulls (12.9 m half beam) just touching
/** boarding planks (跳板) dropped across when the ships lie alongside: centre z of each, half width */
export const SHIP_PLANKS = { z: [-11, -2], half: 1.1 };
/** standing on a boarding plank (planks down), or on the strip of deck edge where one lands */
export function inPlank(x: number, z: number) {
  const B = mapRuntime.board;
  if (B.plank < 0.95) return false;
  const X = mapRuntime.shipX;
  if (x < X[0] + SHIP_LAYOUT.W - 1.4 || x > X[1] - SHIP_LAYOUT.W + 1.4) return false;
  return SHIP_PLANKS.z.some((pz) => Math.abs(z - pz) < SHIP_PLANKS.half - 0.15);
}
/** the helm (船舵) on each ship: on the main deck just forward of the great cabin (ship-local) */
export const SHIP_HELM = { x: 0, z: 11.4, r: 0.55 };
export function shipOf(x: number) {
  const s = mapRuntime.shipX;
  return x < (s[0] + s[1]) / 2 ? 0 : 1;
}
/** is (x, z) over a ship's hull (rather than open water between or beside them) */
export function overShip(x: number, z: number) {
  if (inPlank(x, z)) return true;
  const k = shipOf(x);
  return Math.abs(x - mapRuntime.shipX[k]) < SHIP_LAYOUT.W + 0.2 && z > -52 && z < 41;
}
export function shipFloorAt(x: number, z: number, y: number) {
  const k = shipOf(x);
  const f = shipFloorAtL(x - mapRuntime.shipX[k], z, y);
  return inPlank(x, z) && y >= -0.6 ? Math.max(f, 0.08) : f;
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
