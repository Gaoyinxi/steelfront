import RAPIER from '@dimforge/rapier3d-compat';
import type { Quat, Vec3 } from '../core/math';
import type { HeightMap } from '../world/HeightMap';
import {
  Layer,
  type BodyId,
  type DynamicBoxDesc,
  type PhysicsBody,
  type PhysicsWorld,
  type RaycastOptions,
  type RayHit,
  type StaticShapeDesc,
} from './PhysicsWorld';

let initPromise: Promise<void> | null = null;

/** Rapier ships as WASM; it must be initialised once before use. */
export function initRapier(): Promise<void> {
  return (initPromise ??= RAPIER.init());
}

/** Rapier interaction groups: high 16 bits = membership, low 16 = filter. */
const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

class RapierBody implements PhysicsBody {
  constructor(
    readonly id: BodyId,
    readonly rb: RAPIER.RigidBody,
  ) {}
  position(): Vec3 {
    const t = this.rb.translation();
    return { x: t.x, y: t.y, z: t.z };
  }
  rotation(): Quat {
    const r = this.rb.rotation();
    return { x: r.x, y: r.y, z: r.z, w: r.w };
  }
  linearVelocity(): Vec3 {
    const v = this.rb.linvel();
    return { x: v.x, y: v.y, z: v.z };
  }
  angularVelocity(): Vec3 {
    const v = this.rb.angvel();
    return { x: v.x, y: v.y, z: v.z };
  }
  velocityAtPoint(p: Vec3): Vec3 {
    const v = this.rb.velocityAtPoint(p);
    return { x: v.x, y: v.y, z: v.z };
  }
  addForceAtPoint(f: Vec3, p: Vec3): void {
    this.rb.addForceAtPoint(f, p, true);
  }
  addForce(f: Vec3): void {
    this.rb.addForce(f, true);
  }
  addTorque(t: Vec3): void {
    this.rb.addTorque(t, true);
  }
  applyImpulseAtPoint(i: Vec3, p: Vec3): void {
    this.rb.applyImpulseAtPoint(i, p, true);
  }
  setPose(p: Vec3, q: Quat): void {
    this.rb.setTranslation(p, true);
    this.rb.setRotation(q, true);
  }
  setVelocities(l: Vec3, a: Vec3): void {
    this.rb.setLinvel(l, true);
    this.rb.setAngvel(a, true);
  }
  mass(): number {
    return this.rb.mass();
  }
}

export class RapierWorld implements PhysicsWorld {
  private readonly world: RAPIER.World;
  private readonly bodies = new Map<BodyId, RapierBody>();
  private readonly colliderLayer = new Map<number, Layer>();
  private readonly colliderBody = new Map<number, BodyId>();
  private nextId: BodyId = 1;
  /** Set when colliders change; scene queries need a pipeline update first. */
  private queriesDirty = true;

