import { describe, expect, it } from 'vitest';
import { DEG2RAD, dot, length, sub } from '../../core/math';
import { loadGameData } from '../../data/loader';
import { armorModelFor, hullArmorHalf, rayVsPolyhedron, rayVsVehicle, type VehiclePose } from '../armorModel';

const def = loadGameData().vehicles.get('kestrel_mk1')!;
const pose = (turretYaw = 0): VehiclePose => ({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, turretYaw });

describe('armour polyhedron', () => {
  const hull = armorModelFor(def).hull;
  const half = hullArmorHalf(def);

  it('hits the side plate with an outward normal when fired from the right', () => {
    const hit = rayVsPolyhedron(hull, { x: 20, y: 0, z: 0.5 }, { x: -1, y: 0, z: 0 }, 100)!;
    expect(hit.plane.face).toBe('side');
    expect(hit.t).toBeCloseTo(20 - half.x, 6);
    expect(hit.tExit - hit.t).toBeCloseTo(2 * half.x, 6);
  });

  it('places the sloped glacis according to its slope', () => {
    // Level shot at hull centre height from the front: the glacis plane at
    // y=0 sits hy*tan(56°) behind the nose.
    const hit = rayVsPolyhedron(hull, { x: 0, y: 0, z: -20 }, { x: 0, y: 0, z: 1 }, 100)!;
    expect(hit.plane.face).toBe('front');
    const zAtHit = -20 + hit.t;
    expect(zAtHit).toBeCloseTo(-half.z + half.y * Math.tan(56 * DEG2RAD), 6);
    expect(hit.plane.n.y).toBeCloseTo(Math.sin(56 * DEG2RAD), 9);
  });

  it('misses when the ray passes beside the hull', () => {
    expect(rayVsPolyhedron(hull, { x: 20, y: 0, z: 5 }, { x: -1, y: 0, z: 0 }, 100)).toBeNull();
  });
});

describe('rayVsVehicle', () => {
  const turretHeight = def.turret.offset.y + def.turret.half.y * 0.6;

  it('hits the turret front when aimed at the turret from the front', () => {
    const hit = rayVsVehicle(def, pose(), { x: 0, y: turretHeight, z: -50 }, { x: 0, y: 0, z: 1 }, 100)!;
    expect(hit.part).toBe('turret');
    expect(hit.face).toBe('front');
    expect(hit.plate.mm).toBe(76);
  });

  it('presents the turret side when the turret is traversed 90°', () => {
    const hit = rayVsVehicle(def, pose(90 * DEG2RAD), { x: 0, y: turretHeight, z: -50 }, { x: 0, y: 0, z: 1 }, 100)!;
    expect(hit.part).toBe('turret');
    expect(hit.face).toBe('side');
    // World normal points back towards the shooter.
    expect(dot(hit.normal, { x: 0, y: 0, z: -1 })).toBeGreaterThan(0.9);
  });

  it('respects the vehicle pose (translated and yawed)', () => {
    const yaw = 30 * DEG2RAD;
    const p: VehiclePose = { pos: { x: 100, y: 5, z: 0 }, rot: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, turretYaw: 0 };
    const hit = rayVsVehicle(def, p, { x: 100, y: 5, z: 50 }, { x: 0, y: 0, z: -1 }, 100)!;
    expect(hit.part).toBe('hull');
    expect(length(sub(hit.point, { x: 100, y: 5, z: 50 - hit.t }))).toBeLessThan(1e-9);
  });

  it('respects the segment length', () => {
    expect(rayVsVehicle(def, pose(), { x: 0, y: 0, z: -50 }, { x: 0, y: 0, z: 1 }, 10)).toBeNull();
  });
});
