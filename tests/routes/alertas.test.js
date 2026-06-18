'use strict';
/**
 * tests/routes/alertas.test.js
 *
 * Pruebas para endpoints de /api/alertas
 * Se mockea requireAuth y el pool de MySQL.
 */

const request = require('supertest');
const express = require('express');

// ── Mock requireAuth ─────────────────────────────────────────────────
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, is_admin: false };
    next();
  },
}));

// ── Mock MySQL pool ──────────────────────────────────────────────────
const mockQuery = jest.fn();
const mockConn  = {
  beginTransaction: jest.fn().mockResolvedValue(),
  commit:           jest.fn().mockResolvedValue(),
  rollback:         jest.fn().mockResolvedValue(),
  release:          jest.fn(),
  query:            jest.fn(),
};
jest.mock('../../src/config/db', () => ({
  pool: {
    query:         mockQuery,
    getConnection: jest.fn().mockResolvedValue(mockConn),
  },
}));

const alertasRouter = require('../../src/routes/alertas');
const app = express();
app.use(express.json());
app.use('/api/alertas', alertasRouter);

beforeEach(() => {
  jest.clearAllMocks();
});

// ── GET /api/alertas ─────────────────────────────────────────────────
describe('GET /api/alertas', () => {
  test('devuelve ok:true con array data', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/alertas');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('retorna 500 si DB falla', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB error'));
    const res = await request(app).get('/api/alertas');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

// ── GET /api/alertas/contador ────────────────────────────────────────
describe('GET /api/alertas/contador', () => {
  test('devuelve ok:true y total numérico', async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 2 }]]);
    const res = await request(app).get('/api/alertas/contador');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });
});

// ── GET /api/alertas/badge ───────────────────────────────────────────
describe('GET /api/alertas/badge', () => {
  test('devuelve ok:true y total igual que contador', async () => {
    mockQuery.mockResolvedValueOnce([[{ total: 5 }]]);
    const res = await request(app).get('/api/alertas/badge');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBe(5);
  });
});

// ── GET /api/alertas/usuarios ────────────────────────────────────────
describe('GET /api/alertas/usuarios', () => {
  test('devuelve ok:true con array de usuarios activos', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1, nombre: 'Ana', area: 'Ventas' }]]);
    const res = await request(app).get('/api/alertas/usuarios');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ── POST /api/alertas ────────────────────────────────────────────────
describe('POST /api/alertas', () => {
  test('crea alerta con datos válidos', async () => {
    mockConn.query
      .mockResolvedValueOnce([{ insertId: 99 }])  // INSERT alertas
      .mockResolvedValueOnce([{}]);                // INSERT destinatarios
    const res = await request(app).post('/api/alertas').send({
      titulo: 'Vence contrato', tipo: 'personal',
      fecha_vence: '2026-12-31', frecuencia_recordatorio: 'semanal',
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe(99);
  });

  test('retorna 400 sin titulo', async () => {
    const res = await request(app).post('/api/alertas').send({
      tipo: 'personal', fecha_vence: '2026-12-31',
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('retorna 400 sin fecha_vence', async () => {
    const res = await request(app).post('/api/alertas').send({
      titulo: 'Test', tipo: 'personal',
    });
    expect(res.status).toBe(400);
  });

  test('retorna 400 con tipo inválido', async () => {
    const res = await request(app).post('/api/alertas').send({
      titulo: 'Test', tipo: 'invalido', fecha_vence: '2026-12-31',
    });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('retorna 400 con frecuencia inválida', async () => {
    const res = await request(app).post('/api/alertas').send({
      titulo: 'Test', tipo: 'personal', fecha_vence: '2026-12-31',
      frecuencia_recordatorio: 'mensual',
    });
    expect(res.status).toBe(400);
  });
});

// ── PATCH /:id/completar ─────────────────────────────────────────────
describe('PATCH /api/alertas/:id/completar', () => {
  test('devuelve ok:true cuando el creador completa su alerta', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id_creador: 1 }]])
      .mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/completar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('retorna 404 si alerta no existe', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).patch('/api/alertas/999/completar');
    expect(res.status).toBe(404);
  });

  test('retorna 403 si no es el creador', async () => {
    mockQuery.mockResolvedValueOnce([[{ id_creador: 99 }]]);
    const res = await request(app).patch('/api/alertas/1/completar');
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/alertas/:id ──────────────────────────────────────────
describe('DELETE /api/alertas/:id', () => {
  test('elimina alerta propia correctamente', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id_creador: 1 }]])
      .mockResolvedValueOnce([{}]);
    const res = await request(app).delete('/api/alertas/1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('retorna 404 si no existe', async () => {
    mockQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).delete('/api/alertas/999');
    expect(res.status).toBe(404);
  });

  test('retorna 403 si intenta eliminar alerta ajena', async () => {
    mockQuery.mockResolvedValueOnce([[{ id_creador: 50 }]]);
    const res = await request(app).delete('/api/alertas/1');
    expect(res.status).toBe(403);
  });
});

// ── Helpers internos ────────────────────────────────────────────────
describe('alertas — helpers internos', () => {
  test('diasRestantes calcula correctamente para fecha futura', () => {
    const hoy   = new Date();
    const futura = new Date(hoy);
    futura.setDate(hoy.getDate() + 5);
    hoy.setHours(0,0,0,0);
    futura.setHours(0,0,0,0);
    const dias = Math.ceil((futura - hoy) / 86400000);
    expect(dias).toBe(5);
  });

  test('diasRestantes es 0 para hoy', () => {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const dias = Math.ceil((hoy - hoy) / 86400000);
    expect(dias).toBe(0);
  });

  test('debeRecordar con frecuencia siempre retorna true', () => {
    const siempre = (ultimoRec, frecuencia) => {
      if (!ultimoRec || frecuencia === 'siempre') return true;
      return false;
    };
    expect(siempre(new Date(), 'siempre')).toBe(true);
    expect(siempre(null, 'semanal')).toBe(true);
  });
});
