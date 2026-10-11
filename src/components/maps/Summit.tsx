import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { MAPS, SUMMIT, mapRuntime } from '../../maps';
import { Sky, CloudSea, CloudPuffs, KarstPeaks, seeded, GLSL_NOISE } from '../Scenery';

// ==================================================================
// 天阙之巅: three rings of white jade floating above a sea of clouds,
// between the two colossal gate towers (阙) of heaven. The outer rings
// crack and fall away during the round.
// ==================================================================

const FLOOR_SIZE = 46; // metres covered by the carved floor texture

/** Carved white-jade floor, gold inlay, and a separate crack layer that glows before a ring breaks */
let floorCache: { map: THREE.Texture; bump: THREE.Texture; cracks: THREE.Texture } | null = null;
function floorTextures() {
  if (floorCache) return floorCache;
  const N = 2048;
  const px = (m: number) => (m / FLOOR_SIZE) * N; // metres -> pixels
  const C = N / 2;
  const make = (draw: (g: CanvasRenderingContext2D) => void, srgb: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d')!;
    draw(g);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const rand = seeded(31);
  const veins: { x: number; y: number; pts: [number, number][] }[] = [];
  for (let k = 0; k < 140; k++) {
    let x = rand() * N;
    let y = rand() * N;
    const pts: [number, number][] = [[x, y]];
    let a = rand() * Math.PI * 2;
    for (let s = 0; s < 14; s++) {
      a += (rand() - 0.5) * 0.9;
      x += Math.cos(a) * 18;
      y += Math.sin(a) * 18;
      pts.push([x, y]);
    }
    veins.push({ x, y, pts });
  }
  const pattern = (g: CanvasRenderingContext2D, ink: string, gold: string, forBump: boolean) => {
    g.save();
    g.translate(C, C);
    // paving: concentric courses split into radial slabs
    g.strokeStyle = ink;
    g.lineWidth = forBump ? 5 : 2.8;
    const rings = [2.1, 4.2, 6.4, 8.5, 10.6, 12.8, 15, 17.4, 19.7, 22];
    for (const r of rings) {
      g.beginPath();
      g.arc(0, 0, px(r), 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < rings.length - 1; i++) {
      const r0 = rings[i];
      const r1 = rings[i + 1];
      const n = Math.round((Math.PI * 2 * r1) / 2.2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (i % 2) * (Math.PI / n);
        g.beginPath();
        g.moveTo(Math.cos(a) * px(r0), Math.sin(a) * px(r0));
        g.lineTo(Math.cos(a) * px(r1), Math.sin(a) * px(r1));
        g.stroke();
      }
    }
    // gold inlay: the ring borders, a band of cloud scrolls, and the 太极 in the centre
    g.strokeStyle = gold;
    g.lineWidth = forBump ? 11 : 9;
    for (const r of [SUMMIT.rings[2] - 0.12, SUMMIT.rings[1] - 0.12, SUMMIT.rings[0] - 0.35]) {
      g.beginPath();
      g.arc(0, 0, px(r), 0, Math.PI * 2);
      g.stroke();
    }
    g.lineWidth = forBump ? 7 : 5;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const r = px(13.2);
      g.beginPath();
      g.arc(Math.cos(a) * r, Math.sin(a) * r, px(0.45), a + 0.6, a + 0.6 + Math.PI * 1.5);
      g.stroke();
      g.beginPath();
      g.arc(Math.cos(a + 0.08) * (r + px(0.35)), Math.sin(a + 0.08) * (r + px(0.35)), px(0.22), a, a + Math.PI * 1.4);
      g.stroke();
    }
    // lotus petals round the centre disc
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.beginPath();
      g.moveTo(px(4.6), 0);
      g.quadraticCurveTo(px(5.8), px(0.8), px(7.0), 0);
      g.quadraticCurveTo(px(5.8), -px(0.8), px(4.6), 0);
      g.stroke();
      g.restore();
    }
    // 太极
    const R = px(2.0);
    g.beginPath();
    g.arc(0, 0, R, 0, Math.PI * 2);
    g.stroke();
    if (!forBump) {
      g.fillStyle = gold;
      g.beginPath();
      g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2);
      g.arc(0, R / 2, R / 2, Math.PI / 2, -Math.PI / 2, true);
      g.arc(0, -R / 2, R / 2, Math.PI / 2, -Math.PI / 2, false);
      g.fill();
      g.beginPath();
      g.arc(0, -R / 2, R / 7, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  };
  const map = make((g) => {
    // jade: warm white with faint grey-green veining
    const grd = g.createRadialGradient(C, C, 0, C, C, N * 0.6);
    grd.addColorStop(0, '#d8d1bf');
    grd.addColorStop(1, '#c9c1ad');
    g.fillStyle = grd;
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 30000; i++) {
      const v = 225 + rand() * 30;
      g.fillStyle = `rgba(${v},${v},${v - 6},0.25)`;
      g.fillRect(rand() * N, rand() * N, 3, 3);
    }
    g.strokeStyle = 'rgba(150,160,150,0.18)';
    g.lineWidth = 2;
    for (const v of veins) {
      g.beginPath();
      g.moveTo(v.pts[0][0], v.pts[0][1]);
      for (const p of v.pts) g.lineTo(p[0], p[1]);
      g.stroke();
    }
    pattern(g, 'rgba(120,112,98,0.55)', '#c8992f', false);
  }, true);
  const bump = make((g) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, N, N);
    pattern(g, '#303030', '#b0b0b0', true);
  }, false);
  // cracks along the seams between rings, drawn as jagged branching lines
  const cracks = make((g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, N, N);
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    for (const ringR of [SUMMIT.rings[1], SUMMIT.rings[2]]) {
      g.lineWidth = 6;
      g.beginPath();
      for (let k = 0; k <= 220; k++) {
        const a = (k / 220) * Math.PI * 2;
        const r = px(ringR) + (rand() - 0.5) * 6;
        const x = C + Math.cos(a) * r;
        const y = C + Math.sin(a) * r;
        if (k === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      // branches running out across the ring that is going to break
      g.lineWidth = 3.5;
      for (let k = 0; k < 80; k++) {
        let a = rand() * Math.PI * 2;
        let r = px(ringR);
        g.beginPath();
        g.moveTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
        for (let s = 0; s < 6; s++) {
          r += px(0.35 + rand() * 0.25);
          a += (rand() - 0.5) * 0.12;
          g.lineTo(C + Math.cos(a) * r, C + Math.sin(a) * r);
        }
        g.stroke();
      }
    }
  }, false);
  floorCache = { map, bump, cracks };
  return floorCache;
}

