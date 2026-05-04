const { validarMesAnio, rtrim } = require('../src/utils/stringHelpers');
const { FACTOR_CANAL, MAX_INTENTOS_LOGIN } = require('../src/config/business-rules');
const colsSoftland = require('../src/config/softland-columns');

// ==========================================
// Tests de validarMesAnio
// ==========================================
describe('validarMesAnio — validación de parámetros de fecha', () => {
  test('valores válidos no lanzan error', () => {
    expect(() => validarMesAnio('3', '2026')).not.toThrow();
  });

  test('retorna números enteros', () => {
    const result = validarMesAnio('3', '2026');
    expect(result).toEqual({ mes: 3, anio: 2026 });
  });

  test('mes 1 (enero) es válido', () => {
    expect(() => validarMesAnio('1', '2025')).not.toThrow();
  });

  test('mes 12 (diciembre) es válido', () => {
    expect(() => validarMesAnio('12', '2025')).not.toThrow();
  });

  test('mes 13 lanza error', () => {
    expect(() => validarMesAnio('13', '2026')).toThrow();
  });

  test('mes 0 lanza error', () => {
    expect(() => validarMesAnio('0', '2026')).toThrow();
  });

  test('mes negativo lanza error', () => {
    expect(() => validarMesAnio('-1', '2026')).toThrow();
  });

  test('año 1999 lanza error', () => {
    expect(() => validarMesAnio('3', '1999')).toThrow();
  });

  test('inyección SQL es rechazada', () => {
    expect(() => validarMesAnio("1; DROP TABLE DTE_Ventas--", '2026')).toThrow();
  });

  test('string vacío usa mes actual como default (no lanza)', () => {
    expect(() => validarMesAnio('', '2026')).not.toThrow();
  });

  test('undefined usa mes actual como default (no lanza)', () => {
    expect(() => validarMesAnio(undefined, '2026')).not.toThrow();
  });
});

// ==========================================
// Tests de rtrim
// ==========================================
describe('rtrim — limpieza de strings Softland', () => {
  test('elimina espacios al final', () => {
    expect(rtrim('PRODUCTO   ')).toBe('PRODUCTO');
  });

  test('no elimina espacios al inicio', () => {
    expect(rtrim('  PRODUCTO')).toBe('  PRODUCTO');
  });

  test('string sin espacios queda igual', () => {
    expect(rtrim('PRODUCTO')).toBe('PRODUCTO');
  });

  test('null retorna string vacío', () => {
    expect(rtrim(null)).toBe('');
  });

  test('undefined retorna string vacío', () => {
    expect(rtrim(undefined)).toBe('');
  });
});

// ==========================================
// Tests de reglas de negocio
// ==========================================
describe('business-rules — reglas de negocio Texpro', () => {
  test('FACTOR_CANAL es 1.10', () => {
    expect(FACTOR_CANAL).toBe(1.10);
  });

  test('cálculo de venta neta con factor canal', () => {
    const subtotal = 1000000;
    expect(subtotal * FACTOR_CANAL).toBe(1100000);
  });

  test('MAX_INTENTOS_LOGIN es 10', () => {
    expect(MAX_INTENTOS_LOGIN).toBe(10);
  });
});

// ==========================================
// Tests de mapa de columnas Softland
// ==========================================
describe('softland-columns — mapa de columnas SQL Server', () => {
  test('columna VENDEDOR definida', () => {
    expect(colsSoftland.VENDEDOR).toBeDefined();
    expect(typeof colsSoftland.VENDEDOR).toBe('string');
  });

  test('columna FECHA definida', () => {
    expect(colsSoftland.FECHA).toBeDefined();
  });

  test('columna SUBTOTAL definida', () => {
    expect(colsSoftland.SUBTOTAL).toBeDefined();
  });

  test('columna TIPO_MOV definida', () => {
    expect(colsSoftland.TIPO_MOV).toBeDefined();
  });
});
