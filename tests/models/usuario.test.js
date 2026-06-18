'use strict';
/**
 * tests/models/usuario.test.js
 *
 * Pruebas para el modelo de usuario: findByEmail, findById, updatePassword.
 * Se mockea el pool MySQL y pbkdf2Django.
 */

// ── Mock DB pool ───────────────────────────────────────────────────────────────
const mockExecute = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { execute: mockExecute },
}));

// ── Mock pbkdf2Django ──────────────────────────────────────────────────────────
jest.mock('../../src/utils/pbkdf2Django', () => ({
  hashPasswordDjango: jest.fn(() => 'pbkdf2_sha256$600000$fakesalt$fakehash'),
  verifyPasswordDjango: jest.fn(() => true),
}));

const { findByEmail, findById, updateLastLogin, updatePassword } =
  require('../../src/models/usuario');

beforeEach(() => jest.clearAllMocks());

// ── findByEmail ────────────────────────────────────────────────────────────────
describe('findByEmail', () => {
  test('retorna usuario existente', async () => {
    const fakeUser = { id: 1, email: 'ana@texpro.cl', nombre: 'Ana', is_active: 1 };
    mockExecute.mockResolvedValueOnce([[fakeUser]]);

    const result = await findByEmail('ana@texpro.cl');
    expect(result).toEqual(fakeUser);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('WHERE email = ?'),
      ['ana@texpro.cl']
    );
  });

  test('retorna null para email inexistente', async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    const result = await findByEmail('noexiste@texpro.cl');
    expect(result).toBeNull();
  });

  test('propaga error si la BD falla', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB error'));
    await expect(findByEmail('x@x.cl')).rejects.toThrow('DB error');
  });
});

// ── findById ───────────────────────────────────────────────────────────────────
describe('findById', () => {
  test('retorna perfil de usuario por ID', async () => {
    const fakeUser = { id: 1, nombre: 'Ana', email: 'ana@texpro.cl', is_active: 1 };
    mockExecute.mockResolvedValueOnce([[fakeUser]]);
    const result = await findById(1);
    expect(result).toEqual(fakeUser);
  });

  test('retorna null si el ID no existe', async () => {
    mockExecute.mockResolvedValueOnce([[]]);
    expect(await findById(999)).toBeNull();
  });
});

// ── updateLastLogin ────────────────────────────────────────────────────────────
describe('updateLastLogin', () => {
  test('retorna true si afectó filas', async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    expect(await updateLastLogin(1)).toBe(true);
  });

  test('retorna false si no afectó filas', async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await updateLastLogin(999)).toBe(false);
  });
});

// ── updatePassword ─────────────────────────────────────────────────────────────
describe('updatePassword', () => {
  test('actualiza hash correctamente y retorna true', async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }]);
    const result = await updatePassword('ana@texpro.cl', 'nuevaClave123');
    expect(result).toBe(true);
    // Verifica que se usó el hash generado por pbkdf2Django
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SET password = ?'),
      ['pbkdf2_sha256$600000$fakesalt$fakehash', 'ana@texpro.cl']
    );
  });

  test('retorna false si el usuario no existe o está inactivo', async () => {
    mockExecute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    expect(await updatePassword('noexiste@texpro.cl', 'clave123')).toBe(false);
  });
});
