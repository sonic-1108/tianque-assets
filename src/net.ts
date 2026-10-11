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
  req: string | null;
  reqTtl: number;
}

export type NetMessage =
  | { t: 'hello'; cls: CharacterClassId; name?: string }
  | { t: 'cfg'; map: MapId; hostCls: CharacterClassId; guestCls: CharacterClassId; seq: number; hostName?: string }
  | { t: 'in'; mx: number; mz: number; yaw: number; blk: boolean; req: string | null }
  | { t: 's'; f: any[]; p: any[]; m: any; ev: any[] }
  | { t: 're'; e: any }
  | { t: 'bye' };

const ID_PREFIX = 'tianque-1v1-';
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
    const peer = this.role === 'host' ? new Peer(ID_PREFIX + this.code, { debug: 1 }) : new Peer({ debug: 1 });
    this.peer = peer;
    peer.on('open', () => {
      if (this.role === 'host') {
        this.changed('waiting');
      } else {
        this.changed('connecting');
        const c = peer.connect(ID_PREFIX + this.code, { reliable: true, serialization: 'json' });
        this.attach(c);
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

  private attach(c: DataConnection) {
    this.conn = c;
    c.on('open', () => this.changed('connected', ''));
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
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      /* ignore */
    }
    this.changed('closed');
  }
}
