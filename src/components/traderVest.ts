import * as THREE from 'three';

/** Separate the torso garment while retaining the original skeleton and shirt sleeves. */
export interface TraderVest {
  body: THREE.SkinnedMesh;
  dressed: THREE.BufferGeometry;
  undressed: THREE.BufferGeometry;
  shirt: THREE.SkinnedMesh;
  /** the puffed vest held overhead (two cloth skins, quilted) */
  canopy: THREE.Group;
  /** one strap per anchor, from the canopy down into a fist */
  grips: THREE.Mesh[];
  /** canopy-local attachment points; hand 0 = left, 1 = right */
  anchors: { p: THREE.Vector3; hand: 0 | 1 }[];
  /** dark mouth and teeth behind the lips, shown with the flying face (on the head bone) */
  mouth: THREE.Group | null;
}

/** what every 交易员 on the field shares: worked out once per model (reading the texture and the face takes a while) */
interface VestShared {
  undressed: THREE.BufferGeometry;
  shirtGeo: THREE.BufferGeometry;
  shirtMat: THREE.MeshStandardMaterial;
  canopy: ReturnType<typeof buildCanopy>;
  gripGeo: THREE.BufferGeometry;
  gripMat: THREE.MeshStandardMaterial;
  mouth: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[];
}
const SHARED = new WeakMap<THREE.BufferGeometry, VestShared | null>();

export function splitTraderVest(body: THREE.SkinnedMesh): TraderVest | null {
  const dressed = body.geometry;
  let sh = SHARED.get(dressed);
  if (sh === undefined) {
    sh = buildShared(body);
    SHARED.set(dressed, sh);
  }
  if (!sh) return null;
  // own material: the rig fades a fighter's materials (stealth), which must not touch another 交易员
  const shirt = new THREE.SkinnedMesh(sh.shirtGeo, sh.shirtMat.clone());
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
  const canopy = new THREE.Group();
  canopy.name = 'Patagonia vest glider';
  const top = new THREE.Mesh(sh.canopy.geoTop, sh.canopy.matTop);
  const bot = new THREE.Mesh(sh.canopy.geoBot, sh.canopy.matBot);
  top.castShadow = true;
  bot.receiveShadow = true;
  canopy.add(top, bot);
  canopy.visible = false;
  const grips = sh.canopy.anchors.map(() => {
    const grip = new THREE.Mesh(sh!.gripGeo, sh!.gripMat);
    grip.name = 'Vest strap';
    grip.castShadow = true;
    grip.visible = false;
    return grip;
  });
  const mouth = attachMouth(body, sh.mouth);
  return { body, dressed, undressed: sh.undressed, shirt, canopy, grips, anchors: sh.canopy.anchors, mouth };
}

