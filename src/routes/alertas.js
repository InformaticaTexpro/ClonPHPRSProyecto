'use strict';
/**
 * routes/alertas.js  v2.5
 * Fix v2.5:
 *  - parseLocalDate: acepta tanto string 'YYYY-MM-DD' como objeto Date de MySQL.
 *    MySQL2 devuelve columnas DATE como objetos Date JS, no como strings,
 *    por lo que str.split('-') lanzaba TypeError.
 *  - diasRestantes / debeRecordar actualizados para usar la nueva parseLocalDate.
 */

const express          = require('express');
const router           = express.Router();
const { pool: db }     = require('../config/db');
const { requireAuth }  = require('../middlewares/requireAuth');

router.use(requireAuth);

/**
 * Parsea una fecha como local (sin desfase UTC).
 * Acepta:
 *   - string 'YYYY-MM-DD'  → proveniente de JSON o campos TEXT
 *   - objeto Date          → proveniente de mysql2 con columnas DATE/DATETIME
 *   - null / undefined     → retorna null
 */
function parseLocalDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    // mysql2 devuelve DATE como Date con hora 00:00:00 UTC
    // Usamos UTC para extraer año/mes/día y construir fecha local
    return new Date(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate());
  }
  // string 'YYYY-MM-DD'
  const str = String(val).substring(0, 10);
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Convierte cualquier valor fecha a string 'YYYY-MM-DD' */
function toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).substring(0, 10);
}

function diasRestantes(fechaVence) {
  const fecha = parseLocalDate(fechaVence);
  if (!fecha) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  return Math.ceil((fecha - hoy) / 86400000);
}

function debeRecordar(ultimoRec, frecuencia) {
  if (!ultimoRec || frecuencia === 'siempre') return true;
  const hoy    = new Date(); hoy.setHours(0, 0, 0, 0);
  const ultimo = parseLocalDate(ultimoRec);
  if (!ultimo) return true;
  const diff   = Math.floor((hoy - ultimo) / 86400000);
  if (frecuencia === 'diaria')    return diff >= 1;
  if (frecuencia === 'semanal')   return diff >= 7;
  if (frecuencia === 'quincenal') return diff >= 15;
  return true;
}

// ── GET /api/alertas ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const uid = req.usuario.sub;
  try {
    const [rows] = await db.query(`
      SELECT
        a.id, a.titulo, a.descripcion, a.tipo, a.fecha_vence,
        a.frecuencia_recordatorio,
        a.id_creador, a.activa, a.completada, a.created_at,
        COALESCE(u.nombre, '') AS nombre_creador,
        COALESCE(ad.silenciada, 0) AS silenciada,
        COALESCE(ad.archivada, 0) AS archivada,
        COALESCE(ad.fecha_archivada, NULL) AS fecha_archivada,
        COALESCE(ad.descartada_hoy, NULL) AS descartada_hoy,
        (
          SELECT GROUP_CONCAT(du.nombre ORDER BY du.nombre SEPARATOR ', ')
          FROM alerta_destinatarios adc
          JOIN usuario du ON du.id = adc.id_usuario
          WHERE adc.id_alerta = a.id
        ) AS destinatarios_nombres,
        (
          SELECT GROUP_CONCAT(adc2.id_usuario ORDER BY adc2.id_usuario SEPARATOR ',')
          FROM alerta_destinatarios adc2
          WHERE adc2.id_alerta = a.id
        ) AS destinatarios_ids
      FROM alertas a
      LEFT JOIN usuario u ON u.id = a.id_creador
      LEFT JOIN alerta_destinatarios ad ON ad.id_alerta = a.id AND ad.id_usuario = ?
      WHERE
        a.id_creador = ?
        OR EXISTS (
          SELECT 1 FROM alerta_destinatarios adx
          WHERE adx.id_alerta = a.id AND adx.id_usuario = ?
        )
      ORDER BY a.activa DESC, a.completada ASC, a.fecha_vence ASC
    `, [uid, uid, uid]);

    const data = rows.map(r => ({
      ...r,
      fecha_vence:       toDateStr(r.fecha_vence),
      dias_restantes:    diasRestantes(r.fecha_vence),
      archivada:         Number(r.archivada || 0),
      fecha_archivada:   toDateStr(r.fecha_archivada),
      destinatarios_ids: r.destinatarios_ids
        ? r.destinatarios_ids.split(',').map(Number)
        : [],
    }));

    res.json({ ok: true, data });
  } catch (e) {
    console.error('[alertas GET]', e);
    res.status(500).json({ ok: false, error: 'Error al obtener alertas' });
  }
});

