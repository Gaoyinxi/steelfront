import { add, scale } from '../core/math';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/Rng';
import { applyDispersion } from '../combat/ballistics';
import { ControlIntent } from '../components/ControlIntent';
import { Gun } from '../components/Gun';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { Projectile } from '../components/Projectile';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import type { System } from '../ecs/System';
import type { World } from '../ecs/World';
import type { GameEvents } from '../game/events';
import { gunPoseWorld } from '../game/vehicleGeometry';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/**
 * Reloading, ammunition selection and firing.
 *
 * Ammo selection rules:
 *  - Selecting another slot while loaded unloads and starts a fresh reload.
 *  - Selecting another slot while reloading switches the round being loaded
 *    without resetting the timer.
 */
export class FireControlSystem implements System {
  readonly name = 'FireControl';

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly events: EventBus<GameEvents>,
    private readonly rng: Rng,
  ) {}

  fixedUpdate(world: World, dt: number): void {
    for (const e of world.query(Vehicle, Gun, Turret, Transform, ControlIntent)) {
      const def = world.req(e, Vehicle).def;
      const gun = world.req(e, Gun);
      const intent = world.req(e, ControlIntent);

      // --- Ammo selection --------------------------------------------------
      const wanted = intent.ammoSlot;
      if (wanted >= 0 && wanted < gun.ammo.length) {
        if (gun.loadedSlot !== null && gun.loadedSlot !== wanted && gun.ammo[wanted].count > 0) {
          gun.ammo[gun.loadedSlot].count++; // round returned to the rack
          gun.loadedSlot = null;
          this.beginReload(gun, wanted, def.gun.reloadTimeS);
        } else if (gun.loadedSlot === null) {
          gun.loadingSlot = wanted;
        }
      }

      // --- Reload ----------------------------------------------------------
      if (gun.loadedSlot === null) {
        const stock = gun.ammo[gun.loadingSlot];
        if (stock.count > 0) {
          gun.reloadRemaining = Math.max(0, gun.reloadRemaining - dt);
          if (gun.reloadRemaining === 0) {
            stock.count--;
            gun.loadedSlot = gun.loadingSlot;
          }
        }
      }

      // --- Fire ------------------------------------------------------------
      if (!intent.fire || !gun.canFire || gun.loadedSlot === null) continue;
      const ammo = gun.ammo[gun.loadedSlot].def;
      const tf = world.req(e, Transform);
      const pose = gunPoseWorld(def, tf.pos, tf.rot, world.req(e, Turret).yaw, gun.pitch);
      const dir = applyDispersion(pose.dir, def.gun.dispersionMoa, this.rng);

      const bodyRef = world.get(e, PhysicsBodyRef);
      const body = bodyRef ? this.physics.getBody(bodyRef.bodyId) : undefined;
      const inherited = body ? body.velocityAtPoint(pose.muzzle) : { x: 0, y: 0, z: 0 };

      const p = world.create();
      world.add(p, Projectile, {
        ammo,
        shooter: e,
        pos: { ...pose.muzzle },
        vel: add(scale(dir, ammo.muzzleVelocity), inherited),
        prevPos: { ...pose.muzzle },
        travelled: 0,
        age: 0,
        ignore: e,
        bounces: 0,
      });

      // Recoil: shell momentum applied at the trunnion.
      body?.applyImpulseAtPoint(scale(dir, -ammo.massKg * ammo.muzzleVelocity), pose.trunnion);

      gun.loadedSlot = null;
      const next = gun.ammo[wanted]?.count > 0 ? wanted : gun.ammo.findIndex((a) => a.count > 0);
      this.beginReload(gun, next >= 0 ? next : wanted, def.gun.reloadTimeS);
      this.events.emit('shotFired', { shooter: e, muzzle: pose.muzzle, dir, ammo });
    }
  }

  private beginReload(gun: Gun, slot: number, baseTime: number): void {
    gun.loadingSlot = slot;
    gun.reloadDuration = baseTime * gun.reloadMultiplier;
    gun.reloadRemaining = gun.reloadDuration;
  }
}
