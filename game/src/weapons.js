// The guns, as data, and the one resolver that puts a bullet somewhere. A weapon here owns its
// numbers: rate of fire, magazine, damage by body part, recoil, spread by stance and speed, and
// whether it penetrates. main.js asks for a shot and gets back what it hit; the view model is a
// separate concern and lives in viewmodel.js.
//
// Guns are intentionally not named after any commercial game's: Ranger, Hound, Warden, Kestrel.
export const WEAPONS = {
  ranger: {
    id: 'ranger',
    name: 'Ranger',
    slot: 'primary',
    price: 2700,
    automatic: true,
    damage: { head: 108, chest: 33, legs: 23 },
    // Damage falls off past `falloffStart` metres down to `falloffMin` of the base at 40 m.
    falloffStart: 18,
    falloffMin: 0.62,
    mag: 30,
    reserve: 90,
    fireGap: 0.099,
    reloadTime: 2.15,
    spread: { still: 0.0022, walk: 0.012, run: 0.031, air: 0.06, crouch: 0.0014 },
    recoil: { pitch: 0.0088, yaw: 0.0034, recover: 7.4 },
    penetration: 0.42,
    range: 90,
  },
  hound: {
    id: 'hound',
    name: 'Hound',
    slot: 'primary',
    price: 1800,
    automatic: true,
    damage: { head: 122, chest: 30, legs: 20 },
    falloffStart: 9,
    falloffMin: 0.45,
    mag: 12,
    reserve: 36,
    fireGap: 0.29,
    reloadTime: 2.5,
    spread: { still: 0.0016, walk: 0.008, run: 0.024, air: 0.05, crouch: 0.001 },
    recoil: { pitch: 0.021, yaw: 0.006, recover: 6.2 },
    penetration: 0.5,
    range: 70,
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    slot: 'primary',
    price: 3200,
    automatic: true,
    damage: { head: 152, chest: 41, legs: 26 },
    falloffStart: 26,
    falloffMin: 0.78,
    mag: 10,
    reserve: 30,
    fireGap: 0.38,
    reloadTime: 3.1,
    spread: { still: 0.0012, walk: 0.009, run: 0.034, air: 0.07, crouch: 0.0009 },
    recoil: { pitch: 0.027, yaw: 0.004, recover: 5.6 },
    penetration: 0.78,
    range: 100,
  },
  kestrel: {
    id: 'kestrel',
    name: 'Kestrel',
    slot: 'primary',
    price: 1500,
    automatic: false,
    damage: { head: 128, chest: 29, legs: 19 },
    falloffStart: 12,
    falloffMin: 0.5,
    mag: 20,
    reserve: 60,
    fireGap: 0.13,
    reloadTime: 2.0,
    spread: { still: 0.0018, walk: 0.009, run: 0.026, air: 0.05, crouch: 0.0012 },
    recoil: { pitch: 0.014, yaw: 0.005, recover: 7.0 },
    penetration: 0.55,
    range: 80,
  },
  // The sidearm is what a player always has, so a lost buy is never a lost round.
  sidearm: {
    id: 'sidearm',
    name: 'Sidearm',
    slot: 'secondary',
    price: 0,
    automatic: false,
    damage: { head: 96, chest: 26, legs: 17 },
    falloffStart: 14,
    falloffMin: 0.55,
    mag: 12,
    reserve: 48,
    fireGap: 0.17,
    reloadTime: 1.7,
    spread: { still: 0.0034, walk: 0.013, run: 0.03, air: 0.06, crouch: 0.0026 },
    recoil: { pitch: 0.012, yaw: 0.004, recover: 8.2 },
    penetration: 0.28,
    range: 50,
  },
};

export const BUY_LIST = {
  pistol: [{ id: 'sidearm', price: 0, label: 'Sidearm (always carried)' }],
  primary: [
    { id: 'kestrel', price: 1500 },
    { id: 'hound', price: 1800 },
    { id: 'ranger', price: 2700 },
    { id: 'warden', price: 3200 },
  ],
  gear: [
    { id: 'armor', price: 650, label: 'Armour vest' },
    { id: 'grenade', price: 300, label: 'Frag charge' },
    { id: 'kit', price: 400, label: 'Defuse kit' },
  ],
};

export const GRENADE = {
  id: 'grenade',
  fuse: 2.1,
  throwSpeed: 17,
  radius: 7.5,
  maxDamage: 78,
  minDamage: 8,
};

export const ARMOR = { absorb: 0.5, points: 100 };

// How far a shot's spread opens the crosshair, in radians, for the HUD to mirror.
export function shotSpread(weapon, body) {
  if (!body.onGround) return weapon.spread.air;
  if (body.crouching) return weapon.spread.crouch;
  if (body.walking) return weapon.spread.walk;
  if (body.speed > 1.2) return weapon.spread.run;
  return weapon.spread.still;
}

// A weapon instance holds only what changes between rounds: rounds in the magazine, the reserve,
// the cooldown and the reload timer.
export function makeWeapon(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
  };
}

export function refillWeapon(inst) {
  inst.mag = inst.def.mag;
  inst.reserve = inst.def.reserve;
  inst.cooldown = 0;
  inst.reloadLeft = 0;
  inst.flash = 0;
  inst.kick = 0;
}

export function stepWeapon(inst, dt) {
  inst.cooldown = Math.max(0, inst.cooldown - dt);
  inst.flash = Math.max(0, inst.flash - dt);
  inst.kick += (0 - inst.kick) * Math.min(1, dt * 14);
  if (inst.reloadLeft > 0) {
    inst.reloadLeft = Math.max(0, inst.reloadLeft - dt);
    if (inst.reloadLeft === 0) {
      const need = inst.def.mag - inst.mag;
      const take = Math.min(need, inst.reserve);
      inst.mag += take;
      inst.reserve -= take;
    }
  }
}

export function canFire(inst) {
  return inst.mag > 0 && inst.cooldown === 0 && inst.reloadLeft === 0;
}

export function startReload(inst) {
  if (inst.reloadLeft > 0) return false;
  if (inst.mag === inst.def.mag || inst.reserve === 0) return false;
  inst.reloadLeft = inst.def.reloadTime;
  return true;
}

export function takeRound(inst) {
  if (inst.mag <= 0) return false;
  inst.mag -= 1;
  return true;
}

// The damage a hit at this distance does to this body part, before armour.
export function damageAt(def, part, distance) {
  const base = def.damage[part] ?? def.damage.chest;
  if (distance <= def.falloffStart) return base;
  const t = Math.min(1, (distance - def.falloffStart) / (40 - def.falloffStart));
  return base * (1 - t + t * def.falloffMin);
}
