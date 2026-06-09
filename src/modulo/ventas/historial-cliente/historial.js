'use strict';

/**
 * historial.js v1.1.0
 * - Inputs tipo month (YYYY-MM) convertidos a YYYY-MM-DD antes de llamar la API
 * - KPI-cards reemplazados por tabla resumen (#histResumen)
 * - Datos: GET /api/ventas/historial-cliente?codAux=&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
 */

(function () {

  const API_CLIENTES  = '/api/ventas/clientes';
  const API_HISTORIAL = '/api/ventas/historial-cliente';
  const token = () => localStorage.getItem('token');

  const MESES_CORTO  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto',
                        'Septiembre','Octubre','Noviembre','Diciembre'];

  let clienteSeleccionado = null;
  let debounceTimer       = null;

  // ── Convierte YYYY-MM (month input) a YYYY-MM-DD ──────────────────────────
  function monthToDesde(ym) {
    // "2025-03" -> "2025-03-01"
    return ym ? `${ym}-01` : '';
  }
  function monthToHasta(ym) {
    // "2025-03" -> último día del mes (2025-03-31)
    if (!ym) return '';
    const [y, m] = ym.split('-').map(Number);
    const ultimo = new Date(y, m, 0).getDate(); // día 0 del mes siguiente = último del actual
    return `${y}-${String(m).padStart(2,'0')}-${String(ultimo).padStart(2,'0')}`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function formatCLP(v) {
    if (v == null || v === '' || Number(v) === 0) return '—';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency', currency: 'CLP', maximumFractionDigits: 0
    }).format(Number(v));
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function show(id) { const el = document.getElementById(id); if (el) el.hidden = false; }
  function hide(id) { const el = document.getElementById(id); if (el) el.hidden = true; }

  // ── Sidebar ─────────────────────────────────────────────────────────────
  const MODULOS = [
    { nombre:'Dashboard',        icon:'🏠', url:'../dashboard/index.html',                        area: null },
    { nombre:'Ventas Asignadas', icon:'📊', url:'../ventas/index.html',                           area:['ventas','gerencia'] },
    { nombre:'Historial',        icon:'📋', url:'./index.html',                                   area:['ventas','gerencia'], activo: true },
    { nombre:'Facturación',      icon:'🧾', url:'../../facturacion/facturacion/index.html',        area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',           icon:'🏭', url:'../../bodega/bodega/index.html',                  area:['bodega','produccion','gerencia'] },
    { nombre:'Producción',       icon:'⚙️', url:'../../produccion/produccion/index.html',          area:['produccion','gerencia'] },
    { nombre:'Serv. TEC',        icon:'🛠️', url:'../../servtecnico/servicio-tecnico/index.html',   area:['servicio-tecnico','servicio','gerencia'] },
    { nombre:'Laboratorio',      icon:'🧪', url:'../../laboratorio/laboratorio/index.html',       area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',         icon:'💰', url:'../../cobranza/cobranza/index.html',              area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',             icon:'👥', url:'../../rrhh/rrhh/index.html',                      area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',     icon:'📜', url:'../../contabilidad/contabilidad/index.html',      area:['contabilidad','gerencia'] },
    { nombre:'Administración',   icon:'🔧', url:'../../admin/admin/index.html',                    area:['admin'] },
    { nombre:'Alertas',          icon:'🔔', url:'../../varios/alertas/index.html',                 area: null },
  ];

  async function verificarSesion() {
    if (!token()) { window.location.href = '../../varios/login/index.html'; return null; }
    try {
      const res  = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { window.location.href = '../../varios/login/index.html'; return null; }
      return data.user;
    } catch { window.location.href = '../../varios/login/index.html'; return null; }
  }

  function cargarSidebar(usuario) {
    const ini = (usuario.nombre || 'U').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    setText('userName',       usuario.nombre  || usuario.email);
    setText('userArea',       usuario.area    || '');
    setText('userAvatar',     ini);
    setText('chipAvatar',     ini);
    setText('chipName',       (usuario.nombre || usuario.email).split(' ')[0]);
    setText('headerDate',     new Date().toLocaleDateString('es-CL',
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

    document.getElementById('btnLogout')?.addEventListener('click', () => {
      localStorage.removeItem('token'); localStorage.removeItem('user');
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

  // ── Fechas iniciales: mes actual como hasta, hace 12 meses como desde ────
  function initFechas() {
    const hoy   = new Date();
    const pad   = n => String(n).padStart(2,'0');
    const hasta = `${hoy.getFullYear()}-${pad(hoy.getMonth()+1)}`;
    const desdeD = new Date(hoy);
    desdeD.setFullYear(desdeD.getFullYear() - 1);
    const desde = `${desdeD.getFullYear()}-${pad(desdeD.getMonth()+1)}`;

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
      const items   = lista.querySelectorAll('li[data-cod]');
      const current = lista.querySelector('li[aria-selected="true"]');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = current ? current.nextElementSibling : items[0];
        if (next) { current?.removeAttribute('aria-selected'); next.setAttribute('aria-selected','true'); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = current?.previousElementSibling;
        if (prev) { current.removeAttribute('aria-selected'); prev.setAttribute('aria-selected','true'); }
      } else if (e.key === 'Enter') {
        if (current) { e.preventDefault(); current.click(); }
      } else if (e.key === 'Escape') {
        lista.hidden = true;
      }
    });

    document.addEventListener('click', (e) => {
      if (!input.contains(e.target) && !lista.contains(e.target)) lista.hidden = true;
    });

    btnRem?.addEventListener('click', () => {
      clienteSeleccionado = null;
      input.value = '';
      chip.hidden  = true;
      input.hidden = false;
      input.focus();
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
        li.addEventListener('click', () => seleccionarCliente(
          li.dataset.cod, li.dataset.nom, li.dataset.tel, li.dataset.email
        ));
      });
    } catch (err) {
      console.error('[buscarClientes]', err);
    }
  }

  // Guarda tel y email del cliente para mostrar en tabla resumen
  function seleccionarCliente(cod, nom, tel, email) {
    clienteSeleccionado = { codAux: cod, nomAux: nom, tel: tel || '', email: email || '' };
    const input  = document.getElementById('inputCliente');
    const lista  = document.getElementById('listaClientes');
    const chip   = document.getElementById('clienteChip');
    const btnBus = document.getElementById('btnBuscarHistorial');
    if (input) input.hidden = true;
    if (lista) lista.hidden = true;
    if (chip)  {
      chip.hidden = false;
      document.getElementById('clienteChipNombre').textContent = `${cod} — ${nom}`;
    }
    if (btnBus) btnBus.disabled = false;
  }

  // ── Búsqueda principal ──────────────────────────────────────────────────
  async function buscarHistorial() {
    if (!clienteSeleccionado) return;

    const ymDesde = document.getElementById('fechaDesde')?.value; // YYYY-MM
    const ymHasta = document.getElementById('fechaHasta')?.value; // YYYY-MM
    if (!ymDesde || !ymHasta) { alert('Selecciona el rango de fechas (Desde / Hasta).'); return; }
    if (ymDesde > ymHasta)    { alert('La fecha "Desde" no puede ser mayor a "Hasta".'); return; }

    const desde = monthToDesde(ymDesde); // YYYY-MM-01
    const hasta = monthToHasta(ymHasta); // YYYY-MM-DD (último día)

    hide('histEstadoInicial');
    hide('histEstadoError');
    hide('histEstadoVacio');
    hide('histResumen');
    hide('histResultados');

    const btnBus = document.getElementById('btnBuscarHistorial');
    if (btnBus) { btnBus.disabled = true; btnBus.textContent = 'Buscando...'; }

    try {
      const params = new URLSearchParams({ codAux: clienteSeleccionado.codAux, desde, hasta });
      const res  = await fetch(`${API_HISTORIAL}?${params}`, {
        headers: { Authorization: `Bearer ${token()}` }
      });
      const data = await res.json();

      if (!res.ok || !data.ok) throw new Error(data.error || 'Error al obtener historial');
      if (!data.historial || !data.historial.length) { show('histEstadoVacio'); return; }

      // Completar tel/email desde la primera fila del historial (si no vino en autocomplete)
      const primerRow = data.historial[0];
      clienteSeleccionado.tel   = clienteSeleccionado.tel   || primerRow.FonAux1 || '';
      clienteSeleccionado.email = clienteSeleccionado.email || primerRow.Email   || '';

      renderResumen(data, ymDesde, ymHasta);
      renderResultados(data.historial, ymDesde, ymHasta);

    } catch (err) {
      console.error('[buscarHistorial]', err);
      const msgEl = document.getElementById('histEstadoErrorMsg');
      if (msgEl) msgEl.textContent = err.message || 'Error desconocido';
      show('histEstadoError');
    } finally {
      if (btnBus) { btnBus.disabled = false; btnBus.textContent = 'Buscar'; }
    }
  }

  // ── Tabla resumen (reemplaza los KPI-cards) ─────────────────────────
  function renderResumen(data, ymDesde, ymHasta) {
    const { historial } = data;
    const productos = new Set();
    let totalMonto = 0;
    historial.forEach(row => {
      if (row.CodProd) productos.add(row.CodProd);
      totalMonto += Number(row.TotLinea || 0);
    });

    const fmtMes = ym => {
      if (!ym) return '—';
      const [y, m] = ym.split('-');
      return `${MESES_NOMBRE[Number(m)-1]} ${y}`;
    };

    setText('rClienteNombre', `${clienteSeleccionado.codAux} — ${clienteSeleccionado.nomAux}`);
    setText('rClienteTel',    clienteSeleccionado.tel   || '—');
    setText('rClienteEmail',  clienteSeleccionado.email || '—');
    setText('rPeriodo',       `${fmtMes(ymDesde)} → ${fmtMes(ymHasta)}`);
    setText('rProductos',     String(productos.size));

    const totalEl = document.getElementById('rTotal');
    if (totalEl) totalEl.textContent = new Intl.NumberFormat('es-CL',
      { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(totalMonto);

    show('histResumen');
  }

  // ── Render tablas por año ───────────────────────────────────────────────
  function renderResultados(historial, ymDesde, ymHasta) {
    const contenedor = document.getElementById('histResultados');
    if (!contenedor) return;
    contenedor.innerHTML = '';

    // Agrupar: año → CodProd → { meses: {mes: monto}, total }
    const porAnio = {};
    historial.forEach(row => {
      const anio = String(row.Anio);
      const mes  = Number(row.Mes);
      const key  = row.CodProd;
      if (!porAnio[anio]) porAnio[anio] = {};
      if (!porAnio[anio][key]) {
        porAnio[anio][key] = { CodProd: row.CodProd, DesProd: row.DetProd || '', meses: {}, total: 0 };
      }
      porAnio[anio][key].meses[mes] = (porAnio[anio][key].meses[mes] || 0) + Number(row.TotLinea || 0);
      porAnio[anio][key].total      += Number(row.TotLinea || 0);
    });

    const anios = Object.keys(porAnio).sort((a,b) => Number(b) - Number(a));
    anios.forEach((anio, idx) => {
      const productos = Object.values(porAnio[anio]);
      const bloque    = renderBloqueAnio(anio, productos, idx % 5, ymDesde, ymHasta);
      contenedor.appendChild(bloque);
    });
    show('histResultados');
  }

  function renderBloqueAnio(anio, productos, colorIdx, ymDesde, ymHasta) {
    const anioNum   = Number(anio);
    const [desdeAnio, desdeMes] = ymDesde.split('-').map(Number);
    const [hastaAnio, hastaMes] = ymHasta.split('-').map(Number);
    const mesInicio = anioNum === desdeAnio ? desdeMes : 1;
    const mesFin    = anioNum === hastaAnio ? hastaMes : 12;
    const meses = [];
    for (let m = mesInicio; m <= mesFin; m++) meses.push(m);

    productos.sort((a,b) => b.total - a.total);

    const totalesMes = {};
    meses.forEach(m => {
      totalesMes[m] = productos.reduce((s,p) => s + (p.meses[m] || 0), 0);
    });
    const totalAnio = productos.reduce((s,p) => s + p.total, 0);

    const bloque  = document.createElement('div');
    bloque.className = 'hist-anio-bloque';
    const tableId = `tablaAnio${anio}`;

    bloque.innerHTML = `
      <div class="hist-anio-header">
        <span class="hist-anio-badge hist-anio-badge--${colorIdx}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2"/>
            <line x1="16" x2="16" y1="2" y2="6"/>
            <line x1="8"  x2="8"  y1="2" y2="6"/>
            <line x1="3"  x2="21" y1="10" y2="10"/>
          </svg>
          ${anio}
        </span>
        <div class="hist-anio-linea"></div>
        <span class="hist-anio-resumen">
          ${productos.length} producto${productos.length!==1?'s':''}
          &nbsp;·&nbsp;Total: <strong>${formatCLP(totalAnio)}</strong>
        </span>
      </div>

      <div class="hist-tabla-card">
        <div class="hist-tabla-header">
          <h3 class="hist-tabla-titulo">Detalle por producto &mdash; ${anio}</h3>
          <div class="hist-tabla-acciones">
            <input type="text" class="hist-busqueda-tabla"
              placeholder="Filtrar productos..."
              data-tabla="${tableId}" />
          </div>
        </div>
        <div class="hist-tabla-wrapper">
          <table class="hist-tabla" id="${tableId}">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                ${meses.map(m=>`<th>${MESES_NOMBRE[m-1]}</th>`).join('')}
                <th style="background:rgba(0,226,167,.15)">Total ${anio}</th>
              </tr>
            </thead>
            <tbody id="tbody${tableId}">
              ${productos.map(p=>{
                const searchKey = `${p.CodProd} ${p.DesProd}`.toLowerCase();
                return `<tr data-search="${escHtml(searchKey)}">
                  <td><span class="hist-cod-prod">${escHtml(p.CodProd)}</span></td>
                  <td><span class="hist-desc-prod" title="${escHtml(p.DesProd)}">${escHtml(p.DesProd)}</span></td>
                  ${meses.map(m=>{
                    const val = p.meses[m] || 0;
                    if (!val) return '<td class="hist-mes-cero">&mdash;</td>';
                    return `<td class="hist-mes-valor">${formatCLP(val)}</td>`;
                  }).join('')}
                  <td class="hist-td-total">${formatCLP(p.total)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2"><strong>Total mes</strong></td>
                ${meses.map(m=>{
                  const t = totalesMes[m];
                  return `<td>${t ? formatCLP(t) : '&mdash;'}</td>`;
                }).join('')}
                <td><strong>${formatCLP(totalAnio)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div class="hist-tabla-footer">
          <span class="hist-tabla-count" id="count${tableId}">
            ${productos.length} producto${productos.length!==1?'s':''}
          </span>
          <span class="hist-tabla-total-anio">Total ${anio}: ${formatCLP(totalAnio)}</span>
        </div>
      </div>
    `;

    bloque.querySelector('.hist-busqueda-tabla')?.addEventListener('input', function() {
      const q = this.value.trim().toLowerCase();
      let visible = 0;
      bloque.querySelectorAll(`#tbody${tableId} tr`).forEach(tr => {
        const txt = (tr.dataset.search || tr.textContent).toLowerCase();
        const ok  = !q || txt.includes(q);
        tr.hidden = !ok;
        if (ok) visible++;
      });
      const countEl = bloque.querySelector(`#count${tableId}`);
      if (countEl) countEl.textContent =
        `${visible} producto${visible!==1?'s':''}${q?' (filtrados)':''}`;
    });

    return bloque;
  }

  // ── Limpiar ─────────────────────────────────────────────────────────────
  function limpiarFormulario() {
    clienteSeleccionado = null;
    const input  = document.getElementById('inputCliente');
    const chip   = document.getElementById('clienteChip');
    const btnBus = document.getElementById('btnBuscarHistorial');
    if (input) { input.value = ''; input.hidden = false; }
    if (chip)  chip.hidden = true;
    if (btnBus) btnBus.disabled = true;
    initFechas();
    hide('histResumen');
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
    document.getElementById('btnBuscarHistorial')?.addEventListener('click', buscarHistorial);
    document.getElementById('btnLimpiarHistorial')?.addEventListener('click', limpiarFormulario);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
