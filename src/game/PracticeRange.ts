import { VehicleStatus } from '../components/Modules';
import type { VehicleDef, AmmoDef } from '../data/schema';
import type { Entity } from '../ecs/World';
import type { Simulation } from './Simulation';
import { despawnVehicle, spawnVehicle } from './vehicleFactory';

const RESPAWN_AFTER_S = 10;

/** Keeps a stationary practice target alive: respawns it after it is destroyed. */
export class PracticeRange {
  private target: Entity;

  constructor(
    private readonly sim: Simulation,
    private readonly def: VehicleDef,
    private readonly ammo: ReadonlyMap<string, AmmoDef>,
    private readonly spot: { x: number; z: number; heading: number },
  ) {
    this.target = this.spawn();
  }

  update(): void {
    const status = this.sim.world.get(this.target, VehicleStatus);
    if (status?.destroyed && status.destroyedFor > RESPAWN_AFTER_S) {
      despawnVehicle(this.sim.world, this.sim.physics, this.target);
      this.target = this.spawn();
    }
  }

  private spawn(): Entity {
    return spawnVehicle(this.sim.world, this.sim.physics, this.sim.map.height, {
      def: this.def,
      team: 'B',
      name: 'target-dummy',
      ...this.spot,
      ammo: this.ammo,
    });
  }
}
