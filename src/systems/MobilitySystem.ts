import { clamp, cross, dot, normalize, rotateVec, scale, add, type Vec3 } from '../core/math';
import { ControlIntent } from '../components/ControlIntent';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { TrackedMobility, type WheelState } from '../components/TrackedMobility';
import { Vehicle } from '../components/Vehicle';
import type { System } from '../ecs/System';
import type { World } from '../ecs/World';
import { Layer, type PhysicsWorld } from '../physics/PhysicsWorld';
import { wheelMounts } from '../game/vehicleGeometry';

const G = 9.81;
/** Slip speed (m/s) at which longitudinal / lateral friction saturates. */
const SLIP_LONG = 0.6;
/** Much stiffer slip response when the track is commanded to stand still (brake hold). */
const SLIP_BRAKE = 0.06;
const SLIP_LAT = 0.35;
/** Integral gain of the brake hold (1/s). */
const BRAKE_KI = 4;
/** Below this speed the lateral hold integrator is active (m/s). */
const LATERAL_HOLD_SPEED = 2;
/** Minimum speed used in the power limit, so standing starts have finite force. */
const POWER_MIN_SPEED = 1.5;

/**
 * Reversing inverts the steering sense (car-like): while backing up, steering
 * right swings the tail right. Shared with the AI driving controller so both
 * agree on the convention.
 */
export function steeringInverted(forwardSpeed: number, throttle: number): boolean {
  return forwardSpeed < -0.5 && throttle < 0;
}

/**
 * Tracked-vehicle running gear (decision 2A): a rigid hull supported by
 * per-wheel raycast springs. Each side's track is driven towards a target
 * speed; differential track speeds produce skid steering. Longitudinal force
 * is limited by engine power and by a friction circle shared with lateral
 * grip, so slopes, braking and pivot turns emerge from the same model.
 */
export class MobilitySystem implements System {
  readonly name = 'Mobility';

  constructor(private readonly physics: PhysicsWorld) {}

