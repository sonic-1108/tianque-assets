import * as THREE from 'three';

/** parses public/buddha.bin (written by tools/gen-buddha.mjs) into a geometry with baked AO colours */
export function parseBuddha(buf: ArrayBuffer): THREE.BufferGeometry {
  const dv = new DataView(buf);
  const nv = dv.getUint32(0, true);
  const ni = dv.getUint32(4, true);
  const pad4 = (n: number) => (n + 3) & ~3;
  let off = 8;
  const pos = new Float32Array(buf.slice(off, off + nv * 12));
  off += nv * 12;
  const nrm = new Int8Array(buf.slice(off, off + nv * 3));
  off += pad4(nv * 3);
  const col = new Uint8Array(buf.slice(off, off + nv * 3));
  off += pad4(nv * 3);
  const idx = new Uint16Array(buf.slice(off, off + ni * 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

let cached: Promise<THREE.BufferGeometry> | null = null;
export function loadBuddha(base = import.meta.env.BASE_URL): Promise<THREE.BufferGeometry> {
  if (!cached)
    cached = fetch(base + 'buddha.bin')
      .then((r) => {
        if (!r.ok) throw new Error('buddha.bin ' + r.status);
        return r.arrayBuffer();
      })
      .then(parseBuddha);
  return cached;
}

/** gilt bronze; colour comes from the baked vertex colours (gold, lapis hair, AO) */
export function makeBuddhaMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0.72,
    roughness: 0.34,
    emissive: '#2a1a04',
    emissiveIntensity: 0.35,
  });
}
