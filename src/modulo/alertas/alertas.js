'use strict';
/**
 * alertas.js v2.3 — Frontend del módulo de Alertas y Recordatorios
 * Texpro RSProyecto
 *
 * v2.3:
 *  - initSidebar unificado con dashboard.js:
 *    · Mismos MODULOS, mismos íconos, filtrado por área del usuario
 *    · Dashboard con SVG de casa (igual que dashboard.js)
 *    · Alertas marcada como active
 *  - Fix logout: elimina token y texpro_user igual que dashboard
 */

// ── Auth guard ───────────────────────────────────────────────────
const TOKEN   = localStorage.getItem('token');
const USUARIO = JSON.parse(sessionStorage.getItem('texpro_user') || 'null');

if (!TOKEN || !USUARIO) {
  location.href = '../login/index.html';
}

const API = '/api/alertas';
const headers = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` });

let _alertas      = [];
let _usuarios     = [];
let _filtroActual = 'todas';
let _editandoId   = null;

const grid              = document.getElementById('alertasGrid');
const modalOverlay      = document.getElementById('modalAlertaOverlay');
const formAlerta        = document.getElementById('formAlerta');
const fTitulo           = document.getElementById('fTitulo');
const fDescripcion      = document.getElementById('fDescripcion');
const fTipo             = document.getElementById('fTipo');
const fFechaVence       = document.getElementById('fFechaVence');
const fFrecuencia       = document.getElementById('fFrecuencia');
const seccionDest       = document.getElementById('seccionDestinatarios');
const listaDest         = document.getElementById('listaDestinatarios');
const btnNueva          = document.getElementById('btnNuevaAlerta');
const btnCerrar         = document.getElementById('btnCerrarModal');
const btnCancelar       = document.getElementById('btnCancelarModal');
const modalTitulo       = document.getElementById('modalAlertaTitulo');
const recordatorioOv    = document.getElementById('recordatorioOverlay');
const recordatorioLista = document.getElementById('recordatorioLista');
const btnCerrarRec      = document.getElementById('btnCerrarRecordatorio');
const btnIrAlertas      = document.getElementById('btnIrAlertas');

document.addEventListener('DOMContentLoaded', async () => {
  initSidebar();
  initHeader();
  await Promise.all([
    cargarAlertas(),
    cargarUsuarios(),
  ]);
  mostrarRecordatorioLogin();
  initFiltros();
  initModal();
});

// ── SIDEBAR — idéntico al dashboard ─────────────────────────────
// area: null  → visible para TODOS los usuarios
// area: [...] → visible solo para las áreas listadas
const MODULOS = [
  { nombre: 'Ventas',         icon: '📊', url: '../ventas/index.html',        area: ['ventas', 'gerencia'] },
  { nombre: 'Facturación',    icon: '🧾', url: '../facturacion/index.html',   area: ['facturacion', 'contabilidad', 'gerencia'] },
  { nombre: 'Bodega',         icon: '🏭', url: '../bodega/index.html',        area: ['bodega', 'produccion', 'gerencia'] },
  { nombre: 'Producción',     icon: '⚙️', url: '../produccion/index.html',    area: ['produccion', 'gerencia'] },
  { nombre: 'Laboratorio',    icon: '🧪', url: '../laboratorio/index.html',   area: ['laboratorio', 'gerencia'] },
  { nombre: 'Cobranza',       icon: '💰', url: '../cobranza/index.html',      area: ['cobranza', 'contabilidad', 'gerencia'] },
  { nombre: 'RRHH',           icon: '👥', url: '../rrhh/index.html',          area: ['rrhh', 'gerencia'] },
  { nombre: 'Contabilidad',   icon: '📜', url: '../contabilidad/index.html',  area: ['contabilidad', 'gerencia'] },
  { nombre: 'Administración', icon: '🔧', url: '../admin/index.html',         area: ['admin'] },
  { nombre: 'Alertas',        icon: '🔔', url: '../alertas/index.html',       area: null, active: true, badge: true },
];

function initSidebar() {
  const nav = document.getElementById('sidebarNav');
  if (!nav || !USUARIO) return;

  const visibles = MODULOS.filter(m => {
    if (m.area === null) return true;
    if (USUARIO.is_admin) return true;
    return m.area.includes(USUARIO.area);
  });

  // SVG casa idéntico al dashboard.js
  const svgCasa = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

  nav.innerHTML =
    `<span class="nav-section-title">NAVEGACIÓN</span>
     <a class="nav-item" href="../dashboard/index.html">
       ${svgCasa}
       <span class="nav-label">Dashboard</span>
     </a>
     ${visibles.map(m => `
       <a class="nav-item${m.active ? ' active' : ''}" href="${m.url}">
         <span class="nav-icon-wrap">
           <span style="font-size:1rem">${m.icon}</span>
           ${m.badge ? '<span class="nav-badge" id="navBadgeAlertas" style="display:none">0</span>' : ''}
         </span>
         <span class="nav-label">${m.nombre}</span>
       </a>`).join('')}`;

  // Info usuario
  const ini = (USUARIO.nombre || '?').charAt(0).toUpperCase();
  const ua  = document.getElementById('userAvatar');
  const un  = document.getElementById('userName');
  const uu  = document.getElementById('userArea');
  const ca  = document.getElementById('chipAvatar');
  const cn  = document.getElementById('chipName');
  if (ua) ua.textContent = ini;
  if (ca) ca.textContent = ini;
  if (un) un.textContent = USUARIO.nombre || '';
  if (uu) uu.textContent = USUARIO.area   || '';
  if (cn) cn.textContent = USUARIO.nombre || '';

  // Logout — limpia igual que dashboard
  document.getElementById('btnLogout')?.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('texpro_user');
    location.href = '../login/index.html';
  });

  // Colapsar sidebar
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('sidebar--collapsed');
    document.getElementById('mainWrapper').classList.toggle('main-wrapper--expanded');
  });

  // Menú móvil
  document.getElementById('headerMenuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('sidebar--mobile-open');
  });

  cargarBadgeAlertas();
}

async function cargarBadgeAlertas() {
  try {
    const r = await fetch(`${API}/badge`, { headers: headers() });
    const j = await r.json();
    if (!j.ok) return;
    const badge = document.getElementById('navBadgeAlertas');
    if (!badge) return;
    if (j.total > 0) {
      badge.textContent = j.total > 99 ? '99+' : j.total;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch { /* fallo silencioso */ }
}

function initHeader() {
  const el = document.getElementById('headerDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

// ── CARGAR DATOS ─────────────────────────────────────────────────
async function cargarAlertas() {
  try {
    const r = await fetch(API, { headers: headers() });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    _alertas = j.data;
    renderAlertas();
  } catch (e) {
    grid.innerHTML = `<div class="alertas-empty"><div class="alertas-empty-icon">⚠️</div><p class="alertas-empty-txt">Error al cargar alertas: ${e.message}</p></div>`;
  }
}

async function cargarUsuarios() {
  try {
    const r = await fetch(`${API}/usuarios`, { headers: headers() });
    const j = await r.json();
    if (j.ok) _usuarios = j.data.filter(u => u.id !== USUARIO.id);
  } catch { /* sin usuarios disponibles */ }
}

// ── RENDER GRID ──────────────────────────────────────────────────
function renderAlertas() {
  const filtradas = filtrarAlertas(_alertas, _filtroActual);

  if (!filtradas.length) {
    grid.innerHTML = `
      <div class="alertas-empty">
        <div class="alertas-empty-icon">🔔</div>
        <p class="alertas-empty-txt">No hay alertas en este filtro.<br>¡Crea una nueva!</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtradas.map(a => cardHTML(a)).join('');

  grid.querySelectorAll('[data-accion]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = Number(btn.dataset.id);
      const accion = btn.dataset.accion;
      if (accion === 'editar')     abrirEditar(id);
      if (accion === 'completar')  accionAlerta(id, 'completar');
      if (accion === 'desactivar') accionAlerta(id, 'desactivar');
      if (accion === 'eliminar')   eliminarAlerta(id);
    });
  });
}

