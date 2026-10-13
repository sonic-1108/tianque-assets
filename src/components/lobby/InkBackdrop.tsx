import React, { useEffect, useRef } from 'react';

/**
 * 水墨山水 backdrop for the lobby. The ranges are painted once on canvases the way an ink painting is built up:
 * a dark brush line along each ridge, washes bleeding down from it, streaky 皴 texture strokes on the slopes,
 * 苔点 moss dots on the crests, and the lower slopes dissolving into mist. A gnarled pine reaches in from the corner,
 * a lone boat sits on the misty lake, two lines of verse hang on the right; clouds drift and an immortal on a
 * crane glides across the sky.
 */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** smooth 1-D value noise */
function noise1(seed: number) {
  const r = rng(seed);
  const v: number[] = [];
  for (let i = 0; i < 512; i++) v.push(r());
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = v[((i % 512) + 512) % 512];
    const b = v[(((i + 1) % 512) + 512) % 512];
    const t = f * f * (3 - 2 * f);
    return a + (b - a) * t;
  };
}

interface Range {
  seed: number;
  base: number;
  peaks: { x: number; h: number; w: number }[];
  ink: [number, number, number];
  density: number; // 0..1 how dark the wash is
  depth: number; // how far the wash runs down from the ridge
  texture: number; // number of 皴 strokes
  moss: number; // number of moss dots
  mist: number; // how many mist gaps are wiped out of the lower slopes
}

const W = 1600;
const H = 900;

const RANGES: Range[] = [
  { seed: 5, base: 470, ink: [96, 110, 112], density: 0.32, depth: 230, texture: 260, moss: 60, mist: 9, peaks: [{ x: 150, h: 140, w: 85 }, { x: 470, h: 80, w: 120 }, { x: 900, h: 170, w: 75 }, { x: 1230, h: 110, w: 100 }, { x: 1500, h: 150, w: 70 }] },
  { seed: 17, base: 590, ink: [58, 66, 64], density: 0.55, depth: 300, texture: 520, moss: 140, mist: 11, peaks: [{ x: 70, h: 330, w: 62 }, { x: 250, h: 220, w: 55 }, { x: 1150, h: 280, w: 70 }, { x: 1360, h: 370, w: 60 }, { x: 1560, h: 240, w: 58 }] },
  { seed: 29, base: 740, ink: [28, 30, 28], density: 0.85, depth: 260, texture: 700, moss: 220, mist: 7, peaks: [{ x: -30, h: 360, w: 105 }, { x: 160, h: 190, w: 72 }, { x: 1480, h: 270, w: 85 }, { x: 1650, h: 400, w: 85 }] },
];

function ridgeY(r: Range, n: (x: number) => number, n2: (x: number) => number) {
  return (x: number) => {
    let y = r.base + Math.sin(x * 0.004 + r.seed) * 16 + Math.sin(x * 0.011 + r.seed * 2) * 8;
    for (const p of r.peaks) {
      const d = (x - p.x) / p.w;
      y -= p.h * Math.exp(-Math.pow(Math.abs(d), 2.3));
    }
    return y + (n(x * 0.05) - 0.5) * 10 + (n2(x * 0.35) - 0.5) * 3;
  };
}

