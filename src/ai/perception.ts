/**
 * Visual perception: which parts of a target are in line of sight, and how
 * long it takes to recognise it. Pure functions; line of sight is injected so
 * the model can be tested without a physics engine.
 */
import { add, rotateVec, wrapAngle, type Vec3 } from '../core/math';
import type { VehicleDef } from '../data/schema';
import { armorModelFor, hullArmorHalf, turretCentreWorld, type VehiclePose } from '../combat/armorModel';
import { bearing } from './driving';

/** True when the straight segment between two points is unobstructed. */
export type LineOfSight = (from: Vec3, to: Vec3) => boolean;

/** Commander's observation point: just above the turret roof. */
export function eyePoint(def: VehicleDef, pose: VehiclePose): Vec3 {
  const centre = turretCentreWorld(def, armorModelFor(def), pose);
  return add(centre, rotateVec(pose.rot, { x: 0, y: def.turret.half.y + 0.35, z: 0 }));
}

/** Sample points on a vehicle used for visibility checks (turret and hull). */
export function visibilityPoints(def: VehicleDef, pose: VehiclePose): Vec3[] {
  const h = hullArmorHalf(def);
  const centre = turretCentreWorld(def, armorModelFor(def), pose);
  const local = (x: number, y: number, z: number) => add(pose.pos, rotateVec(pose.rot, { x, y, z }));
  return [
    add(centre, rotateVec(pose.rot, { x: 0, y: def.turret.half.y * 0.8, z: 0 })), // turret roof
    centre, // turret
    local(0, h.y * 0.6, 0), // hull top
    local(0, h.y * 0.3, -h.z * 0.8), // hull front
    local(0, h.y * 0.3, h.z * 0.8), // hull rear
  ];
}

export interface ViewParams {
  viewDistance: number;
  /** Field of view (radians); >= 2π means all-round vision. */
  fov: number;
  /** Centre of the field of view (yaw), used when fov < 2π. */
  facing: number;
}

/** The target's sample points that the observer can see (empty if out of range or view). */
export function visiblePoints(eye: Vec3, points: readonly Vec3[], view: ViewParams, los: LineOfSight): Vec3[] {
  if (points.length === 0) return [];
  const ref = points[0];
  if (Math.hypot(ref.x - eye.x, ref.y - eye.y, ref.z - eye.z) > view.viewDistance) return [];
  if (view.fov < Math.PI * 2 && Math.abs(wrapAngle(bearing(eye, ref) - view.facing)) > view.fov / 2) return [];
  return points.filter((p) => los(eye, p));
}

/** Fraction (0..1) of the target's sample points that the observer can see. */
export function visibleFraction(eye: Vec3, points: readonly Vec3[], view: ViewParams, los: LineOfSight): number {
  return points.length === 0 ? 0 : visiblePoints(eye, points, view, los).length / points.length;
}

/** Seconds of full visibility needed to recognise a target at `distance`. */
export function recognitionTime(distance: number, reactionTimeS: number, viewDistance: number): number {
  return reactionTimeS * (0.5 + distance / viewDistance);
}

/**
 * Advances recognition progress (0..1). Partial exposure (hull-down) is
 * recognised more slowly; losing sight decays progress three times slower
 * than it builds.
 */
export function updateRecognition(progress: number, fraction: number, dt: number, recognitionTimeS: number): number {
  if (fraction > 0) return Math.min(1, progress + (dt * (0.4 + 0.6 * fraction)) / recognitionTimeS);
  return Math.max(0, progress - dt / (3 * recognitionTimeS));
}
