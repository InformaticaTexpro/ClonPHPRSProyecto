'use strict';

/**
 * historial.js v2.0.3
 *
 * Flujo de estados (SOLO UNO visible a la vez):
 *   - Al cargar          → mostrarEstado('inicial')
 *   - Al buscar (loading)→ mostrarEstado(null)  [oculta todo, botón dice Buscando...]
 *   - Resultado OK       → mostrarEstado(null)  + renderResumen + renderResultados
 *   - Sin movimientos    → mostrarEstado('vacio')
 *   - Error real API/red → mostrarEstado('error') + mensaje descriptivo
 *   - Al limpiar/quitar  → mostrarEstado('inicial')
 *
 * Input / Chip:
 *   - inputCliente visible al inicio (oculto solo cuando hay cliente seleccionado)
 *   - clienteChip oculto al inicio (visible solo cuando hay cliente seleccionado)
 *   - Al quitar chip: input visible, chip oculto, botón Buscar deshabilitado
 */

(function () {

  const API_CLIENTES  = '/api/ventas/clientes';
  const API_HISTORIAL = '/api/ventas/historial-cliente';
  const token = () => localStorage.getItem('token');

  const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let clienteSeleccionado = null;
  let abortController     = null;

  // ── Helpers fecha ────────────────────────────────────────────────────────
  function yearToDesde(y) { return y ? `${y}-01-01` : ''; }
  function yearToHasta(y) { return y ? `${y}-12-31` : ''; }

  // ── Helpers UI ───────────────────────────────────────────────────────────
  function formatCLP(v) {
    if (v == null || v === '' || Number(v) === 0) return '\u2014';
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

  /**
   * Muestra un elemento usando display (no solo hidden),
   * para garantizar compatibilidad con el CSS inline de seguridad del HTML.
   */
  function show(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    el.style.display = '';
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = true;
    el.style.display = 'none';
  }

  /**
   * Controlador único de estados.
   * Garantiza que SOLO UNO sea visible en pantalla.
   *
   * @param {'inicial'|'error'|'vacio'|null} cual
   *   null → oculta todos (mientras carga o cuando hay resultados)
   */
  function mostrarEstado(cual) {
    hide('histEstadoInicial');
    hide('histEstadoError');
    hide('histEstadoVacio');
    if (cual === 'inicial') show('histEstadoInicial');
    else if (cual === 'error')  show('histEstadoError');
    else if (cual === 'vacio')  show('histEstadoVacio');
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────
  const MODULOS = [
    { nombre: 'Dashboard',        icon: '\uD83C\uDFE0', url: '../dashboard/index.html',                        area: null },
    { nombre: 'Ventas Asignadas', icon: '\uD83D\uDCCA', url: '../ventas/index.html',                           area: ['ventas', 'gerencia'] },
    { nombre: 'Historial',        icon: '\uD83D\uDCCB', url: './index.html',                                   area: ['ventas', 'gerencia'], activo: true },
    { nombre: 'Facturaci\u00f3n', icon: '\uD83E\uDDFE', url: '../../facturacion/facturacion/index.html',        area: ['facturacion', 'contabilidad', 'gerencia'] },
    { nombre: 'Bodega',           icon: '\uD83C\uDFED', url: '../../bodega/bodega/index.html',                  area: ['bodega', 'produccion', 'gerencia'] },
    { nombre: 'Producci\u00f3n',  icon: '\u2699\uFE0F', url: '../../produccion/produccion/index.html',          area: ['produccion', 'gerencia'] },
    { nombre: 'Serv. TEC',        icon: '\uD83D\uDEE0\uFE0F', url: '../../servtecnico/servicio-tecnico/index.html', area: ['servicio-tecnico', 'servicio', 'gerencia'] },
    { nombre: 'Laboratorio',      icon: '\uD83E\uDDEA', url: '../../laboratorio/laboratorio/index.html',       area: ['laboratorio', 'gerencia'] },
    { nombre: 'Cobranza',         icon: '\uD83D\uDCB0', url: '../../cobranza/cobranza/index.html',              area: ['cobranza', 'contabilidad', 'gerencia'] },
    { nombre: 'RRHH',             icon: '\uD83D\uDC65', url: '../../rrhh/rrhh/index.html',                      area: ['rrhh', 'gerencia'] },
    { nombre: 'Contabilidad',     icon: '\uD83D\uDCDC', url: '../../contabilidad/contabilidad/index.html',      area: ['contabilidad', 'gerencia'] },
    { nombre: 'Administraci\u00f3n', icon: '\uD83D\uDD27', url: '../../admin/admin/index.html',                 area: ['admin'] },
    { nombre: 'Alertas',          icon: '\uD83D\uDD14', url: '../../varios/alertas/index.html',                 area: null },
  ];

  async function verificarSesion() {
    if (!token()) { window.location.href = '../../varios/login/index.html'; return null; }
    try {
      const res  = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { window.location.href = '../../varios/login/index.html'; return null; }
      return data.user;
    } catch {
      window.location.href = '../../varios/login/index.html';
      return null;
    }
  }

  function cargarSidebar(usuario) {
    const ini = (usuario.nombre || 'U').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    setText('userName',        usuario.nombre  || usuario.email);
    setText('userArea',        usuario.area    || '');
    setText('userAvatar',      ini);
    setText('chipAvatar',      ini);
    setText('chipName',        (usuario.nombre || usuario.email).split(' ')[0]);
    setText('headerDate',      new Date().toLocaleDateString('es-CL',
      { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    setText('welcomeSubtitle', `\u00c1rea: ${usuario.area || 'Sistema'} \u2014 Texpro`);

    const nav      = document.getElementById('sidebarNav');
    const visibles = MODULOS.filter(m => {
      if (m.area === null)  return true;
      if (usuario.is_admin) return true;
      return m.area.includes(usuario.area);
    });
    if (nav) {
      nav.innerHTML = `<span class="nav-section-title">NAVEGACI\u00d3N</span>
        ${visibles.map(m => `
          <a class="nav-item${m.activo ? ' active' : ''}" href="${m.url}">
            <span style="font-size:1rem">${m.icon}</span>
            <span class="nav-label">${m.nombre}</span>
          </a>`).join('')}`;
    }

    document.getElementById('btnLogout')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '../../varios/login/index.html';
    });
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper').classList.toggle('main-wrapper--expanded');
    });
    document.getElementById('headerMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });
  }

  // ── Selectores de año (2005 → año actual) ────────────────────────────────
  function initYearSelects() {
    const anioActual = new Date().getFullYear();
    const elDesde    = document.getElementById('fechaDesde');
    const elHasta    = document.getElementById('fechaHasta');
    if (!elDesde || !elHasta) return;
    [elDesde, elHasta].forEach(sel => {
      sel.innerHTML = '';
      for (let y = anioActual; y >= 2005; y--) {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        sel.appendChild(opt);
      }
    });
    elDesde.value = String(anioActual - 1);
    elHasta.value = String(anioActual);
  }

  // ── Autocomplete ─────────────────────────────────────────────────────────
  function initAutocomplete() {
    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnRem = document.getElementById('btnRemoveCliente');
    const btnBus = document.getElementById('btnBuscarHistorial');
    if (!input) return;

    // Solo busca si hay 2+ caracteres
    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q.length < 2) {
        lista.hidden = true;
        lista.innerHTML = '';
        return;
      }
      if (abortController) abortController.abort();
      buscarClientes(q);
    });

    // Navegación teclado en lista
    input.addEventListener('keydown', (e) => {
      const items   = lista.querySelectorAll('li[data-cod]');
      const current = lista.querySelector('li[aria-selected="true"]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = current ? current.nextElementSibling : items[0];
        if (next) { current?.removeAttribute('aria-selected'); next.setAttribute('aria-selected', 'true'); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = current?.previousElementSibling;
        if (prev) { current.removeAttribute('aria-selected'); prev.setAttribute('aria-selected', 'true'); }
      } else if (e.key === 'Enter') {
        if (current) { e.preventDefault(); current.click(); }
      } else if (e.key === 'Escape') {
        lista.hidden = true;
      }
    });

    // Cerrar lista al hacer clic fuera
    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !lista.contains(e.target)) lista.hidden = true;
    });

    // ── Quitar chip: vuelve al estado inicial ────────────────────────────
    btnRem?.addEventListener('click', () => {
      if (abortController) { abortController.abort(); abortController = null; }
      clienteSeleccionado = null;

      // Restaurar input limpio y visible
      input.value  = '';
      input.hidden = false;
      input.style.display = '';

      // Ocultar lista y chip
      lista.hidden    = true;
      lista.innerHTML = '';
      chip.hidden     = true;

      // Deshabilitar botón buscar
      if (btnBus) btnBus.disabled = true;

      // Ocultar resultados y volver al estado inicial
      hide('histResumen');
      hide('histResultados');
      mostrarEstado('inicial');

      // Dar foco al input
      requestAnimationFrame(() => input.focus());
    });
  }

  async function buscarClientes(q) {
    const lista = document.getElementById('listaClientes');
    if (!lista) return;
    abortController = new AbortController();
    try {
      const res  = await fetch(`${API_CLIENTES}?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token()}` },
        signal: abortController.signal
      });
      const data = await res.json();
      if (!data.ok || !data.clientes?.length) {
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
      if (err.name === 'AbortError') return;
      console.error('[buscarClientes]', err);
    }
  }

  // ── Seleccionar cliente ──────────────────────────────────────────────────
  function seleccionarCliente(cod, nom) {
    // Cancelar cualquier fetch en curso
    if (abortController) { abortController.abort(); abortController = null; }

    // Registrar el cliente
    clienteSeleccionado = { codAux: cod, nomAux: nom, tel: '', email: '' };

    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnBus = document.getElementById('btnBuscarHistorial');

    // Limpiar valor y ocultar input
    if (input) {
      input.value         = '';
      input.hidden        = true;
      input.style.display = 'none';
    }

    // Cerrar lista desplegable
    if (lista) { lista.hidden = true; lista.innerHTML = ''; }

    // Mostrar chip con código y nombre
    if (chip) {
      const chipNombre = document.getElementById('clienteChipNombre');
      if (chipNombre) chipNombre.textContent = `${cod}  —  ${nom}`;
      chip.hidden        = false;
      chip.style.display = '';
    }

    // Habilitar botón buscar
    if (btnBus) btnBus.disabled = false;
  }

  // ── Buscar historial ─────────────────────────────────────────────────────
  async function buscarHistorial() {
    if (!clienteSeleccionado) return;

    const yDesde = document.getElementById('fechaDesde')?.value;
    const yHasta = document.getElementById('fechaHasta')?.value;
    if (!yDesde || !yHasta) {
      alert('Selecciona el rango de años (Desde / Hasta).');
      return;
    }
    if (Number(yDesde) > Number(yHasta)) {
      alert('El año "Desde" no puede ser mayor a "Hasta".');
      return;
    }

    // Mientras carga: ocultar todo
    mostrarEstado(null);
    hide('histResumen');
    hide('histResultados');

    const btnBus = document.getElementById('btnBuscarHistorial');
    if (btnBus) {
      btnBus.disabled    = true;
      btnBus.textContent = 'Buscando...';
    }

    try {
      const params = new URLSearchParams({
        codAux: clienteSeleccionado.codAux,
        desde:  yearToDesde(yDesde),
        hasta:  yearToHasta(yHasta)
      });
      const res = await fetch(`${API_HISTORIAL}?${params}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });

      // Error HTTP real (401, 500, etc.)
      if (!res.ok) {
        let errMsg = `Error ${res.status}`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch { /* no-op */ }
        throw new Error(errMsg);
      }

      const data = await res.json();

      // La API respondió ok:false (error de negocio)
      if (!data.ok) throw new Error(data.error || 'Error al obtener historial');

      // Sin movimientos para el período → estado vacío
      if (!data.historial || !data.historial.length) {
        mostrarEstado('vacio');
        return;
      }

      // Enriquecer datos del cliente si vienen en la primera fila
      const primerRow = data.historial[0];
      clienteSeleccionado.tel   = clienteSeleccionado.tel   || primerRow.FonAux1 || '';
      clienteSeleccionado.email = clienteSeleccionado.email || primerRow.Email   || '';

      // Mostrar resultados
      mostrarEstado(null);
      renderResumen(data, yDesde, yHasta);
      renderResultados(data.historial, yDesde, yHasta);

    } catch (err) {
      // Solo mostrar estado error ante fallos REALES (red, HTTP, API)
      // No mostrarlo ante vaciado de resultados (eso usa mostrarEstado('vacio'))
      console.error('[buscarHistorial]', err);
      const msgEl = document.getElementById('histEstadoErrorMsg');
      if (msgEl) msgEl.textContent = err.message || 'Error desconocido. Intenta nuevamente.';
      mostrarEstado('error');

    } finally {
      if (btnBus) {
        btnBus.disabled    = false;
        btnBus.textContent = 'Buscar';
      }
    }
  }

  // ── Resumen ──────────────────────────────────────────────────────────────
  function renderResumen(data, yDesde, yHasta) {
    const { historial } = data;
    const productos = new Set();
    let totalMonto  = 0;
    historial.forEach(row => {
      if (row.CodProd) productos.add(row.CodProd);
      totalMonto += Number(row.TotLinea || 0);
    });
    const periodoLabel = yDesde === yHasta
      ? String(yDesde)
      : `${yDesde} \u2014 ${yHasta}`;
    const totalFmt = new Intl.NumberFormat('es-CL',
      { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(totalMonto);

    const seccion = document.getElementById('histResumen');
    if (!seccion) return;
    seccion.innerHTML = `
      <div class="hist-resumen-card">
        <div class="hist-resumen-row">
          <div class="hist-resumen-item hist-resumen-item--cliente">
            <span class="hist-resumen-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <div>
              <span class="hist-resumen-label">Cliente</span>
              <span class="hist-resumen-valor">${escHtml(clienteSeleccionado.codAux)} &nbsp;\u2014&nbsp; ${escHtml(clienteSeleccionado.nomAux)}</span>
            </div>
          </div>
          <div class="hist-resumen-item">
            <span class="hist-resumen-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
            </span>
            <div>
              <span class="hist-resumen-label">Per\u00edodo</span>
              <span class="hist-resumen-valor">${escHtml(periodoLabel)}</span>
            </div>
          </div>
          <div class="hist-resumen-item">
            <span class="hist-resumen-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/></svg>
            </span>
            <div>
              <span class="hist-resumen-label">Productos distintos</span>
              <span class="hist-resumen-valor hist-resumen-valor--num">${productos.size}</span>
            </div>
          </div>
          <div class="hist-resumen-item hist-resumen-item--total">
            <span class="hist-resumen-icon">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="1" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </span>
            <div>
              <span class="hist-resumen-label">Total per\u00edodo</span>
              <span class="hist-resumen-valor hist-resumen-valor--total">${totalFmt}</span>
            </div>
          </div>
        </div>
      </div>`;
    show('histResumen');
  }

  // ── Tablas por año ───────────────────────────────────────────────────────
  function renderResultados(historial, yDesde, yHasta) {
    const contenedor = document.getElementById('histResultados');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    const porAnio = {};
    historial.forEach(row => {
      const anio = String(row.Anio);
      const mes  = Number(row.Mes);
      const key  = row.CodProd;
      if (!porAnio[anio]) porAnio[anio] = {};
      if (!porAnio[anio][key]) porAnio[anio][key] = {
        CodProd: row.CodProd,
        DesProd: row.DetProd || '',
        meses: {},
        total: 0
      };
      porAnio[anio][key].meses[mes] = (porAnio[anio][key].meses[mes] || 0) + Number(row.TotLinea || 0);
      porAnio[anio][key].total      += Number(row.TotLinea || 0);
    });
    Object.keys(porAnio).sort((a, b) => Number(b) - Number(a)).forEach((anio, idx) => {
      contenedor.appendChild(renderBloqueAnio(anio, Object.values(porAnio[anio]), idx, yDesde, yHasta));
    });
    show('histResultados');
  }

  function renderBloqueAnio(anio, productos, idx, yDesde, yHasta) {
    const meses = Array.from({ length: 12 }, (_, i) => i + 1);
    productos.sort((a, b) => b.total - a.total);
    const totalesMes = {};
    meses.forEach(m => { totalesMes[m] = productos.reduce((s, p) => s + (p.meses[m] || 0), 0); });
    const totalAnio = productos.reduce((s, p) => s + p.total, 0);
    const bloque    = document.createElement('div');
    bloque.className = 'hist-anio-bloque';
    const tableId   = `tablaAnio${anio}`;

    bloque.innerHTML = `
      <div class="hist-anio-header">
        <span class="hist-anio-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
          ${anio}
        </span>
        <div class="hist-anio-linea"></div>
        <span class="hist-anio-resumen">
          ${productos.length} producto${productos.length !== 1 ? 's' : ''}
          &nbsp;\u00b7&nbsp;
          Total: <strong>${formatCLP(totalAnio)}</strong>
        </span>
      </div>
      <div class="hist-tabla-card">
        <div class="hist-tabla-header">
          <h3 class="hist-tabla-titulo">Detalle por producto &mdash; ${anio}</h3>
          <div class="hist-tabla-acciones">
            <input type="text" class="hist-busqueda-tabla" placeholder="Filtrar productos..." data-tabla="${tableId}" />
          </div>
        </div>
        <div class="hist-tabla-wrapper">
          <table class="hist-tabla" id="${tableId}">
            <thead><tr>
              <th class="hist-th-codigo">C\u00f3digo</th>
              <th class="hist-th-desc">Descripci\u00f3n</th>
              ${meses.map(m => `<th class="hist-th-mes">${MESES_NOMBRE[m - 1]}</th>`).join('')}
              <th class="hist-th-total">Total ${anio}</th>
            </tr></thead>
            <tbody id="tbody${tableId}">
              ${productos.map((p, ri) => {
                const searchKey = `${p.CodProd} ${p.DesProd}`.toLowerCase();
                return `<tr class="${ri % 2 === 0 ? 'hist-tr-par' : 'hist-tr-impar'}" data-search="${escHtml(searchKey)}">
                  <td><span class="hist-cod-prod">${escHtml(p.CodProd)}</span></td>
                  <td><span class="hist-desc-prod" title="${escHtml(p.DesProd)}">${escHtml(p.DesProd)}</span></td>
                  ${meses.map(m => {
                    const val = p.meses[m] || 0;
                    return val
                      ? `<td class="hist-mes-valor">${formatCLP(val)}</td>`
                      : '<td class="hist-mes-cero">&mdash;</td>';
                  }).join('')}
                  <td class="hist-td-total">${formatCLP(p.total)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot><tr class="hist-tfoot-row">
              <td colspan="2"><strong>Total mes</strong></td>
              ${meses.map(m => `<td class="hist-tfoot-mes">${totalesMes[m] ? formatCLP(totalesMes[m]) : '&mdash;'}</td>`).join('')}
              <td class="hist-tfoot-gran-total"><strong>${formatCLP(totalAnio)}</strong></td>
            </tr></tfoot>
          </table>
        </div>
        <div class="hist-tabla-footer">
          <span class="hist-tabla-count" id="count${tableId}">
            ${productos.length} producto${productos.length !== 1 ? 's' : ''}
            &nbsp;\u00b7&nbsp;
            Total ${anio}: ${formatCLP(totalAnio)}
          </span>
        </div>
      </div>`;

    bloque.querySelector('.hist-busqueda-tabla')?.addEventListener('input', function () {
      const q       = this.value.trim().toLowerCase();
      let   visible = 0;
      bloque.querySelectorAll(`#tbody${tableId} tr`).forEach(tr => {
        const ok = !q || (tr.dataset.search || tr.textContent).toLowerCase().includes(q);
        tr.hidden = !ok;
        if (ok) visible++;
      });
      const countEl = bloque.querySelector(`#count${tableId}`);
      if (countEl) countEl.innerHTML =
        `${visible} producto${visible !== 1 ? 's' : ''}${q ? ' <em>(filtrados)</em>' : ''}
         &nbsp;\u00b7&nbsp;
         Total ${anio}: ${formatCLP(visible === productos.length ? totalAnio : null)}`;
    });

    return bloque;
  }

  // ── Limpiar formulario ───────────────────────────────────────────────────
  function limpiarFormulario() {
    if (abortController) { abortController.abort(); abortController = null; }
    clienteSeleccionado = null;

    const input  = document.getElementById('inputCliente');
    const chip   = document.getElementById('clienteChip');
    const lista  = document.getElementById('listaClientes');
    const btnBus = document.getElementById('btnBuscarHistorial');

    if (input) {
      input.value         = '';
      input.hidden        = false;
      input.style.display = '';
    }
    if (chip)  { chip.hidden = true; chip.style.display = 'none'; }
    if (lista) { lista.hidden = true; lista.innerHTML = ''; }
    if (btnBus) btnBus.disabled = true;

    initYearSelects();
    hide('histResumen');
    hide('histResultados');
    mostrarEstado('inicial');
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    const usuario = await verificarSesion();
    if (!usuario) return;

    cargarSidebar(usuario);
    initYearSelects();
    initAutocomplete();

    // Estado inicial: solo "Busca un cliente para comenzar"
    mostrarEstado('inicial');
    hide('histResumen');
    hide('histResultados');

    document.getElementById('btnBuscarHistorial')
      ?.addEventListener('click', buscarHistorial);
    document.getElementById('btnLimpiarHistorial')
      ?.addEventListener('click', limpiarFormulario);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
