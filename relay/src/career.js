import {careerView,careerLevel,startContract,finishContract,chooseHero,learnSkill,resetSkills} from '../../shared/career.js';
export async function careerRoute(path,body,p,q,now){
 await q.run('INSERT INTO careers (player,data,revision) VALUES (?,?,0) ON CONFLICT(player) DO NOTHING',p.id,JSON.stringify(careerView(null)));
 const row=(await q.all('SELECT data,revision FROM careers WHERE player = ?',p.id))[0];
 let s=careerView(row);
 if(path==='/career/state')return s;
 if(path==='/career/abandon'){s={...s,active:null};}
 else if(path==='/career/choose')s=chooseHero(s,body.hero);
 else if(path==='/career/path'){
  if(!s.hero||s.mastery<3||!['edge','ward'].includes(body.path)||s.active)throw Error('需要3枚专精印，且当前没有进行中的契约');
  s={...s,path:body.path};
 }else if(path==='/career/learn')s=learnSkill(s,String(body.skill||''));
 else if(path==='/career/reset')s=resetSkills(s);
 else if(path==='/career/start')s=startContract(s,body,now,crypto.randomUUID());
 else if(path==='/career/finish')s=finishContract(s,body,now);
 else throw Error('未知操作');
 // Compare-and-swap prevents overlapping tabs from spending/rewarding the same run twice.
 const {level:_l,sp:_s,spUsed:_u,baibian:_b,...save}=s;
 const changed=await q.all('UPDATE careers SET data = ?,revision = revision + 1 WHERE player = ? AND revision = ? RETURNING revision',JSON.stringify(save),p.id,row.revision);
 if(!changed.length)throw Error('账号进度已在另一页面更新，请刷新重试');
 return careerView({data:JSON.stringify(save)});
}
