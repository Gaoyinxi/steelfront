import type { Vec3 } from '../core/math';

/** Kinematic state of a shell in flight. */
export interface ShellState {
  pos: Vec3;
  vel: Vec3;
}

export const GRAVITY = 9.81;
