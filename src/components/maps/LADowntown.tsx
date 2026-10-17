import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DT, FIRMS, FIRM_IN, IB_SPOTS, Firm, Npc, firmXZ, firmAt, liftCar, marketPx, marketT, MARKET_SYMS, LA, mapRuntime, laHeight } from '../../maps';
import { ibTask } from '../../banker';

// 洛城午后 downtown, the part you can walk into: the footbridge over the freeway, the plaza, and inside the four
// finance houses: glass lobbies, trading floors full of people in suits on the phone, the banking floor with its
// boardroom, the lifts, and the market on the walls (red and green, live).

// ---------------------------------------------------------------
// geometry helpers: boxes with a colour, merged with all their attributes
// ---------------------------------------------------------------
type G = THREE.BufferGeometry;
function paint(g: G, color: string | THREE.Color, extra?: Record<string, number[]>) {
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.attributes.position.count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (extra)
    for (const [k, v] of Object.entries(extra)) {
      const a = new Float32Array(n * v.length);
      for (let i = 0; i < n; i++) a.set(v, i * v.length);
      ng.setAttribute(k, new THREE.BufferAttribute(a, v.length));
    }
  return ng;
}
function merge(geos: G[]): G {
  const out = new THREE.BufferGeometry();
  if (!geos.length) return out;
  const names = Object.keys(geos[0].attributes);
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  for (const name of names) {
    const size = geos[0].attributes[name].itemSize;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of geos) {
      const a = g.attributes[name];
      if (a) arr.set(a.array as Float32Array, o * size);
      o += g.attributes.position.count;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number) => new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
/** a box in a firm's own frame (u across, v toward the avenue), centre (u, y, v) */
const fbox = (F: Firm, u: number, y: number, v: number, su: number, sy: number, sv: number) => {
  const [x, z] = firmXZ(F, u, v);
  return box(x, y, z, su, sy, sv);
};
/** a plane facing world direction (nx, nz), centred at (x, y, z) */
function facing(w: number, h: number, x: number, y: number, z: number, nx: number, nz: number) {
  return new THREE.PlaneGeometry(w, h).rotateY(Math.atan2(nx, nz)).translate(x, y, z);
}
/** a bar from a to b */
function limb(a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.BoxGeometry(t, d.length(), t);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------
// the footbridge: a steel tied arch over the freeway, glass balustrades, lamps
// ---------------------------------------------------------------
function Bridge() {
  const geos = useMemo(() => {
    const B = DT.bridge;
    const W = LA.fwy;
    const x0 = 146;
    const x1 = DT.wallX + 0.6;
    const deck: G[] = [];
    const steel: G[] = [];
    deck.push(box((x0 + x1) / 2, DT.y - 0.3 + 0.03, B.z, x1 - x0, 0.6, B.half * 2 + 0.6));
    // the edge beams
    for (const s of [-1, 1]) deck.push(box((x0 + x1) / 2, DT.y - 0.75, B.z + s * (B.half + 0.15), x1 - x0, 0.9, 0.3));
    // piers on the shoulders, down to the freeway (and the slope)
    for (const x of [W.x0 - 3.5, W.x1 + 0.4]) for (const s of [-1, 1]) deck.push(box(x, (W.y + DT.y - 1.2) / 2, B.z + s * (B.half - 0.6), 1.0, DT.y - 1.2 - W.y, 1.0));
    // the arches: one each side, springing from the piers
    const a0 = W.x0 - 3.5;
    const a1 = W.x1 + 0.4;
    const N = 24;
    for (const s of [-1, 1]) {
      const z = B.z + s * (B.half + 0.35);
      let prev = V(a0, DT.y - 0.3, z);
      for (let k = 1; k <= N; k++) {
        const t = k / N;
        const p = V(a0 + (a1 - a0) * t, DT.y - 0.3 + Math.sin(Math.PI * t) * 9, z);
        steel.push(limb(prev, p, 0.45));
        // hangers down to the deck edge
        if (k < N && k % 2 === 0) steel.push(limb(p, V(p.x, DT.y - 0.3, z), 0.06));
        prev = p;
      }
    }
    // handrails and posts
    for (const s of [-1, 1]) {
      const z = B.z + s * (B.half + 0.02);
      steel.push(box((x0 + x1) / 2, DT.y + 1.1, z, x1 - x0, 0.07, 0.07));
      for (let x = x0; x <= x1; x += 2.5) steel.push(box(x, DT.y + 0.55, z, 0.07, 1.1, 0.07));
      // lamps
      for (let x = x0 + 6; x < x1; x += 16) {
        steel.push(box(x, DT.y + 2.0, z + s * 0.1, 0.1, 4.0, 0.1));
        steel.push(box(x, DT.y + 4.05, z - s * 0.25, 0.25, 0.12, 0.7));
      }
    }
    const glass: G[] = [];
    for (const s of [-1, 1]) glass.push(box((x0 + x1) / 2, DT.y + 0.55, B.z + s * (B.half + 0.02), x1 - x0, 1.05, 0.03));
    return { deck: merge(deck.map((g) => paint(g, '#c9c3b8'))), steel: merge(steel.map((g) => paint(g, '#e8e8e4'))), glass: merge(glass.map((g) => paint(g, '#ffffff'))) };
  }, []);
  return (
    <group>
      <mesh geometry={geos.deck} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.85} />
      </mesh>
      <mesh geometry={geos.steel} castShadow>
        <meshStandardMaterial vertexColors roughness={0.35} metalness={0.7} />
      </mesh>
      <mesh geometry={geos.glass}>
        <meshStandardMaterial color="#cfe6ef" transparent opacity={0.28} roughness={0.05} metalness={0.2} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------
// the plaza: the fountain, planters with hedges round the edge, lamp posts, benches
// ---------------------------------------------------------------
function Plaza() {
  const geos = useMemo(() => {
    const R = DT.rect;
    const stone: G[] = [];
    const hedge: G[] = [];
    const metal: G[] = [];
    // planters along the plaza's edges (the bridge comes in through a gap in the west one)
    const run = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      stone.push(box((x0 + x1) / 2, DT.y + 0.35, (z0 + z1) / 2, alongX ? len : 1.4, 0.7, alongX ? 1.4 : len));
      hedge.push(box((x0 + x1) / 2, DT.y + 0.95, (z0 + z1) / 2, alongX ? len - 0.3 : 1.1, 0.6, alongX ? 1.1 : len - 0.3));
    };
    run(R.x0 + 0.8, R.z0 - 0.8, R.x1 + 0.8, R.z0 - 0.8);
    run(R.x0 + 0.8, R.z1 + 0.8, R.x1 + 0.8, R.z1 + 0.8);
    run(R.x1 + 0.8, R.z0 - 0.8, R.x1 + 0.8, R.z1 + 0.8);
    run(R.x0 - 0.2, R.z0 - 0.8, R.x0 - 0.2, DT.bridge.z - DT.bridge.half - 0.2);
    run(R.x0 - 0.2, DT.bridge.z + DT.bridge.half + 0.2, R.x0 - 0.2, R.z1 + 0.8);
    // the fountain: a round basin, a tiered bowl
    const [fx, fz] = DT.fountain;
    stone.push(new THREE.CylinderGeometry(4.2, 4.3, 0.7, 48).translate(fx, DT.y + 0.35, fz));
    stone.push(new THREE.CylinderGeometry(0.5, 0.7, 2.2, 16).translate(fx, DT.y + 1.1, fz));
    stone.push(new THREE.CylinderGeometry(1.8, 0.6, 0.35, 32).translate(fx, DT.y + 2.2, fz));
    stone.push(new THREE.CylinderGeometry(0.25, 0.3, 1.0, 12).translate(fx, DT.y + 2.8, fz));
    // lamp posts and benches along the avenue
    for (let x = 230; x < 334; x += 13) {
      if (Math.abs(x - fx) < 6) continue;
      for (const s of [-1, 1]) {
        metal.push(box(x, DT.y + 2.6, s * 11.5, 0.14, 5.2, 0.14));
        metal.push(box(x, DT.y + 5.2, s * 11.2, 0.5, 0.18, 0.9));
        stone.push(box(x + 5, DT.y + 0.25, s * 11.8, 2.2, 0.12, 0.6));
        stone.push(box(x + 5, DT.y + 0.12, s * 11.8, 0.3, 0.25, 0.5));
      }
    }
    return {
      stone: merge(stone.map((g) => paint(g, '#cdc6b8'))),
      hedge: merge(hedge.map((g) => paint(g, '#3f5a26'))),
      metal: merge(metal.map((g) => paint(g, '#2c2f33'))),
    };
  }, []);
  const water = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (water.current) water.current.position.y = DT.y + 0.6 + Math.sin(st.clock.elapsedTime * 2) * 0.01;
  });
  const [fx, fz] = DT.fountain;
  return (
    <group>
      <mesh geometry={geos.stone} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.8} />
      </mesh>
      <mesh geometry={geos.hedge} castShadow>
        <meshStandardMaterial vertexColors roughness={0.95} />
      </mesh>
      <mesh geometry={geos.metal}>
        <meshStandardMaterial vertexColors roughness={0.4} metalness={0.6} />
      </mesh>
      <mesh ref={water} position={[fx, DT.y + 0.6, fz]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[3.95, 48]} />
        <meshStandardMaterial color="#3d6f7c" roughness={0.05} metalness={0.3} />
      </mesh>
      <mesh position={[fx, DT.y + 2.4, fz]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.7, 32]} />
        <meshStandardMaterial color="#5b8f9a" roughness={0.05} />
      </mesh>
      {/* the jet */}
      <mesh position={[fx, DT.y + 4.0, fz]}>
        <cylinderGeometry args={[0.06, 0.18, 2.6, 8, 1, true]} />
        <meshStandardMaterial color="#e6f4f8" transparent opacity={0.55} emissive="#9fc8d4" emissiveIntensity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------
