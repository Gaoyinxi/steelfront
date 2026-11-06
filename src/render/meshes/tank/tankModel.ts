/**
 * Detailed procedural tank model. The hull and turret bodies are meshed
 * directly from the armour model's planes (combat/armorModel.ts), so the
 * silhouette the player aims at is exactly the shape shells are tested
 * against. Everything else is non-ballistic detail.
 *
 * Hierarchy mirrors the simulation: root (hull frame) -> turret (yaw) -> gun (pitch).
 */
import * as THREE from 'three';
import type { TeamId } from '../../../components/Vehicle';
import type { VehicleDef } from '../../../data/schema';
import { armorModelFor, hullArmorHalf, turretCentreLocal } from '../../../combat/armorModel';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import { convexPolyhedronGeometry, mat, PartBuilder } from '../geometryUtils';
import {
  gearLayout,
  idlerWheel,
  linkGeometry,
  placeLinks,
  returnRoller,
  roadWheel,
  sprocketWheel,
  trackLoop,
  type GearLayout,
} from './runningGear';

const DEG = Math.PI / 180;

export interface TankView {
  readonly root: THREE.Group;
  readonly turret: THREE.Group;
  readonly gun: THREE.Group;
  /**
   * Per-frame running-gear animation.
   * @param compression [side][wheel] spring compression (m)
   * @param trackSpeed  [left, right] track speed relative to the ground (m/s, + forward)
   */
  animate(compression: readonly (readonly number[])[], trackSpeed: readonly [number, number], dt: number): void;
  /** Swaps every material for its burnt-out counterpart. */
  setWrecked(): void;
}

const cylX = (r: number, len: number, seg = 16) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2);
const cylZ = (r: number, len: number, seg = 16) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
const cylY = (r: number, len: number, seg = 16) => new THREE.CylinderGeometry(r, r, len, seg);
const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
const ring = (r: number, tube: number) => new THREE.TorusGeometry(r, tube, 6, 14);

export function createTankModel(def: VehicleDef, team: TeamId, lib: MaterialLibrary): TankView {
  const root = new THREE.Group();
  const layout = gearLayout(def);
  root.add(buildHull(def, team, lib, layout));

  // --- Running gear ----------------------------------------------------------
  const wheelProto = roadWheel(layout, lib, team);
  const sprocketProto = sprocketWheel(layout.sprocket, lib, team);
  const idlerProto = idlerWheel(layout.idler, lib);
  const rollerProto = returnRoller(layout.rollers[0], lib);
  const armProto = new PartBuilder(() => 0.4)
    .add(lib.get('darkSteel'), box(0.09, 0.09, 0.5), mat(0, 0.2, 0.17, -0.85))
    .add(lib.get('darkSteel'), cylX(0.09, 0.2, 12), mat(0, 0.36, 0.33))
    .build('arm');

  const wheels: THREE.Group[][] = [[], []];
  const spinners: { obj: THREE.Object3D; side: number; r: number; dir: number }[] = [];
  const links: THREE.InstancedMesh[] = [];
  const linkGeo = linkGeometry(layout, lib);
  const restLoop = trackLoop(layout, layout.wheelZ.map(() => layout.wheelBaseY));
  const linkCount = Math.round(restLoop.length / layout.linkPitch);

  for (let side = 0; side < 2; side++) {
    const x = layout.sideX[side];
    const inward = side === 0 ? 1 : -1;
    for (const z of layout.wheelZ) {
      const g = new THREE.Group();
      g.position.set(x, layout.wheelBaseY, z);
      const spin = wheelProto.clone();
      g.add(spin);
      const arm = armProto.clone();
      arm.position.x = inward * 0.2;
      g.add(arm);
      root.add(g);
      wheels[side].push(g);
      spinners.push({ obj: spin, side, r: layout.wheelRadius, dir: -1 });
    }
    const sp = sprocketProto.clone();
    sp.position.set(x, layout.sprocket.y, layout.sprocket.z);
    root.add(sp);
    spinners.push({ obj: sp, side, r: layout.sprocket.r, dir: -1 });
    const id = idlerProto.clone();
    id.position.set(x, layout.idler.y, layout.idler.z);
    root.add(id);
    spinners.push({ obj: id, side, r: layout.idler.r, dir: -1 });
    for (const c of layout.rollers) {
      const ro = rollerProto.clone();
      ro.position.set(x, c.y, c.z);
      root.add(ro);
      // The top run moves forwards over the rollers: they turn the other way.
      spinners.push({ obj: ro, side, r: c.r, dir: 1 });
    }
    const im = new THREE.InstancedMesh(linkGeo, lib.get('trackSteel'), linkCount);
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    root.add(im);
    links.push(im);
  }

  // --- Turret and gun ----------------------------------------------------------
  const turret = new THREE.Group();
  turret.position.set(def.turret.offset.x, def.turret.offset.y, def.turret.offset.z);
  turret.add(buildTurret(def, team, lib));
  root.add(turret);
  const gun = new THREE.Group();
  gun.position.set(def.gun.offset.x, def.gun.offset.y, def.gun.offset.z);
  gun.add(buildGun(def, team, lib));
  turret.add(gun);

  // --- Animation state --------------------------------------------------------
  const travel: [number, number] = [0, 0];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const wheelY: number[][] = [layout.wheelZ.map(() => layout.wheelBaseY), layout.wheelZ.map(() => layout.wheelBaseY)];

  const view: TankView = {
    root,
    turret,
    gun,
    animate(compression, trackSpeed, dt) {
      for (let side = 0; side < 2; side++) {
        travel[side] += trackSpeed[side] * dt;
        wheels[side].forEach((g, i) => {
          const y = layout.wheelBaseY + (compression[side]?.[i] ?? 0);
          g.position.y = y;
          wheelY[side][i] = y;
        });
        const loop = trackLoop(layout, wheelY[side]);
        const x = layout.sideX[side];
        placeLinks(loop, linkCount, travel[side], (i, z, y, angle) => {
          q.setFromEuler(e.set(-angle, 0, 0));
          m.compose(p.set(x, y, z), q, one);
          links[side].setMatrixAt(i, m);
        });
        links[side].instanceMatrix.needsUpdate = true;
      }
      for (const s of spinners) s.obj.rotation.x = (s.dir * travel[s.side]) / s.r;
    },
    setWrecked() {
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = lib.burnt(mesh.material as THREE.Material);
      });
    },
  };
  view.animate(
    [wheelY[0].map(() => 0), wheelY[1].map(() => 0)],
    [0, 0],
    0,
  );
  return view;
}

