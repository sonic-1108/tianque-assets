import * as THREE from 'three';

export type CharacterClassId =
  | 'Berserker'
  | 'Sniper'
  | 'BuddhistMage'
  | 'LightHealer'
  | 'HeavyHealer';

export type CharacterActionState =
  | 'idle'
  | 'run'
  | 'jump'
  | 'dodge'
  | 'block'
  | 'attack_1'
  | 'attack_2'
  | 'attack_3'
  | 'skill_1'
  | 'skill_2'
  | 'skill_3'
  | 'skill_4'
  | 'ultimate'
  | 'hitstun'
  | 'launched'
  | 'knockdown'
  | 'getup'
  | 'dead';

export interface SkillDefinition {
  id: string;
  name: string;
  key: string;
  description: string;
  mpCost: number;
  hpCostPct?: number;
  cooldown: number; // in seconds
  icon: string;
  isSuper?: boolean;
}

export interface ClassConfig {
  id: CharacterClassId;
  name: string;
  defaultCharacter: string;
  role: string;
  roleType: 'tank' | 'dps' | 'mage' | 'healer';
  description: string;
  hp: number;
  mp: number;
  speedRatio: number;
  attackSpeedRatio: number;
  staggerPower: number;
  passiveName: string;
  passiveDesc: string;
  skills: SkillDefinition[];
}

export interface DamageNumber {
  id: string;
  text: string;
  x: number;
  y: number;
  z: number;
  vy: number;
  color: string;
  scale: number;
  opacity: number;
  life: number;
  maxLife: number;
  isCrit?: boolean;
}

export interface SparkParticle {
  id: string;
  pos: [number, number, number];
  vel: [number, number, number];
  color: string;
  size: number;
  life: number;
  maxLife: number;
  type?:
    | 'spark'
    | 'smoke'
    | 'ring'
    | 'blood'
    | 'gold'
    | 'feather'
    | 'dust'
    | 'debris'
    | 'crater'
    | 'vortex'
    | 'cone'
    | 'afterimage'
    | 'slash_arc'
    | 'magma_pillar'
    | 'bull_horns'
    | 'blood_pillar'
    | 'meteor_fire'
    | 'shockwave_dome'
    | 'sword_beam';
  extraRot?: [number, number, number];
  scaleMult?: number;
}

export interface ProjectileEntity {
  id: string;
  ownerId: string;
  type: 'bullet' | 'explosive' | 'orb' | 'glyph' | 'feather' | 'beam';
  pos: [number, number, number];
  vel: [number, number, number];
  radius: number;
  damage: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface CombatantBuff {
  id: string;
  type: 'blood_rage' | 'speed_boost' | 'shield' | 'zen' | 'hot';
  duration: number;
  value: number;
}

export interface CombatantState {
  id: string;
  isPlayer: boolean;
  isDummy?: boolean;
  team: 'player_team' | 'enemy_team' | 'neutral';
  name: string;
  characterName: string;
  classId: CharacterClassId;
  pos: [number, number, number];
  vel: [number, number, number];
  rotY: number;
  targetRotY: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  actionState: CharacterActionState;
  stateTimer: number;
  stateDuration: number;
  hasHitCurrentMove: boolean;
  multiHitCounter: number;
  lastHitTick: number;
  comboCount: number;
  comboDamage: number;
  comboResetTimer: number;
  isGrounded: boolean;
  isDodging: boolean;
  dodgeCooldownTimer: number;
  dodgeIframeTimer: number;
  isBlocking: boolean;
  hasSuperArmor: boolean;
  hitStopTimer: number;
  whiteFlashTimer: number;
  cooldowns: Record<string, number>; // Ensure strictly initialized numbers
  /** Movement relative to facing: [x = right, z = forward], each -1..1. Drives strafe / backpedal animation. */
  localMove?: [number, number];
  /** Ultimate: whether the downward slam has started */
  ultSlamStarted?: boolean;
  /** air hits taken since last landing (juggle decay) */
  juggleCount?: number;
  /** game time when the current block started (perfect-block window) */
  blockStart?: number;
  /** seconds left of the +50% counter-attack bonus after a perfect block / dodge */
  counterTimer?: number;
  /** whether the current dodge already triggered a perfect dodge */
  perfectDodgeUsed?: boolean;
  buffs: CombatantBuff[];
  totalDamageDealt: number;
  totalHealingDone: number;
  highestCombo: number;
  actionsPerformed: number;
  kills: number;
}

export type GameMode = 'TRAINING' | 'TEAM_3V3';
export type GameStatus = 'START' | 'PLAYING' | 'PAUSED' | 'ROUND_OVER' | 'MATCH_OVER' | 'VICTORY' | 'GAME_OVER';

export interface TargetingState {
  lockedEnemyId: string | null;
  friendlyTargetId: string | null;
}

export interface GameState {
  status: GameStatus;
  mode: GameMode;
  score: number;
  level: number;
  playerClass: CharacterClassId;
  round: number;
  maxRounds: number;
  roundTimer: number;
  playerTeamWins: number;
  enemyTeamWins: number;
  activeVfxCount: number;
  isControlsOverlayOpen: boolean;
  isDebugPanelOpen: boolean;
  isPointerLocked: boolean;
  [key: string]: any;
}