/** One slab: an annular sector, top flush with y = 0 */
function sectorGeometry(r0: number, r1: number, a0: number, a1: number, depth: number) {
  const s = new THREE.Shape();
  const n = Math.max(4, Math.round((a1 - a0) * 18));
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    const p = [Math.cos(a) * r1, Math.sin(a) * r1];
    if (k === 0) s.moveTo(p[0], p[1]);
    else s.lineTo(p[0], p[1]);
  }
  for (let k = n; k >= 0; k--) {
    const a = a0 + ((a1 - a0) * k) / n;
    s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  const g = r0 > 0 ? new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 4 }) : new THREE.ExtrudeGeometry(new THREE.Shape().absarc(0, 0, r1, 0, Math.PI * 2, false), { depth, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 72 });
  // extrude goes along +z: lay it flat so the top cap sits at y = 0 and the slab hangs below
  g.rotateX(Math.PI / 2);
  // (rotateX(+90deg) sends the shape's y to world z and the extrusion downwards)
  g.translate(0, -0.06, 0);
  // planar UVs from world xz for the carved floor texture
  const p = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / FLOOR_SIZE + 0.5, 0.5 - p.getZ(i) / FLOOR_SIZE);
  g.computeVertexNormals();
  return g;
}

/** Rock keel under a slab: rough, tapering, so each piece looks like a chunk of floating mountain */
function keelGeometry(r0: number, r1: number, a0: number, a1: number, depth: number, rand: () => number) {
  const g = new THREE.CylinderGeometry(1, 0.05, 1, 9, 4);
  g.translate(0, -0.5, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  const am = (a0 + a1) / 2;
  const rm = (r0 + r1) / 2;
  const w = Math.min((r1 - r0) * 0.5, (a1 - a0) * rm * 0.45);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const j = 0.8 + rand() * 0.45;
    p.setXYZ(i, p.getX(i) * w * j, y * depth * (0.8 + rand() * 0.3), p.getZ(i) * w * j);
  }
  g.computeVertexNormals();
  g.translate(Math.cos(am) * rm, -0.55, Math.sin(am) * rm);
  return g;
}

type Piece = { slab: THREE.BufferGeometry; keel: THREE.BufferGeometry; ring: number; dir: THREE.Vector3; delay: number; spin: THREE.Vector3; posts: [number, number][] };

