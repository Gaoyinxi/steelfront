/**
 * Penetration model (decision 4A): penetration vs range is tabulated per
 * round and linearly interpolated; the impact is then resolved against the
 * plate's effective thickness. Pure functions.
 */
import type { Vec3 } from '../core/math';
import type { AmmoDef } from '../data/schema';
import { effectiveThickness, impactAngle, isRicochet, normalizedAngle } from './armor';

export interface PenPoint {
  range: number;
  mm: number;
}

/**
 * Penetration (mm RHA at 0°) at a given range. Linear interpolation between
 * table points, constant before the first point, linear extrapolation of the
 * last segment beyond the table (never below zero).
 */
export function penetrationAtRange(table: readonly PenPoint[], range: number): number {
  if (table.length === 1 || range <= table[0].range) return table[0].mm;
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1];
    const b = table[i];
    if (range <= b.range) return a.mm + ((b.mm - a.mm) * (range - a.range)) / (b.range - a.range);
  }
  const a = table[table.length - 2];
  const b = table[table.length - 1];
  return Math.max(0, b.mm + ((b.mm - a.mm) * (range - b.range)) / (b.range - a.range));
}

export type PlateResult = 'ricochet' | 'penetration' | 'nonPenetration';

export interface PlateImpactInput {
  ammo: AmmoDef;
  /** Distance travelled by the shell (m). */
  range: number;
  shellDir: Vec3;
  /** Outward plate normal at the impact point. */
  normal: Vec3;
  thicknessMm: number;
}

export interface PlateImpactResult {
  result: PlateResult;
  /** Raw impact angle (radians). */
  angle: number;
  /** Angle after normalization (radians). */
  effectiveAngle: number;
  /** Line-of-sight thickness (mm). */
  effectiveMm: number;
  /** Shell penetration at this range (mm). */
  penetrationMm: number;
  /** Penetration left after defeating the plate (mm, 0 if not penetrated). */
  residualMm: number;
}

export function resolvePlateImpact(i: PlateImpactInput): PlateImpactResult {
  const angle = impactAngle(i.shellDir, i.normal);
  const effectiveAngle = normalizedAngle(angle, i.ammo.normalizationDeg);
  const effectiveMm = effectiveThickness(i.thicknessMm, effectiveAngle);
  const penetrationMm = penetrationAtRange(i.ammo.penetration, i.range);
  const base = { angle, effectiveAngle, effectiveMm, penetrationMm };

  if (isRicochet(angle, i.ammo.ricochetAngleDeg, i.ammo.caliberMm, i.thicknessMm)) {
    return { ...base, result: 'ricochet', residualMm: 0 };
  }
  if (penetrationMm >= effectiveMm) {
    return { ...base, result: 'penetration', residualMm: penetrationMm - effectiveMm };
  }
  return { ...base, result: 'nonPenetration', residualMm: 0 };
}
