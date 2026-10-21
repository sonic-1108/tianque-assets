import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { DX } from '../dixian';
import { CombatantState } from '../types';

// 地仙's things in the world: the 地脉回春 ring on the ground (a golden earth circle with a turning ring of glyph marks and
// leaves of light rising), the white crane of 人间不渡 circling overhead, and a pale feather shell on whoever wears 鹤羽护.

/** the spring's face: a soft jade disc, two rims and eight marks round the edge (drawn once) */
const springTex = (() => {
  let t: THREE.Texture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 126);
    grd.addColorStop(0, 'rgba(242,204,107,0.05)');
    grd.addColorStop(0.75, 'rgba(214,160,60,0.2)');
    grd.addColorStop(0.97, 'rgba(250,224,150,0.6)');
    grd.addColorStop(1, 'rgba(250,224,150,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,240,200,0.9)';
    g.lineWidth = 3;
    for (const r of [118, 92]) {
      g.beginPath();
      g.arc(128, 128, r, 0, Math.PI * 2);
      g.stroke();
    }
    // eight short marks between the rims, like the stems of a trigram
    g.lineWidth = 5;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      for (const off of [-0.07, 0, 0.07]) {
        const b = a + off;
        g.beginPath();
        g.moveTo(128 + Math.cos(b) * 97, 128 + Math.sin(b) * 97);
        g.lineTo(128 + Math.cos(b) * 113, 128 + Math.sin(b) * 113);
        g.stroke();
      }
    }
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
})();

/** a white crane in flight: body, neck, head, beak, two wings (each a group so it can flap), black wingtips, legs trailing */
function buildCrane() {
  const root = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.6, emissive: '#d1fae5', emissiveIntensity: 0.35 });
  const black = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.7 });
  const red = new THREE.MeshStandardMaterial({ color: '#dc2626', emissive: '#7f1d1d', emissiveIntensity: 0.6 });
  const beakM = new THREE.MeshStandardMaterial({ color: '#a3a38a', roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), white);
  body.scale.set(0.7, 0.6, 1.5);
  root.add(body);
  const neck = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.05, -0.5), new THREE.Vector3(0, 0.2, -0.9), new THREE.Vector3(0, 0.25, -1.35)]), 10, 0.07, 6, false), white);
  root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), black);
  head.position.set(0, 0.27, -1.4);
  root.add(head);
  const crest = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), red);
  crest.position.set(0, 0.36, -1.4);
  root.add(crest);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.4, 6), beakM);
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, 0.25, -1.68);
  root.add(beak);
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 4), black);
  legs.rotation.x = Math.PI / 2;
  legs.position.set(0, -0.05, 0.95);
  root.add(legs);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 6), black);
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.02, 0.7);
  root.add(tail);
  const wings: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.22, 0.12, -0.05);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 0.75), white);
    inner.position.set(s * 0.65, 0, 0);
    const outer = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.035, 0.55), white);
    outer.position.set(s * 1.7, 0, 0.08);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.5), black);
    tip.position.set(s * 2.35, 0, 0.12);
    w.add(inner, outer, tip);
    w.userData.side = s;
    wings.push(w);
    root.add(w);
  }
  root.userData.wings = wings;
  root.visible = false;
  return root;
}

