import { defineComponent } from '../ecs/World';
import type { Vec3 } from '../core/math';

/**
 * Where the local player is looking, written by the camera rig every render
 * frame and consumed by PlayerInputSystem on the next tick. This is the only
 * render -> simulation data path, and it is semantically player input.
 */
export interface PlayerAim {
  origin: Vec3;
  dir: Vec3;
}
export const PlayerAim = defineComponent<PlayerAim>('PlayerAim');

/** Digital driving / weapon controls sampled from the input device. */
export interface PlayerControls {
  throttle: number;
  steer: number;
  fire: boolean;
  ammoSlot: number;
}
export const PlayerControls = defineComponent<PlayerControls>('PlayerControls');
