import React, { useMemo } from 'react';

/**
 * 水墨山水 backdrop for the lobby: rice paper, a pale vermilion sun, layered ink-wash peaks fading into mist,
 * cloud banks drifting between the ranges, and now and then an immortal on a crane gliding across the sky.
 * Pure SVG + CSS (the ranges are drawn once; only the clouds and the crane animate).
 */

/** a deterministic little random */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * a mountain range as an SVG path across a 1600 × 900 frame: a few steep karst peaks (the way they're painted:
 * tall, rounded tops, sheer sides) on a rolling base line, with small ragged detail on the skyline
 */
function rangePath(seed: number, base: number, peaks: { x: number; h: number; w: number }[], rough: number) {
  const r = rng(seed);
  const pts: [number, number][] = [];
  const noise: number[] = [];
  for (let i = 0; i <= 200; i++) noise.push(r() - 0.5);
  for (let i = 0; i <= 200; i++) {
    const x = (i / 200) * 1700 - 50;
    let y = base + Math.sin(x * 0.004 + seed) * 18 + Math.sin(x * 0.011 + seed * 2) * 9;
    for (const p of peaks) {
      const d = (x - p.x) / p.w;
      // a rounded, steep-sided peak: flat-ish top falling away sharply
      y -= p.h * Math.exp(-Math.pow(Math.abs(d), 2.4));
    }
    y += (noise[i] + noise[Math.max(0, i - 1)] * 0.5) * rough;
    pts.push([x, y]);
  }
  let d = `M -50 900 L ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`;
  return d + ' L 1650 900 Z';
}

const LAYERS = [
  // far: faint blue-grey ranges
  { seed: 3, base: 470, rough: 4, tone: '#6f7f7c', alpha: 0.28, peaks: [{ x: 180, h: 120, w: 90 }, { x: 520, h: 70, w: 120 }, { x: 980, h: 150, w: 80 }, { x: 1300, h: 95, w: 110 }, { x: 1530, h: 130, w: 70 }] },
  // middle: the tall karst peaks
  { seed: 11, base: 580, rough: 6, tone: '#3f4b48', alpha: 0.5, peaks: [{ x: 90, h: 300, w: 70 }, { x: 260, h: 210, w: 60 }, { x: 1180, h: 260, w: 75 }, { x: 1380, h: 340, w: 64 }, { x: 1560, h: 220, w: 60 }] },
  // near: dark ink on both flanks, open in the middle where the UI sits
  { seed: 23, base: 720, rough: 8, tone: '#1f2421', alpha: 0.82, peaks: [{ x: -20, h: 330, w: 110 }, { x: 170, h: 170, w: 80 }, { x: 1470, h: 250, w: 90 }, { x: 1640, h: 380, w: 90 }] },
];

