// 悬空栈道 mechanics: wind at the edge, rolling at the edge, the chain, breaking a plank, AI over a bridge / by the chain
const { chromium } = require('playwright');
const T0 = Date.now(); const log = (...a) => console.log(((Date.now() - T0) / 1000 | 0) + 's', ...a);
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  p.on('pageerror', e => log('ERR', e.message.slice(0, 300)));
  p.on('console', m => { const t = m.text(); if (m.type() === 'error' && !/WebSocket|mqtt|favicon/.test(t)) log('CE', t.slice(0, 200)); });
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; } });
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype;
    P.compileShader = function () {}; P.linkProgram = function () {};
    const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); };
    P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; };
    P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low' })) } catch (e) {} });
  await p.goto(process.env.URL || (process.env.URL || 'http://127.0.0.1:4180/'), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-heroes', { timeout: 150000 });
  await p.waitForFunction(() => globalThis.__TQ?.maps);
  await p.evaluate(() => { const s = [...document.querySelectorAll('.tq-seg button')].find(x => x.textContent.includes('会还手')); s && s.click(); });
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  for (let t = 0; t < 20; t++) { const ok = await p.evaluate(() => { if (document.querySelector('.tq-map.on .tq-map-n')?.textContent === '悬空栈道') return true; const m = [...document.querySelectorAll('.tq-map')].find(x => x.textContent.includes('悬空栈道')); m && m.click(); return false; }); if (ok) break; await new Promise(r => setTimeout(r, 700)); }
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  log('card', await p.evaluate(() => !!document.querySelector('img[src*="plankway"]')));
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length > 1 && q[0].pos[0] < -10; }, null, { timeout: 200000 });
  await new Promise(r => setTimeout(r, 2500));
  await p.evaluate(() => { globalThis.__TQ_TURBO = 6; });
  const run = (name, fn, arg) => p.evaluate(fn, arg).then(r => log(name, JSON.stringify(r))).catch(e => log(name, 'THREW', e.message.slice(0, 200)));
  const H = `const T = globalThis.__TQ; const M = T.maps; const [me, ai] = T.fighters.current; const P = T.rt.plank;
    const put = (f, x, z, y) => { f.pos[0] = x; f.pos[2] = z; f.pos[1] = y ?? M.terrainHeight('plankway', x, z); f.vel[0] = f.vel[1] = f.vel[2] = 0; f.isGrounded = true; f.actionState = 'idle'; f.stateTimer = 0; f.zip = undefined; };
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const park = () => { put(ai, 19, -8); ai.hp = ai.maxHp; };`;
  /*1 at the road's edge: idle at the edge, you stay on the road
  await run('wind', new Function(`return (async () => { ${H}
    T.ai.current = false; put(me, -6, -6.9); P.gustNext = 0.05; const out = []; let minZ = 9, maxZ = -9, fell = false;
    const t0 = performance.now(); while (performance.now() - t0 < 9000) { await wait(60); me.hp = me.maxHp; maxZ = Math.max(maxZ, me.pos[2]); if (me.pos[1] < -1) fell = true; }
    T.ai.current = true; return { warnSeen: true, gustDir: P.gustDir, maxZ: +maxZ.toFixed(2), roadEdge: M.PLANK.roadZ, fell, y: +me.pos[1].toFixed(2) }; })()`));
  // 2. rolling at the edge doesn't take you over
  await run('dodge', new Function(`return (async () => { ${H}
    park(); put(me, -6, -6.8); me.rotY = me.targetRotY = Math.PI; let fell = false; // facing +z (out over the edge)
    for (let k = 0; k < 4; k++) { me.dodgeCooldownTimer = 0; me.stamina = 100; T.input.current.buffer.push({ action: 'dodge', timestamp: performance.now() + 4000 }); for (let n = 0; n < 25; n++) { await wait(40); if (me.pos[1] < -1) fell = true; } }
    return { fell, z: +me.pos[2].toFixed(2), y: +me.pos[1].toFixed(2) }; })()`));
  */
  /*3: F at the step end, off at the peak
  await run('chain', new Function(`return (async () => { ${H}
    park(); const C = M.PLANK.chain; put(me, C.ax, C.az + 0.4, M.PLANK.step.h); await wait(200);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true })); await wait(120); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
    let rode = false, minY = 9; const t0 = performance.now(); while (performance.now() - t0 < 6000) { await wait(50); if (me.zip) rode = true; if (rode) minY = Math.min(minY, me.pos[1]); if (rode && !me.zip) break; }
    return { rode, end: me.pos.map(v => +v.toFixed(2)), onPeak: Math.hypot(me.pos[0] - M.PLANK.peak.x, me.pos[2] - M.PLANK.peak.z) < M.PLANK.peak.r, minY: +minY.toFixed(2), hint: me.interactHint }; })()`));
  */
  // 4. a plank breaks under the AI (a dummy, standing still): hit it until it goes; it falls into the cloud
  await run('plank', new Function(`return (async () => { ${H}
    T.ai.current = false; P.gust = 0; P.gustWarn = 0; P.gustNext = 999;
    const B = M.PLANK.bridges[1]; const t = 0.5; const x = B.ax + (B.bx - B.ax) * t, z = B.az + (B.bz - B.az) * t;
    put(ai, x, z); ai.hp = ai.maxHp; const q = M.plankAt(x, z);
    const t2 = 0.42, mx = B.ax + (B.bx - B.ax) * t2, mz = B.az + (B.bz - B.az) * t2; put(me, mx, mz); const hp0 = P.hp[q.k][q.i];
    let broke = false, aiFell = false, out = false, hits = 0, last = ai.hp; const seq = [];
    const t0 = performance.now(); while (performance.now() - t0 < 30000) {
      me.hp = me.maxHp; if (ai.hp < 300) ai.hp = 1500; me.rotY = me.targetRotY = Math.atan2(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]);
      { const L = Math.hypot(B.bx - B.ax, B.bz - B.az), ux = (B.bx - B.ax) / L, uz = (B.bz - B.az) / L;
        if (me.pos[1] < -1 || Math.hypot(me.pos[0] - ai.pos[0], me.pos[2] - ai.pos[2]) > 1.6) { if (ai.pos[1] > -1 && M.plankAt(ai.pos[0] - ux, ai.pos[2] - uz)) put(me, ai.pos[0] - ux, ai.pos[2] - uz); } }
      const qa = M.plankAt(ai.pos[0], ai.pos[2]); if (qa && P.hp[qa.k][qa.i] <= 0) broke = true;
      T.input.current.buffer.push({ action: 'attack', timestamp: performance.now() + 4000 }); await wait(120);
      if (ai.hp < last) hits++; last = ai.hp; seq.push(P.hp[q.k][q.i]);
      if (P.hp[q.k][q.i] <= 0) broke = true; if (ai.pos[1] < -2) aiFell = true; if (aiFell && ai.pos[1] > -1) { out = true; break; } }
    T.ai.current = true;
    return { row: P.hp[1].join(""), regrow: P.regrow[1].map(v => Math.round(v)).join(","), plank: [q.k, q.i], hp0, hits, plankHpSeen: [...new Set(seq)], broke, aiFell, respawned: out, aiAt: ai.pos.map(v => +v.toFixed(1)), regrowIn: +P.regrow[q.k][q.i].toFixed(1) }; })()`));
  /*5 the AI walks to you on the peak (over a bridge)
  await run('aiBridge', new Function(`return (async () => { ${H}
    for (const row of P.hp) row.fill(M.PLANK.plankHp); put(ai, 17, -5); ai.hp = ai.maxHp; put(me, 0, 9.5, M.PLANK.peak.h);
    let best = 99; const t0 = performance.now(); while (performance.now() - t0 < 20000) { await wait(100); me.hp = me.maxHp; ai.hp = Math.max(ai.hp, 500); put(me, 0, 9.5, M.PLANK.peak.h); best = Math.min(best, Math.hypot(ai.pos[0] - me.pos[0], ai.pos[2] - me.pos[2])); if (best < 4.5) break; if (ai.pos[1] < -2) return { fell: true, at: ai.pos }; }
    return { closest: +best.toFixed(1), aiAt: ai.pos.map(v => +v.toFixed(1)) }; })()`));
  // 6. both bridges broken: the AI takes the chain
  await run('aiChain', new Function(`return (async () => { ${H}
    for (let k = 0; k < 2; k++) { const i = Math.floor(P.hp[k].length / 2); P.hp[k][i] = 0; P.regrow[k][i] = 999; }
    put(ai, 17, -5); ai.hp = ai.maxHp; put(me, 0, 9.5, M.PLANK.peak.h);
    let rode = false, best = 99; const t0 = performance.now(); while (performance.now() - t0 < 30000) { await wait(100); me.hp = me.maxHp; ai.hp = Math.max(ai.hp, 500); put(me, 0, 9.5, M.PLANK.peak.h); if (ai.zip) rode = true; best = Math.min(best, Math.hypot(ai.pos[0] - me.pos[0], ai.pos[2] - me.pos[2])); if (best < 4.5) break; if (ai.pos[1] < -2) return { fell: true, rode, at: ai.pos }; }
    return { rode, closest: +best.toFixed(1), aiAt: ai.pos.map(v => +v.toFixed(1)) }; })()`));
  */
  await b.close();
})().catch(e => { console.log('CRASH', e.message.slice(0, 300)); process.exit(1); });
