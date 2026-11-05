/**
 * Low-level driving controller: converts "go to this point" into throttle and
 * steering for a skid-steered tank, forwards or in reverse. Pure function.
 */
import { clamp, rotateVec, wrapAngle, type Quat, type Vec3 } from '../core/math';
import { steeringInverted } from '../systems/MobilitySystem';

export interface DriveOptions {
  /** Distance at which the target counts as reached (m). */
  arriveRadius: number;
  /** Start slowing down within this distance of the target (m). */
  slowRadius: number;
  /** Throttle cap, 0..1. */
  maxThrottle: number;
  /** Drive backwards (keeps the frontal armour towards a threat). */
  reverse?: boolean;
}

export interface DriveCommand {
  throttle: number;
  steer: number;
  arrived: boolean;
  /** Remaining straight-line distance (m). */
  distance: number;
}

/** Above this heading error the tank stops and pivots in place. */
const PIVOT_ANGLE = (45 * Math.PI) / 180;
const STEER_GAIN = 2.5;

/** Hull heading (yaw, radians; 0 = facing -Z, + = counter-clockwise from above). */
export function headingOf(rot: Quat): number {
  const f = rotateVec(rot, { x: 0, y: 0, z: -1 });
  return Math.atan2(-f.x, -f.z);
}

/** Yaw of the direction from `from` to `to`. */
export function bearing(from: Vec3, to: Vec3): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

export function driveTo(
  pose: { pos: Vec3; rot: Quat },
  forwardSpeed: number,
  target: Vec3,
  o: DriveOptions,
): DriveCommand {
  const distance = Math.hypot(target.x - pose.pos.x, target.z - pose.pos.z);
  if (distance <= o.arriveRadius) return { throttle: 0, steer: 0, arrived: true, distance };

  // Reference direction: the nose when driving forwards, the tail in reverse.
  const reference = headingOf(pose.rot) + (o.reverse ? Math.PI : 0);
  const err = wrapAngle(bearing(pose.pos, target) - reference);

  if (Math.abs(err) > PIVOT_ANGLE) {
    // Pivot in place. With zero throttle steering is never inverted:
    // positive steer turns clockwise (negative yaw).
    return { throttle: 0, steer: err > 0 ? -1 : 1, arrived: false, distance };
  }

  const align = 1 - (0.7 * Math.abs(err)) / PIVOT_ANGLE;
  const approach = Math.min(1, distance / o.slowRadius);
  const magnitude = Math.max(0.15, o.maxThrottle * align * approach);
  const throttle = o.reverse ? -magnitude : magnitude;
  // A positive yaw error needs a counter-clockwise turn: negative steer, or
  // positive steer once the running gear inverts steering in reverse.
  const sign = steeringInverted(forwardSpeed, throttle) ? 1 : -1;
  return { throttle, steer: clamp(sign * STEER_GAIN * err, -1, 1), arrived: false, distance };
}
