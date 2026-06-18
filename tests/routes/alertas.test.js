'use strict';
/**
 * tests/routes/alertas.test.js
 * Cobertura 100% de src/routes/alertas.js
 *
 * Rutas cubiertas:
 *   GET  /api/alertas
 *   GET  /api/alertas/contador
 *   GET  /api/alertas/badge
 *   GET  /api/alertas/pendientes
 *   GET  /api/alertas/usuarios
 *   POST /api/alertas
 *   PUT  /api/alertas/:id
 *   PATCH /api/alertas/:id/completar
 *   PATCH /api/alertas/:id/desactivar
 *   PATCH /api/alertas/:id/descartar
 *   PATCH /api/alertas/:id/silenciar
 *   DELETE /api/alertas/:id
 *
 * Helpers puros cubiertos:
 *   diasRestantes
 *   debeRecordar  (todos los valores de frecuencia)
 */

const request = require('supertest');
const express = require('express');

// ── Mock requireAuth ──────────────────────────────────────────────────────────
const USUARIO = { sub: 1, id: 1, nombre: 'Ana', is_admin: false };
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => { req.usuario = { ...USUARIO }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));

// ── Mock db pool ──────────────────────────────────────────────────────────────
const mockConnQuery    = jest.fn();
const mockCommit       = jest.fn().mockResolvedValue(undefined);
const mockRollback     = jest.fn().mockResolvedValue(undefined);
const mockRelease      = jest.fn();
const mockBeginTx      = jest.fn().mockResolvedValue(undefined);
const mockGetConnection = jest.fn().mockResolvedValue({
  query:            mockConnQuery,
  beginTransaction: mockBeginTx,
  commit:           mockCommit,
  rollback:         mockRollback,
  release:          mockRelease,
});

const mockPoolQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: {
    query:         mockPoolQuery,
    getConnection: mockGetConnection,
  },
}));

const alertasRouter = require('../../src/routes/alertas');
const app = express();
app.use(express.json());
app.use('/api/alertas', alertasRouter);

const hoy = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  jest.clearAllMocks();
  mockCommit.mockResolvedValue(undefined);
  mockRollback.mockResolvedValue(undefined);
  mockBeginTx.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers puros: diasRestantes y debeRecordar
// ═══════════════════════════════════════════════════════════════════════════════

// Extraemos las funciones puras exportándolas temporalmente vía require.
// Como son funciones locales del módulo, las ejercemos a través de los endpoints.

