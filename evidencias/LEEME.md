# Evidencias — Gestor de Tareas (Sesiones 18 a 26)

Capturas generadas ejecutando la app real en un servidor local (http://localhost:4173
primero, http://localhost:3000 con el servidor de la Sesión 26) con su Service Worker
activo. Los paneles oscuros muestran datos reales devueltos por las APIs del navegador
(Cache Storage, IndexedDB, Performance + Service Worker, Background Sync).

- `sesion-18-modo-offline.png` — la app completa cargada con la red desconectada, servida desde el caché.
- `sesion-19-solo-cache-v2.png` — `caches.keys()` mostrando únicamente `gestor-tareas-v2`, sin versiones viejas.
- `sesion-20-cache-creciendo.png` — el precache inicial de 7 recursos y cómo creció el caché al pedir recursos nuevos.
- `sesion-21-estrategias-por-ruta.png` — enrutamiento por ruta (Cache First / Network First / SWR) y peticiones servidas por el Service Worker.
- `sesion-22-indexeddb-cifrado.png` — registro en IndexedDB con `notaCifrada` como bytes ilegibles (sin texto plano).
- `sesion-22-nota-descifrada.png` — tras recargar la página e ingresar la misma contraseña, la nota se descifra correctamente.
- `sesion-26-bandeja-pendiente.png` — la línea de estado con `1 cambio(s) pendiente(s)`: la tarea se guardó en el dispositivo y quedó anotada en `outbox` (servidor apagado).
- `sesion-26-sincronizado.png` — tras disparar el evento `sync`, la bandeja quedó vacía y el estado dice `Todo sincronizado con el servidor`.


Nota: no son capturas de la pestaña DevTools (las herramientas de automatización no controlan
la interfaz de DevTools). Muestran los mismos datos que verías allí: `caches.keys()`, el
contenido de IndexedDB y las peticiones servidas por el Service Worker. Si el docente exige
el panel exacto de DevTools, se pueden repetir a mano con F12 → Application / Network.

UPTC · Facultad de Ingeniería · Electiva - PWA
