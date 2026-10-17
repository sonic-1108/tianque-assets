import * as THREE from 'three';

/** The uploaded trader is one skinned mesh. Split its orange torso garment by UV colour so the
 * very same textured vest can leave his body; the white shirt underneath has no quilt normal map. */
export interface TraderVest {
  body: THREE.SkinnedMesh;
  dressed: THREE.BufferGeometry;
  undressed: THREE.BufferGeometry;
  shirt: THREE.SkinnedMesh;
  canopy: THREE.Mesh;
  grips: THREE.Mesh[];
}

export function splitTraderVest(body: THREE.SkinnedMesh): TraderVest | null {
  const material = body.material as THREE.MeshStandardMaterial;
  const texture = material.map;
  const image = texture?.image as CanvasImageSource & { width: number; height: number };
  const source = body.geometry;
  const uv = source.getAttribute('uv');
  const pos = source.getAttribute('position');
  if (!image?.width || !uv || !source.index) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  source.computeBoundingBox();
  const box = source.boundingBox!;
  const height = box.max.y - box.min.y;
  const torsoHalfWidth = (box.max.x - box.min.x) * 0.3;
  const centreX = (box.max.x + box.min.x) / 2;
  const orange = (u: number, v: number) => {
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(u * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((texture!.flipY ? 1 - v : v) * canvas.height)));
    const p = (y * canvas.width + x) * 4;
    const [r, g, b] = [pixels[p], pixels[p + 1], pixels[p + 2]];
    return r > 45 && g > r * 0.24 && g < r * 0.74 && b < g * 0.72;
  };
  const faces: { ids: number[]; torso: boolean; garment: boolean }[] = [];
  for (let n = 0; n < source.index.count; n += 3) {
    const ids = [source.index.getX(n), source.index.getX(n + 1), source.index.getX(n + 2)];
    const y = ids.reduce((s, i) => s + pos.getY(i), 0) / 3;
    const x = ids.reduce((s, i) => s + pos.getX(i), 0) / 3;
    const torso = Math.abs(x - centreX) < torsoHalfWidth && y > box.min.y + height * 0.43 && y < box.min.y + height * 0.9;
    const u = ids.reduce((s, i) => s + uv.getX(i), 0) / 3;
    const v = ids.reduce((s, i) => s + uv.getY(i), 0) / 3;
    const garment = torso && (orange(u, v) || ids.filter((i) => orange(uv.getX(i), uv.getY(i))).length >= 2);
    faces.push({ ids, torso, garment });
  }
  // Fill tiny dark stitch / logo gaps without bridging the real collar and armholes.
  const touching = new Map<string, number[]>();
  const key = (i: number) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 100000)).join(',');
  faces.forEach((f, n) => f.ids.forEach((i) => {
    const k = key(i);
    const list = touching.get(k) ?? [];
    list.push(n);
    touching.set(k, list);
  }));
  for (let pass = 0; pass < 2; pass++) {
    const fill = faces.map((f) => !f.garment && f.torso && f.ids.filter((i) => touching.get(key(i))!.some((n) => faces[n].garment)).length === 3);
    faces.forEach((f, n) => { if (fill[n]) f.garment = true; });
  }
  const vest = faces.filter((f) => f.garment).flatMap((f) => f.ids);
  const rest = faces.filter((f) => !f.garment).flatMap((f) => f.ids);
  if (vest.length < 90) return null;
  const undressed = source.clone();
  undressed.setIndex(rest);
  const shirtGeo = source.clone();
  shirtGeo.setIndex(vest);
  const shirt = new THREE.SkinnedMesh(shirtGeo, new THREE.MeshStandardMaterial({ color: '#e1e6eb', roughness: 0.95, side: THREE.DoubleSide }));
  shirt.name = 'Trader undershirt';
  shirt.position.copy(body.position);
  shirt.quaternion.copy(body.quaternion);
  shirt.scale.copy(body.scale);
  shirt.bindMode = body.bindMode;
  shirt.bind(body.skeleton, body.bindMatrix);
  shirt.frustumCulled = false;
  shirt.castShadow = shirt.receiveShadow = true;
  shirt.visible = false;
  body.parent!.add(shirt);

  // Keep the vest's own armholes, collar, quilt stitching, pockets and chest label.
  const garment = new THREE.BufferGeometry();
  const positions: number[] = [];
  const texcoords: number[] = [];
  for (const i of vest) {
    positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    texcoords.push(uv.getX(i), uv.getY(i));
  }
  garment.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  garment.setAttribute('uv', new THREE.Float32BufferAttribute(texcoords, 2));
  garment.computeBoundingBox();
  const bounds = garment.boundingBox!;
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const vertices = garment.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const x = (vertices.getX(i) - centre.x) / Math.max(size.x, 0.01);
    const y = (vertices.getY(i) - centre.y) / Math.max(size.y, 0.01);
    const z = (vertices.getZ(i) - centre.z) / Math.max(size.z, 0.01);
    // Lay the garment out horizontally, then let the wind bow its centre upwards.
    vertices.setXYZ(i, x * 2.0, z * 0.18 + (1 - x * x * 4) * 0.2, -y * 1.5);
  }
  garment.computeVertexNormals();
  garment.computeBoundingSphere();
  const cloth = material.clone();
  cloth.side = THREE.DoubleSide;
  cloth.normalMap = null;
  const canopy = new THREE.Mesh(garment, cloth);
  canopy.name = 'Patagonia vest glider';
  canopy.castShadow = true;
  canopy.visible = false;
  const grips = [-1, 1].map(() => {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), new THREE.MeshStandardMaterial({ color: '#24344a', roughness: 0.9 }));
    grip.name = 'Vest hand strap';
    grip.visible = false;
    return grip;
  });
  return { body, dressed: source, undressed, shirt, canopy, grips };
}

export function disposeTraderVest(vest: TraderVest) {
  vest.body.geometry = vest.dressed;
  vest.shirt.removeFromParent();
  vest.canopy.removeFromParent();
  vest.undressed.dispose();
  vest.shirt.geometry.dispose();
  (vest.shirt.material as THREE.Material).dispose();
  vest.canopy.geometry.dispose();
  (vest.canopy.material as THREE.Material).dispose();
  for (const grip of vest.grips) {
    grip.removeFromParent();
    grip.geometry.dispose();
    (grip.material as THREE.Material).dispose();
  }
}
