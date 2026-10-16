import React, { useEffect, useState } from 'react';
import { CLASS_CONFIGS } from '../CombatData';
import { MAPS } from '../../maps';
import { AI_LEVELS } from '../../settings';
import { STATS_API, getAccount, onAccount, fetchMe, fetchLeaderboard, fetchHeroes, login, logout, Me } from '../../stats';

const heroName = (h: string | null) => (h && (CLASS_CONFIGS as any)[h]?.name) || h || '';
const modeName = (m: string) => (m === 'online' ? '联机' : (AI_LEVELS as any)[m]?.name ?? m);

const CSS = `
.tq-st { position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; background:rgba(20,17,14,.45); backdrop-filter:blur(3px); }
.tq-st-in { width:min(720px, calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow:auto; background:#f4eee2; color:#1f1c18; border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.35); padding:18px 20px 22px; font-family:"Noto Serif SC",serif; }
.tq-st-h { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.tq-st-h h2 { margin:0; font:400 30px "Ma Shan Zheng",serif; letter-spacing:.08em; }
.tq-st-x { border:none; background:none; font-size:24px; cursor:pointer; color:#5a544a; }
.tq-st-tabs { display:flex; gap:6px; margin:10px 0 14px; }
.tq-st-tabs button { border:1px solid rgba(31,28,24,.22); background:transparent; border-radius:999px; padding:5px 14px; font:600 13px "Noto Serif SC",serif; letter-spacing:.12em; cursor:pointer; color:#5a544a; }
.tq-st-tabs button.on { background:#1f1c18; color:#f4eee2; border-color:#1f1c18; }
.tq-st-card { display:flex; gap:18px; flex-wrap:wrap; align-items:flex-end; padding:12px 14px; border-radius:10px; background:rgba(255,255,255,.55); border:1px solid rgba(31,28,24,.1); }
.tq-st-big { font:900 28px "Noto Serif SC",serif; }
.tq-st-sub { font-size:12px; color:#6b655b; letter-spacing:.08em; }
.tq-st-tbl { width:100%; border-collapse:collapse; margin-top:12px; font-size:13.5px; }
.tq-st-tbl th { text-align:left; font-weight:600; color:#6b655b; font-size:12px; padding:6px 8px; border-bottom:1px solid rgba(31,28,24,.15); }
.tq-st-tbl td { padding:7px 8px; border-bottom:1px solid rgba(31,28,24,.07); font-variant-numeric:tabular-nums; }
.tq-st-tbl tr.me td { background:rgba(168,54,42,.08); font-weight:700; }
.tq-st-bar { height:6px; border-radius:6px; background:rgba(31,28,24,.1); overflow:hidden; min-width:80px; }
.tq-st-bar i { display:block; height:100%; background:#a8362a; }
.tq-st-code { font:700 18px ui-monospace,Menlo,monospace; letter-spacing:.12em; padding:6px 10px; background:#1f1c18; color:#f4eee2; border-radius:6px; user-select:all; }
.tq-st-btn { border:none; border-radius:8px; padding:7px 14px; background:#a8362a; color:#f6efe2; font:600 13px "Noto Serif SC",serif; letter-spacing:.15em; cursor:pointer; }
.tq-st-btn.ghost { background:transparent; color:#5a544a; border:1px solid rgba(31,28,24,.25); }
.tq-st-in input { border:1px solid rgba(31,28,24,.25); border-radius:8px; padding:7px 10px; font:600 14px ui-monospace,Menlo,monospace; letter-spacing:.1em; background:#fffaf0; }
.tq-st-note { font-size:12.5px; color:#6b655b; line-height:1.7; margin-top:10px; }
.tq-st-win { color:#2e7d32; font-weight:700; } .tq-st-loss { color:#a8362a; font-weight:700; }
`;

