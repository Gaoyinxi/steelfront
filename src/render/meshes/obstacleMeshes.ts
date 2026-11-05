import * as THREE from 'three';
import type { Obstacle, ObstacleKind } from '../../world/obstacles';

/** Placeholder obstacle visuals, batched as one InstancedMesh per part. */
export function createObstacleMeshes(obstacles: Obstacle[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'obstacles';
  const byKind = (k: ObstacleKind) => obstacles.filter((o) => o.kind === k);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const batch = (
    list: Obstacle[],
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    place: (o: Obstacle) => { pos: THREE.Vector3; scale: THREE.Vector3; rotY: number },
  ) => {
    if (list.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, i) => {
      const t = place(o);
      q.setFromAxisAngle(up, t.rotY);
      m.compose(t.pos, q, t.scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const centred = (o: Obstacle) => ({
    pos: p.set(o.position.x, o.position.y + o.size.y / 2, o.position.z).clone(),
    scale: s.set(o.size.x, o.size.y, o.size.z).clone(),
    rotY: o.rotationY,
  });

  // Rocks: low-poly icosahedra with flat shading.
  const rockGeo = new THREE.IcosahedronGeometry(0.62, 0);
  batch(byKind('rock'), rockGeo, new THREE.MeshLambertMaterial({ color: 0x8a867d, flatShading: true }), centred);

  // Ruined stone walls.
  batch(byKind('wall'), unitBox, new THREE.MeshLambertMaterial({ color: 0xa39782 }), centred);

  // Buildings: body + darker pitched roof.
  const buildings = byKind('building');
  batch(buildings, unitBox, new THREE.MeshLambertMaterial({ color: 0xc7b99a }), centred);
  const roofGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1);
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.rotateX(Math.PI / 2);
  roofGeo.rotateY(Math.PI / 2);
  batch(buildings, roofGeo, new THREE.MeshLambertMaterial({ color: 0x6e3b2e, flatShading: true }), (o) => ({
    pos: new THREE.Vector3(o.position.x, o.position.y + o.size.y + o.size.x * 0.2, o.position.z),
    scale: new THREE.Vector3(o.size.x * 1.08, o.size.x * 0.55, o.size.z * 1.08),
    rotY: o.rotationY,
  }));

  // Trees: trunk + conical canopy.
  const trees = byKind('tree');
  batch(trees, new THREE.CylinderGeometry(0.18, 0.28, 1, 6), new THREE.MeshLambertMaterial({ color: 0x5a4532 }), (o) => ({
    pos: new THREE.Vector3(o.position.x, o.position.y + o.size.y * 0.25, o.position.z),
    scale: new THREE.Vector3(1, o.size.y * 0.5, 1),
    rotY: 0,
  }));
  batch(trees, new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ color: 0x2f5128, flatShading: true }), (o) => ({
    pos: new THREE.Vector3(o.position.x, o.position.y + o.size.y * 0.62, o.position.z),
    scale: new THREE.Vector3(o.size.y * 0.22, o.size.y * 0.8, o.size.y * 0.22),
    rotY: o.rotationY,
  }));

  return group;
}
