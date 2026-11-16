// main.js — bootstrap and the fixed-step game loop for "Solar Flats".
// Rendering (three.js) and simulation are separate: simulate() advances the
// single state object at 60 Hz; render() only reads it. No per-frame
// allocation in the hot path: scratch vectors live at module scope.
import * as THREE from 'three';
import { freshState, STEP, ROUND_TIME, BOMB_FUSE, PLANT_TIME, BUY_TIME, WIN_ROUNDS, START_MONEY } from './state.js';
import { WEAPONS, GRENADE, freshAmmo, buyPrice } from './weapons.js';
import { buildMap, COLLIDERS, SITES, SPAWN, insideSite } from './map.js';
import { AudioBank } from './audio.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { stepPlayer, startReload, finishReload, buildViewmodel, eyeHeight, grenades, updateGrenades } from './player.js';
import { spawnBots, stepBots, damageBot as damageBotFn } from './bots.js';

const state = freshState();
let ammo = freshAmmo();
const audio = new AudioBank();
const input = {
  forward: false, back: false, left: false, right: false,
  crouch: false, jump: false, firing: false, firedOnce: false, ads: false,
  mouseDX: 0, mouseDY: 0, reloadPressed: false, grenadePressed: false,
  plantHeld: false,
};
const auto = new URLSearchParams(location.search).has('auto');

// --- three.js setup -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x4a3560, 50, 140);
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0x9a7fc0, 0xa8895e, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb347, 2.2);
sun.position.set(28, 42, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -36; sun.shadow.camera.right = 36;
sun.shadow.camera.top = 36; sun.shadow.camera.bottom = -36;
sun.shadow.camera.far = 120;
scene.add(sun);

buildMap(scene);
const effects = new Effects(scene);
const viewmodel = buildViewmodel();
camera.add(viewmodel);

// Bomb prop: a small charge with a blinking light, hidden until planted.
const bombGroup = new THREE.Group();
const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.35), new THREE.MeshLambertMaterial({ color: 0x222222 }));
const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
bombLight.position.set(0.2, 0.16, 0);
bombGroup.add(bombBody, bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

// Grenade meshes (pool of 3, synced to the simulated grenades).
const grenadeMeshes = [];
for (let i = 0; i < 3; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshLambertMaterial({ color: 0x2e4a2e }));
  m.visible = false;
  scene.add(m);
  grenadeMeshes.push(m);
}

// Site labels: floating text sprites made from canvas (no assets).
function makeLabel(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,10,16,0.55)';
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = color;
  g.font = 'bold 44px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  s.scale.set(5.2, 0.95, 1);
  return s;
}
for (const key of ['A', 'B']) {
  const s = SITES[key];
  const label = makeLabel(key === 'A' ? 'A · SOLAR ARRAY' : 'B · WATER PLANT', key === 'A' ? '#ffb347' : '#4fd8c8');
  label.position.set(s.x, 3.6, s.z);
  scene.add(label);
}

const hud = new Hud({
  onPlay: () => startMatch(),
  onBuyClose: () => { if (state.phase === 'buy') hud.showOverlay(null); },
  onBuy: (key) => buyItem(key),
  onRestart: () => restartMatch(),
});

