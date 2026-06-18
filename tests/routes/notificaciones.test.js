'use strict';
/**
 * tests/routes/notificaciones.test.js
 *
 * Pruebas para endpoints de /api/notificaciones
 * Se mockea requireAuth y el modelo de notificaciones.
 */

const request  = require('supertest');
const express  = require('express');

// ── Mock requireAuth ─────────────────────────────────────────────────
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, nombre: 'Test User' };
    next();
  },
}));

// ── Mock modelo notificacion ─────────────────────────────────────────
jest.mock('../../src/models/notificacion', () => ({
  obtenerNotificaciones: jest.fn().mockResolvedValue([
    { id: 1, mensaje: 'Alerta de prueba', leida: 0, created_at: new Date() },
  ]),
  contarNoLeidas: jest.fn().mockResolvedValue(3),
  marcarLeida:    jest.fn().mockResolvedValue(true),
  marcarTodasLeidas: jest.fn().mockResolvedValue(true),
}));

const notificacionesRouter = require('../../src/routes/notificaciones');
const app = express();
app.use(express.json());
app.use('/api/notificaciones', notificacionesRouter);

// ── GET /api/notificaciones ──────────────────────────────────────────
describe('GET /api/notificaciones', () => {
  test('devuelve ok:true con array de notificaciones', async () => {
    const res = await request(app).get('/api/notificaciones');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.notificaciones)).toBe(true);
  });

  test('acepta query soloNoLeidas=1', async () => {
    const res = await request(app).get('/api/notificaciones?soloNoLeidas=1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('acepta query limit=10', async () => {
    const res = await request(app).get('/api/notificaciones?limit=10');
    expect(res.status).toBe(200);
  });
});

// ── GET /api/notificaciones/contador ────────────────────────────────
describe('GET /api/notificaciones/contador', () => {
  test('devuelve ok:true y total numérico', async () => {
    const res = await request(app).get('/api/notificaciones/contador');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  test('total es mayor o igual a 0', async () => {
    const res = await request(app).get('/api/notificaciones/contador');
    expect(res.body.total).toBeGreaterThanOrEqual(0);
  });
});

// ── PATCH /api/notificaciones/:id/leer ──────────────────────────────
describe('PATCH /api/notificaciones/:id/leer', () => {
  test('devuelve ok:true con ID válido', async () => {
    const res = await request(app).patch('/api/notificaciones/1/leer');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('devuelve 400 con ID 0', async () => {
    const res = await request(app).patch('/api/notificaciones/0/leer');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('devuelve 400 con ID no numérico (NaN)', async () => {
    const res = await request(app).patch('/api/notificaciones/abc/leer');
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/notificaciones/leer-todo ─────────────────────────────
describe('PATCH /api/notificaciones/leer-todo', () => {
  test('devuelve ok:true', async () => {
    const res = await request(app).patch('/api/notificaciones/leer-todo');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── Error handling ───────────────────────────────────────────────────
describe('notificaciones — manejo de errores', () => {
  test('GET retorna 500 si el modelo lanza error', async () => {
    const model = require('../../src/models/notificacion');
    model.obtenerNotificaciones.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/api/notificaciones');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  test('contador retorna 500 si el modelo lanza error', async () => {
    const model = require('../../src/models/notificacion');
    model.contarNoLeidas.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/api/notificaciones/contador');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});
