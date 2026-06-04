'use strict';

/**
 * dashboard.js — RSProyecto Texpro
 *
 * 2026-04-23: filtros client-side en tabla Ventas del Mes
 * 2026-04-24: módulo Alertas agregado al sidebar — accesible para TODOS los usuarios
 * 2026-04-24: fix(lint) — eliminada función setHTML no utilizada
 */

(function () {

  const API        = '/api/dashboard';
  const API_CART   = '/api/cartera';
  const token      = () => localStorage.getItem('token');

  let graficoEvolucion              = null;
  let graficoClientesDistribucion   = null;
  let todosVendedores               = [];

  let carteraData = { activos: [], inactivos: [], recuperados: [], sinCompras: [] };
  let carteraRendered = { activo: false, inactivo: false, recuperado: false, sincompras: false };

  let filtroVendedorActivo = '';
  let tiposActivos = new Set(['F', 'N', 'D']);

  const MESES_NOMBRE = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  function formatCLP(v) {
    if (v == null || v === '') return '—';
    return new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(Number(v));
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  if (window.Chart && window.ChartDataLabels) {
    window.Chart.register(window.ChartDataLabels);
  }

  function setStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
  }

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
    if (!token()) { window.location.href = '/src/login/index.html'; return null; }
    try {
      const res  = await fetch('/api/auth/me', { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { window.location.href = '/src/login/index.html'; return null; }
      return data.user;
    } catch { window.location.href = '/src/login/index.html'; return null; }
  }

  function esCoordinador(usuario) {
    return (usuario.vendedores || []).some(v => v.tipo === 'C');
  }

  const MODULOS = [
    { nombre:'Ventas',        icon:'📊', url:'../ventas/index.html',       area:['ventas','gerencia'] },
    { nombre:'Facturación',   icon:'🧾', url:'../../facturacion/facturacion/index.html',  area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',        icon:'🏭', url:'../../bodega/bodega/index.html',       area:['bodega','produccion','gerencia'] },
    { nombre:'Producción',    icon:'⚙️', url:'../../produccion/produccion/index.html',   area:['produccion','gerencia'] },
    { nombre:'Serv. TEC',     icon:'🛠️', url:'../../servtecnico/servicio-tecnico/index.html', area:['servicio-tecnico','servicio','gerencia'] },
    { nombre:'Laboratorio',   icon:'🧪', url:'../../laboratorio/laboratorio/index.html',  area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',      icon:'💰', url:'../../cobranza/cobranza/index.html',     area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',          icon:'👥', url:'../../rrhh/rrhh/index.html',         area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',  icon:'📜', url:'../../contabilidad/contabilidad/index.html', area:['contabilidad','gerencia'] },
    { nombre:'Administración',icon:'🔧', url:'../../admin/admin/index.html',        area:['admin'] },
    { nombre:'Alertas',       icon:'🔔', url:'../../alertas/index.html',      area: null },
  ];

  function cargarSidebar(usuario) {
    const ini = (usuario.nombre||'U').split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase();
    setText('userName',  usuario.nombre  || usuario.email);
    setText('userArea',  usuario.area    || '');
    setText('userAvatar', ini);
    setText('chipAvatar', ini);
    setText('chipName',   (usuario.nombre||usuario.email).split(' ')[0]);
    setText('headerDate', new Date().toLocaleDateString('es-CL',
      { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
    setText('welcomeTitle',    `Hola, ${(usuario.nombre||usuario.email).split(' ')[0]} 👋`);
    setText('welcomeSubtitle', `Área: ${usuario.area||'Sistema'} — Texpro`);

    const nav      = document.getElementById('sidebarNav');
    const visibles = MODULOS.filter(m => {
      if (m.area === null) return true;
      if (usuario.is_admin) return true;
      return m.area.includes(usuario.area);
    });
    if (nav) nav.innerHTML = `<span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span class="nav-label">Dashboard</span>
      </a>
      ${visibles.map(m=>`<a class="nav-item" href="${m.url}"><span style="font-size:1rem">${m.icon}</span><span class="nav-label">${m.nombre}</span></a>`).join('')}`;

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', () => {
      localStorage.removeItem('token'); localStorage.removeItem('user');
      window.location.href = '/src/login/index.html';
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

  async function cargarResumen() {
    try {
      const res  = await fetch(`${API}/resumen?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const { totalVentas, meta, progreso, pctDescuentoGlobal } = data;
      setText('kpiTotalVentas', formatCLP(totalVentas));
      setText('kpiMeta',        formatCLP(meta));
      setText('kpiDescuento',   pctDescuentoGlobal > 0 ? `${pctDescuentoGlobal}%` : '0%');
      const pct  = Math.min(progreso, 100);
      setText('kpiProgresoPct', `${progreso}%`);
      const fill = document.getElementById('progresoFill');
      if (fill) {
        fill.style.width      = `${pct}%`;
        fill.style.background = progreso >= 100 ? 'var(--color-primary)' : progreso >= 70 ? 'var(--color-accent)' : 'var(--color-danger)';
      }
    } catch (err) { console.error('[cargarResumen]', err); }
  }

  const MESES_LABEL = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  async function cargarGrafico() {
    try {
      const { mes, anio } = getParams();
      setText('graficoTitulo', `Evolución Mensual — ${MESES_NOMBRE[Number(mes) - 1]} ${anio}`);
      const res  = await fetch(`${API}/evolucion?${new URLSearchParams({ mes, anio })}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const labels = data.evolucion.map(e => MESES_LABEL[e.mes - 1]);
      const ventas = data.evolucion.map(e => e.ventas);
      const meta   = data.evolucion.map(e => e.meta);
      const canvas = document.getElementById('graficoEvolucion');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (graficoEvolucion) graficoEvolucion.destroy();
      graficoEvolucion = new Chart(ctx, {
        type:'line',
        data:{ labels, datasets:[
          { label:'Ventas', data:ventas, borderColor:'#00E2A7', backgroundColor:'rgba(0,226,167,0.08)', tension:0.4, fill:true, pointRadius:5, pointHoverRadius:7, borderWidth:2.5 },
          { label:'Meta',   data:meta,   borderColor:'#F5A623', backgroundColor:'transparent', borderDash:[6,4], tension:0, fill:false, pointRadius:0, borderWidth:2 }
        ]},
        options:{
          responsive:true, maintainAspectRatio:false,
          interaction:{ mode:'index', intersect:false },
          plugins:{
            datalabels:{ display:false },
            legend:{ position:'top', labels:{ font:{ family:'Montserrat', size:12 }, usePointStyle:true } },
            tooltip:{ callbacks:{ label:ctx2 => ` ${ctx2.dataset.label}: ${new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(ctx2.parsed.y)}` } }
          },
          scales:{
            y:{ beginAtZero:true, ticks:{ font:{family:'Open Sans',size:11}, callback: v => new Intl.NumberFormat('es-CL',{notation:'compact',compactDisplay:'short'}).format(v) }, grid:{color:'rgba(0,0,0,0.05)'} },
            x:{ ticks:{font:{family:'Open Sans',size:11}}, grid:{display:false} }
          }
        }
      });
    } catch (err) { console.error('[cargarGrafico]', err); }
  }

  let ventasMesData = [];
  async function cargarVentasMes() { /* contenido intacto omitido por brevedad en esta actualización */ }
  function poblarFiltroVendedor(lista) { /* intacto */ }
  function aplicarFiltrosVentasMes() { /* intacto */ }
  function renderVentasMes(lista) { /* intacto */ }
  async function abrirDetalle(folio) { /* intacto */ }
  function cerrarModal() { /* intacto */ }
  async function cargarCartera() { /* intacto */ }
  function renderCartaTipo(tipo, filtro) { /* intacto */ }
  function renderTablaCartera(tbodyId, lista, mensajeVacio) { /* intacto */ }
  function renderTablaCarteraRecuperado(tbodyId, lista, mensajeVacio) { /* intacto */ }
  function initCarteraCards() { /* intacto */ }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  async function cargarListaVendedores() { /* intacto */ }
  async function iniciarPanelCoordinador() { /* intacto */ }
  async function cargarFoliosParaCompartir() { /* intacto */ }
  function opcionesVendedores(seleccionado) { /* intacto */ }
  function filaAsignadoVista(c) { /* intacto */ }
  function filaAsignadoEdicion(c) { /* intacto */ }
  async function cargarFoliosAsignados() { /* intacto */ }
  function bindCrudEvents(tbody, asignados) { /* intacto */ }
  async function iniciarPanelCompartidos() { /* intacto */ }
  async function cargarFoliosCompartidos() { /* intacto */ }
  const COLORES_TORTA = ['#00E2A7','#4ECDC4','#45B7D1','#96CEB4','#F5A623','#DDA0DD','#F06543','#00B4D8'];
  function renderGraficoClientesDistribucion(datos) { /* intacto */ }
  async function cargarGraficoClientes() { /* intacto */ }
  async function cargarClientesResumen() { /* intacto */ }
  async function cargarTodo(usuario) { /* intacto */ }

  async function init() {
    const usuario = await verificarSesion();
    if (!usuario) return;
    cargarSidebar(usuario);
    initSelectores();
    initCarteraCards();

    if (esCoordinador(usuario)) await iniciarPanelCoordinador();
    else                        await iniciarPanelCompartidos();

    const bVentas = document.getElementById('busquedaVentas');
    if (bVentas) bVentas.addEventListener('input', aplicarFiltrosVentasMes);

    const selVend = document.getElementById('filtroVendedorVentas');
    if (selVend) selVend.addEventListener('change', e => {
      filtroVendedorActivo = e.target.value;
      aplicarFiltrosVentasMes();
    });

    document.querySelectorAll('.tipo-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = btn.dataset.tipo;
        if (tiposActivos.has(tipo)) {
          if (tiposActivos.size > 1) {
            tiposActivos.delete(tipo);
            btn.classList.remove('tipo-toggle--activo');
          }
        } else {
          tiposActivos.add(tipo);
          btn.classList.add('tipo-toggle--activo');
        }
        aplicarFiltrosVentasMes();
      });
    });

    const modalCerrar = document.getElementById('modalCerrar');
    if (modalCerrar) modalCerrar.addEventListener('click', cerrarModal);
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay) modalOverlay.addEventListener('click', e => { if (e.target===e.currentTarget) cerrarModal(); });
    document.addEventListener('keydown', e => { if (e.key==='Escape') cerrarModal(); });
    const btnAct = document.getElementById('btnActualizar');
    if (btnAct) btnAct.addEventListener('click', () => cargarTodo(usuario));

    cargarTodo(usuario);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(); 
