import Peer, { DataConnection } from 'peerjs';
import type { CharacterClassId } from './types';
import type { MapId } from './maps';

/**
 * Online 1v1 over WebRTC (PeerJS public signalling, no server of our own).
 * The host runs the whole simulation; the guest sends its inputs and draws the host's state.
 */
export type NetRole = 'host' | 'guest';
export type NetStatus = 'idle' | 'opening' | 'waiting' | 'connecting' | 'connected' | 'closed' | 'error';

export interface RemoteInput {
  mx: number;
  mz: number;
  yaw: number;
  blk: boolean;
  int?: boolean;
  req: string | null;
  reqTtl: number;
}

export type NetMessage =
  | { t: 'hello'; cls: CharacterClassId; name?: string }
  | { t: 'cfg'; map: MapId; hostCls: CharacterClassId; guestCls: CharacterClassId; seq: number; hostName?: string }
  | { t: 'in'; mx: number; mz: number; yaw: number; blk: boolean; int?: boolean; req: string | null }
  | { t: 's'; f: any[]; p: any[]; m: any; ev: any[] }
  | { t: 're'; e: any }
  | { t: 'bye' };

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
const JOIN_TIMEOUT_MS = 25000;
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
  /** host: the guest's latest controls */
  remote: RemoteInput = { mx: 0, mz: 0, yaw: 0, blk: false, req: null, reqTtl: 0 };
  /** guest: the two latest state snapshots, for interpolation */
  snaps: { at: number; msg: Extract<NetMessage, { t: 's' }> }[] = [];
  /** host: vfx / audio calls recorded this tick, shipped with the next snapshot */
  events: any[] = [];
  /** guest: events waiting to be replayed by the game loop */
  inbox: any[] = [];
  remoteClass: CharacterClassId | null = null;
  remoteName = '';
  pingMs = 0;
  private listeners = new Set<() => void>();
  onMessage: ((m: NetMessage) => void) | null = null;

  constructor(role: NetRole, code: string) {
    this.role = role;
    this.code = code.toUpperCase();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed(status?: NetStatus, err?: string) {
    if (status) this.status = status;
    if (err !== undefined) this.error = err;
    this.listeners.forEach((l) => l());
  }

  start() {
    this.changed('opening');
    const opts = { debug: 1, config: ICE_CONFIG };
    const peer = this.role === 'host' ? new Peer(ID_PREFIX + this.code, opts) : new Peer(opts);
    this.peer = peer;
    peer.on('open', () => {
      if (this.role === 'host') {
        this.changed('waiting');
      } else {
        this.changed('connecting');
        const c = peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
        this.attach(c);
        this.joinTimer = window.setTimeout(() => {
          if (this.status === 'connecting') {
            this.changed(
              'error',
              '连不上房主：找到了房间，但两台电脑之间打不通。常见于校园网、公司网或跨国连接。可以都刷新后重开房间再试，或者换个网络（比如手机热点）试试。'
            );
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
      if (this.conn && this.conn.open) {
        c.on('open', () => c.close()); // room is full
        return;
      }
      this.attach(c);
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
      this.changed('error', msg);
    });
    peer.on('disconnected', () => {
      if (this.status !== 'connected' && this.status !== 'closed') peer.reconnect();
    });
  }

  joinTimer = 0;
  /** what the browser's connection is doing right now (shown while joining) */
  iceState = '';

  private attach(c: DataConnection) {
    this.conn = c;
    c.on('open', () => {
      window.clearTimeout(this.joinTimer);
      this.changed('connected', '');
    });
    // surface the WebRTC handshake so a stuck join says where it is stuck
    const watch = () => {
      const pc: RTCPeerConnection | undefined = (c as any).peerConnection;
      if (!pc) return void window.setTimeout(watch, 200);
      const upd = () => {
        this.iceState = pc.iceConnectionState;
        if (pc.iceConnectionState === 'failed' && this.status !== 'connected') {
          this.changed('error', '连接被网络拦住了（直连和中继都没打通）。换个网络，比如手机热点，再试一次。');
        } else this.changed();
      };
      pc.addEventListener('iceconnectionstatechange', upd);
      upd();
    };
    watch();
    c.on('data', (d: any) => this.receive(d as NetMessage));
    c.on('close', () => this.changed('closed', '对方已断开连接'));
    c.on('error', () => this.changed('error', '连接中断'));
  }

  private receive(m: NetMessage) {
    if (m.t === 'in') {
      const r = this.remote;
      r.mx = m.mx;
      r.mz = m.mz;
      r.yaw = m.yaw;
      r.blk = m.blk;
      r.int = !!m.int;
      if (m.req) {
        r.req = m.req;
        r.reqTtl = 0.35;
      }
      return;
    }
    if (m.t === 's') {
      this.snaps.push({ at: performance.now(), msg: m });
      if (this.snaps.length > 3) this.snaps.shift();
      if (m.ev.length) this.inbox.push(...m.ev);
      return;
    }
    if (m.t === 'hello') {
      this.remoteClass = m.cls;
      if (m.name) this.remoteName = m.name.slice(0, 12);
      this.changed();
    }
    this.onMessage?.(m);
  }

  send(m: NetMessage) {
    if (this.conn && this.conn.open) this.conn.send(m);
  }

  close() {
    try {
      this.send({ t: 'bye' });
      window.clearTimeout(this.joinTimer);
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.changed('closed');
  }
}
