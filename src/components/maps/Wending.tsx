import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { WAR, warHeight, mapRuntime } from '../../maps';
import { Sky, seeded, GLSL_NOISE } from '../Scenery';

// ==================================================================
// 问鼎原: a grass field between two palisaded camps. The 问鼎台 terrace
// with its war drum in the middle, rock ridges between the lanes,
// springs on the flanks, boulder levers, watchtowers flying each
// side's colours (red for the south camp, blue for the north).
// ==================================================================

const SUN = new THREE.Vector3(0.5, 0.45, 0.7).normalize();
const SIDE_COL = ['#b3322a', '#2f5d9e'];
const H = warHeight;

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rep = 1) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
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

/** the field: grass, worn paths down the three lanes, packed earth in the camps */
function Ground() {
  const { geo, mat } = useMemo(() => {
    const size = (WAR.radius + 40) * 2;
    const seg = 220;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setY(i, H(p.getX(i), p.getZ(i)));
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWP;\n${GLSL_NOISE}\nfloat fbm3(vec2 p){ return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125; }`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec2 p = vWP.xz;
            float n1 = fbm3(p * 0.08); float n2 = fbm3(p * 0.6 + 4.0); float n3 = noise(p * 3.5);
            vec3 grass = mix(vec3(0.22, 0.3, 0.1), vec3(0.36, 0.42, 0.15), n2);
            grass = mix(grass, vec3(0.45, 0.42, 0.2), smoothstep(0.6, 0.8, n1) * 0.6); // dry patches
            vec3 earth = mix(vec3(0.36, 0.29, 0.2), vec3(0.47, 0.39, 0.27), n3);
            // three worn lanes running north-south, and the camps' trodden ground
            float lane = 0.0;
            lane = max(lane, 1.0 - smoothstep(1.6, 3.4, abs(vWP.x + sin(vWP.z * 0.11) * 0.8)));
            lane = max(lane, 1.0 - smoothstep(1.2, 2.8, abs(abs(vWP.x) - 23.0 + sin(vWP.z * 0.15) * 0.6)));
            float camp = 1.0 - smoothstep(${(WAR.campR - 1).toFixed(1)}, ${(WAR.campR + 2).toFixed(1)}, min(length(p - vec2(0.0, ${WAR.camps[0][1].toFixed(1)})), length(p - vec2(0.0, ${WAR.camps[1][1].toFixed(1)}))));
            float worn = max(lane * (0.55 + n2 * 0.4), camp * 0.85);
            vec3 col = mix(grass, earth, worn);
            // the terrace: dressed stone on top
            float r = length(p);
            float paved = 1.0 - smoothstep(${(WAR.mound.top - 0.2).toFixed(1)}, ${(WAR.mound.top + 0.3).toFixed(1)}, r);
            vec2 tile = fract(p * 0.7);
            float joint = smoothstep(0.03, 0.0, min(tile.x, tile.y)) * 0.25;
            col = mix(col, mix(vec3(0.55, 0.52, 0.47), vec3(0.64, 0.6, 0.54), n3) - joint, paved);
            diffuseColor.rgb = col;
          }`
        );
    };
    return { geo: g, mat: m };
  }, []);
  return <mesh geometry={geo} material={mat} receiveShadow />;
}

