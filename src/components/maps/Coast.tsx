import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky as SkyObject } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { COAST, MAPS, coastHeight, coastX, roadX, roadHeight } from '../../maps';
import { seeded, GLSL_NOISE } from '../Scenery';

// ==================================================================
// 落日海岸 at golden hour. Real-world scanned cliffs and rocks (Poly Haven
// scans, from the Babylon.js asset library), an HDR sunset for the light,
// a physical sky, an ocean with sun glitter, golden wild-oat grass lit
// from behind, wind-bent cypresses, oaks on the hills, Highway 1 and its
// arched bridge, the lighthouse on the point.
// ==================================================================

const BASE = (import.meta as any).env?.BASE_URL ?? '/';
const asset = (p: string) => `${BASE}${p}`.replace(/\/\/+/g, '/');
const SUN = new THREE.Vector3(...(MAPS.coast.sunDir as [number, number, number])).normalize();
const H = coastHeight;
const SEA = COAST.sea;

const GLSL_COAST = /* glsl */ `
  float coastX(float z){ return -30.0 + 5.0 * sin(z * 0.06 + 0.5) + 2.5 * sin(z * 0.15 + 2.0) - 17.0 * exp(-pow((z - ${COAST.lighthouse[1].toFixed(1)}) / 15.0, 2.0)); }
  float roadX(float z){ return ${COAST.road.x.toFixed(1)} + 7.0 * sin(z * 0.012 + 0.8) + 3.0 * sin(z * 0.031); }
`;

// ---------------------------------------------------------------
// shared loading
// ---------------------------------------------------------------
let gltfP: Promise<any> | null = null;
function loadCliffs(gl: THREE.WebGLRenderer) {
  if (gltfP) return gltfP;
  const draco = new DRACOLoader().setDecoderPath(asset('libs/draco/'));
  const ktx2 = new KTX2Loader().setTranscoderPath(asset('libs/basis/')).detectSupport(gl);
  const l = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);
  gltfP = l.loadAsync(asset('coast/cliffs.glb'));
  return gltfP;
}
/** a part of the scan scene, with its node transform baked in, sitting on y = 0 and centred in x/z */
function part(g: any, name: string): { geo: THREE.BufferGeometry; mat: THREE.Material; size: THREE.Vector3; face: THREE.Vector3 } | null {
  g.scene.updateMatrixWorld(true);
  let found: THREE.Mesh | null = null;
  g.scene.traverse((o: any) => {
    if (!found && o.isMesh && (o.name === name || o.parent?.name === name)) found = o;
  });
  if (!found) return null;
  const m = found as THREE.Mesh;
  const geo = m.geometry.clone();
  geo.applyMatrix4(m.matrixWorld);
  // the node flips (scale -1) can turn faces inside out: fix the winding if so
  if (m.matrixWorld.determinant() < 0 && geo.index) {
    const a = geo.index.array as any;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    geo.index.needsUpdate = true;
  }
  geo.computeBoundingBox();
  const b = geo.boundingBox!;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const size = new THREE.Vector3();
  geo.boundingBox!.getSize(size);
  // which way the face looks: area-weighted mean of the horizontal normals
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const face = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) face.x += n.getX(i), face.z += n.getZ(i);
  face.y = 0;
  if (face.lengthSq() < 1e-6) face.set(0, 0, 1);
  face.normalize();
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  return { geo, mat, size, face };
}

