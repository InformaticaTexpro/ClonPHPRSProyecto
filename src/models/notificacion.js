'use strict';

/**
 * models/notificacion.js
 *
 * Responsabilidad:
 *   Capa de acceso a datos y reglas de negocio de notificaciones.
 *
 * Fuente de datos:
 *   MySQL (bdtexpro), principalmente tabla `notificaciones`.
 *
 * Tablas relacionadas:
 *   - notificaciones: almacena eventos para cada usuario
 *   - usuario_vendedor: permite resolver usuario_id desde cod_vendedor
 *
 * Este archivo NO expone endpoints HTTP.
 * Es consumido por rutas y servicios del backend (por ejemplo,
 * src/routes/notificaciones.js y lógica de dashboard).
 */

const db = require('../config/db');

// ── Mensajes motivacionales ──────────────────────────────────────────
const MENSAJES_META = [
  '¡Lo lograste! Alcanzaste tu meta del mes. ¡Sigue así, eres increíble! 🎯',
  '¡Meta cumplida! Tu esfuerzo y dedicación dieron frutos. ¡Felicitaciones! 🏆',
  '¡Excelente trabajo! Cruzaste la línea de meta. El equipo está orgulloso de ti. 💪',
  '¡Lo conseguiste! Mes a mes demuestras que eres un crack en ventas. ¡Enhorabuena! 🌟',
];

const MENSAJES_META_SUPERADA = [
  '¡Increíble! No solo cumpliste tu meta, ¡la superaste! Eso es hambre de éxito. 🚀',
  '¡Eres imparable! Superaste la meta del mes. ¡El cielo es el límite! ⭐',
  '¡Vendedor del mes! Rompiste la meta y pusiste el listón más alto. ¡Felicitaciones! 🎉',
  '¡Fuera de serie! Superaste tu objetivo mensual. El equipo te aplaude. 👏',
];

