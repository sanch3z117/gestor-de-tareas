# Gestor de Tareas — Electiva PWA

Proyecto del curso **Electiva - PWA (UPTC)**. Es el proyecto que atraviesa los
Bloques 1 y 2 y el Sub-bloque A del Bloque 3: nace en JavaScript (Sesiones 1-8),
se tipa en TypeScript (Sesiones 9-14) y se convierte en una PWA completa
(Sesiones 15-26).

**Estado: cerrado hasta la Sesión 26** — instalable, funciona sin conexión,
guarda datos estructurados cifrados, usa cámara/ubicación/sensores, y tiene
avisos, push y sincronización en segundo plano con servidor de ejemplo.

## Cómo ejecutarlo

El proyecto se sirve con el servidor de ejemplo (hace falta para la API y el push):

```bash
cd servidor
npm install
node server.js          # http://localhost:3000
```

Abre **http://localhost:3000** en Chrome o Edge, en una ventana normal
(**no incógnito**: Chrome no soporta la Push API en incógnito).

Si cambias el Service Worker o cualquier archivo precacheado, regenéralo:

```bash
npm install             # solo la primera vez (workbox-cli)
npm run sw              # workbox injectManifest workbox-config.js
```

## Mapa de archivos

| Archivo | Qué es | Sesión |
| --- | --- | --- |
| `index.html` | Interfaz: lista, formulario, filtros, micrófono, sensores, avisos, seguridad, cámara | 6, 22-26 |
| `css/estilos.css` | Estilos, incluido el indicador de conexión y el skeleton | 6, 23-26 |
| `tareas.js` | Modelo de tarea y render del `<li>` (DOM y eventos) | 3-8 |
| `app.js` | Punto de entrada: conecta todo y cablea la interfaz | 8, 22-26 |
| `db.js` | IndexedDB: tareas, config, outbox; migraciones v1→v3 | 22, 26 |
| `cripto.js` | Web Crypto: SHA-256, PBKDF2 y AES-GCM | 22 |
| `dispositivo.js` | Cámara, micrófono y geolocalización | 24 |
| `sensores.js` | DeviceOrientation/DeviceMotion y sacudida | 25 |
| `notificaciones.js` | Notification API y Push API (VAPID) | 26 |
| `sync.js` | Bandeja de salida y Background Sync (lado página) | 26 |
| `sw-propio.js` | **Fuente** del Service Worker: precaché, rutas, push, clic, sync | 26 |
| `sw.js` | Service Worker generado por Workbox (no editar a mano) | 26 |
| `workbox-config.js` | Configuración de `injectManifest` | 23, 26 |
| `lib/workbox-v7.4.1/` | Workbox local, para que el SW arranque sin conexión | 26 |
| `manifest.json` | Manifest de la PWA | 16 |
| `servidor/server.js` | Servidor de ejemplo: estáticos + VAPID + outbox | 26 |
| `backup/sw-manual-sesiones-17-21.js` | El `sw.js` escrito a mano antes de Workbox | 17-21 |
| `referencia-typescript/` | `tareas.ts` y `tsconfig.json` del Bloque 2 | 9-14 |
| `evidencias/` | Capturas de las comprobaciones | 18-26 |

## Qué quedó implementado, por sesión

- **S16 · Manifest**: nombre, `start_url`, `scope`, `standalone`, colores,
  orientación, `lang`/`dir`, íconos 192, 512 y 512 maskable.
- **S17-21 · Service Worker y caché**: registro, ciclo de vida, interceptación
  de `fetch`, Cache Storage, versionado, limpieza de cachés viejos y las cinco
  estrategias (hoy expresadas como precaché + `CacheFirst` para íconos +
  `NetworkFirst` para la API).
- **S22 · IndexedDB + Web Crypto**: CRUD, índices (`porPrioridad`, `porTitulo` **único**,
  `porFecha`), cursores, migración por tramos, clave derivada con PBKDF2
  (100 000 iteraciones) y nota privada cifrada con AES-GCM. Desde la interfaz:
  filtro por prioridad con el índice y botón que completa en bloque con un cursor.
- **S23 · Workbox + UX**: `sw.js` generado (hoy con `injectManifest`),
  indicador de conexión, botón de instalación propio con `beforeinstallprompt`,
  skeleton de carga y aviso para iOS.
- **S24 · Dispositivo**: cámara con `<dialog>` compartido, captura a `Blob`,
  miniaturas con `revokeObjectURL`, ubicación con precisión en metros y errores
  traducidos a mensajes útiles; micrófono con medidor de nivel (`AnalyserNode`)
  sin grabar, con el hardware liberado al detener.
