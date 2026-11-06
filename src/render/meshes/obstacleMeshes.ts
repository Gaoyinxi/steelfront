import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { Rng } from '../../core/Rng';
import type { HeightMap } from '../../world/HeightMap';
import { roofHeight, type Obstacle } from '../../world/obstacles';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import { mat, PartBuilder } from './geometryUtils';

/**
 * Scenery models: houses, ruined stone walls, rocks and trees. Houses and
 * walls are unique sizes, so they are merged into one mesh per material;
 * rocks and trees use a handful of variants drawn with instancing.
 * Visual footprints match the physics shapes built in Simulation.
 */
export function createObstacleMeshes(obstacles: readonly Obstacle[], terrain: HeightMap, lib: MaterialLibrary, seed: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'scenery';
  // Dirt and damp near the ground, measured from the actual terrain.
  const groundGrime = (x: number, y: number, z: number) => Math.max(0, 1 - (y - terrain.sample(x, z)) / 1.2) * 0.55;
  const structures = new PartBuilder(groundGrime, new THREE.Color(0.42, 0.38, 0.3));
  const rng = new Rng(seed ^ 0x5ce4e);

  for (const o of obstacles) {
    const world = mat(o.position.x, o.position.y, o.position.z, 0, o.rotationY);
    if (o.kind === 'building') addHouse(structures, o, world, lib, rng);
    else if (o.kind === 'wall') addWall(structures, o, world, lib, rng);
  }
  group.add(structures.build('structures'));
  group.add(rocks(obstacles.filter((o) => o.kind === 'rock'), lib, seed));
  group.add(trees(obstacles.filter((o) => o.kind === 'tree'), lib, seed));
  return group;
}

// -----------------------------------------------------------------------------
// Houses
// -----------------------------------------------------------------------------

function addHouse(b: PartBuilder, o: Obstacle, world: THREE.Matrix4, lib: MaterialLibrary, rng: Rng): void {
  const { x: w, y: h, z: d } = o.size;
  const plaster = lib.get('plaster');
  const stone = lib.get('masonry');
  const frame = lib.get('frameWood');
  const wood = lib.get('wood');
  const glass = lib.get('windowGlass');
  const roof = lib.get('roof');
  const add = (m: THREE.Material, g: THREE.BufferGeometry, local: THREE.Matrix4) => b.add(m, g, local, world);

  add(stone, new THREE.BoxGeometry(w + 0.24, 0.9, d + 0.24), mat(0, 0.1, 0));
  add(plaster, new THREE.BoxGeometry(w, h, d), mat(0, h / 2, 0));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) add(stone, new THREE.BoxGeometry(0.36, h, 0.36), mat((sx * (w - 0.3)) / 2, h / 2, (sz * (d - 0.3)) / 2));

  // Openings on each face: face frame has +Z outward; `faces` rotate it into place.
  const floors = h >= 6 ? [1.5, 4.3] : [1.6];
  const faces: { len: number; local: (u: number, y: number, out: number) => THREE.Matrix4; door: boolean }[] = [
    { len: w, local: (u, y, out) => mat(u, y, d / 2 + out), door: true },
    { len: w, local: (u, y, out) => mat(-u, y, -d / 2 - out, 0, Math.PI), door: false },
    { len: d, local: (u, y, out) => mat(w / 2 + out, y, -u, 0, Math.PI / 2), door: false },
    { len: d, local: (u, y, out) => mat(-w / 2 - out, y, u, 0, -Math.PI / 2), door: false },
  ];
  for (const f of faces) {
    const n = Math.max(1, Math.floor((f.len - 1.4) / 2.6));
    for (let i = 0; i < n; i++) {
      const u = -f.len / 2 + (f.len / n) * (i + 0.5);
      for (const y of floors) {
        if (f.door && y === floors[0] && Math.abs(u) < 1.4) continue;
        addWindow(add, f.local, u, y, { frame, wood, glass, stone }, rng);
      }
    }
    if (f.door) {
      add(wood, new THREE.BoxGeometry(1.1, 2.15, 0.06), f.local(0, 1.07, 0.0));
      for (const [bw, bh, bx, by] of [
        [0.12, 2.3, -0.61, 1.15],
        [0.12, 2.3, 0.61, 1.15],
        [1.34, 0.14, 0, 2.3],
      ])
        add(frame, new THREE.BoxGeometry(bw, bh, 0.12), f.local(bx, by, 0.04));
      add(stone, new THREE.BoxGeometry(1.6, 0.18, 0.6), f.local(0, 0.09, 0.25));
    }
  }

  // Gabled roof: ridge along local X, tiled slabs with overhang, plastered gables.
  const rh = roofHeight(o);
  const phi = Math.atan2(rh, d / 2);
  const overhang = 0.4;
  const slab = (d / 2 + overhang) / Math.cos(phi);
  for (const s of [-1, 1]) {
    const cz = s * (slab / 2) * Math.cos(phi);
    const cy = h + rh - (slab / 2) * Math.sin(phi) + 0.07;
    add(roof, new THREE.BoxGeometry(w + 0.7, 0.14, slab), mat(0, cy, cz, s * phi));
  }
  add(roof, new THREE.BoxGeometry(w + 0.75, 0.16, 0.22), mat(0, h + rh + 0.1, 0)); // ridge tiles
  const gable = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rh)]);
  for (const s of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false }).rotateY(Math.PI / 2);
    add(plaster, g, mat(s * (w / 2) - 0.15, h, 0));
  }
  // Chimney through the roof.
  const chimneyH = rh + 1.0;
  add(stone, new THREE.BoxGeometry(0.65, chimneyH, 0.65), mat(w * 0.25, h + chimneyH / 2, d * 0.12));
  add(stone, new THREE.BoxGeometry(0.8, 0.12, 0.8), mat(w * 0.25, h + chimneyH, d * 0.12));
}

