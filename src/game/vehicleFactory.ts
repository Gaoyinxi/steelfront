import { makeIntent, ControlIntent } from '../components/ControlIntent';
import { Gun } from '../components/Gun';
import { Modules, VehicleStatus } from '../components/Modules';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { TrackedMobility } from '../components/TrackedMobility';
import { makeTransform, Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle, type TeamId } from '../components/Vehicle';
import type { AmmoDef, VehicleDef } from '../data/schema';
import type { Entity, World } from '../ecs/World';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { HeightMap } from '../world/HeightMap';
import { comOffset, yawQuat } from './vehicleGeometry';

export interface SpawnOptions {
  def: VehicleDef;
  team: TeamId;
  name: string;
  x: number;
  z: number;
  /** Hull heading in radians (0 = facing -Z). */
  heading: number;
  /** Ammunition definitions, looked up by the ids listed in the vehicle's gun. */
  ammo: ReadonlyMap<string, AmmoDef>;
}

/** Initial gun state: stowage from the vehicle definition, first slot loaded. */
export function makeGun(def: VehicleDef, ammoDefs: ReadonlyMap<string, AmmoDef>): Gun {
  const ammo = def.gun.ammo.map((a) => {
    const ad = ammoDefs.get(a.id);
    if (!ad) throw new Error(`Vehicle ${def.id}: unknown ammo ${a.id}`);
    return { def: ad, count: a.count };
  });
  const first = ammo.findIndex((a) => a.count > 0);
  if (first >= 0) ammo[first].count--;
  return {
    pitch: 0,
    prevPitch: 0,
    elevationFactor: 1,
    ammo,
    loadedSlot: first >= 0 ? first : null,
    loadingSlot: Math.max(first, 0),
    reloadRemaining: 0,
    reloadDuration: def.gun.reloadTimeS,
    reloadMultiplier: 1,
    canFire: true,
  };
}

/** Creates a fully-assembled tracked vehicle entity and its rigid body. */
export function spawnVehicle(world: World, physics: PhysicsWorld, terrain: HeightMap, o: SpawnOptions): Entity {
  const { def } = o;
  const susp = def.mobility.suspension;
  const n = susp.wheelsPerSide * 2;

  // Spring rate from target natural frequency: k_total = m * (2πf)^2.
  const omega = 2 * Math.PI * susp.frequencyHz;
  const springK = (def.massKg * omega * omega) / n;
  const damperC = 2 * susp.dampingRatio * Math.sqrt(springK * (def.massKg / n));
  const staticSag = (def.massKg * 9.81) / (springK * n);
  const restLength = def.hull.groundClearance + staticSag;

  const y = terrain.sample(o.x, o.z) + def.hull.groundClearance + def.hull.half.y + 0.25;
  const rot = yawQuat(o.heading);
  const pos = { x: o.x, y, z: o.z };

  const body = physics.createDynamicBox({
    position: pos,
    rotation: rot,
    halfExtents: def.hull.half,
    massKg: def.massKg,
    centerOfMass: comOffset(def),
    linearDamping: 0.02,
    angularDamping: 0.4,
    friction: 0.4,
  });

  const e = world.create();
  world.add(e, Vehicle, { def, team: o.team, name: o.name });
  world.add(e, Transform, makeTransform(pos, rot));
  world.add(e, PhysicsBodyRef, { bodyId: body.id });
  world.add(e, ControlIntent, makeIntent());
  world.add(e, Turret, { yaw: 0, prevYaw: 0, traverseFactor: 1 });
  world.add(e, Gun, makeGun(def, o.ammo));
  world.add(e, Modules, { states: def.modules.map((m) => ({ hp: m.hp, maxHp: m.hp, destroyed: false })) });
  world.add(e, VehicleStatus, { destroyed: false, cause: null, lastAttacker: null, destroyedFor: 0 });
  const wheel = () => ({ compression: 0, grounded: false });
  world.add(e, TrackedMobility, {
    powerFactor: 1,
    canDrive: true,
    left: Array.from({ length: susp.wheelsPerSide }, wheel),
    right: Array.from({ length: susp.wheelsPerSide }, wheel),
    forwardSpeed: 0,
    brakeHold: [0, 0],
    springK,
    damperC,
    restLength,
  });
  return e;
}

/** Removes a vehicle entity and its rigid body. */
export function despawnVehicle(world: World, physics: PhysicsWorld, e: Entity): void {
  const ref = world.get(e, PhysicsBodyRef);
  if (ref) physics.removeBody(ref.bodyId);
  world.destroy(e);
}
