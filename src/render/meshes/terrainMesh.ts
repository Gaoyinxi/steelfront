import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { Rng } from '../../core/Rng';
import type { HeightMap } from '../../world/HeightMap';

const GRASS_A = new THREE.Color(0x5d7a3a);
const GRASS_B = new THREE.Color(0x77904a);
const DRY = new THREE.Color(0x9a9058);
const DIRT = new THREE.Color(0x7a6448);
const ROCK = new THREE.Color(0x77736b);

/**
 * Builds the terrain mesh directly from the HeightMap. Triangles use the same
 * diagonal split as the physics heightfield so visuals and collision agree.
 */
export function createTerrainMesh(hm: HeightMap, seed: number): THREE.Mesh {
  const n = hm.resolution;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3);
  const rng = new Rng(seed ^ 0x51ed);
  const tint = createNoise2D(() => rng.next());
  const c = new THREE.Color();

  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const x = hm.worldX(ix);
      const z = hm.worldZ(iz);
      const y = hm.heights[i];
      positions.set([x, y, z], i * 3);

      const slope = hm.slope(x, z);
      const t = tint(x / 90, z / 90) * 0.5 + 0.5;
      c.copy(GRASS_A).lerp(GRASS_B, t);
      const dryness = Math.max(0, tint(x / 300 + 17, z / 300) - 0.25);
      c.lerp(DRY, Math.min(0.6, dryness));
      if (slope > 0.32) c.lerp(DIRT, Math.min(1, (slope - 0.32) * 4));
      if (slope > 0.6) c.lerp(ROCK, Math.min(1, (slope - 0.6) * 3));
      const jitter = 0.94 + rng.next() * 0.08;
      colors.set([c.r * jitter, c.g * jitter, c.b * jitter], i * 3);
    }
  }

  const indices = new Uint32Array((n - 1) * (n - 1) * 6);
  let k = 0;
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const i00 = iz * n + ix;
      const i10 = i00 + 1;
      const i01 = i00 + n;
      const i11 = i01 + 1;
      // Diagonal (x1,z0)-(x0,z1), counter-clockwise when viewed from +Y.
      indices[k++] = i00;
      indices[k++] = i01;
      indices[k++] = i10;
      indices[k++] = i11;
      indices[k++] = i10;
      indices[k++] = i01;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
