'use strict';

/**
 * app-sidebar.js
 * Sidebar central basado en catálogo completo de menús activos.
 * - Todos los módulos se muestran.
 * - El acceso se controla al entrar, no al visualizar.
 */
(function () {
  window.__APP_SIDEBAR_LOADED__ = true;

  const NO_ACCESS_URL = '/src/modulo/varios/sin-acceso/index.html';
  const EXTRA_ITEMS = [
    { id: 'extra-alertas', codigo: 'alertas', nombre: 'Alertas', url: '/src/modulo/varios/alertas/index.html', icono: '🔔', grupo: 'General', orden: 1, extra: true },
  ];

  function normalizarTexto(valor) {
    return String(valor || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizarUrl(url) {
    let valor = String(url || '').trim();
    if (!valor) return '';
    if (!valor.startsWith('/')) valor = `/${valor}`;
    valor = valor.replace(/\/+$/, '');
    valor = valor.replace(/\/index\.html$/, '/index.html');
    return valor;
  }

  function rutaActual() {
    return normalizarUrl(window.location.pathname);
  }

  function normalizarMenus(menus) {
    return (menus || [])
      .map(menu => ({
        id: menu?.id ?? null,
        codigo: normalizarTexto(menu?.codigo),
        nombre: String(menu?.nombre || '').trim(),
        url: normalizarUrl(menu?.url),
        icono: String(menu?.icono || '').trim() || '•',
        grupo: String(menu?.grupo || 'General').trim() || 'General',
        orden: Number(menu?.orden ?? 0) || 0,
        extra: Boolean(menu?.extra),
      }))
      .filter(menu => menu.id !== null && menu.nombre && menu.url);
  }

  function construirCatalogo(allMenus) {
    const catalogo = normalizarMenus(allMenus);
    const map = new Map(catalogo.map(menu => [menu.url, menu]));

    EXTRA_ITEMS.forEach(item => {
      const url = normalizarUrl(item.url);
      if (!map.has(url)) {
        map.set(url, {
          id: item.id,
          codigo: normalizarTexto(item.codigo),
          nombre: String(item.nombre || '').trim(),
          url,
          icono: String(item.icono || '').trim() || '•',
          grupo: String(item.grupo || 'General').trim() || 'General',
          orden: Number(item.orden ?? 0) || 0,
          extra: true,
        });
      }
    });

    return Array.from(map.values());
  }

  function agruparMenus(menus) {
    const grupos = new Map();

    menus.forEach(menu => {
      const nombreGrupo = menu.grupo || 'General';
      if (!grupos.has(nombreGrupo)) {
        grupos.set(nombreGrupo, {
          nombre: nombreGrupo,
          orden: Number.isFinite(menu.orden) ? menu.orden : 0,
          icono: menu.icono || '📁',
          items: [],
        });
      }

      const grupo = grupos.get(nombreGrupo);
      grupo.items.push(menu);
      grupo.orden = Math.min(grupo.orden, Number.isFinite(menu.orden) ? menu.orden : 0);
      if (!grupo.icono && menu.icono) grupo.icono = menu.icono;
    });

    return Array.from(grupos.values())
      .map(grupo => ({
        ...grupo,
        items: grupo.items.sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es')),
      }))
      .sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  function crearIndicePermisos(permisos) {
    const permitidos = normalizarMenus(permisos);
    const ids = new Set();
    const codigos = new Set();
    const urls = new Set();

    permitidos.forEach(menu => {
      if (menu.id !== null && menu.id !== undefined) ids.add(String(menu.id));
      if (menu.codigo) codigos.add(menu.codigo);
      if (menu.url) urls.add(menu.url);
    });

    return { ids, codigos, urls };
  }

  function tienePermiso(menu, indice) {
    return indice.ids.has(String(menu.id))
      || (menu.codigo && indice.codigos.has(menu.codigo))
      || indice.urls.has(menu.url);
  }

  function itemActivo(item) {
    return rutaActual() === item.url;
  }

  function grupoActivo(grupo) {
    return grupo.items.some(itemActivo);
  }

  function menuPorRuta(catalogo, pathname) {
    const path = normalizarUrl(pathname);
    return catalogo.find(menu => menu.url === path) || null;
  }

  function urlSinAcceso(menu, fromUrl) {
    const params = new URLSearchParams({
      modulo: menu?.nombre || 'Módulo restringido',
      from: normalizarUrl(fromUrl || rutaActual()),
    });
    return `${NO_ACCESS_URL}?${params.toString()}`;
  }

  function extraerUsuario(data) {
    const user = data?.user || data?.usuario || data || null;
    if (!user) return null;
    return {
      ...user,
      menus: Array.isArray(user.menus) ? user.menus : [],
    };
  }

  function extraerCatalogo(data) {
    return data?.allMenus
      || data?.menusDisponibles
      || data?.user?.allMenus
      || data?.user?.menusDisponibles
      || [];
  }

  function validarAccesoPaginaActual(catalogo, usuario, indicePermisos) {
    const actual = rutaActual();
    if (!actual || actual === NO_ACCESS_URL) return;

    const menuActual = menuPorRuta(catalogo, actual);
    if (!menuActual) return;

    if (menuActual.extra) return;

    if (!tienePermiso(menuActual, indicePermisos)) {
      window.location.href = urlSinAcceso(menuActual, actual);
    }
  }

  function inyectarEstilos() {
    if (document.getElementById('appSidebarStyles')) return;
    const style = document.createElement('style');
    style.id = 'appSidebarStyles';
    style.textContent = `
      .nav-loading,
      .nav-empty {
        display:flex;
        align-items:center;
        justify-content:center;
        padding:14px 12px;
        margin:8px 0 4px;
        border-radius:12px;
        background:rgba(255,255,255,.05);
        color:rgba(255,255,255,.68);
        font-size:.82rem;
        font-weight:600;
      }
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
      .nav-module-lock { font-size:.75rem; opacity:.72; }
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
      .nav-subitem.is-locked { color:rgba(255,255,255,.42) !important; }
      .nav-subitem.is-locked:hover { color:rgba(255,255,255,.72) !important; }
      .nav-subitem .nav-label { flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .nav-extra-badge {
        display:inline-flex; align-items:center; justify-content:center;
        min-width:18px; height:18px; margin-left:auto; padding:0 5px;
        border-radius:999px; background:#fff; color:#0f5d52;
        font-size:.68rem; font-weight:700; line-height:1;
      }
      .sidebar--collapsed .nav-module-label,
      .sidebar--collapsed .nav-module-chevron,
      .sidebar--collapsed .nav-module-lock,
      .sidebar--collapsed .nav-subitems { display:none !important; }
      .sidebar--collapsed .nav-module-btn { justify-content:center; padding-inline:8px; }
    `;
    document.head.appendChild(style);
  }

  function renderGrupo(grupo, indicePermisos) {
    const abierto = grupoActivo(grupo);
    return `
      <div class="nav-module ${abierto ? 'is-open' : ''}">
        <button class="nav-module-btn ${abierto ? 'is-open' : ''}" type="button" aria-expanded="${abierto ? 'true' : 'false'}">
          <span class="nav-module-icon">${grupo.icono || '📁'}</span>
          <span class="nav-module-label">${grupo.nombre}</span>
          <span class="nav-module-chevron">▶</span>
        </button>
        <div class="nav-subitems">
          ${grupo.items.map(item => {
            const permitido = item.extra ? true : tienePermiso(item, indicePermisos);
            const href = permitido ? item.url : urlSinAcceso(item, rutaActual());
            return `
              <a class="nav-subitem ${itemActivo(item) ? 'active' : ''} ${permitido ? '' : 'is-locked'}" href="${href}">
                <span>${item.icono}</span>
                <span class="nav-label">${item.nombre}</span>
                ${permitido ? '' : '<span class="nav-module-lock" title="Sin acceso">🔒</span>'}
                ${item.extra ? '<span class="nav-extra-badge" id="navBadgeAlertas" style="display:none">0</span>' : ''}
              </a>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderSidebar(data) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;

    inyectarEstilos();

    const usuario = extraerUsuario(data);
    const catalogo = construirCatalogo(extraerCatalogo(data));
    const indicePermisos = crearIndicePermisos(usuario?.menus);
    const grupos = agruparMenus(catalogo);

    if (!grupos.length) {
      nav.innerHTML = '<div class="nav-empty">Sin menús activos</div>';
      return;
    }

    nav.innerHTML = `
      <span class="nav-section-title">MENÚ</span>
      ${grupos.map(grupo => renderGrupo(grupo, indicePermisos)).join('')}
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

  async function obtenerContextoSidebar() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return null;

      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data || null;
    } catch (err) {
      console.warn('[app-sidebar] No se pudo obtener usuario:', err.message);
      return null;
    }
  }

  async function init() {
    const nav = document.getElementById('sidebarNav');
    if (nav) {
      inyectarEstilos();
      nav.innerHTML = '<div class="nav-loading">Cargando menú...</div>';
    }

    const data = await obtenerContextoSidebar();
    if (!data?.user) {
      if (nav) nav.innerHTML = '<div class="nav-empty">Sin sesión activa</div>';
      return;
    }

    const usuario = extraerUsuario(data);
    const catalogo = construirCatalogo(extraerCatalogo(data));
    const indicePermisos = crearIndicePermisos(usuario?.menus);
    validarAccesoPaginaActual(catalogo, usuario, indicePermisos);
    renderSidebar(data);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
