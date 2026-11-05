import { defineComponent, type Entity } from '../ecs/World';

export interface ModuleState {
  hp: number;
  maxHp: number;
  destroyed: boolean;
}

/** Runtime health of every internal module, index-aligned with VehicleDef.modules. */
export interface Modules {
  states: ModuleState[];
}
export const Modules = defineComponent<Modules>('Modules');

export type DestroyCause = 'ammoDetonation' | 'crewLoss';

/** Overall combat status of a vehicle. */
export interface VehicleStatus {
  destroyed: boolean;
  cause: DestroyCause | null;
  /** Last entity that damaged this vehicle (kill credit). */
  lastAttacker: Entity | null;
  /** Seconds since destruction (presentation, respawn timers). */
  destroyedFor: number;
}
export const VehicleStatus = defineComponent<VehicleStatus>('VehicleStatus');

/** Below this fraction of max HP a module counts as damaged (degraded function). */
export const DAMAGED_THRESHOLD = 0.5;
/** Vehicle is knocked out when fewer than this many crew remain. */
export const MIN_CREW = 2;
