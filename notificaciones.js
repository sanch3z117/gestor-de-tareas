// notificaciones.js — Sesión 26: Notification API y Push API.
//
// Reglas que no cambian desde la Sesión 24:
//   · el permiso se pide DENTRO de un clic y con contexto (nunca al cargar);
//   · "denied" es casi definitivo: desde código no se puede volver a preguntar;
//   · la app funciona igual sin el permiso: los avisos son un añadido.
//
// La notificación local se muestra con registration.showNotification(), NO con
// `new Notification()`: este último lanza TypeError en Chrome para Android y no
// funciona cuando la página está cerrada.

// Ruta base de la app: "/" en la raíz y "/nombre-del-repo/" en una subruta.
// `new URL('.', baseURI)` da el directorio del documento (con "/" final), así
// que basta con pegarle la ruta relativa.
const BASE = new URL('.', document.baseURI).pathname;
const urlBase = (ruta) => BASE + ruta;
const ICONO = urlBase('icon-192.png');
const PAGINA = urlBase('index.html');

/** Estado actual del permiso: "default" | "granted" | "denied" | "no-soportado". */
export function estadoAvisos() {
  if (!('Notification' in window)) return 'no-soportado';
  return Notification.permission;
}

/** Pide permiso de notificaciones. Solo llamar desde un gesto del usuario. */
export async function pedirPermisoNotificaciones() {
  if (!('Notification' in window)) return 'no-soportado';
  return Notification.requestPermission();
}

/** Notificación LOCAL (sin servidor): la muestra el propio Service Worker. */
export async function mostrarAvisoLocal(titulo, cuerpo, url = PAGINA) {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(titulo, {
    body: cuerpo,
    icon: ICONO,
    badge: ICONO,
    tag: 'gestor-aviso', // misma etiqueta = reemplaza, no apila
    data: { url },
  });
}

/** La clave pública VAPID llega en base64url; PushManager la quiere en bytes. */
export function urlBase64ABytes(base64url) {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(b64);
  return Uint8Array.from(binario, (c) => c.charCodeAt(0));
}

/** ¿Ya hay una suscripción push en este navegador? */
export async function estaSuscrito() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  if (!('pushManager' in reg)) return false;
  return Boolean(await reg.pushManager.getSubscription());
}

/** Envuelve una promesa con un límite: si el navegador no responde, la interfaz no se queda colgada. */
function conTiempoLimite(promesa, ms, nombreError) {
  return Promise.race([
    promesa,
    new Promise((_, rechazar) => {
      setTimeout(() => rechazar(Object.assign(new Error(nombreError), { name: nombreError })), ms);
    }),
  ]);
}

/** Suscribe este navegador a push y envía la suscripción al servidor. */
export async function suscribirAPush() {
  const reg = await navigator.serviceWorker.ready;
  if (!('pushManager' in reg)) throw new Error('push-no-soportado');

  const { clave } = await (await fetch('/api/clave-publica')).json();
  const suscripcion = await conTiempoLimite(
    reg.pushManager.subscribe({
      userVisibleOnly: true, // obligatorio: cada push debe mostrar una notificación
      applicationServerKey: urlBase64ABytes(clave),
    }),
    15000,
    'TimeoutError'
  );

  const resp = await fetch('/api/suscribir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(suscripcion.toJSON()),
  });
  if (!resp.ok) throw new Error('El servidor no guardó la suscripción (' + resp.status + ')');
  return suscripcion;
}

/** Deshace la suscripción push en el navegador y avisa al servidor. */
export async function cancelarSuscripcionPush() {
  const reg = await navigator.serviceWorker.ready;
  const suscripcion = await reg.pushManager.getSubscription();
  if (!suscripcion) return false;

  const endpoint = suscripcion.endpoint;
  await suscripcion.unsubscribe();
  await fetch('/api/suscribir', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  return true;
}

/** Traduce los errores reales de push a algo que el usuario pueda leer y accionar. */
export function describirErrorPush(err) {
  const nombre = err?.name ?? '';
  if (nombre === 'NotAllowedError') {
    return 'Bloqueaste las notificaciones. Habilítalas desde el candado de la barra de direcciones.';
  }
  if (nombre === 'AbortError') {
    return 'El servicio de push del navegador no respondió (¿sin Internet, o navegador en incógnito?).';
  }
  if (nombre === 'NotSupportedError' || err?.message === 'push-no-soportado') {
    return 'Este navegador no soporta notificaciones push. Los avisos locales sí funcionan.';
  }
  if (nombre === 'TimeoutError') {
    return 'El navegador no respondió al pedir la suscripción push (¿modo incógnito, sin Internet o servicio de push bloqueado?).';
  }
  if (nombre === 'TypeError') {
    return 'No se pudo contactar con el servidor. Arranca servidor/server.js y vuelve a intentarlo.';
  }
  return 'No se pudo activar el push: ' + (err?.message || nombre || 'error desconocido') + '.';
}
