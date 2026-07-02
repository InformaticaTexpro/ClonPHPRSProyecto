'use strict';

/**
 * pbkdf2Django.js
 * Verifica contraseñas generadas por Django en formato:
 *   pbkdf2_sha256$<iterations>$<salt>$<hash_base64>
 *
 * Compatible con ventas_usuario.password (600.000 iteraciones).
 */

const crypto = require('crypto');

/**
 * Parsea un hash Django en sus componentes.
 * @param {string} encoded
 * @returns {{ algorithm: string, iterations: number, salt: string, hash: string }}
 */
function parseDjangoHash(encoded) {
  if (!encoded || typeof encoded !== 'string') {
    throw new Error('Hash inválido: debe ser un string no vacío');
  }

  const parts = encoded.split('$');

  if (parts.length !== 4) {
    throw new Error(`Formato de hash Django inválido: se esperan 4 partes, se recibieron ${parts.length}`);
  }

  const [algorithm, rawIterations, salt, hash] = parts;
  const iterations = Number(rawIterations);

  if (!Number.isFinite(iterations) || iterations <= 0) {
    throw new Error('Número de iteraciones inválido');
  }

  return { algorithm, iterations, salt, hash };
}

/**
 * Verifica una contraseña en texto plano contra un hash Django PBKDF2-SHA256.
 * Usa timingSafeEqual para prevenir timing attacks.
 *
 * @param {string} password       Contraseña en texto plano
 * @param {string} encoded        Hash almacenado en BD (ventas_usuario.password)
 * @returns {boolean}
 */
function verifyPasswordDjango(password, encoded) {
  let parsed;
  try {
    parsed = parseDjangoHash(encoded);
  } catch {
    return false;
  }

  if (parsed.algorithm !== 'pbkdf2_sha256') {
    return false;
  }

  try {
    // Django genera 32 bytes (256 bits) con SHA-256
    const derivedKey     = crypto.pbkdf2Sync(password, parsed.salt, parsed.iterations, 32, 'sha256');
    const calculatedHash = derivedKey.toString('base64');

    // Comparación en tiempo constante contra timing attacks
    const bufA = Buffer.from(calculatedHash);
    const bufB = Buffer.from(parsed.hash);

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}
/**
 * Genera un hash Django PBKDF2-SHA256 compatible con 600.000 iteraciones.
 * @param {string} password  Contraseña en texto plano
 * @returns {string}  Hash en formato: pbkdf2_sha256$600000$<salt>$<hash_base64>
 */
function hashPasswordDjango(password) {
  const salt = crypto.randomBytes(12).toString('base64url');
  const iterations = 600000;
  const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const hash = derivedKey.toString('base64');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

module.exports = { parseDjangoHash, verifyPasswordDjango, hashPasswordDjango };
