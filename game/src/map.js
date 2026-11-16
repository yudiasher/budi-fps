// map.js — "Solar Flats", an original desert compound.
// Layout (x east, z south; north is -Z, where the two sites sit):
//   spawn (south, z=+26) -- lanes -- mid plaza -- A site (solar array, NE)
//                                          \-- B site (water plant, NW)
//   A long lane runs up the east side, B long up the west, mid cuts through
//   a broken wall in the centre. Crates and walls make corners and sightlines.
// Colliders are axis-aligned boxes {x0,z0,x1,z1,h}; the same list drives
// player/bot movement and line-of-sight. Geometry is built once from it.
import * as THREE from 'three';

export const MAP = { halfX: 32, halfZ: 24 };

// Every solid box: [x0, z0, x1, z1, height, colour, top?] — top flag marks
// low crates the player can see over but not walk through.
export const BOXES = [
  // Perimeter (h 4)
  [-32, -24, 32, -22.5, 4, 0x8a6b4a], // north wall
  [-32, 22.5, 32, 24, 4, 0x8a6b4a], // south wall
  [-32, -24, -30.5, 24, 4, 0x8a6b4a], // west wall
  [30.5, -24, 32, 24, 4, 0x8a6b4a], // east wall
  // A site: solar array courtyard (NE) — walls form a U open to the south,
  // so the site ring itself is open ground with panel blocks for cover.
  [14, -22, 30, -20.5, 3.2, 0xb98a4e], // A back wall
  [14, -22, 15.5, -14, 3.2, 0xb98a4e], // A west wall
  [28.5, -22, 30, -14, 3.2, 0xb98a4e], // A east wall
  [24, -14, 30, -12, 2.2, 0x5e7f8a], // array control hut
  [18, -18, 21, -16, 1.1, 0x2e4a5e], // panel block 1 (low)
  [23, -18, 26, -16, 1.1, 0x2e4a5e], // panel block 2 (low)
  [18, -14.5, 21, -12.5, 1.1, 0x2e4a5e],
  // B site: water plant courtyard (NW) — same U, open to the south.
  [-30, -22, -14, -20.5, 3.2, 0x7a8a7a], // B back wall
  [-30, -22, -28.5, -14, 3.2, 0x7a8a7a], // B west wall
  [-15.5, -22, -14, -14, 3.2, 0x7a8a7a], // B east wall
  [-24, -14, -18, -12, 2.2, 0x6b7f6b], // pump house
  [-27, -20, -24, -17, 2.6, 0x9fb4c0], // round tank (boxed, north corner)
  [-20, -20, -17, -17, 2.6, 0x9fb4c0], // round tank 2 (north corner)
  // Mid: broken wall with a gap, crates plaza.
  [-6, -4, 6, -2.5, 3.0, 0xa08a68], // mid wall west segment
  [9, -4, 14, -2.5, 3.0, 0xa08a68], // mid wall east segment (gap x 6..9)
  [-3, 2, 0, 5, 1.2, 0xc2a06a], // mid crate
  [4, 3, 7, 6, 1.2, 0xc2a06a], // mid crate 2
  // East lane (A long): cover blocks
  [24, -8, 27, -5, 1.4, 0xc2a06a],
  [22, 4, 25, 7, 1.4, 0xc2a06a],
  [26, 12, 29, 15, 2.4, 0xa08a68],
  // West lane (B long): cover blocks
  [-27, -8, -24, -5, 1.4, 0xc2a06a],
  [-25, 4, -22, 7, 1.4, 0xc2a06a],
  [-29, 12, -26, 15, 2.4, 0xa08a68],
  // Spawn cover + centre pillars
  [-4, 18, -1, 21, 1.3, 0xc2a06a],
  [1, 18, 4, 21, 1.3, 0xc2a06a],
  [-12, 8, -9, 11, 2.6, 0x8a6b4a],
  [9, 8, 12, 11, 2.6, 0x8a6b4a],
];

export const SITES = {
  A: { x: 22, z: -18, r: 4.5, label: 'SITE A — SOLAR ARRAY' },
  B: { x: -22, z: -18, r: 4.5, label: 'SITE B — WATER PLANT' },
};

export const SPAWN = { x: 0, z: 20, yaw: 0 };

