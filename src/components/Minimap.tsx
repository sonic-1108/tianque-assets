import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MAPS, MapId, terrainHeight, mapRuntime, FOREST, FOREST_X, TEMPLE_YAW, zipLine, riverZ as riverZAt } from '../maps';
import type { CombatantState } from '../types';

// 小地图: the whole of a big map in the corner, turning with the camera (up is the way you're looking).
// The ground is drawn once from the height field (water, slopes, cliffs); landmarks and live things go on top.
// Foes show only while you could see them (mapRuntime.seen), so the dark and the bog's mist still hide them.

const SIZE = 196;
const BIG = 420;

/** the ground, rendered once per map: height shading, water, landmarks */
function bakeBase(id: MapId, R: number, px: number) {
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const g = c.getContext('2d')!;
  const img = g.createImageData(px, px);
  const k = (2 * R) / px;
  const H = (x: number, z: number) => terrainHeight(id, x, z);
  for (let j = 0; j < px; j++)
    for (let i = 0; i < px; i++) {
      const x = -R + (i + 0.5) * k;
      const z = -R + (j + 0.5) * k;
      const o = (j * px + i) * 4;
      if (Math.hypot(x, z) > R) {
        img.data[o + 3] = 0;
        continue;
      }
      const h = H(x, z);
      // light from the north-west: slopes facing it lighter
      const sh = Math.max(-1, Math.min(1, (H(x - k, z - k) - H(x + k, z + k)) * 0.9));
      let r: number, gg: number, b: number;
      if (id === 'forest' && h < FOREST.waterY - 0.05) {
        const deep = Math.min(1, (FOREST.waterY - h) / 2.5);
        r = 40 - deep * 20;
        gg = 92 - deep * 30;
        b = 110 - deep * 20;
      } else if (id === 'desert') {
        r = 186 + h * 3;
        gg = 156 + h * 3;
        b = 108 + h * 2;
      } else {
        // forest floor: dark green, higher ground paler, rock grey
        const rock = Math.min(1, Math.max(0, (h - 3) / 6));
        r = 58 + h * 4 + rock * 40;
        gg = 82 + h * 3 + rock * 18;
        b = 50 + h * 2 + rock * 40;
      }
      r += sh * 40;
      gg += sh * 40;
      b += sh * 34;
      img.data[o] = Math.max(0, Math.min(255, r));
      img.data[o + 1] = Math.max(0, Math.min(255, gg));
      img.data[o + 2] = Math.max(0, Math.min(255, b));
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const P = (x: number, z: number): [number, number] => [((x + R) / (2 * R)) * px, ((z + R) / (2 * R)) * px];
  const s = px / (2 * R);
  const dot = (x: number, z: number, r: number, fill: string) => {
    const [a, b] = P(x, z);
    g.fillStyle = fill;
    g.beginPath();
    g.arc(a, b, Math.max(0.8, r * s), 0, Math.PI * 2);
    g.fill();
  };
  if (id === 'forest') {
    const X = FOREST_X;
    // the bog: murky
    {
      const [a, b] = P(X.swamp.x, X.swamp.z);
      g.fillStyle = 'rgba(70,82,30,0.75)';
      g.beginPath();
      g.arc(a, b, X.swamp.r * s, 0, Math.PI * 2);
      g.fill();
    }
    // bamboo: light green speckle
    for (const [x, z] of X.bamboo.clumps) dot(x, z, 1.3, 'rgba(150,190,80,0.9)');
    // giants: dark crowns
    for (const [x, z, r] of FOREST.trees) dot(x, z, r + 1.6, 'rgba(18,40,18,0.85)');
    // the temple on its hill
    {
      const [a, b] = P(FOREST.hill.x, FOREST.hill.z);
      g.save();
      g.translate(a, b);
      g.rotate(-TEMPLE_YAW);
      g.fillStyle = '#9f2b20';
      g.fillRect((-FOREST.temple.w / 2) * s, (-FOREST.temple.d / 2) * s, FOREST.temple.w * s, FOREST.temple.d * s);
      g.restore();
    }
    // the pagoda
    dot(X.pagoda.x, X.pagoda.z, X.pagoda.s1, '#8c8478');
    // the camp's tents
    for (const [x, z] of X.camp.tents) dot(x, z, 1.8, '#c9b27e');
    // the lantern path
    g.strokeStyle = 'rgba(214,200,160,0.7)';
    g.lineWidth = Math.max(1, 1.2 * s);
    g.beginPath();
    X.lanternPath.forEach(([x, z], n) => {
      const [a, b] = P(x, z);
      if (n) g.lineTo(a, b);
      else g.moveTo(a, b);
    });
    g.stroke();
    // the waterfall: a white bar at the lip
    {
      const [a, b0] = P(X.fall.x, X.fall.z0);
      const [, b1] = P(X.fall.x, X.fall.z1);
      g.fillStyle = '#e6f6ff';
      g.fillRect(a - 1.5, b0, 3, b1 - b0);
    }
    // the bridge: a plank-coloured bar across the river
    {
      const B = FOREST.bridge;
      const zc = FOREST.bankHalf + 1.5;
      const [a0, b0] = P(B.x, riverZAt(B.x) - zc);
      const [, b1] = P(B.x, riverZAt(B.x) + zc);
      g.fillStyle = '#a07a4a';
      g.fillRect(a0 - Math.max(1.5, B.half * s), b0, Math.max(3, 2 * B.half * s), b1 - b0);
    }
    // zip lines: thin tan lines
    g.strokeStyle = 'rgba(232,206,150,0.85)';
    g.lineWidth = 1;
    FOREST_X.zips.forEach((_, n) => {
      const Z = zipLine(n);
      const [a0, b0] = P(Z.ax, Z.az);
      const [a1, b1] = P(Z.bx, Z.bz);
      g.setLineDash([3, 2]);
      g.beginPath();
      g.moveTo(a0, b0);
      g.lineTo(a1, b1);
      g.stroke();
    });
    g.setLineDash([]);
    // lookouts: ringed
    for (const [x, z, r, deck] of FOREST.trees)
      if (deck > 0) {
        const [a, b] = P(x, z);
        g.strokeStyle = '#e8cf96';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(a, b, (r + 1.6) * s + 1, 0, Math.PI * 2);
        g.stroke();
      }
  } else {
    for (const pl of MAPS[id].pillars ?? []) dot(pl.x, pl.z, pl.r, 'rgba(40,30,20,0.8)');
  }
  // the rim
  g.strokeStyle = 'rgba(255,240,210,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(px / 2, px / 2, px / 2 - 1, 0, Math.PI * 2);
  g.stroke();
  return c;
}

const LABELS: Record<string, [string, () => [number, number]][]> = {
  forest: [
    ['古寺', () => [FOREST.hill.x, FOREST.hill.z - 14]],
    ['瀑布', () => [FOREST_X.fall.x - 12, FOREST_X.fall.z0 - 6]],
    ['营地', () => [FOREST_X.camp.x, FOREST_X.camp.z + 18]],
    ['竹林', () => [FOREST_X.bamboo.x, FOREST_X.bamboo.z]],
    ['古塔', () => [FOREST_X.pagoda.x, FOREST_X.pagoda.z + 15]],
    ['沼泽', () => [FOREST_X.swamp.x, FOREST_X.swamp.z]],
  ],
};

/** the minimap: click it (or press N) to make it bigger */
export function Minimap({ mapId, fighters, me, hidden }: { mapId: MapId; fighters: React.MutableRefObject<CombatantState[]>; me: number; hidden?: boolean }) {
  const R = MAPS[mapId].radius;
  const base = useMemo(() => bakeBase(mapId, R, 512), [mapId, R]);
  const [big, setBig] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);
  const size = big ? BIG : SIZE;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyN' && !(e.target instanceof HTMLInputElement)) setBig((b) => !b);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = ref.current;
      if (!cv) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== size * dpr) {
        cv.width = cv.height = size * dpr;
      }
      const g = cv.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      const s = size / (2 * R);
      const yaw = mapRuntime.camYaw;
      g.save();
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = 'rgba(10,14,10,0.55)';
      g.fillRect(0, 0, size, size);
      // turn the map so that the camera looks up the screen
      g.translate(size / 2, size / 2);
      g.rotate(yaw);
      g.globalAlpha = 0.92;
      g.drawImage(base, -size / 2, -size / 2, size, size);
      g.globalAlpha = 1;
      const at = (x: number, z: number): [number, number] => [x * s, z * s];
      // night: the lit lights
      const night = mapRuntime.night;
      if (mapId === 'forest') {
        if (night > 0.3) {
          for (const [x, z] of FOREST_X.lanterns) {
            const [a, b] = at(x, z);
            g.fillStyle = `rgba(255,200,110,${0.9 * night})`;
            g.beginPath();
            g.arc(a, b, 1.6, 0, Math.PI * 2);
            g.fill();
          }
          const [fa, fb] = at(FOREST_X.camp.fire[0], FOREST_X.camp.fire[1]);
          g.fillStyle = `rgba(255,140,50,${night})`;
          g.beginPath();
          g.arc(fa, fb, 3, 0, Math.PI * 2);
          g.fill();
        }
        // candles that are lit and set down / hung
        for (const it of mapRuntime.items)
          if (it.kind === 'candle' && it.lit) {
            const [a, b] = at(it.x, it.z);
            g.fillStyle = '#ffd27a';
            g.beginPath();
            g.arc(a, b, 2.4, 0, Math.PI * 2);
            g.fill();
          }
        // herbs
        for (const h of mapRuntime.wood.herbs) {
          if (h.t > 0) continue;
          const [a, b] = at(h.x, h.z);
          g.fillStyle = h.kind === 0 ? '#f87171' : '#38bdf8';
          g.strokeStyle = 'rgba(0,0,0,0.6)';
          g.lineWidth = 1;
          g.beginPath();
          g.arc(a, b, big ? 3.2 : 2.4, 0, Math.PI * 2);
          g.fill();
          g.stroke();
        }
        // your own side's traps
        for (const t of mapRuntime.wood.traps) {
          if (t.sprung >= 0 || t.owner !== mapRuntime.viewSide) continue;
          const [a, b] = at(t.x, t.z);
          g.strokeStyle = '#d4d4d8';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(a - 2.5, b - 2.5);
          g.lineTo(a + 2.5, b + 2.5);
          g.moveTo(a + 2.5, b - 2.5);
          g.lineTo(a - 2.5, b + 2.5);
          g.stroke();
        }
        // the lightning's warning glow
        if (mapRuntime.strikeWarn > 0) {
          const [a, b] = at(mapRuntime.boltX, mapRuntime.boltZ);
          g.strokeStyle = '#c7d2fe';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(a, b, 5, 0, Math.PI * 2);
          g.stroke();
        }
      }
      // fighters
      const F = fighters.current;
      const mine = F[me];
      F.forEach((c, k) => {
        if (k === me || c.hp <= 0) return;
        if (!mapRuntime.seen[k]) return;
        const [a, b] = at(c.pos[0], c.pos[2]);
        const ally = F.length > 2 && (c.side ?? 0) === (mine?.side ?? 0);
        g.fillStyle = ally ? '#34d399' : '#ef4444';
        g.strokeStyle = 'rgba(0,0,0,0.75)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.arc(a, b, big ? 4.5 : 3.6, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      });
      // you: an arrow the way you face, and a faint wedge for what the camera sees
      if (mine) {
        const [a, b] = at(mine.pos[0], mine.pos[2]);
        g.save();
        g.translate(a, b);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, 34, -Math.PI / 2 - yaw - 0.55, -Math.PI / 2 - yaw + 0.55);
        g.closePath();
        g.fill();
        g.rotate(-mine.rotY);
        g.fillStyle = '#fde68a';
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.lineWidth = 1.2;
        const k = big ? 1.4 : 1;
        g.beginPath();
        g.moveTo(0, -7 * k);
        g.lineTo(4.5 * k, 5 * k);
        g.lineTo(0, 2.5 * k);
        g.lineTo(-4.5 * k, 5 * k);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
      // place names stay upright
      g.font = `600 ${big ? 13 : 10}px "Noto Serif SC", serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [name, pos] of LABELS[mapId] ?? []) {
        const [x, z] = pos();
        const [a, b] = at(x, z);
        g.save();
        g.translate(a, b);
        g.rotate(-yaw);
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.7)';
        g.strokeText(name, 0, 0);
        g.fillStyle = '#f5ecd6';
        g.fillText(name, 0, 0);
        g.restore();
      }
      g.restore();
      // N marker on the rim (where north, -z, is now)
      const na = -Math.PI / 2 + yaw;
      const nx = size / 2 + Math.cos(na) * (size / 2 - 9);
      const ny = size / 2 + Math.sin(na) * (size / 2 - 9);
      g.font = '700 10px sans-serif';
      g.fillStyle = '#fca5a5';
      g.fillText('北', nx, ny);
      // the night darkens the map a little (it's a memory, not a light)
      if (night > 0.3) {
        g.fillStyle = `rgba(5,8,20,${0.25 * night})`;
        g.beginPath();
        g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        g.fill();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [base, size, R, mapId, me, fighters, big]);
  if (hidden) return null;
  return (
    <div
      onClick={() => setBig((b) => !b)}
      title="小地图 · 点一下或按 N 放大"
      style={{ position: 'absolute', right: 14, bottom: 14, width: size, height: size, borderRadius: '50%', boxShadow: '0 4px 18px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(255,236,200,0.35)', cursor: 'pointer', zIndex: 30, pointerEvents: 'auto' }}
    >
      <canvas ref={ref} style={{ width: size, height: size, display: 'block', borderRadius: '50%' }} />
      <div style={{ position: 'absolute', left: '50%', bottom: -16, transform: 'translateX(-50%)', fontSize: 10, color: 'rgba(255,240,210,0.7)', whiteSpace: 'nowrap', textShadow: '0 1px 2px #000' }}>N 放大</div>
    </div>
  );
}
