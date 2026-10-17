import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky as SkyObject } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { LA, MAPS, laHeight, lakeE } from '../../maps';
import { seeded, GLSL_NOISE } from '../Scenery';
import { useTex, mergeGeos, branchGeo, bladeGeo, Clusters, Cluster, timeU, Clock } from './Coast';
import { LACity } from './LACity';

// ==================================================================
// 洛城午后: Los Angeles about 2000, late afternoon. Physical sky, a park
// HDR for the light, a lake ringed with palms, lawns of real blades,
// Spanish houses up the hill, an orange grove, the freeway and downtown
// (those two in LACity).
// ==================================================================

const BASE = (import.meta as any).env?.BASE_URL ?? '/';
const asset = (p: string) => `${BASE}${p}`.replace(/\/\/+/g, '/');
const SUN = new THREE.Vector3(...(MAPS.losangeles.sunDir as [number, number, number])).normalize();
const H = laHeight;

function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let tex: THREE.Texture | null = null;
    let alive = true;
    const prev = scene.environment;
    new HDRLoader().load(asset('coast/park.hdr'), (hdr: THREE.DataTexture) => {
      if (!alive) return;
      const pm = new THREE.PMREMGenerator(gl);
      tex = pm.fromEquirectangular(hdr).texture;
      hdr.dispose();
      pm.dispose();
      scene.environment = tex;
    });
    return () => {
      alive = false;
      if (scene.environment === tex) scene.environment = prev;
      tex?.dispose();
    };
  }, [gl, scene]);
  return null;
}

function SkyDome() {
  const sky = useMemo(() => {
    const s = new SkyObject();
    s.scale.setScalar(1000);
    const u = s.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.15;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.88;
    u.sunPosition.value.copy(SUN).multiplyScalar(400);
    if (u.cloudCoverage) {
      u.cloudCoverage.value = 0.12;
      u.cloudDensity.value = 0.3;
      u.cloudElevation.value = 0.55;
    }
    s.frustumCulled = false;
    s.renderOrder = -10;
    return s;
  }, []);
  useFrame((st) => {
    const u = sky.material.uniforms;
    if (u.time) u.time.value = st.clock.elapsedTime;
    sky.position.copy(st.camera.position);
  });
  return <primitive object={sky} />;
}