function buildShared(body: THREE.SkinnedMesh): VestShared | null {
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
  const rgb = (u: number, v: number) => {
    const x = Math.min(canvas.width - 1, Math.max(0, Math.floor(u * canvas.width)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.floor((texture!.flipY ? 1 - v : v) * canvas.height)));
    const p = (y * canvas.width + x) * 4;
    return [pixels[p], pixels[p + 1], pixels[p + 2]];
  };
  const orange = (u: number, v: number) => {
    const [r, g, b] = rgb(u, v);
    return r > 45 && g > r * 0.24 && g < r * 0.74 && b < g * 0.72;
  };
  /** the white shirt, the red tie and skin stay on the body; anything else at the vest's edge is its trim or lining */
  const keeps = (u: number, v: number, yf: number) => {
    const [r, g, b] = rgb(u, v);
    const lum = (r + g + b) / 3;
    if (lum > 168 && Math.max(r, g, b) - Math.min(r, g, b) < 42) return true; // shirt
    if (r > 95 && g < r * 0.42 && b < r * 0.5) return true; // tie
    if (r > 150 && r > g && g > b && r - b > 38) return true; // skin
    if (lum < 46 && yf > 0.885) return true; // hair at the nape
    return false;
  };
  const faces: { ids: number[]; torso: boolean; garment: boolean; yf: number }[] = [];
  for (let n = 0; n < source.index.count; n += 3) {
    const ids = [source.index.getX(n), source.index.getX(n + 1), source.index.getX(n + 2)];
    const y = ids.reduce((s, i) => s + pos.getY(i), 0) / 3;
    const x = ids.reduce((s, i) => s + pos.getX(i), 0) / 3;
    const torso = Math.abs(x - centreX) < torsoHalfWidth && y > box.min.y + height * 0.43 && y < box.min.y + height * 0.9;
    const u = ids.reduce((s, i) => s + uv.getX(i), 0) / 3;
    const v = ids.reduce((s, i) => s + uv.getY(i), 0) / 3;
    const garment = torso && (orange(u, v) || ids.filter((i) => orange(uv.getX(i), uv.getY(i))).length >= 2);
    faces.push({ ids, torso, garment, yf: (y - box.min.y) / height });
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
  // The quilted panels are orange, but their zip, binding and grey lining are not: eat a few rings of whatever at the
  // vest's edge is not shirt, tie or skin (the white undershirt below covers what goes).
  for (let pass = 0; pass < 3; pass++) {
    const grow = faces.map((f) => {
      if (f.garment || f.yf < 0.535 || f.yf > 0.93) return false;
      if (Math.abs(f.ids.reduce((s, i) => s + pos.getX(i), 0) / 3 - centreX) > torsoHalfWidth * 1.12) return false;
      if (!f.ids.some((i) => touching.get(key(i))!.some((n) => faces[n].garment))) return false;
      const u = f.ids.reduce((s, i) => s + uv.getX(i), 0) / 3;
      const v = f.ids.reduce((s, i) => s + uv.getY(i), 0) / 3;
      return !keeps(u, v, f.yf);
    });
    faces.forEach((f, n) => { if (grow[n]) f.garment = true; });
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
  // Edge vertices (shared with the sleeves, collar and the open front) stay put, so the shirt meets the body with no
  // gap; ring = how many steps in from that edge, which sets how far the padding is let out of the cloth below.
  const ring = new Map<string, number>();
  for (const k of points.keys()) if (touching.get(k)!.some((n) => !faces[n].garment)) ring.set(k, 0);
  for (let r = 0; r < 8; r++) {
    for (const [k, d] of [...ring]) {
      if (d !== r) continue;
      for (const n of neighbours.get(k)!) if (!ring.has(n)) ring.set(n, r + 1);
    }
  }
  for (const k of points.keys()) if (!ring.has(k)) ring.set(k, 9);
  const torsoZ = (box.max.z + box.min.z) / 2;
  for (let pass = 0; pass < 60; pass++) {
    const next = new Map<string, THREE.Vector3>();
    for (const [k, point] of points) {
      if (ring.get(k) === 0) continue;
      const near = [...neighbours.get(k)!];
      const average = near.reduce((sum, n) => sum.add(points.get(n)!), new THREE.Vector3()).divideScalar(near.length);
      next.set(k, point.clone().lerp(average, 0.45));
    }
    for (const [k, point] of next) points.set(k, point);
  }
  // let the down out: pull the interior toward the spine's axis, fading in from the pinned edge
  for (const [k, point] of points) {
    const fall = Math.min(1, ring.get(k)! / 4);
    point.x = centreX + (point.x - centreX) * (1 - 0.09 * fall);
    point.z = torsoZ + (point.z - torsoZ) * (1 - 0.11 * fall);
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
  addFlightFace(undressed, body);
  return {
    undressed,
    shirtGeo,
    shirtMat: new THREE.MeshStandardMaterial({ color: '#eceff2', roughness: 0.92 }),
    canopy: buildCanopy(),
    gripGeo: new THREE.CylinderGeometry(0.009, 0.009, 1, 6),
    gripMat: new THREE.MeshStandardMaterial({ color: '#22324a', roughness: 0.85 }),
    mouth: buildMouthParts(),
  };
}

/** take one 交易员's pieces off (the shared geometry and textures stay cached for the next one) */
export function disposeTraderVest(vest: TraderVest) {
  vest.body.geometry = vest.dressed;
  vest.shirt.removeFromParent();
  (vest.shirt.material as THREE.Material).dispose();
  vest.canopy.removeFromParent();
  for (const grip of vest.grips) grip.removeFromParent();
  if (vest.mouth) {
    vest.mouth.removeFromParent();
    vest.mouth.traverse((o: any) => {
      if (o.isMesh) o.material.dispose();
    });
  }
}

// ------------------------------------------------------------------ the vest as a glider
/** the vest laid flat, front view (x across the shoulders, y up), before CANOPY_S */
const OUTLINE: [number, number][] = [];
{
  const sh = new THREE.Shape();
  sh.moveTo(-0.52, -0.48);
  sh.lineTo(0.52, -0.48);
  sh.lineTo(0.55, 0.1);
  sh.quadraticCurveTo(0.35, 0.12, 0.38, 0.38);
  sh.lineTo(0.22, 0.48);
  sh.quadraticCurveTo(0, 0.16, -0.22, 0.48);
  sh.lineTo(-0.38, 0.38);
  sh.quadraticCurveTo(-0.35, 0.12, -0.55, 0.1);
  sh.closePath();
  for (const v of sh.getPoints(16)) OUTLINE.push([v.x, v.y]);
}
const CANOPY_S = 1.45;
const BAFFLES = 10;

function buildCanopy() {
  const N = 512;
  const toPx = (x: number, y: number) => [((x + 0.56) / 1.12) * N, (1 - (y + 0.48) / 0.96) * N];
  // cut-out (alpha) and, blurred, a "how far inside the cloth" field that sets the down's loft
  const mask = document.createElement('canvas');
  mask.width = mask.height = N;
  const mk = mask.getContext('2d')!;
  mk.fillStyle = '#000';
  mk.fillRect(0, 0, N, N);
  mk.fillStyle = '#fff';
  mk.beginPath();
  OUTLINE.forEach(([x, y], i) => (i ? mk.lineTo(...(toPx(x, y) as [number, number])) : mk.moveTo(...(toPx(x, y) as [number, number]))));
  mk.closePath();
  mk.fill();
  // loft = distance in from the cut edge, worked out on a small grid (a canvas blur here took seconds to read back)
  const G = 128;
  // inside test straight on the outline polygon (no canvas readback: that waits on the GPU)
  const inPoly = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
      const [xi, yi] = OUTLINE[i], [xj, yj] = OUTLINE[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const dist = new Float32Array(G * G);
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const x = ((gx + 0.5) / G) * 1.12 - 0.56;
      const y = (1 - (gy + 0.5) / G) * 0.96 - 0.48;
      dist[gy * G + gx] = inPoly(x, y) ? 1e6 : 0;
    }
  // two-pass chamfer distance (cells)
  for (let y = 0; y < G; y++)
    for (let x = 0; x < G; x++) {
      const i = y * G + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - G] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - G - 1] + 1.414);
      if (x < G - 1 && y > 0) d = Math.min(d, dist[i - G + 1] + 1.414);
      dist[i] = d;
    }
  for (let y = G - 1; y >= 0; y--)
    for (let x = G - 1; x >= 0; x--) {
      const i = y * G + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x < G - 1) d = Math.min(d, dist[i + 1] + 1);
      if (y < G - 1) d = Math.min(d, dist[i + G] + 1);
      if (x < G - 1 && y < G - 1) d = Math.min(d, dist[i + G + 1] + 1.414);
      if (x > 0 && y < G - 1) d = Math.min(d, dist[i + G - 1] + 1.414);
      dist[i] = d;
    }
  const inside = (x: number, y: number) => {
    const [px, py] = toPx(x, y);
    const gx = Math.min(G - 1, Math.max(0, ((px / N) * G) | 0));
    const gy = Math.min(G - 1, Math.max(0, ((py / N) * G) | 0));
    return THREE.MathUtils.smoothstep(dist[gy * G + gx], 0, 9);
  };

  // shell fabric: orange ripstop, quilted in horizontal baffles, the zip down the middle, chest pocket and label
  const cloth = document.createElement('canvas');
  cloth.width = cloth.height = N;
  const g = cloth.getContext('2d')!;
  const band = N / BAFFLES;
  for (let k = 0; k < BAFFLES; k++) {
    const y = k * band;
    const sh = g.createLinearGradient(0, y, 0, y + band);
    sh.addColorStop(0, '#a9430f');
    sh.addColorStop(0.12, '#e06a1c');
    sh.addColorStop(0.5, '#f8913a');
    sh.addColorStop(0.88, '#dc6519');
    sh.addColorStop(1, '#a9430f');
    g.fillStyle = sh;
    g.fillRect(0, y, N, band);
    g.strokeStyle = 'rgba(90,30,8,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(N, y + 0.5);
    g.stroke();
  }
  // ripstop grid, faint
  g.strokeStyle = 'rgba(255,220,180,0.07)';
  g.lineWidth = 1;
  for (let i = 0; i < N; i += 8) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(N, i); g.stroke();
  }
  // binding round the edge
  g.save();
  g.strokeStyle = '#7a2f0c';
  g.lineWidth = 10;
  g.beginPath();
  OUTLINE.forEach(([x, y], i) => (i ? g.lineTo(...(toPx(x, y) as [number, number])) : g.moveTo(...(toPx(x, y) as [number, number]))));
  g.closePath();
  g.stroke();
  g.restore();
  g.fillStyle = '#26364a';
  g.fillRect(251, 0, 10, N); // zip
  g.fillStyle = '#9aa3ad';
  for (let y = 4; y < N; y += 7) g.fillRect(253, y, 6, 3);
  g.fillStyle = '#26364a';
  g.fillRect(327, 111, 99, 36);
  g.fillStyle = '#fff';
  g.font = 'bold 16px sans-serif';
  g.fillText('patagonia', 332, 137);
  g.strokeStyle = '#7d3412';
  g.lineWidth = 5;
  for (const x of [105, 385]) { g.beginPath(); g.moveTo(x, 315); g.lineTo(x - 14, 400); g.stroke(); }
  const map = new THREE.CanvasTexture(cloth);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const alphaMap = new THREE.CanvasTexture(mask);

  // two skins on one grid: the top lofts up in each baffle, the underside is flatter; both meet at the cut edge
  const geoTop = new THREE.PlaneGeometry(1.12, 0.96, 64, 56);
  const geoBot = geoTop.clone();
  const span = 0.6;
  const surf = (geo: THREE.BufferGeometry, top: boolean) => {
    const P = geo.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i);
      const e = inside(x, y);
      const v = (y + 0.48) / 0.96;
      const puff = Math.pow(Math.sin(Math.PI * ((v * BAFFLES) % 1)), 0.7);
      const arch = 0.2 * (1 - (x / span) ** 2) + 0.05 * (1 - ((y - 0.05) / 0.55) ** 2); // span arc + a little camber
      const h = top ? arch + Math.sqrt(e) * (0.018 + 0.03 * puff) : arch - Math.sqrt(e) * (0.012 + 0.014 * puff);
      P.setXYZ(i, x * CANOPY_S, h * CANOPY_S, -y * CANOPY_S);
    }
    if (!top) {
      const idx = geo.getIndex()!;
      for (let n = 0; n < idx.count; n += 3) {
        const t = idx.getX(n + 1);
        idx.setX(n + 1, idx.getX(n + 2));
        idx.setX(n + 2, t);
      }
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };
  surf(geoTop, true);
  surf(geoBot, false);
  const matTop = new THREE.MeshStandardMaterial({ map, alphaMap, alphaTest: 0.5, roughness: 0.62, metalness: 0.0 });
  // the underside glows a little: thin nylon with the sky behind it
  const matBot = new THREE.MeshStandardMaterial({ map, alphaMap, alphaTest: 0.5, roughness: 0.8, color: '#e8cdb8', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.32 });
  // two straps a side: one at the armhole, one at the hem corner, meeting in the fist
  const anchors: { p: THREE.Vector3; hand: 0 | 1 }[] = [];
  for (const side of [-1, 1] as const) {
    for (const [ax, ay] of [[0.5, 0.06], [0.47, -0.42]]) {
      const x = side * ax, y = ay;
      const arch = 0.2 * (1 - (x / span) ** 2) + 0.05 * (1 - ((y - 0.05) / 0.55) ** 2);
      anchors.push({ p: new THREE.Vector3(x * CANOPY_S, (arch - 0.01) * CANOPY_S, -y * CANOPY_S), hand: side < 0 ? 0 : 1 });
    }
  }
  return { geoTop, geoBot, matTop, matBot, anchors };
}

