// The match: one player, nine bots, one map, one round at a time. It owns the roster and the
// simulation, and it is the object bots.js and round.js call back into. Anything the HUD or the
// audio needs to know leaves here through callbacks, so neither of them reads a body's internals.
import * as THREE from 'three';
import { createWorld } from './world.js';
import { createBody, hitboxes } from './player.js';
import { makeBot, stepBot, setRoute, hear, inSite, routePoints } from './bots.js';
import { SPAWNS, SITES, ROUTES } from './map.js';
import { WEAPONS, BUY_LIST, makeWeapon, refillWeapon, canFire, takeRound, stepWeapon, startReload, shotSpread, damageAt, GRENADE } from './weapons.js';
import { createRound, throwGrenade, stepGrenade, grenadeBlast, armourAbsorb, ROUND } from './round.js';
import { SIDES } from './palette.js';

const RAID_BOTS = 4;
const WATCH_BOTS = 5;
const RAID_LOADOUT = ['ranger', 'kestrel', 'ranger', 'hound'];
const WATCH_LOADOUT = ['ranger', 'warden', 'kestrel', 'hound', 'ranger'];
const BOT_NAMES_RAID = ['Vesper', 'Kestrel', 'Marlow', 'Ridge'];
const BOT_NAMES_WATCH = ['Anvil', 'Cinder', 'Hollis', 'Pike', 'Tarn'];

