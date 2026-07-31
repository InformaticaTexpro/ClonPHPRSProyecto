/**
 * @jest-environment jsdom
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REVISION_SCRIPT = fs.readFileSync(
  path.join(__dirname, '../../src/modulo/rrhh/reportes-compartidos/reportes-compartidos.js'),
  'utf8'
);

const REVISION_HTML = fs.readFileSync(
  path.join(__dirname, '../../src/modulo/rrhh/reportes-compartidos/index.html'),
  'utf8'
);

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function mockResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function montarVistaRevision() {
  document.body.innerHTML = `
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header">
        <img src="../../../assets/images/Isotipo-TEXPRO_fondo_blanco.png" alt="Texpro" class="sidebar-logo" onerror="this.style.display='none'" />
        <span class="sidebar-brand">TEXPRO</span>
        <button class="sidebar-toggle" id="sidebarToggle" aria-label="Colapsar menú"></button>
      </div>
      <nav class="sidebar-nav" id="sidebarNav"></nav>
      <div class="sidebar-footer">
        <div class="sidebar-user">
          <div class="user-avatar" id="userAvatar">R</div>
          <div class="user-info">
            <span class="user-name" id="userName">RRHH</span>
            <span class="user-area" id="userArea">RRHH</span>
          </div>
        </div>
        <button class="btn-logout" id="btnLogout" type="button"></button>
      </div>
    </aside>
    <div class="main-wrapper" id="mainWrapper">
      <header class="main-header">
        <div class="header-left">
          <button class="header-menu-btn" id="headerMenuBtn" type="button"></button>
          <h1 class="header-title">Revision ventas compartidas</h1>
        </div>
        <div class="header-right">
          <span class="header-date" id="headerDate"></span>
          <span class="header-indicadores" id="headerIndicadores" aria-label="Indicadores economicos">
            <span class="hind-label">USD</span><span class="hind-valor">-</span>
            <span class="hind-sep" aria-hidden="true">|</span>
            <span class="hind-label">UF</span><span class="hind-valor">-</span>
          </span>
          <div class="notif-wrapper" id="notifWrapper">
            <button class="notif-btn" id="notifBtn" aria-label="Notificaciones" aria-expanded="false" aria-haspopup="true"></button>
            <div class="notif-panel" id="notifPanel" role="menu" aria-label="Panel de notificaciones">
              <div class="notif-panel-header">
                <span class="notif-panel-title">Notificaciones</span>
                <button class="notif-leer-todo" id="notifLeerTodo" title="Marcar todas como leidas"></button>
              </div>
              <ul class="notif-lista" id="notifLista" role="list">
                <li class="notif-empty">Sin notificaciones nuevas</li>
              </ul>
            </div>
          </div>
          <div class="header-user-chip">
            <div class="chip-avatar" id="chipAvatar">?</div>
            <span class="chip-name" id="chipName">...</span>
          </div>
        </div>
      </header>
      <main class="main-content reportes-compartidos__main">
        <section class="panel-shell reportes-compartidos__filters-panel rrhh-filters-card">
          <div class="panel-shell__header">
            <div>
              <h2>Filtros</h2>
              <p>Selecciona periodo, vendedores, folio, cliente, estado y diferencias detectadas.</p>
            </div>
          </div>
          <div class="rrhh-filters-topbar">
            <div class="rrhh-filters-period">
              <label class="filter-field rrhh-filter-field">
                <span>Anio</span>
                <select id="filtroAnio" aria-label="Anio"></select>
              </label>
              <label class="filter-field rrhh-filter-field">
                <span>Mes</span>
                <select id="filtroMes" aria-label="Mes"></select>
              </label>
            </div>
            <p class="rrhh-filters-note">Compara folios Softland, asignaciones y reportes enviados para validar montos de pago.</p>
          </div>
          <div class="filters-grid rrhh-filters-grid">
            <label class="filter-field rrhh-filter-field">
              <span>Estado reporte</span>
              <select id="filtroEstado" aria-label="Estado reporte">
                <option value="">Todos</option>
                <option value="confirmado_vendedor">Enviado a RRHH</option>
                <option value="validado_rrhh">Validado</option>
                <option value="rechazado_rrhh">Rechazado</option>
              </select>
            </label>
            <label class="filter-check rrhh-filter-field">
              <input id="filtroSoloDiferencias" type="checkbox" />
              <span>Solo diferencias</span>
            </label>
            <label class="filter-field rrhh-filter-field">
              <span>Vendedor asignador</span>
              <select id="filtroVendedorAsignador" aria-label="Vendedor asignador">
                <option value="">Todos</option>
              </select>
            </label>
            <label class="filter-field rrhh-filter-field">
              <span>Vendedor asignado</span>
              <select id="filtroVendedorAsignado" aria-label="Vendedor asignado">
                <option value="">Todos</option>
              </select>
            </label>
            <label class="filter-field rrhh-filter-field">
              <span>Folio</span>
              <input id="filtroFolio" type="text" placeholder="Ej. 377869" aria-label="Folio" />
            </label>
            <label class="filter-field rrhh-filter-field">
              <span>Cliente</span>
              <input id="filtroCliente" type="text" placeholder="Nombre del cliente" aria-label="Cliente" />
            </label>
          </div>
          <div class="filters-actions rrhh-filter-actions">
            <span class="filters-actions__help">Mantén la revisión enfocada usando filtros visibles y fáciles de limpiar.</span>
            <div class="filters-actions__buttons">
              <button class="btn-secondary" id="btnLimpiarFiltros" type="button">Limpiar filtros</button>
              <button class="btn-primary" id="btnRecargar" type="button">Actualizar revisión</button>
            </div>
          </div>
        </section>
        <section class="kpi-grid reportes-compartidos__kpis" id="resumenCards"></section>
        <section class="status-banner" id="resumenEstado" aria-live="polite">
          <strong id="resumenEstadoTitulo">Cargando revision...</strong>
          <span id="resumenEstadoTexto">Espere un momento mientras se consolida la informacion.</span>
        </section>
        <section class="tabs-bar" role="tablist" aria-label="Secciones de revision">
          <button type="button" class="tabs-bar__item is-active" data-tab="general">Comparacion general</button>
          <button type="button" class="tabs-bar__item" data-tab="tipo-c">Folios Softland</button>
          <button type="button" class="tabs-bar__item" data-tab="asignados">Folios asignados</button>
          <button type="button" class="tabs-bar__item" data-tab="reportes">Reportes enviados</button>
          <button type="button" class="tabs-bar__item" data-tab="diferencias">Diferencias</button>
        </section>
        <section class="content-grid rrhh-review-layout" id="rrhhReviewLayout">
          <div class="content-stack main-panel">
            <article class="panel-shell tab-panel is-active" data-panel="general">
              <div class="panel-shell__header"><div><h3>Comparacion general</h3><p>Detecta faltas de asignacion, faltas en el reporte y diferencias de monto o porcentaje.</p></div><span class="panel-chip" id="totalComparacion">0 registros</span></div>
              <div class="table-wrap"><table class="data-table"><thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Vendedor origen</th><th>Vendedor asignado</th><th>%</th><th>Monto</th><th>Codigo compartido</th><th>Asignado</th><th>Reportado</th><th>Estado</th><th>Diferencias</th></tr></thead><tbody id="tbodyGeneral"></tbody></table></div>
            </article>
            <article class="panel-shell tab-panel" data-panel="tipo-c">
              <div class="panel-shell__header"><div><h3>Folios Softland</h3><p>Folios de Softland obtenidos por codigos compartidos.</p></div><span class="panel-chip" id="totalTipoC">0 registros</span></div>
              <div class="table-wrap"><table class="data-table"><thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Vendedor Softland</th><th>Total venta</th><th>Codigo compartido</th><th>Asignacion</th><th>Reporte</th></tr></thead><tbody id="tbodyTipoC"></tbody></table></div>
            </article>
            <article class="panel-shell tab-panel" data-panel="asignados">
              <div class="panel-shell__header"><div><h3>Folios asignados</h3><p>Registro operativo de ventas compartidas asignadas a receptores.</p></div><span class="panel-chip" id="totalAsignados">0 registros</span></div>
              <div class="table-wrap"><table class="data-table"><thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Vendedor asignador</th><th>Vendedor asignado</th><th>%</th><th>Monto</th><th>Reporte ID</th><th>Estado</th></tr></thead><tbody id="tbodyAsignados"></tbody></table></div>
            </article>
            <article class="panel-shell tab-panel" data-panel="reportes">
              <div class="panel-shell__header"><div><h3>Reportes enviados</h3><p>Reportes confirmados por el vendedor desde reporte_venta_compartida_confirmacion.</p></div><span class="panel-chip" id="totalReportes">0 registros</span></div>
              <div class="table-wrap"><table class="data-table"><thead><tr><th>Vendedor</th><th>Periodo</th><th>Folios</th><th>Total venta</th><th>Comision</th><th>Estado</th><th>Confirmado</th><th>Revisado</th><th>Acciones</th></tr></thead><tbody id="tbodyReportes"></tbody></table></div>
            </article>
            <article class="panel-shell tab-panel" data-panel="diferencias">
              <div class="panel-shell__header"><div><h3>Diferencias detectadas</h3><p>Folios con problemas de asignacion, reporte, monto o porcentaje.</p></div><span class="panel-chip" id="totalDiferencias">0 registros</span></div>
              <div class="table-wrap"><table class="data-table"><thead><tr><th>Folio</th><th>Estado</th><th>Diferencias</th><th>Reporte</th><th>Accion</th></tr></thead><tbody id="tbodyDiferencias"></tbody></table></div>
            </article>
          </div>
          <div class="rrhh-detail-modal" id="rrhhReportDetailModal" aria-hidden="true">
            <div class="rrhh-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="rrhhReportDetailTitle" aria-describedby="rrhhReportDetailSubtitle">
              <div class="rrhh-detail-header">
                <div class="rrhh-detail-header__copy">
                  <p class="rrhh-detail-header__eyebrow">Detalle del reporte</p>
                  <h3 id="rrhhReportDetailTitle">Detalle del reporte</h3>
                  <p class="rrhh-detail-header__subtitle" id="rrhhReportDetailSubtitle">Selecciona un folio o reporte para ver el detalle.</p>
                </div>
                <div class="rrhh-detail-header__meta">
                  <span class="status-pill is-neutral" id="detalleEstado"></span>
                  <button class="rrhh-detail-close" type="button" id="btnCerrarDetalle" aria-label="Cerrar detalle">x</button>
                </div>
              </div>
              <div class="rrhh-detail-body">
                <section class="rrhh-detail-section">
                  <div id="detalleResumen" class="detail-summary"></div>
                </section>
                <section class="rrhh-detail-section">
                  <div class="rrhh-detail-section__head"><h4>Folios incluidos</h4></div>
                  <div id="detalleFolios" class="detail-list"></div>
                </section>
                <section class="rrhh-detail-section">
                  <div class="rrhh-detail-section__head"><h4>Diferencias</h4></div>
                  <div id="detalleDiferencias" class="detail-list"></div>
                </section>
                <section class="rrhh-detail-section">
                  <div class="rrhh-detail-section__head"><h4>Comentario RRHH</h4></div>
                  <p id="detalleComentario"></p>
                </section>
                <section class="rrhh-detail-section rrhh-detail-actions-section">
                  <div class="detail-actions" id="rrhhDetailActions">
                    <button class="btn-primary" id="btnValidarReporte" type="button" disabled>Validar reporte</button>
                    <button class="btn-secondary" id="btnRechazarReporte" type="button" disabled>Rechazar reporte</button>
                  </div>
                  <p class="rrhh-detail-actions__note" id="rrhhDetailActionsNote"></p>
                  <section class="detail-inline" id="detalleValidacionInline" hidden>
                    <div class="detail-inline__header">
                      <div>
                        <p class="detail-inline__eyebrow">Validacion RRHH</p>
                        <h4>Confirmar validacion</h4>
                      </div>
                      <button class="detail-inline__close" type="button" id="cerrarValidacionInline" aria-label="Cerrar validacion">x</button>
                    </div>
                    <p class="detail-inline__text">Si el reporte esta correcto, confirmalo aqui sin salir del detalle.</p>
                    <label class="detail-inline__field">
                      <span>Comentario opcional</span>
                      <textarea id="comentarioValidacion" rows="4" placeholder="Agrega una observacion breve si lo necesitas"></textarea>
                    </label>
                    <div class="detail-inline__actions">
                      <button class="btn-secondary" type="button" id="cancelarValidacionInline">Cancelar</button>
                      <button class="btn-primary" type="button" id="confirmarValidacionInline">Confirmar validacion</button>
                    </div>
                  </section>
                  <section class="detail-inline detail-inline--danger" id="detalleRechazoInline" hidden>
                    <div class="detail-inline__header">
                      <div>
                        <p class="detail-inline__eyebrow">Rechazo RRHH</p>
                        <h4>Motivo de rechazo</h4>
                      </div>
                      <button class="detail-inline__close" type="button" id="cerrarRechazoInline" aria-label="Cerrar rechazo">x</button>
                    </div>
                    <p class="detail-inline__text">El vendedor sera notificado del rechazo.</p>
                    <label class="detail-inline__field">
                      <span>Motivo de rechazo</span>
                      <textarea id="motivoRechazo" rows="5" required placeholder="Describe el motivo del rechazo"></textarea>
                    </label>
                    <div class="detail-inline__actions">
                      <button class="btn-secondary" type="button" id="cancelarRechazoInline">Cancelar</button>
                      <button class="btn-danger" type="button" id="confirmarRechazoInline">Confirmar rechazo y notificar</button>
                    </div>
                  </section>
                </section>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

async function waitForRender() {
  await flush();
  await flush();
}

describe('RRHH UI detail visibility', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = '';
  });

  test('usa el header estandar y mantiene el detalle contextual', async () => {
    montarVistaRevision();
    localStorage.setItem('token', 'token-demo');
    window.alert = jest.fn();

    global.fetch = jest.fn(async url => {
      const pathName = String(url).replace(/^https?:\/\/[^/]+/, '');
      if (pathName.startsWith('/api/auth/me')) {
        return mockResponse({ ok: true, user: { nombre: 'Rosa RRHH', area: 'RRHH' } });
      }
      if (pathName.startsWith('/api/rrhh/ventas-compartidas/revision')) {
        return mockResponse({
          ok: true,
          periodo: { anio: 2026, mes: 7, label: 'Julio 2026' },
          codigos_compartidos: ['437', '630', '446', '447'],
          resumen: {
            folios_softland_compartidos: 1,
            folios_asignados: 1,
            folios_reportados: 1,
            reportes_pendientes_rrhh: 1,
            reportes_validados: 0,
            reportes_rechazados: 0,
            diferencias_detectadas: 1,
          },
          vendedores_compartidos: [
            { usuario_id: 2, cod_vendedor: '437', nombre: 'Vendedor 437' },
            { usuario_id: 3, cod_vendedor: '630', nombre: 'Vendedor 630' },
            { usuario_id: 4, cod_vendedor: '446', nombre: 'Vendedor 446' },
            { usuario_id: 5, cod_vendedor: '447', nombre: 'Vendedor 447' },
          ],
          comparacion: [
            {
              folio: '377869',
              fecha: '2026-07-10',
              cliente: 'Cliente A',
              vendedor_origen: 'Vendedor 437',
              vendedor_asignado: 'Vendedor B',
              porcentaje_participacion: 50,
              monto_asignado: 100000,
              existe_softland: true,
              existe_asignacion: true,
              incluido_en_reporte: true,
              diferencias: ['Folio asignado no incluido en reporte confirmado.'],
              reporte_id: '10',
            },
          ],
          folios_softland: [],
          folios_asignados: [],
          reportes_confirmados: [
            {
              id: 10,
              vendedor_nombre: 'Ana',
              periodo_label: 'Julio 2026',
              cantidad_folios: 1,
              total_venta: 100000,
              total_comision: 5000,
              estado: 'confirmado_vendedor',
              confirmado_at: '2026-07-10T10:00:00Z',
              revisado_at: null,
            },
          ],
        });
      }
      if (pathName.startsWith('/api/rrhh/reportes-compartidos?')) {
        return mockResponse({
          ok: true,
          reportes: [
            {
              id: 10,
              vendedor_nombre: 'Ana',
              periodo_label: 'Julio 2026',
              cantidad_folios: 1,
              total_venta: 100000,
              total_comision: 5000,
              estado: 'confirmado_vendedor',
              confirmado_at: '2026-07-10T10:00:00Z',
              revisado_at: null,
            },
          ],
        });
      }
      if (pathName === '/api/rrhh/reportes-compartidos/10') {
        return mockResponse({
          ok: true,
          cabecera: {
            id: 10,
            folio: '377869',
            vendedor_nombre: 'Ana',
            periodo_label: 'Julio 2026',
            total_venta: 100000,
            total_venta_real: 100000,
            total_descuento: 0,
            total_comision: 5000,
            cantidad_folios: 1,
            estado: 'confirmado_vendedor',
          },
          folios_asignados: [
            {
              folio: '377869',
              cliente: 'Cliente A',
              vendedor_asignado: 'Vendedor B',
              monto_asignado: 100000,
            },
          ],
          reporte_json: {
            comparacion: [
              {
                folio: '377869',
                diferencias: ['Folio asignado no incluido en reporte confirmado.'],
              },
            ],
          },
          estado: 'confirmado_vendedor',
        });
      }
      if (String(pathName).includes('/validar') || String(pathName).includes('/rechazar')) {
        return mockResponse({ ok: true });
      }
      throw new Error(`Ruta no simulada: ${pathName}`);
    });

    eval(REVISION_SCRIPT);
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await waitForRender();

    expect(REVISION_HTML).not.toContain('welcome-bar rrhh-welcome-bar');
    expect(REVISION_HTML).not.toContain('welcomeTitle');
    expect(REVISION_HTML).not.toContain('page-hero__badge');
    expect(REVISION_HTML).not.toContain('badgePeriodo');
    expect(REVISION_HTML).not.toContain('btnRecargar2');
    expect(REVISION_HTML).not.toContain('btnLimpiarFiltros2');
    expect(REVISION_HTML).toContain('header-indicadores');
    expect(REVISION_HTML).toContain('notif-wrapper');
    expect(REVISION_HTML).toContain('header-user-chip');
    expect(REVISION_HTML).toContain('indicadores-header.js');
    expect(REVISION_HTML).toContain('inactividad.js');
    expect(REVISION_HTML).toContain('rrhh-filters-topbar');
    expect(REVISION_HTML).toContain('rrhh-filters-grid');
    expect(REVISION_HTML).toContain('filters-actions rrhh-filter-actions');
    expect(REVISION_HTML).toContain('rrhhReportDetailModal');
    expect(REVISION_HTML).not.toContain('rrhhDetallePanel');

    expect(document.getElementById('rrhhReportDetailModal').classList.contains('is-open')).toBe(false);
    expect(document.body.classList.contains('rrhh-modal-open')).toBe(false);
    expect(document.getElementById('chipAvatar').textContent).not.toBe('?');
    expect(document.getElementById('chipAvatar').textContent).toBe('RR');
    expect(document.querySelectorAll('.rrhh-filters-period .rrhh-filter-field').length).toBe(2);
    expect(document.querySelectorAll('.rrhh-filters-grid .rrhh-filter-field').length).toBe(6);
    expect(Array.from(document.getElementById('filtroVendedorAsignado').options).map(option => option.textContent)).toEqual(
      expect.arrayContaining(['Vendedor 437', 'Vendedor 630', 'Vendedor 446', 'Vendedor 447'])
    );
    expect(document.querySelectorAll('[data-sort-tab="general"]').length).toBeGreaterThan(0);

    document.querySelector('#tbodyReportes tr')?.click();
    await waitForRender();

    expect(document.getElementById('rrhhReportDetailModal').classList.contains('is-open')).toBe(true);
    expect(document.body.classList.contains('rrhh-modal-open')).toBe(true);
    expect(document.querySelector('#tbodyReportes tr').classList.contains('is-selected')).toBe(true);
    expect(document.getElementById('detalleResumen').textContent).toContain('377869');
    expect(document.getElementById('rrhhDetailActionsNote').textContent).toContain('mismo modal');
    expect(document.querySelectorAll('#rrhhDetailActions button').length).toBe(2);

    document.getElementById('btnValidarReporte').click();
    expect(document.getElementById('detalleValidacionInline').hidden).toBe(false);
    expect(document.getElementById('detalleRechazoInline').hidden).toBe(true);

    document.getElementById('confirmarValidacionInline').click();
    await waitForRender();
    expect(global.fetch.mock.calls.some(([url, options = {}]) => String(url).includes('/validar') && String(options.method || 'GET').toUpperCase() === 'PATCH')).toBe(true);

    document.querySelector('#tbodyReportes tr')?.click();
    await waitForRender();
    document.getElementById('btnRechazarReporte').click();
    expect(document.getElementById('detalleRechazoInline').hidden).toBe(false);
    document.getElementById('motivoRechazo').value = 'Diferencia de monto';
    document.getElementById('confirmarRechazoInline').click();
    await waitForRender();
    expect(global.fetch.mock.calls.some(([url, options = {}]) => String(url).includes('/rechazar') && String(options.method || 'GET').toUpperCase() === 'PATCH')).toBe(true);

    document.getElementById('btnCerrarDetalle').click();
    await waitForRender();
    expect(document.getElementById('rrhhReportDetailModal').classList.contains('is-open')).toBe(false);
    expect(document.body.classList.contains('rrhh-modal-open')).toBe(false);
  });
});
