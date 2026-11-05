import * as THREE from 'three';

/** World direction for a camera yaw (0 = -Z, + = CCW from above) and pitch (+ = up). */
export function dirFromYawPitch(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

export interface CameraTarget {
  hullPos: THREE.Vector3;
  hullRot: THREE.Quaternion;
  /** World-space gun trunnion. */
  trunnion: THREE.Vector3;
  /** Turret frame orientation in world space. */
  turretRot: THREE.Quaternion;
}
