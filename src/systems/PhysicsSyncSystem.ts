import { copyQuat, copyVec3 } from '../core/math';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { Transform } from '../components/Transform';
import type { System } from '../ecs/System';
import type { World } from '../ecs/World';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

/** Runs first each tick: snapshots poses for render interpolation. */
export class SnapshotSystem implements System {
  readonly name = 'Snapshot';
  fixedUpdate(world: World): void {
    for (const e of world.query(Transform)) {
      const t = world.req(e, Transform);
      copyVec3(t.prevPos, t.pos);
      copyQuat(t.prevRot, t.rot);
    }
  }
}

/** Advances the physics world and copies body poses back into Transforms. */
export class PhysicsStepSystem implements System {
  readonly name = 'PhysicsStep';
  constructor(private readonly physics: PhysicsWorld) {}
  fixedUpdate(world: World, dt: number): void {
    this.physics.step(dt);
    for (const e of world.query(Transform, PhysicsBodyRef)) {
      const body = this.physics.getBody(world.req(e, PhysicsBodyRef).bodyId);
      if (!body) continue;
      const t = world.req(e, Transform);
      copyVec3(t.pos, body.position());
      copyQuat(t.rot, body.rotation());
    }
  }
}
