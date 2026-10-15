import { ROOF, CHANGAN_EDGE, roofFloorAt, roofCeilAt } from './maps';

// ----------------------------------------------------------------------
// 长安上元夜 AI navigation at street level: a 1 m grid of the streets and alleys round and between the
// halls (under the eaves and under the bridges counts as street). A* over it finds the way round the
// buildings; steering heads for the farthest point along the path it can walk to in a straight line.
// When what it wants is up on a roof, the goal is the nearest open-sky street cell below it, from where
// it can jump up.
// ----------------------------------------------------------------------

const R = CHANGAN_EDGE - 0.6;
const N = Math.ceil(2 * R) + 1;
const cx = (i: number) => -R + i;
const ix = (x: number) => Math.max(0, Math.min(N - 1, Math.round(x + R)));

let walk: Uint8Array | null = null;
let open: Uint8Array | null = null;

function build() {
  walk = new Uint8Array(N * N);
  open = new Uint8Array(N * N);
  const y = ROOF.street;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = cx(i);
      const z = cx(j);
      // a little clearance from walls: the body is 0.3 m round
      let ok = true;
      for (const [dx, dz] of [[0, 0], [0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) if (roofFloorAt(x + dx, z + dz, y) > y + 0.3) ok = false;
      walk[j * N + i] = ok ? 1 : 0;
      open[j * N + i] = ok && roofCeilAt(x, z, y) > 900 ? 1 : 0;
    }
}
function grids() {
  if (!walk) build();
  return { walk: walk!, open: open! };
}

/** a straight walk from a to b stays on the street */
export function streetLineClear(x0: number, z0: number, x1: number, z1: number) {
  const { walk } = grids();
  const L = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(L / 0.5));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!walk[ix(z0 + (z1 - z0) * t) * N + ix(x0 + (x1 - x0) * t)]) return false;
  }
  return true;
}

/** the nearest street cell to (x, z) (open sky only if asked): its index */
function nearestCell(x: number, z: number, needOpen: boolean) {
  const { walk, open } = grids();
  const g = needOpen ? open : walk;
  const i0 = ix(x);
  const j0 = ix(z);
  for (let r = 0; r < N; r++) {
    let best = -1;
    let bd = 1e9;
    for (let j = j0 - r; j <= j0 + r; j++)
      for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
        if (!g[j * N + i]) continue;
        const d = Math.hypot(cx(i) - x, cx(j) - z);
        if (d < bd) {
          bd = d;
          best = j * N + i;
        }
      }
    if (best >= 0) return best;
  }
  return -1;
}

function astar(a: number, b: number): number[] | null {
  const { walk } = grids();
  if (a < 0 || b < 0) return null;
  const gs = new Float32Array(N * N).fill(1e9);
  const from = new Int32Array(N * N).fill(-1);
  const closed = new Uint8Array(N * N);
  const open: number[] = [a];
  const f = new Float32Array(N * N).fill(1e9);
  const bi = b % N;
  const bj = (b / N) | 0;
  const h = (k: number) => Math.hypot((k % N) - bi, ((k / N) | 0) - bj);
  gs[a] = 0;
  f[a] = h(a);
  let it = 0;
  while (open.length && it++ < 20000) {
    let bk = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bk]]) bk = k;
    const cur = open[bk];
    open[bk] = open[open.length - 1];
    open.pop();
    if (cur === b) {
      const out = [b];
      let k = b;
      while (from[k] >= 0) out.push((k = from[k]));
      return out.reverse();
    }
    closed[cur] = 1;
    const ci = cur % N;
    const cj = (cur / N) | 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (!walk[nk] || closed[nk]) continue;
        if (di && dj && (!walk[cj * N + ni] || !walk[nj * N + ci])) continue; // no cutting corners
        const g = gs[cur] + (di && dj ? 1.414 : 1);
        if (g >= gs[nk]) continue;
        gs[nk] = g;
        from[nk] = cur;
        f[nk] = g + h(nk);
        if (!open.includes(nk)) open.push(nk);
      }
  }
  return null;
}

export interface StreetNav {
  path: number[] | null;
  goal: number;
  repath: number;
}
export const newStreetNav = (): StreetNav => ({ path: null, goal: -1, repath: 0 });

/**
 * Where to walk next (street level) on the way to (tx, tz); `up` when the target stands on a roof (then the goal
 * is an open-sky cell below it). Returns null when there's nothing to do (already there, or no way).
 */
export function streetSteer(S: StreetNav, x: number, z: number, tx: number, tz: number, up: boolean, dt: number): { x: number; z: number; arrived: boolean } | null {
  const goal = nearestCell(tx, tz, up);
  if (goal < 0) return null;
  const gx = cx(goal % N);
  const gz = cx((goal / N) | 0);
  if (Math.hypot(gx - x, gz - z) < 0.8) return { x: gx, z: gz, arrived: true };
  if (streetLineClear(x, z, gx, gz)) return { x: gx, z: gz, arrived: false };
  S.repath -= dt;
  if (!S.path || S.goal !== goal || S.repath <= 0) {
    S.repath = 0.5;
    S.goal = goal;
    S.path = astar(nearestCell(x, z, false), goal);
  }
  const P = S.path;
  if (!P || P.length < 2) return null;
  // the farthest path point reachable in a straight line
  let bestK = 1;
  for (let k = P.length - 1; k >= 1; k--) {
    if (streetLineClear(x, z, cx(P[k] % N), cx((P[k] / N) | 0))) {
      bestK = k;
      break;
    }
  }
  return { x: cx(P[bestK] % N), z: cx((P[bestK] / N) | 0), arrived: false };
}
