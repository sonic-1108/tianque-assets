import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { applyCharacterShading } from './characterShading';
import { collectLimbs, applyClimbPose, applySitPose, Limbs, applyDrinkPose } from './climbPose';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader, SkeletonUtils } from 'three-stdlib';
import { CombatantState, CharacterActionState, CharacterClassId } from '../types';

export const BERSERKER_MODEL_URL = `${import.meta.env.BASE_URL}berserker.glb`;
/** swim / climb borrowed by models that were exported without them (same Mixamo skeleton, rotations only) */
export const EXTRA_ANIMS_URL = `${import.meta.env.BASE_URL}anims_extra.glb`;
export const MODEL_URLS: Partial<Record<CharacterClassId, string>> = {
  Berserker: BERSERKER_MODEL_URL,
  Ranger: `${import.meta.env.BASE_URL}ranger.glb`,
  BuddhistMage: `${import.meta.env.BASE_URL}monk.glb`,
  Shadowblade: `${import.meta.env.BASE_URL}shadowblade.glb`,
  Emperor: `${import.meta.env.BASE_URL}emperor.glb`,
  Guard: `${import.meta.env.BASE_URL}guard.glb`, // 御林军 (until it's uploaded, 霍岩's body in red-and-gold armour) // 皇上: rigged on the same Mixamo skeleton; fights with 霍岩's moves
};
/** 影刃's throwing dagger (Tripo prop, laid along +Y with the grip at the origin; see tools/optimize-prop.mjs) */
export const DAGGER_URL = `${import.meta.env.BASE_URL}dagger.glb`;
/** 皇上's 天子剑 (Tripo prop, straightened by tools/optimize-prop.mjs: blade along +Y, origin in the grip) */
export const EMPEROR_SWORD_URL = `${import.meta.env.BASE_URL}emperor_sword.glb`;

/** Tripo / Mixamo models face +Z. Gameplay forward is -Z, so the visual is turned 180°. */
export const MODEL_YAW_OFFSET = Math.PI;
const TARGET_HEIGHT = 1.8;
const CLIP_FPS = 24;
const HIP_PIVOT = 0.95; // procedural lean / flip pivots around the hips, not the feet

export interface AnimationDebugInfo {
  allClips: string[];
  mappedStates: Record<string, string>;
  unmappedStates: string[];
  currentClip: string;
}

export interface ModelLoadProgress {
  loaded: number;
  total: number;
  progress: number;
  isLoading: boolean;
  error: string | null;
}

/** World-space blade markers the game reads every frame for weapon trails. */
export interface RigSockets {
  rightBase: THREE.Object3D | null;
  rightTip: THREE.Object3D | null;
  leftBase: THREE.Object3D | null;
  leftTip: THREE.Object3D | null;
  chest: THREE.Object3D | null;
  /** left hand bone: candles and the candle-shade are carried here */
  leftHand?: THREE.Object3D | null;
}

interface CharacterRigProps {
  classId?: CharacterClassId;
  combatantRef: React.MutableRefObject<CombatantState>;
  isPlayer: boolean;
  socketsRef?: React.MutableRefObject<RigSockets>;
  showBoneAxes?: boolean;
  onAnimationDebug?: (info: AnimationDebugInfo) => void;
  onLoadProgress?: (progress: ModelLoadProgress) => void;
}

// ------------------------------------------------------------------
// Animation plan: which clip (and which slice of it) drives each state.
// `hit` is the normalized clip time of the strike frame; `hitAt` is the
// moment (seconds into the action) the game registers the hit, so the
// clip is time-scaled to land the blow exactly then.
// ------------------------------------------------------------------
interface ClipSpec {
  match: string[];
  start?: number;
  end?: number;
  loop?: boolean;
  hit?: number;
  hitAt?: number;
  fit?: boolean; // stretch the slice to the action duration
  speed?: number;
}

const CLIP_PLAN: Record<string, ClipSpec> = {
  idle: { match: ['idle', 'standing_relax', 'wait', 'stand'], loop: true },
  run: { match: ['run', 'sprint', 'jog'], loop: true },
  walk: { match: ['walk'], loop: true },
  jump: { match: ['jump'], start: 0.0, end: 0.17 },
  dodge: { match: ['dive', 'roll', 'dodge', 'flip'], start: 0.36, end: 0.92, fit: true },
  block: { match: ['box_01', 'box', 'guard', 'block'], start: 0.02, end: 0.1, loop: true, speed: 0.4 },
  attack_1: { match: ['box_01', 'punch', 'attack', 'slash'], start: 0.1, end: 0.48, hit: 0.23, hitAt: 0.13 },
  attack_2: { match: ['box_03', 'box_02', 'punch', 'attack', 'slash'], start: 0.12, end: 0.47, hit: 0.26, hitAt: 0.13 },
  attack_3: { match: ['slash', 'heavy', 'attack'], start: 0.25, end: 0.5, hit: 0.315, hitAt: 0.22 },
  skill_1: { match: ['slash', 'slam', 'attack'], start: 0.25, end: 0.52, hit: 0.315, hitAt: 0.22 },
  skill_2: { match: ['box_03', 'box_02', 'spin', 'attack'], start: 0.15, end: 0.45, loop: true, speed: 1.6 },
  skill_3: { match: ['run', 'sprint'], loop: true, speed: 1.9 },
  skill_4: { match: ['angry_01', 'angry', 'roar', 'cheer'], start: 0.52, end: 0.82, fit: true },
  ult_air: { match: ['jump', 'flip'], start: 0.0, end: 0.17, fit: true },
  ult_slam: { match: ['slash', 'attack'], start: 0.27, end: 0.56, hit: 0.315, hitAt: 0.12 },
  hit_a: { match: ['hit_to_body_01', 'hit_to_body', 'hit', 'hurt'], start: 0.0, end: 0.75, fit: true },
  hit_b: { match: ['hit_to_side', 'hit_to_body_02', 'hit', 'hurt'], start: 0.0, end: 0.75, fit: true },
  launched: { match: ['hit_to_stomach', 'hit', 'fall'], start: 0.0, end: 0.6, fit: true },
  knockdown: { match: ['fall', 'death', 'die', 'defeat'], start: 0.36, end: 0.75, fit: true },
  getup: { match: ['fall'], start: 0.4, end: 0.75, speed: -2.2 },
  cheer: { match: ['cheer', 'victory'], start: 0.0, end: 0.45, loop: true },
  swim: { match: ['swim'], loop: true },
  climb: { match: ['climb'], loop: true },
};