/** 战绩: my record (level, hero mastery, recent rounds, recovery code), the leaderboard, hero win rates */
export function StatsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'me' | 'board' | 'heroes'>('me');
  const [acct, setAcct] = useState(getAccount());
  const [me, setMe] = useState<Me | null>(null);
  const [board, setBoard] = useState<Awaited<ReturnType<typeof fetchLeaderboard>> | null>(null);
  const [heroes, setHeroes] = useState<Awaited<ReturnType<typeof fetchHeroes>> | null>(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => onAccount(() => setAcct(getAccount())), []);
  useEffect(() => {
    setErr('');
    if (tab === 'me' && acct) fetchMe().then(setMe).catch((e) => setErr(String(e.message || e)));
    if (tab === 'board') fetchLeaderboard().then(setBoard).catch((e) => setErr(String(e.message || e)));
    if (tab === 'heroes') fetchHeroes().then(setHeroes).catch((e) => setErr(String(e.message || e)));
  }, [tab, acct]);
  const doLogin = async () => {
    setBusy(true);
    setErr('');
    try {
      await login(code);
      setCode('');
    } catch (e: any) {
      setErr(e?.message === 'offline' ? '离线中' : e?.message || '登录失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="tq-st" onClick={onClose}>
      <style>{CSS}</style>
      <div className="tq-st-in" onClick={(e) => e.stopPropagation()}>
        <div className="tq-st-h">
          <h2>战绩</h2>
          <button className="tq-st-x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="tq-st-tabs">
          {(
            [
              ['me', '我的战绩'],
              ['board', '排行榜'],
              ['heroes', '英雄胜率'],
            ] as const
          ).map(([k, n]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {n}
            </button>
          ))}
        </div>
        {!STATS_API && <div className="tq-st-note">这个版本没有连上战绩服务器。</div>}
        {err && <div className="tq-st-note">出错了：{err}</div>}

        {tab === 'me' && (
          <>
            {!acct && (
              <div className="tq-st-note">
                打完一局（会还手模式或联机）就会自动建档，开始记录战绩和英雄熟练度。
                <br />
                已经在别的设备上玩过？输入恢复码登录：
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" />
                  <button className="tq-st-btn" disabled={busy || code.length < 8} onClick={doLogin}>
                    登录
                  </button>
                </div>
              </div>
            )}
            {acct && me && (
              <>
                <div className="tq-st-card">
                  <div>
                    <div className="tq-st-sub">侠客</div>
                    <div className="tq-st-big">{me.name}</div>
                  </div>
                  <div>
                    <div className="tq-st-sub">等级</div>
                    <div className="tq-st-big">{me.level}</div>
                  </div>
                  <div>
                    <div className="tq-st-sub">胜 / 负 / 平</div>
                    <div className="tq-st-big">
                      {me.wins} / {me.losses} / {me.draws}
                    </div>
                  </div>
                  <div>
                    <div className="tq-st-sub">排名</div>
                    <div className="tq-st-big">第 {me.rank}</div>
                  </div>
                  <div>
                    <div className="tq-st-sub">修为</div>
                    <div className="tq-st-big">{me.xp}</div>
                  </div>
                </div>
                <table className="tq-st-tbl">
                  <thead>
                    <tr>
                      <th>英雄熟练度</th>
                      <th>等级</th>
                      <th>局数</th>
                      <th>胜率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {me.mastery.map((m) => (
                      <tr key={m.hero}>
                        <td>{heroName(m.hero)}</td>
                        <td>{m.level}</td>
                        <td>{m.games}</td>
                        <td>{Math.round((100 * m.wins) / Math.max(1, m.games))}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="tq-st-tbl">
                  <thead>
                    <tr>
                      <th>最近对局</th>
                      <th>对手</th>
                      <th>地图</th>
                      <th>难度</th>
                      <th>结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {me.recent.map((r) => (
                      <tr key={r.ts}>
                        <td>{heroName(r.hero)}</td>
                        <td>{heroName(r.foe)}</td>
                        <td>{(MAPS as any)[r.map]?.name ?? r.map}</td>
                        <td>{modeName(r.mode)}</td>
                        <td className={r.result === 1 ? 'tq-st-win' : r.result === 0 ? 'tq-st-loss' : ''}>{r.result === 1 ? '胜' : r.result === 0 ? '负' : '平'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="tq-st-note">
                  恢复码（换设备时输入它就能找回战绩，别给别人）：
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                    <span className="tq-st-code">{acct.code}</span>
                    <button className="tq-st-btn ghost" onClick={() => navigator.clipboard?.writeText(acct.code)}>
                      复制
                    </button>
                    <button
                      className="tq-st-btn ghost"
                      onClick={() => {
                        if (confirm('退出后这台设备不再记录你的战绩，用恢复码可以再登录。确定退出？')) logout();
                      }}
                    >
                      退出
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {tab === 'board' && board && (
          <table className="tq-st-tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>侠客</th>
                <th>等级</th>
                <th>修为</th>
                <th>胜 / 负</th>
                <th>常用</th>
              </tr>
            </thead>
            <tbody>
              {board.map((r, i) => (
                <tr key={i} className={r.me ? 'me' : ''}>
                  <td>{i + 1}</td>
                  <td>{r.name}</td>
                  <td>{r.level}</td>
                  <td>{r.xp}</td>
                  <td>
                    {r.wins} / {r.losses}
                  </td>
                  <td>{heroName(r.hero)}</td>
                </tr>
              ))}
              {!board.length && (
                <tr>
                  <td colSpan={6}>还没有人上榜</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {tab === 'heroes' && heroes && (
          <>
            <table className="tq-st-tbl">
              <thead>
                <tr>
                  <th>英雄</th>
                  <th>局数</th>
                  <th>胜率</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...heroes]
                  .sort((a, b) => b.wins / Math.max(1, b.games) - a.wins / Math.max(1, a.games))
                  .map((h) => {
                    const pct = Math.round((100 * h.wins) / Math.max(1, h.games));
                    return (
                      <tr key={h.hero}>
                        <td>{heroName(h.hero)}</td>
                        <td>{h.games}</td>
                        <td>{pct}%</td>
                        <td>
                          <div className="tq-st-bar">
                            <i style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div className="tq-st-note">近 30 天所有玩家在困难、地狱和联机里的真实对局。</div>
          </>
        )}
      </div>
    </div>
  );
}
