'use strict';

const { pool } = require('../config/db');

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeType(value) {
  const text = normalizeText(value).toLowerCase();
  if (['directa', 'direct', 'dm'].includes(text)) return 'directa';
  if (['grupo', 'group'].includes(text)) return 'grupo';
  if (['area', 'área'].includes(text)) return 'area';
  if (['sistema', 'system'].includes(text)) return 'sistema';
  return null;
}

function buildPlaceholders(values) {
  return values.map(() => '?').join(', ');
}

function mapUsuario(row) {
  return {
    id: Number(row.id),
    nombre: row.nombre || '',
    email: row.email || '',
    area: row.area || '',
    is_admin: Boolean(Number(row.is_admin)),
    is_active: Boolean(Number(row.is_active)),
  };
}

function mapParticipante(row) {
  return {
    usuario_id: Number(row.usuario_id),
    rol: row.rol || 'miembro',
    silenciada: Boolean(Number(row.silenciada)),
    archivada: Boolean(Number(row.archivada)),
    ultimo_leido_mensaje_id: row.ultimo_leido_mensaje_id !== null && row.ultimo_leido_mensaje_id !== undefined
      ? Number(row.ultimo_leido_mensaje_id)
      : null,
    created_at: row.created_at || null,
    usuario: {
      id: Number(row.usuario_id),
      nombre: row.nombre || '',
      email: row.email || '',
      area: row.area || '',
      is_active: Boolean(Number(row.is_active)),
    },
  };
}

function mapMensaje(row) {
  return {
    id: Number(row.id),
    conversacion_id: Number(row.conversacion_id),
    remitente_id: Number(row.remitente_id),
    remitente_nombre: row.remitente_nombre || '',
    remitente_email: row.remitente_email || '',
    remitente_area: row.remitente_area || '',
    cuerpo: row.cuerpo || '',
    tipo: row.tipo || 'texto',
    eliminado: Boolean(Number(row.eliminado)),
    created_at: row.created_at || null,
    editado_at: row.editado_at || null,
  };
}

