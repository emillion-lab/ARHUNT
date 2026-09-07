// fallback.js — режим за телефони без ARCore/WebXR.
// Камерата е просто видео зад прозрачния canvas, а въртенето идва от
// жироскопа. Няма равнини и няма дълбочина, но игровата логика е същата:
// целите живеят в свят, закотвен към компаса, не към екрана.

import * as THREE from 'three';

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -PI/2 по X

function setQuaternion(quat, alpha, beta, gamma, orient) {
  euler.set(beta, alpha, -gamma, 'YXZ');
  quat.setFromEuler(euler);
  quat.multiply(q1);
  quat.multiply(q0.setFromAxisAngle(zee, -orient));
}

export class FallbackMode {
  constructor({ renderer, scene, camera, video }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.video = video;
    this.orientation = { alpha: 0, beta: 0, gamma: 0 };
    this.screenOrientation = 0;
    this.running = false;
    this.onFrame = null;
    this._tick = this._tick.bind(this);
    this._onOrient = this._onOrient.bind(this);
  }

  static available() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async requestMotionPermission() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      try {
        const res = await D.requestPermission();
        return res === 'granted';
      } catch (_) {
        return false;
      }
    }
    return true;
  }

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    this.stream = stream;
    this.video.srcObject = stream;
    await this.video.play();

    await this.requestMotionPermission();
    window.addEventListener('deviceorientation', this._onOrient, true);
    window.addEventListener('orientationchange', () => {
      this.screenOrientation = THREE.MathUtils.degToRad(window.orientation || 0);
    });

    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this._tick);
  }

  _onOrient(e) {
    if (e.alpha === null) return;
    this.orientation = {
      alpha: THREE.MathUtils.degToRad(e.alpha),
      beta: THREE.MathUtils.degToRad(e.beta),
      gamma: THREE.MathUtils.degToRad(e.gamma)
    };
    this.hasOrientation = true;
  }

  _tick(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.hasOrientation) {
      const { alpha, beta, gamma } = this.orientation;
      setQuaternion(this.camera.quaternion, alpha, beta, gamma, this.screenOrientation);
    }
    this.camera.updateMatrixWorld(true);

    this.onFrame?.(dt);
    this.renderer.render(this.scene, this.camera);
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('deviceorientation', this._onOrient, true);
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.video.srcObject = null;
  }
}
