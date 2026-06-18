'use strict';

/**
 * indicadores-header.js — RSProyecto Texpro
 *
 * Carga USD (tasa de mercado) y UF desde /api/indicadores
 * y los muestra en el elemento #headerIndicadores del header.
 *
 * Se refresca automáticamente cada 5 minutos.
 *
 * Incluir en cualquier módulo:
 *   <script src="../../../assets/js/indicadores-header.js"></script>
 * (ajustar ruta relativa según profundidad del módulo)
 */

(function () {

  const REFRESH_MS = 5 * 60 * 1000; // 5 minutos

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
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'error');

      const horaActualiz = new Date(data.actualizadoEn).toLocaleTimeString('es-CL', {
        hour: '2-digit', minute: '2-digit',
      });

      el.innerHTML = `
        <span class="hind-item" title="USD/CLP — tasa de mercado (actualizado ${horaActualiz})">
          <span class="hind-label">USD</span>
          <span class="hind-valor hind-valor--usd">$${fmt(data.dolar.valor, 2)}</span>
        </span>
        <span class="hind-sep" aria-hidden="true">|</span>
        <span class="hind-item" title="Unidad de Fomento del día (actualizado ${horaActualiz})">
          <span class="hind-label">UF</span>
          <span class="hind-valor hind-valor--uf">$${fmt(data.uf.valor, 2)}</span>
        </span>
      `;
      el.title = `Última actualización: ${horaActualiz}`;
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
