import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { armorModelFor, hullArmorHalf } from '../../../combat/armorModel';
import { loadGameData } from '../../../data/loader';
import { boxProjectUV, convexPolyhedronGeometry } from '../geometryUtils';
import { gearLayout, placeLinks, trackLoop } from '../tank/runningGear';

const def = loadGameData().vehicles.get('kestrel_mk1')!;

describe('convexPolyhedronGeometry (visual hull = armour hull)', () => {
  const planes = armorModelFor(def).hull.planes;
  const geo = convexPolyhedronGeometry(planes);
  const pos = geo.getAttribute('position');

  it('every vertex lies on or inside every armour plane', () => {
    for (let i = 0; i < pos.count; i++) {
      const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
      for (const pl of planes) expect(pl.n.x * p.x + pl.n.y * p.y + pl.n.z * p.z).toBeLessThanOrEqual(pl.d + 1e-4);
    }
  });

  it('spans the armour box and shows the sloped glacis', () => {
    geo.computeBoundingBox();
    const h = hullArmorHalf(def);
    const bb = geo.boundingBox!;
    expect(bb.min.y).toBeCloseTo(-h.y, 4);
    expect(bb.max.y).toBeCloseTo(h.y, 4);
    expect(bb.min.z).toBeCloseTo(-h.z, 4);
    expect(bb.max.x).toBeCloseTo(h.x, 4);
    // Roof starts behind the nose by 2·hy·tan(56°).
    let roofFront = Infinity;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - h.y) < 1e-6) roofFront = Math.min(roofFront, pos.getZ(i));
    expect(roofFront).toBeCloseTo(-h.z + 2 * h.y * Math.tan((56 * Math.PI) / 180), 4);
  });

  it('faces point outwards (closed, positive volume)', () => {
    let volume = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    expect(volume).toBeGreaterThan(5);
  });

  it('box projection gives uniform texel density', () => {
    const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    boxProjectUV(g, 2);
    const uv = g.getAttribute('uv');
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < uv.count; i++) {
      max = Math.max(max, uv.getX(i));
      min = Math.min(min, uv.getX(i));
    }
    expect(max - min).toBeCloseTo(1, 6); // 2 m face / 2 m tile
  });
});

describe('track loop', () => {
  const layout = gearLayout(def);
  const rest = layout.wheelZ.map(() => layout.wheelBaseY);

  it('wraps all wheels with the bottom run on the ground', () => {
    const loop = trackLoop(layout, rest.map((y) => y + 0.086));
    const lowest = Math.min(...loop.y);
    // Ground is clearance below the hull bottom; link centre is half a link above it.
    expect(lowest).toBeCloseTo(-def.hull.half.y - def.hull.groundClearance + layout.linkThickness / 2, 2);
    expect(loop.length).toBeGreaterThan(2 * (layout.idler.z - layout.sprocket.z));
  });

  it('follows the suspension: when the wheels rise, the bottom run rises with them', () => {
    const flat = trackLoop(layout, rest);
    const raised = trackLoop(layout, rest.map((y) => y + 0.2));
    expect(Math.min(...raised.y) - Math.min(...flat.y)).toBeCloseTo(0.2, 6);
    // A single raised wheel lifts off: the taut bottom run stays on the ground.
    const one = rest.slice();
    one[2] += 0.2;
    expect(Math.min(...trackLoop(layout, one).y)).toBeCloseTo(Math.min(...flat.y), 6);
  });

  it('places links evenly and advances them with track travel', () => {
    const loop = trackLoop(layout, rest);
    const n = Math.round(loop.length / layout.linkPitch);
    const a: number[][] = [];
    const b: number[][] = [];
    placeLinks(loop, n, 0, (_i, z, y) => a.push([z, y]));
    placeLinks(loop, n, 0.05, (_i, z, y) => b.push([z, y]));
    expect(a).toHaveLength(n);
    // Consecutive links are about one pitch apart.
    const d = Math.hypot(a[1][0] - a[0][0], a[1][1] - a[0][1]);
    expect(d).toBeCloseTo(loop.length / n, 1);
    // Forward travel moves the first (bottom-run) link rearwards (+z).
    expect(b[0][0]).toBeGreaterThan(a[0][0]);
  });
});
