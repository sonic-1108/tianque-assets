import { MonkFX } from './MonkFX';
import * as THREE from 'three';

/**
 * 天阙 VFX System
 * Imperative, pooled effects. Nothing here touches React state, so effects
 * never trigger re-renders. Every effect is layered (core flash + glow +
 * sparks + dust + decal + light) and sized relative to a 1.8m character.
 */

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const origin = new THREE.Vector3();

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

const NOISE_GLSL = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), u.x),
               mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), u.x), u.y);
  }
  float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
`;

// ------------------------------------------------------------------
// Point particles (sparks / embers use additive, dust / smoke normal)
// ------------------------------------------------------------------
class PointPool {
  points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private grow: Float32Array;
  private cursor = 0;
  active = 0;

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.grow = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexColors: true,
      uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 2.2 : 1.4 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main(){
          vColor = color; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha; uniform float uSoft;
        void main(){
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = pow(clamp(1.0 - d, 0.0, 1.0), uSoft) * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 15;
  }

  emit(
    p: THREE.Vector3,
    v: THREE.Vector3,
    color: THREE.ColorRepresentation,
    size: number,
    life: number,
    opts: { drag?: number; gravity?: number; grow?: number } = {}
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    tmpC.set(color);
    this.col[i * 3] = tmpC.r;
    this.col[i * 3 + 1] = tmpC.g;
    this.col[i * 3 + 2] = tmpC.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.baseSize[i] = size;
    this.drag[i] = opts.drag ?? 3.0;
    this.grav[i] = opts.gravity ?? 9.0;
    this.grow[i] = opts.grow ?? 0;
  }

  update(dt: number) {
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]); // 1 -> 0
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
      }
      const g = this.grow[i];
      this.size[i] = this.baseSize[i] * (g > 0 ? 1 + (1 - t) * g : 0.35 + 0.65 * t);
      this.alpha[i] = g > 0 ? t * t : Math.min(1, t * 1.6);
      active++;
    }
    this.active = active;
    const geo = this.points.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  setScale(px: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = px;
  }
}

// ------------------------------------------------------------------
// Ground shockwave / glow disc (soft ring drawn in a shader)
// ------------------------------------------------------------------
const ringMaterialTemplate = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: {
    uColor: { value: new THREE.Color('#ff6a2a') },
    uProgress: { value: 0 },
    uOpacity: { value: 1 },
    uWidth: { value: 0.12 },
    uFill: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv; uniform vec3 uColor; uniform float uProgress; uniform float uOpacity; uniform float uWidth; uniform float uFill; uniform float uTime;
    ${NOISE_GLSL}
    void main(){
      vec2 c = vUv - 0.5; float r = length(c) * 2.0; float ang = atan(c.y, c.x);
      float edge = uProgress;
      float ring = smoothstep(edge - uWidth, edge, r) * (1.0 - smoothstep(edge, edge + uWidth * 0.35, r));
      float streak = 0.55 + 0.45 * fbm(vec2(ang * 3.0, r * 4.0 - uTime * 2.0));
      float fill = uFill * (1.0 - smoothstep(0.0, edge, r)) * 0.35;
      float a = (ring * streak + fill) * uOpacity;
      if (a < 0.003) discard;
      vec3 col = mix(uColor, vec3(1.0, 0.95, 0.85), ring * 0.55);
      gl_FragColor = vec4(col, a);
    }`,
});

interface RingFx {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  life: number;
  maxLife: number;
  radius: number;
  active: boolean;
}

// ------------------------------------------------------------------
// Crater / scorch decal (canvas texture, generated once)
// ------------------------------------------------------------------
function makeCrackTextures() {
  const S = 512;
  const scorch = document.createElement('canvas');
  scorch.width = scorch.height = S;
  const g = scorch.getContext('2d')!;
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(10,6,4,0.95)');
  grd.addColorStop(0.45, 'rgba(20,10,6,0.75)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);

  const glow = document.createElement('canvas');
  glow.width = glow.height = S;
  const h = glow.getContext('2d')!;
  h.lineCap = 'round';
  const drawCracks = (ctx: CanvasRenderingContext2D, color: string, width: number, seed: number) => {
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    ctx.strokeStyle = color;
    for (let k = 0; k < 11; k++) {
      let ang = (k / 11) * Math.PI * 2 + rnd() * 0.4;
      let x = S / 2, y = S / 2;
      let w = width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const steps = 7 + Math.floor(rnd() * 5);
      for (let j = 0; j < steps; j++) {
        ang += (rnd() - 0.5) * 0.9;
        const len = 16 + rnd() * 22;
        x += Math.cos(ang) * len;
        y += Math.sin(ang) * len;
        ctx.lineWidth = w;
        ctx.lineTo(x, y);
        w *= 0.82;
      }
      ctx.stroke();
    }
  };
  h.shadowColor = '#ff6a00';
  h.shadowBlur = 18;
  drawCracks(h, '#ffb347', 7, 7);
  drawCracks(g, 'rgba(0,0,0,0.9)', 9, 7);
  const t1 = new THREE.CanvasTexture(scorch);
  const t2 = new THREE.CanvasTexture(glow);
  t1.colorSpace = THREE.SRGBColorSpace;
  t2.colorSpace = THREE.SRGBColorSpace;
  return { scorch: t1, glow: t2 };
}

interface DecalFx {
  group: THREE.Group;
  scorchMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  life: number;
  maxLife: number;
  active: boolean;
}

// ------------------------------------------------------------------
// Rock debris (instanced, lit)
// ------------------------------------------------------------------
class DebrisPool {
  mesh: THREE.InstancedMesh;
  private max: number;
  private pos: THREE.Vector3[] = [];
  private vel: THREE.Vector3[] = [];
  private rot: THREE.Euler[] = [];
  private spin: THREE.Vector3[] = [];
  private scale: number[] = [];
  private life: number[] = [];
  private cursor = 0;
  active = 0;

  constructor(max: number) {
    this.max = max;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: '#5b524c', roughness: 0.95, metalness: 0.05, emissive: '#3a1405', emissiveIntensity: 0.6 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < max; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.rot.push(new THREE.Euler());
      this.spin.push(new THREE.Vector3());
      this.scale.push(0);
      this.life.push(0);
      this.mesh.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
    }
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, size: number, life = 1.4) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i].copy(p);
    this.vel[i].copy(v);
    this.rot[i].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    this.spin[i].set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    this.scale[i] = size;
    this.life[i] = life;
  }

  update(dt: number) {
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const v = this.vel[i];
      v.y -= 22 * dt;
      this.pos[i].addScaledVector(v, dt);
      if (this.pos[i].y < this.scale[i] * 0.6) {
        this.pos[i].y = this.scale[i] * 0.6;
        v.y *= -0.35;
        v.x *= 0.6;
        v.z *= 0.6;
        this.spin[i].multiplyScalar(0.6);
      }
      this.rot[i].x += this.spin[i].x * dt;
      this.rot[i].y += this.spin[i].y * dt;
      this.rot[i].z += this.spin[i].z * dt;
      const s = this.life[i] > 0 ? this.scale[i] * Math.min(1, this.life[i] * 2.5) : 0;
      tmpQ.setFromEuler(this.rot[i]);
      tmpS.set(s, s * 0.7, s);
      tmpM.compose(this.pos[i], tmpQ, tmpS);
      this.mesh.setMatrixAt(i, tmpM);
      active++;
    }
    this.active = active;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------------
