'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(Number(value) || 0);
  const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const date = value => value ? value.split('-').reverse().join('/') : '—';
  const today = new Date();
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const states = { C: 'Concluida', N: 'Nula', A: 'Aprobada', P: 'Pendiente' };
  const segmentNames = { critica: 'Crítica', atencion: 'Atención', plazo: 'En plazo' };
  const charts = new Map(), alertCache = new Map(), detailCache = new Map();
  const controllers = {}, sequences = { dashboard: 0, alert: 0, detail: 0 };
  let applied = null, vendorsLoaded = false, activeSegment = null;
  $('headerDate').textContent = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long' }).format(today);
  $('nvFrom').value = `${today.getFullYear()}-01-01`;
  $('nvTo').value = localDate(today);

  async function api(path, params, signal) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
    const response = await fetch(`/api/cobranza/control-notas-venta${path}?${query}`, { signal,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' } });
    const body = await response.json().catch(() => { throw new Error('El servidor no devolvió una respuesta válida.'); });
    if (!response.ok || body.ok === false) throw new Error(body.error || `Error HTTP ${response.status}`);
    return body;
  }

  function status(id, message, error = false) {
    $(id).textContent = message;
    $(id).classList.toggle('nv-status--error', error);
  }

  function startRequest(scope) {
    controllers[scope]?.abort();
    controllers[scope] = new AbortController();
    return { signal: controllers[scope].signal, sequence: ++sequences[scope] };
  }

  function dashboardLoading(loading, initial = false) {
    $('nvLoading').hidden = !loading;
    $('nvModule').setAttribute('aria-busy', String(loading));
    $('nvContent').inert = loading;
    $('nvUpdate').disabled = loading;
    $('nvUpdate').textContent = loading ? (initial ? 'Cargando...' : 'Actualizando...') : 'Actualizar';
    $('nvLoadingText').textContent = initial ? 'Cargando control de Notas de Venta...' : 'Actualizando información...';
  }

  function localLoading(scope, loading) {
    const prefix = scope === 'alert' ? 'nvAlert' : 'nvDetail';
    $(`${prefix}Loading`).hidden = !loading;
    $(`${prefix}Content`).inert = loading;
    $(`${prefix}Pager`).inert = loading;
    $(`${prefix}Content`).hidden = loading;
    $(`${prefix}Pager`).hidden = loading;
    $(scope === 'alert' ? 'nvAlertDialog' : 'nvDetailSection').setAttribute('aria-busy', String(loading));
    if (scope === 'detail') $('nvShowDetail').disabled = loading || !applied;
  }

  function cacheKey(filters, segment, page) {
    return JSON.stringify([filters.desde, filters.hasta, filters.vendedor, filters.diasAtencion, filters.diasCritica, segment, page]);
  }

  function segmentRange(segment, filters) {
    if (segment === 'critica') return `≥ ${number(filters.diasCritica)} días`;
    if (segment === 'atencion') return `${number(filters.diasAtencion)} a ${number(filters.diasCritica - 1)} días`;
    return `< ${number(filters.diasAtencion)} días`;
  }

  async function loadDashboard(initial = false) {
    $('nvTo').setCustomValidity($('nvFrom').value > $('nvTo').value ? 'Desde no puede ser posterior a Hasta.' : '');
    $('nvCritical').setCustomValidity(Number($('nvCritical').value) <= Number($('nvAttention').value) ? 'Crítica debe ser mayor que Atención.' : '');
    if (!$('nvFilters').reportValidity()) return;
    const params = Object.fromEntries(new FormData($('nvFilters')));
    if (!vendorsLoaded) params.incluirVendedores = '1';
    const request = startRequest('dashboard');
    controllers.alert?.abort(); controllers.detail?.abort(); sequences.alert++; sequences.detail++;
    $('nvAlertDialog').close(); localLoading('alert', false); localLoading('detail', false);
    dashboardLoading(true, initial);
    status('nvStatus', 'Consultando resumen de cabeceras...');
    try {
      const result = await api('', params, request.signal);
      if (request.sequence !== sequences.dashboard) return;
      const alerts = Object.values(result.alertas);
      if (!result.conciliado || alerts.reduce((sum, a) => sum + a.cantidad, 0) !== result.kpis.pendientes.cantidad
        || Math.abs(alerts.reduce((sum, a) => sum + a.monto, 0) - result.kpis.pendientes.monto) >= .01) throw new Error('Las alertas no concilian con las NV pendientes.');
      applied = result.filtros;
      if (!vendorsLoaded && result.vendedores) {
        $('nvVendor').innerHTML = '<option value="">Todos los vendedores</option>' + result.vendedores.map(v => `<option value="${Number(v.usuarioId)}">${escape(v.nombre)}</option>`).join('');
        $('nvVendor').value = applied.vendedor;
        vendorsLoaded = true;
      }
      // Actualizar es una solicitud explícita de datos vigentes; los cierres del modal conservan la caché.
      alertCache.clear(); detailCache.clear();
      renderDashboard(result);
      $('nvRangeWarning').hidden = true;
      $('nvDetailContent').innerHTML = ''; $('nvDetailPager').innerHTML = '';
      status('nvDetailStatus', 'El detalle se consulta solo al solicitarlo.');
      $('nvShowDetail').disabled = false;
      const vendor = $('nvVendor').selectedOptions[0]?.textContent || 'Todos los vendedores';
      status('nvStatus', `${date(applied.desde)} al ${date(applied.hasta)} · ${vendor} · Antigüedad respecto de hoy. Las tres alertas concilian con pendientes.${window.Chart ? '' : ' No fue posible cargar la biblioteca de gráficos.'}`, !window.Chart);
    } catch (error) {
      if (request.sequence === sequences.dashboard && error.name !== 'AbortError') status('nvStatus', `No fue posible cargar Control de Notas de Venta. ${error.message} Presione Actualizar para reintentar.`, true);
    } finally { if (request.sequence === sequences.dashboard) dashboardLoading(false); }
  }

  function renderDashboard(result) {
    for (const [key, prefix] of [['emitidas', 'nvIssued'], ['concluidas', 'nvClosed'], ['pendientes', 'nvPending'], ['nulas', 'nvVoid']]) {
      $(`${prefix}Count`).textContent = number(result.kpis[key].cantidad);
      $(`${prefix}Amount`).textContent = money(result.kpis[key].monto);
    }
    $('nvClosedHint').textContent = `${number(result.indicadores.porcentajeConclusion)} % de las emitidas`;
    $('nvClosedInvoiced').textContent = `${number(result.kpis.facturadas.cantidad)} NV · ${money(result.kpis.facturadas.monto)}`;
    $('nvClosedCleanup').textContent = `${number(result.kpis.cierreLimpieza.cantidad)} NV · ${money(result.kpis.cierreLimpieza.monto)}`;
    $('nvPendingHint').textContent = `Aprobadas: ${number(result.kpis.aprobadas.cantidad)} · Pendientes: ${number(result.kpis.sinAprobar.cantidad)}`;
    for (const [segment, prefix] of [['critica', 'nvCritical'], ['atencion', 'nvAttention'], ['plazo', 'nvNormal']]) {
      const alert = result.alertas[segment];
      $(`${prefix}Count`).textContent = number(alert.cantidad);
      $(`${prefix}Amount`).textContent = money(alert.monto);
      $(`${prefix}Hint`).textContent = `${segmentRange(segment, applied)}${segment === 'critica' ? ` · Más antigua: ${alert.masAntigua == null ? '—' : `${number(alert.masAntigua)} días`}` : ''}`;
      document.querySelector(`[data-segment="${segment}"]`).disabled = alert.cantidad === 0;
    }
    $('nvAverageAge').textContent = `${number(result.indicadores.edadPromedio)} días`;
    $('nvOldest').textContent = result.indicadores.masAntigua == null ? '—' : `${number(result.indicadores.masAntigua)} días`;
    $('nvAverageTicket').textContent = money(result.indicadores.ticketPromedio);
    $('nvClosedRate').textContent = `${number(result.indicadores.porcentajeConclusion)} %`;
    $('nvEvolutionHint').textContent = `${result.agrupacion === 'diaria' ? 'Agrupación diaria' : 'Agrupación mensual'} · Cantidades y montos en tooltip${result.evolucion.length ? '' : ' · Sin notas en el período'}`;
    $('nvRankTitle').textContent = result.rankingTipo === 'clientes' ? 'Top clientes con NV pendientes' : 'Pendientes por vendedor';
    $('nvRankHint').textContent = `${result.rankingTipo === 'clientes' ? 'Hasta 10 mayores montos pendientes' : 'Todos los vendedores con pendientes, por monto descendente'} · Aprobadas y Pendientes${result.ranking.length ? '' : ' · Sin pendientes'}`;
    $('nvRankChart').parentElement.style.height = `${Math.max(340, result.ranking.length * 28 + 45)}px`;
    if (!window.Chart) return;
    const evolution = result.evolucion;
    const datasets = [['emitidas', 'montoEmitidas', 'Emitidas', '#00a885', 'bar'], ['concluidas', 'montoConcluidas', 'Concluidas', '#268fb6', 'line'], ['pendientes', 'montoPendientes', 'Pendientes fact.', '#c08a29', 'line']].map(([key, amount, label, color, type]) => ({
      type, label, data: evolution.map(row => row[key]), montos: evolution.map(row => row[amount]), borderColor: color, backgroundColor: type === 'bar' ? '#00a88555' : color, borderRadius: 4, tension: .2, pointRadius: 2,
    }));
    const options = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${number(c.raw)} NV · ${money(c.dataset.montos[c.dataIndex])}` } } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } } };
    drawChart('nvEvolutionChart', { type: 'bar', data: { labels: evolution.map(row => result.agrupacion === 'diaria' ? date(row.periodo) : `${row.periodo.slice(5, 7)}/${row.periodo.slice(0, 4)}`), datasets }, options });
    const segments = ['critica', 'atencion', 'plazo'];
    drawChart('nvAgeChart', { type: 'bar', data: { labels: segments.map(s => segmentNames[s]), datasets: [{ label: 'NV pendientes', data: segments.map(s => result.alertas[s].cantidad), backgroundColor: ['#d66b6b', '#d8ab4b', '#00a885'], borderRadius: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${number(c.raw)} NV · ${money(result.alertas[segments[c.dataIndex]].monto)}` } } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } });
    drawChart('nvRankChart', { type: 'bar', data: { labels: result.ranking.map(row => row.nombre.length > 32 ? `${row.nombre.slice(0, 29)}...` : row.nombre), datasets: [{ label: 'Monto pendiente', data: result.ranking.map(row => row.monto), backgroundColor: '#268fb699', borderRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => result.ranking[items[0].dataIndex]?.nombre || '', label: c => `${money(c.raw)} · ${number(result.ranking[c.dataIndex].cantidad)} NV` } } }, scales: { x: { beginAtZero: true, ticks: { callback: value => `$${number(value / 1000000)} M` } } } } });
  }

  function drawChart(id, config) {
    const chart = charts.get(id);
    if (chart) { chart.data = config.data; chart.options = config.options; chart.update(); }
    else charts.set(id, new Chart($(id), config));
  }

  function renderNotes(result, detailed) {
    const headers = detailed ? ['NV', 'Fecha', 'Días', 'Estado', 'Cliente', 'Vendedor', 'OC', 'Monto Neto'] : ['Folio', 'Fecha', 'Cliente', 'Vendedor', 'Monto Neto'];
    return `<table class="nv-table"><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${result.notas.map(note => {
      const cells = detailed ? [escape(note.NVNumero), date(note.fecha), number(note.dias), `<span class="nv-badge nv-badge--${['C', 'N', 'A', 'P'].includes(note.estado) ? note.estado : 'other'}">${escape(states[note.estado] || note.estado || 'Sin estado')}</span>`, escape(note.cliente), escape(note.vendedor), escape(note.oc || '—'), money(note.monto)]
        : [escape(note.NVNumero), date(note.fecha), escape(note.cliente), escape(note.vendedor), money(note.monto)];
      return `<tr>${cells.map((cell, i) => `<td data-label="${headers[i]}">${cell}</td>`).join('')}</tr>`;
    }).join('') || `<tr><td colspan="${headers.length}" class="nv-empty">No hay Notas de Venta para esta consulta.</td></tr>`}</tbody></table>`;
  }

  function renderPager(result, scope) {
    const from = result.cantidad ? (result.pagina - 1) * result.tamanoPagina + 1 : 0;
    return `<span>${number(from)}–${number(Math.min(result.pagina * result.tamanoPagina, result.cantidad))} de ${number(result.cantidad)} NV</span><div><button type="button" class="nv-button nv-button--light" data-page="${result.pagina - 1}" data-scope="${scope}"${result.pagina <= 1 ? ' disabled' : ''}>Anterior</button><button type="button" class="nv-button nv-button--light" data-page="${result.pagina + 1}" data-scope="${scope}"${result.hayMas ? '' : ' disabled'}>Siguiente</button></div>`;
  }

  async function loadNotes(scope, page = 1, segment = activeSegment) {
    if (!applied) return;
    const snapshot = applied;
    const request = startRequest(scope);
    const prefix = scope === 'alert' ? 'nvAlert' : 'nvDetail';
    const isAlert = scope === 'alert';
    const cache = isAlert ? alertCache : detailCache;
    const key = cacheKey(snapshot, isAlert ? segment : 'todas', page);
    if (isAlert) {
      activeSegment = segment;
      $('nvAlertTotals').textContent = '';
      $('nvAlertTitle').textContent = `Alerta ${segmentNames[segment]} · ${segmentRange(segment, snapshot)}`;
      if (!$('nvAlertDialog').open) $('nvAlertDialog').showModal();
    }
    localLoading(scope, true);
    status(`${prefix}Status`, '');
    try {
      const result = cache.get(key) || await api(isAlert ? '/alerta' : '/detalle', { ...snapshot, pagina: page, ...(isAlert ? { segmento: segment } : {}) }, request.signal);
      if (request.sequence !== sequences[scope] || applied !== snapshot) return;
      cache.set(key, result);
      $(`${prefix}Content`).innerHTML = renderNotes(result, !isAlert);
      $(`${prefix}Pager`).innerHTML = renderPager(result, scope);
      const totals = `${number(result.cantidad)} Notas de Venta · Neto ${money(result.montoTotal)}`;
      if (isAlert) $('nvAlertTotals').textContent = totals;
      else status('nvDetailStatus', totals);
    } catch (error) {
      if (request.sequence === sequences[scope] && error.name !== 'AbortError') {
        $(`${prefix}Content`).innerHTML = ''; $(`${prefix}Pager`).innerHTML = '';
        status(`${prefix}Status`, `No fue posible cargar las Notas de Venta. ${error.message} ${isAlert ? 'Cierre y vuelva a abrir la alerta para reintentar.' : 'Presione Ver detalle para reintentar.'}`, true);
      }
    } finally { if (request.sequence === sequences[scope]) localLoading(scope, false); }
  }

  $('nvFilters').addEventListener('submit', event => { event.preventDefault(); loadDashboard(); });
  ['nvFrom', 'nvTo', 'nvAttention', 'nvCritical'].forEach(id => $(id).addEventListener('input', () => { $('nvTo').setCustomValidity(''); $('nvCritical').setCustomValidity(''); }));
  document.querySelectorAll('[data-segment]').forEach(button => button.addEventListener('click', () => loadNotes('alert', 1, button.dataset.segment)));
  $('nvCloseAlert').addEventListener('click', () => $('nvAlertDialog').close());
  $('nvAlertDialog').addEventListener('close', () => { controllers.alert?.abort(); sequences.alert++; localLoading('alert', false); });
  $('nvShowDetail').addEventListener('click', () => {
    if (!applied) return;
    if (applied.diasRango > 90) {
      $('nvRangeText').textContent = `El rango seleccionado comprende ${number(applied.diasRango)} días. La consulta del detalle puede tardar algunos segundos.`;
      $('nvRangeWarning').classList.toggle('nv-warning--strong', applied.diasRango > 365);
      $('nvRangeWarning').hidden = false;
    } else loadNotes('detail');
  });
  $('nvConfirmDetail').addEventListener('click', () => { $('nvRangeWarning').hidden = true; loadNotes('detail'); });
  ['nvAlertPager', 'nvDetailPager'].forEach(id => $(id).addEventListener('click', event => {
    const button = event.target.closest('[data-page]');
    if (button && !button.disabled) loadNotes(button.dataset.scope, Number(button.dataset.page));
  }));
  (async () => {
    try {
      const context = await window.appSidebarReady;
      if (!context) throw new Error('No fue posible cargar sesión y navegación. Recargue la página para reintentar.');
      await loadDashboard(true);
    } catch (error) { status('nvStatus', error.message, true); dashboardLoading(false); }
  })();
})();