function useFloor() {
  return useMemo(() => {
    const rand = seeded(19);
    const pieces: Piece[] = [];
    const R = SUMMIT.rings;
    // ring 0 = outer (breaks first), ring 1 = middle, ring 2 = the inner disc that stays
    const layout: [number, number, number][] = [
      [R[1], R[0], 22],
      [R[2], R[1], 14],
    ];
    layout.forEach(([r0, r1, n], ring) => {
      const off = rand() * 0.5;
      for (let k = 0; k < n; k++) {
        const a0 = off + (k / n) * Math.PI * 2 + 0.006;
        const a1 = off + ((k + 1) / n) * Math.PI * 2 - 0.006;
        const am = (a0 + a1) / 2;
        const posts: [number, number][] = [];
        if (ring === 0) {
          // balustrade posts along the outer edge
          for (let t = 0; t < 4; t++) {
            const a = a0 + ((a1 - a0) * (t + 0.5)) / 4;
            posts.push([Math.cos(a) * (r1 - 0.3), Math.sin(a) * (r1 - 0.3)]);
          }
        }
        pieces.push({
          slab: sectorGeometry(r0 + 0.04, r1, a0, a1, 0.7),
          keel: keelGeometry(r0, r1, a0, a1, 2.4 + rand() * 2.5, rand),
          ring,
          dir: new THREE.Vector3(Math.cos(am), 0, Math.sin(am)),
          delay: rand() * 0.9,
          spin: new THREE.Vector3((rand() - 0.5) * 1.2, (rand() - 0.5) * 0.8, (rand() - 0.5) * 1.2),
          posts,
        });
      }
    });
    const inner = sectorGeometry(0, R[2], 0, Math.PI * 2, 0.9);
    return { pieces, inner };
  }, []);
}

