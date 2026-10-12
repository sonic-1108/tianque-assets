import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { FOREST, riverZ, forestFloor, bridgeDeck, mapRuntime } from '../../maps';
import { Sky, seeded, GLSL_NOISE, cloudPuffTexture } from '../Scenery';

// ==================================================================
// 青冥古林: a clearing among thousand-year-old trees. Sunlight breaks
// through the canopy in shafts, a cold stream runs across the middle,
// fallen logs lie in the moss. Everything is built procedurally here.
// ==================================================================

/** the key light comes from (+8, +14, +6) relative to the player (see Game) */
const SUN = new THREE.Vector3(8, 14, 6).normalize();
const R = FOREST.radius; // arena radius

const RIVER_GLSL = /* glsl */ `
  float riverZ(float x){ return 2.0 + 6.0 * sin(x * 0.045 + 0.4) + 2.0 * sin(x * 0.11 + 1.3); }
`;
const floorAt = (x: number, z: number) => forestFloor(x, z);

/** shared uniforms: time and wind gust */
const shared = { uTime: { value: 0 }, uGust: { value: 0 } };

// ---------------------------------------------------------------
// canvas textures
// ---------------------------------------------------------------
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let leafTex: THREE.Texture | null = null;
/** a spray of broad leaves on twigs, for canopy cards */
function leafTexture() {
  if (leafTex) return leafTex;
  const rand = seeded(41);
  leafTex = canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    const draw = (x: number, y: number, a: number, s: number, shade: number) => {
      g.save();
      g.translate(x, y);
      g.rotate(a);
      const l = 40 + shade * 45;
      g.fillStyle = `hsl(${88 + rand() * 30}, ${42 + rand() * 20}%, ${l * 0.5}%)`;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(s * 0.45, -s * 0.35, 0, -s);
      g.quadraticCurveTo(-s * 0.45, -s * 0.35, 0, 0);
      g.fill();
      g.strokeStyle = 'rgba(30,45,15,0.5)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(0, -s * 0.9);
      g.stroke();
      g.restore();
    };
    // twigs
    g.strokeStyle = 'rgba(60,45,30,0.9)';
    for (let k = 0; k < 7; k++) {
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(128, 128);
      const a = rand() * Math.PI * 2;
      g.lineTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
      g.stroke();
    }
    for (let i = 0; i < 150; i++) {
      const r = Math.sqrt(rand()) * 110;
      const a = rand() * Math.PI * 2;
      draw(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, a + Math.PI / 2 + (rand() - 0.5) * 1.2, 18 + rand() * 16, 0.3 + rand() * 0.7);
    }
  });
  return leafTex;
}

let grassTex: THREE.Texture | null = null;
function grassTexture() {
  if (grassTex) return grassTex;
  const rand = seeded(43);
  grassTex = canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 46; i++) {
      const x = 10 + rand() * 108;
      const h = 50 + rand() * 75;
      const bend = (rand() - 0.5) * 40;
      const w = 2 + rand() * 3;
      const grd = g.createLinearGradient(0, 128, 0, 128 - h);
      grd.addColorStop(0, `hsl(${85 + rand() * 15}, 45%, 16%)`);
      grd.addColorStop(1, `hsl(${70 + rand() * 25}, ${50 + rand() * 20}%, ${38 + rand() * 18}%)`);
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - w, 128);
      g.quadraticCurveTo(x + bend * 0.3, 128 - h * 0.6, x + bend, 128 - h);
      g.quadraticCurveTo(x + bend * 0.3 + w * 0.3, 128 - h * 0.6, x + w, 128);
      g.fill();
    }
  });
  return grassTex;
}

let fernTex: THREE.Texture | null = null;
function fernTexture() {
  if (fernTex) return fernTex;
  const rand = seeded(47);
  fernTex = canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    // one arching frond along the long axis, leaflets either side
    g.strokeStyle = '#3d5a22';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(128, 250);
    g.quadraticCurveTo(140, 120, 120, 8);
    g.stroke();
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const y = 245 - t * 235;
      const x = 128 + Math.sin(t * 2.4) * 10 - t * 8;
      const len = 70 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 6;
      for (const s of [-1, 1]) {
        g.fillStyle = `hsl(${92 + rand() * 18}, ${45 + rand() * 15}%, ${26 + rand() * 14}%)`;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + s * len * 0.5, y - 10, x + s * len, y - 14 - len * 0.1);
        g.quadraticCurveTo(x + s * len * 0.5, y + 2, x, y + 4);
        g.fill();
      }
    }
  });
  return fernTex;
}

let ringsTex: THREE.Texture | null = null;
/** cut log end: growth rings */
function ringsTexture() {
  if (ringsTex) return ringsTex;
  const rand = seeded(53);
  ringsTex = canvasTex(256, 256, (g) => {
    g.fillStyle = '#8a6a44';
    g.fillRect(0, 0, 256, 256);
    for (let r = 120; r > 2; r -= 3 + rand() * 4) {
      g.strokeStyle = `rgba(70,45,25,${0.3 + rand() * 0.4})`;
      g.lineWidth = 1 + rand() * 1.5;
      g.beginPath();
      g.ellipse(128 + rand() * 2, 128 + rand() * 2, r, r * (0.96 + rand() * 0.06), 0, 0, Math.PI * 2);
      g.stroke();
    }
    // dark bark rim and radial cracks
    g.strokeStyle = '#2e2116';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(128, 128, 122, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(40,25,15,0.7)';
    g.lineWidth = 2;
    for (let k = 0; k < 5; k++) {
      const a = rand() * Math.PI * 2;
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.cos(a) * 110, 128 + Math.sin(a) * 110);
      g.stroke();
    }
  });
  return ringsTex;
}

