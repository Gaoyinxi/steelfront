import { describe, expect, it } from 'vitest';
import { loadGameData } from './loader';

describe('game data', () => {
  it('loads and validates every JSON file under /data', () => {
    const data = loadGameData();
    expect(data.vehicles.size).toBeGreaterThan(0);
    expect(data.ammo.size).toBeGreaterThanOrEqual(2);
    expect(data.maps.size).toBeGreaterThan(0);
  });

  it('converts design-frame forward (+z) to sim-frame forward (-z)', () => {
    const v = loadGameData().vehicles.get('kestrel_mk1')!;
    const driver = v.modules.find((m) => m.role === 'driver')!;
    expect(driver.pos.z).toBeLessThan(0); // driver sits at the front
    expect(v.mobility.maxSpeedFwd).toBeCloseTo(42 / 3.6, 6);
  });
});
