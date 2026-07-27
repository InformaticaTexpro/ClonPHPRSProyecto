'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 7, id: 7, nombre: 'Claudia Rincones', area: 'ventas', is_admin: 0 };
    next();
  },
}));

jest.mock('../../src/models/mensajeria', () => ({
  getDirectory: jest.fn(),
  listConversations: jest.fn(),
  listConversationMessages: jest.fn(),
  createConversation: jest.fn(),
  createMessage: jest.fn(),
  markConversationRead: jest.fn(),
  countUnread: jest.fn(),
  updateConversationFlag: jest.fn(),
}));

const mensajeriaModel = require('../../src/models/mensajeria');
const mensajeriaRouter = require('../../src/routes/mensajeria');

const app = express();
app.use(express.json());
app.use('/api/mensajeria', mensajeriaRouter);

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  console.error.mockRestore();
});

describe('GET /api/mensajeria/directorio', () => {
  test('devuelve usuarios y áreas activas', async () => {
    mensajeriaModel.getDirectory.mockResolvedValueOnce({
      usuarios: [{ id: 11, nombre: 'Ana', email: 'ana@texpro.cl', area: 'ventas' }],
      areas: [{ codigo: 'ventas', nombre: 'ventas' }],
    });

    const res = await request(app).get('/api/mensajeria/directorio');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.usuarios).toHaveLength(1);
    expect(mensajeriaModel.getDirectory).toHaveBeenCalledWith(expect.anything(), 7);
  });
});

describe('GET /api/mensajeria/conversaciones', () => {
  test('lista conversaciones del usuario autenticado', async () => {
    mensajeriaModel.listConversations.mockResolvedValueOnce([
      {
        id: 1,
        tipo: 'directa',
        titulo: '',
        area_codigo: '',
        participantes: [{ usuario_id: 7, usuario: { nombre: 'Claudia Rincones' } }],
        ultimo_mensaje: { cuerpo: 'Hola', created_at: '2026-07-27T10:00:00Z', remitente_id: 7 },
        no_leidos: 0,
      },
    ]);

    const res = await request(app).get('/api/mensajeria/conversaciones');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(mensajeriaModel.listConversations).toHaveBeenCalledWith(expect.anything(), 7, { includeArchived: false });
  });
});

describe('POST /api/mensajeria/conversaciones', () => {
  test('crea una conversación directa', async () => {
    mensajeriaModel.createConversation.mockResolvedValueOnce({
      id: 99,
      tipo: 'directa',
      participantes: [
        { usuario_id: 7, usuario: { nombre: 'Claudia Rincones' } },
        { usuario_id: 11, usuario: { nombre: 'Ana' } },
      ],
    });

    const res = await request(app)
      .post('/api/mensajeria/conversaciones')
      .send({ tipo: 'directa', usuario_id: 11 });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(mensajeriaModel.createConversation).toHaveBeenCalledWith(expect.anything(), 7, { tipo: 'directa', usuario_id: 11 });
  });
});

describe('GET /api/mensajeria/conversaciones/:id/mensajes', () => {
  test('bloquea ver una conversación ajena', async () => {
    mensajeriaModel.listConversationMessages.mockRejectedValueOnce(Object.assign(new Error('No tienes acceso a esta conversación'), { status: 403 }));

    const res = await request(app).get('/api/mensajeria/conversaciones/33/mensajes');

    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });
});

describe('POST /api/mensajeria/conversaciones/:id/mensajes', () => {
  test('envía un mensaje con texto válido', async () => {
    mensajeriaModel.createMessage.mockResolvedValueOnce({
      id: 123,
      conversacion_id: 5,
      remitente_id: 7,
      cuerpo: 'Hola equipo',
      tipo: 'texto',
    });

    const res = await request(app)
      .post('/api/mensajeria/conversaciones/5/mensajes')
      .send({ cuerpo: '  Hola equipo  ' });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(mensajeriaModel.createMessage).toHaveBeenCalledWith(expect.anything(), 5, 7, 'Hola equipo', 'texto');
  });
});

describe('PATCH /api/mensajeria/conversaciones/:id/leido', () => {
  test('marca el hilo como leído', async () => {
    mensajeriaModel.markConversationRead.mockResolvedValueOnce({ conversacion_id: 5, ultimo_leido_mensaje_id: 999 });

    const res = await request(app).patch('/api/mensajeria/conversaciones/5/leido');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mensajeriaModel.markConversationRead).toHaveBeenCalledWith(expect.anything(), 5, 7);
  });
});

describe('GET /api/mensajeria/no-leidos', () => {
  test('devuelve el total de mensajes no leídos', async () => {
    mensajeriaModel.countUnread.mockResolvedValueOnce({ conversaciones: 2, total: 6 });

    const res = await request(app).get('/api/mensajeria/no-leidos');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.total).toBe(6);
    expect(res.body.data.conversaciones).toBe(2);
  });
});

describe('PATCH /api/mensajeria/conversaciones/:id/archivar y /silenciar', () => {
  test('permite archivar un hilo', async () => {
    mensajeriaModel.updateConversationFlag.mockResolvedValueOnce({ conversacion_id: 5, archivada: true });

    const res = await request(app).patch('/api/mensajeria/conversaciones/5/archivar').send({ archivada: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mensajeriaModel.updateConversationFlag).toHaveBeenCalledWith(expect.anything(), 5, 7, 'archivada', true);
  });

  test('permite silenciar un hilo', async () => {
    mensajeriaModel.updateConversationFlag.mockResolvedValueOnce({ conversacion_id: 5, silenciada: true });

    const res = await request(app).patch('/api/mensajeria/conversaciones/5/silenciar').send({ silenciada: true });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mensajeriaModel.updateConversationFlag).toHaveBeenCalledWith(expect.anything(), 5, 7, 'silenciada', true);
  });
});
