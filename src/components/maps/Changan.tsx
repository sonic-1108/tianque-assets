import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { ROOF, Hall, hallHeight, roofHeight, mapRuntime } from '../../maps';
import { GLSL_NOISE, seeded } from '../Scenery';

// ==================================================================
// 长安上元夜: the roofs of a Tang palace compound on the night of the
// Lantern Festival. Every surface the fighters stand on is generated
// from the same hallHeight() the physics uses, so feet never sink.
// ==================================================================

const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------
// procedural textures
// ---------------------------------------------------------------
function dataTex(data: Uint8Array, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Normal map from a height field (Sobel) */
function normalFromHeight(H: Float32Array, n: number, strength: number) {
  const out = new Uint8Array(n * n * 4);
  const at = (x: number, y: number) => H[((y + n) % n) * n + ((x + n) % n)];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * n + x) * 4;
      out[i] = (-dx / l) * 127 + 128;
      out[i + 1] = (dy / l) * 127 + 128;
      out[i + 2] = (1 / l) * 127 + 128;
      out[i + 3] = 255;
    }
  return out;
}

/**
 * 青瓦: rows of round cover tiles (筒瓦) over wide concave pan tiles (板瓦), one course per texture height.
 * Channels run down the slope (texture v); u runs along the eave.
 */
let tileCache: { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } | null = null;
function tileTextures() {
  if (tileCache) return tileCache;
  const n = 256;
  const H = new Float32Array(n * n);
  const col = new Uint8Array(n * n * 4);
  const rough = new Uint8Array(n * n * 4);
  const rand = seeded(7);
  const shade: number[] = [];
  for (let k = 0; k < 16; k++) shade.push(0.82 + rand() * 0.3);
  for (let y = 0; y < n; y++) {
    const fy = y / n; // 0 top of the course .. 1 bottom (where it overlaps the next one)
    for (let x = 0; x < n; x++) {
      const fx = x / n;
      // one cover tile channel (width 0.32) and one pan (0.68) per texture width
      let h: number;
      let isCover = false;
      if (fx < 0.32) {
        const d = (fx - 0.16) / 0.16;
        h = 0.55 + Math.sqrt(Math.max(0, 1 - d * d)) * 0.75;
        isCover = true;
      } else {
        const d = (fx - 0.66) / 0.34;
        h = 0.1 + d * d * 0.45;
      }
      // each tile thickens toward its lower lip, with a dark seam where the next course starts
      h += fy * 0.18;
      const seam = fy < 0.035 ? 1 - fy / 0.035 : 0;
      h -= seam * 0.25;
      H[y * n + x] = h;
      const k = (isCover ? 0 : 8) + (Math.floor(fx * 2) % 8);
      const v = shade[k % 16] * (0.86 + (rand() - 0.5) * 0.08) * (1 - seam * 0.6) * (isCover ? 1.08 : 0.92);
      const i = (y * n + x) * 4;
      col[i] = 66 * v;
      col[i + 1] = 72 * v;
      col[i + 2] = 82 * v;
      col[i + 3] = 255;
      // glaze is shinier on the cover tiles, dull and damp in the pan channels
      const r = isCover ? 95 : 150 + seam * 80;
      rough[i] = rough[i + 1] = rough[i + 2] = r;
      rough[i + 3] = 255;
    }
  }
  tileCache = { map: dataTex(col, n, true), normal: dataTex(normalFromHeight(H, n, 6), n, false), rough: dataTex(rough, n, false) };
  return tileCache;
}

/** canvas helper */
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Hall facade, one bay (4 m wide) by one storey (3.2 m): vermilion columns, a painted architrave,
 * and paper lattice doors glowing with lamplight from inside.
 */
let facadeCache: { map: THREE.Texture; emissive: THREE.Texture } | null = null;
function facadeTextures() {
  if (facadeCache) return facadeCache;
  const W = 256;
  const Hh = 205;
  const lattice = (g: CanvasRenderingContext2D, glow: boolean) => {
    // door panels between the columns
    const x0 = 26;
    const x1 = W - 26;
    const top = 38;
    const bottom = Hh - 30;
    if (glow) {
      const gr = g.createLinearGradient(0, top, 0, bottom);
      gr.addColorStop(0, '#ffb35c');
      gr.addColorStop(0.6, '#ff9a3c');
      gr.addColorStop(1, '#c2561e');
      g.fillStyle = gr;
    } else g.fillStyle = '#e8c48a';
    g.fillRect(x0, top, x1 - x0, bottom - top);
    g.strokeStyle = glow ? '#000' : '#5b1a10';
    // 直棂: vertical bars, with a frame per leaf
    g.lineWidth = 2;
    for (let x = x0 + 6; x < x1; x += 7) {
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, bottom - 40);
      g.stroke();
    }
    g.lineWidth = 5;
    for (let k = 0; k <= 4; k++) {
      const x = x0 + ((x1 - x0) * k) / 4;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, bottom);
      g.stroke();
    }
    g.fillStyle = glow ? '#000' : '#6e2014';
    g.fillRect(x0, bottom - 40, x1 - x0, 40); // solid lower panels
    g.fillRect(x0, top + (bottom - top) * 0.42, x1 - x0, 5);
  };
  const map = canvasTex(W, Hh, (g) => {
    g.fillStyle = '#7a1f14';
    g.fillRect(0, 0, W, Hh);
    lattice(g, false);
    // columns
    for (const x of [0, W - 26]) {
      const gr = g.createLinearGradient(x, 0, x + 26, 0);
      gr.addColorStop(0, '#5c120b');
      gr.addColorStop(0.45, '#b3301c');
      gr.addColorStop(1, '#4a0f09');
      g.fillStyle = gr;
      g.fillRect(x, 0, 26, Hh);
    }
    // architrave with blue-green painted bands and a gold line
    g.fillStyle = '#1f4d4a';
    g.fillRect(0, 0, W, 30);
    g.fillStyle = '#2f6f63';
    for (let x = 8; x < W; x += 42) g.fillRect(x, 6, 26, 18);
    g.fillStyle = '#c99a3a';
    g.fillRect(0, 30, W, 4);
    g.fillStyle = '#3b2a20';
    g.fillRect(0, Hh - 26, W, 26); // sill
  });
  const emissive = canvasTex(W, Hh, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, Hh);
    lattice(g, true);
  });
  facadeCache = { map, emissive };
  return facadeCache;
}

