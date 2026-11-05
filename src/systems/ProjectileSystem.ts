import { copyVec3, distance, normalize, sub } from '../core/math';
import type { EventBus } from '../core/EventBus';
import { stepShell } from '../combat/ballistics';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { Projectile } from '../components/Projectile';
import type { System } from '../ecs/System';
import type { Entity, World } from '../ecs/World';
import type { GameEvents } from '../game/events';
import type { BodyId, PhysicsWorld } from '../physics/PhysicsWorld';
import type { HeightMap } from '../world/HeightMap';

/** Time during which a shell ignores its own vehicle (leaving the muzzle). */
const SELF_IGNORE_S = 0.1;
const MAX_LIFETIME_S = 12;

/**
 * Integrates shells with the pure ballistics model and sweeps each step's
 * segment against the physics world, so fast shells (> 10 m per tick) never
 * tunnel through thin plates or walls.
 */
export class ProjectileSystem implements System {
  readonly name = 'Projectile';

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly terrain: HeightMap,
    private readonly events: EventBus<GameEvents>,
  ) {}

  fixedUpdate(world: World, dt: number): void {
    const projectiles = world.query(Projectile);
    if (projectiles.length === 0) return;

    const bodyOwner = new Map<BodyId, Entity>();
    for (const e of world.query(PhysicsBodyRef)) bodyOwner.set(world.req(e, PhysicsBodyRef).bodyId, e);

    for (const e of projectiles) {
      const p = world.req(e, Projectile);
      copyVec3(p.prevPos, p.pos);
      const next = stepShell({ pos: p.pos, vel: p.vel }, dt, p.ammo.dragK);
      const seg = sub(next.pos, p.pos);
      const segLen = Math.hypot(seg.x, seg.y, seg.z);
      const shooterBody = world.get(p.shooter, PhysicsBodyRef)?.bodyId;

      const hit =
        segLen > 0
          ? this.physics.raycast(p.pos, normalize(seg), segLen, {
              excludeBody: p.age < SELF_IGNORE_S ? shooterBody : undefined,
            })
          : null;

      if (hit) {
        const f = hit.distance / segLen;
        const velocity = {
          x: p.vel.x + (next.vel.x - p.vel.x) * f,
          y: p.vel.y + (next.vel.y - p.vel.y) * f,
          z: p.vel.z + (next.vel.z - p.vel.z) * f,
        };
        p.travelled += hit.distance;
        copyVec3(p.pos, hit.point);
        this.events.emit('projectileImpact', {
          projectile: e,
          shooter: p.shooter,
          ammo: p.ammo,
          point: hit.point,
          normal: hit.normal,
          velocity,
          distance: p.travelled,
          target: hit.bodyId !== null ? (bodyOwner.get(hit.bodyId) ?? null) : null,
          layer: hit.layer,
        });
        world.destroy(e);
        continue;
      }

      p.travelled += distance(p.pos, next.pos);
      copyVec3(p.pos, next.pos);
      copyVec3(p.vel, next.vel);
      p.age += dt;

      const outOfWorld = !this.terrain.contains(p.pos.x, p.pos.z) || p.pos.y < this.terrain.minHeight - 50;
      if (p.age > MAX_LIFETIME_S || outOfWorld) world.destroy(e);
    }
  }
}
