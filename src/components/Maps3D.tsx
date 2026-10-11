import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Sky, KarstPeaks, CloudSea, CloudPuffs, Banner, seeded, cloudPuffTexture } from './Scenery';
import { MAPS, MapId, mapRuntime, VOLCANO_CRATER, GLACIER, glacierHeight, glacierGradient, glacierPath } from '../maps';

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
    const n = 48;
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

function TempleMap() {
  const def = MAPS.temple;
  const R = def.radius;
  const floor = useMemo(() => templeFloorTextures(), []);
  const cliff = useMemo(() => cliffTexture(), []);
  const lacquer = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6e1a13', roughness: 0.55, metalness: 0.05 }), []);
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
      {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
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
                <pointLight position={[0, 6.2, 0]} color="#ffa04a" intensity={8} distance={10} />
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
/**
 * Long ocean swells. The ship rides these: the same numbers drive the shader and the CPU-side
 * heave / roll / pitch, so the hull always sits in the water instead of the water passing through it.
 * [dirX, dirZ, wavelength m, speed rad/s, amplitude m]
 */
const SWELLS: [number, number, number, number, number][] = [
  [1.0, 0.25, 95, 0.55, 1.9],
  [0.45, 1.0, 70, 0.7, 1.1],
];
function swellHeight(x: number, z: number, t: number) {
  let h = 0;
  for (const [dx, dz, L, sp, a] of SWELLS) {
    const n = Math.hypot(dx, dz);
    h += Math.sin(((x * dx + z * dz) / n) * ((Math.PI * 2) / L) + t * sp) * a;
  }
  return h;
}
const SWELL_GLSL = `
  float bigSwell(vec2 p){
    float h = 0.0;
    ${SWELLS.map(([dx, dz, L, sp, a]) => `h += sin(dot(p, normalize(vec2(${dx.toFixed(3)}, ${dz.toFixed(3)}))) * ${((Math.PI * 2) / L).toFixed(5)} + uTime * ${sp.toFixed(3)}) * ${a.toFixed(3)};`).join('\n    ')}
    return h;
  }`;

function makeOceanMaterial(hx: number, hz: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWaveSide: { value: 0 },
      uWaveRise: { value: 0 },
      uFog: { value: new THREE.Color('#1b2530') },
      uLightning: { value: 0 },
      uShip: { value: new THREE.Vector2(hx + 0.8, hz + 4.5) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWaveSide; uniform float uWaveRise; uniform vec2 uShip;
      varying float vH; varying vec3 vWorld; varying float vCalm; varying vec3 vN; varying float vChop;
      // sum of directional swells, sharpened at the crests
      float swell(vec2 p, vec2 d, float k, float sp, float a){
        float ph = dot(p, normalize(d)) * k + uTime * sp;
        return a * (1.0 - abs(sin(ph))) * 2.0 - a;
      }
      ${SWELL_GLSL}
      float waves(vec2 p){
        // wind waves and chop on top of the long swell, sharpened at the crests
        float c = 0.0;
        c += swell(p, vec2(1.0, 0.35), 0.21, 1.3, 0.55);
        c += swell(p, vec2(-0.4, 1.0), 0.29, 1.6, 0.38);
        c += swell(p, vec2(0.8, -0.6), 0.47, 2.1, 0.22);
        c += sin(dot(p, vec2(0.85, 0.61)) + uTime * 2.9) * 0.1;
        c += sin(dot(p, vec2(-1.12, 0.93)) - uTime * 3.3) * 0.07;
        // the chop calms right beside the hull so it never laps over the deck; the swell does not
        vec2 q = abs(p) - uShip;
        float dShip = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        vCalm = 1.0 - smoothstep(0.0, 6.0, dShip);
        vChop = c * mix(1.0, 0.2, vCalm);
        float h = bigSwell(p) + vChop;
        // rogue wave: a wall of water rearing up beside the ship (the crash itself is a separate sheet)
        float side = step(0.5, abs(uWaveSide));
        float x0 = uWaveSide * (uShip.x + 4.5);
        float ridge = exp(-pow(p.x - x0, 2.0) / 10.0) * exp(-pow(p.y / 26.0, 2.0));
        h += ridge * min(uWaveRise, 1.0) * 5.0 * side;
        return h;
      }
      void main(){
        // waves are computed in the sea's own frame (the sea group heaves and rolls around the ship)
        vec2 p = vec2(position.x, -position.y);
        float h = waves(p);
        // smooth normal from finite differences (in the sea frame), then into world space
        float e = 0.5;
        float hx = waves(p + vec2(e, 0.0)) - h;
        float hz = waves(p + vec2(0.0, e)) - h;
        vec3 nLocal = normalize(vec3(-hx / e, 1.0, -hz / e));
        vN = normalize(mat3(modelMatrix) * vec3(nLocal.x, nLocal.z * -1.0, nLocal.y));
        vec3 pos = position + vec3(0.0, 0.0, h);
        vec4 w = modelMatrix * vec4(pos, 1.0);
        vH = h; vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFog; uniform float uLightning; uniform float uTime;
      varying float vH; varying vec3 vWorld; varying float vCalm; varying vec3 vN; varying float vChop;
      ${NOISE}
      void main(){
        // normal from screen-space derivatives of the displaced surface, plus fine ripples
        vec3 n = normalize(vN);
        vec2 rp = vWorld.xz * 0.9 + vec2(uTime * 0.6, uTime * 0.4);
        float r1 = fbm(rp), r2 = fbm(rp + vec2(3.1, 1.7));
        n = normalize(n + vec3(r1 - 0.5, 0.0, r2 - 0.5) * 0.35);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
        vec3 deep = vec3(0.006, 0.022, 0.035);
        vec3 body = mix(deep, vec3(0.02, 0.085, 0.1), smoothstep(-2.5, 2.8, vH));
        // reflected storm sky, brighter toward the horizon
        vec3 R = reflect(-V, n);
        vec3 sky = mix(vec3(0.09, 0.12, 0.16), vec3(0.025, 0.035, 0.05), clamp(R.y * 1.6, 0.0, 1.0));
        sky += uLightning * vec3(0.7, 0.75, 0.9) * (0.5 + 0.5 * R.y);
        vec3 col = mix(body, sky, clamp(fres, 0.0, 1.0));
        // glints from the lightning
        vec3 L = normalize(vec3(0.3, 0.8, -0.5));
        col += pow(max(dot(R, L), 0.0), 80.0) * (0.15 + uLightning * 2.5);
        // whitecaps on the crests, churn around the hull, foam on the rogue wave
        // whitecaps where the chop peaks, more of them on top of a swell crest
        float cap = smoothstep(0.75, 1.15, vChop + max(vH - vChop, 0.0) * 0.12 + (fbm(vWorld.xz * 0.4 + uTime * 0.2) - 0.5) * 0.6);
        float churn = smoothstep(0.75, 1.0, vCalm) * smoothstep(0.5, 0.8, fbm(vWorld.xz * 1.3 + vec2(0.0, uTime * 1.2))) * 0.6;
        float rogue = smoothstep(5.6, 6.6, vH); // only the curling lip of the rogue wave breaks white
        // light glows green through the thin, tall water of the rearing wave
        col = mix(col, vec3(0.02, 0.13, 0.15) + uLightning * 0.2, smoothstep(2.6, 5.8, vH) * 0.55);
        float foam = clamp(cap * 0.7 + churn * 0.8 + rogue, 0.0, 1.0);
        col = mix(col, vec3(0.62, 0.68, 0.72) + uLightning * 0.4, foam * 0.75);
        float d = length(cameraPosition - vWorld);
        col = mix(col, uFog, smoothstep(30.0, 240.0, d));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

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

function Rain() {
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
      fragmentShader: /* glsl */ `uniform float uLightning; void main(){ gl_FragColor = vec4(vec3(0.55, 0.62, 0.72) + uLightning, 0.16 + uLightning * 0.4); }`,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    mat.uniforms.uLightning.value = mapRuntime.lightning;
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} />;
}

/** Battened junk sail: trapezoid cloth with a gentle belly and dark bamboo ribs */
function JunkSail({ width, height, y, color = '#6b2c1c' }: { width: number; height: number; y: number; color?: string }) {
  const { cloth, ribs } = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1, 10, 12);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5;
      const v = pos.getY(i) + 0.5;
      const w = width * (0.82 + 0.18 * v); // wider at the top yard
      pos.setX(i, (u - 0.5) * w + (1 - v) * width * 0.08);
      pos.setY(i, (v - 0.5) * height);
      // belly between ribs + overall curve
      pos.setZ(i, Math.sin(u * Math.PI) * 0.55 + Math.abs(Math.sin(v * Math.PI * 6)) * 0.08);
    }
    g.computeVertexNormals();
    const rib: number[] = [];
    for (let k = 0; k <= 6; k++) rib.push(-height / 2 + (k / 6) * height);
    return { cloth: g, ribs: rib };
  }, [width, height]);
  return (
    <group position={[0, y, 0.35]}>
      <mesh geometry={cloth} castShadow>
        <meshStandardMaterial color={color} roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {ribs.map((ry, k) => {
        const v = (ry + height / 2) / height;
        const w = width * (0.82 + 0.18 * v);
        return (
          <mesh key={k} position={[(1 - v) * width * 0.08, ry, 0.12]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, w + 0.2, 6]} />
            <meshStandardMaterial color="#2b1d12" roughness={0.8} />
          </mesh>
        );
      })}
    </group>
  );
}