// ---------------------------------------------------------------
// light: an HDR sunset for reflections and fill (the sky itself is the physical one below)
// ---------------------------------------------------------------
function Environment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    let tex: THREE.Texture | null = null;
    let alive = true;
    const prev = scene.environment;
    new HDRLoader().load(asset('coast/sunset.hdr'), (hdr: THREE.DataTexture) => {
      if (!alive) return;
      const pm = new THREE.PMREMGenerator(gl);
      tex = pm.fromEquirectangular(hdr).texture;
      hdr.dispose();
      pm.dispose();
      scene.environment = tex;
      (scene as any).environmentRotation = new THREE.Euler(0, Math.PI * 0.55, 0); // its sun round to the west
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
    u.turbidity.value = 4;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.0035;
    u.mieDirectionalG.value = 0.93;
    u.sunPosition.value.copy(SUN).multiplyScalar(400);
    if (u.cloudCoverage) {
      u.cloudCoverage.value = 0.32;
      u.cloudDensity.value = 0.45;
      u.cloudElevation.value = 0.42;
      u.cloudScale.value = 0.00018;
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
// the land: golden grass, green in the hollows, rock on the cliffs, the road
// ---------------------------------------------------------------
function useTex(path: string, srgb = true, rep = 1) {
  return useMemo(() => {
    const t = new THREE.TextureLoader().load(asset(path));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep, rep);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, [path]);
}
function landMaterial(rock: THREE.Texture, rockN: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRock = { value: rock };
    sh.uniforms.uRockN = { value: rockN };
    sh.uniforms.uSun = { value: SUN };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uRock; uniform sampler2D uRockN; uniform vec3 uSun;
        varying vec3 vWP; varying vec3 vWN;
        ${GLSL_NOISE}
        ${GLSL_COAST}
        float fbm4(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.07) * 0.125 + noise(p * 8.1) * 0.0625; }
        vec3 triRock(vec3 p, vec3 n){ vec3 b = pow(abs(n), vec3(4.0)); b /= (b.x + b.y + b.z);
          return texture2D(uRock, p.zy * 0.11).rgb * b.x + texture2D(uRock, p.xz * 0.11).rgb * b.y + texture2D(uRock, p.xy * 0.11).rgb * b.z; }
        float gRock; float gRoad;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 p = vWP; vec3 n = normalize(vWN);
          float slope = 1.0 - n.y;
          float n1 = fbm4(p.xz * 0.035); float n2 = fbm4(p.xz * 0.22 + 7.0); float n3 = noise(p.xz * 1.7);
          // dry wild-oat gold, straw in the light patches, olive where it holds water
          vec3 straw = mix(vec3(0.42, 0.32, 0.15), vec3(0.58, 0.45, 0.22), n2);
          straw = mix(straw, vec3(0.70, 0.56, 0.30), n3 * 0.35);
          vec3 olive = mix(vec3(0.33, 0.33, 0.14), vec3(0.42, 0.40, 0.18), n2);
          float wet = smoothstep(0.58, 0.75, n1) * (1.0 - smoothstep(0.25, 0.5, slope));
          vec3 col = mix(straw, olive, wet * 0.75);
          // trodden paths across the meadow
          float path = 1.0 - smoothstep(0.0, 0.035, abs(fbm4(p.xz * 0.02 + 3.0) - 0.5));
          col = mix(col, mix(vec3(0.52, 0.42, 0.30), vec3(0.62, 0.52, 0.38), n3), path * 0.7 * step(p.x, 45.0));
          // rock wherever it's steep, darker and wet at the bottom
          vec3 rk = triRock(p, n) * vec3(1.05, 0.95, 0.85) * 1.15;
          gRock = smoothstep(0.32, 0.55, slope + (n2 - 0.5) * 0.25);
          col = mix(col, rk, gRock);
          col = mix(col, rk * 0.45, (1.0 - smoothstep(${(SEA - 0.5).toFixed(1)}, ${(SEA + 3.5).toFixed(1)}, p.y)) * 0.85);
          // a pocket beach where the canyon meets the sea
          float sand = (1.0 - smoothstep(${(SEA + 0.6).toFixed(1)}, ${(SEA + 2.4).toFixed(1)}, p.y)) * (1.0 - gRock) * step(p.x, 30.0);
          col = mix(col, mix(vec3(0.78, 0.69, 0.55), vec3(0.88, 0.80, 0.66), n3), sand);
          // Highway 1: asphalt, a double yellow line, white edges
          float rx = p.x - roadX(p.z);
          gRoad = 1.0 - smoothstep(${(COAST.road.half - 0.3).toFixed(1)}, ${(COAST.road.half + 0.1).toFixed(1)}, abs(rx));
          vec3 asphalt = mix(vec3(0.17, 0.17, 0.18), vec3(0.24, 0.23, 0.23), n3);
          float dash = step(0.5, fract(p.z * 0.08));
          float yellow = (smoothstep(0.08, 0.04, abs(abs(rx) - 0.14)));
          float white = smoothstep(0.1, 0.05, abs(abs(rx) - ${(COAST.road.half - 0.45).toFixed(2)}));
          asphalt = mix(asphalt, vec3(0.85, 0.66, 0.15), yellow);
          asphalt = mix(asphalt, vec3(0.85, 0.85, 0.82), white);
          col = mix(col, asphalt, gRoad);
          diffuseColor.rgb = col;
        }`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(0.95, 0.8, gRock), 0.7, gRoad);')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // rock detail from the normal map (triplanar, world space), and grain in the grass
          vec3 nW = normalize(vWN);
          vec3 b = pow(abs(nW), vec3(4.0)); b /= (b.x + b.y + b.z);
          vec3 tx = texture2D(uRockN, vWP.zy * 0.11).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(uRockN, vWP.xz * 0.11).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(uRockN, vWP.xy * 0.11).xyz * 2.0 - 1.0;
          vec3 pert = vec3(0.0, tx.y, tx.x) * b.x + vec3(ty.x, 0.0, ty.y) * b.y + vec3(tz.x, tz.y, 0.0) * b.z;
          vec3 nP = normalize(nW + pert * (0.25 + gRock * 0.9) * (1.0 - gRoad));
          normal = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
        }`
      );
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
  const rock = useTex('coast/rock.jpg');
  const rockN = useTex('coast/rock_n.jpg', false);
  const mat = useMemo(() => landMaterial(rock, rockN), [rock, rockN]);
  const near = useMemo(() => gridGeo(10, 0, 240, 300), []);
  const far = useMemo(() => {
    const g = gridGeo(250, 0, 1500, 300);
    // tuck it under the near patch so the two don't fight
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      if (Math.abs(x - 10) < 118 && Math.abs(z) < 118) p.setY(i, p.getY(i) - 0.6);
    }
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={near} material={mat} receiveShadow castShadow />
      <mesh geometry={far} material={mat} receiveShadow />
    </group>
  );
}

