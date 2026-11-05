import { beforeAll, describe, expect, it } from 'vitest';
import { ControlIntent } from '../components/ControlIntent';
import { Gun } from '../components/Gun';
import { Modules, VehicleStatus } from '../components/Modules';
import { TrackedMobility } from '../components/TrackedMobility';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Rng } from '../core/Rng';
import { loadGameData } from '../data/loader';
import type { VehicleDef } from '../data/schema';
import type { GameEvents } from '../game/events';
import { Simulation } from '../game/Simulation';
import { spawnVehicle } from '../game/vehicleFactory';
import { initRapier, RapierWorld } from '../physics/RapierWorld';
import type { GameMap } from '../world/GameMap';
import { HeightMap } from '../world/HeightMap';
import { applyModuleDamage } from './ModuleEffectSystem';

const DT = 1 / 60;
const data = loadGameData();
const baseDef = data.vehicles.get('kestrel_mk1')!;

function setup(def: VehicleDef = baseDef) {
  const hm = new HeightMap(1200, 121);
  const map = { def: data.maps.get('meadow_01')!, height: hm, obstacles: [], cover: [] } as GameMap;
  const sim = new Simulation(new RapierWorld(), map, 3);
  const spawn = (name: string, z: number, heading: number, team: 'A' | 'B') =>
    spawnVehicle(sim.world, sim.physics, hm, { def, team, name, x: 0, z, heading, ammo: data.ammo });
  const events = {
    hits: [] as GameEvents['hitResolved'][],
    kills: [] as GameEvents['vehicleDestroyed'][],
  };
  sim.events.on('hitResolved', (e) => events.hits.push(e));
  sim.events.on('vehicleDestroyed', (e) => events.kills.push(e));
  return { sim, spawn, events };
}

const run = (sim: Simulation, s: number) => {
  for (let i = 0; i < Math.round(s / DT); i++) sim.fixedUpdate(DT, i);
};
const moduleIndex = (pred: (m: VehicleDef['modules'][number]) => boolean) => baseDef.modules.findIndex(pred);
const kill = (sim: Simulation, e: number, index: number) =>
  applyModuleDamage(sim.world, e, [{ index, damage: 1e6, sources: ['shell'] }], new Rng(1));

