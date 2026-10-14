import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Sky, KarstPeaks, CloudSea, CloudPuffs, Banner, seeded, cloudPuffTexture } from './Scenery';
import { ChanganMap } from './maps/Changan';
import { SummitMap } from './maps/Summit';
import { ForestMap } from './maps/Forest';
import { GlacierMap } from './maps/Glacier';
import { DesertMap } from './maps/Desert';
import { useSettings } from '../settings';
import { makeOcean, seaSwell, rogueState, WaveCrash, CrestSpray, StormSky } from './maps/Ocean';
import { ShipHull, ShipStructure, Ballista, Bolts, SternCastle, RailLanterns, ShipLantern, JunkSail, Mast, RopeCoil, HatchGrate, DistantJunk, deckTexture, crateTexture, hullW, sheer } from './maps/Ship';
import { MAPS, MapId, mapRuntime, SHIP_LAYOUT, SHIP_BOXES, SHIP_HELM, SHIP_PLANKS, SEA_PILLARS_LOCAL, shipFloorAtL, shipCeilAt, VOLCANO_CRATER, GLACIER, glacierHeight, glacierGradient, glacierPath } from '../maps';

const NOISE = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y); }
  float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5; } return v; }
`;

/** Flowing lava. Writes HDR values (>1) so the bloom pass makes it glow. */
function makeLavaMaterial(extra: { forgeMask?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    transparent: !!extra.forgeMask,
    depthWrite: !extra.forgeMask,
    polygonOffset: !!extra.forgeMask,
    polygonOffsetFactor: -2,
    uniforms: {
      uTime: { value: 0 },
      uLavaR: { value: 99 },
      uIslands: { value: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -1)] },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld; uniform float uTime; uniform float uLavaR; uniform vec3 uIslands[3];
      ${NOISE}
      void main(){
        vec2 p = vWorld.xz * 0.22;
        float n = fbm(p + vec2(uTime * 0.05, uTime * 0.03) + fbm(p * 1.7 - uTime * 0.04));
        float veins = smoothstep(0.55, 0.75, n);
        vec3 crust = vec3(0.10, 0.025, 0.01);
        vec3 hot = vec3(2.6, 0.75, 0.12);
        vec3 white = vec3(3.2, 2.2, 1.0);
        vec3 col = mix(crust, hot, smoothstep(0.35, 0.62, n));
        col = mix(col, white, veins * 0.6);
        float a = 1.0;
        ${
          extra.forgeMask
            ? `float r = length(vWorld.xz);
        float edge = smoothstep(uLavaR - 0.25, uLavaR + 0.35, r);
        for (int i = 0; i < 3; i++) {
          if (uIslands[i].z > 0.0) edge *= smoothstep(uIslands[i].z - 0.15, uIslands[i].z + 0.35, length(vWorld.xz - uIslands[i].xy));
        }
        // glowing rim where the lava meets the rock
        col += vec3(1.6, 0.5, 0.05) * (1.0 - smoothstep(0.0, 0.35, abs(r - uLavaR))) * step(r, 50.0);
        a = edge;
        if (a < 0.01) discard;`
            : ''
        }
        gl_FragColor = vec4(col, a);
      }`,
  });
}

