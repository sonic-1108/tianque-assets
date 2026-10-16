// 战绩 / 排行榜 / 账号, on our relay worker's /api (Cloudflare D1, or a Durable Object's SQLite as a fallback).
// The account lives in localStorage: an id and a recovery code. The code is the only key: shown to the player so
// they can carry their record to another device (登录 with it there). Everything here fails quietly offline.

export const STATS_API: string | null = (() => {
  const own = (import.meta as any).env?.VITE_TQ_RELAY as string | undefined;
  return own ? own.replace(/^ws/, 'http').replace(/\/$/, '') + '/api' : null;
})();

export interface Account {
  id: string;
  code: string;
  name: string;
}
const KEY = 'tq_account';

export function getAccount(): Account | null {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || 'null');
    return a && a.id && a.code ? a : null;
  } catch {
    return null;
  }
}
function saveAccount(a: Account | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  listeners.forEach((f) => f());
}
const listeners = new Set<() => void>();
export function onAccount(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  if (!STATS_API) throw new Error('offline');
  const r = await fetch(STATS_API + path, body ? { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error || String(r.status));
  return j as T;
}

/** the account, made on first use with the player's nickname */
let making: Promise<Account> | null = null;
export async function ensureAccount(name: string): Promise<Account> {
  const a = getAccount();
  if (a) return a;
  making ??= call<Account>('/register', { name }).then((n) => {
    saveAccount(n);
    return n;
  });
  try {
    return await making;
  } finally {
    making = null;
  }
}
export async function login(code: string) {
  const a = await call<Account>('/login', { code });
  saveAccount(a);
  return a;
}
export function logout() {
  saveAccount(null);
}
export async function rename(name: string) {
  const a = getAccount();
  if (!a) return;
  await call('/rename', { id: a.id, code: a.code, name });
  saveAccount({ ...a, name });
}

export interface RoundReport {
  hero: string;
  foe: string;
  map: string;
  mode: 'easy' | 'normal' | 'hard' | 'hell' | 'online';
  result: 0 | 1 | 2; // lost / won / draw
  dur: number;
  dmg: number;
}
/** one finished round; makes the account the first time */
export async function reportRound(name: string, r: RoundReport): Promise<{ gain: number; level: number } | null> {
  if (!STATS_API || (globalThis as any).__TQ_SIM) return null;
  try {
    const a = await ensureAccount(name);
    return await call('/match', { id: a.id, code: a.code, ...r });
  } catch {
    return null;
  }
}

export interface Me {
  name: string;
  xp: number;
  level: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number;
  mastery: { hero: string; games: number; wins: number; xp: number; level: number }[];
  recent: { ts: number; hero: string; foe: string; map: string; mode: string; result: number; dur: number }[];
}
export async function fetchMe(): Promise<Me | null> {
  const a = getAccount();
  if (!a) return null;
  return call<Me>(`/me?id=${encodeURIComponent(a.id)}&code=${encodeURIComponent(a.code)}`);
}
export async function fetchLeaderboard() {
  const a = getAccount();
  return call<{ name: string; xp: number; level: number; wins: number; losses: number; hero: string | null; me: boolean }[]>(`/leaderboard${a ? `?id=${encodeURIComponent(a.id)}` : ''}`);
}
export async function fetchHeroes() {
  return call<{ hero: string; games: number; wins: number }[]>('/heroes');
}
