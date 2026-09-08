'use strict';

(function (global) {
  const MODAL_ID = 'guiasPendientesModal';

  function mountModal() {
    if (document.getElementById(MODAL_ID)) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal-overlay" id="${MODAL_ID}" aria-hidden="true">
        <section class="modal cotizaciones-modal guias-pendientes-modal" role="dialog" aria-modal="true" aria-labelledby="guiasPendientesModalTitulo">
          <header class="modal-header"><div class="modal-titulo-grupo"><h2 class="modal-titulo" id="guiasPendientesModalTitulo">Detalle de Gu&iacute;as Pendientes de Facturar</h2><span class="modal-subtitulo" id="guiasPendientesModalSubtitulo"></span></div><button class="modal-cerrar" id="guiasPendientesModalCerrar" type="button" aria-label="Cerrar detalle">&times;</button></header>
          <div class="modal-body"><div class="cotizaciones-estado" id="guiasPendientesModalEstado" role="status" aria-live="polite"></div><div class="cotizaciones-tabla-wrapper guias-pendientes-tabla-wrapper"><table class="modal-tabla guias-pendientes-tabla"><colgroup><col class="guias-pendientes-col--folio" /><col class="guias-pendientes-col--fecha" /><col class="guias-pendientes-col--cliente" /><col class="guias-pendientes-col--monto" /></colgroup><thead><tr><th>N&deg; Gu&iacute;a</th><th class="guias-pendientes-fecha">Fecha</th><th>Cliente</th><th class="numero">Monto</th></tr></thead><tbody id="guiasPendientesModalBody"></tbody><tfoot id="guiasPendientesModalFoot"></tfoot></table></div></div>
          <footer class="modal-footer cotizaciones-modal-footer"><span class="modal-total-label"><strong id="guiasPendientesModalCantidad">0 gu&iacute;as pendientes</strong></span><span class="modal-total-label">Monto total pendiente:</span><strong class="modal-total-valor" id="guiasPendientesModalMonto">$0</strong></footer>
        </section>
      </div>
    `);
  }

  function create(options) {
    const cardId = options.cardId || 'kpiGuiasPendientesCard';
    const valueId = options.valueId || 'kpiGuiasPendientes';
    const foliosId = options.foliosId || 'kpiGuiasPendientesFolios';
    const formatCLP = options.formatCLP;
    const formatCount = options.formatCount;
    const escapeHtml = options.escapeHtml;
    let requestSequence = 0;
    let loading = false;

    const element = id => document.getElementById(id);

    function close() {
      const modal = element(MODAL_ID);
      if (!modal) return;
      requestSequence += 1;
      loading = false;
      modal.classList.remove('modal-overlay--visible');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      const card = element(cardId);
      if (card) card.disabled = false;
    }

    function renderSummary(summary) {
      const total = Number(summary?.total) || 0;
      const folios = Number(summary?.folios) || 0;
      const value = element(valueId);
      const subtitle = element(foliosId);
      const card = element(cardId);
      if (value) value.textContent = formatCLP(total);
      if (subtitle) subtitle.textContent = `${formatCount(folios)} ${folios === 1 ? 'folio pendiente' : 'folios pendientes'}`;
      if (card) card.setAttribute('aria-label', `Abrir detalle de Gu\u00edas Pendientes de Facturar: ${formatCount(folios)} ${folios === 1 ? 'folio' : 'folios'}`);
    }

    function resetSummary() {
      close();
      renderSummary({ total: 0, folios: 0 });
    }

    function row(item) {
      return `<tr><td><code>${escapeHtml(item.numero) || '\u2014'}</code></td><td class="guias-pendientes-fecha">${escapeHtml(item.fecha) || '\u2014'}</td><td>${escapeHtml(item.cliente || item.codigoCliente) || '\u2014'}</td><td class="numero">${formatCLP(item.monto)}</td></tr>`;
    }

    async function open() {
      if (loading) return;
      const request = options.getRequest();
      if (!request) return;

      const modal = element(MODAL_ID);
      const card = element(cardId);
      const requestId = ++requestSequence;
      loading = true;
      if (card) card.disabled = true;
      element('guiasPendientesModalSubtitulo').textContent = request.subtitle || '';
      element('guiasPendientesModalEstado').textContent = 'Cargando gu\u00edas pendientes...';
      element('guiasPendientesModalBody').innerHTML = '';
      element('guiasPendientesModalFoot').innerHTML = '';
      element('guiasPendientesModalCantidad').textContent = '0 gu\u00edas pendientes';
      element('guiasPendientesModalMonto').textContent = formatCLP(0);
      modal.classList.add('modal-overlay--visible');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';

      try {
        const params = new URLSearchParams(request.params || {});
        const data = await options.apiGet(`${options.endpoint}?${params}`);
        if (requestId !== requestSequence) return;
        const items = Array.isArray(data.items) ? data.items : [];
        const cantidad = Number(data.cantidad) || 0;
        const monto = Number(data.monto) || 0;
        element('guiasPendientesModalEstado').textContent = items.length ? '' : 'No existen gu\u00edas pendientes de facturar para el per\u00edodo seleccionado.';
        element('guiasPendientesModalBody').innerHTML = items.map(row).join('');
        element('guiasPendientesModalFoot').innerHTML = items.length ? `<tr><th colspan="3">TOTAL \u00b7 ${formatCount(cantidad)} ${cantidad === 1 ? 'gu\u00eda pendiente' : 'gu\u00edas pendientes'}</th><th class="numero">${formatCLP(monto)}</th></tr>` : '';
        element('guiasPendientesModalCantidad').textContent = `${formatCount(cantidad)} ${cantidad === 1 ? 'gu\u00eda pendiente' : 'gu\u00edas pendientes'}`;
        element('guiasPendientesModalMonto').textContent = formatCLP(monto);
      } catch (error) {
        if (requestId === requestSequence) element('guiasPendientesModalEstado').textContent = error.message || 'No fue posible cargar las gu\u00edas pendientes.';
      } finally {
        if (requestId === requestSequence) {
          loading = false;
          if (card) card.disabled = false;
          element('guiasPendientesModalCerrar')?.focus();
        }
      }
    }

    function bind() {
      mountModal();
      element(cardId)?.addEventListener('click', open);
      element('guiasPendientesModalCerrar')?.addEventListener('click', close);
      element(MODAL_ID)?.addEventListener('click', event => {
        if (event.target === element(MODAL_ID)) close();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && element(MODAL_ID)?.classList.contains('modal-overlay--visible')) close();
      });
    }

    return { bind, close, open, renderSummary, resetSummary };
  }

  global.GerenciaGuiasPendientes = { create };
})(window);
