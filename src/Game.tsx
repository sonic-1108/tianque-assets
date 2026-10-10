import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing';
import { RoomEnvironment } from 'three-stdlib';
import { getConfig } from './constants';
import { gameAudio } from './utils/helper';
import { CombatantState, GameState, TargetingState, CharacterActionState } from './types';
import { GameInputSnapshot, InputKeyAction } from './input';
import { ACTION_PHASE_CONFIGS, CLASS_CONFIGS } from './components/CombatData';
import { CharacterRig3D, AnimationDebugInfo, ModelLoadProgress, RigSockets } from './components/CharacterRig3D';
import { Arenas3D } from './components/Arenas3D';
import { VFXSystem, RibbonTrail } from './components/VFXSystem';
import { CameraController } from './CameraController';

export type RoundEvent =
  | { type: 'ko'; winner: 'player' | 'enemy' }
  | { type: 'reset' }
  | { type: 'playerHit'; heavy: boolean };

interface GameSceneProps {
  gameState: GameState;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  inputRef: React.MutableRefObject<GameInputSnapshot>;
  p1RefState: React.MutableRefObject<CombatantState>;
  dummyRefState: React.MutableRefObject<CombatantState>;
  targetingRefState: React.MutableRefObject<TargetingState>;
  /** true = 霍岩影 fights back; false = passive training dummy */
  aiEnabledRef: React.MutableRefObject<boolean>;
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
  const auraTimers = useRef([0, 0]);
  const footTimers = useRef([0, 0]);
  const wasGrounded = useRef([true, true]);
  const lastReportRef = useRef(0);
  const roundRef = useRef<{ over: boolean; timer: number }>({ over: false, timer: 0 });
  const aiRef = useRef<AIMemory>({ think: 1.0, plan: 'idle', planTimer: 0, strafe: 1, comboLeft: 0, request: null, requestTtl: 0, dodgeDir: 1 });

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

