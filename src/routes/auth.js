'use strict';

/**
 * routes/auth.js
 *
 * Endpoints de autenticación:
 *   POST /api/auth/login        — Inicio de sesión (email + password)
 *   GET  /api/auth/me           — Perfil del usuario autenticado
 *   POST /api/auth/logout       — Cierre de sesión (client-side)
 *   POST /api/auth/refresh      — Renovación silenciosa de token JWT
 */

const express                  = require('express');
const router                   = express.Router();
const jwt                      = require('jsonwebtoken');
const db                       = require('../config/db');
const { verifyPasswordDjango, parseDjangoHash } = require('../utils/pbkdf2Django');
const { updateLastLogin }      = require('../models/usuario');
const { requireAuth }          = require('../middlewares/requireAuth');

const JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

function normalizarLogin(valor) {
  return String(valor || '').trim().toLowerCase();
}

function logLoginFailure(motivo, detalle = {}) {
  const logData = {
    login: detalle.login || '',
    userId: detalle.userId || null,
    email: detalle.email || '',
    passwordState: detalle.passwordState || '',
  };
  console.warn(`[POST /api/auth/login] ${motivo}`, logData);
}

function describirPasswordGuardado(encoded) {
  if (!encoded || !String(encoded).trim()) return 'password_vacio';

  try {
    const parsed = parseDjangoHash(encoded);
    if (parsed.algorithm !== 'pbkdf2_sha256') return 'formato_no_soportado';
    return 'ok';
  } catch {
    return 'formato_no_soportado';
  }
}

function normalizarVendedores(vendedores) {
  return (vendedores || []).map(v => ({
    ...v,
    cod_vendedor: String(v?.cod_vendedor || '').trim(),
    tipo: String(v?.tipo || '').trim().toUpperCase(),
  }));
}

function normalizarMenus(menus) {
  return (menus || [])
    .map(menu => ({
      id: Number(menu?.id) || menu?.id || null,
      codigo: String(menu?.codigo || '').trim(),
      nombre: String(menu?.nombre || '').trim(),
      url: String(menu?.url || '').trim(),
      icono: String(menu?.icono || '').trim(),
      grupo: String(menu?.grupo || 'General').trim() || 'General',
      orden: Number(menu?.orden ?? 0) || 0,
    }))
    .filter(menu => menu.id !== null && menu.url);
}

async function cargarMenusAsignados(usuarioId) {
  const [rows] = await db.pool.query(
    `SELECT DISTINCT
        m.id,
        m.codigo,
        m.nombre,
        m.url,
        m.icono,
        m.grupo,
        m.orden
     FROM menu m
     INNER JOIN (
       SELECT um.menu_id
       FROM usuario_menu um
       WHERE um.usuario_id = ?
         AND um.activo = 1
       UNION
       SELECT pm.menu_id
       FROM usuario_perfil up
       INNER JOIN perfil p ON p.id = up.perfil_id
       INNER JOIN perfil_menu pm ON pm.perfil_id = p.id
       WHERE up.usuario_id = ?
         AND up.activo = 1
         AND p.activo = 1
         AND pm.activo = 1
     ) accesos ON accesos.menu_id = m.id
     WHERE m.activo = 1
     ORDER BY m.orden ASC, m.grupo ASC, m.nombre ASC`,
    [usuarioId, usuarioId]
  );

  return normalizarMenus(rows);
}

async function cargarPerfilesAsignados(usuarioId) {
  const [rows] = await db.pool.query(
    `SELECT DISTINCT
        p.id,
        p.codigo,
        p.nombre,
        p.descripcion,
        p.activo
     FROM usuario_perfil up
     INNER JOIN perfil p ON p.id = up.perfil_id
     WHERE up.usuario_id = ?
       AND up.activo = 1
       AND p.activo = 1
     ORDER BY p.nombre ASC`,
    [usuarioId]
  );

  return (rows || []).map(perfil => ({
    id: Number(perfil?.id) || perfil?.id || null,
    codigo: String(perfil?.codigo || '').trim(),
    nombre: String(perfil?.nombre || '').trim(),
    descripcion: String(perfil?.descripcion || '').trim(),
    activo: Boolean(Number(perfil?.activo)),
  })).filter(perfil => perfil.id !== null);
}

async function cargarCatalogoMenus() {
  const [rows] = await db.pool.query(
    `SELECT
        m.id,
        m.codigo,
        m.nombre,
        m.url,
        m.icono,
        m.grupo,
        m.orden
     FROM menu m
     WHERE m.activo = 1
     ORDER BY m.orden ASC, m.grupo ASC, m.nombre ASC`
  );

  return normalizarMenus(rows);
}

