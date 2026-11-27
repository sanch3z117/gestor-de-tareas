// servidor/server.js — Sesión 26: servidor de ejemplo del Gestor de Tareas.
//
// Hace tres cosas y nada más:
//   1. sirve los archivos del Gestor (para no necesitar dos servidores);
//   2. gestiona las suscripciones push y envía un push de prueba con VAPID;
//   3. recibe las tareas que el Background Sync vacía desde la bandeja (outbox).
//
// Es CÓDIGO DE ENSEÑANZA: sin autenticación, sin base de datos real y sin HTTPS.
// En producción, el punto 2 exige HTTPS en el sitio y la clave privada VAPID
// jamás debe llegar al repositorio.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');

const PUERTO = Number(process.env.PORT) || 3000;
const RAIZ = path.resolve(__dirname, '..');
const ARCHIVO_CLAVES = path.join(__dirname, 'claves-vapid.json');
const ARCHIVO_DATOS = path.join(__dirname, 'datos.json');

// Nunca se sirven por HTTP: la carpeta del servidor (claves privadas), las
// dependencias y los respaldos.
const NO_SERVIR = new Set(['servidor', 'node_modules', 'backup', '.git']);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

// ── Claves VAPID: identifican a TU servidor ante el servicio de push ────────
// Se generan una sola vez y se guardan. La PRIVADA no sale nunca de este
// archivo (y no se sube a Git); la PÚBLICA sí se entrega al navegador.
let claves;
if (fs.existsSync(ARCHIVO_CLAVES)) {
  claves = JSON.parse(fs.readFileSync(ARCHIVO_CLAVES, 'utf8'));
} else {
  claves = webpush.generateVAPIDKeys();
  fs.writeFileSync(ARCHIVO_CLAVES, JSON.stringify(claves, null, 2));
  console.log('Claves VAPID generadas en claves-vapid.json');
}
// El "subject" debe ser un mailto: o una URL tuya; el servicio de push lo usa para contactarte.
webpush.setVapidDetails('mailto:tu-correo@ejemplo.com', claves.publicKey, claves.privateKey);

// ── Datos en memoria, persistidos en datos.json ────────────────────────────
let datos = { suscripciones: [], tareas: [] };
if (fs.existsSync(ARCHIVO_DATOS)) {
  try {
    datos = { suscripciones: [], tareas: [], ...JSON.parse(fs.readFileSync(ARCHIVO_DATOS, 'utf8')) };
  } catch {
    console.warn('datos.json ilegible: se empieza de cero.');
  }
}
const guardarDatos = () => fs.writeFileSync(ARCHIVO_DATOS, JSON.stringify(datos, null, 2));

// ── Utilidades ─────────────────────────────────────────────────────────────
function responder(res, estado, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(estado, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    'Cache-Control': 'no-store',
  });
  res.end(texto);
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datosCrudos = '';
    req.on('data', (trozo) => {
      datosCrudos += trozo;
      if (datosCrudos.length > 1e6) req.destroy(); // límite defensivo: 1 MB
    });
    req.on('end', () => {
      if (!datosCrudos) return resolve({});
      try {
        resolve(JSON.parse(datosCrudos));
      } catch {
        reject(new Error('cuerpo no es JSON'));
      }
    });
    req.on('error', reject);
  });
}