function rockTexture(base: string, crackGlow: boolean) {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,230,210'},${Math.random() * 0.07})`;
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, Math.random() * 22 + 2, 0, Math.PI * 2);
    g.fill();
  }
  const emissive = document.createElement('canvas');
  emissive.width = emissive.height = S;
  const e = emissive.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  if (crackGlow) {
    e.strokeStyle = '#ff6a1a';
    e.shadowColor = '#ff4a00';
    e.shadowBlur = 10;
    g.strokeStyle = 'rgba(10,4,2,0.9)';
    for (let k = 0; k < 26; k++) {
      let x = Math.random() * S;
      let y = Math.random() * S;
      let a = Math.random() * Math.PI * 2;
      e.beginPath();
      g.beginPath();
      e.moveTo(x, y);
      g.moveTo(x, y);
      for (let j = 0; j < 10; j++) {
        a += (Math.random() - 0.5) * 1.1;
        x += Math.cos(a) * 28;
        y += Math.sin(a) * 28;
        e.lineWidth = g.lineWidth = 3 + Math.random() * 3;
        e.lineTo(x, y);
        g.lineTo(x, y);
      }
      e.stroke();
      g.stroke();
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const em = new THREE.CanvasTexture(emissive);
  em.colorSpace = THREE.SRGBColorSpace;
  em.wrapS = em.wrapT = THREE.RepeatWrapping;
  return { map, em };
}

// ------------------------------------------------------------------
// 天阙演武场: a marble terrace on a mountain peak above a sea of clouds at sunset
// ------------------------------------------------------------------
const TEMPLE_SUN: [number, number, number] = [0.35, 0.16, -1];

/** Concentric stone slabs drawn in polar layout (UVs of a circle map straight onto it) */
function templeFloorTextures() {
  const S = 2048;
  const C = S / 2;
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const g = col.getContext('2d')!;
  const bump = document.createElement('canvas');
  bump.width = bump.height = S;
  const b = bump.getContext('2d')!;
  const rand = seeded(42);
  g.fillStyle = '#b9ad9b';
  g.fillRect(0, 0, S, S);
  b.fillStyle = '#808080';
  b.fillRect(0, 0, S, S);
  // rings of slabs from the centre medallion outward
  const rings = [0.13, 0.22, 0.31, 0.4, 0.49, 0.58, 0.67, 0.76, 0.85, 0.93, 1.0];
  for (let ri = 1; ri < rings.length; ri++) {
    const r0 = rings[ri - 1] * C;
    const r1 = rings[ri] * C;
    const n = Math.round(10 + ri * 7);
    const off = rand() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a0 = off + (k / n) * Math.PI * 2;
      const a1 = off + ((k + 1) / n) * Math.PI * 2;
      const l = 46 + rand() * 12;
      const sat = 8 + rand() * 8;
      g.fillStyle = `hsl(${32 + rand() * 10}, ${sat}%, ${l}%)`;
      g.beginPath();
      g.arc(C, C, r1, a0, a1);
      g.arc(C, C, r0, a1, a0, true);
      g.closePath();
      g.fill();
      // per-slab weathering
      for (let q = 0; q < 14; q++) {
        const a = a0 + rand() * (a1 - a0);
        const rr = r0 + rand() * (r1 - r0);
        g.fillStyle = `rgba(${rand() < 0.6 ? '60,45,30' : '255,250,235'},${rand() * 0.08})`;
        g.beginPath();
        g.arc(C + Math.cos(a) * rr, C + Math.sin(a) * rr, 6 + rand() * 30, 0, Math.PI * 2);
        g.fill();
      }
      // seams (dark in colour, low in bump)
      for (const [ctx, style, w] of [
        [g, 'rgba(58,44,32,0.85)', 5],
        [b, '#202020', 7],
      ] as const) {
        ctx.strokeStyle = style;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a0) * r0, C + Math.sin(a0) * r0);
        ctx.lineTo(C + Math.cos(a0) * r1, C + Math.sin(a0) * r1);
        ctx.stroke();
      }
    }
    for (const [ctx, style, w] of [
      [g, 'rgba(58,44,32,0.85)', 5],
      [b, '#202020', 7],
    ] as const) {
      ctx.strokeStyle = style;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(C, C, r1, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // bronze inlay rings
  for (const [rr, w] of [
    [0.76, 10],
    [0.13, 8],
  ] as const) {
    g.strokeStyle = '#8a6326';
    g.lineWidth = w;
    g.beginPath();
    g.arc(C, C, rr * C, 0, Math.PI * 2);
    g.stroke();
    b.strokeStyle = '#d0d0d0';
    b.lineWidth = w;
    b.beginPath();
    b.arc(C, C, rr * C, 0, Math.PI * 2);
    b.stroke();
  }
  // 八卦: eight trigrams engraved around the medallion
  const tri = ['111', '110', '101', '100', '011', '010', '001', '000'];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2;
    g.save();
    g.translate(C + Math.cos(a) * 0.175 * C, C + Math.sin(a) * 0.175 * C);
    g.rotate(a + Math.PI / 2);
    for (let line = 0; line < 3; line++) {
      const y = -24 + line * 22;
      g.fillStyle = '#5b4632';
      if (tri[k][line] === '1') g.fillRect(-46, y, 92, 12);
      else {
        g.fillRect(-46, y, 38, 12);
        g.fillRect(8, y, 38, 12);
      }
    }
    g.restore();
  }
  // 太极 medallion
  const R = 0.1 * C;
  g.fillStyle = '#e8e0d0';
  g.beginPath();
  g.arc(C, C, R, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3e3328';
  g.beginPath();
  g.arc(C, C, R, Math.PI / 2, (Math.PI * 3) / 2);
  g.arc(C, C - R / 2, R / 2, Math.PI / 2, (Math.PI * 3) / 2, true);
  g.arc(C, C + R / 2, R / 2, (Math.PI * 3) / 2, Math.PI / 2);
  g.fill();
  g.fillStyle = '#e8e0d0';
  g.beginPath();
  g.arc(C, C + R / 2, R / 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#3e3328';
  g.beginPath();
  g.arc(C, C - R / 2, R / 7, 0, Math.PI * 2);
  g.fill();
  // moss and grime creeping in from the outer edge and the seams
  for (let q = 0; q < 900; q++) {
    const a = rand() * Math.PI * 2;
    const rr = (0.6 + Math.pow(rand(), 0.6) * 0.4) * C;
    g.fillStyle = `rgba(${rand() < 0.5 ? '78,92,52' : '70,60,44'},${rand() * 0.12})`;
    g.beginPath();
    g.arc(C + Math.cos(a) * rr, C + Math.sin(a) * rr, 3 + rand() * 16, 0, Math.PI * 2);
    g.fill();
  }
  // a few cracks
  g.strokeStyle = 'rgba(40,30,22,0.7)';
  b.strokeStyle = '#303030';
  for (let k = 0; k < 18; k++) {
    let x = C + (rand() - 0.5) * S * 0.8;
    let y = C + (rand() - 0.5) * S * 0.8;
    let a = rand() * Math.PI * 2;
    g.lineWidth = b.lineWidth = 2;
    g.beginPath();
    b.beginPath();
    g.moveTo(x, y);
    b.moveTo(x, y);
    for (let j = 0; j < 7; j++) {
      a += (rand() - 0.5) * 1.2;
      x += Math.cos(a) * 18;
      y += Math.sin(a) * 18;
      g.lineTo(x, y);
      b.lineTo(x, y);
    }
    g.stroke();
    b.stroke();
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bumpMap = new THREE.CanvasTexture(bump);
  bumpMap.anisotropy = 8;
  return { map, bumpMap };
}

/** Grey cliff rock wrapping the side of the peak */
function cliffTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const rand = seeded(9);
  g.fillStyle = '#6f675e';
  g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '20,18,16' : '230,220,200'},${rand() * 0.08})`;
    g.fillRect(rand() * 1024, rand() * 512, 4 + rand() * 60, 2 + rand() * 10);
  }
  // vertical strata streaks
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(30,26,22,${rand() * 0.2})`;
    g.fillRect(rand() * 1024, 0, 1 + rand() * 4, 512);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 2);
  return t;
}

/** 汉白玉 balustrade: posts with lotus caps and two rails, built as instanced meshes */
function Balustrade({ radius, gapAngles = [] }: { radius: number; gapAngles?: number[] }) {
  const { posts, rails, caps } = useMemo(() => {
    const n = Math.max(48, Math.round((2 * Math.PI * radius) / 1.7));
    const keep: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (gapAngles.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.07)) continue;
      keep.push(a);
    }
    const marble = new THREE.MeshStandardMaterial({ color: '#e6e0d3', roughness: 0.55 });
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 1.05, 0.26), marble, keep.length);
    const caps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), marble, keep.length);
    const segLen = (2 * Math.PI * radius) / n;
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(segLen - 0.2, 0.12, 0.14), marble, keep.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    keep.forEach((a, i) => {
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
      posts.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.52, z), q, one));
      caps.setMatrixAt(i, m.compose(new THREE.Vector3(x, 1.12, z), q, new THREE.Vector3(1, 1.25, 1)));
      const am = a + Math.PI / n;
      const rx = Math.cos(am) * radius;
      const rz = Math.sin(am) * radius;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -am + Math.PI / 2);
      rails.setMatrixAt(i * 2, m.compose(new THREE.Vector3(rx, 0.9, rz), q, one));
      rails.setMatrixAt(i * 2 + 1, m.compose(new THREE.Vector3(rx, 0.3, rz), q, one));
    });
    for (const im of [posts, caps, rails]) {
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.needsUpdate = true;
    }
    return { posts, rails, caps };
  }, [radius, gapAngles]);
  return (
    <group>
      <primitive object={posts} />
      <primitive object={rails} />
      <primitive object={caps} />
    </group>
  );
}

