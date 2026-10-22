// 长安上元夜 剑雨 (draws stubbed): emperor down and one side wiped, swords must keep falling on whoever's left.
//   URL=http://127.0.0.1:4180/ node tools/tests/swordrain.cjs
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; P.compileShader = function () {}; P.linkProgram = function () {}; const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); }; P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; }; P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', qualityPicked: true, sfx: 0, music: 0, aiLevel: 'easy' })); } catch (e) {} });
  await p.goto((process.env.URL || 'http://127.0.0.1:4180/') + '?silent=1', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  for (let t = 0; t < 30; t++) { const ok = await p.evaluate(() => { if (document.querySelector('.tq-map.on .tq-map-n')?.textContent === '长安上元夜') return true; [...document.querySelectorAll('.tq-map')].find((x) => x.textContent.includes('长安上元夜'))?.click(); return false; }); if (ok) break; await new Promise((r) => setTimeout(r, 500)); }
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => globalThis.__TQ?.fighters?.current?.length >= 7, null, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 5000));
  const r = await p.evaluate(async () => {
    const T = globalThis.__TQ; const F = T.fighters.current; const me = F[0];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitG = async (sec) => { me.cooldowns.zz = sec; for (let k = 0; k < 800 && (me.cooldowns.zz ?? 0) > 0; k++) await wait(50); };
    T.ai.current = true;
    const emp = F.find((f) => f.classId === 'Emperor' && f.side === 2);
    const foe = F.find((f) => f.side === 1);
    const down = (f) => { f.hp = 0; f.stateDuration = 99; f.actionState = 'knockdown'; f.reviveBlocked = true; };
    // only the foe down: no rain yet (emperor alive)
    down(foe);
    me.hp = me.maxHp; me.stamina = 0;
    await waitG(3);
    const before = { lost: me.maxHp - me.hp };
    down(emp);
    for (const g of F.filter((f) => f.classId === 'Guard')) down(g);
    me.hp = me.maxHp;
    let lostTotal = 0, hits = 0, last = me.hp;
    for (let k = 0; k < 16; k++) { await waitG(0.5); me.dodgeIframeTimer = 0; me.stamina = 0; if (me.hp < last) { hits++; lostTotal += last - me.hp; } me.hp = me.maxHp; last = me.hp; }
    return { before, rainHits: hits, rainDamage: lostTotal, toast: (document.body.innerText.match(/天降剑雨[^\n]*/) || [''])[0] };
  });
  console.log(JSON.stringify(r));
  if (errs.length) console.log('ERRORS', [...new Set(errs)].slice(0, 5).join('\n'));
  await b.close();
})().catch((e) => { console.log('CRASH', e.message.slice(0, 300)); process.exit(1); });
