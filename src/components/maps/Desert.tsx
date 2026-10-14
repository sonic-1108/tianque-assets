import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAPS, DESERT, desertHeight, desertDunes, mapRuntime } from '../../maps';
import { Sky, Banner, seeded, GLSL_NOISE, cloudPuffTexture } from '../Scenery';

// ==================================================================
// 大漠玉门关: a rammed-earth frontier fort among the dunes, late afternoon.
// The sand mesh is sampled from the same height function the physics uses;
// the walls, towers, ramps and the beacon tower are solid meshes on top.
// ==================================================================

const SUN = new THREE.Vector3(-0.62, 0.3, 0.5).normalize();
const F = DESERT.fort;

function vnoise(x: number, y: number) {
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi);
  const b = h(xi + 1, yi);
  const c = h(xi, yi + 1);
  const d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** world position / normal varyings for the procedural materials */
function withWorld(sh: { vertexShader: string; fragmentShader: string }) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);
      #endif`
    );
}
/** bump from a world-space height H (screen-space derivatives) */
const BUMP = /* glsl */ `
  vec3 bumpN(vec3 nW, float H, float k){
    vec3 sx = dFdx(vWP); vec3 sy = dFdy(vWP);
    vec3 r1 = cross(sy, nW); vec3 r2 = cross(nW, sx);
    float det = dot(sx, r1);
    vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
    return normalize(abs(det) * nW - grad * k);
  }
`;

// ---------------------------------------------------------------
// sand: wind ripples, darker troughs, packed earth round the fort
// and in the camps, glints where the sun catches quartz grains
// ---------------------------------------------------------------
function makeSandMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, color: '#ffffff' });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSun = { value: SUN };
    withWorld(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSun; varying vec3 vWP; varying vec3 vWN;
        ${GLSL_NOISE}
        ${BUMP}
        float fbm3(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125; }
        float gPacked;
        float ripple(vec2 p){
          // ripples run across the wind (wind along x), bent by low noise
          float w = p.x * 2.6 + fbm3(p * 0.12) * 9.0 + sin(p.y * 0.35) * 1.5;
          float r = sin(w);
          return (r * 0.5 + 0.5) * (r * 0.5 + 0.5);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float m = max(abs(vWP.x), abs(vWP.z));
          float campS = length(vWP.xz - vec2(${DESERT.spawnS[0].toFixed(1)}, ${DESERT.spawnS[1].toFixed(1)}));
          float campN = length(vWP.xz - vec2(${DESERT.spawnN[0].toFixed(1)}, ${DESERT.spawnN[1].toFixed(1)}));
          float j = (fbm3(vWP.xz * 0.15) - 0.5) * 6.0;
          gPacked = max(1.0 - smoothstep(24.0, 30.0, m + j), 1.0 - smoothstep(8.0, 14.0, min(campS, campN) + j));
          float n = fbm3(vWP.xz * 0.05);
          vec3 sandA = vec3(0.78, 0.57, 0.34);
          vec3 sandB = vec3(0.66, 0.45, 0.26);
          vec3 col = mix(sandA, sandB, smoothstep(0.3, 0.75, n));
          // crests catch more light (pale), troughs collect darker grains
          col *= 0.9 + 0.12 * smoothstep(0.0, 2.5, vWP.y);
          col = mix(col, col * 0.86, ripple(vWP.xz) * (1.0 - gPacked) * 0.5);
          // packed earth: greyer, with cart ruts and scattered pebbles
          vec3 earth = mix(vec3(0.5, 0.4, 0.3), vec3(0.6, 0.48, 0.35), fbm3(vWP.xz * 0.6));
          float peb = step(0.86, noise(vWP.xz * 7.0)) * 0.25;
          earth *= 1.0 - peb;
          float rut = (1.0 - smoothstep(0.1, 0.35, abs(abs(vWP.x) - 1.1))) * (1.0 - smoothstep(18.0, 22.0, abs(vWP.x) * 6.0)) * step(${F.half.toFixed(1)}, abs(vWP.z));
          earth *= 1.0 - rut * 0.18;
          col = mix(col, earth, gPacked * 0.85);
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 nW = normalize(vWN);
          float dist = length(cameraPosition - vWP);
          float H = ripple(vWP.xz) * 0.045 * (1.0 - gPacked) * (1.0 - smoothstep(25.0, 60.0, dist)) + noise(vWP.xz * 3.0) * 0.03;
          normal = normalize((viewMatrix * vec4(bumpN(nW, H, 3.0), 0.0)).xyz);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 V = normalize(cameraPosition - vWP);
          vec3 cell = floor(vWP * 30.0);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          vec3 facet = normalize(normalize(vWN) + (vec3(fract(h * 13.1), fract(h * 71.7), fract(h * 37.3)) - 0.5) * 1.1);
          float spec = pow(max(dot(reflect(-uSun, facet), V), 0.0), 50.0);
          float dist = length(cameraPosition - vWP);
          totalEmissiveRadiance += vec3(1.0, 0.9, 0.7) * step(0.95, h) * spec * 3.0 * (1.0 - gPacked) * (1.0 - smoothstep(5.0, 18.0, dist));
        }`
      );
  };
  return m;
}

/** rammed earth: horizontal tamping layers, eroded streaks, sand drifted against the foot */
function makeEarthMaterial(tint = '#b88a5c', layer = 0.16) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, color: tint });
  m.onBeforeCompile = (sh) => {
    withWorld(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWP; varying vec3 vWN;
        ${GLSL_NOISE}
        ${BUMP}
        float fbm3(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125; }
        float earthH(vec3 p, vec3 n){
          vec2 q = abs(n.x) > abs(n.z) ? p.zy : p.xy;
          if (abs(n.y) > 0.7) q = p.xz;
          float band = fract(p.y / ${layer.toFixed(3)});
          float layerLine = 1.0 - smoothstep(0.0, 0.07, band) * smoothstep(1.0, 0.93, band);
          float erosion = fbm3(vec2(q.x * 0.9, q.y * 0.6));
          return erosion * 0.75 + noise(q * 7.0) * 0.18 - layerLine * 0.12;
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 nW = normalize(vWN);
          vec2 q = abs(nW.x) > abs(nW.z) ? vWP.zy : vWP.xy;
          if (abs(nW.y) > 0.7) q = vWP.xz;
          float e = earthH(vWP, nW);
          vec3 col = diffuseColor.rgb * (0.82 + 0.26 * e);
          // big weathered patches: some courses greyer, some redder
          float patchN = fbm3(q * 0.18);
          col = mix(col, col * vec3(0.92, 0.94, 1.0), smoothstep(0.45, 0.7, patchN) * 0.6);
          col = mix(col, col * vec3(1.06, 0.95, 0.85), smoothstep(0.55, 0.3, patchN) * 0.4);
          // rain streaks running down, darker
          float streak = smoothstep(0.62, 0.8, noise(vec2(q.x * 3.0, q.y * 0.15)));
          col *= 1.0 - streak * 0.14 * (1.0 - abs(nW.y));
          // sand drifted against the foot of the wall
          float drift = 1.0 - smoothstep(0.0, 0.9 + noise(q * 0.6) * 0.8, vWP.y);
          col = mix(col, vec3(0.84, 0.65, 0.42), drift * 0.75);
          // tops are worn paler
          col = mix(col, col * 1.12, smoothstep(0.7, 0.95, nW.y));
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 nW = normalize(vWN);
          float dist = length(cameraPosition - vWP);
          float H = earthH(vWP, nW) * 0.05 * (1.0 - smoothstep(20.0, 55.0, dist));
          normal = normalize((viewMatrix * vec4(bumpN(nW, H, 2.6), 0.0)).xyz);
        }`
      );
  };
  return m;
}

