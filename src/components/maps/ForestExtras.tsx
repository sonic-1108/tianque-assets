import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { FOREST, FOREST_X, forestFloor, mapRuntime, riverZ, zipAt, zipLine, pagodaSlope, SHRINES, SHRINE } from '../../maps';
import { seeded, GLSL_NOISE, cloudPuffTexture } from '../Scenery';

// ==================================================================
// 青冥古林's newer corners: the waterfall and its cave, the hunters'
// camp, the bamboo grove and the lantern path, the ruined pagoda, the
// bog; and the things that come and go: herbs, traps, zip lines.
// ==================================================================

const floorAt = (x: number, z: number) => forestFloor(x, z, false);
const night = { value: 0 };

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}
function glowTex(inner: string, outer: string) {
  return canvasTex(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, inner);
    grd.addColorStop(1, outer);
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  });
}

/** a rock strip (a cliff face): a grid in the plane of `along` x height, pushed out by noise. hole(u, y) leaves gaps */
function cliffFace(opts: { from: number; to: number; at: number; axis: 'x' | 'z'; out: 1 | -1; y0: number; y1: number; hole?: (u: number, y: number) => boolean; seed: number }) {
  const rand = seeded(opts.seed);
  const nu = Math.max(2, Math.round((opts.to - opts.from) / 0.9));
  const nv = Math.max(2, Math.round((opts.y1 - opts.y0) / 0.9));
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const bumps = Array.from({ length: 24 }, () => [rand() * 6, rand() * 6, 0.2 + rand() * 0.6] as const);
  const n2 = (u: number, y: number) => {
    let v = 0;
    for (const [a, b, w] of bumps) v += Math.sin(u * (0.3 + a * 0.12) + b) * Math.cos(y * (0.25 + b * 0.1) + a) * w;
    return v / 6;
  };
  const c = new THREE.Color();
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const u = opts.from + ((opts.to - opts.from) * i) / nu;
      const y = opts.y0 + ((opts.y1 - opts.y0) * j) / nv;
      // strata: ledges every metre or so, the face leaning back a little toward the top
      const ledge = Math.abs(Math.sin(y * 1.9 + n2(u, 0) * 3)) * 0.35;
      const push = 0.55 + Math.abs(n2(u, y)) * 1.3 + ledge + (y > opts.y1 - 0.8 ? 0.6 : 0);
      const o = opts.at + opts.out * push;
      if (opts.axis === 'x') pos.push(o, y, u);
      else pos.push(u, y, o);
      const band = 0.5 + 0.5 * Math.sin(y * 2.3 + n2(u, y) * 4);
      c.setRGB(0.27 + band * 0.08, 0.27 + band * 0.07, 0.24 + band * 0.05);
      // wet and mossy near the bottom
      if (y < 1.5) c.lerp(new THREE.Color(0.12, 0.16, 0.08), 0.5 * (1 - y / 1.5));
      col.push(c.r, c.g, c.b);
    }
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const u = opts.from + ((opts.to - opts.from) * (i + 0.5)) / nu;
      const y = opts.y0 + ((opts.y1 - opts.y0) * (j + 0.5)) / nv;
      if (opts.hole?.(u, y)) continue;
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      if ((opts.axis === 'x') === (opts.out < 0)) idx.push(a, b, a + 1, a + 1, b, b + 1);
      else idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------
