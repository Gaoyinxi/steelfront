import { defineComponent, type Entity } from '../ecs/World';
import type { Vec3 } from '../core/math';
import type { AmmoDef } from '../data/schema';

/** A shell in flight. Projectiles are swept analytically, not simulated as rigid bodies. */
export interface Projectile {
  ammo: AmmoDef;
  shooter: Entity;
  pos: Vec3;
  vel: Vec3;
  /** Position at the previous tick (render interpolation, tracer tail). */
  prevPos: Vec3;
  /** Path length travelled (m). */
  travelled: number;
  /** Seconds since firing. */
  age: number;
}

export const Projectile = defineComponent<Projectile>('Projectile');
