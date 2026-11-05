/**
 * Loads and validates all JSON data at startup via Vite's eager glob import.
 * Adding a new vehicle or ammo type only requires dropping a JSON file into
 * the matching /data folder.
 */
import { parseAmmo, parseMap, parseVehicle, type AmmoDef, type MapDef, type VehicleDef } from './schema';

const vehicleFiles = import.meta.glob('../../data/vehicles/*.json', { eager: true, import: 'default' });
const ammoFiles = import.meta.glob('../../data/ammo/*.json', { eager: true, import: 'default' });
const mapFiles = import.meta.glob('../../data/maps/*.json', { eager: true, import: 'default' });

export interface GameData {
  vehicles: Map<string, VehicleDef>;
  ammo: Map<string, AmmoDef>;
  maps: Map<string, MapDef>;
}

function loadAll<T extends { id: string }>(
  files: Record<string, unknown>,
  parse: (json: unknown) => T,
  kind: string,
): Map<string, T> {
  const out = new Map<string, T>();
  for (const [path, json] of Object.entries(files)) {
    try {
      const def = parse(json);
      if (out.has(def.id)) throw new Error(`duplicate id "${def.id}"`);
      out.set(def.id, def);
    } catch (err) {
      throw new Error(`Invalid ${kind} data in ${path}: ${(err as Error).message}`);
    }
  }
  return out;
}

export function loadGameData(): GameData {
  const data: GameData = {
    vehicles: loadAll(vehicleFiles, parseVehicle, 'vehicle'),
    ammo: loadAll(ammoFiles, parseAmmo, 'ammo'),
    maps: loadAll(mapFiles, parseMap, 'map'),
  };
  // Cross-reference validation.
  for (const v of data.vehicles.values()) {
    for (const a of v.gun.ammo) {
      if (!data.ammo.has(a.id)) throw new Error(`Vehicle ${v.id} references unknown ammo "${a.id}"`);
    }
  }
  return data;
}
