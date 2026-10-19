import { parseMaterialSave, materialCount, RECIPES, MATERIAL_IDS } from '../shared/materials.js';
export const ADVENTURE_KEY = 'tq_adventure_v1';
export type Point = [number, number, number];
export function createAdventure(storage: Pick<Storage, 'getItem' | 'setItem'>) {
  let state = { ...parseMaterialSave(null), active:false, collected:false, drop:null as Point|null, defeated:false, error:'', notice:'', runTarget:'copper', runMod:null as string|null };
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
    start(){read();update({active:true,collected:false,drop:null,defeated:false,runTarget:state.target,runMod:state.equipped,notice:''});},
    stop(){update({active:false,drop:null});},
    reset(){update({collected:false,drop:null,defeated:false});},
    track(id:string){if(!MATERIAL_IDS.includes(id))return false;return change(s=>{s.target=id},'已标记，下次寻材会获得该材料。');},
    craft(id:string){return change(s=>{const r=RECIPES.find(r=>r.id===id);if(!r)throw Error('未知配方');if(s.crafted.includes(id))throw Error('该改造已经制作，无需重复消耗');if(Object.entries(r.costs).some(([k,n])=>materialCount(s,k)<n))throw Error('材料还不够，先追踪需要的材料。');for(const [k,n] of Object.entries(r.costs))k==='iron'?s.iron-=Number(n):s.materials[k]-=Number(n);s.crafted.push(id);s.equipped=id;},'制作完成并装备，下次寻材生效。');},
    equip(id:string|null){return change(s=>{if(id!==null&&!s.crafted.includes(id))throw Error('尚未制作该改造');s.equipped=id},'装备已更新，下次寻材生效。');},
    defeatEnemy(at:Point){if(!state.active||state.defeated)return;update({defeated:true,drop:[...at]});},
    collect(at:Point,alive:boolean){const d=state.drop;if(!state.active||!alive||!d||state.error||Math.hypot(at[0]-d[0],at[2]-d[2])>2.5||Math.abs(at[1]-d[1])>2.5)return false;
      if(!change(s=>{if(s.iron>=Number.MAX_SAFE_INTEGER)throw Error('材料数量已达上限');s.iron++;if(state.runTarget!=='iron'){const n=s.materials[state.runTarget]||0;if(n>=Number.MAX_SAFE_INTEGER)throw Error('材料数量已达上限');s.materials[state.runTarget]=n+1;}})){update({error:'拾取未保存，材料仍在原地。请检查存储后重试。'});return false;}
      update({drop:null,collected:true});return true;
    },
  };
}
export const adventure=createAdventure({getItem:k=>localStorage.getItem(k),setItem:(k,v)=>localStorage.setItem(k,v)});
