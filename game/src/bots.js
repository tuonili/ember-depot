// Bot AI: perception, a small state machine and the route following that makes a push look like
// a push. A bot sees only what its own eyes can reach — a field of view, a line the map blocks, a
// maximum range — and hears gunfire and footsteps within a radius. It never reads the player's
// position directly.
//
// States: advance (walk the route), hold (stand an angle), engage (shoot at a seen enemy),
// search (go to a heard sound), plant / defuse (the objective), and dead.
import * as THREE from 'three';
import { createBody, hitboxes } from './player.js';
import { ROUTES, WAYPOINTS, HOLD_SPOTS, SITES } from './map.js';
import { canFire, takeRound, stepWeapon, startReload, shotSpread, damageAt } from './weapons.js';

const VIEW_RANGE = 62;
// A bot's cone is about 110 degrees each side: it notices a player crossing its lane, and turns
// when it is shot at, but it still cannot see behind its own back.
const VIEW_COS = Math.cos(2.0);
const HEAR_RADIUS = 20;
const REACTION_MIN = 0.16;
const REACTION_MAX = 0.34;
const AIM_TURN = 3.4;
const STRAFE_EVERY = 0.85;

const NODES = new Map(WAYPOINTS.map((node) => [node.id, node]));

export function routePoints(routeId) {
  const route = ROUTES[routeId] ?? [];
  return route.map((id) => NODES.get(id)).filter(Boolean);
}

// The visual body of a bot: a capsule-ish stack of boxes in its side's colour, plus a head the
// hitboxes line up with. Two materials are shared across every bot of a side.
export function createBotModels(scene, materials) {
  const group = new THREE.Group();
  scene.add(group);
  return group;
}

export function makeBot(scene, parents, side, spawn, order) {
  const body = createBody(parents.colliders, { x: spawn.x, z: spawn.z, yaw: side === 'raid' ? 0 : Math.PI });
  const root = new THREE.Group();
  const mat = parents.materials[side];
  const dark = parents.materials.hairline;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.74, 0.3), mat);
  torso.position.y = 1.06;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.7, 0.26), dark);
  legs.position.y = 0.36;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.24), mat);
  head.position.y = 1.56;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.5), dark);
  gun.position.set(0.2, 1.1, -0.24);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.16), dark);
  pack.position.set(0, 1.16, 0.2);
  for (const part of [torso, legs, head, gun, pack]) {
    part.castShadow = true;
    root.add(part);
  }
  // A team band above the head: the one thing a player reads at range instead of a name.
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.3), parents.materials[side === 'raid' ? 'watch' : 'raid']);
  band.position.y = 1.74;
  root.add(band);
  root.position.set(body.position.x, body.position.y, body.position.z);
  parents.group.add(root);

  const bot = {
    id: `bot-${side}-${order}`,
    side,
    body,
    root,
    order,
    state: 'advance',
    health: 100,
    armour: 0,
    alive: true,
    weapon: parents.weaponFor(side),
    route: [],
    leg: 0,
    holdUntil: 0,
    target: null,
    targetSeenAt: 0,
    lastSeenAt: -99,
    lastSeenPos: new THREE.Vector3(),
    heardAt: -99,
    heardPos: new THREE.Vector3(),
    strafeDir: 1,
    strafeAt: 0,
    fireHold: 0,
    aimPitch: 0,
    walkPhase: 0,
    // Objective work: a raider with the charge arms it at a site, a defender cuts it.
    carrying: false,
    arming: 0,
    planting: 0,
    defusing: 0,
    intent: { forward: 0, strafe: 0, jump: false, crouch: false, walk: false, yaw: 0 },
  };
  return bot;
}

export function setRoute(bot, routeId, startAt = 0) {
  bot.route = routePoints(routeId);
  bot.leg = startAt;
  bot.state = 'advance';
}

// Can this bot see that point? Field of view, range and a map line, and nothing else.
export function canSee(bot, point) {
  if (!bot.alive) return false;
  const eye = bot.body.eyePosition(new THREE.Vector3());
  const dx = point.x - eye.x;
  const dz = point.z - eye.z;
  const distance = Math.hypot(dx, dz);
  if (distance > VIEW_RANGE) return false;
  if (distance > 0.8 && bot.state !== 'engage') {
    const forwardX = -Math.sin(bot.body.yaw);
    const forwardZ = -Math.cos(bot.body.yaw);
    const cos = (dx * forwardX + dz * forwardZ) / distance;
    if (cos < VIEW_COS && bot.lastSeenAt < 0) return false;
  }
  return !bot.body.blocked(eye, new THREE.Vector3(point.x, point.y + 1.3, point.z));
}

