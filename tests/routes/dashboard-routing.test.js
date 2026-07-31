'use strict';

/**
 * tests/routes/dashboard-routing.test.js
 *
 * Congela el orden real de montaje de /api/dashboard.
 * No prueba la lógica de negocio de cada handler; solo documenta qué router
 * gana hoy cuando existen endpoints duplicados.
 */

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

const mockQuery = jest.fn();
const mockSoftlandRequest = {
  input: jest.fn().mockReturnThis(),
  query: jest.fn(),
};

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = {
      sub: 1,
      id: 1,
      nombre: 'Ana',
      is_admin: false,
      vendedores: [{ cod_vendedor: 'C001', tipo: 'c' }],
    };
    next();
  },
  requireAdmin: (_req, _res, next) => next(),
}));

jest.mock('../../src/config/db', () => ({
  pool: { query: mockQuery },
  query: mockQuery,
}));

jest.mock('../../src/config/db.softland', () => ({
  getSoftlandPool: jest.fn().mockResolvedValue({
    connected: true,
    request: jest.fn(() => mockSoftlandRequest),
  }),
}));

jest.mock('../../src/utils/precioHistorico', () => ({
  getFactorHistorico: jest.fn().mockResolvedValue(1),
  buildPrecioListaRealCASE: jest.fn().mockResolvedValue('t.PrecioVta'),
}));

jest.mock('../../src/models/notificacion', () => ({
  notificarMetaSuperada: jest.fn().mockResolvedValue(),
  notificarMetaCumplida: jest.fn().mockResolvedValue(),
  usuarioIdDesdeCodVendedor: jest.fn().mockResolvedValue(null),
  notificarFolioRecibido: jest.fn().mockResolvedValue(),
  notificarFolioAsignado: jest.fn().mockResolvedValue(),
}));

const dashboardAjustesRoutes = require('../../src/routes/dashboard.ajustes');
const dashboardPanelRoutes = require('../../src/routes/dashboard.panel');
const dashboardRoutes = require('../../src/routes/dashboard');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/dashboard', dashboardAjustesRoutes);
  app.use('/api/dashboard', dashboardPanelRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue([[]]);
  mockSoftlandRequest.query.mockResolvedValue({ recordset: [] });
});

describe('Routing precedence for /api/dashboard', () => {
  test('GET /resumen responde desde dashboard.ajustes.js', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/dashboard/resumen?mes=6&anio=2026');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sql = mockSoftlandRequest.query.mock.calls[0][0];
    expect(sql).toContain('AS totalLista');
    expect(sql).not.toContain('WITH FoliosCompartidos AS');
  });

  test('GET /evolucion responde desde dashboard.ajustes.js', async () => {
    mockQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[
        {
          id: 1,
          folio: 1001,
          porcentaje: 50,
          cod_vendedor_principal: 'C001',
          cod_vendedor_compartido: 'V002',
          mes: 6,
          anio: 2026,
        },
      ]]);
    mockSoftlandRequest.query.mockImplementation(async (sql) => {
      if (sql.includes('MIN(h.Fecha) AS Fecha')) {
        return {
          recordset: [
            {
              Folio: 1001,
              Fecha: new Date('2026-06-01T00:00:00.000Z'),
              mes: 6,
              anio: 2026,
              CodVendedor: 'C001',
              Tipo: 'F',
              cliente: 'Cliente 1',
              monto: 1000,
              TotLineaReal: 1200,
            },
          ],
        };
      }
      return { recordset: [] };
    });

    const app = buildApp();
    const res = await request(app).get('/api/dashboard/evolucion?anio=2026');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sqlCalls = mockSoftlandRequest.query.mock.calls.map(([sql]) => sql);
    expect(sqlCalls.some((sql) => sql.includes('MIN(h.Fecha) AS Fecha'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('WITH FoliosCompartidos AS'))).toBe(false);
  });

  test('GET /ventas-mes responde desde dashboard.ajustes.js', async () => {
    const app = buildApp();

    const res = await request(app).get('/api/dashboard/ventas-mes?mes=6&anio=2026');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const sql = mockSoftlandRequest.query.mock.calls[0][0];
    expect(sql).toContain('MIN(c.NomAux) AS cliente');
    expect(sql).not.toContain('neto_lista');
  });

  test('GET /asignados responde desde dashboard.panel.js', async () => {
    mockQuery.mockResolvedValueOnce([[
      {
        id: 1,
        folio: 1001,
        fecha: '2026-06-01',
        cliente: 'Cliente 1',
        monto_neto: 1000,
        monto_asignado: 500,
        porcentaje: 50,
        cod_vendedor_principal: 'C001',
        cod_vendedor_compartido: 'V002',
        nombre_vendedor_compartido: 'Vendedor 2',
        mes: 6,
        anio: 2026,
      },
    ]]);

    const app = buildApp();

    const res = await request(app).get('/api/dashboard/asignados?mes=6&anio=2026');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.asignados).toHaveLength(1);

    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toContain('MONTH(fc.fecha) = ?');
    expect(sql).toContain('ORDER BY fc.fecha DESC, fc.folio DESC');
    expect(sql).not.toContain('fc.mes = ? AND fc.anio = ?');
  });
});

describe('ventas.js â€” estado del botÃ³n de confirmaciÃ³n', () => {
  test('actualiza el botÃ³n usando la misma lista que renderiza Folios Asignados', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/modulo/ventas/ventas/ventas.js'),
      'utf8'
    );

    expect(source).toContain('await cargarEstadoReporteCompartido(_ultimosAsignados);');
    expect(source).toContain("setEstadoReporteCompartido(`Listo para enviar a RRHH · ${formatCLP(resumen.total_venta_real)} total asignado`, 'ready');");
    expect(source).not.toContain("if (btnConfirmar) btnConfirmar.disabled = !_ultimosAsignados.length;");
  });
});
