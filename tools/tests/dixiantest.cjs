// 地仙 in a real 2v2 round (draws stubbed): every skill pressed by the player, checked on the fighters' state.
//   npx vite build --outDir /tmp/b --base / && npx vite preview --outDir /tmp/b --port 4180
//   URL=http://127.0.0.1:4180/ node tools/tests/dixiantest.cjs
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 200)));
  await p.addInitScript(() => { for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) { const P = C.prototype; for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) if (P[f]) P[f] = function () {}; P.compileShader = function () {}; P.linkProgram = function () {}; const gsp = P.getShaderParameter; P.getShaderParameter = function (s, pn) { return pn === this.COMPILE_STATUS ? true : gsp.call(this, s, pn); }; P.getProgramParameter = function (pr, pn) { if (pn === this.LINK_STATUS || pn === 0x8B82) return true; return 0; }; P.getShaderInfoLog = function () { return ''; }; P.getProgramInfoLog = function () { return ''; }; } });
  await p.addInitScript(() => { globalThis.__TQ_NOWARM = true; globalThis.__TQ_NOGHOST = true; try { localStorage.setItem('tq_nickname', '测'); localStorage.setItem('tq_settings', JSON.stringify({ quality: 'low', qualityPicked: true, sfx: 0, music: 0, aiLevel: 'easy' })); } catch (e) {} });
  await p.goto((process.env.URL || 'http://127.0.0.1:4180/') + '?silent=1', { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.tq-maps', { timeout: 200000 });
  await p.evaluate(() => globalThis.__TQ.setRoom([
    { kind: 'host', cls: 'HeavyHealer', name: '测' },
    { kind: 'ai', cls: 'Berserker', name: '' },
    { kind: 'ai', cls: 'Berserker', name: '' },
    { kind: 'empty', cls: 'Ranger', name: '' },
    { kind: 'empty', cls: 'Ranger', name: '' },
    { kind: 'empty', cls: 'Ranger', name: '' },
  ]));
  await new Promise((r) => setTimeout(r, 600));
  await p.waitForFunction(() => /出征/.test(document.querySelector('.tq-go')?.textContent || ''), null, { timeout: 200000 });
  await p.evaluate(() => document.querySelector('.tq-go').click());
  await p.waitForFunction(() => { const q = globalThis.__TQ?.fighters?.current; return q?.length >= 3 && !(q[0].pos[0] === 0 && q[0].pos[2] === 0); }, null, { timeout: 240000 });
  await new Promise((r) => setTimeout(r, 4000));
  const r = await p.evaluate(async () => {
    const T = globalThis.__TQ;
    const F = T.fighters.current;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const me = F[0];
    const side = me.side ?? 0;
    const ally = F.find((f) => f !== me && (f.side ?? 0) === side);
    const foe = F.find((f) => (f.side ?? 0) !== side);
    const out = { me: me.classId, ally: ally?.classId, foe: foe?.classId };
    // wait in game seconds (the sim runs slower than the wall clock here): a probe cooldown ticks down with the game
    const waitG = async (sec) => { me.cooldowns.zz = sec; for (let k = 0; k < 600 && (me.cooldowns.zz ?? 0) > 0; k++) await wait(50); };
    const press = async (a, sec = 0.4) => { me.mp = me.maxMp; me.cooldowns = {}; me.actionState = 'idle'; me.stateTimer = 0; me.stateDuration = 0; T.input.current.buffer.push({ action: a, timestamp: performance.now() + 3000 }); await waitG(sec); };
    const park = (f, dx, dz) => { f.pos[0] = me.pos[0] + dx; f.pos[2] = me.pos[2] + dz; f.pos[1] = me.pos[1]; f.vel = [0, 0, 0]; };
    let pin = null;
    const keep = setInterval(() => { if (pin) park(foe, pin[0], pin[1]); else park(foe, 40, 0); }, 30);
    T.ai.current = false;
    // left click: bolts at a foe 10 m ahead
    me.rotY = me.targetRotY = Math.PI / 2; // facing -x
    pin = [-10, 0]; foe.hp = foe.maxHp;
    let f0 = foe.hp;
    for (let k = 0; k < 3; k++) await press('attack', 0.9);
    await waitG(0.6);
    out.bolts = { foeLost: f0 - foe.hp };
    // 1 清风诀 on a hurt ally 6 m away
    pin = null; park(ally, 6, 0);
    ally.hp = Math.round(ally.maxHp * 0.4);
    let h0 = ally.hp;
    T.input.current.actions.forward = true; // walking while casting must not break it
    await press('skill1', 1.6);
    T.input.current.actions.forward = false;
    out.breeze = { healed: ally.hp - h0, pctOfMax: +((ally.hp - h0) / ally.maxHp).toFixed(2) };
    // 2 损有余: foe 6 m off, ally hurt
    ally.hp = Math.round(ally.maxHp * 0.4); h0 = ally.hp;
    pin = [-6, 0]; foe.hp = foe.maxHp; f0 = foe.hp;
    await press('skill2', 3.4);
    out.drain = { foeLost: f0 - foe.hp, allyGained: ally.hp - h0 };
    // 3 地脉回春: ring ahead of me; the foe walks into it and is rooted; a hurt ally inside heals
    pin = null;
    me.rotY = me.targetRotY = 0;
    await press('skill3', 0.6);
    const fx = me.pos[0], fz = me.pos[2] - 3;
    foe.rootTimer = 0;
    pin = [0, -3];
    ally.pos[0] = fx + 1; ally.pos[2] = fz; ally.pos[1] = me.pos[1];
    ally.hp = Math.round(ally.maxHp * 0.5); h0 = ally.hp;
    await waitG(0.15);
    out.spring = { foeRooted: +(foe.rootTimer ?? 0).toFixed(2) };
    await waitG(2.2);
    out.spring.allyHealed2s = ally.hp - h0;
    pin = null;
    // 4 缩地成寸 to the ally 15 m off, shield on arrival
    park(ally, 15, 0);
    ally.hp = Math.round(ally.maxHp * 0.5); ally.craneShield = 0;
    const x0 = me.pos[0];
    await press('skill4', 0.9);
    out.step = { moved: +(me.pos[0] - x0).toFixed(1), toAlly: +Math.hypot(ally.pos[0] - me.pos[0], ally.pos[2] - me.pos[2]).toFixed(1), allyShield: ally.craneShield };
    // 5 还魂 with nobody down: 魂印 on the most hurt (the ally)
    park(ally, 4, 0);
    ally.hp = Math.round(ally.maxHp * 0.3);
    await press('skill5', 0.7);
    out.soul = { allySoulT: +(ally.soulT ?? 0).toFixed(1) };
    // R 人间不渡
    ally.hp = Math.round(ally.maxHp * 0.3);
    me.hp = Math.round(me.maxHp * 0.4);
    const a0 = ally.hp, m0 = me.hp;
    await press('ultimate', 1.2);
    out.ult = { allyHealedPct: +((ally.hp - a0) / ally.maxHp).toFixed(2), meHealedPct: +((me.hp - m0) / me.maxHp).toFixed(2), allyProtect: +(ally.protectTimer ?? 0).toFixed(1) };
    // 5 还魂 with the ally down (AI on so revives count; the foe is kept far off)
    T.ai.current = true;
    park(ally, 3, 0);
    ally.soulT = 0;
    // what koCheck does when a blow cuts someone down in a team fight
    ally.hp = 0; ally.stateDuration = 99; ally.stateTimer = 0; ally.actionState = 'knockdown'; ally.vel = [0, 0, 0];
    await waitG(0.5);
    out.down = { stateDuration: ally.stateDuration };
    park(ally, 3, 0);
    await press('skill5', 3.2);
    out.revive = { allyHpPct: +(ally.hp / ally.maxHp).toFixed(2) };
    clearInterval(keep);
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  if (errs.length) console.log('ERRORS', [...new Set(errs)].slice(0, 6).join('\n'));
  await b.close();
})().catch((e) => { console.log('CRASH', e.message.slice(0, 300)); process.exit(1); });
