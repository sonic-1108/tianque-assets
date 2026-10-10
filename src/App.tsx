import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { usePlayground, usePlaygroundGameLifecycle } from './utils/usePlayground';
import { MenuOverlay, gameAudio, useIsMobile } from './utils/helper';
import { BackgroundMusic } from './utils/BackgroundMusic';
import { useGameInput } from './input';
import { Game, RoundEvent } from './Game';
import { MAPS, MAP_ORDER, MapId } from './maps';
import type { CharacterClassId } from './types';
import {
  GameState,
  CombatantState,
  TargetingState,
} from './types';
import { CLASS_CONFIGS } from './components/CombatData';
import { AnimationDebugInfo, ModelLoadProgress } from './components/CharacterRig3D';
import {
  RotateCw,
  Volume2,
  VolumeX,
  Info,
  Shield,
  Zap,
  Sword,
  Sparkles,
  Activity,
  MousePointer,
  Crosshair,
  Loader2,
  AlertTriangle,
  RefreshCw,
  Film,
} from 'lucide-react';

const STATIC_CANVAS_CAMERA = { fov: 55, near: 0.1, far: 200 };

const SKILLS = CLASS_CONFIGS.Berserker.skills;
const skillMeta = (i: number) => [`MP ${SKILLS[i].mpCost}`, `冷却 ${SKILLS[i].cooldown}s`];
type HotbarEntry = {
  id: string; key: string; name: string; icon: string; short: string; desc: string; tip?: string;
  meta: string[]; cdKey?: string; basic?: boolean; super?: boolean;
};
const BERSERKER_HOTBAR: HotbarEntry[] = [
  { id: 'attack', key: '左键', name: '斩击', icon: '⚔️', short: '三段连斩', basic: true, meta: ['命中回蓝', '可连按'],
    desc: '双刀三段连斩：第一段单刀横斩，第二段双刀交错，第三段重劈把对手击倒。出招会自动吸附前方4米内的对手。对手被击飞在空中时，每一下普攻都会把他再挑高一点，最多空中追打4下，伤害逐次递减。',
    tip: '跳起按左键是「下劈」；翻滚刚结束时按左键是「回身斩」。经典连招：斩击×2 → 1 裂地斩 → 空中追打 ×3。' },
  { id: 'block', key: '右键', name: '格挡', icon: '🛡️', short: '减伤六成', basic: true, meta: ['按住生效', '移动变慢'],
    desc: '按住右键交叉双刀格挡。正面受到的伤害减少60%，而且不会被打断或击飞。背后和天崩挡不住。在被打中前0.2秒内按下格挡会触发「完美格挡」：完全免伤，对手被弹开硬直，你的下一击伤害+50%。',
    tip: '不要一直按着，看准对手出刀的瞬间再按，才能打出完美格挡。' },
  { id: 'earth_cleave', key: '1', name: '裂地斩', icon: '💥', short: '跳劈击飞', cdKey: 'skill1', meta: skillMeta(0),
    desc: SKILLS[0].description + ' 跳起来再按 1 会变成「钉地斩」：向下砸地，把对手钉进地里0.5秒后震飞。',
    tip: '空格 → 1 钉地斩 → 对手弹起 → 左键 ×3 空中追打。' },
  { id: 'whirlwind_blade', key: '2', name: '旋风刃', icon: '🌪️', short: '旋转多段', cdKey: 'skill2', meta: skillMeta(1),
    desc: SKILLS[1].description, tip: '贴身时用伤害最高；对手格挡时也能持续压制。' },
  { id: 'bull_charge', key: '3', name: '蛮牛冲', icon: '🐂', short: '冲撞击倒', cdKey: 'skill3', meta: skillMeta(2),
    desc: SKILLS[2].description, tip: '对手放技能前摇时冲过去，可以直接撞断他的招。' },
  { id: 'blood_rage', key: '4', name: '血怒', icon: '🩸', short: '增伤吸血', cdKey: 'skill4', meta: ['生命 -10%', `冷却 ${SKILLS[3].cooldown}s`],
    desc: SKILLS[3].description, tip: '先开血怒再接连招，吸血能把扣掉的血打回来。' },
  { id: 'heaven_collapse', key: 'R', name: '天崩', icon: '🌋', short: '空翻砸地', cdKey: 'ultimate', super: true, meta: skillMeta(4),
    desc: SKILLS[4].description, tip: '对手倒地起身时放最稳；看到对手跳起来要马上 Shift 翻滚。' },
];

const RS = CLASS_CONFIGS.Ranger.skills;
const rMeta = (i: number) => [`MP ${RS[i].mpCost}`, `冷却 ${RS[i].cooldown}s`];
const RANGER_HOTBAR: HotbarEntry[] = [
  { id: 'r_attack', key: '左键', name: '飞镖', icon: '🗡️', short: '远程连射', basic: true, meta: ['射程约20米', '可边走边丢'],
    desc: '朝准星方向甩出飞镖，对手在前方时会自动瞄准胸口。第一、二段各一枚，第三段一次甩出三枚扇形镖。丢镖时可以慢速移动，空中也能丢。被动「袖里乾坤」：飞镖每命中5次，下一枚变成金色穿透镖，伤害翻倍并且无视格挡。',
    tip: '保持 6 到 9 米的距离绕圈丢镖，对手冲过来就右键或 3 拉开。沈惊鸿可以二段跳：空中再按一次空格，空翻再跳一次，空中也能丢镖。' },
  { id: 'r_special', key: '右键', name: '撩刀后撤', icon: '🌙', short: '近身反手一刀', basic: true, cdKey: 'special', meta: ['冷却 2.5s', '不耗蓝'],
    desc: '暗器没有格挡。右键用手里的短刀反手撩一刀（55伤害，把人推开），同时向后弹开一大步，用来摆脱贴身的对手。',
    tip: '被狂刃贴脸时先右键拉开，再接飞镖。' },
  { id: 'boomerang', key: '1', name: RS[0].name, icon: RS[0].icon, short: '去回两段', cdKey: 'skill1', meta: rMeta(0), desc: RS[0].description,
    tip: '扔出去以后往侧面走，回程会从另一个角度再打一次。' },
  { id: 'pin_dart', key: '2', name: RS[1].name, icon: RS[1].icon, short: '定住1.5秒', cdKey: 'skill2', meta: rMeta(1), desc: RS[1].description,
    tip: '定住以后对手跑不掉也翻不了滚，正好接 1 和三连镖。' },
  { id: 'swallow_flip', key: '3', name: RS[2].name, icon: RS[2].icon, short: '后空翻七镖', cdKey: 'skill3', meta: rMeta(2), desc: RS[2].description,
    tip: '看到对手冲过来或起手大招时用，翻身那一下是无敌的。' },
  { id: 'poison', key: '4', name: RS[3].name, icon: RS[3].icon, short: '飞镖带毒', cdKey: 'skill4', meta: rMeta(3), desc: RS[3].description,
    tip: '开淬毒后3秒内尽量打出最重的一下（三连镖或金色穿透镖），毒伤按最后一次命中算。' },
  { id: 'rain_of_darts', key: 'R', name: RS[4].name, icon: RS[4].icon, short: '悬空洒镖', cdKey: 'ultimate', super: true, meta: rMeta(4), desc: RS[4].description,
    tip: '先用 2 定身镖钉住对手，再开暴雨梨花，几乎全中。' },
];
const HOTBAR_BY_CLASS: Partial<Record<CharacterClassId, HotbarEntry[]>> = { Berserker: BERSERKER_HOTBAR, Ranger: RANGER_HOTBAR };
const PLAYABLE: CharacterClassId[] = ['Berserker', 'Ranger'];

