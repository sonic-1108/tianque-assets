// AI vs AI balance run: node balance.cjs <heroA> <heroB> <rounds> [map] [level]
// (in the repo: tools/balance; run by .github/workflows/balance.yml, one pair per machine)
// heroes by lobby name: 狂刃 暗器 梵音 影刃 天子. Prints one JSON line with every round's result.
const { chromium } = require('playwright');
const [A, B, ROUNDS = '10', MAP = 'temple', LV = 'hard'] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 200, height: 120 } });
  p.on('pageerror', e => console.error('ERR', e.message.slice(0, 200)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; } });
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype;
    P.compileShader = function () {}; P.linkProgram = function () {};
    const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); };
    P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; };
    P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript((lv) => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; globalThis.__TQ_NOSKY = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', aiLevel: lv })) } catch (e) {} }, LV);
  await p.goto(process.env.URL || 'http://127.0.0.1:4180/', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-heroes', { timeout: 150000 });
  await p.waitForFunction(() => globalThis.__TQ?.maps);
  const name = await p.evaluate((id) => globalThis.__TQ.maps.MAPS[id].name, MAP);
  await p.evaluate(() => { const s = [...document.querySelectorAll('.tq-seg button')].find(x => x.textContent.includes('会还手')); s && s.click(); });
  await p.evaluate((a) => { [...document.querySelectorAll('.tq-hero')].find(x => x.textContent.includes(a))?.click(); }, A === '天子' ? '天子' : A);
  await new Promise(r => setTimeout(r, 600));
  // the opponent's seat: click its face until it shows hero B
  for (let k = 0; k < 8; k++) {
    const cur = await p.evaluate(() => { const seats = [...document.querySelectorAll('.tq-seat')]; const s = seats.find(x => !x.classList.contains('me') && !x.classList.contains('empty')); return s?.querySelector('.tq-seat-n i')?.textContent || ''; });
    if (cur === B) break;
    await p.evaluate(() => { const seats = [...document.querySelectorAll('.tq-seat')]; const s = seats.find(x => !x.classList.contains('me') && !x.classList.contains('empty')); s?.querySelector('.tq-seat-face')?.click(); });
    await new Promise(r => setTimeout(r, 300));
  }
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  for (let t = 0; t < 20; t++) { const ok = await p.evaluate((nm) => { if (document.querySelector('.tq-map.on .tq-map-n')?.textContent === nm) return true; const m = [...document.querySelectorAll('.tq-map')].find(x => x.textContent.includes(nm)); m && m.click(); return false; }, name); if (ok) break; await new Promise(r => setTimeout(r, 700)); }
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 300000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length > 1 && !(q[0].pos[0] === 0 && q[0].pos[2] === 0); }, null, { timeout: 300000 });
  await new Promise(r => setTimeout(r, 1500));
  const res = await p.evaluate(async ({ rounds }) => {
    globalThis.__TQ_SIM = true;
    globalThis.__TQ_TURBO = +(localStorage.getItem('tq_turbo') || 40);
    const T = globalThis.__TQ; const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const out = []; let start = globalThis.__TQ_GT ?? 0; let done = false;
    const classes = T.fighters.current.map(f => f.classId);
    const t0 = performance.now();
    while (out.length < rounds && performance.now() - t0 < 1000 * 60 * 25) {
      await wait(40);
      const fs = T.fighters.current; const gt = globalThis.__TQ_GT ?? 0;
      const a = fs[0], b2 = fs[1];
      if (!done && (a.hp <= 0 || b2.hp <= 0)) {
        done = true;
        const w = a.hp > 0 ? 0 : b2.hp > 0 ? 1 : -1;
        out.push({ w, left: w < 0 ? 0 : Math.round((fs[w].hp / fs[w].maxHp) * 100), dur: Math.round(gt - start) });
      }
      if (done && a.hp > 0 && b2.hp > 0) { done = false; start = gt; }
      if (!done && gt - start > 120) { out.push({ w: -1, left: 0, dur: 120, timeout: true }); globalThis.__TQ_RESET?.(); start = gt; await wait(200); }
    }
    return { classes, rounds: out, realSec: Math.round((performance.now() - t0) / 1000) };
  }, { rounds: +ROUNDS });
  console.log(JSON.stringify({ A, B, map: MAP, lv: LV, ...res }));
  await b.close();
})().catch(e => { console.log(JSON.stringify({ A, B, error: e.message.slice(0, 200) })); process.exit(1); });
