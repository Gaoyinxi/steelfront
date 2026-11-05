import * as THREE from 'three';
import { DEG2RAD } from '../../core/math';
import type { HeightMap } from '../../world/HeightMap';
import { dirFromYawPitch, type CameraTarget } from './aimMath';
import { GunsightCamera } from './GunsightCamera';
import { ThirdPersonCamera } from './ThirdPersonCamera';

export type CameraMode = 'third' | 'sight';

export interface CameraInput {
  dx: number;
  dy: number;
  wheel: number;
  sightHeld: boolean;
}

/**
 * Owns the player's view direction (world yaw/pitch, independent of hull and
 * turret) and switches between third-person and gunsight presentation.
 */
export class CameraRig {
  mode: CameraMode = 'third';
  yaw = 0;
  pitch = -0.05;
  sensitivity = 0.0022;
  readonly third = new ThirdPersonCamera();
  readonly sight = new GunsightCamera();
  private readonly dir = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  update(input: CameraInput, target: CameraTarget, terrain: HeightMap): void {
    this.mode = input.sightHeld ? 'sight' : 'third';
    // Scale look speed with field of view so the sight stays controllable.
    const fovScale = this.mode === 'sight' ? this.sight.fov / this.third.fov : 1;
    this.yaw -= input.dx * this.sensitivity * fovScale;
    this.pitch -= input.dy * this.sensitivity * fovScale;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -50 * DEG2RAD, 60 * DEG2RAD);
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));

    if (this.mode === 'sight') {
      if (input.wheel) this.sight.zoom(input.wheel);
      this.sight.apply(this.camera, this.yaw, this.pitch, target);
    } else {
      if (input.wheel) this.third.zoom(input.wheel);
      this.third.apply(this.camera, this.yaw, this.pitch, target, terrain);
    }
  }

  /** Aim ray in world space (camera position, view direction). */
  aimRay(): { origin: THREE.Vector3; dir: THREE.Vector3 } {
    return { origin: this.camera.position.clone(), dir: dirFromYawPitch(this.yaw, this.pitch, this.dir).clone() };
  }
}
