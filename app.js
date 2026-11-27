// app.js — punto de entrada: conecta tareas.js y db.js con el DOM.
// Sesión 8 (módulos), Sesión 22 (IndexedDB + cifrado de la nota privada),
// Sesión 24 (cámara y ubicación) y Sesión 25 (sensores y deshacer).
import { crearTarea, renderizarTarea } from "./tareas.js";
import {
  abrirBaseDeDatos,
  agregarTarea,
  actualizarTarea,
  eliminarTarea,
  obtenerTodasLasTareas,
  guardarConfig,
  obtenerConfig,
  guardarTareaConNota,
  leerNotaPrivada,
  tareasPorPrioridad,
  completarPorPrioridad,
} from "./db.js";
import { derivarClaveDesdeContrasena } from "./cripto.js";
import {
  abrirCamara,
  abrirMicrofono,
  capturarFoto,
  crearMedidorDeNivel,
  describirErrorCamara,
  describirErrorUbicacion,
  detenerCamara,
  obtenerUbicacion,
} from "./dispositivo.js";
import {
  detectarSacudida,
  escucharOrientacion,
  hayLecturasReales,
  pedirPermisoSensores,
} from "./sensores.js";
import {
  cancelarSuscripcionPush,
  describirErrorPush,
  estadoAvisos,
  mostrarAvisoLocal,
  pedirPermisoNotificaciones,
  suscribirAPush,
} from "./notificaciones.js";
import {
  contarPendientes,
  encolarCambio,
  pedirSincronizacion,
} from "./sync.js";

let db;
let tareas = [];
let claveSesion = null; // CryptoKey derivada de la contraseña — nunca se guarda
let ultimaEliminada = null;
let tareaParaFoto = null;
let streamCamara = null;
let controlOrientacion = null;
let controlSacudida = null;
let sensoresActivos = false;
let urlsTemporales = [];
let temporizadorAdjuntos;

const listaEl = document.getElementById("lista-tareas");
const formEl = document.getElementById("form-tarea");
const inputTituloEl = document.getElementById("input-titulo");
const inputPrioridadEl = document.getElementById("input-prioridad");
const inputNotaEl = document.getElementById("input-nota");
const inputContrasenaEl = document.getElementById("input-contrasena");
const btnActivarCifradoEl = document.getElementById("btn-activar-cifrado");
const estadoSeguridadEl = document.getElementById("estado-seguridad");
const estadoAdjuntosEl = document.getElementById("estado-adjuntos");
const avisoIosEl = document.getElementById("aviso-ios");
const btnDeshacerEl = document.getElementById("btn-deshacer");
const btnSensoresEl = document.getElementById("btn-sensores");
const indicadorOrientacionEl = document.getElementById("indicador-orientacion");
const avisoSensoresEl = document.getElementById("aviso-sensores");
const dlgCamara = document.getElementById("dlg-camara");
const videoCamara = document.getElementById("video-camara");
const estadoCamaraEl = document.getElementById("estado-camara");
const btnCapturarEl = document.getElementById("btn-capturar");
const btnCancelarCamaraEl = document.getElementById("btn-cancelar-camara");
const btnAvisosEl = document.getElementById("btn-avisos");
const btnSuscribirEl = document.getElementById("btn-suscribir");
const btnEnviarPushEl = document.getElementById("btn-enviar-push");
const btnCancelarPushEl = document.getElementById("btn-cancelar-push");
const estadoAvisosEl = document.getElementById("estado-avisos");
const estadoSyncEl = document.getElementById("estado-sync");
const filtroPrioridadEl = document.getElementById("filtro-prioridad");
const btnCompletarFiltroEl = document.getElementById("btn-completar-filtro");
const estadoFiltroEl = document.getElementById("estado-filtro");
const btnMicrofonoEl = document.getElementById("btn-microfono");
const medidorBarraEl = document.getElementById("medidor-barra");
const estadoMicrofonoEl = document.getElementById("estado-microfono");

// Las URLs de objeto de las miniaturas se liberan en cada repintado.
const revocarUrls = () => {
  urlsTemporales.forEach((url) => URL.revokeObjectURL(url));
  urlsTemporales = [];
};

const crearUrl = (blob) => {
  const url = URL.createObjectURL(blob);
  urlsTemporales.push(url);
  return url;
};

