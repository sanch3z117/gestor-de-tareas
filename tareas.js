// tareas.js — lógica del Gestor de Tareas.
// Construida en las Sesiones 3 a 8 (objetos, funciones, arrow functions, DOM
// y eventos, asincronía, módulos) y tipada en las Sesiones 9 a 14.
// Sesión 22: la persistencia pasa a IndexedDB (db.js) y la nota privada se cifra.
// Sesión 24: cada tarea puede llevar una foto y una ubicación adjuntas.

/**
 * @typedef {"baja"|"media"|"alta"} Prioridad
 * @typedef {{ lat: number, lon: number, precision: number, momento: string }} Ubicacion
 * @typedef {{ id: string, titulo: string, prioridad: Prioridad, completada: boolean,
 *             fechaCreacion: string, notaCifrada?: ArrayBuffer, notaIv?: Uint8Array,
 *             foto?: Blob, ubicacion?: Ubicacion }} Tarea
 */

/** Crea una tarea nueva. Sesión 3 (objetos) y Sesión 4 (parámetros por defecto). */
export const crearTarea = (titulo, prioridad = "media") => ({
  id: crypto.randomUUID(),
  titulo,
  prioridad,
  completada: false,
  fechaCreacion: new Date().toISOString(),
});

/** Crea el <li> de una tarea y lo agrega al contenedor. Sesión 6 (DOM y eventos). */
export const renderizarTarea = (
  tarea,
  contenedor,
  { onToggle, onEliminar, onVerNota, onFoto, onUbicacion, crearUrl }
) => {
  const li = document.createElement("li");
  li.className = `tarea tarea--${tarea.prioridad}` + (tarea.completada ? " tarea--completada" : "");
  li.dataset.id = tarea.id;

  const fila = document.createElement("div");
  fila.className = "tarea-fila";

  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = tarea.completada;
  check.setAttribute("aria-label", "Completar: " + tarea.titulo);
  check.addEventListener("change", () => onToggle(tarea.id));

  const texto = document.createElement("span");
  texto.textContent = tarea.titulo;

  const acciones = document.createElement("div");
  acciones.className = "tarea-acciones";

  const notaEl = document.createElement("p");
  notaEl.className = "nota-privada oculta";

  const foto = document.createElement("button");
  foto.type = "button";
  foto.className = "btn-adjunto";
  foto.textContent = tarea.foto ? "📷 Cambiar foto" : "📷 Foto";
  foto.setAttribute("aria-label", (tarea.foto ? "Cambiar foto de " : "Adjuntar foto a ") + tarea.titulo);
  foto.addEventListener("click", () => onFoto(tarea));
  acciones.append(foto);

  const ubicacion = document.createElement("button");
  ubicacion.type = "button";
  ubicacion.className = "btn-adjunto";
  ubicacion.textContent = tarea.ubicacion ? "📍 Actualizar ubicación" : "📍 Ubicación";
  ubicacion.setAttribute("aria-label", (tarea.ubicacion ? "Actualizar ubicación de " : "Adjuntar ubicación a ") + tarea.titulo);
  ubicacion.addEventListener("click", () => onUbicacion(tarea));
  acciones.append(ubicacion);

  if (tarea.notaCifrada) {
    const verNota = document.createElement("button");
    verNota.type = "button";
    verNota.textContent = "Ver nota";
    verNota.className = "btn-nota";
    verNota.addEventListener("click", () => onVerNota(tarea, notaEl));
    acciones.append(verNota);
  }

  const borrar = document.createElement("button");
  borrar.textContent = "Eliminar";
  borrar.className = "btn-eliminar";
  borrar.addEventListener("click", () => onEliminar(tarea.id));
  acciones.append(borrar);

  const adjuntos = document.createElement("div");
  adjuntos.className = "tarea-adjuntos";

  if (tarea.foto) {
    const miniatura = document.createElement("img");
    miniatura.className = "miniatura";
    miniatura.src = crearUrl(tarea.foto);
    miniatura.alt = "Foto adjunta a " + tarea.titulo;
    adjuntos.append(miniatura);
  }

  if (tarea.ubicacion) {
    const enlace = document.createElement("a");
    enlace.className = "ubicacion";
    enlace.href = `https://www.openstreetmap.org/?mlat=${tarea.ubicacion.lat}&mlon=${tarea.ubicacion.lon}#map=16/${tarea.ubicacion.lat}/${tarea.ubicacion.lon}`;
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";
    enlace.textContent = `📍 ${tarea.ubicacion.lat.toFixed(5)}, ${tarea.ubicacion.lon.toFixed(5)} (±${tarea.ubicacion.precision} m)`;
    adjuntos.append(enlace);
  }

  fila.append(check, texto, acciones);
  li.append(fila);
  if (adjuntos.childElementCount) li.append(adjuntos);
  li.append(notaEl);
  contenedor.append(li);
};
