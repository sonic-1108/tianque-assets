import React, { useRef, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ToneMapping, N8AO, HueSaturation, BrightnessContrast } from '@react-three/postprocessing';
import { SKY_ENV, makeSkyEnvironment } from './envSky';
import { RoomEnvironment } from 'three-stdlib';
import { getConfig } from './constants';
import { gameAudio } from './utils/helper';
import { CombatantState, GameState, TargetingState, CharacterActionState, CharacterClassId } from './types';
import { GameInputSnapshot, InputKeyAction } from './input';
import { ACTION_PHASE_CONFIGS, RANGER_PHASE_CONFIGS, MONK_PHASE_CONFIGS, CLASS_CONFIGS } from './components/CombatData';
import { CharacterRig3D, AnimationDebugInfo, ModelLoadProgress, RigSockets } from './components/CharacterRig3D';
import { Maps3D } from './components/Maps3D';
import { useSettings, QUALITY } from './settings';
import { MAPS, MapId, HOME_BONUS, mapRuntime, VOLCANO_CRATER, GLACIER, ROOF, SUMMIT, terrainHeight, terrainGradient, glacierHeight, glacierPath, FOREST, waterDepth, riverZ, templeToWorld, underTempleRoof, CANDLE_POINTS } from './maps';
import { VFXSystem, RibbonTrail } from './components/VFXSystem';
import { glyphSteer } from './components/MonkFX';
import { CameraController } from './CameraController';
import type { NetSession } from './net';

export type RoundEvent =
  | { type: 'ko'; winner: 'player' | 'enemy' }
  | { type: 'reset' }
  | { type: 'playerHit'; heavy: boolean }
  | { type: 'screenFlash'; color: string }
  | { type: 'toast'; text: string };

interface GameSceneProps {
  gameState: GameState;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  inputRef: React.MutableRefObject<GameInputSnapshot>;
  p1RefState: React.MutableRefObject<CombatantState>;
  dummyRefState: React.MutableRefObject<CombatantState>;
  targetingRefState: React.MutableRefObject<TargetingState>;
  /** true = 霍岩影 fights back; false = passive training dummy */
  aiEnabledRef: React.MutableRefObject<boolean>;
  mapId: MapId;
  playerClass?: CharacterClassId;
  enemyClass?: CharacterClassId;
  /** online 1v1: host simulates, guest mirrors */
  net?: NetSession | null;
  showBoneAxes?: boolean;
  onRoundEvent?: (e: RoundEvent) => void;
  onVfxCountChange?: (count: number) => void;
  /** automatic quality: the device pixel ratio the canvas should render at */
  onAutoDpr?: (dpr: number) => void;
  /** every frame: where the opponent's name tag goes on screen (moved directly, not through React state) */
  onFoeTagMove?: (x: number, y: number) => void;
  onDebugUpdate?: (data: {
    playerPos: [number, number, number];
    cameraPos: [number, number, number];
    camYaw: number;
    camPitch: number;
    camDist: number;
  }) => void;
  onDummyScreenPosUpdate?: (data: { visible: boolean; screenX: number; screenY: number; angle?: number; dist?: number; hidden?: boolean }) => void;
  onBloodRageFlash?: () => void;
  onAnimationDebug?: (info: AnimationDebugInfo) => void;
  onLoadProgress?: (progress: ModelLoadProgress) => void;
}

const ACES_FILMIC = 6; // postprocessing ToneMappingMode.ACES_FILMIC

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const vD = new THREE.Vector3();
const headProj = new THREE.Vector3();
const playerVec = new THREE.Vector3();

const SWING_STATES = new Set<CharacterActionState>(['attack_1', 'attack_2', 'attack_3', 'skill_1', 'skill_2', 'skill_3', 'ultimate']);
const ARMOR_STATES = new Set<CharacterActionState>(['skill_1', 'skill_2', 'skill_3', 'ultimate']);
const PLAYER_COLOR = '#ff4a1c';
const ENEMY_COLOR = '#3fa9ff';
const RANGER_PLAYER_COLOR = '#2dd4bf';
const RANGER_ENEMY_COLOR = '#a78bfa';
const GOLD = '#fbbf24';
const POISON_COLOR = '#86efac';
const UP = new THREE.Vector3(0, 1, 0);

const MONK_PLAYER_COLOR = '#f6c453';
const MONK_ENEMY_COLOR = '#93c5fd';
const phasesFor = (c: CombatantState) => (c.classId === 'Ranger' ? RANGER_PHASE_CONFIGS : c.classId === 'BuddhistMage' ? MONK_PHASE_CONFIGS : ACTION_PHASE_CONFIGS);
const colorFor = (slot: number, c: CombatantState) =>
  c.classId === 'Ranger'
    ? slot === 0
      ? RANGER_PLAYER_COLOR
      : RANGER_ENEMY_COLOR
    : c.classId === 'BuddhistMage'
    ? slot === 0
      ? MONK_PLAYER_COLOR
      : MONK_ENEMY_COLOR
    : slot === 0
    ? PLAYER_COLOR
    : ENEMY_COLOR;
/** 禅定结界 radius */
const ZEN_R = 4.5;
/** 梯云纵: seconds to run up a lookout tree */
/** a fighter as sent to the guest: numbers rounded to millimetres / milliseconds (about half the bytes) */
const r3 = (v: number) => Math.round(v * 1000) / 1000;
function slimFighter(c: CombatantState) {
  const o: any = {};
  for (const k in c) {
    const v = (c as any)[k];
    if (typeof v === 'number') o[k] = r3(v);
    else if (Array.isArray(v) && typeof v[0] === 'number') o[k] = v.map((x: number) => (typeof x === 'number' ? r3(x) : x));
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const q: any = {};
      for (const kk in v) q[kk] = typeof v[kk] === 'number' ? r3(v[kk]) : v[kk];
      o[k] = q;
    } else o[k] = v;
  }
  return o;
}
const TREE_RUN_T = 1.0;
/** 青冥古林: each fighter's own grip (sole friction), before the weather */
const GRIP: Record<string, number> = { Berserker: 0.85, Ranger: 0.8, BuddhistMage: 0.95 };
/** below this friction, sharp turns, stops, rolls and hard landings start to cost balance */
const SLIP_T = 0.74;
/** weather cycle (seconds): clear, clouding over, rain, thunderstorm, easing off */
const WEATHER = { clear: 25, cloud: 10, rain: 45, storm: 55, ease: 12, dusk: 15, night: 80, dawn: 12 };

/** A flying 暗器 (dart, pin or boomerang) */
interface Projectile {
  kind: 'dart' | 'pin' | 'boomerang';
  obj: THREE.Object3D;
  slot: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  knock: number;
  dur: number;
  color: string;
  pierce: boolean;
  poison: boolean;
  root: number;
  noStop: boolean;
  stagger: boolean;
  spent: boolean;
  traveled: number;
  back: boolean;
  hitOut: boolean;
  hitBack: boolean;
  /** >0: embedded in the ground / a pillar, seconds left before it disappears */
  stuck?: number;
  /** knocked away by a block: tumbles down under gravity */
  falling?: boolean;
  /** boomerang loop path */
  path?: { o: THREE.Vector3; f: THREE.Vector3; s: THREE.Vector3; L: number; W: number; y0: number; ty: number; u: number; T: number };
}

/** What a fighter wants to do this frame (from keyboard or from the AI). */
interface Intent {
  move: THREE.Vector3; // world-space desired direction, length 0..1
  faceYaw: number; // where the body / attacks point
  request: InputKeyAction | null;
  block: boolean;
  /** F held: climb a ladder */
  interact?: boolean;
}

interface AIMemory {
  think: number;
  plan: 'approach' | 'pressure' | 'circle' | 'retreat' | 'guard' | 'idle';
  planTimer: number;
  strafe: number;
  comboLeft: number;
  request: InputKeyAction | null;
  requestTtl: number;
  dodgeDir: number;
  airFollow: number; // >0: jumped, will press 1 mid-air for 钉地斩
}

const yawTo = (from: number[], to: number[]) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
const fwdOf = (yaw: number) => vD.set(-Math.sin(yaw), 0, -Math.cos(yaw));