const pintarTodo = () => {
  revocarUrls();
  listaEl.innerHTML = "";
  tareas.forEach((tarea) =>
    renderizarTarea(tarea, listaEl, {
      onToggle: alternarCompletada,
      onEliminar: borrarTarea,
      onVerNota: mostrarNota,
      onFoto: abrirCamaraPara,
      onUbicacion: adjuntarUbicacion,
      crearUrl,
    })
  );
  btnDeshacerEl.disabled = !ultimaEliminada;
};

const estadoSeguridad = (mensaje) => {
  estadoSeguridadEl.textContent = mensaje;
};

const avisarAdjuntos = (mensaje, duracion = 6000) => {
  estadoAdjuntosEl.textContent = mensaje;
  clearTimeout(temporizadorAdjuntos);
  if (mensaje) temporizadorAdjuntos = setTimeout(() => (estadoAdjuntosEl.textContent = ""), duracion);
};

const avisarSensores = (mensaje) => {
  avisoSensoresEl.textContent = mensaje;
};

// ── Sesión 26: avisos, push y sincronización ─────────────────────────────
// El permiso se pide solo dentro del clic; "denied" es casi definitivo, así que
// no se gasta la única oportunidad al cargar la página.

const TEXTO_AVISOS = {
  granted: "Avisos activos.",
  denied: "Avisos bloqueados. Habilítalos desde el candado de la barra de direcciones.",
  default: "Avisos sin activar.",
  "no-soportado": "Este navegador no soporta notificaciones.",
};

function pintarEstadoAvisos() {
  const estado = estadoAvisos();
  estadoAvisosEl.textContent = TEXTO_AVISOS[estado] ?? TEXTO_AVISOS.default;
  btnAvisosEl.disabled = estado !== "default";
  btnAvisosEl.textContent = estado === "granted" ? "🔔 Avisos activados" : "🔔 Activar avisos";
  btnSuscribirEl.disabled = !("serviceWorker" in navigator) || !("PushManager" in window);
  btnEnviarPushEl.disabled = btnSuscribirEl.disabled;
  btnCancelarPushEl.disabled = btnSuscribirEl.disabled;
}

/** La línea de estado cuenta lo que quedó pendiente: sin eso nadie confía en el sistema. */
async function actualizarEstadoSync() {
  if (!db) return;
  const pendientes = await contarPendientes(db).catch(() => 0);
  estadoSyncEl.textContent =
    pendientes === 0
      ? "☁ Todo sincronizado con el servidor."
      : `☁ ${pendientes} cambio(s) pendiente(s) de enviar.`;
}

btnAvisosEl.addEventListener("click", async () => {
  // Permiso pedido AQUÍ, dentro del clic — y el usuario ya sabe para qué lo pulsó.
  btnAvisosEl.disabled = true;
  try {
    const permiso = await pedirPermisoNotificaciones();
    if (permiso === "granted") {
      await mostrarAvisoLocal("Avisos activados", "Así se verán las notificaciones del Gestor.");
    } else if (permiso !== "no-soportado") {
      avisarAdjuntos("No se activaron los avisos. La app sigue funcionando igual.");
    }
  } finally {
    pintarEstadoAvisos();
  }
});

btnSuscribirEl.addEventListener("click", async () => {
  btnSuscribirEl.disabled = true;
  try {
    await suscribirAPush();
    estadoAvisosEl.textContent = "Push activo: este dispositivo recibirá avisos del servidor.";
  } catch (error) {
    estadoAvisosEl.textContent = describirErrorPush(error);
  } finally {
    btnSuscribirEl.disabled = false;
  }
});

btnEnviarPushEl.addEventListener("click", async () => {
  btnEnviarPushEl.disabled = true;
  try {
    const resp = await fetch("/api/enviar-prueba", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cuerpo: "Mensaje de prueba desde el servidor." }),
    });
    const resultado = await resp.json();
    estadoAvisosEl.textContent = `Push enviado: ${resultado.enviados} entregado(s), ${resultado.fallidos} fallido(s).`;
  } catch (error) {
    estadoAvisosEl.textContent = describirErrorPush(error);
  } finally {
    btnEnviarPushEl.disabled = false;
  }
});

btnCancelarPushEl.addEventListener("click", async () => {
  try {
    const habia = await cancelarSuscripcionPush();
    estadoAvisosEl.textContent = habia
      ? "Suscripción push cancelada en este dispositivo."
      : "Este dispositivo no estaba suscrito a push.";
  } catch (error) {
    estadoAvisosEl.textContent = describirErrorPush(error);
  }
});