  /** Call `await initRapier()` first. */
  constructor(gravity: Vec3 = { x: 0, y: -9.81, z: 0 }) {
    this.world = new RAPIER.World(gravity);
  }

  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
    this.queriesDirty = false;
    // Forces are per-step inputs: clear them so systems re-apply each tick.
    for (const b of this.bodies.values()) b.rb.resetForces(false), b.rb.resetTorques(false);
  }

  addHeightField(map: HeightMap): void {
    // Rapier expects rows along Z, columns along X, column-major storage.
    const n = map.resolution;
    const colMajor = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) colMajor[iz + ix * n] = map.heights[iz * n + ix];
    }
    const desc = RAPIER.ColliderDesc.heightfield(n - 1, n - 1, colMajor, { x: map.size, y: 1, z: map.size })
      .setFriction(0.9)
      .setCollisionGroups(groups(Layer.Terrain, Layer.All));
    const c = this.world.createCollider(desc);
    this.colliderLayer.set(c.handle, Layer.Terrain);
    this.queriesDirty = true;
  }

  addStatic(d: StaticShapeDesc): void {
    let desc: RAPIER.ColliderDesc;
    if (d.shape === 'box') desc = RAPIER.ColliderDesc.cuboid(d.dims.x, d.dims.y, d.dims.z);
    else if (d.shape === 'cylinder') desc = RAPIER.ColliderDesc.cylinder(d.dims.y, d.dims.x);
    else desc = RAPIER.ColliderDesc.ball(d.dims.x);
    const half = d.rotationY / 2;
    desc
      .setTranslation(d.position.x, d.position.y, d.position.z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) })
      .setFriction(0.7)
      .setCollisionGroups(groups(Layer.Static, Layer.All));
    const c = this.world.createCollider(desc);
    this.colliderLayer.set(c.handle, Layer.Static);
    this.queriesDirty = true;
  }

  createDynamicBox(d: DynamicBoxDesc): PhysicsBody {
    const rbDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(d.position.x, d.position.y, d.position.z)
      .setRotation(d.rotation)
      .setLinearDamping(d.linearDamping ?? 0.05)
      .setAngularDamping(d.angularDamping ?? 0.3)
      .setCanSleep(false)
      .setCcdEnabled(true);
    const rb = this.world.createRigidBody(rbDesc);
    const he = d.halfExtents;
    const off = d.colliderOffset ?? { x: 0, y: 0, z: 0 };
    // Collider has zero density; mass properties are set explicitly below.
    const colDesc = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setTranslation(off.x, off.y, off.z)
      .setDensity(0)
      .setFriction(d.friction ?? 0.5)
      .setCollisionGroups(groups(Layer.Vehicle, Layer.All));
    const col = this.world.createCollider(colDesc, rb);

    // Solid-box inertia using the full collider dimensions.
    const m = d.massKg;
    const w = 2 * he.x;
    const h = 2 * he.y;
    const l = 2 * he.z;
    const inertia = {
      x: (m / 12) * (h * h + l * l),
      y: (m / 12) * (w * w + l * l),
      z: (m / 12) * (w * w + h * h),
    };
    rb.setAdditionalMassProperties(m, d.centerOfMass ?? off, inertia, { x: 0, y: 0, z: 0, w: 1 }, true);

    const id = this.nextId++;
    const body = new RapierBody(id, rb);
    this.bodies.set(id, body);
    this.colliderLayer.set(col.handle, Layer.Vehicle);
    this.colliderBody.set(col.handle, id);
    this.queriesDirty = true;
    return body;
  }

  removeBody(id: BodyId): void {
    const b = this.bodies.get(id);
    if (!b) return;
    for (let i = 0; i < b.rb.numColliders(); i++) {
      const h = b.rb.collider(i).handle;
      this.colliderLayer.delete(h);
      this.colliderBody.delete(h);
    }
    this.world.removeRigidBody(b.rb);
    this.bodies.delete(id);
  }

  /** Rebuilds the broad phase without advancing the simulation (zero-length step). */
  private refreshQueries(): void {
    const dt = this.world.timestep;
    this.world.timestep = 0;
    this.world.step();
    this.world.timestep = dt;
    this.queriesDirty = false;
  }

  getBody(id: BodyId): PhysicsBody | undefined {
    return this.bodies.get(id);
  }

  raycast(origin: Vec3, dir: Vec3, maxDist: number, opts: RaycastOptions = {}): RayHit | null {
    if (this.queriesDirty) this.refreshQueries();
    const ray = new RAPIER.Ray(origin, dir);
    const excludeRb = opts.excludeBody !== undefined ? this.bodies.get(opts.excludeBody)?.rb : undefined;
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDist,
      true,
      undefined,
      groups(Layer.All, opts.layers ?? Layer.All),
      undefined,
      excludeRb,
    );
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      distance: t,
      bodyId: this.colliderBody.get(hit.collider.handle) ?? null,
      layer: this.colliderLayer.get(hit.collider.handle) ?? Layer.Static,
    };
  }
}
