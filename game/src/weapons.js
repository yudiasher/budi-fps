// weapons.js — every weapon's numbers in one table, plus ammo state.
// Damage, spread and recoil are the gunplay levers: stopping to aim pays,
// spraying on the move does not.
export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', short: 'P9', price: 0,
    damage: 26, headMult: 2.0, mag: 12, reserveMax: 48,
    fireInterval: 0.28, reloadTime: 1.1, auto: false,
    spreadBase: 0.010, spreadMove: 0.030, spreadAir: 0.045, spreadBloom: 0.020,
    recoilKick: 0.35, recoilRecover: 2.2, range: 60, falloff: 0.55,
    tracer: 0xffd27a, sound: 'pistol',
  },
  smg: {
    name: 'Hornet-9 SMG', short: 'H9', price: 900,
    damage: 22, headMult: 1.8, mag: 32, reserveMax: 96,
    fireInterval: 0.085, reloadTime: 1.6, auto: true,
    spreadBase: 0.016, spreadMove: 0.034, spreadAir: 0.05, spreadBloom: 0.028,
    recoilKick: 0.22, recoilRecover: 3.0, range: 45, falloff: 0.45,
    tracer: 0xffe9a8, sound: 'smg',
  },
  rifle: {
    name: 'VK-7 Carbine', short: 'VK-7', price: 1200,
    damage: 34, headMult: 2.0, mag: 30, reserveMax: 90,
    fireInterval: 0.115, reloadTime: 2.0, auto: true,
    spreadBase: 0.008, spreadMove: 0.028, spreadAir: 0.042, spreadBloom: 0.022,
    recoilKick: 0.30, recoilRecover: 2.6, range: 80, falloff: 0.6,
    tracer: 0xffc46b, sound: 'rifle',
  },
  marksman: {
    name: 'Longbow DMR', short: 'LB', price: 2400,
    damage: 72, headMult: 2.2, mag: 8, reserveMax: 24,
    fireInterval: 0.85, reloadTime: 2.6, auto: false,
    spreadBase: 0.004, spreadMove: 0.05, spreadAir: 0.07, spreadBloom: 0.05,
    recoilKick: 0.9, recoilRecover: 1.6, range: 100, falloff: 0.8,
    tracer: 0x9be8ff, sound: 'dmr',
  },
};

export const GRENADE = {
  name: 'Spark Grenade', price: 300, damage: 95, radius: 6.5, fuse: 1.4,
};

// Ammo is per-weapon and lives on the player object; this builds it.
export function freshAmmo() {
  const ammo = {};
  for (const key of Object.keys(WEAPONS)) {
    const w = WEAPONS[key];
    ammo[key] = { mag: w.mag, reserve: w.reserveMax, reloading: false, reloadEnd: 0 };
  }
  return ammo;
}

export function buyPrice(key) {
  if (key === 'grenade') return GRENADE.price;
  if (key === 'armor') return 650;
  return WEAPONS[key] ? WEAPONS[key].price : 0;
}
