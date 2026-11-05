import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../core/math';
import { loadGameData } from '../../data/loader';
import { generateCoverPoints } from '../../world/coverPoints';
import { HeightMap } from '../../world/HeightMap';
import type { Obstacle } from '../../world/obstacles';
import { chooseCover } from '../cover';
import { eyePoint, recognitionTime, updateRecognition, visibilityPoints, visibleFraction, type LineOfSight } from '../perception';

const def = loadGameData().vehicles.get('kestrel_mk1')!;
const pose = { pos: { x: 0, y: 1.1, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 }, turretYaw: 0 };
const always: LineOfSight = () => true;

describe('perception', () => {
  const points = visibilityPoints(def, pose);

  it('places the eye above the turret roof', () => {
    expect(eyePoint(def, pose).y).toBeGreaterThan(Math.max(...points.map((p) => p.y)));
  });

  it('sees everything in range with clear line of sight, nothing beyond view distance', () => {
    expect(visibleFraction({ x: 0, y: 3, z: 400 }, points, { viewDistance: 900, fov: 7, facing: 0 }, always)).toBe(1);
    expect(visibleFraction({ x: 0, y: 3, z: 1000 }, points, { viewDistance: 900, fov: 7, facing: 0 }, always)).toBe(0);
  });

  it('respects a restricted field of view', () => {
    // Observer at +Z facing -Z (towards the target) vs facing +Z (away).
    const eye = { x: 0, y: 3, z: 300 };
    expect(visibleFraction(eye, points, { viewDistance: 900, fov: Math.PI / 2, facing: 0 }, always)).toBe(1);
    expect(visibleFraction(eye, points, { viewDistance: 900, fov: Math.PI / 2, facing: Math.PI }, always)).toBe(0);
  });

  it('reports partial visibility for a hull-down target', () => {
    const turretOnly: LineOfSight = (_from, to) => to.y > 2.0; // crest hides the hull
    const f = visibleFraction({ x: 0, y: 3, z: 300 }, points, { viewDistance: 900, fov: 7, facing: 0 }, turretOnly);
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
  });

  it('recognises a fully visible target after the recognition time, a partial one later', () => {
    const rt = recognitionTime(450, 1.4, 900);
    expect(rt).toBeCloseTo(1.4, 9);
    let full = 0;
    let partial = 0;
    for (let t = 0; t < rt - 1e-9; t += 0.1) {
      full = updateRecognition(full, 1, 0.1, rt);
      partial = updateRecognition(partial, 0.4, 0.1, rt);
    }
    expect(full).toBeCloseTo(1, 6);
    expect(partial).toBeLessThan(0.7);
    expect(updateRecognition(0.5, 0, 1, rt)).toBeLessThan(0.5);
  });
});

/** Line of sight blocked by axis-aligned obstacle boxes (rotation 0). */
function boxLos(obstacles: Obstacle[]): LineOfSight {
  return (a: Vec3, b: Vec3) => {
    for (const o of obstacles) {
      const min = { x: o.position.x - o.size.x / 2, y: o.position.y, z: o.position.z - o.size.z / 2 };
      const max = { x: o.position.x + o.size.x / 2, y: o.position.y + o.size.y, z: o.position.z + o.size.z / 2 };
      let t0 = 0;
      let t1 = 1;
      let hit = true;
      for (const k of ['x', 'y', 'z'] as const) {
        const d = b[k] - a[k];
        if (Math.abs(d) < 1e-12) {
          if (a[k] < min[k] || a[k] > max[k]) hit = false;
          continue;
        }
        let u = (min[k] - a[k]) / d;
        let v = (max[k] - a[k]) / d;
        if (u > v) [u, v] = [v, u];
        t0 = Math.max(t0, u);
        t1 = Math.min(t1, v);
        if (t0 > t1) hit = false;
      }
      if (hit) return false;
    }
    return true;
  };
}

describe('chooseCover', () => {
  const hm = new HeightMap(800, 81);
  const threat = { x: 0, y: 0, z: -300 };
  const base = {
    threat,
    terrainHeight: () => 0,
    isFree: () => true,
    maxDistance: 150,
  };

  it('hides behind a wall and plans a side-step peek past its end', () => {
    const wall: Obstacle = { id: 0, kind: 'wall', position: { x: 0, y: 0, z: 0 }, rotationY: 0, size: { x: 20, y: 3, z: 0.7 }, radius: 10, solid: true };
    const covers = generateCoverPoints([wall], hm);
    const c = chooseCover({ ...base, self: { x: 6, y: 0, z: 40 }, covers, obstacles: [wall], los: boxLos([wall]) })!;
    expect(c).not.toBeNull();
    expect(c.cover.position.z).toBeGreaterThan(0); // the side away from the threat
    expect(c.hullDown).toBe(false);
    expect(Math.abs(c.firePos!.x)).toBeCloseTo(14.5, 6);
    expect(c.firePos!.x).toBeGreaterThan(0); // steps out on the side nearer to us
  });

  it('prefers a hull-down position behind a low rock', () => {
    const rock: Obstacle = { id: 0, kind: 'rock', position: { x: 0, y: 0, z: 0 }, rotationY: 0, size: { x: 2.5, y: 1.6, z: 2.5 }, radius: 1.8, solid: true };
    const covers = generateCoverPoints([rock], hm);
    const c = chooseCover({ ...base, self: { x: 0, y: 0, z: 30 }, covers, obstacles: [rock], los: boxLos([rock]) })!;
    expect(c.hullDown).toBe(true);
    expect(c.firePos).toEqual(c.cover.position);
  });

  it('honours exclusions and returns null when nothing qualifies', () => {
    const wall: Obstacle = { id: 0, kind: 'wall', position: { x: 0, y: 0, z: 0 }, rotationY: 0, size: { x: 20, y: 3, z: 0.7 }, radius: 10, solid: true };
    const covers = generateCoverPoints([wall], hm);
    const los = boxLos([wall]);
    const first = chooseCover({ ...base, self: { x: 0, y: 0, z: 40 }, covers, obstacles: [wall], los })!;
    expect(chooseCover({ ...base, self: { x: 0, y: 0, z: 40 }, covers, obstacles: [wall], los, exclude: new Set([first.index]) })).toBeNull();
    expect(chooseCover({ ...base, self: { x: 0, y: 0, z: 600 }, covers, obstacles: [wall], los })).toBeNull();
  });
});
