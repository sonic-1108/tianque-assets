import React, { useEffect, useState } from 'react';
import { InkBackdrop } from './InkBackdrop';
import { MAPS } from '../../maps';

// Every battlefield's mechanics line doubles as a loading tip, so the tips are always true to the game
const TIPS: { map: string; text: string }[] = Object.values(MAPS)
  .filter((m) => m.available)
  .flatMap((m) => (m.mechanics || []).map((t: string) => ({ map: m.name, text: t })));

const CSS = `
.tq-load { position:fixed; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; background:#f4eee2; color:#1f1c18; overflow:hidden; }
.tq-load-in { position:relative; z-index:20; padding:28px 26px 22px; width:min(560px, calc(100vw - 32px)); display:flex; flex-direction:column; align-items:center; text-align:center; }
.tq-load-title { display:flex; align-items:flex-end; gap:12px; }
.tq-load-title h1 { margin:0; font-family:"Ma Shan Zheng","STXingkai","KaiTi",serif; font-weight:400; font-size:clamp(64px,12vw,112px); line-height:.9; letter-spacing:.05em; }
.tq-load-seal { align-self:flex-start; margin-top:.6em; width:24px; font-family:"Ma Shan Zheng",serif; font-size:14px; line-height:1.15; color:#f6efe2; background:#a8362a; padding:5px 0; border-radius:3px; }
.tq-load-hero { margin-top:22px; font:600 16px "Noto Serif SC",serif; letter-spacing:.35em; }
.tq-load-hero b { color:#a8362a; font-weight:900; }
.tq-load-bar { position:relative; margin-top:18px; width:100%; height:6px; }
.tq-load-bar::before { content:""; position:absolute; left:0; right:0; top:2px; height:2px; background:rgba(31,28,24,.15); border-radius:2px; }
.tq-load-fill { position:absolute; left:0; top:0; height:6px; border-radius:6px; background:linear-gradient(90deg, rgba(31,28,24,.85), #1f1c18 70%, #a8362a); transition:width .3s ease; }
.tq-load-fill::after { content:""; position:absolute; right:-5px; top:-3px; width:12px; height:12px; border-radius:50%; background:#a8362a; box-shadow:0 0 0 3px rgba(168,54,42,.18); }
.tq-load-pct { margin-top:10px; font:600 13px "Noto Serif SC",serif; letter-spacing:.2em; color:#5a544a; }
.tq-load-in::before { content:""; position:absolute; inset:-60px -120px; z-index:-1; background:radial-gradient(closest-side, rgba(244,238,226,.94) 60%, rgba(244,238,226,0)); pointer-events:none; }
.tq-load-tip { margin-top:34px; min-height:3.4em; font:400 14px/1.7 "Noto Serif SC",serif; color:#5a544a; transition:opacity .4s; }
.tq-load-tip span { display:inline-block; margin-right:8px; padding:0 6px; border:1px solid rgba(168,54,42,.5); border-radius:3px; color:#a8362a; font-size:12px; letter-spacing:.15em; }
.tq-load-err { margin-top:22px; font:600 15px "Noto Serif SC",serif; color:#a8362a; }
.tq-load-err p { margin:8px 0 16px; font-weight:400; font-size:13px; color:#5a544a; }
.tq-load-btn { border:none; border-radius:8px; padding:10px 28px; background:#a8362a; color:#f6efe2; font:600 15px "Noto Serif SC",serif; letter-spacing:.3em; cursor:pointer; }
`;

/** 入场画面: shown while the hero models for a match download */
export function LoadingScreen({ progress, error, onRetry, hero }: { progress: number; error: string | null; onRetry: () => void; hero: string }) {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * Math.max(1, TIPS.length)));
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const id = setInterval(() => {
      setShown(false);
      setTimeout(() => {
        setTip((t) => (t + 1 + Math.floor(Math.random() * 3)) % Math.max(1, TIPS.length));
        setShown(true);
      }, 400);
    }, 5000);
    return () => clearInterval(id);
  }, []);
  const pct = Math.max(3, Math.min(100, progress));
  const t = TIPS[tip];
  return (
    <div className="tq-load">
      <style>{CSS}</style>
      <InkBackdrop poem={false} />
      <div className="tq-load-in">
        <div className="tq-load-title">
          <h1>天阙</h1>
          <span className="tq-load-seal">
            江<br />湖
          </span>
        </div>
        {error ? (
          <div className="tq-load-err">
            {hero}没能入场
            <p>网络不太稳，模型没有下载完整。刷新一下通常就好。</p>
            <button className="tq-load-btn" onClick={onRetry}>
              重新加载
            </button>
          </div>
        ) : (
          <>
            <div className="tq-load-hero">
              <b>{hero}</b>　整装待发
            </div>
            <div className="tq-load-bar">
              <div className="tq-load-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="tq-load-pct">{progress >= 99 ? '即将入场' : progress <= 5 ? '准备场景中' : `${Math.round(progress)}%`}</div>
            {t && (
              <div className="tq-load-tip" style={{ opacity: shown ? 1 : 0 }}>
                <span>{t.map}</span>
                {t.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
