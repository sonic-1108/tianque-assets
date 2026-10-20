import React,{useState,useSyncExternalStore,useEffect,useRef} from 'react';
import {adventure} from '../../adventure';
import {WEAPON_PARTS,weaponCosts,weaponAppearance} from '../../../shared/weapons.js';
import {materialCount} from '../../../shared/materials.js';
import {materialById} from '../../materials';
import {WeaponViewer} from './WeaponViewer';
import './forge.css';
export function WeaponForge({onClose}:{onClose:()=>void}){
 const s=useSyncExternalStore(adventure.subscribe,adventure.getSnapshot);
 const [design,setDesign]=useState({blade:'copper',grip:'leather',core:'none',appearance:weaponAppearance()}),[name,setName]=useState('雷纹长刀'),[tab,setTab]=useState('blade');
 const root=useRef<HTMLDivElement>(null);const costs=weaponCosts(design);const canMake=!s.active&&Object.entries(costs).every(([id,n])=>materialCount(s,id)>=Number(n));
 useEffect(()=>{adventure.read();document.exitPointerLock?.();const old=document.activeElement as HTMLElement;root.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onClose()}if(e.key==='Tab'){const els=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input')||[]),first=els[0],last=els[els.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);old?.focus()}},[onClose]);
 return <div className="wf-overlay" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}><div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="武器制造工坊" className="wf-shell">
 <header><div><small>青岚 · 铸兵坊 / 第一卷</small><h1>一炉，一刃。</h1></div><button onClick={onClose} aria-label="关闭武器工坊">返回 ×</button></header>
 <div className="wf-layout"><section className="wf-scene"><WeaponViewer design={design}/><div className="wf-caption"><small>长刀 / 实时锻造预览</small><h2>{name||'无名长刀'}</h2><p>拖动检视刀身 · 滚轮查看铜脉与镶嵌</p></div><div className="wf-seal">铸<br/>兵</div></section>
 <aside><div className="wf-chapters">{[['blade','01','刀刃'],['grip','02','握柄'],['core','03','晶核'],['look','04','外观']].map(([id,n,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}><small>{n}</small>{label}</button>)}</div>
 <p className="wf-intro">材料留下自己的纹路，也决定这把刀的反应。</p>
 <div className="wf-options">{tab==='look'?<div className="wf-custom"><p>调整即刻显示，制造后保留。尺寸与颜色不改变伤害或攻击距离。</p>{[['length','刀身比例',.85,1.15],['width','刀身宽度',.8,1.3],['roughness','磨砂程度',.2,.7],['glow','晶脉亮度',0,1.5]].map(([key,label,min,max])=><label key={key}>{label}<output>{Number(design.appearance[key]).toFixed(2)}</output><input aria-label={String(label)} type="range" min={min} max={max} step=".01" value={design.appearance[key]} onChange={e=>setDesign({...design,appearance:{...design.appearance,[key]:Number(e.target.value)}})}/></label>)}{[['steel','刀身色泽'],['trim','镶边色泽']].map(([key,label])=><label key={key}>{label}<input aria-label={label} type="color" value={design.appearance[key]} onChange={e=>setDesign({...design,appearance:{...design.appearance,[key]:e.target.value}})}/></label>)}</div>:WEAPON_PARTS[tab].map(part=><button key={part.id} aria-pressed={design[tab]===part.id} onClick={()=>setDesign({...design,[tab]:part.id})}><span>{part.name}</span><small>{part.detail}</small><em>{Object.entries(part.cost).map(([id,n])=>`${materialById(id).name} ×${n}`).join(' · ')||'无需额外材料'}</em></button>)}</div>
 <div className="wf-result"><small>成刃反应</small><p>{design.blade==='copper'?`每第三次有效近战命中，额外造成 ${design.grip==='silk'?50:35}% 伤害。`:'精铁刀身，稳定的基础伤害。'}</p>{design.core==='echo'&&<p>重击伤害额外提高 20%。</p>}{design.core==='frost'&&<p>精准反击命中，回复 2% 最大生命。</p>}<small>仅实验地图生效 · 可与已装备改造叠加</small></div>
 <label className="wf-name">为它留一个名字<input maxLength={24} value={name} onChange={e=>setName(e.target.value)} placeholder="无名长刀"/></label>
 <div className="wf-cost">{Object.entries(costs).map(([id,n])=><span key={id} className={materialCount(s,id)<Number(n)?'missing':''}>{materialById(id).name}<b>{materialCount(s,id)} / {String(n)}</b></span>)}</div>
 <button className="wf-create" disabled={!canMake} onClick={()=>adventure.forgeWeapon(design,name)}>{s.active?'回大厅后可制造':'锻造此刀 · 制作并装备'}</button><p role="status" className="wf-status">{s.error||s.notice||(!canMake?'原料不足，先去遗谷寻材。':'制作会消耗上方材料。')}</p>
 </aside></div>
 <section className="wf-rack"><div><h2>我的兵器架</h2><small>进入遗谷时佩戴。死亡会掉落，回到原处可拾回。</small></div>{s.weapons.length===0?<p>还没有自制兵器。营地会借给你一把旧刀。</p>:s.weapons.map(w=><button key={w.id} disabled={s.active||!!w.dropped} aria-pressed={s.weaponEquipped===w.id} onClick={()=>adventure.equipWeapon(w.id)}><strong>{w.name}</strong><small>{w.dropped?'遗落在青岚遗谷 · 可回去寻找':s.weaponEquipped===w.id?'已选为出发武器':'选为出发武器'}</small></button>)}</section>
 </div></div>
}
