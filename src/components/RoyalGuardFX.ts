import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { BERSERKER_MODEL_URL, MODEL_URLS, buildSpear, loadGLB, removeRootMotion } from './CharacterRig3D';

// ----------------------------------------------------------------------
// 御林护驾 (皇上, key 5): four solid 御林军 in red lacquer and gilt, spears in hand, rise out of a column of
// gold light round the emperor and fight for him. The game owns where they are and what they're doing;
// this draws them: the guard model (霍岩's moves), a spear, a little HP bar over each, the gold light they
// come in on, and the sink back into the ground when their time is up.
// ----------------------------------------------------------------------

export type RoyalAnim = 'rise' | 'idle' | 'run' | 'atk' | 'hit' | 'die' | 'gone';

interface Slot {
  root: THREE.Group;
  body: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  acts: Partial<Record<RoyalAnim, THREE.AnimationAction>>;
  cur: RoyalAnim | '';
  mats: THREE.Material[];
  bar: THREE.Group;
  fill: THREE.Mesh;
  pillar: THREE.Mesh;
  used: boolean;
  heavy?: THREE.AnimationAction;
  swings: number;
  playing?: THREE.AnimationAction;
  lastSt: number;
}

export const ROYAL_SLOTS = 8;
const BAR_W = 0.9;

export class RoyalGuardFX {
  private slots: Slot[] = [];
  private loading = false;
  private eye = new THREE.Vector3();
  embers: ((p: THREE.Vector3, n: number, color: string) => void) | null = null;
  dust: ((p: THREE.Vector3) => void) | null = null;
  private v = new THREE.Vector3();

