// workbox-config.js
// Sesión 23: `generateSW` — Workbox escribía todo el Service Worker desde config.
// Sesión 26: `injectManifest` — el SW lo escribimos nosotros (sw-propio.js) y
// Workbox solo le inyecta la lista de precaché, calculada con los hashes reales.
//
// Se ejecuta con:  npx workbox-cli injectManifest workbox-config.js
// El resultado (sw.js) es el archivo que registra el navegador.

module.exports = {
  globDirectory: '.',
  globPatterns: ['index.html', 'manifest.json', 'css/*.css', '*.js', '*.png'],
  globIgnores: [
    'node_modules/**/*',
    'lib/**/*',
    'servidor/**/*',
    'backup/**/*',
    'evidencias/**/*',
    'workbox-config.js',
    // sw-propio.js es el CÓDIGO FUENTE del SW: no debe precachearse a sí mismo.
    'sw-propio.js',
    // sw.js es el resultado de este comando: tampoco entra en el precaché.
    'sw.js',
    'package*.json',
    'icon-96-incorrecto.png',
  ],
  swSrc: 'sw-propio.js',
  swDest: 'sw.js',
};
