/**
 * Derived vehicle geometry shared by simulation and rendering.
 * All results are in the hull body frame (+X right, +Y up, -Z forward)
 * unless stated otherwise.
 */
import { add, rotateVec, type Quat, type Vec3 } from '../core/math';
import type { VehicleDef } from '../data/schema';

/** Lowered centre of mass relative to the hull box centre. */
export const comOffset = (def: VehicleDef): Vec3 => ({ x: 0, y: -def.hull.half.y * 0.45, z: 0 });

/** Suspension mount points: [side][index], side 0 = left (-X), 1 = right (+X), index 0 = front. */
export function wheelMounts(def: VehicleDef): Vec3[][] {
  const n = def.mobility.suspension.wheelsPerSide;
  const halfW = def.mobility.trackWidth / 2;
  const halfL = def.mobility.trackLength / 2;
  const y = -def.hull.half.y;
  const sides: Vec3[][] = [[], []];
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      sides[s].push({ x: s === 0 ? -halfW : halfW, y, z: -halfL + 2 * halfL * t });
    }
  }
  return sides;
}

/** Yaw rotation about +Y as a quaternion. */
export const yawQuat = (yaw: number): Quat => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });

/** Direction of the barrel in the hull frame for given turret yaw / gun pitch. */
export function barrelDirLocal(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Gun trunnion (pivot) in the hull frame. */
export function trunnionLocal(def: VehicleDef, yaw: number): Vec3 {
  return add(def.turret.offset, rotateVec(yawQuat(yaw), def.gun.offset));
}

export interface GunPose {
  trunnion: Vec3;
  muzzle: Vec3;
  dir: Vec3;
}

/** World-space gun pose from a hull pose and turret/gun angles. */
export function gunPoseWorld(def: VehicleDef, pos: Vec3, rot: Quat, yaw: number, pitch: number): GunPose {
  const trunnion = add(pos, rotateVec(rot, trunnionLocal(def, yaw)));
  const dir = rotateVec(rot, barrelDirLocal(yaw, pitch));
  const muzzle = add(trunnion, {
    x: dir.x * def.gun.length,
    y: dir.y * def.gun.length,
    z: dir.z * def.gun.length,
  });
  return { trunnion, muzzle, dir };
}