// ---------------------------------------------------------------
// bark: furrowed, mossy on the lower trunk and on upward faces
// ---------------------------------------------------------------
let barkMat: THREE.MeshStandardMaterial | null = null;
function barkMaterial() {
  if (barkMat) return barkMat;
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying vec2 vBUv;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 tqW = modelMatrix * vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          tqW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        #endif
        vWP = tqW.xyz;
        vec3 tqN = objectNormal;
        #ifdef USE_INSTANCING
          tqN = mat3(instanceMatrix) * tqN;
        #endif
        vWN = normalize(mat3(modelMatrix) * tqN);
        vBUv = uv;`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying vec2 vBUv;\n${GLSL_NOISE}\nfloat gMoss; float gBarkH;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // deep vertical furrows broken into plates
          vec2 bu = vec2(vBUv.x * 9.0, vBUv.y * 1.6);
          float fur = noise(vec2(bu.x * 2.0, bu.y * 0.6)) * 0.6 + noise(bu * vec2(5.0, 1.2)) * 0.3 + noise(bu * 14.0) * 0.1;
          float plate = smoothstep(0.35, 0.6, fur);
          gBarkH = plate;
          vec3 dark = vec3(0.06, 0.05, 0.04);
          vec3 bark = mix(vec3(0.2, 0.16, 0.12), vec3(0.36, 0.31, 0.26), noise(bu * 3.0 + 7.0));
          vec3 col = mix(dark, bark, plate);
          // lichen flecks
          col = mix(col, vec3(0.42, 0.46, 0.36), smoothstep(0.82, 0.9, noise(vWP.xy * 7.1 + vWP.z * 5.3)) * 0.35);
          // moss: thick near the ground, on the shaded north side and on anything facing up
          vec3 nW = normalize(vWN);
          float low = 1.0 - smoothstep(0.2, 2.8, vWP.y);
          float north = smoothstep(0.0, -0.8, nW.z) * (1.0 - smoothstep(2.0, 9.0, vWP.y));
          float up = smoothstep(0.55, 0.9, nW.y);
          float mossN = noise(vWP.xz * 1.3 + vWP.y * 0.8) * 0.6 + noise(vWP.xy * 4.0 + vWP.zy * 2.0) * 0.4;
          gMoss = smoothstep(0.55, 0.75, max(max(low * 0.85, north * 0.7), up * 0.8) + (mossN - 0.5) * 0.6);
          vec3 moss = mix(vec3(0.06, 0.1, 0.025), vec3(0.17, 0.24, 0.06), noise(vWP.xz * 6.0 + vWP.y * 5.0));
          col = mix(col, moss, gMoss);
          diffuseColor.rgb = col;
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float H = gBarkH * 0.06 * (1.0 - gMoss * 0.7);
          vec3 sx = dFdx(vWP); vec3 sy = dFdy(vWP);
          vec3 nW = normalize(vWN);
          vec3 r1 = cross(sy, nW); vec3 r2 = cross(nW, sx);
          float det = dot(sx, r1);
          vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
          vec3 nP = normalize(abs(det) * nW - grad * 4.0);
          normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
        }`
      );
  };
  barkMat = m;
  return m;
}

// ---------------------------------------------------------------
// foliage material: alpha-tested cards that sway in the wind
// ---------------------------------------------------------------
function foliageMaterial(tex: THREE.Texture, opts: { sway: number; grass?: boolean; tint?: string }) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, color: opts.tint ?? '#ffffff' });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uGust = shared.uGust;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uGust;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float ph = ip.x * 0.37 + ip.z * 0.29;
          float w = sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
          float amp = ${opts.sway.toFixed(3)} * (1.0 + uGust * 3.0);
          ${opts.grass ? 'float k = max(position.y, 0.0); k *= k;' : 'float k = 1.0;'}
          transformed.x += w * amp * k;
          transformed.z += cos(uTime * 1.1 + ph) * amp * 0.6 * k;
        }`
      );
    // foliage lets light through: soften the dark side a little
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.12;`
    );
  };
  return m;
}

// ---------------------------------------------------------------
// ground: moss, grass, bare earth and leaf litter, dappled by the canopy;
// the river channel is cut into it (pebbles under water, wet mud on the banks)
// ---------------------------------------------------------------
function terrainGeometry() {
  const size = 320;
  const seg = 320;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, floorAt(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  return g;
}

function Ground() {
  const { geo, mat } = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0 });
    const trees = FOREST.trees.map(([x, z, r]) => new THREE.Vector3(x, z, r));
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.uTime;
      sh.uniforms.uTrees = { value: trees };
      sh.uniforms.uWaterY = { value: FOREST.waterY };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime; uniform vec3 uTrees[${trees.length}]; uniform float uWaterY;
          varying vec3 vWP; varying vec3 vWN;
          ${GLSL_NOISE}
          ${RIVER_GLSL}
          float fbm3(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125; }
          float gH; float gWet;`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 p = vWP.xz;
            float n1 = fbm3(p * 0.06);
            float n2 = fbm3(p * 0.45 + 3.0);
            float n3 = noise(p * 3.2);
            vec3 moss = mix(vec3(0.06, 0.1, 0.03), vec3(0.15, 0.21, 0.06), n2);
            vec3 grass = mix(vec3(0.12, 0.17, 0.05), vec3(0.22, 0.27, 0.08), n3);
            vec3 earth = mix(vec3(0.16, 0.11, 0.07), vec3(0.27, 0.2, 0.13), n2);
            // worn earth paths wander through the clearing
            float path = 1.0 - smoothstep(0.0, 0.06, abs(fbm3(p * 0.035 + 7.0) - 0.5));
            float worn = max(smoothstep(0.58, 0.78, n1), path * 0.85);
            vec3 col = mix(moss, grass, smoothstep(0.4, 0.6, n2 + n3 * 0.3));
            col = mix(col, earth, worn * 0.85);
            float roots = 0.0;
            for (int i = 0; i < ${trees.length}; i++) {
              float d = length(p - uTrees[i].xy) - uTrees[i].z;
              roots = max(roots, 1.0 - smoothstep(0.0, 4.5, d));
            }
            float leafy = smoothstep(0.66, 0.72, noise(p * 9.5 + 11.0)) * (0.25 + roots * 0.6);
            vec3 leafCol = mix(vec3(0.42, 0.26, 0.08), vec3(0.55, 0.4, 0.12), noise(p * 13.0));
            col = mix(col, leafCol, leafy);
            col = mix(col, vec3(0.1, 0.08, 0.05), roots * 0.35 * (1.0 - leafy));
            // river: pebbles and silt below the surface, dark wet mud along the waterline
            float below = smoothstep(uWaterY + 0.05, uWaterY - 0.25, vWP.y);
            gWet = (1.0 - smoothstep(uWaterY + 0.1, uWaterY + 0.9 + n2 * 0.5, vWP.y)) * (1.0 - smoothstep(9.0, 11.0, abs(vWP.z - riverZ(vWP.x))));
            float peb = smoothstep(0.45, 0.62, noise(p * 7.0)) * 0.6 + noise(p * 18.0) * 0.4;
            vec3 bed = mix(vec3(0.17, 0.16, 0.12), vec3(0.42, 0.39, 0.32), peb);
            bed = mix(bed, vec3(0.12, 0.13, 0.08), smoothstep(uWaterY - 0.8, uWaterY - 2.2, vWP.y) * 0.7); // deep: silt and weed
            col = mix(col, col * 0.45 + vec3(0.02, 0.025, 0.02), gWet * (1.0 - below));
            col = mix(col, bed * 0.8, below);
            gH = n3 * 0.5 + n2 * 0.3 + peb * below * 0.6;
            // broad canopy shade, and inside the sunny patches small bright flecks that shimmer
            vec2 q = p * 0.07 + vec2(sin(uTime * 0.13) * 0.1, cos(uTime * 0.11) * 0.1);
            float open = smoothstep(0.45, 0.7, fbm3(q));
            float fleck = smoothstep(0.62, 0.74, noise(p * 1.7 + vec2(sin(uTime * 0.6), cos(uTime * 0.5)) * 0.15));
            float shade = 0.62 + open * 0.25 + fleck * open * 0.55;
            // the river corridor is open sky: brighter
            float sky = 1.0 - smoothstep(6.0, 14.0, abs(vWP.z - riverZ(vWP.x)));
            diffuseColor.rgb = col * mix(shade, 1.1, sky * 0.7);
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.95, 0.35, gWet);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            float H = gH * 0.05;
            vec3 sx = dFdx(vWP); vec3 sy = dFdy(vWP);
            vec3 nW = normalize(vWN);
            vec3 r1 = cross(sy, nW); vec3 r2 = cross(nW, sx);
            float det = dot(sx, r1);
            vec3 grad = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
            vec3 nP = normalize(abs(det) * nW - grad * 3.0);
            normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
          }`
        );
    };
    return { geo: terrainGeometry(), mat: m };
  }, []);
  return <mesh geometry={geo} material={mat} receiveShadow />;
}

