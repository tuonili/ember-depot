// Turns map.js data into three.js meshes, and returns the two things the simulation needs from it:
// the collider boxes it resolves movement against and the meshes a bullet can stop on. Plain boxes
// only, one material per palette name, and one shadow-casting key light, so the map reads as
// geometry rather than as texture work.
import * as THREE from 'three';
import { PALETTE, TONES } from './palette.js';
import { WALLS, PROPS, SITE_DRUMS, SITES, BOUNDS } from './map.js';

const FLOOR_TILE = 4;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = new Map();
  function material(name) {
    let found = materials.get(name);
    if (found) return found;
    const colour = TONES[name] ?? PALETTE[name] ?? PALETTE.surface;
    found = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colour),
      roughness: name === 'accent' || name === 'raid' ? 0.6 : 0.92,
      metalness: name === 'ink' ? 0.3 : 0.02,
    });
    materials.set(name, found);
    return found;
  }

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(mat));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // The floor is one big slab and a grid of thin raised tiles: it catches the light without a texture.
  const width = BOUNDS.maxX - BOUNDS.minX + 4;
  const depth = BOUNDS.maxZ - BOUNDS.minZ + 4;
  box(width, 0.5, depth, 0, -0.25, 0, 'floor');
  for (let x = BOUNDS.minX + FLOOR_TILE / 2; x < BOUNDS.maxX; x += FLOOR_TILE) {
    for (let z = BOUNDS.minZ + FLOOR_TILE / 2; z < BOUNDS.maxZ; z += FLOOR_TILE) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_TILE - 0.14, 0.04, FLOOR_TILE - 0.14), material('surface'));
      tile.position.set(x, 0.02, z);
      tile.receiveShadow = true;
      group.add(tile);
    }
  }

  // The bomb sites: a painted slab each, so the objective is a place on the floor and not a label.
  for (const site of SITES) {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(site.radius * 2, 0.05, site.radius * 2), material('raid'));
    pad.position.set(site.x, 0.045, site.z);
    pad.rotation.y = Math.PI / 4;
    pad.receiveShadow = true;
    group.add(pad);
    for (let i = 0; i < 4; i += 1) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(site.radius * 1.9, 0.02, 0.16), material('canvas'));
      stripe.position.set(site.x, 0.075, site.z);
      stripe.rotation.y = Math.PI / 4;
      stripe.position.x += Math.cos((i * Math.PI) / 4 + Math.PI / 4) * 0.9;
      stripe.position.z += Math.sin((i * Math.PI) / 4 + Math.PI / 4) * 0.9;
      group.add(stripe);
    }
  }

  for (const wall of [...WALLS, ...PROPS, ...SITE_DRUMS]) {
    box(wall.w, wall.h, wall.d, wall.x, wall.h / 2, wall.z, wall.mat);
  }

  // The roof. The map is enclosed, so without one the top of every frame is the empty background;
  // a dark deck with beams makes the depot read as a building and closes the silhouette.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 0.4, depth + 2), material('floor'));
  roof.position.set(0, 4.55, 0);
  group.add(roof);
  for (const z of [-12, -6, 0, 6, 12]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 1, 0.34, 0.42), material('trim'));
    beam.position.set(0, 4.28, z);
    beam.castShadow = true;
    group.add(beam);
  }
  for (const x of [-10, 0, 10]) {
    const truss = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, depth + 1), material('trim'));
    truss.position.set(x, 4.3, 0);
    truss.castShadow = true;
    group.add(truss);
  }

  // Skylights: two emissive strips over the mid lane, purely so the ceiling of the mood is lit
  // unevenly and the sites read darker than the middle.
  for (const z of [2.2, -6.4]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink) }));
    strip.position.set(0, 4.06, z);
    group.add(strip);
    const glow = new THREE.PointLight(new THREE.Color('#ffe9c9'), 22, 20, 2);
    glow.position.set(0, 3.7, z);
    group.add(glow);
  }

  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.ink), new THREE.Color(TONES.floor), 2.5);
  scene.add(sky);

  const key = new THREE.DirectionalLight(new THREE.Color('#fff2dc'), 3.1);
  key.position.set(11, 18, 9);
  key.target.position.set(-2, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0007;
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.watch), 0.85);
  fill.position.set(-12, 10, 14);
  scene.add(fill);

  // A warm rim from the north wall, so the two teams' colours separate where they meet in mid.
  const rim = new THREE.DirectionalLight(new THREE.Color(PALETTE.raid), 0.7);
  rim.position.set(0, 7, -18);
  scene.add(rim);

  const ambient = new THREE.AmbientLight(new THREE.Color('#5a5348'), 0.85);
  scene.add(ambient);

  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 34, 78);

  return { colliders, shootables, group };
}