// -----------------------------------------------------------------------------
// Hull
// -----------------------------------------------------------------------------

function buildHull(def: VehicleDef, team: TeamId, lib: MaterialLibrary, layout: GearLayout): THREE.Group {
  const h = hullArmorHalf(def);
  const front = def.armor.hull.front.slopeDeg * DEG;
  const rear = def.armor.hull.rear.slopeDeg * DEG;
  // Mud and dust: heavy at the bottom, fading out a little above the fenders.
  const b = new PartBuilder((_x, y) => Math.pow(Math.max(0, (0.1 - y) / 0.8), 1.3) * 0.75);
  const paint = lib.get('paint', team);
  const dark = lib.get('darkSteel');

  // Armoured body straight from the armour planes.
  b.add(paint, convexPolyhedronGeometry(armorModelFor(def).hull.planes));

  // Placement helpers on the sloped plates.
  const glacisZ = (y: number) => -h.z + (y + h.y) * Math.tan(front);
  const onGlacis = (x: number, y: number, lift = 0) =>
    mat(x, y + lift * Math.sin(front), glacisZ(y) - lift * Math.cos(front), -(Math.PI / 2 - front));
  const rearZ = (y: number) => h.z - (y + h.y) * Math.tan(rear);
  const roof = h.y;

  // Fenders and mudguards over both tracks.
  const fx = Math.abs(layout.sideX[1]);
  const fw = layout.trackWidth + 0.1;
  const fy = layout.sprocket.y + layout.sprocket.r + 0.16;
  const fLen = layout.idler.z - layout.sprocket.z + 0.2;
  const fMid = (layout.idler.z + layout.sprocket.z) / 2 + 0.05;
  for (const s of [-1, 1]) {
    b.add(paint, box(fw, 0.03, fLen), mat(s * fx, fy, fMid));
    b.add(paint, box(fw, 0.03, 0.45), mat(s * fx, fy - 0.11, fMid - fLen / 2 - 0.2, -30 * DEG));
    b.add(paint, box(fw, 0.03, 0.3), mat(s * fx, fy - 0.04, fMid + fLen / 2 + 0.14, 15 * DEG));
    for (const z of [-1.6, 0, 1.6]) b.add(dark, box(0.04, 0.14, 0.04), mat(s * (h.x + 0.12), fy - 0.08, z));
    // Tow cable along the hull side, with clamps.
    b.add(dark, cylZ(0.022, 4.2, 8), mat(s * (h.x + 0.025), 0.42, 0));
    for (const z of [-1.8, -0.6, 0.6, 1.8]) b.add(dark, box(0.05, 0.07, 0.05), mat(s * (h.x + 0.02), 0.42, z));
  }

  // Right fender: tool box and fuel cans.  Left fender: shovel, pick, crowbar.
  const fTop = fy + 0.015;
  b.add(paint, box(0.42, 0.3, 0.9), mat(fx, fTop + 0.15, 1.0));
  b.add(dark, box(0.44, 0.025, 0.92), mat(fx, fTop + 0.3, 1.0));
  for (const z of [0.7, 1.3]) b.add(dark, box(0.05, 0.08, 0.03), mat(fx + 0.22, fTop + 0.2, z));
  for (const z of [1.85, 2.18]) {
    b.add(paint, box(0.17, 0.34, 0.27), mat(fx, fTop + 0.17, z));
    b.add(dark, box(0.08, 0.04, 0.03), mat(fx, fTop + 0.36, z));
  }
  b.add(lib.get('wood'), cylZ(0.02, 1.1, 8), mat(-fx - 0.08, fTop + 0.03, -0.75));
  b.add(dark, box(0.2, 0.015, 0.27), mat(-fx - 0.08, fTop + 0.02, -1.42));
  b.add(lib.get('wood'), cylZ(0.022, 0.9, 8), mat(-fx + 0.1, fTop + 0.03, 0.4));
  b.add(dark, box(0.42, 0.04, 0.05), mat(-fx + 0.1, fTop + 0.04, 0.82));
  b.add(dark, cylZ(0.016, 1.4, 6), mat(-fx - 0.15, fTop + 0.02, 1.5));

  // Glacis: driver's and co-driver's hatches, vision block, spare links, bolts.
  for (const s of [-1, 1]) {
    b.add(paint, cylY(0.29, 0.06, 20), onGlacis(s * 0.6, 0.12, 0.03));
    b.add(dark, box(0.1, 0.04, 0.12), onGlacis(s * 0.6, 0.38, 0.05));
    b.add(dark, ring(0.06, 0.012), onGlacis(s * 0.6, 0.05, 0.08).multiply(mat(0, 0, 0, Math.PI / 2)));
  }
  b.add(dark, box(0.46, 0.13, 0.12), onGlacis(-0.6, 0.5, 0.06));
  b.add(lib.get('glass'), box(0.32, 0.035, 0.02), onGlacis(-0.6, 0.5, 0.13));
  const spare = linkGeometry(layout, lib);
  for (const x of [-0.69, -0.23, 0.23, 0.69]) b.add(lib.get('trackSteel'), spare, onGlacis(x, -0.32, 0.05));
  b.add(dark, box(1.9, 0.04, 0.04), onGlacis(0, -0.2, 0.08));
  for (let i = 0; i < 17; i++) b.add(dark, cylY(0.022, 0.03, 6), onGlacis(-1.12 + i * 0.14, -0.52, 0.01));
  // Headlights with brush guards, front tow shackles.
  for (const s of [-1, 1]) {
    const y = 0.36;
    b.add(dark, cylZ(0.085, 0.14, 14), mat(s * 1.0, y, glacisZ(y) - 0.08));
    b.add(lib.get('lamp'), cylZ(0.07, 0.02, 14), mat(s * 1.0, y, glacisZ(y) - 0.16));
    b.add(dark, ring(0.1, 0.01), mat(s * 1.0, y, glacisZ(y) - 0.2));
    b.add(dark, ring(0.075, 0.022), mat(s * 0.8, -0.45, glacisZ(-0.45) - 0.07, 0, Math.PI / 2));
  }

  // Engine deck: louvred grilles, access hatches, filler caps, tarpaulin.
  for (const s of [-1, 1]) {
    b.add(dark, box(0.74, 0.03, 0.95), mat(s * 0.45, roof + 0.015, 1.55));
    for (let i = 0; i < 9; i++) b.add(dark, box(0.7, 0.045, 0.035), mat(s * 0.45, roof + 0.04, 1.14 + i * 0.1, 0.5));
    b.add(paint, box(0.7, 0.035, 0.5), mat(s * 0.45, roof + 0.017, 2.32));
    b.add(dark, ring(0.05, 0.01), mat(s * 0.45, roof + 0.05, 2.38, Math.PI / 2));
    b.add(dark, cylY(0.06, 0.04, 12), mat(s * 1.05, roof + 0.02, 1.2));
    b.add(dark, ring(0.06, 0.015), mat(s * 1.05, roof + 0.03, -0.75, Math.PI / 2)); // lifting eyes
  }
  b.add(lib.get('canvas'), cylX(0.13, 1.7, 14), mat(0, roof + 0.13, 2.58));
  for (const x of [-0.55, 0.55]) b.add(dark, cylX(0.135, 0.04, 14), mat(x, roof + 0.13, 2.58));

  // Rear plate: exhaust mufflers, tail lights, tow hooks, access plate.
  const onRear = (x: number, y: number, lift = 0) =>
    mat(x, y + lift * Math.sin(rear), rearZ(y) + lift * Math.cos(rear), Math.PI / 2 - rear);
  for (const s of [-1, 1]) {
    b.add(dark, cylX(0.13, 0.6, 18), mat(s * 0.62, 0.08, rearZ(0.08) + 0.17));
    b.add(dark, cylX(0.14, 0.03, 18), mat(s * 0.62 + s * 0.3, 0.08, rearZ(0.08) + 0.17));
    b.add(dark, cylY(0.04, 0.3, 8), mat(s * 0.35, -0.05, rearZ(0.08) + 0.24, 0.5));
    b.add(lib.get('lamp'), box(0.12, 0.08, 0.03), onRear(s * 1.0, 0.45, 0.03));
    b.add(dark, ring(0.07, 0.022), onRear(s * 0.75, -0.5, 0.08));
  }
  b.add(paint, box(1.3, 0.035, 0.55), onRear(0, -0.25, 0.02));

  return b.build('hull');
}

