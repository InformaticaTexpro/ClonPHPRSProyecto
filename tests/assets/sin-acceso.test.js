/**
 * @jest-environment jsdom
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SCRIPT = fs.readFileSync(
  path.join(__dirname, '../../src/modulo/varios/sin-acceso/sin-acceso.js'),
  'utf8'
);

function montarVista() {
  document.body.innerHTML = `
    <article>
      <strong id="usuarioNombre"></strong>
      <strong id="usuarioArea"></strong>
      <strong id="moduloSolicitado"></strong>
      <strong id="moduloPrincipal"></strong>
      <a id="btnVolverModulo" href="#"></a>
    </article>
  `;
}

async function ejecutarScript({ token = null, response = null, reject = false, ruta } = {}) {
  montarVista();
  window.history.pushState({}, '', ruta || '/src/modulo/varios/sin-acceso/index.html?modulo=Facturación&from=/src/modulo/facturacion/facturacion/index.html');
  localStorage.clear();
  sessionStorage.clear();

  if (token) localStorage.setItem('token', token);

  global.fetch = jest.fn().mockImplementation(() => {
    if (reject) return Promise.reject(new Error('fetch fail'));
    return Promise.resolve({
      ok: true,
      json: async () => response,
    });
  });

  eval(SCRIPT);
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('sin-acceso', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  test('muestra usuario, area, modulo solicitado y modulo principal', async () => {
    await ejecutarScript({
      token: 'token-demo',
      response: {
        ok: true,
        user: {
          id: 23,
          nombre: 'NORELBYS OLIVEROS',
          email: 'norelby@texpro.cl',
          area: 'Ventas',
          menus: [
            { id: 1, codigo: 'ventas_dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', orden: 1 },
            { id: 2, codigo: 'ventas_asignadas', nombre: 'Ventas Asignadas', url: '/src/modulo/ventas/ventas/index.html', orden: 2 },
          ],
        },
        allMenus: [
          { id: 1, codigo: 'ventas_dashboard', nombre: 'Dashboard', url: '/src/modulo/ventas/dashboard/index.html', orden: 1 },
          { id: 7, codigo: 'facturacion', nombre: 'Facturación', url: '/src/modulo/facturacion/facturacion/index.html', orden: 1 },
        ],
      },
    });

    expect(document.getElementById('usuarioNombre').textContent).toBe('NORELBYS OLIVEROS');
    expect(document.getElementById('usuarioArea').textContent).toBe('Ventas');
    expect(document.getElementById('moduloSolicitado').textContent).toBe('Facturación');
    expect(document.getElementById('moduloPrincipal').textContent).toBe('Dashboard');
    expect(document.getElementById('btnVolverModulo').getAttribute('href')).toContain('/src/modulo/ventas/dashboard/index.html');
  });

  test('si solo existe alertas, no la usa como modulo principal', async () => {
    await ejecutarScript({
      token: 'token-demo',
      response: {
        ok: true,
        user: {
          id: 23,
          nombre: 'NORELBYS OLIVEROS',
          email: 'norelby@texpro.cl',
          area: 'Operaciones',
          menus: [
            { id: 9, codigo: 'alertas', grupo: 'general', nombre: 'Alertas', url: '/src/modulo/varios/alertas/index.html', orden: 1 },
          ],
        },
        allMenus: [
          { id: 9, codigo: 'alertas', grupo: 'general', nombre: 'Alertas', url: '/src/modulo/varios/alertas/index.html', orden: 1 },
        ],
      },
    });

    expect(document.getElementById('moduloPrincipal').textContent).toBe('Sin módulo principal asignado');
    expect(document.getElementById('btnVolverModulo').hasAttribute('href')).toBe(false);
    expect(document.getElementById('btnVolverModulo').getAttribute('aria-disabled')).toBe('true');
  });

  test('si no hay menus, mantiene la pantalla sin redireccion util', async () => {
    await ejecutarScript({
      token: 'token-demo',
      response: {
        ok: true,
        user: {
          id: 99,
          nombre: 'USUARIO SIN MENUS',
          email: 'sinmenus@texpro.cl',
          area: 'Operaciones',
          menus: [],
        },
        allMenus: [],
      },
    });

    expect(document.getElementById('moduloPrincipal').textContent).toBe('Sin módulo principal asignado');
    expect(document.getElementById('btnVolverModulo').hasAttribute('href')).toBe(false);
    expect(document.getElementById('btnVolverModulo').getAttribute('aria-disabled')).toBe('true');
  });
});
