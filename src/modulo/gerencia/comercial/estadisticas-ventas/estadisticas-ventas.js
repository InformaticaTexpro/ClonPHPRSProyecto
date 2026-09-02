'use strict';

(function () {
  const API_BASE = '/api/gerencia/comercial';
  const token = () => localStorage.getItem('token') || '';
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  let cargaSecuencia = 0;
  let datosActuales = null;
  let ultimoFoco = null;

  function formatCLP(valor) {
    const numero = Number(valor ?? 0);
    if (!Number.isFinite(numero)) return '—';
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      maximumFractionDigits: 0,
    }).format(numero);
  }

  function formatPct(valor) {
    const numero = Number(valor ?? 0);
    if (!Number.isFinite(numero)) return '—';
    return `${numero.toFixed(2)} %`;
  }

  function formatCount(valor) {
    const numero = Number(valor ?? 0);
    return Number.isFinite(numero) ? new Intl.NumberFormat('es-CL').format(numero) : '0';
  }

  function escHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  async function apiGet(path) {
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token()}`,
        Accept: 'application/json',
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Error HTTP ${response.status}`);
    }
    return data.data ?? data;
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setLoadingState(visible, message) {
    const overlay = document.getElementById('gerenciaLoadingOverlay');
    const wrapper = document.getElementById('mainWrapper');
    const label = overlay?.querySelector('[data-loading-text]');
    if (label && message) label.textContent = message;
    if (overlay) {
      overlay.classList.toggle('is-visible', Boolean(visible));
      overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    if (wrapper) wrapper.setAttribute('aria-busy', visible ? 'true' : 'false');
    document.querySelectorAll('.gerencia-filtros .filtro-select, .gerencia-filtros .btn-buscar, .gerencia-filtros .btn-exportar').forEach(control => {
      control.disabled = Boolean(visible) || (control.id === 'btnExportarPdf' && !datosActuales);
    });
  }

  function renderMonths() {
    const select = document.getElementById('monthFilter');
    if (!select) return;
    const current = new Date().getMonth() + 1;
    select.innerHTML = mesesNombres.map((nombre, index) => `<option value="${index + 1}">${nombre}</option>`).join('');
    select.value = String(current);
  }

  function renderYears() {
    const select = document.getElementById('yearFilter');
    if (!select) return;
    const current = new Date().getFullYear();
    const years = [current - 2, current - 1, current, current + 1];
    select.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join('');
    select.value = String(current);
  }

  function closeVendorCodes() {
    const modal = document.getElementById('vendorCodesModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ventas-modal-open');
    if (ultimoFoco instanceof HTMLElement) ultimoFoco.focus();
    ultimoFoco = null;
  }

  function resetView() {
    datosActuales = null;
    closeVendorCodes();
    setText('kpiVentaTotal', formatCLP(0));
    setText('kpiCantidadUnidades', '0');
    setText('kpiCantidadVendedores', '0');
    setText('kpiCantidadCodigos', '0');
    const summaryBody = document.getElementById('unitsSummaryBody');
    const summaryFoot = document.getElementById('unitsSummaryFoot');
    const detail = document.getElementById('unitsDetail');
    const modalBody = document.getElementById('vendorCodesBody');
    if (summaryBody) summaryBody.innerHTML = '<tr><td colspan="3" class="gerencia-empty">No hay unidades para mostrar.</td></tr>';
    if (summaryFoot) summaryFoot.innerHTML = '';
    if (detail) detail.innerHTML = '<p class="gerencia-empty">No existen ventas para el período seleccionado.</p>';
    if (modalBody) modalBody.innerHTML = '';
    setText('vendorCodesTotal', formatCLP(0));
  }

  function renderSummary(data) {
    const resumen = data?.resumen || {};
    setText('kpiVentaTotal', formatCLP(resumen.ventaTotal ?? 0));
    setText('kpiCantidadUnidades', formatCount(resumen.cantidadUnidades ?? 0));
    setText('kpiCantidadVendedores', formatCount(resumen.cantidadVendedores ?? 0));
    setText('kpiCantidadCodigos', formatCount(resumen.cantidadCodigos ?? 0));
    setText('headerIndicadores', `${mesesNombres[(Number(data?.mes || 1) - 1)] || 'Mes'} ${data?.anio || ''}`);
  }

  function renderUnitsSummary(data) {
    const body = document.getElementById('unitsSummaryBody');
    const foot = document.getElementById('unitsSummaryFoot');
    if (!body || !foot) return;
    const units = Array.isArray(data?.resumenUnidades) ? data.resumenUnidades : [];
    if (!units.length) return;

    body.innerHTML = units.map(unit => `
      <tr>
        <td><strong>${escHtml(unit.unidad || 'Sin unidad')}</strong></td>
        <td class="numero">${formatCLP(unit.venta ?? 0)}</td>
        <td class="numero">${formatPct(unit.participacion ?? 0)}</td>
      </tr>
    `).join('');
    foot.innerHTML = `
      <tr>
        <th>Total</th>
        <th class="numero">${formatCLP(data?.resumen?.ventaTotal ?? 0)}</th>
        <th class="numero">${units.length ? '100,00 %' : '0,00 %'}</th>
      </tr>
    `;
  }

  function renderUnitsDetail(data) {
    const container = document.getElementById('unitsDetail');
    if (!container) return;
    const groups = Array.isArray(data?.grupos) ? data.grupos : [];
    if (!groups.length) return;

    container.innerHTML = groups.map((group, groupIndex) => {
      const sellers = Array.isArray(group.vendedores) ? group.vendedores : [];
      const rows = sellers.map((seller, sellerIndex) => `
        <tr>
          <td>
            <button class="vendedor-detalle" type="button" data-group-index="${groupIndex}" data-seller-index="${sellerIndex}">
              <strong>${escHtml(seller.vendedor || seller.codigoPrincipal || '-')}</strong>
              <small>${escHtml(seller.codigoPrincipal || '')}</small>
            </button>
          </td>
          <td class="numero">${formatCount(seller.cantidadCodigos ?? 0)}</td>
          <td class="numero">${formatCLP(seller.neto ?? 0)}</td>
          <td class="numero">${formatPct(seller.participacion ?? 0)}</td>
        </tr>
      `).join('');

      return `
        <article class="unidad-card">
          <header class="unidad-card__header">
            <h4>${escHtml(group.grupo || 'Sin unidad')}</h4>
            <div><strong>${formatCLP(group.total ?? 0)}</strong><span>${formatPct(group.participacion ?? 0)} del total general</span></div>
          </header>
          <div class="tabla-wrapper">
            <table class="dash-tabla">
              <thead><tr><th>Vendedor</th><th class="numero">Códigos</th><th class="numero">Venta</th><th class="numero">Participación</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="4" class="gerencia-empty">No hay vendedores para mostrar.</td></tr>'}</tbody>
              <tfoot><tr><th>Total unidad</th><th></th><th class="numero">${formatCLP(group.total ?? 0)}</th><th class="numero">${sellers.length ? '100,00 %' : '0,00 %'}</th></tr></tfoot>
            </table>
          </div>
        </article>
      `;
    }).join('');
  }

  function cargarScript(src, id) {
    return new Promise((resolve, reject) => {
      const existente = document.getElementById(id);
      if (existente) {
        if (existente.dataset.loaded === 'true') resolve();
        else existente.addEventListener('load', resolve, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.id = id;
      script.src = src;
      script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
      script.onerror = () => reject(new Error('No fue posible cargar la librería de PDF.'));
      document.head.appendChild(script);
    });
  }

  async function cargarLibreriaPDF() {
    if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API.autoTable) return window.jspdf.jsPDF;
    await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', 'jspdfScript');
    await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', 'jspdfAutoTableScript');
    return window.jspdf.jsPDF;
  }

  function pdfTableOptions(overrides = {}) {
    return {
      theme: 'grid',
      margin: { left: 9, right: 9 },
      styles: { font: 'helvetica', fontSize: 7.2, cellPadding: 1.35, overflow: 'linebreak' },
      headStyles: { fillColor: [32, 49, 47], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 249, 248] },
      ...overrides,
    };
  }

  async function exportarPdf() {
    if (!datosActuales) {
      setText('mensajeEstadisticas', 'Primero debe cargar un período para exportarlo.');
      return;
    }

    const button = document.getElementById('btnExportarPdf');
    button.disabled = true;
    setText('mensajeEstadisticas', 'Generando PDF...');
    try {
      const JsPDF = await cargarLibreriaPDF();
      const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      const data = datosActuales;
      const resumen = data.resumen || {};
      const periodo = `${mesesNombres[Number(data.mes || 1) - 1] || 'Mes'} ${data.anio || ''}`;
      const generado = new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());

      doc.setTextColor(32, 49, 47);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Estadísticas de Ventas', 9, 12);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(90, 100, 110);
      doc.text(`Período: ${periodo}`, 9, 17);
      doc.text(`Generado: ${generado}`, 288, 17, { align: 'right' });

      doc.autoTable(pdfTableOptions({
        startY: 21,
        head: [['Venta total', 'Unidades', 'Vendedores principales', 'Códigos asociados']],
        body: [[formatCLP(resumen.ventaTotal), formatCount(resumen.cantidadUnidades), formatCount(resumen.cantidadVendedores), formatCount(resumen.cantidadCodigos)]],
        bodyStyles: { fontSize: 9, fontStyle: 'bold', textColor: [15, 118, 110] },
      }));

      const unidades = Array.isArray(data.resumenUnidades) ? data.resumenUnidades : [];
      doc.autoTable(pdfTableOptions({
        startY: doc.lastAutoTable.finalY + 4,
        head: [['Resumen por unidad', 'Venta', 'Participación']],
        body: unidades.map(item => [item.unidad || 'Sin unidad', formatCLP(item.venta), formatPct(item.participacion)]),
        foot: [['TOTAL GENERAL', formatCLP(resumen.ventaTotal), unidades.length ? '100,00 %' : '0,00 %']],
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
        footStyles: { fillColor: [237, 248, 245], textColor: [23, 75, 67], fontStyle: 'bold' },
      }));

      (data.grupos || []).forEach(grupo => {
        const vendedores = Array.isArray(grupo.vendedores) ? grupo.vendedores : [];
        let startY = doc.lastAutoTable.finalY + 5;
        if (startY > 178) {
          doc.addPage();
          startY = 12;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(23, 75, 67);
        doc.text(String(grupo.grupo || 'Sin unidad'), 9, startY);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(90, 100, 110);
        doc.text(`Total unidad: ${formatCLP(grupo.total)} · Participación general: ${formatPct(grupo.participacion)}`, 288, startY, { align: 'right' });
        doc.autoTable(pdfTableOptions({
          startY: startY + 2,
          head: [['Vendedor principal', 'Código principal', 'Cantidad códigos', 'Venta', 'Participación unidad']],
          body: vendedores.map(vendedor => [
            vendedor.vendedor || vendedor.codigoPrincipal || '-',
            vendedor.codigoPrincipal || '-',
            formatCount(vendedor.cantidadCodigos),
            formatCLP(vendedor.neto),
            formatPct(vendedor.participacion),
          ]),
          foot: [['TOTAL UNIDAD', '', '', formatCLP(grupo.total), vendedores.length ? '100,00 %' : '0,00 %']],
          columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
          footStyles: { fillColor: [237, 248, 245], textColor: [23, 75, 67], fontStyle: 'bold' },
          rowPageBreak: 'avoid',
        }));
      });

      const paginas = doc.getNumberOfPages();
      for (let pagina = 1; pagina <= paginas; pagina += 1) {
        doc.setPage(pagina);
        doc.setFontSize(7);
        doc.setTextColor(110, 120, 128);
        doc.text(`Texpro · Estadísticas de Ventas · ${periodo}`, 9, 205);
        doc.text(`Página ${pagina} de ${paginas}`, 288, 205, { align: 'right' });
      }
      doc.save(`estadisticas-ventas-${data.anio}-${String(data.mes).padStart(2, '0')}.pdf`);
      setText('mensajeEstadisticas', `PDF generado correctamente (${paginas} página${paginas === 1 ? '' : 's'}).`);
    } catch (error) {
      setText('mensajeEstadisticas', `No se pudo generar el PDF. ${error.message}`);
      console.error('[gerencia-estadisticas-pdf]', error);
    } finally {
      button.disabled = !datosActuales;
    }
  }

  function openVendorCodes(groupIndex, sellerIndex, trigger) {
    const group = datosActuales?.grupos?.[groupIndex];
    const seller = group?.vendedores?.[sellerIndex];
    const modal = document.getElementById('vendorCodesModal');
    const body = document.getElementById('vendorCodesBody');
    if (!group || !seller || !modal || !body) return;
    const codes = Array.isArray(seller.codigos) ? seller.codigos : [];

    setText('vendorCodesTitle', seller.vendedor || seller.codigoPrincipal || 'Detalle del vendedor');
    setText('vendorCodesSubtitle', `${group.grupo || 'Sin unidad'} · Principal ${seller.codigoPrincipal || '-'}`);
    setText('vendorCodesTotal', formatCLP(seller.neto ?? 0));
    body.innerHTML = codes.length ? codes.map(code => `
      <tr>
        <td><code>${escHtml(code.codigo || '-')}</code></td>
        <td>${escHtml(code.descripcion || '-')}</td>
        <td class="numero">${formatCLP(code.neto ?? 0)}</td>
        <td class="numero">${formatPct(code.participacion ?? 0)}</td>
      </tr>
    `).join('') : '<tr><td colspan="4" class="gerencia-empty">No hay códigos asociados para mostrar.</td></tr>';

    ultimoFoco = trigger || document.activeElement;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ventas-modal-open');
    document.getElementById('btnCloseVendorCodes')?.focus();
  }

  async function loadData() {
    const currentLoad = ++cargaSecuencia;
    const year = Number(document.getElementById('yearFilter')?.value || new Date().getFullYear());
    const month = Number(document.getElementById('monthFilter')?.value || (new Date().getMonth() + 1));
    setLoadingState(true, 'Cargando estadísticas de ventas...');
    resetView();
    setText('mensajeEstadisticas', 'Actualizando información...');

    try {
      const data = await apiGet(`/estadisticas-ventas?anio=${encodeURIComponent(year)}&mes=${encodeURIComponent(month)}`);
      if (currentLoad !== cargaSecuencia) return;
      datosActuales = data;
      renderSummary(data);
      renderUnitsSummary(data);
      renderUnitsDetail(data);
      setText('mensajeEstadisticas', '');
    } catch (error) {
      if (currentLoad === cargaSecuencia) {
        setText('mensajeEstadisticas', `No se pudieron cargar las estadísticas. ${error.message}`);
      }
      throw error;
    } finally {
      if (currentLoad === cargaSecuencia) setLoadingState(false);
    }
  }

  function bindEvents() {
    document.getElementById('btnActualizar')?.addEventListener('click', () => {
      loadData().catch(error => console.error('[gerencia-estadisticas-ventas]', error));
    });
    document.getElementById('btnExportarPdf')?.addEventListener('click', exportarPdf);
    document.getElementById('unitsDetail')?.addEventListener('click', event => {
      const trigger = event.target.closest('.vendedor-detalle');
      if (!trigger) return;
      openVendorCodes(Number(trigger.dataset.groupIndex), Number(trigger.dataset.sellerIndex), trigger);
    });
    document.getElementById('btnCloseVendorCodes')?.addEventListener('click', closeVendorCodes);
    document.querySelector('[data-modal-close]')?.addEventListener('click', closeVendorCodes);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeVendorCodes();
    });
  }

  async function init() {
    if (!token()) {
      window.location.href = '/src/modulo/varios/login/index.html';
      return;
    }
    renderMonths();
    renderYears();
    bindEvents();
    try {
      await loadData();
    } catch (error) {
      console.error('[gerencia-estadisticas-ventas]', error);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
