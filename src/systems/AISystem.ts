import { add, distance, dot, scale, sub, wrapAngle, type Vec3 } from '../core/math';
import type { EventBus } from '../core/EventBus';
import type { Rng } from '../core/Rng';
import { chooseCover } from '../ai/cover';
import { bearing, driveTo, headingOf } from '../ai/driving';
import { aimErrorSigma, angleBetween, computeFiringSolution, directionFrom, perturbDirection } from '../ai/gunnery';
import { NavGrid } from '../ai/navGrid';
import {
  eyePoint,
  recognitionTime,
  updateRecognition,
  visibilityPoints,
  visiblePoints,
  type LineOfSight,
} from '../ai/perception';
import { AIBrain, type AIState, type AimState, type Contact } from '../components/AIBrain';
import { ControlIntent } from '../components/ControlIntent';
import { Gun } from '../components/Gun';
import { Modules, VehicleStatus } from '../components/Modules';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { TrackedMobility } from '../components/TrackedMobility';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import type { System } from '../ecs/System';
import type { Entity, World } from '../ecs/World';
import type { GameEvents } from '../game/events';
import { gunPoseWorld } from '../game/vehicleGeometry';
import { Layer, type PhysicsWorld } from '../physics/PhysicsWorld';
import type { GameMap } from '../world/GameMap';

/** Perception runs every N ticks (10 Hz at 60 Hz). */
const PERCEPTION_INTERVAL = 6;
/** Firing solutions are refreshed at this period (s). */
const SOLVE_INTERVAL = 0.1;
/** Minimum time between tactical decisions (s). */
const DECISION_COOLDOWN = 2;
/** Field of view without a commander (radians). */
const NARROW_FOV = (100 * Math.PI) / 180;
/** Hull angling relative to the threat when fighting in the open (radians). */
const ANGLE_HULL = 0.4;
/** Hold fire if a friendly vehicle is this close to the line of fire (m). */
const FRIENDLY_CLEARANCE = 6;
/** Teammates do not pick cover points within this distance of each other's (m). */
const COVER_SPACING = 12;

interface Cue {
  kind: 'shot' | 'hit';
  source: Entity;
  position: Vec3;
  victim: Entity | null;
}

/**
 * AI tank commander. Writes the same ControlIntent as the player, so AI
 * vehicles obey identical physics, armour and fire-control rules.
 *
 * Perception (line of sight + recognition time) and gunnery (ballistic
 * solution + human error model) are pure modules in src/ai; this system holds
 * the per-agent state machine that ties them together.
 */
export class AISystem implements System {
  readonly name = 'AI';
  readonly nav: NavGrid;
  private time = 0;
  private dt = 1 / 60;
  private readonly cues: Cue[] = [];
  /** Cover point index reserved by each agent, so teammates spread out. */
  private readonly reservedCover = new Map<Entity, number>();

