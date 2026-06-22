'use strict';

/**
 * routes/auth.js
 *
 * Endpoints de autenticaciÃ³n:
 *   POST /api/auth/login        â€” Inicio de sesiÃ³n (email + password)
 *   GET  /api/auth/me           â€” Perfil del usuario autenticado
 *   POST /api/auth/logout       â€” Cierre de sesiÃ³n (client-side)
 *   POST /api/auth/refresh      â€” RenovaciÃ³n silenciosa de token JWT
 */

const express                  = require('express');
const router                   = express.Router();
const jwt                      = require('jsonwebtoken');
const db                       = require('../config/db');
const { verifyPasswordDjango } = require('../utils/pbkdf2Django');
const { updateLastLogin }      = require('../models/usuario');
const { requireAuth }          = require('../middlewares/requireAuth');

const JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// â”€â”€ POST /api/auth/login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/login', async (req, res) => {
  // Acepta tanto { email } (frontend actual) como { usuario } (retrocompat)
  const { email, usuario, password } = req.body;
  const emailFinal = (email || usuario || '').trim().toLowerCase();

  if (!emailFinal || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseÃ±a requeridos' });
  }

  try {
    const [rows] = await db.pool.query(
      `SELECT u.id, u.email, u.nombre, u.password, u.area, u.is_admin, u.is_active
       FROM usuario u
       WHERE u.email = ?
       LIMIT 1`,
      [emailFinal]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseÃ±a incorrectos' });
    }

    // Las contraseÃ±as estÃ¡n en formato PBKDF2-SHA256 de Django (600.000 iter)
    const match = verifyPasswordDjango(password, user.password);
    if (!match) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseÃ±a incorrectos' });
    }

    // Registrar Ãºltimo acceso
    await updateLastLogin(user.id);

    // Cargar vendedores asociados
    const [vendedores] = await db.pool.query(
      `SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?`,
      [user.id]
    );

    const payload = {
      id:        user.id,
      sub:       user.id,
      email:     user.email,
      nombre:    user.nombre,
      area:      user.area,
      is_admin:  user.is_admin,
      vendedores,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.json({
      ok:    true,
      token,
      user:  { ...payload },
    });

  } catch (err) {
    console.error('[POST /api/auth/login]', err.message);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// â”€â”€ GET /api/auth/me â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/me', requireAuth, async (req, res) => {
  try {
    const [rows] = await db.pool.query(
      `SELECT u.id, u.email, u.nombre, u.area, u.is_admin, u.is_active
       FROM usuario u WHERE u.id = ? LIMIT 1`,
      [req.usuario.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ ok: false, error: 'SesiÃ³n no vÃ¡lida' });
    }
    const [vendedores] = await db.pool.query(
      `SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?`,
      [user.id]
    );
    res.json({ ok: true, user: { ...user, vendedores } });
  } catch (err) {
    console.error('[GET /api/auth/me]', err.message);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// â”€â”€ POST /api/auth/logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// JWT es stateless; logout se gestiona borrando el token en el cliente.
router.post('/logout', requireAuth, (_req, res) => {
  res.json({ ok: true, message: 'SesiÃ³n cerrada' });
});

// â”€â”€ POST /api/auth/refresh â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * RenovaciÃ³n silenciosa de token JWT.
 * Acepta tokens expirados hace menos de 24h con firma vÃ¡lida.
 * Verifica is_active en BD antes de emitir nuevo token.
 */
router.post('/refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token no proporcionado' });
  }

  const token = authHeader.slice(7);

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { ignoreExpiration: true });
  } catch {
    return res.status(401).json({ ok: false, error: 'Token invÃ¡lido' });
  }

  const ahora       = Math.floor(Date.now() / 1000);
  const expiracion  = decoded.exp || 0;
  const VENTANA_SEG = 24 * 60 * 60;

  if (ahora - expiracion > VENTANA_SEG) {
    return res.status(401).json({ ok: false, error: 'Token demasiado antiguo para renovar. Inicia sesiÃ³n nuevamente.' });
  }

  try {
    const [rows] = await db.pool.query(
      `SELECT u.id, u.email, u.nombre, u.area, u.is_admin, u.is_active
       FROM usuario u WHERE u.id = ? LIMIT 1`,
      [decoded.sub]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ ok: false, error: 'Usuario inactivo o no encontrado' });
    }

    const [vendedores] = await db.pool.query(
      `SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?`,
      [user.id]
    );

    const nuevoPayload = {
      id:        user.id,
      sub:       user.id,
      email:     user.email,
      nombre:    user.nombre,
      area:      user.area,
      is_admin:  user.is_admin,
      vendedores,
    };
    const nuevoToken = jwt.sign(nuevoPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.json({ ok: true, token: nuevoToken });

  } catch (err) {
    console.error('[POST /api/auth/refresh]', err.message);
    res.status(500).json({ ok: false, error: 'Error al renovar sesiÃ³n' });
  }
});

module.exports = router;
