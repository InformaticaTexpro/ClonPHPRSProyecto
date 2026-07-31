'use strict';
/**
 * tests/routes/auth.test.js
 *
 * Pruebas para los endpoints de /api/auth:
 *   POST /login, GET /me, POST /logout
 */

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-auth';
process.env.JWT_EXPIRES_IN = '8h';

const mockDbQuery = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { query: mockDbQuery },
}));

jest.mock('../../src/utils/pbkdf2Django', () => ({
  parseDjangoHash: jest.requireActual('../../src/utils/pbkdf2Django').parseDjangoHash,
  verifyPasswordDjango: jest.fn(),
  hashPasswordDjango: jest.fn(() => 'fakehash'),
}));

jest.mock('../../src/models/usuario', () => ({
  updateLastLogin: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, nombre: 'Ana' };
    next();
  },
}));

const { verifyPasswordDjango } = require('../../src/utils/pbkdf2Django');
const authRouter = require('../../src/routes/auth');
const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);

beforeEach(() => jest.clearAllMocks());

describe('POST /api/auth/login', () => {
  const fakeUser = {
    id: 1,
    email: 'ana@texpro.cl',
    nombre: 'Ana',
    password: 'pbkdf2_sha256$600000$saltABC$AAABBBCCC=',
    area: 'Ventas',
    is_admin: 0,
    is_active: 1,
  };

  const fakeMenus = [
    { id: 1, codigo: 'dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', grupo: 'Ventas', orden: 1 },
    { id: 2, codigo: 'ventas-asignadas', nombre: 'Ventas Asignadas', url: '/src/modulo/ventas/ventas/index.html', icono: '🤝', grupo: 'Ventas', orden: 2 },
    { id: 3, codigo: 'historial-cliente', nombre: 'Historial Cliente', url: '/src/modulo/ventas/historial-cliente/index.html', icono: '📋', grupo: 'Ventas', orden: 3 },
  ];

  const fakeProfiles = [
    { id: 1, codigo: 'ventas', nombre: 'Ventas', descripcion: 'Base ventas', area: 'ventas', es_base: 1, activo: 1 },
  ];

  test('devuelve token con credenciales válidas', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[fakeUser]])
      .mockResolvedValueOnce([[{ cod_vendedor: 'V001', tipo: 'P' }]])
      .mockResolvedValueOnce([fakeMenus])
      .mockResolvedValueOnce([fakeProfiles])
      .mockResolvedValueOnce([fakeMenus]);
    verifyPasswordDjango.mockReturnValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '  ANA@TEXPRO.CL ', password: 'correcta123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).toHaveProperty('token');
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.email).toBe('ana@texpro.cl');
    expect(decoded.id).toBe(1);
    expect(decoded.sub).toBe(1);
    expect(res.body.user.id).toBe(1);
    expect(res.body.user.menus).toHaveLength(3);
    expect(res.body.allMenus).toHaveLength(3);
  });

  test('acepta nombre de usuario además de email', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[fakeUser]])
      .mockResolvedValueOnce([[{ cod_vendedor: 'V001', tipo: 'P' }]])
      .mockResolvedValueOnce([fakeMenus])
      .mockResolvedValueOnce([fakeProfiles])
      .mockResolvedValueOnce([fakeMenus]);
    verifyPasswordDjango.mockReturnValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: 'Ana', password: 'correcta123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.nombre).toBe('Ana');
  });

  test('acepta código de usuario además de email y nombre', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[{ ...fakeUser, codigo: '629' }]])
      .mockResolvedValueOnce([[{ cod_vendedor: 'V001', tipo: 'P' }]])
      .mockResolvedValueOnce([fakeMenus])
      .mockResolvedValueOnce([fakeProfiles])
      .mockResolvedValueOnce([fakeMenus]);
    verifyPasswordDjango.mockReturnValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ usuario: ' 629 ', password: 'correcta123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.nombre).toBe('Ana');
  });

  test('devuelve 401 con contraseña incorrecta', async () => {
    mockDbQuery.mockResolvedValueOnce([[fakeUser]]);
    verifyPasswordDjango.mockReturnValueOnce(false);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@texpro.cl', password: 'incorrecta' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('devuelve 401 si el hash de contraseña está vacío o null', async () => {
    mockDbQuery.mockResolvedValueOnce([[{ ...fakeUser, password: null }]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@texpro.cl', password: 'correcta123' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(verifyPasswordDjango).not.toHaveBeenCalled();
  });

  test('devuelve 401 si el hash tiene formato no soportado sin hacer crash', async () => {
    mockDbQuery.mockResolvedValueOnce([[{ ...fakeUser, password: 'bcrypt$12$salt$hash' }]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@texpro.cl', password: 'correcta123' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(verifyPasswordDjango).not.toHaveBeenCalled();
  });

  test('devuelve 401 si el usuario no existe', async () => {
    mockDbQuery.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'noexiste@texpro.cl', password: 'cualquiera' });
    expect(res.status).toBe(401);
  });

  test('devuelve 401 si el usuario está inactivo', async () => {
    mockDbQuery.mockResolvedValueOnce([[{ ...fakeUser, is_active: 0 }]]);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ana@texpro.cl', password: 'correcta123' });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(verifyPasswordDjango).not.toHaveBeenCalled();
  });

  test('devuelve 400 si faltan email o password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '' });
    expect(res.status).toBe(400);
  });

  test('incluye menus de RRHH en user.menus y allMenus cuando el perfil los concede', async () => {
    const rrhhUser = {
      id: 8,
      email: 'rrhh@texpro.cl',
      nombre: 'Rosa RRHH',
      password: 'pbkdf2_sha256$600000$saltABC$AAABBBCCC=',
      area: 'RRHH',
      is_admin: 0,
      is_active: 1,
    };
    const rrhhMenus = [
      { id: 20, codigo: 'rrhh', nombre: 'RRHH', url: '/src/modulo/rrhh/rrhh/index.html', icono: '👥', grupo: 'RRHH', orden: 1 },
      { id: 21, codigo: 'rrhh_reportes_compartidos', nombre: 'Reportes ventas compartidas', url: '/src/modulo/rrhh/reportes-compartidos/index.html', icono: '📄', grupo: 'RRHH', orden: 2 },
    ];
    const rrhhProfiles = [
      { id: 7, codigo: 'rrhh', nombre: 'RRHH', descripcion: 'Base rrhh', area: 'rrhh', es_base: 1, activo: 1 },
    ];

    mockDbQuery
      .mockResolvedValueOnce([[rrhhUser]])
      .mockResolvedValueOnce([[{ cod_vendedor: 'V008', tipo: 'P' }]])
      .mockResolvedValueOnce([rrhhMenus])
      .mockResolvedValueOnce([rrhhProfiles])
      .mockResolvedValueOnce([rrhhMenus]);
    verifyPasswordDjango.mockReturnValueOnce(true);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rrhh@texpro.cl', password: 'correcta123' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.menus).toHaveLength(2);
    expect(res.body.allMenus).toHaveLength(2);
    expect(res.body.user.menus.map(menu => menu.codigo)).toEqual(
      expect.arrayContaining(['rrhh', 'rrhh_reportes_compartidos'])
    );
  });
});