// --- input ----------------------------------------------------------------
const KEYMAP = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ControlLeft: 'crouch', ControlRight: 'crouch', KeyC: 'crouch',
};
addEventListener('keydown', (e) => {
  if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
  if (KEYMAP[e.code]) input[e.code === 'KeyC' || e.code.startsWith('Control') ? 'crouch' : KEYMAP[e.code]] = true;
  if (e.code === 'KeyR') input.reloadPressed = true;
  if (e.code === 'KeyG') input.grenadePressed = true;
  if (e.code === 'KeyE') input.plantHeld = true;
  if (e.code === 'KeyB' && state.phase === 'buy') { hud.showOverlay('buy'); hud.refreshBuy(state, ammo); }
  if (e.code.startsWith('Digit')) {
    const order = ['pistol', 'smg', 'rifle', 'marksman'];
    const w = order[Number(e.code.slice(5)) - 1];
    if (w && state.player.weapon !== w) { state.player.weapon = w; }
  }
  if (e.code === 'Enter' && state.phase === 'title') startMatch();
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') input.jump = false;
  if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false;
  if (e.code === 'KeyE') input.plantHeld = false;
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement || auto) {
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  }
});
renderer.domElement.addEventListener('mousedown', (e) => {
  if (state.phase !== 'play') return;
  audio.ensure();
  if (e.button === 0) { input.firing = true; input.firedOnce = false; }
  if (e.button === 2) input.ads = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.firing = false;
  if (e.button === 2) input.ads = false;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && state.phase === 'play' && !auto) {
    // Lost the lock mid-round: pause into the buy overlay only if in buy.
    hud.showOverlay(null);
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- simulation context shared with player/bots ---------------------------
const ctx = {
  ammo, colliders: COLLIDERS, bots: state.bots, effects, audio,
  damageBot(bot, dmg, head, st) {
    const died = damageBotFn(st, bot, dmg, head, ctx);
    if (died) onBotKilled(bot, head);
  },
  damagePlayer(dmg, bot) { damagePlayer(dmg); },
  onHitmarker: (head) => hud.hitmarker(head),
  onBotKilled: (bot, head) => onBotKilled(bot, head),
  onDefuseProgress: (frac) => { /* HUD reads state.bomb.progress directly */ },
  onDefused: () => endRound('foes', 'The charge was defused.'),
  explodeGrenade: (g) => explodeGrenade(g),
};

// --- match / round flow ----------------------------------------------------
function startMatch() {
  audio.ensure();
  state.score = { you: 0, foes: 0 };
  state.round = 1;
  state.money = START_MONEY;
  state.kills = 0; state.deaths = 0;
  state.stats = { shots: 0, hits: 0, headshots: 0 };
  ammo = freshAmmo();
  ctx.ammo = ammo;
  state.player.weapon = 'rifle';
  state.player.grenades = 1;
  startRound();
}

function restartMatch() { startMatch(); }

function startRound() {
  const p = state.player;
  p.pos.x = SPAWN.x; p.pos.z = SPAWN.z; p.pos.y = 0;
  p.vel.x = 0; p.vel.z = 0; p.vy = 0;
  p.yaw = SPAWN.yaw; p.pitch = 0;
  p.hp = 100; p.alive = true; p.crouched = false;
  p.spread = 0; p.recoil = 0;
  // Refill the current mag from reserve; reserves stay as bought.
  for (const k of Object.keys(ammo)) {
    const a = ammo[k];
    a.reloading = false;
    const need = WEAPONS[k].mag - a.mag;
    const take = Math.min(need, a.reserve);
    a.mag += take; a.reserve -= take;
  }
  state.bomb = { state: 'carried', site: null, progress: 0, fuse: 0, pos: null };
  bombGroup.visible = false;
  grenades.length = 0;
  // Respawn bots.
  for (const b of state.bots) scene.remove(b.group);
  spawnBots(state, scene);
  ctx.bots = state.bots;
  state.roundTimer = ROUND_TIME;
  state.buyTimer = BUY_TIME;
  state.phase = 'buy';
  state.message = `ROUND ${state.round} — BUY PHASE`;
  state.messageAt = state.time;
  hud.showOverlay('buy');
  hud.refreshBuy(state, ammo);
  if (!auto) renderer.domElement.requestPointerLock?.();
}

function buyItem(key) {
  if (state.phase !== 'buy') return;
  if (key === 'ammo') {
    if (state.money < 200) return;
    state.money -= 200;
    for (const k of Object.keys(ammo)) ammo[k].reserve = WEAPONS[k].reserveMax;
    hud.refreshBuy(state, ammo);
    audio.beep();
    return;
  }
  if (key === 'armor') {
    if (state.money < 650 || state.player.armor >= 50) return;
    state.money -= 650;
    state.player.armor = 50;
    hud.refreshBuy(state, ammo);
    audio.beep();
    return;
  }
  if (key === 'grenade') {
    if (state.money < GRENADE.price || state.player.grenades >= 3) return;
    state.money -= GRENADE.price;
    state.player.grenades += 1;
    hud.refreshBuy(state, ammo);
    audio.beep();
    return;
  }
  const w = WEAPONS[key];
  if (!w || state.money < w.price) return;
  if (state.player.weapon !== key) {
    state.money -= w.price;
    state.player.weapon = key;
    ammo[key].mag = w.mag;
    ammo[key].reserve = w.reserveMax;
  } else {
    // Already owned: top up reserve for half price.
    const top = Math.floor(w.price / 2);
    if (state.money < top) return;
    state.money -= top;
    ammo[key].reserve = w.reserveMax;
  }
  hud.refreshBuy(state, ammo);
  audio.beep();
}

function onBotKilled(bot, head) {
  state.kills += 1;
  state.money += 300;
  const line = head ? `You ▸ ${bot.name} (headshot) +$300` : `You ▸ ${bot.name} +$300`;
  state.feed.push({ text: line, at: state.time });
  hud.feed(line);
  audio.tone(1200, 0.08, 'square', 0.15);
  if (state.bots.every((b) => !b.alive)) {
    endRound('you', state.bomb.state === 'planted' ? 'All defenders down — the charge will detonate.' : 'All defenders eliminated.');
  }
}

function damagePlayer(dmg) {
  const p = state.player;
  if (!p.alive) return;
  let rest = dmg;
  if (p.armor > 0) {
    const absorbed = Math.min(p.armor, Math.round(dmg * 0.5));
    p.armor -= absorbed;
    rest -= absorbed;
  }
  p.hp -= rest;
  state.shake = 0.5;
  audio.hurt();
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    state.deaths += 1;
    hud.feed('You were eliminated');
    endRound('foes', 'You were eliminated.');
  }
}

function explodeGrenade(g) {
  effects.explosion({ x: g.x, y: Math.max(0.4, g.y), z: g.z }, GRENADE.radius);
  audio.explosion();
  const p = state.player;
  const pd = Math.hypot(p.pos.x - g.x, p.pos.z - g.z);
  if (pd < GRENADE.radius && p.alive) damagePlayer(Math.round(GRENADE.damage * (1 - pd / GRENADE.radius)));
  for (const b of state.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.x - g.x, b.z - g.z);
    if (d < GRENADE.radius) {
      const dmg = Math.round(GRENADE.damage * (1 - d / GRENADE.radius * 0.7));
      const died = damageBotFn(state, b, dmg, false, ctx);
      if (died) onBotKilled(b, false);
    }
  }
  const pd2 = Math.hypot(p.pos.x - g.x, p.pos.z - g.z);
  if (pd2 < 12) state.shake = 0.8;
}

