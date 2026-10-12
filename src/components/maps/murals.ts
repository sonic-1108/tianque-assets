import * as THREE from 'three';

/**
 * Original wall paintings for 青冥寺 in the manner of the Dunhuang cave murals: red ochre and malachite grounds,
 * lapis and white, ink outlines, flying apsaras trailing ribbons, a preaching Buddha among bodhisattvas, a
 * thousand-Buddha frieze, all aged with flaking and soot. Everything is drawn here with canvas paths.
 */

const OCHRE = '#9c4a2c';
const OCHRE_D = '#7a3420';
const MALA = '#3d8a76';
const MALA_D = '#2a6656';
const LAPIS = '#2c5682';
const CREAM = '#efe2c4';
const SKIN = '#e8c9a0';
const INK = '#2a1a12';
const GOLD = '#d9b25a';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** an auspicious cloud: a cluster of curls */
function cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.fillStyle = fill;
  g.strokeStyle = INK;
  g.lineWidth = 1.6 / s;
  for (const [cx, cy, r] of [
    [0, 0, 14],
    [16, -6, 11],
    [30, 2, 12],
    [-14, 4, 9],
  ]) {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    // the inner curl
    g.beginPath();
    g.arc(cx + r * 0.15, cy + r * 0.1, r * 0.5, Math.PI * 0.2, Math.PI * 1.7);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(-24, 12);
  g.bezierCurveTo(-50, 20, -70, 10, -90, 22);
  g.lineWidth = 3 / s;
  g.strokeStyle = fill;
  g.stroke();
  g.restore();
}