/** 暗器 overrides: throws, flips, light footwork */
const RANGER_CLIP_PLAN: Record<string, ClipSpec> = {
  ...CLIP_PLAN,
  // throws: quick jab flick, hook flick, then a full overhand pitch for the 3-dart fan
  attack_1: { match: ['box_01', 'throw', 'punch'], start: 0.08, end: 0.32, fit: true },
  attack_2: { match: ['box_03', 'box_02', 'throw'], start: 0.12, end: 0.4, fit: true },
  attack_3: { match: ['pitch_baseball', 'throw', 'slash'], start: 0.3, end: 0.54, fit: true },
  r_kick: { match: ['front_kick_02', 'front_kick_01', 'kick', 'slash'], start: 0.05, end: 0.9, fit: true },
  skill_1: { match: ['slash', 'chop'], start: 0.22, end: 0.42, fit: true },
  skill_2: { match: ['pitch_baseball', 'chop', 'box_01'], start: 0.3, end: 0.54, fit: true },
  skill_3: { match: ['backflip', 'jump', 'dive'], start: 0.0, end: 0.3, fit: true },
  skill_4: { match: ['angry_02', 'agree', 'idle'], start: 0.0, end: 0.6, fit: true },
  r_rain: { match: ['box_01', 'box_03', 'punch'], start: 0.08, end: 0.32, loop: true, speed: 2.2 },
  r_flip: { match: ['flip', 'front_flip'], start: 0.33, end: 0.7, fit: true },
  dodge: { match: ['roll', 'dodge', 'dive', 'flip'], start: 0.36, end: 0.92, fit: true },
  knockdown: { match: ['fall', 'death', 'die', 'hit_to_stomach'], start: 0.35, end: 0.75, fit: true },
  getup: { match: ['fall'], start: 0.4, end: 0.75, speed: -2.2 },
  cheer: { match: ['cheer', 'victory', 'agree'], start: 0.0, end: 0.45, loop: true },
};
/** 梵音 overrides: jabs, palm thrusts, a stamp for the zen circle, praying hands, meditation */
const MONK_CLIP_PLAN: Record<string, ClipSpec> = {
  ...CLIP_PLAN,
  idle: { match: ['standing_relax', 'idle'], loop: true },
  attack_1: { match: ['box_01', 'punch'], start: 0.1, end: 0.48, hit: 0.23, hitAt: 0.11 },
  attack_2: { match: ['box_03', 'box_02', 'punch'], start: 0.12, end: 0.47, hit: 0.26, hitAt: 0.12 },
  // cast_a_spell: one arm drives straight out, palm forward
  attack_3: { match: ['cast_a_spell', 'box_02'], start: 0.28, end: 0.68, fit: true },
  skill_1: { match: ['cast_a_spell', 'box_02'], start: 0.3, end: 0.72, fit: true },
  // angry_01: both arms flung up and a stamp
  skill_2: { match: ['angry_01', 'angry'], start: 0.42, end: 0.8, fit: true },
  // clap: palms pressed together, the chant
  skill_3: { match: ['clap', 'bow', 'agree'], start: 0.08, end: 0.85, fit: true },
  skill_4: { match: ['angry_01', 'angry'], start: 0.3, end: 0.68, fit: true },
  // sit: legs folded under him, floated a little off the ground for 万佛朝宗
  m_ult: { match: ['sit', 'clap', 'idle'], start: 0.3, end: 0.75, loop: true, speed: 0.3 },
  dodge: { match: ['dive', 'roll', 'flip'], start: 0.36, end: 0.92, fit: true },
  cheer: { match: ['bow', 'cheer'], start: 0.0, end: 0.9, loop: true, speed: 0.6 },
};
/** 影刃 overrides: quick reverse-grip cuts, a throw, a vanishing crouch, a spell for the rewind */
const SHADOW_CLIP_PLAN: Record<string, ClipSpec> = {
  ...CLIP_PLAN,
  idle: { match: ['standing_relax', 'idle'], loop: true },
  attack_1: { match: ['box_01', 'slash'], start: 0.08, end: 0.4, fit: true },
  attack_2: { match: ['box_03', 'box_02', 'slash'], start: 0.12, end: 0.42, fit: true },
  attack_3: { match: ['slash', 'chop'], start: 0.25, end: 0.52, fit: true },
  skill_1: { match: ['slash', 'chop'], start: 0.28, end: 0.5, fit: true },
  skill_2: { match: ['pitch_baseball', 'shoot'], start: 0.3, end: 0.56, fit: true },
  skill_3: { match: ['jump_down', 'dive'], start: 0.0, end: 0.35, fit: true },
  skill_4: { match: ['cast_a_spell', 'agree'], start: 0.25, end: 0.6, fit: true },
  s_ult: { match: ['slash', 'chop'], start: 0.25, end: 0.5, loop: true, speed: 2.2 },
  r_flip: { match: ['flip'], start: 0.33, end: 0.7, fit: true },
  dodge: { match: ['dive', 'roll', 'flip'], start: 0.36, end: 0.92, fit: true },
  cheer: { match: ['swagger', 'agree', 'cheer'], start: 0.0, end: 0.8, loop: true },
};
const planFor = (c: CharacterClassId) => (c === 'Ranger' ? RANGER_CLIP_PLAN : c === 'BuddhistMage' ? MONK_CLIP_PLAN : c === 'Shadowblade' ? SHADOW_CLIP_PLAN : CLIP_PLAN);

interface BuiltClip {
  key: string;
  clip: THREE.AnimationClip;
  source: string;
  spec: ClipSpec;
}

function removeRootMotion(clip: THREE.AnimationClip): THREE.AnimationClip {
  const c = clip.clone();
  c.tracks.forEach((track) => {
    const n = track.name.toLowerCase();
    if (n.endsWith('.position') && (n.includes('hips') || n.includes('root') || n.includes('pelvis'))) {
      const v = track.values;
      const x0 = v[0], y0 = v[1], z0 = v[2];
      // climbing hauls the hips upward in place of root motion: keep them level, the game moves the body
      const flatY = clip.name.toLowerCase().startsWith('climb');
      for (let i = 0; i < v.length; i += 3) {
        v[i] = x0;
        if (flatY) v[i + 1] = y0;
        v[i + 2] = z0;
      }
    }
  });
  return c;
}

function buildClips(raw: THREE.AnimationClip[], plan: Record<string, ClipSpec> = CLIP_PLAN) {
  const cleaned = raw.map(removeRootMotion);
  const built: Record<string, BuiltClip> = {};
  const unmapped: string[] = [];
  for (const [key, spec] of Object.entries(plan)) {
    let src: THREE.AnimationClip | undefined;
    for (const m of spec.match) {
      src = cleaned.find((c) => c.name.toLowerCase().replace(/\.\d+$/, '') === m) || cleaned.find((c) => c.name.toLowerCase().includes(m));
      if (src) break;
    }
    if (!src) {
      unmapped.push(key);
      continue;
    }
    let clip = src;
    const isPlanned = spec.start !== undefined && spec.end !== undefined;
    if (isPlanned) {
      const totalFrames = Math.round(src.duration * CLIP_FPS);
      const a = Math.max(0, Math.floor(spec.start! * totalFrames));
      const b = Math.min(totalFrames, Math.max(a + 2, Math.ceil(spec.end! * totalFrames)));
      clip = THREE.AnimationUtils.subclip(src, `${key}`, a, b, CLIP_FPS);
    } else {
      clip = src.clone();
      clip.name = key;
    }
    built[key] = { key, clip, source: src.name, spec };
  }
  return { built, unmapped, all: raw.map((c) => c.name) };
}