// Weapon ribbon trail (sampled from blade base & tip each frame)
// ------------------------------------------------------------------
export class RibbonTrail {
  mesh: THREE.Mesh;
  private samples: { base: THREE.Vector3; tip: THREE.Vector3; age: number }[] = [];
  private maxSamples: number;
  private lifetime: number;
  private positions: Float32Array;
  private ages: Float32Array;
  private sides: Float32Array;
  private mat: THREE.ShaderMaterial;
  emitting = false;

  constructor(color: THREE.ColorRepresentation, maxSamples = 26, lifetime = 0.2) {
    this.maxSamples = maxSamples;
    this.lifetime = lifetime;
    const n = maxSamples * 2;
    this.positions = new Float32Array(n * 3);
    this.ages = new Float32Array(n);
    this.sides = new Float32Array(n);
    for (let i = 0; i < maxSamples; i++) {
      this.sides[i * 2] = 0;
      this.sides[i * 2 + 1] = 1;
    }
    const idx: number[] = [];
    for (let i = 0; i < maxSamples - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAge', new THREE.BufferAttribute(this.ages, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(this.sides, 1));
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uBoost: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aAge; attribute float aSide; varying float vAge; varying float vSide;
        void main(){ vAge = aAge; vSide = aSide; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        varying float vAge; varying float vSide; uniform vec3 uColor; uniform float uTime; uniform float uBoost;
        ${NOISE_GLSL}
        void main(){
          float fade = clamp(1.0 - vAge, 0.0, 1.0);
          float edge = smoothstep(0.0, 0.35, vSide);           // fade toward the blade root
          float core = smoothstep(0.55, 1.0, vSide);            // hot edge near the tip
          float wisp = 0.65 + 0.35 * noise(vec2(vAge * 9.0 - uTime * 3.0, vSide * 6.0));
          float a = fade * fade * edge * wisp * 0.95;
          vec3 col = mix(uColor, vec3(1.0, 0.97, 0.9), core * fade);
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * uBoost, a);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 25;
  }

  setColor(c: THREE.ColorRepresentation, boost = 1) {
    (this.mat.uniforms.uColor.value as THREE.Color).set(c);
    this.mat.uniforms.uBoost.value = boost;
  }

  update(dt: number, base: THREE.Vector3 | null, tip: THREE.Vector3 | null, time: number) {
    this.mat.uniforms.uTime.value = time;
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[this.samples.length - 1].age > this.lifetime) this.samples.pop();

    if (this.emitting && base && tip) {
      const last = this.samples[0];
      // Insert sub-samples so fast swings stay smooth
      if (last && last.tip.distanceTo(tip) > 0.18) {
        const steps = Math.min(4, Math.floor(last.tip.distanceTo(tip) / 0.18));
        for (let k = 1; k <= steps; k++) {
          const f = k / (steps + 1);
          this.samples.unshift({
            base: new THREE.Vector3().lerpVectors(last.base, base, f),
            tip: new THREE.Vector3().lerpVectors(last.tip, tip, f),
            age: dt * (1 - f),
          });
        }
      }
      this.samples.unshift({ base: base.clone(), tip: tip.clone(), age: 0 });
      if (this.samples.length > this.maxSamples) this.samples.length = this.maxSamples;
    }

    const n = this.samples.length;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      this.positions.set([s.base.x, s.base.y, s.base.z], i * 6);
      this.positions.set([s.tip.x, s.tip.y, s.tip.z], i * 6 + 3);
      const a = s.age / this.lifetime;
      this.ages[i * 2] = a;
      this.ages[i * 2 + 1] = a;
    }
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAge as THREE.BufferAttribute).needsUpdate = true;
  }

  get count() {
    return this.samples.length;
  }
}

// ------------------------------------------------------------------
// Whirlwind vortex (noise flow shader on open cylinders)
// ------------------------------------------------------------------
function makeVortex() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#ff3b1f') } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime; uniform float uOpacity; uniform vec3 uColor;
      ${NOISE_GLSL}
      void main(){
        float flow = fbm(vec2(vUv.x * 10.0 - uTime * 7.0, vUv.y * 2.5 + uTime * 0.6));
        float streak = smoothstep(0.45, 0.85, flow);
        float vfade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
        float a = streak * vfade * uOpacity;
        if (a < 0.004) discard;
        vec3 col = mix(uColor, vec3(1.0, 0.85, 0.6), streak * 0.6);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const group = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.2, 1.8, 48, 1, true), mat);
  outer.position.y = 0.95;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.9, 1.3, 48, 1, true), mat);
  inner.position.y = 0.9;
  inner.rotation.y = 1.3;
  group.add(outer, inner);
  group.visible = false;
  return { group, mat, outer, inner };
}

// ------------------------------------------------------------------
// Vertical light pillar (blood rage roar / ultimate)
// ------------------------------------------------------------------
function makePillar() {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#ff2a1a') } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv; uniform float uTime; uniform float uOpacity; uniform vec3 uColor;
      ${NOISE_GLSL}
      void main(){
        float n = fbm(vec2(vUv.x * 8.0, vUv.y * 3.0 - uTime * 4.0));
        float vfade = pow(max(1.0 - vUv.y, 0.0), 1.6) * smoothstep(0.0, 0.05, vUv.y);
        float a = (0.35 + 0.65 * n) * vfade * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.9, 0.7), n * 0.4), a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 5, 32, 1, true), mat);
  mesh.position.y = 2.5;
  const group = new THREE.Group();
  group.add(mesh);
  group.visible = false;
  return { group, mat };
}

