import React, { useEffect, useState } from 'react';
import { mapRuntime, SHRINE, SHRINES } from '../maps';

// 祖坛 score: two bars racing to SHRINE.goal, and a pip per altar showing whose it is (and if it's being taken)
export function ShrineHud() {
  const [v, setV] = useState({ mine: 0, theirs: 0, own: [-1, -1, -1], prog: [0, 0, 0], busy: [0, 0, 0], side: 0, on: false });
  useEffect(() => {
    const id = window.setInterval(() => {
      const S = mapRuntime.shrine;
      const side = Math.min(1, mapRuntime.viewSide ?? 0);
      setV({ mine: S.score[side], theirs: S.score[1 - side], own: [...S.own], prog: [...S.prog], busy: [...S.busy], side, on: S.on });
    }, 120);
    return () => window.clearInterval(id);
  }, []);
  if (!v.on) return null;
  const pct = (n: number) => `${Math.min(100, (n / SHRINE.goal) * 100)}%`;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[148px] z-30 pointer-events-none select-none" style={{ width: 360 }}>
      <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest">
        <span className="text-emerald-300 w-10 text-right tabular-nums">{Math.floor(v.mine)}</span>
        <div className="flex-1 h-2.5 rounded-full bg-black/55 overflow-hidden border border-white/15 flex">
          <div className="h-full bg-emerald-400" style={{ width: pct(v.mine) }} />
        </div>
        <span className="text-stone-300">祖坛</span>
        <div className="flex-1 h-2.5 rounded-full bg-black/55 overflow-hidden border border-white/15 flex justify-end">
          <div className="h-full bg-red-400" style={{ width: pct(v.theirs) }} />
        </div>
        <span className="text-red-300 w-10 tabular-nums">{Math.floor(v.theirs)}</span>
      </div>
      <div className="flex justify-center gap-3 mt-1.5">
        {SHRINES.map((sh, k) => {
          const own = v.own[k];
          const col = own < 0 ? 'bg-stone-500/80' : own === v.side ? 'bg-emerald-500' : 'bg-red-500';
          const taking = v.busy[k] === 3 ? '争夺中' : v.busy[k] && Math.abs(v.prog[k]) < 1 ? `${Math.round(Math.abs(v.prog[k]) * 100)}%` : '';
          return (
            <div key={k} className={`px-2 py-0.5 rounded-md text-[11px] font-bold text-white/95 border border-white/20 shadow ${col}`}>
              {sh.name}
              {taking && <span className="ml-1 text-[10px] text-yellow-200">{taking}</span>}
            </div>
          );
        })}
      </div>
      <div className="text-center text-[10px] text-stone-300/80 mt-1" style={{ textShadow: '0 1px 2px #000' }}>
        占的祖坛越多分涨得越快 · 先到 {SHRINE.goal} 分赢 · 倒下 {SHRINE.respawn} 秒后在营地重生
      </div>
    </div>
  );
}
