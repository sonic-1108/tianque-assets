// Sculpts the seated Buddha for 青冥寺 as a signed distance field, meshes it (surface nets),
// simplifies it with meshoptimizer, bakes ambient occlusion and colour into the vertices,
// and writes public/buddha.bin.  Run: node tools/gen-buddha.mjs
import fs from 'node:fs';
import { MeshoptSimplifier } from 'meshoptimizer';

const hyp = Math.hypot;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
const smax = (a, b, k) => -smin(-a, -b, k);
function ell(px, py, pz, cx, cy, cz, rx, ry, rz) {
  const x = (px - cx) / rx, y = (py - cy) / ry, z = (pz - cz) / rz;
  const k0 = hyp(x, y, z);
  const k1 = hyp(x / rx, y / ry, z / rz);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function cap(px, py, pz, ax, ay, az, bx, by, bz, ra, rb) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return hyp(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
}

/** a ring of n lotus petals around the y axis; tilt leans the tip outward (pi - x points them down) */
function petals(x, y, z, n, R, y0, tilt, len, wid, thick, phase) {
  const a = Math.atan2(z, x);
  const step = (Math.PI * 2) / n;
  const s0 = Math.round((a - phase) / step);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  let best = 1e9;
  for (let s = s0 - 1; s <= s0 + 1; s++) {
    const ang = phase + s * step;
    const c = Math.cos(ang), sn = Math.sin(ang);
    const u = x * c + z * sn - R;
    const w = -x * sn + z * c;
    const v = y - y0;
    let uu = u * ct - v * st;
    const vv = u * st + v * ct;
    const t = clamp(vv / len, 0, 1);
    const taper = Math.max(0.2, 1 - 0.8 * t * t * t);
    // cup the petal: the rim curls outward
    uu -= 0.35 * (w / wid) * (w / wid) * thick;
    const d = ell(uu, vv, w / taper, 0, len * 0.5, 0, thick, len * 0.5, wid) * Math.min(1, taper + 0.3);
    best = Math.min(best, d);
  }
  return best;
}

const HEAD = [0, 2.04, -0.1];
function hairGate(x, y, z) {
  const line = 1.93 + 0.25 * clamp((z + 0.2) / 0.42, 0, 1);
  return sstep(line - 0.02, line + 0.02, y);
}
function headSdf(x, y, z) {
  let h = ell(x, y, z, HEAD[0], HEAD[1], HEAD[2], 0.27, 0.36, 0.32);
  h = smin(h, ell(x, y, z, 0, 1.9, -0.05, 0.22, 0.22, 0.26), 0.1); // jaw
  h = smin(h, ell(x, y, z, 0, 1.775, 0.05, 0.09, 0.06, 0.11), 0.07); // chin
  h = smin(h, cap(x, y, z, 0, 2.07, 0.19, 0, 1.955, 0.245, 0.02, 0.034), 0.045); // nose
  h = smin(h, ell(x, y, z, 0, 1.945, 0.215, 0.055, 0.026, 0.035), 0.03); // nostrils
  for (const s of [-1, 1]) {
    h = smin(h, cap(x, y, z, s * 0.025, 2.085, 0.205, s * 0.17, 2.075, 0.16, 0.026, 0.022), 0.05); // arched brow
    h = smax(h, -ell(x, y, z, s * 0.1, 2.022, 0.212, 0.07, 0.02, 0.04), 0.025); // eye socket
    h = smin(h, ell(x, y, z, s * 0.1, 2.035, 0.19, 0.066, 0.022, 0.03), 0.02); // heavy lowered lid
    h = smin(h, ell(x, y, z, s * 0.27, 1.97, -0.1, 0.04, 0.21, 0.085), 0.035); // long ears
    h = smin(h, ell(x, y, z, s * 0.28, 1.77, -0.08, 0.042, 0.09, 0.062), 0.04); // lobes
    h = smax(h, -ell(x, y, z, s * 0.305, 1.99, -0.08, 0.026, 0.13, 0.05), 0.02); // inner ear
  }
  // lips with a quiet smile
  h = smin(h, ell(x, y, z, 0, 1.877, 0.2, 0.062, 0.017, 0.03), 0.018);
  h = smin(h, ell(x, y, z, 0, 1.848, 0.198, 0.05, 0.019, 0.03), 0.018);
  for (const s of [-1, 1]) h = smax(h, -cap(x, y, z, 0, 1.862, 0.232, s * 0.062, 1.869, 0.212, 0.009, 0.009), 0.012);
  // the ushnisha and a cap of snail-shell curls
  h = smin(h, ell(x, y, z, 0, 2.39, -0.12, 0.15, 0.13, 0.15), 0.035);
  const g = hairGate(x, y, z);
  if (g > 0) {
    const b = 0.5 + 0.5 * Math.sin(x * 36) * Math.sin(y * 36 + 1.3) * Math.sin(z * 36 + 0.7);
    h -= g * (0.016 + 0.022 * b);
  }
  return h;
}
function bodySdf(x, y, z) {
  // lap: crossed legs under a draped robe
  let d = ell(x, y, z, 0, 0.18, 0.1, 0.98, 0.22, 0.6);
  for (const s of [-1, 1]) d = smin(d, cap(x, y, z, s * 0.3, 0.28, -0.08, s * 0.92, 0.2, 0.36, 0.27, 0.22), 0.15);
  d = smin(d, cap(x, y, z, -0.9, 0.2, 0.42, 0.42, 0.28, 0.6, 0.19, 0.15), 0.12);
  d = smin(d, cap(x, y, z, 0.9, 0.2, 0.42, -0.42, 0.36, 0.5, 0.19, 0.14), 0.12);
  // soles turned up on the thighs
  d = smin(d, ell(x, y, z, -0.52, 0.42, 0.42, 0.22, 0.065, 0.11), 0.05);
  d = smin(d, ell(x, y, z, 0.54, 0.34, 0.56, 0.21, 0.065, 0.1), 0.05);
  // radiating robe folds across the lap
  if (y < 0.5 && z > -0.2) {
    const f = Math.sin(Math.atan2(x, z + 0.35) * 15) * sstep(0.5, 0.25, y) * sstep(-0.2, 0.1, z);
    d -= 0.012 * f;
  }
  // torso
  const t = smin(ell(x, y, z, 0, 0.72, -0.12, 0.52, 0.48, 0.38), ell(x, y, z, 0, 1.17, -0.14, 0.56, 0.42, 0.35), 0.25);
  d = smin(d, t, 0.18);
  for (const s of [-1, 1]) d = smin(d, ell(x, y, z, s * 0.2, 1.22, 0.08, 0.2, 0.15, 0.14), 0.12); // chest
  d = smin(d, ell(x, y, z, 0, 1.45, -0.17, 0.66, 0.16, 0.3), 0.18); // shoulders
  for (const s of [-1, 1]) {
    d = smin(d, ell(x, y, z, s * 0.6, 1.36, -0.15, 0.17, 0.2, 0.18), 0.08); // deltoid
    d = smin(d, cap(x, y, z, s * 0.62, 1.38, -0.16, s * 0.74, 0.88, -0.02, 0.16, 0.13), 0.08);
    d = smin(d, cap(x, y, z, s * 0.74, 0.88, -0.02, s * 0.22, 0.57, 0.3, 0.13, 0.1), 0.08);
  }
  // hands in dhyana mudra: right resting in left, thumbs touching
  d = smin(d, ell(x, y, z, 0, 0.55, 0.34, 0.3, 0.075, 0.17), 0.06);
  d = smin(d, ell(x, y, z, 0, 0.615, 0.36, 0.27, 0.06, 0.15), 0.035);
  d = smin(d, cap(x, y, z, -0.1, 0.685, 0.29, 0.1, 0.685, 0.29, 0.032, 0.032), 0.02);
  // robe over the left shoulder: slightly proud of the skin, with folds parallel to the hem
  const hem = -0.35 + (1.52 - y) * 1.35;
  const robe = Math.max(sstep(hem + 0.03, hem - 0.03, x) * sstep(1.62, 1.5, y), sstep(0.98, 0.9, y));
  if (robe > 0 && y > 0.5) {
    const f = Math.sin((x * 0.6 + y * 0.8) * 30) * sstep(0.03, 0.12, hem - x) * sstep(0.95, 1.05, y);
    d -= robe * 0.02 + 0.007 * f * robe;
  }
  // neck, with the three lines of beauty
  let n = cap(x, y, z, 0, 1.48, -0.15, 0, 1.8, -0.11, 0.17, 0.15);
  for (const yy of [1.66, 1.7]) n = smax(n, -ell(x, y, z, 0, yy, -0.12, 0.2, 0.008, 0.2), 0.015);
  d = smin(d, n, 0.1);
  return d;
}
function lotusSdf(x, y, z) {
  let d = ell(x, y, z, 0, -0.36, 0, 0.92, 0.3, 0.92);
  d = smin(d, petals(x, y, z, 14, 0.82, -0.4, 0.55, 0.5, 0.24, 0.065, 0), 0.04);
  d = smin(d, petals(x, y, z, 14, 0.62, -0.3, 0.32, 0.42, 0.22, 0.06, Math.PI / 14), 0.04);
  d = smin(d, petals(x, y, z, 14, 0.86, -0.44, Math.PI - 0.62, 0.36, 0.24, 0.06, Math.PI / 14), 0.04);
  return d;
}
function sdf(x, y, z) {
  const fig = smin(bodySdf(x, y, z), headSdf(x, y, z), 0.06);
  return smin(fig, lotusSdf(x, y, z), 0.05);
}

// ---------- surface nets ----------
const STEP = 0.012;
const MIN = [-1.32, -0.9, -1.28];
const MAX = [1.32, 2.72, 1.28];
const N = MIN.map((m, i) => Math.ceil((MAX[i] - m) / STEP) + 1);
const [NX, NY, NZ] = N;
console.log('grid', N, NX * NY * NZ);
const F = new Float32Array(NX * NY * NZ);
const at = (i, j, k) => i + NX * (j + NY * k);
for (let k = 0; k < NZ; k++)
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) F[at(i, j, k)] = sdf(MIN[0] + i * STEP, MIN[1] + j * STEP, MIN[2] + k * STEP);
console.log('sampled');