// Bot patrol waypoints: [x, z, tag]. Bots walk site loops, mid and lanes.
export const WAYPOINTS = [
  [22, -18, 'A'], [26, -13, 'A'], [17, -15, 'A'], [22, -10, 'A'],
  [-22, -18, 'B'], [-26, -13, 'B'], [-17, -15, 'B'], [-22, -10, 'B'],
  [0, -3, 'mid'], [7, 0, 'mid'], [-7, 0, 'mid'], [0, 8, 'mid'],
  [25, 0, 'lane'], [25, 12, 'lane'], [-25, 0, 'lane'], [-25, 12, 'lane'],
  [14, 14, 'spawn'], [-14, 14, 'spawn'], [0, 20, 'spawn'],
];

// Colliders derived from BOXES (plus the map border is clamped separately).
export const COLLIDERS = BOXES.map((b) => ({ x0: b[0], z0: b[1], x1: b[2], z1: b[3], h: b[4] }));

// Circle (x,z,r) vs AABB: push the circle out; returns true if it hit.
export function collideCircle(x, z, r) {
  let nx = x, nz = z, hit = false;
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    const cx = Math.max(c.x0, Math.min(x, c.x1));
    const cz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        nx = cx + (dx / d) * r;
        nz = cz + (dz / d) * r;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = x - c.x0, pr = c.x1 - x, pt = z - c.z0, pb = c.z1 - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) nx = c.x0 - r; else if (m === pr) nx = c.x1 + r;
        else if (m === pt) nz = c.z0 - r; else nz = c.z1 + r;
      }
      x = nx; z = nz;
    }
  }
  return { x, z, hit };
}

// Segment (x0,z0)-(x1,z1) blocked by any wall taller than `minH`?
// Used for line-of-sight: low crates (h<=1.4) do not block sight over them
// when both ends stand, so only h>1.6 boxes count.
export function segmentBlocked(x0, z0, x1, z1, minH = 1.6) {
  for (let i = 0; i < COLLIDERS.length; i++) {
    const c = COLLIDERS[i];
    if (c.h < minH) continue;
    if (segmentHitsBox(x0, z0, x1, z1, c)) return true;
  }
  return false;
}

function segmentHitsBox(x0, z0, x1, z1, c) {
  // Slab test in 2D.
  let tmin = 0, tmax = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const axes = [[dx, x0, c.x0, c.x1], [dz, z0, c.z0, c.z1]];
  for (let a = 0; a < 2; a++) {
    const d = axes[a][0], o = axes[a][1], lo = axes[a][2], hi = axes[a][3];
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}

export function insideSite(x, z, site) {
  const s = SITES[site];
  const dx = x - s.x, dz = z - s.z;
  return dx * dx + dz * dz < s.r * s.r;
}

// --- rendering: build the visible map once from BOXES --------------------
export function buildMap(scene) {
  const group = new THREE.Group();
  group.name = 'solar-flats';
  // Ground: sand with a darker mid plaza strip.
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xd8b47e });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 48), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const plazaMat = new THREE.MeshLambertMaterial({ color: 0xc49a68 });
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), plazaMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.01, 2);
  plaza.receiveShadow = true;
  group.add(plaza);
  // Site rings: flat discs marking A (amber) and B (teal).
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.35, s.r, 40),
      new THREE.MeshBasicMaterial({ color: key === 'A' ? 0xffb347 : 0x4fd8c8, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.02, s.z);
    group.add(ring);
  }
  // Boxes.
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (const b of BOXES) {
    const mat = new THREE.MeshLambertMaterial({ color: b[5] });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((b[0] + b[2]) / 2, b[4] / 2, (b[1] + b[3]) / 2);
    m.scale.set(b[2] - b[0], b[4], b[3] - b[1]);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  // Solar panels on A site: tilted dark-blue slabs on the low blocks.
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x1d3a5e });
  for (const [px, pz] of [[19.5, -17], [24.5, -17], [19.5, -13.5]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.8), panelMat);
    p.position.set(px, 1.25, pz);
    p.rotation.x = -0.35;
    group.add(p);
  }
  // Water tanks on B site: cylinders, tucked in the north corners.
  const tankMat = new THREE.MeshLambertMaterial({ color: 0x9fb4c0 });
  for (const [tx, tz] of [[-25.5, -18.5], [-18.5, -18.5]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 18), tankMat);
    t.position.set(tx, 1.3, tz);
    t.castShadow = true;
    group.add(t);
  }
  // Dusk sky: big gradient dome (BackSide sphere) + sun disc.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x54406e, side: THREE.BackSide, fog: false }),
  );
  group.add(sky);
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(6, 24),
    new THREE.MeshBasicMaterial({ color: 0xff9a3d, fog: false }),
  );
  sun.position.set(-60, 28, -90);
  sun.lookAt(0, 0, 0);
  group.add(sun);
  scene.add(group);
  return group;
}
