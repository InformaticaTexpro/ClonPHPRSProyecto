'use strict';

/**
 * app-sidebar.js
 * Sidebar central basado en catálogo completo de menús activos.
 * - Todos los módulos se muestran.
 * - El acceso se controla al entrar, no al visualizar.
 */
(function () {
  window.__APP_SIDEBAR_LOADED__ = true;
  const FEATURE_FLAGS = {
    alertas: true,
    mensajeria: true,
  };

  const NO_ACCESS_URL = '/src/modulo/varios/sin-acceso/index.html';
  const EXTRA_ITEMS = FEATURE_FLAGS.alertas
    ? [{ id: 'extra-alertas', codigo: 'alertas', nombre: 'Alertas', url: '/src/modulo/varios/alertas/index.html', icono: '🔔', grupo: 'General', orden: 1, extra: true }]
    : [];
  if (FEATURE_FLAGS.mensajeria) {
    const mensajeriaExiste = EXTRA_ITEMS.some(item => item.codigo === 'mensajeria');
    if (!mensajeriaExiste) {
      EXTRA_ITEMS.push({
        id: 'extra-mensajeria',
        codigo: 'mensajeria',
        nombre: 'Chat',
        url: '/src/modulo/varios/mensajeria/index.html',
        icono: '💬',
        grupo: 'General',
        orden: 2,
        extra: true,
      });
    }
  }

  const GENERAL_ITEM = {
    id: 'extra-general',
    codigo: 'general',
    nombre: 'General',
    url: '/src/modulo/general/general/index.html',
    icono: '🏠',
    grupo: 'General',
    orden: 0,
    extra: true,
  };

  const RRHH_HOME_ITEM = {
    id: 'extra-rrhh-home',
    codigo: 'rrhh',
    nombre: 'RRHH',
    url: '/src/modulo/rrhh/rrhh/index.html',
    icono: '👥',
    grupo: 'RRHH',
    orden: 0,
    extra: true,
  };

  const RRHH_REVIEW_ITEM = {
    id: 'extra-rrhh-reportes-compartidos',
    codigo: 'rrhh_reportes_compartidos',
    nombre: 'Revisión ventas compartidas',
    url: '/src/modulo/rrhh/reportes-compartidos/index.html',
    icono: '📄',
    grupo: 'RRHH',
    orden: 1,
    extra: true,
  };

  [RRHH_HOME_ITEM, RRHH_REVIEW_ITEM].forEach(item => {
    const url = normalizarUrl(item.url);
    const exists = EXTRA_ITEMS.some(extra => normalizarUrl(extra.url) === url);
    if (!exists) EXTRA_ITEMS.push(item);
  });

  const GROUP_ICONS = {
    General: '🏠',
    Ventas: '💰',
    RRHH: '👥',
  };

  function ensureRealtimeClientLoaded() {
    if (document.getElementById('gicotexRealtimeClientScript')) return;
    const script = document.createElement('script');
    script.id = 'gicotexRealtimeClientScript';
    script.src = '/src/assets/js/realtime-client.js?v=1.0.0';
    script.defer = true;
    document.head.appendChild(script);
  }

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
        grupo: (() => {
          const codigo = normalizarTexto(menu?.codigo);
          const grupo = String(menu?.grupo || 'General').trim() || 'General';
          if (codigo === 'rrhh' || codigo === 'rrhh_reportes_compartidos') return 'RRHH';
          return grupo;
        })(),
        orden: Number(menu?.orden ?? 0) || 0,
        extra: Boolean(menu?.extra),
      }))
      .filter(menu => menu.id !== null && menu.nombre && menu.url)
      .filter(menu => (FEATURE_FLAGS.mensajeria ? true : menu.codigo !== 'mensajeria'))
      .filter(menu => (FEATURE_FLAGS.alertas ? true : menu.codigo !== 'alertas'));
  }

  function construirCatalogo(allMenus) {
    const catalogo = normalizarMenus(allMenus);
    const map = new Map(catalogo.map(menu => [menu.url, menu]));

    if (!map.has(normalizarUrl(GENERAL_ITEM.url))) {
      map.set(normalizarUrl(GENERAL_ITEM.url), {
        ...GENERAL_ITEM,
        url: normalizarUrl(GENERAL_ITEM.url),
      });
    }

    EXTRA_ITEMS.forEach(item => {
      const url = normalizarUrl(item.url);
      if (!map.has(url)) {
        map.set(url, {
          id: item.id,
          codigo: normalizarTexto(item.codigo),
          nombre: String(item.nombre || '').trim(),
          url,
          icono: String(item.icono || '').trim() || '•',
          grupo: (() => {
            const codigo = normalizarTexto(item.codigo);
            const grupo = String(item.grupo || 'General').trim() || 'General';
            if (codigo === 'rrhh' || codigo === 'rrhh_reportes_compartidos') return 'RRHH';
            return grupo;
          })(),
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
          icono: GROUP_ICONS[nombreGrupo] || menu.icono || '📁',
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
    if (menu?.codigo === 'general') return true;
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
      .sidebar {
        position: fixed !important;
        inset: 0 auto 0 0 !important;
        width: var(--sidebar-width, 240px) !important;
        height: 100vh !important;
        background: linear-gradient(180deg, var(--color-corporate-gray, #3A3A3A) 0%, var(--color-black, #1A1A1A) 100%) !important;
        color: var(--color-white, #fff) !important;
        display: flex !important;
        flex-direction: column !important;
        z-index: var(--z-sticky, 200) !important;
        overflow: hidden !important;
        box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.16)) !important;
        transition: width var(--transition-normal, 250ms ease), transform var(--transition-normal, 250ms ease) !important;
      }
      .sidebar--collapsed {
        width: var(--sidebar-width-collapsed, 112px) !important;
      }
      .main-wrapper {
        margin-left: var(--sidebar-width, 240px) !important;
        transition: margin-left var(--transition-normal, 250ms ease) !important;
      }
      .main-wrapper--expanded {
        margin-left: var(--sidebar-width-collapsed, 112px) !important;
      }
      .sidebar--collapsed ~ .main-wrapper,
      .sidebar--collapsed + .main-wrapper {
        margin-left: var(--sidebar-width-collapsed, 112px) !important;
      }
      .sidebar-header {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        padding: 18px 10px 14px !important;
        border-bottom: 1px solid rgba(255, 255, 255, .08) !important;
        flex-shrink: 0 !important;
        position: relative !important;
      }
      .sidebar-logo {
        width: 34px !important;
        height: 34px !important;
        border-radius: 8px !important;
        object-fit: contain !important;
        flex-shrink: 0 !important;
      }
      .sidebar-brand {
        font-family: var(--font-primary, 'Montserrat', sans-serif) !important;
        font-weight: 700 !important;
        font-size: .98rem !important;
        color: var(--color-white, #fff) !important;
        letter-spacing: .08em !important;
      }
      .sidebar-toggle {
        margin-left: auto !important;
        width: 34px !important;
        height: 34px !important;
        display: none !important;
        place-items: center !important;
        border: 1px solid rgba(255, 255, 255, .18) !important;
        border-radius: 9999px !important;
        background: linear-gradient(180deg, rgba(255, 255, 255, .16), rgba(255, 255, 255, .08)) !important;
        color: rgba(255, 255, 255, .96) !important;
        cursor: pointer !important;
        padding: 0 !important;
        box-shadow: 0 10px 18px rgba(0, 0, 0, .18) !important;
        transition: background var(--transition-fast, 150ms ease), color var(--transition-fast, 150ms ease), transform var(--transition-fast, 150ms ease) !important;
      }
      .sidebar-toggle:hover {
        background: rgba(0, 226, 167, .20) !important;
        color: #fff !important;
        transform: translateY(-1px) !important;
      }
      .sidebar-toggle:focus-visible {
        outline: 2px solid rgba(0, 226, 167, .85) !important;
        outline-offset: 2px !important;
      }
      .sidebar-nav {
        flex: 1 !important;
        overflow-y: auto !important;
        overflow-x: hidden !important;
        padding: 10px 6px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
      }
      .nav-section-title {
        display: block !important;
        font-family: var(--font-primary, 'Montserrat', sans-serif) !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        letter-spacing: .1em !important;
        text-transform: uppercase !important;
        color: rgba(255, 255, 255, .35) !important;
        padding: 8px 8px 4px !important;
      }
      .nav-item,
      .nav-module-btn,
      .sidebar-nav a {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        min-height: 40px !important;
        padding: 9px 10px !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: rgba(255, 255, 255, .78) !important;
        text-decoration: none !important;
        font-family: var(--font-secondary, 'Open Sans', sans-serif) !important;
        font-size: .86rem !important;
        font-weight: 600 !important;
        line-height: 1.2 !important;
        transition: background var(--transition-fast, 150ms ease), color var(--transition-fast, 150ms ease), transform var(--transition-fast, 150ms ease) !important;
      }
      .nav-item:hover,
      .nav-module-btn:hover,
      .sidebar-nav a:hover {
        background: rgba(255, 255, 255, .07) !important;
        color: #fff !important;
      }
      .nav-item.active,
      .nav-module-btn.is-open,
      .sidebar-nav a.active {
        background: rgba(0, 226, 167, .18) !important;
        color: #071d1a !important;
        font-weight: 700 !important;
      }
      .nav-module-btn.is-open .nav-module-chevron {
        transform: rotate(90deg) !important;
      }
      .nav-module {
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
      }
      .nav-module-icon {
        width: 20px !important;
        min-width: 20px !important;
        text-align: center !important;
        font-size: 1rem !important;
      }
      .nav-module-label {
        flex: 1 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .nav-module-lock {
        font-size: .75rem !important;
        opacity: .72 !important;
      }
      .nav-module-chevron {
        font-size: .72rem !important;
        opacity: .7 !important;
        transition: transform .16s !important;
      }
      .nav-subitems {
        display: none !important;
        flex-direction: column !important;
        gap: 2px !important;
        margin: 2px 0 6px 26px !important;
      }
      .nav-module.is-open .nav-subitems {
        display: flex !important;
      }
      .nav-subitem {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        min-height: 32px !important;
        padding: 7px 9px !important;
        border-radius: 7px !important;
        text-decoration: none !important;
        color: rgba(255, 255, 255, .68) !important;
        font-size: .8rem !important;
        font-weight: 500 !important;
      }
      .nav-subitem:hover {
        background: rgba(255, 255, 255, .07) !important;
        color: #fff !important;
      }
      .nav-subitem.active {
        background: var(--color-primary, #00E2A7) !important;
        color: #06211d !important;
        font-weight: 700 !important;
      }
      .nav-subitem.is-locked {
        color: rgba(255, 255, 255, .42) !important;
      }
      .nav-subitem.is-locked:hover {
        color: rgba(255, 255, 255, .72) !important;
      }
      .nav-subitem .nav-label {
        flex: 1 !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .nav-extra-badge {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-width: 18px !important;
        height: 18px !important;
        margin-left: auto !important;
        padding: 0 5px !important;
        border-radius: 999px !important;
        background: #fff !important;
        color: #0f5d52 !important;
        font-size: .68rem !important;
        font-weight: 700 !important;
        line-height: 1 !important;
      }
      .sidebar-footer {
        flex-shrink: 0 !important;
        padding: 12px 8px 14px !important;
        border-top: 1px solid rgba(255, 255, 255, .08) !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 8px !important;
      }
      .sidebar-user {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 6px 8px !important;
      }
      .user-avatar {
        width: 34px !important;
        height: 34px !important;
        border-radius: 50% !important;
        background: var(--color-primary, #00E2A7) !important;
        color: #06211d !important;
        font-weight: 700 !important;
        font-size: .85rem !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        flex-shrink: 0 !important;
      }
      .user-info {
        display: flex !important;
        flex-direction: column !important;
        gap: 1px !important;
        overflow: hidden !important;
      }
      .user-name {
        font-size: .8rem !important;
        font-weight: 600 !important;
        color: #fff !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
      .user-area {
        font-size: .72rem !important;
        color: rgba(255, 255, 255, .45) !important;
      }
      .btn-logout {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        width: 100% !important;
        padding: 8px 10px !important;
        border: none !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: rgba(255, 255, 255, .52) !important;
        font-size: .82rem !important;
        cursor: pointer !important;
        transition: background var(--transition-fast, 150ms ease), color var(--transition-fast, 150ms ease) !important;
      }
      .btn-logout:hover {
        background: rgba(220, 38, 38, .16) !important;
        color: #fff !important;
      }
      .sidebar--collapsed .sidebar-brand,
      .sidebar--collapsed .nav-label,
      .sidebar--collapsed .user-info,
      .sidebar--collapsed .btn-logout-text,
      .sidebar--collapsed .nav-section-title,
      .sidebar--collapsed .nav-module-label,
      .sidebar--collapsed .nav-module-chevron,
      .sidebar--collapsed .nav-module-lock,
      .sidebar--collapsed .nav-subitems {
        display: none !important;
      }
      .sidebar--collapsed .nav-module-btn,
      .sidebar--collapsed .nav-item,
      .sidebar--collapsed .sidebar-nav a {
        justify-content: flex-start !important;
        padding-inline: 6px !important;
        min-height: 44px !important;
      }
      .sidebar--collapsed .nav-module {
        gap: 4px !important;
      }
      .sidebar--collapsed .nav-module-btn {
        width: 100% !important;
        margin: 0 auto !important;
      }
      .sidebar--collapsed .nav-subitems {
        margin: 0 !important;
        gap: 4px !important;
        padding: 0 2px 4px !important;
      }
      .sidebar--collapsed .nav-subitem {
        width: 100% !important;
        margin: 0 auto !important;
        justify-content: flex-start !important;
        padding: 7px 6px !important;
        min-height: 36px !important;
        border-radius: 10px !important;
        display: grid !important;
        grid-template-columns: 18px minmax(0, 1fr) auto !important;
        gap: 6px !important;
        align-items: center !important;
      }
      .sidebar--collapsed .nav-subitem > span:first-child {
        width: 18px !important;
        text-align: center !important;
      }
      .sidebar--collapsed .nav-subitem .nav-label {
        max-width: 1px !important;
        opacity: 0 !important;
      }
      .sidebar--collapsed .nav-extra-badge {
        margin-left: 0 !important;
      }
      .sidebar--collapsed .nav-module-icon,
      .sidebar--collapsed .nav-item > span:first-child,
      .sidebar--collapsed .sidebar-nav a > span:first-child {
        width: 28px !important;
        height: 28px !important;
        border-radius: 999px !important;
        background: rgba(255, 255, 255, .10) !important;
        display: inline-grid !important;
        place-items: center !important;
        flex: 0 0 28px !important;
      }
      .sidebar--collapsed .nav-module-btn.is-open,
      .sidebar--collapsed .nav-item.active,
      .sidebar--collapsed .sidebar-nav a.active {
        background: rgba(0, 226, 167, .18) !important;
      }
      .sidebar--collapsed .sidebar-footer {
        align-items: center !important;
      }
      .sidebar--collapsed .sidebar-header {
        padding-inline: 8px !important;
        gap: 4px !important;
      }
      .sidebar--collapsed .sidebar-logo {
        width: 30px !important;
        height: 30px !important;
      }
      .sidebar--collapsed .sidebar-user {
        justify-content: center !important;
        padding-inline: 0 !important;
      }
      .sidebar--collapsed .btn-logout {
        justify-content: center !important;
        padding-inline: 0 !important;
      }
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
      .sidebar--collapsed .nav-module-btn { justify-content:center; padding-inline:6px; }
      .sidebar-drawer-overlay {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, .42);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        z-index: calc(var(--z-sticky, 200) - 1);
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--transition-normal, 250ms ease);
      }
      .sidebar-drawer-overlay.is-visible {
        opacity: 1;
        pointer-events: auto;
      }
      @media (max-width: 768px) {
        .sidebar {
          transform: translateX(-100%) !important;
          width: min(86vw, 280px) !important;
          max-width: 280px !important;
        }
        .sidebar.sidebar--collapsed {
          transform: translateX(-100%) !important;
          width: min(86vw, 280px) !important;
          max-width: 280px !important;
        }
        .sidebar.sidebar--collapsed .sidebar-brand,
        .sidebar.sidebar--collapsed .nav-label,
        .sidebar.sidebar--collapsed .user-info,
        .sidebar.sidebar--collapsed .btn-logout-text,
        .sidebar.sidebar--collapsed .nav-section-title,
        .sidebar.sidebar--collapsed .nav-module-label,
        .sidebar.sidebar--collapsed .nav-module-chevron,
        .sidebar.sidebar--collapsed .nav-module-lock {
          display: initial !important;
        }
        .sidebar.sidebar--collapsed .nav-subitems {
          display: none !important;
        }
        .sidebar.sidebar--collapsed .nav-module-btn,
        .sidebar.sidebar--collapsed .nav-item,
        .sidebar.sidebar--collapsed .sidebar-nav a {
          justify-content: flex-start !important;
          padding-inline: 10px !important;
        }
        .sidebar.sidebar--collapsed .nav-module-btn {
          width: 100% !important;
        }
        .sidebar.sidebar--collapsed .sidebar-header {
          gap: 8px !important;
          padding: 18px 12px 14px !important;
        }
        .sidebar.sidebar--collapsed .sidebar-user {
          justify-content: flex-start !important;
        }
        .sidebar.sidebar--collapsed .btn-logout {
          justify-content: flex-start !important;
        }
        .sidebar--collapsed ~ .main-wrapper,
        .sidebar--collapsed + .main-wrapper {
          margin-left: 0 !important;
        }
        .sidebar-toggle {
          display: grid !important;
          width: 36px !important;
          height: 36px !important;
          background: rgba(0, 226, 167, .16) !important;
          border-color: rgba(0, 226, 167, .35) !important;
        }
        .sidebar.sidebar--open,
        .sidebar.sidebar--mobile-open,
        .sidebar.mobile-open {
          transform: translateX(0) !important;
        }
        .main-wrapper,
        .main-wrapper--expanded {
          margin-left: 0 !important;
        }
      }
      @media (max-width: 560px) {
        .sidebar {
          width: min(90vw, 300px) !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  const SIDEBAR_OPEN_CLASSES = ['sidebar--open', 'sidebar--mobile-open', 'mobile-open'];

  function isMobileViewport() {
    return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
  }

  function getSidebarElement() {
    return document.getElementById('sidebar');
  }

  function isSidebarOpen(sidebar) {
    return SIDEBAR_OPEN_CLASSES.some(className => sidebar?.classList.contains(className));
  }

  function ensureSidebarOverlay() {
    let overlay = document.getElementById('sidebarDrawerOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'sidebarDrawerOverlay';
      overlay.className = 'sidebar-drawer-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.addEventListener('click', closeSidebarDrawer);
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function syncSidebarOverlay() {
    const sidebar = getSidebarElement();
    const overlay = ensureSidebarOverlay();
    const open = Boolean(sidebar && isMobileViewport() && isSidebarOpen(sidebar));

    overlay.classList.toggle('is-visible', open);
    overlay.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.classList.toggle('sidebar-drawer-open', open);
  }

  function syncSidebarViewportState() {
    const sidebar = getSidebarElement();
    if (!sidebar) return;

    if (!isMobileViewport()) {
      SIDEBAR_OPEN_CLASSES.forEach(className => sidebar.classList.remove(className));
      sidebar.classList.remove('sidebar--collapsed');
      document.querySelector('.main-wrapper')?.classList.remove('main-wrapper--expanded');
    }

    syncSidebarOverlay();
  }

  function closeSidebarDrawer() {
    const sidebar = getSidebarElement();
    if (!sidebar) return;
    SIDEBAR_OPEN_CLASSES.forEach(className => sidebar.classList.remove(className));
    syncSidebarViewportState();
  }

  function bindSidebarDrawerBehavior() {
    const sidebar = getSidebarElement();
    if (!sidebar || sidebar.dataset.drawerBound === '1') return;
    sidebar.dataset.drawerBound = '1';

    ensureSidebarOverlay();
    syncSidebarOverlay();

    const observer = new MutationObserver(() => {
      syncSidebarOverlay();
    });

    observer.observe(sidebar, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('resize', syncSidebarViewportState, { passive: true });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSidebarDrawer();
    });
    document.addEventListener('click', event => {
      if (!isMobileViewport()) return;
      if (event.target.closest('.sidebar .nav-subitem')) {
        closeSidebarDrawer();
      }
    });
  }

  function bindSidebarToggleBehavior() {
    if (document.body.dataset.sidebarToggleBound === '1') return;
    document.body.dataset.sidebarToggleBound = '1';

    document.addEventListener('click', event => {
      const toggle = event.target.closest('#sidebarToggle');
      if (!toggle) return;
      if (!isMobileViewport()) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      closeSidebarDrawer();
    }, true);
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
    bindSidebarDrawerBehavior();
    bindSidebarToggleBehavior();

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
        const sidebar = getSidebarElement();
        if (sidebar?.classList.contains('sidebar--collapsed')) {
          sidebar.classList.remove('sidebar--collapsed');
          document.querySelector('.main-wrapper')?.classList.remove('main-wrapper--expanded');
        }
        const open = !modulo.classList.contains('is-open');
        modulo.classList.toggle('is-open', open);
        btn.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        syncSidebarOverlay();
      });
    });
  }

  function crearWidgetMensajeriaGlobal(data) {
    if (!FEATURE_FLAGS.mensajeria) return;
    if (normalizarUrl(window.location.pathname) === '/src/modulo/varios/mensajeria/index.html') return;
    if (document.getElementById('texproChatWidget')) return;

    const user = extraerUsuario(data);
    if (!user) return;

    const styleId = 'texproChatWidgetStyles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .texpro-chat-widget {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 2600;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 10px;
        }
        .texpro-chat-launcher {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 0;
          border-radius: 999px;
          padding: 12px 14px;
          background: linear-gradient(135deg, #00e2a7, #13b8ff);
          color: #032e2c;
          font: inherit;
          font-weight: 800;
          box-shadow: 0 16px 32px rgba(0, 0, 0, .18);
          cursor: pointer;
        }
        .texpro-chat-launcher strong {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 22px;
          height: 22px;
          padding: 0 6px;
          border-radius: 999px;
          background: rgba(255, 255, 255, .92);
          color: #0e5d57;
          font-size: .72rem;
          font-weight: 800;
        }
        .texpro-chat-panel {
          width: min(420px, calc(100vw - 24px));
          height: min(560px, calc(100vh - 90px));
          background: #fff;
          border-radius: 24px;
          box-shadow: 0 28px 70px rgba(10, 24, 38, .28);
          overflow: hidden;
          display: none;
          flex-direction: column;
          border: 1px solid rgba(19, 35, 61, .10);
        }
        .texpro-chat-widget.is-open .texpro-chat-panel { display: flex; }
        .texpro-chat-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 16px;
          background: linear-gradient(180deg, rgba(0, 226, 167, .10), rgba(0, 226, 167, 0));
          border-bottom: 1px solid rgba(19, 35, 61, .08);
        }
        .texpro-chat-head h3 { margin: 0; font-family: var(--font-display, 'Montserrat', sans-serif); font-size: 1rem; }
        .texpro-chat-head p { margin: 4px 0 0; font-size: .8rem; color: var(--color-text-muted, #5d6675); }
        .texpro-chat-head-actions { display:flex; gap:8px; align-items:center; }
        .texpro-chat-head-actions button {
          border:0; border-radius:12px; padding:8px 10px; background:rgba(0,0,0,.05); cursor:pointer; font:inherit;
        }
        .texpro-chat-tabs {
          display: inline-flex;
          gap: 6px;
          padding: 10px 12px 0;
        }
        .texpro-chat-tab {
          border: 0;
          background: rgba(0, 0, 0, .04);
          color: var(--color-text-muted, #5d6675);
          border-radius: 999px;
          padding: 8px 12px;
          font: inherit;
          font-size: .8rem;
          font-weight: 700;
          cursor: pointer;
        }
        .texpro-chat-tab.is-active { background: rgba(0, 226, 167, .14); color: var(--color-primary, #01696f); }
        .texpro-chat-search {
          display:flex; align-items:center; gap:8px;
          margin:10px 12px 0; padding:10px 12px; border-radius:14px; border:1px solid rgba(19,35,61,.08);
          background:#f8fbff;
        }
        .texpro-chat-search input { width:100%; border:0; outline:0; background:transparent; font:inherit; }
        .texpro-chat-body { min-height:0; flex:1; display:grid; grid-template-columns: 170px minmax(0, 1fr); }
        .texpro-chat-list { min-height:0; overflow:auto; border-right:1px solid rgba(19,35,61,.08); background:rgba(248,251,255,.88); padding:8px; }
        .texpro-chat-list-item {
          width:100%; display:grid; grid-template-columns:auto 1fr; gap:10px; align-items:center;
          padding:10px 10px; border:0; border-radius:14px; background:transparent; text-align:left; cursor:pointer;
        }
        .texpro-chat-list-item:hover, .texpro-chat-list-item.is-active { background:#fff; box-shadow:0 8px 18px rgba(20,35,58,.06); }
        .texpro-chat-avatar {
          width:34px; height:34px; border-radius:50%; display:grid; place-items:center; font-size:.76rem; font-weight:800;
          color:#04312a; background:linear-gradient(135deg, rgba(8,211,168,.22), rgba(31,122,255,.10));
        }
        .texpro-chat-list-name { display:block; font-size:.84rem; font-weight:800; line-height:1.2; }
        .texpro-chat-list-sub { display:block; margin-top:2px; font-size:.72rem; color:var(--color-text-muted, #5d6675); }
        .texpro-chat-list-status {
          display:inline-flex; align-items:center; gap:6px; margin-top:4px; font-size:.7rem; font-weight:700; color:var(--color-text-muted, #5d6675);
        }
        .texpro-chat-thread { min-height:0; display:grid; grid-template-rows:auto minmax(0, 1fr) auto; background:linear-gradient(180deg, rgba(255,255,255,.92), rgba(244,247,251,.98)); }
        .texpro-chat-thread-empty { min-height:100%; display:grid; place-items:center; text-align:center; padding:24px; color:var(--color-text-muted, #5d6675); }
        .texpro-chat-thread-head {
          padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px;
          border-bottom:1px solid rgba(19,35,61,.08);
        }
        .texpro-chat-thread-head h4 { margin:0; font-size:.92rem; }
        .texpro-chat-thread-head p { margin:2px 0 0; font-size:.76rem; color:var(--color-text-muted, #5d6675); }
        .texpro-chat-thread-status {
          display:inline-flex; align-items:center; gap:6px; margin-top:5px; font-size:.72rem; font-weight:700; color:var(--color-text-muted, #5d6675);
        }
        .texpro-chat-thread-actions { display:flex; gap:6px; }
        .texpro-chat-thread-actions button {
          border:0; border-radius:10px; padding:7px 9px; background:rgba(0,0,0,.05); cursor:pointer; font:inherit; font-size:.78rem;
        }
        .texpro-chat-messages { min-height:0; overflow:auto; padding:12px; display:grid; gap:10px; }
        .texpro-chat-message {
          max-width:86%; padding:10px 11px; border-radius:16px; background:#fff; border:1px solid rgba(19,35,61,.08);
          box-shadow:0 10px 20px rgba(20,35,58,.05);
        }
        .texpro-chat-message.is-self { margin-left:auto; background:linear-gradient(180deg, rgba(0,226,167,.14), rgba(0,226,167,.08)); border-color:rgba(0,226,167,.18); }
        .texpro-chat-message strong { display:block; margin-bottom:4px; font-size:.78rem; }
        .texpro-chat-message p { margin:0; white-space:pre-wrap; line-height:1.38; font-size:.84rem; }
        .texpro-chat-message small { display:block; margin-top:4px; font-size:.7rem; color:var(--color-text-muted, #5d6675); }
        .texpro-chat-composer { padding:12px; border-top:1px solid rgba(19,35,61,.08); background:rgba(255,255,255,.96); }
        .texpro-chat-composer textarea {
          width:100%; min-height:72px; resize:vertical; padding:10px 11px; border-radius:14px; border:1px solid rgba(19,35,61,.10);
          outline:0; font:inherit; background:#fff;
        }
        .texpro-chat-composer-actions {
          display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px;
        }
        .texpro-chat-hint { font-size:.76rem; color:var(--color-text-muted, #5d6675); }
        .texpro-chat-composer-actions button {
          border:0; border-radius:12px; padding:9px 12px; background:linear-gradient(135deg, #00e2a7, #13b8ff); color:#032e2c;
          font:inherit; font-weight:800; cursor:pointer;
        }
        .texpro-chat-empty { padding:18px 12px; text-align:center; color:var(--color-text-muted, #5d6675); }
        .presence-dot {
          width:9px; height:9px; border-radius:999px; display:inline-block; flex:0 0 auto;
        }
        .presence-dot.is-online { background:#10b981; }
        .presence-dot.is-offline { background:#9ca3af; }
        @media (max-width: 640px) {
          .texpro-chat-widget { right:10px; bottom:10px; left:10px; align-items:stretch; }
          .texpro-chat-panel { width:100%; height:min(70vh, 620px); }
          .texpro-chat-body { grid-template-columns:1fr; }
          .texpro-chat-list { max-height:160px; border-right:0; border-bottom:1px solid rgba(19,35,61,.08); }
        }
      `;
      document.head.appendChild(style);
    }

    const wrap = document.createElement('div');
    wrap.id = 'texproChatWidget';
    wrap.className = 'texpro-chat-widget';
    wrap.innerHTML = `
      <button type="button" class="texpro-chat-launcher" data-chat-toggle aria-expanded="false">
        <span aria-hidden="true">💬</span>
        <span>Chat</span>
        <strong data-chat-badge style="display:none">0</strong>
      </button>
      <section class="texpro-chat-panel" data-chat-panel aria-hidden="true">
        <div class="texpro-chat-head">
          <div>
            <h3>Chat interno</h3>
            <p>Mensajes rápidos con tu equipo</p>
          </div>
          <div class="texpro-chat-head-actions">
            <button type="button" data-chat-open-full title="Abrir vista completa">↗</button>
            <button type="button" data-chat-close aria-label="Cerrar">×</button>
          </div>
        </div>
        <div class="texpro-chat-tabs" role="tablist" aria-label="Chat interno">
          <button type="button" class="texpro-chat-tab is-active" data-panel="usuarios" aria-selected="true">Usuarios</button>
          <button type="button" class="texpro-chat-tab" data-panel="chats" aria-selected="false">Chats</button>
        </div>
        <label class="texpro-chat-search">
          <span>⌕</span>
          <input type="search" data-chat-search placeholder="Buscar persona o chat" />
        </label>
        <div class="texpro-chat-body">
          <aside class="texpro-chat-list" data-chat-list>
            <div class="texpro-chat-empty">Cargando...</div>
          </aside>
          <section class="texpro-chat-thread" data-chat-thread>
            <div class="texpro-chat-thread-empty">
              <div>
                <h4>Selecciona un usuario</h4>
                <p>Elige una persona de la lista para abrir o retomar un chat.</p>
              </div>
            </div>
          </section>
        </div>
      </section>
    `;
    document.body.appendChild(wrap);

    const chatState = {
      user,
      conversaciones: [],
      directorio: { usuarios: [], areas: [] },
      onlineUsers: new Set(),
      conversacionActivaId: null,
      mensajesActivos: [],
      panelActivo: 'usuarios',
      search: '',
      opened: false,
      loading: false,
    };

    const refs = {
      wrap,
      toggle: wrap.querySelector('[data-chat-toggle]'),
      badge: wrap.querySelector('[data-chat-badge]'),
      panel: wrap.querySelector('[data-chat-panel]'),
      close: wrap.querySelector('[data-chat-close]'),
      full: wrap.querySelector('[data-chat-open-full]'),
      tabs: wrap.querySelectorAll('.texpro-chat-tab'),
      search: wrap.querySelector('[data-chat-search]'),
      list: wrap.querySelector('[data-chat-list]'),
      thread: wrap.querySelector('[data-chat-thread]'),
    };

    function chatApi(path, options = {}) {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      };
      const token = localStorage.getItem('token');
      if (token) headers.Authorization = `Bearer ${token}`;

      return fetch(`/api/mensajeria${path}`, {
        ...options,
        headers,
      }).then(async res => {
        const payload = await res.json().catch(() => null);
        if (!res.ok || payload?.ok === false) {
          throw new Error(payload?.error || `Error HTTP ${res.status}`);
        }
        return payload;
      });
    }

    function chatInitials(name) {
      return String(name || '?')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('') || '?';
    }

    function chatFormatDateTime(value) {
      if (!value) return '';
      try {
        return new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
      } catch {
        return String(value);
      }
    }

    function chatEscape(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function chatNormalize(value) {
      return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    function setBadge(total) {
      if (total > 0) {
        refs.badge.textContent = total > 99 ? '99+' : String(total);
        refs.badge.style.display = 'inline-flex';
      } else {
        refs.badge.style.display = 'none';
      }
    }

    function conversationTitle(conversation) {
      if (conversation?.titulo) return conversation.titulo;
      const other = (conversation?.participantes || []).find(part => Number(part.usuario_id) !== Number(chatState.user?.id));
      return other?.usuario?.nombre || 'Conversación directa';
    }

    function conversationSubtitle(conversation) {
      const participantes = (conversation?.participantes || []).map(part => part.usuario?.nombre).filter(Boolean);
      return participantes.filter(name => name !== chatState.user?.nombre).join(' · ') || 'Mensaje directo';
    }

    function conversationSnippet(conversation) {
      if (!conversation?.ultimo_mensaje) return 'Sin mensajes todavía';
      const prefix = Number(conversation.ultimo_mensaje.remitente_id) === Number(chatState.user?.id) ? 'Tú: ' : '';
      return `${prefix}${conversation.ultimo_mensaje.cuerpo}`;
    }

    function normalizeUserId(value) {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function isUserOnline(userId) {
      const normalized = normalizeUserId(userId);
      return normalized ? chatState.onlineUsers.has(normalized) : false;
    }

    function setOnlineUsers(ids = []) {
      chatState.onlineUsers = new Set((Array.isArray(ids) ? ids : []).map(normalizeUserId).filter(Boolean));
    }

    function conversationPresenceInfo(conversation) {
      if (!conversation) return { online: false, label: 'Desconectado' };
      const peer = (conversation.participantes || []).find(part => Number(part.usuario_id) !== Number(chatState.user?.id));
      const online = peer ? isUserOnline(peer.usuario_id) : false;
      return { online, label: online ? 'En línea' : 'Desconectado' };
    }

    function directConversationForUser(userId) {
      return chatState.conversaciones.find(conversation => {
        if (conversation.tipo !== 'directa') return false;
        const participants = conversation.participantes || [];
        const hasSelf = participants.some(part => Number(part.usuario_id) === Number(chatState.user?.id));
        const hasTarget = participants.some(part => Number(part.usuario_id) === Number(userId));
        return hasSelf && hasTarget;
      }) || null;
    }

    function openWidget(open = true) {
      chatState.opened = open;
      wrap.classList.toggle('is-open', open);
      refs.panel.hidden = !open;
      refs.toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      refs.panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) loadData();
    }

    function renderTabs() {
      refs.tabs.forEach(button => {
        const active = button.dataset.panel === chatState.panelActivo;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function renderList() {
      const term = chatNormalize(chatState.search);

      if (chatState.panelActivo === 'usuarios') {
        const usuarios = chatState.directorio.usuarios.filter(usuario => {
          if (!term) return true;
          return [usuario.nombre, usuario.email, usuario.area].map(chatNormalize).join(' ').includes(term);
        });

        refs.list.innerHTML = usuarios.length ? usuarios.map(usuario => {
          const active = Number(directConversationForUser(usuario.id)?.id) === Number(chatState.conversacionActivaId);
          const online = isUserOnline(usuario.id);
          return `
            <button type="button" class="texpro-chat-list-item ${active ? 'is-active' : ''}" data-user-id="${usuario.id}">
              <div class="texpro-chat-avatar">${chatInitials(usuario.nombre)}</div>
              <div>
                <span class="texpro-chat-list-name">${chatEscape(usuario.nombre)}</span>
                <span class="texpro-chat-list-sub">${chatEscape(usuario.area || 'Sin área')}</span>
                <span class="texpro-chat-list-status">
                  <span class="presence-dot ${online ? 'is-online' : 'is-offline'}" aria-hidden="true"></span>
                  <span>${online ? 'En línea' : 'Desconectado'}</span>
                </span>
              </div>
            </button>
          `;
        }).join('') : '<div class="texpro-chat-empty">No hay usuarios para mostrar.</div>';

        refs.list.querySelectorAll('[data-user-id]').forEach(button => {
          button.addEventListener('click', () => {
            const usuario = chatState.directorio.usuarios.find(item => Number(item.id) === Number(button.dataset.userId));
            if (usuario) openOrCreateDirectChat(usuario);
          });
        });
        return;
      }

      const conversaciones = chatState.conversaciones.filter(conversation => {
        if (!term) return true;
        return [conversationTitle(conversation), conversationSubtitle(conversation), conversationSnippet(conversation)]
          .map(chatNormalize)
          .join(' ')
          .includes(term);
      });

      refs.list.innerHTML = conversaciones.length ? conversaciones.map(conversation => {
        const active = Number(conversation.id) === Number(chatState.conversacionActivaId);
        const presence = conversationPresenceInfo(conversation);
        return `
          <button type="button" class="texpro-chat-list-item ${active ? 'is-active' : ''}" data-conversation-id="${conversation.id}">
            <div class="texpro-chat-avatar">${chatInitials(conversationTitle(conversation))}</div>
            <div>
              <span class="texpro-chat-list-name">${chatEscape(conversationTitle(conversation))}</span>
              <span class="texpro-chat-list-sub">${chatEscape(conversationSubtitle(conversation))}</span>
              <span class="texpro-chat-list-status">
                <span class="presence-dot ${presence.online ? 'is-online' : 'is-offline'}" aria-hidden="true"></span>
                <span>${chatEscape(presence.label)}</span>
              </span>
            </div>
          </button>
        `;
      }).join('') : '<div class="texpro-chat-empty">No hay chats para mostrar.</div>';

      refs.list.querySelectorAll('[data-conversation-id]').forEach(button => {
        button.addEventListener('click', () => openConversation(button.dataset.conversationId));
      });
    }

    function renderThread() {
      if (!chatState.conversacionActivaId) {
        refs.thread.innerHTML = `
          <div class="texpro-chat-thread-empty">
            <div>
              <h4>No hay chat abierto</h4>
              <p>Selecciona un usuario o un chat reciente.</p>
            </div>
          </div>
        `;
        return;
      }

      const conversation = chatState.conversaciones.find(item => Number(item.id) === Number(chatState.conversacionActivaId));
      if (!conversation) return;

      const archivada = Boolean(conversation.archivada);
      const silenciada = Boolean(conversation.silenciada);
      const presence = conversationPresenceInfo(conversation);

      refs.thread.innerHTML = `
        <div class="texpro-chat-thread-head">
          <div>
            <h4>${chatEscape(conversationTitle(conversation))}</h4>
            <p>${chatEscape(conversationSubtitle(conversation))}</p>
            <span class="texpro-chat-thread-status">
              <span class="presence-dot ${presence.online ? 'is-online' : 'is-offline'}" aria-hidden="true"></span>
              <span>${chatEscape(presence.label)}</span>
            </span>
          </div>
          <div class="texpro-chat-thread-actions">
            <button type="button" data-chat-flag="silenciar">${silenciada ? 'Activar' : 'Silenciar'}</button>
            <button type="button" data-chat-flag="archivar">${archivada ? 'Desarchivar' : 'Archivar'}</button>
          </div>
        </div>
        <div class="texpro-chat-messages">
          ${chatState.mensajesActivos.length ? chatState.mensajesActivos.map(message => {
            const self = Number(message.remitente_id) === Number(chatState.user?.id);
            return `
              <article class="texpro-chat-message ${self ? 'is-self' : ''}">
                <strong>${self ? 'Tú' : chatEscape(message.remitente_nombre || 'Usuario')}</strong>
                <p>${chatEscape(message.cuerpo)}</p>
                <small>${chatEscape(chatFormatDateTime(message.created_at))}</small>
              </article>
            `;
          }).join('') : '<div class="texpro-chat-empty">Aún no hay mensajes.</div>'}
        </div>
        <form class="texpro-chat-composer" data-chat-composer>
          <textarea data-chat-input rows="3" placeholder="Escribe un mensaje..."></textarea>
          <div class="texpro-chat-composer-actions">
            <span class="texpro-chat-hint">${archivada ? 'El chat está archivado, pero puedes responder.' : 'Listo para responder.'}</span>
            <button type="submit">Enviar</button>
          </div>
        </form>
      `;

      refs.thread.querySelector('[data-chat-composer]')?.addEventListener('submit', async event => {
        event.preventDefault();
        const input = refs.thread.querySelector('[data-chat-input]');
        const body = String(input?.value || '').trim();
        if (!body) return;
        try {
          await chatApi(`/conversaciones/${chatState.conversacionActivaId}/mensajes`, {
            method: 'POST',
            body: JSON.stringify({ cuerpo: body }),
          });
          if (input) input.value = '';
          await loadConversationMessages(chatState.conversacionActivaId);
          await loadConversations();
        } catch (error) {
          alert(error.message);
        }
      });

      refs.thread.querySelector('[data-chat-flag="silenciar"]')?.addEventListener('click', async () => {
        try {
          await chatApi(`/conversaciones/${chatState.conversacionActivaId}/silenciar`, {
            method: 'PATCH',
            body: JSON.stringify({ silenciada: !silenciada }),
          });
          await loadConversationMessages(chatState.conversacionActivaId);
          await loadConversations();
        } catch (error) {
          alert(error.message);
        }
      });

      refs.thread.querySelector('[data-chat-flag="archivar"]')?.addEventListener('click', async () => {
        try {
          await chatApi(`/conversaciones/${chatState.conversacionActivaId}/archivar`, {
            method: 'PATCH',
            body: JSON.stringify({ archivada: !archivada }),
          });
          await loadConversationMessages(chatState.conversacionActivaId);
          await loadConversations();
        } catch (error) {
          alert(error.message);
        }
      });
    }

    async function loadUnread() {
      try {
        const data = await chatApi('/no-leidos');
        setBadge(Number(data?.data?.total || 0));
      } catch {
        setBadge(0);
      }
    }

    async function loadPresence() {
      try {
        const data = await chatApi('/usuarios-online');
        setOnlineUsers(data?.online || data?.data?.online || []);
        renderList();
        renderThread();
      } catch {
        setOnlineUsers([]);
        renderList();
        renderThread();
      }
    }

    async function loadDirectory() {
      const data = await chatApi('/directorio');
      chatState.directorio = data?.data || { usuarios: [], areas: [] };
    }

    async function loadConversations() {
      const data = await chatApi('/conversaciones');
      chatState.conversaciones = Array.isArray(data?.data) ? data.data : [];
      renderList();
      renderThread();
    }

    async function handleRealtimeChatEvent(payload = {}) {
      const conversationId = Number(payload.conversacion_id || payload?.mensaje?.conversacion_id || payload?.conversacion?.id || 0);
      if (!conversationId) {
        await loadConversations();
        await loadUnread();
        return;
      }

      await loadConversations();
      if (Number(chatState.conversacionActivaId) === conversationId) {
        await loadConversationMessages(conversationId);
      }
      await loadUnread();
    }

    async function handleRealtimePresenceUpdate(payload = {}) {
      const userId = normalizeUserId(payload?.usuario_id);
      if (!userId) return;
      if (payload.online) {
        chatState.onlineUsers.add(userId);
      } else {
        chatState.onlineUsers.delete(userId);
      }
      renderList();
      renderThread();
    }

    async function loadConversationMessages(conversationId) {
      if (!conversationId) return;
      const data = await chatApi(`/conversaciones/${conversationId}/mensajes`);
      chatState.conversacionActivaId = Number(conversationId);
      chatState.mensajesActivos = Array.isArray(data?.data?.mensajes) ? data.data.mensajes : [];
      renderList();
      renderThread();
      await chatApi(`/conversaciones/${conversationId}/leido`, { method: 'PATCH' }).catch(() => {});
      await loadUnread();
    }

    async function openConversation(conversationId) {
      openWidget(true);
      chatState.panelActivo = 'chats';
      renderTabs();
      await loadConversationMessages(conversationId);
    }

    async function openOrCreateDirectChat(usuario) {
      try {
        const response = await chatApi('/conversaciones', {
          method: 'POST',
          body: JSON.stringify({ tipo: 'directa', usuario_id: usuario.id }),
        });
        const conversationId = response?.data?.id;
        if (!conversationId) throw new Error('No se pudo abrir el chat.');
        openWidget(true);
        chatState.panelActivo = 'chats';
        renderTabs();
        await loadConversations();
        await loadConversationMessages(conversationId);
      } catch (error) {
        alert(error.message);
      }
    }

    async function loadData() {
      if (chatState.loading) return;
      chatState.loading = true;
      try {
        await loadDirectory();
        await loadConversations();
        await loadPresence();
        await loadUnread();
        renderTabs();
      } catch (error) {
        refs.list.innerHTML = `<div class="texpro-chat-empty">${chatEscape(error.message || 'No se pudo cargar el chat')}</div>`;
      } finally {
        chatState.loading = false;
      }
    }

    window.GICOTEXMensajeriaWidgetRealtime = {
      refreshConversations: () => loadConversations(),
      refreshUnreadBadge: () => loadUnread(),
      refreshPresence: () => loadPresence(),
      handleRealtimeChatEvent,
      handleRealtimePresenceEvent: handleRealtimePresenceUpdate,
      getActiveConversationId: () => chatState.conversacionActivaId,
    };

    refs.toggle.addEventListener('click', () => openWidget(!chatState.opened));
    refs.close.addEventListener('click', () => openWidget(false));
    refs.full.addEventListener('click', () => {
      window.location.href = '/src/modulo/varios/mensajeria/index.html';
    });
    refs.search.addEventListener('input', event => {
      chatState.search = event.target.value || '';
      renderList();
    });
    refs.tabs.forEach(button => {
      button.addEventListener('click', () => {
        chatState.panelActivo = button.dataset.panel;
        renderTabs();
        renderList();
      });
    });

    openWidget(false);
    loadData();
    setInterval(loadUnread, 60000);
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
      nav.innerHTML = '<div class="nav-loading">Cargando menús...</div>';
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
    crearWidgetMensajeriaGlobal(data);
    ensureRealtimeClientLoaded();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

