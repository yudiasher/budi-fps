// state.js — the one place all game state lives.
// Every module reads or mutates this single object; nothing else holds
// long-lived game state. Fixed-step simulation (1/60 s) advances it in
// main.js; rendering only reads it.
export const STEP = 1 / 60;
export const ROUND_TIME = 100; // seconds per round
export const BOMB_FUSE = 40; // seconds after planting before detonation
export const PLANT_TIME = 3.5; // seconds holding E at a site to plant
export const DEFUSE_TIME = 5; // seconds a bot channels to defuse
export const BUY_TIME = 15; // seconds of buy phase at each round start
export const WIN_ROUNDS = 5; // first to this many round wins takes the match
export const START_MONEY = 800;

export function freshState() {
  return {
    phase: 'title', // title | buy | play | roundEnd | matchEnd
    time: 0, // total simulated seconds
    round: 1,
    roundTimer: ROUND_TIME,
    buyTimer: BUY_TIME,
    score: { you: 0, foes: 0 },
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    bomb: {
      state: 'carried', // carried | planting | planted | defusing | exploded | defused
      site: null, // 'A' | 'B' | null
      progress: 0, // 0..1 planting/defusing progress
      fuse: 0, // seconds left once planted
      pos: null, // {x,z} where planted
    },
    player: {
      pos: { x: 0, y: 0, z: 20 },
      vel: { x: 0, z: 0 },
      yaw: 0, // facing, radians; 0 = -Z (north, toward mid)
      pitch: 0,
      hp: 100,
      armor: 0,
      crouched: false,
      onGround: true,
      vy: 0,
      alive: true,
      weapon: 'rifle',
      grenades: 1,
      spread: 0, // current bloom 0..1
      recoil: 0, // current recoil kick 0..1
      lastShotAt: -99,
      lastNoiseAt: -99, // when the player last fired (bots hear it)
      noisePos: { x: 0, z: 0 },
      planting: false,
    },
    bots: [], // filled by bots.js spawnBots()
    feed: [], // kill-feed lines {text, at}
    message: '', // centre-screen banner text
    messageAt: -99,
    roundWinner: null, // 'you' | 'foes' | null
    roundReason: '',
    shake: 0, // camera shake amount
    stats: { shots: 0, hits: 0, headshots: 0 },
  };
}

// One shared scratch area so hot loops never allocate.
export const tmp = {
  dx: 0, dz: 0, dist: 0,
};
