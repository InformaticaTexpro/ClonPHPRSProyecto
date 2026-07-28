'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middlewares/requireAuth');
const mensajeriaModel = require('../models/mensajeria');
const socketHub = require('../realtime/socketHub');

const router = express.Router();

router.use(requireAuth);

function asBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'si', 'sí', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseId(value, label = 'ID') {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error(`${label} inválido`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

async function getConversationParticipantIds(conversacionId) {
  const [rows] = await db.pool.query(
    `SELECT usuario_id
     FROM conversacion_participante
     WHERE conversacion_id = ?`,
    [conversacionId]
  );
  return rows.map(row => Number(row.usuario_id)).filter(id => Number.isFinite(id) && id > 0);
}

async function emitUnreadSnapshotForUsers(userIds) {
  if (!socketHub.getIO()) return;
  const uniqueIds = Array.from(new Set((userIds || []).map(Number).filter(id => Number.isFinite(id) && id > 0)));
  await Promise.all(uniqueIds.map(async userId => {
    const total = await mensajeriaModel.countUnread(db.pool, userId);
    socketHub.emitToUser(userId, 'chat:unread:update', {
      total_no_leidos: Number(total.total || 0),
      conversaciones_no_leidas: Number(total.conversaciones || 0),
    });
  }));
}

async function emitConversationUpdate(conversacionId, conversation, participantIds) {
  if (!socketHub.getIO()) return;
  socketHub.emitToUsers(participantIds, 'chat:conversation:update', {
    conversacion_id: Number(conversacionId),
    conversacion: conversation || null,
  });
  await emitUnreadSnapshotForUsers(participantIds);
}

async function emitNewMessage(conversacionId, message, participantIds) {
  if (!socketHub.getIO()) return;
  socketHub.emitToUsers(participantIds, 'chat:message:new', {
    conversacion_id: Number(conversacionId),
    mensaje: message,
    remitente: {
      id: message?.remitente_id || null,
      nombre: message?.remitente_nombre || '',
      email: message?.remitente_email || '',
      area: message?.remitente_area || '',
    },
    created_at: message?.created_at || null,
  });
  await emitUnreadSnapshotForUsers(participantIds);
}

router.get('/directorio', async (req, res) => {
  try {
    const data = await mensajeriaModel.getDirectory(db.pool, req.usuario.sub);
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[GET /api/mensajeria/directorio]', error.message);
    res.status(error.status || 500).json({ ok: false, error: 'Error al obtener directorio' });
  }
});

router.get('/conversaciones', async (req, res) => {
  try {
    const includeArchived = asBoolean(req.query.incluir_archivadas, false);
    const data = await mensajeriaModel.listConversations(db.pool, req.usuario.sub, { includeArchived });
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[GET /api/mensajeria/conversaciones]', error.message);
    res.status(error.status || 500).json({ ok: false, error: 'Error al obtener conversaciones' });
  }
});

router.get('/conversaciones/:id/mensajes', async (req, res) => {
  try {
    const conversacionId = parseId(req.params.id, 'Conversación');
    const data = await mensajeriaModel.listConversationMessages(db.pool, conversacionId, req.usuario.sub);
    if (!data) {
      return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
    }
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[GET /api/mensajeria/conversaciones/:id/mensajes]', error.message);
    res.status(error.status || 500).json({ ok: false, error: 'Error al obtener mensajes' });
  }
});

router.post('/conversaciones', async (req, res) => {
  try {
    const data = await mensajeriaModel.createConversation(db.pool, req.usuario.sub, req.body || {});
    const participantIds = Array.isArray(data?.conversacion?.participantes)
      ? data.conversacion.participantes.map(part => Number(part.usuario_id)).filter(id => Number.isFinite(id) && id > 0)
      : [Number(req.usuario.sub)].filter(id => Number.isFinite(id) && id > 0);
    emitConversationUpdate(data?.conversacion?.id, data?.conversacion, participantIds).catch(err => {
      console.warn('[mensajeria] no se pudo emitir createConversation:', err.message);
    });
    res.status(201).json({ ok: true, data });
  } catch (error) {
    console.error('[POST /api/mensajeria/conversaciones]', error.message);
    res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : 'Error al crear conversación' });
  }
});

