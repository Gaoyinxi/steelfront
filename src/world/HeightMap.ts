import type { Vec3 } from '../core/math';

/**
 * Regular-grid height field centred on the world origin.
 * Samples are stored row-major: index = iz * resolution + ix,
 * where world x = -size/2 + ix * cellSize and world z = -size/2 + iz * cellSize.
 */
export class HeightMap {
  readonly cellSize: number;
  readonly half: number;
  minHeight = Infinity;
  maxHeight = -Infinity;

  constructor(
    readonly size: number,
    readonly resolution: number,
    readonly heights: Float32Array = new Float32Array(resolution * resolution),
  ) {
    this.cellSize = size / (resolution - 1);
    this.half = size / 2;
    if (heights.length !== resolution * resolution) throw new Error('HeightMap: bad buffer size');
    this.recomputeBounds();
  }

  recomputeBounds(): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of this.heights) {
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    this.minHeight = lo;
    this.maxHeight = hi;
  }

  at(ix: number, iz: number): number {
    const r = this.resolution;
    ix = ix < 0 ? 0 : ix >= r ? r - 1 : ix;
    iz = iz < 0 ? 0 : iz >= r ? r - 1 : iz;
    return this.heights[iz * r + ix];
  }

  worldX(ix: number): number {
    return -this.half + ix * this.cellSize;
  }

  worldZ(iz: number): number {
    return -this.half + iz * this.cellSize;
  }

  contains(x: number, z: number): boolean {
    return Math.abs(x) <= this.half && Math.abs(z) <= this.half;
  }

  /**
   * Height at an arbitrary world position, interpolated on the same two
   * triangles per cell that the render mesh and the Rapier heightfield use:
   * each cell is split along the diagonal from (x1,z0) to (x0,z1).
   */
  sample(x: number, z: number): number {
    const fx = (x + this.half) / this.cellSize;
    const fz = (z + this.half) / this.cellSize;
    const ix = Math.min(Math.max(Math.floor(fx), 0), this.resolution - 2);
    const iz = Math.min(Math.max(Math.floor(fz), 0), this.resolution - 2);
    const tx = Math.min(Math.max(fx - ix, 0), 1);
    const tz = Math.min(Math.max(fz - iz, 0), 1);
    const h00 = this.at(ix, iz);
    const h10 = this.at(ix + 1, iz);
    const h01 = this.at(ix, iz + 1);
    const h11 = this.at(ix + 1, iz + 1);
    if (tx + tz <= 1) {
      // Triangle (00, 10, 01)
      return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    }
    // Triangle (11, 01, 10)
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  }

  /** Unit surface normal via central differences. */
  normal(x: number, z: number): Vec3 {
    const e = this.cellSize;
    const dx = this.sample(x + e, z) - this.sample(x - e, z);
    const dz = this.sample(x, z + e) - this.sample(x, z - e);
    const nx = -dx;
    const ny = 2 * e;
    const nz = -dz;
    const l = Math.hypot(nx, ny, nz);
    return { x: nx / l, y: ny / l, z: nz / l };
  }

  /** Slope angle in radians at a world position. */
  slope(x: number, z: number): number {
    return Math.acos(Math.min(1, this.normal(x, z).y));
  }
}
