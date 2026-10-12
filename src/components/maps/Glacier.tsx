import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { MAPS, GLACIER, GLACIER_PINES, GLACIER_ROCKS, glacierHeight, glacierPath, mapRuntime } from '../../maps';
import { Sky, seeded, GLSL_NOISE, cloudPuffTexture } from '../Scenery';

// ==================================================================
// 雪岭冰峰: one great snow mountain in a ring of high peaks.
// The ground mesh is sampled from glacierHeight(), the same function
// the physics uses; everything else is decoration placed on top of it.
// ==================================================================

/** where the low sun sits (world direction) */
const SUN = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();

// ---------------------------------------------------------------
// small JS noise for building geometry
// ---------------------------------------------------------------
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
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
/** ridged multifractal: sharp crests, the look of real alpine ridgelines */
function ridged(x: number, y: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  let prev = 1;
  for (let o = 0; o < 3; o++) {
    let n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1);
    n *= n;
    sum += n * amp * prev;
    prev = n;
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// ---------------------------------------------------------------
// shared shader bits for snow / rock / ice
// ---------------------------------------------------------------
const SNOW_GLSL = /* glsl */ `
  ${GLSL_NOISE}
  // three-octave fbm: plenty for terrain detail and a fraction of the cost
  float fbm3(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125; }
  // wind-carved snow ripples (sastrugi): stretched noise running across the wind
  float snowH(vec3 p){
    return fbm3(vec2(p.x * 0.9 + p.z * 0.35, p.z * 2.6 - p.x * 0.6)) * 0.6 + noise(p.xz * 7.0) * 0.12;
  }
  // fbm projected along the dominant axis of the normal (two projections blended), so steep faces are not smeared
  float tri(vec3 p, vec3 n, float sc){
    vec3 a = abs(n);
    float side = a.x > a.z ? fbm3(p.zy * sc) : fbm3(p.xy * sc);
    float top = fbm3(p.xz * sc);
    return mix(side, top, smoothstep(0.55, 0.8, a.y));
  }
  // broken rock: blocky facets
  float rockH(vec3 p){
    float a = fbm3(vec2(p.y * 2.2 + p.x * 0.3, (p.x - p.z) * 1.1));
    float b = noise(vec2(p.y * 6.0, (p.x + p.z) * 3.0));
    return a * 0.8 + b * 0.25;
  }
`;

/**
 * MeshStandardMaterial with procedural snow, rock and blue ice chosen per pixel from slope, height and noise,
 * detail normals, and glitter where the sun catches the snow.
 * Expects an attribute aInfo = (road amount, distance to road centre, avalanche chute).
 */
function makeTerrainMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, color: '#ffffff' });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSun = { value: SUN };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aInfo;\nvarying vec3 vInfo;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = aInfo;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uSun;
        varying vec3 vInfo; varying vec3 vWP; varying vec3 vWN;
        ${SNOW_GLSL}
        float gSnow; float gIce; float gRock;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 nW = normalize(vWN);
          float slope = 1.0 - nW.y;
          float jitter = (tri(vWP, nW, 0.3) - 0.5) * 0.34 + (noise(vWP.xz * 2.2 + vWP.y * 1.7) - 0.5) * 0.14;
          // snow clings to anything gentler than the steep risers; crisp edges, like real snow on rock
          gSnow = 1.0 - smoothstep(0.4, 0.43, slope + jitter);
          // exposed glacier ice on some risers of the upper mountain
          float iceMask = smoothstep(0.63, 0.7, fbm3(vWP.xz * 0.15 + 9.0));
          gIce = (1.0 - gSnow) * smoothstep(6.0, 9.0, vWP.y) * iceMask;
          gRock = 1.0 - gSnow - gIce;
          float rh = rockH(vWP);
          float rt = tri(vWP, nW, 1.3);
          vec3 rock = mix(vec3(0.11, 0.115, 0.13), vec3(0.3, 0.29, 0.28), smoothstep(0.3, 0.75, rt));
          rock *= 0.8 + 0.4 * noise(vWP.xy * 5.0 + vWP.zy * 3.0);
          // snow caught on little ledges of the rock
          rock = mix(rock, vec3(0.84, 0.87, 0.92), smoothstep(0.6, 0.66, tri(vWP + 3.0, nW, 2.6)) * 0.85);
          vec3 snow = vec3(0.84, 0.86, 0.9);
          // faces turned from the sun go cool blue, like real snow in shade
          snow = mix(snow, vec3(0.7, 0.8, 0.95), smoothstep(0.25, -0.35, dot(nW, uSun)) * 0.45);
          // a few dirty streaks on the valley floor
          snow *= 1.0 - smoothstep(0.6, 0.9, noise(vWP.xz * 0.08)) * 0.06 * (1.0 - smoothstep(0.0, 3.0, vWP.y));
          vec3 ice = mix(vec3(0.28, 0.48, 0.62), vec3(0.6, 0.78, 0.9), tri(vWP, nW, 1.2));
          vec3 col = snow * gSnow + rock * gRock + ice * gIce;
          // the road: packed, slightly grey snow with two brown wheel ruts
          float road = vInfo.x;
          vec3 packed = vec3(0.78, 0.79, 0.8) - noise(vWP.xz * 4.0) * 0.05;
          col = mix(col, packed, road * 0.85);
          float rut = (1.0 - smoothstep(0.08, 0.28, abs(vInfo.y - 0.7))) * road;
          col = mix(col, vec3(0.42, 0.36, 0.3), rut * 0.6 * (0.7 + noise(vWP.xz * 6.0) * 0.6));
          // fresh avalanche debris in the chute: lumpy and brighter
          col = mix(col, vec3(0.97, 0.98, 1.0), vInfo.z * 0.35 * gSnow);
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = gSnow * 0.72 + gRock * 0.92 + gIce * 0.32;
        roughnessFactor = mix(roughnessFactor, 0.85, vInfo.x);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // bump mapping from one procedural height, using screen-space derivatives (two evaluations, not eight)
          vec3 nW = normalize(vWN);
          float H = (snowH(vWP) * 0.06 * (gSnow * (1.0 - vInfo.x * 0.7) + gIce * 0.3) + rockH(vWP) * 0.16 * gRock);
          vec3 sx = dFdx(vWP);
          vec3 sy = dFdy(vWP);
          vec3 r1 = cross(sy, nW);
          vec3 r2 = cross(nW, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
          vec3 nP = normalize(abs(det) * nW - grad * 3.2);
          normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
        }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // glitter: tiny ice crystals flash when they mirror the sun into the camera
          vec3 V = normalize(cameraPosition - vWP);
          vec3 nW = normalize(vWN);
          vec3 cell = floor(vWP * 38.0);
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          vec3 facet = normalize(nW + (vec3(fract(h * 13.1), fract(h * 71.7), fract(h * 37.3)) - 0.5) * 0.9);
          float spec = pow(max(dot(reflect(-uSun, facet), V), 0.0), 60.0);
          float dist = length(cameraPosition - vWP);
          totalEmissiveRadiance += vec3(1.0, 0.97, 0.9) * step(0.93, h) * spec * gSnow * 6.0 * (1.0 - smoothstep(6.0, 22.0, dist));
          // a faint inner glow in the ice
          totalEmissiveRadiance += vec3(0.02, 0.06, 0.09) * gIce;
        }`
      );
  };
  return m;
}

// ---------------------------------------------------------------
// terrain mesh
// ---------------------------------------------------------------
function terrainGeometry() {
  const size = 216;
  const seg = 432; // 0.5 m
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const info = new Float32Array(pos.count * 3);
  const [sx, sz] = GLACIER.summit;
  const cx = (GLACIER.avalancheX[0] + GLACIER.avalancheX[1]) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, glacierHeight(x, z));
    let road = 0;
    let d = 9;
    if (Math.hypot(x - sx, z - sz) < GLACIER.footR + 4) {
      const p = glacierPath(x, z);
      d = p.d;
      road = 1 - THREE.MathUtils.smoothstep(d, GLACIER.pathHalf - 0.25, GLACIER.pathHalf + 0.35);
    }
    const chute = (1 - THREE.MathUtils.smoothstep(Math.abs(x - cx), 3, 7)) * (z > GLACIER.avalancheTop && z < GLACIER.avalancheEnd ? 1 : 0);
    info[i * 3] = road;
    info[i * 3 + 1] = d;
    info[i * 3 + 2] = chute;
  }
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
  g.computeVertexNormals();
  return g;
}

function Terrain() {
  const geo = useMemo(() => terrainGeometry(), []);
  const mat = useMemo(() => makeTerrainMaterial(), []);
  return <mesh geometry={geo} material={mat} receiveShadow castShadow />;
}

// ---------------------------------------------------------------
// the ring of high peaks all round the valley
// ---------------------------------------------------------------
function AlpineRange() {
  const { geo, mat } = useMemo(() => {
    const nA = 540;
    const nR = 90;
    const r0 = 104;
    const r1 = 520;
    const pos: number[] = [];
    const col: number[] = [];
    const haze: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    const rockA = new THREE.Color('#2c3038');
    const rockB = new THREE.Color('#4c4f57');
    const snowC = new THREE.Color('#f2f5fa');
    const heights: number[] = [];
    for (let j = 0; j <= nR; j++) {
      const t = j / nR;
      const r = r0 + (r1 - r0) * Math.pow(t, 1.6);
      for (let i = 0; i <= nA; i++) {
        const a = (i / nA) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const base = glacierHeight(Math.cos(a) * r0, Math.sin(a) * r0);
        // massifs come and go round the horizon; ridged noise gives knife-edge crests
        const massif = 0.45 + 0.55 * vnoise(Math.cos(a) * 2.2 + 7, Math.sin(a) * 2.2 + 3);
        const env = THREE.MathUtils.smoothstep(r, r0, r0 + 70) * (1 - THREE.MathUtils.smoothstep(r, 300, 520) * 0.6);
        const h = base + env * (25 + 165 * massif * ridged(x * 0.006, z * 0.006));
        heights.push(h);
        pos.push(x, h, z);
      }
    }
    // colours from slope and altitude, computed from neighbours
    for (let j = 0; j <= nR; j++)
      for (let i = 0; i <= nA; i++) {
        const k = j * (nA + 1) + i;
        const h = heights[k];
        const hj = heights[Math.min(nR, j + 1) * (nA + 1) + i];
        const hi = heights[j * (nA + 1) + Math.min(nA, i + 1)];
        const r = Math.hypot(pos[k * 3], pos[k * 3 + 2]);
        const dr = (r0 + (r1 - r0) * Math.pow(Math.min(1, (j + 1) / nR), 1.6)) - r || 1;
        const da = ((Math.PI * 2) / nA) * r;
        const slope = Math.hypot((hj - h) / dr, (hi - h) / da);
        const n = vnoise(pos[k * 3] * 0.05, pos[k * 3 + 2] * 0.05);
        const snowy = 1 - THREE.MathUtils.smoothstep(slope + (n - 0.5) * 0.5 - h * 0.002, 0.65, 1.0);
        c.copy(rockA).lerp(rockB, vnoise(h * 0.1, n * 4));
        c.lerp(snowC, snowy);
        col.push(c.r, c.g, c.b);
        haze.push(0.18 + THREE.MathUtils.smoothstep(r, 80, 420) * 0.72);
      }
    for (let j = 0; j < nR; j++)
      for (let i = 0; i < nA; i++) {
        const a = j * (nA + 1) + i;
        const b = a + 1;
        const d = a + nA + 1;
        const e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aHaze', new THREE.Float32BufferAttribute(haze, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, fog: false });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHaze = { value: new THREE.Color('#b9c8da') };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aHaze;\nvarying float vHaze;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHaze = aHaze;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nvarying float vHaze;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, vHaze);');
    };
    return { geo, mat };
  }, []);
  return <mesh geometry={geo} material={mat} receiveShadow />;
}

// ---------------------------------------------------------------
// snow-laden spruces: one merged, vertex-coloured tree, instanced
// ---------------------------------------------------------------
/** Needle texture for the branch tiers: grey brush strokes (the vertex colour gives the hue), ragged lower fringe */
let needleTex: THREE.Texture | null = null;
function needleTexture() {
  if (needleTex) return needleTex;
  const W = 256;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rand = seeded(29);
  g.clearRect(0, 0, W, H);
  // solid base so the tier reads as a mass of foliage, a little transparent at the very bottom
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(150,150,150,1)');
  grd.addColorStop(0.8, 'rgba(120,120,120,1)');
  grd.addColorStop(1, 'rgba(90,90,90,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H * 0.78);
  // needle sprays falling outward and down
  for (let i = 0; i < 2600; i++) {
    const x = rand() * W;
    const y = rand() * H * 0.95;
    const len = 6 + rand() * 18;
    const v = 120 + rand() * 135;
    g.strokeStyle = `rgba(${v},${v},${v},${0.5 + rand() * 0.5})`;
    g.lineWidth = 1 + rand() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 6, y + len);
    g.stroke();
  }
  // a corner patch of solid grey for the trunk's UVs
  g.fillStyle = 'rgb(140,140,140)';
  g.fillRect(0, 0, 10, 10);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  needleTex = t;
  return t;
}

function spruceGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const rand = seeded(17);
  const needle = new THREE.Color('#1c3628');
  const needleLight = new THREE.Color('#2f5038');
  const snow = new THREE.Color('#f3f6fa');
  const bark = new THREE.Color('#3a2a1f');
  const tiers = 9;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    // two skirts per tier, slightly offset, so the foliage has depth instead of one smooth cone
    for (const layer of [0, 1]) {
      const r = 1.45 * (1 - f * 0.82) * (layer ? 0.8 : 1);
      const h = (1.0 - f * 0.4) * (layer ? 0.9 : 1);
      const y = 0.6 + t * 0.5 + layer * 0.12;
      const g = new THREE.ConeGeometry(r, h, 18, 3, true);
      g.rotateY(rand() * 6);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i);
        const vy = p.getY(i);
        const vz = p.getZ(i);
        const rr = Math.hypot(vx, vz);
        const ang = Math.atan2(vz, vx);
        // branches poke out in lobes, and sag at the tips
        const lobe = 1 + Math.sin(ang * 7 + t * 1.3) * 0.12 + (rand() - 0.5) * 0.08;
        const droop = rr > r * 0.7 ? -0.22 * ((rr / r - 0.7) / 0.3) : 0;
        p.setXYZ(i, vx * lobe, vy + droop, vz * lobe);
      }
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 3);
      g.translate(0, y, 0);
      g.computeVertexNormals();
      const n = g.attributes.normal as THREE.BufferAttribute;
      const cols = new Float32Array(p.count * 3);
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        c.copy(needle).lerp(needleLight, 0.3 + rand() * 0.3).multiplyScalar(layer ? 0.8 : 1);
        // snow on the upper face of each skirt, heavier on the outer layer
        const up = n.getY(i);
        if (!layer && up > 0.3) c.lerp(snow, Math.min(0.8, (up - 0.3) * 1.8) * (0.55 + rand() * 0.4));
        cols.set([c.r, c.g, c.b], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      parts.push(g.toNonIndexed());
    }
  }
  const trunk = new THREE.CylinderGeometry(0.08, 0.17, 1.4, 8).translate(0, 0.7, 0).toNonIndexed();
  const tc = new Float32Array((trunk.attributes.position as THREE.BufferAttribute).count * 3);
  for (let i = 0; i < tc.length; i += 3) tc.set([bark.r, bark.g, bark.b], i);
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const tuv = trunk.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < tuv.count; i++) tuv.setXY(i, 0.01, 0.99);
  parts.push(trunk);
  // merge by hand
  let count = 0;
  for (const g of parts) count += (g.attributes.position as THREE.BufferAttribute).count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  let o = 0;
  for (const g of parts) {
    const p = g.attributes.position as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, o * 3);
    nor.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, o * 3);
    col.set((g.attributes.color as THREE.BufferAttribute).array as Float32Array, o * 3);
    uvs.set((g.attributes.uv as THREE.BufferAttribute).array as Float32Array, o * 2);
    o += p.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return m;
}

function Spruces({ spots }: { spots: [number, number, number][] }) {
  const mesh = useMemo(() => {
    const geo = spruceGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: needleTexture(), alphaTest: 0.45, roughness: 0.9, side: THREE.DoubleSide });
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const rand = seeded(4);
    spots.forEach(([x, z, s], i) => {
      // sink the trunk a little so it never floats on a slope
      const y = Math.min(glacierHeight(x - 0.3, z), glacierHeight(x + 0.3, z), glacierHeight(x, z - 0.3), glacierHeight(x, z + 0.3)) - 0.15;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.9 + rand() * 0.3), s));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, [spots]);
  return <primitive object={mesh} />;
}

// ---------------------------------------------------------------
// weather
// ---------------------------------------------------------------
/** Snowfall in a box that follows the camera: big near flakes and fine far ones, driven by gusting wind */
function Snowfall() {
  const { camera } = useThree();
  const { pts, mat } = useMemo(() => {
    const n = 7000;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const rand = seeded(5);
    for (let i = 0; i < n; i++) {
      pos.set([rand() * 60, rand() * 40, rand() * 60], i * 3);
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; attribute float seed; varying float vA;
        void main(){
          float gust = 1.0 + 0.8 * sin(uTime * 0.37) * sin(uTime * 0.11 + 1.0);
          vec3 drift = vec3(uTime * (2.2 * gust) + sin(uTime * 0.7 + seed * 20.0) * 1.3, -uTime * (1.3 + seed * 1.3), uTime * 0.6 + cos(uTime * 0.5 + seed * 13.0) * 1.1);
          // wrap each flake into a 60 x 40 x 60 box centred on the camera
          vec3 p = mod(position + drift - uCam + vec3(30.0, 20.0, 30.0), vec3(60.0, 40.0, 60.0)) + uCam - vec3(30.0, 20.0, 30.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z;
          gl_PointSize = clamp((24.0 + seed * 46.0) / d, 1.0, 14.0);
          vA = (0.45 + seed * 0.55) * smoothstep(0.3, 2.0, d) * (1.0 - smoothstep(22.0, 30.0, d));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), pow(1.0 - d * 2.0, 1.4) * vA); }`,
    });
    return { pts: new THREE.Points(g, mat), mat };
  }, []);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    mat.uniforms.uCam.value.copy(camera.position);
  });
  pts.frustumCulled = false;
  return <primitive object={pts} />;
}

