// dispositivo.js — Sesión 24: cámara, micrófono y ubicación.
// El permiso se pide siempre dentro del clic del usuario, nunca al cargar la página.
// Solo funciona en HTTPS o localhost (contexto seguro).

/** Consulta el estado de un permiso sin mostrar ningún aviso. */
export async function estadoPermiso(nombre) {
  try {
    const resultado = await navigator.permissions.query({ name: nombre });
    return resultado.state; // "granted" | "denied" | "prompt"
  } catch {
    return "desconocido"; // el navegador no soporta ese nombre
  }
}

/** Abre la cámara. "environment" = trasera; "user" = frontal. */
export function abrirCamara(facingMode = "environment") {
  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });
}

/** Detiene todas las pistas de un MediaStream. Sin esto el LED queda encendido. */
export function detenerCamara(stream) {
  stream?.getTracks().forEach((pista) => pista.stop());
}

/** Traduce los errores de getUserMedia a mensajes que el usuario entiende. */
export function describirErrorCamara(err) {
  switch (err?.name) {
    case "NotAllowedError":
      return "Bloqueaste el permiso de cámara. Habilítalo desde el candado de la barra de direcciones.";
    case "NotFoundError":
      return "Este dispositivo no tiene cámara disponible.";
    case "NotReadableError":
      return "La cámara está siendo usada por otra aplicación.";
    case "OverconstrainedError":
      return "La cámara no soporta la configuración pedida.";
    case "TypeError":
      return "La cámara solo funciona en HTTPS o en localhost.";
    default:
      return `No se pudo abrir la cámara (${err?.name ?? "error desconocido"}).`;
  }
}

/** Toma el fotograma actual del video y lo convierte en un Blob JPEG. */
export function capturarFoto(video, anchoMax = 640) {
  if (!video.videoWidth || !video.videoHeight) return Promise.resolve(null);

  const escala = Math.min(1, anchoMax / video.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * escala);
  canvas.height = Math.round(video.videoHeight * escala);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
}

/** Abre el micrófono con la misma API de getUserMedia. */
export function abrirMicrofono() {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
}

/** Mide el nivel del micrófono sin grabar nada, con un AnalyserNode. */
export function crearMedidorDeNivel(stream) {
  const Contexto = window.AudioContext || window.webkitAudioContext;
  const ctx = new Contexto();
  ctx.resume(); // debe llamarse dentro de un clic por la política de autoplay
  const analizador = ctx.createAnalyser();
  analizador.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analizador);
  const datos = new Uint8Array(analizador.fftSize);

  return {
    leer() {
      analizador.getByteTimeDomainData(datos);
      let pico = 0;
      for (const valor of datos) pico = Math.max(pico, Math.abs(valor - 128));
      return pico / 128; // 0 = silencio, 1 = máximo
    },
    cerrar() {
      stream.getTracks().forEach((pista) => pista.stop());
      ctx.close();
    },
  };
}

/** Pide la ubicación una sola vez, con timeout y precisión controlados. */
export function obtenerUbicacion({ altaPrecision = false, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject({ code: 0, message: "Geolocation no disponible" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precision: Math.round(pos.coords.accuracy),
          momento: new Date(pos.timestamp).toISOString(),
        }),
      reject,
      { enableHighAccuracy: altaPrecision, timeout: timeoutMs, maximumAge: 60000 }
    );
  });
}

/** Traduce los códigos de error de Geolocation (1, 2, 3) a mensajes claros. */
export function describirErrorUbicacion(err) {
  switch (err?.code) {
    case 1:
      return "Denegaste el permiso de ubicación. La tarea sigue funcionando sin ella.";
    case 2:
      return "No se pudo determinar la posición (sin señal GPS o de red).";
    case 3:
      return "La ubicación tardó demasiado en responder. Intenta de nuevo.";
    default:
      return "La ubicación no está disponible en este navegador.";
  }
}
