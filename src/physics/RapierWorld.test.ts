import { beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../core/Rng';
import { HeightMap } from '../world/HeightMap';
import { Layer } from './PhysicsWorld';
import { initRapier, RapierWorld } from './RapierWorld';

describe('RapierWorld heightfield', () => {
  beforeAll(async () => {
    await initRapier();
  });

  it('matches HeightMap.sample (orientation and triangle split)', () => {
    const res = 33;
    const hm = new HeightMap(64, res);
    const rng = new Rng(7);
    for (let i = 0; i < hm.heights.length; i++) hm.heights[i] = rng.range(-3, 3);
    hm.recomputeBounds();
    const pw = new RapierWorld();
    pw.addHeightField(hm);
    let maxErr = 0;
    for (let i = 0; i < 200; i++) {
      const x = rng.range(-31, 31);
      const z = rng.range(-31, 31);
      const hit = pw.raycast({ x, y: 50, z }, { x: 0, y: -1, z: 0 }, 100, { layers: Layer.Terrain });
      expect(hit).not.toBeNull();
      maxErr = Math.max(maxErr, Math.abs(hit!.point.y - hm.sample(x, z)));
    }
    expect(maxErr).toBeLessThan(1e-3);
  });
});