  /** Line of sight against terrain and structures (vehicles do not block). */
  readonly los: LineOfSight = (from, to) => {
    const d = sub(to, from);
    const len = Math.hypot(d.x, d.y, d.z);
    if (len < 1e-6) return true;
    return !this.physics.raycast(from, scale(d, 1 / len), len - 0.2, { layers: Layer.Terrain | Layer.Static });
  };

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly map: GameMap,
    events: EventBus<GameEvents>,
    private readonly rng: Rng,
  ) {
    this.nav = NavGrid.build(map.height, map.obstacles);
    events.on('shotFired', (ev) => this.cues.push({ kind: 'shot', source: ev.shooter, position: ev.muzzle, victim: null }));
    events.on('hitResolved', (ev) =>
      this.cues.push({ kind: 'hit', source: ev.shooter, position: { x: 0, y: 0, z: 0 }, victim: ev.target }),
    );
  }

  fixedUpdate(world: World, dt: number, tick: number): void {
    this.time += dt;
    this.dt = dt;
    const agents = world.query(AIBrain, Vehicle, Transform, ControlIntent);
    this.processCues(world, agents);
    for (const e of agents) this.updateAgent(world, e, tick);
  }

  // ---------------------------------------------------------------------------
  // Agent update
  // ---------------------------------------------------------------------------

  private updateAgent(world: World, e: Entity, tick: number): void {
    const brain = world.req(e, AIBrain);
    const intent = world.req(e, ControlIntent);
    intent.fire = false;

    if (world.get(e, VehicleStatus)?.destroyed) {
      this.reservedCover.delete(e);
      if (brain.state !== 'dead') this.setState(brain, 'dead');
      intent.throttle = 0;
      intent.steer = 0;
      return;
    }

    brain.stateTime += this.dt;
    if ((tick + e) % PERCEPTION_INTERVAL === 0) this.perceive(world, e, brain, PERCEPTION_INTERVAL * this.dt);
    this.pickThreat(world, e, brain);
    intent.ammoSlot = preferredSlot(world.req(e, Gun));

    const contact = brain.threat !== null ? (brain.contacts.get(brain.threat) ?? null) : null;
    switch (brain.state) {
      case 'patrol':
        this.patrol(world, e, brain, intent, contact);
        break;
      case 'moveToCover':
        this.moveToCover(world, e, brain, intent, contact);
        break;
      case 'inCover':
        this.inCover(world, e, brain, intent, contact);
        break;
      case 'peek':
        this.peek(world, e, brain, intent, contact);
        break;
      case 'returnToCover':
        this.returnToCover(world, e, brain, intent, contact);
        break;
      case 'engageOpen':
        this.engageOpen(world, e, brain, intent, contact);
        break;
      case 'dead':
        break;
    }
  }

  private patrol(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact | null): void {
    if (contact && this.decide(world, e, brain)) return;
    if (brain.pathIndex >= brain.path.length) this.nextRouteLeg(world, e, brain);
    this.follow(world, e, brain, intent, 0.65);
    this.scan(world, e, brain, intent);
  }

  private moveToCover(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact | null): void {
    if (!contact || this.lost(brain, contact)) return this.toPatrol(brain);
    const aligned = this.aimAt(world, e, brain, intent, contact);
    // Caught in the open with a round ready: stop and take the shot.
    if (
      contact.visible &&
      this.loaded(world, e) &&
      aligned &&
      brain.aim.time >= brain.skill.minAimTimeS * 2 &&
      this.gunHasShot(world, e, brain, contact)
    ) {
      intent.throttle = 0;
      intent.steer = 0;
      this.tryFire(world, e, brain, intent, contact);
      return;
    }
    const r = this.follow(world, e, brain, intent, 1);
    if (r === 'arrived') this.setState(brain, 'inCover');
    else if (brain.stateTime > 50) this.abandonCover(world, e, brain);
  }

  private inCover(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact | null): void {
    intent.throttle = 0;
    intent.steer = 0;
    if (!contact || this.lost(brain, contact)) return this.toPatrol(brain);
    const aligned = this.aimAt(world, e, brain, intent, contact);
    const cover = brain.cover;
    if (!cover || !cover.firePos) return this.abandonCover(world, e, brain);
    if (cover.hullDown) {
      // The cover was rated hull-down from terrain alone; if the gun turns out
      // to be masked (vehicle tilt, rock shape), give the position up.
      if (contact.visible && !this.gunHasShot(world, e, brain, contact)) {
        brain.waitTime += this.dt;
        if (brain.waitTime > 4) return this.abandonCover(world, e, brain);
      } else {
        brain.waitTime = 0;
      }
      this.tryFire(world, e, brain, intent, contact, aligned);
    } else if (this.loaded(world, e) && brain.stateTime > 1.2) {
      this.setPath(world, e, brain, cover.firePos);
      this.setState(brain, 'peek');
    }
  }

  private peek(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact | null): void {
    if (!contact || !brain.cover?.firePos) return this.goBackToCover(world, e, brain);
    const aligned = this.aimAt(world, e, brain, intent, contact);
    // Minimal exposure: stop as soon as the gun (not just the commander,
    // whose eye is higher) has a line to the target.
    if (contact.visible && this.gunHasShot(world, e, brain, contact)) {
      intent.throttle = 0;
      intent.steer = 0;
      if (this.tryFire(world, e, brain, intent, contact, aligned)) {
        brain.peekFailures = 0;
        return this.goBackToCover(world, e, brain);
      }
    } else if (this.follow(world, e, brain, intent, 0.6) === 'arrived') {
      brain.waitTime += this.dt;
      if (brain.waitTime > 4) {
        brain.peekFailures++;
        return this.goBackToCover(world, e, brain);
      }
    }
    if (brain.stateTime > 20 || !this.loaded(world, e)) this.goBackToCover(world, e, brain);
  }

  private returnToCover(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact | null): void {
    if (contact) this.aimAt(world, e, brain, intent, contact);
    // Short, quick reverse back into cover (reverse top speed is low already).
    const r = this.follow(world, e, brain, intent, 1, true, 4);
    if (r === 'arrived' || brain.stateTime > 15) {
      if (brain.peekFailures >= 2) return this.abandonCover(world, e, brain);
      this.setState(brain, 'inCover');
    }
  }

  private engageOpen(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact | null): void {
    intent.throttle = 0;
    intent.steer = 0;
    if (!contact || this.lost(brain, contact)) return this.toPatrol(brain);
    const aligned = this.aimAt(world, e, brain, intent, contact);

    // Target in sight but the gun is masked (crest or rock in front of the
    // muzzle): advance a short distance towards it to clear the obstruction.
    const shot = contact.visible && this.gunHasShot(world, e, brain, contact);
    if (contact.visible && !shot) {
      brain.waitTime += this.dt;
      if (brain.waitTime > 3 && brain.pathIndex >= brain.path.length && contact.lastKnownPos) {
        this.planAdvance(world, e, brain, contact.lastKnownPos, 20);
        brain.waitTime = 0;
      }
    } else {
      brain.waitTime = 0;
      if (shot) {
        brain.path = [];
        brain.pathIndex = 0;
      }
    }
    if (brain.pathIndex < brain.path.length) {
      this.follow(world, e, brain, intent, 0.5);
      return;
    }

    if (contact.lastKnownPos && !this.loaded(world, e)) {
      // While reloading, angle the hull ~23° off the threat axis: the frontal
      // plates then present a larger line-of-sight thickness.
      const tf = world.req(e, Transform);
      const toThreat = bearing(tf.pos, contact.lastKnownPos);
      const heading = headingOf(tf.rot);
      const side = wrapAngle(heading - toThreat) >= 0 ? 1 : -1;
      const err = wrapAngle(toThreat + side * ANGLE_HULL - heading);
      if (Math.abs(err) > 0.2) intent.steer = err > 0 ? -1 : 1;
    }
    this.tryFire(world, e, brain, intent, contact, aligned);
    // Keep looking for cover once the target ducks out of sight.
    if (!contact.visible) this.decide(world, e, brain);
  }

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  /** Chooses cover against the current threat, or fights in the open. Returns true if a decision was made. */
  private decide(world: World, e: Entity, brain: AIBrain): boolean {
    if (this.time < brain.nextDecisionTime) return false;
    const contact = brain.threat !== null ? brain.contacts.get(brain.threat) : undefined;
    if (!contact?.lastKnownPos) return false;
    brain.nextDecisionTime = this.time + DECISION_COOLDOWN;
    const pos = world.req(e, Transform).pos;
    const hm = this.map.height;
    const choice = chooseCover({
      self: pos,
      threat: contact.lastKnownPos,
      covers: this.map.cover,
      obstacles: this.map.obstacles,
      los: this.los,
      isFree: (x, z) => this.nav.isFree(x, z),
      terrainHeight: (x, z) => hm.sample(x, z),
      maxDistance: brain.skill.coverSearchRadius,
      exclude: this.coverExclusions(e, brain),
    });
    if (choice?.firePos && this.setPath(world, e, brain, choice.cover.position)) {
      this.reservedCover.set(e, choice.index);
      brain.cover = choice;
      brain.peekFailures = 0;
      this.setState(brain, 'moveToCover');
      return true;
    }
    this.reservedCover.delete(e);
    brain.cover = null;
    if (brain.state !== 'engageOpen') this.setState(brain, 'engageOpen');
    return true;
  }

  /** Covers this agent must not use: its own compromised ones and those near teammates' reservations. */
  private coverExclusions(e: Entity, brain: AIBrain): Set<number> {
    const exclude = new Set(brain.excludedCovers);
    const taken = [...this.reservedCover].filter(([other]) => other !== e).map(([, i]) => this.map.cover[i].position);
    if (taken.length === 0) return exclude;
    this.map.cover.forEach((c, i) => {
      if (taken.some((p) => Math.hypot(p.x - c.position.x, p.z - c.position.z) < COVER_SPACING)) exclude.add(i);
    });
    return exclude;
  }

  private abandonCover(world: World, e: Entity, brain: AIBrain): void {
    if (brain.cover) brain.excludedCovers.add(brain.cover.index);
    this.reservedCover.delete(e);
    brain.cover = null;
    brain.nextDecisionTime = 0;
    this.setState(brain, 'engageOpen');
    this.decide(world, e, brain);
  }

  private goBackToCover(world: World, e: Entity, brain: AIBrain): void {
    if (!brain.cover) return this.abandonCover(world, e, brain);
    brain.path = [brain.cover.cover.position];
    brain.pathIndex = 0;
    this.setState(brain, 'returnToCover');
  }

  private toPatrol(brain: AIBrain): void {
    for (const [agent, index] of this.reservedCover) {
      if (brain.cover && index === brain.cover.index) this.reservedCover.delete(agent);
    }
    brain.cover = null;
    brain.path = [];
    brain.pathIndex = 0;
    this.setState(brain, 'patrol');
  }

  private setState(brain: AIBrain, state: AIState): void {
    brain.state = state;
    brain.stateTime = 0;
    brain.waitTime = 0;
    brain.stuckTime = 0;
  }

  private lost(brain: AIBrain, c: Contact): boolean {
    return !c.visible && this.time - Math.max(c.lastSeenTime, c.lastCueTime) > brain.skill.memoryS;
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------

  private perceive(world: World, e: Entity, brain: AIBrain, interval: number): void {
    const me = world.req(e, Vehicle);
    const tf = world.req(e, Transform);
    const turret = world.get(e, Turret);
    const pose = { pos: tf.pos, rot: tf.rot, turretYaw: turret?.yaw ?? 0 };
    const eye = eyePoint(me.def, pose);
    const view = {
      viewDistance: brain.skill.viewDistance,
      fov: this.crewAlive(world, e, 'commander') ? Math.PI * 2 : NARROW_FOV,
      facing: headingOf(tf.rot) + pose.turretYaw,
    };

    for (const other of world.query(Vehicle, Transform)) {
      if (other === e) continue;
      const them = world.req(other, Vehicle);
      if (them.team === me.team) continue;
      if (world.get(other, VehicleStatus)?.destroyed) {
        brain.contacts.delete(other);
        continue;
      }
      const otf = world.req(other, Transform);
      const opose = { pos: otf.pos, rot: otf.rot, turretYaw: world.get(other, Turret)?.yaw ?? 0 };
      const samples = visibilityPoints(them.def, opose);
      const seen = visiblePoints(eye, samples, view, this.los);
      const fraction = seen.length / samples.length;
      let c = brain.contacts.get(other);
      if (!c && fraction === 0) continue;
      c ??= newContact();
      const rt = recognitionTime(distance(eye, otf.pos), brain.skill.reactionTimeS, brain.skill.viewDistance);
      c.progress = updateRecognition(c.progress, fraction, interval, rt);
      if (c.progress >= 1) c.recognised = true;
      c.visible = c.recognised && fraction > 0;
      if (c.visible) {
        c.lastKnownPos = { ...otf.pos };
        c.lastSeenTime = this.time;
        const centre = scale(seen.reduce((acc, p) => add(acc, p), { x: 0, y: 0, z: 0 }), 1 / seen.length);
        c.aimOffset = sub(centre, otf.pos);
      }
      if (!c.visible && c.progress === 0 && this.time - Math.max(c.lastSeenTime, c.lastCueTime) > brain.skill.memoryS) {
        brain.contacts.delete(other);
      } else {
        brain.contacts.set(other, c);
      }
    }
  }

  /** Gunfire within hearing distance and incoming hits reveal the shooter's rough position. */
  private processCues(world: World, agents: Entity[]): void {
    for (const cue of this.cues) {
      if (!world.isAlive(cue.source)) continue;
      const source = world.get(cue.source, Vehicle);
      const srcPos = world.get(cue.source, Transform)?.pos ?? cue.position;
      if (!source) continue;
      for (const e of agents) {
        if (e === cue.source || world.req(e, Vehicle).team === source.team) continue;
        if (world.get(e, VehicleStatus)?.destroyed) continue;
        const brain = world.req(e, AIBrain);
        if (cue.kind === 'hit' && cue.victim !== e) continue;
        if (cue.kind === 'shot' && distance(world.req(e, Transform).pos, cue.position) > brain.skill.hearingDistance) {
          continue;
        }
        const c = brain.contacts.get(cue.source) ?? newContact();
        c.lastCueTime = this.time;
        c.progress = Math.max(c.progress, cue.kind === 'hit' ? 0.7 : 0.4);
        if (!c.visible) {
          const noise = cue.kind === 'hit' ? 12 : 30;
          c.lastKnownPos = {
            x: srcPos.x + this.rng.gaussian() * noise,
            y: srcPos.y,
            z: srcPos.z + this.rng.gaussian() * noise,
          };
        }
        brain.contacts.set(cue.source, c);
        // Hit while supposedly hidden: this cover is compromised.
        if (cue.kind === 'hit' && (brain.state === 'inCover' || brain.state === 'returnToCover') && brain.cover) {
          this.abandonCover(world, e, brain);
        }
      }
    }
    this.cues.length = 0;
  }

  private pickThreat(world: World, e: Entity, brain: AIBrain): void {
    const pos = world.req(e, Transform).pos;
    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const [other, c] of brain.contacts) {
      if (!c.lastKnownPos || !world.isAlive(other)) continue;
      const cued = this.time - c.lastCueTime < brain.skill.memoryS;
      if (!c.recognised && !cued) continue;
      const age = this.time - Math.max(c.lastSeenTime, c.lastCueTime);
      const score = (c.visible ? 0 : 500 + age * 10) + distance(pos, c.lastKnownPos) / 10;
      if (score < bestScore) {
        bestScore = score;
        best = other;
      }
    }
    brain.threat = best;
  }

  // ---------------------------------------------------------------------------
  // Gunnery
  // ---------------------------------------------------------------------------

  /** Lays the gun on the contact (ballistic solution + error). Returns true when on target. */
  private aimAt(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact): boolean {
    const aim = brain.aim;
    if (aim.target !== brain.threat) {
      aim.target = brain.threat;
      aim.time = 0;
      aim.shotsAtTarget = 0;
      aim.solution = null;
      this.drawErrors(aim);
    }
    if (!contact.lastKnownPos || brain.threat === null) return false;

    const def = world.req(e, Vehicle).def;
    const tf = world.req(e, Transform);
    const gun = world.req(e, Gun);
    const pose = gunPoseWorld(def, tf.pos, tf.rot, world.req(e, Turret).yaw, gun.pitch);
    const visible = contact.visible;
    const targetTf = world.get(brain.threat, Transform);
    // Aim at the centre of the parts that were visible at the last sighting.
    const targetPoint = add(visible && targetTf ? targetTf.pos : contact.lastKnownPos, contact.aimOffset);
    aim.time = visible ? aim.time + this.dt : Math.max(0, aim.time - 2 * this.dt);

    aim.sinceSolve += this.dt;
    if (!aim.solution || aim.sinceSolve >= SOLVE_INTERVAL) {
      const ammo = gun.ammo[gun.loadedSlot ?? gun.loadingSlot].def;
      const bracketing = Math.max(0.5, Math.pow(0.8, aim.shotsAtTarget));
      aim.solution = computeFiringSolution({
        origin: pose.trunnion,
        target: targetPoint,
        targetVelocity: visible ? this.velocityOf(world, brain.threat) : { x: 0, y: 0, z: 0 },
        ammo,
        rangeError: aim.rangeDraw * brain.skill.rangeEstimateError * bracketing,
        leadScale: 1 + aim.leadDraw * brain.skill.leadEstimateError,
      });
      aim.sinceSolve = 0;
    }
    if (!aim.solution) {
      intent.aimPoint = targetPoint;
      return false;
    }

    const sigma = aimErrorSigma({
      baseMrad: brain.skill.aimErrorMrad,
      aimTime: aim.time,
      settleTimeS: brain.skill.aimSettleTimeS,
      targetSpeed: visible ? lengthOf(this.velocityOf(world, brain.threat)) : 0,
      ownSpeed: Math.abs(world.get(e, TrackedMobility)?.forwardSpeed ?? 0),
      shotsAtTarget: aim.shotsAtTarget,
    });
    const desired = perturbDirection(aim.solution.direction, aim.yawDraw * sigma, aim.pitchDraw * sigma);
    const reach = Math.max(aim.solution.range, 50) / Math.max(Math.cos(aim.solution.elevation), 0.05);
    intent.aimPoint = add(pose.trunnion, scale(desired, reach));
    return angleBetween(pose.dir, desired) <= brain.skill.fireToleranceMrad / 1000;
  }

  /** Fires if every condition a gunner would check is met. Returns true if a round was fired. */
  private tryFire(world: World, e: Entity, brain: AIBrain, intent: ControlIntent, contact: Contact, aligned?: boolean): boolean {
    const isAligned = aligned ?? this.aimAt(world, e, brain, intent, contact);
    const gun = world.req(e, Gun);
    const sol = brain.aim.solution;
    if (!isAligned || !contact.visible || !gun.canFire || gun.loadedSlot === null || !sol) return false;
    if (Math.abs(world.get(e, TrackedMobility)?.forwardSpeed ?? 0) > 1) return false;
    if (brain.aim.time < brain.skill.minAimTimeS || sol.range > brain.skill.maxEngageDistance) return false;

    const me = world.req(e, Vehicle);
    const tf = world.req(e, Transform);
    const pose = gunPoseWorld(me.def, tf.pos, tf.rot, world.req(e, Turret).yaw, gun.pitch);
    // Barrel obstructed by a crest, wall or rock in front of the muzzle.
    const check = Math.min(sol.range - 15, 200);
    if (check > 0 && this.physics.raycast(pose.muzzle, pose.dir, check, { layers: Layer.Terrain | Layer.Static })) {
      return false;
    }
    // Friendly vehicle in the line of fire.
    for (const f of world.query(Vehicle, Transform)) {
      if (f === e || world.req(f, Vehicle).team !== me.team || world.get(f, VehicleStatus)?.destroyed) continue;
      if (distanceToRay(world.req(f, Transform).pos, pose.muzzle, pose.dir, sol.range) < FRIENDLY_CLEARANCE) return false;
    }

    intent.fire = true;
    brain.aim.shotsAtTarget++;
    this.drawErrors(brain.aim);
    return true;
  }

  /** Straight line from the muzzle to the target's visible parts is clear of terrain and structures. */
  private gunHasShot(world: World, e: Entity, brain: AIBrain, contact: Contact): boolean {
    if (!contact.lastKnownPos || brain.threat === null) return false;
    const def = world.req(e, Vehicle).def;
    const tf = world.req(e, Transform);
    const pose = gunPoseWorld(def, tf.pos, tf.rot, world.req(e, Turret).yaw, world.req(e, Gun).pitch);
    const targetTf = world.get(brain.threat, Transform);
    const target = add(contact.visible && targetTf ? targetTf.pos : contact.lastKnownPos, contact.aimOffset);
    return this.los(pose.muzzle, target);
  }

  private drawErrors(aim: AimState): void {
    aim.yawDraw = this.rng.gaussian();
    aim.pitchDraw = this.rng.gaussian();
    aim.rangeDraw = this.rng.gaussian();
    aim.leadDraw = this.rng.gaussian();
  }

  /** Turret sweep while patrolling. */
  private scan(world: World, e: Entity, brain: AIBrain, intent: ControlIntent): void {
    const tf = world.req(e, Transform);
    brain.scanPhase += this.dt * 0.45;
    const yaw = headingOf(tf.rot) + Math.sin(brain.scanPhase) * 1.2;
    const dir = directionFrom(yaw, 0);
    intent.aimPoint = { x: tf.pos.x + dir.x * 300, y: tf.pos.y + 1.5, z: tf.pos.z + dir.z * 300 };
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  private setPath(world: World, e: Entity, brain: AIBrain, goal: Vec3): boolean {
    const path = this.nav.findPath(world.req(e, Transform).pos, goal);
    if (!path) return false;
    brain.path = path;
    brain.pathIndex = 0;
    return true;
  }

  /** Short move straight towards a point (snapped to free ground). */
  private planAdvance(world: World, e: Entity, brain: AIBrain, towards: Vec3, metres: number): void {
    const pos = world.req(e, Transform).pos;
    const dx = towards.x - pos.x;
    const dz = towards.z - pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 1) return;
    const k = Math.min(metres, len * 0.5) / len;
    const cell = this.nav.nearestFree(pos.x + dx * k, pos.z + dz * k, 4);
    if (cell) this.setPath(world, e, brain, this.nav.centre(cell[0], cell[1]));
  }

  private nextRouteLeg(world: World, e: Entity, brain: AIBrain): void {
    const n = brain.route.length;
    if (n === 0) return;
    for (let attempt = 0; attempt < n; attempt++) {
      if (n > 1) {
        const next = brain.routeIndex + brain.routeStep;
        if (next < 0 || next >= n) brain.routeStep = brain.routeStep === 1 ? -1 : 1;
        brain.routeIndex += brain.routeStep;
      }
      if (this.setPath(world, e, brain, brain.route[brain.routeIndex])) return;
    }
  }

  /** Follows the current path; handles getting stuck by backing off briefly. */
  private follow(
    world: World,
    e: Entity,
    brain: AIBrain,
    intent: ControlIntent,
    maxThrottle: number,
    reverse = false,
    slowRadius = 14,
  ): 'moving' | 'arrived' {
    const tf = world.req(e, Transform);
    const speed = world.get(e, TrackedMobility)?.forwardSpeed ?? 0;
    if (brain.unstickTime > 0) {
      brain.unstickTime -= this.dt;
      intent.throttle = reverse ? 0.6 : -0.6;
      intent.steer = e % 2 === 0 ? 0.7 : -0.7;
      return 'moving';
    }
    if (brain.pathIndex >= brain.path.length) {
      intent.throttle = 0;
      intent.steer = 0;
      return 'arrived';
    }
    const final = brain.pathIndex === brain.path.length - 1;
    const cmd = driveTo(tf, speed, brain.path[brain.pathIndex], {
      arriveRadius: final ? 3 : 7,
      slowRadius: final ? slowRadius : 1e-3,
      maxThrottle,
      reverse,
    });
    intent.throttle = cmd.throttle;
    intent.steer = cmd.steer;
    if (cmd.arrived) {
      brain.pathIndex++;
      if (brain.pathIndex >= brain.path.length) return 'arrived';
    }
    // Stuck: commanded to move but not moving.
    if (Math.abs(cmd.throttle) > 0.25 && Math.abs(speed) < 0.4) brain.stuckTime += this.dt;
    else brain.stuckTime = Math.max(0, brain.stuckTime - this.dt);
    if (brain.stuckTime > 3) {
      brain.stuckTime = 0;
      brain.unstickTime = 1.5;
      const goal = brain.path[brain.path.length - 1];
      this.setPath(world, e, brain, goal);
    }
    return 'moving';
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  private loaded(world: World, e: Entity): boolean {
    const gun = world.req(e, Gun);
    return gun.loadedSlot !== null && gun.canFire;
  }

  private crewAlive(world: World, e: Entity, role: string): boolean {
    const def = world.req(e, Vehicle).def;
    const states = world.get(e, Modules)?.states;
    if (!states) return true;
    return def.modules.some((m, i) => m.role === role && !states[i].destroyed);
  }

  private velocityOf(world: World, e: Entity): Vec3 {
    const id = world.get(e, PhysicsBodyRef)?.bodyId;
    return (id !== undefined && this.physics.getBody(id)?.linearVelocity()) || { x: 0, y: 0, z: 0 };
  }
}

function newContact(): Contact {
  return {
    progress: 0,
    recognised: false,
    visible: false,
    lastKnownPos: null,
    lastSeenTime: -Infinity,
    lastCueTime: -Infinity,
    aimOffset: { x: 0, y: 0.6, z: 0 },
  };
}

/** Armour-piercing slot with rounds available, else any slot with rounds. */
function preferredSlot(gun: Gun): number {
  const has = (i: number) => gun.ammo[i].count > 0 || gun.loadedSlot === i;
  const ap = gun.ammo.findIndex((a, i) => a.def.type !== 'HE' && has(i));
  if (ap >= 0) return ap;
  const any = gun.ammo.findIndex((_a, i) => has(i));
  return any >= 0 ? any : 0;
}

function lengthOf(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Distance from a point to a ray segment of length `len`. */
function distanceToRay(p: Vec3, origin: Vec3, dir: Vec3, len: number): number {
  const t = Math.max(0, Math.min(len, dot(sub(p, origin), dir)));
  return distance(p, add(origin, scale(dir, t)));
}
