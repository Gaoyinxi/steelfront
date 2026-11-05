import type { Vec3 } from '../core/math';
import type { AmmoDef, CrewRole, ModuleType } from '../data/schema';
import type { ArmorFace, ArmorPart } from '../combat/armorModel';
import type { PlateResult } from '../combat/penetration';
import type { DestroyCause } from '../components/Modules';
import type { Entity } from '../ecs/World';
import type { Layer } from '../physics/PhysicsWorld';

/** Central event contract between simulation, presentation and HUD. */
export interface GameEvents {
  shotFired: {
    shooter: Entity;
    muzzle: Vec3;
    dir: Vec3;
    ammo: AmmoDef;
  };
  projectileImpact: {
    projectile: Entity;
    shooter: Entity;
    ammo: AmmoDef;
    point: Vec3;
    /** Surface normal at the impact point. */
    normal: Vec3;
    /** Shell velocity at impact. */
    velocity: Vec3;
    /** Path length travelled since leaving the muzzle (m). */
    distance: number;
    /** Vehicle hit, or null for terrain / static geometry. */
    target: Entity | null;
    layer: Layer;
    /** Present when an armour plate of `target` was struck. */
    armor?: {
      part: ArmorPart;
      face: ArmorFace;
      thicknessMm: number;
      /** Path length through the part's interior (m). */
      interiorLength: number;
    };
  };
  hitResolved: {
    shooter: Entity;
    target: Entity;
    ammo: AmmoDef;
    result: PlateResult;
    part: ArmorPart;
    face: ArmorFace;
    thicknessMm: number;
    angleDeg: number;
    effectiveMm: number;
    penetrationMm: number;
    distance: number;
    modules: { type: ModuleType; role?: CrewRole; destroyed: boolean }[];
  };
  vehicleDestroyed: {
    entity: Entity;
    cause: DestroyCause;
    killer: Entity | null;
  };
  matchEnded: {
    result: 'victory' | 'defeat';
  };
}