router.post('/conversaciones/:id/mensajes', async (req, res) => {
  try {
    const conversacionId = parseId(req.params.id, 'Conversación');
    const cuerpo = String(req.body?.cuerpo ?? '').trim();
    const tipo = String(req.body?.tipo ?? 'texto').trim();

    if (!cuerpo) {
      return res.status(400).json({ ok: false, error: 'El mensaje no puede estar vacío' });
    }

    const data = await mensajeriaModel.createMessage(db.pool, conversacionId, req.usuario.sub, cuerpo, tipo);
    getConversationParticipantIds(conversacionId)
      .then(participantIds => emitNewMessage(conversacionId, data, participantIds))
      .catch(err => console.warn('[mensajeria] no se pudo emitir createMessage:', err.message));
    res.status(201).json({ ok: true, data });
  } catch (error) {
    console.error('[POST /api/mensajeria/conversaciones/:id/mensajes]', error.message);
    res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : 'Error al enviar mensaje' });
  }
});

router.patch('/conversaciones/:id/leido', async (req, res) => {
  try {
    const conversacionId = parseId(req.params.id, 'Conversación');
    const data = await mensajeriaModel.markConversationRead(db.pool, conversacionId, req.usuario.sub);
    if (socketHub.getIO()) {
      const total = await mensajeriaModel.countUnread(db.pool, req.usuario.sub);
      socketHub.emitToUser(req.usuario.sub, 'chat:unread:update', {
        total_no_leidos: Number(total.total || 0),
        conversaciones_no_leidas: Number(total.conversaciones || 0),
      });
    }
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[PATCH /api/mensajeria/conversaciones/:id/leido]', error.message);
    res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : 'Error al marcar como leído' });
  }
});

router.get('/no-leidos', async (req, res) => {
  try {
    const data = await mensajeriaModel.countUnread(db.pool, req.usuario.sub);
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[GET /api/mensajeria/no-leidos]', error.message);
    res.status(error.status || 500).json({ ok: false, error: 'Error al contar mensajes no leídos' });
  }
});

router.get('/usuarios-online', async (_req, res) => {
  try {
    res.json({
      ok: true,
      online: socketHub.getConnectedUserIds(),
    });
  } catch (error) {
    console.error('[GET /api/mensajeria/usuarios-online]', error.message);
    res.status(500).json({ ok: false, error: 'Error al obtener usuarios conectados' });
  }
});

router.patch('/conversaciones/:id/archivar', async (req, res) => {
  try {
    const conversacionId = parseId(req.params.id, 'Conversación');
    const archivada = asBoolean(req.body?.archivada, true);
    const data = await mensajeriaModel.updateConversationFlag(db.pool, conversacionId, req.usuario.sub, 'archivada', archivada);
    if (socketHub.getIO()) {
      const total = await mensajeriaModel.countUnread(db.pool, req.usuario.sub);
      socketHub.emitToUser(req.usuario.sub, 'chat:conversation:update', {
        conversacion_id: conversacionId,
        flag: 'archivada',
        data,
      });
      socketHub.emitToUser(req.usuario.sub, 'chat:unread:update', {
        total_no_leidos: Number(total.total || 0),
        conversaciones_no_leidas: Number(total.conversaciones || 0),
      });
    }
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[PATCH /api/mensajeria/conversaciones/:id/archivar]', error.message);
    res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : 'Error al archivar conversación' });
  }
});

router.patch('/conversaciones/:id/silenciar', async (req, res) => {
  try {
    const conversacionId = parseId(req.params.id, 'Conversación');
    const silenciada = asBoolean(req.body?.silenciada, true);
    const data = await mensajeriaModel.updateConversationFlag(db.pool, conversacionId, req.usuario.sub, 'silenciada', silenciada);
    if (socketHub.getIO()) {
      const total = await mensajeriaModel.countUnread(db.pool, req.usuario.sub);
      socketHub.emitToUser(req.usuario.sub, 'chat:conversation:update', {
        conversacion_id: conversacionId,
        flag: 'silenciada',
        data,
      });
      socketHub.emitToUser(req.usuario.sub, 'chat:unread:update', {
        total_no_leidos: Number(total.total || 0),
        conversaciones_no_leidas: Number(total.conversaciones || 0),
      });
    }
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[PATCH /api/mensajeria/conversaciones/:id/silenciar]', error.message);
    res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : 'Error al silenciar conversación' });
  }
});

module.exports = router;