/** A far-off warship silhouette with lit stern lanterns */
function DistantShip({ position, rot, scale = 1 }: { position: [number, number, number]; rot: number; scale?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (ref.current) {
      const t = st.clock.elapsedTime + position[0];
      ref.current.position.y = position[1] + Math.sin(t * 0.8) * 0.4;
      ref.current.rotation.z = Math.sin(t * 0.6) * 0.04;
    }
  });
  const dark = '#0b1016';
  return (
    <group ref={ref} position={position} rotation={[0, rot, 0]} scale={scale}>
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[4, 2.2, 16]} />
        <meshBasicMaterial color={dark} />
      </mesh>
      <mesh position={[0, 2.4, 6]}>
        <boxGeometry args={[4, 2.2, 3.5]} />
        <meshBasicMaterial color={dark} />
      </mesh>
      {[-3, 3].map((z) => (
        <group key={z} position={[0, 0, z]}>
          <mesh position={[0, 7, 0]}>
            <cylinderGeometry args={[0.15, 0.2, 12, 6]} />
            <meshBasicMaterial color={dark} />
          </mesh>
          <mesh position={[0, 8, 0.2]}>
            <planeGeometry args={[5, 6]} />
            <meshBasicMaterial color="#121a22" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      {[-1.2, 1.2].map((x) => (
        <mesh key={x} position={[x, 2.6, 7.8]}>
          <sphereGeometry args={[0.35, 8, 6]} />
          <meshBasicMaterial color={new THREE.Color(3, 1.6, 0.5)} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Hanging red paper lantern that sways with the ship */
function Lantern({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (ref.current) ref.current.rotation.z = Math.sin(st.clock.elapsedTime * 1.4 + position[2]) * 0.18;
  });
  return (
    <group ref={ref} position={position}>
      <mesh position={[0, -0.25, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 0.5, 4]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh position={[0, -0.72, 0]} scale={[1, 1.25, 1]}>
        <sphereGeometry args={[0.24, 14, 10]} />
        <meshBasicMaterial color={new THREE.Color(1.5, 0.22, 0.07)} toneMapped={false} />
      </mesh>
      {[-0.98, -0.44].map((y) => (
        <mesh key={y} position={[0, y, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 0.06, 10]} />
          <meshStandardMaterial color="#3a2a12" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <pointLight position={[0, -0.72, 0]} color="#ff7a40" intensity={4} distance={7} />
    </group>
  );
}

function SeaMap() {
  const def = MAPS.sea;
  const { hx, hz } = def.rect!;
  const ocean = useMemo(() => makeOceanMaterial(hx, hz), [hx, hz]);
  const worldRef = useRef<THREE.Group>(null);
  const sheetRef = useRef<THREE.Mesh>(null);
  const sheetMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b9d6e6', roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, emissive: new THREE.Color('#1c3442') }), []);
  const deckMat = useRef<THREE.MeshStandardMaterial>(null);
  // stern castle roof: a trapezoid section swept across the ship's beam, eaves overhanging the walls
  const roofGeo = useMemo(() => {
    const sh = new THREE.Shape();
    sh.moveTo(-2.0, 0);
    sh.lineTo(2.0, 0);
    sh.lineTo(1.0, 0.95);
    sh.lineTo(-1.0, 0.95);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: hx * 2 + 1.8, bevelEnabled: false });
    g.rotateY(Math.PI / 2); // profile in the z-y plane, extruded along +x
    return g;
  }, [hx]);
  const bowGeo = useMemo(() => {
    const W = hx + 0.6;
    const L = 7;
    const sh = new THREE.Shape();
    sh.moveTo(-W, 0);
    sh.lineTo(W, 0);
    sh.quadraticCurveTo(W * 0.95, -L * 0.6, 0, -L);
    sh.quadraticCurveTo(-W * 0.95, -L * 0.6, -W, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 2.9, bevelEnabled: false, curveSegments: 16 });
    g.rotateX(Math.PI / 2); // shape -Y (the point) -> -Z, extrusion goes down from the deck
    return g;
  }, [hx]);
  // a curled half-pipe of water lying along the ship's length
  const sheetGeo = useMemo(() => {
    const g = new THREE.CylinderGeometry(2.2, 2.2, hz * 2 + 2, 24, 1, true, 0, Math.PI * 0.9);
    g.rotateX(Math.PI / 2);
    return g;
  }, [hz]);
  const crash = useRef({ t: -1, side: 1, last: 0, wet: 0 });
  const planks = useMemo(() => {
    const t = plankTexture();
    t.repeat.set(1, 2);
    return t;
  }, []);
  const hullTex = useMemo(() => {
    const t = plankTexture();
    t.rotation = Math.PI / 2;
    t.repeat.set(3, 1);
    return t;
  }, []);
  const shipRef = useRef<THREE.Group>(null);
  const boltRef = useRef<THREE.DirectionalLight>(null);
  useFrame((st, dtf) => {
    const t = st.clock.elapsedTime;
    ocean.uniforms.uTime.value = t;
    ocean.uniforms.uWaveSide.value = mapRuntime.waveSide;
    ocean.uniforms.uWaveRise.value = mapRuntime.waveRise;
    ocean.uniforms.uLightning.value = mapRuntime.lightning;
    if (st.scene.background instanceof THREE.Color) ocean.uniforms.uFog.value.copy(st.scene.background);
    // The deck is the fighters' frame of reference, so the world rolls around the ship instead:
    // the horizon, sea and sky tilt, and the ship only bobs.
    // sample the swell under the hull: centre for heave, the beams for roll, bow/stern for pitch
    const h0 = swellHeight(0, 0, t);
    const roll = Math.atan2(swellHeight(hx + 0.6, 0, t) - swellHeight(-hx - 0.6, 0, t), hx * 2 + 1.2);
    const pitch = Math.atan2(swellHeight(0, -hz, t) - swellHeight(0, hz, t), hz * 2);
    const rogue = mapRuntime.waveSide * Math.min(1, mapRuntime.waveRise) * 0.08;
    mapRuntime.shipRoll = roll * 0.9 + rogue;
    mapRuntime.shipPitch = pitch * 0.9;
    if (worldRef.current) {
      // the ship is our frame of reference: tilt and lift the whole world the other way
      worldRef.current.rotation.set(-mapRuntime.shipPitch, 0, -mapRuntime.shipRoll);
      worldRef.current.position.y = -h0 * 0.92;
    }
    // rogue wave crash: a sheet of water sweeps across the deck, then the planks stay wet for a while
    const c = crash.current;
    if (mapRuntime.waveRise > 1.05 && c.last <= 1.05) {
      c.t = 0;
      c.side = mapRuntime.waveSide || 1;
      c.wet = 1;
    }
    c.last = mapRuntime.waveRise;
    const sheet = sheetRef.current;
    if (sheet) {
      if (c.t >= 0 && c.t < 1) {
        c.t += Math.min(0.05, dtf);
        const k = c.t;
        sheet.visible = true;
        sheet.position.set(c.side * (hx + 1.2 - k * (hx * 2 + 2.6)), 2.2 - k * 1.9, 0);
        sheet.rotation.set(0, 0, c.side * (0.9 - k * 0.6));
        sheet.scale.set(1, 1 - k * 0.55, 1);
        sheetMat.opacity = Math.sin(Math.min(1, k * 1.4) * Math.PI) * 0.75;
      } else {
        sheet.visible = false;
        c.t = -1;
      }
    }
    c.wet = Math.max(0, c.wet - dtf / 5);
    if (deckMat.current) {
      deckMat.current.roughness = 0.55 - c.wet * 0.45;
      deckMat.current.color.setRGB(0.6 - c.wet * 0.18, 0.54 - c.wet * 0.16, 0.48 - c.wet * 0.14);
    }
    if (boltRef.current) boltRef.current.intensity = mapRuntime.lightning * 7;
  });
  const wood = '#3e2718';
  const dark = '#22150d';
  const trim = '#9a7330';
  const railPosts: [number, number][] = [];
  for (let z = -hz - 0.6; z <= hz + 0.6; z += 1.3) railPosts.push([-(hx + 0.35), z], [hx + 0.35, z]);
  // rigging: stays from each masthead down to the rails
  const rigging = useMemo(() => {
    const pts: number[] = [];
    for (const p of def.pillars!.slice(0, 2)) {
      for (const sx of [-1, 1]) {
        for (const dz of [-2.2, 0, 2.2]) pts.push(p.x, 13.6, p.z, sx * (hx + 0.35), 1.05, p.z + dz);
      }
    }
    // fore and aft stays
    pts.push(0, 13.6, def.pillars![0].z, 0, 1.2, -(hz + 4.5));
    pts.push(0, 13.6, def.pillars![1].z, 0, 3.0, hz + 3.6);
    pts.push(0, 13.6, def.pillars![0].z, 0, 13.6, def.pillars![1].z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [def.pillars, hx, hz]);
  return (
    <group>
      <group ref={worldRef}>
      <Sky zenith="#05080d" horizon="#22303c" below="#0d151c" sunDir={[0.2, 0.3, -1]} sunColor="#2a3a4a" sunSize={0} streaks={1} streakColor="#3a4a58" />
      <CloudPuffs count={26} inner={30} outer={140} y={[22, 40]} color="#1a222b" seed={19} />
      <KarstPeaks
        seed={91}
        haze="#1c2731"
        rock="#05080b"
        light="#6a7f95"
        lightDir={[0.2, 0.5, 1]}
        rimStrength={0.15}
        baseY={-3}
        pines={false}
        layers={[
          { dist: 110, count: 5, height: [8, 20], radius: [4, 8], haze: 0.25 },
          { dist: 190, count: 8, height: [15, 40], radius: [8, 16], haze: 0.6 },
        ]}
      />
      <DistantShip position={[-42, -1, -70]} rot={0.5} scale={1.2} />
      <DistantShip position={[55, -1, -95]} rot={-0.4} scale={1.5} />
      <DistantShip position={[70, -1, 40]} rot={2.4} />

      <directionalLight ref={boltRef} position={[10, 40, -10]} color="#e6eeff" intensity={0} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.9, 0]}>
        <planeGeometry args={[520, 520, 320, 320]} />
        <primitive object={ocean} attach="material" />
      </mesh>
      </group>
      {/* the crashing wave: a curled sheet of water that sweeps across the deck */}
      <mesh ref={sheetRef} visible={false} material={sheetMat} geometry={sheetGeo} />
      <group ref={shipRef}>
        {/* deck */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[hx * 2 + 1.1, hz * 2 + 1.6]} />
          <meshStandardMaterial ref={deckMat} map={planks} roughness={0.55} metalness={0.05} color="#9a8a7a" />
        </mesh>
        {/* hull with planking and a gilded wale */}
        {/* hull top sits just under the deck so the two never z-fight */}
        <mesh position={[0, -1.5, 0]} castShadow receiveShadow>
          <boxGeometry args={[hx * 2 + 1.2, 2.9, hz * 2 + 1.6]} />
          <meshStandardMaterial map={hullTex} color="#6a5040" roughness={0.85} />
        </mesh>
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[sd * (hx + 0.62), -0.35, 0]}>
            <boxGeometry args={[0.1, 0.22, hz * 2 + 1.6]} />
            <meshStandardMaterial color={trim} metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
        {/* upswept bow */}
        {/* pointed bow: one solid piece whose top is flush with the deck and sits entirely past its end */}
        <mesh position={[0, 0, -(hz + 0.8)]} geometry={bowGeo} castShadow receiveShadow>
          <meshStandardMaterial attach="material-0" map={planks} roughness={0.55} color="#8a7a6a" />
          <meshStandardMaterial attach="material-1" map={hullTex} color="#6a5040" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.25, -(hz + 0.8) - 7.5]} rotation={[-0.5, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.2, 6, 8]} />
          <meshStandardMaterial color={wood} roughness={0.8} />
        </mesh>
        {/* stern castle with lit windows and a pagoda roof */}
        <mesh position={[0, 1.3, hz + 2.2]} castShadow receiveShadow>
          <boxGeometry args={[hx * 2 + 1.2, 2.6, 3.2]} />
          <meshStandardMaterial map={hullTex} color="#5a4232" roughness={0.85} />
        </mesh>
        <mesh position={[-(hx + 0.9), 2.6, hz + 2.2]} geometry={roofGeo} castShadow>
          <meshStandardMaterial color="#141c1e" roughness={0.6} />
        </mesh>
        {[-2.2, 0, 2.2].map((x) => (
          <mesh key={x} position={[x, 1.6, hz + 0.57]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[0.8, 0.6]} />
            <meshBasicMaterial color={new THREE.Color(2.0, 1.0, 0.35)} toneMapped={false} />
          </mesh>
        ))}
        <pointLight position={[0, 2, hz + 0.2]} color="#ffb060" intensity={10} distance={10} />
        {/* railings with gilded caps */}
        {railPosts.map(([x, z], i) => (
          <mesh key={i} position={[x, 0.5, z]} castShadow>
            <boxGeometry args={[0.16, 1.0, 0.16]} />
            <meshStandardMaterial color={wood} roughness={0.8} />
          </mesh>
        ))}
        {[-1, 1].map((sd) => (
          <mesh key={sd} position={[sd * (hx + 0.35), 1.02, 0]} castShadow>
            <boxGeometry args={[0.22, 0.12, hz * 2 + 1.6]} />
            <meshStandardMaterial color="#5a3a26" roughness={0.7} />
          </mesh>
        ))}
        <mesh position={[0, 1.02, -(hz + 0.75)]}>
          <boxGeometry args={[hx * 2 + 0.9, 0.12, 0.22]} />
          <meshStandardMaterial color="#5a3a26" roughness={0.7} />
        </mesh>
        {/* lanterns hung along the rails, out of the camera's way */}
        {[-hz + 1.5, -1, hz - 2].flatMap((z) => [-1, 1].map((sd) => <Lantern key={`${z}${sd}`} position={[sd * (hx + 0.35), 1.1, z]} />))}
        {/* masts with battened junk sails high above the deck, and pennants */}
        {def.pillars!.slice(0, 2).map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]}>
            <mesh position={[0, 7, 0]} castShadow>
              <cylinderGeometry args={[p.r * 0.55, p.r, 14, 14]} />
              <meshStandardMaterial color={wood} roughness={0.8} />
            </mesh>
            <JunkSail width={i ? 6.4 : 7.4} height={i ? 6.4 : 7.6} y={i ? 9.4 : 9.0} />
            <Banner position={[0, 13.2, 0]} color="#7a1a14" trim="#c9a24a" height={2.2} width={0.6} pole={1.6} />
          </group>
        ))}
        <lineSegments geometry={rigging}>
          <lineBasicMaterial color="#1a120c" />
        </lineSegments>
        {/* cargo crates lashed with rope */}
        {def.pillars!.slice(2).map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]} rotation={[0, i * 0.7, 0]}>
            <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
              <boxGeometry args={[p.r * 1.7, 1.1, p.r * 1.7]} />
              <meshStandardMaterial map={planks} color="#a07850" roughness={0.85} />
            </mesh>
            {[-0.3, 0.3].map((o) => (
              <mesh key={o} position={[o * p.r * 1.7, 0.55, 0]}>
                <boxGeometry args={[0.06, 1.14, p.r * 1.74]} />
                <meshStandardMaterial color="#3a2a18" roughness={1} />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <Rain />
    </group>
  );
}

// ------------------------------------------------------------------
// 雪岭冰峰: a snowbound glacier valley, a steep north face with a shelf on top,
// a staked mountain path up the east side, blizzard, avalanches.
// ------------------------------------------------------------------
function glacierTerrain() {
  const size = 150;
  const seg = 300;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const n = seg + 1;
  const step = size / seg;
  // heights first, so the slope can come from the neighbours instead of re-sampling
  const H = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    H[i] = glacierHeight(pos.getX(i), pos.getZ(i));
    pos.setY(i, H[i]);
  }
  const cols = new Float32Array(pos.count * 3);
  const snow = new THREE.Color('#e6edf4');
  const blue = new THREE.Color('#aebfd4');
  const rock = new THREE.Color('#3d434b');
  const path = new THREE.Color('#c4c7c9');
  const dirt = new THREE.Color('#857b6f');
  const ice = new THREE.Color('#9fd0ea');
  const c = new THREE.Color();
  const rand = seeded(23);
  const [sx, sz] = GLACIER.summit;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = H[i];
    const ix = i % n;
    const iz = Math.floor(i / n);
    const hx = (H[iz * n + Math.min(n - 1, ix + 1)] - H[iz * n + Math.max(0, ix - 1)]) / (2 * step);
    const hz = (H[Math.min(n - 1, iz + 1) * n + ix] - H[Math.max(0, iz - 1) * n + ix]) / (2 * step);
    const steep = Math.hypot(hx, hz);
    // snow, bluer in the shaded hollows of the valley
    c.copy(snow).lerp(blue, Math.min(1, Math.max(0, 0.45 - h * 0.04)) * 0.55 + rand() * 0.07);
    // bare rock on the terrace risers and the walls: snow only clings to the gentler ledges
    const streak = 0.5 + 0.5 * Math.sin(x * 1.7 + Math.sin(z * 0.9) * 2.0);
    c.lerp(rock, THREE.MathUtils.smoothstep(steep + streak * 0.3, 0.95, 1.55) * (0.7 + rand() * 0.3));
    // glassy blue ice tongue running down the avalanche chute
    const chute = 1 - THREE.MathUtils.smoothstep(Math.abs(x - (GLACIER.avalancheX[0] + GLACIER.avalancheX[1]) / 2), 2.5, 6.5);
    const inChute = z > GLACIER.avalancheTop && z < 6 ? chute * THREE.MathUtils.smoothstep(steep, 0.2, 0.8) : 0;
    c.lerp(ice, inChute * 0.35);
    // the trodden road: packed snow with muddy wheel ruts
    const r = Math.hypot(x - sx, z - sz);
    if (r < GLACIER.footR + 3) {
      const p = glacierPath(x, z);
      if (p.on > 0) {
        c.lerp(path, p.on * 0.85);
        const rut = Math.abs(p.d - 0.75);
        c.lerp(dirt, (1 - THREE.MathUtils.smoothstep(rut, 0.1, 0.45)) * p.on * 0.5);
      }
    }
    // a wind-polished snow cap on the very top
    c.lerp(snow, THREE.MathUtils.smoothstep(h, GLACIER.summitH - 2.5, GLACIER.summitH) * 0.8);
    cols.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

/** Distant snowy mountains: jagged cones, white above the snow line, fading into the haze */
function SnowRange({ haze = '#c9d6e3' }: { haze?: string }) {
  const items = useMemo(() => {
    const rand = seeded(61);
    const hz = new THREE.Color(haze);
    const out: { geo: THREE.BufferGeometry; pos: [number, number, number] }[] = [];
    for (const [dist, count, hMin, hMax, fade] of [
      [95, 12, 35, 60, 0.15],
      [170, 16, 55, 95, 0.45],
      [260, 20, 80, 140, 0.7],
    ] as const) {
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + rand() * 0.3;
        const d = dist * (0.85 + rand() * 0.3);
        const h = hMin + rand() * (hMax - hMin);
        const r = h * (0.55 + rand() * 0.35);
        const g = new THREE.ConeGeometry(r, h, 11, 6);
        g.translate(0, h / 2, 0);
        const p = g.attributes.position as THREE.BufferAttribute;
        const cols = new Float32Array(p.count * 3);
        const col = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
          const y = p.getY(i);
          const t = y / h;
          const j = 1 + (rand() - 0.5) * 0.35 * (1 - t);
          p.setX(i, p.getX(i) * j);
          p.setZ(i, p.getZ(i) * j);
          p.setY(i, y + (rand() - 0.5) * h * 0.05 * (1 - t));
          const snowLine = 0.45 + rand() * 0.2;
          col.set(t > snowLine ? '#f4f7fb' : '#4b5560').lerp(hz, Math.min(1, fade + (1 - t) * 0.35));
          cols.set([col.r, col.g, col.b], i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        out.push({ geo: g, pos: [Math.cos(a) * d, -10, Math.sin(a) * d] });
      }
    }
    return out;
  }, [haze]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), []);
  return (
    <group>
      {items.map((it, i) => (
        <mesh key={i} geometry={it.geo} material={mat} position={it.pos} />
      ))}
    </group>
  );
}

