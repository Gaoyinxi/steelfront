import { describe, expect, it } from 'vitest';
import { DEG2RAD, dot, normalize } from '../../core/math';
import { loadGameData } from '../../data/loader';
import { effectiveThickness, impactAngle, isOvermatch, isRicochet, normalizedAngle, reflect } from '../armor';
import { penetrationAtRange, resolvePlateImpact } from '../penetration';

const data = loadGameData();
const AP = data.ammo.get('ap_75_l40')!;
const HE = data.ammo.get('he_75_l40')!;

/** Shell direction hitting a plate (normal +Z) at `deg` from the normal. */
const shellAt = (deg: number) => ({ x: Math.sin(deg * DEG2RAD), y: 0, z: -Math.cos(deg * DEG2RAD) });
const N = { x: 0, y: 0, z: 1 };

describe('impact angle and effective thickness', () => {
  it.each([0, 30, 45, 60, 80])('measures %d° from the plate normal', (deg) => {
    expect(impactAngle(shellAt(deg), N) / DEG2RAD).toBeCloseTo(deg, 6);
  });

  it('computes t / cos θ', () => {
    expect(effectiveThickness(50, 0)).toBeCloseTo(50, 9);
    expect(effectiveThickness(50, 60 * DEG2RAD)).toBeCloseTo(100, 6);
    expect(effectiveThickness(80, 45 * DEG2RAD)).toBeCloseTo(80 * Math.SQRT2, 6);
    expect(effectiveThickness(50, Math.PI / 2)).toBe(Infinity);
  });

  it('applies normalization without going negative', () => {
    expect(normalizedAngle(30 * DEG2RAD, 5) / DEG2RAD).toBeCloseTo(25, 9);
    expect(normalizedAngle(3 * DEG2RAD, 5)).toBe(0);
  });
});

describe('ricochet and overmatch', () => {
  it('ricochets only beyond the threshold', () => {
    expect(isRicochet(69.9 * DEG2RAD, 70, 75, 50)).toBe(false);
    expect(isRicochet(70.1 * DEG2RAD, 70, 75, 50)).toBe(true);
  });

  it('never ricochets when the calibre overmatches the plate (> 3t)', () => {
    expect(isOvermatch(75, 20)).toBe(true);
    expect(isRicochet(85 * DEG2RAD, 70, 75, 20)).toBe(false);
    expect(isOvermatch(75, 25)).toBe(false);
  });

  it('reflects about the plate normal', () => {
    const d = normalize(shellAt(75));
    const r = reflect(d, N);
    expect(dot(r, N)).toBeCloseTo(-dot(d, N), 9);
    expect(r.x).toBeCloseTo(d.x, 9);
  });
});

describe('penetrationAtRange', () => {
  const table = AP.penetration;
  it('returns table values at table points and interpolates between', () => {
    expect(penetrationAtRange(table, 10)).toBeCloseTo(92, 9);
    expect(penetrationAtRange(table, 500)).toBeCloseTo(81, 9);
    expect(penetrationAtRange(table, 750)).toBeCloseTo(75.5, 9);
  });
  it('clamps before the first point and extrapolates (non-negative) after the last', () => {
    expect(penetrationAtRange(table, 0)).toBe(92);
    expect(penetrationAtRange(table, 3000)).toBeCloseTo(52 - 18, 6);
    expect(penetrationAtRange(table, 1e6)).toBe(0);
  });
  it('is monotonically non-increasing with range', () => {
    let prev = Infinity;
    for (let r = 0; r <= 4000; r += 50) {
      const p = penetrationAtRange(table, r);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('resolvePlateImpact', () => {
  it('fails to penetrate the 50 mm @ 56° glacis at 500 m (≈89 mm effective vs 81 mm)', () => {
    // Glacis normal tilted 56° up from horizontal-forward; shell flies level into it.
    const n = { x: 0, y: Math.sin(56 * DEG2RAD), z: Math.cos(56 * DEG2RAD) };
    const r = resolvePlateImpact({ ammo: AP, range: 500, shellDir: { x: 0, y: 0, z: -1 }, normal: n, thicknessMm: 50 });
    expect(r.result).toBe('nonPenetration');
    expect(r.effectiveMm).toBeCloseTo(50 / Math.cos(56 * DEG2RAD), 6);
  });

  it('penetrates the 38 mm side at 30° and reports residual penetration', () => {
    const r = resolvePlateImpact({ ammo: AP, range: 300, shellDir: shellAt(30), normal: N, thicknessMm: 38 });
    expect(r.result).toBe('penetration');
    expect(r.residualMm).toBeCloseTo(r.penetrationMm - 38 / Math.cos(30 * DEG2RAD), 6);
  });

  it('ricochets off a steep hit regardless of penetration', () => {
    const r = resolvePlateImpact({ ammo: AP, range: 100, shellDir: shellAt(75), normal: N, thicknessMm: 30 });
    expect(r.result).toBe('ricochet');
  });

  it('HE (13 mm) cannot penetrate 19 mm roof armour but defeats 10 mm', () => {
    const roof = { x: 0, y: 1, z: 0 };
    const down = { x: 0, y: -1, z: 0 };
    expect(resolvePlateImpact({ ammo: HE, range: 200, shellDir: down, normal: roof, thicknessMm: 19 }).result).toBe(
      'nonPenetration',
    );
    expect(resolvePlateImpact({ ammo: HE, range: 200, shellDir: down, normal: roof, thicknessMm: 10 }).result).toBe(
      'penetration',
    );
  });
});
