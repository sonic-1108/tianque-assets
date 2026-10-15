import * as THREE from 'three';

// ==================================================================
// 真龙降世: one golden dragon. It coils up round the emperor, then dives on its mark.
// The body is a tube rebuilt each frame along the head's trail (scales, a darker spine, cream belly plates and a
// tail that burns away), wrapped in a soft golden halo; flame fins down the spine, four legs with claws; a head
// with a long snout, open jaws and fangs, brow ridges, antlers, a flame mane and beard, and two long whiskers
// that stream back and wave. Allocated once; EmperorFX keeps two so two emperors can summon at once.
// ==================================================================

const TS = 72; // rings along the body
const TR = 12; // sides round it
const LEN = 11; // body length, m
const HIST = 180; // frames of head trail
const FINS = 20;
const WS = 10; // whisker rings
const WR = 5;

const BODY_VS = /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal + vec3(0.0, 1e-4, 0.0)); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`;

const bodyMat = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    toneMapped: false,
    depthWrite: false, // out of the depth buffer, so ambient occlusion never darkens the screen round it
    side: THREE.FrontSide,
    uniforms: { uT: { value: 0 }, uA: { value: 1 } },
    vertexShader: BODY_VS,
    fragmentShader: /* glsl */ `uniform float uT; uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float along = vUv.x;            // 0 head .. 1 tail
        float round = vUv.y;            // 0 spine .. 0.5 belly .. 1 spine
        float belly = smoothstep(0.32, 0.42, round) * smoothstep(0.68, 0.58, round);
        float spine = 1.0 - smoothstep(0.0, 0.06, min(round, 1.0 - round));
        // scales: offset rows of rounded cells, darker at each rim
        vec2 g = vec2(along * 60.0, round * 12.0);
        g.y += step(1.0, mod(floor(g.x), 2.0)) * 0.5;
        vec2 f = fract(g) - vec2(0.2, 0.5);
        float cell = 1.0 - smoothstep(0.22, 0.5, length(f * vec2(1.0, 0.85)));
        // belly plates: broad cream bands
        float plate = smoothstep(0.0, 0.12, fract(along * 34.0)) * (1.0 - smoothstep(0.82, 1.0, fract(along * 34.0)));
        float fres = pow(max(0.0, 1.0 - abs(dot(vN, vV))), 2.2);
        float run = 0.5 + 0.5 * sin(along * 26.0 - uT * 12.0);
        vec3 gold = mix(vec3(1.0, 0.74, 0.22), vec3(1.0, 0.42, 0.08), along * 0.85);
        vec3 c = gold * (0.45 + 0.65 * cell);
        c = mix(c, vec3(1.0, 0.93, 0.72) * (0.65 + 0.35 * plate), belly);
        c = mix(c, vec3(0.85, 0.22, 0.05), spine * 0.7);
        c += vec3(1.0, 0.88, 0.55) * fres * 1.2 + gold * run * 0.18;
        // the tail burns away into flame
        float burn = smoothstep(0.8, 1.0, along) * (0.55 + 0.45 * sin(round * 40.0 + uT * 22.0));
        gl_FragColor = vec4(c * 1.2, uA * (1.0 - burn)); }`,
  });

const haloMat = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    uniforms: { uA: { value: 1 } },
    vertexShader: BODY_VS,
    fragmentShader: /* glsl */ `uniform float uA; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float fres = pow(min(1.0, abs(dot(vN, vV))), 1.5);
        float tail = 1.0 - smoothstep(0.7, 1.0, vUv.x);
        gl_FragColor = vec4(vec3(1.0, 0.7, 0.25) * fres * 0.9, fres * 0.6 * tail * uA); }`,
  });

/** a tube's static parts: index and uv for `rings` x `sides` */
function tubeGeometry(rings: number, sides: number) {
  const g = new THREE.BufferGeometry();
  const nrm = new Float32Array(rings * sides * 3);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; // never a zero normal
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rings * sides * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < sides; j++) {
      uv.push(i / (rings - 1), j / sides);
      if (i < rings - 1) {
        const a0 = i * sides + j;
        const a1 = i * sides + ((j + 1) % sides);
        idx.push(a0, a0 + sides, a1, a1, a0 + sides, a1 + sides);
      }
    }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

export class DragonFX {
  active = false;
  private t = 0;
  private rise = 1.15;
  private dive = 0.8;
  private dir = 1;
  private origin = new THREE.Vector3();
  target = new THREE.Vector3();
  private onImpact?: () => void;
  private impacted = false;
  private hist: THREE.Vector3[] = [];
  private histN = 0;
  private pts: THREE.Vector3[] = [];
  private nrm: THREE.Vector3[] = [];
  private bin: THREE.Vector3[] = [];
  private body: THREE.Mesh;
  private halo: THREE.Mesh;
  private bMat: THREE.ShaderMaterial;
  private hMat: THREE.ShaderMaterial;
  private fins: THREE.InstancedMesh;
  private legs: THREE.InstancedMesh;
  private head = new THREE.Group();
  private jaw = new THREE.Group();
  private whiskers: THREE.Mesh[] = [];
  private light: THREE.PointLight;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  /** set by the owner: sparks and cloud puffs along the body */
  embers?: (p: THREE.Vector3, n: number, color: THREE.ColorRepresentation) => void;
  clouds?: (p: THREE.Vector3) => void;

  constructor(root: THREE.Object3D) {
    for (let i = 0; i < HIST; i++) this.hist.push(new THREE.Vector3());
    for (let i = 0; i < TS; i++) {
      this.pts.push(new THREE.Vector3());
      this.nrm.push(new THREE.Vector3(0, 1, 0));
      this.bin.push(new THREE.Vector3(1, 0, 0));
    }
    this.bMat = bodyMat();
    this.hMat = haloMat();
    this.body = new THREE.Mesh(tubeGeometry(TS, TR), this.bMat);
    this.halo = new THREE.Mesh(tubeGeometry(TS, TR), this.hMat);
    for (const o of [this.body, this.halo]) {
      o.frustumCulled = false;
      o.visible = false;
    }
    this.halo.renderOrder = 14;
    // flame fins down the spine
    const fin = new THREE.ConeGeometry(0.5, 1.4, 4);
    fin.translate(0, 0.7, 0);
    this.fins = new THREE.InstancedMesh(fin, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a12').multiplyScalar(1.5), toneMapped: false, transparent: true, opacity: 0.9 }), FINS);
    // a leg: thigh, shin and three claws, pointing down its local -Y
    const gold = new THREE.MeshStandardMaterial({ color: '#ffc84a', emissive: '#ff9a20', emissiveIntensity: 0.8, metalness: 0.55, roughness: 0.35 });
    const legParts: THREE.BufferGeometry[] = [];
    const thigh = new THREE.CylinderGeometry(0.09, 0.06, 0.42, 7);
    thigh.translate(0, -0.21, 0);
    const shin = new THREE.CylinderGeometry(0.06, 0.05, 0.36, 7);
    shin.rotateX(0.7);
    shin.translate(0, -0.52, 0.12);
    legParts.push(thigh, shin);
    for (let k = -1; k <= 1; k++) {
      const cl = new THREE.ConeGeometry(0.03, 0.2, 5);
      cl.rotateX(Math.PI / 2 + 0.5);
      cl.translate(k * 0.06, -0.7, 0.3);
      legParts.push(cl);
    }
    this.legs = new THREE.InstancedMesh(mergeNI(legParts), gold, 4);
    for (const o of [this.fins, this.legs]) {
      o.frustumCulled = false;
      o.visible = false;
    }
    this.buildHead(gold);
    // the light stays in the scene at 0 when unused: a light appearing would recompile every material
    this.light = new THREE.PointLight('#ffc04a', 0, 14, 1.6);
    root.add(this.body, this.halo, this.fins, this.legs, this.head, this.light);
  }

  private buildHead(gold: THREE.MeshStandardMaterial) {
    const H = this.head;
    // head faces +Z
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), gold);
    skull.scale.set(1, 0.85, 1.15);
    const snoutG = new THREE.CylinderGeometry(0.16, 0.26, 0.62, 12);
    snoutG.rotateX(Math.PI / 2);
    const snout = new THREE.Mesh(snoutG, gold);
    snout.position.set(0, 0.0, 0.48);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), gold);
    nose.scale.set(1.25, 0.8, 0.8);
    nose.position.set(0, 0.06, 0.8);
    const dark = new THREE.MeshBasicMaterial({ color: '#4a1204' });
    for (const sg of [-1, 1]) {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), dark);
      nostril.position.set(sg * 0.07, 0.1, 0.9);
      H.add(nostril);
      // brow ridge over a burning eye
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.26), gold);
      brow.position.set(sg * 0.17, 0.2, 0.16);
      brow.rotation.set(-0.25, 0, sg * -0.35);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a10').multiplyScalar(2.6), toneMapped: false }));
      eye.position.set(sg * 0.2, 0.12, 0.2);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: '#1a0500' }));
      pupil.position.set(sg * 0.235, 0.12, 0.26);
      // antlers: a long sweeping beam and a tine
      const hornMat = new THREE.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffcf7a', emissiveIntensity: 0.55, roughness: 0.4 });
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.85, 7), hornMat);
      beam.position.set(sg * 0.17, 0.42, -0.2);
      beam.rotation.set(-1.15, 0, sg * -0.35);
      const tine = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.32, 6), hornMat);
      tine.position.set(sg * 0.22, 0.56, -0.08);
      tine.rotation.set(-0.3, 0, sg * -0.6);
      // fangs
      const fangMat = new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff0d0', emissiveIntensity: 0.4 });
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 5), fangMat);
      fang.rotation.x = Math.PI;
      fang.position.set(sg * 0.13, -0.16, 0.66);
      H.add(brow, eye, pupil, beam, tine, fang);
      // whiskers: tubes rebuilt every frame, streaming back from the snout
      const wg = tubeGeometry(WS, WR);
      const wm = new THREE.Mesh(wg, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9a8').multiplyScalar(1.4), toneMapped: false }));
      wm.frustumCulled = false;
      wm.userData.side = sg;
      this.whiskers.push(wm);
      H.add(wm);
    }
    // lower jaw, hinged open, with its own fangs and a fiery tongue
    const jawG = new THREE.BoxGeometry(0.3, 0.08, 0.6);
    jawG.translate(0, 0, 0.3);
    this.jaw.add(new THREE.Mesh(jawG, gold));
    const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff3a10').multiplyScalar(1.5), toneMapped: false }));
    tongue.position.set(0, 0.06, 0.4);
    this.jaw.add(tongue);
    this.jaw.position.set(0, -0.16, 0.12);
    this.jaw.rotation.x = 0.45;
    // a flame mane round the back of the skull and a beard under the jaw
    const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a1a').multiplyScalar(1.6), toneMapped: false, transparent: true, opacity: 0.92 });
    for (let k = 0; k < 9; k++) {
      const a = (k / 8 - 0.5) * 3.0;
      const mane = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7, 4), flame);
      mane.position.set(Math.sin(a) * 0.3, 0.05 + Math.cos(a) * 0.25, -0.35);
      mane.rotation.set(-1.95, 0, -a * 0.55);
      H.add(mane);
    }
    for (let k = 0; k < 3; k++) {
      const beard = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.45, 4), flame);
      beard.position.set((k - 1) * 0.08, -0.25, 0.3);
      beard.rotation.set(2.6, 0, (k - 1) * 0.2);
      this.jaw.add(beard);
    }
    H.add(skull, snout, nose, this.jaw);
    H.visible = false;
  }

  start(origin: THREE.Vector3, target: THREE.Vector3, rise: number, dive: number, onImpact: () => void, fwdYaw?: number) {
    this.active = true;
    this.t = 0;
    this.origin.copy(origin);
    // it rises in front of him, not round him: the camera sits behind the caster and the body must never sweep through it
    if (fwdYaw !== undefined) this.origin.add(new THREE.Vector3(Math.sin(fwdYaw) * 4, 0, Math.cos(fwdYaw) * 4));
    this.target.copy(target);
    this.rise = rise;
    this.dive = dive;
    this.onImpact = onImpact;
    this.impacted = false;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    for (const h of this.hist) h.copy(origin);
    this.histN = 0;
    this.setVisible(true);
  }
  retarget(p: THREE.Vector3) {
    if (this.active && this.t < this.rise + this.dive * 0.35) this.target.copy(p);
  }
  private setVisible(on: boolean) {
    this.body.visible = this.halo.visible = this.fins.visible = this.legs.visible = this.head.visible = on;
  }

  private headAt(t: number, out: THREE.Vector3) {
    if (t < this.rise) {
      // coiling up: two turns round him, widening and climbing
      const u = t / this.rise;
      const a = this.dir * u * Math.PI * 4;
      const r = 1.6 + u * 1.8;
      return out.set(this.origin.x + Math.cos(a) * r, this.origin.y + 0.7 + u * 6, this.origin.z + Math.sin(a) * r);
    }
    // diving: from the top of the coil, up and over, then down on the mark, faster and faster
    const u = Math.min(1, (t - this.rise) / this.dive);
    const a = this.dir * Math.PI * 4;
    const sx = this.origin.x + Math.cos(a) * 3.4;
    const sy = this.origin.y + 6.7;
    const sz = this.origin.z + Math.sin(a) * 3.4;
    const mx = (sx + this.target.x) / 2;
    const mz = (sz + this.target.z) / 2;
    const my = Math.max(sy, this.target.y) + 3.5;
    const e = u * u;
    const i1 = 1 - e;
    return out.set(i1 * i1 * sx + 2 * i1 * e * mx + e * e * this.target.x, i1 * i1 * sy + 2 * i1 * e * my + e * e * (this.target.y + 0.4), i1 * i1 * sz + 2 * i1 * e * mz + e * e * this.target.z);
  }

  update(dt: number, time: number) {
    if (!this.active) return;
    this.t += dt;
    const total = this.rise + this.dive;
    const hp = this.headAt(Math.min(this.t, total), this.v);
    const last = this.hist[HIST - 1];
    for (let k = HIST - 1; k > 0; k--) this.hist[k] = this.hist[k - 1];
    this.hist[0] = last.copy(hp);
    this.histN = Math.min(HIST, this.histN + 1);
    const fade = this.t > total ? Math.max(0, 1 - (this.t - total) / 0.35) : Math.min(1, this.t / 0.2);
    // the body follows the head's trail, sampled evenly by distance so it keeps its length at any speed
    let acc = 0;
    let hi = 0;
    this.pts[0].copy(this.hist[0]);
    for (let k = 1; k < TS; k++) {
      const want = (k / (TS - 1)) * LEN;
      let placed = false;
      while (hi < this.histN - 1) {
        const seg = this.hist[hi].distanceTo(this.hist[hi + 1]);
        if (acc + seg >= want) {
          this.pts[k].lerpVectors(this.hist[hi], this.hist[hi + 1], seg > 1e-5 ? (want - acc) / seg : 0);
          placed = true;
          break;
        }
        acc += seg;
        hi++;
      }
      if (!placed) this.pts[k].copy(this.pts[k - 1]); // early on the trail is short: the tail is still coming out
    }
    // frames along the body: N points up-ish (the spine), B to the side
    const T = this.w;
    for (let i = 0; i < TS; i++) {
      T.copy(this.pts[Math.max(0, i - 1)]).sub(this.pts[Math.min(TS - 1, i + 1)]);
      if (T.lengthSq() < 1e-8) T.set(0, 0, 1);
      T.normalize();
      const Nv = this.nrm[i].copy(UP).addScaledVector(T, -UP.dot(T));
      if (Nv.lengthSq() < 1e-4) Nv.set(1, 0, 0);
      Nv.normalize();
      this.bin[i].crossVectors(T, Nv);
    }
    const radius = (u: number) => (0.16 + 0.5 * Math.sin(Math.min(1, u * 5 + 0.3) * Math.PI * 0.5) * (1 - u * 0.86)) * (1 + 0.05 * Math.sin(u * 22 - time * 9)) * fade;
    const fill = (mesh: THREE.Mesh, scale: number) => {
      const P = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const Nn = mesh.geometry.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < TS; i++) {
        const r = radius(i / (TS - 1)) * scale;
        const Nv = this.nrm[i];
        const Bv = this.bin[i];
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
    };
    fill(this.body, 1);
    fill(this.halo, 1.6);
    this.bMat.uniforms.uT.value = time;
    this.bMat.uniforms.uA.value = fade;
    this.hMat.uniforms.uA.value = fade;
    // fins on the spine, flickering
    for (let k = 0; k < FINS; k++) {
      const i = 4 + Math.floor((k / FINS) * (TS - 14));
      const r = radius(i / (TS - 1));
      this.v.copy(this.pts[i]).addScaledVector(this.nrm[i], r * 0.8);
      this.q.setFromUnitVectors(UP, this.nrm[i]);
      this.s.set(r * 0.45, r * (0.8 + 0.35 * Math.sin(time * 16 + k * 1.3)), r * 0.45);
      this.fins.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
    }
    this.fins.instanceMatrix.needsUpdate = true;
    // four legs under the fore and hind body, pawing at the air
    [14, 14, 44, 44].forEach((i, k) => {
      const sg = k % 2 ? 1 : -1;
      const r = radius(i / (TS - 1));
      this.v.copy(this.pts[i]).addScaledVector(this.nrm[i], -r * 0.5).addScaledVector(this.bin[i], sg * r * 0.85);
      this.w.copy(this.nrm[i]).multiplyScalar(-1).addScaledVector(this.bin[i], sg * 0.5).normalize();
      this.q.setFromUnitVectors(UP.clone().negate(), this.w);
      this.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.6 * Math.sin(time * 9 + k * 1.7)));
      this.s.setScalar(fade * 1.3);
      this.legs.setMatrixAt(k, this.m.compose(this.v, this.q, this.s));
    });
    this.legs.instanceMatrix.needsUpdate = true;
    // head along its path, jaws working
    const h0 = this.hist[0];
    const h1 = this.hist[Math.min(this.histN - 1, 2)];
    this.head.position.copy(h0);
    this.w.copy(h0).sub(h1);
    if (this.w.lengthSq() > 1e-6) this.head.lookAt(this.v.copy(h0).add(this.w));
    this.head.scale.setScalar(1.9 * Math.max(0.001, fade));
    this.jaw.rotation.x = 0.35 + 0.2 * Math.sin(time * 7);
    // whiskers in the head's own space: out from the snout, streaming back, waving
    for (const wm of this.whiskers) {
      const sg = wm.userData.side as number;
      const P = wm.geometry.attributes.position as THREE.BufferAttribute;
      const Nn = wm.geometry.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < WS; i++) {
        const u = i / (WS - 1);
        const cx = sg * (0.18 + u * 0.55 + 0.08 * Math.sin(time * 7 + u * 5));
        const cy = -0.02 - u * 0.25 + 0.12 * Math.sin(time * 5 + u * 6 + sg);
        const cz = 0.75 - u * 1.6;
        const r = 0.022 * (1 - u * 0.8);
        for (let j = 0; j < WR; j++) {
          const a = (j / WR) * Math.PI * 2;
          const nx = Math.cos(a);
          const ny = Math.sin(a);
          P.setXYZ(i * WR + j, cx + nx * r, cy + ny * r, cz);
          Nn.setXYZ(i * WR + j, nx, ny, 0);
        }
      }
      P.needsUpdate = true;
      Nn.needsUpdate = true;
    }
    this.light.position.copy(h0);
    this.light.intensity = 32 * fade;
    if (this.embers && Math.random() < 0.9) this.embers(this.pts[Math.floor(Math.random() * TS)], 2, '#ffcf5a');
    if (this.clouds && Math.random() < 0.35) this.clouds(this.pts[Math.floor(TS * 0.4 + Math.random() * TS * 0.6)]);
    if (!this.impacted && this.t >= total) {
      this.impacted = true;
      this.onImpact?.();
    }
    if (this.t > total + 0.35) {
      this.active = false;
      this.setVisible(false);
      this.light.intensity = 0;
    }
  }
}

/** merge geometries (position + normal), indexed or not */
function mergeNI(gs: THREE.BufferGeometry[]) {
  const flat = gs.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of flat) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of flat) {
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
