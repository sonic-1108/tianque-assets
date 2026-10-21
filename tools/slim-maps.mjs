// Halve a model's normal and metal/roughness textures to 1024 (the colour texture keeps its size). Geometry, skin
// and animations are untouched and the meshopt compression is kept. Video memory per hero: ~67 MB -> ~33 MB.
// Usage: node tools/slim-maps.mjs in.glb out.glb [size=1024]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
const [, , src, dst, size = '1024'] = process.argv;
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [Number(size), Number(size)], quality: 90, slots: /^(normalTexture|metallicRoughnessTexture|occlusionTexture)$/ }));
await io.write(dst, doc);
console.log(dst, doc.getRoot().listTextures().map((t) => t.getSize()?.join('x')).join(' '));
