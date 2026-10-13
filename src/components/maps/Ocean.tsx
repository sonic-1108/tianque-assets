import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mapRuntime } from '../../maps';

// ---------------------------------------------------------------
// 怒海战船 sea: a sum of Gerstner (trochoidal) waves. Each wave moves the surface in a little circle,
// so crests come out sharp and troughs broad, and where the circles crowd together (the surface
// folds) foam breaks. The same functions run on the CPU so the ship heaves and rolls with the sea.
// ---------------------------------------------------------------
const G = 9.8;
/** [direction (rad), wavelength m, amplitude m, sharpness (0..~0.15, sums below 1)] */
const WAVES: [number, number, number, number][] = [
  [0.2, 92, 1.7, 0.1],
  [1.05, 61, 1.05, 0.1],
  [-0.35, 33, 0.6, 0.14],
  [0.62, 21, 0.34, 0.14],
  [-0.95, 13, 0.19, 0.12],
  [0.35, 8.4, 0.1, 0.1],
  [1.55, 5.3, 0.055, 0.08],
  [-0.2, 3.3, 0.03, 0.06],
];
const W = WAVES.map(([a, L, A, c], i) => {
  const k = (Math.PI * 2) / L;
  return { dx: Math.cos(a), dz: Math.sin(a), k, w: Math.sqrt(G * k) * 0.8, A, D: c / k, ph: i * 1.7 };
});

/** height of the sea at (x, z): the long waves only (what a 50 m hull feels), in the sea's own frame */
export function seaSwell(x: number, z: number, t: number) {
  let h = 0;
  for (let i = 0; i < 3; i++) {
    const v = W[i];
    h += v.A * Math.sin(v.k * (v.dx * x + v.dz * z) - v.w * t + v.ph);
  }
  return h;
}

const GLSL_WAVES = `
  const int NW = ${W.length};
  ${['dx', 'dz', 'k', 'w', 'A', 'D', 'ph'].map((f) => `const float W_${f}[NW] = float[NW](${W.map((v) => (v as any)[f].toFixed(5)).join(', ')});`).join('\n  ')}
`;

const NOISE = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y); }
  float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
