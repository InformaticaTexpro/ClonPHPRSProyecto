'use strict';

/**
 * ventas.js — Ventas Asignadas Texpro
 *
 * 2026-06-15: fix — nombres sidebar estandarizados:
 *   Dashboard | Ventas Asignadas (activo) | Historial Cliente | Alertas
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
    if (!token()) { window.location.href = '../../varios/login/index.html'; return null; }
    try {
      const res  = await fetch('/api/auth/me', { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { window.location.href = '../../varios/login/index.html'; return null; }
      return data.user;
    } catch { window.location.href = '../../varios/login/index.html'; return null; }
  }

  function esCoordinador(usuario) {
    return (usuario.vendedores || []).some(v => v.tipo === 'C');
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
  // Nombres estándar en todos los módulos del área ventas:
  //   Dashboard | Ventas Asignadas | Historial Cliente | Alertas
  const MODULOS = [
    { nombre:'Dashboard',           icon:'🏠', url:'../dashboard/index.html',                       area: null },
    { nombre:'Historial Cliente',   icon:'📋', url:'../historial-cliente/index.html',               area:['ventas','gerencia'] },
    { nombre:'Facturación',         icon:'🧾', url:'../../facturacion/facturacion/index.html',      area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',              icon:'🏭', url:'../../bodega/bodega/index.html',                area:['bodega','produccion','gerencia'] },
    { nombre:'Producción',          icon:'⚙️', url:'../../produccion/produccion/index.html',        area:['produccion','gerencia'] },
    { nombre:'Serv. TEC',           icon:'🛠️', url:'../../servtecnico/servicio-tecnico/index.html', area:['servicio-tecnico','servicio','gerencia'] },
    { nombre:'Laboratorio',         icon:'🧪', url:'../../laboratorio/laboratorio/index.html',      area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',            icon:'💰', url:'../../cobranza/cobranza/index.html',             area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',                icon:'👥', url:'../../rrhh/rrhh/index.html',                    area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',        icon:'📜', url:'../../contabilidad/contabilidad/index.html',    area:['contabilidad','gerencia'] },
    { nombre:'Administración',      icon:'🔧', url:'../../admin/admin/index.html',                  area:['admin'] },
    { nombre:'Alertas',             icon:'🔔', url:'../../varios/alertas/index.html',               area: null },
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

    // SVG de gráfico de barras para el ítem activo (Ventas Asignadas)
    const svgVentas = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;

    if (nav) nav.innerHTML = `<span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">
        ${svgVentas}
        <span class="nav-label">Ventas Asignadas</span>
      </a>
      ${visibles.map(m=>`<a class="nav-item" href="${m.url}"><span style="font-size:1rem">${m.icon}</span><span class="nav-label">${m.nombre}</span></a>`).join('')}`;

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
      btnLogout.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '../../varios/login/index.html';
      });
    }
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper').classList.toggle('main-wrapper--expanded');
    });
    document.getElementById('headerMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('mobile-open');
    });
  }
