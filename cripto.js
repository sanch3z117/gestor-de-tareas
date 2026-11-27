// cripto.js — Web Crypto API: hashes, derivación de claves y cifrado.
// Sesión 22 (IndexedDB y Web Crypto API). Solo funciona en HTTPS o localhost.

/** Calcula el hash SHA-256 de un texto y lo devuelve en hexadecimal. */
export async function calcularHash(texto) {
  const datos = new TextEncoder().encode(texto);
  const buffer = await crypto.subtle.digest('SHA-256', datos);
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Deriva una clave AES-GCM reproducible a partir de una contraseña y una sal.
 * La contraseña nunca se guarda: la clave se re-deriva en cada sesión.
 */
export async function derivarClaveDesdeContrasena(contrasena, sal) {
  const materialBase = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(contrasena),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sal, iterations: 100000, hash: 'SHA-256' },
    materialBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Cifra un texto con AES-GCM. Devuelve el cifrado y el IV (ninguno de los dos es la clave). */
export async function cifrarTexto(clave, texto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const datos = new TextEncoder().encode(texto);
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, clave, datos);
  return { cifrado, iv };
}

/** Descifra un texto con AES-GCM. Rechaza la promesa si el dato fue alterado. */
export async function descifrarTexto(clave, { cifrado, iv }) {
  const datos = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, clave, cifrado);
  return new TextDecoder().decode(datos);
}
