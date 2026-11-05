import { defineComponent } from '../ecs/World';
import type { BodyId } from '../physics/PhysicsWorld';

/** Links an entity to a rigid body owned by the PhysicsWorld. */
export interface PhysicsBodyRef {
  bodyId: BodyId;
}

export const PhysicsBodyRef = defineComponent<PhysicsBodyRef>('PhysicsBodyRef');
