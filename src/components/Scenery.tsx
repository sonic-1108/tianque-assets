import React, { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mapRuntime } from '../maps';

/** Shared GLSL value noise / fbm */
export const GLSL_NOISE = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y); }
  float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5; } return v; }
`;

/** Deterministic random so the scenery is the same every time the map loads */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------
// Sky dome: zenith -> horizon gradient, sun disc and glow, optional cloud streaks
// ------------------------------------------------------------------
export function Sky({
  zenith,
  horizon,
  below,
  sunDir = [0.3, 0.2, -1],
  sunColor = '#ffd9a0',
  sunSize = 1,
  streaks = 0.5,
  streakColor = '#ffffff',
}: {
  zenith: string;
  horizon: string;
  below?: string;
  sunDir?: [number, number, number];
  sunColor?: string;
  sunSize?: number;
  streaks?: number;
  streakColor?: string;
}) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uZenith: { value: new THREE.Color(zenith) },
          uHorizon: { value: new THREE.Color(horizon) },
          uBelow: { value: new THREE.Color(below ?? horizon) },
          uSunDir: { value: new THREE.Vector3(...sunDir).normalize() },
          uSun: { value: new THREE.Color(sunColor) },
          uSunSize: { value: sunSize },
          uStreaks: { value: streaks },
          uStreakColor: { value: new THREE.Color(streakColor) },
          uTime: { value: 0 },
          uFlash: { value: new THREE.Color(0, 0, 0) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uZenith, uHorizon, uBelow, uSun, uStreakColor, uFlash; uniform vec3 uSunDir; uniform float uSunSize, uStreaks, uTime;
          varying vec3 vDir;
          ${GLSL_NOISE}
          void main(){
            vec3 d = normalize(vDir);
            float h = d.y;
            vec3 col = h > 0.0 ? mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55)) : mix(uHorizon, uBelow, clamp(-h * 4.0, 0.0, 1.0));
            float s = max(dot(d, uSunDir), 0.0);
            col += uSun * (pow(s, 6.0) * 0.35 + pow(s, 60.0) * 0.6) ;
            col += uSun * smoothstep(0.9993 - 0.0004 * uSunSize, 0.9997, s) * 3.0; // disc (HDR so it blooms)
            // long thin cloud streaks near the horizon
            vec2 sp = vec2(atan(d.z, d.x) * 3.0, h * 18.0);
            float c = fbm(sp * vec2(1.0, 2.5) + vec2(uTime * 0.004, 0.0));
            float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.25, 0.55, h));
            float cl = smoothstep(0.55, 0.8, c) * band * uStreaks;
            vec3 cloudCol = mix(uStreakColor, uSun, pow(s, 3.0) * 0.6);
            col = mix(col, cloudCol, cl * 0.7);
            col += uFlash * (0.6 + 0.4 * max(h, 0.0));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
    // lightning flashes and volcanic eruptions light up the whole sky
    const l = mapRuntime.lightning;
    const e = mapRuntime.eruption;
    mat.uniforms.uFlash.value.setRGB(l * 0.55 + e * 0.5, l * 0.62 + e * 0.1, l * 0.8 + e * 0.02);
  });
  return (
    <mesh renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[480, 48, 24]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// ------------------------------------------------------------------
// Karst peaks (张家界 style stone pillars) rising out of a sea of clouds.
// Each layer is fogged toward the haze colour by hand so depth reads like ink painting.
// ------------------------------------------------------------------
function peakGeometry(rand: () => number, height: number, radius: number) {
  const pts: THREE.Vector2[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // steep sides, rounded crown, jittered silhouette
    // near-vertical walls, a slight waist, then a rounded cap
    const crown = t > 0.88 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.88) / 0.12, 2))) : 1;
    const r = radius * (1.1 - 0.25 * t + 0.08 * Math.sin(t * 9 + rand() * 2)) * crown * (0.92 + rand() * 0.16);
    pts.push(new THREE.Vector2(Math.max(0.01, r), t * height));
  }
  const g = new THREE.LatheGeometry(pts, 14);
  // knock the round lathe into an irregular rock column
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const n = Math.sin(x * 0.7 + y * 0.3) * 0.09 + Math.cos(z * 0.8 - y * 0.21) * 0.09 + Math.sin(y * 1.7) * 0.04;
    pos.setX(i, x * (1 + n));
    pos.setZ(i, z * (1 + n));
  }
  g.computeVertexNormals();
  return g;
}

export function KarstPeaks({
  seed = 7,
  layers,
  baseY = -30,
  haze,
  rock = '#4b5a52',
  light = '#ffd9b0',
  lightDir = [0.3, 0.2, -1],
  pines = true,
  exclude,
  rimStrength = 0.35,
}: {
  seed?: number;
  layers: { dist: number; count: number; height: [number, number]; radius: [number, number]; haze: number }[];
  baseY?: number;
  haze: string;
  rock?: string;
  /** rim-light colour on the side facing the sun */
  light?: string;
  lightDir?: [number, number, number];
  pines?: boolean;
  rimStrength?: number;
  /** angle range (radians) to keep clear, e.g. where the sun sets */
  exclude?: [number, number];
}) {
  // Unlit, vertex-coloured silhouettes: dark rock up top, dissolving into mist at the base,
  // with a thin warm rim on the sun side. Reads like layered ink painting rather than lit plastic.
  const items = useMemo(() => {
    const rand = seeded(seed);
    const out: { geo: THREE.BufferGeometry; pos: [number, number, number]; rot: number; h: number; r: number; pine: boolean; pineColor: THREE.Color }[] = [];
    const hazeC = new THREE.Color(haze);
    const rockC = new THREE.Color(rock);
    const lightC = new THREE.Color(light);
    const L = new THREE.Vector3(...lightDir).normalize();
    const n = new THREE.Vector3();
    for (const layer of layers) {
      for (let k = 0; k < layer.count; k++) {
        let a = (k / layer.count) * Math.PI * 2 + rand() * 0.35;
        if (exclude && a > exclude[0] && a < exclude[1] && rand() < 0.7) a += exclude[1] - exclude[0];
        const d = layer.dist * (0.85 + rand() * 0.3);
        const h = layer.height[0] + rand() * (layer.height[1] - layer.height[0]);
        const r = layer.radius[0] + rand() * (layer.radius[1] - layer.radius[0]);
        const rot = rand() * 6;
        const geo = peakGeometry(rand, h, r);
        const pos = geo.attributes.position as THREE.BufferAttribute;
        const nor = geo.attributes.normal as THREE.BufferAttribute;
        const cols = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
          const t = pos.getY(i) / h;
          n.set(nor.getX(i), 0, nor.getZ(i)).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).normalize();
          const rim = Math.pow(Math.max(0, n.dot(L)), 2) * rimStrength * (1 - layer.haze);
          c.copy(rockC).lerp(hazeC, Math.min(1, layer.haze + Math.pow(Math.max(0, 1 - t), 1.5) * 0.6));
          c.lerp(lightC, rim);
          cols.set([c.r, c.g, c.b], i * 3);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        out.push({
          geo,
          pos: [Math.cos(a) * d, baseY, Math.sin(a) * d],
          rot,
          h,
          r,
          pine: pines && layer.haze < 0.5,
          pineColor: rockC.clone().lerp(hazeC, layer.haze).multiplyScalar(0.8),
        });
      }
    }
    return out;
    // keyed on the values, not the array identities: callers pass inline arrays, and rebuilding
    // these meshes on every re-render leaked GPU memory until the tab crashed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify({ seed, layers, baseY, haze, rock, light, lightDir, pines, exclude, rimStrength })]);
  React.useEffect(() => () => items.forEach((it) => it.geo.dispose()), [items]);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }), []);
  return (
    <group>
      {items.map((it, i) => (
        <group key={i} position={it.pos} rotation={[0, it.rot, 0]}>
          <mesh geometry={it.geo} material={mat} />
          {it.pine &&
            [0, 1, 2, 3].map((p) => (
              <mesh key={p} position={[Math.cos(p * 1.7) * it.r * 0.45, it.h * 0.97 - (p % 2) * 0.6, Math.sin(p * 1.7) * it.r * 0.45]}>
                <coneGeometry args={[it.r * 0.18, it.r * 0.55, 7]} />
                <meshBasicMaterial color={it.pineColor} fog={false} />
              </mesh>
            ))}
        </group>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------
// Sea of clouds: a huge soft layer that fades into the horizon colour
// ------------------------------------------------------------------
export function CloudSea({ y = -14, color = '#fff4e6', shadow = '#9a8fa8', horizon = '#e9b98a', sunDir = [0.3, 0.2, -1] as [number, number, number] }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uShadow: { value: new THREE.Color(shadow) },
          uHorizon: { value: new THREE.Color(horizon) },
          uSun: { value: new THREE.Vector3(...sunDir).normalize() },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorld;
          void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uColor, uShadow, uHorizon, uSun; varying vec3 vWorld;
          ${GLSL_NOISE}
          void main(){
            vec2 p = vWorld.xz * 0.018;
            float n = fbm(p + vec2(uTime * 0.006, uTime * 0.004));
            float n2 = fbm(p * 2.7 - vec2(uTime * 0.01, 0.0));
            float puff = smoothstep(0.35, 0.75, n * 0.7 + n2 * 0.45);
            // lit tops toward the sun, shadowed valleys
            vec2 toSun = normalize(uSun.xz);
            float lit = smoothstep(-0.2, 0.3, fbm(p + toSun * 0.05) - n);
            vec3 col = mix(uShadow, uColor, 0.45 + puff * 0.4 + lit * 0.25);
            float d = length(vWorld.xz - cameraPosition.xz);
            col = mix(col, uHorizon, smoothstep(60.0, 380.0, d));
            float a = mix(0.55, 1.0, puff) * (1.0 - smoothstep(380.0, 470.0, d));
            gl_FragColor = vec4(col, a);
          }`,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} renderOrder={-5}>
      <circleGeometry args={[470, 64]} />
      <primitive object={mat} attach="material" />
    </mesh>
  );
}

