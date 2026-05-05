'use strict';

/**
 * precioHistorico.js
 * Genera dinámicamente el CASE SQL para el divisor histórico de precios,
 * leyendo los períodos de alza desde la tabla tasas_descuentos (MySQL bdtexpro).
 *
 * Regla de negocio:
 *   - iw_tprod.PrecioVta siempre contiene el precio VIGENTE HOY.
 *   - Para comparar contra ventas históricas, se debe dividir ese precio
 *     por el producto acumulado de todas las alzas ocurridas DESPUÉS
 *     de la fecha del documento consultado.
 *   - Cada alza es independiente (ej: 7%, 7%, 5%, 17%) y se multiplican
 *     en cadena: divisor = 1.07 × 1.07 × 1.05 × 1.17
 *   - Excepción NC%: productos con CodProd LIKE 'NC%' usan TotLinea/CantFacturada
 *     como precio real (no se aplica divisor).
 *   - Canal 301: si cvl.CodCan = 301, el precio de lista base se multiplica × 1.1
 *     antes de aplicar el divisor histórico.
 */

/**
 * Carga las tasas desde MySQL y construye el CASE SQL acumulado.
 *
 * @param {object} db         - Conexión MySQL (bdtexpro)
 * @param {string} campoFecha - Nombre del campo fecha en la query SQL Server (ej: 'enc.Fecha')
 * @returns {Promise<string>} - Fragmento SQL con el CASE del divisor histórico
 *
 * Ejemplo de output:
 *   CASE
 *     WHEN enc.Fecha >= '2026-03-01' THEN 1.070000
 *     WHEN enc.Fecha >= '2025-03-01' THEN 1.144900
 *     WHEN enc.Fecha >= '2024-03-01' THEN 1.225043
 *     WHEN enc.Fecha >= '2023-03-01' THEN 1.433300
 *     ELSE 1.0
 *   END
 */
async function buildDivisorCASE(db, campoFecha = 'enc.Fecha') {
  const [tasas] = await db.query(
    `SELECT fecha_corte, porcentaje
     FROM tasas_descuentos
     ORDER BY fecha_corte ASC`
  );

  if (!tasas.length) return '1.0';

  const ramas = tasas.map((tasa) => {
    const fechaCorte = tasa.fecha_corte instanceof Date
      ? tasa.fecha_corte.toISOString().slice(0, 10)
      : String(tasa.fecha_corte).slice(0, 10);

    const tasasPosteriores = tasas.filter(t => {
      const fc = t.fecha_corte instanceof Date
        ? t.fecha_corte.toISOString().slice(0, 10)
        : String(t.fecha_corte).slice(0, 10);
      return fc >= fechaCorte;
    });

    const divisorAcumulado = tasasPosteriores
      .reduce((acc, t) => acc * (1 + Number(t.porcentaje) / 100), 1)
      .toFixed(6);

    return `WHEN ${campoFecha} >= '${fechaCorte}' THEN ${divisorAcumulado}`;
  });

  ramas.reverse();

  return `CASE\n        ${ramas.join('\n        ')}\n        ELSE 1.0\n      END`;
}

/**
 * Construye el CASE completo de PrecioListaReal que combina:
 *   1. Excepción NC%  → precio = TotLinea / CantFacturada
 *   2. Factor canal 301 → PrecioVta × 1.1
 *   3. Divisor histórico acumulado desde tasas_descuentos
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.campoFecha
 * @param {string} opts.campoCodProd
 * @param {string} opts.campoTotLinea
 * @param {string} opts.campoCant
 * @param {string} opts.campoPrecioVta
 * @param {string} opts.campoCodCan
 * @returns {Promise<string>} fragmento SQL
 */
async function buildPrecioListaRealCASE(db, opts = {}) {
  const {
    campoFecha     = 'enc.Fecha',
    campoCodProd   = 'm.CodProd',
    campoTotLinea  = 'm.TotLinea',
    campoCant      = 'm.CantFacturada',
    campoPrecioVta = 't.PrecioVta',
    campoCodCan    = 'cvl.CodCan',
  } = opts;

  const divisorCASE = await buildDivisorCASE(db, campoFecha);

  return `
    CASE
      -- Productos NC: precio real = lo que se cobró (sin ajuste de lista)
      WHEN ${campoCodProd} LIKE 'NC%'
        THEN ${campoTotLinea} / NULLIF(${campoCant}, 0)
      -- Canal 301: precio de lista base + 10%, ajustado históricamente
      WHEN ${campoCodCan} = 301
        THEN (${campoPrecioVta} / NULLIF(${divisorCASE}, 0)) * 1.1
      -- Resto: precio de lista ajustado históricamente
      ELSE
        ${campoPrecioVta} / NULLIF(${divisorCASE}, 0)
    END`;
}

module.exports = { buildDivisorCASE, buildPrecioListaRealCASE };
