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
import { VFXSystem } from './components/VFXSystem';
import { CameraController } from './CameraController';

interface GameSceneProps {
  gameState: GameState;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  inputRef: React.MutableRefObject<GameInputSnapshot>;
  p1RefState: React.MutableRefObject<CombatantState>;
  dummyRefState: React.MutableRefObject<CombatantState>;
  targetingRefState: React.MutableRefObject<TargetingState>;
  showBoneAxes?: boolean;
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

// Module scratch vectors (no per-frame allocation)
const playerVec = new THREE.Vector3();
const headProj = new THREE.Vector3();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const vD = new THREE.Vector3();

const ATTACK_STATES = new Set<CharacterActionState>(['attack_1', 'attack_2', 'attack_3', 'skill_1', 'skill_2', 'skill_3', 'ultimate']);

export function Game({
  gameState,
  inputRef,
  p1RefState,
  dummyRefState,
  targetingRefState,
  showBoneAxes,
  onVfxCountChange,
  onDebugUpdate,
  onDummyScreenPosUpdate,
  onBloodRageFlash,
  onAnimationDebug,
  onLoadProgress,
}: GameSceneProps) {
  const { camera, gl, scene, size } = useThree();

  const playerGroupRef = useRef<THREE.Group>(null);
  const dummyGroupRef = useRef<THREE.Group>(null);
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const rimLightRef = useRef<THREE.DirectionalLight>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const socketsRef = useRef<RigSockets>({ rightBase: null, rightTip: null, leftBase: null, leftTip: null, chest: null });

  const slowMoTimerRef = useRef(0);
  const auraTimerRef = useRef(0);
  const footTimerRef = useRef(0);
  const wasGroundedRef = useRef(true);
  const lastVfxReportRef = useRef(0);

  // ---------- VFX system (imperative, pooled) ----------
  const vfx = useMemo(() => new VFXSystem(), []);
  const trails = useMemo(() => ({ right: vfx.createTrail('#ff3b1f'), left: vfx.createTrail('#ff3b1f') }), [vfx]);
  useEffect(() => () => vfx.dispose(), [vfx]);
  useEffect(() => vfx.setViewportHeight(size.height), [vfx, size.height]);

  // ---------- Environment lighting & renderer ----------
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new (RoomEnvironment as any)();
    const env = pmrem.fromScene(envScene, 0.04).texture;
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

  // ---------- Camera ----------
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

    let timeScale = 1.0;
    if (slowMoTimerRef.current > 0) {
      slowMoTimerRef.current -= delta;
      timeScale = 0.25;
    }
    const rawDt = Math.min(delta, 0.04);
    const dt = rawDt * timeScale;

    const arenaRadius = getConfig('arenaRadius') || 22.0;
    const gravity = getConfig('gravity') || 26.0;
    const baseSpeed = (getConfig('baseMoveSpeed') || 8.5) * (CLASS_CONFIGS.Berserker.speedRatio || 0.75);
    const jumpVel = getConfig('jumpVelocity') || 11.0;

    const p1 = p1RefState.current;
    const dummy = dummyRefState.current;
    const targeting = targetingRefState.current;
    const input = inputRef.current;
    const actions = input.actions;
    const just = input.justPressed;
    const controller = cameraControllerRef.current;
    const skills = CLASS_CONFIGS.Berserker.skills;

    // ---------- timers ----------
    for (const k of Object.keys(p1.cooldowns)) {
      const v = p1.cooldowns[k];
      p1.cooldowns[k] = typeof v !== 'number' || isNaN(v) ? 0 : Math.max(0, v - dt);
    }
    p1.buffs = p1.buffs.map((b) => ({ ...b, duration: b.duration - dt })).filter((b) => b.duration > 0);
    const isBloodRage = p1.buffs.some((b) => b.type === 'blood_rage');

    for (const c of [p1, dummy]) {
      if (c.hitStopTimer > 0) c.hitStopTimer -= rawDt;
      if (c.whiteFlashTimer > 0) c.whiteFlashTimer -= dt;
    }
    if (p1.dodgeCooldownTimer > 0) p1.dodgeCooldownTimer -= dt;
    if (p1.dodgeIframeTimer > 0) p1.dodgeIframeTimer -= dt;
    if (p1.comboResetTimer > 0) {
      p1.comboResetTimer -= dt;
      if (p1.comboResetTimer <= 0) {
        p1.comboCount = 0;
        p1.comboDamage = 0;
      }
    }
    p1.mp = Math.min(p1.maxMp, p1.mp + dt * 6.0);

    // ---------- targeting ----------
    if (just.lockEnemy) {
      just.lockEnemy = false;
      targeting.lockedEnemyId = targeting.lockedEnemyId ? null : dummy.id;
      gameAudio.playCrispClick();
    }
    if (just.clearTarget) {
      just.clearTarget = false;
      targeting.lockedEnemyId = null;
      targeting.friendlyTargetId = null;
    }

    // ---------- facing helpers ----------
    const camYaw = controller ? controller.yaw : 0;
    const basis = controller ? controller.getMoveBasis() : { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0) };
    // Where attacks should point: locked target, otherwise camera forward (MMO style)
    const aimYaw = targeting.lockedEnemyId
      ? Math.atan2(-(dummy.pos[0] - p1.pos[0]), -(dummy.pos[2] - p1.pos[2]))
      : camYaw;