// ------------------------------------------------------------------
// Drifting cloud puffs (camera-facing sprites) near the arena
// ------------------------------------------------------------------
let puffTex: THREE.Texture | null = null;
export function cloudPuffTexture() {
  if (puffTex) return puffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(3);
  for (let i = 0; i < 26; i++) {
    const x = 128 + (rand() - 0.5) * 120;
    const y = 140 + (rand() - 0.5) * 60;
    const r = 30 + rand() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  puffTex = new THREE.CanvasTexture(c);
  puffTex.colorSpace = THREE.SRGBColorSpace;
  return puffTex;
}

export function CloudPuffs({ count = 18, inner = 24, outer = 70, y = [-8, 3] as [number, number], color = '#fff1e0', seed = 11 }) {
  const items = useMemo(() => {
    const rand = seeded(seed);
    return Array.from({ length: count }, () => {
      const a = rand() * Math.PI * 2;
      const d = inner + rand() * (outer - inner);
      return { a, d, y: y[0] + rand() * (y[1] - y[0]), s: 14 + rand() * 18, speed: 0.004 + rand() * 0.006 };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, inner, outer, y[0], y[1], seed]);
  const mat = useMemo(() => new THREE.SpriteMaterial({ map: cloudPuffTexture(), color, transparent: true, depthWrite: false, opacity: 0.85, fog: false }), [color]);
  const ref = React.useRef<THREE.Group>(null);
  useFrame((st) => {
    const g = ref.current;
    if (!g) return;
    const t = st.clock.elapsedTime;
    g.children.forEach((s, i) => {
      const it = items[i];
      const a = it.a + t * it.speed;
      s.position.set(Math.cos(a) * it.d, it.y, Math.sin(a) * it.d);
    });
  });
  return (
    <group ref={ref}>
      {items.map((it, i) => (
        <sprite key={i} material={mat} scale={[it.s * 1.8, it.s * 0.8, 1]} position={[Math.cos(it.a) * it.d, it.y, Math.sin(it.a) * it.d]} />
      ))}
    </group>
  );
}

// ------------------------------------------------------------------
// Waving cloth banner (vertex shader ripple)
// ------------------------------------------------------------------
export function Banner({ position, rotationY = 0, color = '#9b1c1c', trim = '#d4a017', height = 4.5, width = 1.1, pole = 7.5 }: {
  position: [number, number, number];
  rotationY?: number;
  color?: string;
  trim?: string;
  height?: number;
  width?: number;
  pole?: number;
}) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uTrim: { value: new THREE.Color(trim) }, uPhase: { value: position[0] * 0.37 + position[2] * 0.21 } },
        vertexShader: /* glsl */ `
          uniform float uTime, uPhase; varying vec2 vUv; varying float vShade;
          void main(){
            vUv = uv;
            vec3 p = position;
            float free = 1.0 - uv.y;           // hanging cloth: top edge fixed to the crossbar
            float w = sin(uv.y * 5.0 - uTime * 3.2 + uPhase) * 0.18 + sin(uv.x * 4.0 + uTime * 2.1 + uPhase) * 0.06;
            p.z += w * free;
            p.x += sin(uTime * 1.3 + uPhase) * 0.12 * free;
            vShade = 0.75 + 0.25 * cos(uv.y * 5.0 - uTime * 3.2 + uPhase);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor, uTrim; varying vec2 vUv; varying float vShade;
          void main(){
            float edge = step(vUv.x, 0.07) + step(0.93, vUv.x) + step(vUv.y, 0.05);
            vec3 col = mix(uColor, uTrim, clamp(edge, 0.0, 1.0));
            // a simple emblem: gold ring in the upper half
            float r = length((vUv - vec2(0.5, 0.68)) * vec2(1.0, 2.4));
            col = mix(col, uTrim, smoothstep(0.26, 0.24, r) * smoothstep(0.17, 0.19, r));
            gl_FragColor = vec4(col * vShade, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, pole / 2, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.09, pole, 8]} />
        <meshStandardMaterial color="#3b2416" roughness={0.7} />
      </mesh>
      <mesh position={[0, pole - 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, width + 0.4, 6]} />
        <meshStandardMaterial color="#3b2416" roughness={0.7} />
      </mesh>
      <mesh position={[0, pole + 0.18, 0]}>
        <coneGeometry args={[0.12, 0.4, 8]} />
        <meshStandardMaterial color="#b8860b" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, pole - 0.15 - height / 2, 0.02]}>
        <planeGeometry args={[width, height, 6, 18]} />
        <primitive object={mat} attach="material" />
      </mesh>
    </group>
  );
}
