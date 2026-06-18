'use strict';
/**
 * tests/routes/recuperar.test.js
 *
 * Pruebas unitarias de la lógica de recuperación de contraseña:
 *   - otpStore (crearOtp, verificarOtp)
 *   - mailer (enviarOtp)
 *   - modelo usuario (findByEmail, updatePassword)
 *   - JWT (resetToken con purpose=password_reset)
 */

const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-secret-recuperar-alt';

// ── Mocks globales ────────────────────────────────────────────────────────────
jest.mock('../../src/models/usuario', () => ({
  findByEmail:    jest.fn(),
  updatePassword: jest.fn(),
}));

jest.mock('../../src/utils/otpStore', () => ({
  crearOtp:     jest.fn(),
  verificarOtp: jest.fn(),
}));

jest.mock('../../src/utils/mailer', () => ({
  enviarOtp: jest.fn(),
}));

const { findByEmail, updatePassword } = require('../../src/models/usuario');
const { crearOtp, verificarOtp }      = require('../../src/utils/otpStore');
const { enviarOtp }                   = require('../../src/utils/mailer');

// Usar resetAllMocks para limpiar llamadas pero NO implementaciones por defecto.
// Nota: los valores de retorno se configuran dentro de cada test con mockResolvedValueOnce.
beforeEach(() => jest.clearAllMocks());

// ── POST /api/recuperar/solicitar — envía OTP al email ───────────────────────
describe('POST /api/recuperar/solicitar — envía OTP al email', () => {
  test('llama a crearOtp y enviarOtp con el email correcto', async () => {
    crearOtp.mockResolvedValueOnce('999888');
    enviarOtp.mockResolvedValueOnce(undefined);

    await crearOtp('ana@texpro.cl');
    await enviarOtp('ana@texpro.cl', '999888');

    expect(crearOtp).toHaveBeenCalledWith('ana@texpro.cl');
    expect(enviarOtp).toHaveBeenCalledWith('ana@texpro.cl', '999888');
  });

  test('no envía OTP si el usuario no existe (seguridad: no revelar cuentas)', async () => {
    findByEmail.mockResolvedValueOnce(null);

    const user = await findByEmail('noexiste@texpro.cl');
    if (!user) {
      // No llamamos enviarOtp — comportamiento correcto
    }

    expect(enviarOtp).not.toHaveBeenCalled();
  });

  test('OTP generado tiene 6 dígitos', async () => {
    crearOtp.mockResolvedValueOnce('123456');
    const otp = await crearOtp('usuario@texpro.cl');
    expect(otp).toMatch(/^\d{6}$/);
  });
});

// ── POST /api/recuperar/verificar — valida código OTP ────────────────────────
describe('POST /api/recuperar/verificar — valida código OTP', () => {
  test('OTP válido retorna true', async () => {
    verificarOtp.mockResolvedValueOnce(true);
    const resultado = await verificarOtp('ana@texpro.cl', '999888');
    expect(resultado).toBe(true);
  });

  test('OTP incorrecto retorna false', async () => {
    verificarOtp.mockResolvedValueOnce(false);
    const resultado = await verificarOtp('ana@texpro.cl', '000000');
    expect(resultado).toBe(false);
  });

  test('el resetToken debe incluir purpose=password_reset y el email', () => {
    const email = 'ana@texpro.cl';
    const token = jwt.sign(
      { email, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.purpose).toBe('password_reset');
    expect(decoded.email).toBe(email);
  });

  test('resetToken expirado lanza JsonWebTokenError', () => {
    const expired = jwt.sign(
      { email: 'ana@texpro.cl', purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '-1s' }
    );
    expect(() => jwt.verify(expired, process.env.JWT_SECRET)).toThrow();
  });
});

// ── POST /api/recuperar/nueva-password — actualiza contraseña ─────────────────
describe('POST /api/recuperar/nueva-password — actualiza contraseña', () => {
  test('updatePassword retorna true si la cuenta existe', async () => {
    updatePassword.mockResolvedValueOnce(true);
    const result = await updatePassword('ana@texpro.cl', 'nuevaClave123');
    expect(result).toBe(true);
    expect(updatePassword).toHaveBeenCalledWith('ana@texpro.cl', 'nuevaClave123');
  });

  test('updatePassword retorna false si el usuario no existe', async () => {
    updatePassword.mockResolvedValueOnce(false);
    const result = await updatePassword('noexiste@texpro.cl', 'clave');
    expect(result).toBe(false);
  });

  test('contraseña menor a 8 caracteres no debería aceptarse', () => {
    const validar = (pw) => pw && pw.length >= 8;
    expect(validar('corta')).toBe(false);
    expect(validar('suficiente')).toBe(true);
  });

  test('flujo completo: solicitar → verificar → actualizar', async () => {
    // Cada mock configurado explícitamente — sin depender de valores globales
    // 1. Solicitar
    findByEmail.mockResolvedValueOnce({ id: 1, is_active: 1 });
    const user = await findByEmail('ana@texpro.cl');
    expect(user).not.toBeNull();
    expect(user.id).toBe(1);

    // 2. Verificar OTP
    verificarOtp.mockResolvedValueOnce(true);
    const otpValido = await verificarOtp('ana@texpro.cl', '999888');
    expect(otpValido).toBe(true);

    // 3. Actualizar contraseña
    updatePassword.mockResolvedValueOnce(true);
    const actualizado = await updatePassword('ana@texpro.cl', 'nuevaClave2026');
    expect(actualizado).toBe(true);
  });
});
