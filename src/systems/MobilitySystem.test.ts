import { beforeAll, describe, expect, it } from 'vitest';
import { ControlIntent } from '../components/ControlIntent';
import { Transform } from '../components/Transform';
import { TrackedMobility } from '../components/TrackedMobility';
import { RAD2DEG, rotateVec } from '../core/math';
import { loadGameData } from '../data/loader';
import { Simulation } from '../game/Simulation';
import { spawnVehicle } from '../game/vehicleFactory';
import { initRapier, RapierWorld } from '../physics/RapierWorld';
import type { GameMap } from '../world/GameMap';
import { HeightMap } from '../world/HeightMap';

const DT = 1 / 60;
const data = loadGameData();
const def = data.vehicles.get('kestrel_mk1')!;

function flatSim(slopeDeg = 0, axis: 'z' | 'x' = 'z') {
  const hm = new HeightMap(600, 151);
  const k = Math.tan((slopeDeg * Math.PI) / 180);
  for (let iz = 0; iz < 151; iz++)
    for (let ix = 0; ix < 151; ix++) hm.heights[iz * 151 + ix] = axis === 'z' ? -hm.worldZ(iz) * k : -hm.worldX(ix) * k;
  hm.recomputeBounds();
  const map = { def: data.maps.get('meadow_01')!, height: hm, obstacles: [], cover: [] } as GameMap;
  const sim = new Simulation(new RapierWorld(), map);
  const e = spawnVehicle(sim.world, sim.physics, hm, { def, team: 'A', name: 't', x: 0, z: 0, heading: 0, ammo: data.ammo });
  return { sim, e, hm };
}

function run(sim: Simulation, seconds: number) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) sim.fixedUpdate(DT, i);
}

const heading = (sim: Simulation, e: number) => {
  const f = rotateVec(sim.world.req(e, Transform).rot, { x: 0, y: 0, z: -1 });
  return Math.atan2(-f.x, -f.z);
};

describe('MobilitySystem (tracked running gear)', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('settles on its suspension at the configured ground clearance', () => {
    const { sim, e, hm } = flatSim();
    run(sim, 3);
    const t = sim.world.req(e, Transform);
    const bottom = t.pos.y - def.hull.half.y;
    expect(bottom - hm.sample(t.pos.x, t.pos.z)).toBeCloseTo(def.hull.groundClearance, 1);
    expect(Math.abs(sim.world.req(e, TrackedMobility).forwardSpeed)).toBeLessThan(0.05);
  });

  it('reaches near top speed on flat ground and brakes to a stop', () => {
    const { sim, e } = flatSim();
    run(sim, 2);
    sim.world.req(e, ControlIntent).throttle = 1;
    run(sim, 20);
    const v = sim.world.req(e, TrackedMobility).forwardSpeed;
    console.log('top speed km/h', (v * 3.6).toFixed(1));
    expect(v).toBeGreaterThan(def.mobility.maxSpeedFwd * 0.9);
    expect(v).toBeLessThan(def.mobility.maxSpeedFwd * 1.05);
    sim.world.req(e, ControlIntent).throttle = 0;
    run(sim, 5);
    expect(Math.abs(sim.world.req(e, TrackedMobility).forwardSpeed)).toBeLessThan(0.2);
  });

  it('pivot-turns at roughly the configured rate', () => {
    const { sim, e } = flatSim();
    run(sim, 2);
    const h0 = heading(sim, e);
    sim.world.req(e, ControlIntent).steer = 1; // right
    run(sim, 1.5);
    const h1 = heading(sim, e);
    run(sim, 1);
    const h2 = heading(sim, e);
    const rate = ((h2 - h1) / 1) * RAD2DEG;
    console.log('pivot rate deg/s', rate.toFixed(1), 'start', h0.toFixed(3));
    expect(rate).toBeLessThan(0); // right turn = clockwise from above = negative yaw
    expect(Math.abs(rate)).toBeGreaterThan(def.mobility.pivotTurnRateDeg * 0.6);
    expect(Math.abs(rate)).toBeLessThan(def.mobility.pivotTurnRateDeg * 1.2);
  });

  it('does not creep sideways when parked across a 25° side slope', () => {
    // Slope falls towards +X; the tank faces -Z, so the slope is across its hull.
    const { sim, e } = flatSim(25, 'x');
    run(sim, 4);
    const x0 = sim.world.req(e, Transform).pos.x;
    run(sim, 10);
    expect(Math.abs(sim.world.req(e, Transform).pos.x - x0)).toBeLessThan(0.3);
  });

  it('holds position on a 15° slope with zero throttle and climbs it', () => {
    const { sim, e } = flatSim(15);
    run(sim, 4);
    const z0 = sim.world.req(e, Transform).pos.z;
    run(sim, 4);
    expect(Math.abs(sim.world.req(e, Transform).pos.z - z0)).toBeLessThan(0.3);
    sim.world.req(e, ControlIntent).throttle = 1;
    run(sim, 6);
    const v = sim.world.req(e, TrackedMobility).forwardSpeed;
    console.log('15deg climb km/h', (v * 3.6).toFixed(1));
    expect(v).toBeGreaterThan(2);
  });
});
