import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { RoomEnvironment } from 'three-stdlib';
import { getConfig } from './constants';
import { gameAudio } from './utils/helper';
import { CombatantState, GameState, TargetingState, CharacterActionState, CharacterClassId } from './types';
import { GameInputSnapshot, InputKeyAction } from './input';
import { ACTION_PHASE_CONFIGS, RANGER_PHASE_CONFIGS, CLASS_CONFIGS } from './components/CombatData';
import { CharacterRig3D, AnimationDebugInfo, ModelLoadProgress, RigSockets } from './components/CharacterRig3D';
import { Maps3D } from './components/Maps3D';
import { MAPS, MapId, HOME_BONUS, mapRuntime, VOLCANO_CRATER } from './maps';
import { VFXSystem, RibbonTrail } from './components/VFXSystem';
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
  onDebugUpdate?: (data: {
    playerPos: [number, number, number];
    cameraPos: [number, number, number];
    camYaw: number;
    camPitch: number;
    camDist: number;
  }) => void;
  onDummyScreenPosUpdate?: (data: { visible: boolean; screenX: number; screenY: number }) => void;
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

const phasesFor = (c: CombatantState) => (c.classId === 'Ranger' ? RANGER_PHASE_CONFIGS : ACTION_PHASE_CONFIGS);
const colorFor = (slot: number, c: CombatantState) =>
  c.classId === 'Ranger' ? (slot === 0 ? RANGER_PLAYER_COLOR : RANGER_ENEMY_COLOR) : slot === 0 ? PLAYER_COLOR : ENEMY_COLOR;

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

