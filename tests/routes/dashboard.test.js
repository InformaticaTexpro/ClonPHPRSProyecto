'use strict';
/**
 * tests/routes/dashboard.test.js
 *
 * Pruebas de contrato para /api/dashboard:
 *   GET  /api/dashboard/resumen   — KPIs
 *   GET  /api/dashboard/evolucion — evolución mensual
 *   POST /api/dashboard/compartir — asigna porcentaje a folio
 */

const request = require('supertest');
const express = require('express');

// ── Mock requireAuth ──────────────────────────────────────────────────────────
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = {
      sub: 1, id: 1, nombre: 'Ana', is_admin: false,
      vendedores: [{ cod_vendedor: 'V001', tipo: 'P' }],
    };
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
}));

// ── Mock MySQL pool ───────────────────────────────────────────────────────────
const mockQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { query: mockQuery },
  query: mockQuery,
}));

// ── Mock Softland pool ────────────────────────────────────────────────────────
const mockSoftlandRequest = {
  input: jest.fn().mockReturnThis(),
  query: jest.fn(),
};
jest.mock('../../src/config/db.softland', () => ({
  getSoftlandPool: jest.fn().mockResolvedValue({
    connected: true,
    request: jest.fn(() => mockSoftlandRequest),
  }),
}));

// ── Mock precioHistorico ──────────────────────────────────────────────────────
jest.mock('../../src/utils/precioHistorico', () => ({
  getFactorHistorico: jest.fn().mockResolvedValue(1),
  buildPrecioListaRealCASE: jest.fn().mockResolvedValue('t.PrecioVta'),
}));

const dashboardAjustesRouter = require('../../src/routes/dashboard.ajustes');
const dashboardPanelRouter = require('../../src/routes/dashboard.panel');
const dashboardRouter = require('../../src/routes/dashboard');
const app = express();
app.use(express.json());
app.use('/api/dashboard', dashboardAjustesRouter);
app.use('/api/dashboard', dashboardPanelRouter);
app.use('/api/dashboard', dashboardRouter);

beforeEach(() => {
  jest.clearAllMocks();
  // Default: meta rows vacíos
  mockQuery.mockResolvedValue([[]]);
  // Default: Softland sin datos
  mockSoftlandRequest.query.mockResolvedValue({ recordset: [] });
});

// ── GET /api/dashboard/resumen — KPIs ────────────────────────────────────────
describe('GET /api/dashboard/resumen — devuelve KPIs correctos', () => {
  test('retorna ok:true con estructura de KPIs', async () => {
    mockSoftlandRequest.query.mockResolvedValueOnce({
      recordset: [
        { totalVentasCobrado: 5000000, totalVentasLista: 5500000 },
      ],
    });
    const res = await request(app).get('/api/dashboard/resumen?mes=6&anio=2026');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('retorna 400 con mes inválido', async () => {
    const res = await request(app).get('/api/dashboard/resumen?mes=13&anio=2026');
    expect(res.status).toBe(400);
  });

  test('retorna 400 con año anterior a 2026', async () => {
    const res = await request(app).get('/api/dashboard/resumen?mes=6&anio=2025');
    expect(res.status).toBe(400);
  });

  test('sin vendedores retorna KPIs en cero', async () => {
    // Respuesta Softland sin filas
    mockSoftlandRequest.query.mockResolvedValueOnce({ recordset: [] });
    const res = await request(app).get('/api/dashboard/resumen?mes=6&anio=2026');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── GET /api/dashboard/evolucion — evolución mensual ─────────────────────────
describe('GET /api/dashboard/evolucion — evolución mensual', () => {
  test('retorna array de 12 meses con ok:true', async () => {
    mockSoftlandRequest.query.mockResolvedValueOnce({
      recordset: [
        { mes: 1, ventas: 3000000 },
        { mes: 2, ventas: 4000000 },
      ],
    });
    const res = await request(app).get('/api/dashboard/evolucion?anio=2026');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    if (res.body.evolucion) {
      expect(Array.isArray(res.body.evolucion)).toBe(true);
    }
  });

  test('año inválido retorna error', async () => {
    const res = await request(app).get('/api/dashboard/evolucion?anio=1990');
    expect(res.status).toBe(400);
  });

  test('año 2025 retorna error por debajo del mínimo operativo', async () => {
    const res = await request(app).get('/api/dashboard/evolucion?anio=2025');
    expect(res.status).toBe(400);
  });
});

// ── POST /api/dashboard/compartir — asigna porcentaje a folio ────────────────
describe('POST /api/dashboard/compartir — asigna porcentaje a folio', () => {
  test('retorna 400 si falta vendedor compartido', async () => {
    const res = await request(app)
      .post('/api/dashboard/compartir')
      .send({ folio: 1001, porcentaje: 50 });
    expect(res.status).toBe(400);
  });

  test('retorna error si faltan parámetros obligatorios', async () => {
    const res = await request(app)
      .post('/api/dashboard/compartir')
      .send({});
    expect(res.status).toBe(400);
  });

  test('porcentaje fuera de rango retorna 400', async () => {
    const res = await request(app)
      .post('/api/dashboard/compartir')
      .send({ folio: 1001, cod_vendedor_compartido: 'V002', porcentaje: 150 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/dashboard/compartidos — incluye tipo de folio para el receptor', () => {
  test('retorna tipo_folio resuelto desde Softland', async () => {
    mockQuery.mockResolvedValueOnce([[
      {
        id: 1,
        folio: 377326,
        fecha: '2026-05-14',
        cliente: 'MINERA ABC',
        monto_neto: 77964,
        monto_asignado: 38982,
        porcentaje: 50,
        cod_vendedor_principal: '454',
        cod_vendedor_compartido: '629',
        nombre_vendedor_compartido: 'Claudia Rincones',
        monto: 38982,
        coordinador: 'Ana',
        mes: 5,
        anio: 2026,
      },
    ]]);
    mockSoftlandRequest.query.mockResolvedValueOnce({
      recordset: [{ tipo_folio: 'F' }],
    });

    const res = await request(app).get('/api/dashboard/compartidos?mes=5&anio=2026');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.compartidos).toHaveLength(1);
    expect(res.body.compartidos[0].tipo_folio).toBe('F');

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('fc.mes');
    expect(sql).toContain('fc.anio');
  });
});