// ---------------------------------------------------------------
// the Pacific: swell, sun glitter, the sky in it, surf at the foot of the cliffs
// ---------------------------------------------------------------
function Ocean() {
  const normals = useTex('coast/waternormals.jpg', false);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: false,
        uniforms: {
          uTime: { value: 0 },
          uN: { value: normals },
          uSun: { value: SUN },
          uFog: { value: new THREE.Color(MAPS.coast.background) },
          uFogFar: { value: 1400 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime; varying vec3 vWP; varying float vCrest;
          void main(){
            vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
            // long swell rolling in from the west, and a cross sea
            float w = sin(p.x * 0.045 + uTime * 0.7) * 0.55 + sin(p.x * 0.09 + p.z * 0.03 + uTime * 1.1) * 0.25 + sin(p.z * 0.07 - p.x * 0.02 + uTime * 0.8) * 0.18;
            p.y += w; vCrest = w;
            vWP = p;
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform sampler2D uN; uniform vec3 uSun; uniform vec3 uFog; uniform float uFogFar;
          varying vec3 vWP; varying float vCrest;
          ${GLSL_COAST}
          vec3 skyCol(vec3 d){
            // a sunset sky to reflect: gold low down toward the sun, blue overhead
            float up = clamp(d.y, 0.0, 1.0);
            float toSun = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
            vec3 horizon = mix(vec3(0.95, 0.66, 0.45), vec3(1.0, 0.62, 0.30), pow(toSun, 3.0));
            vec3 zenith = vec3(0.26, 0.42, 0.66);
            return mix(horizon, zenith, pow(up, 0.55));
          }
          void main(){
            vec2 uv = vWP.xz;
            vec3 n1 = texture2D(uN, uv * 0.012 + vec2(uTime * 0.008, uTime * 0.004)).xzy * 2.0 - 1.0;
            vec3 n2 = texture2D(uN, uv * 0.031 - vec2(uTime * 0.012, -uTime * 0.007)).xzy * 2.0 - 1.0;
            vec3 n3 = texture2D(uN, uv * 0.11 + vec2(uTime * 0.03, uTime * 0.02)).xzy * 2.0 - 1.0;
            vec3 n = normalize(vec3(0.0, 1.0, 0.0) + vec3(n1.x + n2.x + n3.x * 0.5, 0.0, n1.z + n2.z + n3.z * 0.5) * 0.35);
            vec3 V = normalize(cameraPosition - vWP);
            float dist = length(cameraPosition - vWP);
            // flatten the ripples far away (no shimmering)
            n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(200.0, 900.0, dist)));
            float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
            vec3 R = reflect(-V, n);
            vec3 refl = skyCol(R);
            // the sun's road across the water
            float spec = pow(max(dot(R, uSun), 0.0), 900.0) * 60.0 + pow(max(dot(R, uSun), 0.0), 120.0) * 2.5;
            vec3 deep = vec3(0.02, 0.10, 0.15);
            vec3 shallowC = vec3(0.07, 0.30, 0.33);
            float shore = vWP.x - coastX(vWP.z); // < 0 out at sea
            vec3 body = mix(deep, shallowC, clamp(1.0 - (-shore) / 25.0, 0.0, 1.0) * 0.8 + vCrest * 0.08);
            vec3 col = mix(body, refl, fres) + vec3(1.0, 0.78, 0.5) * spec;
            // surf: foam lines washing in at the cliff foot
            float d = -shore;
            float wave = fract(d * 0.12 - uTime * 0.25 + sin(vWP.z * 0.05) * 0.4);
            float foamBand = (1.0 - smoothstep(0.0, 14.0, d)) * smoothstep(0.7, 1.0, wave) * smoothstep(0.35, 0.65, texture2D(uN, uv * 0.07 + uTime * 0.01).r);
            float edge = (1.0 - smoothstep(0.5, 3.5, d)) * (0.6 + 0.4 * sin(uTime * 2.0 + vWP.z * 0.3));
            col = mix(col, vec3(0.95, 0.93, 0.88), clamp(foamBand * 0.8 + edge * 0.9, 0.0, 1.0));
            // haze toward the horizon
            col = mix(col, uFog, smoothstep(250.0, uFogFar, dist) * 0.85);
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [normals]
  );
  const geo = useMemo(() => {
    // dense near the coast, sparse out to the horizon
    const g = new THREE.PlaneGeometry(4000, 4000, 220, 220);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      // squeeze the grid toward the shore
      const sx = Math.sign(x) * Math.pow(Math.abs(x) / 2000, 2.2) * 2000;
      const sz = Math.sign(z) * Math.pow(Math.abs(z) / 2000, 1.8) * 2000;
      p.setXYZ(i, sx - 40, 0, sz);
    }
    return g;
  }, []);
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return <mesh geometry={geo} material={mat} position={[0, SEA, 0]} frustumCulled={false} />;
}

