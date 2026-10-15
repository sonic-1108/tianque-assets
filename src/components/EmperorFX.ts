import * as THREE from 'three';
import { DragonFX } from './DragonFX';

// ==================================================================
// 天子 effects: the red warning fan before 横扫千军 and the golden crescent that sweeps it, the golden dragon of
// 真龙降世 (spirals up round him, then dives on its mark), the arrows of 御林箭雨 raining into their circle and
// standing in the ground after, and the wrath aura. Owned by VFXSystem; everything is pooled and allocated once.
// ==================================================================

const GOLD = new THREE.Color('#ffcf5a');
const DEEP = new THREE.Color('#ff8a1a');

/** a flat sector on the ground (+Z is the middle of the arc), from r0 to 1 (scaled by radius) */
function sectorGeo(arc: number, r0: number, seg = 40) {
  const g = new THREE.RingGeometry(r0, 1, seg, 1, Math.PI / 2 - arc / 2, arc);
  g.rotateX(-Math.PI / 2);
  // RingGeometry runs counter-clockwise from +X; after the rotation its middle points to -Z: turn it to +Z
  g.rotateY(Math.PI);
  return g;
}

const fanMat = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uFill: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color('#ff3020') } },
    vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform float uFill; uniform float uAlpha; uniform vec3 uColor; varying vec2 vP;
      void main(){ float r = length(vP);
        float edge = smoothstep(0.93, 1.0, r) * 0.9;
        float fill = step(r, uFill) * 0.32 + smoothstep(uFill - 0.04, uFill, r) * step(r, uFill) * 0.5;
        float a = (edge + fill + 0.08) * uAlpha;
        gl_FragColor = vec4(uColor * (0.7 + edge), a); }`,
  });

const crescentMat = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `uniform float uAlpha; varying vec2 vUv;
      void main(){
        // across the band: hot white core at the leading edge, gold tailing off behind
        float x = vUv.y;
        float core = pow(x, 10.0) * 0.6;
        float body = pow(x, 1.6);
        // along the arc: fade at both tips
        float tip = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        vec3 c = mix(vec3(0.95, 0.32, 0.04), vec3(1.0, 0.7, 0.18), body) + vec3(1.0, 0.9, 0.6) * core;
        gl_FragColor = vec4(c * 1.15, (body * 0.85 + core) * tip * uAlpha); }`,
  });

/** a ribbon sector standing up a little (the swept blade's path), uv.x along the arc, uv.y outward */
function crescentGeo(arc: number, seg = 48) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = -arc / 2 + arc * t;
    for (const [r, v, h] of [
      [0.55, 0, -0.25],
      [1.0, 1, 0.25],
    ]) {
      pos.push(Math.sin(a) * r, h, Math.cos(a) * r);
      uv.push(t, v);
    }
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

interface Fan {
  m: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  t: number;
  dur: number;
}
interface Crescent {
  g: THREE.Group;
  mats: THREE.ShaderMaterial[];
  t: number;
  radius: number;
}
interface Volley {
  arrows: { x: number; z: number; y0: number; gy: number; delay: number; tilt: number; yaw: number }[];
  t: number;
  dur: number;
  base: number; // first instance index
}


export class EmperorFX {
  private root: THREE.Object3D;
  private fans: Fan[] = [];
  private crescents: Crescent[] = [];
  private arrowMesh: THREE.InstancedMesh;
  private arrowSlots = 0;
  private volleys: Volley[] = [];
  private dragons: DragonFX[] = [];
  private auras: { mesh: THREE.Mesh; owner: number; on: number; seen: boolean }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private c = new THREE.Color();
  /** set by the owner: where to throw embers along the dragon */
  embers?: (p: THREE.Vector3, n: number, color: THREE.ColorRepresentation) => void;
  clouds?: (p: THREE.Vector3) => void;

  constructor(root: THREE.Object3D) {
    this.root = root;
    // warning fans
    for (let i = 0; i < 3; i++) {
      const mat = fanMat();
      const m = new THREE.Mesh(sectorGeo(Math.PI * 0.8, 0.0), mat);
      m.visible = false;
      m.renderOrder = 11;
      root.add(m);
      this.fans.push({ m, mat, t: 0, dur: 1 });
    }
    // crescents: an outer gold blade and an inner, tighter echo a beat behind
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const mats = [crescentMat(), crescentMat()];
      const a = new THREE.Mesh(crescentGeo(Math.PI * 0.8), mats[0]);
      const b = new THREE.Mesh(crescentGeo(Math.PI * 0.7), mats[1]);
      b.position.y = 0.3;
      b.rotation.z = 0.12;
      a.renderOrder = b.renderOrder = 13;
      g.add(a, b);
      g.visible = false;
      root.add(g);
      this.crescents.push({ g, mats, t: 0, radius: 5 });
    }
    // arrows: shaft, head and fletching in one geometry, pointing down -Y
    const shaft = new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5);
    const tip = new THREE.ConeGeometry(0.08, 0.24, 6);
    tip.rotateX(Math.PI);
    tip.translate(0, -0.62, 0);
    const fl1 = new THREE.PlaneGeometry(0.16, 0.3);
    fl1.translate(0, 0.45, 0);
    const fl2 = fl1.clone();
    fl2.rotateY(Math.PI / 2);
    const parts = [shaft, tip, fl1, fl2].map((g) => g.toNonIndexed());
    const cols: number[] = [];
    const tint = [new THREE.Color('#5a3a22'), new THREE.Color('#c9ccd2'), new THREE.Color('#d8d0c0'), new THREE.Color('#d8d0c0')];
    parts.forEach((g, k) => {
      for (let n = 0; n < g.attributes.position.count; n++) cols.push(tint[k].r, tint[k].g, tint[k].b);
    });
    const arrowGeo = mergeSimple(parts);
    arrowGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.arrowMesh = new THREE.InstancedMesh(arrowGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, emissive: '#2a1a08' }), 160);
    this.arrowMesh.count = 0;
    this.arrowMesh.frustumCulled = false;
    root.add(this.arrowMesh);
    for (let k = 0; k < 2; k++) {
      const d = new DragonFX(root);
      d.embers = (p, n, c) => this.embers?.(p, n, c);
      d.clouds = (p) => this.clouds?.(p);
      this.dragons.push(d);
    }
    // wrath aura: a slowly turning golden ring of flame at his feet
    for (let k = 0; k < 3; k++) {
    const auraMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uA: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform float uT; uniform float uA; varying vec2 vP;
        void main(){ float r = length(vP); float a = atan(vP.y, vP.x);
          float band = smoothstep(0.55, 0.8, r) * smoothstep(1.0, 0.82, r);
          float lick = 0.55 + 0.45 * sin(a * 9.0 + uT * 5.0) * sin(a * 4.0 - uT * 3.0);
          vec3 c = mix(vec3(1.0, 0.4, 0.05), vec3(1.0, 0.85, 0.4), lick);
          gl_FragColor = vec4(c * 1.8, band * lick * uA); }`,
    });
    const aura = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), auraMat);
    aura.rotation.x = -Math.PI / 2;
    aura.visible = false;
    aura.renderOrder = 12;
    root.add(aura);
    this.auras.push({ mesh: aura, owner: -1, on: 0, seen: false });
    }
  }

  /** a red warning sector on the ground that fills over `dur` seconds (radius in m, arc in radians, yaw = middle) */
  fan(pos: THREE.Vector3, yaw: number, radius: number, arc: number, dur: number) {
    const f = this.fans.find((x) => !x.m.visible) ?? this.fans[0];
    f.m.geometry.dispose();
    f.m.geometry = sectorGeo(arc, 0.0);
    f.m.position.set(pos.x, pos.y + 0.06, pos.z);
    f.m.rotation.y = yaw;
    f.m.scale.setScalar(radius);
    f.t = 0;
    f.dur = dur;
    f.m.visible = true;
  }

  /** the golden crescent of 横扫千军, sweeping out to `radius` */
  crescent(pos: THREE.Vector3, yaw: number, radius: number) {
    const c = this.crescents.find((x) => !x.g.visible) ?? this.crescents[0];
    c.g.position.set(pos.x, pos.y + 0.9, pos.z);
    c.g.rotation.set(0, yaw, 0);
    c.g.scale.set(0.6, 1, 0.6);
    c.radius = radius;
    c.t = 0;
    c.g.visible = true;
  }

  /** 御林箭雨: arrows pour into the circle over the last part of `dur`, then stand in the ground for a while */
  volley(pos: THREE.Vector3, r: number, dur: number, groundAt: (x: number, z: number) => number) {
    const n = 30;
    if (this.arrowSlots + n > 160) this.arrowSlots = 0;
    const v: Volley = { arrows: [], t: 0, dur, base: this.arrowSlots };
    this.arrowSlots += n;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const x = pos.x + Math.cos(a) * d;
      const z = pos.z + Math.sin(a) * d;
      v.arrows.push({ x, z, y0: 0, gy: groundAt(x, z), delay: dur - 0.45 + Math.random() * 0.4, tilt: 0.25 + Math.random() * 0.2, yaw: 0.6 + Math.random() * 0.4 });
    }
    this.volleys.push(v);
    this.arrowMesh.count = Math.max(this.arrowMesh.count, this.arrowSlots);
  }

  /** 真龙降世: the dragon coils up round `origin` for `rise` s, then dives on `target`; returns its handle */
  summonDragon(origin: THREE.Vector3, target: THREE.Vector3, rise: number, dive: number, onImpact: () => void) {
    let k = this.dragons.findIndex((d) => !d.active);
    if (k < 0) k = 0;
    this.dragons[k].start(origin, target, rise, dive, onImpact);
    return k;
  }
  /** keep a dive homing on its target until it commits */
  retarget(k: number, p: THREE.Vector3) {
    this.dragons[k]?.retarget(p);
  }

  /** the wrath aura under emperor `owner` (a fighter index); null puts it out */
  setAura(owner: number, pos: THREE.Vector3 | null) {
    let A = this.auras.find((a) => a.owner === owner);
    if (!A && pos) {
      A = this.auras.find((a) => a.on <= 0);
      if (A) A.owner = owner;
    }
    if (!A) return;
    A.seen = true;
    if (!pos) return;
    A.on = Math.min(1, A.on + 0.05);
    A.mesh.visible = true;
    A.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    A.mesh.userData.lit = true;
  }

  update(dt: number, time: number) {
    for (const f of this.fans) {
      if (!f.m.visible) continue;
      f.t += dt;
      f.mat.uniforms.uFill.value = Math.min(1, f.t / f.dur);
      f.mat.uniforms.uAlpha.value = f.t > f.dur ? Math.max(0, 1 - (f.t - f.dur) / 0.15) : 1;
      if (f.t > f.dur + 0.15) f.m.visible = false;
    }
    for (const c of this.crescents) {
      if (!c.g.visible) continue;
      c.t += dt;
      const grow = Math.min(1, c.t / 0.2);
      const sc = 0.6 + (c.radius - 0.6) * (1 - Math.pow(1 - grow, 3));
      c.g.scale.set(sc, 1, sc);
      const a = c.t < 0.16 ? 1 : Math.max(0, 1 - (c.t - 0.16) / 0.3);
      c.mats[0].uniforms.uAlpha.value = a;
      c.mats[1].uniforms.uAlpha.value = c.t < 0.06 ? 0 : a * 0.7;
      if (c.t > 0.5) c.g.visible = false;
    }
    // arrows
    for (let vi = this.volleys.length - 1; vi >= 0; vi--) {
      const V = this.volleys[vi];
      V.t += dt;
      V.arrows.forEach((A, k) => {
        const tt = V.t - A.delay;
        let y: number;
        let hide = false;
        if (tt < 0) hide = true;
        const fall = 0.3;
        if (tt < fall) y = A.gy + 0.55 + (1 - Math.max(0, tt) / fall) * 16;
        else y = A.gy + 0.4; // stuck in the ground, a little sunk
        const fade = V.t > V.dur + 1.6 ? Math.max(0, 1 - (V.t - V.dur - 1.6) / 0.6) : 1;
        if (fade <= 0) hide = true;
        this.q.setFromEuler(new THREE.Euler(A.tilt * Math.cos(A.yaw), 0, A.tilt * Math.sin(A.yaw)));
        this.v.set(A.x - Math.sin(A.tilt) * (y - A.gy) * 0.3, y, A.z);
        this.s.setScalar(hide ? 0 : fade);
        this.arrowMesh.setMatrixAt(V.base + k, this.m.compose(this.v, this.q, this.s));
      });
      if (V.t > V.dur + 2.3) this.volleys.splice(vi, 1);
    }
    if (this.volleys.length || this.arrowMesh.count) this.arrowMesh.instanceMatrix.needsUpdate = true;
    if (!this.volleys.length) {
      this.arrowMesh.count = 0;
      this.arrowSlots = 0;
    }
    for (const d of this.dragons) d.update(dt, time);
    for (const A of this.auras) {
      if (!A.mesh.userData.lit) A.on = Math.max(0, A.on - 0.05);
      A.mesh.userData.lit = false;
      if (A.on <= 0) {
        A.mesh.visible = false;
        A.owner = -1;
      }
      const am = A.mesh.material as THREE.ShaderMaterial;
      am.uniforms.uT.value = time;
      am.uniforms.uA.value = A.on;
      A.mesh.rotation.z = time * 0.6;
    }
  }
}

/** merge non-indexed geometries with position + normal (no extra deps) */
function mergeSimple(gs: THREE.BufferGeometry[]) {
  let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of gs) {
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
