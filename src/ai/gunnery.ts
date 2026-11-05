/**
 * AI gunnery: ballistic firing solutions with lead and drop compensation, and
 * the human-like error model (aim error that settles over time, range and
 * speed estimation errors). Pure functions.
 */
import { add, clamp, cross, dot, normalize, scale, type Vec3 } from '../core/math';
import type { AmmoDef } from '../data/schema';
import { solveFiringSolution } from '../combat/ballistics';
import { bearing } from './driving';

export interface GunneryInput {
  /** Gun trunnion (world). */
  origin: Vec3;
  /** Point on the target to aim at (world). */
  target: Vec3;
  /** Estimated target velocity (world, m/s). */
  targetVelocity: Vec3;
  ammo: AmmoDef;
  /** Relative range estimation error (0.05 = gunner estimates 5 % long). */
  rangeError?: number;
  /** Multiplier on the lead (1 = exact speed estimate). */
  leadScale?: number;
}

export interface GunnerySolution {
  /** Unit barrel direction that hits the predicted position. */
  direction: Vec3;
  /** World point along `direction` at the target's distance (feed to ControlIntent.aimPoint). */
  aimPoint: Vec3;
  /** Elevation above horizontal (radians). */
  elevation: number;
  /** Azimuth (yaw convention: 0 = -Z, + = counter-clockwise). */
  azimuth: number;
  timeOfFlight: number;
  /** Horizontal distance to the predicted impact point (m). */
  range: number;
  /** Where the target is expected to be when the shell arrives. */
  predicted: Vec3;
}

/** Direction vector for an azimuth (yaw) and elevation. */
export function directionFrom(azimuth: number, elevation: number): Vec3 {
  const c = Math.cos(elevation);
  return { x: -Math.sin(azimuth) * c, y: Math.sin(elevation), z: -Math.cos(azimuth) * c };
}

/**
 * Iteratively solves for elevation and lead: time of flight depends on the
 * range to the predicted position, which depends on time of flight. Three
 * iterations converge to millimetres for tank-speed targets.
 */
export function computeFiringSolution(i: GunneryInput, iterations = 3): GunnerySolution | null {
  const rangeError = i.rangeError ?? 0;
  const leadScale = i.leadScale ?? 1;
  let predicted = i.target;
  let tof = 0;
  let elevation = 0;
  for (let k = 0; k < iterations; k++) {
    const dx = Math.hypot(predicted.x - i.origin.x, predicted.z - i.origin.z);
    const dy = predicted.y - i.origin.y;
    const s = solveFiringSolution(i.ammo.muzzleVelocity, dx * (1 + rangeError), dy, i.ammo.dragK, {
      dt: 1 / 60,
      iterations: 22,
    });
    if (!s) return null;
    tof = s.timeOfFlight;
    elevation = s.elevation;
    predicted = add(i.target, scale(i.targetVelocity, tof * leadScale));
  }
  const azimuth = bearing(i.origin, predicted);
  const direction = directionFrom(azimuth, elevation);
  const range = Math.hypot(predicted.x - i.origin.x, predicted.z - i.origin.z);
  return {
    direction,
    aimPoint: add(i.origin, scale(direction, range / Math.max(Math.cos(elevation), 0.05))),
    elevation,
    azimuth,
    timeOfFlight: tof,
    range,
    predicted,
  };
}

/** Rotates a direction by small yaw / pitch offsets (radians). */
export function perturbDirection(dir: Vec3, yaw: number, pitch: number): Vec3 {
  const d = normalize(dir);
  const helper = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalize(cross(d, helper));
  const up = cross(right, d);
  return normalize(add(d, add(scale(right, Math.tan(yaw)), scale(up, Math.tan(pitch)))));
}

/** Angle between two directions (radians). */
export function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(clamp(dot(normalize(a), normalize(b)), -1, 1));
}

export interface AimErrorFactors {
  /** Settled 1-sigma error (mrad). */
  baseMrad: number;
  /** Seconds spent tracking this target. */
  aimTime: number;
  settleTimeS: number;
  targetSpeed: number;
  ownSpeed: number;
  /** Shots already fired at this target (bracketing improves accuracy). */
  shotsAtTarget: number;
}

/**
 * 1-sigma angular aiming error (radians). Starts at 3x the settled value and
 * decays with time on target; a moving target or own movement makes it worse;
 * each previous shot at the same target (observed fall of shot) improves it.
 */
export function aimErrorSigma(f: AimErrorFactors): number {
  const settle = 1 + 2 * Math.exp(-f.aimTime / f.settleTimeS);
  const motion = (1 + 0.04 * f.targetSpeed) * (1 + 0.15 * f.ownSpeed);
  const bracketing = Math.max(0.5, Math.pow(0.8, f.shotsAtTarget));
  return (f.baseMrad / 1000) * settle * motion * bracketing;
}
