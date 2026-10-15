import * as THREE from 'three';

// ==================================================================
// 梵音 effects: falling and thrusting golden palms (金刚掌 / 万佛朝宗),
// the seated Buddha apparition, the golden bell shield (金钟罩) and the
// zen circle on the ground (禅定结界). Owned by VFXSystem.
// ==================================================================

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A right hand, palm facing the viewer, fingers up: golden, with soft glow and engraved lines */
function palmTexture() {
  return canvas(256, 256, (g) => {
    const hand = () => {
      g.beginPath();
      // palm
      g.moveTo(70, 238);
      g.bezierCurveTo(52, 200, 56, 150, 62, 128);
      // four fingers, each a rounded column
      const fingers: [number, number, number][] = [
        [66, 60, 26],
        [96, 34, 27],
        [127, 30, 27],
        [158, 46, 25],
      ];
      for (const [x, top, w] of fingers) {
        g.lineTo(x, 130);
        g.lineTo(x, top + w / 2);
        g.arc(x + w / 2, top + w / 2, w / 2, Math.PI, 0);
        g.lineTo(x + w, 130);
      }
      // thumb sweeping out to the right
      g.lineTo(186, 150);
      g.bezierCurveTo(205, 128, 228, 112, 236, 124);
      g.bezierCurveTo(244, 136, 222, 170, 200, 196);
      g.bezierCurveTo(190, 214, 180, 230, 176, 240);
      g.closePath();
    };
    g.shadowColor = 'rgba(255,200,90,0.95)';
    g.shadowBlur = 22;
    const grd = g.createLinearGradient(0, 30, 0, 240);
    grd.addColorStop(0, '#fff3c4');
    grd.addColorStop(0.5, '#ffd36a');
    grd.addColorStop(1, '#e8a23a');
    g.fillStyle = grd;
    hand();
    g.fill();
    g.shadowBlur = 0;
    // engraved creases and a 卍-free wheel mark in the palm
    g.strokeStyle = 'rgba(150,80,10,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(120, 180, 22, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(120 + Math.cos(a) * 8, 180 + Math.sin(a) * 8);
      g.lineTo(120 + Math.cos(a) * 22, 180 + Math.sin(a) * 22);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(72, 140);
    g.quadraticCurveTo(120, 150, 176, 138);
    g.stroke();
  });
}

