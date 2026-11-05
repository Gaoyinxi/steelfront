import { approachAngle, clamp, inverseRotateVec, sub, wrapAngle } from '../core/math';
import { ControlIntent } from '../components/ControlIntent';
import { Gun } from '../components/Gun';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import type { System } from '../ecs/System';
import type { World } from '../ecs/World';
import { trunnionLocal } from '../game/vehicleGeometry';

/**
 * Drives turret yaw and gun pitch towards the intent's aim point with
 * rate limits and mechanical limits from the vehicle definition.
 * Unstabilized (period-accurate): angles are relative to the hull, so hull
 * motion disturbs the aim until the drives catch up.
 */
export class TurretSystem implements System {
  readonly name = 'Turret';

  fixedUpdate(world: World, dt: number): void {
    for (const e of world.query(Vehicle, Turret, Gun, Transform, ControlIntent)) {
      const def = world.req(e, Vehicle).def;
      const turret = world.req(e, Turret);
      const gun = world.req(e, Gun);
      const tf = world.req(e, Transform);
      const aim = world.req(e, ControlIntent).aimPoint;
      turret.prevYaw = turret.yaw;
      gun.prevPitch = gun.pitch;
      if (!aim) continue;

      const { desiredYaw, desiredPitch } = solveAim(def, tf, turret.yaw, aim);

      const maxYawStep = def.turret.yawSpeed * turret.traverseFactor * dt;
      const limits = def.turret.yawLimits;
      if (limits) {
        // Limited traverse (casemate): never wrap through the rear arc.
        const yawTarget = clamp(desiredYaw, limits[0], limits[1]);
        turret.yaw += clamp(yawTarget - turret.yaw, -maxYawStep, maxYawStep);
      } else {
        turret.yaw = wrapAngle(approachAngle(turret.yaw, desiredYaw, maxYawStep));
      }

      const pitchTarget = clamp(desiredPitch, def.gun.pitchMin, def.gun.pitchMax);
      const maxStep = def.gun.pitchSpeed * gun.elevationFactor * dt;
      gun.pitch += clamp(pitchTarget - gun.pitch, -maxStep, maxStep);
    }
  }
}

/** Yaw / pitch (hull frame) that would point the barrel at a world point. */
export function solveAim(
  def: Vehicle['def'],
  tf: Transform,
  currentYaw: number,
  aim: { x: number; y: number; z: number },
): { desiredYaw: number; desiredPitch: number } {
  const local = inverseRotateVec(tf.rot, sub(aim, tf.pos));
  const pivot = trunnionLocal(def, currentYaw);
  const d = sub(local, pivot);
  return {
    desiredYaw: Math.atan2(-d.x, -d.z),
    desiredPitch: Math.atan2(d.y, Math.hypot(d.x, d.z)),
  };
}
