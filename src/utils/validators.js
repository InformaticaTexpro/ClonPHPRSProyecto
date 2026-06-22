'use strict';

/**
 * validators.js — Sanitización y validación de parámetros de entrada.
 *
 * Centraliza la validación de inputs que llegan desde req.params, req.query
 * y req.body antes de que toquen queries SQL o rutas de archivos.
 */

const COD_VENDEDOR_RE = /^[A-Za-z0-9-]{1,20}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RUT_RE = /^\d{1,2}\.?\d{3}\.?\d{3}-?[0-9Kk]$/;

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

function validateCodVendedor(value) {
  const s = String(value || '').trim();
  if (!COD_VENDEDOR_RE.test(s)) {
    throw new Error(`Código de vendedor inválido: "${s}". Solo alfanuméricos y guión, máx 20 caracteres.`);
  }
  return s;
}

function validatePorcentaje(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 100) {
    throw new Error(`Porcentaje inválido: "${value}". Debe estar entre 1 y 100.`);
  }
  return Math.round(n);
}

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

function validateEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Email inválido: "${email}"`);
  }
  return email;
}

function validateIsoDate(value, fieldName = 'fecha') {
  const s = String(value ?? '').trim();
  if (!ISO_DATE_RE.test(s)) {
    throw new Error(`${fieldName} inválida: debe usar formato YYYY-MM-DD.`);
  }
  const date = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== s) {
    throw new Error(`${fieldName} inválida: fecha calendario inexistente.`);
  }
  return s;
}

function validateRut(value) {
  const rut = String(value ?? '').trim();
  if (!RUT_RE.test(rut)) {
    throw new Error('RUT inválido. Usa formato 12345678-9 o 12.345.678-9.');
  }
  return rut.toUpperCase();
}

function validateMesAnio(mesValue, anioValue) {
  const mes = Number(mesValue);
  const anio = Number(anioValue);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new Error('Mes inválido. Debe estar entre 1 y 12.');
  }
  if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) {
    throw new Error('Año inválido. Debe estar entre 2000 y 2100.');
  }
  return { mes, anio };
}

module.exports = {
  validateFolio,
  validateCodVendedor,
  validatePorcentaje,
  validateId,
  validateEmail,
  validateIsoDate,
  validateRut,
  validateMesAnio,
};
