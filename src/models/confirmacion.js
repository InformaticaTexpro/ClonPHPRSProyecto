'use strict';
/**
 * models/confirmacion.js
 * Operaciones sobre la tabla confirmaciones_ventas (MySQL/MariaDB)
 */

const db = require('../config/db');

/**
 * Verifica si ya existe una confirmación para usuario/mes/anio.
 * @returns {Promise<boolean>}
 */
async function existeConfirmacion({ usuarioId, mes, anio }) {
  const [rows] = await db.query(
    `SELECT id FROM confirmaciones_ventas
     WHERE usuario_id = ? AND mes = ? AND anio = ? LIMIT 1`,
    [usuarioId, mes, anio]
  );
  return rows.length > 0;
}

/**
 * Inserta una nueva confirmación.
 * @returns {Promise<number>} id del registro creado
 */
async function crearConfirmacion({
  usuarioId, mes, anio, rutaPdf, nombreArchivo,
  totalVentasPropias, totalVentasAsignadas,
  totalFolios, totalFacturasCompartidas, ip,
}) {
  const [result] = await db.query(
    `INSERT INTO confirmaciones_ventas
       (usuario_id, mes, anio, ruta_pdf, nombre_archivo,
        total_ventas_propias, total_ventas_asignadas,
        total_folios, total_facturas_compartidas, ip_confirmacion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      usuarioId, mes, anio, rutaPdf, nombreArchivo,
      totalVentasPropias, totalVentasAsignadas,
      totalFolios, totalFacturasCompartidas,
      ip || null,
    ]
  );
  return result.insertId;
}

/**
 * Obtiene una confirmación por id.
 * @returns {Promise<object|null>}
 */
async function obtenerConfirmacionPorId(id) {
  const [rows] = await db.query(
    `SELECT cv.*, u.nombre, u.apellido, u.email
     FROM confirmaciones_ventas cv
     INNER JOIN usuarios u ON u.id = cv.usuario_id
     WHERE cv.id = ?`,
    [id]
  );
  return rows[0] || null;
}

/**
 * Lista todas las confirmaciones (para RRHH).
 * Ordenadas por fecha DESC.
 */
async function listarConfirmaciones({ mes, anio } = {}) {
  let where = '';
  const params = [];
  if (mes && anio) {
    where = 'WHERE cv.mes = ? AND cv.anio = ?';
    params.push(mes, anio);
  } else if (anio) {
    where = 'WHERE cv.anio = ?';
    params.push(anio);
  }
  const [rows] = await db.query(
    `SELECT
       cv.id,
       cv.usuario_id,
       u.nombre,
       u.apellido,
       u.email,
       cv.mes,
       cv.anio,
       cv.fecha_confirmacion,
       cv.nombre_archivo,
       cv.total_ventas_propias,
       cv.total_ventas_asignadas,
       cv.total_folios,
       cv.total_facturas_compartidas
     FROM confirmaciones_ventas cv
     INNER JOIN usuarios u ON u.id = cv.usuario_id
     ${where}
     ORDER BY cv.fecha_confirmacion DESC`,
    params
  );
  return rows;
}

/**
 * Obtiene la confirmación de un usuario para un mes/año concreto.
 */
async function obtenerConfirmacionUsuario({ usuarioId, mes, anio }) {
  const [rows] = await db.query(
    `SELECT * FROM confirmaciones_ventas
     WHERE usuario_id = ? AND mes = ? AND anio = ? LIMIT 1`,
    [usuarioId, mes, anio]
  );
  return rows[0] || null;
}

module.exports = {
  existeConfirmacion,
  crearConfirmacion,
  obtenerConfirmacionPorId,
  listarConfirmaciones,
  obtenerConfirmacionUsuario,
};