interface CanvasLoadingScreenProps {
  progress: number;
  error: string | null;
  onRetry: () => void;
}

function CanvasLoadingScreen({ progress, error, onRetry }: CanvasLoadingScreenProps) {
  if (error) {
    return (
      <div className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center z-50 p-6 text-center backdrop-blur-md">
        <div className="max-w-md w-full bg-zinc-900 border-2 border-red-500/70 rounded-3xl p-6 shadow-2xl flex flex-col items-center gap-3">
          <AlertTriangle className="w-12 h-12 text-red-500 animate-bounce" />
          <h3 className="text-xl font-black text-red-400">武将模型加载失败</h3>
          <p className="text-xs text-zinc-400 font-mono leading-relaxed bg-black/60 p-3 rounded-xl border border-zinc-800 w-full text-left overflow-x-auto">
            {error}
          </p>
          <button
            onClick={onRetry}
            className="mt-2 w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 shadow-lg transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            重新加载模型 (Retry)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center z-50 text-amber-400 gap-4 p-6">
      <Loader2 className="w-12 h-12 animate-spin text-amber-500" />
      <div className="flex flex-col items-center gap-1">
        <span className="text-lg font-black tracking-widest text-amber-300">
          正在装载《天阙》狂刃·霍岩 (berserker.glb)
        </span>
        <span className="text-xs text-zinc-400 font-mono">
          解析骨骼权重、去除根骨骼位移并绑定动作切片...
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-64 max-w-xs h-3 bg-zinc-900 rounded-full border border-amber-500/50 overflow-hidden p-0.5 shadow-inner">
        <div
          className="h-full bg-gradient-to-r from-red-600 via-amber-500 to-yellow-400 rounded-full transition-all duration-200"
          style={{ width: `${Math.max(8, progress)}%` }}
        />
      </div>
      <span className="text-xs font-mono font-bold text-amber-400">{progress}%</span>
    </div>
  );
}

export default function App() {
  const { sdk } = usePlayground();
  const isMobile = useIsMobile();
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Audio mute states
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const [isSfxMuted, setIsSfxMuted] = useState(false);

  // Overlay states
  const [isGameMenuOpen, setIsGameMenuOpen] = useState(false);
  const [isHowToPlayOpen, setIsHowToPlayOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  const [skillCard, setSkillCard] = useState<string | null>(null);
  const [mapId, setMapId] = useState<MapId>('temple');
  const [isMapSelectOpen, setIsMapSelectOpen] = useState(true);
  const [playerClass, setPlayerClass] = useState<CharacterClassId>('Berserker');
  const [enemyClass, setEnemyClass] = useState<CharacterClassId>('Berserker');
  const HOTBAR_INFO = HOTBAR_BY_CLASS[playerClass] || BERSERKER_HOTBAR;
  const enemyShadow = `${CLASS_CONFIGS[enemyClass].defaultCharacter}影`;
  const [toast, setToast] = useState<{ n: number; text: string }>({ n: 0, text: '' });

  // Versus mode: 霍岩影 fights back (toggle in pause menu or press P)
  const aiEnabledRef = useRef(true);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [score, setScore] = useState({ player: 0, enemy: 0 });
  const [roundBanner, setRoundBanner] = useState<null | 'player' | 'enemy'>(null);
  const [hurtFlash, setHurtFlash] = useState(0);
  const [screenFlash, setScreenFlash] = useState<{ n: number; color: string }>({ n: 0, color: '' });
  const toggleAI = useCallback(() => {
    aiEnabledRef.current = !aiEnabledRef.current;
    setAiEnabled(aiEnabledRef.current);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyP') toggleAI();
      if (e.code === 'KeyM') {
        if (document.pointerLockElement) document.exitPointerLock?.();
        setIsMapSelectOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAI]);
  const handleRoundEvent = useCallback((e: RoundEvent) => {
    if (e.type === 'ko') {
      setRoundBanner(e.winner);
      setScore((s) => ({ ...s, [e.winner]: s[e.winner] + 1 }));
    } else if (e.type === 'reset') {
      setRoundBanner(null);
    } else if (e.type === 'playerHit') {
      setHurtFlash((n) => n + 1);
    } else if (e.type === 'toast') {
      setToast((t) => ({ n: t.n + 1, text: e.text }));
    } else if (e.type === 'screenFlash') {
      setScreenFlash((f) => ({ n: f.n + 1, color: e.color }));
    }
  }, []);

  // Blood Rage Screen Edge Flash
  const [bloodRageFlash, setBloodRageFlash] = useState(false);

  // Model Loading and Progress Tracking
  const [modelProgress, setModelProgress] = useState<ModelLoadProgress>({
    loaded: 0,
    total: 100,
    progress: 0,
    isLoading: true,
    error: null,
  });

  // Animation Debug Metadata (Requirement 2)
  const [animDebugInfo, setAnimDebugInfo] = useState<AnimationDebugInfo>({
    allClips: [],
    mappedStates: {},
    unmappedStates: [],
    currentClip: 'Loading...',
  });

  // Live Debug and VFX states
  const [vfxCount, setVfxCount] = useState(0);
  const [debugData, setDebugData] = useState({
    playerPos: [0, 0, 0] as [number, number, number],
    cameraPos: [0, 3.5, 6] as [number, number, number],
    camYaw: 0,
    camPitch: 0.35,
    camDist: 6,
  });

  // Dummy 2D Screen Projection state
  const [dummyScreenPos, setDummyScreenPos] = useState({
    visible: false,
    screenX: 0,
    screenY: 0,
  });

  // Game state
  const [gameState, setGameState] = useState<GameState>({
    status: 'PLAYING',
    mode: 'TRAINING',
    score: 0,
    level: 1,
    playerClass: 'Berserker',
    round: 1,
    maxRounds: 1,
    roundTimer: 999,
    playerTeamWins: 0,
    enemyTeamWins: 0,
    activeVfxCount: 0,
    isControlsOverlayOpen: false,
    isDebugPanelOpen: false,
    isPointerLocked: false,
  });

  usePlaygroundGameLifecycle(gameState, sdk);

  useEffect(() => {
    setGameState((g) => ({ ...g, status: isMapSelectOpen ? 'PAUSED' : 'PLAYING' }));
  }, [isMapSelectOpen]);

  // Toggle handlers for input hook
  const handleToggleDebug = useCallback(() => {
    setIsDebugOpen((prev) => !prev);
  }, []);

  const handleToggleHelp = useCallback(() => {
    setIsHowToPlayOpen((prev) => !prev);
  }, []);

  const handleEscape = useCallback(() => {
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
    setIsGameMenuOpen((prev) => !prev);
  }, []);

  const inputRef = useGameInput({
    enabled: gameState.status === 'PLAYING',
    onToggleDebug: handleToggleDebug,
    onToggleHelp: handleToggleHelp,
    onEscape: handleEscape,
  });

  // Trigger Blood Rage Edge Flash
  const handleBloodRageFlash = useCallback(() => {
    setBloodRageFlash(true);
    setTimeout(() => setBloodRageFlash(false), 380);
  }, []);

  // Combatant Initializer: Ensure non-NaN values for all properties
  const createCombatant = useCallback((id: string, isPlayer: boolean): CombatantState => {
    const classInfo = CLASS_CONFIGS.Berserker;
    return {
      id,
      isPlayer,
      team: isPlayer ? 'player_team' : 'neutral',
      name: classInfo.name,
      characterName: classInfo.defaultCharacter,
      classId: 'Berserker',
      pos: isPlayer ? [0, 0, 0] : [0, 0, -6],
      vel: [0, 0, 0],
      rotY: isPlayer ? 0 : Math.PI,
      targetRotY: isPlayer ? 0 : Math.PI,
      hp: classInfo.hp,
      maxHp: classInfo.hp,
      mp: classInfo.mp,
      maxMp: classInfo.mp,
      actionState: 'idle',
      stateTimer: 0,
      stateDuration: 0,
      hasHitCurrentMove: false,
      multiHitCounter: 0,
      lastHitTick: 0,
      comboCount: 0,
      comboDamage: 0,
      comboResetTimer: 0,
      isGrounded: true,
      isDodging: false,
      dodgeCooldownTimer: 0,
      dodgeIframeTimer: 0,
      isBlocking: false,
      hasSuperArmor: false,
      hitStopTimer: 0,
      whiteFlashTimer: 0,
      cooldowns: {
        skill1: 0,
        skill2: 0,
        skill3: 0,
        skill4: 0,
        ultimate: 0,
      },
      buffs: [],
      totalDamageDealt: 0,
      totalHealingDone: 0,
      highestCombo: 0,
      actionsPerformed: 0,
      kills: 0,
    };
  }, []);

  const p1RefState = useRef<CombatantState>(createCombatant('p1', true));
  const dummyRefState = useRef<CombatantState>(createCombatant('dummy', false));
  // Debug handle (used by automated visual tests; harmless in production)
  (globalThis as any).__TQ = { p1: p1RefState, dummy: dummyRefState, input: inputRef, ai: aiEnabledRef };
  const targetingRefState = useRef<TargetingState>({
    lockedEnemyId: null,
    friendlyTargetId: null,
  });

  // HUD sync states
  const [hudMirror, setHudMirror] = useState({
    p1Hp: 1600,
    p1MaxHp: 1600,
    p1Mp: 100,
    p1MaxMp: 100,
    p1Combo: 0,
    p1ComboDmg: 0,
    isBlocking: false,
    hasSuperArmor: false,
    dodgeCd: 0,
    cdSkill1: 0,
    cdSkill2: 0,
    cdSkill3: 0,
    cdSkill4: 0,
    cdUlt: 0,
    cdSpecial: 0,
    cdBreak: 0,
    protect: false,
    poisonBuff: 0,
    pierceNext: false,
    isBloodRage: false,
    dummyHp: 1600,
  });

  // Pointer lock change listener
  useEffect(() => {
    const handlePointerLockChange = () => {
      const locked = Boolean(document.pointerLockElement);
      setIsPointerLocked(locked);
    };
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => document.removeEventListener('pointerlockchange', handlePointerLockChange);
  }, []);

  // Sync HUD state from refs periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const p1 = p1RefState.current;
      const dummy = dummyRefState.current;
      setHudMirror({
        p1Hp: p1.hp,
        p1MaxHp: p1.maxHp,
        p1Mp: p1.mp,
        p1MaxMp: p1.maxMp,
        p1Combo: p1.comboCount,
        p1ComboDmg: p1.comboDamage,
        isBlocking: p1.isBlocking,
        hasSuperArmor: p1.hasSuperArmor,
        dodgeCd: p1.dodgeCooldownTimer,
        cdSkill1: p1.cooldowns.skill1 || 0,
        cdSkill2: p1.cooldowns.skill2 || 0,
        cdSkill3: p1.cooldowns.skill3 || 0,
        cdSkill4: p1.cooldowns.skill4 || 0,
        cdUlt: p1.cooldowns.ultimate || 0,
        cdSpecial: p1.cooldowns.special || 0,
        cdBreak: p1.cooldowns.breakout || 0,
        protect: (p1.protectTimer || 0) > 0,
        poisonBuff: p1.poisonBuff || 0,
        pierceNext: !!p1.pierceNext,
        isBloodRage: p1.buffs.some((b) => b.type === 'blood_rage'),
        dummyHp: dummy.hp,
      });
    }, 60);
    return () => clearInterval(interval);
  }, []);

  // Request pointer lock
  const requestGameFocus = () => {
    const canvas = canvasContainerRef.current?.querySelector('canvas') || canvasContainerRef.current;
    if (canvas && typeof canvas.requestPointerLock === 'function') {
      try {
        const promise = canvas.requestPointerLock() as unknown;
        if (promise && typeof (promise as Promise<void>).catch === 'function') {
          (promise as Promise<void>).catch(() => {});
        }
      } catch {
        // Safe fallback
      }
    }
    setIsHowToPlayOpen(false);
    setIsGameMenuOpen(false);
    gameAudio.playCrispClick();
  };

  const berserkerConfig = CLASS_CONFIGS[playerClass];

  return (
    <div className="fixed inset-0 overflow-hidden touch-none flex flex-col bg-zinc-950 text-white font-sans select-none">
      {/* Background Music */}
      <BackgroundMusic
        url="https://assets.mixkit.co/music/preview/mixkit-game-level-music-689.mp3"
        isPlaying={gameState.status === 'PLAYING'}
        isMuted={isMusicMuted}
      />

      {/* Blood Rage Edge Flash Overlay */}
      {bloodRageFlash && (
        <div className="absolute inset-0 pointer-events-none z-30 ring-[18px] ring-inset ring-red-600/70 shadow-[inset_0_0_100px_rgba(239,68,68,0.7)] animate-pulse" />
      )}

      {/* Player hurt flash */}
      {hurtFlash > 0 && (
        <div
          key={hurtFlash}
          className="absolute inset-0 pointer-events-none z-30 shadow-[inset_0_0_120px_rgba(220,38,38,0.55)]"
          style={{ animation: 'tqHurt 0.35s ease-out forwards' }}
        />
      )}
      <style>{`@keyframes tqHurt{from{opacity:1}to{opacity:0}} @keyframes tqBanner{0%{transform:scale(1.6);opacity:0}15%{transform:scale(1);opacity:1}85%{opacity:1}100%{opacity:0}}`}</style>

      {screenFlash.n > 0 && (
        <div key={`sf${screenFlash.n}`} className="absolute inset-0 pointer-events-none z-30" style={{ background: screenFlash.color, animation: 'tqHurt 0.45s ease-out forwards' }} />
      )}

      {toast.n > 0 && (
        <div key={`t${toast.n}`} className="absolute top-32 inset-x-0 flex justify-center pointer-events-none z-40" style={{ animation: 'tqBanner 2.4s ease-out forwards' }}>
          <span className="text-lg font-black text-orange-300 bg-black/75 border border-orange-500/60 px-5 py-2 rounded-full shadow-xl">{toast.text}</span>
        </div>
      )}

      {/* MAP SELECT */}
      {isMapSelectOpen && !modelProgress.isLoading && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm overflow-y-auto flex justify-center p-4">
          <div className="w-full max-w-5xl my-auto">
            <div className="text-center mb-5">
              <h2 className="text-3xl font-black text-amber-300 tracking-widest">选择战场</h2>
              <p className="text-xs text-zinc-400 mt-1">每张地图都有自己的机制和主场职业，主场职业在该地图伤害 +10%</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {([['你的职业', playerClass, setPlayerClass], ['对手职业', enemyClass, setEnemyClass]] as const).map(([label, cur, set]) => (
                <div key={label} className="bg-zinc-900/80 border border-zinc-700 rounded-2xl p-3">
                  <div className="text-xs font-bold text-zinc-300 mb-2">{label}</div>
                  <div className="flex gap-2">
                    {PLAYABLE.map((cid) => {
                      const cc = CLASS_CONFIGS[cid];
                      const on = cur === cid;
                      return (
                        <button
                          key={cid}
                          onClick={() => {
                            gameAudio.playCrispClick();
                            set(cid);
                            setScore({ player: 0, enemy: 0 });
                          }}
                          className={`flex-1 text-left rounded-xl border px-3 py-2 transition-all ${
                            on ? (cid === 'Ranger' ? 'border-teal-400 bg-teal-900/40 ring-2 ring-teal-400/50' : 'border-amber-400 bg-amber-900/40 ring-2 ring-amber-400/50') : 'border-zinc-700 hover:border-zinc-500'
                          }`}
                        >
                          <div className="text-sm font-black text-white">{cc.name} · {cc.defaultCharacter}</div>
                          <div className="text-[10px] text-zinc-400 leading-snug mt-0.5">{cc.role}</div>
                          <div className="text-[10px] text-zinc-500 mt-0.5">生命 {cc.hp} · 移速 {Math.round((cc.speedRatio || 1) * 100)}%</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-center text-[11px] text-zinc-500 -mt-2 mb-4">选好职业后点一张地图开打</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {MAP_ORDER.map((id) => {
                const m = MAPS[id];
                const selected = id === mapId;
                return (
                  <button
                    key={id}
                    disabled={!m.available}
                    onClick={() => {
                      gameAudio.playCrispClick();
                      setMapId(id);
                      setRoundBanner(null);
                      setIsMapSelectOpen(false);
                      requestGameFocus();
                    }}
                    className={`text-left rounded-2xl border p-4 bg-gradient-to-br ${m.cardGradient} transition-all ${
                      m.available ? 'hover:scale-[1.02] hover:border-amber-400 cursor-pointer' : 'opacity-50 cursor-not-allowed'
                    } ${selected ? 'border-amber-400 ring-2 ring-amber-400/60' : 'border-zinc-700'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-black text-white">{m.icon} {m.name}</span>
                      {!m.available && <span className="text-[10px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded-full">敬请期待</span>}
                      {selected && m.available && <span className="text-[10px] bg-amber-500 text-black font-bold px-2 py-0.5 rounded-full">当前</span>}
                    </div>
                    <p className="text-xs text-zinc-300 mt-1">{m.subtitle}</p>
                    <ul className="mt-3 space-y-1">
                      {m.mechanics.map((x) => (
                        <li key={x} className="text-[11px] text-zinc-200">• {x}</li>
                      ))}
                    </ul>
                    <div className="mt-3 pt-2 border-t border-white/10 text-[11px] text-amber-200">
                      主场职业：<span className="font-bold">{m.homeClassName}</span> · {m.homeBonus}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-center text-[11px] text-zinc-500 mt-4">游戏中按 M 可随时回到这里</p>
          </div>
        </div>
      )}

      {/* Round result banner */}
      {roundBanner && (
        <div className="absolute inset-0 pointer-events-none z-40 flex flex-col items-center justify-center gap-2" style={{ animation: 'tqBanner 3.1s ease-out forwards' }}>
          <span className={`text-6xl font-black italic tracking-widest drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)] ${roundBanner === 'player' ? 'text-amber-300' : 'text-sky-300'}`}>
            {roundBanner === 'player' ? '胜' : '败'}
          </span>
          <span className="text-sm font-bold text-zinc-200 bg-black/60 px-3 py-1 rounded-full">
            {roundBanner === 'player' ? `${enemyShadow} 被击倒` : `你被${enemyShadow}击倒`} · {score.player} : {score.enemy} · 下一回合即将开始
          </span>
        </div>
      )}

      {/* Model Download Loading Overlay */}
      {modelProgress.isLoading && (
        <CanvasLoadingScreen
          progress={modelProgress.progress}
          error={modelProgress.error}
          onRetry={() => window.location.reload()}
        />
      )}

      {/* 3D WebGL Canvas Layer */}
      <div
        ref={canvasContainerRef}
        onClick={() => {
          if (!isPointerLocked && !isGameMenuOpen && !isHowToPlayOpen && !isMapSelectOpen && !modelProgress.isLoading) {
            requestGameFocus();
          }
        }}
        className="flex-1 w-full min-h-0 relative bg-slate-950 overflow-hidden cursor-crosshair"
      >
        <Suspense
          fallback={
            <CanvasLoadingScreen
              progress={modelProgress.progress}
              error={modelProgress.error}
              onRetry={() => window.location.reload()}
            />
          }
        >
          <Canvas
            shadows
            dpr={[1, 2]}
            gl={{ antialias: false, powerPreference: 'high-performance' }}
            camera={STATIC_CANVAS_CAMERA}
            className="w-full h-full block"
          >
            <Game
              gameState={gameState}
              setGameState={setGameState}
              inputRef={inputRef}
              p1RefState={p1RefState}
              dummyRefState={dummyRefState}
              targetingRefState={targetingRefState}
              aiEnabledRef={aiEnabledRef}
              mapId={mapId}
              playerClass={playerClass}
              enemyClass={enemyClass}
              onRoundEvent={handleRoundEvent}
              onVfxCountChange={setVfxCount}
              onDebugUpdate={setDebugData}
              onDummyScreenPosUpdate={setDummyScreenPos}
              onBloodRageFlash={handleBloodRageFlash}
              onAnimationDebug={setAnimDebugInfo}
              onLoadProgress={setModelProgress}
            />
          </Canvas>
        </Suspense>

        {/* Projected Screen Space Healthbar for Dummy */}
        {dummyScreenPos.visible && !isGameMenuOpen && !isHowToPlayOpen && (
          <div
            className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full z-20 flex flex-col items-center gap-1 transition-all duration-75"
            style={{
              left: `${dummyScreenPos.screenX}px`,
              top: `${dummyScreenPos.screenY}px`,
            }}
          >
            <div className="flex items-center gap-1 bg-black/85 px-2.5 py-0.5 rounded-full border border-red-500/50 text-[11px] font-bold text-red-300 shadow-lg">
              <span>{aiEnabled ? `${enemyShadow} · 对手` : `演武木桩 · ${enemyShadow}`}</span>
              {targetingRefState.current.lockedEnemyId && (
                <span className="text-yellow-400 font-mono text-[10px]">🎯 锁定</span>
              )}
            </div>
            <div className="w-36 h-2.5 bg-zinc-950 rounded-full border border-sky-400/80 overflow-hidden shadow-md">
              <div
                className="h-full bg-gradient-to-r from-sky-600 via-sky-400 to-cyan-300 transition-all duration-75"
                style={{ width: `${(hudMirror.dummyHp / dummyRefState.current.maxHp) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Crosshair Center Reticle */}
        {isPointerLocked && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center z-20">
            <div className="relative w-6 h-6 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-amber-400 rounded-full shadow-[0_0_8px_#f59e0b]" />
              <div className="absolute w-6 h-0.5 bg-amber-400/40" />
              <div className="absolute h-6 w-0.5 bg-amber-400/40" />
            </div>
          </div>
        )}
      </div>

      {/* FOCUS PROMPT BADGE */}
      {!isPointerLocked && !isGameMenuOpen && !isHowToPlayOpen && !modelProgress.isLoading && (
        <div
          onClick={requestGameFocus}
          className="absolute top-20 inset-x-0 mx-auto w-fit bg-black/80 hover:bg-amber-950/90 border border-amber-500/60 rounded-full px-5 py-2 z-30 flex items-center gap-2 cursor-pointer transition-all shadow-xl hover:scale-105"
        >
          <MousePointer className="w-4 h-4 text-amber-400 animate-bounce" />
          <span className="text-xs font-bold text-amber-300">
            点击画面锁定鼠标视角 · WASD 自由移动 · 滚轮缩放镜头
          </span>
        </div>
      )}

      {/* TOP COMBAT HUD */}
      <div className="absolute top-0 inset-x-0 p-4 pointer-events-none flex flex-col gap-1.5 z-20">
        <div className="flex items-center justify-between gap-4 max-w-4xl mx-auto w-full">
          {/* Player HP / MP & Stance Bar */}
          <div className="flex-1 flex flex-col gap-1 bg-zinc-950/85 p-3 rounded-2xl border border-zinc-800 backdrop-blur-md shadow-xl">
            <div className="flex items-center justify-between text-xs font-bold text-amber-300">
              <span className="flex items-center gap-1.5">
                <Sword className="w-4 h-4 text-red-500" />
                {berserkerConfig.name} · {berserkerConfig.defaultCharacter}
                {hudMirror.isBloodRage && (
                  <span className="text-[10px] bg-red-600/30 text-red-300 px-1.5 py-0.5 rounded border border-red-500 animate-pulse font-black">
                    血怒狂暴 (伤+35% / 附带吸血)
                  </span>
                )}
                {hudMirror.hasSuperArmor && !hudMirror.isBloodRage && (
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/40">
                    霸体
                  </span>
                )}
                {hudMirror.poisonBuff > 0 && (
                  <span className="text-[10px] bg-green-600/25 text-green-300 px-1.5 py-0.5 rounded border border-green-500/50">
                    淬毒 {hudMirror.poisonBuff.toFixed(1)}s
                  </span>
                )}
                {hudMirror.pierceNext && (
                  <span className="text-[10px] bg-amber-500/25 text-amber-200 px-1.5 py-0.5 rounded border border-amber-400 animate-pulse font-black">
                    袖里乾坤：下一镖穿透
                  </span>
                )}
                {hudMirror.isBlocking && (
                  <span className="text-[10px] bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded border border-sky-500/40">
                    格挡防御中 (减伤60%)
                  </span>
                )}
              </span>
              <span className="font-mono">
                {Math.round(hudMirror.p1Hp)} / {hudMirror.p1MaxHp}
              </span>
            </div>

            {/* Health Bar */}
            <div className="w-full h-4 bg-zinc-900 rounded-full border border-amber-500/40 overflow-hidden p-0.5">
              <div
                className="h-full bg-gradient-to-r from-red-600 via-amber-500 to-yellow-400 rounded-full transition-all duration-100"
                style={{ width: `${(hudMirror.p1Hp / hudMirror.p1MaxHp) * 100}%` }}
              />
            </div>

            {/* MP Bar & Dodge Cooldown */}
            <div className="flex items-center justify-between gap-2 text-[10px]">
              <div className="flex items-center gap-1 flex-1">
                <span className="text-sky-400 font-bold">MP</span>
                <div className="w-full h-2 bg-zinc-900 rounded-full border border-sky-500/40 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 rounded-full transition-all duration-100"
                    style={{ width: `${(hudMirror.p1Mp / hudMirror.p1MaxMp) * 100}%` }}
                  />
                </div>
                <span className="font-mono text-sky-300 ml-1">
                  {Math.round(hudMirror.p1Mp)}/{hudMirror.p1MaxMp}
                </span>
              </div>

              {hudMirror.protect && <span className="text-slate-100 font-bold">保护中</span>}
              {hudMirror.cdBreak > 0 ? (
                <span className="text-zinc-500 font-mono">受身 {hudMirror.cdBreak.toFixed(0)}s</span>
              ) : (
                <span className="text-slate-200 font-bold" title="被打僵直、击飞、倒地时按 Shift 脱身">受身就绪</span>
              )}
              {hudMirror.dodgeCd > 0 ? (
                <span className="text-zinc-500 font-mono">
                  闪避冷却: {hudMirror.dodgeCd.toFixed(1)}s
                </span>
              ) : (
                <span className="text-emerald-400 font-bold">闪避就绪 (Shift)</span>
              )}
            </div>
          </div>

          {/* Top Center Arena Badge */}
          <div className="flex flex-col items-center justify-center bg-zinc-900/85 px-4 py-2 rounded-2xl border border-zinc-700 shadow-md min-w-[120px]">
            <span className="text-[10px] text-zinc-400 font-semibold tracking-wider">
              {MAPS[mapId].icon} {MAPS[mapId].name}
            </span>
            <span className="text-sm font-black text-amber-400 tracking-wider">
              {aiEnabled ? `对决 ${score.player} : ${score.enemy}` : '自由试炼'}
            </span>
            <span className="text-[9px] text-amber-200/80">主场：{MAPS[mapId].homeClassName} · {MAPS[mapId].homeBonus.split('（')[0]}</span>
            <span className="text-[9px] text-zinc-500">P 切换{aiEnabled ? '木桩' : '对战'}模式 · M 换地图</span>
          </div>
        </div>

        {/* Combo Banner & Tips */}
        <div className="max-w-4xl mx-auto w-full flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <span className="bg-black/60 px-2 py-0.5 rounded text-[10px] text-zinc-400 font-mono border border-zinc-800">
              活跃特效数: <span className="text-amber-400 font-bold">{vfxCount}</span>
            </span>
            <span className="bg-black/60 px-2 py-0.5 rounded text-[10px] text-zinc-400 font-mono border border-zinc-800">
              按 <span className="text-amber-300 font-bold">H</span> 技能指南 · <span className="text-amber-300 font-bold">F3</span> 监控面板
            </span>
          </div>

          {hudMirror.p1Combo > 1 && (
            <div className="flex flex-col items-center animate-pulse">
              <span className="text-2xl font-black italic text-amber-300 drop-shadow-[0_2px_8px_rgba(245,158,11,0.8)]">
                {hudMirror.p1Combo} 连击 COMBO!
              </span>
              <span className="text-xs text-amber-100 font-bold bg-amber-950/80 px-2 py-0.5 rounded border border-amber-500/40">
                总伤害: {hudMirror.p1ComboDmg}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Top Right Menu Button */}
      <button
        onClick={() => {
          gameAudio.playCrispClick();
          if (document.pointerLockElement) {
            document.exitPointerLock?.();
          }
          setIsGameMenuOpen(true);
        }}
        className="absolute top-4 right-4 z-40 bg-zinc-900/90 hover:bg-zinc-800 text-amber-400 border border-amber-500/50 rounded-xl px-3 py-2 flex items-center gap-1.5 shadow-xl text-xs font-bold pointer-events-auto transition-all"
      >
        <span>菜单 (Esc)</span>
      </button>

      {/* BOTTOM HOTBAR: short descriptions + right-click detail cards */}
      <div className="absolute bottom-3 inset-x-0 pointer-events-none flex flex-col items-center z-20 px-4 gap-2">
        {skillCard && (() => {
          const info = HOTBAR_INFO.find((h) => h.id === skillCard);
          if (!info) return null;
          return (
            <div className="pointer-events-auto w-[340px] max-w-full bg-zinc-950/95 border border-amber-500/60 rounded-2xl p-4 shadow-2xl backdrop-blur-md text-zinc-200">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-base font-black text-amber-300">
                  {info.icon} {info.name} <span className="text-xs text-zinc-400 font-mono">[{info.key}]</span>
                </span>
                <button onClick={() => setSkillCard(null)} className="text-zinc-500 hover:text-zinc-200 text-xs px-1">关闭 ✕</button>
              </div>
              <div className="flex gap-2 mb-2 text-[10px] font-mono">
                {info.meta.map((m) => (
                  <span key={m} className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-300">{m}</span>
                ))}
              </div>
              <p className="text-xs leading-relaxed text-zinc-300">{info.desc}</p>
              {info.tip && <p className="text-[11px] leading-relaxed text-amber-200/90 mt-2">💡 {info.tip}</p>}
            </div>
          );
        })()}

        <div className="bg-zinc-950/95 border border-zinc-800 rounded-3xl px-3 py-2 flex items-end gap-2 shadow-2xl pointer-events-auto backdrop-blur-md">
          {HOTBAR_INFO.map((h, idx) => {
            const cd =
              h.cdKey === 'skill1' ? hudMirror.cdSkill1 :
              h.cdKey === 'skill2' ? hudMirror.cdSkill2 :
              h.cdKey === 'skill3' ? hudMirror.cdSkill3 :
              h.cdKey === 'skill4' ? hudMirror.cdSkill4 :
              h.cdKey === 'ultimate' ? hudMirror.cdUlt :
              h.cdKey === 'special' ? hudMirror.cdSpecial : 0;
            const onCd = cd > 0;
            const active = skillCard === h.id;
            return (
              <React.Fragment key={h.id}>
                {idx === 2 && <div className="w-px self-stretch bg-zinc-800 mx-1" />}
                <div
                  className="flex flex-col items-center w-[62px] cursor-help select-none"
                  title="右键查看技能介绍"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSkillCard((c) => (c === h.id ? null : h.id));
                  }}
                >
                  <div
                    className={`w-11 h-11 rounded-xl border relative overflow-hidden flex items-center justify-center text-lg shadow-md transition-all ${
                      h.super
                        ? 'bg-gradient-to-br from-red-600 to-amber-700 border-amber-400'
                        : h.basic
                        ? 'bg-zinc-800 border-sky-500/50'
                        : 'bg-zinc-800 border-zinc-700'
                    } ${active ? 'ring-2 ring-amber-400' : ''}`}
                  >
                    <span>{h.icon}</span>
                    {onCd && (
                      <div className="absolute inset-0 bg-black/75 flex items-center justify-center text-amber-300 font-mono font-bold text-xs">
                        {cd.toFixed(1)}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-100 font-bold mt-1 leading-none">
                    <span className="text-amber-400 font-mono">{h.key}</span> {h.name}
                  </span>
                  <span className="text-[9px] text-zinc-400 mt-0.5 leading-tight text-center">{h.short}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <span className="text-[10px] text-zinc-300 bg-black/60 rounded-full px-2.5 py-0.5 pointer-events-none">按 Esc 解锁鼠标后，右键技能图标查看详细介绍</span>
      </div>

      {/* F3 DEBUG PANEL (MONITORING & ANIMATION CLIP INSPECTION) */}
      {isDebugOpen && (
        <div className="absolute top-16 left-4 z-40 bg-zinc-950/95 border-2 border-amber-500/70 rounded-2xl p-4 shadow-2xl backdrop-blur-md text-xs font-mono text-zinc-200 max-w-md pointer-events-none max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2 mb-2">
            <span className="text-amber-400 font-bold flex items-center gap-1">
              <Activity className="w-4 h-4" />
              天阙 调试监控 (F3 Debug)
            </span>
            <span className="text-[10px] text-emerald-400 font-bold">
              FPS: {inputRef.current.debug.fps}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 text-[11px]">
            {/* Real-time input & skill evaluation */}
            <div className="flex justify-between bg-zinc-900/80 p-1.5 rounded border border-zinc-800">
              <span className="text-zinc-400">最后按键 (Last Key Code):</span>
              <span className="text-amber-300 font-bold">
                {inputRef.current.debug.lastKeyCode}
              </span>
            </div>

            <div className="flex justify-between bg-zinc-900/80 p-1.5 rounded border border-zinc-800">
              <span className="text-zinc-400">最后技能尝试 (Skill Attempt):</span>
              <span className="text-amber-300 font-bold">
                {inputRef.current.debug.lastSkillAttempted}
              </span>
            </div>

            <div className="flex justify-between bg-zinc-900/80 p-1.5 rounded border border-zinc-800">
              <span className="text-zinc-400">判定结果 (Skill Result):</span>
              <span
                className={`font-bold ${
                  inputRef.current.debug.lastSkillResult.includes('成功')
                    ? 'text-emerald-400'
                    : inputRef.current.debug.lastSkillResult.includes('冷却')
                    ? 'text-yellow-400'
                    : 'text-rose-400'
                }`}
              >
                {inputRef.current.debug.lastSkillResult}
              </span>
            </div>

            {/* REQUIREMENT 2: Animation Clips Inspector */}
            <div className="mt-2 pt-2 border-t border-zinc-800 flex flex-col gap-1">
              <span className="text-amber-400 font-bold flex items-center gap-1 text-[11px]">
                <Film className="w-3.5 h-3.5 text-amber-500" />
                霍岩 (berserker.glb) 动画切片映射监控
              </span>

              <div className="bg-zinc-900/90 p-2 rounded border border-zinc-800 flex flex-col gap-1 text-[10px]">
                <div>
                  <span className="text-zinc-400">所有切片 (All Clips): </span>
                  <span className="text-emerald-300">
                    {animDebugInfo.allClips.length > 0
                      ? `[${animDebugInfo.allClips.join(', ')}]`
                      : '读取中...'}
                  </span>
                </div>

                <div>
                  <span className="text-zinc-400">当前播放 (Current Playing): </span>
                  <span className="text-yellow-300 font-bold">
                    {animDebugInfo.currentClip}
                  </span>
                </div>

                <div className="mt-1">
                  <span className="text-zinc-400 block mb-0.5">状态切片绑定 (State Mapping):</span>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 bg-black/50 p-1.5 rounded text-[9px]">
                    {Object.entries(animDebugInfo.mappedStates).map(([st, clip]) => (
                      <div key={st} className="truncate">
                        <span className="text-zinc-400">{st}: </span>
                        <span className="text-amber-300 font-semibold">{clip}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {animDebugInfo.unmappedStates.length > 0 && (
                  <div className="mt-1 bg-red-950/40 p-1.5 rounded border border-red-900/50">
                    <span className="text-rose-400 font-bold block">
                      无匹配切片状态 (No Clip States):
                    </span>
                    <span className="text-rose-300 text-[9px]">
                      {animDebugInfo.unmappedStates.join(', ')} (将平滑回退至基础待机/跑动)
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between mt-1">
              <span className="text-zinc-400">当前按键 (Active Keys):</span>
              <span className="text-amber-300 max-w-[180px] truncate text-right">
                {inputRef.current.debug.activeKeys.length > 0
                  ? inputRef.current.debug.activeKeys.join(', ')
                  : 'None'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-zinc-400">视角锁定 (Pointer Lock):</span>
              <span className={isPointerLocked ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                {isPointerLocked ? '已锁定 (Active)' : '自由视角 (Click to lock)'}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-zinc-400">摄像机偏航 (Yaw):</span>
              <span className="text-amber-300 font-bold">
                {THREE.MathUtils.radToDeg(debugData.camYaw).toFixed(1)}°
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-zinc-400">摄像机俯仰 (Pitch):</span>
              <span className="text-amber-300 font-bold">
                {THREE.MathUtils.radToDeg(debugData.camPitch).toFixed(1)}°
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-zinc-400">镜头距离 (Distance):</span>
              <span className="text-amber-300 font-bold">
                {debugData.camDist.toFixed(2)} m
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-zinc-400">玩家坐标 (Player Pos):</span>
              <span className="text-emerald-300">
                [{debugData.playerPos[0].toFixed(2)}, {debugData.playerPos[1].toFixed(2)}, {debugData.playerPos[2].toFixed(2)}]
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-zinc-400">活跃特效数 (Active VFX):</span>
              <span className="text-amber-400 font-bold">{vfxCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* H CONTROLS & SKILLS HELP OVERLAY */}
      {isHowToPlayOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 overflow-y-auto flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl bg-zinc-950 border-2 border-amber-500/60 rounded-3xl p-6 shadow-2xl flex flex-col text-zinc-200">
            <div className="flex items-center justify-between mb-4 border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-amber-400" />
                <h3 className="text-2xl font-black text-amber-400 tracking-wider">
                  《天阙》操作指南与取消连招表
                </h3>
              </div>
              <span className="text-xs text-zinc-500">[按 H 键开关]</span>
            </div>

            <div className="flex flex-col gap-3 text-xs leading-relaxed overflow-y-auto max-h-[60vh] pr-1">
              <div className="bg-zinc-900/80 p-3.5 rounded-2xl border border-zinc-800">
                <span className="font-bold text-amber-300 block mb-1.5 flex items-center gap-1.5">
                  <Crosshair className="w-4 h-4 text-amber-400" />
                  【键鼠控制与视角】
                </span>
                <p>• 鼠标移动：360度自由旋转第三人称镜头</p>
                <p>• 鼠标滚轮：平滑拉近 / 拉远镜头视距（3.0m ~ 10.0m）</p>
                <p>• WASD：以摄像机朝向为基准自由移动，W 始终朝向视野前方</p>
                <p>• 空格键 Space：跳跃（可在空中释放技能或下劈）</p>
                <p>• Shift 键：翻滚闪避（可在任何技能后摇或普攻前摇时强行取消）</p>
                <p>• Tab 键：锁定 / 切换最近敌方目标，鼠标中键：清除目标锁定</p>
                <p>• F3 键：开启 / 关闭实时调试监控面板（查看按键与动作切片）</p>
                <p>• P 键：切换 对战模式（霍岩影会走位、连招、格挡、闪避）/ 木桩模式（不还手）</p>
                <p>• 受身：被打僵直、击飞、倒地时按 Shift 立刻脱身（狂刃冷却15秒，暗器10秒）。被连续控太久会自动触发「保护」，1.8秒内不会再被控。</p>
                <p>• 鼠标右键格挡：正面受击减伤60%且不会被打断；天崩无法格挡，只能翻滚躲开</p>
                <p>• 完美格挡：被打中前0.2秒内按右键，免伤并弹开对手；极限闪避：贴着攻击翻滚触发慢动作。两者之后下一击伤害+50%</p>
                <p>• 浮空追击：对手被击飞时用普攻可以在空中继续追打，最多4下</p>
                <p className="text-amber-300 font-bold mt-1">【小连招】</p>
                <p>• 钉地斩：跳起后按 1，向下砸地，砸中会把对手钉进地里0.5秒，随后对手被震飞，可接空中追打</p>
                <p>• 下劈：跳起后按左键，空中向下重劈，落地冲击把对手劈倒</p>
                <p>• 回身斩：翻滚中后段或翻滚刚结束时按左键，顺势前冲斩一刀，伤害更高</p>
                <p>• 推荐：空格 → 1 钉地斩 → 对手弹起 → 左键 ×3 空中追打</p>
              </div>

              <div className="bg-zinc-900/80 p-3.5 rounded-2xl border border-zinc-800">
                <span className="font-bold text-red-400 block mb-1.5 flex items-center gap-1.5">
                  <Sword className="w-4 h-4 text-red-400" />
                  【狂刃 · 霍岩 技能与取消连招】
                </span>
                <p>• 鼠标左键：双柄重刃 3 段连击（奔跑中直接无缝挥砍起手）</p>
                <p>• 1 或 Q 键【裂地斩】：砸地裂石击飞敌人，空中释放垂直重砸</p>
                <p>• 2 或 E 键【旋风刃】：霸体多段旋转绞杀，期间可按 WASD 以40%速度移动</p>
                <p>• 3 键【蛮牛冲】：肩甲极速向前冲撞并撞飞击倒敌人</p>
                <p>• 4 键【血怒】：消耗10%生命值，获得8秒35%增伤与20%吸血效果</p>
                <p>• R 键【天崩】：跃起十米凌空轰杀，巨额破坏与0.3秒时空静滞</p>
                <p className="text-amber-300 mt-2 font-bold">
                  ★ 推荐爆发连招：左键普攻 x2 → 1 裂地斩 → Shift 闪避取消后摇 → 3 蛮牛冲 → R 天崩！
                </p>
              </div>
            </div>

            <button
              autoFocus
              onClick={requestGameFocus}
              className="mt-5 w-full py-3.5 bg-gradient-to-r from-amber-500 to-yellow-400 text-black font-black rounded-xl text-base transition-all hover:scale-102 shadow-lg"
            >
              锁定视角并开始演练 (Lock Mouse & Play)
            </button>
          </div>
        </div>
      )}

      {/* PAUSE MENU */}
      {isGameMenuOpen && (
        <MenuOverlay tone="neutral" zIndex={50}>
          <div className="w-full max-w-md flex flex-col items-center bg-zinc-950/95 border-2 border-amber-500/50 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
            <h2 className="text-2xl font-black text-amber-400 mb-6">演武暂停 (Paused)</h2>

            <div className="flex flex-col gap-3 w-full mb-6">
              <button
                autoFocus
                onClick={requestGameFocus}
                className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-black rounded-xl text-base shadow-md transition-all"
              >
                继续演武 (Resume)
              </button>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const isMuted = gameAudio.toggleMute();
                    setIsSfxMuted(isMuted);
                  }}
                  className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
                >
                  {isSfxMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  音效: {isSfxMuted ? '关闭' : '开启'}
                </button>

                <button
                  onClick={() => setIsMusicMuted((prev) => !prev)}
                  className="flex-1 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
                >
                  {isMusicMuted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                  音乐: {isMusicMuted ? '关闭' : '开启'}
                </button>
              </div>

              <button
                onClick={() => {
                  p1RefState.current.pos = [0, 0, 0];
                  p1RefState.current.vel = [0, 0, 0];
                  p1RefState.current.rotY = 0;
                  p1RefState.current.targetRotY = 0;
                  p1RefState.current.hp = p1RefState.current.maxHp;
                  p1RefState.current.mp = p1RefState.current.maxMp;
                  dummyRefState.current.pos = [0, 0, -6];
                  dummyRefState.current.rotY = Math.PI;
                  dummyRefState.current.targetRotY = Math.PI;
                  dummyRefState.current.hp = dummyRefState.current.maxHp;
                  requestGameFocus();
                }}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                <RotateCw className="w-4 h-4" />
                重置演武位置与状态
              </button>

              <button
                onClick={() => {
                  setIsGameMenuOpen(false);
                  setIsMapSelectOpen(true);
                }}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-amber-700 text-amber-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                选择地图 · M
              </button>

              <button
                onClick={toggleAI}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-sky-700 text-sky-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                {aiEnabled ? '切换为木桩模式（不还手）' : `切换为对战模式（${enemyShadow}会还手）`} · P
              </button>

              <button
                onClick={() => setIsHowToPlayOpen(true)}
                className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-bold rounded-xl text-xs flex items-center justify-center gap-2"
              >
                <Info className="w-4 h-4" />
                查看按键与技能指南 (H)
              </button>
            </div>
          </div>
        </MenuOverlay>
      )}
    </div>
  );
}
