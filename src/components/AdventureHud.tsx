import React, { useEffect, useSyncExternalStore } from 'react';
import { materialById } from '../materials';
import { RECIPES } from '../../shared/materials.js';
import { adventure } from '../adventure';

export function AdventureHud({ lobby = false, onOpen, onForge }: { lobby?: boolean; onOpen?: () => void; onForge?: () => void }) {
  const state = useSyncExternalStore(adventure.subscribe, adventure.getSnapshot);
  useEffect(() => { adventure.read(); }, []);
  return <section aria-label="冒险背包" style={lobby ? { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px', minWidth: 0 } : {
    position: 'absolute', top: '28%', left: 12, maxWidth: 'min(300px, 78vw)',
    background: 'rgba(15,23,20,.9)', color: '#fef3c7', padding: 12, borderRadius: 10, pointerEvents: 'auto', zIndex: 20,
  }}>
    <strong>冒险背包 · 精铁 × {state.iron}</strong>
    <button className="mt-open" onClick={onOpen}>造物志 · 材料与改造 ↗</button>
    <button className="mt-open" onClick={onForge}>铸兵坊 · 武器制造 ↗</button>
    {!lobby&&state.experimental&&<small>手持：{state.runWeapon?.name||'空手 · 回倒下处拾回武器'} · 双方 20,000 生命</small>}
    <small>寻材目标：{materialById(lobby ? state.target : state.runTarget).name}</small>
    {!lobby && !state.experimental && <p style={{ fontSize: 13, marginTop: 6 }}>
      {state.collected ? '寻材完成！材料已保存。按 M 返回大厅，可再次出发。'
        : state.drop ? '找到发光的材料标本，靠近 2.5 米内自动拾取。'
        : '采石场寻材：沿石径击败试炼守卫，收集精铁与追踪材料。'}
    </p>}
    {!lobby && state.experimental && <div style={{fontSize:13,lineHeight:1.65,marginTop:8}}>
      <strong>青岚遗谷 · 实验玩法</strong>
      {!state.accepted ? <><p>石师傅：“去谷里找两处原材。带回来，我教你把它们做进兵器。”</p><button className="mt-open" disabled={state.nearby!=='camp'} onClick={()=>adventure.accept()}>按 F 交谈 · 接下委托</button></> : <>
        <p>{state.banked?'委托完成 · 材料已存入背包':`已采 ${state.samples.length} / 3 处 · 至少两处后回营地交付`}</p>
        {!state.banked && <><p>西侧 · 雷纹铜 / 东侧 · 寒髓石<br/>北侧 · 回响晶（守卫附近）</p><small>靠近标本停留 2.5 秒采集。倒下会回营，样本保留；按 M 离开会放弃未交付样本。</small></>}
        {!!Object.keys(state.pouch).length && <p>{state.banked?'本次带回':'随身样本'}：{Object.entries(state.pouch).map(([id,n])=>`${materialById(id).name} ×${n}`).join('、')}</p>}
        {state.progress>0&&!state.banked&&<div><span>{state.nearby==='camp'?'交付中':'采集中'} {state.progress}%</span><progress style={{width:'100%'}} value={state.progress} max={100}/></div>}
        <p role="status" style={{color:'#dfc598'}}>{state.notice}</p>
        {state.banked&&<p>打开造物志制作改造，按 M 回大厅再次进入。</p>}
      </>}
    </div>}
    <small>本机保存 · 云备份状态见战绩</small>
    {state.equipped && <small>改造：{RECIPES.find(r => r.id === state.equipped)?.name}</small>}
    {state.error && <div role="alert"><p>{state.error}</p><button onClick={() => adventure.read()}>重试读取存档</button></div>}
  </section>;
}
