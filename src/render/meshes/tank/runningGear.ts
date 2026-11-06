/**
 * Running gear geometry and kinematics: road wheels, drive sprocket, idler,
 * return rollers and a track loop that wraps them. The loop is recomputed each
 * frame from the current wheel heights, so the bottom run follows the
 * suspension, and the links advance with the track speed.
 */
import * as THREE from 'three';
import type { VehicleDef } from '../../../data/schema';
import { wheelMounts } from '../../../game/vehicleGeometry';
import type { MaterialLibrary } from '../../materials/MaterialLibrary';
import { mat, PartBuilder } from '../geometryUtils';

export interface Circle {
  z: number;
  y: number;
  r: number;
}

export interface GearLayout {
  /** Track centre-line x for [left, right]. */
  sideX: [number, number];
  /** Link width across the track (m). */
  trackWidth: number;
  linkThickness: number;
  linkPitch: number;
  wheelRadius: number;
  wheelZ: number[];
  /** Road wheel centre y at zero spring compression (hull frame). */
  wheelBaseY: number;
  sprocket: Circle;
  idler: Circle;
  rollers: Circle[];
}

/** Derives running-gear dimensions from the vehicle definition (hull frame, -Z forward). */
export function gearLayout(def: VehicleDef): GearLayout {
  const hy = def.hull.half.y;
  const clearance = def.hull.groundClearance;
  const omega = 2 * Math.PI * def.mobility.suspension.frequencyHz;
  const sag = 9.81 / (omega * omega); // static spring deflection, as in vehicleFactory
  const t = 0.07;
  const r = Math.min(0.38, 0.72 * clearance);
  const mounts = wheelMounts(def);
  const wheelZ = mounts[0].map((m) => m.z);
  const half = def.mobility.trackLength / 2;
  // Wheel centre such that, at static compression, the track touches the ground.
  const wheelBaseY = -hy - clearance - sag + r + t;
  const restY = wheelBaseY + sag;
  const sprocket = { z: -half - r * 1.45, y: restY + r * 1.2, r: r * 0.92 };
  const idler = { z: half + r * 1.4, y: restY + r * 0.95, r: r * 0.86 };
  const topAt = (z: number) => {
    const a = sprocket.y + sprocket.r;
    const b = idler.y + idler.r;
    return a + ((b - a) * (z - sprocket.z)) / (idler.z - sprocket.z);
  };
  const rollerR = 0.1;
  const rollers = [-0.33, 0, 0.33].map((f) => {
    const z = f * half * 2;
    return { z, y: topAt(z) - rollerR + 0.004, r: rollerR };
  });
  return {
    sideX: [mounts[0][0].x, mounts[1][0].x],
    trackWidth: 0.44,
    linkThickness: t,
    linkPitch: 0.15,
    wheelRadius: r,
    wheelZ,
    wheelBaseY,
    sprocket,
    idler,
    rollers,
  };
}

export interface TrackLoop {
  z: Float64Array;
  y: Float64Array;
  /** Cumulative length at each vertex; last entry is the loop length. */
  s: Float64Array;
  length: number;
}

/**
 * Track centre-line loop: convex hull (counter-clockwise in the z-y plane) of
 * all wheels inflated by half the link thickness. Counter-clockwise means the
 * bottom run is traversed front-to-rear, i.e. the direction links move
 * relative to the hull when the vehicle drives forwards.
 */
export function trackLoop(layout: GearLayout, wheelY: readonly number[]): TrackLoop {
  const pad = layout.linkThickness / 2;
  const pts: [number, number][] = [];
  const ring = (c: Circle, n: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([c.z + Math.cos(a) * (c.r + pad), c.y + Math.sin(a) * (c.r + pad)]);
    }
  };
  ring(layout.sprocket, 28);
  ring(layout.idler, 28);
  for (const c of layout.rollers) ring(c, 12);
  layout.wheelZ.forEach((z, i) => ring({ z, y: wheelY[i], r: layout.wheelRadius }, 24));

  // Andrew's monotone chain.
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const n = hull.length;
  const z = new Float64Array(n + 1);
  const y = new Float64Array(n + 1);
  const s = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const p = hull[i % n];
    z[i] = p[0];
    y[i] = p[1];
    if (i > 0) s[i] = s[i - 1] + Math.hypot(z[i] - z[i - 1], y[i] - y[i - 1]);
  }
  return { z, y, s, length: s[n] };
}

/**
 * Places `count` equally spaced links along the loop, shifted by `offset`
 * metres of track travel. Calls `out(i, z, y, angle)` where `angle` is the
 * tangent direction in the z-y plane.
 */