// El Service Worker avisa cuando terminó de vaciar la bandeja (o cuando falló).
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (evento) => {
    const mensaje = evento.data ?? {};
    if (mensaje.tipo === "sync-completo") {
      avisarAdjuntos(`Se sincronizaron ${mensaje.enviados} cambio(s) con el servidor.`);
      void actualizarEstadoSync();
    } else if (mensaje.tipo === "sync-fallo") {
      // La verdad es la bandeja: si sigue habiendo pendientes, la línea lo dice.
      void actualizarEstadoSync();
    }
  });
}


// UX/UI (Sesión 23): indicador de conexión
const avisoConexionEl = document.getElementById("aviso-conexion");
const btnInstalarEl = document.getElementById("btn-instalar");

const actualizarConexion = () => {
  avisoConexionEl.classList.toggle("oculta", navigator.onLine);
};
window.addEventListener("online", actualizarConexion);
window.addEventListener("offline", actualizarConexion);
actualizarConexion();

// UX/UI (Sesión 23): prompt de instalación propio.
// En Safari/iOS beforeinstallprompt nunca se dispara: ahí solo queda instruir manualmente.
let promptInstalacion = null;
window.addEventListener("beforeinstallprompt", (evento) => {
  evento.preventDefault();
  promptInstalacion = evento;
  btnInstalarEl.classList.remove("oculta");
});
btnInstalarEl.addEventListener("click", async () => {
  if (!promptInstalacion) return;
  promptInstalacion.prompt();
  await promptInstalacion.userChoice;
  promptInstalacion = null;
  btnInstalarEl.classList.add("oculta");
});

const esIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const enStandalone =
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
if (esIOS && !enStandalone) avisoIosEl.classList.remove("oculta");

// Detección de soporte (Sesión 23): nunca asumir; degradar con gracia.
if (!("indexedDB" in window)) {
  estadoSeguridad("Tu navegador no soporta IndexedDB: las tareas no podrán guardarse.");
}
if (!(window.crypto && window.crypto.subtle)) {
  btnActivarCifradoEl.disabled = true;
  estadoSeguridad("Tu navegador no soporta Web Crypto: el cifrado no está disponible.");
}

async function alternarCompletada(id) {
  const tarea = tareas.find((t) => t.id === id);
  if (!tarea) return;
  tarea.completada = !tarea.completada;
  await actualizarTarea(db, tarea);
  await aplicarFiltro();
}

async function borrarTarea(id) {
  const tarea = tareas.find((t) => t.id === id);
  await eliminarTarea(db, id);
  ultimaEliminada = tarea ?? null;
  await aplicarFiltro();
  avisarSensores(ultimaEliminada ? `Eliminaste «${ultimaEliminada.titulo}». Puedes deshacerlo.` : "");
}

async function deshacerEliminacion() {
  if (!ultimaEliminada) return;
  const copia = { ...ultimaEliminada, id: crypto.randomUUID() };
  try {
    await agregarTarea(db, copia);
    ultimaEliminada = null;
    await aplicarFiltro();
    avisarSensores(`Se restauró «${copia.titulo}».`);
  } catch (error) {
    if (error?.name !== "ConstraintError") {
      avisarSensores("No se pudo restaurar la tarea eliminada.");
      return;
    }
    // El índice porTitulo es único: si ya hay una tarea con ese título, se
    // restaura con un sufijo en vez de perderla. El usuario la ve y la renombra.
    const todas = await obtenerTodasLasTareas(db);
    let n = 2;
    let tituloLibre;
    do {
      tituloLibre = `${ultimaEliminada.titulo} (${n})`;
      n++;
    } while (todas.some((t) => t.titulo === tituloLibre));
    try {
      await agregarTarea(db, { ...copia, titulo: tituloLibre });
      const original = ultimaEliminada.titulo;
      ultimaEliminada = null;
      await aplicarFiltro();
      avisarSensores(`Se restauró como «${tituloLibre}»: ya existía otra tarea «${original}».`);
    } catch {
      avisarSensores("No se pudo restaurar la tarea eliminada.");
    }
  }
}

