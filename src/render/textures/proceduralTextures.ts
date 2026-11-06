/**
 * Procedural, seamlessly tiling textures generated at start-up. No external
 * assets are required; every texture is deterministic for a given seed.
 *
 * Seamless tiling uses 4-D simplex noise sampled on a torus: the unit square's
 * u and v coordinates each map to a circle, so the pattern wraps perfectly.
 */
import * as THREE from 'three';
import { createNoise4D } from 'simplex-noise';
import { Rng } from '../../core/Rng';

type RGB = [number, number, number];

const TAU = Math.PI * 2;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const hexRGB = (hex: number): RGB => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];

/** Seamless noise on the unit square. Frequencies are in cycles per tile. */
export class TileNoise {
  private readonly n4: (x: number, y: number, z: number, w: number) => number;

  constructor(seed: number) {
    const rng = new Rng(seed);
    this.n4 = createNoise4D(() => rng.next());
  }

  noise(u: number, v: number, fu: number, fv = fu): number {
    const a = u * TAU;
    const b = v * TAU;
    const ru = fu / TAU;
    const rv = fv / TAU;
    return this.n4(ru * Math.cos(a), ru * Math.sin(a), rv * Math.cos(b), rv * Math.sin(b));
  }

  /** Fractal sum, normalised to roughly [-1, 1]. */
  fbm(u: number, v: number, f: number, octaves: number, fvScale = 1, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = f;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(u, v, freq, freq * fvScale);
      norm += amp;
      amp *= gain;
      freq *= 2;
    }
    return sum / norm;
  }

  /** Ridged fractal (sharp crests / cracks), roughly [0, 1]. */
  ridged(u: number, v: number, f: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let freq = f;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.noise(u + o * 0.13, v + o * 0.29, freq));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}

/** Seamless jittered-grid Voronoi: distances to the nearest two feature points and the nearest cell id. */
class TileVoronoi {
  private readonly points: Float32Array;

  constructor(
    private readonly cells: number,
    seed: number,
  ) {
    const rng = new Rng(seed);
    this.points = new Float32Array(cells * cells * 2);
    for (let i = 0; i < this.points.length; i++) this.points[i] = 0.15 + 0.7 * rng.next();
  }

  sample(u: number, v: number): { f1: number; f2: number; id: number } {
    const n = this.cells;
    const x = u * n;
    const y = v * n;
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    let f1 = Infinity;
    let f2 = Infinity;
    let id = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx;
        const gy = cy + dy;
        const wx = ((gx % n) + n) % n;
        const wy = ((gy % n) + n) % n;
        const k = (wy * n + wx) * 2;
        const px = gx + this.points[k];
        const py = gy + this.points[k + 1];
        const d = Math.hypot(px - x, py - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = wy * n + wx;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return { f1, f2, id };
  }
}

const hash01 = (i: number) => {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
};

function toTexture(size: number, data: Uint8Array, srgb: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** A colour texture and a matching height field (for normal maps). */
interface Baked {
  color: Uint8Array;
  height: Float32Array;
}

function bake(size: number, fn: (u: number, v: number) => { c: RGB; h: number }): Baked {
  const color = new Uint8Array(size * size * 4);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { c, h } = fn((x + 0.5) / size, (y + 0.5) / size);
      const i = y * size + x;
      color[i * 4] = Math.max(0, Math.min(255, c[0] * 255));
      color[i * 4 + 1] = Math.max(0, Math.min(255, c[1] * 255));
      color[i * 4 + 2] = Math.max(0, Math.min(255, c[2] * 255));
      color[i * 4 + 3] = 255;
      height[i] = h;
    }
  }
  return { color, height };
}

/** Tangent-space normal map from a wrapping height field. `strength` scales slopes. */
function normalMap(size: number, height: Float32Array, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return toTexture(size, data, false);
}

/** Grey-scale roughness map (three.js reads the green channel). */
function roughnessMap(size: number, fn: (u: number, v: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = Math.max(0, Math.min(1, fn((x + 0.5) / size, (y + 0.5) / size))) * 255;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = r;
      data[i + 3] = 255;
    }
  }
  return toTexture(size, data, false);
}

export interface TextureSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

/**
 * Three-tone disruptive camouflage over a base coat, with fading, grain and
 * vertical rain streaks. Tile ≈ 3 m.
 */
