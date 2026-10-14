import Peer, { DataConnection } from 'peerjs';
import type { CharacterClassId } from './types';
import type { MapId } from './maps';

/**
 * Online rooms over WebRTC (PeerJS public signalling, no server of our own): a host and up to three guests.
 * The host runs the whole simulation; each guest sends its inputs and draws the host's state.
 */
export const MAX_GUESTS = 3;
/** one seat of a room: the host, a guest (by connection id), an AI, or nobody */
export interface RoomSeat {
  kind: 'host' | 'guest' | 'ai' | 'empty';
  id?: string;
  cls: CharacterClassId;
  name: string;
}
export type NetRole = 'host' | 'guest';
export type NetStatus = 'idle' | 'opening' | 'waiting' | 'connecting' | 'connected' | 'closed' | 'error';

export interface RemoteInput {
  mx: number;
  mz: number;
  yaw: number;
  blk: boolean;
  int?: boolean;
  /** R held down: an ultimate only lasts while its key is held */
  ult?: boolean;
  req: string | null;
  reqTtl: number;
}

export type NetMessage =
  | { t: 'hello'; cls: CharacterClassId; name?: string }
  | { t: 'cfg'; map: MapId; hostCls?: CharacterClassId; guestCls?: CharacterClassId; seq: number; hostName?: string; seats?: RoomSeat[] }
  | { t: 'room'; seats: RoomSeat[]; map: MapId; started: boolean }
  | { t: 'in'; mx: number; mz: number; yaw: number; blk: boolean; int?: boolean; ult?: boolean; req: string | null }
  | { t: 's'; f: any[]; p: any[]; m?: any; ev: any[]; ts?: number; q?: number; k?: 1 }
  | { t: 're'; e: any }
  | { t: 'pi'; c: number }
  | { t: 'po'; c: number }
  | { t: 'bye' };

/** relay-only control messages (never reach the game) */
type RelayCtl = { t: 'rj'; id: string } | { t: 'ra'; id: string } | { t: 'rp' };

/**
 * When the two browsers cannot open a WebRTC path at all (strict campus / office NATs, both sides behind firewalls),
 * the match falls back to a public MQTT broker over secure websockets: slower than peer to peer, but it goes through
 * anything that can load a web page. The host listens on every broker that answers; the guest uses the first one.
 */
