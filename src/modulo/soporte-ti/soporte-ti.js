'use strict';

(function () {
  const API = '/api/soporte-ti';
  const LOGIN_PATH = '/src/modulo/varios/login/index.html';
  const NO_ACCESS_PATH = '/src/modulo/varios/sin-acceso/index.html';
  const TOKEN = () => localStorage.getItem('token');
  const PAGE = document.body?.dataset?.view || 'dashboard';

  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  const state = {
    user: null,
    config: null,
    dashboard: null,
    equipos: [],
    actividades: [],
    mantenciones: [],
    productos: [],
    movimientos: [],
    equipoActual: null,
    actividadActual: null,
    responsables: [],
    mantencionActual: null,
    productoActual: null,
    filtros: {
      equipo: { search: '', estado: '', area: '', tipo: '', usuario: '', cumplimiento: '' },
      actividad: { search: '', estado: '', prioridad: '' },
      mantencion: { search: '' },
      producto: { search: '' },
    },
  };

  let credentialRevealBuffer = '';
  let actividadSeleccionadaId = null;
  let mantencionSeleccionadaId = null;

  function el(id) {
    return document.getElementById(id);
  }

  function text(value, fallback = '—') {
    const out = value === null || value === undefined || value === '' ? fallback : String(value);
    return out;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('es-CL').format(Number(value || 0));
  }

  function formatCLP(value) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) return '—';
    const raw = String(value).slice(0, 10);
    const [year, month, day] = raw.split('-');
    if (!year || !month || !day) return raw;
    return `${day}-${month}-${year}`;
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const raw = String(value).replace(' ', 'T');
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return String(value).slice(0, 16);
    }
    return date.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function toDateInput(value) {
    return value ? String(value).slice(0, 10) : '';
  }

  function toDateTimeLocal(value) {
    if (!value) return '';
    const raw = String(value).replace(' ', 'T');
    return raw.slice(0, 16);
  }

  function toDatetimeLocal(value) {
    return toDateTimeLocal(value);
  }

  function toNullableId(value) {
    const text = normalizeText(value);
    return text ? Number(text) : null;
  }

  function boolValue(value) {
    if (value === null || value === undefined || value === '') return '';
    const textValue = normalizeText(value).toLowerCase();
    if (['1', 'true', 'si', 'sí', 'yes', 'y', 'ok'].includes(textValue)) return '1';
    if (['0', 'false', 'no', 'n'].includes(textValue)) return '0';
    return textValue === '1' ? '1' : '0';
  }

  function boolLabel(value) {
    if (value === null || value === undefined || value === '') return '—';
    return Number(value) === 1 ? 'Sí' : 'No';
  }

  function standardBadgeClass(value) {
    const key = normalizeText(value).toUpperCase();
    if (key === 'CUMPLE') return 'badge badge--ok';
    if (key === 'NO CUMPLE') return 'badge badge--bad';
    if (key === 'SIN INFORMACIÓN') return 'badge badge--gray';
    return 'badge badge--gray';
  }

  function activityBadgeClass(value) {
    const key = normalizeText(value).toUpperCase();
    if (key === 'FINALIZADA') return 'badge badge--ok';
    if (key === 'CANCELADA') return 'badge badge--bad';
    if (key === 'EN_PROCESO') return 'badge badge--warn';
    if (key === 'EN_ESPERA') return 'badge badge--gray';
    return 'badge badge--info';
  }

  function stockBadgeClass(value) {
    const key = normalizeText(value).toUpperCase();
    if (key === 'BAJO STOCK') return 'badge badge--bad';
    return 'badge badge--ok';
  }

  function mantencionBadgeClass(value) {
    const key = normalizeText(value).toUpperCase();
    if (!key || key === '—') return 'mantencion-chip mantencion-chip--gray';
    if (key === 'COMPLETADO' || key === 'REALIZADO' || key === 'FINALIZADO') return 'mantencion-chip mantencion-chip--ok';
    if (key === 'PENDIENTE' || key === 'EN PROCESO' || key === 'EN_ESPERA') return 'mantencion-chip mantencion-chip--warn';
    if (key === 'CON OBSERVACIONES') return 'mantencion-chip mantencion-chip--info';
    return 'mantencion-chip mantencion-chip--gray';
  }

  function mantencionBoolBadgeClass(value) {
    if (value === null || value === undefined || value === '') return 'mantencion-chip mantencion-chip--gray';
    return Number(value) === 1 ? 'mantencion-chip mantencion-chip--ok' : 'mantencion-chip mantencion-chip--bad';
  }

  function renderMantencionBool(value) {
    if (value === null || value === undefined || value === '') {
      return '<span class="mantencion-chip mantencion-chip--gray">—</span>';
    }

    return `<span class="${mantencionBoolBadgeClass(value)}">${Number(value) === 1 ? 'Sí' : 'No'}</span>`;
  }

  function renderMantencionEstado(value) {
    const textValue = normalizeText(value);
    if (!textValue || textValue === '—') {
      return '<span class="mantencion-chip mantencion-chip--gray">—</span>';
    }

    return `<span class="${mantencionBadgeClass(textValue)}">${escapeHtml(textValue)}</span>`;
  }

  function renderMantencionObservaciones(value) {
    const textValue = normalizeText(value);
    if (!textValue) {
      return '<span class="muted">—</span>';
    }

    return `<span class="mantencion-text" title="${escapeHtml(textValue)}">${escapeHtml(textValue)}</span>`;
  }

  function statusBanner(message, tipo = 'info') {
    const banner = el('soporteTiStatus');
    if (!banner) return;
    banner.hidden = !message;
    banner.dataset.tipo = tipo;
    banner.textContent = message || '';
  }

  function credentialModalNodes() {
    return {
      overlay: el('credencialModalOverlay'),
      tipo: el('credencialModalTipo'),
      usuario: el('credencialModalUsuario'),
      secreto: el('credencialModalSecreto'),
      descripcion: el('credencialModalDescripcion'),
      estado: el('credencialModalState'),
      toggle: el('credencialModalToggle'),
      title: el('credencialModalTitle'),
      subtitle: el('credencialModalSubtitle'),
    };
  }

  function resetCredentialModal() {
    const nodes = credentialModalNodes();
    credentialRevealBuffer = '';
    if (nodes.tipo) nodes.tipo.value = '';
    if (nodes.usuario) nodes.usuario.value = '';
    if (nodes.secreto) {
      nodes.secreto.type = 'password';
      nodes.secreto.value = '';
    }
    if (nodes.descripcion) nodes.descripcion.value = '';
    if (nodes.estado) nodes.estado.textContent = 'La credencial solo se carga al solicitarla.';
    if (nodes.toggle) nodes.toggle.textContent = 'Mostrar';
  }

  function openCredentialModal(data) {
    const nodes = credentialModalNodes();
    credentialRevealBuffer = normalizeText(data?.valor || '');
    if (!credentialRevealBuffer) {
      resetCredentialModal();
      return;
    }

    if (nodes.tipo) nodes.tipo.value = normalizeText(data?.tipo || '') || 'LOCAL';
    if (nodes.usuario) nodes.usuario.value = normalizeText(data?.usuario || '') || '—';
    if (nodes.secreto) {
      nodes.secreto.type = 'password';
      nodes.secreto.value = credentialRevealBuffer;
    }
    if (nodes.descripcion) nodes.descripcion.value = normalizeText(data?.descripcion || '') || '—';
    if (nodes.estado) {
      const updatedAt = normalizeText(data?.updated_at || '');
      nodes.estado.textContent = updatedAt ? `Última actualización: ${formatDateTime(updatedAt)}` : 'Credencial cargada correctamente.';
    }
    if (nodes.toggle) nodes.toggle.textContent = 'Mostrar';
    if (nodes.overlay) {
      nodes.overlay.hidden = false;
      nodes.overlay.classList.add('is-visible');
    }
  }

  function closeCredentialModal() {
    const nodes = credentialModalNodes();
    if (nodes.overlay) {
      nodes.overlay.classList.remove('is-visible');
      nodes.overlay.hidden = true;
    }
    resetCredentialModal();
  }

  function toggleCredentialModalSecret() {
    const nodes = credentialModalNodes();
    if (!nodes.secreto || !credentialRevealBuffer) return;
    const revealing = nodes.secreto.type === 'password';
    nodes.secreto.type = revealing ? 'text' : 'password';
    nodes.secreto.value = credentialRevealBuffer;
    if (nodes.toggle) nodes.toggle.textContent = revealing ? 'Ocultar' : 'Mostrar';
  }

  function setLoading(disabled) {
    ['btnActualizarDashboard', 'btnActualizarEquipos', 'btnActualizarActividades', 'btnActualizarMantenciones', 'btnActualizarBodega', 'btnGuardarEquipo', 'btnGuardarActividad', 'btnGuardarMantencion', 'btnGuardarProducto', 'btnRegistrarMovimiento', 'btnAgregarComentario', 'btnCambiarEstado'].forEach(id => {
      const node = el(id);
      if (node) node.disabled = disabled;
    });
  }

  function setHeaderUser() {
    if (!state.user) return;
    const nombre = normalizeText(state.user.nombre || state.user.email || 'Usuario');
    const iniciales = nombre
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0] || '')
      .join('')
      .toUpperCase();
    const avatar = el('userAvatar');
    const nombreEl = el('userName');
    const areaEl = el('userArea');
    const dateEl = el('headerDate');
    if (avatar) avatar.textContent = iniciales || 'T';
    if (nombreEl) nombreEl.textContent = nombre;
    if (areaEl) areaEl.textContent = normalizeText(state.user.area || '');
    if (dateEl) {
      dateEl.textContent = new Date().toLocaleDateString('es-CL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }
  }

  function setBadge(id, value) {
    const node = el(id);
    if (!node) return;
    node.textContent = value;
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

  function hasAccess(user) {
    if (!user) return false;
    if (user.is_admin === true || user.is_admin === 1 || user.is_admin === '1') return true;
    if (normalizeText(user.area).toLowerCase() === 'soporte-ti') return true;
    const perfiles = Array.isArray(user.perfiles) ? user.perfiles : [];
    if (perfiles.some(perfil => normalizeText(perfil?.codigo).toLowerCase() === 'soporte-ti')) return true;
    const menus = Array.isArray(user.menus) ? user.menus : [];
    return menus.some(menu => ['soporte_ti_dashboard', 'soporte_ti_equipos', 'soporte_ti_actividades', 'soporte_ti_mantenciones', 'soporte_ti_bodega'].includes(normalizeText(menu?.codigo)));
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
        const params = new URLSearchParams({ modulo: 'Soporte TI', from: window.location.pathname });
        window.location.href = `${NO_ACCESS_PATH}?${params.toString()}`;
        return false;
      }
      return true;
    } catch {
      window.location.href = LOGIN_PATH;
      return false;
    }
  }

  function scrollEquipoFormIntoView() {
    const form = el('formEquipo');
    if (form && typeof form.scrollIntoView === 'function') {
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function resetFormEquipo(shouldScroll = false) {
    closeCredentialModal();
    ['equipoId', 'equipoCodigo', 'equipoTipo', 'equipoArea', 'equipoUsuario', 'equipoRol', 'equipoIp', 'equipoFechaAlta', 'equipoFechaBaja', 'equipoLicencias', 'equipoAccesosIp', 'equipoObservaciones', 'hwCpuGen', 'hwCpuDesc', 'hwRam', 'hwRamGen', 'hwTipoFisico', 'hwDiscoP', 'hwDiscoS', 'hwEstadoDisco', 'hwPlaca', 'hwRed', 'hwWifi', 'hwSO', 'hwLicencia', 'secTipoCuenta', 'secAntivirus', 'secAntivirusActivo', 'secFirewall', 'secUltimaSO', 'secEstado', 'secObservaciones', 'credDescripcion', 'credSecreto'].forEach(id => {
      const node = el(id);
      if (node) node.value = '';
    });
    const estado = el('equipoEstado');
    if (estado) estado.value = 'ACTIVO';
    const badge = el('badgeEquipoEdicion');
    if (badge) badge.textContent = 'Nuevo';
    state.equipoActual = null;
    if (shouldScroll) scrollEquipoFormIntoView();
  }

  function resetFormActividad() {
    ['actividadId', 'actividadNumero', 'actividadTitulo', 'actividadDescripcion', 'actividadSolicitante', 'actividadArea', 'actividadTipo', 'actividadPrioridad', 'actividadEstado', 'actividadFechaSolicitud', 'actividadFechaObjetivo', 'actividadFechaInicio', 'actividadFechaCierre', 'actividadResponsable', 'actividadEquipo', 'actividadObservaciones', 'actividadNuevoComentario'].forEach(id => {
      const node = el(id);
      if (node) node.value = '';
    });
    const prioridad = el('actividadPrioridad');
    const estado = el('actividadEstado');
    if (prioridad) prioridad.value = 'MEDIA';
    if (estado) estado.value = 'PENDIENTE';
    const badge = el('badgeActividadEdicion');
    if (badge) badge.textContent = 'Nueva';
    const comments = el('actividadComentariosLista');
    if (comments) comments.innerHTML = '';
    state.actividadActual = null;
    actividadSeleccionadaId = null;
  }

  function resetFormMantencion() {
    ['mantencionId', 'mantencionEquipo', 'mantencionTipo', 'mantencionMotivo', 'mantencionFechaInicio', 'mantencionFechaMantencion', 'mantencionTecnico', 'mantencionResultado', 'mantencionDescripcion', 'mantencionObs'].forEach(id => {
      const node = el(id);
      if (node) node.value = '';
    });
    const resultado = el('mantencionResultado');
    if (resultado) resultado.value = 'PENDIENTE';
    ['mantencionSo', 'mantencionDrivers', 'mantencionDisco'].forEach(id => {
      const node = el(id);
      if (node) node.value = '';
    });
    const badge = el('badgeMantencionEdicion');
    if (badge) badge.textContent = 'Nueva';
    state.mantencionActual = null;
    mantencionSeleccionadaId = null;
  }

  function resetFormProducto() {
    ['productoId', 'productoCodigo', 'productoCategoria', 'productoDescripcion', 'productoStockInicial', 'productoStockMinimo', 'productoUbicacion'].forEach(id => {
      const node = el(id);
      if (node) node.value = '';
    });
    const stockInicial = el('productoStockInicial');
    if (stockInicial) stockInicial.readOnly = false;
    const activo = el('productoActivo');
    if (activo) activo.value = '1';
    const badge = el('badgeProductoEdicion');
    if (badge) badge.textContent = 'Nuevo';
    state.productoActual = null;
  }

  function renderDashboardKpis(data) {
    const kpis = data?.kpis || {};
    setText('kpiEquiposActivos', kpis.equipos_activos ?? 0);
    setText('kpiEquiposBaja', kpis.equipos_baja ?? 0);
    setText('kpiEquiposCumplen', kpis.equipos_cumplen ?? 0);
    setText('kpiEquiposFuera', kpis.equipos_fuera ?? 0);
    setText('kpiEquiposSinInfo', kpis.equipos_sin_info ?? 0);
    setText('kpiSolicitudesPendientes', kpis.solicitudes_pendientes ?? 0);
    setText('kpiSolicitudesProceso', kpis.solicitudes_proceso ?? 0);
    setText('kpiSolicitudesVencidas', kpis.solicitudes_vencidas ?? 0);
    setText('kpiSolicitudesFinalizadas', kpis.solicitudes_finalizadas_mes ?? 0);
    setText('kpiMantencionesMes', kpis.mantenciones_mes ?? 0);
    setText('kpiProductosBajoStock', kpis.productos_bajo_stock ?? 0);
    setText('dashboardFechaActualizacion', new Date().toLocaleString('es-CL'));
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = String(value ?? '—');
  }

  function renderDashboardTables(data) {
    const equipos = Array.isArray(data?.equipos_fuera_estandar) ? data.equipos_fuera_estandar : [];
    const actividades = Array.isArray(data?.actividades_recientes) ? data.actividades_recientes : [];
    const mantenciones = Array.isArray(data?.mantenciones_recientes) ? data.mantenciones_recientes : [];
    const productos = Array.isArray(data?.productos_bajo_stock_lista) ? data.productos_bajo_stock_lista : [];

    const tbodyEquipos = el('tbodyEquiposFuera');
    if (tbodyEquipos) {
      tbodyEquipos.innerHTML = equipos.length ? equipos.map(item => `
        <tr>
          <td><strong>${escapeHtml(item.codigo_equipo)}</strong></td>
          <td>${escapeHtml(item.usuario_asignado || '—')}</td>
          <td>${escapeHtml(item.hardware?.descripcion_procesador || '—')}</td>
          <td>${escapeHtml(item.hardware?.ram_gb ?? '—')} GB</td>
          <td><span class="${standardBadgeClass(item.estado_estandar)}">${escapeHtml(item.estado_estandar)}</span></td>
        </tr>`).join('') : '<tr><td colspan="5" class="table-empty">No hay equipos fuera de estándar</td></tr>';
    }
    setBadge('badgeFueraEstandar', `${equipos.length.toLocaleString('es-CL')} registros`);

    const tbodyActividades = el('tbodyActividadesRecientes');
    if (tbodyActividades) {
      tbodyActividades.innerHTML = actividades.length ? activitiesToRows(actividades) : '<tr><td colspan="5" class="table-empty">Sin solicitudes recientes</td></tr>';
    }
    setBadge('badgeActividadesRecientes', `${actividades.length.toLocaleString('es-CL')} registros`);

    const tbodyMant = el('tbodyMantencionesRecientes');
    if (tbodyMant) {
      tbodyMant.innerHTML = mantenciones.length ? mantenciones.map(item => `
        <tr>
          <td><strong>${escapeHtml(item.codigo_equipo || '—')}</strong></td>
          <td>${escapeHtml(item.tipo_mantencion || '—')}</td>
          <td>${escapeHtml(formatDate(item.fecha_mantencion || item.fecha_inicio || ''))}</td>
          <td>${escapeHtml(item.tecnico_responsable || '—')}</td>
          <td>${escapeHtml(item.resultado || '—')}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="table-empty">Sin mantenciones recientes</td></tr>';
    }
    setBadge('badgeMantencionesRecientes', `${mantenciones.length.toLocaleString('es-CL')} registros`);

    const tbodyProd = el('tbodyProductosBajoStock');
    if (tbodyProd) {
      tbodyProd.innerHTML = productos.length ? productos.map(item => `
        <tr>
          <td><strong>${escapeHtml(item.codigo_producto || '—')}</strong></td>
          <td>${escapeHtml(item.categoria || '—')}</td>
          <td>${formatNumber(item.stock_actual ?? 0)}</td>
          <td>${formatNumber(item.stock_minimo ?? 0)}</td>
          <td><span class="${stockBadgeClass(item.estado_stock)}">${escapeHtml(item.estado_stock)}</span></td>
        </tr>`).join('') : '<tr><td colspan="5" class="table-empty">Sin productos bajo stock</td></tr>';
    }
    setBadge('badgeProductosBajoStock', `${productos.length.toLocaleString('es-CL')} registros`);
  }

  function activitiesToRows(items) {
    return items.map(item => {
      const vencida = item.vencida ? '<span class="badge badge--bad">VENCIDA</span>' : '';
      return `
        <tr>
          <td><strong>${escapeHtml(item.numero || '—')}</strong></td>
          <td>${escapeHtml(item.titulo || '—')}</td>
          <td><span class="${activityBadgeClass(item.estado)}">${escapeHtml(item.estado || '—')}</span>${vencida}</td>
          <td>${escapeHtml(item.prioridad || '—')}</td>
          <td>${escapeHtml(item.responsable_nombre || '—')}</td>
        </tr>`;
    }).join('');
  }

  function populateEquipoSelects(items = []) {
    const options = ['<option value="">Seleccione...</option>']
      .concat(items.map(item => `<option value="${escapeHtml(item.codigo_equipo)}">${escapeHtml(`${item.codigo_equipo} - ${item.usuario_asignado || ''}`.trim())}</option>`));
    ['mantencionEquipo', 'actividadEquipo'].forEach(id => {
      const node = el(id);
      if (node) node.innerHTML = options.join('');
    });
  }

  function populateMovimientoEquipoSelect(items = []) {
    const node = el('movEquipo');
    if (!node) return;
    const options = ['<option value="">Seleccione...</option>']
      .concat(items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(`${item.codigo_equipo} - ${item.usuario_asignado || item.area || ''}`.trim())}</option>`));
    node.innerHTML = options.join('');
  }

  function populateActividadEquipoSelect(items = []) {
    const node = el('actividadEquipo');
    if (!node) return;
    const options = ['<option value="">Seleccione...</option>']
      .concat(items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(`${item.codigo_equipo} - ${item.usuario_asignado || ''}`.trim())}</option>`));
    node.innerHTML = options.join('');
  }

  function populateActividadSelect(items = []) {
    const options = ['<option value="">Seleccione...</option>']
      .concat(items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(`${item.numero} - ${item.titulo}`)}</option>`));
    const node = el('movActividad');
    if (node) node.innerHTML = options.join('');
  }

  function populateResponsableSelect(items = []) {
    const node = el('actividadResponsable');
    if (!node) return;
    const options = ['<option value="">Seleccione...</option>']
      .concat(items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(`${item.nombre}${item.area ? ` - ${item.area}` : ''}`.trim())}</option>`));
    node.innerHTML = options.join('');
  }

  function populateProductoSelect(items = []) {
    const options = ['<option value="">Seleccione...</option>']
      .concat(items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(`${item.codigo_producto} - ${item.descripcion}`)}</option>`));
    const node = el('movProducto');
    if (node) node.innerHTML = options.join('');
  }

  function populateEntregadoASelect(items = []) {
    const node = el('movEntregadoA');
    if (!node) return;
    const options = ['<option value="">Seleccione...</option>']
      .concat(items.map(item => {
        const nombre = normalizeText(item.nombre || '');
        const area = normalizeText(item.area || '');
        const label = area ? `${nombre} - ${area}` : nombre;
        return `<option value="${escapeHtml(item.id)}">${escapeHtml(label)}</option>`;
      }));
    node.innerHTML = options.join('');
  }

  async function loadDashboard() {
    statusBanner('Cargando dashboard TI...', 'info');
    try {
      const payload = await fetchJson('/dashboard');
      state.dashboard = payload;
      state.config = payload.configuracion || null;
      renderDashboardKpis(payload);
      renderDashboardTables(payload);
      statusBanner('');
    } catch (error) {
      statusBanner(error.message || 'No se pudo cargar el dashboard TI', 'error');
    }
  }

  async function loadEquipos() {
    statusBanner('Cargando equipos...', 'info');
    try {
      const qs = new URLSearchParams({
        search: normalizeText(el('busquedaEquipo')?.value || ''),
        estado: normalizeText(el('filtroEstadoEquipo')?.value || ''),
        area: normalizeText(el('filtroAreaEquipo')?.value || ''),
        tipo: normalizeText(el('filtroTipoEquipo')?.value || ''),
        usuario: normalizeText(el('filtroUsuarioEquipo')?.value || ''),
        cumplimiento: normalizeText(el('filtroCumplimientoEquipo')?.value || ''),
      });
      state.filtros.equipo = {
        search: qs.get('search') || '',
        estado: qs.get('estado') || '',
        area: qs.get('area') || '',
        tipo: qs.get('tipo') || '',
        usuario: qs.get('usuario') || '',
        cumplimiento: qs.get('cumplimiento') || '',
      };
      const payload = await fetchJson(`/equipos?${qs.toString()}`);
      state.equipos = Array.isArray(payload.equipos) ? payload.equipos : [];
      state.config = payload.configuracion || state.config;
      renderEquipos();
      populateEquipoSelects(state.equipos);
      populateActividadEquipoSelect(state.equipos);
      populateMovimientoEquipoSelect(state.equipos);
      statusBanner('');
    } catch (error) {
      statusBanner(error.message || 'No se pudieron cargar los equipos', 'error');
    }
  }

  async function loadResponsables() {
    try {
      const payload = await fetchJson('/responsables');
      state.responsables = Array.isArray(payload.responsables) ? payload.responsables : [];
      populateResponsableSelect(state.responsables);
      populateEntregadoASelect(state.responsables);
    } catch (error) {
      statusBanner(error.message || 'No se pudieron cargar los responsables', 'error');
    }
  }

  function renderEquipos() {
    const tbody = el('tbodyEquipos');
    if (!tbody) return;
    const rows = state.equipos || [];
    tbody.innerHTML = rows.length ? rows.map(item => `
      <tr data-id="${item.id}">
        <td><strong>${escapeHtml(item.codigo_equipo || '—')}</strong></td>
        <td>${escapeHtml(item.tipo_equipo || '—')}</td>
        <td>${escapeHtml(item.area || '—')}</td>
        <td>${escapeHtml(item.usuario_asignado || '—')}</td>
        <td>${escapeHtml(item.ip_actual || '—')}</td>
        <td><span class="${activityBadgeClass(item.estado === 'BAJA' ? 'CANCELADA' : item.estado === 'MANTENCION' ? 'EN_ESPERA' : item.estado === 'REVISAR' ? 'EN_PROCESO' : 'PENDIENTE')}">${escapeHtml(item.estado || '—')}</span></td>
        <td><span class="${standardBadgeClass(item.estado_estandar)}">${escapeHtml(item.estado_estandar || '—')}</span></td>
        <td><div class="row-actions"><button type="button" class="btn-link" data-action="editar" data-id="${item.id}">Editar</button><button type="button" class="btn-secondary" data-action="ver" data-id="${item.id}">Ver</button></div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="table-empty">Sin equipos</td></tr>';
    setBadge('badgeEquipos', `${rows.length.toLocaleString('es-CL')} registros`);
  }

  function fillEquipoForm(equipo, shouldScroll = true) {
    if (!equipo) {
      resetFormEquipo(shouldScroll);
      return;
    }
    closeCredentialModal();
    state.equipoActual = equipo;
    const set = (id, value) => { const node = el(id); if (node) node.value = value ?? ''; };
    set('equipoId', equipo.id);
    set('equipoCodigo', equipo.codigo_equipo);
    set('equipoTipo', equipo.tipo_equipo);
    set('equipoArea', equipo.area);
    set('equipoUsuario', equipo.usuario_asignado);
    set('equipoRol', equipo.rol_equipo);
    set('equipoIp', equipo.ip_actual);
    set('equipoEstado', equipo.estado || 'ACTIVO');
    set('equipoFechaAlta', toDateInput(equipo.fecha_alta));
    set('equipoFechaBaja', toDateInput(equipo.fecha_baja));
    set('equipoLicencias', equipo.licencias);
    set('equipoAccesosIp', equipo.accesos_ip);
    set('equipoObservaciones', equipo.observaciones);
    set('hwCpuGen', equipo.hardware?.generacion_procesador || '');
    set('hwCpuDesc', equipo.hardware?.descripcion_procesador || '');
    set('hwRam', equipo.hardware?.ram_gb ?? '');
    set('hwRamGen', equipo.hardware?.generacion_ram || '');
    set('hwTipoFisico', equipo.hardware?.tipo_equipo_fisico || '');
    set('hwDiscoP', equipo.hardware?.almacenamiento_principal || '');
    set('hwDiscoS', equipo.hardware?.almacenamiento_secundario || '');
    set('hwEstadoDisco', equipo.hardware?.estado_disco || '');
    set('hwPlaca', equipo.hardware?.placa_madre || '');
    set('hwRed', equipo.hardware?.red || '');
    set('hwWifi', equipo.hardware?.wifi || '');
    set('hwSO', equipo.hardware?.sistema_operativo || '');
    set('hwLicencia', equipo.hardware?.licencia || '');
    set('secTipoCuenta', equipo.seguridad?.tipo_cuenta || '');
    set('secAntivirus', equipo.seguridad?.antivirus || '');
    set('secAntivirusActivo', boolValue(equipo.seguridad?.antivirus_activo));
    set('secFirewall', boolValue(equipo.seguridad?.firewall));
    set('secUltimaSO', toDateInput(equipo.seguridad?.ultima_actualizacion_so));
    set('secEstado', equipo.seguridad?.estado_seguridad || '');
    set('secObservaciones', equipo.seguridad?.observaciones || '');
    set('credDescripcion', equipo.credencial?.descripcion || '');
    set('credSecreto', '');
    const badge = el('badgeEquipoEdicion');
    if (badge) badge.textContent = equipo.codigo_equipo || 'Edición';
    if (shouldScroll) scrollEquipoFormIntoView();
  }

  async function loadEquipoDetalle(id) {
    const payload = await fetchJson(`/equipos/${id}`);
    fillEquipoForm(payload.equipo, true);
  }

  async function saveEquipo(ev) {
    ev.preventDefault();
    const id = normalizeText(el('equipoId')?.value || '');
    const equipo = {
      codigo_equipo: normalizeText(el('equipoCodigo')?.value || ''),
      tipo_equipo: normalizeText(el('equipoTipo')?.value || ''),
      area: normalizeText(el('equipoArea')?.value || ''),
      usuario_asignado: normalizeText(el('equipoUsuario')?.value || ''),
      rol_equipo: normalizeText(el('equipoRol')?.value || ''),
      ip_actual: normalizeText(el('equipoIp')?.value || ''),
      estado: normalizeText(el('equipoEstado')?.value || 'ACTIVO'),
      fecha_alta: normalizeText(el('equipoFechaAlta')?.value || ''),
      fecha_baja: normalizeText(el('equipoFechaBaja')?.value || ''),
      licencias: normalizeText(el('equipoLicencias')?.value || ''),
      accesos_ip: normalizeText(el('equipoAccesosIp')?.value || ''),
      observaciones: normalizeText(el('equipoObservaciones')?.value || ''),
    };
    const hardware = {
      generacion_procesador: normalizeText(el('hwCpuGen')?.value || ''),
      descripcion_procesador: normalizeText(el('hwCpuDesc')?.value || ''),
      ram_gb: normalizeText(el('hwRam')?.value || ''),
      generacion_ram: normalizeText(el('hwRamGen')?.value || ''),
      tipo_equipo_fisico: normalizeText(el('hwTipoFisico')?.value || ''),
      almacenamiento_principal: normalizeText(el('hwDiscoP')?.value || ''),
      almacenamiento_secundario: normalizeText(el('hwDiscoS')?.value || ''),
      estado_disco: normalizeText(el('hwEstadoDisco')?.value || ''),
      placa_madre: normalizeText(el('hwPlaca')?.value || ''),
      red: normalizeText(el('hwRed')?.value || ''),
      wifi: normalizeText(el('hwWifi')?.value || ''),
      sistema_operativo: normalizeText(el('hwSO')?.value || ''),
      licencia: normalizeText(el('hwLicencia')?.value || ''),
    };
    const seguridad = {
      tipo_cuenta: normalizeText(el('secTipoCuenta')?.value || ''),
      antivirus: normalizeText(el('secAntivirus')?.value || ''),
      antivirus_activo: normalizeText(el('secAntivirusActivo')?.value || ''),
      firewall: normalizeText(el('secFirewall')?.value || ''),
      ultima_actualizacion_so: normalizeText(el('secUltimaSO')?.value || ''),
      estado_seguridad: normalizeText(el('secEstado')?.value || ''),
      observaciones: normalizeText(el('secObservaciones')?.value || ''),
    };
    const credSecreto = normalizeText(el('credSecreto')?.value || '');
    const credDescripcion = normalizeText(el('credDescripcion')?.value || '');
    const payload = { equipo, hardware, seguridad };
    if (credSecreto) {
      payload.credencial = { secreto: credSecreto, descripcion: credDescripcion };
    } else if (credDescripcion) {
      payload.credencial = { descripcion: credDescripcion };
    }
    try {
      setLoading(true);
      const response = await fetchJson(id ? `/equipos/${id}` : '/equipos', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      fillEquipoForm(response.equipo, false);
      await loadEquipos();
      statusBanner(id ? 'Equipo actualizado correctamente' : 'Equipo creado correctamente', 'success');
    } catch (error) {
      statusBanner(error.message || 'No se pudo guardar el equipo', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function revealCredential() {
    const equipoId = normalizeText(el('equipoId')?.value || '');
    if (!equipoId) {
      statusBanner('Selecciona un equipo antes de ver la credencial', 'error');
      return;
    }
    try {
      const payload = await fetchJson(`/equipos/${equipoId}/credencial`);
      if (payload.exists && payload.valor) {
        openCredentialModal(payload);
        statusBanner('Credencial cargada correctamente', 'success');
      } else {
        closeCredentialModal();
        statusBanner('El equipo no tiene credencial registrada', 'info');
      }
    } catch (error) {
      statusBanner(error.message || 'No se pudo obtener la credencial', 'error');
    }
  }

  async function loadActividades() {
    statusBanner('Cargando actividades...', 'info');
    try {
      const qs = new URLSearchParams({
        search: normalizeText(el('busquedaActividad')?.value || ''),
        estado: normalizeText(el('filtroEstadoActividad')?.value || ''),
        prioridad: normalizeText(el('filtroPrioridadActividad')?.value || ''),
      });
      const payload = await fetchJson(`/actividades?${qs.toString()}`);
      state.actividades = Array.isArray(payload.actividades) ? payload.actividades : [];
      renderActividades();
      populateActividadSelect(state.actividades);
      statusBanner('');
    } catch (error) {
      statusBanner(error.message || 'No se pudieron cargar las actividades', 'error');
    }
  }

  function renderActividades() {
    const tbody = el('tbodyActividades');
    if (!tbody) return;
    const rows = state.actividades || [];
    tbody.innerHTML = rows.length ? rows.map(item => `
      <tr data-id="${item.id}">
        <td><strong>${escapeHtml(item.numero || '—')}</strong></td>
        <td>${escapeHtml(item.titulo || '—')}</td>
        <td><span class="${activityBadgeClass(item.estado)}">${escapeHtml(item.estado || '—')}</span>${item.vencida ? '<span class="badge badge--bad">VENCIDA</span>' : ''}</td>
        <td>${escapeHtml(item.prioridad || '—')}</td>
        <td>${escapeHtml(item.equipo_codigo || '—')}</td>
        <td>${escapeHtml(item.responsable_nombre || '—')}</td>
        <td>${item.fecha_objetivo ? formatDateTime(item.fecha_objetivo) : '—'}</td>
        <td><div class="row-actions"><button type="button" class="btn-link" data-action="ver" data-id="${item.id}">Ver</button></div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="table-empty">Sin actividades</td></tr>';
    setBadge('badgeActividades', `${rows.length.toLocaleString('es-CL')} registros`);
  }

  function cargarActividadEnFormulario(actividad) {
    if (!actividad) {
      resetFormActividad();
      return;
    }
    state.actividadActual = actividad;
    actividadSeleccionadaId = Number(actividad.id) || null;
    const set = (id, value) => { const node = el(id); if (node) node.value = value ?? ''; };
    set('actividadId', actividad.id);
    set('actividadNumero', actividad.numero);
    set('actividadTitulo', actividad.titulo);
    set('actividadDescripcion', actividad.descripcion);
    set('actividadSolicitante', actividad.solicitante);
    set('actividadArea', actividad.area);
    set('actividadTipo', actividad.tipo);
    set('actividadPrioridad', actividad.prioridad || 'MEDIA');
    set('actividadEstado', actividad.estado || 'PENDIENTE');
    set('actividadFechaSolicitud', toDatetimeLocal(actividad.fecha_solicitud));
    set('actividadFechaObjetivo', toDatetimeLocal(actividad.fecha_objetivo));
    set('actividadFechaInicio', toDatetimeLocal(actividad.fecha_inicio));
    set('actividadFechaCierre', toDatetimeLocal(actividad.fecha_cierre));
    set('actividadResponsable', actividad.responsable_usuario_id ?? '');
    set('actividadEquipo', actividad.equipo_id ?? '');
    set('actividadObservaciones', '');
    const badge = el('badgeActividadEdicion');
    if (badge) badge.textContent = actividad.numero ? `Editando ${actividad.numero}` : 'Edición';
  }

  const fillActividadForm = cargarActividadEnFormulario;

  function renderActividadComentarios(data) {
    const container = el('actividadComentariosLista');
    if (!container) return;
    const comentarios = Array.isArray(data?.comentarios) ? data.comentarios : [];
    const historial = Array.isArray(data?.historial) ? data.historial : [];
    const sections = [];
    sections.push('<div class="form-section"><h4 class="form-section-title">Comentarios</h4>');
    if (comentarios.length) {
      sections.push(comentarios.map(item => `
        <div class="comment-item">
          <strong>${escapeHtml(item.usuario_nombre || 'Usuario')}</strong>
          <div>${escapeHtml(item.comentario || '')}</div>
          <small>${escapeHtml(formatDateTime(item.created_at))}</small>
        </div>`).join(''));
    } else {
      sections.push('<div class="comment-item muted">Sin comentarios</div>');
    }
    sections.push('</div><div class="form-section"><h4 class="form-section-title">Historial</h4>');
    if (historial.length) {
      sections.push(historial.map(item => `
        <div class="comment-item">
          <strong>${escapeHtml(item.accion || 'Evento')}</strong>
          <div>${escapeHtml(item.detalle || '')}</div>
          <small>${escapeHtml(item.usuario_nombre || 'Sistema')} · ${escapeHtml(formatDateTime(item.created_at))}</small>
        </div>`).join(''));
    } else {
      sections.push('<div class="comment-item muted">Sin historial</div>');
    }
    sections.push('</div>');
    container.innerHTML = sections.join('');
  }

  async function loadActividadDetalle(id) {
    try {
      const payload = await fetchJson(`/actividades/${id}`);
      cargarActividadEnFormulario(payload.actividad);
      renderActividadComentarios(payload);
      statusBanner('');
    } catch (error) {
      statusBanner(error.message || 'No se pudo cargar la actividad', 'error');
      throw error;
    }
  }

  async function saveActividad(ev) {
    ev.preventDefault();
    const id = actividadSeleccionadaId || normalizeText(el('actividadId')?.value || '');
    const observaciones = normalizeText(el('actividadObservaciones')?.value || '');
    const payload = {
      actividad: {
        titulo: normalizeText(el('actividadTitulo')?.value || ''),
        descripcion: normalizeText(el('actividadDescripcion')?.value || ''),
        solicitante: normalizeText(el('actividadSolicitante')?.value || ''),
        area: normalizeText(el('actividadArea')?.value || ''),
        tipo: normalizeText(el('actividadTipo')?.value || ''),
        prioridad: normalizeText(el('actividadPrioridad')?.value || ''),
        estado: normalizeText(el('actividadEstado')?.value || ''),
        fecha_solicitud: normalizeText(el('actividadFechaSolicitud')?.value || '') || null,
        fecha_objetivo: normalizeText(el('actividadFechaObjetivo')?.value || '') || null,
        fecha_inicio: normalizeText(el('actividadFechaInicio')?.value || '') || null,
        fecha_cierre: normalizeText(el('actividadFechaCierre')?.value || '') || null,
        responsable_usuario_id: toNullableId(el('actividadResponsable')?.value || ''),
        equipo_id: toNullableId(el('actividadEquipo')?.value || ''),
      }
    };
    try {
      setLoading(true);
      let response = await fetchJson(id ? `/actividades/${id}` : '/actividades', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      actividadSeleccionadaId = Number(response?.actividad?.id) || actividadSeleccionadaId;
      if (observaciones) {
        try {
          response = await fetchJson(`/actividades/${response.actividad.id}/comentarios`, {
            method: 'POST',
            body: JSON.stringify({ comentario: observaciones }),
          });
          const obsField = el('actividadObservaciones');
          if (obsField) obsField.value = '';
        } catch (commentError) {
          statusBanner(commentError.message || 'La actividad se guardó, pero no se pudo registrar la observación', 'error');
        }
      }
      cargarActividadEnFormulario(response.actividad);
      renderActividadComentarios(response);
      await loadActividades();
      statusBanner(id ? 'Actividad actualizada correctamente' : 'Actividad creada correctamente', 'success');
    } catch (error) {
      statusBanner(error.message || 'No se pudo guardar la actividad', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function addActividadComentario() {
    const id = normalizeText(el('actividadId')?.value || '');
    const comentario = normalizeText(el('actividadNuevoComentario')?.value || '');
    if (!id) {
      statusBanner('Selecciona una actividad antes de comentar', 'error');
      return;
    }
    if (!comentario) {
      statusBanner('Escribe un comentario', 'error');
      return;
    }
    try {
      const payload = await fetchJson(`/actividades/${id}/comentarios`, {
        method: 'POST',
        body: JSON.stringify({ comentario }),
      });
      cargarActividadEnFormulario(payload.actividad);
      renderActividadComentarios(payload);
      const field = el('actividadNuevoComentario');
      if (field) field.value = '';
      await loadActividades();
      statusBanner('Comentario agregado', 'success');
    } catch (error) {
      statusBanner(error.message || 'No se pudo agregar el comentario', 'error');
    }
  }

  async function changeActividadEstado() {
    const id = normalizeText(el('actividadId')?.value || '');
    if (!id) {
      statusBanner('Selecciona una actividad', 'error');
      return;
    }
    try {
      const payload = await fetchJson(`/actividades/${id}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({
          estado: normalizeText(el('actividadEstado')?.value || ''),
          fecha_inicio: normalizeText(el('actividadFechaInicio')?.value || ''),
          fecha_cierre: normalizeText(el('actividadFechaCierre')?.value || ''),
        }),
      });
      cargarActividadEnFormulario(payload.actividad);
      renderActividadComentarios(payload);
      await loadActividades();
      statusBanner('Estado actualizado', 'success');
    } catch (error) {
      statusBanner(error.message || 'No se pudo actualizar el estado', 'error');
    }
  }

  async function loadMantenciones() {
    statusBanner('Cargando mantenciones...', 'info');
    try {
      const payload = await fetchJson('/mantenciones');
      state.mantenciones = Array.isArray(payload.mantenciones) ? payload.mantenciones : [];
      renderMantenciones();
      statusBanner('');
    } catch (error) {
      statusBanner(error.message || 'No se pudieron cargar las mantenciones', 'error');
    }
  }

  function renderMantenciones() {
    const tbody = el('tbodyMantenciones');
    if (!tbody) return;
    const rows = state.mantenciones || [];
    tbody.innerHTML = rows.length ? rows.map(item => `
      <tr data-id="${item.id}">
        <td>
          <div class="mantencion-equipo">
            <strong class="mantencion-equipo__codigo">${escapeHtml(item.codigo_equipo || '�')}</strong>
            <span class="mantencion-equipo__tipo">${escapeHtml(item.tipo_equipo || '�')}</span>
          </div>
        </td>
        <td>${escapeHtml(item.tipo_mantencion || '�')}</td>
        <td>${escapeHtml(item.motivo || '�')}</td>
        <td>${escapeHtml(formatDate(item.fecha_inicio || ''))}</td>
        <td>${escapeHtml(formatDate(item.fecha_mantencion || ''))}</td>
        <td>${escapeHtml(item.tecnico_responsable || '�')}</td>
        <td>${renderMantencionEstado(item.resultado)}</td>
        <td>${renderMantencionBool(item.mantencion)}</td>
        <td>${renderMantencionBool(item.so_reinstalado)}</td>
        <td>${renderMantencionBool(item.drivers_ok)}</td>
        <td>${renderMantencionBool(item.disco_revisado)}</td>
        <td>${renderMantencionObservaciones(item.observaciones)}</td>
        <td><div class="row-actions"><button type="button" class="btn-link" data-action="editar" data-id="${item.id}">Editar</button></div></td>
      </tr>`).join('') : '<tr><td colspan="13" class="table-empty">Sin mantenciones</td></tr>';
    setBadge('badgeMantenciones', `${rows.length.toLocaleString('es-CL')} registros`);
  }

  function fillMantencionForm(mantencion) {
    if (!mantencion) {
      resetFormMantencion();
      return;
    }
    state.mantencionActual = mantencion;
    mantencionSeleccionadaId = mantencion.id ? Number(mantencion.id) : null;
    const set = (id, value) => { const node = el(id); if (node) node.value = value ?? ''; };
    set('mantencionId', mantencion.id);
    set('mantencionEquipo', mantencion.codigo_equipo || '');
    set('mantencionTipo', mantencion.tipo_mantencion || '');
    set('mantencionMotivo', mantencion.motivo || '');
    set('mantencionFechaInicio', toDateInput(mantencion.fecha_inicio));
    set('mantencionFechaMantencion', toDateInput(mantencion.fecha_mantencion));
    set('mantencionTecnico', mantencion.tecnico_responsable || '');
    set('mantencionResultado', mantencion.resultado || 'PENDIENTE');
    set('mantencionDescripcion', boolValue(mantencion.mantencion));
    set('mantencionObs', mantencion.observaciones || '');
    set('mantencionSo', boolValue(mantencion.so_reinstalado));
    set('mantencionDrivers', boolValue(mantencion.drivers_ok));
    set('mantencionDisco', boolValue(mantencion.disco_revisado));
    const badge = el('badgeMantencionEdicion');
    if (badge) badge.textContent = `${mantencion.codigo_equipo || 'Edición'}`;
  }

  async function loadMantencionDetalle(id) {
    const response = await fetchJson(`/mantenciones/${id}`);
    fillMantencionForm(response.mantencion);
    return response;
  }

  async function saveMantencion(ev) {
    ev.preventDefault();
    const id = mantencionSeleccionadaId ?? (Number(normalizeText(el('mantencionId')?.value || '')) || null);
    const isEdit = id !== null;
    const payload = {
      mantencion: {
        equipo_id: normalizeText(el('mantencionEquipo')?.value || ''),
        tipo_mantencion: normalizeText(el('mantencionTipo')?.value || ''),
        motivo: normalizeText(el('mantencionMotivo')?.value || ''),
        fecha_inicio: normalizeText(el('mantencionFechaInicio')?.value || ''),
        fecha_mantencion: normalizeText(el('mantencionFechaMantencion')?.value || ''),
        tecnico_responsable: normalizeText(el('mantencionTecnico')?.value || ''),
        resultado: normalizeText(el('mantencionResultado')?.value || 'PENDIENTE'),
        mantencion: normalizeText(el('mantencionDescripcion')?.value || ''),
        so_reinstalado: normalizeText(el('mantencionSo')?.value || ''),
        drivers_ok: normalizeText(el('mantencionDrivers')?.value || ''),
        disco_revisado: normalizeText(el('mantencionDisco')?.value || ''),
        observaciones: normalizeText(el('mantencionObs')?.value || ''),
      }
    };
    try {
      setLoading(true);
      const response = await fetchJson(isEdit ? `/mantenciones/${id}` : '/mantenciones', {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      const savedId = Number(response.id || response.mantencion?.id || id || 0) || null;
      if (savedId) {
        await loadMantencionDetalle(savedId);
      } else {
        fillMantencionForm(response.mantencion);
      }
      await loadMantenciones();
      statusBanner(isEdit ? 'Mantención actualizada correctamente' : 'Mantención registrada correctamente', 'success');
    } catch (error) {
      statusBanner(error.message || 'No se pudo guardar la mantención', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadBodega() {
    statusBanner('Cargando bodega...', 'info');
    try {
      const [productosPayload, movimientosPayload, equiposPayload] = await Promise.all([
        fetchJson(`/bodega/productos?search=${encodeURIComponent(normalizeText(el('busquedaProducto')?.value || ''))}`),
        fetchJson('/bodega/movimientos'),
        fetchJson('/equipos'),
      ]);
      state.productos = Array.isArray(productosPayload.productos) ? productosPayload.productos : [];
      state.movimientos = Array.isArray(movimientosPayload.movimientos) ? movimientosPayload.movimientos : [];
      state.equipos = Array.isArray(equiposPayload.equipos) ? equiposPayload.equipos : [];
      renderProductos();
      renderMovimientos();
      populateProductoSelect(state.productos);
      populateEquipoSelects(state.equipos);
      populateMovimientoEquipoSelect(state.equipos);
      await loadResponsables();
      statusBanner('');
    } catch (error) {
      statusBanner(error.message || 'No se pudo cargar la bodega TI', 'error');
    }
  }

  function renderProductos() {
    const tbody = el('tbodyProductos');
    if (!tbody) return;
    const rows = state.productos || [];
    tbody.innerHTML = rows.length ? rows.map(item => `
      <tr data-id="${item.id}">
        <td><strong>${escapeHtml(item.codigo_producto || '—')}</strong></td>
        <td>${escapeHtml(item.categoria || '—')}</td>
        <td>${escapeHtml(item.descripcion || '—')}</td>
        <td>${formatNumber(item.stock_actual ?? 0)}</td>
        <td>${formatNumber(item.stock_minimo ?? 0)}</td>
        <td>${escapeHtml(item.ubicacion || '—')}</td>
        <td><span class="${stockBadgeClass(item.estado_stock)}">${escapeHtml(item.estado_stock || '—')}</span></td>
        <td><div class="row-actions"><button type="button" class="btn-link" data-action="editar" data-id="${item.id}">Editar</button></div></td>
      </tr>`).join('') : '<tr><td colspan="8" class="table-empty">Sin productos</td></tr>';
    setBadge('badgeProductos', `${rows.length.toLocaleString('es-CL')} registros`);
  }

  function renderMovimientos() {
    const tbody = el('tbodyMovimientos');
    if (!tbody) return;
    const rows = state.movimientos || [];
    tbody.innerHTML = rows.length ? rows.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.codigo_producto || '—')}</strong></td>
        <td><span class="badge badge--info">${escapeHtml(item.tipo_movimiento || '—')}</span></td>
        <td>${formatNumber(item.cantidad ?? 0)}</td>
        <td>${escapeHtml(item.motivo || '—')}</td>
        <td>${escapeHtml(item.codigo_equipo ? `${item.codigo_equipo}${item.equipo_usuario_asignado ? ` - ${item.equipo_usuario_asignado}` : ''}` : '—')}</td>
        <td>${escapeHtml(item.entregado_usuario_nombre || item.entregado_a || '—')}</td>
        <td>${escapeHtml(formatDateTime(item.created_at))}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="table-empty">Sin movimientos</td></tr>';
    setBadge('badgeMovimientos', `${rows.length.toLocaleString('es-CL')} registros`);
  }

  function fillProductoForm(producto) {
    if (!producto) {
      resetFormProducto();
      return;
    }
    state.productoActual = producto;
    const set = (id, value) => { const node = el(id); if (node) node.value = value ?? ''; };
    set('productoId', producto.id);
    set('productoCodigo', producto.codigo_producto);
    set('productoCategoria', producto.categoria);
    set('productoDescripcion', producto.descripcion);
    set('productoStockInicial', producto.stock_inicial);
    set('productoStockMinimo', producto.stock_minimo);
    set('productoUbicacion', producto.ubicacion);
    set('productoActivo', String(producto.activo ?? 1));
    const stockInicial = el('productoStockInicial');
    if (stockInicial) stockInicial.readOnly = Boolean(producto.tiene_movimientos);
    const badge = el('badgeProductoEdicion');
    if (badge) badge.textContent = producto.codigo_producto || 'Edición';
  }

  async function saveProducto(ev) {
    ev.preventDefault();
    const id = normalizeText(el('productoId')?.value || '');
    const payload = {
      producto: {
        codigo_producto: normalizeText(el('productoCodigo')?.value || ''),
        categoria: normalizeText(el('productoCategoria')?.value || ''),
        descripcion: normalizeText(el('productoDescripcion')?.value || ''),
        stock_inicial: normalizeText(el('productoStockInicial')?.value || ''),
        stock_minimo: normalizeText(el('productoStockMinimo')?.value || ''),
        ubicacion: normalizeText(el('productoUbicacion')?.value || ''),
        activo: normalizeText(el('productoActivo')?.value || '1'),
      }
    };
    try {
      setLoading(true);
      const response = await fetchJson(id ? `/bodega/productos/${id}` : '/bodega/productos', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      fillProductoForm(response.producto);
      await loadBodega();
      statusBanner(id ? 'Producto actualizado correctamente' : 'Producto creado correctamente', 'success');
    } catch (error) {
      statusBanner(error.message || 'No se pudo guardar el producto', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function saveMovimiento(ev) {
    ev.preventDefault();
    const payload = {
      movimiento: {
        producto_id: toNullableId(el('movProducto')?.value || ''),
        tipo_movimiento: normalizeText(el('movTipo')?.value || ''),
        cantidad: Number(normalizeText(el('movCantidad')?.value || '0')),
        motivo: normalizeText(el('movMotivo')?.value || ''),
        equipo_id: toNullableId(el('movEquipo')?.value || ''),
        actividad_id: null,
        entregado_usuario_id: toNullableId(el('movEntregadoA')?.value || ''),
      }
    };
    try {
      setLoading(true);
      await fetchJson('/bodega/movimientos', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await loadBodega();
      statusBanner('Movimiento registrado correctamente', 'success');
    } catch (error) {
      statusBanner(error.message || 'No se pudo registrar el movimiento', 'error');
    } finally {
      setLoading(false);
    }
  }

  function hookRowClicks() {
    document.addEventListener('click', async event => {
      const equipoBtn = event.target.closest('[data-action="editar"][data-id], [data-action="ver"][data-id]');
      if (equipoBtn && PAGE === 'equipos') {
        const id = equipoBtn.dataset.id;
        await loadEquipoDetalle(id);
        return;
      }

      if (PAGE === 'actividades') {
        const actividadBtn = event.target.closest('[data-action="ver"][data-id], [data-action="editar"][data-id]');
        if (actividadBtn) {
          await loadActividadDetalle(actividadBtn.dataset.id);
          return;
        }
      }

      if (PAGE === 'mantenciones') {
        const mantencionBtn = event.target.closest('#tbodyMantenciones [data-action="editar"][data-id]');
        if (mantencionBtn) {
          await loadMantencionDetalle(mantencionBtn.dataset.id);
          return;
        }
      }

      if (PAGE === 'bodega') {
        const productoBtn = event.target.closest('#tbodyProductos [data-action="editar"][data-id]');
        if (productoBtn) {
          const row = state.productos.find(item => String(item.id) === String(productoBtn.dataset.id));
          fillProductoForm(row || null);
          const mov = el('movProducto');
          if (mov && row) mov.value = String(row.id);
        }
      }
    });
  }

  async function initDashboard() {
    const btn = el('btnActualizarDashboard');
    if (btn) btn.addEventListener('click', loadDashboard);
    await loadDashboard();
  }

  async function initEquipos() {
    const btn = el('btnActualizarEquipos');
    if (btn) btn.addEventListener('click', loadEquipos);
    const nuevo = el('btnNuevoEquipo');
    if (nuevo) nuevo.addEventListener('click', () => resetFormEquipo(true));
    const limpiar = el('btnLimpiarEquipo');
    if (limpiar) limpiar.addEventListener('click', () => resetFormEquipo(false));
    const form = el('formEquipo');
    if (form) form.addEventListener('submit', saveEquipo);
    const cred = el('btnCargarCredencial');
    if (cred) cred.addEventListener('click', revealCredential);
    const modalOverlay = el('credencialModalOverlay');
    const modalClose = el('credencialModalClose');
    const modalCloseBottom = el('credencialModalCloseBottom');
    const modalToggle = el('credencialModalToggle');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', event => {
        if (event.target === modalOverlay) {
          closeCredentialModal();
        }
      });
    }
    if (modalClose) modalClose.addEventListener('click', closeCredentialModal);
    if (modalCloseBottom) modalCloseBottom.addEventListener('click', closeCredentialModal);
    if (modalToggle) modalToggle.addEventListener('click', toggleCredentialModalSecret);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modalOverlay && !modalOverlay.hidden) {
        closeCredentialModal();
      }
    });
    ['busquedaEquipo', 'filtroEstadoEquipo', 'filtroAreaEquipo', 'filtroTipoEquipo', 'filtroUsuarioEquipo', 'filtroCumplimientoEquipo'].forEach(id => {
      const node = el(id);
      if (node) node.addEventListener('change', loadEquipos);
      if (node && node.tagName === 'INPUT') node.addEventListener('keyup', evt => {
        if (evt.key === 'Enter') loadEquipos();
      });
    });
    resetFormEquipo(false);
    await loadEquipos();
  }

  async function initActividades() {
    const btn = el('btnActualizarActividades');
    if (btn) btn.addEventListener('click', loadActividades);
    const nuevo = el('btnNuevaActividad');
    if (nuevo) nuevo.addEventListener('click', resetFormActividad);
    const limpiar = el('btnLimpiarActividad');
    if (limpiar) limpiar.addEventListener('click', resetFormActividad);
    const form = el('formActividad');
    if (form) form.addEventListener('submit', saveActividad);
    const comentario = el('btnAgregarComentario');
    if (comentario) comentario.addEventListener('click', addActividadComentario);
    const estado = el('btnCambiarEstado');
    if (estado) estado.addEventListener('click', changeActividadEstado);
    ['busquedaActividad', 'filtroEstadoActividad', 'filtroPrioridadActividad'].forEach(id => {
      const node = el(id);
      if (node) node.addEventListener('change', loadActividades);
      if (node && node.tagName === 'INPUT') node.addEventListener('keyup', evt => {
        if (evt.key === 'Enter') loadActividades();
      });
    });
    resetFormActividad();
    await Promise.all([loadActividades(), loadEquipos(), loadResponsables()]);
  }

  async function initMantenciones() {
    const btn = el('btnActualizarMantenciones');
    if (btn) btn.addEventListener('click', loadMantenciones);
    const nuevo = el('btnNuevaMantencion');
    if (nuevo) nuevo.addEventListener('click', resetFormMantencion);
    const limpiar = el('btnLimpiarMantencion');
    if (limpiar) limpiar.addEventListener('click', resetFormMantencion);
    const form = el('formMantencion');
    if (form) form.addEventListener('submit', saveMantencion);
    const search = el('busquedaMantencion');
    if (search) {
      search.addEventListener('keyup', evt => {
        if (evt.key === 'Enter') loadMantenciones();
      });
      search.addEventListener('change', loadMantenciones);
    }
    resetFormMantencion();
    await Promise.all([loadMantenciones(), loadEquipos()]);
  }

  async function initBodega() {
    const btn = el('btnActualizarBodega');
    if (btn) btn.addEventListener('click', loadBodega);
    const nuevo = el('btnNuevoProducto');
    if (nuevo) nuevo.addEventListener('click', resetFormProducto);
    const limpiar = el('btnLimpiarProducto');
    if (limpiar) limpiar.addEventListener('click', resetFormProducto);
    const formProducto = el('formProducto');
    if (formProducto) formProducto.addEventListener('submit', saveProducto);
    const formMovimiento = el('formMovimiento');
    if (formMovimiento) formMovimiento.addEventListener('submit', saveMovimiento);
    const search = el('busquedaProducto');
    if (search) {
      search.addEventListener('keyup', evt => {
        if (evt.key === 'Enter') loadBodega();
      });
      search.addEventListener('change', loadBodega);
    }
    resetFormProducto();
    await loadBodega();
  }

  async function init() {
    if (!(await ensureSession())) {
      return;
    }
    setHeaderUser();
    if (el('btnLogout')) {
      el('btnLogout').addEventListener('click', () => {
        localStorage.removeItem('token');
        window.location.href = LOGIN_PATH;
      });
    }
    hookRowClicks();
    try {
      setLoading(true);
      if (PAGE === 'dashboard') await initDashboard();
      else if (PAGE === 'equipos') await initEquipos();
      else if (PAGE === 'actividades') await initActividades();
      else if (PAGE === 'mantenciones') await initMantenciones();
      else if (PAGE === 'bodega') await initBodega();
    } catch (error) {
      statusBanner(error.message || 'No se pudo iniciar el módulo Soporte TI', 'error');
    } finally {
      setLoading(false);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
