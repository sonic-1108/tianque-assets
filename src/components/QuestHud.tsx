import React, { useEffect, useState } from 'react';
import { getIb, ibTitle, ibWhere, IB_STEPS } from '../banker';
import { FIRMS, firmAt, mapRuntime, IB_SPOTS } from '../maps';

// 投行家: the career so far and what to do next (洛城午后)
export function QuestHud() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 300);
    return () => window.clearInterval(id);
  }, []);
  const ib = getIb();
  const st = IB_STEPS[ib.step];
  const vx = mapRuntime.viewX;
  const vz = mapRuntime.viewZ;
  let where = '';
  let dist = 0;
  if (st) {
    where = ibWhere(st);
    const [x, , z] = IB_SPOTS[st.spot];
    dist = Math.round(Math.hypot(x - vx, z - vz));
    if (st.firm >= 0 && firmAt(vx, vz) === st.firm) {
      const lv = mapRuntime.viewY >= 79.4 ? 2 : mapRuntime.viewY >= 39.4 ? 1 : 0;
      if (lv !== st.level) where += ` · 去大堂中间的电梯${st.level > lv ? '（上行那部）' : '（下行那部）'}`;
    } else if (st.firm >= 0) where += ` · 从公园东边的天桥过高速，就在大道边上`;
  }
  return (
    <div
      className="absolute left-4 top-[232px] z-30 pointer-events-none select-none max-w-[300px] rounded-lg bg-black/60 border border-sky-300/30 px-3 py-2 text-[12px] text-sky-50"
      style={{ textShadow: '0 1px 2px #000' }}
    >
      <div className="font-bold text-amber-200 tracking-wide">投行家 · {ibTitle()}</div>
      {st ? (
        <>
          <div className="mt-0.5 leading-snug">{st.task}</div>
          <div className="mt-0.5 text-[11px] text-sky-200/80">
            📍 {where}
            {dist > 3 ? ` · ${dist} 米` : ''}
          </div>
          {ib.entry > 0 && <div className="text-[11px] text-emerald-300">持仓 MSFT @ {ib.entry.toFixed(2)}</div>}
        </>
      ) : (
        <div className="mt-0.5 leading-snug text-[11px]">你已经是 MD 了。{FIRMS[2].name} 40 层的交易台随时能来做单，赚的亏的都算进身家</div>
      )}
    </div>
  );
}
