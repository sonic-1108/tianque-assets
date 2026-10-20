export function weaponAppearance(value={}) {
 const defaults={length:1,width:1,steel:'#b8c6ce',trim:'#bf854d',roughness:.32,glow:.55};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('武器外观损坏');
 const a={...defaults,...value};
 for(const [key,min,max] of [['length',.85,1.15],['width',.8,1.3],['roughness',.2,.7],['glow',0,1.5]])if(!Number.isFinite(a[key])||a[key]<min||a[key]>max)throw Error('武器外观参数越界');
 for(const key of ['steel','trim'])if(typeof a[key]!=='string'||!/^#[0-9a-f]{6}$/i.test(a[key]))throw Error('武器颜色无效');
 return Object.fromEntries(Object.keys(defaults).map(key=>[key,a[key]]));
}
export const WEAPON_PARTS = {
 blade:[{id:'iron',name:'百炼精铁',detail:'冷锻银刃 · 稳定伤害',cost:{iron:3}},{id:'copper',name:'雷纹铜脉',detail:'铜脉嵌刃 · 每三击雷鸣',cost:{iron:3,copper:2}}],
 grip:[{id:'leather',name:'旧革缠柄',detail:'深棕皮革 · 工坊免费提供',cost:{}},{id:'silk',name:'风纹丝缠柄',detail:'青玉束丝 · 雷击额外强化',cost:{silk:2}}],
 core:[{id:'none',name:'实心铜镡',detail:'黄铜护手 · 无附加反应',cost:{}},{id:'echo',name:'回响晶核',detail:'紫晶镶嵌 · 重击增伤 20%',cost:{echo:2}},{id:'frost',name:'寒髓晶核',detail:'冰髓镶嵌 · 精准反击回复 2% 生命',cost:{frost:2}}],
};
export const STARTER_WEAPON={id:'starter',name:'营地旧刀',blade:'iron',grip:'leather',core:'none',dropped:null};
export function weaponCosts(spec){const costs={};for(const slot of ['blade','grip','core']){const part=WEAPON_PARTS[slot].find(p=>p.id===spec[slot]);if(!part)throw Error('无效武器部件');for(const [k,n] of Object.entries(part.cost))costs[k]=(costs[k]||0)+n;}return costs;}
export function validateWeapons(s){
 const weapons=s.weapons??[],equipped=s.weaponEquipped??null;
 if(!Array.isArray(weapons)||weapons.length>40)throw Error('武器存档损坏');
 for(const w of weapons){if(!w||typeof w.id!=='string'||w.id.length>80||!w.id||typeof w.name!=='string'||!w.name.trim()||w.name.length>24)throw Error('武器信息损坏');weaponCosts(w);weaponAppearance(w.appearance);if(w.dropped!=null&&(!Array.isArray(w.dropped)||w.dropped.length!==3||!w.dropped.every(n=>Number.isFinite(n)&&Math.abs(n)<1000)))throw Error('掉落位置损坏');}
 if(new Set(weapons.map(w=>w.id)).size!==weapons.length || (equipped!==null&&!weapons.some(w=>w.id===equipped&&!w.dropped)))throw Error('装备状态损坏');
 return {weapons:weapons.map(w=>({...w,appearance:weaponAppearance(w.appearance),dropped:w.dropped?[...w.dropped]:null})),weaponEquipped:equipped};
}
export function weaponReaction(w,hit,heavy,counter){if(!w)return{multiplier:.35,heal:0};return{multiplier:1+(w.blade==='copper'&&hit%3===0?(w.grip==='silk'?.5:.35):0)+(w.core==='echo'&&heavy?.2:0),heal:w.core==='frost'&&counter?.02:0};}