`;

/** a square grid that is fine near the ship and coarse toward the horizon */
function oceanGeometry(n = 300, half = 300) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  const f = (u: number) => Math.sign(u) * (0.12 * Math.abs(u) + 0.88 * Math.pow(Math.abs(u), 2.4)) * half;
  let o = 0;
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) {
      pos[o++] = f((i / n) * 2 - 1);
      pos[o++] = 0;
      pos[o++] = f((j / n) * 2 - 1);
    }
  const idx = new Uint32Array(n * n * 6);
  o = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + n + 1;
      idx[o++] = a;
      idx[o++] = b;
      idx[o++] = a + 1;
      idx[o++] = a + 1;
      idx[o++] = b;
      idx[o++] = b + 1;
    }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), half * 1.5);
  return g;
}

export function makeOcean(hull: { halfW: number; z0: number; z1: number }) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFog: { value: new THREE.Color('#1b2530') },
      uLightning: { value: 0 },
      // the rogue wave: x = side (±1), y = where its face is (x in the sea frame), z = height, w = how much it's breaking
      uRogue: { value: new THREE.Vector4(0, 999, 0, 0) },
      uHull: { value: new THREE.Vector4(hull.halfW, (hull.z0 + hull.z1) / 2, (hull.z1 - hull.z0) / 2, 0) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform vec4 uRogue; uniform vec4 uHull;
      varying vec3 vWorld; varying vec3 vN; varying float vFold; varying float vCrest; varying float vHull; varying float vLip; varying vec2 vP; varying float vRogue; varying float vFace;
      ${GLSL_WAVES}
      float hullDist(vec2 p){
        // rounded box around the hull's waterline
        vec2 q = abs(p - vec2(0.0, uHull.y)) - vec2(uHull.x, uHull.z);
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      }
      void main(){
        vec2 p = position.xz;
        float dH = hullDist(p);
        // short chop is broken up in the lee of the hull; the long swell passes under it
        float lee = smoothstep(-2.0, 7.0, dH);
        vec3 disp = vec3(0.0);
        vec3 dX = vec3(1.0, 0.0, 0.0);
        vec3 dZ = vec3(0.0, 0.0, 1.0);
        float jxx = 1.0, jzz = 1.0, jxz = 0.0;
        for (int i = 0; i < NW; i++) {
          float s = i < 3 ? 1.0 : mix(0.25, 1.0, lee);
          vec2 d = vec2(W_dx[i], W_dz[i]);
          float th = W_k[i] * dot(d, p) - W_w[i] * uTime + W_ph[i];
          float c = cos(th), sn = sin(th);
          float A = W_A[i] * s, D = W_D[i] * s;
          disp += vec3(d.x * D * c, A * sn, d.y * D * c);
          // derivatives of the displaced surface (for the normal) and of the horizontal map (for folding)
          float kD = W_k[i] * D, kA = W_k[i] * A;
          dX += vec3(-d.x * d.x * kD * sn, d.x * kA * c, -d.x * d.y * kD * sn);
          dZ += vec3(-d.x * d.y * kD * sn, d.y * kA * c, -d.y * d.y * kD * sn);
          jxx -= d.x * d.x * kD * sn;
          jzz -= d.y * d.y * kD * sn;
          jxz -= d.x * d.y * kD * sn;
        }
        // the rogue wave: a steep-faced wall of water running in toward the hull, its lip curling forward
        float side = uRogue.x;
        float lip = 0.0;
        float rh = 0.0;
        float rface = 0.0;
        if (abs(side) > 0.5 && uRogue.z > 0.01) {
          // a crescent: the middle runs ahead, the ends trail; the crest height breaks up along its length
          float lag = p.y * p.y / 140.0;
          float u = (p.x - (uRogue.y + side * lag)) * side;   // < 0: in front of the face (toward the ship)
          const float WF = 11.0; // front: steep but wide enough for the mesh to draw it smoothly
          const float WB = 140.0; // back: a long slope
          float prof = u < 0.0 ? exp(-u * u / WF) : exp(-u * u / WB);
          float along = exp(-pow(p.y / 34.0, 2.0)) * (0.74 + 0.16 * sin(p.y * 0.21 + 1.3) + 0.1 * sin(p.y * 0.57 + uTime * 0.7));
          float h = uRogue.z * prof * along;
          float hn = h / max(uRogue.z, 0.01);
          // the crest leans over its face
          disp.x -= side * pow(hn, 3.0) * uRogue.z * 0.28;
          disp.y += h;
          float dhdu = (u < 0.0 ? -2.0 * u / WF : -2.0 * u / WB) * h;
          dX.y += dhdu * side;
          rh = hn;
          rface = (u < 0.0 ? 1.0 : 0.35) * smoothstep(0.08, 0.3, hn);
          lip = smoothstep(0.82, 0.97, hn / max(along, 0.3)) * smoothstep(0.55, 0.8, along) + uRogue.w * prof * along;
        }
        vec3 pos = vec3(p.x, 0.0, p.y) + disp;
        vec3 nLocal = normalize(cross(dZ, dX));
        vN = normalize(mat3(modelMatrix) * nLocal);
        vFold = jxx * jzz - jxz * jxz;
        vCrest = disp.y - rh * uRogue.z;
        vRogue = rh;
        vFace = rface;
        vHull = dH;
        vLip = lip;
        vP = p;
        vec4 w = modelMatrix * vec4(pos, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFog; uniform float uLightning; uniform float uTime;
      varying vec3 vWorld; varying vec3 vN; varying float vFold; varying float vCrest; varying float vHull; varying float vLip; varying vec2 vP; varying float vRogue; varying float vFace;
      ${NOISE}
      void main(){
        vec3 V = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        // fine wind ripples on top of the waves, fading with distance
        // on the steep face of the big wave, sample texture up the face (height) instead of across the sea, or it smears into stripes
        float steep = smoothstep(0.35, 0.85, 1.0 - abs(normalize(vN).y));
        vec2 sp = mix(vP, vec2(vP.y, vWorld.y * 1.6 + vP.x * 0.3), steep);
        vec2 rp = sp * 0.55;
        float e = 0.08;
        float r0 = fbm(rp + vec2(uTime * 0.35, uTime * 0.22));
        float rx = fbm(rp + vec2(e, 0.0) + vec2(uTime * 0.35, uTime * 0.22));
        float rz = fbm(rp + vec2(0.0, e) + vec2(uTime * 0.35, uTime * 0.22));
        float detail = 0.55 * (1.0 - smoothstep(20.0, 120.0, dist));
        vec3 n = normalize(vN + vec3(r0 - rx, 0.0, r0 - rz) * (detail / e) * 0.12);
        float ndv = max(dot(n, V), 0.0);
        float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
        // storm sky in the reflection: brighter toward the horizon, lit up by lightning
        vec3 R = reflect(-V, n);
        vec3 sky = mix(vec3(0.11, 0.14, 0.18), vec3(0.03, 0.045, 0.06), clamp(R.y * 1.8, 0.0, 1.0));
        sky += uLightning * vec3(0.75, 0.8, 0.95) * (0.4 + 0.6 * clamp(R.y, 0.0, 1.0));
        // the water body: near-black deep, teal where light comes through the thin crests
        vec3 deep = vec3(0.004, 0.018, 0.026);
        float thin = smoothstep(0.2, 2.4, vCrest) * pow(1.0 - ndv, 1.5);
        // the big wave: dark at its foot, light glowing green through the thin water just under the crest
        float glow = smoothstep(0.45, 0.82, vRogue) * (1.0 - smoothstep(0.9, 1.0, vRogue)) * vFace;
        vec3 body = deep + vec3(0.015, 0.11, 0.115) * thin * 1.6 + vec3(0.03, 0.2, 0.2) * thin * uLightning;
        body = mix(body, deep * 0.6, smoothstep(0.05, 0.4, vRogue) * (1.0 - smoothstep(0.4, 0.75, vRogue)) * vFace * 0.6);
        body += vec3(0.02, 0.16, 0.15) * glow * (0.6 + 0.4 * pow(1.0 - ndv, 1.2)) + vec3(0.05, 0.3, 0.28) * glow * uLightning;
        vec3 col = mix(body, sky, fres);
        // lightning glints
        vec3 L = normalize(vec3(0.3, 0.8, -0.5));
        col += pow(max(dot(R, L), 0.0), 120.0) * (0.06 + uLightning * 3.0);
        // foam: where the surface folds over (breaking crests), streaked along the wind, plus the churn round the hull
        float fold = smoothstep(0.62, 0.18, vFold);
        float streak = fbm(vec2(sp.x * 0.12 + sp.y * 0.05, sp.y * 0.5 - sp.x * 0.2) + uTime * 0.05);
        float cells = fbm(sp * 0.9 + uTime * 0.15);
        float foam = fold * smoothstep(0.25, 0.65, cells + fold * 0.4);
        foam += smoothstep(0.55, 0.8, streak) * smoothstep(0.0, 1.5, vCrest) * 0.25;
        // churn along the hull: thin streaks of foam that peel away from the planking
        float hz = 1.0 - smoothstep(-0.5, 2.2, vHull + (noise(vP * 0.4 + uTime * 0.2) - 0.5) * 2.0);
        float churnN = fbm(vP * 0.75 + vec2(uTime * 0.3, -uTime * 0.5)) + fbm(vP * 2.3 - uTime * 0.4) * 0.35;
        foam += hz * smoothstep(0.62, 0.9, churnN) * 0.55;
        // the rogue wave's lip and face: spume torn off the crest, streaking down its front
        // the big wave: a churning white lip, and thin streaks of foam running down its face
        float churnLip = fbm(vec2(vP.y * 0.5, vWorld.y * 0.9) + vec2(uTime * 0.4, -uTime * 1.3));
        foam += vLip * smoothstep(0.3, 0.6, churnLip);
        float runs = fbm(vec2(vP.y * 0.9, vWorld.y * 0.35 - uTime * 0.8));
        foam += vFace * smoothstep(0.3, 0.75, vRogue) * smoothstep(0.62, 0.8, runs) * 0.55;
        foam = clamp(foam, 0.0, 1.0);
        vec3 foamCol = vec3(0.56, 0.63, 0.67) * (0.7 + 0.3 * max(n.y, 0.0)) + uLightning * 0.45;
        col = mix(col, foamCol, foam * 0.85);
        col = mix(col, uFog, smoothstep(40.0, 260.0, dist));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return { geometry: oceanGeometry(), material: mat };
}

let softTex: THREE.Texture | null = null;
function softDot() {
  if (softTex) return softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

/**
 * The rogue wave hitting the ship: a burst of spray and spindrift over the bulwark along the whole side,
 * then a sheet of foaming water that races across the main deck and drains away.
 * Runs off mapRuntime.waveRise / waveSide, so it plays the same on every screen.
 */
export function WaveCrash({ beam, deckZ }: { beam: number; deckZ: [number, number] }) {
  const N = 1800;
  const spray = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const a0 = new Float32Array(N * 3); // along the side z, height, outward offset
    const vel = new Float32Array(N * 3);
    const seed = new Float32Array(N * 2); // delay, size
    for (let i = 0; i < N; i++) {
      a0[i * 3] = (Math.random() * 2 - 1) * 27;
      a0[i * 3 + 1] = -1 + Math.random() * 3.5;
      a0[i * 3 + 2] = Math.random() * 1.5;
      const up = 7 + Math.random() * 11;
      vel[i * 3] = 4 + Math.random() * 14; // inboard
      vel[i * 3 + 1] = up;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 3;
      seed[i * 2] = Math.random() * 0.45;
      seed[i * 2 + 1] = 0.4 + Math.random() * 1.2;
    }
    g.setAttribute('position', new THREE.BufferAttribute(a0, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uT: { value: -1 }, uSide: { value: 1 }, uBeam: { value: beam }, uMap: { value: softDot() }, uLightning: { value: 0 }, uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        uniform float uT; uniform float uSide; uniform float uBeam; uniform float uScale;
        attribute vec3 aVel; attribute vec2 aSeed; varying float vA;
        void main(){
          float t = uT - aSeed.x;
          vA = 0.0;
          vec3 p = vec3(0.0, -50.0, 0.0);
          if (t > 0.0 && t < 1.8) {
            // thrown up and inboard over the rail, drag slows them, gravity brings them down on the deck
            float drag = (1.0 - exp(-1.6 * t)) / 1.6;
            p.x = uSide * (uBeam + 0.6 + position.z) - uSide * aVel.x * drag;
            p.y = position.y + aVel.y * drag - 0.5 * 11.0 * t * t;
            p.z = position.x + aVel.z * drag;
            p.y = max(p.y, 0.05);
            vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.9, 1.8, t));
          }
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float grow = 1.0 + max(t, 0.0) * 2.4; // droplets spread into mist
          gl_PointSize = aSeed.y * grow * uScale / max(-mv.z, 0.5);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uLightning; varying float vA;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a * vA * 0.55;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.72, 0.8, 0.85) + uLightning * 0.4, a);
        }`,
    });
    return { g, m };
  }, [beam]);
  const wash = useMemo(() => {
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uT: { value: -1 }, uSide: { value: 1 }, uBeam: { value: beam }, uTime: { value: 0 }, uLightning: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT; uniform float uSide; uniform float uBeam; uniform float uTime; uniform float uLightning; varying vec2 vP;
        ${NOISE}
        void main(){
          if (uT < 0.15 || uT > 2.6) discard;
          float t = uT - 0.15;
          // the leading edge races across from the side the wave came over, then the water thins out and drains
          float front = uSide * uBeam - uSide * t * 16.0;
          float behind = (vP.x - front) * uSide; // > 0: already covered
          float edge = smoothstep(-0.4, 0.4, behind);
          float thin = 1.0 - smoothstep(0.6, 2.4, t);
          vec2 flow = vec2(vP.x + uSide * t * 6.0, vP.y * 1.6);
          float f = fbm(flow * 0.7 + uTime * 0.6);
          float foam = smoothstep(0.35, 0.75, f + (1.0 - smoothstep(0.0, 1.6, behind)) * 0.35);
          float a = edge * thin * (0.25 + foam * 0.55);
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(vec3(0.25, 0.4, 0.45), vec3(0.75, 0.82, 0.86), foam) + uLightning * 0.3, a);
        }`,
    });
    return m;
  }, [beam]);
  const st = useRef({ t: -1, last: 0, side: 1 });
  useFrame((s, dt) => {
    const c = st.current;
    if (mapRuntime.waveRise > 1.05 && c.last <= 1.05) {
      c.t = 0;
      c.side = mapRuntime.waveSide || 1;
    }
    c.last = mapRuntime.waveRise;
    if (c.t >= 0) {
      c.t += Math.min(dt, 0.05);
      if (c.t > 3) c.t = -1;
    }
    const u = spray.m.uniforms;
    u.uT.value = c.t;
    u.uSide.value = c.side;
    u.uLightning.value = mapRuntime.lightning;
    u.uScale.value = s.size.height * 0.5;
    const w = wash.uniforms;
    w.uT.value = c.t;
    w.uSide.value = c.side;
    w.uTime.value = s.clock.elapsedTime;
    w.uLightning.value = mapRuntime.lightning;
  });
  return (
    <group>
      <points geometry={spray.g} material={spray.m} frustumCulled={false} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, (deckZ[0] + deckZ[1]) / 2]} material={wash} frustumCulled={false}>
        <planeGeometry args={[beam * 2, deckZ[1] - deckZ[0], 1, 1]} />
      </mesh>
    </group>
  );
}

/** where the rogue wave is, for the ocean shader: rising out of the sea toward the hull, then collapsing as it breaks over */
export function rogueState(out: THREE.Vector4, crashT: number, beam: number) {
  const side = mapRuntime.waveSide;
  const rise = Math.min(1, mapRuntime.waveRise);
  if (crashT >= 0 && crashT < 1.6) {
    const k = crashT / 1.6;
    out.set(side, side * (beam + 1.5 - crashT * 7), 7.5 * (1 - k) * (1 - k), 1 - k);
  } else if (rise > 0.01 && Math.abs(side) > 0.5) {
    out.set(side, side * (beam + 2.5 + (1 - rise) * 60), 1.5 + 6.0 * rise * rise, 0);
  } else out.set(0, 999, 0, 0);
}

/**
 * Spindrift torn off the rogue wave's crest while it rears up: a curtain of spray blown back over the top of it.
 * Lives in the sea's own frame (inside the rolling world group) and reads the same uRogue vector the ocean uses.
 */
export function CrestSpray({ rogue }: { rogue: THREE.Vector4 }) {
  const N = 1500;
  const { geo, mat } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = 0;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = (Math.random() * 2 - 1) * 36; // along the crest
      seed[i * 3] = Math.random(); // phase
      seed[i * 3 + 1] = 0.5 + Math.random(); // size
      seed[i * 3 + 2] = 0.6 + Math.random() * 0.8; // gust strength
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 200);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uRogue: { value: rogue }, uTime: { value: 0 }, uLightning: { value: 0 }, uMap: { value: softDot() }, uScale: { value: 300 } },
      vertexShader: /* glsl */ `
        uniform vec4 uRogue; uniform float uTime; uniform float uScale;
        attribute vec3 aSeed; varying float vA;
        void main(){
          float side = uRogue.x;
          float H = uRogue.z;
          float z = position.z;
          float L = 1.3;
          float t = fract(uTime / L + aSeed.x) * L;
          float along = exp(-pow(z / 34.0, 2.0)) * (0.74 + 0.16 * sin(z * 0.21 + 1.3));
          // where the crest is (the same crescent and lean as the wave in the ocean shader)
          float xc = uRogue.y + side * z * z / 140.0 - side * 0.28 * H;
          float yc = H * along;
          vec3 p = vec3(xc + side * (0.6 + 4.5 * t) * aSeed.z, yc + (3.0 * t - 2.4 * t * t) * aSeed.z, z + (aSeed.x - 0.5) * 2.0 * t);
          vA = abs(side) > 0.5 ? smoothstep(2.5, 5.0, H) * smoothstep(0.35, 0.7, along) * (1.0 - t / L) * smoothstep(0.0, 0.12, t) : 0.0;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSeed.y * (1.0 + t * 3.0) * uScale / max(-mv.z, 0.5);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform float uLightning; varying float vA;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).a * vA * 0.5;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.7, 0.78, 0.82) + uLightning * 0.45, a);
        }`,
    });
    return { geo: g, mat: m };
  }, [rogue]);
  useFrame((s) => {
    mat.uniforms.uTime.value = s.clock.elapsedTime;
    mat.uniforms.uLightning.value = mapRuntime.lightning;
    mat.uniforms.uScale.value = s.size.height * 0.5;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}
