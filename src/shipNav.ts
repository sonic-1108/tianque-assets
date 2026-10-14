// 怒海战船 navigation for the AI: a walk graph over every floor of the ship, built once from the same
// solid boxes the physics uses (decks, stair treads, walls, the hatch rail) plus the crates and masts.
// A node is a 0.5 m cell on one floor surface; you can step to a neighbouring cell if nothing blocks
// you there and the floor you'd land on is at most a step up (stepping or dropping down is fine).
// Stairs, doors, the hatch and every way round a crate fall out of that on their own.
import { SHIP_BOXES, SHIP_LAYOUT, SEA_PILLARS_LOCAL, shipFloorAtL as shipFloorAt, shipBlockedL as shipBlocked, type ShipBox } from './maps';
import navWasmUrl from './wasm/shipnav.wasm?url';

// The graph and A* run in C++ compiled to WebAssembly (native/shipnav.cpp) once it has loaded; until then (or if a
// browser can't run it) the JavaScript version below does the same job.
interface NavWasm {
  memory: WebAssembly.Memory;
  boxes_buf(): number;
  pillars_buf(): number;
  seeds_buf(): number;
  nav_build(nb: number, np: number, ns: number, hx: number, hz: number, holdY: number): number;
  nav_px(): number;
  nav_py(): number;
  nav_pz(): number;
  nav_nearest(x: number, y: number, z: number): number;
  nav_path_buf(): number;
  nav_path(a: number, b: number): number;
}
let W: NavWasm | null = null;
export const navWasmReady: Promise<boolean> =
  typeof WebAssembly === 'undefined' || typeof fetch === 'undefined'
    ? Promise.resolve(false)
    : fetch(navWasmUrl)
        .then((r) => r.arrayBuffer())
        .then((b) => WebAssembly.instantiate(b, {}))
        .then((m) => {
          W = m.instance.exports as unknown as NavWasm;
          if (G && !G.wasm) G = null; // rebuild on the fast path next time it's asked for
          return true;
        })
        .catch(() => false);
/** test hook: use a module instantiated elsewhere (node) */
export function useNavWasm(exports: unknown) {
  W = exports as NavWasm;
  G = null;
}

const CELL = 0.5;
const STEP = 0.6;
const R = 0.4; // keep this far from walls (fighters are 0.38)

interface Graph {
  hx: number;
  hz: number;
  nx: number;
  nz: number;
  /** node -> x, y, z */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  /** CSR adjacency */
  start: Int32Array;
  next: Int32Array;
  cost: Float32Array;
  /** cell index -> nodes standing in it */
  byCell: number[][];
  /** built by the WebAssembly module (paths and lookups go there too) */
  wasm?: boolean;
}

function seedPoints(): [number, number, number][] {
  const L = SHIP_LAYOUT;
  return [[3, 9, 0.1], [-6, -14, L.holdY + 0.1], [5, -33, L.fore.y + 0.1], ...L.tiers.map((t) => [4, t.edge + 2.5, t.y + 0.1] as [number, number, number])];
}

function buildWasm(w: NavWasm): Graph | null {
  const rect = { hx: 11.8, hz: 40 }; // one ship, in its own coordinates
  const hx = rect.hx - 0.35;
  const hz = rect.hz - 0.35;
  const f32 = () => new Float32Array(w.memory.buffer);
  let m = f32();
  const bo = w.boxes_buf() >> 2;
  SHIP_BOXES.forEach((b, k) => m.set([b.x0, b.x1, b.y0, b.y1, b.z0, b.z1, b.kind === 'tread' ? 1 : 0], bo + k * 7));
  const pillars = SEA_PILLARS_LOCAL;
  const po = w.pillars_buf() >> 2;
  pillars.forEach((p, k) => m.set([p.x, p.z, p.r, p.h ?? 99, p.y0 ?? -99], po + k * 5));
  const seeds = seedPoints();
  const so = w.seeds_buf() >> 2;
  seeds.forEach((s, k) => m.set(s, so + k * 3));
  const n = w.nav_build(SHIP_BOXES.length, pillars.length, seeds.length, hx, hz, SHIP_LAYOUT.holdY);
  if (n <= 0) return null;
  m = f32();
  const view = (ptr: number) => m.subarray(ptr >> 2, (ptr >> 2) + n);
  const nx = Math.floor((hx * 2) / CELL) + 1;
  const nz = Math.floor((hz * 2) / CELL) + 1;
  return { hx, hz, nx, nz, px: view(w.nav_px()), py: view(w.nav_py()), pz: view(w.nav_pz()), start: new Int32Array(0), next: new Int32Array(0), cost: new Float32Array(0), byCell: [], wasm: true };
}

