'use strict';

/**
 * models/usuario.js
 *
 * Capa de acceso a datos del dominio de usuarios.
 *
 * Fuente de datos principal:
 *   MySQL (bdtexpro), tablas: usuario, usuario_vendedor,
 *   usuario_permiso, vendedor_meta, tasas_descuentos.
 *
 * Este módulo es consumido por:
 *   - rutas de autenticación
 *   - middleware de autorización
 *   - flujo de recuperación de contraseña
 */

const { pool } = require('../config/db');
const { hashPasswordDjango } = require('../utils/pbkdf2Django');


async function findByEmail(email) {
  // Busca credenciales/base de usuario para login y recuperación.
  const [rows] = await pool.execute(
    'SELECT * FROM usuario WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] ?? null;
}

async function findById(id) {
  // Retorna perfil público de usuario (sin password).
  const [rows] = await pool.execute(
    'SELECT id, nombre, email, area, codigo, tema, is_active, is_admin, last_login, fecha_creacion FROM usuario WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] ?? null;
}

async function updateLastLogin(id) {
  const [result] = await pool.execute(
    'UPDATE usuario SET last_login = NOW() WHERE id = ?',
    [id]
  );
  return result.affectedRows > 0;
}

async function updatePassword(email, nuevaPassword) {
  // Hash compatible con Django antes de persistir en BD.
  const hash = hashPasswordDjango(nuevaPassword);
  const [result] = await pool.execute(
    'UPDATE usuario SET password = ? WHERE email = ? AND is_active = 1',
    [hash, email]
  );
  return result.affectedRows > 0;
}

async function getVendedoresByUsuarioId(usuarioId) {
  const [rows] = await pool.execute(
    'SELECT * FROM usuario_vendedor WHERE usuario_id = ?',
    [usuarioId]
  );
  return rows;
}

async function getPermisosByUsuarioId(usuarioId) {
  const [rows] = await pool.execute(
    'SELECT * FROM usuario_permiso WHERE usuario_id = ?',
    [usuarioId]
  );
  return rows;
}

async function getMetasByUsuarioId(usuarioId) {
  const [rows] = await pool.execute(
    'SELECT * FROM vendedor_meta WHERE usuario_id = ? ORDER BY fecha DESC',
    [usuarioId]
  );
  return rows;
}

async function getTasasDescuentos() {
  const [rows] = await pool.execute(
    'SELECT * FROM tasas_descuentos ORDER BY anio DESC, orden ASC'
  );
  return rows;
}

module.exports = {
  findByEmail,
  findById,
  updateLastLogin,
  updatePassword,
  getVendedoresByUsuarioId,
  getPermisosByUsuarioId,
  getMetasByUsuarioId,
  getTasasDescuentos
};
