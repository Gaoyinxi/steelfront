import { describe, expect, it } from 'vitest';
import { add, dot, scale, sub, type Vec3 } from '../../core/math';
import { loadGameData } from '../../data/loader';
import { stepShell } from '../../combat/ballistics';
import { aimErrorSigma, angleBetween, computeFiringSolution, perturbDirection } from '../gunnery';

const AP = loadGameData().ammo.get('ap_75_l40')!;
const origin: Vec3 = { x: 0, y: 10, z: 0 };

/**
 * Miss distance: closest approach between the shell (fired along `dir`) and a
 * target moving with constant velocity, sampled on a fine timestep.
 */
function missDistance(dir: Vec3, target: Vec3, velocity: Vec3, maxT: number): number {
  const dt = 1 / 2000;
  let s = { pos: origin, vel: scale(dir, AP.muzzleVelocity) };
  let best = Infinity;
  for (let t = 0; t <= maxT; t += dt) {
    const next = stepShell(s, dt, AP.dragK);
    // Distance from the target (at mid-step) to the shell's path segment.
    const p = add(target, scale(velocity, t + dt / 2));
    const seg = sub(next.pos, s.pos);
    const u = Math.max(0, Math.min(1, dot(sub(p, s.pos), seg) / dot(seg, seg)));
    const c = add(s.pos, scale(seg, u));
    best = Math.min(best, Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z));
    s = next;
  }
  return best;
}

/** Shell position at time `t` (only for coarse checks where timing error is irrelevant). */
function shellAt(dir: Vec3, t: number): Vec3 {
  const dt = 1 / 600;
  let s = { pos: origin, vel: scale(dir, AP.muzzleVelocity) };
  for (let k = 0; k < Math.round(t / dt); k++) s = stepShell(s, dt, AP.dragK);
  return s.pos;
}

describe('computeFiringSolution', () => {
  it.each([
    [300, 0],
    [600, -5],
    [1000, 15],
  ])('hits a stationary target at %d m (dy %d m) within 0.3 m', (range, dy) => {
    const target = { x: range * 0.6, y: origin.y + dy, z: -range * 0.8 };
    const still = { x: 0, y: 0, z: 0 };
    const sol = computeFiringSolution({ origin, target, targetVelocity: still, ammo: AP })!;
    expect(missDistance(sol.direction, target, still, sol.timeOfFlight + 0.2)).toBeLessThan(0.05);
  });

  it('leads a crossing target so shell and target meet', () => {
    const target = { x: 0, y: origin.y, z: -500 };
    const v = { x: 9, y: 0, z: 0 }; // ~32 km/h crossing
    const sol = computeFiringSolution({ origin, target, targetVelocity: v, ammo: AP })!;
    const t = sol.timeOfFlight;
    expect(missDistance(sol.direction, target, v, t + 0.2)).toBeLessThan(0.1);
    // Without lead the same shot would miss by roughly v * t.
    const noLead = computeFiringSolution({ origin, target, targetVelocity: { x: 0, y: 0, z: 0 }, ammo: AP })!;
    expect(missDistance(noLead.direction, target, v, t + 0.2)).toBeGreaterThan(9 * t * 0.9);
  });

  it('a range over-estimate makes the shot fly high', () => {
    const target = { x: 0, y: origin.y, z: -800 };
    const sol = computeFiringSolution({ origin, target, targetVelocity: { x: 0, y: 0, z: 0 }, ammo: AP, rangeError: 0.1 })!;
    const exact = computeFiringSolution({ origin, target, targetVelocity: { x: 0, y: 0, z: 0 }, ammo: AP })!;
    expect(sol.elevation).toBeGreaterThan(exact.elevation);
    const p = shellAt(sol.direction, exact.timeOfFlight);
    expect(p.y - target.y).toBeGreaterThan(0.5);
  });

  it('returns null beyond maximum range', () => {
    expect(
      computeFiringSolution({ origin, target: { x: 0, y: 0, z: -60000 }, targetVelocity: { x: 0, y: 0, z: 0 }, ammo: AP }),
    ).toBeNull();
  });
});

describe('aim error model', () => {
  it('perturbs a direction by the requested small angles', () => {
    const d = { x: 0, y: 0, z: -1 };
    expect(angleBetween(d, perturbDirection(d, 0.003, 0.004))).toBeCloseTo(0.005, 5);
  });

  const base = { baseMrad: 2, aimTime: 0, settleTimeS: 2, targetSpeed: 0, ownSpeed: 0, shotsAtTarget: 0 };

  it('starts at three times the settled error and settles with time on target', () => {
    expect(aimErrorSigma(base)).toBeCloseTo(0.006, 9);
    expect(aimErrorSigma({ ...base, aimTime: 30 })).toBeCloseTo(0.002, 6);
  });

  it('grows with motion and shrinks with bracketing shots', () => {
    const settled = { ...base, aimTime: 30 };
    expect(aimErrorSigma({ ...settled, targetSpeed: 10 })).toBeGreaterThan(aimErrorSigma(settled));
    expect(aimErrorSigma({ ...settled, ownSpeed: 5 })).toBeGreaterThan(aimErrorSigma(settled));
    expect(aimErrorSigma({ ...settled, shotsAtTarget: 2 })).toBeCloseTo(aimErrorSigma(settled) * 0.64, 9);
    expect(aimErrorSigma({ ...settled, shotsAtTarget: 20 })).toBeCloseTo(aimErrorSigma(settled) * 0.5, 9);
  });
});
