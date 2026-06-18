'use strict';

/**
 * indicadores-header.js — RSProyecto Texpro
 *
 * Carga USD y UF desde /api/indicadores y los muestra
 * en el elemento #headerIndicadores del header.
 * Se refresca cada 10 minutos automáticamente.
 *
 * Incluir en cualquier módulo:
 *   <script src="../../../assets/js/indicadores-header.js"></script>
 * (ajustar ruta relativa según profundidad del módulo)
 */

(function () {

  const REFRESH_MS = 10 * 60 * 1000; // 10 min

  function fmt(valor, decimales) {
    if (valor == null) return '—';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(Number(valor));
  }

  function getToken() {
    return localStorage.getItem('token') || '';
  }

  async function cargarIndicadores() {
    const el = document.getElementById('headerIndicadores');
    if (!el) return;

    try {
      const res  = await fetch('/api/indicadores', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'error');

      el.innerHTML = `
        <span class="hind-item" title="Dólar observado del día">
          <span class="hind-label">USD</span>
          <span class="hind-valor hind-valor--usd">$${fmt(data.dolar.valor, 2)}</span>
        </span>
        <span class="hind-sep" aria-hidden="true">|</span>
        <span class="hind-item" title="Unidad de Fomento del día">
          <span class="hind-label">UF</span>
          <span class="hind-valor hind-valor--uf">$${fmt(data.uf.valor, 2)}</span>
        </span>
      `;
      el.title = `Actualizado: ${new Date(data.actualizadoEn).toLocaleTimeString('es-CL')}`;
    } catch {
      const el2 = document.getElementById('headerIndicadores');
      if (el2) el2.innerHTML = '<span class="hind-error">USD/UF —</span>';
    }
  }

  function init() {
    cargarIndicadores();
    setInterval(cargarIndicadores, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
