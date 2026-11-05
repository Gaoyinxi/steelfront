import { defineComponent } from '../ecs/World';
import type { AmmoDef } from '../data/schema';

export interface AmmoStowage {
  def: AmmoDef;
  /** Rounds in the racks; excludes the round currently in the breech. */
  count: number;
}

/** Gun elevation relative to the turret (radians, + = up) and fire-control state. */
export interface Gun {
  pitch: number;
  prevPitch: number;
  /** 0..1 elevation-drive multiplier. */
  elevationFactor: number;

  /** Ammunition carried, indexed by slot (order from the vehicle definition). */
  ammo: AmmoStowage[];
  /** Slot of the round currently in the breech, or null when empty / reloading. */
  loadedSlot: number | null;
  /** Slot of the round being loaded. */
  loadingSlot: number;
  /** Seconds until the breech is loaded; 0 when loaded. */
  reloadRemaining: number;
  /** Reload duration of the reload in progress (for progress display). */
  reloadDuration: number;
  /** Multiplier on reload time (> 1 slower, e.g. loader incapacitated). */
  reloadMultiplier: number;
  /** False when the gun cannot fire (breech destroyed, no gunner). */
  canFire: boolean;
}

export const Gun = defineComponent<Gun>('Gun');