export function createMatch({ scene, hud, audio, effects, camera, onEvent }) {
  const built = createWorld(scene);
  const { colliders } = built;

  const materials = {
    raid: new THREE.MeshStandardMaterial({ color: new THREE.Color(SIDES.raid), roughness: 0.72, metalness: 0.05 }),
    watch: new THREE.MeshStandardMaterial({ color: new THREE.Color(SIDES.watch), roughness: 0.72, metalness: 0.05 }),
    hairline: new THREE.MeshStandardMaterial({ color: new THREE.Color('#241f1a'), roughness: 0.85, metalness: 0.1 }),
  };

  const botGroup = new THREE.Group();
  scene.add(botGroup);

  const bots = [];
  const playerBody = createBody(colliders, { x: SPAWNS.raid[0].x, z: SPAWNS.raid[0].z, yaw: 0 });
  const player = playerBody;
  player.body = playerBody;
  player.side = 'raid';
  player.name = 'You';
  player.health = 100;
  player.armour = 0;
  player.grenades = 0;
  player.hasKit = false;
  player.weapons = { primary: null, secondary: makeWeapon(WEAPONS.sidearm) };
  player.active = 'secondary';
  player.carrying = false;
  player.planting = 0;
  player.defusing = 0;

  const state = {
    grenades: [],
    // What the simulation needs to answer "what is between these two points".
    colliders,
    charge: null,
    deadBots: [],
  };

  const roundApi = createRound({ hud, audio });
  const roundState = roundApi.state;

  // ---- The world interface bots.js and round.js talk to -------------------------------------

  const world = {
    colliders,
    player,
    charge: roundState.charge,
    get round() {
      return roundState;
    },
    enemiesOf(side) {
      if (side === 'raid') return bots.filter((b) => b.side === 'watch');
      return [player, ...bots.filter((b) => b.side === 'raid')];
    },
    alliesOf(side) {
      if (side === 'raid') return [player, ...bots.filter((b) => b.side === 'raid')];
      return bots.filter((b) => b.side === 'watch');
    },
    aliveCount(side) {
      if (side === 'raid') return (player.alive ? 1 : 0) + bots.filter((b) => b.side === 'raid' && b.alive).length;
      return bots.filter((b) => b.side === 'watch' && b.alive).length;
    },
    routeTo(siteId, side) {
      const prefix = side === 'raid' ? 'mid-to-' : 'defend-';
      return routePoints(`${prefix}${siteId.toLowerCase()}`);
    },    anyBlocked(from, to) {
      return playerBody.blocked(from, to);
    },
    resolveShot(origin, direction, def, shooter) {
      const targets = [];
      if (shooter !== player && player.alive) targets.push(player);
      for (const bot of bots) if (bot.alive && bot !== shooter) targets.push(bot);

      let best = null;
      // Bodies first: the nearest part of the nearest body wins over any wall behind it.
      for (const target of targets) {
        const body = target === player ? player : target.body;
        const parts = hitboxes(body);
        for (const part of parts) {
          const hit = rayBox(origin, direction, {
            min: { x: body.position.x - part.r, y: part.y0, z: body.position.z - part.r },
            max: { x: body.position.x + part.r, y: part.y1, z: body.position.z + part.r },
          });
          if (hit && (!best || hit.t < best.t)) best = { t: hit.t, target, part: part.part, normal: hit.normal };
        }
      }

      // Then the map: a wall closer than the body stops the bullet.
      for (const collider of colliders) {
        const hit = rayBox(origin, direction, collider);
        if (hit && (!best || hit.t < best.t)) best = { t: hit.t, target: null, part: 'wall', normal: hit.normal };
      }

      if (!best) return null;
      const point = origin.clone().addScaledVector(direction, best.t);
      return { target: best.target, part: best.part, point, normal: best.normal, distance: best.t };
    },
    damage(target, amount, source, part) {
      applyDamage(target, amount, source, part);
    },
    onShot(shooter, eye) {
      const def = shooter === player ? activeWeapon().def : shooter.weapon.def;
      audio.shot(def.id, shooter === player ? 0 : eye.distanceTo(playerBody.eyePosition(new THREE.Vector3())));
      // Every bot within earshot hears the shot, so a firefight pulls defenders.
      for (const bot of bots) {
        if (bot.side === shooter.side || !bot.alive) continue;
        hear(bot, eye, 1.6);
      }
    },
    placeCharge(by, siteId) {
      const site = SITES.find((s) => s.id === siteId) ?? SITES[0];
      roundState.charge.placed = true;
      roundState.charge.carried = false;
      roundState.charge.site = site.id;
      roundState.charge.x = by.body ? by.body.position.x : site.x;
      roundState.charge.z = by.body ? by.body.position.z : site.z;
      roundState.charge.fuseLeft = ROUND.fuse;
      if (by.carrying !== undefined) by.carrying = false;
      if (by === player) player.carrying = false;
      audio.plant();
      hud.feed(by.name ?? 'Raiders', 'raid', 'the site', 'raid', 'planted the charge at');
      onEvent({ type: 'plant', site: site.id });
    },
    defuseCharge(by) {
      roundState.charge.defused = true;
      audio.defuse();
      round.endRound('watch', 'defuse');
    },
    explodeCharge() {
      const centre = new THREE.Vector3(roundState.charge.x, 0.4, roundState.charge.z);
      effects.blast(centre);
      audio.explosion();
      for (const target of [player, ...bots]) {
        if (!target.alive) continue;
        const body = target.body ?? target;
        const d = Math.hypot(body.position.x - centre.x, body.position.z - centre.z);
        if (d < 12) {
          const t = Math.max(0, 1 - d / 12);
          applyDamage(target, 40 + 260 * t * t, null, 'blast');
        }
      }
    },
    armRaiders() {
      // The charge goes to the player once the round goes live, so the objective is the player's.
      if (!roundState.charge.placed) {
        player.carrying = true;
        roundState.charge.carried = true;
        roundState.charge.carrierId = 'player';
        hud.setObjective('You carry the charge — reach <strong>A</strong> or <strong>B</strong> and hold <strong>E</strong>', false);
      }
      // And every raider bot picks a route: the push follows the plan, not the player.
      const routes = ['mid-to-a', 'long-to-a', 'mid-to-b', 'tunnel-to-b'];
      let index = 0;
      for (const bot of bots) {
        if (bot.side !== 'raid') continue;
        setRoute(bot, routes[index % routes.length]);
        index += 1;
      }
    },
    respawnAll() {
      for (const bot of [...bots]) {
        scene.remove(bot.root);
        bot.root.traverse((node) => { if (node.geometry) node.geometry.dispose(); });
      }
      bots.length = 0;
      player.alive = true;
      player.health = 100;
      player.planting = 0;
      player.defusing = 0;
      player.velocity.set(0, 0, 0);
      const raidSpawn = SPAWNS.raid[0];
      player.position.set(raidSpawn.x, 0, raidSpawn.z);
      player.yaw = 0;
      player.pitch = 0;

      const parents = {
        colliders,
        materials,
        group: botGroup,
        weaponFor(side) {
          const list = side === 'raid' ? RAID_LOADOUT : WATCH_LOADOUT;
          return makeWeapon(WEAPONS[list[Math.floor(Math.random() * list.length)]]);
        },
      };

      for (let i = 0; i < RAID_BOTS; i += 1) {
        const spawn = SPAWNS.raid[(i + 1) % SPAWNS.raid.length];
        const bot = makeBot(scene, parents, 'raid', { x: spawn.x, z: spawn.z, yaw: 0 }, i);
        bot.name = BOT_NAMES_RAID[i];
        setRoute(bot, 'mid-to-a');
        bots.push(bot);
      }
      for (let i = 0; i < WATCH_BOTS; i += 1) {
        const spawn = SPAWNS.watch[i % SPAWNS.watch.length];
        const bot = makeBot(scene, parents, 'watch', { x: spawn.x, z: spawn.z, yaw: Math.PI }, i);
        bot.name = BOT_NAMES_WATCH[i];
        setRoute(bot, i < 2 ? 'defend-a' : i < 4 ? 'defend-b' : 'defend-mid');
        // A defender's kit is drawn at once, because a defender has no buy phase of its own.
        bot.armour = 100;
        bots.push(bot);
      }
      for (const bot of bots) {
        bot.weapon = makeWeapon(WEAPONS[bot.side === 'raid' ? RAID_LOADOUT[bot.order % RAID_LOADOUT.length] : WATCH_LOADOUT[bot.order % WATCH_LOADOUT.length]]);
        refillWeapon(bot.weapon);
      }
      state.grenades.length = 0;
      effects.clearDecals();
    },
    refillPlayer() {
      player.alive = true;
      player.health = 100;
      // A primary is bought, never kept: losing it is the cost of losing a round.
      if (player.weapons.primary) refillWeapon(player.weapons.primary);
      refillWeapon(player.weapons.secondary);
      player.active = player.weapons.primary ? 'primary' : 'secondary';
      player.carrying = false;
      player.hasKit = player.armour > 0 && player.hasKit;
    },
  };

  roundApi.state.world = world;

  // ---- Damage, kills, and the two ways a round ends by attrition ----------------------------

  function applyDamage(target, amount, source, part) {
    if (!target.alive) return;
    const body = target.body ?? target;
    let dealt = amount;
    if (target.armour > 0) {
      const result = armourAbsorb(target.armour, amount);
      target.armour = Math.max(0, result.armour);
      dealt = result.health;
    }
    target.health -= dealt;

    if (target === player) {
      hud.showDamage();
      audio.hurt();
      hud.setHealth(player.health, player.armour);
      if (target.health <= 0) {
        killPlayer(source);
      }
      return;
    }

    if (source === player) {
      hud.hitMarker(target.health <= 0);
      audio.hit(part === 'head');
    }
    if (target.health <= 0) {
      killBot(target, source);
    }
  }

  function killBot(bot, source) {
    bot.alive = false;
    bot.body.alive = false;
    bot.root.visible = false;
    audio.death();
    const killerName = source === player ? 'You' : source?.name ?? 'the depot';
    const killerSide = source?.side ?? 'raid';
    hud.feed(killerName, killerSide, bot.name, bot.side);
    // A raider carrying the charge drops it, and the nearest living raider picks it up.
    if (bot.carrying) {
      bot.carrying = false;
      const heir = [player, ...bots].find((t) => t.side === 'raid' && t.alive);
      if (heir) {
        heir.carrying = true;
        roundState.charge.carried = true;
      }
    }
    if (source === player) {
      const reward = source.weapon ? ROUND.killReward.rifle : ROUND.killReward.rifle;
      roundState.money.raid = Math.min(ROUND.cap, roundState.money.raid + reward);
      hud.setMoney(roundState.money.raid);
    }
    onEvent({ type: 'kill', victim: bot.name });
  }

  function killPlayer(source) {
    player.alive = false;
    player.health = 0;
    hud.setHealth(0, player.armour);
    audio.death();
    hud.feed(source?.name ?? 'the Watch', source?.side ?? 'watch', 'You', 'raid');
    if (player.carrying) {
      player.carrying = false;
      const heir = bots.find((b) => b.side === 'raid' && b.alive);
      if (heir) heir.carrying = true;
      roundState.charge.carried = !!heir;
    }
    roundState.playerDead = true;
    onEvent({ type: 'player-dead' });
  }

  // ---- Per-frame simulation ----------------------------------------------------------------

  const tmpEye = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  function activeWeapon() {
    if (player.active === 'primary' && player.weapons.primary) return player.weapons.primary;
    return player.weapons.secondary;
  }

  function fire() {
    const weapon = activeWeapon();
    if (!canFire(weapon)) {
      if (weapon.mag === 0 && weapon.reloadLeft === 0) {
        audio.dryFire();
        startReload(weapon);
      }
      return;
    }
    if (!takeRound(weapon)) return;
    weapon.cooldown = weapon.def.fireGap;
    weapon.flash = 0.055;
    weapon.kick = 0.045;

    const eye = playerBody.eyePosition(tmpEye);
    const spread = shotSpread(weapon.def, playerBody);
    // The shot leaves along the aim with the weapon's live spread, so the crosshair is honest.
    const yaw = playerBody.yaw + (Math.random() * 2 - 1) * spread;
    const pitch = playerBody.pitch + (Math.random() * 2 - 1) * spread;
    tmpDir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();

    const hit = world.resolveShot(eye, tmpDir, weapon.def, player);
    actions.lastHit = hit;
    if (hit) {
      effects.tracer(eye, hit.point);
      effects.impact(hit.point, hit.normal);
      if (hit.target) {
        const damage = damageAt(weapon.def, hit.part, hit.distance);
        applyDamage(hit.target, damage, player, hit.part);
      } else {
        audio.impact();
      }
      // The shot is loud: nearby bots turn towards the player.
      for (const bot of bots) if (bot.alive && bot.side === 'watch') hear(bot, eye, 1.5);
    } else {
      effects.tracer(eye, eye.clone().addScaledVector(tmpDir, 60));
    }

    const recoil = weapon.def.recoil;
    playerBody.recoil(recoil.pitch * (playerBody.crouching ? 0.78 : 1), (Math.random() * 2 - 1) * recoil.yaw);
    audio.shot(weapon.def.id, 0);
    onEvent({ type: 'shot', weapon: weapon.def.id });
  }

  function throwPlayerGrenade() {
    if (player.grenades <= 0 || !player.alive) return;
    player.grenades -= 1;
    const eye = playerBody.eyePosition(tmpEye);
    const dir = new THREE.Vector3(-Math.sin(playerBody.yaw), 0.28, -Math.cos(playerBody.yaw)).normalize();
    const grenade = throwGrenade(scene, eye, dir, 'player', { colliders });
    state.grenades.push(grenade);
  }

  function stepGrenades(dt) {
    for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
      const grenade = state.grenades[i];
      const done = stepGrenade(grenade, dt);
      if (!done) continue;
      scene.remove(grenade.mesh);
      grenade.mesh.geometry.dispose();
      state.grenades.splice(i, 1);
      const bodies = [player, ...bots.filter((b) => b.alive).map((b) => b.body)];
      grenadeBlast(grenade, bodies, (body, damage, kind) => {
        const target = body === player ? player : bots.find((b) => b.body === body);
        if (target) applyDamage(target, damage, null, 'blast');
      });
      effects.blast(grenade.position);
      audio.explosion();
    }
  }

  function buy(itemId) {
    const money = roundState.money.raid;
    const owned = [];
    if (player.armour > 0) owned.push('armor');
    if (player.hasKit) owned.push('kit');
    const found = [...BUY_LIST.pistol, ...BUY_LIST.primary, ...BUY_LIST.gear].find((i) => i.id === itemId);
    if (!found || found.price > money) {
      audio.deny();
      return false;
    }
    if (itemId === 'armor') {
      if (player.armour > 0) return false;
      player.armour = 100;
    } else if (itemId === 'kit') {
      if (player.hasKit) return false;
      player.hasKit = true;
    } else if (itemId === 'grenade') {
      if (player.grenades >= 2) return false;
      player.grenades += 1;
    } else {
      player.weapons.primary = makeWeapon(WEAPONS[itemId]);
      player.active = 'primary';
    }
    roundState.money.raid -= found.price;
    hud.setMoney(roundState.money.raid);
    hud.setAmmo(activeWeapon().mag, activeWeapon().reserve, activeWeapon().def.name, false);
    audio.buy();
    return true;
  }

  // ---- Round hooks the HUD drives ----------------------------------------------------------

  function plantTick(dt, input) {
    if (!player.carrying || !player.alive) return;
    const site = SITES.find((s) => inSite(playerBody.position, s));
    if (!site || !input.eHeld) {
      player.planting = 0;
      return;
    }
    player.planting += dt;
    hud.setObjective(`Planting at <strong>${site.label}</strong> — ${Math.max(0, ROUND.plantTime - player.planting).toFixed(1)}s`, true);
    if (player.planting >= ROUND.plantTime) {
      player.planting = 0;
      world.placeCharge(player, site.id);
    }
  }

  function defuseTick(dt, input) {
    if (player.side !== 'watch') return;
    if (!roundState.charge.placed || roundState.charge.defused) return;
    const site = SITES.find((s) => s.id === roundState.charge.site);
    if (!site || !inSite(playerBody.position, site) || !input.eHeld) {
      player.defusing = 0;
      return;
    }
    player.defusing += dt;
    const need = player.hasKit ? ROUND.defuseKitTime : ROUND.defuseTime;
    hud.setObjective(`Defusing — ${Math.max(0, need - player.defusing).toFixed(1)}s`, true);
    if (player.defusing >= need) world.defuseCharge(player);
  }

  // ---- Bodies push each other apart -------------------------------------------------------

  // Without this every bot walks into the same metre of floor and a firefight looks like one
  // soldier: bodies are separated in a cheap pass after they move, not inside the movement solver.
  function separateBodies() {
    const living = [];
    if (player.alive) living.push(player);
    for (const bot of bots) if (bot.alive) living.push(bot.body);
    const MIN = 0.78;
    for (let i = 0; i < living.length; i += 1) {
      for (let j = i + 1; j < living.length; j += 1) {
        const a = living[i];
        const b = living[j];
        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        let distance = Math.hypot(dx, dz);
        if (distance > MIN) continue;
        if (distance < 1e-4) {
          dx = 0.01 * (i + 1);
          dz = 0.01 * (j + 1);
          distance = Math.hypot(dx, dz);
        }
        const push = (MIN - distance) * 0.5;
        const nx = dx / distance;
        const nz = dz / distance;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
      }
    }
  }

  function step(dt, input, now) {
    roundApi.step(dt);
    // The player's own weapon ticks every frame, in every phase: without this its cooldown never
    // clears and its reload never finishes, which makes the gun fire exactly once per round.
    stepWeapon(player.weapons.secondary, dt);
    if (player.weapons.primary) stepWeapon(player.weapons.primary, dt);
    if (roundState.phase === 'live' && !roundState.over) {
      for (const bot of bots) if (bot.alive) stepBot(bot, dt, now, world);
      separateBodies();
      plantTick(dt, input);
      defuseTick(dt, input);
    } else {
      // Out of the live phase a bot still settles: it stands, and its gun cools down.
      for (const bot of bots) if (bot.alive) stepWeapon(bot.weapon, dt);
    }
    stepGrenades(dt);
    effects.step(dt);
  }

  const actions = { lastHit: null };

  return {
    world,
    round: roundApi,
    state: roundState,
    player,
    bots,
    actions,
    step,
    fire,
    buy,
    activeWeapon,
    throwPlayerGrenade,
    startRound: () => roundApi.startRound(),
  };
}

// ---- Geometry helpers ----------------------------------------------------------------------

// A ray against an axis-aligned box, slab by slab, returning the entry distance and the face it
// entered through. Written out rather than using three.js's raycaster because the simulation does
// thousands of these a second and needs the normal, not a mesh reference.
function rayBox(origin, dir, box) {
  let tmin = 0;
  let tmax = Infinity;
  let axis = -1;
  let sign = 0;
  for (const key of ['x', 'y', 'z']) {
    const min = box.min[key];
    const max = box.max[key];
    const o = origin[key];
    const d = dir[key];
    if (Math.abs(d) < 1e-8) {
      if (o < min || o > max) return null;
      continue;
    }
    let t1 = (min - o) / d;
    let t2 = (max - o) / d;
    let s = -1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
      s = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = key;
      sign = s;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis === -1) return null;
  const normal = new THREE.Vector3();
  normal[axis] = sign;
  return { t: tmin, normal };
}
