import { MaterialCodex } from './components/materials/MaterialCodex';
import { startCloud } from './cloudSave';
import { canRevive } from './revive';
import { storySubscribe, storySnapshot } from './ibStory';
import { StoryDialog } from './components/StoryDialog';
import { adventure } from './adventure';
import { AdventureHud } from './components/AdventureHud';
import * as MapsAll from './maps';
import * as BankerAll from './banker';
import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense } from 'react';
import { startPresence, setPresence } from './presence';
import { LoadingScreen } from './components/lobby/LoadingScreen';
import { Lobby, NameGate } from './components/lobby/Lobby';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { usePlayground, usePlaygroundGameLifecycle } from './utils/usePlayground';
import { MenuOverlay, gameAudio, useIsMobile } from './utils/helper';
import { useGameInput } from './input';
import { Game, RoundEvent } from './Game';
import { MAPS, MAP_ORDER, MapId, mapRuntime, desertIndoor } from './maps';
import { SettingsPanel } from './components/SettingsPanel';
import { useSettings, QUALITY, AI_LEVELS, getSettings } from './settings';
import { reportRound, rename as renameAccount, getAccount } from './stats';
import type { CharacterClassId } from './types';
import { NetSession, makeRoomCode, NetMessage, RoomSeat } from './net';
import { defaultRoom, lineupOf, roomReady, seatGuests, padRoom, SEAT_SIDE, SIDE_SEATS, aiName } from './room';
import { UnitFrame, UnitStats } from './components/UnitFrame';
import { Minimap } from './components/Minimap';
import { ShrineHud } from './components/ShrineHud';
import { LootHud } from './components/LootHud';
import { QuestHud } from './components/QuestHud';
import {
  GameState,
  CombatantState,
  TargetingState,
} from './types';
import { CLASS_CONFIGS } from './components/CombatData';
import { AnimationDebugInfo, ModelLoadProgress, prefetchHeroModels } from './components/CharacterRig3D';
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
const SS = CLASS_CONFIGS.Shadowblade.skills;
const sMeta = (i: number) => [`MP ${SS[i].mpCost}`, `冷却 ${SS[i].cooldown}s`];
const SHADOW_HOTBAR: HotbarEntry[] = [
  { id: 's_attack', key: '左键', name: '双刃', icon: '🗡️', short: '反手三连', basic: true, meta: ['出手很快', '背后出手伤害+30%'],
    desc: '双手反握飞刀，两下快斩，第三下双刀齐刺。被动「背刺」：从对手背后出手伤害提高30%。',
    tip: '先用 1 瞬影闪到背后，再接三连，暴击加背刺伤害非常高。' },
  { id: 's_block', key: '右键', name: '格挡', icon: '🛡️', short: '减伤六成', basic: true, meta: ['按住生效', '移动变慢'],
    desc: '按住右键交叉双刀格挡，正面伤害减少60%。在被打中前0.2秒内按下触发「完美格挡」。',
    tip: '影刃血薄，硬拼不如躲：能翻滚就翻滚，来不及再格挡。' },
  { id: 'shadow_step', key: '1', name: SS[0].name, icon: SS[0].icon, short: '闪到身后', cdKey: 'skill1', meta: sMeta(0), desc: SS[0].description,
    tip: '对手正面对着你出招时用，正好闪到他背后。' },
  { id: 'fan_knives', key: '2', name: SS[1].name, icon: SS[1].icon, short: '五刀刷新瞬影', cdKey: 'skill2', meta: sMeta(1), desc: SS[1].description,
    tip: '先甩飞刀，命中后立刻接 1 瞬影闪到背后，再三连。' },
  { id: 'burrow', key: '3', name: SS[2].name, icon: SS[2].icon, short: '钻地破土', cdKey: 'skill3', meta: SS[2] ? sMeta(2) : [], desc: SS[2].description,
    tip: '在地下钻到对手脚下再按 3 破土，挑飞以后接左键或千影杀。也能拿来躲大招。' },
  { id: 'chain_hook', key: '4', name: SS[3].name, icon: SS[3].icon, short: '拽到身前', cdKey: 'skill4', meta: sMeta(3), desc: SS[3].description,
    tip: '专治风筝的沈惊鸿：钩过来直接三连。' },
  { id: 'thousand_shadows', key: 'R', name: SS[4].name, icon: SS[4].icon, short: '六影穿刺', cdKey: 'ultimate', super: true, meta: sMeta(4), desc: SS[4].description,
    tip: '施放全程无敌，可以拿来躲对手的大招，同时反打。' },
];
const ES = CLASS_CONFIGS.Emperor.skills;
const eMeta = (i: number) => [`MP ${ES[i].mpCost}`, `冷却 ${ES[i].cooldown}s`];
const EMPEROR_HOTBAR: HotbarEntry[] = [
  { id: 'e_attack', key: '左键', name: '天子剑', icon: '🗡️', short: '御剑三连', basic: true, meta: ['可连按', '第三剑击倒'],
    desc: '提天子剑三连斩，第三剑重劈把对手击倒。',
    tip: '三连斩把人击倒后，趁他起身接 1 横扫千军。' },
  { id: 'e_block', key: '右键', name: '格挡', icon: '🛡️', short: '减伤六成', basic: true, meta: ['按住生效', '移动变慢'],
    desc: '按住右键举剑格挡，正面受到的伤害减少60%，不会被打断。看准对手出手的瞬间按下能打出完美格挡。' },
  { id: 'edict', key: '1', name: ES[0].name, icon: ES[0].icon, short: '前方跪下', cdKey: 'skill1', meta: eMeta(0), desc: ES[0].description,
    tip: '跪下的人走不了也放不了技能：放完立刻接天子剑三连。' },
  { id: 'phantom_guard', key: '2', name: ES[1].name, icon: ES[1].icon, short: '虚影冲锋', cdKey: 'skill2', meta: eMeta(1), desc: ES[1].description,
    tip: '冲锋很宽，对手站在一条线上时一次撞飞好几个。' },
  { id: 'palace_cage', key: '3', name: ES[2].name, icon: ES[2].icon, short: '宫墙困人', cdKey: 'skill3', meta: eMeta(2), desc: ES[2].description,
    tip: '先把人圈住再走进去打，他的队友进不来救他。' },
  { id: 'jade_seal', key: '4', name: ES[3].name, icon: ES[3].icon, short: '玉玺砸地', cdKey: 'skill4', meta: eMeta(3), desc: ES[3].description,
    tip: '3 画地为牢圈住后接 4 玉玺镇压，墙里的人躲不开。' },
  { id: 'royal_guard', key: '5', name: ES[5].name, icon: ES[5].icon, short: '四人护驾', cdKey: 'skill5', meta: eMeta(5), desc: ES[5].description,
    tip: '先放 5 再放 3 画地为牢：墙里只有你和他，你的御林军守在墙外。' },
  { id: 'true_dragon', key: 'R', name: ES[4].name, icon: ES[4].icon, short: '金龙俯冲', cdKey: 'ultimate', super: true, meta: eMeta(4), desc: ES[4].description,
    tip: '1 让人跪下后放 R，金龙落下时他还动不了。' },
];
const TS = CLASS_CONFIGS.Trader.skills;
const tMeta = (i: number) => [`MP ${TS[i].mpCost}`, `冷却 ${TS[i].cooldown}s`];
const TRADER_HOTBAR: HotbarEntry[] = [
  { id: 't_attack', key: '左键', name: '钱箱子', icon: '💼', short: '钱箱三连', basic: true, meta: ['可连按', '第三下击倒'],
    desc: '抡起装满现金的铝箱子三连砸，第三下把人砸倒。被动「复利」：每打中一下，之后的伤害多 4%，最多 +40%，自己挨打就清零。',
    tip: '复利叠起来以后伤害很高：先用 1 甩劳力士、2 撒钱把层数打上去，再贴身砸。' },
  { id: 't_block', key: '右键', name: '格挡', icon: '🛡️', short: '减伤六成', basic: true, meta: ['按住生效', '移动变慢'],
    desc: '按住右键举起箱子挡，正面伤害减少60%。看准对手出手的瞬间按下能打出完美格挡。' },
  { id: 'rolex_throw', key: '1', name: TS[0].name, icon: TS[0].icon, short: '远程砸人', cdKey: 'skill1', meta: tMeta(0), desc: TS[0].description,
    tip: '会自己拐弯追人，中远距离先甩一块再冲上去。' },
  { id: 'make_it_rain', key: '2', name: TS[1].name, icon: TS[1].icon, short: '白日梦', cdKey: 'skill2', meta: tMeta(1), desc: TS[1].description,
    tip: '组队时撒进对面人堆里，他们会自己打起来；一打一时对手乱走，正好接三连。' },
  { id: 'patagonia', key: '3', name: TS[2].name, icon: TS[2].icon, short: '滑翔回血', cdKey: 'skill3', meta: tMeta(2), desc: TS[2].description,
    tip: '被围住或残血时往外飞，8 秒内边滑翔边回血；再按一次 3 收起马甲，也会停止回血。' },
  { id: 'short_sell', key: '4', name: TS[3].name, icon: TS[3].icon, short: '掉血易伤', cdKey: 'skill4', meta: tMeta(3), desc: TS[3].description,
    tip: '先做空再开大，黑色星期一多三成多伤害，掉的血还给你回血。' },
  { id: 'black_monday', key: 'R', name: TS[4].name, icon: TS[4].icon, short: '红K砸盘', cdKey: 'ultimate', super: true, meta: tMeta(4), desc: TS[4].description,
    tip: '对手被撒的钱滑倒时放，最后那根巨型阴线基本躲不开。' },
];
const HOTBAR_BY_CLASS: Partial<Record<CharacterClassId, HotbarEntry[]>> = { Berserker: BERSERKER_HOTBAR, Ranger: RANGER_HOTBAR, BuddhistMage: MONK_HOTBAR, Shadowblade: SHADOW_HOTBAR, Emperor: EMPEROR_HOTBAR, Trader: TRADER_HOTBAR };
const PLAYABLE: CharacterClassId[] = ['Berserker', 'Ranger', 'BuddhistMage', 'Shadowblade', 'Emperor', 'Trader'];

