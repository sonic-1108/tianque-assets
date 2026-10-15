import { DESERT, MAPS, desertHeight, mapRuntime } from './maps';

// ----------------------------------------------------------------------
// 大漠玉门关 AI navigation: a 1 m grid over the height field. A step between two cells is walkable
// when it climbs at most a hop (1.25 m, the low rubble and crates) and drops at most 1.4 m (walking
// never goes over a bigger edge). A* over that grid gives the way round: through a gate, over the
// breach, up a ramp. Steering heads for the farthest point along the path it can walk to in a
// straight line.
// ----------------------------------------------------------------------

const CELL = 1;
const R = DESERT.radius;
const N = Math.ceil((2 * R) / CELL) + 1;
const UP_FREE = 0.55;
const UP_HOP = 1.25;
const DOWN = 1.4;

interface Grid {
  h: Float32Array;
  block: Uint8Array;
  hug: Uint8Array;
}
let grid: Grid | null = null;

const cx = (i: number) => -R + i * CELL;
const ix = (x: number) => Math.round((x + R) / CELL);

function build(): Grid {
  const h = new Float32Array(N * N);
  const block = new Uint8Array(N * N);
  const hug = new Uint8Array(N * N);
  const pillars = MAPS.desert.pillars || [];
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = cx(i);
      const z = cx(j);
      const k = j * N + i;
      h[k] = desertHeight(x, z);
      if (Math.hypot(x, z) > R - 1.2) block[k] = 1;
      for (const p of pillars) if (Math.hypot(x - p.x, z - p.z) < p.r + 0.55) block[k] = 1;
    }
  // cells beside a sheer face (a wall, a tower): paths keep a step away from them where there's room
  for (let j = 1; j < N - 1; j++)
    for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      for (let dj = -1; dj <= 1 && !hug[k]; dj++)
        for (let di = -1; di <= 1; di++) {
          const nk = (j + dj) * N + i + di;
          if (block[nk] || h[nk] - h[k] > UP_HOP) {
            hug[k] = 1;
            break;
          }
        }
    }
  return { h, block, hug };
}
let gateKey = '';
function G() {
  // the city gates are part of the ground: rebuild when one has swung shut or open
  const gs = mapRuntime.desert?.gate ?? [0, 0];
  const key = gs.map((f) => (f > 0.5 ? 1 : 0)).join('');
  if (key !== gateKey) {
    gateKey = key;
    grid = null;
  }
  return (grid ??= build());
}

/** can you walk from height a to height b (one small step)? */
function stepOK(a: number, b: number) {
  return b - a <= UP_HOP && a - b <= DOWN;
}

function edgeOK(g: Grid, a: number, b: number) {
  if (g.block[b]) return false;
  const ha = g.h[a];
  const hb = g.h[b];
  if (!stepOK(ha, hb)) return false;
  // the midpoint too, so a thin ledge between two cell centres isn't skipped
  const ai = a % N;
  const aj = (a / N) | 0;
  const bi = b % N;
  const bj = (b / N) | 0;
  const hm = desertHeight((cx(ai) + cx(bi)) / 2, (cx(aj) + cx(bj)) / 2);
  return stepOK(ha, hm) && stepOK(hm, hb);
}

/** half the width of the corridor a walker needs: the body (0.3 m) and a little room, so a line that only
 *  just scrapes past a gate tower's corner doesn't count as clear (the shoulder would catch on it) */
const BODY = 0.5;

/** walkable in a straight line from (x0, z0) to (x1, z1), sampling every 0.5 m, with a body's width */
export function desertLineClear(x0: number, z0: number, x1: number, z1: number) {
  const L = Math.hypot(x1 - x0, z1 - z0);
  if (L < 1e-3) return true;
  const px = (-(z1 - z0) / L) * BODY;
  const pz = ((x1 - x0) / L) * BODY;
  return lineClear(x0, z0, x1, z1) && lineClear(x0 + px, z0 + pz, x1 + px, z1 + pz, x0, z0) && lineClear(x0 - px, z0 - pz, x1 - px, z1 - pz, x0, z0);
}
function lineClear(x0: number, z0: number, x1: number, z1: number, rx = x0, rz = z0) {
  const g = G();
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(L / 0.5));
  // a side line starts level with the walker's feet (it may begin right next to a wall)
  let prev = desertHeight(rx, rz);
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const hh = desertHeight(x, z);
    if (hh - prev > UP_FREE + 0.05 && hh - prev > 0.05) return false; // even a hop-able ledge: take the path (it knows where)
    if (prev - hh > DOWN) return false;
    const i = ix(x);
    const j = ix(z);
    if (i < 0 || j < 0 || i >= N || j >= N || g.block[j * N + i]) return false;
    prev = hh;
  }
  return true;
}

