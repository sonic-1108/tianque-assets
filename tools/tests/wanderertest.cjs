// 新人 / 散人 in a real 1v1 (draws stubbed). Every 低阶 skill of every house (21) is put on the bar six at a time and
// pressed by the player: it must change weapons first (換兵器, ~0.45 s) when it's another house's, then cast as its
// owner, land / heal / move, and leave him a 新人 again with the cooldown on his own slot. Then the same with the
// 百变兵器 (no change time), and skill levels: Lv 1 hits at 80%, Lv 10 at 125% (inside a contract only).
//   npx vite build --outDir /tmp/b --base / && npx vite preview --outDir /tmp/b --port 4180
//   URL=http://127.0.0.1:4180/ node tools/tests/wanderertest.cjs
const { chromium } = require(process.env.PW || 'playwright');
const ALL = process.env.ONLY ? process.env.ONLY.split(',') : ['earth_cleave', 'whirlwind_blade', 'bull_charge', 'boomerang', 'pin_dart', 'swallow_flip', 'vajra_palm', 'zen_domain', 'six_syllable_mantra', 'fan_knives', 'burrow', 'shadow_step', 'edict', 'phantom_guard', 'jade_seal', 'rolex_throw', 'make_it_rain', 'patagonia', 'qingfeng', 'drain_surplus', 'earth_spring'];
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push((e.stack || e.message).slice(0, 600)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; P.compileShader = function () {}; P.linkProgram = function () {}; const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); }; P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; }; P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_TRACE = !!(new URLSearchParams(location.search).get('trace')); globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', qualityPicked: true, sfx: 0, music: 0, aiLevel: 'easy' })); if (new URLSearchParams(location.search).get('sex') === 'f') localStorage.setItem('tq_wanderer_look', 'f'); } catch (e) {} });
  await p.goto((process.env.URL || 'http://127.0.0.1:4180/') + '?silent=1' + (process.env.TRACE ? '&trace=1' : '') + (process.env.SEX ? '&sex=' + process.env.SEX : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  await p.evaluate((A) => { const W = globalThis.__TQ_WANDER; for (const id of A) W.SKILLS.levels[id] = 5; W.refreshWanderer(); }, ALL);
  await p.evaluate(() => globalThis.__TQ.setRoom([
    { kind: 'host', cls: 'Wanderer', name: '测' }, { kind: 'empty', cls: 'Ranger', name: '' }, { kind: 'ai', cls: 'Berserker', name: '' },
    { kind: 'empty', cls: 'Ranger', name: '' }, { kind: 'empty', cls: 'Ranger', name: '' }, { kind: 'empty', cls: 'Ranger', name: '' },
  ]));
  await new Promise((r) => setTimeout(r, 600));
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length >= 2 && !(q[0].pos[0] === 0 && q[0].pos[2] === 0); }, null, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 4000));
  const r = await p.evaluate(async (A) => {
    const T = globalThis.__TQ, W = globalThis.__TQ_WANDER;
    const [me, foe] = T.fighters.current;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    /** wait game seconds (the cooldown clock is game time) */
    const waitG = async (sec) => { me.cooldowns.zz = sec; for (let k = 0; k < 800 && (me.cooldowns.zz ?? 0) > 0; k++) await wait(40); };
    T.ai.current = false;
    let pin = [0, -5];
    const keep = setInterval(() => { if (pin) { foe.pos[0] = me.pos[0] + pin[0]; foe.pos[2] = me.pos[2] + pin[1]; foe.pos[1] = me.pos[1]; foe.vel = [0, 0, 0]; } }, 30);
    const slots = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'ultimate'];
    const home = [...me.pos]; // every move starts from the same open spot (a blink or a charge would otherwise put a pillar in the way of the next)
    const out = { moves: {}, bad: [] };
    const press = async (id, slot) => {
      // the last move may have left him gliding (Patagonia): bring him down first
      if ((me.glide ?? 0) > 0 || !me.isGrounded) { me.glide = 0; for (let k = 0; k < 60 && !me.isGrounded; k++) await wait(100); }
      me.pos = [...home]; me.vel = [0, 0, 0];
      me.mp = me.maxMp; me.cooldowns = {}; me.classId = 'Wanderer'; me.borrowState = undefined; me.isGrounded = true; me.vel = [0, 0, 0]; me.actionState = 'idle'; me.stateTimer = 0; me.stateDuration = 0; me.rotY = me.targetRotY = 0; me.glide = 0; me.burrowT = 0;
      me.pos[1] = Math.max(me.pos[1], 0);
      foe.hp = foe.maxHp; foe.rootTimer = 0; foe.actionState = 'idle';
      pin = ['bull_charge', 'vajra_palm', 'shadow_step', 'earth_cleave', 'whirlwind_blade', 'phantom_guard'].includes(id) ? null : id === 'jade_seal' ? [0, -8] : [0, -6];
      if (!pin) { foe.pos[0] = me.pos[0]; foe.pos[2] = me.pos[2] - (id === 'vajra_palm' || id === 'whirlwind_blade' ? 1.8 : id === 'earth_cleave' ? 2.4 : 4); foe.pos[1] = me.pos[1]; }
      if (['qingfeng', 'earth_spring', 'drain_surplus'].includes(id)) me.hp = Math.round(me.maxHp * 0.4);
      const hp0 = foe.hp, mh0 = me.hp, mp0 = me.mp, x0 = me.pos[0], z0 = me.pos[2], form0 = me.weaponForm;
      T.input.current.buffer.push({ action: slot, timestamp: performance.now() + 3000 });
      let sawAs = '', swapSeen = 0, castAt = -1; const g0 = globalThis.__TQ_GT;
      const trace = [];
      for (let t = 0; t < 14; t++) { await waitG(0.2); if (globalThis.__TQ_TRACE) trace.push([me.classId, me.actionState, +me.stateTimer.toFixed(2), foe.hp, T.input.current.debug?.lastSkillResult, +Math.hypot(foe.pos[0] - me.pos[0], foe.pos[2] - me.pos[2]).toFixed(1), foe.actionState, (me.stealthT ?? 0) > 0 ? 'stealth' : '']); if ((me.swapT ?? 0) > 0) swapSeen++; if (me.classId !== 'Wanderer' && !sawAs) { sawAs = me.classId; castAt = +(globalThis.__TQ_GT - g0).toFixed(2); } }
      T.input.current.buffer.length = 0;
      await waitG(1.2);
      return { castAs: sawAs, castAt, swapSeen, form0, form: me.weaponForm, backTo: me.classId, mpSpent: Math.round(mp0 - me.mp), slotCd: +(me.cooldowns[slot] ?? 0).toFixed(1), foeLost: hp0 - foe.hp, meHealed: me.hp - mh0, moved: +Math.hypot(me.pos[0] - x0, me.pos[2] - z0).toFixed(1), mult: me.castMult, trace: globalThis.__TQ_TRACE ? trace : undefined };
    };
    for (let g = 0; g < A.length; g += 6) {
      const set = A.slice(g, g + 6);
      W.setLoadout(set);
      for (let k = 0; k < set.length; k++) {
        const m = await press(set[k], slots[k]);
        out.moves[set[k]] = m;
        const effect = m.foeLost > 0 || m.meHealed > 0 || m.moved > 1 || ['zen_domain', 'burrow', 'patagonia', 'edict', 'six_syllable_mantra', 'make_it_rain'].includes(set[k]);
        if (!m.castAs || (m.backTo !== 'Wanderer' && set[k] !== 'patagonia') || !effect || (m.form0 !== m.form && !m.swapSeen)) out.bad.push(set[k]);
      }
    }
    // 百变兵器 inside a contract: no change time; and the level's damage share
    globalThis.__TQ_CAREER._testRun(true);
    W.SKILLS.baibian = true;
    // 玉玺镇压 lands where the opponent stands, whichever way the camera points (a blink swings the camera round)
    W.SKILLS.levels.jade_seal = 1;
    W.setLoadout(['jade_seal', '', '', '', '', '']);
    me.weaponForm = 'Trader';
    const lo = await press('jade_seal', 'skill1');
    W.SKILLS.levels.jade_seal = 10; me.weaponForm = 'Trader'; const hi = await press('jade_seal', 'skill1');
    globalThis.__TQ_CAREER._testRun(false);
    me.castMult = undefined; W.SKILLS.baibian = false; me.weaponForm = 'Emperor'; const base = await press('jade_seal', 'skill1');
    out.baibian = { lv1: { swapSeen: lo.swapSeen, castAt: lo.castAt, mult: lo.mult, foeLost: lo.foeLost }, lv10: { swapSeen: hi.swapSeen, mult: hi.mult, foeLost: hi.foeLost }, noContract: base.foeLost, trace: lo.trace, foePos: [foe.pos.map((v) => +v.toFixed(1)), me.pos.map((v) => +v.toFixed(1))] };
    if (lo.swapSeen || hi.swapSeen || !(lo.foeLost > 0 && hi.foeLost > lo.foeLost)) out.bad.push('levels / 百变');
    // an empty slot does nothing
    me.cooldowns = {}; T.input.current.buffer.push({ action: 'skill3', timestamp: performance.now() + 500 }); await waitG(0.6); out.emptySlot = { state: me.actionState, cls: me.classId };
    clearInterval(keep);
    return out;
  }, ALL);
  console.log(JSON.stringify(r, null, 1));
  if (errs.length) console.log('ERRORS', [...new Set(errs)].slice(0, 6).join('\n'));
  await b.close();
  process.exit(r.bad.length || errs.length ? 1 : 0);
})().catch((e) => { console.log('CRASH', e.message.slice(0, 300)); process.exit(1); });
