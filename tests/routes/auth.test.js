'use strict';
/**
 * tests/routes/auth.test.js
 *
 * Pruebas para los endpoints de /api/auth:
 *   POST /login, GET /me, POST /logout
 */

const request = require('supertest');
const express = require('express');
const jwt     = require('jsonwebtoken');

process.env.JWT_SECRET     = 'test-secret-auth';
process.env.JWT_EXPIRES_IN = '8h';

// ── Mocks ──────────────────────────────────────────────────────────────────────
const mockDbQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { query: mockDbQuery },
}));

jest.mock('../../src/utils/pbkdf2Django', () => ({
  verifyPasswordDjango: jest.fn(),
  hashPasswordDjango:   jest.fn(() => 'fakehash'),
}));

jest.mock('../../src/models/usuario', () => ({
  updateLastLogin: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, nombre: 'Ana' };
    next();
  },
}));

const { verifyPasswordDjango } = require('../../src/utils/pbkdf2Django');
const authRouter = require('../../src/routes/auth');
const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

beforeEach(() => jest.clearAllMocks());

// ── POST /api/auth/login ───────────────────────────────────────────────────────
describe('POST /api/auth/login', () => {
  const fakeUser = {
    id: 1, email: 'ana@texpro.cl', nombre: 'Ana',
    password: 'pbkdf2_sha256$fakehash', area: 'Ventas',
    is_admin: 0, is_active: 1,
  };

  test('devuelve token con credenciales válidas', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[fakeUser]])  // SELECT usuario
      .mockResolvedValueOnce([[{ cod_vendedor: 'V001', tipo: 'P' }]]); // SELECT vendedores
    verifyPasswordDjango.mockReturnValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@texpro.cl', password: 'correcta123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('token');
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.email).toBe('ana@texpro.cl');
    expect(decoded.id).toBe(1);
    expect(decoded.sub).toBe(1);
    expect(res.body.user.id).toBe(1);
  });

  test('devuelve 401 con contraseña incorrecta', async () => {
    mockDbQuery.mockResolvedValueOnce([[fakeUser]]);
    verifyPasswordDjango.mockReturnValueOnce(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@texpro.cl', password: 'incorrecta' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('devuelve 401 si el usuario no existe', async () => {
    mockDbQuery.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'noexiste@texpro.cl', password: 'cualquiera' });
    expect(res.status).toBe(401);
  });

  test('devuelve 401 si el usuario está inactivo', async () => {
    mockDbQuery.mockResolvedValueOnce([[{ ...fakeUser, is_active: 0 }]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@texpro.cl', password: 'correcta123' });
    expect(res.status).toBe(401);
  });

  test('devuelve 400 si faltan email o password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '' });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────────
describe('GET /api/auth/me', () => {
  test('devuelve perfil con token válido', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[{ id: 1, email: 'ana@texpro.cl', nombre: 'Ana', is_active: 1, is_admin: 0 }]])
      .mockResolvedValueOnce([[{ cod_vendedor: 'V001', tipo: 'P' }]]);

    const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toHaveProperty('email');
  });

  test('retorna 500 si la BD falla', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB error'));
    const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────────
describe('POST /api/auth/logout', () => {
  test('devuelve ok:true', async () => {
    const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
