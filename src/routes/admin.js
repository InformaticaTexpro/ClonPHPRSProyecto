'use strict';

const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const { requireAuth } = require('../middlewares/requireAuth');
const { hashPasswordDjango } = require('../utils/pbkdf2Django');
const vendedorMetaModel = require('../models/vendedorMeta');

const router = express.Router();

const ADMIN_MENU_CODE = 'administracion';

const AREA_SUGGESTIONS = {
  ventas: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'alertas'],
  produccion: ['produccion', 'bodega', 'alertas'],
  bodega: ['bodega', 'alertas'],
  'servicio-tecnico': ['servicio_tecnico', 'alertas'],
  facturacion: ['facturacion', 'alertas'],
  contabilidad: ['contabilidad', 'cobranza', 'alertas'],
  rrhh: ['rrhh', 'alertas'],
  gerencia: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'gerencia', 'alertas'],
  administracion: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'produccion', 'bodega', 'servicio_tecnico', 'facturacion', 'rrhh', 'contabilidad', 'cobranza', 'administracion', 'alertas', 'gerencia'],
  admin: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'produccion', 'bodega', 'servicio_tecnico', 'facturacion', 'rrhh', 'contabilidad', 'cobranza', 'administracion', 'alertas', 'gerencia'],
};

function requireAdmin(req, res, next) {
  if (!req.usuario || Number(req.usuario.is_admin) !== 1) {
    return res.status(403).json({ ok: false, error: 'Solo administradores' });
  }
  next();
}

router.use(requireAuth, requireAdmin);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function cleanCode(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-');
}

function asBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalizeKey(value);
  if (['1', 'true', 'si', 'sÃ­', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeText(value));
}

function isValidMenuUrl(value) {
  const text = normalizeText(value);
  return text.startsWith('/') && /\/index\.html(\?.*)?$/i.test(text);
}

function asNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitMenuPayload(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  if (typeof value === 'string' && value.includes(',')) {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [value];
}

function normalizeVendorType(value) {
  const normalized = normalizeKey(value).toUpperCase();
  if (['P', 'PRINCIPAL'].includes(normalized)) return 'P';
  if (['C', 'COMPARTIDO'].includes(normalized)) return 'C';
  if (['S', 'SUPERVISOR'].includes(normalized)) return 'S';
  return null;
}

function formatAreaLabel(value) {
  const normalized = normalizeKey(value);
  const labels = {
    ventas: 'Ventas',
    produccion: 'ProducciÃ³n',
    bodega: 'Bodega',
    'servicio-tecnico': 'Servicio TÃ©cnico',
    facturacion: 'FacturaciÃ³n',
    contabilidad: 'Contabilidad',
    rrhh: 'RRHH',
    gerencia: 'Gerencia',
    administracion: 'AdministraciÃ³n',
    admin: 'AdministraciÃ³n',
  };
  return labels[normalized] || normalizeText(value) || 'Sin Ã¡rea';
}

function buildSuggestions(area) {
  const normalized = normalizeKey(area);
  return AREA_SUGGESTIONS[normalized] || [];
}

function boolToDb(value, fallback = 0) {
  const result = asBoolean(value, null);
  if (result === null) return fallback ? 1 : 0;
  return result ? 1 : 0;
}

function adminError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function withConnection(work) {
  if (typeof db.pool.getConnection === 'function') {
    const conn = await db.pool.getConnection();
    try {
      return await work(conn);
    } finally {
      if (typeof conn.release === 'function') conn.release();
    }
  }

  const fallbackConn = {
    query: (...args) => db.pool.query(...args),
    execute: (...args) => db.pool.execute(...args),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  return work(fallbackConn);
}

async function withTransaction(work) {
  return withConnection(async conn => {
    if (typeof conn.beginTransaction === 'function') {
      await conn.beginTransaction();
    }
    try {
      const result = await work(conn);
      if (typeof conn.commit === 'function') {
        await conn.commit();
      }
      return result;
    } catch (error) {
      if (typeof conn.rollback === 'function') {
        try {
          await conn.rollback();
        } catch (rollbackError) {
          console.error('[ADMIN] rollback fallÃ³:', rollbackError);
        }
      }
      throw error;
    }
  });
}

function requireId(id, label = 'ID') {
  const parsed = asNumber(id, null);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error(`${label} invÃ¡lido`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function mapUserPayload(row) {
  if (!row) return null;
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    codigo: row.codigo,
    area: row.area,
    area_label: formatAreaLabel(row.area),
    is_admin: Boolean(Number(row.is_admin)),
    is_active: Boolean(Number(row.is_active)),
    last_login: row.last_login || null,
    created_at: row.created_at || row.fecha_creacion || null,
    vendedores: Array.isArray(row.vendedores) ? row.vendedores : [],
    menus: Array.isArray(row.menus) ? row.menus : [],
    menu_ids: Array.isArray(row.menus) ? row.menus.map(menu => menu.id) : [],
    perfiles: Array.isArray(row.perfiles) ? row.perfiles : [],
    perfil_ids: Array.isArray(row.perfiles) ? row.perfiles.map(perfil => perfil.id) : [],
  };
}

function mapMenuRow(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    url: row.url,
    icono: row.icono || '',
    grupo: row.grupo || 'General',
    orden: Number(row.orden) || 0,
    activo: Boolean(Number(row.activo)),
  };
}

function mapProfileRow(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    area: row.area || '',
    es_base: Boolean(Number(row.es_base)),
    activo: Boolean(Number(row.activo)),
  };
}

function mapAreaRow(row) {
  return {
    id: row.id,
    codigo: row.codigo,
    nombre: row.nombre,
    descripcion: row.descripcion || '',
    perfil_base_id: row.perfil_base_id !== null && row.perfil_base_id !== undefined ? Number(row.perfil_base_id) : null,
    perfil_base_nombre: row.perfil_base_nombre || '',
    perfil_base_codigo: row.perfil_base_codigo || '',
    activo: Boolean(Number(row.activo)),
    total_usuarios: Number(row.total_usuarios || 0),
    total_usuarios_activos: Number(row.total_usuarios_activos || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    sugeridos: buildSuggestions(row.codigo),
  };
}

// La migraciÃ³n `src/database/perfiles_area_es_base_migration.sql` agrega
// `perfil.area` y `perfil.es_base`. Mientras no estÃ© aplicada, el router
// conserva un fallback seguro para no romper el arranque.
let perfilSchemaCache = null;

async function getPerfilSchema(conn) {
  if (perfilSchemaCache) {
    return perfilSchemaCache;
  }

  try {
    const [areaRows] = await conn.query('SHOW COLUMNS FROM perfil LIKE ?', ['area']);
    const [baseRows] = await conn.query('SHOW COLUMNS FROM perfil LIKE ?', ['es_base']);
    perfilSchemaCache = {
      hasArea: Array.isArray(areaRows) && areaRows.length > 0,
      hasEsBase: Array.isArray(baseRows) && baseRows.length > 0,
    };
  } catch {
    perfilSchemaCache = { hasArea: false, hasEsBase: false };
  }

  return perfilSchemaCache;
}

let areaSchemaCache = null;

async function getAreaSchema(conn) {
  if (areaSchemaCache) {
    return areaSchemaCache;
  }

  try {
    const [tableRows] = await conn.query("SHOW TABLES LIKE 'area'");
    areaSchemaCache = {
      exists: Array.isArray(tableRows) && tableRows.length > 0,
    };
  } catch {
    areaSchemaCache = { exists: false };
  }

  return areaSchemaCache;
}

async function loadAreas(conn, areaId = null) {
  const schema = await getAreaSchema(conn);
  if (!schema.exists) {
    const [rows] = await conn.query(
      `SELECT DISTINCT area, COUNT(*) AS total
       FROM usuario
       WHERE TRIM(COALESCE(area, '')) <> ''
       GROUP BY area
       ORDER BY area ASC`
    );

    return rows.map(row => ({
      id: null,
      codigo: normalizeKey(row.area),
      nombre: formatAreaLabel(row.area),
      descripcion: '',
      perfil_base_id: null,
      perfil_base_nombre: '',
      perfil_base_codigo: '',
      activo: true,
      total_usuarios: Number(row.total || 0),
      total_usuarios_activos: Number(row.total || 0),
      created_at: null,
      updated_at: null,
      sugeridos: buildSuggestions(row.area),
    }));
  }

  const params = [];
  let sql = `
    SELECT
      a.id,
      a.codigo,
      a.nombre,
      a.descripcion,
      a.perfil_base_id,
      p.nombre AS perfil_base_nombre,
      p.codigo AS perfil_base_codigo,
      a.activo,
      a.created_at,
      a.updated_at,
      COUNT(DISTINCT u.id) AS total_usuarios,
      SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS total_usuarios_activos
    FROM area a
    LEFT JOIN perfil p ON p.id = a.perfil_base_id
    LEFT JOIN usuario u
      ON LOWER(TRIM(COALESCE(u.area, ''))) = LOWER(TRIM(COALESCE(a.codigo, '')))
  `;
  if (areaId !== null) {
    sql += ' WHERE a.id = ?';
    params.push(areaId);
  }
  sql += ' GROUP BY a.id, a.codigo, a.nombre, a.descripcion, a.perfil_base_id, p.nombre, p.codigo, a.activo, a.created_at, a.updated_at';
  sql += ' ORDER BY a.nombre ASC';

  const [rows] = await conn.query(sql, params);
  return rows.map(mapAreaRow);
}

async function loadAreaById(conn, areaId) {
  const areas = await loadAreas(conn, areaId);
  return areas[0] || null;
}

async function loadAreaByCode(conn, codigo) {
  const schema = await getAreaSchema(conn);
  if (!schema.exists) return null;

  const [rows] = await conn.query(
    `SELECT
       a.id,
       a.codigo,
       a.nombre,
       a.descripcion,
       a.perfil_base_id,
       p.nombre AS perfil_base_nombre,
       p.codigo AS perfil_base_codigo,
       a.activo,
       a.created_at,
       a.updated_at,
       COUNT(DISTINCT u.id) AS total_usuarios,
       SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS total_usuarios_activos
     FROM area a
     LEFT JOIN perfil p ON p.id = a.perfil_base_id
     LEFT JOIN usuario u
       ON LOWER(TRIM(COALESCE(u.area, ''))) = LOWER(TRIM(COALESCE(a.codigo, '')))
     WHERE LOWER(TRIM(a.codigo)) = LOWER(TRIM(?))
     GROUP BY a.id, a.codigo, a.nombre, a.descripcion, a.perfil_base_id, p.nombre, p.codigo, a.activo, a.created_at, a.updated_at
     LIMIT 1`,
    [codigo]
  );
  return rows[0] ? mapAreaRow(rows[0]) : null;
}

function mapVendorRow(row) {
  return {
    cod_vendedor: String(row.cod_vendedor || '').trim(),
    tipo: String(row.tipo || '').trim().toUpperCase(),
  };
}

async function loadUsers(conn, userId = null) {
  const params = [];
  let sql = `
    SELECT
      u.id,
      u.nombre,
      u.email,
      u.codigo,
      u.area,
      u.is_admin,
      u.is_active,
      u.last_login,
      u.fecha_creacion AS created_at
    FROM usuario u
  `;
  if (userId !== null) {
    sql += ' WHERE u.id = ?';
    params.push(userId);
  }
  sql += ' ORDER BY u.nombre ASC';

  const [users] = await conn.query(sql, params);
  if (!users.length) return [];

  const ids = users.map(user => user.id);
  const placeholders = ids.map(() => '?').join(',');

  const [vendors] = await conn.query(
    `SELECT usuario_id, cod_vendedor, tipo
     FROM usuario_vendedor
     WHERE usuario_id IN (${placeholders})
     ORDER BY usuario_id ASC, cod_vendedor ASC`,
    ids
  );

  const [menus] = await conn.query(
    `SELECT
       um.usuario_id,
       m.id,
       m.codigo,
       m.nombre,
       m.url,
       m.icono,
       m.grupo,
       m.orden,
       m.activo,
       um.activo AS asignado_activo
     FROM usuario_menu um
     INNER JOIN menu m ON m.id = um.menu_id
     WHERE um.usuario_id IN (${placeholders})
     ORDER BY um.usuario_id ASC, m.orden ASC, m.nombre ASC`,
    ids
  );

  const [profiles] = await conn.query(
    `SELECT
       up.usuario_id,
       p.id,
       p.codigo,
       p.nombre,
       p.descripcion,
       p.area,
       p.es_base,
       p.activo,
       up.activo AS asignado_activo
     FROM usuario_perfil up
     INNER JOIN perfil p ON p.id = up.perfil_id
     WHERE up.usuario_id IN (${placeholders})
     ORDER BY up.usuario_id ASC, p.es_base DESC, p.area ASC, p.nombre ASC`,
    ids
  );

  const vendorsByUser = new Map();
  vendors.forEach(row => {
    const key = Number(row.usuario_id);
    if (!vendorsByUser.has(key)) vendorsByUser.set(key, []);
    vendorsByUser.get(key).push(mapVendorRow(row));
  });

  const menusByUser = new Map();
  menus.forEach(row => {
    const key = Number(row.usuario_id);
    if (!menusByUser.has(key)) menusByUser.set(key, []);
    menusByUser.get(key).push(mapMenuRow(row));
  });

  const profilesByUser = new Map();
  profiles.forEach(row => {
    const key = Number(row.usuario_id);
    if (!profilesByUser.has(key)) profilesByUser.set(key, []);
    profilesByUser.get(key).push({
      ...mapProfileRow(row),
      asignado_activo: Boolean(Number(row.asignado_activo)),
    });
  });

  return users.map(user => mapUserPayload({
    ...user,
    vendedores: vendorsByUser.get(Number(user.id)) || [],
    menus: menusByUser.get(Number(user.id)) || [],
    perfiles: profilesByUser.get(Number(user.id)) || [],
  }));
}

async function loadUser(conn, userId) {
  const users = await loadUsers(conn, userId);
  return users[0] || null;
}

async function loadMenus(conn) {
  const [rows] = await conn.query(
    `SELECT id, codigo, nombre, url, icono, grupo, orden, activo
     FROM menu
     ORDER BY grupo ASC, orden ASC, nombre ASC`
  );
  return rows.map(mapMenuRow);
}

async function loadMenuById(conn, menuId) {
  const [rows] = await conn.query(
    `SELECT id, codigo, nombre, url, icono, grupo, orden, activo
     FROM menu
     WHERE id = ?
     LIMIT 1`,
    [menuId]
  );
  return rows[0] ? mapMenuRow(rows[0]) : null;
}

async function loadProfiles(conn, profileId = null) {
  const schema = await getPerfilSchema(conn);
  const params = [];
  let sql = `
    SELECT
      p.id,
      p.codigo,
      p.nombre,
      p.descripcion,
      ${schema.hasArea ? 'p.area' : "'' AS area"},
      ${schema.hasEsBase ? 'p.es_base' : '0 AS es_base'},
      p.activo
    FROM perfil p
  `;
  if (profileId !== null) {
    sql += ' WHERE p.id = ?';
    params.push(profileId);
  }
  sql += schema.hasArea || schema.hasEsBase
    ? ` ORDER BY ${schema.hasEsBase ? 'p.es_base DESC, ' : ''}${schema.hasArea ? 'p.area ASC, ' : ''}p.nombre ASC`
    : ' ORDER BY p.nombre ASC';

  const [profiles] = await conn.query(sql, params);
  if (!profiles.length) return [];

  const ids = profiles.map(profile => profile.id);
  const placeholders = ids.map(() => '?').join(',');

  const [menus] = await conn.query(
    `SELECT
       pm.perfil_id,
       m.id,
       m.codigo,
       m.nombre,
       m.url,
       m.icono,
       m.grupo,
       m.orden,
       m.activo,
       pm.activo AS asignado_activo
     FROM perfil_menu pm
     INNER JOIN menu m ON m.id = pm.menu_id
     WHERE pm.perfil_id IN (${placeholders})
     ORDER BY pm.perfil_id ASC, m.orden ASC, m.nombre ASC`,
    ids
  );

  const [users] = await conn.query(
    `SELECT
       up.perfil_id,
       u.id,
       u.nombre,
       u.email,
       u.area,
       u.codigo,
       u.is_active,
       up.activo AS asignado_activo
     FROM usuario_perfil up
     INNER JOIN usuario u ON u.id = up.usuario_id
     WHERE up.perfil_id IN (${placeholders})
     ORDER BY up.perfil_id ASC, u.nombre ASC`,
    ids
  );

  const menusByProfile = new Map();
  menus.forEach(row => {
    const key = Number(row.perfil_id);
    if (!menusByProfile.has(key)) menusByProfile.set(key, []);
    menusByProfile.get(key).push(mapMenuRow(row));
  });

  const usersByProfile = new Map();
  users.forEach(row => {
    const key = Number(row.perfil_id);
    if (!usersByProfile.has(key)) usersByProfile.set(key, []);
    usersByProfile.get(key).push({
      id: row.id,
      nombre: row.nombre,
      email: row.email,
      codigo: row.codigo,
      area: row.area,
      is_active: Boolean(Number(row.is_active)),
      asignado_activo: Boolean(Number(row.asignado_activo)),
    });
  });

  return profiles.map(profile => ({
    ...mapProfileRow(profile),
    menus: menusByProfile.get(Number(profile.id)) || [],
    usuarios: usersByProfile.get(Number(profile.id)) || [],
    menu_ids: (menusByProfile.get(Number(profile.id)) || []).map(menu => menu.id),
    usuario_ids: (usersByProfile.get(Number(profile.id)) || []).map(user => user.id),
  }));
}

async function loadProfileById(conn, profileId) {
  const profiles = await loadProfiles(conn, profileId);
  return profiles[0] || null;
}

async function loadUserProfiles(conn, userId) {
  const schema = await getPerfilSchema(conn);
  const [rows] = await conn.query(
    `SELECT
       p.id,
       p.codigo,
       p.nombre,
       p.descripcion,
       ${schema.hasArea ? 'p.area' : "'' AS area"},
       ${schema.hasEsBase ? 'p.es_base' : '0 AS es_base'},
       p.activo,
       up.activo AS asignado_activo
     FROM usuario_perfil up
     INNER JOIN perfil p ON p.id = up.perfil_id
     WHERE up.usuario_id = ?
       AND up.activo = 1
       AND p.activo = 1
     ORDER BY ${schema.hasEsBase ? 'p.es_base DESC, ' : ''}${schema.hasArea ? 'p.area ASC, ' : ''}p.nombre ASC`,
    [userId]
  );
  return rows.map(row => ({
    ...mapProfileRow(row),
    asignado_activo: Boolean(Number(row.asignado_activo)),
  }));
}

async function loadBaseProfileByArea(conn, area) {
  const areaRow = await loadAreaByCode(conn, area);
  if (areaRow?.perfil_base_id) {
    const [rows] = await conn.query(
      `SELECT id, codigo, nombre, descripcion, area, es_base, activo
       FROM perfil
       WHERE id = ?
         AND activo = 1
       LIMIT 1`,
      [areaRow.perfil_base_id]
    );
    if (rows[0]) {
      return mapProfileRow(rows[0]);
    }
  }

  const schema = await getPerfilSchema(conn);
  if (!schema.hasArea || !schema.hasEsBase) {
    return null;
  }

  const [rows] = await conn.query(
    `SELECT id, codigo, nombre, descripcion, area, es_base, activo
     FROM perfil
     WHERE es_base = 1
       AND LOWER(TRIM(COALESCE(area, ''))) = LOWER(TRIM(COALESCE(?, '')))
       AND activo = 1
     ORDER BY id ASC
     LIMIT 1`,
    [area]
  );
  return rows[0] ? mapProfileRow(rows[0]) : null;
}

async function loadBaseProfileIdsForArea(conn, area) {
  const areaRow = await loadAreaByCode(conn, area);
  if (areaRow?.perfil_base_id) {
    return [Number(areaRow.perfil_base_id)];
  }

  return [];
}

async function syncUserBaseProfileByArea(conn, userId, area, previousArea = null) {
  const nextBase = await loadBaseProfileByArea(conn, area);
  const idsToRemove = new Set(await loadBaseProfileIdsForArea(conn, area));
  if (previousArea && normalizeKey(previousArea) !== normalizeKey(area)) {
    (await loadBaseProfileIdsForArea(conn, previousArea)).forEach(id => idsToRemove.add(id));
  }

  if (idsToRemove.size) {
    const placeholders = Array.from(idsToRemove).map(() => '?').join(', ');
    await conn.query(
      `DELETE FROM usuario_perfil
       WHERE usuario_id = ?
         AND perfil_id IN (${placeholders})`,
      [userId, ...idsToRemove]
    );
  }

  if (nextBase) {
    await conn.query(
      `INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
      [userId, nextBase.id]
    );
  }

  return nextBase;
}

async function countActiveAdmins(conn, excludeUserId = null) {
  const params = [];
  let sql = 'SELECT COUNT(*) AS total FROM usuario WHERE is_active = 1 AND is_admin = 1';
  if (excludeUserId !== null) {
    sql += ' AND id <> ?';
    params.push(excludeUserId);
  }
  const [rows] = await conn.query(sql, params);
  return Number(rows[0]?.total || 0);
}

async function resolveMenus(conn, rawMenus) {
  const items = splitMenuPayload(rawMenus)
    .map(item => {
      if (item && typeof item === 'object') {
        if (item.id !== undefined && item.id !== null) return { type: 'id', value: requireId(item.id, 'menu_id') };
        if (item.codigo !== undefined && item.codigo !== null) return { type: 'codigo', value: normalizeText(item.codigo) };
      }
      const maybeId = asNumber(item, null);
      if (maybeId !== null) return { type: 'id', value: maybeId };
      return { type: 'codigo', value: normalizeText(item) };
    })
    .filter(item => item.value !== '');

  if (!items.length) return [];

  const menus = await loadMenus(conn);
  const byId = new Map(menus.map(menu => [Number(menu.id), menu]));
  const byCode = new Map(menus.map(menu => [normalizeKey(menu.codigo), menu]));

  const resolved = [];
  const missing = [];
  const seen = new Set();

  items.forEach(item => {
    const menu = item.type === 'id'
      ? byId.get(Number(item.value))
      : byCode.get(normalizeKey(item.value));

    if (!menu) {
      missing.push(String(item.value));
      return;
    }

    if (!seen.has(menu.id)) {
      seen.add(menu.id);
      resolved.push(menu);
    }
  });

  if (missing.length) {
    throw adminError('MENU_NO_EXISTE', `MenÃºs no encontrados: ${missing.join(', ')}`);
  }

  return resolved;
}

async function resolveProfiles(conn, rawProfiles) {
  const items = splitMenuPayload(rawProfiles)
    .map(item => {
      if (item && typeof item === 'object') {
        if (item.id !== undefined && item.id !== null) return { type: 'id', value: requireId(item.id, 'perfil_id') };
        if (item.codigo !== undefined && item.codigo !== null) return { type: 'codigo', value: normalizeText(item.codigo) };
      }
      const maybeId = asNumber(item, null);
      if (maybeId !== null) return { type: 'id', value: maybeId };
      return { type: 'codigo', value: normalizeText(item) };
    })
    .filter(item => item.value !== '');

  if (!items.length) return [];

  const profiles = await loadProfiles(conn);
  const byId = new Map(profiles.map(profile => [Number(profile.id), profile]));
  const byCode = new Map(profiles.map(profile => [normalizeKey(profile.codigo), profile]));

  const resolved = [];
  const missing = [];
  const seen = new Set();

  items.forEach(item => {
    const profile = item.type === 'id'
      ? byId.get(Number(item.value))
      : byCode.get(normalizeKey(item.value));

    if (!profile) {
      missing.push(String(item.value));
      return;
    }

    if (!seen.has(profile.id)) {
      seen.add(profile.id);
      resolved.push(profile);
    }
  });

  if (missing.length) {
    throw adminError('PERFIL_NO_EXISTE', `Perfiles no encontrados: ${missing.join(', ')}`);
  }

  return resolved;
}

async function syncUserMenus(conn, userId, menus) {
  await conn.query('UPDATE usuario_menu SET activo = 0 WHERE usuario_id = ?', [userId]);
  for (const menu of menus) {
    await conn.query(
      `INSERT INTO usuario_menu (usuario_id, menu_id, activo)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
      [userId, menu.id]
    );
  }
}

function assertSelfAdminGuard(req, targetId, nextIsAdmin, confirmed) {
  const currentId = Number(req.usuario?.id ?? req.usuario?.sub);
  if (Number(targetId) === currentId && !nextIsAdmin && !confirmed) {
    const error = new Error('No puedes quitarte permisos de administraciÃ³n sin confirmaciÃ³n');
    error.status = 400;
    throw error;
  }
}

async function loadAdminPayload(conn, userId = null) {
  const [usuarios, menus, areas] = await Promise.all([
    loadUsers(conn, userId),
    loadMenus(conn),
    loadAreas(conn),
  ]);

  return {
    usuarios,
    menus,
    areas,
  };
}

router.get('/usuarios', async (_req, res) => {
  try {
    const { usuarios } = await withConnection(conn => loadAdminPayload(conn));
    res.json({ ok: true, data: usuarios });
  } catch (error) {
    console.error('[ADMIN] GET /usuarios:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener usuarios' });
  }
});

router.get('/usuarios/:id', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const usuario = await withConnection(conn => loadUser(conn, userId));
    if (!usuario) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }
    res.json({ ok: true, data: usuario });
  } catch (error) {
    console.error('[ADMIN] GET /usuarios/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener usuario' });
  }
});

