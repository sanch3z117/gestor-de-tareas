// db.js — IndexedDB del Gestor de Tareas.
// Sesión 22: almacenamiento estructurado, consultable por índices y versionado.
// Acompaña a cripto.js para el patrón "campos planos + campos cifrados".

import { cifrarTexto, descifrarTexto } from './cripto.js';

const NOMBRE_DB = 'gestor-tareas-db';
const VERSION_DB = 4;

/**
 * v4 (Sesión 22): `porTitulo` pasa a ser único, como pide la guía.
 * Antes de crearlo hay que renombrar los títulos repetidos que ya existan: si
 * no, crear el índice lanza ConstraintError y la base nueva no abre nunca.
 */
function migrarIndiceTituloUnico(store) {
  if (store.indexNames.contains('porTitulo')) store.deleteIndex('porTitulo');

  const lectura = store.getAll();
  lectura.onsuccess = () => {
    const usados = new Set();
    const renombres = [];
    for (const tarea of lectura.result) {
      const titulo = tarea.titulo ?? '';
      if (!usados.has(titulo)) {
        usados.add(titulo);
        continue;
      }
      let n = 2;
      while (usados.has(`${titulo} (${n})`)) n++;
      renombres.push({ ...tarea, titulo: `${titulo} (${n})` });
      usados.add(`${titulo} (${n})`);
    }

    const crearIndice = () => store.createIndex('porTitulo', 'titulo', { unique: true });
    if (renombres.length === 0) return crearIndice();

    // El índice se crea solo cuando todas las escrituras se aplicaron.
    let pendientes = renombres.length;
    for (const registro of renombres) {
      const escritura = store.put(registro);
      escritura.onsuccess = () => {
        if (--pendientes === 0) crearIndice();
      };
    }
  };
}

/** Abre (o crea / migra) la base de datos. Los stores e índices solo se tocan aquí. */
export function abrirBaseDeDatos() {
  return new Promise((resolve, reject) => {
    const peticion = indexedDB.open(NOMBRE_DB, VERSION_DB);

    peticion.onupgradeneeded = event => {
      const db = event.target.result;
      const tx = event.target.transaction;
      const version = event.oldVersion; // 0 si la base no existía

      if (version < 1) {
        const store = db.createObjectStore('tareas', { keyPath: 'id' });
        store.createIndex('porPrioridad', 'prioridad', { unique: false });
        // Sesión 22: el título es único. En la v1 nació no-único; la v4 lo corrige.
        store.createIndex('porTitulo', 'titulo', { unique: true });
        db.createObjectStore('config', { keyPath: 'clave' });
      }

      if (version < 2) {
        // v2: índice por fecha de creación, sin perder las tareas ya guardadas.
        const store = tx.objectStore('tareas');
        store.createIndex('porFecha', 'fechaCreacion', { unique: false });
      }

      if (version < 3) {
        // v3 (Sesión 26): bandeja de salida del Background Sync. La clave es un
        // UUID que genera la app (no autoIncrement): el servidor lo usa para no
        // duplicar un cambio si el envío se reintenta.
        db.createObjectStore('outbox', { keyPath: 'idCambio' });
      }

      if (version >= 1 && version < 4) {
        // v4 (Sesión 22): porTitulo pasa a único. Se deduplican los títulos ya
        // guardados antes de crear el índice, o el upgrade aborta con ConstraintError.
        migrarIndiceTituloUnico(tx.objectStore('tareas'));
      }
    };

    peticion.onsuccess = event => resolve(event.target.result);
    peticion.onerror = event => reject(event.target.error);
  });
}

/** Envuelve un IDBRequest en una Promise (IndexedDB es basada en eventos). */
function envolver(peticion, tx) {
  return new Promise((resolve, reject) => {
    peticion.onsuccess = () => resolve(peticion.result);
    peticion.onerror = () => reject(peticion.error);
    if (tx) tx.onabort = () => reject(tx.error);
  });
}

// --- CRUD ---------------------------------------------------------------

/** Inserta una tarea nueva. Falla si la clave ya existe. */
export function agregarTarea(db, tarea) {
  const tx = db.transaction('tareas', 'readwrite');
  return envolver(tx.objectStore('tareas').add(tarea), tx);
}

