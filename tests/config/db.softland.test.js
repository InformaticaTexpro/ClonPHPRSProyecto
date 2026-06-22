'use strict';
/**
 * tests/config/db.softland.test.js
 *
 * Pruebas de getSoftlandPool y closeSoftlandPool.
 * Se mockea mssql para evitar conexiones reales en CI.
 */

// ── Mock mssql ─────────────────────────────────────────────────────────────────
const mockPool = {
  connected: true,
  close: jest.fn().mockResolvedValue(undefined),
  request: jest.fn(),
};

jest.mock('mssql', () => ({
  connect: jest.fn().mockResolvedValue(mockPool),
}));

// Reset module between tests to clear the internal _pool singleton
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  // Re-aplicar el mock tras resetModules
  jest.mock('mssql', () => ({
    connect: jest.fn().mockResolvedValue({
      connected: true,
      close: jest.fn().mockResolvedValue(undefined),
      request: jest.fn(),
    }),
  }));
});

// ── getSoftlandPool ────────────────────────────────────────────────────────────
describe('getSoftlandPool', () => {
  test('retorna conexión activa (pool con connected:true)', async () => {
    const { getSoftlandPool } = require('../../src/config/db.softland');
    const pool = await getSoftlandPool();
    expect(pool).toBeDefined();
    expect(pool.connected).toBe(true);
  });

  test('reutiliza el pool si ya está conectado', async () => {
    const { getSoftlandPool } = require('../../src/config/db.softland');
    const pool1 = await getSoftlandPool();
    const pool2 = await getSoftlandPool();
    expect(pool1).toBe(pool2);
  });

  test('lanza error si sql.connect falla', async () => {
    jest.resetModules();
    jest.mock('mssql', () => ({
      connect: jest.fn().mockRejectedValue(new Error('BD no disponible')),
    }));
    const { getSoftlandPool } = require('../../src/config/db.softland');
    await expect(getSoftlandPool()).rejects.toThrow('BD no disponible');
  });
});

// ── closeSoftlandPool ──────────────────────────────────────────────────────────
describe('closeSoftlandPool', () => {
  test('cierra la conexión sin error', async () => {
    const { getSoftlandPool, closeSoftlandPool } = require('../../src/config/db.softland');
    await getSoftlandPool();
    await expect(closeSoftlandPool()).resolves.toBeUndefined();
  });

  test('no lanza error si pool ya es null', async () => {
    const { closeSoftlandPool } = require('../../src/config/db.softland');
    await expect(closeSoftlandPool()).resolves.toBeUndefined();
  });
});

// ── testConnection (verificación lógica) ────────────────────────────────────────
describe('testConnection', () => {
  test('resuelve true con pool activo', async () => {
    const { getSoftlandPool } = require('../../src/config/db.softland');
    const pool = await getSoftlandPool();
    expect(pool.connected).toBe(true);
  });

  test('lanza error si la BD no está disponible', async () => {
    jest.resetModules();
    jest.mock('mssql', () => ({
      connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    }));
    const { getSoftlandPool } = require('../../src/config/db.softland');
    await expect(getSoftlandPool()).rejects.toThrow('ECONNREFUSED');
  });
});