/** grass tufts over the field (not on the lanes or the terrace) */
function Grass() {
  const mesh = useMemo(() => {
    const rand = seeded(201);
    const tex = canvasTex(64, 64, (g) => {
      g.clearRect(0, 0, 64, 64);
      for (let i = 0; i < 22; i++) {
        const x = 4 + rand() * 56;
        const h = 24 + rand() * 38;
        g.strokeStyle = `hsl(${70 + rand() * 20}, ${40 + rand() * 20}%, ${24 + rand() * 18}%)`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, 64);
        g.quadraticCurveTo(x + (rand() - 0.5) * 8, 64 - h * 0.6, x + (rand() - 0.5) * 16, 64 - h);
        g.stroke();
      }
    });
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const merged = new THREE.BufferGeometry();
    const pos = new Float32Array([...(a.attributes.position.array as Float32Array), ...(b.attributes.position.array as Float32Array)]);
    const uv = new Float32Array([...(a.attributes.uv.array as Float32Array), ...(b.attributes.uv.array as Float32Array)]);
    const n = a.attributes.position.count;
    const idx = [...(a.index!.array as Uint16Array), ...[...(b.index!.array as Uint16Array)].map((v) => v + n)];
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    merged.setIndex(idx);
    merged.computeVertexNormals();
    const spots: [number, number, number][] = [];
    for (let k = 0; k < 60000 && spots.length < 9000; k++) {
      const r = Math.sqrt(rand()) * (WAR.radius + 8);
      const t = rand() * Math.PI * 2;
      const x = Math.cos(t) * r;
      const z = Math.sin(t) * r;
      if (Math.abs(x) < 3.5 || Math.abs(Math.abs(x) - 23) < 2.8) continue;
      if (Math.hypot(x, z) < WAR.mound.top + 1) continue;
      if (WAR.camps.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < WAR.campR + 1)) continue;
      if (WAR.springs.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < WAR.springR + 0.6)) continue;
      spots.push([x, z, 0.35 + rand() * 0.5]);
    }
    const im = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, s], i) => {
      m.compose(new THREE.Vector3(x, H(x, z) - 0.02, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 3), new THREE.Vector3(s, s, s));
      im.setMatrixAt(i, m);
    });
    im.receiveShadow = true;
    return im;
  }, []);
  return <primitive object={mesh} />;
}

/** the 问鼎台: a stepped stone rim round the top, four stairs, the drum on its stand, banners */
function Terrace() {
  const M = WAR.mound;
  const drum = useRef<THREE.Group>(null);
  const skin = useRef<THREE.MeshStandardMaterial>(null);
  const glow = useRef<THREE.Sprite>(null);
  const tex = useMemo(() => glowTex('rgba(255,170,80,1)', 'rgba(255,90,20,0)'), []);
  const rim = useMemo(() => {
    const parts: [number, number, number][] = [];
    const n = 44;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      // gaps for the four stairs
      if ([0, 0.5, 1, 1.5].some((q) => Math.abs(((a - q * Math.PI + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.22)) continue;
      parts.push([Math.cos(a) * (M.top + 0.1), Math.sin(a) * (M.top + 0.1), a]);
    }
    return parts;
  }, []);
  useFrame((st) => {
    const W = mapRuntime.war;
    const ready = W.drumT <= 0;
    const t = st.clock.elapsedTime;
    if (drum.current) drum.current.position.y = M.h + 1.35 + (ready ? Math.max(0, Math.sin(t * 9)) * 0.03 : 0);
    if (skin.current) skin.current.emissiveIntensity = ready ? 0.6 + 0.5 * Math.max(0, Math.sin(t * 4.5)) : 0.05;
    if (glow.current) {
      (glow.current.material as THREE.SpriteMaterial).opacity = ready ? 0.7 + 0.2 * Math.sin(t * 4.5) : 0;
      glow.current.scale.setScalar(ready ? 6 + W.drumHold * 2 : 0.01);
    }
  });
  return (
    <group>
      {rim.map(([x, z, a], k) => (
        <mesh key={k} position={[x, M.h + 0.15, z]} rotation={[0, -a, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.5, 0.42, 0.85]} />
          <meshStandardMaterial color="#8a857a" roughness={0.95} />
        </mesh>
      ))}
      {/* the drum: a red barrel on a timber stand, two beaters crossed beside it */}
      <mesh position={[0, M.h + 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.95, 1.05, 1.1, 8]} />
        <meshStandardMaterial color="#4b3423" roughness={0.9} />
      </mesh>
      <group ref={drum} position={[0, M.h + 1.35, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[1.05, 1.05, 1.4, 24, 1, true]} />
          <meshStandardMaterial color="#8f1d16" roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
        {[-0.71, 0.71].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[y > 0 ? 0 : Math.PI, 0, 0]}>
            <circleGeometry args={[1.05, 24]} />
            <meshStandardMaterial ref={y > 0 ? skin : undefined} color="#d9c7a1" emissive="#ff7a2a" emissiveIntensity={0.05} roughness={0.8} />
          </mesh>
        ))}
        {[-0.5, 0.5].map((y) => (
          <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.07, 0.04, 6, 24]} />
            <meshStandardMaterial color="#c9a14a" metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
      </group>
      <sprite ref={glow} position={[0, M.h + 1.4, 0]} scale={0.01}>
        <spriteMaterial map={tex} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0} />
      </sprite>
      {/* tall banners at the four corners of the terrace */}
      {[0.25, 0.75, 1.25, 1.75].map((q, k) => {
        const a = q * Math.PI;
        const x = Math.cos(a) * (M.top - 0.6);
        const z = Math.sin(a) * (M.top - 0.6);
        return <Banner key={k} x={x} y={M.h} z={z} color={k % 2 ? '#c9a14a' : '#8f1d16'} h={6} />;
      })}
    </group>
  );
}