async function mostrarNota(tarea, notaEl) {
  // El estado se guarda aparte, no se deduce del texto del DOM: si se mirara
  // textContent, el mensaje de error de un intento fallido impediría volver a
  // intentar con la contraseña correcta.
  if (notaEl.dataset.descifrada === "1") {
    notaEl.classList.toggle("oculta");
    return;
  }
  if (!claveSesion) {
    estadoSeguridad("Ingresa tu contraseña y activa el cifrado para leer la nota privada.");
    inputContrasenaEl.focus();
    return;
  }
  try {
    notaEl.textContent = await leerNotaPrivada(claveSesion, tarea);
    notaEl.dataset.descifrada = "1"; // solo un descifrado real habilita el simple mostrar/ocultar
    notaEl.classList.remove("oculta");
  } catch {
    notaEl.textContent = "No se pudo descifrar: la contraseña no coincide.";
    notaEl.dataset.descifrada = ""; // se puede reintentar tras activar la clave correcta
    notaEl.classList.remove("oculta");
  }
}

async function activarCifrado() {
  const contrasena = inputContrasenaEl.value;
  if (contrasena.length < 6) {
    estadoSeguridad("La contraseña debe tener al menos 6 caracteres.");
    return;
  }
  let sal = await obtenerConfig(db, "sal");
  if (!sal) {
    sal = crypto.getRandomValues(new Uint8Array(16)); // la sal no es secreta: se guarda junto a los datos
    await guardarConfig(db, "sal", sal);
  }
  claveSesion = await derivarClaveDesdeContrasena(contrasena, sal);
  inputContrasenaEl.value = "";
  estadoSeguridad("Cifrado activo para esta sesión. La contraseña no se guarda en ningún lado.");
}

// Sesión 24: cámara compartida por todas las tareas. El permiso se pide dentro del clic.
function detenerStreamCamara() {
  detenerCamara(streamCamara);
  streamCamara = null;
  videoCamara.srcObject = null;
}

async function abrirCamaraPara(tarea) {
  tareaParaFoto = tarea;
  estadoCamaraEl.textContent = "";
  if (streamCamara) detenerStreamCamara();

  try {
    streamCamara = await abrirCamara("environment");
    videoCamara.srcObject = streamCamara;
    dlgCamara.showModal();
    await videoCamara.play().catch(() => {});
  } catch (error) {
    tareaParaFoto = null;
    detenerStreamCamara();
    avisarAdjuntos(describirErrorCamara(error));
  }
}

dlgCamara.addEventListener("close", () => {
  detenerStreamCamara();
  tareaParaFoto = null;
});

dlgCamara.addEventListener("cancel", () => {
  detenerStreamCamara();
  tareaParaFoto = null;
});

btnCancelarCamaraEl.addEventListener("click", () => dlgCamara.close());

btnCapturarEl.addEventListener("click", async () => {
  if (!tareaParaFoto) return;
  const foto = await capturarFoto(videoCamara);
  if (!foto) {
    estadoCamaraEl.textContent = "La cámara aún no está lista. Espera un segundo e inténtalo de nuevo.";
    return;
  }

  const tarea = tareas.find((t) => t.id === tareaParaFoto.id);
  if (!tarea) {
    estadoCamaraEl.textContent = "No se encontró la tarea que estabas editando.";
    return;
  }

  try {
    tarea.foto = foto;
    await actualizarTarea(db, tarea);
    await aplicarFiltro();
    dlgCamara.close();
    avisarAdjuntos("Foto guardada en este dispositivo.");
  } catch {
    estadoCamaraEl.textContent = "No se pudo guardar la foto en IndexedDB.";
  }
});

// Sesión 24: ubicación por tarea.
async function adjuntarUbicacion(tarea) {
  avisarAdjuntos("Obteniendo ubicación…", 15000);
  try {
    const ubicacion = await obtenerUbicacion();
    tarea.ubicacion = ubicacion;
    await actualizarTarea(db, tarea);
    await aplicarFiltro();
    avisarAdjuntos(`Ubicación guardada (±${ubicacion.precision} m).`);
  } catch (error) {
    avisarAdjuntos(
      error && typeof error.code === "number"
        ? describirErrorUbicacion(error)
        : "No se pudo guardar la ubicación en este dispositivo."
    );
  }
}

// Al ocultar la página, la cámara se apaga: un flujo abierto gasta batería y privacidad.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && streamCamara) {
    detenerStreamCamara();
    if (dlgCamara.open) dlgCamara.close();
    avisarAdjuntos("La cámara se apagó al salir de la página. Vuelve a activarla cuando quieras.");
  }
});

