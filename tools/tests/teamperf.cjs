// 1v1 vs 3v3 on every map, draws stubbed (CPU cost only): load time, frame times, draw calls, memory, errors.
//   npx vite build --outDir /tmp/b --base / && npx vite preview --outDir /tmp/b --port 4180
//   URL=http://127.0.0.1:4180/ MAPS=forest,coast SECS=12 node tools/tests/teamperf.cjs
const { chromium } = require(process.env.PW || 'playwright');
const ALL = { temple: '天阙演武场', lavacliff: '熔岩断崖', sea: '怒海战船', glacier: '雪岭冰峰', rooftop: '长安上元夜', summit: '天阙之巅', forest: '青冥古林', desert: '大漠玉门关', plankway: '悬空栈道', wending: '问鼎原', coast: '落日海岸', losangeles: '洛城午后' };
const maps = (process.env.MAPS || Object.keys(ALL).join(',')).split(',');
const modes = (process.env.MODES || '1,3').split(',').map(Number);
const SECS = +(process.env.SECS || 12);
const T0 = Date.now(); const log = (...a) => console.log(((Date.now() - T0) / 1000 | 0) + 's', ...a);
const room = (n) => {
  const R = [
    { kind: 'host', cls: 'Berserker', name: '测' },
    { kind: n >= 2 ? 'ai' : 'empty', cls: 'Ranger', name: '' },
    { kind: 'ai', cls: 'Trader', name: '' },
    { kind: n >= 2 ? 'ai' : 'empty', cls: 'Shadowblade', name: '' },
    { kind: n >= 3 ? 'ai' : 'empty', cls: 'BuddhistMage', name: '' },
    { kind: n >= 3 ? 'ai' : 'empty', cls: 'Trader', name: '' },
  ];
  return R;
};
(async () => {
  const out = [];
  for (const id of maps) for (const n of modes) {
    const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
    const p = await b.newPage({ viewport: { width: +(process.env.W || 320), height: +(process.env.H || 180) } });
    const errs = [];
    p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 200)));
    p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/WebSocket|mqtt|favicon|relay|api|peer/i.test(t)) errs.push('CE ' + t.slice(0, 200)); });
    await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) { P[f] = function (...a) { const c = globalThis.__CNT ||= { calls: 0, prims: 0 }; c.calls++; const inst = f.includes('Instanced') ? a[a.length - 1] : 1; const cnt = f === 'drawRangeElements' ? a[3] : a[1]; c.prims += (cnt / 3) * inst; }; } } });
    await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype;
      P.compileShader = function () {}; P.linkProgram = function () {};
      const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); };
      P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; };
      P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
    await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'high', qualityPicked: true, sfx: 0, music: 0 })) } catch (e) {} });
    const url = (process.env.URL || 'http://127.0.0.1:4180/') + '?silent=1';
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.tq-maps', { timeout: 200000 });
    for (let t = 0; t < 30; t++) { const ok = await p.evaluate((nm) => { if (document.querySelector('.tq-map.on .tq-map-n')?.textContent === nm) return true; const m = [...document.querySelectorAll('.tq-map')].find(x => x.textContent.includes(nm)); m && m.click(); return false; }, ALL[id]); if (ok) break; await new Promise(r => setTimeout(r, 500)); }
    await p.evaluate((R) => globalThis.__TQ.setRoom(R), room(n));
    await new Promise(r => setTimeout(r, 500));
    await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
    await p.evaluate(() => { globalThis.__LT = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__LT.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch (e) {} });
    const g0 = Date.now();
    await p.evaluate(() => document.querySelector('.tq-go').click());
    const want = n * 2 + (id === 'rooftop' ? 5 : 0);
    let spawned = true;
    try {
      // fighters placed and every hero's skinned model in the scene
      await p.waitForFunction((w) => { const q = globalThis.__TQ?.fighters?.current; if (!(q?.length >= w)) return false; let s = 0; globalThis.__TQ_SCENE?.traverse(o => { if (o.isSkinnedMesh && o.name !== 'Trader undershirt') s++; }); return s >= w; }, want, { timeout: 240000, polling: 250 });
    } catch (e) { spawned = false; }
    const load = (Date.now() - g0) / 1000;
    const lt = await p.evaluate(() => { const a = globalThis.__LT.splice(0); return { ltSum: a.reduce((s, v) => s + v, 0), ltMax: Math.max(0, ...a), ltN: a.length }; });
    await p.evaluate(() => { globalThis.__TQ.ai.current = true; });
    await new Promise(r => setTimeout(r, 3000));
    const m = await p.evaluate(async (secs) => {
      const c0 = { ...(globalThis.__CNT || { calls: 0, prims: 0 }) };
      const gaps = []; let last = performance.now(); const t0 = last; let heapMin = 1e12, heapMax = 0, ftSum = 0, ftN = 0;
      await new Promise(r => { const step = () => { const now = performance.now(); gaps.push(now - last); last = now; const h = performance.memory?.usedJSHeapSize || 0; heapMin = Math.min(heapMin, h); heapMax = Math.max(heapMax, h); if (globalThis.__TQ_FT) { ftSum += globalThis.__TQ_FT; ftN++; } if (now - t0 > secs * 1000) r(); else requestAnimationFrame(step); }; requestAnimationFrame(step); });
      const c = globalThis.__CNT || { calls: 0, prims: 0 }; const f = gaps.length;
      gaps.sort((a, b) => a - b);
      const gl = globalThis.__TQ_GL;
      const alive = globalThis.__TQ.fighters.current.filter(x => x.hp > 0).length;
      return { frames: f, avg: +(gaps.reduce((s, v) => s + v, 0) / f).toFixed(1), p95: +gaps[Math.floor(f * 0.95)].toFixed(1), max: +gaps[f - 1].toFixed(0), over50: gaps.filter(g => g > 50).length, tick: +(ftSum / Math.max(1, ftN)).toFixed(2), calls: Math.round((c.calls - c0.calls) / f), ktris: Math.round((c.prims - c0.prims) / f / 1000), geo: gl?.info?.memory?.geometries, tex: gl?.info?.memory?.textures, prog: gl?.info?.programs?.length, heapMB: Math.round(heapMax / 1048576), heapSwingMB: Math.round((heapMax - heapMin) / 1048576), alive };
    }, SECS);
    const lt2 = await p.evaluate(() => { const a = globalThis.__LT.splice(0); return { playLtMax: Math.max(0, ...a), playLtN: a.length }; });
    const row = { map: id, mode: n + 'v' + n, spawned, load, ...lt, ...m, ...lt2, errs: errs.length };
    out.push(row);
    log(JSON.stringify(row));
    if (errs.length) log('  errors:', [...new Set(errs)].slice(0, 5).join(' | '));
    await b.close();
  }
  require('fs').writeFileSync(process.env.OUT || 'teamperf.json', JSON.stringify(out, null, 1));
})();
