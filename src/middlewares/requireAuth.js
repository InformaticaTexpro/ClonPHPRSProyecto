'use strict';

/**
 * requireAuth.js — Middleware de autenticación y autorización JWT.
 */

const { verificarToken } = require('../utils/jwt');
const { getVendedoresByUsuarioId } = require('../models/usuario');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: 'Token requerido. Incluye Authorization: Bearer <token>'
      });
    }

    const payload = verificarToken(token);
    const usuarioId = payload.sub ?? payload.id;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, error: 'Token inválido.' });
    }

    const vendedores = await getVendedoresByUsuarioId(usuarioId);

    req.usuario = {
      ...payload,
      id: usuarioId,
      sub: usuarioId,
      area: String(payload.area || '').trim(),
      vendedores,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ ok: false, error: 'Token expirado. Vuelve a iniciar sesión.' });
    }
    return res.status(401).json({ ok: false, error: 'Token inválido.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.usuario?.is_admin) {
    return res.status(403).json({ ok: false, error: 'Solo administradores' });
  }
  next();
}

/**
 * Permite acceso a usuarios administradores o pertenecientes al área RRHH.
 * Debe usarse después de requireAuth.
 */
function requireRrhhOrAdmin(req, res, next) {
  const area = String(req.usuario?.area || '').trim().toLowerCase();
  const esRrhh = ['rrhh', 'recursos humanos', 'rh'].includes(area);

  if (!req.usuario?.is_admin && !esRrhh) {
    return res.status(403).json({ ok: false, error: 'Acceso restringido a RRHH o administradores.' });
  }

  next();
}

module.exports = { requireAuth, requireAdmin, requireRrhhOrAdmin };
