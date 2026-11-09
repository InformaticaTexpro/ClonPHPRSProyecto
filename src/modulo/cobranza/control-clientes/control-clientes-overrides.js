'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
  const path = '/api/cobranza/control-clientes/overrides';
  const form = $('overrideForm');
  let action = 'INCLUIR', validated = false, revision = 0, busy = false, listSequence = 0, items = [], selectedId = null, sourceDocs = [];
  const labels = { MISMO_RUT_OTRO_CODIGO: 'Mismo RUT, otro código', ACTIVIDAD_COMERCIAL_NO_REFLEJADA: 'Actividad comercial no reflejada', ATRIBUCION_COMERCIAL_ESPECIAL: 'Atribución comercial especial', CORRECCION_ADMINISTRATIVA: 'Corrección administrativa', OTRO: 'Otro' };
  async function api(suffix = '', method = 'GET', data = {}) {
    const query = new URLSearchParams(Object.entries(data).filter(([, v]) => v !== '' && v != null));
    const response = await fetch(path + suffix + (method === 'GET' ? `?${query}` : ''), {
      method, headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data) })
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) throw new Error(result.error || `Error HTTP ${response.status}`);
    return result;
  }
  function invalidate() {
    revision++; validated = false; $('overrideSave').disabled = true;
    $('overrideReasons').hidden = true; $('overrideEvidence').textContent = ''; $('overrideDialogStatus').textContent = '';
    $('overrideDialogStatus').classList.remove('override-alert', 'client-status--error');
    $('overrideDialogStatus').setAttribute('role', 'status');
  }
  async function list() {
    const sequence = ++listSequence;
    $('overrideStatus').textContent = 'Consultando excepciones…';
    try {
      const result = await api('', 'GET', Object.fromEntries(new FormData($('overrideFilters'))));
      if (sequence !== listSequence) return;
      items = result.items;
      $('overrideRows').innerHTML = items.map(item => `<tr><td><span class="client-tag${item.activo ? '' : ' client-tag--muted'}">${item.activo ? 'ACTIVA' : 'REVERTIDA'}</span></td><td>${esc(item.tipoEvento)}</td><td class="${item.accion === 'EXCLUIR' ? 'override-negative' : 'override-positive'}">${esc(item.accion)}</td><td>${esc(item.cliente)}</td><td>${esc(item.rut)}</td><td>${esc(item.codaux)}</td><td>${esc(item.folio)}</td><td>${esc(item.periodo)}</td><td>${esc(labels[item.motivoCodigo] || item.motivoCodigo)}<small>${esc(item.motivoDetalle)}</small>${!item.activo ? `<small>Reversión: ${esc(item.motivoReversion)} · ${esc(item.revertidoPor)} · ${esc(item.revertidoEn)}</small>` : ''}</td><td>${esc(item.creadoPor)}</td><td>${esc(item.creadoEn)}</td><td>${item.activo ? `<button type="button" class="client-button client-button--light" data-revert="${item.id}">Revertir</button>` : '—'}</td></tr>`).join('') || '<tr><td colspan="12">Sin excepciones para estos filtros.</td></tr>';
      $('overrideStatus').textContent = `${items.length} excepciones. Las activas se aplican a Cobranzas, Cartera y Concurso en meses abiertos.`;
    } catch (error) { if (sequence === listSequence) $('overrideStatus').textContent = error.message; }
  }
  function open(event = null) {
    form.reset(); invalidate(); action = event ? 'EXCLUIR' : 'INCLUIR';
    $('overrideTitle').textContent = event ? `Excluir: ${event.cliente}` : 'Agregar cliente';
    $('overrideSave').textContent = event ? 'Confirmar exclusión' : 'Confirmar inclusión';
    form.elements.tipoEvento.value = event?.categoria === 'recuperados' ? 'RECUPERADO' : 'NUEVO';
    form.elements.periodo.value = event?.periodo || $('overrideFilters').elements.periodo.value || new Date().toISOString().slice(0, 7);
    form.elements.rut.value = event?.rut || '';
    form.elements.codaux.value = event?.codigoCliente || '';
    sourceDocs = (event?.folios || []).filter(doc => doc.tipo === 'F');
    $('overrideDocChoiceLabel').hidden = sourceDocs.length === 0;
    $('overrideDocChoice').innerHTML = sourceDocs.map((doc, i) => `<option value="${i}">Folio ${esc(doc.folio)} · ${esc(doc.fecha)} · ${esc(doc.clienteCodigo)}</option>`).join('');
    if (sourceDocs.length) selectDoc();
    $('overrideDetail').required = false;
    $('overrideDialog').showModal();
  }
  function selectDoc() {
    const doc = sourceDocs[Number($('overrideDocChoice').value)];
    if (!doc) return;
    form.elements.folio.value = doc.folio; form.elements.codaux.value = doc.clienteCodigo;
    form.elements.periodo.value = doc.fecha.slice(0, 7); invalidate();
  }
  $('overrideIdentity').addEventListener('input', invalidate);
  $('overrideDocChoice').addEventListener('change', selectDoc);
  $('overrideReason').addEventListener('change', () => { $('overrideDetail').required = $('overrideReason').value === 'OTRO'; });
  $('overrideValidate').addEventListener('click', async () => {
    if (busy || ![...$('overrideIdentity').querySelectorAll('input,select')].every(input => input.reportValidity())) return;
    invalidate(); const current = revision; busy = true;
    $('overrideValidate').disabled = true; $('overrideDialogStatus').textContent = 'Validando documento en Softland…';
    try {
      const result = await api('/validar', 'POST', Object.fromEntries(new FormData(form)));
      if (current !== revision) return;
      if (!result.validado) throw new Error(result.mensaje);
      const d = result.documento, c = result.cliente, v = result.vendedor;
      $('overrideEvidence').innerHTML = `<strong>${esc(c.nombre)}</strong><br>RUT: ${esc(c.rut)} · CodAux: ${esc(c.codaux)}<br>Documento ${esc(d.tipo)} ${esc(d.folio)} · NroInt ${esc(d.nroint)} · ${esc(d.fecha)}<br>Vendedor: ${esc(v.nombre)} (${esc(v.codigo)}) · ${money(d.monto)}<br>Compartidos: ${result.compartidos.length ? result.compartidos.map(p => `${esc(p.nombre)} (${esc(p.codigo)}): ${esc(p.porcentaje)}%`).join(' · ') : 'NO'}`;
      validated = true; $('overrideReasons').hidden = false; $('overrideSave').disabled = false;
      $('overrideDialogStatus').textContent = 'Documento validado. Seleccione el motivo para confirmar.';
      if (result.overrideVigente) showExisting(result.overrideVigente);
    } catch (error) { if (current === revision) $('overrideDialogStatus').textContent = error.message; }
    finally { busy = false; $('overrideValidate').disabled = false; }
  });
  function showExisting(item) {
    validated = false; $('overrideSave').disabled = true;
    const month = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' }).format(new Date(`${item.periodo}-02T12:00:00`));
    $('overrideDialogStatus').textContent = `Este cliente ya tiene una ${item.accion === 'EXCLUIR' ? 'exclusión' : 'inclusión'} manual activa como ${item.tipoEvento === 'NUEVO' ? 'Nuevo' : 'Recuperado'} para ${month}. Debe revertirla antes de crear una nueva excepción.`;
    $('overrideDialogStatus').classList.add('override-alert', 'client-status--error');
    $('overrideDialogStatus').setAttribute('role', 'alert');
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !validated || !form.reportValidity()) return;
    busy = true; $('overrideSave').disabled = true; $('overrideCancel').disabled = true; $('overrideValidate').disabled = true;
    // Impide modificar la identidad mientras el servidor vuelve a validar y guarda.
    const controls = [...form.querySelectorAll('input,select,textarea')];
    const payload = { ...Object.fromEntries(new FormData(form)), accion: action };
    controls.forEach(control => { control.disabled = true; });
    try {
      await api('', 'POST', payload); $('overrideDialog').close(); await list();
      window.dispatchEvent(new Event('cobranza-overrides-changed'));
    } catch (error) {
      $('overrideDialogStatus').textContent = error.message;
      $('overrideDialogStatus').classList.add('override-alert', 'client-status--error');
      $('overrideDialogStatus').setAttribute('role', 'alert');
      // Cubre también un conflicto creado por otra sesión después de validar.
      if (/override activo|inclusión manual activa/i.test(error.message)) validated = false;
    }
    finally {
      busy = false; controls.forEach(control => { control.disabled = false; });
      $('overrideSave').disabled = !validated; $('overrideCancel').disabled = false; $('overrideValidate').disabled = false;
    }
  });
  $('overrideCancel').addEventListener('click', () => { if (!busy) { invalidate(); $('overrideDialog').close(); } });
  $('overrideDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else invalidate(); });
  $('overrideFilters').addEventListener('submit', event => { event.preventDefault(); list(); });
  $('overrideAdd').addEventListener('click', () => open());
  window.addEventListener('cobranza-override-excluir', event => { if (!busy) open(event.detail); });
  $('overrideRows').addEventListener('click', event => {
    const button = event.target.closest('[data-revert]'); if (!button || busy) return;
    selectedId = Number(button.dataset.revert);
    const item = items.find(row => row.id === selectedId);
    $('overrideRevertClient').textContent = `${item.cliente} · ${item.periodo} · ${item.tipoEvento} · ${item.accion}`;
    $('overrideRevertForm').reset(); $('overrideRevertStatus').textContent = ''; $('overrideRevertDialog').showModal();
  });
  $('overrideRevertForm').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !$('overrideRevertForm').reportValidity()) return;
    busy = true; $('overrideRevertSave').disabled = true; $('overrideRevertCancel').disabled = true;
    try {
      await api('/revertir', 'POST', { id: selectedId, motivo: $('overrideRevertForm').elements.motivo.value });
      $('overrideRevertDialog').close(); await list();
      window.dispatchEvent(new Event('cobranza-overrides-changed'));
    } catch (error) { $('overrideRevertStatus').textContent = error.message; }
    finally { busy = false; $('overrideRevertSave').disabled = false; $('overrideRevertCancel').disabled = false; }
  });
  $('overrideRevertCancel').addEventListener('click', () => { if (!busy) $('overrideRevertDialog').close(); });
  $('overrideRevertDialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  api('/permisos').then(result => {
    if (!result.puedeAdministrar) return;
    window.cobranzaOverridesAdmin = true; $('overridePanel').hidden = false;
    $('overrideReason').innerHTML = '<option value="">Seleccione motivo</option>' + result.motivos.map(code => `<option value="${esc(code)}">${esc(labels[code] || code)}</option>`).join('');
    window.dispatchEvent(new Event('cobranza-overrides-ready')); list();
  }).catch(() => { /* Sin permiso confirmado, las acciones administrativas permanecen ocultas. */ });
})();