function paintRange(cv: HTMLCanvasElement, r: Range) {
  const scale = Math.min(1.25, window.devicePixelRatio || 1);
  cv.width = W * scale;
  cv.height = H * scale;
  const g = cv.getContext('2d')!;
  g.scale(scale, scale);
  const rand = rng(r.seed * 7 + 1);
  const n = noise1(r.seed);
  const n2 = noise1(r.seed + 99);
  const n3 = noise1(r.seed + 211);
  const y = ridgeY(r, n, n2);
  const [R, G, B] = r.ink;
  const ink = (a: number) => `rgba(${R},${G},${B},${Math.max(0, Math.min(1, a))})`;
  // 1. the wash: ink bleeding down from the ridge, each column a little different (streaks like a loaded brush)
  for (let x = -20; x < W + 20; x += 1) {
    const y0 = y(x);
    const len = r.depth * (0.5 + 0.7 * n3(x * 0.012));
    const a = r.density * (0.62 + 0.55 * n2(x * 0.08)) * (0.85 + 0.3 * n(x * 0.6));
    const grd = g.createLinearGradient(0, y0, 0, y0 + len);
    grd.addColorStop(0, ink(a));
    grd.addColorStop(0.08, ink(a * 0.8));
    grd.addColorStop(0.4, ink(a * 0.38));
    grd.addColorStop(1, ink(0));
    g.fillStyle = grd;
    g.fillRect(x, y0 - 1, 1.6, len);
  }
  // soften the wash once (wet ink bleeding into the paper), instead of blurring every stroke
  {
    const tmp = document.createElement('canvas');
    tmp.width = cv.width;
    tmp.height = cv.height;
    const t = tmp.getContext('2d')!;
    t.filter = 'blur(0.8px)';
    t.drawImage(cv, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(tmp, 0, 0);
    g.setTransform(scale, 0, 0, scale, 0, 0);
  }
  // 2. 皴: short dry strokes running down the slopes, following the fall line
  for (let k = 0; k < r.texture; k++) {
    const x = rand() * (W + 40) - 20;
    const y0 = y(x);
    const t = Math.pow(rand(), 1.6);
    const sy = y0 + 4 + t * r.depth * 0.55;
    const slope = (y(x + 3) - y(x - 3)) / 6;
    const len = 8 + rand() * 26;
    const dx = -slope * len * 0.6 + (rand() - 0.5) * 6;
    g.strokeStyle = ink(r.density * (0.1 + rand() * 0.22) * (1 - t * 0.6));
    g.lineWidth = 0.6 + rand() * 1.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, sy);
    g.quadraticCurveTo(x + dx * 0.4 + (rand() - 0.5) * 4, sy + len * 0.5, x + dx, sy + len);
    g.stroke();
  }
  // 3. the ridge line itself: a brush of varying weight, darker on the crests
  for (let x = -20; x < W + 20; x += 2) {
    const w = 0.8 + 2.6 * Math.pow(n(x * 0.03), 2) * (0.6 + r.density);
    g.strokeStyle = ink(r.density * (0.55 + 0.4 * n2(x * 0.05)));
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y(x) + 0.5);
    g.lineTo(x + 2.2, y(x + 2) + 0.5);
    g.stroke();
  }
  // 4. 苔点: moss dots, gathered on the crests
  for (let k = 0; k < r.moss; k++) {
    const x = rand() * W;
    const y0 = y(x);
    const crest = y(x) < y(x - 30) && y(x) < y(x + 30) ? 1 : 0.4;
    if (rand() > crest) continue;
    const rr = 0.8 + rand() * 2.2 * (0.5 + r.density);
    g.fillStyle = ink(Math.min(1, r.density * 1.25) * (0.5 + rand() * 0.5));
    g.beginPath();
    g.ellipse(x, y0 + rand() * 10 - 1, rr * 1.3, rr, rand() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  // 5. mist: wipe soft gaps out of the lower slopes so the range floats in cloud
  g.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < r.mist; k++) {
    const x = rand() * W;
    const yy = y(x) + r.depth * (0.3 + rand() * 0.5);
    const rx = 120 + rand() * 260;
    const ry = 30 + rand() * 50;
    g.save();
    g.translate(x, yy);
    g.scale(rx / ry, 1);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, ry);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, ry, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';
}