// ------------------------------------------------------------------
// Dual cleaver: blade along +Y, width along X, thickness along Z.
// ------------------------------------------------------------------
/** 冕冠: the emperor's crown, a flat black-and-gold board over a cap, twelve strings of jade beads front and back */
function buildCrown() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: '#e8b84a', metalness: 0.9, roughness: 0.3, emissive: new THREE.Color('#3a2400') });
  const lacquer = new THREE.MeshStandardMaterial({ color: '#1a1410', metalness: 0.2, roughness: 0.5 });
  const jade = new THREE.MeshStandardMaterial({ color: '#b8f0d0', metalness: 0.1, roughness: 0.25, emissive: new THREE.Color('#1c4030') });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.1, 16), gold);
  cap.position.y = 0.02;
  g.add(cap);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.018, 0.36), lacquer);
  board.position.y = 0.085;
  g.add(board);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.008, 0.37), gold);
  trim.position.y = 0.097;
  g.add(trim);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), gold);
  pin.rotation.x = Math.PI / 2;
  pin.position.y = 0.04;
  g.add(pin);
  const bead = new THREE.SphereGeometry(0.009, 6, 4);
  const str = new THREE.CylinderGeometry(0.0015, 0.0015, 0.09, 3);
  const strMat = new THREE.MeshBasicMaterial({ color: '#2a1d10' });
  for (const end of [-1, 1])
    for (let k = 0; k < 6; k++) {
      const x = -0.075 + k * 0.03;
      const z = end * 0.175;
      const s = new THREE.Mesh(str, strMat);
      s.position.set(x, 0.035, z);
      g.add(s);
      for (let b = 0; b < 3; b++) {
        const m = new THREE.Mesh(bead, jade);
        m.position.set(x, 0.065 - b * 0.03, z);
        g.add(m);
      }
    }
  return g;
}

/** 御林军 spear: a 2.4 m shaft, gilt ferrules, a leaf blade and a red horsehair tassel; held at the middle */
function buildSpear() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#4a1e12', roughness: 0.6 });
  const gold = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.9, roughness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: '#d8dde4', metalness: 0.95, roughness: 0.2 });
  const red = new THREE.MeshStandardMaterial({ color: '#b3121b', roughness: 0.8 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 2.4, 8), wood);
  shaft.position.y = 0.3;
  g.add(shaft);
  for (const y of [1.48, -0.88]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 8), gold);
    f.position.y = y;
    g.add(f);
  }
  const blade = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.34, 4), steel);
  blade.scale.set(1, 1, 0.35);
  blade.position.y = 1.68;
  g.add(blade);
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 10, 1, true), red);
  tassel.rotation.x = Math.PI;
  tassel.position.y = 1.42;
  g.add(tassel);
  // laid along the hand's fingers like the blades: shaft runs across the fist
  g.rotation.set(0, 0, Math.PI / 2);
  g.position.set(0, 0.08, 0.03);
  return g;
}

function buildCleaver(glow: THREE.Color) {
  const group = new THREE.Group();

  const blade = new THREE.Shape();
  blade.moveTo(-0.028, 0.0);
  blade.lineTo(0.03, 0.0);
  blade.bezierCurveTo(0.075, 0.25, 0.085, 0.5, 0.05, 0.74);
  blade.lineTo(0.0, 0.8);
  blade.bezierCurveTo(-0.03, 0.62, -0.035, 0.3, -0.028, 0.0);
  const bladeGeo = new THREE.ExtrudeGeometry(blade, {
    depth: 0.012,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.008,
    bevelSegments: 3,
    curveSegments: 24,
  });
  bladeGeo.translate(0, 0, -0.006);
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.95, roughness: 0.22, envMapIntensity: 1.4 });
  const bladeMesh = new THREE.Mesh(bladeGeo, steel);
  bladeMesh.position.y = 0.11;
  bladeMesh.castShadow = true;

  // fuller groove glow (subtle, pulses with blood rage)
  const fullerGeo = new THREE.PlaneGeometry(0.012, 0.5);
  const fullerMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const fuller = new THREE.Mesh(fullerGeo, fullerMat);
  fuller.position.set(0.012, 0.42, 0.013);
  fuller.name = 'fuller';

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.025, 0.045),
    new THREE.MeshStandardMaterial({ color: '#3b2a1c', metalness: 0.6, roughness: 0.45 })
  );
  guard.position.y = 0.1;
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.019, 0.17, 12),
    new THREE.MeshStandardMaterial({ color: '#2a1a12', metalness: 0.1, roughness: 0.85 })
  );
  grip.position.y = 0.01;
  const pommel = new THREE.Mesh(
    new THREE.SphereGeometry(0.024, 12, 10),
    new THREE.MeshStandardMaterial({ color: '#8a6a3a', metalness: 0.8, roughness: 0.35 })
  );
  pommel.position.y = -0.085;

  const base = new THREE.Object3D();
  base.position.y = 0.16;
  base.name = 'bladeBase';
  const tip = new THREE.Object3D();
  tip.position.y = 0.88;
  tip.name = 'bladeTip';

  group.add(bladeMesh, fuller, guard, grip, pommel, base, tip);
  return { group, base, tip, fullerMat, steel };
}

// Short throwing knife held by 暗器 (blade along +Y)
function buildKnife(glow: THREE.Color) {
  const group = new THREE.Group();
  const blade = new THREE.Shape();
  blade.moveTo(-0.018, 0);
  blade.lineTo(0.018, 0);
  blade.lineTo(0.012, 0.2);
  blade.lineTo(0, 0.26);
  blade.lineTo(-0.012, 0.2);
  blade.closePath();
  const geo = new THREE.ExtrudeGeometry(blade, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 2 });
  geo.translate(0, 0, -0.003);
  const steel = new THREE.MeshStandardMaterial({ color: '#e3e9ef', metalness: 0.95, roughness: 0.2 });
  const b = new THREE.Mesh(geo, steel);
  b.position.y = 0.06;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8), new THREE.MeshStandardMaterial({ color: '#1f4d48', roughness: 0.7 }));
  grip.position.y = 0.01;
  const tassel = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: glow }));
  tassel.position.y = -0.045;
  const base = new THREE.Object3D();
  base.position.y = 0.08;
  const tip = new THREE.Object3D();
  tip.position.y = 0.33;
  group.add(b, grip, tassel, base, tip);
  const fullerMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0 });
  return { group, base, tip, fullerMat, steel };
}

