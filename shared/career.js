export const CAREER_HEROES=['Berserker','Ranger','BuddhistMage','Shadowblade','Emperor','Trader','HeavyHealer'];
export const CAREER_MAPS=['experimental','quarry','losangeles','temple','wending','lavacliff','sea','glacier','forest','desert','rooftop','summit','plankway','coast'];
// `damage` is 战功: damage dealt plus healing done, so a healer can take contracts too
export const CONTRACTS={scout:{name:'试锋取证',damage:300,seconds:30,xp:600,detail:'立下300战功（伤害加治疗），存活30秒，再返回出发点交付。'},risk:{name:'深入夺契',damage:800,seconds:60,xp:1100,detail:'立下800战功（伤害加治疗），存活60秒，再返回出发点交付。失败没有奖励。'}};
export const careerLevel=xp=>Math.floor(Math.sqrt(Math.max(0,xp)/40))+1;
// ---------------------------------------------------------------- 荣耀式成长: 新人 → 转职 / 散人
// Every account starts without a class (WANDERER: one plain look). Until it 转职s it may learn the 低阶 skills of
// every hero (the first three of each list below) and carries up to six of them. From level 30 it may 转职: it becomes
// that hero for good, may learn that hero's 高阶 skills and ultimate, and loses every other hero's skills (the points
// come back). An account that stays unclassed past 30 is a 散人: all the 低阶 skills, but capped at Lv 5 and no
// 高阶 / ultimate, until it forges the 百变兵器 (BAIBIAN 百家印, one per contract finished as a 散人): instant weapon
// changes and the cap goes to Lv 10.
export const WANDERER='Wanderer';
export const TRANSFER_LEVEL=30;
export const SKILL_TREE={
 Berserker:['earth_cleave','whirlwind_blade','bull_charge','blood_rage','heaven_collapse'],
 Ranger:['boomerang','pin_dart','swallow_flip','snipe','rain_of_darts'],
 BuddhistMage:['vajra_palm','zen_domain','six_syllable_mantra','golden_bell_shield','ten_thousand_buddhas'],
 Shadowblade:['shadow_step','fan_knives','burrow','chain_hook','thousand_shadows'],
 Emperor:['edict','phantom_guard','jade_seal','palace_cage','true_dragon','royal_guard'],
 Trader:['rolex_throw','make_it_rain','patagonia','short_sell','black_monday'],
 HeavyHealer:['qingfeng','drain_surplus','earth_spring','fold_earth','mortal_realm','recall_soul'],
};
export const LOW_SKILLS=Object.values(SKILL_TREE).flatMap(l=>l.slice(0,3));
export const SKILL_OWNER=Object.fromEntries(Object.entries(SKILL_TREE).flatMap(([h,l])=>l.map(id=>[id,h])));
/** 百家印 needed for the 百变兵器 */
export const BAIBIAN=5;
export const hasBaibian=s=>!s.hero&&careerLevel(s.xp)>=TRANSFER_LEVEL&&(s.wmastery||0)>=BAIBIAN;
/** the highest level this account may take a skill to (0: may not learn it) */
export function skillCap(s,id){if(s.hero)return SKILL_TREE[s.hero]?.includes(id)?10:0;return LOW_SKILLS.includes(id)?(hasBaibian(s)?10:5):0;}
/** points for one level: 1 each up to Lv 5, 2 each after */
export const stepCost=l=>l<=5?1:2;
export const costTo=l=>{let c=0;for(let k=1;k<=l;k++)c+=stepCost(k);return c;};
/** 技能点: 3 to start, 2 a level, 3 for the first contract on each map (whatever the class: like a 任务记录) */
export function spTotal(s){const maps=new Set((s.discovered||[]).map(k=>k.split(':')[1]));return 3+2*(careerLevel(s.xp)-1)+3*maps.size;}
export const spUsed=s=>Object.values(s.skills||{}).reduce((a,l)=>a+costTo(l),0);
export function learnSkill(s,id){if(s.active)throw Error('契约进行中不能加点');const cur=(s.skills||{})[id]||0,cap=skillCap(s,id);if(!cap)throw Error(s.hero?'这不是本职业的技能':'转职后才能学高阶技能和大招');if(cur>=cap)throw Error(s.hero||hasBaibian(s)?'已到等级上限':'散人未得百变兵器，低阶技能最高 5 级');if(spTotal(s)-spUsed(s)<stepCost(cur+1))throw Error('技能点不够');return {...s,skills:{...(s.skills||{}),[id]:cur+1}};}
export function resetSkills(s){if(s.active)throw Error('契约进行中不能洗点');return {...s,skills:{}};}
/** an account from before the skill tree: spread its points so nothing it could use goes dark */
function legacySkills(s){const out={};const list=s.hero?SKILL_TREE[s.hero]||[]:['rolex_throw','pin_dart','bull_charge','vajra_palm','shadow_step','qingfeng'];let free=spTotal({...s,skills:{}});for(let round=1;round<=10&&free>0;round++)for(const id of list){if(round>skillCap(s,id)||free<stepCost(round))continue;out[id]=round;free-=stepCost(round);}return out;}
export function allowedHero(s,hero){return s.hero?s.hero===hero:hero===WANDERER;}
export function careerView(row){const s=row?JSON.parse(row.data):{xp:0,hero:null,path:null,mastery:0,discovered:[],active:null,receipt:null,skills:{}};const v={wmastery:0,...s,level:careerLevel(s.xp)};if(!v.skills)v.skills=legacySkills(v);return {...v,sp:spTotal(v),spUsed:spUsed(v),baibian:hasBaibian(v)};}
/** 转职: that hero for good; its skills keep their points, every other skill's points come back */
export function chooseHero(s,hero){if(careerLevel(s.xp)<TRANSFER_LEVEL)throw Error(TRANSFER_LEVEL+'级后才可转职');if(!CAREER_HEROES.includes(hero))throw Error('未知职业');if(s.hero&&s.hero!==hero)throw Error('已经转职，不能再换');if(s.active)throw Error('契约进行中不能转职');const keep=Object.fromEntries(Object.entries(s.skills||{}).filter(([id])=>SKILL_TREE[hero].includes(id)));return {...s,hero,skills:keep,active:null};}
export function startContract(s,body,now,id){if(!allowedHero(s,body.hero))throw Error(s.hero?'转职后只能使用本职业':'还没转职：以新人／散人身份出发，30级后可转职');if(!CAREER_MAPS.includes(body.map)||!Object.hasOwn(CONTRACTS,body.kind))throw Error('未知契约');return {...s,active:{id,hero:body.hero,map:body.map,kind:body.kind,started:now},receipt:null};}
export function finishContract(s,body,now){if(s.receipt?.id===body.runId)return s;const a=s.active,c=a&&CONTRACTS[a.kind];if(!a||a.id!==body.runId)throw Error('契约已失效，请重新接取');if(!allowedHero(s,a.hero))throw Error('请重新接取本命职业契约');if(now-a.started<c.seconds*1000||now-a.started>7200000||!Number.isFinite(body.seconds)||body.seconds<c.seconds||!Number.isFinite(body.damage)||body.damage<c.damage||body.returned!==true||body.alive!==true)throw Error('契约条件未完成');const key=a.hero+':'+a.map,first=!s.discovered.includes(key),gain=c.xp+(first?400:0);return {...s,xp:s.xp+gain,mastery:s.mastery+(s.hero?1:0),wmastery:(s.wmastery||0)+(a.hero===WANDERER&&careerLevel(s.xp)>=TRANSFER_LEVEL?1:0),discovered:first?[...s.discovered,key]:s.discovered,active:null,receipt:{id:a.id,gain,first,hero:a.hero,map:a.map}};}
