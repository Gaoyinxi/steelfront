import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Converts a geometry to the canonical layout used for merging: non-indexed,
 * with exactly position / normal / uv / color attributes.
 */
function canonical(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.clearGroups();
  return g;
}

/**
 * Box-projected UVs from positions (metres / tile): each triangle is mapped on
 * the plane most aligned with its face normal, so texel density is uniform
 * across parts of any size and textures continue across touching parts.
 */
export function boxProjectUV(g: THREE.BufferGeometry, tile: number): void {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a)).normalize();
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const p = k === 0 ? a : k === 1 ? b : c;
      let u: number;
      let v: number;
      if (ax >= ay && ax >= az) {
        u = p.z;
        v = p.y;
      } else if (ay >= az) {
        u = p.x;
        v = p.z;
      } else {
        u = p.x;
        v = p.y;
      }
      uv[(i + k) * 2] = u / tile;
      uv[(i + k) * 2 + 1] = v / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Per-vertex grime: 0 = clean, 1 = full tint, as a function of builder-frame position. */
export type GrimeFn = (x: number, y: number, z: number) => number;

const WHITE = new THREE.Color(1, 1, 1);

/**
 * Collects parts in a common frame, groups them by material and merges each
 * group into one mesh (one draw call per material per builder).
 */
export class PartBuilder {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private readonly tmp = new THREE.Color();

  /**
   * @param grime     grime factor per vertex (builder frame)
   * @param grimeTint colour multiplied in at full grime
   * @param tileScale multiplier on each material's tile size; < 1 for unit-sized
   *                  variant meshes that instancing scales up later
   */
  constructor(
    private readonly grime: GrimeFn = () => 0,
    private readonly grimeTint = new THREE.Color(0.55, 0.47, 0.37),
    private readonly tileScale = 1,
  ) {}

  /**
   * Adds a part. `local` places it in its object frame (UVs are projected
   * there, so a rotated house keeps upright textures); `world` then moves it
   * into the builder frame.
   */
  add(material: THREE.Material, geometry: THREE.BufferGeometry, local?: THREE.Matrix4, world?: THREE.Matrix4): this {
    const g = canonical(geometry);
    if (local) g.applyMatrix4(local);
    boxProjectUV(g, ((material.userData.tile as number | undefined) ?? 1) * this.tileScale);
    if (world) g.applyMatrix4(world);
    const pos = g.getAttribute('position');
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const f = Math.max(0, Math.min(1, this.grime(pos.getX(i), pos.getY(i), pos.getZ(i))));
      this.tmp.copy(WHITE).lerp(this.grimeTint, f);
      colors[i * 3] = this.tmp.r;
      colors[i * 3 + 1] = this.tmp.g;
      colors[i * 3 + 2] = this.tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const list = this.parts.get(material) ?? [];
    list.push(g);
    this.parts.set(material, list);
    return this;
  }

  /** Merged meshes, one per material. */
  build(name = 'parts'): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.parts.clear();
    return group;
  }
}

/** Matrix helper: translation, Euler rotation (radians, XYZ) and scale. */
export function mat(
  x = 0,
  y = 0,
  z = 0,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

export interface Plane {
  n: { x: number; y: number; z: number };
  d: number;
}

/**
 * Mesh of the convex polyhedron { p | n_i · p <= d_i } (flat-shaded,
 * outward-facing). Used to build hull and turret meshes straight from the
 * armour model's planes, so visuals and ballistics share one shape.
 */
export function convexPolyhedronGeometry(planes: readonly Plane[]): THREE.BufferGeometry {
  const eps = 1e-6;
  const N = planes.map((p) => new THREE.Vector3(p.n.x, p.n.y, p.n.z));
  const vertices: THREE.Vector3[] = [];
  for (let i = 0; i < planes.length; i++)
    for (let j = i + 1; j < planes.length; j++)
      for (let k = j + 1; k < planes.length; k++) {
        const c = new THREE.Vector3().crossVectors(N[j], N[k]);
        const det = N[i].dot(c);
        if (Math.abs(det) < 1e-9) continue;
        const p = c
          .multiplyScalar(planes[i].d)
          .add(new THREE.Vector3().crossVectors(N[k], N[i]).multiplyScalar(planes[j].d))
          .add(new THREE.Vector3().crossVectors(N[i], N[j]).multiplyScalar(planes[k].d))
          .divideScalar(det);
        if (planes.every((pl, m) => N[m].dot(p) <= pl.d + eps) && !vertices.some((v) => v.distanceToSquared(p) < 1e-10)) {
          vertices.push(p);
        }
      }

  const positions: number[] = [];
  planes.forEach((pl, i) => {
    const n = N[i];
    const face = vertices.filter((v) => Math.abs(n.dot(v) - pl.d) < 1e-5);
    if (face.length < 3) return;
    const centre = face.reduce((acc, v) => acc.add(v), new THREE.Vector3()).divideScalar(face.length);
    const u = new THREE.Vector3().subVectors(face[0], centre).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    face.sort(
      (a, b) =>
        Math.atan2(w.dot(a.clone().sub(centre)), u.dot(a.clone().sub(centre))) -
        Math.atan2(w.dot(b.clone().sub(centre)), u.dot(b.clone().sub(centre))),
    );
    for (let t = 1; t < face.length - 1; t++) {
      for (const v of [face[0], face[t], face[t + 1]]) positions.push(v.x, v.y, v.z);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}
