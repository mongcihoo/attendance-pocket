const CACHE = 'attendance-pocket-shell-v8';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css?v=8',
  './app.js?v=8',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('attendance-pocket-') && key !== CACHE).map(key => caches.delete(key)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE);
  try {
    const preloadResponse = request.mode === 'navigate' ? await event.preloadResponse : null;
    const response = preloadResponse || await fetch(request);
    if (response?.ok && new URL(request.url).origin === self.location.origin) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./index.html'));
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request, event));
});
