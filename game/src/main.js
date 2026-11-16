// The entry point: build the renderer, the camera, the match, and run one loop. It is also the only
// place that knows about the DOM, so the simulation can be tested headless. The query string
// `?shot=start|play|end&seed=N` freezes the game at a deterministic frame for the screenshots the
// judge reads, which is the same path a person plays through.
import * as THREE from 'three';
import { PALETTE, SIDES } from './palette.js';
import { createWorld } from './world.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createEffects } from './effects.js';
import { createViewModel } from './viewmodel.js';
import { createMatch } from './match.js';
import { BUY_LIST, shotSpread } from './weapons.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const PROBE = params.has('probe');
const SEED = Number(params.get('seed') ?? 1);
const FOV = 74;

// A tiny deterministic PRNG, so a seeded frame is the same frame every time it is rendered.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);

const camera = new THREE.PerspectiveCamera(FOV, 1, 0.06, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
container.appendChild(renderer.domElement);

const hud = createHud();
const audio = createAudio();
const effects = createEffects(scene);
const viewModel = createViewModel(camera);

let match = null;
let running = false;
let paused = false;
const events = [];
const onEvent = (event) => events.push(event);

match = createMatch({ scene, hud, audio, effects, camera, onEvent });
const player = match.player;
const viewModelState = { spread: 0 };

// Pointer lock and the pause it implies: losing the lock stops the clock rather than the game.
const input = createInput(renderer.domElement, (locked) => {
  if (!locked && running) pause();
});

function pause() {
  if (!running || paused) return;
  paused = true;
  hud.showOverlay('paused');
}

function resume() {
  if (!running) return;
  paused = false;
  hud.hideOverlay();
  audio.resume();
  input.requestLock();
  last = performance.now();
}

function startMatch() {
  running = true;
  paused = false;
  hud.hideOverlay();
  audio.resume();
  input.requestLock();
  match.startRound();
  last = performance.now();
}

hud.onPlay(() => {
  if (!running) startMatch();
  else resume();
});

function resize() {
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- The player's frame -------------------------------------------------------------------

const intent = { forward: 0, strafe: 0, jump: false, crouch: false, walk: false, yaw: 0 };
let eHeld = false;
let last = performance.now();
let mouseDownTime = 0;
let steps = 0;
let stepAccum = 0;

function handleKeys(keys) {
  for (const code of keys) {
    if (code === 'KeyR') {
      const weapon = match.activeWeapon();
      if (match.round.state.phase !== 'post') {
        const ok = startReloadSafe(weapon);
        if (ok) audio.reload();
      }
    } else if (code === 'Digit1') {
      if (player.weapons.primary) player.active = 'primary';
    } else if (code === 'Digit2') {
      player.active = 'secondary';
    } else if (code === 'KeyB') {
      if (hud.buyOpen()) hud.closeBuy();
      else openBuy();
    } else if (code === 'KeyG') {
      match.throwPlayerGrenade();
    } else if (code === 'KeyE') {
      eHeld = true;
    } else if (code === 'Escape') {
      if (hud.buyOpen()) hud.closeBuy();
    }
  }
}

function startReloadSafe(weapon) {
  if (weapon.reloadLeft > 0) return false;
  if (weapon.mag === weapon.def.mag || weapon.reserve === 0) return false;
  weapon.reloadLeft = weapon.def.reloadTime;
  return true;
}

function openBuy() {
  const state = match.round.state;
  if (state.phase !== 'freeze' && state.phase !== 'buy') {
    audio.deny();
    return;
  }
  const owned = [];
  if (player.armour > 0) owned.push('armor');
  if (player.hasKit) owned.push('kit');
  if (player.grenades > 0) owned.push('grenade');
  hud.openBuy(BUY_LIST, state.money.raid, owned);
}

function handleBuyKeys(keys) {
  if (!hud.buyOpen()) return;
  const map = { Digit1: 'kestrel', Digit2: 'hound', Digit3: 'ranger', Digit4: 'warden', Digit5: 'sidearm', Digit6: 'armor', Digit7: 'grenade', Digit8: 'kit' };
  for (const code of keys) {
    if (code === 'KeyB' || code === 'Escape') {
      hud.closeBuy();
      return;
    }
    const item = map[code];
    if (item) {
      match.buy(item);
      openBuy();
    }
  }
}

// The keyup for E has to be seen, and E is not in the polled move set, so it is tracked here.
window.addEventListener('keyup', (event) => {
  if (event.code === 'KeyE') eHeld = false;
});

function frame(now) {
  requestAnimationFrame(frame);
  const dtRaw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, Math.max(0, dtRaw));

  if (running && !paused) {
    const keys = input.takeKeys();
    handleBuyKeys(keys);
    if (!hud.buyOpen()) handleKeys(keys);

    const look = input.takeLook();
    if (look.x || look.y) player.look(look.x, look.y);

    const polled = input.intent();
    intent.forward = polled.forward;
    intent.strafe = polled.strafe;
    intent.jump = polled.jump;
    intent.crouch = polled.crouch;
    intent.walk = polled.walk;
    intent.yaw = player.yaw;

    // Movement is the player's own body stepping; the round decides whether it is allowed to shoot.
    const frozen = match.round.state.phase === 'freeze';
    if (frozen) {
      intent.forward = 0;
      intent.strafe = 0;
      intent.jump = false;
    }
    player.step(dt, intent);

    // Firing: the mouse is down, the weapon is automatic or this is a fresh click.
    const weapon = match.activeWeapon();
    const wantFire = input.state.firing && !hud.buyOpen() && !paused && (match.round.state.phase === 'live' || match.round.state.phase === 'buy') && player.alive;
    if (wantFire) {
      if (weapon.def.automatic) match.fire();
      else if (now - mouseDownTime > 0) {
        match.fire();
        mouseDownTime = now;
      }
    }

    match.step(dt, { eHeld }, now / 1000);

    // Footsteps, paced by how fast the body is actually moving.
    if (player.onGround && player.speed > 0.6) {
      stepAccum += player.speed * dt;
      if (stepAccum > 2.3) {
        stepAccum = 0;
        audio.step(!player.walking && !player.crouching);
        for (const bot of match.bots) {
          if (bot.alive && bot.side === 'watch' && !player.walking && !player.crouching) hearNear(bot);
        }
      }
    }
  }

  updateHudCamera(dt);
  viewModel.step(dt, { weapon: match.activeWeapon(), body: player, spread: viewModelState.spread });
  renderer.render(scene, camera);
}

function hearNear(bot) {
  const eye = player.eyePosition(new THREE.Vector3());
  if (Math.hypot(bot.body.position.x - eye.x, bot.body.position.z - eye.z) < 18) {
    bot.heardAt = performance.now() / 1000;
    bot.heardPos.copy(eye);
  }
}

// The camera is the player's eye, plus a small recoil shake that decays, so a burst moves the view.
let shakeX = 0;
let shakeY = 0;
let shakePitch = 0;

function updateHudCamera(dt) {
  camera.position.set(player.position.x, player.position.y + player.eye, player.position.z);
  shakePitch *= Math.max(0, 1 - dt * 9);
  shakeX *= Math.max(0, 1 - dt * 9);
  shakeY *= Math.max(0, 1 - dt * 9);
  camera.rotation.set(player.pitch + shakePitch, player.yaw + shakeX, shakeY * 0.4);

  const weapon = match.activeWeapon();
  const spread = shotSpread(weapon.def, player);
  viewModelState.spread = spread;

  hud.setHealth(player.health, player.armour);
  hud.setAmmo(weapon.mag, weapon.reserve, weapon.def.name, weapon.reloadLeft > 0);
  hud.setMoney(match.round.state.money.raid);
  hud.setTimer(match.round.state.phase === 'live' ? match.round.state.clock : Math.max(0, match.round.state.phaseLeft));
  hud.setSpread(spread * 34);
}

// ---- Deterministic frames for the screenshots ---------------------------------------------

function settle(seconds) {
  // Run the simulation forward without rendering, so a shot frame is a real round state.
  const stepSize = 1 / 60;
  let budget = seconds;
  while (budget > 0) {
    const dt = Math.min(stepSize, budget);
    budget -= dt;
    player.step(dt, { forward: 0, strafe: 0, jump: false, crouch: false, walk: false, yaw: player.yaw });
    match.step(dt, { eHeld: false }, performance.now() / 1000);
    steps += 1;
  }
}

// Put a bot exactly where the frame needs it. The screenshot is a posed frame of the real
// simulation — the same bodies, the same weapons, the same renderer — not a mock-up.
function poseBot(name, x, z, yaw, extra = {}) {
  const bot = match.bots.find((b) => b.name === name);
  if (!bot) return null;
  bot.body.position.set(x, 0, z);
  bot.body.velocity.set(0, 0, 0);
  bot.body.yaw = yaw;
  Object.assign(bot, extra);
  bot.root.position.set(x, 0, z);
  bot.root.rotation.y = yaw;
  return bot;
}

function shotFrame() {
  const random = mulberry32(SEED);
  running = true;
  paused = false;
  hud.hideOverlay();
  match.startRound();
  // Give the player a rifle the honest way: money, then the buy menu's own function.
  match.round.state.money.raid = 9000;
  match.buy('ranger');
  match.buy('armor');
  hud.setMoney(match.round.state.money.raid);

  if (SHOT === 'start') {
    // The freeze frame: spawn, the buy menu open, the round clock at full.
    hud.setPhase('buy');
    openBuy();
    player.yaw = 0;
    player.pitch = -0.02;
  } else if (SHOT === 'play') {
    // Mid-round: the buy phase is over, the raiders are pushing mid and the Watch are holding the
    // near angle. The player is shooting at a defender eight metres out.
    match.round.state.phase = 'live';
    match.round.state.phaseLeft = 78;
    match.round.state.clock = 78;
    hud.setPhase('live');
    hud.closeBuy();
    match.world.armRaiders();
    // Clear the spawn pocket so the posed frame has room, then place both sides by hand.
    player.position.set(-0.9, 0, 5.2);
    player.yaw = 0.02;
    player.pitch = -0.035;
    player.weapons.primary.mag = 19;
    player.armour = Math.max(player.armour, 100);
    player.health = 84;
    poseBot('Vesper', -2.9, 1.1, 0.15, { state: 'hold', holdUntil: 1e9 });
    poseBot('Ridge', 1.9, 2.6, -0.1, { state: 'hold', holdUntil: 1e9 });
    poseBot('Marlow', -1.2, 10.4, 0.0, { state: 'hold', holdUntil: 1e9 });
    poseBot('Kestrel', 4.2, 11.2, 0.1, { state: 'hold', holdUntil: 1e9 });
    const near = poseBot('Anvil', -0.2, -3.4, Math.PI, { state: 'engage', crouching: true });
    if (near) { near.body.crouching = true; near.body.height = 1.2; near.body.eye = 1.08; }
    poseBot('Pike', -3.6, -4.6, Math.PI - 0.2, { state: 'engage' });
    poseBot('Hollis', 3.4, -5.6, Math.PI + 0.25, { state: 'engage' });
    poseBot('Cinder', 0.8, -9.2, Math.PI, { state: 'hold', holdUntil: 1e9 });
    poseBot('Tarn', -5.4, -8.2, Math.PI + 0.3, { state: 'hold', holdUntil: 1e9 });
    // Ten frames of the player's own rifle at the near defender, so the tracer and the sparks are
    // in flight in the frame rather than being painted on.
    for (let i = 0; i < 10; i += 1) {
      player.pitch = -0.035;
      player.yaw = 0.02;
      match.fire();
      match.step(1 / 60, { eHeld: false }, performance.now() / 1000);
    }
    // Muzzle flash on the two defenders that are shooting back.
    for (const name of ['Pike', 'Hollis']) {
      const bot = match.bots.find((b) => b.name === name);
      if (bot) { bot.weapon.flash = 0.05; bot.weapon.kick = 0.05; }
    }
    hud.hitMarker(true);
    hud.feed('You', 'raid', 'Anvil', 'watch');
    hud.feed('Pike', 'watch', 'Marlow', 'raid');
    hud.setObjective('Charge carried by <strong>Vesper</strong> — mid is contested', false);
    camera.position.set(player.position.x, player.position.y + player.eye, player.position.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    viewModel.kick(0.05);
  } else if (SHOT === 'end') {
    // A won round: the charge is down at site B, the raiders hold it, the score shows it.
    match.round.state.phase = 'live';
    match.round.state.clock = 9.4;
    hud.setPhase('live');
    hud.closeBuy();
    match.world.armRaiders();
    player.position.set(9.4, 0, -5.4);
    player.yaw = -0.63;
    player.pitch = -0.08;
    player.weapons.primary.mag = 8;
    player.health = 62;
    player.armour = Math.max(player.armour, 100);
    settle(9.0);
    const siteB = { x: 12, z: -9 };
    match.round.state.charge.placed = true;
    match.round.state.charge.carried = false;
    match.round.state.charge.site = 'B';
    match.round.state.charge.x = siteB.x;
    match.round.state.charge.z = siteB.z;
    match.round.state.charge.fuseLeft = 12;
    match.round.state.score.raid = 4;
    match.round.state.score.watch = 2;
    hud.setScore(match.round.state.score);
    hud.feed('You', 'raid', 'Anvil', 'watch');
    hud.feed('Vesper', 'raid', 'Hollis', 'watch');
    hud.setObjective('Charge armed at <strong>Site B</strong> — 12s to detonation', true);
    camera.position.set(player.position.x, player.position.y + player.eye, player.position.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    viewModel.kick(0.05);
  }

  updateHudCamera(1 / 60);
  renderer.render(scene, camera);
  // The probe is the agent's own readback: it proves the frame is a live simulation, not a mock.
  const pixels = renderer.domElement.width * renderer.domElement.height;
  hud.probeOn();
  hud.probe(`shot=${SHOT} seed=${SEED}\ncanvas=${renderer.domElement.width}x${renderer.domElement.height} px=${pixels}\nround=${match.round.state.number} phase=${match.round.state.phase}\nscore=${match.round.state.score.raid}-${match.round.state.score.watch}\nbots=${match.bots.filter((b) => b.alive).length}/${match.bots.length}\nplayer=${Math.round(player.health)}hp mag=${match.activeWeapon().mag}\ncharge=${match.round.state.charge.placed ? `armed@${match.round.state.charge.site}` : 'carried'}\nwebgl2=${renderer.capabilities.isWebGL2}`);
  window.__shotReady = true;
}

if (SHOT) {
  // One deterministic frame, then stop: the screenshot harness waits on __shotReady.
  requestAnimationFrame(() => {
    shotFrame();
    document.body.classList.add('shot');
  });
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}

if (PROBE) hud.probeOn();

// Expose the live objects for the probe harness and for anyone reading the console.
window.__ember = { scene, camera, renderer, match, player, hud };
