// Everything that is drawn but never simulated: tracers, impact sparks, dust and the blast flare.
// Each effect is a pooled object with a lifetime, so a long round allocates nothing after warm-up.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createEffects(scene) {
  // Tracers: a thin bright line from muzzle to impact, faded by scaling opacity down over 80 ms.
  const tracerMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#ffd9a0'),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const tracerGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true);
  const tracers = [];
  for (let i = 0; i < 26; i += 1) {
    const mesh = new THREE.Mesh(tracerGeometry, tracerMaterial.clone());
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, max: 0.08 });
  }
  let tracerCursor = 0;

  // Impacts: a small additive sprite that flares and dies.
  const sparkGeometry = new THREE.SphereGeometry(0.055, 6, 5);
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffca89'), transparent: true, opacity: 0.9, depthWrite: false });
  const sparks = [];
  for (let i = 0; i < 40; i += 1) {
    const mesh = new THREE.Mesh(sparkGeometry, sparkMaterial.clone());
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, max: 0.22 });
  }
  let sparkCursor = 0;

  // Blade marks on the floor and walls, kept from the last two rounds only.
  const decalGeometry = new THREE.CircleGeometry(0.055, 6);
  const decalMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.hairline), transparent: true, opacity: 0.55, depthWrite: false });
  const decals = [];
  const DECAL_CAP = 90;
  let decalCursor = 0;

  const blastLight = new THREE.PointLight(new THREE.Color('#ffb066'), 0, 26, 2);
  scene.add(blastLight);
  let blastLife = 0;

  const up = new THREE.Vector3(0, 1, 0);
  const seg = new THREE.Vector3();

  return {
    tracer(from, to) {
      const slot = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % tracers.length;
      seg.subVectors(to, from);
      const length = seg.length();
      if (length < 0.2) return;
      slot.mesh.position.copy(from).addScaledVector(seg, 0.5);
      slot.mesh.quaternion.setFromUnitVectors(up, seg.clone().normalize());
      slot.mesh.scale.set(1, length, 1);
      slot.mesh.visible = true;
      slot.mesh.material.opacity = 0.85;
      slot.life = slot.max;
    },
    impact(point, normal) {
      const slot = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % sparks.length;
      slot.mesh.position.copy(point).addScaledVector(normal, 0.04);
      slot.mesh.visible = true;
      slot.mesh.material.opacity = 0.95;
      slot.mesh.scale.setScalar(1);
      slot.life = slot.max;
      // A decal on the first surface, oriented to the normal.
      let decal = decals[decalCursor];
      if (!decal) {
        decal = new THREE.Mesh(decalGeometry, decalMaterial);
        scene.add(decal);
        decals[decalCursor] = decal;
      }
      decalCursor = (decalCursor + 1) % DECAL_CAP;
      decal.position.copy(point).addScaledVector(normal, 0.012);
      decal.lookAt(point.clone().add(normal));
      decal.visible = true;
    },
    blast(point) {
      blastLight.position.copy(point);
      blastLight.intensity = 90;
      blastLife = 0.5;
      this.impact(point, up);
    },
    step(dt) {
      for (const slot of tracers) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.mesh.material.opacity = Math.max(0, (slot.life / slot.max) * 0.85);
        if (slot.life <= 0) slot.mesh.visible = false;
      }
      for (const slot of sparks) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        const t = Math.max(0, slot.life / slot.max);
        slot.mesh.material.opacity = t * 0.95;
        slot.mesh.scale.setScalar(0.6 + (1 - t) * 1.8);
        if (slot.life <= 0) slot.mesh.visible = false;
      }
      if (blastLife > 0) {
        blastLife -= dt;
        blastLight.intensity = Math.max(0, blastLife / 0.5) * 90;
      }
    },
    clearDecals() {
      for (const decal of decals) if (decal) decal.visible = false;
    },
  };
}
