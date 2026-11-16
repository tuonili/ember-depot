// The round: the thing that makes this a tactical shooter and not a shooting range. It owns the
// clock, the two scores, the money of both teams, the buy phase, the charge and its fuse, and the
// conditions under which a round ends. Everything it changes it reports through callbacks, so the
// HUD and the sound layer never read the round's internals.
import * as THREE from 'three';
import { SITES } from './map.js';
import { GRENADE, ARMOR } from './weapons.js';

export const ROUND = {
  freeze: 8,
  buy: 20,
  time: 115,
  post: 4.5,
  fuse: 40,
  plantTime: 3.2,
  defuseTime: 10,
  defuseKitTime: 5,
  // The money model: what a round of either kind is worth, and the cap.
  winElimination: 3250,
  winObjective: 3500,
  winDefuse: 3500,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plantBonus: 800,
  cap: 16000,
  start: 800,
  killReward: { rifle: 300, smg: 600, sniper: 100, pistol: 300 },
};

export const PHASES = ['freeze', 'buy', 'live', 'post'];

export function createRound({ world = null, hud, audio }) {
  const round = {
    number: 0,
    phase: 'freeze',
    phaseLeft: 0,
    clock: ROUND.time,
    score: { raid: 0, watch: 0 },
    lossStreak: { raid: 0, watch: 0 },
    money: { raid: ROUND.start, watch: ROUND.start },
    charge: { carried: false, placed: false, defused: false, site: null, x: 0, z: 0, fuseLeft: 0, carrierId: null },
    over: false,
    winner: null,
    reason: '',
    // Set by the match layer: what to do when the post-round pause ends.
    onRoundEnd: null,
    playerDead: false,
    // Bound after construction, because the match is built on top of this round.
    world,
  };

  function resetBodies() {
    // Spawns are handed out by the match, which owns the roster.
    round.world.respawnAll();
  }

  function startRound() {
    round.number += 1;
    round.over = false;
    round.winner = null;
    round.reason = '';
    round.playerDead = false;
    // Reset in place: the world holds a reference to this object for its whole life.
    Object.assign(round.charge, { carried: false, placed: false, defused: false, site: null, x: 0, z: 0, fuseLeft: 0, carrierId: null });
    round.phase = 'freeze';
    round.phaseLeft = ROUND.freeze;
    round.clock = ROUND.time;
    resetBodies();
    round.world.refillPlayer();
    hud.setRound(round.number, round.score, round.money.raid);
    hud.setTimer(ROUND.time);
    hud.setPhase('freeze');
    audio.whistle('freeze');
  }

  function endRound(winner, reason) {
    if (round.over) return;
    round.over = true;
    round.winner = winner;
    round.reason = reason;
    round.phase = 'post';
    round.phaseLeft = ROUND.post;
    round.score[winner] += 1;
    const loser = winner === 'raid' ? 'watch' : 'raid';

    // Money: the winner takes the round's reward, the loser a streak-scaled payout, and a raider
    // who got the charge down is paid for it even in a lost round.
    round.lossStreak[winner] = 0;
    round.lossStreak[loser] = Math.min(4, round.lossStreak[loser] + 1);
    const winPay = reason === 'elimination' ? ROUND.winElimination : reason === 'defuse' ? ROUND.winDefuse : ROUND.winObjective;
    round.money[winner] = Math.min(ROUND.cap, round.money[winner] + winPay);
    const lossPay = Math.min(ROUND.lossMax, ROUND.lossBase + ROUND.lossStep * (round.lossStreak[loser] - 1));
    round.money[loser] = Math.min(ROUND.cap, round.money[loser] + lossPay);
    if (round.charge.placed && !round.charge.defused && loser === 'raid') {
      round.money.raid = Math.min(ROUND.cap, round.money.raid + ROUND.plantBonus);
    }

    hud.setScore(round.score);
    hud.setMoney(round.money.raid);
    hud.roundBanner(winner, reason, round.score);
    audio.whistle(winner === 'raid' ? 'raid' : 'watch');
    if (round.onRoundEnd) round.onRoundEnd(round);
  }

  function step(dt) {
    if (round.over) {
      round.phaseLeft -= dt;
      if (round.phaseLeft <= 0) startRound();
      return;
    }
    round.phaseLeft -= dt;

    if (round.phase === 'freeze') {
      if (round.phaseLeft <= 0) {
        round.phase = 'buy';
        round.phaseLeft = ROUND.buy;
        hud.setPhase('buy');
        audio.whistle('live');
      }
      return;
    }

    if (round.phase === 'buy') {
      // The buy menu is open for the whole buy phase and shuts when the round goes live.
      if (round.phaseLeft <= 0) {
        round.phase = 'live';
        round.phaseLeft = ROUND.time;
        round.clock = ROUND.time;
        hud.closeBuy();
        hud.setPhase('live');
        round.world.armRaiders();
      }
      return;
    }

    if (round.phase === 'live') {
      round.clock -= dt;
      round.phaseLeft = round.clock;
      if (round.charge.placed && !round.charge.defused) {
        round.charge.fuseLeft -= dt;
        if (round.charge.fuseLeft <= 0) {
          round.world.explodeCharge();
          endRound('raid', 'detonation');
          return;
        }
        hud.setObjective(`Charge armed — ${Math.ceil(round.charge.fuseLeft)}s to detonation`, true);
      } else {
        hud.setObjective(round.charge.carried ? 'Carry the charge to a site and hold <strong>E</strong>' : 'Plant the charge at <strong>either site</strong>', false);
      }
      if (round.clock <= 0) {
        // Time: the defenders hold. A charge already down is not stopped by the clock.
        if (round.charge.placed && !round.charge.defused) return;
        endRound('watch', 'time');
        return;
      }
      // Elimination: one side has no bodies left standing.
      if (round.world.aliveCount('raid') === 0) {
        if (round.charge.placed && !round.charge.defused) return;
        endRound('watch', 'elimination');
        return;
      }
      if (round.world.aliveCount('watch') === 0) {
        // The raiders can still lose this: with the clock out and no plant, time is the defender's.
        if (!round.charge.placed) {
          endRound('raid', 'elimination');
        }
        return;
      }
    }
  }

  return {
    state: round,
    startRound,
    step,
    endRound,
    get money() {
      return round.money;
    },
  };
}

