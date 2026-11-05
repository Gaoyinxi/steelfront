import { beforeAll, describe, expect, it } from 'vitest';
import { AIBrain, makeBrain, type AIState } from '../components/AIBrain';
import { ControlIntent } from '../components/ControlIntent';
import { Transform } from '../components/Transform';
import type { Vec3 } from '../core/math';
import { loadGameData } from '../data/loader';
import type { GameEvents } from '../game/events';
import { Simulation } from '../game/Simulation';
import { spawnVehicle } from '../game/vehicleFactory';
import { initRapier, RapierWorld } from '../physics/RapierWorld';
import { generateCoverPoints } from '../world/coverPoints';
import type { GameMap } from '../world/GameMap';
import { HeightMap } from '../world/HeightMap';
import type { Obstacle } from '../world/obstacles';

const DT = 1 / 60;
const data = loadGameData();
const def = data.vehicles.get('kestrel_mk1')!;
const skill = data.aiSkills.get('regular')!;

function scenario(obstacles: Obstacle[] = [], seed = 11) {
  const hm = new HeightMap(800, 201);
  const map: GameMap = { def: data.maps.get('meadow_01')!, height: hm, obstacles, cover: generateCoverPoints(obstacles, hm) };
  const sim = new Simulation(new RapierWorld(), map, seed);
  const log = {
    shots: [] as GameEvents['shotFired'][],
    hits: [] as GameEvents['hitResolved'][],
    states: new Set<AIState>(),
  };
  sim.events.on('shotFired', (e) => log.shots.push(e));
  sim.events.on('hitResolved', (e) => log.hits.push(e));
  const spawn = (team: 'A' | 'B', x: number, z: number, heading: number, route?: Vec3[]) => {
    const e = spawnVehicle(sim.world, sim.physics, hm, { def, team, name: team, x, z, heading, ammo: data.ammo });
    if (route) sim.world.add(e, AIBrain, makeBrain(skill, route));
    return e;
  };
  let tick = 0;
  const run = (seconds: number, ai?: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      sim.fixedUpdate(DT, tick++);
      if (ai !== undefined) log.states.add(sim.world.req(ai, AIBrain).state);
    }
  };
  return { sim, spawn, run, log };
}

const wall = (x: number, z: number, length: number, height = 3): Obstacle => ({
  id: 0,
  kind: 'wall',
  position: { x, y: 0, z },
  rotationY: 0,
  size: { x: length, y: height, z: 0.7 },
  radius: length / 2,
  solid: true,
});

