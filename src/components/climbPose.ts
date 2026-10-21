import * as THREE from 'three';

/**
 * Procedural tree-climbing pose, layered over whatever clip is playing.
 * Works on any Mixamo-style skeleton: each limb bone is aimed at a world-space direction,
 * so it does not depend on how the bones' local axes happen to be oriented.
 */
export interface Limbs {
  bones: Record<string, THREE.Bone>;
}

const norm = (n: string) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');
const CHAINS: [string, string][] = [
  ['leftarm', 'leftforearm'],
  ['leftforearm', 'lefthand'],
  ['rightarm', 'rightforearm'],
  ['rightforearm', 'righthand'],
  ['leftupleg', 'leftleg'],
  ['leftleg', 'leftfoot'],
  ['rightupleg', 'rightleg'],
  ['rightleg', 'rightfoot'],
];

export function collectLimbs(root: THREE.Object3D): Limbs | null {
  const bones: Record<string, THREE.Bone> = {};
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[norm(o.name)] = o as THREE.Bone;
  });
  for (const [a, b] of CHAINS) if (!bones[a] || !bones[b]) return null;
  return { bones };
}

const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const qD = new THREE.Quaternion();
const qW = new THREE.Quaternion();
const qP = new THREE.Quaternion();

/** rotate `bone` so the segment toward `child` points along `dir` (world space), blended by w */
function aim(bone: THREE.Bone, child: THREE.Bone, dir: THREE.Vector3, w: number) {
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(vA);
  child.getWorldPosition(vB);
  const cur = vB.sub(vA);
  if (cur.lengthSq() < 1e-10) return;
  cur.normalize();
  qD.setFromUnitVectors(cur, dir);
  bone.getWorldQuaternion(qW).premultiply(qD);
  bone.parent!.getWorldQuaternion(qP).invert();
  const local = qP.multiply(qW);
  bone.quaternion.slerp(local, w);
  bone.updateWorldMatrix(false, true);
}

const d = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3();

/** Pull the vest off at chest level, then hold it overhead by its straps; the legs hang and swing under it. */
export function applyGlidePose(l: Limbs, fwd: THREE.Vector3, lift: number, w: number, t = 0) {
  right.set(-fwd.z, 0, fwd.x);
  const B = l.bones;
  for (const side of [-1, 1]) {
    const p = side < 0 ? 'left' : 'right';
    // arms: a wide V overhead, elbows a touch bent and forward, the way you hang off two straps
    d.copy(up).multiplyScalar(THREE.MathUtils.lerp(-0.15, 0.82, lift)).addScaledVector(fwd, 0.22).addScaledVector(right, side * 0.52).normalize();
    aim(B[p + 'arm'], B[p + 'forearm'], d, w);
    d.copy(up).multiplyScalar(THREE.MathUtils.lerp(0.25, 0.95, lift)).addScaledVector(fwd, 0.1).addScaledVector(right, side * 0.08).normalize();
    aim(B[p + 'forearm'], B[p + 'hand'], d, w);
    // legs: hanging, knees softly bent, swinging out of step with each other
    const sw = Math.sin(t * 2.3 + (side < 0 ? 0 : 2.1)) * lift;
    d.copy(up).multiplyScalar(-1).addScaledVector(fwd, 0.22 + 0.1 * sw).addScaledVector(right, side * 0.1).normalize();
    aim(B[p + 'upleg'], B[p + 'leg'], d, w);
    d.copy(up).multiplyScalar(-1).addScaledVector(fwd, -0.3 - 0.12 * sw * lift).addScaledVector(right, side * 0.04).normalize();
    aim(B[p + 'leg'], B[p + 'foot'], d, w);
    // toes point down (no ground to stand on)
    const toe = B[p + 'toebase'];
    if (toe) {
      d.copy(up).multiplyScalar(-0.85).addScaledVector(fwd, 0.5).normalize();
      aim(B[p + 'foot'], toe, d, w * lift);
    }
  }
  gripHands(l, w * THREE.MathUtils.smoothstep(lift, 0.15, 0.6));
}

// ---------------------------------------------------------------- hands closing on a strap
const FINGERS = ['index', 'middle', 'ring', 'pinky'];
/** how far each joint folds into a fist (radians): knuckle, middle, tip */
const FIST = { index: [1.15, 1.45, 0.95], middle: [1.25, 1.55, 1.0], ring: [1.3, 1.6, 1.0], pinky: [1.4, 1.6, 1.0] } as Record<string, number[]>;
interface GripJoint { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; ang: number }
const gripRig = new WeakMap<Limbs, GripJoint[][] | null>();
const qA = new THREE.Quaternion();
const qT = new THREE.Quaternion();

/**
 * Work out, from the bind pose, how each finger joint folds: about the knuckle line, toward the palm (the side the
 * thumb sits on). The fold axis is kept in each joint's parent frame, so the fist is rebuilt from rest every frame
 * and nothing accumulates whatever the clip does with the fingers.
 */
