'use strict';
/**
 * tests/recuperar-password/recuperar.test.js
 *
 * Pruebas para el flujo de recuperación de contraseña:
 *   POST /api/auth/recuperar
 *   POST /api/auth/verificar-otp
 *   POST /api/auth/nueva-password
 */

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-recuperar';

// ── Mocks ──────────────────────────────────────────────────────────────────────
jest.mock('../../src/models/usuario', () => ({
  findByEmail:    jest.fn(),
  updatePassword: jest.fn(),
}));

jest.mock('../../src/utils/otpStore', () => ({
  crearOtp:    jest.fn().mockResolvedValue('123456'),
  verificarOtp: jest.fn(),
}));

jest.mock('../../src/utils/mailer', () => ({
  enviarOtp: jest.fn().mockResolvedValue(undefined),
}));

const { findByEmail, updatePassword } = require('../../src/models/usuario');
const { verificarOtp }               = require('../../src/utils/otpStore');
const { enviarOtp }                  = require('../../src/utils/mailer');

const recuperarRouter = require('../../src/routes/recuperar');
const app = express();
app.use(express.json());
app.use('/api/auth', recuperarRouter);

beforeEach(() => jest.clearAllMocks());

// ── POST /api/auth/recuperar ───────────────────────────────────────────────────
describe('POST /api/auth/recuperar', () => {
  test('envía OTP si el email existe', async () => {
    findByEmail.mockResolvedValueOnce({ id: 1, is_active: 1 });

    const res = await request(app)
      .post('/api/auth/recuperar')
      .send({ email: 'ana@texpro.cl' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(enviarOtp).toHaveBeenCalledWith('ana@texpro.cl', '123456');
  });

  test('responde OK aunque el email no exista (no revelar cuentas)', async () => {
    findByEmail.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/recuperar')
      .send({ email: 'noexiste@texpro.cl' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(enviarOtp).not.toHaveBeenCalled();
  });

  test('retorna 400 si el email tiene formato inválido', async () => {
    const res = await request(app)
      .post('/api/auth/recuperar')
      .send({ email: 'notanemail' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('retorna 400 si el email está vacío', async () => {
    const res = await request(app)
      .post('/api/auth/recuperar')
      .send({ email: '' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/verificar-otp ───────────────────────────────────────────────
describe('POST /api/auth/verificar-otp', () => {
  test('valida el código OTP y retorna resetToken', async () => {
    verificarOtp.mockResolvedValueOnce(true);

    const res = await request(app)
      .post('/api/auth/verificar-otp')
      .send({ email: 'ana@texpro.cl', otp: '123456' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('resetToken');
    // El resetToken debe ser un JWT válido con purpose=password_reset
    const decoded = jwt.verify(res.body.resetToken, process.env.JWT_SECRET);
    expect(decoded.purpose).toBe('password_reset');
    expect(decoded.email).toBe('ana@texpro.cl');
  });

  test('retorna 401 con OTP incorrecto o expirado', async () => {
    verificarOtp.mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/auth/verificar-otp')
      .send({ email: 'ana@texpro.cl', otp: '000000' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('retorna 400 si el OTP no tiene 6 dígitos', async () => {
    const res = await request(app)
      .post('/api/auth/verificar-otp')
      .send({ email: 'ana@texpro.cl', otp: '123' });
    expect(res.status).toBe(400);
  });

  test('retorna 400 si falta email', async () => {
    const res = await request(app)
      .post('/api/auth/verificar-otp')
      .send({ otp: '123456' });
    expect(res.status).toBe(400);
  });
});

// ── POST /api/auth/nueva-password ──────────────────────────────────────────────
describe('POST /api/auth/nueva-password', () => {
  function makeResetToken(email = 'ana@texpro.cl') {
    return jwt.sign(
      { email, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
  }

  test('actualiza la contraseña con token y password válidos', async () => {
    updatePassword.mockResolvedValueOnce(true);
    const res = await request(app)
      .post('/api/auth/nueva-password')
      .send({ resetToken: makeResetToken(), password: 'nuevaClave123' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('retorna 400 si password tiene menos de 8 caracteres', async () => {
    const res = await request(app)
      .post('/api/auth/nueva-password')
      .send({ resetToken: makeResetToken(), password: 'corta' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('retorna 401 con token de reset expirado o inválido', async () => {
    const res = await request(app)
      .post('/api/auth/nueva-password')
      .send({ resetToken: 'token.invalido.xxx', password: 'nuevaClave123' });
    expect(res.status).toBe(401);
  });

  test('retorna 404 si el usuario no existe o está inactivo', async () => {
    updatePassword.mockResolvedValueOnce(false);
    const res = await request(app)
      .post('/api/auth/nueva-password')
      .send({ resetToken: makeResetToken(), password: 'nuevaClave123' });
    expect(res.status).toBe(404);
  });

  test('retorna 400 si faltan campos', async () => {
    const res = await request(app)
      .post('/api/auth/nueva-password')
      .send({});
    expect(res.status).toBe(400);
  });
});
