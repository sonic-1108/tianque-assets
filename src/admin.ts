// 天阙 admin: everyone with the game open right now, from the presence heartbeats (see presence.ts)
import { PRESENCE_TOPIC, PRESENCE_BROKERS, PRESENCE_HTTP, BEAT_MS, PresenceState } from './presence';

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
  .lock { max-width:360px; margin:16vh auto 0; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:28px 24px; text-align:center; }
  .lock h2 { margin:0 0 6px; font-size:18px; letter-spacing:2px; } .lock h2 b { color:var(--gold); }
  .lock p { color:var(--dim); font-size:12px; margin:0 0 18px; }
  .lock input { width:100%; background:#0b0d10; border:1px solid var(--line); border-radius:8px; color:var(--text); font:600 20px/1 ui-monospace,Menlo,monospace; letter-spacing:4px; text-align:center; padding:12px; text-transform:uppercase; }
  .lock input:focus { outline:none; border-color:var(--gold); }
  .lock button { margin-top:12px; width:100%; background:var(--gold); color:#1a1408; border:none; border-radius:8px; padding:11px; font-weight:700; font-size:14px; cursor:pointer; }
  .lock button:disabled { opacity:.6; cursor:default; }
  .lock .err { color:var(--red); font-size:12px; min-height:18px; margin-top:10px; }
  .banner { font-size:12px; color:var(--amber); margin-top:6px; }
`;
document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
const app = document.getElementById('app')!;
function showPage() {
app.innerHTML = `<div class="wrap">
  <h1><b>天阙</b> · 在线玩家</h1>
  <div class="sub">每个打开游戏的页面每 ${BEAT_MS / 1000} 秒报一次心跳；超过 30 秒没消息就算离线。这个页面自己不算在内。</div>
  <div class="stats" id="stats"></div>
  <div class="conn" id="conn"></div>
  ${__ADMIN__ ? '' : '<div class="banner">口令还没启用（GitHub 里还没设置 ADMIN_SEED），现在谁都能打开这个页面。</div>'}
  <div class="scroll"><table><thead><tr><th>玩家</th><th>状态</th><th>模式</th><th>地图</th><th>职业</th><th>对手 / 房间</th><th>在线</th><th>设备</th><th>版本</th><th>心跳</th></tr></thead><tbody id="rows"></tbody></table></div>
</div>`;
}

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
  const online = list.filter((p) => /^(host|guest)/.test(p.mode)).length;
  document.getElementById('stats')!.innerHTML = [
    [list.length, '在线'],
    [inGame, '对战中'],
    [list.length - inGame, '在大厅'],
    [online, '联机中'],
  ]
    .map(([n, l]) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`)
    .join('');
  document.getElementById('conn')!.innerHTML = [...(PRESENCE_HTTP ? ['天阙中转'] : []), ...PRESENCE_BROKERS].map((b) => {
    const host = b === '天阙中转' ? b : (typeof b === 'string' ? b : b.url).replace(/^wss:\/\//, '').split(/[:/]/)[0];
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
      return `<tr><td class="name">${esc(p.name || '无名')}</td><td>${st}</td><td>${(MODE[p.mode.split(' ')[0]] ?? esc(p.mode.split(' ')[0])) + (p.mode.split(' ')[1] ? ' ' + esc(p.mode.split(' ')[1]) : '')}</td><td>${esc(p.map || '—')}</td><td>${esc(p.cls || '—')}</td><td>${vs}</td><td>${dur(now - p.since)}</td><td>${p.mobile ? '手机' : '电脑'}</td><td class="dim">${esc(p.ver || '')}</td><td class="dim">${Math.round(age / 1000)} 秒前</td></tr>`;
    })
    .join('');
}

/** our own relay's board: polled every 3 s (works where the public brokers are blocked) */
function pollRelay() {
  if (!PRESENCE_HTTP) return;
  const tick = async () => {
    try {
      const r = await fetch(PRESENCE_HTTP, { cache: 'no-store' });
      const list = (await r.json()) as (PresenceState & { seen: number })[];
      brokerOk['天阙中转'] = true;
      const now = Date.now();
      for (const p of list) {
        const cur = players.get(p.id);
        // the relay's own clock says how long ago it heard from them
        const seen = now - Math.max(0, Date.now() - p.seen);
        if (!cur || cur.seen < seen) players.set(p.id, { ...p, seen });
      }
    } catch {
      brokerOk['天阙中转'] = false;
    }
    render();
  };
  tick();
  setInterval(tick, 3000);
}

async function start() {
  showPage();
  pollRelay();
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
}

// ---- the daily passcode (emailed every morning; see tools/admin-codes.mjs) ----
function chicagoDate(offset = 0) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offset * 86400000));
}
async function hashFor(code: string, date: string, iter: number) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(code.toUpperCase().replace(/[^A-Z0-9]/g, '')), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('tianque-admin|' + date), iterations: iter }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function lockScreen() {
  const cfg = __ADMIN__!;
  app.innerHTML = `<div class="lock"><h2><b>天阙</b> · 后台</h2><p>输入今天的口令（每天早上发到邮箱，芝加哥时间每天换一次）</p>
    <form id="f"><input id="code" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX" maxlength="12" autofocus /><button id="go">进入</button><div class="err" id="err"></div></form></div>`;
  const form = document.getElementById('f') as HTMLFormElement;
  const input = document.getElementById('code') as HTMLInputElement;
  const btn = document.getElementById('go') as HTMLButtonElement;
  const err = document.getElementById('err')!;
  form.onsubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true;
    err.textContent = '';
    // today's code, or yesterday's for the hours right after midnight
    for (const date of [chicagoDate(0), chicagoDate(-1)]) {
      const want = cfg.days[date];
      if (want && (await hashFor(input.value, date, cfg.iter)) === want) {
        try {
          localStorage.setItem('tq_admin_ok', JSON.stringify({ date, code: input.value }));
        } catch {
          /* private window: ask again next time */
        }
        start();
        return;
      }
    }
    btn.disabled = false;
    err.textContent = '口令不对，或者已经过期了';
    input.select();
  };
}

(async () => {
  if (!__ADMIN__) return start();
  // the code entered earlier today (or late last night) is re-checked, not trusted blindly
  try {
    const saved = JSON.parse(localStorage.getItem('tq_admin_ok') || 'null');
    if (saved && (saved.date === chicagoDate(0) || saved.date === chicagoDate(-1)) && __ADMIN__.days[saved.date] && (await hashFor(saved.code, saved.date, __ADMIN__.iter)) === __ADMIN__.days[saved.date]) return start();
  } catch {
    /* no storage or junk in it */
  }
  lockScreen();
})();