// 瀑布, the pool, the cave behind
// ---------------------------------------------------------------
function Waterfall() {
  const X = FOREST_X;
  const B = X.bluff;
  const C = X.cave;
  const { rock, faces, sheet, sheetMat, poolMat, roof } = useMemo(() => {
    const rock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const inRamp = (z: number) => Math.abs(z - X.ramp.z) < X.ramp.half + 0.4;
    const faces = [
      cliffFace({ from: B.z0, to: B.z1, at: B.x0, axis: 'x', out: -1, y0: -3.2, y1: B.h + 0.3, seed: 5, hole: (u, y) => (u > C.mouth[0] && u < C.mouth[1] && y < C.floor + C.roof - 0.3) || inRamp(u) }),
      cliffFace({ from: B.x0 - 1, to: 216, at: B.z1, axis: 'z', out: 1, y0: -1.5, y1: B.h + 0.3, seed: 6 }),
      cliffFace({ from: B.x0 - 1, to: 216, at: B.z0, axis: 'z', out: -1, y0: -1.5, y1: B.h + 0.3, seed: 7 }),
    ];
    // the falling water: a sheet bowed out at the lip, streaks pouring down it
    const sheetGeo = new THREE.PlaneGeometry(1, 1, 8, 24);
    const sp = sheetGeo.attributes.position as THREE.BufferAttribute;
    const W = X.fall.z1 - X.fall.z0;
    const Hh = B.h + 0.7;
    for (let i = 0; i < sp.count; i++) {
      const u = sp.getX(i); // -0.5 .. 0.5
      const v = sp.getY(i) + 0.5; // 0 bottom .. 1 top
      const y = -0.55 + v * Hh;
      // bowed out at the lip, curtain hanging nearly straight below
      const out = Math.pow(v, 6) * 0.9 + Math.sin(u * Math.PI) * 0.15;
      sp.setXYZ(i, X.fall.x - out, y, (X.fall.z0 + X.fall.z1) / 2 + u * W * (0.9 + 0.1 * v));
    }
    sheetGeo.computeVertexNormals();
    const sheetMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uNight: night },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uNight; varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          vec2 q = vec2(vUv.x * 9.0, vUv.y * 3.0 + uTime * 2.6);
          float s = noise(q) * 0.6 + noise(q * vec2(2.0, 3.0) + 4.0) * 0.4;
          float streak = smoothstep(0.35, 0.8, s);
          float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
          float foam = smoothstep(0.25, 0.0, vUv.y) + smoothstep(0.9, 1.0, vUv.y) * 0.5;
          vec3 col = mix(vec3(0.55, 0.68, 0.7), vec3(0.95, 0.98, 1.0), streak * 0.8 + foam * 0.6);
          col *= 1.0 - uNight * 0.75;
          float a = (0.45 + streak * 0.45 + foam * 0.3) * edge;
          gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
        }`,
    });
    // the pool's surface: dark green water, rings spreading from the fall
    const poolMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uTime: sheetMat.uniforms.uTime, uNight: night, uFall: { value: new THREE.Vector2(X.fall.x, (X.fall.z0 + X.fall.z1) / 2) } },
      vertexShader: /* glsl */ `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uNight; uniform vec2 uFall; varying vec3 vWP;
        ${GLSL_NOISE}
        void main(){
          float d = length(vWP.xz - uFall);
          float ring = sin(d * 3.0 - uTime * 5.0) * 0.5 + 0.5;
          float near = smoothstep(9.0, 0.0, d);
          float n = noise(vWP.xz * 0.6 + uTime * 0.3);
          vec3 col = mix(vec3(0.08, 0.2, 0.19), vec3(0.2, 0.36, 0.34), n * 0.6 + ring * near * 0.4);
          col = mix(col, vec3(0.9, 0.95, 0.95), smoothstep(3.2, 0.5, d) * 0.7 * (0.6 + 0.4 * ring));
          col *= 1.0 - uNight * 0.8;
          gl_FragColor = vec4(col, 0.86);
        }`,
    });
    // the rock over the cave (seen from inside: its underside; from the bluff top it is the bluff)
    const roof = new THREE.BoxGeometry(C.x1 - B.x0 + 1.2, B.h - (C.floor + C.roof) + 0.2, C.z1 - C.z0 + 1.2);
    roof.translate((B.x0 + C.x1) / 2 + 0.3, (C.floor + C.roof + B.h) / 2 - 0.1, (C.z0 + C.z1) / 2);
    return { rock, faces, sheet: sheetGeo, sheetMat, poolMat, roof };
  }, []);
  const lamp = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Sprite>(null);
  const mist = useMemo(() => {
    const rand = seeded(17);
    return Array.from({ length: 10 }, () => ({ x: X.fall.x - 1 - rand() * 5, y: 0.2 + rand() * 2.5, z: X.fall.z0 + rand() * (X.fall.z1 - X.fall.z0), s: 3 + rand() * 3, ph: rand() * 6 }));
  }, []);
  const mistRefs = useRef<(THREE.Sprite | null)[]>([]);
  const puff = useMemo(() => cloudPuffTexture(), []);
  const flameTex = useMemo(() => glowTex('rgba(255,210,120,1)', 'rgba(255,120,30,0)'), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    sheetMat.uniforms.uTime.value = t;
    mist.forEach((m, k) => {
      const s = mistRefs.current[k];
      if (!s) return;
      s.position.y = m.y + Math.sin(t * 0.7 + m.ph) * 0.4;
      (s.material as THREE.SpriteMaterial).opacity = 0.32 + 0.12 * Math.sin(t * 1.1 + m.ph);
    });
    if (lamp.current) lamp.current.intensity = 6 * (0.85 + 0.15 * Math.sin(t * 11) * Math.sin(t * 7.3));
    if (flame.current) flame.current.scale.setScalar(0.35 + 0.04 * Math.sin(t * 13));
  });
  const lampAt: [number, number, number] = [C.x1 - 1.4, C.floor + 1.1, (C.z0 + C.z1) / 2];
  return (
    <group>
      {faces.map((g, k) => (
        <mesh key={k} geometry={g} material={rock} castShadow receiveShadow />
      ))}
      <mesh geometry={roof} material={rock} receiveShadow />
      {/* the rubble ramp up the bluff's north end */}
      <RampMesh />
      <mesh geometry={sheet} material={sheetMat} renderOrder={5} />
      <mesh position={[X.pool.x, -0.53, X.pool.z]} rotation={[-Math.PI / 2, 0, 0]} material={poolMat} renderOrder={3}>
        <circleGeometry args={[X.pool.r + 1.5, 48]} />
      </mesh>
      {mist.map((m, k) => (
        <sprite key={k} ref={(el) => (mistRefs.current[k] = el)} position={[m.x, m.y, m.z]} scale={[m.s, m.s * 0.6, 1]}>
          <spriteMaterial map={puff} color="#eef6f6" transparent opacity={0.35} depthWrite={false} />
        </sprite>
      ))}
      {/* the oil lamp in the cave */}
      <mesh position={[lampAt[0], lampAt[1] - 0.5, lampAt[2]]}>
        <cylinderGeometry args={[0.18, 0.28, 0.9, 7]} />
        <meshStandardMaterial color="#57534e" roughness={0.9} />
      </mesh>
      <sprite ref={flame} position={lampAt} scale={0.35}>
        <spriteMaterial map={flameTex} color="#ffd18a" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <pointLight ref={lamp} position={[lampAt[0] - 0.4, lampAt[1] + 0.3, lampAt[2]]} color="#ffb766" intensity={6} distance={11} decay={1.5} />
      {/* straw and a bedroll: someone sheltered here */}
      <mesh position={[C.x1 - 3.2, C.floor + 0.08, C.z0 + 3]} rotation={[-Math.PI / 2, 0, 0.3]}>
        <planeGeometry args={[2.2, 1.1]} />
        <meshStandardMaterial color="#8a6d3b" roughness={1} />
      </mesh>
    </group>
  );
}

function RampMesh() {
  const geo = useMemo(() => {
    const R = FOREST_X.ramp;
    const n = 24;
    const pos: number[] = [];
    const idx: number[] = [];
    const rand = seeded(23);
    for (let i = 0; i <= n; i++) {
      const x = R.x0 + ((R.x1 + 1 - R.x0) * i) / n;
      const y = floorAt(x, R.z);
      for (const [dz, dy] of [[-R.half - 0.6, -2.5], [-R.half, 0], [R.half, 0], [R.half + 0.6, -2.5]] as const) pos.push(x, y + dy + (dy === 0 ? (rand() - 0.5) * 0.08 : 0), R.z + dz);
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < 3; j++) {
        const a = i * 4 + j;
        idx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} receiveShadow castShadow>
      <meshStandardMaterial color="#6b6559" roughness={0.95} flatShading side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---------------------------------------------------------------
// 猎户营地
// ---------------------------------------------------------------
function Camp() {
  const X = FOREST_X.camp;
  const fire = useRef<THREE.PointLight>(null);
  const flames = useRef<(THREE.Sprite | null)[]>([]);
  const flameTex = useMemo(() => glowTex('rgba(255,220,140,1)', 'rgba(255,90,20,0)'), []);
  const canvas = useMemo(
    () =>
      canvasTex(128, 128, (g) => {
        g.fillStyle = '#b8a27a';
        g.fillRect(0, 0, 128, 128);
        const r = seeded(31);
        for (let i = 0; i < 400; i++) {
          g.fillStyle = `rgba(${90 + r() * 40},${70 + r() * 30},${40 + r() * 20},${0.08 + r() * 0.1})`;
          g.fillRect(r() * 128, r() * 128, 2 + r() * 10, 1 + r() * 2);
        }
        g.strokeStyle = 'rgba(70,50,30,0.5)';
        for (let y = 0; y < 128; y += 32) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(128, y);
          g.stroke();
        }
      }, 2),
    []
  );
  const tentGeo = useMemo(() => {
    // an A-frame: two sloped panels, open at the front
    const g = new THREE.BufferGeometry();
    const w = 1.9;
    const h = 2.1;
    const d = 3.4;
    const v = [-w, 0, -d / 2, 0, h, -d / 2, -w, 0, d / 2, 0, h, d / 2, w, 0, -d / 2, w, 0, d / 2, 0, h, -d / 2, 0, h, d / 2];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1], 2));
    g.setIndex([0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]);
    g.computeVertexNormals();
    return g;
  }, []);
  const embers = useMemo(() => {
    const n = 40;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const sd = new Float32Array(n);
    const r = seeded(37);
    for (let i = 0; i < n; i++) {
      p.set([(r() - 0.5) * 0.8, r() * 3, (r() - 0.5) * 0.8], i * 3);
      sd[i] = r();
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(sd, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `uniform float uTime; attribute float seed; varying float vA;
        void main(){ float t = fract(uTime * (0.25 + seed * 0.3) + seed); vec3 p = position; p.y = t * 4.0; p.x += sin(uTime + seed * 20.0) * t * 0.6; p.z += cos(uTime * 0.8 + seed * 13.0) * t * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = clamp(14.0 / -mv.z, 1.0, 5.0); vA = 1.0 - t; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(1.0, 0.55, 0.15, vA); }`,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    return pts;
  }, []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    if (fire.current) fire.current.intensity = (8 + 22 * night.value) * (0.85 + 0.15 * Math.sin(t * 9) * Math.sin(t * 5.7));
    flames.current.forEach((f, k) => {
      if (!f) return;
      const s = 0.9 + 0.25 * Math.sin(t * (9 + k * 2) + k);
      f.scale.set(0.9 * s, 1.5 * s, 1);
      f.position.y = fy0 + 0.6 + 0.1 * Math.sin(t * 7 + k);
    });
    (embers.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
  });
  const [fx, fz] = X.fire;
  const fy0 = floorAt(fx, fz);
  const [rx, rz] = X.rack;
  const ry = floorAt(rx, rz);
  const wood = <meshStandardMaterial color="#5b4129" roughness={0.9} />;
  return (
    <group>
      {X.tents.map(([x, z, yaw], k) => (
        <group key={k} position={[x, floorAt(x, z), z]} rotation={[0, yaw, 0]}>
          <mesh geometry={tentGeo} castShadow receiveShadow>
            <meshStandardMaterial map={canvas} side={THREE.DoubleSide} roughness={0.95} />
          </mesh>
          <mesh position={[0, 2.1, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 3.8, 5]} />
            {wood}
          </mesh>
          {[-1.75, 1.75].map((zz) => (
            <mesh key={zz} position={[0, 1.05, zz]}>
              <cylinderGeometry args={[0.05, 0.06, 2.2, 5]} />
              {wood}
            </mesh>
          ))}
          {/* a pelt laid out inside */}
          <mesh position={[0, 0.04, 0.2]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[0.8, 10]} />
            <meshStandardMaterial color="#6b4a2e" roughness={1} />
          </mesh>
        </group>
      ))}
      {/* the fire: a ring of stones, crossed logs, flames, embers */}
      <group position={[fx, fy0, fz]}>
        {Array.from({ length: 10 }, (_, k) => {
          const a = (k / 10) * Math.PI * 2;
          return (
            <mesh key={k} position={[Math.cos(a) * 0.95, 0.12, Math.sin(a) * 0.95]} scale={[0.32, 0.22, 0.26]} rotation={[0, a, 0]}>
              <dodecahedronGeometry args={[1, 0]} />
              <meshStandardMaterial color="#6e6a62" roughness={0.95} flatShading />
            </mesh>
          );
        })}
        {[0, 1.1, 2.2].map((a) => (
          <mesh key={a} position={[0, 0.18, 0]} rotation={[0.25, a, Math.PI / 2]}>
            <cylinderGeometry args={[0.09, 0.11, 1.4, 6]} />
            <meshStandardMaterial color="#3a2a1c" roughness={1} emissive="#7a2a08" emissiveIntensity={0.6} />
          </mesh>
        ))}
        <primitive object={embers} />
        <pointLight ref={fire} position={[0, 1.4, 0]} color="#ff9a4a" intensity={10} distance={24} decay={1.3} />
      </group>
      {[0, 1, 2].map((k) => (
        <sprite key={k} ref={(el) => (flames.current[k] = el)} position={[fx + (k - 1) * 0.2, fy0 + 0.6, fz + (k % 2) * 0.15]} scale={[0.9, 1.5, 1]}>
          <spriteMaterial map={flameTex} color="#ffb35c" transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </sprite>
      ))}
      {/* log seats */}
      {FOREST_X.seats.map(([x, z, a], k) => (
        <mesh key={k} position={[x, floorAt(x, z) + 0.24, z]} rotation={[0, -a, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.26, 0.28, 1.9, 8]} />
          <meshStandardMaterial color="#6a4d32" roughness={0.95} />
        </mesh>
      ))}
      {/* the trap rack: a frame with the iron jaws hanging on pegs */}
      <group position={[rx, ry, rz]} rotation={[0, 0.5, 0]}>
        {[-0.9, 0.9].map((x) => (
          <mesh key={x} position={[x, 0.95, 0]} castShadow>
            <boxGeometry args={[0.12, 1.9, 0.12]} />
            {wood}
          </mesh>
        ))}
        <mesh position={[0, 1.75, 0]}>
          <boxGeometry args={[2.0, 0.1, 0.1]} />
          {wood}
        </mesh>
        {[-0.5, 0, 0.5].map((x) => (
          <group key={x} position={[x, 1.25, 0.08]}>
            <TrapModel open={false} scale={0.8} upright />
          </group>
        ))}
      </group>
      {/* a drying rack with pelts */}
      <group position={[X.x - 7, floorAt(X.x - 7, X.z + 6), X.z + 6]} rotation={[0, -0.4, 0]}>
        {[-1.2, 1.2].map((x) => (
          <mesh key={x} position={[x, 0.9, 0]}>
            <cylinderGeometry args={[0.05, 0.06, 1.8, 5]} />
            {wood}
          </mesh>
        ))}
        <mesh position={[0, 1.75, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.04, 2.6, 5]} />
          {wood}
        </mesh>
        {[-0.6, 0.5].map((x) => (
          <mesh key={x} position={[x, 1.25, 0]}>
            <planeGeometry args={[0.8, 1.0]} />
            <meshStandardMaterial color="#7a5232" side={THREE.DoubleSide} roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** iron jaws: a ring of teeth, open flat or snapped shut */
function TrapModel({ open, scale = 1, upright = false }: { open: boolean; scale?: number; upright?: boolean }) {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const ring = new THREE.TorusGeometry(0.32, 0.025, 5, 16);
    ring.rotateX(Math.PI / 2);
    parts.push(ring);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const tooth = new THREE.ConeGeometry(0.035, 0.12, 4);
      tooth.translate(0, 0.06, 0);
      tooth.translate(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3);
      parts.push(tooth);
    }
    const plate = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10);
    parts.push(plate);
    return mergeAll(parts);
  }, []);
  return (
    <group scale={scale} rotation={upright ? [Math.PI / 2, 0, 0] : [0, 0, 0]}>
      <mesh geometry={geo} scale={open ? [1, 1, 1] : [1, 1, 0.35]} castShadow>
        <meshStandardMaterial color="#52525b" metalness={0.6} roughness={0.5} />
      </mesh>
    </group>
  );
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  const nonIdx = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of nonIdx) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of nonIdx) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

// ---------------------------------------------------------------
// 竹林
// ---------------------------------------------------------------
function Bamboo() {
  const { stalks, leaves } = useMemo(() => {
    const rand = seeded(41);
    const clumps = FOREST_X.bamboo.clumps;
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const tops: [number, number, number, number][] = [];
    for (const [cx, cz, s] of clumps) {
      const n = 7 + Math.floor(rand() * 7);
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * 0.75 * s;
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        const h = 8 + rand() * 6;
        const lean = new THREE.Euler((rand() - 0.5) * 0.12, 0, (rand() - 0.5) * 0.12);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, floorAt(x, z) - 0.1, z), new THREE.Quaternion().setFromEuler(lean), new THREE.Vector3(0.9 + rand() * 0.4, h, 0.9 + rand() * 0.4));
        mats.push(m);
        cols.push(new THREE.Color().setHSL(0.2 + rand() * 0.05, 0.45, 0.32 + rand() * 0.12));
        const top = new THREE.Vector3(0, 1, 0).applyEuler(lean).multiplyScalar(h);
        tops.push([x + top.x, floorAt(x, z) + top.y, z + top.z, h]);
      }
    }
    // a stalk: thin, with a node ring every so often (baked into the geometry along its unit height)
    const g = new THREE.CylinderGeometry(0.055, 0.07, 1, 6, 10, true).translate(0, 0.5, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const node = Math.abs(((y * 10) % 1) - 0.5) < 0.08 ? 1.25 : 1;
      p.setX(i, p.getX(i) * node);
      p.setZ(i, p.getZ(i) * node);
    }
    g.computeVertexNormals();
    const stalks = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 }), mats.length);
    mats.forEach((m, i) => {
      stalks.setMatrixAt(i, m);
      stalks.setColorAt(i, cols[i]);
    });
    stalks.castShadow = true;
    stalks.receiveShadow = true;
    // leaves: narrow sprays along the upper third of each stalk
    const leafTex = canvasTex(128, 128, (c) => {
      c.clearRect(0, 0, 128, 128);
      const r = seeded(43);
      for (let i = 0; i < 26; i++) {
        c.save();
        c.translate(64, 64);
        c.rotate(r() * Math.PI * 2);
        c.fillStyle = `hsl(${85 + r() * 25}, ${40 + r() * 20}%, ${28 + r() * 18}%)`;
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(5, -25, 0, -58);
        c.quadraticCurveTo(-5, -25, 0, 0);
        c.fill();
        c.restore();
      }
    });
    const lm = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
    const per = 7;
    const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), lm, tops.length * per);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let i = 0;
    for (const [x, y, z, h] of tops)
      for (let k = 0; k < per; k++) {
        const t = rand();
        q.setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI * 2, rand() * Math.PI));
        const s = 1.6 + rand() * 1.4;
        m.compose(new THREE.Vector3(x + (rand() - 0.5) * 2.2, y - t * h * 0.35, z + (rand() - 0.5) * 2.2), q, new THREE.Vector3(s, s, s));
        leaves.setMatrixAt(i++, m);
      }
    leaves.castShadow = true;
    return { stalks, leaves };
  }, []);
  return (
    <group>
      <primitive object={stalks} />
      <primitive object={leaves} />
    </group>
  );
}

// ---------------------------------------------------------------
// 石灯笼 and the paved path
// ---------------------------------------------------------------
function Lanterns() {
  const { stone, pavers, glows, pools } = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const base = new THREE.CylinderGeometry(0.42, 0.5, 0.3, 6).translate(0, 0.15, 0);
    const post = new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6).translate(0, 0.75, 0);
    const shelf = new THREE.CylinderGeometry(0.36, 0.32, 0.14, 6).translate(0, 1.27, 0);
    const box = new THREE.BoxGeometry(0.42, 0.42, 0.42).translate(0, 1.55, 0);
    const roof = new THREE.ConeGeometry(0.55, 0.4, 6).translate(0, 1.96, 0);
    const knob = new THREE.SphereGeometry(0.08, 6, 4).translate(0, 2.2, 0);
    parts.push(base, post, shelf, box, roof, knob);
    const g = mergeAll(parts);
    const L = FOREST_X.lanterns;
    const stone = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#8b877c', roughness: 0.95, flatShading: true }), L.length);
    const m = new THREE.Matrix4();
    L.forEach(([x, z], i) => {
      m.makeRotationY(i * 0.7).setPosition(x, floorAt(x, z) - 0.05, z);
      stone.setMatrixAt(i, m);
    });
    stone.castShadow = true;
    // pavers along the path
    const P = FOREST_X.lanternPath;
    const spots: [number, number, number][] = [];
    const rand = seeded(47);
    for (let k = 0; k + 1 < P.length; k++) {
      const [ax, az] = P[k];
      const [bx, bz] = P[k + 1];
      const Ln = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < Ln; d += 1.15) spots.push([ax + ((bx - ax) * d) / Ln + (rand() - 0.5) * 0.4, az + ((bz - az) * d) / Ln + (rand() - 0.5) * 0.4, rand() * Math.PI]);
    }
    const pavers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 7), new THREE.MeshStandardMaterial({ color: '#7d7a70', roughness: 0.95, flatShading: true }), spots.length);
    spots.forEach(([x, z, a], i) => {
      m.compose(new THREE.Vector3(x, floorAt(x, z) + 0.02, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(1 + (i % 3) * 0.1, 1, 0.8));
      pavers.setMatrixAt(i, m);
    });
    pavers.receiveShadow = true;
    const glows = glowTex('rgba(255,214,140,1)', 'rgba(255,170,60,0)');
    const pools = glowTex('rgba(255,190,110,0.55)', 'rgba(255,160,60,0)');
    return { stone, pavers, glows, pools };
  }, []);
  const haloMat = useMemo(() => new THREE.SpriteMaterial({ map: glows, color: '#ffd28a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }), [glows]);
  const poolMat = useMemo(() => new THREE.MeshBasicMaterial({ map: pools, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }), [pools]);
  const paneMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2016', emissive: '#ffb050', emissiveIntensity: 0 }), []);
  useFrame((st) => {
    const n = night.value;
    const fl = 0.9 + 0.1 * Math.sin(st.clock.elapsedTime * 6);
    haloMat.opacity = Math.min(1, n * 1.2) * 0.9 * fl;
    poolMat.opacity = Math.min(1, n * 1.3) * fl;
    paneMat.emissiveIntensity = 0.3 + n * 2.6 * fl;
  });
  return (
    <group>
      <primitive object={stone} />
      <primitive object={pavers} />
      {FOREST_X.lanterns.map(([x, z], i) => {
        const y = floorAt(x, z);
        return (
          <group key={i} position={[x, y, z]}>
            <mesh position={[0, 1.55, 0]} material={paneMat}>
              <boxGeometry args={[0.44, 0.3, 0.44]} />
            </mesh>
            <sprite position={[0, 1.55, 0]} scale={1.6} material={haloMat} />
            <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} material={poolMat}>
              <planeGeometry args={[11, 11]} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------
// 古塔
// ---------------------------------------------------------------
function octShape(r: number, cut?: number) {
  // an octagon with flats on the axes (r to the flats); cut: keep only dx + dz > cut
  const R = r / Math.cos(Math.PI / 8);
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
    pts.push(new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R));
  }
  let poly = pts;
  if (cut !== undefined) {
    // clip by x + y > cut (Sutherland-Hodgman, one edge)
    const inside = (p: THREE.Vector2) => p.x + p.y > cut;
    const out: THREE.Vector2[] = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) {
        const t = (cut - a.x - a.y) / (b.x + b.y - a.x - a.y);
        out.push(new THREE.Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
      }
    }
    poly = out;
  }
  return new THREE.Shape(poly);
}
/** an octagonal drum from y0 to y1 (the shape's (x, y) lies in world (x, z)) */
function drum(shape: THREE.Shape, y0: number, y1: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  // rotating +90 about x takes the shape's y to world z and the extrusion (along +z) to straight down
  g.rotateX(Math.PI / 2);
  g.translate(0, y1, 0);
  g.computeVertexNormals();
  return g;
}
function Pagoda() {
  const P = FOREST_X.pagoda;
  const { brick, geos, eaves, rubble } = useMemo(() => {
    const brick = canvasTex(256, 256, (g) => {
      g.fillStyle = '#6f6a60';
      g.fillRect(0, 0, 256, 256);
      const r = seeded(53);
      for (let y = 0; y < 256; y += 16)
        for (let x = (y / 16) % 2 ? -16 : 0; x < 256; x += 32) {
          const l = 34 + r() * 14;
          g.fillStyle = `hsl(${30 + r() * 15}, ${6 + r() * 8}%, ${l}%)`;
          g.fillRect(x + 1, y + 1, 30, 14);
        }
      // moss creeping down
      for (let i = 0; i < 140; i++) {
        g.fillStyle = `rgba(${50 + r() * 30},${80 + r() * 30},${30 + r() * 20},${0.25 + r() * 0.3})`;
        g.beginPath();
        g.arc(r() * 256, Math.pow(r(), 2) * 256, 2 + r() * 9, 0, Math.PI * 2);
        g.fill();
      }
    });
    brick.repeat.set(0.25, 0.25);
    const geos = [drum(octShape(P.base), -0.6, P.baseH), drum(octShape(P.s1), P.baseH - 0.1, P.s1H), drum(octShape(P.s2, -1.5), P.s1H - 0.1, P.s2H)];
    // eaves: thin dark slabs sticking out, broken (only some sides survive)
    const eaves: THREE.BufferGeometry[] = [];
    for (const [r, y] of [[P.s1 + 1.3, P.s1H - 0.35], [P.s2 + 1.1, P.s2H - 0.3]] as const) {
      const g = drum(octShape(r, y > P.s1H ? -1.5 : -4.5), y - 0.22, y);
      eaves.push(g);
    }
    // rubble: tumbled bricks over the ramps
    const rubble: [number, number, number, number, number][] = [];
    const r = seeded(59);
    for (let k = 0; k < 160; k++) {
      const dx = (r() - 0.5) * 3.6;
      const dz = -P.s1 - r() * (P.base + 5 - P.s1);
      const s = pagodaSlope(dx, dz);
      if (s !== null) rubble.push([P.x + dx, s + 0.05, P.z + dz, 0.2 + r() * 0.3, r() * 6]);
    }
    for (let k = 0; k < 60; k++) {
      const dx = P.s2 + r() * (P.s1 - P.s2);
      const dz = 1.2 + (r() - 0.5) * 2.8;
      const s = pagodaSlope(dx, dz);
      if (s !== null) rubble.push([P.x + dx, s + 0.05, P.z + dz, 0.2 + r() * 0.25, r() * 6]);
    }
    for (let k = 0; k < 50; k++) {
      // scattered round the foot
      const a = r() * Math.PI * 2;
      const d = P.base + 0.5 + r() * 4;
      const x = P.x + Math.cos(a) * d;
      const z = P.z + Math.sin(a) * d;
      rubble.push([x, floorAt(x, z) + 0.08, z, 0.15 + r() * 0.25, r() * 6]);
    }
    return { brick, geos, eaves, rubble };
  }, []);
  const rubbleMesh = useMemo(() => {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.55, 0.75), new THREE.MeshStandardMaterial({ color: '#7a7368', roughness: 0.95, flatShading: true }), rubble.length);
    const m = new THREE.Matrix4();
    rubble.forEach(([x, y, z, s, a], i) => {
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(a * 0.3, a, a * 0.2)), new THREE.Vector3(s * 1.4, s, s));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    return im;
  }, [rubble]);
  const stoneMat = useMemo(() => new THREE.MeshStandardMaterial({ map: brick, roughness: 0.95 }), [brick]);
  // world-space uvs so the bricks don't stretch: use a triplanar-ish box projection via onBeforeCompile
  useMemo(() => {
    stoneMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW; varying vec3 vPN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz; vPN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vPW; varying vec3 vPN;')
        .replace(
          '#include <map_fragment>',
          `vec3 bw = abs(vPN); bw /= (bw.x + bw.y + bw.z);
           vec4 tx = texture2D(map, vPW.zy * 0.25); vec4 ty = texture2D(map, vPW.xz * 0.25); vec4 tz = texture2D(map, vPW.xy * 0.25);
           diffuseColor *= tx * bw.x + ty * bw.y + tz * bw.z;`
        );
    };
  }, [stoneMat]);
  const spireMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#77716a', roughness: 0.95, flatShading: true }), []);
  return (
    <group>
      <group position={[P.x, floorAt(P.x, P.z) * 0, P.z]}>
        {geos.map((g, k) => (
          <mesh key={k} geometry={g} material={stoneMat} castShadow receiveShadow />
        ))}
        {eaves.map((g, k) => (
          <mesh key={k} geometry={g} castShadow>
            <meshStandardMaterial color="#3b3a36" roughness={0.9} />
          </mesh>
        ))}
        {/* the doorway on storey 1's south face, dark */}
        <mesh position={[2.6, (P.baseH + P.s1H) / 2 - 0.2, -P.s1 - 0.03]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[1.4, 2.4]} />
          <meshStandardMaterial color="#141210" roughness={1} />
        </mesh>
      </group>
      <primitive object={rubbleMesh} />
      {/* the fallen spire: three drums lying in the grass */}
      {FOREST_X.spire.map(([x, z, r, yaw], k) => (
        <mesh key={k} position={[x, floorAt(x, z) + r * 0.85, z]} rotation={[0, yaw, Math.PI / 2]} material={spireMat} castShadow receiveShadow>
          <cylinderGeometry args={[r, r * 1.05, 3.2 - k * 0.5, 8]} />
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// 沼泽
// ---------------------------------------------------------------
function Swamp() {
  const S = FOREST_X.swamp;
  const { water, reeds, snags } = useMemo(() => {
    const water = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { uTime: { value: 0 }, uNight: night, uC: { value: new THREE.Vector3(S.x, S.z, S.r) } },
      vertexShader: /* glsl */ `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uNight; uniform vec3 uC; varying vec3 vWP;
        ${GLSL_NOISE}
        void main(){
          vec2 p = vWP.xz;
          float n = noise(p * 0.35 + uTime * 0.05) * 0.6 + noise(p * 1.7) * 0.4;
          vec3 col = mix(vec3(0.07, 0.08, 0.04), vec3(0.17, 0.2, 0.08), n);
          // scum and duckweed in patches
          col = mix(col, vec3(0.28, 0.36, 0.1), smoothstep(0.62, 0.75, noise(p * 0.9 + 3.0)) * 0.8);
          // bubbles rising here and there
          vec2 cell = floor(p * 0.6);
          float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float ph = fract(uTime * 0.3 + h);
          float b = smoothstep(0.12, 0.0, abs(length(fract(p * 0.6) - 0.5) - ph * 0.3)) * step(0.8, h) * (1.0 - ph);
          col += vec3(0.3, 0.35, 0.15) * b;
          col *= 1.0 - uNight * 0.8;
          float edge = smoothstep(uC.z + 3.0, uC.z - 1.0, length(p - uC.xy));
          gl_FragColor = vec4(col, 0.92 * edge);
        }`,
    });
    const rand = seeded(61);
    const reedTex = canvasTex(64, 128, (g) => {
      g.clearRect(0, 0, 64, 128);
      for (let i = 0; i < 14; i++) {
        const x = 6 + rand() * 52;
        g.strokeStyle = `hsl(${55 + rand() * 25}, 35%, ${25 + rand() * 15}%)`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, 128);
        g.quadraticCurveTo(x + (rand() - 0.5) * 10, 60, x + (rand() - 0.5) * 18, 6 + rand() * 30);
        g.stroke();
        if (rand() < 0.4) {
          g.fillStyle = '#4a3220';
          g.fillRect(x - 2, 20 + rand() * 20, 4, 14); // a cattail head
        }
      }
    });
    const card = mergeAll([new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY(Math.PI / 2)]);
    const uv = new Float32Array(card.attributes.position.count * 2);
    for (let i = 0; i < card.attributes.position.count; i++) {
      const x = card.attributes.position.getX(i) + card.attributes.position.getZ(i);
      uv[i * 2] = x + 0.5;
      uv[i * 2 + 1] = card.attributes.position.getY(i);
    }
    card.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const spots: [number, number, number][] = [];
    for (let k = 0; k < 9000 && spots.length < 1400; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (S.r + 3);
      const x = S.x + Math.cos(a) * d;
      const z = S.z + Math.sin(a) * d;
      // thickest round the rim and on the hummocks
      const y = floorAt(x, z);
      if (rand() > (d > S.r - 6 ? 0.9 : y > FOREST.waterY ? 0.7 : 0.18)) continue;
      spots.push([x, z, 1.1 + rand() * 1.1]);
    }
    const reeds = new THREE.InstancedMesh(card, new THREE.MeshStandardMaterial({ map: reedTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, s], i) => {
      m.compose(new THREE.Vector3(x, Math.max(floorAt(x, z), FOREST.waterY - 0.3), z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI), new THREE.Vector3(s * 0.8, s, s * 0.8));
      reeds.setMatrixAt(i, m);
    });
    // dead snags: grey trunks with a few bare limbs
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, z, a] of S.snags) {
      const h = 4 + rand() * 4;
      const y = floorAt(x, z) - 0.3;
      parts.push(new THREE.CylinderGeometry(0.18, 0.42, h, 6).translate(x, y + h / 2, z));
      for (let k = 0; k < 3; k++) {
        const L = 1.2 + rand() * 1.6;
        const b = new THREE.CylinderGeometry(0.04, 0.1, L, 4).translate(0, L / 2, 0);
        b.rotateZ(0.7 + rand() * 0.6);
        b.rotateY(a + k * 2.1);
        b.translate(x, y + h * (0.5 + k * 0.15), z);
        parts.push(b);
      }
    }
    const snags = mergeAll(parts);
    return { water, reeds, snags };
  }, []);
  const mist = useMemo(() => {
    const rand = seeded(67);
    return Array.from({ length: 34 }, () => {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (S.r + 2);
      return { x: S.x + Math.cos(a) * d, z: S.z + Math.sin(a) * d, y: 0.6 + rand() * 1.6, s: 7 + rand() * 6, ph: rand() * 6 };
    });
  }, []);
  const puff = useMemo(() => cloudPuffTexture(), []);
  const mistMat = useMemo(() => new THREE.SpriteMaterial({ map: puff, color: '#b9c79a', transparent: true, opacity: 0.45, depthWrite: false }), [puff]);
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    water.uniforms.uTime.value = t;
    mistMat.opacity = 0.42 * (1 - night.value * 0.6);
    mist.forEach((m, k) => {
      const s = refs.current[k];
      if (s) s.position.set(m.x + Math.sin(t * 0.07 + m.ph) * 2, m.y + Math.sin(t * 0.3 + m.ph) * 0.2, m.z + Math.cos(t * 0.05 + m.ph) * 2);
    });
  });
  return (
    <group>
      <mesh position={[S.x, FOREST.waterY, S.z]} rotation={[-Math.PI / 2, 0, 0]} material={water} renderOrder={3}>
        <circleGeometry args={[S.r + 3, 56]} />
      </mesh>
      <primitive object={reeds} />
      <mesh geometry={snags} castShadow>
        <meshStandardMaterial color="#5f5a50" roughness={1} />
      </mesh>
      {mist.map((m, k) => (
        <sprite key={k} ref={(el) => (refs.current[k] = el)} position={[m.x, m.y, m.z]} scale={[m.s, m.s * 0.45, 1]} material={mistMat} />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// zip lines between the lookouts
// ---------------------------------------------------------------
function Ziplines() {
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    FOREST_X.zips.forEach((_, k) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 24; i++) pts.push(new THREE.Vector3(...zipAt(k, i / 24)));
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.035, 5, false));
      const Z = zipLine(k);
      // a lashing ring at each end
      for (const [x, y, z] of [[Z.ax, Z.ay, Z.az], [Z.bx, Z.by, Z.bz]]) parts.push(new THREE.TorusGeometry(0.12, 0.03, 5, 10).translate(x, y, z));
    });
    return mergeAll(parts);
  }, []);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color="#8c6f47" roughness={0.9} />
    </mesh>
  );
}

// ---------------------------------------------------------------
// herbs and traps (from the live map state)
// ---------------------------------------------------------------
function Herbs() {
  const slots = 10;
  const groups = useRef<(THREE.Group | null)[]>([]);
  const glows = useRef<(THREE.Sprite | null)[]>([]);
  const berries = useRef<(THREE.Mesh | null)[]>([]);
  const tex = useMemo(() => glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), []);
  const red = useMemo(() => new THREE.MeshStandardMaterial({ color: '#dc2626', emissive: '#ef4444', emissiveIntensity: 0.8 }), []);
  const blue = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0ea5e9', emissive: '#38bdf8', emissiveIntensity: 0.8 }), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const H = mapRuntime.wood.herbs;
    for (let k = 0; k < slots; k++) {
      const g = groups.current[k];
      if (!g) continue;
      const h = H[k];
      g.visible = !!h && h.t <= 0;
      if (!g.visible || !h) continue;
      g.position.set(h.x, floorAt(h.x, h.z), h.z);
      const b = berries.current[k];
      if (b) b.material = h.kind === 0 ? red : blue;
      const s = glows.current[k];
      if (s) {
        (s.material as THREE.SpriteMaterial).color.set(h.kind === 0 ? '#fca5a5' : '#7dd3fc');
        (s.material as THREE.SpriteMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 3 + k);
      }
    }
  });
  const leaf = <meshStandardMaterial color="#3f6b23" roughness={0.8} side={THREE.DoubleSide} />;
  return (
    <group>
      {Array.from({ length: slots }, (_, k) => (
        <group key={k} ref={(el) => (groups.current[k] = el)} visible={false}>
          {[0, 1.3, 2.6, 3.9, 5.2].map((a) => (
            <mesh key={a} position={[Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15]} rotation={[0.6, a, 0]}>
              <planeGeometry args={[0.14, 0.45]} />
              {leaf}
            </mesh>
          ))}
          <mesh ref={(el) => (berries.current[k] = el)} position={[0, 0.42, 0]} material={red}>
            <sphereGeometry args={[0.09, 8, 6]} />
          </mesh>
          <sprite ref={(el) => (glows.current[k] = el)} position={[0, 0.45, 0]} scale={1.6}>
            <spriteMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
        </group>
      ))}
    </group>
  );
}

function Traps() {
  const slots = 24;
  const groups = useRef<(THREE.Group | null)[]>([]);
  const jaws = useRef<(THREE.Group | null)[]>([]);
  useFrame(() => {
    const T = mapRuntime.wood.traps;
    for (let k = 0; k < slots; k++) {
      const g = groups.current[k];
      if (!g) continue;
      const t = T[k];
      // a set trap shows only to its own side, or once you're within a few steps of it
      const near = t && Math.hypot(t.x - mapRuntime.viewX, t.z - mapRuntime.viewZ) < 4.5;
      g.visible = !!t && (t.sprung >= 0 || t.owner === mapRuntime.viewSide || near);
      if (!g.visible || !t) continue;
      g.position.set(t.x, floorAt(t.x, t.z) + 0.03, t.z);
      const j = jaws.current[k];
      if (j) j.scale.set(1, 1, t.sprung >= 0 ? 0.35 : 1);
    }
  });
  const geo = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const ring = new THREE.TorusGeometry(0.32, 0.025, 5, 16).rotateX(Math.PI / 2);
    parts.push(ring);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      parts.push(new THREE.ConeGeometry(0.035, 0.12, 4).translate(Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3));
    }
    parts.push(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 10));
    return mergeAll(parts);
  }, []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#52525b', metalness: 0.6, roughness: 0.5 }), []);
  return (
    <group>
      {Array.from({ length: slots }, (_, k) => (
        <group key={k} ref={(el) => (groups.current[k] = el)} visible={false}>
          <group ref={(el) => (jaws.current[k] = el)}>
            <mesh geometry={geo} material={mat} />
          </group>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------
// 祖坛: a stone altar with an incense burner; its flame and the light pillar over it show whose it is,
// and a ring on the ground fills as someone lights it
// ---------------------------------------------------------------
const MINE = new THREE.Color('#4ade80');
const THEIRS = new THREE.Color('#f87171');
const NOBODY = new THREE.Color('#e7e5e4');
function Shrines() {
  const parts = useMemo(
    () =>
      SHRINES.map(() => {
        const ring = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { uProg: { value: 0 }, uCol: { value: new THREE.Color() }, uBase: { value: new THREE.Color() }, uTime: { value: 0 } },
          vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
            uniform float uProg; uniform vec3 uCol; uniform vec3 uBase; uniform float uTime; varying vec2 vUv;
            void main(){
              vec2 p = vUv - 0.5; float r = length(p) * 2.0;
              float band = smoothstep(0.84, 0.88, r) * (1.0 - smoothstep(0.97, 1.0, r));
              float a = atan(p.x, p.y) / 6.28318 + 0.5;
              float fill = step(a, abs(uProg));
              vec3 col = mix(uBase, uCol, fill);
              float inner = (1.0 - smoothstep(0.0, 0.84, r)) * 0.10 * (0.7 + 0.3 * sin(uTime * 2.0));
              gl_FragColor = vec4(col, band * (0.55 + 0.4 * fill) + inner);
            }`,
        });
        const beam = new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: { uCol: { value: new THREE.Color() }, uA: { value: 0 } },
          vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `uniform vec3 uCol; uniform float uA; varying vec2 vUv;
            void main(){ float e = 1.0 - abs(vUv.x - 0.5) * 2.0; gl_FragColor = vec4(uCol * uA * e * (1.0 - vUv.y) , 1.0); }`,
          fog: false,
        });
        const flame = new THREE.SpriteMaterial({ map: glowTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
        return { ring, beam, flame };
      }),
    []
  );
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const S = mapRuntime.shrine;
    const mine = mapRuntime.viewSide;
    SHRINES.forEach((_, k) => {
      const own = S.own[k];
      const col = own < 0 ? NOBODY : own === mine ? MINE : THEIRS;
      const P = parts[k];
      // the ring fills toward whoever is lighting it
      const lean = S.prog[k] > 0 ? 0 : 1;
      P.ring.uniforms.uProg.value = Math.abs(S.prog[k]);
      P.ring.uniforms.uCol.value.copy(lean === mine ? MINE : THEIRS);
      P.ring.uniforms.uBase.value.copy(col).multiplyScalar(own < 0 ? 0.45 : 0.7);
      P.ring.uniforms.uTime.value = t;
      P.beam.uniforms.uCol.value.copy(col);
      P.beam.uniforms.uA.value = (own < 0 ? 0.12 : 0.45) * (0.85 + 0.15 * Math.sin(t * 1.7 + k));
      P.flame.color.copy(own < 0 ? new THREE.Color('#9ca3af') : col);
      P.flame.opacity = own < 0 ? 0.35 : 0.95;
      const L = lights.current[k];
      if (L) {
        L.color.copy(col);
        L.intensity = own < 0 ? 0 : (3 + 9 * mapRuntime.night) * (0.85 + 0.15 * Math.sin(t * 9 + k));
      }
    });
  });
  return (
    <group>
      {SHRINES.map((sh, k) => (
        <group key={k} position={[sh.x, sh.y, sh.z]}>
          {/* the altar: a stepped stone block, a bronze burner with three legs on it */}
          <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.9, 0.5, 1.3]} />
            <meshStandardMaterial color="#7d776c" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.62, 0]} castShadow>
            <boxGeometry args={[1.4, 0.24, 0.9]} />
            <meshStandardMaterial color="#8d867a" roughness={0.95} />
          </mesh>
          <mesh position={[0, 0.98, 0]} castShadow>
            <cylinderGeometry args={[0.34, 0.26, 0.42, 12]} />
            <meshStandardMaterial color="#5c4a2a" metalness={0.6} roughness={0.45} />
          </mesh>
          {[0, 2.1, 4.2].map((a) => (
            <mesh key={a} position={[Math.cos(a) * 0.36, 0.84, Math.sin(a) * 0.36]} rotation={[0, -a, 0.25]}>
              <cylinderGeometry args={[0.03, 0.04, 0.24, 5]} />
              <meshStandardMaterial color="#4a3a20" metalness={0.5} roughness={0.5} />
            </mesh>
          ))}
          {/* three sticks of incense */}
          {[-0.08, 0, 0.08].map((x) => (
            <mesh key={x} position={[x, 1.38, 0]}>
              <cylinderGeometry args={[0.012, 0.012, 0.5, 4]} />
              <meshStandardMaterial color="#7f1d1d" />
            </mesh>
          ))}
          <sprite position={[0, 1.7, 0]} scale={[0.7, 0.9, 1]} material={parts[k].flame} />
          <pointLight ref={(el) => (lights.current[k] = el)} position={[0, 2, 0]} intensity={0} distance={14} decay={1.4} />
          <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} material={parts[k].ring} renderOrder={4}>
            <planeGeometry args={[SHRINE.r * 2, SHRINE.r * 2]} />
          </mesh>
          {/* a pillar of light you can see across the forest */}
          {[0, Math.PI / 2].map((r) => (
            <mesh key={r} position={[0, 21, 0]} rotation={[0, r, 0]} material={parts[k].beam} renderOrder={6}>
              <planeGeometry args={[1.4, 40]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** everything above, plus the night value they share */
export function ForestExtras() {
  useFrame(() => {
    night.value = mapRuntime.night;
  });
  void riverZ;
  // test hook: __TQ_SKIPX = ['Bamboo', ...] leaves those parts out
  const skip: string[] = (globalThis as any).__TQ_SKIPX ?? [];
  const parts: [string, React.FC][] = [['Waterfall', Waterfall], ['Camp', Camp], ['Bamboo', Bamboo], ['Lanterns', Lanterns], ['Pagoda', Pagoda], ['Swamp', Swamp], ['Ziplines', Ziplines], ['Herbs', Herbs], ['Traps', Traps], ['Shrines', Shrines]];
  return (
    <group>
      {parts.filter(([n]) => !skip.includes(n)).map(([n, C]) => (
        <C key={n} />
      ))}
    </group>
  );
}
