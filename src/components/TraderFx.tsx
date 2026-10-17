import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { TR, TRADER } from '../trader';
import { CombatantState } from '../types';

// 交易员's things in the world: Rolexes in flight, cash on the ground, the red candles of 黑色星期一 coming down,
// the SHORT arrow over whoever he shorted, and the Patagonia vest he glides under.

function watchGeo() {
  const bezel = new THREE.TorusGeometry(0.16, 0.035, 10, 28);
  const face = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 28).rotateX(Math.PI / 2);
  const strapA = new THREE.BoxGeometry(0.13, 0.2, 0.03).translate(0, 0.25, 0);
  const strapB = new THREE.BoxGeometry(0.13, 0.2, 0.03).translate(0, -0.25, 0);
  return { bezel, face, strap: mergeTwo(strapA, strapB) };
}
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
  const A = a.toNonIndexed();
  const B = b.toNonIndexed();
  const g = new THREE.BufferGeometry();
  for (const n of ['position', 'normal']) {
    const x = A.attributes[n].array as Float32Array;
    const y = B.attributes[n].array as Float32Array;
    const arr = new Float32Array(x.length + y.length);
    arr.set(x);
    arr.set(y, x.length);
    g.setAttribute(n, new THREE.BufferAttribute(arr, 3));
  }
  return g;
}
const shortTex = (() => {
  let t: THREE.Texture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ff2a2a';
    g.beginPath();
    g.moveTo(88, 70);
    g.lineTo(168, 70);
    g.lineTo(168, 100);
    g.lineTo(200, 100);
    g.lineTo(128, 156);
    g.lineTo(56, 100);
    g.lineTo(88, 100);
    g.closePath();
    g.fill();
    g.font = 'bold 54px Arial, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 8;
    g.strokeStyle = '#300';
    g.strokeText('SHORT', 128, 52);
    g.fillText('SHORT', 128, 52);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
})();
const dreamTex = (() => {
  let t: THREE.Texture | null = null;
  return () => {
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 160;
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.strokeStyle = '#2f6b3f';
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(100, 62, 88, 54, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    for (const [x, y, r] of [[48, 128, 12], [28, 148, 7]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.fillStyle = '#2f8a3f';
    g.font = 'bold 70px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('$$$', 100, 66);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
})();
function billTex() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 56;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9dcb8';
  g.fillRect(0, 0, 128, 56);
  g.strokeStyle = '#3d6b3a';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 120, 48);
  g.fillStyle = '#4f7d49';
  g.beginPath();
  g.ellipse(64, 28, 14, 17, 0, 0, Math.PI * 2);
  g.fill();
  g.font = 'bold 20px Georgia, serif';
  g.fillText('100', 10, 24);
  g.fillText('100', 86, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** the vest held overhead: a quilted orange shell with navy trim, puffed like a little canopy */
function vestGeo() {
  const g = new THREE.SphereGeometry(1.1, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.32);
  g.scale(1.25, 0.55, 0.75);
  return g;
}
function vestMat() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8641e';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = 'rgba(80,30,5,0.45)';
  g.lineWidth = 3;
  for (let y = 10; y < 128; y += 18) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  g.fillStyle = '#1d2a4a';
  g.fillRect(0, 112, 256, 16);
  g.fillRect(122, 0, 12, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7, side: THREE.DoubleSide });
}

const MAXR = 8;
const MAXB = 6 * TRADER.cash.bills;
const MAXC = 20;
export function TraderFx({ fighters }: { fighters: React.MutableRefObject<CombatantState[]> }) {
  const wg = useMemo(() => watchGeo(), []);
  const mats = useMemo(
    () => ({
      gold: new THREE.MeshStandardMaterial({ color: '#e6c25a', metalness: 1, roughness: 0.22, emissive: '#3a2a00', emissiveIntensity: 0.6 }),
      face: new THREE.MeshStandardMaterial({ color: '#0f3d2a', metalness: 0.4, roughness: 0.2 }),
      bill: new THREE.MeshStandardMaterial({ map: billTex(), roughness: 0.85, side: THREE.DoubleSide }),
      candle: new THREE.MeshStandardMaterial({ color: '#d4181c', emissive: '#7a0000', emissiveIntensity: 0.8, roughness: 0.4 }),
      wick: new THREE.MeshStandardMaterial({ color: '#ff3b3b', emissive: '#ff0000', emissiveIntensity: 1 }),
      ring: new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
      vest: vestMat(),
      line: new THREE.MeshBasicMaterial({ color: '#222' }),
    }),
    []
  );
  const meshes = useMemo(() => {
    const im = (g: THREE.BufferGeometry, m: THREE.Material, n: number) => {
      const x = new THREE.InstancedMesh(g, m, n);
      x.count = 0;
      x.frustumCulled = false;
      return x;
    };
    return {
      bezel: im(wg.bezel, mats.gold, MAXR),
      face: im(wg.face, mats.face, MAXR),
      strap: im(wg.strap, mats.gold, MAXR),
      bills: im(new THREE.PlaneGeometry(0.34, 0.15).rotateX(-Math.PI / 2), mats.bill, MAXB),
      candle: im(new THREE.BoxGeometry(1, 1, 1), mats.candle, MAXC),
      wick: im(new THREE.BoxGeometry(1, 1, 1), mats.wick, MAXC),
      ring: im(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), mats.ring, MAXC),
      vest: im(vestGeo(), mats.vest, 9),
      dreams: Array.from({ length: 9 }, () => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dreamTex(), depthTest: false, transparent: true }));
        s.scale.set(1.0, 0.8, 1);
        s.visible = false;
        s.renderOrder = 10;
        return s;
      }),
      shorts: Array.from({ length: 9 }, () => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: shortTex(), depthTest: false, transparent: true }));
        s.scale.set(1.1, 0.7, 1);
        s.visible = false;
        s.renderOrder = 10;
        return s;
      }),
    };
  }, [wg, mats]);
  const o = useMemo(() => new THREE.Object3D(), []);
  const g = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime;
    // Rolexes in flight
    let n = 0;
    for (const r of TR.rolex) {
      if (n >= MAXR) break;
      if (r.delay > 0) continue;
      o.position.set(r.x, r.y, r.z);
      o.rotation.set(r.spin, r.spin * 0.7, 0);
      o.scale.setScalar(1.6);
      o.updateMatrix();
      meshes.bezel.setMatrixAt(n, o.matrix);
      meshes.face.setMatrixAt(n, o.matrix);
      meshes.strap.setMatrixAt(n, o.matrix);
      n++;
    }
    meshes.bezel.count = meshes.face.count = meshes.strap.count = n;
    meshes.bezel.instanceMatrix.needsUpdate = meshes.face.instanceMatrix.needsUpdate = meshes.strap.instanceMatrix.needsUpdate = true;
    // cash on the ground: 40 bills a patch, scattered by its seed, fluttering a little
    let b = 0;
    for (const P of TR.cash) {
      if (P.delay > 0) continue;
      let s = P.seed;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const fade = Math.min(1, P.t / 0.8);
      const age = TRADER.cash.t - P.t;
      for (let k = 0; k < TRADER.cash.bills && b < MAXB; k++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * P.r;
        // each bill flutters down out of the air over the first second, then lies there
        const fall = Math.max(0, 1 - (age - rnd() * 0.5) / 0.9);
        const h = fall * (2.5 + rnd() * 3);
        o.position.set(P.x + Math.cos(a) * d + Math.sin(t * 6 + k) * 0.25 * fall, P.y + 0.03 + rnd() * 0.05 + h, P.z + Math.sin(a) * d);
        o.rotation.set((rnd() - 0.5) * 0.3 + fall * Math.sin(t * 7 + k) * 1.2, rnd() * 6.28 + fall * t * 3, (rnd() - 0.5) * 0.3);
        o.scale.setScalar(1.3 * fade);
        o.updateMatrix();
        meshes.bills.setMatrixAt(b++, o.matrix);
      }
    }
    meshes.bills.count = b;
    meshes.bills.instanceMatrix.needsUpdate = true;
    // 黑色星期一's candles: a red ring while it's coming, then a red bar (with its wick) falling out of the sky
    let c = 0;
    let rc = 0;
    for (const C of TR.candles) {
      if (c >= MAXC) break;
      const w = C.big ? 3.0 : 1.1;
      const h = C.big ? 14 : 5.5;
      if (C.t < C.warn) {
        o.position.set(C.x, C.y + 0.06, C.z);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(C.r * (0.6 + 0.4 * (C.t / C.warn)));
        o.updateMatrix();
        meshes.ring.setMatrixAt(rc++, o.matrix);
      }
      const fall = Math.max(0, C.t - C.warn + 0.35) / 0.35;
      if (fall <= 0) continue;
      const drop = Math.max(0, 1 - fall);
      const sink = Math.max(0, C.t - C.warn - 0.8) * 4;
      const y = C.y + h / 2 + drop * drop * 40 - sink;
      o.rotation.set(0, (C.x * 13 + C.z * 7) % 6.28, 0);
      o.position.set(C.x, y, C.z);
      o.scale.set(w, h, w);
      o.updateMatrix();
      meshes.candle.setMatrixAt(c, o.matrix);
      o.position.set(C.x, y + h / 2 + h * 0.18, C.z);
      o.scale.set(w * 0.12, h * 0.36, w * 0.12);
      o.updateMatrix();
      meshes.wick.setMatrixAt(c, o.matrix);
      c++;
    }
    meshes.candle.count = meshes.wick.count = c;
    meshes.ring.count = rc;
    meshes.candle.instanceMatrix.needsUpdate = meshes.wick.instanceMatrix.needsUpdate = meshes.ring.instanceMatrix.needsUpdate = true;
    // over the fighters: the SHORT arrow, the vest canopy
    let v = 0;
    fighters.current.forEach((f, i) => {
      const dr = meshes.dreams[i];
      if (dr) {
        dr.visible = (f.dreamT ?? 0) > 0 && f.hp > 0;
        if (dr.visible) dr.position.set(f.pos[0] + 0.35, f.pos[1] + 2.4 + Math.sin(t * 2.5) * 0.1 + ((f.shortT ?? 0) > 0 ? 0.8 : 0), f.pos[2]);
      }
      const sp = meshes.shorts[i];
      if (sp) {
        sp.visible = (f.shortT ?? 0) > 0 && f.hp > 0;
        if (sp.visible) sp.position.set(f.pos[0], f.pos[1] + 2.55 + Math.sin(t * 4) * 0.08, f.pos[2]);
      }
      if ((f.glide ?? 0) > 0 && v < 9) {
        o.position.set(f.pos[0], f.pos[1] + 2.45, f.pos[2]);
        o.rotation.set(Math.sin(t * 5) * 0.06, f.rotY, Math.sin(t * 3.3) * 0.08);
        o.scale.setScalar(1);
        o.updateMatrix();
        meshes.vest.setMatrixAt(v++, o.matrix);
      }
    });
    meshes.vest.count = v;
    meshes.vest.instanceMatrix.needsUpdate = true;
  });
  return (
    <group ref={g}>
      {Object.entries(meshes).map(([k, m]) => (Array.isArray(m) ? m.map((s, j) => <primitive key={k + j} object={s} />) : <primitive key={k} object={m} />))}
    </group>
  );
}
