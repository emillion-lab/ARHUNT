// sw.js — v2: network-first за локалните файлове.
// v1 беше cache-first и залепваше стар CSS/JS до ръчно изчистване.
// Сега мрежата води, кешът е само резерва при офлайн.
const CACHE = 'arhunt-v2';
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
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
