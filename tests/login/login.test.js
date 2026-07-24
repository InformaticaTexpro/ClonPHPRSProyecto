'use strict';
/**
 * tests/login/login.test.js
 *
 * Pruebas de validación de formulario de login y resolución de ruta inicial.
 */

const {
  resolverRutaPrincipalUsuario,
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

  test('si no existe ruta base permitida, usa el primer menu util', () => {
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

describe('resolverRutaPrincipalUsuario', () => {
  test('ventas usa el dashboard como modulo principal', () => {
    const user = {
      area: 'Ventas',
      menus: [
        { id: 1, codigo: 'ventas_dashboard', url: '/src/modulo/ventas/dashboard/index.html', orden: 1 },
        { id: 2, codigo: 'ventas_asignadas', url: '/src/modulo/ventas/ventas/index.html', orden: 2 },
      ],
    };

    expect(resolverRutaPrincipalUsuario(user)).toBe('/src/modulo/ventas/dashboard/index.html');
  });

  test('admin acepta administracion o admin como area principal', () => {
    const user = {
      area: 'Administración',
      menus: [
        { id: 11, codigo: 'admin', url: '/src/modulo/admin/admin/index.html', orden: 2 },
        { id: 12, codigo: 'alertas', grupo: 'general', url: '/src/modulo/varios/alertas/index.html', orden: 1 },
      ],
    };

    expect(resolverRutaPrincipalUsuario(user)).toBe('/src/modulo/admin/admin/index.html');
  });

  test('si solo existe alertas, devuelve alertas como ultimo recurso', () => {
    const user = {
      area: 'Operaciones',
      menus: [
        { id: 50, codigo: 'alertas', grupo: 'general', url: '/src/modulo/varios/alertas/index.html', orden: 1 },
      ],
    };

    expect(resolverRutaPrincipalUsuario(user)).toBe('/src/modulo/varios/alertas/index.html');
  });
});
