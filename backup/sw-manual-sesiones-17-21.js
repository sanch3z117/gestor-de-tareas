// sw.js — Service Worker del Gestor de Tareas.
// Sesión 17 (registro y ciclo de vida), Sesión 18 (intercepción con caches.match),
// Sesión 19 (versionado y limpieza) y Sesiones 20-21 (las 5 estrategias, enrutadas por ruta).

const CACHE_ACTUAL = 'gestor-tareas-v2';
const CORE_ASSETS = [
  '/index.html',
  '/css/estilos.css',
  '/app.js',
  '/tareas.js',
  '/db.js',
  '/cripto.js',
  '/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_ACTUAL).then(cache => cache.addAll(CORE_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(nombres =>
        Promise.all(
          nombres
            .filter(nombre => nombre !== CACHE_ACTUAL)
            .map(nombre => caches.delete(nombre))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Estrategia 1: Cache Only — nunca toca la red
function cacheOnly(peticion) {
  return caches.match(peticion);
}

// Estrategia 2: Network Only — nunca toca el caché
function networkOnly(peticion) {
  return fetch(peticion);
}

// Estrategia 3: Cache First — caché primero; si falta, red y se guarda con put()
function cacheFirst(peticion) {
  return caches.match(peticion).then(enCache => {
    if (enCache) return enCache;
    return fetch(peticion).then(respuesta => {
      const clon = respuesta.clone();
      caches.open(CACHE_ACTUAL).then(cache => cache.put(peticion, clon));
      return respuesta;
    });
  });
}

// Estrategia 4: Network First — red primero; si falla, caché como respaldo
function networkFirst(peticion) {
  return fetch(peticion)
    .then(respuesta => {
      const clon = respuesta.clone();
      caches.open(CACHE_ACTUAL).then(cache => cache.put(peticion, clon));
      return respuesta;
    })
    .catch(() => caches.match(peticion));
}

// Estrategia 5: Stale-While-Revalidate — responde del caché y actualiza en segundo plano
function staleWhileRevalidate(peticion) {
  return caches.open(CACHE_ACTUAL).then(cache =>
    cache.match(peticion).then(enCache => {
      const actualizacion = fetch(peticion).then(respuesta => {
        cache.put(peticion, respuesta.clone());
        return respuesta;
      });
      return enCache || actualizacion;
    })
  );
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('icon-')) {
    // Íconos: rara vez cambian -> Cache First
    event.respondWith(cacheFirst(event.request));
  } else if (url.pathname.startsWith('/api/')) {
    // Datos de la API: deben verse al día -> Network First
    event.respondWith(networkFirst(event.request));
  } else {
    // HTML, CSS, JS del shell: rápido, y se actualiza solo -> Stale-While-Revalidate
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
