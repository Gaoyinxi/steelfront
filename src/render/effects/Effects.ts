import * as THREE from 'three';
import type { Vec3 } from '../../core/math';

interface Particle {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
  startOpacity: number;
  velocity: THREE.Vector3;
  /** Velocity damping per second. */
  drag: number;
}

interface Flash {
  light: THREE.PointLight;
  age: number;
  life: number;
  intensity: number;
}

/**
 * Short-lived placeholder VFX (muzzle flash, dust, sparks, explosions)
 * built from pooled primitive meshes. Purely presentational.
 */
export class Effects {
  private readonly particles: Particle[] = [];
  /**
   * Fixed pool of point lights that stay in the scene permanently. Adding or
   * removing lights changes three.js shader permutations and causes frame
   * hitches, so flashes only modulate intensity.
   */
  private readonly flashes: Flash[] = [];
  private readonly sphere = new THREE.IcosahedronGeometry(1, 1);
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 40, 2);
      scene.add(light);
      this.flashes.push({ light, age: 1, life: 1, intensity: 0 });
    }
  }

  muzzleFlash(pos: Vec3, dir: Vec3): void {
    const p = this.v(pos);
    const d = this.v(dir);
    this.spawn(p.clone().addScaledVector(d, 0.6), 0xffd58a, { life: 0.08, s0: 0.5, s1: 1.4, opacity: 1, additive: true });
    for (let i = 0; i < 4; i++) {
      const vel = d.clone().multiplyScalar(4 + i * 2).add(this.jitter(1.2));
      this.spawn(p.clone().addScaledVector(d, 0.8 + i * 0.4), 0xb9b4a8, { life: 1.6, s0: 0.5, s1: 2.6, opacity: 0.45, vel });
    }
    this.flash(p, 0xffc070, 30, 0.09);
  }

  /** Kinetic impact on terrain or a structure. */
  dustImpact(pos: Vec3, normal: Vec3): void {
    const p = this.v(pos);
    const n = this.v(normal);
    for (let i = 0; i < 5; i++) {
      const vel = n.clone().multiplyScalar(2 + Math.random() * 3).add(this.jitter(1.5));
      this.spawn(p, 0x8c7a5c, { life: 1.4 + Math.random(), s0: 0.4, s1: 2.2, opacity: 0.6, vel });
    }
  }

  /** Kinetic impact on armour: sparks. */
  sparks(pos: Vec3, normal: Vec3): void {
    const p = this.v(pos);
    const n = this.v(normal);
    for (let i = 0; i < 8; i++) {
      const vel = n.clone().multiplyScalar(6).add(this.jitter(6));
      this.spawn(p, 0xffe0a0, { life: 0.25, s0: 0.12, s1: 0.04, opacity: 1, vel, additive: true });
    }
    this.flash(p, 0xffe0a0, 10, 0.06);
  }

  /** High-explosive detonation, scaled by filler mass. */
  explosion(pos: Vec3, explosiveKg: number): void {
    const p = this.v(pos);
    const k = Math.cbrt(Math.max(explosiveKg, 0.05) / 0.67);
    this.spawn(p, 0xe8641e, { life: 0.35, s0: 0.8 * k, s1: 4.8 * k, opacity: 0.9 });
    this.spawn(p, 0xffc070, { life: 0.15, s0: 0.5 * k, s1: 2.2 * k, opacity: 0.8, additive: true });
    for (let i = 0; i < 7; i++) {
      const vel = this.jitter(3).add(new THREE.Vector3(0, 2.5, 0));
      this.spawn(p, 0x3d3a35, { life: 2.5 + Math.random(), s0: 1 * k, s1: 4.5 * k, opacity: 0.7, vel });
    }
    this.flash(p, 0xff9a40, 80 * k, 0.18);
  }

  /** One rising smoke puff above a burning wreck. */
  wreckSmoke(pos: Vec3): void {
    const p = this.v(pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.6, (Math.random() - 0.5) * 1.5));
    const vel = new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.2 + Math.random(), (Math.random() - 0.5) * 0.6);
    this.spawn(p, 0x2b2926, { life: 4.5, s0: 0.8, s1: 4.5, opacity: 0.55, vel, drag: 0.15 });
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.age += dt;
      const t = pt.age / pt.life;
      if (t >= 1) {
        this.scene.remove(pt.mesh);
        (pt.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      pt.mesh.position.addScaledVector(pt.velocity, dt);
      pt.velocity.multiplyScalar(Math.max(0, 1 - pt.drag * dt));
      const s = pt.startScale + (pt.endScale - pt.startScale) * (1 - (1 - t) * (1 - t));
      pt.mesh.scale.setScalar(s);
      (pt.mesh.material as THREE.MeshBasicMaterial).opacity = pt.startOpacity * (1 - t);
    }
    for (const f of this.flashes) {
      f.age += dt;
      f.light.intensity = f.age >= f.life ? 0 : f.intensity * (1 - f.age / f.life);
    }
  }

  private spawn(
    pos: THREE.Vector3,
    color: number,
    o: { life: number; s0: number; s1: number; opacity: number; vel?: THREE.Vector3; additive?: boolean; drag?: number },
  ): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: o.opacity,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const mesh = new THREE.Mesh(this.sphere, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(o.s0);
    this.scene.add(mesh);
    this.particles.push({
      mesh,
      age: 0,
      life: o.life,
      startScale: o.s0,
      endScale: o.s1,
      startOpacity: o.opacity,
      velocity: o.vel ?? new THREE.Vector3(),
      drag: o.drag ?? 2.5,
    });
  }

  private flash(pos: THREE.Vector3, color: number, intensity: number, life: number): void {
    // Reuse the light closest to finishing.
    let f = this.flashes[0];
    for (const c of this.flashes) if (c.age / c.life > f.age / f.life) f = c;
    f.light.color.set(color);
    f.light.position.copy(pos);
    f.age = 0;
    f.life = life;
    f.intensity = intensity;
  }

  private v(p: Vec3): THREE.Vector3 {
    return new THREE.Vector3(p.x, p.y, p.z);
  }

  private jitter(a: number): THREE.Vector3 {
    return this.tmp.set((Math.random() - 0.5) * 2 * a, Math.random() * a, (Math.random() - 0.5) * 2 * a).clone();
  }
}
