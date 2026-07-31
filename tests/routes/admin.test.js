'use strict';

const request = require('supertest');
const express = require('express');

jest.mock('../../src/middlewares/requireAuth', () => ({
  requireAuth: (req, _res, next) => {
    req.usuario = { sub: 1, id: 1, is_admin: true, nombre: 'Admin Test' };
    next();
  },
}));

const mockGetConnection = jest.fn();
jest.mock('../../src/config/db', () => ({
  pool: { getConnection: mockGetConnection },
}));

const adminRouter = require('../../src/routes/admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);

let state;
let mockConnection;

function resetState() {
  state = {
    users: [
      {
        id: 1,
        nombre: 'Admin',
        email: 'admin@texpro.cl',
        codigo: '900',
        area: 'administracion',
        is_admin: 1,
        is_active: 1,
        last_login: '2026-07-01 10:00:00',
        created_at: '2026-06-01 09:00:00',
      },
      {
        id: 2,
        nombre: 'Ana',
        email: 'ana@texpro.cl',
        codigo: '101',
        area: 'ventas',
        is_admin: 0,
        is_active: 1,
        last_login: null,
        created_at: '2026-06-10 09:00:00',
      },
    ],
    menus: [
      { id: 1, codigo: 'ventas_dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', grupo: 'Ventas', orden: 1, activo: 1 },
      { id: 11, codigo: 'administracion', nombre: 'Administración', url: '/src/modulo/admin/admin/index.html', icono: '🔧', grupo: 'Administración', orden: 1, activo: 1 },
      { id: 12, codigo: 'alertas', nombre: 'Alertas', url: '/src/modulo/varios/alertas/index.html', icono: '🔔', grupo: 'General', orden: 1, activo: 1 },
    ],
    vendors: [
      { usuario_id: 2, cod_vendedor: 'V001', tipo: 'P' },
      { usuario_id: 2, cod_vendedor: 'V002', tipo: 'C' },
    ],
    userMenus: [
      { usuario_id: 1, menu_id: 11, activo: 1 },
      { usuario_id: 2, menu_id: 1, activo: 1 },
    ],
    userProfiles: [
      { usuario_id: 1, perfil_id: 2, activo: 1 },
      { usuario_id: 2, perfil_id: 1, activo: 1 },
    ],
    profiles: [
      { id: 1, codigo: 'ventas', nombre: 'Ventas', descripcion: 'Base ventas', area: 'ventas', es_base: 1, activo: 1 },
      { id: 2, codigo: 'administracion', nombre: 'AdministraciÃ³n', descripcion: 'Base admin', area: 'administracion', es_base: 1, activo: 1 },
    ],
    areas: [
      { id: 1, codigo: 'ventas', nombre: 'Ventas', descripcion: 'Area comercial', perfil_base_id: 1, activo: 1, created_at: '2026-06-01 00:00:00', updated_at: '2026-06-01 00:00:00' },
      { id: 2, codigo: 'laboratorio', nombre: 'Laboratorio', descripcion: 'Area de pruebas', perfil_base_id: null, activo: 1, created_at: '2026-06-01 00:00:00', updated_at: '2026-06-01 00:00:00' },
      { id: 3, codigo: 'administracion', nombre: 'AdministraciÃƒÂ³n', descripcion: 'Area administrativa', perfil_base_id: 2, activo: 1, created_at: '2026-06-01 00:00:00', updated_at: '2026-06-01 00:00:00' },
    ],
    profileMenus: [
      { perfil_id: 1, menu_id: 1, activo: 1 },
      { perfil_id: 1, menu_id: 2, activo: 1 },
      { perfil_id: 1, menu_id: 3, activo: 1 },
      { perfil_id: 1, menu_id: 12, activo: 1 },
      { perfil_id: 2, menu_id: 1, activo: 1 },
      { perfil_id: 2, menu_id: 2, activo: 1 },
      { perfil_id: 2, menu_id: 3, activo: 1 },
      { perfil_id: 2, menu_id: 4, activo: 1 },
      { perfil_id: 2, menu_id: 5, activo: 1 },
      { perfil_id: 2, menu_id: 6, activo: 1 },
      { perfil_id: 2, menu_id: 7, activo: 1 },
      { perfil_id: 2, menu_id: 8, activo: 1 },
      { perfil_id: 2, menu_id: 9, activo: 1 },
      { perfil_id: 2, menu_id: 10, activo: 1 },
      { perfil_id: 2, menu_id: 11, activo: 1 },
      { perfil_id: 2, menu_id: 12, activo: 1 },
      { perfil_id: 2, menu_id: 13, activo: 1 },
    ],
  };
}

function getUserRows(userId = null) {
  if (userId === null || userId === undefined || userId === '') {
    return state.users.map(user => ({ ...user }));
  }
  return state.users
    .filter(user => userId === null || Number(user.id) === Number(userId))
    .map(user => ({ ...user }));
}

function getVendorRows(userIds) {
  return state.vendors
    .filter(v => userIds.includes(Number(v.usuario_id)))
    .map(v => ({ ...v }));
}

function getMenuRows(userIds) {
  return state.userMenus
    .filter(rel => userIds.includes(Number(rel.usuario_id)) && Number(rel.activo) === 1)
    .map(rel => {
      const menu = state.menus.find(item => Number(item.id) === Number(rel.menu_id));
      return menu ? { usuario_id: rel.usuario_id, ...menu, asignado_activo: rel.activo } : null;
    })
    .filter(Boolean);
}

function getProfileRows(userIds) {
  return state.userProfiles
    .filter(rel => userIds.includes(Number(rel.usuario_id)) && Number(rel.activo) === 1)
    .map(rel => {
      const perfil = state.profiles.find(item => Number(item.id) === Number(rel.perfil_id));
      return perfil ? { usuario_id: rel.usuario_id, ...perfil, asignado_activo: rel.activo } : null;
    })
    .filter(Boolean);
}

function getProfilesCatalog(profileId = null) {
  return state.profiles
    .filter(profile => profileId === null || Number(profile.id) === Number(profileId))
    .map(profile => ({ ...profile }));
}

function getProfileMenus(profileIds) {
  return state.profileMenus
    .filter(rel => profileIds.includes(Number(rel.perfil_id)) && Number(rel.activo) === 1)
    .map(rel => {
      const menu = state.menus.find(item => Number(item.id) === Number(rel.menu_id));
      return menu ? { perfil_id: rel.perfil_id, ...menu, asignado_activo: rel.activo } : null;
    })
    .filter(Boolean);
}

function normalizeAreaKey(value) {
  return String(value || '').trim().toLowerCase();
}

function getAreaRows(areaId = null, areaCode = null) {
  const rows = state.areas.map(area => {
    const perfil = state.profiles.find(item => Number(item.id) === Number(area.perfil_base_id));
    const totalUsuarios = state.users.filter(user => normalizeAreaKey(user.area) === normalizeAreaKey(area.codigo)).length;
    const totalUsuariosActivos = state.users.filter(user => Number(user.is_active) === 1 && normalizeAreaKey(user.area) === normalizeAreaKey(area.codigo)).length;
    return {
      ...area,
      perfil_base_nombre: perfil?.nombre || '',
      perfil_base_codigo: perfil?.codigo || '',
      total_usuarios: totalUsuarios,
      total_usuarios_activos: totalUsuariosActivos,
      created_at: area.created_at || '2026-06-01 00:00:00',
      updated_at: area.updated_at || '2026-06-01 00:00:00',
    };
  });

  if (areaId !== null && areaId !== undefined) {
    return rows.filter(area => Number(area.id) === Number(areaId));
  }

  if (areaCode !== null && areaCode !== undefined) {
    return rows.filter(area => normalizeAreaKey(area.codigo) === normalizeAreaKey(areaCode));
  }

  return rows;
}

function handleQuery(sql, params = []) {
  const normalized = String(sql).replace(/\s+/g, ' ').trim();

  if (normalized.startsWith('SHOW COLUMNS FROM perfil LIKE ?')) {
    const column = String(params[0] || '').toLowerCase();
    if (column === 'area' || column === 'es_base') {
      return [[{ Field: column }]];
    }
    return [[]];
  }

  if (normalized.startsWith("SHOW TABLES LIKE 'area'")) {
    return [[{ 'Tables_in_test': 'area' }]];
  }

  if (normalized.startsWith('SELECT u.id, u.nombre, u.email, u.codigo, u.area, u.is_admin, u.is_active, u.last_login, u.fecha_creacion AS created_at FROM usuario u')) {
    return [getUserRows(params[0])];
  }

  if (normalized.includes('FROM usuario_vendedor') && normalized.includes('SELECT usuario_id, cod_vendedor, tipo')) {
    const ids = params.map(Number);
    return [getVendorRows(ids)];
  }

  if (normalized.includes('FROM usuario_menu um') && normalized.includes('INNER JOIN menu m ON m.id = um.menu_id')) {
    const ids = params.map(Number);
    return [getMenuRows(ids)];
  }

  if (normalized.includes('FROM usuario_perfil up') && normalized.includes('INNER JOIN perfil p ON p.id = up.perfil_id') && normalized.includes('ORDER BY')) {
    const ids = params.map(Number);
    return [getProfileRows(ids)];
  }

  if (normalized.includes('FROM perfil_menu pm') && normalized.includes('INNER JOIN menu m ON m.id = pm.menu_id') && normalized.includes('ORDER BY')) {
    const ids = params.map(Number);
    return [getProfileMenus(ids)];
  }

  if (normalized.includes('FROM usuario_perfil up') && normalized.includes('INNER JOIN usuario u ON u.id = up.usuario_id') && normalized.includes('ORDER BY up.perfil_id ASC, u.nombre ASC')) {
    const ids = params.map(Number);
    return [[...state.userProfiles.filter(rel => ids.includes(Number(rel.perfil_id)) && Number(rel.activo) === 1).map(rel => {
      const user = state.users.find(item => Number(item.id) === Number(rel.usuario_id));
      return user ? {
        perfil_id: rel.perfil_id,
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        area: user.area,
        codigo: user.codigo,
        is_active: user.is_active,
        asignado_activo: rel.activo,
      } : null;
    }).filter(Boolean)]];
  }

  if (normalized.includes('FROM perfil p') && normalized.includes('p.codigo') && normalized.includes('p.nombre') && normalized.includes('FROM perfil p')) {
    if (normalized.includes('WHERE p.id = ?')) {
      return [getProfilesCatalog(params[0])];
    }
    return [getProfilesCatalog()];
  }

  if (normalized.startsWith('SELECT id, codigo, nombre, descripcion, area, es_base, activo FROM perfil WHERE id = ?')) {
    return [getProfilesCatalog(params[0])];
  }

  if (normalized.includes('FROM usuario_perfil up') && normalized.includes('WHERE up.usuario_id = ?') && normalized.includes('ORDER BY')) {
    const userId = Number(params[0]);
    return [[...state.userProfiles.filter(rel => Number(rel.usuario_id) === userId && Number(rel.activo) === 1).map(rel => {
      const perfil = state.profiles.find(item => Number(item.id) === Number(rel.perfil_id));
      return perfil ? { ...perfil, asignado_activo: rel.activo } : null;
    }).filter(Boolean)]];
  }

  if (normalized.startsWith('SELECT id, codigo, nombre, descripcion, area, es_base, activo FROM perfil WHERE es_base = 1')) {
    const area = String(params[0] || '').trim().toLowerCase();
    const perfil = state.profiles.find(item => Number(item.es_base) === 1 && String(item.area).trim().toLowerCase() === area && Number(item.activo) === 1);
    return [[perfil ? { ...perfil } : undefined].filter(Boolean)];
  }

  if (normalized.includes('FROM area a LEFT JOIN perfil p ON p.id = a.perfil_base_id')) {
    const areaId = normalized.includes('WHERE a.id = ?') ? Number(params[0]) : null;
    const areaCode = normalized.includes('WHERE LOWER(TRIM(a.codigo)) = LOWER(TRIM(?))') ? params[0] : null;
    return [getAreaRows(areaId, areaCode)];
  }

  if (normalized.startsWith('SELECT id FROM area WHERE codigo = ? LIMIT 1')) {
    const area = state.areas.find(item => normalizeAreaKey(item.codigo) === normalizeAreaKey(params[0]));
    return [[area ? { id: area.id } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT id FROM area WHERE codigo = ? AND id <> ? LIMIT 1')) {
    const codigo = normalizeAreaKey(params[0]);
    const exclude = Number(params[1]);
    const area = state.areas.find(item => normalizeAreaKey(item.codigo) === codigo && Number(item.id) !== exclude);
    return [[area ? { id: area.id } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT COUNT(*) AS total FROM usuario WHERE is_active = 1 AND LOWER(TRIM(COALESCE(area, \'\'))) = LOWER(TRIM(COALESCE(?, \'\')))')) {
    const area = normalizeAreaKey(params[0]);
    const total = state.users.filter(user => Number(user.is_active) === 1 && normalizeAreaKey(user.area) === area).length;
    return [[{ total }]];
  }

  if (normalized.startsWith('SELECT id, codigo, nombre, url, icono, grupo, orden, activo FROM menu ORDER BY')) {
    return [[...state.menus]];
  }

  if (normalized.startsWith('SELECT id, codigo, nombre, url, icono, grupo, orden, activo FROM menu WHERE id = ? LIMIT 1')) {
    const menu = state.menus.find(item => Number(item.id) === Number(params[0]));
    return [[menu ? { ...menu } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT id, codigo, nombre, url, icono, grupo, orden, activo FROM menu WHERE codigo = ? LIMIT 1')) {
    const menu = state.menus.find(item => String(item.codigo) === String(params[0]));
    return [[menu ? { ...menu } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT id FROM menu WHERE codigo = ? LIMIT 1')) {
    const menu = state.menus.find(item => String(item.codigo) === String(params[0]));
    return [[menu ? { id: menu.id } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT id FROM menu WHERE codigo = ? AND id <> ? LIMIT 1')) {
    const codigo = String(params[0]);
    const exclude = Number(params[1]);
    const menu = state.menus.find(item => String(item.codigo) === codigo && Number(item.id) !== exclude);
    return [[menu ? { id: menu.id } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT id FROM perfil WHERE codigo = ? LIMIT 1')) {
    const perfil = state.profiles.find(item => String(item.codigo) === String(params[0]));
    return [[perfil ? { id: perfil.id } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT id FROM perfil WHERE codigo = ? AND id <> ? LIMIT 1')) {
    const codigo = String(params[0]);
    const exclude = Number(params[1]);
    const perfil = state.profiles.find(item => String(item.codigo) === codigo && Number(item.id) !== exclude);
    return [[perfil ? { id: perfil.id } : undefined].filter(Boolean)];
  }

  if (normalized.startsWith('SELECT DISTINCT area, COUNT(*) AS total FROM usuario WHERE TRIM(COALESCE(area, \'\')) <> \'\'')) {
    const map = new Map();
    state.users.forEach(user => {
      const key = user.area;
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [[...map.entries()].map(([area, total]) => ({ area, total }))];
  }

  if (normalized.startsWith('SELECT id, area FROM usuario WHERE is_active = 1')) {
    return [[...state.users.filter(user => Number(user.is_active) === 1).map(user => ({ id: user.id, area: user.area }))]];
  }

  if (normalized.startsWith('SELECT COUNT(*) AS total FROM usuario WHERE is_active = 1 AND is_admin = 1')) {
    const excludeId = params[0] ? Number(params[0]) : null;
    const total = state.users.filter(user => user.is_active === 1 && user.is_admin === 1 && (excludeId === null || Number(user.id) !== excludeId)).length;
    return [{ total }];
  }

  if (normalized.startsWith('SELECT DISTINCT u.id FROM usuario u INNER JOIN usuario_menu um ON um.usuario_id = u.id AND um.activo = 1 INNER JOIN menu m ON m.id = um.menu_id AND m.activo = 1 WHERE u.is_active = 1 AND u.is_admin = 1 AND m.codigo = ?')) {
    const excludeId = params[1] ? Number(params[1]) : null;
    const owners = state.users.filter(user => {
      if (user.is_active !== 1 || user.is_admin !== 1) return false;
      if (excludeId !== null && Number(user.id) === excludeId) return false;
      return state.userMenus.some(rel => Number(rel.usuario_id) === Number(user.id) && Number(rel.activo) === 1 && Number(rel.menu_id) === 11);
    });
    return [owners.map(user => ({ id: user.id }))];
  }

  if (normalized.startsWith('SELECT id FROM usuario WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) LIMIT 1')) {
    const email = String(params[0]).trim().toLowerCase();
    const rows = state.users.filter(user => String(user.email).trim().toLowerCase() === email);
    return [rows.map(user => ({ id: user.id }))];
  }

  if (normalized.startsWith('SELECT id FROM usuario WHERE LOWER(TRIM(email)) = LOWER(TRIM(?)) AND id <> ? LIMIT 1')) {
    const email = String(params[0]).trim().toLowerCase();
    const exclude = Number(params[1]);
    const rows = state.users.filter(user => Number(user.id) !== exclude && String(user.email).trim().toLowerCase() === email);
    return [rows.map(user => ({ id: user.id }))];
  }

  if (normalized.startsWith('SELECT id FROM usuario WHERE TRIM(codigo) = TRIM(?) LIMIT 1')) {
    const codigo = String(params[0]).trim();
    const rows = state.users.filter(user => String(user.codigo).trim() === codigo);
    return [rows.map(user => ({ id: user.id }))];
  }

  if (normalized.startsWith('SELECT id FROM usuario WHERE TRIM(codigo) = TRIM(?) AND id <> ? LIMIT 1')) {
    const codigo = String(params[0]).trim();
    const exclude = Number(params[1]);
    const rows = state.users.filter(user => Number(user.id) !== exclude && String(user.codigo).trim() === codigo);
    return [rows.map(user => ({ id: user.id }))];
  }

  if (normalized.startsWith('INSERT INTO usuario (password, nombre, email, area, codigo, tema, is_active, is_admin, fecha_creacion)')) {
    const nextId = Math.max(...state.users.map(user => Number(user.id))) + 1;
    const [password, nombre, email, area, codigo, tema, isActive, isAdmin] = params;
    state.users.push({
      id: nextId,
      password,
      nombre,
      email,
      area,
      codigo,
      tema,
      is_active: Number(isActive),
      is_admin: Number(isAdmin),
      last_login: null,
      created_at: '2026-07-10 00:00:00',
    });
    return [{ insertId: nextId }];
  }

  if (normalized.startsWith('INSERT INTO perfil (codigo, nombre, descripcion, area, es_base, activo) VALUES (?, ?, ?, ?, ?, ?)')) {
    const nextId = Math.max(...state.profiles.map(profile => Number(profile.id))) + 1;
    const [codigo, nombre, descripcion, area, esBase, activo] = params;
    state.profiles.push({
      id: nextId,
      codigo,
      nombre,
      descripcion,
      area,
      es_base: Number(esBase),
      activo: Number(activo),
    });
    return [{ insertId: nextId }];
  }

  if (normalized.startsWith('UPDATE usuario SET nombre = ?, email = ?, area = ?, is_admin = ?, is_active = ? WHERE id = ?')) {
    const [nombre, email, area, isAdmin, isActive, id] = params;
    const user = state.users.find(item => Number(item.id) === Number(id));
    if (user) {
      user.nombre = nombre;
      user.email = email;
      user.area = area;
      user.is_admin = Number(isAdmin);
      user.is_active = Number(isActive);
    }
    return [{ affectedRows: user ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE perfil SET codigo = ?, nombre = ?, descripcion = ?, area = ?, es_base = ?, activo = ? WHERE id = ?')) {
    const [codigo, nombre, descripcion, area, esBase, activo, id] = params;
    const perfil = state.profiles.find(item => Number(item.id) === Number(id));
    if (perfil) {
      perfil.codigo = codigo;
      perfil.nombre = nombre;
      perfil.descripcion = descripcion;
      perfil.area = area;
      perfil.es_base = Number(esBase);
      perfil.activo = Number(activo);
    }
    return [{ affectedRows: perfil ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE usuario SET is_active = 1 WHERE id = ?')) {
    const user = state.users.find(item => Number(item.id) === Number(params[0]));
    if (user) user.is_active = 1;
    return [{ affectedRows: user ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE usuario SET is_active = 0 WHERE id = ?')) {
    const user = state.users.find(item => Number(item.id) === Number(params[0]));
    if (user) user.is_active = 0;
    return [{ affectedRows: user ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE usuario SET password = ? WHERE id = ?')) {
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('UPDATE menu SET codigo = ?, nombre = ?, url = ?, icono = ?, grupo = ?, orden = ?, activo = ? WHERE id = ?')) {
    const [codigo, nombre, url, icono, grupo, orden, activo, id] = params;
    const menu = state.menus.find(item => Number(item.id) === Number(id));
    if (menu) {
      menu.codigo = codigo;
      menu.nombre = nombre;
      menu.url = url;
      menu.icono = icono;
      menu.grupo = grupo;
      menu.orden = Number(orden);
      menu.activo = Number(activo);
    }
    return [{ affectedRows: menu ? 1 : 0 }];
  }

  if (normalized.startsWith('INSERT INTO menu (codigo, nombre, url, icono, grupo, orden, activo) VALUES (?, ?, ?, ?, ?, ?, ?)')) {
    const nextId = Math.max(...state.menus.map(menu => Number(menu.id))) + 1;
    const [codigo, nombre, url, icono, grupo, orden, activo] = params;
    state.menus.push({ id: nextId, codigo, nombre, url, icono, grupo, orden: Number(orden), activo: Number(activo) });
    return [{ insertId: nextId }];
  }

  if (normalized.startsWith('UPDATE menu SET activo = 1 WHERE id = ?')) {
    const menu = state.menus.find(item => Number(item.id) === Number(params[0]));
    if (menu) menu.activo = 1;
    return [{ affectedRows: menu ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE menu SET activo = 0 WHERE id = ?')) {
    const menu = state.menus.find(item => Number(item.id) === Number(params[0]));
    if (menu) menu.activo = 0;
    return [{ affectedRows: menu ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE perfil SET activo = 1 WHERE id = ?')) {
    const perfil = state.profiles.find(item => Number(item.id) === Number(params[0]));
    if (perfil) perfil.activo = 1;
    return [{ affectedRows: perfil ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE perfil SET activo = 0 WHERE id = ?')) {
    const perfil = state.profiles.find(item => Number(item.id) === Number(params[0]));
    if (perfil) perfil.activo = 0;
    return [{ affectedRows: perfil ? 1 : 0 }];
  }

  if (normalized.startsWith('INSERT INTO area (codigo, nombre, descripcion, perfil_base_id, activo)')) {
    const nextId = Math.max(0, ...state.areas.map(area => Number(area.id))) + 1;
    const [codigo, nombre, descripcion, perfilBaseId, activo] = params;
    state.areas.push({
      id: nextId,
      codigo,
      nombre,
      descripcion,
      perfil_base_id: perfilBaseId === null || perfilBaseId === undefined ? null : Number(perfilBaseId),
      activo: Number(activo),
      created_at: '2026-07-10 00:00:00',
      updated_at: '2026-07-10 00:00:00',
    });
    return [{ insertId: nextId }];
  }

  if (normalized.startsWith('UPDATE area SET codigo = ?, nombre = ?, descripcion = ?, perfil_base_id = ?, activo = ? WHERE id = ?')) {
    const [codigo, nombre, descripcion, perfilBaseId, activo, id] = params;
    const area = state.areas.find(item => Number(item.id) === Number(id));
    if (area) {
      area.codigo = codigo;
      area.nombre = nombre;
      area.descripcion = descripcion;
      area.perfil_base_id = perfilBaseId === null || perfilBaseId === undefined ? null : Number(perfilBaseId);
      area.activo = Number(activo);
      area.updated_at = '2026-07-11 00:00:00';
    }
    return [{ affectedRows: area ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE area SET activo = 1 WHERE id = ?')) {
    const area = state.areas.find(item => Number(item.id) === Number(params[0]));
    if (area) area.activo = 1;
    return [{ affectedRows: area ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE area SET activo = 0 WHERE id = ?')) {
    const area = state.areas.find(item => Number(item.id) === Number(params[0]));
    if (area) area.activo = 0;
    return [{ affectedRows: area ? 1 : 0 }];
  }

  if (normalized.startsWith('SELECT COUNT(*) AS total FROM usuario_menu WHERE menu_id = ?')) {
    const total = state.userMenus.filter(rel => Number(rel.menu_id) === Number(params[0])).length;
    return [[{ total }]];
  }

  if (normalized.startsWith('SELECT COUNT(*) AS total FROM perfil_menu WHERE perfil_id = ?')) {
    const total = state.profileMenus.filter(rel => Number(rel.perfil_id) === Number(params[0])).length;
    return [[{ total }]];
  }

  if (normalized.startsWith('SELECT COUNT(*) AS total FROM usuario_perfil WHERE perfil_id = ?')) {
    const total = state.userProfiles.filter(rel => Number(rel.perfil_id) === Number(params[0])).length;
    return [[{ total }]];
  }

  if (normalized.startsWith('DELETE FROM menu WHERE id = ?')) {
    state.menus = state.menus.filter(menu => Number(menu.id) !== Number(params[0]));
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('DELETE FROM perfil WHERE id = ?')) {
    state.profiles = state.profiles.filter(profile => Number(profile.id) !== Number(params[0]));
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('UPDATE usuario_menu SET activo = 0 WHERE usuario_id = ?')) {
    const userId = Number(params[0]);
    state.userMenus.forEach(rel => {
      if (Number(rel.usuario_id) === userId) rel.activo = 0;
    });
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('UPDATE usuario_perfil SET activo = 0 WHERE usuario_id = ? AND perfil_id = ?')) {
    const [userId, perfilId] = params.map(Number);
    const rel = state.userProfiles.find(item => Number(item.usuario_id) === userId && Number(item.perfil_id) === perfilId);
    if (rel) rel.activo = 0;
    return [{ affectedRows: rel ? 1 : 0 }];
  }

  if (normalized.startsWith('DELETE FROM usuario_perfil WHERE usuario_id = ? AND perfil_id IN (?)')) {
    const userId = Number(params[0]);
    const perfilId = Number(params[1]);
    const before = state.userProfiles.length;
    state.userProfiles = state.userProfiles.filter(rel => !(Number(rel.usuario_id) === userId && Number(rel.perfil_id) === perfilId));
    return [{ affectedRows: before - state.userProfiles.length }];
  }

  if (normalized.startsWith('UPDATE usuario_perfil SET activo = 0 WHERE usuario_id = ?')) {
    const userId = Number(params[0]);
    state.userProfiles.forEach(rel => {
      if (Number(rel.usuario_id) === userId) rel.activo = 0;
    });
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('INSERT INTO usuario_menu (usuario_id, menu_id, activo) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE activo = VALUES(activo)')) {
    const [usuarioId, menuId] = params.map(Number);
    const existing = state.userMenus.find(rel => Number(rel.usuario_id) === usuarioId && Number(rel.menu_id) === menuId);
    if (existing) existing.activo = 1;
    else state.userMenus.push({ usuario_id: usuarioId, menu_id: menuId, activo: 1 });
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('INSERT INTO usuario_perfil (usuario_id, perfil_id, activo) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE activo = VALUES(activo)')) {
    const [usuarioId, perfilId] = params.map(Number);
    const existing = state.userProfiles.find(rel => Number(rel.usuario_id) === usuarioId && Number(rel.perfil_id) === perfilId);
    if (existing) existing.activo = 1;
    else state.userProfiles.push({ usuario_id: usuarioId, perfil_id: perfilId, activo: 1 });
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('INSERT INTO perfil_menu (perfil_id, menu_id, activo) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE activo = VALUES(activo)')) {
    const [perfilId, menuId] = params.map(Number);
    const existing = state.profileMenus.find(rel => Number(rel.perfil_id) === perfilId && Number(rel.menu_id) === menuId);
    if (existing) existing.activo = 1;
    else state.profileMenus.push({ perfil_id: perfilId, menu_id: menuId, activo: 1 });
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('UPDATE perfil_menu SET activo = 0 WHERE perfil_id = ? AND menu_id = ?')) {
    const [perfilId, menuId] = params.map(Number);
    const rel = state.profileMenus.find(item => Number(item.perfil_id) === perfilId && Number(item.menu_id) === menuId);
    if (rel) rel.activo = 0;
    return [{ affectedRows: rel ? 1 : 0 }];
  }

  if (normalized.startsWith('UPDATE perfil_menu SET activo = 0 WHERE perfil_id = ?')) {
    const perfilId = Number(params[0]);
    state.profileMenus.forEach(rel => {
      if (Number(rel.perfil_id) === perfilId) rel.activo = 0;
    });
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('SELECT cod_vendedor, tipo FROM usuario_vendedor WHERE usuario_id = ? ORDER BY cod_vendedor ASC')) {
    const userId = Number(params[0]);
    const rows = state.vendors.filter(v => Number(v.usuario_id) === userId).map(v => ({ cod_vendedor: v.cod_vendedor, tipo: v.tipo }));
    return [rows];
  }

  if (normalized.startsWith('INSERT INTO usuario_vendedor (usuario_id, cod_vendedor, tipo) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tipo = VALUES(tipo)')) {
    const [userId, cod, tipo] = params;
    const existing = state.vendors.find(v => Number(v.usuario_id) === Number(userId) && String(v.cod_vendedor) === String(cod));
    if (existing) existing.tipo = tipo;
    else state.vendors.push({ usuario_id: Number(userId), cod_vendedor: cod, tipo });
    return [{ affectedRows: 1 }];
  }

  if (normalized.startsWith('UPDATE usuario_vendedor SET tipo = ? WHERE usuario_id = ? AND cod_vendedor = ?')) {
    const [tipo, userId, cod] = params;
    const existing = state.vendors.find(v => Number(v.usuario_id) === Number(userId) && String(v.cod_vendedor) === String(cod));
    if (existing) existing.tipo = tipo;
    return [{ affectedRows: existing ? 1 : 0 }];
  }

  if (normalized.startsWith('DELETE FROM usuario_vendedor WHERE usuario_id = ? AND cod_vendedor = ?')) {
    const before = state.vendors.length;
    state.vendors = state.vendors.filter(v => !(Number(v.usuario_id) === Number(params[0]) && String(v.cod_vendedor) === String(params[1])));
    return [{ affectedRows: before - state.vendors.length }];
  }

  throw new Error(`Query no mockeada: ${normalized}`);
}

function makeConnection() {
  return {
    query: jest.fn((sql, params) => Promise.resolve(handleQuery(sql, params))),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetState();
  mockConnection = makeConnection();
  mockGetConnection.mockResolvedValue(mockConnection);
});

describe('GET /api/admin/usuarios', () => {
  test('lista usuarios reales sin password', async () => {
    const res = await request(app).get('/api/admin/usuarios');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).not.toHaveProperty('password');
    expect(res.body.data[0]).toHaveProperty('menus');
    expect(res.body.data[0]).toHaveProperty('vendedores');
  });
});

describe('POST /api/admin/usuarios', () => {
  test('crea usuario y lo devuelve', async () => {
    const res = await request(app).post('/api/admin/usuarios').send({
      nombre: 'Nuevo Usuario',
      email: 'nuevo@texpro.cl',
      codigo: '777',
      area: 'ventas',
      is_admin: false,
      is_active: true,
      password: 'Secreta123',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(state.users.some(user => user.email === 'nuevo@texpro.cl')).toBe(true);
  });
});

describe('PUT /api/admin/usuarios/:id', () => {
  test('edita usuario existente', async () => {
    const res = await request(app).put('/api/admin/usuarios/2').send({
      nombre: 'Ana Editada',
      email: 'ana.editada@texpro.cl',
      codigo: '999',
      area: 'ventas',
      is_admin: false,
      is_active: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.nombre).toBe('Ana Editada');
    expect(res.body.data.codigo).toBe('101');
    expect(state.users.find(user => Number(user.id) === 2).codigo).toBe('101');
  });

  test('bloquea dejar el sistema sin admin', async () => {
    state.users = [
      { id: 1, nombre: 'Admin', email: 'admin@texpro.cl', codigo: '900', area: 'administracion', is_admin: 1, is_active: 1, last_login: null, created_at: '2026-06-01 00:00:00' },
    ];

    const res = await request(app).put('/api/admin/usuarios/1').send({
      nombre: 'Admin',
      email: 'admin@texpro.cl',
      codigo: '900',
      area: 'administracion',
      is_admin: false,
      is_active: false,
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});

describe('Menús', () => {
  test('lista menús reales', async () => {
    const res = await request(app).get('/api/admin/menus');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(3);
  });

  test('crea, edita y desactiva un menú', async () => {
    const created = await request(app).post('/api/admin/menus').send({
      codigo: 'nuevo_menu',
      nombre: 'Nuevo Menú',
      url: '/src/modulo/nuevo/index.html',
      icono: '⭐',
      grupo: 'General',
      orden: 9,
      activo: true,
    });
    expect(created.status).toBe(201);
    expect(state.menus.some(menu => menu.codigo === 'nuevo_menu')).toBe(true);

    const updated = await request(app).put(`/api/admin/menus/${created.body.data.id}`).send({
      codigo: 'nuevo_menu',
      nombre: 'Nuevo Menú Editado',
      url: '/src/modulo/nuevo/index.html',
      icono: '⭐',
      grupo: 'General',
      orden: 10,
      activo: true,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.nombre).toBe('Nuevo Menú Editado');

    const deactivated = await request(app).patch(`/api/admin/menus/${created.body.data.id}/desactivar`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.activo).toBe(false);
  });
});

describe('Permisos', () => {
  test('asigna menús a un usuario y por área', async () => {
    const putRes = await request(app).put('/api/admin/usuarios/2/menus').send({
      menus: [1, 11, 12],
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body.ok).toBe(true);

    const areaRes = await request(app).post('/api/admin/accesos/asignar-por-area').send({
      area: 'ventas',
      menus: ['ventas_dashboard', 'alertas'],
    });
    expect(areaRes.status).toBe(200);
    expect(areaRes.body.data.usuarios).toBeGreaterThanOrEqual(1);
  });
});

describe('Vendedores', () => {
  test('gestiona usuario_vendedor', async () => {
    const createRes = await request(app).post('/api/admin/usuarios/2/vendedores').send({
      cod_vendedor: 'V002',
      tipo: 'compartido',
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.some(item => item.cod_vendedor === 'V002')).toBe(true);

    const updateRes = await request(app).put('/api/admin/usuarios/2/vendedores/V002').send({
      tipo: 'S',
    });
    expect(updateRes.status).toBe(200);

    const deleteRes = await request(app).delete('/api/admin/usuarios/2/vendedores/V002');
    expect(deleteRes.status).toBe(200);
  });
});

describe('Seguridad de sesión', () => {
  test('desactivar el último admin devuelve 400', async () => {
    state.users = [
      { id: 1, nombre: 'Admin', email: 'admin@texpro.cl', codigo: '900', area: 'administracion', is_admin: 1, is_active: 1, last_login: null, created_at: '2026-06-01 00:00:00' },
    ];

    const res = await request(app).patch('/api/admin/usuarios/1/desactivar').send({ confirmar: true });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
describe('Areas', () => {
  test('lista areas reales con perfil base y conteos', async () => {
    const res = await request(app).get('/api/admin/areas');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]).toHaveProperty('perfil_base_nombre');
    expect(res.body.data[0]).toHaveProperty('total_usuarios');
  });

  test('crea area, normaliza el codigo y bloquea duplicados', async () => {
    const created = await request(app).post('/api/admin/areas').send({
      nombre: 'Laboratorio Nueva',
      codigo: 'Laboratorio Nueva',
      descripcion: 'Area de pruebas',
      perfil_base_id: 1,
      activo: 1,
    });

    expect(created.status).toBe(201);
    expect(created.body.ok).toBe(true);
    expect(created.body.data.codigo).toBe('laboratorio_nueva');
    expect(state.areas.some(area => area.codigo === 'laboratorio_nueva')).toBe(true);

    const duplicate = await request(app).post('/api/admin/areas').send({
      nombre: 'Duplicada',
      codigo: 'laboratorio_nueva',
      descripcion: 'Duplicada',
      activo: 1,
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.ok).toBe(false);
  });

  test('edita, desactiva y reactiva un area', async () => {
    const updated = await request(app).put('/api/admin/areas/2').send({
      nombre: 'Laboratorio Ajustado',
      codigo: 'Laboratorio Ajustado',
      descripcion: 'Area ajustada',
      perfil_base_id: null,
      activo: 1,
    });

    expect(updated.status).toBe(200);
    expect(updated.body.ok).toBe(true);
    expect(updated.body.data.codigo).toBe('laboratorio_ajustado');
    expect(state.areas.find(area => Number(area.id) === 2).nombre).toBe('Laboratorio Ajustado');

    state.users[1].area = 'laboratorio_ajustado';

    const blocked = await request(app).patch('/api/admin/areas/2/desactivar').send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('AREA_CON_USUARIOS');

    const deactivated = await request(app).patch('/api/admin/areas/2/desactivar').send({ confirmar: true });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.activo).toBe(false);

    const activated = await request(app).patch('/api/admin/areas/2/activar').send({});
    expect(activated.status).toBe(200);
    expect(activated.body.data.activo).toBe(true);
  });

  test('crea usuario usando area.codigo validada', async () => {
    const res = await request(app).post('/api/admin/usuarios').send({
      nombre: 'Usuario Laboratorio',
      email: 'lab@texpro.cl',
      codigo: '777',
      area: 'Laboratorio',
      is_admin: false,
      is_active: true,
      password: 'Secreta123',
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(state.users.find(user => user.email === 'lab@texpro.cl').area).toBe('laboratorio');
  });

  test('rechaza area inexistente', async () => {
    const res = await request(app).post('/api/admin/usuarios').send({
      nombre: 'Usuario Invalido',
      email: 'invalido@texpro.cl',
      codigo: '778',
      area: 'area-que-no-existe',
      is_admin: false,
      is_active: true,
      password: 'Secreta123',
    });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBeDefined();
  });
});
