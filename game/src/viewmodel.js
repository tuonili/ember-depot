// The first-person view model: the gun in the corner of the screen, built from boxes so it needs no
// model files, plus the muzzle flash and the sway that makes a moving player's gun move. It lives in
// the camera's space, so it is never occluded by the world and never needs its own light.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const REST = new THREE.Vector3(0.26, -0.23, -0.46);

// Each gun's silhouette, in metres, from its own numbers: long barrels for the sniper, a fat body
// for the shotgun.
const SHAPES = {
  ranger: { body: [0.09, 0.11, 0.46], barrel: [0.045, 0.045, 0.44], barrelY: 0.025, mag: [0.05, 0.16, 0.1], stock: 0.24 },
  hound: { body: [0.11, 0.13, 0.4], barrel: [0.075, 0.075, 0.36], barrelY: 0.03, mag: [0.06, 0.1, 0.08], stock: 0.2 },
  warden: { body: [0.09, 0.12, 0.56], barrel: [0.05, 0.05, 0.62], barrelY: 0.02, mag: [0.05, 0.14, 0.09], stock: 0.3 },
  kestrel: { body: [0.08, 0.1, 0.4], barrel: [0.04, 0.04, 0.34], barrelY: 0.02, mag: [0.04, 0.18, 0.08], stock: 0.18 },
  sidearm: { body: [0.06, 0.09, 0.24], barrel: [0.035, 0.035, 0.16], barrelY: 0.03, mag: [0.04, 0.12, 0.06], stock: 0 },
};

export function createViewModel(camera) {
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.62, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.9, metalness: 0.1 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.12 });

  const holder = new THREE.Group();
  holder.position.copy(REST);
  camera.add(holder);

  const model = new THREE.Group();
  holder.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.visible = false;
  holder.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 4.5);
  camera.add(flashLight);

  let current = null;
  const cache = new Map();

  function build(id) {
    const shape = SHAPES[id] ?? SHAPES.ranger;
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(...shape.body), metal);
    group.add(body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(...shape.barrel), dark);
    barrel.position.set(0, shape.barrelY, -(shape.body[2] / 2 + shape.barrel[2] / 2 - 0.02));
    group.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(...shape.mag), accent);
    mag.position.set(0, -shape.body[1] / 2 - shape.mag[1] / 2 + 0.02, -0.04);
    group.add(mag);
    if (shape.stock > 0) {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, shape.stock), dark);
      stock.position.set(0, -0.02, shape.body[2] / 2 + shape.stock / 2 - 0.04);
      group.add(stock);
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, shape.stock * 0.6), metal);
      cheek.position.set(0, 0.05, shape.body[2] / 2 + shape.stock / 2);
      group.add(cheek);
    }
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.02), accent);
    sight.position.set(0, shape.body[1] / 2 + 0.025, -0.08);
    group.add(sight);
    return group;
  }

  function equip(id) {
    if (current === id) return;
    current = id;
    for (const child of [...model.children]) model.remove(child);
    let built = cache.get(id);
    if (!built) {
      built = build(id);
      cache.set(id, built);
    }
    model.add(built);
    flash.position.set(0, 0.01, -(SHAPES[id]?.barrel?.[2] ?? 0.4) - 0.42);
    flashLight.position.set(0, 0, -0.5);
  }

  // The animation state, all of it damping towards a resting pose.
  const anim = { kick: 0, sway: new THREE.Vector2(), swayTarget: new THREE.Vector2(), bob: 0, reload: 0, raise: 1, punch: 0 };

  function step(dt, { weapon, body, spread }) {
    equip(weapon.def.id);
    anim.kick += (0 - anim.kick) * Math.min(1, dt * 15);
    anim.punch += (0 - anim.punch) * Math.min(1, dt * 9);
    // Sway follows the mouse, so the gun lags the view instead of being welded to it.
    anim.swayTarget.set(Math.max(-0.5, Math.min(0.5, body.lookDeltaX * 0.02)), Math.max(-0.5, Math.min(0.5, body.lookDeltaY * 0.02)));
    anim.sway.x += (anim.swayTarget.x - anim.sway.x) * Math.min(1, dt * 8);
    anim.sway.y += (anim.swayTarget.y - anim.sway.y) * Math.min(1, dt * 8);
    anim.bob += body.speed * dt * 9;
    anim.reload = weapon.reloadLeft > 0 ? weapon.reloadLeft / weapon.def.reloadTime : 0;
    anim.raise += ((weapon.mag === 0 ? 0.82 : 1) - anim.raise) * Math.min(1, dt * 10);

    const bobX = Math.cos(anim.bob) * 0.008 * Math.min(1, body.speed / 4);
    const bobY = Math.abs(Math.sin(anim.bob)) * 0.007 * Math.min(1, body.speed / 4);
    const reloadDip = Math.sin(Math.min(1, anim.reload) * Math.PI) * 0.28;

    holder.position.set(
      REST.x + anim.sway.x + bobX,
      REST.y + anim.sway.y * 0.5 + bobY - reloadDip - anim.punch * 0.05,
      REST.z + anim.kick,
    );
    holder.rotation.set(
      anim.kick * 2.4 + reloadDip * 1.1 - anim.punch * 0.4,
      anim.sway.x * 1.6,
      anim.sway.y * 0.8 + reloadDip * 0.5,
    );
    model.scale.setScalar(anim.raise);

    flash.visible = weapon.flash > 0;
    flash.rotation.z = weapon.flash * 26;
    flash.scale.setScalar(0.85 + weapon.flash * 6);
    flashLight.intensity = weapon.flash > 0 ? 14 : 0;

    // The crosshair gap mirrors the real spread, so the reticle is a measurement and not decoration.
    return spread;
  }

  return {
    step,
    equip,
    kick(amount = 0.05) {
      anim.kick = amount;
      anim.punch = Math.min(1, anim.punch + 0.5);
    },
    flashLight,
  };
}
