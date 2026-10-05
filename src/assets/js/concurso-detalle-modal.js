'use strict';

(function () {
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const categoryLabels = { QUIMICOS: 'Químicos', ACCESORIOS: 'Accesorios', TRAT_AGUA: 'Trat. Agua', AEROSOLES: 'Aerosoles', OTROS: 'Otros / no puntúa' };
  const $ = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value) || 0);
  const signedMoney = value => Number(value) > 0 ? `+${money(value)}` : money(value);
  const percent = value => `${Number(value || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;
  const metaPercent = value => `${Number(value || 0).toLocaleString('es-CL', { maximumFractionDigits: 0 })}%`;
  const formatPoints = value => Number(value || 0).toLocaleString('es-CL', { maximumFractionDigits: 2 });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const loadingMarkup = '<div class="concurso-detail-loading"><div class="gerencia-loading-card"><div class="gerencia-loading-spinner" aria-hidden="true"></div><div class="gerencia-loading-copy"><strong>Cargando datos...</strong></div></div></div>';

  let row = null;
  let rendered = null;
  let periodo = '';
  let activeView = 'mes';
  let apiBase = '/api/gerencia/comercial/concurso-ventas';
  let selectedKind = '';
  let clientRows = [];
  let expandedClient = null;
  let detailSequence = 0;
  let folioSequence = 0;
  let productSequence = 0;
  let onCloseCallback = null;

  function ensureModal() {
    if ($('concursoDetalleModal')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'concursoDetalleModal';
    dialog.className = 'concurso-modal concurso-detalle-modal';
    dialog.innerHTML = `
      <header class="concurso-modal-header">
        <div class="concurso-modal-title">
          <h3 id="cdmTitulo">Detalle Concurso</h3>
          <p id="cdmSubtitulo">-</p>
        </div>
        <button class="btn-buscar concurso-modal-close" id="cdmCerrarX" type="button" aria-label="Cerrar detalle">×</button>
      </header>
      <div class="concurso-modal-body">
      <section class="concurso-resumen-puntos" aria-label="Resumen de puntos">
        <article class="concurso-total-card"><span>Puntos del mes</span><strong id="cdmTotalMes">0 pts</strong></article>
        <div class="concurso-resumen-grid">
          <article><span>Cumplimiento</span><strong id="cdmPuntosMeta">0 pts</strong><small id="cdmTramoMes">Tramo: —</small></article>
          <article><span>Clientes Nuevos</span><strong id="cdmPuntosNuevos">0 pts</strong></article>
          <article><span>Clientes Recuperados</span><strong id="cdmPuntosRecuperados">0 pts</strong></article>
          <article><span>Productos</span><strong id="cdmPuntosProductos">0 pts</strong></article>
        </div>
      </section>
      <nav id="cdmTabs" class="concurso-tabs" aria-label="Categorías del concurso">
        <button class="btn-buscar" type="button" data-cdm-tab="cumplimiento" aria-pressed="true">Cumplimiento</button>
        <button class="btn-buscar" type="button" data-cdm-tab="nuevos" aria-pressed="false">Clientes Nuevos</button>
        <button class="btn-buscar" type="button" data-cdm-tab="recuperados" aria-pressed="false">Clientes Recuperados</button>
        <button class="btn-buscar" type="button" data-cdm-tab="productos" aria-pressed="false">Productos</button>
      </nav>
      <p id="cdmCategoriaResumen" class="gerencia-subtitulo concurso-tab-summary"></p>
      <section id="cdmAcumulado" class="tabla-card concurso-detail-section" hidden aria-label="Resumen por mes">
        <h4>Resumen por mes</h4>
        <div class="tabla-wrapper"><table class="dash-tabla"><thead><tr><th>Mes</th><th>Tramo</th><th class="numero">Meta pts</th><th class="numero">Nuevos pts</th><th class="numero">Recuperados pts</th><th class="numero">Productos pts</th><th class="numero">Total mes</th><th class="numero">Acumulado</th></tr></thead><tbody id="cdmAcumuladoBody"></tbody></table></div>
      </section>
      <section id="cdmCumplimiento" class="tabla-card concurso-detail-section" hidden></section>
      <section id="cdmClientes" class="tabla-card concurso-detail-section" hidden>
        <h4 id="cdmClientesTitulo"></h4><div id="cdmClientesEstado" role="status" aria-live="polite"></div>
        <div class="tabla-wrapper concurso-clientes-wrapper"><table class="dash-tabla concurso-detail-table"><thead id="cdmClientesHead"></thead><tbody id="cdmClientesBody"></tbody></table></div>
      </section>
      <section id="cdmProductos" class="tabla-card concurso-detail-section" hidden>
        <p id="cdmProductosEstado" role="status" aria-live="polite"></p>
        <div class="tabla-wrapper"><table class="dash-tabla concurso-detail-table"><thead><tr><th>Categoría</th><th class="numero">Promedio base</th><th class="numero">Venta mes</th><th class="numero">Superación</th><th class="numero">Puntos</th><th>Acción</th></tr></thead><tbody id="cdmProductosBody"></tbody></table></div>
        <div id="cdmProductoDetalle" hidden><h4 id="cdmProductoDetalleTitulo"></h4><div id="cdmProductoDetalleEstado" role="status" aria-live="polite"></div><div class="tabla-wrapper"><table class="dash-tabla"><thead id="cdmProductoDetalleHead"></thead><tbody id="cdmProductoDetalleBody"></tbody></table></div></div>
      </section>
      <section id="cdmFolios" class="tabla-card concurso-detail-section" hidden>
        <h4 id="cdmFoliosTitulo"></h4><div id="cdmFoliosEstado" role="status" aria-live="polite"></div>
        <div class="tabla-wrapper"><table class="dash-tabla"><thead><tr><th>Tipo</th><th>Folio</th><th>Fecha</th><th>Código vendedor</th><th>Atribución</th><th class="numero">Venta original</th><th class="numero">% atribuido</th><th class="numero">Venta atribuida</th></tr></thead><tbody id="cdmFoliosBody"></tbody></table></div>
        <p id="cdmFoliosTotal"></p>
      </section>
      </div>
      <footer class="concurso-modal-footer"><button class="btn-buscar" id="cdmCerrar" type="button">Cerrar</button></footer>
    `;
    document.body.appendChild(dialog);
    $('cdmCerrarX').addEventListener('click', close);
    $('cdmCerrar').addEventListener('click', close);
    dialog.addEventListener('close', () => {
      clearClients();
      onCloseCallback?.();
      onCloseCallback = null;
    });
    $('cdmTabs').addEventListener('click', event => {
      const button = event.target.closest('[data-cdm-tab]');
      if (button) selectTab(button.dataset.cdmTab);
    });
    $('cdmClientesBody').addEventListener('click', event => {
      const button = event.target.closest('[data-folios]');
      if (button) showFolios(Number(button.dataset.folios));
    });
    $('cdmProductosBody').addEventListener('click', event => {
      const sale = event.target.closest('[data-product-sale]');
      const base = event.target.closest('[data-product-base]');
      if (sale) showProductDetail(sale.dataset.productSale, 'venta', sale);
      else if (base) showProductDetail(base.dataset.productBase, 'base', base);
    });
  }

  function close() {
    const modal = $('concursoDetalleModal');
    if (modal?.open) modal.close();
  }

  function points(value) {
    return `${value == null ? '—' : formatPoints(value)} pts`;
  }

  function renderSummary() {
    const total = row?.totalMes ?? row?.puntosMes ?? 0;
    $('cdmTotalMes').textContent = points(total);
    $('cdmPuntosMeta').textContent = points(row?.puntosMeta ?? 0);
    $('cdmTramoMes').textContent = `Tramo: ${row?.tramo || row?.tipo || '—'}`;
    $('cdmPuntosNuevos').textContent = points(row?.puntosNuevos ?? 0);
    $('cdmPuntosRecuperados').textContent = points(row?.puntosRecuperados ?? 0);
    $('cdmPuntosProductos').textContent = points(row?.productosPuntos ?? 0);
  }

  function renderCumplimiento() {
    const breakdown = row.desgloseVenta || {};
    const meta = [
      ['Meta', money(row.meta)], ['Venta atribuida', money(row.venta)],
      ['Cumplimiento', metaPercent(row.cumplimiento)], ['Tramo aplicado', row.tramo || '—'], ['Puntos', points(row.puntosMeta)],
    ];
    const attribution = [
      ['Venta base', money(breakdown.baseAsociada)], ['Compartida recibida', money(breakdown.compartidaRecibida)],
      ['Compartida cedida', money(breakdown.compartidaCedida)], ['Total atribuido', money(row.venta)],
    ];
    const block = (title, values) => `<article class="concurso-info-block"><h4>${title}</h4><dl>${values.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl></article>`;
    $('cdmCumplimiento').innerHTML = `<div class="concurso-info-grid">${block('Resumen meta', meta)}${block('Atribución de venta', attribution)}</div>`;
  }

  function resetDetailAreas() {
    $('cdmCumplimiento').hidden = true;
    $('cdmClientes').hidden = true;
    $('cdmProductos').hidden = true;
    $('cdmAcumulado').hidden = true;
    $('cdmProductoDetalle').hidden = true;
  }

  function clearClients() {
    detailSequence += 1;
    closeFolios();
    $('cdmClientes').hidden = true;
    clientRows = [];
  }

  function closeFolios() {
    folioSequence += 1;
    $('cdmFolios').hidden = true;
    $('concursoDetalleModal')?.appendChild($('cdmFolios'));
    $('cdmClientesBody')?.querySelector('.concurso-folios-fila')?.remove();
    const button = $('cdmClientesBody')?.querySelector('[data-folios][aria-expanded="true"]');
    if (button) { button.disabled = false; button.setAttribute('aria-expanded', 'false'); button.textContent = 'Ver folios'; }
    expandedClient = null;
  }

  function selectTab(kind) {
    clearClients();
    productSequence += 1;
    resetDetailAreas();
    document.querySelectorAll('[data-cdm-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cdmTab === kind)));
    $('cdmCategoriaResumen').textContent = kind === 'cumplimiento' ? points(row.puntosMeta)
      : kind === 'nuevos' ? `${row.clientesNuevos ?? 0} clientes válidos · ${points(row.puntosNuevos)}`
        : kind === 'recuperados' ? `${row.clientesRecuperados ?? 0} clientes válidos · ${points(row.puntosRecuperados)}`
          : row.productosPuntos === null ? row.productosEstadoBase : points(row.productosPuntos);
    if (kind === 'cumplimiento') { $('cdmCumplimiento').hidden = false; renderCumplimiento(); }
    else if (kind === 'productos') { $('cdmProductos').hidden = false; showProducts(); }
    else showClients(kind);
  }

  function showProducts() {
    $('cdmProductosEstado').textContent = row.productosEstadoBase === 'DISPONIBLE' ? '' : row.productosEstadoBase;
    $('cdmProductosBody').innerHTML = (row.productos || []).map(category => {
      const isOther = category.categoria === 'OTROS' || category.informativo;
      const positive = Number(category.superacion) > 0 ? ' concurso-positive' : '';
      const pointsText = isOther ? '<span class="concurso-no-puntua">No puntúa</span>' : (category.puntos ?? '—');
      const saleDisabled = Number(category.ventaMes || 0) === 0 ? 'disabled' : '';
      return `<tr class="${isOther ? 'concurso-productos-otros' : ''}"><th scope="row">${categoryLabels[category.categoria] || esc(category.categoria)}</th><td class="numero">${category.promedioBase === null ? '—' : money(category.promedioBase)}</td><td class="numero"><button class="concurso-vendedor" type="button" data-product-sale="${category.categoria}" ${saleDisabled}>${money(category.ventaMes)}</button></td><td class="numero${positive}">${category.superacion === null ? '—' : signedMoney(category.superacion)}</td><td class="numero">${pointsText}</td><td><button class="btn-buscar btn-buscar--sm" type="button" data-product-base="${category.categoria}" ${category.promedioBase === null || isOther ? 'disabled' : ''}>Ver base</button></td></tr>`;
    }).join('') + `<tr class="concurso-total-row"><th scope="row" colspan="4">TOTAL PRODUCTOS PTS</th><td class="numero">${row.productosPuntos ?? '—'}</td><td></td></tr>`;
  }

  async function showProductDetail(category, kind, button) {
    if (button?.disabled) return;
    const requestId = ++productSequence;
    if (button) button.disabled = true;
    $('cdmProductoDetalle').hidden = false;
    $('cdmProductoDetalle').setAttribute('aria-busy', 'true');
    $('cdmProductoDetalleTitulo').textContent = `${kind === 'base' ? 'Base oficial' : 'Venta mes'} · ${categoryLabels[category] || category}`;
    $('cdmProductoDetalleEstado').innerHTML = loadingMarkup;
    $('cdmProductoDetalleHead').innerHTML = '';
    $('cdmProductoDetalleBody').innerHTML = '';
    $('cdmProductoDetalle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const response = await fetch(`${apiBase}/productos?${new URLSearchParams({ ...rendered, categoria: category, detalle: kind, ...(apiBase.includes('/gerencia/') ? { vendedorId: row.usuarioId } : {}) })}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' },
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar el detalle.');
      if (requestId !== productSequence) return;
      if (kind === 'base') {
        $('cdmProductoDetalleHead').innerHTML = '<tr><th>Período</th><th class="numero">Venta oficial</th></tr>';
        $('cdmProductoDetalleBody').innerHTML = (data.meses || []).map(month => `<tr><td>${esc(month.periodo)}</td><td class="numero">${money(month.venta)}</td></tr>`).join('')
          + `<tr class="concurso-total-row"><th scope="row">Promedio oficial</th><td class="numero">${money(data.promedioBase)}</td></tr>`;
        $('cdmProductoDetalleEstado').textContent = data.meses?.length ? '' : 'No hay detalle mensual guardado.';
      } else {
        const headers = ['Fecha', 'Tipo', 'Folio', 'Cliente', 'Cód. vendedor', 'Código producto', 'Producto', 'Categoría original', 'Categoría concurso', 'Tipo atribución', '% atribuido', 'Venta original', 'Venta atribuida'];
        $('cdmProductoDetalleHead').innerHTML = `<tr>${headers.map(label => `<th>${label}</th>`).join('')}</tr>`;
        $('cdmProductoDetalleBody').innerHTML = (data.documentos || []).map(doc => `<tr><td>${esc(doc.fecha)}</td><td>${esc(doc.tipo)}</td><td>${esc(doc.folio)}</td><td>${esc(doc.cliente)}</td><td>${esc(doc.codigoVendedor)}</td><td>${esc(doc.codigoProducto)}</td><td>${esc(doc.producto)}</td><td>${esc(doc.categoriaOriginal)}</td><td>${esc(doc.categoriaConcurso)}</td><td>${(doc.tipoAtribucion || []).map(label => `<span class="concurso-tipo">${esc(label)}</span>`).join(' ')}</td><td class="numero">${percent(doc.porcentaje)}</td><td class="numero">${money(doc.original)}</td><td class="numero">${money(doc.atribuida)}</td></tr>`).join('') || `<tr><td colspan="${headers.length}" class="gerencia-empty">Sin ventas atribuidas.</td></tr>`;
        $('cdmProductoDetalleEstado').textContent = `Total detalle: ${money((data.documentos || []).reduce((sum, doc) => sum + Number(doc.atribuida), 0))} · Venta mes: ${money(data.total)}`;
      }
      $('cdmProductoDetalle').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) { if (requestId === productSequence) $('cdmProductoDetalleEstado').textContent = error.message; }
    finally {
      if (button) button.disabled = false;
      if (requestId === productSequence) $('cdmProductoDetalle').setAttribute('aria-busy', 'false');
    }
  }

  async function clientRequest(extra) {
    const response = await fetch(`${apiBase}/clientes?${new URLSearchParams({ ...rendered, ...extra, ...(apiBase.includes('/gerencia/') ? { vendedorId: row.usuarioId } : {}) })}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' },
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar el detalle. Intente nuevamente.');
    return data.clientes || [];
  }

  async function showClients(kind) {
    clearClients();
    const requestId = detailSequence;
    selectedKind = kind;
    $('cdmClientes').hidden = false;
    $('cdmClientes').setAttribute('aria-busy', 'true');
    $('cdmClientesTitulo').textContent = kind === 'nuevos' ? 'Clientes Nuevos' : 'Clientes Recuperados';
    $('cdmClientesEstado').innerHTML = loadingMarkup;
    $('cdmClientesHead').innerHTML = '';
    $('cdmClientesBody').innerHTML = '';
    try {
      const data = await clientRequest({ categoria: kind });
      if (requestId !== detailSequence) return;
      data.sort((a, b) => Number(b.califica) - Number(a.califica) || Number(b.ventaMes) - Number(a.ventaMes) || String(a.cliente ?? '').localeCompare(String(b.cliente ?? ''), 'es'));
      clientRows = data;
      const recovered = kind === 'recuperados';
      const headers = ['Cliente', 'Código cliente', ...(recovered ? ['Última compra anterior', 'Primera compra del mes', 'Días transcurridos'] : []), 'Cantidad folios', 'Venta mes atribuida', 'Califica / motivo', 'Puntos', 'Acción'];
      $('cdmClientesHead').innerHTML = `<tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr>`;
      $('cdmClientesBody').innerHTML = data.map((item, index) => {
        const qualify = item.califica ? '<span class="concurso-badge concurso-badge--ok">Sí</span>' : `<span class="concurso-badge concurso-badge--no">No</span><small class="concurso-motivo">${esc(item.motivo)}</small>`;
        return `<tr><td>${esc(item.cliente)}</td><td><code>${esc(item.clienteCodigo)}</code></td>${recovered ? `<td>${esc(item.ultimaCompra)}</td><td>${esc(item.primeraMes)}</td><td class="numero">${item.dias}</td>` : ''}<td class="numero">${item.cantidadFolios}</td><td class="numero">${money(item.ventaMes)}</td><td>${qualify}</td><td class="numero">${formatPoints(item.puntos)}</td><td><button class="btn-buscar btn-buscar--sm" type="button" data-folios="${index}" aria-expanded="false" ${item.cantidadFolios ? '' : 'disabled'}>Ver folios</button></td></tr>`;
      }).join('') || `<tr><td colspan="${headers.length}" class="gerencia-empty">No hay clientes para mostrar.</td></tr>`;
      $('cdmClientesEstado').textContent = 'Valores actuales de la fuente; incluye clientes que no califican.';
    } catch (error) { if (requestId === detailSequence) $('cdmClientesEstado').textContent = error.message; }
    finally { if (requestId === detailSequence) $('cdmClientes').setAttribute('aria-busy', 'false'); }
  }

  async function showFolios(index) {
    const client = clientRows[index];
    if (!client) return;
    const closing = expandedClient === index;
    closeFolios();
    if (closing) return;
    expandedClient = index;
    const button = $('cdmClientesBody').querySelector(`[data-folios="${index}"]`);
    button.setAttribute('aria-expanded', 'true');
    button.textContent = 'Ocultar';
    const detailRow = document.createElement('tr');
    detailRow.className = 'concurso-folios-fila';
    const cell = document.createElement('td');
    cell.colSpan = $('cdmClientesHead').querySelectorAll('th').length;
    cell.appendChild($('cdmFolios'));
    detailRow.appendChild(cell);
    button.closest('tr').after(detailRow);
    const requestId = ++folioSequence;
    button.disabled = true;
    $('cdmFolios').hidden = false;
    $('cdmFolios').setAttribute('aria-busy', 'true');
    $('cdmFoliosTitulo').textContent = `Folios — ${client.cliente} · ${periodo}`;
    $('cdmFoliosEstado').innerHTML = loadingMarkup;
    $('cdmFoliosBody').innerHTML = '';
    $('cdmFoliosTotal').textContent = '';
    try {
      const data = await clientRequest({ categoria: selectedKind, cliente: client.clienteCodigo });
      if (requestId !== folioSequence) return;
      const item = data.find(value => value.clienteCodigo === client.clienteCodigo);
      if (!item) throw new Error('El cliente ya no aparece en esta categoría. Actualice los resultados.');
      $('cdmFoliosBody').innerHTML = (item.folios || []).map(folio => `<tr><td>${esc(folio.tipo)}</td><td>${esc(folio.folio)}</td><td>${esc(folio.fecha)}</td><td>${esc(folio.codigoVendedor)}</td><td>${(folio.atribucion || []).map(label => `<span class="concurso-tipo">${esc(label)}</span>`).join(' ')}</td><td class="numero">${money(folio.original)}</td><td class="numero">${percent(folio.porcentaje)}</td><td class="numero">${money(folio.atribuida)}</td></tr>`).join('');
      const total = (item.folios || []).reduce((sum, folio) => sum + Number(folio.atribuida), 0);
      $('cdmFoliosTotal').textContent = `TOTAL VENTA ATRIBUIDA: ${money(total)} · Venta mes cliente: ${money(item.ventaMes)}`;
      $('cdmFoliosEstado').textContent = Math.abs(total - Number(client.ventaMes)) < .005 ? 'El total de folios coincide con la venta mensual del cliente.' : 'La fuente cambió. Actualice el detalle de clientes para comparar los valores actuales.';
    } catch (error) { if (requestId === folioSequence) $('cdmFoliosEstado').textContent = error.message; }
    finally {
      button.disabled = false;
      if (requestId === folioSequence) $('cdmFolios').setAttribute('aria-busy', 'false');
    }
  }

  function openFromRow(options) {
    ensureModal();
    row = options.row;
    rendered = options.rendered;
    activeView = options.activeView || 'mes';
    periodo = options.periodo || `${meses[Number(rendered?.mes || 1) - 1]} ${rendered?.anio || 2026}`;
    apiBase = options.apiBase || apiBase;
    onCloseCallback = options.onClose || null;
    clearClients();
    resetDetailAreas();
    $('cdmSubtitulo').textContent = `${row.vendedor || 'Vendedor'} · ${activeView === 'acumulado' ? `Octubre–${periodo}` : periodo}`;
    renderSummary();
    $('cdmTabs').hidden = activeView === 'acumulado';
    $('cdmCategoriaResumen').hidden = activeView === 'acumulado';
    if (activeView === 'acumulado') {
      $('cdmAcumulado').hidden = false;
      $('cdmAcumuladoBody').innerHTML = (row.mesesOficiales || []).map(month => `<tr><th scope="row">${meses[month.mes - 1]}</th><td>${esc(month.tipo)}</td><td class="numero">${formatPoints(month.puntosMeta)}</td><td class="numero">${formatPoints(month.puntosNuevos)}</td><td class="numero">${formatPoints(month.puntosRecuperados)}</td><td class="numero">${month.productosPuntos == null ? '—' : formatPoints(month.productosPuntos)}</td><td class="numero">${month.totalMes == null ? '—' : formatPoints(month.totalMes)}</td><td class="numero">${month.acumulado == null ? '—' : formatPoints(month.acumulado)}</td></tr>`).join('');
    } else {
      selectTab('cumplimiento');
    }
    $('concursoDetalleModal').showModal();
  }

  async function openFromEndpoint(options) {
    ensureModal();
    apiBase = options.apiBase || '/api/dashboard/concurso-detalle';
    const response = await fetch(`${apiBase}?${new URLSearchParams(options.params || {})}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' },
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar el detalle del concurso.');
    if (!data.row) throw new Error('No hay detalle disponible para el usuario en el período seleccionado.');
    openFromRow({
      row: data.row,
      rendered: data.rendered,
      periodo: `${meses[Number(data.rendered?.mes || options.params?.mes || 1) - 1]} ${data.rendered?.anio || options.params?.anio || 2026}`,
      activeView: 'mes',
      apiBase,
    });
  }

  window.ConcursoDetalleModal = { openFromRow, openFromEndpoint, close };
})();
