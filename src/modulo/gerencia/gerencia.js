'use strict';

(function () {
  const API_BASE = '/api/gerencia/comercial';
  const token = () => localStorage.getItem('token') || '';
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const colores = ['#13c7a0', '#49b7db', '#f5a623', '#8b5cf6', '#f97359', '#64748b', '#22c55e', '#0ea5e9'];

  let chartMonthly = null;
  let chartCategory = null;
  let chartMonthlyCategory = null;
  let resumenActual = null;
  let cumplimientoVendedoresActual = {
    cantidadCumplen: 0,
    cantidadConMeta: 0,
    cantidadNoCumplen: 0,
    cantidadSinMeta: 0,
    porcentajeCumplimiento: null,
    vendedores: [],
  };
  let cargaSecuencia = 0;
  let cargaMensualSecuencia = 0;

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

  function renderMonths() {
    const select = document.getElementById('monthFilter');
    if (!select) return;
    const current = new Date().getMonth() + 1;
    select.innerHTML = mesesNombres.map((nombre, index) => `<option value="${index + 1}">${nombre}</option>`).join('');
    select.value = String(current);
  }

  function destroyCharts() {
    const existingMonthly = window.Chart?.getChart?.('monthlyComparisonChart');
    const existingCategory = window.Chart?.getChart?.('categoryChart');
    if (existingMonthly) existingMonthly.destroy();
    if (existingCategory) existingCategory.destroy();
    if (!existingMonthly && chartMonthly) chartMonthly.destroy();
    if (!existingCategory && chartCategory) chartCategory.destroy();
    if (chartMonthlyCategory) destroyMonthlyCategoryChart();
    chartMonthly = null;
    chartCategory = null;
    chartMonthlyCategory = null;
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

  function destroyMonthlyCategoryChart() {
    const existing = window.Chart?.getChart?.('monthlyCategoryChart');
    if (existing) existing.destroy();
    if (!existing && chartMonthlyCategory) chartMonthlyCategory.destroy();
    chartMonthlyCategory = null;
  }

  function resetMonthlyContent() {
    destroyMonthlyCategoryChart();
    cerrarCumplimientoVendedores();
    cumplimientoVendedoresActual = {
      cantidadCumplen: 0,
      cantidadConMeta: 0,
      cantidadNoCumplen: 0,
      cantidadSinMeta: 0,
      porcentajeCumplimiento: null,
      vendedores: [],
    };
    setText('kpiVentaMes', formatCLP(0));
    setText('kpiMetaMes', '—');
    setText('metaMesAyuda', '');
    setText('kpiCumplimiento', '—');
    setText('kpiDescuentoMes', '—');
    setText('kpiVendedoresCumplieronValor', '0');
    setText('kpiVendedoresCumplieronAyuda', 'Cumplimiento igual o superior al 100 %');
    const cumplimientoCard = document.getElementById('kpiVendedoresCumplieron');
    if (cumplimientoCard) cumplimientoCard.disabled = true;
    setText('descripcionCategoriasMensual', 'Período seleccionado.');

    const categoryBody = document.getElementById('monthlyCategoryTableBody');
    const categoryFoot = document.getElementById('monthlyCategoryTableFoot');
    const clientsBody = document.getElementById('monthlyClientsTableBody');
    const productsBody = document.getElementById('monthlyProductsTableBody');
    if (categoryBody) categoryBody.innerHTML = '<tr><td colspan="3" class="gerencia-empty">No hay categorías para mostrar.</td></tr>';
    if (categoryFoot) categoryFoot.innerHTML = '';
    if (clientsBody) clientsBody.innerHTML = '<tr><td colspan="4" class="gerencia-empty">No hay clientes para mostrar.</td></tr>';
    if (productsBody) productsBody.innerHTML = '<tr><td colspan="5" class="gerencia-empty">No hay productos para mostrar.</td></tr>';
  }

  function renderMonthlySummary(data) {
    const metaMes = Number(data?.metaMes ?? data?.meta ?? 0);
    const cumplimiento = data?.cumplimiento;
    const descuento = data?.porcentajeDescuento;

    setText('kpiVentaMes', formatCLP(data?.ventaMes ?? 0));
    if (metaMes > 0) {
      setText('kpiMetaMes', formatCLP(metaMes));
      setText('metaMesAyuda', 'Meta mensual cargada');
    } else {
      setText('kpiMetaMes', 'Sin meta');
      setText('metaMesAyuda', data?.metaDisponible === false ? 'Meta no disponible en MySQL' : 'Sin meta mensual configurada');
    }
    setText('kpiCumplimiento', cumplimiento === null || cumplimiento === undefined ? '—' : formatPct(cumplimiento));
    setText('kpiDescuentoMes', descuento === null || descuento === undefined ? '—' : formatPct(descuento));
    cumplimientoVendedoresActual = data?.cumplimientoVendedores || cumplimientoVendedoresActual;
    setText('kpiVendedoresCumplieronValor', String(Number(cumplimientoVendedoresActual.cantidadCumplen) || 0));
    setText('kpiVendedoresCumplieronAyuda', `${Number(cumplimientoVendedoresActual.cantidadConMeta) || 0} vendedores con meta`);
    const cumplimientoCard = document.getElementById('kpiVendedoresCumplieron');
    if (cumplimientoCard) {
      cumplimientoCard.disabled = false;
      cumplimientoCard.setAttribute('aria-label', `Abrir cumplimiento de metas: ${Number(cumplimientoVendedoresActual.cantidadCumplen) || 0} vendedores cumplieron`);
    }
    setText('descripcionCategoriasMensual', `${mesesNombres[(Number(data?.mes || 1) - 1)] || 'Mes'} ${data?.anio || ''}.`);
  }

  function cerrarCumplimientoVendedores() {
    const modal = document.getElementById('cumplimientoVendedoresModal');
    if (!modal) return;
    modal.classList.remove('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function abrirCumplimientoVendedores() {
    const modal = document.getElementById('cumplimientoVendedoresModal');
    if (!modal) return;
    const items = Array.isArray(cumplimientoVendedoresActual.vendedores) ? cumplimientoVendedoresActual.vendedores : [];
    const mes = Number(document.getElementById('monthFilter')?.value || 1);
    const anio = document.getElementById('yearFilter')?.value || '';
    const count = value => new Intl.NumberFormat('es-CL').format(Number(value) || 0);

    setText('cumplimientoVendedoresPeriodo', `${mesesNombres[mes - 1] || 'Mes'} ${anio}`);
    setText('cumplimientoVendedoresEstado', items.length ? '' : 'No existen vendedores con información comercial para el período seleccionado.');
    setText('cumplimientoVendedoresTotal', count(cumplimientoVendedoresActual.cantidadCumplen));
    const tableWrapper = modal.querySelector('.gerencia-cumplimiento-tabla-wrapper');
    if (tableWrapper) tableWrapper.hidden = !items.length;

    const summary = document.getElementById('cumplimientoVendedoresResumen');
    if (summary) {
      const percentage = cumplimientoVendedoresActual.porcentajeCumplimiento;
      summary.innerHTML = `
        <span>Vendedores con meta: <strong>${count(cumplimientoVendedoresActual.cantidadConMeta)}</strong></span>
        <span>Cumplieron meta: <strong>${count(cumplimientoVendedoresActual.cantidadCumplen)}</strong></span>
        <span>No cumplieron: <strong>${count(cumplimientoVendedoresActual.cantidadNoCumplen)}</strong></span>
        <span>Sin meta: <strong>${count(cumplimientoVendedoresActual.cantidadSinMeta)}</strong></span>
        <span>Porcentaje de cumplimiento: <strong>${percentage === null || percentage === undefined ? '—' : formatPct(percentage)}</strong></span>
      `;
    }

    const body = document.getElementById('cumplimientoVendedoresBody');
    if (body) {
      body.innerHTML = items.map(item => {
        const target = Number(item.meta) || 0;
        const fulfillment = item.cumplimiento;
        const fulfilled = target > 0 && Number(fulfillment) >= 100;
        return `
          <tr class="${fulfilled ? 'gerencia-cumplimiento-row--ok' : ''}">
            <td><strong>${escHtml(item.vendedor || item.codigoPrincipal || '—')}</strong>${fulfilled ? '<span class="gerencia-cumplimiento-badge">Meta cumplida ✓</span>' : ''}</td>
            <td class="numero">${formatCLP(item.venta ?? 0)}</td>
            <td class="numero">${target > 0 ? formatCLP(target) : '—'}</td>
            <td class="numero ${fulfilled ? 'gerencia-cumplimiento-valor--ok' : ''}">${target > 0 && fulfillment !== null && fulfillment !== undefined ? formatPct(fulfillment) : '—'}</td>
          </tr>
        `;
      }).join('');
    }

    modal.classList.add('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.getElementById('cumplimientoVendedoresCerrar')?.focus();
  }

  function renderMonthlyCategoryChart(data) {
    const categorias = Array.isArray(data?.categorias) ? data.categorias : [];
    const canvas = document.getElementById('monthlyCategoryChart');
    destroyMonthlyCategoryChart();
    if (!canvas || !categorias.length) return;

    chartMonthlyCategory = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: categorias.map(item => item.categoria),
        datasets: [{
          data: categorias.map(item => Number(item.venta || 0)),
          backgroundColor: categorias.map((_, index) => colores[index % colores.length]),
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

  function renderMonthlyCategoriesTable(data) {
    const body = document.getElementById('monthlyCategoryTableBody');
    const foot = document.getElementById('monthlyCategoryTableFoot');
    if (!body || !foot) return;

    const categorias = Array.isArray(data?.categorias) ? data.categorias : [];
    if (!categorias.length) return;

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
        <th class="numero">${formatCLP(data?.ventaMes ?? 0)}</th>
        <th class="numero">100 %</th>
      </tr>
    `;
  }

  function renderMonthlyClients(data) {
    const body = document.getElementById('monthlyClientsTableBody');
    if (!body) return;
    const clientes = Array.isArray(data?.clientes) ? data.clientes.slice(0, 10) : [];
    if (!clientes.length) return;

    body.innerHTML = clientes.map((item, index) => `
      <tr>
        <td class="numero">${index + 1}</td>
        <td><strong>${escHtml(item.cliente || '-')}</strong><br /><small>${escHtml(item.codigoCliente || '')}</small></td>
        <td class="numero">${formatCLP(item.venta ?? 0)}</td>
        <td class="numero">${formatPct(item.participacion ?? 0)}</td>
      </tr>
    `).join('');
  }

  function renderMonthlyProducts(data) {
    const body = document.getElementById('monthlyProductsTableBody');
    if (!body) return;
    const productos = Array.isArray(data?.productos) ? data.productos.slice(0, 10) : [];
    if (!productos.length) return;

    body.innerHTML = productos.map((item, index) => `
      <tr>
        <td class="numero">${index + 1}</td>
        <td><strong>${escHtml(item.producto || '-')}</strong><br /><small>${escHtml(item.codigoProducto || '')}</small></td>
        <td>${escHtml(item.categoria || '-')}</td>
        <td class="numero">${formatCLP(item.venta ?? 0)}</td>
        <td class="numero">${formatPct(item.participacion ?? 0)}</td>
      </tr>
    `).join('');
  }

  async function cargarDatosMensuales(manageLoading = true) {
    const cargaActual = ++cargaMensualSecuencia;
    const anio = Number(document.getElementById('yearFilter')?.value || new Date().getFullYear());
    const mes = Number(document.getElementById('monthFilter')?.value || (new Date().getMonth() + 1));
    if (manageLoading) setLoadingState(true, 'Cargando análisis mensual...');
    resetMonthlyContent();
    setText('mensajeMensual', 'Actualizando información...');

    try {
      const data = await apiGet(`/mensual?anio=${encodeURIComponent(anio)}&mes=${encodeURIComponent(mes)}`);
      if (cargaActual !== cargaMensualSecuencia) return;
      renderMonthlySummary(data);
      renderMonthlyCategoryChart(data);
      renderMonthlyCategoriesTable(data);
      renderMonthlyClients(data);
      renderMonthlyProducts(data);
      setText('mensajeMensual', '');
    } catch (error) {
      if (cargaActual === cargaMensualSecuencia) {
        setText('mensajeMensual', `No se pudo cargar el período. ${error.message}`);
      }
      throw error;
    } finally {
      if (manageLoading && cargaActual === cargaMensualSecuencia) setLoadingState(false);
    }
  }

  async function cargarDatos(manageLoading = true) {
    const cargaActual = ++cargaSecuencia;
    const year = Number(document.getElementById('yearFilter')?.value || new Date().getFullYear());

    if (manageLoading) setLoadingState(true, 'Cargando datos de gerencia...');
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
        if (manageLoading) setLoadingState(false);
      }
    }
  }

  async function cargarDashboardCompleto() {
    setLoadingState(true, 'Cargando datos de gerencia...');
    try {
      const resultados = await Promise.allSettled([cargarDatos(false), cargarDatosMensuales(false)]);
      const error = resultados.find(resultado => resultado.status === 'rejected');
      if (error) throw error.reason;
    } finally {
      setLoadingState(false);
    }
  }

  function bindEvents() {
    document.getElementById('kpiVendedoresCumplieron')?.addEventListener('click', abrirCumplimientoVendedores);
    document.getElementById('cumplimientoVendedoresCerrar')?.addEventListener('click', cerrarCumplimientoVendedores);
    document.getElementById('cumplimientoVendedoresModal')?.addEventListener('click', event => {
      if (event.target === document.getElementById('cumplimientoVendedoresModal')) cerrarCumplimientoVendedores();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.getElementById('cumplimientoVendedoresModal')?.classList.contains('modal-overlay--visible')) {
        cerrarCumplimientoVendedores();
      }
    });
    document.getElementById('btnActualizarAnual')?.addEventListener('click', () => {
      cargarDashboardCompleto().catch(err => {
        console.error('[gerencia]', err);
        alert(`No se pudieron cargar los datos de gerencia. ${err.message}`);
      });
    });

    document.getElementById('yearFilter')?.addEventListener('change', () => {
      cargarDashboardCompleto().catch(err => {
        console.error('[gerencia]', err);
        alert(`No se pudieron cargar los datos de gerencia. ${err.message}`);
      });
    });

    document.getElementById('btnActualizarMensual')?.addEventListener('click', () => {
      cargarDatosMensuales().catch(err => {
        console.error('[gerencia-mensual]', err);
      });
    });
  }

  async function init() {
    if (!token()) {
      window.location.href = '/src/modulo/varios/login/index.html';
      return;
    }

    if (window.Chart?.getChart) {
      ['monthlyComparisonChart', 'categoryChart', 'monthlyCategoryChart'].forEach(id => {
        const existing = window.Chart.getChart(id);
        if (existing) existing.destroy();
      });
    }

    renderYears();
    renderMonths();
    bindEvents();

    try {
      await cargarDashboardCompleto();
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
