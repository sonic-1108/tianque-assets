import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Arenas3D } from './Arenas3D';
import { MAPS, MapId, mapRuntime, VOLCANO_CRATER } from '../maps';

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
// 天阙演武场
// ------------------------------------------------------------------
function TempleMap() {
  const def = MAPS.temple;
  const wallSegs = 40;
  return (
    <group>
      <Arenas3D radius={def.radius} />
      {/* outer parapet wall */}
      {Array.from({ length: wallSegs }, (_, i) => {
        const a = (i / wallSegs) * Math.PI * 2;
        const r = def.radius + 0.55;
        return (
          <mesh key={i} position={[Math.cos(a) * r, 0.55, Math.sin(a) * r]} rotation={[0, -a + Math.PI / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[(2 * Math.PI * r) / wallSegs + 0.05, 1.1, 0.6]} />
            <meshStandardMaterial color={i % 2 ? '#8a7f72' : '#7d7366'} roughness={0.9} />
          </mesh>
        );
      })}
      {/* pillars with braziers */}
      {def.pillars!.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[p.r + 0.25, p.r + 0.35, 0.5, 20]} />
            <meshStandardMaterial color="#6e655b" roughness={0.9} />
          </mesh>
          <mesh position={[0, 2.6, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[p.r * 0.85, p.r, 4.4, 20]} />
            <meshStandardMaterial color="#9a8f81" roughness={0.85} />
          </mesh>
          <mesh position={[0, 5.0, 0]} castShadow>
            <cylinderGeometry args={[p.r + 0.3, p.r * 0.85, 0.5, 20]} />
            <meshStandardMaterial color="#7a6f62" roughness={0.85} />
          </mesh>
          <mesh position={[0, 5.45, 0]}>
            <cylinderGeometry args={[0.55, 0.3, 0.4, 16]} />
            <meshStandardMaterial color="#3b2a1c" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 5.75, 0]}>
            <coneGeometry args={[0.35, 0.8, 12]} />
            <meshBasicMaterial color={new THREE.Color(3, 1.3, 0.3)} toneMapped={false} />
          </mesh>
          <pointLight position={[0, 6.1, 0]} color="#ffa04a" intensity={6} distance={9} />
        </group>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------
// 熔岩断崖
// ------------------------------------------------------------------
function LavaCliffMap() {
  const def = MAPS.lavacliff;
  const lava = useMemo(() => makeLavaMaterial(), []);
  const tex = useMemo(() => {
    const t = rockTexture('#3a302b', true);
    t.map.repeat.set(3, 3);
    t.em.repeat.set(3, 3);
    return t;
  }, []);
  const ventMats = useMemo(
    () => def.vents!.map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.05, 0), transparent: true, opacity: 0.9, toneMapped: false })),
    [def.vents]
  );
  const spires = useMemo(
    () =>
      Array.from({ length: 26 }, () => {
        const a = Math.random() * Math.PI * 2;
        const r = 22 + Math.random() * 40;
        return { x: Math.cos(a) * r, z: Math.sin(a) * r, h: 6 + Math.random() * 18, w: 1.5 + Math.random() * 3.5 };
      }),
    []
  );
  useFrame((st) => {
    lava.uniforms.uTime.value = st.clock.elapsedTime;
    def.vents!.forEach((_, i) => {
      const h = mapRuntime.ventHeat[i] ?? 0;
      ventMats[i].color.setRGB(0.4 + h * 3.5, 0.05 + h * 0.9, h * 0.15);
    });
  });
  return (
    <group>
      {/* basalt platform: flat top at y=0, rough tapered underside */}
      <mesh position={[0, -3.5, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[def.radius + 0.4, def.radius * 0.55, 7, 40, 1]} />
        <meshStandardMaterial map={tex.map} emissiveMap={tex.em} emissive="#ffffff" emissiveIntensity={1.2} roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[def.radius + 0.4, 48]} />
        <meshStandardMaterial map={tex.map} emissiveMap={tex.em} emissive="#ffffff" emissiveIntensity={1.4} roughness={0.92} />
      </mesh>
      {/* glowing rim to show the edge */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[def.radius + 0.1, def.radius + 0.4, 64]} />
        <meshBasicMaterial color={new THREE.Color(2.2, 0.5, 0.08)} toneMapped={false} />
      </mesh>
      {/* vents */}
      {def.vents!.map((v, i) => (
        <group key={i} position={[v.x, 0.02, v.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[v.r * 0.55, 24]} />
            <primitive object={ventMats[i]} attach="material" />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
            <ringGeometry args={[v.r * 0.55, v.r * 0.7, 24]} />
            <meshStandardMaterial color="#1a1310" roughness={1} />
          </mesh>
        </group>
      ))}
      {/* lava sea */}
      <mesh position={[0, -7, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[260, 260, 1, 1]} />
        <primitive object={lava} attach="material" />
      </mesh>
      <pointLight position={[0, -4, 0]} color="#ff5a1a" intensity={60} distance={30} />
      <Volcano emissive={tex.em} />
      {spires.map((s, i) => (
        <mesh key={i} position={[s.x, -7 + s.h / 2, s.z]} castShadow>
          <coneGeometry args={[s.w, s.h, 7]} />
          <meshStandardMaterial color="#2a211d" roughness={1} emissiveMap={tex.em} emissive="#ffffff" emissiveIntensity={0.6} />
        </mesh>
      ))}
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
  const em = useMemo(() => {
    const t = emissive.clone();
    t.repeat.set(4, 2);
    t.needsUpdate = true;
    return t;
  }, [emissive]);
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
      <mesh position={[0, base + h / 2, 0]}>
        <cylinderGeometry args={[9, 48, h, 40, 6, true]} />
        <meshStandardMaterial color="#2b221e" roughness={1} emissiveMap={em} emissive="#ffffff" emissiveIntensity={0.9} />
      </mesh>
      <mesh position={[0, cy - 0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[8.6, 32]} />
        <primitive object={glowMat} attach="material" />
      </mesh>
      <pointLight ref={lightRef} position={[0, cy + 6, 0]} color="#ff6a1a" intensity={300} distance={260} decay={1.4} />
      <group ref={smokeRef} position={[0, cy + 10, 0]}>
        {[0, 1, 2, 3, 4].map((k) => (
          <mesh key={k} position={[Math.sin(k * 1.7) * 4, k * 9, Math.cos(k * 2.3) * 4]}>
            <sphereGeometry args={[8 + k * 3, 16, 12]} />
            <meshStandardMaterial color="#1b1412" transparent opacity={0.55 - k * 0.08} depthWrite={false} roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ------------------------------------------------------------------
// 怒海战船: storm ocean, rocking warship, rain, lightning, big waves
// ------------------------------------------------------------------
function makeOceanMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWaveSide: { value: 0 },
      uWaveRise: { value: 0 },
      uFog: { value: new THREE.Color('#0b1622') },
      uLightning: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uWaveSide; uniform float uWaveRise;
      varying float vH; varying vec3 vWorld; varying vec3 vN;
      float waves(vec2 p){
        float h = 0.0;
        h += sin(p.x * 0.12 + uTime * 0.9) * 0.9;
        h += sin(p.y * 0.17 - uTime * 1.1 + p.x * 0.05) * 0.7;
        h += sin((p.x + p.y) * 0.31 + uTime * 1.7) * 0.35;
        h += sin((p.x - p.y) * 0.57 - uTime * 2.3) * 0.18;
        // rogue wave ridge rising beside the ship, then crashing inward
        float x0 = uWaveSide * (9.0 - max(0.0, uWaveRise - 1.0) * 30.0);
        float ridge = exp(-pow(p.x - x0, 2.0) / 14.0) * exp(-pow(p.y / 30.0, 2.0));
        h += ridge * min(uWaveRise, 1.0) * 6.5 * step(0.5, abs(uWaveSide));
        return h;
      }
      void main(){
        vec4 w = modelMatrix * vec4(position, 1.0);
        float h = waves(w.xz);
        float e = 0.6;
        float hx = waves(w.xz + vec2(e, 0.0)) - h;
        float hz = waves(w.xz + vec2(0.0, e)) - h;
        vN = normalize(vec3(-hx / e, 1.0, -hz / e));
        w.y += h;
        vH = h; vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFog; uniform float uLightning; uniform float uTime;
      varying float vH; varying vec3 vWorld; varying vec3 vN;
      void main(){
        vec3 deep = vec3(0.01, 0.05, 0.08);
        vec3 shallow = vec3(0.03, 0.16, 0.2);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(vN, V), 0.0), 3.0);
        vec3 col = mix(deep, shallow, smoothstep(-1.0, 2.0, vH));
        col = mix(col, vec3(0.35, 0.45, 0.55) + uLightning * 0.8, fres * 0.6);
        vec3 L = normalize(vec3(0.3, 0.8, -0.5));
        float spec = pow(max(dot(reflect(-L, vN), V), 0.0), 60.0);
        col += spec * (0.25 + uLightning * 2.0);
        float foam = smoothstep(1.3, 2.6, vH) + smoothstep(3.0, 5.0, vH);
        col = mix(col, vec3(0.85, 0.92, 0.95), clamp(foam, 0.0, 1.0) * 0.8);
        float d = length(cameraPosition - vWorld);
        col = mix(col, uFog, smoothstep(25.0, 140.0, d));
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
      fragmentShader: /* glsl */ `uniform float uLightning; void main(){ gl_FragColor = vec4(vec3(0.7, 0.8, 0.95) + uLightning, 0.35 + uLightning * 0.4); }`,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    mat.uniforms.uLightning.value = mapRuntime.lightning;
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} />;
}

function SeaMap() {
  const def = MAPS.sea;
  const { hx, hz } = def.rect!;
  const ocean = useMemo(() => makeOceanMaterial(), []);
  const planks = useMemo(() => {
    const t = plankTexture();
    t.repeat.set(1, 2);
    return t;
  }, []);
  const shipRef = useRef<THREE.Group>(null);
  const boltRef = useRef<THREE.DirectionalLight>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    ocean.uniforms.uTime.value = t;
    ocean.uniforms.uWaveSide.value = mapRuntime.waveSide;
    ocean.uniforms.uWaveRise.value = mapRuntime.waveRise;
    ocean.uniforms.uLightning.value = mapRuntime.lightning;
    if (st.scene.background instanceof THREE.Color) ocean.uniforms.uFog.value.copy(st.scene.background);
    if (shipRef.current) {
      shipRef.current.rotation.z = Math.sin(t * 0.7) * 0.012 + mapRuntime.waveSide * Math.min(1, mapRuntime.waveRise) * 0.035;
      shipRef.current.rotation.x = Math.sin(t * 0.45 + 1) * 0.008;
    }
    if (boltRef.current) boltRef.current.intensity = mapRuntime.lightning * 7;
  });
  const wood = '#4a3020';
  const dark = '#2a1a10';
  const railPosts: [number, number][] = [];
  for (let z = -hz - 0.6; z <= hz + 0.6; z += 1.3) {
    railPosts.push([-(hx + 0.35), z], [hx + 0.35, z]);
  }
  return (
    <group>
      <directionalLight ref={boltRef} position={[10, 40, -10]} color="#e6eeff" intensity={0} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.6, 0]}>
        <planeGeometry args={[420, 420, 200, 200]} />
        <primitive object={ocean} attach="material" />
      </mesh>
      <group ref={shipRef}>
        {/* deck */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[hx * 2 + 1.1, hz * 2 + 1.6]} />
          <meshStandardMaterial map={planks} roughness={0.75} metalness={0.05} />
        </mesh>
        {/* hull */}
        <mesh position={[0, -1.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[hx * 2 + 1.2, 2.9, hz * 2 + 1.6]} />
          <meshStandardMaterial color={dark} roughness={0.85} />
        </mesh>
        {/* bow (pointed) */}
        <mesh position={[0, -1.1, -(hz + 0.8)]} rotation={[0, Math.PI, 0]} scale={[1, 1, 1.9]} castShadow>
          <cylinderGeometry args={[hx + 0.62, hx * 0.3, 3.6, 3, 1]} />
          <meshStandardMaterial color={dark} roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.25, -(hz + 5.8)]} rotation={[-0.5, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.2, 6, 8]} />
          <meshStandardMaterial color={wood} roughness={0.8} />
        </mesh>
        {/* stern castle */}
        <mesh position={[0, 1.3, hz + 2.2]} castShadow receiveShadow>
          <boxGeometry args={[hx * 2 + 1.2, 2.6, 3.2]} />
          <meshStandardMaterial color={wood} roughness={0.85} />
        </mesh>
        {[-2.2, 0, 2.2].map((x) => (
          <mesh key={x} position={[x, 1.6, hz + 0.58]}>
            <planeGeometry args={[0.9, 0.7]} />
            <meshBasicMaterial color={new THREE.Color(2.4, 1.3, 0.4)} toneMapped={false} />
          </mesh>
        ))}
        <pointLight position={[0, 2, hz + 0.2]} color="#ffb060" intensity={14} distance={12} />
        {/* railings */}
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
        {/* masts, yards & sails */}
        {def.pillars!.slice(0, 2).map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]}>
            <mesh position={[0, 7, 0]} castShadow>
              <cylinderGeometry args={[p.r * 0.6, p.r, 14, 14]} />
              <meshStandardMaterial color={wood} roughness={0.8} />
            </mesh>
            {[6, 11].map((y) => (
              <group key={y}>
                <mesh position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <cylinderGeometry args={[0.12, 0.12, 8, 8]} />
                  <meshStandardMaterial color={wood} roughness={0.8} />
                </mesh>
                <mesh position={[0, y - 2.1, 0.35]} rotation={[0.08, 0, 0]}>
                  <planeGeometry args={[7.4, 3.9, 8, 4]} />
                  <meshStandardMaterial color="#6e2a22" roughness={0.95} side={THREE.DoubleSide} />
                </mesh>
              </group>
            ))}
            <mesh position={[0, 14.4, 0]}>
              <boxGeometry args={[0.25, 0.25, 0.25]} />
              <meshBasicMaterial color={new THREE.Color(2.5, 1.4, 0.5)} toneMapped={false} />
            </mesh>
          </group>
        ))}
        {/* cargo crates */}
        {def.pillars!.slice(2).map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]} rotation={[0, i * 0.7, 0]}>
            <mesh position={[0, 0.55, 0]} castShadow receiveShadow>
              <boxGeometry args={[p.r * 1.7, 1.1, p.r * 1.7]} />
              <meshStandardMaterial color="#6b4a2c" roughness={0.85} />
            </mesh>
            <mesh position={[0.1, 1.35, -0.05]} rotation={[0, 0.4, 0]} castShadow>
              <boxGeometry args={[p.r * 1.1, 0.5, p.r * 1.1]} />
              <meshStandardMaterial color="#7a5634" roughness={0.85} />
            </mesh>
          </group>
        ))}
        {/* hanging lanterns */}
        {[-hz + 2, hz - 3].map((z) => (
          <group key={z} position={[0, 3.3, z]}>
            <mesh>
              <boxGeometry args={[0.35, 0.5, 0.35]} />
              <meshBasicMaterial color={new THREE.Color(2.6, 1.5, 0.5)} toneMapped={false} />
            </mesh>
            <pointLight color="#ffb060" intensity={10} distance={11} />
          </group>
        ))}
      </group>
      <Rain />
    </group>
  );
}

export function Maps3D({ mapId }: { mapId: MapId }) {
  if (mapId === 'lavacliff') return <LavaCliffMap />;
  if (mapId === 'sea') return <SeaMap />;
  return <TempleMap />;
}

export function useMapRef() {
  return useRef(mapRuntime);
}
