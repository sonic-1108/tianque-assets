import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Arenas3D } from './Arenas3D';
import { MAPS, MapId, mapRuntime } from '../maps';

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
// 熔炉地心
// ------------------------------------------------------------------
function ForgeMap() {
  const def = MAPS.forge;
  const lava = useMemo(() => {
    const m = makeLavaMaterial({ forgeMask: true });
    def.islands!.forEach((is, i) => m.uniforms.uIslands.value[i].set(is.x, is.z, is.r));
    return m;
  }, [def.islands]);
  const tex = useMemo(() => {
    const t = rockTexture('#46403a', false);
    t.map.repeat.set(4, 4);
    return t;
  }, []);
  useFrame((st) => {
    lava.uniforms.uTime.value = st.clock.elapsedTime;
    lava.uniforms.uLavaR.value = mapRuntime.lavaR;
  });
  return (
    <group>
      <mesh position={[0, -0.25, 0]} receiveShadow>
        <cylinderGeometry args={[def.radius + 0.6, def.radius + 0.6, 0.5, 64]} />
        <meshStandardMaterial map={tex.map} roughness={0.9} />
      </mesh>
      {/* center dais rings */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.9, 4.2, 64]} />
        <meshStandardMaterial color="#7a5a3a" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* safe islands (raised slabs) */}
      {def.islands!.map((is, i) => (
        <group key={i} position={[is.x, 0, is.z]}>
          <mesh position={[0, 0.03, 0]} receiveShadow castShadow>
            <cylinderGeometry args={[is.r, is.r + 0.15, 0.12, 32]} />
            <meshStandardMaterial color="#5c544c" roughness={0.85} />
          </mesh>
          <mesh position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[is.r - 0.2, is.r, 32]} />
            <meshStandardMaterial color="#8a6a40" metalness={0.7} roughness={0.35} />
          </mesh>
        </group>
      ))}
      {/* lava overlay (masked by current lava radius & islands) */}
      <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <circleGeometry args={[def.radius + 0.6, 96]} />
        <primitive object={lava} attach="material" />
      </mesh>
      {/* forge walls & giant furnaces */}
      <mesh position={[0, 6, 0]}>
        <cylinderGeometry args={[def.radius + 9, def.radius + 6, 14, 48, 1, true]} />
        <meshStandardMaterial color="#2a2420" roughness={1} side={THREE.BackSide} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        const r = def.radius + 6.5;
        return (
          <group key={i} position={[Math.cos(a) * r, 0, Math.sin(a) * r]} rotation={[0, -a - Math.PI / 2, 0]}>
            <mesh position={[0, 4, 0]} castShadow>
              <boxGeometry args={[4, 8, 2.5]} />
              <meshStandardMaterial color="#3a332e" roughness={0.8} metalness={0.3} />
            </mesh>
            <mesh position={[0, 2.2, 1.3]}>
              <planeGeometry args={[2.2, 2.4]} />
              <meshBasicMaterial color={new THREE.Color(3, 1.1, 0.2)} toneMapped={false} />
            </mesh>
            <pointLight position={[0, 2.5, 2.5]} color="#ff8a3a" intensity={12} distance={14} />
            {/* hanging chains */}
            {[-1.4, 1.4].map((x) => (
              <mesh key={x} position={[x, 11, 0.5]}>
                <cylinderGeometry args={[0.08, 0.08, 6, 6]} />
                <meshStandardMaterial color="#1c1916" metalness={0.8} roughness={0.5} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

export function Maps3D({ mapId }: { mapId: MapId }) {
  if (mapId === 'lavacliff') return <LavaCliffMap />;
  if (mapId === 'forge') return <ForgeMap />;
  return <TempleMap />;
}

export function useMapRef() {
  return useRef(mapRuntime);
}