export function camouflage(colors: [number, number, number], seed: number): TextureSet {
  const size = 512;
  const [base, c1, c2] = colors.map(hexRGB) as [RGB, RGB, RGB];
  const a = new TileNoise(seed);
  const b = new TileNoise(seed + 1);
  const g = new TileNoise(seed + 2);
  const baked = bake(size, (u, v) => {
    const n1 = a.fbm(u, v, 3, 4);
    const n2 = b.fbm(u, v, 3, 4);
    let c = base;
    const t1 = smoothstep(0.16, 0.22, n1);
    c = mix(c, c1, t1);
    c = mix(c, c2, smoothstep(0.2, 0.26, n2) * (1 - t1 * 0.6));
    const fade = 1 + 0.07 * g.fbm(u, v, 1.5, 2);
    const grain = 1 + 0.035 * g.noise(u, v, 96);
    const streak = 1 - 0.06 * Math.max(0, g.fbm(u, v, 40, 2, 0.08));
    const k = fade * grain * streak;
    return { c: [c[0] * k, c[1] * k, c[2] * k], h: 0 };
  });
  return {
    map: toTexture(size, baked.color, true),
    roughnessMap: roughnessMap(256, (u, v) => 0.68 + 0.16 * g.fbm(u, v, 18, 3)),
  };
}

/** Rolled armour plate: fine mill scale. Tile ≈ 3 m (matches the paint). */
export function rolledSteelNormal(seed: number): THREE.Texture {
  const size = 512;
  const n = new TileNoise(seed);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      h[y * size + x] = 0.25 * n.fbm(u, v, 48, 2) + 0.75 * n.fbm(u, v, 6, 2);
    }
  return normalMap(size, h, 1.2);
}

/** Cast armour: pitted, undulating surface. Tile ≈ 3 m. */
export function castSteelNormal(seed: number): THREE.Texture {
  const size = 512;
  const n = new TileNoise(seed);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      h[y * size + x] = n.fbm(u, v, 5, 3) + 0.12 * n.fbm(u, v, 40, 2);
    }
  return normalMap(size, h, 2.4);
}

/** Worn track steel with rust and caked mud. Tile ≈ 1 m. */
export function trackSteel(seed: number): TextureSet {
  const size = 256;
  const n = new TileNoise(seed);
  const steel = hexRGB(0x3b3733);
  const rust = hexRGB(0x6e4a2e);
  const mud = hexRGB(0x5a4c3a);
  const baked = bake(size, (u, v) => {
    const r = smoothstep(0.05, 0.4, n.fbm(u, v, 6, 4));
    const m = smoothstep(0.1, 0.5, n.fbm(u + 0.3, v, 4, 3));
    const c = mix(mix(steel, rust, r * 0.7), mud, m * 0.6);
    return { c, h: n.fbm(u, v, 24, 3) + m * 0.6 };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 2.5) };
}

/** Weathered rock with cracks. Tile ≈ 2 m. */
export function rock(seed: number): TextureSet {
  const size = 512;
  const n = new TileNoise(seed);
  const light = hexRGB(0x8d8a82);
  const dark = hexRGB(0x56524b);
  const warm = hexRGB(0x7f7259);
  const baked = bake(size, (u, v) => {
    const ridge = n.ridged(u, v, 5, 5);
    const tone = n.fbm(u, v, 3, 3) * 0.5 + 0.5;
    let c = mix(dark, light, tone);
    c = mix(c, warm, smoothstep(0.1, 0.5, n.fbm(u + 0.5, v, 2, 2)) * 0.4);
    const crack = smoothstep(0.82, 0.95, ridge);
    c = mix(c, [0.18, 0.17, 0.16], crack * 0.7);
    return { c, h: n.fbm(u, v, 8, 5) * 0.8 - crack * 0.6 };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 4) };
}

/** Lime plaster with stains. Tile ≈ 3 m. */
export function plaster(seed: number): TextureSet {
  const size = 512;
  const n = new TileNoise(seed);
  const base = hexRGB(0xc9bfa6);
  const stain = hexRGB(0x8f8670);
  const baked = bake(size, (u, v) => {
    const s = smoothstep(0.05, 0.45, n.fbm(u, v, 2.5, 4, 0.6));
    const fine = 1 + 0.05 * n.noise(u, v, 120);
    const c = mix(base, stain, s * 0.55);
    return { c: [c[0] * fine, c[1] * fine, c[2] * fine], h: n.fbm(u, v, 40, 3) * 0.5 };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 1.6) };
}

