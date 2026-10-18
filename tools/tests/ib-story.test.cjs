const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function fixture(step=3,kind='work'){
 const s={step,deals:0,deal:null}; const t={kind,verb:'',spot:[0,0,0]};const data=new Map();const out={};let completed=0;
 const source=fs.readFileSync('src/ibStory.ts','utf8').replace(/^import .*;$/gm,'').replace(/export /g,'');
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'})+'; Object.assign(out,{sceneFor,openStory,chooseStory,closeStory,retryStory,storySnapshot,tradeBriefed,storyRecord});',{out,ibDelayDeadline:ms=>{s.deal.deadline+=ms},getIb:()=>s,ibTask:()=>t,document:{exitPointerLock(){}},localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},Date});
 return {s,t,out,data,open:()=>out.openStory(()=>completed++),count:()=>completed};
}
test('wrong answer cannot advance; retry and confirmation complete exactly once',()=>{const f=fixture();f.open();f.out.chooseStory(0);f.out.closeStory(true);assert.equal(f.count(),0);assert.ok(f.out.storySnapshot());f.out.retryStory();f.out.chooseStory(1);assert.equal(f.count(),0);f.out.closeStory(true);f.out.closeStory(true);assert.equal(f.count(),1)});
test('leaving dialogue preserves quest and does not award trust',()=>{const f=fixture(0,'go');f.open();f.out.chooseStory(0);f.out.closeStory();assert.equal(f.s.step,0);assert.equal(f.count(),0);assert.equal(f.out.storyRecord().trust,0)});
test('stale dialogue cannot complete replacement task',()=>{const f=fixture();f.open();f.out.chooseStory(1);f.s.step++;f.out.closeStory(true);assert.equal(f.count(),0)});
test('trade briefing requires correct confirmation and expires with task identity',()=>{const f=fixture(4,'trade');f.open();f.out.chooseStory(1);f.out.closeStory(true);assert.equal(f.out.tradeBriefed(),true);f.s.step++;assert.equal(f.out.tradeBriefed(),false)});
test('MD clients retain choice consequences without resetting existing career',()=>{const f=fixture(6,'go');f.s.deals=8;f.t.client=true;f.open();f.out.chooseStory(0);f.out.closeStory(true);assert.equal(f.s.deals,8);assert.equal(f.out.storyRecord().trust,2);assert.match(f.out.storyRecord().last,/人员条款/)});
test('IPO stages ask different questions and each has one valid answer',()=>{const f=fixture(6,'go');f.t.verb='路演';const scenes=[0,1,2].map(i=>f.out.sceneFor(f.t,6,i));assert.equal(new Set(scenes.map(s=>s.text)).size,3);for(const s of scenes)assert.equal(s.choices.filter(c=>c.correct).length,1)});
