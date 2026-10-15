import * as THREE from 'three';
import { GLTFLoader, MeshoptDecoder, SkeletonUtils } from 'three-stdlib';

// ==================================================================
// 天子 the hero's four imperial moves (EmperorFX owns one of these):
//   金口玉言  an imperial edict unrolls over his head and golden 跪 characters fly out at the enemy
//   御林冲阵  five spectral golden guardsmen charge past him with levelled spears
//   画地为牢  four red palace walls with yellow-glazed tiles rise round the target
//   玉玺镇压  a giant jade seal falls from the sky and leaves 受命于天 burnt into the ground
// Everything is pooled and allocated once; the guard model loads in the background the first time it's asked for.
// ==================================================================

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SERIF = '"Ma Shan Zheng","STXingkai","KaiTi","Noto Serif SC",serif';

/** the edict: yellow silk on two dark rollers, 奉天承运 皇帝诏曰 in columns and a great 跪 */
function edictTexture() {
  return canvasTex(1024, 352, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 352);
    grd.addColorStop(0, '#f6d25a');
    grd.addColorStop(0.5, '#ffe58a');
    grd.addColorStop(1, '#e8b83a');
    g.fillStyle = grd;
    g.fillRect(40, 20, 944, 312);
    // woven cloud pattern, very faint
    g.strokeStyle = 'rgba(180,120,20,0.25)';
    g.lineWidth = 2;
    for (let k = 0; k < 26; k++) {
      const x = 60 + ((k * 137) % 900);
      const y = 40 + ((k * 89) % 270);
      g.beginPath();
      g.arc(x, y, 14, 0, Math.PI * 1.5);
      g.arc(x + 16, y, 9, Math.PI, Math.PI * 2.3);
      g.stroke();
    }
    g.strokeStyle = '#a8231a';
    g.lineWidth = 6;
    g.strokeRect(58, 36, 908, 280);
    // rollers
    g.fillStyle = '#3a1608';
    g.fillRect(0, 8, 46, 336);
    g.fillRect(978, 8, 46, 336);
    g.fillStyle = '#d8a83a';
    g.fillRect(0, 0, 46, 14);
    g.fillRect(0, 338, 46, 14);
    g.fillRect(978, 0, 46, 14);
    g.fillRect(978, 338, 46, 14);
    // text, right to left in columns
    g.fillStyle = '#2a1206';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `64px ${SERIF}`;
    const cols = ['奉天承运', '皇帝诏曰'];
    cols.forEach((col, ci) => {
      [...col].forEach((ch, k) => g.fillText(ch, 900 - ci * 84, 78 + k * 64));
    });
    g.font = `230px ${SERIF}`;
    g.fillStyle = '#8a1a10';
    g.fillText('跪', 470, 186);
    // the imperial seal stamped in the corner
    g.fillStyle = 'rgba(190,20,20,0.85)';
    g.fillRect(150, 196, 96, 96);
    g.fillStyle = '#ffe58a';
    g.font = `38px ${SERIF}`;
    g.fillText('天子', 198, 224);
    g.fillText('之宝', 198, 266);
  });
}

/** a golden 跪 with a soft glow, for the flying characters */
function glyphTexture(ch: string) {
  return canvasTex(256, 256, (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `200px ${SERIF}`;
    g.shadowColor = 'rgba(255,190,60,1)';
    g.shadowBlur = 36;
    g.fillStyle = '#ffe9a0';
    g.fillText(ch, 128, 136);
    g.shadowBlur = 12;
    g.fillStyle = '#fff6d0';
    g.fillText(ch, 128, 136);
  });
}

