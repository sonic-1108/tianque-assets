import React, { useState, useRef, useEffect, useCallback, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { usePlayground, usePlaygroundGameLifecycle } from './utils/usePlayground';
import { MenuOverlay, gameAudio, useIsMobile } from './utils/helper';
import { useGameInput } from './input';
import { Game, RoundEvent } from './Game';
import { MAPS, MAP_ORDER, MapId, mapRuntime } from './maps';
import { SettingsPanel } from './components/SettingsPanel';
import { useSettings, QUALITY } from './settings';
import type { CharacterClassId } from './types';
import { NetSession, makeRoomCode, NetMessage } from './net';
import { UnitFrame, UnitStats } from './components/UnitFrame';
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

const STATIC_CANVAS_CAMERA = { fov: 55, near: 0.1, far: 1200 };

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
const MS = CLASS_CONFIGS.BuddhistMage.skills;
const mMeta = (i: number) => [`MP ${MS[i].mpCost}`, `冷却 ${MS[i].cooldown}s`];
const MONK_HOTBAR: HotbarEntry[] = [
  { id: 'm_attack', key: '左键', name: '拳掌', icon: '👊', short: '三段拳掌', basic: true, meta: ['命中回蓝更多', '可连按'],
    desc: '直拳、勾拳，第三段推出一道金色掌印，打到前方约4米，把人推倒。被动「禅心」：拳掌命中比别人多回法力。',
    tip: '贴身连按左键；第三段掌印够得比看上去远，对手后撤时也能打中。' },
  { id: 'm_block', key: '右键', name: '格挡', icon: '🛡️', short: '减伤六成', basic: true, meta: ['按住生效', '移动变慢'],
    desc: '按住右键双掌护身格挡，正面伤害减少60%。在被打中前0.2秒内按下触发「完美格挡」：完全免伤，对手被弹开，你的下一击伤害+50%。',
    tip: '梵音血厚但慢，被沈惊鸿风筝时多用格挡和 1 金刚掌贴上去。' },
  { id: 'vajra_palm', key: '1', name: MS[0].name, icon: MS[0].icon, short: '冲刺推掌', cdKey: 'skill1', meta: mMeta(0), desc: MS[0].description,
    tip: '把对手往墙边或柱子方向推，撞上去会额外眩晕；也是梵音最好的贴身手段。' },
  { id: 'zen_domain', key: '2', name: MS[1].name, icon: MS[1].icon, short: '减速法阵', cdKey: 'skill2', meta: mMeta(1), desc: MS[1].description,
    tip: '贴身时放在脚下，对手在阵里跑不快也翻不远，接拳掌连招。' },
  { id: 'mantra', key: '3', name: MS[2].name, icon: MS[2].icon, short: '追踪封印', cdKey: 'skill3', meta: mMeta(2), desc: MS[2].description,
    tip: '中远距离也能用：六字会拐弯追人，专克风筝的沈惊鸿。最后的「吽」封印2秒，趁这段时间贴上去打，对方交不出保命技能。' },
  { id: 'golden_bell', key: '4', name: MS[3].name, icon: MS[3].icon, short: '减伤反震', cdKey: 'skill4', meta: mMeta(3), desc: MS[3].description,
    tip: '对手连招打过来时开，硬吃着打回去；罩子散的那半秒别贪刀。' },
  { id: 'buddhas', key: 'R', name: MS[4].name, icon: MS[4].icon, short: '九掌天降', cdKey: 'ultimate', super: true, meta: mMeta(4), desc: MS[4].description,
    tip: '先用 2 禅定结界让对手跑不快，再开万佛朝宗，掌印几乎躲不开。' },
];
const HOTBAR_BY_CLASS: Partial<Record<CharacterClassId, HotbarEntry[]>> = { Berserker: BERSERKER_HOTBAR, Ranger: RANGER_HOTBAR, BuddhistMage: MONK_HOTBAR };
const PLAYABLE: CharacterClassId[] = ['Berserker', 'Ranger', 'BuddhistMage'];

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
  const settings = useSettings();
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
  // 江湖名号: asked once, remembered in this browser
  const [nickname, setNickname] = useState<string>(() => {
    try {
      return localStorage.getItem('tq_nickname') || '';
    } catch {
      return '';
    }
  });
  const [nameDraft, setNameDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;
  const saveNickname = (n: string) => {
    const v = n.trim().slice(0, 12);
    if (!v) return;
    setNickname(v);
    setEditingName(false);
    try {
      localStorage.setItem('tq_nickname', v);
    } catch {
      /* private mode: keep it for this session only */
    }
  };
  const [playerClass, setPlayerClass] = useState<CharacterClassId>('Berserker');
  const [enemyClass, setEnemyClass] = useState<CharacterClassId>('Berserker');
  const playerClassRef = useRef<CharacterClassId>('Berserker');
  playerClassRef.current = playerClass;
  const HOTBAR_INFO = HOTBAR_BY_CLASS[playerClass] || BERSERKER_HOTBAR;
  // generative guzheng score and per-map ambience
  useEffect(() => {
    if (isMusicMuted) gameAudio.stopMusic();
    else gameAudio.startMusic();
  }, [isMusicMuted]);
  useEffect(() => {
    gameAudio.setAmbience(mapId === 'lavacliff' || mapId === 'sea' || mapId === 'glacier' || mapId === 'rooftop' || mapId === 'summit' || mapId === 'forest' ? mapId : 'temple');
  }, [mapId]);
  // ---------- online 1v1 ----------
  const [net, setNet] = useState<NetSession | null>(null);
  const netRef = useRef<NetSession | null>(null);
  const [, setNetTick] = useState(0);
  const [joinCode, setJoinCode] = useState('');
  const cfgKeyRef = useRef('');
  const online = !!net && net.status === 'connected';
  const enemyShadow = online ? net?.remoteName || "对手" : `${CLASS_CONFIGS[enemyClass].defaultCharacter}影`;
  const [toast, setToast] = useState<{ n: number; text: string }>({ n: 0, text: '' });

  // Versus mode: 霍岩影 fights back (toggle in pause menu or press P)
  const aiEnabledRef = useRef(true);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [score, setScore] = useState({ player: 0, enemy: 0 });
  const [roundBanner, setRoundBanner] = useState<null | 'player' | 'enemy'>(null);
  const [hurtFlash, setHurtFlash] = useState(0);
  const [screenFlash, setScreenFlash] = useState<{ n: number; color: string }>({ n: 0, color: '' });
  const toggleAI = useCallback(() => {
    if (netRef.current) return; // online: the opponent is a real player
    aiEnabledRef.current = !aiEnabledRef.current;
    setAiEnabled(aiEnabledRef.current);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
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
    const n = netRef.current;
    if (n && n.role === 'host' && e.type !== 'playerHit') n.send({ t: 're', e });
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

  const startNet = useCallback(
    (role: 'host' | 'guest', code: string) => {
      netRef.current?.close();
      const n = new NetSession(role, code);
      n.subscribe(() => {
        setNetTick((t) => t + 1);
        if (n.status === 'connected') {
          aiEnabledRef.current = true;
          setAiEnabled(true);
          setScore({ player: 0, enemy: 0 });
          if (n.role === 'guest') n.send({ t: 'hello', cls: playerClassRef.current, name: nicknameRef.current });
        }
        if (n.status === 'closed' && netRef.current === n) {
          setToast((t) => ({ n: t.n + 1, text: '联机已断开，回到单机模式' }));
          netRef.current = null;
          setNet(null);
          setIsMapSelectOpen(true);
        }
      });
      n.onMessage = (m: NetMessage) => {
        if (m.t === 'cfg' && n.role === 'guest') {
          if (m.hostName) n.remoteName = m.hostName.slice(0, 12);
          setMapId(m.map);
          setPlayerClass(m.guestCls);
          setEnemyClass(m.hostCls);
          setRoundBanner(null);
          setIsMapSelectOpen(false);
        } else if (m.t === 're' && n.role === 'guest') {
          const e = m.e as RoundEvent;
          // the host's "player" is our opponent
          if (e.type === 'ko') handleRoundEvent({ type: 'ko', winner: e.winner === 'player' ? 'enemy' : 'player' });
          else handleRoundEvent(e);
        } else if (m.t === 'bye') {
          n.close();
        }
      };
      netRef.current = n;
      setNet(n);
      n.start();
    },
    [handleRoundEvent]
  );
  const leaveNet = useCallback(() => {
    const n = netRef.current;
    netRef.current = null;
    setNet(null);
    n?.close();
  }, []);
  useEffect(() => () => netRef.current?.close(), []);
  // guest: tell the host which class we picked
  useEffect(() => {
    if (net && net.role === 'guest' && net.status === 'connected') net.send({ t: 'hello', cls: playerClass, name: nickname });
  }, [net, net?.status, playerClass, nickname]);
  // host: the guest's pick is our opponent; push the match config whenever we start / change it
  useEffect(() => {
    if (!net || net.role !== 'host' || net.status !== 'connected') return;
    if (net.remoteClass && net.remoteClass !== enemyClass) setEnemyClass(net.remoteClass);
    const guestCls = net.remoteClass || enemyClass;
    const key = `${mapId}|${playerClass}|${guestCls}|${isMapSelectOpen}|${nickname}`;
    if (!isMapSelectOpen && key !== cfgKeyRef.current) {
      cfgKeyRef.current = key;
      net.send({ t: 'cfg', map: mapId, hostCls: playerClass, guestCls, seq: Date.now(), hostName: nickname });
    }
    if (isMapSelectOpen) cfgKeyRef.current = '';
  });

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
  const [dummyScreenPos, setDummyScreenPos] = useState<{ visible: boolean; screenX: number; screenY: number; angle?: number; dist?: number; hidden?: boolean }>({
    visible: false,
    screenX: 0,
    screenY: 0,
  });
  const dummyScreenPosRef = useRef(dummyScreenPos);
  dummyScreenPosRef.current = dummyScreenPos;

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
  (globalThis as any).__TQ = { p1: p1RefState, dummy: dummyRefState, input: inputRef, ai: aiEnabledRef, rt: mapRuntime };
  const targetingRefState = useRef<TargetingState>({
    lockedEnemyId: null,
    friendlyTargetId: null,
  });

  // HUD sync states
  const [hudMirror, setHudMirror] = useState({
    p1Bell: 0,
    dBell: 0,
    p1Seal: 0,
    dSeal: 0,
    p1Zen: false,
    dZen: false,
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
    p1Stamina: 100,
    p1Poisoned: false,
    p1Rooted: false,
    p1Climb: false,
    p1Swim: false,
    p1Ladder: false,
    p1Grip: 1,
    p1Hint: '',
    p1Candle: 0,
    p1Shade: false,
    night: 0,
    foeHidden: false,
    p1Slip: 0,
    rain: 0,
    storm: 0,
    p1Slide: false,
    dMaxHp: 1600,
    dMp: 100,
    dMaxMp: 100,
    dStamina: 100,
    dClass: 'Berserker' as CharacterClassId,
    dRage: false,
    dArmor: false,
    dPoisoned: false,
    dRooted: false,
    dProtect: false,
    dBlocking: false,
    dPoisonBuff: 0,
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
      const zenHas = (owner: typeof p1, c: typeof p1) => !!owner.zenField && owner.zenField.t > 0 && Math.hypot(c.pos[0] - owner.zenField.x, c.pos[2] - owner.zenField.z) < 4.5;
      setHudMirror({
        p1Bell: p1.bellTimer || 0,
        dBell: dummy.bellTimer || 0,
        p1Seal: p1.silenceTimer || 0,
        dSeal: dummy.silenceTimer || 0,
        p1Zen: zenHas(dummy, p1),
        dZen: zenHas(p1, dummy),
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
        p1Stamina: p1.stamina ?? 100,
        p1Poisoned: (p1.poisonTimer || 0) > 0,
        p1Rooted: (p1.rootTimer || 0) > 0,
        p1Climb: !!p1.climbing,
        p1Swim: !!p1.swimming,
        p1Ladder: !!p1.nearLadder,
        p1Grip: mapId === 'forest' ? p1.grip ?? 1 : 1,
        p1Hint: mapId === 'forest' ? p1.interactHint ?? '' : '',
        p1Candle: mapId === 'forest' ? p1.candle ?? 0 : 0,
        p1Shade: !!p1.shade,
        night: mapId === 'forest' ? mapRuntime.night : 0,
        foeHidden: !!dummyScreenPosRef.current.hidden,
        p1Slip: mapId === 'forest' ? p1.slip ?? 0 : 0,
        rain: mapId === 'forest' ? mapRuntime.rain : 0,
        storm: mapId === 'forest' ? mapRuntime.storm : 0,
        p1Slide: !!p1.sliding,
        dMaxHp: dummy.maxHp,
        dMp: dummy.mp,
        dMaxMp: dummy.maxMp,
        dStamina: dummy.stamina ?? 100,
        dClass: dummy.classId,
        dRage: dummy.buffs.some((b) => b.type === 'blood_rage'),
        dArmor: dummy.hasSuperArmor,
        dPoisoned: (dummy.poisonTimer || 0) > 0,
        dRooted: (dummy.rootTimer || 0) > 0,
        dProtect: (dummy.protectTimer || 0) > 0,
        dBlocking: dummy.isBlocking,
        dPoisonBuff: dummy.poisonBuff || 0,
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
{/* music and ambience are synthesised by gameAudio (see wuxiaSound.ts) */}

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

      {/* NICKNAME: asked before the first match */}
      {(!nickname || editingName) && !modelProgress.isLoading && (
        <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveNickname(nameDraft);
            }}
            className="w-full max-w-md bg-zinc-950 border border-amber-500/50 rounded-2xl p-6 shadow-2xl flex flex-col items-center gap-4"
          >
            <div className="text-4xl font-black text-amber-300 tracking-[0.4em]" style={{ fontFamily: '"Noto Serif SC", "Songti SC", serif' }}>
              天阙
            </div>
            <div className="text-sm text-zinc-300">初入江湖，报上你的名号</div>
            <input
              autoFocus
              value={nameDraft}
              maxLength={12}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder="例如：一剑西来"
              className="w-full bg-black border border-zinc-700 focus:border-amber-400 outline-none rounded-xl px-4 py-3 text-center text-lg font-bold text-white"
            />
            <div className="text-[11px] text-zinc-500">最多 12 个字，会显示在血条和联机对手的屏幕上</div>
            <div className="flex gap-2 w-full">
              {editingName && nickname && (
                <button type="button" onClick={() => setEditingName(false)} className="flex-1 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 text-sm font-bold">
                  取消
                </button>
              )}
              <button
                type="submit"
                disabled={!nameDraft.trim()}
                className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-black text-sm font-black tracking-widest"
              >
                进入江湖
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MAP SELECT */}
      {isMapSelectOpen && !modelProgress.isLoading && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm overflow-y-auto flex justify-center p-4">
          <div className="w-full max-w-5xl my-auto">
            <div className="text-center mb-5">
              <h2 className="text-3xl font-black text-amber-300 tracking-widest">选择战场</h2>
              <div className="mt-1 text-xs text-zinc-300">
                名号：<span className="font-bold text-amber-200">{nickname || '未设置'}</span>
                <button
                  onClick={() => {
                    setNameDraft(nickname);
                    setEditingName(true);
                  }}
                  className="ml-2 text-[11px] text-zinc-400 hover:text-zinc-100 border border-zinc-700 rounded px-1.5"
                >
                  改名
                </button>
              </div>
              <p className="text-xs text-zinc-400 mt-1">每张地图都有自己的机制和主场职业，主场职业在该地图伤害 +10%</p>
            </div>
            {/* ONLINE 1v1 */}
            <div className="mb-4 bg-zinc-900/80 border border-sky-700/60 rounded-2xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-black text-sky-300">🌐 联机对战（1v1）</span>
                {net && (
                  <button onClick={leaveNet} className="text-[11px] text-zinc-400 hover:text-zinc-100 border border-zinc-700 rounded-lg px-2 py-0.5">
                    退出联机
                  </button>
                )}
              </div>
              {!net && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => startNet('host', makeRoomCode())}
                    className="flex-1 bg-sky-700 hover:bg-sky-600 text-white text-sm font-bold rounded-xl py-2"
                  >
                    创建房间
                  </button>
                  <div className="flex-1 flex gap-2">
                    <input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                      placeholder="输入房间号"
                      className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-xl px-3 text-sm font-mono tracking-widest text-white"
                    />
                    <button
                      disabled={joinCode.length !== 5}
                      onClick={() => startNet('guest', joinCode)}
                      className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl px-4"
                    >
                      加入
                    </button>
                  </div>
                </div>
              )}
              {net && (
                <div className="text-xs text-zinc-300 space-y-1">
                  {net.role === 'host' && (
                    <div className="flex items-center gap-2">
                      房间号
                      <span className="font-mono text-lg font-black tracking-[0.3em] text-amber-300">{net.code}</span>
                      <button onClick={() => navigator.clipboard?.writeText(net.code)} className="text-[11px] border border-zinc-700 rounded px-1.5">
                        复制
                      </button>
                    </div>
                  )}
                  {net.status === 'opening' && <div>正在连接联机服务器…</div>}
                  {net.status === 'waiting' && <div>把房间号发给朋友，让他打开同一个网址，在这里输入房间号加入。等待对手…</div>}
                  {net.status === 'connecting' && (
                    <div>
                      正在加入房间 {net.code}…
                      <span className="ml-2 text-[11px] text-zinc-400">
                        {net.iceState === 'checking' ? '正在打通两台电脑之间的连接' : net.iceState === 'new' || !net.iceState ? '正在联系房主' : net.iceState === 'disconnected' ? '连接不稳定，重试中' : ''}
                      </span>
                    </div>
                  )}
                  {net.status === 'connected' && net.role === 'host' && (
                    <div className="text-emerald-300 font-bold">
                      对手已加入 ✓ 对手职业：{CLASS_CONFIGS[net.remoteClass || enemyClass].name}。选好你的职业，点一张地图开打。
                    </div>
                  )}
                  {net.status === 'connected' && net.role === 'guest' && <div className="text-emerald-300 font-bold">已加入房间 ✓ 选好你的职业，等房主选地图开打。</div>}
                  {net.status === 'error' && <div className="text-red-400 font-bold">{net.error}</div>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
              {(net ? ([['你的职业', playerClass, setPlayerClass]] as const) : ([['你的职业', playerClass, setPlayerClass], ['对手职业', enemyClass, setEnemyClass]] as const)).map(([label, cur, set]) => (
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
                            on ? (cid === 'Ranger' ? 'border-teal-400 bg-teal-900/40 ring-2 ring-teal-400/50' : cid === 'BuddhistMage' ? 'border-yellow-300 bg-yellow-900/30 ring-2 ring-yellow-300/50' : 'border-amber-400 bg-amber-900/40 ring-2 ring-amber-400/50') : 'border-zinc-700 hover:border-zinc-500'
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
            {!net && (
              <div className="flex items-center justify-center gap-2 -mt-2 mb-3">
                <span className="text-[11px] text-zinc-400">对手：</span>
                {([
                  [true, '会还手的 AI'],
                  [false, '木桩（站着不动）'],
                ] as const).map(([on, label]) => (
                  <button
                    key={label}
                    onClick={() => {
                      if (aiEnabledRef.current !== on) toggleAI();
                    }}
                    className={`text-[11px] px-3 py-1 rounded-full border transition-all ${
                      aiEnabled === on ? 'bg-amber-500 text-black border-amber-400 font-bold' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <p className="text-center text-[11px] text-zinc-500 mb-4">选好职业后点一张地图开打 · 游戏里按 P 随时让对手停手或恢复</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {MAP_ORDER.map((id) => {
                const m = MAPS[id];
                const selected = id === mapId;
                return (
                  <button
                    key={id}
                    disabled={!m.available || net?.role === 'guest'}
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
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xl font-black text-white">{m.icon} {m.name}</span>
                      <span
                        className={`ml-auto text-[10px] font-black px-2 py-0.5 rounded-full ${m.sizeClass === '50Q' ? 'bg-emerald-400 text-black' : 'bg-white/15 text-zinc-200'}`}
                        title={m.sizeClass === '50Q' ? '大地图：面积约为 10Q 地图的五倍' : '小地图：竞技场'}
                      >
                        {m.sizeClass ?? '10Q'}
                      </span>
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
            dpr={QUALITY[settings.quality].dpr}
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
              net={online ? net : null}
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

        {/* off-screen opponent: an arrow on the screen edge pointing at them, with the distance */}
        {!dummyScreenPos.visible && !dummyScreenPos.hidden && dummyScreenPos.angle !== undefined && !isGameMenuOpen && !isHowToPlayOpen && !isMapSelectOpen && !modelProgress.isLoading && (
          <div
            className="absolute pointer-events-none z-20 flex flex-col items-center"
            style={{
              left: `calc(50% + ${Math.sin(dummyScreenPos.angle) * 42}%)`,
              top: `calc(50% - ${Math.cos(dummyScreenPos.angle) * 40}%)`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div style={{ transform: `rotate(${dummyScreenPos.angle}rad)` }} className="w-0 h-0 border-l-[9px] border-r-[9px] border-b-[16px] border-l-transparent border-r-transparent border-b-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]" />
            <span className="mt-1 text-[10px] font-bold text-red-200 bg-black/60 px-1.5 rounded">{Math.round(dummyScreenPos.dist ?? 0)}米</span>
          </div>
        )}
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

      {/* LEFT UNIT FRAMES: you on top, your opponent below */}
      <div className="absolute top-3 left-3 z-20 pointer-events-none flex flex-col gap-1">
        {(() => {
          const pc = CLASS_CONFIGS[playerClass];
          const meChips: UnitStats['chips'] = [];
          if (hudMirror.isBloodRage) meChips.push({ text: '血怒', tone: 'red', pulse: true });
          if (hudMirror.hasSuperArmor) meChips.push({ text: '霸体', tone: 'amber' });
          if (hudMirror.isBlocking) meChips.push({ text: '格挡', tone: 'sky' });
          if (hudMirror.poisonBuff > 0) meChips.push({ text: `淬毒 ${hudMirror.poisonBuff.toFixed(1)}s`, tone: 'green' });
          if (hudMirror.pierceNext) meChips.push({ text: '袖里乾坤', tone: 'gold', pulse: true });
          if (hudMirror.protect) meChips.push({ text: '保护', tone: 'slate' });
          if (hudMirror.p1Bell > 0) meChips.push({ text: `金钟罩 ${hudMirror.p1Bell.toFixed(1)}s`, tone: 'gold', pulse: hudMirror.p1Bell < 1 });
          if (hudMirror.p1Zen) meChips.push({ text: '禅定 减速', tone: 'amber', pulse: true });
          if (hudMirror.p1Seal > 0) meChips.push({ text: `封印 ${hudMirror.p1Seal.toFixed(1)}s`, tone: 'gold', pulse: true });
          if (hudMirror.p1Poisoned) meChips.push({ text: '中毒', tone: 'green', pulse: true });
          if (hudMirror.p1Rooted) meChips.push({ text: '定身', tone: 'teal', pulse: true });
          if (hudMirror.p1Slide) meChips.push({ text: '体力耗尽 滑落', tone: 'red', pulse: true });
          else if (hudMirror.p1Climb) meChips.push({ text: '攀爬中', tone: 'amber' });
          if (hudMirror.p1Swim) meChips.push({ text: '游泳中 不能出招', tone: 'sky' });
          if (hudMirror.p1Ladder) meChips.push({ text: '按住 F 爬梯子', tone: 'amber', pulse: true });
          if (hudMirror.p1Hint) meChips.push({ text: hudMirror.p1Hint, tone: 'amber', pulse: true });
          if (hudMirror.p1Candle) meChips.push({ text: hudMirror.p1Candle === 2 ? (hudMirror.p1Shade ? '蜡烛 · 灯罩护火' : '蜡烛 已点燃') : '蜡烛 已熄灭', tone: hudMirror.p1Candle === 2 ? 'gold' : 'slate' });
          if (hudMirror.night > 0.55 && hudMirror.foeHidden) meChips.push({ text: '天黑 看不见对手', tone: 'slate' });
          if (hudMirror.p1Grip < 0.85) meChips.push({ text: `地滑 摩擦力 ${Math.round(hudMirror.p1Grip * 100)}%`, tone: hudMirror.p1Grip < 0.62 ? 'red' : 'sky' });
          if (hudMirror.p1Slip > 0.45) meChips.push({ text: hudMirror.p1Slip > 0.75 ? '快滑倒了！别急转' : '脚下不稳', tone: 'red', pulse: true });
          if (hudMirror.cdBreak > 0) meChips.push({ text: `受身 ${hudMirror.cdBreak.toFixed(0)}s`, tone: 'slate' });
          const me: UnitStats = {
            name: nickname || '无名侠客',
            classId: playerClass,
            className: `${pc.name} · ${pc.defaultCharacter}`,
            hp: hudMirror.p1Hp,
            maxHp: hudMirror.p1MaxHp,
            mp: hudMirror.p1Mp,
            maxMp: hudMirror.p1MaxMp,
            stamina: hudMirror.p1Stamina,
            maxStamina: 100,
            chips: meChips,
          };
          const ec = CLASS_CONFIGS[hudMirror.dClass] ?? CLASS_CONFIGS[enemyClass];
          const foeChips: UnitStats['chips'] = [];
          if (hudMirror.dRage) foeChips.push({ text: '血怒', tone: 'red', pulse: true });
          if (hudMirror.dArmor) foeChips.push({ text: '霸体', tone: 'amber' });
          if (hudMirror.dBlocking) foeChips.push({ text: '格挡', tone: 'sky' });
          if (hudMirror.dPoisonBuff > 0) foeChips.push({ text: '淬毒', tone: 'green' });
          if (hudMirror.dProtect) foeChips.push({ text: '保护', tone: 'slate' });
          if (hudMirror.dBell > 0) foeChips.push({ text: '金钟罩', tone: 'gold' });
          if (hudMirror.dZen) foeChips.push({ text: '禅定 减速', tone: 'amber', pulse: true });
          if (hudMirror.dSeal > 0) foeChips.push({ text: `封印 ${hudMirror.dSeal.toFixed(1)}s`, tone: 'gold', pulse: true });
          if (hudMirror.dPoisoned) foeChips.push({ text: '中毒', tone: 'green', pulse: true });
          if (hudMirror.dRooted) foeChips.push({ text: '定身', tone: 'teal', pulse: true });
          const foe: UnitStats = {
            name: online ? net?.remoteName || '对手' : aiEnabled ? `${ec.defaultCharacter}影` : '演武木桩',
            classId: hudMirror.dClass,
            className: `${ec.name} · ${online ? '玩家' : aiEnabled ? 'AI' : '木桩'}`,
            hp: hudMirror.dummyHp,
            maxHp: hudMirror.dMaxHp,
            mp: hudMirror.dMp,
            maxMp: hudMirror.dMaxMp,
            stamina: hudMirror.dStamina,
            maxStamina: 100,
            chips: foeChips,
          };
          return (
            <>
              <UnitFrame s={me} me />
              <UnitFrame s={foe} me={false} />
            </>
          );
        })()}
      </div>

      {/* TOP CENTER: arena and score */}
      <div className="absolute top-3 inset-x-0 z-20 pointer-events-none flex flex-col items-center gap-1.5">
        <div className="flex flex-col items-center bg-zinc-950/75 px-5 py-1.5 rounded-xl border border-zinc-700/70 shadow-md backdrop-blur-md">
          <span className="text-[10px] text-zinc-400 font-semibold tracking-wider">
            {MAPS[mapId].icon} {MAPS[mapId].name}
          </span>
          <span className="text-lg font-black text-amber-300 tracking-[0.25em] leading-tight">
            {aiEnabled || online ? `${score.player} : ${score.enemy}` : '自由试炼'}
          </span>
          <span className="text-[9px] text-zinc-500">{online ? '联机对战' : `P 切换${aiEnabled ? '木桩' : '对战'} · M 换地图`} · 版本 {__BUILD__}</span>
        </div>
      </div>

      <div className="absolute top-24 right-4 z-20 pointer-events-none flex flex-col items-end gap-1.5">
        {/* Combo banner & tips (right side) */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">

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
      {!online && (
        <button
          onClick={() => {
            gameAudio.playCrispClick();
            toggleAI();
          }}
          className={`absolute top-4 right-[118px] z-40 rounded-xl px-3 py-2 text-xs font-bold shadow-xl pointer-events-auto transition-all border ${
            aiEnabled ? 'bg-zinc-900/90 hover:bg-zinc-800 text-zinc-200 border-zinc-600' : 'bg-sky-900/90 hover:bg-sky-800 text-sky-100 border-sky-400/70'
          }`}
        >
          {aiEnabled ? '⏸ 暂停对手 (P)' : '▶ 对手恢复 (P)'}
        </button>
      )}

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
              <SettingsPanel />
            </div>
          </div>
        </MenuOverlay>
      )}
    </div>
  );
}