export default function App() {
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const closeMaterials = useCallback(() => setMaterialsOpen(false), []);
  const storyDialog = React.useSyncExternalStore(storySubscribe, storySnapshot);
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
  const [pointerLockFailed, setPointerLockFailed] = useState(false);

  const [skillCard, setSkillCard] = useState<string | null>(null);
  const [adventureRun, setAdventureRun] = useState(0);
  const [adventureMode, setAdventureMode] = useState(false);
  const [mapId, setMapId] = useState<MapId>('temple');
  const [isMapSelectOpen, setIsMapSelectOpen] = useState(true);
  const isMapSelectOpenRef = useRef(true);
  isMapSelectOpenRef.current = isMapSelectOpen;
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
    if (getAccount()) renameAccount(v).catch(() => {}); // the 战绩 board shows the new name too
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
    gameAudio.setAmbience(mapId === 'lavacliff' || mapId === 'sea' || mapId === 'glacier' || mapId === 'rooftop' || mapId === 'summit' || mapId === 'forest' ? mapId : mapId === 'desert' || mapId === 'plankway' ? (mapId === 'plankway' ? 'summit' : 'glacier') : 'temple');
  }, [mapId]);
  // ---------- online 1v1 ----------
  const [net, setNet] = useState<NetSession | null>(null);
  const [autoDpr, setAutoDpr] = useState<number | null>(null);
  const netRef = useRef<NetSession | null>(null);
  const [, setNetTick] = useState(0);
  const [joinCode, setJoinCode] = useState('');
  const cfgKeyRef = useRef('');
  const online = !!net && net.status === 'connected';
  // ---------- the room: four seats, two a side (offline too: the other seats are AIs or empty) ----------
  const [room, setRoom] = useState<RoomSeat[]>(() => defaultRoom('Berserker', '', 'Berserker'));
  // While the lobby covers the screen, the 3D scene behind it isn't drawn until its shaders have compiled in the
  // background: drawing it forced every shader to compile on the spot and froze the page for seconds
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    if (sceneReady) return;
    const t0 = performance.now();
    const id = setInterval(() => {
      const st = String((globalThis as any).__TQ_SHADERS ?? '');
      if (st.startsWith('ready') || performance.now() - t0 > 20000) setSceneReady(true);
    }, 250);
    return () => clearInterval(id);
  }, [sceneReady]);
  (globalThis as any).__TQ_HIDE_SCENE = !sceneReady && isMapSelectOpen; // read by Game every frame
  // download the heroes on show straight away, in parallel with the 3D scene starting up
  useEffect(() => {
    const extra: CharacterClassId[] = mapId === 'rooftop' ? ['Emperor', 'Guard'] : []; // 长安's court
    prefetchHeroModels([playerClass, ...room.filter((r) => r.kind !== 'empty').map((r) => r.cls), ...extra]);
  }, [playerClass, room, mapId]);
  const roomRef = useRef(room);
  roomRef.current = room;
  const localSeat = net && net.role === 'guest' ? room.findIndex((s) => s.kind === 'guest' && s.id === net.myId) : 0;
  const lineupKey = JSON.stringify(room.map((s) => [s.kind, s.id, s.cls, s.name])) + '|' + localSeat;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lineup = useMemo(() => {
    if (adventureMode && !net) return {
      seats: [
        { cls: 'Berserker', side: 0, ctl: 'local', name: nickname || '侠客' },
        { cls: 'Berserker', side: 1, ctl: 'ai', name: '试炼守卫' },
      ] as import('./types').FighterSeat[], me: 0, seatOf: [0, 2],
    };
    const l = lineupOf(room, Math.max(0, localSeat), mapId);
    // nobody on one side (the last AI was just taken out in the lobby): the scene behind the lobby still needs an
    // opponent to look at, so a stand-in fills the gap until someone is seated (the match can't start like this)
    for (const sd of [0, 1])
      if (!l.seats.some((x) => x.side === sd)) {
        l.seats.splice(l.seats.filter((x) => x.side !== 2).length, 0, { cls: 'Berserker', side: sd, ctl: 'ai', name: aiName('Berserker') });
        l.seatOf.push(-1);
      }
    return l;
  }, [lineupKey, mapId, adventureMode, net, nickname]);
  const teamFight = lineup.seats.length > 2;
  const lineupRef = useRef(lineup);
  lineupRef.current = lineup;
  // 战绩: when the current round started, and the damage dealt so far then
  const roundStartRef = useRef({ t: Date.now(), dmg: 0 });
  const [toast, setToast] = useState<{ n: number; text: string }>({ n: 0, text: '' });

  // Versus mode: 霍岩影 fights back (toggle in pause menu or press P)
  const aiEnabledRef = useRef(true);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [score, setScore] = useState({ player: 0, enemy: 0 });
  const [roundBanner, setRoundBanner] = useState<null | 'player' | 'enemy' | 'draw'>(null);
  const [bannerReason, setBannerReason] = useState('');
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
    if (n && n.role === 'host' && e.type !== 'playerHit' && e.type !== 'toast') n.send({ t: 're', e });
    if (e.type === 'ko' || e.type === 'draw') {
      // 战绩: one finished round (versus the AI or online; never the training dummy)
      const L = lineupRef.current;
      const meSeat = L.seats[L.me];
      const foeSeat = L.seats.find((x) => x.side !== meSeat?.side && x.side !== 2) ?? L.seats.find((x) => x !== meSeat);
      const isOnline = !!netRef.current && netRef.current.status === 'connected';
      if (meSeat && foeSeat && (aiEnabledRef.current || isOnline)) {
        const st = roundStartRef.current;
        const p1 = p1RefState.current;
        const won = e.type === 'ko' ? (e.winner === 'player' ? 1 : 0) : 2;
        reportRound(nicknameRef.current, {
          hero: meSeat.cls,
          foe: foeSeat.cls,
          map: mapIdRef.current,
          mode: isOnline ? 'online' : getSettings().aiLevel,
          result: won as 0 | 1 | 2,
          dur: (Date.now() - st.t) / 1000,
          dmg: Math.max(0, (p1?.totalDamageDealt ?? 0) - st.dmg),
        }).then((r) => {
          if (r && r.gain) setToast((t) => ({ n: t.n + 1, text: `修为 +${r.gain} · 等级 ${r.level}` }));
        });
      }
    }
    if (e.type === 'reset') roundStartRef.current = { t: Date.now(), dmg: p1RefState.current?.totalDamageDealt ?? 0 };
    if (e.type === 'ko') {
      setRoundBanner(e.winner);
      setBannerReason(e.reason ?? '');
      setScore((s) => ({ ...s, [e.winner]: s[e.winner] + 1 }));
    } else if (e.type === 'draw') {
      setRoundBanner('draw');
      setBannerReason(e.reason ?? '');
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
      adventure.stop();
      setAdventureMode(false);
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
      n.onGuests = () => {
        setRoom((r) => seatGuests(r, [...n.guests.values()].map((g) => ({ id: g.id, cls: g.cls, name: g.name })), !isMapSelectOpenRef.current));
      };
      n.onMessage = (m: NetMessage) => {
        if (m.t === 'room' && n.role === 'guest') {
          setRoom(padRoom(m.seats));
          if (m.map) setMapId(m.map);
        } else if (m.t === 'cfg' && n.role === 'guest') {
          if (m.hostName) n.remoteName = m.hostName.slice(0, 12);
          if (m.seats) setRoom(padRoom(m.seats));
          setMapId(m.map);
          setRoundBanner(null);
          setIsMapSelectOpen(false);
        } else if (m.t === 're' && n.role === 'guest') {
          const e = m.e as RoundEvent;
          // who won is told by side; ours is our seat's
          if (e.type === 'ko') {
            const mine = roomRef.current.findIndex((s) => s.kind === 'guest' && s.id === n.myId);
            const side = e.side ?? (e.winner === 'player' ? 0 : 1);
            handleRoundEvent({ type: 'ko', winner: side === SEAT_SIDE[Math.max(0, mine)] ? 'player' : 'enemy', side, reason: e.reason });
          } else handleRoundEvent(e);
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
  // host / offline: seat 0 is us
  useEffect(() => {
    if (net && net.role === 'guest') return;
    setRoom((r) => (r[0].kind === 'host' && r[0].cls === playerClass && r[0].name === nickname ? r : [{ kind: 'host', cls: playerClass, name: nickname }, ...r.slice(1)]));
  }, [net, playerClass, nickname]);
  // host: everyone in the room sees the seats; once the match is on, the match config goes out on every change
  const roomSentRef = useRef('');
  useEffect(() => {
    if (!net || net.role !== 'host' || net.status !== 'connected') return;
    const rk = `${lineupKey}|${mapId}|${isMapSelectOpen}|${net.guests.size}`;
    if (rk !== roomSentRef.current) {
      roomSentRef.current = rk;
      net.send({ t: 'room', seats: room, map: mapId, started: !isMapSelectOpen });
    }
    const key = `${mapId}|${lineupKey}|${isMapSelectOpen}|${nickname}`;
    if (!isMapSelectOpen && key !== cfgKeyRef.current) {
      cfgKeyRef.current = key;
      net.send({ t: 'cfg', map: mapId, seq: Date.now(), hostName: nickname, seats: room });
    }
    if (isMapSelectOpen) cfgKeyRef.current = '';
  });
  // a new arrival: send them the room straight away
  useEffect(() => {
    if (net && net.role === 'host') roomSentRef.current = '';
  }, [net, net?.guests.size]);

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
  // the HUD poller below runs in a long-lived interval: read the map through a ref, never a stale closure
  const mapIdRef = useRef(mapId);
  mapIdRef.current = mapId;
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
    enabled: gameState.status === 'PLAYING' && !storyDialog && !materialsOpen,
    onToggleDebug: handleToggleDebug,
    onToggleHelp: handleToggleHelp,
    onEscape: handleEscape,
  });

  // Trigger Blood Rage Edge Flash
  // the opponent's name tag follows their head every frame by moving the element directly (no React render)
  const foeTagRef = useRef<HTMLDivElement>(null);
  const moveFoeTag = useCallback((x: number, y: number) => {
    const el = foeTagRef.current;
    if (el) {
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }
  }, []);
  // team fights: a name tag over every other fighter, moved directly every frame
  const tagEls = useRef<(HTMLDivElement | null)[]>([]);
  const moveTags = useCallback((tags: ({ x: number; y: number } | null)[]) => {
    tags.forEach((t, k) => {
      const el = tagEls.current[k];
      if (!el) return;
      if (!t) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.style.left = t.x + 'px';
      el.style.top = t.y + 'px';
    });
  }, []);
  const [roster, setRoster] = useState<{ name: string; side: number; hp: number; maxHp: number; cls: CharacterClassId; target: boolean; revive: number; canRevive: boolean }[]>([]);
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
        skill5: 0,
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

  const p1RefState = useRef<CombatantState>(createCombatant('f0', true));
  useEffect(() => {
    // a match starts: the 战绩 clock for its first round
    if (!isMapSelectOpen) roundStartRef.current = { t: Date.now(), dmg: p1RefState.current?.totalDamageDealt ?? 0 };
  }, [isMapSelectOpen]);
  const dummyRefState = useRef<CombatantState>(createCombatant('f1', false));
  // every fighter of the match, slot order (2 to 4); slot 0 and 1 reuse the two above
  const fightersRef = useRef<CombatantState[]>([p1RefState.current, dummyRefState.current]);
  if (fightersRef.current.length !== lineup.seats.length) {
    const pool = [p1RefState.current, dummyRefState.current, ...fightersRef.current];
    const next: CombatantState[] = [];
    for (let k = 0; k < lineup.seats.length; k++) next.push(pool.find((c) => c.id === `f${k}`) ?? createCombatant(`f${k}`, false));
    fightersRef.current = next;
  }
  fightersRef.current.forEach((c, k) => {
    c.isPlayer = k === lineup.me;
    c.side = lineup.seats[k].side;
    c.tag = lineup.seats[k].name;
  });
  if (!fightersRef.current.includes(p1RefState.current) || p1RefState.current !== fightersRef.current[lineup.me]) p1RefState.current = fightersRef.current[lineup.me];
  if (!fightersRef.current.includes(dummyRefState.current) || dummyRefState.current === p1RefState.current)
    dummyRefState.current = fightersRef.current.find((c) => (c.side ?? 0) !== (p1RefState.current.side ?? 0)) ?? fightersRef.current[lineup.me === 0 ? 1 : 0];
  // Debug handle (used by automated visual tests; harmless in production)
  (globalThis as any).__TQ = { p1: p1RefState, dummy: dummyRefState, input: inputRef, ai: aiEnabledRef, rt: mapRuntime, net: netRef, fighters: fightersRef, maps: MapsAll, banker: BankerAll };
  const targetingRefState = useRef<TargetingState>({
    lockedEnemyId: null,
    friendlyTargetId: null,
  });

  useEffect(() => { if (nickname) startCloud(nickname); }, [nickname]);

  // HUD sync states
  // who's playing: a heartbeat for admin.html (nickname, screen, map, class, match type)
  useEffect(() => {
    startPresence(typeof __BUILD__ !== 'undefined' ? __BUILD__ : '');
    // a newer version deployed while this page is open (GitHub Pages caches the page for up to 10 minutes):
    // reload by itself if we're in the lobby and not in a room, otherwise say so
    const checkVersion = () =>
      fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => {
          if (!v?.build || v.build === __BUILD__) return;
          setNewBuild(v.build);
        })
        .catch(() => {});
    checkVersion();
    const vt = window.setInterval(checkVersion, 60000);
    return () => window.clearInterval(vt);
  }, []);
  const [newBuild, setNewBuild] = useState('');
  useEffect(() => {
    setPresence({
      name: nickname || '无名',
      page: isMapSelectOpen ? 'lobby' : 'game',
      map: MAPS[mapId]?.name ?? mapId,
      cls: CLASS_CONFIGS[playerClass]?.name ?? playerClass,
      mode: (net ? net.role : aiEnabled ? 'ai' : 'dummy') + ` ${[0, 1].map((sd) => lineup.seats.filter((x) => x.side === sd).length).join('v')}`,
      room: net?.code || undefined,
      vs: lineup.seats.filter((_, k) => k !== lineup.me).map((x) => x.name).join('、') || undefined,
    });
  });
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
    cdSkill5: 0,
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
    sand: 0,
    sandWarn: 0,
    beacon: 0,
    beaconT: 0,
    scope: 0,
    swarmLeft: 0,
    swarm: 0,
    p1Indoor: false,
    seal: 0,
    sealT: 0,
    sealWho: '',
    sealMine: false,
    fps: 0,
    ping: 0,
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
      if (locked) setPointerLockFailed(false);
    };
    const onError = () => setPointerLockFailed(true);
    document.addEventListener('pointerlockerror', onError);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    return () => {
      document.removeEventListener('pointerlockerror', onError);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
    };
  }, []);

  // Sync HUD state from refs periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const p1 = p1RefState.current;
      const dummy = dummyRefState.current;
      const all = fightersRef.current;
      if (all.length > 2) setRoster(all.map((c) => ({ name: c.tag || c.name, side: c.side ?? 0, hp: Math.max(0, c.hp), maxHp: c.maxHp, cls: c.classId, target: c === dummy, revive: (c.reviveT ?? 0) / 3, canRevive: canRevive(c) })));
      else setRoster((r) => (r.length ? [] : r));
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
        cdSkill5: p1.cooldowns.skill5 || 0,
        cdUlt: p1.cooldowns.ultimate || 0,
        cdSpecial: p1.cooldowns.special || 0,
        p1Stamina: p1.stamina ?? 100,
        p1Poisoned: (p1.poisonTimer || 0) > 0,
        p1Rooted: (p1.rootTimer || 0) > 0,
        p1Climb: !!p1.climbing,
        p1Swim: !!p1.swimming,
        p1Ladder: !!p1.nearLadder,
        p1Grip: mapIdRef.current === 'forest' ? p1.grip ?? 1 : 1,
        fps: (globalThis as any).__TQ_PERF?.fps ?? 0,
        ping: Math.round(netRef.current?.pingMs ?? 0),
        p1Hint: p1.reviveHint || p1.interactHint || '',
        p1Candle: mapIdRef.current === 'forest' ? p1.candle ?? 0 : 0,
        p1Shade: !!p1.shade,
        night: mapIdRef.current === 'forest' ? mapRuntime.night : 0,
        sand: mapIdRef.current === 'desert' ? mapRuntime.desert.sand : 0,
        sandWarn: mapIdRef.current === 'desert' ? mapRuntime.desert.warn : 0,
        beacon: mapIdRef.current === 'desert' && mapRuntime.desert.beaconSide >= 0 ? (mapRuntime.desert.beaconSide === (p1.side ?? 0) ? 1 : -1) : 0,
        beaconT: mapRuntime.desert.beaconT,
        scope: p1.scope ?? 0,
        swarmLeft: mapIdRef.current === 'desert' ? mapRuntime.desert.swarmLeft : 0,
        swarm: mapIdRef.current === 'desert' ? mapRuntime.desert.swarm : 0,
        seal: mapIdRef.current === 'rooftop' ? mapRuntime.seal?.state ?? 0 : 0,
        sealT: mapRuntime.seal?.t ?? 0,
        sealWho: mapRuntime.seal?.state === 2 ? (fightersRef.current[mapRuntime.seal.holder] === p1 ? '你' : fightersRef.current[mapRuntime.seal.holder]?.tag || '有人') : '',
        sealMine: mapRuntime.seal?.state === 2 && (fightersRef.current[mapRuntime.seal.holder]?.side ?? -1) === (p1.side ?? 0),
        p1Indoor: mapIdRef.current === 'desert' && desertIndoor(p1.pos[0], p1.pos[2], p1.pos[1]),
        foeHidden: !!dummyScreenPosRef.current.hidden,
        p1Slip: mapIdRef.current === 'forest' ? p1.slip ?? 0 : 0,
        rain: mapIdRef.current === 'forest' ? mapRuntime.rain : 0,
        storm: mapIdRef.current === 'forest' ? mapRuntime.storm : 0,
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
          (promise as Promise<void>).catch(() => setPointerLockFailed(true));
        }
      } catch {
        setPointerLockFailed(true);
      }
    } else setPointerLockFailed(true);
    setIsHowToPlayOpen(false);
    setIsGameMenuOpen(false);
    gameAudio.playCrispClick();
  };

  const startAdventure = (experimental = false) => {
    if (net) return;

            adventure.start(experimental);
            setAdventureMode(true);
            setAdventureRun(n => n + 1);
            setPlayerClass('Berserker');
            if (!aiEnabledRef.current) toggleAI();
            setMapId(experimental ? 'experimental' : 'quarry');
            setRoundBanner(null);
            setIsGameMenuOpen(false);
            setIsMapSelectOpen(false);
            requestGameFocus();
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
      {(!nickname || editingName) && (
        <NameGate value={nameDraft} onChange={setNameDraft} onSubmit={() => saveNickname(nameDraft)} onCancel={editingName && nickname ? () => setEditingName(false) : undefined} />
      )}

      {/* LOBBY: hero, opponent, battlefield */}
      {isMapSelectOpen && (
        <Lobby
          adventurePanel={<AdventureHud lobby onOpen={() => setMaterialsOpen(true)} />}
          onAdventure={!net ? () => startAdventure() : undefined}
          onExperiment={!net ? () => startAdventure(true) : undefined}
          loadPct={modelProgress.isLoading ? modelProgress.progress : undefined}
          nickname={nickname}
          onRename={() => {
            setNameDraft(nickname);
            setEditingName(true);
          }}
          heroes={PLAYABLE}
          playerClass={playerClass}
          onPlayerClass={(cid) => {
            gameAudio.playCrispClick();
            setPlayerClass(cid);
            setScore({ player: 0, enemy: 0 });
          }}
          room={room}
          localSeat={localSeat}
          canEdit={!net || net.role === 'host'}
          ready={roomReady(room) && localSeat >= 0}
          onSeat={(k, ch) => {
            gameAudio.playCrispClick();
            setScore({ player: 0, enemy: 0 });
            setRoom((r) => {
              const out = r.map((x) => ({ ...x }));
              const st = out[k];
              if (ch.kind === 'ai') out[k] = { kind: 'ai', cls: st.cls, name: aiName(st.cls) };
              else if (ch.kind === 'empty' && st.kind === 'ai') out[k] = { kind: 'empty', cls: st.cls, name: '' };
              if (ch.cls && out[k].kind === 'ai') out[k] = { ...out[k], cls: ch.cls, name: aiName(ch.cls) };
              if (ch.swap) {
                const other = SIDE_SEATS[1 - SEAT_SIDE[k]];
                const j = other.find((n) => n !== 0 && out[n].kind === 'empty') ?? other.find((n) => n !== 0 && out[n].kind === 'ai') ?? other.find((n) => n !== 0);
                if (j !== undefined) [out[k], out[j]] = [out[j], out[k]];
              }
              return out;
            });
          }}
          online={!!net}
          aiEnabled={aiEnabled}
          onAI={(on) => {
            if (aiEnabledRef.current !== on) toggleAI();
          }}
          mapId={mapId}
          onSelectMap={() => gameAudio.playCrispClick()}
          onStart={(id) => {
            if (id === 'quarry' || id === 'experimental') { startAdventure(id === 'experimental'); return; }
            if (!MAPS[id].available) return;
            adventure.stop();
            setAdventureMode(false);
            gameAudio.playCrispClick();
            setMapId(id);
            setRoundBanner(null);
            setIsMapSelectOpen(false);
            requestGameFocus();
          }}
          hostPicks={net?.role === 'guest'}
          onlineBadge={!net ? '' : net.status === 'connected' ? '已连上' : net.status === 'error' ? '出错' : '等待中'}
          version={`版本 ${__BUILD__}`}
          onlinePanel={
            <div className="tq-on">
              {!net && (
                <>
                  <button className="tq-btn" onClick={() => startNet('host', makeRoomCode())}>
                    开房间
                  </button>
                  <div className="tq-on-row">
                    <input
                      className="tq-input"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5))}
                      placeholder="房间号"
                    />
                    <button className="tq-btn ghost" disabled={joinCode.length !== 5} onClick={() => startNet('guest', joinCode)}>
                      加入
                    </button>
                  </div>
                </>
              )}
              {net && (
                <>
                  {net.role === 'host' && (
                    <div className="tq-on-row">
                      房间号 <span className="tq-on-code">{net.code}</span>
                      <button className="tq-btn ghost" onClick={() => navigator.clipboard?.writeText(net.code)}>
                        复制
                      </button>
                    </div>
                  )}
                  {net.status === 'opening' && <div>正在连接联机服务器…</div>}
                  {net.status === 'waiting' && <div>把房间号发给朋友（最多 3 人），在这里输入就能加入。等人加入…{net.relayState && <div style={{ fontSize: 11 }}>{net.relayState}</div>}</div>}
                  {net.status === 'connecting' && (
                    <div>
                      正在加入房间 {net.code}…
                      <div style={{ fontSize: 11 }}>{net.relayState ? net.relayState : net.iceState === 'checking' ? '正在打通两台电脑之间的连接' : net.iceState === 'disconnected' ? '连接不稳定，重试中' : '正在联系房主'}</div>
                    </div>
                  )}
                  {net.status === 'connected' && net.role === 'host' && (
                    <div className="tq-on-ok">
                      已加入 {net.guests.size} 人：{[...net.guests.values()].map((g) => g.name || '侠客').join('、')}
                      <div style={{ fontSize: 11 }}>在下面「阵容」里安排两边的位置（空位可放 AI 或空着），选好战场就出征{net.guests.size < 3 ? ' · 还能再进 ' + (3 - net.guests.size) + ' 人' : ''}</div>
                    </div>
                  )}
                  {net.status === 'connected' && net.role === 'guest' && (
                    <div className="tq-on-ok">{localSeat >= 0 ? `已加入 · 你在${SEAT_SIDE[localSeat] === 0 ? '房主这边' : '房主对面'} · 选好侠客，等房主出征` : '已连上 · 房间满了或正在安排座位'}</div>
                  )}
                  {net.status === 'connected' && <div style={{ fontSize: 11 }}>{net.via === 'relay' ? '线路：中转（直连没打通，延迟高一些）' : '线路：直连'}</div>}
                  {net.status === 'error' && <div className="tq-on-err">{net.error}</div>}
                  <button className="tq-btn ghost" onClick={leaveNet}>
                    退出联机
                  </button>
                </>
              )}
            </div>
          }
        />
      )}

      {/* Round result banner */}
      {roundBanner && (
        <div className="absolute inset-0 pointer-events-none z-40 flex flex-col items-center justify-center gap-2" style={{ animation: 'tqBanner 3.1s ease-out forwards' }}>
          <span className={`text-6xl font-black italic tracking-widest drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)] ${roundBanner === 'player' ? 'text-amber-300' : roundBanner === 'draw' ? 'text-zinc-200' : 'text-sky-300'}`}>
            {roundBanner === 'player' ? '胜' : roundBanner === 'draw' ? '平' : '败'}
          </span>
          <span className="text-sm font-bold text-zinc-200 bg-black/60 px-3 py-1 rounded-full">
            {bannerReason ? bannerReason : teamFight ? (roundBanner === 'player' ? '对方全部倒下' : '我方全部倒下') : roundBanner === 'player' ? `${dummyRefState.current.tag || '对手'} 被击倒` : `你被${dummyRefState.current.tag || '对手'}击倒`} · {score.player} : {score.enemy} · 下一回合即将开始
          </span>
        </div>
      )}

      {/* Model Download Loading Overlay */}
      {/* in the lobby the models download in the background (出征 shows the progress); the full-screen bar only
          when a match is waiting on them, or on an error */}
      {modelProgress.isLoading && (!isMapSelectOpen || !!modelProgress.error) && (
        <LoadingScreen
          hero={`${CLASS_CONFIGS[playerClass]?.name ?? ''}·${(CLASS_CONFIGS[playerClass] as any)?.defaultCharacter ?? ''}`}
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
          fallback={null}
        >
          <Canvas
            shadows
            dpr={autoDpr ?? QUALITY[settings.quality].dpr}
            gl={{ antialias: false, powerPreference: 'high-performance' }}
            camera={STATIC_CANVAS_CAMERA}
            className="w-full h-full block"
          >
            <Game
              key={adventureMode ? `adventure-${adventureRun}` : "competitive"}
              gameState={storyDialog || materialsOpen ? { ...gameState, status: 'PAUSED' } : gameState}
              setGameState={setGameState}
              inputRef={inputRef}
              p1RefState={p1RefState}
              dummyRefState={dummyRefState}
              fightersRef={fightersRef}
              seats={lineup.seats}
              meSlot={lineup.me}
              onTagsMove={teamFight ? moveTags : undefined}
              targetingRefState={targetingRefState}
              aiEnabledRef={aiEnabledRef}
              mapId={mapId}
              playerClass={playerClass}
              enemyClass={enemyClass}
              net={online ? net : null}
              onRoundEvent={handleRoundEvent}
              onVfxCountChange={setVfxCount}
              onDebugUpdate={isDebugOpen ? setDebugData : undefined}
              onAutoDpr={setAutoDpr}
              onDummyScreenPosUpdate={setDummyScreenPos}
              onBloodRageFlash={handleBloodRageFlash}
              onAnimationDebug={isDebugOpen ? setAnimDebugInfo : undefined}
              onFoeTagMove={moveFoeTag}
              onLoadProgress={setModelProgress}
            />
          </Canvas>
        </Suspense>

        {/* 穿云狙 scope: dark ring round a clear circle, crosshair, how long it has been steady */}
        {hudMirror.scope > 0 && (
          <div className="absolute inset-0 z-30 pointer-events-none">
            <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 50% 50%, transparent 0, transparent 34vmin, rgba(0,0,0,0.92) 35vmin)' }} />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ width: '70vmin', height: '70vmin', border: '2px solid rgba(0,0,0,0.85)', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.6)' }} />
            <div className="absolute left-1/2 top-1/2 -translate-y-1/2 bg-black/80" style={{ width: '70vmin', height: 1, transform: 'translate(-50%,-50%)' }} />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 bg-black/80" style={{ height: '70vmin', width: 1, transform: 'translate(-50%,-50%)' }} />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-red-500/90" style={{ width: 10, height: 10 }} />
            <div className="absolute left-1/2 -translate-x-1/2 text-center" style={{ top: 'calc(50% + 37vmin)' }}>
              <div className="w-48 h-1.5 bg-zinc-900 rounded-full overflow-hidden mx-auto">
                <div className={`h-full ${hudMirror.scope >= 1.5 ? 'bg-amber-300' : 'bg-zinc-300'}`} style={{ width: `${Math.min(1, hudMirror.scope / 1.5) * 100}%` }} />
              </div>
              <div className="text-xs font-bold text-zinc-200 mt-1">{hudMirror.scope >= 1.5 ? '瞄满 · 左键开火必定暴击' : '稳住…左键开火'} · 4 / 右键收起</div>
            </div>
          </div>
        )}
        {/* interaction prompt: appears only while you're standing at something F works on */}
        {hudMirror.p1Hint && !isGameMenuOpen && !isMapSelectOpen && (
          <div className="tq-hint absolute left-1/2 -translate-x-1/2 bottom-44 z-30 pointer-events-none">
            <div className="tq-fkey-cap">F</div>
            <span>{hudMirror.p1Hint.replace(/^按住? ?F ?/, '')}</span>
            {/^按住/.test(hudMirror.p1Hint) && <em>按住</em>}
          </div>
        )}
        {teamFight && !roundBanner && hudMirror.p1Hp <= 0 && roster.some((r, k) => k !== lineup.me && r.hp > 0 && r.side === (lineup.seats[lineup.me]?.side ?? 0)) && (
          <div className="absolute left-1/2 -translate-x-1/2 top-24 z-30 pointer-events-none bg-black/70 border border-zinc-600/70 rounded-lg px-4 py-1.5 text-center">
            <div className="text-sm font-black text-zinc-100 tracking-widest">观战队友</div>
            <div className="text-[11px] text-zinc-400">
              {roster[lineup.me]?.canRevive ? (roster[lineup.me].revive > 0 ? `队友正在扶你 ${Math.round(Math.min(1, roster[lineup.me].revive) * 100)}%` : '队友站到你身边按住 F 能把你扶起来') : '当前无法扶起 · 等待重生或回合结束'}
            </div>
          </div>
        )}
        {/* off-screen opponent: an arrow on the screen edge pointing at them, with the distance */}
        {!adventureMode && mapId === 'forest' && !isGameMenuOpen && !isHowToPlayOpen && !isMapSelectOpen && !modelProgress.isLoading && <ShrineHud />}
        {adventureMode && !isGameMenuOpen && !isHowToPlayOpen && !isMapSelectOpen && !modelProgress.isLoading && <AdventureHud onOpen={() => setMaterialsOpen(true)} />}
        {storyDialog && <StoryDialog />}
        {materialsOpen && <MaterialCodex onClose={closeMaterials} />}
        {mapId === 'losangeles' && !isGameMenuOpen && !isHowToPlayOpen && !isMapSelectOpen && !modelProgress.isLoading && <LootHud />}
        {mapId === 'losangeles' && !isGameMenuOpen && !isHowToPlayOpen && !isMapSelectOpen && !modelProgress.isLoading && <QuestHud />}
        {(mapId === 'forest' || mapId === 'desert' || mapId === 'wending' || mapId === 'losangeles') && !isGameMenuOpen && !isHowToPlayOpen && !isMapSelectOpen && !modelProgress.isLoading && <Minimap mapId={mapId} fighters={fightersRef} me={lineup.me} />}
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
        {teamFight &&
          !isGameMenuOpen &&
          !isMapSelectOpen &&
          roster.map((r, k) =>
            k === lineup.me ? null : (
              <div
                key={k}
                ref={(el) => {
                  tagEls.current[k] = el;
                }}
                className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full z-20 flex flex-col items-center gap-0.5"
                style={{ display: 'none' }}
              >
                <div
                  className={`flex items-center gap-1 bg-black/80 px-2 py-0.5 rounded-full border text-[11px] font-bold shadow-lg ${
                    r.side === (lineup.seats[lineup.me]?.side ?? 0) ? 'border-emerald-400/60 text-emerald-200' : 'border-red-500/60 text-red-300'
                  }`}
                >
                  <span>{r.side === 2 ? '皇' : r.side === (lineup.seats[lineup.me]?.side ?? 0) ? '友' : '敌'} · {r.name}</span>
                  {r.target && r.side !== (lineup.seats[lineup.me]?.side ?? 0) && <span className="text-yellow-300 text-[10px]">◎</span>}
                </div>
                {r.hp <= 0 ? (
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-[10px] font-bold text-zinc-300 bg-black/70 px-1.5 rounded">
                      {r.canRevive && r.side === (lineup.seats[lineup.me]?.side ?? 0) ? '倒下 · 站过去按住 F 扶起' : '倒下'}
                    </span>
                    {r.revive > 0 && (
                      <div className="w-28 h-1.5 bg-zinc-950 rounded-full overflow-hidden border border-amber-300/60">
                        <div className="h-full bg-amber-300" style={{ width: `${Math.min(1, r.revive) * 100}%` }} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-28 h-2 bg-zinc-950 rounded-full border border-zinc-500/70 overflow-hidden">
                    <div
                      className={`h-full ${r.side === 2 ? 'bg-amber-400' : r.side === (lineup.seats[lineup.me]?.side ?? 0) ? 'bg-emerald-400' : 'bg-red-500'}`}
                      style={{ width: `${(r.hp / Math.max(1, r.maxHp)) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            )
          )}
        {!teamFight && dummyScreenPos.visible && !isGameMenuOpen && !isHowToPlayOpen && (
          <div
            ref={foeTagRef}
            className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full z-20 flex flex-col items-center gap-1"
            style={{
              left: `${dummyScreenPos.screenX}px`,
              top: `${dummyScreenPos.screenY}px`,
            }}
          >
            <div className="flex items-center gap-1 bg-black/85 px-2.5 py-0.5 rounded-full border border-red-500/50 text-[11px] font-bold text-red-300 shadow-lg">
              <span>{aiEnabled ? `${dummyRefState.current.tag || '对手'} · 对手` : `演武木桩 · ${dummyRefState.current.tag || ''}`}</span>
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
      {!isPointerLocked && !isMapSelectOpen && !isGameMenuOpen && !isHowToPlayOpen && !modelProgress.isLoading && (
        <div
          onClick={requestGameFocus}
          className="absolute top-20 inset-x-0 mx-auto w-fit bg-black/80 hover:bg-amber-950/90 border border-amber-500/60 rounded-full px-5 py-2 z-30 flex items-center gap-2 cursor-pointer transition-all shadow-xl hover:scale-105"
        >
          <MousePointer className="w-4 h-4 text-amber-400 animate-bounce" />
          <span className="text-xs font-bold text-amber-300">
            {pointerLockFailed ? '鼠标锁定不可用：在场景内移动鼠标转视角 · 点击重试' : '在场景内移动鼠标转视角 · 点击锁定 · WASD 移动'}
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
          if (hudMirror.p1Candle) meChips.push({ text: (hudMirror.p1Candle === 2 ? (hudMirror.p1Shade ? '蜡烛 · 灯罩护火' : '蜡烛 已点燃') : '蜡烛 已熄灭') + ' · F 放下', tone: hudMirror.p1Candle === 2 ? 'gold' : 'slate' });
          else if (hudMirror.p1Shade) meChips.push({ text: '灯罩 · F 放下', tone: 'gold' });
          if (hudMirror.night > 0.55 && hudMirror.foeHidden) meChips.push({ text: '天黑 看不见对手', tone: 'slate' });
          if (hudMirror.swarmLeft > 0) meChips.push({ text: hudMirror.p1Indoor ? `飞虫沙暴 ${Math.ceil(hudMirror.swarmLeft)}s · 你在屋里，安全` : `飞虫沙暴 ${Math.ceil(hudMirror.swarmLeft)}s · 快躲进营房或城门洞！`, tone: hudMirror.p1Indoor ? 'slate' : 'red', pulse: !hudMirror.p1Indoor });
          else if (hudMirror.swarm > 0.5) meChips.push({ text: hudMirror.p1Indoor ? '虫群过境 · 别出屋' : '虫群过境！', tone: 'red', pulse: true });
          if (hudMirror.sand > 0.55 && !(hudMirror.swarm > 0.5)) meChips.push({ text: '沙暴 · 远处看不清 · 进城躲风', tone: 'amber', pulse: true });
          else if (hudMirror.sandWarn > 0 && hudMirror.sandWarn < 1) meChips.push({ text: '沙暴将至', tone: 'amber' });
          if (hudMirror.beacon) meChips.push({ text: `${hudMirror.beacon > 0 ? '我方' : '敌方'}烽火 ${Math.ceil(hudMirror.beaconT)}s${hudMirror.beacon > 0 ? ' · 伤害 +12%' : ''}`, tone: hudMirror.beacon > 0 ? 'gold' : 'red', pulse: hudMirror.beacon < 0 });
          if (hudMirror.seal === 1) meChips.push({ text: '传国玉玺掉在屋顶上！快去抢', tone: 'gold', pulse: true });
          else if (hudMirror.seal === 2) meChips.push({ text: `${hudMirror.sealWho}手握玉玺 ${Math.min(30, hudMirror.sealT).toFixed(0)}/30 秒${hudMirror.sealMine ? ' · 守住' : ' · 快抢回来'}`, tone: hudMirror.sealMine ? 'gold' : 'red', pulse: !hudMirror.sealMine });
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
            name: aiEnabled || online ? dummyRefState.current.tag || `${ec.defaultCharacter}影` : '演武木桩',
            classId: hudMirror.dClass,
            className: `${ec.name} · ${lineup.seats[fightersRef.current.indexOf(dummyRefState.current)]?.ctl === 'ai' ? (aiEnabled ? 'AI' : '木桩') : '玩家'}`,
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
              {teamFight && (
                <div className="mt-1 flex flex-col gap-1 w-56">
                  {roster.map((r, k) =>
                    k === lineup.me || r.target || r.cls === 'Guard' ? null : (
                      <div key={k} className="flex items-center gap-2 bg-black/60 rounded-md px-2 py-1 border border-zinc-700/60">
                        <span className={`text-[10px] font-black ${r.side === (lineup.seats[lineup.me]?.side ?? 0) ? 'text-emerald-300' : 'text-red-300'}`}>
                          {r.side === 2 ? '皇' : r.side === (lineup.seats[lineup.me]?.side ?? 0) ? '友' : '敌'}
                        </span>
                        <span className="text-[11px] text-zinc-200 font-bold truncate w-16">{r.name}</span>
                        <span className="text-[10px] text-zinc-400">{CLASS_CONFIGS[r.cls]?.name}</span>
                        <div className="flex-1 h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                          <div className={`h-full ${r.hp <= 0 ? '' : r.side === 2 ? 'bg-amber-400' : r.side === (lineup.seats[lineup.me]?.side ?? 0) ? 'bg-emerald-400' : 'bg-red-500'}`} style={{ width: `${(r.hp / Math.max(1, r.maxHp)) * 100}%` }} />
                        </div>
                        {r.hp <= 0 && <span className="text-[10px] text-zinc-500">倒下</span>}
                      </div>
                    )
                  )}
                </div>
              )}
            </>
          );
        })()}
      </div>

      {newBuild && (
        <button
          className="absolute top-1 right-1/2 translate-x-1/2 z-50 rounded-full bg-amber-400 px-4 py-1 text-xs font-bold text-black shadow-lg"
          style={{ top: 2 }}
          onClick={() => {
            location.href = location.pathname + '?v=' + encodeURIComponent(newBuild);
          }}
        >
          有新版本（{newBuild}），点这里刷新 · 联机时两边都要刷新
        </button>
      )}
      {/* TOP CENTER: arena and score */}
      <div className="absolute top-3 inset-x-0 z-20 pointer-events-none flex flex-col items-center gap-1.5">
        <div className="flex flex-col items-center bg-zinc-950/75 px-5 py-1.5 rounded-xl border border-zinc-700/70 shadow-md backdrop-blur-md">
          <span className="text-[10px] text-zinc-400 font-semibold tracking-wider">
            {MAPS[mapId].icon} {MAPS[mapId].name}
          </span>
          <span className="text-lg font-black text-amber-300 tracking-[0.25em] leading-tight">
            {aiEnabled || online ? `${score.player} : ${score.enemy}` : '自由试炼'}
          </span>
          <span className="text-[9px] text-zinc-500">{online ? '联机对战' : `${aiEnabled ? `AI ${AI_LEVELS[settings.aiLevel]?.name ?? '中等'} · ` : ''}P 切换${aiEnabled ? '木桩' : '对战'} · M 换地图`} · 版本 {__BUILD__}
            {hudMirror.fps > 0 && <span className={hudMirror.fps < 45 ? ' text-red-400' : ''}> · {hudMirror.fps} 帧</span>}
            {online && hudMirror.ping > 0 && (
              <span className={hudMirror.ping > 200 ? ' text-red-400' : ''}>
                {' '}· 延迟 {hudMirror.ping}ms
                {net?.path === 'lan' ? '（局域网直连）' : net?.path === 'p2p' ? '（直连）' : net?.path === 'turn' ? '（TURN 中转）' : net?.path === 'relay' || net?.via === 'relay' ? (net?.fastRelay ? '（天阙中转）' : '（公共服务器中转）') : ''}
                {net?.role === 'guest' ? ` · 同步 ${net.snapRate}/秒` : ''}
                {net?.fastRelay && net.relayRtt > 0 ? ` · 到中转 ${Math.round(net.relayRtt)}ms` : ''}
              </span>
            )}
          </span>
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
              h.cdKey === 'skill5' ? hudMirror.cdSkill5 :
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
                {aiEnabled ? '切换为木桩模式（不还手）' : `切换为对战模式（对手会还手）`} · P
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
