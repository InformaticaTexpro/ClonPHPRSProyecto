'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    const area = String(req.headers['x-test-area'] || 'rrhh').toLowerCase();
    req.usuario = {
      sub: 1,
      id: 1,
      area,
      is_admin: area === 'admin' ? 1 : 0,
      nombre: area === 'rrhh' ? 'RRHH Test' : 'Usuario Test',
    };
    next();
  },
  requireRrhhOrAdmin: (req, res, next) => {
    if (req.usuario?.area === 'rrhh' || req.usuario?.is_admin) return next();
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  },
}));

const mockListarReportesCompartidos = jest.fn();
const mockObtenerReporteCompartidoPorId = jest.fn();
const mockActualizarEstadoReporteCompartido = jest.fn();
const mockObtenerRevisionVentasCompartidas = jest.fn();
const mockCrearNotificacion = jest.fn().mockResolvedValue(true);
const mockObtenerUsuariosRrhhYAdmin = jest.fn().mockResolvedValue([]);
const mockEmitToUser = jest.fn();

jest.mock('../../src/models/reporteCompartido', () => ({
  listarReportesCompartidos: (...args) => mockListarReportesCompartidos(...args),
  obtenerReporteCompartidoPorId: (...args) => mockObtenerReporteCompartidoPorId(...args),
  actualizarEstadoReporteCompartido: (...args) => mockActualizarEstadoReporteCompartido(...args),
  obtenerRevisionVentasCompartidas: (...args) => mockObtenerRevisionVentasCompartidas(...args),
}));

jest.mock('../../src/models/notificacion', () => ({
  crearNotificacion: (...args) => mockCrearNotificacion(...args),
  obtenerUsuariosRrhhYAdmin: (...args) => mockObtenerUsuariosRrhhYAdmin(...args),
}));

jest.mock('../../src/realtime/socketHub', () => ({
  emitToUser: (...args) => mockEmitToUser(...args),
}));

const rrhhRouter = require('../../src/routes/rrhh');

const app = express();
app.use(express.json());
app.use('/api/rrhh', rrhhRouter);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/rrhh/reportes-compartidos', () => {
  test('lista reportes compartidos con filtros', async () => {
    mockListarReportesCompartidos.mockResolvedValueOnce([
      {
        id: 10,
        vendedor_usuario_id: 2,
        vendedor_nombre: 'Claudia',
        vendedor_email: 'claudia@texpro.cl',
        anio: 2026,
        mes: 7,
        periodo_label: 'julio 2026',
        cantidad_folios: 1,
        total_venta: 123,
        total_venta_real: 123,
        total_descuento: 0,
        total_comision: 0,
        estado: 'confirmado_vendedor',
        confirmado_at: '2026-07-01 10:00:00',
        revisado_at: null,
        comentario_rrhh: null,
        motivo_rechazo: null,
        reporte_json: { folios_asignados: [] },
        folios_asignados: [],
        tiene_diferencias: false,
      },
    ]);

    const res = await request(app)
      .get('/api/rrhh/reportes-compartidos')
      .query({ anio: 2026, mes: 7, estado: 'todos' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.reportes).toHaveLength(1);
    expect(mockListarReportesCompartidos).toHaveBeenCalledWith({
      anio: 2026,
      mes: 7,
      estado: 'todos',
      vendedorNombre: undefined,
      vendedorUsuarioId: undefined,
      folio: undefined,
    });
  });
});

describe('acceso RRHH', () => {
  test('bloquea usuarios que no son RRHH ni admin', async () => {
    const res = await request(app)
      .get('/api/rrhh/confirmaciones')
      .set('x-test-area', 'ventas');

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('Acceso denegado');
  });
});

describe('GET /api/rrhh/reportes-compartidos/:id', () => {
  test('devuelve detalle del reporte con folios asignados', async () => {
    mockObtenerReporteCompartidoPorId.mockResolvedValueOnce({
      id: 10,
      vendedor_usuario_id: 2,
      vendedor_nombre: 'Claudia',
      vendedor_email: 'claudia@texpro.cl',
      anio: 2026,
      mes: 7,
      periodo_label: 'julio 2026',
      total_venta: 123,
      total_venta_real: 123,
      total_descuento: 0,
      total_comision: 0,
      cantidad_folios: 1,
      cantidad_lineas: 1,
      estado: 'confirmado_vendedor',
      confirmado_at: '2026-07-01 10:00:00',
      revisado_at: null,
      comentario_rrhh: null,
      motivo_rechazo: null,
      confirmado_por_nombre: 'Vendedor',
      revisado_por: null,
      reporte_json: {
        folios_asignados: [
          {
            folio: '1',
            cliente: 'Cliente Uno',
            vendedor_asignado: 'Ana',
            monto_asignado: 50000,
          },
        ],
      },
    });

    const res = await request(app).get('/api/rrhh/reportes-compartidos/10');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.cabecera.vendedor_nombre).toBe('Claudia');
    expect(res.body.folios_asignados).toHaveLength(1);
    expect(res.body.estado).toBe('confirmado_vendedor');
  });
});