describe('Helper diasRestantes — a través de GET /api/alertas', () => {
  test('fecha futura retorna días positivos en la respuesta', async () => {
    const manana = new Date();
    manana.setDate(manana.getDate() + 3);
    const fechaVence = manana.toISOString().slice(0, 10);

    mockPoolQuery.mockResolvedValueOnce([[
      { id: 1, titulo: 'T', descripcion: null, tipo: 'personal', fecha_vence: fechaVence,
        frecuencia_recordatorio: 'diaria', id_creador: 1, activa: 1, completada: 0,
        created_at: new Date(), nombre_creador: 'Ana', silenciada: 0,
        descartada_hoy: null, destinatarios_nombres: null, destinatarios_ids: null },
    ]]);
    const res = await request(app).get('/api/alertas');
    expect(res.status).toBe(200);
    expect(res.body.data[0].dias_restantes).toBeGreaterThan(0);
  });

  test('fecha pasada retorna días negativos', async () => {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 2);
    const fechaVence = ayer.toISOString().slice(0, 10);

    mockPoolQuery.mockResolvedValueOnce([[
      { id: 2, titulo: 'T', descripcion: null, tipo: 'personal', fecha_vence: fechaVence,
        frecuencia_recordatorio: 'semanal', id_creador: 1, activa: 1, completada: 0,
        created_at: new Date(), nombre_creador: 'Ana', silenciada: 0,
        descartada_hoy: null, destinatarios_nombres: null, destinatarios_ids: null },
    ]]);
    const res = await request(app).get('/api/alertas');
    expect(res.body.data[0].dias_restantes).toBeLessThan(0);
  });

  test('destinatarios_ids null se convierte en array vacío', async () => {
    const mañana = new Date();
    mañana.setDate(mañana.getDate() + 1);
    mockPoolQuery.mockResolvedValueOnce([[
      { id: 3, titulo: 'T', descripcion: null, tipo: 'personal',
        fecha_vence: mañana.toISOString().slice(0, 10),
        frecuencia_recordatorio: 'siempre', id_creador: 1, activa: 1, completada: 0,
        created_at: new Date(), nombre_creador: 'Ana', silenciada: 0,
        descartada_hoy: null, destinatarios_nombres: null, destinatarios_ids: null },
    ]]);
    const res = await request(app).get('/api/alertas');
    expect(res.body.data[0].destinatarios_ids).toEqual([]);
  });

  test('destinatarios_ids con string se convierte en array de números', async () => {
    const mañana = new Date();
    mañana.setDate(mañana.getDate() + 1);
    mockPoolQuery.mockResolvedValueOnce([[
      { id: 4, titulo: 'T', descripcion: null, tipo: 'personal',
        fecha_vence: mañana.toISOString().slice(0, 10),
        frecuencia_recordatorio: 'quincenal', id_creador: 1, activa: 1, completada: 0,
        created_at: new Date(), nombre_creador: 'Ana', silenciada: 0,
        descartada_hoy: null, destinatarios_nombres: null, destinatarios_ids: '1,2,3' },
    ]]);
    const res = await request(app).get('/api/alertas');
    expect(res.body.data[0].destinatarios_ids).toEqual([1, 2, 3]);
  });

  test('error en query retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).get('/api/alertas');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/alertas/contador
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/alertas/contador', () => {
  test('retorna total de alertas activas próximas', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ total: 3 }]]);
    const res = await request(app).get('/api/alertas/contador');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/alertas/contador');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/alertas/badge
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/alertas/badge', () => {
  test('alias de contador — retorna total', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ total: 5 }]]);
    const res = await request(app).get('/api/alertas/badge');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/alertas/badge');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/alertas/pendientes  — cubre debeRecordar todas las ramas
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/alertas/pendientes — cubre debeRecordar', () => {
  function makeAlerta(overrides = {}) {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return {
      id: 1, titulo: 'T', descripcion: null, tipo: 'personal',
      fecha_vence: d.toISOString().slice(0, 10),
      frecuencia_recordatorio: 'siempre',
      id_creador: 1, nombre_creador: 'Ana',
      silenciada: 0, descartada_hoy: null,
      ultimo_recordatorio: null,
      ...overrides,
    };
  }

  test('frecuencia siempre — sin último rec → incluida', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({ frecuencia_recordatorio: 'siempre', ultimo_recordatorio: null })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia siempre — con último rec de hoy → incluida (siempre = true)', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({ frecuencia_recordatorio: 'siempre', ultimo_recordatorio: hoy })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia diaria — sin último rec → incluida', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({ frecuencia_recordatorio: 'diaria', ultimo_recordatorio: null })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia diaria — último rec de hoy → excluida (diff=0 < 1)', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({ frecuencia_recordatorio: 'diaria', ultimo_recordatorio: hoy })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(0);
  });

  test('frecuencia diaria — último rec de ayer → incluida (diff=1 >= 1)', async () => {
    const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'diaria',
      ultimo_recordatorio: ayer.toISOString().slice(0, 10),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia semanal — último rec hace 3 días → excluida (diff=3 < 7)', async () => {
    const hace3 = new Date(); hace3.setDate(hace3.getDate() - 3);
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'semanal',
      ultimo_recordatorio: hace3.toISOString().slice(0, 10),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(0);
  });

  test('frecuencia semanal — último rec hace 7 días → incluida (diff=7 >= 7)', async () => {
    const hace7 = new Date(); hace7.setDate(hace7.getDate() - 7);
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'semanal',
      ultimo_recordatorio: hace7.toISOString().slice(0, 10),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia quincenal — último rec hace 10 días → excluida (diff=10 < 15)', async () => {
    const hace10 = new Date(); hace10.setDate(hace10.getDate() - 10);
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'quincenal',
      ultimo_recordatorio: hace10.toISOString().slice(0, 10),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(0);
  });

  test('frecuencia quincenal — último rec hace 15 días → incluida', async () => {
    const hace15 = new Date(); hace15.setDate(hace15.getDate() - 15);
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'quincenal',
      ultimo_recordatorio: hace15.toISOString().slice(0, 10),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia desconocida → incluida (rama default true)', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({ frecuencia_recordatorio: 'mensual', ultimo_recordatorio: hoy })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('error en query retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/alertas/usuarios
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/alertas/usuarios', () => {
  test('retorna lista de usuarios activos', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id: 1, nombre: 'Ana', area: 'Ventas' }]]);
    const res = await request(app).get('/api/alertas/usuarios');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).get('/api/alertas/usuarios');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/alertas