function FloatingFloor() {
  const tex = floorTextures();
  const { pieces, inner } = useFloor();
  // one jade material per ring so only the ring about to break lights its cracks
  const mats = useMemo(
    () =>
      [0, 1, 2].map(
        () =>
          new THREE.MeshStandardMaterial({
            map: tex.map,
            bumpMap: tex.bump,
            bumpScale: 1.4,
            roughness: 0.5,
            metalness: 0.02,
            emissive: new THREE.Color('#7fe3ff'),
            emissiveMap: tex.cracks,
            emissiveIntensity: 0,
            envMapIntensity: 1.2,
          })
      ),
    [tex]
  );
  const rock = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a8478', roughness: 0.95, flatShading: true }), []);
  const postMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#efece2', roughness: 0.4 }), []);
  const goldMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c8992f', roughness: 0.35, metalness: 0.85 }), []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame((st) => {
    const stage = mapRuntime.summitStage;
    const warn = mapRuntime.summitWarn;
    const t = st.clock.elapsedTime;
    mats.forEach((m, ring) => {
      // ring index here: 0 outer, 1 middle. It glows while the game warns about it
      const glowing = warn > 0 && ring === stage;
      m.emissiveIntensity = glowing ? (0.6 + warn * 2.2) * (0.75 + 0.25 * Math.sin(t * 14)) : 0;
    });
    pieces.forEach((p, i) => {
      const g = refs.current[i];
      if (!g) return;
      const broken = stage > p.ring;
      const justNow = stage === p.ring + 1;
      if (!broken) {
        // rumble before breaking
        const shake = warn > 0 && p.ring === stage ? warn * 0.04 : 0;
        g.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
        g.rotation.set(0, 0, 0);
        g.visible = true;
        return;
      }
      const ft = justNow ? Math.max(0, mapRuntime.summitFall - p.delay * 0.6) : 99;
      g.visible = ft < 9;
      if (!g.visible) return;
      g.position.set(p.dir.x * ft * 1.2, -4.5 * ft * ft, p.dir.z * ft * 1.2);
      g.rotation.set(p.spin.x * ft, p.spin.y * ft, p.spin.z * ft);
    });
  });
  return (
    <group>
      {/* the inner disc: never breaks; it sits on a great inverted crag */}
      <mesh geometry={inner} material={mats[2]} receiveShadow castShadow />
      <Crag />
      {pieces.map((p, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)}>
          <mesh geometry={p.slab} material={mats[p.ring]} receiveShadow castShadow />
          <mesh geometry={p.keel} material={rock} castShadow />
          {p.posts.map(([x, z], k) => (
            <group key={k} position={[x, 0, z]}>
              <mesh position={[0, 0.32, 0]} material={postMat} castShadow>
                <boxGeometry args={[0.2, 0.64, 0.2]} />
              </mesh>
              <mesh position={[0, 0.7, 0]} material={goldMat}>
                <sphereGeometry args={[0.13, 10, 8]} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  );
}

/** The great crag hanging under the inner disc, trailing mist */
function Crag() {
  const geo = useMemo(() => {
    const rand = seeded(5);
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      pts.push(new THREE.Vector2(SUMMIT.rings[2] * (1 - Math.pow(t, 0.7)) * 1.02 + 0.05, -0.85 - t * 22));
    }
    const g = new THREE.LatheGeometry(pts, 28);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = y < -1.2 ? 1 + (rand() - 0.5) * 0.35 : 1;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} castShadow>
      <meshStandardMaterial color="#7d776c" roughness={0.95} flatShading />
    </mesh>
  );
}

/** Floating jade posts (physics pillars, h 2.2): they hover on their own and survive the collapse */
function JadePosts() {
  const posts = MAPS.summit.pillars ?? [];
  const runeRef = useRef<THREE.Mesh[]>([]);
  useFrame((st) => {
    runeRef.current.forEach((m, i) => {
      if (m) m.rotation.z = st.clock.elapsedTime * 0.6 + i;
    });
  });
  return (
    <group>
      {posts.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh position={[0, (p.h ?? 2.2) / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[p.r * 0.92, p.r, p.h ?? 2.2, 24]} />
            <meshStandardMaterial color="#b9e3cf" roughness={0.18} metalness={0.05} transparent opacity={0.92} emissive="#2f7a62" emissiveIntensity={0.25} />
          </mesh>
          {[0.15, (p.h ?? 2.2) - 0.12].map((y, k) => (
            <mesh key={k} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[p.r * 0.98, 0.06, 8, 32]} />
              <meshStandardMaterial color="#c8992f" metalness={0.85} roughness={0.3} />
            </mesh>
          ))}
          {/* glowing rune circle underneath: what holds it up once the floor is gone */}
          <mesh ref={(el) => el && (runeRef.current[i] = el)} position={[0, -0.25, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[p.r * 1.05, p.r * 1.35, 6]} />
            <meshBasicMaterial color={[0.6, 2.2, 1.8]} transparent opacity={0.55} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** concave square roof (庑殿顶 seen from afar): a 4-sided lathe with a curved profile and flared eaves */
function towerRoof(w: number, h: number) {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    // from the eave tip (flared, slightly raised) up to the ridge point
    const r = (w / 2) * 1.42 * (1 - t) * (1 - 0.35 * Math.sin(t * Math.PI * 0.9));
    const y = h * Math.pow(t, 1.6) + (1 - t) * (1 - t) * 0.12 * h;
    pts.push(new THREE.Vector2(Math.max(0.05, r), y));
  }
  const g = new THREE.LatheGeometry(pts, 4);
  g.rotateY(Math.PI / 4);
  g.computeVertexNormals();
  return g;
}

/** 天阙: the two colossal gate towers of heaven, far beyond the platform */
function GateTowers() {
  const g = useMemo(() => {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: '#d9d2c2', roughness: 0.85 });
    const red = new THREE.MeshStandardMaterial({ color: '#8f2416', roughness: 0.7 });
    const col = new THREE.MeshStandardMaterial({ color: '#a8301c', roughness: 0.6 });
    const roof = new THREE.MeshStandardMaterial({ color: '#c8982f', roughness: 0.38, metalness: 0.55, side: THREE.DoubleSide });
    const rail = new THREE.MeshStandardMaterial({ color: '#efe9da', roughness: 0.6 });
    for (const side of [-1, 1]) {
      const x = side * 62;
      const z = -150;
      // tapering rammed-earth and stone base rising out of the clouds
      const base = new THREE.Mesh(new THREE.CylinderGeometry(13, 17, 46, 4, 1), stone);
      base.rotation.y = Math.PI / 4;
      base.position.set(x, -40 + 23, z);
      group.add(base);
      let y = 6;
      const tiers: [number, number][] = [
        [19, 11],
        [15, 9],
        [11, 8],
      ];
      for (const [w, h] of tiers) {
        // balcony
        const bal = new THREE.Mesh(new THREE.BoxGeometry(w + 2.4, 0.6, w + 2.4), rail);
        bal.position.set(x, y + 0.3, z);
        group.add(bal);
        // walled core and a ring of red columns
        const core = new THREE.Mesh(new THREE.BoxGeometry(w * 0.82, h, w * 0.82), red);
        core.position.set(x, y + h / 2, z);
        group.add(core);
        const n = 5;
        for (let i = 0; i < n; i++)
          for (const [dx, dz] of [
            [1, 0],
            [0, 1],
          ]) {
            for (const sgn of [-1, 1]) {
              const t = -w / 2 + (w * i) / (n - 1);
              const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, h, 10), col);
              c.position.set(x + (dx ? sgn * (w / 2) : t), y + h / 2, z + (dz ? sgn * (w / 2) : t));
              group.add(c);
            }
          }
        y += h;
        const r = new THREE.Mesh(towerRoof(w + 4, h * 0.55), roof);
        r.position.set(x, y - 0.6, z);
        group.add(r);
        y += h * 0.45;
      }
      const finial = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), roof);
      finial.position.set(x, y + 1.2, z);
      group.add(finial);
    }
    return group;
  }, []);
  return <primitive object={g} />;
}