  fixedUpdate(world: World, dt: number): void {
    for (const e of world.query(Vehicle, TrackedMobility, PhysicsBodyRef, ControlIntent)) {
      const def = world.req(e, Vehicle).def;
      const mob = world.req(e, TrackedMobility);
      const intent = world.req(e, ControlIntent);
      const body = this.physics.getBody(world.req(e, PhysicsBodyRef).bodyId);
      if (!body) continue;

      const pos = body.position();
      const rot = body.rotation();
      const up = rotateVec(rot, { x: 0, y: 1, z: 0 });
      const fwd = rotateVec(rot, { x: 0, y: 0, z: -1 });
      const down = scale(up, -1);
      const m = def.mobility;
      const susp = m.suspension;
      const mounts = wheelMounts(def);
      const maxRay = mob.restLength + 0.05;

      mob.forwardSpeed = dot(body.linearVelocity(), fwd);

      // --- Track target speeds -------------------------------------------
      const throttle = mob.canDrive ? clamp(intent.throttle, -1, 1) : 0;
      const steer = mob.canDrive ? clamp(intent.steer, -1, 1) : 0;
      const vMax = throttle >= 0 ? m.maxSpeedFwd : m.maxSpeedRev;
      const base = throttle * vMax * mob.powerFactor;
      const speedRatio = Math.min(1, Math.abs(mob.forwardSpeed) / m.maxSpeedFwd);
      // Pivot turn at standstill; wider turning radius as speed rises.
      const turnRate = ((m.pivotTurnRateDeg * Math.PI) / 180) * (1 - 0.45 * speedRatio);
      const dv = steer * turnRate * (m.trackWidth / 2) * Math.max(mob.powerFactor, 0.15);
      const dir = steeringInverted(mob.forwardSpeed, throttle) ? -1 : 1;
      const target = [base + dv * dir, base - dv * dir]; // [left, right]

      // --- Pass 1: suspension & contact gathering ------------------------
      type Contact = { point: Vec3; normal: Vec3; load: number; side: number; trackCentre: Vec3 };
      const contacts: Contact[] = [];
      for (let s = 0; s < 2; s++) {
        const states: WheelState[] = s === 0 ? mob.left : mob.right;
        for (let i = 0; i < mounts[s].length; i++) {
          const mount = add(pos, rotateVec(rot, mounts[s][i]));
          const hit = this.physics.raycast(mount, down, maxRay, {
            layers: Layer.Terrain | Layer.Static,
            excludeBody: body.id,
          });
          const ws = states[i];
          if (!hit) {
            ws.compression = 0;
            ws.grounded = false;
            continue;
          }
          const x = Math.max(0, mob.restLength - hit.distance);
          const xDot = -dot(body.velocityAtPoint(mount), up);
          let f = mob.springK * x + mob.damperC * xDot;
          // Progressive bump stop beyond rated travel.
          if (x > susp.travel) f += mob.springK * 8 * (x - susp.travel);
          f = Math.max(0, f);
          ws.compression = Math.min(x, susp.travel);
          ws.grounded = true;
          body.addForceAtPoint(scale(up, f), mount);
          const trackCentre = add(pos, rotateVec(rot, { x: mounts[s][i].x, y: mounts[s][i].y, z: 0 }));
          contacts.push({ point: hit.point, normal: hit.normal, load: f, side: s, trackCentre });
        }
      }
      if (contacts.length === 0) continue;

      // --- Pass 2: traction ----------------------------------------------
      // Slip gains are capped so a wheel can cancel at most half of its mass
      // share's slip in one tick; this avoids bang-bang limit cycles at small
      // slip (e.g. brake hold) independent of the timestep.
      const maxGain = (0.5 * def.massKg) / (contacts.length * dt);
      type Drive = {
        point: Vec3;
        f: Vec3;
        l: Vec3;
        side: number;
        vLong: number;
        vLat: number;
        fLong: number;
        fLat: number;
        accel: boolean;
        limitLong: number;
        limitLat: number;
        limit: number;
      };
      const drives: Drive[] = [];
      let drivePower = 0;
      for (const c of contacts) {
        const n = c.normal;
        const f = normalize(add(fwd, scale(n, -dot(fwd, n))));
        const l = normalize(cross(f, n));
        const vLong = dot(body.velocityAtPoint(c.point), f);
        // Lateral slip is measured at the track's mid-point: a track resists
        // sideways sliding, while yaw is governed by the track speed difference
        // (skid steering), not by each road wheel scrubbing sideways.
        const vLat = dot(body.velocityAtPoint(c.trackCentre), l);
        const limitLong = m.friction.longitudinal * c.load;
        const limitLat = m.friction.lateral * c.load;
        const slip = target[c.side] === 0 ? SLIP_BRAKE : SLIP_LONG;
        const gainLong = Math.min(limitLong / slip, maxGain);
        const gainLat = Math.min(limitLat / SLIP_LAT, maxGain);
        const fLong = clamp(gainLong * (target[c.side] - vLong), -limitLong, limitLong);
        const fLat = clamp(-gainLat * vLat, -limitLat, limitLat);
        // Engine power is consumed only when the force accelerates the track.
        const accel = target[c.side] !== 0 && (fLong * vLong > 0 || Math.abs(vLong) < POWER_MIN_SPEED);
        if (accel) drivePower += Math.abs(fLong) * Math.max(Math.abs(vLong), POWER_MIN_SPEED);
        drives.push({
          point: c.point,
          f,
          l,
          side: c.side,
          vLong,
          vLat,
          fLong,
          fLat,
          accel,
          limitLong,
          limitLat,
          limit: Math.max(limitLong, limitLat),
        });
      }
      // Integral brake hold: removes the steady-state creep of the purely
      // proportional slip controller when parked on a slope.
      for (let side = 0; side < 2; side++) {
        const own = drives.filter((d) => d.side === side);
        if (target[side] !== 0 || own.length === 0) {
          mob.brakeHold[side] = 0;
          continue;
        }
        const vAvg = own.reduce((acc, d) => acc + d.vLong, 0) / own.length;
        const limit = own.reduce((acc, d) => acc + d.limitLong, 0);
        mob.brakeHold[side] = clamp(mob.brakeHold[side] - vAvg * maxGain * own.length * BRAKE_KI * dt, -limit, limit);
        for (const d of own) d.fLong = clamp(d.fLong + mob.brakeHold[side] / own.length, -d.limitLong, d.limitLong);
      }

      // Integral lateral hold: the proportional lateral friction needs a small
      // sideways slip to generate force, which shows up as slow creep down a
      // side slope while parked. Active only at low speed.
      for (let side = 0; side < 2; side++) {
        const own = drives.filter((d) => d.side === side);
        if (Math.abs(mob.forwardSpeed) >= LATERAL_HOLD_SPEED || own.length === 0) {
          mob.lateralHold[side] = 0;
          continue;
        }
        const vAvg = own.reduce((acc, d) => acc + d.vLat, 0) / own.length;
        const limit = own.reduce((acc, d) => acc + d.limitLat, 0);
        mob.lateralHold[side] = clamp(mob.lateralHold[side] - vAvg * maxGain * own.length * BRAKE_KI * dt, -limit, limit);
        for (const d of own) d.fLat = clamp(d.fLat + mob.lateralHold[side] / own.length, -d.limitLat, d.limitLat);
      }

      const powerAvail = m.enginePowerW * mob.powerFactor;
      const powerScale = drivePower > powerAvail ? powerAvail / drivePower : 1;

      for (const d of drives) {
        let fLong = d.accel ? d.fLong * powerScale : d.fLong;
        let fLat = d.fLat;
        // Friction circle.
        const mag = Math.hypot(fLong, fLat);
        if (mag > d.limit) {
          const k = d.limit / mag;
          fLong *= k;
          fLat *= k;
        }
        body.addForceAtPoint(add(scale(d.f, fLong), scale(d.l, fLat)), d.point);
      }

      // Rolling resistance (~3% of weight) opposing motion.
      const rr = 0.03 * def.massKg * G * clamp(mob.forwardSpeed / 0.5, -1, 1);
      body.addForce(scale(fwd, -rr));
    }
  }
}
