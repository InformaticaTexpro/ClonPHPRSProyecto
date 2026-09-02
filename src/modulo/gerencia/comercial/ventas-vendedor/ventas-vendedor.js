'use strict';

(function () {
  const API_BASE = '/api/gerencia/comercial';
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const COLORES = ['#00E2A7', '#4ECDC4', '#45B7D1', '#96CEB4', '#F5A623', '#DDA0DD', '#F06543', '#00B4D8'];
  let graficoEvolucion = null;
  let graficoCategorias = null;
  let graficoClientesNuevos = null;
  let cargando = false;
  let secuencia = 0;
  let secuenciaCotizaciones = 0;
  let secuenciaGuiasPendientes = 0;
  let secuenciaClientesNuevos = 0;
  let cargandoCotizaciones = false;
  let cargandoGuiasPendientes = false;
  let ventasCompartidasDetalle = { items: [], totalVentaCompartida: 0, totalVentaReal: 0 };

  const token = () => localStorage.getItem('token') || '';
  const $ = id => document.getElementById(id);
  const formatCLP = valor => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(valor) || 0);
  const formatCount = valor => new Intl.NumberFormat('es-CL').format(Number(valor) || 0);
  const formatPct = valor => `${new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(valor) || 0)} %`;
  const escapeHtml = valor => String(valor ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

  const CARTERA = [
    { key: 'total', count: 'TotalClientes', label: 'TOTAL CLIENTES', clase: 'total', descripcion: 'Cartera completa asignada', icono: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>' },
    { key: 'activos', count: 'ClientesActivos', label: 'ACTIVOS', clase: 'activo', descripcion: 'Compraron en los últimos 180 días', icono: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>' },
    { key: 'inactivos', count: 'ClientesInactivos', label: 'INACTIVOS', clase: 'inactivo', descripcion: 'Sin compras en los últimos 180 días', icono: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>' },
    { key: 'nuevos', count: 'ClientesNuevos', label: 'NUEVOS', clase: 'nuevo', descripcion: 'Primera compra en el período seleccionado', icono: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>' },
    { key: 'recuperados', count: 'ClientesRecuperados', label: 'RECUPERADOS', clase: 'recuperado', descripcion: 'Volvieron tras 180 días sin compras', icono: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>' },
    { key: 'activosMesActual', count: 'ClientesActivosMesActual', label: 'ACTIVOS MES ACTUAL', clase: 'activo-mes', descripcion: 'Compraron en el período seleccionado', icono: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/><path d="m9 16 2 2 4-4"/>' },
  ];

  async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token()}`, Accept: 'application/json' } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error(body.error || `Error HTTP ${response.status}`);
    return body.data ?? body;
  }

  function setLoading(estado) {
    cargando = estado;
    $('mainWrapper')?.setAttribute('aria-busy', estado ? 'true' : 'false');
    $('gerenciaLoadingOverlay')?.classList.toggle('carga-overlay--visible', estado);
    $('gerenciaLoadingOverlay')?.setAttribute('aria-hidden', estado ? 'false' : 'true');
    document.querySelectorAll('.vendedor-filtros select, .vendedor-filtros button').forEach(control => { control.disabled = estado; });
  }

  function destruirGraficos() {
    graficoEvolucion?.destroy();
    graficoCategorias?.destroy();
    graficoClientesNuevos?.destroy();
    graficoEvolucion = null;
    graficoCategorias = null;
    graficoClientesNuevos = null;
  }

  function mostrarEstadoVacio(mensaje) {
    const panel = $('mensajeVendedor');
    const texto = String(mensaje || '');
    panel.hidden = false;
    if (/seleccione un vendedor/i.test(texto)) {
      $('vendedorEmptyTitulo').textContent = 'Seleccione un vendedor';
      $('vendedorEmptyTexto').textContent = 'Seleccione un vendedor, mes y a\u00f1o para consultar sus indicadores comerciales.';
      $('vendedorEmptyDetalle').textContent = 'Ventas, metas, descuentos, clientes y estad\u00edsticas se cargar\u00e1n al realizar la consulta.';
      return;
    }
    if (/presione actualizar/i.test(texto)) {
      $('vendedorEmptyTitulo').textContent = 'Actualice la consulta';
      $('vendedorEmptyTexto').textContent = 'Presione Actualizar para consultar la selecci\u00f3n actual.';
      $('vendedorEmptyDetalle').textContent = 'La informaci\u00f3n comercial se cargar\u00e1 con los filtros seleccionados.';
      return;
    }
    $('vendedorEmptyTitulo').textContent = /cargando/i.test(texto) ? 'Cargando informaci\u00f3n' : 'No fue posible mostrar la consulta';
    $('vendedorEmptyTexto').textContent = texto;
    $('vendedorEmptyDetalle').textContent = '';
  }

  function limpiarResultados(mensaje) {
    $('dashboardVendedor').hidden = true;
    mostrarEstadoVacio(mensaje);
    destruirGraficos();
    $('carteraCards').innerHTML = '';
    $('codigosBody').innerHTML = '';
    $('codigosFoot').innerHTML = '';
    $('categoriasBody').innerHTML = '<tr><td colspan="3" class="tabla-empty">Sin datos.</td></tr>';
    $('categoriasFoot').innerHTML = '';
    $('progresoFill').style.width = '0%';
    $('kpiCotizacionesTotalValor').textContent = '\u2014';
    $('kpiCotizacionesTotalSubtitulo').textContent = 'Hist\u00f3rico del vendedor';
    $('kpiCotizacionesMesValor').textContent = '\u2014';
    $('kpiCotizacionesMesSubtitulo').textContent = 'Per\u00edodo seleccionado';
    $('kpiGuiasPendientes').textContent = formatCLP(0);
    $('kpiGuiasPendientesFolios').textContent = '0 folios pendientes';
    $('kpiGuiasPendientesCard').setAttribute('aria-label', 'Abrir detalle de Guías Pendientes de Facturar');
    secuenciaClientesNuevos += 1;
    $('clientesNuevosBody').innerHTML = '';
    $('clientesNuevosFoot').innerHTML = '';
    $('clientesNuevosEstado').textContent = '';
    $('clientesNuevosPanel').setAttribute('aria-busy', 'false');
    cerrarCotizaciones();
    cerrarGuiasPendientes();
    cerrarVentasCompartidas();
  }

  function iniciarPeriodo() {
    const hoy = new Date();
    $('monthFilter').innerHTML = MESES.map((nombre, indice) => `<option value="${indice + 1}">${nombre}</option>`).join('');
    $('monthFilter').value = String(hoy.getMonth() + 1);
    $('yearFilter').innerHTML = [hoy.getFullYear() - 2, hoy.getFullYear() - 1, hoy.getFullYear(), hoy.getFullYear() + 1].map(anio => `<option value="${anio}">${anio}</option>`).join('');
    $('yearFilter').value = String(hoy.getFullYear());
    if ($('headerDate')) $('headerDate').textContent = hoy.toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  async function cargarVendedores() {
    try {
      const data = await apiGet('/vendedores-principales');
      $('vendedorFilter').innerHTML = '<option value="">Seleccione un vendedor</option>' + (data.vendedores || []).map(item => `<option value="${item.usuarioId}">${escapeHtml(item.nombre)} (${escapeHtml(item.codigoPrincipal)})</option>`).join('');
    } catch (error) {
      limpiarResultados(error.message || 'No fue posible cargar los vendedores.');
    }
  }

  function renderKpis(data) {
    const resumen = data.resumen || {};
    const totales = data.totales || {};
    const progreso = Number(resumen.progreso) || 0;
    const tieneMeta = Number(resumen.meta) > 0;
    const descuento = Math.max(0, Math.round(Number(totales.pctDescuento ?? resumen.pctDescuentoGlobal) || 0));
    $('kpiTotalVentas').textContent = formatCLP(totales.totalVentasCobrado ?? resumen.totalVentas);
    $('kpiMeta').textContent = formatCLP(resumen.meta);
    $('kpiProgresoPct').textContent = tieneMeta ? `${progreso}%` : '—';
    $('kpiDescuento').textContent = `${descuento}%`;
    const guiasPendientes = data.guiasPendientes || {};
    const foliosPendientes = Number(guiasPendientes.folios) || 0;
    $('kpiGuiasPendientes').textContent = formatCLP(guiasPendientes.total);
    $('kpiGuiasPendientesFolios').textContent = `${formatCount(foliosPendientes)} ${foliosPendientes === 1 ? 'folio pendiente' : 'folios pendientes'}`;
    $('kpiGuiasPendientesCard').setAttribute('aria-label', `Abrir detalle de Guías Pendientes de Facturar: ${formatCount(foliosPendientes)} ${foliosPendientes === 1 ? 'folio' : 'folios'}`);
    const fill = $('progresoFill');
    fill.style.width = `${tieneMeta ? Math.min(Math.max(progreso, 0), 100) : 0}%`;
    fill.style.background = progreso >= 100 ? 'var(--color-primary)' : progreso >= 70 ? 'var(--color-accent)' : 'var(--color-danger)';

    const cotizaciones = data.cotizaciones || {};
    const total = cotizaciones.total || {};
    const mensual = cotizaciones.mes || {};
    $('kpiCotizacionesTotalValor').textContent = formatCount(total.cantidad);
    $('kpiCotizacionesTotalSubtitulo').textContent = Number(total.cantidad) > 0 ? 'Hist\u00f3rico del vendedor' : 'Sin cotizaciones registradas';
    $('kpiCotizacionesMesValor').textContent = formatCount(mensual.cantidad);
    $('kpiCotizacionesMesSubtitulo').textContent = `${MESES[Number($('monthFilter').value) - 1]} ${$('yearFilter').value}`;
  }

  function renderCategoriasTabla(categorias, total) {
    $('categoriasBody').innerHTML = categorias.length ? categorias.map(item => {
      const venta = Number(item.total) || 0;
      return `<tr><td>${escapeHtml(item.categoria) || 'Sin categor\u00eda'}</td><td class="numero">${formatCLP(venta)}</td><td class="numero">${formatPct(item.participacion)}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="tabla-empty">No hay categor\u00edas para mostrar.</td></tr>';
    $('categoriasFoot').innerHTML = `<tr><th>TOTAL</th><th class="numero">${formatCLP(total)}</th><th class="numero">${total > 0 ? '100 %' : '0 %'}</th></tr>`;
  }

  function renderGraficos(data) {
    const evolucion = data.evolucion || [];
    const mes = Number($('monthFilter').value);
    const anio = $('yearFilter').value;
    $('graficoTitulo').textContent = `Evolución Mensual — ${MESES[mes - 1]} ${anio}`;
    graficoEvolucion = new Chart($('chartEvolucion'), {
      type: 'line',
      data: { labels: evolucion.map(item => MESES_CORTOS[Number(item.mes) - 1]), datasets: [
        { label: 'Ventas', data: evolucion.map(item => Number(item.ventas) || 0), borderColor: '#00E2A7', backgroundColor: 'rgba(0,226,167,.08)', tension: .4, fill: true, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5 },
        { label: 'Meta', data: evolucion.map(item => Number(item.meta_mes ?? item.meta) || 0), borderColor: '#F5A623', backgroundColor: 'transparent', borderDash: [6, 4], tension: 0, fill: false, pointRadius: 0, borderWidth: 2 },
      ] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', labels: { font: { family: 'Montserrat', size: 12 }, usePointStyle: true } }, tooltip: { callbacks: { label: context => ` ${context.dataset.label}: ${formatCLP(context.parsed.y)}` } } }, scales: { y: { beginAtZero: true, ticks: { callback: valor => new Intl.NumberFormat('es-CL', { notation: 'compact' }).format(valor) }, grid: { color: 'rgba(0,0,0,.05)' } }, x: { grid: { display: false } } } },
    });

    const categorias = [...(data.categorias || [])].sort((a, b) => (Number(b.total) || 0) - (Number(a.total) || 0));
    renderCategoriasTabla(categorias, Number(data.totalCategorias) || 0);
    graficoCategorias = new Chart($('chartCategorias'), {
      type: 'doughnut',
      data: { labels: categorias.map(item => item.categoria), datasets: [{ data: categorias.map(item => Number(item.total) || 0), backgroundColor: categorias.map((_, index) => COLORES[index % COLORES.length]), borderColor: '#fff', borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { family: 'Montserrat', size: 11 }, usePointStyle: true } }, tooltip: { callbacks: { label: context => ` ${context.label}: ${formatCLP(context.parsed)}` } } } },
    });
  }

  function calendarioAnio(data, anio) {
    const encontrado = (data?.anios || []).find(item => Number(item.anio) === Number(anio));
    if (encontrado) return encontrado;
    return {
      anio: Number(anio),
      meses: Array.from({ length: 12 }, (_, index) => ({ mes: index + 1, cantidad: 0, monto: 0 })),
      totalCantidad: 0,
      totalMonto: 0,
    };
  }

  function renderClientesNuevos(data) {
    const anioAnterior = Number(data?.anioAnterior);
    const anioSeleccionado = Number(data?.anioSeleccionado);
    if (!anioAnterior || !anioSeleccionado) return;

    const anterior = calendarioAnio(data, anioAnterior);
    const actual = calendarioAnio(data, anioSeleccionado);
    const codigoSelect = $('clientesNuevosCodigo');
    codigoSelect.innerHTML = '<option value="">Todos los c\u00f3digos</option>' + (data.codigos || []).map(item => `<option value="${escapeHtml(item.codigo)}">${escapeHtml(item.codigo)} \u00b7 ${escapeHtml(item.nombre)}</option>`).join('');
    codigoSelect.value = data.codigoSeleccionado || '';
    $('clientesNuevosPeriodo').textContent = `${anioAnterior} y ${anioSeleccionado} \u00b7 enero a diciembre`;
    $('clientesCantidadAnterior').textContent = `Clientes ${anioAnterior}`;
    $('clientesVentaAnterior').textContent = `Venta ${anioAnterior}`;
    $('clientesCantidadActual').textContent = `Clientes ${anioSeleccionado}`;
    $('clientesVentaActual').textContent = `Venta ${anioSeleccionado}`;
    $('clientesNuevosEstado').textContent = '';

    $('clientesNuevosBody').innerHTML = MESES.map((mes, index) => {
      const mesAnterior = anterior.meses[index] || {};
      const mesActual = actual.meses[index] || {};
      return `<tr><td>${mes}</td><td class="numero">${formatCount(mesAnterior.cantidad)}</td><td class="numero">${formatCLP(mesAnterior.monto)}</td><td class="numero">${formatCount(mesActual.cantidad)}</td><td class="numero">${formatCLP(mesActual.monto)}</td></tr>`;
    }).join('');
    $('clientesNuevosFoot').innerHTML = `<tr><td><strong>TOTAL</strong></td><td class="numero"><strong>${formatCount(anterior.totalCantidad)}</strong></td><td class="numero"><strong>${formatCLP(anterior.totalMonto)}</strong></td><td class="numero"><strong>${formatCount(actual.totalCantidad)}</strong></td><td class="numero"><strong>${formatCLP(actual.totalMonto)}</strong></td></tr>`;

    graficoClientesNuevos?.destroy();
    graficoClientesNuevos = new Chart($('chartClientesNuevos'), {
      type: 'line',
      data: {
        labels: MESES,
        datasets: [
          { label: `Clientes ${anioAnterior}`, data: anterior.meses.map(item => Number(item.cantidad) || 0), borderColor: '#4B6A9B', backgroundColor: 'rgba(75,106,155,.08)', borderDash: [5, 4], borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, tension: .3, fill: false },
          { label: `Clientes ${anioSeleccionado}`, data: actual.meses.map(item => Number(item.cantidad) || 0), borderColor: '#00A982', backgroundColor: 'rgba(0,169,130,.08)', borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, tension: .3, fill: false },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { font: { family: 'Montserrat', size: 10 }, usePointStyle: true } },
          tooltip: { callbacks: { label: context => ` ${context.dataset.label}: ${formatCount(context.parsed.y)}` } },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Clientes nuevos' }, grid: { color: 'rgba(0,0,0,.05)' } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  async function cargarClientesNuevosPorCodigo() {
    const vendedorId = Number($('vendedorFilter').value);
    if (!vendedorId) return;
    const requestId = ++secuenciaClientesNuevos;
    const select = $('clientesNuevosCodigo');
    const codigo = select.value;
    select.disabled = true;
    $('clientesNuevosPanel').setAttribute('aria-busy', 'true');
    $('clientesNuevosEstado').textContent = 'Cargando comparativo...';
    $('clientesNuevosBody').innerHTML = '';
    $('clientesNuevosFoot').innerHTML = '';
    graficoClientesNuevos?.destroy();
    graficoClientesNuevos = null;
    try {
      const params = new URLSearchParams({ vendedorId: String(vendedorId), anio: $('yearFilter').value });
      if (codigo) params.set('codVendedor', codigo);
      const data = await apiGet(`/ventas-vendedor/clientes-nuevos?${params}`);
      if (requestId === secuenciaClientesNuevos) renderClientesNuevos(data);
    } catch (error) {
      if (requestId === secuenciaClientesNuevos) $('clientesNuevosEstado').textContent = error.message || 'No fue posible cargar clientes nuevos.';
    } finally {
      if (requestId === secuenciaClientesNuevos) {
        select.disabled = false;
        $('clientesNuevosPanel').setAttribute('aria-busy', 'false');
      }
    }
  }

  function detalleCliente(cliente, tipo) {
    if (tipo === 'nuevos' && cliente.FechaPrimeraCompra) return `Primera compra: ${escapeHtml(cliente.FechaPrimeraCompra)}`;
    if (tipo === 'recuperados' && cliente.DiasInactividadPrevia !== null) return `${formatCount(cliente.DiasInactividadPrevia)} días sin compras · última compra previa ${escapeHtml(cliente.FechaUltimaCompraPrevia || '—')}`;
    return cliente.FechaUltimaCompra ? `Última compra: ${escapeHtml(cliente.FechaUltimaCompra)}` : '';
  }

  function filasCartera(clientes, tipo) {
    if (!clientes.length) return '<tr class="tabla-empty"><td colspan="5">Sin clientes para esta clasificación.</td></tr>';
    return clientes.map(cliente => {
      const meta = detalleCliente(cliente, tipo);
      const telefono1 = cliente.FONAUX1 ? `<a href="tel:${escapeHtml(cliente.FONAUX1)}">${escapeHtml(cliente.FONAUX1)}</a>` : '—';
      const telefono2 = cliente.FonAux2 ? `<a href="tel:${escapeHtml(cliente.FonAux2)}">${escapeHtml(cliente.FonAux2)}</a>` : '—';
      const email = cliente.EMail ? `<a href="mailto:${escapeHtml(cliente.EMail)}">${escapeHtml(cliente.EMail)}</a>` : '—';
      return `<tr><td><code>${escapeHtml(cliente.CodAux) || '—'}</code></td><td>${escapeHtml(cliente.NomAux) || '—'}${meta ? `<small class="cartera-card-meta">${meta}</small>` : ''}</td><td>${telefono1}</td><td>${telefono2}</td><td>${email}</td></tr>`;
    }).join('');
  }

  function renderCartera(cartera) {
    const container = $('carteraCards');
    container.innerHTML = CARTERA.map(definicion => {
      const clientes = Array.isArray(cartera?.[definicion.key]) ? cartera[definicion.key] : [];
      const count = cartera?.[definicion.count] ?? clientes.length;
      return `<article class="cartera-card cartera-card--${definicion.clase}">
        <button class="cartera-card-btn" type="button" data-cartera-toggle aria-expanded="false">
          <span class="cartera-card-icono"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${definicion.icono}</svg></span>
          <span class="cartera-card-info"><span class="cartera-card-label">${definicion.label}</span><strong class="cartera-card-count">${formatCount(count)}</strong><span class="cartera-card-desc">${definicion.descripcion}</span></span>
          <svg class="cartera-chevron" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="cartera-lista" hidden><div class="cartera-lista-busqueda"><input type="search" class="cartera-busqueda-input" placeholder="Buscar cliente..." aria-label="Buscar en ${definicion.label.toLowerCase()}" /></div><div class="cartera-tabla-wrapper"><table class="cartera-tabla"><thead><tr><th>Cód. Cliente</th><th>Nombre</th><th>Teléfono 1</th><th>Teléfono 2</th><th>Email</th></tr></thead><tbody data-cartera-body>${filasCartera(clientes, definicion.key)}</tbody></table></div></div>
      </article>`;
    }).join('');

    container.querySelectorAll('.cartera-card').forEach((card, index) => {
      const definicion = CARTERA[index];
      const clientes = Array.isArray(cartera?.[definicion.key]) ? cartera[definicion.key] : [];
      const toggle = card.querySelector('[data-cartera-toggle]');
      const lista = card.querySelector('.cartera-lista');
      const body = card.querySelector('[data-cartera-body]');
      toggle.addEventListener('click', () => {
        const abrir = lista.hidden;
        lista.hidden = !abrir;
        toggle.setAttribute('aria-expanded', abrir ? 'true' : 'false');
        card.classList.toggle('cartera-card--abierta', abrir);
      });
      card.querySelector('.cartera-busqueda-input').addEventListener('input', event => {
        const texto = event.target.value.trim().toLowerCase();
        const filtrados = texto ? clientes.filter(cliente => [cliente.CodAux, cliente.NomAux, cliente.FONAUX1, cliente.FonAux2, cliente.EMail].some(valor => String(valor || '').toLowerCase().includes(texto))) : clientes;
        body.innerHTML = filasCartera(filtrados, definicion.key);
      });
    });
  }

  function renderCodigos(data) {
    const vendedores = data.vendedores || [];
    const totales = data.totales || {};
    ventasCompartidasDetalle = data.ventasCompartidas || { items: [], totalVentaCompartida: 0, totalVentaReal: 0 };
    $('codigosBody').innerHTML = vendedores.length ? vendedores.map(item => `<tr><td><code>${escapeHtml(item.codVendedor)}</code></td><td>${escapeHtml(item.nombreVendedor)}</td><td>${formatCount(item.totalFolios)}</td><td class="numero">${formatCLP(item.totalVentasCobrado)}</td><td class="numero">${formatCLP(item.ventaRealLista)}</td><td class="numero">${Math.round(Number(item.pctDescuento) || 0)}%</td></tr>`).join('') : '<tr><td colspan="6" class="tabla-empty">Sin ventas para el período.</td></tr>';
    $('codigosFoot').innerHTML = vendedores.length ? `<tr><td colspan="3"><strong>Total consolidado</strong></td><td class="numero"><strong>${formatCLP(totales.totalVentasCobrado)}</strong></td><td class="numero"><strong>${formatCLP(totales.ventaRealLista)}</strong></td><td class="numero"><strong>${Math.round(Number(totales.pctDescuento) || 0)}%</strong></td></tr>` : '';
    Array.from($('codigosBody').rows).forEach((row, index) => row.classList.toggle('ventas-asignadas-row', Boolean(vendedores[index]?.esAsignada)));
    const sharedIndex = vendedores.findIndex(item => item.esAsignada);
    const sharedRow = sharedIndex >= 0 ? $('codigosBody').rows[sharedIndex] : null;
    if (sharedRow) {
      sharedRow.classList.add('ventas-compartidas-row');
      sharedRow.tabIndex = 0;
      sharedRow.setAttribute('role', 'button');
      sharedRow.setAttribute('aria-label', 'Abrir detalle de Ventas Compartidas TA');
      sharedRow.addEventListener('click', abrirVentasCompartidas);
      sharedRow.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          abrirVentasCompartidas();
        }
      });
    }
  }

  function cerrarVentasCompartidas() {
    const modal = $('ventasCompartidasModal');
    if (!modal) return;
    modal.classList.remove('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function cerrarGuiasPendientes() {
    const modal = $('guiasPendientesModal');
    if (!modal) return;
    secuenciaGuiasPendientes += 1;
    cargandoGuiasPendientes = false;
    modal.classList.remove('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    $('kpiGuiasPendientesCard').disabled = false;
  }

  function guiaPendienteFila(item) {
    return `<tr><td><code>${escapeHtml(item.numero) || '\u2014'}</code></td><td class="guias-pendientes-fecha">${escapeHtml(item.fecha) || '\u2014'}</td><td>${escapeHtml(item.cliente || item.codigoCliente) || '\u2014'}</td><td class="numero">${formatCLP(item.monto)}</td></tr>`;
  }

  async function abrirGuiasPendientes() {
    if (cargandoGuiasPendientes) return;
    const vendedorId = Number($('vendedorFilter').value);
    if (!vendedorId) return;

    const mes = $('monthFilter').value;
    const anio = $('yearFilter').value;
    const periodo = `${MESES[Number(mes) - 1]} ${anio}`;
    const vendedor = $('vendedorFilter').selectedOptions[0]?.textContent?.trim() || 'Vendedor seleccionado';
    const modal = $('guiasPendientesModal');
    const requestId = ++secuenciaGuiasPendientes;
    cargandoGuiasPendientes = true;
    $('kpiGuiasPendientesCard').disabled = true;
    $('guiasPendientesModalSubtitulo').textContent = `${periodo} \u00b7 ${vendedor}`;
    $('guiasPendientesModalEstado').textContent = 'Cargando guías pendientes...';
    $('guiasPendientesModalBody').innerHTML = '';
    $('guiasPendientesModalFoot').innerHTML = '';
    $('guiasPendientesModalCantidad').textContent = '0 guías pendientes';
    $('guiasPendientesModalMonto').textContent = formatCLP(0);
    modal.classList.add('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    try {
      const params = new URLSearchParams({ vendedorId: String(vendedorId), mes, anio });
      const data = await apiGet(`/ventas-vendedor/guias-pendientes?${params}`);
      if (requestId !== secuenciaGuiasPendientes) return;
      const items = Array.isArray(data.items) ? data.items : [];
      const cantidad = Number(data.cantidad) || 0;
      const monto = Number(data.monto) || 0;
      $('guiasPendientesModalEstado').textContent = items.length ? '' : 'No existen guías pendientes de facturar para el período seleccionado.';
      $('guiasPendientesModalBody').innerHTML = items.map(guiaPendienteFila).join('');
      $('guiasPendientesModalFoot').innerHTML = items.length ? `<tr><th colspan="3">TOTAL \u00b7 ${formatCount(cantidad)} ${cantidad === 1 ? 'guía pendiente' : 'guías pendientes'}</th><th class="numero">${formatCLP(monto)}</th></tr>` : '';
      $('guiasPendientesModalCantidad').textContent = `${formatCount(cantidad)} ${cantidad === 1 ? 'guía pendiente' : 'guías pendientes'}`;
      $('guiasPendientesModalMonto').textContent = formatCLP(monto);
    } catch (error) {
      if (requestId === secuenciaGuiasPendientes) $('guiasPendientesModalEstado').textContent = error.message || 'No fue posible cargar las guías pendientes.';
    } finally {
      if (requestId === secuenciaGuiasPendientes) {
        cargandoGuiasPendientes = false;
        $('kpiGuiasPendientesCard').disabled = false;
        $('guiasPendientesModalCerrar')?.focus();
      }
    }
  }

  function abrirVentasCompartidas() {
    const modal = $('ventasCompartidasModal');
    const items = Array.isArray(ventasCompartidasDetalle.items) ? ventasCompartidasDetalle.items : [];
    const total = Number(ventasCompartidasDetalle.totalVentaCompartida) || 0;
    $('ventasCompartidasModalPeriodo').textContent = `${MESES[Number($('monthFilter').value) - 1]} ${$('yearFilter').value}`;
    $('ventasCompartidasModalEstado').textContent = items.length ? '' : 'No existen Ventas Compartidas TA para el período seleccionado.';
    $('ventasCompartidasModalBody').innerHTML = items.map(item => `<tr><td>${escapeHtml(item.vendedorOrigen) || '\u2014'}</td><td class="ventas-compartidas-codigo"><code>${escapeHtml(item.codigo) || '\u2014'}</code></td><td class="numero">${formatCLP(item.ventaReal)}</td><td class="numero">${formatCLP(item.ventaCompartida)}</td><td class="numero">${formatPct(item.participacion)}</td></tr>`).join('');
    $('ventasCompartidasModalFoot').innerHTML = items.length ? `<tr><th>TOTAL</th><th></th><th class="numero">${formatCLP(ventasCompartidasDetalle.totalVentaReal)}</th><th class="numero">${formatCLP(total)}</th><th class="numero">${total > 0 ? '100 %' : '0 %'}</th></tr>` : '';
    $('ventasCompartidasModalTotal').textContent = formatCLP(total);
    modal.classList.add('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    $('ventasCompartidasModalCerrar')?.focus();
  }

  function cerrarCotizaciones() {
    const modal = $('cotizacionesModal');
    if (!modal) return;
    secuenciaCotizaciones += 1;
    cargandoCotizaciones = false;
    modal.classList.remove('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.querySelectorAll('[data-cotizaciones-modo]').forEach(button => { button.disabled = false; });
  }

  function cotizacionFila(item) {
    const cliente = escapeHtml(item.cliente) || '\u2014';
    const codigo = escapeHtml(item.codigoCliente);
    return `<tr><td><code>${escapeHtml(item.numero) || '\u2014'}</code></td><td>${escapeHtml(item.fecha) || '\u2014'}</td><td>${cliente}${codigo ? `<small class="cotizaciones-cliente-codigo">C\u00f3d. ${codigo}</small>` : ''}</td><td class="numero">${formatCLP(item.monto)}</td><td>${escapeHtml(item.estado) || '\u2014'}</td></tr>`;
  }

  async function abrirCotizaciones(modo) {
    if (cargandoCotizaciones || !['historico', 'mensual'].includes(modo)) return;
    const vendedorId = Number($('vendedorFilter').value);
    if (!vendedorId) return;

    const mensual = modo === 'mensual';
    const periodo = `${MESES[Number($('monthFilter').value) - 1]} ${$('yearFilter').value}`;
    const modal = $('cotizacionesModal');
    const requestId = ++secuenciaCotizaciones;
    cargandoCotizaciones = true;
    document.querySelectorAll('[data-cotizaciones-modo]').forEach(button => { button.disabled = true; });
    $('cotizacionesModalTitulo').textContent = mensual ? `Cotizaciones del mes \u2014 ${periodo}` : 'Cotizaciones totales';
    $('cotizacionesModalSubtitulo').textContent = mensual ? 'Vendedor y c\u00f3digos asociados del per\u00edodo' : 'Hist\u00f3rico del vendedor y sus c\u00f3digos asociados';
    $('cotizacionesModalEstado').textContent = 'Cargando cotizaciones...';
    $('cotizacionesModalBody').innerHTML = '';
    $('cotizacionesModalCantidad').textContent = '0';
    $('cotizacionesModalMonto').textContent = formatCLP(0);
    modal.classList.add('modal-overlay--visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    try {
      const params = new URLSearchParams({ vendedorId: String(vendedorId), modo });
      if (mensual) {
        params.set('mes', $('monthFilter').value);
        params.set('anio', $('yearFilter').value);
      }
      const data = await apiGet(`/ventas-vendedor/cotizaciones?${params}`);
      if (requestId !== secuenciaCotizaciones) return;
      const items = Array.isArray(data.items) ? data.items : [];
      $('cotizacionesModalEstado').textContent = items.length ? '' : (mensual ? `No existen cotizaciones para ${periodo}.` : 'No existen cotizaciones para el vendedor seleccionado.');
      $('cotizacionesModalBody').innerHTML = items.map(cotizacionFila).join('');
      $('cotizacionesModalCantidad').textContent = formatCount(data.cantidad);
      $('cotizacionesModalMonto').textContent = formatCLP(data.monto);
    } catch (error) {
      if (requestId === secuenciaCotizaciones) $('cotizacionesModalEstado').textContent = error.message || 'No fue posible cargar las cotizaciones.';
    } finally {
      if (requestId === secuenciaCotizaciones) {
        cargandoCotizaciones = false;
        document.querySelectorAll('[data-cotizaciones-modo]').forEach(button => { button.disabled = false; });
      }
    }
  }

  function render(data) {
    renderKpis(data);
    renderGraficos(data);
    renderCartera(data.cartera || {});
    renderClientesNuevos(data.clientesNuevosCalendario || {});
    renderCodigos(data);
    $('dashboardVendedor').hidden = false;
    $('mensajeVendedor').hidden = true;
    $('headerIndicadores').textContent = `${MESES[Number($('monthFilter').value) - 1]} ${$('yearFilter').value}`;
  }

  async function actualizar() {
    if (cargando) return;
    const vendedorId = Number($('vendedorFilter').value);
    if (!vendedorId) {
      limpiarResultados('Seleccione un vendedor.');
      $('vendedorFilter').focus();
      return;
    }

    const cargaActual = ++secuencia;
    limpiarResultados('Cargando información comercial...');
    setLoading(true);
    try {
      const params = new URLSearchParams({ vendedorId: String(vendedorId), mes: $('monthFilter').value, anio: $('yearFilter').value });
      const data = await apiGet(`/ventas-vendedor?${params}`);
      if (cargaActual === secuencia) render(data);
    } catch (error) {
      if (cargaActual === secuencia) limpiarResultados(error.message || 'No fue posible cargar la información.');
    } finally {
      if (cargaActual === secuencia) setLoading(false);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    iniciarPeriodo();
    cargarVendedores();
    $('btnActualizar')?.addEventListener('click', actualizar);
    $('kpiGuiasPendientesCard')?.addEventListener('click', abrirGuiasPendientes);
    document.querySelectorAll('[data-cotizaciones-modo]').forEach(button => button.addEventListener('click', () => abrirCotizaciones(button.dataset.cotizacionesModo)));
    $('cotizacionesModalCerrar')?.addEventListener('click', cerrarCotizaciones);
    $('cotizacionesModal')?.addEventListener('click', event => { if (event.target === $('cotizacionesModal')) cerrarCotizaciones(); });
    $('guiasPendientesModalCerrar')?.addEventListener('click', cerrarGuiasPendientes);
    $('guiasPendientesModal')?.addEventListener('click', event => { if (event.target === $('guiasPendientesModal')) cerrarGuiasPendientes(); });
    $('ventasCompartidasModalCerrar')?.addEventListener('click', cerrarVentasCompartidas);
    $('ventasCompartidasModal')?.addEventListener('click', event => { if (event.target === $('ventasCompartidasModal')) cerrarVentasCompartidas(); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if ($('cotizacionesModal')?.classList.contains('modal-overlay--visible')) cerrarCotizaciones();
      if ($('guiasPendientesModal')?.classList.contains('modal-overlay--visible')) cerrarGuiasPendientes();
      if ($('ventasCompartidasModal')?.classList.contains('modal-overlay--visible')) cerrarVentasCompartidas();
    });
    $('clientesNuevosCodigo')?.addEventListener('change', cargarClientesNuevosPorCodigo);
    ['vendedorFilter', 'monthFilter', 'yearFilter'].forEach(id => $(id)?.addEventListener('change', () => {
      secuencia += 1;
      setLoading(false);
      limpiarResultados(id === 'vendedorFilter' && !$(id).value ? 'Seleccione un vendedor para consultar sus indicadores.' : 'Presione Actualizar para consultar la selección actual.');
    }));
  });
})();