// ── GET /api/alertas/contador ─────────────────────────────────────────────────
router.get('/contador', async (req, res) => {
  const uid = req.usuario.sub;
  try {
    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM alertas a
      LEFT JOIN alerta_destinatarios ad ON ad.id_alerta = a.id AND ad.id_usuario = ?
      WHERE
        a.activa = 1 AND a.completada = 0
        AND a.fecha_vence >= CURDATE()
        AND COALESCE(ad.archivada, 0) = 0
        AND (
          DATEDIFF(a.fecha_vence, CURDATE()) <= 7
          OR a.frecuencia_recordatorio = 'siempre'
        )
        AND COALESCE(ad.silenciada, 0) = 0
        AND (
          a.id_creador = ?
          OR EXISTS (SELECT 1 FROM alerta_destinatarios adx WHERE adx.id_alerta = a.id AND adx.id_usuario = ?)
        )
    `, [uid, uid, uid]);
    res.json({ ok: true, total });
  } catch (e) {
    console.error('[alertas contador]', e);
    res.status(500).json({ ok: false, error: 'Error al obtener contador' });
  }
});

// ── GET /api/alertas/badge (alias de /contador) ───────────────────────────────
router.get('/badge', async (req, res) => {
  const uid = req.usuario.sub;
  try {
    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM alertas a
      LEFT JOIN alerta_destinatarios ad ON ad.id_alerta = a.id AND ad.id_usuario = ?
      WHERE
        a.activa = 1 AND a.completada = 0
        AND a.fecha_vence >= CURDATE()
        AND COALESCE(ad.archivada, 0) = 0
        AND (
          DATEDIFF(a.fecha_vence, CURDATE()) <= 7
          OR a.frecuencia_recordatorio = 'siempre'
        )
        AND COALESCE(ad.silenciada, 0) = 0
        AND (
          a.id_creador = ?
          OR EXISTS (SELECT 1 FROM alerta_destinatarios adx WHERE adx.id_alerta = a.id AND adx.id_usuario = ?)
        )
    `, [uid, uid, uid]);
    res.json({ ok: true, total });
  } catch (e) {
    console.error('[alertas badge]', e);
    res.status(500).json({ ok: false, error: 'Error al obtener badge' });
  }
});

// ── GET /api/alertas/pendientes ───────────────────────────────────────────────
router.get('/pendientes', async (req, res) => {
  const uid = req.usuario.sub;
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    const [rows] = await db.query(`
      SELECT
        a.id, a.titulo, a.descripcion, a.tipo, a.fecha_vence,
        a.frecuencia_recordatorio, a.id_creador,
        COALESCE(u.nombre, '') AS nombre_creador,
        COALESCE(ad.silenciada, 0) AS silenciada,
        COALESCE(ad.descartada_hoy, NULL) AS descartada_hoy,
        COALESCE(ad.ultimo_recordatorio, NULL) AS ultimo_recordatorio
      FROM alertas a
      LEFT JOIN usuario u ON u.id = a.id_creador
      LEFT JOIN alerta_destinatarios ad ON ad.id_alerta = a.id AND ad.id_usuario = ?
      WHERE
        a.activa = 1 AND a.completada = 0
        AND a.fecha_vence >= CURDATE()
        AND COALESCE(ad.archivada, 0) = 0
        AND (
          DATEDIFF(a.fecha_vence, CURDATE()) <= 7
          OR a.frecuencia_recordatorio = 'siempre'
        )
        AND COALESCE(ad.silenciada, 0) = 0
        AND (ad.descartada_hoy IS NULL OR ad.descartada_hoy != ?)
        AND (
          a.id_creador = ?
          OR EXISTS (SELECT 1 FROM alerta_destinatarios adx WHERE adx.id_alerta = a.id AND adx.id_usuario = ?)
        )
      ORDER BY a.fecha_vence ASC
    `, [uid, hoy, uid, uid]);

    const data = rows
      .filter(r => debeRecordar(r.ultimo_recordatorio, r.frecuencia_recordatorio))
      .map(r => ({
        ...r,
        fecha_vence:    toDateStr(r.fecha_vence),
        dias_restantes: diasRestantes(r.fecha_vence),
      }));

    res.json({ ok: true, data });
  } catch (e) {
    console.error('[alertas pendientes]', e);
    res.status(500).json({ ok: false, error: 'Error al obtener alertas pendientes' });
  }
});

