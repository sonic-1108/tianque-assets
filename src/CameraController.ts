import * as THREE from 'three';

export class CameraController {
  yaw = 0; // radians, absolute
  pitch = 0.28; // radians, absolute
  distance = 4.6;
  /** terrain height under a point, so the camera never sinks into a slope */
  groundAt: ((x: number, z: number) => number) | null = null;
  pendingDX = 0;
  pendingDY = 0;
  private sensitivity = 0.0025;
  private smoothPos = new THREE.Vector3();
  private initialized = false;
  private onMouseMove: (e: MouseEvent) => void;
  private onWheel: (e: WheelEvent) => void;

  // Camera Trauma & Shake
  private shakeTrauma = 0;
  private shakeTime = 0;

  constructor(private camera: THREE.PerspectiveCamera, private canvas: HTMLCanvasElement) {
    this.onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.pendingDX += e.movementX;
      this.pendingDY += e.movementY;
    };
    this.onWheel = (e: WheelEvent) => {
      this.distance = THREE.MathUtils.clamp(this.distance + e.deltaY * 0.004, 2.6, 9);
    };

    document.addEventListener('mousemove', this.onMouseMove);
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
    this.shakeTrauma = Math.min(1.0, this.shakeTrauma + amount);
  }

  update(playerPos: THREE.Vector3, dt: number) {
    // consume mouse input ONCE, then reset it
    this.yaw -= this.pendingDX * this.sensitivity;
    this.pitch += this.pendingDY * this.sensitivity;
    this.pendingDX = 0;
    this.pendingDY = 0;
    this.pitch = THREE.MathUtils.clamp(this.pitch, 0.05, 1.15);

    // Look slightly over the right shoulder so the character sits left of the crosshair
    const target = playerPos.clone().add(new THREE.Vector3(0, 1.55, 0));
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
    if (this.groundAt) {
      // walk the boom from the player outward: if a slope is in the way, pull the camera in front of it
      const n = 8;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const x = target.x + (this.smoothPos.x - target.x) * t;
        const z = target.z + (this.smoothPos.z - target.z) * t;
        const y = target.y + (this.smoothPos.y - target.y) * t;
        const g = this.groundAt(x, z) + 0.45;
        if (y < g) {
          const keep = Math.max(0.35, (i - 1) / n);
          this.smoothPos.set(target.x + (this.smoothPos.x - target.x) * keep, Math.max(g, target.y + (this.smoothPos.y - target.y) * keep), target.z + (this.smoothPos.z - target.z) * keep);
          break;
        }
      }
      this.smoothPos.y = Math.max(this.smoothPos.y, this.groundAt(this.smoothPos.x, this.smoothPos.z) + 0.45);
    }

    // Calculate Trauma Shake offset
    if (this.shakeTrauma > 0) {
      this.shakeTime += dt * 45;
      const shakePower = this.shakeTrauma * this.shakeTrauma;
      const shakeOffsetX = (Math.sin(this.shakeTime * 1.3) + (Math.random() - 0.5) * 0.4) * 0.4 * shakePower;
      const shakeOffsetY = (Math.cos(this.shakeTime * 1.7) + (Math.random() - 0.5) * 0.4) * 0.4 * shakePower;
      const shakeOffsetZ = (Math.sin(this.shakeTime * 1.1) + (Math.random() - 0.5) * 0.4) * 0.3 * shakePower;

      this.camera.position.set(
        this.smoothPos.x + shakeOffsetX,
        this.smoothPos.y + shakeOffsetY,
        this.smoothPos.z + shakeOffsetZ
      );
      this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 2.2);
    } else {
      this.camera.position.copy(this.smoothPos);
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
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
