'use strict';

(function () {
  const API = '/api/rrhh';
  const state = { items: [], summary: {}, chart: {}, vendorsLoaded: false, filters: null, detail: null, editId: null, saving: false, sort: { key: 'vendedorCompartido', direction: 'asc' } };
  let listSequence = 0, detailSequence = 0;
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value || 0));
  const number = value => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Number(value || 0));
  const percent = value => `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
  const dateLabel = value => value ? new Intl.DateTimeFormat('es-CL').format(new Date(`${value}T12:00:00`)) : '—';
  const normalize = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  function localIso(date) {
    const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, '0'); const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  function firstBusinessDay(date) {
    const result = new Date(date.getFullYear(), date.getMonth(), 1);
    if (result.getDay() === 6) result.setDate(3); else if (result.getDay() === 0) result.setDate(2);
    return result;
  }
  async function apiFetch(path, method = 'GET', body = null) {
    const response = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
    return payload;
  }
  function setLoading(active) { $('resultsRegion').classList.toggle('is-loading', active); $('refreshButton').disabled = active; $('exportButton').disabled = active || !state.filters; }

  function renderVendors(vendors) {
    if (state.vendorsLoaded) return;
    $('filterVendor').insertAdjacentHTML('beforeend', vendors.map(row => `<option value="${row.usuarioId}">${escapeHtml(row.vendedor)} (${escapeHtml(row.codigoPrincipal)})</option>`).join(''));
    state.vendorsLoaded = true;
  }
  function renderKpis(summary) {
    const cards = [
      ['Venta Compartida Total', money(summary.ventaCompartidaTotal), 'Monto original de folios'],
      ['Folios Compartidos', number(summary.foliosCompartidos), 'Folios distintos'],
      ['Folios Asignados', number(summary.foliosAsignados), 'Con al menos una asignación'],
      ['No Asignados', number(summary.noAsignados), 'Sin asignación', 'is-alert'],
      ['% Asignado', percent(summary.porcentajeAsignado), 'Folios asignados / total'],
      ['Monto No Asignado', money(summary.montoNoAsignado), 'Folios sin asignación', 'is-alert'],
    ];
    $('kpiGrid').innerHTML = cards.map(([label, value, hint, cls = '']) => `<article class="cvc-kpi ${cls}"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join('');
  }
  function renderChart(chart) {
    const data = [
      { label: 'Asignadas', value: Number(chart.asignadas || 0), color: '#16a34a' },
      { label: 'No asignadas', value: Number(chart.noAsignadas || 0), color: '#f59e0b' },
    ];
    const total = data.reduce((sum, row) => sum + row.value, 0); const canvas = $('stateChart'); const size = 150; const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio; canvas.height = size * ratio; canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, size, size); let angle = -Math.PI / 2;
    if (!total) { ctx.beginPath(); ctx.arc(75, 75, 56, 0, Math.PI * 2); ctx.strokeStyle = '#e3ecea'; ctx.lineWidth = 22; ctx.stroke(); }
    data.forEach(row => { if (!row.value) return; const arc = row.value / total * Math.PI * 2; ctx.beginPath(); ctx.arc(75, 75, 56, angle, angle + arc); ctx.strokeStyle = row.color; ctx.lineWidth = 22; ctx.stroke(); angle += arc; });
    $('stateTotal').textContent = number(total); $('stateLegend').innerHTML = data.map(row => `<div><i style="background:${row.color}"></i><span>${row.label}</span><strong>${number(row.value)}</strong></div>`).join('');
  }
  function badge(status) { const className = status === 'ASIGNADA' ? 'asignado' : 'pendiente'; return `<span class="cvc-badge cvc-badge--${className}">${status}</span>`; }
  function assignees(row) {
    if (!row.asignaciones?.length) return '—';
    if (row.asignaciones.length > 2) return `<strong>${row.asignaciones.length} asignaciones</strong><small>Ver detalle</small>`;
    return row.asignaciones.map(item => `<strong>${escapeHtml(item.vendedor || item.codigo)}</strong><small>${percent(item.porcentaje)}</small>`).join('');
  }
  function sortedRows(rows) {
    const { key, direction } = state.sort; const factor = direction === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => { const left = a[key]; const right = b[key]; let compared = typeof left === 'number' || typeof right === 'number' ? Number(left || 0) - Number(right || 0) : String(left || '').localeCompare(String(right || ''), 'es', { numeric: true, sensitivity: 'base' }); if (!compared && key === 'vendedorCompartido') compared = String(a.folio || '').localeCompare(String(b.folio || ''), 'es', { numeric: true }) || String(a.fecha || '').localeCompare(String(b.fecha || '')); return compared * factor; });
  }
  function visibleRows() {
    const search = normalize($('tableSearch').value);
    return sortedRows(state.items.filter(row => !search || normalize(`${row.folio} ${row.cliente} ${row.vendedorCompartido} ${row.codigoCompartido}`).includes(search)));
  }
  function renderTable() {
    const rows = visibleRows();
    $('salesBody').innerHTML = rows.map(row => `<tr data-id="${escapeHtml(row.id)}" tabindex="0"><td class="cvc-code"><strong>${escapeHtml(row.vendedorCompartido)}</strong><small>${escapeHtml(row.codigoCompartido)}</small></td><td><strong>${escapeHtml(row.folio)}</strong></td><td><span class="cvc-type">${escapeHtml(row.tipo)}</span></td><td>${dateLabel(row.fecha)}</td><td>${escapeHtml(row.cliente)}</td><td class="num">${money(row.ventaFolio)}</td><td>${badge(row.estado)}</td><td class="cvc-assignees">${assignees(row)}</td><td class="num">${percent(row.porcentaje)}</td><td class="num">${money(row.montoAsignado)}</td><td class="num">${percent(row.porcentajeRestante)}</td><td class="num">${money(row.montoRestanteOriginal)}</td><td><button class="cvc-detail-btn" type="button">Ver detalle</button></td></tr>`).join('');
    $('tableMessage').textContent = rows.length ? `${number(rows.length)} folios visibles` : 'No existen folios para los filtros seleccionados.';
    document.querySelectorAll('[data-sort]').forEach(button => { const active = button.dataset.sort === state.sort.key; button.classList.toggle('is-active', active); button.dataset.arrow = active ? (state.sort.direction === 'asc' ? '↑' : '↓') : ''; });
  }

  async function loadData() {
    const from = $('filterFrom').value; const to = $('filterTo').value; if (!from || !to || from > to) { $('tableMessage').textContent = 'Selecciona un rango de fechas válido.'; return; }
    const requestId = ++listSequence, filters = currentFilters();
    setLoading(true); $('tableMessage').textContent = '';
    const params = new URLSearchParams(filters);
    try { const data = await apiFetch(`/ventas-compartidas?${params}`); if (requestId !== listSequence) return; state.filters = filters; state.items = data.items || []; state.summary = data.resumen || {}; state.chart = data.estado || {}; renderVendors(data.vendedores || []); renderKpis(state.summary); renderChart(state.chart); renderTable(); }
    catch (error) { if (requestId !== listSequence) return; state.filters = null; state.items = []; renderKpis({}); renderChart({}); renderTable(); $('tableMessage').textContent = error.message; }
    finally { if (requestId === listSequence) setLoading(false); }
  }
  function currentFilters() { return { desde: $('filterFrom').value, hasta: $('filterTo').value, estado: $('filterStatus').value, vendedorId: $('filterVendor').value }; }
  function csvCell(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value).replace('.', ',') : '0';
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function exportCsv() {
    if (!state.filters || JSON.stringify(currentFilters()) !== JSON.stringify(state.filters)) { $('tableMessage').textContent = 'Pulse Actualizar para exportar los filtros seleccionados.'; return; }
    const rows = [['Vendedor Original', 'Código Original', 'Tipo Documento', 'Folio', 'Fecha', 'Cliente', 'Venta Folio', 'Estado', 'Vendedor Asignado', 'Código Asignado', 'Porcentaje Asignado', 'Monto Asignado', 'Porcentaje Total Asignado', 'Porcentaje Restante Original', 'Monto Restante Original']];
    visibleRows().forEach(row => (row.asignaciones?.length ? row.asignaciones : [{ vendedor: '', codigo: '', porcentaje: 0, monto: 0 }]).forEach(assignment => rows.push([row.vendedorCompartido, row.codigoCompartido, row.tipo, row.folio, row.fecha, row.cliente, Number(row.ventaFolio), row.estado, assignment.vendedor, assignment.codigo, Number(assignment.porcentaje), Number(assignment.monto), Number(row.porcentaje), Number(row.porcentajeRestante), Number(row.montoRestanteOriginal)])));
    const blob = new Blob(['\ufeff', rows.map(row => row.map(csvCell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `control_compartidos_${state.filters.desde}_${state.filters.hasta}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function detailTable(products) {
    return `<div class="cvc-detail-table"><table><thead><tr><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Total</th></tr></thead><tbody>${products.map(row => `<tr><td>${escapeHtml(row.codigo)}</td><td>${escapeHtml(row.producto)}</td><td class="num">${number(row.cantidad)}</td><td class="num">${money(row.precio)}</td><td class="num">${money(row.total)}</td></tr>`).join('')}</tbody><tfoot><tr><th colspan="4" class="num">TOTAL FOLIO</th><th class="num">${money(products.reduce((sum, row) => sum + Number(row.total || 0), 0))}</th></tr></tfoot></table></div>`;
  }
  function assignmentSection(data) {
    const head = data.cabecera, assignments = data.asignaciones || [], summary = data.resumen || {};
    return `<section class="cvc-detail-section"><h3>Asignación de Venta Compartida</h3>${assignments.length ? `<div class="cvc-detail-table"><table><thead><tr><th>Vendedor</th><th class="num">%</th><th class="num">Monto</th><th>Acción</th></tr></thead><tbody>${assignments.map(row => `<tr><td>${escapeHtml(row.vendedor || row.codigo)}</td><td class="num">${percent(row.porcentaje)}</td><td class="num">${money(row.monto)}</td><td><button type="button" class="cvc-detail-btn" data-edit-assignment="${Number(row.id)}">Editar</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="cvc-pending"><strong>NO ASIGNADA</strong><span>No existen asignaciones para este folio.</span></div>'}
      <div class="cvc-summary"><div><span>Total asignado a otros</span><strong>${percent(summary.porcentajeAsignado)}</strong></div><div><span>Monto asignado</span><strong>${money(summary.montoAsignado)}</strong></div><div><span>Vendedor original conserva</span><strong>${percent(summary.porcentajeRestante)}</strong></div><div><span>Monto restante original</span><strong>${money(summary.montoRestanteOriginal)}</strong></div></div></section>
      <section class="cvc-detail-section"><h3 id="assignmentHeading">Gestión de asignación</h3><p>Vendedor original: ${escapeHtml(head.vendedorCompartido)} · Código origen: ${escapeHtml(head.codigoCompartido)} · Venta total: ${money(head.ventaTotal)}</p>
      <form id="assignmentForm"><fieldset id="assignmentFields" class="cvc-assignment-fields"><label>Asignar a<select id="assignmentRecipient" required><option value="">Seleccione un vendedor</option>${(data.receptores || []).map(vendor => `<option value="${escapeHtml(vendor.cod)}">${escapeHtml(vendor.nombre)} (${escapeHtml(vendor.cod)})</option>`).join('')}</select></label><label>Porcentaje (%)<input id="assignmentPercentage" type="number" min="1" max="100" step="1" value="50" required /></label><div class="cvc-assignment-actions"><button type="submit" class="cvc-detail-btn cvc-save" id="assignmentSave">Guardar asignación</button><button type="button" class="cvc-detail-btn" id="assignmentCancel" hidden>Cancelar edición</button></div></fieldset><div class="cvc-summary" id="assignmentPreview" aria-live="polite"></div><p class="cvc-message" id="assignmentStatus" role="status"></p></form></section>`;
  }
  async function openDetail(id, fallback = null) {
    const item = state.items.find(row => row.id === id) || fallback; if (!item) return;
    const requestId = ++detailSequence; state.detail = null; state.editId = null;
    $('detailModal').classList.add('is-open'); $('detailModal').setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; $('detailTitle').textContent = `Folio ${item.folio}`; $('detailNotice').textContent = ''; $('detailContent').innerHTML = '<p>Cargando detalle…</p>';
    try {
      const params = new URLSearchParams({ tipo: item.tipo, folio: item.folio, codigo: item.codigoCompartido, fecha: item.fecha });
      const data = await apiFetch(`/ventas-compartidas/detalle?${params}`); if (requestId !== detailSequence) return;
      state.detail = { item, data }; const head = data.cabecera;
      $('detailContent').innerHTML = `<section class="cvc-detail-head"><div><span>Folio</span><strong>${escapeHtml(head.folio)}</strong></div><div><span>Tipo</span><strong>${escapeHtml(head.tipo)}</strong></div><div><span>Fecha</span><strong>${dateLabel(head.fecha)}</strong></div><div><span>Cliente</span><strong>${escapeHtml(head.cliente)}</strong></div><div><span>Código origen</span><strong>${escapeHtml(head.codigoCompartido)}</strong></div><div><span>Vendedor original</span><strong>${escapeHtml(head.vendedorCompartido)}</strong></div><div><span>Venta Total</span><strong>${money(head.ventaTotal)}</strong></div></section><section class="cvc-detail-section"><h3>Detalle de Productos</h3>${detailTable(data.productos || [])}</section>${assignmentSection(data)}`;
      $('assignmentForm').addEventListener('submit', saveAssignment);
      $('assignmentPercentage').addEventListener('input', previewAssignment);
      $('assignmentCancel').addEventListener('click', () => editAssignment(null));
      previewAssignment();
    } catch (error) { if (requestId === detailSequence) $('detailContent').innerHTML = `<p class="cvc-message">${escapeHtml(error.message)}</p>`; }
  }
  function editAssignment(id) {
    if (state.saving || !state.detail) return;
    const row = state.detail.data.asignaciones.find(item => item.id === id);
    state.editId = row?.id || null;
    $('assignmentRecipient').value = row?.codigo || ''; $('assignmentPercentage').value = row?.porcentaje ?? 50;
    $('assignmentHeading').textContent = row ? 'Modificar asignación' : 'Gestión de asignación';
    $('assignmentSave').textContent = row ? 'Guardar cambios' : 'Guardar asignación'; $('assignmentCancel').hidden = !row;
    $('assignmentStatus').textContent = ''; previewAssignment(); $('assignmentRecipient').focus();
  }
  function previewAssignment() {
    if (!state.detail) return;
    const data = state.detail.data, input = $('assignmentPercentage'), percentage = Number(input.value || 0);
    const others = (data.asignaciones || []).filter(row => row.id !== state.editId);
    const otherPercentage = others.reduce((sum, row) => sum + Number(row.porcentaje), 0);
    const base = Number(data.cabecera.ventaTotal), raw = base * percentage / 100;
    const assigned = Math.sign(raw) * Math.round(Math.abs(raw));
    const totalPercentage = otherPercentage + percentage, totalAssigned = others.reduce((sum, row) => sum + Number(row.monto), 0) + assigned;
    input.setCustomValidity(totalPercentage > 100.000001 ? 'La suma de participaciones del documento no puede superar 100%.' : '');
    $('assignmentPreview').innerHTML = `<div><span>Monto de esta asignación</span><strong>${money(assigned)}</strong></div><div><span>Total asignado a otros</span><strong>${percent(totalPercentage)}</strong></div><div><span>Vendedor original conserva</span><strong>${percent(Math.max(0, 100 - totalPercentage))}</strong></div><div><span>Monto que conserva</span><strong>${money(base - totalAssigned)}</strong></div>`;
  }
  async function saveAssignment(event) {
    event.preventDefault(); if (state.saving || !state.detail) return;
    previewAssignment(); if (!$('assignmentForm').reportValidity()) return;
    const item = state.detail.item, id = state.editId;
    const body = { tipo: item.tipo, folio: item.folio, fecha: item.fecha, codigo_origen: item.codigoCompartido, cod_vendedor_compartido: $('assignmentRecipient').value, porcentaje: Number($('assignmentPercentage').value) };
    state.saving = true; $('assignmentFields').disabled = true; $('assignmentSave').disabled = true; $('closeDetail').disabled = true; $('assignmentStatus').textContent = 'Guardando asignación…';
    try {
      await apiFetch(id ? `/ventas-compartidas/asignaciones/${id}` : '/ventas-compartidas/asignar', id ? 'PUT' : 'POST', body);
      await loadData(); await openDetail(item.id, item);
      $('detailNotice').textContent = 'Asignación guardada. Se actualizaron el detalle y el control; revise cualquier aviso de carga.';
    } catch (error) { if ($('assignmentStatus')) $('assignmentStatus').textContent = error.message; }
    finally { state.saving = false; $('closeDetail').disabled = false; if ($('assignmentFields')) $('assignmentFields').disabled = false; if ($('assignmentSave')) $('assignmentSave').disabled = false; }
  }
  function closeDetail() { if (state.saving) return; detailSequence++; state.detail = null; $('detailModal').classList.remove('is-open'); $('detailModal').setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }

  document.addEventListener('DOMContentLoaded', () => {
    const today = new Date(); $('filterFrom').value = localIso(firstBusinessDay(today)); $('filterTo').value = localIso(today);
    $('refreshButton').addEventListener('click', loadData); $('tableSearch').addEventListener('input', renderTable);
    $('exportButton').addEventListener('click', exportCsv);
    $('detailContent').addEventListener('click', event => { const button = event.target.closest('[data-edit-assignment]'); if (button) editAssignment(Number(button.dataset.editAssignment)); });
    document.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.sort; state.sort.direction = state.sort.key === key && state.sort.direction === 'asc' ? 'desc' : 'asc'; state.sort.key = key; renderTable(); }));
    $('salesBody').addEventListener('click', event => { const row = event.target.closest('tr[data-id]'); if (row) openDetail(row.dataset.id); }); $('salesBody').addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-id]')) openDetail(event.target.dataset.id); });
    $('closeDetail').addEventListener('click', closeDetail); $('detailModal').addEventListener('click', event => { if (event.target === $('detailModal')) closeDetail(); }); document.addEventListener('keydown', event => { if (event.key === 'Escape') closeDetail(); });
    $('btnLogout')?.addEventListener('click', () => { localStorage.removeItem('token'); window.location.href = '../../varios/login/index.html'; });
    loadData();
  });
})();
