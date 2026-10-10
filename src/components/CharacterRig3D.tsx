import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader, SkeletonUtils } from 'three-stdlib';
import { CombatantState, CharacterActionState } from '../types';

export const BERSERKER_MODEL_URL = `${import.meta.env.BASE_URL}berserker.glb`;

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
}

interface CharacterRigProps {
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
};

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
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) {
        v[i] = x0;
        v[i + 2] = z0;
      }
    }
  });
  return c;
}

function buildClips(raw: THREE.AnimationClip[]) {
  const cleaned = raw.map(removeRootMotion);
  const built: Record<string, BuiltClip> = {};
  const unmapped: string[] = [];
  for (const [key, spec] of Object.entries(CLIP_PLAN)) {
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
}
let cachedAsset: LoadedAsset | null = null;
let loadPromise: Promise<LoadedAsset> | null = null;
const progressListeners = new Set<(p: ModelLoadProgress) => void>();

function loadAsset(): Promise<LoadedAsset> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      BERSERKER_MODEL_URL,
      (gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const h = Math.max(0.1, box.max.y - box.min.y);
        const scale = TARGET_HEIGHT / h;
        const { built, unmapped, all } = buildClips(gltf.animations || []);
        cachedAsset = { scene: gltf.scene, raw: gltf.animations, built, unmapped, all, scale, floor: -box.min.y * scale };
        resolve(cachedAsset);
      },
      (xhr) => {
        const pct = xhr.total > 0 ? Math.round((xhr.loaded / xhr.total) * 100) : 50;
        progressListeners.forEach((l) => l({ loaded: xhr.loaded, total: xhr.total, progress: pct, isLoading: true, error: null }));
      },
      (err) => reject(err instanceof Error ? err : new Error('模型加载失败，请检查网络连接'))
    );
  });
  return loadPromise;
}

const normBone = (n: string) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

const ONE_SHOT = new Set<string>(['attack_1', 'attack_2', 'attack_3', 'skill_1', 'skill_4', 'dodge', 'hit_a', 'hit_b', 'launched', 'knockdown', 'ult_air', 'ult_slam', 'jump']);