// 影刃's dagger: the Tripo prop, shared geometry, loaded once (blade along +Y, grip at the origin)
let daggerProto: Promise<THREE.Object3D> | null = null;
function daggerModel() {
  if (!daggerProto)
    daggerProto = new Promise((resolve, reject) =>
      new GLTFLoader().load(
        DAGGER_URL,
        (g) => {
          g.scene.traverse((o: any) => {
            if (o.isMesh) o.castShadow = true;
          });
          const box = new THREE.Box3().setFromObject(g.scene);
          const len = Math.max(0.01, box.max.y - box.min.y);
          g.scene.scale.setScalar(0.32 / len); // about 32 cm from pommel to point
          resolve(g.scene);
        },
        undefined,
        reject
      )
    );
  return daggerProto;
}
let swordProto: Promise<THREE.Object3D> | null = null;
function swordModel() {
  if (!swordProto)
    swordProto = new Promise((resolve, reject) =>
      new GLTFLoader().load(
        EMPEROR_SWORD_URL,
        (g) => {
          g.scene.traverse((o: any) => {
            if (o.isMesh) {
              o.castShadow = true;
              // a little self-light so the gilt and the blade catch the eye at night
              const m = (o.material as THREE.MeshStandardMaterial).clone();
              m.emissive = new THREE.Color('#ffffff');
              m.emissiveMap = m.map;
              m.emissiveIntensity = 0.18;
              o.material = m;
            }
          });
          const box = new THREE.Box3().setFromObject(g.scene);
          g.scene.scale.setScalar(1.05 / Math.max(0.01, box.max.y - box.min.y)); // about 1 m from pommel to point
          resolve(g.scene);
        },
        undefined,
        reject
      )
    );
  return swordProto;
}
function buildImperialSword(glow: THREE.Color) {
  const group = new THREE.Group();
  swordModel()
    .then((proto) => group.add(proto.clone()))
    .catch(() => group.add(buildCleaver(glow).group)); // missing file: a cleaver stands in
  const base = new THREE.Object3D();
  base.position.y = 0.2;
  const tip = new THREE.Object3D();
  tip.position.y = 0.88;
  group.add(base, tip);
  const fullerMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c8d3de', metalness: 0.9, roughness: 0.25 });
  return { group, base, tip, fullerMat, steel };
}

function buildDagger(glow: THREE.Color) {
  const group = new THREE.Group();
  daggerModel()
    .then((proto) => group.add(proto.clone()))
    .catch(() => group.add(buildKnife(glow).group)); // missing file: a plain knife stands in
  const base = new THREE.Object3D();
  base.position.y = 0.08;
  const tip = new THREE.Object3D();
  tip.position.y = 0.27;
  group.add(base, tip);
  const fullerMat = new THREE.MeshBasicMaterial({ color: glow, transparent: true, opacity: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c8d3de', metalness: 0.9, roughness: 0.25 });
  return { group, base, tip, fullerMat, steel };
}

// ------------------------------------------------------------------
// Asset cache
// ------------------------------------------------------------------
interface LoadedAsset {
  scene: THREE.Group;
  raw: THREE.AnimationClip[];
  built: Record<string, BuiltClip>;
  unmapped: string[];
  all: string[];
  scale: number;
  floor: number;
  url: string;
  fallback?: boolean;
}
const assetCache = new Map<string, LoadedAsset>();
const assetPromises = new Map<string, Promise<LoadedAsset>>();
/** progress listeners per model url, so one fighter's download never drives the other's loading screen */
const progressListeners = new Set<{ url: string; fn: (p: ModelLoadProgress) => void }>();

function loadGLB(url: string): Promise<LoadedAsset> {
  const hit = assetPromises.get(url);
  if (hit) return hit;
  const p = new Promise<LoadedAsset>((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const h = Math.max(0.1, box.max.y - box.min.y);
        const scale = TARGET_HEIGHT / h;
        const a: LoadedAsset = { scene: gltf.scene, raw: gltf.animations || [], built: {}, unmapped: [], all: (gltf.animations || []).map((c) => c.name), scale, floor: -box.min.y * scale, url };
        assetCache.set(url, a);
        resolve(a);
      },
      (xhr) => {
        // compressed transfers can report loaded > total, so clamp
        const pct = xhr.total > 0 ? Math.min(99, Math.round((xhr.loaded / xhr.total) * 100)) : 50;
        progressListeners.forEach((l) => l.url === url && l.fn({ loaded: xhr.loaded, total: xhr.total, progress: pct, isLoading: true, error: null }));
      },
      (err) => {
        assetPromises.delete(url);
        reject(err instanceof Error ? err : new Error('模型加载失败，请检查网络连接'));
      }
    );
  });
  assetPromises.set(url, p);
  return p;
}

/** Load the class model; if it is missing (not uploaded yet), fall back to the berserker model */
function loadAssetFor(classId: CharacterClassId): Promise<LoadedAsset & { fallback: boolean }> {
  const url = MODEL_URLS[classId] || BERSERKER_MODEL_URL;
  return loadGLB(url)
    .then((a) => ({ ...a, fallback: false }))
    .catch((e) => {
      if (url === BERSERKER_MODEL_URL) throw e;
      return loadGLB(BERSERKER_MODEL_URL).then((a) => ({ ...a, fallback: true }));
    });
}

const normBone = (n: string) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

const ONE_SHOT = new Set<string>(['r_kick', 'r_flip', 'getup', 'attack_1', 'attack_2', 'attack_3', 'skill_1', 'skill_4', 'dodge', 'hit_a', 'hit_b', 'launched', 'knockdown', 'ult_air', 'ult_slam', 'jump']);