// ---------------------------------------------------------------
// the river
// ---------------------------------------------------------------
function River() {
  const { geo, mat } = useMemo(() => {
    const pos: number[] = [];
    const uv: number[] = [];
    const depth: number[] = [];
    const idx: number[] = [];
    const x0 = -170;
    const x1 = 170;
    const n = 680;
    const across = 14;
    const W = FOREST.bankHalf + 1.5;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const zc = riverZ(x);
      for (let j = 0; j <= across; j++) {
        const v = (j / across) * 2 - 1;
        const z = zc + v * W;
        pos.push(x, FOREST.waterY, z);
        uv.push(x, v);
        depth.push(FOREST.waterY - floorAt(x, z));
      }
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < across; j++) {
        const a = i * (across + 1) + j;
        const b = a + across + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: '#27443f', roughness: 0.05, metalness: 0, transparent: true, opacity: 1, envMapIntensity: 1.3 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = shared.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aDepth; varying float vDepth; varying vec2 vSUv; varying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth; vSUv = uv; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uTime; varying float vDepth; varying vec2 vSUv; varying vec3 vWP;\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            if (vDepth < 0.0) discard; // above the waterline: the bank shows through
            // clear in the shallows (you see the pebbles), deep green-blue in the channel
            float a = smoothstep(0.0, 0.25, vDepth) * mix(0.45, 0.93, smoothstep(0.3, 2.0, vDepth));
            diffuseColor.rgb = mix(vec3(0.3, 0.42, 0.36), vec3(0.08, 0.2, 0.2), smoothstep(0.3, 2.2, vDepth));
            // foam: a line along the shore, and streaks where it runs fast over the ford
            vec2 fp = vec2(vSUv.x * 0.9 - uTime * 1.2, vSUv.y * 6.0);
            float streak = smoothstep(0.7, 0.8, noise(fp) * 0.7 + noise(fp * 3.0) * 0.3) * 0.5;
            float shore = (1.0 - smoothstep(0.0, 0.14, vDepth)) * (0.6 + 0.4 * noise(vWP.xz * 3.0 + uTime));
            float foam = max(streak * (1.0 - smoothstep(0.3, 1.2, vDepth)), shore);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.92, 0.9), foam * 0.8);
            diffuseColor.a = max(a, foam * 0.85);
          }`
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // ripples running downstream (+x), two scales
            vec2 a = vec2(vWP.x * 0.9 - uTime * 1.6, vWP.z * 1.5);
            vec2 b = vec2(vWP.x * 3.2 - uTime * 2.6, vWP.z * 3.6 + 3.0);
            float e = 0.08;
            float h0 = noise(a) * 0.6 + noise(b) * 0.4;
            float hx = noise(a + vec2(e, 0.0)) * 0.6 + noise(b + vec2(e, 0.0)) * 0.4;
            float hz = noise(a + vec2(0.0, e)) * 0.6 + noise(b + vec2(0.0, e)) * 0.4;
            vec3 nW = normalize(vec3(-(hx - h0) * 1.8, 1.0, -(hz - h0) * 1.8));
            normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
          }`
        );
    };
    return { geo: g, mat: m };
  }, []);
  return <mesh geometry={geo} material={mat} renderOrder={2} />;
}

/** A plank footbridge arching from bank to bank, with posts down into the water and rope rails */
function Bridge() {
  const { planks, posts, rails } = useMemo(() => {
    const B = FOREST.bridge;
    const zc = riverZ(B.x);
    const span = FOREST.bankHalf + 1.5;
    const planks: { p: [number, number, number]; r: number }[] = [];
    for (let z = -span; z <= span; z += 0.42) {
      const y = bridgeDeck(B.x, zc + z) ?? 0;
      const y2 = bridgeDeck(B.x, zc + z + 0.2) ?? y;
      planks.push({ p: [B.x, y - 0.06, zc + z], r: Math.atan2(y2 - y, 0.2) });
    }
    const posts: { p: [number, number, number]; h: number }[] = [];
    const railPts: [THREE.Vector3[], THREE.Vector3[]] = [[], []];
    for (let z = -span; z <= span + 0.01; z += span / 4) {
      for (const sx of [-1, 1]) {
        const x = B.x + sx * (B.half + 0.05);
        const top = (bridgeDeck(B.x, zc + z) ?? 0) + 1.05;
        const bot = Math.min(floorAt(x, zc + z), top - 1.2);
        posts.push({ p: [x, (top + bot) / 2, zc + z], h: top - bot });
        railPts[sx < 0 ? 0 : 1].push(new THREE.Vector3(x, top - 0.1, zc + z));
      }
    }
    const rails = railPts.map((pts) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.035, 5, false));
    return { planks, posts, rails };
  }, []);
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 0.85 }), []);
  const rope = useMemo(() => new THREE.MeshStandardMaterial({ color: '#a08158', roughness: 0.95 }), []);
  return (
    <group>
      {planks.map((pl, i) => (
        <mesh key={i} position={pl.p} rotation={[-pl.r, 0, (i % 3) * 0.01]} material={wood} castShadow receiveShadow>
          <boxGeometry args={[FOREST.bridge.half * 2 + 0.2, 0.08, 0.38]} />
        </mesh>
      ))}
      {posts.map((po, i) => (
        <mesh key={'p' + i} position={po.p} material={wood} castShadow>
          <cylinderGeometry args={[0.09, 0.11, po.h, 7]} />
        </mesh>
      ))}
      {rails.map((g, i) => (
        <mesh key={'r' + i} geometry={g} material={rope} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// giant trees
// ---------------------------------------------------------------
/** A thick trunk along a gently bending spine, flaring into buttress roots at the foot */
function trunkGeometry(radius: number, height: number, seed: number, deck = 0) {
  const rand = seeded(seed);
  const rings = 60;
  const seg = 28;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ph = rand() * 6;
  const lobes = 5 + Math.floor(rand() * 2);
  // lookout trees grow straight up to the deck (you climb them), then lean like the rest
  // the trunk stands exactly on its collision circle at the bottom; the lean only starts higher up
  // (lookout trees grow straight up past the deck you climb to)
  const y0 = deck > 0 ? deck : 2.5;
  const bend = (y: number) => THREE.MathUtils.smoothstep(y, y0, y0 + 6);
  const bx = (y: number) => (Math.sin(y * 0.09 + ph) * 0.5 + Math.sin(y * 0.21 + ph * 2) * 0.15 - Math.sin(ph) * 0.5 - Math.sin(ph * 2) * 0.15) * bend(y);
  const bz = (y: number) => (Math.cos(y * 0.07 + ph) * 0.45 - Math.cos(ph) * 0.45) * bend(y);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = -0.4 + t * t * 0.0 + t * (height + 0.4);
    const taper = deck > 0 ? (y < deck ? 1 - 0.06 * Math.max(0, y) / deck : 0.94 - 0.44 * Math.pow((y - deck) / (height - deck), 0.8)) : 1 - 0.5 * Math.pow(t, 0.8);
    const flare = Math.exp(-Math.max(0, y) / 0.9);
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const butt = Math.pow(Math.max(0, Math.sin(a * lobes + ph)), 3) * 0.45 * Math.exp(-Math.max(0, y) / 0.6);
      const knot = (Math.sin(a * 3 + y * 0.8 + ph) * 0.03 + Math.sin(a * 7 - y * 1.7) * 0.02) * (1 - flare);
      const r = radius * (taper + flare * 0.3 + butt + knot);
      pos.push(bx(y) + Math.cos(a) * r, y, bz(y) + Math.sin(a) * r);
      uv.push((j / seg) * 3, y / 3);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, spine: (y: number) => new THREE.Vector3(bx(y), y, bz(y)) };
}

interface Cluster {
  c: THREE.Vector3;
  r: number;
}

/** Limbs as tubes from the trunk; returns the limb geometry and the canopy clusters at their tips */
function limbs(tx: number, tz: number, radius: number, height: number, spine: (y: number) => THREE.Vector3, seed: number, base = 0, deck = 0) {
  const rand = seeded(seed);
  const geos: THREE.BufferGeometry[] = [];
  const clusters: Cluster[] = [];
  const n = 5 + Math.floor(rand() * 2);
  for (let k = 0; k < n; k++) {
    const y0 = Math.max(deck + 3, height * (0.5 + rand() * 0.35));
    const a = (k / n) * Math.PI * 2 + rand() * 0.6;
    const len = 6 + rand() * 4;
    const s = spine(y0);
    const p0 = new THREE.Vector3(tx + s.x, y0 + base, tz + s.z);
    const dir = new THREE.Vector3(Math.cos(a), 0.55 + rand() * 0.35, Math.sin(a)).normalize();
    const p1 = p0.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, 0.6, 0));
    const p2 = p0.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, 1.4 + rand(), 0));
    const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
    const tube = new THREE.TubeGeometry(curve, 10, radius * 0.22, 8, false);
    // taper the tube toward its tip
    const pp = tube.attributes.position as THREE.BufferAttribute;
    const ring = 9;
    for (let i = 0; i < pp.count; i++) {
      const seg = Math.floor(i / ring) / 10;
      const c = curve.getPoint(Math.min(1, seg));
      const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i)).sub(c).multiplyScalar(1 - seg * 0.7).add(c);
      pp.setXYZ(i, v.x, v.y, v.z);
    }
    tube.computeVertexNormals();
    geos.push(tube);
    clusters.push({ c: p2.clone().add(new THREE.Vector3(0, 1.2, 0)), r: 3.6 + rand() * 1.6 });
    clusters.push({ c: p1.clone().add(new THREE.Vector3(dir.z * 1.5, 1.8, -dir.x * 1.5)), r: 2.6 + rand() });
  }
  const top = spine(height);
  clusters.push({ c: new THREE.Vector3(tx + top.x, height + 2.5 + base, tz + top.z), r: 5 + rand() * 1.5 });
  return { geos, clusters };
}