/** an immortal on a red-crowned crane, wings beating slowly, ribbons streaming behind */
function CraneRider() {
  return (
    <svg viewBox="0 0 220 130" className="tq-crane-svg" aria-hidden>
      {/* far wing, behind the body */}
      <g className="tq-wing tq-wing-far">
        <path d="M118 62 C104 34 80 18 40 10 C66 28 86 46 108 66 Z" fill="#d9d6cf" />
        <path d="M40 10 C54 16 64 22 72 30 L60 27 Z" fill="#2b2a28" />
      </g>
      {/* trailing legs */}
      <path d="M72 72 L18 80 M74 74 L22 86" stroke="#2f2e2b" strokeWidth="1.3" strokeLinecap="round" />
      {/* body and black tail plumes */}
      <path d="M64 66 C84 50 126 52 148 60 C158 64 156 74 142 76 C114 82 84 80 64 66 Z" fill="#f7f4ee" />
      <path d="M66 66 C56 62 48 66 44 72 C54 70 60 72 70 72 Z" fill="#26241f" />
      {/* neck, head, red crown, beak */}
      <path d="M146 62 Q170 52 192 50" stroke="#f7f4ee" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M160 56 Q176 51 190 50" stroke="#2b2a28" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="193" cy="49.5" r="3.6" fill="#f7f4ee" />
      <circle cx="193.5" cy="47.2" r="1.7" fill="#b8322a" />
      <path d="M196 50 L210 52" stroke="#4a4740" strokeWidth="1.6" strokeLinecap="round" />
      {/* the rider: a robed figure seated on its back, topknot, a streaming sash */}
      <g className="tq-rider">
        <path className="tq-sash" d="M112 38 C92 30 76 42 56 32 C44 26 32 32 18 26" stroke="#b23a2a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path className="tq-sash tq-sash2" d="M114 42 C98 40 84 48 66 42 C54 38 44 44 32 40" stroke="#c9a35a" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d="M104 60 C104 44 110 36 116 33 C122 36 124 46 122 60 Z" fill="#2a2d2b" />
        <path d="M110 58 C111 47 114 41 117 39 C119 44 119 52 118 58 Z" fill="#8a9a92" />
        <circle cx="117" cy="29" r="3.6" fill="#2a2d2b" />
        <circle cx="117.5" cy="24.6" r="1.6" fill="#2a2d2b" />
        <path d="M122 46 L132 42" stroke="#2a2d2b" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      {/* near wing, in front */}
      <g className="tq-wing tq-wing-near">
        <path d="M122 60 C108 28 82 8 30 2 C64 22 90 44 112 66 Z" fill="#fbf9f4" />
        <path d="M30 2 C48 8 60 16 70 24 L56 21 Z M42 6 C52 12 60 18 66 24" fill="#24221e" stroke="#24221e" strokeWidth="0.5" />
        <path d="M60 24 C78 34 94 46 108 60" stroke="#d6d1c6" strokeWidth="1" fill="none" />
      </g>
    </svg>
  );
}