/** 斗拱 band under the eaves: rows of painted bracket sets */
let bracketCache: THREE.Texture | null = null;
function bracketTexture() {
  if (bracketCache) return bracketCache;
  bracketCache = canvasTex(256, 64, (g) => {
    g.fillStyle = '#1a0d0a';
    g.fillRect(0, 0, 256, 64);
    for (let k = 0; k < 4; k++) {
      const x = k * 64;
      g.fillStyle = '#8d2a18';
      g.fillRect(x + 26, 34, 12, 30); // 斗
      g.fillStyle = '#2d6a5e';
      g.fillRect(x + 10, 24, 44, 10); // 拱
      g.fillRect(x + 4, 10, 56, 9);
      g.fillStyle = '#c9a046';
      g.fillRect(x + 24, 19, 16, 5);
      g.fillRect(x + 22, 4, 20, 6);
      g.fillStyle = '#3a8a7a';
      g.fillRect(x + 12, 26, 40, 2);
    }
    g.fillStyle = '#6d1d12';
    g.fillRect(0, 60, 256, 4);
  });
  return bracketCache;
}

// ---------------------------------------------------------------
// roofs
// ---------------------------------------------------------------
function hallFrame(hl: Hall) {
  const cx = (hl.x0 + hl.x1) / 2;
  const cz = (hl.z0 + hl.z1) / 2;
  const alongX = hl.axis === 'x';
  const ha = alongX ? (hl.z1 - hl.z0) / 2 : (hl.x1 - hl.x0) / 2;
  const hb = alongX ? (hl.x1 - hl.x0) / 2 : (hl.z1 - hl.z0) / 2;
  return { cx, cz, alongX, ha, hb, ridgeHalf: hb - ha };
}

/** Tiled roof surface: a fine grid sampled straight from the physics height */
function roofGeometry(hl: Hall) {
  const { cx, cz, alongX, ha, hb } = hallFrame(hl);
  const step = 0.2;
  const nx = Math.round((hl.x1 - hl.x0) / step);
  const nz = Math.round((hl.z1 - hl.z0) / step);
  const pos: number[] = [];
  const uv: number[] = [];
  const colr: number[] = [];
  const idx: number[] = [];
  const glaze = new THREE.Color('#3d8a6e');
  const base = new THREE.Color('#ffffff');
  const c = new THREE.Color();
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = hl.x0 + (i / nx) * (hl.x1 - hl.x0);
      const z = hl.z0 + (j / nz) * (hl.z1 - hl.z0);
      const h = hallHeight(hl, x, z) ?? hl.eave;
      pos.push(x, h, z);
      const a = alongX ? Math.abs(z - cz) : Math.abs(x - cx);
      const b = alongX ? Math.abs(x - cx) : Math.abs(z - cz);
      const side = a / ha >= (b - (hb - ha)) / ha;
      // channels run straight down the slope on each face
      const along = side ? (alongX ? x : z) : alongX ? z : x;
      const down = side ? a : b - (hb - ha);
      uv.push(along / 0.4, down / 0.3);
      // green glazed border tiles (剪边) along the eaves
      const u = Math.max(a / ha, (b - (hb - ha)) / ha);
      c.copy(base).lerp(glaze, sstep(0.86, 0.93, u) * 0.85);
      colr.push(c.r, c.g, c.b);
    }
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const d = a + nx + 1;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a tube that hugs the roof surface from p to q (for hip ridges) */
function ridgeTube(hl: Hall, p: [number, number], q: [number, number], lift: number, r: number) {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 24; k++) {
    const t = k / 24;
    const x = p[0] + (q[0] - p[0]) * t;
    const z = p[1] + (q[1] - p[1]) * t;
    // pull a hair inside the footprint so the sample stays on this hall
    const xs = THREE.MathUtils.clamp(x, hl.x0 + 0.01, hl.x1 - 0.01);
    const zs = THREE.MathUtils.clamp(z, hl.z0 + 0.01, hl.z1 - 0.01);
    pts.push(new THREE.Vector3(x, (hallHeight(hl, xs, zs) ?? hl.eave) + lift, z));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, r, 8, false);
}

/** 鸱吻: the fish-tailed ridge-end ornament */
function chiweiGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.55, 0);
  s.quadraticCurveTo(0.62, 0.55, 0.38, 0.9);
  s.quadraticCurveTo(0.2, 1.25, -0.18, 1.3);
  s.quadraticCurveTo(0.05, 1.05, 0.02, 0.8);
  s.quadraticCurveTo(-0.22, 0.85, -0.3, 0.62);
  s.quadraticCurveTo(-0.05, 0.6, 0.0, 0.42);
  s.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.22, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 10 });
  g.translate(-0.15, 0, -0.11);
  return g;
}

/** Eave edge points of a hall, walking round the footprint */
function eavePath(hl: Hall, inset: number, step = 0.25) {
  const pts: [number, number][] = [];
  const x0 = hl.x0 + inset;
  const x1 = hl.x1 - inset;
  const z0 = hl.z0 + inset;
  const z1 = hl.z1 - inset;
  const seg = (ax: number, az: number, bx: number, bz: number) => {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(L / step));
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  };
  seg(x0, z0, x1, z0);
  seg(x1, z0, x1, z1);
  seg(x1, z1, x0, z1);
  seg(x0, z1, x0, z0);
  return pts;
}

/** Vertical band hanging under the eave edge (fascia + bracket frieze), following the upturned corners */
function eaveBand(hl: Hall, inset: number, top: number, bottom: number, uScale: number) {
  const path = eavePath(hl, inset);
  path.push(path[0]);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let dist = 0;
  for (let k = 0; k < path.length; k++) {
    const [x, z] = path[k];
    if (k > 0) dist += Math.hypot(x - path[k - 1][0], z - path[k - 1][1]);
    const xs = THREE.MathUtils.clamp(x, hl.x0 + 0.01, hl.x1 - 0.01);
    const zs = THREE.MathUtils.clamp(z, hl.z0 + 0.01, hl.z1 - 0.01);
    const y = (hallHeight(hl, xs, zs) ?? hl.eave) - 0.02;
    pos.push(x, y + top, z, x, y + bottom, z);
    uv.push(dist * uScale, 1, dist * uScale, 0);
    if (k > 0) {
      const a = (k - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat underside of the overhang, seen from the courtyards: rafters */
function soffitGeometry(hl: Hall) {
  const path = eavePath(hl, 0, 0.5);
  const inner = eavePath(hl, 0.95, 0.5);
  // simple: one flat ring at eave height minus a bit
  const shape = new THREE.Shape(path.map(([x, z]) => new THREE.Vector2(x, z)));
  shape.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, z))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2); // facing down
  // ShapeGeometry lies in xy: after rotation y -> z. Shape y was z, so flip sign back
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setZ(i, z);
    p.setY(i, hl.eave - 0.36);
    p.setX(i, x);
  }
  g.computeVertexNormals();
  return g;
}

