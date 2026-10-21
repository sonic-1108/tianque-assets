// 散人 in a real 1v1 (draws stubbed): every borrowed move pressed by the player, its effect checked, and afterwards he
// must be a 散人 again with the cooldown on his own slot.
//   npx vite build --outDir /tmp/b --base / && npx vite preview --outDir /tmp/b --port 4180
//   URL=http://127.0.0.1:4180/ LOADOUT=rolex_throw,pin_dart,bull_charge,vajra_palm,jade_seal,qingfeng node tools/tests/wanderertest.cjs
const { chromium } = require(process.env.PW || 'playwright');
const LOADOUT = (process.env.LOADOUT || 'rolex_throw,pin_dart,bull_charge,vajra_palm,jade_seal,qingfeng').split(',');
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push((e.stack || e.message).slice(0, 600)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; P.compileShader = function () {}; P.linkProgram = function () {}; const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); }; P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; }; P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript((L) => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', qualityPicked: true, sfx: 0, music: 0, aiLevel: 'easy' })); localStorage.setItem('tq_wanderer_loadout', JSON.stringify(L)); } catch (e) {} }, LOADOUT);
  await p.goto((process.env.URL || 'http://127.0.0.1:4180/') + '?silent=1', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  await p.evaluate(() => globalThis.__TQ.setRoom([
    { kind: 'host', cls: 'Wanderer', name: '测' },
    { kind: 'empty', cls: 'Ranger', name: '' },
    { kind: 'ai', cls: 'Berserker', name: '' },
    { kind: 'empty', cls: 'Ranger', name: '' }, { kind: 'empty', cls: 'Ranger', name: '' }, { kind: 'empty', cls: 'Ranger', name: '' },
  ]));
  await new Promise((r) => setTimeout(r, 600));
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length >= 2 && !(q[0].pos[0] === 0 && q[0].pos[2] === 0); }, null, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 4000));
  const r = await p.evaluate(async (L) => {
    const T = globalThis.__TQ;
    const [me, foe] = T.fighters.current;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitG = async (sec) => { me.cooldowns.zz = sec; for (let k = 0; k < 600 && (me.cooldowns.zz ?? 0) > 0; k++) await wait(50); };
    T.ai.current = false;
    let pin = [0, -5];
    const keep = setInterval(() => { if (pin) { foe.pos[0] = me.pos[0] + pin[0]; foe.pos[2] = me.pos[2] + pin[1]; foe.pos[1] = me.pos[1]; foe.vel = [0, 0, 0]; } }, 30);
    const out = { cls: me.classId, wanderer: me.wanderer, maxHp: me.maxHp, moves: {} };
    const slots = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'ultimate'];
    for (let k = 0; k < 6; k++) {
      const id = L[k];
      const slot = slots[k];
      me.mp = me.maxMp; me.cooldowns = {}; me.actionState = 'idle'; me.stateTimer = 0; me.stateDuration = 0; me.rotY = me.targetRotY = 0;
      foe.hp = foe.maxHp; foe.rootTimer = 0; foe.actionState = 'idle';
      pin = id === 'bull_charge' ? [0, -4] : id === 'vajra_palm' ? [0, -2] : id === 'jade_seal' ? [0, -8] : [0, -6];
      if (id === 'bull_charge' || id === 'vajra_palm' || id === 'shadow_step') pin = null, foe.pos[0] = me.pos[0], foe.pos[2] = me.pos[2] - (id === 'vajra_palm' ? 2 : 4), foe.pos[1] = me.pos[1];
      if (id === 'qingfeng') me.hp = Math.round(me.maxHp * 0.4);
      const hp0 = foe.hp, mh0 = me.hp, mp0 = me.mp, x0 = me.pos[0], z0 = me.pos[2];
      T.input.current.buffer.push({ action: slot, timestamp: performance.now() + 3000 });
      let sawAs = '';
      for (let t = 0; t < 12; t++) { await waitG(0.25); if (me.classId !== 'Wanderer') sawAs = me.classId; if (foe.rootTimer > 0) out.rootSeen = true; }
      await waitG(1.5);
      out.moves[slot + ':' + id] = { castAs: sawAs, backTo: me.classId, mpSpent: Math.round(mp0 - me.mp + 0), slotCd: +(me.cooldowns[slot] ?? 0).toFixed(1), foeLost: hp0 - foe.hp, meHealed: me.hp - mh0, moved: +Math.hypot(me.pos[0] - x0, me.pos[2] - z0).toFixed(1) };
    }
    clearInterval(keep);
    return out;
  }, LOADOUT);
  console.log(JSON.stringify(r, null, 1));
  if (errs.length) console.log('ERRORS', [...new Set(errs)].slice(0, 6).join('\n'));
  await b.close();
})().catch((e) => { console.log('CRASH', e.message.slice(0, 300)); process.exit(1); });
