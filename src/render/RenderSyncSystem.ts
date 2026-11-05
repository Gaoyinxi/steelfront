import * as THREE from 'three';
import { Gun } from '../components/Gun';
import { TrackedMobility } from '../components/TrackedMobility';
import { Transform } from '../components/Transform';
import { Turret } from '../components/Turret';
import { Vehicle } from '../components/Vehicle';
import { lerp, wrapAngle } from '../core/math';
import type { Entity, World } from '../ecs/World';
import { applyWreckLook, createTankView, type TankView } from './meshes/tankMesh';
import { VehicleStatus } from '../components/Modules';

const TEAM_COLORS = { A: 0x5b6b3c, B: 0x8a7a55 } as const;

export interface InterpolatedVehicle {
  pos: THREE.Vector3;
  rot: THREE.Quaternion;
  turretYaw: number;
  gunPitch: number;
}

/**
 * Read-only bridge from simulation state to the scene graph. Creates views for
 * new vehicles, removes views of destroyed ones, and interpolates poses
 * between the last two simulation ticks using `alpha`.
 */
export class RenderSyncSystem {
  private readonly views = new Map<Entity, TankView>();
  private readonly cache = new Map<Entity, InterpolatedVehicle>();
  private readonly wrecked = new Set<Entity>();
  private readonly qa = new THREE.Quaternion();
  private readonly qb = new THREE.Quaternion();

  constructor(private readonly scene: THREE.Scene) {}

  sync(world: World, alpha: number): void {
    const seen = new Set<Entity>();
    for (const e of world.query(Vehicle, Transform, Turret, Gun)) {
      seen.add(e);
      let view = this.views.get(e);
      if (!view) {
        const v = world.req(e, Vehicle);
        view = createTankView(v.def, TEAM_COLORS[v.team]);
        view.root.name = v.name;
        this.scene.add(view.root);
        this.views.set(e, view);
      }
      if (world.get(e, VehicleStatus)?.destroyed && !this.wrecked.has(e)) {
        applyWreckLook(view);
        this.wrecked.add(e);
      }
      const ip = this.interpolate(world, e, alpha);
      view.root.position.copy(ip.pos);
      view.root.quaternion.copy(ip.rot);
      view.turret.rotation.y = ip.turretYaw;
      view.gun.rotation.x = ip.gunPitch;

      const mob = world.get(e, TrackedMobility);
      if (mob) {
        mob.left.forEach((w, i) => (view.wheels[0][i].position.y = view.wheelRestY + w.compression));
        mob.right.forEach((w, i) => (view.wheels[1][i].position.y = view.wheelRestY + w.compression));
      }
    }
    for (const [e, view] of this.views) {
      if (seen.has(e)) continue;
      this.scene.remove(view.root);
      this.views.delete(e);
      this.cache.delete(e);
      this.wrecked.delete(e);
    }
  }

  /** Interpolated pose computed during the last `sync`. */
  pose(e: Entity): InterpolatedVehicle | undefined {
    return this.cache.get(e);
  }

  private interpolate(world: World, e: Entity, alpha: number): InterpolatedVehicle {
    const t = world.req(e, Transform);
    const tur = world.req(e, Turret);
    const gun = world.req(e, Gun);
    let ip = this.cache.get(e);
    if (!ip) {
      ip = { pos: new THREE.Vector3(), rot: new THREE.Quaternion(), turretYaw: 0, gunPitch: 0 };
      this.cache.set(e, ip);
    }
    ip.pos.set(lerp(t.prevPos.x, t.pos.x, alpha), lerp(t.prevPos.y, t.pos.y, alpha), lerp(t.prevPos.z, t.pos.z, alpha));
    this.qa.set(t.prevRot.x, t.prevRot.y, t.prevRot.z, t.prevRot.w);
    this.qb.set(t.rot.x, t.rot.y, t.rot.z, t.rot.w);
    ip.rot.slerpQuaternions(this.qa, this.qb, alpha);
    ip.turretYaw = tur.prevYaw + wrapAngle(tur.yaw - tur.prevYaw) * alpha;
    ip.gunPitch = lerp(gun.prevPitch, gun.pitch, alpha);
    return ip;
  }
}
