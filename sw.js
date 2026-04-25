const CACHE_NAME = 'terminal-player-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  'https://fonts.googleapis.com/css2?family=Cascadia+Code:wght@400;700&display=swap',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Never cache audio blobs or local media files
  if (url.protocol === 'blob:' || event.request.destination === 'audio' || event.request.destination === 'video') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;
      
      return fetch(event.request).then(response => {
        // Cache external fonts/icons if requested
        if (event.request.url.startsWith('https://fonts.') || event.request.url.startsWith('https://unpkg.')) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // Return offline fallback if needed
        return new Response('Network error occurred', { status: 408, headers: { 'Content-Type': 'text/plain' }});
      });
    })
  );
});