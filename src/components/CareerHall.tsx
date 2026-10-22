import React,{useEffect,useState,useSyncExternalStore,useRef} from 'react';
import {career} from '../career';
import {CAREER_HEROES,CAREER_MAPS,CONTRACTS,SKILL_TREE,TRANSFER_LEVEL,BAIBIAN,stepCost} from '../../shared/career.js';
import {CLASS_CONFIGS} from './CombatData';
import {MAPS} from '../maps';
import {getLoadout,setLoadout,WANDER_SLOTS,WANDER_LABEL,getLook,setLook,lookPortrait} from '../wanderer';
import {skillPower} from '../skilltree';
import './career.css';
const portraits={Berserker:'berserker',Ranger:'ranger',BuddhistMage:'monk',Shadowblade:'shadowblade',Emperor:'emperor',Trader:'trader',HeavyHealer:'dixian4'};
const skillDef=(id:string)=>{for(const h of CAREER_HEROES){const s=CLASS_CONFIGS[h].skills.find(k=>k.id===id);if(s)return s}return null};

/** one skill row: icon, name, level / cap, learn button (or why it can't be learned) */
function SkillRow({id,low,s,slot,onSlot}:{id:string;low:boolean;s:any;slot:number;onSlot?:()=>void}){
 const def=skillDef(id),lv=s.skills?.[id]||0,cap=s.hero?(SKILL_TREE[s.hero].includes(id)?10:0):low?(s.baibian?10:5):0;
 const free=s.sp-s.spUsed,canLearn=cap>0&&lv<cap&&free>=stepCost(lv+1)&&!s.busy&&!s.active&&s.ready;
 return <div className={'career-skill'+(cap?'':' locked')+(lv?' learned':'')}>
  <button className="career-skill-main" disabled={!onSlot||!lv} aria-pressed={slot>=0} onClick={onSlot} title={def?.description}>
   <span className="career-skill-icon">{def?.icon}</span><strong>{def?.name}</strong>
   <small>{cap?`Lv ${lv} / ${cap}${lv?` · 伤害 ${Math.round(skillPower(lv)*100)}%`:''}`:s.hero?'非本职业':'转职后可学'}{slot>=0?` · 键 ${WANDER_LABEL[WANDER_SLOTS[slot]]}`:''}</small>
  </button>
  {cap>0&&<button className="career-skill-up" disabled={!canLearn} onClick={()=>career.learn(id)} title={lv>=cap?'已到上限':`消耗 ${stepCost(lv+1)} 技能点`}>{lv>=cap?'满':'+'}</button>}
 </div>;
}

