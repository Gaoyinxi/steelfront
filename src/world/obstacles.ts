import { DEG2RAD, type Vec3 } from '../core/math';
import { Rng } from '../core/Rng';
import type { MapDef } from '../data/schema';
import type { HeightMap } from './HeightMap';

export type ObstacleKind = 'rock' | 'wall' | 'building' | 'tree';

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** Centre of the footprint at its base height. */
  position: Vec3;
  rotationY: number;
  /** Full dimensions (x = width, y = height, z = depth) in local frame. */
  size: Vec3;
  /** Footprint bounding radius on the XZ plane. */
  radius: number;
  /** Whether the obstacle stops shells and blocks line of sight. */
  solid: boolean;
}

interface Placement {
  kind: ObstacleKind;
  size: Vec3;
}

/** Seeded, deterministic placement of cover and obstacles. */
export function generateObstacles(map: MapDef, hm: HeightMap): Obstacle[] {
  const rng = new Rng(map.seed ^ 0x9e3779b9);
  const out: Obstacle[] = [];
  const limit = hm.half - map.terrain.edgeWidth - map.terrain.playableMargin * 0.25;
  const maxSlope = map.obstacles.maxSlopeDeg * DEG2RAD;
  const spawns = [map.spawns.teamA, map.spawns.teamB];

  const tryPlace = (p: Placement, near?: { x: number; z: number; spread: number }): boolean => {
    const radius = Math.hypot(p.size.x, p.size.z) / 2;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = near ? near.x + rng.range(-near.spread, near.spread) : rng.range(-limit, limit);
      const z = near ? near.z + rng.range(-near.spread, near.spread) : rng.range(-limit, limit);
      if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
      if (hm.slope(x, z) > maxSlope) continue;
      if (spawns.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < map.spawns.clearRadius + radius)) continue;
      const minGap = p.kind === 'tree' ? 0.5 : 4;
      if (out.some((o) => Math.hypot(o.position.x - x, o.position.z - z) < o.radius + radius + minGap)) continue;

      const rotationY = rng.range(0, Math.PI * 2);
      // Rest on the lowest corner so nothing floats on slopes.
      const base = footprintMinHeight(hm, x, z, p.size, rotationY);
      const sink = p.kind === 'rock' ? p.size.y * 0.25 : 0.3;
      out.push({
        id: out.length,
        kind: p.kind,
        position: { x, y: base - sink, z },
        rotationY,
        size: p.size,
        radius,
        solid: true,
      });
      return true;
    }
    return false;
  };

  for (let i = 0; i < map.obstacles.buildings; i++) {
    tryPlace({ kind: 'building', size: { x: rng.range(8, 14), y: rng.range(4.5, 8), z: rng.range(7, 12) } });
  }
  for (let i = 0; i < map.obstacles.walls; i++) {
    tryPlace({ kind: 'wall', size: { x: rng.range(6, 16), y: rng.range(1.8, 3.2), z: 0.7 } });
  }
  for (let i = 0; i < map.obstacles.rocks; i++) {
    const s = rng.range(1.5, 5.5);
    tryPlace({ kind: 'rock', size: { x: s * rng.range(0.8, 1.4), y: s * rng.range(0.6, 1.1), z: s } });
  }
  for (let i = 0; i < map.obstacles.treeClusters; i++) {
    const cx = rng.range(-limit, limit);
    const cz = rng.range(-limit, limit);
    const count = rng.int(4, 11);
    for (let k = 0; k < count; k++) {
      const h = rng.range(8, 15);
      tryPlace({ kind: 'tree', size: { x: 0.6, y: h, z: 0.6 } }, { x: cx, z: cz, spread: 18 });
    }
  }
  return out;
}

function footprintMinHeight(hm: HeightMap, x: number, z: number, size: Vec3, rotY: number): number {
  const c = Math.cos(rotY);
  const s = Math.sin(rotY);
  let minH = hm.sample(x, z);
  for (const [lx, lz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const ox = (lx * size.x) / 2;
    const oz = (lz * size.z) / 2;
    minH = Math.min(minH, hm.sample(x + ox * c + oz * s, z - ox * s + oz * c));
  }
  return minH;
}
