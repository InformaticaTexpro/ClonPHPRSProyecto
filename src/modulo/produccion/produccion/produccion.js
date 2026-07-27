'use strict';

/**
 * produccion.js — Módulo de Producción Texpro
 *
 * Frontend de demostración con datos ficticios.
 * Sin llamadas a API. Toda la lógica opera sobre estado local.
 */

(function () {

  // ── Constantes de fecha ────────────────────────────────────────────────────
  const _hoy  = new Date();
  const _mes  = _hoy.getMonth() + 1;
  const _anio = _hoy.getFullYear();
  const _pad  = n => String(n).padStart(2, '0');
  const _pre  = `${_anio}-${_pad(_mes)}`;

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // ── Datos ficticios: catálogo de productos ─────────────────────────────────
  const PRODUCTOS = [
    { id:1, codigo:'CLG-001', nombre:'Cloro Granulado 90%',       unidad:'kg', metaMes:1200, stockActual: 850, lotesHoy:3, estado:'En producción' },
    { id:2, codigo:'SAL-002', nombre:'Sulfato de Aluminio',        unidad:'kg', metaMes:1000, stockActual:1200, lotesHoy:0, estado:'Completado'     },
    { id:3, codigo:'HNS-003', nombre:'Hipoclorito de Sodio 10%',   unidad:'L',  metaMes: 800, stockActual: 620, lotesHoy:2, estado:'En producción' },
    { id:4, codigo:'ACM-004', nombre:'Ácido Muriático 32%',        unidad:'L',  metaMes: 500, stockActual: 450, lotesHoy:1, estado:'En producción' },
    { id:5, codigo:'PLF-005', nombre:'Polímero Floculante',        unidad:'kg', metaMes: 600, stockActual: 300, lotesHoy:0, estado:'Pendiente'     },
    { id:6, codigo:'SDC-006', nombre:'Soda Cáustica 50%',          unidad:'kg', metaMes: 700, stockActual: 780, lotesHoy:2, estado:'Completado'    },
  ];

  // ── Datos ficticios: registros del mes actual ──────────────────────────────
  const REGISTROS_BASE = [
    { id:1,  fecha:`${_pre}-02`, producto:'Cloro Granulado 90%',      cod:'CLG-001', cantidad: 80, unidad:'kg', operario:'Juan Pérez',     turno:'Mañana', lote:'L-001', observacion:'Sin novedad'                },
    { id:2,  fecha:`${_pre}-03`, producto:'Sulfato de Aluminio',       cod:'SAL-002', cantidad:120, unidad:'kg', operario:'María González', turno:'Tarde',  lote:'L-002', observacion:'Ajuste de dosificación'    },
    { id:3,  fecha:`${_pre}-05`, producto:'Hipoclorito de Sodio 10%',  cod:'HNS-003', cantidad: 90, unidad:'L',  operario:'Pedro Rojas',    turno:'Mañana', lote:'L-003', observacion:'Sin novedad'                },
    { id:4,  fecha:`${_pre}-06`, producto:'Cloro Granulado 90%',       cod:'CLG-001', cantidad:100, unidad:'kg', operario:'Juan Pérez',     turno:'Noche',  lote:'L-004', observacion:'Sin novedad'                },
    { id:5,  fecha:`${_pre}-07`, producto:'Ácido Muriático 32%',       cod:'ACM-004', cantidad: 60, unidad:'L',  operario:'Ana Soto',       turno:'Mañana', lote:'L-005', observacion:'Control de calidad OK'     },
    { id:6,  fecha:`${_pre}-09`, producto:'Polímero Floculante',       cod:'PLF-005', cantidad: 45, unidad:'kg', operario:'Carlos Muñoz',   turno:'Tarde',  lote:'L-006', observacion:'Sin novedad'                },
    { id:7,  fecha:`${_pre}-10`, producto:'Soda Cáustica 50%',         cod:'SDC-006', cantidad:110, unidad:'kg', operario:'María González', turno:'Mañana', lote:'L-007', observacion:'Sin novedad'                },
    { id:8,  fecha:`${_pre}-12`, producto:'Cloro Granulado 90%',       cod:'CLG-001', cantidad: 95, unidad:'kg', operario:'Pedro Rojas',    turno:'Noche',  lote:'L-008', observacion:'Mantenimiento preventivo'  },
    { id:9,  fecha:`${_pre}-13`, producto:'Hipoclorito de Sodio 10%',  cod:'HNS-003', cantidad: 85, unidad:'L',  operario:'Juan Pérez',     turno:'Mañana', lote:'L-009', observacion:'Sin novedad'                },
    { id:10, fecha:`${_pre}-14`, producto:'Sulfato de Aluminio',       cod:'SAL-002', cantidad:130, unidad:'kg', operario:'Ana Soto',       turno:'Tarde',  lote:'L-010', observacion:'Sin novedad'                },
    { id:11, fecha:`${_pre}-16`, producto:'Ácido Muriático 32%',       cod:'ACM-004', cantidad: 75, unidad:'L',  operario:'Carlos Muñoz',   turno:'Mañana', lote:'L-011', observacion:'Sin novedad'                },
    { id:12, fecha:`${_pre}-17`, producto:'Cloro Granulado 90%',       cod:'CLG-001', cantidad:105, unidad:'kg', operario:'María González', turno:'Tarde',  lote:'L-012', observacion:'Sin novedad'                },
    { id:13, fecha:`${_pre}-19`, producto:'Soda Cáustica 50%',         cod:'SDC-006', cantidad: 90, unidad:'kg', operario:'Pedro Rojas',    turno:'Noche',  lote:'L-013', observacion:'Sin novedad'                },
    { id:14, fecha:`${_pre}-20`, producto:'Polímero Floculante',       cod:'PLF-005', cantidad: 55, unidad:'kg', operario:'Juan Pérez',     turno:'Mañana', lote:'L-014', observacion:'Sin novedad'                },
    { id:15, fecha:`${_pre}-21`, producto:'Hipoclorito de Sodio 10%',  cod:'HNS-003', cantidad: 95, unidad:'L',  operario:'Ana Soto',       turno:'Tarde',  lote:'L-015', observacion:'Control de calidad OK'     },
    { id:16, fecha:`${_pre}-22`, producto:'Cloro Granulado 90%',       cod:'CLG-001', cantidad:120, unidad:'kg', operario:'Carlos Muñoz',   turno:'Mañana', lote:'L-016', observacion:'Sin novedad'                },
    { id:17, fecha:`${_pre}-23`, producto:'Sulfato de Aluminio',       cod:'SAL-002', cantidad:145, unidad:'kg', operario:'María González', turno:'Tarde',  lote:'L-017', observacion:'Sin novedad'                },
  ];

  // ── Datos ficticios: procesos para envío ───────────────────────────────────
  const ENVIOS = [
    { id:1, orden:'OE-2026-041', producto:'Cloro Granulado 90%',      cantidad:250, unidad:'kg', destino:'ESSAL S.A.',          fechaDesp:`${_anio}-${_pad(_mes)}-28`, estado:'Listo'     },
    { id:2, orden:'OE-2026-042', producto:'Hipoclorito de Sodio 10%', cantidad:180, unidad:'L',  destino:'SISS Concepción',     fechaDesp:`${_anio}-${_pad(_mes)}-28`, estado:'Listo'     },
    { id:3, orden:'OE-2026-043', producto:'Sulfato de Aluminio',      cantidad:300, unidad:'kg', destino:'MOP Santiago',        fechaDesp:`${_anio}-${_pad(_mes)}-29`, estado:'En prep.'  },
    { id:4, orden:'OE-2026-044', producto:'Ácido Muriático 32%',      cantidad:120, unidad:'L',  destino:'ANWANDTER Ltda.',     fechaDesp:`${_anio}-${_pad(_mes)}-30`, estado:'En prep.'  },
    { id:5, orden:'OE-2026-045', producto:'Polímero Floculante',      cantidad:200, unidad:'kg', destino:'SMAPA Maipú',         fechaDesp:`${_anio}-${_pad(_mes+1 > 12 ? 1 : _mes+1)}-02`, estado:'Pendiente' },
    { id:6, orden:'OE-2026-046', producto:'Soda Cáustica 50%',        cantidad:150, unidad:'kg', destino:'Aguas Andinas S.A.',  fechaDesp:`${_anio}-${_pad(_mes+1 > 12 ? 1 : _mes+1)}-03`, estado:'Pendiente' },
  ];

  // ── Estado mutable ─────────────────────────────────────────────────────────
  let registros         = [...REGISTROS_BASE];
  let graficoProduccion = null;
  let nextId            = registros.length + 1;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function formatNum(n) {
    return Number(n).toLocaleString('es-CL');
  }

  function formatFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function getMesAnio() {
    return {
      mes:  parseInt(document.getElementById('filtroMes')?.value  || _mes),
      anio: parseInt(document.getElementById('filtroAnio')?.value || _anio),
    };
  }

  function getRegistrosFiltrados() {
    const { mes, anio } = getMesAnio();
    const prefijo = `${anio}-${_pad(mes)}`;
    return registros.filter(r => r.fecha.startsWith(prefijo));
  }

  // ── Sesión (mock si no hay token) ──────────────────────────────────────────
  function obtenerUsuario() {
    try {
      const raw = localStorage.getItem('user');
      if (raw) return JSON.parse(raw);
    } catch { /* ignorar */ }
    return { nombre: 'Demo Producción', email: 'demo@texpro.cl', area: 'produccion', is_admin: true };
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────
  const MODULOS = [
    { nombre:'Dashboard',      icon:'🏠', url:'../dashboard/index.html',    area: null },
    { nombre:'Ventas',         icon:'📊', url:'../ventas/index.html',       area:['ventas','gerencia'] },
    { nombre:'Facturación',    icon:'🧾', url:'../facturacion/index.html',  area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',         icon:'🏭', url:'../bodega/index.html',       area:['bodega','produccion','gerencia'] },
    { nombre:'Laboratorio',    icon:'🧪', url:'../laboratorio/index.html',  area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',       icon:'💰', url:'../cobranza/index.html',     area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',           icon:'👥', url:'../rrhh/index.html',         area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',   icon:'📜', url:'../contabilidad/index.html', area:['contabilidad','gerencia'] },
    { nombre:'Administración', icon:'🔧', url:'../admin/index.html',        area:['admin'] },
  ];

  function cargarSidebar(usuario) {
    const ini = (usuario.nombre || 'U').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    setText('userName',    usuario.nombre || usuario.email);
    setText('userArea',    usuario.area   || '');
    setText('userAvatar',  ini);
    setText('chipAvatar',  ini);
    setText('chipName',    (usuario.nombre || usuario.email).split(' ')[0]);
    setText('headerDate',  new Date().toLocaleDateString('es-CL',
      { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
    setText('welcomeTitle',    `Hola, ${(usuario.nombre||usuario.email).split(' ')[0]} ⚙️`);
    setText('welcomeSubtitle', `Área: ${usuario.area||'Producción'} — Texpro`);

    const visibles = MODULOS.filter(m => {
      if (m.area === null) return true;
      if (usuario.is_admin) return true;
      return m.area.includes(usuario.area);
    });

    const nav = document.getElementById('sidebarNav');
    if (!window.__APP_SIDEBAR_LOADED__ && nav) nav.innerHTML = `
      <span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">
        <span style="font-size:1rem">⚙️</span>
        <span class="nav-label">Producción</span>
      </a>
      ${visibles.map(m => `
        <a class="nav-item" href="${m.url}">
          <span style="font-size:1rem">${m.icon}</span>
          <span class="nav-label">${m.nombre}</span>
        </a>`).join('')}`;

    document.getElementById('btnLogout')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '../login/index.html';
    });

    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper')?.classList.toggle('main-wrapper--expanded');
    });

    document.getElementById('headerMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--mobile-open');
    });
  }

  // ── Selectores mes / año ───────────────────────────────────────────────────
  function initSelectores() {
    const selMes  = document.getElementById('filtroMes');
    const selAnio = document.getElementById('filtroAnio');
    if (!selMes || !selAnio) return;

    MESES.forEach((m, i) => {
      const o = document.createElement('option');
      o.value = i + 1; o.textContent = m;
      if (i + 1 === _mes) o.selected = true;
      selMes.appendChild(o);
    });

    for (let y = _anio; y >= 2026; y--) {
      const o = document.createElement('option');
      o.value = y; o.textContent = y;
      if (y === _anio) o.selected = true;
      selAnio.appendChild(o);
    }
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────
  function renderKpis() {
    const datos          = getRegistrosFiltrados();
    const totalProducido = datos.reduce((s, r) => s + r.cantidad, 0);
    const metaMensual    = PRODUCTOS.reduce((s, p) => s + p.metaMes, 0);
    const cumplimiento   = metaMensual > 0
      ? Math.min(Math.round((totalProducido / metaMensual) * 100), 999) : 0;
    const pendientes     = PRODUCTOS.filter(p => p.estado === 'Pendiente').length;

    setText('kpiTotalProducido', formatNum(totalProducido) + ' u');
    setText('kpiMeta',           formatNum(metaMensual)    + ' u');
    setText('kpiCumplimiento',   cumplimiento + '%');
    setText('kpiPendientes',     pendientes   + ' productos');

    const fill = document.getElementById('progresoProdFill');
    if (fill) {
      const pct = Math.min(cumplimiento, 100);
      fill.style.width      = pct + '%';
      fill.style.background = cumplimiento >= 100 ? 'var(--color-primary)'
                            : cumplimiento >=  70 ? '#F5A623'
                            : 'var(--color-danger)';
    }
  }

  // ── Gráfico de producción diaria ───────────────────────────────────────────
  function renderGrafico() {
    const { mes, anio } = getMesAnio();
    const datos         = getRegistrosFiltrados();
    const diasDelMes    = new Date(anio, mes, 0).getDate();

    const labels = [];
    const valores = [];
    for (let d = 1; d <= diasDelMes; d++) {
      const key = `${anio}-${_pad(mes)}-${_pad(d)}`;
      labels.push(String(d));
      valores.push(datos.filter(r => r.fecha === key).reduce((s, r) => s + r.cantidad, 0));
    }

    const ctx = document.getElementById('graficoProduccion');
    if (!ctx) return;
    if (graficoProduccion) graficoProduccion.destroy();

    graficoProduccion = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Producción (u)',
          data: valores,
          backgroundColor: 'rgba(0,226,167,0.5)',
          borderColor:     '#00E2A7',
          borderWidth: 1.5,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${formatNum(c.parsed.y)} unidades` } },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { font: { family: 'Open Sans', size: 11 }, stepSize: 50 },
            grid:  { color: 'rgba(0,0,0,0.05)' },
          },
          x: {
            ticks: { font: { family: 'Open Sans', size: 10 } },
            grid:  { display: false },
          },
        },
      },
    });
  }

  // ── Catálogo de productos ──────────────────────────────────────────────────
  function renderProductos() {
    const tbody = document.getElementById('tbodyProductos');
    if (!tbody) return;

    tbody.innerHTML = PRODUCTOS.map(p => {
      const pct    = Math.min(Math.round((p.stockActual / p.metaMes) * 100), 100);
      const color  = pct >= 100 ? 'var(--color-primary)' : pct >= 70 ? '#F5A623' : 'var(--color-danger)';
      const badge  = p.estado === 'Completado'     ? 'badge--verde'
                   : p.estado === 'En producción'  ? 'badge--naranja'
                   : 'badge--gris';
      return `
        <tr>
          <td><code class="prod-codigo">${p.codigo}</code></td>
          <td><strong>${p.nombre}</strong></td>
          <td style="text-align:center">${p.unidad}</td>
          <td style="text-align:right">${formatNum(p.stockActual)}</td>
          <td style="text-align:right">${formatNum(p.metaMes)}</td>
          <td>
            <div class="mini-barra-bg">
              <div class="mini-barra-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="mini-pct">${pct}%</span>
          </td>
          <td style="text-align:center"><span class="badge ${badge}">${p.estado}</span></td>
          <td style="text-align:center">${p.lotesHoy}</td>
        </tr>`;
    }).join('');
  }

  // ── Historial de registros ─────────────────────────────────────────────────
  function renderRegistros() {
    const tbody = document.getElementById('tbodyRegistros');
    if (!tbody) return;

    const datos = getRegistrosFiltrados().slice().reverse();

    if (!datos.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="7">Sin registros para este período</td></tr>';
      return;
    }

    tbody.innerHTML = datos.map(r => `
      <tr>
        <td>${formatFecha(r.fecha)}</td>
        <td><code class="prod-codigo">${r.cod}</code></td>
        <td>${r.producto}</td>
        <td style="text-align:right"><strong>${formatNum(r.cantidad)} ${r.unidad}</strong></td>
        <td style="text-align:center">${r.turno}</td>
        <td>${r.operario}</td>
        <td><span class="badge badge--lote">${r.lote}</span></td>
      </tr>`).join('');
  }

  // ── Agregar registro desde formulario ─────────────────────────────────────
  function agregarRegistro(e) {
    e.preventDefault();
    const get = id => document.getElementById(id)?.value.trim() || '';

    const prodCod = get('formProducto');
    const prodObj = PRODUCTOS.find(p => p.codigo === prodCod);
    const cantidad = parseInt(get('formCantidad'));
    const fecha    = get('formFecha');

    if (!prodObj || !cantidad || !fecha) return;

    nextId++;
    const lote = `L-${String(nextId).padStart(3, '0')}`;

    registros.push({
      id:          nextId,
      fecha,
      producto:    prodObj.nombre,
      cod:         prodCod,
      cantidad,
      unidad:      prodObj.unidad,
      operario:    get('formOperario') || 'Sin especificar',
      turno:       get('formTurno'),
      lote,
      observacion: get('formObservacion') || 'Sin novedad',
    });

    document.getElementById('formRegistro').reset();
    document.getElementById('formFecha').value = new Date().toISOString().split('T')[0];

    setText('formMensaje', `✔ Registro ${lote} agregado correctamente.`);
    setTimeout(() => setText('formMensaje', ''), 3500);

    renderKpis();
    renderGrafico();
    renderRegistros();
  }

  // ── Procesos para envío ────────────────────────────────────────────────────
  function renderEnvios() {
    const tbody = document.getElementById('tbodyEnvios');
    if (!tbody) return;

    tbody.innerHTML = ENVIOS.map(e => {
      const badge = e.estado === 'Listo'    ? 'badge--verde'
                  : e.estado === 'En prep.' ? 'badge--naranja'
                  : 'badge--gris';
      return `
        <tr>
          <td><strong>${e.orden}</strong></td>
          <td>${e.producto}</td>
          <td style="text-align:right">${formatNum(e.cantidad)} ${e.unidad}</td>
          <td>${e.destino}</td>
          <td>${formatFecha(e.fechaDesp)}</td>
          <td style="text-align:center"><span class="badge ${badge}">${e.estado}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Generar reporte CSV ────────────────────────────────────────────────────
  function generarReporte() {
    const { mes, anio } = getMesAnio();
    const datos  = getRegistrosFiltrados();
    const mesNom = MESES[mes - 1];

    if (!datos.length) {
      alert(`Sin registros para ${mesNom} ${anio}.`);
      return;
    }

    const cabecera = ['Lote','Fecha','Código','Producto','Cantidad','Unidad','Turno','Operario','Observación'];
    const filas = datos.map(r => [
      r.lote, r.fecha, r.cod, r.producto, r.cantidad, r.unidad, r.turno, r.operario, r.observacion,
    ].map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));

    const csv  = [cabecera.join(','), ...filas].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `produccion_${mesNom}_${anio}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render todo ────────────────────────────────────────────────────────────
  function renderTodo() {
    renderKpis();
    renderGrafico();
    renderRegistros();
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    const usuario = obtenerUsuario();
    cargarSidebar(usuario);
    initSelectores();
    renderProductos();
    renderEnvios();
    renderTodo();

    document.getElementById('filtroMes')?.addEventListener('change',  renderTodo);
    document.getElementById('filtroAnio')?.addEventListener('change', renderTodo);
    document.getElementById('btnActualizar')?.addEventListener('click', renderTodo);
    document.getElementById('formRegistro')?.addEventListener('submit', agregarRegistro);
    document.getElementById('btnReporte')?.addEventListener('click', generarReporte);

    const fechaInput = document.getElementById('formFecha');
    if (fechaInput) fechaInput.value = new Date().toISOString().split('T')[0];
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

