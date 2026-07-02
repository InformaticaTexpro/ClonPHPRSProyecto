'use strict';

const {
  describirEstadoPassword,
  parseIdsArg: parseIdsListUsers,
} = require('../../scripts/list-users-password-status');

const {
  buildActionSummary,
  describePasswordState,
  isPlaintextSafeToMigrate,
  parseIdsArg: parseIdsMigrate,
} = require('../../scripts/migrate-plaintext-passwords');

describe('scripts/list-users-password-status', () => {
  test('clasifica passwords vacíos, nulos, Django y no soportados', () => {
    expect(describirEstadoPassword(null)).toBe('NULL');
    expect(describirEstadoPassword(undefined)).toBe('NULL');
    expect(describirEstadoPassword('')).toBe('VACIA');
    expect(describirEstadoPassword('   ')).toBe('VACIA');
    expect(describirEstadoPassword('pbkdf2_sha256$600000$salt$hash')).toBe('HASH_DJANGO');
    expect(describirEstadoPassword('123')).toBe('FORMATO_NO_SOPORTADO');
  });

  test('parseIdsArg soporta listas separadas por coma', () => {
    expect(parseIdsListUsers(['--ids', '36,37, 38'])).toEqual([36, 37, 38]);
    expect(parseIdsListUsers([])).toEqual([]);
  });
});

describe('scripts/migrate-plaintext-passwords', () => {
  test('clasifica estados de password igual que el listado', () => {
    expect(describePasswordState(null)).toBe('NULL');
    expect(describePasswordState('')).toBe('VACIA');
    expect(describePasswordState('pbkdf2_sha256$600000$salt$hash')).toBe('HASH_DJANGO');
    expect(describePasswordState('123')).toBe('FORMATO_NO_SOPORTADO');
  });

  test('identifica passwords planos seguros para migración', () => {
    expect(isPlaintextSafeToMigrate('123')).toBe(true);
    expect(isPlaintextSafeToMigrate('abc123')).toBe(true);
    expect(isPlaintextSafeToMigrate('abc$123')).toBe(false);
    expect(isPlaintextSafeToMigrate('pbkdf2_sha256$600000$salt$hash')).toBe(false);
  });

  test('buildActionSummary decide migrar solo texto plano seguro', () => {
    expect(buildActionSummary({ password: '123' }).migrar).toBe(true);
    expect(buildActionSummary({ password: 'abc$123' }).migrar).toBe(false);
    expect(buildActionSummary({ password: null }).migrar).toBe(false);
  });

  test('parseIdsArg soporta listas separadas por coma', () => {
    expect(parseIdsMigrate(['--ids', '36,37, 38'])).toEqual([36, 37, 38]);
    expect(parseIdsMigrate([])).toEqual([]);
  });
});
