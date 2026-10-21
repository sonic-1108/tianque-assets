export const CAREER_HEROES=['Berserker','Ranger','BuddhistMage','Shadowblade','Emperor','Trader','HeavyHealer'];
export const CAREER_MAPS=['experimental','quarry','losangeles','temple','wending','lavacliff','sea','glacier','forest','desert','rooftop','summit','plankway','coast'];
// `damage` is 战功: damage dealt plus healing done, so a healer can take contracts too
export const CONTRACTS={scout:{name:'试锋取证',damage:300,seconds:30,xp:600,detail:'立下300战功（伤害加治疗），存活30秒，再返回出发点交付。'},risk:{name:'深入夺契',damage:800,seconds:60,xp:1100,detail:'立下800战功（伤害加治疗），存活60秒，再返回出发点交付。失败没有奖励。'}};
export const careerLevel=xp=>Math.floor(Math.sqrt(Math.max(0,xp)/40))+1;
/** 散人: from level 30 an account that hasn't chosen its hero runs contracts as a wanderer with one borrowed move from each hero */
export const WANDERER='Wanderer';
export function allowedHero(s,hero){const lv=careerLevel(s.xp);if(lv<30)return CAREER_HEROES.includes(hero);if(s.hero)return s.hero===hero;return hero===WANDERER;}
export function careerView(row){const s=row?JSON.parse(row.data):{xp:0,hero:null,path:null,mastery:0,discovered:[],active:null,receipt:null};return {wmastery:0,wpath:null,...s,level:careerLevel(s.xp)};}
/** 散人's own way: 3 百家印 (one per contract finished as a 散人) open 博采 (borrowed moves hit at 95%) or 游刃 (borrowed moves cool down as fast as their owners') */
export const WANDER_PATHS={broad:'博采',swift:'游刃'};
export function setWanderPath(s,path){if(s.hero||(s.wmastery||0)<3||!Object.hasOwn(WANDER_PATHS,path)||s.active)throw Error('需要3枚百家印、尚未定职，且当前没有进行中的契约');return {...s,wpath:path};}
export function startContract(s,body,now,id){if(!allowedHero(s,body.hero))throw Error(careerLevel(s.xp)<30?'未知职业':s.hero?'定职后只能使用本命职业':'30级未定职：只能以散人身份出发，或先定职');if(!CAREER_MAPS.includes(body.map)||!Object.hasOwn(CONTRACTS,body.kind))throw Error('未知契约');return {...s,active:{id,hero:body.hero,map:body.map,kind:body.kind,started:now},receipt:null};}
export function finishContract(s,body,now){if(s.receipt?.id===body.runId)return s;const a=s.active,c=a&&CONTRACTS[a.kind];if(!a||a.id!==body.runId)throw Error('契约已失效，请重新接取');if(!allowedHero(s,a.hero))throw Error('请重新接取本命职业契约');if(now-a.started<c.seconds*1000||now-a.started>7200000||!Number.isFinite(body.seconds)||body.seconds<c.seconds||!Number.isFinite(body.damage)||body.damage<c.damage||body.returned!==true||body.alive!==true)throw Error('契约条件未完成');const key=a.hero+':'+a.map,first=!s.discovered.includes(key),gain=c.xp+(first?400:0);return {...s,xp:s.xp+gain,mastery:s.mastery+(s.hero?1:0),wmastery:(s.wmastery||0)+(a.hero===WANDERER?1:0),discovered:first?[...s.discovered,key]:s.discovered,active:null,receipt:{id:a.id,gain,first,hero:a.hero,map:a.map}};}
