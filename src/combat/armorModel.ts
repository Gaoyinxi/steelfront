/**
 * Geometric armour model. Each armoured part (hull, turret) is a convex
 * polyhedron built from the plate data (thickness + slope per face), so
 * slopes in the data directly change both the impact normal and the
 * silhouette. Shells are tested against this model, not the physics collider.
 */
import { add, dot, inverseRotateVec, rotateVec, sub, type Quat, type Vec3 } from '../core/math';
import type { ArmorPartJson, PlateJson, VehicleDef } from '../data/schema';

export type ArmorPart = 'hull' | 'turret';
export type ArmorFace = 'front' | 'side' | 'rear' | 'top' | 'bottom';

/** Hull armour width relative to the hull box (the rest is tracks / fenders). */
export const HULL_WIDTH_RATIO = 0.86;

interface Plane {
  /** Outward unit normal (part-local). */
  n: Vec3;
  /** Inside when dot(n, p) <= d. */
  d: number;
  face: ArmorFace;
  plate: PlateJson;
}

export interface ArmorPolyhedron {
  part: ArmorPart;
  planes: Plane[];
  /** Bounding-sphere radius around the part origin (broad phase). */
  radius: number;
}

export interface VehicleArmorModel {
  hull: ArmorPolyhedron;
  /** Turret polyhedron in turret-local frame (origin = turret box centre). */
  turret: ArmorPolyhedron;
  /** Turret box centre relative to the turret ring (turret yaw frame). */
  turretCentre: Vec3;
}

export interface VehiclePose {
  pos: Vec3;
  rot: Quat;
  turretYaw: number;
}

const DEG = Math.PI / 180;

const plane = (n: Vec3, p: Vec3, face: ArmorFace, plate: PlateJson): Plane => ({ n, d: dot(n, p), face, plate });

/** Hull half extents of the armoured box. */
export function hullArmorHalf(def: VehicleDef): Vec3 {
  return { x: def.hull.half.x * HULL_WIDTH_RATIO, y: def.hull.half.y, z: def.hull.half.z };
}

/** Turret box centre relative to the ring (shared with the render mesh). */
export function turretCentreLocal(def: VehicleDef): Vec3 {
  return { x: 0, y: def.turret.half.y * 0.6, z: 0 };
}

/**
 * Hull: sloped plates pivot about their bottom edges, so a sloped glacis
 * leans back from the nose (matching a typical hull profile).
 */
function buildHull(half: Vec3, a: ArmorPartJson): ArmorPolyhedron {
  const { x: hx, y: hy, z: hz } = half;
  const s = (deg: number) => Math.sin(deg * DEG);
  const c = (deg: number) => Math.cos(deg * DEG);
  const f = a.front.slopeDeg;
  const r = a.rear.slopeDeg;
  const sd = a.side.slopeDeg;
  const t = a.top.slopeDeg;
  const b = a.bottom.slopeDeg;
  return {
    part: 'hull',
    radius: Math.hypot(hx, hy, hz),
    planes: [
      plane({ x: 0, y: s(f), z: -c(f) }, { x: 0, y: -hy, z: -hz }, 'front', a.front),
      plane({ x: 0, y: s(r), z: c(r) }, { x: 0, y: -hy, z: hz }, 'rear', a.rear),
      plane({ x: -c(sd), y: s(sd), z: 0 }, { x: -hx, y: -hy, z: 0 }, 'side', a.side),
      plane({ x: c(sd), y: s(sd), z: 0 }, { x: hx, y: -hy, z: 0 }, 'side', a.side),
      plane({ x: 0, y: c(t), z: -s(t) }, { x: 0, y: hy, z: 0 }, 'top', a.top),
      plane({ x: 0, y: -c(b), z: -s(b) }, { x: 0, y: -hy, z: 0 }, 'bottom', a.bottom),
    ],
  };
}

/** Turret: sloped plates pivot about the centre of each face. */
function buildTurret(half: Vec3, a: ArmorPartJson): ArmorPolyhedron {
  const { x: hx, y: hy, z: hz } = half;
  const s = (deg: number) => Math.sin(deg * DEG);
  const c = (deg: number) => Math.cos(deg * DEG);
  return {
    part: 'turret',
    radius: Math.hypot(hx, hy, hz),
    planes: [
      plane({ x: 0, y: s(a.front.slopeDeg), z: -c(a.front.slopeDeg) }, { x: 0, y: 0, z: -hz }, 'front', a.front),
      plane({ x: 0, y: s(a.rear.slopeDeg), z: c(a.rear.slopeDeg) }, { x: 0, y: 0, z: hz }, 'rear', a.rear),
      plane({ x: -c(a.side.slopeDeg), y: s(a.side.slopeDeg), z: 0 }, { x: -hx, y: 0, z: 0 }, 'side', a.side),
      plane({ x: c(a.side.slopeDeg), y: s(a.side.slopeDeg), z: 0 }, { x: hx, y: 0, z: 0 }, 'side', a.side),
      plane({ x: 0, y: c(a.top.slopeDeg), z: -s(a.top.slopeDeg) }, { x: 0, y: hy, z: 0 }, 'top', a.top),
      plane({ x: 0, y: -1, z: 0 }, { x: 0, y: -hy, z: 0 }, 'bottom', a.bottom),
    ],
  };
}

