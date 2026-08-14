'use strict';

/**
 * dashboard.js — RSProyecto Texpro
 *
 * 2026-04-23: filtros client-side en tabla Ventas del Mes
 * 2026-04-24: módulo Alertas agregado al sidebar
 * 2026-04-24: fix(lint) — eliminada función setHTML no utilizada
 * 2026-06-04: fix — ruta alertas corregida a ../../alertas/index.html
 * 2026-06-08: fix — todas las rutas del sidebar corregidas a nueva estructura anidada
 * 2026-06-08: fix — eliminadas funciones del Panel Coordinador
 * 2026-06-08: feat — cartera: eliminadas cards Activos/Recuperados/SinCompras;
 *                    agregada card Activos Mes Actual (fija al mes real del servidor)
 * 2026-06-09: fix — agrega enlace Historial Cliente al sidebar
 * 2026-06-10: feat — cartera: 5 KPIs desde /api/cartera (Total, Activos, Inactivos, Nuevos,
 *                    Recuperados); elimina lista-KPI redundante del HTML
 * 2026-06-11: fix — descuentos redondeados (sin decimales) en KPI global,
 *                    tabla vendedores y tabla ventas del mes
 * 2026-06-15: fix — sidebar estandarizado: Ventas → Ventas Asignadas, Historial → Historial Cliente
 */