function Banner({ x, y, z, color, h = 5, side }: { x: number; y: number; z: number; color: string; h?: number; side?: number }) {
  const cloth = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(0.9, 1.9, 6, 6).translate(0.45, -0.95, 0), []);
  const base = useMemo(() => (geo.attributes.position.array as Float32Array).slice(), [geo]);
  useFrame((st) => {
    const p = geo.attributes.position as THREE.BufferAttribute;
    const t = st.clock.elapsedTime;
    for (let i = 0; i < p.count; i++) {
      const u = base[i * 3];
      p.setZ(i, Math.sin(t * 3 + u * 4 + x) * 0.12 * u);
    }
    p.needsUpdate = true;
  });
  void side;
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, h / 2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.06, h, 6]} />
        <meshStandardMaterial color="#3d2c1e" roughness={0.9} />
      </mesh>
      <mesh ref={cloth} geometry={geo} position={[0.05, h - 0.1, 0]} castShadow>
        <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
    </group>
  );
}

/** rows of jagged rock between the lanes */
function Ridges() {
  const mesh = useMemo(() => {
    const rand = seeded(211);
    const spots: [number, number, number, number][] = [];
    for (const [x, z0, z1] of WAR.ridges)
      for (let z = z0; z <= z1 + 0.01; z += 0.8) for (let k = 0; k < 2; k++) spots.push([x + Math.sin(z * 1.3) * 0.4 + (rand() - 0.5) * 1.2, z + (rand() - 0.5) * 0.8, 0.8 + rand() * 1.1, rand() * 6]);
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#7f7a70', roughness: 0.95, flatShading: true }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, z, s, a], i) => {
      m.compose(new THREE.Vector3(x, H(x, z) + s * 0.5, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(a, a * 0.7, a * 0.3)), new THREE.Vector3(s, s * (1.2 + (i % 3) * 0.3), s * 0.9));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    return im;
  }, []);
  return <primitive object={mesh} />;
}