function addWindow(
  add: (m: THREE.Material, g: THREE.BufferGeometry, local: THREE.Matrix4) => void,
  local: (u: number, y: number, out: number) => THREE.Matrix4,
  u: number,
  y: number,
  m: { frame: THREE.Material; wood: THREE.Material; glass: THREE.Material; stone: THREE.Material },
  rng: Rng,
): void {
  const W = 1.0;
  const H = 1.3;
  add(m.glass, new THREE.BoxGeometry(W, H, 0.02), local(u, y, 0.005));
  for (const [bw, bh, bx, by] of [
    [0.09, H + 0.09, -W / 2, 0],
    [0.09, H + 0.09, W / 2, 0],
    [W + 0.09, 0.09, 0, H / 2],
    [W + 0.09, 0.09, 0, -H / 2],
    [0.05, H, 0, 0],
    [W, 0.05, 0, 0.1],
  ])
    add(m.frame, new THREE.BoxGeometry(bw, bh, 0.08), local(u + bx, y + by, 0.04));
  add(m.stone, new THREE.BoxGeometry(W + 0.3, 0.08, 0.2), local(u, y - H / 2 - 0.08, 0.08));
  // Shutters folded back against the wall (a few hang closed).
  if (rng.chance(0.2)) {
    add(m.wood, new THREE.BoxGeometry(W, H, 0.05), local(u, y, 0.1));
  } else {
    for (const s of [-1, 1]) add(m.wood, new THREE.BoxGeometry(W / 2, H, 0.04), local(u + s * (W * 0.75 + 0.06), y, 0.03));
  }
}

// -----------------------------------------------------------------------------
// Ruined stone walls
// -----------------------------------------------------------------------------

