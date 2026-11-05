import { add, scale } from '../core/math';
import { ControlIntent } from '../components/ControlIntent';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { PlayerAim, PlayerControls } from '../components/resources';
import { PlayerControlled } from '../components/Vehicle';
import type { System } from '../ecs/System';
import type { World } from '../ecs/World';
import type { PhysicsWorld } from '../physics/PhysicsWorld';

const MAX_AIM_DISTANCE = 2500;

/** Converts sampled player controls + camera aim into the player's ControlIntent. */
export class PlayerInputSystem implements System {
  readonly name = 'PlayerInput';

  constructor(private readonly physics: PhysicsWorld) {}

  fixedUpdate(world: World): void {
    const controls = world.getResource(PlayerControls);
    const aim = world.getResource(PlayerAim);
    for (const e of world.query(PlayerControlled, ControlIntent)) {
      const intent = world.req(e, ControlIntent);
      intent.throttle = controls.throttle;
      intent.steer = controls.steer;
      intent.fire = controls.fire;
      intent.ammoSlot = controls.ammoSlot;

      const bodyId = world.get(e, PhysicsBodyRef)?.bodyId;
      const hit = this.physics.raycast(aim.origin, aim.dir, MAX_AIM_DISTANCE, { excludeBody: bodyId });
      intent.aimPoint = hit ? hit.point : add(aim.origin, scale(aim.dir, MAX_AIM_DISTANCE));
    }
  }
}