/** the camps: a log palisade arc, a gate arch, a watchtower flying the side's colour */
function Camps() {
  const logs = useMemo(() => {
    const pts: [number, number, number][] = [];
    WAR.camps.forEach(([cx, cz], sd) => {
      const facing = sd === 0 ? -Math.PI / 2 : Math.PI / 2;
      for (let a = 0; a < Math.PI * 2; a += 0.075) {
        const da = Math.abs(((a - facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < (130 / 2) * (Math.PI / 180)) continue;
        pts.push([cx + Math.cos(a) * WAR.campR, cz + Math.sin(a) * WAR.campR, 2.6 + (Math.round(a * 40) % 3) * 0.2]);
      }
    });
    const g = new THREE.CylinderGeometry(0.22, 0.26, 1, 7).translate(0, 0.5, 0);
    // sharpened tops
    const tip = new THREE.ConeGeometry(0.22, 0.4, 7).translate(0, 1.2, 0);
    void tip;
    const im = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#6b4e33', roughness: 0.95 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z, h], i) => {
      m.compose(new THREE.Vector3(x, H(x, z) - 0.2, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    return im;
  }, []);
  return (
    <group>
      <primitive object={logs} />
      {WAR.towers.map(([tx, tz], sd) => (
        <Tower key={sd} x={tx} z={tz} color={SIDE_COL[sd]} />
      ))}
      {/* a few tents and a weapon rack in each camp */}
      {WAR.camps.map(([cx, cz], sd) => {
        const s = sd === 0 ? 1 : -1;
        return (
          <group key={sd}>
            {[[-6, 3], [6, 3]].map(([dx, dz], k) => (
              <mesh key={k} position={[cx + dx, H(cx + dx, cz + dz * s) + 1.1, cz + dz * s]} rotation={[0, 0, 0]} castShadow>
                <coneGeometry args={[2, 2.2, 6]} />
                <meshStandardMaterial color={k ? '#cdbb92' : '#bfa97c'} roughness={0.95} />
              </mesh>
            ))}
            <Banner x={cx - 3} y={H(cx - 3, cz)} z={cz} color={SIDE_COL[sd]} h={5} />
            <Banner x={cx + 3} y={H(cx + 3, cz)} z={cz} color={SIDE_COL[sd]} h={5} />
          </group>
        );
      })}
    </group>
  );
}

function Tower({ x, z, color }: { x: number; z: number; color: string }) {
  const y = H(x, z);
  const wood = <meshStandardMaterial color="#5d4330" roughness={0.9} />;
  return (
    <group position={[x, y, z]}>
      {[[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]].map(([dx, dz], k) => (
        <mesh key={k} position={[dx, 2.9, dz]} castShadow>
          <cylinderGeometry args={[0.16, 0.2, 5.8, 6]} />
          {wood}
        </mesh>
      ))}
      {/* cross braces */}
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} position={[k % 2 ? 0 : k === 0 ? -1.3 : 1.3, 2.4, k % 2 ? (k === 1 ? -1.3 : 1.3) : 0]} rotation={[k % 2 ? 0 : 0.85, k % 2 ? Math.PI / 2 : 0, k % 2 ? 0.85 : 0]}>
          <boxGeometry args={[0.1, 3.6, 0.1]} />
          {wood}
        </mesh>
      ))}
      <mesh position={[0, 5.8, 0]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.2, 3.4]} />
        {wood}
      </mesh>
      {[[-1.65, 0, 0.1, 3.4], [1.65, 0, 0.1, 3.4], [0, -1.65, 3.4, 0.1], [0, 1.65, 3.4, 0.1]].map(([dx, dz, w, d], k) => (
        <mesh key={k} position={[dx, 6.35, dz]} castShadow>
          <boxGeometry args={[w, 0.9, d]} />
          {wood}
        </mesh>
      ))}
      <mesh position={[0, 7.7, 0]} castShadow>
        <coneGeometry args={[2.6, 1.4, 4]} />
        <meshStandardMaterial color="#3a2c22" roughness={0.9} />
      </mesh>
      <Banner x={0} y={8.2} z={0} color={color} h={2.6} />
    </group>
  );
}

