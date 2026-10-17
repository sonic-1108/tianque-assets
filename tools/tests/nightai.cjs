const { chromium } = require('playwright');
const T0 = Date.now(); const log = (...a) => console.log(((Date.now() - T0) / 1000 | 0) + 's', ...a);
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  p.on('pageerror', e => log('ERR', e.message.slice(0, 300)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; } });
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype;
    P.compileShader = function () {}; P.linkProgram = function () {};
    const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); };
    P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; };
    P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', qualityPicked: true, aiLevel: 'hell' })) } catch (e) {} });
  await p.goto((process.env.URL || 'http://127.0.0.1:4180/'), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-heroes', { timeout: 150000 });
  await p.evaluate(() => { const s = [...document.querySelectorAll('.tq-seg button')].find(x => x.textContent.includes('会还手')); s && s.click(); });
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  for (let t = 0; t < 20; t++) { const ok = await p.evaluate(() => { if (document.querySelector('.tq-map.on .tq-map-n')?.textContent === '青冥古林') return true; const m = [...document.querySelectorAll('.tq-map')].find(x => x.textContent.includes('青冥古林')); m && m.click(); return false; }); if (ok) break; await new Promise(r => setTimeout(r, 700)); }
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length > 1 && Math.abs(q[0].pos[2]) > 50; }, null, { timeout: 400000, polling: 500 });
  log('in game, ai on:', await p.evaluate(() => globalThis.__TQ.ai.current));
  await p.evaluate(() => { globalThis.__TQ_WEATHER_T = 112; });
  const run = (label, candle, secs) => p.evaluate(async ([candle, secs]) => {
    const T = globalThis.__TQ; const [me, ai] = T.fighters.current;
    const put = (f, x, z) => { f.pos = [x, T.maps.terrainHeight('forest', x, z), z]; f.vel = [0, 0, 0]; f.isGrounded = true; f.actionState = 'idle'; };
    put(me, 60, 80); put(ai, 60, 50); me.hp = me.maxHp; ai.hp = ai.maxHp; me.candle = candle;
    const d0 = Math.hypot(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]); let minD = d0;
    const t0 = performance.now(); while (performance.now() - t0 < secs * 1000) { await new Promise(r => setTimeout(r, 200)); me.candle = candle; me.hp = me.maxHp; minD = Math.min(minD, Math.hypot(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2])); }
    return { night: +T.rt?.night?.toFixed?.(2) || T.maps.mapRuntime?.night, d0: +d0.toFixed(1), minD: +minD.toFixed(1), hpLost: me.maxHp - me.hp };
  }, [candle, secs]).then(r => log(label, JSON.stringify(r)));
  await new Promise(r => setTimeout(r, 12000));
  log('night', await p.evaluate(() => globalThis.__TQ.maps.mapRuntime?.night));
  await run('dark, no candle', 0, 20);
  await run('holding a lit candle', 2, 20);
  await b.close();
})();
