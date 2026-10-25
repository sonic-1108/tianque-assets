import { FX } from './fxMute';
import { getSettings } from './settings';
import * as THREE from 'three';

export class CameraController {
  enabled = false;
  yaw = 0; // radians, absolute
  pitch = 0.28; // radians, absolute
  distance = 4.6;
  /** terrain height under a point, so the camera never sinks into a slope */
  groundAt: ((x: number, z: number) => number) | null = null;
  /** underside of a ceiling over a point (cabins), so the camera stays in the room */
  ceilAt: ((x: number, z: number) => number) | null = null;
  /** solid geometry (walls): the boom is pulled in in front of it */
  solidAt: ((x: number, y: number, z: number) => boolean) | null = null;
  /** 穿云狙: looking down the scope from this eye point (null = normal third-person camera) */
  scopeEye: THREE.Vector3 | null = null;
  pendingDX = 0;
  pendingDY = 0;
  private sensitivity = 0.0025;
  private smoothPos = new THREE.Vector3();
  private outPos = new THREE.Vector3();
  private boomK = 1;
  private followY = 0;
  private initialized = false;
  private onMouseMove: (e: MouseEvent) => void;
  private lastPointer: [number, number] | null = null;
  private resetPointer = () => { this.lastPointer = null; this.pendingDX = this.pendingDY = 0; };
  private onWheel: (e: WheelEvent) => void;

  // Camera Trauma & Shake
  private shakeTrauma = 0;
  private shakeTime = 0;