describe('GET /api/auth/me', () => {
  test('devuelve perfil con token válido', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[{ id: 1, email: 'ana@texpro.cl', nombre: 'Ana', is_active: 1, is_admin: 0 }]])
      .mockResolvedValueOnce([[{ cod_vendedor: 'V001', tipo: 'P' }]])
      .mockResolvedValueOnce([[{ id: 1, codigo: 'dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', grupo: 'Ventas', orden: 1 }]])
      .mockResolvedValueOnce([[{ id: 1, codigo: 'ventas', nombre: 'Ventas', descripcion: 'Base ventas', area: 'ventas', es_base: 1, activo: 1 }]])
      .mockResolvedValueOnce([[{ id: 2, codigo: 'ventas-asignadas', nombre: 'Ventas Asignadas', url: '/src/modulo/ventas/ventas/index.html', icono: '🤝', grupo: 'Ventas', orden: 2 }]]);

    const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toHaveProperty('email');
    expect(res.body.user.menus).toHaveLength(1);
    expect(res.body.allMenus).toHaveLength(1);
  });

  test('retorna 500 si la BD falla', async () => {
    mockDbQuery.mockRejectedValueOnce(new Error('DB error'));
    const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(500);
  });

  test('devuelve menus RRHH en me cuando el usuario tiene perfil rrhh', async () => {
    mockDbQuery
      .mockResolvedValueOnce([[{ id: 8, email: 'rrhh@texpro.cl', nombre: 'Rosa RRHH', area: 'rrhh', is_admin: 0, is_active: 1 }]])
      .mockResolvedValueOnce([[{ cod_vendedor: 'V008', tipo: 'P' }]])
      .mockResolvedValueOnce([[{ id: 20, codigo: 'rrhh', nombre: 'RRHH', url: '/src/modulo/rrhh/rrhh/index.html', icono: '👥', grupo: 'RRHH', orden: 1 }]])
      .mockResolvedValueOnce([[{ id: 7, codigo: 'rrhh', nombre: 'RRHH', descripcion: 'Base rrhh', area: 'rrhh', es_base: 1, activo: 1 }]])
      .mockResolvedValueOnce([[{ id: 20, codigo: 'rrhh', nombre: 'RRHH', url: '/src/modulo/rrhh/rrhh/index.html', icono: '👥', grupo: 'RRHH', orden: 1 }]]);

    const token = jwt.sign({ sub: 8 }, process.env.JWT_SECRET);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.menus).toHaveLength(1);
    expect(res.body.allMenus).toHaveLength(1);
    expect(res.body.user.menus[0].codigo).toBe('rrhh');
    expect(res.body.user.menus[0].grupo).toBe('RRHH');
  });
});

describe('POST /api/auth/logout', () => {
  test('devuelve ok:true', async () => {
    const token = jwt.sign({ sub: 1 }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