// ------------------------------------------------------------------ 起飞 face: a delighted open-mouthed laugh
// Mesh-space landmarks of this model's face (Tripo export; the head faces +Z, x grows to his left).
const FACE = { mx: 0.029, lipUp: 0.7445, lipDn: 0.7425, hw: 0.037, cornerL: [-0.009, 0.7435], cornerR: [0.066, 0.746], browL: [-0.022, 0.838], browR: [0.068, 0.845] };
const gauss = (dx: number, dy: number, sx: number, sy: number) => Math.exp(-(dx * dx) / (2 * sx * sx) - (dy * dy) / (2 * sy * sy));
const sstep = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

/** morph target 0 on the geometry he flies in: jaw down, lips parted, corners up, brows raised; the lip seam is cut open */
function addFlightFace(geo: THREE.BufferGeometry, body: THREE.SkinnedMesh) {
  const pos = geo.getAttribute('position');
  const head = body.skeleton.bones.findIndex((b) => /head$/i.test(b.name));
  if (head < 0 || !geo.index) return;
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight');
  const delta = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === head) w += sw.getComponent(i, k);
    if (w < 0.2) continue;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (z < 0.06 || y < 0.69 || y > 0.88) continue;
    let dx = 0, dy = 0, dz = 0;
    const wx = 1 - sstep(Math.abs(x - FACE.mx), FACE.hw * 0.75, FACE.hw * 1.9);
    // the lips part in a laughing D: wide open in the middle, closing in to the corners
    const lens = Math.pow(Math.max(0, 1 - ((x - FACE.mx) / 0.036) ** 2), 0.75);
    if (y <= FACE.lipDn) {
      const wy = sstep(y, 0.695, 0.715); // the whole jaw drops, fading out under the chin
      const near = sstep(y, 0.722, 0.736); // the lower lip follows the lens, the chin the wider jaw
      const k = THREE.MathUtils.lerp(wx, lens, near) * wy;
      dy -= 0.012 * k;
      dz -= 0.003 * k;
    } else if (y >= FACE.lipUp) {
      dy += 0.0035 * lens * (1 - sstep(y - 0.7456, 0, 0.018));
    }
    for (const [c, s] of [[FACE.cornerL, -1], [FACE.cornerR, 1]] as const) {
      const k = gauss(x - c[0], y - c[1], 0.009, 0.009);
      dy += 0.0045 * k;
      dx += s * 0.003 * k;
    }
    for (const c of [FACE.browL, FACE.browR]) dy += 0.0055 * gauss(x - c[0], y - c[1], 0.028, 0.009);
    for (const c of [[-0.02, 0.775], [0.078, 0.778]]) {
      const k = gauss(x - c[0], y - c[1], 0.013, 0.013);
      dy += 0.0025 * k;
      dz += 0.002 * k;
    }
    delta[i * 3] = dx * w;
    delta[i * 3 + 1] = dy * w;
    delta[i * 3 + 2] = dz * w;
  }
  geo.morphAttributes.position = [new THREE.Float32BufferAttribute(delta, 3)];
  geo.morphTargetsRelative = true;
  // open the seam: drop the thin strip of faces that joins the two lips
  const idx = geo.index;
  const keep: number[] = [];
  for (let n = 0; n < idx.count; n += 3) {
    const t = [idx.getX(n), idx.getX(n + 1), idx.getX(n + 2)];
    const ys = t.map((i) => pos.getY(i)), xs = t.map((i) => pos.getX(i)), zs = t.map((i) => pos.getZ(i));
    const seam = ys.every((y) => y > 0.7400 && y < 0.7470) && ys.some((y) => y >= FACE.lipUp) && ys.some((y) => y <= FACE.lipDn)
      && xs.every((x) => x > -0.0075 && x < 0.0645) && zs.every((z) => z > 0.1);
    if (!seam) keep.push(...t);
  }
  geo.setIndex(keep);
}

