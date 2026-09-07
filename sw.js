// sw.js — кешираме само локалните файлове. three.js идва от CDN и при
// първо зареждане иска мрежа; след това браузърът си го кешира сам.
const CACHE = 'arhunt-v1';
const LOCAL = [
  './',
  './index.html',
  './styles.css',
  './icon.svg',
  './manifest.webmanifest',
  './js/main.js',
  './js/xr.js',
  './js/world.js',
  './js/game.js',
  './js/targets.js',
  './js/audio.js',
  './js/hud.js',
  './js/fallback.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(LOCAL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // CDN не го пипаме
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
