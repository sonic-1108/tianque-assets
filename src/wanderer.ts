// 新人 / 散人 (Wanderer): an account that has not 转职'd fights in one plain look with up to six 低阶 skills borrowed
// from any of the seven houses, on the keys 1 2 3 4 5 R. Each hits by its 百业 skill level (src/skilltree.ts) and
// keeps its owner's cooldown; there is no 高阶 skill and no ultimate. Changing to another house's weapon takes
// SWAP_TIME (instant with the 百变兵器). The game casts a borrowed move by turning the fighter into its owner for that
// one action (see executeIntent in Game.tsx).
import { CLASS_CONFIGS } from './components/CombatData';
import type { CharacterClassId, SkillDefinition } from './types';
import { LOW_SKILLS, SKILL_OWNER, SKILLS, levelOf, skillPower } from './skilltree';

export interface Borrowed {
  id: string;
  cls: CharacterClassId;
  /** the owner's input key for it, and its place in the owner's skill list */
  srcKey: string;
  idx: number;
}
/** every hero's 低阶 skills (the first three of its tree), in tree order */
export const WANDER_POOL: Borrowed[] = LOW_SKILLS.map((id: string) => {
  const cls = SKILL_OWNER[id] as CharacterClassId;
  const idx = CLASS_CONFIGS[cls].skills.findIndex((s) => s.id === id);
  const s = CLASS_CONFIGS[cls].skills[idx];
  return { id, cls, idx, srcKey: s?.isSuper ? 'ultimate' : `skill${idx + 1}` };
}).filter((b) => b.idx >= 0);
export const WANDER_SLOTS = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'ultimate'] as const;
export const WANDER_LABEL: Record<string, string> = { skill1: '1', skill2: '2', skill3: '3', skill4: '4', skill5: '5', ultimate: 'R' };
const KEY = 'tq_wanderer_loadout';

// ---------------------------------------------------------------- 外形: a young man or woman in plain undyed clothes
export type WanderLook = 'm' | 'f';
const LOOK_KEY = 'tq_wanderer_look';
let look: WanderLook = 'm';
try {
  if (localStorage.getItem(LOOK_KEY) === 'f') look = 'f';
} catch {
  /* private window */
}
export const getLook = () => look;
export function setLook(l: WanderLook) {
  look = l;
  try {
    localStorage.setItem(LOOK_KEY, l);
  } catch {
    /* this session */
  }
}
/** his / her own model (public/wanderer_m.glb, wanderer_f.glb: Tripo + Mixamo, like the heroes); until it's uploaded a
 *  young hero's body stands in, its clothes washed to undyed hemp in the shader */
export const LOOK_MODEL: Record<WanderLook, string> = { m: 'wanderer_m.glb', f: 'wanderer_f.glb' };
export const LOOK_STANDIN: Record<WanderLook, string> = { m: 'shadowblade.glb', f: 'ranger.glb' };
export const lookPortrait = (l: WanderLook = look) => `portraits/wanderer_${l}.png`;
const EMPTY: SkillDefinition = { id: 'none', name: '空', key: '-', description: '这一格还没放技能：在百业试炼里学会低阶技能后放上来。', mpCost: 0, cooldown: 0, icon: '·' };

/** six slots, '' = empty */
let loadout: string[] = ['', '', '', '', '', ''];
try {
  const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (Array.isArray(saved)) loadout = WANDER_SLOTS.map((_, k) => (WANDER_POOL.some((b) => b.id === saved[k]) ? saved[k] : ''));
} catch {
  /* private window */
}

export const getLoadout = () => loadout;
/** the borrowed move on a slot, if it is set and learned */
export const borrowedFor = (slot: string): Borrowed | null => {
  const k = WANDER_SLOTS.indexOf(slot as (typeof WANDER_SLOTS)[number]);
  const id = k < 0 ? '' : loadout[k];
  if (!id || levelOf(id) <= 0) return null;
  return WANDER_POOL.find((b) => b.id === id) ?? null;
};
export const sourceSkill = (b: Borrowed): SkillDefinition => CLASS_CONFIGS[b.cls].skills[b.idx];

/** the 新人 / 散人's skill list as the HUD and the game read it: the slotted moves with their levels */
export function refreshWanderer() {
  const W = CLASS_CONFIGS.Wanderer;
  W.name = SKILLS.level >= 30 ? '散人' : '新人';
  W.skills = WANDER_SLOTS.map((slot, k) => {
    const b = borrowedFor(slot);
    if (!b) return { ...EMPTY, key: WANDER_LABEL[slot] };
    const s = sourceSkill(b);
    const lv = levelOf(b.id);
    return { ...s, key: WANDER_LABEL[slot], isSuper: false, description: `借自${CLASS_CONFIGS[b.cls].name} · Lv ${lv}（伤害 ${Math.round(skillPower(lv) * 100)}%）：${s.description}` };
  });
}
refreshWanderer();

/** put up to six learned 低阶 skills on the bar (in order; '' leaves a slot empty) */
export function setLoadout(ids: string[]) {
  const next = WANDER_SLOTS.map((_, k) => (ids[k] && WANDER_POOL.some((b) => b.id === ids[k]) && levelOf(ids[k]) > 0 ? ids[k] : ''));
  if (new Set(next.filter(Boolean)).size !== next.filter(Boolean).length) return false;
  loadout = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(loadout));
  } catch {
    /* kept for this session */
  }
  refreshWanderer();
  return true;
}

// tests (tools/tests/wanderertest.cjs): set skill levels / the bar without a career server
(globalThis as any).__TQ_WANDER = { SKILLS, setLoadout, refreshWanderer };