// ------------------------------------------------------------------
// Floating damage numbers (canvas sprites, pooled)
// ------------------------------------------------------------------
interface DmgFx {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  life: number;
  maxLife: number;
  vel: THREE.Vector3;
  baseScale: number;
  active: boolean;
}

interface FlashLight {
  light: THREE.PointLight;
  life: number;
  maxLife: number;
  peak: number;
}

function makeStreakTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.5, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(0, 32);
  g.quadraticCurveTo(128, 18, 256, 32);
  g.quadraticCurveTo(128, 40, 0, 32);
  g.fill();
  const v = g.createRadialGradient(128, 32, 0, 128, 32, 120);
  v.addColorStop(0, 'rgba(255,255,255,0.5)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface MarkFx {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  scale: number;
  active: boolean;
}

interface MeteorFx {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arc: number;
  active: boolean;
  onImpact?: () => void;
}

export class VFXSystem {
  root = new THREE.Group();
  private meteors: MeteorFx[] = [];
  private projPools: Record<string, THREE.Object3D[]> = {};
  private marks: MarkFx[] = [];
  private timers: { t: number; fn: () => void }[] = [];
  private sparks = new PointPool(900, true);
  private dust = new PointPool(400, false);
  private debris = new DebrisPool(90);
  private rings: RingFx[] = [];
  private decals: DecalFx[] = [];
  private dmg: DmgFx[] = [];
  private lights: FlashLight[] = [];
  private crackTex = makeCrackTextures();
  // one whirlwind + one rage pillar per fighter slot (0 = player, 1 = opponent)
  private slots = [0, 1, 2, 3].map(() => ({ vortex: makeVortex(), pillar: makePillar(), vLife: 0, vMax: 0, pLife: 0, pMax: 0 }));
  private time = 0;
  trails: RibbonTrail[] = [];

