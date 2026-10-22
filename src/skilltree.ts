// 百业 skill levels as the game reads them (set from the career server state by src/career.ts). Only the local
// player's career run uses them: free battles always fight at full strength.
import { SKILL_TREE, LOW_SKILLS, SKILL_OWNER } from '../shared/career.js';
export { SKILL_TREE, LOW_SKILLS, SKILL_OWNER };

export const SKILLS = { levels: {} as Record<string, number>, baibian: false, hero: null as string | null, level: 1 };

export const levelOf = (id: string) => SKILLS.levels[id] ?? 0;
/** damage at a skill level: Lv 1 hits at 80%, Lv 5 at 100%, Lv 10 at 125% */
export const skillPower = (lvl: number) => (lvl <= 0 ? 0 : 0.75 + 0.05 * lvl);
/** 换兵器: how long a 新人 / 散人 takes to change to another house's weapon (the 百变兵器 makes it instant) */
export const SWAP_TIME = 0.45;
