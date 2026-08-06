'use strict';

/**
 * indicadores-header.js — RSProyecto Texpro
 *
 * - Carga USD y UF desde /api/indicadores y los muestra en #headerIndicadores.
 * - Fusiona ventas asignadas con ventas del mes solo en el Dashboard principal.
 * - Activa auto-refresh global de filtros mes/año reutilizando #btnActualizar,
 *   por lo que cada pantalla mantiene su overlay "Cargando datos..." actual.
 * - Agrega el acceso al módulo Gerencia en el sidebar para usuarios administradores.

 * - Carga la sidebar central por módulos desplegables cuando existe #sidebarNav.
 */

(function () {

  const REFRESH_MS = 5 * 60 * 1000;
  const originalFetch = window.fetch.bind(window);
  const FEATURE_FLAGS = {
    alertas: false,
    mensajeria: false,
  };
  const ALERTAS_OVERLAY_ID = 'texproAlertasPendientesOverlay';
  const ALERTAS_STYLE_ID   = 'texproAlertasPendientesStyles';
  const ALERTAS_SESSION_PREFIX = 'alertasPendientesMostradas:';
  const ALERTAS_BELL_ID = 'texproAlertasCampanaBtn';
  const ALERTAS_BELL_BADGE_ID = 'texproAlertasCampanaBadge';
  const ALERTAS_BELL_PANEL_ID = 'texproAlertasCampanaPanel';
  const ALERTAS_BELL_LIST_ID = 'texproAlertasCampanaList';
  const MENSAJERIA_BELL_ID = 'texproMensajeriaBtn';
  const MENSAJERIA_BELL_BADGE_ID = 'texproMensajeriaBadge';

  function ensureRealtimeClientLoaded() {
    if (document.getElementById('gicotexRealtimeClientScript')) return;
    const script = document.createElement('script');
    script.id = 'gicotexRealtimeClientScript';
    script.src = '/src/assets/js/realtime-client.js?v=1.0.0';
    script.defer = true;
    document.head.appendChild(script);
  }

  function debeFusionarVentasAsignadas() {
    return window.location.pathname.includes('/src/modulo/ventas/dashboard/');
  }

  function fmt(valor, decimales) {
    if (valor == null || Number.isNaN(Number(valor))) return '—';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(Number(valor));
  }

  function getToken() {
    return localStorage.getItem('token') || '';
  }

  function getUsuarioSesion() {
    const raw = sessionStorage.getItem('texpro_user') || localStorage.getItem('user') || localStorage.getItem('usuario');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function usuarioTieneAccesoMenu(codigo) {
    const usuario = getUsuarioSesion();
    const objetivo = String(codigo || '').trim().toLowerCase();
    if (!usuario || !objetivo) return false;
    return Array.isArray(usuario.menus) && usuario.menus.some(menu => String(menu?.codigo || '').trim().toLowerCase() === objetivo);
  }

  function getAlertasSessionKey() {
    const usuario = getUsuarioSesion();
    const id = usuario?.id ?? usuario?.sub ?? usuario?.usuario_id ?? null;
    return `${ALERTAS_SESSION_PREFIX}${id || 'anon'}`;
  }

  function limpiarAlertasSesion() {
    try {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith(ALERTAS_SESSION_PREFIX)) keys.push(key);
      }
      keys.forEach(key => sessionStorage.removeItem(key));
    } catch {
      // noop
    }
  }

  function formatFechaCL(fecha) {
    if (!fecha) return '—';
    const s = String(fecha).substring(0, 10);
    const parts = s.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return s;
  }

  function buildAssignedRows(compartidos) {
    return (compartidos || []).map(row => ({
      Folio: row.folio,
      fecha_formato: formatFechaCL(row.fecha),
      cliente: row.cliente || '',
      CodVendedor: row.cod_vendedor_principal || row.cod_vendedor_compartido || '',
      Tipo: 'F',
      monto: Number(row.monto_asignado || row.monto || 0),
      venta_real_folio: Number(row.monto_neto || row.monto_asignado || 0),
      TotLineaReal: Number(row.monto_asignado || row.monto || 0),
      pct_descuento: 0,
      es_compartido: true,
      es_asignado: true,
      monto_asignado: Number(row.monto_asignado || row.monto || 0),
      porcentaje_asignado: Number(row.porcentaje || 0),
      cod_vendedor_principal: row.cod_vendedor_principal,
      cod_vendedor_compartido: row.cod_vendedor_compartido,
      nombre_vendedor_compartido: row.nombre_vendedor_compartido,
    }));
  }

  function formatFechaCorta(fecha) {
    if (!fecha) return '—';
    const s = String(fecha).substring(0, 10);
    const parts = s.split('-');
    if (parts.length !== 3) return s;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function escapeHtml(valor) {
    if (valor == null) return '';
    return String(valor)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  function crearEstilosAlertasPendientes() {
    if (document.getElementById(ALERTAS_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = ALERTAS_STYLE_ID;
    style.textContent = `
      .texpro-alertas-pendientes-overlay {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background: rgba(7, 18, 25, .55);
        backdrop-filter: blur(4px);
        opacity: 0;
        pointer-events: none;
        transition: opacity .2s ease;
      }
      .texpro-alertas-pendientes-overlay--visible {
        opacity: 1;
        pointer-events: auto;
      }
      .texpro-alertas-pendientes-panel {
        width: min(860px, 100%);
        max-height: min(80vh, 760px);
        overflow: hidden;
        background: var(--color-surface, #fff);
        border-radius: 20px;
        box-shadow: 0 28px 70px rgba(0, 0, 0, .28);
        display: flex;
        flex-direction: column;
      }
      .texpro-alertas-pendientes-header,
      .texpro-alertas-pendientes-footer {
        padding: 1rem 1.25rem;
        background: linear-gradient(180deg, rgba(0, 226, 167, .08), rgba(0, 226, 167, 0));
      }
      .texpro-alertas-pendientes-header {
        display: flex;
        gap: .9rem;
        align-items: flex-start;
        border-bottom: 1px solid rgba(0, 0, 0, .06);
      }
      .texpro-alertas-pendientes-icon {
        width: 44px;
        height: 44px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 226, 167, .16);
        color: var(--color-primary, #01696f);
        flex: 0 0 auto;
        font-size: 1.2rem;
      }
      .texpro-alertas-pendientes-title {
        margin: 0;
        font-family: var(--font-display, 'Montserrat', sans-serif);
        font-size: 1.05rem;
        font-weight: 700;
        color: var(--color-text, #10212b);
      }
      .texpro-alertas-pendientes-sub {
        margin: .2rem 0 0;
        font-size: .85rem;
        color: var(--color-text-muted, #5d6675);
      }
      .texpro-alertas-pendientes-close {
        margin-left: auto;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 10px;
        background: rgba(0, 0, 0, .04);
        color: inherit;
        cursor: pointer;
      }
      .texpro-alertas-pendientes-list {
        padding: 1rem 1.25rem 1.25rem;
        overflow: auto;
        display: grid;
        gap: .8rem;
      }
      .texpro-alerta-item {
        border: 1px solid rgba(0, 0, 0, .08);
        border-radius: 16px;
        padding: .95rem 1rem;
        background: #fff;
        display: grid;
        gap: .55rem;
      }
      .texpro-alerta-top {
        display: flex;
        align-items: flex-start;
        gap: .65rem;
        justify-content: space-between;
      }
      .texpro-alerta-title {
        margin: 0;
        font-weight: 700;
        font-size: .98rem;
        color: var(--color-text, #10212b);
      }
      .texpro-alerta-meta {
        display: flex;
        flex-wrap: wrap;
        gap: .45rem .75rem;
        font-size: .78rem;
        color: var(--color-text-muted, #5d6675);
      }
      .texpro-alerta-badge {
        display: inline-flex;
        align-items: center;
        gap: .3rem;
        padding: .22rem .55rem;
        border-radius: 999px;
        background: rgba(1, 105, 111, .08);
        color: var(--color-primary, #01696f);
        font-size: .74rem;
        font-weight: 600;
      }
      .texpro-alerta-actions {
        display: flex;
        flex-wrap: wrap;
        gap: .55rem;
        justify-content: flex-end;
      }
      .texpro-alerta-btn {
        border: 0;
        border-radius: 10px;
        padding: .6rem .85rem;
        font-size: .85rem;
        font-weight: 600;
        cursor: pointer;
      }
      .texpro-alerta-btn--ghost {
        background: rgba(0, 0, 0, .05);
        color: var(--color-text, #10212b);
      }
      .texpro-alerta-btn--primary {
        background: var(--color-primary, #01696f);
        color: #fff;
      }
      .texpro-alerta-btn--danger {
        background: #ef4444;
        color: #fff;
      }
      .texpro-alerta-empty {
        padding: 1rem 1.25rem 1.25rem;
        color: var(--color-text-muted, #5d6675);
        font-size: .92rem;
      }
      .texpro-alertas-campana-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }
      .texpro-alertas-campana-btn {
        position: relative;
        width: 40px;
        height: 40px;
        border: 0;
        border-radius: 12px;
        background: rgba(1, 105, 111, .09);
        color: var(--color-primary, #01696f);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .texpro-alertas-campana-btn:hover {
        background: rgba(1, 105, 111, .14);
      }
      .texpro-alertas-campana-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        min-width: 18px;
        height: 18px;
        padding: 0 .25rem;
        border-radius: 999px;
        background: #ef4444;
        color: #fff;
        font-size: .7rem;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 6px 14px rgba(239, 68, 68, .35);
      }
      .texpro-alertas-campana-panel {
        position: absolute;
        top: calc(100% + .6rem);
        right: 0;
        width: min(420px, calc(100vw - 1.5rem));
        max-height: min(70vh, 620px);
        overflow: hidden;
        border: 1px solid rgba(0, 0, 0, .08);
        border-radius: 18px;
        background: #fff;
        box-shadow: 0 22px 50px rgba(0, 0, 0, .2);
        z-index: 1800;
        display: none;
      }
      .texpro-alertas-campana-panel--open {
        display: flex;
        flex-direction: column;
      }
      .texpro-alertas-campana-head {
        padding: .95rem 1rem;
        display: flex;
        align-items: flex-start;
        gap: .8rem;
        border-bottom: 1px solid rgba(0, 0, 0, .06);
        background: linear-gradient(180deg, rgba(0, 226, 167, .08), rgba(0, 226, 167, 0));
      }
      .texpro-alertas-campana-head h3 {
        margin: 0;
        font-size: .98rem;
        font-weight: 700;
        color: var(--color-text, #10212b);
      }
      .texpro-alertas-campana-head p {
        margin: .15rem 0 0;
        font-size: .8rem;
        color: var(--color-text-muted, #5d6675);
      }
      .texpro-alertas-campana-close {
        margin-left: auto;
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 10px;
        background: rgba(0, 0, 0, .05);
        cursor: pointer;
      }
      .texpro-alertas-campana-list {
        padding: .9rem 1rem 1rem;
        overflow: auto;
        display: grid;
        gap: .75rem;
      }
      .texpro-alertas-campana-list .texpro-alerta-item {
        padding: .8rem .85rem;
      }
      .texpro-alertas-campana-list .texpro-alerta-actions {
        justify-content: flex-start;
      }
      .texpro-alertas-campana-footer {
        padding: .85rem 1rem 1rem;
        border-top: 1px solid rgba(0, 0, 0, .06);
      }
      @media (max-width: 640px) {
        .texpro-alertas-pendientes-panel { max-height: 90vh; }
        .texpro-alerta-top { flex-direction: column; }
        .texpro-alerta-actions { justify-content: flex-start; }
        .texpro-alertas-campana-panel {
          right: auto;
          left: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function cerrarAlertasPendientesGlobal() {
    const overlay = document.getElementById(ALERTAS_OVERLAY_ID);
    if (!overlay) return;
    overlay.classList.remove('texpro-alertas-pendientes-overlay--visible');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function cerrarCampanaAlertasGlobal() {
    const panel = document.getElementById(ALERTAS_BELL_PANEL_ID);
    const btn = document.getElementById(ALERTAS_BELL_ID);
    if (!panel) return;
    panel.classList.remove('texpro-alertas-campana-panel--open');
    panel.setAttribute('aria-hidden', 'true');
    panel.dataset.cargado = '0';
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  async function descartarAlertaPendienteGlobal(id) {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await originalFetch(`/api/alertas/${id}/descartar`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      return !!res.ok && !!data?.ok;
    } catch (err) {
      console.warn('[alertas-global] no se pudo descartar:', err.message);
      return false;
    }
  }

  async function archivarAlertaPendienteGlobal(id) {
    const token = getToken();
    if (!token) return false;
    try {
      const res = await originalFetch(`/api/alertas/${id}/archivar`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      return !!res.ok && !!data?.ok;
    } catch (err) {
      console.warn('[alertas-global] no se pudo archivar:', err.message);
      return false;
    }
  }

  function renderAlertaItemGlobal(a) {
    const dias = Number(a.dias_restantes);
    const diasTxt = Number.isFinite(dias)
      ? (dias === 0 ? 'Vence hoy' : dias === 1 ? 'Vence mañana' : `${dias} días restantes`)
      : 'Sin fecha';
    const fecha = formatFechaCorta(a.fecha_vence);
    return `
      <article class="texpro-alerta-item" data-alerta-id="${a.id}">
        <div class="texpro-alerta-top">
          <div>
            <h4 class="texpro-alerta-title">${escapeHtml(a.titulo || 'Sin título')}</h4>
            ${a.descripcion ? `<p class="texpro-alertas-desc">${escapeHtml(a.descripcion)}</p>` : ''}
          </div>
          <span class="texpro-alerta-badge">${escapeHtml(diasTxt)}</span>
        </div>
        <div class="texpro-alerta-meta">
          <span>Fecha: <strong>${escapeHtml(fecha)}</strong></span>
          <span>Tipo: <strong>${escapeHtml(a.tipo || '—')}</strong></span>
          <span>Estado: <strong>${a.completada ? 'Completada' : 'Activa'}</strong></span>
          ${a.nombre_creador ? `<span>Creador: <strong>${escapeHtml(a.nombre_creador)}</strong></span>` : ''}
          ${a.frecuencia_recordatorio ? `<span>Frecuencia: <strong>${escapeHtml(a.frecuencia_recordatorio)}</strong></span>` : ''}
        </div>
        <div class="texpro-alerta-actions">
          <button type="button" class="texpro-alerta-btn texpro-alerta-btn--primary" data-accion="archivar" data-id="${a.id}">Archivar</button>
          <button type="button" class="texpro-alerta-btn texpro-alerta-btn--danger" data-accion="descartar" data-id="${a.id}">Descartar por hoy</button>
        </div>
      </article>
    `;
  }

  function renderAlertasPendientesModal(alertas) {
    if (!FEATURE_FLAGS.alertas) return;
    if (!alertas || !alertas.length) return;
    crearEstilosAlertasPendientes();

    let overlay = document.getElementById(ALERTAS_OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = ALERTAS_OVERLAY_ID;
      overlay.className = 'texpro-alertas-pendientes-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.innerHTML = `
        <div class="texpro-alertas-pendientes-panel" role="dialog" aria-modal="true" aria-labelledby="texproAlertasPendientesTitle">
          <div class="texpro-alertas-pendientes-header">
            <div class="texpro-alertas-pendientes-icon">🔔</div>
            <div>
              <h3 class="texpro-alertas-pendientes-title" id="texproAlertasPendientesTitle">Recordatorios pendientes</h3>
              <p class="texpro-alertas-pendientes-sub">Tienes alertas activas que requieren tu atención</p>
            </div>
            <button type="button" class="texpro-alertas-pendientes-close" data-accion="cerrar" aria-label="Cerrar">×</button>
          </div>
          <div class="texpro-alertas-pendientes-list" data-alertas-lista></div>
          <div class="texpro-alertas-pendientes-footer">
            <div class="texpro-alerta-actions">
              <button type="button" class="texpro-alerta-btn texpro-alerta-btn--ghost" data-accion="ir-alertas">Ir a Alertas</button>
              <button type="button" class="texpro-alerta-btn texpro-alerta-btn--ghost" data-accion="cerrar">Cerrar</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.addEventListener('click', event => {
        if (event.target === overlay) cerrarAlertasPendientesGlobal();
      });
      overlay.querySelectorAll('[data-accion="cerrar"]').forEach(btn => {
        btn.addEventListener('click', cerrarAlertasPendientesGlobal);
      });
      overlay.querySelector('[data-accion="ir-alertas"]')?.addEventListener('click', () => {
        window.location.href = '/src/modulo/varios/alertas/index.html';
      });
    }

    const lista = overlay.querySelector('[data-alertas-lista]');
    if (!lista) return;

    lista.innerHTML = alertas.map(a => renderAlertaItemGlobal(a)).join('');

    lista.querySelectorAll('[data-accion="archivar"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        btn.disabled = true;
        const ok = await archivarAlertaPendienteGlobal(id);
        btn.disabled = false;
        if (!ok) return;
        const card = btn.closest('[data-alerta-id]');
        if (card) card.remove();
        await cargarBadgeAlertasGlobal();
        if (!lista.children.length) cerrarAlertasPendientesGlobal();
      });
    });

    lista.querySelectorAll('[data-accion="descartar"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        btn.disabled = true;
        const ok = await descartarAlertaPendienteGlobal(id);
        btn.disabled = false;
        if (!ok) return;
        const card = btn.closest('[data-alerta-id]');
        if (card) card.remove();
        await cargarBadgeAlertasGlobal();
        if (!lista.children.length) cerrarAlertasPendientesGlobal();
      });
    });

    overlay.classList.add('texpro-alertas-pendientes-overlay--visible');
    overlay.setAttribute('aria-hidden', 'false');
  }

  async function fetchAlertasPendientesGlobal() {
    if (!FEATURE_FLAGS.alertas) return null;
    const token = getToken();
    if (!token) return null;
    try {
      const res = await originalFetch('/api/alertas/pendientes', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !Array.isArray(data.data)) return null;
      return data.data;
    } catch (err) {
      console.warn('[alertas-global]', err.message);
      return null;
    }
  }

  async function cargarBadgeAlertasGlobal() {
    if (!FEATURE_FLAGS.alertas) return 0;
    const token = getToken();
    if (!token) return 0;
    try {
      const res = await originalFetch('/api/alertas/badge', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      const total = Number(data?.total || 0);
      const badge = document.getElementById(ALERTAS_BELL_BADGE_ID);
      if (!badge) return total;
      if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
      return total;
    } catch (err) {
      console.warn('[alertas-global] badge', err.message);
      return 0;
    }
  }

  function renderResumenCampanaGlobal(alertas) {
    if (!FEATURE_FLAGS.alertas) return;
    crearEstilosAlertasPendientes();
    const panel = document.getElementById(ALERTAS_BELL_PANEL_ID);
    if (!panel) return;
    const lista = panel.querySelector('[data-alertas-campana-lista]');
    if (!lista) return;

    if (alertas === null) {
      lista.innerHTML = `
        <div class="texpro-alerta-empty">
          <div class="texpro-alertas-pendientes-icon" style="margin-bottom:.65rem">⚠️</div>
          <strong>No se pudieron cargar las alertas</strong>
          <div style="margin-top:.25rem">Intenta nuevamente en unos segundos.</div>
        </div>
      `;
      return;
    }

    if (!alertas || !alertas.length) {
      lista.innerHTML = `
        <div class="texpro-alerta-empty">
          <div class="texpro-alertas-pendientes-icon" style="margin-bottom:.65rem">🔔</div>
          <strong>Sin alertas pendientes</strong>
          <div style="margin-top:.25rem">No tienes alertas activas en este momento.</div>
        </div>
      `;
      return;
    }

    lista.innerHTML = alertas.map(a => renderAlertaItemGlobal(a)).join('');
    lista.querySelectorAll('[data-accion="archivar"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        btn.disabled = true;
        const ok = await archivarAlertaPendienteGlobal(id);
        btn.disabled = false;
        if (!ok) return;
        await cargarBadgeAlertasGlobal();
        const alertasActuales = await fetchAlertasPendientesGlobal();
        renderResumenCampanaGlobal(alertasActuales);
      });
    });
    lista.querySelectorAll('[data-accion="descartar"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        btn.disabled = true;
        const ok = await descartarAlertaPendienteGlobal(id);
        btn.disabled = false;
        if (!ok) return;
        await cargarBadgeAlertasGlobal();
        const alertasActuales = await fetchAlertasPendientesGlobal();
        renderResumenCampanaGlobal(alertasActuales);
      });
    });
  }

  async function cargarResumenCampanaGlobal() {
    if (!FEATURE_FLAGS.alertas) return 0;
    const panel = document.getElementById(ALERTAS_BELL_PANEL_ID);
    const btn = document.getElementById(ALERTAS_BELL_ID);
    if (!panel || !btn) return;

    panel.classList.add('texpro-alertas-campana-panel--open');
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    panel.dataset.cargado = '1';

    const lista = panel.querySelector('[data-alertas-campana-lista]');
    if (lista) {
      lista.innerHTML = `
        <div class="texpro-alerta-empty">
          <div class="texpro-alertas-pendientes-icon" style="margin-bottom:.65rem">⏳</div>
          <strong>Cargando alertas...</strong>
        </div>
      `;
    }

    const alertas = await fetchAlertasPendientesGlobal();
    renderResumenCampanaGlobal(alertas);
  }

  async function cargarResumenMensajeriaGlobal() {
    if (!FEATURE_FLAGS.mensajeria) return 0;
    const badge = document.getElementById(MENSAJERIA_BELL_BADGE_ID);
    if (!badge) return 0;

    try {
      const res = await originalFetch('/api/mensajeria/no-leidos', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json().catch(() => null);
      const total = Number(data?.data?.total || 0);
      if (total > 0) {
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.style.display = 'inline-flex';
      } else {
        badge.textContent = '0';
        badge.style.display = 'none';
      }
      return total;
    } catch {
      badge.textContent = '0';
      badge.style.display = 'none';
      return 0;
    }
  }

  function crearCampanaAlertasGlobal() {
    if (!FEATURE_FLAGS.alertas) return;
    if (!usuarioTieneAccesoMenu('alertas')) return;
    if (document.getElementById(ALERTAS_BELL_ID)) return;
    const headerRight = document.querySelector('.main-header .header-right');
    if (!headerRight) return;

    crearEstilosAlertasPendientes();

    const wrap = document.createElement('div');
    wrap.className = 'texpro-alertas-campana-wrap';
    wrap.innerHTML = `
      <button type="button" class="texpro-alertas-campana-btn" id="${ALERTAS_BELL_ID}" aria-label="Alertas" aria-expanded="false" aria-haspopup="true">
        <span aria-hidden="true">🔔</span>
        <span class="texpro-alertas-campana-badge" id="${ALERTAS_BELL_BADGE_ID}" style="display:none">0</span>
      </button>
      <div class="texpro-alertas-campana-panel" id="${ALERTAS_BELL_PANEL_ID}" aria-hidden="true">
        <div class="texpro-alertas-campana-head">
          <div>
            <h3>Alertas activas</h3>
            <p>Resumen general de tus alertas pendientes</p>
          </div>
          <button type="button" class="texpro-alertas-campana-close" data-accion="cerrar-campana" aria-label="Cerrar">×</button>
        </div>
        <div class="texpro-alertas-campana-list" id="${ALERTAS_BELL_LIST_ID}" data-alertas-campana-lista></div>
        <div class="texpro-alertas-campana-footer">
          <div class="texpro-alerta-actions" style="justify-content: space-between;">
            <button type="button" class="texpro-alerta-btn texpro-alerta-btn--ghost" data-accion="ir-alertas-global">Ver todas</button>
            <button type="button" class="texpro-alerta-btn texpro-alerta-btn--ghost" data-accion="cerrar-campana">Cerrar</button>
          </div>
        </div>
      </div>
    `;

    const notifWrapper = headerRight.querySelector('.notif-wrapper');
    headerRight.insertBefore(wrap, notifWrapper || headerRight.firstChild);

    const btn = wrap.querySelector(`#${ALERTAS_BELL_ID}`);
    const panel = wrap.querySelector(`#${ALERTAS_BELL_PANEL_ID}`);

    btn?.addEventListener('click', async event => {
      event.stopPropagation();
      if (panel?.classList.contains('texpro-alertas-campana-panel--open')) {
        cerrarCampanaAlertasGlobal();
        return;
      }
      await cargarResumenCampanaGlobal();
    });

    wrap.querySelectorAll('[data-accion="cerrar-campana"]').forEach(el => {
      el.addEventListener('click', event => {
        event.stopPropagation();
        cerrarCampanaAlertasGlobal();
      });
    });

    wrap.querySelector('[data-accion="ir-alertas-global"]')?.addEventListener('click', () => {
      window.location.href = '/src/modulo/varios/alertas/index.html';
    });

    document.addEventListener('click', event => {
      if (!wrap.contains(event.target)) cerrarCampanaAlertasGlobal();
    }, true);
  }

  function crearAccesoMensajeriaGlobal() {
    if (!FEATURE_FLAGS.mensajeria) return;
    if (!usuarioTieneAccesoMenu('mensajeria')) return;
    if (document.getElementById(MENSAJERIA_BELL_ID)) return;
    const headerRight = document.querySelector('.main-header .header-right');
    if (!headerRight) return;

    const wrap = document.createElement('div');
    wrap.className = 'texpro-alertas-campana-wrap';
    wrap.innerHTML = `
      <button type="button" class="texpro-alertas-campana-btn" id="${MENSAJERIA_BELL_ID}" aria-label="Mensajería" aria-haspopup="false" title="Mensajería interna">
        <span aria-hidden="true">💬</span>
        <span class="texpro-alertas-campana-badge" id="${MENSAJERIA_BELL_BADGE_ID}" style="display:none">0</span>
      </button>
    `;

    const notifWrapper = headerRight.querySelector('.notif-wrapper');
    headerRight.insertBefore(wrap, notifWrapper || headerRight.firstChild);

    const btn = wrap.querySelector(`#${MENSAJERIA_BELL_ID}`);
    btn?.addEventListener('click', () => {
      window.location.href = '/src/modulo/varios/mensajeria/index.html';
    });

    cargarResumenMensajeriaGlobal();
    setInterval(cargarResumenMensajeriaGlobal, 60 * 1000);
  }

  async function verificarAlertasPendientesAlIngreso() {
    if (!FEATURE_FLAGS.alertas) return;
    const key = getAlertasSessionKey();
    if (sessionStorage.getItem(key) === '1') return;
    const alertas = await fetchAlertasPendientesGlobal();
    sessionStorage.setItem(key, '1');
    if (Array.isArray(alertas) && alertas.length) {
      renderAlertasPendientesModal(alertas);
    }
  }

  window.cargarAlertasPendientesGlobal = verificarAlertasPendientesAlIngreso;
  window.cargarResumenCampanaGlobal = cargarResumenCampanaGlobal;
  window.cerrarAlertasPendientesGlobal = cerrarAlertasPendientesGlobal;
  window.cargarBadgeAlertasGlobal = cargarBadgeAlertasGlobal;

  function dedupeVentas(ventas) {
    const map = new Map();
    for (const venta of ventas || []) {
      const key = `${venta.Folio || venta.folio}|${venta.es_asignado ? 'asignado' : 'propio'}|${venta.cod_vendedor_compartido || ''}`;
      map.set(key, venta);
    }
    return Array.from(map.values());
  }

  async function fetchMergedVentasMes(input, init) {
    const res = await originalFetch(input, init);
    const clone = res.clone();

    try {
      if (!res.ok) return res;

      const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
      if (url.pathname !== '/api/dashboard/ventas-mes') return res;

      const data = await clone.json();
      if (!data.ok) return res;

      const qs = url.search || '';
      const resComp = await originalFetch(`/api/dashboard/compartidos${qs}`, init);
      if (!resComp.ok) return res;

      const compData = await resComp.json();
      if (!compData.ok) return res;

      const propias = data.ventas || [];
      const asignadas = buildAssignedRows(compData.compartidos || []);
      const merged = {
        ...data,
        ventas: dedupeVentas([...propias, ...asignadas]),
      };

      return new Response(JSON.stringify(merged), {
        status: res.status,
        statusText: res.statusText,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.warn('[ventas-mes asignadas] no se pudo fusionar:', err.message);
      return res;
    }
  }

  window.fetch = function patchedFetch(input, init) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
      if (debeFusionarVentasAsignadas() && url.pathname === '/api/dashboard/ventas-mes') {
        return fetchMergedVentasMes(input, init);
      }
    } catch {
      // Mantener comportamiento original si no es una URL estándar.
    }
    return originalFetch(input, init);
  };

  function activarAutoRefreshFiltros() {
    const filtros = [
      document.getElementById('filtroMes'),
      document.getElementById('filtroAnio'),
    ].filter(Boolean);

    const boton = document.getElementById('btnActualizar');
    if (!filtros.length || !boton || boton.dataset.autoRefreshBound === '1') return;

    boton.dataset.autoRefreshBound = '1';
    let timer = null;

    const refrescar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!boton.disabled) boton.click();
      }, 150);
    };

    filtros.forEach(filtro => {
      filtro.addEventListener('change', refrescar);
    });
  }

  async function obtenerUsuarioActual() {
    const token = getToken();
    if (!token) return null;

    try {
      const res = await originalFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return null;
      return data.user || null;
    } catch (err) {
      console.warn('[gerencia-menu] no se pudo validar usuario:', err.message);
      return null;
    }
  }

  function esAdmin(usuario) {
    return usuario?.is_admin === true || usuario?.is_admin === 1 || usuario?.is_admin === '1';
  }

  async function activarMenuGerenciaAdmin() {
    return;
  }

