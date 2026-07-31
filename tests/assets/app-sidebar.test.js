/**
 * @jest-environment jsdom
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SIDEBAR_SCRIPT = fs.readFileSync(
  path.join(__dirname, '../../src/assets/js/app-sidebar.js'),
  'utf8'
);

function montarSidebar() {
  document.body.innerHTML = `
    <aside class="sidebar">
      <nav class="sidebar-nav" id="sidebarNav"></nav>
    </aside>
  `;
}

function configurarPagina(ruta) {
  window.history.pushState({}, '', ruta);
}

function mockMeResponse({ user, allMenus }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, user, allMenus }),
  });
}

async function ejecutarSidebar({ ruta, user, allMenus }) {
  montarSidebar();
  configurarPagina(ruta);
  localStorage.setItem('token', 'token-demo');
  mockMeResponse({ user, allMenus });
  eval(SIDEBAR_SCRIPT);
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('app-sidebar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    jest.restoreAllMocks();
    window.__APP_SIDEBAR_LOADED__ = undefined;
  });

  test('muestra los menus del catalogo y los accesos generales habilitados', async () => {
    const allMenus = [
      { id: 1, codigo: 'ventas_dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', grupo: 'Ventas', orden: 1 },
      { id: 2, codigo: 'ventas_asignadas', nombre: 'Ventas Asignadas', url: '/src/modulo/ventas/ventas/index.html', icono: '🤝', grupo: 'Ventas', orden: 2 },
      { id: 3, codigo: 'historial_cliente', nombre: 'Historial Cliente', url: '/src/modulo/ventas/historial-cliente/index.html', icono: '📋', grupo: 'Ventas', orden: 3 },
      { id: 4, codigo: 'facturacion', nombre: 'Facturación', url: '/src/modulo/facturacion/facturacion/index.html', icono: '🧾', grupo: 'Facturación', orden: 1 },
      { id: 5, codigo: 'produccion', nombre: 'Producción', url: '/src/modulo/produccion/produccion/index.html', icono: '⚙️', grupo: 'Producción', orden: 1 },
      { id: 6, codigo: 'admin', nombre: 'Administración', url: '/src/modulo/admin/admin/index.html', icono: '🔧', grupo: 'Administración', orden: 1 },
      { id: 7, codigo: 'gerencia', nombre: 'Gerencia', url: '/src/modulo/gerencia/index.html', icono: '📈', grupo: 'Gerencia', orden: 1 },
    ];
    const user = {
      id: 23,
      nombre: 'Vendedor QA',
      email: 'qa@texpro.cl',
      menus: allMenus.slice(0, 3),
    };

    await ejecutarSidebar({
      ruta: '/src/modulo/ventas/dashboard/index.html',
      user,
      allMenus,
    });

    expect(document.body.textContent).toContain('Ventas');
    expect(document.body.textContent).toContain('Facturación');
    expect(document.body.textContent).toContain('Producción');
    expect(document.body.textContent).toContain('Administración');
    expect(document.body.textContent).toContain('Gerencia');
    expect(document.body.textContent).toContain('Alertas');
    expect(document.body.textContent).toContain('Chat');

    const enlaces = Array.from(document.querySelectorAll('#sidebarNav a'));
    const dashboard = enlaces.find(link => link.textContent.includes('Dashboard'));
    const facturacion = enlaces.find(link => link.textContent.includes('Facturación'));
    const alertasLinks = enlaces.filter(link => link.textContent.includes('Alertas'));
    const chatLinks = enlaces.filter(link => link.textContent.includes('Chat'));
    const grupos = Array.from(document.querySelectorAll('.nav-module')).map(modulo => ({
      nombre: modulo.querySelector('.nav-module-label')?.textContent || '',
      icono: modulo.querySelector('.nav-module-icon')?.textContent || '',
    }));
    const grupoVentas = grupos.find(grupo => grupo.nombre === 'Ventas');
    const grupoGeneral = grupos.find(grupo => grupo.nombre === 'General');

    expect(dashboard.getAttribute('href')).toBe('/src/modulo/ventas/dashboard/index.html');
    expect(facturacion.getAttribute('href')).toContain('/src/modulo/varios/sin-acceso/index.html');
    expect(facturacion.classList.contains('is-locked')).toBe(true);
    expect(alertasLinks).toHaveLength(1);
    expect(chatLinks).toHaveLength(1);
    expect(grupoVentas?.icono).toBe('💰');
    expect(grupoGeneral?.icono).toBe('🏠');
  });

  test('agrupa RRHH con su submenu de reportes', async () => {
    const allMenus = [
      { id: 20, codigo: 'rrhh', nombre: 'RRHH', url: '/src/modulo/rrhh/rrhh/index.html', icono: '👥', grupo: 'RRHH', orden: 1 },
      { id: 21, codigo: 'rrhh_reportes_compartidos', nombre: 'Reportes ventas compartidas', url: '/src/modulo/rrhh/reportes-compartidos/index.html', icono: '📄', grupo: 'RRHH', orden: 2 },
    ];
    const user = {
      id: 8,
      nombre: 'Rosa RRHH',
      email: 'rrhh@texpro.cl',
      menus: allMenus,
    };

    await ejecutarSidebar({
      ruta: '/src/modulo/rrhh/rrhh/index.html',
      user,
      allMenus,
    });

    expect(document.body.textContent).toContain('RRHH');
    expect(document.body.textContent).toContain('Reportes ventas compartidas');

    const enlaces = Array.from(document.querySelectorAll('#sidebarNav a')).map(link => link.textContent);
    expect(enlaces.some(text => text.includes('RRHH'))).toBe(true);
    expect(enlaces.some(text => text.includes('Reportes ventas compartidas'))).toBe(true);
  });

  test('fuerza RRHH como grupo independiente aunque llegue como General', async () => {
    const allMenus = [
      { id: 30, codigo: 'rrhh', nombre: 'RRHH', url: '/src/modulo/rrhh/rrhh/index.html', icono: '👥', grupo: 'General', orden: 1 },
      { id: 31, codigo: 'rrhh_reportes_compartidos', nombre: 'Reportes ventas compartidas', url: '/src/modulo/rrhh/reportes-compartidos/index.html', icono: '📄', grupo: 'General', orden: 2 },
    ];
    const user = {
      id: 9,
      nombre: 'Rosa RRHH',
      email: 'rrhh@texpro.cl',
      menus: allMenus,
    };

    await ejecutarSidebar({
      ruta: '/src/modulo/rrhh/rrhh/index.html',
      user,
      allMenus,
    });

    expect(document.body.textContent).toContain('RRHH');

    const enlaces = Array.from(document.querySelectorAll('#sidebarNav a')).map(link => link.textContent);
    expect(enlaces.some(text => text.includes('RRHH'))).toBe(true);
    expect(enlaces.some(text => text.includes('Reportes ventas compartidas'))).toBe(true);
  });

  test('muestra el grupo General cuando existe un menu real del modulo', async () => {
    const allMenus = [
      { id: 40, codigo: 'general', nombre: 'General', url: '/src/modulo/general/general/index.html', icono: '🏠', grupo: 'General', orden: 1 },
      { id: 41, codigo: 'alertas', nombre: 'Alertas', url: '/src/modulo/varios/alertas/index.html', icono: '🔔', grupo: 'General', orden: 2 },
    ];
    const user = {
      id: 10,
      nombre: 'Usuario General',
      email: 'general@texpro.cl',
      menus: allMenus,
    };

    await ejecutarSidebar({
      ruta: '/src/modulo/general/general/index.html',
      user,
      allMenus,
    });

    expect(document.body.textContent).toContain('General');

    const enlaces = Array.from(document.querySelectorAll('#sidebarNav a')).map(link => link.textContent);
    expect(enlaces.some(text => text.includes('General'))).toBe(true);

    const grupoGeneral = document.querySelector('.nav-module .nav-module-icon');
    expect(grupoGeneral?.textContent?.trim().length).toBeGreaterThan(0);
  });

  test('muestra General aunque el backend no lo devuelva en el catalogo', async () => {
    const allMenus = [
      { id: 50, codigo: 'ventas_dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', grupo: 'Ventas', orden: 1 },
    ];
    const user = {
      id: 11,
      nombre: 'Usuario Sin General',
      email: 'sin-general@texpro.cl',
      menus: [],
    };

    await ejecutarSidebar({
      ruta: '/src/modulo/ventas/dashboard/index.html',
      user,
      allMenus,
    });

    expect(document.body.textContent).toContain('General');
    const enlaces = Array.from(document.querySelectorAll('#sidebarNav a')).map(link => link.textContent);
    expect(enlaces.some(text => text.includes('General'))).toBe(true);
  });

  test('no duplica Alertas ni Chat cuando el backend ya los entrega', async () => {
    const allMenus = [
      { id: 60, codigo: 'general', nombre: 'General', url: '/src/modulo/general/general/index.html', icono: '🏠', grupo: 'General', orden: 1 },
      { id: 61, codigo: 'alertas', nombre: 'Alertas', url: '/src/modulo/varios/alertas/index.html', icono: '🔔', grupo: 'General', orden: 2 },
      { id: 62, codigo: 'mensajeria', nombre: 'Chat', url: '/src/modulo/varios/mensajeria/index.html', icono: '💬', grupo: 'General', orden: 3 },
    ];
    const user = {
      id: 12,
      nombre: 'Usuario General',
      email: 'general@texpro.cl',
      menus: allMenus,
    };

    await ejecutarSidebar({
      ruta: '/src/modulo/general/general/index.html',
      user,
      allMenus,
    });

    const enlaces = Array.from(document.querySelectorAll('#sidebarNav a')).map(link => link.textContent);
    expect(enlaces.filter(text => text.includes('Alertas'))).toHaveLength(1);
    expect(enlaces.filter(text => text.includes('Chat'))).toHaveLength(1);
  });
});