export function placeLinks(
  loop: TrackLoop,
  count: number,
  offset: number,
  out: (i: number, z: number, y: number, angle: number) => void,
): void {
  const spacing = loop.length / count;
  let s = ((offset % spacing) + spacing) % spacing;
  let seg = 0;
  for (let i = 0; i < count; i++, s += spacing) {
    while (seg < loop.s.length - 2 && loop.s[seg + 1] < s) seg++;
    const l = loop.s[seg + 1] - loop.s[seg] || 1;
    const f = (s - loop.s[seg]) / l;
    const dz = loop.z[seg + 1] - loop.z[seg];
    const dy = loop.y[seg + 1] - loop.y[seg];
    out(i, loop.z[seg] + dz * f, loop.y[seg] + dy * f, Math.atan2(dy, dz));
  }
}

// -----------------------------------------------------------------------------
// Geometry
// -----------------------------------------------------------------------------

const cyl = (r: number, len: number, seg = 20) => new THREE.CylinderGeometry(r, r, len, seg).rotateZ(Math.PI / 2); // axis X

/** One track link (local: X across, Z along the track, -Y outward). */
export function linkGeometry(layout: GearLayout, lib: MaterialLibrary): THREE.BufferGeometry {
  const steel = lib.get('trackSteel');
  const b = new PartBuilder(() => 0.45);
  const p = layout.linkPitch;
  const t = layout.linkThickness;
  const w = layout.trackWidth;
  b.add(steel, new THREE.BoxGeometry(w, t * 0.55, p * 0.86));
  b.add(steel, new THREE.BoxGeometry(w * 0.96, 0.028, 0.045), mat(0, -t * 0.27 - 0.014, 0)); // grouser
  b.add(steel, new THREE.BoxGeometry(0.06, 0.075, p * 0.5), mat(0, t * 0.27 + 0.037, 0)); // guide horn
  b.add(steel, cyl(0.022, w * 1.02, 8), mat(0, 0, p * 0.43)); // hinge pin
  const group = b.build();
  return (group.children[0] as THREE.Mesh).geometry;
}

/** Dual road wheel: two rubber-tyred discs either side of the guide horns. */
export function roadWheel(layout: GearLayout, lib: MaterialLibrary, team: 'A' | 'B'): THREE.Group {
  const r = layout.wheelRadius;
  const b = new PartBuilder(() => 0.35);
  const paint = lib.get('paint', team);
  for (const s of [-1, 1]) {
    const x = s * 0.115;
    b.add(lib.get('rubber'), cyl(r, 0.15, 28), mat(x, 0, 0));
    b.add(paint, cyl(r * 0.8, 0.156, 24), mat(x, 0, 0));
    b.add(paint, cyl(r * 0.36, 0.17, 16), mat(x + s * 0.01, 0, 0));
    b.add(lib.get('darkSteel'), cyl(0.07, 0.19, 12), mat(x + s * 0.02, 0, 0)); // hub cap
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.add(lib.get('darkSteel'), cyl(0.018, 0.18, 6), mat(x + s * 0.01, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5));
    }
  }
  b.add(lib.get('darkSteel'), cyl(0.06, 0.3, 10)); // axle between discs
  return b.build('roadWheel');
}

/** Toothed drive sprocket (dual rings). */
export function sprocketWheel(c: Circle, lib: MaterialLibrary, team: 'A' | 'B'): THREE.Group {
  const b = new PartBuilder(() => 0.3);
  const steel = lib.get('darkSteel');
  const teeth = 13;
  for (const s of [-1, 1]) {
    const x = s * 0.12;
    b.add(steel, cyl(c.r * 0.92, 0.07, 26), mat(x, 0, 0));
    for (let k = 0; k < teeth; k++) {
      const a = (k / teeth) * Math.PI * 2;
      b.add(steel, new THREE.BoxGeometry(0.07, 0.09, 0.07), mat(x, Math.cos(a) * c.r, Math.sin(a) * c.r, a));
    }
  }
  b.add(lib.get('paint', team), cyl(c.r * 0.55, 0.32, 18));
  b.add(steel, cyl(0.1, 0.36, 12));
  return b.build('sprocket');
}

/** Idler wheel (spoked steel, dual). */
export function idlerWheel(c: Circle, lib: MaterialLibrary): THREE.Group {
  const b = new PartBuilder(() => 0.35);
  const steel = lib.get('darkSteel');
  for (const s of [-1, 1]) {
    b.add(steel, cyl(c.r, 0.1, 26), mat(s * 0.115, 0, 0));
    b.add(steel, cyl(c.r * 0.35, 0.14, 12), mat(s * 0.115, 0, 0));
  }
  b.add(steel, cyl(0.07, 0.34, 10));
  return b.build('idler');
}

/** Small return roller supporting the top run. */
export function returnRoller(c: Circle, lib: MaterialLibrary): THREE.Group {
  const b = new PartBuilder(() => 0.25);
  b.add(lib.get('rubber'), cyl(c.r, 0.2, 16));
  b.add(lib.get('darkSteel'), cyl(c.r * 0.5, 0.24, 10));
  b.add(lib.get('darkSteel'), cyl(0.03, 0.6, 8)); // stub axle (symmetric: works on either side)
  return b.build('roller');
}