/** canopy: thousands of leaf cards in clusters, one instanced mesh for the whole map */
function CanopyCards({ clusters, perCluster, size, seed }: { clusters: Cluster[]; perCluster: (c: Cluster) => number; size: number; seed: number }) {
  const mesh = useMemo(() => {
    const rand = seeded(seed);
    let total = 0;
    for (const c of clusters) total += perCluster(c);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = foliageMaterial(leafTexture(), { sway: 0.05 });
    const im = new THREE.InstancedMesh(geo, mat, total);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    let i = 0;
    for (const c of clusters) {
      const n = perCluster(c);
      for (let k = 0; k < n; k++) {
        // flattened ellipsoid, denser at the outside so the silhouette reads as a crown
        const u = rand() * 2 - 1;
        const th = rand() * Math.PI * 2;
        const rr = Math.pow(rand(), 0.35) * c.r;
        const sxz = Math.sqrt(1 - u * u);
        const p = new THREE.Vector3(c.c.x + Math.cos(th) * sxz * rr, c.c.y + u * rr * 0.55, c.c.z + Math.sin(th) * sxz * rr);
        e.set(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI);
        q.setFromEuler(e);
        const s = size * (0.75 + rand() * 0.6);
        m.compose(p, q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, m);
        // outer, sunlit leaves lighter and yellower; inner ones dark
        const out = rr / c.r;
        col.setHSL(0.22 + rand() * 0.05, 0.45 + rand() * 0.2, 0.32 + out * 0.22 + (p.y - c.c.y > 0 ? 0.06 : -0.06));
        im.setColorAt(i, col);
        i++;
      }
    }
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    return im;
  }, [clusters, perCluster, size, seed]);
  return <primitive object={mesh} />;
}

/** surface roots snaking out from each giant into the moss */
function rootGeometries(tx: number, tz: number, radius: number, seed: number, base = 0) {
  const rand = seeded(seed);
  const out: THREE.BufferGeometry[] = [];
  const n = 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand() * 0.5;
    const len = radius * (1.6 + rand() * 1.2);
    const pts: THREE.Vector3[] = [];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      const d = radius * 0.85 + t * len;
      const wob = Math.sin(t * 5 + k) * 0.5 * t;
      const px = tx + Math.cos(a + wob * 0.15) * d;
      const pz = tz + Math.sin(a + wob * 0.15) * d;
      pts.push(new THREE.Vector3(px, (floorAt(px, pz) - base) * t + base + 0.16 * (1 - t) - 0.06 * t, pz));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 12, radius * 0.12, 7, false);
    const pp = tube.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const seg = Math.floor(i / 8) / 12;
      const c = curve.getPoint(Math.min(1, seg));
      const v = new THREE.Vector3(pp.getX(i), pp.getY(i), pp.getZ(i)).sub(c);
      v.multiplyScalar(1 - seg * 0.75);
      v.y *= 0.6; // flattened, half sunk into the ground
      v.add(c);
      pp.setXYZ(i, v.x, v.y, v.z);
    }
    tube.computeVertexNormals();
    out.push(tube);
  }
  return out;
}

function mergeGeos(geos: THREE.BufferGeometry[]) {
  const nonIdx = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of nonIdx) count += (g.attributes.position as THREE.BufferAttribute).count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of nonIdx) {
    const p = g.attributes.position as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, o * 3);
    nor.set((g.attributes.normal as THREE.BufferAttribute).array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set((g.attributes.uv as THREE.BufferAttribute).array as Float32Array, o * 2);
    o += p.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return m;
}

