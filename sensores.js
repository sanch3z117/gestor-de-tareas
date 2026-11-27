// sensores.js — Sesión 25: DeviceOrientation y DeviceMotion.
// Los sensores son mejora progresiva: siempre existe un botón que hace lo mismo.
// Solo se entregan en contexto seguro (HTTPS o localhost).

/** Pide permiso en iOS y devuelve "granted", "denied", "no-necesario" o "no-soportado". */
export async function pedirPermisoSensores() {
  if (!("DeviceMotionEvent" in window)) return "no-soportado";
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      return await DeviceMotionEvent.requestPermission();
    } catch {
      return "denied"; // p. ej. NotAllowedError por no venir de un clic
    }
  }
  return "no-necesario"; // Android/Chromium: el permiso es implícito
}

/** Espera una lectura con valores reales; un computador dispara un evento con nulls. */
export function hayLecturasReales(timeoutMs = 1000) {
  return new Promise((resolve) => {
    const alRecibir = (evento) => {
      const aceleracion = evento.accelerationIncludingGravity;
      if (aceleracion && aceleracion.x !== null) {
        limpiar();
        resolve(true);
      }
    };
    const limpiar = () => {
      window.removeEventListener("devicemotion", alRecibir);
      clearTimeout(temporizador);
    };
    const temporizador = setTimeout(() => {
      limpiar();
      resolve(false);
    }, timeoutMs);
    window.addEventListener("devicemotion", alRecibir);
  });
}

/** Lee la orientación como máximo `intervaloMs`; devuelve una función para apagarla. */
export function escucharOrientacion(callback, intervaloMs = 100) {
  let ultimo = 0;
  const manejador = (evento) => {
    const ahora = performance.now();
    if (ahora - ultimo < intervaloMs) return;
    ultimo = ahora;
    if (evento.beta === null) return; // sin sensor
    callback({ alfa: evento.alpha, beta: evento.beta, gamma: evento.gamma });
  };
  window.addEventListener("deviceorientation", manejador);
  return () => window.removeEventListener("deviceorientation", manejador);
}

/**
 * Detecta una sacudida por la desviación de la magnitud respecto a la gravedad.
 * Devuelve una función para dejar de escuchar.
 */
export function detectarSacudida(onSacudida, { umbral = 12, enfriamientoMs = 1000 } = {}) {
  const GRAVEDAD = 9.81;
  let ultimaSacudida = 0;

  const manejador = (evento) => {
    const aceleracion = evento.accelerationIncludingGravity;
    if (!aceleracion || aceleracion.x === null) return;

    const magnitud = Math.hypot(aceleracion.x, aceleracion.y, aceleracion.z);
    const desviacion = Math.abs(magnitud - GRAVEDAD);
    const ahora = performance.now();

    if (desviacion > umbral && ahora - ultimaSacudida > enfriamientoMs) {
      ultimaSacudida = ahora;
      onSacudida(Math.round(desviacion * 10) / 10);
    }
  };

  window.addEventListener("devicemotion", manejador);
  return () => window.removeEventListener("devicemotion", manejador);
}
