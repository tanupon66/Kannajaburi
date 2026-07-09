const CACHE_NAME = 'kannajaburi-trip-v2.1.0';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/app.js?v=2.1.0',
  './src/state.js',
  './src/drive.js',
  './src/firebaseHub.js',
  './src/mediaStore.js',
  './src/styles.css?v=2.1.0',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const network = fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => cached || caches.match('./index.html'));
      return cached || network;
    })
  );
});

// v2.1.0: cache bust for UI, Story, Profile Avatar and Admin-only Hub.
