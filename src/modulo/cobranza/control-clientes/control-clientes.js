'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const number = n => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(Number(n) || 0);
  const date = value => value ? value.split('-').reverse().join('/') : '—';
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const today = new Date();
  const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let data = { nuevos: [], recuperados: [] };
  let mainTab = 'nuevos';
  let annualTab = 'nuevos';
  let page = 0;
  let applied = {};
  let chart = null;
  let reportController = null;
  let evolutionController = null;
  let reportSequence = 0;
  let evolutionSequence = 0;
  let optionsPromise = null;
  let optionsRendered = false;
  let annualData = null;
  let activeMonthDetails = null;
  const evolutionCache = new Map();
  const monthDetailCache = new Map();
  const monthDetailRequests = new Map();
  const monthDetailStates = new WeakMap();
  const detailMobile = window.matchMedia('(max-width:767px)');
  const pageSize = 20;
  $('headerDate').textContent = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long' }).format(today);

  function defaults() {
    $('fromDate').value = localDate(new Date(today.getFullYear(), today.getMonth(), 1));
    $('toDate').value = localDate(today);
    $('clientFilter').value = '';
    $('vendorFilter').value = '';
  }

  async function api(path, params = {}, signal) {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    const response = await fetch(`/api/cobranza${path}?${query}`, { signal,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' } });
    const body = await response.json().catch(() => { throw new Error('El servidor no pudo completar la consulta. Intente nuevamente.'); });
    if (!response.ok || body.ok === false) throw new Error(body.error || `Error HTTP ${response.status}`);
    return body;
  }

  function setStatus(message, error = false) {
    $('clientStatus').textContent = message;
    $('clientStatus').classList.toggle('client-status--error', error);
  }

  function setLoading(loading, initial = false) {
    $('controlLoading').hidden = !loading;
    $('controlContent').inert = loading;
    $('controlModule').setAttribute('aria-busy', String(loading));
    $('clientResults').setAttribute('aria-busy', String(loading));
    $('queryButton').disabled = loading;
    $('clearButton').disabled = loading;
    $('exportClients').disabled = loading || !applied.desde;
    $('querySpinner').hidden = !loading;
    $('queryLabel').textContent = loading ? (initial ? 'Cargando...' : 'Actualizando...') : 'Actualizar';
    $('controlLoadingText').textContent = initial ? 'Cargando control de clientes...' : 'Actualizando información...';
  }

  function loadOptions() {
    if (!optionsPromise) optionsPromise = api('/opciones').catch(error => { optionsPromise = null; throw error; });
    return optionsPromise;
  }

  function renderOptions(options) {
    if (optionsRendered) return;
    const vendor = $('vendorFilter').value;
    const year = $('evolutionYear').value;
    $('vendorFilter').innerHTML = '<option value="">Todos los vendedores</option>' + options.vendedores.map(v => `<option value="${Number(v.usuarioId)}">${escape(v.nombre)} (${escape(v.codigo)})</option>`).join('');
    $('evolutionYear').innerHTML = options.anios.map(y => `<option value="${Number(y)}">${Number(y)}</option>`).join('');
    $('vendorFilter').value = vendor;
    $('evolutionYear').value = year;
    optionsRendered = true;
  }

  async function fetchEvolution(params, signal) {
    const key = JSON.stringify([String(params.anio), params.tipo, String(params.vendedorId || ''), String(params.cliente || '').trim()]);
    const cached = evolutionCache.get(key);
    if (cached) return cached;
    const result = await api('/control-clientes/evolucion', params, signal);
    if (!signal.aborted) evolutionCache.set(key, result);
    return result;
  }

  function setAnnualLoading(loading) {
    if (loading) closeMonthDetail();
    $('annualLoading').hidden = !loading;
    $('annualSection').setAttribute('aria-busy', String(loading));
    $('annualContent').inert = loading;
    $('exportAnnual').disabled = loading || !annualData;
    $('annualLoadingText').textContent = `Calculando información ${$('evolutionYear').value}...`;
  }

  function annualError(error) {
    annualData = null;
    $('annualContent').hidden = true;
    $('evolutionStatus').textContent = `No fue posible cargar la evolución. ${error.message} Seleccione el año nuevamente o presione Actualizar.`;
  }

  function renderAnnualVendors(result) {
    $('annualVendors').innerHTML = result.vendedores.map((vendor, index) => `<details class="client-annual-vendor" data-vendor-index="${index}"><summary><strong>${escape(vendor.vendedor)}</strong><span>${number(vendor.cantidadAnual)} clientes</span><span class="client-money">${money(vendor.montoAnual)}</span><span class="client-month-toggle">Ver meses</span></summary><div class="client-vendor-months"></div><div class="client-month-detail" aria-live="polite" hidden></div></details>`).join('') || '<p class="client-empty">Sin clientes con propietario para estos filtros.</p>';
  }

  function placeMonthDetail(details, pane, button) {
    if (detailMobile.matches) button.after(pane);
    else details.querySelector('.client-vendor-months').after(pane);
  }

  function closeMonthDetail(details = activeMonthDetails) {
    if (!details) return;
    monthDetailRequests.get(details)?.abort();
    monthDetailRequests.delete(details);
    const state = monthDetailStates.get(details);
    if (state) { state.sequence++; state.month = null; }
    const pane = details.querySelector('.client-month-detail');
    pane.hidden = true;
    pane.setAttribute('aria-busy', 'false');
    details.querySelectorAll('[data-month]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    if (activeMonthDetails === details) activeMonthDetails = null;
  }

  function renderMonthDetail(pane, result, expected) {
    const total = result.clientes.reduce((sum, client) => sum + Number(client.monto), 0);
    const mismatch = result.clientes.length !== Number(expected.cantidad) || Math.abs(total - Number(expected.venta)) >= .01;
    pane.innerHTML = `<div class="client-month-detail-heading"><strong>Detalle ${monthNames[result.mes - 1]} ${result.anio}</strong><span>${number(result.clientes.length)} clientes · ${money(total)}</span><button type="button" class="client-button client-button--light" data-close-month-detail>Cerrar ×</button></div>
      ${mismatch ? `<p class="client-month-discrepancy">El detalle no coincide con la tarjeta: resumen ${number(expected.cantidad)} clientes / ${money(expected.venta)}; detalle ${number(result.clientes.length)} clientes / ${money(total)}. Actualice la información para comprobar los datos vigentes.</p>` : ''}
      <table class="client-month-table"><thead><tr><th scope="col">Código</th><th scope="col">Cliente</th><th scope="col">Monto</th></tr></thead><tbody>${result.clientes.map(client => `<tr><td>${escape(client.codigo)}</td><td>${escape(client.cliente)}</td><td>${money(client.monto)}</td></tr>`).join('')}</tbody><tfoot><tr><th scope="row">TOTAL</th><td>${number(result.clientes.length)} clientes</td><td>${money(total)}</td></tr></tfoot></table>`;
  }

  async function showMonthDetail(button) {
    const details = button.closest('.client-annual-vendor');
    const snapshot = annualData;
    const vendor = snapshot?.vendedores[Number(details.dataset.vendorIndex)];
    const month = Number(button.dataset.month);
    const expected = vendor?.meses[month - 1];
    if (button.disabled || !expected || Number(expected.cantidad) <= 0) return;
    const pane = details.querySelector('.client-month-detail');
    const state = monthDetailStates.get(details) || { sequence: 0, month: null };
    monthDetailStates.set(details, state);
    if (activeMonthDetails === details && state.month === month) { closeMonthDetail(); return; }
    closeMonthDetail();
    activeMonthDetails = details;
    const sequence = ++state.sequence;
    state.month = month;
    details.querySelectorAll('[data-month]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    pane.hidden = false;
    pane.setAttribute('aria-busy', 'false');
    placeMonthDetail(details, pane, button);
    const params = { anio: snapshot.anio, tipo: snapshot.tipo, vendedorId: vendor.usuarioId, mes: month, cliente: applied.cliente || '' };
    const key = JSON.stringify([params.tipo, params.anio, params.vendedorId, month, params.cliente]);
    const cached = monthDetailCache.get(key);
    if (cached) { renderMonthDetail(pane, cached, expected); return; }
    const controller = new AbortController();
    monthDetailRequests.set(details, controller);
    pane.setAttribute('aria-busy', 'true');
    pane.innerHTML = `<div class="client-month-detail-heading"><strong>Detalle ${monthNames[month - 1]} ${snapshot.anio}</strong><button type="button" class="client-button client-button--light" data-close-month-detail>Cerrar ×</button></div><div class="client-month-detail-loading" role="status"><span class="client-button-spinner" aria-hidden="true"></span>Cargando clientes de ${monthNames[month - 1]}...</div>`;
    try {
      const result = await api('/control-clientes/evolucion-detalle', params, controller.signal);
      if (!controller.signal.aborted) monthDetailCache.set(key, result);
      if (sequence === state.sequence && annualData === snapshot && details.isConnected) renderMonthDetail(pane, result, expected);
    } catch (error) {
      if (error.name !== 'AbortError' && sequence === state.sequence && annualData === snapshot && details.isConnected) {
        pane.innerHTML = `<div class="client-month-detail-heading"><strong>Detalle ${monthNames[month - 1]}</strong><button type="button" class="client-button client-button--light" data-close-month-detail>Cerrar ×</button></div><p class="client-month-discrepancy" role="alert">No fue posible cargar el detalle de ${monthNames[month - 1]}. Vuelva a pulsar el mes para reintentar.</p>`;
        state.month = null;
        button.setAttribute('aria-pressed', 'false');
      }
    } finally {
      if (sequence === state.sequence) {
        pane.setAttribute('aria-busy', 'false');
        monthDetailRequests.delete(details);
      }
    }
  }

  function contestBadge(contest) {
    if (!contest?.participa) return `<span class="client-tag client-tag--muted">${escape(contest?.motivo || 'Fuera de concurso')}</span>`;
    return `<span class="client-tag${contest.califica ? '' : ' client-tag--warning'}">${contest.califica ? `${number(contest.puntos)} pts` : 'No califica'}</span><small>${escape(contest.periodo)}${contest.cerrado ? ' · Cerrado' : ' · Mensual'}${!contest.califica && contest.motivo ? `<br>${escape(contest.motivo)}` : ''}</small>`;
  }

  function renderTable() {
    const recovered = mainTab === 'recuperados';
    const events = data[mainTab] || [];
    page = Math.min(page, Math.max(0, Math.ceil(events.length / pageSize) - 1));
    const headers = [recovered ? 'Recuperación' : 'Primera compra', 'Código / RUT', 'Cliente', 'Propietario / Vendedor',
      ...(recovered ? ['Última compra previa', 'Inactividad / regla'] : []), 'Venta total', 'Estado', 'Folios', 'Concurso', 'Detalle'];
    $('clientTableHead').innerHTML = `<tr>${headers.map(h => `<th scope="col"${['Venta total', 'Folios'].includes(h) ? ' class="client-numeric"' : ''}>${h}</th>`).join('')}</tr>`;
    $('clientTableBody').innerHTML = events.slice(page * pageSize, (page + 1) * pageSize).map((event, i) => {
      const owners = (event.propietarios || []).map(p => `<span>${escape(p.nombre)}</span>`).join('') || 'Sin propietario registrado';
      const contestParticipants = event.concurso?.participa ? `<details class="client-contest-members"><summary>Participantes Concurso (${event.concurso.participantes.length})</summary>${event.concurso.participantes.map(p => `<small>${escape(p.nombre)} · ${money(p.ventaMes)} atribuida · ${number(p.puntos)} pts</small>`).join('')}</details>` : '';
      const rules = (event.reglas || []).map(r => `${escape(r.vendedor)}: ${number(r.dias)} días`).join('<br>');
      return `<tr><td>${date(event.fecha)}</td><td><strong>${escape(event.codigoCliente)}</strong>${event.codigos.length > 1 ? `<small>+${event.codigos.length - 1} código${event.codigos.length > 2 ? 's' : ''}</small>` : ''}<small>${escape(event.rut || 'Sin RUT')}</small></td>
        <td class="client-name">${escape(event.cliente)}${event.codigoCaptacion ? `<small>Captación · código ${escape(event.codigoCaptacion)}</small>` : ''}</td>
        <td class="client-participants">${owners}</td>${recovered ? `<td>${date(event.ultimaCompra)}</td><td>${number(event.diasInactividad)} días<small>${rules}</small></td>` : ''}
        <td class="client-money">${money(event.ventaTotal)}</td><td><span class="client-tag${event.compartida ? ' client-tag--shared' : ' client-tag--muted'}">${event.compartida ? 'Venta compartida' : 'Directa'}</span></td>
        <td class="client-numeric">${number(event.cantidadFolios)}</td><td>${contestBadge(event.concurso)}${contestParticipants}</td><td><button type="button" class="client-button client-button--light" data-event="${page * pageSize + i}">Ver folios</button></td></tr>`;
    }).join('') || `<tr><td colspan="${headers.length}" class="client-empty">No hay ${recovered ? 'clientes recuperados' : 'clientes nuevos'} para los filtros aplicados.</td></tr>`;
    $('clientRowsInfo').textContent = events.length ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, events.length)} de ${number(events.length)} eventos` : '0 eventos';
    $('previousPage').disabled = page === 0;
    $('nextPage').disabled = (page + 1) * pageSize >= events.length;
  }

  function showFolios(index) {
    const event = data[mainTab][index];
    if (!event) return;
    $('foliosTitle').textContent = event.cliente;
    $('foliosSubtitle').textContent = `${event.rut || 'Sin RUT'} · ${event.codigos.join(', ')} · Propietario: ${(event.propietarios || []).map(p => p.nombre).join(', ') || 'Sin propietario registrado'} · ${date(applied.desde)} al ${date(applied.hasta)}`;
    $('foliosBody').innerHTML = event.folios.flatMap(doc => {
      const allocations = doc.atribuciones.length ? doc.atribuciones : [{ nombre: '—', atribucion: ['Sin importe atribuido'], porcentaje: 0, ventaAsignada: 0 }];
      return allocations.map((p, i) => `<tr><td>${escape(doc.tipo)}</td><td>${escape(doc.folio)}</td><td>${date(doc.fecha)}</td><td>${escape(doc.clienteCodigo)}<small>${escape(doc.cliente)}</small></td>
        <td>${escape(doc.codigoVendedor)}<small>${escape(doc.vendedor)}</small></td><td class="client-money">${i === 0 ? money(doc.original) : '<small>Mismo documento</small>'}</td>
        <td>${escape(p.nombre)}</td><td>${escape(p.atribucion.join(' · '))}</td><td>${number(p.porcentaje)} %</td><td class="client-money">${money(p.ventaAsignada)}</td></tr>`);
    }).join('');
    $('foliosTotals').innerHTML = `<span>${number(event.cantidadFolios)} documentos · Venta total ${money(event.ventaTotal)}</span><span>${event.participantes.map(p => `${escape(p.nombre)}: ${money(p.ventaAsignada)}`).join(' · ')}</span>`;
    const contest = event.concurso;
    const names = new Map(event.participantes.map(p => [p.usuarioId, p.nombre]));
    $('foliosContest').innerHTML = `<strong>Concurso ${escape(contest?.periodo || event.periodo)}</strong><br>${contestBadge(contest)}${contest?.participa ? `<p>Participantes Concurso · Resultado oficial del mes completo; la venta de esta vista corresponde al rango consultado.</p>${contest.participantes.map(p => `<div>${escape(p.nombre || names.get(p.usuarioId) || `Vendedor ${p.usuarioId}`)} · Venta atribuida ${money(p.ventaMes)} · ${number(p.puntos)} pts · ${p.califica ? 'Califica' : escape(p.motivo || 'No califica')}${p.ventaCalificadoraMes != null ? ` · Venta calificadora mensual ${money(p.ventaCalificadoraMes)}` : ''}</div>`).join('')}` : ''}`;
    $('foliosDialog').showModal();
  }

  async function loadReport({ initial = false } = {}) {
    if (!$('clientFilters').reportValidity()) return;
    if ($('fromDate').value > $('toDate').value) { setStatus('Desde no puede ser posterior a Hasta.', true); return; }
    reportController?.abort();
    evolutionController?.abort();
    const sequence = ++reportSequence;
    ++evolutionSequence;
    const controller = new AbortController();
    reportController = controller;
    const params = Object.fromEntries(new FormData($('clientFilters')));
    const evolutionParams = { anio: $('evolutionYear').value || today.getFullYear(), tipo: annualTab, cliente: params.cliente, vendedorId: params.vendedorId };
    setStatus('Consultando eventos y resultados mensuales del Concurso…');
    setLoading(true, initial);
    setAnnualLoading(true);
    try {
      const [options, report, evolution] = await Promise.allSettled([
        loadOptions(), api('/control-clientes', params, controller.signal), fetchEvolution(evolutionParams, controller.signal),
      ]);
      if (sequence !== reportSequence) return;
      if (options.status === 'fulfilled') renderOptions(options.value);
      if (report.status === 'rejected') throw report.reason;
      const result = report.value;
      data = result;
      applied = result.filtros;
      page = 0;
      $('newCount').textContent = number(result.resumen.clientesNuevos);
      $('recoveredCount').textContent = number(result.resumen.clientesRecuperados);
      $('newSales').textContent = money(result.resumen.ventaNuevos);
      $('recoveredSales').textContent = money(result.resumen.ventaRecuperados);
      const seller = $('vendorFilter').selectedOptions[0]?.textContent || 'Todos los vendedores';
      setStatus(`Filtros aplicados: ${date(applied.desde)} al ${date(applied.hasta)} · ${seller}${applied.cliente ? ` · Cliente contiene: ${applied.cliente}` : ''}. Los importes corresponden al rango; el Concurso se evalúa por mes.`);
      renderTable();
      try {
        if (evolution.status === 'rejected') throw evolution.reason;
        renderEvolution(evolution.value);
      } catch (error) { annualError(error); }
      if (options.status === 'rejected') setStatus('No fue posible cargar los vendedores. Presione Actualizar para reintentar.', true);
    } catch (error) {
      if (sequence === reportSequence && error.name !== 'AbortError') setStatus(`No fue posible cargar Control de Clientes. ${error.message} Presione Actualizar para reintentar.`, true);
    } finally {
      if (sequence === reportSequence) { setLoading(false); setAnnualLoading(false); }
    }
  }

  async function loadEvolution() {
    evolutionController?.abort();
    const controller = new AbortController();
    evolutionController = controller;
    const sequence = ++evolutionSequence;
    setAnnualLoading(true);
    $('evolutionStatus').textContent = 'Cargando evolución…';
    try {
      const result = await fetchEvolution({ anio: $('evolutionYear').value || today.getFullYear(), tipo: annualTab, cliente: applied.cliente, vendedorId: applied.vendedorId }, controller.signal);
      if (sequence === evolutionSequence) renderEvolution(result);
    } catch (error) {
      if (sequence === evolutionSequence && error.name !== 'AbortError') annualError(error);
    } finally { if (sequence === evolutionSequence) setAnnualLoading(false); }
  }

  function renderEvolution(result) {
      annualData = result;
      $('annualContent').hidden = false;
      renderAnnualVendors(result);
      if (!window.Chart) throw new Error('No fue posible cargar la biblioteca de gráficos.');
      const total = result.meses.reduce((s, m) => s + m.cantidad, 0);
      $('evolutionStatus').textContent = `${number(total)} eventos en ${result.anio} · ${result.tipo === 'nuevos' ? 'Clientes Nuevos' : 'Clientes Recuperados'}`;
      $('evolutionDescription').textContent = `Clientes y ventas de su mes de evento · ${result.tipo === 'nuevos' ? 'Nuevos por RUT' : 'Recuperados por código cliente'}`;
      if (chart) {
        chart.data.datasets[0].data = result.meses.map(m => m.venta);
        chart.data.datasets[1].data = result.meses.map(m => m.cantidad);
        chart.update();
        return;
      }
      chart = new Chart($('clientEvolutionChart'), {
        data: { labels: months, datasets: [
          { type: 'bar', label: 'Venta', data: result.meses.map(m => m.venta), yAxisID: 'sales', backgroundColor: '#00a88566', borderRadius: 5, maxBarThickness: 35, order: 2 },
          { type: 'line', label: 'Clientes', data: result.meses.map(m => m.cantidad), yAxisID: 'clients', borderColor: '#268fb6', backgroundColor: '#268fb6', tension: .2, pointRadius: 4, order: 1 },
        ] }, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.dataset.yAxisID === 'sales' ? money(c.raw) : number(c.raw)}` } } },
          scales: { x: { grid: { display: false } }, sales: { beginAtZero: true, grid: { color: '#edf2f5' }, ticks: { callback: n => `$${number(n / 1000000)} M` } }, clients: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { precision: 0 } } } },
      });
  }

  // XLSX de una hoja: XML OpenXML en ZIP sin compresión; no depende de servicios externos.
  function downloadXlsx(filename, rows, currencyColumns = []) {
    const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
    const column = index => { let name = ''; for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name; return name; };
    const sheet = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${column(c)}${r + 1}`;
      return typeof value === 'number' && Number.isFinite(value)
        ? `<c r="${ref}"${r && currencyColumns.includes(c) ? ' s="1"' : ''}><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const files = {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Control de Clientes" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultColWidth="20"/><sheetData>${sheet}</sheetData><autoFilter ref="A1:${column(rows[0].length - 1)}${rows.length}"/></worksheet>`,
    };
    const encoder = new TextEncoder();
    const crcTable = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
    const locals = [], directory = [];
    let offset = 0, directorySize = 0;
    for (const [name, content] of Object.entries(files)) {
      const nameBytes = encoder.encode(name), bytes = encoder.encode(content);
      let crc = 0xffffffff;
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      crc = (crc ^ 0xffffffff) >>> 0;
      const local = new Uint8Array(30 + nameBytes.length), lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(12, 33, true);
      lv.setUint32(14, crc, true); lv.setUint32(18, bytes.length, true); lv.setUint32(22, bytes.length, true); lv.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
      const central = new Uint8Array(46 + nameBytes.length), cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(14, 33, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, bytes.length, true); cv.setUint32(24, bytes.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); central.set(nameBytes, 46);
      locals.push(local, bytes); directory.push(central); offset += local.length + bytes.length; directorySize += central.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, directory.length, true); ev.setUint16(10, directory.length, true); ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
    const url = URL.createObjectURL(new Blob([...locals, ...directory, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportClients() {
    if (!applied.desde || $('queryButton').disabled) return;
    const recovered = mainTab === 'recuperados';
    const headers = [recovered ? 'Fecha recuperación' : 'Fecha primera compra', 'Código cliente', 'RUT', 'Cliente', 'Vendedor propietario',
      ...(recovered ? ['Compra anterior', 'Días inactivo', 'Regla aplicada'] : []), 'Monto', 'Cantidad folios', 'Estado compartida', 'Estado Concurso', 'Puntos Concurso', 'Participantes Concurso'];
    const rows = (data[mainTab] || []).map(event => [event.fecha, event.codigoCliente, event.rut, event.cliente, (event.propietarios || []).map(p => p.nombre).join(', '),
      ...(recovered ? [event.ultimaCompra, event.diasInactividad, (event.reglas || []).map(r => `${r.vendedor}: ${r.dias} días`).join('; ')] : []),
      Number(event.ventaTotal), Number(event.cantidadFolios), event.compartida ? 'Compartida' : 'Directa',
      event.concurso?.participa ? (event.concurso.califica ? 'Califica' : event.concurso.motivo || 'No califica') : 'Fuera de concurso', Number(event.concurso?.puntos || 0),
      (event.concurso?.participantes || []).map(p => `${p.nombre}: ${p.puntos} pts; venta atribuida ${p.ventaMes}`).join(' | ')]);
    downloadXlsx(`Clientes_${recovered ? 'Recuperados' : 'Nuevos'}_${applied.desde}_${applied.hasta}.xlsx`, [headers, ...rows], [recovered ? 8 : 5]);
  }

  function exportAnnual() {
    if (!annualData || $('exportAnnual').disabled) return;
    const headers = ['Vendedor', ...monthNames.flatMap(month => [`${month} Cantidad`, `${month} Monto`]), 'Total Cantidad Año', 'Total Monto Año'];
    const rows = annualData.vendedores.map(vendor => [vendor.vendedor, ...vendor.meses.flatMap(month => [Number(month.cantidad), Number(month.venta)]), Number(vendor.cantidadAnual), Number(vendor.montoAnual)]);
    downloadXlsx(`Control_Clientes_${annualData.tipo === 'recuperados' ? 'Recuperados' : 'Nuevos'}_${annualData.anio}.xlsx`, [headers, ...rows], [...monthNames.map((_, i) => i * 2 + 2), 26]);
  }

  // Contenido informativo independiente de las reglas y consultas comerciales.
  let criteriaPromise = null;
  function loadClassificationCriteria() {
    if (!criteriaPromise) criteriaPromise = fetch('./criterios.json', { cache: 'no-cache' }).then(async response => {
      if (!response.ok) throw new Error('Criterios no disponibles.');
      const content = await response.json();
      if (content?.schemaVersion !== 1 || !Number.isInteger(content.versionActual) || content.versionActual < 1 || !Array.isArray(content.versiones)) throw new Error('Formato inválido.');
      const current = content.versiones.find(item => item?.version === content.versionActual);
      if (!current || typeof current.titulo !== 'string' || !current.titulo.trim()
        || typeof current.fechaVersion !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(current.fechaVersion)
        || new Date(current.fechaVersion + 'T00:00:00Z').toISOString().slice(0, 10) !== current.fechaVersion
        || !Array.isArray(current.secciones) || !current.secciones.length
        || !current.secciones.every(section => section && typeof section.titulo === 'string'
          && Array.isArray(section.contenido) && section.contenido.length && section.contenido.every(item => typeof item === 'string')
          && (section.introduccion == null || typeof section.introduccion === 'string'))) throw new Error('Versión inválida.');
      return current;
    }).catch(error => { criteriaPromise = null; throw error; });
    return criteriaPromise;
  }
  $('openCriteria').addEventListener('click', async () => {
    const button = $('openCriteria'), dialog = $('criteriaDialog');
    if (button.disabled) return;
    button.disabled = true;
    $('criteriaTitle').textContent = 'Criterios de clasificación'; $('criteriaVersion').textContent = '';
    $('criteriaContent').textContent = 'Cargando criterios…';
    dialog.setAttribute('aria-busy', 'true');
    if (!dialog.open) dialog.showModal();
    try {
      const criteria = await loadClassificationCriteria();
      $('criteriaTitle').textContent = criteria.titulo;
      $('criteriaVersion').textContent = 'Versión ' + criteria.version + ' · ' + date(criteria.fechaVersion);
      $('criteriaContent').innerHTML = criteria.secciones.map(section => '<section class="client-criteria-section"><h4>' + escape(section.titulo) + '</h4><p>' + escape(section.contenido[0]) + '</p>'
        + (section.introduccion ? '<p>' + escape(section.introduccion) + '</p>' : '')
        + (section.contenido.length > 1 ? '<ul>' + section.contenido.slice(1).map(item => '<li>' + escape(item) + '</li>').join('') + '</ul>' : '') + '</section>').join('');
    } catch (error) {
      $('criteriaVersion').textContent = '';
      $('criteriaContent').textContent = 'No fue posible cargar los criterios de clasificación.';
    } finally { button.disabled = false; dialog.setAttribute('aria-busy', 'false'); if (!dialog.open) button.focus(); }
  });
  ['closeCriteriaX', 'closeCriteria'].forEach(id => $(id).addEventListener('click', () => $('criteriaDialog').close()));
  $('criteriaDialog').addEventListener('close', () => $('openCriteria').focus());

  $('clientFilters').addEventListener('submit', event => { event.preventDefault(); loadReport(); });
  $('clearButton').addEventListener('click', () => { defaults(); loadReport(); });
  $('evolutionYear').addEventListener('change', loadEvolution);
  $('previousPage').addEventListener('click', () => { page--; renderTable(); });
  $('nextPage').addEventListener('click', () => { page++; renderTable(); });
  $('clientTableBody').addEventListener('click', event => { const button = event.target.closest('[data-event]'); if (button) showFolios(Number(button.dataset.event)); });
  $('closeFolios').addEventListener('click', () => $('foliosDialog').close());
  $('exportClients').addEventListener('click', exportClients);
  $('exportAnnual').addEventListener('click', exportAnnual);
  $('annualVendors').addEventListener('toggle', event => {
    const details = event.target;
    if (details.matches('.client-annual-vendor') && !details.open && activeMonthDetails === details) closeMonthDetail();
    if (!details.matches('.client-annual-vendor') || !details.open || details.dataset.rendered) return;
    const vendor = annualData?.vendedores[Number(details.dataset.vendorIndex)];
    if (!vendor) return;
    details.querySelector('.client-vendor-months').innerHTML = vendor.meses.map((month, index) => `<button type="button" class="client-vendor-month" data-month="${index + 1}" aria-pressed="false"${Number(month.cantidad) <= 0 ? ' disabled' : ''}><strong>${monthNames[index]}</strong><span>Cantidad: ${number(month.cantidad)}</span><span>Monto: ${money(month.venta)}</span></button>`).join('');
    details.dataset.rendered = 'true';
  }, true);
  $('annualVendors').addEventListener('click', event => {
    if (event.target.closest('[data-close-month-detail]')) { closeMonthDetail(); return; }
    const button = event.target.closest('[data-month]');
    if (button) showMonthDetail(button);
  });
  detailMobile.addEventListener('change', () => {
    $('annualVendors').querySelectorAll('.client-annual-vendor').forEach(details => {
      const button = details.querySelector('[data-month][aria-pressed="true"]');
      if (button) placeMonthDetail(details, details.querySelector('.client-month-detail'), button);
    });
  });
  document.querySelectorAll('[data-kind]').forEach(button => {
    button.addEventListener('click', () => {
      mainTab = button.dataset.kind;
      page = 0;
      document.querySelectorAll('[data-kind]').forEach(tab => { const active = tab === button; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
      $('clientPanel').setAttribute('aria-labelledby', button.id);
      renderTable();
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? $('tabNew') : event.key === 'End' ? $('tabRecovered') : button === $('tabNew') ? $('tabRecovered') : $('tabNew');
      next.focus(); next.click();
    });
  });
  document.querySelectorAll('[data-annual-kind]').forEach(button => {
    button.addEventListener('click', () => {
      annualTab = button.dataset.annualKind;
      document.querySelectorAll('[data-annual-kind]').forEach(tab => {
        const active = tab === button;
        tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
      });
      $('annualContent').setAttribute('aria-labelledby', button.id);
      loadEvolution();
    });
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? $('annualNew') : event.key === 'End' ? $('annualRecovered') : button === $('annualNew') ? $('annualRecovered') : $('annualNew');
      next.focus(); next.click();
    });
  });
  defaults();
  $('evolutionYear').innerHTML = `<option value="${today.getFullYear()}">${today.getFullYear()}</option>`;
  (async () => {
    try {
      const context = await window.appSidebarReady;
      if (!context) throw new Error('No fue posible cargar la sesión y los menús. Recargue la página para reintentar.');
      await loadReport({ initial: true });
    } catch (error) { setStatus(error.message, true); setLoading(false); }
  })();
})();
