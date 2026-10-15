import type { CharacterClassId, FighterSeat } from './types';
import { CLASS_CONFIGS } from './components/CombatData';
import type { RoomSeat } from './net';

/**
 * A room has four seats: 0 and 1 are one side, 2 and 3 the other. Seat 0 is always the host (or you, offline).
 * Every other seat holds a joined player, an AI, or nobody. 1v1, 2v1 and 2v2 are just which seats are filled.
 */
export const SEAT_SIDE = [0, 0, 1, 1];
export const aiName = (cls: CharacterClassId) => `${CLASS_CONFIGS[cls]?.defaultCharacter ?? ''}影`;

export function defaultRoom(hostCls: CharacterClassId, hostName: string, foeCls: CharacterClassId): RoomSeat[] {
  return [
    { kind: 'host', cls: hostCls, name: hostName },
    { kind: 'empty', cls: 'Berserker', name: '' },
    { kind: 'ai', cls: foeCls, name: aiName(foeCls) },
    { kind: 'empty', cls: 'Ranger', name: '' },
  ];
}

/** both sides need someone */
export function roomReady(room: RoomSeat[]) {
  const has = (sd: number) => room.some((s, k) => SEAT_SIDE[k] === sd && s.kind !== 'empty');
  return has(0) && has(1);
}

/** the fighters of a match, in slot order, as this browser (sitting in seat `local`) sees them */
export function lineupOf(room: RoomSeat[], local: number, mapId?: string): { seats: FighterSeat[]; me: number; seatOf: number[] } {
  const seats: FighterSeat[] = [];
  const seatOf: number[] = [];
  let me = 0;
  room.forEach((s, k) => {
    if (s.kind === 'empty') return;
    if (k === local) me = seats.length;
    seatOf.push(k);
    seats.push({
      cls: s.cls,
      side: SEAT_SIDE[k],
      ctl: k === local ? 'local' : s.kind === 'ai' ? 'ai' : 'remote',
      remote: s.kind === 'guest' ? s.id : undefined,
      name: s.kind === 'ai' ? aiName(s.cls) : s.name || (s.kind === 'host' ? '房主' : '侠客'),
    });
  });
  // 长安上元夜: the emperor stands on the main ridge, on nobody's side
  if (mapId === 'rooftop') {
    seatOf.push(-1);
    seats.push({ cls: 'Emperor', side: 2, ctl: 'ai', name: '皇上' });
  }
  return { seats, me, seatOf };
}

/** host: seat newly joined guests (the other side first, then beside the host), free the seats of those who left */
export function seatGuests(room: RoomSeat[], guests: { id: string; cls: CharacterClassId | null; name: string }[], playing: boolean): RoomSeat[] {
  const out = room.map((s) => ({ ...s }));
  const ids = new Set(guests.map((g) => g.id));
  out.forEach((s) => {
    if (s.kind === 'guest' && !ids.has(s.id!)) {
      // left: an AI takes over mid-match so the side isn't one short; in the lobby the seat just empties
      s.kind = playing ? 'ai' : 'empty';
      s.id = undefined;
      s.name = playing ? aiName(s.cls) : '';
    }
  });
  for (const g of guests) {
    let k = out.findIndex((s) => s.kind === 'guest' && s.id === g.id);
    if (k < 0) {
      k = [2, 3, 1].find((n) => out[n].kind === 'empty') ?? [2, 3, 1].find((n) => out[n].kind === 'ai') ?? -1;
      if (k < 0) continue;
      out[k] = { kind: 'guest', id: g.id, cls: g.cls ?? out[k].cls, name: g.name || '侠客' };
    }
    if (g.cls) out[k].cls = g.cls;
    if (g.name) out[k].name = g.name;
  }
  return out;
}
