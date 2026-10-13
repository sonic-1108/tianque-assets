// Shrinks a Tripo prop (weapon) for the game: fewer triangles, small textures, and lays it along +Y with the
// pommel at the bottom and the origin at the middle of the grip, so it can be dropped straight into a hand.
// Usage: node tools/optimize-prop.mjs public/dagger.glb public/dagger_game.glb [targetTris=2500] [texSize=512]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [, , src, dst, tris = '2500', tex = '512'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const before = countTris(doc);

await doc.transform(weld(), dedup());
await MeshoptSimplifier.ready;
const ratio = Math.min(1, Number(tris) / before);
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.004 }), prune());
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [Number(tex), Number(tex)], quality: 82 }));

// ---- lay it along +Y: principal axis of the vertices, pommel (the wide end) down, grip at the origin
const pts = [];
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const a = prim.getAttribute('POSITION');
    for (let i = 0; i < a.getCount(); i++) pts.push(a.getElement(i, []));
  }
const mean = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length);
const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
for (const p of pts) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] += (p[r] - mean[r]) * (p[c] - mean[c]);
let v = [1, 1, 1];
for (let it = 0; it < 60; it++) {
  const w = [0, 1, 2].map((r) => C[r * 3] * v[0] + C[r * 3 + 1] * v[1] + C[r * 3 + 2] * v[2]);
  const l = Math.hypot(...w);
  v = w.map((x) => x / l);
}
const proj = pts.map((p) => (p[0] - mean[0]) * v[0] + (p[1] - mean[1]) * v[1] + (p[2] - mean[2]) * v[2]);
const lo = Math.min(...proj);
const hi = Math.max(...proj);
const L = hi - lo;
// spread of the vertices near each end: the tip is a point, the pommel end (ring, tassel) is wide
const spread = (fromLo) => {
  let s = 0;
  let n = 0;
  pts.forEach((p, i) => {
    const t = (proj[i] - lo) / L;
    if (fromLo ? t < 0.06 : t > 0.94) {
      const along = proj[i];
      const q = [0, 1, 2].map((k) => p[k] - mean[k] - v[k] * along);
      s += Math.hypot(...q);
      n++;
    }
  });
  return s / Math.max(1, n);
};
if (spread(true) < spread(false)) v = v.map((x) => -x); // make +v point from pommel to tip
const proj2 = pts.map((p) => (p[0] - mean[0]) * v[0] + (p[1] - mean[1]) * v[1] + (p[2] - mean[2]) * v[2]);
const pommel = Math.min(...proj2);
// rotation taking v onto +Y
const y = [0, 1, 0];
const ax = [v[1] * y[2] - v[2] * y[1], v[2] * y[0] - v[0] * y[2], v[0] * y[1] - v[1] * y[0]];
const s = Math.hypot(...ax);
const cth = v[1];
const k = s > 1e-8 ? ax.map((x) => x / s) : [1, 0, 0];
const ang = Math.atan2(s, cth);
const qr = [k[0] * Math.sin(ang / 2), k[1] * Math.sin(ang / 2), k[2] * Math.sin(ang / 2), Math.cos(ang / 2)];
// grip centre: 14% of the length up from the pommel end
const gripAlong = pommel + L * 0.14;
const grip = mean.map((m, i) => m + v[i] * gripAlong);
const root = doc.getRoot().listScenes()[0];
const holder = doc.createNode('prop').setRotation(qr);
const offset = doc.createNode('offset').setTranslation(grip.map((x) => -x));
for (const n of root.listChildren()) {
  root.removeChild(n);
  offset.addChild(n);
}
holder.addChild(offset);
root.addChild(holder);

await io.write(dst, doc);
console.log(`${src}: ${before} -> ${countTris(doc)} triangles, length ${L.toFixed(3)}`);

function countTris(d) {
  let t = 0;
  for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return t;
}