function servirArchivo(res, rutaRelativa) {
  const partes = rutaRelativa.split('/').filter(Boolean);
  if (partes.some((p) => p.startsWith('.'))) return responder(res, 403, { error: 'prohibido' });
  if (partes.length && NO_SERVIR.has(partes[0])) return responder(res, 403, { error: 'prohibido' });

  const archivo = path.resolve(RAIZ, ...partes);
  if (!archivo.startsWith(RAIZ)) return responder(res, 403, { error: 'prohibido' }); // path traversal

  fs.readFile(archivo, (error, contenido) => {
    if (error) return responder(res, 404, { error: 'no encontrado' });
    const tipo = TIPOS[path.extname(archivo).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': tipo, 'Content-Length': contenido.length });
    res.end(contenido);
  });
}

// ── Servidor ───────────────────────────────────────────────────────────────
const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ruta = url.pathname;

  try {
    // Clave pública VAPID: el navegador la necesita para suscribirse.
    if (req.method === 'GET' && ruta === '/api/clave-publica') {
      return responder(res, 200, { clave: claves.publicKey });
    }

    // Guardar una suscripción (deduplicada por endpoint).
    if (req.method === 'POST' && ruta === '/api/suscribir') {
      const suscripcion = await leerCuerpo(req);
      if (!suscripcion.endpoint || !suscripcion.keys?.p256dh || !suscripcion.keys?.auth) {
        return responder(res, 400, { error: 'suscripción incompleta' });
      }
      datos.suscripciones = datos.suscripciones.filter((s) => s.endpoint !== suscripcion.endpoint);
      datos.suscripciones.push(suscripcion);
      guardarDatos();
      return responder(res, 201, { ok: true, total: datos.suscripciones.length });
    }

    // Cancelar una suscripción.
    if (req.method === 'DELETE' && ruta === '/api/suscribir') {
      const { endpoint } = await leerCuerpo(req);
      const antes = datos.suscripciones.length;
      datos.suscripciones = datos.suscripciones.filter((s) => s.endpoint !== endpoint);
      guardarDatos();
      return responder(res, 200, { ok: true, eliminadas: antes - datos.suscripciones.length });
    }

    // Enviar un push de prueba a todas las suscripciones.
    if (req.method === 'POST' && ruta === '/api/enviar-prueba') {
      const { titulo = 'Gestor de Tareas', cuerpo = 'Mensaje de prueba desde el servidor', url: destino = '/index.html' } =
        await leerCuerpo(req);
      const mensaje = JSON.stringify({ titulo, cuerpo, url: destino });
      const resultado = { enviados: 0, fallidos: 0, eliminadas: 0 };

      for (const sub of [...datos.suscripciones]) {
        try {
          await webpush.sendNotification(sub, mensaje, { TTL: 60 });
          resultado.enviados++;
        } catch (err) {
          resultado.fallidos++;
          // 404/410: la suscripción ya no existe (el usuario revocó el permiso o
          // desinstaló). Hay que borrarla, o se acumulan suscripciones muertas.
          if (err.statusCode === 404 || err.statusCode === 410) {
            datos.suscripciones = datos.suscripciones.filter((s) => s.endpoint !== sub.endpoint);
            resultado.eliminadas++;
          } else {
            console.error('Error al enviar push:', err.statusCode ?? '', err.message);
          }
        }
      }
      guardarDatos();
      return responder(res, 200, resultado);
    }

    // Bandeja de salida: cada cambio trae su idCambio (UUID) para no duplicar.
    if (req.method === 'POST' && ruta === '/api/tareas') {
      const cambio = await leerCuerpo(req);
      if (!cambio.idCambio) return responder(res, 400, { error: 'falta idCambio' });

      const yaExiste = datos.tareas.some((t) => t.idCambio === cambio.idCambio);
      if (yaExiste) return responder(res, 200, { ok: true, duplicado: true });

      datos.tareas.push({ ...cambio, recibidoEn: new Date().toISOString() });
      guardarDatos();
      return responder(res, 201, { ok: true, total: datos.tareas.length });
    }

    if (req.method === 'GET' && ruta === '/api/tareas') {
      return responder(res, 200, { tareas: datos.tareas });
    }

    // Archivos estáticos del Gestor.
    if (req.method === 'GET' || req.method === 'HEAD') {
      const pedida = decodeURIComponent(ruta) === '/' ? '/index.html' : decodeURIComponent(ruta);
      return servirArchivo(res, pedida);
    }

    return responder(res, 405, { error: 'método no permitido' });
  } catch (err) {
    console.error('Error en la petición:', err);
    return responder(res, 500, { error: err.message });
  }
});

servidor.listen(PUERTO, () => {
  console.log(`Gestor de Tareas en http://localhost:${PUERTO}`);
  console.log('  · Push real: pulsa «Suscribir a push» y luego «Enviar push de prueba».');
  console.log('  · Sin servicio de push: DevTools → Application → Service Workers → Push.');
  console.log('  · Bandeja: DevTools → Application → Background Sync → sync-tareas → Sync.');
});
