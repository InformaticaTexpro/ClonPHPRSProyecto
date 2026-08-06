'use strict';

(function () {
  const API_BASE = '/api/gerencia/comercial';
  const token = () => localStorage.getItem('token') || '';
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const colores = ['#13c7a0', '#49b7db', '#f5a623', '#8b5cf6', '#f97359', '#64748b', '#22c55e', '#0ea5e9', '#f43f5e', '#84cc16'];

  let chartCategory = null;
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

  function renderMonths() {
    const select = document.getElementById('monthFilter');
    if (!select) return;
    const current = new Date().getMonth() + 1;
    select.innerHTML = mesesNombres.map((nombre, idx) => `<option value="${idx + 1}">${nombre}</option>`).join('');
    select.value = String(current);
  }

  function renderYears() {
    const select = document.getElementById('yearFilter');
    if (!select) return;
    const current = new Date().getFullYear();
    const years = [current - 2, current - 1, current, current + 1];
    select.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
    select.value = String(current);
  }

  function destroyChart() {
    if (chartCategory) {
      chartCategory.destroy();
      chartCategory = null;
    }
  }

  function renderSummary(data) {
    setText('kpiVentaMes', formatCLP(data?.ventaMes ?? 0));
    const metaMes = Number(data?.metaMes ?? data?.meta ?? 0);
    const ventaMes = Number(data?.ventaMes ?? 0);
    const cumplimiento = data?.cumplimiento ?? (metaMes > 0 ? (ventaMes / metaMes) * 100 : null);

    if (metaMes > 0) {
      setText('kpiMetaMes', formatCLP(metaMes));
      setText('metaMesAyuda', 'Meta mensual cargada');
    } else {
      setText('kpiMetaMes', 'Sin meta');
      setText('metaMesAyuda', data?.metaDisponible === false ? 'Meta no disponible en MySQL' : 'Sin meta mensual configurada');
    }

    setText('kpiCumplimiento', cumplimiento === null || cumplimiento === undefined ? '—' : formatPct(cumplimiento));
    setText('kpiDescuentoMes', formatPct(data?.porcentajeDescuento ?? 0));
    setText('descripcionCategorias', `${mesesNombres[(Number(data?.mes || 1) - 1)] || 'Mes'} ${data?.anio || ''}.`);
    setText('headerIndicadores', `${mesesNombres[(Number(data?.mes || 1) - 1)] || 'Mes'} ${data?.anio || ''}`);
  }

  function renderCategoryChart(data) {
    const categorias = Array.isArray(data?.categorias) ? data.categorias : [];
    const canvas = document.getElementById('categoryChart');
    if (!canvas) return;

    destroyChart();
    chartCategory = new Chart(canvas, {
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

  function renderCategoriesTable(data) {
    const body = document.getElementById('categoryTableBody');
    const foot = document.getElementById('categoryTableFoot');
    if (!body || !foot) return;

    const categorias = Array.isArray(data?.categorias) ? data.categorias.slice() : [];
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
        <th class="numero">${formatCLP(data?.totalCategorias ?? 0)}</th>
        <th class="numero">100 %</th>
      </tr>
    `;
  }

  function renderTopClientes(data) {
    const body = document.getElementById('clientsTableBody');
    if (!body) return;

    const clientes = Array.isArray(data?.clientes) ? data.clientes.slice(0, 10) : [];
    if (!clientes.length) {
      body.innerHTML = '<tr><td colspan="4" class="gerencia-empty">No hay clientes para mostrar.</td></tr>';
      return;
    }

    body.innerHTML = clientes.map((item, index) => `
      <tr>
        <td class="numero">${index + 1}</td>
        <td>
          <strong>${escHtml(item.cliente || '-')}</strong><br />
          <small>${escHtml(item.codigoCliente || '')}</small>
        </td>
        <td class="numero">${formatCLP(item.venta ?? 0)}</td>
        <td class="numero">${formatPct(item.participacion ?? 0)}</td>
      </tr>
    `).join('');
  }

  function renderTopProductos(data) {
    const body = document.getElementById('productsTableBody');
    if (!body) return;

    const productos = Array.isArray(data?.productos) ? data.productos.slice(0, 10) : [];
    if (!productos.length) {
      body.innerHTML = '<tr><td colspan="5" class="gerencia-empty">No hay productos para mostrar.</td></tr>';
      return;
    }

    body.innerHTML = productos.map((item, index) => `
      <tr>
        <td class="numero">${index + 1}</td>
        <td>
          <strong>${escHtml(item.producto || '-')}</strong><br />
          <small>${escHtml(item.codigoProducto || '')}</small>
        </td>
        <td>${escHtml(item.categoria || '-')}</td>
        <td class="numero">${formatCLP(item.venta ?? 0)}</td>
        <td class="numero">${formatPct(item.participacion ?? 0)}</td>
      </tr>
    `).join('');
  }

  async function cargarDatos() {
    const cargaActual = ++cargaSecuencia;
    const anio = Number(document.getElementById('yearFilter')?.value || new Date().getFullYear());
    const mes = Number(document.getElementById('monthFilter')?.value || (new Date().getMonth() + 1));
    setLoadingState(true, 'Cargando estadisticas de ventas...');

    try {
      const data = await apiGet(`/mensual?anio=${encodeURIComponent(anio)}&mes=${encodeURIComponent(mes)}`);
      if (cargaActual !== cargaSecuencia) {
        return;
      }

      renderSummary(data);
      renderCategoryChart(data);
      renderCategoriesTable(data);
      renderTopClientes(data);
      renderTopProductos(data);
      setText('mensajeMensual', '');
    } finally {
      if (cargaActual === cargaSecuencia) {
        setLoadingState(false);
      }
    }
  }

  function bindEvents() {
    const reload = () => {
      cargarDatos().catch(err => {
        console.error('[gerencia-estadisticas-ventas]', err);
        alert(`No se pudieron cargar las estadísticas de ventas. ${err.message}`);
      });
    };

    document.getElementById('btnActualizar')?.addEventListener('click', reload);
    document.getElementById('yearFilter')?.addEventListener('change', reload);
    document.getElementById('monthFilter')?.addEventListener('change', reload);
  }

  async function init() {
    if (!token()) {
      window.location.href = '/src/modulo/varios/login/index.html';
      return;
    }

    if (window.Chart?.getChart) {
      const existing = window.Chart.getChart('categoryChart');
      if (existing) existing.destroy();
    }

    renderMonths();
    renderYears();
    bindEvents();

    try {
      await cargarDatos();
    } catch (err) {
      console.error('[gerencia-estadisticas-ventas]', err);
      alert(`No se pudo cargar el submódulo de gerencia. ${err.message}`);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
