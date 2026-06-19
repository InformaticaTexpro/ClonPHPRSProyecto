'use strict';

/**
 * ventas.js — Ventas Asignadas Texpro
 * 2026-06-19: fix — eliminar col Producto, mostrar CodAux como Cód.Cliente, corregir alineación detalle
 * 2026-06-19: fix — endpoint /api/dashboard/ventas → /api/dashboard/ventas-mes
 *             fix — mapear TotLineaReal desde campo correcto de la API (v.TotLineaReal)
 * 2026-06-19: fix — cargarFoliosAsignados usa /api/dashboard/asignados (no /compartir/asignados)
 * 2026-06-19: fix — generarPDF usa datos en memoria (_ultimasVentas, _ultimosCompartidos, _ultimosAsignados)
 *             en vez de leer el DOM (evita columna de botón y datos desplazados)
 * 2026-06-19: feat — generarPDF muestra detalle completo de productos por folio (no resumen)
 */

(function () {

  const API   = '/api/dashboard';
  const token = () => localStorage.getItem('token');

  let todosVendedores     = [];
  let _usuarioActual      = null;
  let _ultimasVentas      = [];
  let _ultimosCompartidos = [];
  let _ultimosAsignados   = [];

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

  function getCodigosUsuario(usuario) {
    if (usuario.is_admin) return null;
    return (usuario.vendedores || []).map(v => String(v.cod_vendedor || v.cod)).filter(Boolean);
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

  // ── Detalle de productos por folio ────────────────────────────────────────
  const _detalleCache = {};

  async function toggleDetalle(folio, trExpand, colspan) {
    if (trExpand.classList.contains('detalle-open')) {
      trExpand.classList.remove('detalle-open');
      trExpand.innerHTML = '';
      return;
    }
    trExpand.classList.add('detalle-open');
    trExpand.innerHTML = `<td colspan="${colspan}"><div class="detalle-loading"><span class="detalle-spinner"></span> Cargando detalle del folio ${folio}…</div></td>`;
    try {
      if (!_detalleCache[folio]) {
        const res  = await fetch(`${API}/detalle/${folio}`, { headers:{ Authorization:`Bearer ${token()}` } });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Error al cargar detalle');
        _detalleCache[folio] = data;
      }
      const data = _detalleCache[folio];
      trExpand.innerHTML = `<td colspan="${colspan}">${renderDetalle(data)}</td>`;
    } catch (err) {
      trExpand.innerHTML = `<td colspan="${colspan}"><div class="detalle-error">⚠️ ${err.message}</div></td>`;
    }
  }

  function renderDetalle(data) {
    const d0 = data.detalle?.[0] || {};

    const bloque1 = `
      <div class="det-bloque det-bloque1">
        <div class="det-campo">
          <span class="det-label">Folio</span>
          <span class="det-valor">${d0.Folio || data.folio || '—'}</span>
        </div>
        <div class="det-campo">
          <span class="det-label">Fecha</span>
          <span class="det-valor">${d0.Fecha || '—'}</span>
        </div>
        <div class="det-campo">
          <span class="det-label">Cód. Cliente</span>
          <span class="det-valor">${d0.CodAux || '—'}</span>
        </div>
        <div class="det-campo det-campo--wide">
          <span class="det-label">Cliente</span>
          <span class="det-valor">${d0.Cliente || '—'}</span>
        </div>
        <div class="det-campo">
          <span class="det-label">CanCod</span>
          <span class="det-valor">${d0.CanCod || '—'}</span>
        </div>
      </div>`;

    const filas = (data.detalle || []).map(p => {
      const cant     = Number(p.CantFacturada) || 0;
      const precReal = Number(p.precio_unitario_cobrado) || 0;
      const precVta  = Number(p.precio_lista_real)       || 0;
      const totReal  = Number(p.TotLinea)                || 0;
      const totVta   = Number(p.valor_historico_linea)   || 0;
      const desc = precVta > 0
        ? Math.round((1 - Math.abs(precReal) / Math.abs(precVta)) * 10000) / 100
        : 0;
      const descStr  = desc !== 0 ? `${desc}%` : '—';
      const negativo = totReal < 0;

      const codProd  = p.CodProd  || '—';
      const desProd  = p.DesProd  || p.descripcion || '—';

      return `
        <tr class="${negativo ? 'det-row-neg' : ''}">
          <td class="det-td det-td--cod">${codProd}</td>
          <td class="det-td det-td--desc">${desProd}</td>
          <td class="det-td det-td--num">${cant}</td>
          <td class="det-td det-td--num">${formatCLP(precReal)}</td>
          <td class="det-td det-td--num">${formatCLP(precVta)}</td>
          <td class="det-td det-td--num ${negativo ? 'det-neg' : 'det-pos'}">${formatCLP(totReal)}</td>
          <td class="det-td det-td--num">${formatCLP(totVta)}</td>
          <td class="det-td det-td--num">${descStr}</td>
        </tr>`;
    }).join('');

    const bloque2 = `
      <div class="det-bloque det-bloque2">
        <div class="det-tabla-wrap">
          <table class="det-tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th class="det-th--num">Cant.</th>
                <th class="det-th--num">Precio Real</th>
                <th class="det-th--num">Precio Venta</th>
                <th class="det-th--num">Total Real</th>
                <th class="det-th--num">Total Venta</th>
                <th class="det-th--num">Descuento</th>
              </tr>
            </thead>
            <tbody>
              ${filas || '<tr><td colspan="8" style="text-align:center;padding:1rem">Sin líneas de detalle</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;

    return `<div class="det-contenedor">${bloque1}${bloque2}</div>`;
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  async function cargarLibreriaPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
    return window.jspdf.jsPDF;
  }

  function getMesFiltro() {
    const mes  = document.getElementById('filtroMes')?.value  || (new Date().getMonth() + 1);
    const anio = document.getElementById('filtroAnio')?.value || new Date().getFullYear();
    return `${MESES_NOMBRE[Number(mes) - 1]} ${anio}`;
  }

  /**
   * Obtiene el detalle de un folio (usa cache si ya fue cargado en pantalla).
   */
  async function fetchDetalleFolio(folio) {
    if (_detalleCache[folio]) return _detalleCache[folio];
    const res  = await fetch(`${API}/detalle/${folio}`, { headers:{ Authorization:`Bearer ${token()}` } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `Error detalle folio ${folio}`);
    _detalleCache[folio] = data;
    return data;
  }

  async function generarPDF() {
    const btnPdf = document.getElementById('btnGenerarPDF');
    try {
      if (btnPdf) { btnPdf.disabled = true; btnPdf.textContent = 'Generando...'; }

      const jsPDF    = await cargarLibreriaPDF();
      const doc      = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
      const mesLabel = getMesFiltro();
      const nombre   = _usuarioActual?.nombre || 'Vendedor';
      const hoy      = new Date().toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' });

      // ── Helper: encabezado de página ─────────────────────────────────────
      function addPageHeader() {
        doc.setFillColor(0, 174, 142);
        doc.rect(0, 0, 297, 18, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(13); doc.setFont('helvetica', 'bold');
        doc.text('TEXPRO — Reporte de Ventas Asignadas', 14, 11);
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text(`Vendedor: ${nombre}   |   Período: ${mesLabel}   |   Emitido: ${hoy}`, 14, 16);
        doc.setTextColor(0, 0, 0);
      }

      addPageHeader();
      let y = 24;

      // ── DETALLE COMPLETO POR FOLIO ───────────────────────────────────────
      if (_ultimasVentas.length) {
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        doc.text(`Detalle de Folios — ${mesLabel}`, 14, y);
        y += 5;

        for (const venta of _ultimasVentas) {
          // Obtener detalle del folio
          let detalleData = null;
          try {
            detalleData = await fetchDetalleFolio(venta.Folio);
          } catch (e) {
            console.warn(`[PDF] No se pudo cargar detalle del folio ${venta.Folio}:`, e);
          }

          const d0       = detalleData?.detalle?.[0] || {};
          const lineas   = detalleData?.detalle || [];
          const cliente  = d0.Cliente || venta.cliente || '—';
          const fecha    = d0.Fecha   || venta.fecha_formato || '—';
          const codAux   = d0.CodAux  || '—';
          const canCod   = d0.CanCod  || '—';

          // Salto de página si no hay espacio suficiente (mínimo 30mm para encabezado + 1 fila)
          if (y > 175) {
            doc.addPage();
            addPageHeader();
            y = 24;
          }

          // ── Sub-encabezado del folio ──────────────────────────────────
          doc.setFillColor(240, 248, 246);
          doc.rect(14, y, 269, 8, 'F');
          doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 100, 80);
          doc.text(`Folio: ${venta.Folio}`, 16, y + 5.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(40, 40, 40);
          doc.text(`Fecha: ${fecha}`, 48, y + 5.5);
          doc.text(`Cód. Cliente: ${codAux}`, 80, y + 5.5);
          doc.text(`Cliente: ${cliente}`, 120, y + 5.5);
          doc.text(`CanCod: ${canCod}`, 240, y + 5.5);
          y += 10;

          // ── Tabla de productos del folio ──────────────────────────────
          const filasProductos = lineas.map(p => {
            const cant     = Number(p.CantFacturada) || 0;
            const precReal = Number(p.precio_unitario_cobrado) || 0;
            const precVta  = Number(p.precio_lista_real)       || 0;
            const totReal  = Number(p.TotLinea)                || 0;
            const totVta   = Number(p.valor_historico_linea)   || 0;
            const desc     = precVta > 0
              ? Math.round((1 - Math.abs(precReal) / Math.abs(precVta)) * 10000) / 100
              : 0;
            return [
              p.CodProd || '—',
              p.DesProd || p.descripcion || '—',
              String(cant),
              formatCLP(precReal),
              formatCLP(precVta),
              formatCLP(totReal),
              formatCLP(totVta),
              desc !== 0 ? `${desc}%` : '—',
            ];
          });

          doc.autoTable({
            startY: y,
            head: [['Código', 'Descripción', 'Cant.', 'Precio Real', 'Precio Venta', 'Total Real', 'Total Venta', 'Descuento']],
            body: filasProductos.length
              ? filasProductos
              : [['Sin productos', '', '', '', '', '', '', '']],
            styles: { fontSize: 7.5, cellPadding: 2, overflow: 'linebreak' },
            headStyles: { fillColor: [0, 140, 115], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
            alternateRowStyles: { fillColor: [248, 252, 251] },
            columnStyles: {
              0: { cellWidth: 28 },
              1: { cellWidth: 88 },
              2: { cellWidth: 14, halign: 'right' },
              3: { cellWidth: 30, halign: 'right' },
              4: { cellWidth: 30, halign: 'right' },
              5: { cellWidth: 30, halign: 'right' },
              6: { cellWidth: 30, halign: 'right' },
              7: { cellWidth: 19, halign: 'right' },
            },
            margin: { left: 14, right: 14 },
            didParseCell(data) {
              // Colorear Total Real negativo en rojo
              if (data.column.index === 5 && data.section === 'body') {
                const raw = lineas[data.row.index];
                if (raw && Number(raw.TotLinea) < 0) {
                  data.cell.styles.textColor = [180, 30, 30];
                } else if (raw && Number(raw.TotLinea) > 0) {
                  data.cell.styles.textColor = [0, 130, 80];
                }
              }
            },
          });

          y = doc.lastAutoTable.finalY + 6;
        }
      } else {
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text('Sin ventas registradas para el período seleccionado.', 14, y);
        y += 10;
      }

      // ── TABLA COMPARTIDOS (resumen) ──────────────────────────────────────
      const panelComp = document.getElementById('panelCompartidos');
      if (panelComp && panelComp.style.display !== 'none' && _ultimosCompartidos.length) {
        if (y > 170) { doc.addPage(); addPageHeader(); y = 24; }
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text('Ventas Compartidas Conmigo', 14, y); y += 3;

        const filasC = _ultimosCompartidos.map(c => [
          String(c.folio || '—'),
          c.fecha ? new Date(c.fecha).toLocaleDateString('es-CL') : '—',
          c.cliente || '—',
          c.coordinador || c.cod_vendedor_principal || '—',
          `${c.porcentaje}%`,
          formatCLP(c.monto_asignado),
        ]);

        doc.autoTable({
          startY: y,
          head: [['Folio', 'Fecha', 'Cliente', 'Vendedor Origen', '% Part.', 'Monto Asignado']],
          body: filasC,
          styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
          headStyles: { fillColor: [0, 120, 180], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [245, 248, 252] },
          columnStyles: {
            0: { cellWidth: 18 },
            1: { cellWidth: 24 },
            2: { cellWidth: 86 },
            3: { cellWidth: 56 },
            4: { cellWidth: 18, halign: 'right' },
            5: { cellWidth: 36, halign: 'right' },
          },
          margin: { left: 14, right: 14 },
        });
        y = doc.lastAutoTable.finalY + 10;
      }

      // ── TABLA ASIGNADOS (resumen) ────────────────────────────────────────
      const panelAsig = document.getElementById('panelCoordinador');
      if (panelAsig && panelAsig.style.display !== 'none' && _ultimosAsignados.length) {
        if (y > 170) { doc.addPage(); addPageHeader(); y = 24; }
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text('Folios Asignados a Vendedores', 14, y); y += 3;

        const filasA = _ultimosAsignados.map(c => [
          String(c.folio || '—'),
          c.fecha ? new Date(c.fecha).toLocaleDateString('es-CL') : '—',
          c.cliente || '—',
          c.nombre_vendedor_compartido || c.cod_vendedor_compartido || '—',
          `${c.porcentaje}%`,
          formatCLP(c.monto_asignado),
        ]);

        doc.autoTable({
          startY: y,
          head: [['Folio', 'Fecha', 'Cliente', 'Vendedor Asignado', '% Part.', 'Monto Asignado']],
          body: filasA,
          styles: { fontSize: 8, cellPadding: 2.5, overflow: 'linebreak' },
          headStyles: { fillColor: [100, 60, 180], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [248, 246, 252] },
          columnStyles: {
            0: { cellWidth: 18 },
            1: { cellWidth: 24 },
            2: { cellWidth: 86 },
            3: { cellWidth: 56 },
            4: { cellWidth: 18, halign: 'right' },
            5: { cellWidth: 36, halign: 'right' },
          },
          margin: { left: 14, right: 14 },
        });
      }

      // ── Pie de página ────────────────────────────────────────────────────
      const totalPags = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPags; i++) {
        doc.setPage(i);
        doc.setFontSize(7); doc.setTextColor(160, 160, 160);
        doc.text(`TEXPRO — Documento interno. Página ${i} de ${totalPags}`, 14, 205);
        doc.text(hoy, 260, 205);
        doc.setTextColor(0, 0, 0);
      }

      doc.save(`Reporte_Ventas_${mesLabel.replace(' ', '_')}.pdf`);
    } catch (err) {
      console.error('[generarPDF]', err);
      alert('Error al generar el PDF. Intenta nuevamente.');
    } finally {
      if (btnPdf) {
        btnPdf.disabled = false;
        btnPdf.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Generar PDF`;
      }
    }
  }

  // ── Sidebar ───────────────────────────────────────────────────────────────
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
    const svgVentas = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
    if (nav) nav.innerHTML = `<span class="nav-section-title">NAVEGACIÓN</span>
      <a class="nav-item active" href="#">${svgVentas}<span class="nav-label">Ventas Asignadas</span></a>
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

  // ── Helper: fila de detalle expandible ───────────────────────────────────
  function bindDetalleRows(tbody, folioField, colspan) {
    tbody.querySelectorAll('tr[data-folio]').forEach(tr => {
      const folio   = tr.dataset.folio;
      const trExp   = document.createElement('tr');
      trExp.className = 'detalle-expand-row';
      trExp.innerHTML = `<td colspan="${colspan}"></td>`;
      tr.after(trExp);

      tr.querySelector('.btn-det')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const svg = tr.querySelector('.det-chevron');
        const yaAbierto = trExp.classList.contains('detalle-open');
        if (svg) svg.style.transform = yaAbierto ? 'rotate(0deg)' : 'rotate(180deg)';
        toggleDetalle(folio, trExp, colspan);
      });
    });
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
        data.vendedores.map(v => `<option value="${v.cod}">${v.cod} — ${v.nombre||'Sin nombre'}</option>`).join('');
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
        data.folios.map(f => `<option value="${f.Folio}">${f.Folio} — ${f.cliente||'?'} — ${formatCLP(f.monto)}</option>`).join('');
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
      <td>
        <input type="number" class="crud-input" id="editPct_${c.id}" value="${c.porcentaje}" min="1" max="100" style="width:60px">
      </td>
      <td style="text-align:right">${formatCLP(c.monto_asignado)}</td>
      <td>
        <div class="crud-acciones">
          <button class="btn-crud btn-crud--save" data-id="${c.id}">✔</button>
          <button class="btn-crud btn-crud--cancel" data-id="${c.id}">✖</button>
        </div>
      </td>`;
  }

  async function cargarFoliosAsignados() {
    try {
      const res  = await fetch(`${API}/asignados?${new URLSearchParams(getParams())}`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      const tbody = document.getElementById('tbodyAsignados');
      _ultimosAsignados = data.asignados || [];
      if (!tbody) return;
      if (!_ultimosAsignados.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="7" style="text-align:center;padding:1.5rem;color:#aaa">Sin folios asignados este mes</td></tr>';
        return;
      }
      tbody.innerHTML = _ultimosAsignados.map(c => `<tr data-id="${c.id}">${filaAsignadoVista(c)}</tr>`).join('');
      tbody.querySelectorAll('.btn-crud--edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const tr = btn.closest('tr');
          const id = btn.dataset.id;
          const c  = _ultimosAsignados.find(x => String(x.id) === id);
          if (c) tr.innerHTML = filaAsignadoEdicion(c);
          bindCrudSave(tbody, _ultimosAsignados);
        });
      });
      tbody.querySelectorAll('.btn-crud--del').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id    = btn.dataset.id;
          const folio = btn.dataset.folio;
          if (!confirm(`¿Eliminar asignación del folio ${folio}?`)) return;
          try {
            const r = await fetch(`${API}/compartir/${id}`, { method:'DELETE', headers:{ Authorization:`Bearer ${token()}` } });
            const d = await r.json();
            if (!d.ok) throw new Error(d.error);
            await cargarFoliosAsignados();
          } catch(err) { alert(`Error: ${err.message}`); }
        });
      });
    } catch(err) { console.error('[cargarFoliosAsignados]', err); }
  }

  function bindCrudSave(tbody, data) {
    tbody.querySelectorAll('.btn-crud--save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.id;
        const v   = document.getElementById(`editVend_${id}`)?.value;
        const pct = document.getElementById(`editPct_${id}`)?.value;
        if (!v || !pct) { alert('Completa los campos'); return; }
        try {
          const r = await fetch(`${API}/compartir/${id}`, {
            method:'PUT',
            headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token()}` },
            body: JSON.stringify({ cod_vendedor_compartido:v, porcentaje:Number(pct) })
          });
          const d = await r.json();
          if (!d.ok) throw new Error(d.error);
          await cargarFoliosAsignados();
        } catch(err) { alert(`Error: ${err.message}`); }
      });
    });
    tbody.querySelectorAll('.btn-crud--cancel').forEach(btn => {
      btn.addEventListener('click', () => cargarFoliosAsignados());
    });
  }

  // ── Carga principal de ventas ─────────────────────────────────────────────
  async function cargarVentas() {
    mostrarCarga();
    try {
      const params  = getParams();
      const headers = { Authorization:`Bearer ${token()}` };

      const [resV, resC] = await Promise.all([
        fetch(`${API}/ventas-mes?${new URLSearchParams(params)}`, { headers }),
        fetch(`${API}/compartidos?${new URLSearchParams(params)}`, { headers }),
      ]);
      const [dataV, dataC] = await Promise.all([resV.json(), resC.json()]);

      // ── Guardar en memoria para PDF ───────────────────────────────────────
      _ultimasVentas      = dataV.ventas      || [];
      _ultimosCompartidos = dataC.compartidos || [];

      // ── Tabla ventas del mes ──────────────────────────────────────────────
      const tbodyV  = document.getElementById('tbodyVentas');
      const cntV    = document.getElementById('cuentaVentas');

      if (cntV) cntV.textContent = `${_ultimasVentas.length} registros`;

      if (!_ultimasVentas.length) {
        if (tbodyV) tbodyV.innerHTML = '<tr class="tabla-empty"><td colspan="8" style="text-align:center;padding:2rem;color:#aaa">Sin ventas este mes</td></tr>';
      } else {
        if (tbodyV) {
          tbodyV.innerHTML = _ultimasVentas.map(v => {
            const pct = Number(v.pct_descuento) || 0;
            const totLineaReal = v.TotLineaReal ?? v.monto;
            return `
            <tr data-folio="${v.Folio}">
              <td class="det-btn-td">
                <button class="btn-det" title="Ver detalle">
                  <svg class="det-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </td>
              <td><strong>${v.Folio}</strong></td>
              <td>${v.fecha_formato || '—'}</td>
              <td>${v.cliente || '—'}</td>
              <td>${v.CodVendedor || '—'}</td>
              <td style="text-align:right">${formatCLP(v.monto)}</td>
              <td style="text-align:right;color:var(--color-success,#27ae60)">${formatCLP(totLineaReal)}</td>
              <td style="text-align:right">${pct ? pct+'%' : '—'}</td>
            </tr>`;
          }).join('');
          bindDetalleRows(tbodyV, 'Folio', 8);
        }
      }

      // ── Tabla compartidos ─────────────────────────────────────────────────
      const tbodyC   = document.getElementById('tbodyCompartidos');
      const cntC     = document.getElementById('cuentaCompartidos');

      if (cntC) cntC.textContent = `${_ultimosCompartidos.length} registros`;

      if (!_ultimosCompartidos.length) {
        if (tbodyC) tbodyC.innerHTML = '<tr class="tabla-empty"><td colspan="7" style="text-align:center;padding:2rem;color:#aaa">Sin folios compartidos este mes</td></tr>';
      } else {
        if (tbodyC) {
          tbodyC.innerHTML = _ultimosCompartidos.map(c => `
            <tr data-folio="${c.folio}">
              <td class="det-btn-td">
                <button class="btn-det" title="Ver detalle">
                  <svg class="det-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              </td>
              <td><strong>${c.folio}</strong></td>
              <td>${c.fecha ? new Date(c.fecha).toLocaleDateString('es-CL') : '—'}</td>
              <td>${c.cliente || '—'}</td>
              <td>${c.coordinador || c.cod_vendedor_principal || '—'}</td>
              <td style="text-align:right">${c.porcentaje}%</td>
              <td style="text-align:right">${formatCLP(c.monto_asignado)}</td>
            </tr>`).join('');
          bindDetalleRows(tbodyC, 'folio', 7);
        }
      }

    } catch (err) {
      console.error('[cargarVentas]', err);
    } finally {
      ocultarCarga();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    _usuarioActual = await verificarSesion();
    if (!_usuarioActual) return;

    cargarSidebar(_usuarioActual);
    initSelectores();

    if (esCoordinador(_usuarioActual)) {
      await iniciarPanelCoordinador();
    } else {
      setStyle('panelCompartidos',  'display', 'block');
      setStyle('panelCoordinador', 'display', 'none');
    }

    await cargarVentas();

    document.getElementById('btnActualizar')?.addEventListener('click', cargarVentas);
    document.getElementById('btnGenerarPDF')?.addEventListener('click', generarPDF);
  });

})();
