/**
 * Grid navigation for ground vehicles: a coarse occupancy grid over the map
 * (obstacles inflated by the vehicle clearance, steep slopes and the raised
 * border marked blocked), 8-connected A* and string-pulling path smoothing.
 * Pure data + functions; built once per map.
 */
import type { Vec3 } from '../core/math';
import type { HeightMap } from '../world/HeightMap';
import type { Obstacle } from '../world/obstacles';

export interface NavGridOptions {
  /** Cell edge length (m). */
  cellSize: number;
  /** Half vehicle width plus margin, added around every obstacle (m). */
  clearance: number;
  /** Steeper terrain is impassable. */
  maxSlopeDeg: number;
  /** Cells closer than this to the map edge are blocked (m). */
  edgeMargin: number;
}

export const DEFAULT_NAV_OPTIONS: NavGridOptions = { cellSize: 4, clearance: 3.5, maxSlopeDeg: 24, edgeMargin: 40 };

const SQRT2 = Math.SQRT2;
const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  readonly half: number;
  readonly blocked: Uint8Array;

  private constructor(
    readonly size: number,
    readonly cellSize: number,
    private readonly terrain: HeightMap,
  ) {
    this.cols = Math.floor(size / cellSize);
    this.rows = this.cols;
    this.half = size / 2;
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  static build(terrain: HeightMap, obstacles: readonly Obstacle[], opts: NavGridOptions = DEFAULT_NAV_OPTIONS): NavGrid {
    const g = new NavGrid(terrain.size, opts.cellSize, terrain);
    const maxSlope = (opts.maxSlopeDeg * Math.PI) / 180;
    const limit = g.half - opts.edgeMargin;

    for (let cz = 0; cz < g.rows; cz++) {
      for (let cx = 0; cx < g.cols; cx++) {
        const { x, z } = g.centre(cx, cz);
        if (Math.abs(x) > limit || Math.abs(z) > limit || terrain.slope(x, z) > maxSlope) {
          g.blocked[g.index(cx, cz)] = 1;
        }
      }
    }

    for (const o of obstacles) {
      const c = Math.cos(o.rotationY);
      const s = Math.sin(o.rotationY);
      const shrink = o.kind === 'rock' ? 0.8 : 1;
      // Trees are thin trunks; everything else is an oriented footprint box.
      const hx = o.kind === 'tree' ? 0.35 : (o.size.x / 2) * shrink;
      const hz = o.kind === 'tree' ? 0.35 : (o.size.z / 2) * shrink;
      const reach = Math.hypot(hx, hz) + opts.clearance;
      const [x0, z0] = g.cellOf(o.position.x - reach, o.position.z - reach);
      const [x1, z1] = g.cellOf(o.position.x + reach, o.position.z + reach);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const p = g.centre(cx, cz);
          const dx = p.x - o.position.x;
          const dz = p.z - o.position.z;
          // World -> obstacle-local (inverse of the Y rotation used to place it).
          const lx = dx * c - dz * s;
          const lz = dx * s + dz * c;
          const inside =
            o.kind === 'tree'
              ? Math.hypot(dx, dz) <= hx + opts.clearance
              : Math.abs(lx) <= hx + opts.clearance && Math.abs(lz) <= hz + opts.clearance;
          if (inside) g.blocked[g.index(cx, cz)] = 1;
        }
      }
    }
    return g;
  }

  index(cx: number, cz: number): number {
    return cz * this.cols + cx;
  }

  /** Cell containing a world position (clamped to the grid). */
  cellOf(x: number, z: number): [number, number] {
    const cx = Math.floor((x + this.half) / this.cellSize);
    const cz = Math.floor((z + this.half) / this.cellSize);
    return [Math.min(Math.max(cx, 0), this.cols - 1), Math.min(Math.max(cz, 0), this.rows - 1)];
  }

  centre(cx: number, cz: number): Vec3 {
    const x = -this.half + (cx + 0.5) * this.cellSize;
    const z = -this.half + (cz + 0.5) * this.cellSize;
    return { x, y: this.terrain.sample(x, z), z };
  }

  isFreeCell(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows && this.blocked[this.index(cx, cz)] === 0;
  }

  isFree(x: number, z: number): boolean {
    if (Math.abs(x) >= this.half || Math.abs(z) >= this.half) return false;
    const [cx, cz] = this.cellOf(x, z);
    return this.isFreeCell(cx, cz);
  }

  /** Nearest free cell to a world position within `maxRadius` cells (ring search). */
  nearestFree(x: number, z: number, maxRadius = 10): [number, number] | null {
    const [cx, cz] = this.cellOf(x, z);
    if (this.isFreeCell(cx, cz)) return [cx, cz];
    for (let r = 1; r <= maxRadius; r++) {
      let best: [number, number] | null = null;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || !this.isFreeCell(cx + dx, cz + dz)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = [cx + dx, cz + dz];
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** True if a straight drive from a to b only crosses free cells. */
  lineFree(a: Vec3, b: Vec3): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (this.cellSize * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(a.x + dx * t, a.z + dz * t)) return false;
    }
    return true;
  }

  /**
   * Smoothed path from `from` to `to` as a list of waypoints (excluding the
   * start, ending at the goal). Null if the goal is unreachable.
   */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    const start = this.nearestFree(from.x, from.z);
    const goal = this.nearestFree(to.x, to.z);
    if (!start || !goal) return null;
    const goalPoint = this.isFree(to.x, to.z) ? { x: to.x, y: this.terrain.sample(to.x, to.z), z: to.z } : this.centre(goal[0], goal[1]);
    if (this.isFree(from.x, from.z) && this.lineFree(from, goalPoint)) return [goalPoint];

    const n = this.cols * this.rows;
    const gScore = new Float64Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new MinHeap();
    const s = this.index(start[0], start[1]);
    const goalIdx = this.index(goal[0], goal[1]);
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - goal[0]);
      const dz = Math.abs(Math.floor(i / this.cols) - goal[1]);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz); // octile distance
    };
    gScore[s] = 0;
    open.push(s, h(s));

    while (open.size > 0) {
      const cur = open.pop();
      if (cur === goalIdx) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.cols;
      const cz = Math.floor(cur / this.cols);
      for (const [ox, oz, cost] of NEIGHBOURS) {
        const nx = cx + ox;
        const nz = cz + oz;
        if (!this.isFreeCell(nx, nz)) continue;
        // No corner cutting past blocked cells on diagonal moves.
        if (ox !== 0 && oz !== 0 && (!this.isFreeCell(cx + ox, cz) || !this.isFreeCell(cx, cz + oz))) continue;
        const ni = this.index(nx, nz);
        const g = gScore[cur] + cost;
        if (g < gScore[ni]) {
          gScore[ni] = g;
          cameFrom[ni] = cur;
          open.push(ni, g + h(ni));
        }
      }
    }
    if (gScore[goalIdx] === Infinity) return null;

    const cells: Vec3[] = [];
    for (let i = goalIdx; i !== -1 && i !== s; i = cameFrom[i]) {
      cells.push(this.centre(i % this.cols, Math.floor(i / this.cols)));
    }
    cells.reverse();
    cells[cells.length - 1] = goalPoint;
    return this.smooth(from, cells);
  }

  /** String pulling: skip waypoints that can be reached in a straight line. */
  smooth(from: Vec3, points: Vec3[]): Vec3[] {
    const out: Vec3[] = [];
    let anchor = from;
    let i = 0;
    while (i < points.length) {
      let j = points.length - 1;
      while (j > i && !this.lineFree(anchor, points[j])) j--;
      out.push(points[j]);
      anchor = points[j];
      i = j + 1;
    }
    return out;
  }
}

/** Binary min-heap of (item, priority) pairs. */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, priority: number): void {
    this.items.push(item);
    this.prio.push(priority);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prio[p] <= this.prio[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
