// player.js — first-person movement and shooting.
// Movement: acceleration + friction (not instant velocity), so stopping to
// aim pays and running gunfire is punished through spread. Collision is a
// circle vs the map's AABB list. Shooting is a ray against bot body/head
// boxes, capped by the nearest wall — headshots pay double.
import * as THREE from 'three';
import { WEAPONS, GRENADE } from './weapons.js';
import { collideCircle, MAP } from './map.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.12;
const RADIUS = 0.42;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.8;
const ADS_SPEED = 3.2;
const ACCEL = 55;
const FRICTION = 9;

// Reused scratch — no allocation in the step loop.
const _v = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };

export function eyeHeight(p) { return p.crouched ? EYE_CROUCH : EYE_STAND; }

// Ray vs an axis-aligned 3D box; returns distance or Infinity.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [b.x0, 0, b.z0], hi = [b.x1, b.h, b.z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return Infinity;
    } else {
      let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Nearest wall distance along a ray (for capping shots and tracers).
export function rayWalls(ox, oy, oz, dx, dy, dz, colliders) {
  let best = Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, colliders[i]);
    if (t < best) best = t;
  }
  // Map border walls.
  const border = [
    { x0: -MAP.halfX, z0: -MAP.halfZ, x1: MAP.halfX, z1: -MAP.halfZ + 0.1, h: 4 },
    { x0: -MAP.halfX, z0: MAP.halfZ - 0.1, x1: MAP.halfX, z1: MAP.halfZ, h: 4 },
    { x0: -MAP.halfX, z0: -MAP.halfZ, x1: -MAP.halfX + 0.1, z1: MAP.halfZ, h: 4 },
    { x0: MAP.halfX - 0.1, z0: -MAP.halfZ, x1: MAP.halfX, z1: MAP.halfZ, h: 4 },
  ];
  for (let i = 0; i < 4; i++) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, border[i]);
    if (t < best) best = t;
  }
  return best;
}

// Ray vs bots: body box (0.7 x 1.75) and head box (0.42 x 0.35 at 1.45..1.8).
// Returns {bot, dist, head} for the nearest hit, or null.
export function rayBots(ox, oy, oz, dx, dy, dz, bots, maxDist) {
  let best = null, bestDist = maxDist;
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i];
    if (!b.alive) continue;
    const hw = 0.36;
    const body = { x0: b.x - hw, z0: b.z - hw, x1: b.x + hw, z1: b.z + hw, h: 1.42 };
    const head = { x0: b.x - 0.21, z0: b.z - 0.21, x1: b.x + 0.21, z1: b.z + 0.21, h: 1.82 };
    // Head box sits 1.42..1.82: rayBox starts at y=0, so offset via a shim:
    const th = rayBoxY(ox, oy, oz, dx, dy, dz, head, 1.42);
    if (th < bestDist) { bestDist = th; best = { bot: b, dist: th, head: true }; }
    const tb = rayBox(ox, oy, oz, dx, dy, dz, body);
    if (tb < bestDist) { bestDist = tb; best = { bot: b, dist: tb, head: false }; }
  }
  return best;
}

function rayBoxY(ox, oy, oz, dx, dy, dz, b, y0) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [b.x0, y0, b.z0], hi = [b.x1, b.h, b.z1];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return Infinity;
    } else {
      let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Aim direction from yaw/pitch, with spread applied (spread in radians).
export function aimDir(p, spread, out) {
  const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
  const sp = Math.sin(p.pitch), cp = Math.cos(p.pitch);
  // Forward is -Z rotated by yaw; pitch raises it.
  out.x = -sy * cp + (Math.random() * 2 - 1) * spread;
  out.y = sp + (Math.random() * 2 - 1) * spread;
  out.z = -cy * cp + (Math.random() * 2 - 1) * spread;
  const len = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z) || 1;
  out.x /= len; out.y /= len; out.z /= len;
  return out;
}

// Current spread: base + movement + air + bloom, reduced by crouch/ADS.
export function currentSpread(state, input, weapon) {
  const p = state.player;
  const speed = Math.hypot(p.vel.x, p.vel.z);
  let s = weapon.spreadBase + p.spread * weapon.spreadBloom;
  s += (speed / WALK_SPEED) * weapon.spreadMove;
  if (!p.onGround) s += weapon.spreadAir;
  if (p.crouched) s *= 0.6;
  if (input.ads) s *= 0.55;
  return s;
}

