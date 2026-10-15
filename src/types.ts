import * as THREE from 'three';

export type CharacterClassId =
  | 'Berserker'
  | 'Sniper'
  | 'BuddhistMage'
  | 'LightHealer'
  | 'HeavyHealer'
  | 'Ranger'
  | 'Shadowblade'
  | 'Emperor'
  | 'Guard';

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
  | 'dead'
  | 'buried';

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
  /** team fights: which side (0 or 1). Friendly fire is on, this only decides who wins and who the AI goes after */
  side?: number;
  /** shown over the fighter's head in team fights */
  tag?: string;
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
  /** mini-combo flags */
  airSlam?: boolean; // 1 pressed in the air: 钉地斩
  airSlash?: boolean; // left click in the air: 下劈
  dodgeSlash?: boolean; // left click out of a dodge: 回身斩
  dodgeEndAt?: number;
  /** 梵音 (monk) runtime */
  bellTimer?: number; // 金钟罩 seconds left
  silenceTimer?: number; // 封印: can't cast skills
  /** 影刃 runtime */
  stealthT?: number; // 影遁: seconds of invisibility left
  critNext?: number; // 瞬影 / 破隐: seconds the next blow is a critical
  rewind?: number[][]; // 回溯: [time, x, y, z, hp] samples of the last few seconds
  shadowHits?: number; // 千影杀: strikes landed so far
  ultTarget?: boolean; // 千影杀: a target was in reach when it began
  burrowT?: number; // 遁地: seconds left under the ground
  ballista?: number; // 怒海战船: manning this mounted crossbow
  atHelm?: number; // 怒海战船: steering this ship (0 / 1) at her helm
  swarmSafe?: number; // 大漠玉门关: this swarm (its start time) already had you; it won't again
  wallBlock?: number; // walked into a wall just now (an AI jumps it)
  parkour?: number; // 长安: an AI on its way up a wall with a double jump
  wading?: boolean; // 青冥古林: in or at the edge of the river (no body shadow: it would ghost on the river bed)
  pull?: { x: number; z: number; t: number }; // 锁链钩: being dragged toward (x, z)
  mantraShots?: number; // 六字真言 syllables released so far
  zenField?: { x: number; z: number; t: number }; // 禅定结界 centre and seconds left
  palmsThrown?: number; // 万佛朝宗 palms already called down
  mantraDone?: boolean;
  /** 暗器 (Ranger) runtime */
  rootTimer?: number; // pinned in place by 定身镖
  poisonStacks?: number;
  poisonDps?: number; // 淬毒: damage per second, set by the last poisoned hit
  poisonTimer?: number;
  poisonTick?: number;
  poisonBuff?: number; // 淬毒 active seconds left
  dartHits?: number; // passive counter: every 5 hits -> piercing dart
  pierceNext?: boolean;
  volleyShots?: number; // darts already thrown in the current action
  backSlash?: boolean;
  doubleJumped?: boolean;
  celebrate?: boolean;
  stamina?: number; // 体力: dodges, double jumps and climbing spend it
  climbing?: boolean; // 雪岭冰峰: hauling up a steep slope / 青冥古林: up a tree
  treeClimb?: number; // 青冥古林: index of the pillar (lookout tree) being climbed
  climbT?: number; // 梯云纵: seconds into the run up the tree
  climbA0?: number; // angle round the trunk where it started
  climbY0?: number; // height it started from
  climbSide?: number; // which way it spirals
  climbRate?: number; // ladder: vertical speed (drives the climbing animation)
  climbMode?: 'run' | 'ladder'; // 梯云纵 up the bark, or hand over hand up the rope ladder
  nearLadder?: boolean; // standing at the foot of a ladder (HUD hint)
  grip?: number; // 0..1 effective friction underfoot (青冥古林 weather)
  slip?: number; // 0..1 loss of balance; at 1 you fall
  devoured?: number; // 大漠玉门关 飞虫沙暴: 0 untouched, 0..1 being eaten (dissolving from the head down), 1 gone
  swarmExpo?: number; // seconds out in the open while the swarm is here
  scope?: number; // 暗器 穿云狙: seconds the scope has been up (0 = down)
  twister?: number; // 大漠玉门关 龙卷风: seconds being carried (0 = not)
  twisterA?: number; // angle round the funnel where it took you
  twisterCd?: number; // just thrown out: can't be taken again yet
  twisterFall?: boolean; // in the air after being flung: the landing hurts
  sandExpo?: number; // 大漠玉门关: seconds caught out in a thick sandstorm
  mantraTgt?: number; // 六字真言: who the words are hunting (-1 nobody in reach)
  drinkWell?: number; // 大漠玉门关: drawing water at well n (1-based), 0 not
  drinkT?: number; // seconds into it
  beaconHold?: number; // 大漠玉门关: seconds of holding F at the beacon
  candle?: 0 | 1 | 2; // 青冥古林: 0 none, 1 carrying an unlit candle, 2 lit
  meditateT?: number; // 青冥寺: seconds left of sitting in meditation on a prayer cushion
  meditateHeal?: number; // HP still to be restored by this sitting
  restDay?: number; // the day (weather cycle) this fighter last meditated: once per night
  shade?: boolean; // has the candle-shade (rain can't put the candle out)
  intPrev?: boolean; // F was held last frame (pickups fire on the press)
  interactHint?: string; // what F would do right here (HUD)
  reviveT?: number; // team fights: seconds a teammate has spent helping this downed fighter up
  revived?: number; // times this fighter was helped up this round (once per round)
  reviveHint?: string; // team fights: F prompt to help a downed teammate up (HUD)
  swimming?: boolean; // 青冥古林: floating in deep water
  ledgeBlocked?: number; // walking was stopped at a sheer drop (AI uses it to steer)
  sliding?: boolean; // out of stamina on a steep slope
  maxStamina?: number;
  staminaDelay?: number;
  stunLoad?: number; // builds up while being comboed; at the cap the defender gets 保护
  protectTimer?: number; // 保护: cannot be stunned or launched // won the round: victory pose // 暗器: second jump used
  doubleJumpTimer?: number; // >0 while the double-jump somersault plays // 暗器 right-click: backhand knife slash + backstep
  rainCenter?: [number, number]; // 暴雨梨花 target area
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

/** one fighter in a match: who controls it, what class, which side */
export interface FighterSeat {
  cls: CharacterClassId;
  side: number;
  /** local: this browser's player; ai: run by the host's AI; remote: a guest's controls (by connection id) */
  ctl: 'local' | 'ai' | 'remote';
  remote?: string;
  name: string;
}