/** dark mouth, upper teeth and a tongue, curved to sit just behind the lips (mesh space) */
function buildMouthParts() {
  // a bowl behind the lips: it curls sharply back past the corners, so from the side you only ever see dark
  const curve = (geo: THREE.BufferGeometry, back: number) => {
    const P = geo.getAttribute('position');
    for (let i = 0; i < P.count; i++) {
      const dx = Math.abs(P.getX(i) - FACE.mx);
      P.setZ(i, 0.146 - back - 30 * dx * dx - 1.6 * Math.max(0, dx - 0.026));
    }
    geo.computeVertexNormals();
    return geo;
  };
  return [
    { geo: curve(new THREE.PlaneGeometry(0.072, 0.028, 24, 4).translate(FACE.mx, 0.737, 0), 0.008), mat: new THREE.MeshStandardMaterial({ color: '#1e0708', roughness: 1, side: THREE.DoubleSide }) },
    { geo: curve(new THREE.PlaneGeometry(0.04, 0.0045, 12, 1).translate(FACE.mx, 0.7445, 0), 0.0055), mat: new THREE.MeshStandardMaterial({ color: '#e9e2d3', roughness: 0.5 }) },
    { geo: curve(new THREE.PlaneGeometry(0.032, 0.007, 10, 1).translate(FACE.mx, 0.7315, 0), 0.0065), mat: new THREE.MeshStandardMaterial({ color: '#7d3133', roughness: 0.7 }) },
  ];
}

/** hang this 交易员's mouth on his head bone */
function attachMouth(body: THREE.SkinnedMesh, parts: VestShared['mouth']): THREE.Group | null {
  const headBone = body.skeleton.bones.find((b) => /head$/i.test(b.name));
  if (!headBone) return null;
  const g = new THREE.Group();
  g.name = 'Trader mouth';
  for (const p of parts) g.add(new THREE.Mesh(p.geo, p.mat.clone()));
  // mesh space -> head bone space: a vertex fully weighted to the head is skinned by boneInverse * bindMatrix
  const hi = body.skeleton.bones.indexOf(headBone);
  g.matrixAutoUpdate = false;
  g.matrix.copy(body.skeleton.boneInverses[hi]).multiply(body.bindMatrix);
  g.visible = false;
  headBone.add(g);
  return g;
}