function gripJoints(l: Limbs): GripJoint[][] | null {
  if (gripRig.has(l)) return gripRig.get(l)!;
  const B = l.bones;
  const out: GripJoint[][] = [];
  for (const p of ['left', 'right']) {
    const hand = B[p + 'hand'], idx = B[p + 'handindex1'], pky = B[p + 'handpinky1'], th = B[p + 'handthumb1'];
    if (!hand || !idx || !pky || !th) { gripRig.set(l, null); return null; }
    hand.updateWorldMatrix(true, true);
    const axis = idx.getWorldPosition(new THREE.Vector3()).sub(pky.getWorldPosition(new THREE.Vector3())).normalize();
    // which way is "into the palm": fold the index finger both ways and keep the one that ends nearer the thumb
    const i1 = idx.getWorldPosition(new THREE.Vector3());
    const tip = (B[p + 'handindex4'] ?? B[p + 'handindex3']).getWorldPosition(new THREE.Vector3()).sub(i1);
    const thumb = th.getWorldPosition(new THREE.Vector3());
    const reach = (sgn: number) => tip.clone().applyAxisAngle(axis, sgn * 1.2).add(i1).distanceTo(thumb);
    const sgn = reach(1) < reach(-1) ? 1 : -1;
    const joints: GripJoint[] = [];
    for (const f of FINGERS) {
      for (let j = 1; j <= 3; j++) {
        const bone = B[p + 'hand' + f + j];
        if (!bone?.parent) continue;
        const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        joints.push({ bone, rest: bone.quaternion.clone(), axis: axis.clone().applyQuaternion(pq).normalize(), ang: sgn * FIST[f][j - 1] });
      }
    }
    out.push(joints);
  }
  gripRig.set(l, out);
  return out;
}

const fa = new THREE.Vector3();
const fb = new THREE.Vector3();
/** close both hands into fists around the straps; the thumbs wrap over the index fingers */
export function gripHands(l: Limbs, w: number) {
  if (w <= 0.001) return;
  const rig = gripJoints(l);
  if (!rig) return;
  const B = l.bones;
  for (let h = 0; h < 2; h++) {
    for (const j of rig[h]) {
      qT.copy(qA.setFromAxisAngle(j.axis, j.ang)).multiply(j.rest);
      j.bone.quaternion.slerp(qT, w);
    }
    const p = h === 0 ? 'left' : 'right';
    B[p + 'hand'].updateWorldMatrix(true, true);
    const t2 = B[p + 'handthumb2'], t3 = B[p + 'handthumb3'], t4 = B[p + 'handthumb4'];
    const i2 = B[p + 'handindex2'], m2 = B[p + 'handmiddle2'];
    if (t2 && t3 && i2) {
      d.copy(i2.getWorldPosition(fa)).sub(t2.getWorldPosition(fb)).normalize();
      aim(t2, t3, d, w * 0.8);
    }
    if (t3 && t4 && m2) {
      d.copy(m2.getWorldPosition(fa)).sub(t3.getWorldPosition(fb)).normalize();
      aim(t3, t4, d, w * 0.8);
    }
  }
}

/** world point inside the closed fist (between the knuckles and the folded fingertips): where a strap runs through */
export function fistCentre(l: Limbs, side: 0 | 1, out: THREE.Vector3) {
  const p = side === 0 ? 'left' : 'right';
  const B = l.bones;
  out.set(0, 0, 0);
  let n = 0;
  for (const f of FINGERS) {
    const k = B[p + 'hand' + f + '1'], tip = B[p + 'hand' + f + '3'];
    if (!k || !tip) continue;
    out.add(k.getWorldPosition(fa)).add(tip.getWorldPosition(fb));
    n += 2;
  }
  if (!n) return B[p + 'hand'].getWorldPosition(out);
  return out.divideScalar(n);
}

/**
 * fwd: world direction the climber faces (into the trunk). phase advances as they climb.
 * Arms reach up alternately, the opposite leg steps up with each reach.
 */
