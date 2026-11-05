import * as THREE from 'three';
import { Projectile } from '../../components/Projectile';
import { lerp } from '../../core/math';
import type { Entity, World } from '../../ecs/World';

const TRACER_LENGTH = 9;

/** Draws shells in flight as additive tracers, interpolated between ticks. */
export class ProjectileRenderer {
  private readonly tracers = new Map<Entity, THREE.Mesh>();
  private readonly geo: THREE.CylinderGeometry;
  private readonly matAP = new THREE.MeshBasicMaterial({
    color: 0xffd27a,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  private readonly matHE = this.matAP.clone();
  private readonly dir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(private readonly scene: THREE.Scene) {
    this.matHE.color.set(0xff8a4a);
    // Unit-length cylinder along +Y with its head at the origin.
    this.geo = new THREE.CylinderGeometry(0.06, 0.02, 1, 5, 1, true);
    this.geo.translate(0, -0.5, 0);
  }

  sync(world: World, alpha: number): void {
    const alive = new Set<Entity>();
    for (const e of world.query(Projectile)) {
      alive.add(e);
      const p = world.req(e, Projectile);
      let mesh = this.tracers.get(e);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geo, p.ammo.type === 'HE' ? this.matHE : this.matAP);
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.tracers.set(e, mesh);
      }
      mesh.position.set(lerp(p.prevPos.x, p.pos.x, alpha), lerp(p.prevPos.y, p.pos.y, alpha), lerp(p.prevPos.z, p.pos.z, alpha));
      this.dir.set(p.vel.x, p.vel.y, p.vel.z).normalize();
      mesh.quaternion.setFromUnitVectors(this.up, this.dir);
      // Tail never extends behind the muzzle on the first frames.
      mesh.scale.set(1, Math.min(TRACER_LENGTH, p.travelled + 0.01), 1);
    }
    for (const [e, mesh] of this.tracers) {
      if (alive.has(e)) continue;
      this.scene.remove(mesh);
      this.tracers.delete(e);
    }
  }
}
