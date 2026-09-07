// game.js — състояния, вълни, точки, прегряване, живот.
// Логиката не знае нищо за WebXR: получава dt, камера и "къде мога да родя
// цел". Затова същият клас върви и в gyro режима без AR.

import * as THREE from 'three';
import { Target, TYPES, rollType } from './targets.js';

export const STATE = {
  SCANNING: 'scanning',
  PLAYING: 'playing',
  OVER: 'over'
};

const WAVE_SECONDS = 30;
const MAX_HEAT = 1.0;
const HEAT_PER_SHOT = 0.14;
const HEAT_DECAY = 0.32;
const OVERHEAT_LOCK = 1.6;
const COMBO_WINDOW = 2.5;

export class Game {
  constructor(scene, camera, hooks = {}) {
    this.scene = scene;
    this.camera = camera;
    this.hooks = hooks; // { onHit, onMiss, onSting, onSpawn, onOver, onWave }

    this.group = new THREE.Group();
    this.group.name = 'targets';
    scene.add(this.group);

    this.reset();
  }

  reset() {
    for (const t of this.targets || []) {
      this.group.remove(t.object);
      t.dispose();
    }
    this.targets = [];
    this.state = STATE.SCANNING;
    this.score = 0;
    this.health = 100;
    this.wave = 1;
    this.waveClock = 0;
    this.elapsed = 0;
    this.heat = 0;
    this.overheatFor = 0;
    this.combo = 0;
    this.comboClock = 0;
    this.shots = 0;
    this.hits = 0;
    this.spawnClock = 0;
    this.best = Number(localStorage.getItem('arhunt.best') || 0);
  }

  start() {
    this.state = STATE.PLAYING;
    this.spawnClock = 0.4;
  }

  get multiplier() {
    return Math.min(4, 1 + Math.floor(this.combo / 3) * 0.5);
  }

  get accuracy() {
    return this.shots ? Math.round((this.hits / this.shots) * 100) : 0;
  }

  get spawnInterval() {
    // Вълна 1 → 1.9s, стабилизира се около 0.6s
    return Math.max(0.6, 2.1 - this.wave * 0.2);
  }

  get maxAlive() {
    return Math.min(9, 3 + this.wave);
  }

  /* ---------------------------------------------------------------- */
  /* Стрелба                                                           */
  /* ---------------------------------------------------------------- */
  // raycaster: THREE.Raycaster вече насочен от контролера/тапа
  shoot(raycaster) {
    if (this.state !== STATE.PLAYING) return { result: 'idle' };
    if (this.overheatFor > 0) return { result: 'overheated' };

    this.shots++;
    this.heat = Math.min(MAX_HEAT, this.heat + HEAT_PER_SHOT);
    if (this.heat >= MAX_HEAT) this.overheatFor = OVERHEAT_LOCK;

    const meshes = this.targets.filter((t) => !t.dead).map((t) => t.object);
    const inter = raycaster.intersectObjects(meshes, true);

    if (!inter.length) {
      this.combo = 0;
      this.hooks.onMiss?.();
      return { result: 'miss' };
    }

    // Търсим нагоре по йерархията, докато намерим Target
    let node = inter[0].object;
    while (node && !node.userData.target) node = node.parent;
    const target = node?.userData.target;
    if (!target) return { result: 'miss' };

    this.hits++;

    if (target.penalty) {
      // Мимик: наказание и нулиран комбо
      this.score = Math.max(0, this.score + target.points);
      this.combo = 0;
      target.dead = true;
      this.hooks.onHit?.(target, target.points, false);
      return { result: 'mimic', target, points: target.points };
    }

    const killed = target.hit();
    if (!killed) {
      this.hooks.onHit?.(target, 0, true);
      return { result: 'wound', target, points: 0 };
    }

    const gained = Math.round(target.points * this.multiplier);
    this.score += gained;
    this.combo++;
    this.comboClock = COMBO_WINDOW;
    this.hooks.onHit?.(target, gained, false);
    return { result: 'kill', target, points: gained };
  }

  /* ---------------------------------------------------------------- */
  /* Кадър                                                             */
  /* ---------------------------------------------------------------- */
  // spawnPose: { position: Vector3 } или null, ако още няма равнина
  update(dt, spawnPose) {
    if (this.state !== STATE.PLAYING) return;

    this.elapsed += dt;
    this.waveClock += dt;

    if (this.waveClock >= WAVE_SECONDS) {
      this.waveClock = 0;
      this.wave++;
      this.health = Math.min(100, this.health + 8); // малка награда за оцеляване
      this.hooks.onWave?.(this.wave);
    }

    // Топлина
    if (this.overheatFor > 0) {
      this.overheatFor -= dt;
      this.heat = Math.max(0, this.heat - dt * (MAX_HEAT / OVERHEAT_LOCK));
    } else {
      this.heat = Math.max(0, this.heat - HEAT_DECAY * dt);
    }

    // Комбо прозорец
    if (this.comboClock > 0) {
      this.comboClock -= dt;
      if (this.comboClock <= 0) this.combo = 0;
    }

    // Раждане
    this.spawnClock -= dt;
    const alive = this.targets.filter((t) => !t.dead).length;
    if (this.spawnClock <= 0 && alive < this.maxAlive) {
      const type = rollType(this.wave);
      const pos = this.pickPosition(type, spawnPose);
      if (pos) {
        const target = new Target(type, pos);
        this.targets.push(target);
        this.group.add(target.object);
        this.hooks.onSpawn?.(target);
      }
      this.spawnClock = this.spawnInterval;
    }

    // Живот на целите
    for (const t of this.targets) {
      if (t.dead) continue;
      const event = t.update(dt, this.camera);
      if (event === 'sting') {
        this.health -= 12;
        this.combo = 0;
        this.hooks.onSting?.(t);
      }
    }

    // Чистене
    const still = [];
    for (const t of this.targets) {
      if (t.dead) {
        this.group.remove(t.object);
        t.dispose();
      } else {
        still.push(t);
      }
    }
    this.targets = still;

    if (this.health <= 0) this.end();
  }

  pickPosition(type, spawnPose) {
    const cam = this.camera;

    // Дроновете идват от въздуха около играча — не им трябва равнина
    if (type === TYPES.DRONE) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 2.0 + Math.random() * 1.8;
      return new THREE.Vector3(
        cam.position.x + Math.cos(angle) * dist,
        cam.position.y + (Math.random() - 0.3) * 0.9,
        cam.position.z + Math.sin(angle) * dist
      );
    }

    // Останалите сядат върху открита равнина, ако има такава
    if (spawnPose) {
      const jitter = new THREE.Vector3(
        (Math.random() - 0.5) * 0.7,
        0.12 + Math.random() * 0.35,
        (Math.random() - 0.5) * 0.7
      );
      return spawnPose.position.clone().add(jitter);
    }

    // Без равнина: пред камерата, за да не спре играта
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    return cam.position
      .clone()
      .addScaledVector(forward, 1.2 + Math.random() * 1.6)
      .addScaledVector(right, (Math.random() - 0.5) * 1.4)
      .add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.7, 0));
  }

  end() {
    if (this.state === STATE.OVER) return;
    this.state = STATE.OVER;
    if (this.score > this.best) {
      this.best = this.score;
      localStorage.setItem('arhunt.best', String(this.score));
    }
    this.hooks.onOver?.({
      score: this.score,
      wave: this.wave,
      accuracy: this.accuracy,
      best: this.best
    });
  }
}
