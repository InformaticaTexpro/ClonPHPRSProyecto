'use strict';

/**
 * tests/utils/pbkdf2Django.test.js
 *
 * Pruebas unitarias para src/utils/pbkdf2Django.js
 * Cubre: parseDjangoHash, verifyPasswordDjango, hashPasswordDjango
 *
 * Estrategia:
 *   - hashPasswordDjango genera hashes reales que luego verifyPasswordDjango valida.
 *   - Se usa un hash de referencia precalculado para verificar la compatibilidad
 *     con Django (salt conocido, iteraciones bajas para que el test sea rápido).
 *   - Las iteraciones de producción son 600.000; para los tests se usa un
 *     hash pre-calculado con iteraciones reducidas y hashPasswordDjango
 *     (que sí usa 600k pero solo se llama 1 vez por round-trip test).
 */

const crypto = require('crypto');
const {
  parseDjangoHash,
  verifyPasswordDjango,
  hashPasswordDjango
} = require('../../src/utils/pbkdf2Django');

// ── Hash de referencia (pre-calculado con 1 iteración para velocidad) ──
// Sirve para testear la lógica de parseo y verificación sin depender de
// hashPasswordDjango (que usa 600k iteraciones).
function buildTestHash(password, salt, iterations = 1) {
  const key  = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const hash = key.toString('base64');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
}

// ─────────────────────────────────────────────────────────────────
describe('parseDjangoHash', () => {

  test('parsea correctamente un hash válido', () => {
    const encoded = 'pbkdf2_sha256$600000$saltABCdef$AAABBBCCC=';
    const parsed  = parseDjangoHash(encoded);
    expect(parsed.algorithm).toBe('pbkdf2_sha256');
    expect(parsed.iterations).toBe(600000);
    expect(parsed.salt).toBe('saltABCdef');
    expect(parsed.hash).toBe('AAABBBCCC=');
  });

  test('lanza Error si el input es null', () => {
    expect(() => parseDjangoHash(null)).toThrow();
  });

  test('lanza Error si el input es string vacío', () => {
    expect(() => parseDjangoHash('')).toThrow();
  });

  test('lanza Error si tiene menos de 4 partes separadas por $', () => {
    expect(() => parseDjangoHash('pbkdf2_sha256$600000$soloDos')).toThrow();
  });

  test('lanza Error si tiene más de 4 partes', () => {
    expect(() => parseDjangoHash('a$b$c$d$e')).toThrow();
  });

  test('lanza Error si las iteraciones no son un número', () => {
    expect(() => parseDjangoHash('pbkdf2_sha256$NaN$salt$hash')).toThrow();
  });

  test('lanza Error si las iteraciones son 0', () => {
    expect(() => parseDjangoHash('pbkdf2_sha256$0$salt$hash')).toThrow();
  });

  test('lanza Error si las iteraciones son negativas', () => {
    expect(() => parseDjangoHash('pbkdf2_sha256$-1$salt$hash')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────
describe('verifyPasswordDjango', () => {

  test('retorna true para contraseña correcta (hash de referencia)', () => {
    const password = 'MiClave123!';
    const salt     = 'saltFijo123';
    const encoded  = buildTestHash(password, salt);
    expect(verifyPasswordDjango(password, encoded)).toBe(true);
  });

  test('retorna false para contraseña incorrecta', () => {
    const encoded = buildTestHash('ClaveCorrecta', 'saltFijo123');
    expect(verifyPasswordDjango('ClaveIncorrecta', encoded)).toBe(false);
  });

  test('retorna false si se modifica 1 caracter del hash', () => {
    const encoded  = buildTestHash('MiClave', 'salt123');
    const partes   = encoded.split('$');
    partes[3]      = partes[3].slice(0, -1) + (partes[3].endsWith('A') ? 'B' : 'A');
    const alterado = partes.join('$');
    expect(verifyPasswordDjango('MiClave', alterado)).toBe(false);
  });

  test('retorna false si el algoritmo no es pbkdf2_sha256', () => {
    const encoded = 'bcrypt$12$saltXYZ$hashXYZ';
    expect(verifyPasswordDjango('pass', encoded)).toBe(false);
  });

  test('retorna false si el hash es null o vacío', () => {
    expect(verifyPasswordDjango('pass', null)).toBe(false);
    expect(verifyPasswordDjango('pass', '')).toBe(false);
  });

  test('distingue contraseñas con diferente capitalización', () => {
    const encoded = buildTestHash('Clave', 'saltFijo');
    expect(verifyPasswordDjango('clave', encoded)).toBe(false);
    expect(verifyPasswordDjango('CLAVE', encoded)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('hashPasswordDjango', () => {

  // NOTA: este test llama pbkdf2Sync con 600k iteraciones (1 sola vez).
  // En CI con Node ≥18 tarda ~800ms — aceptable para seguridad de producción.

  test('retorna un string en formato Django pbkdf2_sha256', () => {
    const encoded = hashPasswordDjango('testpass');
    expect(typeof encoded).toBe('string');
    const partes = encoded.split('$');
    expect(partes).toHaveLength(4);
    expect(partes[0]).toBe('pbkdf2_sha256');
    expect(partes[1]).toBe('600000');
    expect(partes[2].length).toBeGreaterThan(0); // salt no vacío
    expect(partes[3].length).toBeGreaterThan(0); // hash no vacío
  });

  test('hashPasswordDjango + verifyPasswordDjango → round-trip exitoso', () => {
    const password = 'Texpro@Seguro2026!';
    const encoded  = hashPasswordDjango(password);
    expect(verifyPasswordDjango(password, encoded)).toBe(true);
  });

  test('contraseña incorrecta no pasa el round-trip', () => {
    const encoded = hashPasswordDjango('original');
    expect(verifyPasswordDjango('diferente', encoded)).toBe(false);
  });

  test('genera salts diferentes en cada llamada', () => {
    const encoded1 = hashPasswordDjango('mismaPass');
    const encoded2 = hashPasswordDjango('mismaPass');
    const salt1    = encoded1.split('$')[2];
    const salt2    = encoded2.split('$')[2];
    expect(salt1).not.toBe(salt2);
  });
}, 30000); // timeout generoso para 2 llamadas con 600k iteraciones

// ─────────────────────────────────────────────────────────────────
describe('parseDjangoHash — integración con verifyPasswordDjango', () => {
  test('parseDjangoHash sobre un hash generado retorna las 4 propiedades correctas', () => {
    const encoded = buildTestHash('pass', 'miSalt42', 1);
    const parsed  = parseDjangoHash(encoded);
    expect(parsed.algorithm).toBe('pbkdf2_sha256');
    expect(parsed.iterations).toBe(1);
    expect(parsed.salt).toBe('miSalt42');
    expect(typeof parsed.hash).toBe('string');
    expect(parsed.hash.length).toBeGreaterThan(0);
  });
});