function filtrarAlertas(lista, filtro) {
  switch (filtro) {
    case 'activas':     return lista.filter(a => a.activa && !a.completada);
    case 'proximas':    return lista.filter(a => a.activa && !a.completada && a.dias_restantes <= 7);
    case 'completadas': return lista.filter(a => a.completada);
    case 'grupales':    return lista.filter(a => a.tipo === 'grupal');
    case 'propias':     return lista.filter(a => a.id_creador === USUARIO.id);
    case 'asignadas':   return lista.filter(a => a.id_creador !== USUARIO.id);
    default:            return lista;
  }
}

function urgencia(dias, completada) {
  if (completada) return 'completada';
  if (dias < 0)   return 'vencida';
  if (dias <= 2)  return 'critica';
  if (dias <= 7)  return 'urgente';
  return 'normal';
}

function labelDias(dias, completada) {
  if (completada) return '✅ Completada';
  if (dias < 0)   return `Venció hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`;
  if (dias === 0) return '⚠️ Vence HOY';
  if (dias === 1) return '⚠️ Vence mañana';
  return `${dias} días restantes`;
}

const FREC_LABEL = {
  siempre:   '🔄 Siempre',
  diaria:    '🔄 Diaria',
  semanal:   '🔄 Semanal',
  quincenal: '🔄 Quincenal',
};