/** Wind-blown snowfall */
function Snowfall() {
  const { geo, mat } = useMemo(() => {
    const n = 3200;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    const rand = seeded(5);
    for (let i = 0; i < n; i++) {
      pos.set([(rand() - 0.5) * 80, rand() * 36, (rand() - 0.5) * 80], i * 3);
      seed[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        uniform float uTime; attribute float seed; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uTime * (1.4 + seed * 1.2), 36.0) - 6.0;
          p.x = mod(p.x + uTime * 2.4 + sin(uTime * 0.7 + seed * 20.0) * 1.5 + 40.0, 80.0) - 40.0;
          p.z += cos(uTime * 0.5 + seed * 13.0) * 1.2;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (28.0 + seed * 40.0) / -mv.z;
          vA = 0.55 + seed * 0.45;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(0.97, 0.98, 1.0), (1.0 - d * 2.0) * vA);
        }`,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return <points geometry={geo} material={mat} frustumCulled={false} />;
}

/** Snow-laden pines (instanced): three tiers of needles, each capped with snow */
function SnowPines({ spots }: { spots: [number, number, number][] }) {
  const meshes = useMemo(() => {
    const tiers = 3;
    const needle = new THREE.MeshStandardMaterial({ color: '#203a2c', roughness: 0.9, flatShading: true });
    const snowM = new THREE.MeshStandardMaterial({ color: '#f4f7fb', roughness: 0.85, flatShading: true });
    const trunkM = new THREE.MeshStandardMaterial({ color: '#3b2a1e', roughness: 1 });
    const cone = new THREE.ConeGeometry(1, 1, 7);
    const trunkG = new THREE.CylinderGeometry(0.12, 0.16, 1, 6);
    const n = spots.length;
    const needles = new THREE.InstancedMesh(cone, needle, n * tiers);
    const caps = new THREE.InstancedMesh(cone, snowM, n * tiers);
    const trunks = new THREE.InstancedMesh(trunkG, trunkM, n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spots.forEach(([x, z, s], i) => {
      const y = glacierHeight(x, z);
      trunks.setMatrixAt(i, m.compose(new THREE.Vector3(x, y + 0.5 * s, z), q, new THREE.Vector3(s, s, s)));
      for (let t = 0; t < tiers; t++) {
        const r = (1.25 - t * 0.32) * s;
        const hh = (1.5 - t * 0.25) * s;
        const yy = y + (0.9 + t * 1.0) * s;
        needles.setMatrixAt(i * tiers + t, m.compose(new THREE.Vector3(x, yy, z), q, new THREE.Vector3(r, hh, r)));
        caps.setMatrixAt(i * tiers + t, m.compose(new THREE.Vector3(x, yy + hh * 0.22, z), q, new THREE.Vector3(r * 0.82, hh * 0.6, r * 0.82)));
      }
    });
    for (const im of [needles, caps, trunks]) {
      im.castShadow = true;
      im.instanceMatrix.needsUpdate = true;
    }
    return [needles, caps, trunks];
  }, [spots]);
  return (
    <group>
      {meshes.map((im, i) => (
        <primitive key={i} object={im} />
      ))}
    </group>
  );
}

function GlacierMap() {
  const def = MAPS.glacier;
  const terrain = useMemo(() => glacierTerrain(), []);
  const pines = useMemo(() => {
    const rand = seeded(88);
    const out: [number, number, number][] = [];
    const [sx, sz] = GLACIER.summit;
    // a ring of forest on the valley rim, outside the arena
    for (let k = 0; k < 90; k++) {
      const a = rand() * Math.PI * 2;
      const r = 28.5 + rand() * 18;
      out.push([Math.cos(a) * r, Math.sin(a) * r, 0.9 + rand() * 1.0]);
    }
    // scattered on the lower terraces, but never on the road or in the avalanche chute
    for (let k = 0; k < 160 && out.length < 125; k++) {
      const a = rand() * Math.PI * 2;
      const r = 8 + rand() * 13;
      const x = sx + Math.cos(a) * r;
      const z = sz + Math.sin(a) * r;
      if (Math.hypot(x, z) > 25.5) continue;
      if (glacierPath(x, z).d < GLACIER.pathHalf + 2) continue;
      if (x > GLACIER.avalancheX[0] - 1.5 && x < GLACIER.avalancheX[1] + 1.5 && z > GLACIER.avalancheTop) continue;
      const [gx, gz] = glacierGradient(x, z);
      if (Math.hypot(gx, gz) > 0.7) continue; // only on the flat ledges
      out.push([x, z, 0.7 + rand() * 0.5]);
    }
    return out;
  }, []);
  // wooden stakes with red ribbons along the outer (downhill) edge of the road
  const stakes = useMemo(() => {
    const out: [number, number, number][] = [];
    const [sx, sz] = GLACIER.summit;
    const pts = GLACIER.pathPts;
    for (let i = 4; i < pts.length; i += 9) {
      const [px, pz] = pts[i];
      const dx = px - sx;
      const dz = pz - sz;
      const l = Math.hypot(dx, dz) || 1;
      const x = px + (dx / l) * (GLACIER.pathHalf + 0.15);
      const z = pz + (dz / l) * (GLACIER.pathHalf + 0.15);
      out.push([x, glacierHeight(x, z), z]);
    }
    return out;
  }, []);
  // avalanche: a rolling wall of snow cloud
  const avRef = useRef<THREE.Group>(null);
  const puff = useMemo(() => cloudPuffTexture(), []);
  useFrame((st) => {
    const g = avRef.current;
    if (!g) return;
    const z = mapRuntime.avalancheZ;
    g.visible = z > -900;
    if (!g.visible) return;
    const t = st.clock.elapsedTime;
    g.children.forEach((s, i) => {
      const x = GLACIER.avalancheX[0] + ((i % 9) / 8) * (GLACIER.avalancheX[1] - GLACIER.avalancheX[0]);
      const back = Math.floor(i / 9) * 1.6;
      const zz = z - back;
      s.position.set(x + Math.sin(t * 2 + i) * 0.4, glacierHeight(x, zz) + 1.2 + Math.floor(i / 9) * 0.9, zz);
      const k = 4.5 + Math.sin(t * 3 + i * 1.3) * 0.6 + Math.floor(i / 9);
      s.scale.set(k * 1.4, k, 1);
    });
  });
  return (
    <group>
      <Sky zenith="#7d92ab" horizon="#dbe4ed" below="#c9d4de" sunDir={[-0.35, 0.22, -1]} sunColor="#fff3e0" sunSize={1.2} streaks={0.7} streakColor="#f2f5f8" />
      <SnowRange />
      <CloudPuffs count={20} inner={40} outer={130} y={[14, 30]} color="#e9eef3" seed={41} />
      <mesh geometry={terrain} receiveShadow castShadow>
        <meshStandardMaterial vertexColors roughness={0.88} metalness={0} />
      </mesh>
      <SnowPines spots={pines} />
      {stakes.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh position={[0, 0.5, 0]} castShadow>
            <cylinderGeometry args={[0.05, 0.06, 1.0, 6]} />
            <meshStandardMaterial color="#4a3423" roughness={0.9} />
          </mesh>
          <mesh position={[0.12, 0.92, 0]} rotation={[0, 0, -0.3]}>
            <planeGeometry args={[0.28, 0.08]} />
            <meshStandardMaterial color="#b91c1c" side={THREE.DoubleSide} roughness={0.8} />
          </mesh>
        </group>
      ))}
      {/* summit cairn with a tattered banner: the goal of the climb */}
      <group position={[GLACIER.summit[0] + 1.6, glacierHeight(GLACIER.summit[0] + 1.6, GLACIER.summit[1] + 0.8), GLACIER.summit[1] + 0.8]}>
        {[0.55, 0.42, 0.3].map((r, k) => (
          <mesh key={k} position={[Math.sin(k * 2) * 0.08, 0.25 + k * 0.42, 0]} rotation={[0.2 * k, k, 0.1]} castShadow>
            <dodecahedronGeometry args={[r, 0]} />
            <meshStandardMaterial color="#5b6168" roughness={0.95} flatShading />
          </mesh>
        ))}
        <mesh position={[0, 1.9, 0]} castShadow>
          <cylinderGeometry args={[0.04, 0.05, 2.6, 6]} />
          <meshStandardMaterial color="#3b2a1e" roughness={0.9} />
        </mesh>
        <mesh position={[0.45, 2.85, 0]}>
          <planeGeometry args={[0.85, 0.5]} />
          <meshStandardMaterial color="#9f1d1d" side={THREE.DoubleSide} roughness={0.8} />
        </mesh>
      </group>
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
              <octahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color="#bfe3f7" roughness={0.12} metalness={0.05} transparent opacity={0.88} emissive="#3b8bc4" emissiveIntensity={0.18} flatShading />
            </mesh>
          ))}
        </group>
      ))}
      <group ref={avRef} visible={false}>
        {Array.from({ length: 27 }, (_, i) => (
          <sprite key={i}>
            <spriteMaterial map={puff} color="#f8fafc" transparent depthWrite={false} opacity={0.95} />
          </sprite>
        ))}
      </group>
      <Snowfall />
    </group>
  );
}

export function Maps3D({ mapId }: { mapId: MapId }) {
  if (mapId === 'lavacliff') return <LavaCliffMap />;
  if (mapId === 'sea') return <SeaMap />;
  if (mapId === 'glacier') return <GlacierMap />;
  return <TempleMap />;
}

export function useMapRef() {
  return useRef(mapRuntime);
}
