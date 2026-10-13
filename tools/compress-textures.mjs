// Re-encodes a model's textures as WebP at a game-sized resolution (geometry, skin and animations untouched).
// Usage: node tools/compress-textures.mjs in.glb out.glb [size=1024]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
const [, , src, dst, size = '1024'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [Number(size), Number(size)], quality: 85 }));
await io.write(dst, doc);
console.log('done', dst);
