/**
 * Data contracts for everything under /data.
 *
 * JSON files use the "design frame": +X right, +Y up, +Z forward, which reads
 * naturally when authoring ("front plate is at +z"). The simulation uses the
 * three.js convention where forward is -Z. `toSimVec` performs that single
 * conversion at load time so no other code needs to care.
 */
import { z } from 'zod';
import type { Vec3 } from '../core/math';

const vec3Tuple = z.tuple([z.number(), z.number(), z.number()]);
const positiveVec3 = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);

export const ammoTypeSchema = z.enum(['AP', 'APHE', 'HE']);

export const ammoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  type: ammoTypeSchema,
  caliberMm: z.number().positive(),
  massKg: z.number().positive(),
  muzzleVelocity: z.number().positive(),
  /** Quadratic drag coefficient k in a = -k |v| v  (1/m). */
  dragK: z.number().nonnegative(),
  /** Penetration (mm RHA at 0°) by range (m). Must be sorted by range. */
  penetration: z
    .array(z.object({ range: z.number().nonnegative(), mm: z.number().nonnegative() }))
    .min(1),
  /** Impact angle from plate normal above which the round always ricochets. */
  ricochetAngleDeg: z.number().min(0).max(90),
  /** AP-cap normalization: reduces the effective impact angle by this much. */
  normalizationDeg: z.number().min(0).max(20),
  /** TNT-equivalent filler mass; 0 for solid shot. */
  explosiveMassKg: z.number().nonnegative(),
});

const plateSchema = z.object({
  mm: z.number().nonnegative(),
  /** Inclination from vertical (side/front/rear) or from horizontal (top/bottom). */
  slopeDeg: z.number().min(0).max(89),
});

const armorPartSchema = z.object({
  front: plateSchema,
  side: plateSchema,
  rear: plateSchema,
  top: plateSchema,
  bottom: plateSchema,
});

export const crewRoleSchema = z.enum(['commander', 'gunner', 'loader', 'driver', 'radio']);
export const moduleTypeSchema = z.enum([
  'engine',
  'transmission',
  'turretRing',
  'ammoRack',
  'fuelTank',
  'gunBreech',
  'crew',
]);

const moduleSchema = z.object({
  type: moduleTypeSchema,
  role: crewRoleSchema.optional(),
  part: z.enum(['hull', 'turret']),
  pos: vec3Tuple,
  size: positiveVec3,
  hp: z.number().positive(),
  detonationChance: z.number().min(0).max(1).optional(),
});

export const vehicleClassSchema = z.enum(['light', 'medium', 'heavy', 'tankDestroyer']);

export const vehicleSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  class: vehicleClassSchema,
  massKg: z.number().positive(),
  crew: z.array(crewRoleSchema).min(1),
  hull: z.object({
    size: positiveVec3,
    groundClearance: z.number().positive(),
  }),
  mobility: z.object({
    // Discriminator reserved for future 'wheeled' | 'aircraft' mobility models.
    type: z.literal('tracked'),
    enginePowerHp: z.number().positive(),
    maxSpeedFwdKmh: z.number().positive(),
    maxSpeedRevKmh: z.number().positive(),
    pivotTurnRateDeg: z.number().positive(),
    trackWidth: z.number().positive(),
    trackLength: z.number().positive(),
    suspension: z.object({
      wheelsPerSide: z.number().int().min(2).max(12),
      travel: z.number().positive(),
      frequencyHz: z.number().positive(),
      dampingRatio: z.number().positive(),
    }),
    friction: z.object({ longitudinal: z.number().positive(), lateral: z.number().positive() }),
  }),
  turret: z.object({
    offset: vec3Tuple,
    size: positiveVec3,
    yawSpeedDeg: z.number().positive(),
    /** null = full 360° traverse; [min, max] for casemate / limited-traverse vehicles. */
    yawLimitsDeg: z.tuple([z.number(), z.number()]).nullable(),
  }),
  gun: z.object({
    offset: vec3Tuple,
    length: z.number().positive(),
    pitchMinDeg: z.number(),
    pitchMaxDeg: z.number(),
    pitchSpeedDeg: z.number().positive(),
    reloadTimeS: z.number().positive(),
    dispersionMoa: z.number().nonnegative(),
    ammo: z.array(z.object({ id: z.string(), count: z.number().int().nonnegative() })).min(1),
  }),
  armor: z.object({ hull: armorPartSchema, turret: armorPartSchema }),
  modules: z.array(moduleSchema),
});

