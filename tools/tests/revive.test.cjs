const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const out={};
const source=fs.readFileSync('src/revive.ts','utf8').replace(/^import .*;$/gm,'').replace('export function','function');
vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+';out.canRevive=canRevive;',{out});
test('repeated knockouts remain revivable even after the old sentinel count',()=>{
 const c={hp:0,stateDuration:99,revived:0};
 for(let n=0;n<100;n++){assert.equal(out.canRevive(c),true);c.hp=30;c.revived++;assert.equal(out.canRevive(c),false);c.hp=0;}
});
test('special deaths, swimming and unfinished knockouts cannot be revived',()=>{
 const c={hp:0,stateDuration:99};
 assert.equal(out.canRevive({...c,reviveBlocked:true}),false);
 assert.equal(out.canRevive({...c,swimming:true}),false);
 assert.equal(out.canRevive({...c,stateDuration:.5}),false);
 assert.equal(out.canRevive({...c,reviveBlocked:false}),true);
});