const cellVert = new Int32Array((NX - 1) * (NY - 1) * (NZ - 1)).fill(-1);
const cat = (i, j, k) => i + (NX - 1) * (j + (NY - 1) * k);
const pos = [];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];
const corner = (c) => [c & 1, (c >> 1) & 1, (c >> 2) & 1];
for (let k = 0; k < NZ - 1; k++)
  for (let j = 0; j < NY - 1; j++)
    for (let i = 0; i < NX - 1; i++) {
      const v = [];
      let inside = 0;
      for (let c = 0; c < 8; c++) {
        const [a, b, e] = corner(c);
        v.push(F[at(i + a, j + b, k + e)]);
        if (v[c] < 0) inside++;
      }
      if (inside === 0 || inside === 8) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const [a, b] of EDGES) {
        if (v[a] < 0 === v[b] < 0) continue;
        const t = v[a] / (v[a] - v[b]);
        const ca = corner(a), cb = corner(b);
        sx += ca[0] + (cb[0] - ca[0]) * t;
        sy += ca[1] + (cb[1] - ca[1]) * t;
        sz += ca[2] + (cb[2] - ca[2]) * t;
        cnt++;
      }
      cellVert[cat(i, j, k)] = pos.length / 3;
      pos.push(MIN[0] + (i + sx / cnt) * STEP, MIN[1] + (j + sy / cnt) * STEP, MIN[2] + (k + sz / cnt) * STEP);
    }