// ── GET /api/alertas/usuarios ─────────────────────────────────────────────────
router.get('/usuarios', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, nombre, area FROM usuario WHERE is_active = 1 ORDER BY nombre ASC`
    );
    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('[alertas usuarios]', e);
    res.status(500).json({ ok: false, error: 'Error al obtener usuarios' });
  }
});

// ── POST /api/alertas ─────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const uid = req.usuario.sub;
  const {
    titulo, descripcion, tipo, fecha_vence,
    frecuencia_recordatorio = 'semanal',
    destinatarios = []
  } = req.body;

  if (!titulo || !fecha_vence)
    return res.status(400).json({ ok: false, error: 'Título y fecha de vencimiento son obligatorios' });
  if (!['personal', 'grupal'].includes(tipo))
    return res.status(400).json({ ok: false, error: 'Tipo inválido' });
  if (!['siempre','diaria','semanal','quincenal'].includes(frecuencia_recordatorio))
    return res.status(400).json({ ok: false, error: 'Frecuencia inválida' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO alertas (titulo, descripcion, tipo, fecha_vence, frecuencia_recordatorio, id_creador)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [titulo, descripcion || null, tipo, fecha_vence, frecuencia_recordatorio, uid]
    );
    const idAlerta = ins.insertId;
    const destinatariosValidos = destinatarios
      .map(Number)
      .filter(n => Number.isInteger(n) && n > 0);
    const destSet  = new Set([uid, ...destinatariosValidos]);
    for (const did of destSet) {
      await conn.query(
        `INSERT IGNORE INTO alerta_destinatarios (id_alerta, id_usuario) VALUES (?, ?)`,
        [idAlerta, did]
      );
    }
    await conn.commit();
    res.json({ ok: true, id: idAlerta });
  } catch (e) {
    await conn.rollback();
    console.error('[alertas POST]', e);
    res.status(500).json({ ok: false, error: 'Error al crear alerta' });
  } finally {
    conn.release();
  }
});

// ── PUT /api/alertas/:id ──────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  const {
    titulo, descripcion, tipo, fecha_vence,
    frecuencia_recordatorio = 'semanal',
    destinatarios = []
  } = req.body;

  const conn = await db.getConnection();
  try {
    const [[alerta]] = await conn.query(`SELECT id_creador FROM alertas WHERE id = ?`, [id]);
    if (!alerta)
      return res.status(404).json({ ok: false, error: 'Alerta no encontrada' });
    if (alerta.id_creador !== uid && !req.usuario.is_admin)
      return res.status(403).json({ ok: false, error: 'Sin permisos para editar esta alerta' });

    await conn.beginTransaction();
    await conn.query(
      `UPDATE alertas SET titulo=?, descripcion=?, tipo=?, fecha_vence=?, frecuencia_recordatorio=? WHERE id=?`,
      [titulo, descripcion || null, tipo, fecha_vence, frecuencia_recordatorio, id]
    );
    await conn.query(`DELETE FROM alerta_destinatarios WHERE id_alerta = ?`, [id]);
    const destinatariosValidos = destinatarios
      .map(Number)
      .filter(n => Number.isInteger(n) && n > 0);
    const destSet = new Set([uid, ...destinatariosValidos]);
    for (const did of destSet) {
      await conn.query(
        `INSERT IGNORE INTO alerta_destinatarios (id_alerta, id_usuario) VALUES (?, ?)`,
        [id, did]
      );
    }
    await conn.commit();
    res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error('[alertas PUT]', e);
    res.status(500).json({ ok: false, error: 'Error al editar alerta' });
  } finally {
    conn.release();
  }
});

// ── PATCH /:id/completar ──────────────────────────────────────────────────────
router.patch('/:id/completar', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  try {
    const [[a]] = await db.query(`SELECT id_creador FROM alertas WHERE id=?`, [id]);
    if (!a) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (a.id_creador !== uid && !req.usuario.is_admin)
      return res.status(403).json({ ok: false, error: 'Sin permisos' });
    await db.query(`UPDATE alertas SET completada=1, activa=0 WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas completar]', e);
    res.status(500).json({ ok: false, error: 'Error al completar alerta' });
  }
});

