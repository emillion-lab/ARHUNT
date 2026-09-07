// main.js — свързва всичко. Тук е единственото място, което знае
// едновременно за WebXR и за играта.

import * as THREE from 'three';
import { checkSupport, startSession, describeSession } from './xr.js';
import { DepthOcclusion, EnvLight, PlaneViz } from './world.js';
import { Game, STATE } from './game.js';
import { TYPES } from './targets.js';
import { Sound, haptic } from './audio.js';
import { HUD } from './hud.js';
import { FallbackMode } from './fallback.js';

const overlay = document.getElementById('overlay');
const startScreen = document.getElementById('start');
const video = document.getElementById('camera-feed');
const note = document.getElementById('support-note');

const hud = new HUD(overlay);

// Всяка стъпка от влизането в AR се изписва на екрана. Ако нещо забие,
// последният видим номер казва точно къде.
function stage(text) {
  note.textContent = text;
}

// Незадължителна подсистема: ако гръмне веднъж, изключваме я завинаги и
// продължаваме. Изключение в кадъра иначе спира целия рендер и играта
// изглежда замръзнала.
const broken = new Set();
function safe(name, fn) {
  if (broken.has(name)) return;
  try {
    fn();
  } catch (err) {
    broken.add(name);
    hud.toast(`изключих: ${name}`, 1800);
    console.warn(`[arhunt] ${name} гръмна:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Сцена                                                               */
/* ------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 40);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const sound = new Sound(camera);
scene.add(camera);

// Мерник върху открита равнина
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.09, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x4de3ff, transparent: true, opacity: 0.8 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const raycaster = new THREE.Raycaster();
const tmpMatrix = new THREE.Matrix4();
const humStops = new Map();

/* ------------------------------------------------------------------ */
/* Игра + звукови закачки                                              */
/* ------------------------------------------------------------------ */
const game = new Game(scene, camera, {
  onSpawn: (t) => {
    if (t.type === TYPES.DRONE) {
      const stop = sound.attachHum(t.object, 88 + Math.random() * 24);
      if (stop) humStops.set(t.id, stop);
    }
    if (t.type === TYPES.BONUS) hud.toast('бонус цел');
  },
  onHit: (t, points, wounded) => {
    if (wounded) { sound.wound(); return; }
    stopHum(t);
    if (t.penalty) {
      sound.mimic();
      hud.flash('bad');
      hud.toast(`мимик · ${points}`);
    } else if (t.type === TYPES.BONUS) {
      sound.bonus();
      hud.flash('hit');
      hud.toast(`+${points}`);
    } else {
      sound.kill();
      hud.flash('hit');
    }
  },
  onMiss: () => sound.miss(),
  onSting: (t) => {
    stopHum(t);
    sound.sting();
    hud.flash('hurt');
    haptic(activeInput, 1.0, 120);
  },
  onWave: (n) => {
    sound.wave();
    hud.toast(`вълна ${n}`, 1400);
  },
  onOver: (s) => {
    for (const stop of humStops.values()) stop();
    humStops.clear();
    hud.showPanel('Край', `
      <div class="stat"><span>Точки</span><b>${s.score}</b></div>
      <div class="stat"><span>Вълна</span><b>${s.wave}</b></div>
      <div class="stat"><span>Точност</span><b>${s.accuracy}%</b></div>
      <div class="stat"><span>Рекорд</span><b>${s.best}</b></div>
      <button id="again" class="btn">Отначало</button>
    `);
    document.getElementById('again').addEventListener('click', () => {
      hud.hidePanel();
      game.reset();
      game.start();
    });
  }
});

function stopHum(t) {
  const stop = humStops.get(t.id);
  if (stop) { stop(); humStops.delete(t.id); }
}

/* ------------------------------------------------------------------ */
/* AR режим                                                            */
/* ------------------------------------------------------------------ */
let session = null;
let refSpace = null;
let hitTestSource = null;
let caps = null;
let depth = null;
let planes = null;
let envLight = null;
let lastHitResult = null;
let lastHitPos = new THREE.Vector3();
let activeInput = null;
let lastTime = 0;
let scanClock = 0;
let arSupported = false;

async function enterAR() {
  // ВАЖНО: нито един await преди requestSession. Проверката за поддръжка
  // вече е направена при зареждане; ако я направим тук, Chrome губи
  // user activation-а от тапа и отказва сесията, понякога без грешка.
  stage('1 · искам сесия…');
  const started = await startSession(overlay);
  session = started.session;

  stage('2 · сесията тръгна');
  caps = describeSession(session);
  if (caps.unknown) {
    // Стар Chrome без enabledFeatures — предполагаме, че всичко е там
    caps = { ...caps, anchors: true, planes: true, depth: true, light: true };
  }
  hud.setCaps(caps);

  stage('3 · подавам на three.js');
  await renderer.xr.setSession(session);
  refSpace = renderer.xr.getReferenceSpace();

  stage('4 · hit-test');
  const viewerSpace = await session.requestReferenceSpace('viewer');
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  stage('5 · свят');
  depth = new DepthOcclusion(caps.depth);
  planes = new PlaneViz(scene);
  envLight = new EnvLight(scene);
  if (caps.light) await envLight.attach(session);

  await sound.resume();

  const controller = renderer.xr.getController(0);
  scene.add(controller);
  controller.addEventListener('selectstart', (e) => {
    activeInput = e.data;
    onSelect(controller, e.data);
  });

  session.addEventListener('end', () => {
    session = null;
    hitTestSource = null;
    renderer.xr.setAnimationLoop(null);
    startScreen.classList.remove('hidden');
    overlay.classList.add('hidden');
    stage('Сесията приключи.');
  });

  startScreen.classList.add('hidden');
  overlay.classList.remove('hidden');
  hud.status('насочи телефона към пода и го помърдай бавно');
  scanClock = 0;
  lastTime = 0;
  broken.clear();
  game.reset();

  renderer.xr.setAnimationLoop(onXRFrame);
}

function onSelect(controller, inputSource) {
  if (game.state === STATE.SCANNING) {
    game.start();
    hud.status('');
    hud.toast('лов');
    return;
  }
  if (game.state === STATE.OVER) return;

  tmpMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpMatrix);

  const res = game.shoot(raycaster);
  if (res.result === 'overheated') {
    sound.overheat();
    hud.toast('прегряване');
  } else if (res.result !== 'idle') {
    haptic(inputSource, res.result === 'miss' ? 0.2 : 0.7, res.result === 'miss' ? 15 : 45);
  }
}

function onXRFrame(time, frame) {
  const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 0;
  lastTime = time;
  if (!frame) return;

  const pose = frame.getViewerPose(refSpace);

  // Камерата трябва да е готова ПРЕДИ игровата логика: дроновете мерят
  // разстояние до нея, а позиционният звук се панорамира спрямо нея.
  if (pose) {
    const p = pose.transform.position;
    const o = pose.transform.orientation;
    camera.position.set(p.x, p.y, p.z);
    camera.quaternion.set(o.x, o.y, o.z, o.w);
    camera.updateMatrixWorld(true);
  }

  // Hit test за мерника и за раждане върху равнина
  let spawnPose = null;
  if (hitTestSource) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length) {
      lastHitResult = hits[0];
      const p = hits[0].getPose(refSpace);
      if (p) {
        reticle.visible = game.state === STATE.SCANNING;
        reticle.matrix.fromArray(p.transform.matrix);
        lastHitPos.set(p.transform.position.x, p.transform.position.y, p.transform.position.z);
        spawnPose = { position: lastHitPos };
      }
    } else {
      reticle.visible = false;
      lastHitResult = null;
    }
  }

  // Козметиката не бива да спира играта
  safe('равнини', () => planes?.update(frame, refSpace));
  safe('светлина', () => envLight?.update(frame));
  safe('дълбочина', () => {
    if (pose && pose.views.length) depth?.update(frame, pose.views[0]);
  });

  // Автоматичен старт, ако сканирането се проточи
  if (game.state === STATE.SCANNING) {
    scanClock += dt;
    if ((spawnPose && scanClock > 2.5) || scanClock > 8) {
      game.start();
      hud.status('');
      hud.toast('лов');
    }
  }

  game.update(dt, spawnPose);
  safe('котви', () => syncAnchors(frame));
  safe('закриване', () => applyOcclusion());
  hud.update(game);

  // Без този ред нищо от сцената не се рисува. three.js не рендерира
  // сам от setAnimationLoop — само подава кадъра.
  renderer.render(scene, camera);
}

// Целите върху равнина се закотвят, за да не плуват при загуба на тракинг
function syncAnchors(frame) {
  for (const t of game.targets) {
    if (t.anchor) {
      const p = frame.getPose(t.anchor.anchorSpace, refSpace);
      if (p) {
        t.home.set(p.transform.position.x, p.transform.position.y, p.transform.position.z);
        t.home.add(t.anchorOffset || new THREE.Vector3());
        if (t.type !== TYPES.DRONE) {
          t.object.position.x = t.home.x;
          t.object.position.z = t.home.z;
        }
      }
    } else if (t.anchorPending === undefined && caps?.anchors && lastHitResult
               && t.type !== TYPES.DRONE && t.age < 0.2) {
      t.anchorPending = true;
      t.anchorOffset = t.object.position.clone().sub(lastHitPos);
      if (typeof lastHitResult.createAnchor === 'function') {
        lastHitResult.createAnchor()
          .then((a) => { t.anchor = a; })
          .catch(() => { /* без котва — работим на relative pose */ });
      }
    }
  }
}

function applyOcclusion() {
  if (!depth || !depth.active) return;
  for (const t of game.targets) {
    const occluded = depth.isOccluded(t.object.position, camera);
    t.object.visible = !occluded;
  }
}

/* ------------------------------------------------------------------ */
/* Резервен режим                                                      */
/* ------------------------------------------------------------------ */
let fallback = null;

async function enterFallback() {
  fallback = new FallbackMode({ renderer, scene, camera, video });
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a2a35, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(1, 2, 1);
  scene.add(key);

  stage('камера…');
  await fallback.start();
  await sound.resume();

  video.classList.remove('hidden');
  startScreen.classList.add('hidden');
  overlay.classList.remove('hidden');
  hud.setCaps({ label: 'жироскоп · без дълбочина' });
  hud.status('без AR: целите се закотвят към компаса');

  game.reset();
  game.start();
  setTimeout(() => hud.status(''), 2600);

  fallback.onFrame = (dt) => {
    game.update(dt, null);
    hud.update(game);
  };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (game.state !== STATE.PLAYING) return;
    const ndc = new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const res = game.shoot(raycaster);
    if (res.result === 'overheated') { sound.overheat(); hud.toast('прегряване'); }
    else if (res.result !== 'idle') haptic(null, 0.6, res.result === 'miss' ? 15 : 45);
  });
}

/* ------------------------------------------------------------------ */
/* Стартов екран                                                       */
/* ------------------------------------------------------------------ */
async function boot() {
  const arBtn = document.getElementById('btn-ar');
  const fbBtn = document.getElementById('btn-fallback');

  // Слушателите се закачат ПЪРВИ. Ако проверката за поддръжка се забави
  // или гръмне, бутоните пак реагират.
  arBtn.addEventListener('click', () => {
    if (!arSupported) { stage('Няма WebXR AR на това устройство.'); return; }
    enterAR().catch((err) => {
      stage(`Спря на: ${note.textContent} → ${err.name}: ${err.message || 'без съобщение'}`);
    });
  });

  fbBtn.addEventListener('click', () => {
    enterFallback().catch((err) => {
      stage(`Камерата не тръгна: ${err.name}: ${err.message || 'без съобщение'}`);
    });
  });

  document.getElementById('btn-sound').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'звук вкл' : 'звук изкл';
    sound.setEnabled(on);
  });

  document.getElementById('btn-planes').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    e.currentTarget.textContent = on ? 'равнини вкл' : 'равнини изкл';
    planes?.setVisible(on);
  });

  fbBtn.disabled = !FallbackMode.available();

  const { ar } = await checkSupport();
  arSupported = ar;
  arBtn.disabled = !ar;
  stage(ar
    ? 'Устройството поддържа WebXR AR.'
    : 'WebXR AR не е наличен тук. Нужни са Chrome за Android и Google Play Services for AR. Резервният режим работи навсякъде.');
}

boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* офлайн не е задължителен */ });
}