function cargarSidebarModulos() {
  if (!document.getElementById('sidebarNav')) return;
  if (window.__APP_SIDEBAR_LOADED__) return;
  const script = document.createElement('script');
  script.src = '/src/assets/js/app-sidebar.js?v=1.0.0';
  script.defer = true;
  document.head.appendChild(script);
}

  async function cargarIndicadores() {
    const el = document.getElementById('headerIndicadores');
    if (!el) return;

    try {
      const res = await originalFetch('/api/indicadores', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'HTTP ' + res.status);
      if (data.disponible === false) {
        el.innerHTML = '<span class="hind-error" title="Indicadores no disponibles temporalmente">USD/UF —</span>';
        el.title = 'Indicadores no disponibles temporalmente';
        return;
      }

      const horaActualiz = new Date(data.actualizadoEn || Date.now()).toLocaleTimeString('es-CL', {
        hour: '2-digit', minute: '2-digit',
      });

      el.innerHTML = `
        <span class="hind-item" title="USD/CLP — actualizado ${horaActualiz}">
          <span class="hind-label">USD</span>
          <span class="hind-valor hind-valor--usd">$${fmt(data.dolar?.valor, 2)}</span>
        </span>
        <span class="hind-sep" aria-hidden="true">|</span>
        <span class="hind-item" title="Unidad de Fomento — actualizado ${horaActualiz}">
          <span class="hind-label">UF</span>
          <span class="hind-valor hind-valor--uf">$${fmt(data.uf?.valor, 2)}</span>
        </span>
      `;
      el.title = `Fuente: ${data.fuente || 'indicadores'}${data.stale ? ' (caché)' : ''} | Última actualización: ${horaActualiz}`;
    } catch (err) {
      console.warn('[indicadores-header]', err.message);
      el.innerHTML = '<span class="hind-error" title="No se pudo consultar /api/indicadores">USD/UF —</span>';
    }
  }

  function init() {
    cargarSidebarModulos();
    cargarIndicadores();
    activarAutoRefreshFiltros();
    crearCampanaAlertasGlobal();
    crearAccesoMensajeriaGlobal();
    cargarBadgeAlertasGlobal();
    verificarAlertasPendientesAlIngreso();
    ensureRealtimeClientLoaded();
    setInterval(cargarIndicadores, REFRESH_MS);
    setInterval(cargarBadgeAlertasGlobal, REFRESH_MS);
    document.addEventListener('click', event => {
      if (event.target.closest('#btnLogout')) limpiarAlertasSesion();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