/** 受命于天 既寿永昌 in a square border: the seal's imprint, red on transparent */
function imprintTexture() {
  return canvasTex(512, 512, (g) => {
    g.strokeStyle = 'rgba(210,30,20,0.95)';
    g.lineWidth = 26;
    g.strokeRect(30, 30, 452, 452);
    g.lineWidth = 8;
    g.strokeRect(64, 64, 384, 384);
    g.fillStyle = 'rgba(210,30,20,0.95)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `150px ${SERIF}`;
    const chars = ['受', '命', '于', '天', '既', '寿', '永', '昌'];
    // two columns of four would be the real thing; four big ones read better from above
    ['受命', '于天'].forEach((row, r) => [...row].forEach((ch, k) => g.fillText(ch, 170 + k * 172, 172 + r * 172)));
    void chars;
  });
}

interface Edict {
  scroll: THREE.Mesh;
  glyphs: THREE.Sprite[];
  t: number;
  pos: THREE.Vector3;
  yaw: number;
  active: boolean;
}
interface Charge {
  t: number;
  dur: number;
  pos: THREE.Vector3;
  yaw: number;
  active: boolean;
}
interface Cage {
  g: THREE.Group;
  t: number;
  dur: number;
  active: boolean;
}
interface SealDrop {
  g: THREE.Group;
  imprint: THREE.Mesh;
  t: number;
  fall: number;
  pos: THREE.Vector3;
  active: boolean;
  landed: boolean;
  onLand?: () => void;
}

const GUARDS = 5;
const GUARD_SLOTS: [number, number][] = [
  [0, 0],
  [-1.3, -0.9],
  [1.3, -0.9],
  [-2.6, -1.8],
  [2.6, -1.8],
];

export class ImperialFX {
  private root: THREE.Object3D;
  private edicts: Edict[] = [];
  private charges: Charge[] = [];
  private cages: Cage[] = [];
  private seals: SealDrop[] = [];
  private ghosts: { obj: THREE.Object3D; mixer: THREE.AnimationMixer; mats: THREE.Material[] }[][] = [];
  private ghostMat: THREE.MeshBasicMaterial;
  private loading = false;
  private v = new THREE.Vector3();
  /** set by the owner */
  dust?: (p: THREE.Vector3, n: number, color: string) => void;
  embers?: (p: THREE.Vector3, n: number, color: string) => void;

