'use strict';

/**
 * app-sidebar.js
 * Sidebar central por módulos desplegables.
 * Permisos base: usuario.area + usuario.is_admin.
 */
(function () {
  const AREA_ADMIN = ['admin', 'gerencia'];

  const NAV_MODULOS = [
    {
      nombre: 'Ventas',
      icon: '📊',
      areas: ['ventas', 'gerencia', 'admin'],
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
      items: [
        { nombre: 'Producción', icon: '⚙️', url: '/src/modulo/produccion/produccion/index.html' },
      ],
    },
    {
      nombre: 'Bodega',
      icon: '🏭',
      areas: ['bodega', 'produccion', 'gerencia', 'admin'],
      items: [
        { nombre: 'Bodega', icon: '🏭', url: '/src/modulo/bodega/bodega/index.html' },
      ],
    },
    {
      nombre: 'Servicio Técnico',
      icon: '🛠️',
      areas: ['servicio-tecnico', 'servicio', 'serv-tecnico', 'gerencia', 'admin'],
      items: [
        { nombre: 'Servicio Técnico', icon: '🛠️', url: '/src/modulo/servtecnico/servicio-tecnico/index.html' },
      ],
    },
    {
      nombre: 'Facturación',
      icon: '🧾',
      areas: ['facturacion', 'contabilidad', 'gerencia', 'admin'],
      items: [
        { nombre: 'Facturación', icon: '🧾', url: '/src/modulo/facturacion/facturacion/index.html' },
      ],
    },
    {
      nombre: 'RRHH',
      icon: '👥',
      areas: ['rrhh', 'gerencia', 'admin'],
      items: [
        { nombre: 'RRHH', icon: '👥', url: '/src/modulo/rrhh/rrhh/index.html' },
      ],
    },
    {
      nombre: 'Contabilidad',
      icon: '📜',
      areas: ['contabilidad', 'gerencia', 'admin'],
      items: [
        { nombre: 'Contabilidad', icon: '📜', url: '/src/modulo/contabilidad/contabilidad/index.html' },
        { nombre: 'Cobranza', icon: '💰', url: '/src/modulo/cobranza/cobranza/index.html' },
      ],
    },
    {
      nombre: 'Administración',
      icon: '🔧',
      areas: ['admin'],
      items: [
        { nombre: 'Administración', icon: '🔧', url: '/src/modulo/admin/admin/index.html' },
      ],
    },
  ];

  const EXTRA_ITEMS = [
    { nombre: 'Alertas', icon: '🔔', url: '/src/modulo/varios/alertas/index.html' },
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

  function puedeVerModulo(modulo, usuario) {
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
      .nav-module-icon { width:20px; min-width:20px; text-align:center; font-size:1rem; }
      .nav-module-label { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
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
      .nav-empty { color:rgba(255,255,255,.5); font-size:.78rem; padding:10px; line-height:1.4; }
      .sidebar--collapsed .nav-module-label,
      .sidebar--collapsed .nav-module-chevron,
      .sidebar--collapsed .nav-subitems { display:none !important; }
      .sidebar--collapsed .nav-module-btn { justify-content:center; padding-inline:8px; }
    `;
    document.head.appendChild(style);
  }

  function renderModulo(modulo) {
    const abierto = moduloActivo(modulo);
    return `
      <div class="nav-module ${abierto ? 'is-open' : ''}">
        <button class="nav-module-btn ${abierto ? 'is-open' : ''}" type="button" aria-expanded="${abierto ? 'true' : 'false'}">
          <span class="nav-module-icon">${modulo.icon}</span>
          <span class="nav-module-label">${modulo.nombre}</span>
          <span class="nav-module-chevron">▶</span>
        </button>
        <div class="nav-subitems">
          ${modulo.items.map(item => `
            <a class="nav-subitem ${itemActivo(item) ? 'active' : ''}" href="${item.url}">
              <span>${item.icon}</span><span class="nav-label">${item.nombre}</span>
            </a>
          `).join('')}
        </div>
      </div>`;
  }

  function renderSidebar(usuario) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;

    inyectarEstilos();

    const modulos = NAV_MODULOS.filter(m => puedeVerModulo(m, usuario));
    const area = normalizarArea(usuario?.area);
    const extras = area || esAdmin(usuario) ? EXTRA_ITEMS : [];

    nav.innerHTML = `
      <span class="nav-section-title">MÓDULOS</span>
      ${modulos.length ? modulos.map(renderModulo).join('') : '<div class="nav-empty">Usuario sin área asignada. Contacta a administración.</div>'}
      ${extras.length ? '<span class="nav-section-title">GENERAL</span>' : ''}
      ${extras.map(item => `
        <a class="nav-item ${itemActivo(item) ? 'active' : ''}" href="${item.url}">
          <span style="font-size:1rem">${item.icon}</span><span class="nav-label">${item.nombre}</span>
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
    renderSidebar(usuario);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
