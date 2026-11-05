import { defineComponent } from '../ecs/World';
import type { Vec3 } from '../core/math';

/**
 * The single, serializable control contract shared by the local player,
 * AI agents and (later) network peers. Simulation systems read only this.
 */
export interface ControlIntent {
  /** -1 (full reverse) .. 1 (full forward). */
  throttle: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  /** World-space point the gunner wants the gun to point at; null = hold. */
  aimPoint: Vec3 | null;
  /** True on the tick the trigger is held. */
  fire: boolean;
  /** Requested ammo slot (index into gun.ammo); applied after the current reload. */
  ammoSlot: number;
}

export const ControlIntent = defineComponent<ControlIntent>('ControlIntent');

export const makeIntent = (): ControlIntent => ({
  throttle: 0,
  steer: 0,
  aimPoint: null,
  fire: false,
  ammoSlot: 0,
});
