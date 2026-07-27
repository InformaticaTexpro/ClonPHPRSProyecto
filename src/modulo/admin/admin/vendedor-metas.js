'use strict';

(function () {
  const API = '/api/admin/vendedor-metas';
  const USUARIOS_API = '/api/admin/usuarios';

  const state = {
    usuarios: [],
    metas: [],
    selectedId: null,
  };

  const meses = [
    { value: 1, label: 'Enero' },
    { value: 2, label: 'Febrero' },
    { value: 3, label: 'Marzo' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Mayo' },
    { value: 6, label: 'Junio' },
    { value: 7, label: 'Julio' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Septiembre' },
    { value: 10, label: 'Octubre' },
    { value: 11, label: 'Noviembre' },
    { value: 12, label: 'Diciembre' },
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function token() {
    return localStorage.getItem('token');
  }

  function formatCLP(value) {
    const num = Number(value || 0);
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(Number.isFinite(num) ? num : 0);
  }

  function setBanner(message, type = 'info') {
    const banner = el('adminMessage');
    if (!banner) return;
    banner.hidden = !message;
    banner.textContent = message || '';
    banner.dataset.kind = type;
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function getMonthValue(value) {
    const month = Number(value || 0);
    if (!Number.isFinite(month) || month < 1) return 1;
    if (month > 12) return 12;
    return month;
  }

  function captureContext() {
    return {
      usuarioId: el('metaUsuarioId')?.value || '',
      tipoPeriodo: normalizeText(el('metaTipoPeriodo')?.value || 'mensual'),
      anio: el('metaAnio')?.value || String(new Date().getFullYear()),
      mes: getMonthValue(el('metaMes')?.value || (new Date().getMonth() + 1)),
      activo: el('metaActivo')?.value || '1',
      filtros: {
        usuario_id: normalizeText(el('metaFiltroUsuario')?.value || ''),
        tipo_periodo: normalizeText(el('metaFiltroTipo')?.value || ''),
        activo: normalizeText(el('metaFiltroEstado')?.value || ''),
      },
    };
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Error HTTP ${res.status}`);
    }
    return data.data ?? data;
  }

  function usuarioLabel(usuario) {
    const nombre = String(usuario.nombre || usuario.email || 'Usuario');
    const area = String(usuario.area || '').trim();
    return area ? `${nombre} · ${area}` : nombre;
  }

  function fillUsers() {
    const options = state.usuarios.map(usuario => ({
      value: usuario.id,
      label: usuarioLabel(usuario),
    }));

    const filterSelect = el('metaFiltroUsuario');
    const formSelect = el('metaUsuarioId');

    if (filterSelect) {
      filterSelect.innerHTML = '<option value="">Todos los usuarios</option>';
      options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = String(option.value);
        opt.textContent = option.label;
        filterSelect.appendChild(opt);
      });
    }

    if (formSelect) {
      formSelect.innerHTML = '<option value="">Selecciona un usuario</option>';
      options.forEach(option => {
        const opt = document.createElement('option');
        opt.value = String(option.value);
        opt.textContent = option.label;
        formSelect.appendChild(opt);
      });
    }
  }

  function fillMonths() {
    const select = el('metaMes');
    if (!select) return;
    select.innerHTML = '';
    meses.forEach((month, index) => {
      const option = document.createElement('option');
      option.value = String(month.value);
      option.textContent = month.label;
      if (index === new Date().getMonth()) option.selected = true;
      select.appendChild(option);
    });
  }

  function periodLabel(meta) {
    return meta.tipo_periodo === 'anual' ? 'Anual' : 'Mensual';
  }

  function syncPeriodoUI() {
    const tipo = normalizeText(el('metaTipoPeriodo')?.value || 'mensual');
    const mesSelect = el('metaMes');
    const anioInput = el('metaAnio');
    const preview = el('metaPreview');

    if (mesSelect) {
      mesSelect.disabled = tipo === 'anual';
      if (tipo === 'anual') {
        mesSelect.value = '1';
        if (mesSelect.options.length) mesSelect.selectedIndex = 0;
      }
    }

    if (preview) {
      preview.textContent = tipo === 'anual'
        ? 'La meta anual aplica al año completo seleccionado. La meta mensual se aplica solo al mes seleccionado.'
        : 'La meta mensual se aplica solo al mes seleccionado. Las metas anuales quedan como referencia general.';
    }

    if (anioInput && !anioInput.value) {
      anioInput.value = String(new Date().getFullYear());
    }
  }

  function resetForm() {
    state.selectedId = null;
    const editId = el('metaEditId');
    const title = el('metaFormTitle');
    const subtitle = el('metaFormSubtitle');
    const button = el('metaGuardar');
    const usuario = el('metaUsuarioId');
    const tipo = el('metaTipoPeriodo');
    const anio = el('metaAnio');
    const mes = el('metaMes');
    const monto = el('metaMonto');
    const activo = el('metaActivo');
    const observacion = el('metaObservacion');

    if (editId) editId.value = '';
    if (title) title.textContent = 'Nueva meta de vendedor';
    if (subtitle) subtitle.textContent = 'Selecciona un usuario, el tipo de periodo y el valor a aplicar.';
    if (button) button.textContent = 'Guardar meta';
    if (usuario) usuario.value = '';
    if (tipo) tipo.value = 'mensual';
    if (anio) anio.value = String(new Date().getFullYear());
    if (mes) {
      mes.value = String(new Date().getMonth() + 1);
      if (mes.options.length) mes.selectedIndex = new Date().getMonth();
    }
    if (monto) monto.value = '';
    if (activo) activo.value = '1';
    if (observacion) observacion.value = '';
    syncPeriodoUI();
  }

  function applyFilterValues(filters = {}) {
    const usuario = el('metaFiltroUsuario');
    const tipo = el('metaFiltroTipo');
    const estado = el('metaFiltroEstado');
    if (usuario && filters.usuario_id !== undefined) usuario.value = String(filters.usuario_id || '');
    if (tipo && filters.tipo_periodo !== undefined) tipo.value = String(filters.tipo_periodo || '');
    if (estado && filters.activo !== undefined) estado.value = String(filters.activo || '');
  }

  function filteredMetas() {
    const filters = {
      usuario_id: normalizeText(el('metaFiltroUsuario')?.value || ''),
      tipo_periodo: normalizeText(el('metaFiltroTipo')?.value || ''),
      activo: normalizeText(el('metaFiltroEstado')?.value || ''),
    };

    return state.metas.filter(meta => {
      if (filters.usuario_id && String(meta.usuario_id) !== filters.usuario_id) return false;
      if (filters.tipo_periodo && meta.tipo_periodo !== filters.tipo_periodo) return false;
      if (filters.activo !== '' && String(Number(meta.activo ? 1 : 0)) !== filters.activo) return false;
      return true;
    });
  }

  function renderTable() {
    const tbody = el('metasTbody');
    if (!tbody) return;

    const rows = filteredMetas();
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="tabla-empty">No hay metas para mostrar.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(meta => {
      const stateLabel = meta.activo ? 'Activa' : 'Inactiva';
      const acciones = meta.activo
        ? `<button class="btn-secondary" type="button" data-action="desactivar" data-id="${meta.id}">Desactivar</button>`
        : `<button class="btn-secondary" type="button" data-action="activar" data-id="${meta.id}">Activar</button>`;

      return `
        <tr>
          <td>
            <strong>${meta.usuario_nombre || 'Sin nombre'}</strong>
            <div class="inline-help">${meta.usuario_email || ''}</div>
          </td>
          <td>${meta.usuario_area || '—'}</td>
          <td>${periodLabel(meta)}</td>
          <td>${meta.fecha || '—'}</td>
          <td style="text-align:right">${formatCLP(meta.meta_original)}</td>
          <td>${stateLabel}</td>
          <td>${meta.observacion || '—'}</td>
          <td>
            <div class="permission-actions" style="justify-content:flex-start">
              <button class="btn-secondary" type="button" data-action="editar" data-id="${meta.id}">Editar</button>
              ${acciones}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function fillForm(meta) {
    if (!meta) return;
    state.selectedId = meta.id;
    const editId = el('metaEditId');
    const title = el('metaFormTitle');
    const subtitle = el('metaFormSubtitle');
    const button = el('metaGuardar');
    const usuario = el('metaUsuarioId');
    const tipo = el('metaTipoPeriodo');
    const anio = el('metaAnio');
    const mes = el('metaMes');
    const monto = el('metaMonto');
    const activo = el('metaActivo');
    const observacion = el('metaObservacion');

    if (editId) editId.value = String(meta.id);
    if (title) title.textContent = 'Editar meta de vendedor';
    if (subtitle) subtitle.textContent = 'Modifica los datos y guarda para actualizar el periodo seleccionado.';
    if (button) button.textContent = 'Actualizar meta';
    if (usuario) usuario.value = String(meta.usuario_id || '');
    if (tipo) tipo.value = meta.tipo_periodo === 'anual' ? 'anual' : 'mensual';
    if (anio) anio.value = String((meta.fecha || '').slice(0, 4) || new Date().getFullYear());
    if (mes) mes.value = String(Number((meta.fecha || '').slice(5, 7) || 1));
    if (monto) monto.value = String(meta.meta_original ?? 0);
    if (activo) activo.value = meta.activo ? '1' : '0';
    if (observacion) observacion.value = meta.observacion || '';
    syncPeriodoUI();
  }

  function restoreFormContext(context) {
    if (!context) return;

    const month = getMonthValue(context.mes);

    state.selectedId = null;

    const editId = el('metaEditId');
    const title = el('metaFormTitle');
    const subtitle = el('metaFormSubtitle');
    const button = el('metaGuardar');
    const usuario = el('metaUsuarioId');
    const tipo = el('metaTipoPeriodo');
    const anio = el('metaAnio');
    const mes = el('metaMes');
    const monto = el('metaMonto');
    const activo = el('metaActivo');
    const observacion = el('metaObservacion');

    if (editId) editId.value = '';
    if (title) title.textContent = 'Nueva meta de vendedor';
    if (subtitle) subtitle.textContent = 'Selecciona un usuario, el tipo de periodo y el valor a aplicar.';
    if (button) button.textContent = 'Guardar meta';
    if (usuario) usuario.value = String(context.usuarioId || '');
    if (tipo) tipo.value = context.tipoPeriodo === 'anual' ? 'anual' : 'mensual';
    if (anio) anio.value = String(context.anio || new Date().getFullYear());
    if (mes) {
      mes.value = String(month || 1);
      if (mes.options.length && month > 0) mes.selectedIndex = Math.min(month - 1, mes.options.length - 1);
    }
    if (monto) monto.value = '';
    if (activo) activo.value = String(context.activo || '1');
    if (observacion) observacion.value = '';

    syncPeriodoUI();
    applyFilterValues(context.filtros);
    renderTable();
  }

  async function loadData(options = {}) {
    const { context = null, silent = false } = options;
    setBanner('Cargando metas de vendedores...', 'info');
    try {
      const [usuarios, metas] = await Promise.all([
        fetchJson(USUARIOS_API),
        fetchJson(API),
      ]);

      state.usuarios = Array.isArray(usuarios) ? usuarios : [];
      state.metas = Array.isArray(metas) ? metas : [];
      fillUsers();
      fillMonths();

      if (context) {
        restoreFormContext(context);
      } else {
        resetForm();
        renderTable();
      }

      if (!silent) {
        setBanner('Metas de vendedores cargadas correctamente.', 'success');
      }
    } catch (error) {
      console.error('[vendedor-metas]', error);
      setBanner(error.message || 'No se pudieron cargar las metas de vendedores.', 'error');
    }
  }

  async function saveMeta() {
    const context = captureContext();
    const usuarioId = context.usuarioId;
    const tipo = context.tipoPeriodo || 'mensual';
    const anio = context.anio;
    const mes = el('metaMes')?.value;
    const meta = el('metaMonto')?.value;
    const activo = el('metaActivo')?.value;
    const observacion = el('metaObservacion')?.value || '';
    const editId = el('metaEditId')?.value;

    if (!usuarioId) {
      setBanner('Selecciona un usuario antes de guardar la meta.', 'error');
      return;
    }
    if (!anio || Number(anio) < 2026) {
      setBanner('Indica un año válido para la meta.', 'error');
      return;
    }
    if (meta === '' || Number(meta) < 0) {
      setBanner('La meta debe ser un número igual o mayor a cero.', 'error');
      return;
    }

    const payload = {
      usuario_id: Number(usuarioId),
      tipo_periodo: tipo,
      anio: Number(anio),
      mes: Number(mes || 1),
      meta: Number(meta),
      activo: Number(activo) === 1,
      observacion,
    };

    const method = editId ? 'PUT' : 'POST';
    const url = editId ? `${API}/${editId}` : API;

    try {
      await fetchJson(url, {
        method,
        body: JSON.stringify(payload),
      });

      await loadData({
        context,
        silent: true,
      });

      setBanner('Meta guardada correctamente. Se mantuvieron los filtros y selectores seleccionados.', 'success');
      el('metaMonto')?.focus();
    } catch (error) {
      console.error('[vendedor-metas.save]', error);
      setBanner(error.message || 'No se pudo guardar la meta.', 'error');
    }
  }

  async function toggleMeta(id, activo) {
    try {
      await fetchJson(`${API}/${id}/${activo ? 'activar' : 'desactivar'}`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      await loadData({
        context: captureContext(),
        silent: true,
      });
      setBanner(activo ? 'Meta activada correctamente.' : 'Meta desactivada correctamente.', 'success');
    } catch (error) {
      console.error('[vendedor-metas.toggle]', error);
      setBanner(error.message || 'No se pudo actualizar el estado de la meta.', 'error');
    }
  }

  function wireEvents() {
    const btnNueva = el('btnNuevaMetaVendedor');
    const btnLimpiar = el('metaLimpiar');
    const btnGuardar = el('metaGuardar');
    const tipo = el('metaTipoPeriodo');
    const filtros = ['metaFiltroUsuario', 'metaFiltroTipo', 'metaFiltroEstado'];

    if (btnNueva) {
      btnNueva.addEventListener('click', () => {
        resetForm();
        setBanner('Completa el formulario para crear una nueva meta.', 'info');
      });
    }

    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', () => {
        resetForm();
        setBanner('Formulario limpiado.', 'info');
      });
    }

    if (btnGuardar) {
      btnGuardar.addEventListener('click', saveMeta);
    }

    if (tipo) {
      tipo.addEventListener('change', syncPeriodoUI);
    }

    filtros.forEach(id => {
      const select = el(id);
      if (!select) return;
      select.addEventListener('change', renderTable);
    });

    const table = el('metasTbody');
    if (table) {
      table.addEventListener('click', async event => {
        const button = event.target.closest('button[data-action][data-id]');
        if (!button) return;
        const id = Number(button.dataset.id);
        const action = button.dataset.action;
        const meta = state.metas.find(item => Number(item.id) === id);
        if (!meta) return;

        if (action === 'editar') {
          fillForm(meta);
          setBanner(`Editando meta de ${meta.usuario_nombre || 'usuario'}.`, 'info');
          return;
        }
        if (action === 'activar') {
          await toggleMeta(id, true);
          return;
        }
        if (action === 'desactivar') {
          await toggleMeta(id, false);
        }
      });
    }
  }

  async function init() {
    if (!el('metasTbody')) return;
    fillMonths();
    fillUsers();
    wireEvents();
    resetForm();
    await loadData();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
