// Movement for the player and, in the same code path, for the bots: one body type resolved
// against the map's AABB colliders one axis at a time. It has acceleration and friction so a
// player cannot change direction at full speed, a crouch that lowers the eye and the hitbox, and
// a walk speed that trades pace for silence. A bot body is this body with a different intent.
import * as THREE from 'three';

export const BODY = {
  radius: 0.36,
  standHeight: 1.78,
  crouchHeight: 1.2,
  standEye: 1.64,
  crouchEye: 1.08,
  runSpeed: 5.6,
  walkSpeed: 2.5,
  crouchSpeed: 2.3,
  groundAccel: 40,
  airAccel: 8,
  friction: 9.5,
  gravity: 20,
  jumpSpeed: 6.1,
};

const probe = new THREE.Box3();
const wish = new THREE.Vector3();

export function createBody(colliders, spawn) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: spawn.yaw ?? 0,
    pitch: 0,
    eye: BODY.standEye,
    height: BODY.standHeight,
    onGround: true,
    crouching: false,
    walking: false,
    alive: true,
    // Filled every step: what the shot resolver needs to know about this body's motion.
    speed: 0,
    groundSpeed: 0,
  };

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - BODY.radius, y + lift, z - BODY.radius);
    probe.max.set(x + BODY.radius, y + height - lift, z + BODY.radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // Blocks a line of sight: the same test a bullet uses, so what a bot sees is what it can hit.
  function blocked(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.001) return false;
    const steps = Math.ceil(length / 0.55);
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const px = from.x + dx * t;
      const py = from.y + dy * t;
      const pz = from.z + dz * t;
      if (py < 0.04) continue;
      for (const collider of colliders) {
        if (px > collider.min.x && px < collider.max.x && py > collider.min.y && py < collider.max.y && pz > collider.min.z && pz < collider.max.z) return true;
      }
    }
    return false;
  }

  // intent: { forward, strafe (-1..1), jump, crouch, walk, yaw }
  function step(dt, intent) {
    if (intent.crouch && !body.crouching) {
      body.crouching = true;
      body.height = BODY.crouchHeight;
    } else if (!intent.crouch && body.crouching) {
      if (!overlaps(body.position.x, body.position.y, body.position.z, BODY.standHeight, 0.02)) {
        body.crouching = false;
        body.height = BODY.standHeight;
      }
    }
    body.walking = !!intent.walk && !body.crouching;
    const eyeTarget = body.crouching ? BODY.crouchEye : BODY.standEye;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const sin = Math.sin(intent.yaw);
    const cos = Math.cos(intent.yaw);
    const forward = intent.forward ?? 0;
    const strafe = intent.strafe ?? 0;
    wish.set(0, 0, 0);
    if (forward || strafe) {
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe);
      if (wish.lengthSq() > 1) wish.normalize();
      else wish.normalize();
    }

    const top = body.crouching ? BODY.crouchSpeed : body.walking ? BODY.walkSpeed : BODY.runSpeed;
    const accel = body.onGround ? BODY.groundAccel : BODY.airAccel;
    const blend = Math.min(1, (accel * dt) / top);
    body.velocity.x += (wish.x * top - body.velocity.x) * blend;
    body.velocity.z += (wish.z * top - body.velocity.z) * blend;
    if (body.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - BODY.friction * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (intent.jump && body.onGround) {
      body.velocity.y = BODY.jumpSpeed;
      body.onGround = false;
    }
    body.velocity.y -= BODY.gravity * dt;

    const nx = body.position.x + body.velocity.x * dt;
    if (!overlaps(nx, body.position.y, body.position.z, body.height, 0.05)) body.position.x = nx;
    else body.velocity.x = 0;
    const nz = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nz, body.height, 0.05)) body.position.z = nz;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-32, body.velocity.y);

    body.speed = Math.hypot(body.velocity.x, body.velocity.z);
    body.groundSpeed = body.onGround ? body.speed : 0;
    return body;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
    // Kept for the view model, which lags the aim instead of being welded to it.
    body.lookDeltaX = dx;
    body.lookDeltaY = dy;
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function eyePosition(out = new THREE.Vector3()) {
    return out.set(body.position.x, body.position.y + body.eye, body.position.z);
  }

  // The body is both the data and the behaviour, so a caller that holds "a body" can move it,
  // ask what it can see, and read its position without unwrapping anything.
  Object.assign(body, { step, look, recoil, overlaps, blocked, eyePosition });
  body.state = body;
  body.lookDeltaX = 0;
  body.lookDeltaY = 0;
  return body;
}

// Where a body's hitbox sits: a capsule approximated by three stacked boxes, checked in this
// order, so a head shot is a head shot and not the top of a torso.
export function hitboxes(body) {
  const top = body.position.y + body.height;
  const mid = body.position.y + body.height * 0.52;
  const r = BODY.radius * 0.92;
  return [
    { part: 'head', y0: top - 0.28, y1: top, r: r * 0.62 },
    { part: 'chest', y0: mid, y1: top - 0.28, r },
    { part: 'legs', y0: body.position.y, y1: mid, r: r * 0.85 },
  ];
}
