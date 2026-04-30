'use strict';

/**
 * utils/precioHistorico.js
 *
 * Capa centralizada de normalización de precios históricos.
 *
 * Contexto de negocio:
 *   Cada año en marzo se aplica un aumento de precios registrado en la
 *   tabla MySQL `tasas_descuentos`. Cuando se consultan datos históricos
 *   anteriores a esos aumentos, los precios de lista (iw_tprod.PrecioVta)
 *   ya reflejan los aumentos posteriores, por lo que se deben "deshacer"
 *   multiplicando por el factor acumulado de todas las tasas que aún no
 *   habían ocurrido en el período consultado.
 *
 * Regla de acumulación:
 *   Para un período (mes, anio), se acumulan como descuento TODAS las
 *   tasas cuya fecha_vigencia sea POSTERIOR a la fecha de ese período.
 *
 *   Ejemplo:
 *     Consulta enero 2023 → aplican: 2023 + 2024 + 2025 + 2026
 *     Consulta abril 2023 → aplican: 2024 + 2025 + 2026  (la de 2023 ya fue)
 *     Consulta junio 2024 → aplican: 2025 + 2026
 *     Consulta hoy 2026   → factor = 1 (sin descuento)
 *
 * Fórmula:
 *   factor = ∏ (1 - tasa_i / 100)   para cada tasa posterior al período
 *
 * API:
 *   getFactorHistorico(mes, anio) → Promise<number>  (ej: 0.6777)
 *   aplicarFactor(valor, factor)  → number redondeado a 0 decimales
 */

const db = require('../config/db');

// Cache en memoria: clave "YYYY-MM" → factor (number)
// Se limpia en cada reinicio del proceso. Para producción de alto tráfico
// se puede migrar a Redis, pero para uso interno de Texpro es suficiente.
const _cache = new Map();

/**
 * Calcula el factor multiplicador acumulado para un período dado.
 *
 * @param {number} mes   - Mes del período consultado (1-12)
 * @param {number} anio  - Año del período consultado (ej: 2023)
 * @returns {Promise<number>} Factor entre 0 y 1 (ej: 0.8649 para una tasa del 13.51%)
 */
async function getFactorHistorico(mes, anio) {
  const cacheKey = `${anio}-${String(mes).padStart(2, '0')}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  // Primer día del período consultado — punto de corte
  // Las tasas con fecha_vigencia POSTERIOR a esta fecha aún no habían ocurrido
  // cuando se registraron esos precios, por lo que deben aplicarse como descuento.
  const fechaCorte = new Date(anio, mes - 1, 1); // mes es 0-indexed en Date()

  const [rows] = await db.pool.query(
    `SELECT porcentaje
     FROM tasas_descuentos
     WHERE fecha_corte > ?
     ORDER BY fecha_corte ASC`,
    [fechaCorte]
  );

  // Producto encadenado: factor = 1/(1+t1/100) × 1/(1+t2/100) × ...
  // Cada tasa representa un AUMENTO aplicado posteriormente (ej. 7 → precios subieron 7%).
  // Para "deshacer" ese aumento se divide por (1 + tasa/100), equivalente a multiplicar
  // por 1/(1+tasa/100).  Usar (1 - tasa/100) sería incorrecto: daría 0.93 en vez de 1/1.07.
  let factor = 1;
  for (const r of rows) {
    const tasa = Number(r.porcentaje);
    if (tasa > 0) {
      factor *= 1 / (1 + tasa / 100);
    }
  }

  _cache.set(cacheKey, factor);
  return factor;
}

/**
 * Aplica el factor histórico a un valor monetario y redondea a entero.
 *
 * @param {number} valor  - Precio o monto original (precio lista Softland)
 * @param {number} factor - Factor obtenido de getFactorHistorico()
 * @returns {number} Valor ajustado redondeado a 0 decimales
 */
function aplicarFactor(valor, factor) {
  return Math.round(Number(valor) * factor);
}

/**
 * Limpia el caché de factores (útil para tests o forzar recarga).
 */
function limpiarCache() {
  _cache.clear();
}

module.exports = { getFactorHistorico, aplicarFactor, limpiarCache };
