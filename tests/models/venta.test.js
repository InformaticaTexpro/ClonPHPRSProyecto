'use strict';
/**
 * tests/models/venta.test.js
 * Cobertura 100% de src/models/venta.js
 *
 * Funciones cubiertas:
 *   buildInParams (privada, ejercida indirectamente)
 *   getTotalVentas
 *   getResumenPorVendedor
 *   getClientesPorVendedor
 *   getVentas
 *   getMontoFolio
 *   getDetalleFolio
 *   getDescuentosVendedor
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockRequest = {
  input: jest.fn().mockReturnThis(),
  query: jest.fn(),
};

jest.mock('../../src/config/db.softland', () => ({
  getSoftlandPool: jest.fn().mockResolvedValue({
    connected: true,
    request: jest.fn(() => mockRequest),
  }),
  sql: {
    Int:      {},
    VarChar:  jest.fn().mockReturnValue('VARCHAR(20)'),
  },
}));

jest.mock('../../src/config/db', () => ({
  pool:  { query: jest.fn() },
  query: jest.fn(),
}));

jest.mock('../../src/utils/precioHistorico', () => ({
  buildPrecioListaRealCASE: jest.fn().mockResolvedValue('t.PrecioVta'),
  buildDivisorCASE:         jest.fn().mockResolvedValue('1.0'),
}));

const {
  getTotalVentas,
  getResumenPorVendedor,
  getClientesPorVendedor,
  getVentas,
  getMontoFolio,
  getDetalleFolio,
  getDescuentosVendedor,
} = require('../../src/models/venta');

const CODIGOS = ['V001', 'V002'];
const BASE    = { codigos: CODIGOS, mes: 6, anio: 2026 };

beforeEach(() => {
  jest.clearAllMocks();
  // default: query resuelve con recordset vacío
  mockRequest.query.mockResolvedValue({ recordset: [] });
});

// ── buildInParams (ejercida por todas las funciones) ─────────────────────────
describe('buildInParams — generación de parámetros SQL IN', () => {
  test('llama request.input una vez por código', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{ total_ventas: 0 }] });
    await getTotalVentas(BASE);
    // 2 códigos → 2 llamadas input para los params de vendedor
    const inputs = mockRequest.input.mock.calls.map(([name]) => name);
    expect(inputs).toContain('cod0');
    expect(inputs).toContain('cod1');
  });

  test('con un solo código genera @cod0', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{ total_ventas: 500000 }] });
    await getTotalVentas({ codigos: ['V001'], mes: 1, anio: 2026 });
    const inputs = mockRequest.input.mock.calls.map(([name]) => name);
    expect(inputs).toContain('cod0');
    expect(inputs).not.toContain('cod1');
  });
});

// ── getTotalVentas ────────────────────────────────────────────────────────────
describe('getTotalVentas', () => {
  test('retorna el total_ventas del primer recordset', async () => {
    mockRequest.query.mockResolvedValueOnce({
      recordset: [{ total_ventas: 1500000 }],
    });
    const total = await getTotalVentas(BASE);
    expect(total).toBe(1500000);
  });

  test('retorna 0 si el recordset no tiene total_ventas (undefined ?? 0)', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [{}] });
    const total = await getTotalVentas(BASE);
    expect(total).toBe(0);
  });

  test('retorna 0 si el recordset está vacío', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    const total = await getTotalVentas(BASE);
    expect(total).toBe(0);
  });

  test('propaga error de Softland', async () => {
    mockRequest.query.mockRejectedValueOnce(new Error('DB error'));
    await expect(getTotalVentas(BASE)).rejects.toThrow('DB error');
  });
});

// ── getResumenPorVendedor ─────────────────────────────────────────────────────
describe('getResumenPorVendedor', () => {
  test('retorna el recordset completo', async () => {
    const filas = [
      { codigo_vendedor: 'V001', nombre_vendedor: 'Ana', total_ventas: 2000000, pct_descuento: 5 },
    ];
    mockRequest.query.mockResolvedValueOnce({ recordset: filas });
    const result = await getResumenPorVendedor(BASE);
    expect(result).toEqual(filas);
  });

  test('retorna array vacío si no hay ventas', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    const result = await getResumenPorVendedor(BASE);
    expect(result).toEqual([]);
  });

  test('llama buildPrecioListaRealCASE con los campos correctos', async () => {
    const { buildPrecioListaRealCASE } = require('../../src/utils/precioHistorico');
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    await getResumenPorVendedor(BASE);
    expect(buildPrecioListaRealCASE).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ campoFecha: 'gsaen.Fecha' })
    );
  });

  test('propaga error', async () => {
    mockRequest.query.mockRejectedValueOnce(new Error('timeout'));
    await expect(getResumenPorVendedor(BASE)).rejects.toThrow('timeout');
  });
});

// ── getClientesPorVendedor ────────────────────────────────────────────────────
describe('getClientesPorVendedor', () => {
  test('retorna el recordset de clientes', async () => {
    const filas = [{ codigo_vendedor: 'V001', nombre_cliente: 'Empresa SA' }];
    mockRequest.query.mockResolvedValueOnce({ recordset: filas });
    const result = await getClientesPorVendedor(BASE);
    expect(result).toEqual(filas);
  });

  test('array vacío si no hay resultados', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    expect(await getClientesPorVendedor(BASE)).toEqual([]);
  });

  test('propaga error', async () => {
    mockRequest.query.mockRejectedValueOnce(new Error('red'));
    await expect(getClientesPorVendedor(BASE)).rejects.toThrow('red');
  });
});

// ── getVentas ─────────────────────────────────────────────────────────────────
describe('getVentas', () => {
  test('retorna lista de folios con formato esperado', async () => {
    const filas = [
      { Folio: 1001, tipo_folio: 'F', fecha_formato: '15/06/2026', monto: 500000, CodVendedor: 'V001' },
    ];
    mockRequest.query.mockResolvedValueOnce({ recordset: filas });
    const result = await getVentas(BASE);
    expect(result).toEqual(filas);
    expect(result[0].Folio).toBe(1001);
    expect(mockRequest.query.mock.calls.at(-1)[0]).toMatch(/CASE gsaen\.Tipo WHEN 'F' THEN 1 WHEN 'N' THEN 2 WHEN 'D' THEN 3 ELSE 9 END/);
  });

  test('retorna array vacío si no hay ventas', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    expect(await getVentas(BASE)).toEqual([]);
  });

  test('propaga error', async () => {
    mockRequest.query.mockRejectedValueOnce(new Error('sql'));
    await expect(getVentas(BASE)).rejects.toThrow('sql');
  });
});

// ── getMontoFolio ─────────────────────────────────────────────────────────────
describe('getMontoFolio', () => {
  test('retorna el primer registro si existe', async () => {
    const fila = { SubTotal: 800000, descuento: 0 };
    mockRequest.query.mockResolvedValueOnce({ recordset: [fila] });
    const result = await getMontoFolio({ folio: 1001, anio: 2026 });
    expect(result).toEqual(fila);
  });

  test('retorna null si el folio no existe (recordset vacío)', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    const result = await getMontoFolio({ folio: 9999, anio: 2026 });
    expect(result).toBeNull();
  });

  test('propaga error', async () => {
    mockRequest.query.mockRejectedValueOnce(new Error('timeout'));
    await expect(getMontoFolio({ folio: 1, anio: 2026 })).rejects.toThrow();
  });
});

// ── getDetalleFolio ───────────────────────────────────────────────────────────
describe('getDetalleFolio', () => {
  test('retorna l?neas del folio con campos de reporte', async () => {
    const filas = [
      {
        Folio: 377326,
        tipo_folio: 'F',
        Tipo: 'F',
        CodProd: 'PQ03580001',
        DesProd: 'EJEMPLO DETALLE',
        CantFacturada: 12,
        TotLinea: 77964,
        PreUniMB: 6497,
        PreUniMVta: 6497,
        precio_real_oficial: 2999,
      },
    ];
    mockRequest.query.mockResolvedValueOnce({ recordset: filas });
    const result = await getDetalleFolio({ folio: 377326 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      Folio: 377326,
      Tipo: 'F',
      CodProd: 'PQ03580001',
      CantFacturada: 12,
      TotLinea: 77964,
      precio_vta: 6497,
      precio_real: 2999,
      neto_real: 35988,
      neto_total: 77964,
      PrecioVta: 6497,
      PrecioReal: 2999,
      NetoReal: 35988,
      NetoTotal: 77964,
    }));
    expect(result[0].dcto).toBe(-117);
  });

  test('maneja nota de credito con precio y descuento correctos', async () => {
    mockRequest.query.mockResolvedValueOnce({
      recordset: [
      {
        Folio: 20475,
          tipo_folio: 'N',
          Tipo: 'N',
          CodProd: 'PQ00010026',
          CantFacturada: -52,
          TotLinea: -343200,
          PreUniMB: 7097,
          PreUniMVta: 6600,
          precio_real_oficial: 7097,
        },
      ],
    });

    const result = await getDetalleFolio({ folio: 20475 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      Tipo: 'N',
      precio_real: 7097,
      precio_vta: 6600,
      neto_real: -369044,
      neto_total: -343200,
      PrecioVta: 6600,
      PrecioReal: 7097,
      NetoReal: -369044,
      NetoTotal: -343200,
      Dcto: 7,
    }));
    expect(result[0].dcto).toBe(7);
  });

});

describe('getDescuentosVendedor', () => {
  test('retorna resumen de descuentos por vendedor', async () => {
    const filas = [
      {
        codigo_vendedor: 'V001',
        nombre_vendedor: 'Ana',
        cantidad_folios: 5,
        total_ventas: 2500000,
        pct_descuento_promedio: 8.5,
      },
    ];
    mockRequest.query.mockResolvedValueOnce({ recordset: filas });
    const result = await getDescuentosVendedor(BASE);
    expect(result).toEqual(filas);
    expect(result[0].pct_descuento_promedio).toBe(8.5);
  });

  test('retorna array vacío si no hay descuentos', async () => {
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    expect(await getDescuentosVendedor(BASE)).toEqual([]);
  });

  test('llama buildPrecioListaRealCASE una vez', async () => {
    const { buildPrecioListaRealCASE } = require('../../src/utils/precioHistorico');
    mockRequest.query.mockResolvedValueOnce({ recordset: [] });
    await getDescuentosVendedor(BASE);
    expect(buildPrecioListaRealCASE).toHaveBeenCalledTimes(1);
  });

  test('propaga error', async () => {
    mockRequest.query.mockRejectedValueOnce(new Error('err'));
    await expect(getDescuentosVendedor(BASE)).rejects.toThrow('err');
  });
});
