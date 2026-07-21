'use strict';
/**
 * tests/login/login.test.js
 *
 * Pruebas de validación de formulario de login y resolución de ruta inicial.
 */

const {
  resolverRutaInicialUsuario,
  FALLBACK_URL,
} = require('../../src/modulo/varios/login/login-routes');

// ── helpers que replican la validación del formulario ─────────────────────────
function validarEmail(email) {
  if (!email || !email.trim()) return 'El email es obligatorio';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Email inválido';
  return null;
}

function validarPassword(password) {
  if (!password || !password.trim()) return 'La contraseña es obligatoria';
  return null;
}

// ── formulario de login ────────────────────────────────────────────────────────
describe('formulario de login', () => {
  test('valida email vacío', () => {
    expect(validarEmail('')).toBe('El email es obligatorio');
    expect(validarEmail('   ')).toBe('El email es obligatorio');
    expect(validarEmail(null)).toBe('El email es obligatorio');
  });

  test('valida contraseña vacía', () => {
    expect(validarPassword('')).toBe('La contraseña es obligatoria');
    expect(validarPassword('   ')).toBe('La contraseña es obligatoria');
    expect(validarPassword(null)).toBe('La contraseña es obligatoria');
  });

  test('email con formato inválido retorna error', () => {
    expect(validarEmail('notanemail')).toBe('Email inválido');
    expect(validarEmail('sin@dominio')).toBe('Email inválido');
  });

  test('email válido retorna null', () => {
    expect(validarEmail('usuario@texpro.cl')).toBeNull();
  });

  test('contraseña con contenido retorna null', () => {
    expect(validarPassword('secreto123')).toBeNull();
  });
});

describe('resolverRutaInicialUsuario', () => {
  test('prioriza la ruta base del area cuando esta permitida', () => {
    const user = {
      area: 'Ventas',
      menus: [
        { id: 10, url: '/src/modulo/ventas/dashboard/index.html' },
        { id: 11, url: '/src/modulo/ventas/ventas/index.html' },
      ],
    };

    expect(resolverRutaInicialUsuario(user)).toBe('/src/modulo/ventas/dashboard/index.html');
  });

  test('si no existe ruta base permitida, usa el primer menu asignado', () => {
    const user = {
      area: 'Operaciones',
      menus: [
        { id: 20, url: '/src/modulo/ventas/ventas/index.html' },
        { id: 21, url: '/src/modulo/ventas/historial-cliente/index.html' },
      ],
    };

    expect(resolverRutaInicialUsuario(user)).toBe('/src/modulo/ventas/ventas/index.html');
  });

  test('devuelve fallback cuando no hay menus', () => {
    expect(resolverRutaInicialUsuario({ area: 'Ventas', menus: [] })).toBe(FALLBACK_URL);
    expect(resolverRutaInicialUsuario(null)).toBe(FALLBACK_URL);
  });
});