router.post('/usuarios', async (req, res) => {
  try {
    const nombre = normalizeText(req.body.nombre);
    const email = normalizeText(req.body.email).toLowerCase();
    const codigo = cleanCode(req.body.codigo);
    const area = normalizeText(req.body.area);
    const isAdmin = boolToDb(req.body.is_admin, 0);
    const isActiveInput = asBoolean(req.body.is_active, true);
    const isActive = isActiveInput === null ? 1 : (isActiveInput ? 1 : 0);
    const password = normalizeText(req.body.password);

    if (!nombre || !email || !codigo || !area) {
      return res.status(400).json({ ok: false, error: 'Nombre, email, cÃ³digo y Ã¡rea son obligatorios' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Ingresa un correo vÃ¡lido.' });
    }

    const usuario = await withTransaction(async conn => {
      const [dupes] = await conn.query(
        'SELECT id FROM usuario WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1',
        [email]
      );
      if (dupes.length) {
        throw adminError('EMAIL_DUPLICADO', 'Ya existe un usuario con ese email', 409);
      }

      const [codigoDupes] = await conn.query(
        'SELECT id FROM usuario WHERE TRIM(codigo) = TRIM(?) LIMIT 1',
        [codigo]
      );
      if (codigoDupes.length) {
        throw adminError('CODIGO_DUPLICADO', 'Ya existe un usuario con ese cÃ³digo', 409);
      }

      const storedPassword = password
        ? hashPasswordDjango(password)
        : hashPasswordDjango(crypto.randomBytes(16).toString('hex'));
      const finalActive = password ? isActive : 0;

      const [result] = await conn.query(
        `INSERT INTO usuario (password, nombre, email, area, codigo, tema, is_active, is_admin, fecha_creacion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [storedPassword, nombre, email, area, codigo, normalizeText(req.body.tema) || 'Claro', finalActive, isAdmin]
      );

      await syncUserBaseProfileByArea(conn, result.insertId, area);

      return loadUser(conn, result.insertId);
    });

    res.status(201).json({
      ok: true,
      data: usuario,
      warning: password ? null : 'Usuario creado inactivo hasta definir contraseÃ±a segura',
    });
  } catch (error) {
    console.error('[ADMIN] POST /usuarios:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al crear usuario' });
  }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const nombre = normalizeText(req.body.nombre);
    const email = normalizeText(req.body.email).toLowerCase();
    const area = normalizeText(req.body.area);
    const isAdminInput = req.body.is_admin;
    const isActiveInput = req.body.is_active;
    const confirmed = asBoolean(req.body.confirmar, false) || asBoolean(req.body.confirmacion_fuerte, false);

    if (!nombre || !email || !area) {
      return res.status(400).json({ ok: false, error: 'Nombre, email y área son obligatorios' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Ingresa un correo válido.' });
    }

    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      const nextIsAdmin = isAdminInput === undefined ? current.is_admin : asBoolean(isAdminInput, current.is_admin);
      const nextIsActive = isActiveInput === undefined ? current.is_active : asBoolean(isActiveInput, current.is_active);

      assertSelfAdminGuard(req, userId, nextIsAdmin, confirmed);

      if (current.is_admin && (!nextIsAdmin || !nextIsActive)) {
        const adminsLeft = await countActiveAdmins(conn, userId);
        if (adminsLeft < 1) {
          const error = new Error('No se puede dejar el sistema sin administradores activos');
          error.status = 400;
          throw error;
        }
      }

      const [emailDupes] = await conn.query(
        'SELECT id FROM usuario WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1',
        [email, userId]
      );
      if (emailDupes.length) {
        throw adminError('EMAIL_DUPLICADO', 'Ya existe un usuario registrado con este correo.', 409);
      }

      await conn.query(
        `UPDATE usuario
         SET nombre = ?, email = ?, area = ?, is_admin = ?, is_active = ?
         WHERE id = ?`,
        [nombre, email, area, nextIsAdmin ? 1 : 0, nextIsActive ? 1 : 0, userId]
      );

      await syncUserBaseProfileByArea(conn, userId, area, current.area);

      return loadUser(conn, userId);
    });

    res.json({ ok: true, data: usuario });
  } catch (error) {
    console.error('[ADMIN] PUT /usuarios/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar usuario' });
  }
});

router.patch('/usuarios/:id/activar', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      await conn.query('UPDATE usuario SET is_active = 1 WHERE id = ?', [userId]);
      return loadUser(conn, userId);
    });
    res.json({ ok: true, data: usuario });
  } catch (error) {
    console.error('[ADMIN] PATCH /usuarios/:id/activar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al activar usuario' });
  }
});

router.patch('/usuarios/:id/desactivar', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const confirmed = asBoolean(req.body?.confirmar, false);
    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      assertSelfAdminGuard(req, userId, current.is_admin, confirmed);

      if (current.is_admin) {
        const adminsLeft = await countActiveAdmins(conn, userId);
        if (adminsLeft < 1) {
          const error = new Error('No se puede dejar el sistema sin administradores activos');
          error.status = 400;
          throw error;
        }
      }

      await conn.query('UPDATE usuario SET is_active = 0 WHERE id = ?', [userId]);
      return loadUser(conn, userId);
    });
    res.json({ ok: true, data: usuario });
  } catch (error) {
    console.error('[ADMIN] PATCH /usuarios/:id/desactivar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al desactivar usuario' });
  }
});

router.post('/usuarios/:id/toggle-activo', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      if (current.is_active) {
        if (current.is_admin) {
          const adminsLeft = await countActiveAdmins(conn, userId);
          if (adminsLeft < 1) {
            const error = new Error('No se puede dejar el sistema sin administradores activos');
            error.status = 400;
            throw error;
          }
        }
        await conn.query('UPDATE usuario SET is_active = 0 WHERE id = ?', [userId]);
      } else {
        await conn.query('UPDATE usuario SET is_active = 1 WHERE id = ?', [userId]);
      }

      return loadUser(conn, userId);
    });
    res.json({ ok: true, activo: Boolean(usuario?.is_active), data: usuario });
  } catch (error) {
    console.error('[ADMIN] POST /usuarios/:id/toggle-activo:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al cambiar estado del usuario' });
  }
});

router.delete('/usuarios/:id', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const confirmed = asBoolean(req.body?.confirmar, false);

    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      assertSelfAdminGuard(req, userId, current.is_admin, confirmed);

      if (current.is_admin) {
        const adminsLeft = await countActiveAdmins(conn, userId);
        if (adminsLeft < 1) {
          const error = new Error('No se puede dejar el sistema sin administradores activos');
          error.status = 400;
          throw error;
        }
      }

      await conn.query('UPDATE usuario SET is_active = 0 WHERE id = ?', [userId]);
      return loadUser(conn, userId);
    });

    res.json({ ok: true, data: usuario, deleted: false, mensaje: 'Usuario desactivado lÃ³gicamente' });
  } catch (error) {
    console.error('[ADMIN] DELETE /usuarios/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al eliminar usuario' });
  }
});

router.patch('/usuarios/:id/password', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const password = normalizeText(req.body.password);
    if (!password) {
      return res.status(400).json({ ok: false, error: 'La contraseÃ±a es obligatoria' });
    }

    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      const hash = hashPasswordDjango(password);
      await conn.query('UPDATE usuario SET password = ? WHERE id = ?', [hash, userId]);
      return loadUser(conn, userId);
    });

    res.json({ ok: true, data: usuario });
  } catch (error) {
    console.error('[ADMIN] PATCH /usuarios/:id/password:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar contraseÃ±a' });
  }
});

router.get('/menus', async (_req, res) => {
  try {
    const menus = await withConnection(conn => loadMenus(conn));
    res.json({ ok: true, data: menus });
  } catch (error) {
    console.error('[ADMIN] GET /menus:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener menÃºs' });
  }
});

router.get('/menus/:id', async (req, res) => {
  try {
    const menuId = requireId(req.params.id, 'MenÃº');
    const menu = await withConnection(conn => loadMenuById(conn, menuId));
    if (!menu) {
      return res.status(404).json({ ok: false, error: 'MenÃº no encontrado' });
    }
    res.json({ ok: true, data: menu });
  } catch (error) {
    console.error('[ADMIN] GET /menus/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener menÃº' });
  }
});

router.post('/menus', async (req, res) => {
  try {
    const codigo = cleanCode(req.body.codigo);
    const nombre = normalizeText(req.body.nombre);
    const url = normalizeText(req.body.url);
    const icono = normalizeText(req.body.icono);
    const grupo = normalizeText(req.body.grupo) || 'General';
    const orden = asNumber(req.body.orden, 0);
    const activo = asBoolean(req.body.activo, true);

    if (!codigo || !nombre || !url) {
      return res.status(400).json({ ok: false, error: 'CÃ³digo, nombre y URL son obligatorios' });
    }
    if (!isValidMenuUrl(url)) {
      return res.status(400).json({ ok: false, error: 'La URL debe comenzar con / y apuntar a un archivo index.html del mÃ³dulo.' });
    }

    const menu = await withTransaction(async conn => {
      const [dupes] = await conn.query('SELECT id FROM menu WHERE codigo = ? LIMIT 1', [codigo]);
      if (dupes.length) {
        throw adminError('MENU_DUPLICADO', 'Ya existe un menÃº con este cÃ³digo.', 409);
      }

      const [result] = await conn.query(
        `INSERT INTO menu (codigo, nombre, url, icono, grupo, orden, activo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [codigo, nombre, url, icono, grupo, Number.isFinite(orden) ? orden : 0, activo ? 1 : 0]
      );

      return loadMenuById(conn, result.insertId);
    });

    res.status(201).json({ ok: true, data: menu });
  } catch (error) {
    console.error('[ADMIN] POST /menus:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al crear menÃº' });
  }
});

router.put('/menus/:id', async (req, res) => {
  try {
    const menuId = requireId(req.params.id, 'MenÃº');
    const codigo = cleanCode(req.body.codigo);
    const nombre = normalizeText(req.body.nombre);
    const url = normalizeText(req.body.url);
    const icono = normalizeText(req.body.icono);
    const grupo = normalizeText(req.body.grupo) || 'General';
    const orden = asNumber(req.body.orden, 0);
    const activo = asBoolean(req.body.activo, true);

    if (!codigo || !nombre || !url) {
      return res.status(400).json({ ok: false, error: 'CÃ³digo, nombre y URL son obligatorios' });
    }
    if (!isValidMenuUrl(url)) {
      return res.status(400).json({ ok: false, error: 'La URL debe comenzar con / y apuntar a un archivo index.html del mÃ³dulo.' });
    }

    const menu = await withTransaction(async conn => {
      const current = await loadMenuById(conn, menuId);
      if (!current) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }

      const [dupes] = await conn.query(
        'SELECT id FROM menu WHERE codigo = ? AND id <> ? LIMIT 1',
        [codigo, menuId]
      );
      if (dupes.length) {
        throw adminError('MENU_DUPLICADO', 'Ya existe un menÃº con este cÃ³digo.', 409);
      }

      await conn.query(
        `UPDATE menu
         SET codigo = ?, nombre = ?, url = ?, icono = ?, grupo = ?, orden = ?, activo = ?
         WHERE id = ?`,
        [codigo, nombre, url, icono, grupo, Number.isFinite(orden) ? orden : 0, activo ? 1 : 0, menuId]
      );

      return loadMenuById(conn, menuId);
    });

    res.json({ ok: true, data: menu });
  } catch (error) {
    console.error('[ADMIN] PUT /menus/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar menÃº' });
  }
});

