import {careerRoute} from './career.js';
import { verifyAdmin } from './admin-auth.js';
import { validSnapshot, summarize } from './profile.js';
// 天阙 战绩 / 排行榜 / 账号: a small JSON API on the relay worker (/api/...).
//
// Storage: Cloudflare D1 (a distributed SQL database) when the deploy could bind it (env.DB), otherwise the
// SQLite inside a Durable Object (env.STORE, one global instance). The same SQL runs on either.
//
// Accounts have no password. Registering returns a recovery code (shown to the player); the server keeps only
// its SHA-256. The code proves who you are when reporting a result, and logs you in on another device.

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-tq-admin', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS careers (player TEXT PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS saves (player TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated INTEGER NOT NULL, data TEXT NOT NULL, nonce TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS activity (player TEXT PRIMARY KEY, seen INTEGER NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, page TEXT NOT NULL, map TEXT NOT NULL, hero TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created INTEGER NOT NULL, last INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS mastery (player TEXT NOT NULL, hero TEXT NOT NULL, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (player, hero))`,
  `CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, player TEXT NOT NULL, hero TEXT NOT NULL, foe TEXT NOT NULL, map TEXT NOT NULL, mode TEXT NOT NULL, result INTEGER NOT NULL, dur INTEGER NOT NULL, dmg INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS matches_player ON matches (player, ts)`,
  `CREATE INDEX IF NOT EXISTS matches_ts ON matches (ts)`,
  `CREATE INDEX IF NOT EXISTS players_xp ON players (xp)`,
];
const HEROES = new Set(['Berserker', 'Ranger', 'BuddhistMage', 'Shadowblade', 'Emperor', 'Guard', 'Trader', 'HeavyHealer', 'Wanderer']);
const MODES = { easy: 0.5, normal: 1, hard: 1.5, hell: 2.5, online: 2 };

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** a 12 character recovery code, easy to read out (no 0/O, 1/I/L) */
function newCode() {
  const A = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const r = crypto.getRandomValues(new Uint8Array(12));
  const s = [...r].map((b) => A[b % A.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || '无名侠客';
const normCode = (c) => String(c ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const level = (xp) => Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1;

/** the API itself, over a store with all(sql, ...args) -> rows and run(sql, ...args) */
export async function handle(req, q, adminCheck = verifyAdmin) {
  if (req.method === 'POST' && Number(req.headers.get('content-length') || 0) > 100000) return json({error: 'request too large'}, 413);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, '');
  const raw = req.method === 'POST' ? await req.text() : '';
  if (raw.length > 100000) return json({ error: 'request too large' }, 413);
  let body = {};
  try { body = raw ? JSON.parse(raw) : {}; } catch { return json({ error: 'invalid JSON' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid body' }, 400);
  const now = Date.now();
  const auth = async (id, code) => {
    const rows = await q.all('SELECT * FROM players WHERE id = ? AND key_hash = ?', String(id ?? ''), await sha(normCode(code)));
    return rows[0] || null;
  };

  if (path.startsWith('/career/') && req.method === 'POST') {
    const p = await auth(body.id, body.code);
    if (!p) return json({error:'请先登录账号'},401);
    try { return json(await careerRoute(path,body,p,q,now)); }
    catch(e) { return json({error:e.message},409); }
  }

  if (path.startsWith('/admin/')) {
    if (!(await adminCheck(req.headers.get('x-tq-admin')))) return json({ error: '后台口令无效或尚未配置' }, 403);
    if (path === '/admin/players') {
      const offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0));
      const search = String(url.searchParams.get('search') || '').slice(0, 64);
      const rows = await q.all(`SELECT p.id, p.name, p.created, p.last, p.xp, p.wins, p.losses, p.draws, a.seen, a.seconds, a.page, a.map, a.hero, s.updated, s.data FROM players p LEFT JOIN activity a ON a.player=p.id LEFT JOIN saves s ON s.player=p.id WHERE p.name LIKE ? OR p.id = ? ORDER BY COALESCE(a.seen,p.last) DESC, p.id LIMIT 51 OFFSET ?`, '%' + search + '%', search, offset);
      return json({ players: rows.slice(0, 50).map(({ data, ...p }) => ({ ...p, online: now - (p.seen || 0) < 45000, progress: summarize(data) })), more: rows.length > 50 });
    }
    if (path === '/admin/player') {
      const id = String(url.searchParams.get('id') || '');
      const rows = await q.all('SELECT id, name, created, last, xp, wins, losses, draws FROM players WHERE id = ?', id);
      if (!rows[0]) return json({ error: 'not found' }, 404);
      const activity = (await q.all('SELECT seen, seconds, page, map, hero FROM activity WHERE player = ?', id))[0] || null;
      const save = (await q.all('SELECT updated, revision, data FROM saves WHERE player = ?', id))[0];
      const matches = await q.all('SELECT ts, hero, foe, map, mode, result, dur FROM matches WHERE player = ? ORDER BY ts DESC LIMIT 50', id);
      return json({ player: rows[0], activity, progress: summarize(save?.data), savedAt: save?.updated || null, revision: save?.revision || 0, matches });
    }
    return json({ error: 'not found' }, 404);
  }
  if (path === '/heartbeat' && req.method === 'POST') {
    const p = await auth(body.id, body.code);
    if (!p) return json({ error: 'unauthorized' }, 401);
    const active = body.active === true && body.page === 'game' ? 1 : 0;
    await q.run(`INSERT INTO activity (player,seen,seconds,page,map,hero,active) VALUES (?,?,0,?,?,?,?) ON CONFLICT(player) DO UPDATE SET seconds=activity.seconds + CASE WHEN activity.active=1 AND excluded.seen-activity.seen BETWEEN 0 AND 45000 THEN CAST((excluded.seen-activity.seen)/1000 AS INTEGER) ELSE 0 END, seen=excluded.seen,page=excluded.page,map=excluded.map,hero=excluded.hero,active=excluded.active`, p.id, now, body.page === 'game' ? 'game' : 'lobby', String(body.map || '').slice(0,64), String(body.hero || '').slice(0,32), active);
    return json({ ok: true });
  }
  if (path === '/save' && req.method === 'POST') {
    const p = await auth(body.id, body.code);
    if (!p) return json({ error: 'unauthorized' }, 401);
    if (body.action === 'read') {
      const saved = (await q.all('SELECT revision, updated, data FROM saves WHERE player = ?', p.id))[0];
      return json(saved ? { ...saved, data: JSON.parse(saved.data) } : { revision: 0, updated: null, data: null });
    }
    if (!validSnapshot(body.data) || !Number.isSafeInteger(body.revision) || body.revision < 0) return json({ error: '存档格式不正确' }, 400);
    const nonce = crypto.randomUUID();
    // One conditional statement: two devices cannot both overwrite the same revision.
    await q.run(`INSERT INTO saves (player,revision,updated,data,nonce) SELECT ?,1,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM saves WHERE player=?) ON CONFLICT(player) DO UPDATE SET revision=saves.revision+1,updated=excluded.updated,data=excluded.data,nonce=excluded.nonce WHERE saves.revision=?`, p.id, now, JSON.stringify(body.data), nonce, body.revision, p.id, body.revision);
    const saved = (await q.all('SELECT revision, updated, nonce FROM saves WHERE player = ?', p.id))[0];
    if (saved?.nonce !== nonce) return json({ error: '另一台设备已更新存档，请选择要保留的版本', conflict: true }, 409);
    return json({ revision: saved.revision, updated: saved.updated });
  }
  if (path === '/register' && req.method === 'POST') {
    const code = newCode();
    const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const name = cleanName(body.name);
    await q.run('INSERT INTO players (id, name, key_hash, created, last) VALUES (?, ?, ?, ?, ?)', id, name, await sha(normCode(code)), now, now);
    return json({ id, code, name });
  }
  if (path === '/login' && req.method === 'POST') {
    const rows = await q.all('SELECT id, name FROM players WHERE key_hash = ?', await sha(normCode(body.code)));
    if (!rows[0]) return json({ error: '恢复码不对' }, 404);
    return json({ id: rows[0].id, name: rows[0].name, code: String(body.code).toUpperCase() });
  }
  if (path === '/rename' && req.method === 'POST') {
    const p = await auth(body.id, body.code);
    if (!p) return json({ error: 'unauthorized' }, 401);
    await q.run('UPDATE players SET name = ? WHERE id = ?', cleanName(body.name), p.id);
    return json({ ok: true });
  }
  if (path === '/match' && req.method === 'POST') {
    const p = await auth(body.id, body.code);
    if (!p) return json({ error: 'unauthorized' }, 401);
    const hero = String(body.hero);
    const foe = String(body.foe);
    const mode = String(body.mode);
    if (!HEROES.has(hero) || !HEROES.has(foe) || !(mode in MODES)) return json({ error: 'bad match' }, 400);
    const result = body.result === 1 ? 1 : body.result === 2 ? 2 : 0;
    const dur = Math.max(0, Math.min(3600, Math.round(+body.dur || 0)));
    const dmg = Math.max(0, Math.min(100000, Math.round(+body.dmg || 0)));
    if (dur < 4) return json({ error: 'too short' }, 400);
    // one result every few seconds at most
    const recent = await q.all('SELECT ts FROM matches WHERE player = ? ORDER BY ts DESC LIMIT 1', p.id);
    if (recent[0] && now - recent[0].ts < 4000) return json({ error: 'slow down' }, 429);
    const gain = Math.round((result === 1 ? 20 : result === 2 ? 10 : 6) * MODES[mode]);
    await q.run('INSERT INTO matches (ts, player, hero, foe, map, mode, result, dur, dmg) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', now, p.id, hero, foe, String(body.map).slice(0, 24), mode, result, dur, dmg);
    await q.run(
      'UPDATE players SET last = ?, xp = xp + ?, wins = wins + ?, losses = losses + ?, draws = draws + ? WHERE id = ?',
      now, gain, result === 1 ? 1 : 0, result === 0 ? 1 : 0, result === 2 ? 1 : 0, p.id
    );
    await q.run(
      'INSERT INTO mastery (player, hero, games, wins, xp) VALUES (?, ?, 1, ?, ?) ON CONFLICT (player, hero) DO UPDATE SET games = games + 1, wins = wins + excluded.wins, xp = xp + excluded.xp',
      p.id, hero, result === 1 ? 1 : 0, gain
    );
    return json({ ok: true, gain, xp: p.xp + gain, level: level(p.xp + gain) });
  }
  if (path === '/me') {
    const p = await auth(url.searchParams.get('id'), url.searchParams.get('code'));
    if (!p) return json({ error: 'unauthorized' }, 401);
    const mastery = await q.all('SELECT hero, games, wins, xp FROM mastery WHERE player = ? ORDER BY xp DESC', p.id);
    const recent = await q.all('SELECT ts, hero, foe, map, mode, result, dur FROM matches WHERE player = ? ORDER BY ts DESC LIMIT 20', p.id);
    const rank = await q.all('SELECT COUNT(*) AS n FROM players WHERE xp > ?', p.xp);
    return json({
      id: p.id, name: p.name, xp: p.xp, level: level(p.xp), wins: p.wins, losses: p.losses, draws: p.draws, rank: (rank[0]?.n ?? 0) + 1,
      mastery: mastery.map((m) => ({ ...m, level: level(m.xp) })), recent,
    });
  }
  if (path === '/leaderboard') {
    const rows = await q.all('SELECT id, name, xp, wins, losses FROM players WHERE wins + losses > 0 ORDER BY xp DESC LIMIT 50');
    const out = [];
    for (const r of rows) {
      const top = await q.all('SELECT hero FROM mastery WHERE player = ? ORDER BY xp DESC LIMIT 1', r.id);
      out.push({ name: r.name, xp: r.xp, level: level(r.xp), wins: r.wins, losses: r.losses, hero: top[0]?.hero ?? null, me: r.id === url.searchParams.get('id') });
    }
    return json(out);
  }
  if (path === '/heroes') {
    const since = now - 30 * 86400000;
    const rows = await q.all("SELECT hero, COUNT(*) AS games, SUM(CASE WHEN result = 1 THEN 1 ELSE 0 END) AS wins FROM matches WHERE ts > ? AND mode IN ('hard', 'hell', 'online') GROUP BY hero", since);
    return json(rows);
  }
  return json({ error: 'not found' }, 404);
}

let ready = false;
/** D1 store (schema made once per isolate) */
export async function d1(env) {
  const q = {
    all: async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).all()).results ?? [],
    run: async (sql, ...a) => {
      await env.DB.prepare(sql).bind(...a).run();
    },
  };
  if (!ready) {
    for (const s of SCHEMA) await env.DB.prepare(s).run();
    ready = true;
  }
  return q;
}

/** fallback store: the SQLite inside one Durable Object */
export class Store {
  constructor(state) {
    this.sql = state.storage.sql;
    for (const s of SCHEMA) this.sql.exec(s);
    this.q = {
      all: async (sql, ...a) => this.sql.exec(sql, ...a).toArray(),
      run: async (sql, ...a) => {
        this.sql.exec(sql, ...a);
      },
    };
  }
  async fetch(req) {
    try {
      return await handle(req, this.q);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e).slice(0, 200) }, 500);
    }
  }
}

export async function api(req, env) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    if (env.DB) return await handle(req, await d1(env));
    return await env.STORE.get(env.STORE.idFromName('global')).fetch(req);
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e).slice(0, 200) }, 500);
  }
}
