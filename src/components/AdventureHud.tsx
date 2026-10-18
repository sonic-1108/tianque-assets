import React, { useEffect, useSyncExternalStore } from 'react';
import { adventure } from '../adventure';

export function AdventureHud({ lobby = false }: { lobby?: boolean }) {
  const state = useSyncExternalStore(adventure.subscribe, adventure.getSnapshot);
  useEffect(() => { adventure.read(); }, []);
  return <section aria-label="冒险背包" style={lobby ? { padding: '10px 0' } : {
    position: 'absolute', top: '28%', left: 12, maxWidth: 'min(300px, 78vw)',
    background: 'rgba(15,23,20,.9)', color: '#fef3c7', padding: 12, borderRadius: 10, pointerEvents: 'auto', zIndex: 20,
  }}>
    <strong>冒险背包 · 铁料 × {state.iron}</strong>
    {!lobby && <p style={{ fontSize: 13, marginTop: 6 }}>
      {state.collected ? '寻材完成！铁料已保存。按 M 返回大厅，可再次出发。'
        : state.drop ? '找到金色材料标记，靠近 2.5 米内自动拾取。'
        : '采石场寻材：沿石径击败试炼守卫，收集一份铁料。'}
    </p>}
    <small>仅保存在当前浏览器 · 武器制作尚未开放</small>
    {state.error && <div role="alert"><p>{state.error}</p><button onClick={() => adventure.read()}>重试读取存档</button></div>}
  </section>;
}
