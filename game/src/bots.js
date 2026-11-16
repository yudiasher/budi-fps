// bots.js — defender bots for Solar Flats.
// Each bot is a simple capsule figure (body + head + gun + health bar).
// AI states: patrol (walk a waypoint loop near its site), engage (seen the
// player: strafe and fire in bursts), investigate (heard a shot: walk to the
// noise), cover (low HP: fall back to a site waypoint), defuse (bomb planted:
// the nearest bot channels the defuse at the site).
import * as THREE from 'three';
import { WAYPOINTS, collideCircle, segmentBlocked, SITES } from './map.js';
import { rayWalls } from './player.js';

const BOT_NAMES = ['Vex', 'Rook', 'Sable', 'Mira'];
const BOT_SPEED = 3.4;
const BOT_HP = 100;
const ENGAGE_RANGE = 42;
const REACTION = 0.45; // seconds to aim after first seeing the player

const _d = { x: 0, z: 0 };

export function spawnBots(state, scene) {
  const spots = [
    { x: 22, z: -14, home: 'A' }, { x: 26, z: -18, home: 'A' },
    { x: -22, z: -14, home: 'B' }, { x: -26, z: -18, home: 'B' },
  ];
  state.bots = spots.map((s, i) => {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x8a2f2f });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.05, 0.42), bodyMat);
    body.position.y = 0.85;
    body.castShadow = true;
    const headMat = new THREE.MeshLambertMaterial({ color: 0xd8b28a });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.42), headMat);
    head.position.y = 1.6;
    head.castShadow = true;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.1, 0.1), new THREE.MeshLambertMaterial({ color: 0x1a1a22 }));
    visor.position.set(0, 1.62, -0.22);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.7), new THREE.MeshLambertMaterial({ color: 0x1e2126 }));
    gun.position.set(0.3, 1.05, -0.3);
    // Health bar above the head.
    const barBg = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.09), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    barBg.position.y = 2.0;
    const barFg = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.06), new THREE.MeshBasicMaterial({ color: 0x4fd86b, side: THREE.DoubleSide }));
    barFg.position.set(0, 2.0, 0.01);
    group.add(body, head, visor, gun, barBg, barFg);
    group.position.set(s.x, 0, s.z);
    scene.add(group);
    const homeWps = WAYPOINTS.map((w, idx) => ({ w, idx })).filter((e) => e.w[2] === s.home).map((e) => e.idx);
    return {
      id: i, name: BOT_NAMES[i], x: s.x, z: s.z, yaw: Math.PI, hp: BOT_HP, alive: true,
      state: 'patrol', home: s.home, wpList: homeWps, wpIdx: i % homeWps.length,
      lastSeen: -99, lastSeenX: 0, lastSeenZ: 0, shootAt: 0, burstLeft: 0, burstAt: 0,
      strafeDir: 1, strafeAt: 0, group, barFg, walkPhase: Math.random() * 6,
    };
  });
}

export function hideBots(state) {
  for (const b of state.bots) b.group.visible = false;
}

// Does the bot have line of sight to (x,z) at eye height?
export function canSee(bot, x, z) {
  const dx = x - bot.x, dz = z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist > ENGAGE_RANGE) return false;
  return !segmentBlocked(bot.x, bot.z, x, z);
}

