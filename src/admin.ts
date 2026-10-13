// 天阙 admin: everyone with the game open right now, from the presence heartbeats (see presence.ts)
import { PRESENCE_TOPIC, PRESENCE_BROKERS, BEAT_MS, PresenceState } from './presence';

const css = `
  :root { --bg:#0b0d10; --panel:#13161b; --line:#232830; --text:#e7e2d6; --dim:#8b8579; --gold:#d6b25e; --green:#5bd38a; --amber:#f0b545; --red:#e2685a; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 "PingFang SC","Microsoft YaHei",system-ui,sans-serif; }
  .wrap { max-width:1100px; margin:0 auto; padding:24px 16px 48px; }
  h1 { font-size:22px; margin:0; letter-spacing:2px; } h1 b { color:var(--gold); }
  .sub { color:var(--dim); font-size:12px; margin-top:4px; }
  .stats { display:flex; gap:12px; margin:20px 0; flex-wrap:wrap; }
  .stat { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 16px; min-width:120px; }
  .stat .n { font-size:28px; font-weight:700; font-variant-numeric:tabular-nums; } .stat .l { color:var(--dim); font-size:12px; }
  .conn { display:flex; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--dim); margin-bottom:12px; }
  .pill { border:1px solid var(--line); border-radius:999px; padding:2px 10px; } .pill.ok { color:var(--green); border-color:#2c5a40; } .pill.bad { color:var(--red); border-color:#5a2c2c; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--dim); font-weight:500; font-size:12px; background:#0f1216; }
  tr:last-child td { border-bottom:none; }
  td.name { font-weight:600; } .tag { display:inline-block; font-size:11px; padding:1px 8px; border-radius:6px; }
  .t-game { background:#1d3a2a; color:var(--green); } .t-lobby { background:#2a2a1d; color:var(--amber); } .t-stale { background:#2a1d1d; color:var(--red); }
  .dim { color:var(--dim); } .empty { text-align:center; color:var(--dim); padding:40px; }
  .scroll { overflow-x:auto; }
`;
document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
const app = document.getElementById('app')!;
app.innerHTML = `<div class="wrap">
  <h1><b>天阙</b> · 在线玩家</h1>
  <div class="sub">每个打开游戏的页面每 ${BEAT_MS / 1000} 秒报一次心跳；超过 30 秒没消息就算离线。这个页面自己不算在内。</div>
  <div class="stats" id="stats"></div>
  <div class="conn" id="conn"></div>
  <div class="scroll"><table><thead><tr><th>玩家</th><th>状态</th><th>模式</th><th>地图</th><th>职业</th><th>对手 / 房间</th><th>在线</th><th>设备</th><th>版本</th><th>心跳</th></tr></thead><tbody id="rows"></tbody></table></div>
</div>`;

const players = new Map<string, PresenceState & { seen: number }>();
const brokerOk: Record<string, boolean> = {};
const MODE: Record<string, string> = { ai: '打电脑', dummy: '木桩练习', host: '联机 · 房主', guest: '联机 · 加入' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const dur = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m < 1 ? '刚来' : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
};

function render() {
  const now = Date.now();
  for (const [id, p] of players) if (now - p.seen > 30000) players.delete(id);
  const list = [...players.values()].sort((a, b) => (a.page === b.page ? a.since - b.since : a.page === 'game' ? -1 : 1));
  const inGame = list.filter((p) => p.page === 'game').length;
  const online = list.filter((p) => p.mode === 'host' || p.mode === 'guest').length;
  document.getElementById('stats')!.innerHTML = [
    [list.length, '在线'],
    [inGame, '对战中'],
    [list.length - inGame, '在大厅'],
    [online, '联机中'],
  ]
    .map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`)
    .join('');
  document.getElementById('conn')!.innerHTML = PRESENCE_BROKERS.map((b) => {
    const host = (typeof b === 'string' ? b : b.url).replace(/^wss:\/\//, '').split(/[:/]/)[0];
    const ok = brokerOk[host];
    return `<span class="pill ${ok ? 'ok' : ok === false ? 'bad' : ''}">${ok ? '●' : '○'} ${host}</span>`;
  }).join('');
  const rows = document.getElementById('rows')!;
  if (!list.length) {
    rows.innerHTML = `<tr><td colspan="10" class="empty">现在没有人在玩</td></tr>`;
    return;
  }
  rows.innerHTML = list
    .map((p) => {
      const age = now - p.seen;
      const stale = age > 18000;
      const st = stale ? '<span class="tag t-stale">可能掉线</span>' : p.page === 'game' ? '<span class="tag t-game">对战中</span>' : '<span class="tag t-lobby">大厅</span>';
      const vs = p.room ? `${p.vs ? esc(p.vs) + ' · ' : ''}<span class="dim">房间 ${esc(p.room)}</span>` : '<span class="dim">—</span>';
      return `<tr><td class="name">${esc(p.name || '无名')}</td><td>${st}</td><td>${MODE[p.mode] ?? esc(p.mode)}</td><td>${esc(p.map || '—')}</td><td>${esc(p.cls || '—')}</td><td>${vs}</td><td>${dur(now - p.since)}</td><td>${p.mobile ? '手机' : '电脑'}</td><td class="dim">${esc(p.ver || '')}</td><td class="dim">${Math.round(age / 1000)} 秒前</td></tr>`;
    })
    .join('');
}

(async () => {
  const mqtt = (await import('mqtt')).default;
  for (const b of PRESENCE_BROKERS) {
    const url = typeof b === 'string' ? b : b.url;
    const host = url.replace(/^wss:\/\//, '').split(/[:/]/)[0];
    const auth = typeof b === 'string' ? {} : { username: b.username, password: b.password };
    const cl = mqtt.connect(url, { ...auth, clean: true, reconnectPeriod: 4000, connectTimeout: 8000, clientId: 'tqadm_' + Math.random().toString(36).slice(2, 8) });
    cl.on('connect', () => {
      brokerOk[host] = true;
      cl.subscribe(PRESENCE_TOPIC + '#', { qos: 0 });
      render();
    });
    cl.on('close', () => {
      brokerOk[host] = false;
      render();
    });
    cl.on('error', () => {});
    cl.on('message', (topic: string, payload: Uint8Array, packet: { retain?: boolean }) => {
      const id = topic.slice(PRESENCE_TOPIC.length);
      const text = new TextDecoder().decode(payload);
      if (!text) {
        players.delete(id);
        render();
        return;
      }
      try {
        const p = JSON.parse(text) as PresenceState;
        // a retained heartbeat left over from long ago is a stale entry, not a player (allowing for a clock that's a bit off)
        if (packet?.retain && Math.abs(Date.now() - p.t) > 60000) return;
        players.set(id, { ...p, seen: Date.now() });
        render();
      } catch {
        /* not ours */
      }
    });
  }
  render();
  setInterval(render, 2000);
})();
