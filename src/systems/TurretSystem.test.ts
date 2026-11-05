import { describe, expect, it } from 'vitest';
import { ControlIntent, makeIntent } from '../components/ControlIntent';
import { Gun } from '../components/Gun';
import { makeTransform, Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import { DEG2RAD } from '../core/math';
import { loadGameData } from '../data/loader';
import { World } from '../ecs/World';
import { TurretSystem } from './TurretSystem';
import { makeGun } from '../game/vehicleFactory';

const DT = 1 / 60;
const data = loadGameData();
const def = data.vehicles.get('kestrel_mk1')!;

function setup(aim: { x: number; y: number; z: number }) {
  const w = new World();
  const e = w.create();
  w.add(e, Vehicle, { def, team: 'A', name: 't' });
  w.add(e, Transform, makeTransform({ x: 0, y: 0, z: 0 }));
  w.add(e, Turret, { yaw: 0, prevYaw: 0, traverseFactor: 1 });
  w.add(e, Gun, makeGun(def, data.ammo));
  w.add(e, ControlIntent, { ...makeIntent(), aimPoint: aim });
  return { w, e, sys: new TurretSystem() };
}

const run = (s: ReturnType<typeof setup>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) s.sys.fixedUpdate(s.w, DT);
};

describe('TurretSystem', () => {
  it('traverses at the configured rate towards a target 90° to the left', () => {
    const s = setup({ x: -500, y: 0.7, z: -1.6 });
    run(s, 2);
    expect(s.w.req(s.e, Turret).yaw).toBeCloseTo(2 * def.turret.yawSpeed, 2);
    run(s, 3);
    expect(s.w.req(s.e, Turret).yaw).toBeCloseTo(90 * DEG2RAD, 1);
  });

  it('takes the shortest arc (target behind-right turns clockwise)', () => {
    const s = setup({ x: 300, y: 0.7, z: 400 });
    run(s, 0.5);
    expect(s.w.req(s.e, Turret).yaw).toBeLessThan(0);
  });

  it('clamps gun depression and elevation to mechanical limits', () => {
    const low = setup({ x: 0, y: -100, z: -50 });
    run(low, 5);
    expect(low.w.req(low.e, Gun).pitch).toBeCloseTo(def.gun.pitchMin, 6);
    const high = setup({ x: 0, y: 100, z: -50 });
    run(high, 5);
    expect(high.w.req(high.e, Gun).pitch).toBeCloseTo(def.gun.pitchMax, 6);
  });

  it('is slowed by a damaged turret ring (traverseFactor)', () => {
    const s = setup({ x: -500, y: 0.7, z: -1.6 });
    s.w.req(s.e, Turret).traverseFactor = 0;
    run(s, 2);
    expect(s.w.req(s.e, Turret).yaw).toBe(0);
  });
});
