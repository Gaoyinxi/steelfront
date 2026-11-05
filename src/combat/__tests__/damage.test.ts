import { describe, expect, it } from 'vitest';
import { add, rotateVec } from '../../core/math';
import { Rng } from '../../core/Rng';
import { loadGameData } from '../../data/loader';
import { rayVsVehicle, type VehiclePose } from '../armorModel';
import { blastRadius, computeInternalDamage, moduleBoxes, pointBoxDistance, rayVsBox } from '../damage';

const data = loadGameData();
const def = data.vehicles.get('kestrel_mk1')!;
const AP = data.ammo.get('ap_75_l40')!;
const HE = data.ammo.get('he_75_l40')!;
const pose: VehiclePose = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, turretYaw: 0 };
const idx = (pred: (m: (typeof def.modules)[number]) => boolean) => def.modules.findIndex(pred);

describe('module geometry', () => {
  it('ray/box and point/box distance behave as expected', () => {
    const box = { index: 0, centre: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, half: { x: 1, y: 1, z: 1 } };
    expect(rayVsBox(box, { x: -5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10)).toBeCloseTo(4, 9);
    expect(rayVsBox(box, { x: -5, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 10)).toBeNull();
    expect(rayVsBox(box, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10)).toBe(0);
    expect(pointBoxDistance(box, { x: 3, y: 0, z: 0 })).toBeCloseTo(2, 9);
  });

  it('turret modules follow turret traverse', () => {
    const g = idx((m) => m.role === 'gunner');
    const a = moduleBoxes(def, pose)[g].centre;
    const b = moduleBoxes(def, { ...pose, turretYaw: Math.PI })[g].centre;
    expect(b.x).toBeCloseTo(-a.x, 6);
    expect(b.z).toBeCloseTo(2 * def.turret.offset.z - a.z, 6);
  });
});

describe('computeInternalDamage', () => {
  /** Penetrating side shot aimed at a given module centre. */
  function sideShotAt(moduleIndex: number, ammo = AP, residualMm = 40, seed = 1) {
    const target = moduleBoxes(def, pose)[moduleIndex].centre;
    const origin = add(target, { x: 30, y: 0, z: 0 });
    const dir = { x: -1, y: 0, z: 0 };
    const hit = rayVsVehicle(def, pose, origin, dir, 100)!;
    return computeInternalDamage({
      def,
      pose,
      ammo,
      entry: hit.point,
      dir,
      interiorLength: hit.interiorLength,
      residualMm,
      rng: new Rng(seed),
    });
  }

  it('the shell body knocks out the module on its path (driver)', () => {
    const driver = idx((m) => m.role === 'driver');
    const dmg = sideShotAt(driver);
    const d = dmg.find((x) => x.index === driver)!;
    expect(d.sources).toContain('shell');
    expect(d.damage).toBeGreaterThanOrEqual(def.modules[driver].hp);
  });

  it('is deterministic for a seed and varies spall between seeds', () => {
    const engine = idx((m) => m.type === 'engine');
    expect(sideShotAt(engine, AP, 40, 5)).toEqual(sideShotAt(engine, AP, 40, 5));
    expect(sideShotAt(engine, AP, 40, 5)).not.toEqual(sideShotAt(engine, AP, 40, 6));
  });

  it('explosive filler damages modules within the blast radius', () => {
    const rack = idx((m) => m.type === 'ammoRack');
    const dmg = sideShotAt(rack, HE, 5);
    expect(dmg.some((x) => x.sources.includes('blast'))).toBe(true);
    expect(blastRadius(HE.explosiveMassKg)).toBeGreaterThan(2);
    // AP solid shot never produces blast damage.
    expect(sideShotAt(rack, AP).some((x) => x.sources.includes('blast'))).toBe(false);
  });

  it('turret-local modules are reachable through the turret side', () => {
    const loader = idx((m) => m.role === 'loader');
    const c = moduleBoxes(def, pose)[loader].centre;
    expect(c.y).toBeGreaterThan(def.turret.offset.y - 0.5);
    expect(rotateVec(pose.rot, c)).toEqual(c);
    expect(sideShotAt(loader).some((x) => x.index === loader)).toBe(true);
  });
});
