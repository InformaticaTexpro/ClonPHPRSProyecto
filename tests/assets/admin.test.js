/**
 * @jest-environment jsdom
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '../../src/modulo/admin/admin/admin.js'),
  'utf8'
);

function montarVista() {
  document.body.innerHTML = `
    <aside class="sidebar">
      <nav class="sidebar-nav" id="sidebarNav"></nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div id="userAvatar"></div>
          <div class="user-info">
            <span id="userName"></span>
            <span id="userArea"></span>
          </div>
        </div>
        <button id="btnLogout" type="button"></button>
      </div>
    </aside>
    <div class="main-wrapper" id="mainWrapper">
      <header class="main-header">
        <div class="header-left">
          <button id="headerMenuBtn" type="button"></button>
          <h1 class="header-title"></h1>
        </div>
        <div class="header-right">
          <span id="headerDate"></span>
          <div class="header-user-chip">
            <div id="chipAvatar"></div>
            <span id="chipName"></span>
          </div>
        </div>
      </header>
      <main class="main-content">
        <section class="admin-hero">
          <div class="admin-hero__copy"></div>
          <div class="admin-hero__status">
            <span class="admin-status-pill"></span>
            <span class="admin-status-note" id="adminStatusNote"></span>
          </div>
        </section>
        <div id="adminMessage" class="admin-message" hidden></div>
        <section class="admin-kpis-grid" id="adminKpis"></section>
        <nav class="admin-tabs" id="adminTabs">
          <button class="admin-tab is-active" data-tab="usuarios" type="button">Usuarios</button>
          <button class="admin-tab" data-tab="permisos" type="button">Permisos por usuario</button>
          <button class="admin-tab" data-tab="perfiles" type="button">Perfiles</button>
          <button class="admin-tab" data-tab="menus" type="button">Menús y módulos</button>
          <button class="admin-tab" data-tab="areas" type="button">Áreas</button>
          <button class="admin-tab" data-tab="asignaciones" type="button">Asignación vendedores</button>
          <button class="admin-tab" data-tab="auditoria" type="button">Auditoría</button>
        </nav>
        <section class="admin-panels">
          <section class="admin-panel is-active" data-panel="usuarios">
            <button id="btnNuevoUsuario" type="button"></button>
            <input id="userSearch" />
            <select id="userAreaFilter"></select>
            <select id="userStatusFilter"></select>
            <select id="userAdminFilter"></select>
            <table><tbody id="usersTbody"></tbody></table>
          </section>
          <section class="admin-panel" data-panel="permisos" hidden>
            <select id="permUserSelect"></select>
            <select id="permAreaSelect"></select>
            <span id="permAllowedCount"></span>
            <span id="permBlockedCount"></span>
            <button id="permSelectAll" type="button"></button>
            <button id="permClearAll" type="button"></button>
            <button id="permRestoreArea" type="button"></button>
            <button id="permSave" type="button"></button>
            <div id="permGroups"></div>
          </section>
          <section class="admin-panel" data-panel="perfiles" hidden>
            <button id="btnNuevoPerfil" type="button"></button>
            <table><tbody id="profilesTbody"></tbody></table>
            <div id="profileMenuAllowedCount"></div>
            <div id="profileMenuBlockedCount"></div>
            <button id="profileMenuSelectAll" type="button"></button>
            <button id="profileMenuClearAll" type="button"></button>
            <button id="profileMenuSave" type="button"></button>
            <div id="profileMenuGroups"></div>
            <select id="profileUserSelect"></select>
            <div id="profileUserAssignedCount"></div>
            <button id="profileUserSave" type="button"></button>
            <div id="profileUserGroups"></div>
          </section>
          <section class="admin-panel" data-panel="menus" hidden>
            <button id="btnNuevoMenu" type="button"></button>
            <table><tbody id="menusTbody"></tbody></table>
            <div id="menusPreview"></div>
          </section>
          <section class="admin-panel" data-panel="areas" hidden>
            <div id="areasGrid"></div>
          </section>
          <section class="admin-panel" data-panel="asignaciones" hidden>
            <select id="assignUserSelect"></select>
            <input id="assignVendorCode" />
            <select id="assignVendorType">
              <option value="P">Principal</option>
              <option value="C">Compartido</option>
              <option value="S">Supervisor</option>
            </select>
            <button id="btnAddAssignment" type="button"></button>
            <table><tbody id="assignmentsTbody"></tbody></table>
          </section>
          <section class="admin-panel" data-panel="auditoria" hidden>
            <div id="auditTimeline"></div>
          </section>
        </section>
      </main>
    </div>
    <div class="drawer-overlay" id="drawerOverlay" aria-hidden="true">
      <div class="drawer">
        <div class="drawer__header">
          <div>
            <h3 id="drawerTitle"></h3>
            <p id="drawerSubtitle"></p>
          </div>
          <button id="drawerClose" type="button"></button>
        </div>
        <div class="drawer__body" id="drawerBody"></div>
        <div class="drawer__footer">
          <button id="drawerSecondary" type="button"></button>
          <button id="drawerDanger" type="button"></button>
          <button id="drawerDelete" type="button"></button>
          <button id="drawerPrimary" type="button"></button>
        </div>
      </div>
    </div>
    <div id="toastStack"></div>
  `;
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function ejecutarScript() {
  eval(SCRIPT);
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('admin UI real', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    jest.restoreAllMocks();
    montarVista();
    window.confirm = jest.fn(() => true);
    localStorage.setItem('token', 'token-prueba');

    global.fetch = jest.fn(async (url, options = {}) => {
      const pathName = String(url).replace(/^https?:\/\/[^/]+/, '');
      const method = String(options.method || 'GET').toUpperCase();

      if (pathName === '/api/admin/usuarios' && method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: [
              {
                id: 1,
                nombre: 'Admin',
                email: 'admin@texpro.cl',
                codigo: '900',
                area: 'administracion',
                is_admin: true,
                is_active: true,
                last_login: '2026-07-01 10:00:00',
                created_at: '2026-06-01 09:00:00',
                menus: [{ id: 11, codigo: 'administracion', nombre: 'Administración', url: '/src/modulo/admin/admin/index.html', icono: '🔧', grupo: 'Administración', orden: 1, activo: true }],
                perfiles: [{ id: 2, codigo: 'administracion', nombre: 'Administración', area: 'administracion', es_base: true, activo: true }],
                vendedores: [],
              },
              {
                id: 2,
                nombre: 'Ana',
                email: 'ana@texpro.cl',
                codigo: '101',
                area: 'ventas',
                is_admin: false,
                is_active: true,
                last_login: null,
                created_at: '2026-06-10 09:00:00',
                menus: [{ id: 1, codigo: 'ventas_dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', grupo: 'Ventas', orden: 1, activo: true }],
                perfiles: [{ id: 1, codigo: 'ventas', nombre: 'Ventas', area: 'ventas', es_base: true, activo: true }],
                vendedores: [{ cod_vendedor: 'V001', tipo: 'P' }],
              },
            ],
          }),
        };
      }

      if (pathName === '/api/admin/menus' && method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: [
              { id: 1, codigo: 'ventas_dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', grupo: 'Ventas', orden: 1, activo: true },
              { id: 11, codigo: 'administracion', nombre: 'Administración', url: '/src/modulo/admin/admin/index.html', icono: '🔧', grupo: 'Administración', orden: 1, activo: true },
            ],
          }),
        };
      }

      if (pathName === '/api/admin/perfiles' && method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: [
              { id: 1, codigo: 'ventas', nombre: 'Ventas', descripcion: 'Base ventas', area: 'ventas', es_base: true, activo: true, menus: [{ id: 1, codigo: 'ventas_dashboard' }], usuarios: [] },
              { id: 2, codigo: 'administracion', nombre: 'Administración', descripcion: 'Base admin', area: 'administracion', es_base: true, activo: true, menus: [{ id: 11, codigo: 'administracion' }], usuarios: [] },
            ],
          }),
        };
      }

      if (pathName === '/api/admin/areas' && method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            data: [
              { codigo: 'ventas', nombre: 'Ventas', total_usuarios: 1, sugeridos: ['ventas_dashboard', 'alertas'] },
              { codigo: 'administracion', nombre: 'Administración', total_usuarios: 1, sugeridos: ['administracion'] },
            ],
          }),
        };
      }

      if (pathName === '/api/admin/usuarios/1/menus' && method === 'GET') {
        return { ok: true, json: async () => ({ ok: true, data: [{ id: 11, codigo: 'administracion' }] }) };
      }

      if (pathName === '/api/admin/usuarios/1/perfiles' && method === 'GET') {
        return { ok: true, json: async () => ({ ok: true, data: [{ id: 2, codigo: 'administracion', es_base: true }] }) };
      }

      if (pathName === '/api/admin/perfiles/1/menus' && method === 'GET') {
        return { ok: true, json: async () => ({ ok: true, data: [{ id: 1, codigo: 'ventas_dashboard' }] }) };
      }

      if (pathName === '/api/admin/usuarios/1/vendedores' && method === 'GET') {
        return { ok: true, json: async () => ({ ok: true, data: [] }) };
      }

      if (pathName === '/api/admin/usuarios/1/menus' && method === 'PUT') {
        return { ok: true, json: async () => ({ ok: true, data: [{ id: 11, codigo: 'administracion' }] }) };
      }

      if (pathName === '/api/admin/perfiles/1/menus' && method === 'PUT') {
        return { ok: true, json: async () => ({ ok: true, data: [{ id: 1, codigo: 'ventas_dashboard' }] }) };
      }

      if (pathName === '/api/admin/usuarios/1/perfiles' && method === 'PUT') {
        return { ok: true, json: async () => ({ ok: true, data: [{ id: 2, codigo: 'administracion', es_base: true }] }) };
      }

      if (pathName === '/api/admin/accesos/asignar-por-area' && method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, data: { usuarios: 1, asignaciones: 2 } }) };
      }

      if (pathName === '/api/admin/usuarios/2/vendedores' && method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, data: [{ cod_vendedor: 'V002', tipo: 'C' }] }) };
      }

      if (pathName === '/api/admin/usuarios/2' && method === 'DELETE') {
        return { ok: true, json: async () => ({ ok: true, data: { id: 2, is_active: false } }) };
      }

      if (pathName === '/api/admin/perfiles' && method === 'POST') {
        return { ok: true, json: async () => ({ ok: true, data: { id: 3, codigo: 'nuevo-perfil' } }) };
      }

      return {
        ok: true,
        json: async () => ({ ok: true, data: {} }),
      };
    });
  });

  test('carga datos reales desde API y permite guardar permisos', async () => {
    ejecutarScript();
    await flush();
    await flush();

    expect(global.fetch).toHaveBeenCalledWith('/api/admin/usuarios', expect.any(Object));
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/menus', expect.any(Object));
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/areas', expect.any(Object));
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/perfiles', expect.any(Object));
    expect(document.getElementById('usersTbody').textContent).toContain('Ana');
    expect(window.__ADMIN_API__.state.users).toHaveLength(2);

    window.__ADMIN_API__.state.selectedPermUserId = 1;
    window.__ADMIN_API__.state.permissionsDraft = new Set([11]);
    document.getElementById('permSave').click();
    await flush();
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/usuarios/1/menus',
      expect.objectContaining({ method: 'PUT' })
    );
  });

  test('permite aplicar permisos por área y crear vendedores', async () => {
    ejecutarScript();
    await flush();
    await flush();

    document.getElementById('permAreaSelect').value = 'ventas';
    document.getElementById('permRestoreArea').click();
    await flush();
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/accesos/asignar-por-area',
      expect.objectContaining({ method: 'POST' })
    );

    document.querySelector('[data-tab="perfiles"]').click();
    await flush();
    await flush();
    expect(document.getElementById('profilesTbody').textContent).toContain('Ventas');

    window.__ADMIN_API__.state.selectedProfileId = 1;
    window.__ADMIN_API__.state.profileMenuDraft = new Set([1]);
    document.getElementById('profileMenuSave').click();
    await flush();
    await flush();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/perfiles/1/menus',
      expect.objectContaining({ method: 'PUT' })
    );

    window.__ADMIN_API__.state.selectedProfileUserId = 1;
    window.__ADMIN_API__.state.profileUserDraft = new Set([2]);
    document.getElementById('profileUserSave').click();
    await flush();
    await flush();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/usuarios/1/perfiles',
      expect.objectContaining({ method: 'PUT' })
    );

    window.__ADMIN_API__.state.selectedVendorUserId = 2;
    document.getElementById('assignUserSelect').value = '2';
    document.getElementById('assignVendorCode').value = 'V002';
    document.getElementById('assignVendorType').value = 'C';
    document.getElementById('btnAddAssignment').click();
    await flush();
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/admin/usuarios/2/vendedores',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
