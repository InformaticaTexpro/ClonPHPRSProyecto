'use strict';

/**
 * detalle-codaux.js
 *
 * Ajusta la carga de detalle en Ventas Asignadas para usar el endpoint
 * /api/ventas/detalle/:folio, que incluye CodAux desde Softland.cwtauxi.
 */

(function () {
  const baseFetch = window.fetch.bind(window);

  function esDetalleDashboard(pathname) {
    return pathname.startsWith('/api/dashboard/detalle/');
  }

  function normalizarDetalle(data, folio) {
    if (!data || !Array.isArray(data.detalle)) return data;

    return {
      ...data,
      folio: data.folio || Number(folio),
      detalle: data.detalle.map(row => ({
        ...row,
        CodAux: row.CodAux || row.cod_cliente || row.codAux || '',
        precio_lista_real: row.precio_lista_real ?? row.precio_lista_actual ?? row.precio_historico_base ?? row.PrecioVta,
        valor_historico_linea: row.valor_historico_linea ?? Math.round(Number(row.precio_lista_real || 0) * Number(row.CantFacturada || 0)),
      })),
    };
  }

  window.fetch = async function fetchConCodAux(input, init) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
      if (!esDetalleDashboard(url.pathname)) return baseFetch(input, init);

      const folio = url.pathname.split('/').pop();
      const res = await baseFetch(`/api/ventas/detalle/${encodeURIComponent(folio)}`, init);
      if (!res.ok) return res;

      const data = await res.clone().json().catch(() => null);
      if (!data?.ok) return res;

      return new Response(JSON.stringify(normalizarDetalle(data, folio)), {
        status: res.status,
        statusText: res.statusText,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      return baseFetch(input, init);
    }
  };
})();