function nearest(g: Grid, x: number, z: number, y: number) {
  const i0 = ix(x);
  const j0 = ix(z);
  let best = -1;
  let bd = 1e9;
  for (let r = 0; r <= 3 && best < 0; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const k = j * N + i;
        if (g.block[k]) continue;
        const d = Math.hypot(cx(i) - x, cx(j) - z) + Math.abs(g.h[k] - y) * 2;
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
  return best;
}

// A* scratch
const gScore = new Float32Array(N * N);
const came = new Int32Array(N * N);
const stamp = new Uint32Array(N * N);
const closed = new Uint32Array(N * N);
let pass = 1;
const heap: number[] = [];
const heapF: number[] = [];
function push(k: number, f: number) {
  heap.push(k);
  heapF.push(f);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapF[p] <= heapF[i]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    [heapF[p], heapF[i]] = [heapF[i], heapF[p]];
    i = p;
  }
}
function pop() {
  const top = heap[0];
  const lk = heap.pop()!;
  const lf = heapF.pop()!;
  if (heap.length) {
    heap[0] = lk;
    heapF[0] = lf;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && heapF[l] < heapF[m]) m = l;
      if (r < heap.length && heapF[r] < heapF[m]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      [heapF[m], heapF[i]] = [heapF[i], heapF[m]];
      i = m;
    }
  }
  return top;
}

const NB: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function findPath(g: Grid, start: number, goal: number): number[] | null {
  if (start < 0 || goal < 0) return null;
  pass++;
  heap.length = 0;
  heapF.length = 0;
  const gi = goal % N;
  const gj = (goal / N) | 0;
  const hfn = (k: number) => Math.hypot((k % N) - gi, ((k / N) | 0) - gj);
  stamp[start] = pass;
  gScore[start] = 0;
  came[start] = -1;
  push(start, hfn(start));
  let iter = 0;
  while (heap.length && iter++ < 30000) {
    const k = pop();
    if (closed[k] === pass) continue;
    closed[k] = pass;
    if (k === goal) {
      const out: number[] = [];
      for (let c = k; c >= 0; c = came[c]) out.push(c);
      return out.reverse();
    }
    const i = k % N;
    const j = (k / N) | 0;
    for (const [di, dj, w] of NB) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (closed[nk] === pass) continue;
      if (!edgeOK(g, k, nk)) continue;
      if (di && dj && (g.block[j * N + ni] || g.block[nj * N + i])) continue; // no cutting corners
      const rise = g.h[nk] - g.h[k];
      const cost = gScore[k] + w + (rise > UP_FREE ? 2 : 0) + (g.hug[nk] ? 1.5 : 0);
      if (stamp[nk] === pass && cost >= gScore[nk]) continue;
      stamp[nk] = pass;
      gScore[nk] = cost;
      came[nk] = k;
      push(nk, cost + hfn(nk));
    }
  }
  return null;
}

export interface DesertNav {
  path: number[] | null;
  goal: number;
  repath: number;
  clearT: number;
  clear: boolean;
  /** seconds left of following the grid path even where a straight walk looks clear (set when a wall stopped us) */
  force: number;
}
export const newDesertNav = (): DesertNav => ({ path: null, goal: -1, repath: 0, clearT: 0, clear: true, force: 0 });

/** the walker ran into a wall while walking straight: follow the grid for a while instead */
export function desertBumped(S: DesertNav) {
  if (S.force <= 0) S.repath = 0;
  S.force = 2.5;
}

/**
 * Where to walk to reach (tx, ty, tz): null when a straight walk gets there (or nothing better is known),
 * otherwise a point a little way along the route.
 */
export function desertSteer(S: DesertNav, x: number, y: number, z: number, tx: number, ty: number, tz: number, dt: number): { x: number; z: number } | null {
  const g = G();
  S.clearT -= dt;
  S.force -= dt;
  if (S.force > 0) {
    S.clear = false;
    S.clearT = 0;
  } else if (S.clearT <= 0) {
    S.clearT = 0.25;
    S.clear = Math.abs(desertHeight(tx, tz) - desertHeight(x, z)) < 0.8 && desertLineClear(x, z, tx, tz);
  }
  if (S.clear) {
    S.path = null;
    return null;
  }
  S.repath -= dt;
  const goal = nearest(g, tx, tz, ty);
  if (S.repath <= 0 || goal !== S.goal || !S.path) {
    S.repath = 0.6;
    S.goal = goal;
    S.path = findPath(g, nearest(g, x, z, y), goal);
  }
  const P = S.path;
  if (!P || P.length < 2) return null;
  // the path cell nearest to us, then the farthest one ahead we can walk straight to
  let near = 0;
  let nd = 1e9;
  for (let k = 0; k < P.length; k++) {
    const d = Math.hypot(cx(P[k] % N) - x, cx((P[k] / N) | 0) - z) + Math.abs(g.h[P[k]] - y) * 3;
    if (d < nd) {
      nd = d;
      near = k;
    }
  }
  let pick = Math.min(P.length - 1, near + 1);
  for (let k = Math.min(P.length - 1, near + 10); k > near + 1; k--) {
    const px = cx(P[k] % N);
    const pz = cx((P[k] / N) | 0);
    if (desertLineClear(x, z, px, pz)) {
      pick = k;
      break;
    }
  }
  return { x: cx(P[pick] % N), z: cx((P[pick] / N) | 0) };
}

/** for tests: walk the grid from a to b, return the path length in cells (or -1) */
export function desertPathLen(x0: number, z0: number, x1: number, z1: number) {
  const g = G();
  const p = findPath(g, nearest(g, x0, z0, desertHeight(x0, z0)), nearest(g, x1, z1, desertHeight(x1, z1)));
  return p ? p.length : -1;
}
