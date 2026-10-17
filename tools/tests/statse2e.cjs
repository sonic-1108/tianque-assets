const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 760 } });
  p.on('pageerror', e => console.log('ERR', e.message.slice(0, 200)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; } });
  await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测试侠客'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', aiLevel: 'easy' })) } catch (e) {} });
  await p.goto('http://127.0.0.1:4181/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-heroes', { timeout: 150000 });
  await p.evaluate(() => { const s = [...document.querySelectorAll('.tq-seg button')].find(x => x.textContent.includes('会还手')); s && s.click(); });
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length > 1 && !(q[0].pos[0] === 0 && q[0].pos[2] === 0); }, null, { timeout: 200000 });
  await new Promise(r => setTimeout(r, 6000));
  // finish one round: the AI drops
  const r = await p.evaluate(async () => {
    const T = globalThis.__TQ; const [me, ai] = T.fighters.current; const wait = (ms) => new Promise(r => setTimeout(r, ms));
    globalThis.__TQ_TURBO = 6;
    ai.hp = 1; ai.pos[0] = me.pos[0]; ai.pos[2] = me.pos[2] - 1.4;
    for (let k = 0; k < 80 && ai.hp > 0; k++) { me.rotY = me.targetRotY = Math.atan2(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]); me.hp = me.maxHp; ai.hp = Math.min(ai.hp, 1); ai.stamina = 0; ai.dodgeCooldownTimer = 9; if (Math.hypot(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]) > 1.6) { ai.pos[0] = me.pos[0]; ai.pos[2] = me.pos[2] - 1.4; } T.input.current.buffer.push({ action: 'attack', timestamp: performance.now() + 4000 }); await wait(120); }
    T.ai.current = true;
    await wait(3000);
    return { aiDown: ai.hp <= 0, acct: JSON.parse(localStorage.getItem('tq_account') || 'null'), toast: (document.body.innerText.match(/修为 \+\d+ · 等级 \d+/) || [''])[0] };
  });
  console.log('round', JSON.stringify(r));
  // the lobby: open 战绩
  await p.keyboard.press('KeyM');
  await p.waitForSelector('.tq-chip', { timeout: 30000 });
  await p.evaluate(() => [...document.querySelectorAll('.tq-chip')].find(x => x.textContent.includes('战绩'))?.click());
  await p.waitForSelector('.tq-st-card', { timeout: 20000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await p.screenshot({ path: './shots/stats_me.png' });
  console.log('panel', await p.evaluate(() => document.querySelector('.tq-st-in')?.innerText.replace(/\n/g, ' | ').slice(0, 300)));
  await p.evaluate(() => [...document.querySelectorAll('.tq-st-tabs button')].find(x => x.textContent.includes('排行榜'))?.click());
  await new Promise(r => setTimeout(r, 1500));
  await p.screenshot({ path: './shots/stats_board.png' });
  await b.close();
})().catch(e => { console.log('CRASH', e.message.slice(0, 300)); process.exit(1); });
