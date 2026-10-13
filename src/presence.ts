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

function send() {
  state.t = Date.now();
  const msg = JSON.stringify(state);
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
  let mqtt: any;
  try {
    mqtt = (await import('mqtt')).default;
  } catch {
    return;
  }
  for (const b of PRESENCE_BROKERS) {
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
    for (const c of clients) if (c.connected) c.publish(PRESENCE_TOPIC + sid, '', { qos: 0, retain: true });
  });
}