function Halls() {
  const tiles = tileTextures();
  const facade = facadeTextures();
  const parts = useMemo(() => {
    const roofMat = new THREE.MeshStandardMaterial({
      map: tiles.map,
      normalMap: tiles.normal,
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: tiles.rough,
      roughness: 1,
      metalness: 0.15,
      vertexColors: true,
      envMapIntensity: 1.4,
    });
    const ridgeMat = new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.4, metalness: 0.2 });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#b8862e', roughness: 0.5, metalness: 0.8, emissive: '#3a2406', emissiveIntensity: 0.25 });
    const fasciaMat = new THREE.MeshStandardMaterial({ color: '#7b2014', roughness: 0.6, side: THREE.DoubleSide });
    const bracketTex = bracketTexture();
    const bracketMat = new THREE.MeshStandardMaterial({ map: bracketTex, roughness: 0.7, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: bracketTex, emissiveIntensity: 0.12 });
    const soffitMat = new THREE.MeshStandardMaterial({ color: '#3a1d14', roughness: 0.9, side: THREE.DoubleSide });
    const wallMat = new THREE.MeshStandardMaterial({ map: facade.map, emissiveMap: facade.emissive, emissive: '#ffffff', emissiveIntensity: 1.6, roughness: 0.75 });
    const baseMat = new THREE.MeshStandardMaterial({ color: '#5b5249', roughness: 0.95 });
    const items: { geo: THREE.BufferGeometry; mat: THREE.Material; pos?: [number, number, number]; rot?: [number, number, number]; scale?: number; cast?: boolean; recv?: boolean }[] = [];
    const chiwei = chiweiGeometry();
    for (const hl of ROOF.halls) {
      const { cx, cz, alongX, ha, hb, ridgeHalf } = hallFrame(hl);
      items.push({ geo: roofGeometry(hl), mat: roofMat, cast: true, recv: true });
      // main ridge: a raised tiled beam with gold caps and a 鸱吻 at each end
      const ridgeLen = ridgeHalf * 2 + 0.7;
      const rg = new THREE.BoxGeometry(alongX ? ridgeLen : 0.64, 0.5, alongX ? 0.64 : ridgeLen);
      items.push({ geo: rg, mat: ridgeMat, pos: [cx, hl.ridge + 0.06, cz], cast: true, recv: true });
      const cap = new THREE.BoxGeometry(alongX ? ridgeLen + 0.1 : 0.7, 0.05, alongX ? 0.7 : ridgeLen + 0.1);
      items.push({ geo: cap, mat: goldMat, pos: [cx, hl.ridge + 0.31, cz] });
      for (const sgn of [-1, 1]) {
        const ex = alongX ? cx + sgn * (ridgeHalf + 0.25) : cx;
        const ez = alongX ? cz : cz + sgn * (ridgeHalf + 0.25);
        const rotY = alongX ? (sgn > 0 ? Math.PI : 0) : sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
        items.push({ geo: chiwei, mat: goldMat, pos: [ex, hl.ridge + 0.3, ez], rot: [0, rotY, 0], scale: hl.ridge > 5.5 ? 1.25 : 0.95, cast: true });
      }
      // hip ridges: from each end of the main ridge down to the four corners
      const ends: [number, number][] = alongX
        ? [
            [cx - ridgeHalf, cz],
            [cx + ridgeHalf, cz],
          ]
        : [
            [cx, cz - ridgeHalf],
            [cx, cz + ridgeHalf],
          ];
      const corners: [number, number][] = [
        [hl.x0, hl.z0],
        [hl.x1, hl.z0],
        [hl.x0, hl.z1],
        [hl.x1, hl.z1],
      ];
      for (const cn of corners) {
        const end = ends.reduce((best, e) => (Math.hypot(e[0] - cn[0], e[1] - cn[1]) < Math.hypot(best[0] - cn[0], best[1] - cn[1]) ? e : best));
        items.push({ geo: ridgeTube(hl, end, cn, 0.1, 0.13), mat: ridgeMat, cast: true });
        // gilded beast at the tip of each flying eave
        const tip = new THREE.SphereGeometry(0.13, 10, 8);
        items.push({ geo: tip, mat: goldMat, pos: [cn[0], (hallHeight(hl, THREE.MathUtils.clamp(cn[0], hl.x0 + 0.01, hl.x1 - 0.01), THREE.MathUtils.clamp(cn[1], hl.z0 + 0.01, hl.z1 - 0.01)) ?? hl.eave) + 0.3, cn[1]] });
      }
      // fascia board and bracket frieze hanging under the eave line
      items.push({ geo: eaveBand(hl, 0, 0, -0.32, 1), mat: fasciaMat });
      items.push({ geo: eaveBand(hl, 0.55, -0.36, -1.0, 1 / 1.6), mat: bracketMat });
      items.push({ geo: soffitGeometry(hl), mat: soffitMat });
      // walls: lamp-lit lattice storeys down to a stone platform in the courtyard
      const wx0 = hl.x0 + 0.9;
      const wx1 = hl.x1 - 0.9;
      const wz0 = hl.z0 + 0.9;
      const wz1 = hl.z1 - 0.9;
      const top = hl.eave - 0.9;
      const bot = ROOF.street + 2.2;
      const storey = 3.2;
      const faces: [number, number, number, number][] = [
        [wx0, wz1, wx1, wz1],
        [wx1, wz1, wx1, wz0],
        [wx1, wz0, wx0, wz0],
        [wx0, wz0, wx0, wz1],
      ];
      for (const [ax, az, bx, bz] of faces) {
        const L = Math.hypot(bx - ax, bz - az);
        const g = new THREE.PlaneGeometry(L, top - bot);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L / 4), uv.getY(i) * ((top - bot) / storey));
        const ang = Math.atan2(bz - az, bx - ax);
        items.push({ geo: g, mat: wallMat, pos: [(ax + bx) / 2, (top + bot) / 2, (az + bz) / 2], rot: [0, -ang, 0] });
      }
      const plat = new THREE.BoxGeometry(hl.x1 - hl.x0 - 0.6, 2.2, hl.z1 - hl.z0 - 0.6);
      items.push({ geo: plat, mat: baseMat, pos: [cx, ROOF.street + 1.1, cz], recv: true });
    }
    // corridor roofs: flat stone walkways with gilded edges
    const walkMat = new THREE.MeshStandardMaterial({ color: '#2c2624', roughness: 0.45, metalness: 0.05 });
    for (const [x0, x1, z0, z1] of ROOF.corridors) {
      const g = new THREE.BoxGeometry(x1 - x0, 0.5, z1 - z0);
      items.push({ geo: g, mat: walkMat, pos: [(x0 + x1) / 2, ROOF.corridor - 0.26, (z0 + z1) / 2], recv: true, cast: true });
      const top = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      top.rotateX(-Math.PI / 2);
      const uv = top.attributes.uv as THREE.BufferAttribute;
      const across = x1 - x0 < z1 - z0;
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i) * (x1 - x0);
        const v = uv.getY(i) * (z1 - z0);
        uv.setXY(i, (across ? v : u) / 0.4, (across ? u : v) / 0.3);
      }
      const cols = new Float32Array(uv.count * 3).fill(0.85);
      top.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      items.push({ geo: top, mat: roofMat, pos: [(x0 + x1) / 2, ROOF.corridor + 0.002, (z0 + z1) / 2], recv: true });
      const under = new THREE.BoxGeometry(Math.max(0.3, x1 - x0 - 0.5), ROOF.corridor - ROOF.street - 0.5, Math.max(0.3, z1 - z0 - 0.5));
      items.push({ geo: under, mat: wallMat, pos: [(x0 + x1) / 2, (ROOF.corridor - 0.5 + ROOF.street) / 2, (z0 + z1) / 2] });
    }
    return items;
  }, [tiles, facade]);
  return (
    <group>
      {parts.map((p, i) => (
        <mesh key={i} geometry={p.geo} material={p.mat} position={p.pos} rotation={p.rot} scale={p.scale ?? 1} castShadow={p.cast} receiveShadow={p.recv} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// lanterns
// ---------------------------------------------------------------
type LanternSpot = { p: THREE.Vector3; s: number; hue: number; phase: number };

/** All the lantern positions of the compound: under the eaves, and strung across the courtyards */
function lanternSpots() {
  const out: LanternSpot[] = [];
  const cords: number[] = [];
  const cordTo = (pts: THREE.Vector3[]) => {
    for (let k = 1; k < pts.length; k++) cords.push(pts[k - 1].x, pts[k - 1].y, pts[k - 1].z, pts[k].x, pts[k].y, pts[k].z);
  };
  const rand = seeded(12);
  for (const hl of ROOF.halls) {
    const path = eavePath(hl, 0.35, 2.1);
    for (const [x, z] of path) {
      const xs = THREE.MathUtils.clamp(x, hl.x0 + 0.01, hl.x1 - 0.01);
      const zs = THREE.MathUtils.clamp(z, hl.z0 + 0.01, hl.z1 - 0.01);
      const y = (hallHeight(hl, xs, zs) ?? hl.eave) - 1.55;
      // outward a touch so they hang clear of the frieze
      const cx = (hl.x0 + hl.x1) / 2;
      const cz = (hl.z0 + hl.z1) / 2;
      const dx = x - cx;
      const dz = z - cz;
      const l = Math.hypot(dx, dz) || 1;
      out.push({ p: new THREE.Vector3(x + (dx / l) * 0.15, y, z + (dz / l) * 0.15), s: 0.9 + rand() * 0.2, hue: rand(), phase: rand() * 6.28 });
    }
  }
  // festival strings criss-crossing high above the roofs, from ridge to ridge
  const ridgeTops: [number, number, number][] = [
    [0, -10, 5.3],
    [0, 10, 5.3],
    [-11.5, 0, 5.0],
    [11.5, 0, 5.0],
    [-6.5, 0, 6.8],
    [6.5, 0, 6.8],
  ];
  const strings: [number, number][] = [
    [0, 4],
    [0, 5],
    [1, 4],
    [1, 5],
    [2, 4],
    [3, 5],
    [0, 1],
  ];
  for (const [a, b] of strings) {
    const A = ridgeTops[a];
    const B = ridgeTops[b];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const n = Math.max(4, Math.round(L / 1.5));
    const rope: THREE.Vector3[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const y = A[2] + 4.2 + (B[2] - A[2]) * t - Math.sin(t * Math.PI) * 1.4;
      const v = new THREE.Vector3(A[0] + (B[0] - A[0]) * t, y, A[1] + (B[1] - A[1]) * t);
      rope.push(v.clone().setY(y + 0.75));
      if (k > 0 && k < n) out.push({ p: v, s: 0.7, hue: rand(), phase: rand() * 6.28 });
    }
    cordTo(rope);
  }
  // strings of lanterns across the four courtyards, sagging between the halls
  const corners: [number, number, number, number][] = [
    [8.2, 8.2, 13, 13],
    [-8.2, 8.2, -13, 13],
    [8.2, -8.2, 13, -13],
    [-8.2, -8.2, -13, -13],
  ];
  for (const [ax, az, bx, bz] of corners) {
    for (const [p, q] of [
      [
        [ax, (az + bz) / 2],
        [bx, (az + bz) / 2],
      ],
      [
        [(ax + bx) / 2, az],
        [(ax + bx) / 2, bz],
      ],
    ] as [number, number][][]) {
      const rope: THREE.Vector3[] = [];
      for (let k = 0; k <= 7; k++) {
        const t = k / 7;
        const x = p[0] + (q[0] - p[0]) * t;
        const z = p[1] + (q[1] - p[1]) * t;
        const sag = Math.sin(t * Math.PI) * 1.6;
        rope.push(new THREE.Vector3(x, 1.4 - sag + 0.75, z));
        if (k > 0 && k < 7) out.push({ p: new THREE.Vector3(x, 1.4 - sag, z), s: 0.75, hue: rand(), phase: rand() * 6.28 });
      }
      cordTo(rope);
    }
  }
  return { spots: out, cords };
}

function Lanterns() {
  const { spots, cords } = useMemo(() => lanternSpots(), []);
  const { body, caps, ref } = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const y = -0.36 + t * 0.72;
      pts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.3 + 0.06, y));
    }
    const geo = new THREE.LatheGeometry(pts, 14);
    // vertical ribs: darken every other column of the lathe
    const mat = new THREE.MeshStandardMaterial({ color: '#ff3b1f', emissive: "#ff2a0a", emissiveIntensity: 1.8, roughness: 0.6 });
    const body = new THREE.InstancedMesh(geo, mat, spots.length);
    const capGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.1, 10);
    const capMat = new THREE.MeshStandardMaterial({ color: '#d4a03a', metalness: 0.8, roughness: 0.35, emissive: '#5a3508', emissiveIntensity: 0.8 });
    const caps = new THREE.InstancedMesh(capGeo, capMat, spots.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      m.compose(s.p, q, new THREE.Vector3(s.s, s.s, s.s));
      body.setMatrixAt(i, m);
      // mostly red, some gold and a few pale ones
      col.set(s.hue < 0.8 ? '#e8281a' : '#ff8a1f');
      body.setColorAt(i, col);
      caps.setMatrixAt(i * 2, m.compose(new THREE.Vector3(s.p.x, s.p.y + 0.38 * s.s, s.p.z), q, new THREE.Vector3(s.s, s.s, s.s)));
      caps.setMatrixAt(i * 2 + 1, m.compose(new THREE.Vector3(s.p.x, s.p.y - 0.38 * s.s, s.p.z), q, new THREE.Vector3(s.s, s.s, s.s)));
    });
    body.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    return { body, caps, ref: mat };
  }, [spots]);
  // tassels and strings are thin lines
  const lines = useMemo(() => {
    const p: number[] = [...cords];
    for (const s of spots) {
      p.push(s.p.x, s.p.y + 0.42 * s.s, s.p.z, s.p.x, s.p.y + 0.75, s.p.z);
      p.push(s.p.x, s.p.y - 0.42 * s.s, s.p.z, s.p.x, s.p.y - 0.85 * s.s, s.p.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    return g;
  }, [spots, cords]);
  useFrame((st) => {
    // gentle candle flicker over the whole set
    ref.emissiveIntensity = 1.75 + Math.sin(st.clock.elapsedTime * 7.3) * 0.15 + Math.sin(st.clock.elapsedTime * 13.1) * 0.1;
  });
  return (
    <group>
      <primitive object={body} />
      <primitive object={caps} />
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#b8892e" />
      </lineSegments>
    </group>
  );
}

/** A handful of real lights so the lanterns actually light the wet tiles and the frieze */
function LanternLights() {
  const lights: [number, number, number, string, number][] = [
    [10.5, 0.8, 10.5, '#ff8a3d', 60],
    [-10.5, 0.8, 10.5, '#ff7a35', 60],
    [10.5, 0.8, -10.5, '#ff8a3d', 60],
    [-10.5, 0.8, -10.5, '#ff7a35', 60],
    [0, 11, 5.5, '#ffa060', 9],
    [0, 11, -5.5, '#ffa060', 9],
    [8.5, 10.5, 0, '#ff9050', 8],
    [-8.5, 10.5, 0, '#ff9050', 8],
  ];
  return (
    <group>
      {lights.map(([x, y, z, c, i], k) => (
        <pointLight key={k} position={[x, y, z]} color={c} intensity={i} distance={16} decay={1.6} />
      ))}
    </group>
  );
}

/** A winter plum: crooked dark branches covered in pink blossom */
function PlumTree({ seed }: { seed: number }) {
  const { branches, blossom } = useMemo(() => {
    const rand = seeded(seed);
    const branches: { p: THREE.Vector3; q: THREE.Quaternion; len: number; r: number }[] = [];
    const tips: THREE.Vector3[] = [];
    const grow = (from: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number) => {
      const to = from.clone().addScaledVector(dir, len);
      branches.push({ p: from.clone().lerp(to, 0.5), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()), len, r });
      if (depth === 0) {
        tips.push(to);
        return;
      }
      tips.push(to);
      const n = depth > 2 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const d = dir.clone().add(new THREE.Vector3((rand() - 0.5) * 1.6, rand() * 0.5, (rand() - 0.5) * 1.6)).normalize();
        grow(to, d, len * (0.62 + rand() * 0.2), r * 0.6, depth - 1);
      }
    };
    grow(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.15, 1, 0.05).normalize(), 1.8, 0.16, 4);
    const pos: number[] = [];
    for (const t of tips)
      for (let k = 0; k < 14; k++) pos.push(t.x + (rand() - 0.5) * 0.9, t.y + (rand() - 0.5) * 0.7, t.z + (rand() - 0.5) * 0.9);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const blossom = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffb7c8', size: 0.13, sizeAttenuation: true, transparent: true, opacity: 0.95 }));
    return { branches, blossom };
  }, [seed]);
  return (
    <group>
      {branches.map((b, i) => (
        <mesh key={i} position={b.p} quaternion={b.q}>
          <cylinderGeometry args={[b.r * 0.7, b.r, b.len, 6]} />
          <meshStandardMaterial color="#2a1a12" roughness={1} />
        </mesh>
      ))}
      <primitive object={blossom} />
    </group>
  );
}