/** Inserta o actualiza (sin fallar si la clave ya existe). */
export function actualizarTarea(db, tarea) {
  const tx = db.transaction('tareas', 'readwrite');
  return envolver(tx.objectStore('tareas').put(tarea), tx);
}

/** Recupera una tarea por su clave. */
export function obtenerTarea(db, id) {
  const tx = db.transaction('tareas', 'readonly');
  return envolver(tx.objectStore('tareas').get(id), tx);
}

/** Recupera todas las tareas. */
export function obtenerTodasLasTareas(db) {
  const tx = db.transaction('tareas', 'readonly');
  return envolver(tx.objectStore('tareas').getAll(), tx);
}

/** Cuenta cuántas tareas hay, sin traerlas. */
export function contarTareas(db) {
  const tx = db.transaction('tareas', 'readonly');
  return envolver(tx.objectStore('tareas').count(), tx);
}

/** Elimina una tarea por su clave. */
export function eliminarTarea(db, id) {
  const tx = db.transaction('tareas', 'readwrite');
  return envolver(tx.objectStore('tareas').delete(id), tx);
}

// --- Consultas con índices y cursores ------------------------------------

/** Devuelve las tareas de una prioridad, recorriendo el índice con un cursor. */
export function tareasPorPrioridad(db, prioridad) {
  return new Promise((resolve, reject) => {
    const resultado = [];
    const tx = db.transaction('tareas', 'readonly');
    const indice = tx.objectStore('tareas').index('porPrioridad');
    const cursor = indice.openCursor(IDBKeyRange.only(prioridad));

    cursor.onsuccess = event => {
      const c = event.target.result;
      if (c) {
        resultado.push(c.value);
        c.continue(); // avanza al siguiente registro que coincide
      } else {
        resolve(resultado); // no hay más
      }
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

/** Marca como completadas todas las tareas de una prioridad, con el cursor en modo escritura. */
export function completarPorPrioridad(db, prioridad) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tareas', 'readwrite');
    const indice = tx.objectStore('tareas').index('porPrioridad');
    const cursor = indice.openCursor(IDBKeyRange.only(prioridad));
    let actualizadas = 0;

    cursor.onsuccess = event => {
      const c = event.target.result;
      if (!c) return resolve(actualizadas);
      const registro = c.value;
      registro.completada = true;
      c.update(registro); // reescribe el registro actual sin cerrar el cursor
      actualizadas++;
      c.continue();
    };
    tx.onerror = () => reject(tx.error);
  });
}

// --- Configuración (sal del cifrado) -------------------------------------

/** Guarda un valor de configuración, por clave. */
export function guardarConfig(db, clave, valor) {
  const tx = db.transaction('config', 'readwrite');
  return envolver(tx.objectStore('config').put({ clave, valor }), tx);
}

/** Lee un valor de configuración. Devuelve undefined si no existe. */
export function obtenerConfig(db, clave) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('config', 'readonly');
    const peticion = tx.objectStore('config').get(clave);
    peticion.onsuccess = () => resolve(peticion.result ? peticion.result.valor : undefined);
    peticion.onerror = () => reject(peticion.error);
  });
}

// --- Tareas con nota privada cifrada (Sesión 22, caso real) --------------

/** Guarda una tarea cifrando su notaPrivada; el resto de campos queda plano y consultable. */
export async function guardarTareaConNota(db, clave, tarea) {
  const { cifrado, iv } = await cifrarTexto(clave, tarea.notaPrivada);
  const registro = {
    id: tarea.id,
    titulo: tarea.titulo,            // plano: se busca y se filtra
    prioridad: tarea.prioridad,      // plano: tiene un índice
    completada: tarea.completada,
    fechaCreacion: tarea.fechaCreacion,
    foto: tarea.foto ?? null,        // Sesión 24: Blob de la foto (o null)
    ubicacion: tarea.ubicacion ?? null, // Sesión 24: { lat, lon, precision, momento }
    notaCifrada: cifrado,            // cifrado: solo se lee de a uno
    notaIv: iv,
  };
  return agregarTarea(db, registro);
}

/** Descifra la nota privada de un registro. */
export function leerNotaPrivada(clave, registro) {
  return descifrarTexto(clave, { cifrado: registro.notaCifrada, iv: registro.notaIv });
}
