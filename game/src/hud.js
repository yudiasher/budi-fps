// hud.js — everything drawn in DOM over the canvas: health, ammo, timer,
// score, money, kill feed, bomb status and the buy menu. The 3D canvas
// never draws UI; this module owns the DOM.
import { WEAPONS, GRENADE } from './weapons.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor(callbacks) {
    this.cb = callbacks; // {onPlay, onBuy, onRestart, onResume}
    this.hitTimer = 0;
    this.last = {};
    this.bind();
  }

  bind() {
    $('play').addEventListener('click', () => this.cb.onPlay());
    $('buy-close').addEventListener('click', () => this.cb.onBuyClose());
    $('restart').addEventListener('click', () => this.cb.onRestart());
    $('again').addEventListener('click', () => this.cb.onRestart());
    document.querySelectorAll('[data-buy]').forEach((el) => {
      el.addEventListener('click', () => this.cb.onBuy(el.dataset.buy));
    });
  }

  set(id, text) {
    if (this.last[id] !== text) { this.last[id] = text; $(id).textContent = text; }
  }

  showOverlay(name) {
    for (const id of ['overlay', 'buy', 'roundend', 'matchend']) $(id).hidden = name !== id;
    if (name === null) for (const id of ['overlay', 'buy', 'roundend', 'matchend']) $(id).hidden = true;
  }

  // Called every frame with the current state; cheap text updates only
  // when a value actually changed.
  update(state, ammo, input) {
    const p = state.player;
    const w = WEAPONS[p.weapon];
    this.set('hp-num', String(Math.max(0, Math.ceil(p.hp))));
    $('hp-fill').style.width = `${Math.max(0, p.hp)}%`;
    $('hp-fill').style.background = p.hp > 50 ? '#4fd86b' : p.hp > 25 ? '#ffb347' : '#ff5a4d';
    this.set('armor-num', p.armor > 0 ? `ARMOR ${Math.ceil(p.armor)}` : '');
    const a = ammo[p.weapon];
    this.set('ammo-mag', String(a.mag));
    this.set('ammo-reserve', `/ ${a.reserve}`);
    $('ammo').classList.toggle('empty', a.mag === 0);
    this.set('ammo-weapon', w.short);
    this.set('timer', state.phase === 'buy' ? `BUY ${Math.ceil(state.buyTimer)}` : fmtTime(state.roundTimer));
    this.set('score-you', String(state.score.you));
    this.set('score-foes', String(state.score.foes));
    this.set('round-num', `ROUND ${state.round}`);
    this.set('money', `$${state.money}`);
    this.set('grenades', `GRENADES ${p.grenades}`);
    this.set('kills', `KILLS ${state.kills}`);
    // Bomb banner.
    let bombText = '';
    if (state.bomb.state === 'carried') bombText = 'PLANT THE CHARGE AT SITE A OR B — HOLD E';
    else if (state.bomb.state === 'planting') bombText = `PLANTING… ${Math.round(state.bomb.progress * 100)}%`;
    else if (state.bomb.state === 'planted') bombText = `CHARGE PLANTED — DETONATES IN ${Math.ceil(state.bomb.fuse)}s — DEFEND IT`;
    else if (state.bomb.state === 'defusing') bombText = `ENEMY DEFUSING! ${Math.round(state.bomb.progress * 100)}% — STOP THEM`;
    this.set('bomb', bombText);
    $('bomb').hidden = bombText === '';
    // Plant progress ring (a bar).
    $('plant-fill').style.width = `${Math.round(state.bomb.progress * 100)}%`;
    $('plant').hidden = !(state.bomb.state === 'planting' || state.bomb.state === 'defusing');
    // Centre message.
    if (state.message && state.time - state.messageAt < 3) {
      this.set('banner', state.message);
      $('banner').hidden = false;
    } else $('banner').hidden = true;
    // Reload indicator.
    $('reload').hidden = !a.reloading;
    // Hitmarker fade.
    if (this.hitTimer > 0) this.hitTimer -= 1 / 60;
    $('hitmarker').classList.toggle('on', this.hitTimer > 0);
    // Crosshair spread: gap grows with movement bloom.
    const gap = 4 + p.spread * 14 + (Math.hypot(p.vel.x, p.vel.z) / 5.4) * 6;
    $('crosshair').style.setProperty('--gap', `${gap.toFixed(1)}px`);
    // Low HP vignette.
    $('vignette').style.opacity = p.hp < 35 ? String((35 - p.hp) / 35 * 0.7) : '0';
  }

  hitmarker(head) {
    this.hitTimer = 0.18;
    $('hitmarker').classList.toggle('head', head);
  }

  feed(text) {
    const el = $('feed');
    const line = document.createElement('div');
    line.textContent = text;
    el.prepend(line);
    while (el.children.length > 5) el.removeChild(el.lastChild);
    setTimeout(() => line.remove(), 6000);
  }

  refreshBuy(state, ammo) {
    this.set('buy-money', `$${state.money}`);
    for (const el of document.querySelectorAll('[data-buy]')) {
      const key = el.dataset.buy;
      const price = key === 'grenade' ? GRENADE.price : key === 'armor' ? 650 : key === 'ammo' ? 200 : WEAPONS[key].price;
      const owned = key === 'grenade' ? state.player.grenades >= 3 : key === 'armor' ? state.player.armor >= 50 : state.player.weapon === key;
      el.querySelector('.price').textContent = owned ? 'OWNED' : `$${price}`;
      el.classList.toggle('cant', state.money < price && !owned);
      el.classList.toggle('owned', owned);
    }
    this.set('buy-ammo', `Ammo: ${Object.keys(WEAPONS).map((k) => `${WEAPONS[k].short} ${ammo[k].mag}/${ammo[k].reserve}`).join('  ')}`);
  }

  roundEnd(state) {
    $('roundend-title').textContent = state.roundWinner === 'you' ? 'ROUND WON' : 'ROUND LOST';
    $('roundend-title').style.color = state.roundWinner === 'you' ? '#4fd86b' : '#ff5a4d';
    $('roundend-copy').textContent = state.roundReason;
    $('roundend-score').textContent = `YOU ${state.score.you} — ${state.score.foes} FOES`;
    this.showOverlay('roundend');
  }

  matchEnd(state) {
    $('matchend-title').textContent = state.score.you > state.score.foes ? 'MATCH WON' : 'MATCH LOST';
    $('matchend-copy').textContent = `Final score — You ${state.score.you}, Foes ${state.score.foes}. ${state.score.you > state.score.foes ? 'Solar Flats is yours, operative.' : 'The defenders held the compound. Run it back.'}`;
    this.showOverlay('matchend');
  }
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
