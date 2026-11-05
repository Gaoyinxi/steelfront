import { describe, expect, it } from 'vitest';
import { DEG2RAD, type Quat } from '../../core/math';
import { HeightMap } from '../../world/HeightMap';
import type { Obstacle } from '../../world/obstacles';
import { driveTo, headingOf } from '../driving';
import { NavGrid } from '../navGrid';

const flat = (size = 400, res = 101) => new HeightMap(size, res);
const wall = (x: number, z: number, length: number, rotationY = 0, id = 0): Obstacle => ({
  id,
  kind: 'wall',
  position: { x, y: 0, z },
  rotationY,
  size: { x: length, y: 3, z: 0.7 },
  radius: length / 2,
  solid: true,
});
const opts = { cellSize: 4, clearance: 3.5, maxSlopeDeg: 24, edgeMargin: 10 };

describe('NavGrid', () => {
  it('blocks cells around a wall (inflated by clearance) and leaves open ground free', () => {
    const g = NavGrid.build(flat(), [wall(0, 0, 40)], opts);
    expect(g.isFree(0, 0)).toBe(false);
    expect(g.isFree(15, 2.5)).toBe(false); // within 0.35 + 3.5 of the wall face
    expect(g.isFree(0, 8)).toBe(true);
    expect(g.isFree(30, 0)).toBe(true); // beyond the wall end + clearance
  });

  it('respects obstacle rotation', () => {
    const g = NavGrid.build(flat(), [wall(0, 0, 40, 90 * DEG2RAD)], opts);
    // Rotated 90°: the wall now runs along Z.
    expect(g.isFree(0, 15)).toBe(false);
    expect(g.isFree(15, 0)).toBe(true);
  });

  it('routes around a wall and every leg of the smoothed path is drivable', () => {
    const g = NavGrid.build(flat(), [wall(0, 0, 80)], opts);
    const from = { x: 0, y: 0, z: -40 };
    const to = { x: 0, y: 0, z: 40 };
    const path = g.findPath(from, to)!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toMatchObject({ x: 0, z: 40 });
    expect(path.some((p) => Math.abs(p.x) > 40)).toBe(true); // goes round an end
    let prev = from;
    for (const p of path) {
      expect(g.lineFree(prev, p)).toBe(true);
      prev = p;
    }
    expect(path.length).toBeLessThanOrEqual(4); // smoothing removed grid zig-zags
  });

  it('returns a direct path on open ground', () => {
    const g = NavGrid.build(flat(), [], opts);
    expect(g.findPath({ x: -50, y: 0, z: -50 }, { x: 60, y: 0, z: 70 })).toEqual([{ x: 60, y: 0, z: 70 }]);
  });

  it('returns null for an enclosed goal', () => {
    const box = [wall(0, -30, 70, 0, 0), wall(0, 30, 70, 0, 1), wall(-30, 0, 70, 90 * DEG2RAD, 2), wall(30, 0, 70, 90 * DEG2RAD, 3)];
    const g = NavGrid.build(flat(), box, opts);
    expect(g.findPath({ x: 0, y: 0, z: -120 }, { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('blocks slopes steeper than the limit', () => {
    const hm = flat(400, 101);
    // A 35° ramp for x > 0.
    for (let iz = 0; iz < 101; iz++)
      for (let ix = 0; ix < 101; ix++) hm.heights[iz * 101 + ix] = Math.max(0, hm.worldX(ix)) * Math.tan(35 * DEG2RAD);
    const g = NavGrid.build(hm, [], opts);
    expect(g.isFree(-50, 0)).toBe(true);
    expect(g.isFree(50, 0)).toBe(false);
  });
});

describe('driveTo', () => {
  const yaw = (a: number): Quat => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
  const at = (a = 0) => ({ pos: { x: 0, y: 0, z: 0 }, rot: yaw(a) });
  const o = { arriveRadius: 3, slowRadius: 15, maxThrottle: 1 };

  it('reads the hull heading back from its rotation', () => {
    expect(headingOf(yaw(0.7))).toBeCloseTo(0.7, 9);
  });

  it('drives straight at a target dead ahead', () => {
    const c = driveTo(at(), 0, { x: 0, y: 0, z: -100 }, o);
    expect(c.throttle).toBeCloseTo(1, 6);
    expect(c.steer).toBeCloseTo(0, 6);
  });

  it('steers left (negative) towards a target on the left', () => {
    // Facing -Z, the left-hand side is -X.
    const c = driveTo(at(), 5, { x: -20, y: 0, z: -60 }, o);
    expect(c.steer).toBeLessThan(0);
    expect(c.throttle).toBeGreaterThan(0);
  });

  it('pivots in place when the target is behind', () => {
    const c = driveTo(at(), 0, { x: 5, y: 0, z: 60 }, o);
    expect(c.throttle).toBe(0);
    expect(Math.abs(c.steer)).toBe(1);
  });

  it('reverses towards a target behind when asked to', () => {
    const c = driveTo(at(), -2, { x: 0, y: 0, z: 60 }, { ...o, reverse: true });
    expect(c.throttle).toBeLessThan(0);
    expect(c.steer).toBeCloseTo(0, 6);
  });

  it('slows down on approach and reports arrival', () => {
    const near = driveTo(at(), 2, { x: 0, y: 0, z: -6 }, o);
    expect(near.throttle).toBeLessThan(0.5);
    expect(driveTo(at(), 0, { x: 0, y: 0, z: -2 }, o).arrived).toBe(true);
  });
});
