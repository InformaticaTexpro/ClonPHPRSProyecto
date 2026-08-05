'use strict';

/**
 * historial.js v2.7.0
 *
 * Fix v2.7.0:
 *   - Elimina el bloque blanco (histFichaCliente) — solo existe el resumen oscuro.
 *   - El resumen oscuro se muestra INMEDIATAMENTE al seleccionar el cliente,
 *     con los datos disponibles (cod, nombre, tel1). Se actualiza con cliente-info
 *     (tel2, email, direccion, ciudad) en cuanto llega la respuesta de la API.
 *   - Al hacer Buscar, el resumen se actualiza con periodo + stats del historial.
 *
 * Fix v2.6.0:
 *   - Agrega Ciudad y Dirección al historial de cliente.
 *
 * Fix v2.5.0:
 *   - Nombre del ítem activo en sidebar cambiado a "Historial Cliente".
 *
 * Fix v2.4.0:
 *   - Tel1, Tel2 y Email se cargan inmediatamente al seleccionar el cliente.
 */

(function () {

  const API_CLIENTES  = '/api/ventas/clientes';
  const API_HISTORIAL = '/api/ventas/historial-cliente';
  const API_CLI_INFO  = '/api/ventas/cliente-info';
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

  function sinDatoHtml() {
    return '<span class="hist-sin-dato">SIN DATO</span>';
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
    if (cual === 'inicial')    show('histEstadoInicial');
    else if (cual === 'error')    show('histEstadoError');
    else if (cual === 'vacio')    show('histEstadoVacio');
    else if (cual === 'cargando') show('histSpinner');
  }

  function extraerEmail(row) {
    return row.Email || row.email || row.EmailAux || row.emailAux || row.MAIL || row.Mail || '';
  }

  function nombreCliente(row) {
    return String(row?.NomAux || row?.nombre || row?.CodAux || row?.codAux || '').trim();
  }

  // ── Sidebar ──────────────────────────────────────────────────────────────
  const MODULOS = [
    { nombre: 'Dashboard',           icon: '\uD83C\uDFE0', url: '../dashboard/index.html',                        area: null },
    { nombre: 'Ventas Asignadas',    icon: '\uD83D\uDCCA', url: '../ventas/index.html',                           area: ['ventas', 'gerencia'] },
    { nombre: 'Historial Cliente',   icon: '\uD83D\uDCCB', url: './index.html',                                   area: ['ventas', 'gerencia'], activo: true },
    { nombre: 'Facturaci\u00f3n',     icon: '\uD83E\uDDFE', url: '../../facturacion/facturacion/index.html',        area: ['facturacion', 'contabilidad', 'gerencia'] },
    { nombre: 'Bodega',               icon: '\uD83C\uDFED', url: '../../bodega/bodega/index.html',                  area: ['bodega', 'produccion', 'gerencia'] },
    { nombre: 'Producci\u00f3n',      icon: '\u2699\uFE0F', url: '../../produccion/produccion/index.html',          area: ['produccion', 'gerencia'] },
    { nombre: 'Serv. TEC',            icon: '\uD83D\uDEE0\uFE0F', url: '../../servtecnico/servicio-tecnico/index.html', area: ['servicio-tecnico', 'servicio', 'gerencia'] },
    { nombre: 'Laboratorio',          icon: '\uD83E\uDDEA', url: '../../laboratorio/laboratorio/index.html',       area: ['laboratorio', 'gerencia'] },
    { nombre: 'Cobranza',             icon: '\uD83D\uDCB0', url: '../../cobranza/cobranza/index.html',              area: ['cobranza', 'contabilidad', 'gerencia'] },
    { nombre: 'RRHH',                 icon: '\uD83D\uDC65', url: '../../rrhh/rrhh/index.html',                      area: ['rrhh', 'gerencia'] },
    { nombre: 'Contabilidad',         icon: '\uD83D\uDCDC', url: '../../contabilidad/contabilidad/index.html',      area: ['contabilidad', 'gerencia'] },
    { nombre: 'Administraci\u00f3n',  icon: '\uD83D\uDD27', url: '../../admin/admin/index.html',                   area: ['admin'] },
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
    if (!window.__APP_SIDEBAR_LOADED__ && nav) {
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

  // ── Resumen oscuro ───────────────────────────────────────────────────────
  // Renderiza el bloque oscuro con los datos disponibles en clienteSeleccionado.
  // Si aún no hay historial, omite las columnas de periodo/stats.
  // Si ya hay historial, muestra el periodo y los totales.
  function renderResumen(data, yDesde, yHasta) {
    const seccion = document.getElementById('histResumen');
    if (!seccion) return;

    const { historial } = data || { historial: [] };
    const tieneHistorial = historial && historial.length > 0;

    const productos = new Set();
    let totalMonto  = 0;
    if (tieneHistorial) {
      historial.forEach(row => {
        if (row.CodProd) productos.add(row.CodProd);
        totalMonto += Number(row.TotLinea || 0);
      });
    }

    const periodoLabel = (yDesde && yHasta)
      ? (yDesde === yHasta ? String(yDesde) : `${yDesde} \u2014 ${yHasta}`)
      : '';

    const totalFmt = new Intl.NumberFormat('es-CL',
      { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(totalMonto);

    const tel       = clienteSeleccionado?.tel       || '';
    const tel2      = clienteSeleccionado?.tel2      || '';
    const email     = clienteSeleccionado?.email     || '';
    const direccion = clienteSeleccionado?.direccion || '';
    const ciudad    = clienteSeleccionado?.ciudad    || '';
    const nomCompleto = `${clienteSeleccionado.codAux} \u2014 ${clienteSeleccionado.nomAux}`;

    const icoCliente = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const icoPeriodo = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>`;
    const icoTel    = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.1 19.79 19.79 0 0 1 1.61 4.5 2 2 0 0 1 3.6 2.32h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.07 6.07l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
    const icoMail   = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
    const icoDirec  = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    const icoCiudad = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
    const icoProd   = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7"/><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M2 7h20"/></svg>`;
    const icoTotal  = `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" x2="12" y1="1" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;

    function item(iconSvg, label, valorHtml, extraClass = '') {
      return `
        <div class="hist-resumen-item${extraClass ? ' ' + extraClass : ''}">
          <span class="hist-resumen-icon">${iconSvg}</span>
          <div class="hist-resumen-texto">
            <span class="hist-resumen-label">${label}</span>
            ${valorHtml}
          </div>
        </div>`;
    }

    const tel1Html = tel
      ? `<span class="hist-resumen-valor" title="${escHtml(tel)}">${escHtml(tel)}</span>`
      : `<span class="hist-resumen-valor">${sinDatoHtml()}</span>`;

    const tel2Html = tel2
      ? `<span class="hist-resumen-valor" title="${escHtml(tel2)}">${escHtml(tel2)}</span>`
      : `<span class="hist-resumen-valor">${sinDatoHtml()}</span>`;

    const emailHtml = email
      ? `<a class="hist-resumen-valor hist-resumen-link" href="mailto:${escHtml(email)}" title="${escHtml(email)}">${escHtml(email)}</a>`
      : `<span class="hist-resumen-valor">${sinDatoHtml()}</span>`;

    const direcHtml = direccion
      ? `<span class="hist-resumen-valor" title="${escHtml(direccion)}">${escHtml(direccion)}</span>`
      : `<span class="hist-resumen-valor">${sinDatoHtml()}</span>`;

    const ciudadHtml = ciudad
      ? `<span class="hist-resumen-valor" title="${escHtml(ciudad)}">${escHtml(ciudad)}</span>`
      : `<span class="hist-resumen-valor">${sinDatoHtml()}</span>`;

    // Items fijos (siempre visibles desde que se selecciona el cliente)
    const itemsContacto = `
      ${item(icoCliente, 'Cliente',
        `<span class="hist-resumen-valor" title="${escHtml(nomCompleto)}">${escHtml(nomCompleto)}</span>`,
        'hist-resumen-item--cliente')}
      ${item(icoTel,    'Tel\u00e9fono 1', tel1Html)}
      ${item(icoTel,    'Tel\u00e9fono 2', tel2Html)}
      ${item(icoMail,   'Email',           emailHtml)}
      ${item(icoDirec,  'Direcci\u00f3n',  direcHtml)}
      ${item(icoCiudad, 'Ciudad',          ciudadHtml)}
    `;

    // Items de resultado (solo cuando hay historial)
    const itemsHistorial = tieneHistorial ? `
      ${item(icoPeriodo, 'Per\u00edodo',
        `<span class="hist-resumen-valor">${escHtml(periodoLabel)}</span>`)}
      ${item(icoProd, 'Productos distintos',
        `<span class="hist-resumen-valor hist-resumen-valor--num">${productos.size}</span>`)}
      ${item(icoTotal, 'Total per\u00edodo',
        `<span class="hist-resumen-valor hist-resumen-valor--total">${totalFmt}</span>`,
        'hist-resumen-item--total')}
    ` : '';

    seccion.innerHTML = `
      <div class="hist-resumen-card">
        <div class="hist-resumen-row">
          ${itemsContacto}
          ${itemsHistorial}
        </div>
      </div>`;

    show('histResumen');
  }

  // ── Autocomplete ─────────────────────────────────────────────────────────
  function initAutocomplete() {
    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
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
      if (!input.contains(e.target) && !lista.contains(e.target)) hide('listaClientes');
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
        headers: { Authorization: `Bearer ${token()}` }, signal
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
        <li role="option"
          data-cod="${escHtml(c.CodAux)}"
          data-nom="${escHtml(c.NomAux)}"
          data-tel="${escHtml(c.FonAux1 || '')}"
          data-email="${escHtml(extraerEmail(c))}">
          <span class="hist-ac-codigo">${escHtml(c.CodAux)}</span>
          <span class="hist-ac-nombre">${escHtml(nombreCliente(c))}</span>
        </li>`).join('');
      show('listaClientes');
      lista.querySelectorAll('li[data-cod]').forEach(li => {
        li.addEventListener('click', () =>
          seleccionarCliente(li.dataset.cod, li.dataset.nom, li.dataset.tel, li.dataset.email)
        );
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[buscarClientes]', err);
      lista.innerHTML = '<li style="padding:8px 16px;color:#c00;font-size:.82rem">Error al buscar clientes</li>';
      show('listaClientes');
    }
  }

  function seleccionarCliente(cod, nom, tel1 = '', emailAc = '') {
    if (acAbortClientes) { acAbortClientes.abort(); acAbortClientes = null; }

    clienteSeleccionado = {
      codAux:    cod,
      nomAux:    nom,
      tel:       tel1    || '',
      tel2:      '',
      email:     emailAc || '',
      direccion: '',
      ciudad:    ''
    };

    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnBus = document.getElementById('btnBuscarHistorial');

    if (input) { input.value = ''; input.classList.add('hist--hidden'); }
    hide('listaClientes');
    if (lista) lista.innerHTML = '';
    if (chip) {
      const chipNombre = document.getElementById('clienteChipNombre');
      if (chipNombre) chipNombre.textContent = `${cod}  \u2014  ${nom || cod}`;
      show('clienteChip');
    }
    if (btnBus) btnBus.disabled = false;
    mostrarEstado(null);
    hide('histResultados');

    // Mostrar resumen oscuro inmediatamente con los datos disponibles (sin periodo/stats)
    renderResumen(null, null, null);

    // Cargar datos completos del cliente y actualizar el resumen
    fetch(`${API_CLI_INFO}?codAux=${encodeURIComponent(cod)}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
      .then(r => r.json())
      .then(data => {
        if (!clienteSeleccionado || clienteSeleccionado.codAux !== cod) return;
        if (data.ok && data.cliente) {
          clienteSeleccionado.tel       = data.cliente.telefono  || clienteSeleccionado.tel;
          clienteSeleccionado.tel2      = data.cliente.telefono2 || '';
          clienteSeleccionado.email     = data.cliente.email     || clienteSeleccionado.email;
          clienteSeleccionado.direccion = data.cliente.direccion || '';
          clienteSeleccionado.ciudad    = data.cliente.ciudad    || '';
          // Actualizar solo si no hay historial cargado aún
          if (document.getElementById('histResultados')?.classList.contains('hist--hidden')) {
            renderResumen(null, null, null);
          }
        }
      })
      .catch(err => console.warn('[cliente-info]', err));
  }

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
        headers: { Authorization: `Bearer ${token()}` }, signal
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
        renderResumen(null, null, null);
        mostrarEstado('vacio');
        return;
      }

      // Enriquecer clienteSeleccionado con datos del primerRow como fallback
      const primerRow = data.historial[0];
      if (!clienteSeleccionado.tel)       clienteSeleccionado.tel       = primerRow.FonAux1   || primerRow.fonAux1   || '';
      if (!clienteSeleccionado.tel2)      clienteSeleccionado.tel2      = primerRow.FonAux2   || primerRow.fonAux2   || '';
      if (!clienteSeleccionado.email)     clienteSeleccionado.email     = extraerEmail(primerRow);
      if (!clienteSeleccionado.direccion) clienteSeleccionado.direccion = primerRow.Direccion || primerRow.direccion || '';
      if (!clienteSeleccionado.ciudad)    clienteSeleccionado.ciudad    = primerRow.Ciudad    || primerRow.ciudad    || '';

      renderResumen(data, yDesde, yHasta);
      renderResultados(data.historial);

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

  function renderResultados(historial) {
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
    Object.keys(porAnio).sort((a, b) => Number(b) - Number(a)).forEach((anio) => {
      contenedor.appendChild(renderBloqueAnio(anio, Object.values(porAnio[anio])));
    });
    show('histResultados');
  }

  function renderBloqueAnio(anio, productos) {
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
    hide('histResumen');
    hide('histResultados');
    mostrarEstado('inicial');
  }

  async function init() {
    const usuario = await verificarSesion();
    if (!usuario) return;

    cargarSidebar(usuario);
    initYearSelects();
    initAutocomplete();

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
