'use strict';
/**
 * tests/routes/alertas.test.js
 * Cobertura 100% de src/routes/alertas.js
 */

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

// ── Helper de fecha LOCAL (igual que debeRecordar en producción) ──────────────
// new Date('YYYY-MM-DD') se parsea como UTC medianoche, lo que puede dar
// un día distinto al local. Generamos siempre en hora local para que
// diff = Math.floor((hoy - ultimo) / 86400000) sea exactamente el esperado.
function localDateStr(offsetDays = 0) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ── Mock requireAuth ──────────────────────────────────────────────────────────
const USUARIO = { sub: 1, id: 1, nombre: 'Ana', is_admin: false };
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth:  (req, _res, next) => { req.usuario = { ...USUARIO }; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));

// ── Mock db pool ──────────────────────────────────────────────────────────────
const mockConnQuery     = jest.fn();
const mockCommit        = jest.fn().mockResolvedValue(undefined);
const mockRollback      = jest.fn().mockResolvedValue(undefined);
const mockRelease       = jest.fn();
const mockBeginTx       = jest.fn().mockResolvedValue(undefined);
const mockGetConnection = jest.fn().mockResolvedValue({
  query:            mockConnQuery,
  beginTransaction: mockBeginTx,
  commit:           mockCommit,
  rollback:         mockRollback,
  release:          mockRelease,
});
const mockPoolQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { query: mockPoolQuery, getConnection: mockGetConnection },
}));

const alertasRouter = require('../../src/routes/alertas');
const app = express();
app.use(express.json());
app.use('/api/alertas', alertasRouter);

// hoy en hora local — mismo criterio que el código de producción
const hoy = localDateStr(0);