export function stepPlayer(state, input, dt, ctx) {
  const p = state.player;
  if (!p.alive) return;
  // Look.
  p.yaw -= input.mouseDX * 0.0022;
  p.pitch -= input.mouseDY * 0.0022;
  p.pitch = Math.max(-1.45, Math.min(1.45, p.pitch));
  input.mouseDX = 0; input.mouseDY = 0;
  // Crouch toggle handled by input (ctrl held).
  p.crouched = !!input.crouch;
  // Wish direction from keys, in yaw space.
  let fx = 0, fz = 0;
  if (input.forward) { fx += -Math.sin(p.yaw); fz += -Math.cos(p.yaw); }
  if (input.back) { fx += Math.sin(p.yaw); fz += Math.cos(p.yaw); }
  if (input.left) { fx += -Math.cos(p.yaw); fz += Math.sin(p.yaw); }
  if (input.right) { fx += Math.cos(p.yaw); fz += -Math.sin(p.yaw); }
  const fl = Math.hypot(fx, fz);
  const maxSpeed = p.crouched ? CROUCH_SPEED : input.ads ? ADS_SPEED : WALK_SPEED;
  if (fl > 0.01) {
    fx /= fl; fz /= fl;
    p.vel.x += fx * ACCEL * dt;
    p.vel.z += fz * ACCEL * dt;
    const sp = Math.hypot(p.vel.x, p.vel.z);
    if (sp > maxSpeed) { p.vel.x *= maxSpeed / sp; p.vel.z *= maxSpeed / sp; }
  } else {
    // Friction when no input.
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const drop = FRICTION * dt;
    if (sp <= drop) { p.vel.x = 0; p.vel.z = 0; }
    else { p.vel.x *= (sp - drop) / sp; p.vel.z *= (sp - drop) / sp; }
  }
  // Integrate + collide.
  let nx = p.pos.x + p.vel.x * dt;
  let nz = p.pos.z + p.vel.z * dt;
  nx = Math.max(-MAP.halfX + 0.6, Math.min(MAP.halfX - 0.6, nx));
  nz = Math.max(-MAP.halfZ + 0.6, Math.min(MAP.halfZ - 0.6, nz));
  const c = collideCircle(nx, nz, RADIUS);
  p.pos.x = c.x; p.pos.z = c.z;
  // Jump / gravity (eye height is derived; vy only for jump arc).
  if (input.jump && p.onGround) { p.vy = 5.2; p.onGround = false; }
  if (!p.onGround) {
    p.vy -= 14 * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) { p.pos.y = 0; p.vy = 0; p.onGround = true; }
  }
  // Recoil/spread decay.
  p.recoil = Math.max(0, p.recoil - 2.4 * dt);
  p.spread = Math.max(0, p.spread - 1.6 * dt);
  p.shake = Math.max(0, (state.shake || 0) - dt * 2);
  // Firing.
  if (input.firing) tryFire(state, input, ctx);
  // Reload.
  if (input.reloadPressed) {
    input.reloadPressed = false;
    startReload(state, ctx);
  }
  // Grenade.
  if (input.grenadePressed) {
    input.grenadePressed = false;
    throwGrenade(state, ctx);
  }
}

export function startReload(state, ctx) {
  const p = state.player;
  const ammo = ctx.ammo[p.weapon];
  const w = WEAPONS[p.weapon];
  if (ammo.reloading || ammo.mag >= w.mag || ammo.reserve <= 0) return;
  ammo.reloading = true;
  ammo.reloadEnd = state.time + w.reloadTime;
  ctx.audio.reload();
}

export function finishReload(state, ctx) {
  const p = state.player;
  const ammo = ctx.ammo[p.weapon];
  const w = WEAPONS[p.weapon];
  const need = w.mag - ammo.mag;
  const take = Math.min(need, ammo.reserve);
  ammo.mag += take;
  ammo.reserve -= take;
  ammo.reloading = false;
}

