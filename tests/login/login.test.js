'use strict';
/**
 * tests/login/login.test.js
 *
 * Pruebas de validación de formulario de login (lógica frontend pura).
 */

// ── helpers que replican la validación del formulario ──────────────────────────
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
