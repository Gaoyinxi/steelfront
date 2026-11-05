import { createNoise2D } from 'simplex-noise';
import { Rng } from '../core/Rng';
import type { MapDef } from '../data/schema';
import { HeightMap } from './HeightMap';

/**
 * Procedural terrain: fractal simplex noise for rolling hills, a fine detail
 * layer, ridged noise for occasional crests, and raised map borders that act
 * as a natural boundary.
 */
export function generateTerrain(map: MapDef): HeightMap {
  const { size, resolution, terrain: t } = map;
  const rng = new Rng(map.seed);
  const hills = createNoise2D(() => rng.next());
  const detail = createNoise2D(() => rng.next());
  const ridges = createNoise2D(() => rng.next());

  const hm = new HeightMap(size, resolution);
  const half = size / 2;

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const x = hm.worldX(ix);
      const z = hm.worldZ(iz);

      // Fractal Brownian motion for large-scale hills.
      let amp = 1;
      let freq = 1 / t.hillScale;
      let h = 0;
      let norm = 0;
      for (let o = 0; o < t.octaves; o++) {
        h += amp * hills(x * freq, z * freq);
        norm += amp;
        amp *= 0.5;
        freq *= 2;
      }
      h = (h / norm) * t.hillAmplitude;

      // Ridged layer: sharp crests that create natural hull-down positions.
      const r = 1 - Math.abs(ridges(x / (t.hillScale * 0.7), z / (t.hillScale * 0.7)));
      h += r * r * r * t.hillAmplitude * 0.35;

      // Small-scale bumps.
      h += detail(x / t.detailScale, z / t.detailScale) * t.detailAmplitude;

      // Raised borders.
      const edgeDist = Math.min(half - Math.abs(x), half - Math.abs(z));
      if (edgeDist < t.edgeWidth) {
        const k = 1 - edgeDist / t.edgeWidth;
        h += t.edgeRise * k * k;
      }

      hm.heights[iz * resolution + ix] = t.baseHeight + h;
    }
  }

  flattenAround(hm, map.spawns.teamA, map.spawns.clearRadius);
  flattenAround(hm, map.spawns.teamB, map.spawns.clearRadius);
  hm.recomputeBounds();
  return hm;
}

/** Smoothly blends terrain towards its local mean so spawns are drivable. */
function flattenAround(hm: HeightMap, [cx, cz]: readonly [number, number], radius: number): void {
  const target = hm.sample(cx, cz);
  const r = hm.resolution;
  for (let iz = 0; iz < r; iz++) {
    for (let ix = 0; ix < r; ix++) {
      const d = Math.hypot(hm.worldX(ix) - cx, hm.worldZ(iz) - cz);
      if (d > radius * 1.5) continue;
      const w = d < radius ? 0.85 : 0.85 * (1 - (d - radius) / (radius * 0.5));
      const i = iz * r + ix;
      hm.heights[i] = hm.heights[i] * (1 - w) + target * w;
    }
  }
}
