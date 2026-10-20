import {mapRuntime,shipOf} from './maps';
import {ensureAccount,getAccount,onAccount,STATS_API} from './stats';
import {CONTRACTS} from '../shared/career.js';
let state:any={xp:0,level:1,hero:null,path:null,mastery:0,discovered:[],active:null,receipt:null,ready:false,error:'',busy:false,run:null};
const listeners=new Set<()=>void>();const update=(p:any)=>{state={...state,...p};listeners.forEach(f=>f())};
let generation=0;
onAccount(()=>{generation++;update({xp:0,level:1,hero:null,path:null,mastery:0,discovered:[],active:null,receipt:null,ready:false,error:'',busy:false,run:null})});
async function request(action:string,data:any={},name='侠客'){
 if(state.busy)throw Error('请等待上一次请求完成');
 if(!STATS_API)throw Error('百业模式需要账号服务器连接，当前预览未配置服务器。');
 const account=await ensureAccount(name),g=generation;
 update({busy:true,error:''});
 try{const r=await fetch(STATS_API+'/career/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...data,id:account.id,code:account.code})});const s=await r.json();if(g!==generation||getAccount()?.id!==account.id)throw Error('账号已切换，请重新进入');if(!r.ok)throw Error(s.error||'服务器暂时不可用');update({...s,ready:true});return s;}finally{if(g===generation)update({busy:false})}
}
export const career={subscribe:(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}},getSnapshot:()=>state,
 async load(name:string){try{await request('state',{},name)}catch(e){update({error:e.message})}},
 async abandon(){try{await request('abandon');update({run:null})}catch(e){update({error:e.message})}},
 async path(path:string){try{await request('path',{path})}catch(e){update({error:e.message})}},
 async choose(hero:string){try{await request('choose',{hero});return true}catch(e){update({error:e.message});return false}},
 async start(hero:string,map:string,kind:string,name:string){try{const s=await request('start',{hero,map,kind},name);update({run:{...s.active,seconds:0,damage:0,origin:null,previousDamage:null,ready:false,failed:false,returned:false},receipt:null});return true}catch(e){update({error:e.message});return false}},
 stop(){update({run:null})},
 tick(p:any,dt:number){const r=state.run;if(!r||r.failed||state.receipt||!p||p.classId!==r.hero)return;if(p.hp<=0){update({run:{...r,failed:true},error:'本次契约失败，回大厅重新接取。'});return}const c=CONTRACTS[r.kind],origin=r.origin?[...r.origin]:[...p.pos];const ship=r.map==='sea'?(r.ship??shipOf(p.pos[0])):null;const shipX=ship===null?0:mapRuntime.shipX[ship];if(r.origin&&ship!==null)origin[0]+=shipX-(r.shipX??shipX);const damage=r.damage+(r.previousDamage===null?0:Math.max(0,p.totalDamageDealt-r.previousDamage));const seconds=r.seconds+Math.min(dt,1);const ready=damage>=c.damage&&seconds>=c.seconds;const returned=ready&&Math.hypot(p.pos[0]-origin[0],p.pos[2]-origin[2])<4&&Math.abs(p.pos[1]-origin[1])<4;update({run:{...r,origin,ship,shipX,position:[...p.pos],damage,seconds,ready,returned,previousDamage:p.totalDamageDealt}})},
 fail(){if(state.run)update({run:{...state.run,failed:true},error:'本次契约失败，回大厅重新接取。'})},
 async finish(){const r=state.run;if(!r||r.failed||!r.returned)return;try{await request('finish',{runId:r.id,seconds:r.seconds,damage:r.damage,returned:true,alive:true});update({run:null})}catch(e){update({error:e.message})}}
};
