import { useSettings, setSettings, AI_LEVELS, type AiLevel } from '../../settings';
import type { RoomSeat } from '../../net';
import React, { useState } from 'react';
import { InkBackdrop } from './InkBackdrop';
import { MAPS, MAP_ORDER, MapId } from '../../maps';
import { CLASS_CONFIGS } from '../CombatData';
import { CharacterClassId } from '../../types';

const PORTRAIT: Partial<Record<CharacterClassId, string>> = {
  Berserker: './portraits/berserker.png',
  Ranger: './portraits/ranger.png?v=2',
  BuddhistMage: './portraits/monk.png',
  Shadowblade: './portraits/shadowblade.png',
  Emperor: './portraits/emperor.png',
};
/** one short line per hero instead of a paragraph */
const TAG: Partial<Record<CharacterClassId, string>> = {
  Berserker: '重刃 · 近战压制',
  Ranger: '暗器 · 游走风筝',
  BuddhistMage: '拳掌 · 护体控场',
  Shadowblade: '双刃 · 刺杀突进',
};
/** each hero's ink accent */
const ACCENT: Partial<Record<CharacterClassId, string>> = {
  Berserker: '#a3402b',
  Ranger: '#2f7a6e',
  BuddhistMage: '#a8822e',
  Shadowblade: '#3d4a7a',
};

export interface LobbyProps {
  nickname: string;
  onRename: () => void;
  heroes: CharacterClassId[];
  playerClass: CharacterClassId;
  onPlayerClass: (c: CharacterClassId) => void;
  /** the four seats (two a side) and which one is yours */
  room: RoomSeat[];
  localSeat: number;
  /** the host (or you, offline) sets up the seats */
  canEdit: boolean;
  onSeat: (k: number, change: { kind?: 'ai' | 'empty'; cls?: CharacterClassId; swap?: boolean }) => void;
  /** both sides have someone */
  ready: boolean;
  /** online: the opponent's hero is theirs to pick */
  online: boolean;
  aiEnabled: boolean;
  onAI: (on: boolean) => void;
  mapId: MapId;
  onSelectMap: (id: MapId) => void;
  /** start a match on this battlefield (the game only switches maps here, never while you browse) */
  onStart: (id: MapId) => void;
  /** online guest: the host picks the battlefield */
  hostPicks: boolean;
  onlinePanel: React.ReactNode;
  onlineBadge: string;
  version: string;
  /** the hero models are still downloading: the lobby shows straight away, 出征 waits (0..100) */
  loadPct?: number;
}

