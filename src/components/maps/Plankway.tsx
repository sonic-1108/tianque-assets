import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANK, mapRuntime, plankCount, bridgeY } from '../../maps';
import { Sky, CloudSea, CloudPuffs, KarstPeaks, Banner, seeded } from '../Scenery';

// ==================================================================
// 悬空栈道: a plank road pinned to a thousand-foot cliff, over a sea of cloud. Morning light from the
// south-east lights the cliff face; the chasm below fades into cloud; a lone peak with a red pavilion
// stands out in the void, reached by two sagging rope bridges and an iron chain.
// ==================================================================

const SUN_DIR: [number, number, number] = [0.55, 0.35, 0.75];

// a little 2D value noise for rock surfaces
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5, y * 2.1 + 3) * 0.28 + vnoise(x * 4.3 + 11, y * 4.3 + 7) * 0.17;
}

const rockA = new THREE.Color('#6d6a63');
const rockB = new THREE.Color('#8f8a7f');
const rockC = new THREE.Color('#4c4a46');
const moss = new THREE.Color('#5d6b45');

/** vertex colours for rock: mottled grey-brown, darker cracks and streaks running down, moss on ledges */
function paintRock(g: THREE.BufferGeometry, mossy = 0.35) {
  const p = g.attributes.position;
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const m = fbm(x * 0.12 + z * 0.07, y * 0.18 + z * 0.05);
    c.copy(rockC).lerp(rockA, Math.min(1, m * 1.4)).lerp(rockB, Math.max(0, m - 0.45) * 1.6);
    // rain streaks down the faces
    const streak = vnoise(x * 1.3 + z * 0.9, y * 0.08);
    if (streak < 0.3) c.multiplyScalar(0.78 + streak * 0.7);
    if (n.getY(i) > 0.5) c.lerp(moss, Math.min(1, (n.getY(i) - 0.5) * 2) * mossy * (0.4 + fbm(x * 0.4, z * 0.4)));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/** a tiling grey noise texture (fbm), for rock detail */
let detailTex: THREE.Texture | null = null;
function rockDetail() {
  if (detailTex) return detailTex;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      // tileable: sample noise on a torus
      const a = (x / N) * Math.PI * 2;
      const b = (y / N) * Math.PI * 2;
      const u = Math.cos(a) * 3 + 10;
      const v = Math.sin(a) * 3 + Math.cos(b) * 3 + 10;
      const w = Math.sin(b) * 3;
      const n = fbm(u * 1.7 + w, v * 1.7 - w) * 0.6 + fbm(u * 5 + w * 2, v * 5) * 0.4;
      const cr = Math.abs(fbm(u * 2.5 - w, v * 2.5 + w) - 0.5) < 0.03 ? 0.55 : 1; // fine cracks
      const k = Math.max(0, Math.min(255, (0.35 + n * 0.9) * cr * 255));
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  detailTex = t;
  return t;
}
/**
 * Rock material: vertex colours for the big shapes, and a world-space (triplanar) noise texture multiplied in
 * for close-up grain and cracks, so the faces read as stone instead of flat painted facets.
 */
const rockMat = () => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const tex = rockDetail();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 w = abs(normalize(vWNrm));
          w = w * w;
          w /= max(w.x + w.y + w.z, 1e-4);
          float s = 0.28;
          float d = texture2D(uDetail, vWPos.zy * s).r * w.x + texture2D(uDetail, vWPos.xz * s).r * w.y + texture2D(uDetail, vWPos.xy * s).r * w.z;
          float d2 = texture2D(uDetail, vWPos.xy * 0.06 + vWPos.zz * 0.03).r;
          diffuseColor.rgb *= clamp(0.55 + d * 0.75, 0.0, 1.6) * clamp(0.8 + d2 * 0.4, 0.0, 1.4);
        }`
      );
  };
  m.customProgramCacheKey = () => 'plankway-rock';
  return m;
};

/** wood grain for planks and boards */
let woodTex: THREE.Texture | null = null;
function wood() {
  if (woodTex) return woodTex;
  const W = 128;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a6a48';
  g.fillRect(0, 0, W, H);
  const rand = seeded(91);
  for (let i = 0; i < 140; i++) {
    const x = rand() * W;
    const wv = 1 + rand() * 3;
    g.strokeStyle = `rgba(${40 + rand() * 30},${25 + rand() * 20},${12 + rand() * 10},${0.15 + rand() * 0.3})`;
    g.lineWidth = 0.6 + rand() * 1.6;
    g.beginPath();
    for (let y = 0; y <= H; y += 8) g.lineTo(x + Math.sin(y * 0.02 + i) * wv, y);
    g.stroke();
  }
  // knots
  for (let i = 0; i < 6; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const gr = g.createRadialGradient(x, y, 0, x, y, 7 + rand() * 6);
    gr.addColorStop(0, 'rgba(40,24,12,0.8)');
    gr.addColorStop(1, 'rgba(40,24,12,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y, 6, 12, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  woodTex = t;
  return t;
}

/** where the cliff's rock surface is at (x, y): behind the road line, leaning back as it rises */
function cliffSurfaceZ(x: number, y: number) {
  const r = fbm(x * 0.09, y * 0.09);
  const r2 = fbm(x * 0.35 + 4, y * 0.35);
  const lean = Math.max(0, y - 4) * 0.22 + Math.max(0, -y - 2) * 0.05;
  return PLANK.cliffZ - (r * 2.6 + r2 * 0.8 + 0.35) - lean;
}
/** the cliff face: a huge rock wall behind the road, leaning back as it rises, plunging into the cloud */
function Cliff() {
  const geo = useMemo(() => {
    const W = 150;
    const H = 110;
    const g = new THREE.PlaneGeometry(W, H, 150, 110);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i) + 10; // from -45 up to 65
      p.setXYZ(i, x, y, cliffSurfaceZ(x, y));
    }
    g.computeVertexNormals();
    return paintRock(g, 0.5);
  }, []);
  const mat = useMemo(rockMat, []);
  return <mesh geometry={geo} material={mat} receiveShadow castShadow />;
}

/** a slab of rock: a top outline (x, z points) extruded down, its sides roughened */
function rockSlab(outline: [number, number][], top: number, depth: number, taper: number, seed: number, mossy = 0.6) {
  // rotateX(+90deg) takes the shape's (x, y) and extrusion depth to (x, -depth, y): so y is the plan's z
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: Math.max(6, Math.round(depth / 1.2)), curveSegments: 6 });
  g.rotateX(Math.PI / 2); // extrude downward
  g.translate(0, top, 0);
  const p = g.attributes.position;
  let cx = 0;
  let cz = 0;
  for (const [x, z] of outline) {
    cx += x;
    cz += z;
  }
  cx /= outline.length;
  cz /= outline.length;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const d = (top - y) / depth; // 0 at the top, 1 at the bottom
    if (d < 0.02) continue; // the walkable top stays where the physics says
    const k = 1 - taper * d;
    const amp = Math.min(1, d * 5) * (1.2 + d * 1.5);
    const n1 = (fbm(x * 0.25 + seed, y * 0.3 + z * 0.1) - 0.5) * 2 * amp;
    const n2 = (fbm(z * 0.25 - seed, y * 0.3 + x * 0.1) - 0.5) * 2 * amp;
    p.setXYZ(i, cx + (x - cx) * k + n1, y, cz + (z - cz) * k + n2);
  }
  return paintRock(g.toNonIndexed(), mossy);
}
function roundRect(x0: number, x1: number, z0: number, z1: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const corner = (cx: number, cz: number, a0: number) => {
    for (let k = 0; k <= 6; k++) {
      const a = a0 + (k / 6) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  };
  corner(x1 - r, z1 - r, 0);
  corner(x0 + r, z1 - r, Math.PI / 2);
  corner(x0 + r, z0 + r, Math.PI);
  corner(x1 - r, z0 + r, Math.PI * 1.5);
  return pts;
}

/** a tile of weathered, naturally split rock: irregular slabs (Voronoi), dark mossy seams, grain (sRGB) */
let groundTexC: THREE.Texture | null = null;
function groundTex() {
  if (groundTexC) return groundTexC;
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  const rand = seeded(303);
  const P = 26;
  const pts = Array.from({ length: P }, () => [rand() * N, rand() * N, 0.82 + rand() * 0.3] as [number, number, number]);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let tone = 1;
      for (const [px, py, t] of pts) {
        let dx = Math.abs(x - px);
        let dy = Math.abs(y - py);
        if (dx > N / 2) dx = N - dx; // wrap: the tile repeats seamlessly
        if (dy > N / 2) dy = N - dy;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          tone = t;
        } else if (d < d2) d2 = d;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1); // pixels from the seam
      const grain = 0.88 + hash(x * 0.71, y * 1.13) * 0.24;
      const a = (x / N) * Math.PI * 2;
      const b = (y / N) * Math.PI * 2;
      const blot = fbm(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + Math.cos(b) * 2 + Math.sin(b) * 2);
      let r = 128 * tone * grain;
      let gg = 123 * tone * grain;
      let bb = 112 * tone * grain;
      // lichen and dirt blotches
      if (blot > 0.6) {
        const k = Math.min(1, (blot - 0.6) * 3);
        r = r * (1 - k) + 96 * k;
        gg = gg * (1 - k) + 104 * k;
        bb = bb * (1 - k) + 70 * k;
      }
      // the seam: dark, a little moss
      if (edge < 5) {
        const k = 1 - edge / 5;
        r = r * (1 - k) + 46 * k;
        gg = gg * (1 - k) + 54 * k;
        bb = bb * (1 - k) + 34 * k;
      }
      const o = (y * N + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = bb;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  groundTexC = t;
  return t;
}
/** the walkable top of a rock: a fine grid (so it can carry colour), weathered stone with grass in the hollows */
function topCap(inside: (x: number, z: number) => boolean, x0: number, x1: number, z0: number, z1: number, y: number, seed: number) {
  const cell = 0.5;
  const pos: number[] = [];
  const col: number[] = [];
  const stone = new THREE.Color('#ffffff');
  const dark = new THREE.Color('#c9c3b8');
  const grass = new THREE.Color('#b9cc96');
  const c = new THREE.Color();
  const paint = (x: number, z: number) => {
    const m = fbm(x * 0.35 + seed, z * 0.35);
    const g = fbm(x * 0.18 - seed, z * 0.18 + 3);
    c.copy(dark).lerp(stone, Math.min(1, m * 1.5));
    if (g > 0.5) c.lerp(grass, Math.min(1, (g - 0.5) * 3));
    // flagstone joints
    const jx = Math.abs(((x * 0.9 + Math.floor(z * 0.9) * 0.5) % 1 + 1) % 1 - 0.5);
    const jz = Math.abs(((z * 0.9) % 1 + 1) % 1 - 0.5);
    col.push(c.r, c.g, c.b);
  };
  for (let x = x0; x < x1; x += cell)
    for (let z = z0; z < z1; z += cell) {
      if (!inside(x + cell / 2, z + cell / 2)) continue;
      const q = [
        [x, z],
        [x, z + cell],
        [x + cell, z + cell],
        [x, z],
        [x + cell, z + cell],
        [x + cell, z],
      ];
      for (const [px, pz] of q) {
        pos.push(px, y + 0.012, pz);
        paint(px, pz);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 5, pos[i + 2] / 5); // one tile every 5 m
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function Tops() {
  const geo = useMemo(() => {
    const L = PLANK.ledge;
    const parts: THREE.BufferGeometry[] = [];
    const rr = (x: number, z: number, xa: number, xb: number, za: number, zb: number, r: number) => {
      const cx = Math.max(xa + r, Math.min(xb - r, x));
      const cz = Math.max(za + r, Math.min(zb - r, z));
      return x >= xa && x <= xb && z >= za && z <= zb && Math.hypot(x - cx, z - cz) <= r;
    };
    for (const s of [-1, 1]) parts.push(topCap((x, z) => rr(s * x, z, L.x0 - 3, L.x1, L.z0 - 1, L.z1, L.r) && !(Math.abs(x) < 9.6 && z < PLANK.roadZ) && z > PLANK.cliffZ - 0.6, s < 0 ? -L.x1 : L.x0 - 3, s < 0 ? -(L.x0 - 3) : L.x1, L.z0 - 1, L.z1, 0, s * 5));
    parts.push(topCap((x, z) => Math.hypot(x - PLANK.peak.x, z - PLANK.peak.z) <= PLANK.peak.r - 0.05, -PLANK.peak.r, PLANK.peak.r, PLANK.peak.z - PLANK.peak.r, PLANK.peak.z + PLANK.peak.r, PLANK.peak.h, 13));
    return parts;
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, map: groundTex(), roughness: 0.95 }), []);
  return (
    <group>
      {geo.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} receiveShadow />
      ))}
    </group>
  );
}

/** the two rock ledges (camps), the stone step, and the lone peak's column */
function Rocks() {
  const geo = useMemo(() => {
    const L = PLANK.ledge;
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const o = roundRect(L.x0 - 3, L.x1, L.z0 - 1, L.z1, L.r).map(([x, z]) => [s * x, z] as [number, number]);
      if (s < 0) o.reverse();
      parts.push(rockSlab(o, -0.08, 22, 0.55, s * 7)); // its top sits just under the stone cap (no shadow ripples)
    }
    // the peak: a tall column down into the cloud
    const pk: [number, number][] = [];
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2;
      pk.push([PLANK.peak.x + Math.cos(a) * PLANK.peak.r, PLANK.peak.z + Math.sin(a) * PLANK.peak.r]);
    }
    parts.push(rockSlab(pk.reverse(), PLANK.peak.h - 0.08, 40, 0.35, 3));
    // the stone step in the middle of the road
    const S = PLANK.step;
    parts.push(rockSlab(roundRect(S.x0, S.x1, S.z0 - 0.5, S.z1, 0.4).reverse(), S.h, 1.4, 0, 9, 0.05));
    return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  }, []);
  const mat = useMemo(rockMat, []);
  return <mesh geometry={geo} material={mat} castShadow receiveShadow />;
}

/** the plank road: boards across, beams into the cliff, struts below, posts and a rope along the open edge */
function Road() {
  const { boards, beams, posts, rope } = useMemo(() => {
    const rand = seeded(5);
    const X = 9.6; // the road between the two ledges (the ledges carry on under it at the ends)
    const bw = 0.32;
    const boards: THREE.BufferGeometry[] = [];
    const cols: number[] = [];
    for (let x = -X; x < X; x += bw) {
      const g = new THREE.BoxGeometry(bw - 0.03, 0.1, PLANK.roadZ - PLANK.cliffZ + 0.3);
      g.translate(x + bw / 2, -0.05 - rand() * 0.02, (PLANK.roadZ + PLANK.cliffZ) / 2 + 0.05);
      g.rotateY(0);
      const shade = 0.82 + rand() * 0.3;
      const n = g.attributes.position.count;
      for (let i = 0; i < n; i++) cols.push(0.47 * shade, 0.33 * shade, 0.2 * shade);
      boards.push(g.toNonIndexed());
    }
    const bg = mergeGeometries(boards, false)!;
    const bc: number[] = [];
    {
      // colours per vertex (after toNonIndexed the counts change: recompute)
      let k = 0;
      for (const g of boards) {
        const shade = 0.8 + ((k++ * 7919) % 100) / 300;
        for (let i = 0; i < g.attributes.position.count; i++) bc.push(shade, shade * 0.95, shade * 0.9);
      }
    }
    bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    // beams into the cliff every 1.6 m, with a diagonal strut from lower down the cliff
    const beams: THREE.BufferGeometry[] = [];
    for (let x = -X + 0.4; x <= X; x += 1.6) {
      const b = new THREE.BoxGeometry(0.22, 0.24, PLANK.roadZ - PLANK.cliffZ + 1.2);
      b.translate(x, -0.24, (PLANK.roadZ + PLANK.cliffZ) / 2);
      beams.push(b);
      const len = 3.4;
      const s = new THREE.BoxGeometry(0.16, len, 0.16);
      s.translate(0, -len / 2, 0);
      s.rotateX(-0.75);
      s.translate(x, -0.3, PLANK.roadZ + 0.2);
      beams.push(s);
    }
    // railing posts along the open edge (they don't stop anyone who's knocked flying), and a rope between them
    const posts: THREE.BufferGeometry[] = [];
    const ropePts: THREE.Vector3[] = [];
    for (let x = -X; x <= X + 0.01; x += 2.4) {
      if (Math.abs(x) < 2.0) continue; // the gap in front of the step
      const p = new THREE.CylinderGeometry(0.06, 0.07, 1.15, 6);
      p.translate(x, 0.5, PLANK.roadZ - 0.12);
      posts.push(p);
    }
    const rope: THREE.BufferGeometry[] = [];
    const seg = (x0: number, x1: number) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, 0.95 - Math.sin(Math.PI * t) * 0.18, PLANK.roadZ - 0.12));
      }
      rope.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.022, 4, false));
    };
    const xs: number[] = [];
    for (let x = -X; x <= X + 0.01; x += 2.4) if (Math.abs(x) >= 2.0) xs.push(x);
    for (let k = 0; k + 1 < xs.length; k++) if (xs[k + 1] - xs[k] < 3) seg(xs[k], xs[k + 1]);
    void ropePts;
    return {
      boards: bg,
      beams: mergeGeometries(beams.map((g) => g.toNonIndexed()), false)!,
      posts: mergeGeometries(posts.map((g) => g.toNonIndexed()), false)!,
      rope: mergeGeometries(rope.map((g) => g.toNonIndexed()), false)!,
    };
  }, []);
  return (
    <group>
      <mesh geometry={boards} castShadow receiveShadow>
        <meshStandardMaterial vertexColors map={wood()} roughness={0.85} />
      </mesh>
      <mesh geometry={beams} castShadow>
        <meshStandardMaterial color="#6b5440" map={wood()} roughness={0.9} />
      </mesh>
      <mesh geometry={posts} castShadow>
        <meshStandardMaterial color="#4a3422" roughness={0.85} />
      </mesh>
      <mesh geometry={rope}>
        <meshStandardMaterial color="#b49a6a" roughness={0.95} />
      </mesh>
    </group>
  );
}

/** a rope bridge: planks (each can be broken; hidden while it's gone), hand ropes, hangers, end posts. It sways. */
function Bridge({ k }: { k: number }) {
  const B = PLANK.bridges[k];
  const n = plankCount(k);
  const L = Math.hypot(B.bx - B.ax, B.bz - B.az);
  const yaw = Math.atan2(B.bx - B.ax, B.bz - B.az);
  const planks = useRef<THREE.InstancedMesh>(null);
  const sway = useRef<THREE.Group>(null);
  const plankGeo = useMemo(() => new THREE.BoxGeometry(PLANK.bridgeHalfW * 2 - 0.1, 0.08, PLANK.plankLen - 0.12), []);
  const plankMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', map: wood(), roughness: 0.9 }), []);
  const { ropes, ends } = useMemo(() => {
    const rope: THREE.BufferGeometry[] = [];
    const W = PLANK.bridgeHalfW;
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        pts.push(new THREE.Vector3(side * (W + 0.05), bridgeY(t) + 1.05 + Math.sin(Math.PI * t) * 0.15, t * L));
      }
      rope.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.035, 5, false));
      // the two ropes under the planks
      const low: THREE.Vector3[] = [];
      for (let s = 0; s <= 24; s++) {
        const t = s / 24;
        low.push(new THREE.Vector3(side * (W - 0.2), bridgeY(t) - 0.07, t * L));
      }
      rope.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(low), 48, 0.03, 5, false));
      // hangers from hand rope down to every other plank
      for (let i = 0; i < n; i += 2) {
        const t = (i + 0.5) / n;
        const y0 = bridgeY(t);
        const h = new THREE.CylinderGeometry(0.012, 0.012, 1.1, 3);
        h.translate(side * (W + 0.03), y0 + 0.5, t * L);
        rope.push(h);
      }
    }
    // stout posts at each end
    const ends: THREE.BufferGeometry[] = [];
    for (const t of [0, 1])
      for (const side of [-1, 1]) {
        const p = new THREE.CylinderGeometry(0.11, 0.13, 1.6, 7);
        p.translate(side * (W + 0.1), bridgeY(t) + 0.55, t * L + (t ? 0.3 : -0.3));
        ends.push(p);
      }
    return { ropes: mergeGeometries(rope.map((g) => g.toNonIndexed()), false)!, ends: mergeGeometries(ends.map((g) => g.toNonIndexed()), false)! };
  }, [k, L, n]);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const scl = useMemo(() => new THREE.Vector3(), []);
  const eul = useMemo(() => new THREE.Euler(), []);
  useFrame((st) => {
    const im = planks.current;
    if (!im) return;
    const hp = mapRuntime.plank?.hp?.[k];
    const time = st.clock.elapsedTime;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const alive = !hp || hp[i] > 0;
      const cracked = hp && hp[i] > 0 && hp[i] < PLANK.plankHp;
      // slope of the deck here, so planks follow the sag
      const dy = (bridgeY(Math.min(1, t + 0.02)) - bridgeY(Math.max(0, t - 0.02))) / (0.04 * L);
      eul.set(-Math.atan(dy), 0, cracked ? Math.sin(i * 3.1) * 0.08 : 0);
      q.setFromEuler(eul);
      pos.set(0, bridgeY(t) - 0.04, t * L);
      scl.setScalar(alive ? 1 : 0.0001);
      m4.compose(pos, q, scl);
      im.setMatrixAt(i, m4);
      im.setColorAt(i, cracked ? new THREE.Color('#6a5040') : new THREE.Color(i % 3 ? '#c8b29a' : '#b09878'));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    // a gentle sway (harder in the wind); visual only
    if (sway.current) sway.current.rotation.z = Math.sin(time * 1.3 + k) * 0.006 + (mapRuntime.plank?.gust ?? 0) * 0.025 * Math.sin(time * 6);
  });
  return (
    <group position={[B.ax, 0, B.az]} rotation={[0, yaw, 0]}>
      <group ref={sway}>
        <instancedMesh ref={planks} args={[plankGeo, plankMat, n]} castShadow receiveShadow />
        <mesh geometry={ropes}>
          <meshStandardMaterial color="#a88d5e" roughness={0.95} />
        </mesh>
      </group>
      <mesh geometry={ends} castShadow>
        <meshStandardMaterial color="#4a3422" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** the iron chain from the stone step to the peak, with its two iron-capped anchor posts */
function Chain() {
  const { links, posts } = useMemo(() => {
    const C = PLANK.chain;
    const ya = PLANK.step.h + C.high;
    const yb = PLANK.peak.h + C.high;
    const L = Math.hypot(C.bx - C.ax, C.bz - C.az);
    const count = Math.round(L / 0.15);
    const links: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      // oval links along the chain (which runs along z), alternately upright and flat
      const g = new THREE.TorusGeometry(0.06, 0.02, 5, 10);
      if (i % 2) {
        g.scale(1, 1.7, 1);
        g.rotateX(Math.PI / 2); // ring in the x-z plane, long along z
      } else {
        g.scale(1.7, 1, 1);
        g.rotateY(Math.PI / 2); // ring in the y-z plane, long along z
      }
      g.translate(C.ax + (C.bx - C.ax) * t, ya + (yb - ya) * t - 0.35 * Math.sin(Math.PI * t), C.az + (C.bz - C.az) * t);
      links.push(g.toNonIndexed());
    }
    const posts: THREE.BufferGeometry[] = [];
    for (const [x, z, y0] of [
      [C.ax, C.az - 0.15, PLANK.step.h],
      [C.bx, C.bz - 0.1, PLANK.peak.h],
    ] as [number, number, number][]) {
      const p = new THREE.CylinderGeometry(0.16, 0.2, C.high + 0.35, 8);
      p.translate(x, y0 + (C.high + 0.35) / 2, z);
      posts.push(p.toNonIndexed());
      const cap = new THREE.SphereGeometry(0.2, 8, 6);
      cap.translate(x, y0 + C.high + 0.35, z);
      posts.push(cap.toNonIndexed());
    }
    return { links: mergeGeometries(links, false)!, posts: mergeGeometries(posts, false)! };
  }, []);
  return (
    <group>
      <mesh geometry={links} castShadow>
        <meshStandardMaterial color="#3a3a3c" metalness={0.8} roughness={0.45} />
      </mesh>
      <mesh geometry={posts} castShadow>
        <meshStandardMaterial color="#2b2622" metalness={0.5} roughness={0.6} />
      </mesh>
    </group>
  );
}

/** the red pavilion (亭) on the lone peak */
function Pavilion() {
  const geo = useMemo(() => {
    const cx = PLANK.peak.x;
    const cz = PLANK.peak.z + 1.2;
    const y0 = PLANK.peak.h;
    const red: THREE.BufferGeometry[] = [];
    const roof: THREE.BufferGeometry[] = [];
    for (const [dx, dz] of [
      [-2.3, -2.3],
      [2.3, -2.3],
      [-2.3, 2.3],
      [2.3, 2.3],
    ]) {
      const p = new THREE.CylinderGeometry(0.17, 0.2, 3.2, 10);
      p.translate(cx + dx, y0 + 1.6, cz + dz);
      red.push(p.toNonIndexed());
    }
    // a lintel ring
    for (const [w, d, x, z] of [
      [5, 0.22, 0, -2.3],
      [5, 0.22, 0, 2.3],
      [0.22, 5, -2.3, 0],
      [0.22, 5, 2.3, 0],
    ]) {
      const b = new THREE.BoxGeometry(w, 0.3, d);
      b.translate(cx + x, y0 + 3.1, cz + z);
      red.push(b.toNonIndexed());
    }
    // a stone base
    const base = new THREE.CylinderGeometry(3.4, 3.6, 0.12, 8);
    base.rotateY(Math.PI / 8);
    base.translate(cx, y0 + 0.02, cz);
    // the roof: a four-sided cone with flared eaves, and a gilt finial
    const r = new THREE.ConeGeometry(4.3, 2.2, 4, 3, true);
    r.rotateY(Math.PI / 4);
    const p = r.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = (1.1 - y) / 2.2; // 0 top .. 1 eave
      const lift = Math.pow(t, 3) * 0.55;
      p.setY(i, y + lift);
    }
    r.computeVertexNormals();
    r.translate(cx, y0 + 4.35, cz);
    roof.push(r.toNonIndexed());
    const fin = new THREE.SphereGeometry(0.22, 8, 6);
    fin.translate(cx, y0 + 5.6, cz);
    return { red: mergeGeometries(red, false)!, roof: mergeGeometries(roof, false)!, base: base.toNonIndexed(), fin };
  }, []);
  return (
    <group>
      <mesh geometry={geo.red} castShadow>
        <meshStandardMaterial color="#9a2a1e" roughness={0.6} />
      </mesh>
      <mesh geometry={geo.roof} castShadow>
        <meshStandardMaterial color="#26403c" roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geo.base} receiveShadow>
        <meshStandardMaterial color="#b9b1a2" roughness={0.9} />
      </mesh>
      <mesh geometry={geo.fin}>
        <meshStandardMaterial color="#d6a640" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** pines clinging to the cliff and the ledges */
function Pines() {
  const geo = useMemo(() => {
    const rand = seeded(17);
    const parts: THREE.BufferGeometry[] = [];
    const trunk: THREE.BufferGeometry[] = [];
    const add = (x: number, y: number, z: number, s: number, lean: number) => {
      const t = new THREE.CylinderGeometry(0.08 * s, 0.14 * s, 1.8 * s, 5);
      t.translate(0, 0.9 * s, 0);
      t.rotateX(lean);
      t.translate(x, y, z);
      trunk.push(t.toNonIndexed());
      for (let k = 0; k < 3; k++) {
        const c = new THREE.ConeGeometry((1.1 - k * 0.25) * s, 0.7 * s, 7, 1, true); // open: no grey disc under it seen from below
        c.scale(1, 1, 0.7);
        c.translate((rand() - 0.5) * 0.3 * s, (1.4 + k * 0.45) * s, 0);
        c.rotateX(lean);
        c.translate(x, y, z);
        parts.push(c.toNonIndexed());
      }
    };
    // on the cliff face above and below the road, leaning out
    for (let k = 0; k < 18; k++) {
      const x = -40 + rand() * 80;
      const y = rand() < 0.5 ? 4 + rand() * 20 : -4 - rand() * 18;
      if (Math.abs(x) < 23 && y > -3 && y < 4) continue;
      add(x, y, cliffSurfaceZ(x, y) + 0.15, 0.8 + rand() * 0.8, 0.5 + rand() * 0.3); // rooted in the rock
    }
    // a couple at the back of each ledge
    for (const s of [-1, 1]) {
      add(s * 21, 0, -8.6, 1.2, 0.05);
      add(s * 19.5, 0, -9.3, 0.9, 0.1);
    }
    add(3.6, PLANK.peak.h, PLANK.peak.z + 4, 1.0, -0.15);
    return { needles: mergeGeometries(parts, false)!, trunk: mergeGeometries(trunk, false)! };
  }, []);
  return (
    <group>
      <mesh geometry={geo.needles} castShadow>
        <meshStandardMaterial color="#2f4a33" roughness={0.9} flatShading side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geo.trunk} castShadow>
        <meshStandardMaterial color="#4a3526" roughness={0.9} />
      </mesh>
    </group>
  );
}

/** grass tufts and small stones on the ledges and the peak, and a campfire at each camp (decoration only) */
function Dressing() {
  const geo = useMemo(() => {
    const rand = seeded(29);
    const L = PLANK.ledge;
    const spots: [number, number, number][] = [];
    const onLedge = (x: number, z: number) => Math.abs(x) > L.x0 - 2.5 && Math.abs(x) < L.x1 - 0.6 && z > L.z0 + 0.4 && z < L.z1 - 0.5 && !(Math.abs(x) < 9.6 && z < PLANK.roadZ);
    const onPeak = (x: number, z: number) => Math.hypot(x - PLANK.peak.x, z - PLANK.peak.z) < PLANK.peak.r - 0.5 && Math.hypot(x - PLANK.peak.x, z - PLANK.peak.z - 1.2) > 3.2;
    for (let k = 0; k < 900 && spots.length < 260; k++) {
      const x = (rand() - 0.5) * 48;
      const z = -10 + rand() * 25;
      if (onLedge(x, z)) spots.push([x, 0, z]);
      else if (onPeak(x, z)) spots.push([x, PLANK.peak.h, z]);
    }
    const blades: THREE.BufferGeometry[] = [];
    const stones: THREE.BufferGeometry[] = [];
    for (const [x, y, z] of spots) {
      // tufts where the grass is (the same noise as the ground's colour), stones elsewhere
      const g = fbm(x * 0.18 - (x > 0 ? 5 : -5), z * 0.18 + 3);
      if (g > 0.45 || rand() < 0.35) {
        for (let b = 0; b < 5; b++) {
          const h = 0.18 + rand() * 0.22;
          const c = new THREE.ConeGeometry(0.035, h, 3);
          c.translate(0, h / 2, 0);
          c.rotateZ((rand() - 0.5) * 0.7);
          c.rotateY(rand() * Math.PI);
          c.translate(x + (rand() - 0.5) * 0.25, y, z + (rand() - 0.5) * 0.25);
          blades.push(c.toNonIndexed());
        }
      } else {
        const r = 0.08 + rand() * 0.18;
        const d = new THREE.DodecahedronGeometry(r, 0);
        d.scale(1, 0.55, 1);
        d.rotateY(rand() * 6);
        d.translate(x, y + r * 0.3, z);
        stones.push(d.toNonIndexed());
      }
    }
    // a campfire: a ring of stones and crossed logs, at each camp
    const logs: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const cx = s * 19.5;
      const cz = -3.4;
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const d = new THREE.DodecahedronGeometry(0.16, 0);
        d.scale(1, 0.6, 1);
        d.translate(cx + Math.cos(a) * 0.55, 0.06, cz + Math.sin(a) * 0.55);
        stones.push(d.toNonIndexed());
      }
      for (let k = 0; k < 3; k++) {
        const l = new THREE.CylinderGeometry(0.06, 0.07, 0.8, 6);
        l.rotateZ(Math.PI / 2 - 0.25);
        l.rotateY((k / 3) * Math.PI);
        l.translate(cx, 0.15, cz);
        logs.push(l.toNonIndexed());
      }
    }
    return { blades: mergeGeometries(blades, false)!, stones: mergeGeometries(stones, false)!, logs: mergeGeometries(logs, false)! };
  }, []);
  const glow = useRef<THREE.Mesh[]>([]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    glow.current.forEach((m, i) => m && m.scale.setScalar(0.85 + Math.sin(t * 9 + i * 2) * 0.12 + Math.sin(t * 23 + i) * 0.06));
  });
  return (
    <group>
      <mesh geometry={geo.blades}>
        <meshStandardMaterial color="#6f8a3e" roughness={0.9} />
      </mesh>
      <mesh geometry={geo.stones} castShadow>
        <meshStandardMaterial color="#7d776c" roughness={0.95} flatShading />
      </mesh>
      <mesh geometry={geo.logs}>
        <meshStandardMaterial color="#3a2618" roughness={0.9} />
      </mesh>
      {[-1, 1].map((s, i) => (
        <group key={s} position={[s * 19.5, 0.12, -3.4]}>
          <mesh ref={(m) => m && (glow.current[i] = m)} position={[0, 0.22, 0]}>
            <coneGeometry args={[0.22, 0.6, 7]} />
            <meshBasicMaterial color={new THREE.Color('#ffb04a').multiplyScalar(2.2)} toneMapped={false} transparent opacity={0.85} />
          </mesh>
          <pointLight color="#ff9a40" intensity={6} distance={6} decay={2} position={[0, 0.6, 0]} />
        </group>
      ))}
    </group>
  );
}

const PEAK_LAYERS = [
  { dist: 110, count: 10, height: [30, 60] as [number, number], radius: [7, 13] as [number, number], haze: 0.3 },
  { dist: 200, count: 16, height: [40, 90] as [number, number], radius: [10, 20] as [number, number], haze: 0.6 },
];
const PUFF_Y: [number, number] = [-26, -6];

export function PlankwayMap() {
  return (
    <group>
      <Sky zenith="#3f66a3" horizon="#efe0c8" below="#e8e6e2" sunDir={SUN_DIR} sunColor="#ffdca8" sunSize={1.3} streaks={0.5} streakColor="#fff3df" />
      <CloudSea y={-24} color="#fbf7f0" shadow="#98a0b4" horizon="#ece0cc" sunDir={SUN_DIR} />
      <KarstPeaks seed={44} baseY={-45} haze="#dcd8d0" rock="#5a5f5a" light="#ffdca8" lightDir={SUN_DIR} layers={PEAK_LAYERS} />
      <CloudPuffs count={34} inner={20} outer={140} y={PUFF_Y} color="#fffdf8" seed={71} />
      <CloudPuffs count={14} inner={10} outer={30} y={[-24, -17]} color="#ffffff" seed={5} />
      <Cliff />
      <Rocks />
      <Tops />
      <Dressing />
      <Road />
      <Bridge k={0} />
      <Bridge k={1} />
      <Chain />
      <Pavilion />
      <Pines />
      <Banner position={[-20.5, 0, -2.6]} rotationY={0.4} color="#9b1c1c" trim="#d4a017" height={3.2} width={0.9} pole={5.2} />
      <Banner position={[20.5, 0, -2.6]} rotationY={-0.4} color="#1d4e89" trim="#d4a017" height={3.2} width={0.9} pole={5.2} />
    </group>
  );
}