// campus networks (eduroam) often only let ports 80 / 443 out, so the brokers listening on 443 come first
const RELAY_BROKERS: (string | { url: string; username: string; password: string })[] = [
  { url: 'wss://public.cloud.shiftr.io', username: 'public', password: 'public' },
  'wss://mqtt.eclipseprojects.io:443/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
const RELAY_NS = 'tianque-1v1/v1/';
/** how long the guest gives peer to peer before switching to the relay */
const P2P_GRACE_MS = 9000;

const ID_PREFIX = 'tianque-1v1-';

/**
 * How the two browsers find a path to each other. STUN tells each side its public address (enough for most home
 * networks); TURN relays the traffic when a direct path is impossible (campus / office networks, strict NATs,
 * across the Great Firewall). More than one of each, so one server being down or blocked doesn't sink the match.
 */
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.miwifi.com:3478' },
    { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 4,
};
/** give up on a join that never opens, with an explanation instead of spinning forever */
const JOIN_TIMEOUT_MS = 22000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export class NetSession {
  role: NetRole;
  code: string;
  status: NetStatus = 'idle';
  error = '';
  peer: Peer | null = null;
  conn: DataConnection | null = null;
  /** host: everyone who has joined, by connection id (their controls, pick, name, line) */
  guests = new Map<string, { id: string; conn: DataConnection | null; relay: boolean; remote: RemoteInput; cls: CharacterClassId | null; name: string; pingMs: number; heard: number }>();
  /** host: someone joined or left */
  onGuests: (() => void) | null = null;
  /** host: the first guest's controls (kept for older code paths) */
  get remote(): RemoteInput {
    const g = this.guests.values().next().value;
    return g ? g.remote : this.spareRemote;
  }
  private spareRemote: RemoteInput = { mx: 0, mz: 0, yaw: 0, blk: false, req: null, reqTtl: 0 };
  /** host: a guest's latest controls */
  remoteOf(id?: string): RemoteInput | null {
    if (!id) return null;
    return this.guests.get(id)?.remote ?? null;
  }
  /** guest: our id as the host knows us */
  get myId() {
    return this.via === 'relay' ? this.relayId : this.peer?.id || '';
  }
  // ---- snapshot delta coding ----
  // A full snapshot is ~7 KB (every field of every fighter); 30 a second to each of three guests is several
  // megabits of upload from the host, which choked rooms. Now a keyframe (everything) goes out every second
  // (and whenever someone joins); in between only the fields that changed since the last snapshot are sent,
  // and the map state only when it changed. Messages carry a sequence number: a guest that misses one (the
  // relay can drop) waits for the next keyframe instead of drawing garbage.
  private sSeq = 0;
  private sPrev: any[] | null = null;
  private sPrevM = '';
  private sLastKey = 0;
  /** host: send a keyframe next (someone just joined) */
  needKey = true;
  private relayReady: Promise<boolean> | null = null;
  private gBase: any[] | null = null;
  private gSeq = -1;
  private gM: any = null;
  private static eq(a: any, b: any) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => typeof v !== 'object' && v === b[i])) return true;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  private encodeSnap(m: Extract<NetMessage, { t: 's' }>) {
    const now = performance.now();
    const relay = [...this.guests.values()].some((g) => g.relay);
    const key = this.needKey || !this.sPrev || this.sPrev.length !== m.f.length || now - this.sLastKey > (relay ? 500 : 1000);
    this.sSeq++;
    const mj = JSON.stringify(m.m ?? null);
    const mChanged = key || mj !== this.sPrevM;
    this.sPrevM = mj;
    if (key) {
      this.needKey = false;
      this.sLastKey = now;
      this.sPrev = m.f;
      return { ...m, q: this.sSeq, k: 1 as const };
    }
    const prev = this.sPrev!;
    const f = m.f.map((cur, i) => {
      const old = prev[i];
      const d: any = {};
      for (const k in cur) if (cur[k] !== undefined && !NetSession.eq(cur[k], old[k])) d[k] = cur[k];
      for (const k in old) if (old[k] !== undefined && cur[k] === undefined) d[k] = null; // gone
      return d;
    });
    this.sPrev = m.f;
    const out: any = { ...m, f, q: this.sSeq };
    if (!mChanged) delete out.m;
    return out;
  }
  /** guest: rebuild the full snapshot from a keyframe or a delta; false if it can't be (a message went missing) */
  private decodeSnap(m: Extract<NetMessage, { t: 's' }>) {
    if (m.q === undefined) return true; // an older host: always full
    if (m.k) {
      this.gBase = m.f;
      this.gSeq = m.q;
      this.gM = m.m;
      return true;
    }
    if (!this.gBase || m.q !== this.gSeq + 1 || this.gBase.length !== m.f.length) {
      this.gBase = null; // lost one: wait for the next keyframe
      return false;
    }
    const full = this.gBase.map((b, i) => {
      const o = { ...b };
      const d = m.f[i];
      for (const k in d) {
        if (d[k] === null) delete o[k];
        else o[k] = d[k];
      }
      return o;
    });
    this.gBase = full;
    this.gSeq = m.q;
    m.f = full;
    if (m.m === undefined) m.m = this.gM;
    else this.gM = m.m;
    return true;
  }

  /** guest: the latest state snapshots (a small jitter buffer), each with its host timestamp */
  snaps: { at: number; ts: number; msg: Extract<NetMessage, { t: 's' }>; used?: boolean }[] = [];
  /** guest: local clock minus host clock, plus the smallest network delay seen */
  clockOff: number | null = null;
  /** guest: how far behind the host's newest state we draw, sized to the measured jitter */
  interpDelay = 60;
  private lastArrive = 0;
  private jitter = 8;
  /** host: vfx / audio calls recorded this tick, shipped with the next snapshot */
  events: any[] = [];
  /** guest: events waiting to be replayed by the game loop */
  inbox: any[] = [];
  /** guest: the host's name / host: the first guest's (older code paths) */
  remoteClass: CharacterClassId | null = null;
  remoteName = '';
  pingMs = 0;
  /** how the match is carried: straight between the browsers, or through the relay */
  via: '' | 'p2p' | 'relay' = '';
  private relays: any[] = [];
  private relayOut: any = null;
  private relayId = Math.random().toString(36).slice(2, 10);
  private relayHeard = 0;
  private relayTimers: number[] = [];
  private relayOpening: Promise<boolean> | null = null;
  private lastIn = 0;
  private listeners = new Set<() => void>();
  onMessage: ((m: NetMessage, from?: string) => void) | null = null;

  constructor(role: NetRole, code: string) {
    this.role = role;
    this.code = code.toUpperCase();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private pinger = 0;
  private changed(status?: NetStatus, err?: string) {
    if (status === 'connected' && !this.pinger)
      this.pinger = window.setInterval(() => this.status === 'connected' && this.send({ t: 'pi', c: performance.now() }), 1000);
    if (status) this.status = status;
    if (err !== undefined) this.error = err;
    this.listeners.forEach((l) => l());
  }

  start() {
    this.changed('opening');
    const opts = { debug: 1, config: ICE_CONFIG };
    const peer = this.role === 'host' ? new Peer(ID_PREFIX + this.code, opts) : new Peer(opts);
    this.peer = peer;
    if (this.role === 'host') {
      this.relayReady = this.openRelay();
      this.relayReady.then((ok) => ok && (this.status === 'opening' || this.status === 'error') && this.changed('waiting', ''));
    }
    peer.on('open', () => {
      if (this.role === 'host') {
        this.changed('waiting');
      } else {
        this.changed('connecting');
        const c = peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
        this.attach(c);
        this.relayTimers.push(window.setTimeout(() => this.status === 'connecting' && this.joinViaRelay(), P2P_GRACE_MS));
        this.joinTimer = window.setTimeout(() => {
          if (this.status === 'connecting') {
            this.changed('error', '连不上房主：直连和中转都没打通。让房主刷新后重开房间，再用新房间号加入；还不行就换个网络（比如手机热点）。');
            try {
              c.close();
            } catch {
              /* ignore */
            }
          }
        }, JOIN_TIMEOUT_MS);
      }
    });
    peer.on('connection', (c) => {
      if (this.role !== 'host') return;
      if (this.guests.size >= MAX_GUESTS && !this.guests.has(c.peer)) {
        c.on('open', () => c.close()); // room is full
        return;
      }
      this.attachGuest(c);
    });
    peer.on('error', (e: any) => {
      const t = e?.type;
      const msg =
        t === 'unavailable-id'
          ? '这个房间号已被占用，换一个再试'
          : t === 'peer-unavailable'
          ? '找不到这个房间，确认房间号，或者让房主重新创建'
          : t === 'network' || t === 'server-error' || t === 'socket-error'
          ? '连接服务器失败，检查网络后重试'
          : t === 'browser-incompatible'
          ? '浏览器不支持联机，换 Chrome 或 Edge 试试'
          : `连接出错：${t || e?.message || e}`;
      if (this.via === 'relay' || this.status === 'connected') return;
      // the PeerJS server itself is unreachable or lost the room: the relay can still find the other side
      if (t !== 'unavailable-id' && t !== 'browser-incompatible') {
        if (this.role === 'guest') return void this.joinViaRelay(msg);
        if (this.relays.length) return void this.changed('waiting', '');
        // the relay brokers are still being dialled: wait for them before giving up
        if (this.role === 'host' && this.relayReady) return void this.relayReady.then((ok) => !ok && this.status !== 'connected' && this.status !== 'waiting' && this.changed('error', msg));
      }
      this.changed('error', msg);
    });
    peer.on('disconnected', () => {
      if (this.status === 'closed') return;
      if (this.role === 'host' || this.status !== 'connected') peer.reconnect();
    });
  }

  // ---------------- host: guests ----------------
  private addGuest(id: string, conn: DataConnection | null, relay: boolean) {
    this.needKey = true; // the newcomer needs a full snapshot to start from
    let g = this.guests.get(id);
    if (!g) {
      g = { id, conn, relay, remote: { mx: 0, mz: 0, yaw: 0, blk: false, req: null, reqTtl: 0 }, cls: null, name: '', pingMs: 0, heard: performance.now() };
      this.guests.set(id, g);
    } else {
      g.conn = conn;
      g.relay = relay;
      g.heard = performance.now();
    }
    if (relay && !this.via) this.via = 'relay';
    if (!relay && this.via !== 'relay') this.via = 'p2p';
    this.changed('connected', '');
    this.onGuests?.();
  }
  private dropGuest(id: string) {
    if (!this.guests.delete(id)) return;
    if (!this.guests.size) this.changed('waiting', '');
    else this.changed();
    this.onGuests?.();
  }
  private attachGuest(c: DataConnection) {
    const id = c.peer;
    c.on('open', () => this.addGuest(id, c, false));
    c.on('data', (d: any) => this.receive(d as NetMessage, id));
    c.on('close', () => {
      const g = this.guests.get(id);
      if (g && g.conn === c) this.dropGuest(id);
    });
    c.on('error', () => {
      const g = this.guests.get(id);
      if (g && g.conn === c) this.dropGuest(id);
    });
  }
  /** host: send to one guest */
  sendTo(id: string, m: NetMessage) {
    const g = this.guests.get(id);
    if (!g) return;
    if (g.relay) this.relaySend({ ...(m as any), _to: id });
    else if (g.conn && g.conn.open) g.conn.send(m);
  }

  joinTimer = 0;
  /** what the browser's connection is doing right now (shown while joining) */
  iceState = '';

  /** guest: the connection to the host */
  private attach(c: DataConnection) {
    this.conn = c;
    c.on('open', () => {
      if (this.via === 'relay') return void c.close();
      window.clearTimeout(this.joinTimer);
      this.via = 'p2p';
      this.changed('connected', '');
    });
    // surface the WebRTC handshake so a stuck join says where it is stuck
    const watch = () => {
      const pc: RTCPeerConnection | undefined = (c as any).peerConnection;
      if (!pc) return void window.setTimeout(watch, 200);
      const upd = () => {
        this.iceState = pc.iceConnectionState;
        if (pc.iceConnectionState === 'failed' && this.status !== 'connected') {
          if (this.role === 'guest') this.joinViaRelay();
        } else this.changed();
      };
      pc.addEventListener('iceconnectionstatechange', upd);
      upd();
    };
    watch();
    c.on('data', (d: any) => this.receive(d as NetMessage));
    c.on('close', () => this.via !== 'relay' && this.changed('closed', '对方已断开连接'));
    c.on('error', () => this.via !== 'relay' && this.status === 'connected' && this.changed('error', '连接中断'));
  }

  private receive(m: NetMessage, from?: string) {
    if (this.role === 'host' && from) {
      const g = this.guests.get(from);
      if (!g) return;
      g.heard = performance.now();
      if (m.t === 'in') {
        const r = g.remote;
        r.mx = m.mx;
        r.mz = m.mz;
        r.yaw = m.yaw;
        r.blk = m.blk;
        r.int = !!m.int;
      r.ult = !!m.ult;
        r.ult = !!m.ult;
        if (m.req) {
          r.req = m.req;
          r.reqTtl = 0.35;
        }
        return;
      }
      if (m.t === 'pi') return void this.sendTo(from, { t: 'po', c: m.c });
      if (m.t === 'po') {
        const rtt = performance.now() - m.c;
        g.pingMs = g.pingMs ? g.pingMs + (rtt - g.pingMs) * 0.25 : rtt;
        this.pingMs = Math.max(...[...this.guests.values()].map((x) => x.pingMs));
        return;
      }
      if (m.t === 'hello') {
        g.cls = m.cls;
        if (m.name) g.name = m.name.slice(0, 12);
        this.remoteClass = m.cls;
        this.remoteName = g.name;
        this.changed();
        this.onGuests?.();
      }
      if (m.t === 'bye') return void this.dropGuest(from);
      this.onMessage?.(m, from);
      return;
    }
    if (m.t === 'in') {
      const r = this.remote;
      r.mx = m.mx;
      r.mz = m.mz;
      r.yaw = m.yaw;
      r.blk = m.blk;
      r.int = !!m.int;
      r.ult = !!m.ult;
      if (m.req) {
        r.req = m.req;
        r.reqTtl = 0.35;
      }
      return;
    }
    if (m.t === 's') {
      if (!this.decodeSnap(m)) {
        if (m.ev?.length) this.inbox.push(...m.ev); // never drop an effect
        return;
      }
      const at = performance.now();
      const ts = m.ts ?? at;
      // clock offset: the fastest packet is the best estimate; creep up slowly so a route change is followed
      const off = at - ts;
      this.clockOff = this.clockOff === null || off < this.clockOff ? off : this.clockOff + (off - this.clockOff) * 0.01;
      if (this.lastArrive) {
        const gap = at - this.lastArrive;
        this.jitter += (Math.abs(gap - 33) - this.jitter) * 0.05;
      }
      this.lastArrive = at;
      this.interpDelay = Math.min(220, Math.max(this.via === 'relay' ? 70 : 45, 35 + this.jitter * 2.5));
      this.snaps.push({ at, ts, msg: m });
      if (this.snaps.length > 12) {
        const old = this.snaps.shift()!;
        if (!old.used && old.msg.ev.length) this.inbox.push(...old.msg.ev); // never drop an effect
      }
      return;
    }
    if (m.t === 'pi') {
      this.send({ t: 'po', c: m.c });
      return;
    }
    if (m.t === 'po') {
      const rtt = performance.now() - m.c;
      this.pingMs = this.pingMs ? this.pingMs + (rtt - this.pingMs) * 0.25 : rtt;
      return;
    }
    if (m.t === 'hello') {
      this.remoteClass = m.cls;
      if (m.name) this.remoteName = m.name.slice(0, 12);
      this.changed();
    }
    this.onMessage?.(m);
  }

  /** guest: to the host. Host: to every guest */
  send(m: NetMessage) {
    if (this.role === 'host') {
      if (m.t === 's') m = this.encodeSnap(m);
      let relayed = false;
      for (const g of this.guests.values()) {
        if (g.relay) {
          if (!relayed) this.relaySend(m); // one publish reaches every relayed guest
          relayed = true;
        } else if (g.conn && g.conn.open) g.conn.send(m);
      }
      return;
    }
    if (this.via === 'relay') {
      // the relay is a shared public broker: controls go out at most ~30 times a second (actions never dropped)
      if (m.t === 'in' && !m.req) {
        const now = performance.now();
        if (now - this.lastIn < 33) return;
        this.lastIn = now;
      }
      this.relaySend({ ...(m as any), _from: this.relayId });
    }
    else if (this.conn && this.conn.open) this.conn.send(m);
  }

  // ---------------- relay fallback ----------------
  private topic(side: 'h' | 'g') {
    return RELAY_NS + this.code + '/' + side;
  }
  private relaySend(m: NetMessage | RelayCtl | any, client = this.relayOut) {
    try {
      if (this.role === 'host' && !client) {
        // every broker a relayed guest might be on
        for (const c of this.relays) c.publish(this.topic('g'), JSON.stringify(m), { qos: 0 });
        return;
      }
      client?.publish(this.topic(this.role === 'host' ? 'g' : 'h'), JSON.stringify(m), { qos: 0 });
    } catch {
      /* ignore */
    }
  }
  /** host: connect to every broker that answers; guest: the first one that answers */
  private openRelay(): Promise<boolean> {
    if (this.relayOpening) return this.relayOpening;
    this.relayOpening = (async () => {
      let mqtt: any;
      try {
        mqtt = (await import('mqtt')).default;
      } catch {
        return false;
      }
      const mine = this.role === 'host' ? 'h' : 'g';
      const brokers: (string | { url: string; username: string; password: string })[] = (globalThis as any).__TQ_RELAY || RELAY_BROKERS; // tests point this at a local broker
      const tryOne = (b: string | { url: string; username: string; password: string }) =>
        new Promise<any>((res) => {
          const url = typeof b === 'string' ? b : b.url;
          const auth = typeof b === 'string' ? {} : { username: b.username, password: b.password };
          const cl = mqtt.connect(url, { ...auth, clean: true, connectTimeout: 7000, reconnectPeriod: 3000, keepalive: 20, clientId: 'tq_' + this.relayId + '_' + Math.random().toString(36).slice(2, 6) });
          const to = window.setTimeout(() => {
            cl.end(true);
            res(null);
          }, 8000);
          cl.once('connect', () => {
            window.clearTimeout(to);
            cl.__tqName = url.replace(/^wss:\/\//, '').split(/[:/]/)[0];
            cl.subscribe(this.topic(mine), { qos: 0 });
            cl.on('message', (_t: string, payload: Uint8Array) => this.relayReceive(cl, payload));
            res(cl);
          });
          cl.on('error', () => {});
        });
      if (this.role === 'host') {
        const all = await Promise.all(brokers.map(tryOne));
        this.relays = all.filter(Boolean);
        this.relayState = this.relays.length ? `中转待命 ${this.relays.length} 条` : '中转服务器都连不上，只能直连';
        this.changed();
      } else {
        for (const url of brokers) {
          const cl = await tryOne(url);
          if (cl) {
            this.relays = [cl];
            break;
          }
        }
      }
      return this.relays.length > 0;
    })();
    return this.relayOpening;
  }
  private relayReceive(client: any, payload: Uint8Array) {
    let m: any;
    try {
      m = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    if (this.role === 'host') {
      if (m.t === 'rj') {
        // a guest that could not reach us directly
        if (this.guests.size >= MAX_GUESTS && !this.guests.has(m.id)) return;
        this.relaySend({ t: 'ra', id: m.id }, client);
        if (!this.guests.has(m.id)) {
          this.addGuest(m.id, null, true);
          this.startRelayHeartbeat();
        }
        return;
      }
      const from = m._from as string | undefined;
      if (!from || !this.guests.get(from)?.relay) return;
      this.guests.get(from)!.heard = performance.now();
      if (m.t === 'rp') return;
      if (m.t === 'bye') return void this.dropGuest(from);
      delete m._from;
      this.receive(m as NetMessage, from);
      return;
    }
    if (this.role === 'guest' && m.t === 'ra') {
      if (m.id !== this.relayId || this.via === 'relay') return;
      this.relayOut = client;
      this.relayHeard = performance.now();
      this.via = 'relay';
      window.clearTimeout(this.joinTimer);
      try {
        this.conn?.close();
      } catch {
        /* ignore */
      }
      this.startRelayHeartbeat();
      this.changed('connected', '');
      return;
    }
    if (this.via !== 'relay' || client !== this.relayOut) return;
    if (m._to && m._to !== this.relayId) return; // meant for another guest
    delete m._to;
    this.relayHeard = performance.now();
    if (m.t === 'rp') return;
    if (m.t === 'bye') {
      this.changed('closed', '对方已断开连接');
      return;
    }
    this.receive(m as NetMessage);
  }
  private heartbeat = 0;
  private startRelayHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = window.setInterval(() => {
      if (this.status !== 'connected') return;
      if (this.role === 'host') {
        if (![...this.guests.values()].some((g) => g.relay)) return;
        this.relaySend({ t: 'rp' });
        for (const g of [...this.guests.values()]) if (g.relay && performance.now() - g.heard > 12000) this.dropGuest(g.id);
        return;
      }
      if (this.via !== 'relay') return;
      this.relaySend({ t: 'rp', _from: this.relayId });
      if (performance.now() - this.relayHeard > 12000) this.changed('closed', '和房主断开了（中转超时）');
    }, 2000);
    this.relayTimers.push(this.heartbeat);
  }
  private joining = false;
  /** guest: peer to peer did not come up, knock on the host's door through the relay */
  private async joinViaRelay(reason?: string) {
    if (this.joining || this.via || this.role !== 'guest') return;
    this.joining = true;
    this.relayState = '直连没打通，改走中转服务器';
    this.changed('connecting');
    const ok = await this.openRelay();
    if (!ok) {
      this.changed('error', reason || '连不上房主，中转服务器也连不上。检查网络后重试，或换个网络（比如手机热点）。');
      return;
    }
    this.relayState = `已连上中转（${this.relays[0].__tqName}），等房主回应`;
    this.changed();
    const knock = window.setInterval(() => {
      if (this.via) return window.clearInterval(knock);
      for (const cl of this.relays) this.relaySend({ t: 'rj', id: this.relayId }, cl);
    }, 700);
    this.relayTimers.push(knock);
    window.clearTimeout(this.joinTimer);
    this.joinTimer = window.setTimeout(() => {
      if (this.status === 'connecting')
        this.changed('error', `连上了中转（${this.relays[0]?.__tqName}），但房主没回应。让房主刷新页面（确认是新版）重开房间，再用新房间号加入。`);
    }, 14000);
  }
  /** shown while joining */
  relayState = '';

  close() {
    try {
      this.send({ t: 'bye' });
      window.clearTimeout(this.joinTimer);
      this.conn?.close();
      this.peer?.destroy();
      for (const g of this.guests.values()) {
        try {
          g.conn?.send({ t: 'bye' });
          g.conn?.close();
        } catch {
          /* ignore */
        }
      }
      this.relayTimers.forEach((t) => (window.clearTimeout(t), window.clearInterval(t)));
      window.clearInterval(this.pinger);
      this.relays.forEach((c) => c.end(true));
    } catch {
      /* ignore */
    }
    this.changed('closed');
  }
}