// ---------------------------------------------------------------
// the ground: lawns, paths, the lake bed, streets, the farm, the slope, the freeway's concrete
// ---------------------------------------------------------------
const GLSL_LA = /* glsl */ `
  float lakeE(vec2 p){ return length(vec2((p.x - ${LA.lake.x.toFixed(1)}) / ${LA.lake.rx.toFixed(1)}, (p.y - ${LA.lake.z.toFixed(1)}) / ${LA.lake.rz.toFixed(1)})); }
`;
function landMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    const streets = LA.streets.map((z) => `min(abs(p.y - (${z.toFixed(1)})), 99.0)`).join(', ');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWP; varying vec3 vWN;
        ${GLSL_NOISE}
        ${GLSL_LA}
        float fbm4(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.07) * 0.125 + noise(p * 8.1) * 0.0625; }
        float gHard;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = vWP.xz; vec3 n = normalize(vWN);
          float n1 = fbm4(p * 0.03); float n2 = fbm4(p * 0.25 + 5.0); float n3 = noise(p * 2.2);
          // lawn: watered green, with late-summer straw in the dry patches, mower stripes
          vec3 green = mix(vec3(0.16, 0.25, 0.07), vec3(0.24, 0.33, 0.10), n2);
          vec3 dry = mix(vec3(0.42, 0.37, 0.18), vec3(0.50, 0.44, 0.24), n3);
          vec3 col = mix(green, dry, smoothstep(0.55, 0.78, n1) * 0.8);
          col *= 0.93 + 0.07 * step(0.5, fract(p.x * 0.11));
          gHard = 0.0;
          // the lake bed (seen through the shallows) and its rim of concrete
          float e = lakeE(p);
          col = mix(col, vec3(0.20, 0.19, 0.13), 1.0 - smoothstep(0.98, 1.05, e));
          float rim = smoothstep(1.03, 1.06, e) * (1.0 - smoothstep(1.11, 1.14, e));
          // the path round the lake
          float path = smoothstep(1.15, 1.17, e) * (1.0 - smoothstep(1.25, 1.27, e));
          col = mix(col, vec3(0.62, 0.60, 0.56), rim);
          col = mix(col, mix(vec3(0.47, 0.45, 0.42), vec3(0.55, 0.53, 0.5), n3), path);
          gHard = max(rim, path);
          // the hillside streets, with sidewalks and kerbs
          float sd = min(min(${streets}), 99.0);
          float inTown = step(-84.0, p.x) * step(p.x, 134.0);
          float road = (1.0 - smoothstep(4.0, 4.2, sd)) * inTown;
          float walk = smoothstep(4.2, 4.3, sd) * (1.0 - smoothstep(6.0, 6.1, sd)) * inTown;
          vec3 asphalt = mix(vec3(0.15, 0.15, 0.16), vec3(0.22, 0.21, 0.21), n3);
          asphalt = mix(asphalt, vec3(0.75, 0.62, 0.2), (1.0 - smoothstep(0.05, 0.1, sd)) * step(0.5, fract(p.x * 0.1)));
          col = mix(col, asphalt, road);
          col = mix(col, vec3(0.66, 0.64, 0.6), walk);
          gHard = max(gHard, max(road, walk));
          // the farm: furrowed rows, darker soil under the grove
          float farm = step(${LA.farm.x0.toFixed(1)}, p.x) * step(p.x, ${LA.farm.x1.toFixed(1)}) * step(${LA.farm.z0.toFixed(1)}, p.y) * step(p.y, ${LA.farm.z1.toFixed(1)});
          float furrow = 0.5 + 0.5 * sin(p.x * 2.4);
          vec3 soil = mix(vec3(0.30, 0.22, 0.14), vec3(0.40, 0.31, 0.2), furrow * 0.6 + n3 * 0.4);
          vec3 crop = mix(vec3(0.22, 0.32, 0.08), vec3(0.32, 0.40, 0.12), n2);
          float field = step(${(LA.farm.z1 - 40).toFixed(1)}, p.y);
          col = mix(col, mix(soil, mix(soil, crop, smoothstep(0.3, 0.7, furrow)), field), farm);
          // the planted slope down to the freeway: ivy and ice plant
          float slope = smoothstep(150.0, 160.0, p.x) * (1.0 - step(${(LA.fwy.x0 - 2).toFixed(1)}, p.x));
          col = mix(col, mix(vec3(0.17, 0.26, 0.09), vec3(0.42, 0.30, 0.28), smoothstep(0.5, 0.75, n2)), slope);
          // the freeway's concrete and the city floor
          float fw = step(${(LA.fwy.x0 - 2).toFixed(1)}, p.x);
          vec3 conc = mix(vec3(0.52, 0.5, 0.46), vec3(0.6, 0.58, 0.54), n3);
          float inF = step(${LA.fwy.x0.toFixed(1)}, p.x) * step(p.x, ${LA.fwy.x1.toFixed(1)});
          float lane = fract((p.x - ${LA.fwy.x0.toFixed(1)}) / 3.6);
          float dash = step(0.55, fract(p.y * 0.083));
          float lines = (1.0 - smoothstep(0.015, 0.03, abs(lane - 0.5) - 0.47)) * dash;
          conc = mix(conc, vec3(0.92, 0.92, 0.9), lines * inF);
          col = mix(col, conc, fw);
          gHard = max(gHard, fw);
          // dirt where it's steep
          col = mix(col, vec3(0.38, 0.32, 0.24), smoothstep(0.35, 0.6, 1.0 - n.y) * (1.0 - gHard));
          diffuseColor.rgb = col;
        }`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.95, 0.8, gHard);');
  };
  return m;
}
function gridGeo(cx: number, cz: number, size: number, seg: number) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, 0, cz);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  return g;
}
function Land() {
  const mat = useMemo(() => landMaterial(), []);
  const near = useMemo(() => gridGeo(20, -10, 420, 380), []);
  const far = useMemo(() => {
    const g = gridGeo(300, 0, 3000, 260);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - 20) < 205 && Math.abs(p.getZ(i) + 10) < 205) p.setY(i, p.getY(i) - 0.5);
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={near} material={mat} receiveShadow />
      <mesh geometry={far} material={mat} receiveShadow />
    </group>
  );
}

// ---------------------------------------------------------------
// the lake: green-brown water with the sky in it, the fountain, lotus, paddle boats
// ---------------------------------------------------------------
function Lake() {
  const normals = useTex('coast/waternormals.jpg', false);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uTime: { value: 0 }, uN: { value: normals }, uSun: { value: SUN } },
        vertexShader: /* glsl */ `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform sampler2D uN; uniform vec3 uSun; varying vec3 vWP;
          void main(){
            vec2 uv = vWP.xz;
            vec3 a = texture2D(uN, uv * 0.04 + vec2(uTime * 0.01, uTime * 0.006)).xzy * 2.0 - 1.0;
            vec3 b = texture2D(uN, uv * 0.13 - vec2(uTime * 0.016, -uTime * 0.01)).xzy * 2.0 - 1.0;
            vec3 n = normalize(vec3(0.0, 1.0, 0.0) + vec3(a.x + b.x, 0.0, a.z + b.z) * 0.18);
            vec3 V = normalize(cameraPosition - vWP);
            float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            vec3 R = reflect(-V, n);
            vec3 sky = mix(vec3(0.78, 0.82, 0.84), vec3(0.22, 0.45, 0.8), pow(clamp(R.y, 0.0, 1.0), 0.5));
            float spec = pow(max(dot(R, uSun), 0.0), 500.0) * 30.0;
            vec3 body = vec3(0.10, 0.17, 0.11);
            vec3 col = mix(body, sky, fres) + vec3(1.0, 0.95, 0.85) * spec;
            gl_FragColor = vec4(col, 0.86 + fres * 0.14);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [normals]
  );
  const L = LA.lake;
  const { pads, boats } = useMemo(() => {
    const rand = seeded(13);
    // lotus beds along the north shore
    const pads = new THREE.InstancedMesh(new THREE.CircleGeometry(0.55, 14, 0.25, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4d6b2a', roughness: 0.6, side: THREE.DoubleSide }), 900);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    let i = 0;
    for (let k = 0; k < 4000 && i < 900; k++) {
      const a = Math.PI * (1.15 + rand() * 0.7);
      const e = 0.62 + rand() * 0.33;
      const x = L.x + Math.cos(a) * e * L.rx;
      const z = L.z + Math.sin(a) * e * L.rz;
      if (Math.sin(x * 0.2) * Math.cos(z * 0.25) < -0.2) continue;
      const s = 0.6 + rand() * 0.9;
      m.compose(new THREE.Vector3(x, L.water + 0.02, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28), new THREE.Vector3(s, 1, s));
      pads.setMatrixAt(i, m);
      col.setHSL(0.22 + rand() * 0.06, 0.4, 0.28 + rand() * 0.12);
      pads.setColorAt(i, col);
      i++;
    }
    pads.count = i;
    const boats = Array.from({ length: 6 }, (_, k) => ({ a: (k / 6) * Math.PI * 2, e: 0.45 + (k % 3) * 0.1, w: 0.012 + rand() * 0.01, c: ['#f2efe8', '#2f6db0', '#d24a3a', '#f0c23a', '#3a9a6a', '#f2efe8'][k] }));
    return { pads, boats };
  }, []);
  const boatRefs = useRef<(THREE.Group | null)[]>([]);
  const jet = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    mat.uniforms.uTime.value = t;
    boats.forEach((b, k) => {
      const g = boatRefs.current[k];
      if (!g) return;
      const a = b.a + t * b.w;
      g.position.set(L.x + Math.cos(a) * b.e * L.rx, L.water + 0.05 + Math.sin(t * 1.3 + k) * 0.03, L.z + Math.sin(a) * b.e * L.rz);
      g.rotation.y = -a;
    });
    if (jet.current) jet.current.scale.y = 1 + Math.sin(t * 2.3) * 0.05;
  });
  return (
    <group>
      <mesh position={[L.x, L.water, L.z]} rotation={[-Math.PI / 2, 0, 0]} scale={[L.rx * 1.1, L.rz * 1.1, 1]} material={mat} renderOrder={2}>
        <circleGeometry args={[1, 96]} />
      </mesh>
      <primitive object={pads} />
      {/* the fountain: a tall jet and its spray */}
      <group ref={jet} position={[L.x + 4, L.water, L.z - 2]}>
        <mesh position={[0, 7, 0]}>
          <cylinderGeometry args={[0.12, 0.45, 14, 12, 1, true]} />
          <meshStandardMaterial color="#f4f8fa" transparent opacity={0.55} roughness={0.2} depthWrite={false} />
        </mesh>
        <mesh position={[0, 13.5, 0]}>
          <sphereGeometry args={[1.6, 16, 10]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.28} roughness={0.3} depthWrite={false} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[3.5, 3.5, 0.6, 32, 1, true]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.35} depthWrite={false} />
        </mesh>
      </group>
      {boats.map((b, k) => (
        <group key={k} ref={(el) => (boatRefs.current[k] = el)}>
          <mesh position={[0, 0.25, 0]} castShadow>
            <boxGeometry args={[1.6, 0.5, 2.6]} />
            <meshStandardMaterial color={b.c} roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.0, -0.2]} castShadow>
            <boxGeometry args={[1.4, 0.08, 1.6]} />
            <meshStandardMaterial color="#e8e2d4" roughness={0.6} />
          </mesh>
          {[-0.6, 0.6].map((x) => (
            <mesh key={x} position={[x, 0.65, -0.2]}>
              <cylinderGeometry args={[0.04, 0.04, 0.7, 6]} />
              <meshStandardMaterial color="#cfcfcf" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// palms: Mexican fan palms (very tall, thin, a skirt of dead fronds under a small crown) and queen palms
// ---------------------------------------------------------------
function fanTexture(dead = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(dead ? 3 : 7);
  g.clearRect(0, 0, 256, 256);
  // a fan of stiff segments from the hastula at the bottom, their tips split and drooping
  for (let k = 0; k < 46; k++) {
    const a = Math.PI * (1.05 + (k / 45) * 0.9);
    const L = 110 + rand() * 18;
    const x1 = 128 + Math.cos(a) * L;
    const y1 = 236 + Math.sin(a) * L;
    g.strokeStyle = dead ? `hsl(${30 + rand() * 10}, ${30 + rand() * 15}%, ${32 + rand() * 14}%)` : `hsl(${95 + rand() * 25}, ${35 + rand() * 20}%, ${26 + rand() * 16}%)`;
    g.lineWidth = 5 + rand() * 2;
    g.beginPath();
    g.moveTo(128, 236);
    g.lineTo(x1, y1);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x1 + Math.cos(a + 0.4) * 18, y1 + 14);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function pinnateTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 512;
  const g = c.getContext('2d')!;
  const rand = seeded(11);
  g.clearRect(0, 0, 64, 512);
  g.strokeStyle = '#6b6a3a';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(32, 0);
  g.lineTo(32, 512);
  g.stroke();
  for (let y = 8; y < 506; y += 6) {
    const L = 30 * Math.sin((y / 512) * Math.PI) + 4;
    for (const s of [-1, 1]) {
      g.strokeStyle = `hsl(${85 + rand() * 25}, ${40 + rand() * 20}%, ${24 + rand() * 14}%)`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(32, y);
      g.quadraticCurveTo(32 + s * L * 0.6, y + 4, 32 + s * L, y + 12);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function ringBarkTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(19);
  g.fillStyle = '#7a6f62';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 5 + rand() * 4) {
    g.fillStyle = `rgba(${50 + rand() * 30},${44 + rand() * 25},${36 + rand() * 20},${0.4 + rand() * 0.4})`;
    g.fillRect(0, y, 64, 1.5 + rand() * 1.5);
  }
  for (let k = 0; k < 300; k++) {
    g.fillStyle = `rgba(${150 + rand() * 50},${140 + rand() * 40},${120 + rand() * 40},0.15)`;
    g.fillRect(rand() * 64, rand() * 256, 3 + rand() * 8, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 6);
  return t;
}
function cardMat(tex: THREE.Texture, color = '#ffffff') {
  const m = new THREE.MeshStandardMaterial({ map: tex, color, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.75 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xyz;
        #endif
        float k = max(position.y, 0.0);
        transformed.x += sin(uTime * 1.4 + ip.x * 0.3 + ip.z * 0.2) * 0.06 * k;
      }`
    );
  };
  return m;
}
function Palms() {
  const bark = useMemo(() => ringBarkTexture(), []);
  const { trunks, fans, dead, fronds } = useMemo(() => {
    const rand = seeded(29);
    const trunkParts: THREE.BufferGeometry[] = [];
    const frondParts: THREE.BufferGeometry[] = [];
    const fanList: THREE.Matrix4[] = [];
    const deadList: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const [x, z, h, kind] of LA.palms) {
      const y0 = H(x, z) - 0.2;
      const lean = new THREE.Vector3((rand() - 0.5) * 0.08, 1, (rand() - 0.5) * 0.08).normalize();
      const top = new THREE.Vector3(x, y0, z).addScaledVector(lean, h);
      const mid = new THREE.Vector3(x, y0, z).addScaledVector(lean, h * 0.5).add(new THREE.Vector3((rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5));
      if (kind === 0) {
        trunkParts.push(branchGeo([new THREE.Vector3(x, y0, z), mid, top], 0.42, 0.24, 10, 8));
        // the crown: ~22 fans on stalks, splaying out and drooping at the bottom
        for (let k = 0; k < 22; k++) {
          const a = rand() * Math.PI * 2;
          const tilt = 0.2 + rand() * 1.4; // 0 = straight up
          const dir = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
          const at = top.clone().addScaledVector(dir, 1.3);
          e.set(0, 0, 0);
          q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          const spin = new THREE.Quaternion().setFromAxisAngle(dir, rand() * 6.28);
          const s = 2.4 + rand() * 0.6;
          fanList.push(new THREE.Matrix4().compose(at, spin.multiply(q), new THREE.Vector3(s, s, s)));
        }
        // the skirt of old fronds hanging down the trunk
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2 + rand() * 0.3;
          const dir = new THREE.Vector3(Math.cos(a) * 0.35, -1, Math.sin(a) * 0.35).normalize();
          q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          const s = 2.0 + rand() * 0.5;
          deadList.push(new THREE.Matrix4().compose(top.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, -0.6 - rand() * 0.8, Math.sin(a) * 0.3)), q, new THREE.Vector3(s, s, s)));
        }
      } else {
        // queen palm: a shorter smooth grey trunk, long arching feathery fronds
        trunkParts.push(branchGeo([new THREE.Vector3(x, y0, z), mid, top], 0.3, 0.22, 8, 8));
        for (let k = 0; k < 13; k++) {
          const a = rand() * Math.PI * 2;
          const L = 4 + rand() * 1.2;
          const up = 0.4 + rand() * 0.9;
          const pts: THREE.Vector3[] = [];
          for (let i = 0; i <= 8; i++) {
            const t = i / 8;
            pts.push(top.clone().add(new THREE.Vector3(Math.cos(a) * L * t, up * L * t - 1.8 * L * t * t * 0.55, Math.sin(a) * L * t)));
          }
          // a strip along the arch, its width across the frond
          const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
          const pos: number[] = [];
          const uv: number[] = [];
          const idx: number[] = [];
          pts.forEach((p, i) => {
            const w = 0.85;
            pos.push(p.x - side.x * w, p.y - 0.05, p.z - side.z * w, p.x + side.x * w, p.y - 0.05, p.z + side.z * w);
            uv.push(0, i / 8, 1, i / 8);
            if (i < 8) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
          });
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          g.setIndex(idx);
          g.computeVertexNormals();
          frondParts.push(g);
        }
      }
    }
    const fanGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const fans = new THREE.InstancedMesh(fanGeo, cardMat(fanTexture(false), '#c8d4a8'), fanList.length);
    fanList.forEach((m, i) => fans.setMatrixAt(i, m));
    fans.castShadow = true;
    const dead = new THREE.InstancedMesh(fanGeo, cardMat(fanTexture(true), '#d8c4a4'), deadList.length);
    deadList.forEach((m, i) => dead.setMatrixAt(i, m));
    dead.castShadow = true;
    return { trunks: mergeGeos(trunkParts), fans, dead, fronds: mergeGeos(frondParts) };
  }, []);
  const frondMat = useMemo(() => cardMat(pinnateTexture(), '#c8d0a0'), []);
  return (
    <group>
      <mesh geometry={trunks} castShadow receiveShadow>
        <meshStandardMaterial map={bark} roughness={0.95} />
      </mesh>
      <primitive object={fans} />
      <primitive object={dead} />
      <mesh geometry={fronds} material={frondMat} castShadow />
    </group>
  );
}

// ---------------------------------------------------------------
// lawns of real blades round the lake and through the park; flower beds; shade trees
// ---------------------------------------------------------------
function lawnBladeMat() {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.uniforms.uSun = { value: SUN };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying float vTip; varying vec3 vFW;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float k = position.y * position.y; vTip = position.y;
          transformed.z += (sin(ip.x * 0.12 - uTime * 1.2) * 0.5 + 0.5) * 0.18 * k + sin(uTime * 3.0 + ip.x * 2.0 + ip.z) * 0.04 * k;
          vec4 w = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            w = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          vFW = w.xyz;
        }`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun; varying float vTip; varying vec3 vFW;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= mix(0.45, 1.1, vTip);')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        { vec3 V = normalize(cameraPosition - vFW); float back = pow(max(dot(-V, uSun), 0.0), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(0.9, 1.0, 0.5) * back * vTip * 1.4; }`
      );
  };
  return m;
}
function Lawn() {
  const mesh = useMemo(() => {
    const rand = seeded(41);
    const N = 240000;
    const im = new THREE.InstancedMesh(bladeGeo(), lawnBladeMat(), N);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const e = new THREE.Euler();
    let i = 0;
    const F = LA.farm;
    for (let k = 0; k < N * 3 && i < N; k++) {
      const r = Math.pow(rand(), 0.55) * 150;
      const a = rand() * Math.PI * 2;
      const x = 10 + Math.cos(a) * r;
      const z = -5 + Math.sin(a) * r;
      if (lakeE(x, z) < 1.28 && lakeE(x, z) > 1.0) continue; // paths and the rim
      if (lakeE(x, z) <= 1.0) continue;
      if (x > 150 || z < -84) continue; // the slope and the hillside town
      if (x > F.x0 && x < F.x1 && z > F.z0 && z < F.z1) continue;
      const h = 0.12 + rand() * 0.14;
      e.set((rand() - 0.5) * 0.6, rand() * 6.28, (rand() - 0.5) * 0.6);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, H(x, z) - 0.02, z), q, new THREE.Vector3(1.2 + rand(), h, 1));
      im.setMatrixAt(i, m);
      const dry = Math.max(0, Math.sin(x * 0.05 + 0.3) * Math.cos(z * 0.04 - 0.5));
      col.setHSL(0.24 - dry * 0.1 + rand() * 0.03, 0.45 - dry * 0.15, 0.3 + rand() * 0.12 + dry * 0.1);
      im.setColorAt(i, col);
      i++;
    }
    im.count = i;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }, []);
  return <primitive object={mesh} />;
}
/** broad glossy leaves, now and then a blossom (oleander pink, bougainvillea magenta), as a clump card */
function shrubCard(blossom: string | null, seed: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(seed);
  g.clearRect(0, 0, 256, 256);
  for (let k = 0; k < 340; k++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.7) * 110;
    g.save();
    g.translate(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.8);
    g.rotate(rand() * Math.PI);
    g.fillStyle = `hsl(${95 + rand() * 30}, ${35 + rand() * 25}%, ${20 + rand() * 22}%)`;
    g.beginPath();
    g.ellipse(0, 0, 9 + rand() * 6, 3 + rand() * 2, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  if (blossom)
    for (let k = 0; k < 70; k++) {
      const a = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 0.5) * 105;
      g.fillStyle = blossom;
      g.beginPath();
      g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.8, 3 + rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function Shrubs() {
  const { beds, shade, orange } = useMemo(() => {
    const rand = seeded(43);
    const beds: Cluster[] = [];
    for (const [x, z, r] of LA.beds) for (let k = 0; k < 3; k++) beds.push({ c: new THREE.Vector3(x + (rand() - 0.5) * r, H(x, z) + 0.7, z + (rand() - 0.5) * r), r: new THREE.Vector3(r * 0.6, 0.7, r * 0.6), n: 26, flat: 0 });
    // hedges and shrubs along the slope and round the houses
    for (const h of LA.houses) for (let k = 0; k < 2; k++) beds.push({ c: new THREE.Vector3(h.x + (rand() - 0.5) * h.w, h.y + 0.8, h.z + (h.z > -116 ? 1 : -1) * (h.d / 2 + 1.5)), r: new THREE.Vector3(1.6, 0.9, 1.0), n: 16, flat: 0 });
    for (let k = 0; k < 90; k++) {
      const x = 152 + rand() * 30;
      const z = -160 + rand() * 320;
      beds.push({ c: new THREE.Vector3(x, H(x, z) + 1, z), r: new THREE.Vector3(2.2, 1.2, 2.2), n: 16, flat: 0 });
    }
    // ficus and jacaranda shade trees about the park and on the hill
    const shade: Cluster[] = [];
    for (let k = 0; k < 2000 && shade.length < 180; k++) {
      const x = -80 + rand() * 225;
      const z = -165 + rand() * 300;
      if (lakeE(x, z) < 1.4 || LA.streets.some((s) => Math.abs(z - s) < 8)) continue;
      if (LA.houses.some((h) => Math.abs(x - h.x) < h.w / 2 + 3 && Math.abs(z - h.z) < h.d / 2 + 3)) continue;
      if (LA.palms.some(([px, pz]) => Math.hypot(px - x, pz - z) < 6)) continue;
      if (z > -84 && Math.hypot(x - 60, z - 10) < 70 && rand() < 0.75) continue; // keep the fighting ground open
      const y = H(x, z);
      const s = 0.8 + rand() * 0.7;
      for (let c = 0; c < 3; c++) shade.push({ c: new THREE.Vector3(x + (rand() - 0.5) * 3 * s, y + 5 * s + rand() * 1.5 * s, z + (rand() - 0.5) * 3 * s), r: new THREE.Vector3(3 * s, 2 * s, 3 * s), n: 22, flat: 0.1 });
    }
    // the orange grove: round dark trees hung with fruit
    const orange: Cluster[] = LA.grove.map(([x, z]) => ({ c: new THREE.Vector3(x, H(x, z) + 1.9, z), r: new THREE.Vector3(1.8, 1.5, 1.8), n: 18, flat: 0 }));
    return { beds, shade, orange };
  }, []);
  const tex = useMemo(() => ({ pink: shrubCard('#e8618c', 3), plain: shrubCard(null, 5), orange: shrubCard('#f08a1c', 7) }), []);
  return (
    <group>
      <ClustersTex clusters={beds} tex={tex.pink} tint="#d8e0c8" size={1.1} />
      <ClustersTex clusters={shade} tex={tex.plain} tint="#b8c4a0" size={2.4} />
      <ClustersTex clusters={orange} tex={tex.orange} tint="#c8d0b0" size={1.2} />
      <GroveTrunks />
    </group>
  );
}
/** Clusters, with a chosen card texture */
function ClustersTex({ clusters, tex, tint, size }: { clusters: Cluster[]; tex: THREE.Texture; tint: string; size: number }) {
  const mesh = useMemo(() => {
    const rand = seeded(clusters.length + 11);
    let total = 0;
    for (const c of clusters) total += c.n;
    const m = cardMat(tex, tint);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), m, total);
    const mm = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const col = new THREE.Color();
    let i = 0;
    for (const c of clusters)
      for (let k = 0; k < c.n; k++) {
        const u = rand() * 2 - 1;
        const th = rand() * Math.PI * 2;
        const rr = Math.pow(rand(), 0.4);
        const sxz = Math.sqrt(1 - u * u);
        const p = new THREE.Vector3(c.c.x + Math.cos(th) * sxz * rr * c.r.x, c.c.y + u * rr * c.r.y, c.c.z + Math.sin(th) * sxz * rr * c.r.z);
        e.set(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI);
        q.setFromEuler(e);
        const s = size * (0.7 + rand() * 0.6);
        mm.compose(p, q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, mm);
        const lit = 0.55 + rr * 0.3 + (p.y - c.c.y) / Math.max(0.1, c.r.y) * 0.12;
        col.setRGB(lit, lit, lit * 0.95);
        im.setColorAt(i, col);
        i++;
      }
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }, [clusters, tex, tint, size]);
  void Clusters;
  return <primitive object={mesh} />;
}
function GroveTrunks() {
  const geo = useMemo(() => mergeGeos(LA.grove.map(([x, z]) => branchGeo([new THREE.Vector3(x, H(x, z) - 0.1, z), new THREE.Vector3(x + 0.1, H(x, z) + 0.6, z), new THREE.Vector3(x, H(x, z) + 1.1, z + 0.1)], 0.13, 0.08, 3, 5))), []);
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#5a4632" roughness={0.95} />
    </mesh>
  );
}

// ---------------------------------------------------------------
// the farm's barn and windmill
// ---------------------------------------------------------------
function Farm() {
  const [bx, bz] = LA.barn;
  const [mx, mz] = LA.mill;
  const wheel = useRef<THREE.Group>(null);
  const barn = useMemo(() => {
    // a gambrel roof: the classic barn profile, extruded
    const s = new THREE.Shape();
    s.moveTo(-7, 0);
    s.lineTo(-7, 6);
    s.lineTo(-5.2, 9.2);
    s.lineTo(0, 11.2);
    s.lineTo(5.2, 9.2);
    s.lineTo(7, 6);
    s.lineTo(7, 0);
    s.lineTo(-7, 0);
    const body = new THREE.ExtrudeGeometry(s, { depth: 20, bevelEnabled: false });
    body.translate(0, 0, -10);
    const roof = new THREE.Shape();
    roof.moveTo(-7.4, 5.8);
    roof.lineTo(-5.4, 9.5);
    roof.lineTo(0, 11.6);
    roof.lineTo(5.4, 9.5);
    roof.lineTo(7.4, 5.8);
    roof.lineTo(7.0, 5.8);
    roof.lineTo(5.1, 9.1);
    roof.lineTo(0, 11.0);
    roof.lineTo(-5.1, 9.1);
    roof.lineTo(-7.0, 5.8);
    const r = new THREE.ExtrudeGeometry(roof, { depth: 20.8, bevelEnabled: false });
    r.translate(0, 0, -10.4);
    return { body, roof: r };
  }, []);
  useFrame((st) => {
    if (wheel.current) wheel.current.rotation.z = st.clock.elapsedTime * 0.9;
  });
  const by = H(bx, bz);
  const my = H(mx, mz);
  return (
    <group>
      <group position={[bx, by, bz]}>
        <mesh geometry={barn.body} castShadow receiveShadow>
          <meshStandardMaterial color="#9b2c22" roughness={0.85} />
        </mesh>
        <mesh geometry={barn.roof} castShadow>
          <meshStandardMaterial color="#5b5652" roughness={0.6} metalness={0.3} />
        </mesh>
        {/* white trim: the big doors' X braces at both ends */}
        {[-10.05, 10.05].map((z) => (
          <group key={z} position={[0, 0, z]}>
            <mesh position={[0, 2.6, 0]}>
              <boxGeometry args={[5.4, 5.2, 0.12]} />
              <meshStandardMaterial color="#8a2a20" roughness={0.85} />
            </mesh>
            {[0.62, -0.62].map((a) => (
              <mesh key={a} position={[0, 2.6, z > 0 ? 0.08 : -0.08]} rotation={[0, 0, a]}>
                <boxGeometry args={[0.25, 7.0, 0.06]} />
                <meshStandardMaterial color="#f2efe8" />
              </mesh>
            ))}
            <mesh position={[0, 7.6, z > 0 ? 0.06 : -0.06]}>
              <boxGeometry args={[1.6, 1.6, 0.06]} />
              <meshStandardMaterial color="#f2efe8" />
            </mesh>
          </group>
        ))}
      </group>
      {/* the windmill: a lattice tower, a many-bladed wheel turning in the breeze */}
      <group position={[mx, my, mz]}>
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz], k) => (
          <mesh key={k} position={[sx * 0.9, 6, sz * 0.9]} rotation={[sz * 0.12, 0, -sx * 0.12]}>
            <cylinderGeometry args={[0.06, 0.08, 12.2, 5]} />
            <meshStandardMaterial color="#9a9890" metalness={0.6} roughness={0.5} />
          </mesh>
        ))}
        <group ref={wheel} position={[0, 12.4, 0.6]}>
          {Array.from({ length: 18 }, (_, k) => (
            <mesh key={k} rotation={[0, 0, (k / 18) * Math.PI * 2]} position={[0, 0, 0]}>
              <boxGeometry args={[0.32, 3.4, 0.03]} />
              <meshStandardMaterial color="#c9c6be" metalness={0.5} roughness={0.4} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
        <mesh position={[0, 12.4, -1.4]}>
          <boxGeometry args={[0.05, 1.4, 2.4]} />
          <meshStandardMaterial color="#c9c6be" metalness={0.5} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

export function LAMap() {
  return (
    <group>
      <Clock />
      <Environment />
      <SkyDome />
      <Land />
      <Lake />
      <Lawn />
      <Palms />
      <Shrubs />
      <Farm />
      <LACity />
    </group>
  );
}