/** Spindrift: sheets of snow blown off the summit and the ridges */
function Spindrift() {
  const tex = useMemo(() => cloudPuffTexture(), []);
  const items = useMemo(() => {
    const rand = seeded(9);
    const out: { x: number; z: number; y: number; s: number; ph: number; sp: number }[] = [];
    const [sx, sz] = GLACIER.summit;
    // a long plume streaming off the summit downwind
    for (let k = 0; k < 14; k++) out.push({ x: sx + 1 + k * 2.4, z: sz - 0.5 - k * 0.8, y: GLACIER.summitH + 1 + k * 0.35, s: 3 + k * 0.6, ph: rand() * 6, sp: 0.5 + rand() * 0.5 });
    // low drifts skimming the valley floor
    for (let k = 0; k < 10; k++) {
      const a = rand() * Math.PI * 2;
      const r = 20 + rand() * 16;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      out.push({ x, z, y: glacierHeight(x, z) + 0.6, s: 5 + rand() * 4, ph: rand() * 6, sp: 0.3 + rand() * 0.4 });
    }
    return out;
  }, []);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    items.forEach((it, i) => {
      const s = refs.current[i];
      if (!s) return;
      const drift = ((t * it.sp + it.ph) % 6) / 6;
      s.position.set(it.x + drift * 6, it.y + Math.sin(t + it.ph) * 0.3, it.z - drift * 2);
      (s.material as THREE.SpriteMaterial).opacity = Math.sin(drift * Math.PI) * 0.5;
    });
  });
  return (
    <group>
      {items.map((it, i) => (
        <sprite key={i} ref={(el) => (refs.current[i] = el)} scale={[it.s * 2.2, it.s * 0.7, 1]}>
          <spriteMaterial map={tex} color="#ffffff" transparent depthWrite={false} opacity={0.4} />
        </sprite>
      ))}
    </group>
  );
}

