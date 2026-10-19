import React, { useEffect, useSyncExternalStore } from 'react';
import { materialById } from '../materials';
import { RECIPES } from '../../shared/materials.js';
import { adventure } from '../adventure';

export function AdventureHud({ lobby = false, onOpen }: { lobby?: boolean; onOpen?: () => void }) {
  const state = useSyncExternalStore(adventure.subscribe, adventure.getSnapshot);
  useEffect(() => { adventure.read(); }, []);
  return <section aria-label="冒险背包" style={lobby ? { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', minWidth: 0 } : {
    position: 'absolute', top: '28%', left: 12, maxWidth: 'min(300px, 78vw)',
    background: 'rgba(15,23,20,.9)', color: '#fef3c7', padding: 12, borderRadius: 10, pointerEvents: 'auto', zIndex: 20,
  }}>
    <strong>冒险背包 · 精铁 × {state.iron}</strong>
    <button className="mt-open" onClick={onOpen}>造物志 · 材料与改造 ↗</button>
    <small>寻材目标：{materialById(lobby ? state.target : state.runTarget).name}</small>
    {!lobby && <p style={{ fontSize: 13, marginTop: 6 }}>
      {state.collected ? '寻材完成！材料已保存。按 M 返回大厅，可再次出发。'
        : state.drop ? '找到发光的材料标本，靠近 2.5 米内自动拾取。'
        : '采石场寻材：沿石径击败试炼守卫，收集精铁与追踪材料。'}
    </p>}
    <small>本机保存 · 云备份状态见战绩</small>
    {state.equipped && <small>改造：{RECIPES.find(r => r.id === state.equipped)?.name}</small>}
    {state.error && <div role="alert"><p>{state.error}</p><button onClick={() => adventure.read()}>重试读取存档</button></div>}
  </section>;
}
