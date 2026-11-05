import { beforeAll, describe, expect, it } from 'vitest';
import { ControlIntent } from '../components/ControlIntent';
import { Gun } from '../components/Gun';
import { Projectile } from '../components/Projectile';
import { Transform } from '../components/Transform';
import { loadGameData } from '../data/loader';
import type { GameEvents } from '../game/events';
import { Simulation } from '../game/Simulation';
import { spawnVehicle } from '../game/vehicleFactory';
import { Layer } from '../physics/PhysicsWorld';
import { initRapier, RapierWorld } from '../physics/RapierWorld';
import type { GameMap } from '../world/GameMap';
import { HeightMap } from '../world/HeightMap';
import type { Obstacle } from '../world/obstacles';

const DT = 1 / 60;
const data = loadGameData();
const def = data.vehicles.get('kestrel_mk1')!;
const AP = 0;
const HE = 1;

function makeSim(obstacles: Obstacle[] = []) {
  const hm = new HeightMap(1000, 101);
  const map = { def: data.maps.get('meadow_01')!, height: hm, obstacles, cover: [] } as GameMap;
  const sim = new Simulation(new RapierWorld(), map, 7);
  const shooter = spawnVehicle(sim.world, sim.physics, hm, {
    def,
    team: 'A',
    name: 'shooter',
    x: 0,
    z: 0,
    heading: 0,
    ammo: data.ammo,
  });
  const impacts: GameEvents['projectileImpact'][] = [];
  sim.events.on('projectileImpact', (ev) => impacts.push(ev));
  return { sim, shooter, impacts };
}

const run = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.fixedUpdate(DT, i);
};

/** Holds the gun level and straight ahead, then pulls the trigger for one tick. */
function fireOnce(sim: Simulation, shooter: number) {
  const intent = sim.world.req(shooter, ControlIntent);
  intent.fire = true;
  sim.fixedUpdate(DT, 0);
  intent.fire = false;
}

function aimAhead(sim: Simulation, shooter: number) {
  const t = sim.world.req(shooter, Transform);
  sim.world.req(shooter, ControlIntent).aimPoint = { x: t.pos.x, y: t.pos.y + 0.7, z: t.pos.z - 5000 };
}

describe('FireControlSystem', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('spawns at the muzzle, consumes a round and enforces the reload time', () => {
    const { sim, shooter } = makeSim();
    run(sim, 1);
    const gun = sim.world.req(shooter, Gun);
    expect(gun.loadedSlot).toBe(AP);
    const apBefore = gun.ammo[AP].count;

    fireOnce(sim, shooter);
    expect(sim.world.query(Projectile)).toHaveLength(1);
    expect(gun.loadedSlot).toBeNull();
    expect(gun.reloadRemaining).toBeCloseTo(def.gun.reloadTimeS, 1);

    // Trigger held during the reload: nothing fires.
    sim.world.req(shooter, ControlIntent).fire = true;
    run(sim, def.gun.reloadTimeS - 0.2);
    expect(gun.loadedSlot).toBeNull();
    run(sim, 0.3);
    // Reload finished (one round taken from the rack into the breech) and the
    // held trigger fired it immediately. `count` excludes the round in the breech.
    expect(gun.ammo[AP].count).toBe(apBefore - 1);
    expect(gun.loadedSlot).toBeNull();
    expect(sim.world.query(Projectile).length).toBeGreaterThanOrEqual(1);
  });

  it('switching ammo while loaded returns the round and restarts the reload', () => {
    const { sim, shooter } = makeSim();
    const gun = sim.world.req(shooter, Gun);
    const ap = gun.ammo[AP].count;
    const he = gun.ammo[HE].count;
    sim.world.req(shooter, ControlIntent).ammoSlot = HE;
    sim.fixedUpdate(DT, 0);
    expect(gun.ammo[AP].count).toBe(ap + 1);
    expect(gun.loadingSlot).toBe(HE);
    run(sim, def.gun.reloadTimeS + 0.1);
    expect(gun.loadedSlot).toBe(HE);
    expect(gun.ammo[HE].count).toBe(he - 1);
  });

  it('switching ammo during a reload keeps the elapsed reload time', () => {
    const { sim, shooter } = makeSim();
    fireOnce(sim, shooter);
    run(sim, 3);
    const gun = sim.world.req(shooter, Gun);
    const remaining = gun.reloadRemaining;
    sim.world.req(shooter, ControlIntent).ammoSlot = HE;
    sim.fixedUpdate(DT, 0);
    expect(gun.loadingSlot).toBe(HE);
    expect(gun.reloadRemaining).toBeCloseTo(remaining - DT, 6);
  });
});

describe('ProjectileSystem', () => {
  beforeAll(async () => {
    await initRapier();
  });

  const wall = (z: number): Obstacle => ({
    id: 0,
    kind: 'wall',
    position: { x: 0, y: -2, z },
    rotationY: 0,
    size: { x: 20, y: 12, z: 0.7 },
    radius: 10,
    solid: true,
  });

  it('sweeps fast shells so they cannot tunnel through a 0.7 m wall, and drops under gravity', () => {
    const { sim, shooter, impacts } = makeSim([wall(-300)]);
    run(sim, 1);
    aimAhead(sim, shooter);
    run(sim, 1);
    const muzzleY = sim.world.req(shooter, Transform).pos.y + 0.7;
    fireOnce(sim, shooter);
    run(sim, 1.5);
    expect(impacts).toHaveLength(1);
    const hit = impacts[0];
    expect(hit.layer).toBe(Layer.Static);
    expect(hit.target).toBeNull();
    expect(hit.point.z).toBeCloseTo(-300 + 0.35, 1); // front face of the wall
    // ~0.5 s flight -> ~1.2 m drop (dispersion adds a few cm).
    const drop = muzzleY - hit.point.y;
    expect(drop).toBeGreaterThan(0.9);
    expect(drop).toBeLessThan(1.6);
    expect(sim.world.query(Projectile)).toHaveLength(0);
  });

  it('reports the vehicle entity that was hit', () => {
    const { sim, shooter, impacts } = makeSim();
    const target = spawnVehicle(sim.world, sim.physics, sim.map.height, {
      def,
      team: 'B',
      name: 'target',
      x: 0,
      z: -150,
      heading: Math.PI / 2,
      ammo: data.ammo,
    });
    run(sim, 1.5);
    const t = sim.world.req(target, Transform);
    sim.world.req(shooter, ControlIntent).aimPoint = { x: t.pos.x, y: t.pos.y, z: t.pos.z };
    run(sim, 1);
    fireOnce(sim, shooter);
    run(sim, 1);
    expect(impacts).toHaveLength(1);
    expect(impacts[0].target).toBe(target);
    expect(impacts[0].layer).toBe(Layer.Vehicle);
    expect(impacts[0].distance).toBeGreaterThan(140);
  });
});
