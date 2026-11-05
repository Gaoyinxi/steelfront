import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/Rng';
import type { ModuleDamage } from '../combat/damage';
import { Gun } from '../components/Gun';
import { DAMAGED_THRESHOLD, MIN_CREW, Modules, VehicleStatus, type DestroyCause } from '../components/Modules';
import { TrackedMobility } from '../components/TrackedMobility';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import type { CrewRole, ModuleDef } from '../data/schema';
import type { System } from '../ecs/System';
import type { Entity, World } from '../ecs/World';
import type { GameEvents } from '../game/events';

export interface AppliedDamage {
  /** Module indices destroyed by this application. */
  newlyDestroyed: number[];
  detonated: boolean;
}

/**
 * Applies module damage and rolls ammunition detonation for racks destroyed
 * by it. Kept separate from per-tick effects so hit resolution and future
 * damage sources (fire, artillery) share one entry point.
 */
export function applyModuleDamage(world: World, e: Entity, damage: ModuleDamage[], rng: Rng): AppliedDamage {
  const def = world.req(e, Vehicle).def;
  const states = world.req(e, Modules).states;
  const result: AppliedDamage = { newlyDestroyed: [], detonated: false };
  for (const d of damage) {
    const s = states[d.index];
    if (s.destroyed) continue;
    s.hp = Math.max(0, s.hp - d.damage);
    if (s.hp === 0) {
      s.destroyed = true;
      result.newlyDestroyed.push(d.index);
      const m = def.modules[d.index];
      if (m.type === 'ammoRack' && rng.chance(m.detonationChance)) result.detonated = true;
    }
  }
  return result;
}

/**
 * Derives functional state from module health every tick:
 *
 * | Module        | Damaged (< 50 % HP)     | Destroyed                 |
 * |---------------|-------------------------|---------------------------|
 * | engine        | power × 0.5             | no power                  |
 * | transmission  | power × 0.7             | no power                  |
 * | turretRing    | traverse × 0.5          | turret jammed             |
 * | gunBreech     | reload × 1.3            | gun cannot fire           |
 * | ammoRack      | –                       | detonation roll (on hit)  |
 * | driver        | –                       | cannot drive              |
 * | gunner        | –                       | cannot fire               |
 * | loader        | –                       | reload × 2                |
 * | crew (total)  | –                       | < 2 alive: knocked out    |
 */
export class ModuleEffectSystem implements System {
  readonly name = 'ModuleEffects';

  constructor(private readonly events: EventBus<GameEvents>) {}

  fixedUpdate(world: World, dt: number): void {
    for (const e of world.query(Vehicle, Modules, VehicleStatus)) {
      const def = world.req(e, Vehicle).def;
      const states = world.req(e, Modules).states;
      const status = world.req(e, VehicleStatus);
      const mob = world.get(e, TrackedMobility);
      const turret = world.get(e, Turret);
      const gun = world.get(e, Gun);

      if (status.destroyed) {
        status.destroyedFor += dt;
        disable(mob, turret, gun);
        continue;
      }

      let power = 1;
      let traverse = 1;
      let reload = 1;
      let canFire = true;
      const deadCrew = new Set<CrewRole>();
      let crewAlive = 0;

      def.modules.forEach((m: ModuleDef, i) => {
        const s = states[i];
        const damaged = !s.destroyed && s.hp < s.maxHp * DAMAGED_THRESHOLD;
        switch (m.type) {
          case 'engine':
            power *= s.destroyed ? 0 : damaged ? 0.5 : 1;
            break;
          case 'transmission':
            power *= s.destroyed ? 0 : damaged ? 0.7 : 1;
            break;
          case 'turretRing':
            traverse *= s.destroyed ? 0 : damaged ? 0.5 : 1;
            break;
          case 'gunBreech':
            if (s.destroyed) canFire = false;
            else if (damaged) reload *= 1.3;
            break;
          case 'crew':
            if (s.destroyed && m.role) deadCrew.add(m.role);
            else crewAlive++;
            break;
          default:
            break; // ammoRack handled on hit; fuelTank reserved for a fire system
        }
      });

      if (deadCrew.has('gunner')) canFire = false;
      if (deadCrew.has('loader')) reload *= 2;

      if (crewAlive < MIN_CREW) {
        this.destroy(e, status, 'crewLoss');
        disable(mob, turret, gun);
        continue;
      }

      if (mob) {
        mob.powerFactor = power;
        mob.canDrive = !deadCrew.has('driver');
      }
      if (turret) turret.traverseFactor = traverse;
      if (gun) {
        gun.reloadMultiplier = reload;
        gun.canFire = canFire;
      }
    }
  }

  /** Marks a vehicle destroyed (idempotent) and announces it. */
  destroy(e: Entity, status: VehicleStatus, cause: DestroyCause): void {
    if (status.destroyed) return;
    status.destroyed = true;
    status.cause = cause;
    status.destroyedFor = 0;
    this.events.emit('vehicleDestroyed', { entity: e, cause, killer: status.lastAttacker });
  }
}

function disable(mob?: TrackedMobility, turret?: Turret, gun?: Gun): void {
  if (mob) {
    mob.powerFactor = 0;
    mob.canDrive = false;
  }
  if (turret) turret.traverseFactor = 0;
  if (gun) gun.canFire = false;
}