/** a gnarled pine reaching in from the lower left, needles in fan-shaped clusters */
function paintPine(cv: HTMLCanvasElement) {
  const scale = Math.min(1.25, window.devicePixelRatio || 1);
  cv.width = W * scale;
  cv.height = H * scale;
  const g = cv.getContext('2d')!;
  g.scale(scale, scale);
  const rand = rng(77);
  const ink = (a: number) => `rgba(24,24,22,${a})`;
  // trunk: from the corner rising and leaning right, then a long limb
  const trunk: [number, number][] = [];
  for (let t = 0; t <= 1; t += 0.02) trunk.push([-30 + t * 300 + Math.sin(t * 5) * 18, 930 - t * 330 - Math.sin(t * 3.2) * 40]);
  const limb: [number, number][] = [];
  for (let t = 0; t <= 1; t += 0.02) limb.push([200 + t * 230, 700 - t * 90 + Math.sin(t * 6) * 10]);
  const branch = (pts: [number, number][], w0: number, w1: number) => {
    for (let i = 1; i < pts.length; i++) {
      const t = i / pts.length;
      g.strokeStyle = ink(0.78 + rand() * 0.15);
      g.lineWidth = w0 + (w1 - w0) * t + (rand() - 0.5) * 1.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(pts[i - 1][0], pts[i - 1][1]);
      g.lineTo(pts[i][0], pts[i][1]);
      g.stroke();
      // bark: dry flecks along the trunk
      if (rand() < 0.5) {
        g.strokeStyle = 'rgba(236,229,214,0.35)';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(pts[i][0] - 2, pts[i][1] + 2);
        g.lineTo(pts[i][0] + 4, pts[i][1] - 1);
        g.stroke();
      }
    }
  };
  branch(trunk, 22, 7);
  branch(limb, 9, 2.5);
  // needle clusters: fans of short strokes
  const fan = (cx: number, cy: number, s: number) => {
    for (let k = 0; k < 26; k++) {
      const a = -Math.PI * 0.95 + (k / 25) * Math.PI * 0.9 + (rand() - 0.5) * 0.1;
      const L = s * (0.7 + rand() * 0.4);
      g.strokeStyle = ink(0.55 + rand() * 0.3);
      g.lineWidth = 0.9 + rand() * 0.6;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L * 0.55);
      g.stroke();
    }
  };
  for (const [x, y, s] of [
    [250, 610, 46], [300, 590, 40], [360, 620, 42], [420, 600, 38], [205, 640, 34], [330, 650, 30], [400, 640, 28], [270, 570, 30], [440, 615, 26],
  ] as [number, number, number][])
    fan(x, y, s);
}

/** painted layers are kept for the whole visit: the name screen and the lobby share them */
const painted = new Map<(c: HTMLCanvasElement) => void, HTMLCanvasElement>();
const idle = (fn: () => void, order: number) => {
  const ric = (window as any).requestIdleCallback as ((cb: () => void, o?: { timeout: number }) => number) | undefined;
  if (ric) ric(fn, { timeout: 400 + order * 250 });
  else window.setTimeout(fn, 60 + order * 120);
};

