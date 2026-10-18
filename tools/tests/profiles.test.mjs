import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle, SCHEMA } from '../../relay/src/stats.js';
import { validSnapshot } from '../../relay/src/profile.js';
import { verifyAdmin } from '../../relay/src/admin-auth.js';
import { hashFor } from '../admin-codes.mjs';
const empty = () => ({tq_wallet:null,tq_ib:null,tq_adventure_v1:null,tq_ib_story:null});
function fixture(){
 const db=new DatabaseSync(':memory:');SCHEMA.forEach(s=>db.exec(s));
 const q={all:async(sql,...a)=>db.prepare(sql).all(...a),run:async(sql,...a)=>db.prepare(sql).run(...a)};
 const call=async(path,body,admin=false)=>{const req=new Request('https://test/api'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(admin?{'x-tq-admin':'test-only'}:{})},...(body?{body:JSON.stringify(body)}:{})});const r=await handle(req,q,async code=>code==='test-only');return {status:r.status,data:await r.json()}};
 return {db,q,call,register:()=>call('/register',{name:'测试侠客'}).then(r=>r.data)};
}
test('schema upgrades are repeatable; profiles require server authorization and expose no recovery credentials',async()=>{
 const f=fixture();SCHEMA.forEach(s=>f.db.exec(s));const a=await f.register();assert.equal((await f.call('/admin/players')).status,403);
 const list=await f.call('/admin/players',null,true);assert.equal(list.data.players[0].id,a.id);assert.equal(JSON.stringify(list.data).includes('key_hash'),false);assert.equal(JSON.stringify(list.data).includes(a.code),false);
 assert.equal((await f.call('/admin/player?id='+a.id,null,true)).status,200);
});
test('save authentication, initial upload, round trip and account isolation',async()=>{
 const f=fixture(),a=await f.register(),b=await f.register();const data={...empty(),tq_wallet:JSON.stringify({cash:142740,watches:{patek:1}}),tq_ib:JSON.stringify({step:6,deals:8,deal:null})};
 assert.equal((await f.call('/save',{...a,code:b.code,action:'read'})).status,401);
 assert.equal((await f.call('/save',{...a,data,revision:0})).data.revision,1);
 assert.deepEqual((await f.call('/save',{...a,action:'read'})).data.data,data);
 assert.equal((await f.call('/save',{...b,action:'read'})).data.data,null);
});
test('stale revisions cannot overwrite newer progress or recreate missing saves',async()=>{
 const f=fixture(),a=await f.register();assert.equal((await f.call('/save',{...a,data:empty(),revision:5})).status,409);
 assert.equal((await f.call('/save',{...a,data:empty(),revision:0})).status,200);
 const changed={...empty(),tq_adventure_v1:JSON.stringify({version:1,iron:7})};
 const pair=await Promise.all([f.call('/save',{...a,data:changed,revision:1}),f.call('/save',{...a,data:empty(),revision:1})]);
 assert.deepEqual(pair.map(r=>r.status).sort(),[200,409]);assert.equal((await f.call('/save',{...a,data:empty(),revision:0})).status,409);
 assert.equal((await f.call('/save',{...a,action:'read'})).data.data.tq_adventure_v1,changed.tq_adventure_v1);
});
test('snapshot validation rejects unexpected keys and malformed mission data',()=>{
 assert.equal(validSnapshot(empty()),true);
 assert.equal(validSnapshot({...empty(),tq_account:'secret'}),false);
 assert.equal(validSnapshot({...empty(),tq_wallet:'{"cash":-1,"watches":{}}'}),false);
 assert.equal(validSnapshot({...empty(),tq_ib:JSON.stringify({step:6,deals:0,deal:{name:'x',pay:3,i:0,steps:[{}]}})}),false);
});
test('authenticated heartbeat links account; active time excludes long offline gaps',async()=>{
 const f=fixture(),a=await f.register();assert.equal((await f.call('/heartbeat',{...a,code:'wrong'})).status,401);
 await f.call('/heartbeat',{...a,page:'game',map:'洛城午后',hero:'狂刃',active:true});
 await f.q.run('UPDATE activity SET seen=? WHERE player=?',Date.now()-20000,a.id);
 await f.call('/heartbeat',{...a,page:'lobby',active:false});
 let row=(await f.q.all('SELECT * FROM activity WHERE player=?',a.id))[0];assert.ok(row.seconds>=20 && row.seconds<=21);
 await f.q.run('UPDATE activity SET seen=?,active=1 WHERE player=?',Date.now()-100000,a.id);
 await f.call('/heartbeat',{...a,page:'game',active:true});row=(await f.q.all('SELECT * FROM activity WHERE player=?',a.id))[0];assert.ok(row.seconds<=21);
 const profile=await f.call('/admin/players',null,true);assert.equal(profile.data.players[0].online,true);
});
test('daily server passcode validation fails closed and accepts only valid dates',async()=>{
 const now=Date.parse('2026-10-18T18:00:00Z');const cfg={iter:120000,days:{'2026-10-18':hashFor('ABCD-2345','2026-10-18')}};
 assert.equal(await verifyAdmin('ABCD-2345',cfg,now),true);
 assert.equal(await verifyAdmin('ABCD-2346',cfg,now),false);
 assert.equal(await verifyAdmin('ABCD-2345',{iter:120000,days:{}},now),false);
 assert.equal(await verifyAdmin('ABCD-2345',cfg,now+3*86400000),false);
});