// Sesión 25: sensores como mejora progresiva. El botón de deshacer siempre existe.
function apagarSensores() {
  if (controlOrientacion) {
    controlOrientacion();
    controlOrientacion = null;
  }
  if (controlSacudida) {
    controlSacudida();
    controlSacudida = null;
  }
  sensoresActivos = false;
  indicadorOrientacionEl.textContent = "";
  btnSensoresEl.textContent = "📳 Activar agitar para deshacer";
}

async function activarSensores() {
  const permiso = await pedirPermisoSensores();
  if (permiso === "denied") {
    avisarSensores("Denegaste el acceso a los sensores. Usa el botón «Deshacer eliminación».");
    return;
  }
  if (permiso === "no-soportado" || !(await hayLecturasReales())) {
    avisarSensores("Este dispositivo no tiene sensores de movimiento. Usa el botón «Deshacer eliminación».");
    return;
  }

  controlOrientacion = escucharOrientacion(({ beta, gamma }) => {
    indicadorOrientacionEl.textContent = `Inclinación β ${Math.round(beta)}° · γ ${Math.round(gamma)}°`;
  });
  controlSacudida = detectarSacudida(() => {
    deshacerEliminacion();
  });
  sensoresActivos = true;
  btnSensoresEl.textContent = "📳 Agitar para deshacer: ACTIVO (toca para apagar)";
  avisarSensores("");
}

btnSensoresEl.addEventListener("click", () => {
  if (sensoresActivos) apagarSensores();
  else activarSensores();
});
btnDeshacerEl.addEventListener("click", deshacerEliminacion);
window.addEventListener("pagehide", apagarSensores);

// ── Sesión 22: consulta por el índice porPrioridad ────────────────────────
// La lista se filtra con el índice de IndexedDB (tareasPorPrioridad), no con un
// filter del arreglo en memoria: es la razón por la que el índice existe.
let prioridadFiltro = "";

async function aplicarFiltro(prioridad = prioridadFiltro) {
  prioridadFiltro = prioridad;
  if (!prioridad) {
    tareas = await obtenerTodasLasTareas(db);
    estadoFiltroEl.textContent = "";
  } else {
    tareas = await tareasPorPrioridad(db, prioridad);
    estadoFiltroEl.textContent = `Índice porPrioridad: ${tareas.length} tarea(s) de prioridad ${prioridad}.`;
  }
  pintarTodo();
}

filtroPrioridadEl.addEventListener("change", () => {
  void aplicarFiltro(filtroPrioridadEl.value);
});

btnCompletarFiltroEl.addEventListener("click", async () => {
  const prioridad = filtroPrioridadEl.value;
  if (!prioridad) {
    estadoFiltroEl.textContent = "Elige una prioridad para completarlas en bloque.";
    return;
  }
  btnCompletarFiltroEl.disabled = true;
  try {
    const cuantas = await completarPorPrioridad(db, prioridad);
    await aplicarFiltro(prioridad);
    estadoFiltroEl.textContent = `Cursor: ${cuantas} tarea(s) de prioridad ${prioridad} marcadas como completadas.`;
  } catch {
    estadoFiltroEl.textContent = "No se pudieron completar las tareas de esa prioridad.";
  } finally {
    btnCompletarFiltroEl.disabled = false;
  }
});

// ── Sesión 24: micrófono con medidor de nivel, sin grabar ─────────────────
let streamMicrofono = null;
let medidor = null;
let bucleMedidor = 0;

function cerrarMicrofono() {
  cancelAnimationFrame(bucleMedidor);
  bucleMedidor = 0;
  medidor?.cerrar();
  medidor = null;
  streamMicrofono = null;
  medidorBarraEl.style.width = "0";
  btnMicrofonoEl.textContent = "🎙 Medir micrófono";
}

function abrirMicrofonoConMedidor() {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      reject(Object.assign(new Error("sin-soporte"), { name: "TypeError" }));
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        streamMicrofono = stream;
        medidor = crearMedidorDeNivel(stream);
        resolve();
      })
      .catch(reject);
  });
}

