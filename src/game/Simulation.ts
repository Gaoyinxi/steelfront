import { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { World } from '../ecs/World';
import type { GameEvents } from './events';
import { FireControlSystem } from '../systems/FireControlSystem';
import { ProjectileSystem } from '../systems/ProjectileSystem';
import { HitResolutionSystem } from '../systems/HitResolutionSystem';
import { ModuleEffectSystem } from '../systems/ModuleEffectSystem';
import type { System } from '../ecs/System';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { GameMap } from '../world/GameMap';
import { MobilitySystem } from '../systems/MobilitySystem';
import { PhysicsStepSystem, SnapshotSystem } from '../systems/PhysicsSyncSystem';
import { TurretSystem } from '../systems/TurretSystem';

/**
 * Headless simulation: ECS world + physics + ordered systems.
 * Contains no rendering or DOM code, so it can run in tests, a worker or a
 * future dedicated server.
 */
export class Simulation {
  readonly world = new World();
  readonly events = new EventBus<GameEvents>();
  /** Single source of gameplay randomness (deterministic replays / lockstep). */
  readonly rng: Rng;
  private readonly systems: System[] = [];
  /** Systems that produce ControlIntents (player input, AI); run before vehicle systems. */
  private readonly inputSystems: System[] = [];

  constructor(
    readonly physics: PhysicsWorld,
    readonly map: GameMap,
    seed = 1,
  ) {
    this.rng = new Rng(seed);
    physics.addHeightField(map.height);
    for (const o of map.obstacles) {
      const p = { x: o.position.x, y: o.position.y + o.size.y / 2, z: o.position.z };
      if (o.kind === 'tree') {
        physics.addStatic({ shape: 'cylinder', position: p, rotationY: 0, dims: { x: 0.35, y: o.size.y / 2, z: 0 } });
      } else {
        const shrink = o.kind === 'rock' ? 0.8 : 1;
        physics.addStatic({
          shape: 'box',
          position: p,
          rotationY: o.rotationY,
          dims: { x: (o.size.x / 2) * shrink, y: (o.size.y / 2) * shrink, z: (o.size.z / 2) * shrink },
        });
      }
    }

    const moduleEffects = new ModuleEffectSystem(this.events);
    this.systems.push(
      new SnapshotSystem(),
      // Derive capabilities (power, traverse, reload, can fire) from module
      // health before anything uses them this tick.
      moduleEffects,
      new MobilitySystem(physics),
      new TurretSystem(),
      new PhysicsStepSystem(physics),
      // After the step: shells spawn at the up-to-date muzzle pose and are
      // swept against current body positions.
      new FireControlSystem(physics, this.events, this.rng),
      new ProjectileSystem(physics, map.height, this.events),
      new HitResolutionSystem(physics, this.events, this.rng, moduleEffects),
    );
  }

  addInputSystem(system: System): void {
    this.inputSystems.push(system);
  }

  fixedUpdate(dt: number, tick: number): void {
    this.systems[0].fixedUpdate(this.world, dt, tick); // snapshot first
    for (const s of this.inputSystems) s.fixedUpdate(this.world, dt, tick);
    for (let i = 1; i < this.systems.length; i++) this.systems[i].fixedUpdate(this.world, dt, tick);
    this.world.flush();
  }
}
