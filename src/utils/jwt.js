'use strict';

/**
 * jwt.js — Utilidades para generar y verificar JWT
 *
 * Variables de entorno requeridas en .env:
 *   JWT_SECRET       — clave secreta (mínimo 32 caracteres)
 *   JWT_EXPIRES_IN   — duración del token (default: '8h')
 *
 * Payload del token:
 *   sub       — id del usuario
 *   email     — email del usuario
 *   is_admin  — boolean
 *   vendedores — array con cod_vendedor y tipo
 *   area      — área del usuario
 *   iat       — emitido en (auto)
 *   exp       — expira en (auto)
 */

const jwt = require('jsonwebtoken');

/**
 * Genera un token JWT con el payload del usuario.
 * Acepta { sub, email, is_admin, vendedores, area }
 *   o    { id,  email, is_admin, vendedores, area }  (retrocompatible)
 * @param {object} usuario
 * @returns {string} token firmado
 */
function generarToken(usuario) {
  const SECRET     = process.env.JWT_SECRET;
  const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
  if (!SECRET) throw new Error('JWT_SECRET no está definido en .env');

  // Acepta sub o id para ser retrocompatible
  const sub = usuario.sub ?? usuario.id;

  return jwt.sign(
    {
      id:        sub,
      sub,
      email:      usuario.email,
      is_admin:   Boolean(usuario.is_admin),
      vendedores: usuario.vendedores || [],
      area:       usuario.area      || ''
    },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

/**
 * Verifica y decodifica un token JWT.
 * Lanza JsonWebTokenError o TokenExpiredError si es inválido.
 * @param {string} token
 * @returns {{ sub: number, email: string, is_admin: boolean, iat: number, exp: number }}
 */
function verificarToken(token) {
  const SECRET = process.env.JWT_SECRET;
  if (!SECRET) throw new Error('JWT_SECRET no está definido en .env');
  return jwt.verify(token, SECRET);
}

module.exports = { generarToken, verificarToken };
