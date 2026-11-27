// sync.js — Sesión 26: bandeja de salida (outbox) y Background Sync.
//
// El patrón: la tarea se guarda SIEMPRE en IndexedDB y se pinta; además se anota
// un "cambio pendiente" en el store `outbox`. Si el navegador soporta
// Background Sync (solo Chromium), él vacía la bandeja cuando hay red, aunque se
// cierre la pestaña. Si no (Safari, Firefox) o si el permiso está bloqueado,
// hay un plan B: enviar desde la página mientras siga abierta.

export const ETIQUETA_SYNC = 'sync-tareas';
export const RUTA_API_TAREAS = '/api/tareas';

/** ¿El navegador puede delegar el envío a un evento `sync`? */
export function haySyncEnSegundoPlano() {
  return 'serviceWorker' in navigator && 'SyncManager' in window;
}

/** Anota un cambio pendiente. Devuelve su idCambio (UUID): sirve para reintentos idempotentes. */
export function encolarCambio(db, tipo, datos) {
  const cambio = { idCambio: crypto.randomUUID(), tipo, datos, creadoEn: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').add(cambio);
    tx.oncomplete = () => resolve(cambio.idCambio);
    tx.onerror = () => reject(tx.error);
  });
}

/** Todos los cambios pendientes, en orden de creación. */
export function obtenerPendientes(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readonly');
    const peticion = tx.objectStore('outbox').getAll();
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

/** Cuántos cambios quedan por enviar. */
export function contarPendientes(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readonly');
    const peticion = tx.objectStore('outbox').count();
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
  });
}

/** Borra un cambio confirmado. */
export function eliminarCambio(db, idCambio) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    tx.objectStore('outbox').delete(idCambio);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Plan B: vacía la bandeja desde la página (solo mientras la pestaña siga abierta).
 * Si un envío falla, LANZA: lo anterior ya quedó marcado y borrado, así que el
 * siguiente intento solo pide lo que falta.
 */
export async function vaciarDesdeLaPagina(db) {
  const pendientes = await obtenerPendientes(db);
  let enviados = 0;
  for (const cambio of pendientes) {
    const resp = await fetch(RUTA_API_TAREAS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambio),
    });
    if (!resp.ok) throw new Error('El servidor respondió ' + resp.status);
    // Se borra apenas se confirma, no al final: si el siguiente falla, este no se reenvía.
    await eliminarCambio(db, cambio.idCambio);
    enviados++;
  }
  return enviados;
}

/**
 * Pide la sincronización. Devuelve "segundo-plano" si el navegador se encargará
 * (aunque se cierre la pestaña) o "desde-la-pagina" si hubo que enviarla aquí.
 */
export async function pedirSincronizacion(db) {
  if (haySyncEnSegundoPlano()) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register(ETIQUETA_SYNC); // registrar dos veces la misma etiqueta = una sola tarea
      return 'segundo-plano';
    } catch {
      // Tener SyncManager no basta: register() lanza NotAllowedError si el usuario
      // bloqueó la sincronización en segundo plano para este sitio.
    }
  }
  await vaciarDesdeLaPagina(db);
  return 'desde-la-pagina';
}
