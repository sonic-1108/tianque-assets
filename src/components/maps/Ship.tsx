import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { seeded } from '../Scenery';
import { SHIP_LAYOUT } from '../../maps';

// ---------------------------------------------------------------
// 怒海战船: a great 福船-style war junk, five storeys. Ship frame: main deck at y = 0, bow toward -z.
// The fighters play on |x| <= 11.8, |z| <= 40 (see SHIP_LAYOUT); the hull wraps round that box.
// ---------------------------------------------------------------
export const SHIP = { stern: 43, bow: -56, beam: 12.9, wall: 0.45 };
const BOW_T = -39.5; // full beam aft of here, then the bow narrows to its stem
const STERN_T = 40.4;

/** half-width of the hull at the gunwale */
export function hullW(z: number) {
  if (z > STERN_T) {
    const t = Math.min(1, (z - STERN_T) / (SHIP.stern - STERN_T));
    return SHIP.beam - 1.6 * t * t;
  }
  if (z < BOW_T) {
    const t = Math.min(1, (BOW_T - z) / (BOW_T - SHIP.bow));
    return SHIP.beam * Math.pow(Math.max(0, 1 - Math.pow(t, 1.8)), 0.75);
  }
  return SHIP.beam;
}
const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** gunwale height above the main deck: steps up a storey around each raised deck, sweeps up at the bow */
export function sheer(z: number) {
  const L = SHIP_LAYOUT;
  let h = 1.3;
  h += L.H * ss(L.fore.edge + 1.6, L.fore.edge, z); // forecastle
  if (z < -40) h += 3.2 * Math.pow((-40 - z) / (-40 - SHIP.bow), 2);
  for (const t of L.tiers) h += L.H * ss(t.edge - 1.6, t.edge, z); // each storey of the stern tower
  if (z > 40) h += 0.6 * Math.min(1, (z - 40) / (SHIP.stern - 40));
  return h;
}
function keelY(z: number) {
  if (z < -38) return -9.6 + 6.6 * Math.pow(Math.min(1, (-38 - z) / (-38 - SHIP.bow)), 1.5);
  if (z > 34) return -9.6 + 3.2 * Math.min(1, (z - 34) / (SHIP.stern - 34));
  return -9.6;
}
const bowness = (z: number) => (z < BOW_T ? Math.min(1, (BOW_T - z) / (BOW_T - SHIP.bow)) : 0);
const sternness = (z: number) => (z > STERN_T ? Math.min(1, (z - STERN_T) / (SHIP.stern - STERN_T)) : 0);
// round-bilged section with a little flare at the top, keel at v = 1
const PROF: [number, number][] = [
  [1.0, 0], [1.02, 0.08], [1.025, 0.16], [1.01, 0.28], [0.97, 0.42], [0.88, 0.57], [0.74, 0.7], [0.55, 0.81], [0.33, 0.9], [0.13, 0.97], [0, 1],
];
/** a point on the outer skin: station z, profile row j, side ±1 */
export function hullPoint(z: number, j: number, side: number) {
  const [pu, v] = PROF[j];
  const b = bowness(z);
  const k = Math.pow(b, 0.7);
  const u = pu * (1 - k) + (1 - v) * k; // the bow sharpens into a V
  const top = sheer(z);
  const bot = keelY(z);
  const y = top + (bot - top) * v;
  // the stem rakes forward toward the top, the transom overhangs aft
  const zz = z + v * 1.6 * b - v * 1.8 * sternness(z);
  return new THREE.Vector3(side * hullW(z) * u, y, zz);
}

// the hull texture runs from HULL_TOP (above the top of the stern tower) down HULL_TEX_M metres past the keel:
// the tower's lacquered storeys with their windows, then the main gunwale (y = 1.3), the wales and the planking
const HULL_TOP = 19.6;
const HULL_TEX_M = 30;
const GUNWALE = 1.3;

function stationList(n: number) {
  const out: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // denser toward the bow, where the shape changes fastest
    const s = 1 - Math.pow(1 - t, 1.35);
    out.push(SHIP.stern + (SHIP.bow - SHIP.stern) * s);
  }
  return out;
}

/** the outer skin, keel to gunwale on both sides, plus a flat transom */
export function buildHullGeometry(nz = 72) {
  const zs = stationList(nz);
  const NS = PROF.length;
  const cols = NS * 2 - 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const z of zs) {
    for (let c = 0; c < cols; c++) {
      const side = c < NS ? 1 : -1;
      const j = c < NS ? c : cols - 1 - c;
      const p = hullPoint(z, j, side);
      pos.push(p.x, p.y, p.z);
      uv.push(z / 3.2, (HULL_TOP - p.y) / HULL_TEX_M);
    }
  }
  for (let i = 0; i < zs.length - 1; i++)
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = a + cols;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // transom: fan from its centre
  const base = pos.length / 3;
  const zT = zs[0];
  let cy = 0;
  let cz = 0;
  for (let c = 0; c < cols; c++) {
    cy += pos[c * 3 + 1];
    cz += pos[c * 3 + 2];
  }
  pos.push(0, cy / cols, cz / cols);
  uv.push(0, 0.5);
  for (let c = 0; c < cols; c++) {
    pos.push(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]);
    uv.push(pos[c * 3] / 3.2, (HULL_TOP - pos[c * 3 + 1]) / HULL_TEX_M);
  }
  // close the top edge of the transom too
  for (let c = 0; c < cols - 1; c++) idx.push(base, base + 1 + c, base + 2 + c);
  idx.push(base, base + cols, base + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** the inside face of the bulwark and the cap rail on top of it */
function buildBulwark() {
  const zs = stationList(60).filter((z) => hullW(z) > 0.9);
  const inner: number[] = [];
  const iuv: number[] = [];
  const cap: number[] = [];
  const ii: number[] = [];
  const ci: number[] = [];
  const T = SHIP.wall;
  for (const side of [1, -1]) {
    const b0 = inner.length / 3;
    const c0 = cap.length / 3;
    zs.forEach((z, i) => {
      const w = hullW(z) * 1.0;
      const s = sheer(z);
      inner.push(side * (w - T), -0.05, z, side * (w - T), s, z);
      iuv.push(z / 1.6, 0, z / 1.6, s / 1.3);
      cap.push(side * (w - T - 0.08), s + 0.12, z, side * (w + 0.1), s + 0.12, z, side * (w + 0.1), s - 0.16, z);
      if (i) {
        const a = b0 + (i - 1) * 2;
        if (side > 0) ii.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        else ii.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        const c = c0 + (i - 1) * 3;
        for (let k = 0; k < 2; k++) ci.push(c + k, c + k + 3, c + k + 1, c + k + 1, c + k + 3, c + k + 4);
      }
    });
  }
  const gi = new THREE.BufferGeometry();
  gi.setAttribute('position', new THREE.Float32BufferAttribute(inner, 3));
  gi.setAttribute('uv', new THREE.Float32BufferAttribute(iuv, 2));
  gi.setIndex(ii);
  gi.computeVertexNormals();
  const gc = new THREE.BufferGeometry();
  gc.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3));
  gc.setIndex(ci);
  gc.computeVertexNormals();
  return { inner: gi, cap: gc };
}

// ---------------------------------------------------------------- textures
function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}
function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function grain(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number, n: number, vertical: boolean) {
  for (let k = 0; k < n; k++) {
    g.fillStyle = rand() < 0.5 ? `rgba(0,0,0,${0.05 + rand() * 0.08})` : `rgba(255,225,190,${0.03 + rand() * 0.04})`;
    if (vertical) g.fillRect(x + rand() * w, y + rand() * h, 1 + rand(), 20 + rand() * 90);
    else g.fillRect(x + rand() * w, y + rand() * h, 20 + rand() * 90, 1 + rand());
  }
}

/** hull planking: horizontal strakes, a lacquered sheer band with gold beading and a heavy wale at deck level */
export function hullTexture() {
  const rand = seeded(5);
  const { c, g } = canvas(512, 4096);
  const e = canvas(512, 4096);
  e.g.fillStyle = '#000';
  e.g.fillRect(0, 0, 512, 4096);
  const px = 4096 / HULL_TEX_M;
  const g0 = (HULL_TOP - GUNWALE) * px; // the main gunwale, in texture rows
  // the stern tower and the forecastle above the main gunwale: dark lacquer boards, gilt beads at each deck,
  // and a row of lattice windows (lit from inside) in every storey
  g.fillStyle = '#4a1610';
  g.fillRect(0, 0, 512, g0);
  for (let y = 0; y < g0; y += px * 0.34) {
    g.fillStyle = `hsl(${6 + rand() * 6}, ${45 + rand() * 10}%, ${16 + rand() * 5}%)`;
    g.fillRect(0, y, 512, px * 0.32);
    grain(g, 0, y, 512, px * 0.32, rand, 20, false);
  }
  const H = SHIP_LAYOUT.H;
  for (let k = 0; k <= 4; k++) {
    const yd = (HULL_TOP - k * H) * px; // deck line of storey k
    g.fillStyle = '#c8a050';
    g.fillRect(0, yd - 5, 512, 10);
    g.fillStyle = '#120c08';
    g.fillRect(0, yd + 5, 512, px * 0.12);
    if (k > 3) continue;
    const top = (HULL_TOP - k * H - 3.3) * px;
    const bot = (HULL_TOP - k * H - 1.7) * px;
    for (const x0 of [40, 296]) {
      const w = 176;
      g.fillStyle = '#c8a050';
      g.fillRect(x0 - 8, top - 8, w + 16, bot - top + 16);
      g.fillStyle = '#e6b25a';
      g.fillRect(x0, top, w, bot - top);
      e.g.fillStyle = '#ffb45a';
      e.g.fillRect(x0, top, w, bot - top);
      // lattice
      g.fillStyle = '#2a0e08';
      e.g.fillStyle = '#000';
      for (let x = x0; x <= x0 + w; x += 22) {
        g.fillRect(x - 2, top, 4, bot - top);
        e.g.fillRect(x - 2, top, 4, bot - top);
      }
      for (let y = top; y <= bot; y += 22) {
        g.fillRect(x0, y - 2, w, 4);
        e.g.fillRect(x0, y - 2, w, 4);
      }
    }
  }
  // planking below the gunwale
  let y = g0;
  while (y < 4096) {
    const h = px * (0.3 + rand() * 0.06);
    const l = 30 + rand() * 10;
    g.fillStyle = `hsl(${22 + rand() * 8}, ${30 + rand() * 12}%, ${l}%)`;
    g.fillRect(0, y, 512, h);
    // butt joints, staggered
    g.fillStyle = 'rgba(0,0,0,0.55)';
    const off = rand() * 512;
    for (let x = off % 170; x < 512; x += 170) g.fillRect(x, y, 2, h);
    grain(g, 0, y, 512, h, rand, 60, false);
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, y + h - 3, 512, 3);
    g.fillStyle = 'rgba(255,230,200,0.08)';
    g.fillRect(0, y, 512, 2);
    y += h;
  }
  g.save();
  g.translate(0, g0);
  // lacquered red sheer band with painted cloud scrolls and gold beading
  const band = px * 0.5;
  g.fillStyle = '#6a1510';
  g.fillRect(0, 0, 512, band);
  g.strokeStyle = 'rgba(214,170,80,0.85)';
  g.lineWidth = 3;
  for (let x = 0; x < 512; x += 64) {
    g.beginPath();
    g.arc(x + 32, band * 0.5, band * 0.22, Math.PI * 0.2, Math.PI * 1.7);
    g.stroke();
    g.beginPath();
    g.arc(x + 32 + band * 0.12, band * 0.5, band * 0.1, Math.PI * 1.2, Math.PI * 2.6);
    g.stroke();
  }
  g.fillStyle = '#c8a050';
  g.fillRect(0, band, 512, 6);
  g.fillRect(0, 4, 512, 4);
  // the wale: a heavy black rubbing strake where the deck meets the side
  const wy = px * 1.0;
  g.fillStyle = '#120c08';
  g.fillRect(0, wy, 512, px * 0.2);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, wy, 512, 3);
  g.fillStyle = '#b08840';
  g.fillRect(0, wy + px * 0.2, 512, 4);
  // a second wale lower down, along the gun deck
  const wy2 = px * 2.4;
  g.fillStyle = '#120c08';
  g.fillRect(0, wy2, 512, px * 0.16);
  g.fillStyle = '#9a7838';
  g.fillRect(0, wy2 + px * 0.16, 512, 3);
  // salt stains and streaks running down from the scuppers
  for (let k = 0; k < 40; k++) {
    const x = rand() * 512;
    const grd = g.createLinearGradient(0, wy, 0, wy + 200 + rand() * 300);
    grd.addColorStop(0, 'rgba(210,215,205,0.18)');
    grd.addColorStop(1, 'rgba(210,215,205,0)');
    g.fillStyle = grd;
    g.fillRect(x, wy + px * 0.2, 3 + rand() * 6, 500);
  }
  g.restore();
  const t = tex(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  const em = tex(e.c);
  em.wrapT = THREE.ClampToEdgeWrapping;
  return { map: t, emissive: em };
}

