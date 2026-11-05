/**
 * Armour plate interaction: impact angle, effective (line-of-sight)
 * thickness, ricochet and overmatch. Pure functions.
 */
import { clamp, dot, normalize, type Vec3 } from '../core/math';

const DEG = Math.PI / 180;

/**
 * Impact angle in radians between the shell's direction of travel and the
 * plate normal: 0 = perpendicular hit, PI/2 = grazing.
 * `normal` must point out of the armour (towards the shell).
 */
export function impactAngle(shellDir: Vec3, normal: Vec3): number {
  const c = -dot(normalize(shellDir), normalize(normal));
  return Math.acos(clamp(c, -1, 1));
}

/** Line-of-sight thickness t / cos(theta). Returns Infinity at or beyond grazing. */
export function effectiveThickness(thicknessMm: number, angle: number): number {
  const c = Math.cos(angle);
  return c <= 1e-6 ? Infinity : thicknessMm / c;
}

/** Applies AP-cap normalization, which turns the shell towards the normal on impact. */
export function normalizedAngle(angle: number, normalizationDeg: number): number {
  return Math.max(0, angle - normalizationDeg * DEG);
}

/**
 * Overmatch: when the calibre exceeds three times the plate thickness the
 * shell cannot be deflected regardless of angle.
 */
export function isOvermatch(caliberMm: number, thicknessMm: number): boolean {
  return caliberMm > 3 * thicknessMm;
}

/** Ricochet when the impact angle exceeds the round's threshold, unless overmatched. */
export function isRicochet(angle: number, ricochetAngleDeg: number, caliberMm: number, thicknessMm: number): boolean {
  if (isOvermatch(caliberMm, thicknessMm)) return false;
  return angle > ricochetAngleDeg * DEG;
}

/** Mirror reflection of a direction about a plane normal. */
export function reflect(dir: Vec3, normal: Vec3): Vec3 {
  const n = normalize(normal);
  const k = 2 * dot(dir, n);
  return { x: dir.x - k * n.x, y: dir.y - k * n.y, z: dir.z - k * n.z };
}
