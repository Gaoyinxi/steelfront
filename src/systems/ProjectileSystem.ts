import { copyVec3, distance, normalize, sub } from '../core/math';
import type { EventBus } from '../core/EventBus';
import { stepShell } from '../combat/ballistics';
import { rayVsVehicle } from '../combat/armorModel';
import { Projectile } from '../components/Projectile';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import type { System } from '../ecs/System';
import type { Entity, World } from '../ecs/World';
import type { GameEvents } from '../game/events';
import { Layer, type PhysicsWorld } from '../physics/PhysicsWorld';
import type { HeightMap } from '../world/HeightMap';

/** Time during which a shell ignores `Projectile.ignore` (own vehicle, ricochet source). */
const IGNORE_S = 0.1;
const MAX_LIFETIME_S = 12;

/**
 * Integrates shells with the pure ballistics model and sweeps each step's
 * segment, so fast shells (> 10 m per tick) never tunnel through thin plates
 * or walls. Terrain and structures are tested through the physics world;
 * vehicles are tested against their geometric armour model (plates with
 * slopes), not their physics colliders.
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

    const vehicles = world.query(Vehicle, Transform, Turret);

    for (const e of projectiles) {
      const p = world.req(e, Projectile);
      copyVec3(p.prevPos, p.pos);
      const next = stepShell({ pos: p.pos, vel: p.vel }, dt, p.ammo.dragK);
      const seg = sub(next.pos, p.pos);
      const segLen = Math.hypot(seg.x, seg.y, seg.z);
      if (segLen === 0) continue;
      const dir = normalize(seg);

      // Nearest hit among world geometry and vehicle armour.
      const worldHit = this.physics.raycast(p.pos, dir, segLen, { layers: Layer.Terrain | Layer.Static });
      let best: { t: number; vehicle: Entity | null } = { t: worldHit ? worldHit.distance : Infinity, vehicle: null };
      let armorHit: ReturnType<typeof rayVsVehicle> = null;
      for (const v of vehicles) {
        if (v === p.ignore && p.age < IGNORE_S) continue;
        const tf = world.req(v, Transform);
        const hit = rayVsVehicle(
          world.req(v, Vehicle).def,
          { pos: tf.pos, rot: tf.rot, turretYaw: world.req(v, Turret).yaw },
          p.pos,
          dir,
          Math.min(segLen, best.t),
        );
        if (hit && hit.t < best.t) {
          best = { t: hit.t, vehicle: v };
          armorHit = hit;
        }
      }

      if (best.t !== Infinity) {
        const f = best.t / segLen;
        const velocity = {
          x: p.vel.x + (next.vel.x - p.vel.x) * f,
          y: p.vel.y + (next.vel.y - p.vel.y) * f,
          z: p.vel.z + (next.vel.z - p.vel.z) * f,
        };
        const point = armorHit && best.vehicle !== null ? armorHit.point : worldHit!.point;
        const normal = armorHit && best.vehicle !== null ? armorHit.normal : worldHit!.normal;
        p.travelled += best.t;
        copyVec3(p.pos, point);
        this.events.emit('projectileImpact', {
          projectile: e,
          shooter: p.shooter,
          ammo: p.ammo,
          point,
          normal,
          velocity,
          distance: p.travelled,
          target: best.vehicle,
          layer: best.vehicle !== null ? Layer.Vehicle : worldHit!.layer,
          armor:
            armorHit && best.vehicle !== null
              ? {
                  part: armorHit.part,
                  face: armorHit.face,
                  thicknessMm: armorHit.plate.mm,
                  interiorLength: armorHit.interiorLength,
                }
              : undefined,
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
