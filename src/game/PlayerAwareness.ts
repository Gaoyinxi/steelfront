import { eyePoint, visibilityPoints, visibleFraction } from '../ai/perception';
import { VehicleStatus } from '../components/Modules';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import type { Entity } from '../ecs/World';
import type { Simulation } from './Simulation';

const REFRESH_S = 0.25;
const MARKER_RANGE = 1500;

/**
 * Enemies the local player's crew can currently see, for HUD markers. Uses
 * the same line-of-sight model as the AI, refreshed at 4 Hz.
 */
export class PlayerAwareness {
  private timer = REFRESH_S;
  private readonly visible = new Set<Entity>();

  constructor(
    private readonly sim: Simulation,
    private readonly player: Entity,
  ) {}

  update(frameDt: number): ReadonlySet<Entity> {
    this.timer += frameDt;
    if (this.timer < REFRESH_S) return this.visible;
    this.timer = 0;
    this.visible.clear();
    const w = this.sim.world;
    const me = w.get(this.player, Vehicle);
    const tf = w.get(this.player, Transform);
    if (!me || !tf) return this.visible;
    const eye = eyePoint(me.def, { pos: tf.pos, rot: tf.rot, turretYaw: w.get(this.player, Turret)?.yaw ?? 0 });
    const view = { viewDistance: MARKER_RANGE, fov: Math.PI * 2, facing: 0 };
    for (const e of w.query(Vehicle, Transform)) {
      const v = w.req(e, Vehicle);
      if (e === this.player || v.team === me.team || w.get(e, VehicleStatus)?.destroyed) continue;
      const t = w.req(e, Transform);
      const points = visibilityPoints(v.def, { pos: t.pos, rot: t.rot, turretYaw: w.get(e, Turret)?.yaw ?? 0 });
      if (visibleFraction(eye, points, view, this.sim.ai.los) > 0) this.visible.add(e);
    }
    return this.visible;
  }
}