function mensajeAleatorio(arr) {
  // Selección uniforme de un mensaje para evitar repetir siempre el mismo texto.
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Crear notificación genérica ──────────────────────────────────────
async function crearNotificacion({ usuarioId, tipo, titulo, mensaje, folio = null, mes = null, anio = null }) {
  // Validación defensiva: evita insertar registros incompletos.
  if (!usuarioId || !tipo || !titulo || !mensaje) {
    console.error('[notificacion] crearNotificacion: parámetros incompletos →', { usuarioId, tipo, titulo });
    return;
  }
  try {
    // Inserción persistente en MySQL.
    // `folio`, `mes` y `anio` son metadatos opcionales para trazabilidad.
    await db.pool.query(
      `INSERT INTO notificaciones
         (usuario_id, tipo, titulo, mensaje, folio, mes, anio)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [usuarioId, tipo, titulo, mensaje, folio ?? null, mes ?? null, anio ?? null]
    );
    console.log(`[notificacion] ✅ Creada → tipo=${tipo} usuario_id=${usuarioId} folio=${folio ?? '-'}`);
  } catch (err) {
    console.error(`[notificacion] ❌ Error al insertar (tipo=${tipo} usuario_id=${usuarioId}):`, err.message);
    throw err; // re-lanzar para que el .catch() del caller lo registre
  }
}

// ── Notificación: folio compartido al vendedor receptor ──────────────
async function notificarFolioRecibido({ usuarioIdReceptor, folio, cliente, monto, porcentaje, nombreCoordinador, mes, anio }) {
  if (!usuarioIdReceptor) {
    console.warn('[notificacion] notificarFolioRecibido: usuarioIdReceptor es null, se omite notificación');
    return;
  }
  const titulo  = `📥 Folio #${folio} asignado a ti`;
  const mensaje = `El coordinador ${nombreCoordinador} te asignó el folio #${folio} (${cliente}) ` +
                  `por $${Number(monto).toLocaleString('es-CL')} con un ${porcentaje}% de participación.`;
  // Se delega la escritura real al método genérico.
  await crearNotificacion({ usuarioId: usuarioIdReceptor, tipo: 'folio_recibido', titulo, mensaje, folio, mes, anio });
}

// ── Notificación: confirmación al coordinador que compartió ──────────
async function notificarFolioAsignado({ usuarioIdCoordinador, folio, cliente, nombreVendedor, porcentaje, mes, anio }) {
  if (!usuarioIdCoordinador) {
    console.warn('[notificacion] notificarFolioAsignado: usuarioIdCoordinador es null, se omite notificación');
    return;
  }
  const titulo  = `✅ Folio #${folio} compartido con ${nombreVendedor}`;
  const mensaje = `El folio #${folio} (${cliente}) fue asignado a ${nombreVendedor} ` +
                  `con un ${porcentaje}% de participación.`;
  // Confirmación para el coordinador que hizo la asignación.
  await crearNotificacion({ usuarioId: usuarioIdCoordinador, tipo: 'folio_asignado', titulo, mensaje, folio, mes, anio });
}

// ── Notificación: meta cumplida (exactamente 100 %) ──────────────────
async function notificarMetaCumplida({ usuarioId, mes, anio }) {
  // Idempotencia funcional: evita duplicar la misma notificación en el mismo mes/año.
  const [existing] = await db.pool.query(
    `SELECT id FROM notificaciones
     WHERE usuario_id = ? AND tipo = 'meta_cumplida' AND mes = ? AND anio = ?
     LIMIT 1`,
    [usuarioId, mes, anio]
  );
  if (existing.length) return;

  const titulo  = '🎯 ¡Meta del mes cumplida!';
  const mensaje = mensajeAleatorio(MENSAJES_META);
  await crearNotificacion({ usuarioId, tipo: 'meta_cumplida', titulo, mensaje, mes, anio });
}

// ── Notificación: meta superada (> 110 %) ────────────────────────────
async function notificarMetaSuperada({ usuarioId, mes, anio, progreso }) {
  // Igual que meta_cumplida: se evita crear duplicados por periodo.
  const [existing] = await db.pool.query(
    `SELECT id FROM notificaciones
     WHERE usuario_id = ? AND tipo = 'meta_superada' AND mes = ? AND anio = ?
     LIMIT 1`,
    [usuarioId, mes, anio]
  );
  if (existing.length) return;

  const titulo  = `🚀 ¡Superaste tu meta con un ${progreso}%!`;
  const mensaje = mensajeAleatorio(MENSAJES_META_SUPERADA);
  await crearNotificacion({ usuarioId, tipo: 'meta_superada', titulo, mensaje, mes, anio });
}

// ── Obtener notificaciones de un usuario ─────────────────────────────
async function obtenerNotificaciones(usuarioId, { soloNoLeidas = false, limit = 30 } = {}) {
  // Filtro dinámico simple para incluir solo pendientes cuando se solicite.
  const where = soloNoLeidas ? 'AND leida = 0' : '';

  // Orden descendente para mostrar primero lo más reciente en UI.
  const [rows] = await db.pool.query(
    `SELECT id, tipo, titulo, mensaje, leida, folio, mes, anio, fecha_creacion
     FROM notificaciones
     WHERE usuario_id = ? ${where}
     ORDER BY fecha_creacion DESC
     LIMIT ?`,
    [usuarioId, limit]
  );
  return rows;
}

// ── Contar no leídas ─────────────────────────────────────────────────
async function contarNoLeidas(usuarioId) {
  // Retorna número entero para que el frontend pinte badge de campana.
  const [[{ total }]] = await db.pool.query(
    `SELECT COUNT(*) AS total FROM notificaciones WHERE usuario_id = ? AND leida = 0`,
    [usuarioId]
  );
  return Number(total);
}

// ── Marcar como leída ────────────────────────────────────────────────
async function marcarLeida(id, usuarioId) {
  // Condición por usuario evita marcar notificaciones ajenas.
  await db.pool.query(
    `UPDATE notificaciones SET leida = 1 WHERE id = ? AND usuario_id = ?`,
    [id, usuarioId]
  );
}

// ── Marcar todas como leídas ─────────────────────────────────────────
async function marcarTodasLeidas(usuarioId) {
  // Actualización masiva limitada al usuario autenticado.
  await db.pool.query(
    `UPDATE notificaciones SET leida = 1 WHERE usuario_id = ? AND leida = 0`,
    [usuarioId]
  );
}

/**
 * Obtiene el usuario_id a partir de un cod_vendedor.
 * Normaliza el código: trim de espacios y comparación flexible
 * para evitar que '1' != '01' rompa la búsqueda.
 */
async function usuarioIdDesdeCodVendedor(codVendedor) {
  if (!codVendedor) return null;

  const codNorm = String(codVendedor).trim();

  // Primer intento: match exacto tras TRIM.
  const [rows] = await db.pool.query(
    `SELECT usuario_id FROM usuario_vendedor WHERE TRIM(cod_vendedor) = ? LIMIT 1`,
    [codNorm]
  );

  if (rows.length) {
    console.log(`[notificacion] usuarioIdDesdeCodVendedor: cod=${codNorm} → usuario_id=${rows[0].usuario_id}`);
    return rows[0].usuario_id;
  }

  // Segundo intento: normalización con/sin cero a la izquierda.
  // Ejemplo: '1' <-> '01'.
  const codPadded = codNorm.padStart(2, '0');
  const codUnpadded = codNorm.replace(/^0+/, '') || '0';

  const [rows2] = await db.pool.query(
    `SELECT usuario_id FROM usuario_vendedor
     WHERE TRIM(cod_vendedor) IN (?, ?) LIMIT 1`,
    [codPadded, codUnpadded]
  );

  if (rows2.length) {
    console.log(`[notificacion] usuarioIdDesdeCodVendedor (fallback padding): cod=${codNorm} → usuario_id=${rows2[0].usuario_id}`);
    return rows2[0].usuario_id;
  }

  console.warn(`[notificacion] ⚠️ usuarioIdDesdeCodVendedor: no se encontró usuario para cod_vendedor='${codNorm}'`);
  return null;
}

/**
 * Obtiene los usuarios activos que deben recibir notificaciones de RRHH.
 * Se incluyen usuarios cuyo `area` corresponde a RRHH y/o administradores,
 * sin duplicar IDs cuando un mismo usuario cumple ambas condiciones.
 */
async function obtenerUsuariosRrhhYAdmin() {
  const [rows] = await db.pool.query(`
    SELECT DISTINCT id
    FROM usuario
    WHERE is_active = 1
      AND (
        is_admin = 1
        OR LOWER(TRIM(COALESCE(area, ''))) IN ('rrhh', 'recursos humanos', 'rh')
      )
  `);

  return Array.from(
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map(row => Number(row?.id))
        .filter(id => Number.isInteger(id) && id > 0)
    )
  );
}

module.exports = {
  crearNotificacion,
  notificarFolioRecibido,
  notificarFolioAsignado,
  notificarMetaCumplida,
  notificarMetaSuperada,
  obtenerNotificaciones,
  contarNoLeidas,
  marcarLeida,
  marcarTodasLeidas,
  usuarioIdDesdeCodVendedor,
  obtenerUsuariosRrhhYAdmin,
};