describe('GET /api/rrhh/ventas-compartidas/revision', () => {
  test('devuelve la revisión consolidada', async () => {
    mockObtenerRevisionVentasCompartidas.mockResolvedValueOnce({
      periodo: { anio: 2026, mes: 7, label: 'Julio 2026' },
      codigos_compartidos: ['437', '630', '446', '447'],
      resumen: {
        folios_softland_compartidos: 1,
        folios_asignados: 1,
        folios_reportados: 1,
        folios_faltantes_asignacion: 0,
        folios_faltantes_reporte: 0,
        reportes_pendientes_rrhh: 1,
        reportes_validados: 0,
        reportes_rechazados: 0,
        diferencias_detectadas: 0,
      },
      folios_softland: [
        { folio: '1001', cliente: 'Cliente Uno', existe_softland: true },
      ],
      folios_asignados: [
        { folio: '1001', cliente: 'Cliente Uno', existe_asignacion: true },
      ],
      reportes_confirmados: [
        { id: 55, vendedor_nombre: 'Claudia', estado: 'confirmado_vendedor' },
      ],
      comparacion: [
        {
          folio: '1001',
          cliente: 'Cliente Uno',
          existe_softland: true,
          existe_asignacion: true,
          incluido_en_reporte: true,
          diferencias: [],
        },
      ],
    });

    const res = await request(app).get('/api/rrhh/ventas-compartidas/revision?anio=2026&mes=7');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.periodo.label).toBe('Julio 2026');
    expect(res.body.comparacion).toHaveLength(1);
    expect(res.body.codigos_compartidos).toEqual(['437', '630', '446', '447']);
    expect(mockObtenerRevisionVentasCompartidas).toHaveBeenCalledWith({
      anio: 2026,
      mes: 7,
      vendedorAsignadorId: null,
      vendedorAsignadoId: null,
      estado: null,
      folio: null,
      cliente: null,
      soloDiferencias: false,
    });
  });
});

describe('PATCH /api/rrhh/reportes-compartidos/:id/validar', () => {
  test('valida un reporte compartido', async () => {
    mockObtenerReporteCompartidoPorId.mockResolvedValueOnce({
      id: 10,
      vendedor_usuario_id: 2,
      mes: 7,
      anio: 2026,
      periodo_label: 'julio 2026',
      estado: 'confirmado_vendedor',
    });
    mockActualizarEstadoReporteCompartido.mockResolvedValueOnce(true);

    const res = await request(app)
      .patch('/api/rrhh/reportes-compartidos/10/validar')
      .send({ comentario_rrhh: 'OK' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockActualizarEstadoReporteCompartido).toHaveBeenCalledWith({
      id: 10,
      estado: 'validado_rrhh',
      comentarioRrhh: 'OK',
      revisadoPor: 1,
    });
    expect(mockCrearNotificacion).toHaveBeenCalledWith(expect.objectContaining({
      usuarioId: 2,
      tipo: 'reporte_compartido_validado',
    }));
    expect(mockEmitToUser).toHaveBeenCalledWith(2, 'notificacion:new', expect.objectContaining({
      notificacion: expect.objectContaining({
        tipo: 'reporte_compartido_validado',
      }),
    }));
  });

  test('no duplica una validacion ya procesada', async () => {
    mockObtenerReporteCompartidoPorId.mockResolvedValueOnce({
      id: 10,
      estado: 'validado_rrhh',
      vendedor_usuario_id: 2,
    });

    const res = await request(app)
      .patch('/api/rrhh/reportes-compartidos/10/validar')
      .send({ comentario_rrhh: 'OK' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REPORTE_YA_VALIDADO');
    expect(mockActualizarEstadoReporteCompartido).not.toHaveBeenCalled();
    expect(mockCrearNotificacion).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/rrhh/reportes-compartidos/:id/rechazar', () => {
  test('rechaza un reporte compartido con comentario y crea alerta', async () => {
    mockObtenerReporteCompartidoPorId.mockResolvedValueOnce({
      id: 10,
      vendedor_usuario_id: 2,
      mes: 7,
      anio: 2026,
      periodo_label: 'julio 2026',
      estado: 'confirmado_vendedor',
    });
    mockActualizarEstadoReporteCompartido.mockResolvedValueOnce(true);

    const res = await request(app)
      .patch('/api/rrhh/reportes-compartidos/10/rechazar')
      .send({ motivo_rechazo: 'Falta respaldo' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockActualizarEstadoReporteCompartido).toHaveBeenCalledWith({
      id: 10,
      estado: 'rechazado_rrhh',
      motivoRechazo: 'Falta respaldo',
      rechazadoPor: 1,
    });
    expect(mockCrearNotificacion).toHaveBeenCalledWith(expect.objectContaining({
      usuarioId: 2,
      tipo: 'reporte_compartido_rechazado',
    }));
    expect(mockEmitToUser).toHaveBeenCalledWith(2, 'notificacion:new', expect.objectContaining({
      notificacion: expect.objectContaining({
        tipo: 'reporte_compartido_rechazado',
      }),
    }));
  });

  test('rechaza sin motivo devuelve 400', async () => {
    const res = await request(app)
      .patch('/api/rrhh/reportes-compartidos/10/rechazar')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('no duplica un rechazo ya procesado', async () => {
    mockObtenerReporteCompartidoPorId.mockResolvedValueOnce({
      id: 10,
      vendedor_usuario_id: 2,
      estado: 'rechazado_rrhh',
    });

    const res = await request(app)
      .patch('/api/rrhh/reportes-compartidos/10/rechazar')
      .send({ motivo_rechazo: 'Falta respaldo' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REPORTE_YA_RECHAZADO');
    expect(mockActualizarEstadoReporteCompartido).not.toHaveBeenCalled();
    expect(mockCrearNotificacion).not.toHaveBeenCalled();
  });
});

