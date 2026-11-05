import * as THREE from 'three';
import type { VehicleDef } from '../../data/schema';
import { wheelMounts } from '../../game/vehicleGeometry';
import { hullArmorHalf, turretCentreLocal } from '../../combat/armorModel';

/** Scene-graph handles for one vehicle; driven by RenderSyncSystem. */
export interface TankView {
  root: THREE.Group;
  turret: THREE.Group;
  gun: THREE.Group;
  /** [side][index] road wheels, positioned from suspension compression. */
  wheels: THREE.Object3D[][];
  wheelRestY: number;
  /** All materials owned by this view (for damage / wreck tinting). */
  materials: THREE.MeshLambertMaterial[];
}

/**
 * Placeholder tank built from primitives. The hierarchy mirrors the
 * simulation: root (hull frame) -> turret (yaw) -> gun (pitch).
 */
export function createTankView(def: VehicleDef, color: number): TankView {
  const hullMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.65) });
  const trackMat = new THREE.MeshLambertMaterial({ color: 0x2b2a27 });
  const metalMat = new THREE.MeshLambertMaterial({ color: 0x3d3d3a });
  const shadow = <T extends THREE.Mesh>(mesh: T) => {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };

  const root = new THREE.Group();
  const h = def.hull.half;

  // Hull: side profile extruded across the width. The upper glacis and the
  // rear plate use the slopes from the armor data, so the visual silhouette
  // matches the ballistic model.
  const hull = shadow(new THREE.Mesh(createHullGeometry(def), hullMat));
  root.add(hull);
  // Sponsons over the tracks.
  const fender = shadow(new THREE.Mesh(new THREE.BoxGeometry(h.x * 2, 0.08, h.z * 2), darkMat));
  fender.position.y = h.y * 0.2;
  root.add(fender);

  // Tracks and road wheels.
  const mounts = wheelMounts(def);
  const trackH = def.hull.groundClearance + h.y * 0.9;
  const trackW = 0.45;
  const wheelR = Math.min(0.38, trackH * 0.4);
  const wheelRestY = -h.y - def.hull.groundClearance + wheelR;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, trackW * 0.9, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels: THREE.Object3D[][] = [[], []];
  for (let side = 0; side < 2; side++) {
    const x = mounts[side][0].x;
    const track = shadow(new THREE.Mesh(new THREE.BoxGeometry(trackW, trackH * 0.92, def.mobility.trackLength + 0.9), trackMat));
    track.position.set(x, -h.y - def.hull.groundClearance + (trackH * 0.92) / 2, 0);
    root.add(track);
    for (const mount of mounts[side]) {
      const w = shadow(new THREE.Mesh(wheelGeo, metalMat));
      w.position.set(x + (side === 0 ? -0.04 : 0.04), wheelRestY, mount.z);
      root.add(w);
      wheels[side].push(w);
    }
  }

  // Turret (yaw) group at the ring position.
  const t = def.turret;
  const turret = new THREE.Group();
  turret.position.set(t.offset.x, t.offset.y, t.offset.z);
  root.add(turret);
  const turretBody = shadow(new THREE.Mesh(new THREE.BoxGeometry(t.half.x * 2, t.half.y * 2, t.half.z * 2), hullMat));
  turretBody.position.copy(turretCentreLocal(def) as THREE.Vector3);
  turret.add(turretBody);
  const bustle = shadow(new THREE.Mesh(new THREE.BoxGeometry(t.half.x * 1.6, t.half.y * 1.4, t.half.z * 0.6), darkMat));
  bustle.position.set(0, t.half.y * 0.6, t.half.z * 1.2);
  turret.add(bustle);
  const cupola = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.3, 10), darkMat));
  cupola.position.set(-t.half.x * 0.45, t.half.y * 1.75, t.half.z * 0.35);
  turret.add(cupola);

  // Gun (pitch) group at the trunnion; barrel extends along -Z.
  const g = def.gun;
  const gun = new THREE.Group();
  gun.position.set(g.offset.x, g.offset.y, g.offset.z);
  turret.add(gun);
  const mantlet = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.35), darkMat));
  mantlet.position.z = -0.1;
  gun.add(mantlet);
  const barrelGeo = new THREE.CylinderGeometry(0.06, 0.075, g.length, 10);
  barrelGeo.rotateX(Math.PI / 2);
  const barrel = shadow(new THREE.Mesh(barrelGeo, metalMat));
  barrel.position.z = -g.length / 2;
  gun.add(barrel);
  const brake = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 10).rotateX(Math.PI / 2), metalMat));
  brake.position.z = -g.length + 0.12;
  gun.add(brake);

  return { root, turret, gun, wheels, wheelRestY, materials: [hullMat, darkMat, trackMat, metalMat] };
}

/**
 * Extruded hull profile in the (z, y) plane; forward is -Z. Uses the same
 * dimensions and plate slopes as the armour model (combat/armorModel.ts) so
 * that what the player aims at is exactly what the shell hits.
 */
function createHullGeometry(def: VehicleDef): THREE.BufferGeometry {
  const h = hullArmorHalf(def);
  const deg = Math.PI / 180;
  const frontRun = 2 * h.y * Math.tan(def.armor.hull.front.slopeDeg * deg);
  const rearRun = 2 * h.y * Math.tan(def.armor.hull.rear.slopeDeg * deg);
  const shape = new THREE.Shape();
  // Shape x = hull z, shape y = hull y.
  shape.moveTo(-h.z, -h.y);
  shape.lineTo(-h.z + frontRun, h.y);
  shape.lineTo(h.z - rearRun, h.y);
  shape.lineTo(h.z, -h.y);
  shape.closePath();
  const width = h.x * 2;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  // Map shape x -> world z and the extrusion axis -> world x, centred.
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Darkens a view into a burnt-out wreck. */
export function applyWreckLook(view: TankView): void {
  for (const m of view.materials) m.color.multiplyScalar(0.28).offsetHSL(0, -0.3, 0);
}

