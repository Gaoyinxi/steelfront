import { describe, expect, it } from 'vitest';
import { loadGameData } from '../data/loader';
import { buildGameMap } from './GameMap';
import { HeightMap } from './HeightMap';

describe('HeightMap.sample', () => {
  it('reproduces grid values at vertices and interpolates linearly on a plane', () => {
    const hm = new HeightMap(10, 11);
    for (let iz = 0; iz < 11; iz++) for (let ix = 0; ix < 11; ix++) hm.heights[iz * 11 + ix] = ix * 0.5 + iz * 0.25;
    expect(hm.sample(hm.worldX(3), hm.worldZ(4))).toBeCloseTo(2.5, 6);
    expect(hm.sample(0.37, -1.2)).toBeCloseTo((0.37 + 5) * 0.5 + (-1.2 + 5) * 0.25, 6);
  });
});

describe('map generation', () => {
  const def = loadGameData().maps.get('meadow_01')!;

  it('is deterministic for a given seed', () => {
    const a = buildGameMap(def);
    const b = buildGameMap(def);
    expect(a.height.heights).toEqual(b.height.heights);
    expect(a.obstacles).toEqual(b.obstacles);
  });

  it('places obstacles and cover, keeping spawns clear', () => {
    const m = buildGameMap(def);
    expect(m.obstacles.length).toBeGreaterThan(100);
    expect(m.cover.length).toBeGreaterThan(50);
    for (const [sx, sz] of [def.spawns.teamA, def.spawns.teamB]) {
      for (const o of m.obstacles) {
        expect(Math.hypot(o.position.x - sx, o.position.z - sz)).toBeGreaterThan(def.spawns.clearRadius);
      }
    }
  });
});
