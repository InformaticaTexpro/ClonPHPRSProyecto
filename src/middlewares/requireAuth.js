'use strict';

/**
 * requireAuth.js — Middleware de autenticación JWT
 *
 * Decodifica el token y luego enriquece req.usuario con los vendedores
 * frescos desde MySQL, de modo que cambios en usuario_vendedor (tipo, cod_vendedor)
 * se reflejen sin necesidad de que el usuario vuelva a hacer login.
 */

const { verificarToken }             = require('../utils/jwt');
const { getVendedoresByUsuarioId }   = require('../models/usuario');

async function requireAuth(req, res, next) {
  try {
    // Header esperado: Authorization: Bearer <jwt>
    const authHeader = req.headers['authorization'] || '';
    const token      = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : null;

    if (!token) {
      return res.status(401).json({
        ok:    false,
        error: 'Token requerido. Incluye Authorization: Bearer <token>'
      });
    }

    // Verificación de firma y expiración del token.
    const payload = verificarToken(token);

    const usuarioId = payload.sub ?? payload.id;
    if (!usuarioId) {
      return res.status(401).json({ ok: false, error: 'Token invalido.' });
    }

    // Recargar vendedores frescos desde MySQL para que
    // cambios en usuario_vendedor (tipo C, nuevos códigos, etc.)
    // sean visibles sin necesidad de re-login.
    const vendedores = await getVendedoresByUsuarioId(usuarioId);

    // req.usuario queda como fuente única de identidad/autorización
    // para todo el request lifecycle.
    req.usuario = {
      ...payload,
      id: usuarioId,
      sub: usuarioId,
      vendedores,          // sobreescribe los del JWT con los de la BD
    };

    next();

  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ ok: false, error: 'Token expirado. Vuelve a iniciar sesión.' });
    }
    return res.status(401).json({ ok: false, error: 'Token inválido.' });
  }
}

/**
 * requireAdmin — Middleware que exige is_admin = true
 * Debe usarse DESPUÉS de requireAuth.
 */
function requireAdmin(req, res, next) {
  if (!req.usuario?.is_admin) {
    return res.status(403).json({ ok: false, error: 'Acceso restringido a administradores.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
