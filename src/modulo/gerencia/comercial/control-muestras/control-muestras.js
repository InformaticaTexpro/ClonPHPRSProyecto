'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const clp = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const count = value => new Intl.NumberFormat('es-CL', { maximumFractionDigits: 6 }).format(Number(value) || 0);
  const pct = value => new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Number(value) || 0) + ' %';
  const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fecha = value => String(value || '').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
  const colors = ['#00b284', '#45B7D1', '#F5A623', '#9b7fd3', '#F06543', '#4ECDC4', '#708090'];
  const charts = {};
  let vendedores = new Map();
  let filtros = null;
  let sequence = 0;
  let detailSequence = 0;
  let mainAbort = null;
  let detailAbort = null;
  let sortKey = 'valorMuestras';
  let sortDirection = 'desc';
  let sortTouched = false;
  let busy = false;
  let catalogLoaded = false;
  let focusedBefore = null;

  async function api(path, params, signal) {
    const response = await fetch('/api/gerencia/comercial/' + path + '?' + new URLSearchParams(params), {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000),
      headers: { Authorization: 'Bearer ' + (localStorage.getItem('token') || ''), Accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.ok === false) throw new Error('No fue posible cargar el Control de Muestras.');
    return body.data ?? body;
  }

  function destroy(name) { charts[name]?.destroy(); delete charts[name]; }
  function lineRows(rows) {
    return rows.length ? rows.map(row => `<tr><td>${escape(row.linea)}</td><td class="numero">${clp(row.monto)}</td><td class="numero">${pct(row.participacion)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="tabla-empty">Sin muestras en el período.</td></tr>';
  }

  function donut(name, canvas, rows, estado) {
    destroy(name);
    const negativos = rows.some(row => Number(row.monto) < 0);
    const visible = rows.some(row => Number(row.monto) > 0) && !negativos;
    $(canvas).hidden = !visible;
    $(estado).textContent = negativos ? 'La distribución contiene ajustes negativos; consulte los importes de la tabla.' : visible ? '' : 'Sin muestras en el período.';
    if (!visible) return;
    if (typeof Chart === 'undefined') { $(estado).textContent = 'No fue posible cargar el gráfico. Los importes están disponibles en la tabla.'; return; }
    charts[name] = new Chart($(canvas), {
      type: 'doughnut', data: { labels: rows.map(row => row.linea), datasets: [{ data: rows.map(row => row.monto), backgroundColor: rows.map((_, i) => colors[i % colors.length]), borderWidth: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => context.label + ': ' + clp(context.raw) } } } },
    });
  }

  function evolution(rows) {
    destroy('evolucion');
    $('chartEvolucion').hidden = !rows.length;
    $('evolucionEstado').textContent = rows.length ? '' : 'Sin muestras en el período.';
    if (!rows.length) return;
    if (typeof Chart === 'undefined') { $('evolucionEstado').textContent = 'No fue posible cargar el gráfico.'; return; }
    const days = new Map(rows.map(row => [row.fecha, row]));
    const values = [];
    const end = new Date(filtros.hasta + 'T12:00:00Z');
    const start = new Date(filtros.desde + 'T12:00:00Z');
    // Para rangos muy extensos conservar los dias con actividad sin crear millones de puntos vacios.
    if ((end - start) / 86400000 > 3660) {
      values.push(...rows);
    } else {
      for (let date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
        const key = date.toISOString().slice(0, 10);
        values.push(days.get(key) || { fecha: key, valorMuestras: 0, ventaPotencial: 0 });
      }
    }
    charts.evolucion = new Chart($('chartEvolucion'), {
      type: 'line', data: { labels: values.map(row => fecha(row.fecha)), datasets: [
        { label: 'Valor de Muestras', data: values.map(row => row.valorMuestras), borderColor: colors[0], backgroundColor: colors[0], tension: .2, pointRadius: values.length > 60 ? 0 : 3 },
        { label: 'Venta Potencial PRODIN', data: values.map(row => row.ventaPotencial), borderColor: colors[1], backgroundColor: colors[1], tension: .2, pointRadius: values.length > 60 ? 0 : 3 },
      ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false }, scales: { y: { ticks: { callback: clp } }, x: { ticks: { maxTicksLimit: 10 } } }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: context => context.dataset.label + ': ' + clp(context.parsed.y) } } } },
    });
  }

  function closeDistribution(restore = false) {
    const modal = $('distribucionLayer').classList.contains('is-modal');
    $('distribucionLayer').hidden = true;
    destroy('distribucion');
    if (modal && $('detalleLayer').hidden) document.body.style.overflow = '';
    if (restore && modal) focusedBefore?.focus();
  }

  function closeDetail(restore = true) {
    detailSequence += 1;
    detailAbort?.abort();
    const abierto = !$('detalleLayer').hidden;
    $('detalleLayer').hidden = true;
    $('detalleBody').innerHTML = '';
    if ($('distribucionLayer').hidden) document.body.style.overflow = '';
    if (abierto && restore) focusedBefore?.focus();
  }

  function showDistribution(id, source) {
    if (busy || !filtros || !$('detalleLayer').hidden) return;
    const vendedor = vendedores.get(Number(id));
    if (!vendedor) return;
    closeDistribution();
    $('distribucionSubtitulo').textContent = `${vendedor.vendedor} (${vendedor.codigoPrincipal}) · ${fecha(filtros.desde)} – ${fecha(filtros.hasta)}`;
    $('distribucionBody').innerHTML = lineRows(vendedor.lineas || []);
    $('distribucionLayer').hidden = false;
    donut('distribucion', 'chartDistribucion', vendedor.lineas || [], 'distribucionEstado');
    focusedBefore = source;
    document.body.style.overflow = 'hidden';
    $('distribucionCerrar').focus();
  }

  async function showDetail(id, source) {
    if (busy || !filtros) return;
    const vendedor = vendedores.get(Number(id));
    if (!vendedor) return;
    closeDistribution(); closeDetail(false);
    focusedBefore = source;
    const current = ++detailSequence;
    detailAbort = new AbortController();
    $('detalleSubtitulo').textContent = `${vendedor.vendedor} (${vendedor.codigoPrincipal}) · ${fecha(filtros.desde)} – ${fecha(filtros.hasta)}`;
    $('detalleEstado').textContent = 'Cargando detalle...';
    ['detalleFolios', 'detalleMuestras', 'detallePotencial', 'detalleDiferencia'].forEach(key => { $(key).textContent = '—'; });
    $('detalleLayer').hidden = false; document.body.style.overflow = 'hidden'; $('detalleCerrar').focus();
    try {
      const data = await api('control-muestras/vendedor-detalle', { ...filtros, vendedorId: id }, detailAbort.signal);
      if (current !== detailSequence) return;
      const items = data.items || [];
      $('detalleEstado').textContent = items.length ? '' : 'No existen muestras para el período seleccionado.';
      $('detalleBody').innerHTML = items.map(item => `<tr><td>${escape(item.folio)}</td><td>${escape(fecha(item.fecha))}</td><td>${escape(item.producto)}</td><td class="numero">${count(item.cantidad)}</td><td class="numero">${clp(item.valorMuestras)}</td><td class="numero">${clp(item.ventaPotencial)}</td><td>${escape(item.linea)}</td></tr>`).join('');
      $('detalleFolios').textContent = count(data.resumen.folios);
      $('detalleMuestras').textContent = clp(data.resumen.valorMuestras);
      $('detallePotencial').textContent = clp(data.resumen.ventaPotencial);
      $('detalleDiferencia').textContent = clp(data.resumen.diferencia);
    } catch (error) {
      if (current === detailSequence && error.name !== 'AbortError') $('detalleEstado').textContent = 'No fue posible cargar el detalle de muestras.';
    }
  }

  function clearResults() {
    filtros = null; vendedores.clear();
    closeDistribution(); closeDetail(false);
    Object.keys(charts).forEach(destroy);
    ['kpiFolios', 'kpiMuestras', 'kpiPotencial', 'kpiDiferencia', 'kpiPorcentaje'].forEach(id => { $(id).textContent = '—'; });
    ['lineasBody', 'lineasFoot', 'vendedoresBody'].forEach(id => { $(id).innerHTML = ''; });
    $('controlAvisos').hidden = true;
    $('evolucionEstado').textContent = ''; $('lineasEstado').textContent = '';
  }

  function render(data) {
    filtros = { desde: data.filtros.desde, hasta: data.filtros.hasta };
    if (data.filtros.vendedorId) filtros.vendedorId = data.filtros.vendedorId;
    const r = data.resumen;
    $('kpiFolios').textContent = count(r.folios); $('kpiMuestras').textContent = clp(r.valorMuestras);
    $('kpiPotencial').textContent = clp(r.ventaPotencial); $('kpiDiferencia').textContent = clp(r.diferencia); $('kpiPorcentaje').textContent = pct(r.porcentajeDiferencia);
    $('controlAvisos').textContent = (data.advertencias || []).join(' '); $('controlAvisos').hidden = !data.advertencias?.length;
    $('controlEstado').textContent = r.folios ? `${fecha(filtros.desde)} – ${fecha(filtros.hasta)}` : 'No existen muestras para el período seleccionado.';
    evolution(data.evolucion || []); donut('lineas', 'chartLineas', data.lineas || [], 'lineasEstado');
    $('lineasBody').innerHTML = lineRows(data.lineas || []);
    $('lineasFoot').innerHTML = `<tr><th>TOTAL</th><th class="numero">${clp(r.valorMuestras)}</th><th class="numero">${pct(r.valorMuestras ? 100 : 0)}</th></tr>`;
    vendedores = new Map((data.vendedores || []).map(v => [Number(v.usuarioId), v]));
    renderVendedores();
  }

  function renderVendedores() {
    const rows = [...vendedores.values()].sort((a, b) => {
      const order = sortKey === 'vendedor' ? a.vendedor.localeCompare(b.vendedor, 'es') : Number(a[sortKey]) - Number(b[sortKey]);
      return (sortDirection === 'asc' ? order : -order) || Number(a.usuarioId) - Number(b.usuarioId);
    });
    document.querySelectorAll('[data-sort]').forEach(button => {
      const active = button.dataset.sort === sortKey;
      button.closest('th').setAttribute('aria-sort', active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
      button.querySelector('.control-sort-icon').textContent = active ? (sortDirection === 'asc' ? '↑' : '↓') : '↕';
    });
    $('vendedoresBody').innerHTML = rows.length ? rows.map(v => `<tr data-vendedor="${Number(v.usuarioId)}" data-usuario-id="${Number(v.usuarioId)}"><td><button class="control-name" data-detail="${Number(v.usuarioId)}" aria-haspopup="dialog" aria-controls="detalleLayer">${escape(v.vendedor)} (${escape(v.codigoPrincipal)})</button></td><td class="numero">${count(v.folios)}</td><td class="numero">${clp(v.valorMuestras)}</td><td class="numero">${clp(v.ventaPotencial)}</td><td class="numero">${clp(v.diferencia)}</td><td class="numero">${pct(v.porcentajeDiferencia)}</td><td class="control-accion"><button class="control-action" data-distribution="${Number(v.usuarioId)}" data-usuario-id="${Number(v.usuarioId)}" aria-haspopup="dialog" aria-controls="distribucionLayer">Ver distribución</button></td></tr>`).join('') : '<tr><td colspan="7" class="tabla-empty">No existen muestras para el período seleccionado.</td></tr>';
  }

  function setLoading(value) {
    busy = value;
    $('controlLoading').hidden = !value;
    $('controlMuestrasResultados').setAttribute('aria-busy', String(value));
    $('controlMuestrasResultados').classList.toggle('is-loading', value);
    $('controlResultadosContenido').inert = value;
    $('controlFiltros').querySelectorAll('input,select,button').forEach(el => { el.disabled = value; });
    $('btnActualizar').textContent = value ? 'Cargando...' : 'Actualizar';
  }
  async function actualizar(event) {
    event?.preventDefault();
    if (busy) return;
    const desde = $('desdeFilter').value, hasta = $('hastaFilter').value;
    if (!desde || !hasta || desde > hasta) { clearResults(); $('controlEstado').textContent = 'Seleccione un rango de fechas válido: Desde debe ser anterior o igual a Hasta.'; return; }
    const current = ++sequence;
    mainAbort?.abort(); mainAbort = new AbortController();
    setLoading(true);
    try {
      clearResults(); $('controlEstado').textContent = 'Cargando Control de Muestras...';
      if (!catalogLoaded) {
        const catalog = await api('vendedores-principales', {}, mainAbort.signal);
        if (current !== sequence) return;
        $('vendedorFilter').innerHTML = '<option value="">TODOS</option>' + catalog.vendedores.map(v => `<option value="${Number(v.usuarioId)}">${escape(v.nombre)} (${escape(v.codigoPrincipal)})</option>`).join('');
        catalogLoaded = true;
      }
      const params = { desde, hasta }; if ($('vendedorFilter').value) params.vendedorId = $('vendedorFilter').value;
      const data = await api('control-muestras', params, mainAbort.signal);
      if (current === sequence) render(data);
    } catch (error) {
      if (current === sequence && error.name !== 'AbortError') $('controlEstado').textContent = 'No fue posible cargar el Control de Muestras.';
    } finally { if (current === sequence) setLoading(false); }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const now = new Date();
    const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    $('desdeFilter').value = iso(new Date(now.getFullYear(), now.getMonth(), 1)); $('hastaFilter').value = iso(now);
    $('headerDate').textContent = now.toLocaleDateString('es-CL', { dateStyle: 'long' });
    $('controlFiltros').addEventListener('submit', actualizar);
    ['vendedorFilter', 'desdeFilter', 'hastaFilter'].forEach(id => $(id).addEventListener('change', () => { sequence += 1; mainAbort?.abort(); setLoading(false); clearResults(); $('controlEstado').textContent = 'Presione Actualizar para consultar los filtros seleccionados.'; }));
    document.querySelector('.control-vendedores thead').addEventListener('click', event => {
      const button = event.target.closest('[data-sort]');
      if (!button || busy || !filtros) return;
      const key = button.dataset.sort;
      sortDirection = sortTouched && sortKey === key && sortDirection === 'asc' ? 'desc' : 'asc';
      sortKey = key; sortTouched = true;
      renderVendedores();
    });
    $('vendedoresBody').addEventListener('click', event => {
      const distribution = event.target.closest('[data-distribution]');
      if (distribution) {
        event.stopPropagation();
        showDistribution(distribution.dataset.usuarioId, distribution);
        return;
      }
      const row = event.target.closest('[data-usuario-id]');
      if (row) showDetail(row.dataset.usuarioId, row.querySelector('[data-detail]'));
    });
    $('distribucionCerrar').addEventListener('click', () => closeDistribution(true));
    $('detalleCerrar').addEventListener('click', () => closeDetail());
    for (const [id, close] of [['distribucionLayer', () => closeDistribution(true)], ['detalleLayer', () => closeDetail()]]) {
      $(id).addEventListener('click', event => { if (event.target === $(id) && $(id).classList.contains('is-modal')) close(); });
      $(id).addEventListener('keydown', event => {
        if (event.key !== 'Tab' || !$(id).classList.contains('is-modal')) return;
        const controls = [...$(id).querySelectorAll('button,a,input,select,[tabindex="0"]')].filter(el => !el.disabled);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
    }
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { if (!$('detalleLayer').hidden) closeDetail(); else closeDistribution(true); } });
    await actualizar();
  });
})();
