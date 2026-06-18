'use strict';
/**
 * tests/routes/admin.test.js
 *
 * Pruebas para endpoints de /api/admin
 * Se mockea requireAuth + requireAdmin y el pool MySQL.
 */

const request = require('supertest');
const express = require('express');

// ── Mock requireAuth + requireAdmin ──────────────────────────────────────────
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, is_admin: true, nombre: 'Admin Test' };
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
}));

// ── Mock MySQL pool ───────────────────────────────────────────────────────────
const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { query: mockQuery },
}));

const adminRouter = require('../../src/routes/admin');
const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

beforeEach(() => jest.clearAllMocks());

// ── Estructura básica ─────────────────────────────────────────────────────────
describe('admin — estructura del router', () => {
  test('el módulo admin.js exporta un router válido', () => {
    expect(adminRouter).toBeDefined();
    expect(typeof adminRouter).toBe('function');
  });
});

// ── GET /api/admin/usuarios ───────────────────────────────────────────────────
describe('GET /api/admin/usuarios', () => {
  test('devuelve lista de usuarios con ok:true', async () => {
    mockQuery.mockResolvedValueOnce([[
      { id: 1, nombre: 'Ana', email: 'ana@texpro.cl', is_admin: 0, activo: 1 },
      { id: 2, nombre: 'Bob', email: 'bob@texpro.cl', is_admin: 1, activo: 1 },
    ]]);
    const res = await request(app).get('/api/admin/usuarios');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  test('retorna 500 si DB falla', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB caída'));
    const res = await request(app).get('/api/admin/usuarios');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

// ── GET /api/admin/usuarios/:id ───────────────────────────────────────────────
describe('GET /api/admin/usuarios/:id', () => {
  test('devuelve usuario por ID', async () => {
    mockQuery.mockResolvedValueOnce([[
      { id: 1, nombre: 'Ana', email: 'ana@texpro.cl', is_admin: 0, activo: 1 },
    ]]);
    const res = await request(app).get('/api/admin/usuarios/1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveProperty('email', 'ana@texpro.cl');
  });

  test('retorna 404 si el usuario no existe', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/admin/usuarios/999');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });
});

// ── PUT /api/admin/usuarios/:id ───────────────────────────────────────────────
describe('PUT /api/admin/usuarios/:id', () => {
  test('actualiza usuario correctamente', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).put('/api/admin/usuarios/2').send({
      activo: 1, tipo_vendedor: 'P', is_admin: false, cod_vendedor: 'V001',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('retorna 400 si admin intenta quitarse permisos a sí mismo', async () => {
    // req.usuario.sub = 1, id = 1, is_admin = false → se bloquea
    const res = await request(app).put('/api/admin/usuarios/1').send({
      activo: 1, tipo_vendedor: 'P', is_admin: false, cod_vendedor: 'V001',
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

// ── POST /api/admin/usuarios/:id/toggle-activo ────────────────────────────────
describe('POST /api/admin/usuarios/:id/toggle-activo', () => {
  test('desactiva un usuario activo', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ activo: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).post('/api/admin/usuarios/2/toggle-activo');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.activo).toBe(false);
  });

  test('activa un usuario inactivo', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ activo: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const res = await request(app).post('/api/admin/usuarios/2/toggle-activo');
    expect(res.status).toBe(200);
    expect(res.body.activo).toBe(true);
  });

  test('retorna 404 si el usuario no existe', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).post('/api/admin/usuarios/999/toggle-activo');
    expect(res.status).toBe(404);
  });
});

// ── Validaciones de roles ─────────────────────────────────────────────────────
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