/** inside of the bulwark: red lacquered boards */
function bulwarkTexture() {
  const rand = seeded(8);
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#7e2a1c';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 42) {
    g.fillStyle = `rgba(0,0,0,${0.15 + rand() * 0.15})`;
    g.fillRect(0, y, 256, 3);
    grain(g, 0, y, 256, 42, rand, 30, false);
  }
  // wear: bare wood where hands and shoulders rub
  for (let k = 0; k < 18; k++) {
    g.fillStyle = `rgba(120,80,50,${0.15 + rand() * 0.2})`;
    g.fillRect(rand() * 256, 150 + rand() * 100, 10 + rand() * 40, 3 + rand() * 6);
  }
  g.fillStyle = '#b8903e';
  g.fillRect(0, 244, 256, 5);
  return tex(c);
}

/** deck planks running fore and aft, tarred seams, butt joints with treenails */
export function deckTexture() {
  const rand = seeded(11);
  const { c, g } = canvas(512, 1024);
  const n = 12;
  const w = 512 / n;
  for (let i = 0; i < n; i++) {
    let y = -rand() * 400;
    while (y < 1024) {
      const L = 300 + rand() * 300;
      const l = 30 + rand() * 9;
      g.fillStyle = `hsl(${28 + rand() * 6}, ${22 + rand() * 10}%, ${l}%)`;
      g.fillRect(i * w, y, w, L);
      grain(g, i * w, y, w, L, rand, 26, true);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(i * w, y, w, 2);
      g.fillStyle = 'rgba(20,12,6,0.7)';
      for (const dy of [7, L - 9]) for (const dx of [0.3, 0.7]) g.fillRect(i * w + w * dx - 1.5, y + dy, 3, 3);
      y += L;
    }
    g.fillStyle = '#120b06';
    g.fillRect(i * w, 0, 2.5, 1024);
  }
  // scuffs and wet patches
  for (let k = 0; k < 50; k++) {
    g.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.06})`;
    g.beginPath();
    g.ellipse(rand() * 512, rand() * 1024, 10 + rand() * 50, 10 + rand() * 70, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return tex(c);
}

/** junk sail cloth: rust-red panels between battens, seams, patches and a faded sun disc */
function sailTexture(seed: number) {
  const rand = seeded(seed);
  const { c, g } = canvas(512, 512);
  g.fillStyle = '#7a2e1a';
  g.fillRect(0, 0, 512, 512);
  for (let k = 0; k < 600; k++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '40,10,5' : '170,90,60'},${0.04 + rand() * 0.06})`;
    g.fillRect(rand() * 512, rand() * 512, 4 + rand() * 30, 2 + rand() * 10);
  }
  // vertical cloth seams
  g.fillStyle = 'rgba(30,8,4,0.35)';
  for (let x = 0; x < 512; x += 28) g.fillRect(x, 0, 1.5, 512);
  // panels between the battens: darker near each batten, a sheen in the belly
  for (let p = 0; p < 6; p++) {
    const y0 = (p / 6) * 512;
    const grd = g.createLinearGradient(0, y0, 0, y0 + 512 / 6);
    grd.addColorStop(0, 'rgba(0,0,0,0.35)');
    grd.addColorStop(0.45, 'rgba(255,200,160,0.06)');
    grd.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = grd;
    g.fillRect(0, y0, 512, 512 / 6);
  }
  // a faded ochre sun disc with a ring
  g.strokeStyle = 'rgba(210,160,80,0.35)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(256, 250, 120, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(210,150,70,0.18)';
  g.beginPath();
  g.arc(256, 250, 90, 0, Math.PI * 2);
  g.fill();
  // patches
  for (let k = 0; k < 7; k++) {
    const x = rand() * 460;
    const y = rand() * 460;
    const w = 20 + rand() * 50;
    const h = 16 + rand() * 40;
    g.fillStyle = rand() < 0.5 ? 'rgba(100,45,25,0.8)' : 'rgba(70,30,20,0.8)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(220,190,150,0.35)';
    g.setLineDash([3, 3]);
    g.lineWidth = 1;
    g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    g.setLineDash([]);
  }
  // salt and wear along the bottom edge
  const grd = g.createLinearGradient(0, 400, 0, 512);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.4)');
  g.fillStyle = grd;
  g.fillRect(0, 400, 512, 112);
  return tex(c);
}

/** cargo crate: framed boards with a diagonal brace and a stencilled mark */
export function crateTexture() {
  const rand = seeded(23);
  const { c, g } = canvas(256, 256);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = `hsl(${30 + rand() * 6}, ${32 + rand() * 10}%, ${36 + rand() * 10}%)`;
    g.fillRect(0, i * 51.2, 256, 51.2);
    grain(g, 0, i * 51.2, 256, 51.2, rand, 26, false);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, i * 51.2, 256, 2);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.save();
  g.translate(128, 128);
  g.rotate(Math.PI / 4);
  g.fillRect(-180, -14, 360, 28);
  g.restore();
  g.fillStyle = '#5a3a20';
  g.save();
  g.translate(128, 128);
  g.rotate(Math.PI / 4);
  g.fillRect(-180, -11, 360, 22);
  g.restore();
  const fr = 22;
  g.fillStyle = '#4a2e18';
  g.fillRect(0, 0, 256, fr);
  g.fillRect(0, 256 - fr, 256, fr);
  g.fillRect(0, 0, fr, 256);
  g.fillRect(256 - fr, 0, fr, 256);
  g.fillStyle = 'rgba(255,220,170,0.12)';
  g.fillRect(0, 0, 256, 2);
  g.fillRect(0, 0, 2, 256);
  // iron corner plates
  g.fillStyle = '#26221e';
  for (const [x, y] of [[0, 0], [226, 0], [0, 226], [226, 226]]) g.fillRect(x, y, 30, 30);
  g.fillStyle = '#5a5248';
  for (const [x, y] of [[8, 8], [240, 8], [8, 240], [240, 240]]) g.fillRect(x, y, 6, 6);
  // a red merchant's seal
  g.strokeStyle = 'rgba(150,30,20,0.75)';
  g.lineWidth = 5;
  g.strokeRect(150, 46, 52, 52);
  g.fillStyle = 'rgba(150,30,20,0.6)';
  g.fillRect(162, 58, 28, 6);
  g.fillRect(173, 58, 6, 30);
  g.fillRect(160, 80, 32, 6);
  return tex(c);
}