// ---------------------------------------------------------------
// the scans: cliff faces along the coast, sea stacks, rocks at the foot, boulders and driftwood on the meadow
// ---------------------------------------------------------------
function Scans() {
  const { gl } = useThree();
  const [g, setG] = useState<any>(null);
  useEffect(() => {
    let alive = true;
    loadCliffs(gl).then((x) => alive && setG(x)).catch((e) => console.warn('cliffs', e));
    return () => {
      alive = false;
    };
  }, [gl]);
  const built = useMemo(() => {
    if (!g) return null;
    const out: React.ReactElement[] = [];
    const cliff = part(g, 'P0006_primitive0');
    const stackA = part(g, 'P0060_primitive0');
    const stackB = part(g, 'P0061_primitive0');
    const moss = part(g, 'P0072_primitive0');
    const moss2 = part(g, 'P0076_primitive0');
    const ground = part(g, 'GPU_1_1');
    const trunk = part(g, 'P0081_primitive0');
    const rand = seeded(311);
    const inst = (p: ReturnType<typeof part>, list: { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 }[], key: string, shadow = true) => {
      if (!p || !list.length) return;
      const mat = (p.mat as THREE.MeshStandardMaterial).clone();
      mat.envMapIntensity = 0.9;
      const im = new THREE.InstancedMesh(p.geo, mat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      list.forEach((it, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
        m.compose(it.pos, q, it.scale);
        im.setMatrixAt(i, m);
      });
      im.castShadow = shadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      out.push(<primitive key={key} object={im} />);
    };
    const yawToFace = (p: { face: THREE.Vector3 }, want: THREE.Vector3) => Math.atan2(want.x, want.z) - Math.atan2(p.face.x, p.face.z);
    // cliff faces along the edge, facing the sea
    if (cliff) {
      const list: { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 }[] = [];
      for (let z = -150; z <= 150; z += 15 + rand() * 4) {
        const cx = coastX(z);
        // the edge's direction here: the face looks out along its normal
        const dx = coastX(z + 1) - coastX(z - 1);
        const nrm = new THREE.Vector3(-2, 0, dx).normalize();
        const top = H(cx + 0.5, z);
        const hgt = top - COAST.floor + 1.2;
        const sy = hgt / cliff.size.y;
        list.push({ pos: new THREE.Vector3(cx - 1.2, COAST.floor - 0.5, z), yaw: yawToFace(cliff, nrm) + (rand() - 0.5) * 0.25, scale: new THREE.Vector3(0.95 + rand() * 0.3, sy, 0.8 + rand() * 0.3) });
      }
      inst(cliff, list, 'cliff');
    }
    // sea stacks offshore, rising out of the swell
    const stacks: [number, number, number, number][] = [[-62, 6, 2.6, 0.4], [-78, -36, 3.4, 2.1], [-55, 52, 2.0, 1.0], [-96, 18, 4.2, 3.3], [-70, 110, 3.0, 0.2], [-120, -70, 5.0, 1.7], [-48, -64, 1.6, 2.6]];
    stacks.forEach(([x, z, s, yaw], k) => {
      const p = k % 2 ? stackA : stackB;
      if (!p) return;
      inst(p, [{ pos: new THREE.Vector3(x, COAST.floor + 1.5, z), yaw, scale: new THREE.Vector3(s, s * (p === stackA ? 2.3 : 1.9), s) }], `stack${k}`);
    });
    // boulders at the foot of the cliffs, in the surf
    if (moss) {
      const list: { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 }[] = [];
      for (let k = 0; k < 70; k++) {
        const z = -140 + rand() * 280;
        const x = coastX(z) - 2 - rand() * 14;
        const s = (2 + rand() * 4.5) / moss.size.x;
        list.push({ pos: new THREE.Vector3(x, SEA - 1.5 - rand(), z), yaw: rand() * 6.28, scale: new THREE.Vector3(s, s * (0.8 + rand() * 0.6), s) });
      }
      inst(moss, list, 'surfrocks');
    }
    // the meadow's boulders (they're solid: see COAST.rocks)
    const meadowRock = [moss, moss2, ground];
    COAST.rocks.forEach(([x, z, s, kind], k) => {
      const p = meadowRock[kind % 3] ?? moss;
      if (!p) return;
      const sc = (2.3 * s) / Math.max(p.size.x, p.size.z);
      inst(p, [{ pos: new THREE.Vector3(x, H(x, z) - 0.25 * s, z), yaw: k * 1.7, scale: new THREE.Vector3(sc, sc * (kind === 2 ? 3 : 1.2), sc) }], `mrock${k}`);
    });
    // driftwood logs at the bottom of the canyon beach
    if (trunk) {
      const list: { pos: THREE.Vector3; yaw: number; scale: THREE.Vector3 }[] = [];
      for (let k = 0; k < 6; k++) {
        const x = -10 + rand() * 30;
        const z = COAST.canyon.z + (rand() - 0.5) * 10;
        const s = 3 + rand() * 2;
        list.push({ pos: new THREE.Vector3(x, H(x, z) - 0.1, z), yaw: rand() * 6.28, scale: new THREE.Vector3(s, s, s) });
      }
      inst(trunk, list, 'drift');
    }
    return out;
  }, [g]);
  return <group>{built}</group>;
}

// ---------------------------------------------------------------
// foliage: a dense sprig card made from the leaf atlas, tinted per tree
// ---------------------------------------------------------------
let leafCardP: THREE.Texture | null = null;
function leafCard() {
  if (leafCardP) return leafCardP;
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const img = new Image();
  img.onload = () => {
    const rand = seeded(17);
    // stamp the bushy sprig many times, rotated, from the edges in, so the card reads as a clump
    for (let k = 0; k < 26; k++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 150;
      const s = 0.22 + rand() * 0.16;
      g.save();
      g.translate(256 + Math.cos(a) * r, 256 + Math.sin(a) * r);
      g.rotate(rand() * Math.PI * 2);
      g.globalAlpha = 1;
      g.drawImage(img, 61, 1226, 900, 684, -450 * s, -342 * s, 900 * s, 684 * s);
      g.restore();
    }
    t.needsUpdate = true;
  };
  img.src = asset('coast/leaves.webp');
  leafCardP = t;
  return t;
}
/** foliage material: alpha cards that sway, and glow when the low sun is behind them */
function foliageMat(tint: string, sway = 0.06) {
  const m = new THREE.MeshStandardMaterial({ map: leafCard(), color: tint, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.uniforms.uSun = { value: SUN };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vFW;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float ph = ip.x * 0.21 + ip.z * 0.17;
          transformed.x += sin(uTime * 1.2 + ph) * ${sway.toFixed(3)};
          transformed.z += cos(uTime * 0.9 + ph) * ${(sway * 0.6).toFixed(3)};
          vec4 w = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            w = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          vFW = w.xyz;
        }`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun; varying vec3 vFW;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          // light through the leaves: looking toward the low sun they glow warm
          vec3 V = normalize(cameraPosition - vFW);
          float back = pow(max(dot(-V, uSun), 0.0), 4.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.7, 0.35) * back * 1.6;
          reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.08;
        }`
      );
  };
  return m;
}
const timeU = { value: 0 };