/** red sandstone strata for the yardangs and mesas */
function makeStrataMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, color: '#ffffff' });
  m.onBeforeCompile = (sh) => {
    withWorld(sh);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWP; varying vec3 vWN;
        ${GLSL_NOISE}
        ${BUMP}
        float fbm3(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125; }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 nW = normalize(vWN);
          float y = vWP.y + fbm3(vWP.xz * 0.2) * 1.2;
          float s = sin(y * 3.1) * 0.5 + 0.5;
          float s2 = sin(y * 9.0 + 1.3) * 0.5 + 0.5;
          vec3 a = vec3(0.66, 0.42, 0.26);
          vec3 b = vec3(0.82, 0.6, 0.4);
          vec3 c = vec3(0.55, 0.33, 0.22);
          vec3 col = mix(mix(a, b, s), c, s2 * 0.35);
          col *= 0.85 + 0.25 * noise(vWP.xz * 1.7 + vWP.y * 0.9);
          // sand on the flat tops and in the lee
          col = mix(col, vec3(0.86, 0.67, 0.44), smoothstep(0.65, 0.85, nW.y));
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 nW = normalize(vWN);
          float y = vWP.y + fbm3(vWP.xz * 0.2) * 1.2;
          float H = (sin(y * 3.1) * 0.5 + 0.5) * 0.08 + fbm3(vec2(vWP.x + vWP.z, vWP.y) * 1.5) * 0.06;
          normal = normalize((viewMatrix * vec4(bumpN(nW, H, 3.0), 0.0)).xyz);
        }`
      );
  };
  return m;
}

// ---------------------------------------------------------------
// the sand
// ---------------------------------------------------------------
/** what the sand mesh shows: everything but the fort (its own meshes) and the mesas' sheer rock */
function sandVisualHeight(x: number, z: number) {
  if (Math.max(Math.abs(x), Math.abs(z)) < F.half + 0.6) return 0;
  for (const M of DESERT.mesas) if (Math.abs(x - M.x) < M.hx - 0.4 && Math.abs(z) < M.hz - 0.4) return desertDunes(x, z);
  return desertHeight(x, z);
}

function Sand() {
  const geo = useMemo(() => {
    const size = 300;
    const seg = 320;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      // past the battlefield the banks keep rising into big dunes
      const far = Math.max(0, r - DESERT.radius - 6);
      const big = far > 0 ? far * 0.25 + Math.sin(x * 0.05 + z * 0.02) * Math.min(1, far / 20) * 4 + vnoise(x * 0.03, z * 0.03) * Math.min(1, far / 30) * 8 : 0;
      pos.setY(i, sandVisualHeight(x, z) + big);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(() => makeSandMaterial(), []);
  return <mesh geometry={geo} material={mat} receiveShadow />;
}

/** the great dune sea out to the horizon, and the snow peaks of the Qilian range far to the south-west */
function FarDunes() {
  const { geo, mat } = useMemo(() => {
    const nA = 360;
    const nR = 50;
    const r0 = 140;
    const r1 = 620;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const sandA = new THREE.Color('#d9a86a');
    const sandB = new THREE.Color('#b37a46');
    const rock = new THREE.Color('#7a6a64');
    const snow = new THREE.Color('#f4f1ec');
    for (let j = 0; j <= nR; j++) {
      const t = j / nR;
      const r = r0 + (r1 - r0) * Math.pow(t, 1.5);
      for (let i = 0; i <= nA; i++) {
        const a = (i / nA) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const dune = 6 + Math.sin(x * 0.03 + Math.sin(z * 0.012) * 2) * 7 + vnoise(x * 0.012, z * 0.012) * 18;
        // mountains: a band along the south-west horizon
        const dir = Math.cos(a - Math.atan2(0.75, -0.65));
        const mt = Math.max(0, dir - 0.35) * THREE.MathUtils.smoothstep(r, 380, 560);
        const peaks = mt * (90 + 140 * Math.pow(1 - Math.abs(vnoise(x * 0.008, z * 0.008) * 2 - 1), 2));
        const h = dune * THREE.MathUtils.smoothstep(r, r0, r0 + 30) + peaks;
        pos.push(x, h - 3, z);
        c.copy(sandA).lerp(sandB, vnoise(x * 0.02, z * 0.02));
        if (peaks > 8) c.lerp(rock, Math.min(1, peaks / 30)).lerp(snow, THREE.MathUtils.smoothstep(peaks, 95, 130));
        col.push(c.r, c.g, c.b);
      }
    }
    for (let j = 0; j < nR; j++)
      for (let i = 0; i < nA; i++) {
        const a = j * (nA + 1) + i;
        idx.push(a, a + 1, a + nA + 1, a + 1, a + nA + 2, a + nA + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, fog: true });
    return { geo, mat };
  }, []);
  return <mesh geometry={geo} material={mat} />;
}

// ---------------------------------------------------------------
// the fort
// ---------------------------------------------------------------
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
/** a wedge rising along z from h0 at z0 to h1 at z1, over x0..x1 */
function wedge(x0: number, x1: number, z0: number, z1: number, h0: number, h1: number) {
  const g = new THREE.BufferGeometry();
  const v = [
    [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1],
    [x0, h0, z0], [x1, h0, z0], [x1, h1, z1], [x0, h1, z1],
  ];
  const faces = [
    [4, 5, 6, 7], // top
    [0, 3, 7, 4], // x0 side
    [1, 5, 6, 2], // x1 side
    [0, 4, 5, 1], // z0 end
    [3, 2, 6, 7], // z1 end
  ];
  const pos: number[] = [];
  for (const f of faces) {
    const [a, b, c, d] = f.map((k) => v[k]);
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // make sure every face points outwards: flip ones whose normal faces the centre
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const cy = (h0 + h1) / 4;
  for (let t = 0; t < p.count; t += 3) {
    const mx = (p.getX(t) + p.getX(t + 1) + p.getX(t + 2)) / 3 - cx;
    const my = (p.getY(t) + p.getY(t + 1) + p.getY(t + 2)) / 3 - cy;
    const mz = (p.getZ(t) + p.getZ(t + 1) + p.getZ(t + 2)) / 3 - cz;
    if (mx * n.getX(t) + my * n.getY(t) + mz * n.getZ(t) < 0) {
      const bx = p.getX(t + 1), by = p.getY(t + 1), bz = p.getZ(t + 1);
      p.setXYZ(t + 1, p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2));
      p.setXYZ(t + 2, bx, by, bz);
    }
  }
  g.computeVertexNormals();
  return g;
}
const nonIndexed = (g: THREE.BufferGeometry) => {
  const o = g.index ? g.toNonIndexed() : g;
  if (!o.attributes.uv) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2));
  return o;
};

function FortWalls() {
  const { walls, merlons, gateWood } = useMemo(() => {
    const H0 = F.half - F.wall; // 16
    const H1 = F.half; // 20
    const parts: THREE.BufferGeometry[] = [];
    const top = F.h;
    const pp = F.parapet;
    // a wall segment along x at z side sz (north/south), x range a..b, with parapet base on the outer strip
    const runX = (a: number, b: number, sz: number, h = top) => {
      const z0 = sz > 0 ? H0 : -H1;
      const z1 = sz > 0 ? H1 : -H0;
      parts.push(box(a, b, 0, h, z0, z1));
      const oz0 = sz > 0 ? H1 - 0.6 : -H1;
      parts.push(box(a, b, h, h + pp * 0.5, oz0, oz0 + 0.6));
    };
    const runZ = (a: number, b: number, sx: number, h = top) => {
      const x0 = sx > 0 ? H0 : -H1;
      const x1 = sx > 0 ? H1 : -H0;
      parts.push(box(x0, x1, 0, h, a, b));
      const ox0 = sx > 0 ? H1 - 0.6 : -H1;
      parts.push(box(ox0, ox0 + 0.6, h, h + pp * 0.5, a, b));
    };
    for (const sz of [1, -1]) {
      runX(F.tower, H0, sz);
      runX(-H0, -F.tower, sz);
      // gate towers either side of the gap, and the wall over the gate opening
      parts.push(box(F.gate, F.tower, 0, F.towerH, sz > 0 ? H0 - 0.4 : -H1 - 0.4, sz > 0 ? H1 + 0.4 : -H0 + 0.4));
      parts.push(box(-F.tower, -F.gate, 0, F.towerH, sz > 0 ? H0 - 0.4 : -H1 - 0.4, sz > 0 ? H1 + 0.4 : -H0 + 0.4));
      parts.push(box(-F.gate, F.gate, 5.2, F.towerH, sz > 0 ? H0 : -H1, sz > 0 ? H1 : -H0));
    }
    runZ(-H0, H0, 1);
    runZ(-H0, -DESERT.breach.z, -1);
    runZ(DESERT.breach.z, H0, -1);
    // corner turrets
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        parts.push(box(sx > 0 ? H0 : -H1, sx > 0 ? H1 : -H0, 0, F.corner, sz > 0 ? H0 : -H1, sz > 0 ? H1 : -H0));
        const ox = sx > 0 ? H1 - 0.6 : -H1;
        const oz = sz > 0 ? H1 - 0.6 : -H1;
        parts.push(box(ox, ox + 0.6, F.corner, F.corner + pp * 0.5, sz > 0 ? H0 : -H1, sz > 0 ? H1 : -H0));
        parts.push(box(sx > 0 ? H0 : -H1, sx > 0 ? H1 : -H0, F.corner, F.corner + pp * 0.5, oz, oz + 0.6));
      }
    // the breach: broken stubs at either end, rubble between
    const rand = seeded(21);
    for (const ez of [-1, 1]) {
      const z = ez * DESERT.breach.z;
      for (let k = 0; k < 5; k++) {
        const w = 0.8 + rand() * 0.6;
        parts.push(box(-H1 + k * 0.8, -H1 + k * 0.8 + w, 0, top - 1.2 - rand() * 3, ez > 0 ? z : z - 0.7 - rand(), ez > 0 ? z + 0.7 + rand() : z));
      }
    }
    for (let k = 0; k < 26; k++) {
      const g = new THREE.DodecahedronGeometry(0.4 + rand() * 0.6, 0);
      const x = -H1 + 0.4 + rand() * (F.wall - 0.8);
      const z = (rand() * 2 - 1) * (DESERT.breach.z - 0.3);
      g.scale(1.3, 0.6, 1.1);
      g.rotateY(rand() * 3);
      g.translate(x, 0.1 + rand() * 0.45, z);
      parts.push(g);
    }
    // ramps (马道) up the inside of the east and west walls
    const R = DESERT.ramp;
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        const x0 = sx > 0 ? R.inner : -H0;
        const x1 = sx > 0 ? H0 : -R.inner;
        parts.push(sz > 0 ? wedge(x0, x1, R.z0, H0, 0, F.h) : wedge(x0, x1, -H0, -R.z0, F.h, 0));
      }
    // beacon tower and its ramps
    const B = DESERT.beacon;
    parts.push(box(-B.half, B.half, 0, B.h, -B.half, B.half));
    parts.push(wedge(-B.rampHalfW, B.rampHalfW, B.half, B.rampTo, B.h, 0));
    parts.push(wedge(-B.rampHalfW, B.rampHalfW, -B.rampTo, -B.half, 0, B.h));
    const walls = mergeGeometries(parts.map(nonIndexed), false)!;
    // merlons along every outer parapet
    const mer: THREE.Matrix4[] = [];
    const M = new THREE.Matrix4();
    const addRow = (x0: number, z0: number, x1: number, z1: number, y: number) => {
      const L = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.floor(L / 1.6);
      const a = Math.atan2(x1 - x0, z1 - z0);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        M.compose(new THREE.Vector3(x0 + (x1 - x0) * t, y + pp * 0.5 + pp * 0.25, z0 + (z1 - z0) * t), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(0.6, pp * 0.5, 0.95));
        mer.push(M.clone());
      }
    };
    const o = H1 - 0.3;
    for (const s of [1, -1]) {
      addRow(F.tower, s * o, H0, s * o, top);
      addRow(-H0, s * o, -F.tower, s * o, top);
      addRow(s * o, -H0, s * o, s < 0 ? -DESERT.breach.z : H0, top);
      if (s < 0) addRow(s * o, DESERT.breach.z, s * o, H0, top);
      addRow(s * o, H0, s * o, H1, F.corner);
      addRow(s * o, -H1, s * o, -H0, F.corner);
      addRow(H0, s * o, H1, s * o, F.corner);
      addRow(-H1, s * o, -H0, s * o, F.corner);
    }
    // gate doors standing open against the inside of the gate towers
    const doors: THREE.BufferGeometry[] = [];
    for (const sz of [1, -1])
      for (const sx of [1, -1]) {
        const g = box(0, 0.22, 0, 5.0, 0, F.gate * 0.95);
        g.translate(sx * F.gate - (sx > 0 ? 0.22 : 0), 0, sz > 0 ? H0 - F.gate * 0.95 - 0.1 : -H0 + 0.1);
        doors.push(g);
        for (let k = 0; k < 4; k++) {
          const st = box(0, 0.06, 0, 0.18, 0, F.gate * 0.95);
          st.translate(sx * F.gate - (sx > 0 ? 0.28 : -0.22), 0.6 + k * 1.2, sz > 0 ? H0 - F.gate * 0.95 - 0.1 : -H0 + 0.1);
          doors.push(st);
        }
      }
    return { walls, merlons: mer, gateWood: mergeGeometries(doors.map(nonIndexed), false)! };
  }, []);
  const earth = useMemo(() => makeEarthMaterial('#b39c7c'), []);
  const merMesh = useRef<THREE.InstancedMesh>(null);
  const merGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  React.useLayoutEffect(() => {
    const m = merMesh.current;
    if (!m) return;
    merlons.forEach((mx, i) => m.setMatrixAt(i, mx));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [merlons]);
  return (
    <group>
      <mesh geometry={walls} material={earth} castShadow receiveShadow />
      <instancedMesh ref={merMesh} args={[merGeo, earth, merlons.length]} castShadow receiveShadow />
      <mesh geometry={gateWood} castShadow>
        <meshStandardMaterial color="#5a3a22" roughness={0.85} />
      </mesh>
    </group>
  );
}

/** four barracks (营房) against the inside of the north and south walls: earth walls, a door, a tiled lean-to roof */
function Barracks() {
  const K = DESERT.barracks;
  const inner = F.half - F.wall;
  const { walls, roofs, wood } = useMemo(() => {
    const w: THREE.BufferGeometry[] = [];
    const r: THREE.BufferGeometry[] = [];
    const d: THREE.BufferGeometry[] = [];
    const mid = (K.x0 + K.x1) / 2;
    for (const sx of [1, -1])
      for (const sz of [1, -1]) {
        const X = (a: number, b: number) => (sx > 0 ? [a, b] : [-b, -a]);
        const Z = (a: number, b: number) => (sz > 0 ? [a, b] : [-b, -a]);
        const add = (xa: number, xb: number, y0: number, y1: number, za: number, zb: number, list = w) => {
          const [x0, x1] = X(xa, xb);
          const [z0, z1] = Z(za, zb);
          list.push(box(x0, x1, y0, y1, z0, z1));
        };
        add(K.x0, K.x0 + K.wall, 0, K.h, K.z0, inner);
        add(K.x1 - K.wall, K.x1, 0, K.h, K.z0, inner);
        add(K.x0, mid - K.door, 0, K.h, K.z0, K.z0 + K.wall);
        add(mid + K.door, K.x1, 0, K.h, K.z0, K.z0 + K.wall);
        add(mid - K.door, mid + K.door, 2.45, K.h, K.z0, K.z0 + K.wall);
        // lean-to roof: high against the fort wall, sloping down over the door, with eaves
        const roof = new THREE.BoxGeometry(K.x1 - K.x0 + 0.9, 0.22, inner - K.z0 + 1.1);
        roof.rotateX(sz > 0 ? 0.16 : -0.16);
        roof.translate(sx * mid, K.h + 0.45, sz * ((K.z0 + inner) / 2 - 0.45));
        r.push(roof);
        // ridge tiles along the eave
        const eave = new THREE.CylinderGeometry(0.1, 0.1, K.x1 - K.x0 + 0.9, 6);
        eave.rotateZ(Math.PI / 2);
        eave.translate(sx * mid, K.h + 0.08, sz * (K.z0 - 0.5));
        r.push(eave);
        // door frame and one door leaf standing open inward
        add(mid - K.door - 0.12, mid - K.door, 0, 2.5, K.z0 - 0.05, K.z0 + K.wall + 0.05, d);
        add(mid + K.door, mid + K.door + 0.12, 0, 2.5, K.z0 - 0.05, K.z0 + K.wall + 0.05, d);
        add(mid - K.door, mid + K.door, 2.38, 2.52, K.z0 - 0.06, K.z0 + K.wall + 0.06, d);
        add(mid + K.door - 0.1, mid + K.door - 0.02, 0.05, 2.35, K.z0 + K.wall, K.z0 + K.wall + 1.6, d);
      }
    return {
      walls: mergeGeometries(w.map(nonIndexed), false)!,
      roofs: mergeGeometries(r.map(nonIndexed), false)!,
      wood: mergeGeometries(d.map(nonIndexed), false)!,
    };
  }, []);
  const earth = useMemo(() => makeEarthMaterial('#a99274'), []);
  const mid = (K.x0 + K.x1) / 2;
  return (
    <group>
      <mesh geometry={walls} material={earth} castShadow receiveShadow />
      <mesh geometry={roofs} castShadow receiveShadow>
        <meshStandardMaterial color="#55504c" roughness={0.8} />
      </mesh>
      <mesh geometry={wood} castShadow>
        <meshStandardMaterial color="#5a3a22" roughness={0.85} />
      </mesh>
      {/* a lantern over each door, and a dim lamp inside so the room isn't black */}
      {[1, -1].flatMap((sx) =>
        [1, -1].map((sz) => (
          <group key={`${sx}${sz}`}>
            <mesh position={[sx * mid, 2.75, sz * (K.z0 - 0.25)]}>
              <cylinderGeometry args={[0.16, 0.16, 0.34, 8]} />
              <meshStandardMaterial color="#c2410c" emissive="#ff7a2a" emissiveIntensity={1.6} roughness={0.6} />
            </mesh>
            <mesh position={[sx * mid, 0.02, sz * ((K.z0 + inner) / 2 + 0.2)]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[K.x1 - K.x0 - 1.0, inner - K.z0 - 0.9]} />
              <meshStandardMaterial color="#6a5440" roughness={0.95} />
            </mesh>
          </group>
        ))
      )}
    </group>
  );
}

/** the gate pavilions (城楼) over the north and south gates: timber, red pillars, a grey tiled hip roof */
function GatePavilion({ z }: { z: number }) {
  const y = F.towerH;
  const w = F.tower * 2 - 0.6;
  const d = F.wall + 0.4;
  const cols: [number, number][] = [];
  for (const sx of [-1, -0.33, 0.33, 1]) for (const sz of [-1, 1]) cols.push([(sx * w) / 2 - sx * 0.4, (sz * d) / 2 - sz * 0.3]);
  return (
    <group position={[0, y, z]}>
      <mesh position={[0, 0.15, 0]} receiveShadow castShadow>
        <boxGeometry args={[w + 0.4, 0.3, d + 0.4]} />
        <meshStandardMaterial color="#7a5a40" roughness={0.9} />
      </mesh>
      {cols.map(([x, zz], i) => (
        <mesh key={i} position={[x, 1.7, zz]} castShadow>
          <cylinderGeometry args={[0.2, 0.22, 2.8, 8]} />
          <meshStandardMaterial color="#8a2a1e" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, 3.2, 0]} castShadow>
        <boxGeometry args={[w + 0.2, 0.35, d + 0.2]} />
        <meshStandardMaterial color="#3a2a20" roughness={0.8} />
      </mesh>
      {/* hip roof: a squashed four-sided pyramid with flared eaves */}
      <mesh position={[0, 4.4, 0]} scale={[(w + 2.6) / 2, 1.9, (d + 2.4) / 2]} rotation={[0, Math.PI / 4, 0]} castShadow>
        <coneGeometry args={[1.42, 1.25, 4, 1]} />
        <meshStandardMaterial color="#4b4a4c" roughness={0.75} />
      </mesh>
      <mesh position={[0, 5.45, 0]} castShadow>
        <boxGeometry args={[w * 0.28, 0.24, 0.24]} />
        <meshStandardMaterial color="#3b3a3c" roughness={0.7} />
      </mesh>
      {/* the plaque over the gate */}
      <mesh position={[0, -2.2, z > 0 ? d / 2 + 0.12 : -d / 2 - 0.12]} rotation={[0, z > 0 ? 0 : Math.PI, 0]}>
        <planeGeometry args={[2.4, 0.9]} />
        <meshStandardMaterial color="#1f2a3a" roughness={0.6} emissive="#d4a017" emissiveIntensity={0.08} />
      </mesh>
    </group>
  );
}

/** the beacon (烽火): a brazier of stacked wood and wolf dung; when lit, fire, a column of black smoke and a flag for who lit it */
function Beacon() {
  const B = DESERT.beacon;
  const fire = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const flag = useRef<THREE.MeshStandardMaterial>(null);
  const smokeRefs = useRef<(THREE.Sprite | null)[]>([]);
  const tex = useMemo(() => cloudPuffTexture(), []);
  const smoke = useMemo(() => Array.from({ length: 14 }, (_, k) => ({ ph: k / 14, s: 1.6 + (k % 4) * 0.5 })), []);
  const fireMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uT: { value: 0 }, uOn: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; uniform float uT; void main(){ vUv = uv; vec3 p = position; p.x += sin(p.y * 4.0 + uT * 9.0) * 0.08 * uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
        fragmentShader: /* glsl */ `varying vec2 vUv; uniform float uT; uniform float uOn;
          ${GLSL_NOISE}
          void main(){
            float n = noise(vec2(vUv.x * 6.0, vUv.y * 3.0 - uT * 4.0));
            float a = (1.0 - vUv.y) * smoothstep(0.0, 0.25, vUv.y + n * 0.2) * (0.6 + n * 0.6);
            vec3 col = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.3, 0.05), vUv.y + n * 0.3);
            gl_FragColor = vec4(col * a * 1.6 * uOn, a * uOn);
          }`,
      }),
    []
  );
  useFrame((st) => {
    const D = mapRuntime.desert;
    const on = D.beaconSide >= 0 ? 1 : 0;
    const t = st.clock.elapsedTime;
    fireMat.uniforms.uT.value = t;
    fireMat.uniforms.uOn.value = THREE.MathUtils.damp(fireMat.uniforms.uOn.value, on, 4, 0.016);
    const k = fireMat.uniforms.uOn.value;
    if (fire.current) fire.current.visible = k > 0.02;
    if (light.current) light.current.intensity = k * (34 + Math.sin(t * 17) * 4 + Math.sin(t * 7.3) * 5);
    if (flag.current) {
      const ours = D.beaconSide === mapRuntime.viewSide;
      flag.current.color.set(D.beaconSide < 0 ? '#9a8a74' : ours ? '#e0b02a' : '#b91c1c');
    }
    smoke.forEach((s, i) => {
      const sp = smokeRefs.current[i];
      if (!sp) return;
      const u = (t * 0.09 + s.ph) % 1;
      sp.position.set(Math.sin(u * 5 + i) * 0.6 + u * 14 * mapRuntime.desert.wind * (0.3 + mapRuntime.desert.sand), B.h + 2.2 + u * 26, Math.cos(u * 4 + i) * 0.6);
      sp.scale.setScalar(s.s + u * 7);
      (sp.material as THREE.SpriteMaterial).opacity = k * Math.sin(u * Math.PI) * 0.75;
    });
  });
  return (
    <group>
      {/* brazier: a stone basin with stacked wood */}
      <mesh position={[0, B.h + 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.0, 0.8, 0.8, 10]} />
        <meshStandardMaterial color="#6f5a48" roughness={0.9} />
      </mesh>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <mesh key={k} position={[0, B.h + 0.95 + Math.floor(k / 2) * 0.16, 0]} rotation={[0, (k * Math.PI) / 3, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.07, 0.07, 1.5, 5]} />
          <meshStandardMaterial color="#4a3020" roughness={0.95} />
        </mesh>
      ))}
      <mesh ref={fire} position={[0, B.h + 2.0, 0]} material={fireMat}>
        <coneGeometry args={[0.85, 2.4, 10, 4, true]} />
      </mesh>
      <pointLight ref={light} position={[0, B.h + 2.2, 0]} color="#ff8a3a" intensity={0} distance={26} decay={1.6} />
      {smoke.map((s, i) => (
        <sprite key={i} ref={(el) => (smokeRefs.current[i] = el)}>
          <spriteMaterial map={tex} color="#2a221e" transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}
      {/* flag pole at the corner of the platform */}
      <mesh position={[B.half - 0.4, B.h + 2.2, B.half - 0.4]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 4.4, 6]} />
        <meshStandardMaterial color="#3b2a1e" roughness={0.9} />
      </mesh>
      <mesh position={[B.half - 0.4 + 0.65, B.h + 3.8, B.half - 0.4]}>
        <planeGeometry args={[1.3, 0.85]} />
        <meshStandardMaterial ref={flag} color="#9a8a74" side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
    </group>
  );
}

function Wells() {
  return (
    <group>
      {DESERT.wells.map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.85, 0.92, 0.84, 14, 1, true]} />
            <meshStandardMaterial color="#8a7a68" roughness={0.95} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0.84, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.62, 0.92, 16]} />
            <meshStandardMaterial color="#a39280" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.3, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.62, 16]} />
            <meshStandardMaterial color="#1c2a30" roughness={0.1} metalness={0.2} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.7, 1.4, 0]} castShadow>
              <boxGeometry args={[0.12, 1.3, 0.12]} />
              <meshStandardMaterial color="#5a3d26" roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[0, 1.95, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.09, 0.09, 1.5, 8]} />
            <meshStandardMaterial color="#6b4a2e" roughness={0.85} />
          </mesh>
          <mesh position={[0.25, 1.35, 0]}>
            <cylinderGeometry args={[0.13, 0.11, 0.25, 8]} />
            <meshStandardMaterial color="#4a3020" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// props: crates, tents, carts, dead poplars, yardangs, mesas
// ---------------------------------------------------------------
function Props() {
  const pillars = MAPS.desert.pillars!;
  const strata = useMemo(() => makeStrataMaterial(), []);
  const { yardangs, poplars } = useMemo(() => {
    const rand = seeded(5);
    const ys: THREE.BufferGeometry[] = [];
    const ps: THREE.BufferGeometry[] = [];
    for (const p of pillars) {
      if (p.h !== undefined) continue;
      if (p.r >= 2) {
        // a yardang: a long whale-back ridge of hard clay, streamlined along the wind (x)
        const g = new THREE.IcosahedronGeometry(1, 3);
        const pos = g.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          const n = vnoise(x * 2.5 + p.x, y * 3 + p.z) * 0.25;
          pos.setXYZ(i, x * (1.35 + n), Math.max(-0.2, y) * (1 + n), z * (0.95 + n));
        }
        const h = 4 + rand() * 4;
        g.scale(p.r, h, p.r);
        g.translate(p.x, desertHeight(p.x, p.z) - 0.4, p.z);
        g.computeVertexNormals();
        ys.push(g);
      } else if (p.r >= 1.1 && p.r < 1.8) {
        const g = new THREE.DodecahedronGeometry(p.r, 1);
        g.scale(1.2, 1.4, 1);
        g.translate(p.x, desertHeight(p.x, p.z) + p.r * 0.5, p.z);
        ys.push(g);
      } else if (p.r < 0.6) {
        // dead poplar: a twisted trunk and bare forked branches
        const trunk = new THREE.CylinderGeometry(0.22, 0.42, 4.2, 7, 6);
        const tp = trunk.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < tp.count; i++) {
          const y = tp.getY(i);
          tp.setX(i, tp.getX(i) + Math.sin(y * 1.3 + p.x) * 0.25);
          tp.setZ(i, tp.getZ(i) + Math.cos(y * 1.1 + p.z) * 0.2);
        }
        trunk.translate(p.x, desertHeight(p.x, p.z) + 2.0, p.z);
        ps.push(trunk);
        for (let b = 0; b < 5; b++) {
          const L = 1.4 + rand() * 1.8;
          const br = new THREE.CylinderGeometry(0.05, 0.13, L, 5);
          br.translate(0, L / 2, 0);
          br.rotateZ(0.5 + rand() * 0.7);
          br.rotateY(rand() * Math.PI * 2);
          br.translate(p.x, desertHeight(p.x, p.z) + 2.6 + rand() * 1.4, p.z);
          ps.push(br);
        }
      }
    }
    return { yardangs: mergeGeometries(ys.map(nonIndexed), false)!, poplars: mergeGeometries(ps.map(nonIndexed), false)! };
  }, [pillars]);
  const mesas = useMemo(() => {
    const out: THREE.BufferGeometry[] = [];
    for (const M of DESERT.mesas) {
      const g = new THREE.BoxGeometry(M.hx * 2, M.h + 1, M.hz * 2, 16, 6, 20);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const top = y > (M.h + 1) / 2 - 0.01;
        // sides fluted by wind: pushed in and out a little (never outward past the collision box by much)
        const n = (vnoise(x * 0.6 + y * 0.8, z * 0.6 - y * 0.5) - 0.6) * 0.7;
        const sx = Math.abs(x) > M.hx - 0.01 ? Math.sign(x) * n : 0;
        const sz = Math.abs(z) > M.hz - 0.01 ? Math.sign(z) * n : 0;
        pos.setXYZ(i, x + (top ? 0 : sx), y, z + (top ? 0 : sz));
      }
      g.translate(M.x, (M.h + 1) / 2 - 1, 0);
      g.computeVertexNormals();
      out.push(g);
    }
    return mergeGeometries(out.map(nonIndexed), false)!;
  }, []);
  const crates = pillars.filter((p) => p.h !== undefined && p.h <= 1.05 && !DESERT.wells.some(([x, z]) => x === p.x && z === p.z));
  const carts = pillars.filter((p) => p.h !== undefined && Math.abs(p.h - 1.1) < 0.01);
  const tents = pillars.filter((p) => p.h === undefined && p.r > 1.8 && p.r < 2);
  return (
    <group>
      <mesh geometry={yardangs} material={strata} castShadow receiveShadow />
      <mesh geometry={mesas} material={strata} castShadow receiveShadow />
      <mesh geometry={poplars} castShadow>
        <meshStandardMaterial color="#6e5a48" roughness={0.95} />
      </mesh>
      {crates.map((p, i) => (
        <group key={'c' + i} position={[p.x, desertHeight(p.x, p.z), p.z]} rotation={[0, i * 0.7, 0]}>
          <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.25, 1.0, 1.25]} />
            <meshStandardMaterial color="#8a6440" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[1.29, 0.12, 1.29]} />
            <meshStandardMaterial color="#4a3422" roughness={0.8} />
          </mesh>
        </group>
      ))}
      {carts.map((p, i) => (
        <group key={'k' + i} position={[p.x, desertHeight(p.x, p.z), p.z]} rotation={[0, i * 1.3 + 0.4, 0]}>
          <mesh position={[0, 0.85, 0]} castShadow>
            <boxGeometry args={[1.5, 0.5, 1.0]} />
            <meshStandardMaterial color="#7a5434" roughness={0.9} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[0, 0.55, s * 0.56]} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <torusGeometry args={[0.5, 0.06, 6, 14]} />
              <meshStandardMaterial color="#3a2818" roughness={0.9} />
            </mesh>
          ))}
          <mesh position={[1.4, 0.6, 0]} rotation={[0, 0, 0.25]}>
            <boxGeometry args={[1.6, 0.06, 0.06]} />
            <meshStandardMaterial color="#5a3d26" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {tents.map((p, i) => (
        <group key={'t' + i} position={[p.x, desertHeight(p.x, p.z), p.z]}>
          <mesh position={[0, 0.8, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[p.r, p.r * 1.03, 1.6, 14]} />
            <meshStandardMaterial color={p.z > 0 ? '#e8d9bc' : '#d9cdb5'} roughness={0.95} />
          </mesh>
          <mesh position={[0, 2.2, 0]} castShadow>
            <coneGeometry args={[p.r * 1.06, 1.3, 14]} />
            <meshStandardMaterial color={p.z > 0 ? '#9b2c1f' : '#2c4a7a'} roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.7, p.z > 0 ? -p.r - 0.01 : p.r + 0.01]} rotation={[0, p.z > 0 ? Math.PI : 0, 0]}>
            <planeGeometry args={[0.8, 1.4]} />
            <meshStandardMaterial color="#3a2a1c" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** campfires in the two camps (fire sprites; one shared light each) */
function Campfires() {
  const spots = useMemo(() => [DESERT.spawnS, DESERT.spawnN].map(([x, z]) => [x, desertHeight(x, z + (z > 0 ? 6 : -6)), z + (z > 0 ? 6 : -6)] as [number, number, number]), []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uT: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `varying vec2 vUv; uniform float uT;
          ${GLSL_NOISE}
          void main(){
            float n = noise(vec2(vUv.x * 5.0, vUv.y * 3.0 - uT * 3.5));
            float a = (1.0 - vUv.y) * smoothstep(0.0, 0.3, vUv.y + n * 0.25) * (0.5 + n * 0.7);
            vec3 col = mix(vec3(1.0, 0.85, 0.45), vec3(1.0, 0.35, 0.06), vUv.y + n * 0.3);
            gl_FragColor = vec4(col * a * 1.5, a);
          }`,
      }),
    []
  );
  useFrame((st) => {
    mat.uniforms.uT.value = st.clock.elapsedTime;
  });
  return (
    <group>
      {spots.map((p, i) => (
        <group key={i} position={p}>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <mesh key={k} position={[Math.cos(k) * 0.55, 0.1, Math.sin(k) * 0.55]}>
              <dodecahedronGeometry args={[0.18, 0]} />
              <meshStandardMaterial color="#6b6058" roughness={1} />
            </mesh>
          ))}
          <mesh position={[0, 0.65, 0]} material={mat}>
            <coneGeometry args={[0.45, 1.3, 8, 3, true]} />
          </mesh>
          <pointLight position={[0, 1.0, 0]} color="#ff9a4a" intensity={10} distance={12} decay={1.8} />
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// the sandstorm: a wall of dust on the horizon before it comes,
// then driving sand round the camera
// ---------------------------------------------------------------
function DustWall() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false,
        uniforms: { uT: { value: 0 }, uA: { value: 0 }, uWind: { value: 1 }, uSwarm: { value: 0 } },
        vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `varying vec3 vP; uniform float uT; uniform float uA; uniform float uWind; uniform float uSwarm;
          ${GLSL_NOISE}
          void main(){
            float a = atan(vP.z, vP.x);
            float y = vP.y / 120.0;
            float n = fbm(vec2(a * 6.0 - uT * 0.05 * uWind, y * 3.0 - uT * 0.04));
            // it comes from upwind: thicker on that side
            float side = 0.55 + 0.45 * (-cos(a) * uWind);
            float al = smoothstep(1.0, 0.1, y) * (0.35 + n * 0.8) * side * uA;
            vec3 col = mix(vec3(0.72, 0.5, 0.3), vec3(0.88, 0.68, 0.45), n);
            // the insect swarm: a seething black-brown mass, flickering as it churns
            float churn = noise(vec2(a * 40.0 + uT * 2.0 * uWind, y * 30.0 - uT * 1.5));
            col = mix(col, vec3(0.08, 0.06, 0.05) + churn * 0.08, uSwarm);
            al = max(al, uSwarm * smoothstep(1.0, 0.0, y) * (0.55 + n * 0.5) * (0.4 + 0.6 * side));
            gl_FragColor = vec4(col, clamp(al, 0.0, 0.97));
          }`,
      }),
    []
  );
  useFrame((st) => {
    const D = mapRuntime.desert;
    mat.uniforms.uT.value = st.clock.elapsedTime;
    mat.uniforms.uA.value = Math.max(D.warn * 0.9, D.sand);
    mat.uniforms.uWind.value = D.wind;
    mat.uniforms.uSwarm.value = Math.max(D.swarmWarn, D.swarm);
  });
  return (
    <mesh material={mat} position={[0, -5, 0]}>
      <cylinderGeometry args={[240, 240, 120, 64, 1, true]} />
    </mesh>
  );
}

function SandStorm() {
  const COUNT = 900;
  const ref = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => {
    const rand = seeded(13);
    return Array.from({ length: COUNT }, () => [rand(), rand(), rand(), 0.6 + rand() * 0.8]);
  }, []);
  const mat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({ color: '#d8ad78', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    []
  );
  const geo = useMemo(() => new THREE.PlaneGeometry(0.9, 0.035), []);
  const M = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const D = mapRuntime.desert;
    const a = D.sand;
    m.visible = a > 0.02;
    if (!m.visible) return;
    mat.opacity = a * 0.55;
    const cam = st.camera.position;
    const t = st.clock.elapsedTime;
    const size = 26;
    q.setFromAxisAngle(v.set(0, 0, 1), -0.08 * D.wind);
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];
      const speed = 18 * s[3];
      let x = ((s[0] * size + t * speed * D.wind) % size + size) % size - size / 2;
      const y = s[1] * 7 - 1.5;
      const z = s[2] * size - size / 2;
      x += cam.x;
      v.set(x, cam.y + y - 1.5, cam.z + z);
      sc.set(D.wind * (0.6 + s[3]), 1, 1);
      M.compose(v, q, sc);
      m.setMatrixAt(i, M);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, COUNT]} frustumCulled={false} />;
}

/** the 飞虫沙暴 swarm round the camera: thousands of dark flecks whirling downwind */
function Swarm() {
  const COUNT = 1600;
  const ref = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => {
    const rand = seeded(29);
    return Array.from({ length: COUNT }, () => [rand(), rand(), rand(), 0.5 + rand(), rand() * 6.28]);
  }, []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#17110c', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false }), []);
  const geo = useMemo(() => new THREE.PlaneGeometry(0.09, 0.05), []);
  const M = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  useFrame((st) => {
    const m = ref.current;
    if (!m) return;
    const D = mapRuntime.desert;
    const a = Math.max(D.swarm, D.swarmWarn > 0.75 ? (D.swarmWarn - 0.75) * 1.2 : 0);
    m.visible = a > 0.02;
    if (!m.visible) return;
    mat.opacity = Math.min(1, a * 1.2);
    const cam = st.camera.position;
    const t = st.clock.elapsedTime;
    const size = 22;
    const n = Math.floor(COUNT * Math.min(1, a));
    for (let i = 0; i < COUNT; i++) {
      const s = seeds[i];
      if (i >= n) {
        M.makeScale(0, 0, 0);
        m.setMatrixAt(i, M);
        continue;
      }
      const sp = 7 * s[3];
      const x = ((((s[0] * size + t * sp * D.wind) % size) + size) % size) - size / 2;
      // each one loops and dives as it goes
      const y = s[1] * 6 - 1 + Math.sin(t * 3 * s[3] + s[4]) * 0.6;
      const z = s[2] * size - size / 2 + Math.cos(t * 2.3 * s[3] + s[4]) * 0.8;
      v.set(cam.x + x, cam.y + y - 1.5, cam.z + z);
      e.set(t * 9 + s[4], t * 4 * s[3], Math.sin(t * 30 + s[4]) * 1.2);
      q.setFromEuler(e);
      sc.set(1, 0.4 + Math.abs(Math.sin(t * 40 + s[4] * 3)), 1); // wings beating
      M.compose(v, q, sc);
      m.setMatrixAt(i, M);
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, mat, COUNT]} frustumCulled={false} />;
}

/** low drifting sand streams skimming the dunes even on a calm day */
function SandDrifts() {
  const tex = useMemo(() => cloudPuffTexture(), []);
  const items = useMemo(() => {
    const rand = seeded(17);
    return Array.from({ length: 16 }, () => {
      const a = rand() * Math.PI * 2;
      const r = 26 + rand() * 40;
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: 4 + rand() * 4, ph: rand() * 6, sp: 0.25 + rand() * 0.3 };
    });
  }, []);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const D = mapRuntime.desert;
    items.forEach((it, i) => {
      const s = refs.current[i];
      if (!s) return;
      const drift = ((t * it.sp + it.ph) % 6) / 6;
      const x = it.x + drift * 10 * D.wind;
      s.position.set(x, desertHeight(x, it.z) + 0.5, it.z);
      (s.material as THREE.SpriteMaterial).opacity = Math.sin(drift * Math.PI) * (0.3 + D.sand * 0.5);
    });
  });
  return (
    <group>
      {items.map((it, i) => (
        <sprite key={i} ref={(el) => (refs.current[i] = el)} scale={[it.s * 2.6, it.s * 0.45, 1]}>
          <spriteMaterial map={tex} color="#e8c48e" transparent depthWrite={false} opacity={0.3} />
        </sprite>
      ))}
    </group>
  );
}

/** distant 烽燧 watchtowers on the dune crests, a line of the old Han wall */
function DistantWatchtowers() {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const spots: [number, number][] = [
      [-150, -120],
      [170, -60],
      [120, 170],
      [-190, 90],
      [40, -210],
    ];
    for (const [x, z] of spots) {
      const g = new THREE.CylinderGeometry(3.2, 4.6, 11, 4);
      g.rotateY(Math.PI / 4);
      g.translate(x, 9, z);
      parts.push(g);
    }
    // the old wall, worn down to a low ridge running off across the dunes
    for (let k = 0; k < 40; k++) {
      const x = -260 + k * 13;
      const z = -150 + Math.sin(k * 0.3) * 18;
      const g = new THREE.BoxGeometry(12.5, 2.5 + Math.sin(k * 1.7) * 1.2, 2.6);
      g.translate(x, 6, z);
      parts.push(g);
    }
    return mergeGeometries(parts.map(nonIndexed), false)!;
  }, []);
  const mat = useMemo(() => makeEarthMaterial('#b08458', 0.3), []);
  return <mesh geometry={geo} material={mat} />;
}

export function DesertMap() {
  const banners = useMemo(() => {
    const out: { p: [number, number, number]; r: number; c: string }[] = [];
    for (const sz of [1, -1]) for (const sx of [1, -1]) out.push({ p: [sx * (F.tower - 0.8), F.towerH, sz * (F.half + 0.4)], r: sz > 0 ? 0 : Math.PI, c: '#9b1c1c' });
    for (const sx of [1, -1]) for (const sz of [1, -1]) out.push({ p: [sx * (F.half - 0.6), F.corner, sz * (F.half - 0.6)], r: Math.atan2(sx, sz), c: '#7a1414' });
    out.push({ p: [-11, 0, DESERT.spawnS[1] + 1], r: 0, c: '#9b2c1f' }, { p: [11, 0, DESERT.spawnN[1] - 1], r: Math.PI, c: '#2c4a7a' });
    return out;
  }, []);
  return (
    <group>
      <Sky zenith="#5d86b8" horizon="#f2cf9a" below="#d7aa72" sunDir={[SUN.x, SUN.y, SUN.z]} sunColor="#ffd9a0" sunSize={1.6} streaks={0.35} streakColor="#fbe6c6" />
      <FarDunes />
      <DistantWatchtowers />
      <Sand />
      <FortWalls />
      <GatePavilion z={F.half - F.wall / 2} />
      <GatePavilion z={-(F.half - F.wall / 2)} />
      <Beacon />
      <Wells />
      <Barracks />
      <Props />
      <Campfires />
      {banners.map((b, i) => (
        <Banner key={i} position={b.p} rotationY={b.r} color={b.c} trim="#d4a017" height={2.4} width={0.9} pole={4} />
      ))}
      <SandDrifts />
      <DustWall />
      <SandStorm />
      <Swarm />
    </group>
  );
}