export function CharacterRig3D({ combatantRef, classId = 'Berserker', isPlayer, socketsRef, showBoneAxes, onAnimationDebug, onLoadProgress }: CharacterRigProps) {
  const [rawAsset, setRawAsset] = useState<LoadedAsset | null>(null);
  // clips are built per class (each class maps its own slices)
  const asset = useMemo(() => {
    if (!rawAsset) return null;
    const { built, unmapped } = buildClips(rawAsset.raw, planFor(classId));
    return { ...rawAsset, built, unmapped } as LoadedAsset;
  }, [rawAsset, classId]);
  const restQuats = useRef<{ neck?: THREE.Quaternion; head?: THREE.Quaternion; neckBone?: THREE.Bone; headBone?: THREE.Bone }>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  const poseRootRef = useRef<THREE.Group>(null); // procedural whole-body motion (never touches bones)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const currentKeyRef = useRef('');
  const lastStateRef = useRef<CharacterActionState>('idle');
  const lastTimerRef = useRef(0);
  const getupRef = useRef(0);
  const hitVariantRef = useRef(0);
  const strafeYawRef = useRef(0);
  const spinRef = useRef(0);
  const flipRef = useRef(0);
  const leanRef = useRef(new THREE.Vector2());
  const weaponScaledRef = useRef(false);
  const materialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  /** 飞虫沙暴: world height above which the body is gone (99 = whole) */
  const cutU = useMemo(() => ({ value: 99 }), []);
  const eatenRef = useRef(false);
  const climbKickRef = useRef(-1);
  const sitBlendRef = useRef(0);
  const drinkBlendRef = useRef(0);
  const castRef = useRef(true);
  const stealthRef = useRef(1);
  const lastOpRef = useRef(1);
  const limbsRef = useRef<Limbs | null>(null);
  const ladderBlendRef = useRef(0);
  const ladderPhaseRef = useRef(0);
  const lastLadderYRef = useRef(0);
  const ladderFwd = useMemo(() => new THREE.Vector3(), []);
  const crownRef = useRef<THREE.Group | null>(null);
  const spearRef = useRef<THREE.Group | null>(null);
  const faceLight = useRef<THREE.PointLight>(null);
  const weaponsRef = useRef<{ right?: ReturnType<typeof buildCleaver> | ReturnType<typeof buildKnife>; left?: ReturnType<typeof buildCleaver> | ReturnType<typeof buildKnife> }>({});

  useEffect(() => {
    let alive = true;
    const listener = { url: MODEL_URLS[classId] || BERSERKER_MODEL_URL, fn: (p: ModelLoadProgress) => onLoadProgress?.(p) };
    progressListeners.add(listener);
    onLoadProgress?.({ loaded: 0, total: 100, progress: 5, isLoading: true, error: null });
    loadAssetFor(classId)
      // 皇上 brought only a few gestures of his own (angry_01, agree…): every fighting move is borrowed from 霍岩 (same skeleton)
      .then((a) => (classId === 'Emperor' && !a.fallback ? loadGLB(BERSERKER_MODEL_URL).then((b) => ({ ...a, raw: [...a.raw, ...b.raw] })).catch(() => a) : a))
      .then((a) => (a.raw.some((c) => c.name.toLowerCase().startsWith('swim')) ? a : loadGLB(EXTRA_ANIMS_URL).then((e) => ({ ...a, raw: [...a.raw, ...e.raw] })).catch(() => a)))
      .then((a) => {
        if (!alive) return;
        setRawAsset(a);
        onLoadProgress?.({ loaded: 100, total: 100, progress: 100, isLoading: false, error: null });
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e?.message || '无法装载角色模型';
        setLoadError(msg);
        onLoadProgress?.({ loaded: 0, total: 100, progress: 0, isLoading: true, error: msg });
      });
    return () => {
      alive = false;
      progressListeners.delete(listener);
    };
  }, [onLoadProgress, classId]);

  // Per-instance clone: own skeleton, own materials (original textures kept intact)
  const model = useMemo(() => {
    if (!asset) return null;
    const cloned = SkeletonUtils.clone(asset.scene) as THREE.Group;
    const mats: THREE.MeshStandardMaterial[] = [];
    cloned.traverse((o: any) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        if (asset.fallback && classId === 'Ranger') {
          // 沈惊鸿 model not uploaded yet: borrow 霍岩's body with a jade tint
          m.color = new THREE.Color(isPlayer ? '#9fe0d6' : '#c4b5fd');
        } else if (asset.fallback && classId === 'BuddhistMage') {
          // 了尘 model not uploaded yet: borrow 霍岩's body in saffron
          m.color = new THREE.Color(isPlayer ? '#f0c27a' : '#d8c4ff');
        }
        m.emissive = new THREE.Color('#000000');
        if (classId === 'Guard' && asset.fallback) {
          // stand-in 御林军: dark crimson lacquer and gilt
          const lum = m.color.r * 0.3 + m.color.g * 0.59 + m.color.b * 0.11;
          m.color = new THREE.Color(lum > 0.45 ? '#c9a24a' : '#7a1c16').multiplyScalar(0.6 + lum * 0.6);
          m.metalness = Math.max(m.metalness ?? 0, 0.3);
          m.roughness = Math.min(m.roughness ?? 1, 0.6);
        }
        if (classId === 'Emperor' && !asset.fallback) {
          // 皇上's own model: a touch of self-light so his face reads under the night sky
          m.emissive = new THREE.Color('#ffffff');
          m.emissiveMap = m.map;
          m.emissiveIntensity = 0.22;
          m.envMapIntensity = 1.4;
        }
        if (classId === 'Emperor' && asset.fallback) {
          // no model yet: 龙袍: everything goes imperial yellow and gold
          const lum = m.color.r * 0.3 + m.color.g * 0.59 + m.color.b * 0.11;
          m.color = new THREE.Color('#f2c14a').multiplyScalar(0.55 + lum * 0.9);
          m.emissive = new THREE.Color('#3a2400');
          m.metalness = Math.max(m.metalness ?? 0, 0.35);
          m.roughness = Math.min(m.roughness ?? 1, 0.55);
          m.envMapIntensity = 1.5;
        }
        if (classId === 'BuddhistMage' && !asset.fallback) {
          // 金身: let the gilded skin catch the light
          m.envMapIntensity = 1.6;
          m.roughness = Math.min(m.roughness ?? 1, 0.85);
        }
        applyCharacterShading(m, isPlayer, classId === 'BuddhistMage' && !asset.fallback, cutU);
        o.material = m;
        mats.push(m);
      }
    });
    materialsRef.current = mats;
    if (classId === 'Emperor') cloned.scale.multiplyScalar(1.14); // a head taller than anyone on the roofs
    return cloned;
  }, [asset, isPlayer, classId]);

  // Mixer, bones, weapons
  useEffect(() => {
    if (!model || !asset) return;
    const mixer = new THREE.AnimationMixer(model);
    mixerRef.current = mixer;
    const actions: Record<string, THREE.AnimationAction> = {};
    for (const [key, b] of Object.entries(asset.built)) {
      const a = mixer.clipAction(b.clip);
      a.setLoop(b.spec.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !b.spec.loop;
      actions[key] = a;
    }
    actionsRef.current = actions;
    limbsRef.current = collectLimbs(model);
    currentKeyRef.current = '';
    if (actions.idle) {
      actions.idle.play();
      currentKeyRef.current = 'idle';
    }

    const bones: Record<string, THREE.Bone> = {};
    model.traverse((o: any) => {
      if (o.isBone) bones[normBone(o.name)] = o;
    });

    const ranger = classId === 'Ranger';
    const shadow = classId === 'Shadowblade';
    const glow = new THREE.Color(classId === 'Emperor' ? '#ffd36a' : ranger ? (isPlayer ? '#2dd4bf' : '#a78bfa') : shadow ? (isPlayer ? '#22d3ee' : '#c084fc') : isPlayer ? '#ff3b1f' : '#7dd3fc');
    const right = ranger ? buildKnife(glow) : shadow ? buildDagger(glow) : classId === 'Emperor' ? buildImperialSword(glow) : buildCleaver(glow);
    const left = ranger ? buildKnife(glow) : shadow ? buildDagger(glow) : buildCleaver(glow);
    if (ranger) left.group.visible = false; // 暗器: one knife in the right hand, the rest fly
    if (classId === 'BuddhistMage') right.group.visible = left.group.visible = false; // 梵音 fights bare-handed
    let spear: THREE.Group | null = null;
    if (classId === 'Guard') {
      // 长枪: a long red-tasselled spear in the right hand instead of blades
      right.group.visible = left.group.visible = false;
      spear = buildSpear();
      if (bones.righthand) bones.righthand.add(spear);
    }
    spearRef.current = spear;
    let crown: THREE.Group | null = null;
    if (classId === 'Emperor') {
      // 天子剑: one gilded blade (and, only while his own model is missing, a stand-in 冕冠)
      left.group.visible = false;
      right.group.traverse((o: any) => {
        if (o.isMesh && o.material?.isMeshStandardMaterial) {
          o.material = o.material.clone();
          o.material.color = new THREE.Color('#ffd36a');
          o.material.metalness = 1;
          o.material.roughness = 0.25;
        }
      });
      if (asset.fallback) {
        crown = buildCrown();
        if (bones.head) bones.head.add(crown);
      }
    }
    crownRef.current = crown;
    // Hand-local frame (Mixamo): +Y runs along the fingers, the knuckle line is X.
    // The blade leaves the fist on the index-finger side: -X for the right hand, +X for the left.
    right.group.rotation.set(0, 0, Math.PI / 2);
    right.group.position.set(0.0, 0.075, 0.025);
    left.group.rotation.set(Math.PI, 0, -Math.PI / 2);
    left.group.position.set(0.0, 0.075, 0.025);
    if (shadow) {
      // 影刃 holds both daggers in a reverse grip: the blade leaves the fist on the little-finger side
      right.group.rotation.set(0, 0, -Math.PI / 2);
      left.group.rotation.set(Math.PI, 0, Math.PI / 2);
    }
    if (bones.righthand) bones.righthand.add(right.group);
    if (bones.lefthand) bones.lefthand.add(left.group);
    weaponsRef.current = { right, left };
    weaponScaledRef.current = false;

    // Neck / head rest pose: Tripo auto-rigs pull the face out of shape when these
    // bones rotate a lot, so each frame the animated rotation is eased back toward rest.
    const neckBone = bones.neck;
    const headBone = bones.head;
    restQuats.current = {
      neckBone,
      headBone,
      neck: neckBone?.quaternion.clone(),
      head: headBone?.quaternion.clone(),
    };

    if (showBoneAxes) {
      bones.righthand?.add(new THREE.AxesHelper(0.25));
      bones.lefthand?.add(new THREE.AxesHelper(0.25));
    }

    if (socketsRef) {
      socketsRef.current = {
        rightBase: right.base,
        rightTip: right.tip,
        leftBase: left.base,
        leftTip: left.tip,
        chest: bones.spine2 || bones.spine1 || null,
        leftHand: bones.lefthand || null,
      };
    }

    if (isPlayer && onAnimationDebug) {
      const mapped: Record<string, string> = {};
      Object.values(asset.built).forEach((b) => (mapped[b.key] = b.source));
      onAnimationDebug({ allClips: asset.all, mappedStates: mapped, unmappedStates: asset.unmapped, currentClip: 'idle' });
    }

    return () => {
      mixer.stopAllAction();
      right.group.removeFromParent();
      left.group.removeFromParent();
      crown?.removeFromParent();
      spear?.removeFromParent();
    };
  }, [model, asset, isPlayer, socketsRef, onAnimationDebug, showBoneAxes, classId]);

  const play = (key: string, fade: number, timeScale: number) => {
    const actions = actionsRef.current;
    const next = actions[key];
    if (!next) return false;
    const prev = actions[currentKeyRef.current];
    if (prev && prev !== next) prev.fadeOut(fade);
    next.reset();
    if (timeScale < 0) next.time = next.getClip().duration; // reversed clip (getting up from a fall)
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(timeScale);
    next.fadeIn(fade).play();
    currentKeyRef.current = key;
    if (isPlayer && onAnimationDebug && asset) {
      const mapped: Record<string, string> = {};
      Object.values(asset.built).forEach((b) => (mapped[b.key] = b.source));
      onAnimationDebug({ allClips: asset.all, mappedStates: mapped, unmappedStates: asset.unmapped, currentClip: `${key} ← ${asset.built[key]?.source ?? '?'}` });
    }
    return true;
  };

  const timeScaleFor = (key: string, stateDuration: number) => {
    const b = asset?.built[key];
    if (!b) return 1;
    const spec = b.spec;
    if (spec.hit !== undefined && spec.hitAt && spec.start !== undefined) {
      const srcDur = b.clip.duration / Math.max(0.0001, (spec.end ?? 1) - spec.start);
      return Math.max(0.3, ((spec.hit - spec.start) * srcDur) / spec.hitAt);
    }
    if (spec.fit && stateDuration > 0) return Math.max(0.3, b.clip.duration / stateDuration);
    return spec.speed ?? 1;
  };

  useFrame((_, rawDelta) => {
    const c = combatantRef.current;
    const mixer = mixerRef.current;
    const pose = poseRootRef.current;
    if (!c || !mixer || !pose || !asset) return;
    const delta = c.hitStopTimer > 0 ? rawDelta * 0.08 : rawDelta;
    {
      // 飞虫沙暴: dissolve from the head down; the parts already gone cast no shadow, the weapons go with the hands
      const dv = c.devoured ?? 0;
      cutU.value = dv > 0 ? c.pos[1] + 1.95 - dv * 2.2 : 99;
      const eaten = dv > 0;
      if (eaten !== eatenRef.current) {
        eatenRef.current = eaten;
        pose.traverse((o: any) => {
          if (o.isMesh) o.castShadow = !eaten;
        });
      }
    }

    // Size weapons once the model's world scale is known
    if (!weaponScaledRef.current && weaponsRef.current.right?.group.parent) {
      const s = new THREE.Vector3();
      weaponsRef.current.right.group.parent.getWorldScale(s);
      if (s.x > 0.0001) {
        const inv = 1 / s.x;
        weaponsRef.current.right.group.scale.setScalar(inv);
        weaponsRef.current.left!.group.scale.setScalar(inv);
        weaponScaledRef.current = true;
        const sp = spearRef.current;
        if (sp?.parent) {
          const ss = new THREE.Vector3();
          sp.parent.getWorldScale(ss);
          sp.scale.setScalar(1 / Math.max(ss.x, 0.0001));
        }
        const cr = crownRef.current;
        if (cr?.parent) {
          const hs = new THREE.Vector3();
          cr.parent.getWorldScale(hs);
          const ci = 1 / Math.max(hs.x, 0.0001);
          cr.scale.setScalar(ci);
          cr.position.set(0, 0.2 * ci, 0.01 * ci);
        }
      }
    }

    const st = c.actionState;
    const speed = Math.hypot(c.vel[0], c.vel[2]);
    const restarted = st !== lastStateRef.current || c.stateTimer < lastTimerRef.current - 0.001;
    if (lastStateRef.current === 'knockdown' && (st === 'idle' || st === 'run') && c.hp > 0) getupRef.current = 0.45;
    if (getupRef.current > 0) getupRef.current -= delta;
    lastStateRef.current = st;
    lastTimerRef.current = c.stateTimer;

    // ---------- choose clip ----------
    let key = 'idle';
    const lm = c.localMove || [0, 0];
    let backward = false;
    if (c.treeClimb !== undefined && c.climbMode === 'ladder') {
      key = 'idle'; // hand over hand: the climbing pose is layered on below
    } else if (c.treeClimb !== undefined) {
      // 梯云纵: running straight up the bark, body leaning out from the trunk; the last kick turns into a flip
      const kick = Math.min(2, Math.floor(((c.climbT ?? 0) / 1.0) * 3));
      key = kick === 2 && (c.climbT ?? 0) > 0.72 && actionsRef.current.r_flip ? 'r_flip' : actionsRef.current.run ? 'run' : 'jump';
      climbKickRef.current = kick;
    } else if (classId === 'Ranger' && st === 'attack_3' && c.backSlash) {
      key = 'r_kick';
    } else if (st === 'attack_1' || st === 'attack_2' || st === 'attack_3' || st === 'skill_1' || st === 'skill_2' || st === 'skill_3' || st === 'skill_4' || st === 'dodge' || st === 'block') {
      key = st;
    } else if (st === 'ultimate' && classId === 'Shadowblade') {
      key = actionsRef.current.s_ult ? 's_ult' : 'attack_3';
    } else if (st === 'ultimate' && classId === 'BuddhistMage') {
      key = actionsRef.current.m_ult ? 'm_ult' : 'idle';
    } else if (st === 'ultimate' && classId === 'Ranger') {
      key = c.stateTimer < 0.45 ? 'jump' : 'r_rain';
    } else if (st === 'ultimate') {
      key = c.vel[1] > -1 && !c.isGrounded && c.stateTimer < 0.55 ? 'ult_air' : 'ult_slam';
    } else if (st === 'hitstun') {
      if (restarted) hitVariantRef.current = (hitVariantRef.current + 1) % 2;
      key = hitVariantRef.current ? 'hit_b' : 'hit_a';
    } else if (st === 'launched' || st === 'buried') {
      key = 'launched';
    } else if (st === 'knockdown' || st === 'dead') {
      key = 'knockdown';
    } else if (!c.isGrounded && (c.doubleJumpTimer ?? 0) > 0 && actionsRef.current.r_flip) {
      key = 'r_flip';
    } else if (!c.isGrounded || st === 'jump') {
      key = 'jump';
    } else if (speed > 0.6) {
      backward = lm[1] < -0.35;
      key = backward ? 'walk' : 'run';
    }
    if (c.swimming && (key === 'idle' || key === 'run' || key === 'walk' || key === 'jump') && actionsRef.current.swim) key = 'swim';
    else if (getupRef.current > 0 && (key === 'idle' || key === 'run' || key === 'walk') && actionsRef.current.getup) key = 'getup';
    else if (c.celebrate && key === 'idle' && actionsRef.current.cheer) key = 'cheer';
    if (!actionsRef.current[key]) key = actionsRef.current.idle ? 'idle' : Object.keys(actionsRef.current)[0];

    const isOneShot = ONE_SHOT.has(key);
    const needRestart = key !== currentKeyRef.current || (isOneShot && restarted && key !== 'jump');
    if (needRestart) {
      const fade = key === 'idle' && currentKeyRef.current === 'knockdown' ? 0.4 : isOneShot ? 0.08 : 0.18;
      play(key, fade, timeScaleFor(key, c.stateDuration));
    }

    // Locomotion playback speed matches ground speed (no foot sliding)
    const cur = actionsRef.current[currentKeyRef.current];
    if (cur && (currentKeyRef.current === 'run' || currentKeyRef.current === 'walk')) {
      const base = currentKeyRef.current === 'run' ? (classId === 'Ranger' ? 7.5 : classId === 'BuddhistMage' ? 6.4 : 6.0) : 2.2;
      const ts = THREE.MathUtils.clamp(speed / base, 0.6, 1.8);
      cur.setEffectiveTimeScale(backward ? -ts : ts);
    }
    if (cur && currentKeyRef.current === 'skill_3') cur.setEffectiveTimeScale(2.0);
    if (cur && currentKeyRef.current === 'run' && c.treeClimb !== undefined && c.climbMode !== 'ladder') cur.setEffectiveTimeScale(1.9);
    if (cur && currentKeyRef.current === 'swim') cur.setEffectiveTimeScale(speed > 0.6 ? THREE.MathUtils.clamp(speed / 3.5, 0.7, 1.4) : 0.45);

    mixer.update(delta);

    const climbingNow = c.treeClimb !== undefined;
    if (!climbingNow) climbKickRef.current = -1;
    // rope ladder: arms reach up in turn, the opposite knee steps up, paced by how far you've climbed
    const onLadder = climbingNow && c.climbMode === 'ladder';
    ladderBlendRef.current = THREE.MathUtils.damp(ladderBlendRef.current, onLadder ? 1 : 0, 14, delta);
    if (onLadder) ladderPhaseRef.current += (c.pos[1] - lastLadderYRef.current) * 2.8;
    lastLadderYRef.current = c.pos[1];
    if (limbsRef.current && ladderBlendRef.current > 0.01) {
      applyClimbPose(limbsRef.current, ladderFwd.set(-Math.sin(c.rotY), 0, -Math.cos(c.rotY)), ladderPhaseRef.current, ladderBlendRef.current);
    }
    // 青冥寺: sitting in meditation on a prayer cushion
    sitBlendRef.current = THREE.MathUtils.damp(sitBlendRef.current, (c.meditateT ?? 0) > 0 ? 1 : 0, 6, delta);
    if (limbsRef.current && sitBlendRef.current > 0.01) applySitPose(limbsRef.current, ladderFwd.set(-Math.sin(c.rotY), 0, -Math.cos(c.rotY)), sitBlendRef.current);
    // 大漠玉门关 well: cranking the windlass, then drinking from the bucket
    drinkBlendRef.current = THREE.MathUtils.damp(drinkBlendRef.current, (c.drinkWell ?? 0) > 0 ? 1 : 0, 8, delta);
    if (limbsRef.current && drinkBlendRef.current > 0.01) applyDrinkPose(limbsRef.current, ladderFwd.set(-Math.sin(c.rotY), 0, -Math.cos(c.rotY)), c.drinkT ?? 0, drinkBlendRef.current);
    // 影遁: fade almost out of sight (a faint shimmer for the opponent, a ghost of yourself for the player)
    const veil = (c.burrowT ?? 0) > 0 ? 0 : (c.stealthT ?? 0) > 0 ? (isPlayer ? 0.32 : 0.07) : 1; // 遁地: gone under the ground
    stealthRef.current = THREE.MathUtils.damp(stealthRef.current, veil, 12, delta);
    const op = stealthRef.current;
    if (Math.abs(op - lastOpRef.current) > 0.01 || (op === 1 && lastOpRef.current !== 1)) {
      lastOpRef.current = op > 0.99 ? 1 : op;
      const apply = (o: any) => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          m.transparent = lastOpRef.current < 1;
          m.opacity = lastOpRef.current;
          m.depthWrite = lastOpRef.current >= 1;
        }
        o.castShadow = lastOpRef.current >= 1 && !c.swimming && !c.wading;
      };
      model.traverse(apply);
      weaponsRef.current.right?.group.traverse(apply);
      weaponsRef.current.left?.group.traverse(apply);
    }
    // in the water the body's shadow lands on the river bed and shows through as a dark double: no shadow while swimming
    const shadowOn = !c.swimming && !c.wading;
    if (shadowOn !== castRef.current) {
      castRef.current = shadowOn;
      model.traverse((o: any) => {
        if (o.isMesh) o.castShadow = shadowOn;
      });
    }
    // no weapons in hand while swimming, climbing or sitting
    // (and once 飞虫沙暴 has eaten them past the hands)
    const handsBusy = climbingNow || !!c.swimming || sitBlendRef.current > 0.5 || drinkBlendRef.current > 0.3 || (c.devoured ?? 0) >= 0.45;
    if (classId !== 'BuddhistMage') {
      const w0 = weaponsRef.current;
      if (w0.right) w0.right.group.visible = !handsBusy;
      // the left hand carries the candle / candle-shade in 青冥古林
      if (w0.left) w0.left.group.visible = !handsBusy && classId !== 'Ranger' && !c.candle && !c.shade;
    }

    // Face protection (暗器 model): damp neck / head rotation toward rest
    const rq = restQuats.current;
    if ((classId === 'Ranger' || classId === 'BuddhistMage') && !asset.fallback) {
      if (rq.neckBone && rq.neck) rq.neckBone.quaternion.slerp(rq.neck, 0.6);
      if (rq.headBone && rq.head) rq.headBone.quaternion.slerp(rq.head, 0.45);
    }

    // ---------- procedural whole-body layer (applied to a parent group, so bones never twist) ----------
    // Strafe: turn the lower body into the move direction while the controller keeps facing the camera.
    let targetYaw = 0;
    if ((key === 'run' || key === 'walk') && speed > 0.6) {
      const ang = backward ? Math.atan2(-lm[0], -lm[1]) : Math.atan2(lm[0], lm[1]);
      targetYaw = THREE.MathUtils.clamp(-ang, -1.15, 1.15);
    }
    strafeYawRef.current = THREE.MathUtils.damp(strafeYawRef.current, targetYaw, 12, delta);

    if (st === 'skill_2' && (classId === 'Berserker' || classId === 'Emperor')) spinRef.current -= delta * 15;
    else spinRef.current = THREE.MathUtils.damp(spinRef.current, Math.round(spinRef.current / (Math.PI * 2)) * Math.PI * 2, 14, delta);

    // Ultimate: forward somersault on the way up
    if (st === 'ultimate' && key === 'ult_air') flipRef.current = THREE.MathUtils.clamp(c.stateTimer / 0.55, 0, 1) * Math.PI * 2;
    else if ((c.doubleJumpTimer ?? 0) > 0 && !c.isGrounded && !actionsRef.current.r_flip) flipRef.current = (1 - (c.doubleJumpTimer ?? 0) / 0.45) * Math.PI * 2;
    else if (c.treeClimb !== undefined && c.climbMode !== 'ladder' && (c.climbT ?? 0) > 0.66 && !actionsRef.current.r_flip) flipRef.current = THREE.MathUtils.smootherstep(((c.climbT ?? 0) - 0.66) / 0.34, 0, 1) * Math.PI * 2;
    else flipRef.current = 0;

    let leanX = 0;
    let leanZ = 0;
    if (st === 'skill_3' && (classId === 'Berserker' || classId === 'Emperor')) leanX = 0.32;
    else if (st === 'skill_3' && classId === 'BuddhistMage') leanX = 0.1;
    else if (st === 'skill_3') flipRef.current = -THREE.MathUtils.clamp(c.stateTimer / 0.5, 0, 1) * Math.PI * 2;
    else if (st === 'launched') leanX = -0.45;
    else if (st === 'hitstun') leanX = -0.12;
    else if (c.treeClimb !== undefined && c.climbMode !== 'ladder' && (c.climbT ?? 0) < 0.66) leanX = -0.95; // feet on the bark
    else if (c.treeClimb !== undefined && c.climbMode === 'ladder') {
      leanX = 0.12; // chest in to the ladder
      leanZ = Math.sin(ladderPhaseRef.current) * 0.06; // hips sway with each step
    } else if (key === 'run' && !backward) leanX = 0.08;
    leanRef.current.x = THREE.MathUtils.damp(leanRef.current.x, leanX, 10, delta);
    leanRef.current.y = THREE.MathUtils.damp(leanRef.current.y, leanZ, 10, delta);

    pose.rotation.set(leanRef.current.x - flipRef.current, strafeYawRef.current + spinRef.current, leanRef.current.y, 'YXZ');
    // 梵音 floats a little off the ground while meditating for 万佛朝宗
    const levitate = classId === 'BuddhistMage' && st === 'ultimate' ? 0.45 + Math.sin(performance.now() * 0.003) * 0.05 : 0;
    pose.position.y = HIP_PIVOT + levitate - 0.62 * sitBlendRef.current; // sitting: down onto the cushion

    // ---------- hit flash & blood rage ----------
    const flash = c.whiteFlashTimer > 0 ? Math.min(1, c.whiteFlashTimer / 0.12) : 0;
    const rage = c.buffs.some((b) => b.type === 'blood_rage');
    // 梵音: the golden body glows under 金钟罩 and while the Buddha is called down
    const holy = classId === 'BuddhistMage' && ((c.bellTimer ?? 0) > 0 || st === 'ultimate') ? 0.5 + 0.25 * Math.sin(performance.now() * 0.008) : 0;
    for (const m of materialsRef.current) {
      m.emissive.setRGB(flash * 0.75 + holy * 0.55, flash * 0.6 + holy * 0.38, flash * 0.5 + holy * 0.08);
    }
    const w = weaponsRef.current;
    const pulse = rage ? 0.65 + 0.35 * Math.sin(performance.now() * 0.012) : 0;
    if (w.right) w.right.fullerMat.opacity = pulse;
    if (w.left) w.left.fullerMat.opacity = pulse;
  });

  if (!asset || !model) {
    return loadError ? (
      <mesh position={[0, 1.2, 0]}>
        <sphereGeometry args={[0.35, 16, 16]} />
        <meshStandardMaterial color="#ef4444" wireframe />
      </mesh>
    ) : null;
  }

  return (
    <group ref={poseRootRef} position={[0, HIP_PIVOT, 0]}>
      <group position={[0, asset.floor - HIP_PIVOT, 0]} rotation={[0, MODEL_YAW_OFFSET, 0]} scale={asset.scale}>
        <primitive object={model} />
      </group>
      {/* 皇上: a soft warm light held in front of his face (the lanterns are all below him) */}
      {classId === 'Emperor' && <pointLight ref={faceLight} position={[0, 2.0 - HIP_PIVOT, -1.1]} color="#ffe2b0" intensity={3.2} distance={3.2} decay={2} />}
    </group>
  );
}
