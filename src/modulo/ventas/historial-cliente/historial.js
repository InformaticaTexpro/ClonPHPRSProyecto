'use strict';

/**
 * historial.js — Historial de Cliente por Producto
 *
 * Flujo:
 *  1. Carga sesión y sidebar
 *  2. Autocomplete de clientes  GET /api/ventas/clientes?q=
 *  3. Al buscar              GET /api/ventas/historial-cliente?codAux=&desde=&hasta=
 *  4. Renderiza una tabla por cada año encontrado
 *     Columnas fijas: CodProd | Descripción | Total
 *     Columnas dinámicas: un mes por cada mes dentro del año (Ene…Dic)
 */

(function () {

  const API_CLIENTES  = '/api/ventas/clientes';
  const API_HISTORIAL = '/api/ventas/historial-cliente';
  const token = () => localStorage.getItem('token');

  const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
                        'Septiembre','Octubre','Noviembre','Diciembre'];

  // Estado
  let clienteSeleccionado = null; // { codAux, nomAux }
  let debounceTimer       = null;

  // ── Helpers ────────────────────────────────────────────────────────────
  function formatCLP(v) {
    if (v == null || v === '' || Number(v) === 0) return '—';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0
    }).format(Number(v));
  }

  function formatCLPNum(v) {
    if (v == null || Number(v) === 0) return null;
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0
    }).format(Number(v));
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function show(id)  { const el = document.getElementById(id); if (el) el.hidden = false; }
  function hide(id)  { const el = document.getElementById(id); if (el) el.hidden = true; }

  // ── Auth & Sidebar ──────────────────────────────────────────────────────
  const MODULOS = [
    { nombre:'Dashboard',      icon:'🏠', url:'../dashboard/index.html',                       area: null },
    { nombre:'Ventas',         icon:'📊', url:'../ventas/index.html',                          area:['ventas','gerencia'] },
    { nombre:'Historial',      icon:'📋', url:'./index.html',                                  area:['ventas','gerencia'], activo: true },
    { nombre:'Facturación',    icon:'🧾', url:'../../facturacion/facturacion/index.html',       area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',         icon:'🏭', url:'../../bodega/bodega/index.html',                 area:['bodega','produccion','gerencia'] },
    { nombre:'Producción',     icon:'⚙️', url:'../../produccion/produccion/index.html',         area:['produccion','gerencia'] },
    { nombre:'Serv. TEC',      icon:'🛠️', url:'../../servtecnico/servicio-tecnico/index.html',  area:['servicio-tecnico','servicio','gerencia'] },
    { nombre:'Laboratorio',    icon:'🧪', url:'../../laboratorio/laboratorio/index.html',      area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',       icon:'💰', url:'../../cobranza/cobranza/index.html',             area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',           icon:'👥', url:'../../rrhh/rrhh/index.html',                     area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',   icon:'📜', url:'../../contabilidad/contabilidad/index.html',     area:['contabilidad','gerencia'] },
    { nombre:'Administración', icon:'🔧', url:'../../admin/admin/index.html',                   area:['admin'] },
    { nombre:'Alertas',        icon:'🔔', url:'../../varios/alertas/index.html',                area: null },
  ];

  async function verificarSesion() {
    if (!token()) { window.location.href = '../../../varios/login/index.html'; return null; }
    try {
      const res  = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { window.location.href = '../../../varios/login/index.html'; return null; }
      return data.user;
    } catch { window.location.href = '../../../varios/login/index.html'; return null; }
  }

  function cargarSidebar(usuario) {
    const ini = (usuario.nombre || 'U').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    setText('userName',   usuario.nombre  || usuario.email);
    setText('userArea',   usuario.area    || '');
    setText('userAvatar', ini);
    setText('chipAvatar', ini);
    setText('chipName',   (usuario.nombre || usuario.email).split(' ')[0]);
    setText('headerDate', new Date().toLocaleDateString('es-CL',
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    setText('welcomeSubtitle', `Área: ${usuario.area || 'Sistema'} — Texpro`);

    const nav      = document.getElementById('sidebarNav');
    const visibles = MODULOS.filter(m => {
      if (m.area === null) return true;
      if (usuario.is_admin) return true;
      return m.area.includes(usuario.area);
    });

    if (nav) nav.innerHTML = `<span class="nav-section-title">NAVEGACIÓN</span>
      ${visibles.map(m => `
        <a class="nav-item${m.activo ? ' active' : ''}" href="${m.url}">
          <span style="font-size:1rem">${m.icon}</span>
          <span class="nav-label">${m.nombre}</span>
        </a>`).join('')}`;

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', () => {
      localStorage.removeItem('token'); localStorage.removeItem('user');
      window.location.href = '../../../varios/login/index.html';
    });
    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle) sidebarToggle.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper').classList.toggle('main-wrapper--expanded');
    });
    const headerMenuBtn = document.getElementById('headerMenuBtn');
    if (headerMenuBtn) headerMenuBtn.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });
  }

  // ── Fechas iniciales ────────────────────────────────────────────────────
  function initFechas() {
    const hoy   = new Date();
    const hasta = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const desde = `${hoy.getFullYear() - 1}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const elDesde = document.getElementById('fechaDesde');
    const elHasta = document.getElementById('fechaHasta');
    if (elDesde) elDesde.value = desde;
    if (elHasta) elHasta.value = hasta;
  }

  // ── Autocomplete clientes ───────────────────────────────────────────────
  function initAutocomplete() {
    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnRem = document.getElementById('btnRemoveCliente');
    const btnBus = document.getElementById('btnBuscarHistorial');
    if (!input) return;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q.length < 2) { lista.hidden = true; lista.innerHTML = ''; return; }
      debounceTimer = setTimeout(() => buscarClientes(q), 280);
    });

    input.addEventListener('keydown', (e) => {
      const items = lista.querySelectorAll('li');
      const current = lista.querySelector('li[aria-selected="true"]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = current ? current.nextElementSibling : items[0];
        if (next) { if (current) current.removeAttribute('aria-selected'); next.setAttribute('aria-selected', 'true'); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = current ? current.previousElementSibling : null;
        if (prev) { current.removeAttribute('aria-selected'); prev.setAttribute('aria-selected', 'true'); }
      } else if (e.key === 'Enter') {
        if (current) { e.preventDefault(); current.click(); }
      } else if (e.key === 'Escape') {
        lista.hidden = true;
      }
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !lista.contains(e.target)) lista.hidden = true;
    });

    if (btnRem) btnRem.addEventListener('click', () => {
      clienteSeleccionado = null;
      input.value = '';
      chip.hidden = true;
      input.hidden = false;
      if (btnBus) btnBus.disabled = true;
    });
  }

  async function buscarClientes(q) {
    const lista = document.getElementById('listaClientes');
    if (!lista) return;
    try {
      const res  = await fetch(`${API_CLIENTES}?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      const data = await res.json();
      if (!data.ok || !data.clientes.length) {
        lista.innerHTML = '<li style="padding:8px 16px;color:#aaa;font-size:.82rem">Sin resultados</li>';
        lista.hidden = false;
        return;
      }
      lista.innerHTML = data.clientes.slice(0, 40).map(c => `
        <li role="option" data-cod="${escHtml(c.CodAux)}" data-nom="${escHtml(c.NomAux)}">
          <span class="hist-ac-codigo">${escHtml(c.CodAux)}</span>
          <span class="hist-ac-nombre">${escHtml(c.NomAux)}</span>
        </li>`).join('');
      lista.hidden = false;

      lista.querySelectorAll('li[data-cod]').forEach(li => {
        li.addEventListener('click', () => seleccionarCliente(li.dataset.cod, li.dataset.nom));
      });
    } catch (err) {
      console.error('[buscarClientes]', err);
    }
  }

  function seleccionarCliente(cod, nom) {
    clienteSeleccionado = { codAux: cod, nomAux: nom };
    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnBus = document.getElementById('btnBuscarHistorial');
    if (input) input.hidden = true;
    if (lista) lista.hidden = true;
    if (chip)  { chip.hidden = false; document.getElementById('clienteChipNombre').textContent = `${cod} — ${nom}`; }
    if (btnBus) btnBus.disabled = false;
  }

  // ── Búsqueda principal ──────────────────────────────────────────────────
  async function buscarHistorial() {
    if (!clienteSeleccionado) return;

    const desde = document.getElementById('fechaDesde')?.value;
    const hasta = document.getElementById('fechaHasta')?.value;
    if (!desde || !hasta) {
      alert('Selecciona el rango de fechas (Desde / Hasta).');
      return;
    }
    if (desde > hasta) {
      alert('La fecha "Desde" no puede ser mayor a "Hasta".');
      return;
    }

    // Ocultar estados
    hide('histEstadoInicial');
    hide('histEstadoError');
    hide('histEstadoVacio');
    hide('histKpis');
    hide('histResultados');

    const btnBus = document.getElementById('btnBuscarHistorial');
    if (btnBus) { btnBus.disabled = true; btnBus.textContent = 'Buscando...'; }

    try {
      const params = new URLSearchParams({
        codAux: clienteSeleccionado.codAux,
        desde,
        hasta
      });
      const res  = await fetch(`${API_HISTORIAL}?${params}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      const data = await res.json();

      if (!res.ok || !data.ok) throw new Error(data.error || 'Error al obtener historial');

      if (!data.historial || !data.historial.length) {
        show('histEstadoVacio'); return;
      }

      renderKpis(data);
      renderResultados(data.historial, desde, hasta);

    } catch (err) {
      console.error('[buscarHistorial]', err);
      document.getElementById('histEstadoErrorMsg').textContent = err.message || 'Error desconocido';
      show('histEstadoError');
    } finally {
      if (btnBus) { btnBus.disabled = false; btnBus.textContent = 'Buscar'; }
    }
  }

  // ── KPIs globales ───────────────────────────────────────────────────────
  function renderKpis(data) {
    const { historial, resumen } = data;

    // Calcular desde el historial si el backend no envía resumen
    let totalFolios = 0, totalMonto = 0;
    const productos = new Set();
    historial.forEach(row => {
      productos.add(row.CodProd);
      totalFolios += Number(row.TotalFolios || 0);
      totalMonto  += Number(row.TotalMonto  || 0);
    });

    const desde = document.getElementById('fechaDesde')?.value || '';
    const hasta = document.getElementById('fechaHasta')?.value || '';
    const fmtMes = (ym) => {
      if (!ym) return '—';
      const [y, m] = ym.split('-');
      return `${MESES_CORTO[Number(m) - 1]} ${y}`;
    };

    setText('kpiClienteNombre', `${clienteSeleccionado.codAux} — ${clienteSeleccionado.nomAux}`);
    setText('kpiProductos',     String(productos.size));
    setText('kpiFolios',        totalFolios.toLocaleString('es-CL'));
    setText('kpiTotal',         new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(totalMonto));
    setText('kpiPeriodo',       `${fmtMes(desde)} → ${fmtMes(hasta)}`);

    show('histKpis');
  }

  // ── Renderizado de tablas por año ───────────────────────────────────────
  function renderResultados(historial, desde, hasta) {
    const contenedor = document.getElementById('histResultados');
    if (!contenedor) return;
    contenedor.innerHTML = '';

    // Agrupar por año → { 2024: [...rows], 2025: [...rows] }
    const porAnio = {};
    historial.forEach(row => {
      const anio = String(row.Anio);
      if (!porAnio[anio]) porAnio[anio] = [];
      porAnio[anio].push(row);
    });

    const anios = Object.keys(porAnio).sort((a, b) => Number(b) - Number(a)); // desc
    const colorIdx = anios.length; // para asignar colores rotativos en orden desc→asc

    anios.forEach((anio, idx) => {
      const bloque = renderBloqueAnio(anio, porAnio[anio], idx % 5, desde, hasta);
      contenedor.appendChild(bloque);
    });

    show('histResultados');
  }

  function renderBloqueAnio(anio, filas, colorIdx, desde, hasta) {
    // Determinar qué meses aplican a este año dentro del rango
    const [desdeAnio, desdeMes] = desde.split('-').map(Number);
    const [hastaAnio, hastaMes] = hasta.split('-').map(Number);
    const anioNum = Number(anio);

    const mesInicio = anioNum === desdeAnio ? desdeMes : 1;
    const mesFin    = anioNum === hastaAnio ? hastaMes : 12;
    const meses     = [];
    for (let m = mesInicio; m <= mesFin; m++) meses.push(m);

    // Agrupar filas por CodProd
    const porProducto = {};
    filas.forEach(row => {
      const key = row.CodProd;
      if (!porProducto[key]) {
        porProducto[key] = {
          CodProd: row.CodProd,
          DesProd: row.DesProd,
          meses:   {},
          total:   0
        };
      }
      porProducto[key].meses[Number(row.Mes)] = {
        monto:   Number(row.MontoMes   || 0),
        folios:  Number(row.FoliosMes  || 0),
        cant:    Number(row.CantMes    || 0)
      };
      porProducto[key].total += Number(row.MontoMes || 0);
    });

    const productos = Object.values(porProducto).sort((a, b) => b.total - a.total);

    // Totales por mes
    const totalesMes = {};
    meses.forEach(m => {
      totalesMes[m] = productos.reduce((s, p) => s + (p.meses[m]?.monto || 0), 0);
    });
    const totalAnio = productos.reduce((s, p) => s + p.total, 0);

    // ── HTML del bloque ──────────────────────────────────────────────────
    const bloque = document.createElement('div');
    bloque.className = 'hist-anio-bloque';

    const tableId = `tablaAnio${anio}`;

    bloque.innerHTML = `
      <!-- Header del año -->
      <div class="hist-anio-header">
        <span class="hist-anio-badge hist-anio-badge--${colorIdx}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          ${anio}
        </span>
        <div class="hist-anio-linea"></div>
        <span class="hist-anio-resumen">
          ${productos.length} producto${productos.length !== 1 ? 's' : ''} &nbsp;·&nbsp;
          Total: <strong>${formatCLP(totalAnio)}</strong>
        </span>
      </div>

      <!-- Card tabla -->
      <div class="hist-tabla-card">
        <div class="hist-tabla-header">
          <h3 class="hist-tabla-titulo">Detalle por producto — ${anio}</h3>
          <div class="hist-tabla-acciones">
            <input
              type="text"
              class="hist-busqueda-tabla"
              placeholder="Filtrar productos..."
              data-tabla="${tableId}"
            />
          </div>
        </div>

        <div class="hist-tabla-wrapper">
          <table class="hist-tabla" id="${tableId}">
            <thead>
              <!-- Fila 1: columnas fijas + grupo meses + total -->
              <tr>
                <th rowspan="2" style="min-width:90px">Código</th>
                <th rowspan="2" style="min-width:220px">Descripción</th>
                ${meses.map(m => `<th style="min-width:90px;text-align:right">${MESES_NOMBRE[m - 1]}</th>`).join('')}
                <th rowspan="2" style="min-width:110px;text-align:right;background:rgba(0,226,167,.15)">Total ${anio}</th>
              </tr>
            </thead>
            <tbody id="tbody${tableId}">
              ${productos.map(p => `
                <tr data-search="${escHtml(p.CodProd)} ${escHtml(p.DesProd)}".toLowerCase()">
                  <td><span class="hist-cod-prod">${escHtml(p.CodProd)}</span></td>
                  <td><span class="hist-desc-prod" title="${escHtml(p.DesProd)}">${escHtml(p.DesProd)}</span></td>
                  ${meses.map(m => {
                    const val = p.meses[m]?.monto || 0;
                    if (!val) return `<td class="hist-mes-cero">—</td>`;
                    return `<td class="hist-mes-valor">${formatCLP(val)}</td>`;
                  }).join('')}
                  <td class="hist-td-total">${formatCLP(p.total)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2"><strong>Total mes</strong></td>
                ${meses.map(m => {
                  const t = totalesMes[m];
                  return `<td>${t ? formatCLP(t) : '—'}</td>`;
                }).join('')}
                <td><strong>${formatCLP(totalAnio)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div class="hist-tabla-footer">
          <span class="hist-tabla-count" id="count${tableId}">${productos.length} producto${productos.length !== 1 ? 's' : ''}</span>
          <span class="hist-tabla-total-anio">Total ${anio}: ${formatCLP(totalAnio)}</span>
        </div>
      </div>
    `;

    // Filtro de búsqueda por tabla
    const inputFiltro = bloque.querySelector('.hist-busqueda-tabla');
    if (inputFiltro) {
      inputFiltro.addEventListener('input', () => {
        const q = inputFiltro.value.trim().toLowerCase();
        const filas = bloque.querySelectorAll(`#tbody${tableId} tr`);
        let visible = 0;
        filas.forEach(tr => {
          const texto = (tr.dataset.search || tr.textContent).toLowerCase();
          const mostrar = !q || texto.includes(q);
          tr.hidden = !mostrar;
          if (mostrar) visible++;
        });
        const countEl = bloque.querySelector(`#count${tableId}`);
        if (countEl) countEl.textContent = `${visible} producto${visible !== 1 ? 's' : ''}${q ? ' (filtrados)' : ''}`;
      });
    }

    return bloque;
  }

  // ── Limpiar formulario ──────────────────────────────────────────────────
  function limpiarFormulario() {
    clienteSeleccionado = null;
    const input = document.getElementById('inputCliente');
    const chip  = document.getElementById('clienteChip');
    const btnBus = document.getElementById('btnBuscarHistorial');
    if (input) { input.value = ''; input.hidden = false; }
    if (chip)  chip.hidden = true;
    if (btnBus) btnBus.disabled = true;
    initFechas();
    hide('histKpis');
    hide('histResultados');
    hide('histEstadoError');
    hide('histEstadoVacio');
    show('histEstadoInicial');
  }

  // ── Init ────────────────────────────────────────────────────────────────
  async function init() {
    const usuario = await verificarSesion();
    if (!usuario) return;

    cargarSidebar(usuario);
    initFechas();
    initAutocomplete();

    const btnBus = document.getElementById('btnBuscarHistorial');
    if (btnBus) btnBus.addEventListener('click', buscarHistorial);

    const btnLim = document.getElementById('btnLimpiarHistorial');
    if (btnLim) btnLim.addEventListener('click', limpiarFormulario);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