let G: Graph | null = null;

function build(): Graph {
  const rect = { hx: 11.8, hz: 40 }; // one ship, in its own coordinates
  const hx = rect.hx - 0.35;
  const hz = rect.hz - 0.35;
  const nx = Math.floor((hx * 2) / CELL) + 1;
  const nz = Math.floor((hz * 2) / CELL) + 1;
  const cx = (i: number) => -hx + i * CELL;
  const cz = (j: number) => -hz + j * CELL;
  // boxes near each cell (within the blocking reach)
  const near: ShipBox[][] = Array.from({ length: nx * nz }, () => []);
  for (const b of SHIP_BOXES) {
    const i0 = Math.max(0, Math.floor((b.x0 - R + hx) / CELL));
    const i1 = Math.min(nx - 1, Math.ceil((b.x1 + R + hx) / CELL));
    const j0 = Math.max(0, Math.floor((b.z0 - R + hz) / CELL));
    const j1 = Math.min(nz - 1, Math.ceil((b.z1 + R + hz) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) near[j * nx + i].push(b);
  }
  const pillars = SEA_PILLARS_LOCAL;
  const inXZ = (b: ShipBox, x: number, z: number, r: number) => x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r;
  const floorAt = (c: number, x: number, z: number, y: number) => {
    let g = SHIP_LAYOUT.holdY;
    for (const b of near[c]) if (b.y1 <= y + STEP && b.y1 > g && inXZ(b, x, z, 0)) g = b.y1;
    return g;
  };
  const blocked = (c: number, x: number, z: number, y: number) => {
    for (const b of near[c]) if (b.y1 > y + 0.55 && b.y0 < y + 1.75 && inXZ(b, x, z, b.kind === 'tread' ? 0.05 : R)) return true;
    for (const p of pillars) if (y < (p.h ?? 99) - 0.45 && y + 1.75 > (p.y0 ?? -99) && Math.hypot(x - p.x, z - p.z) < p.r + R) return true;
    return false;
  };
  const key = (c: number, y: number) => c * 4096 + Math.round((y + 8) * 100);
  const ids = new Map<number, number>();
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const adj: [number, number][][] = [];
  const queue: number[] = [];
  const add = (c: number, y: number) => {
    const k = key(c, y);
    let id = ids.get(k);
    if (id === undefined) {
      id = px.length;
      ids.set(k, id);
      px.push(cx(c % nx));
      py.push(y);
      pz.push(cz(Math.floor(c / nx)));
      adj.push([]);
      queue.push(id);
    }
    return id;
  };
  // seeds: a spot on every floor (they're all connected by stairs anyway)
  const seed = (x: number, z: number, y: number) => {
    const i = Math.round((x + hx) / CELL);
    const j = Math.round((z + hz) / CELL);
    const c = j * nx + i;
    const f = floorAt(c, cx(i), cz(j), y);
    if (!blocked(c, cx(i), cz(j), f)) add(c, f);
  };
  for (const [x, z, y] of seedPoints()) seed(x, z, y);
  const D8: [number, number, number][] = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  while (queue.length) {
    const id = queue.pop()!;
    const i = Math.round((px[id] + hx) / CELL);
    const j = Math.round((pz[id] + hz) / CELL);
    const y = py[id];
    const step = (di: number, dj: number) => {
      const ii = i + di;
      const jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) return NaN;
      const c = jj * nx + ii;
      const x = cx(ii);
      const z = cz(jj);
      const f = floorAt(c, x, z, y);
      // a cell is coarser than a stair tread: going up, judge it standing on the new step
      if (blocked(c, x, z, Math.max(y, f))) return NaN;
      if (f < y && blocked(c, x, z, f)) return NaN;
      return f;
    };
    for (const [di, dj, w] of D8) {
      if (di && dj && (Number.isNaN(step(di, 0)) || Number.isNaN(step(0, dj)))) continue; // never cut a corner
      const f = step(di, dj);
      if (Number.isNaN(f)) continue;
      const c = (j + dj) * nx + (i + di);
      const to = add(c, f);
      // dropping off a deck is allowed but discouraged (it hurts to land on someone's head)
      adj[id].push([to, w * CELL + (y - f > STEP ? 2 + (y - f) * 0.4 : 0)]);
    }
  }
  // cells at the brink of a drop (the open side of a stair, a deck edge) cost extra, so paths keep to the middle
  const brink = new Uint8Array(px.length);
  for (let k = 0; k < px.length; k++) for (const [t] of adj[k]) if (py[k] - py[t] > STEP) brink[k] = 1;
  for (let k = 0; k < px.length; k++) for (const e of adj[k]) if (brink[e[0]]) e[1] += 0.9;
  const n = px.length;
  const start = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) start[k + 1] = start[k] + adj[k].length;
  const next = new Int32Array(start[n]);
  const cost = new Float32Array(start[n]);
  for (let k = 0; k < n; k++) adj[k].forEach(([t, w], m) => ((next[start[k] + m] = t), (cost[start[k] + m] = w)));
  const byCell: number[][] = Array.from({ length: nx * nz }, () => []);
  for (let k = 0; k < n; k++) byCell[Math.round((pz[k] + hz) / CELL) * nx + Math.round((px[k] + hx) / CELL)].push(k);
  return { hx, hz, nx, nz, px: Float32Array.from(px), py: Float32Array.from(py), pz: Float32Array.from(pz), start, next, cost, byCell };
}

