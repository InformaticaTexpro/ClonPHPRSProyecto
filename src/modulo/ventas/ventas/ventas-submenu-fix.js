'use strict';

/**
 * ventas-submenu-fix.js
 *
 * Corrección específica para el submenú Ventas Asignadas:
 * - Mantiene separadas las tablas Folios Asignados / Compartidas y Ventas del Mes.
 * - Al presionar Actualizar, fuerza la recarga visual de los contadores correctos.
 * - Calcula visualmente el descuento en Ventas del Mes cuando la API no lo envía explícito.
 * - No aplica en el dashboard principal.
 */

(function () {
  const API = '/api/dashboard';
  const token = () => localStorage.getItem('token') || '';

  function getParams() {
    return {
      mes: document.getElementById('filtroMes')?.value || (new Date().getMonth() + 1),
      anio: document.getElementById('filtroAnio')?.value || new Date().getFullYear(),
    };
  }

  function formatCLP(v) {
    if (v == null || v === '') return '—';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(Number(v));
  }

  function fechaCL(fecha) {
    if (!fecha) return '—';
    return new Date(fecha).toLocaleDateString('es-CL');
  }

  function parseCLP(texto) {
    if (!texto) return 0;
    const limpio = String(texto)
      .replace(/\$/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '.')
      .replace(/\s/g, '')
      .trim();
    const valor = Number(limpio);
    return Number.isFinite(valor) ? valor : 0;
  }

  function formatPct(valor) {
    if (!Number.isFinite(valor) || Math.abs(valor) < 0.005) return '—';
    return `${Math.round(valor * 100) / 100}%`;
  }

  function actualizarDescuentosVentasMes() {
    const tbody = document.getElementById('tbodyVentas');
    if (!tbody) return;

    tbody.querySelectorAll('tr[data-folio]').forEach(tr => {
      const celdas = tr.querySelectorAll('td');
      if (celdas.length < 8) return;

      const celdaMonto = celdas[5];
      const celdaTotalReal = celdas[6];
      const celdaDescuento = celdas[7];

      const descuentoActual = celdaDescuento.textContent.trim();
      if (descuentoActual && descuentoActual !== '—') return;

      const monto = parseCLP(celdaMonto.textContent);
      const totalReal = parseCLP(celdaTotalReal.textContent);

      if (!totalReal || !monto || Math.abs(totalReal) <= Math.abs(monto)) {
        celdaDescuento.textContent = '—';
        return;
      }

      const pct = (1 - (Math.abs(monto) / Math.abs(totalReal))) * 100;
      celdaDescuento.textContent = formatPct(pct);
    });
  }

  function filaAsignado(c) {
    return `
      <tr data-id="${c.id}">
        <td><strong>${c.folio}</strong></td>
        <td>${fechaCL(c.fecha)}</td>
        <td>${c.cliente || '—'}</td>
        <td>${c.nombre_vendedor_compartido || c.cod_vendedor_compartido || '—'}</td>
        <td style="text-align:right">${Number(c.porcentaje || 0).toFixed(2)}%</td>
        <td style="text-align:right">${formatCLP(c.monto_asignado)}</td>
        <td>
          <div class="crud-acciones">
            <button class="btn-crud btn-crud--edit" title="Editar" data-id="${c.id}">&#9998;</button>
            <button class="btn-crud btn-crud--del" title="Eliminar" data-id="${c.id}" data-folio="${c.folio}">&times;</button>
          </div>
        </td>
      </tr>`;
  }

  async function cargarFoliosAsignadosSubmenu() {
    const tbody = document.getElementById('tbodyAsignados');
    const total = document.getElementById('totalAsignados');
    if (!tbody) return;

    try {
      const res = await fetch(`${API}/asignados?${new URLSearchParams(getParams())}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      const asignados = data.asignados || [];

      if (total) total.textContent = `${asignados.length} registros`;

      if (!asignados.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="7" style="text-align:center;padding:1.5rem;color:#aaa">Sin folios asignados este mes</td></tr>';
        return;
      }

      tbody.innerHTML = asignados.map(filaAsignado).join('');
    } catch (err) {
      console.error('[ventas-submenu-fix] cargarFoliosAsignadosSubmenu', err);
      if (total) total.textContent = '0 registros';
    }
  }

  async function sincronizarContadores() {
    const params = getParams();
    const headers = { Authorization: `Bearer ${token()}` };

    try {
      const [resV, resC] = await Promise.all([
        fetch(`${API}/ventas-mes?${new URLSearchParams(params)}`, { headers }),
        fetch(`${API}/compartidos?${new URLSearchParams(params)}`, { headers }),
      ]);
      const [dataV, dataC] = await Promise.all([resV.json(), resC.json()]);

      const totalVentas = document.getElementById('totalVentas');
      const totalCompartidos = document.getElementById('totalCompartidos');

      if (totalVentas) totalVentas.textContent = `${(dataV.ventas || []).length} registros`;
      if (totalCompartidos) totalCompartidos.textContent = `${(dataC.compartidos || []).length} registros`;
    } catch (err) {
      console.warn('[ventas-submenu-fix] sincronizarContadores', err.message);
    }
  }

  function init() {
    if (!window.location.pathname.includes('/src/modulo/ventas/ventas/')) return;

    const refrescar = () => {
      setTimeout(() => {
        cargarFoliosAsignadosSubmenu();
        sincronizarContadores();
        actualizarDescuentosVentasMes();
      }, 300);
    };

    refrescar();
    document.getElementById('btnActualizar')?.addEventListener('click', refrescar);
    document.getElementById('filtroMes')?.addEventListener('change', refrescar);
    document.getElementById('filtroAnio')?.addEventListener('change', refrescar);

    const tbodyVentas = document.getElementById('tbodyVentas');
    if (tbodyVentas) {
      new MutationObserver(() => actualizarDescuentosVentasMes()).observe(tbodyVentas, {
        childList: true,
        subtree: true,
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