/** Cranes gliding round the summit */
function Cranes() {
  const birds = useMemo(() => {
    const rand = seeded(8);
    return Array.from({ length: 9 }, () => ({ r: 40 + rand() * 35, y: 4 + rand() * 14, a: rand() * 6.28, s: 0.05 + rand() * 0.05, flap: rand() * 6 }));
  }, []);
  const refs = useRef<(THREE.Group | null)[]>([]);
  const wings = useRef<(THREE.Mesh | null)[][]>([]);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    birds.forEach((b, i) => {
      const g = refs.current[i];
      if (!g) return;
      const a = b.a + t * b.s;
      g.position.set(Math.cos(a) * b.r, b.y + Math.sin(t * 0.5 + i) * 1.5, Math.sin(a) * b.r);
      g.rotation.y = -a;
      const f = Math.sin(t * 3 + b.flap) * 0.5;
      const w = wings.current[i];
      if (w) {
        if (w[0]) w[0].rotation.x = f;
        if (w[1]) w[1].rotation.x = -f;
      }
    });
  });
  return (
    <group>
      {birds.map((_, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)}>
          <mesh>
            <coneGeometry args={[0.12, 1.4, 6]} />
            <meshStandardMaterial color="#f5f5f4" />
          </mesh>
          {[1, -1].map((s, k) => (
            <mesh
              key={k}
              ref={(el) => {
                wings.current[i] = wings.current[i] || [];
                wings.current[i][k] = el;
              }}
            >
              <boxGeometry args={[0.04, 0.02, 2.2]} />
              <meshStandardMaterial color="#e7e5e4" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

/** Soft god rays from the sun through the cloud gaps */
function SunRays() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: /* glsl */ `
          uniform float uTime; varying vec2 vUv;
          ${GLSL_NOISE}
          void main(){
            float streak = smoothstep(0.35, 0.9, noise(vec2(vUv.x * 18.0, uTime * 0.05)));
            float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y)) * (1.0 - abs(vUv.x - 0.5) * 2.0);
            gl_FragColor = vec4(vec3(1.0, 0.86, 0.6), streak * fade * 0.12);
          }`,
      }),
    []
  );
  useFrame((st) => {
    mat.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <mesh position={[30, 25, -90]} rotation={[0, -0.3, -0.5]} material={mat}>
      <planeGeometry args={[120, 160]} />
    </mesh>
  );
}

// module-level constants: KarstPeaks rebuilds its meshes whenever these props change identity
const SUN_DIR: [number, number, number] = [0.5, 0.14, -1];
const PEAK_LAYERS = [
  { dist: 120, count: 9, height: [30, 55] as [number, number], radius: [6, 11] as [number, number], haze: 0.25 },
  { dist: 210, count: 14, height: [40, 80] as [number, number], radius: [10, 18] as [number, number], haze: 0.55 },
];
const PEAK_EXCLUDE: [number, number] = [-1.9, -1.2];
const PUFF_Y: [number, number] = [-24, -9];

export function SummitMap() {
  return (
    <group>
      <Sky zenith="#2a56a3" horizon="#f3cf98" below="#efe2cf" sunDir={SUN_DIR} sunColor="#ffc878" sunSize={1.6} streaks={0.7} streakColor="#ffe9cc" />
      <CloudSea y={-26} color="#fff4e4" shadow="#9a9ab4" horizon="#f1d3a8" sunDir={SUN_DIR} />
      <KarstPeaks seed={21} baseY={-40} haze="#e9cfae" rock="#5f625c" light="#ffc878" lightDir={SUN_DIR} layers={PEAK_LAYERS} exclude={PEAK_EXCLUDE} />
      <GateTowers />
      <CloudPuffs count={30} inner={34} outer={130} y={PUFF_Y} color="#fffaf3" seed={33} />
      <SunRays />
      <FloatingFloor />
      <JadePosts />
      <Cranes />
    </group>
  );
}