/** Rubble masonry (irregular stones in mortar). Tile ≈ 2 m. */
export function masonry(seed: number): TextureSet {
  const size = 512;
  const vor = new TileVoronoi(7, seed);
  const n = new TileNoise(seed + 9);
  const mortar = hexRGB(0x9b968a);
  const baked = bake(size, (u, v) => {
    // Squash vertically so stones read as laid courses.
    const s = vor.sample(u, v);
    const edge = s.f2 - s.f1;
    const k = 0.75 + 0.35 * hash01(s.id);
    const tint = hash01(s.id * 7 + 3);
    const stone: RGB = [0.5 * k + 0.06 * tint, 0.47 * k + 0.03 * tint, 0.42 * k];
    const m = 1 - smoothstep(0.03, 0.09, edge);
    const grain = 1 + 0.08 * n.fbm(u, v, 30, 3);
    const c = mix(stone, mortar, m);
    return { c: [c[0] * grain, c[1] * grain, c[2] * grain], h: (1 - m) * (0.6 + 0.4 * Math.min(1, edge * 4)) + 0.15 * n.fbm(u, v, 40, 2) };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 6) };
}

/** Clay roof tiles in staggered courses. Tile ≈ 2 m (8 courses, 6 tiles each). */
export function roofTiles(seed: number): TextureSet {
  const size = 512;
  const n = new TileNoise(seed);
  const rows = 8;
  const cols = 6;
  const baked = bake(size, (u, v) => {
    const row = Math.floor(v * rows);
    const fv = v * rows - row;
    const shift = row % 2 === 0 ? 0 : 0.5;
    const cu = u * cols + shift;
    const col = Math.floor(cu);
    const fu = cu - col;
    const id = row * 31 + ((col % cols) + cols) % cols;
    const k = 0.8 + 0.3 * hash01(id);
    let c: RGB = [0.56 * k, 0.27 * k, 0.17 * k];
    // Moss and soot.
    c = mix(c, [0.3, 0.32, 0.2], smoothstep(0.25, 0.6, n.fbm(u, v, 3, 3)) * 0.45);
    const shadow = smoothstep(0.85, 1.0, fv);
    c = [c[0] * (1 - shadow * 0.55), c[1] * (1 - shadow * 0.55), c[2] * (1 - shadow * 0.55)];
    const barrel = Math.sin(Math.PI * fu) * 0.35;
    return { c, h: fv * 0.8 + barrel - shadow * 0.9 };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 5) };
}

/** Conifer bark: vertical furrows. Tile ≈ 1.5 m. */
export function bark(seed: number): TextureSet {
  const size = 256;
  const n = new TileNoise(seed);
  const baked = bake(size, (u, v) => {
    const f = n.fbm(u, v, 18, 4, 0.18);
    const k = 0.55 + 0.45 * (f * 0.5 + 0.5);
    return { c: [0.33 * k, 0.26 * k, 0.2 * k], h: f };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 5) };
}

/** Needle foliage. Tile ≈ 2 m. */
export function foliage(seed: number): TextureSet {
  const size = 256;
  const n = new TileNoise(seed);
  const baked = bake(size, (u, v) => {
    const f = n.fbm(u, v, 40, 3);
    const k = 0.55 + 0.6 * (f * 0.5 + 0.5);
    return { c: [0.16 * k, 0.26 * k, 0.12 * k], h: f };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 4) };
}

/** Ground detail multiplied over the terrain's vertex colours. Tile ≈ 4 m. */
export function groundDetail(seed: number): TextureSet {
  const size = 512;
  const n = new TileNoise(seed);
  const baked = bake(size, (u, v) => {
    const blades = n.fbm(u, v, 90, 3);
    const clumps = n.fbm(u, v, 12, 3);
    const k = 0.96 + 0.14 * blades + 0.08 * clumps;
    const warm = 0.04 * n.fbm(u + 0.4, v, 6, 2);
    return { c: [k * (1 + warm), k, k * (1 - warm)], h: blades * 0.6 + clumps * 0.4 };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 2.2) };
}

/** Plain wood grain. Tile ≈ 1 m. */
export function wood(seed: number): TextureSet {
  const size = 256;
  const n = new TileNoise(seed);
  const baked = bake(size, (u, v) => {
    const g = n.fbm(u, v, 3, 3, 12);
    const k = 0.7 + 0.3 * Math.sin((u * 30 + g * 4) * Math.PI) ** 2;
    return { c: [0.42 * k, 0.3 * k, 0.19 * k], h: k };
  });
  return { map: toTexture(size, baked.color, true), normalMap: normalMap(size, baked.height, 1.5) };
}
