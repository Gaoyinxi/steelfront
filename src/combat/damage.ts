/**
 * Behind-armour effects after a penetration: the shell body continues along
 * its path, spall fragments spread in a cone, and explosive filler (APHE/HE)
 * detonates inside. Produces per-module damage. Pure, deterministic for a
 * given Rng state.
 */
import { add, clamp, cross, inverseRotateVec, normalize, rotateVec, scale, sub, type Quat, type Vec3 } from '../core/math';
import type { Rng } from '../core/Rng';
import type { AmmoDef, VehicleDef } from '../data/schema';
import { turretRotation, type VehiclePose } from './armorModel';

export interface ModuleBox {
  index: number;
  centre: Vec3;
  rot: Quat;
  half: Vec3;
}

/** World-space oriented boxes for every module of a vehicle. */
export function moduleBoxes(def: VehicleDef, pose: VehiclePose): ModuleBox[] {
  const tRot = turretRotation(pose);
  const ring = add(pose.pos, rotateVec(pose.rot, def.turret.offset));
  return def.modules.map((m, index) =>
    m.part === 'hull'
      ? { index, centre: add(pose.pos, rotateVec(pose.rot, m.pos)), rot: pose.rot, half: m.half }
      : { index, centre: add(ring, rotateVec(tRot, m.pos)), rot: tRot, half: m.half },
  );
}

/** Slab test. Returns the entry distance (0 if the origin is inside), or null. */
export function rayVsBox(box: ModuleBox, origin: Vec3, dir: Vec3, maxT: number): number | null {
  const o = inverseRotateVec(box.rot, sub(origin, box.centre));
  const d = inverseRotateVec(box.rot, dir);
  let tMin = 0;
  let tMax = maxT;
  for (const axis of ['x', 'y', 'z'] as const) {
    const h = box.half[axis];
    if (Math.abs(d[axis]) < 1e-12) {
      if (Math.abs(o[axis]) > h) return null;
      continue;
    }
    let t1 = (-h - o[axis]) / d[axis];
    let t2 = (h - o[axis]) / d[axis];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/** Distance from a point to a box surface (0 inside). */
export function pointBoxDistance(box: ModuleBox, p: Vec3): number {
  const l = inverseRotateVec(box.rot, sub(p, box.centre));
  const dx = Math.max(0, Math.abs(l.x) - box.half.x);
  const dy = Math.max(0, Math.abs(l.y) - box.half.y);
  const dz = Math.max(0, Math.abs(l.z) - box.half.z);
  return Math.hypot(dx, dy, dz);
}

export type DamageSource = 'shell' | 'spall' | 'blast';

export interface ModuleDamage {
  index: number;
  damage: number;
  sources: DamageSource[];
}

export interface InternalDamageInput {
  def: VehicleDef;
  pose: VehiclePose;
  ammo: AmmoDef;
  /** Penetration point on the armour surface. */
  entry: Vec3;
  /** Unit shell direction. */
  dir: Vec3;
  /** Length of the shell path through the vehicle interior (m). */
  interiorLength: number;
  /** Penetration left after the plate (mm). */
  residualMm: number;
  rng: Rng;
}

/** Tunables for the behind-armour model (kept together for balancing). */
export const DAMAGE_TUNING = {
  shellBase: 0.9, // damage per mm of calibre
  shellPerResidualMm: 2.0, // capped at 60 mm residual
  shellFalloffPerModule: 0.7,
  spallConeDeg: 25,
  spallDamage: [18, 40] as const,
  blastDamagePerCubeRootKg: 300,
  blastRadiusPerCubeRootKg: 2.6,
  fuseDistance: 1.0, // APHE delay fuse travel (m)
};

export function blastRadius(explosiveKg: number): number {
  return DAMAGE_TUNING.blastRadiusPerCubeRootKg * Math.cbrt(explosiveKg);
}

export function computeInternalDamage(i: InternalDamageInput): ModuleDamage[] {
  const T = DAMAGE_TUNING;
  const boxes = moduleBoxes(i.def, i.pose);
  const out = new Map<number, ModuleDamage>();
  const hit = (index: number, damage: number, source: DamageSource) => {
    const e = out.get(index) ?? { index, damage: 0, sources: [] };
    e.damage += damage;
    if (!e.sources.includes(source)) e.sources.push(source);
    out.set(index, e);
  };
  const pathLen = i.interiorLength + 0.5;

  // 1. Shell body: damages every module along its path, losing energy each time.
  let shellDamage = T.shellBase * i.ammo.caliberMm + T.shellPerResidualMm * Math.min(i.residualMm, 60);
  const alongPath = boxes
    .map((b) => ({ b, t: rayVsBox(b, i.entry, i.dir, pathLen) }))
    .filter((x): x is { b: ModuleBox; t: number } => x.t !== null)
    .sort((a, b) => a.t - b.t);
  const explosive = i.ammo.explosiveMassKg > 0;
  const fuse = i.ammo.type === 'HE' ? 0.3 : T.fuseDistance;
  for (const { b, t } of alongPath) {
    if (explosive && t > fuse) break; // detonated before reaching it
    hit(b.index, shellDamage, 'shell');
    shellDamage *= T.shellFalloffPerModule;
  }

  // 2. Spall cone from the entry point.
  const fragments = Math.round(4 + i.ammo.caliberMm / 15 + Math.min(i.residualMm, 80) / 20);
  const helper = Math.abs(i.dir.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(i.dir, helper));
  const w = cross(u, i.dir);
  const cone = (T.spallConeDeg * Math.PI) / 180;
  for (let f = 0; f < fragments; f++) {
    // Uniform over the cone's solid angle.
    const cosA = 1 - i.rng.next() * (1 - Math.cos(cone));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const phi = i.rng.next() * Math.PI * 2;
    const d = normalize(add(scale(i.dir, cosA), add(scale(u, sinA * Math.cos(phi)), scale(w, sinA * Math.sin(phi)))));
    let nearest: { index: number; t: number } | null = null;
    for (const b of boxes) {
      const t = rayVsBox(b, i.entry, d, pathLen);
      if (t !== null && (!nearest || t < nearest.t)) nearest = { index: b.index, t };
    }
    const dmg = T.spallDamage[0] + (T.spallDamage[1] - T.spallDamage[0]) * i.rng.next();
    if (nearest) hit(nearest.index, dmg, 'spall');
  }

  // 3. Explosive filler detonates inside after the fuse delay.
  if (explosive) {
    const at = add(i.entry, scale(i.dir, clamp(fuse, 0, i.interiorLength)));
    const k = Math.cbrt(i.ammo.explosiveMassKg);
    const r = blastRadius(i.ammo.explosiveMassKg);
    for (const b of boxes) {
      const dist = pointBoxDistance(b, at);
      if (dist < r) hit(b.index, T.blastDamagePerCubeRootKg * k * (1 - dist / r), 'blast');
    }
  }

  return [...out.values()].sort((a, b) => a.index - b.index);
}

