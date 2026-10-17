import React, { useEffect, useState } from 'react';
import { LOOT } from '../maps';
import { WATCH_NAMES } from '../wallet';

// 洛城午后: what you're carrying right now (dropped if you're cut down, banked if you're standing at the end)
export function LootHud() {
  const [haul, setHaul] = useState<string[]>([]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const h = ((globalThis as any).__TQ?.p1?.current?.haul ?? []) as string[];
      setHaul((old) => (old.length === h.length ? old : [...h]));
    }, 200);
    return () => window.clearInterval(id);
  }, []);
  const cash = haul.filter((k) => k.startsWith('cash')).reduce((a, k) => a + (LOOT.kinds.find((x) => x.id === k)?.value ?? 0), 0);
  const watches = haul.filter((k) => !k.startsWith('cash'));
  return (
    <div className="absolute left-4 top-[170px] z-30 pointer-events-none select-none rounded-lg bg-black/55 border border-amber-300/30 px-3 py-1.5 text-[12px] text-amber-100 font-bold tracking-wide" style={{ textShadow: '0 1px 2px #000' }}>
      <div>身上 💵 {cash.toLocaleString()}</div>
      {watches.length > 0 && <div className="text-yellow-200">⌚ {watches.map((w) => WATCH_NAMES[w] ?? w).join(' · ')}</div>}
      <div className="text-[10px] text-amber-200/70 font-normal">倒下会全掉 · 撑到回合结束就存进身家</div>
    </div>
  );
}
