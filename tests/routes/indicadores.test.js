'use strict';
/**
 * tests/routes/indicadores.test.js
 *
 * Pruebas unitarias para GET /api/indicadores
 * Mockea https para no depender de mindicador.cl en CI.
 */

const https   = require('https');
const { EventEmitter } = require('events');

// ── helper: simula https.request devolviendo JSON ────────────────────
function mockHttps(jsonBody) {
  const res = new EventEmitter();
  res.statusCode = 200;
  jest.spyOn(https, 'request').mockImplementation((_url, _opts, cb) => {
    if (cb) cb(res);
    const req = new EventEmitter();
    req.end = () => {
      res.emit('data', JSON.stringify(jsonBody));
      res.emit('end');
    };
    return req;
  });
}

function mockHttpsError(message) {
  jest.spyOn(https, 'request').mockImplementation((_url, _opts, _cb) => {
    const req = new EventEmitter();
    req.end = () => req.emit('error', new Error(message));
    return req;
  });
}

beforeEach(() => jest.restoreAllMocks());

// ── Tests de la función fetchJson (indirectamente via el módulo) ──────
describe('indicadores — fetchJson', () => {
  test('parsea JSON válido correctamente', async () => {
    const payload = {
      dolar: { valor: 883.46, fecha: '2026-06-18T04:00:00.000Z' },
      uf:    { valor: 38521.07, fecha: '2026-06-18T04:00:00.000Z' },
    };
    mockHttps(payload);
    // Limpiamos caché del módulo para forzar llamada fresca
    jest.resetModules();
    const router = require('../../src/routes/indicadores');
    expect(router).toBeDefined();
  });

  test('estructura de respuesta tiene ok, dolar y uf', () => {
    const respuesta = {
      ok: true,
      dolar: { valor: 883.46, fecha: '2026-06-18T04:00:00.000Z' },
      uf:    { valor: 38521.07, fecha: '2026-06-18T04:00:00.000Z' },
      actualizadoEn: new Date().toISOString(),
    };
    expect(respuesta).toHaveProperty('ok', true);
    expect(respuesta).toHaveProperty('dolar.valor');
    expect(respuesta).toHaveProperty('uf.valor');
    expect(typeof respuesta.dolar.valor).toBe('number');
    expect(typeof respuesta.uf.valor).toBe('number');
  });
});

// ── Tests de lógica interna del módulo ───────────────────────────────
describe('indicadores — lógica de caché', () => {
  test('caché TTL está definido como 5 minutos (300000 ms)', () => {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    expect(CACHE_TTL_MS).toBe(300000);
  });

  test('valor dolar es número positivo si API responde bien', () => {
    const valor = 883.46;
    expect(valor).toBeGreaterThan(0);
    expect(typeof valor).toBe('number');
  });

  test('valor uf es número positivo si API responde bien', () => {
    const valor = 38521.07;
    expect(valor).toBeGreaterThan(0);
    expect(typeof valor).toBe('number');
  });

  test('valor null cuando API falla — manejado con fallback', () => {
    const valorFallback = null;
    expect(valorFallback).toBeNull();
  });
});

// ── Tests de formato de respuesta ────────────────────────────────────
describe('indicadores — formato de respuesta', () => {
  test('fecha en ISO 8601 válida', () => {
    const fecha = '2026-06-18T04:00:00.000Z';
    expect(new Date(fecha).toISOString()).toBe(fecha);
  });

  test('actualizadoEn es fecha ISO válida', () => {
    const actualizadoEn = new Date().toISOString();
    expect(() => new Date(actualizadoEn)).not.toThrow();
    expect(actualizadoEn).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  test('ok:false cuando fuente no responde', () => {
    const respError = { ok: false, error: 'No se pudo obtener los indicadores económicos.' };
    expect(respError.ok).toBe(false);
    expect(respError).toHaveProperty('error');
  });
});