const cache = new WeakMap<VehicleDef, VehicleArmorModel>();

export function armorModelFor(def: VehicleDef): VehicleArmorModel {
  let m = cache.get(def);
  if (!m) {
    m = {
      hull: buildHull(hullArmorHalf(def), def.armor.hull),
      turret: buildTurret(def.turret.half, def.armor.turret),
      turretCentre: turretCentreLocal(def),
    };
    cache.set(def, m);
  }
  return m;
}

export interface RayPolyHit {
  /** Distance along the ray to the entry point. */
  t: number;
  /** Distance along the ray to the exit point. */
  tExit: number;
  plane: Plane;
}

/** Cyrus–Beck clipping of a ray against a convex polyhedron (local frame). */
export function rayVsPolyhedron(poly: ArmorPolyhedron, origin: Vec3, dir: Vec3, maxT: number): RayPolyHit | null {
  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterPlane: Plane | null = null;
  for (const p of poly.planes) {
    const denom = dot(p.n, dir);
    const dist = p.d - dot(p.n, origin);
    if (Math.abs(denom) < 1e-12) {
      if (dist < 0) return null; // parallel and outside
      continue;
    }
    const t = dist / denom;
    if (denom < 0) {
      if (t > tEnter) {
        tEnter = t;
        enterPlane = p;
      }
    } else if (t < tExit) {
      tExit = t;
    }
    if (tEnter > tExit) return null;
  }
  if (!enterPlane || tEnter < 0 || tEnter > maxT) return null;
  return { t: tEnter, tExit, plane: enterPlane };
}

/** Rotation of the turret frame in world space. */
export function turretRotation(pose: VehiclePose): Quat {
  const h = pose.turretYaw / 2;
  const y: Quat = { x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) };
  const q = pose.rot;
  // q * y
  return {
    x: q.w * y.x + q.x * y.w + q.y * y.z - q.z * y.y,
    y: q.w * y.y - q.x * y.z + q.y * y.w + q.z * y.x,
    z: q.w * y.z + q.x * y.y - q.y * y.x + q.z * y.w,
    w: q.w * y.w - q.x * y.x - q.y * y.y - q.z * y.z,
  };
}

/** World position of the turret box centre. */
export function turretCentreWorld(def: VehicleDef, model: VehicleArmorModel, pose: VehiclePose): Vec3 {
  const ring = add(pose.pos, rotateVec(pose.rot, def.turret.offset));
  return add(ring, rotateVec(turretRotation(pose), model.turretCentre));
}

export interface ArmorHit {
  part: ArmorPart;
  face: ArmorFace;
  plate: PlateJson;
  /** Distance along the ray to the impact point. */
  t: number;
  point: Vec3;
  /** Outward plate normal (world). */
  normal: Vec3;
  /** Length of the ray's path inside the part (m). */
  interiorLength: number;
}

/** Nearest armour plate hit by a world-space ray, or null. */
export function rayVsVehicle(
  def: VehicleDef,
  pose: VehiclePose,
  origin: Vec3,
  dir: Vec3,
  maxT: number,
): ArmorHit | null {
  const model = armorModelFor(def);
  const parts: { poly: ArmorPolyhedron; centre: Vec3; rot: Quat }[] = [
    { poly: model.hull, centre: pose.pos, rot: pose.rot },
    { poly: model.turret, centre: turretCentreWorld(def, model, pose), rot: turretRotation(pose) },
  ];
  let best: ArmorHit | null = null;
  for (const { poly, centre, rot } of parts) {
    // Broad phase: distance from sphere centre to the ray segment.
    const oc = sub(centre, origin);
    const along = Math.max(0, Math.min(maxT, dot(oc, dir)));
    const closest = add(origin, { x: dir.x * along, y: dir.y * along, z: dir.z * along });
    const dc = sub(centre, closest);
    if (dot(dc, dc) > poly.radius * poly.radius) continue;

    const lo = inverseRotateVec(rot, sub(origin, centre));
    const ld = inverseRotateVec(rot, dir);
    const hit = rayVsPolyhedron(poly, lo, ld, maxT);
    if (!hit || (best && hit.t >= best.t)) continue;
    best = {
      part: poly.part,
      face: hit.plane.face,
      plate: hit.plane.plate,
      t: hit.t,
      point: add(origin, { x: dir.x * hit.t, y: dir.y * hit.t, z: dir.z * hit.t }),
      normal: rotateVec(rot, hit.plane.n),
      interiorLength: Math.max(0, hit.tExit - hit.t),
    };
  }
  return best;
}