type Cluster = { c: THREE.Vector3; r: THREE.Vector3; n: number; flat: number };
function Clusters({ clusters, tint, size }: { clusters: Cluster[]; tint: string; size: number }) {
  const mesh = useMemo(() => {
    const rand = seeded(clusters.length * 7 + 3);
    let total = 0;
    for (const c of clusters) total += c.n;
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), foliageMat(tint), total);
    const m = new THREE.Matrix4();
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
        // flat pads (cypress) lie mostly level
        e.set((rand() - 0.5) * Math.PI * (1 - c.flat) - Math.PI / 2 * c.flat, rand() * Math.PI * 2, (rand() - 0.5) * Math.PI * (1 - c.flat));
        q.setFromEuler(e);
        const s = size * (0.7 + rand() * 0.6);
        m.compose(p, q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, m);
        // the outside and the top in the sun, the inside darker
        const out = rr;
        const top = (p.y - c.c.y) / Math.max(0.1, c.r.y);
        col.setRGB(0.55 + out * 0.35 + top * 0.12, 0.55 + out * 0.35 + top * 0.12, 0.5 + out * 0.3);
        im.setColorAt(i, col);
        i++;
      }
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  }, [clusters, tint, size]);
  return <primitive object={mesh} />;
}

/** a branch: a tapering tube along a curve */
function branchGeo(pts: THREE.Vector3[], r0: number, r1: number, seg = 10, radial = 7) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  const p = g.attributes.position as THREE.BufferAttribute;
  // taper: TubeGeometry is uniform; pull each ring toward its centre by the radius at that point
  const frames = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) {
    const c = curve.getPointAt(i / seg);
    const r = r0 + (r1 - r0) * (i / seg);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(r);
      p.setXYZ(k, c.x + v.x, c.y + v.y, c.z + v.z);
    }
  }
  void frames;
  g.computeVertexNormals();
  return g;
}
function mergeGeos(geos: THREE.BufferGeometry[]) {
  const non = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of non) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of non) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array as Float32Array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

/** Monterey cypresses on the meadow and along the cliff: twisted trunks bent away from the sea, flat dark pads */
function Cypresses() {
  const bark = useTex('coast/bark.webp');
  const barkN = useTex('coast/bark_n.webp', false);
  const { wood, pads } = useMemo(() => {
    const rand = seeded(53);
    const parts: THREE.BufferGeometry[] = [];
    const pads: Cluster[] = [];
    const trees: [number, number, number, number][] = [...COAST.trees];
    // more along the cliff top and back toward the road
    for (let k = 0; k < 14; k++) {
      const z = -120 + rand() * 240;
      const x = coastX(z) + 3 + rand() * 6;
      if (Math.hypot(x, z) < COAST.radius + 4) continue;
      trees.push([x, z, 0.9 + rand() * 0.6, 0.4 + rand() * 0.3]);
    }
    for (const [x, z, s, lean] of trees) {
      const y0 = H(x, z) - 0.3;
      const h = 7 * s;
      // the wind blows from the sea (west): the tree leans and reaches east
      const top = new THREE.Vector3(x + lean * h * 0.7, y0 + h, z + (rand() - 0.5) * 2);
      const mid = new THREE.Vector3(x + lean * h * 0.25 + (rand() - 0.5) * 0.6, y0 + h * 0.5, z + (rand() - 0.5) * 0.8);
      parts.push(branchGeo([new THREE.Vector3(x, y0, z), mid, top], 0.45 * s, 0.18 * s, 12, 9));
      // limbs: out and up, mostly downwind
      const nL = 4 + Math.floor(rand() * 3);
      for (let k = 0; k < nL; k++) {
        const t = 0.35 + (k / nL) * 0.55;
        const from = new THREE.Vector3().lerpVectors(new THREE.Vector3(x, y0, z), top, t);
        from.x = x + (top.x - x) * t;
        const a = (rand() - 0.5) * 2.4;
        const L = h * (0.35 + rand() * 0.25);
        const end = new THREE.Vector3(from.x + Math.cos(a) * L * (0.6 + lean), from.y + L * (0.25 + rand() * 0.2), from.z + Math.sin(a) * L);
        const ctl = new THREE.Vector3().lerpVectors(from, end, 0.5).add(new THREE.Vector3(0, L * 0.12, 0));
        parts.push(branchGeo([from, ctl, end], 0.16 * s, 0.05 * s, 6, 6));
        pads.push({ c: end.clone().add(new THREE.Vector3(0, 0.3, 0)), r: new THREE.Vector3(2.4 * s, 0.7 * s, 2.0 * s), n: Math.round(46 * s), flat: 0.75 });
      }
      pads.push({ c: top.clone().add(new THREE.Vector3(0.6, 0.2, 0)), r: new THREE.Vector3(3.4 * s, 0.9 * s, 2.8 * s), n: Math.round(70 * s), flat: 0.8 });
    }
    return { wood: mergeGeos(parts), pads };
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ map: bark, normalMap: barkN, color: '#b8a898', roughness: 0.95 }), [bark, barkN]);
  return (
    <group>
      <mesh geometry={wood} material={mat} castShadow receiveShadow />
      <Clusters clusters={pads} tint="#3d4a2c" size={1.55} />
    </group>
  );
}

