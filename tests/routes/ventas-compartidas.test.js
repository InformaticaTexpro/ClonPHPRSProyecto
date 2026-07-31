'use strict';

const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

const mockUsuario = {
  sub: 1,
  id: 1,
  nombre: 'Ana',
  email: 'ana@texpro.cl',
  is_admin: false,
  vendedores: [{ cod_vendedor: 'V001', tipo: 'P' }],
};

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = mockUsuario;
    next();
  },
}));

const mockDbQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { query: mockDbQuery },
  query: mockDbQuery,
}));

const mockCrearNotificacion = jest.fn().mockResolvedValue(true);
const mockObtenerUsuariosRrhhYAdmin = jest.fn().mockResolvedValue([]);
const mockEmitToUser = jest.fn();

jest.mock('../../src/config/db.softland', () => ({
  getSoftlandPool: jest.fn(),
}));

jest.mock('../../src/utils/precioHistorico', () => ({
  buildPrecioListaRealCASE: jest.fn(),
}));

jest.mock('../../src/models/confirmacion', () => ({
  existeConfirmacion: jest.fn(),
  crearConfirmacion: jest.fn(),
  obtenerConfirmacionPorId: jest.fn(),
  obtenerConfirmacionUsuario: jest.fn(),
}));

const mockObtenerReporteCompartidoUsuarioPeriodo = jest.fn();
const mockGuardarReporteCompartidoConfirmado = jest.fn();

jest.mock('../../src/models/reporteCompartido', () => ({
  guardarReporteCompartidoConfirmado: (...args) => mockGuardarReporteCompartidoConfirmado(...args),
  obtenerReporteCompartidoUsuarioPeriodo: (...args) => mockObtenerReporteCompartidoUsuarioPeriodo(...args),
}));

jest.mock('../../src/utils/pdfConfirmacion', () => ({
  generarPdfConfirmacion: jest.fn(),
}));

jest.mock('../../src/models/notificacion', () => ({
  crearNotificacion: (...args) => mockCrearNotificacion(...args),
  obtenerUsuariosRrhhYAdmin: (...args) => mockObtenerUsuariosRrhhYAdmin(...args),
}));

jest.mock('../../src/realtime/socketHub', () => ({
  emitToUser: (...args) => mockEmitToUser(...args),
}));

const ventasRouter = require('../../src/routes/ventas');

const app = express();
app.use(express.json());
app.use('/api/ventas', ventasRouter);

beforeEach(() => {
  jest.clearAllMocks();
  mockUsuario.vendedores = [{ cod_vendedor: 'V001', tipo: 'P' }];
});

describe('GET /api/ventas/compartidas/confirmacion', () => {
  test('devuelve el estado del reporte compartido', async () => {
    mockObtenerReporteCompartidoUsuarioPeriodo.mockResolvedValueOnce({
      id: 7,
      estado: 'rechazado_rrhh',
      confirmado_at: '2026-07-01 10:00:00',
      revisado_at: '2026-07-02 10:00:00',
      motivo_rechazo: 'Falta respaldo',
      comentario_rrhh: null,
      periodo_label: 'julio 2026',
    });

    const res = await request(app).get('/api/ventas/compartidas/confirmacion?mes=7&anio=2026');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.existe).toBe(true);
    expect(res.body.estado).toBe('rechazado_rrhh');
    expect(res.body.motivo_rechazo).toBe('Falta respaldo');
  });
});

describe('POST /api/ventas/compartidas/confirmar', () => {
  test('guarda snapshot cuando hay ventas compartidas', async () => {
    mockObtenerReporteCompartidoUsuarioPeriodo.mockResolvedValueOnce(null);
    mockDbQuery.mockResolvedValueOnce([[
      {
        id: 11,
        folio: 1001,
        fecha: '2026-07-01',
        mes: 7,
        anio: 2026,
        cliente: 'Cliente Uno',
        monto_neto: 100000,
        monto_asignado: 50000,
        porcentaje: 50,
        cod_vendedor_principal: 'V000',
        cod_vendedor_compartido: 'V001',
        nombre_vendedor_compartido: 'Ana',
        rol: 'compartido',
      },
    ]]);
    mockGuardarReporteCompartidoConfirmado.mockResolvedValueOnce({
      id: 55,
      snapshot: {
        tipo: 'folios_asignados',
        folios_asignados: [
          {
            folio: '1001',
            fecha: '01/07/2026',
            cliente: 'Cliente Uno',
            vendedor_asignado: 'Ana',
            porcentaje_participacion: 50,
            monto_asignado: 50000,
          },
        ],
        resumen: {
          total_venta: 50000,
          total_venta_real: 50000,
          total_descuento: 0,
          total_comision: 50000,
          cantidad_folios: 1,
          cantidad_lineas: 1,
        },
        periodo: { anio: 2026, mes: 7, label: 'julio 2026' },
      },
    });
    mockObtenerUsuariosRrhhYAdmin.mockResolvedValueOnce([3, 3, 4]);

    const res = await request(app)
      .post('/api/ventas/compartidas/confirmar')
      .send({ mes: 7, anio: 2026 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.estado).toBe('confirmado_vendedor');
    expect(res.body.id).toBe(55);
    const payload = mockGuardarReporteCompartidoConfirmado.mock.calls[0][0];
    expect(payload.vendedorUsuarioId).toBe(1);
    expect(payload.vendedorNombre).toBe('Ana');
    expect(payload.anio).toBe(2026);
    expect(payload.mes).toBe(7);
    expect(payload.confirmadoPor).toBe(1);
    expect(payload.reporteJson.tipo).toBe('folios_asignados');
    expect(payload.reporteJson.folios_asignados).toHaveLength(1);
    expect(mockCrearNotificacion).toHaveBeenCalledTimes(2);
    expect(mockEmitToUser).toHaveBeenCalledTimes(2);
    expect(mockEmitToUser).toHaveBeenCalledWith(3, 'notificacion:new', expect.objectContaining({
      notificacion: expect.objectContaining({
        tipo: 'reporte_compartido_enviado',
      }),
    }));
    expect(mockEmitToUser).toHaveBeenCalledWith(4, 'notificacion:new', expect.objectContaining({
      notificacion: expect.objectContaining({
        tipo: 'reporte_compartido_enviado',
      }),
    }));
  });

  test('devuelve REPORTE_SIN_DATOS cuando no hay filas', async () => {
    mockObtenerReporteCompartidoUsuarioPeriodo.mockResolvedValueOnce(null);
    mockDbQuery.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .post('/api/ventas/compartidas/confirmar')
      .send({ mes: 7, anio: 2026 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REPORTE_SIN_DATOS');
  });

  test('bloquea una confirmación ya validada', async () => {
    mockObtenerReporteCompartidoUsuarioPeriodo.mockResolvedValueOnce({
      id: 7,
      estado: 'validado_rrhh',
    });

    const res = await request(app)
      .post('/api/ventas/compartidas/confirmar')
      .send({ mes: 7, anio: 2026 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REPORTE_YA_VALIDADO');
  });
});

describe('ventas.js â€” ruta de confirmaciÃ³n', () => {
  test('usa /api/ventas/compartidas/confirmar y no /api/dashboard/compartidas/confirmar', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../src/modulo/ventas/ventas/ventas.js'),
      'utf8'
    );

    expect(source).toContain("fetch('/api/ventas/compartidas/confirmar'");
    expect(source).not.toContain('/api/dashboard/compartidas/confirmar');
  });
});
