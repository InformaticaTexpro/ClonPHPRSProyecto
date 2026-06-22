'use strict';

/**
 * tests/middlewares/requireAuth.test.js
 *
 * Pruebas unitarias para src/middlewares/requireAuth.js
 * Cubre: requireAuth y requireAdmin
 *
 * Estrategia de aislamiento:
 *   - Se mockea '../models/usuario' para que getVendedoresByUsuarioId
 *     no necesite conexión a BD.
 *   - Se usa jest.mock con factory antes del require del middleware.
 */

const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test_secret_de_32_chars_para_ci!';
process.env.JWT_SECRET     = TEST_SECRET;
process.env.JWT_EXPIRES_IN = '1h';

// ── Mock del modelo usuario (sin BD) ─────────────────────────────
jest.mock('../../src/models/usuario', () => ({
  getVendedoresByUsuarioId: jest.fn().mockResolvedValue([
    { cod_vendedor: 'V001', tipo: 'C' }
  ])
}));

const { requireAuth, requireAdmin } = require('../../src/middlewares/requireAuth');
const { getVendedoresByUsuarioId }  = require('../../src/models/usuario');

// ── Helpers de request/response mock ─────────────────────────────
function buildReq(authHeader = '') {
  return { headers: { authorization: authHeader } };
}

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

// ── Token de prueba ───────────────────────────────────────────────
function tokenValido(payload = {}) {
  return jwt.sign(
    { sub: 7, email: 'u@texpro.cl', is_admin: false, vendedores: [], area: '', ...payload },
    TEST_SECRET,
    { expiresIn: '1h' }
  );
}

// ─────────────────────────────────────────────────────────────────
describe('requireAuth', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    getVendedoresByUsuarioId.mockResolvedValue([{ cod_vendedor: 'V001', tipo: 'C' }]);
  });

  test('responde 401 cuando no hay header Authorization', async () => {
    const req  = buildReq();
    const res  = buildRes();
    const next = jest.fn();
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(next).not.toHaveBeenCalled();
  });

  test('responde 401 cuando Authorization no empieza con Bearer', async () => {
    const req  = buildReq('Basic dXNlcjpwYXNz');
    const res  = buildRes();
    const next = jest.fn();
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('responde 401 cuando el token tiene firma inválida', async () => {
    const tokenFalso = jwt.sign({ sub: 1 }, 'clave_incorrecta', { expiresIn: '1h' });
    const req  = buildReq(`Bearer ${tokenFalso}`);
    const res  = buildRes();
    const next = jest.fn();
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: 'Token inválido.' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('responde 401 con mensaje específico cuando el token está expirado', async () => {
    const tokenExpirado = jwt.sign({ sub: 1 }, TEST_SECRET, { expiresIn: -1 });
    const req  = buildReq(`Bearer ${tokenExpirado}`);
    const res  = buildRes();
    const next = jest.fn();
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: expect.stringContaining('expirado') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('llama next() con token válido y enriquece req.usuario', async () => {
    const token = tokenValido({ sub: 7 });
    const req   = buildReq(`Bearer ${token}`);
    const res   = buildRes();
    const next  = jest.fn();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.usuario).toBeDefined();
    expect(req.usuario.sub).toBe(7);
    expect(req.usuario.id).toBe(7);
    expect(req.usuario.email).toBe('u@texpro.cl');
  });

  test('acepta token legado con id y sin sub', async () => {
    const token = jwt.sign(
      { id: 9, email: 'legacy@texpro.cl', is_admin: false, vendedores: [] },
      TEST_SECRET,
      { expiresIn: '1h' }
    );
    const req   = buildReq(`Bearer ${token}`);
    const res   = buildRes();
    const next  = jest.fn();
    await requireAuth(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.usuario.id).toBe(9);
    expect(req.usuario.sub).toBe(9);
    expect(getVendedoresByUsuarioId).toHaveBeenCalledWith(9);
  });

  test('req.usuario.vendedores proviene de la BD (no del JWT)', async () => {
    const vendedoresBD = [{ cod_vendedor: 'V999', tipo: 'G' }];
    getVendedoresByUsuarioId.mockResolvedValue(vendedoresBD);
    const token = tokenValido({ sub: 7, vendedores: [{ cod_vendedor: 'OLD', tipo: 'C' }] });
    const req   = buildReq(`Bearer ${token}`);
    const res   = buildRes();
    const next  = jest.fn();
    await requireAuth(req, res, next);
    expect(req.usuario.vendedores).toEqual(vendedoresBD);
  });

  test('llama getVendedoresByUsuarioId con el sub del payload', async () => {
    const token = tokenValido({ sub: 55 });
    const req   = buildReq(`Bearer ${token}`);
    await requireAuth(req, buildRes(), jest.fn());
    expect(getVendedoresByUsuarioId).toHaveBeenCalledWith(55);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('requireAdmin', () => {

  test('responde 403 cuando req.usuario.is_admin es false', () => {
    const req  = { usuario: { is_admin: false } };
    const res  = buildRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(next).not.toHaveBeenCalled();
  });

  test('responde 403 cuando req.usuario es undefined', () => {
    const req  = {};
    const res  = buildRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('llama next() cuando req.usuario.is_admin es true', () => {
    const req  = { usuario: { is_admin: true } };
    const res  = buildRes();
    const next = jest.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
