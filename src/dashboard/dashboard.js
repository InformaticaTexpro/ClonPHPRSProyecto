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

  let graficoEvolucion  = null;
  let todosVendedores   = [];

  let carteraData = { activos: [], inactivos: [], recuperados: [] };
  let carteraRendered = { activo: false, inactivo: false, recuperado: false };

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
    { nombre:'Ventas',        icon:'📊', url:'../ventas/index.html',       area:['ventas','gerencia'] },
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

  // ── KPIs ──────────────────────────────────────────────────────────────────
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

  // ── Gráfico ───────────────────────────────────────────────────────────────
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

  // ── Tabla vendedores ──────────────────────────────────────────────────────
  async function cargarVendedores() {
    try {
      const res  = await fetch(`${API}/vendedores?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      const tbody = document.getElementById('tbodyVendedores');
      if (!tbody) return;
      if (!data.ok || !data.vendedores.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin datos</td></tr>'; return;
      }
      tbody.innerHTML = data.vendedores.map(v => {
        const totalVentasCobrado = Number(v.totalVentasCobrado || 0);
        const ventaRealLista     = Number(v.ventaRealLista     || 0);
        const pctDescuento       = Number(v.pctDescuento       || 0);
        return `
        <tr>
          <td><strong>${v.codVendedor}</strong></td>
          <td>${v.nombreVendedor || '—'}</td>
          <td>${v.totalFolios}</td>
          <td style="text-align:right">${formatCLP(totalVentasCobrado)}</td>
          <td style="text-align:right">${formatCLP(ventaRealLista)}</td>
          <td style="text-align:right">${pctDescuento > 0 ? pctDescuento + '%' : '—'}</td>
        </tr>`;
      }).join('');
    } catch (err) { console.error('[cargarVendedores]', err); }
  }

  // ── Tabla ventas del mes ──────────────────────────────────────────────────
  let ventasMesData = [];

  async function cargarVentasMes() {
    try {
      const res  = await fetch(`${API}/ventas-mes?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      ventasMesData = data.ventas || [];
      poblarFiltroVendedor(ventasMesData);
      aplicarFiltrosVentasMes();
    } catch (err) { console.error('[cargarVentasMes]', err); }
  }

  function poblarFiltroVendedor(lista) {
    const sel = document.getElementById('filtroVendedorVentas');
    if (!sel) return;
    const codigos = [...new Set(lista.map(v => v.CodVendedor).filter(Boolean))].sort();
    const actual = filtroVendedorActivo;
    sel.innerHTML = '<option value="">Todos los vendedores</option>' +
      codigos.map(c => `<option value="${c}"${c === actual ? ' selected' : ''}>${c}</option>`).join('');
    if (actual && !codigos.includes(actual)) filtroVendedorActivo = '';
  }

  function aplicarFiltrosVentasMes() {
    const q        = (document.getElementById('busquedaVentas')?.value || '').toLowerCase();
    const vendedor = filtroVendedorActivo;
    const tipos    = tiposActivos;

    const lista = ventasMesData.filter(v => {
      if (q && !String(v.Folio||'').toLowerCase().includes(q) && !String(v.cliente||'').toLowerCase().includes(q)) return false;
      if (vendedor && v.CodVendedor !== vendedor) return false;
      if (v.Tipo && !tipos.has(v.Tipo)) return false;
      return true;
    });

    renderVentasMes(lista);
  }

  function renderVentasMes(lista) {
    const tbody = document.getElementById('tbodyVentasMes');
    if (!tbody) return;
    setText('totalVentasMes', `${lista.length.toLocaleString('es-CL')} registros`);
    if (!lista.length) { tbody.innerHTML = '<tr class="tabla-empty"><td colspan="7">Sin registros</td></tr>'; return; }
    tbody.innerHTML = lista.map(v => {
      const pctDesc      = v.pct_descuento > 0 ? `${v.pct_descuento}%` : '—';
      const montoMostrar = v.es_compartido && v.monto_asignado != null ? v.monto_asignado : v.monto;
      const badgeComp    = v.es_compartido
        ? `<span style="font-size:.7rem;background:#00E2A7;color:#000;border-radius:4px;padding:1px 5px;margin-left:4px">Compartido ${v.porcentaje_asignado?v.porcentaje_asignado+'%':''}</span>`
        : '';
      return `<tr>
        <td><strong>${v.Folio||'—'}</strong>${badgeComp}</td>
        <td>${v.fecha_formato||'—'}</td>
        <td>${v.cliente||'—'}</td>
        <td>${v.CodVendedor||'—'}</td>
        <td style="text-align:right">${formatCLP(montoMostrar)}</td>
        <td style="text-align:right">${pctDesc}</td>
        <td style="text-align:center">
          <button class="btn-detalle" data-folio="${v.Folio}" title="Ver detalle">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('.btn-detalle').forEach(btn =>
      btn.addEventListener('click', () => abrirDetalle(btn.dataset.folio))
    );
  }

  // ── Modal detalle folio ───────────────────────────────────────────────────
  async function abrirDetalle(folio) {
    const overlay = document.getElementById('modalOverlay');
    const tbody   = document.getElementById('modalTbody');
    if (!overlay || !tbody) return;
    setText('modalTitulo', `Folio N° ${folio}`);
    const venta = ventasMesData.find(v => String(v.Folio) === String(folio));
    setText('modalSubtitulo', venta ? `${venta.cliente||''} • ${venta.fecha_formato||''}` : '');
    setText('modalTotalValor', '—');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem">Cargando...</td></tr>';
    overlay.classList.add('modal-overlay--visible');
    overlay.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    try {
      const res  = await fetch(`${API}/detalle/${folio}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--color-danger)">⚠️ Error</td></tr>'; return; }
      if (!data.detalle?.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Sin líneas</td></tr>'; return; }
      const total = data.detalle.reduce((s,l)=>s+(Number(l.valor_historico_linea)||0),0);
      tbody.innerHTML = data.detalle.map(l=>`
        <tr>
          <td><code>${l.CodProd||'—'}</code></td>
          <td>${l.DesProd||'—'}</td>
          <td style="text-align:center">${l.CantFacturada??'—'}</td>
          <td style="text-align:right">${formatCLP(l.precio_unitario_historico)}</td>
          <td style="text-align:right"><strong>${formatCLP(l.valor_historico_linea)}</strong></td>
        </tr>`).join('');
      setText('modalTotalValor', formatCLP(total));
    } catch(err) { console.error('[abrirDetalle]',err); tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--color-danger)">⚠️ Error</td></tr>'; }
  }

  function cerrarModal() {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    overlay.classList.remove('modal-overlay--visible');
    overlay.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  // ── CARTERA DE CLIENTES ───────────────────────────────────────────────────
  async function cargarCartera() {
    try {
      const res  = await fetch(API_CART, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error cartera');

      carteraData.activos     = data.activos     || [];
      carteraData.inactivos   = data.inactivos   || [];
      carteraData.recuperados = data.recuperados || [];

      carteraRendered = { activo: false, inactivo: false, recuperado: false };

      setText('countActivo',     String(carteraData.activos.length));
      setText('countInactivo',   String(carteraData.inactivos.length));
      setText('countRecuperado', String(carteraData.recuperados.length));

      ['activo', 'inactivo', 'recuperado'].forEach(tipo => {
        const lista = document.getElementById(`lista${capitalize(tipo)}`);
        if (lista && !lista.hidden) renderCartaTipo(tipo);
      });
    } catch (err) {
      console.error('[cargarCartera]', err);
      setText('countActivo',     '—');
      setText('countInactivo',   '—');
      setText('countRecuperado', '—');
    }
  }

  function renderCartaTipo(tipo, filtro) {
    const q = (filtro || '').toLowerCase();
    const filtrarLista = (lista) => q
      ? lista.filter(c =>
          (c.CodAux  || '').toLowerCase().includes(q) ||
          (c.NomAux  || '').toLowerCase().includes(q) ||
          (c.EMail   || '').toLowerCase().includes(q) ||
          (c.FONAUX1 || '').toLowerCase().includes(q) ||
          (c.FonAux2 || '').toLowerCase().includes(q))
      : lista;

    if (tipo === 'activo')          renderTablaCartera('tbodyActivo',     filtrarLista(carteraData.activos),     'Sin clientes activos');
    else if (tipo === 'inactivo')   renderTablaCartera('tbodyInactivo',   filtrarLista(carteraData.inactivos),   'Sin clientes inactivos');
    else if (tipo === 'recuperado') renderTablaCartera('tbodyRecuperado', filtrarLista(carteraData.recuperados), 'Sin clientes recuperados');
    carteraRendered[tipo] = true;
  }

  function renderTablaCartera(tbodyId, lista, mensajeVacio) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!lista.length) { tbody.innerHTML = `<tr class="tabla-empty"><td colspan="5">${mensajeVacio}</td></tr>`; return; }
    tbody.innerHTML = lista.map(c => {
      const emailHtml = c.EMail
        ? `<a href="mailto:${c.EMail}" style="color:var(--color-primary);text-decoration:none" title="${c.EMail}">${c.EMail}</a>`
        : '—';
      const tel1Html = c.FONAUX1
        ? `<a href="tel:${c.FONAUX1}" style="color:var(--color-primary);text-decoration:none">${c.FONAUX1}</a>`
        : '—';
      const tel2Html = c.FonAux2
        ? `<a href="tel:${c.FonAux2}" style="color:var(--color-primary);text-decoration:none">${c.FonAux2}</a>`
        : '—';
      return `<tr>
          <td><code>${c.CodAux||'—'}</code></td>
          <td>${c.NomAux||'—'}</td>
          <td>${tel1Html}</td>
          <td>${tel2Html}</td>
          <td>${emailHtml}</td>
        </tr>`;
    }).join('');
  }

  function initCarteraCards() {
    document.querySelectorAll('.cartera-card-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo  = btn.dataset.tipo;
        const lista = document.getElementById(`lista${capitalize(tipo)}`);
        if (!lista) return;
        const abierto = !lista.hidden;
        if (abierto) {
          lista.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
          btn.closest('.cartera-card').classList.remove('cartera-card--abierta');
        } else {
          lista.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          btn.closest('.cartera-card').classList.add('cartera-card--abierta');
          if (!carteraRendered[tipo]) renderCartaTipo(tipo);
        }
      });
    });

    const bActivo = document.getElementById('busquedaActivo');
    if (bActivo) bActivo.addEventListener('input', e => renderCartaTipo('activo', e.target.value));
    const bInactivo = document.getElementById('busquedaInactivo');
    if (bInactivo) bInactivo.addEventListener('input', e => renderCartaTipo('inactivo', e.target.value));
    const bRecup = document.getElementById('busquedaRecuperado');
    if (bRecup) bRecup.addEventListener('input', e => renderCartaTipo('recuperado', e.target.value));
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

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
        await Promise.all([ cargarFoliosParaCompartir(), cargarFoliosAsignados(), cargarResumen(), cargarVentasMes() ]);
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
    } catch(err) { console.error('[cargarFoliosParaCompartir]',err); }
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
          <button class="btn-crud btn-crud--edit" title="Editar" data-id="${c.id}">&#9998;</button>
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
          <button class="btn-crud btn-crud--save"   title="Guardar" data-id="${c.id}" data-folio="${c.folio}">✓</button>
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
    } catch(err) { console.error('[cargarFoliosAsignados]',err); }
  }

  function bindCrudEvents(tbody, asignados) {
    tbody.querySelectorAll('.btn-crud--edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const id  = btn.dataset.id;
        const c   = asignados.find(a => String(a.id) === String(id));
        const tr  = tbody.querySelector(`tr[data-id="${id}"]`);
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
          await Promise.all([ cargarFoliosParaCompartir(), cargarFoliosAsignados(), cargarResumen(), cargarVentasMes() ]);
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
    } catch(err) { console.error('[cargarFoliosCompartidos]',err); }
  }

  // ── VENTAS DETALLE (migrado de ventas.js) ──────────────────────────────────
  const API_VENTAS   = '/api/ventas';
  const POR_PAGINA_V = 20;

  const estadoV = {
    ventas:          [],
    ventasFiltradas: [],
    paginaActual:    1,
    sortCol:         'fecha_formato',
    sortDir:         'desc',
  };

  function formatPct(v) {
    if (v == null || v === '') return '—';
    const n = Number(v);
    if (isNaN(n)) return '—';
    return n.toFixed(2) + '%';
  }

  // Tabla vendedores enriquecida con barras de progreso y badges de descuento
  async function cargarVendedoresDetalle() {
    try {
      const res  = await fetch(`${API_VENTAS}/resumen-vendedores?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (data.ok) renderTablaVendedoresDetalle(data.vendedores);
    } catch(err) { console.error('[cargarVendedoresDetalle]', err); }
  }

  function renderTablaVendedoresDetalle(vendedores) {
    const tbody = document.getElementById('tbodyVendedoresDetalle');
    if (!tbody) return;
    if (!vendedores || !vendedores.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin datos para el período seleccionado</td></tr>';
      return;
    }
    const maxCobrado = Math.max(...vendedores.map(v => Number(v.totalVentasCobrado) || 0), 1);
    tbody.innerHTML = vendedores.map(v => {
      const cobrado = Number(v.totalVentasCobrado) || 0;
      const lista   = Number(v.ventaRealLista)     || 0;
      const pct     = Number(v.pctDescuento)       || 0;
      const descAbs = lista - cobrado;
      const barPct  = Math.round((cobrado / maxCobrado) * 100);
      const badgeBg    = pct > 15 ? 'rgba(220,53,69,0.12)'  : pct > 5 ? 'rgba(245,166,35,0.12)'  : 'rgba(0,200,140,0.12)';
      const badgeColor = pct > 15 ? '#dc3545'               : pct > 5 ? '#b07000'                : '#00885a';
      const badgeBorder= pct > 15 ? 'rgba(220,53,69,0.35)'  : pct > 5 ? 'rgba(245,166,35,0.35)' : 'rgba(0,200,140,0.35)';
      return `
        <tr>
          <td><span style="display:inline-block;background:var(--color-bg-offset,#f3f4f6);color:var(--color-text,#1a1a2e);font-weight:700;font-size:0.8rem;padding:2px 9px;border-radius:4px;letter-spacing:0.04em">${v.codVendedor||'—'}</span></td>
          <td>${v.nombreVendedor||'—'}</td>
          <td style="text-align:center">${v.totalFolios||0}</td>
          <td style="text-align:right">
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
              <span>${formatCLP(cobrado)}</span>
              <div style="width:100%;max-width:90px;height:4px;background:rgba(0,0,0,0.08);border-radius:2px;overflow:hidden">
                <div style="width:${barPct}%;height:100%;background:var(--color-primary,#00E2A7);border-radius:2px"></div>
              </div>
            </div>
          </td>
          <td style="text-align:right">${formatCLP(lista)}</td>
          <td style="text-align:right">
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
              <span style="display:inline-block;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};font-weight:600;font-size:0.78rem;padding:2px 8px;border-radius:20px">${formatPct(pct)}</span>
              <span style="font-size:0.72rem;color:var(--color-text-muted,#6b7280)">${formatCLP(descAbs)}</span>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // Tabla ventas detalle paginada y ordenable
  function sortVentasDetalle(arr) {
    return [...arr].sort((a, b) => {
      let va = a[estadoV.sortCol] ?? '';
      let vb = b[estadoV.sortCol] ?? '';
      if (!isNaN(Number(va)) && !isNaN(Number(vb))) { va = Number(va); vb = Number(vb); }
      if (va < vb) return estadoV.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return estadoV.sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  function aplicarFiltrosVentasDetalle() {
    const codVend  = (document.getElementById('filtroVendedorDetalle')?.value || '').trim();
    const busqueda = (document.getElementById('tablaVentasBusqueda')?.value  || '').toLowerCase().trim();
    let datos = estadoV.ventas;
    if (codVend)  datos = datos.filter(v => String(v.CodVendedor||'').trim() === codVend);
    if (busqueda) datos = datos.filter(v =>
      String(v.Folio||'').toLowerCase().includes(busqueda) ||
      String(v.cliente||'').toLowerCase().includes(busqueda) ||
      String(v.CodVendedor||'').toLowerCase().includes(busqueda)
    );
    estadoV.ventasFiltradas = datos;
    estadoV.paginaActual    = 1;
    renderTablaVentasDetalle();
  }

  function renderTablaVentasDetalle() {
    const tbody = document.getElementById('ventasTbody');
    if (!tbody) return;
    const datos  = sortVentasDetalle(estadoV.ventasFiltradas);
    const total  = datos.length;
    const inicio = (estadoV.paginaActual - 1) * POR_PAGINA_V;
    const pagina = datos.slice(inicio, inicio + POR_PAGINA_V);
    setText('tablaVentasTotal', `${total.toLocaleString('es-CL')} registros`);
    if (!pagina.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="7">Sin resultados</td></tr>';
      renderPaginacionVentas(0); return;
    }
    tbody.innerHTML = pagina.map(v => `
      <tr>
        <td><strong>${v.Folio||'—'}</strong></td>
        <td>${v.fecha_formato||'—'}</td>
        <td>${v.cliente||'—'}</td>
        <td>${v.CodVendedor||'—'}</td>
        <td style="text-align:right">${formatCLP(v.monto)}</td>
        <td style="text-align:right">${formatCLP(v.descuento)}</td>
        <td style="text-align:center">
          <button class="btn-detalle" data-folio="${v.Folio}" title="Ver detalle">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.btn-detalle').forEach(btn =>
      btn.addEventListener('click', () => abrirDetalleVentas(btn.dataset.folio))
    );
    renderPaginacionVentas(total);
  }

  function renderPaginacionVentas(total) {
    const paginacion = document.getElementById('paginacionVentas');
    if (!paginacion) return;
    const totalPags = Math.ceil(total / POR_PAGINA_V);
    if (totalPags <= 1) { paginacion.innerHTML = ''; return; }
    let html = `<button ${estadoV.paginaActual === 1 ? 'disabled' : ''} data-pag="prev">&lsaquo;</button>`;
    for (let i = 1; i <= totalPags; i++)
      html += `<button class="${i === estadoV.paginaActual ? 'active' : ''}" data-pag="${i}">${i}</button>`;
    html += `<button ${estadoV.paginaActual === totalPags ? 'disabled' : ''} data-pag="next">&rsaquo;</button>`;
    paginacion.innerHTML = html;
    paginacion.querySelectorAll('button').forEach(btn =>
      btn.addEventListener('click', () => {
        const p = btn.dataset.pag;
        if (p === 'prev') estadoV.paginaActual--;
        else if (p === 'next') estadoV.paginaActual++;
        else estadoV.paginaActual = Number(p);
        renderTablaVentasDetalle();
      })
    );
  }

  function initSortVentasDetalle() {
    document.querySelectorAll('.ventas-detalle-tabla th[data-col]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        estadoV.sortDir = estadoV.sortCol === col && estadoV.sortDir === 'asc' ? 'desc' : 'asc';
        estadoV.sortCol = col;
        document.querySelectorAll('.ventas-detalle-tabla th').forEach(t =>
          t.classList.remove('sorted-asc', 'sorted-desc'));
        th.classList.add(`sorted-${estadoV.sortDir}`);
        estadoV.paginaActual = 1;
        renderTablaVentasDetalle();
      });
    });
  }

  async function abrirDetalleVentas(folio) {
    try {
      const res  = await fetch(`${API_VENTAS}/detalle/${folio}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) return;
      const modal  = document.getElementById('modalDetalleVentas');
      const titulo = document.getElementById('modalTituloVentas');
      const cuerpo = document.getElementById('modalCuerpoVentas');
      if (!modal) return;
      titulo.textContent = `Detalle Folio #${folio}`;
      if (!data.detalle || !data.detalle.length) {
        cuerpo.innerHTML = '<p style="text-align:center;color:var(--color-text-muted)">Sin líneas de detalle.</p>';
      } else {
        const cab = data.detalle[0];
        cuerpo.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem 1.5rem;margin-bottom:1.25rem;padding:.75rem;background:var(--color-bg-offset,#f8f8f6);border-radius:8px">
            <div><span style="font-size:.75rem;color:var(--color-text-muted,#6b7280);display:block">Cliente</span><span style="font-weight:600">${cab.cliente||'—'}</span></div>
            <div><span style="font-size:.75rem;color:var(--color-text-muted,#6b7280);display:block">Vendedor</span><span style="font-weight:600">${cab.CodVendedor||'—'}</span></div>
            <div><span style="font-size:.75rem;color:var(--color-text-muted,#6b7280);display:block">Fecha</span><span style="font-weight:600">${cab.fecha_formato||'—'}</span></div>
            <div><span style="font-size:.75rem;color:var(--color-text-muted,#6b7280);display:block">Total Folio</span><span style="font-weight:600">${formatCLP(cab.monto)}</span></div>
          </div>
          <div style="overflow-x:auto">
            <table class="dash-tabla modal-tabla">
              <thead><tr><th>Producto</th><th>Descripción</th><th style="text-align:right">Cant.</th><th style="text-align:right">P. Lista</th><th style="text-align:right">P. Cobrado</th><th style="text-align:right">Desc. %</th><th style="text-align:right">Total Línea</th></tr></thead>
              <tbody>
                ${data.detalle.map(d => `
                  <tr>
                    <td>${d.CodProducto||'—'}</td>
                    <td>${d.descripcion||'—'}</td>
                    <td style="text-align:right">${d.CantFacturada??'—'}</td>
                    <td style="text-align:right">${formatCLP(d.precioLista)}</td>
                    <td style="text-align:right">${formatCLP(d.PrecioUnitario)}</td>
                    <td style="text-align:right">${formatPct(d.pctDescLinea)}</td>
                    <td style="text-align:right">${formatCLP(d.TotLinea)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`;
      }
      modal.classList.add('modal--open');
    } catch(err) { console.error('[abrirDetalleVentas]', err); }
  }

  function cerrarModalVentas() {
    const modal = document.getElementById('modalDetalleVentas');
    if (modal) modal.classList.remove('modal--open');
  }

  function exportarCSV() {
    const datos = estadoV.ventasFiltradas;
    if (!datos.length) return;
    const cabecera = ['Folio','Fecha','Cliente','Vendedor','Monto','Descuento'];
    const filas = datos.map(v => [
      v.Folio, v.fecha_formato, v.cliente, v.CodVendedor, v.monto, v.descuento
    ].map(c => `"${String(c??'').replace(/"/g,'""')}"`).join(','));
    const csv  = [cabecera.join(','), ...filas].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ventas_${getParams().mes}_${getParams().anio}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function cargarVentasDetalleData() {
    try {
      const { mes, anio } = getParams();
      const vendActivo = document.getElementById('filtroVendedorDetalle')?.value || '';
      // Usa GET /api/ventas (raíz) — endpoint correcto para lista de folios del mes
      const res  = await fetch(`${API_VENTAS}?${new URLSearchParams({ mes, anio })}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (data.ok) {
        estadoV.ventas       = data.ventas || [];
        estadoV.paginaActual = 1;
        const sel = document.getElementById('filtroVendedorDetalle');
        if (sel) {
          const codigos = [...new Set(estadoV.ventas.map(v => v.CodVendedor).filter(Boolean))].sort();
          sel.innerHTML = '<option value="">Todos los vendedores</option>' +
            codigos.map(c => `<option value="${c}"${c === vendActivo ? ' selected' : ''}>${c}</option>`).join('');
        }
        aplicarFiltrosVentasDetalle();
      }
    } catch(err) { console.error('[cargarVentasDetalleData]', err); }
  }

  // ── Cargar todo ───────────────────────────────────────────────────────────
  async function cargarTodo(usuario) {
    mostrarCarga();
    try {
      await Promise.all([
        cargarResumen(),
        cargarGrafico(),
        cargarCartera(),
        cargarVendedores(),
        cargarVentasMes(),
        cargarVendedoresDetalle(),
        cargarVentasDetalleData(),
        esCoordinador(usuario)
          ? Promise.all([ cargarFoliosParaCompartir(), cargarFoliosAsignados() ])
          : cargarFoliosCompartidos()
      ]);
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
    document.addEventListener('keydown', e => { if (e.key==='Escape') { cerrarModal(); cerrarModalVentas(); } });
    const btnAct = document.getElementById('btnActualizar');
    if (btnAct) btnAct.addEventListener('click', () => cargarTodo(usuario));

    // Controles sección ventas detalle
    const tablaVentasBusq = document.getElementById('tablaVentasBusqueda');
    if (tablaVentasBusq) tablaVentasBusq.addEventListener('input', aplicarFiltrosVentasDetalle);
    const filtroVendDet = document.getElementById('filtroVendedorDetalle');
    if (filtroVendDet) filtroVendDet.addEventListener('change', aplicarFiltrosVentasDetalle);
    document.getElementById('btnExportarCSV')?.addEventListener('click', exportarCSV);
    document.getElementById('modalCerrarVentas')?.addEventListener('click', cerrarModalVentas);
    const modalVentas = document.getElementById('modalDetalleVentas');
    if (modalVentas) modalVentas.addEventListener('click', e => { if (e.target === e.currentTarget) cerrarModalVentas(); });
    initSortVentasDetalle();

    cargarTodo(usuario);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

