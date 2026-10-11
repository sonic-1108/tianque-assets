import React from 'react';
import type { CharacterClassId } from '../types';

export interface UnitStats {
  name: string;
  classId: CharacterClassId;
  className: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  stamina: number;
  maxStamina: number;
  chips: { text: string; tone: 'red' | 'amber' | 'green' | 'sky' | 'slate' | 'gold' | 'teal'; pulse?: boolean }[];
}

const TONE: Record<UnitStats['chips'][number]['tone'], string> = {
  red: 'bg-red-600/30 text-red-200 border-red-500/70',
  amber: 'bg-amber-500/20 text-amber-200 border-amber-500/50',
  green: 'bg-green-600/25 text-green-200 border-green-500/60',
  sky: 'bg-sky-500/20 text-sky-200 border-sky-500/50',
  slate: 'bg-slate-500/25 text-slate-100 border-slate-300/50',
  gold: 'bg-yellow-500/25 text-yellow-100 border-yellow-400',
  teal: 'bg-teal-500/20 text-teal-100 border-teal-400/60',
};

const GLYPH: Partial<Record<CharacterClassId, { ch: string; ring: string; bg: string }>> = {
  Berserker: { ch: '刃', ring: 'ring-red-500/80', bg: 'from-red-900 via-red-800 to-zinc-900' },
  Ranger: { ch: '镖', ring: 'ring-teal-400/80', bg: 'from-teal-900 via-teal-800 to-zinc-900' },
};

/** A bar with a trailing "damage taken" ghost: the bright fill snaps, the pale ghost catches up later */
function Bar({ value, max, h, fill, ghost, label, labelClass = '' }: { value: number; max: number; h: string; fill: string; ghost?: string; label?: string; labelClass?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className={`relative w-full ${h} bg-black/70 rounded-sm overflow-hidden border border-white/10`}>
      {ghost && <div className={`absolute inset-y-0 left-0 ${ghost}`} style={{ width: `${pct}%`, transition: 'width 0.7s ease-out 0.35s' }} />}
      <div className={`absolute inset-y-0 left-0 ${fill}`} style={{ width: `${pct}%`, transition: 'width 0.08s linear' }} />
      {/* segment ticks every 10% */}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0,0,0,0.35) calc(10% - 1px) 10%)' }} />
      {label && <span className={`absolute inset-0 flex items-center justify-end pr-1.5 font-mono font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)] ${labelClass}`}>{label}</span>}
    </div>
  );
}

export function UnitFrame({ s, me }: { s: UnitStats; me: boolean }) {
  const g = GLYPH[s.classId] ?? GLYPH.Berserker!;
  const low = s.hp / Math.max(1, s.maxHp) < 0.3;
  return (
    <div className={`relative flex gap-2.5 items-start rounded-xl px-2.5 py-2 backdrop-blur-md shadow-xl border ${me ? 'bg-zinc-950/80 border-amber-500/40' : 'bg-zinc-950/70 border-zinc-700/70'} ${me ? 'w-[340px]' : 'w-[300px]'}`}>
      <div
        className={`shrink-0 rounded-full ring-2 ${g.ring} bg-gradient-to-br ${g.bg} flex items-center justify-center font-black text-white shadow-lg ${me ? 'w-14 h-14 text-2xl' : 'w-11 h-11 text-xl'} ${low ? 'animate-pulse' : ''}`}
        style={{ fontFamily: '"Noto Serif SC", "Songti SC", serif' }}
      >
        {g.ch}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className={`truncate font-black ${me ? 'text-amber-200 text-[15px]' : 'text-zinc-100 text-[13px]'}`}>{s.name}</span>
          <span className="text-[10px] text-zinc-400 shrink-0">{s.className}</span>
          {!me && <span className="ml-auto text-[9px] text-red-300/80 shrink-0">对手</span>}
        </div>
        <Bar
          value={s.hp}
          max={s.maxHp}
          h={me ? 'h-[18px]' : 'h-[14px]'}
          fill={low ? 'bg-gradient-to-r from-red-700 to-red-500' : me ? 'bg-gradient-to-r from-red-700 via-red-500 to-orange-400' : 'bg-gradient-to-r from-rose-800 via-rose-600 to-rose-400'}
          ghost="bg-amber-100/80"
          label={`${Math.round(s.hp)} / ${s.maxHp}`}
          labelClass={me ? 'text-[11px] text-white' : 'text-[10px] text-white/90'}
        />
        <div className="flex gap-1 items-center">
          <span className="text-[9px] font-bold text-sky-300 w-5 shrink-0">内力</span>
          <Bar value={s.mp} max={s.maxMp} h="h-[7px]" fill="bg-gradient-to-r from-sky-600 to-cyan-300" />
          <span className="text-[9px] font-mono text-sky-200/80 w-7 text-right shrink-0">{Math.round(s.mp)}</span>
        </div>
        <div className="flex gap-1 items-center">
          <span className="text-[9px] font-bold text-lime-300 w-5 shrink-0">体力</span>
          <Bar value={s.stamina} max={s.maxStamina} h="h-[5px]" fill={s.stamina < 25 ? 'bg-zinc-500' : 'bg-gradient-to-r from-lime-600 to-yellow-300'} />
          <span className="text-[9px] font-mono text-lime-200/80 w-7 text-right shrink-0">{Math.round(s.stamina)}</span>
        </div>
        {s.chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {s.chips.map((c) => (
              <span key={c.text} className={`text-[9px] px-1.5 py-[1px] rounded border font-bold ${TONE[c.tone]} ${c.pulse ? 'animate-pulse' : ''}`}>
                {c.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
