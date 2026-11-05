import { defineComponent } from '../ecs/World';
import { quatIdentity, vec3, type Quat, type Vec3 } from '../core/math';

/** World pose plus the previous tick's pose for render interpolation. */
export interface Transform {
  pos: Vec3;
  rot: Quat;
  prevPos: Vec3;
  prevRot: Quat;
}

export const Transform = defineComponent<Transform>('Transform');

export const makeTransform = (pos: Vec3 = vec3(), rot: Quat = quatIdentity()): Transform => ({
  pos: { ...pos },
  rot: { ...rot },
  prevPos: { ...pos },
  prevRot: { ...rot },
});