export function InkBackdrop({ dim = 0 }: { dim?: number }) {
  const paths = useMemo(() => LAYERS.map((l) => rangePath(l.seed, l.base, l.peaks, l.rough)), []);
  return (
    <div className="tq-ink" aria-hidden>
      <style>{INK_CSS}</style>
      <div className="tq-paper" />
      <div className="tq-sun" />
      {/* faraway birds */}
      <svg className="tq-birds" viewBox="0 0 60 20">
        <path d="M2 10 Q6 6 10 10 Q14 6 18 10" stroke="#3a3833" strokeWidth="1" fill="none" />
        <path d="M30 4 Q33 1 36 4 Q39 1 42 4" stroke="#3a3833" strokeWidth="0.8" fill="none" />
        <path d="M44 14 Q46.5 11.5 49 14 Q51.5 11.5 54 14" stroke="#3a3833" strokeWidth="0.7" fill="none" />
      </svg>
      <div className="tq-crane">
        <div className="tq-crane-bob">
          <CraneRider />
        </div>
      </div>
      {LAYERS.map((l, i) => (
        <React.Fragment key={i}>
          <svg className="tq-range" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" style={{ zIndex: 2 + i * 2 }}>
            <defs>
              <linearGradient id={`tqwash${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={l.tone} stopOpacity={l.alpha} />
                <stop offset={i === 2 ? '0.75' : '0.62'} stopColor={l.tone} stopOpacity={l.alpha * 0.35} />
                <stop offset="1" stopColor={l.tone} stopOpacity="0" />
              </linearGradient>
              <filter id={`tqbrush${i}`} x="-5%" y="-5%" width="110%" height="110%">
                <feTurbulence type="fractalNoise" baseFrequency={0.012 + i * 0.006} numOctaves="3" seed={l.seed} />
                <feDisplacementMap in="SourceGraphic" scale={6 + i * 4} />
              </filter>
            </defs>
            <path d={paths[i]} fill={`url(#tqwash${i})`} filter={`url(#tqbrush${i})`} />
          </svg>
          {/* a bank of cloud drifting in front of each range */}
          <div className="tq-cloud" style={{ zIndex: 3 + i * 2, top: `${48 + i * 11}%`, animationDuration: `${120 - i * 28}s`, animationDelay: `${-i * 37}s`, opacity: 0.9 - i * 0.15 }} />
          <div className="tq-cloud tq-cloud-b" style={{ zIndex: 3 + i * 2, top: `${55 + i * 10}%`, animationDuration: `${150 - i * 30}s`, animationDelay: `${-60 - i * 23}s`, opacity: 0.75 - i * 0.12 }} />
        </React.Fragment>
      ))}
      <div className="tq-ground-mist" />
      {dim > 0 && <div className="tq-dim" style={{ opacity: dim }} />}
    </div>
  );
}

const INK_CSS = `
.tq-ink { position:absolute; inset:0; overflow:hidden; background:#ece5d6; }
.tq-paper { position:absolute; inset:0; z-index:0;
  background:
    radial-gradient(120% 80% at 50% 20%, #f6f1e6 0%, #ebe3d3 55%, #ddd3c0 100%);
}
.tq-paper::after { content:""; position:absolute; inset:0; opacity:.35; mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .55  0 0 0 0 .5  0 0 0 0 .42  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.tq-sun { position:absolute; z-index:1; width:min(14vw,170px); aspect-ratio:1; right:24%; top:13%; border-radius:50%;
  background:radial-gradient(circle, rgba(196,74,52,.55) 0%, rgba(196,74,52,.38) 52%, rgba(196,74,52,0) 70%); filter:blur(.5px); }
.tq-range { position:absolute; inset:0; width:100%; height:100%; }
.tq-cloud { position:absolute; left:0; width:70vw; height:22vh; pointer-events:none;
  background:radial-gradient(50% 50% at 50% 50%, rgba(247,243,235,.95) 0%, rgba(247,243,235,.6) 45%, rgba(247,243,235,0) 72%);
  filter:blur(6px); animation:tqDrift linear infinite; }
.tq-cloud-b { width:55vw; height:16vh; animation-name:tqDrift2; }
@keyframes tqDrift { from { transform:translateX(-75vw); } to { transform:translateX(110vw); } }
@keyframes tqDrift2 { from { transform:translateX(110vw); } to { transform:translateX(-75vw); } }
.tq-ground-mist { position:absolute; left:0; right:0; bottom:0; height:38%; z-index:9;
  background:linear-gradient(to top, rgba(236,229,214,.96) 0%, rgba(236,229,214,.75) 35%, rgba(236,229,214,0) 100%); }
.tq-dim { position:absolute; inset:0; z-index:10; background:#ece5d6; }
.tq-birds { position:absolute; z-index:1; width:60px; left:30%; top:20%; opacity:.55; }
.tq-crane { position:absolute; z-index:5; top:15%; left:0; width:min(17vw,210px); animation:tqFly 46s linear infinite; animation-delay:-6s; }
.tq-crane-bob { animation:tqBob 5.5s ease-in-out infinite; }
.tq-crane-svg { width:100%; height:auto; display:block; filter:drop-shadow(0 6px 10px rgba(60,50,30,.12)); overflow:visible; }
@keyframes tqFly {
  0% { transform:translate(-25vw, 6vh) scale(.82); }
  78% { transform:translate(108vw, -4vh) scale(1); }
  100% { transform:translate(108vw, -4vh) scale(1); }
}
@keyframes tqBob { 0%,100% { transform:translateY(0) rotate(-2deg); } 50% { transform:translateY(-14px) rotate(1.5deg); } }
.tq-wing { transform-box:view-box; transform-origin:118px 62px; animation:tqFlap 2.6s ease-in-out infinite; }
.tq-wing-far { animation-delay:-.08s; }
@keyframes tqFlap { 0%,100% { transform:rotate(-6deg) scaleY(1); } 45% { transform:rotate(24deg) scaleY(.55); } 60% { transform:rotate(22deg) scaleY(.5); } }
.tq-sash { animation:tqSash 2.2s ease-in-out infinite; transform-box:view-box; transform-origin:112px 38px; }
.tq-sash2 { animation-delay:-.7s; }
@keyframes tqSash { 0%,100% { transform:skewY(0deg) scaleX(1); } 50% { transform:skewY(-5deg) scaleX(1.04); } }
@media (prefers-reduced-motion: reduce) { .tq-cloud, .tq-crane, .tq-crane-bob, .tq-wing, .tq-sash { animation:none; } }
`;
