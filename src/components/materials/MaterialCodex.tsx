import React, { useEffect, useRef, useState, useSyncExternalStore, Suspense, lazy } from 'react';
import { adventure } from '../../adventure';
import { MATERIALS, materialById, type MaterialId } from '../../materials';
import { RECIPES, materialCount } from '../../../shared/materials.js';
import './materials.css';
const Viewer=lazy(()=>import('./MaterialViewer').then(m=>({default:m.MaterialViewer})));
class ViewerBoundary extends React.Component<{children:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true}}render(){return this.state.failed?<p className="mt-view-fallback">此设备暂时无法显示 3D 标本。下方仍可查看完整材料用途。</p>:this.props.children}}
export function MaterialCodex({onClose}:{onClose:()=>void}) {
  const state=useSyncExternalStore(adventure.subscribe,adventure.getSnapshot);
  const [selected,setSelected]=useState<MaterialId>('copper');
  const [forgeOpen,setForgeOpen]=useState(false);
  const [recipeId,setRecipeId]=useState('storm');
  const [notesTab,setNotesTab]=useState('uses');
  const [rotate,setRotate]=useState(()=>!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const box=useRef<HTMLDivElement>(null);
  const m=materialById(selected), count=materialCount(state,selected);
  useEffect(()=>{adventure.read();const previous=document.activeElement as HTMLElement|null;document.exitPointerLock?.();box.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onClose()}if(e.key==='Tab'){const buttons=Array.from(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')||[]);const first=buttons[0],last=buttons[buttons.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===box.current)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};window.addEventListener('keydown',key,true);const sync=()=>adventure.read();window.addEventListener('storage',sync);return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('storage',sync);previous?.focus()}},[onClose]);
  const recipe=RECIPES.find(r=>r.id===recipeId)!;
  const made=state.crafted.includes(recipe.id), equipped=state.equipped===recipe.id;
  const enough=Object.entries(recipe.costs).every(([id,n])=>materialCount(state,id)>=n);
  return <div className="mt-overlay" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <div className="mt-codex" role="dialog" aria-modal="true" aria-label="造物志 · 材料图鉴" ref={box} tabIndex={-1}>
      <header className="mt-header"><div><span className="mt-eyebrow">青岚工坊 / 材料检视</span><h1>工匠台 <small>拿起一块材料，看看它能变成什么。</small></h1></div><button className="mt-close" onClick={onClose} aria-label="关闭材料图鉴">返回游戏 ×</button></header>
      <div className="mt-body">
        <section className="mt-stage" aria-label={`${m.name}三维标本`}><div className="mt-model"><ViewerBoundary key={selected}><Suspense fallback={<p className="mt-view-fallback">工匠正在点亮工作台…</p>}><Viewer id={selected} rotate={rotate}/></Suspense></ViewerBoundary></div><div className="mt-stage-foot"><span>{m.en}</span><h2>{m.name}</h2><p>拖动查看 · 滚轮靠近</p><button onClick={()=>setRotate(v=>!v)} aria-pressed={rotate}>{rotate?'停止环视':'缓慢环视'}</button></div></section>
        <nav className="mt-nav" aria-label="材料目录"><span className="mt-eyebrow">原材匣</span>{MATERIALS.map((item,i)=><button key={item.id} onClick={()=>setSelected(item.id)} aria-pressed={selected===item.id} className={`mt-item ${selected===item.id?'selected':''}`} style={{'--ore':item.color} as React.CSSProperties}><span className="mt-glyph">{item.glyph}</span><span><small>0{i+1}</small><strong>{item.name}</strong><em>× {materialCount(state,item.id)}</em></span>{state.target===item.id&&<b className="mt-track-dot" aria-label="已追踪">●</b>}</button>)}</nav>
        <section className="mt-notes"><div className="mt-paper-pin"/><div className="mt-label-line"><span className="mt-eyebrow">工匠的材料手记</span><span className="mt-owned">持有 {count}</span></div><h2>{m.name}</h2><p className="mt-description">{m.description}</p><div className="mt-note-tabs">{[['uses','潜在用途'],['source','去哪里找']].map(([id,label])=><button key={id} aria-pressed={notesTab===id} onClick={()=>setNotesTab(id)}>{label}</button>)}</div>
          {notesTab==='uses'?<><div className="mt-uses">{m.uses.map(u=><div key={u.part}><b>{u.part}</b><p>{u.text}</p></div>)}</div><p className="mt-future">{m.future}</p><button className="mt-paper-action" onClick={()=>{const r=RECIPES.find(r=>Object.keys(r.costs).includes(selected));if(r)setRecipeId(r.id);setForgeOpen(true)}}>看看能做什么 →</button></>:<div className="mt-source"><p>{m.source}</p><p>采石场：每次寻材获得 1 份精铁和 1 份追踪原材；追踪精铁时只获得精铁。实验地图可采集指定矿脉，回营交付；守卫额外奖励追踪原材。</p><button onClick={()=>adventure.track(selected)} disabled={state.target===selected}>{state.target===selected?'已记下 · 下次出发寻找它':'记下寻材目标 →'}</button></div>}
        </section>
      </div>
      <section className={`mt-forge ${forgeOpen?'open':''}`}><button className="mt-forge-toggle" onClick={()=>setForgeOpen(v=>!v)} aria-expanded={forgeOpen}><span>⌁ 锻造 · 改造配方</span><small>{state.equipped?`已装备 ${RECIPES.find(r=>r.id===state.equipped)?.name}`:'尚未装备改造'}</small><b>{forgeOpen?'收起 −':'展开 ＋'}</b></button>{forgeOpen&&<div className="mt-forge-drawer"><nav aria-label="改造配方">{RECIPES.map(r=><button key={r.id} aria-pressed={recipeId===r.id} onClick={()=>setRecipeId(r.id)}>{r.slot} · {r.name}</button>)}</nav><div className="mt-recipe"><div><div className="mt-recipe-title"><h3>{recipe.name}</h3>{equipped&&<b>已装备</b>}</div><p>{recipe.effect}</p><small>当前可装备 1 件 · 下次单人寻材或实验地图生效</small></div><div className="mt-costs">{Object.entries(recipe.costs).map(([id,n])=><button key={id} onClick={()=>setSelected(id as MaterialId)} className={materialCount(state,id)<n?'missing':''}>{materialById(id).name}<b>{materialCount(state,id)} / {n}</b></button>)}</div><button className="mt-craft" disabled={!made&&!enough} onClick={()=>made?adventure.equip(equipped?null:recipe.id):adventure.craft(recipe.id)}>{made?(equipped?'卸下改造':'装备改造'):enough?'制作并装备':'还缺一些材料'}</button></div></div>}</section>
      <footer className="mt-footer"><span role="status">{state.error||state.notice||'原材与改造会保留到下一次冒险。'}</span><span>云备份状态见「战绩」</span></footer>
    </div>
  </div>;
}
