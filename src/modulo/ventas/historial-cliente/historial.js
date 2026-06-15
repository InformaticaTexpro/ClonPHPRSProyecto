'use strict';

/**
 * historial.js v2.0.9
 *
 * Fix v2.0.9:
 *   - renderFichaCliente(): muestra email y teléfono del cliente cuando
 *     están disponibles (tras buscar historial).
 *   - renderResumen(): incluye email y teléfono en la tarjeta de resumen.
 *   - seleccionarCliente(): pasa tel y email (vacíos al inicio).
 *
 * Fix v2.0.8:
 *   - Sistema de visibilidad migrado de style.display a clase .hist--hidden
 *     con !important en CSS.
 *
 * Fix v2.0.7:
 *   - cargarSidebar() actualiza chipAvatar y chipName en el header.
 *
 * Fix v2.0.6:
 *   - AbortController separados para clientes e historial.
 */

(function () {

  const API_CLIENTES  = '/api/ventas/clientes';
  const API_HISTORIAL = '/api/ventas/historial-cliente';
  const token = () => localStorage.getItem('token');

  const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  let clienteSeleccionado = null;
  let acAbortClientes     = null;
  let acAbortHistorial    = null;

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

  function show(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hist--hidden');
  }

  function hide(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hist--hidden');
  }

  function mostrarEstado(cual) {
    hide('histEstadoInicial');
    hide('histEstadoError');
    hide('histEstadoVacio');
    hide('histSpinner');
    if (cual === 'inicial')   show('histEstadoInicial');
    else if (cual === 'error')    show('histEstadoError');
    else if (cual === 'vacio')    show('histEstadoVacio');
    else if (cual === 'cargando') show('histSpinner');
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
    const nombreMostrar = usuario.nombre || usuario.email;

    setText('userName',   nombreMostrar);
    setText('userArea',   usuario.area || '');
    setText('userAvatar', ini);
    setText('chipAvatar', ini);
    setText('chipName',   nombreMostrar);

    setText('headerDate', new Date().toLocaleDateString('es-CL',
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

  // ── Selectores de año ────────────────────────────────────────────────────
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

  // ── Ficha del cliente ────────────────────────────────────────────────────
  function renderFichaCliente(cod, nom) {
    const ficha = document.getElementById('histFichaCliente');
    if (!ficha) return;

    const tel   = clienteSeleccionado?.tel   || '';
    const email = clienteSeleccionado?.email || '';

    const contactoHtml = (tel || email) ? `
      <div class="hist-ficha-contacto">
        ${tel ? `
          <span class="hist-ficha-contacto-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.5 2 2 0 0 1 3.6 2.32h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.07 6.07l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            ${escHtml(tel)}
          </span>` : ''}
        ${email ? `
          <a class="hist-ficha-contacto-item hist-ficha-contacto-link" href="mailto:${escHtml(email)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            ${escHtml(email)}
          </a>` : ''}
      </div>` : '';

    ficha.innerHTML = `
      <div class="hist-ficha-card">
        <div class="hist-ficha-icono">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>
        <div class="hist-ficha-info">
          <span class="hist-ficha-codigo">${escHtml(cod)}</span>
          <span class="hist-ficha-nombre">${escHtml(nom)}</span>
          ${contactoHtml}
        </div>
        <div class="hist-ficha-hint">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          Selecciona el per\u00edodo y pulsa <strong>Buscar</strong> para cargar el historial
        </div>
      </div>`;
    show('histFichaCliente');
  }

  // ── Autocomplete ─────────────────────────────────────────────────────────
  function initAutocomplete() {
    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnRem = document.getElementById('btnRemoveCliente');
    const btnBus = document.getElementById('btnBuscarHistorial');
    if (!input) return;

    hide('clienteChip');
    hide('listaClientes');
    if (btnBus) btnBus.disabled = true;

    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (!clienteSeleccionado && q.length >= 2) buscarClientes(q);
    });

    input.addEventListener('input', () => {
      const q = input.value.trim();

      clienteSeleccionado = null;
      hide('clienteChip');
      if (btnBus) btnBus.disabled = true;
      hide('histFichaCliente');
      hide('histResumen');
      hide('histResultados');

      if (q.length < 2) {
        hide('listaClientes');
        lista.innerHTML = '';
        mostrarEstado('inicial');
        return;
      }

      mostrarEstado('inicial');
      if (acAbortClientes) acAbortClientes.abort();
      buscarClientes(q);
    });

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
        hide('listaClientes');
      }
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !lista.contains(e.target)) {
        hide('listaClientes');
      }
    });

    btnRem?.addEventListener('click', () => {
      if (acAbortClientes)  { acAbortClientes.abort();  acAbortClientes  = null; }
      if (acAbortHistorial) { acAbortHistorial.abort(); acAbortHistorial = null; }
      clienteSeleccionado = null;

      input.value = '';
      input.classList.remove('hist--hidden');

      hide('listaClientes');
      lista.innerHTML = '';
      hide('clienteChip');

      if (btnBus) btnBus.disabled = true;

      hide('histFichaCliente');
      hide('histResumen');
      hide('histResultados');
      mostrarEstado('inicial');

      requestAnimationFrame(() => input.focus());
    });
  }

  async function buscarClientes(q) {
    const lista = document.getElementById('listaClientes');
    if (!lista) return;

    const queryActual = q.trim();
    acAbortClientes   = new AbortController();
    const signal      = acAbortClientes.signal;

    try {
      const res  = await fetch(`${API_CLIENTES}?q=${encodeURIComponent(queryActual)}`, {
        headers: { Authorization: `Bearer ${token()}` },
        signal
      });

      const data = await res.json();

      if (signal.aborted) return;
      const inputActual = document.getElementById('inputCliente')?.value.trim();
      if (inputActual !== queryActual) return;

      if (!data.ok || !data.clientes?.length) {
        lista.innerHTML = '<li style="padding:8px 16px;color:#aaa;font-size:.82rem">Sin resultados</li>';
        show('listaClientes');
        return;
      }

      lista.innerHTML = data.clientes.slice(0, 40).map(c => `
        <li role="option" data-cod="${escHtml(c.CodAux)}" data-nom="${escHtml(c.NomAux)}">
          <span class="hist-ac-codigo">${escHtml(c.CodAux)}</span>
          <span class="hist-ac-nombre">${escHtml(c.NomAux)}</span>
        </li>`).join('');

      show('listaClientes');

      lista.querySelectorAll('li[data-cod]').forEach(li => {
        li.addEventListener('click', () => seleccionarCliente(li.dataset.cod, li.dataset.nom));
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[buscarClientes]', err);
      lista.innerHTML = '<li style="padding:8px 16px;color:#c00;font-size:.82rem">Error al buscar clientes</li>';
      show('listaClientes');
    }
  }

  // ── Seleccionar cliente ───────────────────────────────────────────────────
  function seleccionarCliente(cod, nom) {
    if (acAbortClientes) { acAbortClientes.abort(); acAbortClientes = null; }

    clienteSeleccionado = { codAux: cod, nomAux: nom, tel: '', email: '' };

    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnBus = document.getElementById('btnBuscarHistorial');

    if (input) {
      input.value = '';
      input.classList.add('hist--hidden');
    }

    hide('listaClientes');
    if (lista) lista.innerHTML = '';

    if (chip) {
      const chipNombre = document.getElementById('clienteChipNombre');
      if (chipNombre) chipNombre.textContent = `${cod}  \u2014  ${nom}`;
      show('clienteChip');
    }

    if (btnBus) btnBus.disabled = false;

    mostrarEstado(null);
    hide('histResumen');
    hide('histResultados');
    renderFichaCliente(cod, nom);
  }

  // ── Buscar historial ──────────────────────────────────────────────────────
  async function buscarHistorial() {
    if (!clienteSeleccionado) return;

    const yDesde = document.getElementById('fechaDesde')?.value;
    const yHasta = document.getElementById('fechaHasta')?.value;
    if (!yDesde || !yHasta) { alert('Selecciona el rango de a\u00f1os.'); return; }
    if (Number(yDesde) > Number(yHasta)) { alert('El a\u00f1o "Desde" no puede ser mayor a "Hasta".'); return; }

    if (acAbortHistorial) { acAbortHistorial.abort(); acAbortHistorial = null; }
    acAbortHistorial = new AbortController();
    const signal     = acAbortHistorial.signal;

    mostrarEstado('cargando');
    hide('histFichaCliente');
    hide('histResumen');
    hide('histResultados');

    const btnBus = document.getElementById('btnBuscarHistorial');
    if (btnBus) { btnBus.disabled = true; btnBus.textContent = 'Buscando...'; }

    try {
      const params = new URLSearchParams({
        codAux: clienteSeleccionado.codAux,
        desde:  yearToDesde(yDesde),
        hasta:  yearToHasta(yHasta)
      });

      const res = await fetch(`${API_HISTORIAL}?${params}`, {
        headers: { Authorization: `Bearer ${token()}` },
        signal
      });

      if (signal.aborted) return;

      if (!res.ok) {
        let errMsg = `Error ${res.status}`;
        try { const d = await res.json(); if (d.error) errMsg = d.error; } catch { /* no-op */ }
        throw new Error(errMsg);
      }

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error al obtener historial');

      mostrarEstado(null);

      if (!data.historial || !data.historial.length) {
        renderFichaCliente(clienteSeleccionado.codAux, clienteSeleccionado.nomAux);
        mostrarEstado('vacio');
        return;
      }

      // Guardar tel y email desde la primera fila del historial
      const primerRow = data.historial[0];
      clienteSeleccionado.tel   = clienteSeleccionado.tel   || primerRow.FonAux1 || '';
      clienteSeleccionado.email = clienteSeleccionado.email || primerRow.Email   || '';

      renderFichaCliente(clienteSeleccionado.codAux, clienteSeleccionado.nomAux);
      renderResumen(data, yDesde, yHasta);
      renderResultados(data.historial, yDesde, yHasta);

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[buscarHistorial]', err);
      mostrarEstado(null);
      const msgEl = document.getElementById('histEstadoErrorMsg');
      if (msgEl) msgEl.textContent = err.message || 'Error desconocido. Intenta nuevamente.';
      mostrarEstado('error');
    } finally {
      if (btnBus) {
        btnBus.disabled = false;
        btnBus.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> Buscar`;
      }
      acAbortHistorial = null;
    }
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  function renderResumen(data, yDesde, yHasta) {
    const { historial } = data;
    const productos = new Set();
    let totalMonto  = 0;
    historial.forEach(row => {
      if (row.CodProd) productos.add(row.CodProd);
      totalMonto += Number(row.TotLinea || 0);
    });
    const periodoLabel = yDesde === yHasta ? String(yDesde) : `${yDesde} \u2014 ${yHasta}`;
    const totalFmt = new Intl.NumberFormat('es-CL',
      { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(totalMonto);

    const tel   = clienteSeleccionado?.tel   || '';
    const email = clienteSeleccionado?.email || '';

    const telItem = tel ? `
      <div class="hist-resumen-item">
        <span class="hist-resumen-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.5 2 2 0 0 1 3.6 2.32h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.07 6.07l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </span>
        <div>
          <span class="hist-resumen-label">Tel\u00e9fono</span>
          <span class="hist-resumen-valor">${escHtml(tel)}</span>
        </div>
      </div>` : '';

    const emailItem = email ? `
      <div class="hist-resumen-item">
        <span class="hist-resumen-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        </span>
        <div>
          <span class="hist-resumen-label">Email</span>
          <a class="hist-resumen-valor hist-resumen-link" href="mailto:${escHtml(email)}">${escHtml(email)}</a>
        </div>
      </div>` : '';

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
          ${telItem}
          ${emailItem}
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

  // ── Tablas por año ────────────────────────────────────────────────────────
  function renderResultados(historial, yDesde, yHasta) {
    const contenedor = document.getElementById('histResultados');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    const porAnio = {};
    historial.forEach(row => {
      const anio = String(row.Anio);
      const key  = row.CodProd;
      if (!porAnio[anio]) porAnio[anio] = {};
      if (!porAnio[anio][key]) porAnio[anio][key] = {
        CodProd: row.CodProd, DesProd: row.DetProd || '', meses: {}, total: 0
      };
      const mes = Number(row.Mes);
      porAnio[anio][key].meses[mes] = (porAnio[anio][key].meses[mes] || 0) + Number(row.TotLinea || 0);
      porAnio[anio][key].total      += Number(row.TotLinea || 0);
    });
    Object.keys(porAnio).sort((a, b) => Number(b) - Number(a)).forEach((anio, idx) => {
      contenedor.appendChild(renderBloqueAnio(anio, Object.values(porAnio[anio]), idx, yDesde, yHasta));
    });
    show('histResultados');
  }

  function renderBloqueAnio(anio, productos, idx, yDesde, yHasta) {
    const meses    = Array.from({ length: 12 }, (_, i) => i + 1);
    productos.sort((a, b) => b.total - a.total);
    const totalesMes = {};
    meses.forEach(m => { totalesMes[m] = productos.reduce((s, p) => s + (p.meses[m] || 0), 0); });
    const totalAnio  = productos.reduce((s, p) => s + p.total, 0);
    const bloque     = document.createElement('div');
    bloque.className = 'hist-anio-bloque';
    const tableId    = `tablaAnio${anio}`;

    bloque.innerHTML = `
      <div class="hist-anio-header">
        <span class="hist-anio-badge">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
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

  // ── Limpiar ───────────────────────────────────────────────────────────────
  function limpiarFormulario() {
    if (acAbortClientes)  { acAbortClientes.abort();  acAbortClientes  = null; }
    if (acAbortHistorial) { acAbortHistorial.abort(); acAbortHistorial = null; }
    clienteSeleccionado = null;

    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const btnBus = document.getElementById('btnBuscarHistorial');

    if (input) { input.value = ''; input.classList.remove('hist--hidden'); }
    hide('clienteChip');
    hide('listaClientes');
    if (lista) lista.innerHTML = '';
    if (btnBus) btnBus.disabled = true;

    initYearSelects();
    hide('histFichaCliente');
    hide('histResumen');
    hide('histResultados');
    mostrarEstado('inicial');
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    const usuario = await verificarSesion();
    if (!usuario) return;

    cargarSidebar(usuario);
    initYearSelects();
    initAutocomplete();

    hide('histFichaCliente');
    hide('histResumen');
    hide('histResultados');
    hide('histSpinner');
    mostrarEstado('inicial');

    document.getElementById('btnBuscarHistorial')
      ?.addEventListener('click', buscarHistorial);
    document.getElementById('btnLimpiarHistorial')
      ?.addEventListener('click', limpiarFormulario);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
