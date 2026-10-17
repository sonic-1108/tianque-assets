import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { LA, laHeight, mapRuntime } from '../../maps';
import { seeded, GLSL_NOISE } from '../Scenery';
import { mergeGeos } from './Coast';

// 洛城午后, the built part: Spanish houses on the hill, cars (parked and on the freeway), the freeway and
// its overpass, the downtown towers (the finance houses' names on their crowns), the mountains, and the loot.

const H = laHeight;
const CAR_COLORS = ['#f1efe9', '#b8bcc0', '#1d2a44', '#8c1c1c', '#2e4a35', '#c9b48a', '#202022', '#3a5f8f'];

// ---------------------------------------------------------------
// Spanish revival houses: stucco walls, red clay tile roofs, arched dark windows, a chimney
// ---------------------------------------------------------------
function tileRoofMat() {
  const m = new THREE.MeshStandardMaterial({ color: '#b5502e', roughness: 0.75 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vRP;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // barrel tiles: ridges running down the slope, courses across
          float u = fract((vRP.x + vRP.z) * 3.2);
          float c = fract(vRP.y * 4.0);
          float ridge = 0.75 + 0.25 * sin(u * 6.2832);
          diffuseColor.rgb *= ridge * (0.85 + 0.15 * smoothstep(0.0, 0.15, c)) * (0.85 + 0.3 * noise(vRP.xz * 1.3));
        }`
      );
  };
  return m;
}
function Houses() {
  const { walls, roofs, glass } = useMemo(() => {
    const rand = seeded(61);
    const wallParts: THREE.BufferGeometry[] = [];
    const roofParts: THREE.BufferGeometry[] = [];
    const glassParts: THREE.BufferGeometry[] = [];
    const stucco = ['#efe6d4', '#f2eadc', '#e8d9bd', '#f4efe6', '#e9d2b6', '#dfe2d8'];
    const col = new THREE.Color();
    const paint = (g: THREE.BufferGeometry, c: THREE.Color) => {
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    for (const h of LA.houses) {
      const two = h.kind === 1;
      const wh = two ? 6.4 : 3.6;
      col.set(stucco[Math.floor(rand() * stucco.length)]);
      const place = (g: THREE.BufferGeometry) => {
        g.rotateY(h.yaw);
        g.translate(h.x, h.y, h.z);
        return g;
      };
      const body = new THREE.BoxGeometry(h.w, wh, h.d).translate(0, wh / 2, 0);
      wallParts.push(paint(place(body).toNonIndexed(), col));
      // a lower wing to one side
      if (h.kind !== 1) {
        const ww = h.w * 0.45;
        const wing = new THREE.BoxGeometry(ww, 3.0, h.d * 0.7).translate((h.w / 2 + ww / 2 - 0.5) * (h.kind ? 1 : -1), 1.5, h.d * 0.15);
        wallParts.push(paint(place(wing).toNonIndexed(), col));
        const wr = new THREE.ConeGeometry(Math.hypot(ww, h.d * 0.7) / 2 + 0.4, 1.2, 4, 1).rotateY(Math.PI / 4).scale(ww / Math.hypot(ww, h.d * 0.7) * 1.05, 1, (h.d * 0.7) / Math.hypot(ww, h.d * 0.7) * 1.05).translate((h.w / 2 + ww / 2 - 0.5) * (h.kind ? 1 : -1), 3.6, h.d * 0.15);
        roofParts.push(place(wr).toNonIndexed());
      }
      // the main hip roof, low pitched, with an overhang
      const R = Math.hypot(h.w, h.d) / 2 + 0.6;
      const roof = new THREE.ConeGeometry(R, two ? 2.0 : 1.8, 4, 1).rotateY(Math.PI / 4).scale((h.w + 1.2) / (R * Math.SQRT2), 1, (h.d + 1.2) / (R * Math.SQRT2)).translate(0, wh + (two ? 1.0 : 0.9), 0);
      roofParts.push(place(roof).toNonIndexed());
      // a chimney
      const ch = new THREE.BoxGeometry(0.9, 2.6, 0.9).translate(h.w * 0.3, wh + 0.8, -h.d * 0.25);
      wallParts.push(paint(place(ch).toNonIndexed(), col));
      // arched windows and a door on the street side (dark glass, a little proud of the wall)
      const front = h.d / 2 + 0.03;
      const nWin = Math.max(2, Math.floor(h.w / 3));
      for (let k = 0; k < nWin; k++) {
        const x = -h.w / 2 + (h.w / nWin) * (k + 0.5);
        for (const y of two ? [1.0, 4.0] : [1.0]) {
          const win = new THREE.PlaneGeometry(1.1, 1.7).translate(x, y + 0.85, front);
          const arch = new THREE.CircleGeometry(0.55, 10, 0, Math.PI).translate(x, y + 1.7, front);
          glassParts.push(place(win).toNonIndexed(), place(arch).toNonIndexed());
        }
      }
      const door = new THREE.PlaneGeometry(1.2, 2.3).translate(h.w * 0.32, 1.15, front + 0.01);
      glassParts.push(place(door).toNonIndexed());
    }
    return { walls: mergeColored(wallParts), roofs: mergeGeos(roofParts), glass: mergeGeos(glassParts) };
  }, []);
  const roofMat = useMemo(() => tileRoofMat(), []);
  return (
    <group>
      <mesh geometry={walls} castShadow receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.9} />
      </mesh>
      <mesh geometry={roofs} material={roofMat} castShadow receiveShadow />
      <mesh geometry={glass}>
        <meshStandardMaterial color="#1c2328" roughness={0.15} metalness={0.4} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
function mergeColored(geos: THREE.BufferGeometry[]) {
  const g = mergeGeos(geos);
  let n = 0;
  for (const x of geos) n += x.attributes.position.count;
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const x of geos) {
    if (x.attributes.color) col.set(x.attributes.color.array as Float32Array, o * 3);
    o += x.attributes.position.count;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// ---------------------------------------------------------------
// cars: a late-'90s sedan, body, glasshouse, wheels
// ---------------------------------------------------------------
function carGeos() {
  // side profile (x along the car, y up), extruded across its width
  const s = new THREE.Shape();
  s.moveTo(-2.35, 0.32);
  s.lineTo(-2.4, 0.75);
  s.quadraticCurveTo(-2.35, 0.95, -1.9, 0.98);
  s.lineTo(1.75, 1.0);
  s.quadraticCurveTo(2.3, 0.98, 2.38, 0.72);
  s.lineTo(2.35, 0.32);
  s.lineTo(-2.35, 0.32);
  const body = new THREE.ExtrudeGeometry(s, { depth: 1.76, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 6 });
  body.translate(0, 0, -0.88);
  const gh = new THREE.Shape();
  gh.moveTo(-1.55, 0.98);
  gh.lineTo(-0.95, 1.42);
  gh.lineTo(0.75, 1.44);
  gh.lineTo(1.35, 0.99);
  gh.lineTo(-1.55, 0.98);
  const glass = new THREE.ExtrudeGeometry(gh, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  glass.translate(0, 0, -0.75);
  const wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateX(Math.PI / 2);
  const wheels = mergeGeos([[-1.45, 0.88], [1.45, 0.88], [-1.45, -0.88], [1.45, -0.88]].map(([x, z]) => wheel.clone().translate(x, 0.33, z)));
  // turn so the car's length runs along z (forward = +z)
  for (const g of [body, glass, wheels]) g.rotateY(-Math.PI / 2);
  return { body, glass, wheels };
}
type CarPose = { x: number; y: number; z: number; yaw: number; c: number };
function CarFleet({ poses, live }: { poses: CarPose[]; live?: (t: number, out: CarPose[]) => void }) {
  const { body, glass, wheels } = useMemo(() => {
    const g = carGeos();
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const im = new THREE.InstancedMesh(geo, mat, poses.length);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      return im;
    };
    const body = mk(g.body, new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 }));
    const glass = mk(g.glass, new THREE.MeshStandardMaterial({ color: '#141a20', roughness: 0.05, metalness: 0.6 }));
    const wheels = mk(g.wheels, new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.8 }));
    const c = new THREE.Color();
    poses.forEach((p, i) => body.setColorAt(i, c.set(CAR_COLORS[p.c % CAR_COLORS.length])));
    return { body, glass, wheels };
  }, [poses]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const one = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const write = (list: CarPose[]) => {
    list.forEach((p, i) => {
      m.compose(v.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.yaw), one);
      body.setMatrixAt(i, m);
      glass.setMatrixAt(i, m);
      wheels.setMatrixAt(i, m);
    });
    body.instanceMatrix.needsUpdate = glass.instanceMatrix.needsUpdate = wheels.instanceMatrix.needsUpdate = true;
  };
  useMemo(() => write(poses), [poses]);
  useFrame((st) => {
    if (!live) return;
    live(st.clock.elapsedTime, poses);
    write(poses);
  });
  return (
    <group>
      <primitive object={body} />
      <primitive object={glass} />
      <primitive object={wheels} />
    </group>
  );
}
function ParkedCars() {
  const poses = useMemo<CarPose[]>(() => LA.parked.map((p) => ({ x: p.x, y: H(p.x, p.z), z: p.z, yaw: p.yaw, c: p.c })), []);
  return <CarFleet poses={poses} />;
}
/** the freeway: four lanes each way, packed, flowing (a little stop-and-go in the far lane) */
function Traffic() {
  const F = LA.fwy;
  const lanes = useMemo(() => {
    const out: { x: number; dir: number; speed: number }[] = [];
    for (let k = 0; k < 8; k++) {
      const dir = k < 4 ? -1 : 1;
      const x = F.x0 + 1.8 + k * 3.6 + (k >= 4 ? 2.4 : 0);
      out.push({ x, dir, speed: 18 + (k % 4) * 3 + (k === 3 || k === 4 ? -10 : 0) });
    }
    return out;
  }, []);
  const poses = useMemo<CarPose[]>(() => {
    const rand = seeded(77);
    const out: CarPose[] = [];
    lanes.forEach((l, li) => {
      let z = -600 + rand() * 20;
      while (z < 600) {
        out.push({ x: l.x, y: F.y, z, yaw: l.dir > 0 ? 0 : Math.PI, c: Math.floor(rand() * 8) + li });
        z += 9 + rand() * 22;
      }
    });
    return out;
  }, []);
  const base = useMemo(() => poses.map((p) => p.z), [poses]);
  const laneOf = useMemo(() => poses.map((p) => lanes.findIndex((l) => Math.abs(l.x - p.x) < 0.1)), [poses]);
  const live = (t: number, out: CarPose[]) => {
    out.forEach((p, i) => {
      const l = lanes[laneOf[i]];
      let z = base[i] + l.dir * l.speed * t;
      z = ((((z + 600) % 1200) + 1200) % 1200) - 600;
      p.z = z;
    });
  };
  return <CarFleet poses={poses} live={live} />;
}

// ---------------------------------------------------------------
// the freeway: median barrier, walls, the overpass on its T piers, sign gantries, lamps
// ---------------------------------------------------------------
function signTexture(lines: string[], sub?: string) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#106b3a';
  g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#f4f4f0';
  g.lineWidth = 6;
  g.strokeRect(10, 10, 492, 236);
  g.fillStyle = '#f4f4f0';
  g.textAlign = 'center';
  g.font = 'bold 54px Arial, Helvetica, sans-serif';
  lines.forEach((l, k) => g.fillText(l, 256, 90 + k * 64));
  if (sub) {
    g.font = 'bold 34px Arial, Helvetica, sans-serif';
    g.fillText(sub, 256, 226);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function Freeway() {
  const F = LA.fwy;
  const O = LA.overpass;
  const geos = useMemo(() => {
    const L = 1200;
    // the Jersey barrier down the middle, walls on both shoulders
    const prof = new THREE.Shape();
    prof.moveTo(-0.3, 0);
    prof.lineTo(-0.3, 0.08);
    prof.lineTo(-0.12, 0.33);
    prof.lineTo(-0.08, 0.82);
    prof.lineTo(0.08, 0.82);
    prof.lineTo(0.12, 0.33);
    prof.lineTo(0.3, 0.08);
    prof.lineTo(0.3, 0);
    const mid = (F.x0 + 1.8 + 3 * 3.6 + F.x0 + 1.8 + 4 * 3.6 + 2.4) / 2;
    const barrier = new THREE.ExtrudeGeometry(prof, { depth: L, bevelEnabled: false }).translate(mid, F.y, -L / 2);
    const wallW = new THREE.BoxGeometry(0.5, 2.4, L).translate(F.x0 - 0.6, F.y + 1.2, 0);
    const wallE = new THREE.BoxGeometry(0.5, 2.4, L).translate(F.x1 + 0.6, F.y + 1.2, 0);
    // the overpass deck and parapets
    const span = F.x1 - F.x0 + 60;
    const deck = new THREE.BoxGeometry(span, 1.3, O.half * 2).translate((F.x0 + F.x1) / 2, O.y - 0.65, O.z);
    const parA = new THREE.BoxGeometry(span, 1.1, 0.35).translate((F.x0 + F.x1) / 2, O.y + 0.55, O.z - O.half + 0.2);
    const parB = new THREE.BoxGeometry(span, 1.1, 0.35).translate((F.x0 + F.x1) / 2, O.y + 0.55, O.z + O.half - 0.2);
    // T piers: on each shoulder and in the median
    const piers: THREE.BufferGeometry[] = [];
    for (const x of [F.x0 - 3, mid, F.x1 + 3]) {
      piers.push(new THREE.BoxGeometry(1.6, O.y - 1.3 - F.y, 1.6).translate(x, (O.y - 1.3 + F.y) / 2, O.z));
      piers.push(new THREE.BoxGeometry(2.4, 1.0, O.half * 2 - 1).translate(x, O.y - 1.8, O.z));
    }
    // approach embankment west: the deck runs on into the hillside
    const conc = mergeGeos([barrier, wallW, wallE, deck, parA, parB, ...piers]);
    // sign gantries spanning the lanes
    const steel: THREE.BufferGeometry[] = [];
    for (const z of [-200, 40, 260]) {
      for (const x of [F.x0 - 1.2, F.x1 + 1.2]) steel.push(new THREE.CylinderGeometry(0.25, 0.3, 8.5, 8).translate(x, F.y + 4.25, z));
      steel.push(new THREE.BoxGeometry(F.x1 - F.x0 + 2.4, 0.5, 0.5).translate((F.x0 + F.x1) / 2, F.y + 8.2, z));
    }
    // cobra-head lamps along both shoulders
    for (let z = -580; z <= 580; z += 45)
      for (const [x, s] of [[F.x0 - 1.0, 1], [F.x1 + 1.0, -1]] as const) {
        steel.push(new THREE.CylinderGeometry(0.1, 0.16, 11, 6).translate(x, F.y + 5.5, z));
        steel.push(new THREE.BoxGeometry(3.2, 0.12, 0.12).translate(x + s * 1.6, F.y + 11, z));
        steel.push(new THREE.BoxGeometry(0.9, 0.22, 0.45).translate(x + s * 3.1, F.y + 10.9, z));
      }
    return { conc, steel: mergeGeos(steel) };
  }, []);
  const signs = useMemo(
    () => [
      { z: -200, tex: signTexture(['110 SOUTH', 'Harbor Fwy'], 'San Pedro') },
      { z: 40, tex: signTexture(['Downtown', '4th St  EXIT'], '1/2 MILE') },
      { z: 260, tex: signTexture(['110 NORTH', 'Pasadena'], 'Hollywood  101') },
    ],
    []
  );
  return (
    <group>
      <mesh geometry={geos.conc} castShadow receiveShadow>
        <meshStandardMaterial color="#b9b2a6" roughness={0.9} />
      </mesh>
      <mesh geometry={geos.steel} castShadow>
        <meshStandardMaterial color="#8d8e88" metalness={0.6} roughness={0.5} />
      </mesh>
      {signs.map((s, k) =>
        [0, 1].map((half) => (
          <mesh key={`${k}${half}`} position={[F.x0 + 6 + half * 17, F.y + 7.2, s.z - 0.3]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[8, 4]} />
            <meshStandardMaterial map={s.tex} roughness={0.5} side={THREE.DoubleSide} />
          </mesh>
        ))
      )}
    </group>
  );
}

// ---------------------------------------------------------------
// downtown: towers of glass and stone, a few landmarks, the finance houses' names on top
// ---------------------------------------------------------------
type Tower = { x: number; z: number; w: number; d: number; h: number; round?: boolean; glass: string; frame: string; floors?: number; crown?: string; stepped?: boolean };
function towerMat(t: Tower) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25, metalness: 0.45, envMapIntensity: 1.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGlass = { value: new THREE.Color(t.glass) };
    sh.uniforms.uFrame = { value: new THREE.Color(t.frame) };
    sh.uniforms.uC = { value: new THREE.Vector2(t.x, t.z) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTP; varying vec3 vTN;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTP = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uGlass; uniform vec3 uFrame; uniform vec2 uC; varying vec3 vTP; varying vec3 vTN; float gWin;\nfloat h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vTN);
          // across the face: x or z on a flat face, round the axis on a drum
          float u = abs(n.x) > abs(n.z) ? vTP.z : vTP.x;
          ${t.round ? 'u = atan(vTP.z - uC.y, vTP.x - uC.x) * ' + (t.w / 2).toFixed(2) + ';' : ''}
          float fl = vTP.y / 3.9;
          vec2 cell = vec2(floor(u / 1.55), floor(fl));
          vec2 f = vec2(fract(u / 1.55), fract(fl));
          float mull = step(f.x, 0.07) + step(0.93, f.x);
          float spandrel = step(f.y, 0.24);
          float rnd = h21(cell);
          vec3 glass = uGlass * (0.85 + 0.3 * rnd);
          // a few lit or blind-drawn windows
          glass = mix(glass, glass * 1.6 + 0.04, step(0.93, rnd));
          gWin = (1.0 - clamp(mull + spandrel, 0.0, 1.0)) * step(abs(n.y), 0.5);
          diffuseColor.rgb = mix(uFrame, glass, gWin);
          if (abs(n.y) > 0.5) diffuseColor.rgb = uFrame * 0.7; // roofs
        }`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.7, 0.06, gWin);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(0.1, 0.85, gWin);');
  };
  return m;
}
function crownTexture(name: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 1024, 160);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 120;
  g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
  while (g.measureText(name).width > 980 && size > 40) g.font = `bold ${(size -= 4)}px Arial, Helvetica, sans-serif`;
  g.fillText(name, 512, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function Downtown() {
  const towers = useMemo<Tower[]>(() => {
    const T: Tower[] = [
      // the finance houses, their names on the crowns (plain lettering)
      { x: 300, z: -30, w: 40, d: 40, h: 250, glass: '#3e5a72', frame: '#c9c4b8', crown: 'GOLDMAN SACHS', stepped: true },
      { x: 270, z: 70, w: 36, d: 44, h: 215, glass: '#22303c', frame: '#7c2f2a', crown: 'MORGAN STANLEY' },
      { x: 335, z: 110, w: 34, d: 34, h: 235, glass: '#5b7f93', frame: '#d6d3cc', crown: 'CITADEL' },
      { x: 245, z: -120, w: 30, d: 38, h: 165, glass: '#2f4f5e', frame: '#adb3b5', crown: 'IMC TRADING' },
      // the round tower with a crown, tallest on the skyline
      { x: 360, z: 20, w: 48, d: 48, h: 300, round: true, glass: '#6c7a80', frame: '#d8d2c4', stepped: true },
      // the five round glass hotel towers
      { x: 230, z: 10, w: 22, d: 22, h: 110, round: true, glass: '#8aa2b2', frame: '#8aa2b2' },
      { x: 214, z: -6, w: 16, d: 16, h: 96, round: true, glass: '#8aa2b2', frame: '#8aa2b2' },
      { x: 246, z: -6, w: 16, d: 16, h: 96, round: true, glass: '#8aa2b2', frame: '#8aa2b2' },
      { x: 214, z: 26, w: 16, d: 16, h: 96, round: true, glass: '#8aa2b2', frame: '#8aa2b2' },
      { x: 246, z: 26, w: 16, d: 16, h: 96, round: true, glass: '#8aa2b2', frame: '#8aa2b2' },
    ];
    const rand = seeded(97);
    // the rest of downtown, and lower blocks toward the freeway
    for (let k = 0; k < 60; k++) {
      const x = 225 + rand() * 260;
      const z = -260 + rand() * 520;
      if (T.some((t) => Math.abs(t.x - x) < (t.w + 26) / 2 && Math.abs(t.z - z) < (t.d + 26) / 2)) continue;
      const near = x < 270 ? 0.4 : 1;
      const h = (35 + Math.pow(rand(), 2) * 170) * near;
      const pal = [
        ['#2b3a45', '#b9b4a8'],
        ['#40556a', '#d2cfc6'],
        ['#1f262c', '#4a4f55'],
        ['#6f8794', '#e0ddd5'],
        ['#3a3328', '#a89a85'],
      ][Math.floor(rand() * 5)];
      T.push({ x, z, w: 18 + rand() * 18, d: 18 + rand() * 18, h, glass: pal[0], frame: pal[1], round: rand() < 0.12, stepped: rand() < 0.3 });
    }
    for (let k = 0; k < 90; k++) {
      const x = 224 + rand() * 40;
      const z = -300 + rand() * 600;
      T.push({ x, z, w: 12 + rand() * 14, d: 12 + rand() * 14, h: 8 + rand() * 22, glass: '#4a5560', frame: ['#cbb89a', '#b8aa98', '#d8cdb8', '#a39a8c'][k % 4] });
    }
    return T;
  }, []);
  const parts = useMemo(() => {
    const y0 = LA.fwy.y;
    return towers.map((t) => {
      const geos: THREE.BufferGeometry[] = [];
      const tiers = t.stepped ? [[1, 0.62], [0.82, 0.86], [0.66, 1]] : [[1, 1]];
      let prev = 0;
      for (const [s, top] of tiers) {
        const h = t.h * top - prev;
        const g = t.round ? new THREE.CylinderGeometry((t.w / 2) * s, (t.w / 2) * s, h, 48) : new THREE.BoxGeometry(t.w * s, h, t.d * s);
        g.translate(t.x, y0 + prev + h / 2, t.z);
        geos.push(g.index ? g.toNonIndexed() : g);
        prev = t.h * top;
      }
      return { t, geo: mergeGeos(geos), mat: towerMat(t) };
    });
  }, [towers]);
  return (
    <group>
      {parts.map(({ t, geo, mat }, k) => (
        <group key={k}>
          <mesh geometry={geo} material={mat} castShadow receiveShadow />
          {t.crown &&
            [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([nx, nz], side) => {
              const sc = t.stepped ? 0.66 : 1;
              const half = (nx ? t.w : t.d) / 2 * sc + 0.2;
              const w = (nx ? t.d : t.w) * sc * 0.92;
              return (
                <mesh key={side} position={[t.x + nx * half, LA.fwy.y + t.h - 7, t.z + nz * half]} rotation={[0, Math.atan2(nx, nz), 0]}>
                  <planeGeometry args={[w, w * 0.16]} />
                  <meshBasicMaterial map={crownTex(t.crown!)} transparent toneMapped={false} />
                </mesh>
              );
            })}
          {t.round && t.stepped && (
            <mesh position={[t.x, LA.fwy.y + t.h + 6, t.z]}>
              <cylinderGeometry args={[t.w * 0.28, t.w * 0.33, 12, 48, 1, true]} />
              <meshStandardMaterial color="#d8d2c4" roughness={0.6} side={THREE.DoubleSide} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
const crownCache: Record<string, THREE.Texture> = {};
function crownTex(name: string) {
  return (crownCache[name] ??= crownTexture(name, '#f4efe2'));
}

/** the San Gabriels, blue-grey in the haze beyond downtown */
function Mountains() {
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(2600, 300, 260, 1);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0) continue;
      const x = p.getX(i);
      const h = 120 + 70 * Math.sin(x * 0.004 + 1) + 40 * Math.sin(x * 0.013) + 18 * Math.sin(x * 0.041 + 2);
      p.setY(i, h - 150);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} position={[1100, 140, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <meshBasicMaterial color="#9ba7b4" transparent opacity={0.85} fog={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------
// loot: cash bundles and watches, turning slowly with a glint
// ---------------------------------------------------------------
function noteTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9d8b8';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#3e5a3a';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 244, 116);
  g.fillStyle = '#3e5a3a';
  g.beginPath();
  g.ellipse(128, 64, 30, 38, 0, 0, Math.PI * 2);
  g.fill();
  g.font = 'bold 34px Georgia, serif';
  g.fillText('100', 20, 46);
  g.fillText('100', 180, 112);
  // the paper band round the middle
  g.fillStyle = '#e8dcc0';
  g.fillRect(110, 0, 36, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function Loot() {
  const N = 40;
  const refs = useRef<(THREE.Group | null)[]>([]);
  const cash = useRef<(THREE.Group | null)[]>([]);
  const watch = useRef<(THREE.Group | null)[]>([]);
  const dial = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const note = useMemo(() => noteTexture(), []);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    const L = mapRuntime.la?.loot ?? [];
    for (let k = 0; k < N; k++) {
      const g = refs.current[k];
      if (!g) continue;
      const it = L[k];
      g.visible = !!it;
      if (!it) continue;
      g.position.set(it.x, it.y + 0.55 + Math.sin(t * 2 + k) * 0.08, it.z);
      g.rotation.y = t * 1.2 + k;
      const isCash = it.kind.startsWith('cash');
      if (cash.current[k]) cash.current[k]!.visible = isCash;
      if (watch.current[k]) watch.current[k]!.visible = !isCash;
      if (cash.current[k]) cash.current[k]!.scale.setScalar(it.kind === 'cashBig' ? 1.5 : 1);
      if (dial.current[k]) dial.current[k]!.color.set(it.kind === 'rolex' ? '#1c3a2a' : it.kind === 'iwc' ? '#1a2333' : '#f2ede2');
    }
  });
  return (
    <group>
      {Array.from({ length: N }, (_, k) => (
        <group key={k} ref={(el) => (refs.current[k] = el)} visible={false}>
          <group ref={(el) => (cash.current[k] = el)}>
            <mesh castShadow>
              <boxGeometry args={[0.6, 0.18, 0.3]} />
              <meshStandardMaterial map={note} roughness={0.8} />
            </mesh>
          </group>
          <group ref={(el) => (watch.current[k] = el)} rotation={[Math.PI / 2.4, 0, 0]}>
            {/* a gold case, a dial, a bracelet loop */}
            <mesh>
              <cylinderGeometry args={[0.2, 0.2, 0.07, 32]} />
              <meshStandardMaterial color="#d9b25a" metalness={1} roughness={0.18} />
            </mesh>
            <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.165, 32]} />
              <meshStandardMaterial ref={(el) => (dial.current[k] = el)} color="#1c3a2a" metalness={0.3} roughness={0.3} />
            </mesh>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <torusGeometry args={[0.3, 0.06, 8, 24, Math.PI * 1.25]} />
              <meshStandardMaterial color="#cfa94e" metalness={1} roughness={0.25} />
            </mesh>
          </group>
          <pointLight color="#ffe6a0" intensity={0.6} distance={3} />
        </group>
      ))}
    </group>
  );
}

export function LACity() {
  return (
    <group>
      <Houses />
      <ParkedCars />
      <Traffic />
      <Freeway />
      <Downtown />
      <Mountains />
      <Loot />
    </group>
  );
}