export function shipGraph() {
  if (!G && W) G = buildWasm(W);
  if (!G) G = build();
  return G;
}

/** the node nearest a fighter standing (or hanging in the air) at x, y, z: on a floor at or below their feet */
export function nearestNode(x: number, y: number, z: number) {
  const g = shipGraph();
  if (g.wasm && W) return W.nav_nearest(x, y, z);
  const i = Math.round((x + g.hx) / CELL);
  const j = Math.round((z + g.hz) / CELL);
  let best = -1;
  let bd = 1e9;
  for (let r = 0; r <= 5 && (best < 0 || r <= 1); r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const ii = i + di;
        const jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.nz) continue;
        for (const k of g.byCell[jj * g.nx + ii]) {
          const dy = g.py[k] - y;
          if (dy > 0.7) continue; // a floor above your head isn't where you are
          const d = Math.hypot(g.px[k] - x, g.pz[k] - z) + Math.abs(dy) * 1.5;
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      }
  return best;
}

/** A* from node a to node b: the node list, or null when there's no way */
export function findPath(a: number, b: number): number[] | null {
  const g = shipGraph();
  if (a < 0 || b < 0) return null;
  if (g.wasm && W) {
    const n = W.nav_path(a, b);
    if (!n) return null;
    const p = new Int32Array(W.memory.buffer, W.nav_path_buf(), n);
    return Array.from(p);
  }
  if (a === b) return [a];
  const n = g.px.length;
  const gs = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (k: number) => Math.hypot(g.px[k] - g.px[b], g.pz[k] - g.pz[b]) + Math.abs(g.py[k] - g.py[b]) * 1.2;
  // binary heap of [f, node]
  const heapF: number[] = [];
  const heapN: number[] = [];
  const push = (f: number, k: number) => {
    let c = heapF.length;
    heapF.push(f);
    heapN.push(k);
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (heapF[p] <= heapF[c]) break;
      [heapF[p], heapF[c]] = [heapF[c], heapF[p]];
      [heapN[p], heapN[c]] = [heapN[c], heapN[p]];
      c = p;
    }
  };
  const pop = () => {
    const k = heapN[0];
    const lf = heapF.pop()!;
    const ln = heapN.pop()!;
    if (heapF.length) {
      heapF[0] = lf;
      heapN[0] = ln;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heapF.length && heapF[l] < heapF[m]) m = l;
        if (r < heapF.length && heapF[r] < heapF[m]) m = r;
        if (m === c) break;
        [heapF[m], heapF[c]] = [heapF[c], heapF[m]];
        [heapN[m], heapN[c]] = [heapN[c], heapN[m]];
        c = m;
      }
    }
    return k;
  };
  gs[a] = 0;
  push(h(a), a);
  while (heapF.length) {
    const k = pop();
    if (closed[k]) continue;
    if (k === b) break;
    closed[k] = 1;
    for (let e = g.start[k]; e < g.start[k + 1]; e++) {
      const t = g.next[e];
      const v = gs[k] + g.cost[e];
      if (v < gs[t]) {
        gs[t] = v;
        from[t] = k;
        push(v + h(t), t);
      }
    }
  }
  if (from[b] < 0) return null;
  const out: number[] = [];
  for (let k = b; k >= 0; k = from[k]) out.push(k);
  return out.reverse();
}