const idx = [];
function quad(a, b, c, d) {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  idx.push(a, b, c, a, c, d);
}
for (let k = 1; k < NZ - 1; k++)
  for (let j = 1; j < NY - 1; j++)
    for (let i = 1; i < NX - 1; i++) {
      const f0 = F[at(i, j, k)] < 0;
      if (i < NX - 1 && f0 !== F[at(i + 1, j, k)] < 0)
        quad(cellVert[cat(i, j - 1, k - 1)], cellVert[cat(i, j, k - 1)], cellVert[cat(i, j, k)], cellVert[cat(i, j - 1, k)]);
      if (j < NY - 1 && f0 !== F[at(i, j + 1, k)] < 0)
        quad(cellVert[cat(i - 1, j, k - 1)], cellVert[cat(i, j, k - 1)], cellVert[cat(i, j, k)], cellVert[cat(i - 1, j, k)]);
      if (k < NZ - 1 && f0 !== F[at(i, j, k + 1)] < 0)
        quad(cellVert[cat(i - 1, j - 1, k)], cellVert[cat(i, j - 1, k)], cellVert[cat(i, j, k)], cellVert[cat(i - 1, j, k)]);
    }
console.log('verts', pos.length / 3, 'tris', idx.length / 3);

const E = 1e-3;
const grad = (x, y, z) => {
  const gx = sdf(x + E, y, z) - sdf(x - E, y, z);
  const gy = sdf(x, y + E, z) - sdf(x, y - E, z);
  const gz = sdf(x, y, z + E) - sdf(x, y, z - E);
  const l = hyp(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
};
// pull vertices onto the true surface
const P = new Float32Array(pos);
for (let v = 0; v < P.length; v += 3) {
  for (let it = 0; it < 2; it++) {
    const d = sdf(P[v], P[v + 1], P[v + 2]);
    const g = grad(P[v], P[v + 1], P[v + 2]);
    const s = clamp(d, -STEP * 0.5, STEP * 0.5);
    P[v] -= g[0] * s;
    P[v + 1] -= g[1] * s;
    P[v + 2] -= g[2] * s;
  }
}
// make every triangle face outward
const I = new Uint32Array(idx);
for (let t = 0; t < I.length; t += 3) {
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
  const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const g = grad((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
  if (nx * g[0] + ny * g[1] + nz * g[2] < 0) {
    I[t + 1] = c / 3;
    I[t + 2] = b / 3;
  }
}

await MeshoptSimplifier.ready;
const TARGET = 58000 * 3;
const [SI, err] = MeshoptSimplifier.simplify(I, P, 3, TARGET, 0.002, []);
console.log('simplified tris', SI.length / 3, 'err', err);

// compact
const remap = new Int32Array(P.length / 3).fill(-1);
const outP = [];
const outI = new Uint16Array(SI.length);
let nv = 0;
for (let t = 0; t < SI.length; t++) {
  const o = SI[t];
  if (remap[o] < 0) {
    remap[o] = nv++;
    outP.push(P[o * 3], P[o * 3 + 1], P[o * 3 + 2]);
  }
  outI[t] = remap[o];
}
if (nv > 65535) throw new Error('too many verts ' + nv);
const nrm = new Int8Array(nv * 3);
const col = new Uint8Array(nv * 3);
const GOLD = [0.86, 0.66, 0.3];
const HAIR = [0.13, 0.18, 0.36];
const LIP = [0.72, 0.36, 0.22];
for (let v = 0; v < nv; v++) {
  const x = outP[v * 3], y = outP[v * 3 + 1], z = outP[v * 3 + 2];
  const g = grad(x, y, z);
  nrm.set([Math.round(g[0] * 127), Math.round(g[1] * 127), Math.round(g[2] * 127)], v * 3);
  // ambient occlusion from the distance field
  let occ = 0;
  for (let s = 1; s <= 5; s++) {
    const h = s * 0.045;
    occ += (h - Math.max(0, sdf(x + g[0] * h, y + g[1] * h, z + g[2] * h))) / (1 << s);
  }
  const ao = clamp(1 - 2.6 * occ, 0.25, 1);
  const nearHead = headSdf(x, y, z) < 0.02 ? 1 : 0;
  const hair = nearHead * hairGate(x, y, z);
  const lip = nearHead * sstep(0.03, 0.0, Math.abs(y - 1.862) * 0.8 + Math.abs(x) * 0.3) * (z > 0.17 ? 1 : 0);
  for (let c = 0; c < 3; c++) {
    let k = GOLD[c] * (1 - hair) + HAIR[c] * hair;
    k = k * (1 - lip) + LIP[c] * lip;
    col[v * 3 + c] = Math.round(clamp(k * ao, 0, 1) * 255);
  }
}
// layout: u32 nv, u32 ni, f32 pos[nv*3], i8 nrm[nv*3] (padded to 4), u8 col[nv*3] (padded to 4), u16 idx[ni]
const pad4 = (n) => (n + 3) & ~3;
const size = 8 + nv * 12 + pad4(nv * 3) * 2 + outI.length * 2;
const buf = new ArrayBuffer(size);
const dv = new DataView(buf);
dv.setUint32(0, nv, true);
dv.setUint32(4, outI.length, true);
let off = 8;
new Float32Array(buf, off, nv * 3).set(outP);
off += nv * 12;
new Int8Array(buf, off, nv * 3).set(nrm);
off += pad4(nv * 3);
new Uint8Array(buf, off, nv * 3).set(col);
off += pad4(nv * 3);
new Uint16Array(buf, off, outI.length).set(outI);
fs.writeFileSync(new URL('../public/buddha.bin', import.meta.url), new Uint8Array(buf));
console.log('wrote public/buddha.bin', nv, 'verts', outI.length / 3, 'tris', (size / 1024).toFixed(0) + 'KB');
