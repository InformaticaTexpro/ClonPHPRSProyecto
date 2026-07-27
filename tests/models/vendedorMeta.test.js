'use strict';

const mockQuery = jest.fn();

jest.mock('../../src/config/db', () => ({
  pool: {
    query: mockQuery,
  },
  query: mockQuery,
}));

const {
  obtenerMetaVendedor,
  obtenerMetasMensualesVendedor,
  guardarMetaVendedor,
} = require('../../src/models/vendedorMeta');

describe('models/vendedorMeta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('prioriza la meta mensual sobre la anual y no prorratea', async () => {
    mockQuery.mockImplementationOnce((_sql, params) => {
      if (String(params[1]) === '2026-07-01') {
        return Promise.resolve([[
          {
            id: 11,
            usuario_id: 1,
            fecha: '2026-07-01',
            tipo_periodo: 'mensual',
            meta: 650000,
            activo: 1,
          },
        ]]);
      }
      return Promise.resolve([[]]);
    });

    const meta = await obtenerMetaVendedor(1, 2026, 7);

    expect(meta.tipo_periodo).toBe('mensual');
    expect(meta.meta_original).toBe(650000);
    expect(meta.meta_mes).toBe(650000);
    expect(meta.prorrateada).toBe(false);
  });

  test('usa la meta anual completa cuando no existe mensual exacta del mes', async () => {
    mockQuery.mockImplementationOnce((_sql, params) => {
      if (String(params[1]) === '2026-03-01') {
        return Promise.resolve([[
          {
            id: 20,
            usuario_id: 1,
            fecha: '2026-01-01',
            tipo_periodo: 'anual',
            meta: 40613761,
            activo: 1,
          },
        ]]);
      }
      return Promise.resolve([[]]);
    });

    const meta = await obtenerMetaVendedor(1, 2026, 3);

    expect(meta.tipo_periodo).toBe('anual');
    expect(meta.meta_original).toBe(40613761);
    expect(meta.meta_mes).toBe(40613761);
    expect(meta.prorrateada).toBe(false);
  });

  test('no usa una meta mensual de otro mes como fallback', async () => {
    mockQuery.mockResolvedValueOnce([[
      {
        id: 21,
        usuario_id: 1,
        fecha: '2026-01-01',
        tipo_periodo: 'anual',
        meta: 40613761,
        activo: 1,
      },
    ]]);

    const meta = await obtenerMetaVendedor(1, 2026, 7);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("vm.fecha = ?"),
      [1, '2026-07-01', 2026]
    );
    expect(meta.tipo_periodo).toBe('anual');
    expect(meta.meta_mes).toBe(40613761);
    expect(meta.prorrateada).toBe(false);
  });

  test('guardarMetaVendedor inserta una meta anual con fecha de enero', async () => {
    mockQuery.mockResolvedValueOnce([{}]);
    mockQuery.mockResolvedValueOnce([[
      {
        id: 30,
        usuario_id: 2,
        fecha: '2026-01-01',
        tipo_periodo: 'anual',
        meta: 500000,
        activo: 1,
      },
    ]]);

    const meta = await guardarMetaVendedor({
      usuario_id: 2,
      anio: 2026,
      mes: 7,
      tipo_periodo: 'anual',
      meta: 500000,
      activo: true,
      observacion: 'Prueba',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON DUPLICATE KEY UPDATE'),
      [2, '2026-01-01', 'anual', 500000, 1, 'Prueba']
    );
    expect(meta.fecha).toBe('2026-01-01');
    expect(meta.meta_original).toBe(500000);
    expect(meta.meta_mes).toBe(500000);
    expect(meta.prorrateada).toBe(false);
  });

  test('obtenerMetasMensualesVendedor devuelve 12 meses y usa la meta anual completa', async () => {
    mockQuery.mockResolvedValueOnce([[
      {
        id: 40,
        usuario_id: 3,
        fecha: '2026-01-01',
        tipo_periodo: 'anual',
        meta: 40613761,
        activo: 1,
      },
    ]]);

    const metas = await obtenerMetasMensualesVendedor(3, 2026);

    expect(metas).toHaveLength(12);
    expect(metas[0].meta_original).toBe(40613761);
    expect(metas[0].meta_mes).toBe(40613761);
    expect(metas[0].tipo_periodo).toBe('anual');
    expect(metas[0].prorrateada).toBe(false);
    expect(metas[6].meta_mes).toBe(40613761);
  });

  test('obtenerMetasMensualesVendedor respeta metas mensuales distintas por mes', async () => {
    mockQuery.mockResolvedValueOnce([[
      {
        id: 50,
        usuario_id: 4,
        fecha: '2026-05-01',
        mes: 5,
        tipo_periodo: 'mensual',
        meta: 650000,
        activo: 1,
      },
      {
        id: 51,
        usuario_id: 4,
        fecha: '2026-06-01',
        mes: 6,
        tipo_periodo: 'mensual',
        meta: 1050000,
        activo: 1,
      },
      {
        id: 52,
        usuario_id: 4,
        fecha: '2026-12-01',
        mes: 12,
        tipo_periodo: 'mensual',
        meta: 4700000,
        activo: 1,
      },
    ]]);

    const metas = await obtenerMetasMensualesVendedor(4, 2026);

    expect(metas).toHaveLength(12);
    expect(metas[4].meta_mes).toBe(650000);
    expect(metas[5].meta_mes).toBe(1050000);
    expect(metas[11].meta_mes).toBe(4700000);
    expect(metas[0].meta_mes).toBe(0);
    expect(metas[4].tipo_periodo).toBe('mensual');
    expect(metas[11].prorrateada).toBe(false);
  });
});
