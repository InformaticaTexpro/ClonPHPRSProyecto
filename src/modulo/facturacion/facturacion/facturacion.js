'use strict';

/**
 * facturacion.js — Módulo de Facturación Texpro
 *
 * Frontend de demostración con datos ficticios.
 * Sin llamadas a API. Toda la lógica opera sobre estado local.
 */

(function () {

  // ── Constantes de fecha ────────────────────────────────────────────────────────
  const _hoy  = new Date();
  const _mes  = _hoy.getMonth() + 1;
  const _anio = _hoy.getFullYear();
  const _pad  = n => String(n).padStart(2, '0');
  const _pre  = `${_anio}-${_pad(_mes)}`;

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  // ── Mock data: pionetas ─────────────────────────────────────────────────────
  const PIONETAS = [
    { id:1, nombre:'Roberto Fuentes', ruta:'Ruta Norte',    zona:'Santiago Norte'   },
    { id:2, nombre:'Diego Castillo',  ruta:'Ruta Sur',      zona:'Santiago Sur'     },
    { id:3, nombre:'Marcos Herrera',  ruta:'Ruta Centro',   zona:'Santiago Centro'  },
    { id:4, nombre:'Felipe Vargas',   ruta:'Ruta Oriente',  zona:'Providencia'      },
    { id:5, nombre:'Andrés Morales',  ruta:'Ruta Poniente', zona:'Maipú / Pudahuel' },
  ];

  // ── Mock data: facturas del mes ──────────────────────────────────────────────────
  const FACTURAS_BASE = [
    { id: 1, numero:'F-0821-2026', cliente:'ESSAL S.A.',                monto:1250000, fecha:`${_pre}-02`, estado:'Cerrada',   pioneta:'Roberto Fuentes' },
    { id: 2, numero:'F-0822-2026', cliente:'Aguas Andinas S.A.',        monto: 890000, fecha:`${_pre}-02`, estado:'Cerrada',   pioneta:'Diego Castillo'  },
    { id: 3, numero:'F-0823-2026', cliente:'SMAPA Maipú',               monto: 450000, fecha:`${_pre}-03`, estado:'Cerrada',   pioneta:'Marcos Herrera'  },
    { id: 4, numero:'F-0824-2026', cliente:'MOP Santiago',              monto:1800000, fecha:`${_pre}-05`, estado:'Cerrada',   pioneta:'Felipe Vargas'   },
    { id: 5, numero:'F-0825-2026', cliente:'SISS Concepción',           monto: 675000, fecha:`${_pre}-05`, estado:'Cerrada',   pioneta:'Andrés Morales'  },
    { id: 6, numero:'F-0826-2026', cliente:'ANWANDTER Ltda.',           monto: 320000, fecha:`${_pre}-07`, estado:'Cerrada',   pioneta:'Roberto Fuentes' },
    { id: 7, numero:'F-0827-2026', cliente:'Aqua Chile S.A.',           monto:2100000, fecha:`${_pre}-07`, estado:'Cerrada',   pioneta:'Diego Castillo'  },
    { id: 8, numero:'F-0828-2026', cliente:'Aguas del Valle S.A.',      monto: 940000, fecha:`${_pre}-09`, estado:'Cerrada',   pioneta:'Marcos Herrera'  },
    { id: 9, numero:'F-0829-2026', cliente:'ESSBIO S.A.',               monto:1560000, fecha:`${_pre}-10`, estado:'En camino', pioneta:'Felipe Vargas'   },
    { id:10, numero:'F-0830-2026', cliente:'Industrias Coddou',         monto: 285000, fecha:`${_pre}-12`, estado:'Cerrada',   pioneta:'Andrés Morales'  },
    { id:11, numero:'F-0831-2026', cliente:'Municipalidad de Santiago', monto: 780000, fecha:`${_pre}-12`, estado:'Cerrada',   pioneta:'Roberto Fuentes' },
    { id:12, numero:'F-0832-2026', cliente:'SENDOS Aysén',              monto:1200000, fecha:`${_pre}-14`, estado:'En camino', pioneta:'Diego Castillo'  },
    { id:13, numero:'F-0833-2026', cliente:'ESSAL S.A.',                monto: 620000, fecha:`${_pre}-14`, estado:'Pendiente', pioneta:'Marcos Herrera'  },
    { id:14, numero:'F-0834-2026', cliente:'Aguas Andinas S.A.',        monto:1450000, fecha:`${_pre}-16`, estado:'Pendiente', pioneta:'Felipe Vargas'   },
    { id:15, numero:'F-0835-2026', cliente:'SMAPA Maipú',               monto: 390000, fecha:`${_pre}-17`, estado:'Pendiente', pioneta:'Andrés Morales'  },
    { id:16, numero:'F-0836-2026', cliente:'MOP Santiago',              monto:2250000, fecha:`${_pre}-19`, estado:'Pendiente', pioneta:'Roberto Fuentes' },
    { id:17, numero:'F-0837-2026', cliente:'SISS Concepción',           monto: 830000, fecha:`${_pre}-19`, estado:'En camino', pioneta:'Diego Castillo'  },
    { id:18, numero:'F-0838-2026', cliente:'ANWANDTER Ltda.',           monto: 560000, fecha:`${_pre}-21`, estado:'Pendiente', pioneta:'Marcos Herrera'  },
    { id:19, numero:'F-0839-2026', cliente:'Aqua Chile S.A.',           monto:1100000, fecha:`${_pre}-21`, estado:'Pendiente', pioneta:'Felipe Vargas'   },
    { id:20, numero:'F-0840-2026', cliente:'Aguas del Valle S.A.',      monto: 730000, fecha:`${_pre}-22`, estado:'En camino', pioneta:'Andrés Morales'  },
    { id:21, numero:'F-0841-2026', cliente:'ESSBIO S.A.',               monto:1890000, fecha:`${_pre}-22`, estado:'Pendiente', pioneta:'Roberto Fuentes' },
    { id:22, numero:'F-0842-2026', cliente:'Industrias Coddou',         monto: 440000, fecha:`${_pre}-23`, estado:'En camino', pioneta:'Diego Castillo'  },
    { id:23, numero:'F-0843-2026', cliente:'Municipalidad de Santiago', monto: 950000, fecha:`${_pre}-24`, estado:'Pendiente', pioneta:'Marcos Herrera'  },
    { id:24, numero:'F-0844-2026', cliente:'SENDOS Aysén',              monto:1350000, fecha:`${_pre}-26`, estado:'Pendiente', pioneta:'Felipe Vargas'   },
    { id:25, numero:'F-0845-2026', cliente:'ESSAL S.A.',                monto: 680000, fecha:`${_pre}-26`, estado:'Pendiente', pioneta:'Andrés Morales'  },
  ];

  // ── Mock data: notas de venta ────────────────────────────────────────────────────
  const NOTAS_VENTAS = [
    { id:1,  numero:'NV-0541-2026', cliente:'ESSAL S.A.',                items:3, monto: 978000, fecha:`${_pre}-01`, estado:'Facturada'  },
    { id:2,  numero:'NV-0542-2026', cliente:'Aguas Andinas S.A.',        items:2, monto: 567000, fecha:`${_pre}-02`, estado:'Facturada'  },
    { id:3,  numero:'NV-0543-2026', cliente:'SMAPA Maipú',               items:4, monto:1230000, fecha:`${_pre}-05`, estado:'Pendiente'  },
    { id:4,  numero:'NV-0544-2026', cliente:'MOP Santiago',              items:2, monto: 890000, fecha:`${_pre}-06`, estado:'Facturada'  },
    { id:5,  numero:'NV-0545-2026', cliente:'SISS Concepción',           items:3, monto: 640000, fecha:`${_pre}-09`, estado:'Pendiente'  },
    { id:6,  numero:'NV-0546-2026', cliente:'ANWANDTER Ltda.',           items:1, monto: 280000, fecha:`${_pre}-12`, estado:'En proceso' },
    { id:7,  numero:'NV-0547-2026', cliente:'Aqua Chile S.A.',           items:5, monto:2100000, fecha:`${_pre}-14`, estado:'Pendiente'  },
    { id:8,  numero:'NV-0548-2026', cliente:'Aguas del Valle S.A.',      items:2, monto: 750000, fecha:`${_pre}-17`, estado:'Facturada'  },
    { id:9,  numero:'NV-0549-2026', cliente:'ESSBIO S.A.',               items:3, monto:1480000, fecha:`${_pre}-20`, estado:'En proceso' },
    { id:10, numero:'NV-0550-2026', cliente:'Industrias Coddou',         items:2, monto: 390000, fecha:`${_pre}-22`, estado:'Facturada'  },
  ];

  // ── Mock data: cotizaciones (Softland) ──────────────────────────────────────────────────
  const COTIZACIONES = [
    { id:1, numero:'COT-2026-0228', cliente:'Aqua Chile S.A.',            items:4, monto:2450000, fecha:`${_anio}-04-28`, vencimiento:`${_anio}-06-28`, estado:'Vigente'   },
    { id:2, numero:'COT-2026-0229', cliente:'Municipalidad de Santiago',  items:3, monto:1100000, fecha:`${_anio}-05-02`, vencimiento:`${_anio}-06-02`, estado:'Vigente'   },
    { id:3, numero:'COT-2026-0230', cliente:'SENDOS Aysén',               items:2, monto: 890000, fecha:`${_anio}-04-15`, vencimiento:`${_anio}-05-15`, estado:'Aceptada'  },
    { id:4, numero:'COT-2026-0231', cliente:'ESSAL S.A.',                 items:6, monto:3200000, fecha:`${_anio}-05-05`, vencimiento:`${_anio}-07-05`, estado:'Vigente'   },
    { id:5, numero:'COT-2026-0232', cliente:'Aguas Andinas S.A.',         items:4, monto:1750000, fecha:`${_anio}-04-20`, vencimiento:`${_anio}-05-20`, estado:'Aceptada'  },
    { id:6, numero:'COT-2026-0233', cliente:'SMAPA Maipú',                items:2, monto: 450000, fecha:`${_anio}-03-10`, vencimiento:`${_anio}-04-10`, estado:'Vencida'   },
    { id:7, numero:'COT-2026-0234', cliente:'Industrias Coddou',          items:2, monto: 680000, fecha:`${_anio}-03-20`, vencimiento:`${_anio}-04-20`, estado:'Rechazada' },
    { id:8, numero:'COT-2026-0235', cliente:'ESSBIO S.A.',                items:5, monto:2890000, fecha:`${_anio}-05-10`, vencimiento:`${_anio}-07-10`, estado:'Vigente'   },
  ];

  // ── Mock data: stock de productos (basado en notas de venta) ────────────────────────────────────────────
  const STOCK_PRODUCTOS = [
    { codigo:'CLG-001', nombre:'Cloro Granulado 90%',      unidad:'kg', stockFisico:2500, comprometido: 750, minimo:300 },
    { codigo:'SAL-002', nombre:'Sulfato de Aluminio',      unidad:'kg', stockFisico:3200, comprometido:1200, minimo:500 },
    { codigo:'HNS-003', nombre:'Hipoclorito de Sodio 10%', unidad:'L',  stockFisico:1800, comprometido: 600, minimo:200 },
    { codigo:'ACM-004', nombre:'Ácido Muriático 32%',      unidad:'L',  stockFisico: 950, comprometido: 350, minimo:100 },
    { codigo:'PLF-005', nombre:'Polímero Floculante',      unidad:'kg', stockFisico: 800, comprometido: 250, minimo:150 },
    { codigo:'SDC-006', nombre:'Soda Cáustica 50%',        unidad:'kg', stockFisico:1400, comprometido: 480, minimo:200 },
    { codigo:'FEC-007', nombre:'Ferrocloruro Líquido',     unidad:'L',  stockFisico: 600, comprometido: 180, minimo:100 },
    { codigo:'PCL-008', nombre:'Policloruro de Aluminio',  unidad:'kg', stockFisico:1100, comprometido: 320, minimo:200 },
  ];

  // ── Estado mutable (filtros de la tabla de facturas) ──────────────────────────────────────────────────
  let graficoFact     = null;
  let _filtroEstado   = 'Todos';
  let _filtroPioneta  = 'Todos';
  let _busqueda       = '';
  let asignacionesDespacho = [];
  let pionetaDetalleActivo = '';

  // ── Helpers ────────────────────────────────────────────────────────────────────────
  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function formatNum(n) {
    return Number(n).toLocaleString('es-CL');
  }

  function formatMoney(n) {
    return '$ ' + Number(n).toLocaleString('es-CL');
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

  function getFacturasMes() {
    const { mes, anio } = getMesAnio();
    const prefijo = `${anio}-${_pad(mes)}`;
    return FACTURAS_BASE.filter(f => f.fecha.startsWith(prefijo));
  }

  function getFacturaByNumero(numero) {
    return FACTURAS_BASE.find(f => f.numero === numero);
  }

  // ── Mock sesión ───────────────────────────────────────────────────────────────────
  function obtenerUsuario() {
    try {
      const raw = localStorage.getItem('user');
      if (raw) return JSON.parse(raw);
    } catch { /* ignorar */ }
    return { nombre:'Demo Facturación', email:'demo@texpro.cl', area:'facturacion', is_admin:true };
  }

  // ── MODULOS ────────────────────────────────────────────────────────────────────────
  const MODULOS = [
    { nombre:'Dashboard',      icon:'🏠', url:'../../ventas/dashboard/index.html',                   area: null },
    { nombre:'Ventas',         icon:'📊', url:'../../ventas/ventas/index.html',                      area:['ventas','gerencia'] },
    { nombre:'Producción',     icon:'⚙️', url:'../../produccion/produccion/index.html',             area:['produccion','gerencia'] },
    { nombre:'Serv. TEC',      icon:'🛠️', url:'../../servtecnico/servicio-tecnico/index.html',     area:['servicio-tecnico','servicio','gerencia'] },
    { nombre:'Bodega',         icon:'🏭', url:'../../bodega/bodega/index.html',                      area:['bodega','produccion','gerencia'] },
    { nombre:'Laboratorio',    icon:'🧪', url:'../../laboratorio/laboratorio/index.html',            area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',       icon:'💰', url:'../../cobranza/cobranza/index.html',                  area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',           icon:'👥', url:'../../rrhh/rrhh/index.html',                          area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',   icon:'📜', url:'../../contabilidad/contabilidad/index.html',          area:['contabilidad','gerencia'] },
    { nombre:'Administración', icon:'🔧', url:'../../admin/admin/index.html',                        area:['admin'] },
    { nombre:'Alertas',        icon:'🔔', url:'../../varios/alertas/index.html',                    area: null },
  ];

  // ── Sidebar ────────────────────────────────────────────────────────────────────────
  function cargarSidebar(usuario) {
    const ini = (usuario.nombre || 'U').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    setText('userName',      usuario.nombre || usuario.email);
    setText('userArea',      usuario.area   || '');
    setText('userAvatar',    ini);
    setText('chipAvatar',    ini);
    setText('chipName',      (usuario.nombre || usuario.email).split(' ')[0]);
    setText('headerDate',    new Date().toLocaleDateString('es-CL',
      { weekday:'long', year:'numeric', month:'long', day:'numeric' }));
    setText('welcomeTitle',    `Hola, ${(usuario.nombre||usuario.email).split(' ')[0]} 🧾`);
    setText('welcomeSubtitle', `Área: ${usuario.area||'Facturación'} — Texpro`);

    const visibles = MODULOS.filter(m => {
      if (m.area === null) return true;
      if (usuario.is_admin) return true;
      return m.area.includes(usuario.area);
    });

    const nav = document.getElementById('sidebarNav');
    if (nav) nav.innerHTML = `
      <span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">
        <span style="font-size:1rem">🧾</span>
        <span class="nav-label">Facturación</span>
      </a>
      ${visibles.map(m => `
        <a class="nav-item" href="${m.url}">
          <span style="font-size:1rem">${m.icon}</span>
          <span class="nav-label">${m.nombre}</span>
        </a>`).join('')}`;

    document.getElementById('btnLogout')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '../../varios/login/index.html';
    });
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper')?.classList.toggle('main-wrapper--expanded');
    });
    document.getElementById('headerMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--mobile-open');
    });
  }

  // ── Selectores ────────────────────────────────────────────────────────────────────────
  function initSelectores() {
    const selMes  = document.getElementById('filtroMes');
    const selAnio = document.getElementById('filtroAnio');
    if (selMes) {
      MESES.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = i + 1; o.textContent = m;
        if (i + 1 === _mes) o.selected = true;
        selMes.appendChild(o);
      });
    }
    if (selAnio) {
      for (let y = _anio; y >= 2026; y--) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === _anio) o.selected = true;
        selAnio.appendChild(o);
      }
    }

    const selPioneta = document.getElementById('filtroPionetaFact');
    if (selPioneta) {
      PIONETAS.forEach(p => {
        const o = document.createElement('option');
        o.value = p.nombre; o.textContent = p.nombre;
        selPioneta.appendChild(o);
      });
    }
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────────────
  function renderKpis() {
    const datos      = getFacturasMes();
    const cerradas   = datos.filter(f => f.estado === 'Cerrada').length;
    const enCamino   = datos.filter(f => f.estado === 'En camino').length;
    const pendientes = datos.filter(f => f.estado === 'Pendiente').length;
    const montoPend  = datos.filter(f => f.estado !== 'Cerrada')
                           .reduce((s, f) => s + f.monto, 0);
    const pct = datos.length > 0 ? Math.round((cerradas / datos.length) * 100) : 0;

    setText('kpiTotalFact',     datos.length + ' facturas');
    setText('kpiCerradas',      cerradas     + ' cerradas');
    setText('kpiEnCamino',      enCamino     + ' en camino');
    setText('kpiPendientes',    pendientes   + ' pendientes');
    setText('kpiMontoPend',     formatMoney(montoPend));
    setText('pctCerradas',      pct + '% completado');

    const fill = document.getElementById('progresoFactFill');
    if (fill) {
      fill.style.width      = pct + '%';
      fill.style.background = pct >= 80 ? 'var(--color-primary)'
                            : pct >= 50 ? '#F5A623'
                            : 'var(--color-danger)';
    }
  }

  // ── Gráfico: facturas por pioneta (barras apiladas) ──────────────────────────────────────────────────
  function renderGrafico() {
    const datos   = getFacturasMes();
    const labels  = PIONETAS.map(p => p.nombre.split(' ')[0]);
    const cerradas  = PIONETAS.map(p => datos.filter(f => f.pioneta === p.nombre && f.estado === 'Cerrada').length);
    const enCamino  = PIONETAS.map(p => datos.filter(f => f.pioneta === p.nombre && f.estado === 'En camino').length);
    const pendientes= PIONETAS.map(p => datos.filter(f => f.pioneta === p.nombre && f.estado === 'Pendiente').length);

    const ctx = document.getElementById('graficoFacturas');
    if (!ctx) return;
    if (graficoFact) graficoFact.destroy();

    graficoFact = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label:'Cerradas',   data:cerradas,   backgroundColor:'rgba(0,200,140,0.75)',  borderColor:'#00C88C', borderWidth:1, borderRadius:3 },
          { label:'En camino',  data:enCamino,   backgroundColor:'rgba(245,166,35,0.75)', borderColor:'#F5A623', borderWidth:1, borderRadius:3 },
          { label:'Pendientes', data:pendientes, backgroundColor:'rgba(239,68,68,0.65)',  borderColor:'#EF4444', borderWidth:1, borderRadius:3 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position:'top', labels:{ font:{ family:'Open Sans', size:11 }, boxWidth:12 } },
          tooltip: { callbacks:{ label: c => ` ${c.dataset.label}: ${c.parsed.y}` } },
        },
        scales: {
          x: { stacked:true, ticks:{ font:{ family:'Open Sans', size:11 } }, grid:{ display:false } },
          y: { stacked:true, beginAtZero:true, ticks:{ font:{ family:'Open Sans', size:11 }, stepSize:1 }, grid:{ color:'rgba(0,0,0,0.05)' } },
        },
      },
    });
  }

  // ── Tabla asignaciones por pioneta ───────────────────────────────────────────────────────────────────────────────
  function renderAsignaciones() {
    const tbody = document.getElementById('tbodyAsignaciones');
    if (!tbody) return;

    const datos = getFacturasMes();

    tbody.innerHTML = PIONETAS.map(p => {
      const asig   = datos.filter(f => f.pioneta === p.nombre);
      const cerr   = asig.filter(f => f.estado === 'Cerrada').length;
      const camin  = asig.filter(f => f.estado === 'En camino').length;
      const pend   = asig.filter(f => f.estado === 'Pendiente').length;
      const total  = asig.length;
      const pct    = total > 0 ? Math.round((cerr / total) * 100) : 0;
      const color  = pct >= 80 ? 'var(--color-primary)' : pct >= 50 ? '#F5A623' : 'var(--color-danger)';

      return `
        <tr>
          <td><button class="fac-pioneta-btn" type="button" data-pioneta="${p.nombre}">${p.nombre}</button></td>
          <td>${p.ruta}</td>
          <td>${p.zona}</td>
          <td style="text-align:center"><strong>${total}</strong></td>
          <td style="text-align:center"><span class="badge badge--verde">${cerr}</span></td>
          <td style="text-align:center"><span class="badge badge--naranja">${camin}</span></td>
          <td style="text-align:center"><span class="badge badge--rojo">${pend}</span></td>
          <td>
            <div class="mini-barra-bg">
              <div class="mini-barra-fill" style="width:${pct}%;background:${color}"></div>
            </div>
            <span class="mini-pct">${pct}%</span>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('.fac-pioneta-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const nombre = btn.getAttribute('data-pioneta') || '';
        if (!nombre) return;
        pionetaDetalleActivo = nombre;
        renderDetallePioneta(nombre);
      });
    });

    if (!pionetaDetalleActivo && PIONETAS.length) {
      pionetaDetalleActivo = PIONETAS[0].nombre;
    }
    if (pionetaDetalleActivo) renderDetallePioneta(pionetaDetalleActivo);
  }

  function getDetallePioneta(nombrePioneta) {
    const base = getFacturasMes()
      .filter(f => f.pioneta === nombrePioneta)
      .map(f => {
        const pionetaData = PIONETAS.find(p => p.nombre === f.pioneta);
        return {
          factura: f.numero,
          cliente: f.cliente,
          ruta: pionetaData ? pionetaData.ruta : '—',
          fecha: f.fecha,
          estado: f.estado,
          origen: 'Facturación',
        };
      });

    const visual = asignacionesDespacho
      .filter(a => a.pioneta === nombrePioneta)
      .map(a => ({
        factura: a.factura,
        cliente: a.cliente,
        ruta: a.ruta,
        fecha: a.fechaDespacho,
        estado: a.estado,
        origen: 'Asignación visual',
      }));

    const seen = new Set();
    const merged = [...visual, ...base].filter(item => {
      const key = `${item.factura}-${item.origen}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return merged.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  function renderDetallePioneta(nombrePioneta) {
    const datos = getDetallePioneta(nombrePioneta);

    setText('detPionetaNombre', nombrePioneta || '—');
    setText('detPionetaTotal', String(datos.length));

    const cerradas = datos.filter(d => d.estado === 'Cerrada').length;
    const camino = datos.filter(d => d.estado === 'En camino' || d.estado === 'Despacho en curso').length;
    const pendientes = datos.filter(d => !(d.estado === 'Cerrada' || d.estado === 'En camino' || d.estado === 'Despacho en curso')).length;
    setText('detPionetaCerradas', String(cerradas));
    setText('detPionetaCamino', String(camino));
    setText('detPionetaPendientes', String(pendientes));

    const tbody = document.getElementById('tbodyDetallePioneta');
    if (!tbody) return;

    if (!datos.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin facturas asignadas para este pioneta</td></tr>';
      return;
    }

    tbody.innerHTML = datos.map(d => {
      const badge = d.estado === 'Cerrada' ? 'badge--verde'
                  : (d.estado === 'En camino' || d.estado === 'Despacho en curso') ? 'badge--naranja'
                  : 'badge--rojo';
      return `
        <tr>
          <td><strong>${d.factura}</strong></td>
          <td>${d.cliente}</td>
          <td>${d.ruta}</td>
          <td>${formatFecha(d.fecha)}</td>
          <td style="text-align:center"><span class="badge ${badge}">${d.estado}</span></td>
          <td>${d.origen}</td>
        </tr>`;
    }).join('');
  }

  // ── Submenú interno ─────────────────────────────────────────────────────────────────────────────
  function initSubmenu() {
    const botones = Array.from(document.querySelectorAll('.fac-submenu-btn'));
    if (!botones.length) return;

    botones.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-target');
        if (!target) return;

        botones.forEach(b => b.classList.remove('fac-submenu-btn--active'));
        btn.classList.add('fac-submenu-btn--active');

        document.querySelectorAll('.fac-subpanel').forEach(p => p.classList.remove('fac-subpanel--active'));
        document.getElementById(target)?.classList.add('fac-subpanel--active');
      });
    });
  }

  // ── Apartado visual: asignación de despacho ────────────────────────────────────────────────────────────────────
  function initAsignacionDespacho() {
    const hoyIso = new Date().toISOString().split('T')[0];
    const inputFecha = document.getElementById('fechaDespachoAsignar');
    if (inputFecha) inputFecha.value = hoyIso;

    const selFactura = document.getElementById('selFacturaAsignar');
    const selPioneta = document.getElementById('selPionetaAsignar');
    const inputRuta = document.getElementById('selRutaAsignar');
    if (!selFactura || !selPioneta) return;

    const facturasDisponibles = getFacturasMes().filter(f => f.estado !== 'Cerrada');
    facturasDisponibles.forEach(f => {
      const o = document.createElement('option');
      o.value = f.numero;
      o.textContent = `${f.numero} · ${f.cliente}`;
      selFactura.appendChild(o);
    });

    PIONETAS.forEach(p => {
      const o = document.createElement('option');
      o.value = p.nombre;
      o.textContent = p.nombre;
      selPioneta.appendChild(o);
    });

    selFactura.addEventListener('change', () => {
      const factura = getFacturaByNumero(selFactura.value);
      if (!factura) {
        if (inputRuta) inputRuta.value = '';
        return;
      }

      const pioneta = PIONETAS.find(p => p.nombre === factura.pioneta);
      if (pioneta) {
        selPioneta.value = pioneta.nombre;
        if (inputRuta) inputRuta.value = pioneta.ruta;
      }
    });

    asignacionesDespacho = facturasDisponibles.slice(0, 8).map((f, i) => {
      const pion = PIONETAS[i % PIONETAS.length];
      return {
        factura: f.numero,
        cliente: f.cliente,
        pioneta: pion.nombre,
        ruta: pion.ruta,
        fechaDespacho: f.fecha,
        estado: f.estado === 'En camino' ? 'Despacho en curso' : 'Asignada',
      };
    });

    renderAsignacionDespacho();

    document.getElementById('formAsignacionDespacho')?.addEventListener('submit', e => {
      e.preventDefault();

      const facturaN = selFactura.value;
      const pionetaN = selPioneta.value;
      const ruta = (document.getElementById('selRutaAsignar')?.value || '').trim();
      const fechaDespacho = document.getElementById('fechaDespachoAsignar')?.value;
      if (!facturaN || !pionetaN || !ruta || !fechaDespacho) return;

      const factura = getFacturaByNumero(facturaN);
      if (!factura) return;

      asignacionesDespacho.unshift({
        factura: factura.numero,
        cliente: factura.cliente,
        pioneta: pionetaN,
        ruta,
        fechaDespacho,
        estado: 'Asignada',
      });

      setText('msgAsignacion', `Asignación visual creada para ${factura.numero}.`);
      setTimeout(() => setText('msgAsignacion', ''), 2600);
      renderAsignacionDespacho();
      if (pionetaDetalleActivo === pionetaN) renderDetallePioneta(pionetaDetalleActivo);
    });
  }

  function renderAsignacionDespacho() {
    const tbody = document.getElementById('tbodyAsignacionDespacho');
    if (!tbody) return;

    if (!asignacionesDespacho.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin asignaciones visuales</td></tr>';
      return;
    }

    tbody.innerHTML = asignacionesDespacho.map(a => {
      const badge = a.estado === 'Despacho en curso' ? 'badge--naranja' : 'badge--azul';
      return `
        <tr>
          <td><strong>${a.factura}</strong></td>
          <td>${a.cliente}</td>
          <td>${a.pioneta}</td>
          <td>${a.ruta}</td>
          <td>${formatFecha(a.fechaDespacho)}</td>
          <td style="text-align:center"><span class="badge ${badge}">${a.estado}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Tabla facturas (con filtros inline) ──────────────────────────────────────────────────────────────────────
  function renderFacturas() {
    const tbody = document.getElementById('tbodyFacturas');
    if (!tbody) return;

    let datos = getFacturasMes();

    if (_filtroEstado  !== 'Todos') datos = datos.filter(f => f.estado  === _filtroEstado);
    if (_filtroPioneta !== 'Todos') datos = datos.filter(f => f.pioneta === _filtroPioneta);
    if (_busqueda) {
      const q = _busqueda.toLowerCase();
      datos = datos.filter(f =>
        f.numero.toLowerCase().includes(q)  ||
        f.cliente.toLowerCase().includes(q) ||
        f.pioneta.toLowerCase().includes(q));
    }

    const contEl = document.getElementById('contadorFacturas');
    if (contEl) contEl.textContent = `${datos.length} factura${datos.length !== 1 ? 's' : ''}`;

    if (!datos.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin facturas para los filtros seleccionados</td></tr>';
      return;
    }

    tbody.innerHTML = datos.map(f => {
      const badge = f.estado === 'Cerrada'   ? 'badge--verde'
                  : f.estado === 'En camino' ? 'badge--naranja'
                  : 'badge--rojo';
      return `
        <tr>
          <td><strong>${f.numero}</strong></td>
          <td>${f.cliente}</td>
          <td style="text-align:right">${formatMoney(f.monto)}</td>
          <td>${formatFecha(f.fecha)}</td>
          <td>${f.pioneta}</td>
          <td style="text-align:center"><span class="badge ${badge}">${f.estado}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Tabla stock de productos ───────────────────────────────────────────────────────────────────────────────
  function renderStock() {
    const tbody = document.getElementById('tbodyStock');
    if (!tbody) return;

    tbody.innerHTML = STOCK_PRODUCTOS.map(p => {
      const disponible = p.stockFisico - p.comprometido;
      const alerta     = disponible <= p.minimo;
      const pct        = Math.min(Math.round((disponible / p.stockFisico) * 100), 100);
      const alertaBadge= alerta ? 'badge--rojo' : disponible <= p.minimo * 1.5 ? 'badge--naranja' : 'badge--verde';
      const alertaTxt  = alerta ? '⚠ Bajo mínimo' : 'OK';

      return `
        <tr${alerta ? ' style="background:rgba(239,68,68,0.03)"' : ''}>
          <td><code class="fac-codigo">${p.codigo}</code></td>
          <td><strong>${p.nombre}</strong></td>
          <td style="text-align:center">${p.unidad}</td>
          <td style="text-align:right">${formatNum(p.stockFisico)}</td>
          <td style="text-align:right">${formatNum(p.comprometido)}</td>
          <td style="text-align:right"><strong>${formatNum(disponible)}</strong></td>
          <td style="text-align:right">${formatNum(p.minimo)}</td>
          <td>
            <div class="mini-barra-bg">
              <div class="mini-barra-fill" style="width:${pct}%;background:${alerta?'var(--color-danger)':'var(--color-primary)'}"></div>
            </div>
            <span class="mini-pct">${pct}%</span>
          </td>
          <td style="text-align:center"><span class="badge ${alertaBadge}">${alertaTxt}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Tabla notas de venta ─────────────────────────────────────────────────────────────────────────────────
  function renderNotasVentas() {
    const tbody = document.getElementById('tbodyNV');
    if (!tbody) return;

    tbody.innerHTML = NOTAS_VENTAS.map(nv => {
      const badge = nv.estado === 'Facturada'  ? 'badge--verde'
                  : nv.estado === 'En proceso' ? 'badge--naranja'
                  : 'badge--gris';
      return `
        <tr>
          <td><strong>${nv.numero}</strong></td>
          <td>${nv.cliente}</td>
          <td style="text-align:center">${nv.items} ítem${nv.items !== 1 ? 's' : ''}</td>
          <td style="text-align:right">${formatMoney(nv.monto)}</td>
          <td>${formatFecha(nv.fecha)}</td>
          <td style="text-align:center"><span class="badge ${badge}">${nv.estado}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Tabla cotizaciones ─────────────────────────────────────────────────────────────────────────────────
  function renderCotizaciones() {
    const tbody = document.getElementById('tbodyCot');
    if (!tbody) return;

    tbody.innerHTML = COTIZACIONES.map(c => {
      const badge = c.estado === 'Aceptada'  ? 'badge--verde'
                  : c.estado === 'Vigente'   ? 'badge--azul'
                  : c.estado === 'Rechazada' ? 'badge--rojo'
                  : 'badge--gris';
      return `
        <tr>
          <td><strong>${c.numero}</strong></td>
          <td>${c.cliente}</td>
          <td style="text-align:center">${c.items} ítems</td>
          <td style="text-align:right">${formatMoney(c.monto)}</td>
          <td>${formatFecha(c.fecha)}</td>
          <td>${formatFecha(c.vencimiento)}</td>
          <td style="text-align:center"><span class="badge ${badge}">${c.estado}</span></td>
        </tr>`;
    }).join('');
  }

  // ── Exportar facturas CSV ───────────────────────────────────────────────────────────────────────────
  function exportarFacturasCSV() {
    const { mes, anio } = getMesAnio();
    let datos = getFacturasMes();
    if (_filtroEstado  !== 'Todos') datos = datos.filter(f => f.estado  === _filtroEstado);
    if (_filtroPioneta !== 'Todos') datos = datos.filter(f => f.pioneta === _filtroPioneta);

    if (!datos.length) { alert('Sin facturas para exportar con los filtros actuales.'); return; }

    const cabecera = ['Número','Cliente','Monto','Fecha','Pioneta','Estado'];
    const filas    = datos.map(f =>
      [f.numero, f.cliente, f.monto, f.fecha, f.pioneta, f.estado]
        .map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));

    const csv  = [cabecera.join(','), ...filas].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `facturas_${MESES[mes - 1]}_${anio}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Render todo (dependiente del mes/año seleccionado) ───────────────────────────────────────────────────
  function renderTodo() {
    renderKpis();
    renderGrafico();
    renderAsignaciones();
    renderFacturas();
  }

  // ── Init ───────────────────────────────────────────────────────────────────────────
  function init() {
    const usuario = obtenerUsuario();
    cargarSidebar(usuario);
    initSelectores();
    initSubmenu();
    initAsignacionDespacho();
    renderStock();
    renderNotasVentas();
    renderCotizaciones();
    renderTodo();

    document.getElementById('filtroMes')?.addEventListener('change',  renderTodo);
    document.getElementById('filtroAnio')?.addEventListener('change', renderTodo);
    document.getElementById('btnActualizar')?.addEventListener('click', renderTodo);

    document.getElementById('filtroEstadoFact')?.addEventListener('change', e => {
      _filtroEstado = e.target.value;
      renderFacturas();
    });
    document.getElementById('filtroPionetaFact')?.addEventListener('change', e => {
      _filtroPioneta = e.target.value;
      renderFacturas();
    });
    document.getElementById('buscarFact')?.addEventListener('input', e => {
      _busqueda = e.target.value.trim();
      renderFacturas();
    });

    document.getElementById('btnExportarFact')?.addEventListener('click', exportarFacturasCSV);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

