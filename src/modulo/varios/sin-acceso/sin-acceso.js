'use strict';

(function () {
  const LOGIN_PATH = '/src/modulo/varios/login/index.html';
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

  function getUsuarioGuardado() {
    return normalizarUsuario(parseJSONSafe(sessionStorage.getItem('texpro_user')))
      || normalizarUsuario(parseJSONSafe(localStorage.getItem('user')))
      || normalizarUsuario(parseJSONSafe(localStorage.getItem('usuario')))
      || normalizarUsuario(decodificarJwt(localStorage.getItem('token')));
  }

  function ordenarMenus(menus) {
    return (menus || [])
      .filter(menu => menu && (menu.url || menu.nombre))
      .map(menu => ({
        id: menu.id ?? null,
        codigo: normalizarTexto(menu.codigo),
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

  function obtenerPrimerMenuPermitido(usuario) {
    const menus = ordenarMenus(usuario?.menus);
    return menus[0] || null;
  }

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
    const principal = obtenerPrimerMenuPermitido(usuario) || null;

    return {
      nombre,
      area,
      principal,
      href: principal ? appUrl(principal.url) : appUrl(LOGIN_PATH),
    };
  }

  function pintarVista({ usuario, catalogo, autenticado }) {
    const params = new URLSearchParams(window.location.search);
    const moduloSolicitado = resolverModuloSolicitado(params, catalogo);
    const datos = resolverDatosUsuario(usuario, autenticado);

    setText('usuarioNombre', datos.nombre);
    setText('usuarioArea', datos.area);
    setText('moduloSolicitado', moduloSolicitado);
    setText('moduloPrincipal', datos.principal?.nombre || 'Sin módulo asignado');

    const btnVolver = document.getElementById('btnVolverModulo');
    if (btnVolver) btnVolver.href = datos.href;
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar, { once: true });
  } else {
    iniciar();
  }
})();
