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
  const PDF_Y_CONTENIDO = 30;

  function formatCLP(v) {
    if (v == null || v === '') return '—';
    return new Intl.NumberFormat('es-CL', { style:'currency', currency:'CLP', maximumFractionDigits:0 }).format(Number(v));
  }

  function formatDescuentoVenta(v) {
    const valorReal = Number(v.valor_real ?? v.ValorReal ?? v.monto ?? v.TotLinea ?? 0);
    const totLineaReal = Number(v.TotLineaReal ?? v.tot_linea_real ?? v.total_lista_real ?? v.valor_historico_linea ?? 0);

    if (
      Number.isFinite(valorReal) &&
      Number.isFinite(totLineaReal) &&
      Math.abs(totLineaReal) > 0 &&
      Math.abs(valorReal) < Math.abs(totLineaReal)
    ) {
      const pct = (1 - (Math.abs(valorReal) / Math.abs(totLineaReal))) * 100;
      return `${Math.round(pct * 100) / 100}%`;
    }

    return '—';
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
  }

  function nombreVisibleUsuario(usuario) {
    return String(usuario?.nombre || usuario?.usuario || usuario?.email || 'Usuario').trim() || 'Usuario';
  }

  function nombreCortoUsuario(nombre) {
    const limpio = String(nombre || 'Usuario').trim();
    if (!limpio) return 'Usuario';
    return limpio.split(/\s+/)[0] || limpio;
  }


  function normalizarTipoFolio(valor) {
    const tipo = String(valor || '').trim().toUpperCase();
    return ['F', 'N', 'D'].includes(tipo) ? tipo : '';
  }

  function resolverTipoFolio(...valores) {
    for (const valor of valores) {
      const tipo = normalizarTipoFolio(valor);
      if (tipo) return tipo;
    }
    return '';
  }

  function claveFechaRegistro(registro) {
    const valor = String(registro?.Fecha ?? registro?.fecha ?? registro?.fecha_formato ?? registro?.FechaDocumento ?? '').trim();
    if (!valor) return Number.MAX_SAFE_INTEGER;

    const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/;

    const m1 = valor.match(ddmmyyyy);
    if (m1) return Number(String(m1[3]) + String(m1[2]) + String(m1[1]));

    const m2 = valor.match(iso);
    if (m2) return Number(String(m2[1]) + String(m2[2]) + String(m2[3]));

    const ts = Date.parse(valor);
    return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
  }

  function compararRegistrosPDF(a, b) {
    const folioA = Number(a?.folio ?? a?.Folio ?? 0) || 0;
    const folioB = Number(b?.folio ?? b?.Folio ?? 0) || 0;
    if (folioA !== folioB) return folioA - folioB;
    const fechaA = claveFechaRegistro(a);
    const fechaB = claveFechaRegistro(b);
    if (fechaA !== fechaB) return fechaA - fechaB;
    return 0;
  }

  function ordenarRegistrosPDF(lista) {
    return Array.isArray(lista) ? lista.slice().sort(compararRegistrosPDF) : [];
  }

  function actualizarSaludoUsuario(usuario) {
    const nombreCompleto = nombreVisibleUsuario(usuario);
    const nombreCorto = nombreCortoUsuario(nombreCompleto);
    setText('welcomeTitle', `Hola, ${nombreCorto} 👋`);
    setText('welcomeSubtitle', nombreCompleto);
  }

  // -- Spinner ---------------------------------------------------------------
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
    return (usuario.vendedores || []).some(v => String(v.tipo || '').trim().toUpperCase() === 'C');
  }

  // -- Detalle de productos por folio ----------------------------------------
  const _detalleCache = {};

  async function toggleDetalle(folio, trExpand, colspan) {
    if (trExpand.classList.contains('detalle-open')) {
      trExpand.classList.remove('detalle-open');
      trExpand.innerHTML = '';
      return;
    }
    trExpand.classList.add('detalle-open');
    trExpand.innerHTML = `<td colspan="${colspan}"><div class="detalle-loading"><span class="detalle-spinner"></span> Cargando detalle del folio ${folio}...</div></td>`;
    try {
      if (!_detalleCache[folio]) {
        const res  = await fetch(`/api/ventas/detalle/${folio}`, { headers:{ Authorization:`Bearer ${token()}` } });
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
      const precReal = Number(p.precio_real ?? p.PrecioReal ?? p.precio_real_oficial) || 0;
      const precVta  = Number(p.precio_vta ?? p.PrecioVta ?? p.precio_unitario_cobrado) || 0;
      const totReal  = Number(p.neto_real ?? p.NetoReal ?? p.valor_historico_linea) || 0;
      const totVta   = Number(p.neto_total ?? p.NetoTotal ?? p.valor_cobrado_linea ?? p.TotLinea) || 0;
      const descBase = Number(p.dcto ?? p.Dcto);
      const desc = Number.isFinite(descBase)
        ? descBase
        : (precReal !== 0
          ? Math.round((((Math.abs(totReal) - Math.abs(totVta)) / Math.abs(totReal)) * 100) * 100) / 100
          : 0);
      const descStr  = Number.isFinite(desc) ? `${desc}%` : '—';
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

  // -- PDF -------------------------------------------------------------------
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

  const PDF_MARGEN = 14;

  function anchoPaginaPDF(doc) {
    return doc.internal.pageSize.getWidth();
  }

  function altoPaginaPDF(doc) {
    return doc.internal.pageSize.getHeight();
  }

  function anchoContenidoPDF(doc) {
    return anchoPaginaPDF(doc) - (PDF_MARGEN * 2);
  }

  function getMesFiltro() {
    const mes  = document.getElementById('filtroMes')?.value  || (new Date().getMonth() + 1);
    const anio = document.getElementById('filtroAnio')?.value || new Date().getFullYear();
    return `${MESES_NOMBRE[Number(mes) - 1]} ${anio}`;
  }

  function normalizarRespuestaDetalleFolio(data) {
    const detalle = Array.isArray(data?.detalle) ? data.detalle : [];
    const primera = detalle[0] || {};
    const tipoFolio = resolverTipoFolio(
      data?.tipo_folio,
      data?.Tipo,
      data?.tipo,
      primera.tipo_folio,
      primera.Tipo,
      primera.tipo
    );
    return {
      ...(data || {}),
      detalle,
      tipo_folio: tipoFolio,
      Tipo: tipoFolio,
      tipo: tipoFolio,
    };
  }

  async function fetchDetalleFolio(folio, { force = false, anio = null } = {}) {
    if (!force && _detalleCache[folio]) return _detalleCache[folio];
    const qs = new URLSearchParams();
    if (anio != null && anio !== '') qs.set('anio', anio);
    const url = qs.toString() ? `${API}/detalle/${folio}?${qs.toString()}` : `${API}/detalle/${folio}`;
    const res  = await fetch(url, { headers:{ Authorization:`Bearer ${token()}` } });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || `Error detalle folio ${folio}`);
    const normalizado = normalizarRespuestaDetalleFolio(data);
    _detalleCache[folio] = normalizado;
    return normalizado;
  }

  function resumenDetalleFolio(lineas) {
    const resumen = (Array.isArray(lineas) ? lineas : []).reduce((acc, p) => {
      acc.cant += Number(p?.CantFacturada) || 0;
      acc.totalReal += Number(p?.neto_real ?? p?.NetoReal ?? 0) || 0;
      acc.totalVenta += Number(p?.neto_total ?? p?.NetoTotal ?? p?.TotLinea ?? 0) || 0;
      return acc;
    }, { cant: 0, totalReal: 0, totalVenta: 0, dcto: null });

    const base = Math.abs(resumen.totalReal);
    resumen.cant = Math.round(resumen.cant);
    resumen.totalReal = Math.round(resumen.totalReal);
    resumen.totalVenta = Math.round(resumen.totalVenta);
    resumen.dcto = base > 0
      ? Math.round((((Math.abs(resumen.totalReal) - Math.abs(resumen.totalVenta)) / base) * 100) * 100) / 100
      : null;
    return resumen;
  }

  async function obtenerDetalleFolioCompartido(folio, { force = false, anio = null } = {}) {
    const data = await fetchDetalleFolio(folio, { force, anio });
    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    const primera = detalle[0] || {};
    const tipoFolio = resolverTipoFolio(data.tipo_folio, data.Tipo, data.tipo, primera.tipo_folio, primera.Tipo, primera.tipo);
    return {
      detalle,
      primera,
      tipoFolio,
      resumen: resumenDetalleFolio(detalle),
    };
  }

  function renderCabeceraFolioCompartido(doc, y, share, detalleInfo) {
    const primera = detalleInfo?.primera || {};
    const cliente = primera.Cliente || share.cliente || '—';
    const codAux  = primera.CodAux || '—';
    const tipo    = resolverTipoFolio(
      share.tipo_folio,
      detalleInfo?.tipoFolio,
      primera.tipo_folio,
      primera.Tipo,
      primera.tipo
    );
    const vendedorOrigen = share.coordinador || share.cod_vendedor_principal || '—';
    const vendedorAsignado = share.nombre_vendedor_compartido || share.cod_vendedor_compartido || '—';
    const clienteLineas = doc.splitTextToSize(`Cliente: ${cliente}`, anchoContenidoPDF(doc) - 22);
    const altoCliente = Math.max(4, clienteLineas.length * 4);
    const altoBloque = 23 + altoCliente + 10;

    if (y > altoPaginaPDF(doc) - 55) {
      doc.addPage();
      y = PDF_Y_CONTENIDO;
    }

    doc.setFillColor(240, 248, 246);
    doc.rect(PDF_MARGEN, y, anchoContenidoPDF(doc), altoBloque, 'F');
    doc.setFontSize(8.4);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 100, 80);
    doc.text(`Folio: ${share.folio}`, 16, y + 5.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.text(`Fecha: ${share.fecha ? new Date(share.fecha).toLocaleDateString('es-CL') : '—'}`, 72, y + 5.2);
    doc.text(`Tipo: ${tipo || '—'}`, 132, y + 5.2);
    doc.text(`Cód. Cliente: ${codAux}`, 16, y + 10.8);
    doc.text(`Vendedor asignado: ${vendedorAsignado}`, 102, y + 10.8);
    doc.text(clienteLineas, 16, y + 15.8);
    const yFila3 = y + 15.8 + altoCliente + 1;
    doc.text(`Vendedor origen: ${vendedorOrigen}`, 16, yFila3);
    doc.text(`% Participación: ${Number(share.porcentaje || 0).toFixed(2)}%`, 100, yFila3);
    doc.text(`Monto asignado: ${formatCLP(share.monto_asignado)}`, anchoPaginaPDF(doc) - PDF_MARGEN, yFila3, { align: 'right' });
    return y + altoBloque + 2;
  }

  function renderTablaDetalleCompartido(doc, y, detalle) {
    const filasProductos = (Array.isArray(detalle) ? detalle : []).map(p => {
      const cant     = Number(p.CantFacturada) || 0;
      const precReal = Number(p.precio_real ?? p.PrecioReal ?? p.precio_real_oficial) || 0;
      const precVta  = Number(p.precio_vta ?? p.PrecioVta ?? p.precio_unitario_cobrado) || 0;
      const totReal  = Number(p.neto_real ?? p.NetoReal ?? p.valor_historico_linea) || 0;
      const totVta   = Number(p.neto_total ?? p.NetoTotal ?? p.valor_cobrado_linea ?? p.TotLinea) || 0;
      const descBase = Number(p.dcto ?? p.Dcto);
      const desc     = Number.isFinite(descBase) ? descBase : (
        precReal !== 0
          ? Math.round((((Math.abs(totReal) - Math.abs(totVta)) / Math.abs(totReal)) * 100) * 100) / 100
          : 0
      );
      return [
        p.CodProd || '—',
        p.DesProd || p.descripcion || '—',
        String(cant),
        formatCLP(precReal),
        formatCLP(precVta),
        formatCLP(totReal),
        formatCLP(totVta),
        Number.isFinite(desc) ? `${desc}%` : '—',
      ];
    });

    if (!filasProductos.length) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(120, 120, 120);
      doc.text('Detalle Softland no disponible para este folio', 16, y + 4);
      doc.setTextColor(0, 0, 0);
      return y + 8;
    }

    doc.autoTable({
      startY: y,
      head: [['Código', 'Descripción', 'Cant.', 'Precio Real', 'Precio Vta', 'Neto Real', 'Neto Total', 'Descuento']],
      body: filasProductos,
      theme: 'grid',
      styles: {
        fontSize: 6.95,
        cellPadding: { top: 1.2, right: 1.7, bottom: 1.2, left: 1.7 },
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: [224, 232, 229],
        lineWidth: 0.12,
      },
      headStyles: {
        fillColor: [0, 140, 115],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 6.95,
        valign: 'middle',
        lineColor: [0, 120, 98],
        lineWidth: 0.12,
      },
      alternateRowStyles: { fillColor: [250, 253, 252] },
      columnStyles: {
        0: { cellWidth: 16, halign: 'left' },
        1: { cellWidth: 58, halign: 'left' },
        2: { cellWidth: 10, halign: 'center' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 22, halign: 'right' },
        6: { cellWidth: 22, halign: 'right' },
        7: { cellWidth: 18, halign: 'right' },
      },
      margin: { left: PDF_MARGEN, right: PDF_MARGEN },
      didParseCell(data) {
        if (data.column.index === 5 && data.section === 'body') {
          const raw = detalle[data.row.index];
          if (raw && Number(raw.TotLinea) < 0) {
            data.cell.styles.textColor = [180, 30, 30];
          } else if (raw && Number(raw.TotLinea) > 0) {
            data.cell.styles.textColor = [0, 130, 80];
          }
        }
      },
    });

    return doc.lastAutoTable.finalY + 3;
  }

  function renderResumenFolioCompartido(doc, y, resumen, titulo = 'Subtotal folio') {
    if (y > altoPaginaPDF(doc) - 45) {
      doc.addPage();
      y = PDF_Y_CONTENIDO;
    }

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 100, 80);
    doc.text(titulo, 16, y + 4);

    doc.autoTable({
      startY: y + 5,
      head: [['Cant.', 'Total Real', 'Total Venta', 'Dcto']],
      body: [[
        String(resumen.cant ?? 0),
        formatCLP(resumen.totalReal ?? 0),
        formatCLP(resumen.totalVenta ?? 0),
        resumen.dcto == null ? '?' : `${resumen.dcto}%`,
      ]],
      theme: 'grid',
      styles: {
        fontSize: 6.95,
        cellPadding: { top: 1.2, right: 1.7, bottom: 1.2, left: 1.7 },
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: [224, 232, 229],
        lineWidth: 0.12,
      },
      headStyles: {
        fillColor: [226, 244, 240],
        textColor: [0, 95, 75],
        fontStyle: 'bold',
        fontSize: 6.95,
        valign: 'middle',
        lineColor: [200, 225, 219],
        lineWidth: 0.12,
      },
      alternateRowStyles: { fillColor: [250, 253, 252] },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 54, halign: 'right' },
        2: { cellWidth: 54, halign: 'right' },
        3: { cellWidth: 56, halign: 'right' },
      },
      margin: { left: PDF_MARGEN, right: PDF_MARGEN },
      pageBreak: 'avoid',
      rowPageBreak: 'avoid',
    });

    return doc.lastAutoTable.finalY + 4;
  }

  function renderAsignacionFolioCompartido(doc, y, share) {
    if (y > altoPaginaPDF(doc) - 45) {
      doc.addPage();
      y = PDF_Y_CONTENIDO;
    }

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 40, 140);
    doc.text('Asignación folio', 16, y + 4);

    doc.autoTable({
      startY: y + 5,
      head: [['% Participación', 'Monto asignado']],
      body: [[
        `${Number(share.porcentaje || 0).toFixed(2)}%`,
        formatCLP(share.monto_asignado),
      ]],
      theme: 'grid',
      styles: {
        fontSize: 6.95,
        cellPadding: { top: 1.2, right: 1.7, bottom: 1.2, left: 1.7 },
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: [224, 232, 229],
        lineWidth: 0.12,
      },
      headStyles: {
        fillColor: [248, 246, 252],
        textColor: [70, 35, 120],
        fontStyle: 'bold',
        fontSize: 6.95,
        valign: 'middle',
        lineColor: [223, 218, 232],
        lineWidth: 0.12,
      },
      columnStyles: {
        0: { cellWidth: 90, halign: 'right' },
        1: { cellWidth: 92, halign: 'right' },
      },
      margin: { left: PDF_MARGEN, right: PDF_MARGEN },
      pageBreak: 'avoid',
      rowPageBreak: 'avoid',
    });

    return doc.lastAutoTable.finalY + 4;
  }

  function modoFiltroPDF() {
    return document.getElementById('filtroPdf')?.value || 'todos';
  }

  function codigoVendedorDocumento(venta) {
    return String(venta?.CodVendedor ?? venta?.cod_vendedor_principal ?? '').trim();
  }

  function codigoVendedorFiltroPDF() {
    return String(document.getElementById('pdfCodVendedor')?.value || '').trim();
  }

  function nombreVendedorPorCodigoPDF(codigo) {
    const cod = String(codigo || '').trim();
    if (!cod) return '';
    const encontrado = (Array.isArray(todosVendedores) ? todosVendedores : []).find(v => String(v?.cod ?? '').trim() === cod);
    return String(encontrado?.nombre || encontrado?.usuario || '').trim();
  }

  function tituloPDFReporte(modo, codigo, nombreVendedor = '') {
    switch (modo) {
      case 'compartidos':
        return 'TEXPRO — Reporte de Ventas Asignadas';
      case 'especifico':
        return nombreVendedor
          ? `TEXPRO — Reporte Vendedor ${codigo || '—'} — ${nombreVendedor}`
          : `TEXPRO — Reporte Vendedor ${codigo || '—'}`;
      default:
        return 'TEXPRO — Reporte Vendedores';
    }
  }

  function subtituloPDFReporte(modo, codigo, mesLabel) {
    switch (modo) {
      case 'compartidos':
        return `Ventas Compartidas — ${mesLabel}`;
      case 'especifico':
        return `Detalle de Folios — ${mesLabel}`;
      default:
        return `Todos mis códigos — ${mesLabel}`;
    }
  }

  function nombreArchivoPDFReporte(modo, codigo, mesLabel) {
    const baseMes = String(mesLabel || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const baseCodigo = String(codigo || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'especifico';

    if (modo === 'compartidos') return `reporte_ventas_compartidos_${baseMes}.pdf`;
    if (modo === 'especifico') return `reporte_ventas_vendedor_${baseCodigo}_${baseMes}.pdf`;
    return `reporte_ventas_todos_los_codigos_${baseMes}.pdf`;
  }

  function agruparVentasPorCodigoPDF(ventas) {
    const grupos = new Map();
    (Array.isArray(ventas) ? ventas : []).forEach(venta => {
      const codigo = codigoVendedorDocumento(venta) || '—';
      if (!grupos.has(codigo)) grupos.set(codigo, []);
      grupos.get(codigo).push(venta);
    });

    return [...grupos.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'es', { numeric: true }))
      .map(([codigo, items]) => ({
        codigo,
        nombre: nombreVendedorPorCodigoPDF(codigo),
        ventas: ordenarRegistrosPDF(items),
      }));
  }

  function sincronizarFiltroPDFUI() {
    const grupo = document.getElementById('grupoPdfCodigo');
    const input = document.getElementById('pdfCodVendedor');
    const esEspecifico = modoFiltroPDF() === 'especifico';
    if (grupo) grupo.style.display = esEspecifico ? 'flex' : 'none';
    if (input) {
      input.disabled = !esEspecifico;
      if (!esEspecifico) input.value = '';
    }
  }

  function actualizarListaCodigosPDF() {
    const lista = document.getElementById('listaCodigosPdf');
    if (!lista) return;
    const codigos = new Set(codigosUsuarioPDF());
    lista.innerHTML = [...codigos].sort().map(c => `<option value="${c}"></option>`).join('');
  }

  function filtrarVentasParaPDF(ventas) {
    const modo = modoFiltroPDF();
    if (modo === 'compartidos') return [];
    const permitidos = new Set(codigosUsuarioPDF());
    if (modo !== 'especifico') return ventas.filter(v => permitidos.has(codigoVendedorDocumento(v)));
    const cod = codigoVendedorFiltroPDF();
    if (!cod || !permitidos.has(cod)) return [];
    return ventas.filter(v => codigoVendedorDocumento(v) === cod);
  }

  function codigosUsuarioPDF() {
    return (Array.isArray(_usuarioActual?.vendedores) ? _usuarioActual.vendedores : [])
      .map(v => String(v?.cod_vendedor ?? '').trim())
      .filter(Boolean);
  }

  function esCodigoPermitidoPDF(codigo) {
    const cod = String(codigo || '').trim();
    return cod ? codigosUsuarioPDF().includes(cod) : false;
  }

  function combinarCompartidosPDF() {
    const vistos = new Set();
    const resultado = [];
    const agregar = (item, vistaCompartido) => {
      if (!item) return;
      const key = [
        item.id ?? '',
        item.folio ?? '',
        item.cod_vendedor_principal ?? '',
        item.cod_vendedor_compartido ?? '',
        item.fecha ?? '',
      ].join('|');
      if (vistos.has(key)) return;
      vistos.add(key);
      resultado.push({ ...item, vistaCompartido });
    };

    (_ultimosCompartidos || []).forEach(item => agregar(item, 'receptor'));
    (_ultimosAsignados || []).forEach(item => agregar(item, 'origen'));
    return ordenarRegistrosPDF(resultado);
  }

  async function generarPDF() {
    const btnPdf = document.getElementById('btnGenerarPDF');
    try {
      if (btnPdf) { btnPdf.disabled = true; btnPdf.textContent = 'Generando...'; }

      const modoPDF   = modoFiltroPDF();
      const codigoPDF = codigoVendedorFiltroPDF();
      if (modoPDF === 'especifico' && !codigoPDF) {
        alert('Selecciona un código vendedor para generar el PDF.');
        return;
      }
      if (modoPDF === 'especifico' && !esCodigoPermitidoPDF(codigoPDF)) {
        alert('El código vendedor no pertenece a tu usuario.');
        return;
      }

      const ventasParaPDF      = ordenarRegistrosPDF(filtrarVentasParaPDF(_ultimasVentas));
      const compartidosParaPDF  = modoPDF === 'compartidos'
        ? combinarCompartidosPDF()
        : (modoPDF === 'todos' ? ordenarRegistrosPDF(_ultimosCompartidos.slice()) : []);
      const asignadosParaPDF    = ordenarRegistrosPDF(modoPDF === 'todos' ? _ultimosAsignados.slice() : []);
      const filtrosPDF          = getParams();

      const jsPDF    = await cargarLibreriaPDF();
      const doc      = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const mesLabel = getMesFiltro();
      const nombre   = _usuarioActual?.nombre || 'Vendedor';
      const hoy      = new Date().toLocaleDateString('es-CL', { day:'2-digit', month:'2-digit', year:'numeric' });
      const nombreVendedorPDF = nombreVendedorPorCodigoPDF(codigoPDF);
      const tituloPDF = tituloPDFReporte(modoPDF, codigoPDF, nombreVendedorPDF);
      const subtituloPDF = subtituloPDFReporte(modoPDF, codigoPDF, mesLabel);

      function addPageHeader() {
        doc.setFillColor(0, 174, 142);
        doc.rect(0, 0, anchoPaginaPDF(doc), 24, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(13); doc.setFont('helvetica', 'bold');
        doc.text(tituloPDF, 14, 11);
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
        doc.text(`Vendedor: ${nombre}`, 14, 16);
        doc.text(`Período: ${mesLabel}   |   Emitido: ${hoy}`, 14, 20);
        doc.setTextColor(0, 0, 0);
      }

      addPageHeader();
      let y = PDF_Y_CONTENIDO;

      if (modoPDF === 'compartidos') {
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        doc.text(subtituloPDF, 14, y);
        y += 5;

        if (compartidosParaPDF.length) {
          const compartidosConDetalle = await Promise.all(compartidosParaPDF.map(async c => {
            let detalleInfo = null;
            try {
              detalleInfo = await obtenerDetalleFolioCompartido(c.folio, { force: true, anio: filtrosPDF.anio });
            } catch (e) {
              console.warn(`[PDF] No se pudo cargar detalle compartido ${c.folio}:`, e);
            }
            return { ...c, detalleInfo };
          }));

          compartidosConDetalle.sort(compararRegistrosPDF);

          const totalAsignadoGeneral = compartidosConDetalle.reduce(
            (acc, item) => acc + Number(item.monto_asignado || 0),
            0
          );

          for (const share of compartidosConDetalle) {
            const detalleInfo = share.detalleInfo || {
              detalle: [],
              primera: {},
              resumen: { cant: 0, totalReal: 0, totalVenta: 0, dcto: null },
            };

            if (y > altoPaginaPDF(doc) - 55) {
              doc.addPage();
              addPageHeader();
              y = PDF_Y_CONTENIDO;
            }

            y = renderCabeceraFolioCompartido(doc, y, share, detalleInfo);
            y = renderTablaDetalleCompartido(doc, y, detalleInfo.detalle);
            y = renderResumenFolioCompartido(doc, y, detalleInfo.resumen, 'Subtotal folio');
            y = renderAsignacionFolioCompartido(doc, y, share);
            y += 2;
          }

          if (y > altoPaginaPDF(doc) - 45) {
            doc.addPage();
            addPageHeader();
            y = PDF_Y_CONTENIDO;
          }

          doc.setFontSize(10);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(0, 100, 80);
          doc.text(`Total compartido asignado: ${formatCLP(totalAsignadoGeneral)}`, 14, y);
        } else {
          doc.setFontSize(9); doc.setFont('helvetica', 'normal');
          doc.text('Sin folios compartidos para el período seleccionado.', 14, y);
        }
      } else if (ventasParaPDF.length) {
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        doc.text(subtituloPDF, 14, y);
        y += 5;

        const gruposVentas = modoPDF === 'todos'
          ? agruparVentasPorCodigoPDF(ventasParaPDF)
          : [{ codigo: codigoPDF || '—', nombre: nombreVendedorPDF || nombre, ventas: ventasParaPDF }];

        for (const grupo of gruposVentas) {
          if (modoPDF === 'todos') {
            if (y > altoPaginaPDF(doc) - 18) {
              doc.addPage();
              addPageHeader();
              y = PDF_Y_CONTENIDO;
            }

            doc.setFillColor(236, 244, 241);
            doc.rect(PDF_MARGEN, y, anchoContenidoPDF(doc), 8.5, 'F');
            doc.setFontSize(8.8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 100, 80);
            doc.text(`Código vendedor: ${grupo.codigo}`, 16, y + 5.2);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(40, 40, 40);
            doc.text(`Vendedor: ${grupo.nombre || 'Sin nombre'}`, 78, y + 5.2);
            y += 11;
          }

          let resumenGrupo = { cant: 0, totalReal: 0, totalVenta: 0, dcto: null };

          for (const venta of grupo.ventas) {
            let detalleData = null;
            try {
              detalleData = await fetchDetalleFolio(venta.Folio, { force: true, anio: filtrosPDF.anio });
            } catch (e) {
              console.warn(`[PDF] No se pudo cargar detalle del folio ${venta.Folio}:`, e);
            }

            const d0       = detalleData?.detalle?.[0] || {};
            const lineas   = detalleData?.detalle || [];
            const cliente  = d0.Cliente || venta.cliente || '?';
            const fecha    = d0.Fecha   || venta.fecha_formato || '?';
            const tipo     = resolverTipoFolio(
              detalleData?.tipo_folio,
              detalleData?.Tipo,
              detalleData?.tipo,
              d0.tipo_folio,
              d0.Tipo,
              d0.tipo,
              venta.tipo_folio,
              venta.Tipo,
              venta.tipo
            );
            const codAux   = d0.CodAux  || '?';
            const canCod   = d0.CanCod  || '?';
            if (y > altoPaginaPDF(doc) - 60) {
              doc.addPage();
              addPageHeader();
              y = PDF_Y_CONTENIDO;
            }

            const clienteLineasFolio = doc.splitTextToSize(`Cliente: ${cliente}`, anchoContenidoPDF(doc) - 22);
            const altoClienteFolio = Math.max(4, clienteLineasFolio.length * 4);
            const altoBloqueFolio = 23 + altoClienteFolio + 10;

            doc.setFillColor(240, 248, 246);
            doc.rect(PDF_MARGEN, y, anchoContenidoPDF(doc), altoBloqueFolio, 'F');
            doc.setFontSize(8.5); doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 100, 80);
            doc.text(`Folio: ${venta.Folio}`, 16, y + 5.2);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(40, 40, 40);
            doc.text(`Fecha: ${fecha}`, 72, y + 5.2);
            doc.text(`Tipo folio: ${tipo}`, 16, y + 10.8);
            doc.text(`Cód. Cliente: ${codAux}`, 80, y + 10.8);
            doc.text(`CanCod: ${canCod}`, 152, y + 10.8);
            doc.text(clienteLineasFolio, 16, y + 15.8);
            y += 15.8 + altoClienteFolio + 1;

            const filasProductos = lineas.map(p => {
              const cant     = Number(p.CantFacturada) || 0;
              const precReal = Number(p.precio_real ?? p.PrecioReal ?? p.precio_real_oficial) || 0;
              const precVta  = Number(p.precio_vta ?? p.PrecioVta ?? p.precio_unitario_cobrado) || 0;
              const totReal  = Number(p.neto_real ?? p.NetoReal ?? p.valor_historico_linea) || 0;
              const totVta   = Number(p.neto_total ?? p.NetoTotal ?? p.valor_cobrado_linea ?? p.TotLinea) || 0;
              const descBase = Number(p.dcto ?? p.Dcto);
              const desc     = Number.isFinite(descBase) ? descBase : (
                precReal !== 0
                  ? Math.round((((Math.abs(totReal) - Math.abs(totVta)) / Math.abs(totReal)) * 100) * 100) / 100
                  : 0
              );
              return [
                p.CodProd || '—',
                p.DesProd || p.descripcion || '—',
                String(cant),
                formatCLP(precReal),
                formatCLP(precVta),
                formatCLP(totReal),
                formatCLP(totVta),
                Number.isFinite(desc) ? `${desc}%` : '—',
              ];
            });

            doc.autoTable({
              startY: y,
              head: [['Código', 'Descripción', 'Cant.', 'Precio Real', 'Precio Venta', 'Total Real', 'Total Venta', 'Descuento']],
              body: filasProductos.length
                ? filasProductos
                : [['Sin productos', '', '', '', '', '', '', '']],
              theme: 'grid',
              styles: {
                fontSize: 6.95,
                cellPadding: { top: 1.2, right: 1.7, bottom: 1.2, left: 1.7 },
                overflow: 'linebreak',
                valign: 'middle',
                lineColor: [224, 232, 229],
                lineWidth: 0.12,
              },
              headStyles: {
                fillColor: [0, 140, 115],
                textColor: 255,
                fontStyle: 'bold',
                fontSize: 6.95,
                valign: 'middle',
                lineColor: [0, 120, 98],
                lineWidth: 0.12,
              },
              alternateRowStyles: { fillColor: [250, 253, 252] },
              columnStyles: {
                0: { cellWidth: 16, halign: 'left' },
                1: { cellWidth: 58, halign: 'left' },
                2: { cellWidth: 10, halign: 'center' },
                3: { cellWidth: 18, halign: 'right' },
                4: { cellWidth: 14, halign: 'right' },
                5: { cellWidth: 22, halign: 'right' },
                6: { cellWidth: 22, halign: 'right' },
                7: { cellWidth: 18, halign: 'right' },
              },
              margin: { left: PDF_MARGEN, right: PDF_MARGEN },
              didParseCell(data) {
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

            const resumenFolio = resumenDetalleFolio(lineas);
            resumenGrupo.cant += Number(resumenFolio.cant || 0);
            resumenGrupo.totalReal += Number(resumenFolio.totalReal || 0);
            resumenGrupo.totalVenta += Number(resumenFolio.totalVenta || 0);

            y = renderResumenFolioCompartido(doc, doc.lastAutoTable.finalY + 2, resumenFolio, 'Subtotal folio') + 2;
          }

          if (modoPDF === 'todos' && grupo.ventas.length) {
            const baseGrupo = Math.abs(resumenGrupo.totalReal) || Math.abs(resumenGrupo.totalVenta) || 0;
            const resumenCodigo = {
              cant: resumenGrupo.cant,
              totalReal: resumenGrupo.totalReal,
              totalVenta: resumenGrupo.totalVenta,
              dcto: baseGrupo
                ? Math.round((((Math.abs(resumenGrupo.totalReal) - Math.abs(resumenGrupo.totalVenta)) / baseGrupo) * 100) * 100) / 100
                : null,
            };
            y = renderResumenFolioCompartido(doc, y, resumenCodigo, `Total código ${grupo.codigo}`) + 2;
          }
        }
      } else {
        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text('Sin ventas registradas para el período seleccionado.', 14, y);
        y += 10;
      }

      const panelComp = document.getElementById('panelCompartidos');
      if (modoPDF === 'todos' && panelComp && panelComp.style.display !== 'none' && _ultimosCompartidos.length) {
        if (y > altoPaginaPDF(doc) - 55) { doc.addPage(); addPageHeader(); y = PDF_Y_CONTENIDO; }
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text('Ventas Compartidas Conmigo', 14, y); y += 3;

        const filasC = compartidosParaPDF.map(c => [
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
          styles: { fontSize: 7.4, cellPadding: 2.2, overflow: 'linebreak' },
          headStyles: { fillColor: [0, 120, 180], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [245, 248, 252] },
          columnStyles: {
            0: { cellWidth: 18 },
            1: { cellWidth: 24 },
            2: { cellWidth: 60 },
            3: { cellWidth: 46 },
            4: { cellWidth: 14, halign: 'right' },
            5: { cellWidth: 20, halign: 'right' },
          },
          margin: { left: PDF_MARGEN, right: PDF_MARGEN },
        });
        y = doc.lastAutoTable.finalY + 10;
      }

      const panelAsig = document.getElementById('panelCoordinador');
      if (modoPDF === 'todos' && panelAsig && panelAsig.style.display !== 'none' && asignadosParaPDF.length) {
        if (y > altoPaginaPDF(doc) - 55) { doc.addPage(); addPageHeader(); y = PDF_Y_CONTENIDO; }
        doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text('Folios Asignados a Vendedores', 14, y); y += 3;

        const filasA = asignadosParaPDF.map(c => [
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
          styles: { fontSize: 7.4, cellPadding: 2.2, overflow: 'linebreak' },
          headStyles: { fillColor: [100, 60, 180], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [248, 246, 252] },
          columnStyles: {
            0: { cellWidth: 18 },
            1: { cellWidth: 24 },
            2: { cellWidth: 60 },
            3: { cellWidth: 46 },
            4: { cellWidth: 18, halign: 'right' },
            5: { cellWidth: 20, halign: 'right' },
          },
          margin: { left: PDF_MARGEN, right: PDF_MARGEN },
        });
      }

      const totalPags = doc.internal.getNumberOfPages();
      const footerY = altoPaginaPDF(doc) - 12;
      for (let i = 1; i <= totalPags; i++) {
        doc.setPage(i);
        doc.setFontSize(7); doc.setTextColor(160, 160, 160);
        doc.text(`TEXPRO — Documento interno. Página ${i} de ${totalPags}`, PDF_MARGEN, footerY);
        doc.text(hoy, anchoPaginaPDF(doc) - PDF_MARGEN, footerY, { align: 'right' });
        doc.setTextColor(0, 0, 0);
      }

      doc.save(nombreArchivoPDFReporte(modoPDF, codigoPDF, mesLabel));
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

  const MODULOS = [
    { nombre:'Dashboard',           icon:'🏠', url:'../dashboard/index.html',                       area: null },
    { nombre:'Historial Cliente',   icon:'📋', url:'../historial-cliente/index.html',               area:['ventas','gerencia'] },
    { nombre:'Facturación',         icon:'🧾', url:'../../facturacion/facturacion/index.html',      area:['facturacion','contabilidad','gerencia'] },
    { nombre:'Bodega',              icon:'🏭', url:'../../bodega/bodega/index.html',                area:['bodega','produccion','gerencia'] },
    { nombre:'RRHH',                icon:'👥', url:'../../rrhh/remuneraciones/index.html',          area:['rrhh','gerencia'] },
    { nombre:'Asignar Ventas',      icon:'🤝', url:'index.html',                                    area:['ventas','gerencia'] },
  ];

  function cargarSidebar(usuario) {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    const area = (usuario.area || '').toLowerCase();
    if (!window.__APP_SIDEBAR_LOADED__) nav.innerHTML = MODULOS
      .filter(m => !m.area || m.area.includes(area))
      .map(m => `<a href="${m.url}" class="sidebar-link ${m.url==='index.html'?'active':''}"><span class="sidebar-icon">${m.icon}</span><span>${m.nombre}</span></a>`)
      .join('');
    const nombreCompleto = nombreVisibleUsuario(usuario);
    const nombreCorto = nombreCortoUsuario(nombreCompleto);
    setText('userName', nombreCompleto);
    setText('chipName', nombreCompleto);
    setText('userArea', usuario.area || '');
    const inicial = nombreCorto.charAt(0).toUpperCase();
    setText('userAvatar', inicial);
    setText('chipAvatar', inicial);
    setText('headerDate', new Date().toLocaleDateString('es-CL', { weekday:'long', day:'numeric', month:'long' }));
    actualizarSaludoUsuario(usuario);
    document.getElementById('btnLogout')?.addEventListener('click', () => { localStorage.removeItem('token'); window.location.href='../../varios/login/index.html'; });
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper')?.classList.toggle('main-wrapper--expanded');
    });
    document.getElementById('headerMenuBtn')?.addEventListener('click', () => document.getElementById('sidebar')?.classList.toggle('sidebar--open'));
  }

  function initSelectores() {
    const hoy = new Date();
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
      for (let y = hoy.getFullYear(); y >= 2026; y--) {
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

  async function cargarListaVendedores() {
    try {
      const res  = await fetch(`${API}/vendedores-todos`, { headers:{ Authorization:`Bearer ${token()}` } });
      const data = await res.json();
      if (!data.ok || !data.vendedores?.length) return;
      todosVendedores = data.vendedores;
      actualizarListaCodigosPDF();
      const sel = document.getElementById('coordVendedor');
      if (!sel) return;
      sel.innerHTML = '<option value="">— Selecciona vendedor —</option>' +
        data.vendedores.map(v => `<option value="${v.cod}">${v.cod} — ${v.nombre||'Sin nombre'}</option>`).join('');
    } catch(err) { console.error('[cargarListaVendedores]', err); }
  }

  async function iniciarPanelCoordinador() {
    setStyle('panelCoordinador', 'display', 'block');

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
        if (coordPct)  coordPct.value  = '50';
        await Promise.all([ cargarFoliosParaCompartir(), cargarFoliosAsignados() ]);
      } catch(err) {
        const msgEl2 = document.getElementById('coordMensaje');
        if (msgEl2) { msgEl2.textContent = `❌ ${err.message}`; msgEl2.style.color = 'var(--color-danger)'; }
      }
    });
  }

  async function refrescarVista() {
    const esCoord = esCoordinador(_usuarioActual);
    await cargarVentas();
    if (esCoord) {
      await Promise.all([cargarListaVendedores(), cargarFoliosParaCompartir(), cargarFoliosAsignados()]);
    }
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
        data.folios.map(f => `<option value="${f.Folio}">${f.Folio} — ${f.cliente||'—'} — ${formatCLP(f.monto)}</option>`).join('');
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
      _ultimosAsignados   = data.asignados || [];
      setText('totalAsignados', `${_ultimosAsignados.length} registros`);
      if (!tbody) return;
      if (!_ultimosAsignados.length) {
        tbody.innerHTML = '<tr class="tabla-empty"><td colspan="7" style="text-align:center;padding:1.5rem;color:#aaa">Sin folios asignados este mes</td></tr>';
        await cargarEstadoReporteCompartido(_ultimosAsignados);
        return;
      }
      tbody.innerHTML = _ultimosAsignados.map(c => `<tr data-id="${c.id}">${filaAsignadoVista(c)}</tr>`).join('');
      tbody.querySelectorAll('.btn-crud--edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const tr = btn.closest('tr');
          const id = btn.dataset.id;
          const c  = _ultimosAsignados.find(x => String(x.id) === id);
          if (c) tr.innerHTML = filaAsignadoEdicion(c);
          bindCrudSave(tbody);
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
      await cargarEstadoReporteCompartido(_ultimosAsignados);
    } catch(err) { console.error('[cargarFoliosAsignados]', err); }
  }

  function bindCrudSave(tbody) {
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

  function getReporteCompartidoResumenActual() {
    const filas = Array.isArray(_ultimosAsignados) ? _ultimosAsignados : [];
    const totalVentaReal = filas.reduce((acc, row) => acc + Number(row.monto_asignado || 0), 0);
    const cantidadFolios = new Set(filas.map(row => String(row.folio))).size;

    return {
      total_venta: Math.round(totalVentaReal),
      total_venta_real: Math.round(totalVentaReal),
      total_descuento: 0,
      total_comision: Math.round(totalVentaReal),
      cantidad_folios: cantidadFolios,
      cantidad_lineas: filas.length,
    };
  }

  function setEstadoReporteCompartido(texto, variante = 'normal') {
    const el = document.getElementById('compartidosEstado');
    if (!el) return;
    el.textContent = texto;
    el.dataset.variant = variante;
  }

  function setTextoBotonReporteCompartido(texto) {
    const btn = document.getElementById('btnConfirmarReporteCompartido');
    if (btn) btn.textContent = texto;
  }

  async function cargarEstadoReporteCompartido(foliosAsignados = _ultimosAsignados) {
    const btn = document.getElementById('btnConfirmarReporteCompartido');
    if (!btn) return;

    const filas = Array.isArray(foliosAsignados) ? foliosAsignados : [];
    const totalFolios = filas.length;
    const totalPendientes = 0;
    const resumen = {
      total_venta_real: filas.reduce((acc, row) => acc + Number(row.monto_asignado || 0), 0),
    };
    const estadoReporte = null;

    console.debug?.('[folios asignados confirmacion]', {
      totalFolios,
      totalPendientes,
      estadoReporte,
    });

    if (totalFolios === 0) {
      btn.disabled = true;
      btn.classList.remove('is-confirmed');
      setEstadoReporteCompartido('Sin folios asignados en este período', 'muted');
      return;
    }

    try {
      const params = getParams();
      const res = await fetch(`${API}/compartidas/confirmacion?${new URLSearchParams(params)}`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'No se pudo obtener el estado');

      if (data.existe && data.estado) {
        const fecha = data.confirmado_at ? new Date(data.confirmado_at).toLocaleDateString('es-CL') : 'hoy';
        const estadoTexto = data.estado === 'validado_rrhh'
          ? 'Validado por RRHH'
          : (data.estado === 'rechazado_rrhh'
            ? `Rechazado por RRHH${data.motivo_rechazo ? `: ${data.motivo_rechazo}` : ''}`
            : `Reporte ya confirmado el ${fecha}`);
        setEstadoReporteCompartido(estadoTexto, data.estado);
        const bloqueado = data.estado === 'confirmado_vendedor' || data.estado === 'validado_rrhh';
        btn.disabled = bloqueado;
        btn.classList.toggle('is-confirmed', bloqueado);
        setTextoBotonReporteCompartido(data.estado === 'rechazado_rrhh'
          ? 'Reenviar confirmación'
          : 'Confirmar ventas compartidas');
      } else {
        btn.disabled = false;
        btn.classList.remove('is-confirmed');
        setTextoBotonReporteCompartido('Confirmar ventas compartidas');
        setEstadoReporteCompartido(`Listo para enviar a RRHH · ${formatCLP(resumen.total_venta_real)} total asignado`, 'ready');
      }
    } catch (err) {
      btn.disabled = false;
      btn.classList.remove('is-confirmed');
      setEstadoReporteCompartido('Estado no disponible', 'error');
      console.error('[cargarEstadoReporteCompartido]', err);
    }
  }

  function abrirModalReporteCompartido() {
    if (!_ultimosAsignados.length) return;
    const modal = document.getElementById('modalConfirmarCompartidos');
    if (!modal) return;
    const params = getParams();
    const resumen = getReporteCompartidoResumenActual();
    const periodo = `${MESES_NOMBRE[Number(params.mes) - 1] || 'Mes'} ${params.anio}`;
    document.getElementById('modalCompartidoPeriodo').textContent = periodo;
    document.getElementById('modalCompartidoTotalVenta').textContent = formatCLP(resumen.total_venta);
    document.getElementById('modalCompartidoTotalVentaReal').textContent = formatCLP(resumen.total_venta_real);
    document.getElementById('modalCompartidoTotalDescuento').textContent = formatCLP(resumen.total_descuento);
    document.getElementById('modalCompartidoTotalComision').textContent = formatCLP(resumen.total_comision);
    document.getElementById('modalCompartidoFolios').textContent = `${resumen.cantidad_folios}`;
    document.getElementById('modalCompartidoLineas').textContent = `${resumen.cantidad_lineas}`;
    const feedback = document.getElementById('modalCompartidoFeedback');
    if (feedback) feedback.textContent = '';
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('is-open');
  }

  function cerrarModalReporteCompartido() {
    const modal = document.getElementById('modalConfirmarCompartidos');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    modal.hidden = true;
  }

  async function confirmarReporteCompartido() {
    const feedback = document.getElementById('modalCompartidoFeedback');
    const btn = document.getElementById('btnEnviarReporteCompartido');
    const params = getParams();
    const detalle = Array.isArray(_ultimosAsignados) ? _ultimosAsignados : [];
    if (!detalle.length) return;

    try {
      if (btn) btn.disabled = true;
      if (feedback) feedback.textContent = 'Confirmando reporte...';

      const res = await fetch('/api/ventas/compartidas/confirmar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({ mes: Number(params.mes), anio: Number(params.anio) }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'No se pudo confirmar el reporte');

      if (feedback) feedback.textContent = data.mensaje || 'Ventas compartidas confirmadas y enviadas a RRHH.';
      setEstadoReporteCompartido('Ventas compartidas confirmadas y enviadas a RRHH.', 'success');
      setTextoBotonReporteCompartido('Confirmar ventas compartidas');
      await cargarEstadoReporteCompartido();
      cerrarModalReporteCompartido();
    } catch (err) {
      if (btn) btn.disabled = false;
      if (feedback) feedback.textContent = `Error: ${err.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

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

      _ultimasVentas      = dataV.ventas || [];
      _ultimosCompartidos = dataC.compartidos || [];
      actualizarListaCodigosPDF();

      const tbodyV = document.getElementById('tbodyVentas');
      setText('totalVentas', `${_ultimasVentas.length} registros`);

      if (!_ultimasVentas.length) {
        if (tbodyV) tbodyV.innerHTML = '<tr class="tabla-empty"><td colspan="8" style="text-align:center;padding:2rem;color:#aaa">Sin ventas este mes</td></tr>';
      } else if (tbodyV) {
        tbodyV.innerHTML = _ultimasVentas.map(v => {
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
              <td style="text-align:right">${formatDescuentoVenta(v)}</td>
            </tr>`;
        }).join('');
        bindDetalleRows(tbodyV, 'Folio', 8);
      }

    } catch (err) {
      console.error('[cargarVentas]', err);
    } finally {
      ocultarCarga();
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    _usuarioActual = await verificarSesion();
    if (!_usuarioActual) return;

    cargarSidebar(_usuarioActual);
    initSelectores();
    sincronizarFiltroPDFUI();

    if (esCoordinador(_usuarioActual)) {
      await iniciarPanelCoordinador();
    }

    document.getElementById('btnConfirmarReporteCompartido')?.addEventListener('click', abrirModalReporteCompartido);
    document.getElementById('btnEnviarReporteCompartido')?.addEventListener('click', confirmarReporteCompartido);
    document.querySelectorAll('[data-modal-close="true"]').forEach(btn => {
      btn.addEventListener('click', cerrarModalReporteCompartido);
    });
    document.getElementById('modalConfirmarCompartidos')?.addEventListener('click', (event) => {
      if (event.target?.dataset?.modalClose === 'true') cerrarModalReporteCompartido();
    });

    await refrescarVista();

    document.getElementById('filtroPdf')?.addEventListener('change', sincronizarFiltroPDFUI);
    document.getElementById('btnActualizar')?.addEventListener('click', refrescarVista);
    document.getElementById('btnGenerarPDF')?.addEventListener('click', generarPDF);
  });

})();