function GameImpl({
  gameState,
  inputRef,
  p1RefState,
  dummyRefState,
  targetingRefState,
  aiEnabledRef,
  mapId,
  playerClass = 'Berserker',
  enemyClass = 'Berserker',
  net = null,
  showBoneAxes,
  onRoundEvent,
  onVfxCountChange,
  onDebugUpdate,
  onAutoDpr,
  onFoeTagMove,
  onDummyScreenPosUpdate,
  onBloodRageFlash,
  onAnimationDebug,
  onLoadProgress,
}: GameSceneProps) {
  const { camera, gl, scene, size } = useThree();
  const { quality } = useSettings();
  // a new shadow-map size only takes effect once the old map is thrown away
  useEffect(() => {
    const l = keyLightRef.current;
    if (l && l.shadow.map) {
      l.shadow.map.dispose();
      (l.shadow as any).map = null;
    }
  }, [quality]);

  // ---- automatic quality: keep the frame rate up on laptops (retina screens render 4x the pixels)
  const setDpr = (d: number) => onAutoDpr?.(d);
  const [perfTier, setPerfTier] = useState(0); // 0 everything, 1 no ambient occlusion, 2 also no MSAA
  const perf = useRef({ frames: 0, t0: 0, dpr: 1, max: 1, slow: 0, fast: 0, tier: 0 });
  useEffect(() => {
    const P = perf.current;
    P.max = Math.min(window.devicePixelRatio || 1, QUALITY[quality].dpr[1]);
    P.dpr = Math.min(P.max, 1.5);
    P.tier = 0;
    P.slow = P.fast = 0;
    setDpr(P.dpr);
    setPerfTier(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality]);
  useFrame(() => {
    const P = perf.current;
    const now = performance.now();
    if (!P.t0 || document.hidden) {
      P.t0 = now;
      P.frames = 0;
      return;
    }
    P.frames++;
    if (now - P.t0 < 1000) return;
    const fps = (P.frames * 1000) / (now - P.t0);
    P.t0 = now;
    P.frames = 0;
    if (fps < 50) {
      P.slow++;
      P.fast = 0;
    } else if (fps > 58) {
      P.fast++;
      P.slow = 0;
    } else P.slow = P.fast = 0;
    if (P.slow >= 2) {
      P.slow = 0;
      if (P.tier === 0 && quality === 'high') setPerfTier((P.tier = 1));
      else if (P.dpr > 0.76) setDpr((P.dpr = Math.max(0.75, P.dpr - 0.25)));
      else if (P.tier < 2) setPerfTier((P.tier = 2));
    } else if (P.fast >= 8 && P.dpr < P.max - 0.01) {
      P.fast = 0;
      setDpr((P.dpr = Math.min(P.max, P.dpr + 0.25)));
    }
    (globalThis as any).__TQ_PERF = { fps: Math.round(fps), dpr: P.dpr, tier: P.tier };
  });

  const playerGroupRef = useRef<THREE.Group>(null);
  const enemyGroupRef = useRef<THREE.Group>(null);
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const rimLightRef = useRef<THREE.DirectionalLight>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const playerSockets = useRef<RigSockets>({ rightBase: null, rightTip: null, leftBase: null, leftTip: null, chest: null, leftHand: null });
  const enemySockets = useRef<RigSockets>({ rightBase: null, rightTip: null, leftBase: null, leftTip: null, chest: null, leftHand: null });

  const slowMoTimerRef = useRef(0);
  const gameTimeRef = useRef(0);
  const map = MAPS[mapId];
  const pendingResetRef = useRef(true);
  const mapTimeRef = useRef(0);
  const eruptRef = useRef({ timer: 9 });
  const bombZonesRef = useRef<{ x: number; z: number; r: number }[]>([]);
  const forestRef = useRef({ timer: 14 });
  const bgRain = useMemo(() => new THREE.Color('#4d5862'), []);
  const bgNight = useMemo(() => new THREE.Color('#05070c'), []);
  /** weather clock and lightning timer (host / offline) */
  const weatherRef = useRef({ t: 12, phase: '', strike: 6, warn: 0 });
  const slipPrevRef = useRef([[0, 0], [0, 0]]);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const waveRef = useRef({ timer: 7, warn: 0, side: 0, aiBlocks: false });
  const lightningRef = useRef({ timer: 5 });
  const ridgeRef = useRef({ timer: 9, warn: 0 });
  const footLiftRef = useRef([0, 0]);
  const avalancheRef = useRef({ timer: 14, warn: 0, z: -999, hit: [false, false] });
  const bgBase = useMemo(() => new THREE.Color(), []);
  const bgTmp = useMemo(() => new THREE.Color(), []);
  const wallCdRef = useRef([0, 0]);
  const ventRef = useRef<{ timer: number; warn: number[] }>({ timer: 3, warn: [] });
  useEffect(() => {
    pendingResetRef.current = true;
  }, [mapId, playerClass, enemyClass]);
  const projRef = useRef<Projectile[]>([]);
  /** 雪岭: ground height each fighter last stood on (for the no-climbing rule) */
  const takeoffY = useRef([0, 0]);
  /** 六字真言 syllables in flight (host / offline only; the guest sees them through the vfx replay) */
  const glyphRef = useRef<{ idx: number; slot: number; pos: THREE.Vector3; vel: THREE.Vector3; age: number }[]>([]);
  const netSendRef = useRef(0);
  const lastSnapRef = useRef<unknown>(null);
  const screenRepRef = useRef({ visible: false, hidden: false, t: 0 });
  /** guest: locally predicted position of our own fighter */
  const predRef = useRef({ on: false, x: 0, z: 0, vx: 0, vz: 0, hist: [] as [number, number, number][], lastSnap: null as unknown });
  const guestProjRef = useRef<{ obj: THREE.Object3D; vel: THREE.Vector3; kind: string }[]>([]);

  const auraTimers = useRef([0, 0]);
  const footTimers = useRef([0, 0]);
  const wasGrounded = useRef([true, true]);
  const lastReportRef = useRef(0);
  const roundRef = useRef<{ over: boolean; timer: number }>({ over: false, timer: 0 });
  const aiRef = useRef<AIMemory>({ think: 1.0, plan: 'idle', planTimer: 0, strafe: 1, comboLeft: 0, request: null, requestTtl: 0, dodgeDir: 1, airFollow: 0 });

  // ---------- VFX ----------
  const vfx = useMemo(() => new VFXSystem(), []);
  const trails = useMemo<{ right: RibbonTrail; left: RibbonTrail }[]>(
    () => [
      { right: vfx.createTrail(PLAYER_COLOR), left: vfx.createTrail(PLAYER_COLOR) },
      { right: vfx.createTrail(ENEMY_COLOR), left: vfx.createTrail(ENEMY_COLOR) },
    ],
    [vfx]
  );
  useEffect(() => () => vfx.dispose(), [vfx]);
  useEffect(() => vfx.setViewportHeight(size.height), [vfx, size.height]);

  // Online host: record every top-level effect and sound so the guest can replay them
  useEffect(() => {
    if (!net || net.role !== 'host') return;
    const VFX_CALLS = ['ring', 'flash', 'decal', 'sparkBurst', 'embers', 'dustPuff', 'rocks', 'damageNumber', 'slashMark', 'fireColumn', 'spiral', 'chargeWave', 'meteor', 'setVortex', 'pillarAt', 'groundSlam', 'ultimateImpact', 'hitImpact', 'dartTrail', 'palmStrike', 'palmPush', 'buddha', 'bell', 'bellHit', 'zenField', 'glyph'];
    const enc = (x: any) =>
      x instanceof THREE.Vector3 ? { v3: [+x.x.toFixed(3), +x.y.toFixed(3), +x.z.toFixed(3)] } : x instanceof THREE.Color ? '#' + x.getHexString() : typeof x === 'function' ? null : x;
    let depth = 0;
    const restore: (() => void)[] = [];
    const v = vfx as any;
    for (const name of VFX_CALLS) {
      const orig = v[name];
      if (typeof orig !== 'function') continue;
      v[name] = function (...args: any[]) {
        if (depth === 0) net.events.push(['v', name, args.map(enc)]);
        depth++;
        try {
          return orig.apply(this, args);
        } finally {
          depth--;
        }
      };
      restore.push(() => (v[name] = orig));
    }
    const a = gameAudio as any;
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(a))) {
      if (!name.startsWith('play') || typeof a[name] !== 'function') continue;
      const orig = a[name];
      a[name] = function (...args: any[]) {
        net.events.push(['a', name]);
        return orig.apply(this, args);
      };
      restore.push(() => delete a[name]);
    }
    return () => restore.forEach((r) => r());
  }, [net, vfx]);

  // ---------- environment ----------
  useEffect(() => {
    const sky = SKY_ENV[map.id];
    const env = makeSkyEnvironment(gl, sky);
    scene.environment = env;
    (scene as any).environmentIntensity = map.env ?? sky.intensity;
    scene.background = new THREE.Color(map.background);
    scene.fog = new THREE.Fog(map.background, map.fog[0], map.fog[1]);
    gl.toneMappingExposure = map.exposure;
    return () => {
      env.dispose();
      scene.environment = null;
    };
  }, [gl, scene, map]);

  useEffect(() => {
    const controller = new CameraController(camera as THREE.PerspectiveCamera, gl.domElement);
    cameraControllerRef.current = controller;
    return () => {
      controller.dispose();
      cameraControllerRef.current = null;
    };
  }, [camera, gl.domElement]);

  // ==========================================================
  // MAIN LOOP
  // ==========================================================
  useFrame((_, delta) => {
    if (gameState.status !== 'PLAYING') return;

    let timeScale = 1;
    if (slowMoTimerRef.current > 0) {
      slowMoTimerRef.current -= delta;
      timeScale = 0.25;
    }
    const rawDt = Math.min(delta, 0.04);
    const dt = rawDt * timeScale;
    gameTimeRef.current += dt;
    const gt = gameTimeRef.current;

    void getConfig;
    const gravity = getConfig('gravity') || 26;
    const speedOf = (c: CombatantState) => (getConfig('baseMoveSpeed') || 8.5) * (CLASS_CONFIGS[c.classId]?.speedRatio || 0.85);
    const jumpVel = getConfig('jumpVelocity') || 11;

    const p1 = p1RefState.current;
    const en = dummyRefState.current;
    const fighters = [p1, en];
    const targeting = targetingRefState.current;
    const input = inputRef.current;
    const actions = input.actions;
    const just = input.justPressed;
    const controller = cameraControllerRef.current;
    const aiOn = aiEnabledRef.current;
    const round = roundRef.current;
    const camYaw = controller ? controller.yaw : 0;
    const basis = controller ? controller.getMoveBasis() : { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };
    const guest = net?.role === 'guest';
    if (guest) guestSync(rawDt, camYaw, basis);
    else {

    // ---------- shared timers ----------
    for (const c of fighters) {
      for (const k of Object.keys(c.cooldowns)) {
        const v = c.cooldowns[k];
        c.cooldowns[k] = typeof v !== 'number' || isNaN(v) ? 0 : Math.max(0, v - dt);
      }
      c.buffs = c.buffs.map((b) => ({ ...b, duration: b.duration - dt })).filter((b) => b.duration > 0);
      if (c.hitStopTimer > 0) c.hitStopTimer -= rawDt;
      if (c.whiteFlashTimer > 0) c.whiteFlashTimer -= dt;
      if (c.dodgeCooldownTimer > 0) c.dodgeCooldownTimer -= dt;
      if (c.dodgeIframeTimer > 0) c.dodgeIframeTimer -= dt;
      if (c.comboResetTimer > 0) {
        c.comboResetTimer -= dt;
        if (c.comboResetTimer <= 0) {
          c.comboCount = 0;
          c.comboDamage = 0;
        }
      }
      c.mp = Math.min(c.maxMp, c.mp + dt * 8);
      if ((c.counterTimer ?? 0) > 0) c.counterTimer = (c.counterTimer ?? 0) - dt;
      if ((c.rootTimer ?? 0) > 0) c.rootTimer = (c.rootTimer ?? 0) - dt;
      if ((c.doubleJumpTimer ?? 0) > 0) c.doubleJumpTimer = (c.doubleJumpTimer ?? 0) - dt;
      if ((c.protectTimer ?? 0) > 0) c.protectTimer = (c.protectTimer ?? 0) - dt;
      // 体力 regenerates after a short pause
      if ((c.staminaDelay ?? 0) > 0) c.staminaDelay = (c.staminaDelay ?? 0) - dt;
      else c.stamina = Math.min(c.maxStamina ?? 100, (c.stamina ?? 100) + dt * (c.classId === 'Ranger' ? 32 : c.classId === 'BuddhistMage' ? 26 : 24));
      const stunnedNow = c.actionState === 'hitstun' || c.actionState === 'launched' || c.actionState === 'knockdown' || c.actionState === 'buried';
      if (!stunnedNow && (c.stunLoad ?? 0) > 0) c.stunLoad = Math.max(0, (c.stunLoad ?? 0) - dt * 4);
      if ((c.poisonBuff ?? 0) > 0) c.poisonBuff = (c.poisonBuff ?? 0) - dt;
      if (c.zenField && c.zenField.t > 0) c.zenField.t -= dt;
      if ((c.silenceTimer ?? 0) > 0) c.silenceTimer = (c.silenceTimer ?? 0) - dt;
      if ((c.bellTimer ?? 0) > 0) {
        c.bellTimer = (c.bellTimer ?? 0) - dt;
        if ((c.bellTimer ?? 0) <= 0 && c.hp > 0) {
          // 金钟罩 fades: a moment of 气竭 where the monk is open
          c.bellTimer = 0;
          if (isFree(c) || c.actionState.startsWith('attack_')) {
            c.actionState = 'hitstun';
            c.stateTimer = 0;
            c.stateDuration = 0.5;
            vfx.damageNumber(vC.set(c.pos[0], c.pos[1] + 2.2, c.pos[2]), '气竭', false, '#fde68a');
          }
        }
      }
    }
    // 淬毒: poison damage over time
    for (let i = 0; i < 2; i++) {
      const c = fighters[i];
      if ((c.poisonTimer ?? 0) <= 0 || c.hp <= 0) continue;
      c.poisonTimer = (c.poisonTimer ?? 0) - dt;
      c.poisonTick = (c.poisonTick ?? 0) + dt;
      if (c.poisonTick >= 0.25) {
        c.poisonTick = 0;
        const d = Math.max(1, Math.round((c.poisonDps ?? 0) * 0.25));
        c.hp = Math.max(0, c.hp - d);
        vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 1.9, c.pos[2]), d, false, POISON_COLOR);
        vfx.embers(vB.set(c.pos[0], c.pos[1] + 0.6, c.pos[2]), 4, '#22c55e', 0.4, 1.2, 0.07);
        if (c.hp <= 0) koCheck(i, colorFor(1 - i, fighters[1 - i]));
      }
      if (c.poisonTimer <= 0) c.poisonDps = 0;
    }

    // ---------- round flow ----------
    if (pendingResetRef.current) {
      pendingResetRef.current = false;
      resetRound(false);
    }
    if (round.over) {
      round.timer -= rawDt;
      if (round.timer <= 0) resetRound(true);
    }

    // ---------- map hazards ----------
    updateMap();

    // ---------- targeting ----------
    if (just.lockEnemy) {
      just.lockEnemy = false;
      targeting.lockedEnemyId = targeting.lockedEnemyId ? null : en.id;
      gameAudio.playCrispClick();
    }
    if (just.clearTarget) {
      just.clearTarget = false;
      targeting.lockedEnemyId = null;
    }


    // ================= INTENTS =================
    // Player: keyboard + mouse, MMO facing (body follows camera)
    let lx = 0;
    let lz = 0;
    if (actions.right) lx += 1;
    if (actions.left) lx -= 1;
    if (actions.forward) lz += 1;
    if (actions.backward) lz -= 1;
    const pMove = new THREE.Vector3().copy(basis.forward).multiplyScalar(lz).addScaledVector(basis.right, lx);
    if (pMove.lengthSq() > 1) pMove.normalize();
    for (const k of ['dodge', 'skill1', 'skill2', 'skill3', 'skill4', 'ultimate', 'attack', 'jump'] as InputKeyAction[]) just[k] = false;
    const playerIntent: Intent = {
      move: pMove,
      faceYaw: targeting.lockedEnemyId ? yawTo(p1.pos, en.pos) : camYaw,
      request: round.over ? null : input.peekBuffer(),
      block: actions.special && !round.over && p1.classId !== 'Ranger',
      interact: !!actions.interact,
    };

    // Opponent: AI brain
    const enemyIntent: Intent = { move: new THREE.Vector3(), faceYaw: yawTo(en.pos, p1.pos), request: null, block: false };
    if (net?.role === 'host') {
      // online: the guest's controls drive the second fighter
      const r = net.remote;
      enemyIntent.move.set(r.mx, 0, r.mz);
      if (enemyIntent.move.lengthSq() > 1) enemyIntent.move.normalize();
      enemyIntent.faceYaw = r.yaw;
      enemyIntent.block = r.blk && !round.over && en.classId !== 'Ranger';
      enemyIntent.interact = !!r.int;
      enemyIntent.request = round.over || en.hp <= 0 ? null : (r.req as InputKeyAction | null);
      r.reqTtl -= dt;
      if (r.reqTtl <= 0) r.req = null;
    } else if (aiOn && !round.over && en.hp > 0) {
      runAI(en, p1, enemyIntent, dt);
      if (map.id === 'glacier') routeUpMountain(en, p1, enemyIntent);
      if (map.id === 'forest') leaveLookout(en, p1, enemyIntent);
    }
    else if (!aiOn) {
      enemyIntent.faceYaw = en.targetRotY;
    }

    // ================= ACTIONS =================
    const p1Ok = executeIntent(0, p1, en, playerIntent);
    if (p1Ok && playerIntent.request) input.consumeBuffer();
    const enOk = executeIntent(1, en, p1, enemyIntent);
    if (enOk) {
      aiRef.current.request = null;
      if (net?.role === 'host') net.remote.req = null;
    }

    applyMovement(p1, playerIntent);
    applyMovement(en, enemyIntent);

    // ================= COMBAT =================
    resolveAttacks(0, p1, en);
    resolveAttacks(1, en, p1);
    updateProjectiles(dt);
    updateGlyphs(dt);

    // ================= PHYSICS =================
    for (let i = 0; i < 2; i++) {
      const c = fighters[i];
      const cdt = c.hitStopTimer > 0 ? dt * 0.08 : dt;
      c.stateTimer += cdt;
      // Buried: stuck in the ground, then blasted up into the air (juggle window)
      if (c.actionState === 'buried') {
        c.vel[0] = 0;
        c.vel[2] = 0;
        c.pos[1] = THREE.MathUtils.damp(c.pos[1], fy(c.pos[0], c.pos[2]) - 0.75, 25, cdt);
        if (c.stateTimer >= c.stateDuration && c.hp > 0) {
          c.pos[1] = fy(c.pos[0], c.pos[2]);
          c.vel[1] = 8.5;
          c.isGrounded = false;
          c.actionState = 'launched';
          c.stateTimer = 0;
          c.stateDuration = 0.9;
          c.juggleCount = 0;
          vfx.rocks(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 10, 6, 0.1);
          vfx.dustPuff(vB, 16, 0.6, 3, 0.7);
          vfx.ring(vB, 1.8, '#d6c2a8', 0.35, 0.14, 0.3);
          gameAudio.playSlam();
        }
      }
      if (c.actionState === 'dodge' && c.stateDuration > 0 && c.stateTimer >= c.stateDuration) c.dodgeEndAt = gt;
      if (c.stateDuration > 0 && c.stateTimer >= c.stateDuration && c.hp > 0 && c.actionState !== 'buried') {
        if (c.actionState !== 'idle' && c.actionState !== 'run' && c.actionState !== 'jump' && c.actionState !== 'block') {
          if (c.actionState === 'knockdown') c.dodgeIframeTimer = Math.max(c.dodgeIframeTimer, 0.5); // wake-up invulnerability
          c.actionState = c.isGrounded ? 'idle' : 'jump';
          c.stateDuration = 0;
        }
      }
      const hovering = (c.classId === 'Ranger' && c.actionState === 'ultimate' && c.stateTimer > 0.45 && c.stateTimer < 2.45) || c.treeClimb !== undefined;
      if (hovering) c.vel[1] = 0;
      if (!c.isGrounded && c.actionState !== 'buried' && !hovering) {
        const y0 = c.pos[1];
        c.vel[1] -= gravity * cdt;
        c.pos[1] += c.vel[1] * cdt;
        const gh = groundHeight(c);
        // land if we crossed the floor this frame (a fast fall on a laggy frame can move > 0.6 m),
        // or if we somehow ended up under a floor that exists here
        const crossed = y0 >= gh - 0.6 && c.pos[1] <= gh;
        const underFloor = gh > -50 && c.pos[1] < gh;
        if (c.vel[1] <= 0 && c.pos[1] <= gh && (crossed || underFloor || map.terrain)) {
          c.pos[1] = gh;
          const impact = -c.vel[1];
          c.vel[1] = 0;
          c.isGrounded = true;
          c.juggleCount = 0;
          c.doubleJumped = false;
          if (c.actionState === 'jump') c.actionState = 'idle';
          if (c.actionState === 'launched') {
            c.actionState = 'knockdown';
            c.stateTimer = 0;
            c.stateDuration = c.hp > 0 ? 0.8 : 99;
          }
          if (impact > 6) vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), Math.min(14, Math.round(impact)), 0.5, 2, 0.6);
          // a hard landing on a slick floor costs balance
          if (map.id === 'forest' && impact > 7 && (c.grip ?? 1) < SLIP_T) c.slip = (c.slip ?? 0) + (impact - 7) * 0.05 * (SLIP_T - (c.grip ?? 1)) * 6;
        }
      }
      const pinned = (c.rootTimer ?? 0) > 0 && c.isGrounded && c.actionState !== 'launched' && c.actionState !== 'knockdown';
      if (pinned) {
        c.vel[0] = 0;
        c.vel[2] = 0;
        if (Math.random() < 0.15) vfx.ring(vB.set(c.pos[0], 0.04, c.pos[2]), 0.9, '#5eead4', 0.25, 0.06);
      }
      const px0 = c.pos[0];
      const pz0 = c.pos[2];
      c.pos[0] += c.vel[0] * cdt;
      c.pos[2] += c.vel[2] * cdt;
      ledgeGuard(c, px0, pz0);
      mountainWall(i, c, px0, pz0);
      stepWall(c, px0, pz0);
      const free = c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'jump' || c.actionState === 'block' || c.actionState === 'skill_2';
      if (!free || c.actionState === 'dodge') {
        const k = Math.exp(-4.5 * cdt);
        c.vel[0] *= k;
        c.vel[2] *= k;
      }
      applyBounds(i, c);
      if (map.id === 'forest') {
        updateWater(c);
        updateGrip(i, c);
        updateItems(i, c, i === 0 ? playerIntent : enemyIntent);
      }
      if (map.terrain && c.isGrounded && c.actionState !== 'buried' && c.treeClimb === undefined) {
        const gh2 = groundHeight(c);
        if (gh2 > c.pos[1] - 0.6) c.pos[1] = gh2; // follow the slope up and down
      } else if (!c.isGrounded && map.terrain && c.actionState !== 'buried') {
        const gh2 = groundHeight(c);
        if (c.pos[1] < gh2 - 0.05 && c.vel[1] <= 0) c.pos[1] = gh2; // never fall through a slope
      }
      if (c.isGrounded && c.treeClimb === undefined && (c.pos[1] > 0.01 || map.terrain) && c.actionState !== 'buried' && groundHeight(c) < c.pos[1] - (map.terrain ? 0.6 : 0.05)) {
        c.isGrounded = false;
        c.vel[1] = Math.min(c.vel[1], 0);
        if (c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'block') c.actionState = 'jump';
      }
      if ((c.protectTimer ?? 0) > 0 && Math.random() < 0.12) vfx.ring(vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 1.0, '#e5e7eb', 0.25, 0.05);
      let diff = c.targetRotY - c.rotY;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.rotY += diff * Math.min(1, cdt * 14);

      // footsteps & landing dust
      if (c.isGrounded && c.actionState === 'run' && Math.hypot(c.vel[0], c.vel[2]) > 3) {
        footTimers.current[i] += dt;
        if (footTimers.current[i] > 0.28) {
          footTimers.current[i] = 0;
          vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 2, 0.15, 0.6, 0.35, '#7d7166');
          if (i === 0) gameAudio.playStep();
        }
      }
      if (!wasGrounded.current[i] && c.isGrounded && c.actionState !== 'ultimate') {
        vfx.dustPuff(vB.set(c.pos[0], c.pos[1], c.pos[2]), 6, 0.3, 1.4, 0.45);
        if (i === 0) gameAudio.playLand();
      }
      wasGrounded.current[i] = c.isGrounded;

      // blood rage aura
      if (c.buffs.some((b) => b.type === 'blood_rage')) {
        auraTimers.current[i] += dt;
        if (auraTimers.current[i] > 0.05) {
          auraTimers.current[i] = 0;
          vfx.embers(vB.set(c.pos[0], c.pos[1] + 0.2, c.pos[2]), 2, i === 0 ? '#ff2a1a' : '#2a8bff', 0.45, 2.2, 0.06);
        }
      }
    }

    // body separation
    {
      const dx = p1.pos[0] - en.pos[0];
      const dz = p1.pos[2] - en.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < 0.85 && d > 0.0001 && p1.actionState !== 'dodge' && en.actionState !== 'dodge') {
        const push = (0.85 - d) / d / 2;
        p1.pos[0] += dx * push;
        p1.pos[2] += dz * push;
        en.pos[0] -= dx * push;
        en.pos[2] -= dz * push;
      }
    }

    if (!aiOn && en.hp <= 0) {
      en.hp = en.maxHp;
      gameAudio.playPowerupChime();
    }

    }

    // ================= TRANSFORMS / CAMERA / LIGHTS =================
    if (playerGroupRef.current) {
      playerGroupRef.current.position.set(p1.pos[0], p1.pos[1] + footLift(p1, 0), p1.pos[2]);
      playerGroupRef.current.rotation.y = p1.rotY;
      playerGroupRef.current.updateMatrixWorld(true);
    }
    if (enemyGroupRef.current) {
      enemyGroupRef.current.position.set(en.pos[0], en.pos[1] + footLift(en, 1), en.pos[2]);
      enemyGroupRef.current.rotation.y = en.rotY;
      enemyGroupRef.current.updateMatrixWorld(true);
    }

    playerVec.set(p1.pos[0], p1.pos[1], p1.pos[2]);

    /**
     * On a slope the uphill foot would sink into the ground: lift the model to the highest ground under
     * its footprint (a few samples round the feet), so boots rest on the surface instead of in it.
     */
    function footLift(c: CombatantState, i: number) {
      let target = 0;
      if (map.terrain && c.isGrounded) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          const h = terrainHeight(map.id, c.pos[0] + Math.cos(a) * 0.24, c.pos[2] + Math.sin(a) * 0.24) - c.pos[1];
          if (h < 1) target = Math.max(target, h);
        }
        target = Math.min(0.45, target * 0.85);
      }
      const L = footLiftRef.current;
      L[i] = THREE.MathUtils.damp(L[i], target, 16, rawDt);
      return L[i];
    }
    if (controller) controller.groundAt = map.terrain ? (x: number, z: number) => Math.max(terrainHeight(map.id, x, z), p1.pos[1] - 2.5) : null;
    controller?.update(playerVec, rawDt);

    if (keyLightRef.current) {
      // the shadow frustum follows the player, height included (the glacier summit is 19 m up)
      const ly = map.terrain ? p1.pos[1] : 0;
      keyLightRef.current.position.set(p1.pos[0] + 8, ly + 14, p1.pos[2] + 6);
      keyLightRef.current.target.position.set(p1.pos[0], ly, p1.pos[2]);
      keyLightRef.current.target.updateMatrixWorld();
    }
    if (map.id === 'forest') {
      // where the local player is, for the F markers in the scenery
      mapRuntime.viewX = p1.pos[0];
      mapRuntime.viewY = p1.pos[1];
      mapRuntime.viewZ = p1.pos[2];
      // the sun goes in as the rain comes; lightning lights everything up for an instant
      const rain = mapRuntime.rain;
      const night = mapRuntime.night;
      if (keyLightRef.current) keyLightRef.current.intensity = map.keyIntensity * (1 - 0.72 * rain) * (1 - 0.95 * night) + mapRuntime.lightning * 4;
      if (hemiRef.current) hemiRef.current.intensity = map.hemi[2] * (1 - 0.3 * rain) * (1 - 0.86 * night) + mapRuntime.lightning * 1.6;
      if (rimLightRef.current) rimLightRef.current.intensity = 2.4 * (1 - 0.85 * night);
      if (scene.fog) {
        (scene.fog as THREE.Fog).near = map.fog[0] * (1 - 0.45 * rain) * (1 - 0.6 * night);
        (scene.fog as THREE.Fog).far = map.fog[1] * (1 - 0.5 * rain) * (1 - 0.6 * night);
      }
    }
    if (rimLightRef.current) {
      rimLightRef.current.position.set(p1.pos[0] + basis.forward.x * 8, 5, p1.pos[2] + basis.forward.z * 8);
      rimLightRef.current.target.position.set(p1.pos[0], 1, p1.pos[2]);
      rimLightRef.current.target.updateMatrixWorld();
    }

    // ================= TRAILS & VFX =================
    const now = performance.now() / 1000;
    [p1, en].forEach((c, i) => {
      const s = (i === 0 ? playerSockets : enemySockets).current;
      const t = trails[i];
      const cfg = phasesFor(c)[c.actionState];
      const swinging =
        SWING_STATES.has(c.actionState) &&
        (c.actionState === 'skill_2' ||
          c.actionState === 'skill_3' ||
          (c.actionState === 'ultimate' ? !!c.ultSlamStarted && c.stateTimer < 1.0 : !!cfg && c.stateTimer >= cfg.startup * 0.4 && c.stateTimer <= cfg.startup + cfg.active + 0.05));
      const rangerC = c.classId === 'Ranger';
      const monkC = c.classId === 'BuddhistMage';
      t.right.emitting = monkC ? false : rangerC ? c.actionState === 'attack_3' && !!c.backSlash && c.stateTimer > 0.18 && c.stateTimer < 0.42 : swinging;
      t.left.emitting = !rangerC && !monkC && swinging && c.actionState !== 'attack_1';
      const rage = c.buffs.some((b) => b.type === 'blood_rage');
      const col = rangerC ? colorFor(i, c) : i === 0 ? (rage ? '#ff1030' : PLAYER_COLOR) : rage ? '#1f6bff' : ENEMY_COLOR;
      t.right.setColor(col, 2.2);
      t.left.setColor(col, 2.2);
      if (s.rightBase && s.rightTip) t.right.update(rawDt, s.rightBase.getWorldPosition(vA), s.rightTip.getWorldPosition(vB), now);
      else t.right.update(rawDt, null, null, now);
      if (s.leftBase && s.leftTip) t.left.update(rawDt, s.leftBase.getWorldPosition(vA), s.leftTip.getWorldPosition(vB), now);
      else t.left.update(rawDt, null, null, now);
      vfx.followFighter(i, vC.set(c.pos[0], c.pos[1], c.pos[2]));
    });
    vfx.update(dt);

    // ================= HUD =================
    headProj.set(en.pos[0], en.pos[1] + 2.25, en.pos[2]).project(camera);
    // direction to the opponent in camera space, for the off-screen arrow on the big maps
    vD.set(en.pos[0], en.pos[1] + 1, en.pos[2]).applyMatrix4(camera.matrixWorldInverse);
    // 青冥古林 at night: you can't see your opponent unless they carry a lit candle or are inside your light
    const enDist = Math.hypot(en.pos[0] - p1.pos[0], en.pos[2] - p1.pos[2]);
    const hiddenInDark = map.id === 'forest' && mapRuntime.night > 0.55 && en.candle !== 2 && enDist > (p1.candle === 2 ? 10 : 4.5);
    {
      // React state only when something visible changes (or ~8 times a second for the edge arrow); the name tag
      // itself is moved every frame without a re-render
      const visible = !hiddenInDark && headProj.z < 1 && Math.abs(headProj.x) < 1.1 && Math.abs(headProj.y) < 1.1;
      const sx = (headProj.x * 0.5 + 0.5) * size.width;
      const sy = (-headProj.y * 0.5 + 0.5) * size.height;
      onFoeTagMove?.(sx, sy);
      const R = screenRepRef.current;
      const t = performance.now();
      if (visible !== R.visible || hiddenInDark !== R.hidden || (!visible && t - R.t > 120) || t - R.t > 1000) {
        R.visible = visible;
        R.hidden = hiddenInDark;
        R.t = t;
        onDummyScreenPosUpdate?.({ visible, hidden: hiddenInDark, screenX: sx, screenY: sy, angle: Math.atan2(vD.x, -vD.z), dist: enDist });
      }
    }
    const nowMs = performance.now();
    if (nowMs - lastReportRef.current > 150) {
      lastReportRef.current = nowMs;
      onVfxCountChange?.(vfx.activeCount);
      // music leans into the battle sections when the fight gets close
      const low = Math.min(p1.hp / Math.max(1, p1.maxHp), en.hp / Math.max(1, en.maxHp));
      const near = Math.hypot(p1.pos[0] - en.pos[0], p1.pos[2] - en.pos[2]) < 6;
      gameAudio.setMusicIntensity(roundRef.current.over ? 0.2 : (aiEnabledRef.current ? 0.35 : 0.15) + (near ? 0.15 : 0) + (low < 0.35 ? 0.4 : low < 0.6 ? 0.15 : 0));
      onDebugUpdate?.({
        playerPos: [p1.pos[0], p1.pos[1], p1.pos[2]],
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        camYaw: controller ? controller.yaw : 0,
        camPitch: controller ? controller.pitch : 0.3,
        camDist: controller ? controller.distance : 5,
      });
    }

    if (net?.role === 'host' && net.status === 'connected' && nowMs - netSendRef.current > 33) {
      netSendRef.current = nowMs;
      net.send({
        t: 's',
        f: [slimFighter(p1), slimFighter(en)],
        p: projRef.current.map((pr) => [
          pr.kind,
          +pr.pos.x.toFixed(3),
          +pr.pos.y.toFixed(3),
          +pr.pos.z.toFixed(3),
          pr.stuck !== undefined || pr.falling ? 0 : +pr.vel.x.toFixed(2),
          pr.stuck !== undefined || pr.falling ? 0 : +pr.vel.y.toFixed(2),
          pr.stuck !== undefined || pr.falling ? 0 : +pr.vel.z.toFixed(2),
          pr.obj.quaternion.x,
          pr.obj.quaternion.y,
          pr.obj.quaternion.z,
          pr.obj.quaternion.w,
          colorFor(pr.slot, fighters[pr.slot]),
          pr.pierce ? 'gold' : pr.poison ? 'poison' : 'normal',
        ]),
        m: { ventHeat: mapRuntime.ventHeat, eruption: mapRuntime.eruption, waveSide: mapRuntime.waveSide, waveRise: mapRuntime.waveRise, lightning: mapRuntime.lightning, shipRoll: mapRuntime.shipRoll, shipPitch: mapRuntime.shipPitch, avalancheZ: mapRuntime.avalancheZ, avalancheWarn: mapRuntime.avalancheWarn, ridgeWarn: mapRuntime.ridgeWarn, boltT: mapRuntime.boltT, boltX: mapRuntime.boltX, boltZ: mapRuntime.boltZ, summitStage: mapRuntime.summitStage, summitWarn: mapRuntime.summitWarn, summitFall: mapRuntime.summitFall, gust: mapRuntime.gust, rain: mapRuntime.rain, storm: mapRuntime.storm, strikeWarn: mapRuntime.strikeWarn, boltY: mapRuntime.boltY, night: mapRuntime.night, skyFlash: mapRuntime.skyFlash, shadeSpot: mapRuntime.shadeSpot, branches: mapRuntime.branches.map((b) => ({ ...b })) },
        ev: net.events.splice(0),
        ts: nowMs,
      });
    }

    // ======================================================
    // guest: mirror the host's simulation, send our controls
    // ======================================================
    function guestSync(realDt: number, yaw: number, bas: { forward: THREE.Vector3; right: THREE.Vector3 }) {
      const n = net!;
      // ---- controls -> host
      if (just.lockEnemy) {
        just.lockEnemy = false;
        targeting.lockedEnemyId = targeting.lockedEnemyId ? null : en.id;
      }
      if (just.clearTarget) {
        just.clearTarget = false;
        targeting.lockedEnemyId = null;
      }
      let gx = 0;
      let gz = 0;
      if (actions.right) gx += 1;
      if (actions.left) gx -= 1;
      if (actions.forward) gz += 1;
      if (actions.backward) gz -= 1;
      const mv = vA.copy(bas.forward).multiplyScalar(gz).addScaledVector(bas.right, gx);
      if (mv.lengthSq() > 1) mv.normalize();
      for (const k of ['dodge', 'skill1', 'skill2', 'skill3', 'skill4', 'ultimate', 'attack', 'jump'] as InputKeyAction[]) just[k] = false;
      const req = input.consumeBuffer();
      n.send({ t: 'in', mx: +mv.x.toFixed(3), mz: +mv.z.toFixed(3), yaw: targeting.lockedEnemyId ? yawTo(p1.pos, en.pos) : yaw, blk: !!actions.special, int: !!actions.interact, req });

      // ---- host state -> our two fighters (we are the host's slot 1)
      const snaps = n.snaps;
      if (snaps.length) {
        // draw the host's state a little in the past, between the two snapshots around that moment
        const renderT = performance.now() - (n.clockOff ?? 0) - n.interpDelay;
        let j = snaps.length - 1;
        while (j > 0 && snaps[j - 1].ts > renderT) j--;
        const s1 = snaps[j];
        const s0 = j > 0 ? snaps[j - 1] : s1;
        const span = Math.max(1, s1.ts - s0.ts);
        // past the newest packet: extrapolate a touch, then hold
        const k = s0 === s1 ? 1 : THREE.MathUtils.clamp((renderT - s0.ts) / span, 0, j === snaps.length - 1 ? 1.25 : 1);
        // effects and sounds play when their snapshot is reached, in step with the motion
        for (const sn of snaps) {
          if (sn.used || sn.ts > renderT) continue;
          sn.used = true;
          if (sn.msg.ev.length) n.inbox.push(...sn.msg.ev);
        }
        if (!s1.used && s1 === snaps[0]) {
          s1.used = true;
          if (s1.msg.ev.length) n.inbox.push(...s1.msg.ev);
        }
        const fresh = s1 !== lastSnapRef.current;
        ([[p1, 1], [en, 0]] as [CombatantState, number][]).forEach(([c, idx], local) => {
          // ourselves: the newest state (no interpolation delay); the opponent: smoothly, a little in the past
          const a = local === 0 ? snaps[snaps.length - 1].msg.f[idx] : s0.msg.f[idx];
          const b = local === 0 ? snaps[snaps.length - 1].msg.f[idx] : s1.msg.f[idx];
          const prevHp = c.hp;
          const prevState = c.actionState;
          const shown = c.stateTimer;
          Object.assign(c, b);
          c.pos = [a.pos[0] + (b.pos[0] - a.pos[0]) * k, a.pos[1] + (b.pos[1] - a.pos[1]) * k, a.pos[2] + (b.pos[2] - a.pos[2]) * k];
          let dr = b.rotY - a.rotY;
          while (dr > Math.PI) dr -= Math.PI * 2;
          while (dr < -Math.PI) dr += Math.PI * 2;
          c.rotY = a.rotY + dr * k;
          // keep the animation clock moving forward between packets (a jump back would restart clips)
          const restarted = b.actionState !== prevState || (fresh && b.stateTimer + 0.001 < a.stateTimer && a.actionState === b.actionState);
          c.stateTimer = restarted ? b.stateTimer : Math.max(shown + realDt * 0.9, b.stateTimer);
          if (local === 0 && b.hp < prevHp - 0.5) {
            onRoundEvent?.({ type: 'playerHit', heavy: prevHp - b.hp > 120 });
            controller?.addShake(prevHp - b.hp > 120 ? 0.4 : 0.15);
          }
        });
        // ---- our own fighter: predicted locally so running and turning answer the keys at once; the host's
        // newest word on where we are pulls the prediction back in gently (hard snap only if far off)
        {
          const P = predRef.current;
          const newest = snaps[snaps.length - 1];
          const nb = newest.msg.f[1];
          const now = performance.now();
          const age = Math.min(0.25, (now - newest.at) / 1000);
          const ax = nb.pos[0] + nb.vel[0] * age;
          const az = nb.pos[2] + nb.vel[2] * age;
          const loco = (nb.actionState === 'idle' || nb.actionState === 'run' || nb.actionState === 'jump' || nb.actionState === 'block') && nb.hp > 0 && nb.treeClimb === undefined && !nb.swimming && !(nb.rootTimer > 0);
          if (!P.on) {
            P.x = ax;
            P.z = az;
            P.vx = P.vz = 0;
            P.on = true;
          }
          if (loco) {
            const mult = nb.actionState === 'block' ? 0.25 : 1;
            const spd = speedOf(p1) * mult;
            const acc = nb.isGrounded ? 18 * THREE.MathUtils.clamp((nb.grip ?? 1) * (nb.grip ?? 1) * 1.4, 0.22, 1) : 6;
            P.vx = THREE.MathUtils.damp(P.vx, mv.x * spd, acc, realDt);
            P.vz = THREE.MathUtils.damp(P.vz, mv.z * spd, acc, realDt);
            P.x += P.vx * realDt;
            P.z += P.vz * realDt;
            P.hist.push([now, P.x, P.z]);
            while (P.hist.length > 90 || (P.hist.length && P.hist[0][0] < now - 1500)) P.hist.shift();
            if (newest !== P.lastSnap) {
              P.lastSnap = newest;
              // where we predicted ourselves when the host computed this snapshot (one round trip ago)
              const back = newest.at - Math.max(30, n.pingMs || 120);
              let hx = P.x;
              let hz = P.z;
              for (let q = P.hist.length - 1; q >= 0; q--)
                if (P.hist[q][0] <= back) {
                  hx = P.hist[q][1];
                  hz = P.hist[q][2];
                  break;
                }
              const ex = nb.pos[0] - hx;
              const ez = nb.pos[2] - hz;
              if (ex * ex + ez * ez > 2.5 * 2.5) {
                P.x = ax;
                P.z = az;
                P.hist.length = 0;
              } else {
                P.x += ex * 0.3;
                P.z += ez * 0.3;
                for (const h of P.hist) {
                  h[1] += ex * 0.3;
                  h[2] += ez * 0.3;
                }
              }
            }
          } else {
            // dodges, hits, skills: the host drives us, followed closely (no interpolation delay for ourselves)
            P.x = THREE.MathUtils.damp(P.x, ax, 22, realDt);
            P.z = THREE.MathUtils.damp(P.z, az, 22, realDt);
            P.vx = nb.vel[0];
            P.vz = nb.vel[2];
            P.hist.length = 0;
          }
          p1.pos = [P.x, nb.pos[1] + Math.max(-0.5, nb.vel[1] * age), P.z];
          if (nb.isGrounded) p1.pos[1] = Math.max(p1.pos[1], groundHeight(p1) - 0.02);
          if (loco) {
            const moving = P.vx * P.vx + P.vz * P.vz > 0.25;
            if (nb.isGrounded && moving && nb.actionState === 'idle') p1.actionState = 'run';
            if (nb.isGrounded && !moving && nb.actionState === 'run') p1.actionState = 'idle';
            const want = targeting.lockedEnemyId ? yawTo(p1.pos, en.pos) : yaw;
            let d = want - p1.rotY;
            while (d > Math.PI) d -= Math.PI * 2;
            while (d < -Math.PI) d += Math.PI * 2;
            p1.rotY += d * Math.min(1, realDt * 14);
          }
        }
        if (fresh) {
          lastSnapRef.current = s1;
          Object.assign(mapRuntime, s1.msg.m);
          // projectiles: rebuild from the host's list
          for (const g of guestProjRef.current) vfx.releaseProjectile(g.obj);
          guestProjRef.current = [];
          for (const q of s1.msg.p) {
            const obj = vfx.takeProjectile(q[0], q[11], q[12]);
            if (!obj) continue;
            obj.position.set(q[1], q[2], q[3]);
            obj.quaternion.set(q[7], q[8], q[9], q[10]);
            guestProjRef.current.push({ obj, vel: new THREE.Vector3(q[4], q[5], q[6]), kind: q[0] });
          }
        }
        for (const g of guestProjRef.current) {
          g.obj.position.addScaledVector(g.vel, realDt);
          if (g.kind === 'boomerang') {
            const sp = g.obj.getObjectByName('spin');
            if (sp) sp.rotation.y += realDt * 28;
          }
        }
      }
      // ---- replay the host's effects and sounds
      for (const ev of n.inbox.splice(0)) {
        if (ev[0] === 'a') {
          const fn = (gameAudio as any)[ev[1]];
          if (typeof fn === 'function') fn.call(gameAudio);
          continue;
        }
        const fn = (vfx as any)[ev[1]];
        if (typeof fn !== 'function') continue;
        const args = (ev[2] as any[]).map((x) => (x && typeof x === 'object' && 'v3' in x ? new THREE.Vector3(x.v3[0], x.v3[1], x.v3[2]) : x));
        // slot-indexed effects: the host's slot 0 is our opponent
        const SLOT_ARG: Record<string, number> = { setVortex: 2, pillarAt: 2, glyph: 3, bell: 1, bellHit: 0, zenField: 3 };
        const si = SLOT_ARG[ev[1]];
        if (si !== undefined) args[si] = 1 - (typeof args[si] === 'number' ? args[si] : 0); // a missing slot meant the default 0
        fn.apply(vfx, args);
      }
      // sky tint from lightning / eruption, same as on the host
      bgBase.set(map.background);
      bgTmp.copy(bgBase).lerp(bgTmp.set('#7a1a06'), mapRuntime.eruption * 0.75);
      if (map.id === 'forest') bgTmp.lerp(bgRain, mapRuntime.rain * 0.72); // storm clouds
      if (map.id === 'forest') bgTmp.lerp(bgNight, mapRuntime.night * 0.92); // night
      bgTmp.lerp(bgBase.set('#dfe8ff'), mapRuntime.lightning * 0.55);
      if (scene.background instanceof THREE.Color) scene.background.copy(bgTmp);
      if (scene.fog) (scene.fog as THREE.Fog).color.copy(bgTmp);
    }

    // ======================================================
    // helpers (closures over this frame's values)
    // ======================================================
    function isFree(c: CombatantState) {
      return c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'block' || c.actionState === 'jump';
    }

    function phaseOf(c: CombatantState) {
      const cfg = phasesFor(c)[c.actionState];
      if (!cfg || c.stateDuration <= 0) return { phase: 'none' as const, progress: 0 };
      const t = c.stateTimer;
      if (t < cfg.startup) return { phase: 'startup' as const, progress: t / Math.max(0.0001, cfg.startup) };
      if (t < cfg.startup + cfg.active) return { phase: 'active' as const, progress: (t - cfg.startup) / Math.max(0.0001, cfg.active) };
      return { phase: 'recovery' as const, progress: (t - cfg.startup - cfg.active) / Math.max(0.0001, cfg.recovery) };
    }

    function executeIntent(slot: number, c: CombatantState, foe: CombatantState, intent: Intent): boolean {
      if (c.hp <= 0) return false;
      const isPlayer = slot === 0;
      const ranger = c.classId === 'Ranger';
      const skills = CLASS_CONFIGS[c.classId].skills;
      const dbg = input.debug;
      const cur = c.actionState;
      const cfgCur = phasesFor(c)[cur];
      const { phase, progress } = phaseOf(c);
      const free = isFree(c);
      const basic = cur.startsWith('attack_');
      const canDodge = free || (!!cfgCur?.cancelableByDodge && (phase === 'recovery' || (basic && phase === 'startup')));
      const canSkill = free || (basic && phase === 'recovery') || (!!cfgCur?.cancelableBySkill && phase === 'recovery');
      const canJump = c.isGrounded && (free || (basic && phase === 'recovery'));
      const hasMove = intent.move.lengthSq() > 0.01;

      if (phase === 'recovery' && progress >= 0.6 && hasMove && cur !== 'dodge' && !free) {
        c.actionState = c.isGrounded ? 'run' : 'jump';
        c.stateDuration = 0;
      }

      const req = intent.request;
      if (!req) return false;


      // Soft lock: attacks snap toward a nearby opponent that is roughly in front
      {
        const fd = Math.hypot(foe.pos[0] - c.pos[0], foe.pos[2] - c.pos[2]);
        const range = ranger ? 22 : c.classId === 'BuddhistMage' ? 5.5 : 4.2;
        if (fd < range && foe.hp > 0) {
          const ty = yawTo(c.pos, foe.pos);
          let dd = ty - intent.faceYaw;
          while (dd > Math.PI) dd -= Math.PI * 2;
          while (dd < -Math.PI) dd += Math.PI * 2;
          if (Math.abs(dd) < (ranger && fd > 4.2 ? 0.4 : 1.25)) intent.faceYaw = ty;
        }
      }
      const start = (next: CharacterActionState, push = 0) => {
        const cfg = phasesFor(c)[next]!;
        c.actionState = next;
        c.stateTimer = 0;
        c.stateDuration = cfg.totalDuration;
        c.hasHitCurrentMove = false;
        c.multiHitCounter = 0;
        c.actionsPerformed += 1;
        c.airSlam = false;
        c.airSlash = false;
        c.dodgeSlash = false;
        c.rotY = intent.faceYaw;
        c.targetRotY = intent.faceYaw;
        if (push > 0) {
          c.vel[0] = -Math.sin(intent.faceYaw) * push;
          c.vel[2] = -Math.cos(intent.faceYaw) * push;
        }
      };
      const report = (attempt: string, result: string) => {
        if (isPlayer) {
          dbg.lastSkillAttempted = attempt;
          dbg.lastSkillResult = result;
        }
      };
      const paySkill = (idx: number, key: string, label: string) => {
        const sk = skills[idx];
        if (c.cooldowns[key] > 0) return report(`${label}: ${sk.name}`, `冷却中 (${c.cooldowns[key].toFixed(1)}s)`), false;
        if ((c.silenceTimer ?? 0) > 0) return report(`${label}: ${sk.name}`, `被封印 (${(c.silenceTimer ?? 0).toFixed(1)}s)`), false;
        if (c.mp < sk.mpCost) return report(`${label}: ${sk.name}`, `MP不足 (需 ${sk.mpCost})`), false;
        if (!canSkill) return report(`${label}: ${sk.name}`, `被 [${cur} ${phase}] 占用`), false;
        c.mp -= sk.mpCost;
        c.cooldowns[key] = sk.cooldown;
        report(`${label}: ${sk.name}`, '成功施放 (Cast)');
        return true;
      };
      if (c.treeClimb !== undefined) {
        if (c.climbMode !== 'ladder' || req !== 'jump') return report('出招', c.climbMode === 'ladder' ? '在梯子上，按空格跳下来' : '梯云纵上树中'), false;
        // jump off the ladder, away from the trunk
        const pl = (map.pillars || [])[c.treeClimb];
        const ox = c.pos[0] - pl.x;
        const oz = c.pos[2] - pl.z;
        const od = Math.hypot(ox, oz) || 1;
        c.treeClimb = undefined;
        c.climbing = false;
        c.isGrounded = false;
        c.vel = [(ox / od) * 5, 5, (oz / od) * 5];
        c.actionState = 'jump';
        c.stateDuration = 0;
        gameAudio.playJump();
        return true;
      }
      if (req === 'jump' && startTreeRun(c, intent)) return true;
      if (c.swimming && req !== 'dodge' && req !== 'jump') return report('出招', '游泳中无法出招'), false;
      if (c.swimming && req === 'jump') {
        // scramble out onto a bank or a stepping stone if one is within reach, otherwise just bob
        const f = fwdOf(intent.move.lengthSq() > 0.01 ? Math.atan2(-intent.move.x, -intent.move.z) : c.rotY);
        let reach = false;
        for (let d = 0.5; d <= 2.6 && !reach; d += 0.35) {
          const x = c.pos[0] + f.x * d;
          const z = c.pos[2] + f.z * d;
          if (groundAt(x, z, c.pos[1] + 2.5) > c.pos[1] + 0.3) reach = true;
        }
        if (!reach) return report('跳跃', '水太深，游到岸边再跳'), false;
        c.isGrounded = false;
        c.swimming = false;
        c.vel = [f.x * 4, 8, f.z * 4];
        c.actionState = 'jump';
        c.stateDuration = 0;
        vfx.dustPuff(vB.set(c.pos[0], FOREST.waterY + 0.05, c.pos[2]), 10, 0.5, 2, 0.5, '#dbeafe');
        gameAudio.playJump();
        return true;
      }
      // 受身: dodge out of hitstun / launch / knockdown (long cooldown)
      const stunned = cur === 'hitstun' || cur === 'launched' || cur === 'knockdown' || cur === 'buried';
      if (stunned) {
        if (req !== 'dodge') return false;
        if ((c.cooldowns.breakout ?? 0) > 0) return report('受身', `冷却中 (${(c.cooldowns.breakout ?? 0).toFixed(1)}s)`), false;
        c.cooldowns.breakout = ranger ? 10 : c.classId === 'BuddhistMage' ? 12 : 15;
        const dir = vA.copy(intent.move);
        if (dir.lengthSq() < 0.01) dir.set(c.pos[0] - foe.pos[0], 0, c.pos[2] - foe.pos[2]);
        dir.y = 0;
        if (dir.lengthSq() < 0.0001) dir.copy(fwdOf(c.rotY)).multiplyScalar(-1);
        dir.normalize();
        if (cur === 'buried') {
          c.pos[1] = fy(c.pos[0], c.pos[2]);
          c.isGrounded = true;
        }
        c.actionState = 'dodge';
        c.stateTimer = 0;
        c.stateDuration = phasesFor(c).dodge!.totalDuration;
        c.rotY = c.targetRotY = Math.atan2(-dir.x, -dir.z);
        const sp = ranger ? 18 : 14;
        c.vel[0] = dir.x * sp;
        c.vel[2] = dir.z * sp;
        if (!c.isGrounded) c.vel[1] = Math.max(c.vel[1], 4);
        c.dodgeIframeTimer = 0.55;
        c.perfectDodgeUsed = true;
        c.stunLoad = 0;
        c.juggleCount = 0;
        vfx.ring(vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 1.8, '#f8fafc', 0.35, 0.1, 0.3);
        vfx.damageNumber(vC.set(c.pos[0], c.pos[1] + 2.2, c.pos[2]), '受身', true, '#f8fafc');
        gameAudio.playDodge();
        report('受身', '成功脱离');
        return true;
      }
      const color = colorFor(slot, c);
      const rooted = (c.rootTimer ?? 0) > 0 && c.isGrounded;
      if (rooted && (req === 'dodge' || req === 'jump')) return report(req === 'dodge' ? '闪避' : '跳跃', '被定身'), false;

      if (ranger && req !== 'dodge' && req !== 'jump') {
        const f = fwdOf(intent.faceYaw).clone();
        switch (req) {
          case 'attack': {
            let next: CharacterActionState | null = null;
            if (free || (cur === 'dodge' && c.stateTimer > 0.22)) next = 'attack_1';
            else if (cur === 'attack_1' && phase === 'recovery') next = 'attack_2';
            else if (cur === 'attack_2' && phase === 'recovery') next = 'attack_3';
            else if (cur === 'attack_3' && !c.backSlash && phase === 'recovery') next = 'attack_1';
            if (!next) return report('普攻', `被 [${cur} ${phase}] 占用`), false;
            start(next);
            c.volleyShots = 0;
            c.backSlash = false;
            report('普攻', next === 'attack_3' ? '三连镖' : '飞镖');
            return true;
          }
          case 'special': {
            if ((c.cooldowns.special ?? 0) > 0) return report('右键: 撩刀后撤', '冷却中'), false;
            if (!canSkill && !canDodge) return report('右键: 撩刀后撤', `被 [${cur} ${phase}] 占用`), false;
            c.cooldowns.special = 2.5;
            start('attack_3', rooted ? 0 : 4);
            c.stateDuration = 0.6; // spinning kick + knife, longer than the dart fan
            c.backSlash = true;
            c.volleyShots = 0;
            gameAudio.playKick();
            report('右键: 撩刀后撤', '成功施放 (Cast)');
            return true;
          }
          case 'skill1':
          case 'skill2': {
            const one = req === 'skill1';
            if (!paySkill(one ? 0 : 1, req, one ? '1' : '2')) return false;
            start(one ? 'skill_1' : 'skill_2');
            c.volleyShots = 0;
            gameAudio.playThrowHeavy();
            return true;
          }
          case 'skill3': {
            if (!paySkill(2, 'skill3', '3')) return false;
            start('skill_3');
            c.volleyShots = 0;
            if (!rooted) {
              c.vel[0] = -f.x * 17;
              c.vel[2] = -f.z * 17;
            }
            c.vel[1] = 7.5;
            c.isGrounded = false;
            c.dodgeIframeTimer = Math.max(c.dodgeIframeTimer, 0.4);
            c.perfectDodgeUsed = true;
            vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 10, 0.4, 2, 0.5);
            gameAudio.playDodge();
            return true;
          }
          case 'skill4': {
            if (!paySkill(3, 'skill4', '4')) return false;
            start('skill_4');
            c.poisonBuff = 3;
            vfx.ring(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]) + 0.05, c.pos[2]), 1.8, '#22c55e', 0.5, 0.12, 0.35);
            vfx.embers(vC.set(c.pos[0], 0.4, c.pos[2]), 30, '#4ade80', 0.6, 2.5, 0.07);
            gameAudio.playPowerupChime();
            return true;
          }
          case 'ultimate': {
            if (!paySkill(4, 'ultimate', 'R')) return false;
            start('ultimate');
            c.vel[0] = 0;
            c.vel[2] = 0;
            c.vel[1] = 12;
            c.isGrounded = false;
            c.volleyShots = 0;
            const fd = Math.hypot(foe.pos[0] - c.pos[0], foe.pos[2] - c.pos[2]);
            c.rainCenter = foe.hp > 0 && fd < 14 ? [foe.pos[0], foe.pos[2]] : [c.pos[0] + f.x * 7, c.pos[2] + f.z * 7];
            vfx.ring(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]) + 0.05, c.pos[2]), 2.2, color, 0.5, 0.12, 0.4);
            vfx.embers(vC.set(c.pos[0], 0.3, c.pos[2]), 30, color, 0.6, 4, 0.08);
            gameAudio.playVictoryFanfare();
            return true;
          }
        }
        return false;
      }

      if (c.classId === 'BuddhistMage' && (req === 'attack' || req.startsWith('skill') || req === 'ultimate')) {
        return executeMonk(slot, c, foe, intent, req, { cur, phase, free, canSkill, start, paySkill, report, color });
      }

      switch (req) {
        case 'special':
          return true; // berserker / monk: right click is block (held), nothing to cast
        case 'dodge': {
          if (c.dodgeCooldownTimer > 0 || !canDodge) return report('闪避', '无法闪避'), false;
          const dodgeCost = inZen(c) ? 40 : 25;
          if ((c.stamina ?? 100) < dodgeCost) {
            if (isPlayer) vfx.damageNumber(vC.set(c.pos[0], c.pos[1] + 2.2, c.pos[2]), '体力不足', false, '#a3a3a3');
            return report('闪避', '体力不足'), false;
          }
          c.stamina = (c.stamina ?? 100) - dodgeCost;
          c.staminaDelay = 0.7;
          const dir = vA.copy(intent.move);
          if (dir.lengthSq() < 0.01) dir.copy(fwdOf(intent.faceYaw));
          dir.y = 0;
          dir.normalize();
          const rollYaw = Math.atan2(-dir.x, -dir.z);
          c.actionState = 'dodge';
          c.stateTimer = 0;
          c.stateDuration = phasesFor(c).dodge!.totalDuration;
          c.rotY = c.targetRotY = rollYaw;
          c.vel[0] = dir.x * (ranger ? 18 : 15);
          c.vel[2] = dir.z * (ranger ? 18 : 15);
          c.dodgeIframeTimer = ranger ? 0.42 : 0.35;
          c.dodgeCooldownTimer = ranger ? 0.3 : 0.45; // stamina is the real limit now
          c.perfectDodgeUsed = false;
          vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 10, 0.4, 2, 0.55);
          gameAudio.playDodge();
          report('闪避', '成功施放 (Cast)');
          return true;
        }
        case 'jump': {
          // 暗器: second jump in mid-air (with a somersault)
          const airOk = cur === 'jump' || cur === 'idle' || cur === 'run' || (cur.startsWith('attack_') && phase === 'recovery') || (cur.startsWith('skill_') && phase === 'recovery');
          if (ranger && !c.isGrounded && !c.doubleJumped && airOk && (c.stamina ?? 100) >= 15) {
            c.stamina = (c.stamina ?? 100) - 15;
            c.staminaDelay = 0.5;
            c.doubleJumped = true;
            c.doubleJumpTimer = 0.45;
            c.vel[1] = jumpVel * 0.95;
            const mv = intent.move;
            if (mv.lengthSq() > 0.01) {
              const sp = speedOf(c);
              c.vel[0] = mv.x * sp;
              c.vel[2] = mv.z * sp;
            }
            c.actionState = 'jump';
            c.stateDuration = 0;
            vfx.ring(vB.set(c.pos[0], c.pos[1] + 0.1, c.pos[2]), 1.1, color, 0.3, 0.08, 0.2);
            vfx.embers(vC.set(c.pos[0], c.pos[1] + 0.3, c.pos[2]), 10, '#e0fdfa', 0.4, -1.5, 0.06);
            gameAudio.playJump();
            report('跳跃', '二段跳');
            return true;
          }
          if (!canJump) return report('跳跃', '无法起跳'), false;
          c.vel[1] = jumpVel;
          c.isGrounded = false;
          c.actionState = 'jump';
          c.stateDuration = 0;
          vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 6, 0.3, 1.2, 0.45);
          gameAudio.playJump();
          report('跳跃', '成功起跳');
          return true;
        }
        case 'attack': {
          // 下劈: left click while airborne
          if (!c.isGrounded && (cur === 'jump' || cur === 'idle' || cur === 'run')) {
            start('attack_3', 2);
            c.stateDuration = 3; // ends on landing
            c.vel[1] = Math.min(c.vel[1], -16);
            c.airSlash = true;
            gameAudio.playSwingHeavy();
            report('普攻', '下劈');
            return true;
          }
          // 回身斩: left click during the back half of a dodge or right after it
          if (c.isGrounded && ((cur === 'dodge' && c.stateTimer > 0.18) || (free && gt - (c.dodgeEndAt ?? -9) < 0.3))) {
            start('attack_2', 13);
            c.dodgeSlash = true;
            vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 8, 0.3, 2, 0.5);
            gameAudio.playSwingHeavy();
            report('普攻', '回身斩');
            return true;
          }
          let next: CharacterActionState | null = null;
          if (free) next = 'attack_1';
          else if (cur === 'attack_1' && phase === 'recovery') next = 'attack_2';
          else if (cur === 'attack_2' && phase === 'recovery') next = 'attack_3';
          if (!next) return report('普攻', `被 [${cur} ${phase}] 占用`), false;
          start(next, phasesFor(c)[next]!.forwardMomentum);
          if (next === 'attack_3') gameAudio.playSwingHeavy();
          else gameAudio.playSwingLight();
          report('普攻', `施放 ${next.slice(-1)} 段斩`);
          return true;
        }
        case 'skill1': {
          if (!paySkill(0, 'skill1', '1')) return false;
          start('skill_1', phasesFor(c).skill_1!.forwardMomentum);
          if (!c.isGrounded) {
            // 钉地斩: dive straight down, impact on landing
            c.vel[1] = -24;
            c.vel[0] *= 0.3;
            c.vel[2] *= 0.3;
            c.airSlam = true;
            c.stateDuration = 3; // ends on landing
            report('1: 裂地斩', '钉地斩');
          } else {
            c.vel[1] = 5.5;
            c.isGrounded = false;
          }
          gameAudio.playSwingHeavy();
          return true;
        }
        case 'skill2': {
          if (!paySkill(1, 'skill2', '2')) return false;
          start('skill_2', 0);
          vfx.setVortex(true, phasesFor(c).skill_2!.totalDuration, slot);
          vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 18, 1, 3, 0.7);
          gameAudio.playWhirl();
          return true;
        }
        case 'skill3': {
          if (!paySkill(2, 'skill3', '3')) return false;
          start('skill_3', phasesFor(c).skill_3!.forwardMomentum);
          vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 14, 0.5, 2.5, 0.6);
          gameAudio.playCharge();
          return true;
        }
        case 'skill4': {
          const sk = skills[3];
          if (c.cooldowns.skill4 > 0 || !canSkill || (c.silenceTimer ?? 0) > 0) return report(`4: ${sk.name}`, '无法施放'), false;
          c.hp = Math.max(1, c.hp - Math.round(c.hp * 0.1));
          c.cooldowns.skill4 = sk.cooldown;
          start('skill_4');
          c.buffs = c.buffs.filter((b) => b.type !== 'blood_rage');
          c.buffs.push({ id: `rage_${slot}_${Date.now()}`, type: 'blood_rage', duration: 8, value: 0.35 });
          vfx.pillarAt(1.1, isPlayer ? '#ff1f1f' : '#1f6bff', slot);
          vfx.ring(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 2.6, isPlayer ? '#ff2a1a' : '#2a8bff', 0.6, 0.14, 0.5);
          vfx.embers(vC.set(c.pos[0], 0.2, c.pos[2]), 45, isPlayer ? '#ff3b2a' : '#3b8bff', 0.7, 3.5, 0.08);
          if (isPlayer) {
            controller?.addShake(0.25);
            onBloodRageFlash?.();
            gameAudio.playRage();
          }
          report(`4: ${sk.name}`, '成功施放 (Cast)');
          return true;
        }
        case 'ultimate': {
          if (!paySkill(4, 'ultimate', 'R')) return false;
          start('ultimate', phasesFor(c).ultimate!.forwardMomentum);
          c.vel[1] = 13;
          c.isGrounded = false;
          c.ultSlamStarted = false;
          vfx.ring(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 2.2, color, 0.5, 0.12, 0.4);
          vfx.dustPuff(vB, 20, 0.8, 3.5, 0.8);
          gameAudio.playUltRise();
          return true;
        }
      }
      void foe;
      return false;
    }

    function applyMovement(c: CombatantState, intent: Intent) {
      const st = c.actionState;
      const ranger = c.classId === 'Ranger';
      const bers = c.classId === 'Berserker';
      const monk = c.classId === 'BuddhistMage';
      const whirl = bers && st === 'skill_2';
      const charge = bers && st === 'skill_3';
      const dodging = st === 'dodge';
      const rangerThrow = ranger && (st === 'attack_1' || st === 'attack_2' || st === 'skill_4');
      const blocking = !ranger && intent.block && c.isGrounded && c.hp > 0 && (st === 'idle' || st === 'run' || st === 'block');
      if (blocking && !c.isBlocking) c.blockStart = gt;
      c.isBlocking = blocking;
      if (blocking) {
        c.actionState = 'block';
        c.stateDuration = 0;
      } else if (st === 'block') c.actionState = 'idle';
      c.hasSuperArmor = ranger ? c.actionState === 'ultimate' : monk ? c.actionState === 'ultimate' || (c.bellTimer ?? 0) > 0 : ARMOR_STATES.has(c.actionState);

      // local move (x = right, z = forward relative to facing) drives strafe/backpedal animation
      const f = fwdOf(c.rotY);
      const rX = Math.cos(c.rotY);
      const rZ = -Math.sin(c.rotY);
      c.localMove = [intent.move.x * rX + intent.move.z * rZ, intent.move.x * f.x + intent.move.z * f.z];

      if (map.id === 'forest' && (ladderClimb(c, intent) || treeClimb(c, intent))) return;
      const canMove = !dodging && !charge && c.hp > 0 && (c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'jump' || c.actionState === 'block' || whirl || rangerThrow);
      if (canMove) {
        if (intent.move.lengthSq() > 0.01) {
          vA.copy(intent.move);
          const lz2 = c.localMove[1];
          let mult = lz2 < -0.3 ? 0.6 : Math.abs(c.localMove[0]) > 0.7 ? 0.85 : 1;
          if (whirl) mult = 0.45;
          if (rangerThrow) mult = 0.8;
          if (c.actionState === 'block') mult = 0.25;
          if (c.buffs.some((b) => b.type === 'blood_rage')) mult *= 1.15;
          if (inZen(c)) mult *= 0.5;
          if (c.swimming) mult *= 0.55;
          else if (map.id === 'forest' && waterDepth(c.pos[0], c.pos[2]) > 0.15 && c.pos[1] < FOREST.waterY) mult *= 0.65; // wading
          const spd = speedOf(c) * mult * Math.min(1, vA.length());
          vA.normalize();
          const mu = map.id === 'forest' && c.isGrounded ? c.grip ?? 1 : 1;
          const accel = c.isGrounded ? 18 * THREE.MathUtils.clamp(mu * mu * 1.4, 0.22, 1) : 6;
          c.vel[0] = THREE.MathUtils.damp(c.vel[0], vA.x * spd, accel, dt);
          c.vel[2] = THREE.MathUtils.damp(c.vel[2], vA.z * spd, accel, dt);
          if (c.swimming) c.targetRotY = Math.atan2(-vA.x, -vA.z); // swim the way you're going
          else if (!whirl) c.targetRotY = intent.faceYaw;
          if (c.isGrounded && c.actionState === 'idle') c.actionState = 'run';
        } else {
          // on a slick floor you skid to a stop
          const stopK = map.id === 'forest' && c.isGrounded ? 14 * THREE.MathUtils.clamp((c.grip ?? 1) * (c.grip ?? 1) * 1.4, 0.18, 1) : 14;
          c.vel[0] = THREE.MathUtils.damp(c.vel[0], 0, stopK, dt);
          c.vel[2] = THREE.MathUtils.damp(c.vel[2], 0, stopK, dt);
          if (c.isGrounded && c.actionState === 'run') c.actionState = 'idle';
          if (c.actionState === 'idle' || c.actionState === 'block') c.targetRotY = intent.faceYaw;
        }
      }
      if (map.terrain && map.id !== 'forest') climb(c, intent);
    }

    /**
     * 青冥古林 lookout trees, 梯云纵: run at a lookout tree and jump, and you go up it in three kicks off the bark,
     * spiralling round the trunk, then flip over the rail onto the deck. About one second, costs stamina.
     * A hit on the way up knocks you off. Returns true while the move is running (normal movement is skipped).
     */
    function startTreeRun(c: CombatantState, intent: Intent): boolean {
      if (map.id !== 'forest' || !c.isGrounded || c.swimming || c.hp <= 0) return false;
      const i = fighters.indexOf(c);
      const mv = intent.move;
      const dir = mv.lengthSq() > 0.04 ? vA.set(mv.x, 0, mv.z).normalize() : vA.copy(fwdOf(c.rotY));
      let best = -1;
      let bestD = 1e9;
      (map.pillars || []).forEach((pl, k) => {
        if (!pl.climb || c.pos[1] > (pl.h ?? 0) - 0.6) return;
        const dx = pl.x - c.pos[0];
        const dz = pl.z - c.pos[2];
        const d = Math.hypot(dx, dz);
        if (d > pl.r + 2.6) return;
        // standing at the ladder: that's F, not 梯云纵
        if (pl.ladder !== undefined && Math.hypot(c.pos[0] - (pl.x + Math.cos(pl.ladder) * (pl.r + 0.45)), c.pos[2] - (pl.z + Math.sin(pl.ladder) * (pl.r + 0.45))) < 1.5) return;
        // close to the trunk: any direction works; a bit further out you have to be heading for it
        if (d > pl.r + 1.2 && (dir.x * dx + dir.z * dz) / d < 0.2) return;
        // the AI only goes up after you
        if (aiOn && i === 1 && !(fighters[0].pos[1] > (pl.h ?? 0) - 1 && Math.hypot(fighters[0].pos[0] - pl.x, fighters[0].pos[2] - pl.z) < (pl.deck ?? pl.r) + 0.5)) return;
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      if (best < 0) return false;
      if ((c.stamina ?? 0) < 25) {
        if (i === 0) onRoundEvent?.({ type: 'toast', text: '体力不够，上不去树' });
        return false;
      }
      const pl = map.pillars![best];
      c.stamina = (c.stamina ?? 0) - 25;
      c.staminaDelay = 1.2;
      c.treeClimb = best;
      c.climbMode = 'run';
      c.climbT = 0;
      c.climbA0 = Math.atan2(c.pos[2] - pl.z, c.pos[0] - pl.x);
      c.climbY0 = c.pos[1];
      // spiral the way you were drifting round the trunk
      const tx = -(c.pos[2] - pl.z);
      const tz = c.pos[0] - pl.x;
      c.climbSide = mv.x * tx + mv.z * tz < 0 ? -1 : 1;
      c.climbing = true;
      c.isGrounded = true;
      c.vel = [0, 0, 0];
      c.actionState = 'jump';
      c.stateTimer = 0;
      c.stateDuration = 0;
      gameAudio.playJump();
      return true;
    }

    /**
     * Rope ladders on the lookout trees: stand at the foot and hold F (or push toward the trunk) to climb,
     * S climbs down, let go and you hang there, Space jumps off. At the top you step onto the deck.
     */
    function ladderClimb(c: CombatantState, intent: Intent) {
      const pillars = map.pillars || [];
      if (c.treeClimb === undefined) {
        c.nearLadder = false;
        const st = c.actionState;
        if (!c.isGrounded || c.swimming || c.hp <= 0 || !(st === 'idle' || st === 'run' || st === 'block')) return false;
        let hit = -1;
        pillars.forEach((pl, k) => {
          if (pl.ladder === undefined || c.pos[1] > (pl.h ?? 0) - 0.6) return;
          const R = pl.r + 0.45;
          if (Math.hypot(c.pos[0] - (pl.x + Math.cos(pl.ladder) * R), c.pos[2] - (pl.z + Math.sin(pl.ladder) * R)) < 1.4) hit = k;
        });
        if (hit < 0) return false;
        c.nearLadder = true;
        c.interactHint = '按住 F 爬梯子';
        if (!intent.interact) return false;
        c.treeClimb = hit;
        c.climbMode = 'ladder';
        c.climbing = true;
        c.isGrounded = true;
        c.isBlocking = false;
        c.vel = [0, 0, 0];
        c.actionState = 'idle';
        c.stateDuration = 0;
      }
      if (c.climbMode !== 'ladder') return false;
      c.nearLadder = false;
      const pl = pillars[c.treeClimb];
      const a = pl.ladder ?? 0;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const R = pl.r + 0.45;
      c.pos[0] = pl.x + dx * R;
      c.pos[2] = pl.z + dz * R;
      const mv = intent.move;
      const ml = mv.length();
      const toward = ml > 0.1 ? -(mv.x * dx + mv.z * dz) / ml : 0; // +1 = pushing into the trunk
      const up = !!intent.interact || toward > 0.3;
      const down = !intent.interact && toward < -0.3;
      const vy = up ? 3.2 : down ? -3.6 : 0;
      c.pos[1] += vy * dt;
      c.climbRate = vy;
      c.vel = [0, 0, 0];
      c.rotY = c.targetRotY = yawTo(c.pos, [pl.x, 0, pl.z]);
      const floor = terrainHeight(map.id, c.pos[0], c.pos[2]);
      const release = () => {
        c.treeClimb = undefined;
        c.climbing = false;
        c.climbRate = 0;
        c.isGrounded = true;
      };
      if (c.pos[1] >= (pl.h ?? 0) - 0.05) {
        // through the gap in the rail and onto the deck
        release();
        c.pos[0] = pl.x + dx * (pl.r + 0.75);
        c.pos[2] = pl.z + dz * (pl.r + 0.75);
        c.pos[1] = pl.h ?? c.pos[1];
        c.rotY = c.targetRotY = yawTo([pl.x, 0, pl.z], c.pos);
        gameAudio.playLand();
        return false;
      }
      if (c.pos[1] <= floor) {
        c.pos[1] = floor;
        if (down) {
          release();
          return false;
        }
      }
      return true;
    }

    function treeClimb(c: CombatantState, _intent: Intent) {
      if (c.treeClimb === undefined || c.climbMode === 'ladder') return false;
      const pl = (map.pillars || [])[c.treeClimb];
      const T = TREE_RUN_T;
      const prevT = c.climbT ?? 0;
      const t = Math.min(T, prevT + dt);
      c.climbT = t;
      const u = t / T;
      // three kicks: each one a quick rise, then a short hang
      const steps = 3;
      const k = Math.min(steps - 1, Math.floor(u * steps));
      const f = u * steps - k;
      const rise = (k + THREE.MathUtils.smootherstep(f, 0, 0.75)) / steps;
      const top = (pl.h ?? 0) + 1.2; // clear the rail
      const y0 = c.climbY0 ?? c.pos[1];
      const a = (c.climbA0 ?? 0) + (c.climbSide ?? 1) * 1.1 * u;
      // the first two kicks hug the trunk below the deck; the last one swings out past the deck's edge
      // (never up through the planks) and arcs back in over the rail
      const outer = (pl.deck ?? pl.r + 1.25) + 0.55;
      const R0 = k < 2 ? pl.r + 0.55 + Math.sin(Math.min(1, f / 0.75) * Math.PI) * 0.25 : THREE.MathUtils.lerp(pl.r + 0.55, outer, Math.min(1, f * 3));
      // keep the climber under the deck until they are out past its edge
      const under = (pl.h ?? 0) - 1.6;
      c.pos[0] = pl.x + Math.cos(a) * R0;
      c.pos[2] = pl.z + Math.sin(a) * R0;
      let y = y0 + (top - y0) * rise;
      if (k === 2 && Math.hypot(c.pos[0] - pl.x, c.pos[2] - pl.z) < outer - 0.2) y = Math.min(y, under);
      c.pos[1] = y;
      // over the rail: come back in toward the trunk as the flip lands
      if (k === 2 && f > 0.7) {
        const back = (f - 0.7) / 0.3;
        const Rin = THREE.MathUtils.lerp(outer, pl.r + 0.8, back);
        c.pos[0] = pl.x + Math.cos(a) * Rin;
        c.pos[2] = pl.z + Math.sin(a) * Rin;
      }
      c.vel = [0, 0, 0];
      c.rotY = c.targetRotY = yawTo(c.pos, [pl.x, 0, pl.z]);
      // a puff of bark and a ring of qi at every kick
      if (Math.floor(prevT / (T / steps)) !== k || prevT === 0) {
        const bx = pl.x + Math.cos(a) * pl.r;
        const bz = pl.z + Math.sin(a) * pl.r;
        vfx.dustPuff(vB.set(bx, c.pos[1] + 0.2, bz), 6, 0.25, 1.4, 0.4, '#9a8a6a');
        vfx.ring(vC.set(c.pos[0], c.pos[1] + 0.1, c.pos[2]), 0.9, '#e0f2fe', 0.35, 0.06, 0.2);
        if (prevT > 0) gameAudio.playDodge();
        if (prevT === 0 && fighters.indexOf(c) === 0) vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 2.3, c.pos[2]), '梯云纵', true, '#e0f2fe');
      }
      if (t >= T) {
        // over the rail and onto the deck, facing out over the forest
        c.treeClimb = undefined;
        c.climbing = false;
        const Rd = pl.r + 0.8;
        c.pos[0] = pl.x + Math.cos(a) * Rd;
        c.pos[2] = pl.z + Math.sin(a) * Rd;
        c.pos[1] = pl.h ?? c.pos[1];
        c.isGrounded = true;
        c.actionState = 'idle';
        c.rotY = c.targetRotY = yawTo([pl.x, 0, pl.z], c.pos);
        vfx.dustPuff(vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 6, 0.3, 1.2, 0.4, '#9a8a6a');
        gameAudio.playLand();
        return false;
      }
      return true;
    }

    /**
     * 雪岭冰峰 climbing. Hauling yourself up a steep face drains 体力 fast and slows you right down;
     * run dry and you slide back to the bottom. The mountain path is gentle enough to walk for free.
     * Standing still on the steep face, the snow slowly gives way under you.
     */
    function climb(c: CombatantState, intent: Intent) {
      c.climbing = false;
      c.sliding = false;
      if (!c.isGrounded || c.hp <= 0 || c.actionState === 'buried' || c.actionState === 'launched' || c.actionState === 'knockdown') return;
      const [gx, gz] = terrainGradient(map.id, c.pos[0], c.pos[2]);
      const steep = Math.hypot(gx, gz);
      if (steep < 0.75) return; // valley floor, plateau and the mountain path
      const ux = gx / steep;
      const uz = gz / steep;
      const mv = intent.move;
      const along = mv.lengthSq() > 0.01 ? (mv.x * ux + mv.z * uz) / Math.max(0.001, mv.length()) : 0; // +1 = straight uphill
      const noClimb = map.id === 'glacier';
      if (along > 0.3 && !noClimb) {
        if ((c.stamina ?? 0) > 0.5) {
          // climbing: slow, costly, steeper costs more
          c.climbing = true;
          const ml = Math.max(0.001, mv.length());
          const climbSpeed = speedOf(c) * 0.42;
          c.vel[0] = (mv.x / ml) * climbSpeed;
          c.vel[2] = (mv.z / ml) * climbSpeed;
          c.stamina = Math.max(0, (c.stamina ?? 0) - dt * (16 + steep * 9) * along);
          c.staminaDelay = 0.8;
          return;
        }
      }
      // no grip left (or not climbing): the snow slides you back down the face
      const exhausted = !noClimb && (c.stamina ?? 0) <= 0.5 && along > 0.3;
      const slip = exhausted ? 6.5 : steep > 1.05 && mv.lengthSq() < 0.01 && !c.isBlocking ? 1.4 : 0;
      if (slip > 0) {
        c.sliding = exhausted;
        c.vel[0] = THREE.MathUtils.damp(c.vel[0], -ux * slip, 10, dt);
        c.vel[2] = THREE.MathUtils.damp(c.vel[2], -uz * slip, 10, dt);
        if (exhausted && Math.random() < 0.3) vfx.dustPuff(vB.set(c.pos[0], c.pos[1] + 0.1, c.pos[2]), 2, 0.3, 1.2, 0.5, map.id === 'rooftop' ? '#9fb3d9' : '#f1f5f9');
        if (exhausted) c.staminaDelay = 1.2;
      }
    }

    function applyHit(
      slot: number,
      att: CombatantState,
      def: CombatantState,
      base: number,
      oIn: { heavy?: boolean; crit?: boolean; launch?: number; knock?: number; state?: CharacterActionState; dur?: number; shake?: number; unblockable?: boolean; noMark?: boolean; noStop?: boolean; ranged?: boolean; flinch?: boolean; breakArmor?: boolean }
    ) {
      if (def.hp <= 0) return;
      const o = { ...oIn };
      const attackerIsPlayer = slot === 0;
      const hitDir = vC.set(def.pos[0] - att.pos[0], 0, def.pos[2] - att.pos[2]).normalize();
      const chest = vB.set(def.pos[0], def.pos[1] + 1.15, def.pos[2]).addScaledVector(hitDir, -0.35);
      const color = colorFor(slot, att);

      // dodge i-frames / wake-up invulnerability
      if (def.dodgeIframeTimer > 0) {
        if (def.actionState === 'dodge' && !def.perfectDodgeUsed && def.stateTimer < 0.24) {
          // Perfect dodge: slow motion + counter bonus
          def.perfectDodgeUsed = true;
          def.counterTimer = 1.6;
          slowMoTimerRef.current = Math.max(slowMoTimerRef.current, 0.45);
          vfx.ring(vA.set(def.pos[0], fy(def.pos[0], def.pos[2]) + 0.05, def.pos[2]), 2.4, '#7dd3fc', 0.5, 0.1, 0.3);
          vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.1, def.pos[2]), '极限闪避', true, '#a5f3fc');
          if (slot === 1) onRoundEvent?.({ type: 'screenFlash', color: 'rgba(125,211,252,0.35)' });
        } else {
          vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.0, def.pos[2]), '闪避', false, '#a7f3d0');
        }
        return;
      }
      // no hitting a grounded, knocked-down fighter (prevents infinite locks)
      if (def.actionState === 'knockdown' && def.isGrounded && !o.unblockable) return;

      const rage = att.buffs.some((b) => b.type === 'blood_rage');
      let dmg = base * (rage ? 1.35 : 1) * (att.classId === map.homeClass ? HOME_BONUS : 1);
      if ((att.counterTimer ?? 0) > 0) {
        dmg *= 1.5;
        att.counterTimer = 0;
        o.crit = true;
        o.heavy = true;
      }
      // Juggle: airborne targets stay in the air for a few hits, with damage decay
      const airborne = !def.isGrounded && (def.actionState === 'launched' || def.actionState === 'knockdown' || def.actionState === 'hitstun');
      if (airborne && !o.unblockable && o.state !== 'buried') {
        const jc = def.juggleCount ?? 0;
        dmg *= Math.pow(0.85, jc);
        if (jc < 3) {
          o.launch = Math.max(o.launch ?? 0, Math.max(2.5, 6 - jc * 0.9));
          o.state = 'launched';
          o.dur = 0.9;
          o.knock = Math.min(o.knock ?? 1.5, 2);
        }
        def.juggleCount = jc + 1;
      }
      // 金钟罩: big damage reduction, can't be interrupted, melee attackers get some of it back
      const belled = (def.bellTimer ?? 0) > 0;
      if (belled) {
        dmg *= 0.35;
        def.mp = Math.min(def.maxMp, def.mp + 4);
        const sl = def === p1 ? 0 : 1;
        vfx.bellHit(sl);
        gameAudio.playGong();
        const near = Math.hypot(att.pos[0] - def.pos[0], att.pos[2] - def.pos[2]) < 3.5;
        if (near && !o.ranged && att.hp > 0) {
          const back = Math.round(base * 0.3);
          att.hp = Math.max(1, att.hp - back);
          att.whiteFlashTimer = 0.08;
          vfx.damageNumber(vA.set(att.pos[0], att.pos[1] + 2.1, att.pos[2]), `反震 ${back}`, false, '#fde68a');
          vfx.sparkBurst(vA.set(def.pos[0], def.pos[1] + 1.2, def.pos[2]), 16, '#ffd36a', 7, 0.08, hitDir.clone().multiplyScalar(-1), 1.2);
        }
      }
      dmg = Math.round(dmg);

      // frontal block: 60% reduction, no stagger
      const facing = fwdOf(def.rotY);
      const frontal = facing.x * -hitDir.x + facing.z * -hitDir.z > 0.2;
      if (def.isBlocking && frontal && !o.unblockable && gt - (def.blockStart ?? -9) < 0.22) {
        // Perfect block: attacker is knocked off balance, defender gets a counter window
        if (!att.hasSuperArmor && !o.ranged) {
          att.actionState = 'hitstun';
          att.stateTimer = 0;
          att.stateDuration = 0.65;
          att.vel[0] = -hitDir.x * 5;
          att.vel[2] = -hitDir.z * 5;
        }
        att.whiteFlashTimer = 0.08;
        def.counterTimer = 1.6;
        att.hitStopTimer = 0.15;
        def.hitStopTimer = 0.15;
        slowMoTimerRef.current = Math.max(slowMoTimerRef.current, 0.25);
        vfx.sparkBurst(chest, 40, '#ffffff', 10, 0.1, vA.copy(hitDir).multiplyScalar(-1), 1.6);
        vfx.slashMark(chest, '#e0f2fe', 1.3);
        vfx.ring(vA.set(def.pos[0], fy(def.pos[0], def.pos[2]) + 0.05, def.pos[2]), 2.0, '#e0f2fe', 0.35, 0.16, 0.4);
        vfx.flash(chest, '#ffffff', 30, 0.15, 6);
        vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.1, def.pos[2]), '完美格挡', true, '#e0f2fe');
        controller?.kick(-3);
        gameAudio.playPerfect();
        
        return;
      }
      if (def.isBlocking && frontal && !o.unblockable) {
        dmg = Math.round(dmg * 0.4);
        def.hp = Math.max(1, def.hp - dmg);
        def.vel[0] = hitDir.x * 3;
        def.vel[2] = hitDir.z * 3;
        att.hitStopTimer = 0.06;
        def.hitStopTimer = 0.06;
        vfx.sparkBurst(chest, 22, '#cfe8ff', 7, 0.08, vA.copy(hitDir).multiplyScalar(-1), 1.2);
        vfx.flash(chest, '#d8ecff', 14, 0.1, 5);
        vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.0, def.pos[2]), `格挡 ${dmg}`, false, '#bfdbfe');
        gameAudio.playClash();
        if (slot === 1) onRoundEvent?.({ type: 'playerHit', heavy: false });
        return;
      }

      def.hp = Math.max(0, def.hp - dmg);
      if (def.treeClimb !== undefined) {
        // knocked off the trunk
        def.treeClimb = undefined;
        def.climbing = false;
        def.isGrounded = false;
      }
      att.totalDamageDealt += dmg;
      att.comboCount += 1;
      att.comboDamage += dmg;
      att.highestCombo = Math.max(att.highestCombo, att.comboCount);
      att.comboResetTimer = 2.5;
      if (rage) att.hp = Math.min(att.maxHp, att.hp + Math.round(dmg * 0.15));

      const protectedNow = (def.protectTimer ?? 0) > 0;
      // light darts only make you flinch: they chip HP but never interrupt, so a ranged fighter can't stun-lock
      const flinchOnly = !!o.flinch;
      const armored = !o.breakArmor && (protectedNow || flinchOnly || (def.bellTimer ?? 0) > 0 || (def.hasSuperArmor && !o.launch && o.state !== 'knockdown' && o.state !== 'buried'));
      if (flinchOnly) {
        def.vel[0] += hitDir.x * 1.2;
        def.vel[2] += hitDir.z * 1.2;
      }
      const stayBuried = def.actionState === 'buried' && o.state !== 'buried';
      if (!armored && !stayBuried) {
        const knock = (o.knock ?? 4) * (map.id === 'forest' ? 1 + (1 - (def.grip ?? 1)) * 0.7 : 1);
        def.vel[0] = hitDir.x * knock;
        def.vel[2] = hitDir.z * knock;
        if (o.launch) {
          def.vel[1] = o.launch;
          def.isGrounded = false;
        }
        def.airSlam = false;
        def.airSlash = false;
        def.dodgeSlash = false;
        def.actionState = o.state ?? 'hitstun';
        def.stateTimer = 0;
        def.stateDuration = o.dur ?? 0.35;
        def.rotY = def.targetRotY = yawTo(def.pos, att.pos);
        def.isBlocking = false;
        // 保护: a long stun chain grants a short window where you can't be stunned again
        def.stunLoad = (def.stunLoad ?? 0) + (o.launch || o.state === 'knockdown' || o.state === 'buried' ? 2 : 1);
        if (def.stunLoad >= 8) {
          def.stunLoad = 0;
          def.protectTimer = 1.8;
          vfx.ring(vA.set(def.pos[0], def.pos[1] + 0.05, def.pos[2]), 2.2, '#f1f5f9', 0.5, 0.12, 0.3);
          vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.5, def.pos[2]), '保护', true, '#f1f5f9');
        }
      }
      att.mp = Math.min(att.maxMp, att.mp + (o.heavy ? 6 : 3) + (att.classId === 'BuddhistMage' ? 3 : 0));
      def.whiteFlashTimer = o.heavy ? 0.1 : 0.06;
      const stop = o.noStop ? 0 : o.heavy ? 0.11 : 0.055;
      if (!o.noMark) vfx.slashMark(chest, color, o.heavy ? 1.3 : 0.9);
      if (!o.noStop) controller?.kick(o.heavy ? -4.5 : -1.2);
      att.hitStopTimer = stop;
      def.hitStopTimer = stop;
      if (o.noStop) vfx.sparkBurst(chest, 6, color, 5, 0.06, hitDir, 1.2);
      else vfx.hitImpact(chest, hitDir, !!o.heavy, color);
      vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.05, def.pos[2]), dmg, !!o.crit, attackerIsPlayer ? '#ffffff' : '#ff8a8a');
      if (o.ranged && !o.heavy && !o.crit) gameAudio.playDartHit();
      else if (o.crit || o.heavy) gameAudio.playHitHeavy();
      else gameAudio.playHitLight();
      if (attackerIsPlayer && o.shake) controller?.addShake(o.shake);
      if (!attackerIsPlayer) {
        controller?.addShake(o.noStop ? 0.05 : o.heavy ? 0.45 : 0.18);
        if (!o.noStop) onRoundEvent?.({ type: 'playerHit', heavy: !!o.heavy });
      }

      koCheck(def === p1 ? 0 : 1, color);
    }

    function resolveAttacks(slot: number, c: CombatantState, foe: CombatantState) {
      if (c.hp <= 0) return;
      const fwd = fwdOf(c.rotY).clone();
      // melee can't reach someone standing on a pillar above you (and vice versa)
      const dist = Math.abs(foe.pos[1] - c.pos[1]) > 2.2 ? 99 : Math.hypot(foe.pos[0] - c.pos[0], foe.pos[2] - c.pos[2]);
      const inFront = (fwd.x * (foe.pos[0] - c.pos[0]) + fwd.z * (foe.pos[2] - c.pos[2])) / Math.max(0.001, dist) > 0.2;
      const cfg = phasesFor(c)[c.actionState];
      const active = !!cfg && c.stateTimer >= cfg.startup && c.stateTimer <= cfg.startup + cfg.active;
      const rage = c.buffs.some((b) => b.type === 'blood_rage');
      const color = slot === 0 ? (rage ? '#ff1f2f' : PLAYER_COLOR) : rage ? '#1f6bff' : ENEMY_COLOR;
      if (c.classId === 'Ranger') {
        resolveRanger(slot, c, foe, fwd, dist, inFront, active);
        return;
      }
      if (c.classId === 'BuddhistMage') {
        resolveMonk(slot, c, foe, fwd, dist, inFront, active);
        return;
      }

      if (c.actionState.startsWith('attack_') && !c.airSlash && !c.dodgeSlash && active && !c.hasHitCurrentMove && dist < 2.6 && inFront) {
        c.hasHitCurrentMove = true;
        if (c.actionState === 'attack_1') applyHit(slot, c, foe, 60, { knock: 3.5 });
        else if (c.actionState === 'attack_2') applyHit(slot, c, foe, 85, { knock: 4.5 });
        else applyHit(slot, c, foe, 150, { heavy: true, crit: true, knock: 9, state: 'knockdown', dur: 0.9, launch: 4, shake: 0.35 });
      }

      // ---------- mini combos ----------
      // 钉地斩: lands and nails the opponent into the ground
      if (c.actionState === 'skill_1' && c.airSlam) {
        if (!c.isGrounded) vfx.embers(vB.set(c.pos[0], c.pos[1] + 0.8, c.pos[2]), 4, color, 0.3, 4, 0.1);
        else if (!c.hasHitCurrentMove) {
          c.hasHitCurrentMove = true;
          c.airSlam = false;
          const cfg1 = phasesFor(c).skill_1!;
          c.stateTimer = cfg1.startup + cfg1.active;
          c.stateDuration = cfg1.totalDuration;
          const ix = c.pos[0] + fwd.x * 0.8;
          const iz = c.pos[2] + fwd.z * 0.8;
          vfx.groundSlam(vB.set(ix, fy(ix, iz), iz), 0.85, color);
          controller?.addShake(slot === 0 ? 0.55 : 0.3);
          gameAudio.playSlam();
          if (Math.hypot(foe.pos[0] - ix, foe.pos[2] - iz) < 2.8 && foe.hp > 0) {
            applyHit(slot, c, foe, 160, { heavy: true, crit: true, knock: 0, state: 'buried', dur: 0.5 });
            if (foe.actionState === 'buried') {
              foe.isGrounded = true;
              foe.vel[1] = 0;
              foe.pos[1] = Math.min(foe.pos[1], fy(foe.pos[0], foe.pos[2]));
              vfx.decal(vB.set(foe.pos[0], fy(foe.pos[0], foe.pos[2]), foe.pos[2]), 2.2, 1.5);
              vfx.damageNumber(vA.set(foe.pos[0], 2.4, foe.pos[2]), '钉地!', true, '#fde68a');
            }
          }
        }
      }
      // 下劈: airborne downward slash, impact on landing
      if (c.actionState === 'attack_3' && c.airSlash) {
        if (c.isGrounded && !c.hasHitCurrentMove) {
          c.hasHitCurrentMove = true;
          c.airSlash = false;
          c.stateTimer = 0.45;
          c.stateDuration = 0.7;
          const ix = c.pos[0] + fwd.x * 1.0;
          const iz = c.pos[2] + fwd.z * 1.0;
          vfx.ring(vB.set(ix, fy(ix, iz), iz), 1.8, color, 0.35, 0.14, 0.5);
          vfx.dustPuff(vB, 12, 0.5, 2.5, 0.6);
          vfx.rocks(vB, 6, 5, 0.08);
          controller?.addShake(slot === 0 ? 0.35 : 0.2);
          if (Math.hypot(foe.pos[0] - ix, foe.pos[2] - iz) < 2.4 && foe.hp > 0) {
            applyHit(slot, c, foe, 120, { heavy: true, knock: 5, state: 'knockdown', dur: 0.8, launch: 3 });
          }
        }
        return;
      }
      // 回身斩: dash slash out of a dodge
      if (c.actionState === 'attack_2' && c.dodgeSlash) {
        if (c.stateTimer < 0.25) vfx.chargeWave(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), fwd, color);
        if (active && !c.hasHitCurrentMove && dist < 2.8 && inFront) {
          c.hasHitCurrentMove = true;
          applyHit(slot, c, foe, 110, { heavy: true, crit: true, knock: 7, dur: 0.55 });
        }
        if (c.stateTimer > 0.4) c.dodgeSlash = false;
        return;
      }

      if (c.actionState === 'skill_1' && !c.airSlam && active && !c.hasHitCurrentMove) {
        c.hasHitCurrentMove = true;
        const ix = c.pos[0] + fwd.x * 1.5;
        const iz = c.pos[2] + fwd.z * 1.5;
        vfx.groundSlam(vB.set(ix, fy(ix, iz), iz), 1, color);
        for (let k = 0; k < 4; k++) {
          const px = c.pos[0] + fwd.x * (0.6 + k * 0.75);
          const pz = c.pos[2] + fwd.z * (0.6 + k * 0.75);
          vfx.later(k * 0.05, () => vfx.fireColumn(new THREE.Vector3(px, fy(px, pz), pz), 1.4 + k * 0.2, color));
        }
        if (rage) {
          // Blood rage: the fissure keeps burning
          for (let k = 1; k <= 4; k++) {
            vfx.later(k * 0.4, () => {
              vfx.fireColumn(new THREE.Vector3(ix, fy(ix, iz), iz), 1.2, color);
              if (foe.hp > 0 && c.hp > 0 && Math.hypot(foe.pos[0] - ix, foe.pos[2] - iz) < 2.3) {
                applyHit(slot, c, foe, 25, { knock: 0, state: foe.isGrounded ? 'hitstun' : 'launched', dur: 0.15, noMark: true });
              }
            });
          }
        }
        if (slot === 0) controller?.addShake(0.6);
        else controller?.addShake(Math.max(0, 0.5 - dist * 0.05));
        gameAudio.playSlam();
        if (Math.hypot(foe.pos[0] - ix, foe.pos[2] - iz) < 3.4) applyHit(slot, c, foe, 210, { heavy: true, crit: true, launch: 9.5, knock: 3, state: 'launched', dur: 0.9 });
      }

      if (c.actionState === 'skill_2') {
        if (Math.random() < 0.2) vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 1, 1, 2.5, 0.45);
        vfx.spiral(vB.set(c.pos[0], c.pos[1], c.pos[2]), 1.3, gt * 15, color);
        if (rage && dist < 4.5 && dist > 1.2 && foe.hp > 0) {
          // Blood rage: the vortex drags the opponent in
          foe.vel[0] += ((c.pos[0] - foe.pos[0]) / dist) * 18 * dt;
          foe.vel[2] += ((c.pos[2] - foe.pos[2]) / dist) * 18 * dt;
        }
        const t = performance.now();
        if (t - c.lastHitTick > 200) {
          c.lastHitTick = t;
          vfx.ring(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]) + 0.05, c.pos[2]), 1.9, color, 0.25, 0.1);
          if (dist < 2.9) applyHit(slot, c, foe, 40, { knock: 1.5, dur: 0.25 });
        }
      }

      if (c.actionState === 'skill_3') {
        const go = c.stateTimer < 0.45;
        if (go) {
          c.vel[0] = fwd.x * 20;
          c.vel[2] = fwd.z * 20;
          vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 2, 0.3, 1.5, 0.55);
          vfx.chargeWave(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), fwd, color);
        } else {
          c.vel[0] = THREE.MathUtils.damp(c.vel[0], 0, 9, dt);
          c.vel[2] = THREE.MathUtils.damp(c.vel[2], 0, 9, dt);
        }
        if (go && dist < 1.8 && !c.hasHitCurrentMove) {
          c.hasHitCurrentMove = true;
          applyHit(slot, c, foe, 170, { heavy: true, crit: true, knock: 15, launch: 7, state: 'knockdown', dur: 1, shake: 0.55 });
          // Charge connects: jump straight to recovery so a skill can be chained immediately
          const c3 = phasesFor(c).skill_3!;
          c.stateTimer = Math.max(c.stateTimer, c3.startup + c3.active);
          vfx.ring(vB.set(foe.pos[0], fy(foe.pos[0], foe.pos[2]), foe.pos[2]), 2.2, color, 0.4, 0.14, 0.4);
          c.vel[0] *= 0.2;
          c.vel[2] *= 0.2;
        }
      }

      if (c.actionState === 'ultimate') {
        if (!c.ultSlamStarted && c.stateTimer > 0.55) {
          c.ultSlamStarted = true;
          c.vel[1] = -34;
          c.vel[0] = fwd.x * 6;
          c.vel[2] = fwd.z * 6;
        }
        if (!c.isGrounded) {
          vfx.embers(vB.set(c.pos[0], c.pos[1] + 0.6, c.pos[2]), c.ultSlamStarted ? 14 : 3, slot === 0 ? '#ff7a2a' : '#5ab0ff', 0.4, c.ultSlamStarted ? 6 : -1, c.ultSlamStarted ? 0.14 : 0.1);
          if (c.ultSlamStarted) vfx.flash(vB.set(c.pos[0], c.pos[1] + 1, c.pos[2]), slot === 0 ? '#ff8a3a' : '#5ab0ff', 18, 0.06, 6);
        }
        if (c.ultSlamStarted && c.isGrounded && !c.hasHitCurrentMove) {
          c.hasHitCurrentMove = true;
          slowMoTimerRef.current = Math.max(slowMoTimerRef.current, 0.3);
          controller?.addShake(slot === 0 ? 1 : 0.7);
          vfx.ultimateImpact(vB.set(c.pos[0] + fwd.x * 0.8, 0, c.pos[2] + fwd.z * 0.8));
          gameAudio.playUltImpact();
          
          onRoundEvent?.({ type: 'screenFlash', color: 'rgba(255,240,220,0.75)' });
          if (dist < 7) applyHit(slot, c, foe, 420, { heavy: true, crit: true, launch: 15, knock: 10, state: 'knockdown', dur: 1.2, unblockable: true });
          c.vel[0] = 0;
          c.vel[2] = 0;
        }
      }
    }

    // ======================================================
    // 梵音 (monk)
    // ======================================================
    /** standing inside the opponent's 禅定结界 */
    function inZen(c: CombatantState) {
      const o = c === p1 ? en : p1;
      const z = o.zenField;
      if (!z || z.t <= 0 || o.hp <= 0) return false;
      return Math.hypot(c.pos[0] - z.x, c.pos[2] - z.z) < ZEN_R && c.pos[1] - fy(z.x, z.z) < 2.5;
    }

    function executeMonk(
      slot: number,
      c: CombatantState,
      foe: CombatantState,
      intent: Intent,
      req: string,
      h: {
        cur: CharacterActionState;
        phase: string;
        free: boolean;
        canSkill: boolean;
        start: (next: CharacterActionState, push?: number) => void;
        paySkill: (idx: number, key: string, label: string) => boolean;
        report: (a: string, r: string) => void;
        color: string;
      }
    ): boolean {
      const { cur, phase, free, start, paySkill, report } = h;
      void intent;
      void foe;
      switch (req) {
        case 'attack': {
          let next: CharacterActionState | null = null;
          if (free) next = 'attack_1';
          else if (cur === 'attack_1' && phase === 'recovery') next = 'attack_2';
          else if (cur === 'attack_2' && phase === 'recovery') next = 'attack_3';
          if (!next) return report('普攻', `被 [${cur} ${phase}] 占用`), false;
          start(next, phasesFor(c)[next]!.forwardMomentum);
          if (next === 'attack_3') gameAudio.playSwingHeavy();
          else gameAudio.playSwingLight();
          report('普攻', next === 'attack_3' ? '金刚掌印' : `${next.slice(-1)} 段拳`);
          return true;
        }
        case 'skill1': {
          if (!paySkill(0, 'skill1', '1')) return false;
          start('skill_1');
          gameAudio.playCharge();
          return true;
        }
        case 'skill2': {
          if (!paySkill(1, 'skill2', '2')) return false;
          start('skill_2');
          return true;
        }
        case 'skill3': {
          if (!paySkill(2, 'skill3', '3')) return false;
          start('skill_3');
          c.mantraDone = false;
          c.mantraShots = 0;
          gameAudio.playPowerupChime();
          return true;
        }
        case 'skill4': {
          if (!paySkill(3, 'skill4', '4')) return false;
          start('skill_4');
          c.bellTimer = 4;
          vfx.bell(4, slot);
          vfx.ring(vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 2.2, h.color, 0.5, 0.14, 0.4);
          vfx.embers(vC.set(c.pos[0], c.pos[1] + 0.3, c.pos[2]), 30, '#ffd36a', 0.9, 3, 0.08);
          gameAudio.playGong();
          if (slot === 0) controller?.addShake(0.15);
          return true;
        }
        case 'ultimate': {
          if (!paySkill(4, 'ultimate', 'R')) return false;
          start('ultimate');
          c.vel[0] = c.vel[2] = 0;
          c.palmsThrown = 0;
          // the Buddha rises behind the monk, facing the same way
          const f = fwdOf(c.rotY);
          vfx.buddha(vB.set(c.pos[0] - f.x * 3.2, c.pos[1] + 4.6, c.pos[2] - f.z * 3.2), phasesFor(c).ultimate!.totalDuration + 0.4);
          vfx.ring(vA.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 3.2, h.color, 0.7, 0.16, 0.5);
          vfx.pillarAt(2.6, '#ffc94a', slot);
          gameAudio.playUltRise();
          gameAudio.playGong();
          return true;
        }
      }
      return false;
    }

    function resolveMonk(slot: number, c: CombatantState, foe: CombatantState, fwd: THREE.Vector3, dist: number, inFront: boolean, active: boolean) {
      const cfg = phasesFor(c)[c.actionState];
      const st = c.actionState;
      const t = c.stateTimer;
      const color = colorFor(slot, c);
      const gy = fy(c.pos[0], c.pos[2]);
      const chest = () => vB.set(c.pos[0] + fwd.x * 0.5, c.pos[1] + 1.2, c.pos[2] + fwd.z * 0.5);

      if ((st === 'attack_1' || st === 'attack_2') && active && !c.hasHitCurrentMove && dist < 2.5 && inFront) {
        c.hasHitCurrentMove = true;
        if (st === 'attack_1') applyHit(slot, c, foe, 58, { knock: 3.5 });
        else applyHit(slot, c, foe, 74, { knock: 4.5 });
      }

      // third hit: a palm of light pushed out a few metres
      if (st === 'attack_3' && active && !c.hasHitCurrentMove) {
        c.hasHitCurrentMove = true;
        vfx.palmPush(chest().clone(), fwd, 0.9, 3.4);
        vfx.flash(chest(), '#ffd36a', 18, 0.15, 6);
        const lateral = Math.abs(fwd.x * (foe.pos[2] - c.pos[2]) - fwd.z * (foe.pos[0] - c.pos[0]));
        if (dist < 4.2 && inFront && lateral < 1.4) applyHit(slot, c, foe, 125, { heavy: true, knock: 9, state: 'knockdown', dur: 0.8, launch: 3, shake: 0.3 });
      }

      // 金刚掌: lunge, then a huge palm
      if (st === 'skill_1' && cfg) {
        const lunging = t > 0.04 && t < cfg.startup + cfg.active && !c.hasHitCurrentMove;
        if (lunging) {
          c.vel[0] = fwd.x * 17;
          c.vel[2] = fwd.z * 17;
          if (Math.random() < 0.5) vfx.dustPuff(vB.set(c.pos[0], gy, c.pos[2]), 2, 0.3, 1.5, 0.5);
        } else {
          c.vel[0] = THREE.MathUtils.damp(c.vel[0], 0, 10, dt);
          c.vel[2] = THREE.MathUtils.damp(c.vel[2], 0, 10, dt);
        }
        const strike = !c.hasHitCurrentMove && ((t >= cfg.startup && dist < 2.4 && inFront) || t >= cfg.startup + cfg.active);
        if (strike) {
          c.hasHitCurrentMove = true;
          vfx.palmPush(chest().clone(), fwd, 1.5, 4.5);
          vfx.chargeWave(vA.set(c.pos[0], gy, c.pos[2]), fwd, color);
          vfx.flash(chest(), '#ffd36a', 40, 0.2, 9);
          gameAudio.playHitHeavy();
          if (slot === 0) controller?.addShake(0.35);
          if (dist < 3.2 && inFront) applyHit(slot, c, foe, 160, { heavy: true, crit: true, knock: 17, dur: 0.75, shake: 0.5 });
          c.stateTimer = Math.max(c.stateTimer, cfg.startup + cfg.active);
          c.vel[0] *= 0.2;
          c.vel[2] *= 0.2;
        }
      }

      // 禅定结界: unfold the circle under the monk
      if (st === 'skill_2' && cfg && t >= cfg.startup && !c.hasHitCurrentMove) {
        c.hasHitCurrentMove = true;
        c.zenField = { x: c.pos[0], z: c.pos[2], t: 5 };
        vfx.zenField(vA.set(c.pos[0], gy, c.pos[2]), ZEN_R, 5, slot);
        vfx.ring(vB.set(c.pos[0], gy + 0.05, c.pos[2]), ZEN_R, color, 0.6, 0.12, 0.25);
        vfx.dustPuff(vB, 14, 1.5, 3, 0.7);
        gameAudio.playSlam();
        if (slot === 0) controller?.addShake(0.2);
      }
      // the circle hums while it lasts
      if (c.zenField && c.zenField.t > 0 && Math.random() < dt * 6) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * ZEN_R;
        const zx = c.zenField.x + Math.cos(a) * r;
        const zz = c.zenField.z + Math.sin(a) * r;
        vfx.embers(vB.set(zx, fy(zx, zz) + 0.1, zz), 1, '#ffd36a', 0.1, 1.6, 0.06);
      }

      // 六字真言: a short chant, a close burst that interrupts, then six syllables of light hunt the foe.
      // The first five chip and make them flinch, the last one 吽 breaks armour and seals their skills.
      if (st === 'skill_3' && cfg) {
        c.vel[0] = THREE.MathUtils.damp(c.vel[0], 0, 10, dt);
        c.vel[2] = THREE.MathUtils.damp(c.vel[2], 0, 10, dt);
        if (t < cfg.startup && Math.random() < 0.6) vfx.embers(vB.set(c.pos[0], c.pos[1] + 1.4, c.pos[2]), 2, '#ffe9a8', 0.5, 1.2, 0.07);
        if (t >= cfg.startup && !c.mantraDone) {
          c.mantraDone = true;
          vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]);
          vfx.ring(vB, 2.8, '#ffe9a8', 0.4, 0.18, 0.15);
          vfx.flash(vA.set(c.pos[0], c.pos[1] + 1.4, c.pos[2]), '#ffe2a0', 40, 0.2, 8);
          gameAudio.playGong();
          controller?.addShake(slot === 0 ? 0.2 : 0.1);
          const d3 = Math.hypot(foe.pos[0] - c.pos[0], foe.pos[2] - c.pos[2]);
          if (d3 < 2.8 && Math.abs(foe.pos[1] - c.pos[1]) < 2.5 && foe.hp > 0) {
            const casting = foe.actionState.startsWith('skill_') || foe.actionState === 'ultimate';
            applyHit(slot, c, foe, 40, { knock: 5, state: 'hitstun', dur: 0.45, unblockable: true, breakArmor: true });
            if (casting && foe.actionState === 'hitstun') {
              vfx.setVortex(false, 0, slot === 0 ? 1 : 0);
              vfx.damageNumber(vA.set(foe.pos[0], foe.pos[1] + 2.5, foe.pos[2]), '打断!', true, '#fde68a');
            }
          }
        }
        const shots = c.mantraShots ?? 0;
        if (shots < 6 && t >= cfg.startup + 0.04 + shots * 0.085) {
          c.mantraShots = shots + 1;
          // fan the syllables out behind and around the monk like a halo, then let them hunt
          const side = new THREE.Vector3(-fwd.z, 0, fwd.x);
          const ang = (shots - 2.5) * 0.55;
          const from = new THREE.Vector3(c.pos[0], c.pos[1] + 2.0 + Math.cos(ang) * 0.35, c.pos[2]).addScaledVector(side, Math.sin(ang) * 1.1).addScaledVector(fwd, -0.3);
          const vel = side.clone().multiplyScalar(Math.sin(ang) * 6).addScaledVector(fwd, 2.5).add(new THREE.Vector3(0, 2.2 + Math.cos(ang) * 1.5, 0));
          glyphRef.current.push({ idx: shots, slot, pos: from.clone(), vel: vel.clone(), age: 0 });
          vfx.glyph(shots, from, vel, 1 - slot);
          if (shots === 0 || shots === 5) gameAudio.playPowerupChime();
          if (shots === 5) vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 2.8, c.pos[2]), '唵嘛呢叭咪吽', true, '#fde68a');
        }
      }

      // 万佛朝宗: palms rain down on the opponent; the last one flattens them
      if (st === 'ultimate') {
        c.vel[0] = c.vel[2] = 0;
        const n = c.palmsThrown ?? 0;
        if (n < 9 && t >= 0.45 + n * 0.19) {
          c.palmsThrown = n + 1;
          const last = n === 8;
          const lead = last ? 0 : 0.25;
          const tx = foe.pos[0] + foe.vel[0] * lead + (last ? 0 : (Math.random() - 0.5) * 1.6);
          const tz = foe.pos[2] + foe.vel[2] * lead + (last ? 0 : (Math.random() - 0.5) * 1.6);
          const ty = fy(tx, tz);
          const target = new THREE.Vector3(tx, ty, tz);
          vfx.palmStrike(target, last ? 1.6 : 1.0, 0.32);
          vfx.later(0.32, () => {
            vfx.ring(new THREE.Vector3(tx, ty + 0.05, tz), last ? 4 : 2.6, color, 0.4, 0.16, 0.3);
            vfx.dustPuff(new THREE.Vector3(tx, ty, tz), last ? 24 : 10, last ? 1.6 : 1, 3, 0.8);
            if (last) vfx.rocks(new THREE.Vector3(tx, ty, tz), 12, 7, 0.12);
            gameAudio.playSlam();
            controller?.addShake(last ? 0.7 : 0.18);
            if (round.over || c.hp <= 0 || foe.hp <= 0) return;
            const hitR = last ? 3.4 : 2.6;
            if (Math.hypot(foe.pos[0] - tx, foe.pos[2] - tz) < hitR && foe.pos[1] - ty < 3) {
              if (last) applyHit(slot, c, foe, 190, { heavy: true, crit: true, knock: 4, launch: 6, state: 'knockdown', dur: 1.1, unblockable: true });
              else applyHit(slot, c, foe, 52, { knock: 1.2, dur: 0.3, noMark: true });
            }
            if (last) onRoundEvent?.({ type: 'screenFlash', color: 'rgba(255,225,150,0.5)' });
          });
        }
      }
    }

    // ======================================================
    // 暗器 (Ranger)
    // ======================================================
    function handPos(c: CombatantState, fwd: THREE.Vector3) {
      const rx = Math.cos(c.rotY);
      const rz = -Math.sin(c.rotY);
      return new THREE.Vector3(c.pos[0] + fwd.x * 0.45 + rx * 0.18, c.pos[1] + 1.35, c.pos[2] + fwd.z * 0.45 + rz * 0.18);
    }

    /** Aim at the opponent's chest when they are roughly in front, otherwise straight ahead */
    function aimDir(c: CombatantState, foe: CombatantState, fwd: THREE.Vector3, from: THREE.Vector3, spread = 0) {
      const tx = foe.pos[0] - c.pos[0];
      const tz = foe.pos[2] - c.pos[2];
      const d = Math.hypot(tx, tz);
      const cos = (fwd.x * tx + fwd.z * tz) / Math.max(0.001, d);
      const dir =
        foe.hp > 0 && d < 24 && cos > 0.8
          ? new THREE.Vector3(foe.pos[0], foe.pos[1] + 1.05, foe.pos[2]).sub(from).normalize()
          : new THREE.Vector3(fwd.x, -0.02, fwd.z).normalize();
      if (spread) dir.applyAxisAngle(UP, spread);
      return dir;
    }

    function fireProjectile(
      slot: number,
      c: CombatantState,
      kind: Projectile['kind'],
      from: THREE.Vector3,
      dir: THREE.Vector3,
      speed: number,
      o: { dmg: number; knock?: number; dur?: number; root?: number; noStop?: boolean; life?: number; noPassive?: boolean; target?: THREE.Vector3; stagger?: boolean }
    ) {
      let pierce = false;
      let dmg = o.dmg;
      let color = colorFor(slot, c);
      if (kind === 'dart' && c.pierceNext && !o.noPassive) {
        // 袖里乾坤: golden piercing dart
        pierce = true;
        dmg *= 2;
        color = GOLD;
      }
      const poisoned = (c.poisonBuff ?? 0) > 0 && c.actionState.startsWith('attack_');
      const obj = vfx.takeProjectile(kind, colorFor(slot, c), pierce ? 'gold' : poisoned ? 'poison' : 'normal');
      if (!obj) return;
      if (pierce) {
        c.pierceNext = false;
        obj.scale.multiplyScalar(1.35);
      }
      obj.position.copy(from);
      const p: Projectile = {
        kind,
        obj,
        slot,
        pos: from.clone(),
        vel: dir.clone().multiplyScalar(speed),
        life: o.life ?? 0.8,
        dmg,
        knock: o.knock ?? 1.2,
        dur: o.dur ?? 0.22,
        color: poisoned && !pierce ? POISON_COLOR : color,
        pierce,
        poison: (c.poisonBuff ?? 0) > 0 && c.actionState.startsWith('attack_'),
        root: o.root ?? 0,
        noStop: !!o.noStop,
        stagger: !!o.stagger,
        spent: false,
        traveled: 0,
        back: false,
        hitOut: false,
        hitBack: false,
      };
      if (kind === 'boomerang') {
        // flies out on a curve to the right, swings around the target and comes back on the left
        const tgt = o.target ?? from.clone().addScaledVector(dir, 10);
        const f = new THREE.Vector3(tgt.x - from.x, 0, tgt.z - from.z);
        const L = THREE.MathUtils.clamp(f.length() + 1.5, 6, 12);
        f.normalize();
        p.path = {
          o: from.clone(),
          f,
          s: new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(-1),
          L,
          W: 4.2,
          y0: from.y,
          ty: THREE.MathUtils.clamp(tgt.y, 0.6, 7),
          u: 0,
          T: 0.75 + L * 0.07,
        };
        p.life = p.path.T + 0.5;
      }
      projRef.current.push(p);
    }

    function resolveRanger(slot: number, c: CombatantState, foe: CombatantState, fwd: THREE.Vector3, dist: number, inFront: boolean, active: boolean) {
      const cfg = phasesFor(c)[c.actionState];
      const st = c.actionState;
      const t = c.stateTimer;
      const shots = c.volleyShots ?? 0;
      const color = colorFor(slot, c);
      const ready = !!cfg && t >= cfg.startup && shots === 0;

      if ((st === 'attack_1' || st === 'attack_2') && ready) {
        c.volleyShots = 1;
        const from = handPos(c, fwd);
        fireProjectile(slot, c, 'dart', from, aimDir(c, foe, fwd, from), 36, { dmg: 52 });
        gameAudio.playThrow();
      }
      if (st === 'attack_3' && !c.backSlash && ready) {
        c.volleyShots = 1;
        const from = handPos(c, fwd);
        for (const k of [-1, 0, 1]) fireProjectile(slot, c, 'dart', from, aimDir(c, foe, fwd, from, k * 0.14), 36, { dmg: 42, knock: 3, dur: 0.3, stagger: true });
        gameAudio.playThrowFan();
      }
      if (st === 'attack_3' && c.backSlash && t >= 0.28 && !c.hasHitCurrentMove) {
        // 撩刀后撤: backhand slash, then spring away
        c.hasHitCurrentMove = true;
        vfx.slashMark(vB.set(c.pos[0] + fwd.x * 0.9, c.pos[1] + 1.1, c.pos[2] + fwd.z * 0.9), color, 1.0);
        if (dist < 2.5 && inFront) {
          const before = foe.hp;
          applyHit(slot, c, foe, 55, { knock: 6, dur: 0.45 });
          if ((c.poisonBuff ?? 0) > 0 && foe.hp < before) applyPoison(foe, before - foe.hp);
        }
        if ((c.rootTimer ?? 0) <= 0) {
          c.vel[0] = -fwd.x * 13;
          c.vel[2] = -fwd.z * 13;
        }
        vfx.dustPuff(vB.set(c.pos[0], fy(c.pos[0], c.pos[2]), c.pos[2]), 8, 0.3, 2, 0.45);
      }
      if (st === 'skill_1' && ready) {
        c.volleyShots = 1;
        const from = handPos(c, fwd);
        const d = aimDir(c, foe, fwd, from);
        const fd = Math.hypot(foe.pos[0] - c.pos[0], foe.pos[2] - c.pos[2]);
        const lockOn = foe.hp > 0 && fd < 14 && Math.abs(d.y) < 0.9 && d.x * fwd.x + d.z * fwd.z > 0.5;
        const target = lockOn ? new THREE.Vector3(foe.pos[0], foe.pos[1] + 1.1, foe.pos[2]) : from.clone().addScaledVector(fwd, 10);
        fireProjectile(slot, c, 'boomerang', from, d, 18, { dmg: 85, knock: 5, dur: 0.4, noPassive: true, target });
        vfx.ring(vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 1.2, colorFor(slot, c), 0.3, 0.08);
      }
      if (st === 'skill_2' && ready) {
        c.volleyShots = 1;
        const from = handPos(c, fwd);
        fireProjectile(slot, c, 'pin', from, aimDir(c, foe, fwd, from), 42, { dmg: 70, root: 1.5, dur: 0.3, noPassive: true });
        vfx.flash(from, color, 10, 0.1, 4);
      }
      if (st === 'skill_3' && t >= 0.12 && shots === 0) {
        // 燕返: fan of 7 darts thrown mid-backflip
        c.volleyShots = 1;
        const from = handPos(c, fwd);
        from.y = c.pos[1] + 1.2;
        for (let k = 0; k < 7; k++) fireProjectile(slot, c, 'dart', from, aimDir(c, foe, fwd, from, (k - 3) * 0.17), 30, { dmg: 38, knock: 2 });
        gameAudio.playThrowFan();
      }
      if (st === 'skill_4' && Math.random() < 0.4) vfx.embers(vB.set(c.pos[0], c.pos[1] + 1.1, c.pos[2]), 1, '#4ade80', 0.3, 1.5, 0.06);
      if ((c.poisonBuff ?? 0) > 0 && Math.random() < 0.15) vfx.embers(vB.set(c.pos[0], c.pos[1] + 1.2, c.pos[2]), 1, '#4ade80', 0.35, 1, 0.05);
      if (c.pierceNext && Math.random() < 0.2) vfx.embers(vB.set(c.pos[0], c.pos[1] + 1.3, c.pos[2]), 1, GOLD, 0.3, 1, 0.05);

      if (st === 'ultimate') {
        // 暴雨梨花: hover and rain darts on an area that drifts toward the opponent
        const rc = c.rainCenter ?? [c.pos[0], c.pos[2]];
        if (t > 0.45 && t < 2.45) {
          c.vel[0] = 0;
          c.vel[2] = 0;
          if (foe.hp > 0) {
            rc[0] = THREE.MathUtils.damp(rc[0], foe.pos[0], 1.6, dt);
            rc[1] = THREE.MathUtils.damp(rc[1], foe.pos[2], 1.6, dt);
          }
          c.rainCenter = rc;
          const target = Math.floor((t - 0.45) / 0.05) + 1;
          while ((c.volleyShots ?? 0) < target) {
            c.volleyShots = (c.volleyShots ?? 0) + 1;
            const focus = Math.random() < 0.5 && foe.hp > 0;
            const a = Math.random() * Math.PI * 2;
            const r = focus ? Math.random() * 0.7 : Math.sqrt(Math.random()) * 4;
            const tx = (focus ? foe.pos[0] : rc[0]) + Math.cos(a) * r;
            const tz = (focus ? foe.pos[2] : rc[1]) + Math.sin(a) * r;
            const ty = focus ? foe.pos[1] + 0.9 : 0;
            const from = new THREE.Vector3(c.pos[0] + (Math.random() - 0.5) * 0.8, c.pos[1] + 1.3, c.pos[2] + (Math.random() - 0.5) * 0.8);
            const dir = new THREE.Vector3(tx, ty, tz).sub(from).normalize();
            fireProjectile(slot, c, 'dart', from, dir, 30, { dmg: 18, knock: 0.6, dur: 0.16, noStop: true, noPassive: true, life: 0.7 });
          }
          if (Math.random() < 0.12) vfx.ring(vB.set(rc[0], 0.05, rc[1]), 4, color, 0.3, 0.08);
          if (Math.random() < 0.3) vfx.embers(vC.set(c.pos[0], c.pos[1] + 1, c.pos[2]), 2, '#f9a8d4', 0.5, -1, 0.07);
        }
      }
    }

    /** 淬毒: the last poisoned hit decides the poison (80% of that hit over 2 s) */
    function applyPoison(def: CombatantState, dealt: number) {
      if (dealt <= 0 || def.hp <= 0) return;
      def.poisonDps = (dealt * 0.8) / 2;
      def.poisonTimer = 2;
      def.poisonTick = 0;
      vfx.embers(vA.set(def.pos[0], def.pos[1] + 1, def.pos[2]), 8, '#4ade80', 0.4, 1.5, 0.07);
    }

    /** Bury a dart in whatever it hit: tip sinks in, the dart stays put for a while */
    function embed(p: Projectile, seconds: number) {
      const dir = vA.copy(p.vel).normalize();
      p.pos.addScaledVector(dir, -0.35); // dart origin sits behind the tip; push the tip ~0.25 m in
      p.obj.position.copy(p.pos);
      p.obj.lookAt(vC.copy(p.pos).sub(dir));
      p.stuck = seconds;
      p.spent = true;
      if (!p.noStop || Math.random() < 0.2) gameAudio.playDartStick();
    }

    function updateGlyphs(step: number) {
      const list = glyphRef.current;
      for (let n = list.length - 1; n >= 0; n--) {
        const g = list[n];
        const owner = fighters[g.slot];
        const def = fighters[1 - g.slot];
        g.age += step;
        const tgt = new THREE.Vector3(def.pos[0], def.pos[1] + 1.15, def.pos[2]);
        glyphSteer(g.pos, g.vel, tgt, g.age, step);
        if (g.age > 2.4 || def.hp <= 0 || owner.hp <= 0) {
          list.splice(n, 1);
          continue;
        }
        if (g.pos.distanceTo(tgt) > 0.75) continue;
        list.splice(n, 1);
        const last = g.idx === 5;
        if (def.dodgeIframeTimer > 0) {
          vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.2, def.pos[2]), '闪', false, '#e5e7eb');
          continue;
        }
        const before = def.hp;
        if (last) {
          applyHit(g.slot, owner, def, 90, { knock: 5, state: 'hitstun', dur: 0.5, unblockable: true, breakArmor: true, ranged: true, noMark: true, crit: true, shake: 0.25 });
          if (def.hp < before && def.hp > 0) {
            def.silenceTimer = 2.2;
            vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.6, def.pos[2]), '封印', true, '#fbbf24');
            vfx.ring(vB.set(def.pos[0], fy(def.pos[0], def.pos[2]) + 0.05, def.pos[2]), 1.6, '#fbbf24', 0.5, 0.14, 0.4);
          }
          vfx.flash(vB.copy(tgt), '#ffd36a', 50, 0.2, 9);
          vfx.sparkBurst(vB.copy(tgt), 30, '#ffe9a8', 9, 0.08, UP, 1.4);
          gameAudio.playGong();
        } else {
          applyHit(g.slot, owner, def, 32, { knock: 1, dur: 0.15, flinch: true, ranged: true, noMark: true });
          vfx.sparkBurst(vB.copy(tgt), 8, '#ffe9a8', 5, 0.05);
        }
      }
    }

    function updateProjectiles(step: number) {
      const list = projRef.current;
      const pillars = map.pillars || [];
      for (let n = list.length - 1; n >= 0; n--) {
        const p = list[n];
        const owner = fighters[p.slot];
        const def = fighters[1 - p.slot];
        p.life -= step;
        if (p.stuck !== undefined) {
          p.stuck -= step;
          if (p.stuck <= 0) {
            vfx.releaseProjectile(p.obj);
            list.splice(n, 1);
          }
          continue;
        }
        if (p.falling) {
          p.vel.y -= 22 * step;
          p.pos.addScaledVector(p.vel, step);
          p.obj.position.copy(p.pos);
          p.obj.rotateX(step * 22);
          p.obj.rotateY(step * 9);
          if (p.pos.y < fy(p.pos.x, p.pos.z) + 0.04) {
            p.pos.y = fy(p.pos.x, p.pos.z) + 0.04;
            p.obj.position.copy(p.pos);
            p.obj.rotation.set(0, Math.random() * 6, 0); // lies flat where it dropped
            p.stuck = 1.6;
            vfx.sparkBurst(vB.copy(p.pos), 3, '#e5e7eb', 2, 0.04);
          }
          continue;
        }
        let dead = p.life <= 0;
        if (p.kind === 'boomerang') {
          const sp = p.obj.getObjectByName('spin');
          if (sp) sp.rotation.y += step * 28;
          p.obj.rotation.z = p.path && p.path.u < 0.5 ? -0.35 : 0.35; // banks into the turn
        }
        // two substeps so fast darts never skip through a body
        for (let sub = 0; sub < 2 && !dead; sub++) {
          if (p.path) {
            const P = p.path;
            P.u += step / 2 / P.T;
            if (P.u >= 1 || owner.hp <= 0) {
              dead = true;
              break;
            }
            const th = P.u * Math.PI * 2;
            const prev = vC.copy(p.pos);
            // the return leg bends toward wherever the thrower is now
            const home = vA.set(owner.pos[0] - P.o.x, 0, owner.pos[2] - P.o.z).multiplyScalar(Math.max(0, P.u - 0.5) * 2);
            p.pos
              .copy(P.o)
              .addScaledVector(P.f, (P.L / 2) * (1 - Math.cos(th)))
              .addScaledVector(P.s, (P.W / 2) * Math.sin(th))
              .add(home);
            const baseY = P.u < 0.5 ? P.y0 : owner.pos[1] + 1.2;
            p.pos.y = THREE.MathUtils.lerp(baseY, P.ty, Math.sin(P.u * Math.PI));
            p.vel.copy(p.pos).sub(prev).multiplyScalar(2 / Math.max(1e-4, step));
            p.back = P.u >= 0.5;
            if (p.back && P.u > 0.85 && p.pos.distanceTo(vB.set(owner.pos[0], owner.pos[1] + 1.2, owner.pos[2])) < 1.0) {
              dead = true;
              break;
            }
          } else p.pos.addScaledVector(p.vel, step / 2);
          p.traveled += (p.vel.length() * step) / 2;
          if (p.kind !== 'boomerang') {
            if (p.pos.y < fy(p.pos.x, p.pos.z) + 0.02) {
              p.pos.y = fy(p.pos.x, p.pos.z) + 0.02;
              embed(p, p.noStop ? 1.0 : 2.5);
              vfx.dustPuff(vB.copy(p.pos), 2, 0.1, 0.8, 0.25);
              break;
            }
            let wall = false;
            for (const pl of pillars) {
              if (p.pos.y < (pl.deck ? 99 : pl.h ?? 99) && Math.hypot(p.pos.x - pl.x, p.pos.z - pl.z) < pl.r) {
                wall = true;
                break;
              }
            }
            if (wall) {
              embed(p, 2.5);
              vfx.sparkBurst(vB.copy(p.pos), 6, '#fde68a', 4, 0.05);
              break;
            }
          }
          const can = p.kind === 'boomerang' ? (p.back ? !p.hitBack : !p.hitOut) : !p.spent;
          if (!can || def.hp <= 0) continue;
          const hd = Math.hypot(p.pos.x - def.pos[0], p.pos.z - def.pos[2]);
          const rad = p.kind === 'boomerang' ? 0.9 : 0.55;
          if (hd < rad && p.pos.y > def.pos[1] - 0.1 && p.pos.y < def.pos[1] + 1.95) {
            if (p.kind === 'boomerang') {
              if (p.back) p.hitBack = true;
              else p.hitOut = true;
            } else p.spent = true;
            const before = def.hp;
            const dodged = def.dodgeIframeTimer > 0;
            const guarding = def.isBlocking;
            applyHit(p.slot, owner, def, p.dmg, { knock: p.knock, dur: p.dur, noMark: true, noStop: p.noStop, unblockable: p.pierce, crit: p.pierce, heavy: p.kind !== 'dart', ranged: true, flinch: p.kind === 'dart' && !p.stagger && !p.pierce });
            if (def.hp < before) {
              if (p.kind === 'dart' && !p.noStop) {
                owner.dartHits = (owner.dartHits ?? 0) + 1;
                if (owner.dartHits >= 4) {
                  owner.dartHits = 0;
                  owner.pierceNext = true;
                  vfx.damageNumber(vA.set(owner.pos[0], owner.pos[1] + 2.2, owner.pos[2]), '袖里乾坤', true, GOLD);
                }
              }
              if (p.poison) {
                applyPoison(def, before - def.hp);
              }
              if (p.root > 0 && def.hp > 0) {
                def.rootTimer = p.root;
                vfx.ring(vA.set(def.pos[0], fy(def.pos[0], def.pos[2]) + 0.05, def.pos[2]), 1.3, '#5eead4', 0.5, 0.12, 0.4);
                vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.4, def.pos[2]), '定身', true, '#5eead4');
              }
            }
            if (guarding && !p.pierce && p.kind !== 'boomerang' && before - def.hp < p.dmg * 0.7) {
              // blocked: the dart clangs off the blades and tumbles away
              p.falling = true;
              p.vel.set(-p.vel.x * 0.12 + (Math.random() - 0.5) * 3, 5 + Math.random() * 2, -p.vel.z * 0.12 + (Math.random() - 0.5) * 3);
              vfx.sparkBurst(vB.copy(p.pos), 10, '#fff7d6', 6, 0.05);
              break;
            }
            if (p.kind === 'pin' || (p.kind === 'dart' && !p.pierce && !dodged)) {
              dead = true;
              break;
            }
          }
        }
        if (dead) {
          vfx.releaseProjectile(p.obj);
          list.splice(n, 1);
          continue;
        }
        p.obj.position.copy(p.pos);
        if (p.kind !== 'boomerang' && p.stuck === undefined && !p.falling) {
          p.obj.lookAt(vC.copy(p.pos).sub(p.vel));
          const tassel = p.obj.getObjectByName('tassel');
          if (tassel) {
            // silk whips in the wind
            tassel.rotation.x = Math.sin(gt * 42 + n) * 0.14;
            tassel.rotation.y = Math.cos(gt * 35 + n * 1.7) * 0.14;
          }
        }
        if (Math.random() < (p.pierce ? 0.7 : 0.15)) vfx.dartTrail(p.pos, p.color);
      }
    }

    /** AI uses 受身 to escape a stun chain (not instantly, so combos still land) */
    function aiBreakout(me: CombatantState, ai: AIMemory, dt2: number) {
      const st = me.actionState;
      const stunned = st === 'hitstun' || st === 'launched' || st === 'knockdown' || st === 'buried';
      if (!stunned || (me.cooldowns.breakout ?? 0) > 0 || me.hp <= 0) return false;
      if ((me.stunLoad ?? 0) >= 3 && Math.random() < dt2 * 1.2) {
        ai.request = 'dodge';
        ai.requestTtl = 0.3;
        return true;
      }
      return false;
    }

    function runRangerAI(me: CombatantState, foe: CombatantState, out: Intent, dt2: number) {
      const ai = aiRef.current;
      const dx = foe.pos[0] - me.pos[0];
      const dz = foe.pos[2] - me.pos[2];
      const dist = Math.hypot(dx, dz);
      const toFoe = new THREE.Vector3(dx, 0, dz).normalize();
      const side = new THREE.Vector3(-toFoe.z, 0, toFoe.x);
      out.faceYaw = yawTo(me.pos, foe.pos);

      ai.think -= dt2;
      ai.planTimer -= dt2;
      if (ai.request) {
        ai.requestTtl -= dt2;
        if (ai.requestTtl <= 0) ai.request = null;
      }
      const ready = (k: string) => (me.cooldowns[k] ?? 0) <= 0;
      const free = isFree(me);
      const ask = (r: InputKeyAction) => {
        ai.request = r;
        ai.requestTtl = 0.35;
      };
      const foeAttacking = SWING_STATES.has(foe.actionState) && phaseOf(foe).phase !== 'recovery';
      if (aiBreakout(me, ai, dt2)) {
        out.move.copy(toFoe).multiplyScalar(-1);
        out.request = ai.request;
        return;
      }

      // keep a dart string going
      if (ai.comboLeft > 0 && (me.actionState === 'attack_1' || me.actionState === 'attack_2') && phaseOf(me).phase === 'recovery') {
        if (dist < 16) ask('attack');
        ai.comboLeft -= 1;
      }

      if (ai.think <= 0 && free && !ai.request) {
        ai.think = 0.18 + Math.random() * 0.22;
        const r = Math.random();
        if (dist < 3.2) {
          // too close: get out
          if (ready('skill3') && me.mp >= 15 && r < 0.45) ask('skill3');
          else if (ready('special') && r < 0.75) ask('special');
          else if (me.dodgeCooldownTimer <= 0 && (me.stamina ?? 100) >= 25 && foeAttacking) {
            ai.dodgeDir = Math.random() < 0.5 ? -1 : 1;
            ask('dodge');
          }
          ai.plan = 'retreat';
          ai.planTimer = 0.6;
          ai.strafe = Math.random() < 0.5 ? -1 : 1;
        } else if (foeAttacking && dist < 5 && me.dodgeCooldownTimer <= 0 && (me.stamina ?? 100) >= 25 && r < 0.4) {
          ai.dodgeDir = Math.random() < 0.5 ? -1 : 1;
          ask('dodge');
        } else if (dist > 13) {
          ai.plan = 'approach';
          ai.planTimer = 0.6;
        } else {
          if (ready('ultimate') && me.mp >= 50 && dist < 10 && r < 0.1) ask('ultimate');
          else if (ready('skill4') && me.mp >= 10 && r < 0.18) ask('skill4');
          else if (ready('skill2') && me.mp >= 20 && r < 0.3) ask('skill2');
          else if (ready('skill1') && me.mp >= 15 && dist < 10 && r < 0.42) ask('skill1');
          else if (r < 0.85) {
            ask('attack');
            ai.comboLeft = Math.random() < 0.6 ? 2 : 1;
          }
          ai.plan = 'circle';
          ai.planTimer = 0.5 + Math.random() * 0.5;
          if (Math.random() < 0.3) ai.strafe = -ai.strafe;
        }
      }

      if (ai.planTimer <= 0) ai.plan = dist > 10 ? 'approach' : dist < 5.5 ? 'retreat' : 'circle';
      switch (ai.plan) {
        case 'approach':
          out.move.copy(toFoe).addScaledVector(side, 0.3 * ai.strafe);
          break;
        case 'retreat':
          out.move.copy(toFoe).multiplyScalar(-1).addScaledVector(side, 0.5 * ai.strafe);
          break;
        default: {
          // circle at kiting range (6-9 m)
          const want = dist < 6 ? -0.5 : dist > 9 ? 0.5 : 0;
          out.move.copy(side).multiplyScalar(ai.strafe).addScaledVector(toFoe, want);
        }
      }
      if (ai.request === 'dodge') out.move.copy(side).multiplyScalar(ai.dodgeDir).addScaledVector(toFoe, -0.5);
      {
        const px = me.pos[0] + out.move.x * 2.2;
        const pz = me.pos[2] + out.move.z * 2.2;
        if (danger(me.pos[0], me.pos[2], 0) || danger(px, pz, 0)) {
          const s2 = safeSpot(me.pos[0], me.pos[2]);
          out.move.set(s2[0] - me.pos[0], 0, s2[1] - me.pos[2]);
          if (out.move.lengthSq() > 0.01) out.move.normalize();
          if (ai.request === 'dodge' || ai.request === 'jump' || ai.request === 'skill3') ai.request = null;
        }
      }
      if (out.move.lengthSq() > 1) out.move.normalize();
      out.request = ai.request;
    }

    // ======================================================
    // MAP SYSTEM
    // ======================================================
    function resetRound(fromKO: boolean) {
      round.over = false;
      p1.classId = playerClass;
      en.classId = enemyClass;
      for (const c of fighters) {
        const cc = CLASS_CONFIGS[c.classId];
        c.maxHp = cc.hp;
        c.maxMp = cc.mp;
        c.name = cc.name;
        c.characterName = cc.defaultCharacter;
        c.hp = c.maxHp;
        c.mp = c.maxMp;
        c.vel = [0, 0, 0];
        c.actionState = 'idle';
        c.stateTimer = 0;
        c.stateDuration = 0;
        c.buffs = [];
        c.comboCount = 0;
        c.comboDamage = 0;
        c.isGrounded = true;
        c.juggleCount = 0;
        c.dodgeIframeTimer = 0.6;
        c.maxStamina = 100;
        c.stamina = 100;
        c.rootTimer = 0;
        c.poisonStacks = 0;
        c.poisonDps = 0;
        c.poisonTimer = 0;
        c.poisonBuff = 0;
        c.dartHits = 0;
        c.pierceNext = false;
        c.backSlash = false;
        c.celebrate = false;
        c.bellTimer = 0;
        c.zenField = undefined;
        c.palmsThrown = 0;
        c.silenceTimer = 0;
        c.mantraShots = 0;
        c.treeClimb = undefined;
        c.climbing = false;
        c.swimming = false;
        c.candle = 0;
        c.shade = false;
        c.slip = 0;
        for (const k of Object.keys(c.cooldowns)) c.cooldowns[k] = 0;
      }
      for (const pr of projRef.current) vfx.releaseProjectile(pr.obj);
      projRef.current = [];
      glyphRef.current = [];
      p1.pos = [map.spawnPlayer[0], fy(map.spawnPlayer[0], map.spawnPlayer[1]), map.spawnPlayer[1]];
      en.pos = [map.spawnEnemy[0], fy(map.spawnEnemy[0], map.spawnEnemy[1]), map.spawnEnemy[1]];
      p1.rotY = p1.targetRotY = yawTo(p1.pos, en.pos);
      en.rotY = en.targetRotY = yawTo(en.pos, p1.pos);
      if (controller) controller.yaw = p1.rotY;
      aiRef.current.think = 1.2;
      mapTimeRef.current = 0;
      eruptRef.current = { timer: 9 };
      bombZonesRef.current = [];
      mapRuntime.branches.length = 0;
      forestRef.current.timer = 14;
      weatherRef.current = { t: 12, phase: '', strike: 6, warn: 0 };
      mapRuntime.night = 0;
      mapRuntime.skyFlash = 0;
      mapRuntime.shadeSpot = Math.floor(Math.random() * FOREST.shadeSpots.length);
      mapRuntime.rain = 0;
      mapRuntime.storm = 0;
      mapRuntime.strikeWarn = 0;
      waveRef.current = { timer: 7, warn: 0, side: 0, aiBlocks: false };
      lightningRef.current = { timer: 5 };
      avalancheRef.current = { timer: 14, warn: 0, z: -999, hit: [false, false] };
      mapRuntime.avalancheZ = -999;
      mapRuntime.avalancheWarn = 0;
      ridgeRef.current = { timer: 9, warn: 0 };
      mapRuntime.ridgeWarn = 0;
      mapRuntime.boltT = 0;
      mapRuntime.summitStage = 0;
      mapRuntime.summitWarn = 0;
      mapRuntime.summitFall = 0;
      mapRuntime.eruption = 0;
      mapRuntime.waveSide = 0;
      mapRuntime.waveRise = 0;
      mapRuntime.lightning = 0;
      ventRef.current = { timer: 3, warn: (map.vents || []).map(() => 0) };
      mapRuntime.ventHeat = (map.vents || []).map(() => 0);
      if (fromKO) onRoundEvent?.({ type: 'reset' });
    }

    /** Height of whatever is under the fighter: arena floor or the top of a pillar / crate */
    /** floor height under (x, z): flat everywhere except the glacier valley */
    function fy(x: number, z: number) {
      return map.terrain ? terrainHeight(map.id, x, z) : 0;
    }

    function groundHeight(c: CombatantState) {
      if (!map.terrain && !overGround(c)) return groundAt(c.pos[0], c.pos[2], c.pos[1], -99);
      return groundAt(c.pos[0], c.pos[2], c.pos[1]);
    }

    /** What a fighter at height y would stand on at (x, z): terrain (or the swimming level in deep water) and pillar tops */
    function groundAt(x: number, z: number, y: number, base?: number) {
      let g = base ?? (map.terrain ? terrainHeight(map.id, x, z) : 0);
      if (map.id === 'forest') g = Math.max(g, FOREST.swimY); // deep water: you float
      for (const pl of map.pillars || []) {
        if (pl.h === undefined || y < pl.h - 0.45) continue;
        const d = Math.hypot(x - pl.x, z - pl.z);
        if (d < (pl.deck ?? pl.r) + 0.15) g = Math.max(g, pl.h);
      }
      return g;
    }

    function overGround(c: CombatantState) {
      if (map.id === 'lavacliff' || map.id === 'summit') return Math.hypot(c.pos[0], c.pos[2]) <= edgeR() + 0.35;
      return true;
    }

    /** radius of the floor that is still there (天阙之巅 shrinks as its rings break away) */
    function edgeR() {
      if (map.id === 'summit') return SUMMIT.rings[Math.min(2, mapRuntime.summitStage)];
      return map.radius;
    }

    /**
     * Walking never takes you over a sheer drop (roof edge, cliff): only being knocked, dodging or jumping does.
     * Slide along the edge instead of stopping dead, so the AI can steer round a courtyard.
     */
    /**
     * 雪岭: the mountain can only be climbed by the road. Off the road, any move that would gain height
     * (walking, dodging, jumping, being knocked) is stopped at the slope; going down is always allowed.
     * In the air the reference is the ground you jumped from, so hopping up the face doesn't work either.
     */
    function mountainWall(i: number, c: CombatantState, px0: number, pz0: number) {
      if (map.id !== 'glacier' || c.actionState === 'buried') return;
      if (c.isGrounded) takeoffY.current[i] = c.pos[1];
      const nx = c.pos[0];
      const nz = c.pos[2];
      if (nx === px0 && nz === pz0) return;
      const blocked = (x: number, z: number) => {
        const h1 = glacierHeight(x, z);
        if (h1 < 1.2) return false; // valley floor
        if (glacierPath(x, z).on > 0.5) return false; // the road
        const d = Math.hypot(x - px0, z - pz0);
        if (c.isGrounded) return h1 - glacierHeight(px0, pz0) > d * 0.35 + 0.02;
        return h1 > takeoffY.current[i] + 0.3 && h1 > c.pos[1] - 1.2;
      };
      if (!blocked(nx, nz)) return;
      // slide along the slope if one axis is fine, otherwise stop
      if (!blocked(nx, pz0)) {
        c.pos[2] = pz0;
        c.vel[2] = 0;
      } else if (!blocked(px0, nz)) {
        c.pos[0] = px0;
        c.vel[0] = 0;
      } else {
        c.pos[0] = px0;
        c.pos[2] = pz0;
        c.vel[0] = c.vel[2] = 0;
      }
    }

    /** 青冥古林: a walking fighter climbs stairs; a waist-high ledge (the temple podium's sides) gets a small hop, higher ones block */
    function stepWall(c: CombatantState, px0: number, pz0: number) {
      if (map.id !== 'forest' || !c.isGrounded || c.treeClimb !== undefined || c.actionState === 'buried') return;
      if (c.pos[0] === px0 && c.pos[2] === pz0) return;
      const tooHigh = (x: number, z: number) => terrainHeight(map.id, x, z) - c.pos[1] > 0.55;
      if (!tooHigh(c.pos[0], c.pos[2])) return;
      const rise = terrainHeight(map.id, c.pos[0], c.pos[2]) - c.pos[1];
      if (rise < 1.3 && (c.actionState === 'idle' || c.actionState === 'run')) {
        // a light hop up onto it instead of popping through the stone
        c.pos[0] = px0;
        c.pos[2] = pz0;
        c.vel[1] = Math.sqrt(2 * gravity * (rise + 0.35));
        c.isGrounded = false;
        c.actionState = 'jump';
        return;
      }
      if (!tooHigh(c.pos[0], pz0)) {
        c.pos[2] = pz0;
        c.vel[2] = 0;
      } else if (!tooHigh(px0, c.pos[2])) {
        c.pos[0] = px0;
        c.vel[0] = 0;
      } else {
        c.pos[0] = px0;
        c.pos[2] = pz0;
        c.vel[0] = c.vel[2] = 0;
      }
    }

    function ledgeGuard(c: CombatantState, px0: number, pz0: number) {
      if (!map.terrain || !c.isGrounded) return;
      const s = c.actionState;
      if (s === 'hitstun' || s === 'launched' || s === 'knockdown' || s === 'dodge' || c.hp <= 0) return;
      const drop = (x: number, z: number) => groundAt(x, z, c.pos[1]) < c.pos[1] - 1.5;
      if (!drop(c.pos[0], c.pos[2])) return;
      if (!drop(c.pos[0], pz0)) {
        c.pos[2] = pz0;
        c.vel[2] = 0;
      } else if (!drop(px0, c.pos[2])) {
        c.pos[0] = px0;
        c.vel[0] = 0;
      } else {
        c.pos[0] = px0;
        c.pos[2] = pz0;
        c.vel[0] = c.vel[2] = 0;
      }
      c.ledgeBlocked = 0.3;
    }

    function danger(x: number, z: number, margin: number) {
      for (const zn of bombZonesRef.current) if (Math.hypot(x - zn.x, z - zn.z) < zn.r + 0.6) return true;
      if (map.id === 'forest') for (const b of mapRuntime.branches) if (b.t < 0 && Math.hypot(x - b.x, z - b.z) < 2.6) return true;
      if (map.id === 'lavacliff') return Math.hypot(x, z) > map.radius - 1.8 - margin;
      if (map.id === 'summit') {
        const d = Math.hypot(x, z);
        if (d > edgeR() - 1.8 - margin) return true;
        if (mapRuntime.summitWarn > 0 && mapRuntime.summitStage < 2 && d > SUMMIT.rings[mapRuntime.summitStage + 1] - 1.2 - margin) return true;
        return false;
      }
      if (map.id === 'rooftop') {
        const h = terrainHeight(map.id, x, z);
        if (h < 0) return true; // courtyard
        if (mapRuntime.ridgeWarn > 0 && h > ROOF.strikeY - 0.6) return true;
        return false;
      }
      if (map.id === 'glacier') {
        const A = avalancheRef.current;
        const inBand = x > GLACIER.avalancheX[0] - 1 && x < GLACIER.avalancheX[1] + 1;
        if (inBand && (A.warn > 0 || (A.z > -900 && z > A.z - 2 && z < A.z + 6))) return true;
      }
      return false;
    }

    function safeSpot(x: number, z: number): [number, number] {
      const cands: [number, number][] = [[0, 0]];
      for (let k = 0; k < 6; k++) cands.push([Math.cos((k / 6) * Math.PI * 2) * 5, Math.sin((k / 6) * Math.PI * 2) * 5]);
      if (map.id === 'glacier') for (let k = 0; k < GLACIER.pathPts.length; k += 26) cands.push([GLACIER.pathPts[k][0], GLACIER.pathPts[k][1]]);
      if (map.id === 'rooftop') {
        cands.length = 0;
        cands.push([0, 7.5], [0, -7.5], [0, 15.5], [0, -15.5], [-18, 0], [18, 0], [-11.5, 0], [11.5, 0], [16.5, 16.5], [-16.5, -16.5], [16.5, -16.5], [-16.5, 16.5]);
      }
      const ok = cands.filter((c) => !danger(c[0], c[1], 0));
      const pool = ok.length ? ok : cands;
      pool.sort((a, b) => Math.hypot(a[0] - x, a[1] - z) - Math.hypot(b[0] - x, b[1] - z));
      return pool[0];
    }

    function koCheck(defSlot: number, color: string) {
      const def = fighters[defSlot];
      if (def.hp > 0 || !aiOn || round.over) return;
      round.over = true;
      round.timer = 3.2;
      fighters[1 - defSlot].celebrate = true;
      slowMoTimerRef.current = 0.7;
      def.stateTimer = 0;
      def.stateDuration = 99;
      def.actionState = 'launched';
      if (def.isGrounded && def.pos[1] >= -0.1) {
        def.vel[1] = 6;
        def.isGrounded = false;
      }
      vfx.ring(vA.set(def.pos[0], fy(def.pos[0], def.pos[2]), def.pos[2]), 3, color, 0.7, 0.12, 0.5);
      gameAudio.playGong();
      onRoundEvent?.({ type: 'ko', winner: defSlot === 1 ? 'player' : 'enemy' });
    }

    /** Environmental damage (vents, lava, ring-out) */
    function envHit(i: number, dmg: number, launch: number, label?: string) {
      const c = fighters[i];
      if (c.hp <= 0) return;
      if (launch > 0 && c.dodgeIframeTimer > 0) return;
      c.hp = Math.max(0, c.hp - dmg);
      c.whiteFlashTimer = 0.06;
      if (c.treeClimb !== undefined) {
        c.treeClimb = undefined;
        c.climbing = false;
        c.isGrounded = false;
      }
      vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 2.0, c.pos[2]), label ? `${label} ${dmg}` : dmg, false, '#ffb15a');
      if (launch > 0) {
        c.vel[1] = launch;
        c.isGrounded = false;
        c.actionState = 'launched';
        c.stateTimer = 0;
        c.stateDuration = 0.9;
        c.airSlam = c.airSlash = c.dodgeSlash = false;
      }
      if (i === 0) {
        controller?.addShake(launch > 0 ? 0.4 : 0.06);
        if (launch > 0) onRoundEvent?.({ type: 'playerHit', heavy: true });
      }
      if (c.hp <= 0) {
        if (aiOn) koCheck(i, '#ff6a1a');
        else c.hp = c.maxHp;
      }
    }

    function applyBounds(i: number, c: CombatantState) {
      const d = Math.hypot(c.pos[0], c.pos[2]);
      const speed = Math.hypot(c.vel[0], c.vel[2]);
      const knocked = c.actionState === 'hitstun' || c.actionState === 'launched' || c.actionState === 'knockdown';
      if (wallCdRef.current[i] > 0) wallCdRef.current[i] -= dt;

      if (map.id === 'lavacliff' || map.id === 'summit') {
        const R = edgeR();
        const falling = c.pos[1] < -0.05;
        // walking can't take you off the edge; knockback (and charges/rolls) can
        // (on 天阙之巅 you may also hop off a jade post, or stand on one outside the shrunken floor)
        const canLeave = knocked || falling || c.actionState === 'skill_3' || c.hp <= 0 || (map.id === 'summit' && c.pos[1] > 0.3);
        if (!canLeave && d > R - 0.25) {
          c.pos[0] *= (R - 0.25) / d;
          c.pos[2] *= (R - 0.25) / d;
          const nx = c.pos[0] / d;
          const nz = c.pos[2] / d;
          const out = c.vel[0] * nx + c.vel[2] * nz;
          if (out > 0) {
            c.vel[0] -= nx * out;
            c.vel[2] -= nz * out;
          }
        }
        if (c.isGrounded && !overGround(c) && groundHeight(c) < c.pos[1] - 0.05) {
          c.isGrounded = false;
          c.vel[1] = Math.min(c.vel[1], 0);
          c.actionState = 'launched';
          c.stateTimer = 0;
          c.stateDuration = 99;
        }
        if (c.pos[1] < -6.5) ringOut(i);
        return;
      }

      if (map.rect) {
        const { hx, hz } = map.rect;
        if (Math.abs(c.pos[0]) > hx - 0.3) {
          const sx = Math.sign(c.pos[0]);
          c.pos[0] = sx * (hx - 0.3);
          wallSplat(i, c, speed, sx * (hx + 0.3), c.pos[2]);
          c.vel[0] = 0;
        }
        if (Math.abs(c.pos[2]) > hz - 0.3) {
          const sz = Math.sign(c.pos[2]);
          c.pos[2] = sz * (hz - 0.3);
          wallSplat(i, c, speed, c.pos[0], sz * (hz + 0.3));
          c.vel[2] = 0;
        }
      } else {
        const R = map.radius;
        if (d > R) {
          c.pos[0] *= R / d;
          c.pos[2] *= R / d;
          if (map.id === 'temple') wallSplat(i, c, speed, c.pos[0], c.pos[2]);
          c.vel[0] = 0;
          c.vel[2] = 0;
        }
        if (map.id === 'rooftop' && c.pos[1] < -3.5) courtyardFall(i);
      }
      for (const pl of map.pillars || []) {
        if (!pl.deck && c.pos[1] >= (pl.h ?? 99) - 0.45) continue; // standing on (or above) it
        const dx = c.pos[0] - pl.x;
        const dz = c.pos[2] - pl.z;
        const dd = Math.hypot(dx, dz);
        const minD = pl.r + 0.45;
        if (dd < minD && dd > 0.0001) {
          c.pos[0] = pl.x + (dx / dd) * minD;
          c.pos[2] = pl.z + (dz / dd) * minD;
          wallSplat(i, c, speed, pl.x + (dx / dd) * pl.r, pl.z + (dz / dd) * pl.r);
          const nx = dx / dd;
          const nz = dz / dd;
          const into = c.vel[0] * nx + c.vel[2] * nz;
          if (into < 0) {
            c.vel[0] -= nx * into;
            c.vel[2] -= nz * into;
          }
        }
      }
      void knocked;
    }

    function wallSplat(i: number, c: CombatantState, speed: number, wx: number, wz: number) {
      const knocked = c.actionState === 'hitstun' || c.actionState === 'launched' || c.actionState === 'knockdown';
      if (!knocked || speed < 6 || wallCdRef.current[i] > 0 || c.hp <= 0) return;
      wallCdRef.current[i] = 0.8;
      const other = 1 - i;
      const att = fighters[other];
      const pt = new THREE.Vector3(wx, c.pos[1] + 1.1, wz);
      vfx.rocks(pt, 8, 4.5, 0.09);
      vfx.dustPuff(pt, 12, 0.4, 2.2, 0.7, '#8a7f72');
      vfx.sparkBurst(pt, 16, '#ffd9a8', 6, 0.08);
      vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 2.4, c.pos[2]), '撞墙!', true, '#fde68a');
      gameAudio.playHitHeavy();
      applyHit(other, att, c, 70, { heavy: true, knock: 0, state: 'hitstun', dur: 0.9, unblockable: true, noMark: true, shake: 0.3 });
    }

    function ringOut(i: number) {
      const c = fighters[i];
      if (map.id === 'summit') vfx.dustPuff(vA.set(c.pos[0], -6, c.pos[2]), 24, 2, 4, 2.2, '#f8fafc');
      else {
        vfx.sparkBurst(vA.set(c.pos[0], -6.5, c.pos[2]), 40, '#ff6a1a', 10, 0.14, new THREE.Vector3(0, 1, 0), 0.6);
        vfx.flash(vA.set(c.pos[0], -5, c.pos[2]), '#ff6a1a', 60, 0.5, 14);
      }
      if (aiOn && !round.over && c.hp > 0) {
        c.hp = 0;
        const where = map.id === 'summit' ? '坠入云海' : '坠入岩浆';
        onRoundEvent?.({ type: 'toast', text: i === 0 ? `你${where}！` : `对手${where}！` });
        koCheck(i, '#ff6a1a');
      }
      // respawn above the platform (practice mode, or after the KO is decided)
      c.pos = [0, 4, 0];
      c.vel = [0, 0, 0];
      c.isGrounded = false;
      c.actionState = 'launched';
      c.stateTimer = 0;
      c.stateDuration = 0.9;
      if (!aiOn) {
        c.hp = Math.max(1, c.hp - 200);
        if (c === en) c.hp = c.maxHp;
      }
    }

    /** 长安: knocked off the roofs into a courtyard. Hurts, then you are helped back up onto the nearest roof. */
    function courtyardFall(i: number) {
      const c = fighters[i];
      vfx.dustPuff(vA.set(c.pos[0], ROOF.street + 0.2, c.pos[2]), 14, 1, 3, 1.2, '#8b7a66');
      gameAudio.playSlam();
      const [sx, sz] = safeSpot(c.pos[0], c.pos[2]);
      envHit(i, 110, 0, '坠落');
      c.pos = [sx, terrainHeight(map.id, sx, sz) + 2.5, sz];
      c.vel = [0, 0, 0];
      c.isGrounded = false;
      c.actionState = 'launched';
      c.stateTimer = 0;
      c.stateDuration = 0.7;
      c.dodgeIframeTimer = Math.max(c.dodgeIframeTimer, 1.2);
      if (i === 0) onRoundEvent?.({ type: 'toast', text: '掉进天井！' });
    }

    /** 长安上元夜: festival fireworks keep raining down on the tallest ridge. Sparks crawl along it first. */
    function updateRooftop() {
      const R = ridgeRef.current;
      if (round.over) {
        mapRuntime.ridgeWarn = 0;
        return;
      }
      mapRuntime.boltT = Math.max(0, mapRuntime.boltT - dt * 1.6);
      if (R.warn > 0) {
        R.warn -= dt;
        mapRuntime.ridgeWarn = Math.min(1, 1 - R.warn / 1.8);
        if (Math.random() < 0.6) vfx.sparkBurst(vB.set(mapRuntime.boltX + (Math.random() - 0.5) * 3, ROOF.ridgeTop - 0.1, (Math.random() - 0.5) * 0.4), 2, '#ffd27a', 3, 0.06, vC.set(0, 1, 0), 0.8);
        if (R.warn <= 0) {
          R.warn = 0;
          mapRuntime.ridgeWarn = 0;
          mapRuntime.boltT = 1;
          vB.set(mapRuntime.boltX, ROOF.ridgeTop - 0.1, 0);
          vfx.sparkBurst(vB, 60, '#ffcf6b', 12, 0.12, vC.set(0, 1, 0), 1);
          vfx.sparkBurst(vB, 30, '#ff5a3c', 9, 0.1, vC.set(0, 1, 0), 1);
          vfx.flash(vB, '#ffb347', 80, 0.5, 18);
          vfx.ring(vB, 3.2, '#ffd27a', 0.5, 0.18, 0.2);
          gameAudio.playBoom();
          controller?.addShake(0.35);
          onRoundEvent?.({ type: 'screenFlash', color: 'rgba(255,200,120,0.35)' });
          fighters.forEach((c, i) => {
            if (c.pos[1] > ROOF.strikeY - 0.2 && Math.abs(c.pos[2]) < 2.2 && Math.abs(c.pos[0] - mapRuntime.boltX) < 4.5) envHit(i, 140, 7, '烟花');
          });
        }
      } else {
        R.timer -= dt;
        if (R.timer <= 0) {
          R.timer = 10 + Math.random() * 6;
          R.warn = 1.8;
          mapRuntime.boltX = -3.5 + Math.random() * 7;
          mapRuntime.boltZ = 0;
          onRoundEvent?.({ type: 'toast', text: '烟花要落在正殿屋脊上了！' });
        }
      }
    }

    /** 天阙之巅: the outer rings crack, glow, then break away into the clouds. */
    function updateSummit(t: number) {
      mapRuntime.summitFall += dt;
      const st = mapRuntime.summitStage;
      if (st >= 2 || round.over) {
        mapRuntime.summitWarn = 0;
        return;
      }
      const at = SUMMIT.breakAt[st];
      if (t > at - SUMMIT.warn) {
        if (mapRuntime.summitWarn === 0) {
          onRoundEvent?.({ type: 'toast', text: st === 0 ? '外圈要碎了！往里走' : '中圈要碎了！只剩中心台' });
          gameAudio.playGong();
        }
        mapRuntime.summitWarn = Math.min(1, (t - (at - SUMMIT.warn)) / SUMMIT.warn) || 0.001;
        if (Math.random() < 0.5) {
          const a = Math.random() * Math.PI * 2;
          const r = SUMMIT.rings[st + 1] + Math.random() * (SUMMIT.rings[st] - SUMMIT.rings[st + 1]);
          vfx.dustPuff(vB.set(Math.cos(a) * r, 0.05, Math.sin(a) * r), 2, 0.3, 1, 0.5, '#e7e5e4');
        }
      }
      if (t >= at) {
        mapRuntime.summitStage = st + 1;
        mapRuntime.summitWarn = 0;
        mapRuntime.summitFall = 0;
        controller?.addShake(0.5);
        gameAudio.playSlam();
        gameAudio.playBoom();
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2;
          const r = (SUMMIT.rings[st] + SUMMIT.rings[st + 1]) / 2;
          vfx.rocks(vB.set(Math.cos(a) * r, 0.1, Math.sin(a) * r), 4, 4, 0.14);
          vfx.dustPuff(vB, 3, 0.8, 2, 1.0, '#f5f5f4');
        }
        // anyone standing on the broken ring drops through (handled by the edge check next tick)
      }
    }

    function updateMap() {
      if (!round.over) mapTimeRef.current += dt;
      const skip = (globalThis as any).__TQ_SKIPTIME;
      if (skip) {
        mapTimeRef.current += skip;
        (globalThis as any).__TQ_SKIPTIME = 0;
      }
      const t = mapTimeRef.current;

      // ambient embers
      if (map.id === 'lavacliff' && Math.random() < 0.5) {
        const a = Math.random() * Math.PI * 2;
        const r = map.radius + 1 + Math.random() * 6;
        vfx.embers(vB.set(Math.cos(a) * r, -2, Math.sin(a) * r), 1, '#ff7a2a', 0.3, 2.5, 0.06);
      }

      // sky tint: volcano glow / lightning
      bgBase.set(map.background);
      bgTmp.copy(bgBase).lerp(bgTmp.set('#7a1a06'), mapRuntime.eruption * 0.75);
      if (map.id === 'forest') bgTmp.lerp(bgRain, mapRuntime.rain * 0.72); // storm clouds
      if (map.id === 'forest') bgTmp.lerp(bgNight, mapRuntime.night * 0.92); // night
      bgTmp.lerp(bgBase.set('#dfe8ff'), mapRuntime.lightning * 0.55);
      if (scene.background instanceof THREE.Color) scene.background.copy(bgTmp);
      if (scene.fog) (scene.fog as THREE.Fog).color.copy(bgTmp);
      mapRuntime.eruption = Math.max(0, mapRuntime.eruption - dt / 5);
      mapRuntime.lightning = Math.max(0, mapRuntime.lightning - dt * 3);

      if (map.id === 'lavacliff' && !round.over) {
        const er = eruptRef.current;
        er.timer -= dt;
        if (er.timer <= 0) {
          er.timer = 15 + Math.random() * 5;
          eruptVolcano();
        }
      }

      if (map.id === 'sea') updateSea();
      if (map.id === 'glacier') updateGlacier();
      if (map.id === 'rooftop') updateRooftop();
      if (map.id === 'summit') updateSummit(t);
      if (map.id === 'forest') {
        updateForest();
        updateWeather();
      }

      if (map.id === 'lavacliff' && map.vents) {
        const vs = ventRef.current;
        if (!round.over) vs.timer -= dt;
        if (vs.timer <= 0) {
          vs.timer = 5 + Math.random() * 3;
          // usually target a vent near one of the fighters
          let idx = Math.floor(Math.random() * map.vents.length);
          if (Math.random() < 0.6) {
            const f = fighters[Math.random() < 0.5 ? 0 : 1];
            let best = 1e9;
            map.vents.forEach((v, k) => {
              const dd = Math.hypot(v.x - f.pos[0], v.z - f.pos[2]);
              if (dd < best) {
                best = dd;
                idx = k;
              }
            });
          }
          if (!(vs.warn[idx] > 0)) vs.warn[idx] = 1.3;
        }
        map.vents.forEach((v, k) => {
          if (vs.warn[k] > 0) {
            vs.warn[k] -= dt;
            const prog = 1 - vs.warn[k] / 1.3;
            mapRuntime.ventHeat[k] = 0.25 + 0.75 * prog * (0.7 + 0.3 * Math.sin(gt * 30));
            if (Math.random() < 0.35) vfx.embers(vB.set(v.x, 0.1, v.z), 1, '#ff5a1a', v.r * 0.5, 2, 0.07);
            if (vs.warn[k] <= 0) {
              vs.warn[k] = 0;
              const pos = new THREE.Vector3(v.x, 0, v.z);
              vfx.fireColumn(pos, 3.2);
              vfx.later(0.08, () => vfx.fireColumn(pos, 2.6));
              vfx.later(0.16, () => vfx.fireColumn(pos, 2.2));
              vfx.ring(pos, v.r + 0.6, '#ff6a1a', 0.45, 0.14, 0.6);
              vfx.flash(vB.set(v.x, 1.5, v.z), '#ff7a2a', 45, 0.35, 10);
              controller?.addShake(Math.max(0, 0.35 - Math.hypot(v.x - p1.pos[0], v.z - p1.pos[2]) * 0.03));
              gameAudio.playBoom();
              fighters.forEach((c, i) => {
                if (Math.hypot(c.pos[0] - v.x, c.pos[2] - v.z) < v.r && c.pos[1] < 1.5) envHit(i, 90, 10, '火柱');
              });
            }
          } else {
            mapRuntime.ventHeat[k] = Math.max(0, (mapRuntime.ventHeat[k] ?? 0) - dt * 2);
          }
        });
      }

      void t;
    }

    function eruptVolcano() {
      const crater = new THREE.Vector3(...VOLCANO_CRATER);
      mapRuntime.eruption = 1;
      onRoundEvent?.({ type: 'toast', text: '火山喷发！注意地上的红圈' });
      onRoundEvent?.({ type: 'screenFlash', color: 'rgba(255,80,20,0.35)' });
      controller?.addShake(0.55);
      controller?.kick(-3);
      gameAudio.playBoom();
      
      vfx.sparkBurst(crater, 90, '#ff6a1a', 26, 1.1, new THREE.Vector3(0, 1, 0), 0.5);
      vfx.dustPuff(crater, 20, 4, 6, 6, '#2a1a14');
      vfx.flash(crater, '#ff6a1a', 900, 2.5, 220);
      for (let k = 0; k < 11; k++) {
        vfx.later(0.7 + k * 0.3, () => {
          if (round.over || map.id !== 'lavacliff') return;
          let tx: number;
          let tz: number;
          const near = k % 3 === 0 ? p1 : k % 3 === 1 ? en : null;
          if (near) {
            tx = near.pos[0] + (Math.random() - 0.5) * 3;
            tz = near.pos[2] + (Math.random() - 0.5) * 3;
          } else {
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * (map.radius - 1.5);
            tx = Math.cos(a) * r;
            tz = Math.sin(a) * r;
          }
          const dr = Math.hypot(tx, tz);
          if (dr > map.radius - 1) {
            tx *= (map.radius - 1) / dr;
            tz *= (map.radius - 1) / dr;
          }
          const zone = { x: tx, z: tz, r: 2.2 };
          bombZonesRef.current.push(zone);
          const target = new THREE.Vector3(tx, 0.4, tz);
          const fall = 1.5;
          vfx.ring(new THREE.Vector3(tx, 0.04, tz), 2.2, '#ff2a10', fall, 0.3, 0.7);
          vfx.meteor(crater, target, fall, 18, () => {
            bombZonesRef.current = bombZonesRef.current.filter((z) => z !== zone);
            const g = new THREE.Vector3(tx, 0, tz);
            vfx.groundSlam(g, 0.8, '#ff5a1a');
            vfx.fireColumn(g, 2.4);
            const dp = Math.hypot(tx - p1.pos[0], tz - p1.pos[2]);
            controller?.addShake(Math.max(0.05, 0.45 - dp * 0.04));
            gameAudio.playBoom();
            fighters.forEach((c, i) => {
              if (Math.hypot(c.pos[0] - tx, c.pos[2] - tz) < zone.r && c.pos[1] < 2) envHit(i, 110, 9, '火山弹');
            });
          }, 1.3);
        });
      }
    }

    /**
     * 青冥古林 footing: every fighter has their own grip; rain and mud cut it. Below SLIP_T, every sharp change of
     * velocity (cutting, stopping, rolling) and every hard landing costs balance; lose it all and you go down.
     */
    /**
     * 青冥古林 items: F at the temple altar takes a lit candle (or relights yours), F at the hiding place takes the
     * candle-shade. Out in the rain an unshaded candle can be put out.
     */
    function updateItems(i: number, c: CombatantState, intent: Intent | null) {
      const pressed = !!intent?.interact && !c.intPrev;
      c.intPrev = !!intent?.interact;
      c.interactHint = c.nearLadder ? '按住 F 爬梯子' : '';
      if (c.hp <= 0) return;
      const nearAltar = CANDLE_POINTS.some(([lx, lz]) => {
        const [ax, az] = templeToWorld(lx, lz);
        return Math.hypot(c.pos[0] - ax, c.pos[2] - az) < 2.0;
      }) && Math.abs(c.pos[1] - FOREST.hill.h) < 2.5;
      if (nearAltar && c.candle !== 2) {
        c.interactHint = c.candle === 1 ? '按 F 重新点燃蜡烛' : '按 F 取一支蜡烛';
        if (pressed) {
          c.candle = 2;
          vfx.sparkBurst(vB.set(c.pos[0], c.pos[1] + 1.3, c.pos[2]), 10, '#ffcf6a', 2, 0.05, UP, 0.8);
          if (i === 0) onRoundEvent?.({ type: 'toast', text: c.shade ? '取了蜡烛，灯罩护着火苗，不怕雨' : '取了蜡烛 · 淋雨可能会灭，寺里藏着一个灯罩' });
        }
      }
      const spot = mapRuntime.shadeSpot;
      if (spot >= 0 && !c.shade) {
        const [lx, lz] = FOREST.shadeSpots[spot];
        const [sx, sz] = templeToWorld(lx, lz);
        if (Math.hypot(c.pos[0] - sx, c.pos[2] - sz) < 1.8 && Math.abs(c.pos[1] - FOREST.hill.h) < 2.5) {
          c.interactHint = '按 F 拿起灯罩';
          if (pressed) {
            c.shade = true;
            mapRuntime.shadeSpot = -1;
            vfx.sparkBurst(vB.set(sx, FOREST.hill.h + 0.6, sz), 12, '#fde68a', 2.5, 0.05, UP, 0.8);
            if (i === 0) onRoundEvent?.({ type: 'toast', text: '找到灯罩！蜡烛不会再被雨浇灭' });
          }
        }
      }
      // rain on an unshaded flame
      if (c.candle === 2 && !c.shade && mapRuntime.rain > 0.25 && !underTempleRoof(c.pos[0], c.pos[2], c.pos[1]) && Math.random() < dt * 0.22 * mapRuntime.rain) {
        c.candle = 1;
        vfx.dustPuff(vB.set(c.pos[0], c.pos[1] + 1.4, c.pos[2]), 4, 0.1, 0.8, 0.5, '#9ca3af');
        if (i === 0) onRoundEvent?.({ type: 'toast', text: '蜡烛被雨浇灭了 · 回寺里供桌按 F 重新点' });
      }
      // swimming puts it out too
      if (c.candle === 2 && c.swimming && !c.shade) c.candle = 1;
    }

    function updateGrip(i: number, c: CombatantState) {
      // under the temple roof the stone floor is dry, whatever the weather
      const rain = underTempleRoof(c.pos[0], c.pos[2], c.pos[1]) ? 0 : mapRuntime.rain;
      let g = GRIP[c.classId] ?? 0.85;
      g *= 1 - rain * 0.36 - (rain > 0 ? mapRuntime.storm * 0.2 : 0);
      const floor = terrainHeight(map.id, c.pos[0], c.pos[2]);
      const onDeck = c.pos[1] > floor + 2;
      if (!onDeck && Math.abs(c.pos[2] - riverZ(c.pos[0])) < FOREST.bankHalf + 2.5) g *= 1 - 0.18 * (0.4 + rain * 0.6); // river mud
      if (onDeck) g *= 1 - 0.12 * rain; // wet planks
      c.grip = g;
      const prev = slipPrevRef.current[i];
      const dvx = c.vel[0] - prev[0];
      const dvz = c.vel[2] - prev[1];
      prev[0] = c.vel[0];
      prev[1] = c.vel[2];
      const st = c.actionState;
      const footwork = c.isGrounded && !c.swimming && c.treeClimb === undefined && (st === 'idle' || st === 'run' || st === 'dodge' || st === 'block' || st.startsWith('attack_'));
      const dv = Math.hypot(dvx, dvz);
      if (footwork && g < SLIP_T) {
        c.slip = (c.slip ?? 0) + dv * (SLIP_T - g) * 0.34;
        // skidding: a spray of mud and water at the feet
        if (dv > 0.6 && Math.random() < 0.6) vfx.dustPuff(vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 2, 0.2, 1.2, 0.35, mapRuntime.rain > 0.3 ? '#cbd5e1' : '#6b5a40');
      }
      c.slip = Math.max(0, (c.slip ?? 0) - dt * (g < SLIP_T ? 0.25 : 0.8));
      if ((c.slip ?? 0) >= 1 && footwork && c.hp > 0) {
        // down you go
        c.slip = 0;
        c.actionState = 'knockdown';
        c.stateTimer = 0;
        c.stateDuration = 0.9;
        c.vel[0] *= 0.6;
        c.vel[2] *= 0.6;
        c.isBlocking = false;
        vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 2.1, c.pos[2]), '滑倒!', true, '#93c5fd');
        vfx.dustPuff(vB.set(c.pos[0], c.pos[1] + 0.05, c.pos[2]), 10, 0.4, 2, 0.6, '#6b5a40');
        gameAudio.playLand();
        if (i === 0) controller?.addShake(0.2);
      }
    }

    /**
     * 青冥古林 weather: clear, clouding over, rain, a thunderstorm, easing off, round and round.
     * In the storm lightning hunts the highest fighter (up a lookout tree is the worst place to be),
     * and a strike near the river runs through the water to anyone wading or swimming.
     */
    function updateWeather() {
      const W = weatherRef.current;
      // test hook: jump the weather clock
      const jumpTo = (globalThis as any).__TQ_WEATHER_T;
      if (typeof jumpTo === 'number') {
        W.t = jumpTo;
        (globalThis as any).__TQ_WEATHER_T = undefined;
      }
      if (!round.over) W.t += dt;
      const cyc = WEATHER.clear + WEATHER.cloud + WEATHER.rain + WEATHER.storm + WEATHER.ease + WEATHER.dusk + WEATHER.night + WEATHER.dawn;
      const t = W.t % cyc;
      let rainT = 0;
      let stormT = 0;
      let nightT = 0;
      let phase = 'clear';
      const c1 = WEATHER.clear;
      const c2 = c1 + WEATHER.cloud;
      const c3 = c2 + WEATHER.rain;
      const c4 = c3 + WEATHER.storm;
      const c5 = c4 + WEATHER.ease;
      const c6 = c5 + WEATHER.dusk;
      const c7 = c6 + WEATHER.night;
      if (t < c1) phase = 'clear';
      else if (t < c2) {
        phase = 'cloud';
        rainT = 0.15 * ((t - c1) / WEATHER.cloud);
      } else if (t < c3) {
        phase = 'rain';
        rainT = 0.65;
      } else if (t < c4) {
        phase = 'storm';
        rainT = 1;
        stormT = 1;
      } else if (t < c5) {
        phase = 'ease';
        rainT = 0.5 * (1 - (t - c4) / WEATHER.ease);
      } else if (t < c6) {
        phase = 'dusk';
        nightT = (t - c5) / WEATHER.dusk;
      } else if (t < c7) {
        // night, with a fine rain that puts out any candle without a shade
        phase = 'night';
        nightT = 1;
        rainT = 0.45;
      } else {
        phase = 'dawn';
        nightT = 1 - (t - c7) / WEATHER.dawn;
      }
      mapRuntime.rain = THREE.MathUtils.damp(mapRuntime.rain, rainT, 0.6, dt);
      mapRuntime.storm = THREE.MathUtils.damp(mapRuntime.storm, stormT, 0.8, dt);
      mapRuntime.night = THREE.MathUtils.damp(mapRuntime.night, nightT, 0.9, dt);
      // sheet lightning flickering in the clouds whenever it's stormy (and now and then in the rain)
      mapRuntime.skyFlash = Math.max(0, mapRuntime.skyFlash - dt * 4);
      if (Math.random() < dt * (stormT * 0.9 + (phase === 'rain' ? 0.15 : 0))) {
        mapRuntime.skyFlash = 0.5 + Math.random() * 0.5;
        mapRuntime.lightning = Math.max(mapRuntime.lightning, mapRuntime.skyFlash * 0.5);
        if (Math.random() < 0.5) vfx.later(0.4 + Math.random() * 1.2, () => gameAudio.playThunder());
      }
      if (phase !== W.phase) {
        const msg: Record<string, string> = { cloud: '天色暗了下来，山雨欲来', rain: '下雨了 · 地面湿滑，急转急停小心滑倒', storm: '暴雨雷暴！雷会劈站得最高的人，泡在水里会导电', ease: '雨小了', dusk: '天快黑了 · 去山上古寺取蜡烛', night: '入夜 · 黑暗中看不见对手，只有烛光能照亮；雨会浇灭没有灯罩的蜡烛', dawn: '天亮了', clear: '雨过天晴' };
        if (W.phase && msg[phase]) onRoundEvent?.({ type: 'toast', text: msg[phase] });
        if (phase === 'storm') W.strike = 2;
        W.phase = phase;
      }
      // lightning
      if (phase === 'storm' && !round.over) {
        if (W.warn > 0) {
          W.warn -= dt;
          mapRuntime.strikeWarn = 1 - Math.max(0, W.warn) / 1.3;
          if (Math.random() < 0.5) vfx.sparkBurst(vB.set(mapRuntime.boltX + (Math.random() - 0.5) * 1.6, mapRuntime.boltY + 0.1, mapRuntime.boltZ + (Math.random() - 0.5) * 1.6), 2, '#c7d2fe', 4, 0.05, UP, 1);
          if (W.warn <= 0) strike();
        } else {
          W.strike -= dt;
          if (W.strike <= 0) {
            W.strike = 2.6 + Math.random() * 2.2;
            // aim at the highest fighter (whoever is up a tree), else either one, leading their run a little
            const alive = fighters.filter((f) => f.hp > 0);
            if (alive.length) {
              const hi = alive.reduce((a, b) => (b.pos[1] - terrainHeight(map.id, b.pos[0], b.pos[2]) > a.pos[1] - terrainHeight(map.id, a.pos[0], a.pos[2]) ? b : a));
              const up = hi.pos[1] - terrainHeight(map.id, hi.pos[0], hi.pos[2]) > 2.5;
              const tgt = up ? hi : alive[Math.floor(Math.random() * alive.length)];
              const x = tgt.pos[0] + tgt.vel[0] * 0.8 + (up ? 0 : (Math.random() - 0.5) * 3);
              const z = tgt.pos[2] + tgt.vel[2] * 0.8 + (up ? 0 : (Math.random() - 0.5) * 3);
              mapRuntime.boltX = x;
              mapRuntime.boltZ = z;
              mapRuntime.boltY = up ? tgt.pos[1] : Math.max(fy(x, z), FOREST.waterY);
              W.warn = 1.3;
              vfx.ring(new THREE.Vector3(x, mapRuntime.boltY + 0.06, z), 2.6, '#a5b4fc', 1.3, 0.25, 0.7);
            }
          }
        }
      } else {
        W.warn = 0;
        mapRuntime.strikeWarn = 0;
      }
      mapRuntime.boltT = Math.max(0, mapRuntime.boltT - dt * 2.2);
      // rain hiss follows the weather (a few times a second is plenty)
      if (Math.random() < dt * 4) gameAudio.setRain?.(mapRuntime.rain);

      function strike() {
        const x = mapRuntime.boltX;
        const z = mapRuntime.boltZ;
        const y = mapRuntime.boltY;
        mapRuntime.boltT = 1;
        mapRuntime.lightning = 1;
        mapRuntime.strikeWarn = 0;
        const g = new THREE.Vector3(x, y + 0.05, z);
        vfx.flash(vB.set(x, y + 1.5, z), '#c7d2fe', 120, 0.25, 30);
        vfx.sparkBurst(vB.set(x, y + 0.2, z), 40, '#e0e7ff', 12, 0.08, UP, 1.5);
        vfx.ring(g, 3.2, '#e0e7ff', 0.4, 0.2, 0.3);
        vfx.dustPuff(g, 14, 0.8, 3, 0.8, '#3b3b3b');
        gameAudio.playThunder();
        controller?.addShake(Math.max(0.1, 0.6 - Math.hypot(x - p1.pos[0], z - p1.pos[2]) * 0.03));
        const wet = waterDepth(x, z) > 0.05 || Math.abs(z - riverZ(x)) < FOREST.bankHalf;
        fighters.forEach((c, i) => {
          const d = Math.hypot(c.pos[0] - x, c.pos[2] - z);
          if (d < 2.6 && Math.abs(c.pos[1] - y) < 3) envHit(i, 130, 6, '雷击');
          else if (wet && d < 13 && (c.swimming || (waterDepth(c.pos[0], c.pos[2]) > 0.15 && c.pos[1] < FOREST.waterY))) {
            envHit(i, 60, 0, '导电');
            vfx.sparkBurst(vB.set(c.pos[0], c.pos[1] + 1, c.pos[2]), 16, '#a5b4fc', 5, 0.05);
          }
        });
      }
    }

    /** 青冥古林 water: deep water floats you at the surface (swimming), shallow water just slows you */
    function updateWater(c: CombatantState) {
      const was = !!c.swimming;
      const deep = waterDepth(c.pos[0], c.pos[2]) > FOREST.waterY - FOREST.swimY - 0.05;
      c.swimming = deep && c.isGrounded && c.treeClimb === undefined && c.pos[1] <= FOREST.swimY + 0.12;
      if (c.swimming && !was) {
        const hard = Math.hypot(c.vel[0], c.vel[2]) > 6 || c.actionState === 'launched';
        vfx.dustPuff(vB.set(c.pos[0], FOREST.waterY + 0.05, c.pos[2]), hard ? 22 : 10, 0.6, hard ? 4 : 2.5, 0.8, '#e0f2fe');
        vfx.ring(vB, hard ? 2.4 : 1.6, '#e0f2fe', 0.6, 0.1, 0.4);
        if (hard) gameAudio.playWaveCrash();
      }
      if (c.swimming && c.hp > 0 && (c.actionState === 'idle' || c.actionState === 'run')) {
        // swimming into a bank (or a stepping stone, the bridge foot): haul yourself out
        const sp = Math.hypot(c.vel[0], c.vel[2]);
        if (sp > 0.8) {
          const dx = c.vel[0] / sp;
          const dz = c.vel[2] / sp;
          for (const dd of [0.5, 0.9, 1.3]) {
            const g = groundAt(c.pos[0] + dx * dd, c.pos[2] + dz * dd, c.pos[1] + 2.5);
            if (g > c.pos[1] + 0.35 && g < c.pos[1] + 2.4) {
              c.swimming = false;
              c.isGrounded = false;
              c.vel = [dx * 3.5, Math.sqrt(2 * 26 * (g - c.pos[1] + 0.45)), dz * 3.5];
              c.actionState = 'jump';
              c.stateDuration = 0;
              vfx.dustPuff(vB.set(c.pos[0], FOREST.waterY + 0.05, c.pos[2]), 8, 0.4, 1.8, 0.45, '#e0f2fe');
              return;
            }
          }
        }
      }
      if (c.swimming) {
        c.isBlocking = false;
        if (c.actionState === 'block') c.actionState = 'idle';
        // nobody lies flat on a river bed: a knockdown in deep water is just a dunk
        if (c.actionState === 'knockdown') {
          c.actionState = 'hitstun';
          c.stateTimer = 0;
          c.stateDuration = 0.35;
        }
      }
    }

    /** 青冥古林: splashes in the river, and now and then a gust brings dead branches down */
    function updateForest() {
      for (let i = 0; i < 2; i++) {
        const c = fighters[i];
        const moving = Math.hypot(c.vel[0], c.vel[2]) > 1.2;
        const wet = c.isGrounded && c.pos[1] < FOREST.waterY && waterDepth(c.pos[0], c.pos[2]) > 0.12;
        if ((wet || c.swimming) && moving && Math.random() < dt * (c.swimming ? 6 : 9)) vfx.dustPuff(vB.set(c.pos[0], FOREST.waterY + 0.05, c.pos[2]), c.swimming ? 4 : 3, 0.3, 1.4, 0.4, '#e0f2fe');
        if (c.swimming && Math.random() < dt * 1.5) vfx.ring(vB.set(c.pos[0], FOREST.waterY + 0.03, c.pos[2]), 1.2, '#e0f2fe', 0.9, 0.04, 0.25);
      }
      mapRuntime.gust = Math.max(0, mapRuntime.gust - dt * 0.35);
      const F = forestRef.current;
      if (!round.over) F.timer -= dt;
      if (F.timer <= 0) {
        F.timer = 16 + Math.random() * 6;
        mapRuntime.gust = 1;
        onRoundEvent?.({ type: 'toast', text: '山风骤起，小心头顶落下的枯枝' });
        gameAudio.playWhirl();
        const spots: [number, number][] = [];
        for (let k = 0; k < 4; k++) {
          const near = k < 2 ? fighters[k] : null;
          let x: number;
          let z: number;
          if (near) {
            x = near.pos[0] + near.vel[0] * 0.6 + (Math.random() - 0.5) * 2.5;
            z = near.pos[2] + near.vel[2] * 0.6 + (Math.random() - 0.5) * 2.5;
          } else {
            const a = Math.random() * Math.PI * 2;
            const r = 4 + Math.random() * (map.radius - 6);
            x = Math.cos(a) * r;
            z = Math.sin(a) * r;
          }
          const d = Math.hypot(x, z);
          if (d > map.radius - 1.5) {
            x *= (map.radius - 1.5) / d;
            z *= (map.radius - 1.5) / d;
          }
          if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 3.5)) continue;
          if (underTempleRoof(x, z, FOREST.hill.h + 0.5)) continue; // the roof keeps them off
          spots.push([x, z]);
          // staggered so they don't all land on the same beat
          mapRuntime.branches.push({ x, z, t: -1.9 - k * 0.35, a: Math.random() * Math.PI });
          vfx.ring(new THREE.Vector3(x, 0.05, z), 2.0, '#ff3a1a', 1.9 + k * 0.35, 0.3, 0.6);
        }
      }
      const list = mapRuntime.branches;
      for (let n = list.length - 1; n >= 0; n--) {
        const b = list[n];
        const was = b.t;
        b.t += dt;
        if (was < 0 && b.t >= 0) {
          const g = new THREE.Vector3(b.x, 0.1, b.z);
          vfx.dustPuff(g, 18, 1.2, 3.2, 0.9, '#8b7a5c');
          vfx.rocks(g, 8, 5, 0.09);
          vfx.embers(vB.set(b.x, 1.0, b.z), 14, '#7aa04a', 1.6, 2.5, 0.09);
          vfx.ring(g, 2.2, '#c8b48a', 0.35, 0.12, 0.3);
          gameAudio.playSlam();
          const dp = Math.hypot(b.x - p1.pos[0], b.z - p1.pos[2]);
          controller?.addShake(Math.max(0.03, 0.4 - dp * 0.04));
          fighters.forEach((c, i) => {
            if (Math.hypot(c.pos[0] - b.x, c.pos[2] - b.z) < 2.0 && c.pos[1] < Math.max(fy(b.x, b.z), FOREST.waterY) + 2.2) envHit(i, 100, 7, '落枝');
          });
        }
        if (b.t > 2.2) list.splice(n, 1);
      }
    }

    /** 雪岭冰峰: avalanches roar down the north face every so often. The mountain path is out of their way. */
    function updateGlacier() {
      const A = avalancheRef.current;
      const [x0, x1] = GLACIER.avalancheX;
      // snowfall drifting off the ridge
      if (Math.random() < dt * 3) {
        const x = x0 + Math.random() * (x1 - x0);
        const z = GLACIER.avalancheTop - Math.random() * 3;
        vfx.dustPuff(vB.set(x, fy(x, z) + 0.3, z), 2, 0.6, 0.8, 0.8, '#f8fafc');
      }
      if (A.z > -900) {
        // the front rolls downhill, picking up speed on the steep part
        A.z += dt * (fy(0, A.z) > 3 ? 11 : 8);
        mapRuntime.avalancheZ = A.z;
        for (let k = 0; k < 4; k++) {
          const x = x0 + Math.random() * (x1 - x0);
          vB.set(x, fy(x, A.z) + 0.4, A.z + Math.random());
          vfx.dustPuff(vB, 3, 1.2, 4, 1.6, '#f1f5f9');
          if (Math.random() < 0.3) vfx.rocks(vB, 2, 5, 0.12);
        }
        controller?.addShake(dt * 1.2);
        fighters.forEach((c, i) => {
          if (A.hit[i] || c.hp <= 0) return;
          if (c.pos[0] < x0 - 0.5 || c.pos[0] > x1 + 0.5 || Math.abs(c.pos[2] - A.z) > 1.4) return;
          if (c.pos[1] > fy(c.pos[0], c.pos[2]) + 1.6) return; // jumped over it
          A.hit[i] = true;
          if (c.dodgeIframeTimer > 0) return;
          c.hp = Math.max(0, c.hp - 110);
          c.vel[0] = (Math.random() - 0.5) * 3;
          c.vel[2] = 11;
          c.vel[1] = 5.5;
          c.isGrounded = false;
          c.actionState = 'launched';
          c.stateTimer = 0;
          c.stateDuration = 0.9;
          c.whiteFlashTimer = 0.1;
          vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 2.1, c.pos[2]), '雪崩 110', true, '#e0f2fe');
          if (i === 0) onRoundEvent?.({ type: 'playerHit', heavy: true });
          koCheck(i, '#e0f2fe');
        });
        if (A.z > GLACIER.avalancheEnd) {
          A.z = -999;
          mapRuntime.avalancheZ = -999;
          A.timer = 16 + Math.random() * 8;
        }
      } else if (A.warn > 0) {
        A.warn -= dt;
        mapRuntime.avalancheWarn = 1 - A.warn / 2.8;
        if (Math.random() < dt * 8) {
          const x = x0 + Math.random() * (x1 - x0);
          vfx.dustPuff(vB.set(x, fy(x, GLACIER.avalancheTop) + 0.2, GLACIER.avalancheTop), 3, 0.5, 1.5, 0.9, '#f8fafc');
        }
        controller?.addShake(dt * 0.25);
        if (A.warn <= 0) {
          A.z = GLACIER.avalancheTop;
          A.hit = [false, false];
          mapRuntime.avalancheWarn = 0;
          gameAudio.playWaveCrash();
          gameAudio.playBoom();
          onRoundEvent?.({ type: 'screenFlash', color: 'rgba(240,248,255,0.35)' });
        }
      } else if (!round.over) {
        A.timer -= dt;
        if (A.timer <= 0) {
          A.warn = 2.8;
          onRoundEvent?.({ type: 'toast', text: '雪崩要来了！快离开南坡' });
          gameAudio.playThunder();
        }
      }
    }

    function updateSea() {
      const w = waveRef.current;
      const lt = lightningRef.current;
      // the ship rolls on the swell (harder while the rogue wave rears up) and fighters slide with it
      // (roll and pitch come from the swell under the hull, computed by the sea itself)
      for (const c of fighters) {
        if (!c.isGrounded || c.hp <= 0 || c.pos[1] > 0.3) continue;
        const k = c.isBlocking ? 0.3 : 1;
        c.pos[0] += Math.sin(mapRuntime.shipRoll) * 7 * k * dt;
      }
      // spray off the bow as she ploughs into the swell
      if (Math.random() < dt * 0.8) {
        vB.set((Math.random() - 0.5) * 3, 0.8, -(map.rect!.hz + 3.5));
        vfx.dustPuff(vB, 5, 0.8, 4, 1.0, '#cfe3f5');
        vfx.sparkBurst(vB, 6, '#e0f2ff', 7, 0.08, vC.set(0, 1, 0.4), 0.6);
      }
      if (!round.over) {
        lt.timer -= dt;
        if (lt.timer <= 0) {
          lt.timer = 6 + Math.random() * 8;
          mapRuntime.lightning = 1;
          onRoundEvent?.({ type: 'screenFlash', color: 'rgba(225,235,255,0.45)' });
          vfx.later(0.35 + Math.random() * 0.4, () => {
            gameAudio.playThunder();
            controller?.addShake(0.12);
          });
        }
      }
      const hx = map.rect!.hx;
      if (w.warn > 0) {
        w.warn -= dt;
        mapRuntime.waveRise = Math.min(1, 1 - w.warn / 2.2);
        if (Math.random() < 0.5) {
          vB.set(w.side * (hx + 0.6), 0.6, (Math.random() - 0.5) * map.rect!.hz * 2);
          vfx.sparkBurst(vB, 2, '#cfe8ff', 4, 0.1, vC.set(-w.side * 0.3, 1, 0), 0.4);
        }
        if (w.warn <= 0) {
          // crash over the deck
          w.warn = 0;
          mapRuntime.waveRise = 1.15;
          onRoundEvent?.({ type: 'screenFlash', color: 'rgba(170,215,255,0.4)' });
          controller?.addShake(0.4);
          gameAudio.playWaveCrash();
          for (let k = 0; k < 20; k++) {
            const z = -map.rect!.hz + (k / 19) * map.rect!.hz * 2;
            vB.set(w.side * hx, 0.5, z);
            vfx.sparkBurst(vB, 6, '#e0f2ff', 9, 0.16, vC.set(-w.side, 0.6, 0), 0.5);
            vfx.dustPuff(vB, 2, 0.5, 6, 1.1, '#cfe3f5');
          }
          fighters.forEach((c) => {
            if (c.hp <= 0 || c.pos[1] > 1.5) return;
            const push = c.isBlocking ? 5 : 21;
            c.vel[0] = -w.side * push;
            c.vel[2] *= 0.3;
            if (!c.isBlocking && !c.hasSuperArmor) {
              c.actionState = 'hitstun';
              c.stateTimer = 0;
              c.stateDuration = 0.55;
              c.airSlam = c.airSlash = c.dodgeSlash = false;
            }
            vfx.damageNumber(vA.set(c.pos[0], c.pos[1] + 2.0, c.pos[2]), c.isBlocking ? '站稳!' : '被浪冲走!', false, '#bae6fd');
          });
          w.timer = 9 + Math.random() * 4;
          w.side = 0;
        }
      } else {
        mapRuntime.waveRise = Math.max(0, mapRuntime.waveRise - dt * 0.8);
        if (!round.over) w.timer -= dt;
        if (w.timer <= 0 && !round.over) {
          w.side = Math.random() < 0.5 ? -1 : 1;
          w.warn = 2.2;
          w.aiBlocks = Math.random() < 0.6;
          onRoundEvent?.({ type: 'toast', text: '巨浪来袭！按住右键格挡站稳' });
        }
      }
      mapRuntime.waveSide = w.side || mapRuntime.waveSide;
    }

    // ------------------------------------------------------
    // AI: 霍岩影. Thinks a few times per second, reacts to the
    // player's attacks, keeps spacing, combos, uses skills.
    // ------------------------------------------------------
    /** 青冥古林 AI: up on a lookout deck while the target is down below: walk to the edge and jump off toward them */
    function leaveLookout(me: CombatantState, foe: CombatantState, out: Intent) {
      if (me.treeClimb !== undefined || !me.isGrounded) return;
      // you're up a lookout: go to that tree and 梯云纵 up after you
      if (foe.pos[1] > me.pos[1] + 3 && foe.isGrounded) {
        const pl = (map.pillars || []).find((p) => p.climb && Math.abs(foe.pos[1] - (p.h ?? 0)) < 0.4 && Math.hypot(foe.pos[0] - p.x, foe.pos[2] - p.z) < (p.deck ?? 0) + 0.3);
        if (pl) {
          const dx = pl.x - me.pos[0];
          const dz = pl.z - me.pos[2];
          const d = Math.hypot(dx, dz) || 1;
          out.move.set(dx / d, 0, dz / d);
          if (d < pl.r + 1.5 && (me.stamina ?? 0) >= 25) out.request = 'jump';
          else if (out.request === 'jump') out.request = null;
        }
        return;
      }
      if (foe.pos[1] > me.pos[1] - 2) return;
      const pl = (map.pillars || []).find((p) => p.deck && Math.abs(me.pos[1] - (p.h ?? 0)) < 0.3 && Math.hypot(me.pos[0] - p.x, me.pos[2] - p.z) < (p.deck ?? 0) + 0.2);
      if (!pl) return;
      // head out away from the trunk on the side facing the target
      const tx = foe.pos[0] - pl.x;
      const tz = foe.pos[2] - pl.z;
      const tl = Math.hypot(tx, tz) || 1;
      out.move.set(tx / tl, 0, tz / tl);
      if (Math.hypot(me.pos[0] - pl.x, me.pos[2] - pl.z) > (pl.deck ?? 0) - 0.45) out.request = 'jump';
    }

    /** 雪岭 AI: the face can't be climbed, so when the target is above, walk the road up instead */
    function routeUpMountain(me: CombatantState, foe: CombatantState, out: Intent) {
      if (foe.pos[1] - me.pos[1] < 1.5 || out.move.lengthSq() < 0.01) return;
      const tx = foe.pos[0] - me.pos[0];
      const tz = foe.pos[2] - me.pos[2];
      if (out.move.x * tx + out.move.z * tz <= 0) return; // backing off / circling: leave it
      const pts = GLACIER.pathPts;
      let iMe = 0, dMe = 1e9, iF = 0, dF = 1e9;
      for (let k = 0; k < pts.length; k += 2) {
        const a = Math.hypot(pts[k][0] - me.pos[0], pts[k][1] - me.pos[2]);
        // the nearest stretch of road I can reach without climbing
        if (pts[k][2] <= me.pos[1] + 0.8 && a < dMe) { dMe = a; iMe = k; }
        const b = Math.hypot(pts[k][0] - foe.pos[0], pts[k][1] - foe.pos[2]) + Math.abs(pts[k][2] - foe.pos[1]) * 2;
        if (b < dF) { dF = b; iF = k; }
      }
      const target = dMe > 2.2 ? pts[iMe] : pts[Math.min(pts.length - 1, Math.max(iMe + 14, Math.min(iF, iMe + 14)))];
      out.move.set(target[0] - me.pos[0], 0, target[1] - me.pos[2]);
      if (out.move.lengthSq() > 0.01) out.move.normalize();
    }

    function runAI(me: CombatantState, foe: CombatantState, out: Intent, dt2: number) {
      if (me.classId === 'Ranger') return runRangerAI(me, foe, out, dt2);
      const monkAI = me.classId === 'BuddhistMage';
      const ai = aiRef.current;
      const dx = foe.pos[0] - me.pos[0];
      const dz = foe.pos[2] - me.pos[2];
      const dist = Math.hypot(dx, dz);
      const toFoe = vA.set(dx, 0, dz).normalize().clone();
      const side = new THREE.Vector3(-toFoe.z, 0, toFoe.x);
      out.faceYaw = yawTo(me.pos, foe.pos);

      ai.think -= dt2;
      ai.planTimer -= dt2;
      if (ai.request) {
        ai.requestTtl -= dt2;
        if (ai.requestTtl <= 0) ai.request = null;
      }

      const foeAttacking = SWING_STATES.has(foe.actionState) && phaseOf(foe).phase !== 'recovery';
      const ready = (k: string) => (me.cooldowns[k] ?? 0) <= 0;
      const free = isFree(me);
      const ask = (r: InputKeyAction) => {
        ai.request = r;
        ai.requestTtl = 0.35;
      };

      if (aiBreakout(me, ai, dt2)) {
        out.request = ai.request;
        return;
      }
      // 钉地斩 follow-up after an AI jump
      if (ai.airFollow > 0) {
        ai.airFollow -= dt2;
        if (!me.isGrounded && me.vel[1] < 3 && ai.airFollow < 0.25) {
          ask('skill1');
          ai.airFollow = 0;
        }
      }

      // continue a combo string
      if (ai.comboLeft > 0 && (me.actionState === 'attack_1' || me.actionState === 'attack_2') && phaseOf(me).phase === 'recovery') {
        if (dist < 3) ask('attack');
        ai.comboLeft -= 1;
      }

      if (ai.think <= 0 && free && !ai.request && monkAI) {
        ai.think = 0.22 + Math.random() * 0.25;
        const r = Math.random();
        const foeCasting = (foe.actionState.startsWith('skill_') || foe.actionState === 'ultimate') && phaseOf(foe).phase !== 'recovery';
        if (foeCasting && dist < 2.8 && ready('skill3') && me.mp >= 25 && r < 0.8) ask('skill3');
        else if (foeAttacking && dist < 3.6 && r < 0.45) {
          if (r < 0.2 && me.dodgeCooldownTimer <= 0 && (me.stamina ?? 100) >= 25) {
            ai.dodgeDir = Math.random() < 0.5 ? -1 : 1;
            ask('dodge');
          } else {
            ai.plan = 'guard';
            ai.planTimer = 0.45 + Math.random() * 0.3;
          }
        } else if (me.hp < me.maxHp * 0.6 && dist < 4 && ready('skill4') && me.mp >= 30 && r < 0.35) ask('skill4');
        else if (ready('ultimate') && me.mp >= 60 && dist < 8 && r < 0.15) ask('ultimate');
        else if (dist > 4 && dist < 16 && ready('skill3') && me.mp >= 25 && r < 0.3) ask('skill3');
        else if (dist > 7) {
          ai.plan = 'approach';
          ai.planTimer = 0.6;
        } else if (dist > 2.4) {
          if (ready('skill1') && me.mp >= 20 && dist < 5 && r < 0.35) ask('skill1');
          else if (ready('skill2') && me.mp >= 25 && dist < 4 && r < 0.2) ask('skill2');
          else {
            ai.plan = r < 0.8 ? 'approach' : 'circle';
            ai.planTimer = 0.5 + Math.random() * 0.4;
            ai.strafe = Math.random() < 0.5 ? -1 : 1;
          }
        } else if (r < 0.6) {
          ask('attack');
          ai.comboLeft = 2;
        } else if (r < 0.7 && ready('skill2') && me.mp >= 25) ask('skill2');
        else if (r < 0.78 && ready('skill1') && me.mp >= 20) ask('skill1');
        else {
          ai.plan = r < 0.9 ? 'circle' : 'retreat';
          ai.planTimer = 0.45;
          ai.strafe = Math.random() < 0.5 ? -1 : 1;
        }
      }
      if (ai.think <= 0 && free && !ai.request && !monkAI) {
        ai.think = 0.22 + Math.random() * 0.25;
        const r = Math.random();
        if (foe.pos[1] - me.pos[1] > 2) {
          // opponent is up on a pillar: can't reach, so guard against darts and wait below
          ai.plan = r < 0.5 ? 'guard' : 'circle';
          ai.planTimer = 0.6;
          ai.strafe = Math.random() < 0.5 ? -1 : 1;
        } else if (foeAttacking && dist < 3.6 && r < 0.45) {
          if (r < 0.25 && me.dodgeCooldownTimer <= 0 && (me.stamina ?? 100) >= 25) {
            ai.dodgeDir = Math.random() < 0.5 ? -1 : 1;
            ask('dodge');
            ai.plan = 'circle';
            ai.planTimer = 0.4;
          } else {
            ai.plan = 'guard';
            ai.planTimer = 0.45 + Math.random() * 0.3;
          }
        } else if (me.hp < me.maxHp * 0.45 && ready('skill4') && r < 0.4) {
          ask('skill4');
        } else if (dist > 8) {
          ai.plan = 'approach';
          ai.planTimer = 0.6;
          if (ready('skill3') && dist < 11 && r < 0.35 && me.mp >= 18) ask('skill3');
        } else if (dist > 2.4) {
          if (ready('ultimate') && me.mp >= 50 && dist < 5.5 && r < 0.12) ask('ultimate');
          else if (ready('skill1') && me.mp >= 20 && dist < 3.6 && r < 0.3) ask('skill1');
          else if (ready('skill3') && me.mp >= 18 && dist > 4 && r < 0.2) ask('skill3');
          else {
            ai.plan = r < 0.75 ? 'approach' : 'circle';
            ai.planTimer = 0.5 + Math.random() * 0.4;
            ai.strafe = Math.random() < 0.5 ? -1 : 1;
          }
        } else {
          if (r < 0.55) {
            ask('attack');
            ai.comboLeft = Math.random() < 0.6 ? 2 : 1;
          } else if (r < 0.62 && ready('skill1') && me.mp >= 20) {
            ask('jump');
            ai.airFollow = 0.6;
          } else if (r < 0.68 && ready('skill2') && me.mp >= 25) ask('skill2');
          else if (r < 0.78 && ready('skill1') && me.mp >= 20) ask('skill1');
          else if (r < 0.9) {
            ai.plan = 'circle';
            ai.planTimer = 0.5;
            ai.strafe = Math.random() < 0.5 ? -1 : 1;
          } else {
            ai.plan = 'retreat';
            ai.planTimer = 0.45;
          }
        }
      }

      // movement for current plan
      if (ai.planTimer <= 0 && ai.plan !== 'idle') ai.plan = dist > 2.4 ? 'approach' : 'pressure';
      switch (ai.plan) {
        case 'approach':
          out.move.copy(toFoe).addScaledVector(side, 0.25 * ai.strafe);
          if (dist < 2.0) out.move.set(0, 0, 0);
          break;
        case 'circle':
          out.move.copy(side).multiplyScalar(ai.strafe).addScaledVector(toFoe, dist > 3 ? 0.4 : -0.1);
          break;
        case 'retreat':
          out.move.copy(toFoe).multiplyScalar(-1).addScaledVector(side, 0.3 * ai.strafe);
          break;
        case 'guard':
          out.block = true;
          break;
        default:
          if (dist > 2.2) out.move.copy(toFoe);
      }
      if (ai.request === 'dodge') out.move.copy(side).multiplyScalar(ai.dodgeDir);
      // Brace for the incoming wave
      if (map.id === 'sea' && waveRef.current.warn > 0 && waveRef.current.warn < 0.6 && waveRef.current.aiBlocks && free) {
        out.block = true;
        out.move.set(0, 0, 0);
      }
      // Hazard awareness: never walk into lava or off the cliff
      {
        const px = me.pos[0] + out.move.x * 2.2;
        const pz = me.pos[2] + out.move.z * 2.2;
        if (danger(me.pos[0], me.pos[2], 0) || danger(px, pz, 0)) {
          const t = safeSpot(me.pos[0], me.pos[2]);
          out.move.set(t[0] - me.pos[0], 0, t[1] - me.pos[2]);
          if (out.move.lengthSq() > 0.01) out.move.normalize();
          if (ai.request === 'dodge' || ai.request === 'jump') ai.request = null;
        }
      }
      if (out.move.lengthSq() > 1) out.move.normalize();
      out.request = ai.request;
    }
  });

  return (
    <group>
      <hemisphereLight ref={hemiRef} args={[map.hemi[0], map.hemi[1], map.hemi[2]]} />
      <directionalLight
        ref={keyLightRef}
        color={map.keyColor}
        intensity={map.keyIntensity}
        castShadow={QUALITY[quality].shadows}
        shadow-mapSize={[QUALITY[quality].shadowSize, QUALITY[quality].shadowSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={60}
      />
      <directionalLight ref={rimLightRef} color="#bcd7ff" intensity={2.4} />
      <directionalLight position={[-10, 6, 10]} color="#7f9cc9" intensity={0.5} />

      <Maps3D mapId={mapId} />

      <group ref={playerGroupRef}>
        <CharacterRig3D
          classId={playerClass}
          combatantRef={p1RefState}
          isPlayer
          socketsRef={playerSockets}
          showBoneAxes={showBoneAxes}
          onAnimationDebug={onAnimationDebug}
          onLoadProgress={onLoadProgress}
        />
      </group>

      <group ref={enemyGroupRef} position={[0, 0, -6]}>
        <CharacterRig3D classId={enemyClass} combatantRef={dummyRefState} isPlayer={false} socketsRef={enemySockets} />
      </group>
      <group>
        {mapId === 'forest' && <HeldCandle combatantRef={p1RefState} socketsRef={playerSockets} />}
        {mapId === 'forest' && <HeldCandle combatantRef={dummyRefState} socketsRef={enemySockets} />}
      </group>

      <primitive object={vfx.root} />

      <EffectComposer multisampling={perfTier >= 2 ? 0 : quality === 'high' ? 4 : quality === 'medium' ? 2 : 0}>
        {quality === 'high' && perfTier === 0 && <N8AO halfRes quality="medium" aoRadius={2.4} distanceFalloff={1.0} intensity={3.5} color="#1a1410" />}
        <HueSaturation saturation={0.08} />
        <BrightnessContrast brightness={0} contrast={0.06} />
        <Bloom mipmapBlur intensity={QUALITY[quality].bloom ? map.bloom ?? 0.9 : 0} luminanceThreshold={0.95} luminanceSmoothing={0.2} />
        <Vignette offset={0.3} darkness={0.55} />
        <ToneMapping mode={ACES_FILMIC as any} />
      </EffectComposer>
    </group>
  );
}


/** 青冥古林: a candle carried in the hand: a warm light that shows you (and gives you away) in the dark */
function HeldCandle({ combatantRef, socketsRef }: { combatantRef: React.MutableRefObject<CombatantState>; socketsRef: React.MutableRefObject<RigSockets> }) {
  const handPos = useMemo(() => new THREE.Vector3(), []);
  const group = useRef<THREE.Group>(null);
  const flame = useRef<THREE.Sprite>(null);
  const light = useRef<THREE.PointLight>(null);
  const shadeRef = useRef<THREE.Group>(null);
  const candleBody = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Sprite>(null);
  const flameTex = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(16, 40, 1, 16, 36, 16);
    grd.addColorStop(0, 'rgba(255,255,230,1)');
    grd.addColorStop(0.35, 'rgba(255,200,90,0.95)');
    grd.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(16, 38, 10, 24, 0, 0, Math.PI * 2);
    g.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useFrame((st) => {
    const c = combatantRef.current;
    const g = group.current;
    if (!c || !g) return;
    const has = ((c.candle ?? 0) > 0 || !!c.shade) && c.hp > 0;
    if (candleBody.current) candleBody.current.visible = (c.candle ?? 0) > 0;
    g.visible = has;
    if (!has) {
      if (light.current) light.current.intensity = 0;
      return;
    }
    // in the left hand: follow the hand bone, the candle itself stays upright
    const hand = socketsRef.current.leftHand;
    if (hand) {
      hand.getWorldPosition(handPos);
      g.position.set(handPos.x, handPos.y + 0.07, handPos.z);
    } else {
      const fx = -Math.sin(c.rotY);
      const fz = -Math.cos(c.rotY);
      g.position.set(c.pos[0] + fz * 0.38 + fx * 0.32, c.pos[1] + 1.1, c.pos[2] - fx * 0.38 + fz * 0.32);
    }
    const lit = c.candle === 2;
    const t = st.clock.elapsedTime;
    const fl = 0.85 + 0.15 * Math.sin(t * 23 + c.pos[0]) * Math.sin(t * 7.3);
    if (flame.current) {
      flame.current.visible = lit;
      flame.current.scale.set(0.035 * fl, 0.09 * fl, 1);
    }
    if (halo.current) {
      halo.current.visible = lit;
      halo.current.scale.set(0.16 * fl, 0.22 * fl, 1);
    }
    if (light.current) light.current.intensity = lit ? 7 * fl : 0;
    if (shadeRef.current) shadeRef.current.visible = !!c.shade;
  });
  return (
    <group ref={group} visible={false}>
      <group ref={candleBody}>
        {/* bronze holder: a dish with a ring handle */}
        <mesh position={[0, -0.2, 0]}>
          <cylinderGeometry args={[0.075, 0.06, 0.025, 16]} />
          <meshStandardMaterial color="#8a6a3a" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0.085, -0.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.03, 0.007, 6, 12]} />
          <meshStandardMaterial color="#8a6a3a" metalness={0.8} roughness={0.3} />
        </mesh>
        {/* the candle, a little tapered, with a run of wax down one side */}
        <mesh position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.026, 0.03, 0.2, 12]} />
          <meshStandardMaterial color="#f4ead6" roughness={0.45} emissive="#3a2408" emissiveIntensity={0.3} />
        </mesh>
        <mesh position={[0.026, -0.07, 0]} scale={[0.4, 1, 0.5]}>
          <capsuleGeometry args={[0.012, 0.08, 4, 6]} />
          <meshStandardMaterial color="#f7efdf" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.006, 0]}>
          <cylinderGeometry args={[0.003, 0.003, 0.018, 4]} />
          <meshStandardMaterial color="#1a1208" />
        </mesh>
      </group>
      {/* flame: a soft orange halo and a bright core */}
      <sprite ref={halo} position={[0, 0.045, 0]}>
        <spriteMaterial map={flameTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} color={new THREE.Color(1.2, 0.55, 0.15)} opacity={0.6} />
      </sprite>
      <sprite ref={flame} position={[0, 0.04, 0]}>
        <spriteMaterial map={flameTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} color={new THREE.Color(2.4, 1.8, 1.1)} />
      </sprite>
      {/* paper shade in a bronze frame */}
      <group ref={shadeRef as any} visible={false}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.085, 0.1, 0.24, 14, 1, true]} />
          <meshStandardMaterial color="#f3e2b8" emissive="#ffb04a" emissiveIntensity={0.9} transparent opacity={0.78} side={THREE.DoubleSide} roughness={0.9} />
        </mesh>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} position={[Math.cos((k / 4) * Math.PI * 2) * 0.092, 0.02, Math.sin((k / 4) * Math.PI * 2) * 0.092]}>
            <cylinderGeometry args={[0.006, 0.006, 0.25, 4]} />
            <meshStandardMaterial color="#6b5230" metalness={0.7} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 0.15, 0]}>
          <torusGeometry args={[0.085, 0.01, 6, 16]} />
          <meshStandardMaterial color="#6b5230" metalness={0.7} roughness={0.4} />
        </mesh>
      </group>
      <pointLight ref={light} color="#ffb867" intensity={0} distance={11} decay={1.6} position={[0, 0.1, 0]} />
    </group>
  );
}

/** the HUD re-renders the app many times a second; the 3D scene only re-renders when its own props change */
export const Game = React.memo(GameImpl);