router.patch('/menus/:id/activar', async (req, res) => {
  try {
    const menuId = requireId(req.params.id, 'MenÃº');
    const menu = await withTransaction(async conn => {
      const current = await loadMenuById(conn, menuId);
      if (!current) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }
      await conn.query('UPDATE menu SET activo = 1 WHERE id = ?', [menuId]);
      return loadMenuById(conn, menuId);
    });
    res.json({ ok: true, data: menu });
  } catch (error) {
    console.error('[ADMIN] PATCH /menus/:id/activar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al activar menÃº' });
  }
});

router.patch('/menus/:id/desactivar', async (req, res) => {
  try {
    const menuId = requireId(req.params.id, 'MenÃº');
    const menu = await withTransaction(async conn => {
      const current = await loadMenuById(conn, menuId);
      if (!current) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }
      await conn.query('UPDATE menu SET activo = 0 WHERE id = ?', [menuId]);
      return loadMenuById(conn, menuId);
    });
    res.json({ ok: true, data: menu });
  } catch (error) {
    console.error('[ADMIN] PATCH /menus/:id/desactivar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al desactivar menÃº' });
  }
});

router.delete('/menus/:id', async (req, res) => {
  try {
    const menuId = requireId(req.params.id, 'MenÃº');
    const menu = await withTransaction(async conn => {
      const current = await loadMenuById(conn, menuId);
      if (!current) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }

      const [refs] = await conn.query(
        'SELECT COUNT(*) AS total FROM usuario_menu WHERE menu_id = ?',
        [menuId]
      );
      const hasAssignments = Number(refs[0]?.total || 0) > 0;

      if (hasAssignments) {
        await conn.query('UPDATE menu SET activo = 0 WHERE id = ?', [menuId]);
        return { ...current, activo: false, deleted: false };
      }

      await conn.query('DELETE FROM menu WHERE id = ?', [menuId]);
      return { ...current, deleted: true };
    });

    res.json({ ok: true, data: menu });
  } catch (error) {
    console.error('[ADMIN] DELETE /menus/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al eliminar menÃº' });
  }
});

