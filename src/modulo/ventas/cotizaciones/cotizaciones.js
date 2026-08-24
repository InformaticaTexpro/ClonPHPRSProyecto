'use strict';

(function () {
  const API = '/api/cotizaciones';
  const token = () => localStorage.getItem('token');

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const estado = {
    resumen: null,
    listado: [],
    total: 0,
    page: 1,
    limit: 20,
    activePreview: 'month',
  };

  function formatCLP(value) {
    const n = Number(value || 0);
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
  }

  function escHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
    }
  }

  function showStatus(message, tipo = 'error') {
    const el = document.getElementById('dashboardStatus');
    if (!el) return;
    el.hidden = false;
    el.dataset.tipo = tipo;
    el.textContent = message;
  }

  function hideStatus() {
    const el = document.getElementById('dashboardStatus');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    delete el.dataset.tipo;
  }

  function setLoading(isLoading) {
    const overlay = document.getElementById('cotizacionesLoading');
    const main = document.getElementById('mainWrapper');
    if (overlay) {
      overlay.classList.toggle('is-open', isLoading);
      overlay.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
    }
    if (main) {
      main.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    }
  }

  function getPeriodo() {
    const hoy = new Date();
    const mes = Number(document.getElementById('filtroMes')?.value || hoy.getMonth() + 1);
    const anio = Number(document.getElementById('filtroAnio')?.value || hoy.getFullYear());
    return {
      mes: Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : hoy.getMonth() + 1,
      anio: Number.isInteger(anio) && anio >= 2026 ? anio : hoy.getFullYear(),
    };
  }

  function getFilters() {
    const periodo = getPeriodo();
    const data = {
      mes: periodo.mes,
      anio: periodo.anio,
      scope: document.getElementById('filtroScope')?.value || 'month',
      vendedor: document.getElementById('filtroVendedor')?.value?.trim() || '',
      estado: document.getElementById('filtroEstado')?.value?.trim() || '',
      cliente: document.getElementById('filtroCliente')?.value?.trim() || '',
      numero: document.getElementById('filtroNumero')?.value?.trim() || '',
    };
    if (data.vendedor === '') delete data.vendedor;
    if (data.estado === '') delete data.estado;
    if (data.cliente === '') delete data.cliente;
    if (data.numero === '') delete data.numero;
    return data;
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function initSelectores() {
    const hoy = new Date();
    const selMes = document.getElementById('filtroMes');
    if (selMes && !selMes.options.length) {
      MESES.forEach((mes, idx) => {
        const op = document.createElement('option');
        op.value = String(idx + 1);
        op.textContent = mes;
        if (idx + 1 === hoy.getMonth() + 1) {
          op.selected = true;
        }
        selMes.appendChild(op);
      });
    }

    const selAnio = document.getElementById('filtroAnio');
    if (selAnio && !selAnio.options.length) {
      for (let anio = hoy.getFullYear(); anio >= 2026; anio -= 1) {
        const op = document.createElement('option');
        op.value = String(anio);
        op.textContent = String(anio);
        if (anio === hoy.getFullYear()) {
          op.selected = true;
        }
        selAnio.appendChild(op);
      }
    }
  }

  function renderResumenCards() {
    if (!estado.resumen) {
      setText('kpiMesCount', '—');
      setText('kpiMesMonto', 'Monto cotizado: —');
      setText('kpiTotalCount', '—');
      setText('kpiTotalMonto', 'Monto histórico: —');
      setText('kpiMontoMes', '—');
      setText('kpiMontoTotal', '—');
      return;
    }

    const mes = estado.resumen.mes || {};
    const total = estado.resumen.total || {};
    setText('kpiMesCount', `${Number(mes.totalCotizaciones || 0).toLocaleString('es-CL')}`);
    setText('kpiMesMonto', `Monto cotizado: ${formatCLP(mes.montoCotizado || 0)}`);
    setText('kpiTotalCount', `${Number(total.totalCotizaciones || 0).toLocaleString('es-CL')}`);
    setText('kpiTotalMonto', `Monto histórico: ${formatCLP(total.montoCotizado || 0)}`);
    setText('kpiMontoMes', formatCLP(mes.montoCotizado || 0));
    setText('kpiMontoTotal', formatCLP(total.montoCotizado || 0));
  }

  function previewData(tipo) {
    if (!estado.resumen) return [];
    return tipo === 'total'
      ? (estado.resumen.total?.preview || [])
      : (estado.resumen.mes?.preview || []);
  }

  function setPreviewTipo(tipo) {
    estado.activePreview = tipo === 'total' ? 'total' : 'month';
    document.querySelectorAll('[data-preview]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.preview === estado.activePreview);
    });
    const titulo = estado.activePreview === 'total'
      ? 'Detalle básico de cotizaciones históricas'
      : 'Detalle básico de cotizaciones del mes';
    const badge = estado.activePreview === 'total' ? 'Históricas' : 'Mes seleccionado';
    const subtitulo = estado.activePreview === 'total'
      ? 'Últimos registros visibles del histórico de cotizaciones.'
      : 'Últimos registros visibles del período seleccionado.';
    setText('previewTitulo', titulo);
    setText('previewSubtitulo', subtitulo);
    setText('previewBadge', badge);
    renderPreview();
  }

  function renderPreview() {
    const tbody = document.getElementById('tbodyPreviewCotizaciones');
    if (!tbody) return;
    const data = previewData(estado.activePreview);
    if (!data.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin cotizaciones para mostrar</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(row => `
      <tr>
        <td><strong>${escHtml(row.CotNum)}</strong></td>
        <td>${escHtml(row.fecha_formato || '—')}</td>
        <td>${escHtml(row.NomCon || '—')}</td>
        <td>${escHtml(row.VenCod || '—')}</td>
        <td style="text-align:right">${formatCLP(row.CtMonto || 0)}</td>
        <td style="text-align:center">
          <button class="btn-buscar btn-buscar--ghost" type="button" data-detalle="${escHtml(row.CotNum)}">Ver detalle</button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('[data-detalle]').forEach(btn => {
      btn.addEventListener('click', () => abrirDetalle(btn.dataset.detalle));
    });
  }

  function renderListado() {
    const tbody = document.getElementById('tbodyCotizaciones');
    if (!tbody) return;
    if (!estado.listado.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="10">Sin registros con los filtros actuales</td></tr>';
      setText('contadorCotizaciones', '0 registros');
      return;
    }

    tbody.innerHTML = estado.listado.map(row => `
      <tr>
        <td><strong>${escHtml(row.CotNum)}</strong></td>
        <td>${escHtml(row.fecha_formato || '—')}</td>
        <td>${escHtml(row.CodAux || '—')}</td>
        <td>${escHtml(row.NomCon || '—')}</td>
        <td>${escHtml(row.VenCod || '—')}</td>
        <td>${escHtml(row.CtEstado || '—')}</td>
        <td style="text-align:right">${formatCLP(row.CtSubTotal || 0)}</td>
        <td style="text-align:right">${formatCLP(row.CtTotalDesc || 0)}</td>
        <td style="text-align:right">${formatCLP(row.CtMonto || 0)}</td>
        <td style="text-align:center">
          <button class="btn-buscar btn-buscar--ghost" type="button" data-ver="${escHtml(row.CotNum)}">Ver detalle</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-ver]').forEach(btn => {
      btn.addEventListener('click', () => abrirDetalle(btn.dataset.ver));
    });
    const totalRegistros = Number(estado.total || estado.listado.length || 0).toLocaleString('es-CL');
    setText('contadorCotizaciones', `${totalRegistros} registros`);
  }

  async function cargarFiltros() {
    const scope = document.getElementById('filtroScope')?.value || 'month';
    const data = await fetchJson(`${API}/filtros?${new URLSearchParams({
      mes: getPeriodo().mes,
      anio: getPeriodo().anio,
      scope,
    })}`);

    const vendedores = Array.isArray(data.vendedores) ? data.vendedores : [];
    const estados = Array.isArray(data.estados) ? data.estados : [];

    const selVendedor = document.getElementById('filtroVendedor');
    if (selVendedor) {
      const actual = selVendedor.value;
      selVendedor.innerHTML = '<option value="">Todos los vendedores</option>' + vendedores.map(v => {
        const codigo = String(v.codigo || '').trim();
        const nombre = String(v.nombre || codigo).trim() || codigo;
        return `<option value="${escHtml(codigo)}">${escHtml(codigo)}${nombre && nombre !== codigo ? ` - ${escHtml(nombre)}` : ''}</option>`;
      }).join('');
      if (actual) selVendedor.value = actual;
    }

    const selEstado = document.getElementById('filtroEstado');
    if (selEstado) {
      const actual = selEstado.value;
      selEstado.innerHTML = '<option value="">Todos los estados</option>' + estados.map(e => `<option value="${escHtml(e)}">${escHtml(e)}</option>`).join('');
      if (actual) selEstado.value = actual;
    }
  }

  async function cargarResumen() {
    const data = await fetchJson(`${API}/resumen?${new URLSearchParams(getFilters())}`);
    estado.resumen = data;
    renderResumenCards();
    renderPreview();
  }

  async function cargarListado() {
    const filtros = getFilters();
    const data = await fetchJson(`${API}?${new URLSearchParams({
      ...filtros,
      page: '1',
      limit: '0',
    })}`);
    estado.listado = Array.isArray(data.cotizaciones) ? data.cotizaciones : [];
    estado.total = Number(data.total || 0);
    renderListado();
  }

  async function cargarTodo() {
    hideStatus();
    setLoading(true);
    try {
      await cargarFiltros();
      await cargarResumen();
      await cargarListado();
    } catch (err) {
      console.error('[cotizaciones]', err);
      showStatus(err instanceof Error ? err.message : String(err || 'Error cargando cotizaciones'));
    } finally {
      setLoading(false);
    }
  }

  function limpiarFiltros() {
    const selVendedor = document.getElementById('filtroVendedor');
    const selEstado = document.getElementById('filtroEstado');
    const inputCliente = document.getElementById('filtroCliente');
    const inputNumero = document.getElementById('filtroNumero');
    const selScope = document.getElementById('filtroScope');
    if (selVendedor) selVendedor.value = '';
    if (selEstado) selEstado.value = '';
    if (inputCliente) inputCliente.value = '';
    if (inputNumero) inputNumero.value = '';
    if (selScope) selScope.value = 'month';
    cargarTodo();
  }

  async function abrirDetalle(cotNum) {
    if (!cotNum) return;
    const modal = document.getElementById('modalCotizacion');
    const tbody = document.getElementById('tbodyDetalleCotizacion');
    if (!modal || !tbody) return;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    tbody.innerHTML = '<tr class="tabla-empty"><td colspan="8">Cargando...</td></tr>';
    try {
      const data = await fetchJson(`${API}/detalle/${encodeURIComponent(cotNum)}`);
      const cot = data.cotizacion || {};
      setText('modalCotizacionTitulo', `Cotización ${cot.CotNum || cotNum}`);
      setText('modalCotizacionSubtitulo', cot.fecha_formato ? `Emitida el ${cot.fecha_formato}` : 'Detalle de cotización');
      setText('modalCliente', cot.NomCon || cot.CodAux || '—');
      setText('modalVendedor', cot.VenCod || '—');
      setText('modalEstado', cot.CtEstado || '—');
      setText('modalTotal', formatCLP(cot.CtMonto || 0));
      const detalle = Array.isArray(cot.detalle) ? cot.detalle : [];
      if (!detalle.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="8">Sin detalle disponible</td></tr>';
        return;
      }
      tbody.innerHTML = detalle.map(row => `
        <tr>
          <td>${escHtml(row.CtLinea || '—')}</td>
          <td>${escHtml(row.CodProd || '—')}</td>
          <td>${escHtml(row.DetProd || '—')}</td>
          <td style="text-align:right">${Number(row.CtCant || 0).toLocaleString('es-CL')}</td>
          <td style="text-align:right">${formatCLP(row.CtPrecio || 0)}</td>
          <td style="text-align:right">${formatCLP(row.CtSubTotal || 0)}</td>
          <td style="text-align:right">${formatCLP(row.CtTotDesc || 0)}</td>
          <td style="text-align:right">${formatCLP(row.CtTotLinea || 0)}</td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('[abrirDetalle]', err);
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="8">No se pudo cargar el detalle</td></tr>';
    }
  }

  function cerrarModal() {
    const modal = document.getElementById('modalCotizacion');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function bindEvents() {
    document.getElementById('btnActualizar')?.addEventListener('click', async () => {
      await cargarTodo();
    });
    document.getElementById('btnLimpiarFiltros')?.addEventListener('click', limpiarFiltros);
    document.getElementById('filtroScope')?.addEventListener('change', () => {
      cargarTodo();
    });
    ['filtroMes', 'filtroAnio', 'filtroVendedor', 'filtroEstado'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', () => {
        cargarTodo();
      });
    });
    ['filtroCliente', 'filtroNumero'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          cargarTodo();
        }
      });
    });

    document.querySelectorAll('[data-preview]').forEach(btn => {
      btn.addEventListener('click', () => setPreviewTipo(btn.dataset.preview));
    });
    document.getElementById('modalCotizacion')?.addEventListener('click', event => {
      if (event.target instanceof HTMLElement && event.target.dataset.close === 'true') {
        cerrarModal();
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        cerrarModal();
      }
    });
  }

  function initHeader() {
    setText('headerDate', new Date().toLocaleDateString('es-CL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }));
  }

  function init() {
    initSelectores();
    initHeader();
    bindEvents();
    setPreviewTipo('month');
    cargarTodo();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