    // ---------- action phase ----------
    const curAction = p1.actionState;
    const cfgCur = ACTION_PHASE_CONFIGS[curAction];
    let phase: 'startup' | 'active' | 'recovery' = 'active';
    let phaseProgress = 0;
    if (cfgCur && p1.stateDuration > 0) {
      const t = p1.stateTimer;
      if (t < cfgCur.startup) {
        phase = 'startup';
        phaseProgress = cfgCur.startup > 0 ? t / cfgCur.startup : 1;
      } else if (t < cfgCur.startup + cfgCur.active) {
        phase = 'active';
        phaseProgress = (t - cfgCur.startup) / Math.max(0.0001, cfgCur.active);
      } else {
        phase = 'recovery';
        phaseProgress = (t - cfgCur.startup - cfgCur.active) / Math.max(0.0001, cfgCur.recovery);
      }
    }
    const isFree = curAction === 'idle' || curAction === 'run' || curAction === 'block' || curAction === 'jump';
    const isBasic = curAction.startsWith('attack_');
    const canDodge = isFree || (!!cfgCur?.cancelableByDodge && (phase === 'recovery' || (isBasic && phase === 'startup')));
    const canSkill = isFree || (isBasic && phase === 'recovery') || (!!cfgCur?.cancelableBySkill && phase === 'recovery');
    const canJump = p1.isGrounded && (isFree || (isBasic && phase === 'recovery'));

    const hasMove = actions.forward || actions.backward || actions.left || actions.right;
    if (phase === 'recovery' && phaseProgress >= 0.6 && hasMove && curAction !== 'dodge' && !isFree) {
      p1.actionState = p1.isGrounded ? 'run' : 'jump';
      p1.stateDuration = 0;
    }

    const startAction = (next: CharacterActionState, duration: number, push = 0) => {
      p1.actionState = next;
      p1.stateTimer = 0;
      p1.stateDuration = duration;
      p1.hasHitCurrentMove = false;
      p1.multiHitCounter = 0;
      p1.actionsPerformed += 1;
      // snap to aim direction so the move goes where the player is looking
      p1.rotY = aimYaw;
      p1.targetRotY = aimYaw;
      if (push > 0) {
        p1.vel[0] = -Math.sin(aimYaw) * push;
        p1.vel[2] = -Math.cos(aimYaw) * push;
      }
    };

    const dbg = input.debug;
    const trySkill = (idx: number, cdKey: string, label: string) => {
      const skill = skills[idx];
      dbg.lastSkillAttempted = `${label}: ${skill.name}`;
      if (p1.cooldowns[cdKey] > 0) {
        dbg.lastSkillResult = `冷却中 (${p1.cooldowns[cdKey].toFixed(1)}s)`;
        return false;
      }
      if (p1.mp < skill.mpCost) {
        dbg.lastSkillResult = `MP不足 (需 ${skill.mpCost})`;
        return false;
      }
      if (!canSkill) {
        dbg.lastSkillResult = `被 [${curAction} ${phase}] 占用`;
        return false;
      }
      p1.mp -= skill.mpCost;
      p1.cooldowns[cdKey] = skill.cooldown;
      dbg.lastSkillResult = '成功施放 (Cast)';
      return true;
    };

