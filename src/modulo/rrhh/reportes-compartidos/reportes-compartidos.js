'use strict';

(function () {
  const API = '/api/rrhh';
  const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  const state = {
    revision: null,
    reportes: [],
    detalleActual: null,
    detalleSeleccionId: null,
    inlineAction: null,
    tabActiva: 'general',
    sort: {
      general: { key: null, direction: null },
      'tipo-c': { key: null, direction: null },
      asignados: { key: null, direction: null },
      reportes: { key: null, direction: null },
      diferencias: { key: null, direction: null },
    },
    filtros: {
      anio: new Date().getFullYear(),
      mes: new Date().getMonth() + 1,
      vendedorAsignadorId: '',
      vendedorAsignadoId: '',
      estado: '',
      folio: '',
      cliente: '',
      soloDiferencias: false,
    },
    vendors: {
      asignadores: [],
      asignados: [],
    },
  };

  const $ = id => document.getElementById(id);

  function token() {
    return localStorage.getItem('token') || '';
  }

  async function apiFetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    const auth = token();
    if (auth) headers.Authorization = `Bearer ${auth}`;

    const res = await fetch(`${API}${path}`, {
      ...options,
      headers,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok || payload?.ok === false) {
      throw new Error(payload?.error || `HTTP ${res.status}`);
    }
    return payload;
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
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  function formatPercent(value) {
    const raw = Number(value || 0);
    const normalized = Math.abs(raw) <= 1 ? raw * 100 : raw;
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(normalized) + '%';
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function formatDateTime(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function estadoLabel(estado) {
    const labels = {
      confirmado_vendedor: 'Enviado a RRHH',
      validado_rrhh: 'Validado',
      rechazado_rrhh: 'Rechazado',
    };
    return labels[estado] || estado || 'Sin estado';
  }

  function estadoClass(estado) {
    const map = {
      confirmado_vendedor: 'is-pending',
      validado_rrhh: 'is-ok',
      rechazado_rrhh: 'is-danger',
    };
    return map[estado] || 'is-neutral';
  }

  function estadoComparacionLabel(row = {}) {
    if ((row.diferencias || []).length) return 'Diferencia';
    if (row.existe_softland && row.existe_asignacion && row.incluido_en_reporte) return 'OK';
    if (!row.existe_asignacion || !row.incluido_en_reporte) return 'Pendiente';
    return 'OK';
  }

  function estadoComparacionClass(row = {}) {
    if ((row.diferencias || []).length) return 'is-danger';
    if (row.existe_softland && row.existe_asignacion && row.incluido_en_reporte) return 'is-ok';
    return 'is-pending';
  }

  function comparisonSummaryText(items = []) {
    return items.length ? items.join(' · ') : 'Sin diferencias';
  }

  function isEmptySortValue(value) {
    return value == null || value === '' || value === '—';
  }

  function parseNumberForSort(value) {
    if (isEmptySortValue(value)) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'boolean') return value ? 1 : 0;

    const raw = String(value).trim();
    if (!raw) return null;

    let normalized = raw.replace(/[^\d,.-]/g, '');
    if (!normalized) return null;

    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
      if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = normalized.replace(/,/g, '');
      }
    } else if (hasComma) {
      normalized = normalized.replace(',', '.');
    } else if ((normalized.match(/\./g) || []).length > 1) {
      normalized = normalized.replace(/\./g, '');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseDateForSort(value) {
    if (isEmptySortValue(value)) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    const raw = String(value).trim();
    if (!raw) return null;

    let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/);
    if (match) {
      const [, year, month, day] = match;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    }

    match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s].*)?$/);
    if (match) {
      const [, day, month, year] = match;
      const date = new Date(Number(year), Number(month) - 1, Number(day));
      return Number.isNaN(date.getTime()) ? null : date.getTime();
    }

    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function compareSortValues(a, b) {
    const emptyA = isEmptySortValue(a);
    const emptyB = isEmptySortValue(b);
    if (emptyA && emptyB) return 0;
    if (emptyA) return 1;
    if (emptyB) return -1;

    const dateA = parseDateForSort(a);
    const dateB = parseDateForSort(b);
    if (dateA != null && dateB != null) {
      return dateA - dateB;
    }

    const numA = parseNumberForSort(a);
    const numB = parseNumberForSort(b);
    if (numA != null && numB != null) {
      return numA - numB;
    }

    return String(a).localeCompare(String(b), 'es', {
      numeric: true,
      sensitivity: 'base',
    });
  }

  const SORTABLE_TABLES = {
    general: {
      selector: '#tbodyGeneral',
      headerSelector: '.tab-panel[data-panel="general"] .data-table thead tr',
      columns: [
        { key: 'folio', label: 'Folio', getValue: row => row.folio },
        { key: 'fecha', label: 'Fecha', getValue: row => row.fecha },
        { key: 'cliente', label: 'Cliente', getValue: row => row.cliente },
        { key: 'vendedor_origen', label: 'Vendedor origen', getValue: row => row.vendedor_origen },
        { key: 'vendedor_asignado', label: 'Vendedor asignado', getValue: row => row.vendedor_asignado },
        { key: 'porcentaje_participacion', label: '%', getValue: row => row.porcentaje_participacion },
        { key: 'monto_asignado', label: 'Monto', getValue: row => row.monto_asignado },
        { key: 'cod_vendedor_softland', label: 'Código compartido', getValue: row => row.cod_vendedor_softland },
        { key: 'existe_asignacion', label: 'Asignado', getValue: row => row.existe_asignacion },
        { key: 'incluido_en_reporte', label: 'Reportado', getValue: row => row.incluido_en_reporte },
        { key: 'estado', label: 'Estado', getValue: row => estadoComparacionLabel(row) },
        { key: 'diferencias', label: 'Diferencias', getValue: row => comparisonSummaryText(row.diferencias || []) },
      ],
    },
    'tipo-c': {
      selector: '#tbodyTipoC',
      headerSelector: '.tab-panel[data-panel="tipo-c"] .data-table thead tr',
      columns: [
        { key: 'folio', label: 'Folio', getValue: row => row.folio },
        { key: 'fecha', label: 'Fecha', getValue: row => row.fecha },
        { key: 'cliente', label: 'Cliente', getValue: row => row.cliente },
        { key: 'cod_vendedor_softland', label: 'Código vendedor', getValue: row => row.cod_vendedor_softland || row.vendedor_softland },
        { key: 'vendedor_softland', label: 'Vendedor Softland', getValue: row => row.vendedor_softland || row.cod_vendedor_softland },
        { key: 'total_softland', label: 'Total venta', getValue: row => row.total_softland },
        { key: 'existe_asignacion', label: 'Estado asignación', getValue: row => row.existe_asignacion },
      ],
    },
    asignados: {
      selector: '#tbodyAsignados',
      headerSelector: '.tab-panel[data-panel="asignados"] .data-table thead tr',
      columns: [
        { key: 'folio', label: 'Folio', getValue: row => row.folio },
        { key: 'fecha', label: 'Fecha', getValue: row => row.fecha },
        { key: 'cliente', label: 'Cliente', getValue: row => row.cliente },
        { key: 'vendedor_asignador', label: 'Vendedor asignador', getValue: row => row.vendedor_asignador },
        { key: 'vendedor_asignado', label: 'Vendedor asignado', getValue: row => row.vendedor_asignado },
        { key: 'porcentaje', label: '%', getValue: row => row.porcentaje },
        { key: 'monto_asignado', label: 'Monto asignado', getValue: row => row.monto_asignado },
        { key: 'estado', label: 'Estado', getValue: row => row.existe_asignacion ? 'OK' : 'Pendiente' },
      ],
    },
    reportes: {
      selector: '#tbodyReportes',
      headerSelector: '.tab-panel[data-panel="reportes"] .data-table thead tr',
      columns: [
        { key: 'vendedor_nombre', label: 'Vendedor', getValue: row => row.vendedor_nombre },
        { key: 'periodo_label', label: 'Período', getValue: row => row.periodo_label || `${MESES[(Number(row.mes) || 1) - 1] || ''} ${row.anio || ''}`.trim() },
        { key: 'cantidad_folios', label: 'Folios', getValue: row => row.cantidad_folios },
        { key: 'total_venta', label: 'Total venta', getValue: row => row.total_venta },
        { key: 'total_comision', label: 'Comisión', getValue: row => row.total_comision },
        { key: 'estado', label: 'Estado', getValue: row => estadoLabel(row.estado) },
        { key: 'confirmado_at', label: 'Confirmado el', getValue: row => row.confirmado_at },
        { key: 'revisado_at', label: 'Revisado el', getValue: row => row.revisado_at },
      ],
    },
    diferencias: {
      selector: '#tbodyDiferencias',
      headerSelector: '.tab-panel[data-panel="diferencias"] .data-table thead tr',
      columns: [
        { key: 'folio', label: 'Folio', getValue: row => row.folio },
        { key: 'fecha', label: 'Fecha', getValue: row => row.fecha },
        { key: 'cliente', label: 'Cliente', getValue: row => row.cliente },
        { key: 'tipo_diferencia', label: 'Tipo diferencia', getValue: row => comparisonSummaryText(row.diferencias || []) },
        { key: 'estado', label: 'Estado', getValue: row => estadoComparacionLabel(row) },
        { key: 'vendedor_asignado', label: 'Vendedor asignado', getValue: row => row.vendedor_asignado },
        { key: 'monto_asignado', label: 'Monto', getValue: row => row.monto_asignado },
      ],
    },
  };

  function getSortState(tab) {
    return state.sort[tab] || { key: null, direction: null };
  }

  function getSortAria(direction) {
    if (direction === 'asc') return 'ascending';
    if (direction === 'desc') return 'descending';
    return 'none';
  }

  function getSortIcon(tab, key) {
    const sortState = getSortState(tab);
    if (sortState.key !== key || !sortState.direction) return '↕';
    return sortState.direction === 'asc' ? '↑' : '↓';
  }

  function getSortButtonLabel(tab, key, label) {
    const sortState = getSortState(tab);
    const nextDirection = sortState.key === key && sortState.direction === 'asc' ? 'desc' : 'asc';
    const directionLabel = nextDirection === 'asc' ? 'ascendente' : 'descendente';
    return `Ordenar por ${label} ${directionLabel}`;
  }

  function toggleSort(tab, key) {
    const current = getSortState(tab);
    if (current.key !== key || !current.direction) {
      state.sort[tab] = { key, direction: 'asc' };
    } else if (current.direction === 'asc') {
      state.sort[tab] = { key, direction: 'desc' };
    } else {
      state.sort[tab] = { key: null, direction: null };
    }
    renderView();
  }

  function sortRows(rows, tab) {
    const sortState = getSortState(tab);
    if (!sortState.key || !sortState.direction) return rows;

    const tableConfig = SORTABLE_TABLES[tab];
    const column = tableConfig?.columns.find(item => item.key === sortState.key);
    if (!column) return rows;

    return [...rows].sort((a, b) => {
      const result = compareSortValues(column.getValue(a), column.getValue(b));
      return sortState.direction === 'asc' ? result : -result;
    });
  }

  function renderSortableHeaders() {
    Object.entries(SORTABLE_TABLES).forEach(([tab, config]) => {
      const row = document.querySelector(config.headerSelector);
      if (!row) return;
      row.innerHTML = config.columns.map(column => {
        const sortState = getSortState(tab);
        const active = sortState.key === column.key && sortState.direction;
        return `
          <th aria-sort="${active ? getSortAria(sortState.direction) : 'none'}">
            <button
              type="button"
              class="rrhh-sort-btn${active ? ' is-active' : ''}"
              data-sort-tab="${tab}"
              data-sort-key="${column.key}"
              aria-label="${escapeHtml(getSortButtonLabel(tab, column.key, column.label))}"
            >
              <span>${escapeHtml(column.label)}</span>
              <span class="sort-icon" aria-hidden="true">${escapeHtml(getSortIcon(tab, column.key))}</span>
            </button>
          </th>
        `;
      }).join('');
    });
  }

  function bindSortEvents() {
    document.querySelectorAll('[data-sort-tab][data-sort-key]').forEach(button => {
      button.addEventListener('click', () => {
        toggleSort(button.dataset.sortTab, button.dataset.sortKey);
      });
    });
  }

  function emptyTableRow(colspan, title, text) {
    return `
      <tr>
        <td colspan="${colspan}" class="empty-state">
          <div class="empty-state__card">
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(text)}</p>
          </div>
        </td>
      </tr>
    `;
  }

  function clearDetalle() {
    state.detalleActual = null;
    state.detalleSeleccionId = null;
    closeInlineAction();
    setReportDetailModalOpen(false);
  }

  function setReportDetailModalOpen(isOpen) {
    const modal = $('rrhhReportDetailModal');
    if (modal) {
      modal.classList.toggle('is-open', isOpen);
      modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }
    document.body.classList.toggle('rrhh-modal-open', isOpen);
  }

  function renderActionBlock(detalle) {
    const actions = $('rrhhDetailActions');
    const note = $('rrhhDetailActionsNote');
    const btnValidar = $('btnValidarReporte');
    const btnRechazar = $('btnRechazarReporte');

    if (!actions || !note || !btnValidar || !btnRechazar) return;

    const esPendiente = detalle?.estado === 'confirmado_vendedor';
    const esValidado = detalle?.estado === 'validado_rrhh';
    const esRechazado = detalle?.estado === 'rechazado_rrhh';

    btnValidar.textContent = esRechazado ? 'Cambiar a validado' : 'Validar reporte';
    btnRechazar.textContent = esValidado ? 'Cambiar a rechazado' : 'Rechazar reporte';

    btnValidar.hidden = esValidado;
    btnRechazar.hidden = esRechazado;
    btnValidar.disabled = false;
    btnRechazar.disabled = false;

    if (esPendiente) {
      note.textContent = 'Desde este mismo modal puedes validar o rechazar el reporte sin abrir pantallas adicionales.';
      note.className = 'rrhh-detail-actions__note';
    } else if (esValidado) {
      note.textContent = 'Este reporte ya fue validado por RRHH. Si necesitas corregirlo, puedes cambiar su estado a rechazado desde aquí.';
      note.className = 'rrhh-detail-actions__note';
    } else if (esRechazado) {
      note.textContent = 'Este reporte fue rechazado por RRHH. Si corresponde, puedes cambiarlo a validado desde aquí.';
      note.className = 'rrhh-detail-actions__note';
    } else {
      note.textContent = '';
      note.className = 'rrhh-detail-actions__note';
    }
  }

  function getPeriodoLabel(periodo = {}) {
    if (periodo?.label) return periodo.label;
    const mes = Number(periodo?.mes || new Date().getMonth() + 1);
    const anio = Number(periodo?.anio || new Date().getFullYear());
    return `${MESES[mes - 1] || ''} ${anio}`.trim();
  }

  function readFilters() {
    state.filtros.anio = Number($('filtroAnio')?.value || state.filtros.anio || new Date().getFullYear());
    state.filtros.mes = Number($('filtroMes')?.value || state.filtros.mes || new Date().getMonth() + 1);
    state.filtros.vendedorAsignadorId = $('filtroVendedorAsignador')?.value || '';
    state.filtros.vendedorAsignadoId = $('filtroVendedorAsignado')?.value || '';
    state.filtros.estado = $('filtroEstado')?.value || '';
    state.filtros.folio = $('filtroFolio')?.value.trim() || '';
    state.filtros.cliente = $('filtroCliente')?.value.trim() || '';
    state.filtros.soloDiferencias = Boolean($('filtroSoloDiferencias')?.checked);
  }

  function buildServerQuery() {
    const query = {
      anio: state.filtros.anio,
      mes: state.filtros.mes,
    };
    if (state.filtros.vendedorAsignadorId) query.vendedor_asignador_id = state.filtros.vendedorAsignadorId;
    if (state.filtros.vendedorAsignadoId) query.vendedor_asignado_id = state.filtros.vendedorAsignadoId;
    if (state.filtros.estado) query.estado = state.filtros.estado;
    if (state.filtros.folio) query.folio = state.filtros.folio;
    return query;
  }

  function buildReportQuery() {
    const query = buildServerQuery();
    if (state.filtros.soloDiferencias) query.solo_con_diferencias = '1';
    if (state.filtros.folio) query.folio = state.filtros.folio;
    return query;
  }

  function populateYearMonth() {
    const yearSelect = $('filtroAnio');
    const monthSelect = $('filtroMes');
    const currentYear = new Date().getFullYear();

    if (yearSelect && !yearSelect.options.length) {
      for (let year = currentYear; year >= 2026; year -= 1) {
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        yearSelect.appendChild(option);
      }
    }

    if (monthSelect && !monthSelect.options.length) {
      MESES.forEach((mes, index) => {
        const option = document.createElement('option');
        option.value = String(index + 1);
        option.textContent = mes;
        monthSelect.appendChild(option);
      });
    }

    if (yearSelect) yearSelect.value = String(state.filtros.anio);
    if (monthSelect) monthSelect.value = String(state.filtros.mes);
  }

  function normalizeVendorLabel(item, fallback = '') {
    const label = String(
      item?.nombre
      || item?.label
      || item?.nombre_vendedor
      || item?.nombre_usuario
      || item?.usuario_nombre
      || item?.vendedor_nombre
      || item?.vendedor_asignador
      || item?.vendedor_asignado
      || fallback
      || ''
    ).trim();
    return label || `Usuario ${item?.id || item?.usuario_id || ''}`.trim();
  }

  function normalizeClientLabel(item, fallback = '') {
    const label = String(
      item?.cliente
      || item?.nom_aux
      || item?.NomAux
      || item?.nombre_cliente
      || item?.razon_social
      || item?.folio
      || fallback
      || ''
    ).trim();
    return label || '—';
  }

  function normalizeVendorCode(value) {
    return String(value || '').trim().toUpperCase();
  }

  function initialsFromText(value, fallback = 'RR') {
    const cleaned = String(value || '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!cleaned) return fallback;
    const parts = cleaned.split(' ').filter(Boolean);
    const initials = parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
    return initials || fallback;
  }

  function getSessionUser() {
    const candidates = [
      sessionStorage.getItem('texpro_user'),
      localStorage.getItem('user'),
      localStorage.getItem('usuario'),
    ].filter(Boolean);

    for (const raw of candidates) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // ignore malformed stored payloads
      }
    }
    return null;
  }

  function displayNameFromUser(user) {
    return String(user?.nombre || user?.email || user?.area || 'RRHH').trim();
  }

  function rebuildVendorOptions() {
    const selectAsignador = $('filtroVendedorAsignador');
    const selectAsignado = $('filtroVendedorAsignado');
    if (!selectAsignador || !selectAsignado) return;

    const asignadores = new Map();
    const asignados = new Map();
    const sharedByCode = new Map();
    const sharedCatalog = Array.isArray(state.revision?.vendedores_compartidos)
      ? state.revision.vendedores_compartidos
      : [];

    sharedCatalog.forEach(item => {
      const value = item?.usuario_id ?? item?.vendedor_usuario_id ?? item?.id_usuario ?? null;
      const label = normalizeVendorLabel(item, item?.cod_vendedor || item?.codigo_vendedor || item?.vendedor_codigo);
      const code = normalizeVendorCode(item?.cod_vendedor || item?.codigo_vendedor || item?.vendedor_codigo);
      if (code) {
        sharedByCode.set(code, { value, label });
      }
      if (value) {
        asignados.set(String(value), label);
      }
    });

    (state.revision?.folios_asignados || []).forEach(row => {
      if (row?.vendedor_asignador_id) {
        asignadores.set(String(row.vendedor_asignador_id), normalizeVendorLabel(row, row.vendedor_asignador));
      }
      if (row?.vendedor_asignado_id) {
        asignados.set(String(row.vendedor_asignado_id), normalizeVendorLabel(row, row.vendedor_asignado));
      }
      const codAsignado = normalizeVendorCode(row?.cod_vendedor_compartido || row?.cod_vendedor_asignado);
      if (!row?.vendedor_asignado_id && codAsignado && sharedByCode.has(codAsignado)) {
        const shared = sharedByCode.get(codAsignado);
        if (shared?.value) {
          asignados.set(String(shared.value), shared.label);
        }
      }
    });

    (state.revision?.reportes_confirmados || []).forEach(row => {
      if (row?.vendedor_usuario_id) {
        asignados.set(String(row.vendedor_usuario_id), normalizeVendorLabel(row, row.vendedor_nombre));
      }
    });

    const renderOptions = (select, map, currentValue) => {
      const base = '<option value="">Todos</option>';
      const items = Array.from(map.entries())
        .sort((a, b) => a[1].localeCompare(b[1], 'es'))
        .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
        .join('');
      select.innerHTML = base + items;
      if (currentValue) select.value = String(currentValue);
    };

    renderOptions(selectAsignador, asignadores, state.filtros.vendedorAsignadorId);
    renderOptions(selectAsignado, asignados, state.filtros.vendedorAsignadoId);
  }

  function matchLocalFilters(row) {
    const cliente = normalizeText(state.filtros.cliente);
    const folio = normalizeText(state.filtros.folio);
    if (!cliente && !folio) return true;
    const hayCliente = !cliente || normalizeText(row?.cliente).includes(cliente);
    const hayFolio = !folio || normalizeText(row?.folio).includes(folio);
    return hayCliente && hayFolio;
  }

  function buildViewModel() {
    const revision = state.revision || {
      comparacion: [],
      folios_softland: [],
      folios_asignados: [],
      reportes_confirmados: [],
      codigos_compartidos: [],
      resumen: {},
    };
    const resumenServidor = revision.resumen || {};

    const comparacion = (revision.comparacion || [])
      .filter(matchLocalFilters)
      .filter(row => !state.filtros.soloDiferencias || (row.diferencias || []).length > 0);

    const foliosSoftland = (revision.folios_softland || revision.folios_tipo_c || [])
      .filter(matchLocalFilters);

    const foliosAsignados = (revision.folios_asignados || [])
      .filter(matchLocalFilters);

    const reportes = (state.reportes || [])
      .filter(row => {
        const base = matchLocalFilters(row);
        return base;
      });

    const diferencias = comparacion.filter(row => (row.diferencias || []).length > 0);
    const comparacionOrdenada = sortRows(comparacion, 'general');
    const foliosSoftlandOrdenados = sortRows(foliosSoftland, 'tipo-c');
    const foliosAsignadosOrdenados = sortRows(foliosAsignados, 'asignados');
    const reportesOrdenados = sortRows(reportes, 'reportes');
    const diferenciasOrdenadas = sortRows(diferencias, 'diferencias');
    const periodo = revision.periodo || { anio: state.filtros.anio, mes: state.filtros.mes, label: getPeriodoLabel() };
    const diferenciaCount = Number(resumenServidor.diferencias_detectadas ?? diferenciasOrdenadas.length ?? 0);

    return {
      periodo,
      codigosCompartidos: Array.isArray(revision.codigos_compartidos) ? revision.codigos_compartidos : [],
      resumen: {
        folios_softland_compartidos: Number(resumenServidor.folios_softland_compartidos ?? resumenServidor.folios_softland ?? foliosSoftlandOrdenados.length ?? 0),
        folios_asignados: Number(resumenServidor.folios_asignados ?? foliosAsignadosOrdenados.length ?? 0),
        folios_reportados: Number(resumenServidor.folios_reportados ?? reportesOrdenados.length ?? 0),
        folios_faltantes_asignacion: Number(resumenServidor.folios_faltantes_asignacion ?? comparacionOrdenada.filter(row => row.existe_softland && !row.existe_asignacion).length ?? 0),
        folios_faltantes_reporte: Number(resumenServidor.folios_faltantes_reporte ?? comparacionOrdenada.filter(row => row.existe_asignacion && !row.incluido_en_reporte).length ?? 0),
        reportes_pendientes_rrhh: Number(resumenServidor.reportes_pendientes_rrhh ?? reportesOrdenados.filter(row => row.estado === 'confirmado_vendedor').length ?? 0),
        reportes_validados: Number(resumenServidor.reportes_validados ?? reportesOrdenados.filter(row => row.estado === 'validado_rrhh').length ?? 0),
        reportes_rechazados: Number(resumenServidor.reportes_rechazados ?? reportesOrdenados.filter(row => row.estado === 'rechazado_rrhh').length ?? 0),
        diferencias_detectadas: diferenciaCount,
      },
      comparacion: comparacionOrdenada,
      foliosSoftland: foliosSoftlandOrdenados,
      foliosAsignados: foliosAsignadosOrdenados,
      reportes: reportesOrdenados,
      diferencias: diferenciasOrdenadas,
      estadoRevision: diferenciaCount > 0 ? 'alerta' : 'ok',
    };
  }

  function renderSummaryCards(view) {
    const cards = [
      { label: 'Folios Softland', value: formatNumber(view.resumen.folios_softland_compartidos || 0), hint: 'Base real del período' },
      { label: 'Folios asignados', value: formatNumber(view.resumen.folios_asignados || 0), hint: 'Asignaciones registradas en MySQL' },
      { label: 'Reportes enviados', value: formatNumber(view.resumen.folios_reportados || 0), hint: 'Envíos confirmados por vendedores' },
      { label: 'Pendientes RRHH', value: formatNumber(view.resumen.reportes_pendientes_rrhh || 0), hint: 'Esperando validación' },
      { label: 'Validados', value: formatNumber(view.resumen.reportes_validados || 0), hint: 'Aprobados por RRHH' },
      { label: 'Rechazados', value: formatNumber(view.resumen.reportes_rechazados || 0), hint: 'Observados por RRHH' },
      { label: 'Diferencias', value: formatNumber(view.resumen.diferencias_detectadas || 0), hint: 'Casos con faltas o desajustes' },
    ];

    const html = cards.map(card => `
      <article class="kpi-card">
        <span class="kpi-card__label">${escapeHtml(card.label)}</span>
        <strong class="kpi-card__value">${escapeHtml(card.value)}</strong>
        <span class="kpi-card__hint">${escapeHtml(card.hint)}</span>
      </article>
    `).join('');

    const target = $('resumenCards');
    if (target) target.innerHTML = html;
  }

  function renderStatusBanner(view) {
    const banner = $('resumenEstado');
    const titulo = $('resumenEstadoTitulo');
    const texto = $('resumenEstadoTexto');
    if (!banner || !titulo || !texto) return;

    banner.classList.toggle('is-alert', view.estadoRevision === 'alerta');
    banner.classList.toggle('is-ok', view.estadoRevision === 'ok');

    if (view.estadoRevision === 'alerta') {
      titulo.textContent = `Se detectaron ${formatNumber(view.resumen.diferencias_detectadas)} diferencias que requieren revisión.`;
      texto.textContent = 'Usa los filtros o abre el detalle de un reporte para revisar los casos con observaciones.';
    } else {
      titulo.textContent = 'No se detectan diferencias para los filtros seleccionados.';
      texto.textContent = 'La comparación entre Softland, asignaciones y reportes está consistente.';
    }
  }

  function renderGeneralTable(view) {
    const tbody = $('tbodyGeneral');
    const total = $('totalComparacion');
    if (!tbody || !total) return;

    total.textContent = `${view.comparacion.length} registros`;
    if (!view.comparacion.length) {
      tbody.innerHTML = emptyTableRow(
        12,
        'No hay información para los filtros seleccionados',
        'Prueba cambiando el período, limpiando los filtros o actualizando la revisión.'
      );
      return;
    }

    tbody.innerHTML = view.comparacion.map(row => {
      const reportId = row.reporte_id ? String(row.reporte_id) : '';
      const selected = reportId && state.detalleSeleccionId === reportId;
      return `
      <tr data-report-id="${escapeHtml(reportId)}" class="${selected ? 'is-selected' : ''}">
        <td class="mono">${escapeHtml(row.folio)}</td>
        <td>${escapeHtml(formatDate(row.fecha))}</td>
        <td>${escapeHtml(normalizeClientLabel(row, row.folio))}</td>
        <td>${escapeHtml(row.vendedor_origen || row.vendedor_asignador || row.cod_vendedor_softland || '—')}</td>
        <td>${escapeHtml(row.vendedor_asignado || row.nombre_vendedor_compartido || row.cod_vendedor_compartido || '—')}</td>
        <td class="numeric">${escapeHtml(formatPercent(row.porcentaje_participacion || 0))}</td>
        <td class="numeric">${escapeHtml(formatCurrency(row.monto_asignado || 0))}</td>
        <td><span class="status-pill ${row.existe_softland ? 'is-ok' : 'is-neutral'}">${row.existe_softland ? 'OK' : 'Pendiente'}</span></td>
        <td><span class="status-pill ${row.existe_asignacion ? 'is-ok' : 'is-pending'}">${row.existe_asignacion ? 'OK' : 'Pendiente'}</span></td>
        <td><span class="status-pill ${row.incluido_en_reporte ? 'is-ok' : 'is-pending'}">${row.incluido_en_reporte ? 'Enviado' : 'Pendiente'}</span></td>
        <td><span class="status-pill ${estadoComparacionClass(row)}">${escapeHtml(estadoComparacionLabel(row))}</span></td>
        <td>${escapeHtml(comparisonSummaryText(row.diferencias || []))}</td>
      </tr>
    `; }).join('');

    tbody.onclick = event => {
      const row = event.target.closest('tr[data-report-id]');
      if (row?.dataset.reportId) {
        openDetalle(row.dataset.reportId);
      }
    };
  }

  function renderTipoCTable(view) {
    const tbody = $('tbodyTipoC');
    const total = $('totalTipoC');
    if (!tbody || !total) return;
    total.textContent = `${view.foliosSoftland.length} registros`;

    if (!view.foliosSoftland.length) {
      tbody.innerHTML = emptyTableRow(
        8,
        'No hay folios Softland para mostrar',
        'Prueba otro período o actualiza la revisión para volver a cargar la información.'
      );
      return;
    }

    tbody.innerHTML = view.foliosSoftland.map(row => `
      <tr>
        <td class="mono">${escapeHtml(row.folio)}</td>
        <td>${escapeHtml(formatDate(row.fecha))}</td>
        <td>${escapeHtml(normalizeClientLabel(row, row.folio))}</td>
        <td>${escapeHtml(row.vendedor_softland || row.cod_vendedor_softland || '—')}</td>
        <td class="numeric">${escapeHtml(formatCurrency(row.total_softland || 0))}</td>
        <td>${escapeHtml(row.cod_vendedor_softland || '—')}</td>
        <td><span class="status-pill ${row.existe_asignacion ? 'is-ok' : 'is-pending'}">${row.existe_asignacion ? 'OK' : 'Pendiente'}</span></td>
        <td><span class="status-pill ${row.incluido_en_reporte ? 'is-ok' : 'is-pending'}">${row.incluido_en_reporte ? 'Enviado' : 'Pendiente'}</span></td>
      </tr>
    `).join('');
  }

  function renderAsignadosTable(view) {
    const tbody = $('tbodyAsignados');
    const total = $('totalAsignados');
    if (!tbody || !total) return;
    total.textContent = `${view.foliosAsignados.length} registros`;

    if (!view.foliosAsignados.length) {
      tbody.innerHTML = emptyTableRow(
        9,
        'No hay folios asignados para mostrar',
        'Revisa otro filtro o actualiza la revisión para consultar la información disponible.'
      );
      return;
    }

    tbody.innerHTML = view.foliosAsignados.map(row => `
      <tr>
        <td class="mono">${escapeHtml(row.folio)}</td>
        <td>${escapeHtml(formatDate(row.fecha))}</td>
        <td>${escapeHtml(normalizeClientLabel(row, row.folio))}</td>
        <td>${escapeHtml(row.vendedor_asignador || row.cod_vendedor_principal || '—')}</td>
        <td>${escapeHtml(row.vendedor_asignado || row.nombre_vendedor_compartido || row.cod_vendedor_compartido || '—')}</td>
        <td class="numeric">${escapeHtml(formatPercent(row.porcentaje || 0))}</td>
        <td class="numeric">${escapeHtml(formatCurrency(row.monto_asignado || 0))}</td>
        <td class="mono">${escapeHtml(row.reporte_id || '—')}</td>
        <td><span class="status-pill ${row.existe_asignacion ? 'is-ok' : 'is-pending'}">${row.existe_asignacion ? 'OK' : 'Pendiente'}</span></td>
      </tr>
    `).join('');
  }

  function renderReportesTable(view) {
    const tbody = $('tbodyReportes');
    const total = $('totalReportes');
    if (!tbody || !total) return;
    total.textContent = `${view.reportes.length} registros`;

    if (!view.reportes.length) {
      tbody.innerHTML = emptyTableRow(
        9,
        'No hay reportes para los filtros seleccionados',
        'Prueba cambiando el período, limpiando los filtros o actualizando la revisión.'
      );
      return;
    }

    tbody.innerHTML = view.reportes.map(row => {
      const selected = state.detalleSeleccionId === String(row.id);
      return `
      <tr data-id="${escapeHtml(row.id)}" class="${selected ? 'is-selected' : ''}">
        <td>${escapeHtml(row.vendedor_nombre || '—')}</td>
        <td>${escapeHtml(row.periodo_label || `${MESES[(Number(row.mes) || 1) - 1] || ''} ${row.anio || ''}`.trim())}</td>
        <td class="numeric">${escapeHtml(formatNumber(row.cantidad_folios || 0))}</td>
        <td class="numeric">${escapeHtml(formatCurrency(row.total_venta || 0))}</td>
        <td class="numeric">${escapeHtml(formatCurrency(row.total_comision || 0))}</td>
        <td><span class="status-pill ${estadoClass(row.estado)}">${escapeHtml(estadoLabel(row.estado))}</span></td>
        <td>${escapeHtml(formatDateTime(row.confirmado_at))}</td>
        <td>${escapeHtml(formatDateTime(row.revisado_at))}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="btn-mini" data-action="ver" data-id="${escapeHtml(row.id)}">Ver</button>
            <button type="button" class="btn-mini" data-action="validar" data-id="${escapeHtml(row.id)}">Validar</button>
            <button type="button" class="btn-mini is-danger" data-action="rechazar" data-id="${escapeHtml(row.id)}">Rechazar</button>
          </div>
        </td>
      </tr>
    `; }).join('');

    tbody.onclick = event => {
      const action = event.target.closest('[data-action]');
      if (action?.dataset.action === 'ver') {
        openDetalle(action.dataset.id);
        return;
      }
      if (action?.dataset.action === 'validar') {
        validarReporte(action.dataset.id);
        return;
      }
      if (action?.dataset.action === 'rechazar') {
        rechazarReporte(action.dataset.id);
        return;
      }
      const row = event.target.closest('tr[data-id]');
      if (row?.dataset.id) {
        openDetalle(row.dataset.id);
      }
    };
  }

  function renderDiferenciasTable(view) {
    const tbody = $('tbodyDiferencias');
    const total = $('totalDiferencias');
    if (!tbody || !total) return;
    total.textContent = `${view.diferencias.length} registros`;

    if (!view.diferencias.length) {
      tbody.innerHTML = emptyTableRow(
        5,
        'No se detectaron diferencias',
        'La revisión actual no muestra casos con observaciones para los filtros aplicados.'
      );
      return;
    }

    tbody.innerHTML = view.diferencias.map(row => {
      const selected = state.detalleSeleccionId === String(row.reporte_id || '');
      return `
      <tr class="${selected ? 'is-selected' : ''}">
        <td class="mono">${escapeHtml(row.folio)}</td>
        <td><span class="status-pill ${estadoComparacionClass(row)}">${escapeHtml(estadoComparacionLabel(row))}</span></td>
        <td>${escapeHtml(comparisonSummaryText(row.diferencias || []))}</td>
        <td class="mono">${escapeHtml(row.reporte_id || '—')}</td>
        <td>
          <button type="button" class="btn-mini" data-action="ver-diferencia" data-id="${escapeHtml(row.reporte_id || '')}">Ver</button>
        </td>
      </tr>
    `; }).join('');

    tbody.onclick = event => {
      const action = event.target.closest('[data-action="ver-diferencia"]');
      if (action?.dataset.id) {
        openDetalle(action.dataset.id);
        return;
      }
      const row = event.target.closest('tr');
      const button = row?.querySelector('[data-action="ver-diferencia"]');
      if (button?.dataset.id) {
        openDetalle(button.dataset.id);
      }
    };
  }

  function renderDetalle() {
    const detalle = state.detalleActual;
    const estado = $('detalleEstado');
    const subtitle = $('rrhhReportDetailSubtitle');
    const resumen = $('detalleResumen');
    const folios = $('detalleFolios');
    const diferencias = $('detalleDiferencias');
    const comentario = $('detalleComentario');
    const validacionInline = $('detalleValidacionInline');
    const rechazoInline = $('detalleRechazoInline');

    if (!detalle) {
      setReportDetailModalOpen(false);
      if (estado) {
        estado.textContent = '';
        estado.className = 'status-pill is-neutral';
      }
      if (subtitle) subtitle.textContent = 'Selecciona un folio o reporte para ver el detalle.';
      if (resumen) resumen.innerHTML = '';
      if (folios) folios.innerHTML = '';
      if (diferencias) diferencias.innerHTML = '';
      if (comentario) comentario.textContent = '';
      renderActionBlock(null);
      if (validacionInline) validacionInline.hidden = true;
      if (rechazoInline) rechazoInline.hidden = true;
      state.inlineAction = null;
      return;
    }

    setReportDetailModalOpen(true);

    const cabecera = detalle.cabecera || {};
    const listaFolios = Array.isArray(detalle.folios_asignados) ? detalle.folios_asignados : [];
    const diferenciasReporte = Array.isArray(detalle.reporte_json?.comparacion)
      ? detalle.reporte_json.comparacion
      : [];

    if (subtitle) {
      const vendedor = cabecera.vendedor_nombre || 'Sin vendedor';
      const periodo = cabecera.periodo_label || detalle.periodo_label || 'Sin período';
      subtitle.textContent = `${vendedor} · ${periodo}`;
    }

    if (estado) {
      estado.textContent = estadoLabel(detalle.estado);
      estado.className = `status-pill ${estadoClass(detalle.estado)}`;
    }

    if (resumen) {
      resumen.innerHTML = `
        <div class="detail-summary__grid">
          <div><span>Folio</span><strong>${escapeHtml(cabecera.folio || detalle.folio || '—')}</strong></div>
          <div><span>Vendedor</span><strong>${escapeHtml(cabecera.vendedor_nombre || '—')}</strong></div>
          <div><span>Período</span><strong>${escapeHtml(cabecera.periodo_label || '—')}</strong></div>
          <div><span>Total venta</span><strong>${escapeHtml(formatCurrency(cabecera.total_venta || 0))}</strong></div>
          <div><span>Total venta real</span><strong>${escapeHtml(formatCurrency(cabecera.total_venta_real || 0))}</strong></div>
          <div><span>Descuento</span><strong>${escapeHtml(formatCurrency(cabecera.total_descuento || 0))}</strong></div>
          <div><span>Comisión</span><strong>${escapeHtml(formatCurrency(cabecera.total_comision || 0))}</strong></div>
          <div><span>Folios</span><strong>${escapeHtml(formatNumber(cabecera.cantidad_folios || 0))}</strong></div>
          <div><span>Estado</span><strong>${escapeHtml(estadoLabel(detalle.estado))}</strong></div>
        </div>
      `;
    }

    if (folios) {
      folios.innerHTML = listaFolios.length
        ? `
          <div class="detail-table-wrap">
            <table class="detail-table">
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Cliente</th>
                  <th>Vendedor asignado</th>
                  <th>Monto</th>
                  <th>% participación</th>
                </tr>
              </thead>
              <tbody>
                ${listaFolios.map(item => `
                  <tr>
                    <td class="mono">${escapeHtml(item.folio || '—')}</td>
                    <td>${escapeHtml(item.cliente || 'Sin cliente')}</td>
                    <td>${escapeHtml(item.vendedor_asignado || 'Sin vendedor')}</td>
                    <td class="numeric">${escapeHtml(formatCurrency(item.monto_asignado || 0))}</td>
                    <td class="numeric">${escapeHtml(item.porcentaje_participacion != null ? formatPercent(item.porcentaje_participacion) : '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        `
        : '<p>Sin datos.</p>';
    }

    if (diferencias) {
      diferencias.innerHTML = diferenciasReporte.length
        ? `<div class="detail-list__stack">${diferenciasReporte.map(item => `<article class="mini-item mini-item--warn"><strong>${escapeHtml(item.folio || 'Folio')}</strong><span>${escapeHtml(comparisonSummaryText(Array.isArray(item.diferencias) ? item.diferencias : [item.diferencias].filter(Boolean)))}</span></article>`).join('')}</div>`
        : '<p>Sin diferencias registradas.</p>';
    }

    if (comentario) {
      comentario.textContent = cabecera.comentario_rrhh || cabecera.motivo_rechazo || detalle.comentario_rrhh || detalle.motivo_rechazo || 'Sin comentario.';
    }

    renderActionBlock(detalle);
    if (validacionInline && state.inlineAction !== 'validar') validacionInline.hidden = true;
    if (rechazoInline && state.inlineAction !== 'rechazar') rechazoInline.hidden = true;
  }

  function renderView() {
    const view = buildViewModel();
    updateHeaderMeta(view);
    renderSortableHeaders();
    renderSummaryCards(view);
    renderStatusBanner(view);
    renderGeneralTable(view);
    renderTipoCTable(view);
    renderAsignadosTable(view);
    renderReportesTable(view);
    renderDiferenciasTable(view);
    renderDetalle();
    bindSortEvents();
  }

  function updateHeaderMeta(view) {
    const badgePeriodo = $('badgePeriodo');
    const badgeCodigos = $('badgeCodigos');
    if (badgePeriodo) badgePeriodo.textContent = getPeriodoLabel(view.periodo);
    if (badgeCodigos) {
      const codigos = Array.isArray(view.codigosCompartidos) && view.codigosCompartidos.length
        ? view.codigosCompartidos.join(' · ')
        : '—';
      badgeCodigos.textContent = codigos;
    }
  }

  function setTab(tab) {
    const tabsConDetalle = new Set(['general', 'reportes', 'diferencias']);
    if (state.detalleActual && !tabsConDetalle.has(tab)) {
      clearDetalle();
    }
    state.tabActiva = tab;
    document.querySelectorAll('.tabs-bar__item').forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle('is-active', active);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.panel === tab);
    });
    renderView();
  }

  async function loadData() {
    readFilters();
    clearDetalle();
    renderView();

    const revisionQuery = buildServerQuery();
    const reportQuery = buildReportQuery();
    const errores = [];

    const revisionPromise = apiFetch(`/ventas-compartidas/revision?${new URLSearchParams(revisionQuery).toString()}`)
      .catch(error => {
        errores.push(`revisión: ${error.message}`);
        return null;
      });

    const reportesPromise = apiFetch(`/reportes-compartidos?${new URLSearchParams(reportQuery).toString()}`)
      .catch(error => {
        errores.push(`reportes: ${error.message}`);
        return null;
      });

    const [revision, reportes] = await Promise.all([revisionPromise, reportesPromise]);

    state.revision = revision;
    state.reportes = Array.isArray(reportes?.reportes) ? reportes.reportes : [];
    rebuildVendorOptions();
    renderView();

    if (errores.length) {
      console.warn('[RRHH] carga parcial de revisión ventas compartidas:', errores.join(' | '));
      if (errores.length === 1) {
        alert(`Se cargó el módulo parcialmente. ${errores[0]}`);
      } else {
        alert(`Se cargó el módulo parcialmente. ${errores.join(' · ')}`);
      }
    }
  }

  function openInlineAction(tipo) {
    state.inlineAction = tipo;
    const validacionInline = $('detalleValidacionInline');
    const rechazoInline = $('detalleRechazoInline');
    const comentario = $('comentarioValidacion');
    const motivo = $('motivoRechazo');

    if (tipo === 'validar') {
      if (validacionInline) validacionInline.hidden = false;
      if (rechazoInline) rechazoInline.hidden = true;
      if (comentario && !comentario.value) comentario.value = 'Montos revisados correctamente';
    } else if (tipo === 'rechazar') {
      if (validacionInline) validacionInline.hidden = true;
      if (rechazoInline) rechazoInline.hidden = false;
      if (motivo) motivo.value = '';
    }
  }

  function closeInlineAction() {
    state.inlineAction = null;
    const validacionInline = $('detalleValidacionInline');
    const rechazoInline = $('detalleRechazoInline');
    if (validacionInline) validacionInline.hidden = true;
    if (rechazoInline) rechazoInline.hidden = true;
  }

  async function procesarValidacion(id, comentario) {
    await apiFetch(`/reportes-compartidos/${id}/validar`, {
      method: 'PATCH',
      body: JSON.stringify({ comentario_rrhh: comentario.trim() }),
    });
  }

  async function procesarRechazo(id, motivo) {
    await apiFetch(`/reportes-compartidos/${id}/rechazar`, {
      method: 'PATCH',
      body: JSON.stringify({ motivo_rechazo: motivo.trim() }),
    });
  }

  async function openReportDetail(id) {
    if (!id) return;
    const data = await apiFetch(`/reportes-compartidos/${id}`);
    state.detalleActual = data;
    state.detalleSeleccionId = String(data?.cabecera?.id || id);
    closeInlineAction();
    setTab('reportes');
  }

  async function openDetalle(id) {
    return openReportDetail(id);
  }

  async function validarReporte(id, comentario) {
    if (!id) return;
    await procesarValidacion(id, comentario || '');
    closeInlineAction();
    await loadData();
    if (state.detalleActual?.cabecera?.id === Number(id)) {
      await openDetalle(id);
    }
  }

  async function rechazarReporte(id, motivo) {
    if (!id) return;
    if (!motivo?.trim()) {
      alert('Debes ingresar un motivo para rechazar.');
      return;
    }
    await procesarRechazo(id, motivo);
    closeInlineAction();
    await loadData();
    if (state.detalleActual?.cabecera?.id === Number(id)) {
      await openDetalle(id);
    }
  }

  function initSelectors() {
    populateYearMonth();
    setTab('general');
    state.filtros.anio = Number($('filtroAnio')?.value || state.filtros.anio);
    state.filtros.mes = Number($('filtroMes')?.value || state.filtros.mes);
  }

  function bindEvents() {
    $('btnLogout')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      window.location.href = '../../varios/login/index.html';
    });

    $('btnCerrarDetalle')?.addEventListener('click', () => {
      clearDetalle();
      renderView();
    });

    $('rrhhReportDetailModal')?.addEventListener('click', event => {
      if (event.target?.id === 'rrhhReportDetailModal') {
        clearDetalle();
        renderView();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && $('rrhhReportDetailModal')?.classList.contains('is-open')) {
        clearDetalle();
        renderView();
      }
    });

    $('sidebarToggle')?.addEventListener('click', () => {
      $('sidebar')?.classList.toggle('sidebar--collapsed');
      $('mainWrapper')?.classList.toggle('main-wrapper--expanded');
    });

    $('headerMenuBtn')?.addEventListener('click', () => {
      $('sidebar')?.classList.toggle('sidebar--open');
    });

    $('btnRecargar')?.addEventListener('click', async () => {
      try {
        await loadData();
      } catch (error) {
        alert(error.message);
      }
    });

    const limpiarFiltros = async () => {
      if ($('filtroAnio')) $('filtroAnio').value = String(new Date().getFullYear());
      if ($('filtroMes')) $('filtroMes').value = String(new Date().getMonth() + 1);
      if ($('filtroVendedorAsignador')) $('filtroVendedorAsignador').value = '';
      if ($('filtroVendedorAsignado')) $('filtroVendedorAsignado').value = '';
      if ($('filtroEstado')) $('filtroEstado').value = '';
      if ($('filtroFolio')) $('filtroFolio').value = '';
      if ($('filtroCliente')) $('filtroCliente').value = '';
      if ($('filtroSoloDiferencias')) $('filtroSoloDiferencias').checked = false;
      await loadData();
    };

    $('btnLimpiarFiltros')?.addEventListener('click', async () => {
      try {
        await limpiarFiltros();
      } catch (error) {
        alert(error.message);
      }
    });

    ['filtroAnio', 'filtroMes', 'filtroVendedorAsignador', 'filtroVendedorAsignado', 'filtroEstado', 'filtroSoloDiferencias']
      .forEach(id => {
        $(id)?.addEventListener('change', async () => {
          try {
            await loadData();
          } catch (error) {
            alert(error.message);
          }
        });
      });

    $('filtroFolio')?.addEventListener('input', () => {
      window.clearTimeout(window.__rrhhFiltroFolioTimer);
      window.__rrhhFiltroFolioTimer = window.setTimeout(async () => {
        try {
          await loadData();
        } catch (error) {
          alert(error.message);
        }
      }, 300);
    });

    $('filtroCliente')?.addEventListener('input', () => {
      renderView();
    });

    $('btnValidarReporte')?.addEventListener('click', async () => {
      if (!state.detalleActual?.cabecera?.id) return;
      openInlineAction('validar');
    });

    $('btnRechazarReporte')?.addEventListener('click', async () => {
      if (!state.detalleActual?.cabecera?.id) return;
      openInlineAction('rechazar');
    });

    $('cerrarValidacionInline')?.addEventListener('click', closeInlineAction);
    $('cancelarValidacionInline')?.addEventListener('click', closeInlineAction);
    $('confirmarValidacionInline')?.addEventListener('click', async () => {
      if (!state.detalleActual?.cabecera?.id) return;
      try {
        const comentario = $('comentarioValidacion')?.value || '';
        await validarReporte(state.detalleActual.cabecera.id, comentario);
      } catch (error) {
        alert(error.message);
      }
    });

    $('cerrarRechazoInline')?.addEventListener('click', closeInlineAction);
    $('cancelarRechazoInline')?.addEventListener('click', closeInlineAction);
    $('confirmarRechazoInline')?.addEventListener('click', async () => {
      if (!state.detalleActual?.cabecera?.id) return;
      try {
        const motivo = $('motivoRechazo')?.value || '';
        await rechazarReporte(state.detalleActual.cabecera.id, motivo);
      } catch (error) {
        alert(error.message);
      }
    });

    document.querySelectorAll('.tabs-bar__item').forEach(button => {
      button.addEventListener('click', () => setTab(button.dataset.tab));
    });
  }

  async function loadUserInfo() {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      const user = data?.user || data?.usuario || data || getSessionUser() || {};
      const nombre = displayNameFromUser(user);
      const area = String(user?.area || 'RRHH').trim() || 'RRHH';
      const avatar = initialsFromText(nombre, 'RR');

      if ($('userName')) $('userName').textContent = nombre;
      if ($('userArea')) $('userArea').textContent = area;
      if ($('userAvatar')) $('userAvatar').textContent = avatar;
      if ($('chipName')) $('chipName').textContent = nombre.split(' ')[0] || nombre;
      if ($('chipAvatar')) $('chipAvatar').textContent = avatar;
    } catch (error) {
      console.warn('[RRHH] no se pudo cargar el usuario:', error.message);
      const fallbackUser = getSessionUser();
      if (fallbackUser) {
        const nombre = displayNameFromUser(fallbackUser);
        const area = String(fallbackUser?.area || 'RRHH').trim() || 'RRHH';
        const avatar = initialsFromText(nombre, 'RR');
        if ($('userName')) $('userName').textContent = nombre;
        if ($('userArea')) $('userArea').textContent = area;
        if ($('userAvatar')) $('userAvatar').textContent = avatar;
        if ($('chipName')) $('chipName').textContent = nombre.split(' ')[0] || nombre;
        if ($('chipAvatar')) $('chipAvatar').textContent = avatar;
      } else {
        if ($('chipAvatar')) $('chipAvatar').textContent = 'RR';
      }
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    initSelectors();
    bindEvents();
    await loadUserInfo();

    try {
      await loadData();
    } catch (error) {
      alert(error.message);
    }
  });
})();





