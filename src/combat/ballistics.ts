/**
 * Exterior ballistics. Pure functions only: no ECS, physics engine or
 * rendering dependencies, so they are deterministic and unit-testable and can
 * be reused by AI gunnery and (later) server-side hit validation.
 *
 * Model: point mass under gravity with quadratic drag  a = g - k |v| v,
 * integrated with the classic 4th-order Runge-Kutta method.
 */
import { add, cross, normalize, scale, type Vec3 } from '../core/math';
import type { Rng } from '../core/Rng';
import { GRAVITY, type ShellState } from './types';

const accel = (v: Vec3, dragK: number, g: number): Vec3 => {
  const speed = Math.hypot(v.x, v.y, v.z);
  const d = -dragK * speed;
  return { x: d * v.x, y: d * v.y - g, z: d * v.z };
};

/** Advances a shell by one timestep (RK4). Returns a new state. */
export function stepShell(s: ShellState, dt: number, dragK: number, g = GRAVITY): ShellState {
  const k1v = accel(s.vel, dragK, g);
  const k1p = s.vel;
  const v2 = add(s.vel, scale(k1v, dt / 2));
  const k2v = accel(v2, dragK, g);
  const k2p = v2;
  const v3 = add(s.vel, scale(k2v, dt / 2));
  const k3v = accel(v3, dragK, g);
  const k3p = v3;
  const v4 = add(s.vel, scale(k3v, dt));
  const k4v = accel(v4, dragK, g);
  const k4p = v4;
  const sum = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => ({
    x: (a.x + 2 * b.x + 2 * c.x + d.x) / 6,
    y: (a.y + 2 * b.y + 2 * c.y + d.y) / 6,
    z: (a.z + 2 * b.z + 2 * c.z + d.z) / 6,
  });
  return {
    pos: add(s.pos, scale(sum(k1p, k2p, k3p, k4p), dt)),
    vel: add(s.vel, scale(sum(k1v, k2v, k3v, k4v), dt)),
  };
}

export interface TrajectorySample {
  t: number;
  pos: Vec3;
  vel: Vec3;
  /** Path length travelled so far (m). */
  distance: number;
}

/**
 * Simulates a full trajectory until `stop` returns true or `maxTime` elapses.
 * Returns the sampled path (one sample per step, including the start).
 */
export function simulateTrajectory(
  start: ShellState,
  dragK: number,
  dt: number,
  maxTime: number,
  stop: (s: TrajectorySample) => boolean,
  g = GRAVITY,
): TrajectorySample[] {
  let s = start;
  let t = 0;
  let distance = 0;
  const out: TrajectorySample[] = [{ t, pos: s.pos, vel: s.vel, distance }];
  while (t < maxTime) {
    const next = stepShell(s, dt, dragK, g);
    distance += Math.hypot(next.pos.x - s.pos.x, next.pos.y - s.pos.y, next.pos.z - s.pos.z);
    t += dt;
    s = next;
    const sample = { t, pos: s.pos, vel: s.vel, distance };
    out.push(sample);
    if (stop(sample)) break;
  }
  return out;
}

/** Drag-free range on flat ground (analytic). */
export function vacuumRange(v0: number, elevation: number, g = GRAVITY): number {
  return (v0 * v0 * Math.sin(2 * elevation)) / g;
}

/** Drag-free time of flight on flat ground (analytic). */
export function vacuumTimeOfFlight(v0: number, elevation: number, g = GRAVITY): number {
  return (2 * v0 * Math.sin(elevation)) / g;
}

/** Height and time at which a trajectory reaches horizontal distance `dx`; null if it never does. */
function stateAtRange(
  v0: number,
  elev: number,
  dx: number,
  dragK: number,
  dt: number,
  g: number,
): { y: number; t: number } | null {
  let s: ShellState = { pos: { x: 0, y: 0, z: 0 }, vel: { x: v0 * Math.cos(elev), y: v0 * Math.sin(elev), z: 0 } };
  for (let t = 0; t < 30; t += dt) {
    const n = stepShell(s, dt, dragK, g);
    if (n.pos.x >= dx) {
      const f = (dx - s.pos.x) / (n.pos.x - s.pos.x);
      return { y: s.pos.y + (n.pos.y - s.pos.y) * f, t: t + f * dt };
    }
    if (n.vel.x <= 0) return null;
    s = n;
  }
  return null;
}

export interface FiringSolution {
  /** Launch elevation relative to horizontal (radians). */
  elevation: number;
  /** Time for the shell to reach the target's horizontal distance (s). */
  timeOfFlight: number;
}

export interface SolveOptions {
  dt?: number;
  g?: number;
  /** Bisection iterations; 22 gives ~2e-7 rad, plenty for gunnery. */
  iterations?: number;
}

/**
 * Elevation (low arc) and time of flight needed to hit a point at horizontal
 * distance `dx` and height difference `dy`. Solved numerically by bisection
 * on the simulated trajectory, so it accounts for drag. Returns null if the
 * target is out of range.
 */
export function solveFiringSolution(
  v0: number,
  dx: number,
  dy: number,
  dragK: number,
  opts: SolveOptions = {},
): FiringSolution | null {
  const dt = opts.dt ?? 1 / 120;
  const g = opts.g ?? GRAVITY;
  const iterations = opts.iterations ?? 40;
  const heightAt = (elev: number) => stateAtRange(v0, elev, dx, dragK, dt, g)?.y ?? null;

  let lo = Math.atan2(dy, dx) - 0.05;
  let hi = Math.PI / 4;
  const hHi = heightAt(hi);
  if (hHi === null || hHi < dy) return null;
  const hLo = heightAt(lo);
  let elevation: number;
  if (hLo !== null && hLo > dy) {
    elevation = lo;
  } else {
    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) / 2;
      const h = heightAt(mid);
      if (h !== null && h > dy) hi = mid;
      else lo = mid;
    }
    elevation = (lo + hi) / 2;
  }
  const at = stateAtRange(v0, elevation, dx, dragK, dt, g);
  return at ? { elevation, timeOfFlight: at.t } : null;
}

/** Elevation-only convenience wrapper around `solveFiringSolution`. */
export function solveElevation(
  v0: number,
  dx: number,
  dy: number,
  dragK: number,
  dt = 1 / 120,
  g = GRAVITY,
): number | null {
  return solveFiringSolution(v0, dx, dy, dragK, { dt, g })?.elevation ?? null;
}

/** 1 MOA in radians. */
export const MOA = Math.PI / (180 * 60);

/**
 * Applies gun dispersion: deviates `dir` by a random angle within a cone.
 * `dispersionMoa` is the 1-sigma radial dispersion; the deviation follows a
 * 2-D normal distribution, as for real gun groupings.
 */
export function applyDispersion(dir: Vec3, dispersionMoa: number, rng: Rng): Vec3 {
  if (dispersionMoa <= 0) return normalize(dir);
  const d = normalize(dir);
  // Orthonormal basis perpendicular to d.
  const helper = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(d, helper));
  const w = cross(u, d);
  const sigma = (dispersionMoa * MOA) / Math.SQRT2;
  const a = rng.gaussian() * sigma;
  const b = rng.gaussian() * sigma;
  return normalize(add(d, add(scale(u, Math.tan(a)), scale(w, Math.tan(b)))));
}