describe('ModuleEffectSystem', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('applies the failure effect of each module', () => {
    const { sim, spawn } = setup();
    const e = spawn('t', 0, 0, 'A');
    kill(sim, e, moduleIndex((m) => m.role === 'driver'));
    kill(sim, e, moduleIndex((m) => m.role === 'loader'));
    kill(sim, e, moduleIndex((m) => m.type === 'turretRing'));
    kill(sim, e, moduleIndex((m) => m.type === 'engine'));
    sim.fixedUpdate(DT, 0);
    expect(sim.world.req(e, TrackedMobility).canDrive).toBe(false);
    expect(sim.world.req(e, TrackedMobility).powerFactor).toBe(0);
    expect(sim.world.req(e, Gun).reloadMultiplier).toBe(2);
    expect(sim.world.req(e, Turret).traverseFactor).toBe(0);
    expect(sim.world.req(e, Gun).canFire).toBe(true);
    // Two of four crew remain: still in action.
    expect(sim.world.req(e, VehicleStatus).destroyed).toBe(false);
  });

  it('silences the gun when the gunner or the breech is lost', () => {
    const { sim, spawn } = setup();
    const a = spawn('a', 0, 0, 'A');
    const b = spawn('b', -30, 0, 'A');
    kill(sim, a, moduleIndex((m) => m.role === 'gunner'));
    kill(sim, b, moduleIndex((m) => m.type === 'gunBreech'));
    sim.fixedUpdate(DT, 0);
    expect(sim.world.req(a, Gun).canFire).toBe(false);
    expect(sim.world.req(b, Gun).canFire).toBe(false);
  });

  it('degrades (not disables) a damaged engine', () => {
    const { sim, spawn } = setup();
    const e = spawn('t', 0, 0, 'A');
    const engine = moduleIndex((m) => m.type === 'engine');
    applyModuleDamage(sim.world, e, [{ index: engine, damage: 80, sources: ['spall'] }], new Rng(1));
    sim.fixedUpdate(DT, 0);
    expect(sim.world.req(e, TrackedMobility).powerFactor).toBe(0.5);
  });

  it('knocks the vehicle out when fewer than two crew remain', () => {
    const { sim, spawn, events } = setup();
    const e = spawn('t', 0, 0, 'A');
    for (const role of ['driver', 'gunner', 'loader'] as const) kill(sim, e, moduleIndex((m) => m.role === role));
    sim.fixedUpdate(DT, 0);
    expect(sim.world.req(e, VehicleStatus)).toMatchObject({ destroyed: true, cause: 'crewLoss' });
    expect(events.kills).toHaveLength(1);
    expect(sim.world.req(e, TrackedMobility).canDrive).toBe(false);
  });

  it('rolls ammunition detonation when a rack is destroyed', () => {
    const always: VehicleDef = {
      ...baseDef,
      modules: baseDef.modules.map((m) => (m.type === 'ammoRack' ? { ...m, detonationChance: 1 } : m)),
    };
    const never: VehicleDef = {
      ...baseDef,
      modules: baseDef.modules.map((m) => (m.type === 'ammoRack' ? { ...m, detonationChance: 0 } : m)),
    };
    const rack = moduleIndex((m) => m.type === 'ammoRack');
    const a = setup(always);
    expect(kill(a.sim, a.spawn('t', 0, 0, 'A'), rack).detonated).toBe(true);
    const b = setup(never);
    expect(kill(b.sim, b.spawn('t', 0, 0, 'A'), rack).detonated).toBe(false);
  });
});

describe('end-to-end armour resolution', () => {
  beforeAll(async () => {
    await initRapier();
  });

  /**
   * Shooter at the origin facing -Z, target `range` m ahead with the given
   * heading (PI = facing the shooter, PI/2 = side-on).
   */
  function duel(range: number, targetHeading: number, aimHeight: number) {
    const ctx = setup();
    const shooter = ctx.spawn('shooter', 0, 0, 'A');
    const target = ctx.spawn('target', -range, targetHeading, 'B');
    run(ctx.sim, 1.5);
    const t = ctx.sim.world.req(target, Transform).pos;
    ctx.sim.world.req(shooter, ControlIntent).aimPoint = { x: t.x, y: t.y + aimHeight, z: t.z };
    run(ctx.sim, 2.5);
    const intent = ctx.sim.world.req(shooter, ControlIntent);
    intent.fire = true;
    ctx.sim.fixedUpdate(DT, 0);
    intent.fire = false;
    run(ctx.sim, 1.5);
    return { ...ctx, target };
  }

  it('penetrates the 38 mm side at 200 m and damages internal modules', () => {
    const { events, sim, target } = duel(200, Math.PI / 2, 0);
    expect(events.hits).toHaveLength(1);
    const h = events.hits[0];
    expect(h.part).toBe('hull');
    expect(h.face).toBe('side');
    expect(h.result).toBe('penetration');
    expect(h.modules.length).toBeGreaterThan(0);
    expect(sim.world.req(target, Modules).states.some((s) => s.hp < s.maxHp)).toBe(true);
  });

  it('fails to penetrate the 56° glacis from the front at 200 m', () => {
    const { events, sim, target } = duel(200, Math.PI, -0.1);
    expect(events.hits.length).toBeGreaterThanOrEqual(1);
    const h = events.hits[0];
    expect(h.part).toBe('hull');
    expect(h.face).toBe('front');
    expect(h.result).toBe('nonPenetration');
    expect(h.effectiveMm).toBeGreaterThan(h.penetrationMm);
    expect(sim.world.req(target, Modules).states.every((s) => s.hp === s.maxHp)).toBe(true);
  });
});
