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

export default {
  async fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/r\/([A-Za-z0-9_-]{3,24})$/);
    if (!m) return new Response('tianque relay ok', { headers: { 'access-control-allow-origin': '*' } });
    return env.ROOM.get(env.ROOM.idFromName(m[1].toUpperCase())).fetch(req);
  },
};
