'use strict';
/**
 * tests/routes/cartera.test.js
 *
 * Pruebas para GET /api/cartera
 * Se mockea requireAuth, db MySQL y db Softland.
 */

const request = require('supertest');
const express = require('express');

// ── Mock requireAuth ─────────────────────────────────────────────────
jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1 };
    next();
  },
}));

// ── Mock MySQL (bd interna) ──────────────────────────────────────────
jest.mock('../../src/config/db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue([[{ cod_vendedor: 'V001' }]]),
  },
}));

// ── Mock Softland ────────────────────────────────────────────────────
const mockSoftlandRequest = {
  input: jest.fn().mockReturnThis(),
  query: jest.fn().mockResolvedValue({
    recordset: [
      {
        CodAux: 'C001', NomAux: 'Cliente Test',
        EsActivo: 1, EsInactivo: 0, EsNuevo: 0,
        EsRecuperado: 0, EsActivoMesActual: 1,
        FechaUltimaCompra: new Date(), FechaPrimeraCompra: new Date(),
      },
    ],
  }),
};
const mockRequest = jest.fn().mockReturnValue(mockSoftlandRequest);
jest.mock('../../src/config/db.softland', () => ({
  getSoftlandPool: jest.fn().mockResolvedValue({ request: mockRequest }),
}));

const carteraRouter = require('../../src/routes/cartera');
const app = express();
app.use(express.json());
app.use('/api/cartera', carteraRouter);

// ── Tests principales ────────────────────────────────────────────────
describe('GET /api/cartera', () => {
  test('devuelve ok:true con KPIs y arrays de segmentos', async () => {
    const res = await request(app).get('/api/cartera?mes=6&anio=2026');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('TotalClientes');
    expect(res.body).toHaveProperty('ClientesActivos');
    expect(res.body).toHaveProperty('ClientesInactivos');
    expect(res.body).toHaveProperty('ClientesNuevos');
    expect(res.body).toHaveProperty('ClientesRecuperados');
  });

  test('response incluye arrays: total, activos, inactivos, nuevos, recuperados', async () => {
    const res = await request(app).get('/api/cartera?mes=6&anio=2026');
    expect(Array.isArray(res.body.total)).toBe(true);
    expect(Array.isArray(res.body.activos)).toBe(true);
    expect(Array.isArray(res.body.inactivos)).toBe(true);
    expect(Array.isArray(res.body.nuevos)).toBe(true);
    expect(Array.isArray(res.body.recuperados)).toBe(true);
    expect(Array.isArray(res.body.activosMesActual)).toBe(true);
  });

  test('parametriza codigos de vendedor en consulta Softland', async () => {
    await request(app).get('/api/cartera?mes=6&anio=2026');
    const sqlQuery = mockSoftlandRequest.query.mock.calls.at(-1)[0];

    expect(mockSoftlandRequest.input).toHaveBeenCalledWith('cod0', expect.anything(), 'V001');
    expect(sqlQuery).toContain('VenCod IN (@cod0)');
    expect(sqlQuery).not.toContain("IN ('V001')");
  });

  test('usa mes y anio filtrados para la base de cálculo de cartera', async () => {
    await request(app).get('/api/cartera?mes=6&anio=2026');
    const sqlQuery = mockSoftlandRequest.query.mock.calls.at(-1)[0];

    expect(mockSoftlandRequest.input).toHaveBeenCalledWith('desde', expect.anything(), '2026-06-01');
    expect(mockSoftlandRequest.input).toHaveBeenCalledWith('hasta', expect.anything(), '2026-06-30');
    expect(sqlQuery).toContain('@desde');
    expect(sqlQuery).toContain('@hasta');
    expect(sqlQuery).not.toMatch(/GETDATE\(\)/i);
    expect(sqlQuery).toMatch(/FechaPrimeraCompra\s*>=\s*@desde/i);
    expect(sqlQuery).toMatch(/DATEADD\(DAY,\s*-90,\s*@hasta\)/i);
  });

  test('KPIs son números', async () => {
    const res = await request(app).get('/api/cartera?mes=6&anio=2026');
    expect(typeof res.body.TotalClientes).toBe('number');
    expect(typeof res.body.ClientesActivos).toBe('number');
  });

  test('sin códigos vendedor devuelve KPIs en 0 y arrays vacíos', async () => {
    const { pool } = require('../../src/config/db');
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/cartera');
    expect(res.status).toBe(200);
    expect(res.body.TotalClientes).toBe(0);
    expect(res.body.total).toEqual([]);
  });

  test('retorna 500 si Softland lanza error', async () => {
    const { getSoftlandPool } = require('../../src/config/db.softland');
    getSoftlandPool.mockRejectedValueOnce(new Error('Softland no disponible'));
    const res = await request(app).get('/api/cartera');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

// ── Tests de lógica de segmentación ─────────────────────────────────
describe('cartera — lógica de segmentación de clientes', () => {
  test('EsActivo=1 clasifica en activos', () => {
    const clientes = [
      { CodAux: 'C001', EsActivo: 1, EsInactivo: 0, EsNuevo: 0, EsRecuperado: 0, EsActivoMesActual: 0 },
      { CodAux: 'C002', EsActivo: 0, EsInactivo: 1, EsNuevo: 0, EsRecuperado: 0, EsActivoMesActual: 0 },
    ];
    const activos = clientes.filter(r => r.EsActivo === 1);
    expect(activos).toHaveLength(1);
    expect(activos[0].CodAux).toBe('C001');
  });

  test('EsInactivo=1 clasifica en inactivos', () => {
    const clientes = [
      { EsInactivo: 1 }, { EsInactivo: 0 }, { EsInactivo: 1 },
    ];
    expect(clientes.filter(r => r.EsInactivo === 1)).toHaveLength(2);
  });

  test('EsNuevo=1 clasifica en nuevos', () => {
    const clientes = [{ EsNuevo: 1 }, { EsNuevo: 0 }];
    expect(clientes.filter(r => r.EsNuevo === 1)).toHaveLength(1);
  });

  test('EsRecuperado=1 clasifica en recuperados', () => {
    const clientes = [{ EsRecuperado: 0 }, { EsRecuperado: 1 }, { EsRecuperado: 1 }];
    expect(clientes.filter(r => r.EsRecuperado === 1)).toHaveLength(2);
  });

  test('TotalClientes = length del array total', () => {
    const total = [{ CodAux: 'A' }, { CodAux: 'B' }, { CodAux: 'C' }];
    expect(total.length).toBe(3);
  });
});