export const mapSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  seed: z.number().int(),
  size: z.number().positive(),
  resolution: z.number().int().min(17),
  terrain: z.object({
    baseHeight: z.number(),
    hillAmplitude: z.number().nonnegative(),
    hillScale: z.number().positive(),
    detailAmplitude: z.number().nonnegative(),
    detailScale: z.number().positive(),
    octaves: z.number().int().min(1).max(8),
    edgeRise: z.number().nonnegative(),
    edgeWidth: z.number().positive(),
    playableMargin: z.number().nonnegative(),
  }),
  obstacles: z.object({
    rocks: z.number().int().nonnegative(),
    walls: z.number().int().nonnegative(),
    buildings: z.number().int().nonnegative(),
    treeClusters: z.number().int().nonnegative(),
    maxSlopeDeg: z.number().positive(),
  }),
  spawns: z.object({
    teamA: z.tuple([z.number(), z.number()]),
    teamB: z.tuple([z.number(), z.number()]),
    clearRadius: z.number().nonnegative(),
  }),
  match: z.object({
    playerVehicle: z.string(),
    enemyVehicle: z.string(),
    enemyCount: z.number().int().min(0).max(8),
    aiSkill: z.string(),
  }),
});

/** AI difficulty profile (data/ai/*.json). */
export const aiSkillSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /** Base time to recognise a fully visible target at close range (s). */
  reactionTimeS: z.number().positive(),
  viewDistance: z.number().positive(),
  /** Gunfire within this distance alerts the AI to the shooter's rough position. */
  hearingDistance: z.number().nonnegative(),
  /** How long a lost contact is remembered (s). */
  memoryS: z.number().positive(),
  /** 1-sigma angular aiming error per axis once fully settled (milliradians). */
  aimErrorMrad: z.number().nonnegative(),
  /** Time constant over which the initial (3x larger) aim error settles (s). */
  aimSettleTimeS: z.number().positive(),
  /** 1-sigma relative range estimation error (0.05 = 5 %). */
  rangeEstimateError: z.number().min(0).max(0.5),
  /** 1-sigma relative error of the target-velocity estimate used for lead. */
  leadEstimateError: z.number().min(0).max(1),
  /** Minimum time on target before firing (s). */
  minAimTimeS: z.number().nonnegative(),
  /** Barrel must be within this angle of the solution to fire (milliradians). */
  fireToleranceMrad: z.number().positive(),
  coverSearchRadius: z.number().positive(),
  maxEngageDistance: z.number().positive(),
});

export type AmmoJson = z.infer<typeof ammoSchema>;
export type VehicleJson = z.infer<typeof vehicleSchema>;
export type MapDef = z.infer<typeof mapSchema>;
export type AISkill = z.infer<typeof aiSkillSchema>;
export type AmmoType = z.infer<typeof ammoTypeSchema>;
export type CrewRole = z.infer<typeof crewRoleSchema>;
export type ModuleType = z.infer<typeof moduleTypeSchema>;
export type VehicleClass = z.infer<typeof vehicleClassSchema>;
export type PlateJson = z.infer<typeof plateSchema>;
export type ArmorPartJson = z.infer<typeof armorPartSchema>;

/* ------------------------------------------------------------------ */
/* Runtime (simulation-frame) definitions                              */
/* ------------------------------------------------------------------ */

