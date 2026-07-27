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
    ventas: { codigos: ['ventas_dashboard'], rutas: ['/src/modulo/ventas/dashboard/index.html'] },
    venta: { codigos: ['ventas_dashboard'], rutas: ['/src/modulo/ventas/dashboard/index.html'] },
    vendedores: { codigos: ['ventas_dashboard'], rutas: ['/src/modulo/ventas/dashboard/index.html'] },
    comercial: { codigos: ['ventas_dashboard'], rutas: ['/src/modulo/ventas/dashboard/index.html'] },
    gerencia: { codigos: ['ventas_dashboard'], rutas: ['/src/modulo/ventas/dashboard/index.html'] },
    produccion: { codigos: ['produccion'], rutas: ['/src/modulo/produccion/produccion/index.html'] },
    bodega: { codigos: ['bodega'], rutas: ['/src/modulo/bodega/bodega/index.html'] },
    facturacion: { codigos: ['facturacion'], rutas: ['/src/modulo/facturacion/facturacion/index.html'] },
    rrhh: { codigos: ['rrhh'], rutas: ['/src/modulo/rrhh/rrhh/index.html'] },
    'recursos-humanos': { codigos: ['rrhh'], rutas: ['/src/modulo/rrhh/rrhh/index.html'] },
    contabilidad: { codigos: ['contabilidad'], rutas: ['/src/modulo/contabilidad/contabilidad/index.html'] },
    cobranza: { codigos: ['cobranza'], rutas: ['/src/modulo/contabilidad/contabilidad/index.html'] },
    'servicio-tecnico': { codigos: ['servicio_tecnico'], rutas: ['/src/modulo/servtecnico/servicio-tecnico/index.html'] },
    servicio: { codigos: ['servicio_tecnico'], rutas: ['/src/modulo/servtecnico/servicio-tecnico/index.html'] },
    'serv-tecnico': { codigos: ['servicio_tecnico'], rutas: ['/src/modulo/servtecnico/servicio-tecnico/index.html'] },
    administracion: { codigos: ['administracion', 'admin'], rutas: ['/src/modulo/admin/admin/index.html'] },
    admin: { codigos: ['administracion', 'admin'], rutas: ['/src/modulo/admin/admin/index.html'] },
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

  function normalizarCodigo(valor) {
    return String(valor || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
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
        codigo: normalizarCodigo(menu?.codigo),
        grupo: normalizarCodigo(menu?.grupo),
        url: normalizarRuta(menu?.url),
        nombre: String(menu?.nombre || '').trim(),
        orden: Number(menu?.orden ?? 0) || 0,
      }))
      .filter(menu => menu.id !== null && menu.url);
  }

  function esMenuGeneral(menu) {
    const codigo = normalizarCodigo(menu?.codigo);
    const grupo = normalizarCodigo(menu?.grupo);
    return codigo === 'alertas' || grupo === 'general';
  }

  function getRutaPreferida(area, menus) {
    const config = HOME_ROUTES[area];
    if (!config) return null;

    const ruta = config.rutas
      .map(normalizarRuta)
      .find(rutaNormalizada => menus.some(menu => menu.url === rutaNormalizada && (!config.codigos || !config.codigos.length || config.codigos.includes(menu.codigo))));

    return ruta || null;
  }

  function resolverRutaPrincipalUsuario(user) {
    const menus = normalizarMenus(user?.menus);
    if (!menus.length) return null;

    const area = normalizarArea(user?.area);
    const rutaPreferida = getRutaPreferida(area, menus);
    if (rutaPreferida) {
      return rutaPreferida;
    }

    const menusUtiles = menus
      .filter(menu => !esMenuGeneral(menu))
      .sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es'));

    if (menusUtiles.length) {
      return menusUtiles[0].url;
    }

    return null;
  }

  function resolverRutaInicialUsuario(user) {
    return resolverRutaPrincipalUsuario(user) || FALLBACK_URL;
  }

  return {
    FALLBACK_URL,
    HOME_ROUTES,
    normalizarArea,
    normalizarCodigo,
    normalizarRuta,
    resolverRutaPrincipalUsuario,
    resolverRutaInicialUsuario,
  };
});