/** can you just walk straight there: nothing in the way, no step too high, no drop */
function lineClear(x0: number, y0: number, z0: number, x1: number, z1: number) {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.ceil(d / 0.3);
  const pillars = SEA_PILLARS_LOCAL;
  let y = y0;
  for (let k = 1; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    const z = z0 + ((z1 - z0) * k) / n;
    if (shipBlocked(x, z, y, 0.4)) return false;
    for (const p of pillars) if (y < (p.h ?? 99) - 0.45 && y + 1.75 > (p.y0 ?? -99) && Math.hypot(x - p.x, z - p.z) < p.r + 0.4) return false;
    const f = shipFloorAt(x, z, y);
    if (f < y - STEP) return false;
    y = f;
  }
  return true;
}

/** is there floor all the way along a straight walk from here to there (the height going smoothly from one to the other) */
function segOK(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25);
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const y = y0 + (y1 - y0) * t;
    if (shipFloorAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, y + 0.35) < y - 0.7) return false;
  }
  return true;
}

export interface NavState {
  path: number[] | null;
  goalNode: number;
  repath: number;
  lx: number;
  lz: number;
  stuckT: number;
  sideT: number;
  side: number;
}
export const newNavState = (): NavState => ({ path: null, goalNode: -1, repath: 0, lx: 0, lz: 0, stuckT: 0, sideT: 0, side: 1 });

/**
 * Where to walk next on the way to (tx, ty, tz). Returns null when a straight approach is fine (same floor,
 * nothing in the way, or already there): the fighting AI takes over. Otherwise a point to head for.
 */
export function shipSteer(S: NavState, me: { x: number; y: number; z: number; grounded: boolean }, tx: number, ty: number, tz: number, dt: number, force = false): { x: number; z: number } | null {
  const g = shipGraph();
  S.repath -= dt;
  const goal = nearestNode(tx, ty + 0.05, tz);
  if (S.repath <= 0 || goal !== S.goalNode || !S.path) {
    S.repath = 0.4;
    S.goalNode = goal;
    const here = nearestNode(me.x, me.y + 0.05, me.z);
    S.path = findPath(here, goal);
  }
  const P = S.path;
  if (!P || P.length < 2) return null;
  // the path node nearest to us (on our floor), and from it a point a little way ahead
  let i0 = 0;
  let bd = 1e9;
  for (let k = 0; k < Math.min(P.length, 40); k++) {
    const d = Math.hypot(g.px[P[k]] - me.x, g.pz[P[k]] - me.z) + Math.abs(g.py[P[k]] - me.y) * 2;
    if (d < bd) {
      bd = d;
      i0 = k;
    }
  }
  const rest = P.length - 1 - i0;
  let len = 0;
  for (let k = i0; k < P.length - 1; k++) len += Math.hypot(g.px[P[k + 1]] - g.px[P[k]], g.pz[P[k + 1]] - g.pz[P[k]]);
  const straight = Math.hypot(tx - me.x, tz - me.z);
  const level = Math.abs(g.py[P[P.length - 1]] - g.py[P[i0]]) < STEP;
  if (!force && (rest <= 2 || (level && len < straight * 1.5 + 2 && lineClear(me.x, me.y, me.z, tx, tz)))) return null;
  if (force && rest <= 1) return null;
  // look ahead along the path, but only as far as the floor stays level with us (so we don't cut the stairs)
  let k = i0;
  while (k < P.length - 1 && k - i0 < 5 && Math.abs(g.py[P[k + 1]] - g.py[P[i0]]) < 1.2) k++;
  // don't aim across a gap (cutting the corner off the open side of a stair)
  while (k > i0 + 1 && !segOK(me.x, me.y, me.z, g.px[P[k]], g.py[P[k]], g.pz[P[k]])) k--;
  // always aim at least past where we stand (the next node may be the floor below a drop)
  while (k < P.length - 1 && Math.hypot(g.px[P[k]] - me.x, g.pz[P[k]] - me.z) < 0.45) k++;
  let x = g.px[P[k]];
  let z = g.pz[P[k]];
  // wedged (a fighter in the way, a lip of planking): step sideways for a moment
  if (Math.hypot(me.x - S.lx, me.z - S.lz) > 0.25) {
    S.lx = me.x;
    S.lz = me.z;
    S.stuckT = 0;
  } else if (me.grounded && (S.stuckT += dt) > 0.6) {
    S.stuckT = 0;
    S.sideT = 0.5;
    S.side = -S.side;
    S.repath = 0;
  }
  if (S.sideT > 0) {
    S.sideT -= dt;
    const dx = x - me.x;
    const dz = z - me.z;
    x = me.x - dz * S.side;
    z = me.z + dx * S.side;
  }
  return { x, z };
}