export function CareerHall({name,onClose,onStart}:{name:string;onClose:()=>void;onStart:(hero:any,map:any,kind:string)=>Promise<void>}){
 const root=useRef<HTMLElement>(null);
 const s=useSyncExternalStore(career.subscribe,career.getSnapshot),[pickHero,setPickHero]=useState('Berserker'),[map,setMap]=useState('temple'),[kind,setKind]=useState('scout'),[confirm,setConfirm]=useState(false),[slots,setSlots]=useState<string[]>(getLoadout()),[resetArm,setResetArm]=useState(false),[lookSel,setLookSel]=useState(getLook());
 useEffect(()=>{career.load(name);document.exitPointerLock?.();const old=document.activeElement as HTMLElement;root.current?.focus();const k=(e:KeyboardEvent)=>{e.stopImmediatePropagation();if(e.key==='Escape'){e.preventDefault();onClose()}if(e.key==='Tab'){const els=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')||[]),first=els[0],last=els[els.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}};window.addEventListener('keydown',k,true);return()=>{window.removeEventListener('keydown',k,true);old?.focus()}},[]);
 // a skill that was unlearned (洗点) drops off the bar
 useEffect(()=>{if(s.ready)setSlots(sl=>sl.map(id=>id&&(s.skills?.[id]||0)>0?id:''))},[s.skills,s.ready]);
 const unclassed=!s.hero,wanderer=unclassed&&s.level>=TRANSFER_LEVEL;
 const status=s.hero?'已转职 · '+CLASS_CONFIGS[s.hero].name:wanderer?'散人 · 未转职（'+TRANSFER_LEVEL+'级已到，可随时转职）':'新人 · 未转职（'+TRANSFER_LEVEL+'级可转职）';
 const toggleSlot=(id:string)=>setSlots(sl=>{const k=sl.indexOf(id);if(k>=0){const n=[...sl];n[k]='';return n}const e=sl.indexOf('');if(e<0)return sl;const n=[...sl];n[e]=id;return n});
 const slotted=slots.filter(Boolean).length;
 const heroForRun=s.hero||'Wanderer';
 const footKey=(s.hero||'Wanderer')+':';
 return <div className="career-overlay"><section ref={root} tabIndex={-1} className="career-hall" role="dialog" aria-modal="true" aria-label="百业试炼"><header><div><small>天阙 / 账号成长篇</small><h1>百业试炼</h1><p>见过百种路，再选自己的路。</p></div><button onClick={onClose}>返回大厅 ×</button></header>
 <div className="career-progress"><strong>百业等级 {s.level}</strong><progress max={40*s.level*s.level-40*(s.level-1)**2} value={s.xp-40*(s.level-1)**2}/><span>{status}</span>
  <span className="career-sp"><strong>技能点 {s.sp-s.spUsed}</strong> / 共 {s.sp}</span>
  <button disabled={!s.ready||s.busy||!!s.active||!s.spUsed} onClick={()=>{if(resetArm){career.reset();setResetArm(false)}else setResetArm(true)}} onBlur={()=>setResetArm(false)}>{resetArm?'再点一次确认洗点':'洗点'}</button>
  <small>每升一级 +2 技能点，每张地图第一次交付契约 +3。1 到 5 级每级 1 点，6 到 10 级每级 2 点。</small></div>
 <div className="career-body"><main>
  <h2>一 · {s.hero?CLASS_CONFIGS[s.hero].name+'技能':'七家低阶技能（转职前谁都能学）'}</h2>
  {unclassed?<div className="career-tree">{CAREER_HEROES.map(h=><div key={h} className="career-tree-col"><div className="career-tree-head"><img src={'./portraits/'+portraits[h]+'.png'} alt=""/><strong>{CLASS_CONFIGS[h].name}</strong></div>
   {SKILL_TREE[h].map((id,k)=><SkillRow key={id} id={id} low={k<3} s={s} slot={slots.indexOf(id)} onSlot={k<3?()=>toggleSlot(id):undefined}/>)}</div>)}</div>
  :<div className="career-tree single"><div className="career-tree-col"><div className="career-tree-head"><img src={'./portraits/'+portraits[s.hero]+'.png'} alt=""/><strong>{CLASS_CONFIGS[s.hero].name}</strong><small>低阶 + 高阶 + 大招，最高 10 级</small></div>{SKILL_TREE[s.hero].map((id,k)=><SkillRow key={id} id={id} low={k<3} s={s} slot={-1}/>)}</div></div>}
  {unclassed&&<div className="career-bar"><strong>技能栏</strong>{WANDER_SLOTS.map((sl,k)=>{const d=slots[k]?skillDef(slots[k]):null;return <button key={sl} onClick={()=>slots[k]&&toggleSlot(slots[k])} title={d?'点一下取下':'点上面学会的低阶技能放进来'}><b>{WANDER_LABEL[sl]}</b>{d?<>{d.icon} {d.name}</>:<em>空</em>}</button>})}<small>点学会的技能放上去，再点取下。用别家的招要先换那家的兵器（约半秒），{s.baibian?'百变兵器在手：换兵器瞬间完成。':'得到百变兵器后瞬间完成。'}</small></div>}
  <h2>二 · 足迹遍天下</h2><div className="career-maps">{CAREER_MAPS.filter(id=>MAPS[id]?.available).map(id=><button key={id} aria-pressed={map===id} onClick={()=>setMap(id)}><strong>{MAPS[id].name}</strong><small>{s.discovered.includes(footKey+id)?'已留足迹':'首次 +400经验'}{s.discovered.some((k:string)=>k.endsWith(':'+id))?'':' · +3技能点'}</small></button>)}</div></main>
 <aside><h2>三 · 选择契约</h2>{Object.entries(CONTRACTS).map(([id,c]:[string,any])=><button className="career-contract" key={id} aria-pressed={kind===id} onClick={()=>setKind(id)}><strong>{c.name}</strong><p>{c.detail}</p><small>{c.xp}经验 · 新足迹额外奖励</small></button>)}
 <p>完成战斗条件后必须返回本次出生点，点击“交付契约”。倒下即失败，开菜单与暂停不累计存活时间。</p>
 {s.hero?<div className="career-special"><h2>转职后的修行</h2><p>每完成一份契约获得1枚专精印。3枚后开放战斗流派，可在出发前切换。</p><strong>专精印：{s.mastery}</strong>{s.mastery>=3&&['edge','ward'].map(id=><button key={id} disabled={s.busy} aria-pressed={s.path===id} onClick={()=>career.path(id)}>{id==='edge'?'破势 · 伤害 +8%':'守心 · 最大生命 +15%'}</button>)}</div>
 :<div className="career-wander"><img className="career-wander-face" src={'./'+lookPortrait(lookSel)} alt=""/><h2>{wanderer?'散人之路':'新人'}</h2>
  <div className="career-look">{(['m','f'] as const).map(l=><button key={l} aria-pressed={lookSel===l} onClick={()=>{setLook(l);setLookSel(l)}}><img src={'./'+lookPortrait(l)} alt=""/>{l==='m'?'少年':'少女'}</button>)}<small>一身素衣的年轻人。正式模型做好前，先借{lookSel==='m'?'夜无痕':'沈惊鸿'}的身形，衣服洗成素色。</small></div>
  {wanderer?<><p>不转职就是散人：七家低阶技能全都能学，但没有高阶技能和大招，技能最高 5 级，用别家招式要先换兵器。</p><div className="career-wander-way"><strong>百家印 {Math.min(s.wmastery??0,BAIBIAN)} / {BAIBIAN}</strong><progress max={BAIBIAN} value={Math.min(s.wmastery??0,BAIBIAN)}/><small>{s.baibian?'百变兵器已铸成：换兵器瞬间完成，低阶技能上限升到 10 级。':`以散人身份每完成一份契约得 1 枚。集齐 ${BAIBIAN} 枚铸成百变兵器：一把兵器变化七家形态，换兵器瞬间完成，低阶技能上限升到 10 级。`}</small></div></>
  :<p>还没有职业：用统一的新人外形，七家的低阶技能都可以学来试，挑六招带在身上。{TRANSFER_LEVEL} 级时选一家转职，或者不转职当散人。</p>}
 </div>}
 {unclassed&&s.level>=TRANSFER_LEVEL&&<div className="career-oath"><h2>转职</h2><div className="career-oath-pick">{CAREER_HEROES.map(h=><button key={h} aria-pressed={pickHero===h} onClick={()=>{setPickHero(h);setConfirm(false)}}><img src={'./portraits/'+portraits[h]+'.png'} alt=""/>{CLASS_CONFIGS[h].name}</button>)}</div>
  <p>转职后换上{CLASS_CONFIGS[pickHero].name}的外形，可学全部高阶技能和大招，技能上限 10 级；{CLASS_CONFIGS[pickHero].name}的低阶技能保留，别家技能的点数全部退回。转职不能反悔，也不能再当散人。</p>
  {confirm?<><button disabled={s.busy} onClick={async()=>{if(await career.choose(pickHero))setConfirm(false)}}>确认转职：{CLASS_CONFIGS[pickHero].name}</button><button onClick={()=>setConfirm(false)}>再想想</button></>:<button disabled={!s.ready||!!s.active} onClick={()=>setConfirm(true)}>转职为{CLASS_CONFIGS[pickHero].name}</button>}</div>}
 <button className="career-start" disabled={!s.ready||s.busy||(unclassed&&!slotted)} onClick={()=>{if(unclassed&&!setLoadout(slots))return;onStart(heroForRun,map,kind)}}>{s.busy?'正在连接…':unclassed&&!slotted?'先学一招、放上技能栏':'接下契约 · 以'+(s.hero?CLASS_CONFIGS[s.hero].name:wanderer?'散人':'新人')+'身份出发'}</button>
 <p role="status">{s.error}</p>{s.active&&<button disabled={s.busy} onClick={()=>career.abandon()}>放弃当前契约</button>}{s.receipt&&<p>上一份契约已入账：经验 +{s.receipt.gain}</p>}</aside></div>
 </section></div>
}
export function CareerHud(){const s=useSyncExternalStore(career.subscribe,career.getSnapshot),r=s.run,c=r&&CONTRACTS[r.kind];if(!r)return s.receipt?<div className="career-hud">契约已交付 · 经验 +{s.receipt.gain} · 百业等级 {s.level}<p>按 M 回大厅接下一程。</p></div>:null;const distance=r.origin&&r.position?Math.round(Math.hypot(r.position[0]-r.origin[0],r.position[2]-r.origin[2])):null;return <div className="career-hud"><strong>{c.name} · {CLASS_CONFIGS[r.hero].name}</strong><p>战功 {Math.floor(r.damage)} / {c.damage}（伤害加治疗） · 存活 {Math.floor(r.seconds)} / {c.seconds} 秒</p><p>{r.failed?'契约失败，按 M 返回大厅':r.ready?`返回出生点交付${distance!==null?' · 距离 '+distance+' 米':''}`:'与对手交锋，完成条件后返回出生点。'}</p>{r.origin&&<small>交付点 X {Math.round(r.origin[0])} / Z {Math.round(r.origin[2])}</small>}<button disabled={!r.returned||r.failed||s.busy} onClick={()=>career.finish()}>F · 交付契约</button>{s.error&&<p role="alert">{s.error}</p>}</div>}
