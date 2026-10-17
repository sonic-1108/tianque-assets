const { chromium } = require('playwright');
const LV = process.argv[2] || 'normal';
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  p.on('pageerror', e => console.log('ERR', e.message.slice(0, 200)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; } });
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype;
    P.compileShader = function () {}; P.linkProgram = function () {};
    const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); };
    P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; };
    P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript((lv) => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', aiLevel: lv })) } catch (e) {} }, LV);
  await p.goto(process.env.URL || (process.env.URL || 'http://127.0.0.1:4180/'), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-heroes', { timeout: 150000 });
  await p.evaluate(() => { const s = [...document.querySelectorAll('.tq-seg button')].find(x => x.textContent.includes('会还手')); s && s.click(); });
  const lobbyLv = await p.evaluate(() => document.querySelector('.tq-lvl button.on')?.textContent);
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length > 1 && !(q[0].pos[0] === 0 && q[0].pos[2] === 0); }, null, { timeout: 200000 });
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(() => { globalThis.__TQ_TURBO = 6; });
  const r = await p.evaluate(async () => {
    const T = globalThis.__TQ; const [me, ai] = T.fighters.current; const wait = (ms) => new Promise(r => setTimeout(r, ms));
    let gt = 0, last = performance.now(); const tick = () => { const n = performance.now(); gt += (n - last) / 1000; last = n; };
    ai.pos[0] = me.pos[0]; ai.pos[2] = me.pos[2] - 2.2; ai.pos[1] = me.pos[1];
    // phase 1: you stand still, it fights you
    let taken = 0, t0 = gt; let hp = me.hp;
    while (gt - t0 < 45) { await wait(50); tick(); if (Math.hypot(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]) > 4) { ai.pos[0] = me.pos[0]; ai.pos[2] = me.pos[2] - 2.2; } if (me.hp < hp) taken += hp - me.hp; me.hp = me.maxHp; hp = me.hp; ai.hp = ai.maxHp; }
    // phase 2: you keep swinging at it
    let dealt = 0, blocks = 0; t0 = gt; let ahp = ai.hp;
    while (gt - t0 < 45) { await wait(50); tick(); me.hp = me.maxHp; if (Math.hypot(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]) > 1.6) { me.pos[0] = ai.pos[0] + 1.2; me.pos[2] = ai.pos[2]; } me.rotY = me.targetRotY = Math.atan2(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]); T.input.current.buffer.push({ action: 'attack', timestamp: performance.now() + 4000 }); if (ai.hp < ahp) dealt += ahp - ai.hp; if (ai.isBlocking || ai.actionState === 'dodge') blocks++; ai.hp = ai.maxHp; ahp = ai.hp; }
    return { gameSec: Math.round(gt), taken: Math.round(taken), dealt: Math.round(dealt), fps: globalThis.__TQ_PERF?.fps, defendSamples: blocks, hud: (document.body.innerText.match(/AI (简单|中等|困难|地狱)/) || [''])[0] };
  });
  console.log(LV, 'lobby=' + lobbyLv, JSON.stringify(r));
  await b.close();
})().catch(e => { console.log(LV, 'CRASH', e.message.slice(0, 200)); process.exit(1); });