  constructor(root: THREE.Object3D) {
    const bg = new THREE.MeshBasicMaterial({ color: '#1a1410', transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false });
    const pillarMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd36a').multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const barGeo = new THREE.PlaneGeometry(1, 1);
    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.8, 4.5, 20, 1, true);
    pillarGeo.translate(0, 2.25, 0);
    for (let i = 0; i < ROYAL_SLOTS; i++) {
      const g = new THREE.Group();
      g.visible = false;
      const bar = new THREE.Group();
      const back = new THREE.Mesh(barGeo, bg);
      back.scale.set(BAR_W + 0.06, 0.13, 1);
      const fill = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: '#ffd36a', transparent: true, depthWrite: false, toneMapped: false }));
      fill.scale.set(BAR_W, 0.08, 1);
      fill.position.z = 0.005;
      bar.add(back, fill);
      bar.position.y = 2.25;
      bar.renderOrder = 5;
      const pillar = new THREE.Mesh(pillarGeo, pillarMat.clone());
      pillar.visible = false;
      g.add(bar, pillar);
      root.add(g);
      this.slots.push({ root: g, body: null, mixer: null, acts: {}, cur: '', mats: [], bar, fill, pillar, used: false, swings: 0, lastSt: 0 });
    }
  }

  /** the guard model and 霍岩's moves, once, in the background (the first time the emperor is in a match) */
  preload() {
    if (this.loading || (globalThis as any).__TQ_NOGHOST) return;
    this.loading = true;
    const url = MODEL_URLS.Guard;
    if (!url) return;
    Promise.all([loadGLB(url), loadGLB(BERSERKER_MODEL_URL)])
      .then(([gm, bm]) => {
        const clips = (bm.raw.length ? bm.raw : gm.raw).map(removeRootMotion);
        const pick = (re: RegExp) => clips.find((c) => re.test(c.name));
        // the clips are long takes; each move uses only its useful stretch (fractions of the clip), played to fit
        // the time the game gives it. The swing in "slash" is a third of the way into a 6.6 s take: played
        // from the start, a 0.75 s attack never got past the wind-up.
        const clipOf: Partial<Record<RoyalAnim, THREE.AnimationClip | undefined>> = {
          idle: pick(/^idle/i) ?? pick(/standing_relax/i),
          run: pick(/^run/i),
          atk: pick(/^slash/i) ?? pick(/^box_01/i),
          hit: pick(/hit_to_body_01/i),
          die: pick(/defeat/i),
          rise: pick(/^cheer/i) ?? pick(/^idle/i),
          gone: pick(/^bow/i) ?? pick(/^idle/i),
        };
        const heavy = pick(/^box_03/i);
        for (const S of this.slots) {
          const body = SkeletonUtils.clone(gm.scene);
          body.scale.setScalar(gm.scale);
          body.position.y = gm.floor;
          body.userData.floor = gm.floor;
          const mats: THREE.Material[] = [];
          body.traverse((o: any) => {
            if (!o.isMesh) return;
            o.frustumCulled = false;
            o.castShadow = true;
            const ms = (Array.isArray(o.material) ? o.material : [o.material]).map((m: THREE.Material) => {
              const c = m.clone() as THREE.MeshStandardMaterial;
              c.transparent = true; // fades in and out: kept on so the shader never changes mid-fight
              if (c.emissive) {
                c.emissive = new THREE.Color('#3a2400');
                c.emissiveIntensity = 0.5;
              }
              mats.push(c);
              return c;
            });
            o.material = Array.isArray(o.material) ? ms : ms[0];
          });
          let hand: THREE.Object3D | null = null;
          body.traverse((o) => {
            if (!hand && /righthand$/i.test(o.name)) hand = o;
          });
          if (hand) {
            const spear = buildSpear();
            spear.scale.setScalar(1 / gm.scale);
            spear.traverse((o: any) => {
              if (o.isMesh) {
                o.material = o.material.clone();
                o.material.transparent = true;
                mats.push(o.material);
              }
            });
            (hand as THREE.Object3D).add(spear);
          }
          S.root.add(body);
          S.body = body;
          S.mats = mats;
          S.mixer = new THREE.AnimationMixer(body);
          for (const k of Object.keys(clipOf) as RoyalAnim[]) {
            const c = clipOf[k];
            if (!c) continue;
            const a = S.mixer.clipAction(c);
            if (k === 'atk' || k === 'hit' || k === 'die' || k === 'rise' || k === 'gone') {
              a.setLoop(THREE.LoopOnce, 1);
              a.clampWhenFinished = true;
            }
            S.acts[k] = a;
          }
          if (heavy) {
            const a = S.mixer.clipAction(heavy);
            a.setLoop(THREE.LoopOnce, 1);
            a.clampWhenFinished = true;
            S.heavy = a;
          }
          S.cur = '';
        }
      })
      .catch(() => {
        this.loading = false; // try again next match
      });
  }

  setView(eye: THREE.Vector3) {
    this.eye.copy(eye);
  }

  /** a fresh slot for a new guardsman, or -1 */
  take() {
    const k = this.slots.findIndex((s) => !s.used);
    if (k < 0) return -1;
    const S = this.slots[k];
    S.used = true;
    S.cur = '';
    S.root.visible = true;
    return k;
  }
  release(k: number) {
    const S = this.slots[k];
    if (!S) return;
    S.used = false;
    S.root.visible = false;
    S.pillar.visible = false;
  }
  releaseAll() {
    for (let k = 0; k < this.slots.length; k++) this.release(k);
  }

  /**
   * Draw guardsman k: where he stands, which way he faces, what he's doing (and for how long, st), his HP
   * fraction, and how solid he is (fading in on the light and out into the ground).
   */
  set(k: number, x: number, y: number, z: number, yaw: number, anim: RoyalAnim, st: number, hp: number, alpha: number, dt: number) {
    const S = this.slots[k];
    if (!S || !S.used) return;
    // rising out of the ground on the light, and sinking back into it when he's dismissed
    const sink = anim === 'rise' ? -1.9 * Math.pow(Math.max(0, 1 - st / 0.45), 2) : anim === 'gone' ? -1.9 * Math.min(1, st / 0.6) : 0;
    S.root.position.set(x, y, z);
    if (S.body) {
      S.body.position.y = (S.body.userData.floor as number) + sink;
      S.body.rotation.y = yaw;
    }
    for (const m of S.mats) {
      m.opacity = alpha;
      m.depthWrite = alpha > 0.95;
    }
    // the light he comes in on
    const pl = anim === 'rise' ? Math.max(0, 1 - st / 0.7) : anim === 'gone' ? Math.max(0, 0.6 - st) : 0;
    S.pillar.visible = pl > 0.01;
    if (S.pillar.visible) {
      (S.pillar.material as THREE.MeshBasicMaterial).opacity = 0.7 * pl;
      S.pillar.scale.set(1 + (1 - pl) * 0.4, 1, 1 + (1 - pl) * 0.4);
    }
    // HP bar, turned to the camera
    S.bar.visible = anim !== 'die' && anim !== 'gone' && anim !== 'rise';
    if (S.bar.visible) {
      S.bar.rotation.y = Math.atan2(this.eye.x - x, this.eye.z - z);
      const f = Math.max(0, Math.min(1, hp));
      S.fill.scale.x = Math.max(0.001, BAR_W * f);
      S.fill.position.x = -(BAR_W * (1 - f)) / 2;
      (S.fill.material as THREE.MeshBasicMaterial).color.set(f > 0.5 ? '#ffd36a' : f > 0.25 ? '#ff9a2a' : '#ff4a3a');
    }
    // animation
    if (S.mixer) {
      if (anim !== S.cur || (anim === 'atk' && st < S.lastSt)) {
        // which stretch of which take, and how long the game gives it
        let next = S.acts[anim] ?? S.acts.idle;
        let from = 0;
        let to = 1;
        let fit = 0;
        if (anim === 'atk') {
          // a big two-handed cut with the spear (the swing in the middle of the "slash" take); every third
          // one a short hook (box_03). Measured: the cut carries the hand ~2.4 m, a jab only ~0.5 m.
          S.swings++;
          if (false && S.heavy) {
            next = S.heavy;
            from = 0.12;
            to = 0.47;
          } else {
            from = 0.25;
            to = 0.5;
          }
          fit = 0.62;
        } else if (anim === 'hit') {
          from = 0;
          to = 0.45;
          fit = 0.35;
        } else if (anim === 'rise') {
          from = 0.1;
          to = 0.6;
          fit = 0.55;
        }
        const prev = S.playing;
        if (next) {
          const D = next.getClip().duration;
          next.reset();
          next.time = from * D;
          next.setEffectiveTimeScale(anim === 'run' ? 1.25 : fit ? ((to - from) * D) / fit : 1);
          next.setEffectiveWeight(1);
          next.play();
          if (prev && prev !== next) next.crossFadeFrom(prev, 0.1, false);
          S.playing = next;
        }
        S.cur = anim;
      }
      S.lastSt = st;
      S.mixer.update(dt);
    }
    if (anim === 'rise' && st < 0.5 && Math.random() < 0.7) this.embers?.(this.v.set(x + (Math.random() - 0.5) * 1, y + Math.random() * 2.5, z + (Math.random() - 0.5) * 1), 1, '#ffd36a');
  }
}
