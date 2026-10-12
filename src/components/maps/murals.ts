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

/** a flying apsara: body arched like a bow, a lute or a flute, ribbons streaming far behind */
function apsara(g: CanvasRenderingContext2D, x: number, y: number, s: number, flip: number, robe: string, ribbonA: string, ribbonB: string, seed: number) {
  const R = rng(seed);
  g.save();
  g.translate(x, y);
  g.scale(s * flip, s);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // the long ribbons, three loops each, drawn first so the body sits on them
  for (const [col, off, w] of [
    [ribbonA, 0, 9],
    [ribbonB, 14, 7],
  ] as [string, number, number][]) {
    g.strokeStyle = INK;
    g.lineWidth = w + 3;
    const path = () => {
      g.beginPath();
      g.moveTo(-10, -40 + off * 0.3);
      g.bezierCurveTo(-90, -110 + off, -170, 20 + off, -250, -40 + off);
      g.bezierCurveTo(-310, -90 + off, -360, -10 + off, -420 + R() * 30, -60 + off);
    };
    path();
    g.stroke();
    g.strokeStyle = col;
    g.lineWidth = w;
    path();
    g.stroke();
  }
  // the skirt: a sweeping tapered shape trailing behind the legs
  g.fillStyle = robe;
  g.strokeStyle = INK;
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(-6, 10);
  g.bezierCurveTo(-60, 20, -120, 60, -170, 46);
  g.bezierCurveTo(-130, 70, -60, 66, -10, 44);
  g.bezierCurveTo(10, 34, 14, 18, -6, 10);
  g.fill();
  g.stroke();
  // folds on the skirt
  g.lineWidth = 1.2;
  for (let k = 0; k < 4; k++) {
    g.beginPath();
    g.moveTo(-20 - k * 22, 22 + k * 6);
    g.quadraticCurveTo(-50 - k * 26, 40 + k * 5, -90 - k * 20, 44 + k * 2);
    g.stroke();
  }
  // bare torso, leaning forward
  g.fillStyle = SKIN;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-8, 12);
  g.bezierCurveTo(-2, -10, 10, -26, 22, -34);
  g.lineTo(34, -26);
  g.bezierCurveTo(24, -12, 18, 4, 12, 16);
  g.closePath();
  g.fill();
  g.stroke();
  // a jewelled necklace and a sash across the chest
  g.strokeStyle = GOLD;
  g.lineWidth = 2.4;
  g.beginPath();
  g.arc(26, -26, 9, 0.2, Math.PI * 0.9);
  g.stroke();
  // head with a high topknot and a crown band
  g.fillStyle = SKIN;
  g.strokeStyle = INK;
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(36, -46, 10, 12, -0.3, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = '#1d1712';
  g.beginPath();
  g.ellipse(40, -60, 7, 8, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = GOLD;
  g.fillRect(28, -56, 16, 3);
  // calm features: brow, closed eye, a red mark
  g.strokeStyle = INK;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(39, -48);
  g.lineTo(45, -47);
  g.stroke();
  g.fillStyle = '#b3261e';
  g.beginPath();
  g.arc(43, -40, 1.6, 0, Math.PI * 2);
  g.fill();
  // arms: one forward holding the instrument, one raised trailing a scarf
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(28, -30);
  g.quadraticCurveTo(48, -20, 62, -30);
  g.stroke();
  g.strokeStyle = SKIN;
  g.lineWidth = 4;
  g.stroke();
  g.strokeStyle = INK;
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(22, -32);
  g.quadraticCurveTo(10, -62, 26, -80);
  g.stroke();
  g.strokeStyle = SKIN;
  g.lineWidth = 4;
  g.stroke();
  // the instrument: a pipa or a flute
  if (R() < 0.5) {
    g.fillStyle = '#8a5a2b';
    g.strokeStyle = INK;
    g.lineWidth = 1.6;
    g.beginPath();
    g.ellipse(64, -24, 12, 7, -0.6, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(70, -32);
    g.lineTo(86, -50);
    g.lineWidth = 3;
    g.stroke();
  } else {
    g.strokeStyle = '#6b4a22';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(50, -42);
    g.lineTo(84, -28);
    g.stroke();
  }
  // a halo behind the head
  g.strokeStyle = GOLD;
  g.lineWidth = 2;
  g.globalAlpha = 0.8;
  g.beginPath();
  g.arc(36, -48, 18, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 1;
  g.restore();
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
  g.restore();
}

/** a standing bodhisattva: tall, swaying, crowned, holding a lotus */
function bodhisattva(g: CanvasRenderingContext2D, x: number, y: number, s: number, robe: string, sash: string, flip: number) {
  g.save();
  g.translate(x, y);
  g.scale(s * flip, s);
  g.strokeStyle = INK;
  g.lineWidth = 1.8;
  g.fillStyle = GOLD;
  g.globalAlpha = 0.85;
  g.beginPath();
  g.arc(2, -150, 22, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.stroke();
  // long skirt with a slight S-sway
  g.fillStyle = robe;
  g.beginPath();
  g.moveTo(-14, -90);
  g.bezierCurveTo(-24, -40, -8, -10, -18, 0);
  g.lineTo(18, 0);
  g.bezierCurveTo(14, -30, 22, -60, 12, -90);
  g.closePath();
  g.fill();
  g.stroke();
  // torso
  g.fillStyle = SKIN;
  g.beginPath();
  g.moveTo(-12, -90);
  g.bezierCurveTo(-14, -112, -8, -126, 4, -128);
  g.bezierCurveTo(14, -126, 16, -110, 12, -90);
  g.closePath();
  g.fill();
  g.stroke();
  // sash looping round the arms and down past the knees
  g.strokeStyle = sash;
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(-14, -118);
  g.bezierCurveTo(-34, -90, -30, -50, -20, -30);
  g.moveTo(14, -118);
  g.bezierCurveTo(34, -86, 30, -44, 24, -24);
  g.stroke();
  // head, crown and a lotus held up
  g.strokeStyle = INK;
  g.lineWidth = 1.6;
  g.fillStyle = SKIN;
  g.beginPath();
  g.ellipse(2, -142, 9, 11, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // hair piled high and a jewelled crown band
  g.fillStyle = '#1d1712';
  g.beginPath();
  g.ellipse(2, -156, 8, 7, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillStyle = GOLD;
  g.fillRect(-8, -154, 20, 4);
  g.fillStyle = '#b3261e';
  g.beginPath();
  g.arc(2, -152, 2.2, 0, Math.PI * 2);
  g.fill();
  // face: brows and lowered eyes
  g.strokeStyle = INK;
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(-3, -144);
  g.lineTo(0, -144.5);
  g.moveTo(4, -144.5);
  g.lineTo(7, -144);
  g.stroke();
  g.strokeStyle = '#3b6b3b';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(18, -100);
  g.quadraticCurveTo(28, -130, 24, -150);
  g.stroke();
  flower(g, 24, -154, 5, '#e4a3a3');
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
  const R = rng(7);
  for (let i = 0; i < 60; i++) flower(g, R() * W, 60 + R() * (H - 120), 4 + R() * 4, R() < 0.5 ? CREAM : '#e4a3a3');
  for (let i = 0; i < 9; i++) cloud(g, 80 + R() * (W - 160), 90 + R() * (H - 200), 0.9 + R() * 0.8, i % 2 ? MALA : CREAM);
  apsara(g, 560, 260, 1.9, 1, LAPIS, MALA, CREAM, 3);
  apsara(g, 1120, 230, 1.7, -1, MALA_D, CREAM, '#c9473a', 5);
  apsara(g, 900, 500, 1.45, 1, '#c9473a', LAPIS, GOLD, 9);
  apsara(g, 300, 520, 1.2, -1, MALA, '#c9473a', CREAM, 11);
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
    // disciples' heads in a row behind
    for (let k = 0; k < 3; k++) {
      const dx = W / 2 + sx * (200 + k * 36);
      const dy = 300 - k * 10;
      g.strokeStyle = INK;
      g.lineWidth = 1.4;
      g.fillStyle = 'rgba(217,178,90,0.75)';
      g.beginPath();
      g.arc(dx, dy - 20, 17, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = k % 2 ? '#8a3a28' : MALA_D;
      g.beginPath();
      g.moveTo(dx - 18, dy + 24);
      g.quadraticCurveTo(dx, dy - 6, dx + 18, dy + 24);
      g.closePath();
      g.fill();
      g.stroke();
      g.fillStyle = SKIN;
      g.beginPath();
      g.ellipse(dx, dy - 18, 9, 11, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
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