/** Vermilion lacquer column: brush-streaked lacquer, a gilt band of cloud scrolls near the top, worn edges */
function lacquerTexture() {
  const W = 512;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const rand = seeded(77);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#7d1b12');
  grd.addColorStop(1, '#6a150f');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // vertical brush streaks in the lacquer
  for (let i = 0; i < 700; i++) {
    g.fillStyle = `rgba(${rand() < 0.5 ? '40,6,4' : '160,48,30'},${rand() * 0.08})`;
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 3, 20 + rand() * 200);
  }
  // gilt bands with cloud scrolls (top) and a plain band (base)
  const band = (y0: number, h: number, scrolls: boolean) => {
    g.fillStyle = '#1d3b3a';
    g.fillRect(0, y0, W, h);
    g.fillStyle = '#c99a3a';
    g.fillRect(0, y0, W, 6);
    g.fillRect(0, y0 + h - 6, W, 6);
    if (!scrolls) return;
    g.strokeStyle = '#d8aa48';
    g.lineWidth = 5;
    for (let k = 0; k < 8; k++) {
      const x = (k + 0.5) * (W / 8);
      const cy = y0 + h / 2;
      g.beginPath();
      g.arc(x, cy, h * 0.28, Math.PI * 0.2, Math.PI * 1.7);
      g.stroke();
      g.beginPath();
      g.arc(x + h * 0.18, cy + h * 0.06, h * 0.13, Math.PI, Math.PI * 2.6);
      g.stroke();
    }
  };
  band(60, 120, true);
  band(H - 90, 50, false);
  // wear: chipped lacquer showing dark wood near the base
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(30,16,10,${0.2 + rand() * 0.4})`;
    g.fillRect(rand() * W, H - 220 + rand() * 200, 2 + rand() * 10, 1 + rand() * 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function TempleMap() {
  const def = MAPS.temple;
  const R = def.radius;
  const floor = useMemo(() => templeFloorTextures(), []);
  const cliff = useMemo(() => cliffTexture(), []);
  const lacquer = useMemo(() => new THREE.MeshPhysicalMaterial({ map: lacquerTexture(), roughness: 0.42, metalness: 0.02, clearcoat: 0.7, clearcoatRoughness: 0.25 }), []);
  const gold = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9962e', roughness: 0.3, metalness: 0.9 }), []);
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfc6b6', roughness: 0.7 }), []);
  const weathered = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5e2a22', roughness: 0.85 }), []);
  // broken-off column top: a short cylinder whose upper rim is randomly chipped
  const jagged = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.76, 0.78, 0.3, 18, 1);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const rand = seeded(5);
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) + (rand() - 0.7) * 0.2);
      else pos.setY(i, pos.getY(i) - 0.15);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const flames = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.4, 0.35), toneMapped: false }), []);
  const flameRefs = useRef<THREE.Mesh[]>([]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    flameRefs.current.forEach((m, i) => {
      if (!m) return;
      const f = 1 + Math.sin(t * 9 + i * 1.7) * 0.12 + Math.sin(t * 23 + i) * 0.06;
      m.scale.set(1 / f, f, 1 / f);
    });
  });
  return (
    <group>
      <Sky zenith="#3d5f8f" horizon="#f2b27a" below="#d99a6c" sunDir={TEMPLE_SUN} sunColor="#ffcf8a" sunSize={2} streaks={0.8} streakColor="#ffe3c2" />
      <CloudSea y={-16} color="#fff1df" shadow="#b08f98" horizon="#f2b27a" sunDir={TEMPLE_SUN} />
      <KarstPeaks
        haze="#e2a98c"
        rock="#2a302f"
        light="#ffc27a"
        lightDir={TEMPLE_SUN}
        baseY={-45}
        exclude={[-1.75, -1.05]}
        layers={[
          { dist: 85, count: 10, height: [40, 62], radius: [3.5, 6], haze: 0.1 },
          { dist: 150, count: 16, height: [50, 85], radius: [5, 9], haze: 0.4 },
          { dist: 250, count: 22, height: [60, 115], radius: [8, 15], haze: 0.75 },
        ]}
      />
      <CloudPuffs count={22} inner={26} outer={95} y={[-12, 4]} color="#ffe9d6" />

      {/* terrace floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[R + 1.6, 96]} />
        <meshStandardMaterial map={floor.map} bumpMap={floor.bumpMap} bumpScale={1.2} roughness={0.78} />
      </mesh>
      {/* raised outer kerb the balustrade stands on */}
      <mesh position={[0, -0.18, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[R + 2.1, R + 2.3, 0.5, 96, 1, true]} />
        <primitive object={stone} attach="material" />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[R + 1.6, R + 2.15, 96]} />
        <primitive object={stone} attach="material" />
      </mesh>
      <Balustrade radius={R + 0.55} />
      {/* the peak itself, dropping away into the clouds */}
      <mesh position={[0, -14, 0]} receiveShadow>
        <cylinderGeometry args={[R + 2.3, R * 0.55, 28, 40, 6, true]} />
        <meshStandardMaterial map={cliff} roughness={1} />
      </mesh>
      {[0, 1, 2, 3, 4, 5, 6].map((k) => {
        const a = (k / 7) * Math.PI * 2 + 0.4;
        return (
          <mesh key={k} position={[Math.cos(a) * (R + 1.2), -6 - (k % 3) * 2, Math.sin(a) * (R + 1.2)]} rotation={[0.3, a, 0.2]}>
            <dodecahedronGeometry args={[2.2 + (k % 3), 0]} />
            <meshStandardMaterial color="#6a625a" roughness={1} flatShading />
          </mesh>
        );
      })}
      {/* banners around the rim */}
      {Array.from({ length: 12 }, (_, k) => k).map((k) => {
        const a = (k / 12) * Math.PI * 2 + Math.PI / 12;
        return <Banner key={k} position={[Math.cos(a) * (R + 1.85), 0, Math.sin(a) * (R + 1.85)]} rotationY={-a - Math.PI / 2} color={k % 2 ? '#8f1d1d' : '#1f3a5f'} />;
      })}

      {/* lacquered pillars (full) and broken stone stumps you can jump onto */}
      {def.pillars!.map((p, i) => {
        const broken = (p.h ?? 99) < 4;
        const shaft = broken ? (p.h ?? 2.6) - 0.45 : 4.35;
        return (
          <group key={i} position={[p.x, 0, p.z]}>
            {/* lotus plinth */}
            <mesh position={[0, 0.2, 0]} castShadow receiveShadow material={stone}>
              <cylinderGeometry args={[p.r + 0.28, p.r + 0.42, 0.4, 24]} />
            </mesh>
            <mesh position={[0, 0.45, 0]} castShadow material={stone}>
              <cylinderGeometry args={[p.r + 0.08, p.r + 0.26, 0.14, 24]} />
            </mesh>
            {broken ? (
              <>
                <mesh position={[0, 0.5 + (shaft - 0.15) / 2, 0]} castShadow receiveShadow material={lacquer}>
                  <cylinderGeometry args={[p.r * 0.92, p.r * 0.92, shaft - 0.15, 24]} />
                </mesh>
                <mesh position={[0, 0.75, 0]} castShadow material={gold}>
                  <cylinderGeometry args={[p.r * 0.95, p.r * 0.95, 0.16, 24]} />
                </mesh>
                <mesh position={[0, p.h!, 0]} receiveShadow castShadow geometry={jagged}>
                  <meshStandardMaterial color="#6e5a4c" roughness={0.95} flatShading />
                </mesh>
                <mesh position={[0.28, p.h! + 0.1, 0.12]} rotation={[0.3, 0.6, 0.2]} castShadow material={weathered}>
                  <boxGeometry args={[0.42, 0.26, 0.32]} />
                </mesh>
                {/* rubble from the break */}
                <mesh position={[0.95, 0.12, 0.5]} rotation={[0.4, i, 0.3]} castShadow material={weathered}>
                  <dodecahedronGeometry args={[0.22, 0]} />
                </mesh>
                <mesh position={[0.7, 0.08, -0.75]} rotation={[0.1, i * 2, 0.6]} castShadow material={stone}>
                  <dodecahedronGeometry args={[0.15, 0]} />
                </mesh>
              </>
            ) : (
              <>
                <mesh position={[0, 0.5 + shaft / 2, 0]} castShadow receiveShadow material={lacquer}>
                  <cylinderGeometry args={[p.r * 0.86, p.r * 0.92, shaft, 24]} />
                </mesh>
                {[0.75, 4.35].map((y) => (
                  <mesh key={y} position={[0, y, 0]} castShadow material={gold}>
                    <cylinderGeometry args={[p.r * 0.95, p.r * 0.95, 0.16, 24]} />
                  </mesh>
                ))}
                {/* capital and bronze fire bowl */}
                <mesh position={[0, 5.0, 0]} castShadow material={stone}>
                  <cylinderGeometry args={[p.r + 0.32, p.r * 0.86, 0.5, 24]} />
                </mesh>
                <mesh position={[0, 5.38, 0]} castShadow>
                  <cylinderGeometry args={[0.62, 0.32, 0.36, 18]} />
                  <meshStandardMaterial color="#5a3d22" metalness={0.8} roughness={0.35} />
                </mesh>
                <mesh
                  ref={(m) => {
                    if (m) flameRefs.current[i] = m;
                  }}
                  position={[0, 5.85, 0]}
                  material={flames}
                >
                  <coneGeometry args={[0.38, 1.0, 12]} />
                </mesh>
                {Math.hypot(p.x, p.z) < 12 && <pointLight position={[0, 6.2, 0]} color="#ffa04a" intensity={8} distance={12} />}
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------
// 熔岩断崖: a basalt-column mesa over a lava sea, under an ash-choked sky
// ------------------------------------------------------------------
/** Hexagonal basalt paving with a few seams of molten rock (colour + emissive + bump) */
function basaltFloorTextures() {
  const S = 2048;
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const g = col.getContext('2d')!;
  const emc = document.createElement('canvas');
  emc.width = emc.height = S;
  const e = emc.getContext('2d')!;
  const bmc = document.createElement('canvas');
  bmc.width = bmc.height = S;
  const b = bmc.getContext('2d')!;
  const rand = seeded(77);
  g.fillStyle = '#15100e';
  g.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  b.fillStyle = '#202020';
  b.fillRect(0, 0, S, S);
  const hexR = 78;
  const w = Math.sqrt(3) * hexR;
  const hexPath = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) => {
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  for (let row = -1; row * hexR * 1.5 < S + hexR; row++) {
    for (let c = -1; c * w < S + w; c++) {
      const cx = c * w + (row % 2 ? w / 2 : 0) + (rand() - 0.5) * 6;
      const cy = row * hexR * 1.5 + (rand() - 0.5) * 6;
      const r = hexR - 5 - rand() * 4;
      const l = 14 + rand() * 9;
      g.fillStyle = `hsl(${12 + rand() * 14}, ${8 + rand() * 8}%, ${l}%)`;
      hexPath(g, cx, cy, r);
      g.fill();
      // worn, slightly convex column tops
      const grd = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 2, cx, cy, r);
      grd.addColorStop(0, 'rgba(255,230,210,0.07)');
      grd.addColorStop(1, 'rgba(0,0,0,0.18)');
      g.fillStyle = grd;
      hexPath(g, cx, cy, r);
      g.fill();
      for (let q = 0; q < 10; q++) {
        g.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '200,170,150'},${rand() * 0.08})`;
        g.beginPath();
        g.arc(cx + (rand() - 0.5) * r, cy + (rand() - 0.5) * r, 2 + rand() * 9, 0, Math.PI * 2);
        g.fill();
      }
      b.fillStyle = `rgb(${150 + rand() * 60},${150 + rand() * 60},${150 + rand() * 60})`;
      hexPath(b, cx, cy, r);
      b.fill();
      // molten seam around some columns
      if (rand() < 0.22) {
        e.strokeStyle = rand() < 0.5 ? '#ff7a1a' : '#ff4a0a';
        e.lineWidth = 3 + rand() * 4;
        e.shadowColor = '#ff3a00';
        e.shadowBlur = 14;
        hexPath(e, cx, cy, hexR - 2);
        e.stroke();
      }
    }
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const em = new THREE.CanvasTexture(emc);
  em.colorSpace = THREE.SRGBColorSpace;
  const bump = new THREE.CanvasTexture(bmc);
  return { map, em, bump };
}

