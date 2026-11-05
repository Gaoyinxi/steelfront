import { defineComponent, type Entity } from '../ecs/World';
import type { Vec3 } from '../core/math';
import type { AISkill } from '../data/schema';
import type { CoverChoice } from '../ai/cover';
import type { GunnerySolution } from '../ai/gunnery';

/**
 * Behaviour states:
 *  patrol        → follow the route, scan with the turret
 *  moveToCover   → threat known: drive to a cover point that hides the hull
 *  inCover       → hidden; reload, pre-aim at the threat's last position
 *  peek          → step out to the firing position, fire one round
 *  returnToCover → back into cover (in reverse, frontal armour to the threat)
 *  engageOpen    → no usable cover: angle the hull and fight in place
 *  dead          → vehicle knocked out
 */
export type AIState = 'patrol' | 'moveToCover' | 'inCover' | 'peek' | 'returnToCover' | 'engageOpen' | 'dead';

/** What an AI knows about one enemy vehicle. */
export interface Contact {
  /** Recognition progress 0..1. */
  progress: number;
  /** Identified as an enemy; stays true until the contact is forgotten. */
  recognised: boolean;
  /** Recognised and in line of sight at the last perception update. */
  visible: boolean;
  /** Last observed (or, from gunfire / hits, estimated) position. */
  lastKnownPos: Vec3 | null;
  /** Simulation time of the last visual contact. */
  lastSeenTime: number;
  /** Simulation time of the last non-visual cue (gunfire heard, being hit). */
  lastCueTime: number;
  /**
   * Offset from the target's origin to the centre of its visible parts at the
   * last sighting: a hull-down target is engaged at its turret, not at the
   * crest in front of its hull.
   */
  aimOffset: Vec3;
}

/** Gunner state for the current target. */
export interface AimState {
  target: Entity | null;
  /** Seconds the target has been tracked while visible. */
  time: number;
  shotsAtTarget: number;
  /** Standard-normal draws for this shot; scaled by the current error sigma when used. */
  yawDraw: number;
  pitchDraw: number;
  rangeDraw: number;
  leadDraw: number;
  solution: GunnerySolution | null;
  sinceSolve: number;
}

export interface AIBrain {
  skill: AISkill;
  state: AIState;
  stateTime: number;
  /** Time spent at the current destination (peek dwell). */
  waitTime: number;
  route: Vec3[];
  routeIndex: number;
  routeStep: 1 | -1;
  path: Vec3[];
  pathIndex: number;
  contacts: Map<Entity, Contact>;
  threat: Entity | null;
  cover: CoverChoice | null;
  excludedCovers: Set<number>;
  peekFailures: number;
  aim: AimState;
  stuckTime: number;
  unstickTime: number;
  nextDecisionTime: number;
  scanPhase: number;
}

export const AIBrain = defineComponent<AIBrain>('AIBrain');

export function makeBrain(skill: AISkill, route: Vec3[]): AIBrain {
  return {
    skill,
    state: 'patrol',
    stateTime: 0,
    waitTime: 0,
    route,
    routeIndex: 0,
    routeStep: 1,
    path: [],
    pathIndex: 0,
    contacts: new Map(),
    threat: null,
    cover: null,
    excludedCovers: new Set(),
    peekFailures: 0,
    aim: {
      target: null,
      time: 0,
      shotsAtTarget: 0,
      yawDraw: 0,
      pitchDraw: 0,
      rangeDraw: 0,
      leadDraw: 0,
      solution: null,
      sinceSolve: 0,
    },
    stuckTime: 0,
    unstickTime: 0,
    nextDecisionTime: 0,
    scanPhase: 0,
  };
}
