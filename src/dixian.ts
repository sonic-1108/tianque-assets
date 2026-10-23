// 地仙 (HeavyHealer): numbers for his kit, and what his skills leave in the world. Game.tsx runs it, DixianFx.tsx draws it.
// An old physician who could have gone up through the gate of heaven (天阙) and stayed below to mend people instead.

export const DIXIAN = {
  /** 悬壶 passive: heals on someone under this share of their HP are stronger */
  mercy: { below: 0.3, mult: 1.2 },
  /** 1 清风诀: stand still and channel, then a big heal on the most hurt ally in range (yourself if nobody else) */
  breeze: { cast: 0.9, heal: 0.18, range: 16 },
  /** left click: jade qi bolts off the staff, a little homing; the third of the combo is big */
  bolt: { speed: 22, life: 1.0, r: 0.75, home: 2.5, dmg: 50, bigDmg: 95, range: 22 },
  /** 2 损有余: a thread of qi from the nearest enemy to the most hurt ally; their life drains across it */
  drain: { range: 18, keep: 22, t: 3, rate: 0.035 },
  /** 4 缩地成寸 also wraps whoever he reaches (or himself) in 鹤羽: a shield, and a burst that throws enemies off */
  shield: { share: 0.16, t: 6, range: 16, pushR: 3.6, push: 8 },
  /** 3 地脉回春: a ring of earth qi on the ground; allies inside heal every second, an enemy who comes in is caught by
   *  roots for a moment (once per ring) and walks slower while inside */
  spring: { r: 4.5, t: 8, heal: 0.02, slow: 0.7, ahead: 3, root: 1.2 },
  /** 4 缩地成寸: fold the ground and arrive. Toward an ally if one is in reach, else straight ahead */
  step: { speed: 30, far: 9, allyRange: 22, iframe: 0.35 },
  /** 5 还魂: channel over a downed ally, they stand up with this share of HP. With nobody down: 魂印 on the most hurt
   *  ally (or himself): the next blow that would cut them down leaves them standing with `soulHp` instead */
  revive: { cast: 2.5, hp: 0.35, range: 12, soulT: 8, soulHp: 0.25 },
  /** R 人间不渡: the crane comes down; every ally near him heals, shakes off control and can't be controlled a while */
  crane: { r: 20, heal: 0.25, protect: 4 },
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
  /** fighter slots the roots already caught */
  held: number[];
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

export interface Bolt {
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  big: boolean;
}
/** 损有余: life running from `from` (an enemy) to `to` (an ally) */
export interface Tether {
  owner: number;
  from: number;
  to: number;
  t: number;
  /** drained but not shown yet (numbers go up in lumps) */
  acc: number;
  shown: number;
}

export const DX: { springs: Spring[]; cranes: Crane[]; channels: Channel[]; bolts: Bolt[]; tethers: Tether[] } = { springs: [], cranes: [], channels: [], bolts: [], tethers: [] };

export function resetDixian() {
  DX.springs.length = 0;
  DX.cranes.length = 0;
  DX.channels.length = 0;
  DX.bolts.length = 0;
  DX.tethers.length = 0;
}

/** 悬壶: how much a heal of `amount` becomes on this target */
export function mercyHeal(amount: number, hp: number, maxHp: number) {
  return hp < maxHp * DIXIAN.mercy.below ? amount * DIXIAN.mercy.mult : amount;
}
