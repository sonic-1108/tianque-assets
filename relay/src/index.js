import { api, Store } from './stats.js';
export { Store };
// 天阙 relay (Cloudflare Worker + Durable Object, WebSocket hibernation).
// wss://<worker>/r/<ROOM>?side=h  the host        wss://<worker>/r/<ROOM>?side=g  a guest
// Whatever the host sends goes to every guest of that room; whatever a guest sends goes to the host.
// The game's own messages carry who it's from / for, so the relay only forwards.

export class Room {
  constructor(state) {
    this.state = state;
  }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const side = new URL(req.url).searchParams.get('side') === 'h' ? 'h' : 'g';
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], [side]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, msg) {
    // a client timing its own round trip to the relay
    if (typeof msg === 'string' && msg.startsWith('{"t":"echo"')) {
      ws.send(msg);
      return;
    }
    const side = this.state.getTags(ws)[0];
    for (const s of this.state.getWebSockets(side === 'h' ? 'g' : 'h')) {
      try {
        s.send(msg);
      } catch {
        /* closed */
      }
    }
  }
  webSocketClose(ws, code) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }
  webSocketError() {}
}

// Who has the game open: every open game POSTs a small heartbeat to /p every few seconds (nickname, screen,
// map, class, match type: nothing else); admin.html GETs /p for the list. Kept in memory, dropped after 30 s.
export class Presence {
  constructor(state) {
    this.state = state;
    this.list = new Map();
  }
  async fetch(req) {
    const now = Date.now();
    for (const [k, v] of this.list) if (now - v.seen > 30000) this.list.delete(k);
    if (req.method === 'POST') {
      try {
        const p = await req.json();
        if (p && typeof p.id === 'string' && p.id.length < 40) {
          if (p.bye) this.list.delete(p.id);
          else this.list.set(p.id, { ...p, seen: now });
        }
      } catch {
        /* not ours */
      }
      return new Response('ok', { headers: CORS });
    }
    return new Response(JSON.stringify([...this.list.values()]), { headers: { ...CORS, 'content-type': 'application/json' } });
  }
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    if (path.startsWith('/api/')) return api(req, env); // 战绩 / 排行榜 / 账号
    if (path === '/p') {
      if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
      return env.PRESENCE.get(env.PRESENCE.idFromName('all')).fetch(req);
    }
    const m = path.match(/^\/r\/([A-Za-z0-9_-]{3,24})$/);
    if (!m) return new Response('tianque relay ok', { headers: { 'access-control-allow-origin': '*' } });
    return env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase())).fetch(req);
  },
};
