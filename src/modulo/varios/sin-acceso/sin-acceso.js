'use strict';

(function () {
  const MODULOS_PRINCIPALES = {
    ventas: { nombre: 'Ventas', url: '/src/modulo/ventas/dashboard/index.html' },
    venta: { nombre: 'Ventas', url: '/src/modulo/ventas/dashboard/index.html' },
    vendedores: { nombre: 'Ventas', url: '/src/modulo/ventas/dashboard/index.html' },
    comercial: { nombre: 'Ventas', url: '/src/modulo/ventas/dashboard/index.html' },
    produccion: { nombre: 'Producción', url: '/src/modulo/produccion/produccion/index.html' },
    bodega: { nombre: 'Bodega', url: '/src/modulo/bodega/bodega/index.html' },
    facturacion: { nombre: 'Facturación', url: '/src/modulo/facturacion/facturacion/index.html' },
    rrhh: { nombre: 'RRHH', url: '/src/modulo/rrhh/rrhh/index.html' },
    'recursos-humanos': { nombre: 'RRHH', url: '/src/modulo/rrhh/rrhh/index.html' },
    contabilidad: { nombre: 'Contabilidad', url: '/src/modulo/contabilidad/contabilidad/index.html' },
    cobranza: { nombre: 'Contabilidad', url: '/src/modulo/contabilidad/contabilidad/index.html' },
    'servicio-tecnico': { nombre: 'Servicio Técnico', url: '/src/modulo/servtecnico/servicio-tecnico/index.html' },
    servicio: { nombre: 'Servicio Técnico', url: '/src/modulo/servtecnico/servicio-tecnico/index.html' },
    'serv-tecnico': { nombre: 'Servicio Técnico', url: '/src/modulo/servtecnico/servicio-tecnico/index.html' },
    admin: { nombre: 'Administración', url: '/src/modulo/admin/admin/index.html' },
    administracion: { nombre: 'Administración', url: '/src/modulo/admin/admin/index.html' },
    gerencia: { nombre: 'Ventas', url: '/src/modulo/ventas/dashboard/index.html' },
  };

  function normalizarArea(area) {
    return String(area || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

  function appUrl(path) {
    const idx = window.location.pathname.indexOf('/src/');
    const base = idx > 0 ? window.location.pathname.slice(0, idx) : '';
    return `${base}${path}`;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value || '—';
  }

  function parseJSONSafe(raw) {
    try { return raw ? JSON.parse(raw) : null; }
    catch { return null; }
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

  function normalizarUsuario(raw) {
    if (!raw) return null;
    const user = raw.user || raw.usuario || raw;
    return {
      id: user.id || user.usuario_id || user.sub || '',
      nombre: user.nombre || user.name || user.usuario || user.email || 'Usuario',
      email: user.email || user.correo || '',
      usuario: user.usuario || user.username || '',
      area: user.area || user.Area || user.departamento || user.depto || '',
      is_admin: Boolean(user.is_admin || user.admin || user.es_admin),
    };
  }

  function getUsuarioGuardado() {
    return normalizarUsuario(parseJSONSafe(sessionStorage.getItem('texpro_user')))
      || normalizarUsuario(parseJSONSafe(localStorage.getItem('user')))
      || normalizarUsuario(parseJSONSafe(localStorage.getItem('usuario')))
      || normalizarUsuario(decodificarJwt(localStorage.getItem('token')));
  }

  function moduloPorArea(area, isAdmin) {
    if (isAdmin) return MODULOS_PRINCIPALES.admin;
    const normalizada = normalizarArea(area);
    return MODULOS_PRINCIPALES[normalizada] || {
      nombre: 'Ventas',
      url: '/src/modulo/ventas/dashboard/index.html',
    };
  }

  function pintarUsuario(usuario) {
    const params = new URLSearchParams(window.location.search);
    const moduloSolicitado = params.get('modulo') || 'Módulo restringido';
    const nombre = usuario?.nombre || usuario?.email || usuario?.usuario || 'Usuario';
    const area = usuario?.area || 'Sin área asignada';
    const modulo = moduloPorArea(usuario?.area, usuario?.is_admin);

    setText('usuarioNombre', nombre);
    setText('usuarioArea', area);
    setText('moduloSolicitado', moduloSolicitado);
    setText('moduloPrincipal', modulo.nombre);

    const btnVolver = document.getElementById('btnVolverModulo');
    if (btnVolver) btnVolver.href = appUrl(modulo.url);
  }

  async function cargarUsuario() {
    const usuarioGuardado = getUsuarioGuardado();
    if (usuarioGuardado) pintarUsuario(usuarioGuardado);
    else pintarUsuario({ nombre: 'Usuario no identificado', area: '' });

    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.user) throw new Error(data?.error || 'Sesión no disponible');

      const usuario = normalizarUsuario(data.user);
      if (usuario) {
        const payload = JSON.stringify(usuario);
        sessionStorage.setItem('texpro_user', payload);
        localStorage.setItem('user', payload);
        localStorage.setItem('usuario', payload);
        pintarUsuario(usuario);
      }
    } catch (err) {
      console.warn('[sin-acceso]', err.message);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cargarUsuario);
  } else {
    cargarUsuario();
  }
})();
