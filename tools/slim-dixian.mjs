// 地仙's Tripo export: keep only 小碎步 (as walk; 飘行 and 全真不动 lie him flat in the air, so idle and run are 霍岩's), then slim like the others
// (tools/slim-model.mjs) but keep the 2K texture: his embroidery is the whole look.
// node tools/slim-dixian.mjs <src.glb> <dst.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress, resample, prune, meshopt, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
const [, , src, dst] = process.argv;
const NAMES = { 小碎步: 'walk' };
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
for (const a of doc.getRoot().listAnimations()) {
  const n = a.getName();
  const key = Object.keys(NAMES).find((k) => n.startsWith(k));
  if (key) a.setName(NAMES[key]);
  else a.dispose();
}
await doc.transform(dedup(), resample(), prune(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 86 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(dst, doc);
console.log('anims', doc.getRoot().listAnimations().map((a) => `${a.getName()} ${a.listChannels()[0]?.getSampler()?.getInput()?.getMax([])}`).join(', '));