/** Seated Buddha silhouette with a halo, for the apparition behind the monk */
function buddhaTexture() {
  return canvas(512, 640, (g) => {
    const cx = 256;
    // halo rings
    for (const [r, a] of [
      [235, 0.18],
      [190, 0.28],
      [120, 0.4],
    ] as const) {
      const grd = g.createRadialGradient(cx, 210, r * 0.6, cx, 210, r);
      grd.addColorStop(0, 'rgba(255,220,130,0)');
      grd.addColorStop(0.85, `rgba(255,214,120,${a})`);
      grd.addColorStop(1, 'rgba(255,214,120,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(cx, 210, r, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowColor = 'rgba(255,200,90,1)';
    g.shadowBlur = 30;
    const body = g.createLinearGradient(0, 80, 0, 640);
    body.addColorStop(0, 'rgba(255,240,190,0.95)');
    body.addColorStop(1, 'rgba(230,160,50,0.9)');
    g.fillStyle = body;
    // head, topknot (肉髻) and long ears
    g.beginPath();
    g.ellipse(cx, 200, 56, 66, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(cx, 128, 30, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(cx - 58, 214, 12, 34, 0.1, 0, Math.PI * 2);
    g.ellipse(cx + 58, 214, 12, 34, -0.1, 0, Math.PI * 2);
    g.fill();
    // shoulders, robe and crossed legs on a lotus
    g.beginPath();
    g.moveTo(cx - 40, 262);
    g.bezierCurveTo(cx - 150, 280, cx - 170, 360, cx - 160, 470);
    g.bezierCurveTo(cx - 230, 500, cx - 240, 560, cx - 180, 575);
    g.lineTo(cx + 180, 575);
    g.bezierCurveTo(cx + 240, 560, cx + 230, 500, cx + 160, 470);
    g.bezierCurveTo(cx + 170, 360, cx + 150, 280, cx + 40, 262);
    g.closePath();
    g.fill();
    // lotus petals
    g.fillStyle = 'rgba(255,190,90,0.85)';
    for (let k = -4; k <= 4; k++) {
      g.beginPath();
      g.ellipse(cx + k * 46, 600, 30, 34, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
    // robe folds and the hands in meditation
    g.strokeStyle = 'rgba(160,90,20,0.5)';
    g.lineWidth = 5;
    for (const k of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + k * 30, 280);
      g.quadraticCurveTo(cx + k * 110, 380, cx + k * 60, 470);
      g.stroke();
    }
    g.beginPath();
    g.ellipse(cx, 470, 70, 26, 0, 0, Math.PI * 2);
    g.stroke();
  });
}

/** Ground circle of 禅定结界: rings, spokes and rows of glyph-like strokes */
function zenTexture() {
  return canvas(512, 512, (g) => {
    const c = 256;
    g.strokeStyle = 'rgba(255,214,120,1)';
    g.shadowColor = 'rgba(255,190,80,1)';
    g.shadowBlur = 10;
    for (const [r, w] of [
      [248, 6],
      [232, 2],
      [170, 4],
      [158, 2],
      [70, 4],
    ] as const) {
      g.lineWidth = w;
      g.beginPath();
      g.arc(c, c, r, 0, Math.PI * 2);
      g.stroke();
    }
    // spokes of the dharma wheel
    g.lineWidth = 3;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * 70, c + Math.sin(a) * 70);
      g.lineTo(c + Math.cos(a) * 158, c + Math.sin(a) * 158);
      g.stroke();
    }
    // a ring of glyph-like marks between the outer circles
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.lineWidth = 3;
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      g.save();
      g.translate(c + Math.cos(a) * 200, c + Math.sin(a) * 200);
      g.rotate(a + Math.PI / 2);
      g.beginPath();
      g.moveTo(-9, -12);
      g.lineTo(9, -12);
      for (let s = 0; s < 3; s++) {
        const x = (rnd() - 0.5) * 16;
        g.moveTo(x, -12);
        g.lineTo(x + (rnd() - 0.5) * 8, 12 * rnd());
      }
      g.stroke();
      g.restore();
    }
  });
}

interface PalmFx {
  mesh: THREE.Mesh;
  glow: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  mode: 'drop' | 'push';
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  hold: number;
  scale: number;
  active: boolean;
}

function bellMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color('#ffc94a') }, uHit: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity, uHit; uniform vec3 uColor;
      varying vec3 vN; varying vec3 vV; varying vec2 vUv;
      void main(){
        float fres = pow(max(0.0, 1.0 - abs(dot(normalize(vN), normalize(vV)))), 2.2);
        // bands of scripture scrolling round the bell
        float band = step(0.5, fract(vUv.y * 6.0)) * (0.5 + 0.5 * step(0.55, fract(vUv.x * 28.0 + uTime * 0.6)));
        float rim = smoothstep(0.92, 1.0, vUv.y) + smoothstep(0.08, 0.0, vUv.y);
        float a = (0.12 + fres * 0.75 + band * 0.12 + rim * 0.4 + uHit * 0.6) * uOpacity;
        gl_FragColor = vec4(uColor * (1.2 + fres * 1.5 + uHit * 2.0), a);
      }`,
  });
}

function bellGeometry() {
  // profile of a temple bell: flared lip, straight waist, domed crown with a loop
  const pts: THREE.Vector2[] = [];
  const prof: [number, number][] = [
    [1.18, 0],
    [1.12, 0.12],
    [0.98, 0.35],
    [0.92, 0.9],
    [0.9, 1.55],
    [0.82, 1.95],
    [0.6, 2.2],
    [0.25, 2.32],
    [0.01, 2.34],
  ];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 48);
}

export const MANTRA = ['唵', '嘛', '呢', '叭', '咪', '吽'];

function glyphTexture(ch: string, halo: boolean) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  if (halo) {
    const rg = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    rg.addColorStop(0, ch ? 'rgba(255,200,90,0.25)' : 'rgba(255,200,90,0.8)');
    rg.addColorStop(0.45, ch ? 'rgba(255,150,40,0.1)' : 'rgba(255,150,40,0.3)');
    rg.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, 128, 128);
  }
  g.font = 'bold 88px "Noto Serif SC","Songti SC","STSong","SimSun","Noto Sans CJK SC","Microsoft YaHei",serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (halo) {
    if (ch) {
      g.shadowColor = 'rgba(255,190,80,1)';
      g.shadowBlur = 16;
      g.fillStyle = 'rgba(255,225,160,0.7)';
      g.fillText(ch, 64, 68);
    }
  } else {
    g.lineJoin = 'round';
    g.lineWidth = 9;
    g.strokeStyle = 'rgba(90,30,0,0.95)';
    g.strokeText(ch, 64, 68);
    const lg = g.createLinearGradient(0, 24, 0, 108);
    lg.addColorStop(0, '#fff6c8');
    lg.addColorStop(0.5, '#ffd257');
    lg.addColorStop(1, '#f59e0b');
    g.fillStyle = lg;
    g.fillText(ch, 64, 68);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Homing step shared by the gameplay sim and the visual so both fly the same arc */
export function glyphSteer(pos: THREE.Vector3, vel: THREE.Vector3, target: THREE.Vector3, age: number, dt: number) {
  // first 0.18 s the glyph drifts out of its fan, then it hunts the target harder and harder
  const want = target.clone().sub(pos);
  const d = want.length();
  if (age > 0.18 && d > 1e-3) {
    const speed = Math.min(26, 11 + (age - 0.18) * 34);
    want.multiplyScalar(speed / d);
    const k = 1 - Math.exp(-dt * (4 + age * 10));
    vel.lerp(want, k);
  } else {
    vel.multiplyScalar(Math.exp(-dt * 2.5));
  }
  pos.addScaledVector(vel, dt);
}

export class MonkFX {
  private palms: PalmFx[] = [];
  private buddhaSprite: THREE.Sprite;
  private buddhaLife = 0;
  private buddhaMax = 1;
  private bells: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; life: number; max: number; hit: number }[] = [];
  private zens: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; radius: number }[] = [];
  private time = 0;
  private targets = Array.from({ length: 9 }, () => new THREE.Vector3()); // one per fighter slot
  private glyphs: { spr: THREE.Sprite; ghosts: THREE.Sprite[]; trail: THREE.Vector3[]; pos: THREE.Vector3; vel: THREE.Vector3; age: number; slot: number; big: boolean; active: boolean; dying: number }[] = [];
  private glyphTex: THREE.Texture[] = [];
  private haloTex: THREE.Texture[] = [];
  private discTex!: THREE.Texture;

  constructor(root: THREE.Object3D) {
    this.glyphTex = MANTRA.map((ch) => glyphTexture(ch, false));
    this.haloTex = MANTRA.map((ch) => glyphTexture(ch, true));
    this.discTex = glyphTexture('', true);
    for (let i = 0; i < 14; i++) {
      const mk = (o: number, solid = false) => {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glyphTex[0], transparent: true, depthWrite: false, depthTest: true, blending: solid ? THREE.NormalBlending : THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.15, 0.5), toneMapped: false, opacity: o }));
        sp.visible = false;
        sp.renderOrder = solid ? 16 : 15;
        root.add(sp);
        return sp;
      };
      const spr = mk(1, true);
      const ghosts = [mk(0.8), mk(0.5), mk(0.25)];
      this.glyphs.push({ spr, ghosts, trail: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, slot: 0, big: false, active: false, dying: 0 });
    }
    const palmTex = palmTexture();
    const plane = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: palmTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, color: new THREE.Color(1.6, 1.3, 0.8), toneMapped: false });
      const glowMat = mat.clone();
      glowMat.color = new THREE.Color(0.9, 0.55, 0.15);
      const mesh = new THREE.Mesh(plane, mat);
      const glow = new THREE.Mesh(plane, glowMat);
      glow.scale.setScalar(1.35);
      glow.position.z = -0.02;
      mesh.add(glow);
      mesh.visible = false;
      mesh.renderOrder = 14;
      root.add(mesh);
      this.palms.push({ mesh, glow, mat, glowMat, mode: 'drop', from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, hold: 0.3, scale: 1, active: false });
    }
    this.buddhaSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: buddhaTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(2.6, 1.9, 0.9), toneMapped: false }));
    this.buddhaSprite.visible = false;
    this.buddhaSprite.renderOrder = 4;
    root.add(this.buddhaSprite);
    const bg = bellGeometry();
    for (let i = 0; i < 9; i++) {
      const mat = bellMaterial();
      const mesh = new THREE.Mesh(bg, mat);
      mesh.visible = false;
      mesh.renderOrder = 13;
      root.add(mesh);
      this.bells.push({ mesh, mat, life: 0, max: 1, hit: 0 });
    }
    const zt = zenTexture();
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: zt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1.3, 1.0, 0.55), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 7;
      root.add(mesh);
      this.zens.push({ mesh, mat, life: 0, max: 1, radius: 1 });
    }
  }

  private takePalm() {
    return this.palms.find((p) => !p.active) ?? this.palms.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
  }

  /** A giant palm falls from the sky and slaps flat onto `target` after `fall` seconds */
  palmStrike(target: THREE.Vector3, scale: number, fall: number) {
    const p = this.takePalm();
    p.mode = 'drop';
    p.to.copy(target);
    p.from.set(target.x, target.y + 11 * scale, target.z);
    p.t = 0;
    p.dur = fall;
    p.hold = 0.45;
    p.scale = scale;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
  }

  /** A palm thrust forward from `from` along `dir` (金刚掌 / third combo hit) */
  palmPush(from: THREE.Vector3, dir: THREE.Vector3, scale: number, reach: number) {
    const p = this.takePalm();
    p.mode = 'push';
    p.from.copy(from);
    p.to.copy(from).addScaledVector(dir, reach);
    p.t = 0;
    p.dur = 0.22;
    p.hold = 0.28;
    p.scale = scale;
    p.active = true;
    p.mesh.visible = true;
    p.mesh.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
  }

  /** The seated Buddha rises behind the monk */
  buddha(pos: THREE.Vector3, dur: number) {
    this.buddhaLife = dur;
    this.buddhaMax = dur;
    this.buddhaSprite.position.copy(pos);
    this.buddhaSprite.visible = true;
  }

  bell(slot: number, dur: number) {
    const b = this.bells[slot];
    b.life = dur;
    b.max = dur;
    b.hit = 0;
    b.mesh.visible = true;
  }

  bellHit(slot: number) {
    this.bells[slot].hit = 1;
  }

  zenField(slot: number, pos: THREE.Vector3, radius: number, dur: number) {
    const z = this.zens[slot];
    z.life = dur;
    z.max = dur;
    z.radius = radius;
    z.mesh.position.set(pos.x, pos.y + 0.04, pos.z);
    z.mesh.visible = true;
  }

  /** One syllable of 六字真言 leaves the monk and hunts fighter `targetSlot` */
  glyph(idx: number, from: THREE.Vector3, vel: THREE.Vector3, targetSlot: number) {
    const g = this.glyphs.find((x) => !x.active) ?? this.glyphs[0];
    const big = idx === 5;
    g.active = true;
    g.dying = 0;
    g.age = 0;
    g.slot = targetSlot;
    g.big = big;
    g.pos.copy(from);
    g.vel.copy(vel);
    for (const t of g.trail) t.copy(from);
    for (const sp of [g.spr, ...g.ghosts]) {
      const solid = sp === g.spr;
      (sp.material as THREE.SpriteMaterial).map = sp === g.ghosts[0] ? this.discTex : (solid ? this.glyphTex : this.haloTex)[idx % 6];
      if (solid) (sp.material as THREE.SpriteMaterial).color.setRGB(1.25, 1.15, 1.0);
      else (sp.material as THREE.SpriteMaterial).color.setRGB(big ? 2.4 : 1.7, big ? 1.3 : 1.05, big ? 0.35 : 0.4);
      sp.material.needsUpdate = true;
      sp.visible = true;
      sp.position.copy(from);
    }
  }

  follow(slot: number, p: THREE.Vector3) {
    this.targets[slot].set(p.x, p.y + 1.15, p.z);
    this.bells[slot].mesh.position.set(p.x, p.y - 0.05, p.z);
  }

  update(dt: number) {
    this.time += dt;
    for (const g of this.glyphs) {
      if (!g.active) continue;
      g.age += dt;
      if (g.dying > 0) {
        g.dying -= dt;
        const k = Math.max(0, g.dying / 0.22);
        const s = (g.big ? 1.6 : 1.0) * (1 + (1 - k) * 1.6);
        g.spr.scale.set(s, s, 1);
        g.spr.material.opacity = k;
        for (const gh of g.ghosts) gh.visible = false;
        if (g.dying <= 0) {
          g.active = false;
          g.spr.visible = false;
        }
        continue;
      }
      glyphSteer(g.pos, g.vel, this.targets[g.slot], g.age, dt);
      // ghosts lag a few frames behind for a short golden streak
      g.trail[2].lerp(g.trail[1], Math.min(1, dt * 22));
      g.trail[1].lerp(g.trail[0], Math.min(1, dt * 22));
      g.trail[0].lerp(g.pos, Math.min(1, dt * 22));
      const base = g.big ? 1.7 : 1.15;
      const s = base * Math.min(1, g.age * 6) * (1 + 0.08 * Math.sin(this.time * 18 + g.age * 5));
      g.spr.position.copy(g.pos);
      g.spr.scale.set(s, s, 1);
      g.spr.material.opacity = 1;
      g.ghosts.forEach((gh, i) => {
        gh.position.copy(i === 0 ? g.pos : g.trail[i]);
        const gs = s * (i === 0 ? 1.7 : 1.0 - i * 0.12);
        gh.scale.set(gs, gs, 1);
      });
      if (g.pos.distanceTo(this.targets[g.slot]) < 0.6 || g.age > 2.4) g.dying = 0.22;
    }
    for (const p of this.palms) {
      if (!p.active) continue;
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const after = Math.max(0, p.t - p.dur);
      if (p.mode === 'drop') {
        // accelerate down, then a flattening slap that spreads and fades
        p.mesh.position.lerpVectors(p.from, p.to, k * k);
        p.mesh.position.y += 0.05;
        const s = p.scale * (3.2 + (after > 0 ? after * 4 : 0));
        p.mesh.scale.set(s, s, s);
      } else {
        p.mesh.position.lerpVectors(p.from, p.to, 1 - Math.pow(1 - k, 3));
        const s = p.scale * (1.2 + k * 1.3 + after * 2);
        p.mesh.scale.set(s, s, s);
      }
      const fade = after > 0 ? Math.max(0, 1 - after / p.hold) : Math.min(1, p.t * 8);
      p.mat.opacity = fade;
      p.glowMat.opacity = fade * 0.7;
      if (after >= p.hold) {
        p.active = false;
        p.mesh.visible = false;
      }
    }
    if (this.buddhaLife > 0) {
      this.buddhaLife -= dt;
      const t = 1 - this.buddhaLife / this.buddhaMax;
      const a = Math.min(1, t * 4) * Math.min(1, this.buddhaLife / 0.5);
      (this.buddhaSprite.material as THREE.SpriteMaterial).opacity = a * (0.9 + 0.1 * Math.sin(this.time * 6));
      const s = 8.5 + t * 3;
      this.buddhaSprite.scale.set(s * 0.8, s, 1);
      if (this.buddhaLife <= 0) this.buddhaSprite.visible = false;
    }
    for (const b of this.bells) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const t = 1 - b.life / b.max;
      b.hit = Math.max(0, b.hit - dt * 4);
      b.mat.uniforms.uOpacity.value = Math.min(1, t * 10) * Math.min(1, b.life / 0.25);
      b.mat.uniforms.uTime.value = this.time;
      b.mat.uniforms.uHit.value = b.hit;
      // drops over the monk, then hums slightly
      const drop = Math.max(0, 1 - t * 8);
      b.mesh.position.y += drop * 2;
      const pulse = 1 + Math.sin(this.time * 9) * 0.015 + b.hit * 0.08;
      b.mesh.scale.set(pulse, pulse, pulse);
      b.mesh.rotation.y += dt * 0.6;
      if (b.life <= 0) b.mesh.visible = false;
    }
    for (const z of this.zens) {
      if (z.life <= 0) continue;
      z.life -= dt;
      const t = 1 - z.life / z.max;
      const grow = 0.3 + 0.7 * (1 - Math.pow(1 - Math.min(1, t * 6), 3));
      z.mesh.scale.set(z.radius * grow, z.radius * grow, 1);
      z.mesh.rotation.z += dt * 0.35;
      z.mat.opacity = Math.min(1, z.life / 0.4) * (0.75 + 0.25 * Math.sin(this.time * 4));
      if (z.life <= 0) z.mesh.visible = false;
    }
  }
}