/** a wall of the stern castle: lacquered posts, painted beam, lattice windows (lit), optional door */
function castleWall(widthM: number, heightM: number, door: boolean) {
  const W = 1024;
  const H = Math.round((W * heightM) / widthM);
  const col = canvas(W, H);
  const emi = canvas(W, H);
  const g = col.g;
  const e = emi.g;
  e.fillStyle = '#000';
  e.fillRect(0, 0, W, H);
  const m = W / widthM;
  g.fillStyle = '#3a1a10';
  g.fillRect(0, 0, W, H);
  const bays = Math.max(3, Math.round(widthM / 2.1));
  const bw = W / bays;
  const beam = 0.42 * m;
  const sill = 0.75 * m;
  for (let b = 0; b < bays; b++) {
    const x0 = b * bw;
    const isDoor = door && b === Math.floor(bays / 2);
    const px = 0.24 * m;
    const ix = x0 + px / 2;
    const iw = bw - px;
    if (isDoor) {
      // double door, dark lacquer with gold studs and ring pulls, lit through a transom grille
      g.fillStyle = '#2a0e08';
      g.fillRect(ix, beam + 0.3 * m, iw, H - beam - 0.3 * m);
      g.fillStyle = '#1a0805';
      g.fillRect(ix + iw / 2 - 2, beam + 0.3 * m, 4, H);
      g.fillStyle = '#c9a050';
      for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) for (const s of [0, 1]) {
        g.beginPath();
        g.arc(ix + iw * (s ? 0.6 : 0.1) + k * iw * 0.13, beam + 0.55 * m + r * 0.32 * m, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#d8b060';
      g.lineWidth = 3;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(ix + iw / 2 + s * 0.16 * m, H * 0.62, 0.07 * m, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = '#ffb35a';
      e.fillStyle = '#ff9a40';
      for (let k = 0; k < 6; k++) {
        g.fillRect(ix + 6 + (k * iw) / 6, beam + 0.06 * m, iw / 6 - 10, 0.18 * m);
        e.fillRect(ix + 6 + (k * iw) / 6, beam + 0.06 * m, iw / 6 - 10, 0.18 * m);
      }
    } else {
      // lattice window over a panelled dado
      const wy = beam + 0.12 * m;
      const wh = H - beam - sill - 0.22 * m;
      g.fillStyle = '#ffbf6a';
      g.fillRect(ix + 6, wy, iw - 12, wh);
      const grd = e.createLinearGradient(0, wy, 0, wy + wh);
      grd.addColorStop(0, '#c86a24');
      grd.addColorStop(1, '#ffb050');
      e.fillStyle = grd;
      e.fillRect(ix + 6, wy, iw - 12, wh);
      // the lattice (步步锦-ish grid), drawn on both maps
      for (const ctx of [g, e]) {
        ctx.fillStyle = ctx === g ? '#3a160c' : '#000';
        const st = 0.16 * m;
        for (let x = ix + 6; x < ix + iw - 6; x += st) ctx.fillRect(x, wy, 3.5, wh);
        for (let y = wy; y < wy + wh; y += st) ctx.fillRect(ix + 6, y, iw - 12, 3.5);
        ctx.fillRect(ix + 6, wy, iw - 12, 6);
        ctx.fillRect(ix + 6, wy + wh - 6, iw - 12, 6);
      }
      // a few panes papered over, glowing dimmer
      e.fillStyle = 'rgba(0,0,0,0.5)';
      for (let k = 0; k < 4; k++) e.fillRect(ix + 6 + ((k * 37) % (iw - 40)), wy + ((k * 53) % (wh - 30)), 0.16 * m, 0.16 * m);
      // dado panel
      g.fillStyle = '#4a1c10';
      g.fillRect(ix, H - sill, iw, sill);
      g.strokeStyle = '#b48a40';
      g.lineWidth = 3;
      g.strokeRect(ix + 0.08 * m, H - sill + 0.1 * m, iw - 0.16 * m, sill - 0.2 * m);
    }
    // lacquered post
    g.fillStyle = '#7a1a12';
    g.fillRect(x0 - px / 2, 0, px, H);
    g.fillStyle = 'rgba(255,190,150,0.15)';
    g.fillRect(x0 - px / 2, 0, 3, H);
  }
  g.fillStyle = '#7a1a12';
  g.fillRect(W - 0.12 * m, 0, 0.12 * m, H);
  // the beam: blue-green 彩画 with gold-edged cartouches
  g.fillStyle = '#1e4a4a';
  g.fillRect(0, 0, W, beam);
  for (let b = 0; b < bays; b++) {
    const cx = (b + 0.5) * bw;
    g.fillStyle = '#2b6a62';
    g.fillRect(cx - bw * 0.3, beam * 0.18, bw * 0.6, beam * 0.64);
    g.strokeStyle = '#c9a050';
    g.lineWidth = 3;
    g.strokeRect(cx - bw * 0.3, beam * 0.18, bw * 0.6, beam * 0.64);
    g.fillStyle = '#d6b060';
    g.beginPath();
    g.arc(cx, beam * 0.5, beam * 0.16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#163838';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(cx + s * bw * 0.42, beam * 0.5, beam * 0.22, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = '#c9a050';
  g.fillRect(0, beam - 4, W, 4);
  const a = tex(col.c);
  const b = tex(emi.c);
  a.wrapS = a.wrapT = b.wrapS = b.wrapT = THREE.ClampToEdgeWrapping;
  return { map: a, emissive: b };
}

/** painted 龙目 eye for the bow */
function eyeTexture() {
  const { c, g } = canvas(256, 256);
  g.translate(128, 128);
  g.fillStyle = '#e8e0cc';
  g.beginPath();
  g.ellipse(0, 0, 118, 70, 0, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = '#111';
  g.stroke();
  g.fillStyle = '#111';
  g.beginPath();
  g.arc(12, 0, 48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#c8302a';
  g.beginPath();
  g.arc(12, 0, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(24, -12, 9, 0, Math.PI * 2);
  g.fill();
  // brow flourish
  g.strokeStyle = '#c9a050';
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(-115, -60);
  g.quadraticCurveTo(0, -125, 120, -62);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex: THREE.Texture | null = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const { c, g } = canvas(64, 64);
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,190,120,1)');
  grd.addColorStop(0.25, 'rgba(255,130,60,0.45)');
  grd.addColorStop(1, 'rgba(255,90,30,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** hull material: darkens and greens below the waterline, glistens wet */
function hullMaterial({ map, emissive }: { map: THREE.Texture; emissive: THREE.Texture }) {
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: new THREE.Color(1.4, 0.8, 0.35), roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('void main() {', 'varying float vShipY;\nvoid main() {\n  vShipY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'varying float vShipY;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float tqWet = 1.0 - smoothstep(-3.3, -2.7, vShipY);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.08, 0.065), tqWet * 0.85);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.32, 1.0 - smoothstep(-3.1, -2.0, vShipY));`,
      );
  };
  m.customProgramCacheKey = () => 'tq-hull';
  return m;
}

/** many copies of one mesh in a single draw call */
function Instances({ geometry, material, matrices, castShadow = false }: { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    matrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [matrices]);
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} castShadow={castShadow} />;
}
const M4 = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rz)), new THREE.Vector3(sx, sy, sz));

// ---------------------------------------------------------------- the hull with its fittings
export function ShipHull() {
  const { hull, bulwark, mats, stanchions, guns, eyes } = useMemo(() => {
    const hullMap = hullTexture();
    const bt = bulwarkTexture();
    const mats = {
      hull: hullMaterial(hullMap),
      inner: new THREE.MeshStandardMaterial({ map: bt, roughness: 0.75 }),
      cap: new THREE.MeshStandardMaterial({ color: '#2a1810', roughness: 0.55 }),
      post: new THREE.MeshStandardMaterial({ color: '#4a2416', roughness: 0.7 }),
      bronze: new THREE.MeshStandardMaterial({ color: '#6b5428', roughness: 0.38, metalness: 0.85 }),
      port: new THREE.MeshStandardMaterial({ color: '#140c08', roughness: 0.9 }),
      eye: new THREE.MeshStandardMaterial({ map: eyeTexture(), transparent: true, alphaTest: 0.02, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
    // stanchions along the inside of the bulwark
    const st: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    for (let z = SHIP_LAYOUT.fore.edge + 1.8; z <= SHIP_LAYOUT.tiers[0].edge - 1.8; z += 1.45)
      for (const s of [1, -1]) {
        const h = sheer(z);
        st.push(new THREE.Matrix4().compose(new THREE.Vector3(s * (hullW(z) - SHIP.wall - 0.07), h / 2, z), q, new THREE.Vector3(0.16, h + 0.02, 0.2)));
      }
    // cannon muzzles poking out of gunports along both sides
    const gn: { p: [number, number, number]; s: number }[] = [];
    for (const z of [-22, -16, -10, -4, 2, 8]) for (const s of [1, -1]) gn.push({ p: [s * hullW(z), -1.6, z], s });
    // more batteries up the stern tower and in the forecastle
    for (const z of [-36, -31, 17, 24, 31, 37]) for (const s of [1, -1]) gn.push({ p: [s * hullW(z), 1.0, z], s });
    for (const z of [25, 31, 37]) for (const s of [1, -1]) gn.push({ p: [s * hullW(z), 5.6 + (z > 30 ? 4.4 : 0), z], s });
    // eyes: sample the skin to sit them flush on the bow
    const ey = [1, -1].map((s) => {
      const z = -47.5;
      const a = hullPoint(z, 2, s);
      const b = hullPoint(z + 0.3, 2, s);
      const c2 = hullPoint(z, 3, s);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c2, a)).normalize();
      if (n.x * s < 0) n.negate();
      const p = a.clone().lerp(c2, 0.4).addScaledVector(n, 0.04);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), n, new THREE.Vector3(0, 1, 0));
      const rot = new THREE.Euler().setFromRotationMatrix(m);
      return { p, rot, s };
    });
    return { hull: buildHullGeometry(), bulwark: buildBulwark(), mats, stanchions: st, guns: gn, eyes: ey };
  }, []);
  const gunGeo = useMemo(
    () => ({ port: new THREE.BoxGeometry(0.08, 0.5, 0.56), barrel: new THREE.CylinderGeometry(0.1, 0.13, 0.6, 10), ring: new THREE.TorusGeometry(0.1, 0.035, 6, 12) }),
    [],
  );
  const stRef = useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const im = stRef.current;
    if (!im) return;
    stanchions.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [stanchions]);
  return (
    <group>
      <mesh geometry={hull} material={mats.hull} receiveShadow />
      <mesh geometry={bulwark.inner} material={mats.inner} receiveShadow />
      <mesh geometry={bulwark.cap} material={mats.cap} castShadow />
      <instancedMesh ref={stRef} args={[undefined, undefined, stanchions.length]} material={mats.post} castShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      {/* gunports, barrels and muzzle rings: three draw calls for the lot */}
      <Instances geometry={gunGeo.port} material={mats.port} matrices={guns.map((g) => M4(g.p[0] + g.s * 0.02, g.p[1], g.p[2]))} />
      <Instances geometry={gunGeo.barrel} material={mats.bronze} matrices={guns.map((g) => M4(g.p[0] + g.s * 0.3, g.p[1] + 0.02, g.p[2], 1, 1, 1, Math.PI / 2))} />
      <Instances geometry={gunGeo.ring} material={mats.bronze} matrices={guns.map((g) => M4(g.p[0] + g.s * 0.6, g.p[1] + 0.02, g.p[2], 1, 1, 1, Math.PI / 2))} />
      {eyes.map((e, i) => (
        <mesh key={i} material={mats.eye} position={e.p} rotation={e.rot}>
          <planeGeometry args={[2.4, 1.6]} />
        </mesh>
      ))}
    </group>
  );
}

/** flat deck surface at height y between stations zA < zB, following the hull's inner wall */
function deckTop(zA: number, zB: number, y: number) {
  const zs = stationList(90).filter((z) => z > zA && z < zB && hullW(z) - SHIP.wall > 0.05);
  zs.sort((a, b) => a - b);
  const ws = (z: number) => Math.max(0, hullW(z) - SHIP.wall);
  const pts: [number, number][] = [];
  pts.push([ws(zA), zA]);
  for (const z of zs) pts.push([ws(z), z]);
  pts.push([ws(zB), zB]);
  const sh = new THREE.Shape();
  sh.moveTo(-pts[0][0], -pts[0][1]);
  for (const [x, z] of pts) sh.lineTo(x, -z);
  for (const [x, z] of [...pts].reverse()) sh.lineTo(-x, -z);
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 7.5, uv.getY(i) / 13);
  return g;
}

type Seg = [[number, number, number], [number, number, number]];
/** lacquered balustrade along line segments: posts every ~0.45 m and a top rail */
function Balustrade({ segs, mat, h = 0.8 }: { segs: Seg[]; mat: THREE.Material; h?: number }) {
  const { posts, rails } = useMemo(() => {
    const posts: THREE.Vector3[] = [];
    const rails: { p: THREE.Vector3; q: THREE.Quaternion; len: number }[] = [];
    for (const [a, b] of segs) {
      const A = new THREE.Vector3(...a);
      const B = new THREE.Vector3(...b);
      const L = A.distanceTo(B);
      const n = Math.max(1, Math.round(L / 0.45));
      for (let k = 0; k <= n; k++) posts.push(A.clone().lerp(B, k / n));
      const dir = B.clone().sub(A).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      rails.push({ p: A.clone().lerp(B, 0.5).add(new THREE.Vector3(0, h, 0)), q, len: L + 0.1 });
    }
    return { posts, rails };
  }, [segs, h]);
  const ref = useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    posts.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p.x, p.y + h / 2, p.z)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [posts, h]);
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, posts.length]} material={mat} castShadow>
        <boxGeometry args={[0.07, h, 0.07]} />
      </instancedMesh>
      {rails.map((r, i) => (
        <mesh key={i} position={r.p} quaternion={r.q} material={mat} castShadow>
          <boxGeometry args={[r.len, 0.1, 0.13]} />
        </mesh>
      ))}
    </group>
  );
}

function wallMats(widthM: number, heightM: number, outward: 1 | -1, glow: number, inner: THREE.Material, plain: THREE.Material) {
  const w = castleWall(widthM, heightM, false);
  const face = new THREE.MeshStandardMaterial({ map: w.map, emissiveMap: w.emissive, emissive: new THREE.Color(glow, glow * 0.55, glow * 0.22), roughness: 0.7 });
  // box faces: +x, -x, +y, -y, +z, -z
  return [plain, plain, plain, plain, outward > 0 ? face : inner, outward > 0 ? inner : face];
}

/** the panelled inside of a cabin wall: dark wood boards and a lacquered dado */
let innerWallTex: THREE.Texture | null = null;
function innerWall() {
  if (innerWallTex) return innerWallTex;
  const rand = seeded(31);
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#3a2416';
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = `hsl(25, 35%, ${16 + rand() * 6}%)`;
    g.fillRect(x, 0, 30, 256);
    grain(g, x, 0, 30, 256, rand, 12, true);
  }
  g.fillStyle = '#5a1a12';
  g.fillRect(0, 190, 256, 66);
  g.fillStyle = '#b48a3a';
  g.fillRect(0, 188, 256, 4);
  innerWallTex = tex(c);
  innerWallTex.repeat.set(2, 1);
  return innerWallTex;
}

/** stern windows: a whole wall of glowing lattice at the back of a cabin */
function sternWindows(widthM: number, heightM: number) {
  const w = castleWall(widthM, heightM, false);
  return new THREE.MeshStandardMaterial({ map: w.map, emissiveMap: w.emissive, emissive: new THREE.Color(1.3, 0.75, 0.32), roughness: 0.7, side: THREE.DoubleSide });
}

/**
 * Everything built from SHIP_BOXES (shared with the physics, so what you see is what you bump into):
 * the decks of every storey with the cabins under them, their walls and doors, the hold and its hatch,
 * the stairs along both bulwarks, the cabin interiors and the railings.
 */
type Box = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; kind: string };
export function ShipStructure({ deckMap, boxes, deckMatRef }: { deckMap: THREE.Texture; boxes: Box[]; deckMatRef?: React.MutableRefObject<THREE.MeshStandardMaterial | null> }) {
  const L = SHIP_LAYOUT;
  const built = useMemo(() => {
    const fm = deckMap.clone();
    fm.repeat.set(1, 1);
    fm.needsUpdate = true;
    const inner = new THREE.MeshStandardMaterial({ map: innerWall(), roughness: 0.8 });
    const mats = {
      deck: new THREE.MeshStandardMaterial({ map: fm, roughness: 0.8, color: '#8c7c6c', envMapIntensity: 0.2 }),
      hold: new THREE.MeshStandardMaterial({ map: fm, roughness: 0.9, color: '#5c4c40' }),
      ceil: new THREE.MeshStandardMaterial({ color: '#2e1d12', roughness: 0.9, side: THREE.BackSide }),
      beam: new THREE.MeshStandardMaterial({ color: '#24160d', roughness: 0.85 }),
      tread: new THREE.MeshStandardMaterial({ color: '#6a462a', roughness: 0.8 }),
      lacq: new THREE.MeshStandardMaterial({ color: '#7a1e14', roughness: 0.5 }),
      gold: new THREE.MeshStandardMaterial({ color: '#b48a3a', roughness: 0.35, metalness: 0.8 }),
      wood: new THREE.MeshStandardMaterial({ color: '#4a2e1c', roughness: 0.75 }),
      iron: new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.5, metalness: 0.7 }),
      rope: new THREE.MeshStandardMaterial({ color: '#8a7350', roughness: 1 }),
      carpet: new THREE.MeshStandardMaterial({ color: '#6a1414', roughness: 1 }),
      inner,
    };
    const Wfull = (z: number) => (hullW(z) - SHIP.wall) * 2;
    const full = (b: Box) => b.x0 <= -L.W + 0.01 && b.x1 >= L.W - 0.01;
    // deck slabs: the top you walk on, its underside (the cabin ceiling) with beams, and a gilded edge on the raised decks
    const slabs = boxes
      .filter((b) => b.kind === 'slab' && full(b))
      .map((b) => {
        const zA = Math.max(b.z0, SHIP.bow + 0.05);
        const zB = Math.min(b.z1, SHIP.stern - 0.05);
        const front = b.z1 < 0 ? b.z1 : b.z0; // the edge that faces the open deck below
        return { top: deckTop(zA, zB, b.y1), under: deckTop(zA, zB, b.y0), front, raised: b.y1 > 0.5, y0: b.y0, y1: b.y1, zA, zB };
      });
    // the narrow strips of main deck either side of the hatch
    const strips = boxes.filter((b) => b.kind === 'slab' && !full(b));
    // floors laid on the filled-in hull (fore cabin, great cabin)
    const floors = boxes
      .filter((b) => b.kind === 'fill')
      .map((b) => deckTop(Math.max(b.z0, SHIP.bow + 0.05), Math.min(b.z1, SHIP.stern - 0.05), b.y1));
    const beams: { x: number; y: number; z: number; w: number }[] = [];
    for (const s of slabs)
      for (let z = s.zA + 0.6; z < s.zB - 0.3; z += 1.4) {
        const w = Wfull(z);
        if (w > 1) beams.push({ x: 0, y: s.y0 - 0.11, z, w });
      }
    // walls: cabin fronts, the hold's sides; the bow block shows only its face toward the fore cabin; the pavilion on the roof is drawn separately
    const walls = boxes.filter((b) => (b.kind === 'wall' || b.kind === 'block') && b.z0 > SHIP.bow && b.y0 < L.tiers[3].y - 0.01);
    const bowFace = boxes.find((b) => b.kind === 'block' && b.z0 <= SHIP.bow);
    const treads = boxes.filter((b) => b.kind === 'tread');
    return { mats, slabs, strips, floors, beams, walls, bowFace, treads, Wfull };
  }, [deckMap, boxes]);
  const { mats, slabs, strips, floors, beams, walls, bowFace, treads, Wfull } = built;
  const unitBox = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  React.useLayoutEffect(() => {
    if (deckMatRef) deckMatRef.current = mats.deck;
  }, [mats, deckMatRef]);
  const wallMeshes = useMemo(
    () =>
      walls.map((b) => {
        const w = b.x1 - b.x0;
        const h = b.y1 - b.y0;
        const d = b.z1 - b.z0;
        // which way the wall looks out onto open deck: the fore cabin's wall faces aft (+z), the stern tower's forward
        const outward: 1 | -1 = b.z1 <= L.fore.edge + 0.01 ? 1 : -1;
        const lintel = b.kind === 'wall' && b.x0 < 0 && b.x1 > 0; // the beam over a doorway
        const material =
          b.kind === 'block' ? [mats.inner, mats.inner, mats.lacq, mats.lacq, mats.lacq, mats.lacq] : lintel ? mats.lacq : wallMats(w, h, outward, b.y0 >= L.H - 0.01 ? 1.9 : 1.5, mats.inner, mats.lacq);
        return { pos: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2] as [number, number, number], size: [w, h, d] as [number, number, number], material };
      }),
    [walls, mats, L],
  );
  const tRef = useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const im = tRef.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    treads.forEach((b, i) => {
      m.compose(new THREE.Vector3((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2), q, new THREE.Vector3(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0 + 0.005));
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [treads]);
  // stair stringers and handrails along the open (inboard) side of each flight along the bulwarks
  const flights = useMemo(() => {
    const out: { s: number; foot: number; head: number; y0: number; rise: number }[] = [];
    for (const f of L.flights) if (f.side) for (const s of [-1, 1]) out.push({ s, foot: f.foot, head: f.head, y0: f.y0, rise: f.rise });
    return out;
  }, [L]);
  const segs = useMemo<Seg[]>(() => {
    const X = L.stairX;
    const r: Seg[] = [[[-X + 0.05, L.fore.y, L.fore.edge - 0.06], [X - 0.05, L.fore.y, L.fore.edge - 0.06]]];
    for (const t of L.tiers) r.push([[-X + 0.05, t.y, t.edge + 0.06], [X - 0.05, t.y, t.edge + 0.06]]);
    for (const f of flights) r.push([[f.s * (X - 0.04), f.y0, f.foot], [f.s * (X - 0.04), f.y0 + f.rise, f.head]]);
    return r;
  }, [L, flights]);
  // the hatch railing (its boxes are in the physics too)
  const hatchSegs = useMemo<Seg[]>(() => {
    const h = L.hold.hole;
    const x = h.x + 0.1;
    return [
      [[-x, 0, h.z1], [-x, 0, h.z0 - 0.1]],
      [[-x, 0, h.z0 - 0.1], [x, 0, h.z0 - 0.1]],
      [[x, 0, h.z0 - 0.1], [x, 0, h.z1]],
    ];
  }, [L]);
  const doors = useMemo(
    () => [{ z: L.fore.edge, y: 0, out: 1 }, ...L.tiers.map((t, i) => ({ z: t.edge, y: i === 0 ? 0 : L.tiers[i - 1].y, out: -1 }))],
    [L],
  );
  const winMats = useMemo(() => L.tiers.map(() => sternWindows(22, 3.4)), [L]);
  const hold = L.hold;
  const T = L.table;
  const back = L.sternEnd + 0.3; // the stern windows across the back of each cabin
  return (
    <group>
      {slabs.map((s, i) => (
        <group key={i}>
          <mesh geometry={s.top} material={mats.deck} receiveShadow />
          <mesh geometry={s.under} material={mats.ceil} />
          {s.raised && (
            <>
              <mesh position={[0, (s.y0 + s.y1) / 2, s.front]} material={mats.lacq} castShadow>
                <boxGeometry args={[Wfull(s.front), s.y1 - s.y0, 0.1]} />
              </mesh>
              <mesh position={[0, s.y1 - 0.02, s.front]} material={mats.gold}>
                <boxGeometry args={[Wfull(s.front), 0.05, 0.14]} />
              </mesh>
            </>
          )}
        </group>
      ))}
      {strips.map((b, i) => (
        <mesh key={i} position={[(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2]} material={mats.deck} receiveShadow>
          <boxGeometry args={[b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0]} />
        </mesh>
      ))}
      {floors.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.deck} receiveShadow />
      ))}
      <Instances geometry={unitBox} material={mats.beam} matrices={beams.map((b) => M4(b.x, b.y, b.z, b.w, 0.22, 0.2))} />
      {wallMeshes.map((w, i) => (
        <mesh key={i} position={w.pos} material={w.material} castShadow receiveShadow>
          <boxGeometry args={w.size} />
        </mesh>
      ))}
      {bowFace && (
        <mesh position={[0, (bowFace.y0 + bowFace.y1) / 2, bowFace.z1 + 0.01]} material={mats.inner}>
          <planeGeometry args={[Wfull(bowFace.z1), bowFace.y1 - bowFace.y0]} />
        </mesh>
      )}
      <instancedMesh ref={tRef} args={[undefined, undefined, treads.length]} material={mats.tread} castShadow receiveShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      {flights.map((f, i) => {
        const len = Math.hypot(f.head - f.foot, f.rise);
        const ang = Math.atan2(f.rise, f.head - f.foot);
        return (
          <mesh key={i} position={[f.s * (L.stairX - 0.04), f.y0 + f.rise / 2 - 0.12, (f.foot + f.head) / 2]} rotation={[-ang, 0, 0]} material={mats.lacq} castShadow>
            <boxGeometry args={[0.1, 0.42, len + 0.3]} />
          </mesh>
        );
      })}
      <Balustrade segs={segs} mat={mats.lacq} />
      <Balustrade segs={hatchSegs} mat={mats.lacq} h={1.0} />
      {/* door frames: gilt posts and a lantern either side of each cabin door */}
      {doors.map((d, i) => (
        <group key={i}>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (L.door + 0.06), d.y + L.lintel / 2, d.z + d.out * 0.02]} material={mats.gold} castShadow>
              <boxGeometry args={[0.12, L.lintel, 0.36]} />
            </mesh>
          ))}
          <ShipLantern position={[L.door + 0.8, d.y + 3.4, d.z + d.out * 0.4]} seed={i * 2} />
          <ShipLantern position={[-L.door - 0.8, d.y + 3.4, d.z + d.out * 0.4]} seed={i * 2 + 1} />
        </group>
      ))}

      {/* lamplight in the cabins: only the few rooms nearest the camera get a real light (each one costs every pixel) */}
      <LightPool
        anchors={[
          { p: [0, L.holdY + 2.6, T.z], i: 14, d: 16 },
          { p: [0, L.holdY + 2.6, 7], i: 8, d: 13 },
          { p: [0, 2.8, -32], i: 10, d: 13 },
          ...L.tiers.map((t, i) => {
            const y = i === 0 ? 0 : L.tiers[i - 1].y;
            const z0 = t.edge + L.wallT;
            return { p: [0, y + 2.8, (z0 + back) / 2] as [number, number, number], i: i === 0 ? 12 : 9, d: i === 0 ? 18 : 13 };
          }),
        ]}
      />
      {/* ---- the hold (-1): floor, end bulkheads, the table of food, lanterns on the beams ---- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, L.holdY + 0.005, (hold.z0 + hold.z1) / 2]} material={mats.hold} receiveShadow>
        <planeGeometry args={[hold.side * 2, hold.z1 - hold.z0]} />
      </mesh>
      {[hold.z0, hold.z1].map((z, i) => (
        <mesh key={i} position={[0, L.holdY / 2 - L.slab / 2, z + (i ? -0.01 : 0.01)]} rotation={[0, i ? Math.PI : 0, 0]} material={mats.inner}>
          <planeGeometry args={[hold.side * 2, -L.holdY - L.slab]} />
        </mesh>
      ))}
      {/* pillars holding up the main deck */}
      {[-5.2, 5.2].flatMap((x) => [-20, -12, -4, 4, 11].map((z) => (
        <mesh key={`${x}${z}`} position={[x, L.holdY / 2 - 0.2, z]} material={mats.wood} castShadow>
          <boxGeometry args={[0.32, -L.holdY - 0.4, 0.32]} />
        </mesh>
      )))}
      <FoodTable at={[T.x, L.holdY, T.z]} hx={T.hx} hz={T.hz} h={T.h} mats={mats} />
      {[[-4, T.z - 4], [4, T.z + 3], [-3, 2], [3, 9], [0, -21]].map(([x, z], i) => (
        <ShipLantern key={i} position={[x, -L.slab - 0.25, z]} seed={20 + i} glow={1.2} />
      ))}


      {/* ---- the fore cabin under the forecastle: crew quarters and an armoury rack ---- */}
      <group position={[0, 0, L.foreEnd + 0.3]}>
        {[-3.2, -2.4, -1.6, 1.6, 2.4, 3.2].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh position={[0, 1.15, 0]} material={mats.wood} castShadow>
              <cylinderGeometry args={[0.03, 0.03, 2.3, 5]} />
            </mesh>
            <mesh position={[0, 2.38, 0]} material={mats.iron}>
              <coneGeometry args={[0.06, 0.32, 5]} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.5, 0.05]} material={mats.lacq}>
          <boxGeometry args={[7.4, 0.1, 0.1]} />
        </mesh>
      </group>
      <ShipLantern position={[-4, L.fore.y - L.slab - 0.05, -30]} seed={11} />
      <ShipLantern position={[4, L.fore.y - L.slab - 0.05, -34]} seed={12} />


      {/* ---- the stern tower: a cabin on each storey with a wall of lit stern windows, carpets and lanterns ---- */}
      {L.tiers.map((t, i) => {
        const y = i === 0 ? 0 : L.tiers[i - 1].y; // this cabin's floor
        const z0 = t.edge + L.wallT;
        const zc = (z0 + back) / 2;
        const h = t.y - L.slab - y;
        return (
          <group key={i}>
            <mesh position={[0, y + h / 2, back]} rotation={[0, Math.PI, 0]} material={winMats[i]}>
              <planeGeometry args={[Wfull(back), h]} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y + 0.012, zc]} material={mats.carpet} receiveShadow>
              <planeGeometry args={[7, Math.max(2, back - z0 - 3)]} />
            </mesh>
            <ShipLantern position={[-3.5, t.y - L.slab - 0.05, zc - 1]} seed={13 + i * 2} />
            <ShipLantern position={[3.5, t.y - L.slab - 0.05, zc + 1]} seed={14 + i * 2} />

          </group>
        );
      })}
      {/* the chart table in the great cabin */}
      <group position={[5, 0, 26]}>
        <mesh position={[0, 0.8, 0]} material={mats.wood} castShadow receiveShadow>
          <cylinderGeometry args={[0.85, 0.85, 0.1, 16]} />
        </mesh>
        <mesh position={[0, 0.4, 0]} material={mats.lacq}>
          <cylinderGeometry args={[0.16, 0.26, 0.8, 8]} />
        </mesh>
        <mesh position={[0.1, 0.86, 0.05]} rotation={[-Math.PI / 2, 0, 0.3]}>
          <planeGeometry args={[0.9, 0.6]} />
          <meshStandardMaterial color="#d8c8a0" roughness={1} />
        </mesh>
      </group>
      {/* windlass and the anchor out at the bow */}
      <group position={[0, L.fore.y, -39.2]}>
        {[-1.4, 1.4].map((x) => (
          <mesh key={x} position={[x, 0.45, 0]} material={mats.wood} castShadow>
            <boxGeometry args={[0.26, 0.9, 0.5]} />
          </mesh>
        ))}
        <mesh position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.wood} castShadow>
          <cylinderGeometry args={[0.24, 0.24, 2.6, 10]} />
        </mesh>
        <mesh position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.rope}>
          <cylinderGeometry args={[0.32, 0.32, 1.2, 12]} />
        </mesh>
      </group>
      <group position={[hullW(-44) + 0.4, 5.6, -44]} rotation={[0, 0.5, 0.06]}>
        <mesh material={mats.iron} position={[0, -0.8, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 2.8, 6]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} material={mats.iron} position={[s * 0.45, -2.1, 0]} rotation={[0, 0, s * 0.9]}>
            <coneGeometry args={[0.1, 1.1, 5]} />
          </mesh>
        ))}
      </group>
      <mesh position={[0, sheer(SHIP.bow) + 0.6, SHIP.bow - 2.2]} rotation={[-1.15, 0, 0]} material={mats.wood} castShadow>
        <cylinderGeometry args={[0.16, 0.32, 8, 8]} />
      </mesh>
    </group>
  );
}

/** a few point lights that move to whichever lamp anchors are nearest the camera (and fade as they change) */
function LightPool({ anchors, count = 3 }: { anchors: { p: [number, number, number]; i: number; d: number }[]; count?: number }) {
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  const cur = useRef<number[]>([]);
  useFrame((st, dt) => {
    const c = st.camera.position;
    const order = anchors
      .map((a, k) => ({ k, d: Math.hypot(a.p[0] - c.x, (a.p[1] - c.y) * 2.5, a.p[2] - c.z) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, count)
      .map((e) => e.k);
    lights.current.forEach((l, n) => {
      if (!l) return;
      const want = order[n];
      if (cur.current[n] !== want) {
        // fade out, then jump to the new lamp
        l.intensity = Math.max(0, l.intensity - dt * 60);
        if (l.intensity <= 0.01) {
          cur.current[n] = want;
          const a = anchors[want];
          l.position.set(a.p[0], a.p[1], a.p[2]);
          l.distance = a.d;
        }
        return;
      }
      const a = anchors[want];
      l.intensity = Math.min(a.i, l.intensity + dt * 30);
    });
  });
  return (
    <>
      {Array.from({ length: count }, (_, n) => (
        <pointLight key={n} ref={(el) => (lights.current[n] = el)} color="#ffa458" intensity={0} distance={14} decay={1.4} />
      ))}
    </>
  );
}

/** the table of food in the hold: a long lacquered table set with bowls, a whole fish, buns, a roast and wine jars */
function FoodTable({ at, hx, hz, h, mats }: { at: [number, number, number]; hx: number; hz: number; h: number; mats: Record<string, THREE.Material> }) {
  const dish = useMemo(
    () => ({
      plate: new THREE.MeshStandardMaterial({ color: '#e8e2d4', roughness: 0.35 }),
      blue: new THREE.MeshStandardMaterial({ color: '#2a4a8a', roughness: 0.4 }),
      bun: new THREE.MeshStandardMaterial({ color: '#f2e6cc', roughness: 0.9 }),
      roast: new THREE.MeshStandardMaterial({ color: '#7a3a14', roughness: 0.55 }),
      fish: new THREE.MeshStandardMaterial({ color: '#b86a2a', roughness: 0.5 }),
      greens: new THREE.MeshStandardMaterial({ color: '#3f7a2a', roughness: 0.8 }),
      jar: new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.6 }),
      steam: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false }),
    }),
    [],
  );
  const steam = useRef<THREE.Group>(null);
  useFrame((st) => {
    const g = steam.current;
    if (!g) return;
    const t = st.clock.elapsedTime;
    g.children.forEach((m, i) => {
      const k = (t * 0.35 + i / g.children.length) % 1;
      m.position.y = h + 0.25 + k * 0.9;
      m.scale.setScalar(0.12 + k * 0.3);
      ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.14 * (1 - k);
    });
  });
  const top = h;
  return (
    <group position={at}>
      <mesh position={[0, top - 0.06, 0]} material={mats.lacq} castShadow receiveShadow>
        <boxGeometry args={[hx * 2, 0.12, hz * 2]} />
      </mesh>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} position={[sx * (hx - 0.15), (top - 0.12) / 2, sz * (hz - 0.15)]} material={mats.wood}>
          <boxGeometry args={[0.14, top - 0.12, 0.14]} />
        </mesh>
      )))}
      {/* benches */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0.24, s * (hz + 0.55)]} material={mats.wood} castShadow>
          <boxGeometry args={[hx * 1.8, 0.08, 0.36]} />
        </mesh>
      ))}
      {/* the whole fish on a long plate */}
      <mesh position={[0, top + 0.02, 0]} scale={[1, 0.18, 0.45]} material={dish.plate}>
        <cylinderGeometry args={[0.55, 0.55, 0.12, 20]} />
      </mesh>
      <mesh position={[0, top + 0.1, 0]} scale={[1, 0.32, 0.36]} material={dish.fish}>
        <sphereGeometry args={[0.45, 14, 8]} />
      </mesh>
      {/* a roast on a platter */}
      <mesh position={[-1.25, top + 0.03, 0.15]} material={dish.plate}>
        <cylinderGeometry args={[0.36, 0.3, 0.06, 18]} />
      </mesh>
      <mesh position={[-1.25, top + 0.17, 0.15]} scale={[1.3, 0.8, 1]} material={dish.roast}>
        <sphereGeometry args={[0.2, 12, 8]} />
      </mesh>
      {/* steamed buns */}
      <mesh position={[1.25, top + 0.03, -0.2]} material={dish.blue}>
        <cylinderGeometry args={[0.34, 0.28, 0.08, 18]} />
      </mesh>
      {[[0, 0], [0.16, 0.1], [-0.15, 0.08], [0.02, -0.16], [0.05, 0.02]].map(([x, z], i) => (
        <mesh key={i} position={[1.25 + x, top + 0.13 + (i === 4 ? 0.1 : 0), -0.2 + z]} scale={[1, 0.75, 1]} material={dish.bun}>
          <sphereGeometry args={[0.11, 10, 8]} />
        </mesh>
      ))}
      {/* bowls of greens and rice, chopsticks, wine jars */}
      {[[-0.6, -0.75], [0.6, -0.75], [-0.6, 0.75], [0.6, 0.75], [1.6, 0.6], [-1.7, -0.6]].map(([x, z], i) => (
        <group key={i} position={[x, top, z]}>
          <mesh position={[0, 0.06, 0]} material={i % 2 ? dish.blue : dish.plate}>
            <cylinderGeometry args={[0.13, 0.08, 0.12, 14]} />
          </mesh>
          <mesh position={[0, 0.11, 0]} scale={[1, 0.4, 1]} material={i % 3 === 0 ? dish.greens : dish.bun}>
            <sphereGeometry args={[0.11, 10, 6]} />
          </mesh>
          <mesh position={[0.17, 0.015, 0]} rotation={[0, 0.2, Math.PI / 2]} material={mats.wood}>
            <cylinderGeometry args={[0.008, 0.008, 0.3, 4]} />
          </mesh>
        </group>
      ))}
      {[[-hx + 0.3, -hz + 0.3], [hx - 0.3, hz - 0.3]].map(([x, z], i) => (
        <mesh key={i} position={[x, top + 0.2, z]} scale={[1, 1.25, 1]} material={dish.jar}>
          <sphereGeometry args={[0.17, 12, 10]} />
        </mesh>
      ))}
      <group ref={steam}>
        {[[0, 0], [1.25, -0.2], [-1.25, 0.15], [0.3, 0.05], [1.2, -0.1], [-1.2, 0.2]].map(([x, z], i) => (
          <mesh key={i} position={[x, top + 0.3, z]} material={dish.steam.clone()}>
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * 床弩: a mounted crossbow on a swivel post. Reads its aim, reload and recoil from mapRuntime every frame:
 * the limbs flex as the winch draws the string back, the bolt glows when it's loaded, and it bucks on release.
 */
export function Ballista({ k, at, rt }: { k: number; at: { x: number; y: number; z: number; yaw: number }; rt: { ballistae: { yaw: number; user: number; load: number; kick: number }[] } }) {
  const turret = useRef<THREE.Group>(null);
  const limbs = useRef<(THREE.Group | null)[]>([]);
  const nut = useRef<THREE.Group>(null);
  const bolt = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Mesh>(null);
  const strL = useRef<THREE.Mesh>(null);
  const strR = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const mats = useMemo(
    () => ({
      wood: new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: '#2a1a10', roughness: 0.8 }),
      lacq: new THREE.MeshStandardMaterial({ color: '#7a1e14', roughness: 0.45 }),
      bronze: new THREE.MeshStandardMaterial({ color: '#9a7a38', roughness: 0.35, metalness: 0.85 }),
      string: new THREE.MeshBasicMaterial({ color: '#e8dcc0' }),
      head: new THREE.MeshStandardMaterial({ color: '#c8d8e0', roughness: 0.25, metalness: 0.9, emissive: new THREE.Color('#1aa6c4'), emissiveIntensity: 0.6 }),
      glow: new THREE.SpriteMaterial({ map: glowTexture(), color: '#67e8f9', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    }),
    [],
  );
  const limbGeo = useMemo(() => {
    // a recurved limb: a tapered curve from the stock out to the tip
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, 0, 0.12), new THREE.Vector3(1.0, 0, 0.1), new THREE.Vector3(1.35, 0, -0.12)];
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.06, 6, false);
  }, []);
  useFrame((_, dt) => {
    const st = rt.ballistae[k] ?? { yaw: at.yaw, user: -1, load: 1, kick: 0 };
    const draw = st.load >= 1 ? 1 : st.load * 0.9; // the winch winds the string back as it reloads
    if (turret.current) {
      turret.current.rotation.y = st.yaw;
      turret.current.position.z = 0;
      turret.current.children[0].position.z = st.kick * 0.28;
      turret.current.children[0].rotation.x = st.kick * 0.12;
    }
    const flex = 0.05 + draw * 0.32 - st.kick * 0.15;
    limbs.current.forEach((l, i) => {
      if (l) l.rotation.y = (i ? -1 : 1) * flex;
    });
    const nz = -0.55 + draw * 0.95;
    if (nut.current) nut.current.position.z = nz;
    // the string runs from each limb tip to the nut
    for (const [ref, s] of [[strL, -1], [strR, 1]] as const) {
      const m = ref.current;
      if (!m) continue;
      const a = s * flex;
      const tip = new THREE.Vector3(s * 1.35, 0.12, -0.75 - 0.12).sub(new THREE.Vector3(0, 0.12, -0.75)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -a).add(new THREE.Vector3(0, 0.12, -0.75));
      const end = new THREE.Vector3(0, 0.12, nz);
      m.position.copy(tip).add(end).multiplyScalar(0.5);
      m.scale.set(1, tip.distanceTo(end), 1);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(tip).normalize());
    }
    if (bolt.current) {
      bolt.current.visible = st.load >= 1;
      bolt.current.position.z = nz - 1.0;
    }
    if (glow.current) {
      const t = performance.now() / 1000;
      (glow.current.material as THREE.SpriteMaterial).opacity = st.load >= 1 ? 0.55 + Math.sin(t * 6) * 0.2 : 0;
      glow.current.position.z = nz - 2.05;
    }
    if (wheel.current && st.load < 1) wheel.current.rotation.x += dt * 9;
  });
  return (
    <group position={[at.x, at.y, at.z]}>
      {/* swivel post */}
      <mesh position={[0, 0.42, 0]} material={mats.dark} castShadow>
        <cylinderGeometry args={[0.32, 0.46, 0.84, 8]} />
      </mesh>
      <mesh position={[0, 0.86, 0]} material={mats.bronze}>
        <cylinderGeometry args={[0.36, 0.36, 0.06, 12]} />
      </mesh>
      <group ref={turret} position={[0, 0.95, 0]}>
        <group>
          {/* stock along -z (forward), trigger frame and winch at the back */}
          <mesh position={[0, 0.06, -0.4]} material={mats.wood} castShadow>
            <boxGeometry args={[0.3, 0.16, 2.4]} />
          </mesh>
          <mesh position={[0, -0.12, 0.3]} material={mats.lacq} castShadow>
            <boxGeometry args={[0.5, 0.22, 0.5]} />
          </mesh>
          <mesh ref={wheel} position={[0, 0.0, 0.75]} rotation={[0, 0, Math.PI / 2]} material={mats.dark}>
            <cylinderGeometry args={[0.2, 0.2, 0.55, 8]} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.42, 0, 0.75]} rotation={[0, 0, Math.PI / 2]} material={mats.bronze}>
              <torusGeometry args={[0.18, 0.025, 4, 10]} />
            </mesh>
          ))}
          {/* the bow: two limbs from a bronze-bound bowhead, double-stacked like a 三弓床弩 */}
          <mesh position={[0, 0.12, -0.75]} material={mats.bronze} castShadow>
            <boxGeometry args={[0.42, 0.3, 0.3]} />
          </mesh>
          {[-1, 1].map((s, i) => (
            <group key={s} ref={(g) => (limbs.current[i] = g)} position={[0, 0.12, -0.75]}>
              <mesh geometry={limbGeo} material={mats.lacq} scale={[s, 1, 1]} castShadow />
              <mesh geometry={limbGeo} material={mats.wood} scale={[s * 0.82, 1, 0.9]} position={[0, -0.12, 0.12]} />
            </group>
          ))}
          <mesh ref={strL} material={mats.string}>
            <cylinderGeometry args={[0.012, 0.012, 1, 4]} />
          </mesh>
          <mesh ref={strR} material={mats.string}>
            <cylinderGeometry args={[0.012, 0.012, 1, 4]} />
          </mesh>
          <group ref={nut}>
            <mesh position={[0, 0.12, 0]} material={mats.bronze}>
              <boxGeometry args={[0.16, 0.1, 0.12]} />
            </mesh>
          </group>
          {/* the loaded bolt: a spear-sized shaft with a glowing iron head */}
          <group ref={bolt} position={[0, 0.2, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} material={mats.wood}>
              <cylinderGeometry args={[0.035, 0.035, 2.0, 6]} />
            </mesh>
            <mesh position={[0, 0, -1.08]} rotation={[-Math.PI / 2, 0, 0]} material={mats.head}>
              <coneGeometry args={[0.08, 0.32, 6]} />
            </mesh>
            {[0, 1].map((r) => (
              <mesh key={r} position={[0, 0, 0.85]} rotation={[0, 0, (r * Math.PI) / 2]} material={mats.lacq}>
                <boxGeometry args={[0.24, 0.01, 0.3]} />
              </mesh>
            ))}
          </group>
          <sprite ref={glow} material={mats.glow} position={[0, 0.2, -1.6]} scale={[0.9, 0.9, 1]} />
        </group>
      </group>
    </group>
  );
}

/** the bolts in flight (a streak of cyan light behind them) and the ones quivering in the planks */
export function Bolts({ rt }: { rt: { bolts: { x: number; y: number; z: number; vx: number; vy: number; vz: number; t: number; stuck: boolean }[] } }) {
  const N = 8;
  const refs = useRef<(THREE.Group | null)[]>([]);
  const mats = useMemo(
    () => ({
      shaft: new THREE.MeshStandardMaterial({ color: '#5a3820', roughness: 0.7 }),
      head: new THREE.MeshStandardMaterial({ color: '#c8d8e0', roughness: 0.25, metalness: 0.9, emissive: new THREE.Color('#1aa6c4'), emissiveIntensity: 0.8 }),
      fletch: new THREE.MeshStandardMaterial({ color: '#7a1e14', roughness: 0.6, side: THREE.DoubleSide }),
      streak: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 2.0), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    }),
    [],
  );
  const fwd = new THREE.Vector3();
  useFrame(() => {
    const t = performance.now() / 1000;
    for (let i = 0; i < N; i++) {
      const g = refs.current[i];
      if (!g) continue;
      const b = rt.bolts[i];
      if (!b) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      g.position.set(b.x, b.y, b.z);
      fwd.set(b.vx, b.vy, b.vz);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), fwd);
      if (b.stuck) {
        // quiver as it settles into the wood
        const w = Math.max(0, b.t - 1.8) * 0.06;
        g.rotateX(Math.sin(t * 40) * w);
      }
      const streak = g.children[3];
      if (streak) streak.visible = !b.stuck;
    }
  });
  return (
    <group>
      {Array.from({ length: N }, (_, i) => (
        <group key={i} ref={(g) => (refs.current[i] = g)} visible={false}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.6]} material={mats.shaft}>
            <cylinderGeometry args={[0.04, 0.04, 2.0, 6]} />
          </mesh>
          <mesh position={[0, 0, -0.5]} rotation={[-Math.PI / 2, 0, 0]} material={mats.head}>
            <coneGeometry args={[0.09, 0.36, 6]} />
          </mesh>
          <mesh position={[0, 0, 1.45]} material={mats.fletch}>
            <boxGeometry args={[0.26, 0.01, 0.3]} />
          </mesh>
          <mesh position={[0, 0, 3.0]} rotation={[Math.PI / 2, 0, 0]} material={mats.streak}>
            <cylinderGeometry args={[0.09, 0.0, 4.0, 6, 1, true]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Chinese hipped roof with swept-up corners */
function hipRoof(w: number, d: number, rise: number, ridge: number, sweep: number) {
  const g = new THREE.BufferGeometry();
  const hw = w / 2;
  const hd = d / 2;
  const rr = ridge / 2;
  const c = (x: number, z: number) => [x, sweep, z];
  const P = [c(-hw, -hd), c(hw, -hd), c(hw, hd), c(-hw, hd), [-rr, rise, 0], [rr, rise, 0]];
  const M = [[0, 0, -hd], [hw, 0, 0], [0, 0, hd], [-hw, 0, 0]];
  const pos: number[] = [];
  const tri = (a: number[], b: number[], cc: number[]) => pos.push(...a, ...b, ...cc);
  tri(P[3], M[2], P[4]);
  tri(M[2], P[5], P[4]);
  tri(M[2], P[2], P[5]);
  tri(P[1], M[0], P[5]);
  tri(M[0], P[4], P[5]);
  tri(M[0], P[0], P[4]);
  tri(P[0], M[3], P[4]);
  tri(M[3], P[3], P[4]);
  tri(P[2], M[1], P[5]);
  tri(M[1], P[1], P[5]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** two-storey stern castle with a gallery, a tiled hip roof, the great rudder and stern lanterns */
export function SternCastle({ base }: { base: number }) {
  const P = SHIP_LAYOUT.pavilion;
  const z0 = P.z0;
  const z1 = P.z1;
  const W1 = P.hw;
  const W2 = 6.0;
  const H1 = P.h;
  const H2 = 2.2;
  const { mats, roof, lowRoof, bal } = useMemo(() => {
    const w1 = castleWall(W1 * 2, H1, true);
    const w2 = castleWall(W2 * 2, H2, false);
    const side = castleWall(z1 - z0, H1, false);
    const mk = (w: { map: THREE.Texture; emissive: THREE.Texture }, k = 1.6) =>
      new THREE.MeshStandardMaterial({ map: w.map, emissiveMap: w.emissive, emissive: new THREE.Color(k, k * 0.55, k * 0.22), roughness: 0.7 });
    const mats = {
      front1: mk(w1),
      front2: mk(w2, 1.9),
      side: mk(side, 1.2),
      plain: new THREE.MeshStandardMaterial({ color: '#4a1c12', roughness: 0.7 }),
      roof: new THREE.MeshStandardMaterial({ color: '#1e2628', roughness: 0.55, metalness: 0.15, flatShading: true, side: THREE.DoubleSide }),
      ridge: new THREE.MeshStandardMaterial({ color: '#2a3234', roughness: 0.5 }),
      gold: new THREE.MeshStandardMaterial({ color: '#b48a3a', roughness: 0.35, metalness: 0.8 }),
      lacq: new THREE.MeshStandardMaterial({ color: '#6a1a12', roughness: 0.5 }),
      wood: new THREE.MeshStandardMaterial({ color: '#3a2416', roughness: 0.8 }),
      floor: new THREE.MeshStandardMaterial({ color: '#4a3020', roughness: 0.8 }),
    };
    const b: number[] = [];
    for (let x = -W1 + 0.3; x <= W1 - 0.3; x += 0.4) b.push(x);
    return {
      mats,
      roof: hipRoof(W2 * 2 + 2.4, z1 - z0 + 0.6, 1.9, W2 * 2 - 2.2, 0.55),
      lowRoof: hipRoof(W1 * 2 + 1.4, z1 - z0 + 1.6, 0.9, W1 * 2 - 1.0, 0.4),
      bal: b,
    };
  }, []);
  const balRef = useRef<THREE.InstancedMesh>(null);
  React.useLayoutEffect(() => {
    const im = balRef.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    bal.forEach((x, i) => im.setMatrixAt(i, m.makeTranslation(x, H1 + 0.42, z0 - 0.25)));
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  }, [bal]);
  const zc = (z0 + z1) / 2;
  const zc2 = z0 + 0.9 + (z1 - z0 - 0.9) / 2;
  return (
    <group>
      <group position={[0, base, 0]}>
      {/* lower storey */}
      <mesh position={[0, H1 / 2, zc]} castShadow receiveShadow material={[mats.plain, mats.plain, mats.plain, mats.plain, mats.plain, mats.front1]}>
        {/* box faces: +x, -x, +y, -y, +z, -z; the deck side is -z */}
        <boxGeometry args={[W1 * 2, H1, z1 - z0]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (W1 + 0.005), H1 / 2, zc]} rotation={[0, s * Math.PI / 2, 0]} material={mats.side}>
          <planeGeometry args={[z1 - z0, H1]} />
        </mesh>
      ))}
      {/* gallery floor and its balustrade */}
      <mesh position={[0, H1 + 0.08, zc - 0.2]} material={mats.floor} castShadow receiveShadow>
        <boxGeometry args={[W1 * 2 + 0.3, 0.16, z1 - z0 + 0.8]} />
      </mesh>
      <mesh position={[0, H1 + 0.02, z0 - 0.62]} material={mats.gold}>
        <boxGeometry args={[W1 * 2 + 0.34, 0.06, 0.06]} />
      </mesh>
      <instancedMesh ref={balRef} args={[undefined, undefined, bal.length]} material={mats.lacq} castShadow>
        <boxGeometry args={[0.07, 0.5, 0.07]} />
      </instancedMesh>
      <mesh position={[0, H1 + 0.7, z0 - 0.25]} material={mats.lacq} castShadow>
        <boxGeometry args={[W1 * 2 - 0.4, 0.09, 0.12]} />
      </mesh>
      {/* a skirt of eaves over the lower storey */}
      <mesh geometry={lowRoof} position={[0, H1 - 0.55, zc]} material={mats.roof} castShadow />
      {/* upper storey */}
      <mesh position={[0, H1 + 0.16 + H2 / 2, zc2]} castShadow material={[mats.plain, mats.plain, mats.plain, mats.plain, mats.plain, mats.front2]}>
        <boxGeometry args={[W2 * 2, H2, z1 - z0 - 0.9]} />
      </mesh>
      {/* the main roof, ridge and its fish-tail finials */}
      <group position={[0, H1 + 0.16 + H2 - 0.1, zc2]}>
        <mesh geometry={roof} material={mats.roof} castShadow />
        <mesh position={[0, 1.95, 0]} rotation={[0, 0, Math.PI / 2]} material={mats.ridge}>
          <cylinderGeometry args={[0.13, 0.13, W2 * 2 - 2.0, 8]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (W2 - 1.0), 2.3, 0]} rotation={[0, 0, -s * 0.35]} material={mats.ridge}>
            <coneGeometry args={[0.2, 0.8, 6]} />
          </mesh>
        ))}
        {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[sx * (W2 + 1.15), 0.62, sz * ((z1 - z0 + 0.6) / 2 - 0.05)]} material={mats.gold}>
            <sphereGeometry args={[0.1, 8, 6]} />
          </mesh>
        )))}
      </group>
      </group>
      {/* the great rudder hanging off the transom */}
      <group position={[0, 0, SHIP.stern + 0.3]}>
        <mesh position={[0, -1.0, 0.1]} material={mats.wood} castShadow>
          <cylinderGeometry args={[0.3, 0.3, 16, 8]} />
        </mesh>
        <mesh position={[0, -6.6, 2.0]} material={mats.wood} castShadow>
          <boxGeometry args={[0.4, 5.6, 4.0]} />
        </mesh>
        <mesh position={[0, 6.2, -0.7]} rotation={[Math.PI / 2, 0, 0]} material={mats.wood}>
          <cylinderGeometry args={[0.08, 0.1, 1.8, 6]} />
        </mesh>
      </group>
    </group>
  );
}

/** hanging paper lantern on a short pole; emissive with a soft glow sprite (no light of its own) */
/** shared bits of every hanging lantern (one geometry / material each, however many lanterns) */
let lanternKit: { cord: THREE.BufferGeometry; body: THREE.BufferGeometry; cordMat: THREE.Material; bodyMat: THREE.Material } | null = null;
function lantern() {
  if (lanternKit) return lanternKit;
  const body = new THREE.SphereGeometry(0.24, 12, 8);
  body.scale(1, 1.2, 1);
  lanternKit = {
    cord: new THREE.CylinderGeometry(0.01, 0.01, 0.4, 3),
    body,
    cordMat: new THREE.MeshBasicMaterial({ color: '#222' }),
    bodyMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.26, 0.08), toneMapped: false }),
  };
  return lanternKit;
}
/** hanging paper lantern on a short cord; emissive with a soft glow sprite (no light of its own) */
export function ShipLantern({ position, glow = 1, seed = 0 }: { position: [number, number, number]; glow?: number; seed?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (ref.current) {
      const t = st.clock.elapsedTime;
      ref.current.rotation.z = Math.sin(t * 1.4 + seed) * 0.16;
      ref.current.rotation.x = Math.sin(t * 1.1 + seed * 1.7) * 0.08;
    }
  });
  const kit = lantern();
  const spr = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9a50', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32 * glow }), [glow]);
  return (
    <group position={position}>
      <group ref={ref}>
        <mesh geometry={kit.cord} material={kit.cordMat} position={[0, -0.2, 0]} />
        <mesh geometry={kit.body} material={kit.bodyMat} position={[0, -0.62, 0]} />
        <sprite material={spr} position={[0, -0.62, 0]} scale={[1.2, 1.2, 1]} />
      </group>
    </group>
  );
}

/** lantern posts standing on the cap rail, the lantern hanging off a little arm over the deck */
export function RailLanterns() {
  const list = useMemo(() => {
    const out: { x: number; z: number; s: number }[] = [];
    for (const z of [-37, -20, -4, 10, 25.5, 37.5]) for (const s of [1, -1]) out.push({ x: s * (hullW(z) - 0.12), z, s });
    return out;
  }, []);
  return (
    <group>
      {list.map((l, i) => {
        const y = sheer(l.z);
        return (
          <group key={i} position={[l.x, y, l.z]}>
            <mesh position={[0, 0.7, 0]}>
              <cylinderGeometry args={[0.04, 0.05, 1.4, 6]} />
              <meshStandardMaterial color="#2a1810" roughness={0.7} />
            </mesh>
            <mesh position={[-l.s * 0.25, 1.36, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.03, 0.03, 0.55, 5]} />
              <meshStandardMaterial color="#2a1810" roughness={0.7} />
            </mesh>
            <ShipLantern position={[-l.s * 0.48, 1.36, 0]} seed={i * 1.3} />
          </group>
        );
      })}
    </group>
  );
}

/** battened junk sail with a cloth texture */
export function JunkSail({ width, height, y, seed = 3 }: { width: number; height: number; y: number; seed?: number }) {
  const { cloth, ribs, mat } = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, 12, 14);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5;
      const v = pos.getY(i) + 0.5;
      const w = width * (0.82 + 0.18 * v);
      pos.setX(i, (u - 0.5) * w + (1 - v) * width * 0.08);
      pos.setY(i, (v - 0.5) * height);
      // belly between the battens and an overall curve, deeper at the foot
      pos.setZ(i, Math.sin(u * Math.PI) * (0.5 + 0.25 * (1 - v)) + Math.abs(Math.sin(v * Math.PI * 6)) * 0.1);
    }
    g.computeVertexNormals();
    const rib: number[] = [];
    for (let k = 0; k <= 6; k++) rib.push(-height / 2 + (k / 6) * height);
    const mat = new THREE.MeshStandardMaterial({ map: sailTexture(seed), roughness: 0.95, side: THREE.DoubleSide });
    return { cloth: g, ribs: rib, mat };
  }, [width, height, seed]);
  return (
    <group position={[0, y, 0.35]}>
      <mesh geometry={cloth} material={mat} castShadow />
      {ribs.map((ry, k) => {
        const v = (ry + height / 2) / height;
        const w = width * (0.82 + 0.18 * v);
        return (
          <mesh key={k} position={[(1 - v) * width * 0.08, ry, 0.12 + Math.abs(Math.sin(v * Math.PI * 6)) * 0.1]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.055, 0.055, w + 0.3, 6]} />
            <meshStandardMaterial color="#2b1d12" roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

/** a mast: tapered, iron-banded, with a collar at the deck and a truck at the head */
export function Mast({ r, h }: { r: number; h: number }) {
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[r * 0.5, r, h, 14]} />
        <meshStandardMaterial color="#4a2e1c" roughness={0.75} />
      </mesh>
      {Array.from({ length: 7 }, (_, k) => {
        const y = 0.8 + k * 1.1;
        const rr = r * (1 - (y / h) * 0.5) + 0.02;
        return (
          <mesh key={k} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[rr, 0.035, 6, 16]} />
            <meshStandardMaterial color="#26221e" metalness={0.7} roughness={0.5} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[r + 0.22, r + 0.3, 0.28, 8]} />
        <meshStandardMaterial color="#3a2416" roughness={0.8} />
      </mesh>
      <mesh position={[0, h + 0.1, 0]}>
        <cylinderGeometry args={[0.2, 0.16, 0.25, 8]} />
        <meshStandardMaterial color="#b48a3a" metalness={0.8} roughness={0.35} />
      </mesh>
    </group>
  );
}

/** coiled rope lying flat on the deck */
export function RopeCoil({ position, r = 0.42 }: { position: [number, number, number]; r?: number }) {
  return (
    <group position={position}>
      {[0, 1, 2].map((k) => (
        <mesh key={k} position={[0, 0.04 + k * 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
          <torusGeometry args={[r - k * 0.09, 0.04, 6, 20]} />
          <meshStandardMaterial color="#8a7350" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

/** a flush cargo hatch grating */
export function HatchGrate({ position, w, d }: { position: [number, number, number]; w: number; d: number }) {
  const t = useMemo(() => {
    const { c, g } = canvas(128, 128);
    g.fillStyle = '#4a3220';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#070503';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.fillRect(x * 16 + 4, y * 16 + 4, 9, 9);
    const tx = tex(c);
    tx.repeat.set(w / 1, d / 1);
    return tx;
  }, [w, d]);
  return (
    <group position={position}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={t} roughness={0.85} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={'x' + s} position={[s * (w / 2 + 0.06), 0.03, 0]}>
          <boxGeometry args={[0.12, 0.06, d + 0.24]} />
          <meshStandardMaterial color="#3a2416" roughness={0.8} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={'z' + s} position={[0, 0.03, s * (d / 2 + 0.06)]}>
          <boxGeometry args={[w, 0.06, 0.12]} />
          <meshStandardMaterial color="#3a2416" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

let distantHull: THREE.BufferGeometry | null = null;
/** a far-off war junk: the same hull shape at low detail, battened sail silhouettes, lit stern windows; optionally burning */
export function DistantJunk({ position, rot, scale = 1, burning = false }: { position: [number, number, number]; rot: number; scale?: number; burning?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const fire = useRef<THREE.Group>(null);
  const geo = useMemo(() => (distantHull ??= buildHullGeometry(24)), []);
  const sail = useMemo(() => {
    const sh = new THREE.Shape();
    sh.moveTo(-2.4, 0);
    sh.lineTo(2.4, 0);
    sh.lineTo(3.0, 7);
    sh.quadraticCurveTo(0, 8.2, -2.6, 7.2);
    sh.closePath();
    return new THREE.ShapeGeometry(sh);
  }, []);
  const fireMat = useMemo(() => new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff7a30', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime + position[0];
    if (ref.current) {
      ref.current.position.y = position[1] + Math.sin(t * 0.8) * 0.4;
      ref.current.rotation.z = Math.sin(t * 0.6) * 0.04;
    }
    if (fire.current)
      fire.current.children.forEach((c, i) => {
        const k = 1 + Math.sin(t * (6 + i) + i * 2.1) * 0.25 + Math.sin(t * 13.7 + i) * 0.1;
        c.scale.set(5 * k, 6 * k, 1);
      });
  });
  const dark = '#0a0f14';
  return (
    <group ref={ref} position={position} rotation={[0, rot, 0]} scale={scale}>
      <mesh geometry={geo}>
        <meshBasicMaterial color={dark} side={THREE.DoubleSide} />
      </mesh>
      {[-8, 6].map((z, i) => (
        <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 7, 0]}>
            <cylinderGeometry args={[0.2, 0.35, 14, 6]} />
            <meshBasicMaterial color={dark} />
          </mesh>
          <mesh geometry={sail} position={[0, 5 + i * 0.5, 0.3]} scale={1.3}>
            <meshBasicMaterial color={burning && i ? '#1c0c06' : '#121820'} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {[-3.5, 0, 3.5].map((x) => (
        <mesh key={x} position={[x, 6.4, 29.15]}>
          <planeGeometry args={[1.4, 0.8]} />
          <meshBasicMaterial color={new THREE.Color(2.6, 1.3, 0.45)} toneMapped={false} />
        </mesh>
      ))}
      {burning && (
        <group ref={fire} position={[0, 4, 4]}>
          {[[0, 0, 0], [1.5, 2, 2], [-1.2, 4, -1], [0.5, 1, 6], [-0.8, 6, 3]].map((p, i) => (
            <sprite key={i} material={fireMat} position={p as [number, number, number]} />
          ))}
        </group>
      )}
    </group>
  );
}
