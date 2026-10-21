// 散人 (Wanderer): from level 30 in 百业试炼 an account that never chose its hero fights as a plain wanderer who has
// picked up one move from each house. Six of the seven moves below go on the keys 1 2 3 4 5 R; each lands at 80% and
// cools down 20% slower than in its owner's hands, and there is no ultimate. The game casts a borrowed move by turning
// the fighter into its owner for that one action (see executeIntent in Game.tsx).
import { CLASS_CONFIGS } from './components/CombatData';
import type { CharacterClassId, SkillDefinition } from './types';

export interface Borrowed {
  id: string;
  cls: CharacterClassId;
  /** the owner's input key for it, and its place in the owner's skill list */
  srcKey: string;
  idx: number;
  role: string;
}
export const WANDER_POOL: Borrowed[] = [
  { id: 'rolex_throw', cls: 'Trader', srcKey: 'skill1', idx: 0, role: '远程' },
  { id: 'pin_dart', cls: 'Ranger', srcKey: 'skill2', idx: 1, role: '控制' },
  { id: 'bull_charge', cls: 'Berserker', srcKey: 'skill3', idx: 2, role: '突进' },
  { id: 'vajra_palm', cls: 'BuddhistMage', srcKey: 'skill1', idx: 0, role: '击退' },
  { id: 'shadow_step', cls: 'Shadowblade', srcKey: 'skill1', idx: 0, role: '位移' },
  { id: 'jade_seal', cls: 'Emperor', srcKey: 'skill4', idx: 3, role: '范围砸地' },
  { id: 'qingfeng', cls: 'HeavyHealer', srcKey: 'skill1', idx: 0, role: '回血' },
];
export const WANDER_SLOTS = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'ultimate'] as const;
export const WANDER_LABEL: Record<string, string> = { skill1: '1', skill2: '2', skill3: '3', skill4: '4', skill5: '5', ultimate: 'R' };
export const WANDER = { dmg: 0.8, cd: 1.2 };
const DEFAULT = ['rolex_throw', 'pin_dart', 'bull_charge', 'vajra_palm', 'shadow_step', 'qingfeng'];
const KEY = 'tq_wanderer_loadout';

let loadout: string[] = DEFAULT;
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (Array.isArray(saved) && saved.length === 6 && saved.every((id) => WANDER_POOL.some((b) => b.id === id)) && new Set(saved).size === 6) loadout = saved;
} catch {
  /* private window: the default set */
}

export const getLoadout = () => loadout;
export const borrowedFor = (slot: string): Borrowed | null => {
  const k = WANDER_SLOTS.indexOf(slot as (typeof WANDER_SLOTS)[number]);
  return k < 0 ? null : WANDER_POOL.find((b) => b.id === loadout[k]) ?? null;
};
export const sourceSkill = (b: Borrowed): SkillDefinition => CLASS_CONFIGS[b.cls].skills[b.idx];

/** the 散人's skill list as the HUD and the game read it: the borrowed moves in slot order, cooldowns 20% longer */
function applyToConfig() {
  CLASS_CONFIGS.Wanderer.skills = loadout.map((id, k) => {
    const b = WANDER_POOL.find((x) => x.id === id)!;
    const s = sourceSkill(b);
    return { ...s, key: WANDER_LABEL[WANDER_SLOTS[k]], cooldown: +(s.cooldown * WANDER.cd).toFixed(1), isSuper: false, description: `借自${CLASS_CONFIGS[b.cls].name}：${s.description}（散人使用：伤害八成，冷却长两成）` };
  });
}
applyToConfig();

export function setLoadout(ids: string[]) {
  if (ids.length !== 6 || new Set(ids).size !== 6 || !ids.every((id) => WANDER_POOL.some((b) => b.id === id))) return false;
  loadout = [...ids];
  try {
    localStorage.setItem(KEY, JSON.stringify(loadout));
  } catch {
    /* kept for this session */
  }
  applyToConfig();
  return true;
}
