import { EXPEDITION_NODES, EXPEDITION_CAMP } from '../shared/expedition.js';
import { parseMaterialSave, materialCount, RECIPES, MATERIAL_IDS } from '../shared/materials.js';
export const ADVENTURE_KEY = 'tq_adventure_v1';
export type Point = [number, number, number];
export function createAdventure(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let gathering = 0;
  let state = { experimental:false, accepted:false, samples:[] as string[], pouch:{} as Record<string,number>, nearby: 'camp', progress:0, banked:false, ...parseMaterialSave(null), active:false, collected:false, drop:null as Point|null, defeated:false, error:'', notice:'', runTarget:'copper', runMod:null as string|null };
  const listeners = new Set<()=>void>();
  const update = (patch:Partial<typeof state>) => { state={...state,...patch};listeners.forEach(f=>f()); };
  const load = () => parseMaterialSave(storage.getItem(ADVENTURE_KEY));
  function read() { try { update({...load(),error:''}); } catch { update({error:'材料存档暂时无法读取，原存档未覆盖。请检查存储后重试。'}); } }
  function change(fn:(s:ReturnType<typeof load>)=>void, notice='') {
    try { const saved=load();fn(saved);storage.setItem(ADVENTURE_KEY,JSON.stringify(saved));update({...saved,error:'',notice});return true; }
    catch(e){update({error:String(e.message||e)});return false;}
  }
  return {
    getSnapshot:()=>state,subscribe:(f:()=>void)=>{listeners.add(f);return()=>{listeners.delete(f)}},read,
    start(experimental=false){read();gathering=0;update({experimental,accepted:false,samples:[],pouch:{},nearby:'camp',progress:0,banked:false,active:true,collected:false,drop:null,defeated:false,runTarget:state.target,runMod:state.equipped,notice:''});},
    stop(){update({active:false,drop:null});},
    reset(){gathering=0;update({collected:false,drop:null,defeated:false,accepted:false,samples:[],pouch:{},nearby:'camp',progress:0,banked:false});},
    accept(){if(state.active&&state.experimental&&state.nearby==='camp')update({accepted:true,notice:'石师傅：两处原材就够交差。北边的守卫看着古炉，想多带些材料再去挑战。'});},
    expeditionTick(at:Point,alive:boolean,dt:number){
      if(!state.active||!state.experimental||state.banked)return;
      const near=(x:number,z:number)=>alive&&Math.hypot(at[0]-x,at[2]-z)<2.8&&Math.abs(at[1])<2.5;
      const node=EXPEDITION_NODES.find(n=>!state.samples.includes(n.id)&&near(n.x,n.z));
      const nearby=near(EXPEDITION_CAMP[0],EXPEDITION_CAMP[1])?'camp':node?.id||'';
      if(nearby!==state.nearby){gathering=0;update({nearby,progress:0});}
      if(!state.accepted||!alive)return;
      const extracting=nearby==='camp'&&state.samples.length>=2;
      if(!node&&!extracting){gathering=0;return;}
      gathering+=Math.min(Math.max(dt,0),.1);
      const progress=Math.min(100,Math.floor(gathering/2.5*20)*5);
      if(progress!==state.progress)update({progress});
      if(gathering<2.5)return;
      gathering=0;
      if(node){update({samples:[...state.samples,node.id],pouch:{...state.pouch,[node.material]:(state.pouch[node.material]||0)+2},progress:0,notice:node.name+' · 原材 +2，带回营地才能入库。'});return;}
      if(!change(s=>{const rewards={...state.pouch,iron:(state.pouch.iron||0)+state.samples.length};for(const [id,n] of Object.entries(rewards)){const total=materialCount(s,id)+n;if(!Number.isSafeInteger(total))throw Error('材料数量已达上限');if(id==='iron')s.iron=total;else s.materials[id]=total;}}))return;
      update({banked:true,collected:true,progress:100,notice:'石师傅：这批料收好了。打开造物志，看看能给你的兵器做些什么。'});
    },
    track(id:string){if(!MATERIAL_IDS.includes(id))return false;return change(s=>{s.target=id},'已标记，下次寻材会获得该材料。');},
    craft(id:string){return change(s=>{const r=RECIPES.find(r=>r.id===id);if(!r)throw Error('未知配方');if(s.crafted.includes(id))throw Error('该改造已经制作，无需重复消耗');if(Object.entries(r.costs).some(([k,n])=>materialCount(s,k)<n))throw Error('材料还不够，先追踪需要的材料。');for(const [k,n] of Object.entries(r.costs))k==='iron'?s.iron-=Number(n):s.materials[k]-=Number(n);s.crafted.push(id);s.equipped=id;},'制作完成并装备，下次寻材生效。');},
    equip(id:string|null){return change(s=>{if(id!==null&&!s.crafted.includes(id))throw Error('尚未制作该改造');s.equipped=id},'装备已更新，下次寻材生效。');},
    defeatEnemy(at:Point){if(!state.active||state.defeated)return;if(state.experimental){update({defeated:true,pouch:{...state.pouch,[state.runTarget]:(state.pouch[state.runTarget]||0)+2},notice:'古炉守卫已击败 · 追踪原材 +2，回营地交付。'});return;}update({defeated:true,drop:[...at]});},
    collect(at:Point,alive:boolean){const d=state.drop;if(!state.active||!alive||!d||state.error||Math.hypot(at[0]-d[0],at[2]-d[2])>2.5||Math.abs(at[1]-d[1])>2.5)return false;
      if(!change(s=>{if(s.iron>=Number.MAX_SAFE_INTEGER)throw Error('材料数量已达上限');s.iron++;if(state.runTarget!=='iron'){const n=s.materials[state.runTarget]||0;if(n>=Number.MAX_SAFE_INTEGER)throw Error('材料数量已达上限');s.materials[state.runTarget]=n+1;}})){update({error:'拾取未保存，材料仍在原地。请检查存储后重试。'});return false;}
      update({drop:null,collected:true});return true;
    },
  };
}
export const adventure=createAdventure({getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)});
