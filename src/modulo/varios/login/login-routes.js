(function (global, factory) {
  const api = factory();
  global.TEXPRO_LOGIN_ROUTER = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const FALLBACK_URL = '/src/sin-acceso.html';

  const HOME_ROUTES = {
    ventas: ['/src/modulo/ventas/dashboard/index.html'],
    venta: ['/src/modulo/ventas/dashboard/index.html'],
    vendedores: ['/src/modulo/ventas/dashboard/index.html'],
    comercial: ['/src/modulo/ventas/dashboard/index.html'],
    gerencia: ['/src/modulo/ventas/dashboard/index.html'],
    produccion: ['/src/modulo/produccion/produccion/index.html'],
    bodega: ['/src/modulo/bodega/bodega/index.html'],
    facturacion: ['/src/modulo/facturacion/facturacion/index.html'],
    rrhh: ['/src/modulo/rrhh/rrhh/index.html'],
    'recursos-humanos': ['/src/modulo/rrhh/rrhh/index.html'],
    contabilidad: ['/src/modulo/contabilidad/contabilidad/index.html'],
    cobranza: ['/src/modulo/contabilidad/contabilidad/index.html'],
    'servicio-tecnico': ['/src/modulo/servtecnico/servicio-tecnico/index.html'],
    servicio: ['/src/modulo/servtecnico/servicio-tecnico/index.html'],
    'serv-tecnico': ['/src/modulo/servtecnico/servicio-tecnico/index.html'],
    admin: ['/src/modulo/admin/admin/index.html'],
    administracion: ['/src/modulo/admin/admin/index.html'],
  };

  function normalizarArea(area) {
    return String(area || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function normalizarRuta(url) {
    const valor = String(url || '').trim();
    if (!valor) return '';

    try {
      const baseHref = typeof globalThis.location?.href === 'string'
        ? globalThis.location.href
        : 'http://localhost/';
      return new URL(valor, baseHref).pathname;
    } catch {
      return valor.startsWith('/') ? valor : `/${valor}`;
    }
  }

  function normalizarMenus(menus) {
    return (menus || [])
      .map(menu => ({
        id: menu?.id ?? null,
        url: normalizarRuta(menu?.url),
      }))
      .filter(menu => menu.id !== null && menu.url);
  }

  function resolverRutaInicialUsuario(user) {
    const menus = normalizarMenus(user?.menus);
    if (!menus.length) {
      return FALLBACK_URL;
    }

    const area = normalizarArea(user?.area);
    const rutasPreferidas = HOME_ROUTES[area] || [];
    const rutasNormalizadas = rutasPreferidas.map(normalizarRuta).filter(Boolean);
    const rutaPreferida = rutasNormalizadas.find(ruta => menus.some(menu => menu.url === ruta));

    if (rutaPreferida) {
      return rutaPreferida;
    }

    return menus[0]?.url || FALLBACK_URL;
  }

  return {
    FALLBACK_URL,
    HOME_ROUTES,
    normalizarArea,
    normalizarRuta,
    resolverRutaInicialUsuario,
  };
});
