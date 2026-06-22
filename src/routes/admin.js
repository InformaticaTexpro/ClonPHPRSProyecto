'use strict';

/**
 * routes/admin.js
 *
 * Endpoints administrativos para gestion de usuarios del sistema.
 *
 * Seguridad:
 *   - requireAuth: exige sesion valida
 *   - requireAdmin: exige rol administrador
 *
 * Fuente de datos:
 *   MySQL tablas `usuario` y `usuario_vendedor`.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middlewares/requireAuth');
const db = require('../config/db');

router.use(requireAuth, requireAdmin);

function splitCsv(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value || '').split(',').map(v => v.trim()).filter(Boolean);
}

const usuarioSelect = `
  SELECT
    u.id,
    u.nombre,
    u.email,
    u.area,
    u.codigo,
    u.is_admin,
    u.is_active,
    u.is_active AS activo,
    u.fecha_creacion AS created_at,
    GROUP_CONCAT(uv.cod_vendedor ORDER BY uv.cod_vendedor SEPARATOR ',') AS cod_vendedor,
    GROUP_CONCAT(uv.tipo ORDER BY uv.cod_vendedor SEPARATOR ',') AS tipo_vendedor
  FROM usuario u
  LEFT JOIN usuario_vendedor uv ON uv.usuario_id = u.id
`;

/**
 * GET /api/admin/usuarios
 * Lista todos los usuarios del sistema.
 */
router.get('/usuarios', async (_req, res) => {
  try {
    const [rows] = await db.pool.query(
      `${usuarioSelect}
       GROUP BY u.id, u.nombre, u.email, u.area, u.codigo, u.is_admin, u.is_active, u.fecha_creacion
       ORDER BY u.nombre ASC`
    );
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[ADMIN] Error al obtener usuarios:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener usuarios' });
  }
});

/**
 * GET /api/admin/usuarios/:id
 * Detalle de un usuario.
 */
router.get('/usuarios/:id', async (req, res) => {
  try {
    const [rows] = await db.pool.query(
      `${usuarioSelect}
       WHERE u.id = ?
       GROUP BY u.id, u.nombre, u.email, u.area, u.codigo, u.is_admin, u.is_active, u.fecha_creacion`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }
    res.json({ ok: true, data: rows[0] });
  } catch (err) {
    console.error('[ADMIN] Error al obtener usuario:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener usuario' });
  }
});

/**
 * PUT /api/admin/usuarios/:id
 * Actualiza estado/admin y, si se envia, reemplaza los codigos de vendedor.
 */
router.put('/usuarios/:id', async (req, res) => {
  const { activo, tipo_vendedor, is_admin, cod_vendedor } = req.body;
  const { id } = req.params;
  const usuarioIdActual = req.usuario.id ?? req.usuario.sub;

  if (Number(id) === Number(usuarioIdActual) && is_admin === false) {
    return res.status(400).json({
      ok: false,
      error: 'No puedes quitarte permisos de administrador a ti mismo',
    });
  }

  try {
    const updates = [];
    const params = [];
    if (activo !== undefined) {
      updates.push('is_active = ?');
      params.push(activo ? 1 : 0);
    }
    if (is_admin !== undefined) {
      updates.push('is_admin = ?');
      params.push(is_admin ? 1 : 0);
    }

    if (updates.length) {
      await db.pool.query(
        `UPDATE usuario SET ${updates.join(', ')} WHERE id = ?`,
        [...params, id]
      );
    }

    if (cod_vendedor !== undefined) {
      const codigos = splitCsv(cod_vendedor);
      const tipos = splitCsv(tipo_vendedor);

      await db.pool.query('DELETE FROM usuario_vendedor WHERE usuario_id = ?', [id]);

      for (const [index, cod] of codigos.entries()) {
        await db.pool.query(
          `INSERT INTO usuario_vendedor (cod_vendedor, tipo, usuario_id)
           VALUES (?, ?, ?)`,
          [cod, tipos[index] || tipos[0] || 'P', id]
        );
      }
    }

    res.json({ ok: true, mensaje: 'Usuario actualizado correctamente' });
  } catch (err) {
    console.error('[ADMIN] Error al actualizar usuario:', err);
    res.status(500).json({ ok: false, error: 'Error al actualizar usuario' });
  }
});

/**
 * POST /api/admin/usuarios/:id/toggle-activo
 * Activa o desactiva un usuario.
 */
router.post('/usuarios/:id/toggle-activo', async (req, res) => {
  try {
    const [rows] = await db.pool.query(
      'SELECT is_active AS activo FROM usuario WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    const nuevoEstado = rows[0].activo ? 0 : 1;
    await db.pool.query(
      'UPDATE usuario SET is_active = ? WHERE id = ?',
      [nuevoEstado, req.params.id]
    );
    res.json({ ok: true, activo: nuevoEstado === 1 });
  } catch (err) {
    console.error('[ADMIN] Error al toggle usuario:', err);
    res.status(500).json({ ok: false, error: 'Error al cambiar estado del usuario' });
  }
});

module.exports = router;
