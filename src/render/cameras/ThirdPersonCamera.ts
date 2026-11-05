import * as THREE from 'three';
import type { HeightMap } from '../../world/HeightMap';
import { dirFromYawPitch, type CameraTarget } from './aimMath';

/** Orbit camera behind the vehicle; the screen centre is the aim direction. */
export class ThirdPersonCamera {
  distance = 13;
  readonly minDistance = 6;
  readonly maxDistance = 30;
  readonly fov = 60;
  private readonly dir = new THREE.Vector3();
  private readonly pivot = new THREE.Vector3();

  zoom(steps: number): void {
    this.distance = THREE.MathUtils.clamp(this.distance * Math.pow(1.15, steps), this.minDistance, this.maxDistance);
  }

  apply(cam: THREE.PerspectiveCamera, yaw: number, pitch: number, target: CameraTarget, terrain: HeightMap): void {
    dirFromYawPitch(yaw, pitch, this.dir);
    this.pivot.copy(target.hullPos).y += 2.6;
    cam.position.copy(this.pivot).addScaledVector(this.dir, -this.distance);
    cam.position.y += this.distance * 0.08;
    const floor = terrain.sample(cam.position.x, cam.position.z) + 1.2;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(cam.position.x + this.dir.x, cam.position.y + this.dir.y, cam.position.z + this.dir.z);
    if (cam.fov !== this.fov) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
