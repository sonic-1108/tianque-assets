import React, { useEffect, useState } from 'react';
import { getIb, ibTitle, ibWhere, ibTask, ibNextTitle } from '../banker';
import { firmAt, mapRuntime } from '../maps';

// 投行家: the career so far and what to do next (洛城午后)
export function QuestHud() {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 300);
    return () => window.clearInterval(id);
  }, []);
  const ib = getIb();
  const t = ibTask();
  const vx = mapRuntime.viewX;
  const vz = mapRuntime.viewZ;
  let where = '';
  let dist = 0;
  if (t) {
    where = ibWhere(t);
    dist = Math.round(Math.hypot(t.spot[0] - vx, t.spot[2] - vz));
    if (t.firm >= 0 && firmAt(vx, vz) === t.firm) {
      const lv = mapRuntime.viewY >= 79.4 ? 2 : mapRuntime.viewY >= 39.4 ? 1 : 0;
      if (lv !== t.level) where += ` · 坐大堂中间的电梯${t.level > lv ? '（上行那部）' : '（下行那部）'}`;
    } else if (t.firm >= 0) where += ' · 公园东边过天桥，在大道边上';
  }
  const D = ib.deal;
  const left = D?.deadline ? Math.max(0, Math.ceil((D.deadline - Date.now()) / 1000)) : 0;
  const nt = ibNextTitle();
  return (
    <div
      className="absolute left-4 top-[232px] z-30 pointer-events-none select-none max-w-[300px] rounded-lg bg-black/60 border border-sky-300/30 px-3 py-2 text-[12px] text-sky-50"
      style={{ textShadow: '0 1px 2px #000' }}
    >
      <div className="font-bold text-amber-200 tracking-wide">投行家 · {ibTitle()}</div>
      {D && (
        <div className="text-[11px] text-amber-100/90">
          {D.name}
          {D.steps.length > 1 ? ` · ${D.i + 1}/${D.steps.length}` : ''} · 奖金 {D.pay.toLocaleString()}
          {left > 0 && <span className={left < 30 ? 'text-red-300 font-bold' : ''}> · 剩 {left} 秒</span>}
        </div>
      )}
      {t && (
        <>
          <div className="mt-0.5 leading-snug">{t.task}</div>
          <div className="mt-0.5 text-[11px] text-sky-200/80">
            📍 {where}
            {dist > 3 ? ` · ${dist} 米` : ''}
          </div>
        </>
      )}
      {ib.entry > 0 && <div className="text-[11px] text-emerald-300">持仓 MSFT @ {ib.entry.toFixed(2)}</div>}
      {ib.step >= 6 && <div className="text-[10px] text-sky-200/60 mt-0.5">已成交 {ib.deals} 单{nt ? ` · 再成 ${nt[1]} 单升 ${nt[0]}` : ''} · 四栋楼 40 层的交易台都能自己做单</div>}
    </div>
  );
}
