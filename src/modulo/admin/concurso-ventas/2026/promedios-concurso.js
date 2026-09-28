'use strict';
(function () {
  const API = '/api/admin/concurso-promedios';
  const categories = [['QUIMICOS', 'Químicos'], ['ACCESORIOS', 'Accesorios'], ['TRAT_AGUA', 'Trat. Agua'], ['AEROSOLES', 'Aerosoles']];
  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const monthLabel = period => `${monthNames[Number(period.slice(5)) - 1]} 2026`;
  const periodLabel = period => period ? `${monthLabel(period.periodo_desde)} → ${monthLabel(period.periodo_hasta)}` : 'No generada';
  let renderedPeriod = null;
  const $ = id => document.getElementById(id);
  const money = value => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value || 0));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let official = null;
  let rows = [];
  let revision = '';
  let busy = false;
  let detailRequest = 0;
  let selectedUser = null;
  let operationBusy = false;
  let monthlyStates = [];
  let parameters = null;
  let editingSection = null;
  let savingParameters = false;

  function selectedPeriod() {
    const desde = $('periodoDesde').value;
    const hasta = $('periodoHasta').value;
    if (![desde, hasta].every(value => /^2026-(0[1-9]|1[0-2])$/.test(value))) throw new Error('Solo se permiten períodos correspondientes al año 2026.');
    if (desde > hasta) throw new Error('El período Hasta no puede ser anterior al período Desde.');
    const meses = [];
    for (let month = Number(desde.slice(5)); month <= Number(hasta.slice(5)); month += 1) meses.push(`2026-${String(month).padStart(2, '0')}`);
    return { periodo_desde: desde, periodo_hasta: hasta, meses, cantidad_meses: meses.length };
  }
  function periodChanged() {
    closeSellerDetail();
    revision = '';
    try {
      const period = selectedPeriod();
      $('mesesIncluidos').textContent = period.meses.map(monthLabel).join(' · ');
      $('periodoError').textContent = '';
    } catch (error) {
      $('mesesIncluidos').textContent = '—';
      $('periodoError').textContent = error.message;
    }
    buttons();
  }

  async function request(path, options = {}) {
    const response = await fetch(`${API}/${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    });
    if (response.status === 401 || response.status === 403) {
      window.location.href = response.status === 401 ? '/src/modulo/varios/login/index.html' : '/src/modulo/varios/sin-acceso/index.html';
      throw new Error('Sin acceso a Administración.');
    }
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || 'No se pudo completar la solicitud.');
      error.code = data.code;
      error.periodo = data.periodo;
      throw error;
    }
    return data;
  }
  function buttons() {
    $('btnCalcular').disabled = busy;
    $('btnOficial').disabled = busy;
    $('btnGuardar').disabled = busy || !revision;
    $('periodoDesde').disabled = busy;
    $('periodoHasta').disabled = busy;
    $('resultados').setAttribute('aria-busy', String(busy));
  }
  function updateState(data) {
    official = data;
    $('kpiEstado').textContent = data.oficial ? 'BASE OFICIAL GENERADA' : 'BASE NO GENERADA';
    $('fechaBloqueo').textContent = data.fechaBloqueo || '';
    $('periodoOficial').textContent = `Base oficial: ${periodLabel(data.periodo)}`;
    $('btnOficial').hidden = !data.oficial;
    $('btnCalcular').textContent = data.oficial ? 'Recalcular para comparar' : 'Calcular promedios';
    buttons();
  }
  function render(records, isOfficial, period) {
    closeSellerDetail();
    rows = records;
    renderedPeriod = period;
    selectedUser = null;
    $('detalleVendedor').hidden = true;
    const vendors = new Map(records.map(row => [row.usuario_id, row]));
    $('kpiVendedores').textContent = vendors.size;
    $('kpiRegistros').textContent = isOfficial ? '0' : records.length;
    $('tipoVista').textContent = `${isOfficial ? 'Base oficial' : 'Valores preliminares. Aún no corresponden a la base oficial.'} · ${period.meses.map(monthLabel).join(' · ')}`;
    $('promediosBody').innerHTML = Array.from(vendors, ([id, vendor]) => {
      const values = new Map(records.filter(row => row.usuario_id === id).map(row => [row.categoria, row.promedio_base]));
      return `<tr><td><strong>${esc(vendor.vendedor_nombre)}</strong><small class="promedios-codigo">${esc(vendor.codigo_principal)}</small></td>${categories.map(([key]) => `<td class="numero">${money(values.get(key))}</td>`).join('')}<td class="promedios-accion"><button type="button" class="btn-buscar" data-vendedor="${id}" aria-expanded="false" aria-controls="detalleVendedor">Ver detalle</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="gerencia-empty">No existen vendedores para mostrar.</td></tr>';
  }
  function closeSellerDetail() {
    detailRequest += 1;
    const detail = $('detalleVendedor');
    detail.hidden = true;
    if ($('documentosModal').open) $('documentosModal').close();
    $('tabBase').appendChild(detail);
    $('promediosBody').querySelector('.promedios-detalle-fila')?.remove();
    const button = $('promediosBody').querySelector('[data-vendedor][aria-expanded="true"]');
    if (button) {
      button.setAttribute('aria-expanded', 'false');
      button.textContent = 'Ver detalle';
      button.closest('tr').classList.remove('promedios-seleccionado');
    }
    selectedUser = null;
  }
  function sellerDetail(id) {
    const closing = selectedUser === id;
    closeSellerDetail();
    if (closing) return;
    const records = rows.filter(row => row.usuario_id === id);
    if (!records.length) return;
    selectedUser = id;
    $('tituloDetalle').textContent = `Detalle — ${records[0].vendedor_nombre}`;
    $('detallePeriodo').textContent = renderedPeriod.meses.map(monthLabel).join(' · ');
    $('categoriasDetalle').innerHTML = `<article class="tabla-card" style="grid-column: 1 / -1"><div class="tabla-wrapper"><table class="dash-tabla"><thead><tr><th>Categoría</th>${renderedPeriod.meses.map(month => `<th class="numero">${monthLabel(month)}</th>`).join('')}<th class="numero">Promedio</th></tr></thead><tbody>${categories.map(([key, label]) => {
      const row = records.find(item => item.categoria === key);
      if (!row) return '';
      return `<tr><th scope="row">${label}${key === 'ACCESORIOS' ? '<p class="gerencia-subtitulo">Incluye Accesorios + Papel + Sachets.</p>' : ''}</th>${renderedPeriod.meses.map(month => Number(row.ventas_mensuales[month]) === 0 ? `<td class="numero">${money(0)}</td>` : `<td class="numero"><button type="button" class="promedios-enlace" data-mes="${month}" data-categoria="${key}" title="Ver documentos de ${monthLabel(month)}">${money(row.ventas_mensuales[month])}</button></td>`).join('')}<td class="numero">${money(row.promedio_base)}</td></tr>`;
    }).join('')}</tbody></table></div></article>`;
    const button = $('promediosBody').querySelector(`[data-vendedor="${id}"]`);
    const sellerRow = button.closest('tr');
    const detailRow = document.createElement('tr');
    detailRow.className = 'promedios-detalle-fila';
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.appendChild($('detalleVendedor'));
    detailRow.appendChild(cell);
    sellerRow.after(detailRow);
    sellerRow.classList.add('promedios-seleccionado');
    button.textContent = 'Ocultar detalle';
    button.setAttribute('aria-expanded', 'true');
    $('detalleVendedor').hidden = false;
  }
  async function documents(month, category) {
    if ($('documentosModal').open) return;
    const sequence = ++detailRequest;
    const row = rows.find(item => item.usuario_id === selectedUser && item.categoria === category);
    if (!row) return;
    const expected = Number(row.ventas_mensuales[month]);
    if (expected === 0) return;
    const button = $('categoriasDetalle').querySelector(`[data-mes="${month}"][data-categoria="${category}"]`);
    if (button?.disabled) return;
    if (button) button.disabled = true;
    $('documentosTitulo').textContent = `Detalle de productos — ${row.vendedor_nombre}`;
    $('documentosSubtitulo').textContent = `${categories.find(item => item[0] === category)[1]} · ${monthLabel(month)}`;
    $('documentosBody').innerHTML = '';
    $('documentosTotal').textContent = '';
    $('documentosEstado').textContent = '';
    $('documentosModal').setAttribute('aria-busy', 'true');
    $('documentosLoading').hidden = false;
    $('documentosModal').showModal();
    try {
      const data = await request(`detalle?${new URLSearchParams({ usuarioId: selectedUser, periodo: month, categoria: category, desde: renderedPeriod.periodo_desde, hasta: renderedPeriod.periodo_hasta })}`);
      if (sequence !== detailRequest) return;
      $('documentosBody').innerHTML = data.documentos.map(doc => `<tr><td>${esc(doc.fecha)}</td><td>${esc(doc.tipo)}</td><td>${esc(doc.folio)}</td><td>${esc(doc.cliente)}</td><td>${esc(doc.codigoVendedor)}</td><td>${esc(doc.codigoProducto)}</td><td>${esc(doc.producto)}</td><td class="numero">${Number(doc.cantidad).toLocaleString('es-CL')}</td><td>${doc.tipoAtribucion.map(label => `<span class="promedios-atribucion ${label === 'DIRECTA' ? '' : 'promedios-atribucion--compartida'}">${esc(label)}</span>`).join('')}${doc.tipoCodigo === 'C' ? '<small class="promedios-codigo">Regla código C</small>' : ''}</td><td class="numero">${Number(doc.porcentaje).toLocaleString('es-CL', { maximumFractionDigits: 6 })} %</td><td>${esc(doc.categoriaOriginal)}</td><td>${esc(doc.categoriaConcurso)}</td><td class="numero">${money(doc.original)}</td><td class="numero">${money(doc.atribuida)}</td></tr>`).join('') || '<tr><td colspan="14" class="gerencia-empty">No hay productos para este mes y categoría.</td></tr>';
      const matches = Math.abs(Number(data.total) - expected) < 0.005;
      $('documentosEstado').textContent = matches ? 'Documentos de la fuente actual. El total coincide con el importe seleccionado.' : 'La fuente cambió: este detalle actual difiere del importe seleccionado. La base oficial permanece intacta; recalcule para revisar los valores actuales.';
      $('documentosTotal').textContent = `TOTAL VENTA ATRIBUIDA: ${money(data.total)} · Importe seleccionado: ${money(expected)}`;
    } catch (error) {
      if (sequence === detailRequest) $('documentosEstado').textContent = error.message;
    } finally {
      if (button) button.disabled = false;
      if (sequence === detailRequest) {
        $('documentosModal').setAttribute('aria-busy', 'false');
        $('documentosLoading').hidden = true;
      }
    }
  }
  function confirmCalculation(current, period) {
    const modal = $('confirmarCalculo');
    $('confirmarCalculoPeriodos').textContent = `Base oficial actual: ${periodLabel(current)}\nNuevo cálculo: ${periodLabel(period)}`;
    modal.returnValue = '';
    return new Promise(resolve => {
      modal.addEventListener('close', () => resolve(modal.returnValue === 'calcular'), { once: true });
      modal.showModal();
    });
  }
  async function calculate() {
    if (busy) return;
    let period;
    try { period = selectedPeriod(); } catch (error) { revision = ''; $('periodoError').textContent = error.message; buttons(); return; }
    const previousStatus = $('resultadoEstado').textContent;
    busy = true;
    buttons();
    $('resultadoEstado').textContent = `Verificando base oficial: ${periodLabel(period)}...`;
    try {
      const path = `calcular?${new URLSearchParams({ desde: period.periodo_desde, hasta: period.periodo_hasta })}`;
      let data;
      try {
        data = await request(path);
      } catch (error) {
        if (error.code !== 'official_exists_calculate') throw error;
        if (!await confirmCalculation(error.periodo, period)) {
          $('resultadoEstado').textContent = previousStatus;
          return;
        }
        $('resultadoEstado').textContent = `Calculando promedios: ${periodLabel(period)}...`;
        data = await request(`${path}&confirmar=1`);
      }
      revision = data.revision;
      render(data.registros, false, data.periodo);
      $('resultadoEstado').textContent = data.baseOficialExistente
        ? 'Valores preliminares. La base oficial existente no ha sido modificada.'
        : 'Cálculo preliminar completado. Revise el detalle antes de guardar.';
    } catch (error) {
      $('resultadoEstado').textContent = error.message;
    } finally { busy = false; buttons(); }
  }
  async function save() {
    if (busy || !revision) return;
    let period;
    try { period = selectedPeriod(); } catch (error) { revision = ''; $('periodoError').textContent = error.message; buttons(); return; }
    if (period.periodo_desde !== renderedPeriod?.periodo_desde || period.periodo_hasta !== renderedPeriod?.periodo_hasta) { periodChanged(); return; }
    const warning = current => `Ya existe una base oficial del Concurso de Ventas 2026.\nSi continúa, los valores actualmente guardados serán reemplazados por los nuevos valores calculados.\n\nBase oficial actual: ${periodLabel(current)}\nNueva base: ${periodLabel(period)}\n\n¿Desea continuar?`;
    let reemplazar = Boolean(official?.oficial);
    if (!window.confirm(reemplazar ? warning(official.periodo) : `Se guardará la base oficial del Concurso de Ventas 2026 con los valores actualmente calculados (${periodLabel(period)}). ¿Desea continuar?`)) return;
    busy = true;
    buttons();
    $('resultadoEstado').textContent = 'Guardando base oficial...';
    try {
      const persist = () => request('guardar', { method: 'POST', body: JSON.stringify({ confirmar: true, revision, reemplazar, desde: period.periodo_desde, hasta: period.periodo_hasta }) });
      let data;
      try {
        data = await persist();
      } catch (error) {
        if (error.code !== 'base_exists' || reemplazar) throw error;
        if (!window.confirm(warning(error.periodo))) {
          $('resultadoEstado').textContent = 'Guardado cancelado. La base oficial no fue modificada.';
          return;
        }
        reemplazar = true;
        data = await persist();
      }
      revision = '';
      updateState(data);
      render(data.registros, true, data.periodo);
      $('resultadoEstado').textContent = data.reemplazada ? 'Base oficial actualizada correctamente.' : 'Base oficial guardada correctamente.';
    } catch (error) {
      $('resultadoEstado').textContent = error.message;
      try { updateState(await request('estado')); } catch (_) { /* Se conserva el error de guardado. */ }
    } finally { busy = false; buttons(); }
  }
  function selectAdminTab(name) {
    const selected = ['base', 'configuracion', 'operacion'].includes(name) ? name : 'base';
    $('tabBase').hidden = selected !== 'base';
    $('tabConfiguracion').hidden = selected !== 'configuracion';
    $('tabOperacion').hidden = selected !== 'operacion';
    document.querySelectorAll('[data-admin-tab]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.adminTab === selected));
    });
    const url = new URL(window.location.href);
    url.searchParams.set('tab', selected);
    window.history.replaceState(null, '', url);
  }
  function dateLabel(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('es-CL');
  }
  function rangeLabel(range, unit) {
    const from = range.desde === null ? '' : `${range.incluyeDesde ? '≥' : '>'}${range.desde}${unit}`;
    const to = range.hasta === null ? '' : `${range.incluyeHasta ? '≤' : '<'}${range.hasta}${unit}`;
    return [from, to].filter(Boolean).join(' y ');
  }
  function field(value, key, integer = false) {
    return `<input class="filtro-select" type="number" min="0" step="${integer ? '1' : 'any'}" required data-config-field="${key}" value="${esc(value)}" />`;
  }
  function renderSection(section, edit) {
    const values = parameters[section];
    if (section === 'ventas') {
      const types = values.tiposMeta;
      const typeRows = [
        ['A', edit ? field(types.A.minimoInclusivo, 'metaA') : money(types.A.minimoInclusivo), '∞'],
        ['B', edit ? field(types.B.minimoInclusivo, 'metaB') : money(types.B.minimoInclusivo), money(types.A.minimoInclusivo) + ' (exclusivo)'],
        ['C', '> $0', money(types.B.minimoInclusivo) + ' (exclusivo)'],
        ['SIN META', '—', '≤ $0'],
      ];
      const classification = `<div class="tabla-wrapper"><table class="dash-tabla"><thead><tr><th>Tipo</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>${typeRows.map(row => `<tr><th>${row[0]}</th><td>${row[1]}</td><td>${row[2]}</td></tr>`).join('')}</tbody></table></div>`;
      const points = `<div class="tabla-wrapper"><table class="dash-tabla"><thead><tr><th>Tramo</th><th>Límite superior</th><th>A</th><th>B</th><th>C</th></tr></thead><tbody>${values.tramosCumplimiento.map((range, index) => `<tr><td>${esc(rangeLabel(range, '%'))}</td><td>${range.hasta === null ? '∞' : edit ? field(range.hasta, `ventaHasta${index}`) : `${range.hasta}%`}</td>${['A', 'B', 'C'].map(type => `<td>${edit ? field(range.puntos[type], `ventaPuntos${index}${type}`, true) : range.puntos[type]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      return `<p>Clasificación por Meta</p>${classification}<p>Puntos por cumplimiento</p>${points}`;
    }
    if (section === 'productos') {
      return `<div class="tabla-wrapper"><table class="dash-tabla"><thead><tr><th>Tramo superación</th><th>Límite superior</th><th>Puntos</th></tr></thead><tbody>${values.tramosSuperacion.map((range, index) => `<tr><td>${esc(rangeLabel(range, ''))}</td><td>${range.hasta === null ? '∞' : edit ? field(range.hasta, `productoHasta${index}`) : money(range.hasta)}</td><td>${edit ? field(range.puntos, `productoPuntos${index}`, true) : range.puntos}</td></tr>`).join('')}</tbody></table></div>`;
    }
    const cells = section === 'clientesNuevos'
      ? [['Venta mínima', 'ventaMinima', false], ['Puntos', 'puntos', true]]
      : [['Días mínimos sin compra', 'diasMinimosSinCompra', true], ['Venta mínima', 'ventaMinima', false], ['Puntos', 'puntos', true]];
    return `<div class="tabla-wrapper"><table class="dash-tabla"><thead><tr>${cells.map(([label]) => `<th>${label}</th>`).join('')}</tr></thead><tbody><tr>${cells.map(([, key, integer]) => `<td>${edit ? field(values[key], key, integer) : key === 'ventaMinima' ? money(values[key]) : values[key]}</td>`).join('')}</tr></tbody></table></div>`;
  }
  function renderParameters() {
    if (!parameters) return;
    $('configMetadata').textContent = `Versión ${parameters.version} · Última modificación: ${parameters.fechaActualizacion} · Actualizado por: ${parameters.actualizadoPor?.nombre || 'Configuración inicial'}`;
    document.querySelectorAll('[data-config-section]').forEach(card => {
      const section = card.dataset.configSection;
      const edit = editingSection === section;
      card.querySelector('.config-content').innerHTML = renderSection(section, edit);
      card.querySelector('.config-actions').innerHTML = edit
        ? '<button class="btn-buscar" type="button" data-config-action="cancelar">Cancelar</button><button class="btn-buscar" type="button" data-config-action="guardar">Guardar cambios</button>'
        : `<button class="btn-buscar" type="button" data-config-action="editar" ${editingSection || savingParameters ? 'disabled' : ''}>Editar</button>`;
      card.querySelectorAll('.config-actions button').forEach(button => { button.disabled = savingParameters || button.disabled; });
    });
    $('btnActualizarDiagnostico').disabled = Boolean(editingSection || savingParameters);
  }
  function readNumber(card, key, integer = false) {
    const input = card.querySelector(`[data-config-field="${key}"]`);
    if (!input || !input.value.trim() || !input.checkValidity()) throw new Error(`Valor inválido: ${key}.`);
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw new Error(`Valor inválido: ${key}.`);
    return value;
  }
  function readSection(card, section) {
    const values = structuredClone(parameters[section]);
    if (section === 'ventas') {
      values.tiposMeta.A.minimoInclusivo = readNumber(card, 'metaA');
      values.tiposMeta.B.minimoInclusivo = readNumber(card, 'metaB');
      values.tramosCumplimiento.forEach((range, index) => {
        if (range.hasta !== null) range.hasta = readNumber(card, `ventaHasta${index}`);
        if (index > 0) range.desde = values.tramosCumplimiento[index - 1].hasta;
        ['A', 'B', 'C'].forEach(type => { range.puntos[type] = readNumber(card, `ventaPuntos${index}${type}`, true); });
      });
    } else if (section === 'productos') {
      values.tramosSuperacion.forEach((range, index) => {
        if (range.hasta !== null) range.hasta = readNumber(card, `productoHasta${index}`);
        if (index > 0) range.desde = values.tramosSuperacion[index - 1].hasta;
        range.puntos = readNumber(card, `productoPuntos${index}`, true);
      });
    } else {
      Object.keys(values).forEach(key => { values[key] = readNumber(card, key, key !== 'ventaMinima'); });
    }
    return values;
  }
  function changes(oldValue, newValue, path = '') {
    if (oldValue && newValue && typeof oldValue === 'object' && typeof newValue === 'object') {
      return Object.keys(newValue).flatMap(key => changes(oldValue[key], newValue[key], path ? `${path}.${key}` : key));
    }
    return oldValue === newValue ? [] : [`${path}: ${oldValue} → ${newValue}`];
  }
  async function loadParameters() {
    const data = await request('parametros');
    parameters = data.parametros;
    editingSection = null;
    renderParameters();
    $('configEstado').textContent = '';
  }
  async function saveParameters(card, section) {
    if (savingParameters || !parameters) return;
    let values;
    try { values = readSection(card, section); } catch (error) { $('configEstado').textContent = error.message; return; }
    const diff = changes(parameters[section], values);
    if (!diff.length) { editingSection = null; renderParameters(); $('configEstado').textContent = 'No hay cambios para guardar.'; return; }
    const labels = { ventas: 'Tramos de Ventas', clientesNuevos: 'Clientes Nuevos', clientesRecuperados: 'Clientes Recuperados', productos: 'Productos' };
    const summary = `${labels[section]} · versión ${parameters.version}\n\n${diff.slice(0, 12).join('\n')}${diff.length > 12 ? `\n... y ${diff.length - 12} cambios más` : ''}\n\n¿Guardar cambios?`;
    if (!window.confirm(summary)) return;
    savingParameters = true;
    $('configLoading').hidden = false;
    $('configEstado').textContent = 'Guardando parámetros...';
    card.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
    $('btnActualizarDiagnostico').disabled = true;
    try {
      const data = await request('parametros', { method: 'POST', body: JSON.stringify({ seccion: section, valores: values, version: parameters.version }) });
      parameters = data.parametros;
      editingSection = null;
      $('configEstado').textContent = data.cambio ? `Parámetros guardados correctamente. Versión ${parameters.version}.` : 'No hubo cambios en los parámetros.';
    } catch (error) {
      $('configEstado').textContent = error.message;
    } finally {
      savingParameters = false;
      $('configLoading').hidden = true;
      if (editingSection) {
        card.querySelectorAll('input, button').forEach(control => { control.disabled = false; });
      } else {
        renderParameters();
      }
      $('btnActualizarDiagnostico').disabled = Boolean(editingSection);
    }
  }
  function renderDiagnostics(data) {
    const base = data.baseOficial;
    $('configBaseEstado').textContent = `Estado: ${base.estado}`;
    $('configBaseDetalle').textContent = `Versión: ${base.version ?? '—'} · Período: ${base.periodoDesde ?? '—'} a ${base.periodoHasta ?? '—'} · Generación: ${dateLabel(base.fechaGeneracion)} · Vendedores: ${base.vendedores ?? '—'} · Categorías: ${base.categorias ?? '—'}${base.detalle ? ` · ${base.detalle}` : ''}`;
    monthlyStates = data.meses;
    $('operacionMeses').innerHTML = monthlyStates.map(month => {
      const label = monthNames[month.mes - 1];
      const detail = month.estado === 'CERRADO'
        ? `<p>Versión ${esc(month.version)} · Cierre: ${esc(dateLabel(month.fechaCierre))} · Por: ${esc(month.cerradoPor || '—')}</p>`
        : `<p>${month.estado === 'PRUEBA' ? 'Período de prueba. Sin cierre oficial.' : month.estado === 'PENDIENTE' ? esc(month.detalle || 'Estado pendiente de revisión.') : 'Cálculo dinámico hasta su cierre.'}</p>`;
      const button = month.estado === 'ABIERTO' || month.estado === 'CERRADO'
        ? `<button class="btn-buscar" type="button" data-operation-month="${month.mes}" data-operation-action="${month.estado === 'CERRADO' ? 'reabrir' : 'cerrar'}">${month.estado === 'CERRADO' ? 'Reabrir mes' : 'Cerrar mes'}</button>` : '';
      return `<article class="tabla-card"><h3>${esc(label)} 2026</h3><strong>${esc(month.estado)}</strong>${detail}${button}</article>`;
    }).join('');
  }
  async function loadDiagnostics() {
    $('operacionEstado').textContent = 'Consultando estados...';
    const data = await request('diagnostico');
    renderDiagnostics(data);
    $('operacionEstado').textContent = '';
  }
  async function changeMonth(month, action) {
    if (operationBusy || ![10, 11, 12].includes(month) || !['cerrar', 'reabrir'].includes(action)) return;
    const state = monthlyStates.find(item => item.mes === month)?.estado;
    if ((action === 'cerrar' && state !== 'ABIERTO') || (action === 'reabrir' && state !== 'CERRADO')) return;
    const label = `${monthNames[month - 1]} 2026`;
    const warning = action === 'cerrar'
      ? `Se cerrará ${label} y se guardará el snapshot oficial con los resultados actuales. ¿Desea continuar?`
      : `Se reabrirá ${label} y sus resultados volverán a calcularse dinámicamente. ¿Desea continuar?`;
    if (!window.confirm(warning)) return;
    operationBusy = true;
    $('operacionLoading').hidden = false;
    $('operacionEstado').textContent = action === 'cerrar' ? `Cerrando ${label}...` : `Reabriendo ${label}...`;
    $('operacionMeses').querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const response = await fetch(`/api/gerencia/comercial/concurso-ventas/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ anio: 2026, mes: month }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'No se pudo cambiar el estado del mes.');
      await loadDiagnostics();
      $('operacionEstado').textContent = `${label}: ${result.estadoMes}.`;
    } catch (error) {
      $('operacionEstado').textContent = error.message;
    } finally {
      operationBusy = false;
      $('operacionLoading').hidden = true;
      $('operacionMeses').querySelectorAll('button').forEach(button => { button.disabled = false; });
    }
  }
  async function init() {
    if (!localStorage.getItem('token')) { window.location.href = '/src/modulo/varios/login/index.html'; return; }
    document.querySelectorAll('[data-admin-tab]').forEach(button => button.addEventListener('click', () => selectAdminTab(button.dataset.adminTab)));
    selectAdminTab(new URLSearchParams(window.location.search).get('tab'));
    $('btnActualizarDiagnostico').addEventListener('click', async () => {
      if (editingSection || savingParameters) return;
      try { await loadDiagnostics(); await loadParameters(); }
      catch (error) { $('configEstado').textContent = error.message; }
    });
    $('btnAdministrarBase').addEventListener('click', () => selectAdminTab('base'));
    document.querySelector('.concurso-admin-config').addEventListener('click', event => {
      const button = event.target.closest('[data-config-action]');
      if (!button || savingParameters) return;
      const card = button.closest('[data-config-section]');
      const section = card.dataset.configSection;
      if (button.dataset.configAction === 'editar') {
        if (editingSection || !parameters) return;
        editingSection = section;
        $('configEstado').textContent = '';
        renderParameters();
      } else if (button.dataset.configAction === 'cancelar') {
        editingSection = null;
        $('configEstado').textContent = '';
        renderParameters();
      } else if (button.dataset.configAction === 'guardar' && editingSection === section) {
        saveParameters(card, section);
      }
    });
    $('btnActualizarMeses').addEventListener('click', () => loadDiagnostics().catch(error => { $('operacionEstado').textContent = error.message; }));
    $('operacionMeses').addEventListener('click', event => {
      const button = event.target.closest('[data-operation-month]');
      if (button) changeMonth(Number(button.dataset.operationMonth), button.dataset.operationAction);
    });
    $('btnCalcular').addEventListener('click', calculate);
    $('btnGuardar').addEventListener('click', save);
    $('btnOficial').addEventListener('click', () => { revision = ''; render(official.registros, true, official.periodo); $('resultadoEstado').textContent = ''; buttons(); });
    $('promediosBody').addEventListener('click', event => { const button = event.target.closest('[data-vendedor]'); if (button) sellerDetail(Number(button.dataset.vendedor)); });
    $('categoriasDetalle').addEventListener('click', event => { const button = event.target.closest('[data-mes]'); if (button) documents(button.dataset.mes, button.dataset.categoria); });
    ['periodoDesde', 'periodoHasta'].forEach(id => $(id).addEventListener('input', periodChanged));
    periodChanged();
    ['btnCerrarDocumentos', 'btnXDocumentos'].forEach(id => $(id).addEventListener('click', () => $('documentosModal').close()));
    $('documentosModal').addEventListener('close', () => {
      detailRequest += 1;
      $('documentosModal').setAttribute('aria-busy', 'false');
      $('documentosLoading').hidden = true;
    });
    try {
      await loadDiagnostics();
      $('promediosPage').hidden = false;
      $('accesoEstado').hidden = true;
      try { await loadParameters(); } catch (error) { $('configEstado').textContent = error.message; }
      try {
        const data = await request('estado');
        updateState(data);
        if (data.oficial) render(data.registros, true, data.periodo);
      } catch (error) {
        $('resultadoEstado').textContent = error.message;
      }
    } catch (error) { $('accesoEstado').textContent = error.message; }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
