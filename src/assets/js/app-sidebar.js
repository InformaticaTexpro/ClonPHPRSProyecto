'use strict';

/**
 * app-sidebar.js
 * Sidebar central por módulos desplegables.
 * Visibilidad: todos los módulos son visibles.
 * Acceso: usuario.area + usuario.is_admin.
 */
(function () {
  window.__APP_SIDEBAR_LOADED__ = true;
  const AREA_ADMIN = ['admin', 'gerencia'];
  const NO_ACCESS_URL = '/src/modulo/varios/sin-acceso/index.html';

  const NAV_MODULOS = [
    {
      nombre: 'Ventas',
      icon: '📊',
      areas: ['ventas', 'gerencia', 'admin'],
      mainUrl: '/src/modulo/ventas/dashboard/index.html',
      items: [
        { nombre: 'Dashboard', icon: '🏠', url: '/src/modulo/ventas/dashboard/index.html' },
        { nombre: 'Ventas Asignadas', icon: '🤝', url: '/src/modulo/ventas/ventas/index.html' },
        { nombre: 'Historial Cliente', icon: '📋', url: '/src/modulo/ventas/historial-cliente/index.html' },
      ],
    },
    {
      nombre: 'Producción',
      icon: '⚙️',
      areas: ['produccion', 'gerencia', 'admin'],
      mainUrl: '/src/modulo/produccion/produccion/index.html',
      items: [
        { nombre: 'Producción', icon: '⚙️', url: '/src/modulo/produccion/produccion/index.html' },
      ],
    },
    {
      nombre: 'Bodega',
      icon: '🏭',
      areas: ['bodega', 'produccion', 'gerencia', 'admin'],
      mainUrl: '/src/modulo/bodega/bodega/index.html',
      items: [
        { nombre: 'Bodega', icon: '🏭', url: '/src/modulo/bodega/bodega/index.html' },
      ],
    },
    {
      nombre: 'Servicio Técnico',
      icon: '🛠️',
      areas: ['servicio-tecnico', 'servicio', 'serv-tecnico', 'gerencia', 'admin'],
      mainUrl: '/src/modulo/servtecnico/servicio-tecnico/index.html',
      items: [
        { nombre: 'Servicio Técnico', icon: '🛠️', url: '/src/modulo/servtecnico/servicio-tecnico/index.html' },
      ],
    },
    {
      nombre: 'Facturación',
      icon: '🧾',
      areas: ['facturacion', 'contabilidad', 'gerencia', 'admin'],
      mainUrl: '/src/modulo/facturacion/facturacion/index.html',
      items: [
        { nombre: 'Facturación', icon: '🧾', url: '/src/modulo/facturacion/facturacion/index.html' },
      ],
    },
    {
      nombre: 'RRHH',
      icon: '👥',
      areas: ['rrhh', 'gerencia', 'admin'],
      mainUrl: '/src/modulo/rrhh/rrhh/index.html',
      items: [
        { nombre: 'RRHH', icon: '👥', url: '/src/modulo/rrhh/rrhh/index.html' },
      ],
    },
    {
      nombre: 'Contabilidad',
      icon: '📜',
      areas: ['contabilidad', 'gerencia', 'admin'],
      mainUrl: '/src/modulo/contabilidad/contabilidad/index.html',
      items: [
        { nombre: 'Contabilidad', icon: '📜', url: '/src/modulo/contabilidad/contabilidad/index.html' },
        { nombre: 'Cobranza', icon: '💰', url: '/src/modulo/cobranza/cobranza/index.html' },
      ],
    },
    {
      nombre: 'Administración',
      icon: '🔧',
      areas: ['admin'],
      mainUrl: '/src/modulo/admin/admin/index.html',
      items: [
        { nombre: 'Administración', icon: '🔧', url: '/src/modulo/admin/admin/index.html' },
      ],
    },
    {
      nombre: 'Gerencia',
      icon: '📈',
      areas: ['gerencia', 'admin'],
      mainUrl: '/src/modulo/gerencia/index.html',
      items: [
        { nombre: 'Gerencia', icon: '📈', url: '/src/modulo/gerencia/index.html' },
      ],
    },
  ];

  const EXTRA_ITEMS = [
    { nombre: 'Alertas', icon: '🔔', url: '/src/modulo/varios/alertas/index.html', badge: true },
  ];

  function normalizarArea(area) {
    return String(area || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

  function esAdmin(usuario) {
    const area = normalizarArea(usuario?.area);
    return Boolean(usuario?.is_admin) || AREA_ADMIN.includes(area);
  }

  function puedeAccederModulo(modulo, usuario) {
    if (esAdmin(usuario)) return true;
    const area = normalizarArea(usuario?.area);
    if (!area) return false;
    return modulo.areas.map(normalizarArea).includes(area);
  }

  function rutaActual() {
    return window.location.pathname.replace(/\/index\.html$/, '/index.html');
  }

  function itemActivo(item) {
    return rutaActual() === item.url;
  }

  function moduloActivo(modulo) {
    return modulo.items.some(itemActivo);
  }

  function urlSinAcceso(modulo) {
    const params = new URLSearchParams({
      modulo: modulo.nombre,
      from: rutaActual(),
    });
    return `${NO_ACCESS_URL}?${params.toString()}`;
  }

  function moduloPorRuta(pathname) {
    const path = pathname.replace(/\/index\.html$/, '/index.html');
    return NAV_MODULOS.find(modulo => modulo.items.some(item => item.url === path));
  }

  function validarAccesoPaginaActual(usuario) {
    if (rutaActual() === NO_ACCESS_URL) return;
    const modulo = moduloPorRuta(rutaActual());
    if (!modulo) return;
    if (puedeAccederModulo(modulo, usuario)) return;
    window.location.href = urlSinAcceso(modulo);
  }

  function inyectarEstilos() {
    if (document.getElementById('appSidebarStyles')) return;
    const style = document.createElement('style');
    style.id = 'appSidebarStyles';
    style.textContent = `
      .nav-module { display:flex; flex-direction:column; gap:2px; }
      .nav-module-btn {
        width:100%; display:flex; align-items:center; gap:10px;
        padding:9px 10px; border:0; border-radius:8px;
        background:transparent; color:rgba(255,255,255,.72);
        font:inherit; font-size:.85rem; font-weight:700; cursor:pointer;
        text-align:left; transition:all .15s;
      }
      .nav-module-btn:hover { background:rgba(255,255,255,.07); color:#fff; }
      .nav-module-btn.is-open { color:#fff; background:rgba(255,255,255,.08); }
      .nav-module.is-locked .nav-module-btn { color:rgba(255,255,255,.42); }
      .nav-module.is-locked .nav-module-btn:hover { color:rgba(255,255,255,.72); }
      .nav-module-icon { width:20px; min-width:20px; text-align:center; font-size:1rem; }
      .nav-module-label { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .nav-module-lock { font-size:.75rem; opacity:.55; }
      .nav-module-chevron { font-size:.72rem; opacity:.7; transition:transform .16s; }
      .nav-module-btn.is-open .nav-module-chevron { transform:rotate(90deg); }
      .nav-subitems { display:none; flex-direction:column; gap:2px; margin:2px 0 6px 26px; }
      .nav-module.is-open .nav-subitems { display:flex; }
      .nav-subitem {
        display:flex; align-items:center; gap:8px; min-height:32px;
        padding:7px 9px; border-radius:7px; text-decoration:none !important;
        color:rgba(255,255,255,.62) !important; font-size:.8rem; font-weight:500;
      }
      .nav-subitem:hover { background:rgba(255,255,255,.07); color:#fff !important; }
      .nav-subitem.active { background:var(--color-primary,#00E2A7); color:#000 !important; font-weight:700; }
      .nav-subitem.is-locked { color:rgba(255,255,255,.38) !important; }
      .nav-subitem.is-locked:hover { color:rgba(255,255,255,.68) !important; }
      .nav-extra-badge {
        display:inline-flex; align-items:center; justify-content:center;
        min-width:18px; height:18px; margin-left:auto; padding:0 5px;
        border-radius:999px; background:#fff; color:#0f5d52;
        font-size:.68rem; font-weight:700; line-height:1;
      }
      #sidebarNav:empty { visibility:hidden; }
      .sidebar--collapsed .nav-module-label,
      .sidebar--collapsed .nav-module-chevron,
      .sidebar--collapsed .nav-module-lock,
      .sidebar--collapsed .nav-subitems { display:none !important; }
      .sidebar--collapsed .nav-module-btn { justify-content:center; padding-inline:8px; }
    `;
    document.head.appendChild(style);
  }

  function renderModulo(modulo, usuario) {
    const permitido = puedeAccederModulo(modulo, usuario);
    const abierto = moduloActivo(modulo);
    return `
      <div class="nav-module ${abierto ? 'is-open' : ''} ${permitido ? '' : 'is-locked'}">
        <button class="nav-module-btn ${abierto ? 'is-open' : ''}" type="button" aria-expanded="${abierto ? 'true' : 'false'}">
          <span class="nav-module-icon">${modulo.icon}</span>
          <span class="nav-module-label">${modulo.nombre}</span>
          ${permitido ? '' : '<span class="nav-module-lock" title="Sin acceso">🔒</span>'}
          <span class="nav-module-chevron">▶</span>
        </button>
        <div class="nav-subitems">
          ${modulo.items.map(item => {
            const href = permitido ? item.url : urlSinAcceso(modulo);
            return `
              <a class="nav-subitem ${itemActivo(item) ? 'active' : ''} ${permitido ? '' : 'is-locked'}" href="${href}">
                <span>${item.icon}</span><span class="nav-label">${item.nombre}</span>${permitido ? '' : '<span title="Sin acceso">🔒</span>'}
              </a>
            `;
          }).join('')}
        </div>
      </div>`;
  }

  function renderSidebar(usuario) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;

    inyectarEstilos();

    nav.innerHTML = `
      <span class="nav-section-title">MÓDULOS</span>
      ${NAV_MODULOS.map(modulo => renderModulo(modulo, usuario)).join('')}
      <span class="nav-section-title">GENERAL</span>
      ${EXTRA_ITEMS.map(item => `
        <a class="nav-item ${itemActivo(item) ? 'active' : ''}" href="${item.url}">
          <span style="font-size:1rem">${item.icon}</span><span class="nav-label">${item.nombre}</span>
          ${item.badge ? '<span class="nav-extra-badge" id="navBadgeAlertas" style="display:none">0</span>' : ''}
        </a>
      `).join('')}
    `;

    nav.querySelectorAll('.nav-module-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const modulo = btn.closest('.nav-module');
        const open = !modulo.classList.contains('is-open');
        modulo.classList.toggle('is-open', open);
        btn.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  async function getUsuarioActual() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      return data?.user || null;
    } catch (err) {
      console.warn('[app-sidebar] No se pudo obtener usuario:', err.message);
      return null;
    }
  }

  async function init() {
    const usuario = await getUsuarioActual();
    if (!usuario) return;
    validarAccesoPaginaActual(usuario);
    renderSidebar(usuario);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
