'use strict';
(function () {
  const $ = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(value);
  const signedMoney = value => Number(value) > 0 ? `+${money(value)}` : money(value);
  const percent = value => `${Number(value).toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;
  const metaPercent = value => `${Number(value).toLocaleString('es-CL', { maximumFractionDigits: 0 })}%`;
  const points = value => value == null ? '—' : Number(value).toLocaleString('es-CL', { maximumFractionDigits: 2 });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const loadingMarkup = '<div class="concurso-detail-loading"><div class="gerencia-loading-card"><div class="gerencia-loading-spinner" aria-hidden="true"></div><div class="gerencia-loading-copy"><strong>Cargando datos...</strong></div></div></div>';
  let items = [];
  let periodo = '';
  let activeView = 'mes';
  let sortCriteria = [{ column: 'tipo', direction: 'asc' }, { column: 'totalMes', direction: 'desc' }];
  let sequence = 0;
  let selectedUser = null;
  let rendered = null;
  let monthState = '';
  let detailSequence = 0;
  let folioSequence = 0;
  let productSequence = 0;
  let clientRows = [];
  let selectedKind = '';
  let expandedClient = null;
  const compareClients = (a, b) => Number(b.califica) - Number(a.califica)
    || Number(b.ventaMes) - Number(a.ventaMes)
    || String(a.cliente ?? '').localeCompare(String(b.cliente ?? ''), 'es');
  const vendorName = row => String(row.vendedor ?? '');
  const compareVendors = (a, b) => vendorName(a).localeCompare(vendorName(b), 'es', { sensitivity: 'base' })
    || Number(a.usuarioId) - Number(b.usuarioId);
  const typeRank = { A: 0, B: 1, C: 2, 'SIN META': 3 };
  const visibleOfficialMonths = () => Array.from({ length: Math.max(0, Math.min(Number(rendered?.mes), 12) - 9) }, (_, index) => index + 10);
  function resetSort() {
    sortCriteria = activeView === 'acumulado'
      ? [{ column: 'tipoMes', direction: 'asc' }, { column: `mes-${rendered?.mes || 10}`, direction: 'desc' }]
      : [{ column: 'tipo', direction: 'asc' }, { column: 'totalMes', direction: 'desc' }];
  }
  function sortValue(row, column) {
    if (column === 'vendedor') return vendorName(row);
    if (column === 'tipo' || column === 'tipoMes') return typeRank[row.tipo] ?? 4;
    if (column.startsWith('mes-')) return row.mesesOficiales?.find(month => month.mes === Number(column.slice(4)))?.totalMes;
    const field = { porcentajeMeta: 'cumplimiento', metaPuntos: 'puntosMeta', nuevosPuntos: 'puntosNuevos', recuperadosPuntos: 'puntosRecuperados' }[column] || column;
    return row[field];
  }
  function sortedRows() {
    return [...items].sort((a, b) => {
      for (const { column, direction } of sortCriteria) {
        const left = sortValue(a, column);
        const right = sortValue(b, column);
        const missingLeft = left == null || left === '—' || left === '-';
        const missingRight = right == null || right === '—' || right === '-';
        if (missingLeft !== missingRight) return missingLeft ? 1 : -1;
        if (missingLeft) continue;
        const difference = column === 'vendedor'
          ? String(left).localeCompare(String(right), 'es', { sensitivity: 'base' })
          : Number(left) - Number(right);
        if (difference) return direction === 'asc' ? difference : -difference;
      }
      return compareVendors(a, b);
    });
  }
  function updateSortHeaders() {
    $('concursoHead').querySelectorAll('[data-sort]').forEach(header => {
      const priority = sortCriteria.findIndex(criterion => criterion.column === header.dataset.sort);
      const criterion = sortCriteria[priority];
      header.tabIndex = 0;
      header.setAttribute('aria-sort', priority === 0
        ? (criterion.direction === 'asc' ? 'ascending' : 'descending') : 'none');
      header.dataset.sortIndicator = priority < 0 ? '' : ` ${criterion.direction === 'asc' ? '↑' : '↓'}${priority + 1}`;
      header.title = priority < 0 ? 'Click para ordenar; Shift+click para añadir criterio'
        : `Criterio ${priority + 1}: ${criterion.direction === 'asc' ? 'ascendente' : 'descendente'}. Shift+click para combinar.`;
    });
  }
  function sortBy(column, additive = false) {
    const index = sortCriteria.findIndex(criterion => criterion.column === column);
    const direction = index < 0 || sortCriteria[index].direction === 'desc' ? 'asc' : 'desc';
    if (additive && index >= 0) sortCriteria[index] = { column, direction };
    else if (additive) sortCriteria.push({ column, direction });
    else sortCriteria = [{ column, direction }];
    renderView();
  }
  function exportColumns() {
    if (activeView === 'acumulado') return [
      ['Vendedor', row => row.vendedor], ['Tipo mes', row => row.tipo],
      ...visibleOfficialMonths().map(month => [meses[month - 1].slice(0, 3).toUpperCase(), row => row.mesesOficiales.find(value => value.mes === month)?.totalMes, 'Number']),
      ['Total acumulado', row => row.acumulado, 'Number'],
    ];
    return [
      ['Vendedor', row => row.vendedor], ['Tipo', row => row.tipo],
      ['Meta', row => row.meta, 'Currency'], ['Venta', row => row.venta, 'Currency'],
      ['% Meta', row => row.cumplimiento, 'Percent'], ['Meta pts', row => row.puntosMeta, 'Number'],
      ['Nuevos pts', row => row.puntosNuevos, 'Number'], ['Recuperados pts', row => row.puntosRecuperados, 'Number'],
      ['Productos pts', row => row.productosPuntos, 'Number'], ['Total mes', row => row.totalMes, 'Number'],
      ['Acumulado', row => row.acumulado, 'Number'],
    ];
  }
  function xmlText(value) {
    return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
  }
  function exportExcel() {
    if (!rendered || $('concursoResultados').getAttribute('aria-busy') === 'true') return;
    const columns = exportColumns();
    const cell = (value, style) => {
      const available = value != null && value !== '-' && value !== '—';
      const numeric = style && available && Number.isFinite(Number(value));
      return numeric
        ? `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${Number(value)}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${xmlText(available ? value : '—')}</Data></Cell>`;
    };
    const header = `<Row>${columns.map(([label]) => cell(label)).join('')}</Row>`;
    const rows = sortedRows().map(row => `<Row>${columns.map(([, value, style]) => cell(value(row), style)).join('')}</Row>`).join('');
    const sheet = activeView === 'mes' ? 'Detalle Mes' : 'Acumulado';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Currency"><NumberFormat ss:Format="$#,##0"/></Style><Style ss:ID="Percent"><NumberFormat ss:Format="0&quot;%&quot;"/></Style><Style ss:ID="Number"><NumberFormat ss:Format="0.##"/></Style></Styles><Worksheet ss:Name="${sheet}"><Table>${header}${rows}</Table></Worksheet></Workbook>`;
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const periodName = meses[Number(rendered.mes) - 1].normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]/g, '_');
    link.href = url;
    link.download = `Concurso_Ventas_${rendered.anio}_${periodName}_${activeView === 'mes' ? 'Detalle' : 'Acumulado'}.xml`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function closeFolios() {
    folioSequence += 1;
    $('detalleFolios').hidden = true;
    $('detalle-vendedor').appendChild($('detalleFolios'));
    $('clientesBody').querySelector('.concurso-folios-fila')?.remove();
    const button = $('clientesBody').querySelector('[data-folios][aria-expanded="true"]');
    if (button) { button.disabled = false; button.setAttribute('aria-expanded', 'false'); button.textContent = 'Ver folios'; }
    expandedClient = null;
  }
  function selectTab(kind) {
    clearClients();
    productSequence += 1;
    $('productoDetalle').hidden = true;
    $('detalleCumplimiento').hidden = kind !== 'cumplimiento';
    $('detalleProductos').hidden = kind !== 'productos';
    document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.tab === kind)));
    const row = items.find(item => item.usuarioId === selectedUser);
    $('categoriaResumen').textContent = kind === 'cumplimiento' ? `${points(row.puntosMeta)} puntos`
      : kind === 'nuevos' ? `${row.clientesNuevos} clientes válidos · ${points(row.puntosNuevos)} puntos`
        : kind === 'recuperados' ? `${row.clientesRecuperados} clientes válidos · ${points(row.puntosRecuperados)} puntos`
          : row.productosPuntos === null ? row.productosEstadoBase : `${points(row.productosPuntos)} puntos`;
    if (kind === 'productos') showProducts(row);
    else if (kind !== 'cumplimiento') showClients(kind);
  }
  const categoryLabels = { QUIMICOS: 'Químicos', ACCESORIOS: 'Accesorios', TRAT_AGUA: 'Trat. Agua', AEROSOLES: 'Aerosoles' };
  function showProducts(row) {
    $('productosEstado').textContent = row.productosEstadoBase === 'DISPONIBLE' ? '' : row.productosEstadoBase;
    $('productosBody').innerHTML = row.productos.map(category => `<tr><th scope="row">${categoryLabels[category.categoria]}</th><td class="numero">${category.promedioBase === null ? '—' : money(category.promedioBase)}</td><td class="numero"><button class="concurso-vendedor" type="button" data-product-sale="${category.categoria}">${money(category.ventaMes)}</button></td><td class="numero">${category.superacion === null ? '—' : signedMoney(category.superacion)}</td><td class="numero">${points(category.puntos)}</td><td><button class="btn-buscar" type="button" data-product-base="${category.categoria}" ${category.promedioBase === null ? 'disabled' : ''}>Ver base</button></td></tr>`).join('')
      + `<tr><th scope="row" colspan="4">TOTAL PRODUCTOS PTS</th><td class="numero">${points(row.productosPuntos)}</td><td></td></tr>`;
  }
  async function showProductDetail(category, kind, button) {
    if (button?.disabled) return;
    const requestId = ++productSequence;
    if (button) button.disabled = true;
    $('productoDetalle').hidden = false;
    $('productoDetalle').setAttribute('aria-busy', 'true');
    $('productoDetalleTitulo').textContent = `${kind === 'base' ? 'Base oficial' : 'Venta mes'} · ${categoryLabels[category]}`;
    $('productoDetalleEstado').innerHTML = loadingMarkup;
    $('productoDetalleHead').innerHTML = '';
    $('productoDetalleBody').innerHTML = '';
    try {
      const response = await fetch(`/api/gerencia/comercial/concurso-ventas/productos?${new URLSearchParams({ ...rendered, vendedorId: selectedUser, categoria: category, detalle: kind })}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('No se pudo cargar el detalle.');
      const data = await response.json();
      if (!data.ok) throw new Error('No se pudo cargar el detalle.');
      if (requestId !== productSequence) return;
      if (kind === 'base') {
        $('productoDetalleHead').innerHTML = '<tr><th>Período</th><th class="numero">Venta oficial</th></tr>';
        $('productoDetalleBody').innerHTML = data.meses.map(month => `<tr><td>${esc(month.periodo)}</td><td class="numero">${money(month.venta)}</td></tr>`).join('')
          + `<tr><th scope="row">Promedio oficial</th><td class="numero">${money(data.promedioBase)}</td></tr>`;
        $('productoDetalleEstado').textContent = data.meses.length ? '' : 'No hay detalle mensual guardado.';
      } else {
        const headers = ['Fecha', 'Tipo', 'Folio', 'Cliente', 'Cód. vendedor', 'Código producto', 'Producto', 'Categoría original', 'Categoría concurso', 'Tipo atribución', '% atribuido', 'Venta original', 'Venta atribuida'];
        $('productoDetalleHead').innerHTML = `<tr>${headers.map(label => `<th>${label}</th>`).join('')}</tr>`;
        $('productoDetalleBody').innerHTML = data.documentos.map(doc => `<tr><td>${esc(doc.fecha)}</td><td>${esc(doc.tipo)}</td><td>${esc(doc.folio)}</td><td>${esc(doc.cliente)}</td><td>${esc(doc.codigoVendedor)}</td><td>${esc(doc.codigoProducto)}</td><td>${esc(doc.producto)}</td><td>${esc(doc.categoriaOriginal)}</td><td>${esc(doc.categoriaConcurso)}</td><td>${doc.tipoAtribucion.map(label => `<span class="concurso-tipo">${esc(label)}</span>`).join(' ')}</td><td class="numero">${percent(doc.porcentaje)}</td><td class="numero">${money(doc.original)}</td><td class="numero">${money(doc.atribuida)}</td></tr>`).join('') || `<tr><td colspan="${headers.length}" class="gerencia-empty">Sin ventas atribuidas.</td></tr>`;
        $('productoDetalleEstado').textContent = `Total detalle: ${money(data.documentos.reduce((sum, doc) => sum + Number(doc.atribuida), 0))} · Venta mes: ${money(data.total)}`;
      }
    } catch (error) { if (requestId === productSequence) $('productoDetalleEstado').textContent = error.message; }
    finally {
      if (button) button.disabled = false;
      if (requestId === productSequence) $('productoDetalle').setAttribute('aria-busy', 'false');
    }
  }
  function clearClients() {
    detailSequence += 1;
    closeFolios();
    $('detalleClientes').hidden = true;
    $('detalleFolios').hidden = true;
    clientRows = [];
  }
  async function clientRequest(extra) {
    const response = await fetch(`/api/gerencia/comercial/concurso-ventas/clientes?${new URLSearchParams({ ...rendered, vendedorId: selectedUser, ...extra })}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('No se pudo cargar el detalle. Intente nuevamente.');
    const data = await response.json();
    if (!data.ok) throw new Error('No se pudo cargar el detalle. Intente nuevamente.');
    return data.clientes;
  }
  async function showClients(kind) {
    clearClients();
    const requestId = detailSequence;
    const button = document.querySelector(`[data-tab="${kind}"]`);
    if (button) button.disabled = true;
    selectedKind = kind;
    $('detalleClientes').hidden = false;
    $('detalleClientes').setAttribute('aria-busy', 'true');
    $('clientesTitulo').textContent = kind === 'nuevos' ? 'Clientes Nuevos' : 'Clientes Recuperados';
    $('clientesEstado').innerHTML = loadingMarkup;
    $('clientesHead').innerHTML = '';
    $('clientesBody').innerHTML = '';
    try {
      const data = await clientRequest({ categoria: kind });
      if (requestId !== detailSequence) return;
      data.sort(compareClients);
      clientRows = data;
      const recovered = kind === 'recuperados';
      const headers = ['Cliente', 'Código cliente', ...(recovered ? ['Última compra anterior', 'Primera compra del mes', 'Días transcurridos'] : []), 'Cantidad folios', 'Venta mes atribuida', 'Califica / motivo', 'Puntos', 'Acción'];
      $('clientesHead').innerHTML = `<tr>${headers.map(label => `<th scope="col">${label}</th>`).join('')}</tr>`;
      $('clientesBody').innerHTML = data.map((row, index) => `<tr><td>${esc(row.cliente)}</td><td>${esc(row.clienteCodigo)}</td>${recovered ? `<td>${esc(row.ultimaCompra)}</td><td>${esc(row.primeraMes)}</td><td class="numero">${row.dias}</td>` : ''}<td class="numero">${row.cantidadFolios}</td><td class="numero">${money(row.ventaMes)}</td><td>${row.califica ? 'Sí' : `No · ${esc(row.motivo)}`}</td><td class="numero">${points(row.puntos)}</td><td><button class="btn-buscar" type="button" data-folios="${index}" aria-expanded="false" aria-controls="detalleFolios" ${row.cantidadFolios ? '' : 'disabled'}>Ver folios</button></td></tr>`).join('') || `<tr><td colspan="${headers.length}" class="gerencia-empty">No hay clientes para mostrar.</td></tr>`;
      $('clientesEstado').textContent = 'Valores actuales de la fuente; incluye clientes que no califican.';
    } catch (error) { if (requestId === detailSequence) $('clientesEstado').textContent = error.message; }
    finally {
      if (button) button.disabled = false;
      if (requestId === detailSequence) $('detalleClientes').setAttribute('aria-busy', 'false');
    }
  }
  async function showFolios(index) {
    const client = clientRows[index];
    if (!client) return;
    const closing = expandedClient === index;
    closeFolios();
    if (closing) return;
    expandedClient = index;
    const button = $('clientesBody').querySelector(`[data-folios="${index}"]`);
    button.setAttribute('aria-expanded', 'true');
    button.textContent = 'Ocultar folios';
    const detailRow = document.createElement('tr');
    detailRow.className = 'concurso-folios-fila';
    const cell = document.createElement('td');
    cell.colSpan = $('clientesHead').querySelectorAll('th').length;
    cell.appendChild($('detalleFolios'));
    detailRow.appendChild(cell);
    button.closest('tr').after(detailRow);
    const requestId = ++folioSequence;
    button.disabled = true;
    $('detalleFolios').hidden = false;
    $('detalleFolios').setAttribute('aria-busy', 'true');
    $('foliosTitulo').textContent = `Folios — ${client.cliente} · ${periodo}`;
    $('foliosEstado').innerHTML = loadingMarkup;
    $('foliosBody').innerHTML = '';
    $('foliosTotal').textContent = '';
    try {
      const data = await clientRequest({ categoria: selectedKind, cliente: client.clienteCodigo });
      if (requestId !== folioSequence) return;
      const row = data.find(value => value.clienteCodigo === client.clienteCodigo);
      if (!row) throw new Error('El cliente ya no aparece en esta categoría. Actualice los resultados.');
      $('foliosBody').innerHTML = row.folios.map(folio => `<tr><td>${esc(folio.tipo)}</td><td>${esc(folio.folio)}</td><td>${esc(folio.fecha)}</td><td>${esc(folio.codigoVendedor)}</td><td>${folio.atribucion.map(label => `<span class="concurso-tipo">${esc(label)}</span>`).join(' ')}</td><td class="numero">${money(folio.original)}</td><td class="numero">${percent(folio.porcentaje)}</td><td class="numero">${money(folio.atribuida)}</td></tr>`).join('');
      const total = row.folios.reduce((sum, folio) => sum + Number(folio.atribuida), 0);
      $('foliosTotal').textContent = `TOTAL VENTA ATRIBUIDA: ${money(total)} · Venta mes cliente: ${money(row.ventaMes)}`;
      $('foliosEstado').textContent = Math.abs(total - Number(client.ventaMes)) < .005 ? 'El total de folios coincide con la venta mensual del cliente.' : 'La fuente cambió. Actualice el detalle de clientes para comparar los valores actuales.';
    } catch (error) { if (requestId === folioSequence) $('foliosEstado').textContent = error.message; }
    finally {
      button.disabled = false;
      if (requestId === folioSequence) $('detalleFolios').setAttribute('aria-busy', 'false');
    }
  }
  function detail(id) {
    const row = items.find(item => item.usuarioId === id);
    if (!row) return;
    selectedUser = id;
    $('concursoBody').querySelector('.concurso-seleccionado')?.classList.remove('concurso-seleccionado');
    $('concursoBody').querySelector(`[data-vendedor="${id}"]`)?.closest('tr')?.classList.add('concurso-seleccionado');
    if (window.ConcursoDetalleModal) {
      window.ConcursoDetalleModal.openFromRow({
        row,
        rendered,
        periodo,
        activeView,
        apiBase: '/api/gerencia/comercial/concurso-ventas',
        onClose: () => {
          selectedUser = null;
          $('concursoBody').querySelector('.concurso-seleccionado')?.classList.remove('concurso-seleccionado');
        },
      });
      return;
    }
  }
  function renderView() {
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === activeView)));
    if (!rendered) return;
    const officialMonths = visibleOfficialMonths();
    if (activeView === 'acumulado') {
      $('concursoHead').innerHTML = `<tr><th scope="col" data-sort="vendedor">Vendedor</th><th scope="col" data-sort="tipoMes">Tipo mes</th>${officialMonths.map(month => `<th scope="col" class="numero" data-sort="mes-${month}">${['OCT', 'NOV', 'DIC'][month - 10]}</th>`).join('')}<th scope="col" class="numero" data-sort="acumulado">Total acumulado</th><th scope="col">Acción</th></tr>`;
      updateSortHeaders();
      if (!officialMonths.length) {
        $('concursoEstado').textContent = Number(rendered.mes) === 9
          ? 'Septiembre 2026 corresponde al período de prueba. El concurso oficial comienza en Octubre 2026.'
          : 'El concurso oficial comienza en Octubre 2026.';
        $('concursoBody').innerHTML = `<tr><td colspan="4" class="gerencia-empty">No hay acumulado oficial para este mes.</td></tr>`;
      } else {
        $('concursoEstado').textContent = '';
        $('concursoBody').innerHTML = sortedRows().map(row => `<tr><td>${esc(row.vendedor)}</td><td><span class="concurso-tipo">${esc(row.tipo)}</span></td>${officialMonths.map(month => `<td class="numero">${points(row.mesesOficiales.find(value => value.mes === month)?.totalMes)}</td>`).join('')}<td class="numero">${points(row.acumulado)}</td><td><button type="button" class="btn-buscar" data-vendedor="${row.usuarioId}" aria-haspopup="dialog" aria-controls="detalle-vendedor">Ver detalle</button></td></tr>`).join('') || `<tr><td colspan="${officialMonths.length + 4}" class="gerencia-empty">No existen vendedores para el período seleccionado.</td></tr>`;
        if (selectedUser !== null) $('concursoBody').querySelector(`[data-vendedor="${selectedUser}"]`)?.closest('tr').classList.add('concurso-seleccionado');
      }
      $('periodoResultados').textContent = `Acumulado oficial · Octubre–${periodo}`;
      return;
    }
    $('concursoHead').innerHTML = '<tr><th scope="col" data-sort="vendedor">Vendedor</th><th scope="col" data-sort="tipo">Tipo</th><th scope="col" class="numero" data-sort="meta">Meta</th><th scope="col" class="numero" data-sort="venta">Venta</th><th scope="col" class="numero" data-sort="porcentajeMeta">% Meta</th><th scope="col" class="numero" data-sort="metaPuntos">Meta pts</th><th scope="col" class="numero" data-sort="nuevosPuntos">Nuevos pts</th><th scope="col" class="numero" data-sort="recuperadosPuntos">Recuperados pts</th><th scope="col" class="numero" data-sort="productosPuntos">Productos pts</th><th scope="col" class="numero" data-sort="totalMes">Total mes</th><th scope="col" class="numero" data-sort="acumulado">Acumulado</th></tr>';
    updateSortHeaders();
    $('concursoBody').innerHTML = sortedRows().map(row => `<tr><td><button type="button" class="concurso-vendedor" data-vendedor="${row.usuarioId}" aria-haspopup="dialog" aria-controls="detalle-vendedor" title="Ver detalle del vendedor">${esc(row.vendedor)}</button></td><td><span class="concurso-tipo">${esc(row.tipo)}</span></td><td class="numero">${money(row.meta)}</td><td class="numero">${money(row.venta)}</td><td class="numero">${metaPercent(row.cumplimiento)}</td><td class="numero">${points(row.puntosMeta)}</td><td class="numero">${points(row.puntosNuevos)}</td><td class="numero">${points(row.puntosRecuperados)}</td><td class="numero" title="${esc(row.productosEstadoBase)}">${points(row.productosPuntos)}</td><td class="numero">${points(row.totalMes)}</td><td class="numero">${points(row.acumulado)}</td></tr>`).join('') || '<tr><td colspan="11" class="gerencia-empty">No existen vendedores para el período seleccionado.</td></tr>';
    if (selectedUser !== null) $('concursoBody').querySelector(`[data-vendedor="${selectedUser}"]`)?.closest('tr').classList.add('concurso-seleccionado');
    $('concursoEstado').textContent = Number(rendered.mes) === 9 ? 'Mes de prueba — fuera del período oficial del concurso.' : '';
    $('periodoResultados').textContent = `${periodo} · Puntaje mes: Meta + Nuevos + Recuperados + Productos`;
  }
  async function refresh() {
    const requestId = ++sequence;
    const updateButton = $('concursoFiltros').querySelector('[type="submit"]');
    updateButton.disabled = true;
    productSequence += 1;
    clearClients();
    selectedUser = null;
    const mes = $('monthFilter').value;
    const anio = '2026';
    $('concursoResultados').setAttribute('aria-busy', 'true');
    $('exportarConcurso').disabled = true;
    $('concursoLoading').querySelector('strong').textContent = 'Cargando datos...';
    $('concursoCierreEstado').textContent = '';
    window.ConcursoDetalleModal?.close();
    if ($('detalle-vendedor').open) $('detalle-vendedor').close();
    $('concursoEstado').textContent = 'Calculando puntaje…';
    try {
      const response = await fetch(`/api/gerencia/comercial/concurso-ventas/resumen?${new URLSearchParams({ mes, anio })}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json' },
      });
      if (requestId !== sequence) return;
      if (response.status === 401 || response.status === 403) {
        window.location.href = response.status === 401 ? '/src/modulo/varios/login/index.html' : '/src/modulo/varios/sin-acceso/index.html';
        return;
      }
      const data = await response.json();
      if (requestId !== sequence) return;
      if (!response.ok || !data.ok) throw new Error(data.error || 'No se pudo cargar el concurso.');
      items = data.items;
      rendered = { mes: data.mes, anio: data.anio };
      resetSort();
      monthState = data.estadoMes || (data.mes < 10 ? 'PRUEBA' : 'ABIERTO');
      periodo = `${meses[data.mes - 1]} ${data.anio}`;
      const kpis = document.querySelectorAll('.concurso-kpis .kpi-valor');
      kpis[0].textContent = items.length;
      kpis[1].textContent = data.puntosParciales ?? '—';
      kpis[2].textContent = items.reduce((sum, row) => sum + row.clientesNuevos, 0);
      kpis[3].textContent = items.reduce((sum, row) => sum + row.clientesRecuperados, 0);
      kpis[4].textContent = data.puntosAcumulados ?? '—';
      renderView();
      $('exportarConcurso').disabled = false;
      $('concursoCierreEstado').textContent = `${periodo} · ${monthState}${monthState === 'CERRADO' ? ` · Versión ${data.versionCierre} · Cierre: ${data.fechaCierre}` : ''}`;
    } catch (error) {
      if (requestId !== sequence) return;
      items = [];
      rendered = null;
      $('exportarConcurso').disabled = true;
      monthState = '';
      $('periodoResultados').textContent = `${meses[Number(mes) - 1]} ${anio}`;
      document.querySelectorAll('.concurso-kpis .kpi-valor').forEach(node => { node.textContent = '—'; });
      $('concursoBody').innerHTML = '<tr><td colspan="11" class="gerencia-empty">Resultados no disponibles.</td></tr>';
      $('concursoEstado').textContent = error.message === 'API' ? 'No se pudo cargar el cumplimiento. Intente actualizar nuevamente.' : error.message;
    } finally {
      if (requestId === sequence) {
        $('concursoResultados').setAttribute('aria-busy', 'false');
        updateButton.disabled = false;
      }
    }
  }
  function init() {
    if (!localStorage.getItem('token')) { window.location.href = '/src/modulo/varios/login/index.html'; return; }
    meses.forEach((nombre, index) => $('monthFilter').add(new Option(nombre, String(index + 1))));
    $('monthFilter').value = String(new Date().getMonth() + 1);
    $('concursoFiltros').addEventListener('submit', event => { event.preventDefault(); refresh(); });
    ['monthFilter', 'yearFilter'].forEach(id => $(id).addEventListener('change', () => {
      $('exportarConcurso').disabled = true;
      $('concursoCierreEstado').textContent = 'Actualice para consultar el estado del mes seleccionado.';
    }));
    $('exportarConcurso').addEventListener('click', exportExcel);
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
      activeView = button.dataset.view;
      resetSort();
      renderView();
    }));
    $('concursoHead').addEventListener('click', event => {
      const header = event.target.closest('th[data-sort]');
      if (header && $('concursoResultados').getAttribute('aria-busy') !== 'true') sortBy(header.dataset.sort, event.shiftKey);
    });
    $('concursoHead').addEventListener('keydown', event => {
      const header = event.target.closest('th[data-sort]');
      if (header && (event.key === 'Enter' || event.key === ' ') && $('concursoResultados').getAttribute('aria-busy') !== 'true') {
        event.preventDefault();
        sortBy(header.dataset.sort, event.shiftKey);
        $('concursoHead').querySelector(`[data-sort="${header.dataset.sort}"]`)?.focus();
      }
    });
    $('concursoBody').addEventListener('click', event => {
      const button = event.target.closest('[data-vendedor]');
      if (button && $('concursoResultados').getAttribute('aria-busy') !== 'true') detail(Number(button.dataset.vendedor));
    });
    document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
    $('clientesBody').addEventListener('click', event => {
      const button = event.target.closest('[data-folios]');
      if (button) showFolios(Number(button.dataset.folios));
    });
    $('productosBody').addEventListener('click', event => {
      const sale = event.target.closest('[data-product-sale]');
      const base = event.target.closest('[data-product-base]');
      if (sale) showProductDetail(sale.dataset.productSale, 'venta', sale);
      else if (base) showProductDetail(base.dataset.productBase, 'base', base);
    });
    ['cerrarDetalleX', 'cerrarDetalle'].forEach(id => $(id).addEventListener('click', () => $('detalle-vendedor').close()));
    $('detalle-vendedor').addEventListener('close', () => {
      clearClients();
      selectedUser = null;
      $('concursoBody').querySelector('.concurso-seleccionado')?.classList.remove('concurso-seleccionado');
    });
    refresh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