- **S25 · Sensores**: permiso de iOS, detección de sensores reales, sacudida con
  umbral y enfriamiento, y botón «Deshacer» como mejora progresiva.
- **S26 · Avisos, push y Background Sync**:
  - notificación local desde el Service Worker (`showNotification`);
  - push con suscripción VAPID, servidor que firma y cifra, y borrado de
    suscripciones muertas (404/410);
  - clic en la notificación que enfoca o abre la app;
  - bandeja de salida `outbox` con `idCambio` (UUID) para reintentos
    idempotentes;
  - evento `sync` en el SW y plan B desde la página para Safari/Firefox o
    cuando el permiso de sincronización está bloqueado;
  - línea de estado `☁ Todo sincronizado / N pendientes`.

## Migración de la base de datos

`gestor-tareas-db` va por la **versión 4**, con tramos encadenados:

- v1: stores `tareas` (con `porPrioridad`, `porTitulo`) y `config`.
- v2: índice `porFecha` en `tareas`, sin perder datos.
- v3: store `outbox` (clave `idCambio`) para el Background Sync.
- v4: `porTitulo` pasa a **único** (S22). Antes de crear el índice se renombran
  los títulos repetidos (`Título (2)`, `Título (3)`…); sin eso el `upgrade`
  aborta con `ConstraintError` y la base nueva no abre nunca.

Quien ya tenía una versión anterior conserva sus tareas y su sal; solo recibe
lo nuevo. El Service Worker abre la base con la misma `VERSION_DB`: abrirla con
una versión menor lanza `VersionError` y el `sync` dejaría de vaciar la bandeja.

## Verificado en un navegador real (Chromium)

- Service Worker `activated` y controlando la página; precaché de 14 archivos.
- La app recarga **con el servidor apagado** y conserva tareas y pendientes.
- Tarea creada con el servidor caído → queda en `outbox` y la línea de estado
  lo dice; al volver el servidor y disparar `sync`, se envía y la bandeja queda
  vacía.
- Reenvío del mismo `idCambio` → el servidor responde `{"duplicado":true}` y no
  duplica.
- Plan B (enviar desde la página) probado de punta a punta.
- Manifest sin errores; Chrome reporta como único obstáculo de instalabilidad
  `in-incognito` (el contexto de prueba), no un defecto del proyecto.
- Base en **v4**: `porTitulo` es `unique`, y crear una tarea con título repetido
  muestra «Ya existe una tarea llamada …» en lugar de fallar en silencio.
- «Ver nota» con contraseña incorrecta y luego correcta: **descifra al reintentar**
  (el estado del intento ya no se deduce de `textContent`).
- Deshacer eliminación cuando el título ya está ocupado: restaura como
  «Título (2)» en vez de perder la tarea.
- Filtro por `porPrioridad` y botón «Completar las de esa prioridad» (cursor).
- Micrófono con `AnalyserNode`: mide nivel sin grabar y libera las pistas al parar.
- **Publicación en subruta** (`/gestor/`): Service Worker con scope correcto,
  manifest e íconos 200, recarga sin conexión funcionando y **cero** peticiones
  fuera de la subruta (ninguna ruta absoluta escrita a mano).
- **Lighthouse 13.6 · móvil: 100 / 100 / 100 / 100** (rendimiento, accesibilidad,
  buenas prácticas, SEO) y ninguna auditoría por debajo de 1. FCP 0,8 s, LCP 0,8 s,
  TBT 0 ms, CLS 0,014. Informe en `evidencias/sesion-23-lighthouse.html`.

**No verificable desde aquí**: el diálogo real de instalación, el permiso y la
entrega de push a través del servicio de Google (Chrome no soporta Push en
incógnito), las notificaciones visibles, la cámara/GPS/sensores reales y el
reintento automático del navegador tras un fallo de sync. Todo eso se comprueba
en un teléfono, como indican las Sesiones 24-26.

## Notas prácticas

- `servidor/claves-vapid.json` y `servidor/datos.json` están en `.gitignore`:
  la clave privada VAPID **nunca** se publica.
- El servidor bloquea `servidor/`, `node_modules/` y `backup/` por HTTP (403).
- Para forzar el envío en DevTools sin esperar al navegador:
  **Application → Background Sync → `sync-tareas` → Sync** (o
  **Application → Service Workers → Push** para probar el manejador de push).
- Tras actualizar la app, recarga **dos veces**: el Service Worker puede servir
  la versión anterior.

---

UPTC · Facultad de Ingeniería · Electiva - PWA
