'use strict';
/**
 * tests/utils/mailer.test.js
 *
 * Pruebas para enviarOtp — mockea https para evitar llamadas reales a Azure AD.
 */

const https = require('https');
const { EventEmitter } = require('events');

beforeEach(() => {
  jest.restoreAllMocks();
  // Variables de entorno requeridas por mailer
  process.env.MAIL_TENANT_ID     = 'fake-tenant';
  process.env.MAIL_CLIENT_ID     = 'fake-client';
  process.env.MAIL_CLIENT_SECRET = 'fake-secret';
  process.env.MAIL_FROM_ADDRESS  = 'soporte@texpro.cl';
  process.env.MAIL_FROM_NAME     = 'TEXPRO';
});

describe('enviarOtp', () => {
  test('llama a Graph API con el token y destinatario correctos', async () => {
    // Primera llamada → getAccessToken (login.microsoftonline.com)
    // Segunda llamada → sendMail (graph.microsoft.com)
    const spy = jest.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = (_opts.hostname === 'login.microsoftonline.com') ? 200 : 202;
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end   = () => {
        if (cb) cb(res);
        if (_opts.hostname === 'login.microsoftonline.com') {
          res.emit('data', JSON.stringify({ access_token: 'fake-access-token' }));
        } else {
          res.emit('data', '');
        }
        res.emit('end');
      };
      return req;
    });

    const { enviarOtp } = require('../../src/utils/mailer');
    await expect(enviarOtp('dest@texpro.cl', '654321')).resolves.toBeUndefined();

    // Verificar que se llamó a Graph API (segunda llamada)
    const calls = spy.mock.calls;
    const graphCall = calls.find(([opts]) => opts.hostname === 'graph.microsoft.com');
    expect(graphCall).toBeDefined();
    expect(graphCall[0].path).toContain('sendMail');
    const authHeader = graphCall[0].headers['Authorization'];
    expect(authHeader).toBe('Bearer fake-access-token');
  });

  test('lanza error si faltan variables de entorno de Azure AD', async () => {
    delete process.env.MAIL_TENANT_ID;
    delete process.env.MAIL_CLIENT_ID;
    delete process.env.MAIL_CLIENT_SECRET;

    jest.resetModules();
    const { enviarOtp } = require('../../src/utils/mailer');
    await expect(enviarOtp('dest@texpro.cl', '654321'))
      .rejects
      .toThrow(/MAIL_TENANT_ID|MAIL_CLIENT_ID|MAIL_CLIENT_SECRET/);
  });

  test('lanza error si falta MAIL_FROM_ADDRESS', async () => {
    delete process.env.MAIL_FROM_ADDRESS;
    jest.resetModules();
    const { enviarOtp } = require('../../src/utils/mailer');

    // Mock solo para que getAccessToken funcione
    jest.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end = () => {
        if (cb) cb(res);
        res.emit('data', JSON.stringify({ access_token: 'tok' }));
        res.emit('end');
      };
      return req;
    });

    await expect(enviarOtp('dest@texpro.cl', '000000'))
      .rejects
      .toThrow(/MAIL_FROM_ADDRESS/);
  });

  test('lanza error si Graph API responde con error (no 202)', async () => {
    jest.spyOn(https, 'request').mockImplementation((_opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = (_opts.hostname === 'login.microsoftonline.com') ? 200 : 500;
      const req = new EventEmitter();
      req.write = jest.fn();
      req.end   = () => {
        if (cb) cb(res);
        if (_opts.hostname === 'login.microsoftonline.com') {
          res.emit('data', JSON.stringify({ access_token: 'tok' }));
        } else {
          res.emit('data', 'Internal Server Error');
        }
        res.emit('end');
      };
      return req;
    });

    jest.resetModules();
    process.env.MAIL_TENANT_ID     = 'fake-tenant';
    process.env.MAIL_CLIENT_ID     = 'fake-client';
    process.env.MAIL_CLIENT_SECRET = 'fake-secret';
    process.env.MAIL_FROM_ADDRESS  = 'soporte@texpro.cl';

    const { enviarOtp } = require('../../src/utils/mailer');
    await expect(enviarOtp('dest@texpro.cl', '111111'))
      .rejects
      .toThrow(/Graph API error/);
  });
});