router.get('/perfiles', async (_req, res) => {
  try {
    const perfiles = await withConnection(conn => loadProfiles(conn));
    res.json({ ok: true, data: perfiles });
  } catch (error) {
    console.error('[ADMIN] GET /perfiles:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener perfiles' });
  }
});

router.get('/perfiles/:id', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const perfil = await withConnection(conn => loadProfileById(conn, profileId));
    if (!perfil) {
      return res.status(404).json({ ok: false, error: 'Perfil no encontrado' });
    }
    res.json({ ok: true, data: perfil });
  } catch (error) {
    console.error('[ADMIN] GET /perfiles/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener perfil' });
  }
});

router.post('/perfiles', async (req, res) => {
  try {
    const codigo = cleanCode(req.body.codigo);
    const nombre = normalizeText(req.body.nombre);
    const descripcion = normalizeText(req.body.descripcion);
    const area = normalizeText(req.body.area);
    const esBase = asBoolean(req.body.es_base, false);
    const activo = asBoolean(req.body.activo, true);

    if (!codigo || !nombre) {
      return res.status(400).json({ ok: false, error: 'CÃ³digo y nombre son obligatorios' });
    }

    const perfil = await withTransaction(async conn => {
      const [dupes] = await conn.query('SELECT id FROM perfil WHERE codigo = ? LIMIT 1', [codigo]);
      if (dupes.length) {
        throw adminError('PERFIL_DUPLICADO', 'Ya existe un perfil con este cÃ³digo.', 409);
      }

      const [result] = await conn.query(
        `INSERT INTO perfil (codigo, nombre, descripcion, area, es_base, activo)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [codigo, nombre, descripcion, area, esBase ? 1 : 0, activo ? 1 : 0]
      );

      return loadProfileById(conn, result.insertId);
    });

    res.status(201).json({ ok: true, data: perfil });
  } catch (error) {
    console.error('[ADMIN] POST /perfiles:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al crear perfil' });
  }
});

router.put('/perfiles/:id', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const codigo = cleanCode(req.body.codigo);
    const nombre = normalizeText(req.body.nombre);
    const descripcion = normalizeText(req.body.descripcion);
    const area = normalizeText(req.body.area);
    const esBase = asBoolean(req.body.es_base, false);
    const activo = asBoolean(req.body.activo, true);

    if (!codigo || !nombre) {
      return res.status(400).json({ ok: false, error: 'CÃ³digo y nombre son obligatorios' });
    }

    const perfil = await withTransaction(async conn => {
      const current = await loadProfileById(conn, profileId);
      if (!current) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }

      const [dupes] = await conn.query(
        'SELECT id FROM perfil WHERE codigo = ? AND id <> ? LIMIT 1',
        [codigo, profileId]
      );
      if (dupes.length) {
        throw adminError('PERFIL_DUPLICADO', 'Ya existe un perfil con este cÃ³digo.', 409);
      }

      await conn.query(
        `UPDATE perfil
         SET codigo = ?, nombre = ?, descripcion = ?, area = ?, es_base = ?, activo = ?
         WHERE id = ?`,
        [codigo, nombre, descripcion, area, esBase ? 1 : 0, activo ? 1 : 0, profileId]
      );

      return loadProfileById(conn, profileId);
    });

    res.json({ ok: true, data: perfil });
  } catch (error) {
    console.error('[ADMIN] PUT /perfiles/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar perfil' });
  }
});

router.patch('/perfiles/:id/activar', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const perfil = await withTransaction(async conn => {
      const current = await loadProfileById(conn, profileId);
      if (!current) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }
      await conn.query('UPDATE perfil SET activo = 1 WHERE id = ?', [profileId]);
      return loadProfileById(conn, profileId);
    });
    res.json({ ok: true, data: perfil });
  } catch (error) {
    console.error('[ADMIN] PATCH /perfiles/:id/activar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al activar perfil' });
  }
});

router.patch('/perfiles/:id/desactivar', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const perfil = await withTransaction(async conn => {
      const current = await loadProfileById(conn, profileId);
      if (!current) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }
      await conn.query('UPDATE perfil SET activo = 0 WHERE id = ?', [profileId]);
      return loadProfileById(conn, profileId);
    });
    res.json({ ok: true, data: perfil });
  } catch (error) {
    console.error('[ADMIN] PATCH /perfiles/:id/desactivar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al desactivar perfil' });
  }
});

router.delete('/perfiles/:id', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const perfil = await withTransaction(async conn => {
      const current = await loadProfileById(conn, profileId);
      if (!current) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }

      const [refsMenus] = await conn.query('SELECT COUNT(*) AS total FROM perfil_menu WHERE perfil_id = ?', [profileId]);
      const [refsUsers] = await conn.query('SELECT COUNT(*) AS total FROM usuario_perfil WHERE perfil_id = ?', [profileId]);
      const hasAssignments = Number(refsMenus[0]?.total || 0) > 0 || Number(refsUsers[0]?.total || 0) > 0;

      if (hasAssignments) {
        await conn.query('UPDATE perfil SET activo = 0 WHERE id = ?', [profileId]);
        return { ...current, activo: false, deleted: false };
      }

      await conn.query('DELETE FROM perfil WHERE id = ?', [profileId]);
      return { ...current, deleted: true };
    });

    res.json({ ok: true, data: perfil });
  } catch (error) {
    console.error('[ADMIN] DELETE /perfiles/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al eliminar perfil' });
  }
});

router.get('/perfiles/:id/menus', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const perfil = await withConnection(conn => loadProfileById(conn, profileId));
    if (!perfil) {
      return res.status(404).json({ ok: false, error: 'Perfil no encontrado' });
    }
    res.json({ ok: true, data: perfil.menus });
  } catch (error) {
    console.error('[ADMIN] GET /perfiles/:id/menus:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener menÃºs del perfil' });
  }
});

router.put('/perfiles/:id/menus', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const perfil = await withTransaction(async conn => {
      const current = await loadProfileById(conn, profileId);
      if (!current) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }

      const menus = await resolveMenus(conn, req.body.menus);
      await conn.query('UPDATE perfil_menu SET activo = 0 WHERE perfil_id = ?', [profileId]);
      for (const menu of menus) {
        await conn.query(
          `INSERT INTO perfil_menu (perfil_id, menu_id, activo)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
          [profileId, menu.id]
        );
      }

      return loadProfileById(conn, profileId);
    });

    res.json({ ok: true, data: perfil.menus });
  } catch (error) {
    console.error('[ADMIN] PUT /perfiles/:id/menus:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar menÃºs del perfil' });
  }
});