function cardHTML(a) {
  const u         = urgencia(a.dias_restantes, !!a.completada);
  const esMio     = a.id_creador === USUARIO.id;
  const fecha     = new Date(a.fecha_vence).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  const frecLabel = FREC_LABEL[a.frecuencia_recordatorio] || '';

  const badgeOrigen = esMio
    ? `<span class="alerta-origen-badge alerta-origen-badge--propia">🔒 Propia</span>`
    : `<span class="alerta-origen-badge alerta-origen-badge--asignada">📌 Asignada por ${escHtml(a.nombre_creador)}</span>`;

  const botonesAccion = a.completada
    ? `<button class="btn-accion btn-accion--eliminar" data-accion="eliminar" data-id="${a.id}">🗑 Eliminar</button>`
    : `
      ${esMio ? `<button class="btn-accion btn-accion--completar"  data-accion="completar"  data-id="${a.id}">✅ Completar</button>` : ''}
      ${esMio ? `<button class="btn-accion btn-accion--editar"     data-accion="editar"     data-id="${a.id}">✏️ Editar</button>`    : ''}
      ${a.activa && esMio ? `<button class="btn-accion btn-accion--desactivar" data-accion="desactivar" data-id="${a.id}">🔕 Desactivar</button>` : ''}
      ${esMio ? `<button class="btn-accion btn-accion--eliminar"   data-accion="eliminar"   data-id="${a.id}">🗑 Eliminar</button>`  : ''}
    `;

  return `
    <div class="alerta-card alerta-card--${u}
      ${a.completada               ? 'alerta-card--completada'  : ''}
      ${!a.activa && !a.completada ? 'alerta-card--desactivada' : ''}">
      <div class="alerta-card-body">
        <div class="alerta-card-top">
          <div class="alerta-titulo-wrap">
            <div class="alerta-titulo-card" title="${escHtml(a.titulo)}">${escHtml(a.titulo)}</div>
            <div class="alerta-badges-row">
              <span class="alerta-tipo-badge alerta-tipo-badge--${a.tipo}">
                ${a.tipo === 'grupal' ? '👥 Grupal' : '🔒 Personal'}
              </span>
              ${badgeOrigen}
            </div>
          </div>
          <span class="alerta-dias-badge dias--${u}">${labelDias(a.dias_restantes, !!a.completada)}</span>
        </div>
        ${a.descripcion ? `<p class="alerta-desc">${escHtml(a.descripcion)}</p>` : ''}
        <div class="alerta-meta">
          <span>📅 Vence: <strong>${fecha}</strong></span>
          <span>👤 ${escHtml(a.nombre_creador)}</span>
          ${frecLabel ? `<span class="alerta-frec-badge">${frecLabel}</span>` : ''}
        </div>
        ${a.tipo === 'grupal' && a.destinatarios_nombres
          ? `<div class="alerta-destinatarios">👥 ${escHtml(a.destinatarios_nombres)}</div>`
          : ''}
      </div>
      <div class="alerta-card-acciones">${botonesAccion}</div>
    </div>`;
}

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