// A grenade in flight: geometry, velocity, a fuse, and the damage it does in a sphere when it
// lands. It is thrown by the player and by bots through the same function.
export function throwGrenade(scene, from, direction, ownerId, world) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#3d4a33'), roughness: 0.8 }),
  );
  mesh.position.copy(from);
  mesh.castShadow = true;
  scene.add(mesh);
  return {
    mesh,
    position: mesh.position,
    velocity: direction.clone().multiplyScalar(GRENADE.throwSpeed),
    fuse: GRENADE.fuse,
    ownerId,
    bounces: 0,
    world,
  };
}

export function stepGrenade(grenade, dt) {
  grenade.fuse -= dt;
  const g = grenade;
  g.velocity.y -= 20 * dt;
  const nx = g.position.x + g.velocity.x * dt;
  const nz = g.position.z + g.velocity.z * dt;
  const ny = g.position.y + g.velocity.y * dt;
  // Crude but honest: a grenade stops on the map's boxes and the floor, and loses energy.
  let blockedX = false;
  let blockedZ = false;
  for (const collider of g.world.colliders) {
    const inside = (x, y, z) => x > collider.min.x - 0.1 && x < collider.max.x + 0.1 && y > collider.min.y && y < collider.max.y && z > collider.min.z && z < collider.max.z;
    if (inside(nx, g.position.y, g.position.z)) blockedX = true;
    if (inside(g.position.x, g.position.y, nz)) blockedZ = true;
  }
  g.position.x = blockedX ? g.position.x : nx;
  g.position.z = blockedZ ? g.position.z : nz;
  if (blockedX) g.velocity.x *= -0.4;
  if (blockedZ) g.velocity.z *= -0.4;
  if (ny < 0.12) {
    g.position.y = 0.12;
    g.velocity.y *= -0.32;
    g.velocity.x *= 0.7;
    g.velocity.z *= 0.7;
    g.bounces += 1;
  } else {
    g.position.y = ny;
  }
  return g.fuse <= 0;
}

// The blast: distance-scaled damage to every body in the radius, and a light for a frame.
export function grenadeBlast(grenade, bodies, onHit) {
  for (const body of bodies) {
    if (!body.alive) continue;
    const centre = new THREE.Vector3(body.position.x, body.position.y + body.height * 0.5, body.position.z);
    const distance = centre.distanceTo(grenade.position);
    if (distance > GRENADE.radius) continue;
    const t = 1 - distance / GRENADE.radius;
    const damage = GRENADE.minDamage + (GRENADE.maxDamage - GRENADE.minDamage) * t * t;
    // Cover halves it: a grenade behind a crate is survivable, in the open it is not.
    const from = new THREE.Vector3(grenade.position.x, grenade.position.y + 0.1, grenade.position.z);
    const covered = grenade.world.anyBlocked(from, centre);
    onHit(body, covered ? damage * 0.45 : damage, covered ? 'blast-covered' : 'blast');
  }
}

export function armourAbsorb(armour, damage) {
  if (armour <= 0) return { health: damage, armour: 0 };
  const absorbed = Math.min(armour, damage * ARMOR.absorb);
  return { health: damage - absorbed, armour: armour - absorbed };
}
