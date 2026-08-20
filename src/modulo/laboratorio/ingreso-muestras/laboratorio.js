'use strict';

(function () {
  const API = '/api/laboratorio';
  const LOGIN_PATH = '/src/modulo/varios/login/index.html';
  const NO_ACCESS_PATH = '/src/modulo/varios/sin-acceso/index.html';
  const TOKEN = () => localStorage.getItem('token');

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const state = {
    user: null,
    config: null,
    resumen: null,
    solicitudes: [],
    parametros: [],
    auditoria: [],
    filtros: {
      mes: new Date().getMonth() + 1,
      anio: new Date().getFullYear(),
      vendedor: '',
      estado: 'todos',
      search: '',
    },
    editandoSolicitudId: null,
    editandoParametroId: null,
  };

  const el = {
    sidebar: document.getElementById('sidebar'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    mainWrapper: document.getElementById('mainWrapper'),
    headerMenuBtn: document.getElementById('headerMenuBtn'),
    btnLogout: document.getElementById('btnLogout'),
    headerDate: document.getElementById('headerDate'),
    userAvatar: document.getElementById('userAvatar'),
    userName: document.getElementById('userName'),
    userArea: document.getElementById('userArea'),
    chipAvatar: document.getElementById('chipAvatar'),
    chipName: document.getElementById('chipName'),
    welcomeTitle: document.getElementById('welcomeTitle'),
    welcomeSubtitle: document.getElementById('welcomeSubtitle'),
    filtroMes: document.getElementById('filtroMes'),
    filtroAnio: document.getElementById('filtroAnio'),
    filtroVendedor: document.getElementById('filtroVendedor'),
    btnActualizar: document.getElementById('btnActualizar'),
    statusBanner: document.getElementById('statusBanner'),
    kpiSolicitudes: document.getElementById('kpiSolicitudes'),
    kpiMuestras: document.getElementById('kpiMuestras'),
    kpiMonto: document.getElementById('kpiMonto'),
    kpiParametros: document.getElementById('kpiParametros'),
    resumenPeriodo: document.getElementById('resumenPeriodo'),
    tbodyResumenVendedores: document.getElementById('tbodyResumenVendedores'),
    tbodyResumenParametros: document.getElementById('tbodyResumenParametros'),
    solicitudesSubtitulo: document.getElementById('solicitudesSubtitulo'),
    busquedaSolicitudes: document.getElementById('busquedaSolicitudes'),
    filtroEstado: document.getElementById('filtroEstado'),
    btnExportarCsv: document.getElementById('btnExportarCsv'),
    tbodySolicitudes: document.getElementById('tbodySolicitudes'),
    folioSiguiente: document.getElementById('folioSiguiente'),
    formSolicitud: document.getElementById('formSolicitud'),
    solicitudId: document.getElementById('solicitudId'),
    numeroSolicitud: document.getElementById('numeroSolicitud'),
    fechaIngreso: document.getElementById('fechaIngreso'),
    estadoSolicitud: document.getElementById('estadoSolicitud'),
    vendedorCodigo: document.getElementById('vendedorCodigo'),
    vendedorNombre: document.getElementById('vendedorNombre'),
    numeroMuestras: document.getElementById('numeroMuestras'),
    observacion: document.getElementById('observacion'),
    solicitudLineas: document.getElementById('solicitudLineas'),
    solicitudTotal: document.getElementById('solicitudTotal'),
    btnAgregarLinea: document.getElementById('btnAgregarLinea'),
    btnLimpiarSolicitud: document.getElementById('btnLimpiarSolicitud'),
    btnGuardarSolicitud: document.getElementById('btnGuardarSolicitud'),
    panelParametros: document.getElementById('panelParametros'),
    btnNuevoParametro: document.getElementById('btnNuevoParametro'),
    formParametro: document.getElementById('formParametro'),
    parametroId: document.getElementById('parametroId'),
    parametroNombre: document.getElementById('parametroNombre'),
    parametroValor: document.getElementById('parametroValor'),
    parametroActivo: document.getElementById('parametroActivo'),
    tbodyParametros: document.getElementById('tbodyParametros'),
    auditList: document.getElementById('auditList'),
  };

  function formatCLP(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('es-CL').format(Number(value || 0));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeCode(value) {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function normalizeEstado(value) {
    return String(value ?? '').trim().toUpperCase();
  }

  function estadoClass(estado) {
    const valor = normalizeEstado(estado).replace(/_/g, '-').toLowerCase();
    if (valor === 'ingresada') return 'estado-pill estado-pill--ingresada';
    if (valor === 'en-proceso') return 'estado-pill estado-pill--en-proceso';
    if (valor === 'finalizada') return 'estado-pill estado-pill--finalizada';
    if (valor === 'anulada') return 'estado-pill estado-pill--anulada';
    return 'estado-pill estado-pill--ingresada';
  }

  function initMonthsYears() {
    if (el.filtroMes) {
      el.filtroMes.innerHTML = MESES.map((mes, idx) => `<option value="${idx + 1}">${mes}</option>`).join('');
      el.filtroMes.value = String(state.filtros.mes);
    }

    if (el.filtroAnio) {
      const current = new Date().getFullYear();
      const years = [];
      for (let year = current - 2; year <= current + 2; year += 1) years.push(year);
      el.filtroAnio.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
      el.filtroAnio.value = String(state.filtros.anio);
    }
  }

  async function fetchJson(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN() || ''}`,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || `Error HTTP ${response.status}`);
    }
    return payload;
  }

  async function ensureSession() {
    if (!TOKEN()) {
      window.location.href = LOGIN_PATH;
      return false;
    }
    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${TOKEN()}` },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.user) {
        window.location.href = LOGIN_PATH;
        return false;
      }
      state.user = payload.user;
      if (!hasAccess(state.user)) {
        const params = new URLSearchParams({
          modulo: 'Laboratorio',
          from: '/src/modulo/laboratorio/ingreso-muestras/index.html',
        });
        window.location.href = `${NO_ACCESS_PATH}?${params.toString()}`;
        return false;
      }
      return true;
    } catch {
      window.location.href = LOGIN_PATH;
      return false;
    }
  }

  function hasAccess(user) {
    if (!user) return false;
    if (user.is_admin === true || user.is_admin === 1 || user.is_admin === '1') return true;
    if (normalizeText(user.area).toLowerCase() === 'laboratorio') return true;
    const perfiles = Array.isArray(user.perfiles) ? user.perfiles : [];
    if (perfiles.some(perfil => normalizeText(perfil?.codigo).toLowerCase() === 'laboratorio')) return true;
    const menus = Array.isArray(user.menus) ? user.menus : [];
    return menus.some(menu => normalizeText(menu?.codigo).toLowerCase() === 'laboratorio_ingreso_muestras');
  }

  function setBanner(message, tipo = 'info') {
    if (!el.statusBanner) return;
    el.statusBanner.hidden = !message;
    el.statusBanner.textContent = message || '';
    el.statusBanner.dataset.tipo = tipo;
  }

  function setLoadingState(isLoading) {
    if (el.btnActualizar) el.btnActualizar.disabled = isLoading;
    if (el.btnGuardarSolicitud) el.btnGuardarSolicitud.disabled = isLoading;
  }

  function setUserHeader() {
    const nombre = normalizeText(state.user?.nombre || state.user?.email || 'Usuario');
    const iniciales = nombre
      .split(' ')
      .slice(0, 2)
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase();

    if (el.userAvatar) el.userAvatar.textContent = iniciales || 'T';
    if (el.userName) el.userName.textContent = nombre;
    if (el.userArea) el.userArea.textContent = normalizeText(state.user?.area || '');
    if (el.chipAvatar) el.chipAvatar.textContent = iniciales || 'T';
    if (el.chipName) el.chipName.textContent = nombre.split(' ')[0] || 'Usuario';
    if (el.headerDate) {
      el.headerDate.textContent = new Date().toLocaleDateString('es-CL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
    if (el.welcomeTitle) el.welcomeTitle.textContent = `Hola, ${nombre.split(' ')[0] || 'Usuario'}!`;
    if (el.welcomeSubtitle) {
      el.welcomeSubtitle.textContent = `Area: ${normalizeText(state.user?.area || 'Laboratorio')} - Texpro`;
    }
  }

  function syncFilterControls() {
    if (el.filtroMes) el.filtroMes.value = String(state.filtros.mes);
    if (el.filtroAnio) el.filtroAnio.value = String(state.filtros.anio);
    if (el.filtroVendedor) el.filtroVendedor.value = state.filtros.vendedor;
    if (el.filtroEstado) el.filtroEstado.value = state.filtros.estado;
    if (el.busquedaSolicitudes) el.busquedaSolicitudes.value = state.filtros.search;
  }

  function fillVendorSelects(vendedores) {
    const items = Array.isArray(vendedores) ? vendedores : [];
    const seen = new Set();
    const options = [];

    items.forEach(item => {
      const codigo = normalizeCode(item?.cod_vendedor);
      if (!codigo || seen.has(codigo)) return;
      seen.add(codigo);
      const tipo = normalizeText(item?.tipo);
      options.push(`<option value="${codigo}">${codigo}${tipo ? ` - ${escapeHtml(tipo)}` : ''}</option>`);
    });

    const html = `<option value="">Todos mis codigos</option>${options.join('')}`;
    if (el.filtroVendedor) el.filtroVendedor.innerHTML = html;
    if (el.vendedorCodigo) el.vendedorCodigo.innerHTML = `<option value="">Selecciona un codigo</option>${options.join('')}`;
  }

  function fillParamSelect(select, selected = '') {
    if (!select) return;
    const options = state.parametros.map(parametro => {
      const selectedAttr = String(parametro.id) === String(selected) ? ' selected' : '';
      return `<option value="${parametro.id}" data-valor="${Number(parametro.valor_ensayo || 0)}"${selectedAttr}>${escapeHtml(parametro.nombre)} - ${formatCLP(parametro.valor_ensayo)}</option>`;
    }).join('');
    select.innerHTML = `<option value="">Seleccione</option>${options}`;
  }

  function createLinea(data = {}) {
    const row = document.createElement('div');
    row.className = 'linea-param';
    row.innerHTML = `
      <select class="control-select linea-parametro"></select>
      <input class="control-input linea-valor" type="text" readonly />
      <input class="control-input linea-cantidad" type="number" min="1" step="1" value="${Number(data.cantidad_muestras || 1)}" />
      <div class="linea-total">$0</div>
      <button type="button" class="icon-btn linea-eliminar" aria-label="Eliminar linea">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    `;

    const select = row.querySelector('.linea-parametro');
    const valorInput = row.querySelector('.linea-valor');
    const cantidadInput = row.querySelector('.linea-cantidad');
    const totalNode = row.querySelector('.linea-total');
    const eliminarBtn = row.querySelector('.linea-eliminar');

    fillParamSelect(select, data.parametro_id || data.id || '');

    function updateRow() {
      const currentOption = select.selectedOptions[0];
      const valor = Number(currentOption?.dataset?.valor || 0);
      const cantidad = Math.max(1, Number(cantidadInput.value || 1) || 1);
      cantidadInput.value = String(cantidad);
      valorInput.value = formatCLP(valor);
      totalNode.textContent = formatCLP(valor * cantidad);
      recalcularTotalSolicitud();
    }

    if (data.parametro_id) select.value = String(data.parametro_id);
    if (data.valor_ensayo != null) valorInput.value = formatCLP(data.valor_ensayo);
    if (data.cantidad_muestras != null) cantidadInput.value = String(data.cantidad_muestras);

    select.addEventListener('change', updateRow);
    cantidadInput.addEventListener('input', updateRow);
    eliminarBtn.addEventListener('click', () => {
      row.remove();
      if (!el.solicitudLineas.children.length) addLinea();
      recalcularTotalSolicitud();
    });

    row._updateRow = updateRow;
    setTimeout(updateRow, 0);
    return row;
  }

  function addLinea(data = {}) {
    const row = createLinea(data);
    el.solicitudLineas.appendChild(row);
  }

  function recalcularTotalSolicitud() {
    let total = 0;
    el.solicitudLineas.querySelectorAll('.linea-param').forEach(row => {
      const select = row.querySelector('.linea-parametro');
      const cantidad = Math.max(1, Number(row.querySelector('.linea-cantidad')?.value || 1));
      const valor = Number(select?.selectedOptions?.[0]?.dataset?.valor || 0);
      total += valor * cantidad;
    });
    if (el.solicitudTotal) el.solicitudTotal.textContent = formatCLP(total);
  }

  function buildSolicitudBody() {
    const lineas = [];
    el.solicitudLineas.querySelectorAll('.linea-param').forEach(row => {
      const select = row.querySelector('.linea-parametro');
      const cantidad = Math.max(1, Number(row.querySelector('.linea-cantidad')?.value || 1));
      const parametroId = Number(select?.value || 0);
      if (parametroId > 0) {
        lineas.push({
          parametro_id: parametroId,
          cantidad_muestras: cantidad,
        });
      }
    });

    return {
      numero_solicitud: normalizeText(el.numeroSolicitud?.value || ''),
      fecha_ingreso: normalizeText(el.fechaIngreso?.value || ''),
      vendedor_codigo: normalizeCode(el.vendedorCodigo?.value || ''),
      vendedor_nombre: normalizeText(el.vendedorNombre?.value || ''),
      numero_muestras: Math.max(1, Number(el.numeroMuestras?.value || 1) || 1),
      estado: normalizeEstado(el.estadoSolicitud?.value || 'INGRESADA'),
      observacion: normalizeText(el.observacion?.value || ''),
      parametros: lineas,
    };
  }

  function resetSolicitudForm() {
    state.editandoSolicitudId = null;
    if (el.solicitudId) el.solicitudId.value = '';
    if (el.numeroSolicitud) el.numeroSolicitud.value = state.config?.siguiente_numero_solicitud || '';
    if (el.fechaIngreso) el.fechaIngreso.value = new Date().toISOString().slice(0, 10);
    if (el.estadoSolicitud) el.estadoSolicitud.value = 'INGRESADA';
    if (el.vendedorCodigo) el.vendedorCodigo.value = state.config?.vendedores?.[0]?.cod_vendedor || '';
    if (el.vendedorNombre) el.vendedorNombre.value = '';
    if (el.numeroMuestras) el.numeroMuestras.value = '1';
    if (el.observacion) el.observacion.value = '';
    if (el.solicitudLineas) el.solicitudLineas.innerHTML = '';
    addLinea({ parametro_id: state.parametros[0]?.id || '', cantidad_muestras: 1 });
    recalcularTotalSolicitud();
    if (el.btnGuardarSolicitud) el.btnGuardarSolicitud.textContent = 'Guardar solicitud';
  }

  function renderResumen(data) {
    const periodo = data?.periodo?.etiqueta || `${MESES[state.filtros.mes - 1] || 'Mes'} ${state.filtros.anio}`;
    if (el.resumenPeriodo) el.resumenPeriodo.textContent = periodo;
    if (el.solicitudesSubtitulo) {
      el.solicitudesSubtitulo.textContent = `${data?.totales?.total_solicitudes || 0} solicitudes activas en ${periodo}`;
    }
    if (el.kpiSolicitudes) el.kpiSolicitudes.textContent = formatNumber(data?.totales?.total_solicitudes || 0);
    if (el.kpiMuestras) el.kpiMuestras.textContent = formatNumber(data?.totales?.total_muestras || 0);
    if (el.kpiMonto) el.kpiMonto.textContent = formatCLP(data?.totales?.total_monto || 0);
    if (el.kpiParametros) el.kpiParametros.textContent = formatNumber(data?.totales?.parametros_distintos || 0);

    const vendedores = Array.isArray(data?.por_vendedor) ? data.por_vendedor : [];
    const parametros = Array.isArray(data?.por_parametro) ? data.por_parametro : [];

    if (el.tbodyResumenVendedores) {
      el.tbodyResumenVendedores.innerHTML = vendedores.length
        ? vendedores.map(row => `
          <tr>
            <td>${escapeHtml(row.vendedor_codigo || '-')}<br><span class="muted">${escapeHtml(row.vendedor_nombre || '')}</span></td>
            <td>${formatNumber(row.solicitudes || 0)}</td>
            <td>${formatNumber(row.muestras || 0)}</td>
            <td>${formatCLP(row.total || 0)}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="table-empty">Sin datos</td></tr>';
    }

    if (el.tbodyResumenParametros) {
      el.tbodyResumenParametros.innerHTML = parametros.length
        ? parametros.map(row => `
          <tr>
            <td>${escapeHtml(row.parametro_nombre || '-')}</td>
            <td>${formatNumber(row.solicitudes || 0)}</td>
            <td>${formatNumber(row.muestras || 0)}</td>
            <td>${formatCLP(row.total || 0)}</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="table-empty">Sin datos</td></tr>';
    }
  }

  function renderSolicitudes(rows) {
    if (!el.tbodySolicitudes) return;
    if (!rows.length) {
      el.tbodySolicitudes.innerHTML = '<tr><td colspan="9" class="table-empty">Sin solicitudes para el periodo seleccionado</td></tr>';
      return;
    }

    el.tbodySolicitudes.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.numero_solicitud || '-')}</strong></td>
        <td>${escapeHtml(row.fecha_formato || row.fecha_ingreso || '-')}</td>
        <td>${escapeHtml(row.vendedor_nombre || '-')}</td>
        <td>${escapeHtml(row.vendedor_codigo || '-')}</td>
        <td>${formatNumber(row.numero_muestras || 0)}</td>
        <td>${formatCLP(row.total || 0)}</td>
        <td><span class="${estadoClass(row.estado)}">${escapeHtml(row.estado || '-')}</span></td>
        <td>${escapeHtml(row.parametros_texto || '-')}${row.parametros_count ? ` <span class="muted">(${row.parametros_count})</span>` : ''}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="action-btn action-btn--primary" data-action="ver" data-id="${row.id}">Ver</button>
            <button type="button" class="action-btn" data-action="editar" data-id="${row.id}">Editar</button>
            <button type="button" class="action-btn action-btn--danger" data-action="anular" data-id="${row.id}">Anular</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderParametros(rows) {
    if (!el.tbodyParametros) return;
    if (!rows.length) {
      el.tbodyParametros.innerHTML = '<tr><td colspan="5" class="table-empty">Sin parametros</td></tr>';
      return;
    }

    el.tbodyParametros.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.nombre || '-')}</td>
        <td>${formatCLP(row.valor_ensayo || 0)}</td>
        <td>${formatNumber(row.total_usos || 0)}</td>
        <td><span class="${row.activo ? 'estado-pill estado-pill--finalizada' : 'estado-pill estado-pill--anulada'}">${row.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <div class="row-actions">
            <button type="button" class="action-btn action-btn--primary" data-param-action="editar" data-id="${row.id}">Editar</button>
            <button type="button" class="action-btn" data-param-action="${row.activo ? 'desactivar' : 'activar'}" data-id="${row.id}">${row.activo ? 'Desactivar' : 'Activar'}</button>
            <button type="button" class="action-btn action-btn--danger" data-param-action="eliminar" data-id="${row.id}">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderAudit(rows) {
    if (!el.auditList) return;
    if (!rows.length) {
      el.auditList.innerHTML = '<div class="table-empty">Sin auditoria</div>';
      return;
    }
    el.auditList.innerHTML = rows.map(row => `
      <div class="audit-item">
        <strong>${escapeHtml(row.accion || '-')} - ${escapeHtml(row.entidad || '-')}</strong>
        <div class="audit-meta">${escapeHtml(row.usuario_nombre || '-')} | ${escapeHtml(row.fecha_formato || row.creado_en || '-')}</div>
        <div class="audit-meta">${escapeHtml(row.detalle || '')}</div>
      </div>
    `).join('');
  }

  async function loadConfig() {
    const payload = await fetchJson(`/config?mes=${state.filtros.mes}&anio=${state.filtros.anio}`);
    state.config = payload.data || null;
    state.parametros = Array.isArray(state.config?.parametros) ? state.config.parametros : [];
    fillVendorSelects(state.config?.vendedores || []);
    if (el.folioSiguiente) el.folioSiguiente.textContent = state.config?.siguiente_numero_solicitud || '-';
    if (el.panelParametros) {
      el.panelParametros.hidden = !state.config?.puede_administrar;
    }
    if (el.numeroSolicitud) el.numeroSolicitud.value = state.config?.siguiente_numero_solicitud || '';
    if (el.vendedorCodigo && !el.vendedorCodigo.value) {
      el.vendedorCodigo.value = state.config?.vendedores?.[0]?.cod_vendedor || '';
    }
    if (el.parametroId) el.parametroId.value = '';
    if (el.parametroNombre) el.parametroNombre.value = '';
    if (el.parametroValor) el.parametroValor.value = '';
    if (el.parametroActivo) el.parametroActivo.checked = true;
    resetSolicitudForm();
  }

  async function loadResumen() {
    const payload = await fetchJson(`/resumen?mes=${state.filtros.mes}&anio=${state.filtros.anio}`);
    state.resumen = payload;
    renderResumen(payload);
  }

  async function loadSolicitudes() {
    const params = new URLSearchParams({
      mes: String(state.filtros.mes),
      anio: String(state.filtros.anio),
    });
    if (state.filtros.vendedor) params.set('cod_vendedor', state.filtros.vendedor);
    if (state.filtros.estado && state.filtros.estado !== 'todos') params.set('estado', state.filtros.estado);
    if (state.filtros.search) params.set('search', state.filtros.search);
    const payload = await fetchJson(`/solicitudes?${params.toString()}`);
    state.solicitudes = Array.isArray(payload.data) ? payload.data : [];
    renderSolicitudes(state.solicitudes);
  }

  async function loadParametros() {
    const payload = await fetchJson(`/parametros?mes=${state.filtros.mes}&anio=${state.filtros.anio}`);
    state.parametros = Array.isArray(payload.data) ? payload.data : [];
    renderParametros(state.parametros);
    refreshLineaParamSelects();
  }

  async function loadAuditoria() {
    const payload = await fetchJson('/auditoria?limit=12');
    state.auditoria = Array.isArray(payload.data) ? payload.data : [];
    renderAudit(state.auditoria);
  }

  function refreshLineaParamSelects() {
    el.solicitudLineas?.querySelectorAll('.linea-param').forEach(row => {
      const select = row.querySelector('.linea-parametro');
      const current = select?.value || '';
      fillParamSelect(select, current);
      if (current) select.value = current;
      row._updateRow?.();
    });
  }

  async function reloadData() {
    setLoadingState(true);
    try {
      await Promise.all([
        loadConfig(),
        loadResumen(),
        loadSolicitudes(),
        loadParametros(),
        loadAuditoria(),
      ]);
      setBanner(`Periodo ${MESES[state.filtros.mes - 1] || 'Mes'} ${state.filtros.anio} cargado correctamente.`, 'success');
    } catch (error) {
      setBanner(error?.message || 'No se pudo cargar la informacion del laboratorio.', 'error');
    } finally {
      setLoadingState(false);
    }
  }

  async function saveSolicitud(event) {
    event.preventDefault();
    const body = buildSolicitudBody();
    if (!body.vendedor_codigo) {
      setBanner('Debes seleccionar un codigo de vendedor.', 'error');
      return;
    }
    if (!body.parametros.length) {
      setBanner('Debes agregar al menos un parametro.', 'error');
      return;
    }

    const id = state.editandoSolicitudId;
    const method = id ? 'PUT' : 'POST';
    const path = id ? `/solicitudes/${id}` : '/solicitudes';

    setLoadingState(true);
    try {
      await fetchJson(path, {
        method,
        body: JSON.stringify(body),
      });
      setBanner(id ? 'Solicitud actualizada correctamente.' : 'Solicitud registrada correctamente.', 'success');
      await reloadData();
      resetSolicitudForm();
    } catch (error) {
      setBanner(error?.message || 'No se pudo guardar la solicitud.', 'error');
    } finally {
      setLoadingState(false);
    }
  }

  async function editSolicitud(id) {
    setLoadingState(true);
    try {
      const payload = await fetchJson(`/solicitudes/${id}`);
      const solicitud = payload.data || null;
      if (!solicitud) throw new Error('Solicitud no encontrada.');

      state.editandoSolicitudId = solicitud.id;
      if (el.solicitudId) el.solicitudId.value = String(solicitud.id);
      if (el.numeroSolicitud) el.numeroSolicitud.value = solicitud.numero_solicitud || '';
      if (el.fechaIngreso) el.fechaIngreso.value = solicitud.fecha_ingreso || new Date().toISOString().slice(0, 10);
      if (el.estadoSolicitud) el.estadoSolicitud.value = normalizeEstado(solicitud.estado) || 'INGRESADA';
      if (el.vendedorCodigo) el.vendedorCodigo.value = solicitud.vendedor_codigo || '';
      if (el.vendedorNombre) el.vendedorNombre.value = solicitud.vendedor_nombre || '';
      if (el.numeroMuestras) el.numeroMuestras.value = String(solicitud.numero_muestras || 1);
      if (el.observacion) el.observacion.value = solicitud.observacion || '';
      if (el.solicitudLineas) el.solicitudLineas.innerHTML = '';
      const lineas = Array.isArray(solicitud.parametros) && solicitud.parametros.length ? solicitud.parametros : [];
      lineas.forEach(linea => addLinea(linea));
      if (!lineas.length) addLinea();
      recalcularTotalSolicitud();
      if (el.btnGuardarSolicitud) el.btnGuardarSolicitud.textContent = 'Actualizar solicitud';
      setBanner(`Solicitud ${solicitud.numero_solicitud} cargada para edicion.`, 'info');
    } catch (error) {
      setBanner(error?.message || 'No se pudo cargar la solicitud.', 'error');
    } finally {
      setLoadingState(false);
    }
  }

  async function verSolicitud(id) {
    try {
      const payload = await fetchJson(`/solicitudes/${id}`);
      const solicitud = payload.data || null;
      if (!solicitud) throw new Error('Solicitud no encontrada.');
      const detalle = [
        `Folio: ${solicitud.numero_solicitud}`,
        `Fecha: ${solicitud.fecha_formato || solicitud.fecha_ingreso || '-'}`,
        `Vendedor: ${solicitud.vendedor_nombre || '-'}`,
        `Codigo: ${solicitud.vendedor_codigo || '-'}`,
        `Muestras: ${solicitud.numero_muestras || 0}`,
        `Total: ${formatCLP(solicitud.total || 0)}`,
        `Estado: ${solicitud.estado || '-'}`,
        '',
        'Parametros:',
        ...(Array.isArray(solicitud.parametros)
          ? solicitud.parametros.map(item => `- ${item.parametro_nombre}: ${formatCLP(item.subtotal || 0)}`)
          : []),
      ].join('\n');
      window.alert(detalle);
    } catch (error) {
      setBanner(error?.message || 'No se pudo abrir la solicitud.', 'error');
    }
  }

  async function anularSolicitud(id) {
    if (!window.confirm('Deseas anular esta solicitud?')) return;
    try {
      await fetchJson(`/solicitudes/${id}/anular`, {
        method: 'PATCH',
        body: JSON.stringify({ motivo: 'Anulada desde la interfaz de laboratorio' }),
      });
      setBanner('Solicitud anulada correctamente.', 'success');
      await reloadData();
    } catch (error) {
      setBanner(error?.message || 'No se pudo anular la solicitud.', 'error');
    }
  }

  async function saveParametro(event) {
    event.preventDefault();
    const body = {
      nombre: normalizeText(el.parametroNombre?.value || ''),
      valor_ensayo: Number(el.parametroValor?.value || 0),
      activo: Boolean(el.parametroActivo?.checked),
    };
    if (!body.nombre) {
      setBanner('El nombre del parametro es obligatorio.', 'error');
      return;
    }
    const id = state.editandoParametroId;
    const method = id ? 'PUT' : 'POST';
    const path = id ? `/parametros/${id}` : '/parametros';

    setLoadingState(true);
    try {
      await fetchJson(path, {
        method,
        body: JSON.stringify(body),
      });
      setBanner(id ? 'Parametro actualizado correctamente.' : 'Parametro creado correctamente.', 'success');
      state.editandoParametroId = null;
      resetParametroForm();
      await reloadData();
    } catch (error) {
      setBanner(error?.message || 'No se pudo guardar el parametro.', 'error');
    } finally {
      setLoadingState(false);
    }
  }

  function resetParametroForm() {
    state.editandoParametroId = null;
    if (el.parametroId) el.parametroId.value = '';
    if (el.parametroNombre) el.parametroNombre.value = '';
    if (el.parametroValor) el.parametroValor.value = '';
    if (el.parametroActivo) el.parametroActivo.checked = true;
    if (el.btnNuevoParametro) el.btnNuevoParametro.textContent = 'Nuevo parametro';
  }

  async function editParametro(id) {
    try {
      const payload = await fetchJson('/parametros?mes=' + state.filtros.mes + '&anio=' + state.filtros.anio + '&activo=1');
      const parametro = (payload.data || []).find(item => String(item.id) === String(id));
      if (!parametro) throw new Error('Parametro no encontrado.');
      state.editandoParametroId = parametro.id;
      if (el.parametroId) el.parametroId.value = String(parametro.id);
      if (el.parametroNombre) el.parametroNombre.value = parametro.nombre || '';
      if (el.parametroValor) el.parametroValor.value = String(parametro.valor_ensayo || 0);
      if (el.parametroActivo) el.parametroActivo.checked = Boolean(parametro.activo);
      if (el.btnNuevoParametro) el.btnNuevoParametro.textContent = 'Editando parametro';
      setBanner(`Parametro ${parametro.nombre} listo para editar.`, 'info');
    } catch (error) {
      setBanner(error?.message || 'No se pudo cargar el parametro.', 'error');
    }
  }

  async function toggleParametro(id, activar) {
    if (!window.confirm(activar ? 'Activar este parametro?' : 'Desactivar este parametro?')) return;
    try {
      await fetchJson(`/parametros/${id}/${activar ? 'activar' : 'desactivar'}`, {
        method: 'PATCH',
      });
      setBanner(activar ? 'Parametro activado.' : 'Parametro desactivado.', 'success');
      await reloadData();
    } catch (error) {
      setBanner(error?.message || 'No se pudo cambiar el estado del parametro.', 'error');
    }
  }

  async function deleteParametro(id) {
    if (!window.confirm('Eliminar este parametro?')) return;
    try {
      await fetchJson(`/parametros/${id}`, { method: 'DELETE' });
      setBanner('Parametro eliminado.', 'success');
      await reloadData();
    } catch (error) {
      setBanner(error?.message || 'No se pudo eliminar el parametro.', 'error');
    }
  }

  function exportCsv() {
    const encabezados = ['Folio', 'Fecha', 'Vendedor', 'Codigo', 'Muestras', 'Total', 'Estado', 'Parametros'];
    const filas = state.solicitudes.map(row => [
      row.numero_solicitud || '',
      row.fecha_formato || row.fecha_ingreso || '',
      row.vendedor_nombre || '',
      row.vendedor_codigo || '',
      row.numero_muestras || 0,
      row.total || 0,
      row.estado || '',
      row.parametros_texto || '',
    ]);
    const csv = [encabezados, ...filas]
      .map(fila => fila.map(valor => `"${String(valor).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laboratorio_${state.filtros.anio}_${String(state.filtros.mes).padStart(2, '0')}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    el.btnLogout?.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('usuario');
      sessionStorage.removeItem('texpro_user');
      window.location.href = LOGIN_PATH;
    });

    el.sidebarToggle?.addEventListener('click', () => {
      el.sidebar?.classList.toggle('sidebar--collapsed');
      el.mainWrapper?.classList.toggle('main-wrapper--expanded');
    });

    el.headerMenuBtn?.addEventListener('click', () => {
      el.sidebar?.classList.toggle('sidebar--mobile-open');
    });

    el.btnActualizar?.addEventListener('click', async () => {
      state.filtros.mes = Number(el.filtroMes?.value || state.filtros.mes);
      state.filtros.anio = Number(el.filtroAnio?.value || state.filtros.anio);
      state.filtros.vendedor = normalizeCode(el.filtroVendedor?.value || '');
      state.filtros.estado = normalizeText(el.filtroEstado?.value || 'todos');
      state.filtros.search = normalizeText(el.busquedaSolicitudes?.value || '');
      await reloadData();
    });

    el.filtroMes?.addEventListener('change', () => {
      state.filtros.mes = Number(el.filtroMes.value || state.filtros.mes);
    });

    el.filtroAnio?.addEventListener('change', () => {
      state.filtros.anio = Number(el.filtroAnio.value || state.filtros.anio);
    });

    el.filtroVendedor?.addEventListener('change', () => {
      state.filtros.vendedor = normalizeCode(el.filtroVendedor?.value || '');
    });

    el.filtroEstado?.addEventListener('change', () => {
      state.filtros.estado = normalizeText(el.filtroEstado.value || 'todos');
      reloadData();
    });

    el.busquedaSolicitudes?.addEventListener('input', () => {
      state.filtros.search = normalizeText(el.busquedaSolicitudes.value || '');
    });

    el.btnExportarCsv?.addEventListener('click', exportCsv);
    el.btnAgregarLinea?.addEventListener('click', () => addLinea());
    el.btnLimpiarSolicitud?.addEventListener('click', resetSolicitudForm);
    el.formSolicitud?.addEventListener('submit', saveSolicitud);
    el.formParametro?.addEventListener('submit', saveParametro);
    el.btnNuevoParametro?.addEventListener('click', resetParametroForm);
    el.solicitudLineas?.addEventListener('input', recalcularTotalSolicitud);

    el.tbodySolicitudes?.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const id = button.dataset.id;
      const action = button.dataset.action;
      if (action === 'ver') verSolicitud(id);
      if (action === 'editar') editSolicitud(id);
      if (action === 'anular') anularSolicitud(id);
    });

    el.tbodyParametros?.addEventListener('click', event => {
      const button = event.target.closest('button[data-param-action]');
      if (!button) return;
      const id = button.dataset.id;
      const action = button.dataset.paramAction;
      if (action === 'editar') editParametro(id);
      if (action === 'activar') toggleParametro(id, true);
      if (action === 'desactivar') toggleParametro(id, false);
      if (action === 'eliminar') deleteParametro(id);
    });
  }

  async function boot() {
    initMonthsYears();
    bindEvents();
    const sessionOk = await ensureSession();
    if (!sessionOk) return;
    setUserHeader();
    syncFilterControls();
    resetSolicitudForm();
    await reloadData();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
