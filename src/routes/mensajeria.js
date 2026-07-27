'use strict';

const express = require('express');
const db = require('../config/db');
const { requireAuth } = require('../middlewares/requireAuth');
const mensajeriaModel = require('../models/mensajeria');

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

router.patch('/conversaciones/:id/archivar', async (req, res) => {
  try {
    const conversacionId = parseId(req.params.id, 'Conversación');
    const archivada = asBoolean(req.body?.archivada, true);
    const data = await mensajeriaModel.updateConversationFlag(db.pool, conversacionId, req.usuario.sub, 'archivada', archivada);
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
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[PATCH /api/mensajeria/conversaciones/:id/silenciar]', error.message);
    res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : 'Error al silenciar conversación' });
  }
});

module.exports = router;
