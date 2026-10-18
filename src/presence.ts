import { getAccount, STATS_API } from './stats';
// Who is playing right now. Every open game posts a small heartbeat (nickname, what screen it's on,
// map, class, match type) to a public MQTT topic every few seconds; admin.html listens and lists them.
// Nothing else is sent: no IP, no location, no input.

export const PRESENCE_TOPIC = 'tianque-1v1/v1/presence/';
export const PRESENCE_BROKERS: (string | { url: string; username: string; password: string })[] = (globalThis as any).__TQ_PRESENCE || [
  { url: 'wss://public.cloud.shiftr.io', username: 'public', password: 'public' },
  'wss://broker.emqx.io:8084/mqtt',
];
export const BEAT_MS = 8000;

export interface PresenceState {
  id: string;
  name: string;
  /** lobby: picking a map / class; game: in a match */
  page: 'lobby' | 'game';
  map: string;
  cls: string;
  /** ai | dummy | host | guest */
  mode: string;
  room?: string;
  vs?: string;
  ver: string;
  mobile: boolean;
  since: number;
  t: number;
}

const sid = (() => {
  try {
    const k = 'tq_presence_id';
    let v = sessionStorage.getItem(k);
    if (!v) {
      v = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(k, v);
    }
    return v;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();

const state: PresenceState = {
  id: sid,
  name: '',
  page: 'lobby',
  map: '',
  cls: '',
  mode: 'ai',
  ver: '',
  mobile: typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
  since: Date.now(),
  t: Date.now(),
};
let clients: any[] = [];
let started = false;

/** our own relay's presence board (https://…/p), when the build knows where the relay is */
export const PRESENCE_HTTP: string | null = (() => {
  const own = (import.meta as any).env?.VITE_TQ_RELAY as string | undefined;
  return own ? own.replace(/^ws/, 'http').replace(/\/$/, '') + '/p' : null;
})();
function post(body: string) {
  if (!PRESENCE_HTTP) return;
  try {
    fetch(PRESENCE_HTTP, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {});
  } catch {
    /* offline */
  }
}

function send() {
  state.t = Date.now();
  const msg = JSON.stringify(state);
  post(msg);
  const account = getAccount();
  // Stable account identity is sent only to the authenticated private profile endpoint, never public MQTT.
  if (account && STATS_API) fetch(STATS_API + '/heartbeat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: account.id, code: account.code, page: state.page, map: state.map, hero: state.cls, active: document.visibilityState === 'visible' }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
  for (const c of clients) if (c.connected) c.publish(PRESENCE_TOPIC + sid, msg, { qos: 0, retain: true });
}

/** update what this player is doing (merged into the next heartbeat; sent right away if something changed) */
export function setPresence(p: Partial<PresenceState>) {
  let changed = false;
  for (const k of Object.keys(p) as (keyof PresenceState)[]) {
    if ((state as any)[k] !== (p as any)[k]) {
      (state as any)[k] = (p as any)[k];
      changed = true;
    }
  }
  if (changed && started) send();
}

export async function startPresence(ver: string) {
  if (started || typeof window === 'undefined') return;
  started = true;
  state.ver = ver;
  send();
  let mqtt: any = null;
  try {
    mqtt = (await import('mqtt')).default;
  } catch {
    /* only the relay board then */
  }
  for (const b of mqtt ? PRESENCE_BROKERS : []) {
    const url = typeof b === 'string' ? b : b.url;
    const auth = typeof b === 'string' ? {} : { username: b.username, password: b.password };
    try {
      const cl = mqtt.connect(url, {
        ...auth,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 8000,
        keepalive: 30,
        clientId: 'tqp_' + sid + '_' + Math.random().toString(36).slice(2, 5),
        // if the tab dies without saying goodbye, the broker clears our entry
        will: { topic: PRESENCE_TOPIC + sid, payload: '', qos: 0, retain: true },
      });
      cl.on('connect', send);
      cl.on('error', () => {});
      clients.push(cl);
    } catch {
      /* one broker down is fine */
    }
  }
  window.setInterval(send, BEAT_MS);
  window.addEventListener('pagehide', () => {
    post(JSON.stringify({ id: sid, bye: true }));
    for (const c of clients) if (c.connected) c.publish(PRESENCE_TOPIC + sid, '', { qos: 0, retain: true });
  });
}