/** the springs: a ring of stones round a glowing pool */
function Springs() {
  const water = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uTime; varying vec2 vUv;
          void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0;
            float ring = sin(r * 18.0 - uTime * 2.5) * 0.5 + 0.5;
            vec3 col = mix(vec3(0.15, 0.55, 0.45), vec3(0.6, 0.95, 0.8), ring * 0.35 + (1.0 - r) * 0.4);
            gl_FragColor = vec4(col, 0.85 * smoothstep(1.0, 0.92, r)); }`,
      }),
    []
  );
  const glow = useMemo(() => glowTex('rgba(140,255,200,0.8)', 'rgba(60,200,150,0)'), []);
  useFrame((st) => {
    water.uniforms.uTime.value = st.clock.elapsedTime;
  });
  return (
    <group>
      {WAR.springs.map(([sx, sz], k) => (
        <group key={k} position={[sx, 0, sz]}>
          <mesh position={[0, -0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} material={water}>
            <circleGeometry args={[WAR.springR, 40]} />
          </mesh>
          {Array.from({ length: 18 }, (_, i) => {
            const a = (i / 18) * Math.PI * 2;
            return (
              <mesh key={i} position={[Math.cos(a) * (WAR.springR + 0.35), 0.12, Math.sin(a) * (WAR.springR + 0.35)]} rotation={[0, -a, 0]} scale={[0.45, 0.3, 0.6]} castShadow>
                <dodecahedronGeometry args={[1, 0]} />
                <meshStandardMaterial color="#8d887c" roughness={0.95} flatShading />
              </mesh>
            );
          })}
          <sprite position={[0, 0.6, 0]} scale={[WAR.springR * 2.6, 2, 1]}>
            <spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} opacity={0.55} />
          </sprite>
        </group>
      ))}
    </group>
  );
}

/** levers and the boulders they let loose; the towers' arrows in flight */
function Live() {
  const levers = useRef<(THREE.Group | null)[]>([]);
  const rocks = useRef<(THREE.Mesh | null)[]>([]);
  const arrows = useRef<(THREE.Mesh | null)[]>([]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    const W = mapRuntime.war;
    WAR.levers.forEach((_, k) => {
      const g = levers.current[k];
      if (g) g.rotation.z = W.leverCd[k] > 0 ? 0.9 : -0.6;
    });
    for (let n = 0; n < 4; n++) {
      const m = rocks.current[n];
      if (!m) continue;
      const b = W.boulders[n];
      m.visible = !!b;
      if (!b) continue;
      m.position.set(b.x, b.y, b.z);
      m.rotation.set(b.spin * -b.dir, 0, 0);
    }
    for (let n = 0; n < 6; n++) {
      const m = arrows.current[n];
      if (!m) continue;
      const s = W.shots[n];
      m.visible = !!s;
      if (!s) continue;
      const t = Math.min(1, s.t / 0.25);
      m.position.set(s.x0 + (s.x1 - s.x0) * t, s.y0 + (s.y1 - s.y0) * t, s.z0 + (s.z1 - s.z0) * t);
      m.lookAt(tmp.set(s.x1, s.y1, s.z1));
    }
  });
  return (
    <group>
      {WAR.levers.map(([lx, lz], k) => (
        <group key={k} position={[lx, H(lx, lz), lz]}>
          <mesh position={[0, 0.25, 0]} castShadow>
            <boxGeometry args={[1.0, 0.5, 0.7]} />
            <meshStandardMaterial color="#6e6a60" roughness={0.95} />
          </mesh>
          <group ref={(el) => (levers.current[k] = el)} position={[0, 0.5, 0]}>
            <mesh position={[0, 0.7, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.07, 1.4, 6]} />
              <meshStandardMaterial color="#5d4330" roughness={0.9} />
            </mesh>
            <mesh position={[0, 1.42, 0]}>
              <sphereGeometry args={[0.12, 8, 6]} />
              <meshStandardMaterial color="#8f1d16" roughness={0.6} />
            </mesh>
          </group>
          {/* a heap of waiting boulders behind it */}
          {[[0.9, 0, 1.6], [-0.7, 0.3, 1.9]].map(([dx, dy, dz], i) => (
            <mesh key={i} position={[dx, 0.9 + dy, dz]} castShadow>
              <dodecahedronGeometry args={[0.95, 1]} />
              <meshStandardMaterial color="#77716a" roughness={0.95} flatShading />
            </mesh>
          ))}
        </group>
      ))}
      {[0, 1, 2, 3].map((n) => (
        <mesh key={n} ref={(el) => (rocks.current[n] = el)} visible={false} castShadow>
          <dodecahedronGeometry args={[WAR.boulder.r, 1]} />
          <meshStandardMaterial color="#7a7368" roughness={0.95} flatShading />
        </mesh>
      ))}
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <mesh key={n} ref={(el) => (arrows.current[n] = el)} visible={false}>
          <boxGeometry args={[0.04, 0.04, 0.9]} />
          <meshBasicMaterial color="#f5deb3" />
        </mesh>
      ))}
    </group>
  );
}

/** hills round the field, so the edge reads as a valley rather than a cliff */
function Hills() {
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(WAR.radius + 120, WAR.radius + 60, 24, 64, 1, true);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      if (p.getY(i) > 0) p.setY(i, 6 + Math.sin(Math.atan2(z, x) * 5) * 4 + Math.sin(Math.atan2(z, x) * 13) * 2);
      else p.setY(i, 0);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <mesh geometry={geo} position={[0, 2.5, 0]}>
      <meshStandardMaterial color="#5f6b45" roughness={1} side={THREE.BackSide} />
    </mesh>
  );
}

export function WendingMap() {
  return (
    <group>
      <Sky zenith="#5d86b8" horizon="#efe4cc" below="#6b7448" sunDir={[SUN.x, SUN.y, SUN.z]} sunColor="#fff0cc" sunSize={1.1} streaks={0.25} streakColor="#f6efe0" />
      <Ground />
      <Grass />
      <Hills />
      <Terrace />
      <Ridges />
      <Camps />
      <Springs />
      <Live />
    </group>
  );
}
