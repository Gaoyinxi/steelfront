import type { MapDef } from '../data/schema';
import { generateCoverPoints, type CoverPoint } from './coverPoints';
import type { HeightMap } from './HeightMap';
import { generateObstacles, type Obstacle } from './obstacles';
import { generateTerrain } from './terrainGen';

/** Fully generated, immutable map description shared by all subsystems. */
export interface GameMap {
  def: MapDef;
  height: HeightMap;
  obstacles: Obstacle[];
  cover: CoverPoint[];
}

export function buildGameMap(def: MapDef): GameMap {
  const height = generateTerrain(def);
  const obstacles = generateObstacles(def, height);
  const cover = generateCoverPoints(obstacles, height);
  return { def, height, obstacles, cover };
}
