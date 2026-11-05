import type { Vec3 } from '../core/math';
import type { AmmoDef } from '../data/schema';
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
  };
}
