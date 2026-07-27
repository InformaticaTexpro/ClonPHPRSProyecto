'use strict';

/**
 * servicio-tecnico.js — Módulo Servicio Técnico Texpro
 *
 * Frontend de demostración con datos ficticios.
 * Sin llamadas a API. Toda la lógica opera sobre estado local.
 */

(function () {

  const _hoy  = new Date();
  const _mes  = _hoy.getMonth() + 1;
  const _anio = _hoy.getFullYear();
  const _pad  = n => String(n).padStart(2, '0');
  const _pre  = `${_anio}-${_pad(_mes)}`;

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  const TECNICOS = [
    { nombre: 'Luis Pérez',  especialidad: 'Instalaciones', ruta: 'Zona Norte' },
    { nombre: 'Marco Soto',  especialidad: 'Mantenimiento', ruta: 'Zona Centro' },
    { nombre: 'Felipe Díaz', especialidad: 'Visitas',       ruta: 'Zona Sur' },
    { nombre: 'Javier Rojas', especialidad: 'Cambios',      ruta: 'Zona Oriente' },
  ];

  const CLIENTES_MAQUINARIA = [
    { cliente: 'ESSAL S.A.',                maquinaria: 'Sistema de dosificación', instalado: `${_anio}-01-12`, mantenimiento: `${_anio}-06-12`, cambio: 'Bomba dosificadora', tecnico: 'Luis Pérez',  estado: 'Operativa' },
    { cliente: 'Aguas Andinas S.A.',        maquinaria: 'Planta compacta',       instalado: `${_anio}-02-08`, mantenimiento: `${_anio}-07-08`, cambio: 'Tablero de control',   tecnico: 'Marco Soto',  estado: 'Operativa' },
    { cliente: 'SMAPA Maipú',               maquinaria: 'Sistema cloración',    instalado: `${_anio}-03-18`, mantenimiento: `${_anio}-08-18`, cambio: 'Mangueras',           tecnico: 'Felipe Díaz', estado: 'En revisión' },
    { cliente: 'MOP Santiago',               maquinaria: 'Estación de bombeo',    instalado: `${_anio}-04-20`, mantenimiento: `${_anio}-09-20`, cambio: 'Sensores',            tecnico: 'Luis Pérez',  estado: 'Operativa' },
    { cliente: 'SISS Concepción',           maquinaria: 'Sistema industrial',    instalado: `${_anio}-05-10`, mantenimiento: `${_anio}-10-10`, cambio: 'Válvulas',            tecnico: 'Javier Rojas', estado: 'Mantenimiento' },
    { cliente: 'Aqua Chile S.A.',           maquinaria: 'Unidad móvil',          instalado: `${_anio}-06-01`, mantenimiento: `${_anio}-11-01`, cambio: 'Filtros',             tecnico: 'Marco Soto',  estado: 'Operativa' },
    { cliente: 'Municipalidad de Santiago', maquinaria: 'Sistema automático',   instalado: `${_anio}-02-26`, mantenimiento: `${_anio}-07-26`, cambio: 'Kit de sensores',     tecnico: 'Felipe Díaz', estado: 'Operativa' },
  ];

  const SERVICIOS = [
    { id:1, fecha:`${_pre}-02`, tipo:'Instalación', cliente:'ESSAL S.A.',                tecnico:'Luis Pérez',  ruta:'Zona Norte',   estado:'Realizado' },
    { id:2, fecha:`${_pre}-03`, tipo:'Visita',      cliente:'Aguas Andinas S.A.',        tecnico:'Marco Soto',  ruta:'Zona Centro',  estado:'Realizado' },
    { id:3, fecha:`${_pre}-05`, tipo:'Mantenimiento', cliente:'SMAPA Maipú',             tecnico:'Felipe Díaz', ruta:'Zona Sur',     estado:'Pendiente'  },
    { id:4, fecha:`${_pre}-06`, tipo:'Cambio',      cliente:'MOP Santiago',              tecnico:'Luis Pérez',  ruta:'Zona Norte',   estado:'Realizado' },
    { id:5, fecha:`${_pre}-07`, tipo:'Visita',      cliente:'SISS Concepción',           tecnico:'Javier Rojas', ruta:'Zona Oriente', estado:'Pendiente'  },
    { id:6, fecha:`${_pre}-08`, tipo:'Instalación', cliente:'Aqua Chile S.A.',           tecnico:'Marco Soto',   ruta:'Zona Centro',  estado:'Realizado' },
    { id:7, fecha:`${_pre}-09`, tipo:'Visita',      cliente:'Municipalidad de Santiago', tecnico:'Felipe Díaz',  ruta:'Zona Sur',     estado:'Realizado' },
    { id:8, fecha:`${_pre}-10`, tipo:'Mantenimiento', cliente:'ESSAL S.A.',              tecnico:'Luis Pérez',   ruta:'Zona Norte',   estado:'Realizado' },
    { id:9, fecha:`${_pre}-11`, tipo:'Cambio',      cliente:'Aguas Andinas S.A.',        tecnico:'Javier Rojas', ruta:'Zona Oriente', estado:'Pendiente'  },
    { id:10, fecha:`${_pre}-12`, tipo:'Visita',     cliente:'SMAPA Maipú',               tecnico:'Marco Soto',   ruta:'Zona Centro',  estado:'Realizado' },
    { id:11, fecha:`${_pre}-13`, tipo:'Instalación', cliente:'MOP Santiago',             tecnico:'Felipe Díaz',  ruta:'Zona Sur',     estado:'Pendiente'  },
    { id:12, fecha:`${_pre}-14`, tipo:'Mantenimiento', cliente:'SISS Concepción',        tecnico:'Luis Pérez',   ruta:'Zona Norte',   estado:'Realizado' },
    { id:13, fecha:`${_pre}-15`, tipo:'Visita',     cliente:'Aqua Chile S.A.',           tecnico:'Marco Soto',   ruta:'Zona Centro',  estado:'Realizado' },
    { id:14, fecha:`${_pre}-16`, tipo:'Cambio',     cliente:'Municipalidad de Santiago', tecnico:'Javier Rojas', ruta:'Zona Oriente', estado:'Pendiente'  },
    { id:15, fecha:`${_pre}-18`, tipo:'Visita',     cliente:'ESSAL S.A.',                tecnico:'Luis Pérez',   ruta:'Zona Norte',   estado:'Realizado' },
    { id:16, fecha:`${_pre}-19`, tipo:'Instalación', cliente:'SISS Concepción',          tecnico:'Felipe Díaz',  ruta:'Zona Sur',     estado:'Realizado' },
    { id:17, fecha:`${_pre}-21`, tipo:'Mantenimiento', cliente:'Aguas Andinas S.A.',     tecnico:'Marco Soto',   ruta:'Zona Centro',  estado:'Pendiente'  },
    { id:18, fecha:`${_pre}-22`, tipo:'Visita',     cliente:'MOP Santiago',              tecnico:'Javier Rojas', ruta:'Zona Oriente', estado:'Realizado' },
    { id:19, fecha:`${_pre}-24`, tipo:'Cambio',     cliente:'Aqua Chile S.A.',           tecnico:'Luis Pérez',   ruta:'Zona Norte',   estado:'Pendiente'  },
    { id:20, fecha:`${_pre}-26`, tipo:'Visita',     cliente:'Municipalidad de Santiago', tecnico:'Marco Soto',   ruta:'Zona Centro',  estado:'Realizado' },
  ];

  const VISITAS_PENDIENTES = [
    { cliente:'SMAPA Maipú',               tipo:'Mantenimiento', tecnico:'Felipe Díaz', ruta:'Zona Sur',     fechaEstimada:`${_anio}-${_pad(_mes)}-28` },
    { cliente:'SISS Concepción',           tipo:'Visita',        tecnico:'Javier Rojas', ruta:'Zona Oriente', fechaEstimada:`${_anio}-${_pad(_mes)}-28` },
    { cliente:'Aguas Andinas S.A.',        tipo:'Mantenimiento', tecnico:'Marco Soto',   ruta:'Zona Centro',  fechaEstimada:`${_anio}-${_pad(_mes+1 > 12 ? 1 : _mes+1)}-02` },
    { cliente:'Aqua Chile S.A.',           tipo:'Cambio',        tecnico:'Luis Pérez',    ruta:'Zona Norte',   fechaEstimada:`${_anio}-${_pad(_mes+1 > 12 ? 1 : _mes+1)}-03` },
  ];

  const TECH_ASSIGNMENTS = [
    { tecnico:'Luis Pérez',  visitas:4, ruta:'Zona Norte',   siguiente:'ESSAL S.A.' },
    { tecnico:'Marco Soto',  visitas:5, ruta:'Zona Centro',  siguiente:'Aguas Andinas S.A.' },
    { tecnico:'Felipe Díaz', visitas:3, ruta:'Zona Sur',     siguiente:'SMAPA Maipú' },
    { tecnico:'Javier Rojas', visitas:4, ruta:'Zona Oriente', siguiente:'SISS Concepción' },
  ];

  let graficoServicios = null;
  let visitaDetalleActiva = '';

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function formatFecha(iso) {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  function formatNum(n) {
    return Number(n).toLocaleString('es-CL');
  }

  function getMesAnio() {
    return {
      mes: parseInt(document.getElementById('filtroMes')?.value || _mes),
      anio: parseInt(document.getElementById('filtroAnio')?.value || _anio),
    };
  }

  function getServiciosFiltrados() {
    const { mes, anio } = getMesAnio();
    const prefijo = `${anio}-${_pad(mes)}`;
    return SERVICIOS.filter(s => s.fecha.startsWith(prefijo));
  }

  function obtenerUsuario() {
    try {
      const raw = localStorage.getItem('user');
      if (raw) return JSON.parse(raw);
    } catch { /* ignorar */ }
    return { nombre: 'Demo Servicio Técnico', email: 'demo@texpro.cl', area: 'servicio-tecnico', is_admin: true };
  }

  const MODULOS = [
    { nombre:'Dashboard',      icon:'🏠', url:'../dashboard/index.html',    area: null },
    { nombre:'Ventas',         icon:'📊', url:'../ventas/index.html',       area:['ventas','gerencia'] },
    { nombre:'Facturación',    icon:'🧾', url:'../facturacion/index.html',  area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Producción',     icon:'⚙️', url:'../produccion/index.html',   area:['produccion','gerencia'] },
    { nombre:'Bodega',         icon:'🏭', url:'../bodega/index.html',       area:['bodega','produccion','gerencia'] },
    { nombre:'Laboratorio',    icon:'🧪', url:'../laboratorio/index.html',  area:['laboratorio','gerencia'] },
    { nombre:'Cobranza',       icon:'💰', url:'../cobranza/index.html',     area:['cobranza','contabilidad','gerencia'] },
    { nombre:'RRHH',           icon:'👥', url:'../rrhh/index.html',         area:['rrhh','gerencia'] },
    { nombre:'Contabilidad',   icon:'📜', url:'../contabilidad/index.html', area:['contabilidad','gerencia'] },
    { nombre:'Administración', icon:'🔧', url:'../admin/index.html',        area:['admin'] },
  ];

  function cargarSidebar(usuario) {
    const ini = (usuario.nombre || 'U').split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase();
    setText('userName', usuario.nombre || usuario.email);
    setText('userArea', usuario.area || '');
    setText('userAvatar', ini);
    setText('chipAvatar', ini);
    setText('chipName', (usuario.nombre || usuario.email).split(' ')[0]);
    setText('headerDate', new Date().toLocaleDateString('es-CL', {
      weekday:'long', year:'numeric', month:'long', day:'numeric'
    }));
    setText('welcomeTitle', `Hola, ${(usuario.nombre||usuario.email).split(' ')[0]} 🛠️`);
    setText('welcomeSubtitle', `Área: ${usuario.area || 'Servicio Técnico'} — Texpro`);

    const visibles = MODULOS.filter(m => {
      if (m.area === null) return true;
      if (usuario.is_admin) return true;
      return m.area.includes(usuario.area);
    });

    const nav = document.getElementById('sidebarNav');
    if (!window.__APP_SIDEBAR_LOADED__ && nav) nav.innerHTML = `
      <span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">
        <span style="font-size:1rem">🛠️</span>
        <span class="nav-label">Serv. TEC</span>
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

  function initSelectores() {
    const selMes = document.getElementById('filtroMes');
    const selAnio = document.getElementById('filtroAnio');

    if (selMes) {
      MESES.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = i + 1;
        o.textContent = m;
        if (i + 1 === _mes) o.selected = true;
        selMes.appendChild(o);
      });
    }

    if (selAnio) {
      for (let y = _anio; y >= 2026; y--) {
        const o = document.createElement('option');
        o.value = y;
        o.textContent = y;
        if (y === _anio) o.selected = true;
        selAnio.appendChild(o);
      }
    }

    const selTecnico = document.getElementById('selTecnicoServicio');
    if (selTecnico) {
      TECNICOS.forEach(t => {
        const o = document.createElement('option');
        o.value = t.nombre;
        o.textContent = t.nombre;
        selTecnico.appendChild(o);
      });
    }

    const selCliente = document.getElementById('selClienteAsignado');
    if (selCliente) {
      CLIENTES_MAQUINARIA.forEach(c => {
        const o = document.createElement('option');
        o.value = c.cliente;
        o.textContent = c.cliente;
        selCliente.appendChild(o);
      });
    }
  }

  function renderKpis() {
    const datos = getServiciosFiltrados();
    const realizados = datos.filter(s => s.estado === 'Realizado').length;
    const instalaciones = datos.filter(s => s.tipo === 'Instalación').length;
    const pendientes = SERVICIOS.filter(s => s.estado === 'Pendiente').length;
    const visitas = datos.filter(s => s.tipo === 'Visita').length;
    const pct = datos.length ? Math.round((realizados / datos.length) * 100) : 0;

    setText('kpiRealizados', `${realizados} realizados`);
    setText('kpiInstalaciones', `${instalaciones} instalaciones`);
    setText('kpiPendientes', `${pendientes} pendientes`);
    setText('kpiVisitas', `${visitas} visitas`);
    setText('pctServicios', `${pct}% completado`);

    const fill = document.getElementById('progresoServiciosFill');
    if (fill) {
      fill.style.width = `${Math.min(pct, 100)}%`;
      fill.style.background = pct >= 80 ? 'var(--color-primary)' : pct >= 50 ? '#F5A623' : 'var(--color-danger)';
    }
  }

  function renderGrafico() {
    const { mes, anio } = getMesAnio();
    const datos = getServiciosFiltrados();
    const dias = new Date(anio, mes, 0).getDate();
    const labels = [];
    const valores = [];

    for (let d = 1; d <= dias; d++) {
      const key = `${anio}-${_pad(mes)}-${_pad(d)}`;
      labels.push(String(d));
      valores.push(datos.filter(s => s.fecha === key && s.estado === 'Realizado').length);
    }

    const ctx = document.getElementById('graficoServicios');
    if (!ctx) return;
    if (graficoServicios) graficoServicios.destroy();

    graficoServicios = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Servicios realizados',
          data: valores,
          backgroundColor: 'rgba(0, 226, 167, 0.55)',
          borderColor: '#00E2A7',
          borderWidth: 1.5,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${formatNum(c.parsed.y)} servicios` } },
        },
        scales: {
          x: { ticks: { font: { family: 'Open Sans', size: 10 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { font: { family: 'Open Sans', size: 11 }, stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)' } },
        },
      },
    });
  }

  function renderServicios() {
    const tbody = document.getElementById('tbodyServicios');
    if (!tbody) return;

    const datos = getServiciosFiltrados().slice().reverse();
    if (!datos.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin servicios para este período</td></tr>';
      return;
    }

    tbody.innerHTML = datos.map(s => {
      return `
        <tr>
          <td>${formatFecha(s.fecha)}</td>
          <td><strong>${s.tipo}</strong></td>
          <td>${s.cliente}</td>
          <td>${s.tecnico}</td>
          <td>${s.ruta}</td>
          <td style="text-align:center"><span class="st-chip ${s.estado === 'Realizado' ? '' : 'st-chip--naranja'}">${s.estado}</span></td>
        </tr>`;
    }).join('');
  }

  function renderPendientes() {
    const tbody = document.getElementById('tbodyPendientes');
    if (!tbody) return;

    tbody.innerHTML = VISITAS_PENDIENTES.map(v => `
      <tr>
        <td><strong>${v.cliente}</strong></td>
        <td>${v.tipo}</td>
        <td>${v.tecnico}</td>
        <td>${v.ruta}</td>
        <td>${formatFecha(v.fechaEstimada)}</td>
        <td style="text-align:center"><span class="st-chip st-chip--naranja">Pendiente</span></td>
      </tr>
    `).join('');
  }

  function renderAsignaciones() {
    const tbody = document.getElementById('tbodyAsignaciones');
    if (!tbody) return;

    tbody.innerHTML = TECH_ASSIGNMENTS.map(t => {
      const pct = Math.min(100, Math.round((t.visitas / 6) * 100));
      return `
        <tr class="st-row-click" data-tecnico="${t.tecnico}">
          <td><strong>${t.tecnico}</strong></td>
          <td>${t.especialidad || 'Operativo'}</td>
          <td>${t.ruta}</td>
          <td style="text-align:center"><strong>${t.visitas}</strong></td>
          <td>${t.siguiente}</td>
          <td>
            <div class="st-mini-barra-bg"><div class="st-mini-barra-fill" style="width:${pct}%;background:var(--color-primary)"></div></div>
            <span class="st-mini-pct">${pct}%</span>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('tr[data-tecnico]').forEach(row => {
      row.addEventListener('click', () => {
        const tecnico = row.getAttribute('data-tecnico') || '';
        if (!tecnico) return;
        visitaDetalleActiva = tecnico;
        renderDetalleTecnico(tecnico);
      });
    });

    if (!visitaDetalleActiva && TECH_ASSIGNMENTS.length) visitaDetalleActiva = TECH_ASSIGNMENTS[0].tecnico;
    if (visitaDetalleActiva) renderDetalleTecnico(visitaDetalleActiva);
  }

  function getDetalleTecnico(nombre) {
    return getServiciosFiltrados().filter(s => s.tecnico === nombre);
  }

  function renderDetalleTecnico(nombre) {
    const datos = getDetalleTecnico(nombre);
    setText('detTecnicoNombre', nombre || '—');
    setText('detTecnicoTotal', String(datos.length));
    setText('detTecnicoRealizados', String(datos.filter(d => d.estado === 'Realizado').length));
    setText('detTecnicoPendientes', String(datos.filter(d => d.estado === 'Pendiente').length));
    setText('detTecnicoRutas', [...new Set(datos.map(d => d.ruta))].join(' · ') || '—');

    const tbody = document.getElementById('tbodyDetalleTecnico');
    if (!tbody) return;

    if (!datos.length) {
      tbody.innerHTML = '<tr class="tabla-empty"><td colspan="6">Sin visitas para este técnico</td></tr>';
      return;
    }

    tbody.innerHTML = datos.map(d => `
      <tr>
        <td><strong>${d.fecha}</strong></td>
        <td>${d.tipo}</td>
        <td>${d.cliente}</td>
        <td>${d.ruta}</td>
        <td style="text-align:center"><span class="st-chip ${d.estado === 'Realizado' ? '' : 'st-chip--naranja'}">${d.estado}</span></td>
        <td>${d.tecnico}</td>
      </tr>
    `).join('');
  }

  function renderClientesMaquinaria() {
    const tbody = document.getElementById('tbodyClientesMaquinaria');
    if (!tbody) return;

    tbody.innerHTML = CLIENTES_MAQUINARIA.map(c => {
      const alerta = c.estado === 'Mantenimiento' ? 'st-chip--naranja' : c.estado === 'En revisión' ? 'st-chip--rojo' : 'st-chip';
      return `
        <tr>
          <td><strong>${c.cliente}</strong></td>
          <td>${c.maquinaria}</td>
          <td>${formatFecha(c.instalado)}</td>
          <td>${formatFecha(c.mantenimiento)}</td>
          <td>${c.cambio}</td>
          <td>${c.tecnico}</td>
          <td style="text-align:center"><span class="st-chip ${alerta.replace('st-chip', '').trim()}">${c.estado}</span></td>
        </tr>
      `;
    }).join('');
  }

  function renderResumenTecnicos() {
    const list = document.getElementById('listaTecnicosResumen');
    if (!list) return;

    list.innerHTML = TECH_ASSIGNMENTS.map(t => `
      <div class="st-lista-item">
        <strong>${t.tecnico}</strong>
        <div class="st-lista-meta">
          <span>Ruta: ${t.ruta}</span>
          <span>Visitas: ${t.visitas}</span>
          <span>Siguiente: ${t.siguiente}</span>
        </div>
      </div>
    `).join('');
  }

  function renderTodo() {
    renderKpis();
    renderGrafico();
    renderServicios();
  }

  function initFormAsignacion() {
    const form = document.getElementById('formAsignacionTecnico');
    if (!form) return;

    form.addEventListener('submit', e => {
      e.preventDefault();
      const tecnico = document.getElementById('selTecnicoServicio')?.value || '';
      const cliente = document.getElementById('selClienteAsignado')?.value || '';
      const tipo = document.getElementById('selTipoServicio')?.value || '';
      const fecha = document.getElementById('fechaServicioAsignado')?.value || '';
      const ruta = document.getElementById('rutaServicioAsignado')?.value || '';
      if (!tecnico || !cliente || !tipo || !fecha || !ruta) return;

      SERVICIOS.unshift({
        id: Date.now(),
        fecha,
        tipo,
        cliente,
        tecnico,
        ruta,
        estado: 'Pendiente',
      });

      TECH_ASSIGNMENTS.forEach(t => {
        if (t.tecnico === tecnico) {
          t.visitas += 1;
          t.siguiente = cliente;
        }
      });

      setText('msgAsignacionTecnico', `Asignación creada para ${cliente}.`);
      setTimeout(() => setText('msgAsignacionTecnico', ''), 2800);
      renderResumenTecnicos();
      renderAsignaciones();
      renderTodo();
      form.reset();
      document.getElementById('fechaServicioAsignado').value = new Date().toISOString().split('T')[0];
    });
  }

  function init() {
    const usuario = obtenerUsuario();
    cargarSidebar(usuario);
    initSelectores();
    renderResumenTecnicos();
    renderClientesMaquinaria();
    renderPendientes();
    renderAsignaciones();
    renderTodo();
    initFormAsignacion();

    document.getElementById('filtroMes')?.addEventListener('change', renderTodo);
    document.getElementById('filtroAnio')?.addEventListener('change', renderTodo);
    document.getElementById('btnActualizar')?.addEventListener('click', renderTodo);

    const fecha = document.getElementById('fechaServicioAsignado');
    if (fecha) fecha.value = new Date().toISOString().split('T')[0];
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();

