'use strict';

/**
 * db.js
 *
 * Gestión de conexión MySQL (bdtexpro) usando mysql2/promise.
 *
 * Exporta:
 *   - pool: conexión reutilizable para queries en modelos/rutas
 *   - testConnection: verificación activa para healthchecks
 *
 * Variables esperadas:
 *   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:             process.env.DB_HOST,
  port:             Number(process.env.DB_PORT || 3306),
  user:             process.env.DB_USER,
  password:         process.env.DB_PASSWORD,
  database:         process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
  charset:          'utf8mb4'
});

async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
    return true;
  } finally {
    connection.release();
  }
}

function query(sql, params) {
  return pool.query(sql, params);
}

module.exports = { pool, query, testConnection };