// ── PATCH /:id/desactivar ─────────────────────────────────────────────────────
router.patch('/:id/desactivar', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  try {
    const [[a]] = await db.query(`SELECT id_creador FROM alertas WHERE id=?`, [id]);
    if (!a) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (a.id_creador !== uid && !req.usuario.is_admin)
      return res.status(403).json({ ok: false, error: 'Sin permisos' });
    await db.query(`UPDATE alertas SET activa=0 WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas desactivar]', e);
    res.status(500).json({ ok: false, error: 'Error al desactivar alerta' });
  }
});

// ── PATCH /:id/activar ────────────────────────────────────────────────────────
router.patch('/:id/activar', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  try {
    const [[a]] = await db.query(`SELECT id_creador, completada FROM alertas WHERE id=?`, [id]);
    if (!a) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (a.id_creador !== uid && !req.usuario.is_admin)
      return res.status(403).json({ ok: false, error: 'Sin permisos' });
    if (Number(a.completada) === 1) {
      return res.status(400).json({ ok: false, error: 'No se puede activar una alerta completada' });
    }
    await db.query(`UPDATE alertas SET activa=1 WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas activar]', e);
    res.status(500).json({ ok: false, error: 'Error al activar alerta' });
  }
});

// ── PATCH /:id/archivar ──────────────────────────────────────────────────────
router.patch('/:id/archivar', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  try {
    const [[a]] = await db.query(`
      SELECT
        a.id,
        a.id_creador,
        EXISTS(
          SELECT 1
          FROM alerta_destinatarios adx
          WHERE adx.id_alerta = a.id
            AND adx.id_usuario = ?
        ) AS es_destinatario
      FROM alertas a
      WHERE a.id = ?
    `, [uid, id]);
    if (!a) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (a.id_creador !== uid && Number(a.es_destinatario) !== 1) {
      return res.status(403).json({ ok: false, error: 'Sin permisos' });
    }
    await db.query(`
      INSERT INTO alerta_destinatarios (id_alerta, id_usuario, archivada, fecha_archivada)
      VALUES (?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE
        archivada = 1,
        fecha_archivada = NOW()
    `, [id, uid]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas archivar]', e);
    res.status(500).json({ ok: false, error: 'Error al archivar alerta' });
  }
});

// ── PATCH /:id/desarchivar ───────────────────────────────────────────────────
router.patch('/:id/desarchivar', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  try {
    const [[a]] = await db.query(`
      SELECT
        a.id,
        a.id_creador,
        EXISTS(
          SELECT 1
          FROM alerta_destinatarios adx
          WHERE adx.id_alerta = a.id
            AND adx.id_usuario = ?
        ) AS es_destinatario
      FROM alertas a
      WHERE a.id = ?
    `, [uid, id]);
    if (!a) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (a.id_creador !== uid && Number(a.es_destinatario) !== 1) {
      return res.status(403).json({ ok: false, error: 'Sin permisos' });
    }
    await db.query(`
      INSERT INTO alerta_destinatarios (id_alerta, id_usuario, archivada, fecha_archivada)
      VALUES (?, ?, 0, NULL)
      ON DUPLICATE KEY UPDATE
        archivada = 0,
        fecha_archivada = NULL
    `, [id, uid]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas desarchivar]', e);
    res.status(500).json({ ok: false, error: 'Error al desarchivar alerta' });
  }
});

// ── PATCH /:id/descartar ──────────────────────────────────────────────────────
router.patch('/:id/descartar', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  const hoy = new Date().toISOString().slice(0, 10);
  try {
    await db.query(`
      INSERT INTO alerta_destinatarios (id_alerta, id_usuario, descartada_hoy, ultimo_recordatorio)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        descartada_hoy      = VALUES(descartada_hoy),
        ultimo_recordatorio = VALUES(ultimo_recordatorio)
    `, [id, uid, hoy, hoy]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas descartar]', e);
    res.status(500).json({ ok: false, error: 'Error al descartar alerta' });
  }
});

// ── PATCH /:id/silenciar ──────────────────────────────────────────────────────
router.patch('/:id/silenciar', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  try {
    await db.query(`
      INSERT INTO alerta_destinatarios (id_alerta, id_usuario, silenciada)
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE silenciada = 1
    `, [id, uid]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas silenciar]', e);
    res.status(500).json({ ok: false, error: 'Error al silenciar alerta' });
  }
});

// ── DELETE /api/alertas/:id ───────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const uid = req.usuario.sub;
  const id  = Number(req.params.id);
  try {
    const [[a]] = await db.query(`SELECT id_creador FROM alertas WHERE id=?`, [id]);
    if (!a) return res.status(404).json({ ok: false, error: 'No encontrada' });
    if (a.id_creador !== uid && !req.usuario.is_admin)
      return res.status(403).json({ ok: false, error: 'Sin permisos para eliminar' });
    await db.query(`DELETE FROM alertas WHERE id=?`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[alertas DELETE]', e);
    res.status(500).json({ ok: false, error: 'Error al eliminar alerta' });
  }
});

module.exports = router;