export function stepBots(state, dt, ctx) {
  const p = state.player;
  for (const b of state.bots) {
    if (!b.alive) continue;
    const sees = p.alive && canSee(b, p.pos.x, p.pos.z);
    if (sees) {
      b.lastSeen = state.time;
      b.lastSeenX = p.pos.x; b.lastSeenZ = p.pos.z;
      if (b.state !== 'engage') {
        b.state = 'engage';
        b.shootAt = state.time + REACTION;
        b.burstLeft = 0;
      }
    } else if (b.state === 'engage' && state.time - b.lastSeen > 2.5) {
      b.state = 'investigate';
    }
    // Heard a shot recently: go look.
    if (b.state === 'patrol' && state.time - p.lastNoiseAt < 0.1) {
      const d = Math.hypot(p.noisePos.x - b.x, p.noisePos.z - b.z);
      if (d < 30) { b.state = 'investigate'; b.lastSeenX = p.noisePos.x; b.lastSeenZ = p.noisePos.z; }
    }
    // Low HP: fall back to a home waypoint.
    if (b.hp < 35 && b.state === 'engage') b.state = 'cover';
    if (b.state === 'cover' && b.hp > 60) b.state = 'patrol';

    // Bomb planted: nearest alive bot defuses, others hunt the player.
    if (state.bomb.state === 'planted' || state.bomb.state === 'defusing') {
      const nearest = nearestAliveBot(state, state.bomb.pos.x, state.bomb.pos.z);
      if (nearest === b) b.state = 'defuse';
      else if (b.state === 'defuse') b.state = 'investigate';
    }

    let tx = b.x, tz = b.z, speed = BOT_SPEED;
    if (b.state === 'patrol') {
      const wp = WAYPOINTS[b.wpList[b.wpIdx]];
      tx = wp[0]; tz = wp[1];
      if (Math.hypot(tx - b.x, tz - b.z) < 1.2) b.wpIdx = (b.wpIdx + 1) % b.wpList.length;
    } else if (b.state === 'investigate') {
      tx = b.lastSeenX; tz = b.lastSeenZ;
      if (Math.hypot(tx - b.x, tz - b.z) < 1.5) b.state = 'patrol';
    } else if (b.state === 'cover') {
      const wp = WAYPOINTS[b.wpList[0]];
      tx = wp[0]; tz = wp[1];
      if (Math.hypot(tx - b.x, tz - b.z) < 1.5) b.state = 'patrol';
    } else if (b.state === 'engage') {
      // Strafe sideways while keeping distance 8..18 from the player.
      if (state.time > b.strafeAt) { b.strafeDir *= -1; b.strafeAt = state.time + 1 + Math.random() * 1.5; }
      const dx = p.pos.x - b.x, dz = p.pos.z - b.z;
      const dist = Math.hypot(dx, dz) || 1;
      const px = -dz / dist * b.strafeDir, pz = dx / dist * b.strafeDir;
      const toward = dist > 18 ? 0.7 : dist < 8 ? -0.7 : 0;
      tx = b.x + px * 3 + (dx / dist) * toward * 3;
      tz = b.z + pz * 3 + (dz / dist) * toward * 3;
      speed = BOT_SPEED * 0.8;
    } else if (b.state === 'defuse') {
      tx = state.bomb.pos.x; tz = state.bomb.pos.z;
      const d = Math.hypot(tx - b.x, tz - b.z);
      if (d < 1.2) {
        // Channel the defuse; taking damage interrupts (handled in damageBot).
        state.bomb.state = 'defusing';
        state.bomb.progress += dt / 5;
        ctx.onDefuseProgress(state.bomb.progress);
        if (state.bomb.progress >= 1) {
          state.bomb.state = 'defused';
          ctx.onDefused();
        }
        tx = b.x; tz = b.z;
      }
    }
    // Move toward target.
    _d.x = tx - b.x; _d.z = tz - b.z;
    const dl = Math.hypot(_d.x, _d.z);
    if (dl > 0.05) {
      const mx = (_d.x / dl) * speed * dt, mz = (_d.z / dl) * speed * dt;
      const c = collideCircle(b.x + mx, b.z + mz, 0.42);
      b.x = c.x; b.z = c.z;
      b.yaw = Math.atan2(_d.x, _d.z);
      b.walkPhase += dt * 8;
    }
    // Face the player while engaging.
    if (b.state === 'engage' && sees) {
      b.yaw = Math.atan2(p.pos.x - b.x, p.pos.z - b.z);
    }
    // Shooting: bursts of 3-5 with pauses.
    if (b.state === 'engage' && sees && state.time >= b.shootAt) {
      if (b.burstLeft <= 0) {
        b.burstLeft = 3 + Math.floor(Math.random() * 3);
        b.burstAt = state.time;
        b.shootAt = state.time + 0.9 + Math.random() * 0.7;
      }
      if (b.burstLeft > 0 && state.time >= b.burstAt) {
        b.burstLeft -= 1;
        b.burstAt = state.time + 0.13;
        botShoot(state, b, ctx);
      }
    }
    // Sync the mesh.
    b.group.position.set(b.x, Math.abs(Math.sin(b.walkPhase)) * 0.04, b.z);
    b.group.rotation.y = b.yaw;
    const frac = Math.max(0, b.hp / BOT_HP);
    b.barFg.scale.x = frac;
    b.barFg.position.x = -0.38 * (1 - frac);
    b.barFg.material.color.setHex(frac > 0.5 ? 0x4fd86b : frac > 0.25 ? 0xffb347 : 0xff5a4d);
  }
}

