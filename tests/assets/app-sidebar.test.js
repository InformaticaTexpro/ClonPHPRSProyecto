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

  test('muestra todos los menús del catálogo y bloquea los no permitidos', async () => {
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
    expect(document.body.textContent).not.toContain('Alertas');

    const enlaces = Array.from(document.querySelectorAll('#sidebarNav a'));
    const dashboard = enlaces.find(link => link.textContent.includes('Dashboard'));
    const facturacion = enlaces.find(link => link.textContent.includes('Facturación'));

    expect(dashboard.getAttribute('href')).toBe('/src/modulo/ventas/dashboard/index.html');
    expect(facturacion.getAttribute('href')).toContain('/src/modulo/varios/sin-acceso/index.html');
    expect(facturacion.classList.contains('is-locked')).toBe(true);
  });
});
