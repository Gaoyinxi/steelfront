/**
 * Cover selection. Scores the map's pre-computed cover points against a
 * threat: the hull must be hidden from the threat, and ideally there is a
 * firing position — either the cover itself (hull-down: gun clears the
 * obstacle) or a short side-step past the obstacle's edge (peek).
 */
import type { Vec3 } from '../core/math';
import type { CoverPoint } from '../world/coverPoints';
import type { Obstacle } from '../world/obstacles';
import type { LineOfSight } from './perception';

export interface CoverQuery {
  self: Vec3;
  threat: Vec3;
  covers: readonly CoverPoint[];
  obstacles: readonly Obstacle[];
  los: LineOfSight;
  isFree: (x: number, z: number) => boolean;
  terrainHeight: (x: number, z: number) => number;
  maxDistance: number;
  /** Indices of cover points not to use (e.g. already compromised). */
  exclude?: ReadonlySet<number>;
  /** Do not pick cover closer than this to the threat (m). */
  minThreatDistance?: number;
  /** Height above ground of the hull area that must be hidden (m). */
  hullHeight?: number;
  /** Height above ground of the gun (m). */
  gunHeight?: number;
  /** Height above ground of the threat's eye (m). */
  threatEyeHeight?: number;
}

export interface CoverChoice {
  /** Index into the cover list. */
  index: number;
  cover: CoverPoint;
  /** Where to fire from, or null if the cover offers no shot. */
  firePos: Vec3 | null;
  /** The cover itself is a hull-down firing position. */
  hullDown: boolean;
  score: number;
}

const MAX_CANDIDATES = 24;
const PEEK_MARGIN = 4.5;

export function chooseCover(q: CoverQuery): CoverChoice | null {
  const hullHeight = q.hullHeight ?? 1.3;
  const gunHeight = q.gunHeight ?? 1.9;
  const eyeHeight = q.threatEyeHeight ?? 2.4;
  const minThreat = q.minThreatDistance ?? 80;
  const threatEye = { x: q.threat.x, y: q.threat.y + eyeHeight, z: q.threat.z };
  const threatBody = { x: q.threat.x, y: q.threat.y + 1.2, z: q.threat.z };
  const at = (x: number, z: number, h: number): Vec3 => ({ x, y: q.terrainHeight(x, z) + h, z });

  const candidates = q.covers
    .map((cover, index) => ({ cover, index, d: Math.hypot(cover.position.x - q.self.x, cover.position.z - q.self.z) }))
    .filter(({ cover, index, d }) => {
      if (d > q.maxDistance || q.exclude?.has(index)) return false;
      const tx = q.threat.x - cover.position.x;
      const tz = q.threat.z - cover.position.z;
      const tLen = Math.hypot(tx, tz);
      if (tLen < minThreat) return false;
      // The obstacle must lie between the cover and the threat.
      return (cover.protectDir.x * tx + cover.protectDir.z * tz) / tLen > 0.55;
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_CANDIDATES);

  let best: CoverChoice | null = null;
  for (const { cover, index, d } of candidates) {
    const p = cover.position;
    if (q.los(threatEye, at(p.x, p.z, hullHeight))) continue; // hull would be exposed

    const tx = q.threat.x - p.x;
    const tz = q.threat.z - p.z;
    const tLen = Math.hypot(tx, tz);
    const protect = (cover.protectDir.x * tx + cover.protectDir.z * tz) / tLen;

    const hullDown = q.los(at(p.x, p.z, gunHeight), threatBody);
    let firePos: Vec3 | null = hullDown ? { ...p } : null;
    if (!firePos) {
      const o = q.obstacles[cover.obstacleId];
      const extent = o ? (o.kind === 'wall' ? o.size.x / 2 : o.radius) : 4;
      // Perpendicular to the threat direction; try the side nearer to us first.
      const lx = tz / tLen;
      const lz = -tx / tLen;
      const towardSelf = (q.self.x - p.x) * lx + (q.self.z - p.z) * lz >= 0 ? 1 : -1;
      for (const side of [towardSelf, -towardSelf]) {
        const fx = p.x + lx * side * (extent + PEEK_MARGIN);
        const fz = p.z + lz * side * (extent + PEEK_MARGIN);
        if (q.isFree(fx, fz) && q.los(at(fx, fz, gunHeight), threatBody)) {
          firePos = { x: fx, y: q.terrainHeight(fx, fz), z: fz };
          break;
        }
      }
    }

    const score = protect - d / 60 + (hullDown ? 2.5 : firePos ? 1.5 : 0);
    if (!best || score > best.score) best = { index, cover, firePos, hullDown, score };
  }
  return best;
}
