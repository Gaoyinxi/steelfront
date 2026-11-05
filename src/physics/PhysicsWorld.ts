import type { Quat, Vec3 } from '../core/math';
import type { HeightMap } from '../world/HeightMap';

/**
 * Engine-agnostic physics facade. Gameplay systems depend only on these
 * interfaces, so the backing engine (currently Rapier) can be replaced or run
 * headless (dedicated server) without touching game logic.
 */

export type BodyId = number;

/** Collision layers, used to filter raycasts and contacts. */
export const enum Layer {
  Terrain = 1 << 0,
  Static = 1 << 1,
  Vehicle = 1 << 2,
  All = 0xffff,
}

export interface PhysicsBody {
  readonly id: BodyId;
  position(): Vec3;
  rotation(): Quat;
  linearVelocity(): Vec3;
  angularVelocity(): Vec3;
  velocityAtPoint(worldPoint: Vec3): Vec3;
  addForceAtPoint(force: Vec3, worldPoint: Vec3): void;
  addForce(force: Vec3): void;
  addTorque(torque: Vec3): void;
  applyImpulseAtPoint(impulse: Vec3, worldPoint: Vec3): void;
  setPose(position: Vec3, rotation: Quat): void;
  setVelocities(linear: Vec3, angular: Vec3): void;
  mass(): number;
}

export interface RayHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
  /** Owning body, or null for static world geometry. */
  bodyId: BodyId | null;
  layer: Layer;
}

export interface RaycastOptions {
  layers?: number;
  excludeBody?: BodyId;
}

export interface DynamicBoxDesc {
  position: Vec3;
  rotation: Quat;
  halfExtents: Vec3;
  /** Collider offset in body frame. */
  colliderOffset?: Vec3;
  massKg: number;
  /** Centre of mass in body frame. */
  centerOfMass?: Vec3;
  linearDamping?: number;
  angularDamping?: number;
  friction?: number;
}

export interface StaticShapeDesc {
  shape: 'box' | 'cylinder' | 'ball';
  position: Vec3;
  rotationY: number;
  /** Box: half extents. Cylinder: x = radius, y = half height. Ball: x = radius. */
  dims: Vec3;
}

export interface PhysicsWorld {
  step(dt: number): void;
  addHeightField(map: HeightMap): void;
  addStatic(desc: StaticShapeDesc): void;
  createDynamicBox(desc: DynamicBoxDesc): PhysicsBody;
  removeBody(id: BodyId): void;
  getBody(id: BodyId): PhysicsBody | undefined;
  raycast(origin: Vec3, dir: Vec3, maxDist: number, opts?: RaycastOptions): RayHit | null;
}
