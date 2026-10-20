'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 4 }).format(Number(value) || 0);
  const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const percent = value => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(Number(value) || 0)} %`;
  const date = value => value ? String(value).slice(0, 10).split('-').reverse().join('/') : '—';
  const today = new Date();
  const localDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  const receiptNames = { SR: 'Sin recepción', RP: 'Recepción parcial', RC: 'Recepción completa', SD: 'Sin detalle de OC', NA: 'No aplica' };
  const alertNames = { sin_recepcion: 'Sin recepción', parcial: 'Recepción parcial', completa: 'Recepción completa', abiertas: 'Abiertas de recepción', vencidas: 'Entrega vencida', proximas_7: 'Próximas 7 días', sobrerrecepcion: 'Recepción sobre lo ordenado', sin_fecha: 'Sin fecha de entrega' };
  const charts = new Map(), optionsCache = new Map(), caches = { alert: new Map(), detail: new Map(), lines: new Map() };
  const controllers = {}, sequences = { dashboard: 0, alert: 0, detail: 0, lines: 0 };
  let applied = null, summary = null, activeAlert = null;
  $('headerDate').textContent = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long' }).format(today);
  $('ocFrom').value = `${today.getFullYear()}-01-01`; $('ocTo').value = localDate(today);
  const combos = { proveedor: combobox('ocSupplier', 'Seleccione un proveedor de la lista.'),
    centroCosto: combobox('ocCenter', 'Seleccione un centro de costo de la lista.') };

  function combobox(id, message) {
    const root = $(`${id}Combo`), input = $(`${id}Search`), value = $(id), list = $(`${id}List`);
    const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    let rows = [], matches = [], active = -1, selectedName = '';
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
    function validate() {
      const valid = !input.value.trim() || (value.value !== '' && input.value === selectedName && rows.some(row => row.codigo === value.value));
      if (!input.value.trim()) { value.value = ''; selectedName = ''; }
      input.setCustomValidity(valid ? '' : message);
      return valid;
    }
    function render(query) {
      const search = normalize(query.trim());
      matches = rows.filter(row => normalize(row.nombre).includes(search));
      if (!search || normalize('Todos').includes(search)) matches.unshift({ codigo: '', nombre: 'Todos' });
      active = -1; input.removeAttribute('aria-activedescendant');
      list.innerHTML = matches.map((row, index) => `<div role="option" id="${id}Option${index}" data-oc-option="${index}" aria-selected="false">${escape(row.nombre)}</div>`).join('')
        || '<div class="oc-combo-empty">No se encontraron resultados</div>';
      $(`${id}Matches`).textContent = matches.length ? `${matches.length} opciones disponibles.` : 'No se encontraron resultados';
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    function choose(row) {
      value.value = row.codigo; selectedName = row.codigo ? row.nombre : ''; input.value = selectedName;
      input.setCustomValidity(''); input.focus(); close();
    }
    input.addEventListener('input', () => {
      value.value = ''; selectedName = ''; validate(); render(input.value);
    });
    input.addEventListener('focus', () => render(value.value ? '' : input.value));
    input.addEventListener('click', () => { if (list.hidden) render(value.value ? '' : input.value); });
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (list.hidden) render(value.value ? '' : input.value);
        if (!matches.length) return;
        active = event.key === 'ArrowDown' ? (active + 1) % matches.length : (active <= 0 ? matches.length - 1 : active - 1);
        list.querySelectorAll('[role="option"]').forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
        const optionId = `${id}Option${active}`;
        input.setAttribute('aria-activedescendant', optionId); $(optionId)?.scrollIntoView({ block: 'nearest' });
      } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
        event.preventDefault(); choose(matches[active]);
      } else if (event.key === 'Escape') {
        if (!list.hidden) event.preventDefault(); close();
      } else if (event.key === 'Tab') close();
    });
    list.addEventListener('pointerdown', event => event.preventDefault());
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-oc-option]');
      if (option && list.contains(option)) { const row = matches[Number(option.dataset.ocOption)]; if (row) choose(row); }
    });
    $(`${id}Clear`).addEventListener('click', () => choose({ codigo: '', nombre: 'Todos' }));
    document.addEventListener('pointerdown', event => { if (!root.contains(event.target)) close(); });
    root.addEventListener('focusout', event => { if (!root.contains(event.relatedTarget)) close(); });
    return {
      validate, close,
      label: code => rows.find(row => row.codigo === code)?.nombre || 'Todos',
      setOptions(catalog, code) {
        rows = catalog.map(row => ({ codigo: String(row.codigo), nombre: String(row.nombre) }));
        const selected = rows.find(row => row.codigo === code);
        value.value = selected?.codigo || ''; selectedName = selected?.nombre || ''; input.value = selectedName;
        input.setCustomValidity(''); close();
      },
    };
  }

  async function api(path, params, signal) {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const response = await fetch(`/api/adquisiciones/control-oc${path}?${query}`, { signal,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' } });
    const body = await response.json().catch(() => { throw new Error('El servidor no devolvió una respuesta válida.'); });
    if (!response.ok || body.ok === false) throw new Error(body.error || `Error HTTP ${response.status}`);
    return body;
  }

  function status(id, message, error = false) { $(id).textContent = message; $(id).classList.toggle('oc-status--error', error); }
  function start(scope) { controllers[scope]?.abort(); controllers[scope] = new AbortController(); return { sequence: ++sequences[scope], signal: controllers[scope].signal }; }
  function busy(scope, loading, initial = false) {
    if (scope === 'dashboard') {
      $('ocLoading').hidden = !loading; $('ocModule').setAttribute('aria-busy', String(loading)); $('ocContent').inert = loading;
      $('ocUpdate').disabled = loading; $('ocUpdate').textContent = loading ? (initial ? 'Cargando...' : 'Actualizando...') : 'Actualizar';
      $('ocLoadingText').textContent = initial ? 'Cargando Control de OC...' : 'Actualizando información...';
    } else {
      const prefix = { alert: 'ocAlert', detail: 'ocDetail', lines: 'ocLines' }[scope];
      $(`${prefix}Loading`).hidden = !loading; $(`${prefix}Content`).hidden = loading; $(`${prefix}Content`).inert = loading;
      $(scope === 'detail' ? 'ocDetailSection' : `${prefix}Dialog`).setAttribute('aria-busy', String(loading));
      if (scope !== 'lines') { $(`${prefix}Pager`).hidden = loading; $(`${prefix}Pager`).inert = loading; }
      if (scope === 'detail') $('ocShowDetail').disabled = loading || !applied;
    }
  }

  function options(options, filters) {
    combos.proveedor.setOptions(options.proveedores, filters.proveedor);
    combos.centroCosto.setOptions(options.centrosCosto, filters.centroCosto);
  }

  async function loadDashboard(initial = false) {
    $('ocTo').setCustomValidity($('ocFrom').value > $('ocTo').value ? 'Desde no puede ser posterior a Hasta.' : '');
    Object.values(combos).forEach(combo => combo.validate());
    if (!$('ocFilters').reportValidity()) return;
    const params = Object.fromEntries(new FormData($('ocFilters')));
    const filterLabels = { proveedor: combos.proveedor.label(params.proveedor), centroCosto: combos.centroCosto.label(params.centroCosto) };
    Object.values(combos).forEach(combo => combo.close());
    const optionsKey = `${params.desde}|${params.hasta}`;
    if (!optionsCache.has(optionsKey)) params.incluirOpciones = '1';
    const request = start('dashboard');
    for (const scope of ['alert', 'detail', 'lines']) { controllers[scope]?.abort(); sequences[scope]++; busy(scope, false); }
    $('ocLinesDialog').close(); $('ocAlertDialog').close();
    busy('dashboard', true, initial); status('ocStatus', 'Calculando recepción real y saldos netos...');
    try {
      const result = await api('', params, request.signal);
      if (request.sequence !== sequences.dashboard) return;
      if (!result.conciliaciones || Object.values(result.conciliaciones).some(value => value !== true)) throw new Error('Los totales de OC no concilian.');
      applied = result.filtros; summary = result;
      if (result.opciones) optionsCache.set(optionsKey, result.opciones);
      if (optionsCache.has(optionsKey)) options(optionsCache.get(optionsKey), applied);
      Object.values(caches).forEach(cache => cache.clear());
      renderDashboard(result);
      $('ocDetailContent').innerHTML = ''; $('ocDetailPager').innerHTML = ''; $('ocRangeWarning').hidden = true;
      status('ocDetailStatus', 'El detalle se carga solo al solicitarlo.'); $('ocShowDetail').disabled = false;
      const supplier = filterLabels.proveedor;
      const center = filterLabels.centroCosto;
      status('ocStatus', `${date(applied.desde)} al ${date(applied.hasta)} · Proveedor: ${supplier} · Centro: ${center}. Montos pendientes y vencidos netos en CLP. Conciliaciones correctas.${result.recepcion.SD.cantidad ? ` Aprobadas sin detalle: ${number(result.recepcion.SD.cantidad)}.` : ''}${result.kpis.otrosEstados.cantidad ? ` Otros estados administrativos: ${number(result.kpis.otrosEstados.cantidad)}.` : ''}${window.Chart ? '' : ' No fue posible cargar la biblioteca de gráficos.'}`, !window.Chart);
    } catch (error) {
      if (request.sequence === sequences.dashboard && error.name !== 'AbortError') status('ocStatus', `No fue posible cargar Control de OC. ${error.message} Presione Actualizar para reintentar.`, true);
    } finally { if (request.sequence === sequences.dashboard) busy('dashboard', false); }
  }

  function card(label, count, amount, hint = '', alert = '', variant = '') {
    const tag = alert ? 'button' : 'article';
    return `<${tag} class="oc-card ${variant}"${alert ? ` type="button" data-alert="${alert}"${count ? '' : ' disabled'}` : ''}><span class="oc-card-label">${label}</span><strong>${number(count)}</strong><span class="oc-card-amount">${amount}</span>${hint ? `<small>${hint}</small>` : ''}${alert && count ? '<span class="oc-card-link">Ver OC →</span>' : ''}</${tag}>`;
  }

  function renderDashboard(result) {
    $('ocAdminKpis').innerHTML = [['emitidas', 'Emitidas'], ['aprobadas', 'Aprobadas'], ['pendientes', 'Pendientes'], ['nulas', 'Nulas']].map(([key, name]) => card(name, result.kpis[key].cantidad, money(result.kpis[key].montoBaseValidado), 'Total OC equivalente CLP')).join('');
    $('ocReception').innerHTML = [['SR', 'Sin recepción', 'sin_recepcion'], ['RP', 'Recepción parcial', 'parcial'], ['RC', 'Recepción completa', 'completa'], ['abiertas', 'Abiertas de recepción', 'abiertas']].map(([key, label, alert]) => {
      const state = result.recepcion[key];
      return card(label, state.cantidad, `Neto pendiente ${money(state.montoPendienteNetoMB)}`, `Vencido neto ${money(state.montoVencidoNetoMB)} · ${percent(state.porcentajeAprobadas)} de aprobadas`, alert);
    }).join('');
    const alerts = result.alertas;
    $('ocAlerts').innerHTML = card('Entrega vencida', alerts.vencidas.cantidad, `Neto vencido ${money(alerts.vencidas.montoVencidoNetoMB)}`, `Atraso máximo ${number(alerts.vencidas.maxDiasAtraso)} días`, 'vencidas', 'oc-card--danger')
      + card('Próximas 7 días', alerts.proximas_7.cantidad, `Neto pendiente ${money(alerts.proximas_7.montoPendienteNetoMB)}`, 'Entrega desde hoy hasta los próximos 7 días', 'proximas_7', 'oc-card--warning')
      + card('Recepción sobre lo ordenado', alerts.sobrerrecepcion.cantidad, `${number(alerts.sobrerrecepcion.cantidadLineas)} líneas`, `${number(alerts.sobrerrecepcion.cantidadSobreRecibida)} unidades por sobre lo ordenado`, 'sobrerrecepcion', 'oc-card--warning')
      + (alerts.sin_fecha.cantidad ? card('Sin fecha de entrega', alerts.sin_fecha.cantidad, `Neto pendiente ${money(alerts.sin_fecha.montoPendienteNetoMB)}`, 'Saldo pendiente sin fecha', 'sin_fecha') : '');
    $('ocPendingNet').textContent = money(result.finanzas.montoPendienteNetoMB); $('ocOverdueNet').textContent = money(result.finanzas.montoVencidoNetoMB); $('ocOverdueRate').textContent = percent(result.finanzas.porcentajePendienteVencido);
    $('ocOldest').textContent = date(result.indicadores.ocPendienteMasAntigua); $('ocMaxDelay').textContent = `${number(result.indicadores.maxDiasAtraso)} días`;
    $('ocAverageNet').textContent = money(result.indicadores.montoPendientePromedio); $('ocCompleteRate').textContent = percent(result.indicadores.porcentajeRecepcionCompleta);
    $('ocEvolutionHint').textContent = `${result.agrupacion === 'diaria' ? 'Agrupación diaria' : 'Agrupación mensual'} · Montos equivalentes CLP en tooltip`;
    if (!window.Chart) return;
    const timeline = result.evolucion;
    draw('ocEvolutionChart', { type: 'bar', data: { labels: timeline.map(row => result.agrupacion === 'diaria' ? date(row.periodo) : `${row.periodo.slice(5, 7)}/${row.periodo.slice(0, 4)}`), datasets: [
      { type: 'bar', label: 'Emitidas', data: timeline.map(row => row.emitidas), montos: timeline.map(row => row.montoEmitidoBase), backgroundColor: '#00a88566', borderRadius: 4 },
      { type: 'line', label: 'Aprobadas', data: timeline.map(row => row.aprobadas), montos: timeline.map(row => row.montoAprobadoBase), borderColor: '#268fb6', backgroundColor: '#268fb6', tension: .2, pointRadius: 2 },
    ] }, options: { ...chartOptions(), interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${number(c.raw)} OC · ${money(c.dataset.montos[c.dataIndex])}` } } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
    horizontal('ocReceptionChart', result.estadoRecepcion.map(row => ({ ...row, nombre: receiptNames[row.estado] || row.nombre })), 'nombre', 'cantidad', row => `${number(row.cantidad)} OC · Neto pendiente ${money(row.montoPendienteNetoMB)} · ${percent(row.porcentajeAprobadas)}`);
    horizontal('ocAgeChart', result.antiguedadVencida, 'nombre', 'cantidad', row => `${number(row.cantidad)} OC · Neto vencido ${money(row.montoVencidoNetoMB)}`);
    renderRanking();
  }

  function chartOptions() { return { responsive: true, maintainAspectRatio: false }; }
  function draw(id, config) { const chart = charts.get(id); if (chart) { chart.data = config.data; chart.options = config.options; chart.update(); } else charts.set(id, new Chart($(id), config)); }
  function horizontal(id, rows, label, value, tooltip, monetary = false) {
    draw(id, { type: 'bar', data: { labels: rows.map(row => row[label]?.length > 30 ? row[label].slice(0, 27) + '...' : row[label]), datasets: [{ data: rows.map(row => row[value]), backgroundColor: id === 'ocAgeChart' ? '#d8ab4b99' : '#268fb699', borderRadius: 4 }] },
      options: { ...chartOptions(), indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => rows[items[0]?.dataIndex]?.[label] || '', label: c => tooltip(rows[c.dataIndex]) } } }, scales: { x: { beginAtZero: true, ticks: monetary ? { callback: n => `$${number(n / 1000000)} M` } : { precision: 0 } } } } });
  }
  function renderRanking() {
    if (!summary || !window.Chart) return;
    const supplier = $('ocRanking').value === 'proveedor';
    const rows = supplier ? summary.rankingProveedores : summary.rankingCentrosCosto;
    $('ocRankContainer').style.height = `${Math.max(290, rows.length * 28 + 40)}px`;
    $('ocRankHint').textContent = supplier ? 'Top 10 proveedores · Neto pendiente de OC abiertas' : 'Todos los centros de costo con OC abiertas · Neto pendiente';
    horizontal('ocRankChart', rows, 'nombre', 'montoPendienteNetoMB', row => `${number(row.cantidadOC)} OC · Neto pendiente ${money(row.montoPendienteNetoMB)} · Neto vencido ${money(row.montoVencidoNetoMB)}`, true);
  }

  function badge(text, variant = '') { return `<span class="oc-badge ${variant ? `oc-badge--${variant}` : ''}">${escape(text)}</span>`; }
  function alertBadges(row) { return (row.maxDiasAtraso > 0 ? badge('Entrega vencida', 'danger') : '') + (row.tieneSobreRecepcion ? badge('Recepción sobre lo ordenado', 'warning') : '') + (row.tieneEntregaProxima7Dias ? badge('Próxima 7 días') : '') + (row.tienePendienteSinFecha ? badge('Sin fecha', 'warning') : '') || '—'; }
  function cell(label, value, numeric = false, wide = false) { return `<td data-label="${label}"${numeric ? ' class="oc-money"' : ''}${wide ? ' data-wide' : ''}>${value}</td>`; }
  function renderOrders(result) {
    const headers = ['OC', 'Fecha', 'Proveedor', 'Centro costo', 'Estado OC', 'Recepción', 'Entrega pendiente', 'Días atraso', 'Total OC (CLP)', 'Pendiente Neto', 'Vencido Neto', 'Alertas', 'Detalle'];
    return `<table class="oc-table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${result.ordenes.map(row => `<tr>${cell('OC', escape(row.numOC))}${cell('Fecha', date(row.fechaOC))}${cell('Proveedor', escape(row.proveedor), false, true)}${cell('Centro costo', escape(row.centroCosto))}${cell('Estado OC', badge(row.estadoOC, row.codEstado === 'AP' ? 'good' : row.codEstado === 'UN' ? 'danger' : ''))}${cell('Recepción', badge(receiptNames[row.estadoRecepcion] || row.estadoRecepcion, row.estadoRecepcion === 'RC' ? 'good' : ''))}${cell('Entrega pendiente', date(row.fechaPendienteMasAntigua))}${cell('Días atraso', number(row.maxDiasAtraso), true)}${cell('Total OC (CLP)', money(row.valorTotMBValidado) + `<small>${escape(row.simMon)} ${number(row.valorTotOC)}</small>`, true)}${cell('Pendiente Neto', money(row.montoPendienteNetoMB), true)}${cell('Vencido Neto', money(row.montoVencidoNetoMB), true)}${cell('Alertas', alertBadges(row), false, true)}${cell('Detalle', `<button type="button" class="oc-button oc-button--light" data-lines="${Number(row.numInterOC)}">Ver líneas</button>`, false, true)}</tr>`).join('') || `<tr><td colspan="13" class="oc-empty">Sin Órdenes de Compra para esta consulta.</td></tr>`}</tbody></table>`;
  }
  function pager(result, scope) { return `<span>${number(result.cantidad ? (result.pagina - 1) * 100 + 1 : 0)}–${number(Math.min(result.pagina * 100, result.cantidad))} de ${number(result.cantidad)} OC</span><div><button type="button" class="oc-button oc-button--light" data-page="${result.pagina - 1}" data-scope="${scope}"${result.pagina <= 1 ? ' disabled' : ''}>Anterior</button><button type="button" class="oc-button oc-button--light" data-page="${result.pagina + 1}" data-scope="${scope}"${result.hayMas ? '' : ' disabled'}>Siguiente</button></div>`; }

  async function loadOrders(scope, page = 1, type = activeAlert) {
    if (!applied) return;
    const snapshot = applied, request = start(scope), prefix = scope === 'alert' ? 'ocAlert' : 'ocDetail';
    const params = { ...snapshot, pagina: page, ...(scope === 'alert' ? { tipo: type } : {}) };
    const key = JSON.stringify(params);
    if (scope === 'alert') { activeAlert = type; $('ocAlertTitle').textContent = alertNames[type]; $('ocAlertTotals').textContent = ''; if (!$('ocAlertDialog').open) $('ocAlertDialog').showModal(); }
    busy(scope, true); status(`${prefix}Status`, '');
    try {
      const result = caches[scope].get(key) || await api(scope === 'alert' ? '/alerta' : '/detalle', params, request.signal);
      if (request.sequence !== sequences[scope] || applied !== snapshot) return;
      caches[scope].set(key, result); $(`${prefix}Content`).innerHTML = renderOrders(result); $(`${prefix}Pager`).innerHTML = pager(result, scope);
      const text = `${number(result.cantidad)} OC · Neto pendiente ${money(result.montoPendienteNetoMB)} · Neto vencido ${money(result.montoVencidoNetoMB)}`;
      if (scope === 'alert') $('ocAlertTotals').textContent = text; else status('ocDetailStatus', text);
    } catch (error) {
      if (request.sequence === sequences[scope] && error.name !== 'AbortError') { $(`${prefix}Content`).innerHTML = ''; $(`${prefix}Pager`).innerHTML = ''; status(`${prefix}Status`, `No fue posible cargar las OC. ${error.message} Vuelva a solicitar el detalle para reintentar.`, true); }
    } finally { if (request.sequence === sequences[scope]) busy(scope, false); }
  }

  async function loadLines(id) {
    const request = start('lines');
    $('ocLinesHelp').hidden = true; $('ocLinesHelpToggle').setAttribute('aria-expanded', 'false');
    $('ocLinesTitle').textContent = 'Líneas de Orden de Compra'; $('ocLinesHeader').textContent = ''; status('ocLinesStatus', '');
    if (!$('ocLinesDialog').open) $('ocLinesDialog').showModal(); busy('lines', true);
    try {
      const result = caches.lines.get(id) || await api('/lineas', { numInterOC: id }, request.signal);
      if (request.sequence !== sequences.lines) return;
      caches.lines.set(id, result);
      const h = result.cabecera;
      $('ocLinesTitle').textContent = `OC ${h.numOC} · ${receiptNames[h.estadoRecepcion]}`;
      $('ocLinesHeader').textContent = `${date(h.fechaOC)} · ${h.proveedor} · ${h.centroCosto} · ${h.estadoOC} · Moneda ${h.simMon}`;
      const headers = ['N° Línea', 'Código producto', 'Descripción', 'Fecha compromiso', 'Cantidad ordenada', 'Recepción manual', 'Recibido por entradas', 'Devuelto', 'Recibido no inventariable', 'Total recibido', 'Diferencia pendiente', 'Monto pendiente (CLP)', 'Días de atraso', 'Estado y alertas'];
      const tips = { 'Recepción manual': 'Cantidad registrada manualmente en la OC.', 'Recibido por entradas': 'Cantidad recepcionada mediante movimientos de entrada válidos.', 'Devuelto': 'Cantidad descontada por devoluciones.', 'Recibido no inventariable': 'Cantidad registrada mediante recepción no inventariable.', 'Total recibido': 'Recepción manual + entradas - devoluciones + recepción no inventariable.', 'Diferencia pendiente': 'Cantidad ordenada menos total recibido. Un valor negativo indica recepción sobre lo ordenado.', 'Monto pendiente (CLP)': 'Valor neto proporcional correspondiente a la cantidad aún pendiente de recibir.' };
      $('ocLinesContent').innerHTML = `<table class="oc-table"><thead><tr>${headers.map(v => `<th scope="col"${tips[v] ? ` title="${escape(tips[v])}" tabindex="0"` : ''}>${v}${tips[v] ? `<span class="oc-header-tip" role="tooltip">${escape(tips[v])}</span>` : ''}</th>`).join('')}</tr></thead><tbody>${result.lineas.map(line => `<tr>${cell('N° Línea', number(line.numLinea))}${cell('Código producto', escape(line.codProd))}${cell('Descripción', escape(line.descripcion), false, true)}${cell('Fecha compromiso', date(line.fechaEnt))}${cell('Cantidad ordenada', number(line.cantidadOrdenada), true)}${cell('Recepción manual', number(line.recepManual), true)}${cell('Recibido por entradas', number(line.entradaInventario), true)}${cell('Devuelto', number(line.devolucion), true)}${cell('Recibido no inventariable', number(line.recepcionNoInventariable), true)}${cell('Total recibido', number(line.recibidoReal), true)}${cell('Diferencia pendiente', number(line.saldoReal), true)}${cell('Monto pendiente (CLP)', money(line.montoPendienteNetoMB) + `<small>${escape(h.simMon)} ${number(line.montoPendienteMonedaOC)} neto</small>`, true)}${cell('Días de atraso', number(line.diasAtraso), true)}${cell('Estado y alertas', badge({ SIN_RECEPCION: 'Sin recepción', PENDIENTE: 'Recepción parcial', COMPLETA: 'Recepción completa' }[line.estadoLinea] || line.estadoLinea) + alertBadges({ maxDiasAtraso: line.diasAtraso, tieneSobreRecepcion: line.tieneSobreRecepcion }).replace(/^—$/, ''), false, true)}</tr>`).join('') || '<tr><td colspan="14" class="oc-empty">Esta OC no tiene líneas.</td></tr>'}</tbody></table>`;
    } catch (error) { if (request.sequence === sequences.lines && error.name !== 'AbortError') { $('ocLinesContent').innerHTML = ''; status('ocLinesStatus', `No fue posible cargar las líneas. ${error.message} Cierre y vuelva a solicitar para reintentar.`, true); } }
    finally { if (request.sequence === sequences.lines) busy('lines', false); }
  }

  $('ocMetricsHelpToggle').addEventListener('click', () => {
    const open = $('ocMetricsHelp').hidden;
    $('ocMetricsHelp').hidden = !open; $('ocMetricsHelpToggle').setAttribute('aria-expanded', String(open));
  });
  $('ocMetricsHelpClose').addEventListener('click', () => {
    $('ocMetricsHelp').hidden = true; $('ocMetricsHelpToggle').setAttribute('aria-expanded', 'false'); $('ocMetricsHelpToggle').focus();
  });
  $('ocFinanceHelpToggle').addEventListener('click', () => {
    const open = $('ocFinanceHelp').hidden;
    $('ocFinanceHelp').hidden = !open; $('ocFinanceHelpToggle').setAttribute('aria-expanded', String(open));
  });
  $('ocFinanceHelpClose').addEventListener('click', () => {
    $('ocFinanceHelp').hidden = true; $('ocFinanceHelpToggle').setAttribute('aria-expanded', 'false'); $('ocFinanceHelpToggle').focus();
  });
  $('ocLinesHelpToggle').addEventListener('click', () => {
    const open = $('ocLinesHelp').hidden;
    $('ocLinesHelp').hidden = !open; $('ocLinesHelpToggle').setAttribute('aria-expanded', String(open));
  });
  $('ocLinesHelpClose').addEventListener('click', () => {
    $('ocLinesHelp').hidden = true; $('ocLinesHelpToggle').setAttribute('aria-expanded', 'false'); $('ocLinesHelpToggle').focus();
  });
  $('ocFilters').addEventListener('submit', event => { event.preventDefault(); loadDashboard(); });
  ['ocFrom', 'ocTo'].forEach(id => $(id).addEventListener('input', () => $('ocTo').setCustomValidity('')));
  $('ocRanking').addEventListener('change', renderRanking);
  ['ocReception', 'ocAlerts'].forEach(id => $(id).addEventListener('click', event => { const button = event.target.closest('[data-alert]'); if (button && !button.disabled) loadOrders('alert', 1, button.dataset.alert); }));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  for (const [id, scope] of [['ocAlertDialog', 'alert'], ['ocLinesDialog', 'lines']]) $(id).addEventListener('close', () => { controllers[scope]?.abort(); sequences[scope]++; busy(scope, false); });
  ['ocDetailContent', 'ocAlertContent'].forEach(id => $(id).addEventListener('click', event => { const button = event.target.closest('[data-lines]'); if (button) loadLines(Number(button.dataset.lines)); }));
  ['ocDetailPager', 'ocAlertPager'].forEach(id => $(id).addEventListener('click', event => { const button = event.target.closest('[data-page]'); if (button && !button.disabled) loadOrders(button.dataset.scope, Number(button.dataset.page)); }));
  $('ocShowDetail').addEventListener('click', () => {
    if (!applied) return;
    if (applied.diasRango > 90) { $('ocRangeText').textContent = `El rango comprende ${number(applied.diasRango)} días. Consultar el detalle puede tardar algunos segundos.`; $('ocRangeWarning').classList.toggle('oc-warning--strong', applied.diasRango > 365); $('ocRangeWarning').hidden = false; }
    else loadOrders('detail');
  });
  $('ocConfirmDetail').addEventListener('click', () => { $('ocRangeWarning').hidden = true; loadOrders('detail'); });
  (async () => {
    try { const context = await window.appSidebarReady; if (!context) throw new Error('No fue posible cargar sesión y navegación. Recargue la página.'); await loadDashboard(true); }
    catch (error) { status('ocStatus', error.message, true); busy('dashboard', false); }
  })();
})();
