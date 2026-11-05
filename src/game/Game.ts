import * as THREE from 'three';
import { PlayerAim, PlayerControls } from '../components/resources';
import { TrackedMobility } from '../components/TrackedMobility';
import { Turret } from '../components/Turret';
import { Gun } from '../components/Gun';
import { Effects } from '../render/effects/Effects';
import { ProjectileRenderer } from '../render/effects/ProjectileRenderer';
import { CombatPresenter } from './CombatPresenter';
import { PracticeRange } from './PracticeRange';
import { ControlIntent } from '../components/ControlIntent';
import { PhysicsBodyRef } from '../components/PhysicsBody';
import { distance } from '../core/math';
import { PlayerControlled, Vehicle } from '../components/Vehicle';
import { GameLoop } from '../core/GameLoop';
import { loadGameData, type GameData } from '../data/loader';
import type { Entity } from '../ecs/World';
import { InputDevice } from '../input/InputDevice';
import { initRapier, RapierWorld } from '../physics/RapierWorld';
import { CameraRig } from '../render/cameras/CameraRig';
import { createObstacleMeshes } from '../render/meshes/obstacleMeshes';
import { createTerrainMesh } from '../render/meshes/terrainMesh';
import { Renderer } from '../render/Renderer';
import { RenderSyncSystem } from '../render/RenderSyncSystem';
import { PlayerInputSystem } from '../systems/PlayerInputSystem';
import { Hud } from '../ui/Hud';
import { buildGameMap, type GameMap } from '../world/GameMap';
import { Simulation } from './Simulation';
import { spawnVehicle } from './vehicleFactory';
import { gunPoseWorld } from './vehicleGeometry';

export interface GameOptions {
  mapId: string;
  playerVehicleId: string;
}

/**
 * Composition root: wires data, simulation, rendering, input and HUD, and
 * drives them from the fixed-timestep loop.
 */
export class Game {
  readonly data: GameData;
  readonly map: GameMap;
  readonly sim: Simulation;
  readonly player: Entity;
  private readonly renderer: Renderer;
  private readonly renderSync: RenderSyncSystem;
  private readonly cameraRig: CameraRig;
  private readonly input: InputDevice;
  private readonly hud: Hud;
  private readonly loop: GameLoop;
  private readonly effects: Effects;
  private readonly projectileRenderer: ProjectileRenderer;
  private readonly presenter: CombatPresenter;
  private readonly range: PracticeRange;
  private fps = 60;
  private readonly tmpVec = new THREE.Vector3();

  static async create(container: HTMLElement, hudRoot: HTMLElement, opts: GameOptions): Promise<Game> {
    await initRapier();
    return new Game(container, hudRoot, opts);
  }

  private constructor(container: HTMLElement, hudRoot: HTMLElement, opts: GameOptions) {
    this.data = loadGameData();
    const mapDef = this.data.maps.get(opts.mapId);
    if (!mapDef) throw new Error(`Unknown map ${opts.mapId}`);
    this.map = buildGameMap(mapDef);
    this.sim = new Simulation(new RapierWorld(), this.map);
    const world = this.sim.world;

    // --- Rendering ---------------------------------------------------------
    this.renderer = new Renderer(container);
    this.renderer.scene.add(createTerrainMesh(this.map.height, mapDef.seed));
    this.renderer.scene.add(createObstacleMeshes(this.map.obstacles));
    this.renderSync = new RenderSyncSystem(this.renderer.scene);
    this.cameraRig = new CameraRig(this.renderer.camera);
    this.hud = new Hud(hudRoot);
    this.effects = new Effects(this.renderer.scene);
    this.projectileRenderer = new ProjectileRenderer(this.renderer.scene);

    // --- Input -------------------------------------------------------------
    this.input = new InputDevice(this.renderer.canvas);
    world.setResource(PlayerControls, { throttle: 0, steer: 0, fire: false, ammoSlot: 0 });
    world.setResource(PlayerAim, { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: -1 } });
    this.sim.addInputSystem(new PlayerInputSystem(this.sim.physics));

