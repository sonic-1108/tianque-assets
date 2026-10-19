import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAdventure, ADVENTURE_KEY } from './adventure-source.mjs';
const storage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) }; };
test('defeat, approach, collect once and reload persisted inventory', () => {
 const s=storage(), a=createAdventure(s); a.start();
 a.defeatEnemy([4,0,0]); a.defeatEnemy([99,0,0]);
 assert.equal(a.collect([0,0,0],true),false);
 assert.equal(a.collect([4,5,0],true),false);
 assert.equal(a.collect([4,0,0],false),false);
 assert.equal(a.collect([4,0,0],true),true);
 assert.equal(a.collect([4,0,0],true),false);
 const b=createAdventure(s); b.read(); assert.equal(b.getSnapshot().iron,1);
 a.stop(); a.defeatEnemy([0,0,0]); assert.equal(a.getSnapshot().drop,null);
 a.start(); a.defeatEnemy([0,0,0]); a.collect([0,0,0],true);
 b.read(); assert.equal(b.getSnapshot().iron,2);
});
test('storage failure preserves loot and retry does not duplicate', () => {
 const s=storage(); let blocked=true;
 const a=createAdventure({...s,setItem:(k,v)=>{if(blocked)throw Error('quota');s.setItem(k,v);}});
 a.start();a.defeatEnemy([0,0,0]);assert.equal(a.collect([0,0,0],true),false);
 assert.ok(a.getSnapshot().drop);assert.equal(a.getSnapshot().iron,0);
 blocked=false;a.read();assert.equal(a.collect([0,0,0],true),true);
 assert.equal(a.getSnapshot().iron,1);
});
test('invalid and future save formats are preserved without awarding loot', () => {
 for (const raw of ['bad','{"version":2,"iron":3}','{"version":1,"iron":-1}','{"version":1,"iron":1.5}']) {
  const s=storage();s.setItem(ADVENTURE_KEY,raw);const a=createAdventure(s);a.start();a.defeatEnemy([0,0,0]);
  assert.equal(a.collect([0,0,0],true),false);assert.equal(s.getItem(ADVENTURE_KEY),raw);
 }
});
test('reset clears unsaved drops but keeps inventory; stopped sessions cannot collect',()=>{
 const a=createAdventure(storage());a.start();a.defeatEnemy([0,0,0]);a.collect([0,0,0],true);
 a.reset();assert.equal(a.getSnapshot().iron,1);assert.equal(a.getSnapshot().defeated,false);
 a.defeatEnemy([0,0,0]);a.stop();assert.equal(a.collect([0,0,0],true),false);
});