// -----------------------------------------------------------------------------
// Turret
// -----------------------------------------------------------------------------

function buildTurret(def: VehicleDef, team: TeamId, lib: MaterialLibrary): THREE.Group {
  const c = turretCentreLocal(def);
  const t = def.turret.half;
  const b = new PartBuilder((_x, y) => Math.max(0, (c.y - y) / (2 * t.y)) * 0.3);
  const cast = lib.get('paintCast', team);
  const paint = lib.get('paint', team);
  const dark = lib.get('darkSteel');
  const glass = lib.get('glass');
  const roof = c.y + t.y;

  b.add(cast, convexPolyhedronGeometry(armorModelFor(def).turret.planes), mat(c.x, c.y, c.z));

  // Commander's cupola with vision blocks and hatch.
  const cx = -t.x * 0.42;
  const cz = t.z * 0.3;
  b.add(cast, cylY(0.37, 0.24, 24), mat(cx, roof + 0.12, cz));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const ox = Math.sin(a) * 0.37;
    const oz = Math.cos(a) * 0.37;
    b.add(glass, box(0.14, 0.07, 0.03), mat(cx + ox, roof + 0.14, cz + oz, 0, a));
    b.add(cast, box(0.18, 0.04, 0.08), mat(cx + ox * 1.05, roof + 0.2, cz + oz * 1.05, 0, a));
  }
  b.add(paint, cylY(0.31, 0.05, 22), mat(cx, roof + 0.27, cz));
  b.add(dark, box(0.12, 0.06, 0.08), mat(cx, roof + 0.27, cz + 0.33));

  // Loader's hatch and periscopes, gunner's periscope, ventilator.
  b.add(paint, box(0.55, 0.05, 0.62), mat(t.x * 0.45, roof + 0.025, t.z * 0.12));
  b.add(dark, ring(0.06, 0.012), mat(t.x * 0.45, roof + 0.06, t.z * 0.12, Math.PI / 2));
  for (const [x, z] of [
    [t.x * 0.5, -t.z * 0.35],
    [-t.x * 0.5, -t.z * 0.7],
  ]) {
    b.add(dark, box(0.17, 0.14, 0.22), mat(x, roof + 0.07, z));
    b.add(glass, box(0.13, 0.05, 0.02), mat(x, roof + 0.09, z - 0.115));
  }
  b.add(cast, new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0.05, roof, t.z * 0.62));

  // Lifting hooks, grab rails, pistol ports, smoke dischargers.
  for (const s of [-1, 1]) {
    for (const z of [-t.z * 0.75, t.z * 0.78]) b.add(dark, ring(0.06, 0.015), mat(s * t.x * 0.82, roof + 0.03, z, 0, Math.PI / 2));
    b.add(dark, cylZ(0.015, 1.0, 6), mat(s * (t.x + 0.07), c.y + 0.18, 0.15));
    for (const z of [-0.35, 0.65]) b.add(dark, box(0.07, 0.03, 0.03), mat(s * (t.x + 0.035), c.y + 0.18, z));
    b.add(cast, cylX(0.075, 0.06, 14), mat(s * (t.x + 0.02), c.y - 0.05, 0.35));
    b.add(dark, box(0.14, 0.05, 0.22), mat(s * (t.x + 0.05), c.y + 0.32, -t.z * 0.7));
    for (let i = 0; i < 3; i++) {
      b.add(dark, cylY(0.04, 0.26, 10), mat(s * (t.x + 0.06), c.y + 0.42, -t.z * 0.62 - i * 0.09, -0.6, 0, -s * 0.35));
    }
  }

  // Rear stowage bin and antenna.
  b.add(paint, box(t.x * 1.6, 0.46, 0.5), mat(0, c.y + 0.05, t.z + 0.27));
  for (const x of [-0.4, 0.4]) b.add(dark, box(0.04, 0.47, 0.51), mat(x, c.y + 0.05, t.z + 0.27));
  b.add(dark, cylY(0.04, 0.12, 8), mat(-t.x * 0.62, roof + 0.03, t.z * 0.9));
  b.add(dark, cylY(0.006, 2.4, 4), mat(-t.x * 0.62, roof + 1.25, t.z * 0.95, 0.08));

  return b.build('turret');
}