// ── FILTROS ──────────────────────────────────────────────────────
function initFiltros() {
  document.querySelectorAll('.filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('filtro-btn--active'));
      btn.classList.add('filtro-btn--active');
      _filtroActual = btn.dataset.filtro;
      renderAlertas();
    });
  });
}

// ── MODAL CREAR / EDITAR ─────────────────────────────────────────
function initModal() {
  btnNueva.addEventListener('click', abrirCrear);
  btnCerrar.addEventListener('click', cerrarModal);
  btnCancelar.addEventListener('click', cerrarModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) cerrarModal(); });
  fTipo.addEventListener('change', () => toggleDestinatarios());
  formAlerta.addEventListener('submit', guardarAlerta);
}

function abrirCrear() {
  _editandoId = null;
  formAlerta.reset();
  document.getElementById('editandoId').value = '';
  modalTitulo.textContent = 'Nueva Alerta';
  fFechaVence.min = new Date().toISOString().slice(0, 10);
  fFrecuencia.value = 'semanal';
  toggleDestinatarios();
  abrirModal();
}

function abrirEditar(id) {
  const a = _alertas.find(x => x.id === id);
  if (!a) return;
  if (a.id_creador !== USUARIO.id) return;
  _editandoId = id;
  modalTitulo.textContent = 'Editar Alerta';
  document.getElementById('editandoId').value = id;
  fTitulo.value        = a.titulo;
  fDescripcion.value   = a.descripcion || '';
  fTipo.value          = a.tipo;
  fFechaVence.value    = a.fecha_vence?.slice(0, 10) || '';
  fFechaVence.min      = '';
  fFrecuencia.value    = a.frecuencia_recordatorio || 'semanal';
  toggleDestinatarios(a.destinatarios_ids || []);
  abrirModal();
}

function abrirModal() {
  modalOverlay.classList.add('alerta-modal-overlay--visible');
  modalOverlay.setAttribute('aria-hidden', 'false');
  fTitulo.focus();
}

function cerrarModal() {
  modalOverlay.classList.remove('alerta-modal-overlay--visible');
  modalOverlay.setAttribute('aria-hidden', 'true');
}

function toggleDestinatarios(seleccionados = []) {
  const esGrupal = fTipo.value === 'grupal';
  seccionDest.style.display = esGrupal ? 'flex' : 'none';
  if (!esGrupal) return;
  if (!_usuarios.length) {
    listaDest.innerHTML = '<span class="dest-loading">No hay otros usuarios disponibles.</span>';
    return;
  }
  listaDest.innerHTML = _usuarios.map(u =>
    `<label class="dest-item">
       <input type="checkbox" name="dest" value="${u.id}" ${seleccionados.includes(u.id) ? 'checked' : ''} />
       <span>${escHtml(u.nombre)}${u.area
         ? ` <em style="color:#9CA3AF;font-size:.73rem">(${escHtml(u.area)})</em>`
         : ''}</span>
     </label>`
  ).join('');
}

