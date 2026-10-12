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

const DOT: Record<UnitStats['chips'][number]['tone'], string> = {
  red: '#f87171',
  amber: '#fbbf24',
  green: '#4ade80',
  sky: '#7dd3fc',
  slate: '#cbd5e1',
  gold: '#facc15',
  teal: '#5eead4',
};

const PORTRAIT: Partial<Record<CharacterClassId, string>> = {
  Berserker: `${import.meta.env.BASE_URL}portraits/berserker.png`,
  Ranger: `${import.meta.env.BASE_URL}portraits/ranger.png`,
  BuddhistMage: `${import.meta.env.BASE_URL}portraits/monk.png`,
};

/** Slanted bar. The bright fill snaps to the new value; a pale "ghost" lingers and drains after a hit. */
function Bar({ value, max, height, fill, ghost, track = 'rgba(0,0,0,0.55)' }: { value: number; max: number; height: number; fill: string; ghost?: string; track?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const slant = Math.min(6, height);
  const clip = `polygon(${slant}px 0, 100% 0, calc(100% - ${slant}px) 100%, 0 100%)`;
  return (
    <div className="relative w-full" style={{ height, background: track, clipPath: clip }}>
      {ghost && <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: ghost, transition: 'width 0.6s cubic-bezier(.3,.7,.4,1) 0.3s' }} />}
      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: fill, transition: 'width 0.08s linear' }} />
      {/* a thin highlight along the top edge gives the bar some depth */}
      <div className="absolute inset-x-0 top-0" style={{ height: Math.max(1, height * 0.3), background: 'linear-gradient(rgba(255,255,255,0.28), transparent)' }} />
    </div>
  );
}

export function UnitFrame({ s, me }: { s: UnitStats; me: boolean }) {
  const ratio = s.hp / Math.max(1, s.maxHp);
  const low = ratio < 0.3;
  const size = me ? 60 : 46;
  const width = me ? 250 : 210;
  const hpFill = low
    ? 'linear-gradient(90deg,#7f1d1d,#dc2626)'
    : me
    ? 'linear-gradient(90deg,#991b1b,#dc2626 60%,#f97316)'
    : 'linear-gradient(90deg,#7f1d1d,#be123c 70%,#e11d48)';
  return (
    <div
      className="flex items-center gap-3 pl-1 pr-6 py-1.5"
      style={{ background: 'linear-gradient(90deg, rgba(8,8,12,0.62) 0%, rgba(8,8,12,0.35) 70%, rgba(8,8,12,0) 100%)' }}
    >
      {/* portrait */}
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <div
          className={`absolute inset-0 rounded-full overflow-hidden ${low ? 'animate-pulse' : ''}`}
          style={{
            background: 'radial-gradient(circle at 50% 35%, #3a3340, #121016)',
            boxShadow: me ? '0 0 0 1.5px #d4a74a, 0 0 0 3px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.5)' : '0 0 0 1.5px rgba(255,255,255,0.35), 0 0 0 3px rgba(0,0,0,0.6)',
          }}
        >
          {PORTRAIT[s.classId] ? (
            <img src={PORTRAIT[s.classId]} alt="" className="w-full h-full object-cover" draggable={false} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-amber-200 font-black" style={{ fontSize: size * 0.45, fontFamily: '"Noto Serif SC", "Songti SC", serif', textShadow: '0 0 8px rgba(251,191,36,0.6)' }}>
              {s.className.slice(0, 1)}
            </div>
          )}
          {/* red vignette when close to death */}
          {low && <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 14px rgba(220,38,38,0.85)' }} />}
        </div>
      </div>

      <div className="flex flex-col" style={{ width }}>
        <div className="flex items-baseline gap-2 leading-none mb-1.5">
          <span
            className="truncate text-white font-semibold tracking-wide"
            style={{ fontSize: me ? 15 : 13, textShadow: '0 1px 2px rgba(0,0,0,0.9)', fontFamily: '"Noto Serif SC", "Songti SC", serif' }}
          >
            {s.name}
          </span>
          <span className="text-[10px] text-white/45 shrink-0 tracking-wider">{s.className}</span>
          <span className="ml-auto text-[10px] font-mono text-white/70 shrink-0 tabular-nums" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
            {Math.max(0, Math.round(s.hp))}
            <span className="text-white/35"> / {s.maxHp}</span>
          </span>
        </div>
        <Bar value={s.hp} max={s.maxHp} height={me ? 9 : 7} fill={hpFill} ghost="rgba(255,236,210,0.75)" />
        <div className="mt-[3px]">
          <Bar value={s.mp} max={s.maxMp} height={3} fill="linear-gradient(90deg,#0369a1,#38bdf8)" />
        </div>
        <div className="mt-[2px]" style={{ width: '82%' }}>
          <Bar value={s.stamina} max={s.maxStamina} height={2} fill={s.stamina < 25 ? '#71717a' : 'linear-gradient(90deg,#a16207,#facc15)'} />
        </div>
        {s.chips.length > 0 && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 mt-1.5">
            {s.chips.map((c) => (
              <span key={c.text} className={`flex items-center gap-1 text-[10px] text-white/80 leading-none ${c.pulse ? 'animate-pulse' : ''}`} style={{ textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: DOT[c.tone], boxShadow: `0 0 4px ${DOT[c.tone]}` }} />
                {c.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