/** Basalt columns forming the cliff face of the mesa (instanced hex prisms) */
function BasaltColumns({ radius, emissive }: { radius: number; emissive: THREE.Texture }) {
  const mesh = useMemo(() => {
    const rand = seeded(13);
    const geo = new THREE.CylinderGeometry(0.62, 0.62, 1, 6, 1);
    geo.translate(0, -0.5, 0); // origin at the top face
    const mat = new THREE.MeshStandardMaterial({ color: '#2a2220', roughness: 0.92, flatShading: true, emissiveMap: emissive, emissive: '#ffffff', emissiveIntensity: 0.5 });
    const items: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    // three staggered rings hugging the platform edge, plus loose columns further down
    for (const [rr, top, len, n] of [
      [radius + 0.15, -0.05, [6, 11], 64],
      [radius + 1.1, -0.9, [5, 12], 70],
      [radius + 2.1, -2.2, [4, 10], 76],
      [radius + 3.2, -4.0, [3, 9], 60],
    ] as const) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rand() * 0.04;
        const d = rr + (rand() - 0.5) * 0.4;
        const t = top - rand() * 0.9;
        const l = len[0] + rand() * (len[1] - len[0]);
        q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.06, rand() * 6, (rand() - 0.5) * 0.06));
        items.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * d, t, Math.sin(a) * d), q, new THREE.Vector3(1, l, 1)));
      }
    }
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    return im;
  }, [radius, emissive]);
  return <primitive object={mesh} />;
}

