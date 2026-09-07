// world.js — трите неща, които правят обектите да изглеждат "в стаята",
// а не залепени върху камерата: закриване от реални предмети, реално
// осветление и видими равнини.

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Закриване по дълбочина (CPU път)                                    */
/* ------------------------------------------------------------------ */
// Съзнателен избор: CPU depth вместо GPU shader.
// GPU дава закриване на ниво пиксел, но иска ръчно вкарване на чужд
// WebGLTexture в three.js материал — крехко и се чупи между версии.
// CPU дава закриване на ниво обект: целта изчезва зад дивана, но ръбът
// не е пикселно точен. За стрелба по цели това стига.
export class DepthOcclusion {
  constructor(active) {
    this.active = !!active;
    this.info = null;
    this.flipY = false; // някои реализации броят Y отгоре, други отдолу
    this.margin = 0.12; // метра толеранс, за да не мига по ръбовете
  }

  update(frame, view) {
    if (!this.active || !frame.getDepthInformation) return;
    try {
      this.info = frame.getDepthInformation(view);
    } catch (_) {
      this.info = null;
    }
  }

  // worldPos е THREE.Vector3 в същото пространство като камерата
  isOccluded(worldPos, camera) {
    if (!this.info) return false;

    const ndc = worldPos.clone().project(camera);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z > 1) return false;

    const x = (ndc.x + 1) / 2;
    let y = (1 - ndc.y) / 2;
    if (this.flipY) y = 1 - y;

    let real;
    try {
      real = this.info.getDepthInMeters(x, y);
    } catch (_) {
      return false;
    }
    if (!real || real <= 0 || !isFinite(real)) return false;

    const dist = camera.position.distanceTo(worldPos);
    return real + this.margin < dist;
  }
}

/* ------------------------------------------------------------------ */
/* Осветление от средата                                               */
/* ------------------------------------------------------------------ */
export class EnvLight {
  constructor(scene) {
    this.probe = new THREE.LightProbe();
    this.probe.intensity = 1;
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.position.set(0.5, 1, 0.25);
    this.ambient = new THREE.HemisphereLight(0xbfd4ff, 0x2a2a35, 0.55);
    scene.add(this.probe, this.sun, this.ambient);
    this.xrProbe = null;
  }

  async attach(session) {
    if (!session.requestLightProbe) return false;
    try {
      this.xrProbe = await session.requestLightProbe();
      return true;
    } catch (_) {
      this.xrProbe = null;
      return false;
    }
  }

  update(frame) {
    if (!this.xrProbe || !frame.getLightEstimate) return;
    const est = frame.getLightEstimate(this.xrProbe);
    if (!est) return;

    if (est.sphericalHarmonicsCoefficients) {
      this.probe.sh.fromArray(est.sphericalHarmonicsCoefficients);
      this.ambient.intensity = 0.15; // SH-то вече носи околната светлина
    }
    const dir = est.primaryLightDirection;
    const int = est.primaryLightIntensity;
    if (dir) this.sun.position.set(dir.x, dir.y, dir.z).multiplyScalar(4);
    if (int) {
      // intensity идва като RGB в произволна скала — вземаме яркостта
      const lum = 0.2126 * int.x + 0.7152 * int.y + 0.0722 * int.z;
      this.sun.intensity = THREE.MathUtils.clamp(lum, 0.2, 3.0);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Визуализация на открити равнини                                     */
/* ------------------------------------------------------------------ */
export class PlaneViz {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'planes';
    scene.add(this.group);
    this.known = new Map(); // XRPlane -> LineLoop
    this.material = new THREE.LineBasicMaterial({
      color: 0x4de3ff,
      transparent: true,
      opacity: 0.35
    });
    this.visible = true;
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  update(frame, refSpace) {
    const detected = frame.detectedPlanes;
    if (!detected) return;

    for (const plane of detected) {
      let line = this.known.get(plane);
      if (!line) {
        const geom = new THREE.BufferGeometry();
        line = new THREE.LineLoop(geom, this.material);
        line.frustumCulled = false;
        this.group.add(line);
        this.known.set(plane, line);
      }
      const pts = plane.polygon.map((p) => new THREE.Vector3(p.x, p.y, p.z));
      line.geometry.setFromPoints(pts);

      const pose = frame.getPose(plane.planeSpace, refSpace);
      if (pose) {
        line.matrix.fromArray(pose.transform.matrix);
        line.matrix.decompose(line.position, line.quaternion, line.scale);
      }
    }

    // махаме равнини, които ARCore е забравил
    for (const [plane, line] of this.known) {
      if (!detected.has(plane)) {
        this.group.remove(line);
        line.geometry.dispose();
        this.known.delete(plane);
      }
    }
  }

  get count() {
    return this.known.size;
  }
}