export function Lobby(p: LobbyProps) {
  const settings = useSettings();
  const [showOnline, setShowOnline] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  // the battlefield you're looking at; the live game keeps its map until you press 出征
  const [pick, setPick] = useState<MapId>(p.mapId);
  const map = MAPS[pick];
  return (
    <div className="tq-lobby fixed inset-0 z-50 select-none">
      <style>{LOBBY_CSS}</style>
      <InkBackdrop />
      <div className="tq-l-wrap">
        {/* ---- title and name ---- */}
        <header className="tq-l-head">
          <div className="tq-l-title">
            <h1>天阙</h1>
            <span className="tq-seal">江<br />湖</span>
            <button className="tq-l-name" onClick={p.onRename} title="改名号">
              <span>名号</span> {p.nickname || '无名'} <i>✎</i>
            </button>
          </div>
          <div className="tq-l-tools">
            <button className={`tq-chip ${showOnline || p.onlineBadge ? 'on' : ''}`} onClick={() => setShowOnline((v) => !v)}>
              联机{p.onlineBadge ? <em>{p.onlineBadge}</em> : null}
            </button>
            <span className="tq-ver">{p.version}</span>
          </div>
          {showOnline && (
            <div className="tq-pop">
              <button className="tq-pop-x" onClick={() => setShowOnline(false)} aria-label="关闭">
                ×
              </button>
              <div className="tq-pop-h">联机房间 · 最多四人</div>
              {p.onlinePanel}
            </div>
          )}
        </header>

        {/* ---- the heroes ---- */}
        <section className="tq-l-heroes">
          <div className="tq-l-label">
            择<br />侠
          </div>
          <div className="tq-heroes">
            {p.heroes.map((cid) => {
              const cc = CLASS_CONFIGS[cid];
              const on = cid === p.playerClass;
              const hp = Math.min(1, cc.hp / 1700);
              const sp = Math.min(1, (cc.speedRatio || 1) / 1.35);
              return (
                <button key={cid} className={`tq-hero ${on ? 'on' : ''}`} style={{ ['--acc' as any]: ACCENT[cid] ?? '#a3402b' }} onClick={() => p.onPlayerClass(cid)}>
                  <div className="tq-hero-art">
                    <div className="tq-hero-wash" />
                    {PORTRAIT[cid] && <img src={PORTRAIT[cid]} alt="" draggable={false} />}
                  </div>
                  <div className="tq-hero-name">{cc.name}</div>
                  <div className="tq-hero-who">{cc.defaultCharacter}</div>
                  <div className="tq-hero-tag">{TAG[cid] ?? ''}</div>
                  <div className="tq-bars">
                    <span>气血</span>
                    <i>
                      <b style={{ width: `${hp * 100}%` }} />
                    </i>
                    <span>身法</span>
                    <i>
                      <b style={{ width: `${sp * 100}%` }} />
                    </i>
                  </div>
                  {on && <span className="tq-hero-stamp">择</span>}
                </button>
              );
            })}
          </div>
          {/* the lineup: two seats a side; 1v1, 2v1, 2v2 are just which seats are filled */}
          <div className="tq-foe">
            <span className="tq-foe-l">阵容</span>
            {[0, 1].map((side) => (
              <React.Fragment key={side}>
                {side === 1 && <span className="tq-vs">对</span>}
                <div className={`tq-side s${side}`}>
                  {[side * 2, side * 2 + 1].map((k) => {
                    const st = p.room[k];
                    const mine = k === p.localSeat;
                    const next = (c: CharacterClassId) => p.heroes[(p.heroes.indexOf(c) + 1) % p.heroes.length];
                    if (!st || st.kind === 'empty')
                      return (
                        <button key={k} className="tq-seat empty" disabled={!p.canEdit} onClick={() => p.onSeat(k, { kind: 'ai' })} title={p.canEdit ? '加一个 AI' : '空位'}>
                          {p.canEdit ? '+ AI' : '空'}
                        </button>
                      );
                    return (
                      <div key={k} className={`tq-seat ${mine ? 'me' : ''}`}>
                        <button
                          className="tq-seat-face"
                          disabled={!(st.kind === 'ai' && p.canEdit)}
                          onClick={() => p.onSeat(k, { cls: next(st.cls) })}
                          title={st.kind === 'ai' && p.canEdit ? '点击换侠客' : CLASS_CONFIGS[st.cls].name}
                        >
                          {PORTRAIT[st.cls] ? <img src={PORTRAIT[st.cls]} alt="" draggable={false} /> : CLASS_CONFIGS[st.cls].name.slice(0, 1)}
                        </button>
                        <span className="tq-seat-n">
                          {mine ? '你' : st.kind === 'ai' ? 'AI' : st.name || '侠客'}
                          <i>{CLASS_CONFIGS[st.cls].name}</i>
                        </span>
                        {p.canEdit && k !== 0 && (
                          <span className="tq-seat-ops">
                            <button onClick={() => p.onSeat(k, { swap: true })} title="换到另一边">⇄</button>
                            {st.kind === 'ai' && (
                              <button onClick={() => p.onSeat(k, { kind: 'empty' })} title="空出这个位置">
                                ×
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
            {!p.online && (
              <span className="tq-seg">
                <button className={p.aiEnabled ? 'on' : ''} onClick={() => p.onAI(true)}>
                  会还手
                </button>
                <button className={!p.aiEnabled ? 'on' : ''} onClick={() => p.onAI(false)}>
                  木桩
                </button>
              </span>
            )}
            {!p.online && p.aiEnabled && (
              <span className="tq-seg tq-lvl" title="AI 难度：困难和地狱的 AI 反应更快、更会格挡闪避，伤害更高也更耐打">
                {(Object.keys(AI_LEVELS) as AiLevel[]).map((k) => (
                  <button key={k} className={`${settings.aiLevel === k ? 'on' : ''} ${k}`} onClick={() => setSettings({ aiLevel: k })}>
                    {AI_LEVELS[k].name}
                  </button>
                ))}
              </span>
            )}
          </div>
        </section>

        {/* ---- the battlefields ---- */}
        <section className="tq-l-maps">
          <div className="tq-map-info">
            <div className="tq-map-title">
              {map.name}
              <span className="tq-map-size">{map.sizeClass ?? '10Q'}</span>
            </div>
            <div className="tq-map-sub">{map.subtitle}</div>
            <div className="tq-map-more">
              <span>
                主场 · {map.homeClassName}
              </span>
              <button onMouseEnter={() => setRulesOpen(true)} onMouseLeave={() => setRulesOpen(false)} onClick={() => setRulesOpen((v) => !v)}>
                玩法 ⓘ
              </button>
              {rulesOpen && (
                <div className="tq-rules">
                  {map.mechanics.map((m) => (
                    <p key={m}>{m}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="tq-maps">
            {MAP_ORDER.map((id) => {
              const m = MAPS[id];
              const on = id === pick;
              return (
                <button
                  key={id}
                  disabled={!m.available || p.hostPicks}
                  className={`tq-map ${on ? 'on' : ''}`}
                  onClick={() => {
                    setPick(id);
                    p.onSelectMap(id);
                  }}
                  onDoubleClick={() => p.onStart(id)}
                  title={m.subtitle}
                >
                  <img
                    src={`./maps/${id}.webp`}
                    alt=""
                    draggable={false}
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
                  />
                  <span className="tq-map-n">{m.name}</span>
                </button>
              );
            })}
          </div>
          <button className={'tq-go' + (p.loadPct !== undefined ? ' loading' : '')} disabled={p.hostPicks || !map.available || !p.ready || p.loadPct !== undefined} onClick={() => p.onStart(pick)}>
            {p.loadPct !== undefined && !p.hostPicks ? (
              // the scene is still being built before the download even starts: say so, rather than a frozen 0%
              <small>{p.loadPct <= 5 ? '准备' : p.loadPct >= 99 ? '即将' : '载入'}
                <br />
                {p.loadPct <= 5 ? '中' : p.loadPct >= 99 ? '就绪' : `${Math.round(p.loadPct)}%`}</small>
            ) : p.hostPicks ? (
              <small>等房主
                <br />
                选战场</small>
            ) : !p.ready ? (
              <small>两边
                <br />
                都要有人</small>
            ) : (
              <>
                出<br />征
              </>
            )}
          </button>
        </section>
      </div>
    </div>
  );
}

const LOBBY_CSS = `
.tq-lobby { --ink:#1f1c18; --ink2:#5a544a; --paper:#f4eee2; --red:#a8362a; --gold:#a8823c; color:var(--ink);
  font-family:"Noto Serif SC","Songti SC","STSong",serif; }
.tq-l-wrap { position:relative; z-index:20; height:100%; display:flex; flex-direction:column; padding:3.2vh 4vw 3vh; gap:2vh; overflow-y:auto; }
.tq-l-head { position:relative; display:flex; align-items:flex-start; justify-content:space-between; }
.tq-l-title { display:flex; align-items:flex-end; gap:14px; }
.tq-l-title h1 { margin:0; font-family:"Ma Shan Zheng","STXingkai","KaiTi",serif; font-weight:400; font-size:clamp(56px,7.5vw,108px); line-height:.9; letter-spacing:.05em; color:var(--ink); text-shadow:0 2px 0 rgba(255,255,255,.4); }
.tq-seal { align-self:flex-start; margin-top:.5em; width:26px; text-align:center; font-family:"Ma Shan Zheng",serif; font-size:15px; line-height:1.15; color:#f6efe2; background:var(--red); padding:5px 0; border-radius:3px; box-shadow:inset 0 0 0 1.5px rgba(255,240,220,.35); }
.tq-l-name { margin-left:10px; margin-bottom:10px; background:none; border:none; border-bottom:1px solid rgba(31,28,24,.25); color:var(--ink); font:600 15px "Noto Serif SC",serif; cursor:pointer; padding:2px 2px 4px; }
.tq-l-name span { color:var(--ink2); font-weight:400; font-size:12px; margin-right:6px; letter-spacing:.2em; }
.tq-l-name i { font-style:normal; color:var(--ink2); font-size:12px; margin-left:4px; }
.tq-l-tools { display:flex; align-items:center; gap:12px; }
.tq-chip { background:rgba(244,238,226,.6); backdrop-filter:blur(6px); border:1px solid rgba(31,28,24,.22); border-radius:999px; padding:7px 18px; font:600 14px "Noto Serif SC",serif; letter-spacing:.3em; color:var(--ink); cursor:pointer; transition:all .2s; }
.tq-chip:hover, .tq-chip.on { border-color:var(--red); color:var(--red); }
.tq-chip em { font-style:normal; letter-spacing:0; margin-left:8px; font-size:12px; color:#2f7a4e; }
.tq-ver { font-size:11px; color:var(--ink2); opacity:.7; }
.tq-pop { position:absolute; right:0; top:52px; z-index:40; width:min(420px,92vw); background:rgba(246,241,231,.97); border:1px solid rgba(31,28,24,.18); border-radius:14px; padding:18px 18px 16px; box-shadow:0 20px 50px rgba(40,30,15,.18); }
.tq-pop-h { font-weight:900; letter-spacing:.3em; font-size:14px; margin-bottom:12px; }
.tq-pop-x { position:absolute; right:10px; top:6px; background:none; border:none; font-size:22px; color:var(--ink2); cursor:pointer; }

.tq-l-heroes { flex:1; min-height:0; display:grid; grid-template-columns:auto 1fr; grid-template-rows:1fr auto; column-gap:2.4vw; row-gap:1.6vh; align-items:end; }
.tq-l-label { grid-row:1 / span 2; align-self:center; font-family:"Ma Shan Zheng",serif; font-size:30px; line-height:1.15; color:var(--ink2); }
.tq-heroes { display:grid; grid-template-columns:repeat(5, minmax(0, 190px)); gap:1.3vw; align-items:end; }
.tq-hero { --acc:#a3402b; position:relative; text-align:left; cursor:pointer; padding:0 0 14px; border-radius:14px;
  background:linear-gradient(180deg, rgba(246,241,231,0) 0%, rgba(246,241,231,.55) 46%, rgba(246,241,231,.8) 100%);
  border:1px solid rgba(31,28,24,.12); transition:transform .25s ease, box-shadow .25s ease, border-color .25s; overflow:visible; }
.tq-hero:hover { transform:translateY(-4px); border-color:rgba(31,28,24,.3); }
.tq-hero.on { transform:translateY(-10px); border-color:var(--acc); box-shadow:0 18px 40px -18px rgba(60,35,15,.45), inset 0 0 0 1px var(--acc); }
.tq-hero-art { position:relative; height:clamp(150px,24vh,250px); display:flex; align-items:flex-end; justify-content:center; }
.tq-hero-art img { position:relative; height:100%; width:auto; max-width:100%; object-fit:contain; filter:saturate(.85) contrast(1.02); transition:filter .25s; -webkit-mask-image:linear-gradient(to bottom, #000 72%, transparent 100%); mask-image:linear-gradient(to bottom, #000 72%, transparent 100%); }
.tq-hero:not(.on) .tq-hero-art img { filter:saturate(.8) brightness(.97); }
.tq-hero-wash { position:absolute; left:50%; bottom:6%; width:86%; aspect-ratio:1; transform:translateX(-50%); border-radius:50%;
  background:radial-gradient(circle, color-mix(in srgb, var(--acc) 26%, transparent) 0%, transparent 66%); opacity:.0; transition:opacity .3s; }
.tq-hero.on .tq-hero-wash, .tq-hero:hover .tq-hero-wash { opacity:1; }
.tq-hero-name { padding:6px 16px 0; font-family:"Ma Shan Zheng",serif; font-size:clamp(26px,2.6vw,36px); line-height:1; color:var(--ink); }
.tq-hero.on .tq-hero-name { color:var(--acc); }
.tq-hero-who { padding:4px 16px 0; font-size:12px; letter-spacing:.35em; color:var(--ink2); }
.tq-hero-tag { padding:6px 16px 0; font-size:12px; color:var(--ink2); }
.tq-bars { display:grid; grid-template-columns:auto 1fr; align-items:center; gap:4px 10px; padding:10px 16px 0; font-size:10.5px; letter-spacing:.2em; color:var(--ink2); }
.tq-bars i { height:3px; background:rgba(31,28,24,.1); border-radius:2px; overflow:hidden; }
.tq-bars b { display:block; height:100%; background:var(--ink); opacity:.7; }
.tq-hero.on .tq-bars b { background:var(--acc); opacity:1; }
.tq-hero-stamp { position:absolute; top:12px; right:12px; width:30px; height:30px; display:grid; place-items:center; font-family:"Ma Shan Zheng",serif; font-size:19px; color:#f6efe2; background:var(--red); border-radius:4px; transform:rotate(-6deg); box-shadow:inset 0 0 0 1.5px rgba(255,240,220,.35); animation:tqStamp .28s ease-out; }
@keyframes tqStamp { from { transform:rotate(-6deg) scale(1.7); opacity:0; } to { transform:rotate(-6deg) scale(1); opacity:1; } }

.tq-foe { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.tq-foe-l { font-size:12px; letter-spacing:.4em; color:var(--ink2); margin-right:4px; }
.tq-foe-note { font-size:13px; color:var(--ink2); }
.tq-vs { font:400 22px "Ma Shan Zheng",serif; color:var(--ink2); margin:0 2px; }
.tq-side { display:flex; gap:6px; padding:4px; border-radius:12px; }
.tq-side.s0 { background:rgba(163,64,43,.08); }
.tq-side.s1 { background:rgba(44,74,110,.08); }
.tq-seat { display:flex; align-items:center; gap:6px; min-width:118px; height:46px; padding:3px 8px 3px 3px; border-radius:999px; border:1px solid rgba(31,28,24,.18); background:rgba(246,241,231,.7); position:relative; }
.tq-seat.me { border:2px solid var(--ink); }
.tq-seat.empty { justify-content:center; color:var(--ink2); font:600 12px "Noto Serif SC",serif; letter-spacing:.2em; border-style:dashed; cursor:pointer; background:rgba(246,241,231,.35); }
.tq-seat.empty:disabled { cursor:default; }
.tq-seat-face { width:38px; height:38px; border-radius:50%; overflow:hidden; border:none; padding:0; background:rgba(31,28,24,.08); cursor:pointer; flex:none; }
.tq-seat-face:disabled { cursor:default; }
.tq-seat-face img { width:100%; height:100%; object-fit:cover; object-position:50% 20%; }
.tq-seat-n { display:flex; flex-direction:column; font:600 12.5px "Noto Serif SC",serif; color:var(--ink); line-height:1.15; max-width:70px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.tq-seat-n i { font-style:normal; font-weight:400; font-size:11px; color:var(--ink2); }
.tq-seat-ops { display:flex; gap:2px; margin-left:auto; }
.tq-seat-ops button { border:none; background:none; font-size:13px; color:var(--ink2); cursor:pointer; padding:0 3px; }
.tq-seat-ops button:hover { color:var(--ink); }
.tq-foe-a { width:40px; height:40px; border-radius:50%; overflow:hidden; border:1px solid rgba(31,28,24,.2); background:rgba(246,241,231,.7); padding:0; cursor:pointer; transition:all .2s; }
.tq-foe-a img { width:100%; height:100%; object-fit:cover; object-position:50% 20%; filter:grayscale(.7); }
.tq-foe-a.on { border:2px solid var(--ink); }
.tq-foe-a.on img, .tq-foe-a:hover img { filter:none; }
.tq-seg { display:inline-flex; margin-left:14px; border:1px solid rgba(31,28,24,.22); border-radius:999px; overflow:hidden; background:rgba(246,241,231,.55); }
.tq-seg button { border:none; background:none; padding:6px 14px; font:600 12.5px "Noto Serif SC",serif; letter-spacing:.15em; color:var(--ink2); cursor:pointer; }
.tq-seg button.on { background:var(--ink); color:var(--paper); }
.tq-lvl button.hell.on { background:#7a1712; }
.tq-lvl button.hard.on { background:#a8362a; }

.tq-l-maps { display:grid; grid-template-columns:minmax(220px,300px) 1fr auto; gap:1.8vw; align-items:end; }
.tq-map-info { position:relative; padding-bottom:4px; }
.tq-map-title { font-family:"Ma Shan Zheng",serif; font-size:clamp(30px,3vw,42px); line-height:1; display:flex; align-items:baseline; gap:10px; }
.tq-map-size { font-family:"Noto Serif SC",serif; font-size:11px; letter-spacing:.1em; border:1px solid rgba(31,28,24,.3); padding:1px 6px; border-radius:3px; color:var(--ink2); }
.tq-map-sub { margin-top:8px; font-size:13px; color:var(--ink2); line-height:1.6; }
.tq-map-more { margin-top:8px; display:flex; gap:14px; align-items:center; font-size:12px; color:var(--ink2); }
.tq-map-more button { background:none; border:none; border-bottom:1px dotted rgba(31,28,24,.4); font:inherit; color:var(--ink); cursor:pointer; padding:0; }
.tq-rules { position:absolute; left:0; bottom:calc(100% + 10px); width:min(380px,86vw); background:rgba(246,241,231,.98); border:1px solid rgba(31,28,24,.15); border-radius:10px; padding:12px 14px; box-shadow:0 16px 40px rgba(40,30,15,.18); z-index:30; }
.tq-rules p { margin:0 0 6px; font-size:12.5px; line-height:1.6; color:var(--ink); }
.tq-rules p:last-child { margin:0; }
.tq-maps { display:grid; grid-template-columns:repeat(7, minmax(0, 1fr)); gap:10px; padding:12px 2px 6px; }
.tq-maps::-webkit-scrollbar { display:none; }
.tq-map { position:relative; width:100%; max-width:180px; aspect-ratio:3/2; border-radius:10px; overflow:hidden; padding:0; cursor:pointer;
  border:1px solid rgba(31,28,24,.2); background:linear-gradient(160deg,#5c6965,#2a312f); transition:transform .22s, box-shadow .22s, border-color .22s; }
.tq-map img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; filter:saturate(.55) brightness(.92); transition:filter .25s, transform .4s; }
.tq-map::after { content:""; position:absolute; inset:0; background:linear-gradient(to top, rgba(18,15,12,.72) 0%, rgba(18,15,12,0) 55%); }
.tq-map-n { position:absolute; left:9px; right:6px; bottom:6px; z-index:2; color:#f4eee2; font-size:clamp(11px,.95vw,13.5px); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; letter-spacing:.12em; text-shadow:0 1px 3px rgba(0,0,0,.5); }
.tq-map:hover:not(:disabled) { transform:translateY(-3px); }
.tq-map:hover img, .tq-map.on img { filter:none; transform:scale(1.04); }
.tq-map.on { border:2px solid var(--red); box-shadow:0 14px 30px -14px rgba(120,40,20,.6); transform:translateY(-6px); }
.tq-map:disabled { cursor:default; opacity:.55; }
.tq-go { width:clamp(92px,8vw,118px); aspect-ratio:1; border:none; border-radius:10px; cursor:pointer; background:var(--red); color:#f6efe2;
  font-family:"Ma Shan Zheng",serif; font-size:clamp(30px,2.8vw,40px); line-height:1.05; box-shadow:inset 0 0 0 3px rgba(255,240,220,.28), 0 18px 34px -16px rgba(120,30,20,.7); transition:transform .2s, filter .2s; }
.tq-go:hover:not(:disabled) { transform:translateY(-3px) rotate(-2deg); filter:brightness(1.08); }
.tq-go:disabled { background:#8a8377; cursor:default; }
.tq-go.loading { background:linear-gradient(110deg, #8a8377 30%, #a89c86 45%, #8a8377 60%); background-size:250% 100%; animation:tq-shimmer 1.6s linear infinite; }
@keyframes tq-shimmer { from { background-position:120% 0; } to { background-position:-120% 0; } }
.tq-go small { font-family:"Noto Serif SC",serif; font-size:13px; letter-spacing:.2em; line-height:1.6; }

.tq-btn { border:1px solid var(--ink); background:var(--ink); color:var(--paper); border-radius:8px; padding:9px 16px; font:600 13px "Noto Serif SC",serif; letter-spacing:.2em; cursor:pointer; }
.tq-btn.ghost { background:none; color:var(--ink); }
.tq-btn:disabled { opacity:.35; cursor:default; }
.tq-input { flex:1; min-width:0; border:none; border-bottom:1.5px solid rgba(31,28,24,.35); background:none; padding:8px 4px; font:600 18px ui-monospace,Menlo,monospace; letter-spacing:.4em; color:var(--ink); outline:none; }
.tq-input:focus { border-color:var(--red); }
.tq-on { display:flex; flex-direction:column; gap:12px; font-size:13px; color:var(--ink2); line-height:1.6; }
.tq-on-row { display:flex; gap:10px; align-items:center; }
.tq-on-code { font:900 24px ui-monospace,Menlo,monospace; letter-spacing:.35em; color:var(--red); }
.tq-on-ok { color:#2f7a4e; font-weight:600; }
.tq-on-err { color:var(--red); font-weight:600; }

/* the name screen */
.tq-gate { position:fixed; inset:0; z-index:60; }
.tq-gate-card { position:relative; z-index:20; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px; padding:16px; }
.tq-gate h1 { margin:0; font-family:"Ma Shan Zheng",serif; font-weight:400; font-size:clamp(84px,13vw,170px); line-height:.9; color:var(--ink); letter-spacing:.06em; }
.tq-gate-sub { font-size:14px; letter-spacing:.6em; color:var(--ink2); margin-top:-6px; }
.tq-gate form { display:flex; flex-direction:column; align-items:center; gap:18px; width:min(360px,90vw); }
.tq-gate input { width:100%; text-align:center; border:none; border-bottom:1.5px solid rgba(31,28,24,.4); background:none; padding:10px 4px; font:600 22px "Noto Serif SC",serif; letter-spacing:.15em; color:var(--ink); outline:none; }
.tq-gate input:focus { border-color:var(--red); }
.tq-gate input::placeholder { color:rgba(31,28,24,.3); }
.tq-gate-go { display:flex; gap:12px; }
.tq-gate-go .tq-go { width:auto; aspect-ratio:auto; padding:12px 30px; font-size:28px; }
.tq-gate small { font-size:11.5px; color:var(--ink2); opacity:.8; }

@media (max-width: 900px) {
  /* narrow: the heroes keep their full height and the page scrolls, instead of the map strip sliding over them */
  .tq-heroes { grid-template-columns:repeat(3, minmax(0,1fr)); }
  .tq-l-heroes { grid-template-columns:1fr; flex:none; }
  .tq-l-label { display:none; }
  .tq-l-maps { grid-template-columns:1fr; }
  .tq-maps { grid-template-columns:repeat(4, minmax(0,1fr)); }
  .tq-go { justify-self:end; }
}
@media (max-width: 560px) {
  .tq-heroes { grid-template-columns:repeat(2, minmax(0,1fr)); }
}
`;

/** the first screen: ink landscape, the title, and your name */
export function NameGate({ value, onChange, onSubmit, onCancel }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onCancel?: () => void }) {
  return (
    <div className="tq-lobby tq-gate">
      <style>{LOBBY_CSS}</style>
      <InkBackdrop />
      <div className="tq-gate-card">
        <h1>天阙</h1>
        <div className="tq-gate-sub">初入江湖 · 报上名号</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <input autoFocus value={value} maxLength={12} onChange={(e) => onChange(e.target.value)} placeholder="一剑西来" />
          <div className="tq-gate-go">
            {onCancel && (
              <button type="button" className="tq-btn ghost" onClick={onCancel}>
                取消
              </button>
            )}
            <button type="submit" className="tq-go" disabled={!value.trim()}>
              入江湖
            </button>
          </div>
          <small>名号最多 12 字，会显示在血条和联机对手的屏幕上</small>
        </form>
      </div>
    </div>
  );
}
