import { defineComponent } from '../ecs/World';

/** Turret yaw relative to the hull (radians, 0 = forward, + = counter-clockwise from above). */
export interface Turret {
  yaw: number;
  prevYaw: number;
  /** 0..1 traverse multiplier (turret ring damage, missing gunner). */
  traverseFactor: number;
}

export const Turret = defineComponent<Turret>('Turret');
