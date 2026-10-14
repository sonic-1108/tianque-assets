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