export function hear(bot, position, strength) {
  if (!bot.alive) return;
  const eye = bot.body.eyePosition(new THREE.Vector3());
  if (Math.hypot(position.x - eye.x, position.z - eye.z) > HEAR_RADIUS * strength) return;
  bot.heardAt = performance.now() / 1000;
  bot.heardPos.copy(position);
}

// One bot, one fixed step. `world` is the round: the player body, the other bots, the sites, the
// clock, and the callbacks the round needs back (a shot fired, a body hurt, the charge planted).
export function stepBot(bot, dt, now, world) {
  if (!bot.alive) return;
  const body = bot.body;
  const intent = bot.intent;

  // 1. Look. A bot faces where it is going, and turns to a target when it has one.
  let seen = null;
  if (bot.side === 'watch' || bot.state !== 'advance') {
    const candidates = world.enemiesOf(bot.side);
    for (const enemy of candidates) {
      if (!enemy.alive) continue;
      const aim = new THREE.Vector3(enemy.body.position.x, enemy.body.position.y + enemy.body.height * 0.62, enemy.body.position.z);
      if (canSee(bot, aim)) {
        seen = enemy;
        break;
      }
    }
  } else {
    const enemy = world.player;
    if (enemy.alive) {
      const aim = new THREE.Vector3(enemy.position.x, enemy.position.y + enemy.height * 0.62, enemy.position.z);
      if (canSee(bot, aim)) seen = { body: enemy, isPlayer: true };
    }
    if (!seen) {
      for (const other of world.enemiesOf(bot.side)) {
        if (!other.alive) continue;
        const aim = new THREE.Vector3(other.body.position.x, other.body.position.y + other.body.height * 0.62, other.body.position.z);
        if (canSee(bot, aim)) { seen = other; break; }
      }
    }
  }

  if (seen) {
    if (bot.target !== seen) {
      bot.target = seen;
      bot.targetSeenAt = now + REACTION_MIN + ((bot.order * 0.37) % (REACTION_MAX - REACTION_MIN));
      bot.fireHold = 0;
    }
    bot.lastSeenAt = now;
    bot.lastSeenPos.set(seen.body.position.x, seen.body.position.y + 1.2, seen.body.position.z);
    if (bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') bot.state = 'engage';
  } else if (bot.target && now - bot.lastSeenAt > 1.1) {
    bot.target = null;
    if (bot.state === 'engage') bot.state = 'search';
  }

  if (bot.state === 'engage' && bot.target) {
    engage(bot, dt, now, world);
  } else if (bot.state === 'search') {
    search(bot, dt, now, world);
  } else if (bot.state === 'plant') {
    plant(bot, dt, now, world);
  } else if (bot.state === 'defuse') {
    defuse(bot, dt, now, world);
  } else if (bot.state === 'hold') {
    hold(bot, dt, now, world);
  } else {
    advance(bot, dt, now, world);
  }

  // A heard sound turns a bot to look at it, and pulls a defender off its angle.
  if (!seen && bot.heardAt > now - 2.5 && bot.state !== 'plant' && bot.state !== 'defuse') {
    const dx = bot.heardPos.x - body.position.x;
    const dz = bot.heardPos.z - body.position.z;
    if (Math.hypot(dx, dz) > 1.5) {
      const wanted = Math.atan2(-dx, -dz);
      body.yaw += angleDelta(body.yaw, wanted) * Math.min(1, dt * 6);
    }
  }

  body.step(dt, intent);
  stepWeapon(bot.weapon, dt);
  bot.walkPhase += body.speed * dt * 2.6;
  bot.root.position.set(body.position.x, body.position.y, body.position.z);
  bot.root.rotation.y = body.yaw;
  // A little lean into the walk, so a moving bot is not a sliding box.
  bot.root.position.y += Math.abs(Math.sin(bot.walkPhase)) * 0.03;
}

function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function turnTo(bot, x, z, dt, rate = AIM_TURN) {
  const dx = x - bot.body.position.x;
  const dz = z - bot.body.position.z;
  if (Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01) return;
  const wanted = Math.atan2(-dx, -dz);
  bot.body.yaw += angleDelta(bot.body.yaw, wanted) * Math.min(1, dt * rate);
}

function moveTo(bot, x, z, dt, walk = false) {
  const dx = x - bot.body.position.x;
  const dz = z - bot.body.position.z;
  const distance = Math.hypot(dx, dz);
  const forward = distance > 0.05 ? 1 : 0;
  const wanted = Math.atan2(-dx, -dz);
  bot.body.yaw += angleDelta(bot.body.yaw, wanted) * Math.min(1, dt * 8);
  bot.intent.forward = forward;
  bot.intent.strafe = 0;
  bot.intent.walk = walk;
  bot.intent.crouch = false;
  return distance;
}

function advance(bot, dt, now, world) {
  const route = bot.route;
  if (!route.length || bot.leg >= route.length) {
    // No route left: hold where the route ended, or go to the site if this bot carries the charge.
    if (bot.carrying) {
      const site = pickSite(world);
      if (site && !world.charge.placed) {
        const near = inSite(bot.body.position, site);
        if (near) {
          bot.state = 'plant';
          bot.arming = 0;
          return;
        }
        moveTo(bot, site.x, site.z, dt);
        return;
      }
    }
    bot.state = 'hold';
    bot.holdUntil = now + 4;
    return;
  }
  const node = route[bot.leg];
  const distance = moveTo(bot, node.x, node.z, dt, bot.side === 'raid' && bot.leg < 2);
  if (distance < 0.9) {
    bot.leg += 1;
    if (bot.leg >= route.length) {
      // The end of a route is a place to stand, not a place to stop thinking.
      bot.state = 'hold';
      bot.holdUntil = now + 6 + bot.order;
    }
  }
}

function hold(bot, dt, now, world) {
  const spot = nearestHold(bot, world);
  if (spot) {
    moveTo(bot, spot.x, spot.z, dt, true);
    if (Math.hypot(spot.x - bot.body.position.x, spot.z - bot.body.position.z) < 0.6) {
      bot.body.yaw += angleDelta(bot.body.yaw, spot.look) * Math.min(1, dt * 2.4);
      bot.intent.forward = 0;
    }
  }
  // A defender hears the charge go down and leaves its angle to cut it.
  if (bot.side === 'watch' && world.charge.placed && !world.charge.defused) {
    const site = SITES.find((s) => s.id === world.charge.site);
    if (site) {
      bot.state = 'advance';
      bot.route = world.routeTo(site.id, bot.side);
      bot.leg = 0;
      return;
    }
  }
  if (bot.side === 'raid' && !world.charge.placed && bot.carrying) {
    bot.state = 'advance';
  }
}

function search(bot, dt, now, world) {
  moveTo(bot, bot.heardPos.x, bot.heardPos.z, dt, bot.side === 'watch');
  turnTo(bot, bot.lastSeenPos.x, bot.lastSeenPos.z, dt, 2.0);
  if (Math.hypot(bot.heardPos.x - bot.body.position.x, bot.heardPos.z - bot.body.position.z) < 1.2 || now - bot.lastSeenAt > 5) {
    bot.state = 'advance';
  }
}

function engage(bot, dt, now, world) {
  const target = bot.target;
  if (!target) {
    bot.state = 'advance';
    return;
  }
  const body = bot.body;
  const aimPoint = new THREE.Vector3(target.body.position.x, target.body.position.y + target.body.height * 0.6, target.body.position.z);
  turnTo(bot, aimPoint.x, aimPoint.z, dt, 5.2);

  const distance = Math.hypot(aimPoint.x - body.position.x, aimPoint.z - body.position.z);
  // Close the gap with a rifle at range, back off with a shotgun, and strafe either way.
  const wants = bot.weapon.def.id === 'hound' ? 6 : 15;
  bot.intent.forward = distance > wants + 3 ? 1 : distance < wants - 5 ? -1 : 0;
  if (now > bot.strafeAt) {
    bot.strafeDir = bot.strafeDir === 1 ? -1 : 1;
    bot.strafeAt = now + STRAFE_EVERY * (1 + (bot.order % 3) * 0.3);
  }
  // A bot stops moving to shoot at range: a strafing shooter that never plants its feet is both
  // unrealistic and unbeatable. Up close it keeps moving, because a still target is a dead one.
  const plant = distance > 9 && bot.weapon.def.id !== 'hound' ? 0 : bot.strafeDir;
  bot.intent.strafe = plant * (bot.intent.forward === 0 ? 1 : 0.5);
  bot.intent.crouch = distance > 22 && bot.weapon.def.id === 'warden';
  bot.intent.walk = false;

  // Aim: the pitch tracks the target, so a bot at the top of a ramp looks down it.
  const eye = body.eyePosition(new THREE.Vector3());
  const dy = aimPoint.y - eye.y;
  const wantedPitch = Math.atan2(dy, Math.max(0.2, distance));
  bot.aimPitch += (wantedPitch - bot.aimPitch) * Math.min(1, dt * 7);

  if (now < bot.targetSeenAt) return;
  if (!canFire(bot.weapon)) {
    if (bot.weapon.mag === 0) startReload(bot.weapon);
    return;
  }
  // Accuracy: a bot is not a laser. Its cone is the weapon's own spread widened by its skill, and it
  // widens again while it is moving, so a defender holding an angle is dangerous and one sprinting
  // into the open is not. `order` stands in for the bot's individual aim, fixed for the match.
  const base = shotSpread(bot.weapon.def, body);
  const skill = 6.5 + ((bot.order * 7) % 9) * 0.9;
  const moving = Math.min(2.4, 1 + body.speed * 0.5);
  const miss = base * skill * moving;
  const spreadX = (Math.sin(now * 13.1 + bot.order * 5.7) + Math.sin(now * 7.7 + bot.order)) * 0.5 * miss;
  const spreadY = (Math.cos(now * 11.3 + bot.order * 2.3) + Math.cos(now * 5.1 + bot.order)) * 0.5 * miss;

  // Bursts: a bot holds the trigger for a moment and then lets the cone close, instead of pouring
  // a whole magazine into a target that is standing still, which would make a 5v5 unwinnable.
  bot.fireHold += dt;
  const burstLength = 0.5 + (bot.order % 3) * 0.25;
  if (bot.fireHold > burstLength) {
    if (bot.fireHold > burstLength + 0.48) bot.fireHold = 0;
    return;
  }

  if (!takeRound(bot.weapon)) return;
  bot.weapon.cooldown = bot.weapon.def.fireGap;
  bot.weapon.flash = 0.06;
  bot.weapon.kick = 0.05;

  const dir = new THREE.Vector3()
    .subVectors(aimPoint, eye)
    .normalize();
  dir.x += spreadX;
  dir.y += spreadY;
  dir.z += spreadX * 0.35 + spreadY * 0.2;
  dir.normalize();

  const hit = world.resolveShot(eye, dir, bot.weapon.def, bot);
  if (hit) {
    world.onImpact?.(eye, hit);
    if (hit.target) {
      const damage = damageAt(bot.weapon.def, hit.part, distance);
      world.damage(hit.target, damage, bot, hit.part);
    }
  }
  world.onShot(bot, eye);
}

function plant(bot, dt, now, world) {
  const site = inSite(bot.body.position, world.charge.site ? SITES.find((s) => s.id === world.charge.site) : null);
  bot.intent.forward = 0;
  bot.intent.strafe = 0;
  bot.intent.crouch = true;
  if (!site) {
    bot.state = 'advance';
    return;
  }
  bot.arming += dt;
  if (bot.arming >= 3.2) {
    world.placeCharge(bot, site.id);
    bot.state = 'hold';
    bot.holdUntil = now + 8;
  }
}

function defuse(bot, dt, now, world) {
  bot.intent.forward = 0;
  bot.intent.crouch = true;
  bot.defusing += dt;
  if (bot.defusing >= (bot.hasKit ? 4.2 : 8.4)) world.defuseCharge(bot);
}

export function inSite(position, site) {
  if (!site) return false;
  return Math.hypot(position.x - site.x, position.z - site.z) <= site.radius;
}

export function pickSite(world) {
  // The charge goes to the site the raiders are nearest to, so the push and the plant agree.
  if (world.charge.site) return SITES.find((s) => s.id === world.charge.site);
  const raiders = world.alliesOf('raid');
  if (!raiders.length) return SITES[0];
  let best = SITES[0];
  let bestScore = Infinity;
  for (const site of SITES) {
    let sum = 0;
    for (const bot of raiders) sum += Math.hypot(bot.body.position.x - site.x, bot.body.position.z - site.z);
    const score = sum / raiders.length;
    if (score < bestScore) {
      bestScore = score;
      best = site;
    }
  }
  return best;
}

function nearestHold(bot, world) {
  const set = HOLD_SPOTS[bot.side === 'watch' ? 'B' : 'MID'] ?? [];
  if (!set.length) return null;
  let best = set[0];
  let bestD = Infinity;
  for (const spot of set) {
    const d = Math.hypot(spot.x - bot.body.position.x, spot.z - bot.body.position.z);
    if (d < bestD) {
      bestD = d;
      best = spot;
    }
  }
  return bestD < 14 ? best : null;
}

export function botHitboxes(bot) {
  return hitboxes(bot.body);
}