/** Courtyards (天井) at the four corners: paving, a plum tree hung with lights */
function Courtyards() {
  const items = useMemo(() => {
    const out: { x: number; z: number }[] = [
      { x: 11, z: 11 },
      { x: -11, z: 11 },
      { x: 11, z: -11 },
      { x: -11, z: -11 },
    ];
    return out;
  }, []);
  const paving = useMemo(() => {
    const t = canvasTex(256, 256, (g) => {
        g.fillStyle = '#3c3733';
        g.fillRect(0, 0, 256, 256);
        const rand = seeded(4);
        for (let y = 0; y < 256; y += 32)
          for (let x = (y / 32) % 2 ? -32 : 0; x < 256; x += 64) {
            const v = 50 + rand() * 25;
            g.fillStyle = `rgb(${v},${v - 4},${v - 8})`;
            g.fillRect(x + 2, y + 2, 60, 28);
          }
    });
    t.repeat.set(20, 20);
    return t;
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ROOF.street, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial map={paving} roughness={0.6} metalness={0.05} />
      </mesh>
      {items.map(({ x, z }, i) => (
        <group key={i} position={[x, ROOF.street, z]}>
          <PlumTree seed={i * 13 + 5} />
          <pointLight position={[0, 3.5, 0]} color="#ffb070" intensity={30} distance={10} decay={1.6} />
          {/* stone lantern */}
          <mesh position={[1.6, 0.6, 1.6]}>
            <boxGeometry args={[0.5, 1.2, 0.5]} />
            <meshStandardMaterial color="#6b625a" roughness={0.9} emissive="#ff9a3c" emissiveIntensity={0.25} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// the city of Chang'an all around, lit up for the festival
// ---------------------------------------------------------------
function hipRoofGeometry() {
  // unit hip roof on a 1 x 1 footprint, ridge along x, height 1, with a little overhang
  const g = new THREE.BufferGeometry();
  const o = 0.12;
  const v = [
    -0.5 - o, 0, -0.5 - o, 0.5 + o, 0, -0.5 - o, 0.5 + o, 0, 0.5 + o, -0.5 - o, 0, 0.5 + o,
    -0.22, 1, 0, 0.22, 1, 0,
  ];
  const idx = [0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 4, 2, 4, 3, 3, 4, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

const CITY_FOG = /* glsl */ `
  uniform vec3 uFog; uniform float uNear; uniform float uFar;
`;

function City() {
  const { bodies, roofs, lights } = useMemo(() => {
    const rand = seeded(2024);
    const blocks: { x: number; z: number; w: number; d: number; h: number; rot: number }[] = [];
    // 坊: a grid of walled wards separated by wide avenues; the compound sits in the middle
    const ward = 46;
    for (let gx = -6; gx <= 6; gx++)
      for (let gz = -6; gz <= 6; gz++) {
        const wx = gx * ward;
        const wz = gz * ward;
        for (let k = 0; k < 9; k++) {
          const x = wx + (rand() - 0.5) * (ward - 12);
          const z = wz + (rand() - 0.5) * (ward - 12);
          const r = Math.hypot(x, z);
          if (r < 26 || r > 300) continue;
          // the 朱雀大街 avenue running north-south stays open
          if (Math.abs(x) < 9) continue;
          const big = rand() < 0.12;
          blocks.push({ x, z, w: (big ? 14 : 7) + rand() * 6, d: (big ? 9 : 5) + rand() * 4, h: big ? 6.8 + rand() * 3.4 : 3.4 + rand() * 1.5, rot: rand() < 0.5 ? 0 : Math.PI / 2 });
        }
      }
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    bodyGeo.translate(0, 0.5, 0);
    const bodyMat = new THREE.ShaderMaterial({
      uniforms: { uFog: { value: new THREE.Color('#1a1426') }, uNear: { value: 40 }, uFar: { value: 420 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vW; varying vec3 vN; varying float vDepth;
        void main(){
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vec4 mv = viewMatrix * w; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${CITY_FOG}
        uniform float uTime;
        varying vec3 vW; varying vec3 vN; varying float vDepth;
        ${GLSL_NOISE}
        void main(){
          vec3 n = normalize(vN);
          vec3 col = vec3(0.10, 0.045, 0.035);
          if (abs(n.y) < 0.5) {
            // timber halls: vermilion columns every bay, paper lattice doors glowing between them
            float along = abs(n.x) > 0.5 ? vW.z : vW.x;
            float yy = vW.y + 9.0;
            float storey = floor(yy / 3.4);
            vec2 f = fract(vec2(along / 2.6, yy / 3.4));
            vec2 cell = vec2(floor(along / 2.6), storey);
            float col_ = 1.0 - step(0.09, f.x) * step(f.x, 0.91);
            float door = step(0.12, f.x) * step(f.x, 0.88) * step(0.06, f.y) * step(f.y, 0.7);
            float bars = 0.75 + 0.25 * step(0.5, fract(f.x * 14.0));
            float lit = step(0.25, hash(cell + floor(vW.xz * 0.05)));
            float flick = 0.88 + 0.12 * sin(uTime * 3.0 + hash(cell) * 30.0);
            vec3 warm = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.72, 0.38), hash(cell * 1.7));
            col += warm * door * lit * flick * bars * 1.5;
            col = mix(col, vec3(0.32, 0.05, 0.03), col_);
            // dark band of eave shadow and a painted architrave at the top of each storey
            col *= 1.0 - smoothstep(0.78, 0.95, f.y) * 0.75;
          }
          float fogF = smoothstep(uNear, uFar, vDepth);
          // lights punch through the haze more than walls do
          float lum = dot(col, vec3(0.3, 0.5, 0.2));
          col = mix(col, uFog, fogF * (lum > 0.4 ? 0.55 : 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const roofGeo = hipRoofGeometry();
    const roofMat = new THREE.ShaderMaterial({
      uniforms: { uFog: { value: new THREE.Color('#1a1426') }, uNear: { value: 40 }, uFar: { value: 420 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying float vDepth; varying float vY;
        void main(){
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vY = position.y;
          vec4 mv = viewMatrix * w; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${CITY_FOG}
        varying vec3 vN; varying float vDepth; varying float vY;
        void main(){
          vec3 n = normalize(vN);
          // moonlight from above-left, warm bounce from the street lamps below
          float moon = max(dot(n, normalize(vec3(-0.4, 0.8, -0.45))), 0.0);
          vec3 col = vec3(0.022, 0.024, 0.032) + vec3(0.05, 0.058, 0.09) * moon + vec3(0.22, 0.08, 0.03) * pow(1.0 - vY, 3.0) * 0.5;
          // tile courses
          col *= 0.8 + 0.2 * step(0.5, fract(vY * 9.0));
          col = mix(col, uFog, smoothstep(uNear, uFar, vDepth));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, blocks.length);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, blocks.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const lp: number[] = [];
    const lc: number[] = [];
    const ls: number[] = [];
    const col = new THREE.Color();
    blocks.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      const base = ROOF.street;
      m.compose(new THREE.Vector3(b.x, base, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
      bodies.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(b.x, base + b.h, b.z), q, new THREE.Vector3(b.w * 1.08, Math.min(b.w, b.d) * 0.38, b.d * 1.12));
      roofs.setMatrixAt(i, m);
      // a lantern at each eave corner and a few along the long sides
      const cs = Math.cos(b.rot);
      const sn = Math.sin(b.rot);
      const per = Math.max(2, Math.round(b.w / 3));
      for (let k = 0; k <= per; k++)
        for (const side of [-1, 1]) {
          const lx = -b.w / 2 + (b.w * k) / per;
          const lz = side * (b.d / 2 + 0.15);
          lp.push(b.x + lx * cs + lz * sn, base + b.h - 0.4, b.z - lx * sn + lz * cs);
          col.set(rand() < 0.75 ? '#ff4a22' : '#ffb347');
          lc.push(col.r, col.g, col.b);
          ls.push(0.6 + rand() * 0.5);
        }
    });
    bodies.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
    // lantern strings down both sides of the avenue, and a dense glow of street lamps
    for (let z = -300; z < 300; z += 2.2) {
      if (Math.abs(z) < 22) continue;
      for (const sx of [-7.5, 7.5]) {
        lp.push(sx, ROOF.street + 3 + Math.sin(z * 0.7) * 0.4, z);
        col.set(rand() < 0.8 ? '#ff5a2a' : '#ffd27a');
        lc.push(col.r, col.g, col.b);
        ls.push(0.9);
      }
    }
    for (let k = 0; k < 2500; k++) {
      const a = rand() * Math.PI * 2;
      const r = 30 + Math.pow(rand(), 0.7) * 280;
      lp.push(Math.cos(a) * r, ROOF.street + 0.5 + rand() * 3, Math.sin(a) * r);
      col.set(rand() < 0.6 ? '#ff7a30' : '#ffc070');
      lc.push(col.r, col.g, col.b);
      ls.push(0.5 + rand() * 0.6);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    lg.setAttribute('size', new THREE.Float32BufferAttribute(ls, 1));
    const lm = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute float size; varying vec3 vC; varying float vA; uniform float uTime;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          gl_PointSize = clamp(size * 900.0 / d, 1.5, 22.0);
          vC = color * (0.9 + 0.1 * sin(uTime * 4.0 + position.x * 3.1 + position.z));
          vA = 1.0 - smoothstep(250.0, 480.0, d) * 0.6;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = smoothstep(0.35, 0.0, d);
          float glow = pow(max(0.0, 1.0 - d), 2.5);
          gl_FragColor = vec4(vC * (core * 2.2 + glow * 0.8), (core + glow * 0.6) * vA);
        }`,
    });
    const lights = new THREE.Points(lg, lm);
    lights.frustumCulled = false;
    return { bodies, roofs, lights };
  }, []);
  useFrame((st) => {
    (bodies.material as THREE.ShaderMaterial).uniforms.uTime.value = st.clock.elapsedTime;
    (lights.material as THREE.ShaderMaterial).uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <group>
      <primitive object={bodies} />
      <primitive object={roofs} />
      <primitive object={lights} />
      {/* the ground: dark paving with the avenue glowing down the middle */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, ROOF.street - 0.05, 0]}>
        <circleGeometry args={[520, 48]} />
        <shaderMaterial
          args={[
            {
              uniforms: {},
              vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
              fragmentShader: /* glsl */ `
                varying vec3 vW;
                void main(){
                  float ave = smoothstep(9.0, 2.0, abs(vW.x));
                  float grid = smoothstep(4.0, 0.0, abs(mod(vW.x + 23.0, 46.0) - 23.0)) + smoothstep(4.0, 0.0, abs(mod(vW.z + 23.0, 46.0) - 23.0));
                  vec3 col = vec3(0.05, 0.035, 0.04) + vec3(0.5, 0.2, 0.06) * (ave * 0.5 + min(grid, 1.0) * 0.18);
                  float d = length(vW.xz);
                  col = mix(col, vec3(0.1, 0.078, 0.15), smoothstep(80.0, 450.0, d));
                  gl_FragColor = vec4(col, 1.0);
                }`,
            },
          ]}
        />
      </mesh>
    </group>
  );
}

/** 大雁塔: a seven-storey brick pagoda outlined in lamps, and the gate tower of the palace far to the north */
function Landmarks() {
  const { group, lights } = useMemo(() => {
    const group = new THREE.Group();
    const brick = new THREE.MeshStandardMaterial({ color: '#4a3a30', roughness: 0.95, emissive: '#2a1206', emissiveIntensity: 0.5 });
    const roofM = new THREE.MeshStandardMaterial({ color: '#1d2027', roughness: 0.6 });
    const lp: number[] = [];
    // pagoda
    const px = -70;
    const pz = -150;
    let y = ROOF.street;
    for (let k = 0; k < 7; k++) {
      const w = 16 - k * 1.7;
      const h = k === 0 ? 9 : 6 - k * 0.3;
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), brick);
      body.position.set(px, y + h / 2, pz);
      group.add(body);
      y += h;
      const eave = new THREE.Mesh(new THREE.BoxGeometry(w + 2.2, 0.6, w + 2.2), roofM);
      eave.position.set(px, y, pz);
      group.add(eave);
      // lamps along every eave
      const half = (w + 2.2) / 2;
      for (let t = -half; t <= half; t += 1.1) {
        lp.push(px + t, y - 0.5, pz - half, px + t, y - 0.5, pz + half, px - half, y - 0.5, pz + t, px + half, y - 0.5, pz + t);
      }
      y += 0.6;
    }
    const spire = new THREE.Mesh(new THREE.ConeGeometry(1.4, 7, 8), roofM);
    spire.position.set(px, y + 3.5, pz);
    group.add(spire);
    // palace gate tower on a high platform to the north
    const gz = -260;
    const plat = new THREE.Mesh(new THREE.BoxGeometry(90, 14, 22), brick);
    plat.position.set(0, ROOF.street + 7, gz);
    group.add(plat);
    for (const [x, w] of [
      [0, 44],
      [-34, 16],
      [34, 16],
    ] as [number, number][]) {
      const hall = new THREE.Mesh(new THREE.BoxGeometry(w, 9, 14), new THREE.MeshStandardMaterial({ color: '#5a140c', emissive: '#ff7a2a', emissiveIntensity: 0.35, roughness: 0.8 }));
      hall.position.set(x, ROOF.street + 18.5, gz);
      group.add(hall);
      const r = new THREE.Mesh(hipRoofGeometry(), roofM);
      r.scale.set(w + 3, 7, 17);
      r.position.set(x, ROOF.street + 23, gz);
      group.add(r);
      for (let t = -w / 2; t <= w / 2; t += 1.2) lp.push(x + t, ROOF.street + 22.6, gz + 8.2);
    }
    for (let t = -45; t <= 45; t += 1.5) lp.push(t, ROOF.street + 14.3, gz + 11.3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const lm = new THREE.PointsMaterial({ color: '#ffb35a', size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const lights = new THREE.Points(lg, lm);
    return { group, lights };
  }, []);
  return (
    <group>
      <primitive object={group} />
      <primitive object={lights} />
    </group>
  );
}

// ---------------------------------------------------------------
// sky: full moon of the Lantern Festival, stars, city glow, and drifting sky lanterns
// ---------------------------------------------------------------
function NightSky() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTime: { value: 0 }, uMoon: { value: new THREE.Vector3(-0.45, 0.42, -0.78).normalize() }, uFlash: { value: 0 } },
        vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uMoon; uniform float uFlash;
          varying vec3 vDir;
          ${GLSL_NOISE}
          void main(){
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 zen = vec3(0.012, 0.018, 0.05);
            vec3 mid = vec3(0.05, 0.05, 0.12);
            vec3 hor = vec3(0.32, 0.13, 0.08); // the whole city glowing orange on the haze
            vec3 col = h > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.18, h)), zen, smoothstep(0.15, 0.8, h)) : hor * 0.8;
            // stars
            vec2 sp = vec2(atan(d.z, d.x), asin(clamp(h, -1.0, 1.0))) * 260.0;
            float st = hash(floor(sp));
            float tw = 0.6 + 0.4 * sin(uTime * 2.0 + st * 40.0);
            col += vec3(0.9, 0.92, 1.0) * step(0.9975, st) * smoothstep(0.08, 0.4, h) * tw * 0.9;
            // moon: disc with soft maria, a halo and a wide glow
            float m = max(dot(d, uMoon), 0.0);
            float disc = smoothstep(0.99935, 0.9996, m);
            float maria = fbm(d.xy * 400.0) * 0.25;
            col += vec3(1.0, 0.96, 0.86) * disc * (2.4 - maria);
            col += vec3(0.55, 0.5, 0.42) * pow(m, 400.0) * 0.6 + vec3(0.25, 0.22, 0.3) * pow(m, 30.0) * 0.35;
            // thin clouds lit from below by the city
            float c = fbm(vec2(atan(d.z, d.x) * 4.0 + uTime * 0.003, h * 10.0));
            float band = smoothstep(0.03, 0.12, h) * (1.0 - smoothstep(0.2, 0.5, h));
            col = mix(col, vec3(0.28, 0.14, 0.12), smoothstep(0.55, 0.8, c) * band * 0.6);
            col += vec3(1.0, 0.6, 0.3) * uFlash * 0.25 * (0.5 + 0.5 * max(h, 0.0));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    []
  );
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    mat.uniforms.uFlash.value = mapRuntime.boltT;
  });
  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[480, 48, 24]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

/** 孔明灯: hundreds of paper sky lanterns rising over the city */
function SkyLanterns() {
  const pts = useMemo(() => {
    const n = 700;
    const rand = seeded(77);
    const p = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = 20 + Math.pow(rand(), 0.6) * 260;
      p.set([Math.cos(a) * r, rand() * 120, Math.sin(a) * r], i * 3);
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime; attribute float seed; varying float vS; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y + uTime * (0.6 + seed * 0.9), 120.0) - 4.0;
          p.x += sin(uTime * 0.1 + seed * 30.0) * 3.0 + uTime * 0.25;
          p.z += cos(uTime * 0.13 + seed * 20.0) * 3.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(260.0 / -mv.z, 1.0, 14.0);
          vS = seed;
          vA = smoothstep(-4.0, 6.0, p.y) * (1.0 - smoothstep(90.0, 116.0, p.y));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vS; varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          // little upright paper box: brighter at the bottom where the flame is
          float box = step(abs(c.x), 0.26) * step(abs(c.y), 0.36);
          float glow = pow(max(0.0, 1.0 - length(c) * 2.0), 2.0);
          float flame = smoothstep(0.36, -0.1, -c.y) ;
          vec3 col = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.8, 0.45), flame);
          gl_FragColor = vec4(col * (box * (0.9 + flame) + glow * 0.5), (box + glow * 0.5) * vA);
        }`,
    });
    return new THREE.Points(g, m);
  }, []);
  useFrame((st) => {
    (pts.material as THREE.ShaderMaterial).uniforms.uTime.value = st.clock.elapsedTime;
  });
  return <primitive object={pts} />;
}

/** Festival fireworks bursting over the city (visual only; the one aimed at the ridge is the game hazard) */
function Fireworks() {
  const SLOTS = 6;
  const PER = 160;
  const { points, mat, state } = useMemo(() => {
    const n = SLOTS * PER;
    const dir = new Float32Array(n * 3);
    const slot = new Float32Array(n);
    const rand = seeded(91);
    for (let s = 0; s < SLOTS; s++)
      for (let k = 0; k < PER; k++) {
        const i = s * PER + k;
        // even-ish sphere of directions with a little speed scatter
        const u = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const r = Math.sqrt(1 - u * u);
        const sp = 0.8 + rand() * 0.25;
        dir.set([Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp], i * 3);
        slot[i] = s;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('slot', new THREE.BufferAttribute(slot, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uC: { value: Array.from({ length: SLOTS }, () => new THREE.Vector3(0, -999, 0)) },
        uS: { value: new Array(SLOTS).fill(-99) },
        uCol: { value: Array.from({ length: SLOTS }, () => new THREE.Color('#ffcc66')) },
        uR: { value: new Array(SLOTS).fill(20) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uC[${SLOTS}]; uniform float uS[${SLOTS}]; uniform vec3 uCol[${SLOTS}]; uniform float uR[${SLOTS}];
        attribute float slot; varying vec3 vC; varying float vA;
        void main(){
          int s = int(slot);
          float t = uTime - uS[s];
          float grow = 1.0 - exp(-t * 2.6);
          vec3 p = uC[s] + position * uR[s] * grow + vec3(0.0, -1.6 * t * t, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = (t > 0.0 ? 1.0 : 0.0) * (1.0 - smoothstep(1.2, 2.8, t)) * (0.7 + 0.3 * sin(t * 30.0 + position.x * 50.0));
          vC = mix(vec3(1.0, 0.95, 0.85), uCol[s], smoothstep(0.0, 0.5, t));
          gl_PointSize = clamp(900.0 / -mv.z, 1.0, 9.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; gl_FragColor = vec4(vC * 2.0, pow(max(0.0, 1.0 - d), 1.6) * vA); }`,
    });
    const points = new THREE.Points(g, mat);
    points.frustumCulled = false;
    return { points, mat, state: { next: 0.5, i: 0, rand: seeded(5) } };
  }, []);
  const palette = ['#ff4a3a', '#ffd166', '#ff9f43', '#7bdff2', '#e0aaff', '#b8f2a0', '#ffffff'];
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    mat.uniforms.uTime.value = t;
    if (t > state.next) {
      const r = state.rand;
      state.next = t + 0.5 + r() * 1.6;
      const s = state.i++ % SLOTS;
      const a = (r() - 0.5) * 2.4 - Math.PI / 2; // mostly in front of the main view, to the north
      const d = 90 + r() * 150;
      mat.uniforms.uC.value[s].set(Math.cos(a) * d, 35 + r() * 45, Math.sin(a) * d);
      mat.uniforms.uS.value[s] = t;
      mat.uniforms.uCol.value[s].set(palette[Math.floor(r() * palette.length)]);
      mat.uniforms.uR.value[s] = 10 + r() * 14;
    }
  });
  return <primitive object={points} />;
}

/** The hazard shell: during the warning a glowing shell whistles down onto the main ridge */
function RidgeShell() {
  const shell = useRef<THREE.Group>(null);
  const mark = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  useFrame((st) => {
    const w = mapRuntime.ridgeWarn;
    const g = shell.current;
    if (g) {
      g.visible = w > 0;
      g.position.set(mapRuntime.boltX + (1 - w) * 6, 6.9 + Math.pow(1 - w, 1.4) * 40, -(1 - w) * 10);
      g.rotation.z = st.clock.elapsedTime * 9;
    }
    if (mark.current) {
      mark.current.visible = w > 0;
      mark.current.position.set(mapRuntime.boltX, 6.58, 0);
      const k = 0.6 + w * 3.4;
      mark.current.scale.set(k, k, k);
      (mark.current.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.5 * Math.abs(Math.sin(st.clock.elapsedTime * 10));
    }
    if (light.current) {
      light.current.intensity = mapRuntime.boltT * 900;
      light.current.position.set(mapRuntime.boltX, 8, 0);
    }
  });
  return (
    <group>
      <group ref={shell} visible={false}>
        <mesh>
          <sphereGeometry args={[0.28, 12, 10]} />
          <meshBasicMaterial color={[4, 2.4, 1.0]} toneMapped={false} />
        </mesh>
        <mesh position={[0, 1.6, 0]}>
          <cylinderGeometry args={[0.02, 0.22, 3.2, 8, 1, true]} />
          <meshBasicMaterial color={[2.5, 1.2, 0.4]} transparent opacity={0.5} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <mesh ref={mark} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.8, 1, 40]} />
        <meshBasicMaterial color="#ffb347" transparent opacity={0.6} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <pointLight ref={light} color="#ffb060" intensity={0} distance={30} decay={1.6} />
    </group>
  );
}

/** Light drifting haze lit by the lanterns, low over the courtyards */
function Haze() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec2 vUv; varying vec3 vW;
          ${GLSL_NOISE}
          void main(){
            float n = fbm(vW.xz * 0.05 + vec2(uTime * 0.02, uTime * 0.013));
            float d = length(vW.xz);
            float a = smoothstep(0.45, 0.85, n) * smoothstep(18.0, 40.0, d) * (1.0 - smoothstep(120.0, 260.0, d));
            gl_FragColor = vec4(vec3(0.55, 0.3, 0.2), a * 0.35);
          }`,
      }),
    []
  );
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2, 0]} material={mat}>
      <planeGeometry args={[600, 600]} />
    </mesh>
  );
}

export function ChanganMap() {
  return (
    <group>
      <NightSky />
      <City />
      <Landmarks />
      <Haze />
      <SkyLanterns />
      <Fireworks />
      <Halls />
      <Lanterns />
      <LanternLights />
      <Courtyards />
      <RidgeShell />
    </group>
  );
}

// re-export so the preview harness can sample heights
export { roofHeight };
