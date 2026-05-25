'use strict';

/**
 * ventas.js — Ventas Asignadas Texpro
 *
 * Gestión de folios compartidos entre coordinadores y vendedores.
 *
 * Coordinadores: asignan, editan y eliminan asignaciones de folios.
 * Vendedores:    visualizan folios recibidos de su coordinador.
 *
 * API: /api/dashboard (compartir, asignados, compartidos, vendedores-todos)
 */

(function () {

  const API   = '/api/dashboard';
  const token = () => localStorage.getItem('token');

  let todosVendedores = [];

  const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  function formatCLP(v) {
    if (v == null || v === '') return '—';
    return new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(Number(v));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
  }

  // ── Spinner ───────────────────────────────────────────────────────────────
  let cargaOverlay = null;

  function crearSpinner() {
    const el = document.createElement('div');
    el.id = 'cargaOverlay';
    el.className = 'carga-overlay';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-label', 'Cargando datos');
    el.innerHTML = `
      <div class="carga-ring">
        <svg viewBox="0 0 72 72" aria-hidden="true">
          <circle class="carga-track" cx="36" cy="36" r="27"/>
          <circle class="carga-arc"  cx="36" cy="36" r="27"/>
        </svg>
        <div class="carga-dot"></div>
      </div>
      <span class="carga-texto">Cargando datos...</span>
    `;
    document.body.appendChild(el);
    return el;
  }

  function mostrarCarga() {
    if (!cargaOverlay) cargaOverlay = crearSpinner();
    const colapsado = document.getElementById('sidebar')?.classList.contains('sidebar--collapsed');
    cargaOverlay.classList.toggle('carga-overlay--sidebar-collapsed', !!colapsado);
    cargaOverlay.offsetHeight;
    cargaOverlay.classList.add('carga-overlay--visible');
    const btn = document.getElementById('btnActualizar');
    if (btn) btn.disabled = true;
  }

  function ocultarCarga() {
    if (cargaOverlay) cargaOverlay.classList.remove('carga-overlay--visible');
    const btn = document.getElementById('btnActualizar');
    if (btn) btn.disabled = false;
  }

  async function verificarSesion() {
    if (!token()) { window.location.href = '../login/index.html'; return null; }
    try {
      const res  = await fetch('/api/auth/me', { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { window.location.href = '../login/index.html'; return null; }
      return data.user;
    } catch { window.location.href = '../login/index.html'; return null; }
  }

  function esCoordinador(usuario) {
    return (usuario.vendedores || []).some(v => v.tipo === 'C');
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  // area: null  → visible para TODOS los usuarios sin excepción
  // area: [...]  → visible solo para las áreas listadas
  const MODULOS = [
    { nombre:'Dashboard',     icon:'🏠', url:'../dashboard/index.html',    area: null },
    { nombre:'Facturación',   icon:'🧾', url:'../facturacion/index.html',  area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',        icon:'🏭', url:'../bodega/index.html',       area:['bodega','produccion','gerencia'] },
    { nombre:'Producción',    icon:'⚙️', url:'../produccion/index.html',   area:['produccion','gerencia'] },
    { nombre:'Laboratorio',   icon:'🧪', url:'../laboratorio/index.html',  area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',      icon:'💰', url:'../cobranza/index.html',     area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',          icon:'👥', url:'../rrhh/index.html',         area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',  icon:'📜', url:'../contabilidad/index.html', area:['contabilidad','gerencia'] },
    { nombre:'Administración',icon:'🔧', url:'../admin/index.html',        area:['admin'] },
    { nombre:'Alertas',       icon:'🔔', url:'../alertas/index.html',      area: null },
  ];

  function cargarSidebar(usuario) {
    const ini = (usuario.nombre||'U').split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();
    setText('userName',    usuario.nombre  || usuario.email);
    setText('userArea',    usuario.area    || '');
    setText('userAvatar',  ini);
    setText('chipAvatar',  ini);
    setText('chipName',    (usuario.nombre||usuario.email).split(' ')[0]);
    setText('headerDate',  new Date().toLocaleDateString('es-CL',
      { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
    setText('welcomeSubtitle', `Área: ${usuario.area||'Sistema'} — Texpro`);

    const nav      = document.getElementById('sidebarNav');
    const visibles = MODULOS.filter(m => {
      if (m.area === null) return true;
      if (usuario.is_admin) return true;
      return m.area.includes(usuario.area);
    });
    if (nav) nav.innerHTML = `<span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        <span class="nav-label">Ventas Asignadas</span>
      </a>
      ${visibles.map(m=>`<a class="nav-item" href="${m.url}"><span style="font-size:1rem">${m.icon}</span><span class="nav-label">${m.nombre}</span></a>`).join('')}`;

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', () => {
      localStorage.removeItem('token'); localStorage.removeItem('user');
      window.location.href = '../login/index.html';
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

  // ── Selectores mes/año ────────────────────────────────────────────────────
  function initSelectores() {
    const hoy    = new Date();
    const selMes = document.getElementById('filtroMes');
    if (selMes) {
      MESES_NOMBRE.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = i + 1; o.textContent = m;
        if (i + 1 === hoy.getMonth() + 1) o.selected = true;
        selMes.appendChild(o);
      });
    }
    const selAnio = document.getElementById('filtroAnio');
    if (selAnio) {
      for (let y = hoy.getFullYear(); y >= 2022; y--) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === hoy.getFullYear()) o.selected = true;
        selAnio.appendChild(o);
      }
    }
  }

  function getParams() {
    return {
      mes:  document.getElementById('filtroMes')?.value  || (new Date().getMonth() + 1),
      anio: document.getElementById('filtroAnio')?.value || new Date().getFullYear()
    };
  }

  // ── PANEL COORDINADOR ─────────────────────────────────────────────────────
  async function cargarListaVendedores() {
    try {
      const res  = await fetch(`${API}/vendedores-todos`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok || !data.vendedores?.length) return;
      todosVendedores = data.vendedores;
      const sel = document.getElementById('coordVendedor');
      if (!sel) return;
      sel.innerHTML = '<option value="">— Selecciona vendedor —</option>' +
        data.vendedores.map(v =>
          `<option value="${v.cod}">${v.cod} — ${v.nombre||'Sin nombre'}</option>`
        ).join('');
    } catch(err) { console.error('[cargarListaVendedores]', err); }
  }

  async function iniciarPanelCoordinador() {
    setStyle('panelCoordinador', 'display', 'block');
    setStyle('panelCompartidos', 'display', 'none');
    await Promise.all([ cargarListaVendedores(), cargarFoliosParaCompartir(), cargarFoliosAsignados() ]);

    const btnCompartir = document.getElementById('btnCompartir');
    if (btnCompartir) btnCompartir.addEventListener('click', async () => {
      const folio      = document.getElementById('coordFolio')?.value;
      const vendedor   = document.getElementById('coordVendedor')?.value;
      const porcentaje = document.getElementById('coordPorcentaje')?.value;
      const msgEl      = document.getElementById('coordMensaje');
      if (!folio || !vendedor || !porcentaje) {
        if (msgEl) { msgEl.textContent = '⚠️ Completa todos los campos'; msgEl.style.color = 'var(--color-danger)'; }
        return;
      }
      try {
        if (msgEl) { msgEl.textContent = 'Enviando...'; msgEl.style.color = 'var(--color-gray-mid)'; }
        const res  = await fetch(`${API}/compartir`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token()}` },
          body: JSON.stringify({ folio:Number(folio), cod_vendedor_compartido:vendedor, porcentaje:Number(porcentaje) })
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        if (msgEl) { msgEl.textContent = '✅ Folio asignado correctamente'; msgEl.style.color = 'var(--color-primary)'; }
        const coordVend = document.getElementById('coordVendedor');
        const coordPct  = document.getElementById('coordPorcentaje');
        if (coordVend) coordVend.value = '';
        if (coordPct)  coordPct.value  = '100';
        await Promise.all([ cargarFoliosParaCompartir(), cargarFoliosAsignados() ]);
      } catch(err) {
        const msgEl2 = document.getElementById('coordMensaje');
        if (msgEl2) { msgEl2.textContent = `❌ ${err.message}`; msgEl2.style.color = 'var(--color-danger)'; }
      }
    });
  }

  async function cargarFoliosParaCompartir() {
    try {
      const res  = await fetch(`${API}/compartir/lista?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      const sel  = document.getElementById('coordFolio');
      if (!sel) return;
      if (!data.ok || !data.folios?.length) {
        sel.innerHTML = '<option value="">— Sin folios disponibles —</option>'; return;
      }
      sel.innerHTML = '<option value="">— Selecciona un folio —</option>' +
        data.folios.map(f =>
          `<option value="${f.Folio}">${f.Folio} — ${f.cliente||'?'} — ${formatCLP(f.monto)}</option>`
        ).join('');
    } catch(err) { console.error('[cargarFoliosParaCompartir]', err); }
  }

  function opcionesVendedores(seleccionado) {
    return todosVendedores.map(v =>
      `<option value="${v.cod}" ${v.cod === seleccionado ? 'selected' : ''}>${v.cod} — ${v.nombre||'Sin nombre'}</option>`
    ).join('');
  }

  function filaAsignadoVista(c) {
    return `
      <td><strong>${c.folio}</strong></td>
      <td>${c.fecha ? new Date(c.fecha).toLocaleDateString('es-CL') : '—'}</td>
      <td>${c.cliente||'—'}</td>
      <td>${c.nombre_vendedor_compartido||c.cod_vendedor_compartido||'—'}</td>
      <td style="text-align:right">${c.porcentaje}%</td>
      <td style="text-align:right">${formatCLP(c.monto_asignado)}</td>
      <td>
        <div class="crud-acciones">
          <button class="btn-crud btn-crud--edit" title="Editar"   data-id="${c.id}">&#9998;</button>
          <button class="btn-crud btn-crud--del"  title="Eliminar" data-id="${c.id}" data-folio="${c.folio}">&times;</button>
        </div>
      </td>`;
  }

  function filaAsignadoEdicion(c) {
    return `
      <td><strong>${c.folio}</strong></td>
      <td>${c.fecha ? new Date(c.fecha).toLocaleDateString('es-CL') : '—'}</td>
      <td>${c.cliente||'—'}</td>
      <td>
        <select class="crud-input-select" id="editVend_${c.id}">
          <option value="">— Selecciona —</option>
          ${opcionesVendedores(c.cod_vendedor_compartido)}
        </select>
      </td>
      <td style="text-align:right">
        <input class="crud-input-pct" type="number" id="editPct_${c.id}" min="1" max="100" value="${c.porcentaje}" />
      </td>
      <td style="text-align:right">${formatCLP(c.monto_asignado)}</td>
      <td>
        <div class="crud-acciones">
          <button class="btn-crud btn-crud--save"   title="Guardar"  data-id="${c.id}" data-folio="${c.folio}">✓</button>
          <button class="btn-crud btn-crud--cancel" title="Cancelar" data-id="${c.id}">✕</button>
        </div>
      </td>`;
  }

  async function cargarFoliosAsignados() {
    try {
      const res   = await fetch(`${API}/asignados?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data  = await res.json();
      const tbody = document.getElementById('tbodyAsignados');
      if (!tbody) return;
      setText('totalAsignados', `${(data.asignados||[]).length} registros`);
      if (!data.ok || !data.asignados?.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="7">Sin folios asignados este mes</td></tr>'; return;
      }
      tbody.innerHTML = data.asignados.map(c => `<tr data-id="${c.id}">${filaAsignadoVista(c)}</tr>`).join('');
      bindCrudEvents(tbody, data.asignados);
    } catch(err) { console.error('[cargarFoliosAsignados]', err); }
  }

  function bindCrudEvents(tbody, asignados) {
    tbody.querySelectorAll('.btn-crud--edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const c  = asignados.find(a => String(a.id) === String(id));
        const tr = tbody.querySelector(`tr[data-id="${id}"]`);
        if (!c || !tr) return;
        tr.innerHTML = filaAsignadoEdicion(c);
        bindCrudEvents(tbody, asignados);
      });
    });
    tbody.querySelectorAll('.btn-crud--save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id      = btn.dataset.id;
        const vendSel = document.getElementById(`editVend_${id}`)?.value;
        const pctSel  = document.getElementById(`editPct_${id}`)?.value;
        if (!vendSel || !pctSel) { alert('Selecciona vendedor y porcentaje'); return; }
        try {
          const res  = await fetch(`${API}/compartir/${id}`, {
            method:'PUT',
            headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token()}` },
            body: JSON.stringify({ cod_vendedor_compartido: vendSel, porcentaje: Number(pctSel) })
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);
          await cargarFoliosAsignados();
        } catch(err) { alert(`Error al guardar: ${err.message}`); }
      });
    });
    tbody.querySelectorAll('.btn-crud--cancel').forEach(btn => {
      btn.addEventListener('click', async () => { await cargarFoliosAsignados(); });
    });
    tbody.querySelectorAll('.btn-crud--del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id    = btn.dataset.id;
        const folio = btn.dataset.folio;
        if (!confirm(`¿Eliminar asignación del folio ${folio}? El folio volverá a estar disponible.`)) return;
        try {
          const res  = await fetch(`${API}/compartir/${id}`, { method:'DELETE', headers:{ Authorization:`Bearer ${token()}` } });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);
          await Promise.all([ cargarFoliosParaCompartir(), cargarFoliosAsignados() ]);
        } catch(err) { alert(`Error al eliminar: ${err.message}`); }
      });
    });
  }

  // ── PANEL FOLIOS RECIBIDOS ────────────────────────────────────────────────
  async function iniciarPanelCompartidos() {
    setStyle('panelCompartidos', 'display', 'block');
    setStyle('panelCoordinador', 'display', 'none');
    await cargarFoliosCompartidos();
  }

  async function cargarFoliosCompartidos() {
    try {
      const res   = await fetch(`${API}/compartidos?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data  = await res.json();
      const tbody = document.getElementById('tbodyCompartidos');
      if (!tbody) return;
      setText('totalCompartidos', `${(data.compartidos||[]).length} registros`);
      if (!data.ok || !data.compartidos?.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin folios asignados este mes</td></tr>'; return;
      }
      tbody.innerHTML = data.compartidos.map(c => `
        <tr>
          <td><strong>${c.folio}</strong></td>
          <td>${c.fecha ? new Date(c.fecha).toLocaleDateString('es-CL') : '—'}</td>
          <td>${c.cliente||'—'}</td>
          <td>${c.coordinador||c.cod_vendedor_principal||'—'}</td>
          <td style="text-align:right">${c.porcentaje}%</td>
          <td style="text-align:right">${formatCLP(c.monto_asignado)}</td>
        </tr>`).join('');
    } catch(err) { console.error('[cargarFoliosCompartidos]', err); }
  }

  // ── Cargar todo ───────────────────────────────────────────────────────────
  async function cargarTodo(usuario) {
    mostrarCarga();
    try {
      await (esCoordinador(usuario)
        ? Promise.all([ cargarFoliosParaCompartir(), cargarFoliosAsignados() ])
        : cargarFoliosCompartidos());
    } catch(err) {
      console.error('[cargarTodo]', err);
    } finally {
      ocultarCarga();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    const usuario = await verificarSesion();
    if (!usuario) return;
    cargarSidebar(usuario);
    initSelectores();

    if (esCoordinador(usuario)) await iniciarPanelCoordinador();
    else                        await iniciarPanelCompartidos();

    const btnAct = document.getElementById('btnActualizar');
    if (btnAct) btnAct.addEventListener('click', () => cargarTodo(usuario));

    cargarTodo(usuario);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
