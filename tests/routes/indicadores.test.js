'use strict';
/**
 * tests/routes/indicadores.test.js
 *
 * Pruebas unitarias para GET /api/indicadores
 * Mockea https para no depender de findic.cl en CI.
 */

const express = require('express');
const request = require('supertest');
const https = require('https');
const { EventEmitter } = require('events');

function createFindicResponseMock(bodiesByPath, failPaths = []) {
  return jest.fn((opts, cb) => {
    const path = typeof opts === 'string' ? opts : String(opts?.path || '');
    const req = new EventEmitter();
    req.setTimeout = jest.fn();
    req.destroy = (err) => req.emit('error', err || new Error('timeout'));
    req.end = () => {
      if (failPaths.some((needle) => path.includes(needle))) {
        req.emit('error', new Error(`findic fallo en ${path}`));
        return;
      }

      const body = bodiesByPath[path];
      if (!body) {
        req.emit('error', new Error(`ruta no mockeada: ${path}`));
        return;
      }

      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      if (cb) cb(res);
      res.emit('data', Buffer.from(JSON.stringify(body), 'utf8'));
      res.emit('end');
    };
    return req;
  });
}

function loadAppWithMock(requestMock) {
  jest.resetModules();
  jest.spyOn(https, 'request').mockImplementation(requestMock);
  const router = require('../../src/routes/indicadores');
  const app = express();
  app.use('/api/indicadores', router);
  return app;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/indicadores', () => {
  test('parsea dolar y uf desde serie[0] de findic.cl', async () => {
    const app = loadAppWithMock(createFindicResponseMock({
      '/api/dolar': {
        version: '1.3.0',
        autor: 'findic.cl',
        codigo: 'dolar',
        nombre: 'Dólar observado',
        unidad_medida: 'Pesos',
        serie: [
          { fecha: '2026-07-02', valor: 927.35 },
          { fecha: '2026-07-01', valor: 920.11 },
        ],
      },
      '/api/uf': {
        version: '1.3.0',
        autor: 'findic.cl',
        codigo: 'uf',
        nombre: 'Unidad de fomento (UF)',
        unidad_medida: 'Pesos',
        serie: [
          { fecha: '2026-07-02', valor: 40825.75 },
          { fecha: '2026-07-01', valor: 40820.50 },
        ],
      },
    }));

    const res = await request(app).get('/api/indicadores');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.disponible).toBe(true);
    expect(res.body.fuente).toBe('findic.cl');
    expect(res.body.dolar).toEqual({ valor: 927.35, fecha: '2026-07-02' });
    expect(res.body.uf).toEqual({ valor: 40825.75, fecha: '2026-07-02' });
    expect(res.body.stale).toBe(false);
  });

  test('usa caché stale si findic.cl falla después de un acierto previo', async () => {
    const requestMockOk = createFindicResponseMock({
      '/api/dolar': {
        autor: 'findic.cl',
        codigo: 'dolar',
        serie: [{ fecha: '2026-07-02', valor: 927.35 }],
      },
      '/api/uf': {
        autor: 'findic.cl',
        codigo: 'uf',
        serie: [{ fecha: '2026-07-02', valor: 40825.75 }],
      },
    });
    const app = loadAppWithMock(requestMockOk);

    const first = await request(app).get('/api/indicadores');
    expect(first.body.ok).toBe(true);
    expect(first.body.stale).toBe(false);

    const requestMockFail = createFindicResponseMock({}, ['/api/dolar', '/api/uf']);
    https.request.mockImplementation(requestMockFail);

    const originalNow = Date.now;
    Date.now = jest.fn(() => originalNow() + (31 * 60 * 1000));
    let second;
    try {
      second = await request(app).get('/api/indicadores');
    } finally {
      Date.now = originalNow;
    }

    expect(second.status).toBe(200);
    expect(second.body.ok).toBe(true);
    expect(second.body.disponible).toBe(true);
    expect(second.body.stale).toBe(true);
    expect(second.body.fuente).toBe('findic.cl');
    expect(second.body.dolar.valor).toBe(927.35);
    expect(second.body.uf.valor).toBe(40825.75);
  });

  test('si findic.cl falla sin caché devuelve disponible:false', async () => {
    const app = loadAppWithMock(createFindicResponseMock({}, ['/api/dolar', '/api/uf']));

    const res = await request(app).get('/api/indicadores');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.disponible).toBe(false);
    expect(res.body.dolar).toBeNull();
    expect(res.body.uf).toBeNull();
    expect(res.body.fuente).toBe('findic.cl');
    expect(res.body.stale).toBe(false);
  });

  test('solo consulta findic.cl y no reintroduce mindicador ni Banco Central', async () => {
    const requestMock = createFindicResponseMock({
      '/api/dolar': {
        autor: 'findic.cl',
        codigo: 'dolar',
        serie: [{ fecha: '2026-07-02', valor: 927.35 }],
      },
      '/api/uf': {
        autor: 'findic.cl',
        codigo: 'uf',
        serie: [{ fecha: '2026-07-02', valor: 40825.75 }],
      },
    });
    const app = loadAppWithMock(requestMock);

    await request(app).get('/api/indicadores');

    const paths = https.request.mock.calls.map(([opts]) => String(opts?.path || opts || ''));
    expect(paths.some((path) => path.includes('mindicador'))).toBe(false);
    expect(paths.some((path) => path.toLowerCase().includes('bcentral'))).toBe(false);
    expect(paths.some((path) => path.includes('/api/dolar'))).toBe(true);
    expect(paths.some((path) => path.includes('/api/uf'))).toBe(true);
  });
});