function addWall(b: PartBuilder, o: Obstacle, world: THREE.Matrix4, lib: MaterialLibrary, rng: Rng): void {
  const { x: len, y: h, z: t } = o.size;
  const stone = lib.get('masonry');
  const g = new THREE.BoxGeometry(len, h, t, Math.max(2, Math.ceil(len / 0.5)), 4, 1);
  const pos = g.getAttribute('position');
  const phase = rng.range(0, 100);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    let y = pos.getY(i);
    // Broken top edge; irregular faces.
    if (y > h / 2 - 1e-6) y -= Math.max(0, Math.sin(x * 1.3 + phase) * 0.12 + Math.sin(x * 3.7 + phase * 2) * 0.08 + 0.06);
    pos.setXYZ(i, x + Math.sin(y * 9 + phase) * 0.02, y, pos.getZ(i) * (1 + Math.sin(x * 5 + y * 3) * 0.06));
  }
  g.computeVertexNormals();
  b.add(stone, g, mat(0, h / 2, 0), world);
  b.add(stone, new THREE.BoxGeometry(len + 0.1, 0.2, t + 0.25), mat(0, 0.05, 0), world);
  // Fallen stones at the foot.
  for (let i = 0; i < Math.round(len / 3); i++) {
    const s = rng.range(0.25, 0.5);
    const side = rng.chance(0.5) ? 1 : -1;
    b.add(
      stone,
      new THREE.BoxGeometry(s * 1.4, s * 0.7, s),
      mat(rng.range(-len / 2, len / 2), s * 0.3, side * (t / 2 + rng.range(0.3, 1.0)), rng.range(-0.3, 0.3), rng.range(0, 3), rng.range(-0.3, 0.3)),
      world,
    );
  }
}

// -----------------------------------------------------------------------------
// Rocks (instanced variants)
// -----------------------------------------------------------------------------