(function () {

  const API        = '/api/dashboard';
  const API_CART   = '/api/cartera';
  const token      = () => localStorage.getItem('token');

  let graficoEvolucion              = null;
  let graficoClientesDistribucion   = null;
  let usuarioSesion                 = null;

  // Datos de cartera por segmento (arrays para las tablas expandibles)
  let carteraData = {
    total: [], activos: [], inactivos: [], nuevos: [], recuperados: [], activosMes: []
  };
  let carteraRendered = {
    total: false, activo: false, inactivo: false,
    nuevo: false, recuperado: false, activomes: false
  };

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
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  function periodoActual() {
    const hoy = new Date();
    return {
      mes: hoy.getMonth() + 1,
      anio: hoy.getFullYear(),
    };
  }

  function formatPctDescuento(valor) {
    if (valor === null || valor === undefined || valor === '') return '-';
    const n = Number(valor);
    if (!Number.isFinite(n)) return '-';
    return `${Math.round(n)}%`;
  }

  function renderVendedoresFooter(totalVentas = 0, ventaRealLista = 0, descuento = null) {
    const tfoot = document.getElementById('tfootVendedores');
    if (!tfoot) return;
    const descuentoHtml = descuento === null || descuento === undefined || descuento === ''
      ? '-'
      : formatPctDescuento(descuento);
    tfoot.innerHTML = `<tr>
      <td colspan="3"><strong>Total</strong></td>
      <td style="text-align:right"><strong>${formatCLP(totalVentas)}</strong></td>
      <td style="text-align:right"><strong>${formatCLP(ventaRealLista)}</strong></td>
      <td style="text-align:right"><strong>${descuentoHtml}</strong></td>
    </tr>`;
  }

  function renderVendedoresVacios() {
    const tbody = document.getElementById('tbodyVendedores');
    if (tbody) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin datos</td></tr>';
    }
    renderVendedoresFooter(0, 0, null);
  }

  function mostrarEstadoDashboard(mensaje, tipo = 'error') {
    const el = document.getElementById('dashboardStatus');
    if (!el) return;
    el.hidden = false;
    el.dataset.tipo = tipo;
    el.textContent = mensaje;
  }

  function ocultarEstadoDashboard() {
    const el = document.getElementById('dashboardStatus');
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
    delete el.dataset.tipo;
  }

  function reportarFalloDashboard(contexto, err) {
    const detalle = err instanceof Error ? err.message : String(err || '');
    mostrarEstadoDashboard(detalle ? `${contexto}. ${detalle}` : contexto);
  }

  function normalizarCodigosVendedor(vendedores) {
    const codigos = new Set();
    (Array.isArray(vendedores) ? vendedores : []).forEach(item => {
      const code = String(item?.cod_vendedor ?? item?.codVendedor ?? '').trim();
      if (code) codigos.add(code);
    });
    return Array.from(codigos);
  }

  if (window.Chart && window.ChartDataLabels) {
    window.Chart.register(window.ChartDataLabels);
  }

  // ── Spinner ───────────────────────────────────────────────────────────────────────────────────
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

  // ── Sidebar ──────────────────────────────────────────────────────────────────────────────────
  // Nombres estándar en todos los módulos del área ventas:
  //   Dashboard (activo) | Ventas Asignadas | Historial Cliente | Alertas
  const MODULOS = [
    { nombre:'Ventas Asignadas', icon:'📊', url:'../ventas/index.html',                              area:['ventas','gerencia'] },
    { nombre:'Historial Cliente',icon:'📋', url:'../historial-cliente/index.html',                   area:['ventas','gerencia'] },
    { nombre:'Facturación',    icon:'🧾', url:'../../facturacion/facturacion/index.html',           area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',         icon:'🏭', url:'../../bodega/bodega/index.html',                    area:['bodega','produccion','gerencia'] },
    { nombre:'Producción',     icon:'⚙️', url:'../../produccion/produccion/index.html',             area:['produccion','gerencia'] },
    { nombre:'Serv. TEC',      icon:'🛠️', url:'../../servtecnico/servicio-tecnico/index.html',     area:['servicio-tecnico','servicio','gerencia'] },
    { nombre:'Laboratorio',    icon:'🧪', url:'../../laboratorio/laboratorio/index.html',          area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',       icon:'💰', url:'../../cobranza/cobranza/index.html',                area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',           icon:'👥', url:'../../rrhh/rrhh/index.html',                        area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',   icon:'📜', url:'../../contabilidad/contabilidad/index.html',        area:['contabilidad','gerencia'] },
    { nombre:'Administración', icon:'🔧', url:'../../admin/admin/index.html',                      area:['admin'] },
  ];

  function cargarSidebar(usuario) {
    usuarioSesion = usuario || null;
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
    if (!window.__APP_SIDEBAR_LOADED__ && nav) nav.innerHTML = `<span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span class="nav-label">Dashboard</span>
      </a>
      ${visibles.map(m=>`<a class="nav-item" href="${m.url}"><span style="font-size:1rem">${m.icon}</span><span class="nav-label">${m.nombre}</span></a>`).join('')}`;

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) btnLogout.addEventListener('click', () => {
      localStorage.removeItem('token'); localStorage.removeItem('user');
      window.location.href = '../../varios/login/index.html';
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

    const filtroCartera = document.getElementById('filtroVendedorCartera');
    if (filtroCartera) {
      const codigos = normalizarCodigosVendedor(usuario?.vendedores || []);
      filtroCartera.innerHTML = [
        '<option value="">Todos mis códigos</option>',
        ...codigos.map(cod => `<option value="${escHtml(cod)}">${escHtml(cod)}</option>`)
      ].join('');
      filtroCartera.disabled = !codigos.length;
      filtroCartera.value = '';
      if (!filtroCartera.dataset.bound) {
        filtroCartera.addEventListener('change', () => cargarCartera());
        filtroCartera.dataset.bound = '1';
      }
    }
  }

  // ── Selectores mes/año ────────────────────────────────────────────────────────────────────
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
      if (!selMes.value) selMes.value = String(hoy.getMonth() + 1);
    }
    const selAnio = document.getElementById('filtroAnio');
    if (selAnio) {
      for (let y = hoy.getFullYear(); y >= 2026; y--) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === hoy.getFullYear()) o.selected = true;
        selAnio.appendChild(o);
      }
      if (!selAnio.value) selAnio.value = String(hoy.getFullYear());
    }
  }

  function getParams() {
    const actual = periodoActual();
    const mesSeleccionado = Number(document.getElementById('filtroMes')?.value || actual.mes);
    const anioSeleccionado = Number(document.getElementById('filtroAnio')?.value || actual.anio);
    const mes = Number.isInteger(mesSeleccionado) && mesSeleccionado >= 1 && mesSeleccionado <= 12
      ? mesSeleccionado
      : actual.mes;
    const anio = Number.isInteger(anioSeleccionado) && anioSeleccionado >= 2026
      ? anioSeleccionado
      : actual.anio;

    return {
      mes,
      anio
    };
  }

  function getCarteraParams() {
    const params = getParams();
    const codVendedor = document.getElementById('filtroVendedorCartera')?.value?.trim() || '';
    if (codVendedor) {
      params.cod_vendedor = codVendedor;
    }
    return params;
  }

  // ── KPIs ──────────────────────────────────────────────────────────────────────────────────
  async function cargarResumen() {
    try {
      const res  = await fetch(`${API}/resumen?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      const { totalVentas, meta, progreso, pctDescuentoGlobal } = data;
      setText('kpiTotalVentas', formatCLP(totalVentas));
      setText('kpiMeta',        formatCLP(meta));
      const descRedondeado = pctDescuentoGlobal > 0 ? Math.round(Number(pctDescuentoGlobal)) : 0;
      setText('kpiDescuento',   descRedondeado > 0 ? `${descRedondeado}%` : '0%');
      const pct  = Math.min(progreso, 100);
      setText('kpiProgresoPct', `${progreso}%`);
      const fill = document.getElementById('progresoFill');
      if (fill) {
        fill.style.width      = `${pct}%`;
        fill.style.background = progreso >= 100 ? 'var(--color-primary)' : progreso >= 70 ? 'var(--color-accent)' : 'var(--color-danger)';
      }
    } catch (err) {
      console.error('[cargarResumen]', err);
      reportarFalloDashboard('No se pudo cargar el resumen del dashboard', err);
    }
  }

  // ── Gráfico ───────────────────────────────────────────────────────────────────────────────
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
      const meta   = data.evolucion.map(e => Number(e.meta_mes ?? e.meta ?? 0));
      const metaOrigen = data.evolucion.map(e => {
        if (e.prorrateada) return 'Meta anual';
        if (e.tipo_meta === 'mensual') return 'Meta mensual específica';
        if (e.tipo_meta === 'anual') return 'Meta anual';
        return 'Meta';
      });
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
            tooltip:{
              callbacks:{
                label:ctx2 => {
                  const monto = new Intl.NumberFormat('es-CL',{style:'currency',currency:'CLP',maximumFractionDigits:0}).format(ctx2.parsed.y);
                  if (ctx2.dataset.label === 'Meta') {
                    return ` ${ctx2.dataset.label}: ${monto} (${metaOrigen[ctx2.dataIndex]})`;
                  }
                  return ` ${ctx2.dataset.label}: ${monto}`;
                }
              }
            }
          },
          scales:{
            y:{ beginAtZero:true, ticks:{ font:{family:'Open Sans',size:11}, callback: v => new Intl.NumberFormat('es-CL',{notation:'compact',compactDisplay:'short'}).format(v) }, grid:{color:'rgba(0,0,0,0.05)'} },
            x:{ ticks:{font:{family:'Open Sans',size:11}}, grid:{display:false} }
          }
        }
      });
    } catch (err) {
      console.error('[cargarGrafico]', err);
      reportarFalloDashboard('No se pudo cargar la evolución mensual', err);
    }
  }

  // ── Tabla vendedores ──────────────────────────────────────────────────────────────────────
  async function cargarVendedores() {
    try {
      renderVendedoresVacios();
      const res  = await fetch(`${API}/vendedores?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      const tbody = document.getElementById('tbodyVendedores');
      if (!tbody) return;
      if (!data.ok || !Array.isArray(data.vendedores) || !data.vendedores.length) {
        renderVendedoresVacios();
        return;
      }
      tbody.innerHTML = data.vendedores.map(v => {
        const totalVentasCobrado = Number(v.totalVentasCobrado || 0);
        const ventaRealLista     = Number(v.ventaRealLista     || 0);
        const pctDescuento       = formatPctDescuento(v.pctDescuento);
        return `
        <tr>
          <td><strong>${escHtml(v.codVendedor)}</strong></td>
          <td>${escHtml(v.nombreVendedor) || '—'}</td>
          <td>${v.totalFolios}</td>
          <td style="text-align:right">${formatCLP(totalVentasCobrado)}</td>
          <td style="text-align:right">${formatCLP(ventaRealLista)}</td>
          <td style="text-align:right">${pctDescuento}</td>
        </tr>`;
      }).join('');
      const totales = data.totales || {};
      const sumVentas = Number(totales.totalVentasCobrado ?? data.vendedores.reduce((s, v) => s + Number(v.totalVentasCobrado || 0), 0));
      const sumLista  = Number(totales.ventaRealLista ?? data.vendedores.reduce((s, v) => s + Number(v.ventaRealLista || 0), 0));
      const descuento = totales.pctDescuento !== undefined && totales.pctDescuento !== null
        ? Number(totales.pctDescuento)
        : (sumLista > 0 ? Math.round((1 - sumVentas / sumLista) * 10000) / 100 : null);
      renderVendedoresFooter(sumVentas, sumLista, descuento);
    } catch (err) {
      console.error('[cargarVendedores]', err);
      reportarFalloDashboard('No se pudo cargar la tabla de vendedores', err);
    }
  }

  // ── Tabla ventas del mes ──────────────────────────────────────────────────────────────────
  let ventasMesData = [];

  async function cargarVentasMes() {
    try {
      const params = new URLSearchParams(getParams());
      params.set('include_compartidas', '1');
      const res  = await fetch(`${API}/ventas-mes?${params.toString()}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      ventasMesData = data.ventas || [];
      poblarFiltroVendedor(ventasMesData);
      aplicarFiltrosVentasMes();
    } catch (err) {
      console.error('[cargarVentasMes]', err);
      reportarFalloDashboard('No se pudo cargar las ventas del mes', err);
    }
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
      if (q && !String(v.Folio||'').toLowerCase().includes(q) && !String(v.cliente||'').toLowerCase().includes(q) && !String(v.CodAux||'').toLowerCase().includes(q)) return false;
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
    if (!lista.length) { tbody.innerHTML = '<tr class="tabla-empty"><td colspan="8">Sin registros</td></tr>'; return; }
    tbody.innerHTML = lista.map(v => {
      const pctDescRedondeado = v.pct_descuento > 0 ? Math.round(Number(v.pct_descuento)) : 0;
      const pctDesc      = formatPctDescuento(v.pct_descuento ?? v.pctDescuento ?? v.dcto ?? v.Dcto ?? (pctDescRedondeado || null));
      const montoMostrar = v.es_compartido && v.monto_asignado != null ? v.monto_asignado : v.monto;
      const totLineaReal = Number(v.TotLineaReal || 0);
      const cliente      = v.cliente || v.CodAux || '—';
      const badgeComp    = v.es_compartido
        ? `<span style="font-size:.7rem;background:#00E2A7;color:#000;border-radius:4px;padding:1px 5px;margin-left:4px">Compartido ${v.porcentaje_asignado?v.porcentaje_asignado+'%':''}</span>`
        : '';
      return `<tr data-folio="${v.Folio}">
        <td><strong>${escHtml(v.Folio) || '—'}</strong>${badgeComp}</td>
        <td>${escHtml(v.fecha_formato) || '—'}</td>
        <td>${escHtml(cliente) || '—'}</td>
        <td>${escHtml(v.CodVendedor) || '—'}</td>
        <td style="text-align:right">${formatCLP(montoMostrar)}</td>
        <td style="text-align:right">${formatCLP(totLineaReal)}</td>
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

  // ── Modal detalle folio ───────────────────────────────────────────────────────────────────
  async function abrirDetalle(folio) {
    const overlay = document.getElementById('modalOverlay');
    const tbody   = document.getElementById('modalTbody');
    if (!overlay || !tbody) return;
    setText('modalTitulo', `Folio N° ${folio}`);
    const venta = ventasMesData.find(v => String(v.Folio) === String(folio));
    setText('modalSubtitulo', venta ? `${venta.cliente||''} • ${venta.fecha_formato||''}` : '');
    setText('modalTotalValor', '—');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem">Cargando...</td></tr>';
    overlay.classList.add('modal-overlay--visible');
    overlay.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    try {
      const res  = await fetch(`/api/ventas/detalle/${folio}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!res.ok || !data.ok) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--color-danger)">⚠️ Error</td></tr>'; return; }
      if (!data.detalle?.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center">Sin líneas</td></tr>'; return; }
      const d0 = data.detalle[0] || {};
      setText('modalSubtitulo', venta
        ? `${venta.cliente || ''} • ${venta.fecha_formato || ''} • Cód. Cliente: ${d0.CodAux || '—'} • CanCod: ${d0.CanCod || '—'}`
        : `Cód. Cliente: ${d0.CodAux || '—'} • CanCod: ${d0.CanCod || '—'}`);
      const total = data.detalle.reduce((s,l)=>s+(Number(l.neto_total ?? l.TotLinea ?? 0)||0),0);
      tbody.innerHTML = data.detalle.map(l=>`
        <tr>
          <td><code>${escHtml(l.CodProd) || '—'}</code></td>
          <td>${escHtml(l.DesProd) || '—'}</td>
          <td style="text-align:center">${l.CantFacturada ?? '—'}</td>
          <td style="text-align:right">${formatCLP(l.precio_real)}</td>
          <td style="text-align:right">${formatCLP(l.precio_vta ?? l.PrecioVta)}</td>
          <td style="text-align:right">${formatCLP(l.neto_real)}</td>
          <td style="text-align:right"><strong>${formatCLP(l.neto_total ?? l.TotLinea)}</strong></td>
          <td style="text-align:right">${formatPctDescuento(l.dcto ?? l.Dcto)}</td>
        </tr>`).join('');
      setText('modalTotalValor', formatCLP(total));
    } catch(err) { console.error('[abrirDetalle]',err); tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--color-danger)">&#x26A0;&#xFE0F; Error</td></tr>'; }
  }

  function cerrarModal() {
    const overlay = document.getElementById('modalOverlay');
    if (!overlay) return;
    overlay.classList.remove('modal-overlay--visible');
    overlay.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  // ── CARTERA DE CLIENTES ───────────────────────────────────────────────────────────────────
  async function cargarCartera() {
    try {
      const res  = await fetch(`${API_CART}?${new URLSearchParams(getCarteraParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error cartera');

      const total      = data.TotalClientes      ?? data.totalClientes      ?? null;
      const activos    = data.ClientesActivos    ?? data.clientesActivos    ?? null;
      const inactivos  = data.ClientesInactivos  ?? data.clientesInactivos  ?? null;
      const nuevos     = data.ClientesNuevos     ?? data.clientesNuevos     ?? null;
      const recuperados= data.ClientesRecuperados?? data.clientesRecuperados?? null;

      setText('countTotal',      total       !== null ? String(total)       : '—');
      setText('countActivo',     activos     !== null ? String(activos)     : '—');
      setText('countInactivo',   inactivos   !== null ? String(inactivos)   : '—');
      setText('countNuevo',      nuevos      !== null ? String(nuevos)      : '—');
      setText('countRecuperado', recuperados !== null ? String(recuperados) : '—');

      carteraData.total      = data.total         || [];
      carteraData.activos    = data.activos        || [];
      carteraData.inactivos  = data.inactivos      || [];
      carteraData.nuevos     = data.nuevos         || [];
      carteraData.recuperados= data.recuperados    || [];
      carteraData.activosMes = data.activosMesActual || [];

      setText('countActivoMes', String(carteraData.activosMes.length));

      carteraRendered = {
        total: false, activo: false, inactivo: false,
        nuevo: false, recuperado: false, activomes: false
      };

      ['total','activo','inactivo','nuevo','recuperado','activomes'].forEach(tipo => {
        const lista = document.getElementById(`lista${capitalize(tipo)}`);
        if (lista && !lista.hidden) renderCartaTipo(tipo);
      });
    } catch (err) {
      console.error('[cargarCartera]', err);
      reportarFalloDashboard('No se pudo cargar la cartera de clientes', err);
      ['countTotal','countActivo','countInactivo','countNuevo','countRecuperado','countActivoMes']
        .forEach(id => setText(id, '—'));
    }
  }

  const CARTERA_KEY = {
    total:      'total',
    activo:     'activos',
    inactivo:   'inactivos',
    nuevo:      'nuevos',
    recuperado: 'recuperados',
    activomes:  'activosMes'
  };
  const CARTERA_VACIO = {
    total:      'Sin clientes en cartera',
    activo:     'Sin clientes activos',
    inactivo:   'Sin clientes inactivos',
    nuevo:      'Sin clientes nuevos este mes',
    recuperado: 'Sin clientes recuperados',
    activomes:  'Sin clientes activos este mes'
  };

  function renderCartaTipo(tipo, filtro) {
    const q = (filtro || '').toLowerCase();
    const fuente = carteraData[CARTERA_KEY[tipo]] || [];
    const lista = q
      ? fuente.filter(c =>
          (c.CodAux  || '').toLowerCase().includes(q) ||
          (c.NomAux  || '').toLowerCase().includes(q) ||
          (c.EMail   || '').toLowerCase().includes(q) ||
          (c.FONAUX1 || '').toLowerCase().includes(q) ||
          (c.FonAux2 || '').toLowerCase().includes(q))
      : fuente;

    const tbodyMap = {
      total:      'tbodyTotal',
      activo:     'tbodyActivo',
      inactivo:   'tbodyInactivo',
      nuevo:      'tbodyNuevo',
      recuperado: 'tbodyRecuperado',
      activomes:  'tbodyActivoMes'
    };
    renderTablaCartera(tbodyMap[tipo], lista, CARTERA_VACIO[tipo]);
    carteraRendered[tipo] = true;
  }

  function renderTablaCartera(tbodyId, lista, mensajeVacio) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!lista.length) {
      tbody.innerHTML = `<tr class="tabla-empty"><td colspan="5">${mensajeVacio}</td></tr>`;
      return;
    }
    tbody.innerHTML = lista.map(c => {
      const emailHtml = c.EMail
        ? `<a href="mailto:${escHtml(c.EMail)}" style="color:var(--color-primary);text-decoration:none" title="${escHtml(c.EMail)}">${escHtml(c.EMail)}</a>`
        : '—';
      const tel1Html = c.FONAUX1
        ? `<a href="tel:${escHtml(c.FONAUX1)}" style="color:var(--color-primary);text-decoration:none">${escHtml(c.FONAUX1)}</a>`
        : '—';
      const tel2Html = c.FonAux2
        ? `<a href="tel:${escHtml(c.FonAux2)}" style="color:var(--color-primary);text-decoration:none">${escHtml(c.FonAux2)}</a>`
        : '—';
      return `<tr>
          <td><code>${escHtml(c.CodAux) || '—'}</code></td>
          <td>${escHtml(c.NomAux) || '—'}</td>
          <td>${tel1Html}</td>
          <td>${tel2Html}</td>
          <td>${emailHtml}</td>
        </tr>`;
    }).join('');
  }

  function capitalize(s) {
    if (s === 'activomes') return 'ActivoMes';
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
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

    const busquedas = [
      ['busquedaTotal',      'total'],
      ['busquedaActivo',     'activo'],
      ['busquedaInactivo',   'inactivo'],
      ['busquedaNuevo',      'nuevo'],
      ['busquedaRecuperado', 'recuperado'],
      ['busquedaActivoMes',  'activomes']
    ];
    busquedas.forEach(([id, tipo]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', e => renderCartaTipo(tipo, e.target.value));
    });
  }

  // ── Gráfico Distribución por Categoría ───────────────────────────────────────────────────
  const COLORES_TORTA = ['#00E2A7','#4ECDC4','#45B7D1','#96CEB4','#F5A623','#DDA0DD','#F06543','#00B4D8'];

  function renderGraficoClientesDistribucion(datos) {
    const canvas = document.getElementById('graficoClientesDistribucion');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (graficoClientesDistribucion) graficoClientesDistribucion.destroy();
    if (!datos || !datos.length) {
      graficoClientesDistribucion = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Sin datos'], datasets: [{ data: [1], backgroundColor: ['#E8EAF0'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, cutout: '60%' }
      });
      return;
    }
    graficoClientesDistribucion = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: datos.map(d => d.label),
        datasets: [{ data: datos.map(d => d.valor), backgroundColor: datos.map(d => d.color), borderWidth: datos.map(d => d.valor > 0 ? 3 : 1), borderColor: datos.map(d => d.valor > 0 ? '#222' : '#fff') }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          datalabels: {
            display: (ctx2) => { const total = ctx2.dataset.data.reduce((s, v) => s + (v || 0), 0); const pct = total > 0 ? (ctx2.dataset.data[ctx2.dataIndex] || 0) / total * 100 : 0; return pct >= 3; },
            color: '#fff', font: { family: 'Montserrat', size: 11, weight: '700' },
            formatter: (value, ctx2) => { const total = ctx2.dataset.data.reduce((s, v) => s + (v || 0), 0); if (!total) return ''; return ((value / total) * 100).toFixed(1) + '%'; }
          },
          legend: {
            position: 'bottom',
            labels: {
              font: { family: 'Montserrat', size: 12 }, usePointStyle: true, pointStyle: 'circle', boxWidth: 10, padding: 14,
              generateLabels: (chart) => {
                const dataset = chart.data.datasets[0];
                return chart.data.labels.map((label, i) => {
                  const valor = dataset.data[i] || 0;
                  return { text: label, fillStyle: dataset.backgroundColor[i], strokeStyle: dataset.backgroundColor[i], hidden: false, index: i, fontColor: valor === 0 ? '#B0B8C1' : undefined };
                });
              }
            }
          },
          tooltip: { callbacks: { label: (ctx2) => { const total = ctx2.dataset.data.reduce((sum, v) => sum + (v || 0), 0); const pct = total > 0 ? ((ctx2.parsed / total) * 100).toFixed(1) : '0.0'; return ` ${ctx2.label}: ${ctx2.parsed.toLocaleString('es-CL')}  (${pct}%)`; } } }
        },
        cutout: '55%'
      }
    });
  }

  async function cargarGraficoClientes() {
    try {
      const res  = await fetch(`${API}/categorias-vendedor?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      const tabsEl = document.getElementById('tortaVendedorTabs');
      if (!data.ok || !data.vendedores.length) {
        if (tabsEl) tabsEl.style.display = 'none';
        renderGraficoClientesDistribucion([]);
        return;
      }
      const vendedores = data.vendedores;
      const todasLasCategorias = data.todasLasCategorias || [];
      const aggMap = {};
      for (const v of vendedores) { for (const c of v.categorias) { aggMap[c.categoria] = (aggMap[c.categoria] || 0) + c.total; } }
      const maestro = [
        ...Object.entries(aggMap).sort((a, b) => b[1] - a[1]).map(([label]) => label),
        ...todasLasCategorias.filter(cat => !aggMap[cat])
      ].map((label, i) => ({ label, color: COLORES_TORTA[i % COLORES_TORTA.length] }));
      function padear(categorias) {
        const mapa = Object.fromEntries(categorias.map(c => [c.categoria, c.total]));
        return maestro.map(m => ({ label: m.label, valor: mapa[m.label] || 0, color: m.color }));
      }
      const datosTotal = maestro.map(m => ({ label: m.label, valor: aggMap[m.label] || 0, color: m.color }));
      if (vendedores.length === 1) {
        if (tabsEl) tabsEl.style.display = 'none';
        renderGraficoClientesDistribucion(padear(vendedores[0].categorias));
      } else {
        if (tabsEl) {
          tabsEl.style.display = 'flex';
          const tabTodos = `<button class="torta-tab torta-tab--activo" data-idx="-1">Todos</button>`;
          const tabsVendedores = vendedores.map((v, i) => `<button class="torta-tab" data-idx="${i}">${v.codVendedor}</button>`).join('');
          tabsEl.innerHTML = tabTodos + tabsVendedores;
          tabsEl.querySelectorAll('.torta-tab').forEach(btn => {
            btn.addEventListener('click', () => {
              tabsEl.querySelectorAll('.torta-tab').forEach(b => b.classList.remove('torta-tab--activo'));
              btn.classList.add('torta-tab--activo');
              const idx = Number(btn.dataset.idx);
              renderGraficoClientesDistribucion(idx === -1 ? datosTotal : padear(vendedores[idx].categorias));
            });
          });
        }
        renderGraficoClientesDistribucion(datosTotal);
      }
    } catch (err) {
      console.error('[cargarGraficoClientes]', err);
      reportarFalloDashboard('No se pudo cargar la distribución por categoría', err);
    }
  }

  // ── Clientes por vendedor ─────────────────────────────────────────────────────────────────
  async function cargarClientesResumen() {
    try {
      const res  = await fetch(`${API}/clientes-resumen?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      const tbody = document.getElementById('tbodyClientesResumen');
      if (!tbody) return;
      if (!data.ok || !data.clientes.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="4">Sin datos</td></tr>'; return;
      }
      tbody.innerHTML = data.clientes.map(c => `<tr>
          <td><strong>${escHtml(c.codVendedor)}</strong></td>
          <td style="text-align:right">${c.totalClientesHist.toLocaleString('es-CL')}</td>
          <td style="text-align:right">${c.totalClientesPeriodo.toLocaleString('es-CL')}</td>
        </tr>`).join('');
      const tfoot = document.getElementById('tfootClientesResumen');
      if (tfoot) {
        const totalPeriodo = data.clientes.reduce((s, c) => s + (c.totalClientesPeriodo || 0), 0);
        tfoot.innerHTML = `<tr><td><strong>Total</strong></td><td></td><td style="text-align:right"><strong>${totalPeriodo.toLocaleString('es-CL')}</strong></td></tr>`;
      }
    } catch (err) {
      console.error('[cargarClientesResumen]', err);
      reportarFalloDashboard('No se pudo cargar el resumen de clientes', err);
    }
  }

  // ── Cargar todo ───────────────────────────────────────────────────────────────────────────
  async function cargarTodo() {
    mostrarCarga();
    ocultarEstadoDashboard();
    try {
      await Promise.all([
        cargarResumen(),
        cargarGrafico(),
        cargarCartera(),
        cargarVendedores(),
        cargarVentasMes(),
        cargarGraficoClientes(),
        cargarClientesResumen()
      ]);
    } catch(err) {
      console.error('[cargarTodo]', err);
    } finally {
      ocultarCarga();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────────────────
  async function init() {
    const usuario = await verificarSesion();
    if (!usuario) return;
    cargarSidebar(usuario);
    initSelectores();
    initCarteraCards();

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
          if (tiposActivos.size > 1) { tiposActivos.delete(tipo); btn.classList.remove('tipo-toggle--activo'); }
        } else {
          tiposActivos.add(tipo); btn.classList.add('tipo-toggle--activo');
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
    if (btnAct) btnAct.addEventListener('click', () => cargarTodo());

    cargarTodo();
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();