/** coast live oaks dotting the golden hills: round crowns, dark against the gold */
function Oaks() {
  const { wood, crowns } = useMemo(() => {
    const rand = seeded(71);
    const parts: THREE.BufferGeometry[] = [];
    const crowns: Cluster[] = [];
    let n = 0;
    for (let k = 0; k < 4000 && n < 170; k++) {
      const x = 50 + rand() * 330;
      const z = -300 + rand() * 600;
      if (Math.abs(x - roadX(z)) < COAST.road.half + 5) continue;
      if (Math.abs(z - COAST.canyon.z) < COAST.canyon.half + 3) continue;
      // in groves, in the folds of the hills
      if (Math.sin(x * 0.03) * Math.cos(z * 0.025) < 0.15 && rand() < 0.75) continue;
      const s = 0.9 + rand() * 0.8;
      const y0 = H(x, z) - 0.2;
      const h = 3.2 * s;
      parts.push(branchGeo([new THREE.Vector3(x, y0, z), new THREE.Vector3(x + 0.3, y0 + h * 0.6, z), new THREE.Vector3(x + 0.5, y0 + h, z + 0.3)], 0.32 * s, 0.14 * s, 5, 6));
      for (let c = 0; c < 3; c++)
        crowns.push({ c: new THREE.Vector3(x + (rand() - 0.5) * 3 * s, y0 + h + 0.6 * s + rand() * s, z + (rand() - 0.5) * 3 * s), r: new THREE.Vector3(2.4 * s, 1.6 * s, 2.4 * s), n: 16, flat: 0.15 });
      n++;
    }
    return { wood: mergeGeos(parts), crowns };
  }, []);
  return (
    <group>
      <mesh geometry={wood}>
        <meshStandardMaterial color="#4a3b2c" roughness={0.95} />
      </mesh>
      <Clusters clusters={crowns} tint="#4d5730" size={2.6} />
    </group>
  );
}

// ---------------------------------------------------------------
// the meadow: wild oats lit from behind by the low sun, poppies and lupine
// ---------------------------------------------------------------
function oatsTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(91);
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    const x = 12 + rand() * 232;
    const hgt = 120 + rand() * 130;
    const bend = (rand() - 0.5) * 50;
    const tx = x + bend;
    const ty = 256 - hgt;
    const l = 48 + rand() * 22;
    g.strokeStyle = `hsl(${36 + rand() * 12}, ${45 + rand() * 25}%, ${l}%)`;
    g.lineWidth = 1.2 + rand() * 1.4;
    g.beginPath();
    g.moveTo(x, 256);
    g.quadraticCurveTo(x + bend * 0.2, 256 - hgt * 0.55, tx, ty);
    g.stroke();
    // a nodding oat head: little spikelets hanging off the top
    if (rand() < 0.55)
      for (let k = 0; k < 7; k++) {
        const py = ty + k * 6;
        const side = k % 2 ? 1 : -1;
        g.fillStyle = `hsl(${40 + rand() * 10}, 55%, ${60 + rand() * 18}%)`;
        g.beginPath();
        g.ellipse(tx + side * 5, py + 4, 2.2, 6, side * 0.5, 0, Math.PI * 2);
        g.fill();
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function flowerTexture(kind: 'poppy' | 'lupine') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rand = seeded(kind === 'poppy' ? 5 : 9);
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < (kind === 'poppy' ? 6 : 4); i++) {
    const x = 20 + rand() * 88;
    const h = 50 + rand() * 60;
    g.strokeStyle = '#5d6b2c';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x, 128);
    g.lineTo(x + (rand() - 0.5) * 10, 128 - h);
    g.stroke();
    if (kind === 'poppy') {
      g.fillStyle = `hsl(${24 + rand() * 10}, 95%, ${52 + rand() * 8}%)`;
      g.beginPath();
      g.ellipse(x, 128 - h, 9, 6, 0, 0, Math.PI * 2);
      g.fill();
    } else
      for (let k = 0; k < 9; k++) {
        g.fillStyle = `hsl(${262 + rand() * 18}, 55%, ${50 + k * 3}%)`;
        g.beginPath();
        g.ellipse(x + (k % 2 ? 3 : -3), 128 - h + k * 4, 3.5, 2.5, 0, 0, Math.PI * 2);
        g.fill();
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function grassMat(tex: THREE.Texture, sway: number) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeU;
    sh.uniforms.uSun = { value: SUN };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vFW; varying float vTip;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float k = max(position.y, 0.0); k *= k; vTip = position.y;
          // gusts roll across the meadow from the sea
          float gust = sin(ip.x * 0.08 - uTime * 1.6 + sin(ip.z * 0.05)) * 0.5 + 0.5;
          transformed.x += (sin(uTime * 2.1 + ip.x * 0.7 + ip.z * 0.4) * 0.35 + gust * 0.9) * ${sway.toFixed(3)} * k;
          transformed.z += cos(uTime * 1.7 + ip.z * 0.6) * ${(sway * 0.4).toFixed(3)} * k;
          vec4 w = modelMatrix * vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            w = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
          #endif
          vFW = w.xyz;
        }`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSun; varying vec3 vFW; varying float vTip;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          // the low sun shining through the seed heads: a halo of gold
          vec3 V = normalize(cameraPosition - vFW);
          float back = pow(max(dot(-V, uSun), 0.0), 3.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.72, 0.38) * back * (0.3 + vTip * 1.2);
          reflectedLight.indirectDiffuse *= 0.7 + vTip * 0.6;
        }`
      );
  };
  return m;
}
function crossCard() {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const c = a.clone().rotateY(Math.PI / 4);
  return mergeGeos([a, b, c]);
}
function Meadow() {
  const { oats, poppies, lupine } = useMemo(() => {
    const rand = seeded(101);
    const card = crossCard();
    const spots: [number, number, number][] = [];
    const blocked = (x: number, z: number) =>
      x < coastX(z) + 0.6 || Math.abs(x - roadX(z)) < COAST.road.half + 0.5 || COAST.rocks.some(([rx, rz, s]) => Math.hypot(x - rx, z - rz) < 1.2 * s) || COAST.trees.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 0.8);
    for (let k = 0; k < 200000 && spots.length < 42000; k++) {
      const r = Math.sqrt(rand()) * 95;
      const a = rand() * Math.PI * 2;
      const x = 6 + Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (blocked(x, z)) continue;
      // thinner on the trodden paths
      // shorter, patchy: knee-high mostly, a few tall clumps
      const patch = Math.sin(x * 0.21 + z * 0.13) * Math.cos(z * 0.17 - x * 0.07);
      if (patch < -0.35 && rand() < 0.6) continue;
      const s = 0.3 + rand() * 0.3 + Math.max(0, patch) * 0.25;
      spots.push([x, z, s]);
    }
    const oats = new THREE.InstancedMesh(card, grassMat(oatsTexture(), 0.09), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    spots.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      m.compose(new THREE.Vector3(x, H(x, z) - 0.05, z), q, new THREE.Vector3(s * (1 + rand() * 0.6), s, s * (1 + rand() * 0.6)));
      oats.setMatrixAt(i, m);
      col.setHSL(0.09 + rand() * 0.04, 0.3 + rand() * 0.2, 0.45 + rand() * 0.2);
      oats.setColorAt(i, col);
    });
    oats.receiveShadow = true;
    const flowers = (kind: 'poppy' | 'lupine', n: number) => {
      const im = new THREE.InstancedMesh(crossCard(), grassMat(flowerTexture(kind), 0.05), n);
      let i = 0;
      for (let k = 0; k < n * 20 && i < n; k++) {
        // in drifts
        const cx = -20 + rand() * 60;
        const cz = -50 + rand() * 100;
        if (Math.sin(cx * (kind === 'poppy' ? 0.11 : 0.07) + cz * 0.09) < 0.3) continue;
        for (let j = 0; j < 6 && i < n; j++) {
          const x = cx + (rand() - 0.5) * 4;
          const z = cz + (rand() - 0.5) * 4;
          if (blocked(x, z)) continue;
          const s = kind === 'poppy' ? 0.35 + rand() * 0.2 : 0.55 + rand() * 0.3;
          m.compose(new THREE.Vector3(x, H(x, z) - 0.02, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 3), new THREE.Vector3(s, s, s));
          im.setMatrixAt(i++, m);
        }
      }
      im.count = i;
      return im;
    };
    return { oats, poppies: flowers('poppy', 3500), lupine: flowers('lupine', 1800) };
  }, []);
  return (
    <group>
      <primitive object={oats} />
      <primitive object={poppies} />
      <primitive object={lupine} />
    </group>
  );
}

