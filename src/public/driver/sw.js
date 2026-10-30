const CACHE_NAME = 'fleetwise-driver-shell-v1';
const SHELL_ASSETS = [
  '/driver/',
  '/driver/index.html',
  '/driver/driver.css',
  '/driver/driver.js',
  '/driver/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // STRICT RULE: Never cache API endpoints, auth endpoints, or dynamic tokens!
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/deliveries') ||
    url.pathname.startsWith('/drivers') ||
    url.pathname.startsWith('/vehicles') ||
    url.pathname.startsWith('/socket.io')
  ) {
    return; // Pass through directly to network
  }

  // Network-first for static shell assets, falling back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
