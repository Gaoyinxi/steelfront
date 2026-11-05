import type { Vec3 } from '../core/math';
import type { HeightMap } from './HeightMap';
import type { Obstacle } from './obstacles';

export interface CoverPoint {
  position: Vec3;
  obstacleId: number;
  /**
   * Unit XZ direction from the point towards the obstacle. The point offers
   * protection against threats roughly in this direction.
   */
  protectDir: Vec3;
}

/**
 * Pre-computes candidate cover positions around solid obstacles tall enough
 * to hide a hull (>= 1.6 m). AI selects among them at runtime by threat
 * direction and line-of-sight checks.
 */
export function generateCoverPoints(obstacles: Obstacle[], hm: HeightMap): CoverPoint[] {
  const points: CoverPoint[] = [];
  const standoff = 4.0; // half a hull length plus clearance
  for (const o of obstacles) {
    if (!o.solid || o.kind === 'tree' || o.size.y < 1.6) continue;
    const dirs = o.kind === 'wall' ? 2 : 8;
    for (let i = 0; i < dirs; i++) {
      // Walls: the two long faces; others: 8 compass directions.
      const a = o.kind === 'wall' ? o.rotationY + (i === 0 ? 0 : Math.PI) : (i / dirs) * Math.PI * 2;
      const nx = Math.sin(a);
      const nz = Math.cos(a);
      const reach = (o.kind === 'wall' ? o.size.z / 2 : o.radius) + standoff;
      const x = o.position.x + nx * reach;
      const z = o.position.z + nz * reach;
      if (!hm.contains(x, z)) continue;
      if (obstacles.some((p) => p !== o && Math.hypot(p.position.x - x, p.position.z - z) < p.radius + 3)) continue;
      points.push({
        position: { x, y: hm.sample(x, z), z },
        obstacleId: o.id,
        protectDir: { x: -nx, y: 0, z: -nz },
      });
    }
  }
  return points;
}