btnMicrofonoEl.addEventListener("click", async () => {
  if (medidor) {
    cerrarMicrofono();
    estadoMicrofonoEl.textContent = "Micrófono detenido y liberado.";
    return;
  }
  btnMicrofonoEl.disabled = true;
  estadoMicrofonoEl.textContent = "Pidiendo permiso del micrófono…";
  try {
    // El permiso se pide AQUÍ, dentro del clic.
    await abrirMicrofonoConMedidor();
    btnMicrofonoEl.textContent = "⏹ Detener micrófono";
    estadoMicrofonoEl.textContent = "Micrófono activo: mide el nivel, no graba.";
    const pintar = () => {
      const nivel = medidor.leer();
      medidorBarraEl.style.width = `${Math.round(nivel * 100)}%`;
      bucleMedidor = requestAnimationFrame(pintar);
    };
    pintar();
  } catch (error) {
    const nombre = error?.name ?? "";
    estadoMicrofonoEl.textContent =
      nombre === "NotAllowedError"
        ? "Bloqueaste el permiso del micrófono. Habilítalo desde el candado de la barra de direcciones."
        : nombre === "NotFoundError"
          ? "Este dispositivo no tiene micrófono disponible."
          : nombre === "TypeError"
            ? "El micrófono solo funciona en HTTPS o en localhost."
            : "No se pudo abrir el micrófono.";
    medidorBarraEl.style.width = "0";
  } finally {
    btnMicrofonoEl.disabled = false;
  }
});

window.addEventListener("pagehide", cerrarMicrofono);

formEl.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  const titulo = inputTituloEl.value.trim();
  const nota = inputNotaEl.value.trim();
  if (!titulo) return;
  if (nota && !claveSesion) {
    estadoSeguridad("Para guardar una nota privada, primero activa el cifrado con tu contraseña.");
    inputContrasenaEl.focus();
    return;
  }
  const tarea = crearTarea(titulo, inputPrioridadEl.value);
  try {
    if (nota) {
      await guardarTareaConNota(db, claveSesion, { ...tarea, notaPrivada: nota });
    } else {
      await agregarTarea(db, tarea);
    }
  } catch (error) {
    // El índice porTitulo es único (Sesión 22): un título repetido aborta la
    // transacción con ConstraintError. Se explica en vez de fallar en silencio.
    avisarAdjuntos(
      error?.name === "ConstraintError"
        ? `Ya existe una tarea llamada «${titulo}». Usa otro título.`
        : "No se pudo guardar la tarea en este dispositivo."
    );
    return;
  }
  await aplicarFiltro();
  formEl.reset();

  // Sesión 26: la tarea ya está guardada en el dispositivo. Ahora se anota para
  // enviarla al servidor cuando se pueda — sin bloquear al usuario.
  await encolarCambio(db, "crear-tarea", {
    id: tarea.id,
    titulo: tarea.titulo,
    prioridad: tarea.prioridad,
  });
  await actualizarEstadoSync();
  try {
    await pedirSincronizacion(db);
  } catch (err) {
    console.warn("No se pudo sincronizar todavía:", err.message);
  }
  await actualizarEstadoSync();
});

btnActivarCifradoEl.addEventListener("click", activarCifrado);

// UX/UI (Sesión 23): feedback de carga — skeleton mientras se abren los datos.
const pintarSkeleton = () => {
  revocarUrls();
  listaEl.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const li = document.createElement("li");
    li.className = "tarea skeleton";
    li.innerHTML = '<div class="tarea-fila"><span class="skeleton-barra"></span></div>';
    listaEl.append(li);
  }
};

async function iniciar() {
  pintarSkeleton();
  if (!("indexedDB" in window)) {
    listaEl.innerHTML = "";
    return;
  }
  db = await abrirBaseDeDatos();
  tareas = await obtenerTodasLasTareas(db);
  if (tareas.length === 0) {
    await agregarTarea(db, crearTarea("Aprender el Bloque 3: PWA", "alta"));
    tareas = await obtenerTodasLasTareas(db);
  }
  pintarTodo();
  pintarEstadoAvisos();
  await actualizarEstadoSync();
}

iniciar().catch((error) => {
  console.error("Error al iniciar la app:", error);
  listaEl.innerHTML = "";
  estadoSeguridad("No se pudo abrir el almacenamiento local. La app funciona, pero no guardará cambios.");
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then(() => console.log("Service worker registrado"))
      .catch((error) => console.error("Error al registrar el service worker:", error));
  });
}