  // ---------- environment ----------
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new (RoomEnvironment as any)(), 0.04).texture;
    scene.environment = env;
    (scene as any).environmentIntensity = 0.55;
    scene.background = new THREE.Color('#1a1f2b');
    scene.fog = new THREE.Fog('#1a1f2b', 28, 70);
    gl.toneMappingExposure = 1.15;
    return () => {
      env.dispose();
      pmrem.dispose();
      scene.environment = null;
    };
  }, [gl, scene]);

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

    const arenaRadius = getConfig('arenaRadius') || 22;
    const gravity = getConfig('gravity') || 26;
    const baseSpeed = (getConfig('baseMoveSpeed') || 8.5) * (CLASS_CONFIGS.Berserker.speedRatio || 0.75);
    const jumpVel = getConfig('jumpVelocity') || 11;
    const skills = CLASS_CONFIGS.Berserker.skills;

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
      c.mp = Math.min(c.maxMp, c.mp + dt * 6);
    }

    // ---------- round flow ----------
    if (round.over) {
      round.timer -= rawDt;
      if (round.timer <= 0) {
        round.over = false;
        for (const c of fighters) {
          c.hp = c.maxHp;
          c.mp = c.maxMp;
          c.vel = [0, 0, 0];
          c.actionState = 'idle';
          c.stateTimer = 0;
          c.stateDuration = 0;
          c.buffs = [];
          c.comboCount = 0;
          c.comboDamage = 0;
          c.dodgeIframeTimer = 0.6;
          for (const k of Object.keys(c.cooldowns)) c.cooldowns[k] = 0;
        }
        p1.pos = [0, 0, 0];
        p1.rotY = p1.targetRotY = 0;
        en.pos = [0, 0, -6];
        en.rotY = en.targetRotY = Math.PI;
        aiRef.current.think = 1.2;
        onRoundEvent?.({ type: 'reset' });
      }
    }

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

    const camYaw = controller ? controller.yaw : 0;
    const basis = controller ? controller.getMoveBasis() : { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };

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
      block: actions.special && !round.over,
    };

    // Opponent: AI brain
    const enemyIntent: Intent = { move: new THREE.Vector3(), faceYaw: yawTo(en.pos, p1.pos), request: null, block: false };
    if (aiOn && !round.over && en.hp > 0) runAI(en, p1, enemyIntent, dt);
    else if (!aiOn) {
      enemyIntent.faceYaw = en.targetRotY;
    }

    // ================= ACTIONS =================
    const p1Ok = executeIntent(0, p1, en, playerIntent);
    if (p1Ok && playerIntent.request) input.consumeBuffer();
    const enOk = executeIntent(1, en, p1, enemyIntent);
    if (enOk) aiRef.current.request = null;

    applyMovement(p1, playerIntent);
    applyMovement(en, enemyIntent);

    // ================= COMBAT =================
    resolveAttacks(0, p1, en);
    resolveAttacks(1, en, p1);

    // ================= PHYSICS =================
    for (let i = 0; i < 2; i++) {
      const c = fighters[i];
      const cdt = c.hitStopTimer > 0 ? dt * 0.08 : dt;
      c.stateTimer += cdt;
      if (c.stateDuration > 0 && c.stateTimer >= c.stateDuration && c.hp > 0) {
        if (c.actionState !== 'idle' && c.actionState !== 'run' && c.actionState !== 'jump' && c.actionState !== 'block') {
          if (c.actionState === 'knockdown') c.dodgeIframeTimer = Math.max(c.dodgeIframeTimer, 0.5); // wake-up invulnerability
          c.actionState = c.isGrounded ? 'idle' : 'jump';
          c.stateDuration = 0;
        }
      }
      if (!c.isGrounded) {
        c.vel[1] -= gravity * cdt;
        c.pos[1] += c.vel[1] * cdt;
        if (c.pos[1] <= 0) {
          c.pos[1] = 0;
          const impact = -c.vel[1];
          c.vel[1] = 0;
          c.isGrounded = true;
          if (c.actionState === 'jump') c.actionState = 'idle';
          if (c.actionState === 'launched') {
            c.actionState = 'knockdown';
            c.stateTimer = 0;
            c.stateDuration = c.hp > 0 ? 0.8 : 99;
          }
          if (impact > 6) vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), Math.min(14, Math.round(impact)), 0.5, 2, 0.6);
        }
      }
      c.pos[0] += c.vel[0] * cdt;
      c.pos[2] += c.vel[2] * cdt;
      const free = c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'jump' || c.actionState === 'block' || c.actionState === 'skill_2';
      if (!free || c.actionState === 'dodge') {
        const k = Math.exp(-4.5 * cdt);
        c.vel[0] *= k;
        c.vel[2] *= k;
      }
      const d = Math.hypot(c.pos[0], c.pos[2]);
      if (d > arenaRadius) {
        c.pos[0] *= arenaRadius / d;
        c.pos[2] *= arenaRadius / d;
        c.vel[0] = 0;
        c.vel[2] = 0;
      }
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
        }
      }
      if (!wasGrounded.current[i] && c.isGrounded && c.actionState !== 'ultimate') vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 6, 0.3, 1.4, 0.45);
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
      const cfg = ACTION_PHASE_CONFIGS[c.actionState];
      const swinging =
        SWING_STATES.has(c.actionState) &&
        (c.actionState === 'skill_2' ||
          c.actionState === 'skill_3' ||
          (c.actionState === 'ultimate' ? !!c.ultSlamStarted && c.stateTimer < 1.0 : !!cfg && c.stateTimer >= cfg.startup * 0.4 && c.stateTimer <= cfg.startup + cfg.active + 0.05));
      t.right.emitting = swinging;
      t.left.emitting = swinging && c.actionState !== 'attack_1';
      const rage = c.buffs.some((b) => b.type === 'blood_rage');
      const col = i === 0 ? (rage ? '#ff1030' : PLAYER_COLOR) : rage ? '#1f6bff' : ENEMY_COLOR;
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
      onDebugUpdate?.({
        playerPos: [p1.pos[0], p1.pos[1], p1.pos[2]],
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        camYaw: controller ? controller.yaw : 0,
        camPitch: controller ? controller.pitch : 0.3,
        camDist: controller ? controller.distance : 5,
      });
    }

    // ======================================================
    // helpers (closures over this frame's values)
    // ======================================================
    function isFree(c: CombatantState) {
      return c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'block' || c.actionState === 'jump';
    }

    function phaseOf(c: CombatantState) {
      const cfg = ACTION_PHASE_CONFIGS[c.actionState];
      if (!cfg || c.stateDuration <= 0) return { phase: 'none' as const, progress: 0 };
      const t = c.stateTimer;
      if (t < cfg.startup) return { phase: 'startup' as const, progress: t / Math.max(0.0001, cfg.startup) };
      if (t < cfg.startup + cfg.active) return { phase: 'active' as const, progress: (t - cfg.startup) / Math.max(0.0001, cfg.active) };
      return { phase: 'recovery' as const, progress: (t - cfg.startup - cfg.active) / Math.max(0.0001, cfg.recovery) };
    }

    function executeIntent(slot: number, c: CombatantState, foe: CombatantState, intent: Intent): boolean {
      if (c.hp <= 0) return false;
      const isPlayer = slot === 0;
      const dbg = input.debug;
      const cur = c.actionState;
      const cfgCur = ACTION_PHASE_CONFIGS[cur];
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

      const start = (next: CharacterActionState, push = 0) => {
        const cfg = ACTION_PHASE_CONFIGS[next]!;
        c.actionState = next;
        c.stateTimer = 0;
        c.stateDuration = cfg.totalDuration;
        c.hasHitCurrentMove = false;
        c.multiHitCounter = 0;
        c.actionsPerformed += 1;
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
      const color = isPlayer ? PLAYER_COLOR : ENEMY_COLOR;
      const sfx = isPlayer ? 1 : 0.6;
      void sfx;

      switch (req) {
        case 'dodge': {
          if (c.dodgeCooldownTimer > 0 || !canDodge) return report('闪避', '无法闪避'), false;
          const dir = vA.copy(intent.move);
          if (dir.lengthSq() < 0.01) dir.copy(fwdOf(intent.faceYaw));
          dir.y = 0;
          dir.normalize();
          const rollYaw = Math.atan2(-dir.x, -dir.z);
          c.actionState = 'dodge';
          c.stateTimer = 0;
          c.stateDuration = ACTION_PHASE_CONFIGS.dodge!.totalDuration;
          c.rotY = c.targetRotY = rollYaw;
          c.vel[0] = dir.x * 15;
          c.vel[2] = dir.z * 15;
          c.dodgeIframeTimer = 0.35;
          c.dodgeCooldownTimer = 0.9;
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 10, 0.4, 2, 0.55);
          if (isPlayer) gameAudio.playRetroJump();
          report('闪避', '成功施放 (Cast)');
          return true;
        }
        case 'jump': {
          if (!canJump) return report('跳跃', '无法起跳'), false;
          c.vel[1] = jumpVel;
          c.isGrounded = false;
          c.actionState = 'jump';
          c.stateDuration = 0;
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 6, 0.3, 1.2, 0.45);
          if (isPlayer) gameAudio.playRetroJump();
          report('跳跃', '成功起跳');
          return true;
        }
        case 'attack': {
          let next: CharacterActionState | null = null;
          if (free) next = 'attack_1';
          else if (cur === 'attack_1' && phase === 'recovery') next = 'attack_2';
          else if (cur === 'attack_2' && phase === 'recovery') next = 'attack_3';
          if (!next) return report('普攻', `被 [${cur} ${phase}] 占用`), false;
          start(next, ACTION_PHASE_CONFIGS[next]!.forwardMomentum);
          gameAudio.playSwordClash();
          report('普攻', `施放 ${next.slice(-1)} 段斩`);
          return true;
        }
        case 'skill1': {
          if (!paySkill(0, 'skill1', '1')) return false;
          start('skill_1', ACTION_PHASE_CONFIGS.skill_1!.forwardMomentum);
          if (!c.isGrounded) c.vel[1] = -20;
          else {
            c.vel[1] = 5.5;
            c.isGrounded = false;
          }
          gameAudio.playPowerupChime();
          return true;
        }
        case 'skill2': {
          if (!paySkill(1, 'skill2', '2')) return false;
          start('skill_2', 0);
          vfx.setVortex(true, ACTION_PHASE_CONFIGS.skill_2!.totalDuration, slot);
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 18, 1, 3, 0.7);
          gameAudio.playArcadeLaser();
          return true;
        }
        case 'skill3': {
          if (!paySkill(2, 'skill3', '3')) return false;
          start('skill_3', ACTION_PHASE_CONFIGS.skill_3!.forwardMomentum);
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 14, 0.5, 2.5, 0.6);
          gameAudio.playGunshotBlast();
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
            gameAudio.playLevelUpStinger();
          }
          report(`4: ${sk.name}`, '成功施放 (Cast)');
          return true;
        }
        case 'ultimate': {
          if (!paySkill(4, 'ultimate', 'R')) return false;
          start('ultimate', ACTION_PHASE_CONFIGS.ultimate!.forwardMomentum);
          c.vel[1] = 13;
          c.isGrounded = false;
          c.ultSlamStarted = false;
          vfx.ring(vB.set(c.pos[0], 0, c.pos[2]), 2.2, color, 0.5, 0.12, 0.4);
          vfx.dustPuff(vB, 20, 0.8, 3.5, 0.8);
          gameAudio.playVictoryFanfare();
          return true;
        }
      }
      void foe;
      return false;
    }

    function applyMovement(c: CombatantState, intent: Intent) {
      const st = c.actionState;
      const whirl = st === 'skill_2';
      const charge = st === 'skill_3';
      const dodging = st === 'dodge';
      const blocking = intent.block && c.isGrounded && c.hp > 0 && (st === 'idle' || st === 'run' || st === 'block');
      c.isBlocking = blocking;
      if (blocking) {
        c.actionState = 'block';
        c.stateDuration = 0;
      } else if (st === 'block') c.actionState = 'idle';
      c.hasSuperArmor = ARMOR_STATES.has(c.actionState);

      // local move (x = right, z = forward relative to facing) drives strafe/backpedal animation
      const f = fwdOf(c.rotY);
      const rX = Math.cos(c.rotY);
      const rZ = -Math.sin(c.rotY);
      c.localMove = [intent.move.x * rX + intent.move.z * rZ, intent.move.x * f.x + intent.move.z * f.z];

      const canMove = !dodging && !charge && c.hp > 0 && (c.actionState === 'idle' || c.actionState === 'run' || c.actionState === 'jump' || c.actionState === 'block' || whirl);
      if (canMove) {
        if (intent.move.lengthSq() > 0.01) {
          vA.copy(intent.move);
          const lz2 = c.localMove[1];
          let mult = lz2 < -0.3 ? 0.6 : Math.abs(c.localMove[0]) > 0.7 ? 0.85 : 1;
          if (whirl) mult = 0.45;
          if (c.actionState === 'block') mult = 0.25;
          if (c.buffs.some((b) => b.type === 'blood_rage')) mult *= 1.15;
          const spd = baseSpeed * mult * Math.min(1, vA.length());
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
      o: { heavy?: boolean; crit?: boolean; launch?: number; knock?: number; state?: CharacterActionState; dur?: number; shake?: number; unblockable?: boolean }
    ) {
      if (def.hp <= 0) return;
      const attackerIsPlayer = slot === 0;
      const hitDir = vC.set(def.pos[0] - att.pos[0], 0, def.pos[2] - att.pos[2]).normalize();
      const chest = vB.set(def.pos[0], def.pos[1] + 1.15, def.pos[2]).addScaledVector(hitDir, -0.35);
      const color = attackerIsPlayer ? PLAYER_COLOR : ENEMY_COLOR;

      // dodge i-frames / wake-up invulnerability
      if (def.dodgeIframeTimer > 0) {
        vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.0, def.pos[2]), '闪避', false, '#a7f3d0');
        return;
      }
      // no hitting a grounded, knocked-down fighter (prevents infinite locks)
      if (def.actionState === 'knockdown' && def.isGrounded && !o.unblockable) return;

      const rage = att.buffs.some((b) => b.type === 'blood_rage');
      let dmg = Math.round(base * (rage ? 1.35 : 1));

      // frontal block: 60% reduction, no stagger
      const facing = fwdOf(def.rotY);
      const frontal = facing.x * -hitDir.x + facing.z * -hitDir.z > 0.2;
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
        gameAudio.playSwordClash();
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

      const armored = def.hasSuperArmor && !o.launch && o.state !== 'knockdown';
      if (!armored) {
        const knock = o.knock ?? 4;
        def.vel[0] = hitDir.x * knock;
        def.vel[2] = hitDir.z * knock;
        if (o.launch) {
          def.vel[1] = o.launch;
          def.isGrounded = false;
        }
        def.actionState = o.state ?? 'hitstun';
        def.stateTimer = 0;
        def.stateDuration = o.dur ?? 0.35;
        def.rotY = def.targetRotY = yawTo(def.pos, att.pos);
        def.isBlocking = false;
      }
      def.whiteFlashTimer = o.heavy ? 0.1 : 0.06;
      const stop = o.heavy ? 0.09 : 0.05;
      att.hitStopTimer = stop;
      def.hitStopTimer = stop;
      vfx.hitImpact(chest, hitDir, !!o.heavy, color);
      vfx.damageNumber(vA.set(def.pos[0], def.pos[1] + 2.05, def.pos[2]), dmg, !!o.crit, attackerIsPlayer ? '#ffffff' : '#ff8a8a');
      if (o.crit) gameAudio.playChiptuneExplosion();
      else gameAudio.playMeleePunch();
      if (attackerIsPlayer && o.shake) controller?.addShake(o.shake);
      if (!attackerIsPlayer) {
        controller?.addShake(o.heavy ? 0.45 : 0.18);
        onRoundEvent?.({ type: 'playerHit', heavy: !!o.heavy });
      }

      // KO
      if (def.hp <= 0 && aiOn && !round.over) {
        round.over = true;
        round.timer = 3.2;
        slowMoTimerRef.current = 0.7;
        def.actionState = def.isGrounded ? 'knockdown' : 'launched';
        def.stateTimer = 0;
        def.stateDuration = 99;
        if (def.isGrounded) {
          def.vel[1] = 6;
          def.isGrounded = false;
          def.actionState = 'launched';
        }
        vfx.ring(vA.set(def.pos[0], 0, def.pos[2]), 3, color, 0.7, 0.12, 0.5);
        onRoundEvent?.({ type: 'ko', winner: attackerIsPlayer ? 'player' : 'enemy' });
      }
    }

    function resolveAttacks(slot: number, c: CombatantState, foe: CombatantState) {
      if (c.hp <= 0) return;
      const fwd = fwdOf(c.rotY).clone();
      const dist = Math.hypot(foe.pos[0] - c.pos[0], foe.pos[2] - c.pos[2]);
      const inFront = (fwd.x * (foe.pos[0] - c.pos[0]) + fwd.z * (foe.pos[2] - c.pos[2])) / Math.max(0.001, dist) > 0.2;
      const cfg = ACTION_PHASE_CONFIGS[c.actionState];
      const active = !!cfg && c.stateTimer >= cfg.startup && c.stateTimer <= cfg.startup + cfg.active;
      const rage = c.buffs.some((b) => b.type === 'blood_rage');
      const color = slot === 0 ? (rage ? '#ff1f2f' : PLAYER_COLOR) : rage ? '#1f6bff' : ENEMY_COLOR;

      if (c.actionState.startsWith('attack_') && active && !c.hasHitCurrentMove && dist < 2.6 && inFront) {
        c.hasHitCurrentMove = true;
        if (c.actionState === 'attack_1') applyHit(slot, c, foe, 60, { knock: 3.5 });
        else if (c.actionState === 'attack_2') applyHit(slot, c, foe, 85, { knock: 4.5 });
        else applyHit(slot, c, foe, 150, { heavy: true, crit: true, knock: 9, state: 'knockdown', dur: 0.9, launch: 4, shake: 0.35 });
      }

      if (c.actionState === 'skill_1' && active && !c.hasHitCurrentMove) {
        c.hasHitCurrentMove = true;
        const ix = c.pos[0] + fwd.x * 1.5;
        const iz = c.pos[2] + fwd.z * 1.5;
        vfx.groundSlam(vB.set(ix, 0, iz), 1, color);
        if (slot === 0) controller?.addShake(0.6);
        else controller?.addShake(Math.max(0, 0.5 - dist * 0.05));
        gameAudio.playGeneralExplosion();
        if (Math.hypot(foe.pos[0] - ix, foe.pos[2] - iz) < 3.4) applyHit(slot, c, foe, 210, { heavy: true, crit: true, launch: 9.5, knock: 3, state: 'launched', dur: 0.9 });
      }

      if (c.actionState === 'skill_2') {
        if (Math.random() < 0.2) vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 1, 1, 2.5, 0.45);
        if (Math.random() < 0.5) vfx.sparkBurst(vB.set(c.pos[0], 1, c.pos[2]), 2, color, 6, 0.07);
        const t = performance.now();
        if (t - c.lastHitTick > 200 && dist < 2.9) {
          c.lastHitTick = t;
          applyHit(slot, c, foe, 45, { knock: 1.5, dur: 0.25 });
        }
      }

      if (c.actionState === 'skill_3') {
        const go = c.stateTimer < 0.45;
        if (go) {
          c.vel[0] = fwd.x * 20;
          c.vel[2] = fwd.z * 20;
          vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), 2, 0.3, 1.5, 0.55);
        } else {
          c.vel[0] = THREE.MathUtils.damp(c.vel[0], 0, 9, dt);
          c.vel[2] = THREE.MathUtils.damp(c.vel[2], 0, 9, dt);
        }
        if (go && dist < 1.8 && !c.hasHitCurrentMove) {
          c.hasHitCurrentMove = true;
          applyHit(slot, c, foe, 185, { heavy: true, crit: true, knock: 15, launch: 7, state: 'knockdown', dur: 1, shake: 0.55 });
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
        if (!c.isGrounded) vfx.embers(vB.set(c.pos[0], c.pos[1] + 0.6, c.pos[2]), c.ultSlamStarted ? 6 : 2, slot === 0 ? '#ff7a2a' : '#5ab0ff', 0.35, -1, 0.1);
        if (c.ultSlamStarted && c.isGrounded && !c.hasHitCurrentMove) {
          c.hasHitCurrentMove = true;
          slowMoTimerRef.current = Math.max(slowMoTimerRef.current, 0.3);
          controller?.addShake(slot === 0 ? 1 : 0.7);
          vfx.ultimateImpact(vB.set(c.pos[0] + fwd.x * 0.8, 0, c.pos[2] + fwd.z * 0.8));
          gameAudio.playGeneralExplosion();
          gameAudio.playChiptuneExplosion();
          if (dist < 7) applyHit(slot, c, foe, 520, { heavy: true, crit: true, launch: 15, knock: 10, state: 'knockdown', dur: 1.2, unblockable: true });
          c.vel[0] = 0;
          c.vel[2] = 0;
        }
      }
    }

    // ------------------------------------------------------
    // AI: 霍岩影. Thinks a few times per second, reacts to the
    // player's attacks, keeps spacing, combos, uses skills.
    // ------------------------------------------------------
    function runAI(me: CombatantState, foe: CombatantState, out: Intent, dt2: number) {
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

      // continue a combo string
      if (ai.comboLeft > 0 && (me.actionState === 'attack_1' || me.actionState === 'attack_2') && phaseOf(me).phase === 'recovery') {
        if (dist < 3) ask('attack');
        ai.comboLeft -= 1;
      }

      if (ai.think <= 0 && free && !ai.request) {
        ai.think = 0.22 + Math.random() * 0.25;
        const r = Math.random();
        if (foeAttacking && dist < 3.6 && r < 0.45) {
          if (r < 0.25 && me.dodgeCooldownTimer <= 0) {
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
      if (out.move.lengthSq() > 1) out.move.normalize();
      out.request = ai.request;
    }
  });

  return (
    <group>
      <hemisphereLight args={['#cfe3ff', '#3a2f28', 0.9]} />
      <directionalLight
        ref={keyLightRef}
        color="#ffe2c4"
        intensity={2.6}
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

      <Arenas3D />

      <group ref={playerGroupRef}>
        <CharacterRig3D
          combatantRef={p1RefState}
          isPlayer
          socketsRef={playerSockets}
          showBoneAxes={showBoneAxes}
          onAnimationDebug={onAnimationDebug}
          onLoadProgress={onLoadProgress}
        />
      </group>

      <group ref={enemyGroupRef} position={[0, 0, -6]}>
        <CharacterRig3D combatantRef={dummyRefState} isPlayer={false} socketsRef={enemySockets} />
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
