// 地仙 (HeavyHealer): numbers for his kit, and what his skills leave in the world. Game.tsx runs it, DixianFx.tsx draws it.
// An old physician who could have gone up through the gate of heaven (天阙) and stayed below to mend people instead.

export const DIXIAN = {
  /** 悬壶 passive: heals on someone under this share of their HP are stronger */
  mercy: { below: 0.3, mult: 1.5 },
  /** 1 清风诀: stand still and channel, then a big heal on the most hurt ally in range (yourself if nobody else) */
  breeze: { cast: 1.2, heal: 0.22, range: 16 },
  /** 2 鹤羽护: a shield of crane feathers that soaks damage */
  shield: { share: 0.18, t: 6, range: 16 },
  /** 3 地脉回春: a ring of earth qi on the ground; allies inside heal every second, enemies inside are slowed */
  spring: { r: 4.5, t: 8, heal: 0.025, slow: 0.75, ahead: 3 },
  /** 4 缩地成寸: fold the ground and arrive. Toward an ally if one is in reach, else straight ahead */
  step: { speed: 30, far: 9, allyRange: 22, iframe: 0.35 },
  /** 5 还魂: channel over a downed ally, they stand up with this share of HP */
  revive: { cast: 2.5, hp: 0.4, range: 12 },
  /** R 人间不渡: the crane comes down; every ally near him heals, shakes off control and can't be controlled a while */
  crane: { r: 20, heal: 0.3, protect: 4 },
};

export interface Spring {
  owner: number;
  x: number;
  y: number;
  z: number;
  r: number;
  /** seconds left */
  t: number;
  /** seconds since it opened (draw: grow in) */
  age: number;
  /** time toward the next heal tick (one a second) */
  tick: number;
}
export interface Crane {
  x: number;
  y: number;
  z: number;
  /** seconds since it was called */
  t: number;
}
/** a channel in progress: 清风诀 or 还魂. Lost if he is hit, moved or knocked out of the cast */
export interface Channel {
  owner: number;
  kind: 'breeze' | 'revive';
  target: number;
  t: number;
  dur: number;
}

export const DX: { springs: Spring[]; cranes: Crane[]; channels: Channel[] } = { springs: [], cranes: [], channels: [] };

export function resetDixian() {
  DX.springs.length = 0;
  DX.cranes.length = 0;
  DX.channels.length = 0;
}

/** 悬壶: how much a heal of `amount` becomes on this target */
export function mercyHeal(amount: number, hp: number, maxHp: number) {
  return hp < maxHp * DIXIAN.mercy.below ? amount * DIXIAN.mercy.mult : amount;
}
