import * as THREE from 'three';
import type { TeamId } from '../../components/Vehicle';
import * as T from '../textures/proceduralTextures';

/** Material keys used by the vehicle and scenery builders. */
export type MaterialKey =
  | 'paint'
  | 'paintCast'
  | 'gunSteel'
  | 'darkSteel'
  | 'trackSteel'
  | 'rubber'
  | 'glass'
  | 'lamp'
  | 'wood'
  | 'canvas'
  | 'bore'
  | 'plaster'
  | 'masonry'
  | 'roof'
  | 'rock'
  | 'bark'
  | 'foliage'
  | 'windowGlass'
  | 'frameWood'
  | 'ground';

/** Camouflage schemes: base coat + two disruptive colours (original palettes). */
const CAMO: Record<TeamId, [number, number, number]> = {
  A: [0x4f5a34, 0x2f3a24, 0x5e4b33], // olive base, dark green and earth brown
  B: [0xa89466, 0x5f6a3e, 0x6e523a], // sand base, green and red-brown bands
};

/** Metres covered by one texture repeat; stored on `material.userData.tile`. */
const TILE: Partial<Record<MaterialKey, number>> = {
  paint: 3,
  paintCast: 3,
  trackSteel: 1,
  wood: 1,
  plaster: 3,
  masonry: 2,
  roof: 2,
  rock: 2,
  bark: 1.5,
  foliage: 2,
  frameWood: 1,
  ground: 4,
};

/**
 * Physically based materials with procedurally generated textures, created
 * once and shared by all meshes. Vertex colours carry baked grime / mud.
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();
  private readonly burntCache = new Map<THREE.Material, THREE.Material>();
  private readonly textures = new Map<string, T.TextureSet | THREE.Texture>();

  constructor(private readonly anisotropy = 8) {}

  get(key: MaterialKey, team: TeamId = 'A'): THREE.MeshStandardMaterial {
    const id = key === 'paint' || key === 'paintCast' ? `${key}:${team}` : key;
    let m = this.cache.get(id);
    if (!m) {
      m = this.create(key, team);
      m.name = id;
      m.userData.tile = TILE[key] ?? 1;
      for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.anisotropy = this.anisotropy;
      this.cache.set(id, m);
    }
    return m;
  }

  /** Burnt-out counterpart of a material (soot-black, matte), shared per source material. */
  burnt(source: THREE.Material): THREE.Material {
    let b = this.burntCache.get(source);
    if (!b) {
      const s = source as THREE.MeshStandardMaterial;
      b = new THREE.MeshStandardMaterial({
        color: 0x242120,
        roughness: 1,
        metalness: 0.2,
        normalMap: s.normalMap ?? null,
        normalScale: s.normalScale?.clone() ?? new THREE.Vector2(1, 1),
        map: s.map ?? null,
        vertexColors: s.vertexColors ?? false,
      });
      // Keep a hint of the original pattern under the soot.
      (b as THREE.MeshStandardMaterial).color.setRGB(0.16, 0.15, 0.14);
      b.userData.tile = s.userData?.tile ?? 1;
      this.burntCache.set(source, b);
    }
    return b;
  }

  private tex<K extends T.TextureSet | THREE.Texture>(id: string, make: () => K): K {
    let t = this.textures.get(id) as K | undefined;
    if (!t) {
      t = make();
      this.textures.set(id, t);
    }
    return t;
  }

  private create(key: MaterialKey, team: TeamId): THREE.MeshStandardMaterial {
    const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
    switch (key) {
      case 'paint':
      case 'paintCast': {
        const camo = this.tex(`camo:${team}`, () => T.camouflage(CAMO[team], team === 'A' ? 101 : 202));
        const normal =
          key === 'paint'
            ? this.tex('rolledSteel', () => T.rolledSteelNormal(7))
            : this.tex('castSteel', () => T.castSteelNormal(8));
        return std({
          map: camo.map,
          roughnessMap: camo.roughnessMap,
          normalMap: normal,
          normalScale: new THREE.Vector2(key === 'paint' ? 0.12 : 0.3, key === 'paint' ? 0.12 : 0.3),
          roughness: 1,
          metalness: 0.18,
          vertexColors: true,
        });
      }
      case 'gunSteel':
        return std({ color: 0x3c3d39, roughness: 0.42, metalness: 0.75, vertexColors: true });
      case 'darkSteel':
        return std({ color: 0x302d2a, roughness: 0.68, metalness: 0.55, vertexColors: true });
      case 'trackSteel': {
        const t = this.tex('track', () => T.trackSteel(11));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.82, metalness: 0.5, vertexColors: true });
      }
      case 'rubber':
        return std({ color: 0x1b1a19, roughness: 0.93, metalness: 0, vertexColors: true });
      case 'glass':
        return std({ color: 0x1a2a30, roughness: 0.08, metalness: 0.9, vertexColors: true });
      case 'lamp':
        return std({ color: 0xcdbf98, roughness: 0.15, metalness: 0.3, emissive: 0x2a2416, vertexColors: true });
      case 'wood': {
        const t = this.tex('wood', () => T.wood(13));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.85, metalness: 0, vertexColors: true });
      }
      case 'canvas':
        return std({ color: 0x5f5a45, roughness: 0.97, metalness: 0, vertexColors: true });
      case 'bore':
        return std({ color: 0x050505, roughness: 1, metalness: 0, vertexColors: true });
      case 'plaster': {
        const t = this.tex('plaster', () => T.plaster(21));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.93, metalness: 0, vertexColors: true });
      }
      case 'masonry': {
        const t = this.tex('masonry', () => T.masonry(22));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.92, metalness: 0, vertexColors: true });
      }
      case 'roof': {
        const t = this.tex('roof', () => T.roofTiles(23));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.82, metalness: 0, vertexColors: true });
      }
      case 'rock': {
        const t = this.tex('rock', () => T.rock(24));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.9, metalness: 0, vertexColors: true });
      }
      case 'bark': {
        const t = this.tex('bark', () => T.bark(25));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.95, metalness: 0, vertexColors: true });
      }
      case 'foliage': {
        const t = this.tex('foliage', () => T.foliage(26));
        return std({ map: t.map, normalMap: t.normalMap, roughness: 0.88, metalness: 0, vertexColors: true });
      }
      case 'windowGlass':
        return std({ color: 0x1d2428, roughness: 0.12, metalness: 0.8, vertexColors: true });
      case 'frameWood':
        return std({ color: 0x6b5a45, roughness: 0.8, metalness: 0, vertexColors: true });
      case 'ground': {
        const t = this.tex('ground', () => T.groundDetail(27));
        return std({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.96, metalness: 0, vertexColors: true });
      }
    }
  }
}
