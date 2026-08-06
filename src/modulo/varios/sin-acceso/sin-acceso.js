'use strict';

(function () {
  const LOGIN_PATH = '/src/modulo/varios/login/index.html';
  const loginRouter = window.TEXPRO_LOGIN_ROUTER || {};
  const NO_AUTH = {
    nombre: 'No autenticado',
    area: 'No disponible',
  };

  function appUrl(path) {
    const limpio = String(path || '').trim();
    if (!limpio) return '';
    if (/^https?:\/\//i.test(limpio)) return limpio;

    const idx = window.location.pathname.indexOf('/src/');
    const base = idx > 0 ? window.location.pathname.slice(0, idx) : '';
    if (limpio.startsWith('/')) return `${base}${limpio}`;
    return `${base}/${limpio}`;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '—';
  }

  function parseJSONSafe(raw) {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function decodificarJwt(token) {
    try {
      if (!token || !token.includes('.')) return null;
      const payload = token.split('.')[1]
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const json = decodeURIComponent(
        atob(payload)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function normalizarTexto(valor) {
    return String(valor || '')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function normalizarUrl(url) {
    let valor = String(url || '').trim();
    if (!valor) return '';
    if (!valor.startsWith('/')) valor = `/${valor}`;
    valor = valor.replace(/\/+$/, '');
    valor = valor.replace(/\/index\.html$/, '/index.html');
    return valor;
  }

  function normalizarUsuario(raw) {
    if (!raw) return null;
    const user = raw.user || raw.usuario || raw;
    if (!user) return null;

    const menus = Array.isArray(user.menus) ? user.menus : [];

    return {
      id: user.id ?? user.usuario_id ?? user.sub ?? '',
      nombre: user.nombre || user.name || user.usuario || user.email || 'Usuario',
      email: user.email || user.correo || '',
      usuario: user.usuario || user.username || '',
      area: user.area || user.Area || user.departamento || user.depto || '',
      is_admin: Boolean(user.is_admin || user.admin || user.es_admin),
      menus,
    };
  }

  function ordenarMenus(menus) {
    return (menus || [])
      .filter(menu => menu && (menu.url || menu.nombre))
      .map(menu => ({
        id: menu.id ?? null,
        codigo: normalizarTexto(menu.codigo),
        grupo: normalizarTexto(menu.grupo),
        nombre: String(menu.nombre || '').trim(),
        url: normalizarUrl(menu.url),
        orden: Number(menu.orden ?? 0) || 0,
      }))
      .sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'));
  }

  function menuPorRuta(catalogo, pathname) {
    const ruta = normalizarUrl(pathname);
    return catalogo.find(menu => menu.url === ruta) || null;
  }

  function resolverModuloSolicitado(params, catalogo) {
    const modulo = String(params.get('modulo') || '').trim();
    if (modulo) return modulo;

    const from = String(params.get('from') || '').trim();
    if (!from) return 'Módulo no identificado';

    const menu = menuPorRuta(catalogo, from);
    if (menu?.nombre) return menu.nombre;

    return from || 'Módulo no identificado';
  }

  function resolverRutaPrincipalUsuarioLocal(usuario) {
    const menus = ordenarMenus(usuario?.menus);
    if (!menus.length) return null;

    const area = normalizarTexto(usuario?.area);
    const rutas = {
      ventas: ['/src/modulo/ventas/dashboard/index.html', 'ventas_dashboard'],
      venta: ['/src/modulo/ventas/dashboard/index.html', 'ventas_dashboard'],
      vendedores: ['/src/modulo/ventas/dashboard/index.html', 'ventas_dashboard'],
      comercial: ['/src/modulo/ventas/dashboard/index.html', 'ventas_dashboard'],
      gerencia: ['/src/modulo/gerencia/dashboard-comercial/index.html', 'gerencia'],
      gerencia_estadisticas_ventas: ['/src/modulo/gerencia/comercial/estadisticas-ventas/index.html', 'gerencia_estadisticas_ventas'],
      gerencia_dashboard_finanzas: ['/src/modulo/gerencia/comercial/dashboard-finanzas/index.html', 'gerencia_dashboard_finanzas'],
      produccion: ['/src/modulo/produccion/produccion/index.html', 'produccion'],
      bodega: ['/src/modulo/bodega/bodega/index.html', 'bodega'],
      facturacion: ['/src/modulo/facturacion/facturacion/index.html', 'facturacion'],
      rrhh: ['/src/modulo/rrhh/rrhh/index.html', 'rrhh'],
      'recursos-humanos': ['/src/modulo/rrhh/rrhh/index.html', 'rrhh'],
      contabilidad: ['/src/modulo/contabilidad/contabilidad/index.html', 'contabilidad'],
      cobranza: ['/src/modulo/contabilidad/contabilidad/index.html', 'cobranza'],
      'servicio-tecnico': ['/src/modulo/servtecnico/servicio-tecnico/index.html', 'servicio_tecnico'],
      servicio: ['/src/modulo/servtecnico/servicio-tecnico/index.html', 'servicio_tecnico'],
      'serv-tecnico': ['/src/modulo/servtecnico/servicio-tecnico/index.html', 'servicio_tecnico'],
      'servicio tecnico': ['/src/modulo/servtecnico/servicio-tecnico/index.html', 'servicio_tecnico'],
      administracion: ['/src/modulo/gerencia/dashboard-comercial/index.html', 'gerencia'],
      admin: ['/src/modulo/gerencia/dashboard-comercial/index.html', 'gerencia'],
    };

    const rutaConfig = rutas[area];
    if (rutaConfig) {
      const [rutaEsperada, codigoEsperado] = rutaConfig;
      const menuPreferido = menus.find(menu => menu.url === rutaEsperada && (!codigoEsperado || menu.codigo === codigoEsperado));
      if (menuPreferido) return menuPreferido.url;
    }

    const menusUtiles = menus
      .filter(menu => menu.codigo !== 'alertas' && menu.codigo !== 'mensajeria' && menu.grupo !== 'general')
      .sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'));

    if (menusUtiles.length) return menusUtiles[0].url;

    return null;
  }

  const resolverRutaPrincipalUsuario = typeof loginRouter.resolverRutaPrincipalUsuario === 'function'
    ? loginRouter.resolverRutaPrincipalUsuario
    : resolverRutaPrincipalUsuarioLocal;

  function resolverDatosUsuario(usuario, autenticado) {
    if (!autenticado) {
      return {
        nombre: NO_AUTH.nombre,
        area: NO_AUTH.area,
        principal: null,
        href: appUrl(LOGIN_PATH),
      };
    }

    const nombre = usuario?.nombre || usuario?.email || usuario?.usuario || 'Usuario';
    const area = usuario?.area || 'Sin área asignada';
    const principalUrl = resolverRutaPrincipalUsuario(usuario);
    const principal = principalUrl
      ? ordenarMenus(usuario?.menus).find(menu => menu.url === normalizarUrl(principalUrl)) || null
      : null;

    return {
      nombre,
      area,
      principal,
      href: principal ? appUrl(principal.url) : null,
    };
  }

  function pintarVista({ usuario, catalogo, autenticado }) {
    const params = new URLSearchParams(window.location.search);
    const moduloSolicitado = resolverModuloSolicitado(params, catalogo);
    const datos = resolverDatosUsuario(usuario, autenticado);

    setText('usuarioNombre', datos.nombre);
    setText('usuarioArea', datos.area);
    setText('moduloSolicitado', moduloSolicitado);
    setText('moduloPrincipal', datos.principal?.nombre || 'Sin módulo principal asignado');

    const btnVolver = document.getElementById('btnVolverModulo');
    if (btnVolver) {
      if (datos.href) {
        btnVolver.href = datos.href;
        btnVolver.removeAttribute('aria-disabled');
        btnVolver.style.pointerEvents = '';
        btnVolver.style.opacity = '';
        btnVolver.style.cursor = '';
      } else {
        btnVolver.removeAttribute('href');
        btnVolver.setAttribute('aria-disabled', 'true');
        btnVolver.style.pointerEvents = 'none';
        btnVolver.style.opacity = '.65';
        btnVolver.style.cursor = 'not-allowed';
      }
    }
  }

  async function obtenerContexto() {
    const token = localStorage.getItem('token');
    if (!token) {
      pintarVista({ usuario: null, catalogo: [], autenticado: false });
      return;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.user) {
        throw new Error(data?.error || 'Sesión no disponible');
      }

      const usuario = normalizarUsuario(data.user);
      const catalogo = ordenarMenus(
        data.allMenus
          || data.menusDisponibles
          || data.user?.allMenus
          || data.user?.menusDisponibles
          || []
      );

      if (usuario) {
        const payload = JSON.stringify(usuario);
        sessionStorage.setItem('texpro_user', payload);
        localStorage.setItem('user', payload);
        localStorage.setItem('usuario', payload);
      }

      pintarVista({
        usuario,
        catalogo,
        autenticado: true,
      });
    } catch {
      pintarVista({
        usuario: null,
        catalogo: [],
        autenticado: false,
      });
    }
  }

  function iniciar() {
    const cached = getUsuarioGuardado();
    const token = localStorage.getItem('token');

    if (cached && token) {
      pintarVista({
        usuario: cached,
        catalogo: ordenarMenus(cached.menus),
        autenticado: true,
      });
    } else {
      pintarVista({
        usuario: null,
        catalogo: [],
        autenticado: Boolean(token),
      });
    }

    obtenerContexto();
  }

  function getUsuarioGuardado() {
    return normalizarUsuario(parseJSONSafe(sessionStorage.getItem('texpro_user')))
      || normalizarUsuario(parseJSONSafe(localStorage.getItem('user')))
      || normalizarUsuario(parseJSONSafe(localStorage.getItem('usuario')))
      || normalizarUsuario(decodificarJwt(localStorage.getItem('token')));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }
})();
