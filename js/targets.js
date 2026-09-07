// targets.js — четирите типа цели. Цялата геометрия е процедурна,
// в репото няма нито един асет: нищо за сваляне, нищо за кеширане.

import * as THREE from 'three';

export const TYPES = {
  ORB: 'orb',
  DRONE: 'drone',
  MIMIC: 'mimic',
  BONUS: 'bonus'
};

const SPEC = {
  [TYPES.ORB]: { points: 10, life: 9.0, hp: 1, color: 0x35e08a, emissive: 0x0d5c38 },
  [TYPES.DRONE]: { points: 25, life: 14.0, hp: 2, color: 0xff5a4d, emissive: 0x6a1208 },
  [TYPES.MIMIC]: { points: -20, life: 7.5, hp: 1, color: 0x35e08a, emissive: 0x0d5c38 },
  [TYPES.BONUS]: { points: 60, life: 4.0, hp: 1, color: 0xffd24a, emissive: 0x7a5a00 }
};

function orbMesh(color, emissive) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.075, 1),
    new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.1
    })
  );
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.105, 0),
    new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.4
    })
  );
  g.add(core, shell);
  g.userData.shell = shell;
  return g;
}

function droneMesh(color, emissive) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.07, 0),
    new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 0.7,
      roughness: 0.25,
      metalness: 0.6
    })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.008, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333, roughness: 0.4 })
  );
  ring.rotation.x = Math.PI / 2;
  g.add(body, ring);
  g.userData.ring = ring;
  return g;
}

function bonusMesh(color, emissive) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.08, 0),
    new THREE.MeshStandardMaterial({
      color,
      emissive,
      emissiveIntensity: 1.4,
      roughness: 0.1,
      metalness: 0.85
    })
  );
  g.add(core);
  return g;
}

let nextId = 1;

export class Target {
  constructor(type, position) {
    const spec = SPEC[type];
    this.id = nextId++;
    this.type = type;
    this.points = spec.points;
    this.hp = spec.hp;
    this.life = spec.life;
    this.age = 0;
    this.dead = false;
    this.anchor = null; // XRAnchor, ако средата го дава
    this.hostile = type === TYPES.DRONE;
    this.penalty = type === TYPES.MIMIC;

    if (type === TYPES.DRONE) this.object = droneMesh(spec.color, spec.emissive);
    else if (type === TYPES.BONUS) this.object = bonusMesh(spec.color, spec.emissive);
    else this.object = orbMesh(spec.color, spec.emissive);

    this.object.position.copy(position);
    this.home = position.clone();
    this.object.userData.target = this;

    // Всяка цел получава собствена фаза, за да не пулсират в такт
    this.phase = Math.random() * Math.PI * 2;
    this.orbitSpeed = 0.5 + Math.random() * 0.6;
    this.orbitRadius = 0.15 + Math.random() * 0.25;
  }

  // Връща 'sting', ако дрон е стигнал играча
  update(dt, camera) {
    this.age += dt;
    const t = this.age + this.phase;

    switch (this.type) {
      case TYPES.ORB:
        this.object.rotation.y += dt * 1.4;
        this.object.position.y = this.home.y + Math.sin(t * 2.0) * 0.045;
        break;

      case TYPES.MIMIC:
        // Разликата с ORB е единствената улика: мимикът не се върти,
        // а пулсира. Който стреля по рефлекс, губи точки.
        this.object.rotation.y = 0;
        this.object.scale.setScalar(1 + Math.sin(t * 5.5) * 0.14);
        this.object.position.y = this.home.y + Math.sin(t * 2.0) * 0.045;
        break;

      case TYPES.BONUS:
        this.object.rotation.x += dt * 2.2;
        this.object.rotation.y += dt * 3.1;
        this.object.position.y = this.home.y + Math.sin(t * 3.4) * 0.09;
        break;

      case TYPES.DRONE: {
        // Обикаля около играча и бавно се приближава
        const toPlayer = new THREE.Vector3()
          .subVectors(camera.position, this.object.position);
        const dist = toPlayer.length();
        toPlayer.normalize();

        const side = new THREE.Vector3()
          .crossVectors(toPlayer, new THREE.Vector3(0, 1, 0))
          .normalize();

        const approach = dist > 0.8 ? 0.35 : 0.0;
        this.object.position.addScaledVector(toPlayer, approach * dt);
        this.object.position.addScaledVector(side, Math.sin(t * this.orbitSpeed) * 0.5 * dt);
        this.object.position.y += Math.cos(t * 1.7) * 0.12 * dt;

        this.object.lookAt(camera.position);
        if (this.object.userData.ring) this.object.userData.ring.rotation.z += dt * 6;

        if (dist < 0.65) {
          this.dead = true;
          return 'sting';
        }
        break;
      }
    }

    if (this.type !== TYPES.DRONE) this.object.lookAt(camera.position);

    // Избледняване в последната секунда
    const left = this.life - this.age;
    if (left < 1.0) this.setOpacity(Math.max(0, left));
    if (this.age >= this.life) {
      this.dead = true;
      return 'expired';
    }
    return null;
  }

  setOpacity(v) {
    this.object.traverse((o) => {
      if (o.material) {
        if (o.material.userData.baseOpacity === undefined) {
          o.material.userData.baseOpacity = o.material.opacity;
        }
        o.material.transparent = true;
        o.material.opacity = o.material.userData.baseOpacity * v;
      }
    });
  }

  hit() {
    this.hp -= 1;
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    // Още жива: премигва
    this.object.traverse((o) => {
      if (o.material && o.material.emissiveIntensity !== undefined) {
        o.material.emissiveIntensity = 3.0;
        setTimeout(() => { o.material.emissiveIntensity = 0.8; }, 90);
      }
    });
    return false;
  }

  dispose() {
    this.object.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    if (this.anchor && this.anchor.delete) {
      try { this.anchor.delete(); } catch (_) { /* нищо */ }
    }
  }
}

// Кой тип пада на дадена вълна — трудността расте с номера
export function rollType(wave) {
  const r = Math.random();
  if (wave >= 3 && r < 0.06) return TYPES.BONUS;
  if (wave >= 2 && r < 0.28) return TYPES.MIMIC;
  if (wave >= 2 && r < 0.62) return TYPES.DRONE;
  if (wave === 1 && r < 0.25) return TYPES.DRONE;
  return TYPES.ORB;
}
