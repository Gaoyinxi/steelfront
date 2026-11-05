import { describe, expect, it } from 'vitest';
import { DEG2RAD, dot, length, normalize, sub } from '../../core/math';
import { Rng } from '../../core/Rng';
import {
  applyDispersion,
  MOA,
  simulateTrajectory,
  solveElevation,
  stepShell,
  vacuumRange,
  vacuumTimeOfFlight,
} from '../ballistics';
import type { ShellState } from '../types';

const DT = 1 / 60;
const launch = (v0: number, elevDeg: number): ShellState => ({
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: v0 * Math.cos(elevDeg * DEG2RAD), y: v0 * Math.sin(elevDeg * DEG2RAD), z: 0 },
});

/** Ground-impact point/time, interpolated between the last two samples. */
function landing(start: ShellState, dragK: number) {
  const path = simulateTrajectory(start, dragK, DT, 200, (s) => s.pos.y < 0 && s.t > 0);
  const b = path[path.length - 1];
  const a = path[path.length - 2];
  const f = a.pos.y / (a.pos.y - b.pos.y);
  return { x: a.pos.x + (b.pos.x - a.pos.x) * f, t: a.t + (b.t - a.t) * f, path };
}

describe('ballistics: drag-free trajectory', () => {
  it.each([2, 10, 30])('matches analytic range and flight time at %d° elevation', (elev) => {
    const v0 = 620;
    const r = landing(launch(v0, elev), 0);
    expect(r.x).toBeCloseTo(vacuumRange(v0, elev * DEG2RAD), -1); // within ~5 m
    expect(Math.abs(r.x / vacuumRange(v0, elev * DEG2RAD) - 1)).toBeLessThan(1e-3);
    expect(Math.abs(r.t - vacuumTimeOfFlight(v0, elev * DEG2RAD))).toBeLessThan(1e-3);
  });

  it('drops by g t²/2 when fired horizontally', () => {
    let s: ShellState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 620, y: 0, z: 0 } };
    for (let i = 0; i < 60; i++) s = stepShell(s, DT, 0);
    expect(s.pos.y).toBeCloseTo(-9.81 / 2, 6);
    expect(s.pos.x).toBeCloseTo(620, 6);
  });
});

describe('ballistics: quadratic drag', () => {
  it('shortens range and monotonically bleeds speed on a flat shot', () => {
    const k = 0.0001;
    const r = landing(launch(620, 5), k);
    expect(r.x).toBeLessThan(vacuumRange(620, 5 * DEG2RAD));
    for (let i = 1; i < r.path.length; i++) {
      // Horizontal speed can only decrease under drag.
      expect(r.path[i].vel.x).toBeLessThan(r.path[i - 1].vel.x);
    }
  });

  it('follows v(x) = v0·e^(-kx) for a gravity-free shot (analytic check)', () => {
    const k = 0.0001;
    let s: ShellState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 620, y: 0, z: 0 } };
    while (s.pos.x < 1000) s = stepShell(s, DT, k, 0);
    expect(s.vel.x).toBeCloseTo(620 * Math.exp(-k * s.pos.x), 1);
  });
});

describe('solveElevation', () => {
  it.each([
    [400, 0],
    [1200, 0],
    [800, -25],
    [600, 30],
  ])('hits a target at dx=%d, dy=%d within 0.3 m (with drag)', (dx, dy) => {
    const v0 = 620;
    const k = 0.0001;
    const elev = solveElevation(v0, dx, dy, k)!;
    expect(elev).not.toBeNull();
    const path = simulateTrajectory(launch(v0, elev / DEG2RAD), k, 1 / 240, 30, (s) => s.pos.x >= dx);
    const a = path[path.length - 2];
    const b = path[path.length - 1];
    const y = a.pos.y + ((b.pos.y - a.pos.y) * (dx - a.pos.x)) / (b.pos.x - a.pos.x);
    expect(Math.abs(y - dy)).toBeLessThan(0.3);
  });

  it('returns null when the target is out of range', () => {
    expect(solveElevation(200, 20000, 0, 0.0001)).toBeNull();
  });
});

describe('applyDispersion', () => {
  const dir = normalize({ x: 0.3, y: 0.05, z: -1 });

  it('is a no-op for zero dispersion', () => {
    expect(length(sub(applyDispersion(dir, 0, new Rng(1)), dir))).toBeLessThan(1e-12);
  });

  it('is deterministic for a given seed', () => {
    expect(applyDispersion(dir, 2, new Rng(42))).toEqual(applyDispersion(dir, 2, new Rng(42)));
  });

  it('produces a radial RMS deviation close to the configured MOA', () => {
    const rng = new Rng(9);
    const moa = 1.5;
    let sumSq = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const d = applyDispersion(dir, moa, rng);
      const ang = Math.acos(Math.min(1, dot(d, dir)));
      sumSq += ang * ang;
    }
    const rms = Math.sqrt(sumSq / n);
    expect(rms / (moa * MOA)).toBeGreaterThan(0.95);
    expect(rms / (moa * MOA)).toBeLessThan(1.05);
  });
});