// the market on the walls: an index line (green going up, red coming down) with its volatility, the
// MSFT candles the Citadel desk trades, a board of 2000's big names, the ticker crawl
// ---------------------------------------------------------------
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function drawChart(g: CanvasRenderingContext2D, t: number) {
  const W = 1024;
  const H = 512;
  g.fillStyle = '#04070b';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#13301f';
  g.lineWidth = 1;
  for (let x = 0; x < W; x += 64) {
    g.beginPath();
    g.moveTo(x, 70);
    g.lineTo(x, H);
    g.stroke();
  }
  for (let y = 70; y < H; y += 48) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  const N = 180;
  const span = 150;
  const px: number[] = [];
  for (let k = 0; k < N; k++) px.push(marketPx(0, t - span + (k / (N - 1)) * span, MARKET_SYMS[0].base));
  const lo = Math.min(...px);
  const hi = Math.max(...px);
  const Y = (p: number) => 90 + (1 - (p - lo) / Math.max(1e-6, hi - lo)) * 270;
  g.lineWidth = 4;
  for (let k = 1; k < N; k++) {
    g.strokeStyle = px[k] >= px[k - 1] ? '#2ee26b' : '#ff3b3b';
    g.beginPath();
    g.moveTo(((k - 1) / (N - 1)) * W, Y(px[k - 1]));
    g.lineTo((k / (N - 1)) * W, Y(px[k]));
    g.stroke();
  }
  // volatility: the size of recent moves
  g.lineWidth = 3;
  g.strokeStyle = '#ffb000';
  g.beginPath();
  for (let k = 6; k < N; k++) {
    let s = 0;
    for (let j = k - 5; j <= k; j++) s += Math.abs(Math.log(px[j] / px[j - 1]));
    const y = H - 20 - Math.min(110, s * 9000);
    if (k === 6) g.moveTo((k / (N - 1)) * W, y);
    else g.lineTo((k / (N - 1)) * W, y);
  }
  g.stroke();
  const last = px[N - 1];
  const chg = last / px[0] - 1;
  g.fillStyle = '#e8e8e8';
  g.font = 'bold 44px Arial, Helvetica, sans-serif';
  g.textBaseline = 'top';
  g.fillText('NASDAQ COMPOSITE', 22, 14);
  g.fillStyle = chg >= 0 ? '#2ee26b' : '#ff3b3b';
  g.textAlign = 'right';
  g.fillText(`${fmt(last)}  ${chg >= 0 ? '▲' : '▼'} ${(chg * 100).toFixed(2)}%`, W - 22, 14);
  g.textAlign = 'left';
  g.fillStyle = '#ffb000';
  g.font = 'bold 26px Arial, Helvetica, sans-serif';
  g.fillText('VOLATILITY', 22, H - 150);
}
function drawCandles(g: CanvasRenderingContext2D, t: number) {
  const W = 1024;
  const H = 512;
  g.fillStyle = '#05080c';
  g.fillRect(0, 0, W, H);
  const N = 40;
  const step = 2.5;
  const bars: [number, number, number, number][] = [];
  for (let k = 0; k < N; k++) {
    const t0 = Math.floor(t / step) * step - (N - 1 - k) * step;
    const vals: number[] = [];
    for (let j = 0; j <= 5; j++) vals.push(marketPx(3, Math.min(t, t0 + (j / 5) * step), 116));
    bars.push([vals[0], Math.max(...vals), Math.min(...vals), vals[5]]);
  }
  const lo = Math.min(...bars.map((b) => b[2]));
  const hi = Math.max(...bars.map((b) => b[1]));
  const Y = (p: number) => 80 + (1 - (p - lo) / Math.max(1e-6, hi - lo)) * (H - 120);
  const bw = W / N;
  bars.forEach(([o, h, l, c], k) => {
    const up = c >= o;
    g.strokeStyle = g.fillStyle = up ? '#2ee26b' : '#ff3b3b';
    g.lineWidth = 2;
    const x = k * bw + bw / 2;
    g.beginPath();
    g.moveTo(x, Y(h));
    g.lineTo(x, Y(l));
    g.stroke();
    const y0 = Y(Math.max(o, c));
    g.fillRect(x - bw * 0.32, y0, bw * 0.64, Math.max(2, Y(Math.min(o, c)) - y0));
  });
  const last = bars[N - 1][3];
  const chg = last / bars[0][0] - 1;
  g.textBaseline = 'top';
  g.font = 'bold 44px Arial, Helvetica, sans-serif';
  g.fillStyle = '#e8e8e8';
  g.fillText('MSFT', 22, 14);
  g.textAlign = 'right';
  g.fillStyle = chg >= 0 ? '#2ee26b' : '#ff3b3b';
  g.fillText(`${fmt(last)}  ${chg >= 0 ? '+' : ''}${(chg * 100).toFixed(2)}%`, W - 22, 14);
  g.textAlign = 'left';
}
function drawBoard(g: CanvasRenderingContext2D, t: number) {
  const W = 1024;
  const H = 512;
  g.fillStyle = '#020305';
  g.fillRect(0, 0, W, H);
  g.font = 'bold 36px "Courier New", monospace';
  g.textBaseline = 'middle';
  MARKET_SYMS.forEach((m, k) => {
    const col = k % 2;
    const row = Math.floor(k / 2);
    const x = 24 + col * 512;
    const y = 40 + row * 80;
    const p = marketPx(k, t, m.base);
    const p0 = marketPx(k, t - 60, m.base);
    const ch = p / p0 - 1;
    g.fillStyle = '#ffb000';
    g.textAlign = 'left';
    g.fillText(m.s, x, y);
    g.fillStyle = ch >= 0 ? '#2ee26b' : '#ff3b3b';
    g.textAlign = 'right';
    g.fillText(`${fmt(p)} ${ch >= 0 ? '▲' : '▼'}${Math.abs(ch * 100).toFixed(1)}%`, x + 480, y);
  });
  g.textAlign = 'left';
}
function drawTicker(g: CanvasRenderingContext2D, t: number) {
  const W = 2048;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, 64);
  g.font = 'bold 40px Arial, Helvetica, sans-serif';
  g.textBaseline = 'middle';
  let x = 10;
  for (let k = 0; k < MARKET_SYMS.length && x < W; k++) {
    const m = MARKET_SYMS[k];
    const p = marketPx(k, t, m.base);
    const ch = p / marketPx(k, t - 60, m.base) - 1;
    g.fillStyle = '#ffffff';
    g.fillText(m.s, x, 34);
    x += g.measureText(m.s).width + 14;
    const s = `${fmt(p)} ${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch * 100).toFixed(2)}%`;
    g.fillStyle = ch >= 0 ? '#2ee26b' : '#ff3b3b';
    g.fillText(s, x, 34);
    x += g.measureText(s).width + 44;
  }
}
function useMarket() {
  return useMemo(() => {
    const mk = (w: number, h: number, draw: (g: CanvasRenderingContext2D, t: number) => void) => {
      const tex = canvasTex(w, h, (g) => draw(g, marketT()));
      return { tex, draw: () => draw((tex.image as HTMLCanvasElement).getContext('2d')!, marketT()) };
    };
    const chart = mk(1024, 512, drawChart);
    const candles = mk(1024, 512, drawCandles);
    const board = mk(1024, 512, drawBoard);
    const ticker = mk(2048, 64, drawTicker);
    ticker.tex.wrapS = THREE.RepeatWrapping;
    return { chart, candles, board, ticker };
  }, []);
}

