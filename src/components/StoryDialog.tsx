import React, { useEffect, useRef } from 'react';
import { storySnapshot, chooseStory, retryStory, closeStory } from '../ibStory';
export function StoryDialog(){
  const d=storySnapshot();const box=useRef<HTMLDivElement>(null);
  useEffect(()=>{box.current?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Tab'){const items=box.current?.querySelectorAll<HTMLButtonElement>('button');if(items?.length){const first=items[0],last=items[items.length-1];if(e.shiftKey&&(document.activeElement===first||document.activeElement===box.current)){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeStory()}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)},[]);
  if(!d)return null;
  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={d.scene.title} className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-amber-200/40 bg-slate-950 p-6 text-slate-100 shadow-2xl">
      <div className="text-amber-300 text-sm">洛城午后 · {d.scene.role}</div><h2 className="text-2xl mt-2">{d.scene.npc} · {d.scene.title}</h2>
      <p className="my-4 leading-7">{d.scene.text}</p><div className="rounded bg-slate-800 p-3 text-sm leading-6">手头资料：{d.scene.evidence}</div>
      {d.reply?<><p role="status" className="my-4 leading-7 text-amber-100">{d.scene.npc}：{d.reply}</p><button autoFocus className="w-full rounded bg-amber-100 text-slate-950 p-3" onClick={()=>d.choice?.correct===false?retryStory():closeStory(true)}>{d.choice?.correct===false?'重新核对资料':'确认并继续'}</button></>:<div className="grid gap-2 my-4">{d.scene.choices.map((c,i)=><button key={c.label} className="text-left rounded border border-slate-600 p-3 hover:bg-slate-800 focus:bg-slate-800" onClick={()=>chooseStory(i)}>{i+1}. {c.label}</button>)}</div>}
      <button className="mt-4 text-sm text-slate-400 underline" onClick={()=>closeStory()}>暂时离开（不完成任务）</button>
    </div>
  </div>
}
