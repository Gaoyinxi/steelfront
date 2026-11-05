import { add, normalize, scale } from '../core/math';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/Rng';
import { reflect } from '../combat/armor';
import { computeInternalDamage } from '../combat/damage';
import { resolvePlateImpact } from '../combat/penetration';
import { Modules, VehicleStatus } from '../components/Modules';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { Projectile } from '../components/Projectile';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import type { System } from '../ecs/System';
import type { World } from '../ecs/World';
import type { GameEvents } from '../game/events';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { applyModuleDamage, type ModuleEffectSystem } from './ModuleEffectSystem';

/** Speed retained by a ricocheting shell. */
const RICOCHET_SPEED_FACTOR = 0.55;
const MAX_BOUNCES = 2;

/**
 * Turns armour impacts into outcomes using the pure combat functions:
 * ricochet (shell deflected), non-penetration, or penetration with
 * behind-armour module damage. Publishes `hitResolved` for HUD/AI.
 */
export class HitResolutionSystem implements System {
  readonly name = 'HitResolution';
  private readonly queue: GameEvents['projectileImpact'][] = [];

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly events: EventBus<GameEvents>,
    private readonly rng: Rng,
    private readonly moduleEffects: ModuleEffectSystem,
  ) {
    events.on('projectileImpact', (ev) => {
      if (ev.target !== null && ev.armor) this.queue.push(ev);
    });
  }

  fixedUpdate(world: World): void {
    for (const ev of this.queue.splice(0)) {
      const target = ev.target!;
      const armor = ev.armor!;
      if (!world.isAlive(target)) continue;
      const def = world.req(target, Vehicle).def;
      const tf = world.req(target, Transform);
      const status = world.get(target, VehicleStatus);
      const speed = Math.hypot(ev.velocity.x, ev.velocity.y, ev.velocity.z);
      const dir = normalize(ev.velocity);

      const r = resolvePlateImpact({
        ammo: ev.ammo,
        range: ev.distance,
        shellDir: dir,
        normal: ev.normal,
        thicknessMm: armor.thicknessMm,
      });

      // Transfer a little momentum to the target.
      const bodyId = world.get(target, PhysicsBodyRef)?.bodyId;
      if (bodyId !== undefined) {
        this.physics.getBody(bodyId)?.applyImpulseAtPoint(scale(dir, ev.ammo.massKg * speed * 0.5), ev.point);
      }

      const damagedModules: GameEvents['hitResolved']['modules'] = [];
      if (r.result === 'ricochet') {
        this.spawnRicochet(world, ev, dir, speed);
      } else if (r.result === 'penetration' && status && !status.destroyed) {
        status.lastAttacker = ev.shooter;
        const damage = computeInternalDamage({
          def,
          pose: { pos: tf.pos, rot: tf.rot, turretYaw: world.req(target, Turret).yaw },
          ammo: ev.ammo,
          entry: ev.point,
          dir,
          interiorLength: armor.interiorLength,
          residualMm: r.residualMm,
          rng: this.rng,
        });
        const states = world.req(target, Modules).states;
        const wasDestroyed = states.map((st) => st.destroyed);
        const applied = applyModuleDamage(world, target, damage, this.rng);
        // Report only what this hit changed: newly damaged or newly destroyed modules.
        for (const d of damage) {
          if (wasDestroyed[d.index]) continue;
          const m = def.modules[d.index];
          damagedModules.push({ type: m.type, role: m.role, destroyed: states[d.index].destroyed });
        }
        if (applied.detonated) this.moduleEffects.destroy(target, status, 'ammoDetonation');
      }

      this.events.emit('hitResolved', {
        shooter: ev.shooter,
        target,
        ammo: ev.ammo,
        result: r.result,
        part: armor.part,
        face: armor.face,
        thicknessMm: armor.thicknessMm,
        angleDeg: (r.angle * 180) / Math.PI,
        effectiveMm: r.effectiveMm,
        penetrationMm: r.penetrationMm,
        distance: ev.distance,
        modules: damagedModules,
      });
    }
  }

  private spawnRicochet(world: World, ev: GameEvents['projectileImpact'], dir: { x: number; y: number; z: number }, speed: number): void {
    const parent = world.get(ev.projectile, Projectile);
    const bounces = (parent?.bounces ?? 0) + 1;
    if (bounces > MAX_BOUNCES) return;
    const out = reflect(dir, ev.normal);
    const pos = add(ev.point, scale(ev.normal, 0.05));
    const p = world.create();
    world.add(p, Projectile, {
      ammo: ev.ammo,
      shooter: ev.shooter,
      pos: { ...pos },
      vel: scale(out, speed * RICOCHET_SPEED_FACTOR),
      prevPos: { ...pos },
      travelled: ev.distance,
      age: 0,
      ignore: ev.target,
      bounces,
    });
  }
}