    // --- Entities ----------------------------------------------------------
    const def = this.data.vehicles.get(opts.playerVehicleId);
    if (!def) throw new Error(`Unknown vehicle ${opts.playerVehicleId}`);
    const [ax, az] = mapDef.spawns.teamA;
    const toCentre = Math.atan2(ax, az); // heading that faces the map centre
    this.player = spawnVehicle(world, this.sim.physics, this.map.height, {
      def,
      team: 'A',
      name: 'player',
      x: ax,
      z: az,
      heading: toCentre,
      ammo: this.data.ammo,
    });
    world.add(this.player, PlayerControlled, {});
    this.cameraRig.yaw = toCentre;

    this.hud.setPlayerVehicle(def);
    this.presenter = new CombatPresenter(this.sim, this.effects, this.hud, this.player);

    // Stationary practice target (respawns when destroyed) until AI arrives in M5.
    const target = this.findVisibleSpot(ax, az, toCentre);
    this.range = new PracticeRange(this.sim, def, this.data.ammo, { ...target, heading: toCentre + Math.PI / 2 + 0.4 });

    this.loop = new GameLoop({
      fixedUpdate: (dt, tick) => this.fixedUpdate(dt, tick),
      render: (alpha, frameDt) => this.render(alpha, frameDt),
    });
  }

  start(): void {
    this.loop.start();
  }

  private fixedUpdate(dt: number, tick: number): void {
    const c = this.sim.world.getResource(PlayerControls);
    const key = (code: string) => (this.input.isDown(code) ? 1 : 0);
    c.throttle = key('KeyW') - key('KeyS');
    c.steer = key('KeyD') - key('KeyA');
    c.fire = this.input.isButtonDown(0);
    const slots = this.sim.world.req(this.player, Gun).ammo.length;
    for (let i = 0; i < Math.min(slots, 9); i++) {
      if (this.input.isDown(`Digit${i + 1}`)) c.ammoSlot = i;
    }
    this.sim.fixedUpdate(dt, tick);
    this.range.update();
  }

  private render(alpha: number, frameDt: number): void {
    const world = this.sim.world;
    this.renderSync.sync(world, alpha);
    this.projectileRenderer.sync(world, alpha);
    this.presenter.update(Math.min(frameDt, 0.1));
    this.effects.update(Math.min(frameDt, 0.1));

    const pose = this.renderSync.pose(this.player);
    const def = world.req(this.player, Vehicle).def;
    if (pose) {
      const gp = gunPoseWorld(def, pose.pos, pose.rot, pose.turretYaw, pose.gunPitch);
      const turretRot = pose.rot.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.turretYaw));
      const mouse = this.input.consumeMouse();
      this.cameraRig.update(
        { dx: mouse.dx, dy: mouse.dy, wheel: mouse.wheel, sightHeld: this.input.isButtonDown(2) },
        { hullPos: pose.pos, hullRot: pose.rot, trunnion: new THREE.Vector3(gp.trunnion.x, gp.trunnion.y, gp.trunnion.z), turretRot },
        this.map.height,
      );
      const ray = this.cameraRig.aimRay();
      const aim = world.getResource(PlayerAim);
      aim.origin = { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z };
      aim.dir = { x: ray.dir.x, y: ray.dir.y, z: ray.dir.z };
      this.renderer.focusShadows(pose.pos);

      // Where the barrel actually points (may lag the crosshair).
      const physics = this.sim.physics; // read-only queries from the render pass
      const playerBody = world.req(this.player, PhysicsBodyRef).bodyId;
      const gunHit = physics.raycast(gp.muzzle, gp.dir, 2500);
      const gunPoint = gunHit ? gunHit.point : { x: gp.muzzle.x + gp.dir.x * 2500, y: gp.muzzle.y + gp.dir.y * 2500, z: gp.muzzle.z + gp.dir.z * 2500 };
      // "Blocked" = the aim ray hits a target but the barrel would hit
      // something well short of it (crest, wall, rock in front of the muzzle).
      const aimPoint = world.req(this.player, ControlIntent).aimPoint;
      const aimHit = physics.raycast(aim.origin, aim.dir, 2500, { excludeBody: playerBody });
      const muzzleToAim = aimPoint ? distance(gp.muzzle, aimPoint) : Infinity;
      // Thresholds are generous because at grazing angles a tiny elevation
      // difference moves the ground hit point by tens of metres.
      const blocked = !!aimHit && !!gunHit && gunHit.distance < muzzleToAim * 0.5 && gunHit.distance < muzzleToAim - 20;

      const mob = world.req(this.player, TrackedMobility);
      this.fps += (1 / Math.max(frameDt, 1e-3) - this.fps) * 0.05;
      this.hud.update({
        speedKmh: Math.abs(mob.forwardSpeed) * 3.6,
        turretYaw: world.req(this.player, Turret).yaw,
        sight: this.cameraRig.mode === 'sight',
        zoomX: 60 / this.cameraRig.sight.fov,
        gunScreen: this.project(gunPoint),
        gunBlocked: blocked,
        pointerLocked: this.input.locked,
        fps: this.fps,
        weapon: this.weaponFrame(),
        modules: this.presenter.playerModules(world),
      });
    }

    this.renderer.render();
    this.input.endFrame();
  }

  private weaponFrame() {
    const gun = this.sim.world.req(this.player, Gun);
    const loaded = gun.loadedSlot !== null;
    return {
      slots: gun.ammo.map((a, i) => ({ key: String(i + 1), name: a.def.displayName, type: a.def.type, count: a.count })),
      loadedSlot: gun.loadedSlot,
      loadingSlot: gun.loadingSlot,
      reloadProgress: loaded ? 1 : 1 - gun.reloadRemaining / Math.max(gun.reloadDuration, 1e-6),
      reloadRemaining: gun.reloadRemaining,
    };
  }

  private project(p: { x: number; y: number; z: number }): { x: number; y: number } | null {
    const v = this.tmpVec.set(p.x, p.y, p.z).project(this.renderer.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  /** A clear spot 150–400 m ahead of the spawn with line of sight from it. */
  private findVisibleSpot(x: number, z: number, heading: number): { x: number; z: number } {
    const hm = this.map.height;
    const eye = { x, y: hm.sample(x, z) + 3, z };
    for (let d = 150; d <= 400; d += 25) {
      for (const off of [0, -0.15, 0.15, -0.3, 0.3]) {
        const a = heading + off;
        const px = x - Math.sin(a) * d;
        const pz = z - Math.cos(a) * d;
        if (!this.map.obstacles.every((o) => Math.hypot(o.position.x - px, o.position.z - pz) > o.radius + 10)) continue;
        if (hm.slope(px, pz) > 0.25) continue;
        const to = { x: px - eye.x, y: hm.sample(px, pz) + 1.5 - eye.y, z: pz - eye.z };
        const len = Math.hypot(to.x, to.y, to.z);
        const hit = this.sim.physics.raycast(eye, { x: to.x / len, y: to.y / len, z: to.z / len }, len);
        if (!hit || hit.distance > len - 2) return { x: px, z: pz };
      }
    }
    return this.findClearSpot(x - Math.sin(heading) * 140, z - Math.cos(heading) * 140, 10);
  }

  private findClearSpot(x: number, z: number, clearance: number): { x: number; z: number } {
    for (let r = 0; r < 200; r += 6) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const ok = this.map.obstacles.every((o) => Math.hypot(o.position.x - px, o.position.z - pz) > o.radius + clearance);
        if (ok) return { x: px, z: pz };
        if (r === 0) break;
      }
    }
    return { x, z };
  }
}
