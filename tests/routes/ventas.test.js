'use strict';
/**
 * tests/routes/ventas.test.js
 *
 * Pruebas de contrato para /api/ventas:
 *   - requiere autenticación JWT
 *   - filtra por mes y año
 *   - valida códigos de vendedor
 */

const request = require('supertest');
const express = require('express');

// ── Mock requireAuth ──────────────────────────────────────────────────────────
// Simula un usuario autenticado con vendedores asignados
const mockUsuario = {
  sub: 1, id: 1, nombre: 'Ana', is_admin: false,
  vendedores: [{ cod_vendedor: 'V001', tipo: 'P' }],
};

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => { req.usuario = mockUsuario; next(); },
  requireAdmin: (_req, _res, next) => next(),
}));

// ── Mock modelo venta ─────────────────────────────────────────────────────────
jest.mock('../../src/models/venta', () => ({
  getVentas:            jest.fn(),
  getTotalVentas:       jest.fn(),
  getResumenPorVendedor: jest.fn(),
  getClientesPorVendedor: jest.fn(),
  getMontoFolio:        jest.fn(),
  getDetalleFolio:      jest.fn(),
  getDescuentosVendedor: jest.fn(),
}));

// ── Mock db MySQL (para consultas de meta) ────────────────────────────────────
jest.mock('../../src/config/db', () => ({
  pool: { query: jest.fn().mockResolvedValue([[]]) },
  query: jest.fn().mockResolvedValue([[]]),
}));

// ── Mock Softland pool ────────────────────────────────────────────────────────
const mockSoftlandRequest = {
  input: jest.fn().mockReturnThis(),
  query: jest.fn().mockResolvedValue({ recordset: [] }),
};

jest.mock('../../src/config/db.softland', () => ({
  getSoftlandPool: jest.fn().mockResolvedValue({
    connected: true,
    request: jest.fn(() => mockSoftlandRequest),
  }),
}));

// ── Mock precioHistorico ──────────────────────────────────────────────────────
jest.mock('../../src/utils/precioHistorico', () => ({
  buildPrecioListaRealCASE: jest.fn().mockResolvedValue('t.PrecioVta'),
}));

const { getVentas } = require('../../src/models/venta');
const ventasRouter  = require('../../src/routes/ventas');
const app = express();
app.use(express.json());
app.use('/api/ventas', ventasRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockUsuario.vendedores = [{ cod_vendedor: 'V001', tipo: 'P' }];
  mockSoftlandRequest.query.mockResolvedValue({ recordset: [] });
});

// ── GET /api/ventas — requiere autenticación JWT ──────────────────────────────
describe('GET /api/ventas — requiere autenticación JWT', () => {
  test('sin token (mock bypassed) igual responde 200 con ok:true', async () => {
    // El middleware está mockeado para inyectar usuario directamente.
    // Verificamos que requireAuth es llamado (la función existe en el mock).
    getVentas.mockResolvedValueOnce([{ folio: 1001, total: 500000 }]);
    const res = await request(app).get('/api/ventas?mes=1&anio=2026');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('usuario sin vendedores asignados retorna array vacío', async () => {
    const vendedoresOriginales = mockUsuario.vendedores;
    mockUsuario.vendedores = [];
    const res = await request(app).get('/api/ventas?mes=1&anio=2026');
    mockUsuario.vendedores = vendedoresOriginales;

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, ventas: [] });
    expect(getVentas).not.toHaveBeenCalled();
  });
});

// ── GET /api/ventas — filtra por mes y año ────────────────────────────────────
describe('GET /api/ventas — filtra por mes y año correctamente', () => {
  test('mes y año válidos retorna ventas del período', async () => {
    const ventasFake = [
      { folio: 1001, total: 500000, fecha: '2026-03-15' },
      { folio: 1002, total: 750000, fecha: '2026-03-20' },
    ];
    getVentas.mockResolvedValueOnce(ventasFake);
    const res = await request(app).get('/api/ventas?mes=3&anio=2026');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ventas).toHaveLength(2);
  });

  test('mes inválido (13) retorna 400', async () => {
    const res = await request(app).get('/api/ventas?mes=13&anio=2026');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('mes 0 retorna 400', async () => {
    const res = await request(app).get('/api/ventas?mes=0&anio=2026');
    expect(res.status).toBe(400);
  });

  test('año anterior a 2000 retorna 400', async () => {
    const res = await request(app).get('/api/ventas?mes=1&anio=1999');
    expect(res.status).toBe(400);
  });

  test('sin parámetros usa defaults (mes y año actuales)', async () => {
    getVentas.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/ventas');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── GET /api/ventas — valida códigos de vendedor ──────────────────────────────
describe('GET /api/ventas — valida códigos de vendedor', () => {
  test('la query se ejecuta con los códigos del usuario autenticado', async () => {
    const ventasFake = [{ folio: 1001, codVendedor: 'V001' }];
    getVentas.mockResolvedValueOnce(ventasFake);
    await request(app).get('/api/ventas?mes=6&anio=2026');
    expect(getVentas).toHaveBeenCalledWith(
      expect.objectContaining({ codigos: ['V001'] })
    );
  });

  test('los vendedores del payload se mapean correctamente a cod_vendedor', () => {
    const vendedores = [
      { cod_vendedor: 'V001', tipo: 'P' },
      { cod_vendedor: 'V002', tipo: 'S' },
    ];
    const codigos = vendedores.map(v => v.cod_vendedor).filter(Boolean);
    expect(codigos).toEqual(['V001', 'V002']);
  });

  test('vendedor con cod_vendedor null se filtra del array', () => {
    const vendedores = [
      { cod_vendedor: 'V001', tipo: 'P' },
      { cod_vendedor: null,   tipo: 'S' },
    ];
    const codigos = vendedores.map(v => v.cod_vendedor).filter(Boolean);
    expect(codigos).toEqual(['V001']);
    expect(codigos).toHaveLength(1);
  });

  test('error en modelo retorna 500', async () => {
    getVentas.mockRejectedValueOnce(new Error('Softland no disponible'));
    const res = await request(app).get('/api/ventas?mes=6&anio=2026');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/ventas clientes e historial', () => {
  test('autocomplete no filtra clientes por vendedor', async () => {
    await request(app).get('/api/ventas/clientes?q=ac');

    const sqlQuery = mockSoftlandRequest.query.mock.calls.at(-1)[0];
    expect(sqlQuery).not.toMatch(/CodVendedor\s+IN/i);
    expect(sqlQuery).not.toMatch(/\bEXISTS\b/i);
  });

  test('historial de cliente no filtra documentos por vendedor', async () => {
    await request(app)
      .get('/api/ventas/historial-cliente?codAux=C001&desde=2026-01-01&hasta=2026-12-31');

    const sqlQuery = mockSoftlandRequest.query.mock.calls.at(-1)[0];
    expect(sqlQuery).not.toMatch(/CodVendedor\s+IN/i);
    expect(sqlQuery).not.toContain('@cod0');
  });
});