router.post('/perfiles/:id/menus/:menuId', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const menuId = requireId(req.params.menuId, 'MenÃº');
    const perfil = await withTransaction(async conn => {
      const current = await loadProfileById(conn, profileId);
      if (!current) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }
      const menu = await loadMenuById(conn, menuId);
      if (!menu) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }

      await conn.query(
        `INSERT INTO perfil_menu (perfil_id, menu_id, activo)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
        [profileId, menuId]
      );

      return loadProfileById(conn, profileId);
    });

    res.json({ ok: true, data: perfil.menus });
  } catch (error) {
    console.error('[ADMIN] POST /perfiles/:id/menus/:menuId:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al asignar menÃº al perfil' });
  }
});

router.delete('/perfiles/:id/menus/:menuId', async (req, res) => {
  try {
    const profileId = requireId(req.params.id, 'Perfil');
    const menuId = requireId(req.params.menuId, 'MenÃº');
    const perfil = await withTransaction(async conn => {
      const current = await loadProfileById(conn, profileId);
      if (!current) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }
      const menu = await loadMenuById(conn, menuId);
      if (!menu) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }

      await conn.query(
        'UPDATE perfil_menu SET activo = 0 WHERE perfil_id = ? AND menu_id = ?',
        [profileId, menuId]
      );

      return loadProfileById(conn, profileId);
    });

    res.json({ ok: true, data: perfil.menus });
  } catch (error) {
    console.error('[ADMIN] DELETE /perfiles/:id/menus/:menuId:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al quitar menÃº del perfil' });
  }
});

router.get('/usuarios/:id/menus', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const payload = await withTransaction(async conn => {
      const usuario = await loadUser(conn, userId);
      if (!usuario) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      return usuario;
    });
    res.json({ ok: true, data: payload.menus });
  } catch (error) {
    console.error('[ADMIN] GET /usuarios/:id/menus:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener permisos del usuario' });
  }
});

router.get('/usuarios/:id/perfiles', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const perfiles = await withConnection(async conn => {
      const usuario = await loadUser(conn, userId);
      if (!usuario) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }
      return loadUserProfiles(conn, userId);
    });
    res.json({ ok: true, data: perfiles });
  } catch (error) {
    console.error('[ADMIN] GET /usuarios/:id/perfiles:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener perfiles del usuario' });
  }
});

router.put('/usuarios/:id/perfiles', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const perfiles = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      const requested = await resolveProfiles(conn, req.body.perfiles ?? req.body.perfil_ids ?? req.body.profiles);
      const basePerfil = await loadBaseProfileByArea(conn, current.area);
      const requestedIds = new Set(requested.map(perfil => Number(perfil.id)));
      if (basePerfil) {
        requestedIds.add(Number(basePerfil.id));
      }

      await conn.query('UPDATE usuario_perfil SET activo = 0 WHERE usuario_id = ?', [userId]);
      for (const profileId of requestedIds) {
        await conn.query(
          `INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
          [userId, profileId]
        );
      }

      return loadUserProfiles(conn, userId);
    });

    res.json({ ok: true, data: perfiles });
  } catch (error) {
    console.error('[ADMIN] PUT /usuarios/:id/perfiles:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar perfiles del usuario' });
  }
});

router.post('/usuarios/:id/perfiles/:perfilId', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const profileId = requireId(req.params.perfilId, 'Perfil');
    const perfiles = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      const perfil = await loadProfileById(conn, profileId);
      if (!perfil) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }

      await conn.query(
        `INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
        [userId, profileId]
      );

      return loadUserProfiles(conn, userId);
    });

    res.json({ ok: true, data: perfiles });
  } catch (error) {
    console.error('[ADMIN] POST /usuarios/:id/perfiles/:perfilId:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al asignar perfil al usuario' });
  }
});

router.delete('/usuarios/:id/perfiles/:perfilId', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const profileId = requireId(req.params.perfilId, 'Perfil');
    const perfiles = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      const perfil = await loadProfileById(conn, profileId);
      if (!perfil) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }

      const basePerfil = await loadBaseProfileByArea(conn, current.area);
      if (basePerfil && Number(basePerfil.id) === Number(profileId)) {
        const error = new Error('El perfil base del Ã¡rea se asigna automÃ¡ticamente');
        error.status = 400;
        throw error;
      }

      await conn.query(
        'UPDATE usuario_perfil SET activo = 0 WHERE usuario_id = ? AND perfil_id = ?',
        [userId, profileId]
      );

      return loadUserProfiles(conn, userId);
    });

    res.json({ ok: true, data: perfiles });
  } catch (error) {
    console.error('[ADMIN] DELETE /usuarios/:id/perfiles/:perfilId:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al quitar perfil al usuario' });
  }
});

router.put('/usuarios/:id/menus', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const confirmed = asBoolean(req.body?.confirmar, false) || asBoolean(req.body?.force, false);
    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      const menus = await resolveMenus(conn, req.body.menus);
      const currentId = Number(req.usuario?.id ?? req.usuario?.sub);
      const keepsAdminMenu = menus.some(menu => normalizeKey(menu.codigo) === ADMIN_MENU_CODE);

      if (Number(userId) === currentId && !keepsAdminMenu && !confirmed) {
        const error = new Error('No puedes quitarte el acceso a AdministraciÃ³n sin confirmaciÃ³n fuerte');
        error.status = 400;
        throw error;
      }

      await syncUserMenus(conn, userId, menus);
      return loadUser(conn, userId);
    });

    res.json({ ok: true, data: usuario.menus });
  } catch (error) {
    console.error('[ADMIN] PUT /usuarios/:id/menus:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar permisos' });
  }
});

router.post('/usuarios/:id/menus/:menuId', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const menuId = requireId(req.params.menuId, 'MenÃº');
    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }
      const menu = await loadMenuById(conn, menuId);
      if (!menu) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }

      await conn.query(
        `INSERT INTO usuario_menu (usuario_id, menu_id, activo)
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
        [userId, menuId]
      );
      return loadUser(conn, userId);
    });

    res.json({ ok: true, data: usuario.menus });
  } catch (error) {
    console.error('[ADMIN] POST /usuarios/:id/menus/:menuId:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al asignar menÃº' });
  }
});

router.delete('/usuarios/:id/menus/:menuId', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const menuId = requireId(req.params.menuId, 'MenÃº');
    const usuario = await withTransaction(async conn => {
      const current = await loadUser(conn, userId);
      if (!current) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }
      const menu = await loadMenuById(conn, menuId);
      if (!menu) {
        const error = new Error('MenÃº no encontrado');
        error.status = 404;
        throw error;
      }

      const currentId = Number(req.usuario?.id ?? req.usuario?.sub);
      if (Number(userId) === currentId && normalizeKey(menu.codigo) === ADMIN_MENU_CODE) {
        const confirmed = asBoolean(req.body?.confirmar, false) || asBoolean(req.body?.force, false);
        if (!confirmed) {
          const error = new Error('No puedes quitarte el acceso a AdministraciÃ³n sin confirmaciÃ³n fuerte');
          error.status = 400;
          throw error;
        }
      }

      await conn.query(
        'UPDATE usuario_menu SET activo = 0 WHERE usuario_id = ? AND menu_id = ?',
        [userId, menuId]
      );
      return loadUser(conn, userId);
    });

    res.json({ ok: true, data: usuario.menus });
  } catch (error) {
    console.error('[ADMIN] DELETE /usuarios/:id/menus/:menuId:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al quitar menÃº' });
  }
});

router.get('/usuarios/:id/vendedores', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const vendedores = await withConnection(async conn => {
      const [rows] = await conn.query(
        `SELECT cod_vendedor, tipo
         FROM usuario_vendedor
         WHERE usuario_id = ?
         ORDER BY cod_vendedor ASC`,
        [userId]
      );
      return rows.map(mapVendorRow);
    });

    res.json({ ok: true, data: vendedores });
  } catch (error) {
    console.error('[ADMIN] GET /usuarios/:id/vendedores:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener vendedores' });
  }
});