/** Falling ash and rising embers around the arena */
function AshAndEmbers() {
  const { geo, mat } = useMemo(() => {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const kind = new Float32Array(n);
    const rand = seeded(21);
    for (let i = 0; i < n; i++) {
      pos.set([(rand() - 0.5) * 70, rand() * 30, (rand() - 0.5) * 70], i * 3);
      kind[i] = rand() < 0.3 ? 1 : 0; // 1 = ember, 0 = ash flake
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uErupt: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime; uniform float uErupt; attribute float kind; varying float vKind; varying float vFade;
        void main(){
          vec3 p = position;
          float sp = kind > 0.5 ? 1.6 + uErupt * 3.0 : -0.9;
          p.y = mod(p.y + uTime * sp, 30.0) - 6.0;
          p.x += sin(uTime * 0.5 + position.z) * 1.2 + uTime * 0.6;
          p.x = mod(p.x + 35.0, 70.0) - 35.0;
          p.z += cos(uTime * 0.4 + position.x) * 1.2;
          vKind = kind;
          vFade = smoothstep(-6.0, -2.0, p.y) * (1.0 - smoothstep(18.0, 24.0, p.y));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (kind > 0.5 ? 70.0 : 45.0) / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vKind; varying float vFade;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          vec3 c = vKind > 0.5 ? vec3(3.0, 0.9, 0.2) : vec3(0.22, 0.2, 0.19);
          float a = (vKind > 0.5 ? 1.0 : 0.5) * (1.0 - d * 2.0) * vFade;
          gl_FragColor = vec4(c * a, a);
        }`,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    mat.uniforms.uErupt.value = mapRuntime.eruption;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

function LavaCliffMap() {
  const def = MAPS.lavacliff;
  const lava = useMemo(() => makeLavaMaterial(), []);
  const floor = useMemo(() => basaltFloorTextures(), []);
  const crackTex = useMemo(() => {
    const t = rockTexture('#2a221f', true);
    t.map.repeat.set(3, 3);
    t.em.repeat.set(3, 3);
    return t;
  }, []);
  const ventMats = useMemo(
    () => def.vents!.map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.05, 0), transparent: true, opacity: 0.95, toneMapped: false })),
    [def.vents]
  );
  useFrame((st) => {
    lava.uniforms.uTime.value = st.clock.elapsedTime;
    def.vents!.forEach((_, i) => {
      const h = mapRuntime.ventHeat[i] ?? 0;
      ventMats[i].color.setRGB(0.5 + h * 3.5, 0.08 + h * 0.9, h * 0.15);
    });
  });
  return (
    <group>
      <Sky zenith="#0d0606" horizon="#5a1f0e" below="#2a0c05" sunDir={[-0.6, 0.12, -0.8]} sunColor="#ff5a1a" sunSize={0} streaks={0.9} streakColor="#2a1512" />
      <KarstPeaks
        seed={31}
        haze="#3a140b"
        rock="#060404"
        light="#ff4a10"
        lightDir={[0, -0.3, 1]}
        rimStrength={0.12}
        baseY={-8}
        pines={false}
        layers={[
          { dist: 60, count: 9, height: [10, 26], radius: [2.5, 5], haze: 0.05 },
          { dist: 120, count: 14, height: [16, 40], radius: [4, 8], haze: 0.35 },
          { dist: 210, count: 18, height: [25, 60], radius: [8, 16], haze: 0.65 },
        ]}
      />
      <AshAndEmbers />

      {/* arena top: hex basalt paving */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[def.radius + 0.15, 64]} />
        <meshStandardMaterial map={floor.map} emissiveMap={floor.em} emissive="#ffffff" emissiveIntensity={1.6} bumpMap={floor.bump} bumpScale={1.5} roughness={0.9} />
      </mesh>
      {/* glowing lip so the drop is obvious */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[def.radius - 0.05, def.radius + 0.15, 96]} />
        <meshBasicMaterial color={new THREE.Color(1.8, 0.45, 0.07)} toneMapped={false} />
      </mesh>
      <BasaltColumns radius={def.radius} emissive={crackTex.em} />
      <mesh position={[0, -6, 0]}>
        <cylinderGeometry args={[def.radius + 0.1, def.radius * 0.5, 12, 32, 1, true]} />
        <meshStandardMaterial color="#1a1412" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* vents: craters with a cracked rock rim */}
      {def.vents!.map((v, i) => (
        <group key={i} position={[v.x, 0.02, v.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[v.r * 0.55, 24]} />
            <primitive object={ventMats[i]} attach="material" />
          </mesh>
          <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
            <torusGeometry args={[v.r * 0.68, 0.16, 6, 18]} />
            <meshStandardMaterial color="#231a17" roughness={1} flatShading emissiveMap={crackTex.em} emissive="#ffffff" emissiveIntensity={0.8} />
          </mesh>
        </group>
      ))}
      {/* lava sea */}
      <mesh position={[0, -7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[900, 900, 1, 1]} />
        <primitive object={lava} attach="material" />
      </mesh>
      <pointLight position={[0, -4, 0]} color="#ff5a1a" intensity={80} distance={34} />
      <Volcano emissive={crackTex.em} />
    </group>
  );
}

// ------------------------------------------------------------------
// Volcano (熔岩断崖 backdrop): glows and erupts with mapRuntime.eruption
// ------------------------------------------------------------------
function Volcano({ emissive }: { emissive: THREE.Texture }) {
  const [cx, cy, cz] = VOLCANO_CRATER;
  const base = -7;
  const h = cy - base;
  const glowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.5, 0.08), toneMapped: false }), []);
  const lightRef = useRef<THREE.PointLight>(null);
  const smokeRef = useRef<THREE.Group>(null);
  void emissive;
  // concave cone with a crater lip, roughened, with glowing lava rivers running down its flanks
  const { geo, rivers } = useMemo(() => {
    const rand = seeded(55);
    const pts: THREE.Vector2[] = [];
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const r = 9 + 52 * Math.pow(1 - t, 1.8);
      pts.push(new THREE.Vector2(r, t * h));
    }
    pts.push(new THREE.Vector2(7.5, h + 1.2)); // crater lip
    pts.push(new THREE.Vector2(6.5, h - 2));
    const g = new THREE.LatheGeometry(pts, 48);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = pos.getY(i);
      const a = Math.atan2(z, x);
      const n = 1 + Math.sin(a * 7 + y * 0.15) * 0.05 + Math.sin(a * 17 - y * 0.3) * 0.03 + (rand() - 0.5) * 0.04;
      pos.setX(i, x * n);
      pos.setZ(i, z * n);
    }
    g.computeVertexNormals();
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const x = c.getContext('2d')!;
    x.fillStyle = '#000';
    x.fillRect(0, 0, 1024, 512);
    x.shadowColor = '#ff4a00';
    x.shadowBlur = 16;
    for (let k = 0; k < 16; k++) {
      let px = rand() * 1024;
      // UV v=1 at the top of the lathe: rivers start at the crater and run down
      let py = 0;
      x.strokeStyle = k % 2 ? '#ff6a10' : '#ffa030';
      x.beginPath();
      x.moveTo(px, py);
      while (py < 512) {
        px += (rand() - 0.5) * 22;
        py += 10 + rand() * 12;
        x.lineWidth = Math.max(2.5, 14 - py / 50);
        x.lineTo(px, py);
      }
      x.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.flipY = false;
    return { geo: g, rivers: tex };
  }, [h]);
  useFrame((st, dt) => {
    const e = mapRuntime.eruption;
    const flicker = 0.85 + 0.15 * Math.sin(st.clock.elapsedTime * 7);
    glowMat.color.setRGB((2 + e * 6) * flicker, (0.5 + e * 2) * flicker, 0.08 + e * 0.4);
    if (lightRef.current) lightRef.current.intensity = (300 + e * 4000) * flicker;
    if (smokeRef.current) {
      smokeRef.current.rotation.y += dt * 0.05;
      smokeRef.current.scale.setScalar(1 + e * 0.6);
    }
  });
  return (
    <group position={[cx, 0, cz]}>
      <mesh position={[0, base, 0]} geometry={geo}>
        <meshStandardMaterial color="#1c1513" roughness={1} emissiveMap={rivers} emissive="#ffffff" emissiveIntensity={2.2} flatShading />
      </mesh>
      <mesh position={[0, cy - 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[7.2, 32]} />
        <primitive object={glowMat} attach="material" />
      </mesh>
      <pointLight ref={lightRef} position={[0, cy + 6, 0]} color="#ff6a1a" intensity={300} distance={260} decay={1.4} />
      <group ref={smokeRef} position={[0, cy + 6, 0]}>
        {/* ash plume: stacked dark billows, widening as they rise */}
        {Array.from({ length: 9 }, (_, k) => (
          <sprite key={k} position={[Math.sin(k * 1.7) * (2 + k), 4 + k * 7, Math.cos(k * 2.3) * (2 + k)]} scale={[22 + k * 7, 18 + k * 6, 1]}>
            <spriteMaterial map={cloudPuffTexture()} color={k < 2 ? '#5a2a1a' : '#2a1d1a'} transparent depthWrite={false} opacity={0.9 - k * 0.06} fog={false} />
          </sprite>
        ))}
      </group>
    </group>
  );
}

// ------------------------------------------------------------------
// 怒海战船: storm ocean, rocking warship, rain, lightning, big waves
// ------------------------------------------------------------------
function plankTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    const l = 22 + Math.random() * 10;
    g.fillStyle = `hsl(28, 35%, ${l}%)`;
    g.fillRect(i * 32, 0, 32, 1024);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(i * 32, 0, 2, 1024);
    for (let k = 0; k < 4; k++) {
      const y = Math.random() * 1024;
      g.fillRect(i * 32, y, 32, 2);
    }
    for (let k = 0; k < 30; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,220,180'},0.05)`;
      g.fillRect(i * 32 + Math.random() * 30, Math.random() * 1024, 1, 40 + Math.random() * 80);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function Rain({ hideUnder }: { hideUnder?: (x: number, y: number, z: number) => boolean }) {
  const lines = useRef<THREE.LineSegments>(null);
  const { geo, mat } = useMemo(() => {
    const n = 2600;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 60;
      const y = Math.random() * 30;
      const z = (Math.random() - 0.5) * 60;
      pos.set([x, y, z, x + 0.15, y + 0.9, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uLightning: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * 26.0, 30.0) - 4.0;
          p.x -= (30.0 - p.y) * 0.08;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform float uLightning; void main(){ gl_FragColor = vec4(vec3(0.55, 0.62, 0.72) + uLightning, 0.08 + uLightning * 0.3); }`,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    mat.uniforms.uLightning.value = mapRuntime.lightning;
    // no rain indoors: hidden while the camera is under a deck
    if (lines.current && hideUnder) lines.current.visible = !hideUnder(st.camera.position.x, st.camera.position.y, st.camera.position.z);
  });
  return <lineSegments ref={lines} geometry={geo} material={mat} frustumCulled={false} />;
}

const SEA_Y = -3.9; // the sea surface sits well below the deck: a tall-sided war junk
const MAST_TOP = 31;
const SAILS = [
  { w: 17, h: 15, y: 19.5 },
  { w: 19, h: 17, y: 20.5 },
];

/** 船舵: a big spoked wheel on a post on the main deck, a gold ring on the planks round it and a lantern-gold
 *  marker bobbing over it while nobody has the wheel, so it is easy to find; it turns as the ship is steered */
function Helm({ k }: { k: number }) {
  const wheel = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Group>(null);
  const ringMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((st, dt) => {
    const t = st.clock.elapsedTime;
    if (wheel.current) wheel.current.rotation.z += mapRuntime.helm[k] * dt * 2.6 * (k === 0 ? 1 : -1);
    const free = (mapRuntime.helmUser?.[k] ?? -1) < 0;
    if (marker.current) {
      marker.current.visible = free;
      marker.current.position.y = 2.75 + Math.sin(t * 2.4) * 0.12;
      marker.current.rotation.y = t * 1.6;
    }
    if (ringMat.current) ringMat.current.opacity = free ? 0.45 + Math.sin(t * 3) * 0.2 : 0.85;
  });
  return (
    <group position={[SHIP_HELM.x, 0, SHIP_HELM.z]}>
      {/* a low dais the wheel stands on */}
      <mesh position={[0, 0.025, 0.35]} receiveShadow>
        <cylinderGeometry args={[1.25, 1.32, 0.05, 24]} />
        <meshStandardMaterial color="#5a3a22" roughness={0.8} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.056, 0.35]}>
        <ringGeometry args={[1.05, 1.25, 40]} />
        <meshBasicMaterial ref={ringMat} color="#ffd36a" transparent opacity={0.6} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.7, 0]} castShadow>
        <boxGeometry args={[0.34, 1.3, 0.34]} />
        <meshStandardMaterial color="#4a2e1a" roughness={0.85} />
      </mesh>
      <group ref={wheel} position={[0, 1.45, 0.24]}>
        <mesh castShadow>
          <torusGeometry args={[0.78, 0.065, 8, 28]} />
          <meshStandardMaterial color="#7a4e28" roughness={0.65} />
        </mesh>
        <mesh>
          <torusGeometry args={[0.32, 0.05, 6, 18]} />
          <meshStandardMaterial color="#7a4e28" roughness={0.65} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} rotation={[0, 0, (i * Math.PI) / 4]}>
            <boxGeometry args={[2.0, 0.07, 0.07]} />
            <meshStandardMaterial color="#5a3a1e" roughness={0.75} />
          </mesh>
        ))}
        {/* handles sticking out past the rim */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <mesh key={'h' + i} position={[Math.cos((i * Math.PI) / 4) * 0.98, Math.sin((i * Math.PI) / 4) * 0.98, 0]} rotation={[0, 0, (i * Math.PI) / 4 - Math.PI / 2]}>
            <cylinderGeometry args={[0.045, 0.06, 0.26, 6]} />
            <meshStandardMaterial color="#8a5a2e" roughness={0.6} />
          </mesh>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.13, 0.13, 0.16, 12]} />
          <meshStandardMaterial color="#c9a04a" metalness={0.6} roughness={0.35} />
        </mesh>
      </group>
      <group ref={marker} position={[0, 2.75, 0]}>
        <mesh>
          <octahedronGeometry args={[0.26, 0]} />
          <meshBasicMaterial color="#ffd36a" toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

/** 跳板: boarding planks hinged on ship 0's rail, standing up while apart, swung down across the gap alongside; grapnel lines between the rails */
function BoardingPlanks() {
  const pivots = useRef<(THREE.Group | null)[]>([]);
  const boards = useRef<(THREE.Mesh | null)[]>([]);
  const lines = useRef<THREE.LineSegments>(null);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6 * 6), 3));
    return g;
  }, []);
  useFrame(() => {
    const X = mapRuntime.shipX;
    const B = mapRuntime.board;
    const W = SHIP_LAYOUT.W;
    const x0 = X[0] + W - 1.0;
    const len = X[1] - W + 1.0 - x0;
    SHIP_PLANKS.z.forEach((pz, i) => {
      const p = pivots.current[i];
      const b = boards.current[i];
      if (!p || !b) return;
      p.position.set(x0, 0.08, pz);
      // stowed: standing up against the rail (3 m tall); down: spanning the gap
      const L = B.plank > 0.01 ? len : 3;
      b.scale.set(L, 1, 1);
      b.position.set(L / 2, 0.06, 0);
      p.rotation.z = (1 - B.plank) * (Math.PI / 2);
    });
    const ln = lines.current;
    if (ln) {
      ln.visible = B.mode === 2 || (B.mode === 1 && X[1] - X[0] < 34);
      const a = lineGeo.attributes.position as THREE.BufferAttribute;
      [-20, -7, 6].forEach((z, k) => {
        a.setXYZ(k * 2, X[0] + W - 0.2, 1.0, z);
        a.setXYZ(k * 2 + 1, X[1] - W + 0.2, 1.0 + (X[1] - X[0] - 26) * 0.02, z + 0.4);
      });
      a.needsUpdate = true;
      lineGeo.setDrawRange(0, 6);
    }
  });
  return (
    <group>
      {SHIP_PLANKS.z.map((_, i) => (
        <group key={i} ref={(el) => (pivots.current[i] = el)}>
          <mesh ref={(el) => (boards.current[i] = el)} castShadow receiveShadow>
            <boxGeometry args={[1, 0.12, SHIP_PLANKS.half * 2]} />
            <meshStandardMaterial color="#6b4a2c" roughness={0.85} />
          </mesh>
        </group>
      ))}
      <lineSegments ref={lines} geometry={lineGeo} frustumCulled={false}>
        <lineBasicMaterial color="#2a1c10" />
      </lineSegments>
    </group>
  );
}

function SeaMap() {
  const def = MAPS.sea;
  const { hx, hz } = def.rect!;
  // the sea in its own frame: the hull's waterline footprint keeps the chop down right beside it
  // the sea's mesh: fine enough to draw the waves smoothly, no finer than this machine can afford
  const { quality } = useSettings();
  const ocean = useMemo(
    () => makeOcean({ halfW: 12.6, z0: -50, z1: 41 }, { halfW: 11.8, z0: SHIP_LAYOUT.hold.z0 - 0.2, z1: SHIP_LAYOUT.hold.z1 + 0.2 }, quality === 'high' ? 260 : quality === 'medium' ? 180 : 120),
    [quality],
  );
  const worldRef = useRef<THREE.Group>(null);
  const deckMat = useRef<THREE.MeshStandardMaterial>(null);
  const crash = useRef({ t: -1, side: 1, last: 0, wet: 0 });
  const planks = useMemo(() => {
    const t = deckTexture();
    t.repeat.set(2.4, 3.2);
    return t;
  }, []);
  const crateMap = useMemo(() => crateTexture(), []);
  const shipGroups = useRef<(THREE.Group | null)[]>([null, null]);
  const deckMat2 = useRef<THREE.MeshStandardMaterial>(null);
  const boltRef = useRef<THREE.DirectionalLight>(null);
  useFrame((st, dtf) => {
    const t = st.clock.elapsedTime;
    const u = ocean.material.uniforms;
    u.uTime.value = t;
    u.uLightning.value = mapRuntime.lightning;
    u.uShipX.value.set(mapRuntime.shipX[0], mapRuntime.shipX[1]);
    for (let k = 0; k < 2; k++) if (shipGroups.current[k]) shipGroups.current[k]!.position.x = mapRuntime.shipX[k];
    if (st.scene.background instanceof THREE.Color) u.uFog.value.copy(st.scene.background);
    // The deck is the fighters' frame of reference, so the world rolls around the ship instead:
    // sample the long swell under the hull: centre for heave, the beams for roll, bow and stern for pitch
    const h0 = (seaSwell(0, 0, t) + seaSwell(0, -15, t) + seaSwell(0, 15, t)) / 3;
    const roll = Math.atan2(seaSwell(12.9, 0, t) - seaSwell(-12.9, 0, t), 25.8);
    const pitch = Math.atan2(seaSwell(0, -45, t) - seaSwell(0, 38, t), 83);
    const c = crash.current;
    if (mapRuntime.waveRise > 1.05 && c.last <= 1.05) {
      c.t = 0;
      c.side = mapRuntime.waveSide || 1;
      c.wet = 1.6;
    }
    c.last = mapRuntime.waveRise;
    if (c.t >= 0) {
      c.t += Math.min(0.05, dtf);
      if (c.t > 7.2) c.t = -1;
    }
    rogueState(u.uRogue.value, c.t, 12.9);
    // the rearing wave heels her over toward it, and the blow throws her back the other way
    // (then she wallows back and forth for a few seconds with the water sloshing on deck)
    const heel = mapRuntime.waveSide * (Math.min(1, mapRuntime.waveRise) * 0.1 - (c.t >= 0 && c.t < 6 ? Math.sin(c.t * 2.2) * 0.16 * Math.exp(-c.t * 0.45) : 0));
    mapRuntime.shipRoll = roll * 0.8 + heel;
    mapRuntime.shipPitch = pitch * 0.8;
    if (worldRef.current) {
      worldRef.current.rotation.set(-mapRuntime.shipPitch, 0, -mapRuntime.shipRoll);
      worldRef.current.position.y = -h0 * 0.85;
    }
    c.wet = Math.max(0, c.wet - dtf / 5);
    for (const dm of [deckMat.current, deckMat2.current]) {
      if (!dm) continue;
      // storm-soaked planks: darker and glossier for a while after a wave washes over
      const wv = Math.min(1, c.wet);
      dm.roughness = 0.8 - wv * 0.38;
      dm.color.setRGB(0.3 - wv * 0.09, 0.25 - wv * 0.08, 0.2 - wv * 0.06);
    }
    if (boltRef.current) boltRef.current.intensity = mapRuntime.lightning * 7;
  });
  // rigging: shrouds from each masthead down to the cap rail, sheets fanning from the batten ends, fore and aft stays
  const rigging = useMemo(() => {
    const pts: number[] = [];
    const masts = SEA_PILLARS_LOCAL.slice(0, 2);
    masts.forEach((p, i) => {
      for (const sx of [-1, 1])
        for (const dz of [-2.4, -0.8, 0.8, 2.4]) {
          const z = p.z + dz;
          pts.push(p.x, MAST_TOP, p.z, sx * (hullW(z) - 0.05), sheer(z) + 0.1, z);
        }
      // junk sheets: a line from every batten's outer end converging on one block on the rail
      const W = SAILS[i].w;
      const H = SAILS[i].h;
      const y0 = SAILS[i].y;
      const zb = p.z + 3.2;
      for (let k = 0; k <= 6; k++) {
        const v = k / 6;
        const w = W * (0.82 + 0.18 * v);
        const bx = w / 2 + 0.15 + (1 - v) * W * 0.08;
        pts.push(bx, y0 - H / 2 + v * H, p.z + 0.47, hullW(zb) - 0.1, sheer(zb) + 1.2, zb);
      }
    });
    pts.push(0, MAST_TOP, masts[0].z, 0, sheer(-52) + 0.4, -52);
    pts.push(0, MAST_TOP, masts[1].z, 0, sheer(SHIP_LAYOUT.tiers[3].edge + 0.5) + 0.2, SHIP_LAYOUT.tiers[3].edge + 0.5);
    pts.push(0, MAST_TOP, masts[0].z, 0, MAST_TOP, masts[1].z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [def.pillars, hx, hz]);
  return (
    <group>
      <group ref={worldRef}>
      <StormSky fog={def.background} />
      <DistantJunk position={[-70, -1.2, -120]} rot={0.5} scale={0.9} />
      <DistantJunk position={[95, -1.2, -150]} rot={-0.4} scale={1.1} burning />
      <DistantJunk position={[120, -1.2, 60]} rot={2.4} scale={0.9} />
      <DistantJunk position={[-110, -1.2, 95]} rot={-2.0} scale={1.0} burning />

      <directionalLight ref={boltRef} position={[10, 40, -10]} color="#e6eeff" intensity={0} />
      <mesh geometry={ocean.geometry} material={ocean.material} position={[0, SEA_Y, 0]} frustumCulled={false} />
      <group position={[0, SEA_Y, 0]}>
        <CrestSpray rogue={ocean.material.uniforms.uRogue.value} />
      </group>
      </group>
      {/* the rogue wave breaking over the side: spray over the rail and foaming water across the main deck */}
      {[0, 1].map((sk) => (
      <group key={sk} ref={(el) => (shipGroups.current[sk] = el)} position={[mapRuntime.shipX[sk], 0, 0]}>
        <ShipHull />
        <WaveCrash beam={12.5} deckZ={[SHIP_LAYOUT.fore.edge, SHIP_LAYOUT.tiers[0].edge]} />
        <Helm k={sk} />
        <ShipStructure deckMap={planks} boxes={SHIP_BOXES} deckMatRef={sk === 0 ? deckMat : deckMat2} />
        {SHIP_LAYOUT.ballistae.map((b, k) => (
          <Ballista key={k} k={k + sk * SHIP_LAYOUT.ballistae.length} at={b} rt={mapRuntime} />
        ))}
        <SternCastle base={SHIP_LAYOUT.tiers[3].y} />
        <pointLight position={[0, 3.2, -6]} color="#ffb060" intensity={10} distance={22} decay={1.4} />
        <RailLanterns />
        <HatchGrate position={[5, 0, -17]} w={2.0} d={2.0} />
        <HatchGrate position={[-4, SHIP_LAYOUT.fore.y, -35]} w={1.6} d={1.6} />
        <RopeCoil position={[1.5, 0, -10.4]} />
        <RopeCoil position={[-3.5, 0, 6.4]} r={0.36} />
        <RopeCoil position={[-3, SHIP_LAYOUT.tiers[1].y, 25.0]} r={0.5} />
        <RopeCoil position={[3.0, SHIP_LAYOUT.tiers[0].y, 18.4]} r={0.4} />
        {/* masts with battened junk sails high above the deck, a lantern hung on each, and pennants */}
        {SEA_PILLARS_LOCAL.slice(0, 2).map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]}>
            <Mast r={p.r} h={MAST_TOP + 0.4} />
            {/* down through the hold to the keelson */}
            <mesh position={[0, SHIP_LAYOUT.holdY / 2, 0]} castShadow>
              <cylinderGeometry args={[p.r, p.r * 1.05, -SHIP_LAYOUT.holdY, 12]} />
              <meshStandardMaterial color="#3a2416" roughness={0.8} />
            </mesh>
            <JunkSail width={SAILS[i].w} height={SAILS[i].h} y={SAILS[i].y} seed={3 + i * 7} />
            <Banner position={[0, MAST_TOP - 0.4, 0]} color="#7a1a14" trim="#c9a24a" height={2.2} width={0.6} pole={1.6} />
            <ShipLantern position={[0, 3.6, -p.r - 0.18]} seed={i * 3} glow={1.3} />
          </group>
        ))}
        <lineSegments geometry={rigging}>
          <lineBasicMaterial color="#1a120c" />
        </lineSegments>
        {/* cargo crates lashed with rope */}
        {SEA_PILLARS_LOCAL.slice(2).filter((p) => p.h !== 0.85 && !SHIP_LAYOUT.ballistae.some((b) => b.x === p.x && b.z === p.z)).map((p, i) => (
          <group key={i} position={[p.x, shipFloorAtL(p.x, p.z, (p.h ?? 1.1) - 1.0), p.z]} rotation={[0, i * 0.7, 0]}>
            {Array.from({ length: Math.max(1, Math.round(((p.h ?? 1.1) - shipFloorAtL(p.x, p.z, (p.h ?? 1.1) - 1.0)) / 1.1)) }, (_, k) => (
              <group key={k} position={[0, k * 1.1, 0]} rotation={[0, k * 0.35, 0]}>
                <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
                  <boxGeometry args={[p.r * 1.7 - k * 0.08, 1.1, p.r * 1.7 - k * 0.08]} />
                  <meshStandardMaterial map={crateMap} color="#d8c0a0" roughness={0.85} />
                </mesh>
                {[-0.3, 0.3].map((o) => (
                  <mesh key={o} position={[o * p.r * 1.7, 0.55, 0]}>
                    <boxGeometry args={[0.05, 1.13, p.r * 1.72 - k * 0.08]} />
                    <meshStandardMaterial color="#8a7350" roughness={1} />
                  </mesh>
                ))}
              </group>
            ))}
          </group>
        ))}
      </group>
      ))}
      <Bolts rt={mapRuntime} />
      <BoardingPlanks />
      <Rain hideUnder={(x, y, z) => shipCeilAt(x, z, y - 1.2) < 99} />
    </group>
  );
}

export function Maps3D({ mapId }: { mapId: MapId }) {
  if (mapId === 'lavacliff') return <LavaCliffMap />;
  if (mapId === 'sea') return <SeaMap />;
  if (mapId === 'glacier') return <GlacierMap />;
  if (mapId === 'rooftop') return <ChanganMap />;
  if (mapId === 'summit') return <SummitMap />;
  if (mapId === 'forest') return <ForestMap />;
  if (mapId === 'desert') return <DesertMap />;
  return <TempleMap />;
}

export function useMapRef() {
  return useRef(mapRuntime);
}