// ---------------------------------------------------------------
// Highway 1: guard rail along the seaward side, and the arched bridge over the canyon
// ---------------------------------------------------------------
function Highway() {
  const { posts, rail } = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (let z = -300; z <= 300; z += 2.5) {
      if (Math.abs(z - COAST.canyon.z) < 22) continue; // the bridge has its own parapet
      const x = roadX(z) - COAST.road.half - 0.4;
      pts.push(new THREE.Vector3(x, roadHeight(z), z));
    }
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.9, 0.16).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ color: '#6b5a48', roughness: 0.9 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => posts.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
    // the steel beam rail, in runs between the bridge
    const runs: THREE.Vector3[][] = [[], []];
    for (const p of pts) runs[p.z < COAST.canyon.z ? 0 : 1].push(p.clone().add(new THREE.Vector3(0.12, 0.7, 0)));
    const rail = mergeGeos(runs.filter((r) => r.length > 2).map((r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(r), r.length * 2, 0.09, 4, false)));
    return { posts, rail };
  }, []);
  return (
    <group>
      <primitive object={posts} />
      <mesh geometry={rail}>
        <meshStandardMaterial color="#b9b5ad" metalness={0.6} roughness={0.4} />
      </mesh>
      <Bridge />
    </group>
  );
}
function Bridge() {
  const geos = useMemo(() => {
    const C = COAST.canyon;
    const z0 = C.z - 22;
    const z1 = C.z + 22;
    const xAt = (z: number) => roadX(z);
    const yAt = (z: number) => roadHeight(z);
    const parts: { deck: THREE.BufferGeometry[]; arch: THREE.BufferGeometry[]; cols: THREE.BufferGeometry[] } = { deck: [], arch: [], cols: [] };
    // deck: a slab following the road, with parapet walls
    const n = 40;
    for (let i = 0; i < n; i++) {
      const za = z0 + ((z1 - z0) * i) / n;
      const zb = z0 + ((z1 - z0) * (i + 1)) / n;
      const zc = (za + zb) / 2;
      const ang = Math.atan2(xAt(zb) - xAt(za), zb - za);
      const L = Math.hypot(xAt(zb) - xAt(za), zb - za) + 0.05;
      const slab = new THREE.BoxGeometry(COAST.road.half * 2 + 1.2, 0.9, L);
      slab.rotateY(ang);
      slab.translate(xAt(zc), yAt(zc) - 0.45, zc);
      parts.deck.push(slab);
      for (const s of [-1, 1]) {
        const wall = new THREE.BoxGeometry(0.35, 1.0, L);
        wall.rotateY(ang);
        wall.translate(xAt(zc) + s * (COAST.road.half + 0.45), yAt(zc) + 0.5, zc);
        parts.deck.push(wall);
      }
    }
    // the arch: a smooth rib each side, springing from the canyon walls
    const span = 30;
    const spring = COAST.floor + 6;
    const crown = yAt(C.z) - 1.6;
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 30; k++) {
        const t = k / 30;
        const z = C.z - span / 2 + span * t;
        const y = spring + (crown - spring) * Math.sin(Math.PI * t) ** 0.8;
        pts.push(new THREE.Vector3(xAt(z) + s * 2.6, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      parts.arch.push(new THREE.TubeGeometry(curve, 60, 0.85, 8, false));
      // the spandrel columns from the rib up to the deck
      for (let k = 1; k < 12; k++) {
        const t = k / 12;
        const p = curve.getPointAt(t);
        const top = yAt(p.z) - 0.9;
        if (top - p.y < 0.6) continue;
        const col = new THREE.BoxGeometry(0.8, top - p.y, 0.8);
        col.translate(p.x, (top + p.y) / 2, p.z);
        parts.cols.push(col);
      }
    }
    // tall piers at the approaches
    for (const z of [z0 + 2, z0 + 7, z1 - 7, z1 - 2]) {
      const g = H(xAt(z), z);
      const top = yAt(z) - 0.9;
      if (top - g < 0.5) continue;
      for (const s of [-1, 1]) {
        const col = new THREE.BoxGeometry(1.0, top - g + 2, 1.0);
        col.translate(xAt(z) + s * 2.6, (top + g - 2) / 2, z);
        parts.cols.push(col);
      }
    }
    return { deck: mergeGeos(parts.deck), arch: mergeGeos(parts.arch), cols: mergeGeos(parts.cols) };
  }, []);
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d8d0c2', roughness: 0.85 }), []);
  return (
    <group>
      <mesh geometry={geos.deck} material={concrete} castShadow receiveShadow />
      <mesh geometry={geos.arch} material={concrete} castShadow receiveShadow />
      <mesh geometry={geos.cols} material={concrete} castShadow receiveShadow />
    </group>
  );
}

// ---------------------------------------------------------------
// the lighthouse on the point
// ---------------------------------------------------------------
function Lighthouse() {
  const [x, z] = COAST.lighthouse;
  const y = H(x, z);
  const beam = useRef<THREE.Group>(null);
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const tower = useMemo(() => {
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      pts.push(new THREE.Vector2(2.1 - t * 0.75, t * 14));
    }
    return new THREE.LatheGeometry(pts, 32);
  }, []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    if (beam.current) beam.current.rotation.y = t * 0.6;
    if (lamp.current) lamp.current.emissiveIntensity = 3 + Math.sin(t * 0.6 * 2) * 0.5;
  });
  return (
    <group position={[x, y, z]}>
      <mesh geometry={tower} castShadow receiveShadow>
        <meshStandardMaterial color="#f2eee6" roughness={0.7} />
      </mesh>
      <mesh position={[0, 14.2, 0]} castShadow>
        <cylinderGeometry args={[1.9, 1.9, 0.4, 24]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* the gallery rail and the lantern room */}
      <mesh position={[0, 15.0, 0]}>
        <cylinderGeometry args={[1.85, 1.85, 0.9, 24, 1, true]} />
        <meshStandardMaterial color="#1e1e1e" wireframe />
      </mesh>
      <mesh position={[0, 15.6, 0]}>
        <cylinderGeometry args={[1.1, 1.1, 2.0, 16]} />
        <meshStandardMaterial ref={lamp} color="#fff4d6" emissive="#ffd38a" emissiveIntensity={3} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, 17.0, 0]} castShadow>
        <coneGeometry args={[1.4, 1.2, 16]} />
        <meshStandardMaterial color="#9c2b22" roughness={0.6} />
      </mesh>
      <group ref={beam} position={[0, 15.6, 0]}>
        <mesh position={[18, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <coneGeometry args={[2.5, 36, 16, 1, true]} />
          <meshBasicMaterial color="#fff2c8" transparent opacity={0.07} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* the keeper's house */}
      <group position={[5.5, 0, 2]}>
        <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
          <boxGeometry args={[7, 3.2, 5]} />
          <meshStandardMaterial color="#efe9de" roughness={0.8} />
        </mesh>
        <mesh position={[0, 3.9, 0]} rotation={[0, 0, 0]} castShadow>
          <cylinderGeometry args={[0.01, 3.6, 1.6, 4, 1]} />
          <meshStandardMaterial color="#8f2a20" roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

/** a few gulls wheeling over the cliff edge */
function Gulls() {
  const birds = useMemo(() => {
    const rand = seeded(131);
    return Array.from({ length: 7 }, () => ({ cx: coastX(0) - 10 + rand() * 20, cz: -40 + rand() * 80, r: 12 + rand() * 25, y: 14 + rand() * 18, w: 0.12 + rand() * 0.1, ph: rand() * 6 }));
  }, []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const wing = useMemo(() => {
    // a gull in silhouette: two bent wings
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.5, 0.25, 1.1, 0.05);
    s.quadraticCurveTo(0.55, 0.12, 0, -0.08);
    const g = new THREE.ShapeGeometry(s);
    const g2 = g.clone().scale(-1, 1, 1);
    return mergeGeos([g, g2]);
  }, []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    birds.forEach((b, k) => {
      const g = refs.current[k];
      if (!g) return;
      const a = t * b.w + b.ph;
      g.position.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(t * 0.7 + b.ph) * 1.5, b.cz + Math.sin(a) * b.r);
      g.rotation.set(0, -a, Math.sin(t * 3 + b.ph) * 0.15);
      g.scale.set(1, 1 + Math.sin(t * 6 + b.ph) * 0.25, 1);
    });
  });
  return (
    <group>
      {birds.map((_, k) => (
        <group key={k} ref={(el) => (refs.current[k] = el)}>
          <mesh geometry={wing} rotation={[-Math.PI / 2, 0, 0]}>
            <meshStandardMaterial color="#e8e4dc" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Clock() {
  useFrame((st) => {
    timeU.value = st.clock.elapsedTime;
  });
  return null;
}

export function CoastMap() {
  return (
    <group>
      <Clock />
      <Environment />
      <SkyDome />
      <Land />
      <Ocean />
      <Scans />
      <Cypresses />
      <Oaks />
      <Meadow />
      <Highway />
      <Lighthouse />
      <Gulls />
    </group>
  );
}