beforeEach(() => {
  jest.clearAllMocks();
  mockCommit.mockResolvedValue(undefined);
  mockRollback.mockResolvedValue(undefined);
  mockBeginTx.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Helper diasRestantes — a través de GET /api/alertas
// ═══════════════════════════════════════════════════════════════════════════════
describe('Helper diasRestantes — a través de GET /api/alertas', () => {
  test('fecha futura retorna días positivos en la respuesta', async () => {
    mockPoolQuery.mockResolvedValueOnce([[
      { id: 1, titulo: 'T', descripcion: null, tipo: 'personal',
        fecha_vence: localDateStr(3),
        frecuencia_recordatorio: 'diaria', id_creador: 1, activa: 1, completada: 0,
        created_at: new Date(), nombre_creador: 'Ana', silenciada: 0, archivada: 1,
        descartada_hoy: null, destinatarios_nombres: null, destinatarios_ids: null },
    ]]);
    const res = await request(app).get('/api/alertas');
    expect(res.status).toBe(200);
    expect(res.body.data[0].dias_restantes).toBeGreaterThan(0);
    expect(res.body.data[0].archivada).toBe(1);
    const sql = mockPoolQuery.mock.calls[0][0];
    expect(sql).toMatch(/COALESCE\(ad\.archivada,\s*0\)\s+AS\s+archivada/i);
  });

  test('fecha pasada retorna días negativos', async () => {
    mockPoolQuery.mockResolvedValueOnce([[
      { id: 2, titulo: 'T', descripcion: null, tipo: 'personal',
        fecha_vence: localDateStr(-2),
        frecuencia_recordatorio: 'semanal', id_creador: 1, activa: 1, completada: 0,
        created_at: new Date(), nombre_creador: 'Ana', silenciada: 0,
        descartada_hoy: null, destinatarios_nombres: null, destinatarios_ids: null },
    ]]);
    const res = await request(app).get('/api/alertas');
    expect(res.body.data[0].dias_restantes).toBeLessThan(0);
  });

  test('destinatarios_ids null se convierte en array vacío', async () => {
    mockPoolQuery.mockResolvedValueOnce([[
      { id: 3, titulo: 'T', descripcion: null, tipo: 'personal',
        fecha_vence: localDateStr(1),
        frecuencia_recordatorio: 'siempre', id_creador: 1, activa: 1, completada: 0,
        created_at: new Date(), nombre_creador: 'Ana', silenciada: 0,
        descartada_hoy: null, destinatarios_nombres: null, destinatarios_ids: null },
    ]]);
    const res = await request(app).get('/api/alertas');
    expect(res.body.data[0].destinatarios_ids).toEqual([]);
  });

  test('destinatarios_ids con string se convierte en array de números', async () => {
    mockPoolQuery.mockResolvedValueOnce([[
      { id: 4, titulo: 'T', descripcion: null, tipo: 'personal',
        fecha_vence: localDateStr(1),
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
    const sql = mockPoolQuery.mock.calls[0][0];
    expect(sql).toMatch(/a\.fecha_vence\s*>=\s*CURDATE\(\)/i);
    expect(sql).toMatch(/COALESCE\(ad\.archivada,\s*0\)\s*=\s*0/i);
    expect(sql).toMatch(/DATEDIFF\(a\.fecha_vence,\s*CURDATE\(\)\)\s*<=\s*7/i);
    expect(sql).toMatch(/a\.frecuencia_recordatorio\s*=\s*'siempre'/i);
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
    const sql = mockPoolQuery.mock.calls[0][0];
    expect(sql).toMatch(/a\.fecha_vence\s*>=\s*CURDATE\(\)/i);
    expect(sql).toMatch(/COALESCE\(ad\.archivada,\s*0\)\s*=\s*0/i);
    expect(sql).toMatch(/a\.frecuencia_recordatorio\s*=\s*'siempre'/i);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('fail'));
    const res = await request(app).get('/api/alertas/badge');
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/alertas/pendientes — cubre debeRecordar todas las ramas
// ═══════════════════════════════════════════════════════════════════════════════
describe('GET /api/alertas/pendientes — cubre debeRecordar', () => {
  function makeAlerta(overrides = {}) {
    return {
      id: 1, titulo: 'T', descripcion: null, tipo: 'personal',
      fecha_vence: localDateStr(2),
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

  test('frecuencia siempre — vencimiento mayor a 7 días sigue incluida', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'siempre',
      fecha_vence: localDateStr(20),
      ultimo_recordatorio: null,
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
    const sql = mockPoolQuery.mock.calls[0][0];
    expect(sql).toMatch(/COALESCE\(ad\.archivada,\s*0\)\s*=\s*0/i);
    expect(sql).toMatch(/DATEDIFF\(a\.fecha_vence,\s*CURDATE\(\)\)\s*<=\s*7\s*OR\s*a\.frecuencia_recordatorio\s*=\s*'siempre'/i);
  });

  test('frecuencia diaria — sin último rec → incluida', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({ frecuencia_recordatorio: 'diaria', ultimo_recordatorio: null })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia diaria — último rec de hoy → excluida (diff=0 < 1)', async () => {
    // Usamos localDateStr(0) para garantizar que diff sea exactamente 0
    // sin importar el timezone del runner (local o CI/UTC)
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({ frecuencia_recordatorio: 'diaria', ultimo_recordatorio: localDateStr(0) })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(0);
  });

  test('frecuencia diaria — último rec de ayer → incluida (diff=1 >= 1)', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'diaria',
      ultimo_recordatorio: localDateStr(-1),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia semanal — último rec hace 3 días → excluida (diff=3 < 7)', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'semanal',
      ultimo_recordatorio: localDateStr(-3),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(0);
  });

  test('frecuencia semanal — último rec hace 7 días → incluida (diff=7 >= 7)', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'semanal',
      ultimo_recordatorio: localDateStr(-7),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(1);
  });

  test('frecuencia quincenal — último rec hace 10 días → excluida (diff=10 < 15)', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'quincenal',
      ultimo_recordatorio: localDateStr(-10),
    })]]);
    const res = await request(app).get('/api/alertas/pendientes');
    expect(res.body.data).toHaveLength(0);
  });

  test('frecuencia quincenal — último rec hace 15 días → incluida', async () => {
    mockPoolQuery.mockResolvedValueOnce([[makeAlerta({
      frecuencia_recordatorio: 'quincenal',
      ultimo_recordatorio: localDateStr(-15),
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
    titulo: 'Reunión mensual', tipo: 'personal',
    fecha_vence: '2026-07-30', frecuencia_recordatorio: 'semanal', destinatarios: [2],
  };

  test('crea alerta y retorna id', async () => {
    mockConnQuery
      .mockResolvedValueOnce([{ insertId: 42 }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
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
    const res = await request(app).post('/api/alertas').send({ titulo: 'T', tipo: 'grupal', fecha_vence: '2026-08-01' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(10);
  });

  test('destinatarios inválidos se filtran y no rompen el inserto', async () => {
    mockConnQuery
      .mockResolvedValueOnce([{ insertId: 11 }])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
    const res = await request(app).post('/api/alertas').send({
      titulo: 'T',
      tipo: 'grupal',
      fecha_vence: '2026-08-01',
      destinatarios: ['2', '', 'abc', null],
    });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(11);
    const inserts = mockConnQuery.mock.calls
      .filter(call => String(call[0]).includes('INSERT IGNORE INTO alerta_destinatarios'));
    expect(inserts).toHaveLength(2);
    expect(inserts.map(call => call[1][1]).sort()).toEqual([1, 2]);
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
      .mockResolvedValueOnce([[{ id_creador: 1 }]])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}])
      .mockResolvedValueOnce([{}]);
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
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 1 }]]).mockResolvedValueOnce([{}]);
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
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 1 }]]).mockResolvedValueOnce([{}]);
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
// ?? PATCH /:id/activar ????????????????????????????????????????????????????????
describe('PATCH /api/alertas/:id/activar', () => {
  test('due?o puede activar alerta desactivada', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 1, completada: 0 }]]).mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/activar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(/UPDATE alertas SET activa=1 WHERE id=\?/i);
  });

  test('admin puede activar alerta desactivada', async () => {
    const prev = USUARIO.is_admin;
    USUARIO.is_admin = 1;
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99, completada: 0 }]]).mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/activar');
    USUARIO.is_admin = prev;
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('otro usuario sin admin retorna 403', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99, completada: 0 }]]);
    const res = await request(app).patch('/api/alertas/1/activar');
    expect(res.status).toBe(403);
  });

  test('alerta inexistente retorna 404', async () => {
    mockPoolQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).patch('/api/alertas/999/activar');
    expect(res.status).toBe(404);
  });

  test('alerta completada retorna 400', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 1, completada: 1 }]]);
    const res = await request(app).patch('/api/alertas/1/activar');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no se puede activar una alerta completada/i);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).patch('/api/alertas/1/activar');
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/alertas/:id/archivar', () => {
  test('creador puede archivar alerta', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 1, es_destinatario: 1 }]]).mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/archivar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(/archivada\s*=\s*1/i);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(/fecha_archivada\s*=\s*NOW\(\)/i);
  });

  test('destinatario puede archivar alerta', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99, es_destinatario: 1 }]]).mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/archivar');
    expect(res.status).toBe(200);
  });

  test('usuario sin relación retorna 403', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99, es_destinatario: 0 }]]);
    const res = await request(app).patch('/api/alertas/1/archivar');
    expect(res.status).toBe(403);
  });

  test('alerta inexistente retorna 404', async () => {
    mockPoolQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).patch('/api/alertas/999/archivar');
    expect(res.status).toBe(404);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).patch('/api/alertas/1/archivar');
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/alertas/:id/desarchivar', () => {
  test('creador puede desarchivar alerta', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 1, es_destinatario: 1 }]]).mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/desarchivar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(/archivada\s*=\s*0/i);
    expect(mockPoolQuery.mock.calls[1][0]).toMatch(/fecha_archivada\s*=\s*NULL/i);
  });

  test('alerta inexistente retorna 404', async () => {
    mockPoolQuery.mockResolvedValueOnce([[]]);
    const res = await request(app).patch('/api/alertas/999/desarchivar');
    expect(res.status).toBe(404);
  });

  test('usuario sin relación retorna 403', async () => {
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 99, es_destinatario: 0 }]]);
    const res = await request(app).patch('/api/alertas/1/desarchivar');
    expect(res.status).toBe(403);
  });

  test('error retorna 500', async () => {
    mockPoolQuery.mockRejectedValueOnce(new Error('db'));
    const res = await request(app).patch('/api/alertas/1/desarchivar');
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/alertas/:id/descartar', () => {
  test('guarda fecha de hoy como descartada_hoy y ultimo_recordatorio', async () => {
    mockPoolQuery.mockResolvedValueOnce([{}]);
    const res = await request(app).patch('/api/alertas/1/descartar');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
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
    mockPoolQuery.mockResolvedValueOnce([[{ id_creador: 1 }]]).mockResolvedValueOnce([{}]);
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

describe('alertas.js — archivar visible', () => {
  test('expone acciones y filtro para archivadas', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/modulo/varios/alertas/alertas.js'),
      'utf8'
    );

    expect(
      fs.readFileSync(
        path.join(__dirname, '../../src/modulo/varios/alertas/index.html'),
        'utf8'
      )
    ).toContain('data-filtro="archivadas"');
    expect(source).toContain('btn-accion--archivar');
    expect(source).toContain('btn-accion--desarchivar');
    expect(source).toContain('data-accion="archivar"');
    expect(source).toContain('data-accion="desarchivar"');
    expect(source).toContain('archivar:');
    expect(source).toContain('desarchivar:');
    expect(source).toContain('alerta-card--archivada');
  });

  test('la campana global expone archivar', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/assets/js/indicadores-header.js'),
      'utf8'
    );

    expect(source).toContain('archivarAlertaPendienteGlobal');
    expect(source).toContain('data-accion="archivar"');
    expect(source).toContain('texpro-alerta-btn--primary');
  });
});
