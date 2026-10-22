import * as THREE from 'three';

/**
 * 散人's weapon opened into an oil-paper umbrella (油纸伞) for gliding: a domed canopy of sixteen paper panels on dark
 * bamboo ribs, a red band near the rim, a finial on top and a bamboo shaft down into his hands.
 * Local frame: the canopy's apex at +Y = R_H, the shaft hangs down from the origin along -Y.
 */
export interface Umbrella {
  group: THREE.Group;
  canopy: THREE.Group;
  shaft: THREE.Mesh;
}

const R = 1.15; // canopy radius
const H = 0.42; // dome height
const PANELS = 16;
let shared: { top: THREE.BufferGeometry; under: THREE.BufferGeometry; ribs: THREE.BufferGeometry; shaft: THREE.BufferGeometry; finial: THREE.BufferGeometry; paper: THREE.MeshStandardMaterial; inner: THREE.MeshStandardMaterial; bamboo: THREE.MeshStandardMaterial } | null = null;

function paperTexture() {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d')!;
  const c = N / 2;
  // sixteen panels, alternating warm ochre and pale paper, with the oiled sheen darker toward the rim
  for (let k = 0; k < PANELS; k++) {
    const a0 = (k / PANELS) * Math.PI * 2;
    const a1 = ((k + 1) / PANELS) * Math.PI * 2;
    const grd = g.createRadialGradient(c, c, 0, c, c, c);
    const light = k % 2 ? '#e9d3a4' : '#dcb878';
    grd.addColorStop(0, '#f3e4c1');
    grd.addColorStop(0.55, light);
    grd.addColorStop(1, k % 2 ? '#c49a5a' : '#b48446');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, c, a0, a1);
    g.closePath();
    g.fill();
  }
  // red band near the rim and a thin one round the top
  g.strokeStyle = '#a3261f';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(c, c, c * 0.84, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  g.arc(c, c, c * 0.2, 0, Math.PI * 2);
  g.stroke();
  // ink plum branch across a few panels
  g.strokeStyle = 'rgba(40,28,20,0.85)';
  g.lineCap = 'round';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(c + c * 0.25, c - c * 0.62);
  g.quadraticCurveTo(c + c * 0.5, c - c * 0.35, c + c * 0.66, c - c * 0.12);
  g.moveTo(c + c * 0.42, c - c * 0.42);
  g.quadraticCurveTo(c + c * 0.32, c - c * 0.25, c + c * 0.36, c - c * 0.08);
  g.stroke();
  g.fillStyle = '#c0392b';
  for (const [x, y] of [[0.5, -0.36], [0.62, -0.18], [0.36, -0.12], [0.3, -0.55], [0.46, -0.5]]) {
    g.beginPath();
    g.arc(c + c * x, c + c * y, 9, 0, Math.PI * 2);
    g.fill();
  }
  // paper fibre
  g.globalAlpha = 0.06;
  for (let k = 0; k < 900; k++) {
    g.fillStyle = Math.random() < 0.5 ? '#fff' : '#5a3a1a';
    g.fillRect(Math.random() * N, Math.random() * N, 1 + Math.random() * 2, 1);
  }
  g.globalAlpha = 1;
  // ribs, dark bamboo along each seam
  g.strokeStyle = '#3b2615';
  g.lineWidth = 3;
  for (let k = 0; k < PANELS; k++) {
    const a = (k / PANELS) * Math.PI * 2;
    g.beginPath();
    g.moveTo(c, c);
    g.lineTo(c + Math.cos(a) * c, c + Math.sin(a) * c);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** the dome: height falls off toward the rim, each panel sags a little between its ribs */
function dome(sag: number) {
  const rings = 14;
  const seg = PANELS * 4;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    for (let j = 0; j <= seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const between = Math.sin(((j % 4) / 4) * Math.PI); // 0 on a rib, 1 mid panel
      const r = u * R * (1 - 0.03 * between * u);
      const y = H * (1 - Math.pow(u, 1.7)) - sag * between * u * (1 - u) * 0.5;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      uv.push(0.5 + Math.cos(a) * u * 0.5, 0.5 - Math.sin(a) * u * 0.5);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function build() {
  const map = paperTexture();
  // dome() winds its faces downward: that is the underside; the top is the same surface turned to face up
  const under = dome(0.06).translate(0, -0.006, 0);
  const top = dome(0.06);
  const ix = top.getIndex()!;
  for (let n = 0; n < ix.count; n += 3) {
    const t = ix.getX(n + 1);
    ix.setX(n + 1, ix.getX(n + 2));
    ix.setX(n + 2, t);
  }
  top.computeVertexNormals();
  // the stretchers under the canopy: thin sticks from the runner on the shaft out to the middle of each rib
  const sticks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < PANELS; k++) {
    const a = (k / PANELS) * Math.PI * 2;
    const from = new THREE.Vector3(0, -0.32, 0);
    const to = new THREE.Vector3(Math.cos(a) * R * 0.55, H * (1 - Math.pow(0.55, 1.7)) - 0.02, Math.sin(a) * R * 0.55);
    const len = from.distanceTo(to);
    const g = new THREE.CylinderGeometry(0.006, 0.006, len, 4).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()));
    g.translate(from.x, from.y, from.z);
    sticks.push(g);
  }
  const ribs = mergeAll(sticks);
  const shaft = new THREE.CylinderGeometry(0.016, 0.016, 1, 8).translate(0, -0.5, 0);
  const finial = new THREE.ConeGeometry(0.035, 0.14, 8).translate(0, H + 0.06, 0);
  return {
    top,
    under,
    ribs,
    shaft,
    finial,
    paper: new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 }),
    // oiled paper with the sky behind it: lit from above
    inner: new THREE.MeshStandardMaterial({ map, roughness: 0.8, color: '#f1e2c8', emissive: '#ffffff', emissiveMap: map, emissiveIntensity: 0.4 }),
    bamboo: new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 0.7 }),
  };
}

function mergeAll(list: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of list) {
    const ng = g.index ? g : g;
    const P = ng.getAttribute('position'), Nn = ng.getAttribute('normal');
    for (let i = 0; i < P.count; i++) {
      pos.push(P.getX(i), P.getY(i), P.getZ(i));
      nor.push(Nn.getX(i), Nn.getY(i), Nn.getZ(i));
    }
    const I = ng.getIndex()!;
    for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + off);
    off += P.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

export function buildUmbrella(): Umbrella {
  shared ??= build();
  const S = shared;
  const canopy = new THREE.Group();
  const top = new THREE.Mesh(S.top, S.paper);
  top.castShadow = true;
  const under = new THREE.Mesh(S.under, S.inner);
  under.receiveShadow = true;
  canopy.add(top, under, new THREE.Mesh(S.ribs, S.bamboo), new THREE.Mesh(S.finial, S.bamboo));
  const shaft = new THREE.Mesh(S.shaft, S.bamboo);
  shaft.castShadow = true;
  const group = new THREE.Group();
  group.name = '散人 umbrella';
  group.add(canopy, shaft);
  group.visible = false;
  return { group, canopy, shaft };
}
