import * as THREE from 'three';

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
interface Dragon {
  active: boolean;
  t: number;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  rise: number;
  dive: number;
  hist: THREE.Vector3[];
  histN: number;
  onImpact?: () => void;
  impacted: boolean;
  dir: number;
}

const TS = 64; // rings along the dragon
const TR = 10; // sides round the body
const FINS = 18;
const HIST = 150;

export class EmperorFX {
  private root: THREE.Object3D;
  private fans: Fan[] = [];
  private crescents: Crescent[] = [];
  private arrowMesh: THREE.InstancedMesh;
  private arrowSlots = 0;
  private volleys: Volley[] = [];
  private body: THREE.Mesh;
  private tubeMat: THREE.ShaderMaterial;
  private fins: THREE.InstancedMesh;
  private claws: THREE.InstancedMesh;
  private pts: THREE.Vector3[] = [];
  private frameN: THREE.Vector3[] = [];
  private head: THREE.Group;
  private glow: THREE.PointLight;
  private dragon: Dragon;
  private aura: THREE.Mesh;
  private auraOn = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private c = new THREE.Color();
  /** set by the owner: where to throw embers along the dragon */
  embers?: (p: THREE.Vector3, n: number, color: THREE.ColorRepresentation) => void;

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
    // the dragon: scaled body pearls, a dorsal fin row, a head with horns, whiskers and a pearl of light
    const tubeGeo = new THREE.BufferGeometry();
    tubeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TS * TR * 3), 3));
    tubeGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(TS * TR * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const tuv: number[] = [];
    const tidx: number[] = [];
    for (let i = 0; i < TS; i++)
      for (let j = 0; j < TR; j++) {
        tuv.push(i / (TS - 1), j / TR);
        if (i < TS - 1) {
          const a0 = i * TR + j;
          const a1 = i * TR + ((j + 1) % TR);
          tidx.push(a0, a0 + TR, a1, a1, a0 + TR, a1 + TR);
        }
      }
    tubeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2));
    tubeGeo.setIndex(tidx);
    this.tubeMat = new THREE.ShaderMaterial({
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uA: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal + vec3(0.0, 1e-4, 0.0)); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform float uT; uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          // overlapping scales: offset rows of rounded cells, darker at each scale's rim
          vec2 g = vec2(vUv.x * 42.0, vUv.y * 8.0);
          g.y += step(1.0, mod(floor(g.x), 2.0)) * 0.5;
          vec2 f = fract(g) - vec2(0.15, 0.5);
          float cell = 1.0 - smoothstep(0.25, 0.5, length(f * vec2(1.0, 0.8)));
          float fres = pow(1.0 - abs(dot(vN, vV)), 2.0);
          // gold, warming to fire toward the tail, a shimmer running down the body
          float run = 0.5 + 0.5 * sin(vUv.x * 30.0 - uT * 14.0);
          vec3 gold = mix(vec3(1.0, 0.78, 0.3), vec3(1.0, 0.45, 0.1), vUv.x * 0.8);
          vec3 c = gold * (0.55 + 0.6 * cell) + vec3(1.0, 0.9, 0.6) * fres * 1.3 + gold * run * 0.25;
          // the tail dissolves into flame
          float a = uA * (1.0 - smoothstep(0.82, 1.0, vUv.x) * (0.6 + 0.4 * sin(vUv.y * 40.0 + uT * 20.0)));
          gl_FragColor = vec4(c * 1.25, a); }`,
    });
    this.body = new THREE.Mesh(tubeGeo, this.tubeMat);
    this.body.frustumCulled = false;
    this.body.visible = false;
    // flame fins along the spine
    const fin = new THREE.ConeGeometry(0.5, 1.4, 4);
    fin.translate(0, 0.7, 0);
    this.fins = new THREE.InstancedMesh(fin, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff6a1a').multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.9 }), FINS);
    this.fins.frustumCulled = false;
    this.fins.visible = false;
    // four claws
    const claw = new THREE.ConeGeometry(0.09, 0.5, 5);
    claw.translate(0, -0.25, 0);
    this.claws = new THREE.InstancedMesh(claw, new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff0c0').multiplyScalar(1.5), toneMapped: false }), 4);
    this.claws.frustumCulled = false;
    this.claws.visible = false;
    root.add(this.body, this.fins, this.claws);
    this.head = new THREE.Group();
    const hm = new THREE.MeshStandardMaterial({ color: '#ffc84a', emissive: '#ff9a20', emissiveIntensity: 0.85, metalness: 0.55, roughness: 0.35, flatShading: true });
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), hm);
    skull.scale.set(1, 0.8, 1.3);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.6), hm);
    snout.position.set(0, -0.06, 0.55);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.5), new THREE.MeshStandardMaterial({ color: '#e06a1a', emissive: '#ff3a0a', emissiveIntensity: 0.9, roughness: 0.5 }));
    jaw.position.set(0, -0.24, 0.5);
    jaw.rotation.x = 0.35;
    this.head.add(skull, snout, jaw);
    const hornMat = new THREE.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffcf7a', emissiveIntensity: 0.6, roughness: 0.4 });
    // a flaming mane swept back from the skull
    const maneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a').multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.9 });
    for (let k = 0; k < 7; k++) {
      const mane = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.75, 4), maneMat);
      const a = (k / 6 - 0.5) * 2.4;
      mane.position.set(Math.sin(a) * 0.3, 0.1 + Math.cos(a) * 0.22, -0.45);
      mane.rotation.set(-1.9, 0, -a * 0.6);
      this.head.add(mane);
    }
    for (const sg of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.8, 6), hornMat);
      horn.position.set(sg * 0.2, 0.32, -0.25);
      horn.rotation.set(-1.05, 0, sg * 0.35);
      const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 1.2, 4), hornMat);
      wh.position.set(sg * 0.32, -0.1, 0.45);
      wh.rotation.set(1.2, 0, sg * 1.0);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2a10').multiplyScalar(2.5), toneMapped: false }));
      eye.position.set(sg * 0.24, 0.1, 0.25);
      this.head.add(horn, wh, eye);
    }
    this.head.visible = false;
    // the dragon's light lives in the root and is never hidden, only dimmed to 0: a light that appears or disappears
    // changes the scene's light count, which makes three.js recompile every material (a black flash while it does)
    this.glow = new THREE.PointLight('#ffc04a', 0, 14, 1.6);
    root.add(this.glow);
    root.add(this.head);
    this.dragon = { active: false, t: 0, origin: new THREE.Vector3(), target: new THREE.Vector3(), rise: 1.3, dive: 0.7, hist: [], histN: 0, impacted: false, dir: 1 };
    for (let i = 0; i < HIST; i++) this.dragon.hist.push(new THREE.Vector3());
    for (let i = 0; i < TS; i++) {
      this.pts.push(new THREE.Vector3());
      this.frameN.push(new THREE.Vector3());
    }
    // wrath aura: a slowly turning golden ring of flame at his feet
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
    this.aura = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), auraMat);
    this.aura.rotation.x = -Math.PI / 2;
    this.aura.visible = false;
    this.aura.renderOrder = 12;
    root.add(this.aura);
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

  get dragonActive() {
    return this.dragon.active;
  }

  /** 真龙降世: the dragon coils up round `origin` for `rise` s, then dives on `target` (which may be moved while it flies) */
  summonDragon(origin: THREE.Vector3, target: THREE.Vector3, rise: number, dive: number, onImpact: () => void) {
    const D = this.dragon;
    D.active = true;
    D.t = 0;
    D.origin.copy(origin);
    D.target.copy(target);
    D.rise = rise;
    D.dive = dive;
    D.onImpact = onImpact;
    D.impacted = false;
    D.dir = Math.random() < 0.5 ? 1 : -1;
    for (const h of D.hist) h.copy(origin);
    D.histN = 0;
    this.body.visible = this.fins.visible = this.claws.visible = this.head.visible = true;
  }
  /** keep the dive homing on the target until it commits */
  retarget(p: THREE.Vector3) {
    if (this.dragon.active && this.dragon.t < this.dragon.rise + this.dragon.dive * 0.35) this.dragon.target.copy(p);
  }
  get dragonTarget() {
    return this.dragon.target;
  }

  setAura(pos: THREE.Vector3 | null) {
    if (!pos) {
      this.auraOn = Math.max(0, this.auraOn - 0.05);
      if (this.auraOn <= 0) this.aura.visible = false;
      return;
    }
    this.auraOn = Math.min(1, this.auraOn + 0.05);
    this.aura.visible = true;
    this.aura.position.set(pos.x, pos.y + 0.05, pos.z);
  }

  private headAt(t: number, out: THREE.Vector3) {
    const D = this.dragon;
    if (t < D.rise) {
      // coiling up: two turns round him, widening and climbing
      const u = t / D.rise;
      const a = D.dir * u * Math.PI * 4;
      const r = 1.4 + u * 1.6;
      return out.set(D.origin.x + Math.cos(a) * r, D.origin.y + 0.6 + u * 5.4, D.origin.z + Math.sin(a) * r);
    }
    // diving: from the top of the coil, up and over, then straight down on the mark
    const u = Math.min(1, (t - D.rise) / D.dive);
    const a = D.dir * Math.PI * 4;
    const sx = D.origin.x + Math.cos(a) * 3;
    const sy = D.origin.y + 6;
    const sz = D.origin.z + Math.sin(a) * 3;
    const mx = (sx + D.target.x) / 2;
    const mz = (sz + D.target.z) / 2;
    const my = Math.max(sy, D.target.y) + 3.5;
    const e = u * u; // accelerating
    const i1 = 1 - e;
    return out.set(i1 * i1 * sx + 2 * i1 * e * mx + e * e * D.target.x, i1 * i1 * sy + 2 * i1 * e * my + e * e * (D.target.y + 0.3), i1 * i1 * sz + 2 * i1 * e * mz + e * e * D.target.z);
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
    // the dragon
    const D = this.dragon;
    if (D.active) {
      D.t += dt;
      const total = D.rise + D.dive;
      const hp = this.headAt(Math.min(D.t, total), this.v);
      // history: newest first
      const last = D.hist[D.hist.length - 1];
      for (let k = D.hist.length - 1; k > 0; k--) D.hist[k] = D.hist[k - 1];
      D.hist[0] = last.copy(hp);
      D.histN = Math.min(D.hist.length, D.histN + 1);
      const fade = D.t > total ? Math.max(0, 1 - (D.t - total) / 0.35) : Math.min(1, D.t / 0.2);
      // the body follows the head's trail: sample it evenly by distance, so the dragon keeps its length at any speed
      const LEN = 9;
      let acc = 0;
      let hi = 0;
      this.pts[0].copy(D.hist[0]);
      for (let k = 1; k < TS; k++) {
        const want = (k / (TS - 1)) * LEN;
        while (hi < D.histN - 1) {
          const seg = D.hist[hi].distanceTo(D.hist[hi + 1]);
          if (acc + seg >= want) {
            this.pts[k].lerpVectors(D.hist[hi], D.hist[hi + 1], seg > 1e-5 ? (want - acc) / seg : 0);
            break;
          }
          acc += seg;
          hi++;
        }
        if (hi >= D.histN - 1) this.pts[k].copy(D.hist[Math.max(0, D.histN - 1)]).y -= (want - acc) * 0.02; // early on: bunched at the start
      }
      const P = this.body.geometry.attributes.position as THREE.BufferAttribute;
      const Nn = this.body.geometry.attributes.normal as THREE.BufferAttribute;
      const up = new THREE.Vector3(0, 1, 0);
      const T = this.w;
      const Nv = new THREE.Vector3();
      const Bv = new THREE.Vector3();
      for (let i = 0; i < TS; i++) {
        const a0 = this.pts[Math.max(0, i - 1)];
        const a1 = this.pts[Math.min(TS - 1, i + 1)];
        T.copy(a0).sub(a1);
        if (T.lengthSq() < 1e-8) T.set(0, 0, 1);
        T.normalize();
        Nv.copy(up).addScaledVector(T, -up.dot(T));
        if (Nv.lengthSq() < 1e-4) Nv.set(1, 0, 0);
        Nv.normalize();
        Bv.crossVectors(T, Nv);
        this.frameN[i].copy(Nv);
        const u = i / (TS - 1);
        // thick behind the head, a slim neck, tapering to the tail; a slow breathing ripple
        const r = (0.14 + 0.46 * Math.sin(Math.min(1, u * 6 + 0.25) * Math.PI * 0.5) * (1 - u * 0.85)) * (1 + 0.06 * Math.sin(u * 20 - time * 9)) * fade;
        for (let j = 0; j < TR; j++) {
          const ang = (j / TR) * Math.PI * 2;
          const cx = Math.cos(ang);
          const cy = Math.sin(ang);
          const nx = Nv.x * cx + Bv.x * cy;
          const ny = Nv.y * cx + Bv.y * cy;
          const nz = Nv.z * cx + Bv.z * cy;
          const o = i * TR + j;
          P.setXYZ(o, this.pts[i].x + nx * r, this.pts[i].y + ny * r, this.pts[i].z + nz * r);
          Nn.setXYZ(o, nx, ny, nz);
        }
      }
      P.needsUpdate = true;
      Nn.needsUpdate = true;
      this.tubeMat.uniforms.uT.value = time;
      this.tubeMat.uniforms.uA.value = fade;
      // fins on the spine, claws under the forebody and the hindquarters
      for (let k = 0; k < FINS; k++) {
        const i = 3 + Math.floor((k / FINS) * (TS - 10));
        const u = i / (TS - 1);
        const r = 0.14 + 0.46 * (1 - u * 0.85);
        this.v.copy(this.pts[i]).addScaledVector(this.frameN[i], r * 0.8);
        this.q.setFromUnitVectors(up, this.frameN[i]);
        this.s.set(r * 0.5, r * (0.9 + 0.3 * Math.sin(time * 14 + k)) * fade, r * 0.5);
        this.fins.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
      }
      this.fins.instanceMatrix.needsUpdate = true;
      [12, 13, 34, 35].forEach((i, k) => {
        this.v.copy(this.pts[i]).addScaledVector(this.frameN[i], -0.3);
        this.q.setFromUnitVectors(up, this.frameN[i]);
        this.v.x += (k % 2 ? 0.25 : -0.25) * Math.cos(time * 8 + k);
        this.s.setScalar(fade);
        this.claws.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
      });
      this.claws.instanceMatrix.needsUpdate = true;
      // head looks along its path
      const h0 = D.hist[0];
      const h1 = D.hist[Math.min(D.histN - 1, 2)];
      this.head.position.copy(h0);
      this.w.copy(h0).sub(h1);
      if (this.w.lengthSq() > 1e-6) this.head.lookAt(this.v.copy(h0).add(this.w));
      this.head.scale.setScalar(2.1 * fade);
      this.glow.intensity = 30 * fade;
      this.glow.position.copy(this.head.position);
      if (this.embers && Math.random() < 0.9) this.embers(this.pts[Math.floor(Math.random() * TS)], 2, '#ffcf5a');
      if (!D.impacted && D.t >= total) {
        D.impacted = true;
        D.onImpact?.();
      }
      if (D.t > total + 0.35) {
        D.active = false;
        this.body.visible = this.fins.visible = this.claws.visible = this.head.visible = false;
        this.glow.intensity = 0;
      }
    }
    // aura
    const am = this.aura.material as THREE.ShaderMaterial;
    am.uniforms.uT.value = time;
    am.uniforms.uA.value = this.auraOn;
    this.aura.rotation.z = time * 0.6;
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