async function guardarAlerta(e) {
  e.preventDefault();
  const btn = document.getElementById('btnGuardarAlerta');
  btn.disabled    = true;
  btn.textContent = 'Guardando...';

  const destinatarios = [...document.querySelectorAll('input[name=dest]:checked')]
    .map(i => Number(i.value));

  const body = {
    titulo:                  fTitulo.value.trim(),
    descripcion:             fDescripcion.value.trim(),
    tipo:                    fTipo.value,
    fecha_vence:             fFechaVence.value,
    frecuencia_recordatorio: fFrecuencia.value,
    destinatarios,
  };

  try {
    const url    = _editandoId ? `${API}/${_editandoId}` : API;
    const method = _editandoId ? 'PUT' : 'POST';
    const r = await fetch(url, { method, headers: headers(), body: JSON.stringify(body) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    cerrarModal();
    await cargarAlertas();
    cargarBadgeAlertas();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Guardar Alerta';
  }
}

// ── ACCIONES ─────────────────────────────────────────────────────
async function accionAlerta(id, accion) {
  const msgs = {
    completar:  '¿Marcar esta alerta como completada?',
    desactivar: '¿Desactivar esta alerta? Se ocultará pero no se eliminará.',
  };
  if (!confirm(msgs[accion] || '¿Confirmar?')) return;
  try {
    const r = await fetch(`${API}/${id}/${accion}`, { method: 'PATCH', headers: headers() });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    await cargarAlertas();
    cargarBadgeAlertas();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

async function eliminarAlerta(id) {
  if (!confirm('¿Eliminar esta alerta permanentemente? Esta acción no se puede deshacer.')) return;
  try {
    const r = await fetch(`${API}/${id}`, { method: 'DELETE', headers: headers() });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    await cargarAlertas();
    cargarBadgeAlertas();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

// ── POPUP RECORDATORIO AL LOGIN ──────────────────────────────────
async function mostrarRecordatorioLogin() {
  const flagKey = `rec_mostrado_${USUARIO.id}_${new Date().toISOString().slice(0, 10)}`;
  if (localStorage.getItem(flagKey)) return;

  try {
    const r = await fetch(`${API}/pendientes`, { headers: headers() });
    const j = await r.json();
    if (!j.ok || !j.data.length) return;

    localStorage.setItem(flagKey, '1');

    recordatorioLista.innerHTML = j.data.map(a => {
      const u     = urgencia(a.dias_restantes, false);
      const fecha = new Date(a.fecha_vence).toLocaleDateString('es-CL', {
        day: '2-digit', month: 'short', year: 'numeric',
      });
      const badgeOrigen = a.id_creador !== USUARIO.id
        ? `<span class="rec-asignada-badge">📌 Asignada por ${escHtml(a.nombre_creador)}</span>`
        : '';
      return `
        <li class="rec-item rec-item--${u}" id="rec-${a.id}">
          <div class="rec-item-top">
            <span class="rec-titulo">${escHtml(a.titulo)}</span>
            <span class="rec-dias rec-dias--${u}">${labelDias(a.dias_restantes, false)}</span>
          </div>
          ${badgeOrigen}
          ${a.descripcion ? `<p class="rec-desc">${escHtml(a.descripcion)}</p>` : ''}
          <span class="rec-fecha">📅 Vence: ${fecha}</span>
          <button class="btn-no-mostrar" data-id="${a.id}">No mostrar más hoy</button>
        </li>`;
    }).join('');

    recordatorioLista.querySelectorAll('.btn-no-mostrar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.id);
        await fetch(`${API}/${id}/descartar`, { method: 'PATCH', headers: headers() });
        const li = document.getElementById(`rec-${id}`);
        if (li) {
          li.style.opacity    = '0';
          li.style.transition = '.3s';
          setTimeout(() => li.remove(), 300);
        }
        if (!recordatorioLista.children.length) cerrarRecordatorio();
      });
    });

    recordatorioOv.classList.add('recordatorio-overlay--visible');
    recordatorioOv.setAttribute('aria-hidden', 'false');
  } catch { /* fallo silencioso */ }
}

function cerrarRecordatorio() {
  recordatorioOv.classList.remove('recordatorio-overlay--visible');
  recordatorioOv.setAttribute('aria-hidden', 'true');
}

btnCerrarRec?.addEventListener('click', cerrarRecordatorio);
btnIrAlertas?.addEventListener('click', cerrarRecordatorio);
