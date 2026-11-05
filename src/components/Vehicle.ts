import { defineComponent } from '../ecs/World';
import type { VehicleDef } from '../data/schema';

export type TeamId = 'A' | 'B';

/** Static identity of a vehicle entity. */
export interface Vehicle {
  def: VehicleDef;
  team: TeamId;
  name: string;
}

export const Vehicle = defineComponent<Vehicle>('Vehicle');

/** Tag: entity is driven by the local player. */
export const PlayerControlled = defineComponent<Record<string, never>>('PlayerControlled');
