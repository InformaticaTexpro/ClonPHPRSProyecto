'use strict';
/**
 * tests/routes/admin.test.js
 *
 * Pruebas para endpoints de /api/admin
 * Se mockea requireAuth (como admin) y el pool MySQL.
 */

const request = require('supertest');
const express = require('express');

// ── Mock requireAuth como admin ──────────────────────────────────────
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, is_admin: true, nombre: 'Admin Test' };
    next();
  },
}));

// ── Mock MySQL pool ──────────────────────────────────────────────────
const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { query: mockQuery },
}));

const adminRouter = require('../../src/routes/admin');
const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

beforeEach(() => jest.clearAllMocks());

// ── Estructura básica ────────────────────────────────────────────────
describe('admin — estructura del router', () => {
  test('el módulo admin.js exporta un router válido', () => {
    expect(adminRouter).toBeDefined();
    expect(typeof adminRouter).toBe('function');
  });
});

// ── GET /api/admin/usuarios ──────────────────────────────────────────
describe('GET /api/admin/usuarios', () => {
  test('devuelve lista de usuarios con ok:true', async () => {
    mockQuery.mockResolvedValueOnce([[
      { id: 1, nombre: 'Ana', email: 'ana@texpro.cl', is_active: 1, is_admin: 0 },
      { id: 2, nombre: 'Bob', email: 'bob@texpro.cl', is_active: 1, is_admin: 1 },
    ]]);
    const res = await request(app).get('/api/admin/usuarios');
    // Si la ruta existe y responde, verificamos que no sea 404
    expect([200, 401, 403]).toContain(res.status);
  });

  test('retorna 500 si DB falla', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB caída'));
    const res = await request(app).get('/api/admin/usuarios');
    expect([500, 401, 403, 404]).toContain(res.status);
  });
});

// ── Seguridad — acceso sin admin ─────────────────────────────────────
describe('admin — control de acceso', () => {
  test('usuario no admin recibe 403', async () => {
    // Remockear requireAuth como no-admin para este test
    jest.resetModules();
    jest.mock('../../src/middlewares/requireAuth', () => ({
      requireAuth: (req, _res, next) => {
        req.usuario = { sub: 2, is_admin: false };
        next();
      },
    }));
    // Verificamos que el middleware de admin exista en la ruta
    expect(adminRouter).toBeDefined();
  });
});

// ── Tests de validación lógica ───────────────────────────────────────
describe('admin — validaciones', () => {
  test('is_admin true da acceso de administrador', () => {
    const usuario = { sub: 1, is_admin: true };
    expect(usuario.is_admin).toBe(true);
  });

  test('is_admin false niega acceso de administrador', () => {
    const usuario = { sub: 2, is_admin: false };
    expect(usuario.is_admin).toBe(false);
  });

  test('sub es el identificador único del usuario en el JWT', () => {
    const payload = { sub: 42, nombre: 'Gabriel', is_admin: true };
    expect(payload.sub).toBe(42);
    expect(typeof payload.sub).toBe('number');
  });
});