async function cargarMenusUsuario(usuarioId) {
  const [menus, perfiles, allMenus] = await Promise.all([
    cargarMenusAsignados(usuarioId),
    cargarPerfilesAsignados(usuarioId),
    cargarCatalogoMenus(),
  ]);

  return { menus, perfiles, allMenus };
}

// â”€â”€ POST /api/auth/login â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/login', async (req, res) => {
  // Acepta tanto { email } (frontend actual) como { usuario } (retrocompat)
  const { email, usuario, password } = req.body;
  const loginFinal = normalizarLogin(email || usuario);

  if (!loginFinal || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });
  }

  try {
    const [rows] = await db.pool.query(
      `SELECT u.id, u.email, u.nombre, u.password, u.area, u.is_admin, u.is_active
       FROM usuario u
       WHERE LOWER(TRIM(COALESCE(u.email, ''))) = ?
          OR LOWER(TRIM(COALESCE(u.nombre, ''))) = ?
          OR LOWER(TRIM(COALESCE(u.codigo, ''))) = ?
       LIMIT 1`,
      [loginFinal, loginFinal, loginFinal]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      logLoginFailure(user ? 'usuario_inactivo' : 'usuario_no_encontrado', {
        login: loginFinal,
        userId: user?.id,
        email: user?.email,
      });
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    const passwordState = describirPasswordGuardado(user.password);
    if (passwordState === 'password_vacio') {
      logLoginFailure('password_vacio', {
        login: loginFinal,
        userId: user.id,
        email: user.email,
        passwordState,
      });
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    if (passwordState === 'formato_no_soportado') {
      logLoginFailure('formato_no_soportado', {
        login: loginFinal,
        userId: user.id,
        email: user.email,
        passwordState,
      });
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    // Las contraseñas están en formato PBKDF2-SHA256 de Django (600.000 iter)
    const match = verifyPasswordDjango(password, user.password);
    if (!match) {
      logLoginFailure('password_incorrecta', {
        login: loginFinal,
        userId: user.id,
        email: user.email,
        passwordState,
      });
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
    }

    // Registrar último acceso
    await updateLastLogin(user.id);

    // Cargar vendedores asociados
    const [vendedores] = await db.pool.query(
      `SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?`,
      [user.id]
    );
    const vendedoresNormalizados = normalizarVendedores(vendedores);
    const { menus, perfiles, allMenus } = await cargarMenusUsuario(user.id);

    const payload = {
      id:        user.id,
      sub:       user.id,
      email:     user.email,
      nombre:    user.nombre,
      area:      user.area,
      is_admin:  user.is_admin,
      vendedores: vendedoresNormalizados,
      perfiles,
      menus,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.json({
      ok:    true,
      token,
      user:  { ...payload },
      allMenus,
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
      return res.status(401).json({ ok: false, error: 'Sesión no valida' });
    }
    const [vendedores] = await db.pool.query(
      `SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ?`,
      [user.id]
    );
    const vendedoresNormalizados = normalizarVendedores(vendedores);
    const { menus, perfiles, allMenus } = await cargarMenusUsuario(user.id);
    res.json({ ok: true, user: { ...user, vendedores: vendedoresNormalizados, perfiles, menus }, allMenus });
  } catch (err) {
    console.error('[GET /api/auth/me]', err.message);
    res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// â”€â”€ POST /api/auth/logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// JWT es stateless; logout se gestiona borrando el token en el cliente.
router.post('/logout', requireAuth, (_req, res) => {
  res.json({ ok: true, message: 'Sesión cerrada' });
});

// POST /api/auth/refresh
/**
 * Renovación silenciosa de token JWT.
 * Acepta tokens expirados hace menos de 24h con firma válida.
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
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }

  const ahora       = Math.floor(Date.now() / 1000);
  const expiracion  = decoded.exp || 0;
  const VENTANA_SEG = 24 * 60 * 60;

  if (ahora - expiracion > VENTANA_SEG) {
    return res.status(401).json({ ok: false, error: 'Token demasiado antiguo para renovar. Inicia sesión nuevamente.' });
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
    const vendedoresNormalizados = normalizarVendedores(vendedores);
    const { menus, perfiles, allMenus } = await cargarMenusUsuario(user.id);
    const nuevoPayload = {
      id:        user.id,
      sub:       user.id,
      email:     user.email,
      nombre:    user.nombre,
      area:      user.area,
      is_admin:  user.is_admin,
      vendedores: vendedoresNormalizados,
      perfiles,
      menus,
    };
    const nuevoToken = jwt.sign(nuevoPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    res.json({ ok: true, token: nuevoToken, allMenus });

  } catch (err) {
    console.error('[POST /api/auth/refresh]', err.message);
    res.status(500).json({ ok: false, error: 'Error al renovar sesión' });
  }
});

module.exports = router;
