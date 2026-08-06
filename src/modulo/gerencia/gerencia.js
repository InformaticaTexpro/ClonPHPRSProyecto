'use strict';

(function () {
  const API_BASE = '/api/gerencia/comercial';
  const token = () => localStorage.getItem('token') || '';
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const colores = ['#13c7a0', '#49b7db', '#f5a623', '#8b5cf6', '#f97359', '#64748b', '#22c55e', '#0ea5e9'];

  let chartMonthly = null;
  let chartCategory = null;
  let resumenActual = null;
  let cargaSecuencia = 0;

  function formatCLP(valor) {
    const numero = Number(valor ?? 0);
    if (!Number.isFinite(numero)) return '—';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(numero);
  }

  function formatPct(valor) {
    const numero = Number(valor ?? 0);
    if (!Number.isFinite(numero)) return '—';
    return `${numero.toFixed(2)} %`;
  }

  function escHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/json',
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Error HTTP ${response.status}`);
    }
    return data.data ?? data;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setLoadingState(visible, message) {
    const overlay = document.getElementById('gerenciaLoadingOverlay');
    const wrapper = document.getElementById('mainWrapper');
    const label = overlay?.querySelector('[data-loading-text]');
    if (label && message) {
      label.textContent = message;
    }
    if (overlay) {
      overlay.classList.toggle('is-visible', !!visible);
      overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    if (wrapper) {
      wrapper.setAttribute('aria-busy', visible ? 'true' : 'false');
    }
    document.querySelectorAll('.gerencia-filtros .filtro-select, .gerencia-filtros .btn-buscar').forEach(control => {
      control.disabled = !!visible;
    });
  }

  function renderYears() {
    const select = document.getElementById('yearFilter');
    if (!select) return;
    const current = new Date().getFullYear();
    const years = [current - 2, current - 1, current, current + 1];
    select.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
    select.value = String(current);
  }

  function destroyCharts() {
    const existingMonthly = window.Chart?.getChart?.('monthlyComparisonChart');
    const existingCategory = window.Chart?.getChart?.('categoryChart');
    if (existingMonthly) existingMonthly.destroy();
    if (existingCategory) existingCategory.destroy();
    if (chartMonthly) chartMonthly.destroy();
    if (chartCategory) chartCategory.destroy();
    chartMonthly = null;
    chartCategory = null;
  }

  function renderKpis(resumen) {
    const resumenBase = resumen?.resumen || {};
    const descuento = resumen?.descuento || {};
    setText('kpiVentasAcumuladas', formatCLP(resumenBase?.ventasAcumuladas ?? 0));
    setText('kpiDescuentoAnual', formatPct(resumenBase?.porcentajeDescuento ?? descuento?.porcentajeDescuento ?? null));
    setText('kpiPromedio', formatCLP(resumenBase?.promedioMensual ?? 0));
    setText('kpiVentasAyuda', `Enero a ${mesesNombres[(Number(resumen?.mesLimite || 1) - 1)] || 'mes'}`);
  }

  function renderComparativo(resumen) {
    const periodos = Array.isArray(resumen?.periodos) ? resumen.periodos : [];
    const filas = Array.isArray(resumen?.comparativoMensual) ? resumen.comparativoMensual : [];
    const head = document.getElementById('comparativoTableHead');
    const body = document.getElementById('comparativoTableBody');
    const foot = document.getElementById('comparativoTableFoot');

    if (!head || !body || !foot) return;

    if (periodos.length < 3) {
      head.innerHTML = '';
      body.innerHTML = '<tr><td colspan="5" class="gerencia-empty">No hay datos suficientes para construir el comparativo.</td></tr>';
      foot.innerHTML = '';
      return;
    }

    head.innerHTML = `
      <tr>
        <th>Mes</th>
        <th class="numero">${periodos[0]}</th>
        <th class="numero">${periodos[1]}</th>
        <th class="numero">Variación ${periodos[1]}</th>
        <th class="numero">${periodos[2]}</th>
        <th class="numero">Variación ${periodos[2]}</th>
      </tr>
    `;

    body.innerHTML = filas.map(fila => {
      const valores = Array.isArray(fila.valores) ? fila.valores : [];
      const variaciones = Array.isArray(fila.variaciones) ? fila.variaciones : [];
      const mesNombre = mesesNombres[(Number(fila.mes) || 1) - 1] || String(fila.mes || '');
      return `
        <tr>
          <td>${escHtml(mesNombre)}</td>
          <td class="numero">${formatCLP(valores[0] ?? 0)}</td>
          <td class="numero">${formatCLP(valores[1] ?? 0)}</td>
          <td class="numero ${Number(variaciones[1]) >= 0 ? 'positive' : 'negative'}">${formatPct(variaciones[1])}</td>
          <td class="numero">${formatCLP(valores[2] ?? 0)}</td>
          <td class="numero ${Number(variaciones[2]) >= 0 ? 'positive' : 'negative'}">${formatPct(variaciones[2])}</td>
        </tr>
      `;
    }).join('');

    const totales = Array.isArray(resumen?.totales?.valores) ? resumen.totales.valores : [];
    const variaciones = Array.isArray(resumen?.totales?.variaciones) ? resumen.totales.variaciones : [];
    foot.innerHTML = `
      <tr>
        <th>Total</th>
        <th class="numero">${formatCLP(totales[0] ?? 0)}</th>
        <th class="numero">${formatCLP(totales[1] ?? 0)}</th>
        <th class="numero ${Number(variaciones[1]) >= 0 ? 'positive' : 'negative'}">${formatPct(variaciones[1])}</th>
        <th class="numero">${formatCLP(totales[2] ?? 0)}</th>
        <th class="numero ${Number(variaciones[2]) >= 0 ? 'positive' : 'negative'}">${formatPct(variaciones[2])}</th>
      </tr>
    `;
  }

  function renderCharts(resumen) {
    const periodos = Array.isArray(resumen?.periodos) ? resumen.periodos : [];
    const filas = Array.isArray(resumen?.comparativoMensual) ? resumen.comparativoMensual : [];

    const canvasMonthly = document.getElementById('monthlyComparisonChart');
    if (canvasMonthly) {
      const existingMonthly = window.Chart?.getChart?.(canvasMonthly);
      if (existingMonthly) existingMonthly.destroy();
      chartMonthly = new Chart(canvasMonthly, {
        type: 'line',
        data: {
          labels: filas.map(fila => mesesNombres[(Number(fila.mes) || 1) - 1] || String(fila.mes)),
          datasets: periodos.map((periodo, index) => ({
            label: String(periodo),
            data: filas.map(fila => Number(fila.valores?.[index] || 0)),
            borderColor: colores[index % colores.length],
            backgroundColor: colores[index % colores.length],
            tension: 0.35,
            borderWidth: 3,
            pointRadius: 2,
            pointHoverRadius: 4,
            fill: false,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: {
              ticks: {
                callback(value) {
                  return `$${Math.round(Number(value) / 1_000_000)}M`;
                },
              },
            },
          },
          plugins: {
            legend: { position: 'bottom' },
          },
        },
      });
    }

    const categorias = Array.isArray(resumen?.categorias) ? resumen.categorias : [];
    const canvasCategory = document.getElementById('categoryChart');
    if (canvasCategory) {
      const existingCategory = window.Chart?.getChart?.(canvasCategory);
      if (existingCategory) existingCategory.destroy();
      chartCategory = new Chart(canvasCategory, {
        type: 'doughnut',
        data: {
          labels: categorias.map(item => item.categoria),
          datasets: [{
            data: categorias.map(item => Number(item.venta || 0)),
            backgroundColor: categorias.map((_, idx) => colores[idx % colores.length]),
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: { position: 'bottom' },
          },
        },
      });
    }
  }

  function renderCategoriesTable(resumen) {
    const body = document.getElementById('categoryTableBody');
    const foot = document.getElementById('categoryTableFoot');
    if (!body || !foot) return;

    const categorias = Array.isArray(resumen?.categorias) ? resumen.categorias : [];
    if (!categorias.length) {
      body.innerHTML = '<tr><td colspan="3" class="gerencia-empty">No hay categorías para mostrar.</td></tr>';
      foot.innerHTML = '';
      return;
    }

    body.innerHTML = categorias.map(item => `
      <tr>
        <td>${escHtml(item.categoria || '-')}</td>
        <td class="numero">${formatCLP(item.venta ?? 0)}</td>
        <td class="numero">${formatPct(item.participacion ?? 0)}</td>
      </tr>
    `).join('');

    foot.innerHTML = `
      <tr>
        <th>Total</th>
        <th class="numero">${formatCLP(resumen?.totalCategorias ?? 0)}</th>
        <th class="numero">100 %</th>
      </tr>
    `;
  }

  async function cargarDatos() {
    const cargaActual = ++cargaSecuencia;
    const year = Number(document.getElementById('yearFilter')?.value || new Date().getFullYear());

    setLoadingState(true, 'Cargando datos de gerencia...');
    destroyCharts();
    setText('kpiVentasAcumuladas', '—');
    setText('kpiDescuentoAnual', '—');
    setText('kpiPromedio', '—');
    setText('mensajeAnual', 'Actualizando informacion...');

    try {
      const resumen = await apiGet(`/resumen?anio=${encodeURIComponent(year)}`);
      if (cargaActual !== cargaSecuencia) {
        return;
      }
      resumenActual = resumen;

      renderKpis(resumen);
      renderComparativo(resumen);
      renderCharts(resumen);
      renderCategoriesTable(resumen);
      setText('subtituloComparativo', `${resumen.periodos?.join(', ') || year} · enero a ${mesesNombres[(Number(resumen.mesLimite || 1) - 1)] || 'mes'}.`);
      setText('descripcionEvolucion', `Comparación mensual de ${resumen.periodos?.join(', ') || year}.`);
      setText('descripcionCategorias', `Distribución de ventas de ${year}.`);
      setText('headerIndicadores', 'Datos reales');
      setText('kpiVentasAyuda', `Enero a ${mesesNombres[(Number(resumen.mesLimite || 1) - 1)] || 'mes'} de ${year}`);
      setText('mensajeAnual', '');
    } finally {
      if (cargaActual === cargaSecuencia) {
        setLoadingState(false);
      }
    }
  }

  function bindEvents() {
    document.getElementById('btnActualizarAnual')?.addEventListener('click', () => {
      cargarDatos().catch(err => {
        console.error('[gerencia]', err);
        alert(`No se pudieron cargar los datos de gerencia. ${err.message}`);
      });
    });

    document.getElementById('yearFilter')?.addEventListener('change', () => {
      cargarDatos().catch(err => {
        console.error('[gerencia]', err);
        alert(`No se pudieron cargar los datos de gerencia. ${err.message}`);
      });
    });
  }

  async function init() {
    if (!token()) {
      window.location.href = '/src/modulo/varios/login/index.html';
      return;
    }

    if (window.Chart?.getChart) {
      ['monthlyComparisonChart', 'categoryChart'].forEach(id => {
        const existing = window.Chart.getChart(id);
        if (existing) existing.destroy();
      });
    }

    renderYears();
    bindEvents();

    try {
      await cargarDatos();
    } catch (err) {
      console.error('[gerencia]', err);
      alert(`No se pudo cargar Gerencia. ${err.message}`);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
