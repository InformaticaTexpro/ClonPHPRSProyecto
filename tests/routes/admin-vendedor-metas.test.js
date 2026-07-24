'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, id: 1, is_admin: true, nombre: 'Admin Test' };
    next();
  },
}));

const mockGetConnection = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { getConnection: mockGetConnection },
}));

const mockModel = {
  listarMetasVendedor: jest.fn(),
  obtenerMetaPorId: jest.fn(),
  guardarMetaVendedor: jest.fn(),
  actualizarEstadoMetaVendedor: jest.fn(),
  normalizeTipoPeriodo: jest.fn(value => (String(value || '').toLowerCase() === 'anual' ? 'anual' : 'mensual')),
};
jest.mock('../../src/models/vendedorMeta', () => mockModel);

const adminRouter = require('../../src/routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

let mockConnection;

function resetConnection() {
  mockConnection = {
    query: jest.fn(async sql => {
      const normalized = String(sql).replace(/\s+/g, ' ').trim();
      if (normalized.includes('FROM usuario u') && normalized.includes('SELECT')) {
        return [[{
          id: 7,
          nombre: 'Claudia Rincones',
          email: 'crincones@texpro.cl',
          codigo: '629',
          area: 'ventas',
          is_admin: 0,
          is_active: 1,
          last_login: null,
          created_at: '2026-07-01 10:00:00',
        }]];
      }
      if (normalized.includes('FROM usuario_vendedor')) return [[]];
      if (normalized.includes('FROM usuario_menu')) return [[]];
      if (normalized.includes('FROM usuario_perfil')) return [[]];
      return [[]];
    }),
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(),
  };
  mockGetConnection.mockResolvedValue(mockConnection);
}

describe('admin vendedor metas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetConnection();
  });

  test('GET /api/admin/vendedor-metas retorna listado', async () => {
    mockModel.listarMetasVendedor.mockResolvedValueOnce([
      {
        id: 1,
        usuario_id: 7,
        usuario_nombre: 'Claudia Rincones',
        usuario_email: 'crincones@texpro.cl',
        usuario_area: 'ventas',
        fecha: '2026-07-01',
        tipo_periodo: 'mensual',
        meta_original: 650000,
        meta_mes: 650000,
        activo: true,
        observacion: 'Julio',
      },
    ]);

    const res = await request(app).get('/api/admin/vendedor-metas');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(mockModel.listarMetasVendedor).toHaveBeenCalled();
  });

  test('POST /api/admin/vendedor-metas crea una meta', async () => {
    mockModel.guardarMetaVendedor.mockResolvedValueOnce({
      id: 2,
      usuario_id: 7,
      fecha: '2026-01-01',
      tipo_periodo: 'anual',
      meta_original: 40613761,
      meta_mes: 40613761,
      activo: true,
    });

    const res = await request(app)
      .post('/api/admin/vendedor-metas')
      .send({
        usuario_id: 7,
        anio: 2026,
        mes: 1,
        tipo_periodo: 'anual',
        meta: 40613761,
        activo: true,
        observacion: 'Meta anual',
      });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.fecha).toBe('2026-01-01');
    expect(mockModel.guardarMetaVendedor).toHaveBeenCalled();
  });

  test('PATCH /api/admin/vendedor-metas/:id/desactivar cambia el estado', async () => {
    mockModel.actualizarEstadoMetaVendedor.mockResolvedValueOnce({
      id: 2,
      activo: false,
    });

    const res = await request(app).patch('/api/admin/vendedor-metas/2/desactivar');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockModel.actualizarEstadoMetaVendedor).toHaveBeenCalledWith(expect.any(Object), {
      id: 2,
      activo: false,
    });
  });
});