  constructor(root: THREE.Object3D) {
    this.root = root;
    const edictTex = edictTexture();
    const glyphTex = glyphTexture('跪');
    for (let k = 0; k < 2; k++) {
      const scroll = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.17), new THREE.MeshBasicMaterial({ map: edictTex, transparent: true, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
      scroll.visible = false;
      scroll.renderOrder = 15;
      const glyphs: THREE.Sprite[] = [];
      for (let i = 0; i < 7; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.6, 1.4, 0.9) }));
        sp.visible = false;
        sp.renderOrder = 16;
        glyphs.push(sp);
        root.add(sp);
      }
      root.add(scroll);
      this.edicts.push({ scroll, glyphs, t: 0, pos: new THREE.Vector3(), yaw: 0, active: false });
    }
    // the spectral guardsmen are cloned from the guard model once it has loaded
    this.ghostMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc94a').multiplyScalar(1.3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (let k = 0; k < 2; k++) this.charges.push({ t: 0, dur: 0.9, pos: new THREE.Vector3(), yaw: 0, active: false });
    // palace walls
    const wallMat = new THREE.MeshStandardMaterial({ color: '#9a2418', roughness: 0.8, emissive: '#3a0804', emissiveIntensity: 0.6 });
    const tileMat = new THREE.MeshStandardMaterial({ color: '#f0b020', metalness: 0.5, roughness: 0.35, emissive: '#7a4a00', emissiveIntensity: 0.7 });
    const baseMat = new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.9 });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd36a').multiplyScalar(1.8), toneMapped: false });
    const L = 5.4;
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      for (let s = 0; s < 4; s++) {
        const side = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(L + 0.5, 0.35, 0.55), baseMat);
        base.position.y = 0.17;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(L, 2.1, 0.36), wallMat);
        wall.position.y = 1.35;
        // a gabled cap of glazed tiles
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, L + 0.7, 3, 1), tileMat);
        cap.rotation.z = Math.PI / 2;
        cap.rotation.x = Math.PI / 6;
        cap.position.y = 2.55;
        cap.scale.set(1, 1, 1);
        const ridge = new THREE.Mesh(new THREE.BoxGeometry(L + 0.8, 0.06, 0.06), glowMat);
        ridge.position.y = 2.82;
        side.add(base, wall, cap, ridge);
        side.position.set(s === 0 ? 0 : s === 1 ? L / 2 : s === 2 ? 0 : -L / 2, 0, s === 0 ? L / 2 : s === 1 ? 0 : s === 2 ? -L / 2 : 0);
        side.rotation.y = s % 2 ? Math.PI / 2 : 0;
        g.add(side);
      }
      g.visible = false;
      root.add(g);
      this.cages.push({ g, t: 0, dur: 3, active: false });
    }
    // the jade seal: a block of green jade, a gold band, a coiled dragon on top; its imprint left on the ground
    const jade = new THREE.MeshStandardMaterial({ color: '#3fae7f', roughness: 0.15, metalness: 0.1, emissive: '#145a3a', emissiveIntensity: 0.9, transparent: true, opacity: 0.93 });
    const gold = new THREE.MeshStandardMaterial({ color: '#ffc84a', metalness: 0.8, roughness: 0.25, emissive: '#6a3a00', emissiveIntensity: 0.8 });
    const imprintTex = imprintTexture();
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      const block = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 2.4), jade);
      block.position.y = 0.65;
      const band = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.16, 2.5), gold);
      band.position.y = 1.2;
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.2, 10, 24), gold);
      coil.rotation.x = Math.PI / 2;
      coil.position.y = 1.55;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), gold);
      head.position.set(0, 1.95, 0.3);
      head.scale.set(1, 0.85, 1.4);
      for (const sg of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.45, 6), gold);
        horn.position.set(sg * 0.15, 2.2, 0.15);
        horn.rotation.x = -0.6;
        g.add(horn);
      }
      g.add(block, band, coil, head);
      g.visible = false;
      const imprint = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ map: imprintTex, transparent: true, depthWrite: false, toneMapped: false, color: new THREE.Color(1.4, 1.1, 1.0) }));
      imprint.rotation.x = -Math.PI / 2;
      imprint.visible = false;
      imprint.renderOrder = 11;
      root.add(g, imprint);
      this.seals.push({ g, imprint, t: 0, fall: 0.55, pos: new THREE.Vector3(), active: false, landed: false });
    }
  }

  /** load the guard model for the spectral charge (once, in the background) */
  preload() {
    if (this.loading || (globalThis as any).__TQ_NOGHOST) return; // tests on a software GPU skip the extra models

    this.loading = true;
    const base = (import.meta as any).env?.BASE_URL ?? '/';
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(typeof MeshoptDecoder === 'function' ? (MeshoptDecoder as any)() : MeshoptDecoder);
    loader.load(`${base}guard.glb`, (gm) => {
      loader.load(`${base}berserker.glb`, (bm) => {
        const run = bm.animations.find((c) => /^run/i.test(c.name));
        if (run) run.tracks = run.tracks.filter((t) => !/hips\.position/i.test(t.name)); // in place: the effect moves them
        gm.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gm.scene);
        const sc = 1.95 / Math.max(0.1, box.max.y - box.min.y);
        for (let k = 0; k < this.charges.length; k++) {
          const row: { obj: THREE.Object3D; mixer: THREE.AnimationMixer; mats: THREE.Material[] }[] = [];
          for (let i = 0; i < GUARDS; i++) {
            const obj = SkeletonUtils.clone(gm.scene);
            obj.scale.setScalar(sc);
            obj.traverse((o: any) => {
              if (o.isMesh) {
                o.material = this.ghostMat;
                o.frustumCulled = false;
                o.castShadow = false;
              }
            });
            // a levelled spear in the right hand
            let hand: THREE.Object3D | null = null;
            obj.traverse((o) => {
              if (!hand && /righthand$/i.test(o.name)) hand = o;
            });
            if (hand) {
              const spear = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.6, 6), this.ghostMat);
              spear.rotation.x = Math.PI / 2;
              spear.scale.setScalar(1 / sc);
              (hand as THREE.Object3D).add(spear);
            }
            const mixer = new THREE.AnimationMixer(obj);
            if (run) {
              const a = mixer.clipAction(run);
              a.play();
              a.time = Math.random() * run.duration;
              a.setEffectiveTimeScale(1.6);
            }
            obj.visible = false;
            this.root.add(obj);
            row.push({ obj, mixer, mats: [] });
          }
          this.ghosts.push(row);
        }
      });
    });
  }

  edict(pos: THREE.Vector3, yaw: number) {
    const E = this.edicts.find((e) => !e.active) ?? this.edicts[0];
    E.active = true;
    E.t = 0;
    E.pos.copy(pos);
    E.yaw = yaw;
    E.scroll.visible = true;
  }

  charge(pos: THREE.Vector3, yaw: number, dur: number) {
    const k = Math.max(0, this.charges.findIndex((c) => !c.active));
    const C = this.charges[k];
    C.active = true;
    C.t = 0;
    C.dur = dur;
    C.pos.copy(pos);
    C.yaw = yaw;
    if (!this.ghosts.length) this.preload();
    return k;
  }
  /** where guardsman `i` of charge `k` is at time t (for hit tests): runs forward from behind the caster */
  guardAt(k: number, i: number, out: THREE.Vector3, t?: number) {
    const C = this.charges[k];
    const tt = t ?? C.t;
    const [lat, back] = GUARD_SLOTS[i];
    const along = -2.2 + back + Math.min(1, tt / C.dur) * 17;
    const fx = Math.sin(C.yaw);
    const fz = Math.cos(C.yaw);
    return out.set(C.pos.x + fx * along + fz * lat, C.pos.y, C.pos.z + fz * along - fx * lat);
  }
  chargeActive(k: number) {
    return !!this.charges[k]?.active;
  }

  cage(pos: THREE.Vector3, dur: number) {
    const C = this.cages.find((c) => !c.active) ?? this.cages[0];
    C.active = true;
    C.t = 0;
    C.dur = dur;
    C.g.position.set(pos.x, pos.y - 2.9, pos.z);
    C.g.userData.y = pos.y;
    C.g.visible = true;
  }

  seal(pos: THREE.Vector3, fall: number, onLand: () => void) {
    const S = this.seals.find((s) => !s.active) ?? this.seals[0];
    S.active = true;
    S.landed = false;
    S.t = 0;
    S.fall = fall;
    S.pos.copy(pos);
    S.onLand = onLand;
    S.g.visible = true;
    S.g.rotation.y = Math.random() * Math.PI;
    S.imprint.visible = false;
  }

  update(dt: number, time: number) {
    // edicts: unroll over his head, the 跪 characters fly out
    for (const E of this.edicts) {
      if (!E.active) continue;
      E.t += dt;
      const fx = Math.sin(E.yaw);
      const fz = Math.cos(E.yaw);
      const open = Math.min(1, E.t / 0.22);
      const fade = E.t > 0.95 ? Math.max(0, 1 - (E.t - 0.95) / 0.3) : 1;
      E.scroll.position.set(E.pos.x + fx * 0.6, E.pos.y + 2.75, E.pos.z + fz * 0.6);
      E.scroll.rotation.set(0, E.yaw + Math.PI, 0); // faces back toward the camera behind him
      E.scroll.scale.set(Math.max(0.04, open), 1, 1);
      (E.scroll.material as THREE.MeshBasicMaterial).opacity = fade;
      E.glyphs.forEach((sp, i) => {
        const tt = E.t - 0.22 - i * 0.02;
        if (tt < 0 || tt > 0.6) {
          sp.visible = false;
          return;
        }
        sp.visible = true;
        const a = E.yaw + (i / (E.glyphs.length - 1) - 0.5) * 1.1;
        const d = 0.8 + tt * 13;
        sp.position.set(E.pos.x + Math.sin(a) * d, E.pos.y + 1.6 - tt * 0.6, E.pos.z + Math.cos(a) * d);
        const s = 0.9 + tt * 2.2;
        sp.scale.set(s, s, s);
        sp.material.opacity = Math.min(1, (0.6 - tt) / 0.2);
      });
      if (E.t > 1.25) {
        E.active = false;
        E.scroll.visible = false;
      }
    }
    // spectral guards
    this.charges.forEach((C, k) => {
      const row = this.ghosts[k];
      if (!C.active) {
        if (row) for (const g of row) g.obj.visible = false;
        return;
      }
      C.t += dt;
      const fade = Math.min(1, C.t / 0.12) * (C.t > C.dur - 0.2 ? Math.max(0, (C.dur - C.t) / 0.2) : 1);
      this.ghostMat.opacity = 0.6 * fade;
      for (let i = 0; i < GUARDS; i++) {
        const p = this.guardAt(k, i, this.v);
        if (row) {
          const g = row[i];
          g.obj.visible = true;
          g.obj.position.copy(p);
          g.obj.rotation.y = C.yaw;
          g.mixer.update(dt);
        }
        if (Math.random() < 0.12) this.dust?.(p, 1, '#e8d39a');
        if (Math.random() < 0.6) this.embers?.(this.v.set(p.x, p.y + 1 + Math.random(), p.z), 1, '#ffcf5a');
      }
      if (C.t >= C.dur) C.active = false;
    });
    // palace walls: rise, stand, sink
    for (const C of this.cages) {
      if (!C.active) continue;
      C.t += dt;
      const y0 = C.g.userData.y as number;
      const up = Math.min(1, C.t / 0.32);
      const down = C.t > C.dur ? Math.min(1, (C.t - C.dur) / 0.35) : 0;
      const ease = 1 - Math.pow(1 - up, 3);
      C.g.position.y = y0 - 2.9 * (1 - ease) - 2.9 * down + (up < 1 ? Math.sin(time * 60) * 0.03 : 0);
      if (C.t > C.dur + 0.35) {
        C.active = false;
        C.g.visible = false;
      }
    }
    // the jade seal falls, slams, then sinks; its imprint glows and fades
    for (const S of this.seals) {
      if (!S.active) continue;
      S.t += dt;
      if (!S.landed) {
        const u = Math.min(1, S.t / S.fall);
        S.g.position.set(S.pos.x, S.pos.y + 14 * (1 - u * u), S.pos.z);
        S.g.rotation.y += dt * 2;
        S.g.scale.setScalar(1);
        if (u >= 1) {
          S.landed = true;
          S.imprint.visible = true;
          S.imprint.position.set(S.pos.x, S.pos.y + 0.05, S.pos.z);
          S.imprint.rotation.z = S.g.rotation.y;
          S.onLand?.();
        }
      } else {
        const after = S.t - S.fall;
        // a squash on impact, then it sinks into the ground
        const squash = after < 0.12 ? 1 - Math.sin((after / 0.12) * Math.PI) * 0.12 : 1;
        S.g.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
        S.g.position.y = S.pos.y - (after > 0.7 ? (after - 0.7) * 2.4 : 0);
        if (after > 1.4) S.g.visible = false;
        const im = S.imprint.material as THREE.MeshBasicMaterial;
        im.opacity = Math.max(0, 1 - Math.max(0, after - 1.2) / 2);
        if (after > 3.2) {
          S.active = false;
          S.imprint.visible = false;
          S.g.visible = false;
        }
      }
    }
  }
}