export function CharacterRig3D({ combatantRef, isPlayer, socketsRef, showBoneAxes, onAnimationDebug, onLoadProgress }: CharacterRigProps) {
  const [asset, setAsset] = useState<LoadedAsset | null>(cachedAsset);
  const [loadError, setLoadError] = useState<string | null>(null);

  const poseRootRef = useRef<THREE.Group>(null); // procedural whole-body motion (never touches bones)
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const currentKeyRef = useRef('');
  const lastStateRef = useRef<CharacterActionState>('idle');
  const lastTimerRef = useRef(0);
  const hitVariantRef = useRef(0);
  const strafeYawRef = useRef(0);
  const spinRef = useRef(0);
  const flipRef = useRef(0);
  const leanRef = useRef(new THREE.Vector2());
  const weaponScaledRef = useRef(false);
  const materialsRef = useRef<THREE.MeshStandardMaterial[]>([]);
  const weaponsRef = useRef<{ right?: ReturnType<typeof buildCleaver>; left?: ReturnType<typeof buildCleaver> }>({});

  useEffect(() => {
    let alive = true;
    if (cachedAsset) {
      setAsset(cachedAsset);
      onLoadProgress?.({ loaded: 100, total: 100, progress: 100, isLoading: false, error: null });
      return;
    }
    const listener = (p: ModelLoadProgress) => onLoadProgress?.(p);
    progressListeners.add(listener);
    onLoadProgress?.({ loaded: 0, total: 100, progress: 5, isLoading: true, error: null });
    loadAsset()
      .then((a) => {
        if (!alive) return;
        setAsset(a);
        onLoadProgress?.({ loaded: 100, total: 100, progress: 100, isLoading: false, error: null });
      })
      .catch((e) => {
        if (!alive) return;
        const msg = e?.message || '无法装载霍岩模型 (berserker.glb)';
        setLoadError(msg);
        onLoadProgress?.({ loaded: 0, total: 100, progress: 0, isLoading: true, error: msg });
      });
    return () => {
      alive = false;
      progressListeners.delete(listener);
    };
  }, [onLoadProgress]);

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
        if (!isPlayer) {
          // Training dummy only: desaturated stone tint, texture kept
          m.color = new THREE.Color('#9aa3ad');
        }
        m.emissive = new THREE.Color('#000000');
        o.material = m;
        mats.push(m);
      }
    });
    materialsRef.current = mats;
    return cloned;
  }, [asset, isPlayer]);

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
    currentKeyRef.current = '';
    if (actions.idle) {
      actions.idle.play();
      currentKeyRef.current = 'idle';
    }

    const bones: Record<string, THREE.Bone> = {};
    model.traverse((o: any) => {
      if (o.isBone) bones[normBone(o.name)] = o;
    });

    const glow = new THREE.Color(isPlayer ? '#ff3b1f' : '#7dd3fc');
    const right = buildCleaver(glow);
    const left = buildCleaver(glow);
    // Hand-local frame (Mixamo): +Y runs along the fingers, the knuckle line is X.
    // The blade leaves the fist on the index-finger side: -X for the right hand, +X for the left.
    right.group.rotation.set(0, 0, Math.PI / 2);
    right.group.position.set(0.0, 0.075, 0.025);
    left.group.rotation.set(Math.PI, 0, -Math.PI / 2);
    left.group.position.set(0.0, 0.075, 0.025);
    if (bones.righthand) bones.righthand.add(right.group);
    if (bones.lefthand) bones.lefthand.add(left.group);
    weaponsRef.current = { right, left };
    weaponScaledRef.current = false;

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
    };
  }, [model, asset, isPlayer, socketsRef, onAnimationDebug, showBoneAxes]);

  const play = (key: string, fade: number, timeScale: number) => {
    const actions = actionsRef.current;
    const next = actions[key];
    if (!next) return false;
    const prev = actions[currentKeyRef.current];
    if (prev && prev !== next) prev.fadeOut(fade);
    next.reset();
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

    // Size weapons once the model's world scale is known
    if (!weaponScaledRef.current && weaponsRef.current.right?.group.parent) {
      const s = new THREE.Vector3();
      weaponsRef.current.right.group.parent.getWorldScale(s);
      if (s.x > 0.0001) {
        const inv = 1 / s.x;
        weaponsRef.current.right.group.scale.setScalar(inv);
        weaponsRef.current.left!.group.scale.setScalar(inv);
        weaponScaledRef.current = true;
      }
    }

    const st = c.actionState;
    const speed = Math.hypot(c.vel[0], c.vel[2]);
    const restarted = st !== lastStateRef.current || c.stateTimer < lastTimerRef.current - 0.001;
    lastStateRef.current = st;
    lastTimerRef.current = c.stateTimer;

    // ---------- choose clip ----------
    let key = 'idle';
    const lm = c.localMove || [0, 0];
    let backward = false;
    if (st === 'attack_1' || st === 'attack_2' || st === 'attack_3' || st === 'skill_1' || st === 'skill_2' || st === 'skill_3' || st === 'skill_4' || st === 'dodge' || st === 'block') {
      key = st;
    } else if (st === 'ultimate') {
      key = c.vel[1] > -1 && !c.isGrounded && c.stateTimer < 0.55 ? 'ult_air' : 'ult_slam';
    } else if (st === 'hitstun') {
      if (restarted) hitVariantRef.current = (hitVariantRef.current + 1) % 2;
      key = hitVariantRef.current ? 'hit_b' : 'hit_a';
    } else if (st === 'launched' || st === 'buried') {
      key = 'launched';
    } else if (st === 'knockdown' || st === 'dead') {
      key = 'knockdown';
    } else if (!c.isGrounded || st === 'jump') {
      key = 'jump';
    } else if (speed > 0.6) {
      backward = lm[1] < -0.35;
      key = backward ? 'walk' : 'run';
    }
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
      const base = currentKeyRef.current === 'run' ? 6.0 : 2.2;
      const ts = THREE.MathUtils.clamp(speed / base, 0.6, 1.8);
      cur.setEffectiveTimeScale(backward ? -ts : ts);
    }
    if (cur && currentKeyRef.current === 'skill_3') cur.setEffectiveTimeScale(2.0);

    mixer.update(delta);

    // ---------- procedural whole-body layer (applied to a parent group, so bones never twist) ----------
    // Strafe: turn the lower body into the move direction while the controller keeps facing the camera.
    let targetYaw = 0;
    if ((key === 'run' || key === 'walk') && speed > 0.6) {
      const ang = backward ? Math.atan2(-lm[0], -lm[1]) : Math.atan2(lm[0], lm[1]);
      targetYaw = THREE.MathUtils.clamp(-ang, -1.15, 1.15);
    }
    strafeYawRef.current = THREE.MathUtils.damp(strafeYawRef.current, targetYaw, 12, delta);

    if (st === 'skill_2') spinRef.current -= delta * 15;
    else spinRef.current = THREE.MathUtils.damp(spinRef.current, Math.round(spinRef.current / (Math.PI * 2)) * Math.PI * 2, 14, delta);

    // Ultimate: forward somersault on the way up
    if (st === 'ultimate' && key === 'ult_air') flipRef.current = THREE.MathUtils.clamp(c.stateTimer / 0.55, 0, 1) * Math.PI * 2;
    else flipRef.current = 0;

    let leanX = 0;
    let leanZ = 0;
    if (st === 'skill_3') leanX = 0.32;
    else if (st === 'launched') leanX = -0.45;
    else if (st === 'hitstun') leanX = -0.12;
    else if (key === 'run' && !backward) leanX = 0.08;
    leanRef.current.x = THREE.MathUtils.damp(leanRef.current.x, leanX, 10, delta);
    leanRef.current.y = THREE.MathUtils.damp(leanRef.current.y, leanZ, 10, delta);

    pose.rotation.set(leanRef.current.x - flipRef.current, strafeYawRef.current + spinRef.current, leanRef.current.y, 'YXZ');
    pose.position.y = HIP_PIVOT;

    // ---------- hit flash & blood rage ----------
    const flash = c.whiteFlashTimer > 0 ? Math.min(1, c.whiteFlashTimer / 0.12) : 0;
    const rage = c.buffs.some((b) => b.type === 'blood_rage');
    for (const m of materialsRef.current) {
      m.emissive.setRGB(flash * 0.75, flash * 0.6, flash * 0.5);
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
    </group>
  );
}