export function Game({
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
  onDummyScreenPosUpdate,
  onBloodRageFlash,
  onAnimationDebug,
  onLoadProgress,
}: GameSceneProps) {
  const { camera, gl, scene, size } = useThree();

  const playerGroupRef = useRef<THREE.Group>(null);
  const enemyGroupRef = useRef<THREE.Group>(null);
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const rimLightRef = useRef<THREE.DirectionalLight>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const playerSockets = useRef<RigSockets>({ rightBase: null, rightTip: null, leftBase: null, leftTip: null, chest: null });
  const enemySockets = useRef<RigSockets>({ rightBase: null, rightTip: null, leftBase: null, leftTip: null, chest: null });

  const slowMoTimerRef = useRef(0);
  const gameTimeRef = useRef(0);
  const map = MAPS[mapId];
  const pendingResetRef = useRef(true);
  const mapTimeRef = useRef(0);
  const eruptRef = useRef({ timer: 9 });
  const bombZonesRef = useRef<{ x: number; z: number; r: number }[]>([]);
  const waveRef = useRef({ timer: 7, warn: 0, side: 0, aiBlocks: false });
  const lightningRef = useRef({ timer: 5 });
  const bgBase = useMemo(() => new THREE.Color(), []);
  const bgTmp = useMemo(() => new THREE.Color(), []);
  const wallCdRef = useRef([0, 0]);
  const ventRef = useRef<{ timer: number; warn: number[] }>({ timer: 3, warn: [] });
  useEffect(() => {
    pendingResetRef.current = true;
  }, [mapId, playerClass, enemyClass]);
  const projRef = useRef<Projectile[]>([]);
  const netSendRef = useRef(0);
  const lastSnapRef = useRef<unknown>(null);
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
    const VFX_CALLS = ['ring', 'flash', 'decal', 'sparkBurst', 'embers', 'dustPuff', 'rocks', 'damageNumber', 'slashMark', 'fireColumn', 'spiral', 'chargeWave', 'meteor', 'setVortex', 'pillarAt', 'groundSlam', 'ultimateImpact', 'hitImpact', 'dartTrail'];
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
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new (RoomEnvironment as any)(), 0.04).texture;
    scene.environment = env;
    (scene as any).environmentIntensity = 0.55;
    scene.background = new THREE.Color(map.background);
    scene.fog = new THREE.Fog(map.background, map.fog[0], map.fog[1]);
    gl.toneMappingExposure = map.exposure;
    return () => {
      env.dispose();
      pmrem.dispose();
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
      else c.stamina = Math.min(c.maxStamina ?? 100, (c.stamina ?? 100) + dt * (c.classId === 'Ranger' ? 32 : 24));
      const stunnedNow = c.actionState === 'hitstun' || c.actionState === 'launched' || c.actionState === 'knockdown' || c.actionState === 'buried';
      if (!stunnedNow && (c.stunLoad ?? 0) > 0) c.stunLoad = Math.max(0, (c.stunLoad ?? 0) - dt * 4);
      if ((c.poisonBuff ?? 0) > 0) c.poisonBuff = (c.poisonBuff ?? 0) - dt;
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
      enemyIntent.request = round.over || en.hp <= 0 ? null : (r.req as InputKeyAction | null);
      r.reqTtl -= dt;
      if (r.reqTtl <= 0) r.req = null;
    } else if (aiOn && !round.over && en.hp > 0) runAI(en, p1, enemyIntent, dt);
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

    // ================= PHYSICS =================
    for (let i = 0; i < 2; i++) {
      const c = fighters[i];
      const cdt = c.hitStopTimer > 0 ? dt * 0.08 : dt;
      c.stateTimer += cdt;
      // Buried: stuck in the ground, then blasted up into the air (juggle window)
      if (c.actionState === 'buried') {
        c.vel[0] = 0;
        c.vel[2] = 0;
        c.pos[1] = THREE.MathUtils.damp(c.pos[1], -0.75, 25, cdt);
        if (c.stateTimer >= c.stateDuration && c.hp > 0) {
          c.pos[1] = 0;
          c.vel[1] = 8.5;
          c.isGrounded = false;
          c.actionState = 'launched';
          c.stateTimer = 0;
          c.stateDuration = 0.9;
          c.juggleCount = 0;
          vfx.rocks(vB.set(c.pos[0], 0, c.pos[2]), 10, 6, 0.1);
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
      const hovering = c.classId === 'Ranger' && c.actionState === 'ultimate' && c.stateTimer > 0.45 && c.stateTimer < 2.45;
      if (hovering) c.vel[1] = 0;
      if (!c.isGrounded && c.actionState !== 'buried' && !hovering) {
        c.vel[1] -= gravity * cdt;
        c.pos[1] += c.vel[1] * cdt;
        const gh = groundHeight(c);
        if (c.vel[1] <= 0 && c.pos[1] <= gh && c.pos[1] > gh - 0.6) {
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
          if (impact > 6) vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), Math.min(14, Math.round(impact)), 0.5, 2, 0.6);
        }
      }
      const pinned = (c.rootTimer ?? 0) > 0 && c.isGrounded && c.actionState !== 'launched' && c.actionState !== 'knockdown';
      if (pinned) {
        c.vel[0] = 0;
        c.vel[2] = 0;
        if (Math.random() < 0.15) vfx.ring(vB.set(c.pos[0], 0.04, c.pos[2]), 0.9, '#5eead4', 0.25, 0.06);
      }
      c.pos[0] += c.vel[0] * cdt;
      c.pos[2] += c.vel[2] * cdt;
      const free = c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'jump' || c.actionState === 'block' || c.actionState === 'skill_2';
      if (!free || c.actionState === 'dodge') {
        const k = Math.exp(-4.5 * cdt);
        c.vel[0] *= k;
        c.vel[2] *= k;
      }
      applyBounds(i, c);
      if (c.isGrounded && c.pos[1] > 0.01 && c.actionState !== 'buried' && groundHeight(c) < c.pos[1] - 0.05) {
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
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 2, 0.15, 0.6, 0.35, '#7d7166');
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
      playerGroupRef.current.position.set(p1.pos[0], p1.pos[1], p1.pos[2]);
      playerGroupRef.current.rotation.y = p1.rotY;
      playerGroupRef.current.updateMatrixWorld(true);
    }
    if (enemyGroupRef.current) {
      enemyGroupRef.current.position.set(en.pos[0], en.pos[1], en.pos[2]);
      enemyGroupRef.current.rotation.y = en.rotY;
      enemyGroupRef.current.updateMatrixWorld(true);
    }

    playerVec.set(p1.pos[0], p1.pos[1], p1.pos[2]);
    controller?.update(playerVec, rawDt);

    if (keyLightRef.current) {
      keyLightRef.current.position.set(p1.pos[0] + 8, 14, p1.pos[2] + 6);
      keyLightRef.current.target.position.set(p1.pos[0], 0, p1.pos[2]);
      keyLightRef.current.target.updateMatrixWorld();
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
      t.right.emitting = rangerC ? c.actionState === 'attack_3' && !!c.backSlash && c.stateTimer > 0.18 && c.stateTimer < 0.42 : swinging;
      t.left.emitting = !rangerC && swinging && c.actionState !== 'attack_1';
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
    onDummyScreenPosUpdate?.({
      visible: headProj.z < 1 && Math.abs(headProj.x) < 1.1 && Math.abs(headProj.y) < 1.1,
      screenX: (headProj.x * 0.5 + 0.5) * size.width,
      screenY: (-headProj.y * 0.5 + 0.5) * size.height,
    });
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
        f: [p1, en],
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
        m: { ventHeat: mapRuntime.ventHeat, eruption: mapRuntime.eruption, waveSide: mapRuntime.waveSide, waveRise: mapRuntime.waveRise, lightning: mapRuntime.lightning, shipRoll: mapRuntime.shipRoll, shipPitch: mapRuntime.shipPitch },
        ev: net.events.splice(0),
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
      n.send({ t: 'in', mx: +mv.x.toFixed(3), mz: +mv.z.toFixed(3), yaw: targeting.lockedEnemyId ? yawTo(p1.pos, en.pos) : yaw, blk: !!actions.special, req });

      // ---- host state -> our two fighters (we are the host's slot 1)
      const snaps = n.snaps;
      if (snaps.length) {
        const s1 = snaps[snaps.length - 1];
        const s0 = snaps.length > 1 ? snaps[snaps.length - 2] : s1;
        const span = Math.max(16, s1.at - s0.at);
        const k = THREE.MathUtils.clamp((performance.now() - s1.at) / span, 0, 1);
        const fresh = s1 !== lastSnapRef.current;
        ([[p1, 1], [en, 0]] as [CombatantState, number][]).forEach(([c, idx], local) => {
          const a = s0.msg.f[idx];
          const b = s1.msg.f[idx];
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
        if ((ev[1] === 'setVortex' || ev[1] === 'pillarAt') && typeof args[2] === 'number') args[2] = 1 - args[2];
        fn.apply(vfx, args);
      }
      // sky tint from lightning / eruption, same as on the host
      bgBase.set(map.background);
      bgTmp.copy(bgBase).lerp(bgTmp.set('#7a1a06'), mapRuntime.eruption * 0.75);
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
        const range = ranger ? 22 : 4.2;
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
        if (c.mp < sk.mpCost) return report(`${label}: ${sk.name}`, `MP不足 (需 ${sk.mpCost})`), false;
        if (!canSkill) return report(`${label}: ${sk.name}`, `被 [${cur} ${phase}] 占用`), false;
        c.mp -= sk.mpCost;
        c.cooldowns[key] = sk.cooldown;
        report(`${label}: ${sk.name}`, '成功施放 (Cast)');
        return true;
      };
      // 受身: dodge out of hitstun / launch / knockdown (long cooldown)
      const stunned = cur === 'hitstun' || cur === 'launched' || cur === 'knockdown' || cur === 'buried';
      if (stunned) {
        if (req !== 'dodge') return false;
        if ((c.cooldowns.breakout ?? 0) > 0) return report('受身', `冷却中 (${(c.cooldowns.breakout ?? 0).toFixed(1)}s)`), false;
        c.cooldowns.breakout = ranger ? 10 : 15;
        const dir = vA.copy(intent.move);
        if (dir.lengthSq() < 0.01) dir.set(c.pos[0] - foe.pos[0], 0, c.pos[2] - foe.pos[2]);
        dir.y = 0;
        if (dir.lengthSq() < 0.0001) dir.copy(fwdOf(c.rotY)).multiplyScalar(-1);
        dir.normalize();
        if (cur === 'buried') {
          c.pos[1] = 0;
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
            vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 10, 0.4, 2, 0.5);
            gameAudio.playDodge();
            return true;
          }
          case 'skill4': {
            if (!paySkill(3, 'skill4', '4')) return false;
            start('skill_4');
            c.poisonBuff = 3;
            vfx.ring(vB.set(c.pos[0], 0.05, c.pos[2]), 1.8, '#22c55e', 0.5, 0.12, 0.35);
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
            vfx.ring(vB.set(c.pos[0], 0.05, c.pos[2]), 2.2, color, 0.5, 0.12, 0.4);
            vfx.embers(vC.set(c.pos[0], 0.3, c.pos[2]), 30, color, 0.6, 4, 0.08);
            gameAudio.playVictoryFanfare();
            return true;
          }
        }
        return false;
      }

      switch (req) {
        case 'special':
          return true; // berserker: right click is block (held), nothing to cast
        case 'dodge': {
          if (c.dodgeCooldownTimer > 0 || !canDodge) return report('闪避', '无法闪避'), false;
          if ((c.stamina ?? 100) < 25) {
            if (isPlayer) vfx.damageNumber(vC.set(c.pos[0], c.pos[1] + 2.2, c.pos[2]), '体力不足', false, '#a3a3a3');
            return report('闪避', '体力不足'), false;
          }
          c.stamina = (c.stamina ?? 100) - 25;
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
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 10, 0.4, 2, 0.55);
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
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 6, 0.3, 1.2, 0.45);
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
            vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 8, 0.3, 2, 0.5);
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
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 18, 1, 3, 0.7);
          gameAudio.playWhirl();
          return true;
        }
        case 'skill3': {
          if (!paySkill(2, 'skill3', '3')) return false;
          start('skill_3', phasesFor(c).skill_3!.forwardMomentum);
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 14, 0.5, 2.5, 0.6);
          gameAudio.playCharge();
          return true;
        }
        case 'skill4': {
          const sk = skills[3];
          if (c.cooldowns.skill4 > 0 || !canSkill) return report(`4: ${sk.name}`, '无法施放'), false;
          c.hp = Math.max(1, c.hp - Math.round(c.hp * 0.1));
          c.cooldowns.skill4 = sk.cooldown;
          start('skill_4');
          c.buffs = c.buffs.filter((b) => b.type !== 'blood_rage');
          c.buffs.push({ id: `rage_${slot}_${Date.now()}`, type: 'blood_rage', duration: 8, value: 0.35 });
          vfx.pillarAt(1.1, isPlayer ? '#ff1f1f' : '#1f6bff', slot);
          vfx.ring(vB.set(c.pos[0], 0, c.pos[2]), 2.6, isPlayer ? '#ff2a1a' : '#2a8bff', 0.6, 0.14, 0.5);
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
          vfx.ring(vB.set(c.pos[0], 0, c.pos[2]), 2.2, color, 0.5, 0.12, 0.4);
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
      const whirl = !ranger && st === 'skill_2';
      const charge = !ranger && st === 'skill_3';
      const dodging = st === 'dodge';
      const rangerThrow = ranger && (st === 'attack_1' || st === 'attack_2' || st === 'skill_4');
      const blocking = !ranger && intent.block && c.isGrounded && c.hp > 0 && (st === 'idle' || st === 'run' || st === 'block');
      if (blocking && !c.isBlocking) c.blockStart = gt;
      c.isBlocking = blocking;
      if (blocking) {
        c.actionState = 'block';
        c.stateDuration = 0;
      } else if (st === 'block') c.actionState = 'idle';
      c.hasSuperArmor = ranger ? c.actionState === 'ultimate' : ARMOR_STATES.has(c.actionState);

      // local move (x = right, z = forward relative to facing) drives strafe/backpedal animation
      const f = fwdOf(c.rotY);
      const rX = Math.cos(c.rotY);
      const rZ = -Math.sin(c.rotY);
      c.localMove = [intent.move.x * rX + intent.move.z * rZ, intent.move.x * f.x + intent.move.z * f.z];

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
          const spd = speedOf(c) * mult * Math.min(1, vA.length());
          vA.normalize();
          const accel = c.isGrounded ? 18 : 6;
          c.vel[0] = THREE.MathUtils.damp(c.vel[0], vA.x * spd, accel, dt);
          c.vel[2] = THREE.MathUtils.damp(c.vel[2], vA.z * spd, accel, dt);
          if (!whirl) c.targetRotY = intent.faceYaw;
          if (c.isGrounded && c.actionState === 'idle') c.actionState = 'run';
        } else {
          c.vel[0] = THREE.MathUtils.damp(c.vel[0], 0, 14, dt);
          c.vel[2] = THREE.MathUtils.damp(c.vel[2], 0, 14, dt);
          if (c.isGrounded && c.actionState === 'run') c.actionState = 'idle';
          if (c.actionState === 'idle' || c.actionState === 'block') c.targetRotY = intent.faceYaw;
        }
      }
    }

    function applyHit(
      slot: number,
      att: CombatantState,
      def: CombatantState,
      base: number,
      oIn: { heavy?: boolean; crit?: boolean; launch?: number; knock?: number; state?: CharacterActionState; dur?: number; shake?: number; unblockable?: boolean; noMark?: boolean; noStop?: boolean; ranged?: boolean; flinch?: boolean }
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
          vfx.ring(vA.set(def.pos[0], 0.05, def.pos[2]), 2.4, '#7dd3fc', 0.5, 0.1, 0.3);
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
        vfx.ring(vA.set(def.pos[0], 0.05, def.pos[2]), 2.0, '#e0f2fe', 0.35, 0.16, 0.4);
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
      att.totalDamageDealt += dmg;
      att.comboCount += 1;
      att.comboDamage += dmg;
      att.highestCombo = Math.max(att.highestCombo, att.comboCount);
      att.comboResetTimer = 2.5;
      if (rage) att.hp = Math.min(att.maxHp, att.hp + Math.round(dmg * 0.15));

      const protectedNow = (def.protectTimer ?? 0) > 0;
      // light darts only make you flinch: they chip HP but never interrupt, so a ranged fighter can't stun-lock
      const flinchOnly = !!o.flinch;
      const armored = protectedNow || flinchOnly || (def.hasSuperArmor && !o.launch && o.state !== 'knockdown' && o.state !== 'buried');
      if (flinchOnly) {
        def.vel[0] += hitDir.x * 1.2;
        def.vel[2] += hitDir.z * 1.2;
      }
      const stayBuried = def.actionState === 'buried' && o.state !== 'buried';
      if (!armored && !stayBuried) {
        const knock = o.knock ?? 4;
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
      att.mp = Math.min(att.maxMp, att.mp + (o.heavy ? 6 : 3));
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
          vfx.groundSlam(vB.set(ix, 0, iz), 0.85, color);
          controller?.addShake(slot === 0 ? 0.55 : 0.3);
          gameAudio.playSlam();
          if (Math.hypot(foe.pos[0] - ix, foe.pos[2] - iz) < 2.8 && foe.hp > 0) {
            applyHit(slot, c, foe, 160, { heavy: true, crit: true, knock: 0, state: 'buried', dur: 0.5 });
            if (foe.actionState === 'buried') {
              foe.isGrounded = true;
              foe.vel[1] = 0;
              foe.pos[1] = Math.min(foe.pos[1], 0);
              vfx.decal(vB.set(foe.pos[0], 0, foe.pos[2]), 2.2, 1.5);
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
          vfx.ring(vB.set(ix, 0, iz), 1.8, color, 0.35, 0.14, 0.5);
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
        if (c.stateTimer < 0.25) vfx.chargeWave(vB.set(c.pos[0], 0, c.pos[2]), fwd, color);
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
        vfx.groundSlam(vB.set(ix, 0, iz), 1, color);
        for (let k = 0; k < 4; k++) {
          const px = c.pos[0] + fwd.x * (0.6 + k * 0.75);
          const pz = c.pos[2] + fwd.z * (0.6 + k * 0.75);
          vfx.later(k * 0.05, () => vfx.fireColumn(new THREE.Vector3(px, 0, pz), 1.4 + k * 0.2, color));
        }
        if (rage) {
          // Blood rage: the fissure keeps burning
          for (let k = 1; k <= 4; k++) {
            vfx.later(k * 0.4, () => {
              vfx.fireColumn(new THREE.Vector3(ix, 0, iz), 1.2, color);
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
        if (Math.random() < 0.2) vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 1, 1, 2.5, 0.45);
        vfx.spiral(vB.set(c.pos[0], c.pos[1], c.pos[2]), 1.3, gt * 15, color);
        if (rage && dist < 4.5 && dist > 1.2 && foe.hp > 0) {
          // Blood rage: the vortex drags the opponent in
          foe.vel[0] += ((c.pos[0] - foe.pos[0]) / dist) * 18 * dt;
          foe.vel[2] += ((c.pos[2] - foe.pos[2]) / dist) * 18 * dt;
        }
        const t = performance.now();
        if (t - c.lastHitTick > 200) {
          c.lastHitTick = t;
          vfx.ring(vB.set(c.pos[0], 0.05, c.pos[2]), 1.9, color, 0.25, 0.1);
          if (dist < 2.9) applyHit(slot, c, foe, 40, { knock: 1.5, dur: 0.25 });
        }
      }

      if (c.actionState === 'skill_3') {
        const go = c.stateTimer < 0.45;
        if (go) {
          c.vel[0] = fwd.x * 20;
          c.vel[2] = fwd.z * 20;
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 2, 0.3, 1.5, 0.55);
          vfx.chargeWave(vB.set(c.pos[0], 0, c.pos[2]), fwd, color);
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
          vfx.ring(vB.set(foe.pos[0], 0, foe.pos[2]), 2.2, color, 0.4, 0.14, 0.4);
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
        vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 8, 0.3, 2, 0.45);
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
          if (p.pos.y < 0.04) {
            p.pos.y = 0.04;
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
            if (p.pos.y < 0.02) {
              p.pos.y = 0.02;
              embed(p, p.noStop ? 1.0 : 2.5);
              vfx.dustPuff(vB.copy(p.pos), 2, 0.1, 0.8, 0.25);
              break;
            }
            let wall = false;
            for (const pl of pillars) {
              if (p.pos.y < (pl.h ?? 99) && Math.hypot(p.pos.x - pl.x, p.pos.z - pl.z) < pl.r) {
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
                vfx.ring(vA.set(def.pos[0], 0.05, def.pos[2]), 1.3, '#5eead4', 0.5, 0.12, 0.4);
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
        for (const k of Object.keys(c.cooldowns)) c.cooldowns[k] = 0;
      }
      for (const pr of projRef.current) vfx.releaseProjectile(pr.obj);
      projRef.current = [];
      p1.pos = [map.spawnPlayer[0], 0, map.spawnPlayer[1]];
      en.pos = [map.spawnEnemy[0], 0, map.spawnEnemy[1]];
      p1.rotY = p1.targetRotY = yawTo(p1.pos, en.pos);
      en.rotY = en.targetRotY = yawTo(en.pos, p1.pos);
      if (controller) controller.yaw = p1.rotY;
      aiRef.current.think = 1.2;
      mapTimeRef.current = 0;
      eruptRef.current = { timer: 9 };
      bombZonesRef.current = [];
      waveRef.current = { timer: 7, warn: 0, side: 0, aiBlocks: false };
      lightningRef.current = { timer: 5 };
      mapRuntime.eruption = 0;
      mapRuntime.waveSide = 0;
      mapRuntime.waveRise = 0;
      mapRuntime.lightning = 0;
      ventRef.current = { timer: 3, warn: (map.vents || []).map(() => 0) };
      mapRuntime.ventHeat = (map.vents || []).map(() => 0);
      if (fromKO) onRoundEvent?.({ type: 'reset' });
    }

    /** Height of whatever is under the fighter: arena floor or the top of a pillar / crate */
    function groundHeight(c: CombatantState) {
      let g = overGround(c) ? 0 : -99;
      for (const pl of map.pillars || []) {
        if (pl.h === undefined) continue;
        if (c.pos[1] >= pl.h - 0.45 && Math.hypot(c.pos[0] - pl.x, c.pos[2] - pl.z) < pl.r + 0.15) g = Math.max(g, pl.h);
      }
      return g;
    }

    function overGround(c: CombatantState) {
      if (map.id === 'lavacliff') return Math.hypot(c.pos[0], c.pos[2]) <= map.radius + 0.35;
      return true;
    }

    function danger(x: number, z: number, margin: number) {
      for (const zn of bombZonesRef.current) if (Math.hypot(x - zn.x, z - zn.z) < zn.r + 0.6) return true;
      if (map.id === 'lavacliff') return Math.hypot(x, z) > map.radius - 1.8 - margin;
      return false;
    }

    function safeSpot(x: number, z: number): [number, number] {
      const cands: [number, number][] = [[0, 0]];
      for (let k = 0; k < 6; k++) cands.push([Math.cos((k / 6) * Math.PI * 2) * 5, Math.sin((k / 6) * Math.PI * 2) * 5]);
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
      vfx.ring(vA.set(def.pos[0], 0, def.pos[2]), 3, color, 0.7, 0.12, 0.5);
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

      if (map.id === 'lavacliff') {
        const R = map.radius;
        const falling = c.pos[1] < -0.05;
        // walking can't take you off the edge; knockback (and charges/rolls) can
        const canLeave = knocked || falling || c.actionState === 'skill_3' || c.hp <= 0;
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
        if (c.isGrounded && !overGround(c)) {
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
        if (Math.abs(c.pos[0]) > hx) {
          const sx = Math.sign(c.pos[0]);
          c.pos[0] = sx * hx;
          wallSplat(i, c, speed, sx * (hx + 0.3), c.pos[2]);
          c.vel[0] = 0;
        }
        if (Math.abs(c.pos[2]) > hz) {
          const sz = Math.sign(c.pos[2]);
          c.pos[2] = sz * hz;
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
      }
      for (const pl of map.pillars || []) {
        if (c.pos[1] >= (pl.h ?? 99) - 0.45) continue; // standing on (or above) it
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
      vfx.sparkBurst(vA.set(c.pos[0], -6.5, c.pos[2]), 40, '#ff6a1a', 10, 0.14, new THREE.Vector3(0, 1, 0), 0.6);
      vfx.flash(vA.set(c.pos[0], -5, c.pos[2]), '#ff6a1a', 60, 0.5, 14);
      if (aiOn && !round.over && c.hp > 0) {
        c.hp = 0;
        onRoundEvent?.({ type: 'toast', text: i === 0 ? '你坠入了岩浆！' : '霍岩影 坠入岩浆！' });
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
      for (let k = 0; k < 7; k++) {
        vfx.later(0.7 + k * 0.38, () => {
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

    function updateSea() {
      const w = waveRef.current;
      const lt = lightningRef.current;
      // the ship rolls on the swell (harder while the rogue wave rears up) and fighters slide with it
      const rise = Math.min(1, mapRuntime.waveRise);
      mapRuntime.shipRoll = Math.sin(gt * 0.55) * 0.05 + Math.sin(gt * 0.23 + 1) * 0.02 + (w.side || mapRuntime.waveSide) * rise * 0.07;
      mapRuntime.shipPitch = Math.sin(gt * 0.41 + 0.5) * 0.018;
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
          vB.set(w.side * (hx + 0.6), 0.6, (Math.random() - 0.5) * 24);
          vfx.sparkBurst(vB, 2, '#cfe8ff', 4, 0.1, vC.set(-w.side * 0.3, 1, 0), 0.4);
        }
        if (w.warn <= 0) {
          // crash over the deck
          w.warn = 0;
          mapRuntime.waveRise = 1.15;
          onRoundEvent?.({ type: 'screenFlash', color: 'rgba(170,215,255,0.4)' });
          controller?.addShake(0.4);
          gameAudio.playWaveCrash();
          for (let k = 0; k < 14; k++) {
            const z = -12 + (k / 13) * 24;
            vB.set(w.side * hx, 0.5, z);
            vfx.sparkBurst(vB, 6, '#e0f2ff', 9, 0.16, vC.set(-w.side, 0.6, 0), 0.5);
            vfx.dustPuff(vB, 2, 0.5, 6, 1.1, '#cfe3f5');
          }
          fighters.forEach((c) => {
            if (c.hp <= 0 || c.pos[1] > 1.5) return;
            const push = c.isBlocking ? 4 : 16;
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
    function runAI(me: CombatantState, foe: CombatantState, out: Intent, dt2: number) {
      if (me.classId === 'Ranger') return runRangerAI(me, foe, out, dt2);
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

      if (ai.think <= 0 && free && !ai.request) {
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
      <hemisphereLight args={[map.hemi[0], map.hemi[1], map.hemi[2]]} />
      <directionalLight
        ref={keyLightRef}
        color={map.keyColor}
        intensity={map.keyIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-camera-near={1}
        shadow-camera-far={40}
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

      <primitive object={vfx.root} />

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.95} luminanceSmoothing={0.2} />
        <Vignette offset={0.3} darkness={0.55} />
        <ToneMapping mode={ACES_FILMIC as any} />
      </EffectComposer>
    </group>
  );
}
