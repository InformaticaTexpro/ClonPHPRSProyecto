'use strict';

/**
 * validators.js — Sanitización y validación de parámetros de entrada
 *
 * Centraliza la validación de inputs que llegan desde req.params, req.query
 * y req.body antes de que toquen las queries SQL.
 *
 * Uso:
 *   const { validateFolio, validateCodVendedor, validatePorcentaje } = require('../utils/validators');
 *
 *   const folio = validateFolio(req.params.folio);        // lanza Error si inválido
 *   const cod   = validateCodVendedor(req.body.cod);      // lanza Error si inválido
 *   const pct   = validatePorcentaje(req.body.porcentaje); // lanza Error si inválido
 *
 * Todos los helpers lanzan Error con mensaje legible para devolver 400.
 */

// Regex para códigos de vendedor Softland: letras, números, guión, máx 20 chars
const COD_VENDEDOR_RE = /^[A-Za-z0-9-]{1,20}$/;

/**
 * Valida y retorna un número de folio entero positivo.
 * @param {any} value
 * @returns {number}
 */
function validateFolio(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) {
    throw new Error(`Folio inválido: "${value}". Debe ser un entero positivo.`);
  }
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 9_999_999) {
    throw new Error(`Folio inválido: "${value}". Debe ser un entero positivo.`);
  }
  return n;
}

/**
 * Valida y retorna un código de vendedor (alfanumérico, máx 20 chars).
 * Prevín SQL injection por concatenación directa en queries mssqlIn().
 * @param {any} value
 * @returns {string}
 */
function validateCodVendedor(value) {
  const s = String(value || '').trim();
  if (!COD_VENDEDOR_RE.test(s)) {
    throw new Error(`Código de vendedor inválido: "${s}". Solo alfanuméricos y guión, máx 20 caracteres.`);
  }
  return s;
}

/**
 * Valida y retorna un porcentaje entre 1 y 100.
 * @param {any} value
 * @returns {number}
 */
function validatePorcentaje(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    throw new Error(`Porcentaje inválido: "${value}". Debe estar entre 1 y 100.`);
  }
  return Math.round(n);
}

/**
 * Valida y retorna un ID de registro MySQL (entero positivo).
 * @param {any} value
 * @returns {number}
 */
function validateId(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) {
    throw new Error(`ID inválido: "${value}". Debe ser un entero positivo.`);
  }
  const n = parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`ID inválido: "${value}". Debe ser un entero positivo.`);
  }
  return n;
}

module.exports = { validateFolio, validateCodVendedor, validatePorcentaje, validateId };