/** a falling flower: five petals */
function flower(g: CanvasRenderingContext2D, x: number, y: number, r: number, c: string) {
  g.fillStyle = c;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    g.beginPath();
    g.ellipse(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.7, r * 0.45, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = GOLD;
  g.beginPath();
  g.arc(x, y, r * 0.45, 0, Math.PI * 2);
  g.fill();
}

type P2 = [number, number];
/** points along a chain of cubic beziers: p0, c1, c2, p1, c3, c4, p2, ... */
function chain(pts: P2[], per = 24): P2[] {
  const out: P2[] = [];
  for (let i = 0; i + 3 < pts.length; i += 3) {
    const [a, b, c, d] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    for (let k = i === 0 ? 0 : 1; k <= per; k++) {
      const t = k / per;
      const u = 1 - t;
      out.push([
        u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
        u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
      ]);
    }
  }
  return out;
}
/**
 * a painted band along a curve: tapers from w0 to w1, and (twist > 0) turns over on itself like a silk scarf in
 * the wind, showing its narrow edge every so often. Filled, inked, with a lighter stroke down the middle.
 */
function band(g: CanvasRenderingContext2D, pts: P2[], w0: number, w1: number, fill: string, twist = 0, light?: string) {
  const c = chain(pts);
  const L: P2[] = [];
  const R: P2[] = [];
  for (let i = 0; i < c.length; i++) {
    const p = c[Math.max(0, i - 1)];
    const q = c[Math.min(c.length - 1, i + 1)];
    let nx = -(q[1] - p[1]);
    let ny = q[0] - p[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const t = i / (c.length - 1);
    let w = (w0 + (w1 - w0) * t) / 2;
    if (twist) w *= 0.22 + 0.78 * Math.abs(Math.cos(t * Math.PI * twist));
    L.push([c[i][0] + nx * w, c[i][1] + ny * w]);
    R.push([c[i][0] - nx * w, c[i][1] - ny * w]);
  }
  g.beginPath();
  g.moveTo(L[0][0], L[0][1]);
  for (const p of L) g.lineTo(p[0], p[1]);
  for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1.3;
  g.stroke();
  if (light) {
    g.strokeStyle = light;
    g.lineWidth = Math.max(1, Math.min(w0, w1) * 0.18);
    g.beginPath();
    c.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    g.stroke();
  }
}

/**
 * a flying apsara, drawn like the cave paintings: the body arched in flight, a fluttering scarf looping over
 * the head and streaming far behind, a long skirt sweeping back, a pipa or a dish of flowers in the hands
 */
function apsara(g: CanvasRenderingContext2D, x: number, y: number, s: number, flip: number, robe: string, ribbonA: string, ribbonB: string, seed: number) {
  const R = rng(seed);
  const lute = R() < 0.5;
  g.save();
  g.translate(x, y);
  g.scale(s * flip, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // the scarf: over the head in an arc, then away behind in long fluttering loops
  const j = () => (R() - 0.5) * 30;
  band(g, [[40, -38], [10, -120], [-60, -110], [-90, -60], [-130, -10], [-200, -90 + j()], [-260, -50], [-320, -10], [-380, -70 + j()], [-450, -40]], 14, 3, ribbonA, 4.5, 'rgba(255,245,220,0.55)');
  band(g, [[20, -16], [-40, 30], [-120, -20], [-180, 20], [-240, 60], [-300, 0 + j()], [-360, 30], [-410, 60], [-460, 20 + j()], [-520, 40]], 12, 3, ribbonB, 4, 'rgba(255,245,220,0.5)');
  // the skirt: a long sweep of cloth trailing behind the legs, with a patterned hem
  band(g, [[0, 6], [-50, 14], [-100, 34], [-190, 34]], 40, 10, robe, 0, 'rgba(255,255,255,0.12)');
  g.strokeStyle = 'rgba(42,26,18,0.6)';
  g.lineWidth = 1;
  for (let k = 0; k < 5; k++) {
    g.beginPath();
    g.moveTo(-14 - k * 6, -4 + k * 5);
    g.bezierCurveTo(-60 - k * 10, 6 + k * 5, -110 - k * 8, 30, -170 - k * 4, 30 + k * 2);
    g.stroke();
  }
  band(g, [[-8, 26], [-60, 40], [-120, 52], [-196, 40]], 6, 3, GOLD); // hem border
  // a foot peeking out under the hem
  g.fillStyle = SKIN;
  g.strokeStyle = INK;
  g.lineWidth = 1.2;
  g.beginPath();
  g.ellipse(-196, 34, 9, 4, 0.3, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // the torso, bare above a sash, arched forward
  g.fillStyle = SKIN;
  g.beginPath();
  g.moveTo(-6, 18);
  g.bezierCurveTo(-8, -6, 6, -28, 26, -40);
  g.bezierCurveTo(36, -44, 44, -38, 42, -30);
  g.bezierCurveTo(36, -14, 26, 4, 18, 20);
  g.closePath();
  g.fill();
  g.stroke();
  band(g, [[-6, 10], [6, 4], [14, 10], [22, 14]], 9, 9, '#c9473a'); // waist sash
  // necklace of beads and a pendant
  g.fillStyle = GOLD;
  for (let k = 0; k <= 8; k++) {
    const a = 0.3 + (k / 8) * 2.2;
    g.beginPath();
    g.arc(32 + Math.cos(a) * 11, -34 + Math.sin(a) * 11, 1.8, 0, Math.PI * 2);
    g.fill();
  }
  // the far arm, raised behind the head, scattering a flower
  band(g, [[24, -38], [18, -60], [8, -78], [-4, -92]], 9, 6, SKIN);
  g.fillStyle = GOLD;
  g.fillRect(14, -64, 8, 3); // armlet
  flower(g, -8, -100, 5, '#e4a3a3');
  // the head in three-quarter profile: topknot, crown, earring, lowered eye, a calm small mouth
  g.fillStyle = SKIN;
  g.strokeStyle = INK;
  g.lineWidth = 1.4;
  g.beginPath();
  g.ellipse(46, -52, 11, 13, -0.35, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#1d1712';
  g.beginPath();
  g.ellipse(40, -62, 11, 7, -0.5, Math.PI * 0.9, Math.PI * 2.05);
  g.fill();
  g.beginPath();
  g.ellipse(44, -76, 6, 7, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = GOLD;
  g.beginPath();
  g.moveTo(36, -66);
  g.lineTo(42, -78);
  g.lineTo(50, -68);
  g.closePath();
  g.fill();
  g.fillStyle = '#c9473a';
  g.beginPath();
  g.arc(42, -71, 2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = GOLD;
  g.beginPath();
  g.arc(38, -44, 2.4, 0, Math.PI * 2); // earring
  g.fill();
  g.strokeStyle = INK;
  g.lineWidth = 1.1;
  g.beginPath();
  g.arc(50, -54, 4, 0.1, Math.PI * 0.8); // brow
  g.moveTo(49, -50);
  g.lineTo(54, -50); // lowered eye
  g.moveTo(52, -42);
  g.quadraticCurveTo(54, -41, 56, -42); // mouth
  g.stroke();
  g.fillStyle = '#b3261e';
  g.beginPath();
  g.arc(53, -55, 1.3, 0, Math.PI * 2);
  g.fill();
  // the near arm: forward, holding the instrument or a dish of flowers
  band(g, [[30, -32], [44, -20], [56, -20], [70, -26]], 9, 6, SKIN);
  g.fillStyle = GOLD;
  g.fillRect(44, -24, 3, 9);
  if (lute) {
    // a pipa held across the body
    g.save();
    g.translate(74, -30);
    g.rotate(-0.7);
    g.fillStyle = '#8a5a2b';
    g.strokeStyle = INK;
    g.lineWidth = 1.3;
    g.beginPath();
    g.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#5a3a1c';
    g.fillRect(14, -2.5, 26, 5);
    g.strokeRect(14, -2.5, 26, 5);
    g.strokeStyle = 'rgba(255,240,200,0.7)';
    g.lineWidth = 0.6;
    for (let k = -1; k <= 1; k++) {
      g.beginPath();
      g.moveTo(-10, k * 2);
      g.lineTo(40, k * 1.2);
      g.stroke();
    }
    g.restore();
  } else {
    // a dish heaped with flowers
    g.fillStyle = GOLD;
    g.strokeStyle = INK;
    g.lineWidth = 1.2;
    g.beginPath();
    g.ellipse(80, -30, 14, 4, -0.1, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    flower(g, 74, -36, 4, '#e4a3a3');
    flower(g, 84, -37, 4, CREAM);
    flower(g, 80, -42, 3.5, '#c9473a');
  }
  g.restore();
}

/** a mottled pigment ground: overlapping washes, as if laid on by hand */
function wash(g: CanvasRenderingContext2D, W: number, H: number, colors: string[], seed: number) {
  const R = rng(seed);
  for (let i = 0; i < 70; i++) {
    const x = R() * W;
    const y = R() * H;
    const r = 60 + R() * 220;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const c = colors[(R() * colors.length) | 0];
    gr.addColorStop(0, c);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.12 + R() * 0.12;
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.globalAlpha = 1;
}

/** a seated figure: lotus base, robed body, halo; used large for the Buddha and tiny for the thousand Buddhas */
function seated(g: CanvasRenderingContext2D, x: number, y: number, s: number, robe: string, halo: string, aura?: string) {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  g.strokeStyle = INK;
  g.lineWidth = 1.6 / Math.max(0.6, s);
  if (aura) {
    // a mandorla of concentric bands
    for (const [r, c] of [
      [70, aura],
      [62, CREAM],
      [56, MALA],
    ] as [number, string][]) {
      g.fillStyle = c;
      g.beginPath();
      g.ellipse(0, -46, r * 0.72, r, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }
  // halo
  g.fillStyle = halo;
  g.beginPath();
  g.arc(0, -66, 16, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // lotus seat
  g.fillStyle = '#c96f5a';
  for (let k = -3; k <= 3; k++) {
    g.beginPath();
    g.ellipse(k * 9, 4, 6, 9, k * 0.18, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // crossed legs and robe
  g.fillStyle = robe;
  g.beginPath();
  g.ellipse(0, -6, 30, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(-18, -8);
  g.bezierCurveTo(-22, -34, -14, -46, 0, -48);
  g.bezierCurveTo(14, -46, 22, -34, 18, -8);
  g.closePath();
  g.fill();
  g.stroke();
  // robe fold lines
  g.beginPath();
  g.moveTo(-10, -42);
  g.quadraticCurveTo(0, -24, 12, -12);
  g.stroke();
  // head
  g.fillStyle = SKIN;
  g.beginPath();
  g.ellipse(0, -60, 8, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#1f2a44';
  g.beginPath();
  g.arc(0, -70, 6, Math.PI, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(0, -74, 3.5, 0, Math.PI * 2);
  g.fill();
  if (s > 2) {
    face(g, 0, -59, 8);
    // arms in the robe, curving down to the hands in the lap
    for (const sx of [-1, 1]) band(g, [[sx * 12, -44], [sx * 26, -36], [sx * 24, -18], [sx * 6, -13]], 8, 7, robe, 0, 'rgba(255,220,180,0.25)');
    // hands resting in the lap and the robe's folds
    g.fillStyle = SKIN;
    g.strokeStyle = INK;
    g.lineWidth = 0.6;
    g.beginPath();
    g.ellipse(0, -14, 9, 3.5, 0, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.strokeStyle = 'rgba(42,26,18,0.7)';
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      g.moveTo(-14 + k * 3, -40 + k * 4);
      g.quadraticCurveTo(-4 + k * 4, -26 + k * 2, 12, -18 + k * 3);
      g.stroke();
    }
  }
  g.restore();
}

/** a calm face: arched brows, lowered eyes, a small mouth, the urna between the brows */
function face(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.strokeStyle = INK;
  g.lineWidth = Math.max(0.8, r * 0.09);
  g.beginPath();
  for (const sx of [-1, 1]) {
    g.moveTo(x + sx * r * 0.62, y - r * 0.18);
    g.quadraticCurveTo(x + sx * r * 0.35, y - r * 0.42, x + sx * r * 0.1, y - r * 0.24);
    g.moveTo(x + sx * r * 0.55, y + r * 0.02);
    g.quadraticCurveTo(x + sx * r * 0.35, y + r * 0.12, x + sx * r * 0.14, y + r * 0.02);
  }
  g.moveTo(x, y - r * 0.05);
  g.lineTo(x - r * 0.08, y + r * 0.32);
  g.lineTo(x + r * 0.06, y + r * 0.34);
  g.stroke();
  g.fillStyle = '#b3261e';
  g.beginPath();
  g.ellipse(x, y + r * 0.55, r * 0.17, r * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(x, y - r * 0.32, r * 0.07, 0, Math.PI * 2);
  g.fill();
}

/** a standing bodhisattva in a gentle S-curve: crowned, jewelled, a lotus in one hand, scarves looping to the feet */
function bodhisattva(g: CanvasRenderingContext2D, x: number, y: number, s: number, robe: string, sash: string, flip: number) {
  g.save();
  g.translate(x, y);
  g.scale(s * flip, s);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // halo: bands of colour
  for (const [r, c] of [
    [26, GOLD],
    [21, MALA],
    [16, CREAM],
  ] as [number, string][]) {
    g.fillStyle = c;
    g.strokeStyle = INK;
    g.lineWidth = 1.1;
    g.beginPath();
    g.arc(4, -150, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  // the long scarf looping down both sides
  band(g, [[-12, -118], [-36, -90], [-30, -40], [-22, -10]], 7, 4, sash, 2.5, 'rgba(255,245,220,0.5)');
  band(g, [[18, -118], [40, -84], [36, -40], [30, -6]], 7, 4, sash, 2.5, 'rgba(255,245,220,0.5)');
  // skirt: flaring from the hips, swaying, with folds and a dark hem
  g.fillStyle = robe;
  g.strokeStyle = INK;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-12, -86);
  g.bezierCurveTo(-26, -50, -12, -24, -22, 0);
  g.lineTo(24, 0);
  g.bezierCurveTo(18, -26, 28, -56, 14, -86);
  g.closePath();
  g.fill();
  g.stroke();
  g.lineWidth = 0.9;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.moveTo(-6 + k * 6, -80);
    g.bezierCurveTo(-14 + k * 7, -50, -4 + k * 7, -26, -12 + k * 9, 0);
    g.stroke();
  }
  band(g, [[-22, -2], [-6, 2], [8, 2], [24, -2]], 5, 5, GOLD);
  // feet on a small lotus
  flower(g, 2, 6, 7, '#e4a3a3');
  // torso, hips swung out
  g.fillStyle = SKIN;
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(-12, -86);
  g.bezierCurveTo(-16, -104, -10, -124, 4, -128);
  g.bezierCurveTo(16, -126, 20, -108, 14, -86);
  g.closePath();
  g.fill();
  g.stroke();
  band(g, [[-12, -92], [0, -88], [8, -88], [14, -92]], 8, 8, '#c9473a'); // waist band
  // necklace
  g.fillStyle = GOLD;
  for (let k = 0; k <= 10; k++) {
    const a = 0.25 + (k / 10) * 2.6;
    g.beginPath();
    g.arc(3 + Math.cos(a) * 11, -126 + Math.sin(a) * 9, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  // arms: one down holding a water flask, one raised with a lotus
  band(g, [[-10, -120], [-20, -104], [-22, -92], [-18, -78]], 7, 5, SKIN);
  g.fillStyle = MALA_D;
  g.strokeStyle = INK;
  g.beginPath();
  g.ellipse(-17, -70, 4, 7, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  band(g, [[16, -120], [28, -110], [30, -124], [26, -140]], 7, 5, SKIN);
  g.strokeStyle = '#3b6b3b';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(26, -140);
  g.quadraticCurveTo(30, -156, 26, -168);
  g.stroke();
  flower(g, 26, -172, 5, '#e4a3a3');
  // head, hair piled up, crown
  g.fillStyle = SKIN;
  g.strokeStyle = INK;
  g.lineWidth = 1.3;
  g.beginPath();
  g.ellipse(4, -146, 9, 11, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#1d1712';
  g.beginPath();
  g.ellipse(4, -156, 9.5, 5, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(4, -164, 5, 6, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = GOLD;
  g.beginPath();
  g.moveTo(-7, -157);
  g.lineTo(-3, -166);
  g.lineTo(4, -160);
  g.lineTo(11, -166);
  g.lineTo(15, -157);
  g.closePath();
  g.fill();
  g.stroke();
  face(g, 4, -146, 9);
  g.restore();
}

/** a band of rolling-vine scroll, the classic frame */
function scrollBand(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, horiz: boolean) {
  g.fillStyle = OCHRE_D;
  g.fillRect(x0, y0, w, h);
  g.strokeStyle = CREAM;
  g.lineWidth = 2;
  g.strokeRect(x0 + 3, y0 + 3, w - 6, h - 6);
  const len = horiz ? w : h;
  const thick = horiz ? h : w;
  g.save();
  g.translate(x0, y0);
  if (!horiz) {
    g.translate(w, 0);
    g.rotate(Math.PI / 2);
  }
  const mid = thick / 2;
  g.strokeStyle = MALA;
  g.lineWidth = 3;
  g.beginPath();
  for (let t = 0; t <= len; t += 4) g.lineTo(t, mid + Math.sin(t * 0.06) * thick * 0.22);
  g.stroke();
  for (let t = 26; t < len; t += 52) {
    const yy = mid + Math.sin(t * 0.06) * thick * 0.22;
    g.fillStyle = (t / 52) % 2 < 1 ? LAPIS : MALA_D;
    g.beginPath();
    g.ellipse(t, yy, thick * 0.2, thick * 0.12, 0.6, 0, Math.PI * 2);
    g.fill();
    flower(g, t + 18, mid - Math.sin(t * 0.06) * thick * 0.16, thick * 0.09, CREAM);
  }
  g.restore();
}

/** age the painting: soot at the top, flaking to the plaster, fine cracks, a dusty bloom */
function age(g: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const R = rng(seed);
  const soot = g.createLinearGradient(0, 0, 0, h);
  soot.addColorStop(0, 'rgba(30,18,10,0.45)');
  soot.addColorStop(0.25, 'rgba(30,18,10,0.08)');
  soot.addColorStop(1, 'rgba(30,18,10,0.18)');
  g.fillStyle = soot;
  g.fillRect(0, 0, w, h);
  // flaked patches showing the pale plaster
  for (let i = 0; i < 70; i++) {
    const x = R() * w;
    const y = R() * h;
    const r = 3 + Math.pow(R(), 3) * 26;
    g.fillStyle = `rgba(214,196,160,${0.35 + R() * 0.45})`;
    g.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const rr = r * (0.6 + R() * 0.6);
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.7);
    }
    g.closePath();
    g.fill();
  }
  // cracks
  g.strokeStyle = 'rgba(40,24,14,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 26; i++) {
    let x = R() * w;
    let y = R() * h;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) {
      x += (R() - 0.5) * 40;
      y += (R() - 0.3) * 26;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // grain
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(255,240,210,0.06)' : 'rgba(30,15,5,0.07)';
    g.fillRect(R() * w, R() * h, 2, 2);
  }
}

function texture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the flying-apsaras wall: musicians soaring through clouds and falling flowers over a malachite sky */
export function apsaraMural(): THREE.Texture {
  const W = 1536;
  const H = 640;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 427;
  const g = c.getContext('2d', { willReadFrequently: true })!; // CPU canvas: keeps GPU memory for the scene
  g.scale(1024 / W, 427 / H);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, OCHRE);
  sky.addColorStop(0.55, '#b0623e');
  sky.addColorStop(1, MALA_D);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  wash(g, W, H, ['#c46a3e', '#7a3420', '#4f9a84', '#d9a066'], 5);
  const R = rng(7);
  for (let i = 0; i < 60; i++) flower(g, R() * W, 60 + R() * (H - 120), 4 + R() * 4, R() < 0.5 ? CREAM : '#e4a3a3');
  for (let i = 0; i < 9; i++) cloud(g, 80 + R() * (W - 160), 90 + R() * (H - 200), 0.9 + R() * 0.8, i % 2 ? MALA : CREAM);
  apsara(g, 700, 250, 1.35, 1, LAPIS, MALA, CREAM, 3);
  apsara(g, 1060, 400, 1.2, -1, MALA_D, CREAM, '#c9473a', 6);
  apsara(g, 520, 470, 1.05, 1, '#c9473a', LAPIS, GOLD, 9);
  apsara(g, 1390, 170, 0.85, 1, MALA, '#c9473a', CREAM, 12);
  scrollBand(g, 0, 0, W, 46, true);
  scrollBand(g, 0, H - 46, W, 46, true);
  age(g, W, H, 21);
  return texture(c);
}

/** the preaching wall: the Buddha in a mandorla under a canopy, bodhisattvas either side, a lotus pond below */
export function sermonMural(): THREE.Texture {
  const W = 1536;
  const H = 640;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 427;
  const g = c.getContext('2d', { willReadFrequently: true })!; // CPU canvas: keeps GPU memory for the scene
  g.scale(1024 / W, 427 / H);
  const ground = g.createLinearGradient(0, 0, 0, H);
  ground.addColorStop(0, '#a65a38');
  ground.addColorStop(0.6, '#b9774c');
  ground.addColorStop(1, MALA_D);
  g.fillStyle = ground;
  g.fillRect(0, 0, W, H);
  wash(g, W, H, ['#c46a3e', '#8a3a24', '#d9a066', '#4f9a84'], 9);
  // the pond along the bottom
  g.fillStyle = LAPIS;
  g.fillRect(46, H - 150, W - 92, 104);
  g.strokeStyle = 'rgba(239,226,196,0.5)';
  g.lineWidth = 1.5;
  for (let y = H - 140; y < H - 50; y += 12) {
    g.beginPath();
    for (let x = 50; x < W - 50; x += 6) g.lineTo(x, y + Math.sin(x * 0.05 + y) * 2.5);
    g.stroke();
  }
  const R = rng(12);
  for (let i = 0; i < 14; i++) flower(g, 80 + R() * (W - 160), H - 130 + R() * 70, 8 + R() * 6, R() < 0.5 ? '#e4a3a3' : CREAM);
  // canopy
  g.fillStyle = '#c9473a';
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(W / 2 - 170, 120);
  g.quadraticCurveTo(W / 2, 40, W / 2 + 170, 120);
  g.lineTo(W / 2 + 150, 140);
  g.lineTo(W / 2 - 150, 140);
  g.closePath();
  g.fill();
  g.stroke();
  for (let k = -7; k <= 7; k++) {
    g.fillStyle = k % 2 ? GOLD : CREAM;
    g.beginPath();
    g.moveTo(W / 2 + k * 20, 140);
    g.lineTo(W / 2 + k * 20 + 8, 166);
    g.lineTo(W / 2 + k * 20 - 8, 166);
    g.closePath();
    g.fill();
  }
  seated(g, W / 2, 470, 3.2, '#b23a2c', GOLD, OCHRE);
  for (const sx of [-1, 1]) {
    bodhisattva(g, W / 2 + sx * 300, 500, 1.9, sx < 0 ? LAPIS : MALA, sx < 0 ? '#c9473a' : CREAM, sx);
    bodhisattva(g, W / 2 + sx * 470, 500, 1.6, '#c9473a', LAPIS, sx);
    // a third, smaller attendant in the row behind
    bodhisattva(g, W / 2 + sx * 205, 420, 1.15, sx < 0 ? MALA_D : '#8a3a28', GOLD, sx);
    apsara(g, W / 2 + sx * 520, 130, 0.7, -sx, CREAM, MALA, '#c9473a', 30 + sx);
  }
  for (let i = 0; i < 6; i++) cloud(g, 120 + R() * (W - 240), 70 + R() * 120, 0.7 + R() * 0.5, CREAM);
  scrollBand(g, 0, 0, W, 46, true);
  scrollBand(g, 0, H - 46, W, 46, true);
  age(g, W, H, 33);
  return texture(c);
}

/** a tall strip of the thousand Buddhas: rows of small seated figures in alternating colours */
export function thousandBuddhas(): THREE.Texture {
  const W = 256;
  const H = 768;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!; // CPU canvas: keeps GPU memory for the scene
  g.fillStyle = OCHRE_D;
  g.fillRect(0, 0, W, H);
  const robes = ['#b23a2c', LAPIS, MALA, CREAM];
  const halos = [MALA, GOLD, '#c9473a', LAPIS];
  let n = 0;
  for (let y = 120; y < H - 20; y += 92) {
    for (let x = 42; x < W; x += 58) {
      const k = (n++ + (y / 92) * 2) % 4 | 0;
      seated(g, x, y, 0.95, robes[k], halos[k]);
    }
  }
  scrollBand(g, 0, 0, 22, H, false);
  scrollBand(g, W - 22, 0, 22, H, false);
  age(g, W, H, 44);
  return texture(c);
}
