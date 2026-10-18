import type { CombatantState } from './types';

/** Normal knockouts may be revived any number of times. Special deaths remain separate. */
export function canRevive(c: Pick<CombatantState, 'hp' | 'stateDuration' | 'swimming' | 'reviveBlocked'>): boolean {
  return c.hp <= 0 && c.stateDuration === 99 && !c.reviveBlocked && !c.swimming;
}
