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
        <section class="admin-kpis-grid" id="adminKpis"></section>
        <nav class="admin-tabs" id="adminTabs">
          <button class="admin-tab is-active" data-tab="usuarios" type="button">Usuarios</button>
          <button class="admin-tab" data-tab="permisos" type="button">Permisos por usuario</button>
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
            <span id="permAllowedCount"></span>
            <span id="permBlockedCount"></span>
            <button id="permSelectAll" type="button"></button>
            <button id="permClearAll" type="button"></button>
            <button id="permRestoreArea" type="button"></button>
            <button id="permSave" type="button"></button>
            <div id="permGroups"></div>
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
            <select id="assignVendorType"></select>
            <select id="assignStatus"></select>
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
          <button id="drawerPrimary" type="button"></button>
        </div>
      </div>
    </div>
    <div id="toastStack"></div>
  `;
}

function ejecutarScript() {
  eval(SCRIPT);
  document.dispatchEvent(new Event('DOMContentLoaded'));
}

describe('admin mock', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    jest.restoreAllMocks();
    montarVista();
    window.confirm = jest.fn(() => true);
  });

  test('renderiza el panel de administración y permite crear un usuario mock', () => {
    ejecutarScript();

    expect(document.querySelectorAll('.admin-tab')).toHaveLength(6);
    expect(document.getElementById('adminKpis').textContent).toContain('Total usuarios');

    window.__ADMIN_MOCK__.openUserEditor(null, 'new');
    document.getElementById('adminUserNombre').value = 'Nuevo Usuario QA';
    document.getElementById('adminUserEmail').value = 'nuevo.qa@texpro.cl';
    document.getElementById('adminUserCodigo').value = '777';
    document.getElementById('adminUserArea').value = 'ventas';

    document.getElementById('drawerPrimary').click();

    expect(window.__ADMIN_MOCK__.state.users.some(user => user.nombre === 'Nuevo Usuario QA')).toBe(true);
    expect(document.getElementById('usersTbody').textContent).toContain('Nuevo Usuario QA');
  });

  test('permite asignar permisos mock y guardarlos en memoria', () => {
    ejecutarScript();

    window.__ADMIN_MOCK__.state.selectedPermUserId = 29;
    window.__ADMIN_MOCK__.state.permissionsDraft = new Set(['ventas_dashboard']);
    window.__ADMIN_MOCK__.renderAll();
    document.getElementById('permSave').click();

    const user = window.__ADMIN_MOCK__.state.users.find(item => item.id === 29);
    expect(user.menus).toContain('ventas_dashboard');
  });
});