function nearestAliveBot(state, x, z) {
  let best = null, bd = Infinity;
  for (const b of state.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.x - x, b.z - z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function botShoot(state, b, ctx) {
  const p = state.player;
  const ox = b.x, oy = 1.35, oz = b.z;
  const dx = p.pos.x - b.x, dz = p.pos.z - b.z;
  const dist = Math.hypot(dx, dz) || 1;
  // Hit chance falls with distance and with player movement; crouching helps.
  const speed = Math.hypot(p.vel.x, p.vel.z);
  let chance = 0.42 - dist * 0.007 - (speed / 5.4) * 0.16 - (p.crouched ? 0.08 : 0);
  chance = Math.max(0.06, Math.min(0.55, chance));
  const hit = Math.random() < chance;
  const spread = 0.06;
  const ex = p.pos.x + (Math.random() * 2 - 1) * spread * dist * (hit ? 0.2 : 1);
  const ey = p.pos.y + 1.1 + (Math.random() * 2 - 1) * spread * dist * (hit ? 0.2 : 1);
  const ez = p.pos.z + (Math.random() * 2 - 1) * spread * dist * (hit ? 0.2 : 1);
  const len = Math.hypot(ex - ox, ey - oy, ez - oz) || 1;
  const dirx = (ex - ox) / len, diry = (ey - oy) / len, dirz = (ez - oz) / len;
  const wall = rayWalls(ox, oy, oz, dirx, diry, dirz, ctx.colliders);
  const end = Math.min(len, wall === Infinity ? len : wall);
  ctx.effects.tracer(
    { x: ox, y: oy, z: oz },
    { x: ox + dirx * end, y: oy + diry * end, z: oz + dirz * end },
    0xff6b5e,
  );
  ctx.audio.shot('smg', dist);
  if (hit && wall >= len) {
    const dmg = Math.round(9 + Math.random() * 6);
    ctx.damagePlayer(dmg, b);
  }
}

// Damage a bot; returns true if it died. Interrupts a defuse channel.
export function damageBot(state, bot, dmg, head, ctx) {
  if (!bot.alive) return false;
  bot.hp -= dmg;
  if (state.bomb.state === 'defusing') {
    state.bomb.state = 'planted';
    state.bomb.progress = 0;
    ctx.onDefuseProgress(0);
  }
  if (bot.hp <= 0) {
    bot.hp = 0;
    bot.alive = false;
    bot.group.visible = false;
    ctx.onBotKilled(bot, head);
    return true;
  }
  // Getting shot makes the bot notice the player.
  bot.lastSeen = state.time;
  bot.lastSeenX = state.player.pos.x;
  bot.lastSeenZ = state.player.pos.z;
  if (bot.state === 'patrol' || bot.state === 'cover') bot.state = 'investigate';
  return false;
}
