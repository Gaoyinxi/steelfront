import * as THREE from 'three';
import { dirFromYawPitch, type CameraTarget } from './aimMath';

/** Gunner's telescopic sight mounted beside the gun in the turret. */
export class GunsightCamera {
  readonly zoomLevels = [24, 12, 6];
  zoomIndex = 0;
  private readonly offset = new THREE.Vector3(0.35, 0.28, -0.3);
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  get fov(): number {
    return this.zoomLevels[this.zoomIndex];
  }

  /** Scroll up (negative wheel) zooms in. */
  zoom(steps: number): void {
    this.zoomIndex = THREE.MathUtils.clamp(this.zoomIndex - steps, 0, this.zoomLevels.length - 1);
  }

  apply(cam: THREE.PerspectiveCamera, yaw: number, pitch: number, target: CameraTarget): void {
    this.tmp.copy(this.offset).applyQuaternion(target.turretRot);
    cam.position.copy(target.trunnion).add(this.tmp);
    dirFromYawPitch(yaw, pitch, this.dir);
    cam.lookAt(cam.position.x + this.dir.x, cam.position.y + this.dir.y, cam.position.z + this.dir.z);
    if (cam.fov !== this.fov) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