export function tryFire(state, input, ctx) {
  const p = state.player;
  const now = state.time;
  const w = WEAPONS[p.weapon];
  const ammo = ctx.ammo[p.weapon];
  if (ammo.reloading) return;
  if (now - p.lastShotAt < w.fireInterval) return;
  if (!w.auto && input.firedOnce) return; // semi-auto: one shot per click
  if (ammo.mag <= 0) {
    ctx.audio.dry();
    p.lastShotAt = now; // rate-limit the click
    startReload(state, ctx);
    return;
  }
  p.lastShotAt = now;
  ammo.mag -= 1;
  state.stats.shots += 1;
  const spread = currentSpread(state, input, w);
  aimDir(p, spread, _dir);
  const ox = p.pos.x, oy = p.pos.y + eyeHeight(p), oz = p.pos.z;
  const wallDist = rayWalls(ox, oy, oz, _dir.x, _dir.y, _dir.z, ctx.colliders);
  const hit = rayBots(ox, oy, oz, _dir.x, _dir.y, _dir.z, ctx.bots, Math.min(w.range, wallDist));
  const endDist = hit ? hit.dist : Math.min(w.range, wallDist === Infinity ? w.range : wallDist);
  _v.x = ox + _dir.x * endDist; _v.y = oy + _dir.y * endDist; _v.z = oz + _dir.z * endDist;
  ctx.effects.tracer({ x: ox, y: oy, z: oz }, { x: _v.x, y: _v.y, z: _v.z }, w.tracer);
  // Muzzle flash at the gun tip (in front of the camera).
  const mx = ox + _dir.x * 0.7, my = oy + _dir.y * 0.7 - 0.12, mz = oz + _dir.z * 0.7;
  ctx.effects.muzzle(new THREE.Vector3(mx, my, mz), new THREE.Vector3(_dir.x, _dir.y, _dir.z));
  ctx.audio.shot(w.sound, 0);
  p.recoil = Math.min(1, p.recoil + w.recoilKick);
  p.spread = Math.min(1, p.spread + 0.12);
  p.lastNoiseAt = now;
  p.noisePos.x = p.pos.x; p.noisePos.z = p.pos.z;
  if (hit) {
    const fall = hit.dist > w.range * 0.6 ? w.falloff : 1;
    const dmg = Math.round(w.damage * (hit.head ? w.headMult : 1) * fall);
    state.stats.hits += 1;
    if (hit.head) state.stats.headshots += 1;
    ctx.damageBot(hit.bot, dmg, hit.head, state);
    ctx.effects.sparksAt({ x: _v.x, y: _v.y, z: _v.z });
    if (hit.head) ctx.audio.headshot(); else ctx.audio.hit();
    ctx.onHitmarker(hit.head);
  } else if (wallDist !== Infinity && wallDist <= w.range) {
    ctx.effects.sparksAt({ x: _v.x, y: _v.y, z: _v.z });
  }
  if (ammo.mag === 0) startReload(state, ctx);
}

// --- grenades ------------------------------------------------------------
export const grenades = []; // {x,y,z,vx,vy,vz,fuse,alive}

export function throwGrenade(state, ctx) {
  const p = state.player;
  if (p.grenades <= 0) return;
  p.grenades -= 1;
  aimDir(p, 0, _dir);
  grenades.push({
    x: p.pos.x, y: p.pos.y + eyeHeight(p), z: p.pos.z,
    vx: _dir.x * 16 + p.vel.x, vy: _dir.y * 16 + 3.5, vz: _dir.z * 16 + p.vel.z,
    fuse: GRENADE.fuse, alive: true,
  });
  ctx.audio.tone(500, 0.08, 'square', 0.15);
}

export function updateGrenades(state, dt, ctx) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    if (!g.alive) { grenades.splice(i, 1); continue; }
    g.vy -= 12 * dt;
    g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
    if (g.y <= 0.12) { g.y = 0.12; g.vy *= -0.45; g.vx *= 0.7; g.vz *= 0.7; }
    const c = collideCircle(g.x, g.z, 0.15);
    if (c.hit) { g.x = c.x; g.z = c.z; g.vx *= -0.4; g.vz *= -0.4; }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      g.alive = false;
      ctx.explodeGrenade(g);
    }
  }
}

// --- viewmodel: a simple boxy gun attached to the camera -----------------
export function buildViewmodel() {
  const group = new THREE.Group();
  group.scale.setScalar(0.45);
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a4f56 });
  const mid = new THREE.MeshLambertMaterial({ color: 0x6a7078 });
  const accent = new THREE.MeshLambertMaterial({ color: 0xd98a2b });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  body.position.set(0.3, -0.3, -1.0);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), mid);
  barrel.position.set(0.3, -0.28, -1.38);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), mid);
  grip.position.set(0.3, -0.4, -0.8);
  grip.rotation.x = 0.35;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), accent);
  sight.position.set(0.3, -0.22, -1.06);
  group.add(body, barrel, grip, sight);
  group.userData = { baseZ: -0.45 };
  return group;
}