// ═══════════════════════════════════════════════════════════════════════════════
describe('POST /api/alertas', () => {
  const PAYLOAD_OK = {
    titulo: 'Reunión mensual',
    tipo: 'personal',
    fecha_vence: '2026-07-30',
    frecuencia_recordatorio: 'semanal',
    destinatarios: [2],
  };

  test('crea alerta y retorna id', async () => {
    mockConnQuery
      .mockResolvedValueOnce([{ insertId: 42 }])  // INSERT alertas
      .mockResolvedValueOnce([{}])                  // INSERT destinatario uid
      .mockResolvedValueOnce([{}]);                 // INSERT destinatario 2
    const res = await request(app).post('/api/alertas').send(PAYLOAD_OK);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toBe(42);
  });

  test('sin título retorna 400', async () => {
    const res = await request(app).post('/api/alertas').send({ tipo: 'personal', fecha_vence: '2026-07-01' });
    expect(res.status).toBe(400);
  });

  test('sin fecha_vence retorna 400', async () => {
    const res = await request(app).post('/api/alertas').send({ titulo: 'T', tipo: 'personal' });
    expect(res.status).toBe(400);
  });

  test('tipo inválido retorna 400', async () => {
    const res = await request(app).post('/api/alertas').send({ titulo: 'T', tipo: 'invalido', fecha_vence: '2026-07-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Tipo inv/i);
  });

  test('frecuencia inválida retorna 400', async () => {
    const res = await request(app).post('/api/alertas').send({
      titulo: 'T', tipo: 'personal', fecha_vence: '2026-07-01', frecuencia_recordatorio: 'bimestral',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Frecuencia inv/i);
  });

  test('sin destinatarios explícitos — sólo se inserta uid del creador', async () => {
    mockConnQuery
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([{}]);
    const res = await request(app).post('/api/alertas').send({
      titulo: 'T', tipo: 'grupal', fecha_vence: '2026-08-01',
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
  });

  test('error en INSERT hace rollback y retorna 500', async () => {
    mockConnQuery.mockRejectedValueOnce(new Error('insert fail'));
    const res = await request(app).post('/api/alertas').send(PAYLOAD_OK);
    expect(res.status).toBe(500);
    expect(mockRollback).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUT /api/alertas/:id
// ═══════════════════════════════════════════════════════════════════════════════
describe('PUT /api/alertas/:id', () => {
  const BODY = {
    titulo: 'Actualizada', tipo: 'personal',
    fecha_vence: '2026-09-01', frecuencia_recordatorio: 'diaria', destinatarios: [],
  };

  test('dueño puede editar su alerta', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[{ id_creador: 1 }]])  // SELECT
      .mockResolvedValueOnce([{}])                    // UPDATE
      .mockResolvedValueOnce([{}])                    // DELETE destinatarios
      .mockResolvedValueOnce([{}]);                   // INSERT destinatario
    const res = await request(app).put('/api/alertas/1').send(BODY);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('alerta inexistente retorna 404', async () => {
    mockConnQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).put('/api/alertas/999').send(BODY);
    expect(res.status).toBe(404);
  });

  test('otro usuario sin is_admin retorna 403', async () => {
    mockConnQuery.mockResolvedValueOnce([[{ id_creador: 99 }]]);
    const res = await request(app).put('/api/alertas/1').send(BODY);
    expect(res.status).toBe(403);
  });

  test('error en UPDATE hace rollback', async () => {
    mockConnQuery
      .mockResolvedValueOnce([[{ id_creador: 1 }]])
      .mockRejectedValueOnce(new Error('update fail'));
    const res = await request(app).put('/api/alertas/1').send(BODY);
    expect(res.status).toBe(500);
    expect(mockRollback).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /:id/completar
// ═══════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/alertas/:id/completar', () => {
  test('dueño puede completar su alerta', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ id_creador: 1 }]])
      .mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/completar');
    expect(res.status).toBe(200);
  });

  test('alerta inexistente retorna 404', async () => {
    mockPoolQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).patch('/api/alertas/999/completar');
    expect(res.status).toBe(404);
  });

  test('usuario sin permisos retorna 403', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99 }]]);
    const res = await request(app).patch('/api/alertas/1/completar');
    expect(res.status).toBe(403);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).patch('/api/alertas/1/completar');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /:id/desactivar
// ═══════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/alertas/:id/desactivar', () => {
  test('dueño puede desactivar', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ id_creador: 1 }]])
      .mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/desactivar');
    expect(res.status).toBe(200);
  });

  test('no encontrada retorna 404', async () => {
    mockPoolQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).patch('/api/alertas/999/desactivar');
    expect(res.status).toBe(404);
  });

  test('sin permisos retorna 403', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99 }]]);
    const res = await request(app).patch('/api/alertas/1/desactivar');
    expect(res.status).toBe(403);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).patch('/api/alertas/1/desactivar');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /:id/descartar
// ═══════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/alertas/:id/descartar', () => {
  test('guarda fecha de hoy como descartada_hoy y ultimo_recordatorio', async () => {
    mockPoolQuery.mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/descartar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Verifica que se pasó la fecha de hoy en el query
    const callArgs = mockPoolQuery.mock.calls[0];
    expect(callArgs[1]).toContain(hoy);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).patch('/api/alertas/1/descartar');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH /:id/silenciar
// ═══════════════════════════════════════════════════════════════════════════════
describe('PATCH /api/alertas/:id/silenciar', () => {
  test('silencia la alerta para el usuario', async () => {
    mockPoolQuery.mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/silenciar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).patch('/api/alertas/1/silenciar');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /api/alertas/:id
// ═══════════════════════════════════════════════════════════════════════════════
describe('DELETE /api/alertas/:id', () => {
  test('dueño puede eliminar', async () => {
    mockPoolQuery
      .mockResolvedValueOnce([[{ id_creador: 1 }]])
      .mockResolvedValueOnce([{}]);
    const res = await request(app).delete('/api/alertas/1');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('no encontrada retorna 404', async () => {
    mockPoolQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).delete('/api/alertas/999');
    expect(res.status).toBe(404);
  });

  test('otro usuario sin admin retorna 403', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99 }]]);
    const res = await request(app).delete('/api/alertas/1');
    expect(res.status).toBe(403);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).delete('/api/alertas/1');
    expect(res.status).toBe(500);
  });
});