  monk!: MonkFX;
  /** 锁链钩: up to two chains in flight, each a run of iron links ending in a hook */
  private chains = [0, 1, 2, 3].map(() => {
    const LINKS = 70;
    const link = new THREE.TorusGeometry(0.055, 0.016, 6, 10);
    const iron = new THREE.MeshStandardMaterial({ color: '#9aa1aa', metalness: 0.85, roughness: 0.35, emissive: '#1b2430', emissiveIntensity: 0.6 });
    const links = new THREE.InstancedMesh(link, iron, LINKS);
    links.frustumCulled = false;
    links.count = 0;
    const hook = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.32, 8), iron);
    hook.visible = false;
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    hook.add(glow);
    return { links, hook, from: new THREE.Vector3(), to: new THREE.Vector3(), life: 0, max: 1, LINKS };
  });

  constructor() {
    this.root.name = 'VFXSystem';
    this.monk = new MonkFX(this.root);
    this.root.add(this.sparks.points, this.dust.points, this.debris.mesh);
    for (const ch of this.chains) this.root.add(ch.links, ch.hook);
    for (const sl of this.slots) this.root.add(sl.vortex.group, sl.pillar.group);

    const plane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 14; i++) {
      const mat = ringMaterialTemplate.clone();
      const mesh = new THREE.Mesh(plane, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 12;
      this.root.add(mesh);
      this.rings.push({ mesh, mat, life: 0, maxLife: 1, radius: 1, active: false });
    }

    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group();
      const scorchMat = new THREE.MeshBasicMaterial({ map: this.crackTex.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const glowMat = new THREE.MeshBasicMaterial({ map: this.crackTex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
      const a = new THREE.Mesh(plane, scorchMat);
      const b = new THREE.Mesh(plane, glowMat);
      a.rotation.x = b.rotation.x = -Math.PI / 2;
      a.position.y = 0.012;
      b.position.y = 0.014;
      a.renderOrder = 5;
      b.renderOrder = 6;
      group.add(a, b);
      group.visible = false;
      this.root.add(group);
      this.decals.push({ group, scorchMat, glowMat, life: 0, maxLife: 1, active: false });
    }

    for (let i = 0; i < 16; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 96;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 40;
      this.root.add(sprite);
      this.dmg.push({ sprite, canvas, tex, life: 0, maxLife: 1, vel: new THREE.Vector3(), baseScale: 1, active: false });
    }

    const meteorGeo = new THREE.IcosahedronGeometry(0.55, 1);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(meteorGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.2, 0.25), toneMapped: false }));
      mesh.visible = false;
      this.root.add(mesh);
      this.meteors.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, arc: 0, active: false });
    }

    // ---- projectile meshes (暗器) ----
    // Ancient forged iron: 脱手镖 with a diamond-section blade, bronze collar, iron ring and red silk tassel.
    const iron = new THREE.MeshStandardMaterial({ color: '#9aa1aa', metalness: 0.85, roughness: 0.32 });
    const bronze = new THREE.MeshStandardMaterial({ color: '#8c6a3c', metalness: 0.85, roughness: 0.38 });
    const wrap = new THREE.MeshStandardMaterial({ color: '#2b2622', metalness: 0.1, roughness: 0.9 });
    const tailTex = (() => {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 128;
      const g = c.getContext('2d')!;
      const grd = g.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 16, 128);
      return new THREE.CanvasTexture(c);
    })();
    // 柳叶镖 blade: leaf outline extruded with a deep bevel, which gives a lens cross-section
    // (thick spine, knife-sharp edges) that catches a bright rim of light
    const leaf = new THREE.Shape();
    leaf.moveTo(0, 0.3); // tip
    leaf.bezierCurveTo(0.024, 0.22, 0.05, 0.1, 0.04, 0.0);
    leaf.bezierCurveTo(0.034, -0.04, 0.018, -0.055, 0.013, -0.06);
    leaf.lineTo(-0.014, -0.06);
    leaf.bezierCurveTo(-0.018, -0.055, -0.034, -0.04, -0.04, 0.0);
    leaf.bezierCurveTo(-0.05, 0.1, -0.024, 0.22, 0, 0.3);
    const bladeGeo = new THREE.ExtrudeGeometry(leaf, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.011, bevelSize: 0.012, bevelOffset: -0.012, bevelSegments: 3, curveSegments: 18 });
    bladeGeo.translate(0, 0, -0.001);
    bladeGeo.rotateX(-Math.PI / 2); // shape +Y (tip) -> -Z
    bladeGeo.computeVertexNormals();
    // blood groove down the middle of each face
    const grooveGeo = new THREE.BoxGeometry(0.006, 0.0025, 0.2);
    // collar + cord-wrapped grip + pommel ring
    const collarGeo = new THREE.LatheGeometry(
      [new THREE.Vector2(0.0, -0.012), new THREE.Vector2(0.02, -0.012), new THREE.Vector2(0.024, -0.004), new THREE.Vector2(0.024, 0.004), new THREE.Vector2(0.017, 0.012), new THREE.Vector2(0.0, 0.012)],
      12
    );
    collarGeo.rotateX(Math.PI / 2);
    collarGeo.translate(0, 0, 0.072);
    const cordGeo = new THREE.TorusGeometry(0.0125, 0.0045, 5, 10);
    const ringGeo = new THREE.TorusGeometry(0.024, 0.0055, 6, 16);
    ringGeo.rotateY(Math.PI / 2);
    ringGeo.translate(0, 0, 0.19);
    // 红缨: a bundle of thin silk strands
    const strandGeo = new THREE.PlaneGeometry(0.009, 1);
    strandGeo.translate(0, 0.5, 0);
    strandGeo.rotateX(Math.PI / 2); // runs backward along +Z
    const tailGeo = new THREE.PlaneGeometry(0.025, 0.7);
    tailGeo.rotateX(-Math.PI / 2);
    tailGeo.translate(0, 0, 0.5);
    const cordMat = new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 0.95 });
    const makeDart = (scale: number) => {
      const g = new THREE.Group();
      const bladeMat = new THREE.MeshStandardMaterial({ color: '#b4bac2', metalness: 0.95, roughness: 0.36, envMapIntensity: 1.8 });
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      const grooveMat = new THREE.MeshStandardMaterial({ color: '#25282c', metalness: 0.8, roughness: 0.6 });
      const gTop = new THREE.Mesh(grooveGeo, grooveMat);
      gTop.position.set(0, 0.0115, -0.06);
      const gBot = gTop.clone();
      gBot.position.y = -0.0115;
      const collar = new THREE.Mesh(collarGeo, bronze);
      const cords = [0, 1, 2, 3, 4].map((k) => {
        const c = new THREE.Mesh(cordGeo, cordMat);
        c.position.z = 0.092 + k * 0.017;
        return c;
      });
      const ring = new THREE.Mesh(ringGeo, iron);
      const silkMat = new THREE.MeshStandardMaterial({ color: '#b3121b', roughness: 0.55, metalness: 0.0, side: THREE.DoubleSide, emissive: new THREE.Color('#4a0306'), emissiveIntensity: 0.7 });
      const tassel = new THREE.Group();
      tassel.name = 'tassel';
      tassel.position.z = 0.2;
      for (let k = 0; k < 14; k++) {
        const st = new THREE.Mesh(strandGeo, silkMat);
        const a = (k / 14) * Math.PI * 2;
        const spread = 0.12 + (k % 3) * 0.07;
        st.rotation.set(Math.sin(a) * spread, Math.cos(a) * spread, a);
        st.scale.set(1, 1, 0.16 + ((k * 7) % 5) * 0.025); // uneven strand lengths
        tassel.add(st);
      }
      const tailMat = new THREE.MeshBasicMaterial({ map: tailTex, color: '#2dd4bf', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const t1 = new THREE.Mesh(tailGeo, tailMat);
      const t2 = new THREE.Mesh(tailGeo, tailMat);
      t2.rotation.z = Math.PI / 2;
      g.add(blade, gTop, gBot, collar, ...cords, ring, tassel, t1, t2);
      g.userData.tail = tailMat;
      g.userData.silk = silkMat;
      g.userData.blade = bladeMat;
      g.userData.baseScale = scale;
      g.scale.setScalar(scale);
      g.visible = false;
      this.root.add(g);
      return g;
    };
    this.projPools.dart = Array.from({ length: 90 }, () => makeDart(2.0));
    this.projPools.pin = Array.from({ length: 3 }, () => makeDart(3.0));

    // 回旋镖: dark forged iron chevron with a bronze hub
    const cres = new THREE.Shape();
    cres.moveTo(-0.62, -0.2);
    cres.quadraticCurveTo(-0.3, 0.12, 0, 0.26);
    cres.quadraticCurveTo(0.3, 0.12, 0.62, -0.2);
    cres.lineTo(0.52, -0.27);
    cres.quadraticCurveTo(0.26, 0.0, 0, 0.1);
    cres.quadraticCurveTo(-0.26, 0.0, -0.52, -0.27);
    cres.closePath();
    const boomGeo = new THREE.ExtrudeGeometry(cres, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 24 });
    boomGeo.translate(0, -0.02, -0.015);
    boomGeo.rotateX(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16);
    hubGeo.translate(0, 0, 0.18); // sits on the apex of the V
    this.projPools.boomerang = Array.from({ length: 3 }, () => {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      spin.name = 'spin';
      const m = new THREE.Mesh(boomGeo, iron.clone());
      const hub = new THREE.Mesh(hubGeo, bronze);
      const blurMat = new THREE.MeshBasicMaterial({ color: '#2dd4bf', transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const blur = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.66, 40), blurMat); // spin blur disc
      blur.rotation.x = -Math.PI / 2;
      spin.add(m, hub, blur);
      g.add(spin);
      g.userData.tail = blurMat;
      g.visible = false;
      this.root.add(g);
      return g;
    });

    const streak = makeStreakTexture();
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({ map: streak, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 30;
      this.root.add(sprite);
      this.marks.push({ sprite, life: 0, maxLife: 1, scale: 1, active: false });
    }

    for (let i = 0; i < 4; i++) {
      const light = new THREE.PointLight('#ffb070', 0, 9, 2);
      this.root.add(light);
      this.lights.push({ light, life: 0, maxLife: 1, peak: 0 });
    }
  }

  createTrail(color: THREE.ColorRepresentation) {
    const t = new RibbonTrail(color);
    this.trails.push(t);
    this.root.add(t.mesh);
    return t;
  }

  setViewportHeight(px: number) {
    this.sparks.setScale(px * 0.9);
    this.dust.setScale(px * 0.9);
  }

  // ---------------- projectiles ----------------
  /** Borrow a projectile mesh ('dart' | 'pin' | 'boomerang'); returns null if the pool is empty */
  /** Borrow a projectile mesh. trail = thrower colour; variant tints the silk / blade. */
  takeProjectile(kind: 'dart' | 'pin' | 'boomerang', trail?: THREE.ColorRepresentation, variant: 'normal' | 'gold' | 'poison' = 'normal'): THREE.Object3D | null {
    const pool = this.projPools[kind];
    const o = pool.find((x) => !x.visible);
    if (!o) return null;
    o.visible = true;
    o.scale.setScalar(1); // a pooled dart may have been enlarged last time
    const u = o.userData;
    if (trail !== undefined && u.tail) (u.tail as THREE.MeshBasicMaterial).color.set(variant === 'gold' ? '#fbbf24' : variant === 'poison' ? '#4ade80' : trail);
    if (u.silk) {
      const silk = u.silk as THREE.MeshStandardMaterial;
      silk.color.set(variant === 'gold' ? '#d4a017' : '#b3121b');
      silk.emissive.set(variant === 'gold' ? '#6b4b00' : '#5a0508');
    }
    if (u.blade) {
      const b = u.blade as THREE.MeshStandardMaterial;
      if (variant === 'poison') {
        b.color.set('#8fa596');
        b.emissive.set('#0f5a25');
        b.emissiveIntensity = 0.35;
      } else if (variant === 'gold') {
        b.color.set('#b08a3a');
        b.emissive.set('#5a3d00');
        b.emissiveIntensity = 0.5;
      } else {
        b.color.set('#b4bac2');
        b.emissive.set('#000000');
        b.emissiveIntensity = 0;
      }
    }
    if (u.baseScale) o.scale.setScalar(u.baseScale);
    return o;
  }

  releaseProjectile(o: THREE.Object3D | null) {
    if (o) o.visible = false;
  }

  /** Small sparkle trail behind a flying dart */
  dartTrail(pos: THREE.Vector3, color: THREE.ColorRepresentation) {
    tmpV.set((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3);
    this.sparks.emit(pos, tmpV, color, 0.035, 0.12, { drag: 6, gravity: 0 });
  }

  // ---------------- scheduling ----------------
  later(delay: number, fn: () => void) {
    this.timers.push({ t: delay, fn });
  }

  /** Burning boulder flying on an arc from `from` to `to`, calling onImpact when it lands */
  meteor(from: THREE.Vector3, to: THREE.Vector3, dur: number, arc: number, onImpact?: () => void, scale = 1) {
    const m = this.meteors.find((x) => !x.active);
    if (!m) {
      onImpact?.();
      return;
    }
    m.active = true;
    m.from.copy(from);
    m.to.copy(to);
    m.t = 0;
    m.dur = dur;
    m.arc = arc;
    m.onImpact = onImpact;
    m.mesh.scale.setScalar(scale);
    m.mesh.visible = true;
  }

  // ---------------- primitives ----------------
  /** Bright crossing blade streak at the point of impact */
  slashMark(pos: THREE.Vector3, color: THREE.ColorRepresentation, scale = 1, life = 0.16) {
    for (let k = 0; k < 2; k++) {
      const m = this.marks.find((x) => !x.active) || this.marks.reduce((a, b) => (a.life < b.life ? a : b));
      m.active = true;
      m.life = life;
      m.maxLife = life;
      m.scale = scale * (k === 0 ? 1 : 0.7);
      m.sprite.visible = true;
      m.sprite.position.copy(pos);
      const mat = m.sprite.material as THREE.SpriteMaterial;
      mat.color.set(k === 0 ? '#ffffff' : color);
      mat.rotation = Math.random() * Math.PI + (k === 1 ? 1.2 : 0);
    }
  }

  /** Upward eruption of fire at a point (used along fissures and around the ultimate crater) */
  fireColumn(posIn: THREE.Vector3, height = 1.6, color: THREE.ColorRepresentation = '#ff5a1a') {
    const pos = posIn.clone();
    for (let i = 0; i < 14; i++) {
      tmpV.set((Math.random() - 0.5) * 1.2, height * (3 + Math.random() * 4), (Math.random() - 0.5) * 1.2);
      tmpV2.set(pos.x + (Math.random() - 0.5) * 0.4, 0.1, pos.z + (Math.random() - 0.5) * 0.4);
      this.sparks.emit(tmpV2, tmpV, Math.random() < 0.3 ? '#fff1c9' : color, 0.12 + Math.random() * 0.12, 0.35 + Math.random() * 0.25, { drag: 2.5, gravity: 6 });
    }
    this.dustPuff(pos, 3, 0.3, 1.5, 0.6, '#5a4a40');
    this.flash(new THREE.Vector3(pos.x, 0.8, pos.z), color, 10, 0.2, 5);
  }

  /** Spiral of sparks thrown off a spinning body */
  spiral(posIn: THREE.Vector3, radius: number, phase: number, color: THREE.ColorRepresentation) {
    const pos = posIn.clone();
    for (let k = 0; k < 3; k++) {
      const a = phase + (k / 3) * Math.PI * 2;
      tmpV2.set(pos.x + Math.cos(a) * radius, pos.y + 0.9 + (Math.random() - 0.5) * 0.4, pos.z + Math.sin(a) * radius);
      tmpV.set(-Math.sin(a) * 7 + Math.cos(a) * 2, 0.6 + Math.random(), Math.cos(a) * 7 + Math.sin(a) * 2);
      this.sparks.emit(tmpV2, tmpV, Math.random() < 0.3 ? '#fff1c9' : color, 0.09, 0.3, { drag: 3, gravity: 4 });
    }
  }

  /** Cone of air being shoved forward during a charge */
  chargeWave(posIn: THREE.Vector3, dir: THREE.Vector3, color: THREE.ColorRepresentation) {
    const pos = posIn.clone();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    for (let i = 0; i < 4; i++) {
      const s = (Math.random() - 0.5) * 1.6;
      tmpV2.copy(pos).addScaledVector(dir, 0.9).addScaledVector(side, s);
      tmpV2.y = 0.4 + Math.random() * 1.3;
      tmpV.copy(dir).multiplyScalar(4 + Math.random() * 3).addScaledVector(side, s * 4);
      this.sparks.emit(tmpV2, tmpV, i % 2 ? '#ffe0b8' : color, 0.07, 0.22, { drag: 5, gravity: 0 });
    }
  }

  ring(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, life = 0.45, width = 0.14, fill = 0) {
    const r = this.rings.find((x) => !x.active) || this.rings.reduce((a, b) => (a.life < b.life ? a : b));
    r.active = true;
    r.life = life;
    r.maxLife = life;
    r.radius = radius;
    r.mesh.visible = true;
    r.mesh.position.set(pos.x, Math.max(0.03, pos.y), pos.z);
    r.mesh.scale.set(radius * 2, radius * 2, 1);
    r.mat.uniforms.uColor.value.set(color);
    r.mat.uniforms.uWidth.value = width;
    r.mat.uniforms.uFill.value = fill;
  }

  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, life = 0.18, distance = 8) {
    const l = this.lights.find((x) => x.life <= 0) || this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    l.light.position.copy(pos);
    l.light.color.set(color);
    l.light.distance = distance;
    l.life = life;
    l.maxLife = life;
    l.peak = intensity;
  }

  decal(pos: THREE.Vector3, size: number, life = 2.2) {
    const d = this.decals.find((x) => !x.active) || this.decals.reduce((a, b) => (a.life < b.life ? a : b));
    d.active = true;
    d.life = life;
    d.maxLife = life;
    d.group.visible = true;
    d.group.position.set(pos.x, 0, pos.z);
    d.group.rotation.y = Math.random() * Math.PI * 2;
    d.group.scale.set(size, 1, size);
  }

  sparkBurst(posIn: THREE.Vector3, count: number, color: THREE.ColorRepresentation, speed = 7, size = 0.09, dir?: THREE.Vector3, spread = 1) {
    const pos = origin.copy(posIn);
    for (let i = 0; i < count; i++) {
      tmpV.set(Math.random() - 0.5, Math.random() * 0.8 - 0.1, Math.random() - 0.5).normalize();
      if (dir) tmpV.multiplyScalar(spread).add(dir).normalize();
      tmpV.multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      const hot = Math.random() < 0.35;
      this.sparks.emit(pos, tmpV, hot ? '#fff3d6' : color, size * (0.6 + Math.random() * 0.9), 0.22 + Math.random() * 0.3, { drag: 4.5, gravity: 10 });
    }
  }

  /** fine grains peeling off and drifting away on the wind (being eaten by the 飞虫沙暴) */
  grains(posIn: THREE.Vector3, count: number, color: THREE.ColorRepresentation, wind: THREE.Vector3, radius = 0.3, size = 0.05) {
    const pos = origin.copy(posIn);
    for (let i = 0; i < count; i++) {
      tmpV2.set(pos.x + (Math.random() - 0.5) * radius * 2, pos.y + (Math.random() - 0.5) * 0.12, pos.z + (Math.random() - 0.5) * radius * 2);
      tmpV.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.8).addScaledVector(wind, 0.5 + Math.random() * 0.8);
      tmpV.y += 0.3 + Math.random() * 0.7;
      this.sparks.emit(tmpV2, tmpV, color, size * (0.6 + Math.random() * 0.9), 1.0 + Math.random() * 1.4, { drag: 0.5, gravity: -0.25 });
    }
  }

  embers(posIn: THREE.Vector3, count: number, color: THREE.ColorRepresentation, radius = 0.6, rise = 2.5, size = 0.07) {
    const pos = origin.copy(posIn);
    for (let i = 0; i < count; i++) {
      tmpV2.set(pos.x + (Math.random() - 0.5) * radius * 2, pos.y + Math.random() * 0.4, pos.z + (Math.random() - 0.5) * radius * 2);
      tmpV.set((Math.random() - 0.5) * 0.6, rise * (0.5 + Math.random()), (Math.random() - 0.5) * 0.6);
      this.sparks.emit(tmpV2, tmpV, color, size * (0.6 + Math.random()), 0.6 + Math.random() * 0.6, { drag: 1.5, gravity: -0.6 });
    }
  }

  dustPuff(posIn: THREE.Vector3, count: number, radius = 0.5, speed = 2.5, size = 0.7, color: THREE.ColorRepresentation = '#9a8a78') {
    const pos = origin.copy(posIn);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      tmpV2.set(pos.x + Math.cos(a) * radius * Math.random(), 0.15 + Math.random() * 0.25, pos.z + Math.sin(a) * radius * Math.random());
      tmpV.set(Math.cos(a) * speed * (0.5 + Math.random()), 0.4 + Math.random() * 1.2, Math.sin(a) * speed * (0.5 + Math.random()));
      this.dust.emit(tmpV2, tmpV, color, size * (0.6 + Math.random() * 0.8), 0.7 + Math.random() * 0.6, { drag: 2.8, gravity: -0.3, grow: 1.6 });
    }
  }

  rocks(posIn: THREE.Vector3, count: number, power = 7, size = 0.12) {
    const pos = origin.copy(posIn);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      tmpV.set(Math.cos(a) * power * (0.3 + Math.random() * 0.6), power * (0.6 + Math.random() * 0.7), Math.sin(a) * power * (0.3 + Math.random() * 0.6));
      tmpV2.set(pos.x + Math.cos(a) * 0.3, 0.2, pos.z + Math.sin(a) * 0.3);
      this.debris.emit(tmpV2, tmpV, size * (0.5 + Math.random()));
    }
  }

  damageNumber(pos: THREE.Vector3, value: number | string, crit: boolean, color = '#ffffff') {
    const d = this.dmg.find((x) => !x.active) || this.dmg.reduce((a, b) => (a.life < b.life ? a : b));
    const ctx = d.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 96);
    ctx.font = `900 ${crit ? 64 : 52}px "Arial Black", Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(20,6,2,0.9)';
    const txt = String(value);
    ctx.strokeText(txt, 128, 50);
    const grd = ctx.createLinearGradient(0, 20, 0, 80);
    if (crit) {
      grd.addColorStop(0, '#fff7c2');
      grd.addColorStop(1, '#ff9a1f');
    } else {
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(1, color);
    }
    ctx.fillStyle = grd;
    ctx.fillText(txt, 128, 50);
    d.tex.needsUpdate = true;
    d.active = true;
    d.life = crit ? 1.0 : 0.8;
    d.maxLife = d.life;
    d.baseScale = crit ? 0.5 : 0.38;
    d.sprite.visible = true;
    d.sprite.position.set(pos.x + (Math.random() - 0.5) * 0.5, pos.y, pos.z + (Math.random() - 0.5) * 0.5);
    d.vel.set((Math.random() - 0.5) * 0.6, crit ? 2.4 : 2.0, (Math.random() - 0.5) * 0.6);
  }

  // ---------------- continuous effects ----------------
  setVortex(on: boolean, duration = 1.6, slot = 0) {
    const sl = this.slots[slot];
    if (on) {
      sl.vLife = duration;
      sl.vMax = duration;
      sl.vortex.group.visible = true;
    } else {
      sl.vLife = Math.min(sl.vLife, 0.15);
    }
  }

  pillarAt(duration: number, color: THREE.ColorRepresentation, slot = 0) {
    const sl = this.slots[slot];
    sl.pLife = duration;
    sl.pMax = duration;
    sl.pillar.mat.uniforms.uColor.value.set(color);
    sl.pillar.group.visible = true;
  }

  // ---------------- 梵音 ----------------
  palmStrike(pos: THREE.Vector3, scale = 1, fall = 0.35) {
    this.monk.palmStrike(pos, scale, fall);
  }
  palmPush(from: THREE.Vector3, dir: THREE.Vector3, scale = 1, reach = 3) {
    this.monk.palmPush(from, dir, scale, reach);
  }
  buddha(pos: THREE.Vector3, dur: number) {
    this.monk.buddha(pos, dur);
  }
  bell(dur: number, slot = 0) {
    this.monk.bell(slot, dur);
  }
  bellHit(slot = 0) {
    this.monk.bellHit(slot);
  }
  zenField(pos: THREE.Vector3, radius: number, dur: number, slot = 0) {
    this.monk.zenField(slot, pos, radius, dur);
  }

  glyph(idx: number, from: THREE.Vector3, vel: THREE.Vector3, targetSlot: number) {
    this.monk.glyph(idx, from, vel, targetSlot);
  }
  followFighter(slot: number, p: THREE.Vector3) {
    this.monk.follow(slot, p);
    const sl = this.slots[slot];
    sl.vortex.group.position.set(p.x, p.y, p.z);
    sl.pillar.group.position.set(p.x, 0, p.z);
  }

  followPlayer(p: THREE.Vector3) {
    this.followFighter(0, p);
  }

  // ---------------- composite skill effects ----------------
  hitImpact(posIn: THREE.Vector3, dir: THREE.Vector3, heavy: boolean, color: THREE.ColorRepresentation = '#ff4a1c') {
    const pos = posIn.clone();
    this.sparkBurst(pos, heavy ? 34 : 18, color, heavy ? 9 : 6.5, heavy ? 0.12 : 0.09, dir, 0.9);
    this.flash(pos, heavy ? '#ffb46b' : '#ff8a4a', heavy ? 26 : 12, heavy ? 0.16 : 0.1, 6);
    if (heavy) this.ring(new THREE.Vector3(pos.x, 0.04, pos.z), 1.3, color, 0.3, 0.18);
  }

  groundSlam(posIn: THREE.Vector3, scale: number, color: THREE.ColorRepresentation = '#ff4a1c') {
    const pos = posIn.clone();
    this.ring(pos, 2.4 * scale, color, 0.45, 0.16, 0.6);
    this.ring(pos, 3.4 * scale, '#ffb347', 0.65, 0.08);
    this.decal(pos, 3.6 * scale, 2.4);
    this.rocks(pos, Math.round(14 * scale), 6.5 * Math.sqrt(scale), 0.11 * Math.sqrt(scale));
    this.dustPuff(pos, Math.round(26 * scale), 1.0 * scale, 3.6 * scale, 0.8);
    this.sparkBurst(new THREE.Vector3(pos.x, 0.3, pos.z), Math.round(30 * scale), color, 8, 0.11, UP, 1.4);
    this.flash(tmpV.set(pos.x, 1.2, pos.z), '#ff9a4a', 40 * scale, 0.28, 10 * scale);
  }

  ultimateImpact(posIn: THREE.Vector3) {
    const pos = posIn.clone();
    this.ring(pos, 2.0, '#ffffff', 0.25, 0.25, 1.0);
    this.ring(pos, 5.5, '#ff6a1c', 0.6, 0.12, 0.5);
    this.ring(pos, 7.5, '#ffb347', 0.9, 0.06);
    this.decal(pos, 7.0, 3.5);
    this.rocks(pos, 40, 10, 0.16);
    this.dustPuff(pos, 60, 2.2, 6.5, 1.2);
    this.sparkBurst(new THREE.Vector3(pos.x, 0.4, pos.z), 110, '#ff6a1c', 13, 0.14, UP, 1.6);
    this.embers(pos, 50, '#ff8c3a', 2.5, 4, 0.08);
    this.flash(tmpV.set(pos.x, 2, pos.z), '#ffd2a0', 120, 0.45, 18);
    this.flash(tmpV.set(pos.x, 0.5, pos.z), '#ff5a1a', 60, 0.8, 14);
    this.later(0.14, () => this.ring(pos, 9.5, '#ffd08a', 0.8, 0.05));
    this.later(0.22, () => {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        this.fireColumn(new THREE.Vector3(pos.x + Math.cos(a) * 3.6, 0, pos.z + Math.sin(a) * 3.6), 2.0);
      }
    });
  }

  // ---------------- tick ----------------
  /** 锁链钩: a chain shoots out from `from` to `to` and reels back in over `life` seconds */
  chain(from: THREE.Vector3, to: THREE.Vector3, life = 0.55) {
    const ch = this.chains.find((c) => c.life <= 0) ?? this.chains[0];
    ch.from.copy(from);
    ch.to.copy(to);
    ch.life = ch.max = life;
  }
  private updateChains(dt: number) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const q2 = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (const ch of this.chains) {
      if (ch.life <= 0) {
        ch.links.count = 0;
        ch.hook.visible = false;
        continue;
      }
      ch.life -= dt;
      const u = 1 - Math.max(0, ch.life) / ch.max;
      // out fast (first 35%), a beat at full stretch, then reeled in
      const reach = u < 0.35 ? 1 - Math.pow(1 - u / 0.35, 3) : u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5;
      dir.copy(ch.to).sub(ch.from);
      const full = dir.length();
      dir.normalize();
      const len = full * reach;
      const n = Math.min(ch.LINKS, Math.floor(len / 0.085));
      q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      for (let k = 0; k < n; k++) {
        p.copy(ch.from).addScaledVector(dir, k * 0.085);
        p.y += Math.sin((k / Math.max(1, n)) * Math.PI) * 0.12 * (1 - reach); // a little slack while it flies
        q2.setFromAxisAngle(dir, k % 2 ? Math.PI / 2 : 0).multiply(q);
        m.compose(p, q2, one);
        ch.links.setMatrixAt(k, m);
      }
      ch.links.count = n;
      ch.links.instanceMatrix.needsUpdate = true;
      ch.hook.visible = reach > 0.02;
      ch.hook.position.copy(ch.from).addScaledVector(dir, len);
      ch.hook.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    }
  }

  update(dt: number) {
    this.time += dt;
    this.monk.update(dt);
    this.updateChains(dt);
    if (this.timers.length) {
      const due: (() => void)[] = [];
      this.timers = this.timers.filter((x) => {
        x.t -= dt;
        if (x.t <= 0) {
          due.push(x.fn);
          return false;
        }
        return true;
      });
      due.forEach((f) => f());
    }
    for (const m of this.meteors) {
      if (!m.active) continue;
      m.t += dt;
      const k = Math.min(1, m.t / m.dur);
      m.mesh.position.lerpVectors(m.from, m.to, k);
      m.mesh.position.y += Math.sin(k * Math.PI) * m.arc;
      m.mesh.rotation.x += dt * 7;
      m.mesh.rotation.z += dt * 5;
      // fiery trail
      tmpV.set((Math.random() - 0.5) * 1.5, Math.random() * 1.5, (Math.random() - 0.5) * 1.5);
      this.sparks.emit(m.mesh.position, tmpV, Math.random() < 0.4 ? '#ffe2a8' : '#ff5a14', 0.45 * m.mesh.scale.x, 0.5, { drag: 1.5, gravity: -1 });
      this.dust.emit(m.mesh.position, tmpV.set(0, 0.5, 0), '#2b1f1a', 1.4 * m.mesh.scale.x, 1.2, { drag: 1, gravity: -0.5, grow: 2 });
      if (k >= 1) {
        m.active = false;
        m.mesh.visible = false;
        m.onImpact?.();
      }
    }
    for (const m of this.marks) {
      if (!m.active) continue;
      m.life -= dt;
      if (m.life <= 0) {
        m.active = false;
        m.sprite.visible = false;
        continue;
      }
      const t = 1 - m.life / m.maxLife;
      const w = m.scale * (1.2 + 1.4 * easeOutCubic(Math.min(1, t * 3)));
      m.sprite.scale.set(w * 1.6, w * 0.32 * (1 - t * 0.6), 1);
      (m.sprite.material as THREE.SpriteMaterial).opacity = 1 - t * t;
    }
    this.sparks.update(dt);
    this.dust.update(dt);
    this.debris.update(dt);

    for (const r of this.rings) {
      if (!r.active) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      r.mat.uniforms.uProgress.value = 0.08 + 0.85 * easeOutQuart(t);
      r.mat.uniforms.uOpacity.value = 1 - t * t;
      r.mat.uniforms.uTime.value = this.time;
    }

    for (const d of this.decals) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.group.visible = false;
        continue;
      }
      const t = 1 - d.life / d.maxLife;
      d.scorchMat.opacity = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      d.glowMat.opacity = Math.max(0, 1 - t * 1.8) * (0.85 + 0.15 * Math.sin(this.time * 30));
      const grow = 0.6 + 0.4 * easeOutCubic(Math.min(1, t * 6));
      d.group.children.forEach((c) => c.scale.setScalar(grow));
    }

    for (const d of this.dmg) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.sprite.visible = false;
        continue;
      }
      const t = 1 - d.life / d.maxLife;
      d.vel.y -= 3.2 * dt;
      d.sprite.position.addScaledVector(d.vel, dt);
      const pop = t < 0.12 ? 1 + (1 - t / 0.12) * 0.6 : 1;
      const s = d.baseScale * pop;
      d.sprite.scale.set(s * 2.6, s, 1);
      (d.sprite.material as THREE.SpriteMaterial).opacity = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
    }

    for (const l of this.lights) {
      if (l.life <= 0) {
        l.light.intensity = 0;
        continue;
      }
      l.life -= dt;
      const t = Math.max(0, l.life / l.maxLife);
      l.light.intensity = l.peak * t * t;
    }

    for (const sl of this.slots) {
      if (sl.vLife > 0) {
        sl.vLife -= dt;
        const t = 1 - sl.vLife / Math.max(0.001, sl.vMax);
        sl.vortex.mat.uniforms.uOpacity.value = 0.85 * Math.min(1, t * 8) * Math.min(1, sl.vLife / 0.2);
        sl.vortex.mat.uniforms.uTime.value = this.time;
        sl.vortex.outer.rotation.y -= dt * 11;
        sl.vortex.inner.rotation.y -= dt * 15;
        if (sl.vLife <= 0) sl.vortex.group.visible = false;
      }
      if (sl.pLife > 0) {
        sl.pLife -= dt;
        const t = 1 - sl.pLife / Math.max(0.001, sl.pMax);
        sl.pillar.mat.uniforms.uOpacity.value = Math.min(1, t * 8) * Math.min(1, sl.pLife / 0.35) * 0.9;
        sl.pillar.mat.uniforms.uTime.value = this.time;
        const g = 0.6 + 0.4 * easeOutCubic(Math.min(1, t * 4));
        sl.pillar.group.scale.set(g, 1, g);
        if (sl.pLife <= 0) sl.pillar.group.visible = false;
      }
    }

    for (const tr of this.trails) {
      // trails are advanced by their owner (needs blade positions)
      void tr;
    }
  }

  get activeCount() {
    let n = this.sparks.active + this.dust.active + this.debris.active;
    for (const r of this.rings) if (r.active) n++;
    for (const d of this.decals) if (d.active) n++;
    for (const d of this.dmg) if (d.active) n++;
    for (const m of this.marks) if (m.active) n++;
    for (const m of this.meteors) if (m.active) n++;
    for (const t of this.trails) n += t.count > 0 ? 1 : 0;
    for (const sl of this.slots) n += (sl.vLife > 0 ? 1 : 0) + (sl.pLife > 0 ? 1 : 0);
    return n;
  }

  dispose() {
    this.root.traverse((o: any) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach((x: any) => {
          x.map?.dispose?.();
          x.dispose?.();
        });
      }
    });
  }
}
