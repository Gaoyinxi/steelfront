import { defineComponent } from '../ecs/World';

export interface WheelState {
  /** Current spring compression in metres (0 = fully extended / airborne). */
  compression: number;
  grounded: boolean;
}

/**
 * Runtime state of a tracked running gear. Static parameters live in the
 * VehicleDef; this holds what changes during play (damage factors, contacts).
 */
export interface TrackedMobility {
  /** 0..1 engine output multiplier (engine / transmission damage). */
  powerFactor: number;
  /** False when the driver is incapacitated: no throttle or steering input. */
  canDrive: boolean;
  /** Per-side wheel states, index 0 = front. */
  left: WheelState[];
  right: WheelState[];
  /** Signed forward speed in m/s (positive = forward). */
  forwardSpeed: number;
  /** Ground speed of each track [left, right] (m/s, + forward); drives track/wheel animation. */
  trackSpeed: [number, number];
  /** Integral brake-hold force per side [left, right] (N), used when a track is commanded to stop. */
  brakeHold: [number, number];
  /** Integral lateral hold per side [left, right] (N): stops sideways creep on side slopes at low speed. */
  lateralHold: [number, number];
  /** Derived suspension constants (computed at spawn). */
  springK: number;
  damperC: number;
  restLength: number;
}

export const TrackedMobility = defineComponent<TrackedMobility>('TrackedMobility');