function GiantTrees() {
  const { wood, clusters } = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const clusters: Cluster[] = [];
    FOREST.trees.forEach(([x, z, r, deck], i) => {
      const base = Math.min(floorAt(x - r, z), floorAt(x + r, z), floorAt(x, z - r), floorAt(x, z + r));
      const h = 19 + (i % 3) * 3;
      const deckRel = deck > 0 ? deck - base : 0;
      const { geo, spine } = trunkGeometry(r, h, 100 + i, deckRel);
      geo.translate(x, base, z);
      parts.push(geo);
      const L = limbs(x, z, r, h, spine, 200 + i, base, deckRel);
      parts.push(...L.geos);
      clusters.push(...L.clusters);
      parts.push(...rootGeometries(x, z, r, 300 + i, base));
    });
    return { wood: mergeGeos(parts), clusters };
  }, []);
  const per = useMemo(() => (c: Cluster) => Math.round(c.r * c.r * 4.2), []);
  return (
    <group>
      <mesh geometry={wood} material={barkMaterial()} castShadow receiveShadow />
      <CanopyCards clusters={clusters} perCluster={per} size={2.4} seed={61} />
      <Lookouts />
    </group>
  );
}

/** Hunters' lookout platforms: a plank ring round the trunk with a low rail, a rope ladder hanging down one side */
function Lookouts() {
  const items = useMemo(() => FOREST.trees.filter((t) => t[3] > 0), []);
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.85 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 0.9 }), []);
  const rope = useMemo(() => new THREE.MeshStandardMaterial({ color: '#a08158', roughness: 0.95 }), []);
  return (
    <group>
      {items.map(([x, z, r, h], i) => {
        const outer = r + FOREST.deckR;
        const posts = 10;
        const ladderA = (i * 1.7) % (Math.PI * 2);
        const base = floorAt(x, z);
        return (
          <group key={i} position={[x, 0, z]}>
            {/* deck: thick plank ring */}
            <mesh position={[0, h - 0.09, 0]} rotation={[-Math.PI / 2, 0, 0]} material={wood} receiveShadow castShadow>
              <ringGeometry args={[r * 0.9, outer + 0.05, 40, 1]} />
            </mesh>
            <mesh position={[0, h - 0.18, 0]} material={dark} castShadow>
              <cylinderGeometry args={[outer + 0.05, outer - 0.1, 0.18, 40, 1, true]} />
            </mesh>
            {/* diagonal braces down to the trunk */}
            {Array.from({ length: 6 }, (_, k) => {
              const a = (k / 6) * Math.PI * 2;
              const mid = (r + outer) / 2;
              return (
                <mesh key={k} position={[Math.cos(a) * mid, h - 0.9, Math.sin(a) * mid]} rotation={[0, -a, Math.atan2(outer - r, 1.4)]} material={dark} castShadow>
                  <boxGeometry args={[0.1, 1.6, 0.1]} />
                </mesh>
              );
            })}
            {/* low rail */}
            {Array.from({ length: posts }, (_, k) => {
              const a = (k / posts) * Math.PI * 2;
              if (Math.abs(((a - ladderA + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.35) return null; // gap where the ladder comes up
              return (
                <mesh key={'p' + k} position={[Math.cos(a) * (outer - 0.06), h + 0.4, Math.sin(a) * (outer - 0.06)]} material={dark} castShadow>
                  <cylinderGeometry args={[0.045, 0.05, 0.8, 6]} />
                </mesh>
              );
            })}
            <mesh position={[0, h + 0.78, 0]} rotation={[-Math.PI / 2, 0, 0]} material={rope}>
              <torusGeometry args={[outer - 0.06, 0.03, 5, 40]} />
            </mesh>
            {/* rope ladder (decoration: you climb the bark) */}
            <group position={[Math.cos(ladderA) * (r + 0.25), 0, Math.sin(ladderA) * (r + 0.25)]} rotation={[0, -ladderA + Math.PI / 2, 0]}>
              {[-0.22, 0.22].map((sx) => (
                <mesh key={sx} position={[sx, (h + base) / 2, 0]} material={rope}>
                  <cylinderGeometry args={[0.02, 0.02, h - base, 4]} />
                </mesh>
              ))}
              {Array.from({ length: Math.floor((h - base) / 0.4) }, (_, k) => (
                <mesh key={k} position={[0, base + 0.3 + k * 0.4, 0]} rotation={[0, 0, Math.PI / 2]} material={wood}>
                  <cylinderGeometry args={[0.025, 0.025, 0.5, 4]} />
                </mesh>
              ))}
            </group>
            {/* a lantern on the rail */}
            <mesh position={[Math.cos(ladderA + Math.PI) * (outer - 0.06), h + 0.95, Math.sin(ladderA + Math.PI) * (outer - 0.06)]}>
              <sphereGeometry args={[0.12, 8, 6]} />
              <meshBasicMaterial color="#ffbf6a" toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------
// the forest all round the clearing
// ---------------------------------------------------------------
const nearRiver = (x: number, z: number, pad: number) => Math.abs(z - riverZ(x)) < FOREST.bankHalf + pad;
const SHRINE: [number, number] = [-9, -(R + 3)];

function BackgroundForest() {
  const { trunks, clusters } = useMemo(() => {
    const rand = seeded(71);
    const spots: [number, number, number][] = [];
    for (let k = 0; k < 2400 && spots.length < 360; k++) {
      const a = rand() * Math.PI * 2;
      const r = R + 4 + Math.pow(rand(), 0.9) * 90;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (nearRiver(x, z, 1)) continue; // the river keeps its open corridor out of the forest
      if (Math.hypot(x - SHRINE[0], z - SHRINE[1]) < 5) continue;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 3.6)) continue;
      spots.push([x, z, 0.7 + rand() * 0.7]);
    }
    const g = new THREE.CylinderGeometry(0.32, 0.55, 1, 10, 6, true).translate(0, 0.5, 0);
    const pp = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const y = pp.getY(i);
      const f = 1 + Math.exp(-y * 10) * 0.6;
      pp.setX(i, pp.getX(i) * f);
      pp.setZ(i, pp.getZ(i) * f);
    }
    g.computeVertexNormals();
    const im = new THREE.InstancedMesh(g, barkMaterial(), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const clusters: Cluster[] = [];
    spots.forEach(([x, z, s], i) => {
      const h = 14 + rand() * 10;
      const y0 = floorAt(x, z) - 0.2;
      q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.05, rand() * 6, (rand() - 0.5) * 0.05));
      m.compose(new THREE.Vector3(x, y0, z), q, new THREE.Vector3(s * 1.5, h, s * 1.5));
      im.setMatrixAt(i, m);
      const nc = 2 + Math.floor(rand() * 2);
      for (let c = 0; c < nc; c++) clusters.push({ c: new THREE.Vector3(x + (rand() - 0.5) * 4, y0 + h * (0.7 + rand() * 0.3) + 1, z + (rand() - 0.5) * 4), r: 3 + rand() * 2 });
    });
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    return { trunks: im, clusters };
  }, []);
  const per = useMemo(() => (c: Cluster) => Math.round(c.r * 4.5), []);
  return (
    <group>
      <primitive object={trunks} />
      <CanopyCards clusters={clusters} perCluster={per} size={3.6} seed={73} />
    </group>
  );
}

// ---------------------------------------------------------------
// undergrowth
// ---------------------------------------------------------------
function blocked(x: number, z: number, pad: number) {
  for (const [tx, tz, r] of FOREST.trees) if (Math.hypot(x - tx, z - tz) < r + pad) return true;
  return false;
}
/** dry ground (no grass in the water) */
const dry = (x: number, z: number, pad = 0.15) => floorAt(x, z) > FOREST.waterY + pad;

function Grass() {
  const mesh = useMemo(() => {
    const rand = seeded(81);
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const geo = mergeGeos([a, b]);
    const mat = foliageMaterial(grassTexture(), { sway: 0.12, grass: true });
    const spots: [number, number, number][] = [];
    for (let k = 0; k < 90000 && spots.length < 18000; k++) {
      const r = Math.sqrt(rand()) * (R + 10);
      const t = rand() * Math.PI * 2;
      const x = Math.cos(t) * r;
      const z = Math.sin(t) * r;
      if (!dry(x, z) || blocked(x, z, 0.3)) continue;
      // clumped: lush in patches and along the banks, thin on the worn ground
      const patch = vnoiseJS(x * 0.08, z * 0.08);
      const bank = Math.abs(z - riverZ(x)) < FOREST.bankHalf + 3 ? 0.5 : 0;
      if (rand() > 0.15 + patch * 0.9 + bank) continue;
      spots.push([x, z, (0.3 + Math.pow(rand(), 2) * 0.6) * (r > R ? 1.6 : 1) * (0.8 + patch * 0.5)]);
    }
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    spots.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      m.compose(new THREE.Vector3(x, floorAt(x, z) - 0.02, z), q, new THREE.Vector3(s * (0.8 + rand() * 0.8), s, s * (0.8 + rand() * 0.8)));
      im.setMatrixAt(i, m);
      col.setHSL(0.19 + rand() * 0.07, 0.35 + rand() * 0.25, 0.6 + rand() * 0.3);
      im.setColorAt(i, col);
    });
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, []);
  return <primitive object={mesh} />;
}

function vnoiseJS(x: number, y: number) {
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

function Ferns() {
  const mesh = useMemo(() => {
    const rand = seeded(83);
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 7; k++) {
      const g = new THREE.PlaneGeometry(0.5, 1.3, 1, 6).translate(0, 0.65, 0);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setZ(i, y * 0.75);
        p.setY(i, y * 0.8 - y * y * 0.35);
      }
      g.rotateY((k / 7) * Math.PI * 2 + rand() * 0.4);
      g.computeVertexNormals();
      parts.push(g);
    }
    const geo = mergeGeos(parts);
    const mat = foliageMaterial(fernTexture(), { sway: 0.05, grass: true });
    const spots: [number, number, number][] = [];
    for (const [tx, tz, r] of FOREST.trees)
      for (let k = 0; k < 8; k++) {
        const a = rand() * Math.PI * 2;
        const d = r + 0.8 + rand() * 2.5;
        spots.push([tx + Math.cos(a) * d, tz + Math.sin(a) * d, 0.8 + rand() * 0.6]);
      }
    for (let k = 0; k < 520; k++) {
      const a = rand() * Math.PI * 2;
      const d = R - 2 + rand() * 12;
      spots.push([Math.cos(a) * d, Math.sin(a) * d, 1 + rand() * 0.8]);
    }
    for (let k = 0; k < 200; k++) {
      const x = (rand() - 0.5) * 2 * R;
      const side = rand() < 0.5 ? -1 : 1;
      spots.push([x, riverZ(x) + side * (FOREST.bankHalf + 0.5 + rand() * 2.5), 0.7 + rand() * 0.5]);
    }
    const ok = spots.filter(([x, z]) => dry(x, z, 0.2));
    const im = new THREE.InstancedMesh(geo, mat, ok.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    ok.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      m.compose(new THREE.Vector3(x, floorAt(x, z), z), q, new THREE.Vector3(s, s, s));
      im.setMatrixAt(i, m);
      col.setHSL(0.24 + rand() * 0.05, 0.5, 0.45 + rand() * 0.2);
      im.setColorAt(i, col);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, []);
  return <primitive object={mesh} />;
}

/** low shrubs closing off the edge of the clearing so the boundary reads as forest, not a wall */
function EdgeShrubs() {
  const clusters = useMemo(() => {
    const rand = seeded(89);
    const out: Cluster[] = [];
    for (let k = 0; k < 150; k++) {
      const a = (k / 150) * Math.PI * 2 + rand() * 0.03;
      const r = R + 1.8 + rand() * 3.5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (nearRiver(x, z, -2)) continue;
      if (Math.hypot(x - SHRINE[0], z - SHRINE[1]) < 4) continue;
      out.push({ c: new THREE.Vector3(x, floorAt(x, z) + 0.6 + rand() * 0.6, z), r: 1.3 + rand() * 1.1 });
    }
    return out;
  }, []);
  const per = useMemo(() => (c: Cluster) => Math.round(c.r * 14), []);
  return <CanopyCards clusters={clusters} perCluster={per} size={1.3} seed={91} />;
}

// ---------------------------------------------------------------
// logs, stepping stones, rocks, mushrooms, a moss-grown shrine
// ---------------------------------------------------------------
function Logs() {
  const capMat = useMemo(() => new THREE.MeshStandardMaterial({ map: ringsTexture(), roughness: 0.9 }), []);
  return (
    <group>
      {FOREST.logs.map(([x0, z0, x1, z1], i) => {
        const L = Math.hypot(x1 - x0, z1 - z0) + 1.2;
        const a = Math.atan2(z1 - z0, x1 - x0);
        const r = 0.6;
        const y0 = floorAt(x0, z0);
        const y1 = floorAt(x1, z1);
        const tilt = Math.atan2(y1 - y0, L - 1.2);
        return (
          <group key={i} position={[(x0 + x1) / 2, (y0 + y1) / 2 + r - 0.05, (z0 + z1) / 2]} rotation={[0, -a, tilt]}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={barkMaterial()} castShadow receiveShadow>
              <cylinderGeometry args={[r * 0.92, r, L, 20, 8, true]} />
            </mesh>
            <mesh position={[L / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]} material={capMat}>
              <circleGeometry args={[r * 0.95, 20]} />
            </mesh>
            <mesh position={[-L / 2, 0, 0]} rotation={[0, -Math.PI / 2, 0]} material={capMat}>
              <circleGeometry args={[r, 20]} />
            </mesh>
            <mesh position={[L * 0.15, r * 0.7, 0.2]} rotation={[0.4, 0, 0.5]} material={barkMaterial()} castShadow>
              <cylinderGeometry args={[0.08, 0.16, 0.9, 7]} />
            </mesh>
            {[0, 1, 2].map((k) => (
              <mesh key={k} position={[-L * 0.3 + k * 0.35, -0.1 + k * 0.12, r * 0.95]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.35]}>
                <sphereGeometry args={[0.16 - k * 0.03, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
                <meshStandardMaterial color="#c9a46a" roughness={0.8} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Stones() {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 tqW = modelMatrix * vec4(transformed, 1.0);
          vWP = tqW.xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN;\n${GLSL_NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 rock = mix(vec3(0.24, 0.24, 0.22), vec3(0.42, 0.41, 0.38), noise(vWP.xz * 3.0 + vWP.y * 2.0));
            float mossy = smoothstep(0.3, 0.7, normalize(vWN).y + (noise(vWP.xz * 2.5) - 0.5) * 0.8);
            // wet and dark where the river laps at it
            rock *= mix(1.0, 0.55, 1.0 - smoothstep(${FOREST.waterY.toFixed(2)}, ${(FOREST.waterY + 0.35).toFixed(2)}, vWP.y));
            diffuseColor.rgb = mix(rock * 0.75, vec3(0.08, 0.13, 0.04), mossy * 0.6 * smoothstep(${(FOREST.waterY + 0.1).toFixed(2)}, ${(FOREST.waterY + 0.4).toFixed(2)}, vWP.y));
          }`
        );
    };
    return m;
  }, []);
  // positions come from maps.ts so they match the collision
  const rocks = useMemo(() => FOREST.rocks.map(([x, z, sc, yaw]) => ({ p: [x, floorAt(x, z) + sc * 0.2, z] as [number, number, number], s: [sc * 1.3, sc * 0.7, sc] as [number, number, number], r: yaw })), []);
  return (
    <group>
      {FOREST.stones.map(([x, z], i) => (
        <mesh key={'s' + i} position={[x, FOREST.waterY + 0.2 - 0.36 + 0.02, z]} scale={[0.72, 0.36, 0.66]} rotation={[0, i * 1.7, 0]} material={mat} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 1]} />
        </mesh>
      ))}
      {rocks.map((r, i) => (
        <mesh key={i} position={r.p} scale={r.s} rotation={[0, r.r, 0]} material={mat} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
    </group>
  );
}

function Mushrooms() {
  const items = useMemo(() => {
    const rand = seeded(101);
    const out: [number, number, number, number, number][] = [];
    for (const [tx, tz, r] of FOREST.trees)
      for (let k = 0; k < 4; k++) {
        const a = rand() * Math.PI * 2;
        const d = r + 0.5 + rand() * 1.2;
        const x = tx + Math.cos(a) * d;
        const z = tz + Math.sin(a) * d;
        out.push([x, floorAt(x, z), z, 0.6 + rand() * 0.7, rand() < 0.3 ? 1 : 0]);
      }
    return out;
  }, []);
  return (
    <group>
      {items.map(([x, y, z, s, red], i) => (
        <group key={i} position={[x, y, z]} scale={s}>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.025, 0.035, 0.16, 6]} />
            <meshStandardMaterial color="#e8dcc4" roughness={0.8} />
          </mesh>
          <mesh position={[0, 0.16, 0]} scale={[1, 0.55, 1]}>
            <sphereGeometry args={[0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color={red ? '#b3261e' : '#a87b4a'} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Shrine() {
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7c7f74', roughness: 0.92 }), []);
  const moss = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a5e22', roughness: 1 }), []);
  const tabletTex = useMemo(
    () =>
      canvasTex(128, 256, (g) => {
        g.fillStyle = '#6f7268';
        g.fillRect(0, 0, 128, 256);
        g.fillStyle = 'rgba(20,22,18,0.75)';
        g.font = 'bold 64px "Noto Serif SC","Songti SC","STSong","SimSun",serif';
        g.textAlign = 'center';
        g.fillText('青', 64, 100);
        g.fillText('冥', 64, 180);
      }),
    []
  );
  const lantern = (x: number) => (
    <group position={[x, 0, 0]}>
      <mesh position={[0, 0.3, 0]} material={stone} castShadow>
        <cylinderGeometry args={[0.32, 0.4, 0.6, 6]} />
      </mesh>
      <mesh position={[0, 0.95, 0]} material={stone} castShadow>
        <cylinderGeometry args={[0.12, 0.14, 0.7, 6]} />
      </mesh>
      <mesh position={[0, 1.45, 0]} material={stone} castShadow>
        <boxGeometry args={[0.5, 0.4, 0.5]} />
      </mesh>
      <mesh position={[0, 1.45, 0.26]}>
        <planeGeometry args={[0.2, 0.22]} />
        <meshBasicMaterial color="#ffcf7a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.82, 0]} material={stone} castShadow>
        <coneGeometry args={[0.48, 0.38, 6]} />
      </mesh>
      <mesh position={[0, 1.94, 0]} material={moss}>
        <coneGeometry args={[0.36, 0.16, 6]} />
      </mesh>
    </group>
  );
  return (
    <group position={[SHRINE[0], floorAt(SHRINE[0], SHRINE[1]), SHRINE[1]]} rotation={[0, 0.12, 0]}>
      <mesh position={[0, 0.25, 0]} material={stone} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.5, 1.0]} />
      </mesh>
      <mesh position={[0, 1.35, 0]} castShadow>
        <boxGeometry args={[0.9, 1.7, 0.28]} />
        <meshStandardMaterial map={tabletTex} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.3, 0]} material={stone} castShadow>
        <boxGeometry args={[1.2, 0.2, 0.5]} />
      </mesh>
      <mesh position={[0, 2.42, 0]} material={moss}>
        <boxGeometry args={[1.1, 0.06, 0.45]} />
      </mesh>
      {lantern(-1.8)}
      {lantern(1.8)}
      <pointLight position={[0, 1.6, 0.9]} color="#ffbf6a" intensity={2.5} distance={6} decay={2} />
    </group>
  );
}

// ---------------------------------------------------------------
// light and air: god rays, dust motes, falling leaves, low mist
// ---------------------------------------------------------------
function GodRays() {
  const { group, mat } = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: shared.uTime, uColor: { value: new THREE.Color('#ffe2a0') } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vSeed; varying vec3 vWP;
        void main(){
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWP = w.xyz;
          vSeed = modelMatrix[3].x * 0.13 + modelMatrix[3].z * 0.07;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uColor; varying vec2 vUv; varying float vSeed; varying vec3 vWP;
        void main(){
          // soft across the beam, fading in under the canopy and out toward the ground
          float across = pow(sin(vUv.x * 3.14159), 2.0);
          float along = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
          float flick = 0.75 + 0.25 * sin(uTime * 0.7 + vSeed * 9.0) * sin(uTime * 0.31 + vSeed * 3.0);
          float a = across * along * flick * 0.26 * smoothstep(-0.5, 1.0, vWP.y);
          gl_FragColor = vec4(uColor * a, a);
        }`,
    });
    const group = new THREE.Group();
    const rand = seeded(107);
    // the beams come down along the sun direction, through gaps in the canopy
    const dir = SUN.clone().multiplyScalar(-1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    for (let k = 0; k < 22; k++) {
      const a = rand() * Math.PI * 2;
      const d = 3 + Math.sqrt(rand()) * (R - 6);
      const fx = Math.cos(a) * d;
      const fz = Math.sin(a) * d;
      const foot = new THREE.Vector3(fx, Math.max(floorAt(fx, fz), FOREST.waterY), fz);
      const len = 30;
      const w = 1.4 + rand() * 2.6;
      for (const rot of [0, Math.PI / 2]) {
        const g = new THREE.PlaneGeometry(w, len).translate(0, len / 2, 0);
        // uv.y = 0 at the ground end
        const m = new THREE.Mesh(g, mat);
        m.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot));
        m.position.copy(foot);
        m.renderOrder = 20;
        m.frustumCulled = false;
        group.add(m);
      }
    }
    return { group, mat };
  }, []);
  void mat;
  return <primitive object={group} />;
}

function Motes() {
  const pts = useMemo(() => {
    const n = 2400;
    const rand = seeded(109);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * (R - 4);
      pos.set([Math.cos(a) * r, 0.3 + rand() * 9, Math.sin(a) * r], i * 3);
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: shared.uTime },
      vertexShader: /* glsl */ `
        uniform float uTime; attribute float seed; varying float vA;
        void main(){
          vec3 p = position + vec3(sin(uTime * 0.3 + seed * 30.0), sin(uTime * 0.2 + seed * 17.0) * 0.6, cos(uTime * 0.25 + seed * 23.0)) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = clamp(10.0 / -mv.z, 1.0, 4.0);
          vA = (0.35 + 0.65 * pow(0.5 + 0.5 * sin(uTime * (1.0 + seed * 2.0) + seed * 40.0), 4.0)) * (1.0 - smoothstep(14.0, 26.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.92, 0.7) * vA, vA); }`,
    });
    const p = new THREE.Points(g, mat);
    p.frustumCulled = false;
    return p;
  }, []);
  return <primitive object={pts} />;
}

/** Leaves spiralling down; a gust blows them sideways in a flurry */
function FallingLeaves() {
  const { mesh, data } = useMemo(() => {
    const n = 600;
    const rand = seeded(113);
    const geo = new THREE.PlaneGeometry(0.16, 0.1);
    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    const im = new THREE.InstancedMesh(geo, mat, n);
    const col = new THREE.Color();
    const data = Array.from({ length: n }, (_, i) => {
      col.setHSL(0.08 + rand() * 0.14, 0.6 + rand() * 0.3, 0.3 + rand() * 0.2);
      im.setColorAt(i, col);
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * (R + 4);
      return { x: Math.cos(a) * r, z: Math.sin(a) * r, y: rand() * 18, s: rand(), spin: rand() * 6 };
    });
    im.frustumCulled = false;
    return { mesh: im, data };
  }, []);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  useFrame((st, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = st.clock.elapsedTime;
    const gust = mapRuntime.gust;
    data.forEach((d, i) => {
      d.y -= dt * (0.5 + d.s * 0.5);
      d.x += dt * (Math.sin(t * 0.8 + d.s * 20) * 0.6 + gust * 6);
      d.z += dt * (Math.cos(t * 0.6 + d.s * 13) * 0.4 + gust * 2.5);
      d.spin += dt * (2 + d.s * 3 + gust * 8);
      if (d.y < Math.max(floorAt(d.x, d.z), FOREST.waterY) + 0.03 || Math.hypot(d.x, d.z) > R + 8) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * (R + 2);
        d.x = Math.cos(a) * r;
        d.z = Math.sin(a) * r;
        d.y = 14 + Math.random() * 6;
      }
      e.set(d.spin, d.spin * 0.7, Math.sin(d.spin) * 0.8);
      q.setFromEuler(e);
      p.set(d.x + Math.sin(d.spin) * 0.3, d.y, d.z);
      m.compose(p, q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={mesh} />;
}

function Mist() {
  const items = useMemo(() => {
    const rand = seeded(127);
    return Array.from({ length: 40 }, () => {
      const a = rand() * Math.PI * 2;
      const r = R + 6 + rand() * 50;
      return { p: [Math.cos(a) * r, 1.5 + rand() * 2.5, Math.sin(a) * r] as [number, number, number], s: 14 + rand() * 12 };
    });
  }, []);
  const tex = useMemo(() => cloudPuffTexture(), []);
  return (
    <group>
      {items.map((it, i) => (
        <sprite key={i} position={it.p} scale={[it.s, it.s * 0.4, 1]}>
          <spriteMaterial map={tex} color="#dfe8d0" transparent opacity={0.4} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// hazard: dead branches crashing down
// ---------------------------------------------------------------
function branchGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.CylinderGeometry(0.1, 0.22, 4.6, 8).rotateZ(Math.PI / 2);
  parts.push(main);
  const rand = seeded(131);
  for (let k = 0; k < 5; k++) {
    const len = 0.8 + rand() * 1.2;
    const g = new THREE.CylinderGeometry(0.03, 0.08, len, 6).translate(0, len / 2, 0);
    g.rotateZ((rand() - 0.5) * 1.4);
    g.rotateX((rand() - 0.5) * 1.4);
    g.translate(-1.8 + k * 0.85, 0, 0);
    parts.push(g);
  }
  return mergeGeos(parts);
}

function FallingBranches() {
  const geo = useMemo(() => branchGeometry(), []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const leafMat = useMemo(() => new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, color: '#b79a55', roughness: 0.9 }), []);
  useFrame(() => {
    const list = mapRuntime.branches;
    for (let k = 0; k < 8; k++) {
      const g = refs.current[k];
      if (!g) continue;
      const b = list[k];
      if (!b || b.t < -0.45) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      let y: number;
      let tilt: number;
      if (b.t < 0) {
        const u = (b.t + 0.45) / 0.45; // 0..1 while falling
        y = 17 * (1 - u * u) + 0.25 * u * u + Math.max(floorAt(b.x, b.z), FOREST.waterY);
        tilt = 0.9 * (1 - u);
      } else {
        // bounce once, then sink into the moss and vanish
        y = Math.max(floorAt(b.x, b.z), FOREST.waterY - 0.2) + 0.25 + Math.max(0, Math.sin(Math.min(b.t, 0.3) * Math.PI / 0.3)) * 0.35 - Math.max(0, b.t - 1.4) * 0.6;
        tilt = 0;
      }
      g.position.set(b.x, y, b.z);
      g.rotation.set(tilt, b.a, tilt * 0.5);
    }
  });
  return (
    <group>
      {Array.from({ length: 8 }, (_, k) => (
        <group key={k} ref={(el) => (refs.current[k] = el)} visible={false}>
          <mesh geometry={geo} material={barkMaterial()} castShadow />
          {[-1.6, -0.4, 0.9].map((x, i) => (
            <mesh key={i} position={[x, 0.6, (i - 1) * 0.3]} rotation={[0.3 * i, i, 0.4]} material={leafMat}>
              <planeGeometry args={[1.5, 1.5]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Clock() {
  useFrame((st) => {
    shared.uTime.value = st.clock.elapsedTime;
    shared.uGust.value = mapRuntime.gust;
  });
  return null;
}

export function ForestMap() {
  return (
    <group>
      <Clock />
      <Sky zenith="#7d9cb4" horizon="#d8e0b6" below="#56663d" sunDir={[SUN.x, SUN.y, SUN.z]} sunColor="#fff0c0" sunSize={1.2} streaks={0.3} streakColor="#f4f1e0" />
      <Ground />
      <River />
      <Bridge />
      <GiantTrees />
      <BackgroundForest />
      <EdgeShrubs />
      <Grass />
      <Ferns />
      <Logs />
      <Stones />
      <Mushrooms />
      <Shrine />
      <FallingBranches />
      <Mist />
      <GodRays />
      <Motes />
      <FallingLeaves />
    </group>
  );
}
