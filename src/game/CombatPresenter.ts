import { DAMAGED_THRESHOLD, Modules, VehicleStatus } from '../components/Modules';
import { Transform } from '../components/Transform';
import type { Entity, World } from '../ecs/World';
import { Layer } from '../physics/PhysicsWorld';
import type { Effects } from '../render/effects/Effects';
import type { Hud } from '../ui/Hud';
import { CAUSE_LABEL, FACE_LABEL, moduleLabel, PART_LABEL } from '../ui/labels';
import type { ModuleCondition } from '../ui/ModulePanel';
import type { Simulation } from './Simulation';
import type { GameEvents } from './events';

const WRECK_SMOKE_INTERVAL = 0.35;
const WRECK_SMOKE_DURATION = 40;

/**
 * Presentation of combat events: VFX for shots and impacts, HUD hit
 * feedback (击穿 / 未击穿 / 跳弹 / 击毁), wreck smoke and the module panel.
 * Simulation events are queued during fixed steps and drained once per frame.
 */
export class CombatPresenter {
  private readonly shots: GameEvents['shotFired'][] = [];
  private readonly impacts: GameEvents['projectileImpact'][] = [];
  private readonly hits: GameEvents['hitResolved'][] = [];
  private readonly kills: GameEvents['vehicleDestroyed'][] = [];
  private smokeTimer = 0;

  constructor(
    private readonly sim: Simulation,
    private readonly effects: Effects,
    private readonly hud: Hud,
    private readonly player: Entity,
  ) {
    sim.events.on('shotFired', (e) => this.shots.push(e));
    sim.events.on('projectileImpact', (e) => this.impacts.push(e));
    sim.events.on('hitResolved', (e) => this.hits.push(e));
    sim.events.on('vehicleDestroyed', (e) => this.kills.push(e));
  }

  update(frameDt: number): void {
    const world = this.sim.world;
    for (const ev of this.shots) this.effects.muzzleFlash(ev.muzzle, ev.dir);
    for (const ev of this.impacts) {
      if (ev.ammo.explosiveMassKg > 0) this.effects.explosion(ev.point, ev.ammo.explosiveMassKg);
      else if (ev.layer === Layer.Vehicle) this.effects.sparks(ev.point, ev.normal);
      else this.effects.dustImpact(ev.point, ev.normal);
    }
    for (const h of this.hits) this.showHit(h);
    for (const k of this.kills) {
      const pos = world.get(k.entity, Transform)?.pos;
      if (pos && k.cause === 'ammoDetonation') this.effects.explosion({ x: pos.x, y: pos.y + 1, z: pos.z }, 12);
      if (k.killer === this.player && k.entity !== this.player) this.hud.showHit('击毁', 'kill', CAUSE_LABEL[k.cause]);
      if (k.entity === this.player) this.hud.showHit('本车被击毁', 'nonPenetration', CAUSE_LABEL[k.cause]);
    }
    this.shots.length = this.impacts.length = this.hits.length = this.kills.length = 0;

    // Burning wrecks.
    this.smokeTimer += frameDt;
    if (this.smokeTimer >= WRECK_SMOKE_INTERVAL) {
      this.smokeTimer = 0;
      for (const e of world.query(VehicleStatus, Transform)) {
        const s = world.req(e, VehicleStatus);
        if (s.destroyed && s.destroyedFor < WRECK_SMOKE_DURATION) this.effects.wreckSmoke(world.req(e, Transform).pos);
      }
    }
  }

  /** Module conditions and a status line for the player's module panel. */
  playerModules(world: World): { conditions: ModuleCondition[]; status: string } {
    const states = world.req(this.player, Modules).states;
    const status = world.req(this.player, VehicleStatus);
    return {
      conditions: states.map((s) => (s.destroyed ? 'destroyed' : s.hp < s.maxHp * DAMAGED_THRESHOLD ? 'damaged' : 'ok')),
      status: status.destroyed ? `已被击毁 · ${CAUSE_LABEL[status.cause!]}` : '',
    };
  }

  private showHit(h: GameEvents['hitResolved']): void {
    const where = `${PART_LABEL[h.part]}${FACE_LABEL[h.face]} ${h.thicknessMm} mm`;
    const numbers = `穿深 ${Math.round(h.penetrationMm)} / 等效 ${Math.round(h.effectiveMm)} mm · 入射角 ${Math.round(h.angleDeg)}°`;
    const modules = h.modules
      .filter((m) => m.destroyed)
      .map((m) => (m.type === 'crew' ? `${moduleLabel(m.type, m.role)}阵亡` : `${moduleLabel(m.type)}损毁`));
    const damaged = h.modules.filter((m) => !m.destroyed).map((m) => moduleLabel(m.type, m.role));
    const effects = [...modules, ...(damaged.length ? [`${damaged.join('、')}受损`] : [])].join('，');

    const outgoing = h.shooter === this.player;
    const incoming = h.target === this.player;
    if (!outgoing && !incoming) return;
    const prefix = incoming ? '被' : '';
    switch (h.result) {
      case 'penetration':
        this.hud.showHit(`${prefix}击穿`, incoming ? 'nonPenetration' : 'penetration', `${where}${effects ? ' · ' + effects : ''}`);
        break;
      case 'nonPenetration':
        this.hud.showHit(incoming ? '装甲挡住了炮弹' : '未击穿', incoming ? 'penetration' : 'nonPenetration', `${where} · ${numbers}`);
        break;
      case 'ricochet':
        this.hud.showHit(incoming ? '炮弹被弹开' : '跳弹', 'ricochet', `${where} · 入射角 ${Math.round(h.angleDeg)}°`);
        break;
    }
  }
}