function mapConversacionBase(row) {
  return {
    id: Number(row.id),
    tipo: row.tipo || 'directa',
    titulo: row.titulo || '',
    area_codigo: row.area_codigo || '',
    creado_por: Number(row.creado_por),
    activo: Boolean(Number(row.activo)),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function withConnection(work) {
  if (typeof pool.getConnection === 'function') {
    const conn = await pool.getConnection();
    try {
      return await work(conn);
    } finally {
      if (typeof conn.release === 'function') conn.release();
    }
  }

  return work({
    query: (...args) => pool.query(...args),
    execute: (...args) => pool.execute(...args),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  });
}

async function withTransaction(work) {
  return withConnection(async conn => {
    if (typeof conn.beginTransaction === 'function') {
      await conn.beginTransaction();
    }
    try {
      const result = await work(conn);
      if (typeof conn.commit === 'function') {
        await conn.commit();
      }
      return result;
    } catch (error) {
      if (typeof conn.rollback === 'function') {
        try {
          await conn.rollback();
        } catch {
          // Sin rollback secundario.
        }
      }
      throw error;
    }
  });
}

async function getDirectory(conn, usuarioId) {
  const [usuarios] = await conn.query(
    `SELECT id, nombre, email, area, is_admin, is_active
     FROM usuario
     WHERE is_active = 1
     ORDER BY area ASC, nombre ASC`
  );

  const [areas] = await conn.query(
    `SELECT DISTINCT TRIM(COALESCE(area, '')) AS area
     FROM usuario
     WHERE is_active = 1
       AND TRIM(COALESCE(area, '')) <> ''
     ORDER BY area ASC`
  );

  return {
    usuarios: usuarios
      .map(mapUsuario)
      .filter(usuario => Number(usuario.id) !== Number(usuarioId)),
    areas: areas.map(row => ({
      codigo: row.area || '',
      nombre: row.area || '',
    })),
  };
}

async function findParticipant(conn, conversacionId, usuarioId) {
  const [rows] = await conn.query(
    `SELECT conversacion_id, usuario_id, rol, silenciada, archivada, ultimo_leido_mensaje_id, created_at
     FROM conversacion_participante
     WHERE conversacion_id = ? AND usuario_id = ?
     LIMIT 1`,
    [conversacionId, usuarioId]
  );
  return rows[0] ? mapParticipante({
    ...rows[0],
    nombre: '',
    email: '',
    area: '',
    is_active: 1,
  }) : null;
}

async function findConversation(conn, conversacionId, usuarioId = null) {
  const queryParams = usuarioId !== null && usuarioId !== undefined
    ? [usuarioId, conversacionId]
    : [conversacionId];
  const [rows] = await conn.query(
    `SELECT c.id, c.tipo, c.titulo, c.area_codigo, c.creado_por, c.activo, c.created_at, c.updated_at,
            cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id
     FROM conversacion c
     ${usuarioId !== null && usuarioId !== undefined
       ? 'INNER JOIN conversacion_participante cp ON cp.conversacion_id = c.id AND cp.usuario_id = ?'
       : 'LEFT JOIN conversacion_participante cp ON cp.conversacion_id = c.id'}
     WHERE c.id = ?
     LIMIT 1`,
    queryParams
  );
  return rows[0] ? {
    ...mapConversacionBase(rows[0]),
    rol: rows[0].rol || 'miembro',
    silenciada: Boolean(Number(rows[0].silenciada)),
    archivada: Boolean(Number(rows[0].archivada)),
    ultimo_leido_mensaje_id: rows[0].ultimo_leido_mensaje_id !== null && rows[0].ultimo_leido_mensaje_id !== undefined
      ? Number(rows[0].ultimo_leido_mensaje_id)
      : null,
  } : null;
}

async function findDirectConversation(conn, usuarioId, destinatarioId) {
  const [rows] = await conn.query(
    `SELECT c.id
     FROM conversacion c
     INNER JOIN conversacion_participante cp ON cp.conversacion_id = c.id
     WHERE c.tipo = 'directa'
       AND c.activo = 1
     GROUP BY c.id
     HAVING COUNT(*) = 2
        AND SUM(cp.usuario_id = ?) = 1
        AND SUM(cp.usuario_id = ?) = 1
     LIMIT 1`,
    [usuarioId, destinatarioId]
  );

  if (!rows[0]) return null;
  return findConversation(conn, rows[0].id, usuarioId);
}

async function loadParticipants(conn, conversacionIds) {
  if (!conversacionIds.length) return new Map();
  const placeholders = buildPlaceholders(conversacionIds);
  const [rows] = await conn.query(
    `SELECT cp.conversacion_id, cp.usuario_id, cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id, cp.created_at,
            u.nombre, u.email, u.area, u.is_active
     FROM conversacion_participante cp
     INNER JOIN usuario u ON u.id = cp.usuario_id
     WHERE cp.conversacion_id IN (${placeholders})
     ORDER BY cp.conversacion_id ASC, cp.rol DESC, u.nombre ASC`,
    conversacionIds
  );

  const map = new Map();
  rows.forEach(row => {
    const key = Number(row.conversacion_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(mapParticipante(row));
  });
  return map;
}

async function loadLastMessages(conn, conversacionIds) {
  if (!conversacionIds.length) return new Map();
  const placeholders = buildPlaceholders(conversacionIds);
  const [rows] = await conn.query(
    `SELECT m.conversacion_id, m.id, m.remitente_id, u.nombre AS remitente_nombre, u.email AS remitente_email,
            u.area AS remitente_area, m.cuerpo, m.tipo, m.eliminado, m.created_at, m.editado_at
     FROM mensaje m
     INNER JOIN (
       SELECT conversacion_id, MAX(id) AS last_message_id
       FROM mensaje
       WHERE eliminado = 0
         AND conversacion_id IN (${placeholders})
       GROUP BY conversacion_id
     ) ultima ON ultima.last_message_id = m.id
     INNER JOIN usuario u ON u.id = m.remitente_id
     ORDER BY m.created_at DESC, m.id DESC`,
    conversacionIds
  );

  const map = new Map();
  rows.forEach(row => {
    map.set(Number(row.conversacion_id), mapMensaje(row));
  });
  return map;
}

async function loadUnreadCounts(conn, usuarioId, conversacionIds) {
  if (!conversacionIds.length) return new Map();
  const placeholders = buildPlaceholders(conversacionIds);
  const [rows] = await conn.query(
    `SELECT m.conversacion_id, COUNT(*) AS total
     FROM mensaje m
     INNER JOIN conversacion_participante cp
       ON cp.conversacion_id = m.conversacion_id
      AND cp.usuario_id = ?
     WHERE m.conversacion_id IN (${placeholders})
       AND m.eliminado = 0
       AND m.remitente_id <> ?
       AND (cp.ultimo_leido_mensaje_id IS NULL OR m.id > cp.ultimo_leido_mensaje_id)
     GROUP BY m.conversacion_id`,
    [usuarioId, ...conversacionIds, usuarioId]
  );

  const map = new Map();
  rows.forEach(row => {
    map.set(Number(row.conversacion_id), Number(row.total || 0));
  });
  return map;
}

async function listConversations(conn, usuarioId, { includeArchived = false } = {}) {
  const params = [usuarioId];
  let sql = `
    SELECT c.id, c.tipo, c.titulo, c.area_codigo, c.creado_por, c.activo, c.created_at, c.updated_at,
           cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id
    FROM conversacion c
    INNER JOIN conversacion_participante cp
      ON cp.conversacion_id = c.id
     AND cp.usuario_id = ?
    WHERE c.activo = 1
  `;
  if (!includeArchived) {
    sql += ' AND cp.archivada = 0';
  }
  sql += ' ORDER BY c.updated_at DESC, c.created_at DESC';

  const [rows] = await conn.query(sql, params);
  const conversations = rows.map(row => ({
    ...mapConversacionBase(row),
    rol: row.rol || 'miembro',
    silenciada: Boolean(Number(row.silenciada)),
    archivada: Boolean(Number(row.archivada)),
    ultimo_leido_mensaje_id: row.ultimo_leido_mensaje_id !== null && row.ultimo_leido_mensaje_id !== undefined
      ? Number(row.ultimo_leido_mensaje_id)
      : null,
  }));

  const ids = conversations.map(item => item.id);
  const [participantsMap, lastMessagesMap, unreadMap] = await Promise.all([
    loadParticipants(conn, ids),
    loadLastMessages(conn, ids),
    loadUnreadCounts(conn, usuarioId, ids),
  ]);

  return conversations.map(conversation => ({
    ...conversation,
    participantes: participantsMap.get(conversation.id) || [],
    ultimo_mensaje: lastMessagesMap.get(conversation.id) || null,
    no_leidos: unreadMap.get(conversation.id) || 0,
  }));
}

async function listConversationMessages(conn, conversacionId, usuarioId) {
  const participant = await findParticipant(conn, conversacionId, usuarioId);
  if (!participant) {
    const error = new Error('No tienes acceso a esta conversación');
    error.status = 403;
    throw error;
  }

  const conversation = await findConversation(conn, conversacionId);
  if (!conversation || !conversation.activo) return null;

  const [rows] = await conn.query(
    `SELECT m.id, m.conversacion_id, m.remitente_id, u.nombre AS remitente_nombre, u.email AS remitente_email,
            u.area AS remitente_area, m.cuerpo, m.tipo, m.eliminado, m.created_at, m.editado_at
     FROM mensaje m
     INNER JOIN usuario u ON u.id = m.remitente_id
     WHERE m.conversacion_id = ?
       AND m.eliminado = 0
     ORDER BY m.created_at ASC, m.id ASC`,
    [conversacionId]
  );

  const [participantsRows] = await conn.query(
    `SELECT cp.conversacion_id, cp.usuario_id, cp.rol, cp.silenciada, cp.archivada, cp.ultimo_leido_mensaje_id, cp.created_at,
            u.nombre, u.email, u.area, u.is_active
     FROM conversacion_participante cp
     INNER JOIN usuario u ON u.id = cp.usuario_id
     WHERE cp.conversacion_id = ?
     ORDER BY cp.rol DESC, u.nombre ASC`,
    [conversacionId]
  );

  return {
    conversacion: {
      ...conversation,
      participantes: participantsRows.map(mapParticipante),
    },
    mensajes: rows.map(mapMensaje),
  };
}

async function createConversation(conn, usuarioId, data = {}) {
  const tipo = normalizeType(data.tipo);
  if (!tipo) {
    const error = new Error('Tipo de conversación inválido');
    error.status = 400;
    throw error;
  }

  const titulo = normalizeText(data.titulo);
  const areaCodigo = normalizeText(data.area_codigo).toLowerCase();
  const participantesIdsRaw = Array.isArray(data.usuario_ids)
    ? data.usuario_ids
    : Array.isArray(data.participantes_ids)
      ? data.participantes_ids
      : data.usuario_id !== undefined && data.usuario_id !== null
        ? [data.usuario_id]
        : [];

  const [creatorRows] = await conn.query(
    `SELECT id, nombre, email, area, is_active
     FROM usuario
     WHERE id = ? AND is_active = 1
     LIMIT 1`,
    [usuarioId]
  );
  const creator = creatorRows[0];
  if (!creator) {
    const error = new Error('Usuario autenticado no disponible');
    error.status = 401;
    throw error;
  }

  let participantesIds = [];
  if (tipo === 'directa') {
    const unique = Array.from(new Set(participantesIdsRaw.map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0 && value !== Number(usuarioId))));
    if (unique.length !== 1) {
      const error = new Error('La conversación directa requiere un único destinatario');
      error.status = 400;
      throw error;
    }
    const destinatarioId = unique[0];
    const [activeUsers] = await conn.query(
      `SELECT id
       FROM usuario
       WHERE id IN (?, ?)
         AND is_active = 1`,
      [usuarioId, destinatarioId]
    );
    const activeUserIds = activeUsers.map(row => Number(row.id));
    if (!activeUserIds.includes(Number(usuarioId)) || !activeUserIds.includes(Number(destinatarioId))) {
      const error = new Error('Uno o más participantes no están activos');
      error.status = 400;
      throw error;
    }

    const existingDirect = await findDirectConversation(conn, usuarioId, destinatarioId);
    if (existingDirect) {
      return existingDirect;
    }

    participantesIds = [Number(usuarioId), destinatarioId];
  } else if (tipo === 'area') {
    if (!areaCodigo) {
      const error = new Error('Debes indicar el área de la conversación');
      error.status = 400;
      throw error;
    }
    const [rows] = await conn.query(
      `SELECT id
       FROM usuario
       WHERE is_active = 1
         AND LOWER(TRIM(COALESCE(area, ''))) = LOWER(TRIM(?))`,
      [areaCodigo]
    );
    participantesIds = Array.from(new Set([Number(usuarioId), ...rows.map(row => Number(row.id)).filter(id => Number.isFinite(id) && id > 0)]));
    if (!participantesIds.length) {
      const error = new Error('No hay usuarios activos para el área seleccionada');
      error.status = 400;
      throw error;
    }
  } else {
    const resolved = Array.from(new Set([Number(usuarioId), ...participantesIdsRaw.map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0)]));
    if (resolved.length < 1) {
      const error = new Error('Debes indicar al menos un participante');
      error.status = 400;
      throw error;
    }
    participantesIds = resolved;
  }

  const placeholders = buildPlaceholders(participantesIds);
  const [activeUsers] = await conn.query(
    `SELECT id
     FROM usuario
     WHERE id IN (${placeholders})
       AND is_active = 1`,
    participantesIds
  );
  const activeUserIds = activeUsers.map(row => Number(row.id));
  const missing = participantesIds.filter(id => !activeUserIds.includes(Number(id)));
  if (missing.length) {
    const error = new Error('Uno o más participantes no están activos');
    error.status = 400;
    throw error;
  }

  const conversationId = await withTransaction(async tx => {
    const [created] = await tx.query(
      `INSERT INTO conversacion (tipo, titulo, area_codigo, creado_por, activo)
       VALUES (?, ?, ?, ?, 1)`,
      [tipo, titulo || null, areaCodigo || null, usuarioId]
    );

    const insertId = created.insertId;
    for (const participantId of participantesIds) {
      await tx.query(
        `INSERT INTO conversacion_participante (conversacion_id, usuario_id, rol, silenciada, archivada, ultimo_leido_mensaje_id)
         VALUES (?, ?, ?, 0, 0, NULL)
         ON DUPLICATE KEY UPDATE rol = VALUES(rol)`,
        [insertId, participantId, Number(participantId) === Number(usuarioId) ? 'admin' : 'miembro']
      );
    }

    return insertId;
  });

  return findConversation(conn, conversationId, usuarioId);
}

async function createMessage(conn, conversacionId, usuarioId, cuerpo, tipo = 'texto') {
  const participant = await findParticipant(conn, conversacionId, usuarioId);
  if (!participant) {
    const error = new Error('No tienes acceso a esta conversación');
    error.status = 403;
    throw error;
  }

  const texto = normalizeText(cuerpo);
  if (!texto) {
    const error = new Error('El mensaje no puede estar vacío');
    error.status = 400;
    throw error;
  }
  if (texto.length > 4000) {
    const error = new Error('El mensaje supera el largo permitido');
    error.status = 400;
    throw error;
  }

  const tipoNormalizado = normalizeType(tipo) === 'sistema' ? 'sistema' : 'texto';
  const messageId = await withTransaction(async tx => {
    const [inserted] = await tx.query(
      `INSERT INTO mensaje (conversacion_id, remitente_id, cuerpo, tipo, eliminado)
       VALUES (?, ?, ?, ?, 0)`,
      [conversacionId, usuarioId, texto, tipoNormalizado]
    );
    await tx.query(
      'UPDATE conversacion SET updated_at = NOW() WHERE id = ?',
      [conversacionId]
    );
    await tx.query(
      `UPDATE conversacion_participante
       SET archivada = 0
       WHERE conversacion_id = ? AND usuario_id = ?`,
      [conversacionId, usuarioId]
    );
    return inserted.insertId;
  });

  const [rows] = await conn.query(
    `SELECT m.id, m.conversacion_id, m.remitente_id, u.nombre AS remitente_nombre, u.email AS remitente_email,
            u.area AS remitente_area, m.cuerpo, m.tipo, m.eliminado, m.created_at, m.editado_at
     FROM mensaje m
     INNER JOIN usuario u ON u.id = m.remitente_id
     WHERE m.id = ?
     LIMIT 1`,
    [messageId]
  );
  return rows[0] ? mapMensaje(rows[0]) : null;
}

async function markConversationRead(conn, conversacionId, usuarioId) {
  const participant = await findParticipant(conn, conversacionId, usuarioId);
  if (!participant) {
    const error = new Error('No tienes acceso a esta conversación');
    error.status = 403;
    throw error;
  }

  const [rows] = await conn.query(
    `SELECT MAX(id) AS ultimo_id
     FROM mensaje
     WHERE conversacion_id = ?
       AND eliminado = 0`,
    [conversacionId]
  );

  const ultimoId = rows[0]?.ultimo_id !== null && rows[0]?.ultimo_id !== undefined
    ? Number(rows[0].ultimo_id)
    : null;

  await conn.query(
    `UPDATE conversacion_participante
     SET ultimo_leido_mensaje_id = ?
     WHERE conversacion_id = ? AND usuario_id = ?`,
    [ultimoId, conversacionId, usuarioId]
  );

  return { conversacion_id: conversacionId, ultimo_leido_mensaje_id: ultimoId };
}

async function countUnread(conn, usuarioId) {
  const [rows] = await conn.query(
    `SELECT
       COUNT(DISTINCT CASE WHEN x.total > 0 THEN x.conversacion_id END) AS conversaciones,
       COALESCE(SUM(x.total), 0) AS total
     FROM (
       SELECT m.conversacion_id, COUNT(*) AS total
       FROM mensaje m
       INNER JOIN conversacion_participante cp
         ON cp.conversacion_id = m.conversacion_id
        AND cp.usuario_id = ?
       WHERE m.eliminado = 0
         AND m.remitente_id <> ?
         AND (cp.ultimo_leido_mensaje_id IS NULL OR m.id > cp.ultimo_leido_mensaje_id)
       GROUP BY m.conversacion_id
     ) x`,
    [usuarioId, usuarioId]
  );

  return {
    conversaciones: Number(rows[0]?.conversaciones || 0),
    total: Number(rows[0]?.total || 0),
  };
}

async function updateConversationFlag(conn, conversacionId, usuarioId, campo, valor) {
  const participant = await findParticipant(conn, conversacionId, usuarioId);
  if (!participant) {
    const error = new Error('No tienes acceso a esta conversación');
    error.status = 403;
    throw error;
  }

  await conn.query(
    `UPDATE conversacion_participante
     SET ${campo} = ?
     WHERE conversacion_id = ? AND usuario_id = ?`,
    [valor ? 1 : 0, conversacionId, usuarioId]
  );

  return {
    conversacion_id: conversacionId,
    [campo]: Boolean(valor),
  };
}

module.exports = {
  getDirectory,
  listConversations,
  listConversationMessages,
  createConversation,
  createMessage,
  markConversationRead,
  countUnread,
  updateConversationFlag,
  normalizeType,
  findDirectConversation,
};