export type AmmoDef = AmmoJson;

export interface ModuleDef {
  type: ModuleType;
  role?: CrewRole;
  part: 'hull' | 'turret';
  /** Centre in part-local sim frame (hull centre or turret ring centre). */
  pos: Vec3;
  /** Half extents. */
  half: Vec3;
  hp: number;
  detonationChance: number;
}

export interface VehicleDef {
  id: string;
  displayName: string;
  class: VehicleClass;
  massKg: number;
  crew: CrewRole[];
  hull: { half: Vec3; groundClearance: number };
  mobility: VehicleJson['mobility'] & { maxSpeedFwd: number; maxSpeedRev: number; enginePowerW: number };
  turret: { offset: Vec3; half: Vec3; yawSpeed: number; yawLimits: [number, number] | null };
  gun: {
    offset: Vec3;
    length: number;
    pitchMin: number;
    pitchMax: number;
    pitchSpeed: number;
    reloadTimeS: number;
    dispersionMoa: number;
    ammo: { id: string; count: number }[];
  };
  armor: { hull: ArmorPartJson; turret: ArmorPartJson };
  modules: ModuleDef[];
}

const DEG = Math.PI / 180;
const KMH = 1 / 3.6;
const HP_TO_W = 745.7;

export const toSimVec = ([x, y, z]: readonly [number, number, number]): Vec3 => ({ x, y, z: -z });
const toHalf = ([x, y, z]: readonly [number, number, number]): Vec3 => ({ x: x / 2, y: y / 2, z: z / 2 });

export function parseAmmo(json: unknown): AmmoDef {
  const a = ammoSchema.parse(json);
  for (let i = 1; i < a.penetration.length; i++) {
    if (a.penetration[i].range <= a.penetration[i - 1].range) {
      throw new Error(`Ammo ${a.id}: penetration table must be sorted by ascending range`);
    }
  }
  return a;
}

export function parseVehicle(json: unknown): VehicleDef {
  const v = vehicleSchema.parse(json);
  return {
    id: v.id,
    displayName: v.displayName,
    class: v.class,
    massKg: v.massKg,
    crew: v.crew,
    hull: { half: toHalf(v.hull.size), groundClearance: v.hull.groundClearance },
    mobility: {
      ...v.mobility,
      maxSpeedFwd: v.mobility.maxSpeedFwdKmh * KMH,
      maxSpeedRev: v.mobility.maxSpeedRevKmh * KMH,
      enginePowerW: v.mobility.enginePowerHp * HP_TO_W,
    },
    turret: {
      offset: toSimVec(v.turret.offset),
      half: toHalf(v.turret.size),
      yawSpeed: v.turret.yawSpeedDeg * DEG,
      yawLimits: v.turret.yawLimitsDeg
        ? [v.turret.yawLimitsDeg[0] * DEG, v.turret.yawLimitsDeg[1] * DEG]
        : null,
    },
    gun: {
      offset: toSimVec(v.gun.offset),
      length: v.gun.length,
      pitchMin: v.gun.pitchMinDeg * DEG,
      pitchMax: v.gun.pitchMaxDeg * DEG,
      pitchSpeed: v.gun.pitchSpeedDeg * DEG,
      reloadTimeS: v.gun.reloadTimeS,
      dispersionMoa: v.gun.dispersionMoa,
      ammo: v.gun.ammo,
    },
    armor: v.armor,
    modules: v.modules.map((m) => ({
      type: m.type,
      role: m.role,
      part: m.part,
      pos: toSimVec(m.pos),
      half: toHalf(m.size),
      hp: m.hp,
      detonationChance: m.detonationChance ?? 0,
    })),
  };
}

export function parseMap(json: unknown): MapDef {
  return mapSchema.parse(json);
}

export function parseAISkill(json: unknown): AISkill {
  return aiSkillSchema.parse(json);
}