  constructor(private camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement) {
    this.onMouseMove = (e: MouseEvent) => {
      if (!this.enabled) { this.resetPointer(); return; }
      if (document.pointerLockElement === this.canvas) {
        this.lastPointer = null;
        this.pendingDX += e.movementX;
        this.pendingDY += e.movementY;
        return;
      }
      // Embedded browsers may reject pointer lock. Only the actual canvas accepts
      // unlocked look input, so moving over menus and HUD controls never turns it.
      if (document.pointerLockElement || e.target !== this.canvas) { this.lastPointer = null; return; }
      if (this.lastPointer) {
        this.pendingDX += e.clientX - this.lastPointer[0];
        this.pendingDY += e.clientY - this.lastPointer[1];
      }
      this.lastPointer = [e.clientX, e.clientY];
    };
    this.onWheel = (e: WheelEvent) => {
      if (!this.enabled) return;
      this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.004, 2.6, 9);
    };

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.resetPointer);
    this.canvas.addEventListener('mouseleave', this.resetPointer);
    window.addEventListener('blur', this.resetPointer);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private fovKick = 0;
  private baseFov = -1;
  /** Brief zoom punch on heavy impacts (degrees, negative = zoom in) */
  kick(deg: number) {
    this.fovKick = deg;
  }

  // Add screen shake trauma (0.0 to 1.0)
  addShake(amount: number) {
    if (FX.mute > 0) return;
    this.shakeTrauma = Math.min(1.0, this.shakeTrauma + amount);
  }

  update(playerPos: THREE.Vector3, dt: number) {
    // a NaN anywhere (player position, a frame time) would put the camera nowhere and the screen goes black for good
    if (!Number.isFinite(playerPos.x + playerPos.y + playerPos.z) || !Number.isFinite(dt)) return;
    if (!Number.isFinite(this.yaw)) this.yaw = 0;
    if (!Number.isFinite(this.pitch)) this.pitch = 0.3;
    if (!Number.isFinite(this.smoothPos.x + this.smoothPos.y + this.smoothPos.z) || !Number.isFinite(this.followY)) {
      this.initialized = false;
      this.smoothPos.set(0, 0, 0);
    }
    // consume mouse input ONCE, then reset it
    const sens = this.sensitivity * getSettings().sens * (this.scopeEye ? 0.28 : 1);
    this.yaw -= this.pendingDX * sens;
    this.pitch += this.pendingDY * sens;
    this.pendingDX = 0;
    this.pendingDY = 0;
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.scopeEye ? -0.7 : 0.05, this.scopeEye ? 0.9 : 1.15);
    if (this.scopeEye) {
      // first person down the scope: narrow field of view, looking where the aim points
      if (this.baseFov < 0) this.baseFov = this.camera.fov;
      const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      this.camera.position.copy(this.scopeEye);
      this.camera.lookAt(this.scopeEye.clone().add(dir));
      const want = 13;
      if (Math.abs(this.camera.fov - want) > 0.05) {
        this.camera.fov = THREE.MathUtils.damp(this.camera.fov, want, 14, dt);
        this.camera.updateProjectionMatrix();
      }
      this.smoothPos.copy(this.scopeEye);
      return;
    }

    // Look slightly over the right shoulder so the character sits left of the crosshair
    // the height the camera follows is eased, so walking up stairs (a 30 cm hop per step) glides instead of jolting
    if (!this.initialized || Math.abs(playerPos.y - this.followY) > 2.5) this.followY = playerPos.y;
    else this.followY = THREE.MathUtils.damp(this.followY, playerPos.y, 10, dt);
    const target = new THREE.Vector3(playerPos.x, this.followY + 1.55, playerPos.z);
    target.x += Math.cos(this.yaw) * 0.45;
    target.z -= Math.sin(this.yaw) * 0.45;

    // desired position is computed fresh every frame from the player
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).multiplyScalar(this.distance);
    const desired = target.clone().add(offset);

    if (!this.initialized) {
      this.smoothPos.copy(desired);
      this.initialized = true;
    }
    this.smoothPos.lerp(desired, 1 - Math.exp(-22 * dt));
    // where the camera actually goes: the free position, pulled in along the boom when something is in the way.
    // Pulling in is instant (never see through a wall); letting back out is gradual, so the camera doesn't flicker
    // in and out every frame as the boom grazes a step or a corner.
    const P = this.outPos.copy(this.smoothPos);
    if (this.groundAt) {
      let k = 1;
      const n = this.solidAt ? 20 : 8;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = target.x + (this.smoothPos.x - target.x) * t;
        const z = target.z + (this.smoothPos.z - target.z) * t;
        const y = target.y + (this.smoothPos.y - target.y) * t;
        if (y < this.groundAt(x, z) + 0.45 || (this.solidAt && this.solidAt(x, y, z))) {
          k = Math.max(this.solidAt ? 0.12 : 0.35, (i - 1) / n); // with real solids known, it may come right in
          break;
        }
      }
      this.boomK = k < this.boomK ? k : this.boomK + (k - this.boomK) * (1 - Math.exp(-3.5 * dt));
      P.set(target.x + (this.smoothPos.x - target.x) * this.boomK, target.y + (this.smoothPos.y - target.y) * this.boomK, target.z + (this.smoothPos.z - target.z) * this.boomK);
      P.y = Math.max(P.y, this.groundAt(P.x, P.z) + 0.45);
      // in a cabin: keep under the ceiling
      if (this.ceilAt) P.y = Math.min(P.y, this.ceilAt(P.x, P.z) - 0.25);
    } else this.boomK = 1;

    // Calculate Trauma Shake offset
    if (this.shakeTrauma > 0) {
      this.shakeTime += dt * 45;
      const shakePower = this.shakeTrauma * this.shakeTrauma;
      const shakeOffsetX = (Math.sin(this.shakeTime * 1.3) + (Math.random() - 0.5) * 0.4) * 0.4 * shakePower;
      const shakeOffsetY = (Math.cos(this.shakeTime * 1.7) + (Math.random() - 0.5) * 0.4) * 0.4 * shakePower;
      const shakeOffsetZ = (Math.sin(this.shakeTime * 1.1) + (Math.random() - 0.5) * 0.4) * 0.3 * shakePower;

      this.camera.position.set(
        P.x + shakeOffsetX,
        P.y + shakeOffsetY,
        P.z + shakeOffsetZ
      );
      this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 2.2);
    } else {
      this.camera.position.copy(P);
    }

    this.camera.lookAt(target);

    if (this.baseFov < 0) this.baseFov = this.camera.fov;
    if (Math.abs(this.fovKick) > 0.01 || this.camera.fov !== this.baseFov) {
      this.fovKick = THREE.MathUtils.damp(this.fovKick, 0, 9, dt);
      this.camera.fov = this.baseFov + this.fovKick;
      this.camera.updateProjectionMatrix();
    }
  }

  // forward/right vectors on the ground plane for WASD movement
  getMoveBasis() {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    return { forward, right };
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.resetPointer);
    this.canvas.removeEventListener('mouseleave', this.resetPointer);
    window.removeEventListener('blur', this.resetPointer);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