describe('AISystem (integration with physics, armour and fire control)', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('spots an exposed enemy, fights in the open without cover and scores hits with dispersion', () => {
    const s = scenario();
    const ai = s.spawn('B', 0, -150, Math.PI, []);
    const target = s.spawn('A', 0, 150, Math.PI / 2);
    s.run(45, ai);
    const aiShots = s.log.shots.filter((x) => x.shooter === ai);
    const aiHits = s.log.hits.filter((h) => h.shooter === ai && h.target === target);
    expect(s.log.states.has('engageOpen')).toBe(true);
    expect(aiShots.length).toBeGreaterThanOrEqual(3);
    expect(aiHits.length).toBeGreaterThanOrEqual(1);
    // Every shot leaves the muzzle in a slightly different direction.
    const dirs = new Set(aiShots.map((x) => `${x.dir.x.toFixed(5)},${x.dir.y.toFixed(5)}`));
    expect(dirs.size).toBe(aiShots.length);
  });

  it('takes cover behind a wall, then peeks past its end to fire', () => {
    const w = wall(0, -120, 16);
    const s = scenario([w]);
    // Starts in the open, off to the side of the wall, with a clear view of the target.
    const ai = s.spawn('B', 30, -150, Math.PI, []);
    s.spawn('A', 0, 150, Math.PI / 2);
    let hiddenInCover: boolean | null = null;
    for (let t = 0; t < 70 && s.log.shots.filter((x) => x.shooter === ai).length < 2; t += 0.5) {
      s.run(0.5, ai);
      const brain = s.sim.world.req(ai, AIBrain);
      if (brain.state === 'inCover' && hiddenInCover === null) {
        const p = s.sim.world.req(ai, Transform).pos;
        hiddenInCover = !s.sim.ai.los({ x: 0, y: 3.5, z: 150 }, { x: p.x, y: p.y + 0.3, z: p.z });
      }
    }
    expect(s.log.states.has('moveToCover')).toBe(true);
    expect(s.log.states.has('inCover')).toBe(true);
    expect(s.log.states.has('peek')).toBe(true);
    expect(hiddenInCover).toBe(true);
    const shots = s.log.shots.filter((x) => x.shooter === ai);
    expect(shots.length).toBeGreaterThanOrEqual(1);
    // Fired from beside the wall, not through it.
    expect(Math.abs(shots[0].muzzle.x)).toBeGreaterThan(w.size.x / 2);
  });

  it('teammates spread out instead of sharing one cover', () => {
    const left = { ...wall(-40, -120, 16), id: 0 };
    const right = { ...wall(40, -120, 16), id: 1 };
    const s = scenario([left, right]);
    // Both start on the right, nearer the right-hand wall.
    const a = s.spawn('B', 60, -150, Math.PI, []);
    const b = s.spawn('B', 72, -150, Math.PI, []);
    s.spawn('A', 0, 150, Math.PI / 2);
    s.run(12);
    const ca = s.sim.world.req(a, AIBrain).cover;
    const cb = s.sim.world.req(b, AIBrain).cover;
    expect(ca).not.toBeNull();
    expect(cb).not.toBeNull();
    expect(Math.abs(ca!.cover.position.x - cb!.cover.position.x)).toBeGreaterThan(12);
  });

  it('engages a hull-down target at its exposed turret', () => {
    // A 1.8 m wall just in front of the target hides its hull; only the turret shows.
    const s = scenario([wall(0, 144, 30, 1.8)]);
    const ai = s.spawn('B', 0, -150, Math.PI, []);
    const target = s.spawn('A', 0, 150, Math.PI / 2);
    s.run(60, ai);
    const hits = s.log.hits.filter((h) => h.shooter === ai && h.target === target);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.every((h) => h.part === 'turret')).toBe(true);
  });

  it('reacts to gunfire it hears but cannot see', () => {
    const building: Obstacle = {
      id: 0,
      kind: 'building',
      position: { x: 0, y: 0, z: -100 },
      rotationY: 0,
      size: { x: 14, y: 10, z: 12 },
      radius: 9.2,
      solid: true,
    };
    const s = scenario([building]);
    const ai = s.spawn('B', 0, -150, Math.PI, []);
    const shooter = s.spawn('A', 0, 150, 0);
    s.run(5, ai);
    expect(s.sim.world.req(ai, AIBrain).contacts.size).toBe(0);
    expect(s.sim.world.req(ai, AIBrain).state).toBe('patrol');
    const intent = s.sim.world.req(shooter, ControlIntent);
    intent.aimPoint = { x: 0, y: 3, z: 1000 }; // fires away from the AI
    intent.fire = true;
    s.run(DT);
    intent.fire = false;
    s.run(1, ai);
    const brain = s.sim.world.req(ai, AIBrain);
    expect(brain.contacts.get(shooter)?.lastKnownPos).not.toBeNull();
    expect(brain.state).not.toBe('patrol');
  });

  it('patrols its route when no enemy is around', () => {
    const s = scenario();
    const ai = s.spawn('B', 0, -150, Math.PI, [
      { x: 0, y: 0, z: -150 },
      { x: 0, y: 0, z: -30 },
    ]);
    s.run(25, ai);
    expect(s.sim.world.req(ai, Transform).pos.z).toBeGreaterThan(-80);
    expect(s.log.states).toEqual(new Set(['patrol']));
  });
});