function Canvas({ paint, z, className, order }: { paint: (c: HTMLCanvasElement) => void; z: number; className?: string; order: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = React.useState(() => painted.has(paint));
  useEffect(() => {
    let alive = true;
    const show = (src: HTMLCanvasElement) => {
      const cv = ref.current;
      if (!cv || !alive) return;
      cv.width = src.width;
      cv.height = src.height;
      cv.getContext('2d')!.drawImage(src, 0, 0);
      setReady(true);
    };
    const have = painted.get(paint);
    if (have) show(have);
    else
      // one layer per idle slot, so the page (and the game loading behind it) never stalls on the painting
      idle(() => {
        if (!alive) return;
        const off = document.createElement('canvas');
        paint(off);
        painted.set(paint, off);
        show(off);
      }, order);
    return () => {
      alive = false;
    };
  }, [paint, order]);
  return <canvas ref={ref} className={`tq-layer ${className ?? ''}`} style={{ zIndex: z, opacity: ready ? undefined : 0, transition: 'opacity .9s ease' }} />;
}

/** an immortal on a red-crowned crane, wings beating slowly, ribbons streaming behind */
function CraneRider() {
  return (
    <svg viewBox="0 0 220 130" className="tq-crane-svg" aria-hidden>
      <g className="tq-wing tq-wing-far">
        <path d="M118 62 C104 34 80 18 40 10 C66 28 86 46 108 66 Z" fill="#d9d6cf" />
        <path d="M40 10 C54 16 64 22 72 30 L60 27 Z" fill="#2b2a28" />
      </g>
      <path d="M72 72 L18 80 M74 74 L22 86" stroke="#2f2e2b" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M64 66 C84 50 126 52 148 60 C158 64 156 74 142 76 C114 82 84 80 64 66 Z" fill="#f7f4ee" />
      <path d="M66 66 C56 62 48 66 44 72 C54 70 60 72 70 72 Z" fill="#26241f" />
      <path d="M146 62 Q170 52 192 50" stroke="#f7f4ee" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M160 56 Q176 51 190 50" stroke="#2b2a28" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="193" cy="49.5" r="3.6" fill="#f7f4ee" />
      <circle cx="193.5" cy="47.2" r="1.7" fill="#b8322a" />
      <path d="M196 50 L210 52" stroke="#4a4740" strokeWidth="1.6" strokeLinecap="round" />
      <g className="tq-rider">
        <path className="tq-sash" d="M112 38 C92 30 76 42 56 32 C44 26 32 32 18 26" stroke="#b23a2a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path className="tq-sash tq-sash2" d="M114 42 C98 40 84 48 66 42 C54 38 44 44 32 40" stroke="#c9a35a" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        <path d="M104 60 C104 44 110 36 116 33 C122 36 124 46 122 60 Z" fill="#2a2d2b" />
        <path d="M110 58 C111 47 114 41 117 39 C119 44 119 52 118 58 Z" fill="#8a9a92" />
        <circle cx="117" cy="29" r="3.6" fill="#2a2d2b" />
        <circle cx="117.5" cy="24.6" r="1.6" fill="#2a2d2b" />
        <path d="M122 46 L132 42" stroke="#2a2d2b" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <g className="tq-wing tq-wing-near">
        <path d="M122 60 C108 28 82 8 30 2 C64 22 90 44 112 66 Z" fill="#fbf9f4" />
        <path d="M30 2 C48 8 60 16 70 24 L56 21 Z M42 6 C52 12 60 18 66 24" fill="#24221e" stroke="#24221e" strokeWidth="0.5" />
        <path d="M60 24 C78 34 94 46 108 60" stroke="#d6d1c6" strokeWidth="1" fill="none" />
      </g>
    </svg>
  );
}

/** a lone boat with a fisherman under his straw hat, and the faint ripples around it */
function LoneBoat() {
  return (
    <svg viewBox="0 0 120 40" className="tq-boat" aria-hidden>
      <path d="M10 26 Q60 34 108 24 Q100 30 60 31 Q22 31 10 26 Z" fill="#26241f" />
      <path d="M52 25 L56 13 L60 25 Z" fill="#2c2a25" />
      <path d="M48 14 Q56 8 64 14 Z" fill="#3a362e" />
      <path d="M62 18 L96 4" stroke="#2c2a25" strokeWidth="0.8" />
      <path d="M96 4 L97 30" stroke="#2c2a25" strokeWidth="0.4" opacity=".6" />
      <path d="M0 34 Q30 31 56 35 M70 35 Q92 32 118 34 M24 38 Q60 36 96 38" stroke="#4a463c" strokeWidth="0.6" fill="none" opacity=".45" />
    </svg>
  );
}

const paintFar = (c: HTMLCanvasElement) => paintRange(c, RANGES[0]);
const paintMid = (c: HTMLCanvasElement) => paintRange(c, RANGES[1]);
const paintNear = (c: HTMLCanvasElement) => paintRange(c, RANGES[2]);

export function InkBackdrop({ poem = true }: { poem?: boolean }) {
  return (
    <div className="tq-ink" aria-hidden>
      <style>{INK_CSS}</style>
      <div className="tq-paper" />
      <div className="tq-sun" />
      <svg className="tq-birds" viewBox="0 0 60 20">
        <path d="M2 10 Q6 6 10 10 Q14 6 18 10" stroke="#3a3833" strokeWidth="1" fill="none" />
        <path d="M30 4 Q33 1 36 4 Q39 1 42 4" stroke="#3a3833" strokeWidth="0.8" fill="none" />
        <path d="M44 14 Q46.5 11.5 49 14 Q51.5 11.5 54 14" stroke="#3a3833" strokeWidth="0.7" fill="none" />
      </svg>
      <Canvas paint={paintFar} z={2} order={0} />
      <div className="tq-cloud" style={{ zIndex: 3, top: '44%', animationDuration: '130s', animationDelay: '-20s' }} />
      <div className="tq-crane">
        <div className="tq-crane-bob">
          <CraneRider />
        </div>
      </div>
      <Canvas paint={paintMid} z={5} order={1} />
      <div className="tq-cloud tq-cloud-b" style={{ zIndex: 6, top: '58%', animationDuration: '105s', animationDelay: '-70s' }} />
      <div className="tq-cloud" style={{ zIndex: 6, top: '64%', animationDuration: '160s', animationDelay: '-110s', opacity: 0.8 }} />
      <Canvas paint={paintNear} z={7} order={2} />
      <div className="tq-ground-mist" />
      <div className="tq-lake">
        <LoneBoat />
      </div>
      <Canvas paint={paintPine} z={10} className="tq-pine" order={3} />
      {poem && (
        <div className="tq-poem">
          <span>只在此山中</span>
          <span>云深不知处</span>
          <i>天阙</i>
        </div>
      )}
      <div className="tq-vignette" />
    </div>
  );
}

const INK_CSS = `
.tq-ink { position:absolute; inset:0; overflow:hidden; background:#ece5d6; }
.tq-paper { position:absolute; inset:0; z-index:0;
  background: radial-gradient(120% 85% at 50% 18%, #f5f0e4 0%, #ebe3d2 55%, #dcd1bc 100%); }
.tq-paper::after { content:""; position:absolute; inset:0; opacity:.42; mix-blend-mode:multiply;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .55  0 0 0 0 .5  0 0 0 0 .42  0 0 0 .5 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.tq-layer { position:absolute; left:50%; bottom:0; height:100%; min-width:100%; aspect-ratio:16/9; transform:translateX(-50%); object-fit:cover; pointer-events:none; mix-blend-mode:multiply; }
.tq-sun { position:absolute; z-index:1; width:min(12vw,150px); aspect-ratio:1; right:25%; top:12%; border-radius:50%;
  background:radial-gradient(circle, rgba(190,62,42,.62) 0%, rgba(190,62,42,.5) 48%, rgba(190,62,42,.12) 62%, rgba(190,62,42,0) 70%); filter:blur(.6px); }
.tq-cloud { position:absolute; left:0; width:70vw; height:20vh; pointer-events:none;
  background:radial-gradient(50% 50% at 50% 50%, rgba(246,242,233,.96) 0%, rgba(246,242,233,.62) 45%, rgba(246,242,233,0) 72%);
  filter:blur(7px); animation:tqDrift linear infinite; }
.tq-cloud-b { width:55vw; height:15vh; animation-name:tqDrift2; }
@keyframes tqDrift { from { transform:translateX(-75vw); } to { transform:translateX(110vw); } }
@keyframes tqDrift2 { from { transform:translateX(110vw); } to { transform:translateX(-75vw); } }
.tq-ground-mist { position:absolute; left:0; right:0; bottom:0; height:34%; z-index:8;
  background:linear-gradient(to top, rgba(237,230,216,.97) 0%, rgba(237,230,216,.8) 40%, rgba(237,230,216,0) 100%); }
.tq-lake { position:absolute; z-index:9; left:58%; bottom:9%; width:min(9vw,120px); opacity:.85; }
.tq-boat { width:100%; height:auto; display:block; animation:tqBoat 9s ease-in-out infinite; }
@keyframes tqBoat { 0%,100% { transform:translateY(0) rotate(-.6deg); } 50% { transform:translateY(2px) rotate(.6deg); } }
.tq-pine { mix-blend-mode:multiply; opacity:.95; }
.tq-poem { position:absolute; z-index:11; right:5.5vw; top:22%; display:flex; flex-direction:row-reverse; gap:.6em; align-items:flex-start;
  font-family:"Ma Shan Zheng","STXingkai","KaiTi",serif; font-size:clamp(20px,1.9vw,30px); color:rgba(30,27,23,.78); }
.tq-poem span { writing-mode:vertical-rl; letter-spacing:.18em; }
.tq-poem span:nth-child(2) { margin-top:1.6em; }
.tq-poem i { font-style:normal; writing-mode:vertical-rl; align-self:flex-end; margin-top:6.6em; font-size:.42em; color:#f5ecdc; background:#a8362a; padding:4px 2px; border-radius:2px; letter-spacing:.1em; }
.tq-vignette { position:absolute; inset:0; z-index:12; pointer-events:none;
  background:radial-gradient(120% 95% at 50% 45%, rgba(0,0,0,0) 62%, rgba(90,70,40,.16) 100%); }
.tq-birds { position:absolute; z-index:1; width:60px; left:30%; top:20%; opacity:.55; }
.tq-crane { position:absolute; z-index:4; top:15%; left:0; width:min(16vw,200px); animation:tqFly 46s linear infinite; animation-delay:-6s; }
.tq-crane-bob { animation:tqBob 5.5s ease-in-out infinite; }
.tq-crane-svg { width:100%; height:auto; display:block; overflow:visible; }
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
@media (max-width: 900px) { .tq-poem { display:none; } }
@media (prefers-reduced-motion: reduce) { .tq-cloud, .tq-crane, .tq-crane-bob, .tq-wing, .tq-sash, .tq-boat { animation:none; } }
`;
