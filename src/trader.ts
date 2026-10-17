// 交易员 (Trader): what his skills leave in the world, shared by the game (Game.tsx moves it and lands the hits)
// and the scenery (TraderFx.tsx draws it).
export interface Rolex {
  owner: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  spin: number;
  /** seconds before it leaves the hand */
  delay: number;
}
export interface CashPatch {
  owner: number;
  x: number;
  y: number;
  z: number;
  r: number;
  /** seconds left */
  t: number;
  /** fighter slots that already slipped on it */
  slipped: number[];
  seed: number;
  /** seconds before it lands (the throw) */
  delay: number;
}
export interface Candle {
  owner: number;
  x: number;
  y: number;
  z: number;
  /** seconds since it was called: warn ring until `warn`, then it falls (0.35 s), then it lies there */
  t: number;
  warn: number;
  r: number;
  dmg: number;
  big: boolean;
  landed: boolean;
}
export interface Crash {
  owner: number;
  target: number;
  x: number;
  z: number;
  t: number;
  fired: number;
}
export const TR = {
  rolex: [] as Rolex[],
  cash: [] as CashPatch[],
  candles: [] as Candle[],
  crashes: [] as Crash[],
};
export function resetTrader() {
  TR.rolex.length = 0;
  TR.cash.length = 0;
  TR.candles.length = 0;
  TR.crashes.length = 0;
}
export const TRADER = {
  rolex: { speed: 26, life: 0.85, dmg: 110, home: 2.2, r: 0.85 },
  cash: { r: 4.5, t: 10, dmg: 30, ahead: 3.5, max: 3, dream: 3.5, bills: 120 },
  glide: { up: 13, fall: 1.0, speed: 16, t: 5 },
  short: { range: 16, t: 7, dmg: 1.35, slow: 0.7, drain: 0.025, refund: 0.6 },
  crash: { range: 25, r: 7, n: 10, dur: 2.0, dmg: 90, bigDmg: 240, warn: 0.55 },
  compound: { per: 0.04, max: 10 },
};
(globalThis as any).__TQ_TR = TR;