router.post('/usuarios/:id/vendedores', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const codVendedor = normalizeText(req.body.cod_vendedor).toUpperCase();
    const tipo = normalizeVendorType(req.body.tipo);

    if (!codVendedor || !tipo) {
      return res.status(400).json({ ok: false, error: 'CÃ³digo de vendedor y tipo son obligatorios' });
    }

    const vendedores = await withTransaction(async conn => {
      const usuario = await loadUser(conn, userId);
      if (!usuario) {
        const error = new Error('Usuario no encontrado');
        error.status = 404;
        throw error;
      }

      await conn.query(
        `INSERT INTO usuario_vendedor (usuario_id, cod_vendedor, tipo)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE tipo = VALUES(tipo)`,
        [userId, codVendedor, tipo]
      );

      const [rows] = await conn.query(
        `SELECT cod_vendedor, tipo
         FROM usuario_vendedor
         WHERE usuario_id = ?
         ORDER BY cod_vendedor ASC`,
        [userId]
      );
      return rows.map(mapVendorRow);
    });

    res.status(201).json({ ok: true, data: vendedores });
  } catch (error) {
    console.error('[ADMIN] POST /usuarios/:id/vendedores:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al agregar vendedor' });
  }
});

router.put('/usuarios/:id/vendedores/:cod', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const codVendedor = normalizeText(req.params.cod).toUpperCase();
    const tipo = normalizeVendorType(req.body.tipo);

    if (!codVendedor || !tipo) {
      return res.status(400).json({ ok: false, error: 'CÃ³digo de vendedor y tipo son obligatorios' });
    }

    const vendedores = await withTransaction(async conn => {
      const [result] = await conn.query(
        `UPDATE usuario_vendedor
         SET tipo = ?
         WHERE usuario_id = ? AND cod_vendedor = ?`,
        [tipo, userId, codVendedor]
      );

      if (!result.affectedRows) {
        const error = new Error('RelaciÃ³n usuario-vendedor no encontrada');
        error.status = 404;
        throw error;
      }

      const [rows] = await conn.query(
        `SELECT cod_vendedor, tipo
         FROM usuario_vendedor
         WHERE usuario_id = ?
         ORDER BY cod_vendedor ASC`,
        [userId]
      );
      return rows.map(mapVendorRow);
    });

    res.json({ ok: true, data: vendedores });
  } catch (error) {
    console.error('[ADMIN] PUT /usuarios/:id/vendedores/:cod:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al editar vendedor' });
  }
});

router.delete('/usuarios/:id/vendedores/:cod', async (req, res) => {
  try {
    const userId = requireId(req.params.id, 'Usuario');
    const codVendedor = normalizeText(req.params.cod).toUpperCase();

    const vendedores = await withTransaction(async conn => {
      const [result] = await conn.query(
        'DELETE FROM usuario_vendedor WHERE usuario_id = ? AND cod_vendedor = ?',
        [userId, codVendedor]
      );

      if (!result.affectedRows) {
        const error = new Error('RelaciÃ³n usuario-vendedor no encontrada');
        error.status = 404;
        throw error;
      }

      const [rows] = await conn.query(
        `SELECT cod_vendedor, tipo
         FROM usuario_vendedor
         WHERE usuario_id = ?
         ORDER BY cod_vendedor ASC`,
        [userId]
      );
      return rows.map(mapVendorRow);
    });

    res.json({ ok: true, data: vendedores });
  } catch (error) {
    console.error('[ADMIN] DELETE /usuarios/:id/vendedores/:cod:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al quitar vendedor' });
  }
});

router.get('/areas', async (_req, res) => {
  try {
    const areas = await withConnection(conn => loadAreas(conn));
    res.json({ ok: true, data: areas });
  } catch (error) {
    console.error('[ADMIN] GET /areas:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener Ã¡reas' });
  }
});

router.get('/areas/:id', async (req, res) => {
  try {
    const areaId = requireId(req.params.id, 'Ãrea');
    const area = await withConnection(conn => loadAreaById(conn, areaId));
    if (!area) {
      return res.status(404).json({ ok: false, error: 'Ãrea no encontrada' });
    }
    res.json({ ok: true, data: area });
  } catch (error) {
    console.error('[ADMIN] GET /areas/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener Ã¡rea' });
  }
});

router.post('/areas', async (req, res) => {
  try {
    const nombre = normalizeText(req.body.nombre);
    const codigo = cleanCode(req.body.codigo || req.body.nombre);
    const descripcion = normalizeText(req.body.descripcion);
    const perfilBaseId = asNumber(req.body.perfil_base_id, null);
    const activo = asBoolean(req.body.activo, true);

    if (!nombre || !codigo) {
      return res.status(400).json({ ok: false, error: 'Nombre y cÃ³digo son obligatorios' });
    }

    const area = await withTransaction(async conn => {
      const schema = await getAreaSchema(conn);
      if (!schema.exists) {
        throw adminError('AREA_TABLA_NO_EXISTE', 'La tabla area aÃºn no estÃ¡ creada. Ejecuta la migraciÃ³n de Ã¡reas.', 503);
      }

      const [dupes] = await conn.query('SELECT id FROM area WHERE codigo = ? LIMIT 1', [codigo]);
      if (dupes.length) {
        throw adminError('AREA_DUPLICADA', 'Ya existe un Ã¡rea con este cÃ³digo.', 409);
      }

      if (perfilBaseId !== null) {
        const perfil = await loadProfileById(conn, perfilBaseId);
        if (!perfil) {
          throw adminError('PERFIL_NO_EXISTE', 'El perfil base seleccionado no existe.', 404);
        }
      }

      const [result] = await conn.query(
        `INSERT INTO area (codigo, nombre, descripcion, perfil_base_id, activo)
         VALUES (?, ?, ?, ?, ?)`,
        [codigo, nombre, descripcion, perfilBaseId, activo ? 1 : 0]
      );

      return loadAreaById(conn, result.insertId);
    });

    res.status(201).json({ ok: true, data: area });
  } catch (error) {
    console.error('[ADMIN] POST /areas:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al crear Ã¡rea' });
  }
});

router.put('/areas/:id', async (req, res) => {
  try {
    const areaId = requireId(req.params.id, 'Ãrea');
    const nombre = normalizeText(req.body.nombre);
    const codigo = cleanCode(req.body.codigo || req.body.nombre);
    const descripcion = normalizeText(req.body.descripcion);
    const perfilBaseId = asNumber(req.body.perfil_base_id, null);
    const activo = asBoolean(req.body.activo, true);

    if (!nombre || !codigo) {
      return res.status(400).json({ ok: false, error: 'Nombre y cÃ³digo son obligatorios' });
    }

    const area = await withTransaction(async conn => {
      const current = await loadAreaById(conn, areaId);
      if (!current) {
        const error = new Error('Ãrea no encontrada');
        error.status = 404;
        throw error;
      }

      const schema = await getAreaSchema(conn);
      if (!schema.exists) {
        throw adminError('AREA_TABLA_NO_EXISTE', 'La tabla area aÃºn no estÃ¡ creada. Ejecuta la migraciÃ³n de Ã¡reas.', 503);
      }

      const [dupes] = await conn.query('SELECT id FROM area WHERE codigo = ? AND id <> ? LIMIT 1', [codigo, areaId]);
      if (dupes.length) {
        throw adminError('AREA_DUPLICADA', 'Ya existe un Ã¡rea con este cÃ³digo.', 409);
      }

      if (perfilBaseId !== null) {
        const perfil = await loadProfileById(conn, perfilBaseId);
        if (!perfil) {
          throw adminError('PERFIL_NO_EXISTE', 'El perfil base seleccionado no existe.', 404);
        }
      }

      await conn.query(
        `UPDATE area
         SET codigo = ?, nombre = ?, descripcion = ?, perfil_base_id = ?, activo = ?
         WHERE id = ?`,
        [codigo, nombre, descripcion, perfilBaseId, activo ? 1 : 0, areaId]
      );

      return loadAreaById(conn, areaId);
    });

    res.json({ ok: true, data: area });
  } catch (error) {
    console.error('[ADMIN] PUT /areas/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar Ã¡rea' });
  }
});

router.patch('/areas/:id/activar', async (req, res) => {
  try {
    const areaId = requireId(req.params.id, 'Ãrea');
    const area = await withTransaction(async conn => {
      const current = await loadAreaById(conn, areaId);
      if (!current) {
        const error = new Error('Ãrea no encontrada');
        error.status = 404;
        throw error;
      }
      await conn.query('UPDATE area SET activo = 1 WHERE id = ?', [areaId]);
      return loadAreaById(conn, areaId);
    });
    res.json({ ok: true, data: area });
  } catch (error) {
    console.error('[ADMIN] PATCH /areas/:id/activar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al activar Ã¡rea' });
  }
});

router.patch('/areas/:id/desactivar', async (req, res) => {
  try {
    const areaId = requireId(req.params.id, 'Ãrea');
    const confirmed = asBoolean(req.body?.confirmar, false);
    const area = await withTransaction(async conn => {
      const current = await loadAreaById(conn, areaId);
      if (!current) {
        const error = new Error('Ãrea no encontrada');
        error.status = 404;
        throw error;
      }

      const [users] = await conn.query(
        `SELECT COUNT(*) AS total
         FROM usuario
         WHERE is_active = 1
           AND LOWER(TRIM(COALESCE(area, ''))) = LOWER(TRIM(COALESCE(?, '')))`,
        [current.codigo]
      );
      const activeUsers = Number(users[0]?.total || 0);
      if (activeUsers > 0 && !confirmed) {
        const error = new Error('No se puede desactivar un Ã¡rea con usuarios activos sin confirmaciÃ³n');
        error.status = 409;
        error.code = 'AREA_CON_USUARIOS';
        throw error;
      }

      await conn.query('UPDATE area SET activo = 0 WHERE id = ?', [areaId]);
      return loadAreaById(conn, areaId);
    });
    res.json({ ok: true, data: area });
  } catch (error) {
    console.error('[ADMIN] PATCH /areas/:id/desactivar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al desactivar Ã¡rea', code: error.code || '' });
  }
});