// ---------------------------------------------------------------
// the people: suits, shirts and ties, on the phone, at their screens, shouting
// ---------------------------------------------------------------
const SUITS = ['#1d2738', '#2a2b2e', '#151618', '#44484e', '#6c7078'];
const SKINS = ['#efd0b4', '#e2b896', '#c99472', '#9a6a48', '#6e4a32'];
const TIES = ['#8a1c24', '#1f3f8a', '#6b5a1e', '#3b3b3b', '#7a2e64'];
type Part = 'suit' | 'skin' | 'shirt' | 'tie' | 'hair' | 'shoe' | 'phone';
const PART_COL: Record<Part, string> = { suit: '#ffffff', skin: '#ffffff', shirt: '#f1f1ec', tie: '#ffffff', hair: '#1c1612', shoe: '#0e0e0e', phone: '#0b0b0b' };
function person(kind: 'stand' | 'wave' | 'sit' | 'sitPhone') {
  const parts: G[] = [];
  const add = (g: G, p: Part, arm = 0, pivot = [0, 0, 0]) =>
    parts.push(paint(g, PART_COL[p], { aP: [p === 'suit' ? 1 : 0, p === 'skin' ? 1 : 0, p === 'tie' ? 1 : 0, arm], aPivot: pivot }));
  const sit = kind === 'sit' || kind === 'sitPhone';
  const hip = sit ? 0.5 : 0.92;
  // legs
  for (const s of [-1, 1]) {
    if (sit) {
      add(limb(V(s * 0.1, hip, -0.02), V(s * 0.1, hip, 0.42), 0.16), 'suit');
      add(limb(V(s * 0.1, hip, 0.42), V(s * 0.1, 0.06, 0.45), 0.14), 'suit');
      add(box(s * 0.1, 0.04, 0.5, 0.11, 0.08, 0.26), 'shoe');
    } else {
      add(limb(V(s * 0.1, hip, 0), V(s * 0.1, 0.08, 0.0), 0.15), 'suit');
      add(box(s * 0.1, 0.04, 0.05, 0.11, 0.08, 0.27), 'shoe');
    }
  }
  const sh = hip + 0.55; // shoulders
  // the jacket, the shirt's V, the tie
  add(box(0, hip + 0.29, 0, 0.42, 0.6, 0.23), 'suit');
  add(box(0, sh - 0.05, 0, 0.5, 0.12, 0.24), 'suit');
  add(box(0, sh - 0.12, 0.118, 0.13, 0.22, 0.01), 'shirt');
  add(box(0, sh - 0.2, 0.126, 0.05, 0.3, 0.01), 'tie');
  // neck and head, hair
  add(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 8).translate(0, sh + 0.06, 0), 'skin');
  add(new THREE.SphereGeometry(0.115, 12, 10).scale(0.92, 1.08, 1).translate(0, sh + 0.22, 0.01), 'skin');
  add(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 0.9, 1.02).translate(0, sh + 0.25, -0.005), 'hair');
  // arms
  const L = V(-0.27, sh - 0.02, 0);
  const R = V(0.27, sh - 0.02, 0);
  const piv = (p: THREE.Vector3) => [p.x, p.y, p.z];
  if (sit) {
    const el = V(-0.28, sh - 0.26, 0.18);
    const hd = V(-0.18, sh - 0.3, 0.42);
    add(limb(L, el, 0.1), 'suit', 0.05, piv(L));
    add(limb(el, hd, 0.09), 'suit', 0.05, piv(L));
    add(new THREE.SphereGeometry(0.05, 6, 5).translate(hd.x, hd.y, hd.z), 'skin', 0.05, piv(L));
  } else {
    const hd = V(-0.3, sh - 0.6, 0.02);
    add(limb(L, hd, 0.1), 'suit', 0.06, piv(L));
    add(new THREE.SphereGeometry(0.05, 6, 5).translate(hd.x, hd.y, hd.z), 'skin', 0.06, piv(L));
  }
  if (kind === 'wave') {
    // the right arm up, fist pumping, phone in the other hand at the ear
    const el = V(0.36, sh + 0.25, 0.06);
    const hd = V(0.34, sh + 0.55, 0.12);
    add(limb(R, el, 0.1), 'suit', 0.5, piv(R));
    add(limb(el, hd, 0.09), 'suit', 0.5, piv(R));
    add(new THREE.SphereGeometry(0.055, 6, 5).translate(hd.x, hd.y, hd.z), 'skin', 0.5, piv(R));
  } else if (kind === 'sit') {
    const el = V(0.28, sh - 0.26, 0.18);
    const hd = V(0.18, sh - 0.3, 0.42);
    add(limb(R, el, 0.1), 'suit', 0.05, piv(R));
    add(limb(el, hd, 0.09), 'suit', 0.05, piv(R));
    add(new THREE.SphereGeometry(0.05, 6, 5).translate(hd.x, hd.y, hd.z), 'skin', 0.05, piv(R));
  } else {
    // on the phone: elbow out and down, hand at the ear
    const el = V(0.33, sh - 0.24, 0.12);
    const hd = V(0.13, sh + 0.17, 0.04);
    add(limb(R, el, 0.1), 'suit', 0.07, piv(R));
    add(limb(el, hd, 0.09), 'suit', 0.07, piv(R));
    add(new THREE.SphereGeometry(0.05, 6, 5).translate(hd.x, hd.y, hd.z), 'skin', 0.07, piv(R));
    add(box(hd.x - 0.02, hd.y + 0.02, hd.z + 0.03, 0.04, 0.16, 0.06), 'phone', 0.07, piv(R));
  }
  const g = merge(parts);
  g.deleteAttribute('uv');
  return g;
}
const NPC_T = { value: 0 };
function personMat(sway: number) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uT = NPC_T;
    s.uniforms.uSway = { value: sway };
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aP; attribute vec3 aPivot; attribute vec3 iSuit; attribute vec3 iSkin; attribute vec3 iTie; uniform float uT; uniform float uSway;'
      )
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.xyz *= mix(vec3(1.0), iSuit, aP.x) * mix(vec3(1.0), iSkin, aP.y) * mix(vec3(1.0), iTie, aP.z);')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float ph = float(gl_InstanceID) * 1.731;
        float aArm = aP.w;
        if (aArm != 0.0) {
          vec3 q = transformed - aPivot;
          float a = aArm * sin(uT * (aArm > 0.2 ? 5.5 : 1.4) + ph);
          float ca = cos(a); float sa = sin(a);
          q = vec3(q.x, q.y * ca - q.z * sa, q.y * sa + q.z * ca);
          transformed = aPivot + q;
        }
        float sw = uSway * sin(uT * 0.45 + ph * 2.3);
        float cs = cos(sw); float ss = sin(sw);
        transformed.xz = vec2(transformed.x * cs + transformed.z * ss, -transformed.x * ss + transformed.z * cs);`
      );
  };
  return m;
}
function People({ list }: { list: Npc[] }) {
  const meshes = useMemo(() => {
    const kinds = ['stand', 'sit', 'wave', 'sitPhone'] as const;
    const groups: Npc[][] = [[], [], [], []];
    list.forEach((n, k) => {
      if (n.pose === 1) groups[k % 3 === 0 ? 3 : 1].push(n);
      else groups[n.pose === 2 ? 2 : 0].push(n);
    });
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    return kinds
      .map((kind, gi) => {
        const L = groups[gi];
        if (!L.length) return null;
        const geo = person(kind);
        const suit = new Float32Array(L.length * 3);
        const skin = new Float32Array(L.length * 3);
        const tie = new Float32Array(L.length * 3);
        L.forEach((n, k) => {
          c.set(SUITS[n.suit % SUITS.length]).toArray(suit, k * 3);
          c.set(SKINS[(k * 7 + n.suit) % SKINS.length]).toArray(skin, k * 3);
          c.set(TIES[(k * 3 + n.suit * 2) % TIES.length]).toArray(tie, k * 3);
        });
        geo.setAttribute('iSuit', new THREE.InstancedBufferAttribute(suit, 3));
        geo.setAttribute('iSkin', new THREE.InstancedBufferAttribute(skin, 3));
        geo.setAttribute('iTie', new THREE.InstancedBufferAttribute(tie, 3));
        const im = new THREE.InstancedMesh(geo, personMat(kind === 'sit' || kind === 'sitPhone' ? 0.08 : 0.35), L.length);
        L.forEach((n, k) => {
          o.position.set(n.x, n.y, n.z);
          o.rotation.set(0, n.yaw, 0);
          o.updateMatrix();
          im.setMatrixAt(k, o.matrix);
        });
        im.frustumCulled = false;
        return im;
      })
      .filter(Boolean) as THREE.InstancedMesh[];
  }, [list]);
  return (
    <group>
      {meshes.map((m, k) => (
        <primitive key={k} object={m} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// the towers' insides
// ---------------------------------------------------------------
function screenMat() {
  // terminal screens: black, amber text, a little chart line in green or red
  return new THREE.ShaderMaterial({
    uniforms: { uT: NPC_T },
    vertexShader: /* glsl */ `attribute float aSeed; varying vec2 vUv; varying float vS; void main(){ vUv = uv; vS = aSeed; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uT; varying vec2 vUv; varying float vS;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n1(float x){ float i = floor(x); float f = fract(x); return mix(h(vec2(i, vS)), h(vec2(i + 1.0, vS)), f * f * (3.0 - 2.0 * f)); }
      void main(){
        vec2 uv = vUv;
        vec3 col = vec3(0.01, 0.015, 0.03);
        float tick = floor(uT * 0.7 + vS * 10.0);
        if (vS > 0.5) {
          // a chart: price line
          float x = uv.x * 6.0 + tick * 0.15 + vS * 40.0;
          float y = 0.2 + 0.6 * n1(x);
          float dy = n1(x + 0.02) - n1(x);
          float line = 1.0 - smoothstep(0.0, 0.035, abs(uv.y - y));
          col += line * (dy >= 0.0 ? vec3(0.1, 0.85, 0.3) : vec3(0.95, 0.15, 0.12));
          col += step(0.88, uv.y) * vec3(0.5, 0.3, 0.0);
        } else {
          // rows of quotes
          vec2 c = vec2(floor(uv.x * 4.0), floor(uv.y * 12.0));
          vec2 f = vec2(fract(uv.x * 4.0), fract(uv.y * 12.0));
          float on = step(0.2, f.y) * step(f.y, 0.75) * step(0.06, f.x) * step(f.x, 0.06 + 0.8 * h(c + vS));
          float r = h(c + tick + vS * 3.0);
          vec3 tc = c.x < 0.5 ? vec3(1.0, 0.65, 0.0) : (r > 0.5 ? vec3(0.15, 0.85, 0.35) : vec3(0.95, 0.2, 0.15));
          col += on * tc * 0.8;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
function nameTex(name: string, color: string) {
  return canvasTex(1024, 160, (g) => {
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let size = 110;
    g.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
    while (g.measureText(name).width > 980 && size > 40) g.font = `bold ${(size -= 4)}px Georgia, serif`;
    g.fillText(name, 512, 84);
  });
}
const arrowTex = (up: boolean) =>
  canvasTex(256, 128, (g) => {
    g.fillStyle = '#0b0b0b';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = up ? '#4ade80' : '#fbbf24';
    g.font = 'bold 64px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(up ? '▲ UP' : '▼ DOWN', 128, 66);
  });
function ceilingTex() {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = '#d9d8d2';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = '#b8b7b0';
    g.lineWidth = 3;
    for (let k = 0; k <= 4; k++) {
      g.beginPath();
      g.moveTo(k * 64, 0);
      g.lineTo(k * 64, 256);
      g.moveTo(0, k * 64);
      g.lineTo(256, k * 64);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(70, 8, 116, 48);
    g.fillRect(70, 136, 116, 48);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(9, 9);
  return t;
}

function Interiors({ market }: { market: ReturnType<typeof useMarket> }) {
  const built = useMemo(() => {
    const C = { hu: 5, hv: 4, alcove: 1.6, deep: 2.6 };
    const lobby = { stone: [] as G[], steel: [] as G[], glass: [] as G[], marble: [] as G[], ceil: [] as G[], plant: [] as G[] };
    const up = { carpet: [] as G[], ceil: [] as G[], steel: [] as G[], wood: [] as G[], dark: [] as G[], screen: [] as G[], glass: [] as G[], white: [] as G[] };
    const signs: { tex: THREE.Texture; w: number; h: number; x: number; y: number; z: number; nx: number; nz: number }[] = [];
    const walls: { tex: 'chart' | 'candles' | 'board' | 'ticker'; w: number; h: number; x: number; y: number; z: number; nx: number; nz: number }[] = [];
    const arrows: { up: boolean; x: number; y: number; z: number; nx: number; nz: number }[] = [];
    const seed = () => Math.random();
    FIRMS.forEach((F, fi) => {
      const hw = F.w / 2;
      const hd = F.d / 2;
      const IW = F.w - 0.8;
      const ID = F.d - 0.8;
      const s = F.s;
      const coreTop = DT.levels[2] + DT.floorH;
      // the core: two blocks either side of the lift alcove and one behind it, all the way up
      lobby.stone.push(paint(fbox(F, -(C.hu + C.alcove) / 2, coreTop / 2, 0, C.hu - C.alcove, coreTop, C.hv * 2), F.id === 'ms' ? '#3b2b24' : '#34312e'));
      lobby.stone.push(paint(fbox(F, (C.hu + C.alcove) / 2, coreTop / 2, 0, C.hu - C.alcove, coreTop, C.hv * 2), F.id === 'ms' ? '#3b2b24' : '#34312e'));
      lobby.stone.push(paint(fbox(F, 0, coreTop / 2, (C.hv - C.deep - C.hv) / 2, C.alcove * 2, coreTop, C.hv * 2 - C.deep), F.id === 'ms' ? '#3b2b24' : '#34312e'));
      // ---------------- the lobby
      lobby.marble.push(paint(fbox(F, 0, DT.y - 0.02, 0, IW, 0.08, ID), '#ffffff'));
      lobby.ceil.push(paint(fbox(F, 0, DT.lobbyH + 0.15, 0, IW, 0.3, ID), '#ffffff'));
      // glass walls with the door gap, mullions
      const door = 3.2;
      lobby.glass.push(paint(fbox(F, 0, DT.lobbyH / 2, -hd + 0.2, F.w, DT.lobbyH, 0.05), '#ffffff'));
      lobby.glass.push(paint(fbox(F, -hw + 0.2, DT.lobbyH / 2, 0, 0.05, DT.lobbyH, F.d), '#ffffff'));
      lobby.glass.push(paint(fbox(F, hw - 0.2, DT.lobbyH / 2, 0, 0.05, DT.lobbyH, F.d), '#ffffff'));
      lobby.glass.push(paint(fbox(F, (-hw - door) / 2, DT.lobbyH / 2, hd - 0.2, hw - door, DT.lobbyH, 0.05), '#ffffff'));
      lobby.glass.push(paint(fbox(F, (hw + door) / 2, DT.lobbyH / 2, hd - 0.2, hw - door, DT.lobbyH, 0.05), '#ffffff'));
      lobby.glass.push(paint(fbox(F, 0, DT.lobbyH - 1.3, hd - 0.2, door * 2, 2.6, 0.05), '#ffffff'));
      for (let u = -hw; u <= hw + 0.01; u += F.w / 12) {
        lobby.steel.push(paint(fbox(F, u, DT.lobbyH / 2, hd - 0.2, 0.16, DT.lobbyH, 0.16), '#2e3236'));
        lobby.steel.push(paint(fbox(F, u, DT.lobbyH / 2, -hd + 0.2, 0.16, DT.lobbyH, 0.16), '#2e3236'));
      }
      for (let v = -hd; v <= hd + 0.01; v += F.d / 12)
        for (const su of [-1, 1]) lobby.steel.push(paint(fbox(F, su * (hw - 0.2), DT.lobbyH / 2, v, 0.16, DT.lobbyH, 0.16), '#2e3236'));
      for (const y of [DT.lobbyH - 2.6, DT.lobbyH - 0.1]) {
        lobby.steel.push(paint(fbox(F, 0, y, hd - 0.2, F.w, 0.14, 0.16), '#2e3236'));
        lobby.steel.push(paint(fbox(F, 0, y, -hd + 0.2, F.w, 0.14, 0.16), '#2e3236'));
        for (const su of [-1, 1]) lobby.steel.push(paint(fbox(F, su * (hw - 0.2), y, 0, 0.16, 0.14, F.d), '#2e3236'));
      }
      // the canopy over the door
      lobby.steel.push(paint(fbox(F, 0, 4.6, hd + 1.6, 9, 0.25, 3.4), '#3a3d42'));
      // the front desk, turnstiles, planters
      lobby.stone.push(paint(fbox(F, 0, 0.55, C.hv + 3.6, 6.4, 1.1, 1.2), '#d8d2c6'));
      lobby.steel.push(paint(fbox(F, 0, 1.12, C.hv + 3.6, 6.6, 0.05, 1.35), F.accent));
      for (const su of [-1, 1]) for (let k = 0; k < 3; k++) lobby.steel.push(paint(fbox(F, su * (2.12 + k * 1.3), 0.5, C.hv + 7.7, 0.25, 1.0, 1.4), '#b9bcc0'));
      for (const [pu, pv] of [[-hw + 2, hd - 2], [hw - 2, hd - 2], [-hw + 2, -hd + 2], [hw - 2, -hd + 2]]) {
        lobby.stone.push(paint(fbox(F, pu, 0.4, pv, 1.2, 0.8, 1.2), '#2b2b2b'));
        const [px, pz] = firmXZ(F, pu, pv);
        lobby.plant.push(paint(new THREE.IcosahedronGeometry(0.9, 1).scale(1, 1.4, 1).translate(px, 1.9, pz), '#2f5a24'));
      }
      // lift doors on every floor, the up / down signs over them
      for (const L of DT.levels) {
        for (const upCar of [true, false]) {
          const [x, z] = liftCar(F, upCar);
          const zb = F.z + s * (C.hv - C.deep + 0.03);
          lobby.steel.push(paint(box(x, L + 1.3, zb, 1.4, 2.6, 0.06), '#c9ccd0'));
          lobby.steel.push(paint(box(x, L + 1.3, zb + s * 0.02, 0.02, 2.6, 0.04), '#5a5d62'));
          arrows.push({ up: upCar, x, y: L + 2.95, z: zb + s * 0.05, nx: 0, nz: s });
          void z;
        }
        // the alcove lined in steel
        for (const su of [-1, 1]) {
          const [x, z] = firmXZ(F, su * (C.alcove - 0.02), C.hv - C.deep / 2);
          lobby.steel.push(paint(box(x, L + 1.6, z, 0.04, 3.2, C.deep), '#9ea2a8'));
        }
      }
      // the firm's name over the lift
      {
        const [x, z] = firmXZ(F, 0, C.hv + 0.03);
        signs.push({ tex: nameTex(F.name, '#f2ede2'), w: 9.4, h: 1.47, x, y: 5.2, z, nx: 0, nz: s });
      }
      // ---------------- the floors above
      for (const L of DT.levels.slice(1)) {
        up.carpet.push(paint(fbox(F, 0, L - 0.15, 0, IW, 0.3, ID), fi % 2 ? '#3a3f4a' : '#4a4640'));
        up.ceil.push(paint(fbox(F, 0, L + DT.floorH + 0.15, 0, IW, 0.3, ID), '#ffffff'));
        // window mullions and the sill, inside the curtain wall
        for (let u = -hw + 0.4; u <= hw - 0.4; u += 1.55)
          for (const sv of [-1, 1]) up.steel.push(paint(fbox(F, u, L + DT.floorH / 2, sv * (hd - 0.45), 0.08, DT.floorH, 0.1), '#30343a'));
        for (let v = -hd + 0.4; v <= hd - 0.4; v += 1.55)
          for (const su of [-1, 1]) up.steel.push(paint(fbox(F, su * (hw - 0.45), L + DT.floorH / 2, v, 0.1, DT.floorH, 0.08), '#30343a'));
        for (const sv of [-1, 1]) up.white.push(paint(fbox(F, 0, L + 0.25, sv * (hd - 0.55), IW, 0.5, 0.2), '#d9d6cf'));
        for (const su of [-1, 1]) up.white.push(paint(fbox(F, su * (hw - 0.55), L + 0.25, 0, 0.2, 0.5, ID), '#d9d6cf'));
        // the market on the core's faces, the ticker running round it
        const off = 0.04;
        {
          const [x, z] = firmXZ(F, 0, C.hv + off);
          walls.push({ tex: 'chart', w: 9.6, h: 2.3, x, y: L + 4.05, z, nx: 0, nz: s });
        }
        {
          const [x, z] = firmXZ(F, 0, -C.hv - off);
          walls.push({ tex: 'board', w: 9.0, h: 3.0, x, y: L + 2.7, z, nx: 0, nz: -s });
          walls.push({ tex: 'ticker', w: 9.6, h: 0.32, x, y: L + 4.8, z, nx: 0, nz: -s });
        }
        for (const su of [-1, 1]) {
          const [x, z] = firmXZ(F, su * (C.hu + off), 0);
          walls.push({ tex: su < 0 ? 'board' : 'candles', w: 7.4, h: 2.8, x, y: L + 2.6, z, nx: su, nz: 0 });
          walls.push({ tex: 'ticker', w: 7.8, h: 0.32, x, y: L + 4.6, z, nx: su, nz: 0 });
        }
      }
      // desks: tops, ends, the riser of screens; chairs at every seat
      for (const d of FIRM_IN[fi].desks) {
        const u = d.x - F.x;
        const v = (d.z - F.z) * s;
        const L = d.y;
        const len = d.len;
        const dep = d.kind === 0 ? 1.6 : 1.4;
        up.white.push(paint(fbox(F, u, L + 0.75, v, len, 0.05, dep), d.kind === 0 ? '#e7e4dc' : '#a7825a'));
        for (const su of [-1, 1]) up.dark.push(paint(fbox(F, u + su * (len / 2 - 0.03), L + 0.37, v, 0.05, 0.74, dep - 0.1), '#3a3c40'));
        up.dark.push(paint(fbox(F, u, L + 0.4, v, len - 0.1, 0.6, 0.04), '#3a3c40'));
        const per = d.kind === 0 ? 3 : 2;
        if (d.kind === 0) up.dark.push(paint(fbox(F, u, L + 0.95, v, len - 0.2, 0.35, 0.14), '#26282c'));
        for (let k = 0; k < per; k++) {
          const su = u + (k - (per - 1) / 2) * (len / per);
          for (const side of [-1, 1]) {
            const mons = d.kind === 0 ? [[-0.27, 1.32], [0.27, 1.32], [-0.27, 1.68], [0.27, 1.68]] : [[-0.27, 1.08], [0.27, 1.08]];
            for (const [mu, my] of mons) {
              const mv = v + side * (d.kind === 0 ? 0.09 : 0.25);
              up.dark.push(paint(fbox(F, su + mu, L + my, mv, 0.52, 0.34, 0.04), '#141518'));
              const [x, z] = firmXZ(F, su + mu, mv + side * 0.025);
              up.screen.push(paint(facing(0.47, 0.29, x, L + my, z, 0, side * s), '#ffffff', { aSeed: [seed()] }));
            }
            if (d.kind === 1) up.dark.push(paint(fbox(F, su, L + 0.88, v + side * 0.25, 0.08, 0.2, 0.08), '#141518'));
            // the chair
            const cv = v + side * (dep / 2 + 0.55);
            up.dark.push(paint(fbox(F, su, L + 0.46, cv, 0.5, 0.08, 0.5), '#1e2024'));
            up.dark.push(paint(fbox(F, su, L + 0.82, cv + side * 0.26, 0.5, 0.62, 0.07), '#1e2024'));
            up.steel.push(paint(fbox(F, su, L + 0.22, cv, 0.06, 0.44, 0.06), '#6b6f74'));
          }
        }
      }
      for (const t of FIRM_IN[fi].tables) {
        up.wood.push(paint(box(t.x, t.y + 0.76, t.z, t.w, 0.08, t.d), '#5a3a22'));
        up.dark.push(paint(box(t.x, t.y + 0.36, t.z, t.w - 1.5, 0.72, 0.6), '#2a2a2a'));
      }
      for (const b of FIRM_IN[fi].glass) up.glass.push(paint(box((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), '#ffffff'));
      // the printer and a stack of pitchbooks
      {
        const L = DT.levels[2];
        up.white.push(paint(fbox(F, C.hu + 1.2, L + 0.6, 0, 1.2, 1.2, 1.0), '#cfd0cc'));
        up.dark.push(paint(fbox(F, C.hu + 1.2, L + 1.22, 0, 1.0, 0.05, 0.8), '#2b2c2f'));
        up.white.push(paint(fbox(F, C.hu + 1.2, L + 1.3, 0.1, 0.32, 0.12, 0.45), '#f6f6f2'));
        if (fi === 1) {
          // the term sheet on the boardroom table
          const [x, , z] = IB_SPOTS.board;
          up.white.push(paint(box(x, L + 0.82, z - s * 1.3, 0.3, 0.02, 0.42), '#fbfbf6'));
        }
      }
    });
    const wrap = (o: Record<string, G[]>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, merge(v)])) as Record<string, G>;
    return { lobby: wrap(lobby), up: wrap(up), signs, walls, arrows };
  }, []);
  const mats = useMemo(() => {
    const ceil = ceilingTex();
    return {
      stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }),
      steel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.75 }),
      glass: new THREE.MeshStandardMaterial({ color: '#bcd4de', transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.3, depthWrite: false, side: THREE.DoubleSide }),
      marble: new THREE.MeshStandardMaterial({ color: '#e9e4da', roughness: 0.12, metalness: 0.05 }),
      ceilL: new THREE.MeshStandardMaterial({ color: '#f2f0ea', emissive: '#fff7e6', emissiveIntensity: 0.35, roughness: 0.9 }),
      plant: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }),
      carpet: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
      ceil: new THREE.MeshStandardMaterial({ map: ceil, emissiveMap: ceil, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.9 }),
      wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }),
      dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
      white: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
      screen: screenMat(),
    };
  }, []);
  const arrowT = useMemo(() => ({ up: arrowTex(true), down: arrowTex(false) }), []);
  const lobbyNpcs = useMemo(() => FIRM_IN.flatMap((f) => f.npcs.filter((n) => n.y < 1)), []);
  const upNpcs = useMemo(() => FIRM_IN.flatMap((f) => f.npcs.filter((n) => n.y >= 1)), []);
  const lobbyG = useRef<THREE.Group>(null);
  const upG = useRef<THREE.Group>(null);
  const last = useRef(0);
  useFrame((st) => {
    NPC_T.value = st.clock.elapsedTime;
    const cam = st.camera.position;
    const near = cam.x > 165;
    const k = firmAt(cam.x, cam.z, 2);
    const inside = k >= 0 && cam.y > 20;
    if (lobbyG.current) lobbyG.current.visible = near;
    if (upG.current) upG.current.visible = inside;
    if (inside) {
      // the market moves: redraw the walls four times a second, crawl the ticker
      market.ticker.tex.offset.x = (marketT() * 0.05) % 1;
      if (st.clock.elapsedTime - last.current > 0.25) {
        last.current = st.clock.elapsedTime;
        for (const m of [market.chart, market.candles, market.board, market.ticker]) {
          m.draw();
          m.tex.needsUpdate = true;
        }
      }
    }
  });
  const L = built.lobby;
  const U = built.up;
  return (
    <group>
      <group ref={lobbyG}>
        <mesh geometry={L.stone} material={mats.stone} receiveShadow />
        <mesh geometry={L.steel} material={mats.steel} />
        <mesh geometry={L.marble} material={mats.marble} receiveShadow />
        <mesh geometry={L.ceil} material={mats.ceilL} />
        <mesh geometry={L.plant} material={mats.plant} />
        <mesh geometry={L.glass} material={mats.glass} renderOrder={2} />
        {built.signs.map((s, k) => (
          <mesh key={k} position={[s.x, s.y, s.z]} rotation={[0, Math.atan2(s.nx, s.nz), 0]}>
            <planeGeometry args={[s.w, s.h]} />
            <meshBasicMaterial map={s.tex} transparent toneMapped={false} />
          </mesh>
        ))}
        {built.arrows.map((a, k) => (
          <mesh key={k} position={[a.x, a.y, a.z]} rotation={[0, Math.atan2(a.nx, a.nz), 0]}>
            <planeGeometry args={[0.9, 0.45]} />
            <meshBasicMaterial map={a.up ? arrowT.up : arrowT.down} toneMapped={false} />
          </mesh>
        ))}
        <People list={lobbyNpcs} />
      </group>
      <group ref={upG} visible={false}>
        <mesh geometry={U.carpet} material={mats.carpet} receiveShadow />
        <mesh geometry={U.ceil} material={mats.ceil} />
        <mesh geometry={U.steel} material={mats.steel} />
        <mesh geometry={U.white} material={mats.white} />
        <mesh geometry={U.wood} material={mats.wood} />
        <mesh geometry={U.dark} material={mats.dark} />
        <mesh geometry={U.screen} material={mats.screen} />
        <mesh geometry={U.glass} material={mats.glass} renderOrder={2} />
        {built.walls.map((w, k) => (
          <mesh key={k} position={[w.x, w.y, w.z]} rotation={[0, Math.atan2(w.nx, w.nz), 0]}>
            <planeGeometry args={[w.w, w.h]} />
            <meshBasicMaterial map={market[w.tex].tex} toneMapped={false} />
          </mesh>
        ))}
        <People list={upNpcs} />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------
// the 投行家 marker: a gold beam and a turning diamond where the next task is (at the tower's door, at its
// lift if you're on the wrong floor, then at the spot itself); the client by the lake
// ---------------------------------------------------------------
function QuestMarker() {
  const g = useRef<THREE.Group>(null);
  const gem = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (!g.current) return;
    const st2 = ibTask();
    if (!st2) {
      g.current.visible = false;
      return;
    }
    let [x, y, z] = st2.spot;
    const vx = mapRuntime.viewX;
    const vz = mapRuntime.viewZ;
    const vy = mapRuntime.viewY ?? 0;
    if (st2.firm >= 0) {
      const F = FIRMS[st2.firm];
      const here = firmAt(vx, vz) === st2.firm;
      const lv = vy >= DT.levels[2] - 0.6 ? 2 : vy >= DT.levels[1] - 0.6 ? 1 : 0;
      if (!here) {
        [x, z] = firmXZ(F, 0, F.d / 2 + 2.5);
        y = DT.y;
      } else if (lv !== st2.level) {
        [x, z] = liftCar(F, st2.level > lv);
        y = DT.levels[lv];
      }
    }
    g.current.visible = true;
    g.current.position.set(x, y, z);
    const t = st.clock.elapsedTime;
    if (gem.current) {
      gem.current.position.y = 2.6 + Math.sin(t * 2) * 0.15;
      gem.current.rotation.y = t * 1.5;
    }
    const indoor = firmAt(x, z) >= 0;
    if (beam.current) {
      beam.current.scale.y = indoor ? 5 : 60;
      beam.current.position.y = beam.current.scale.y / 2;
    }
  });
  return (
    <group ref={g}>
      <mesh ref={gem}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshBasicMaterial color="#ffd36a" toneMapped={false} />
      </mesh>
      <mesh ref={beam}>
        <cylinderGeometry args={[0.18, 0.18, 1, 10, 1, true]} />
        <meshBasicMaterial color="#ffcf55" transparent opacity={0.32} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.8, 1.0, 32]} />
        <meshBasicMaterial color="#ffd36a" transparent opacity={0.7} toneMapped={false} />
      </mesh>
    </group>
  );
}
export function LADowntown() {
  const market = useMarket();
  return (
    <group>
      <Bridge />
      <Plaza />
      <Interiors market={market} />
      <QuestMarker />
      <ClientNpc />
    </group>
  );
}
/** whoever the current task has waiting out in the city (a client in a light suit) */
function ClientNpc() {
  const [at, setAt] = React.useState<[number, number, number] | null>(null);
  const key = useRef('');
  useFrame(() => {
    const t = ibTask();
    const p = t?.client ? t.spot : null;
    const k = p ? p.join(',') : '';
    if (k !== key.current) {
      key.current = k;
      setAt(p);
    }
  });
  const list = useMemo(() => (at ? [{ x: at[0], y: at[1], z: at[2], yaw: Math.atan2(-at[0], -at[2]), pose: 0 as const, suit: 4 }] : []), [at]);
  return list.length ? <People list={list} /> : null;
}
