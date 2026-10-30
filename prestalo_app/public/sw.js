// =====================================================================
//  Préstalo — Service Worker (PWA)
//  - Cachea el "app shell" para carga rápida y acceso sin conexión.
//  - La API (/api/*) y los POST siempre van a la red (datos frescos).
//  - Estrategia: CÓDIGO (html/js/css) = red primero (siempre fresco con
//    conexión; caché solo de respaldo offline). ESTÁTICOS (imágenes,
//    manifest, íconos) = caché primero. La API (/api/*) siempre a la red.
//  Sube la versión del caché al cambiar archivos del shell para refrescar.
// =====================================================================
const CACHE = 'prestalo-v2';
const SHELL = [
  '/', '/index.html', '/reset.html',
  '/styles.css', '/app.js', '/asistente.js',
  '/santotomas.png', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                    // login, asistente, etc. → red
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;     // terceros → red
  if (url.pathname.startsWith('/api/')) return;        // API → siempre red

  const esCodigo = req.mode === 'navigate' || url.pathname === '/' || /\.(html|js|css)$/.test(url.pathname);

  if (esCodigo) {
    // Red primero: siempre la última versión cuando hay conexión.
    e.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      }).catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
    );
    return;
  }

  // Estáticos (imágenes, manifest, íconos) → caché primero.
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
      if (resp && resp.status === 200) {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return resp;
    }))
  );
});
