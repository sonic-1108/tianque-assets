import * as THREE from 'three';

/** Separate the torso garment while retaining the original skeleton and shirt sleeves. */
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
  // Remove enclosed badge/zipper islands too, rather than leaving holes in the shirt.
  const visited = new Set<number>();
  for (let seed = 0; seed < faces.length; seed++) {
    if (faces[seed].garment || visited.has(seed)) continue;
    const component = [seed]; visited.add(seed);
    for (let at = 0; at < component.length; at++) {
      for (const id of faces[component[at]].ids) {
        for (const n of touching.get(key(id))!) {
          if (!faces[n].garment && !visited.has(n)) { visited.add(n); component.push(n); }
        }
      }
    }
    if (component.length < 700 && component.every((n) => faces[n].torso)) {
      component.forEach((n) => { faces[n].garment = true; });
    }
  }
  const vest = faces.filter((f) => f.garment).flatMap((f) => f.ids);
  const rest = faces.filter((f) => !f.garment).flatMap((f) => f.ids);
  if (vest.length < 90) return null;
  const undressed = source.clone();
  undressed.setIndex(rest);
  const shirtGeo = source.clone();
  shirtGeo.setIndex(vest);
  // Weld UV seams before smoothing: the padded vest must not remain as a white vest.
  const groups = new Map<string, number[]>();
  const neighbours = new Map<string, Set<string>>();
  for (const f of faces.filter((f) => f.garment)) {
    for (const i of f.ids) {
      const k = key(i);
      if (!groups.has(k)) groups.set(k, []);
      if (!groups.get(k)!.includes(i)) groups.get(k)!.push(i);
      if (!neighbours.has(k)) neighbours.set(k, new Set());
      for (const j of f.ids) if (key(j) !== k) neighbours.get(k)!.add(key(j));
    }
  }
  const points = new Map([...groups].map(([k, ids]) => [k, new THREE.Vector3(pos.getX(ids[0]), pos.getY(ids[0]), pos.getZ(ids[0]))]));
  for (let pass = 0; pass < 36; pass++) {
    const next = new Map<string, THREE.Vector3>();
    for (const [k, point] of points) {
      const near = [...neighbours.get(k)!];
      const average = near.reduce((sum, n) => sum.add(points.get(n)!), new THREE.Vector3()).divideScalar(near.length);
      next.set(k, point.clone().lerp(average, 0.45));
    }
    for (const [k, point] of next) points.set(k, point);
  }
  // Quantized source attributes cannot store the smoothed floating point surface.
  const shirtPositions = new THREE.Float32BufferAttribute(Array.from({ length: pos.count * 3 }, (_, n) => n % 3 === 0 ? pos.getX(n / 3) : n % 3 === 1 ? pos.getY(Math.floor(n / 3)) : pos.getZ(Math.floor(n / 3))), 3);
  for (const [k, ids] of groups) {
    const point = points.get(k)!;
    for (const i of ids) shirtPositions.setXYZ(i, point.x, point.y, point.z);
  }
  shirtGeo.setAttribute('position', shirtPositions);
  // The GLB normals use normalized Int16. Accumulating tiny triangle areas in
  // that buffer rounds them to zero before normalization, producing invalid
  // lighting that contaminates the bloom pass. Rebuild in floating point.
  shirtGeo.deleteAttribute('normal');
  shirtGeo.computeVertexNormals();
  const shirtNormals = shirtGeo.getAttribute('normal');
  const originalNormals = source.getAttribute('normal');
  const normal = new THREE.Vector3();
  for (const ids of groups.values()) {
    for (const i of ids) {
      normal.fromBufferAttribute(shirtNormals, i);
      if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq() < 1e-10) {
        normal.fromBufferAttribute(originalNormals, i);
        if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq() < 1e-10) normal.set(0, 0, 1);
        normal.normalize();
        shirtNormals.setXYZ(i, normal.x, normal.y, normal.z);
      }
    }
  }
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

  // A tailored, single cloth surface avoids projecting the front and back of a
  // closed 3D torso onto each other. The neck opening and armholes read as a vest.
  const outline = new THREE.Shape();
  outline.moveTo(-0.52, -0.48);
  outline.lineTo(0.52, -0.48);
  outline.lineTo(0.55, 0.1);
  outline.quadraticCurveTo(0.35, 0.12, 0.38, 0.38);
  outline.lineTo(0.22, 0.48);
  outline.quadraticCurveTo(0, 0.16, -0.22, 0.48);
  outline.lineTo(-0.38, 0.38);
  outline.quadraticCurveTo(-0.35, 0.12, -0.55, 0.1);
  outline.closePath();
  const garment = new THREE.ShapeGeometry(outline, 20);
  const clothCanvas = document.createElement('canvas');
  clothCanvas.width = clothCanvas.height = 512;
  const paint = clothCanvas.getContext('2d')!;
  paint.fillStyle = '#ed721d'; paint.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 48) {
    const shade = paint.createLinearGradient(0, y, 0, y + 48);
    shade.addColorStop(0, '#b94b13'); shade.addColorStop(0.15, '#ed721d');
    shade.addColorStop(0.55, '#f58a2d'); shade.addColorStop(1, '#ce5816');
    paint.fillStyle = shade; paint.fillRect(0, y, 512, 48);
    paint.strokeStyle = '#a74617'; paint.lineWidth = 2;
    paint.beginPath(); paint.moveTo(0, y); paint.lineTo(512, y); paint.stroke();
  }
  paint.fillStyle = '#26364a'; paint.fillRect(251, 0, 10, 512);
  paint.fillRect(327, 111, 99, 36);
  paint.fillStyle = '#fff'; paint.font = 'bold 16px sans-serif'; paint.fillText('patagonia', 332, 137);
  paint.strokeStyle = '#813b1b'; paint.lineWidth = 5;
  for (const x of [105, 385]) { paint.beginPath(); paint.moveTo(x, 315); paint.lineTo(x - 14, 400); paint.stroke(); }
  const clothMap = new THREE.CanvasTexture(clothCanvas);
  clothMap.colorSpace = THREE.SRGBColorSpace;
  const vertices = garment.getAttribute('position');
  const clothUV = garment.getAttribute('uv');
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i);
    clothUV.setXY(i, (x + 0.56) / 1.12, (y + 0.48) / 0.96);
    vertices.setXYZ(i, x, 0.12 * (1 - (x / 0.56) ** 2), -y);
  }
  garment.computeVertexNormals();
  garment.computeBoundingSphere();
  const cloth = new THREE.MeshStandardMaterial({ map: clothMap, roughness: 0.85, side: THREE.DoubleSide });
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
  (vest.canopy.material as THREE.MeshStandardMaterial).map?.dispose();
  (vest.canopy.material as THREE.Material).dispose();
  for (const grip of vest.grips) {
    grip.removeFromParent();
    grip.geometry.dispose();
    (grip.material as THREE.Material).dispose();
  }
}
