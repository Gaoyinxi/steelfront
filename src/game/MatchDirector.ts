import { AIBrain, makeBrain } from '../components/AIBrain';
import { VehicleStatus } from '../components/Modules';
import type { Vec3 } from '../core/math';
import type { GameData } from '../data/loader';
import type { MapDef } from '../data/schema';
import type { Entity } from '../ecs/World';
import type { Simulation } from './Simulation';
import { spawnVehicle } from './vehicleFactory';

export type MatchResult = 'victory' | 'defeat';

/**
 * Sets up the engagement described by the map's `match` block — an enemy AI
 * platoon with patrol routes fanning out towards the player's side — and
 * decides the outcome. Simulation-side; no rendering or DOM.
 */
export class MatchDirector {
  readonly enemies: Entity[] = [];
  private result: MatchResult | null = null;

  constructor(
    private readonly sim: Simulation,
    data: GameData,
    private readonly mapDef: MapDef,
    private readonly player: Entity,
  ) {
    const m = mapDef.match;
    const def = data.vehicles.get(m.enemyVehicle);
    const skill = data.aiSkills.get(m.aiSkill);
    if (!def || !skill) throw new Error(`Map ${mapDef.id}: invalid match configuration`);
    const [bx, bz] = mapDef.spawns.teamB;
    const spread = Math.min(30, mapDef.spawns.clearRadius * 0.75);
    for (let i = 0; i < m.enemyCount; i++) {
      const lane = m.enemyCount === 1 ? 0 : -1 + (2 * i) / (m.enemyCount - 1);
      const x = bx + lane * spread;
      const e = spawnVehicle(sim.world, sim.physics, sim.map.height, {
        def,
        team: 'B',
        name: `enemy-${i + 1}`,
        x,
        z: bz,
        heading: Math.atan2(x, bz), // facing the map centre
        ammo: data.ammo,
      });
      sim.world.add(e, AIBrain, makeBrain(skill, this.route(lane, x, bz)));
      this.enemies.push(e);
    }
  }

  get total(): number {
    return this.enemies.length;
  }

  get remaining(): number {
    return this.enemies.filter((e) => !this.isOut(e)).length;
  }

  get outcome(): MatchResult | null {
    return this.result;
  }

  /** Call once per tick. Emits `matchEnded` the first time the outcome is decided. */
  update(): void {
    if (this.result) return;
    if (this.isOut(this.player)) this.result = 'defeat';
    else if (this.enemies.length > 0 && this.enemies.every((e) => this.isOut(e))) this.result = 'victory';
    if (this.result) this.sim.events.emit('matchEnded', { result: this.result });
  }

  private isOut(e: Entity): boolean {
    return !this.sim.world.isAlive(e) || !!this.sim.world.get(e, VehicleStatus)?.destroyed;
  }

  /**
   * Patrol route from the spawn towards the opposing spawn. Lanes fan out
   * across the middle of the map and converge again near the far side.
   */
  private route(lane: number, x0: number, z0: number): Vec3[] {
    const [ax, az] = this.mapDef.spawns.teamA;
    const rng = this.sim.rng;
    const nav = this.sim.ai.nav;
    const points: Vec3[] = [{ x: x0, y: this.sim.map.height.sample(x0, z0), z: z0 }];
    for (const t of [0.3, 0.55, 0.8]) {
      const x = x0 + (ax - x0) * t + lane * 170 * Math.sin(Math.PI * t) + rng.range(-40, 40);
      const z = z0 + (az - z0) * t + rng.range(-25, 25);
      const cell = nav.nearestFree(x, z, 15);
      if (cell) points.push(nav.centre(cell[0], cell[1]));
    }
    return points;
  }
}
