// ═══════════════════════════════════════
//  ARIA GPS — Service Worker (PWA)
// ═══════════════════════════════════════

const CACHE = 'aria-gps-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/config.js',
  '/js/map.js',
  '/js/navigation.js',
  '/js/weather.js',
  '/js/aria.js',
  '/js/reports.js',
  '/js/app.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('api.mapbox.com') || e.request.url.includes('openweathermap')) {
    // Réseau d'abord pour les APIs
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
  } else {
    // Cache d'abord pour les assets
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