/** High cloud banks drifting round the peaks */
function CloudBanks() {
  const tex = useMemo(() => cloudPuffTexture(), []);
  const items = useMemo(() => {
    const rand = seeded(12);
    return Array.from({ length: 26 }, () => ({ a: rand() * 6.28, r: 120 + rand() * 220, y: 45 + rand() * 70, s: 50 + rand() * 60, sp: 0.002 + rand() * 0.003 }));
  }, []);
  const ref = useRef<THREE.Group>(null);
  useFrame((st) => {
    const g = ref.current;
    if (!g) return;
    g.children.forEach((s, i) => {
      const it = items[i];
      const a = it.a + st.clock.elapsedTime * it.sp;
      s.position.set(Math.cos(a) * it.r, it.y, Math.sin(a) * it.r);
    });
  });
  return (
    <group ref={ref}>
      {items.map((it, i) => (
        <sprite key={i} scale={[it.s * 2, it.s * 0.6, 1]}>
          <spriteMaterial map={tex} color="#e8edf3" transparent depthWrite={false} opacity={0.75} fog={false} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// props
// ---------------------------------------------------------------
/** 经幡: strings of prayer flags from the summit pole down to the ledges */
function PrayerFlags({ top }: { top: THREE.Vector3 }) {
  const { geo, mat, lines } = useMemo(() => {
    const colors = ['#2563eb', '#f8fafc', '#dc2626', '#16a34a', '#facc15'].map((c) => new THREE.Color(c));
    const pos: number[] = [];
    const col: number[] = [];
    const ph: number[] = [];
    const lp: number[] = [];
    const ends = [0.4, 1.9, 3.5, 5.0].map((a) => {
      const x = top.x + Math.cos(a) * 7;
      const z = top.z + Math.sin(a) * 7;
      return new THREE.Vector3(x, glacierHeight(x, z) + 0.4, z);
    });
    for (const end of ends) {
      const n = 16;
      let prev = top.clone();
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const p = top.clone().lerp(end, t);
        p.y -= Math.sin(t * Math.PI) * 0.8;
        lp.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
        if (k === n) break;
        const c = colors[k % 5];
        // a small square flag hanging under the cord
        const w = 0.32;
        const h = 0.38;
        const dir = end.clone().sub(top).setY(0).normalize();
        const a = p.clone().addScaledVector(dir, -w / 2);
        const b = p.clone().addScaledVector(dir, w / 2);
        const quad = [a, b, b.clone().setY(b.y - h), a, b.clone().setY(b.y - h), a.clone().setY(a.y - h)];
        for (const v of quad) {
          pos.push(v.x, v.y, v.z);
          col.push(c.r, c.g, c.b);
          ph.push(k * 0.7 + v.y);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('ph', new THREE.Float32BufferAttribute(ph, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = { value: 0 };
      (mat as any).userData.sh = sh;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float ph;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(uTime * 6.0 + ph * 3.0) * 0.06;\ntransformed.z += cos(uTime * 5.0 + ph * 2.0) * 0.05;');
    };
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    return { geo, mat, lines: lg };
  }, [top]);
  useFrame((st) => {
    const sh = (mat as any).userData.sh;
    if (sh) sh.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <group>
      <mesh geometry={geo} material={mat} castShadow />
      <lineSegments geometry={lines}>
        <lineBasicMaterial color="#6b5a45" />
      </lineSegments>
    </group>
  );
}

/** Rock outcrops breaking through the snow on the flanks */
function Outcrops() {
  // positions come from maps.ts so they match the collision
  const items = useMemo(() => GLACIER_ROCKS.map((k) => ({ p: new THREE.Vector3(k.x, k.y, k.z), s: new THREE.Vector3(k.sx, k.sy, k.sz), r: new THREE.Euler(k.rx, k.ry, k.rz) })), []);
  const geo = useMemo(() => {
    const g = new THREE.DodecahedronGeometry(1, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    const rand = seeded(2);
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + rand() * 0.35;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group>
      {items.map((it, i) => (
        <mesh key={i} geometry={geo} position={it.p} scale={it.s} rotation={it.r} castShadow receiveShadow>
          <meshStandardMaterial color="#4b4a4c" roughness={0.95} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Avalanche: a churning wall of snow cloud with debris rolling ahead of it */
function Avalanche() {
  const ref = useRef<THREE.Group>(null);
  const puff = useMemo(() => cloudPuffTexture(), []);
  const N = 42;
  useFrame((st) => {
    const g = ref.current;
    if (!g) return;
    const z = mapRuntime.avalancheZ;
    g.visible = z > -900;
    if (!g.visible) return;
    const t = st.clock.elapsedTime;
    const [x0, x1] = GLACIER.avalancheX;
    g.children.forEach((s, i) => {
      const row = Math.floor(i / 14);
      const x = x0 - 1 + ((i % 14) / 13) * (x1 - x0 + 2);
      const zz = z - row * 1.8;
      s.position.set(x + Math.sin(t * 2 + i) * 0.5, glacierHeight(x, zz) + 1.0 + row * 1.2 + Math.sin(t * 3 + i) * 0.3, zz);
      const k = 4 + Math.sin(t * 3 + i * 1.3) * 0.7 + row * 1.2;
      s.scale.set(k * 1.5, k, 1);
    });
  });
  return (
    <group ref={ref} visible={false}>
      {Array.from({ length: N }, (_, i) => (
        <sprite key={i}>
          <spriteMaterial map={puff} color="#f8fafc" transparent depthWrite={false} opacity={0.95} />
        </sprite>
      ))}
    </group>
  );
}

export function GlacierMap() {
  const def = MAPS.glacier;
  const pines = GLACIER_PINES; // shared with the collision in maps.ts
  // wooden stakes with red ribbons along the outer (downhill) edge of the road
  const stakes = useMemo(() => {
    const out: [number, number, number][] = [];
    const [sx, sz] = GLACIER.summit;
    const pts = GLACIER.pathPts;
    for (let i = 4; i < pts.length; i += 14) {
      const [px, pz] = pts[i];
      const dx = px - sx;
      const dz = pz - sz;
      const l = Math.hypot(dx, dz) || 1;
      const x = px + (dx / l) * (GLACIER.pathHalf + 0.15);
      const z = pz + (dz / l) * (GLACIER.pathHalf + 0.15);
      out.push([x, glacierHeight(x, z) - 0.1, z]);
    }
    return out;
  }, []);
  const cairn = useMemo(() => {
    const x = GLACIER.summit[0] + 1.6;
    const z = GLACIER.summit[1] + 0.8;
    return new THREE.Vector3(x, glacierHeight(x, z), z);
  }, []);
  const flagTop = useMemo(() => cairn.clone().setY(cairn.y + 3.1), [cairn]);
  return (
    <group>
      <Sky zenith="#56739c" horizon="#e6e2dc" below="#c8d2dc" sunDir={[SUN.x, SUN.y, SUN.z]} sunColor="#ffe6c8" sunSize={1.4} streaks={0.55} streakColor="#f2eee9" />
      <CloudBanks />
      <AlpineRange />
      <Terrain />
      <Outcrops />
      <Spruces spots={pines} />
      {stakes.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh position={[0, 0.55, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.06, 1.1, 6]} />
            <meshStandardMaterial color="#4a3423" roughness={0.9} />
          </mesh>
          <mesh position={[0.12, 1.02, 0]} rotation={[0, 0, -0.3]}>
            <planeGeometry args={[0.3, 0.09]} />
            <meshStandardMaterial color="#b91c1c" side={THREE.DoubleSide} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* summit cairn and pole */}
      <group position={cairn}>
        {[0.55, 0.42, 0.3].map((r, k) => (
          <mesh key={k} position={[Math.sin(k * 2) * 0.08, 0.2 + k * 0.42, 0]} rotation={[0.2 * k, k, 0.1]} castShadow>
            <dodecahedronGeometry args={[r, 0]} />
            <meshStandardMaterial color="#5b6168" roughness={0.95} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 1.7, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.05, 2.9, 6]} />
          <meshStandardMaterial color="#3b2a1e" roughness={0.9} />
        </mesh>
      </group>
      <PrayerFlags top={flagTop} />
      {/* ice boulders you can jump onto */}
      {def.pillars!.map((p, i) => (
        <group key={i} position={[p.x, glacierHeight(p.x, p.z), p.z]}>
          {[0, 1, 2, 3, 4].map((k) => (
            <mesh
              key={k}
              position={[Math.cos(k * 1.3) * p.r * 0.35 * (k ? 1 : 0), ((p.h ?? 1.4) * (k ? 0.55 : 0.75)) / 2, Math.sin(k * 1.3) * p.r * 0.35 * (k ? 1 : 0)]}
              rotation={[Math.sin(k) * 0.3, k * 0.9, Math.cos(k * 1.7) * 0.3]}
              scale={[p.r * (k ? 0.55 : 0.9), (p.h ?? 1.4) * (k ? 0.65 : 1.05), p.r * (k ? 0.55 : 0.9)]}
              castShadow
            >
              <octahedronGeometry args={[1, 1]} />
              <meshPhysicalMaterial color="#a9dcf5" roughness={0.08} metalness={0} clearcoat={1} clearcoatRoughness={0.1} transparent opacity={0.9} emissive="#2a76ad" emissiveIntensity={0.15} flatShading />
            </mesh>
          ))}
        </group>
      ))}
      <Avalanche />
      <Spindrift />
      <Snowfall />
    </group>
  );
}
