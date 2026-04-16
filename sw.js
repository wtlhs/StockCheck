'use strict';

const VERSION = '20260416-02';
const CACHE_NAME = 'inventory-' + VERSION;
const INDEX_URL = '/docs/outbound-index.json';
const ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/utils.js',
  '/js/db.js',
  '/js/scanner.js',
  '/js/app.js',
  '/libs/html5-qrcode.min.js',
  '/docs/outbound-index.json',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigateRequest(event.request));
    return;
  }

  if (url.pathname === INDEX_URL) {
    event.respondWith(handleIndexRequest(event.request));
    return;
  }

  event.respondWith(handleStaticRequest(event.request));
});

function handleNavigateRequest(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
      }
      return response;
    })
    .catch(() => caches.match('/index.html'));
}

function handleIndexRequest(request) {
  return fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(INDEX_URL, clone.clone());
          cache.put(request, clone);
        });
      }
      return response;
    })
    .catch(async () => {
      const cached = await caches.match(request);
      return cached || caches.match(INDEX_URL);
    });
}

function handleStaticRequest(request) {
  return caches.match(request).then((cached) => {
    const fetchPromise = fetch(request)
      .then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(() => cached);

    return cached || fetchPromise;
  });
}
