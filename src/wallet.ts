// 身家: what you've banked from 洛城午后 (cash and watches), kept in this browser.
import { LOOT } from './maps';

export interface Wallet {
  cash: number;
  watches: Record<string, number>;
}
const KEY = 'tq_wallet';
export function getWallet(): Wallet {
  try {
    const w = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (w && typeof w.cash === 'number') return { cash: w.cash, watches: w.watches ?? {} };
  } catch {
    /* private mode */
  }
  return { cash: 0, watches: {} };
}
/** bank a round's haul (LOOT kind ids); returns the new wallet */
export function bank(items: string[]): Wallet {
  const w = getWallet();
  for (const id of items) {
    const k = LOOT.kinds.find((x) => x.id === id);
    if (!k) continue;
    if (id.startsWith('cash')) w.cash += k.value;
    else w.watches[id] = (w.watches[id] ?? 0) + 1;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* private mode */
  }
  return w;
}
/** what it's all worth (watches at their LOOT value) */
export function netWorth(w: Wallet) {
  let v = w.cash;
  for (const [id, n] of Object.entries(w.watches)) v += (LOOT.kinds.find((x) => x.id === id)?.value ?? 0) * n;
  return v;
}
export const WATCH_NAMES: Record<string, string> = { rolex: 'Rolex', iwc: 'IWC', patek: '百达翡丽' };