function rocks(list: readonly Obstacle[], lib: MaterialLibrary, seed: number): THREE.Group {
  const group = new THREE.Group();
  if (list.length === 0) return group;
  const VARIANTS = 6;
  const rng = new Rng(seed ^ 0x70c4);
  const n3 = createNoise3D(() => rng.next());
  const material = lib.get('rock');
  const variants: THREE.BufferGeometry[] = [];
  for (let v = 0; v < VARIANTS; v++) {
    const g = new THREE.IcosahedronGeometry(0.5, 3);
    const pos = g.getAttribute('position');
    const p = new THREE.Vector3();
    const off = v * 17.3;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).normalize();
      let r = 1 + 0.22 * n3(p.x * 1.6 + off, p.y * 1.6, p.z * 1.6) + 0.08 * n3(p.x * 5 + off, p.y * 5, p.z * 5);
      r *= 0.5;
      p.multiplyScalar(r);
      if (p.y < -0.22) p.y = -0.22 + (p.y + 0.22) * 0.25; // flat underside, sits on the ground
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    g.computeVertexNormals();
    // Moss on upward-facing surfaces near the top.
    const built = new PartBuilder((_x, y) => Math.max(0, (y - 0.08) / 0.3) * 0.6, new THREE.Color(0.42, 0.5, 0.28), 0.3)
      .add(material, g)
      .build();
    variants.push((built.children[0] as THREE.Mesh).geometry);
  }
  const buckets: Obstacle[][] = Array.from({ length: VARIANTS }, () => []);
  list.forEach((o) => buckets[o.id % VARIANTS].push(o));
  const m = new THREE.Matrix4();
  const tint = new THREE.Color();
  buckets.forEach((items, v) => {
    if (items.length === 0) return;
    const mesh = new THREE.InstancedMesh(variants[v], material, items.length);
    items.forEach((o, i) => {
      m.compose(
        new THREE.Vector3(o.position.x, o.position.y + o.size.y * 0.42, o.position.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rotationY),
        new THREE.Vector3(o.size.x, o.size.y, o.size.z),
      );
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, tint.setScalar(0.85 + 0.3 * ((o.id * 0.618) % 1)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

// -----------------------------------------------------------------------------
// Trees (instanced variants, unit height scaled per tree)
// -----------------------------------------------------------------------------

function trees(list: readonly Obstacle[], lib: MaterialLibrary, seed: number): THREE.Group {
  const group = new THREE.Group();
  if (list.length === 0) return group;
  const rng = new Rng(seed ^ 0x7ee5);
  const n3 = createNoise3D(() => rng.next());
  const bark = lib.get('bark');
  const leaves = lib.get('foliage');
  const VARIANTS = 4;
  const variants: { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry }[] = [];

  const jitter = (g: THREE.BufferGeometry, amount: number, off: number) => {
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const k = 1 + amount * n3(x * 9 + off, y * 9, z * 9);
      pos.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    return g;
  };

  for (let v = 0; v < VARIANTS; v++) {
    const broadleaf = v === VARIANTS - 1;
    const trunkB = new PartBuilder((_x, y) => Math.max(0, 0.25 - y) * 2, new THREE.Color(0.35, 0.3, 0.25), 0.1);
    trunkB.add(bark, new THREE.CylinderGeometry(0.012, broadleaf ? 0.03 : 0.024, broadleaf ? 0.75 : 0.9, 8, 4), mat(0, broadleaf ? 0.375 : 0.45, 0));
    // Darker, denser foliage low and inside; lighter at the tips.
    const crownB = new PartBuilder((_x, y) => Math.max(0, 0.75 - y) * 0.7, new THREE.Color(0.55, 0.6, 0.5), 0.1);
    if (broadleaf) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + v;
        const r = 0.11 + 0.04 * Math.sin(k * 2.3);
        const g = jitter(new THREE.IcosahedronGeometry(0.17, 2), 0.25, v * 3 + k);
        crownB.add(leaves, g, mat(Math.cos(a) * r, 0.68 + 0.1 * Math.sin(k * 1.7), Math.sin(a) * r));
      }
      crownB.add(leaves, jitter(new THREE.IcosahedronGeometry(0.22, 2), 0.25, v * 7), mat(0, 0.86, 0));
    } else {
      const layers = 6 + v;
      for (let k = 0; k < layers; k++) {
        const f = k / layers;
        const r = 0.21 * (1 - f) + 0.03;
        const cone = jitter(new THREE.ConeGeometry(r, 0.26, 11, 3, true), 0.18, v * 5 + k);
        crownB.add(leaves, cone, mat(0, 0.24 + f * 0.7, 0, 0, k * 0.7));
      }
    }
    variants.push({
      trunk: (trunkB.build().children[0] as THREE.Mesh).geometry,
      crown: (crownB.build().children[0] as THREE.Mesh).geometry,
    });
  }

  const buckets: Obstacle[][] = Array.from({ length: VARIANTS }, () => []);
  // Broadleaf trees are rarer (about one in six).
  list.forEach((o) => buckets[o.id % 6 === 0 ? VARIANTS - 1 : o.id % (VARIANTS - 1)].push(o));
  const m = new THREE.Matrix4();
  const tint = new THREE.Color();
  buckets.forEach((items, v) => {
    if (items.length === 0) return;
    const trunk = new THREE.InstancedMesh(variants[v].trunk, bark, items.length);
    const crown = new THREE.InstancedMesh(variants[v].crown, leaves, items.length);
    items.forEach((o, i) => {
      const s = o.size.y;
      m.compose(
        new THREE.Vector3(o.position.x, o.position.y, o.position.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rotationY),
        new THREE.Vector3(s, s, s),
      );
      trunk.setMatrixAt(i, m);
      crown.setMatrixAt(i, m);
      const k = (o.id * 0.754877) % 1;
      crown.setColorAt(i, tint.setRGB(0.85 + 0.25 * k, 0.9 + 0.2 * k, 0.8 + 0.15 * (1 - k)));
    });
    for (const mesh of [trunk, crown]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  });
  return group;
}
