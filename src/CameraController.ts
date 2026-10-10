import * as THREE from 'three';

export class CameraController {
  yaw = 0; // radians, absolute
  pitch = 0.28; // radians, absolute
  distance = 4.6;
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
