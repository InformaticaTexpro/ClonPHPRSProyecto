'use strict';

const mockDbQuery = jest.fn();
const mockSoftlandQuery = jest.fn();
const mockSoftlandInput = jest.fn().mockReturnThis();

jest.mock('../../src/config/db', () => ({
  pool: { query: mockDbQuery },
  query: mockDbQuery,
}));

jest.mock('../../src/config/db.softland', () => ({
  getSoftlandPool: jest.fn().mockResolvedValue({
    request: jest.fn(() => ({
      input: mockSoftlandInput,
      query: mockSoftlandQuery,
    })),
  }),
  sql: {
    Int: {},
    DateTime: {},
    VarChar: jest.fn().mockReturnValue('VARCHAR'),
  },
}));

const {
  listarFoliosSoftlandCompartidos,
  obtenerRevisionVentasCompartidas,
} = require('../../src/models/reporteCompartido');

beforeEach(() => {
  jest.clearAllMocks();
});

function useDbScenario({ asignacionesRows = [], reportesRows = [] } = {}) {
  mockDbQuery.mockImplementation(async sqlText => {
    const sql = String(sqlText || '');

    if (sql.includes('FROM factura_compartida')) {
      return [asignacionesRows];
    }

    if (sql.includes('FROM reporte_venta_compartida_confirmacion')) {
      return [reportesRows];
    }

    return [[]];
  });
}

describe('obtenerRevisionVentasCompartidas', () => {
  test('filtra Softland a facturas tipo F en rango de fechas', async () => {
    useDbScenario();

    mockSoftlandQuery.mockImplementationOnce(async sqlText => {
      const sql = String(sqlText || '');
      expect(sql).toContain("h.Tipo = 'F'");
      expect(sql).toContain('h.Fecha >= @fechaInicio');
      expect(sql).toContain('h.Fecha < @fechaFin');
      expect(sql).not.toContain('MONTH(h.Fecha) = @mes');
      expect(sql).not.toContain('YEAR(h.Fecha) = @anio');
      return {
        recordset: [
          {
            Folio: '1001',
            fecha_iso: '2026-01-15',
            fecha: '15/01/2026',
            cod_vendedor_softland: '437',
            vendedor_softland: 'Código compartido 437',
            cliente: 'Cliente Uno',
            total_softland: 50000,
            existe_softland: true,
          },
        ],
      };
    });

    const filas = await listarFoliosSoftlandCompartidos({ anio: 2026, mes: 1 });

    expect(filas).toHaveLength(1);
    expect(filas[0].folio).toBe('1001');
    expect(mockSoftlandInput.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(['fechaInicio', 'fechaFin', 'cod0', 'cod1', 'cod2', 'cod3'])
    );
  });

  test('mantiene folios Softland compartidos aunque MySQL venga vacio', async () => {
    useDbScenario();

    mockSoftlandQuery.mockResolvedValue({
      recordset: [
        {
          Folio: '1001',
          fecha_iso: '2026-07-01',
          fecha: '01/07/2026',
          cod_vendedor_softland: '437',
          vendedor_softland: 'Código compartido 437',
          cliente: 'Cliente Uno',
          total_softland: 50000,
          existe_softland: true,
        },
      ],
    });

    const revision = await obtenerRevisionVentasCompartidas({ anio: 2026, mes: 7 });

    expect(revision.resumen.folios_softland_compartidos).toBe(1);
    expect(revision.folios_softland).toHaveLength(1);
    expect(revision.reportes_confirmados).toHaveLength(0);
    expect(revision.comparacion).toHaveLength(1);
    expect(revision.comparacion[0].existe_softland).toBe(true);
    expect(revision.comparacion[0].existe_asignacion).toBe(false);
    expect(revision.comparacion[0].incluido_en_reporte).toBe(false);
    expect(revision.resumen.folios_faltantes_asignacion).toBe(1);
    expect(revision.resumen.diferencias_detectadas).toBe(1);
    expect(revision.codigos_compartidos).toEqual(['437', '630', '446', '447']);
    expect(mockSoftlandInput.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining(['cod0', 'cod1', 'cod2', 'cod3']));
  });

  test('marca folio asignado sin reporte confirmado', async () => {
    useDbScenario({
      asignacionesRows: [
        {
          id: 10,
          folio: '1001',
          fecha: '2026-07-01',
          cliente: 'Cliente Uno',
          monto_neto: 100000,
          monto_asignado: 50000,
          porcentaje: 50,
          cod_vendedor_principal: 'V001',
          cod_vendedor_compartido: 'V002',
          nombre_vendedor_compartido: 'Ana',
          mes: 7,
          anio: 2026,
          rol: 'compartido',
          vendedor_asignador_id: 1,
          vendedor_asignado_id: 2,
          vendedor_asignador: 'Jefe',
          vendedor_asignado: 'Ana',
        },
      ],
    });

    mockSoftlandQuery.mockResolvedValue({
      recordset: [
        {
          Folio: '1001',
          fecha_iso: '2026-07-01',
          fecha: '01/07/2026',
          cod_vendedor_softland: '437',
          vendedor_softland: 'Código compartido 437',
          cliente: 'Cliente Uno',
          total_softland: 50000,
          existe_softland: true,
        },
      ],
    });

    const revision = await obtenerRevisionVentasCompartidas({ anio: 2026, mes: 7 });

    expect(revision.resumen.folios_faltantes_reporte).toBe(1);
    expect(revision.comparacion[0].existe_asignacion).toBe(true);
    expect(revision.comparacion[0].incluido_en_reporte).toBe(false);
    expect(revision.comparacion[0].diferencias).toContain('Folio asignado no incluido en reporte confirmado.');
  });

  test('detecta reporte confirmado que no existe en Softland para codigos compartidos', async () => {
    useDbScenario({
      reportesRows: [
        {
          id: 77,
          vendedor_usuario_id: 2,
          vendedor_nombre: 'Ana',
          anio: 2026,
          mes: 7,
          periodo_label: 'julio 2026',
          cantidad_folios: 1,
          total_venta: 50000,
          total_venta_real: 50000,
          total_descuento: 0,
          total_comision: 0,
          estado: 'confirmado_vendedor',
          confirmado_at: '2026-07-15 10:00:00',
          revisado_at: null,
          comentario_rrhh: null,
          motivo_rechazo: null,
          reporte_json: {
            folios_asignados: [
              {
                folio: '2002',
                cliente: 'Cliente Dos',
                vendedor_asignado: 'Ana',
                porcentaje_participacion: 50,
                monto_asignado: 50000,
              },
            ],
          },
          folios_asignados: [],
          tiene_diferencias: false,
          confirmado_por_nombre: 'Ana',
          revisado_por_nombre: null,
          rechazado_por_nombre: null,
        },
      ],
    });

    mockSoftlandQuery.mockResolvedValue({ recordset: [] });

    const revision = await obtenerRevisionVentasCompartidas({ anio: 2026, mes: 7 });

    expect(revision.folios_softland).toHaveLength(0);
    expect(revision.reportes_confirmados).toHaveLength(1);
    expect(revision.comparacion).toHaveLength(1);
    expect(revision.comparacion[0].existe_softland).toBe(false);
    expect(revision.comparacion[0].incluido_en_reporte).toBe(true);
    expect(revision.comparacion[0].diferencias).toContain('Folio reportado no encontrado en Softland para códigos compartidos.');
  });
});