router.post('/areas/:id/aplicar-perfil', async (req, res) => {
  try {
    const areaId = requireId(req.params.id, 'Ãrea');
    const perfilIdInput = asNumber(req.body?.perfil_id, null);
    const result = await withTransaction(async conn => {
      const area = await loadAreaById(conn, areaId);
      if (!area) {
        const error = new Error('Ãrea no encontrada');
        error.status = 404;
        throw error;
      }

      const perfilId = perfilIdInput || area.perfil_base_id;
      if (!perfilId) {
        const error = new Error('El Ã¡rea no tiene perfil base asociado');
        error.status = 400;
        throw error;
      }

      const perfil = await loadProfileById(conn, perfilId);
      if (!perfil) {
        const error = new Error('Perfil no encontrado');
        error.status = 404;
        throw error;
      }

      const [users] = await conn.query(
        `SELECT id
         FROM usuario
         WHERE is_active = 1
           AND LOWER(TRIM(COALESCE(area, ''))) = LOWER(TRIM(COALESCE(?, '')))`,
        [area.codigo]
      );

      let affected = 0;
      for (const user of users) {
        await conn.query(
          `INSERT INTO usuario_perfil (usuario_id, perfil_id, activo)
           VALUES (?, ?, 1)
           ON DUPLICATE KEY UPDATE activo = VALUES(activo)`,
          [user.id, perfil.id]
        );
        affected += 1;
      }

      return {
        area,
        perfil,
        usuarios: users.length,
        afectados: affected,
      };
    });

    res.json({ ok: true, data: result });
  } catch (error) {
    console.error('[ADMIN] POST /areas/:id/aplicar-perfil:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al aplicar perfil al Ã¡rea' });
  }
});

router.post('/accesos/asignar-por-area', async (req, res) => {
  try {
    const area = normalizeKey(req.body.area);
    const menus = await withTransaction(async conn => {
      const resolvedMenus = await resolveMenus(conn, req.body.menus);
      if (!resolvedMenus.length) {
        const error = new Error('Debes indicar al menos un menÃº');
        error.status = 400;
        throw error;
      }

      const [users] = await conn.query(
        `SELECT id, area
         FROM usuario
         WHERE is_active = 1`
      );

      const targets = users.filter(user => normalizeKey(user.area) === area);
      for (const user of targets) {
        await syncUserMenus(conn, user.id, resolvedMenus);
      }

      return {
        usuarios: targets.length,
        asignaciones: targets.length * resolvedMenus.length,
        menus: resolvedMenus,
      };
    });

    res.json({ ok: true, data: menus });
  } catch (error) {
    console.error('[ADMIN] POST /accesos/asignar-por-area:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al asignar accesos por Ã¡rea' });
  }
});

router.get('/vendedor-metas', async (req, res) => {
  try {
    const usuarioId = asNumber(req.query.usuario_id, null);
    const anio = asNumber(req.query.anio, null);
    const tipoPeriodo = normalizeKey(req.query.tipo_periodo || req.query.tipo || '');
    const activo = asNumber(req.query.activo, null);

    const metas = await withConnection(conn => vendedorMetaModel.listarMetasVendedor(conn, {
      usuarioId,
      anio,
      tipoPeriodo,
      activo,
    }));

    res.json({ ok: true, data: metas });
  } catch (error) {
    console.error('[ADMIN] GET /vendedor-metas:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener metas de vendedores' });
  }
});

router.get('/vendedor-metas/:id', async (req, res) => {
  try {
    const metaId = requireId(req.params.id, 'Meta');
    const meta = await withConnection(conn => vendedorMetaModel.obtenerMetaPorId(conn, { id: metaId }));
    if (!meta) {
      return res.status(404).json({ ok: false, error: 'Meta no encontrada' });
    }
    res.json({ ok: true, data: meta });
  } catch (error) {
    console.error('[ADMIN] GET /vendedor-metas/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al obtener meta' });
  }
});

router.post('/vendedor-metas', async (req, res) => {
  try {
    const usuarioId = requireId(req.body.usuario_id, 'Usuario');
    const anio = requireId(req.body.anio, 'AÃ±o');
    const tipoPeriodo = vendedorMetaModel.normalizeTipoPeriodo(req.body.tipo_periodo);
    const mes = asNumber(req.body.mes, null);
    const meta = asNumber(req.body.meta, null);
    const activo = asBoolean(req.body.activo, true);
    const observacion = normalizeText(req.body.observacion);

    if (!tipoPeriodo) {
      return res.status(400).json({ ok: false, error: 'Selecciona un tipo de periodo vÃ¡lido.' });
    }
    if (meta === null || !Number.isFinite(meta) || meta < 0) {
      return res.status(400).json({ ok: false, error: 'La meta debe ser un nÃºmero vÃ¡lido.' });
    }

    const metaGuardada = await withTransaction(async conn => {
      const usuario = await loadUser(conn, usuarioId);
      if (!usuario) {
        throw adminError('USUARIO_NO_EXISTE', 'El usuario seleccionado no existe.', 404);
      }

      return vendedorMetaModel.guardarMetaVendedor(conn, {
        usuario_id: usuarioId,
        anio,
        mes,
        tipo_periodo: tipoPeriodo,
        meta,
        activo,
        observacion,
      });
    });

    res.status(201).json({ ok: true, data: metaGuardada });
  } catch (error) {
    console.error('[ADMIN] POST /vendedor-metas:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al crear meta de vendedor' });
  }
});

router.put('/vendedor-metas/:id', async (req, res) => {
  try {
    const metaId = requireId(req.params.id, 'Meta');
    const usuarioId = requireId(req.body.usuario_id, 'Usuario');
    const anio = requireId(req.body.anio, 'AÃ±o');
    const tipoPeriodo = vendedorMetaModel.normalizeTipoPeriodo(req.body.tipo_periodo);
    const mes = asNumber(req.body.mes, null);
    const meta = asNumber(req.body.meta, null);
    const activo = asBoolean(req.body.activo, true);
    const observacion = normalizeText(req.body.observacion);

    if (!tipoPeriodo) {
      return res.status(400).json({ ok: false, error: 'Selecciona un tipo de periodo vÃ¡lido.' });
    }
    if (meta === null || !Number.isFinite(meta) || meta < 0) {
      return res.status(400).json({ ok: false, error: 'La meta debe ser un nÃºmero vÃ¡lido.' });
    }

    const metaActualizada = await withTransaction(async conn => {
      const usuario = await loadUser(conn, usuarioId);
      if (!usuario) {
        throw adminError('USUARIO_NO_EXISTE', 'El usuario seleccionado no existe.', 404);
      }

      const actual = await vendedorMetaModel.obtenerMetaPorId(conn, { id: metaId });
      if (!actual) {
        throw adminError('META_NO_EXISTE', 'La meta seleccionada no existe.', 404);
      }

      return vendedorMetaModel.guardarMetaVendedor(conn, {
        id: metaId,
        usuario_id: usuarioId,
        anio,
        mes,
        tipo_periodo: tipoPeriodo,
        meta,
        activo,
        observacion,
      });
    });

    res.json({ ok: true, data: metaActualizada });
  } catch (error) {
    console.error('[ADMIN] PUT /vendedor-metas/:id:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al actualizar meta de vendedor' });
  }
});

router.patch('/vendedor-metas/:id/activar', async (req, res) => {
  try {
    const metaId = requireId(req.params.id, 'Meta');
    const meta = await withTransaction(async conn => vendedorMetaModel.actualizarEstadoMetaVendedor(conn, { id: metaId, activo: true }));
    if (!meta) {
      return res.status(404).json({ ok: false, error: 'Meta no encontrada' });
    }
    res.json({ ok: true, data: meta });
  } catch (error) {
    console.error('[ADMIN] PATCH /vendedor-metas/:id/activar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al activar meta de vendedor' });
  }
});

router.patch('/vendedor-metas/:id/desactivar', async (req, res) => {
  try {
    const metaId = requireId(req.params.id, 'Meta');
    const meta = await withTransaction(async conn => vendedorMetaModel.actualizarEstadoMetaVendedor(conn, { id: metaId, activo: false }));
    if (!meta) {
      return res.status(404).json({ ok: false, error: 'Meta no encontrada' });
    }
    res.json({ ok: true, data: meta });
  } catch (error) {
    console.error('[ADMIN] PATCH /vendedor-metas/:id/desactivar:', error);
    res.status(error.status || 500).json({ ok: false, error: error.message || 'Error al desactivar meta de vendedor' });
  }
});

module.exports = router;
