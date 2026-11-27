// sw-propio.js — Sesión 26: código FUENTE del Service Worker.
//
// A diferencia del `sw.js` que generaba Workbox solo con configuración
// (GenerateSW, Sesión 23), aquí el Service Worker lo escribe el proyecto: un
// manejador de `push`, uno de `notificationclick` y uno de `sync` son lógica
// nuestra, y una receta de configuración no sabe escribirlos.
//
// Workbox sigue haciendo lo único que nadie quiere hacer a mano: calcular los
// hashes de los archivos y escribir la lista de precaché donde está el marcador
// que inyecta `workbox-cli injectManifest`. El archivo que registra el navegador
// sigue siendo `sw.js` (el resultado de este), así que app.js no cambia.
//
// Regenerar SIEMPRE tras tocar este archivo o cualquier recurso precacheado:
//   npx workbox-cli injectManifest workbox-config.js

// Workbox desde archivos LOCALES (carpeta lib/), no desde un CDN:
// así el Service Worker arranca igual sin conexión.
importScripts('lib/workbox-v7.4.1/workbox-sw.js');
workbox.setConfig({ modulePathPrefix: 'lib/workbox-v7.4.1/', debug: false });

// IMPORTANTE: leer TODOS los módulos aquí, en el nivel superior. Cada acceso
// (workbox.precaching, workbox.routing…) dispara un importScripts, y
// importScripts solo se permite mientras el SW se está instalando/evaluando.
const { precacheAndRoute, cleanupOutdatedCaches } = workbox.precaching;
const { registerRoute } = workbox.routing;
const { CacheFirst, NetworkFirst } = workbox.strategies;
const { ExpirationPlugin } = workbox.expiration;

// Ruta base de la app: "/" al servirla en la raíz y "/nombre-del-repo/" si algún
// día se publica en una subruta (GitHub Pages). Nunca se escriben rutas
// absolutas a mano: todo cuelga de BASE.
const BASE = new URL(self.registration.scope).pathname;
const urlBase = (ruta) => BASE + ruta;

self.skipWaiting();
workbox.core.clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST); // ← aquí Workbox inyecta la lista

// Íconos: casi nunca cambian → Cache First con expiración real.
registerRoute(
  ({ url }) => /\/icon-[^/]+\.png$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'imagenes',
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

// API: debe verse al día cuando hay red → Network First, con respaldo en caché.
registerRoute(
  ({ url, request }) => url.pathname.startsWith(urlBase('api/')) && request.method === 'GET',
  new NetworkFirst({ cacheName: 'api-tareas' })
);

// ── Push: llega un mensaje del servidor aunque la app esté cerrada ─────────
self.addEventListener('push', (event) => {
  let datos = { titulo: 'Gestor de Tareas', cuerpo: 'Tienes novedades.', url: urlBase('index.html') };
  try {
    if (event.data) datos = { ...datos, ...event.data.json() };
  } catch {
    if (event.data) datos.cuerpo = event.data.text(); // el mensaje no era JSON
  }

  // userVisibleOnly:true (al suscribir) OBLIGA a mostrar una notificación en
  // cada push; por eso va dentro de waitUntil, siempre.
  event.waitUntil(
    self.registration.showNotification(datos.titulo, {
      body: datos.cuerpo,
      icon: urlBase('icon-192.png'),
      badge: urlBase('icon-192.png'),
      tag: datos.tag ?? 'gestor-aviso', // misma etiqueta = reemplaza, no apila
      data: { url: datos.url },
    })
  );
});

// ── Clic en la notificación: enfocar la app abierta, o abrirla ─────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url ?? urlBase('index.html'), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const abierta = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
      if (abierta) return abierta.focus();
      return clients.openWindow(destino);
    })()
  );
});

// ── Background Sync: la bandeja de salida, vaciada por el navegador ────────
//
// Un Service Worker clásico no puede importar módulos ES, así que esta lógica
// se repite aquí y en sync.js (la versión de la página, para el plan B). Es la
// misma duplicación que describe la Sesión 26 para el Gestor de Tareas.
const NOMBRE_DB = 'gestor-tareas-db';
const VERSION_DB = 4; // debe coincidir con db.js: abrir con una versión menor lanza VersionError
const ETIQUETA_SYNC = 'sync-tareas';
const RUTA_API_TAREAS = '/api/tareas';

function abrirDB() {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_DB, VERSION_DB);
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

function pedir(peticion) {
  return new Promise((resolve, reject) => {
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

async function vaciarBandeja() {
  const db = await abrirDB();
  try {
    const pendientes = await pedir(db.transaction('outbox', 'readonly').objectStore('outbox').getAll());
    let enviados = 0;
    for (const cambio of pendientes) {
      const resp = await fetch(RUTA_API_TAREAS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cambio),
      });
      // Si falla, lanzamos: el navegador reintentará (con espera creciente).
      if (!resp.ok) throw new Error('El servidor respondió ' + resp.status);
      // Se borra cada entrada apenas se confirma, no al final: si la siguiente
      // falla, no se reenvía lo que ya llegó.
      await pedir(db.transaction('outbox', 'readwrite').objectStore('outbox').delete(cambio.idCambio));
      enviados++;
    }
    return enviados;
  } finally {
    db.close();
  }
}

/** Avisa a las ventanas abiertas; la notificación del sistema solo si ninguna mira. */
async function avisarDeSincronizacion(enviados) {
  if (enviados === 0) return;
  const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  ventanas.forEach((v) => v.postMessage({ tipo: 'sync-completo', enviados }));
  const visible = ventanas.some((v) => v.visibilityState === 'visible');
  if (!visible) {
    await self.registration.showNotification('Tareas sincronizadas', {
      body: enviados === 1 ? '1 tarea llegó al servidor.' : `${enviados} tareas llegaron al servidor.`,
      icon: urlBase('icon-192.png'),
      tag: 'gestor-sync',
      data: { url: urlBase('index.html') },
    });
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag !== ETIQUETA_SYNC) return;
  event.waitUntil(
    vaciarBandeja()
      .then(avisarDeSincronizacion)
      .catch(async (err) => {
        // Un fallo de sincronización es silencioso por defecto: se avisa a las
        // ventanas para que la interfaz no finja que todo se envió.
        const ventanas = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        ventanas.forEach((v) => v.postMessage({ tipo: 'sync-fallo', mensaje: err?.message ?? 'sin conexión' }));
        throw err; // relanzar: así el navegador sabe que falló y reintenta
      })
  );
});
