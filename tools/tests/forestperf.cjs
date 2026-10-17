// load the forest with draws stubbed (JS cost only), then report load time and what one frame would draw
const { chromium } = require('playwright');
const T0 = Date.now(); const log = (...a) => console.log(((Date.now() - T0) / 1000 | 0) + 's', ...a);
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  p.on('pageerror', e => log('ERR', e.message.slice(0, 300)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) { const o = P[f]; P[f] = function (...a) { const c = globalThis.__CNT ||= { calls: 0, prims: 0 }; c.calls++; const inst = f.includes('Instanced') ? a[a.length - 1] : 1; const cnt = f === 'drawRangeElements' ? a[3] : a[1]; c.prims += (cnt / 3) * inst; }; } } });
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype;
    P.compileShader = function () {}; P.linkProgram = function () {};
    const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); };
    P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; };
    P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'high', qualityPicked: true })) } catch (e) {} });
  await p.goto(process.env.URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  for (let t = 0; t < 20; t++) { const ok = await p.evaluate(() => { if (document.querySelector('.tq-map.on .tq-map-n')?.textContent === '青冥古林') return true; const m = [...document.querySelectorAll('.tq-map')].find(x => x.textContent.includes('青冥古林')); m && m.click(); return false; }); if (ok) break; await new Promise(r => setTimeout(r, 700)); }
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  const g0 = Date.now();
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length > 1 && Math.abs(q[0].pos[2]) > 20; }, null, { timeout: 400000, polling: 500 });
  log('spawned after', (Date.now() - g0) / 1000, 's', await p.evaluate(() => globalThis.__TQ.fighters.current.map(f => f.pos.map(v => +v.toFixed(1)))));
  await new Promise(r => setTimeout(r, 6000));
  const per = await p.evaluate(async () => { const c0 = { ...globalThis.__CNT }; const t0 = performance.now(); let f = 0; await new Promise(r => { const step = () => { f++; if (performance.now() - t0 > 3000) r(); else requestAnimationFrame(step); }; requestAnimationFrame(step); }); const c = globalThis.__CNT; return { frames: f, callsPerFrame: Math.round((c.calls - c0.calls) / f), trisPerFrame: Math.round((c.prims - c0.prims) / f), info: globalThis.__TQ_GL?.info?.memory }; });
  log(JSON.stringify(per));
  await b.close();
})();