// -----------------------------------------------------------------------------
// Gun (pitches about the trunnion; barrel along -Z)
// -----------------------------------------------------------------------------

function buildGun(def: VehicleDef, team: TeamId, lib: MaterialLibrary): THREE.Group {
  const b = new PartBuilder(() => 0);
  const cast = lib.get('paintCast', team);
  const paint = lib.get('paint', team);
  const dark = lib.get('darkSteel');
  const len = def.gun.length;

  // Curved cast mantlet covering the front arc, with a shield plate behind it.
  const mantlet = new THREE.CylinderGeometry(0.32, 0.32, 1.05, 28, 1, false, Math.PI - 1.25, 2.5).rotateZ(Math.PI / 2);
  b.add(cast, mantlet);
  b.add(cast, box(1.05, 0.62, 0.1), mat(0, 0, 0.02));

  // Barrel: recoil sleeve, then a tapering tube (lathe profile along +Y, turned to -Z).
  const brakeLen = 0.32;
  const profile = [
    new THREE.Vector2(0, 0.2),
    new THREE.Vector2(0.115, 0.2),
    new THREE.Vector2(0.115, 0.95),
    new THREE.Vector2(0.092, 1.02),
    new THREE.Vector2(0.086, 1.1),
    new THREE.Vector2(0.071, len - brakeLen),
    new THREE.Vector2(0, len - brakeLen),
  ];
  b.add(paint, new THREE.LatheGeometry(profile, 20), mat(0, 0, 0, -Math.PI / 2));

  // Double-baffle muzzle brake with the bore visible.
  const zb = -(len - brakeLen);
  b.add(dark, cylZ(0.082, brakeLen, 18), mat(0, 0, zb - brakeLen / 2));
  for (const f of [0.22, 0.85]) b.add(dark, box(0.3, 0.17, 0.06), mat(0, 0, zb - brakeLen * f));
  b.add(dark, box(0.3, 0.035, brakeLen), mat(0, 0.068, zb - brakeLen / 2));
  b.add(dark, box(0.3, 0.035, brakeLen), mat(0, -0.068, zb - brakeLen / 2));
  b.add(lib.get('bore'), cylZ(0.04, 0.01, 12), mat(0, 0, -len - 0.006));

  // Coaxial machine gun and sight aperture.
  b.add(lib.get('gunSteel'), cylZ(0.022, 0.4, 8), mat(0.3, 0.03, -0.45));
  b.add(dark, cylZ(0.04, 0.12, 10), mat(0.3, 0.03, -0.3));
  b.add(lib.get('glass'), box(0.09, 0.07, 0.02), mat(-0.3, 0.1, -0.33));

  return b.build('gun');
}