export function applyClimbPose(l: Limbs, fwd: THREE.Vector3, phase: number, w: number) {
  if (w <= 0.001) return;
  right.set(-fwd.z, 0, fwd.x); // facing -z -> right is +x
  const s = Math.sin(phase);
  const reachL = 0.5 + 0.5 * s;
  const reachR = 0.5 - 0.5 * s;
  const B = l.bones;
  for (const side of [-1, 1]) {
    const reach = side < 0 ? reachL : reachR;
    const lift = side < 0 ? reachR : reachL; // leg opposite to the reaching arm steps up
    const p = side < 0 ? 'left' : 'right';
    // upper arm: up and in front, hands converging on the trunk
    d.copy(up).multiplyScalar(0.55 + 0.45 * reach).addScaledVector(fwd, 0.55).addScaledVector(right, side * (0.32 - 0.12 * reach)).normalize();
    aim(B[p + 'arm'], B[p + 'forearm'], d, w);
    // forearm: bent toward the bark, straighter when reaching
    d.copy(up).multiplyScalar(0.35 + 0.6 * reach).addScaledVector(fwd, 0.75 - 0.3 * reach).addScaledVector(right, -side * 0.12).normalize();
    aim(B[p + 'forearm'], B[p + 'hand'], d, w);
    // thigh: knee comes up in front when the leg steps
    d.copy(up).multiplyScalar(-(0.85 - 0.6 * lift)).addScaledVector(fwd, 0.25 + 0.6 * lift).addScaledVector(right, side * 0.16).normalize();
    aim(B[p + 'upleg'], B[p + 'leg'], d, w);
    // shin: hangs down, foot against the trunk
    d.copy(up).multiplyScalar(-1).addScaledVector(fwd, 0.15 - 0.2 * lift).normalize();
    aim(B[p + 'leg'], B[p + 'foot'], d, w);
  }
}

/**
 * cross-legged meditation on a cushion: knees out to the sides, shins folded in front, hands resting in the lap.
 * (The hips are lowered by the caller.)
 */
export function applySitPose(l: Limbs, fwd: THREE.Vector3, w: number) {
  if (w <= 0.001) return;
  right.set(-fwd.z, 0, fwd.x);
  const B = l.bones;
  for (const side of [-1, 1]) {
    const p = side < 0 ? 'left' : 'right';
    // thigh: out to the side and a little forward, nearly level
    d.copy(right).multiplyScalar(side * 0.85).addScaledVector(fwd, 0.5).addScaledVector(up, -0.12).normalize();
    aim(B[p + 'upleg'], B[p + 'leg'], d, w);
    // shin: folded back across in front of the body
    d.copy(right).multiplyScalar(-side * 0.9).addScaledVector(fwd, 0.3).addScaledVector(up, -0.05).normalize();
    aim(B[p + 'leg'], B[p + 'foot'], d, w);
    // upper arm: hanging down, slightly forward
    d.copy(up).multiplyScalar(-0.9).addScaledVector(fwd, 0.35).addScaledVector(right, side * 0.12).normalize();
    aim(B[p + 'arm'], B[p + 'forearm'], d, w);
    // forearm: in to the lap, hands meeting
    d.copy(fwd).multiplyScalar(0.7).addScaledVector(right, -side * 0.6).addScaledVector(up, -0.15).normalize();
    aim(B[p + 'forearm'], B[p + 'hand'], d, w);
  }
}

/**
 * 大漠玉门关 well: t seconds into drawing water. First the right hand works the windlass crank (the forearm
 * circles), then both hands lift the bucket to the mouth (elbows out, hands meeting in front of the face).
 */
export function applyDrinkPose(l: Limbs, fwd: THREE.Vector3, t: number, w: number) {
  if (w <= 0.001) return;
  right.set(-fwd.z, 0, fwd.x);
  const B = l.bones;
  if (t < DRINK.lift) {
    // cranking: right arm forward and down to the handle, forearm turning the crank
    const a = t * 7;
    d.copy(fwd).multiplyScalar(0.85).addScaledVector(up, -0.35).addScaledVector(right, 0.25).normalize();
    aim(B.rightarm, B.rightforearm, d, w);
    d.copy(fwd).multiplyScalar(0.55).addScaledVector(up, Math.sin(a) * 0.6).addScaledVector(right, 0.15 + Math.cos(a) * 0.45).normalize();
    aim(B.rightforearm, B.righthand, d, w);
    // the left hand steadies the post
    d.copy(fwd).multiplyScalar(0.6).addScaledVector(up, -0.6).addScaledVector(right, -0.35).normalize();
    aim(B.leftarm, B.leftforearm, d, w * 0.8);
    return;
  }
  // drinking: the bucket held up to the face
  const k = Math.min(1, (t - DRINK.lift) / 0.35) * w;
  for (const side of [-1, 1]) {
    const p = side < 0 ? 'left' : 'right';
    d.copy(fwd).multiplyScalar(0.7).addScaledVector(up, 0.05).addScaledVector(right, side * 0.55).normalize();
    aim(B[p + 'arm'], B[p + 'forearm'], d, k);
    d.copy(up).multiplyScalar(0.75).addScaledVector(fwd, 0.35).addScaledVector(right, -side * 0.55).normalize();
    aim(B[p + 'forearm'], B[p + 'hand'], d, k);
  }
}
/** well timeline (seconds): bucket down, in the water, up, then lifted to the mouth, drinking, put back */
export const DRINK = { down: 1.2, wet: 1.5, up: 2.6, lift: 2.9, drink: 4.0, end: 4.4 };