const MAXS = 6;
const MAXK = 3;
const MAXF = 9;
export function DixianFx({ fighters }: { fighters: React.MutableRefObject<CombatantState[]> }) {
  const mats = useMemo(
    () => ({
      disc: new THREE.MeshBasicMaterial({ map: springTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      shell: new THREE.MeshBasicMaterial({ color: '#f0fdf4', transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }),
      wall: new THREE.MeshBasicMaterial({ color: '#e9b949', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    }),
    []
  );
  const parts = useMemo(() => {
    const discs = Array.from({ length: MAXS }, () => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), mats.disc.clone());
      m.visible = false;
      m.renderOrder = 2;
      return m;
    });
    // a low wall of light round the rim, fading upward
    const walls = Array.from({ length: MAXS }, () => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.6, 48, 1, true), mats.wall.clone());
      m.visible = false;
      return m;
    });
    const cranes = Array.from({ length: MAXK }, () => buildCrane());
    // 青气弹: a bright core in a soft green halo
    const bolts = Array.from({ length: 12 }, () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: '#ecfdf5' })));
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), new THREE.MeshBasicMaterial({ color: '#4ade80', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })));
      g.visible = false;
      return g;
    });
    // 损有余: a glowing pink thread from the enemy to the ally, sagging a little
    const threads = Array.from({ length: 4 }, () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(17 * 3), 3));
      const l = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#f472b6', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      l.frustumCulled = false;
      l.visible = false;
      return l;
    });
    const shells = Array.from({ length: MAXF }, () => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mats.shell);
      m.visible = false;
      return m;
    });
    return { discs, walls, cranes, shells, bolts, threads };
  }, [mats]);
  const g = useRef<THREE.Group>(null);
  useFrame((st) => {
    const time = st.clock.elapsedTime;
    // 地脉回春
    parts.discs.forEach((d, k) => {
      const s = DX.springs[k];
      const w = parts.walls[k];
      if (!s) {
        d.visible = w.visible = false;
        return;
      }
      const grow = Math.min(1, s.age / 0.35);
      const fade = Math.min(1, s.t / 0.6);
      const r = s.r * (0.3 + 0.7 * grow);
      d.visible = w.visible = true;
      d.position.set(s.x, s.y + 0.06, s.z);
      d.scale.setScalar(r);
      d.rotation.y = time * 0.25;
      (d.material as THREE.MeshBasicMaterial).opacity = (0.75 + 0.25 * Math.sin(time * 3)) * fade;
      w.position.set(s.x, s.y + 0.3, s.z);
      w.scale.set(r, 1, r);
      (w.material as THREE.MeshBasicMaterial).opacity = 0.12 * fade;
    });
    // 人间不渡: the crane comes down in a wide circle, flaps round him three times, then climbs away
    parts.cranes.forEach((cr, k) => {
      const c = DX.cranes[k];
      if (!c) {
        cr.visible = false;
        return;
      }
      cr.visible = true;
      const t = c.t;
      const a = t * 1.9;
      const rad = 5.5 - Math.min(2, t) * 0.9;
      const h = t < 0.6 ? 14 - t * 15 : t > 3.6 ? 5 + (t - 3.6) * 12 : 5 + Math.sin(t * 2) * 0.4;
      const x = c.x + Math.cos(a) * rad;
      const z = c.z + Math.sin(a) * rad;
      cr.position.set(x, c.y + h, z);
      // fly along the circle: forward is -Z in its own frame
      cr.rotation.set(0, Math.PI - a, 0.35, 'YXZ'); // facing along the circle, banked into the turn
      cr.scale.setScalar(1.1);
      const flap = Math.sin(time * 9) * 0.55;
      for (const w of cr.userData.wings as THREE.Group[]) w.rotation.z = flap * (w.userData.side as number);
    });
    parts.bolts.forEach((g, k) => {
      const b = DX.bolts[k];
      g.visible = !!b;
      if (!b) return;
      g.position.set(b.x, b.y, b.z);
      g.scale.setScalar((b.big ? 1.6 : 1) * (0.9 + 0.15 * Math.sin(time * 30 + k)));
    });
    const fs = fighters.current;
    parts.threads.forEach((l, k) => {
      const T = DX.tethers[k];
      const a = T && fs[T.from];
      const b = T && fs[T.to];
      l.visible = !!(a && b);
      if (!a || !b) return;
      const arr = (l.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i <= 16; i++) {
        const q = i / 16;
        arr[i * 3] = a.pos[0] + (b.pos[0] - a.pos[0]) * q;
        arr[i * 3 + 1] = a.pos[1] + 1.2 + (b.pos[1] - a.pos[1]) * q + Math.sin(q * Math.PI) * 0.5 + Math.sin(time * 12 + q * 9) * 0.05;
        arr[i * 3 + 2] = a.pos[2] + (b.pos[2] - a.pos[2]) * q;
      }
      l.geometry.attributes.position.needsUpdate = true;
      (l.material as THREE.LineBasicMaterial).opacity = 0.6 + 0.35 * Math.sin(time * 10);
    });
    // 鹤羽护
    parts.shells.forEach((m, k) => {
      const f = fs[k];
      if (!f || !(f.craneShield ?? 0) || f.hp <= 0) {
        m.visible = false;
        return;
      }
      m.visible = true;
      m.position.set(f.pos[0], f.pos[1] + 1.0, f.pos[2]);
      m.scale.set(0.85, 1.2, 0.85);
      m.rotation.y = time;
    });
  });
  return (
    <group ref={g}>
      {parts.discs.map((d, k) => (
        <primitive key={`d${k}`} object={d} />
      ))}
      {parts.walls.map((d, k) => (
        <primitive key={`w${k}`} object={d} />
      ))}
      {parts.cranes.map((d, k) => (
        <primitive key={`c${k}`} object={d} />
      ))}
      {parts.shells.map((d, k) => (
        <primitive key={`s${k}`} object={d} />
      ))}
      {parts.bolts.map((d, k) => (
        <primitive key={`b${k}`} object={d} />
      ))}
      {parts.threads.map((d, k) => (
        <primitive key={`t${k}`} object={d} />
      ))}
    </group>
  );
}
