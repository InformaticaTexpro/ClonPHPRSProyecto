'use strict';

/**
 * asignados-panel.js
 *
 * Mantiene el comportamiento esperado del panel coordinador:
 * la tabla "Folios Asignados" debe mostrar las asignaciones existentes,
 * independiente del mes/año seleccionado para la tabla "Ventas del Mes".
 *
 * El filtro por período sigue aplicando a Ventas del Mes, pero no al historial
 * de asignaciones administrables del coordinador.
 */

(function () {
  const originalFetch = window.fetch.bind(window);

  window.fetch = function fetchPanelAsignados(input, init) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);

      if (url.pathname === '/api/dashboard/asignados') {
        url.search = '';
        return originalFetch(url.pathname, init);
      }
    } catch {
      // Mantener comportamiento original si no es una URL estándar.
    }

    return originalFetch(input, init);
  };
})();