function endRound(winner, reason) {
  if (state.phase !== 'play' && state.phase !== 'buy') return;
  state.phase = 'roundEnd';
  state.roundWinner = winner;
  state.roundReason = reason;
  if (winner === 'you') { state.score.you += 1; state.money += 1400; audio.win(); }
  else { state.score.foes += 1; state.money += 800; audio.lose(); }
  state.roundEndAt = state.time;
  document.exitPointerLock?.();
  hud.roundEnd(state);
}

function nextAfterRound() {
  if (state.score.you >= WIN_ROUNDS || state.score.foes >= WIN_ROUNDS) {
    state.phase = 'matchEnd';
    hud.matchEnd(state);
    return;
  }
  state.round += 1;
  startRound();
}

// --- fixed-step simulation --------------------------------------------------
function simulate(dt) {
  state.time += dt;
  if (state.phase === 'buy') {
    state.buyTimer -= dt;
    if (state.buyTimer <= 0) {
      state.phase = 'play';
      hud.showOverlay(null);
      state.message = 'PLANT THE CHARGE AT A OR B';
      state.messageAt = state.time;
      if (!auto) renderer.domElement.requestPointerLock?.();
    }
    return;
  }
  if (state.phase === 'roundEnd') {
    if (state.time - state.roundEndAt > 3.5) nextAfterRound();
    return;
  }
  if (state.phase !== 'play') return;
  // Round timer.
  state.roundTimer -= dt;
  if (state.roundTimer <= 0) {
    if (state.bomb.state === 'planted' || state.bomb.state === 'defusing') {
      // Fuse decides it; timer no longer matters.
    } else {
      endRound('foes', 'Time expired — the charge was never planted.');
      return;
    }
  }
  // Reload completion.
  const a = ammo[state.player.weapon];
  if (a.reloading && state.time >= a.reloadEnd) finishReload(state, ctx);
  // Planting: hold E inside a site while carrying the charge.
  const p = state.player;
  if (p.alive && state.bomb.state === 'carried' && input.plantHeld) {
    const site = insideSite(p.pos.x, p.pos.z, 'A') ? 'A' : insideSite(p.pos.x, p.pos.z, 'B') ? 'B' : null;
    if (site) {
      state.bomb.state = 'planting';
      state.bomb.site = site;
      state.bomb.progress += dt / PLANT_TIME;
      if (Math.floor(state.bomb.progress * 10) !== Math.floor((state.bomb.progress - dt / PLANT_TIME) * 10)) audio.beep();
      if (state.bomb.progress >= 1) {
        state.bomb.state = 'planted';
        state.bomb.fuse = BOMB_FUSE;
        state.bomb.pos = { x: SITES[site].x, z: SITES[site].z };
        state.money += 300;
        bombGroup.visible = true;
        bombGroup.position.set(SITES[site].x, 0.15, SITES[site].z);
        audio.plant();
        state.message = `CHARGE PLANTED AT SITE ${site} — DEFEND IT`;
        state.messageAt = state.time;
        hud.feed(`Charge planted at Site ${site} +$300`);
      }
    } else {
      state.bomb.state = 'carried';
      state.bomb.progress = 0;
    }
  } else if (state.bomb.state === 'planting') {
    state.bomb.state = 'carried';
    state.bomb.progress = 0;
  }
  // Bomb fuse.
  if (state.bomb.state === 'planted' || state.bomb.state === 'defusing') {
    state.bomb.fuse -= dt;
    bombLight.material.color.setHex(Math.floor(state.time * 4) % 2 === 0 ? 0xff2222 : 0x881111);
    if (state.bomb.fuse <= 0) {
      state.bomb.state = 'exploded';
      effects.explosion({ x: state.bomb.pos.x, y: 1, z: state.bomb.pos.z }, 9);
      audio.explosion();
      endRound('you', 'The charge detonated — Site destroyed.');
      return;
    }
  }
  stepPlayer(state, input, dt, ctx);
  stepBots(state, dt, ctx);
  updateGrenades(state, dt, ctx);
  // Semi-auto trigger reset.
  if (!input.firing) input.firedOnce = false;
  else if (state.player.lastShotAt === state.time) input.firedOnce = true;
}

