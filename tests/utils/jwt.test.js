'use strict';

/**
 * tests/utils/jwt.test.js
 *
 * Pruebas unitarias para src/utils/jwt.js
 * Cubre: generarToken y verificarToken
 *
 * Estrategia: se usa un JWT_SECRET de 32 caracteres fijo sólo en el
 * entorno de tests, sin tocar variables de producción.
 */

const jwt = require('jsonwebtoken');

// ── Fijar JWT_SECRET antes de importar el módulo ──────────────────
const TEST_SECRET = 'test_secret_de_32_chars_para_ci!';
process.env.JWT_SECRET     = TEST_SECRET;
process.env.JWT_EXPIRES_IN = '1h';

const { generarToken, verificarToken } = require('../../src/utils/jwt');

// ── Payload base reutilizable ─────────────────────────────────────
const usuarioBase = {
  sub:       42,
  email:     'vendedor@texpro.cl',
  is_admin:  false,
  vendedores: [{ cod_vendedor: 'V001', tipo: 'C' }],
  area:      'Ventas'
};

// ─────────────────────────────────────────────────────────────────
describe('generarToken', () => {

  test('retorna un string (token JWT)', () => {
    const token = generarToken(usuarioBase);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3); // header.payload.signature
  });

  test('el payload contiene sub, email, is_admin, vendedores y area', () => {
    const token   = generarToken(usuarioBase);
    const decoded = jwt.decode(token);
    expect(decoded.id).toBe(42);
    expect(decoded.sub).toBe(42);
    expect(decoded.email).toBe('vendedor@texpro.cl');
    expect(decoded.is_admin).toBe(false);
    expect(Array.isArray(decoded.vendedores)).toBe(true);
    expect(decoded.vendedores[0].cod_vendedor).toBe('V001');
    expect(decoded.area).toBe('Ventas');
  });

  test('acepta id en lugar de sub (retrocompatibilidad)', () => {
    const usuarioConId = { id: 99, email: 'otro@texpro.cl', is_admin: true };
    const token   = generarToken(usuarioConId);
    const decoded = jwt.decode(token);
    expect(decoded.id).toBe(99);
    expect(decoded.sub).toBe(99);
  });

  test('sub tiene precedencia sobre id cuando ambos están presentes', () => {
    const usuario = { sub: 10, id: 99, email: 'x@texpro.cl' };
    const decoded = jwt.decode(generarToken(usuario));
    expect(decoded.sub).toBe(10);
  });

  test('vendedores queda como array vacío si no se proporciona', () => {
    const decoded = jwt.decode(generarToken({ sub: 1, email: 'a@b.cl' }));
    expect(decoded.vendedores).toEqual([]);
  });

  test('area queda como string vacío si no se proporciona', () => {
    const decoded = jwt.decode(generarToken({ sub: 1, email: 'a@b.cl' }));
    expect(decoded.area).toBe('');
  });

  test('is_admin se convierte a boolean: 1 → true', () => {
    const decoded = jwt.decode(generarToken({ sub: 1, email: 'a@b.cl', is_admin: 1 }));
    expect(decoded.is_admin).toBe(true);
  });

  test('lanza Error cuando JWT_SECRET no está definido', () => {
    const original = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => generarToken(usuarioBase)).toThrow('JWT_SECRET no está definido en .env');
    process.env.JWT_SECRET = original; // restaurar para los demás tests
  });
});

// ─────────────────────────────────────────────────────────────────
describe('verificarToken', () => {

  test('verifica y retorna el payload de un token válido', () => {
    const token   = generarToken(usuarioBase);
    const payload = verificarToken(token);
    expect(payload.sub).toBe(42);
    expect(payload.email).toBe('vendedor@texpro.cl');
  });

  test('lanza JsonWebTokenError con firma inválida', () => {
    const tokenFalsificado = generarToken(usuarioBase).slice(0, -5) + 'XXXXX';
    expect(() => verificarToken(tokenFalsificado)).toThrow();
  });

  test('lanza JsonWebTokenError con token completamente malformado', () => {
    expect(() => verificarToken('esto.no.es.un.jwt')).toThrow();
  });

  test('lanza TokenExpiredError con token expirado', () => {
    // Generar token que expiró hace 1 segundo
    const tokenExpirado = jwt.sign(
      { sub: 1, email: 'x@texpro.cl' },
      TEST_SECRET,
      { expiresIn: -1 }
    );
    expect(() => verificarToken(tokenExpirado)).toThrow();
  });

  test('lanza Error cuando JWT_SECRET no está definido', () => {
    const original = process.env.JWT_SECRET;
    const token    = generarToken(usuarioBase); // generar antes de borrar
    delete process.env.JWT_SECRET;
    expect(() => verificarToken(token)).toThrow('JWT_SECRET no está definido en .env');
    process.env.JWT_SECRET = original;
  });

  test('payload incluye iat y exp', () => {
    const token   = generarToken(usuarioBase);
    const payload = verificarToken(token);
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });
});
