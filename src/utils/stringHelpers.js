'use strict';

/**
 * Elimina espacios al final del string (equivalente a RTRIM de SQL)
 * Softland devuelve strings con padding de espacios
 */
const rtrim = (str) => (str ? str.trimEnd() : '');

/**
 * Valida y parsea parámetros mes/anio de req.query.
 * Si mes o anio son undefined/null/vacío, usa el mes y año actuales como default.
 * Lanza Error si los valores provistos son inválidos o potencialmente maliciosos.
 *
 * @param {string|undefined} mes  - Mes como string (1-12). Opcional.
 * @param {string|undefined} anio - Año como string (2026-2100). Opcional.
 * @returns {{ mes: number, anio: number }}
 */
const ANIO_MINIMO_OPERATIVO = 2026;

const validarMesAnio = (mes, anio) => {
  const ahora = new Date();

  // Usar valores actuales como default cuando el parámetro no viene
  const mStr = (mes  === undefined || mes  === null || mes  === '') ? String(ahora.getMonth() + 1) : String(mes).trim();
  const aStr = (anio === undefined || anio === null || anio === '') ? String(ahora.getFullYear())  : String(anio).trim();

  // Validación estricta: solo dígitos — rechaza inyección SQL ("1; DROP TABLE...")
  if (!/^\d+$/.test(mStr)) {
    throw new Error(`Mes inválido: "${mes}". Debe ser un número entero entre 1 y 12.`);
  }
  if (!/^\d+$/.test(aStr)) {
    throw new Error(`Año inválido: "${anio}". Debe ser un número entero entre ${ANIO_MINIMO_OPERATIVO} y 2100.`);
  }

  const m = parseInt(mStr, 10);
  const a = parseInt(aStr, 10);

  if (m < 1 || m > 12) {
    throw new Error(`Mes inválido: ${mStr}. Debe estar entre 1 y 12`);
  }
  if (a < ANIO_MINIMO_OPERATIVO || a > 2100) {
    throw new Error(`Año inválido: ${aStr}. Debe estar entre ${ANIO_MINIMO_OPERATIVO} y 2100`);
  }

  return { mes: m, anio: a };
};

module.exports = { rtrim, validarMesAnio, ANIO_MINIMO_OPERATIVO };