// --- render -----------------------------------------------------------------
const _eye = new THREE.Vector3();
let bobPhase = 0;
function render() {
  const p = state.player;
  const speed = Math.hypot(p.vel.x, p.vel.z);
  if (speed > 0.5 && p.onGround) bobPhase += 0.09 * (speed / 5.4);
  const bobY = Math.sin(bobPhase * 2) * 0.025 * (speed / 5.4);
  const bobX = Math.cos(bobPhase) * 0.015 * (speed / 5.4);
  _eye.set(p.pos.x, p.pos.y + eyeHeight(p) + bobY, p.pos.z);
  camera.position.copy(_eye);
  const shake = state.shake || 0;
  camera.rotation.y = p.yaw + (Math.random() * 2 - 1) * shake * 0.02
    + (state.phase === 'title' ? Math.sin(state.time * 0.12) * 0.35 : 0);
  camera.rotation.x = p.pitch + p.recoil * 0.035 + (Math.random() * 2 - 1) * shake * 0.02;
  camera.rotation.z = bobX;
  // Viewmodel: recoil kick + ADS centring + walk bob.
  viewmodel.position.set(
    input.ads ? 0 : 0.0,
    input.ads ? -0.155 : -0.055 + Math.sin(bobPhase * 2) * 0.006,
    (input.ads ? -0.12 : 0) + p.recoil * 0.09,
  );
  viewmodel.rotation.x = p.recoil * 0.12;
  viewmodel.visible = p.alive && (state.phase === 'play' || state.phase === 'buy');
  // Grenade meshes follow the simulated grenades.
  for (let i = 0; i < grenadeMeshes.length; i++) {
    const g = grenades[i];
    grenadeMeshes[i].visible = !!g;
    if (g) grenadeMeshes[i].position.set(g.x, g.y, g.z);
  }
  effects.update(1 / 60);
  hud.update(state, ammo, input);
  renderer.render(scene, camera);
}

// --- main loop: fixed-step accumulator --------------------------------------
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 5) {
    simulate(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === 5) acc = 0;
  render();
}
requestAnimationFrame(frame);

// --- test / screenshot hook -------------------------------------------------
// window.__game lets an automated play-test drive the game without a mouse:
// start the match, teleport, aim at the nearest bot, open the buy menu, etc.
window.__game = {
  state, input,
  get ammo() { return ammo; },
  start: () => startMatch(),
  teleport(x, z, yaw = 0) {
    state.player.pos.x = x; state.player.pos.z = z;
    state.player.yaw = yaw; state.player.pitch = 0;
  },
  aimAtNearestBot() {
    let best = null, bd = Infinity;
    for (const b of state.bots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - state.player.pos.x, b.z - state.player.pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return false;
    const dx = best.x - state.player.pos.x, dz = best.z - state.player.pos.z;
    state.player.yaw = Math.atan2(-dx, -dz);
    const dy = 1.3 - (state.player.pos.y + eyeHeight(state.player));
    state.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return true;
  },
  openBuy() { if (state.phase === 'buy') { hud.showOverlay('buy'); hud.refreshBuy(state, ammo); } },
  plantNow() {
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.fuse = BOMB_FUSE;
    state.bomb.pos = { x: SITES.A.x, z: SITES.A.z };
    bombGroup.visible = true;
    bombGroup.position.set(SITES.A.x, 0.15, SITES.A.z);
  },
  endRoundForShot() { endRound('you', 'All defenders eliminated.'); },
};

// Autoplay mode (?auto=1): start straight into the buy phase so a headless
// browser can capture the game without pointer lock.
if (auto) {
  setTimeout(() => { startMatch(); }, 300);
}