    const execute = (req: InputKeyAction): boolean => {
      switch (req) {
        case 'dodge': {
          dbg.lastSkillAttempted = '闪避 (Dodge)';
          if (p1.dodgeCooldownTimer > 0) {
            dbg.lastSkillResult = `冷却中 (${p1.dodgeCooldownTimer.toFixed(1)}s)`;
            return false;
          }
          if (!canDodge) {
            dbg.lastSkillResult = `被 [${curAction} ${phase}] 锁定`;
            return false;
          }
          const dir = vA.set(0, 0, 0);
          if (actions.forward) dir.add(basis.forward);
          if (actions.backward) dir.sub(basis.forward);
          if (actions.right) dir.add(basis.right);
          if (actions.left) dir.sub(basis.right);
          if (dir.lengthSq() < 0.001) dir.copy(basis.forward);
          dir.normalize();
          const rollYaw = Math.atan2(-dir.x, -dir.z);
          const cfg = ACTION_PHASE_CONFIGS.dodge!;
          p1.actionState = 'dodge';
          p1.stateTimer = 0;
          p1.stateDuration = cfg.totalDuration;
          p1.rotY = rollYaw;
          p1.targetRotY = rollYaw;
          p1.vel[0] = dir.x * 15;
          p1.vel[2] = dir.z * 15;
          p1.dodgeIframeTimer = 0.35;
          p1.dodgeCooldownTimer = 0.9;
          vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 10, 0.4, 2.0, 0.55);
          gameAudio.playRetroJump();
          dbg.lastSkillResult = '成功施放 (Cast)';
          return true;
        }
        case 'jump': {
          dbg.lastSkillAttempted = '跳跃 (Jump)';
          if (!canJump) {
            dbg.lastSkillResult = '无法在当前状态起跳';
            return false;
          }
          p1.vel[1] = jumpVel;
          p1.isGrounded = false;
          p1.actionState = 'jump';
          p1.stateDuration = 0;
          vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 6, 0.3, 1.2, 0.45);
          gameAudio.playRetroJump();
          dbg.lastSkillResult = '成功起跳';
          return true;
        }
        case 'attack': {
          dbg.lastSkillAttempted = '基础斩击 (Attack)';
          let next: CharacterActionState | null = null;
          if (isFree) next = 'attack_1';
          else if (curAction === 'attack_1' && phase === 'recovery') next = 'attack_2';
          else if (curAction === 'attack_2' && phase === 'recovery') next = 'attack_3';
          if (!next) {
            dbg.lastSkillResult = `被 [${curAction} ${phase}] 占用`;
            return false;
          }
          const cfg = ACTION_PHASE_CONFIGS[next]!;
          startAction(next, cfg.totalDuration, cfg.forwardMomentum);
          gameAudio.playSwordClash();
          dbg.lastSkillResult = `施放 ${next.slice(-1)} 段斩 (Cast)`;
          return true;
        }
        case 'skill1': {
          if (!trySkill(0, 'skill1', '1')) return false;
          const cfg = ACTION_PHASE_CONFIGS.skill_1!;
          startAction('skill_1', cfg.totalDuration, cfg.forwardMomentum);
          if (!p1.isGrounded) p1.vel[1] = -20;
          else {
            p1.vel[1] = 5.5;
            p1.isGrounded = false;
          }
          gameAudio.playPowerupChime();
          return true;
        }
        case 'skill2': {
          if (!trySkill(1, 'skill2', '2')) return false;
          const cfg = ACTION_PHASE_CONFIGS.skill_2!;
          startAction('skill_2', cfg.totalDuration, 0);
          vfx.setVortex(true, cfg.totalDuration);
          vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 18, 1.0, 3.0, 0.7);
          gameAudio.playArcadeLaser();
          return true;
        }
        case 'skill3': {
          if (!trySkill(2, 'skill3', '3')) return false;
          const cfg = ACTION_PHASE_CONFIGS.skill_3!;
          startAction('skill_3', cfg.totalDuration, cfg.forwardMomentum);
          vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 14, 0.5, 2.5, 0.6);
          gameAudio.playGunshotBlast();
          return true;
        }
        case 'skill4': {
          const skill = skills[3];
          dbg.lastSkillAttempted = `4: ${skill.name}`;
          if (p1.cooldowns.skill4 > 0) {
            dbg.lastSkillResult = `冷却中 (${p1.cooldowns.skill4.toFixed(1)}s)`;
            return false;
          }
          if (!canSkill) {
            dbg.lastSkillResult = `被 [${curAction} ${phase}] 占用`;
            return false;
          }
          p1.hp = Math.max(1, p1.hp - Math.round(p1.hp * 0.1));
          p1.cooldowns.skill4 = skill.cooldown;
          const cfg = ACTION_PHASE_CONFIGS.skill_4!;
          startAction('skill_4', cfg.totalDuration);
          p1.buffs = p1.buffs.filter((b) => b.type !== 'blood_rage');
          p1.buffs.push({ id: `buff_blood_${Date.now()}`, type: 'blood_rage', duration: 8.0, value: 0.35 });
          vB.set(p1.pos[0], 0, p1.pos[2]);
          vfx.pillarAt(1.1, '#ff1f1f');
          vfx.ring(vB, 2.6, '#ff2a1a', 0.6, 0.14, 0.5);
          vfx.embers(vC.set(p1.pos[0], 0.2, p1.pos[2]), 45, '#ff3b2a', 0.7, 3.5, 0.08);
          vfx.flash(vC.set(p1.pos[0], 1.4, p1.pos[2]), '#ff2a1a', 35, 0.5, 8);
          controller?.addShake(0.25);
          onBloodRageFlash?.();
          gameAudio.playLevelUpStinger();
          dbg.lastSkillResult = '成功施放 (Cast)';
          return true;
        }
        case 'ultimate': {
          if (!trySkill(4, 'ultimate', 'R')) return false;
          const cfg = ACTION_PHASE_CONFIGS.ultimate!;
          startAction('ultimate', cfg.totalDuration, cfg.forwardMomentum);
          p1.vel[1] = 13.0;
          p1.isGrounded = false;
          p1.ultSlamStarted = false;
          vfx.ring(vB.set(p1.pos[0], 0, p1.pos[2]), 2.2, '#ffb347', 0.5, 0.12, 0.4);
          vfx.dustPuff(vB, 20, 0.8, 3.5, 0.8);
          gameAudio.playVictoryFanfare();
          return true;
        }
      }
      return false;
    };

    // Single input path: the 150ms buffer (fixes actions firing twice per press)
    for (const k of ['dodge', 'skill1', 'skill2', 'skill3', 'skill4', 'ultimate', 'attack', 'jump'] as InputKeyAction[]) just[k] = false;
    const buffered = input.peekBuffer();
    if (buffered && execute(buffered)) input.consumeBuffer();

    // ---------- movement (MMO: body faces camera, WASD = forward / backpedal / strafe) ----------
    const st = p1.actionState;
    const isDodging = st === 'dodge';
    const isWhirl = st === 'skill_2';
    const isCharge = st === 'skill_3';
    const isBlocking = actions.special && p1.isGrounded && (st === 'idle' || st === 'run' || st === 'block');
    p1.isBlocking = isBlocking;
    if (isBlocking) {
      p1.actionState = 'block';
      p1.stateDuration = 0;
    } else if (st === 'block') {
      p1.actionState = 'idle';
    }
    p1.hasSuperArmor = isBlocking || isWhirl || isCharge || st.startsWith('attack_') || st === 'skill_1' || st === 'ultimate';

    let lx = 0;
    let lz = 0;
    if (actions.right) lx += 1;
    if (actions.left) lx -= 1;
    if (actions.forward) lz += 1;
    if (actions.backward) lz -= 1;
    const lLen = Math.hypot(lx, lz);
    if (lLen > 0) {
      lx /= lLen;
      lz /= lLen;
    }
    p1.localMove = [lx, lz];

    const canFreeMove = !isDodging && !isCharge && (p1.actionState === 'idle' || p1.actionState === 'run' || p1.actionState === 'jump' || p1.actionState === 'block' || isWhirl);
    if (canFreeMove) {
      if (lLen > 0) {
        // world direction from camera basis
        vA.copy(basis.forward).multiplyScalar(lz).addScaledVector(basis.right, lx).normalize();
        let mult = 1.0;
        if (lz < -0.3) mult = 0.6; // backpedal slower
        else if (Math.abs(lx) > 0.7) mult = 0.85; // strafe
        if (isWhirl) mult = 0.45;
        if (p1.actionState === 'block') mult = 0.25;
        if (isBloodRage) mult *= 1.15;
        const spd = baseSpeed * mult;
        const accel = p1.isGrounded ? 18 : 6;
        p1.vel[0] = THREE.MathUtils.damp(p1.vel[0], vA.x * spd, accel, dt);
        p1.vel[2] = THREE.MathUtils.damp(p1.vel[2], vA.z * spd, accel, dt);
        if (!isWhirl) p1.targetRotY = targeting.lockedEnemyId ? aimYaw : camYaw;
        if (p1.isGrounded && p1.actionState === 'idle') p1.actionState = 'run';
      } else {
        p1.vel[0] = THREE.MathUtils.damp(p1.vel[0], 0, 14, dt);
        p1.vel[2] = THREE.MathUtils.damp(p1.vel[2], 0, 14, dt);
        if (p1.isGrounded && p1.actionState === 'run') p1.actionState = 'idle';
      }
    } else if (!isDodging && !isCharge && p1.isGrounded) {
      // attacks: lunge momentum decays
      p1.vel[0] = THREE.MathUtils.damp(p1.vel[0], 0, 7, dt);
      p1.vel[2] = THREE.MathUtils.damp(p1.vel[2], 0, 7, dt);
    }

    // ---------- combat ----------
    const dmgMult = isBloodRage ? 1.35 : 1.0;
    const fwdX = -Math.sin(p1.rotY);
    const fwdZ = -Math.cos(p1.rotY);
    const dummyChest = vD.set(dummy.pos[0], dummy.pos[1] + 1.15, dummy.pos[2]);
    const hitDir = vC.set(dummy.pos[0] - p1.pos[0], 0.3, dummy.pos[2] - p1.pos[2]).normalize();

    const applyHit = (damage: number, opts: { heavy?: boolean; crit?: boolean; launch?: number; knock?: number; state?: CharacterActionState; dur?: number; shake?: number }) => {
      damage = Math.round(damage * dmgMult);
      dummy.hp = Math.max(0, dummy.hp - damage);
      p1.totalDamageDealt += damage;
      p1.comboCount += 1;
      p1.comboDamage += damage;
      p1.highestCombo = Math.max(p1.highestCombo, p1.comboCount);
      p1.comboResetTimer = 2.5;
      if (isBloodRage) p1.hp = Math.min(p1.maxHp, p1.hp + Math.round(damage * 0.15));
      const knock = opts.knock ?? 4;
      dummy.vel[0] = hitDir.x * knock;
      dummy.vel[2] = hitDir.z * knock;
      if (opts.launch) {
        dummy.vel[1] = opts.launch;
        dummy.isGrounded = false;
      }
      dummy.actionState = opts.state ?? 'hitstun';
      dummy.stateTimer = 0;
      dummy.stateDuration = opts.dur ?? 0.35;
      dummy.whiteFlashTimer = opts.heavy ? 0.1 : 0.06;
      dummy.rotY = Math.atan2(-(p1.pos[0] - dummy.pos[0]), -(p1.pos[2] - dummy.pos[2]));
      dummy.targetRotY = dummy.rotY;
      const stop = opts.heavy ? 0.09 : 0.05;
      p1.hitStopTimer = stop;
      dummy.hitStopTimer = stop;
      vfx.hitImpact(vB.copy(dummyChest).addScaledVector(hitDir, -0.35), hitDir, !!opts.heavy, isBloodRage ? '#ff1f2f' : '#ff4a1c');
      vfx.damageNumber(vB.set(dummy.pos[0], dummy.pos[1] + 2.05, dummy.pos[2]), damage, !!opts.crit);
      if (opts.shake) controller?.addShake(opts.shake);
      if (opts.crit) gameAudio.playChiptuneExplosion();
      else gameAudio.playMeleePunch();
    };

    const distToDummy = Math.hypot(dummy.pos[0] - p1.pos[0], dummy.pos[2] - p1.pos[2]);
    const inFront = (fwdX * (dummy.pos[0] - p1.pos[0]) + fwdZ * (dummy.pos[2] - p1.pos[2])) / Math.max(0.001, distToDummy) > 0.2;
    const cfgNow = ACTION_PHASE_CONFIGS[p1.actionState];
    const inActive = !!cfgNow && p1.stateTimer >= cfgNow.startup && p1.stateTimer <= cfgNow.startup + cfgNow.active;

    // Basic attacks
    if (p1.actionState.startsWith('attack_') && inActive && !p1.hasHitCurrentMove && distToDummy < 2.6 && inFront) {
      p1.hasHitCurrentMove = true;
      if (p1.actionState === 'attack_1') applyHit(60, { knock: 3.5 });
      else if (p1.actionState === 'attack_2') applyHit(85, { knock: 4.5 });
      else applyHit(150, { heavy: true, crit: true, knock: 9, state: 'knockdown', dur: 0.9, launch: 4, shake: 0.35 });
    }

    // 裂地斩: slam on impact frame
    if (p1.actionState === 'skill_1' && inActive && !p1.hasHitCurrentMove) {
      p1.hasHitCurrentMove = true;
      const ix = p1.pos[0] + fwdX * 1.5;
      const iz = p1.pos[2] + fwdZ * 1.5;
      vfx.groundSlam(vB.set(ix, 0, iz), 1.0, isBloodRage ? '#ff1f2f' : '#ff4a1c');
      controller?.addShake(0.6);
      gameAudio.playGeneralExplosion();
      if (Math.hypot(dummy.pos[0] - ix, dummy.pos[2] - iz) < 3.4) {
        applyHit(210, { heavy: true, crit: true, launch: 9.5, knock: 3, state: 'launched', dur: 0.9 });
      }
    }

    // 旋风刃: multi-hit
    if (p1.actionState === 'skill_2') {
      if (Math.random() < 0.2) vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 1, 1.0, 2.5, 0.45);
      if (Math.random() < 0.5) vfx.sparkBurst(vB.set(p1.pos[0], 1.0, p1.pos[2]), 2, '#ff6a2a', 6, 0.07);
      const now = performance.now();
      if (now - p1.lastHitTick > 200 && distToDummy < 2.9) {
        p1.lastHitTick = now;
        applyHit(45, { knock: 1.5, dur: 0.25 });
      }
    }

    // 蛮牛冲: dash
    if (p1.actionState === 'skill_3') {
      const active = p1.stateTimer < 0.45;
      if (active) {
        p1.vel[0] = fwdX * 20;
        p1.vel[2] = fwdZ * 20;
        vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 2, 0.3, 1.5, 0.55);
        vfx.sparkBurst(vB.set(p1.pos[0] - fwdX * 0.4, 1.0 + (Math.random() - 0.5), p1.pos[2] - fwdZ * 0.4), 2, '#ffb07a', 3, 0.05, vC.set(-fwdX, 0, -fwdZ), 0.2);
      } else {
        p1.vel[0] = THREE.MathUtils.damp(p1.vel[0], 0, 9, dt);
        p1.vel[2] = THREE.MathUtils.damp(p1.vel[2], 0, 9, dt);
      }
      if (active && distToDummy < 1.8 && !p1.hasHitCurrentMove) {
        p1.hasHitCurrentMove = true;
        applyHit(185, { heavy: true, crit: true, knock: 15, launch: 7, state: 'knockdown', dur: 1.0, shake: 0.55 });
        vfx.ring(vB.set(dummy.pos[0], 0, dummy.pos[2]), 2.2, '#ff8a3a', 0.4, 0.14, 0.4);
        p1.vel[0] *= 0.2;
        p1.vel[2] *= 0.2;
      }
    }

    // 天崩: rise, somersault, dive, impact
    if (p1.actionState === 'ultimate') {
      if (!p1.ultSlamStarted && p1.stateTimer > 0.55) {
        p1.ultSlamStarted = true;
        p1.vel[1] = -34;
        p1.vel[0] = fwdX * 6;
        p1.vel[2] = fwdZ * 6;
      }
      if (!p1.isGrounded) {
        vfx.embers(vB.set(p1.pos[0], p1.pos[1] + 0.6, p1.pos[2]), p1.ultSlamStarted ? 6 : 2, '#ff7a2a', 0.35, -1, 0.1);
      }
      if (p1.ultSlamStarted && p1.isGrounded && !p1.hasHitCurrentMove) {
        p1.hasHitCurrentMove = true;
        slowMoTimerRef.current = 0.3;
        controller?.addShake(1.0);
        vfx.ultimateImpact(vB.set(p1.pos[0] + fwdX * 0.8, 0, p1.pos[2] + fwdZ * 0.8));
        gameAudio.playGeneralExplosion();
        gameAudio.playChiptuneExplosion();
        if (distToDummy < 7) applyHit(520, { heavy: true, crit: true, launch: 15, knock: 10, state: 'knockdown', dur: 1.2 });
        p1.vel[0] = 0;
        p1.vel[2] = 0;
      }
    }

    // Blood rage aura
    if (isBloodRage) {
      auraTimerRef.current += dt;
      if (auraTimerRef.current > 0.05) {
        auraTimerRef.current = 0;
        vfx.embers(vB.set(p1.pos[0], p1.pos[1] + 0.2, p1.pos[2]), 2, '#ff2a1a', 0.45, 2.2, 0.06);
      }
    }

    // ---------- physics ----------
    for (const c of [p1, dummy]) {
      const cdt = c.hitStopTimer > 0 ? dt * 0.08 : dt;
      c.stateTimer += cdt;
      if (c.stateDuration > 0 && c.stateTimer >= c.stateDuration) {
        if (c.actionState !== 'idle' && c.actionState !== 'run' && c.actionState !== 'jump' && c.actionState !== 'block') {
          c.actionState = c.isGrounded ? 'idle' : 'jump';
          c.stateDuration = 0;
        }
      }
      if (!c.isGrounded) {
        c.vel[1] -= gravity * cdt;
        c.pos[1] += c.vel[1] * cdt;
        if (c.pos[1] <= 0) {
          c.pos[1] = 0;
          const impactSpeed = -c.vel[1];
          c.vel[1] = 0;
          c.isGrounded = true;
          if (c.actionState === 'jump') c.actionState = 'idle';
          if (c.actionState === 'launched') {
            c.actionState = 'knockdown';
            c.stateTimer = 0;
            c.stateDuration = 0.8;
          }
          if (impactSpeed > 6) vfx.dustPuff(vB.set(c.pos[0], 0, c.pos[2]), Math.min(14, Math.round(impactSpeed)), 0.5, 2.0, 0.6);
        }
      }
      c.pos[0] += c.vel[0] * cdt;
      c.pos[2] += c.vel[2] * cdt;
      if (c !== p1 || c.actionState === 'dodge') {
        const k = Math.exp(-(c === p1 ? 4 : 5) * cdt);
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
    }

    // simple body separation so the player can't walk through the dummy
    {
      const dx = p1.pos[0] - dummy.pos[0];
      const dz = p1.pos[2] - dummy.pos[2];
      const d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 0.0001 && p1.actionState !== 'dodge') {
        const push = (0.8 - d) / d;
        p1.pos[0] += dx * push;
        p1.pos[2] += dz * push;
      }
    }

    // footstep dust while running
    if (p1.isGrounded && p1.actionState === 'run' && Math.hypot(p1.vel[0], p1.vel[2]) > 3) {
      footTimerRef.current += dt;
      if (footTimerRef.current > 0.28) {
        footTimerRef.current = 0;
        vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 2, 0.15, 0.6, 0.35, '#7d7166');
      }
    }
    if (!wasGroundedRef.current && p1.isGrounded && p1.actionState !== 'ultimate') {
      vfx.dustPuff(vB.set(p1.pos[0], 0, p1.pos[2]), 6, 0.3, 1.4, 0.45);
    }
    wasGroundedRef.current = p1.isGrounded;

    if (dummy.hp <= 0) {
      dummy.hp = dummy.maxHp;
      gameAudio.playPowerupChime();
    }

    // ---------- apply transforms ----------
    if (playerGroupRef.current) {
      playerGroupRef.current.position.set(p1.pos[0], p1.pos[1], p1.pos[2]);
      playerGroupRef.current.rotation.y = p1.rotY;
      playerGroupRef.current.updateMatrixWorld(true);
    }
    if (dummyGroupRef.current) {
      dummyGroupRef.current.position.set(dummy.pos[0], dummy.pos[1], dummy.pos[2]);
      dummyGroupRef.current.rotation.y = dummy.rotY;
    }

    playerVec.set(p1.pos[0], p1.pos[1], p1.pos[2]);
    controller?.update(playerVec, rawDt);

    // key light + shadow camera follow the player; rim light sits opposite the camera
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

    // ---------- weapon trails ----------
    const s = socketsRef.current;
    const swinging =
      ATTACK_STATES.has(p1.actionState) &&
      (p1.actionState === 'skill_2' ||
        p1.actionState === 'skill_3' ||
        (p1.actionState === 'ultimate' ? !!p1.ultSlamStarted && p1.stateTimer < 1.0 : (() => {
          const c = ACTION_PHASE_CONFIGS[p1.actionState];
          return !!c && p1.stateTimer >= c.startup * 0.4 && p1.stateTimer <= c.startup + c.active + 0.05;
        })()));
    trails.right.emitting = swinging;
    trails.left.emitting = swinging && p1.actionState !== 'attack_1';
    const trailColor = isBloodRage ? '#ff1030' : '#ff4a1c';
    trails.right.setColor(trailColor, 2.2);
    trails.left.setColor(trailColor, 2.2);
    const now = performance.now() / 1000;
    if (s.rightBase && s.rightTip) trails.right.update(rawDt, s.rightBase.getWorldPosition(vA), s.rightTip.getWorldPosition(vB), now);
    else trails.right.update(rawDt, null, null, now);
    if (s.leftBase && s.leftTip) trails.left.update(rawDt, s.leftBase.getWorldPosition(vA), s.leftTip.getWorldPosition(vB), now);
    else trails.left.update(rawDt, null, null, now);

    vfx.followPlayer(playerVec);
    vfx.update(dt);

    // ---------- HUD projections ----------
    headProj.set(dummy.pos[0], dummy.pos[1] + 2.25, dummy.pos[2]).project(camera);
    const visible = headProj.z < 1 && Math.abs(headProj.x) < 1.1 && Math.abs(headProj.y) < 1.1;
    onDummyScreenPosUpdate?.({
      visible,
      screenX: (headProj.x * 0.5 + 0.5) * size.width,
      screenY: (-headProj.y * 0.5 + 0.5) * size.height,
    });

    const nowMs = performance.now();
    if (nowMs - lastVfxReportRef.current > 150) {
      lastVfxReportRef.current = nowMs;
      onVfxCountChange?.(vfx.activeCount);
      onDebugUpdate?.({
        playerPos: [p1.pos[0], p1.pos[1], p1.pos[2]],
        cameraPos: [camera.position.x, camera.position.y, camera.position.z],
        camYaw: controller ? controller.yaw : 0,
        camPitch: controller ? controller.pitch : 0.35,
        camDist: controller ? controller.distance : 5,
      });
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
          socketsRef={socketsRef}
          showBoneAxes={showBoneAxes}
          onAnimationDebug={onAnimationDebug}
          onLoadProgress={onLoadProgress}
        />
      </group>

      <group ref={dummyGroupRef} position={[0, 0, -6]}>
        <CharacterRig3D combatantRef={dummyRefState} isPlayer={false} />
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
