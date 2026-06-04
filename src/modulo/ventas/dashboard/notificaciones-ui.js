'use strict';

/**
 * notificaciones-ui.js v2.0 — Campana 🔔 Texpro
 *
 * v2.0 — Integra alertas próximas (/api/alertas/pendientes) en el mismo
 *         panel de la campana, bajo una sección separada "⚠️ Alertas".
 *         Badge suma notificaciones no leídas + alertas próximas.
 *         Polling 30 s para ambas fuentes.
 */

(function () {

  /* ── Helpers ──────────────────────────────────────────────────── */
  const API_NOTIF  = '/api/notificaciones';
  const API_ALERTA = '/api/alertas';
  const token = () => localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  const hdrs  = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() });

  function tiempoRelativo(fechaStr) {
    const diff = Math.floor((Date.now() - new Date(fechaStr).getTime()) / 1000);
    if (diff < 60)    return 'Hace un momento';
    if (diff < 3600)  return `Hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`;
    return `Hace ${Math.floor(diff / 86400)} d`;
  }

  function iconoTipo(tipo) {
    const m = {
      folio_recibido: { cls: 'notif-icono--folio',   emoji: '📥' },
      folio_asignado: { cls: 'notif-icono--asignado', emoji: '📤' },
      meta_cumplida:  { cls: 'notif-icono--meta',     emoji: '🎯' },
      meta_superada:  { cls: 'notif-icono--superada', emoji: '🚀' },
    };
    return m[tipo] || { cls: 'notif-icono--folio', emoji: '🔔' };
  }

  function urgenciaAlerta(dias) {
    if (dias <= 0) return 'vencida';
    if (dias <= 2) return 'critica';
    if (dias <= 7) return 'urgente';
    return 'normal';
  }

  function labelDiasAlerta(dias) {
    if (dias < 0)  return `Venció hace ${Math.abs(dias)} día${Math.abs(dias) !== 1 ? 's' : ''}`;
    if (dias === 0) return '⚠️ Vence HOY';
    if (dias === 1) return '⚠️ Vence mañana';
    return `${dias} días restantes`;
  }

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ── DOM refs ─────────────────────────────────────────────────── */
  const btn      = document.getElementById('notifBtn');
  const badge    = document.getElementById('notifBadge');
  const panel    = document.getElementById('notifPanel');
  const lista    = document.getElementById('notifLista');
  const leerTodo = document.getElementById('notifLeerTodo');
  const toastCnt = document.getElementById('notifToastContainer');

  if (!btn) return;

  /* ── Estado ───────────────────────────────────────────────────── */
  let panelAbierto   = false;
  let notificaciones = [];
  let alertasPend    = [];
  let toastsVistos   = new Set();

  /* ── Toggle panel ───────────────────────────────────────────────── */
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panelAbierto = !panelAbierto;
    panel.classList.toggle('notif-panel--open', panelAbierto);
    btn.classList.toggle('notif-btn--active', panelAbierto);
    btn.setAttribute('aria-expanded', panelAbierto);
    if (panelAbierto) renderLista();
  });

  document.addEventListener('click', (e) => {
    if (panelAbierto && !document.getElementById('notifWrapper').contains(e.target)) {
      cerrarPanel();
    }
  });

  function cerrarPanel() {
    panelAbierto = false;
    panel.classList.remove('notif-panel--open');
    btn.classList.remove('notif-btn--active');
    btn.setAttribute('aria-expanded', 'false');
  }

  /* ── Render lista (notificaciones + alertas) ──────────────────────── */
  function renderLista() {
    let html = '';

    /* — Sección Notificaciones — */
    if (notificaciones.length) {
      html += `<li class="notif-seccion-header">🔔 Notificaciones</li>`;
      html += notificaciones.map(n => {
        const ico = iconoTipo(n.tipo);
        return `
          <li class="notif-item ${n.leida ? 'notif-item--leida' : ''}"
              data-id="${n.id}" data-fuente="notif"
              role="menuitem" tabindex="0"
              title="${n.leida ? 'Leída' : 'Marcar como leída'}">
            <div class="notif-icono ${ico.cls}">${ico.emoji}</div>
            <div class="notif-content">
              <div class="notif-titulo">${escHtml(n.titulo)}</div>
              <div class="notif-msg">${escHtml(n.mensaje)}</div>
              <div class="notif-fecha">${tiempoRelativo(n.fecha_creacion)}</div>
            </div>
            <span class="notif-dot"></span>
          </li>`;
      }).join('');
    }

    /* — Sección Alertas próximas — */
    if (alertasPend.length) {
      html += `<li class="notif-seccion-header notif-seccion-header--alerta">⚠️ Alertas próximas</li>`;
      html += alertasPend.map(a => {
        const u     = urgenciaAlerta(a.dias_restantes);
        const label = labelDiasAlerta(a.dias_restantes);
        const esMia = a.id_creador === _uid();
        const origen = esMia
          ? `<span class="notif-alerta-origen notif-alerta-origen--propia">🔒 Propia</span>`
          : `<span class="notif-alerta-origen notif-alerta-origen--asignada">📌 ${escHtml(a.nombre_creador)}</span>`;
        return `
          <li class="notif-item notif-item--alerta notif-item--alerta-${u}"
              data-id="${a.id}" data-fuente="alerta"
              role="menuitem" tabindex="0"
              title="Ir a Alertas">
            <div class="notif-icono notif-icono--alerta">🔔</div>
            <div class="notif-content">
              <div class="notif-titulo">${escHtml(a.titulo)}</div>
              <div class="notif-msg notif-msg--dias notif-msg--dias-${u}">${label}</div>
              ${a.descripcion ? `<div class="notif-msg">${escHtml(a.descripcion)}</div>` : ''}
              <div class="notif-alerta-meta">${origen}</div>
            </div>
            <span class="notif-alerta-badge notif-alerta-badge--${u}">${a.tipo === 'grupal' ? '👥' : '🔒'}</span>
          </li>`;
      }).join('');
    }

    if (!html) {
      lista.innerHTML = '<li class="notif-empty">Sin notificaciones ni alertas pendientes</li>';
      return;
    }

    lista.innerHTML = html;

    /* Marcar notificación como leída al click */
    lista.querySelectorAll('.notif-item[data-fuente="notif"]:not(.notif-item--leida)').forEach(el => {
      el.addEventListener('click', () => marcarLeida(+el.dataset.id, el));
      el.addEventListener('keydown', e => { if (e.key === 'Enter') marcarLeida(+el.dataset.id, el); });
    });

    /* Click en alerta → ir al módulo de alertas */
    lista.querySelectorAll('.notif-item[data-fuente="alerta"]').forEach(el => {
      el.addEventListener('click', () => {
        cerrarPanel();
        window.location.href = '../alertas/index.html';
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { cerrarPanel(); window.location.href = '../alertas/index.html'; }
      });
    });
  }

  /* Obtener id del usuario logueado desde la sesión */
  function _uid() {
    try {
      const u = JSON.parse(sessionStorage.getItem('texpro_user') || 'null');
      return u?.id ?? u?.sub ?? null;
    } catch { return null; }
  }

  /* ── Badge total (notif no leídas + alertas pendientes) ─────────────── */
  function actualizarBadge() {
    const noLeidas = notificaciones.filter(x => !x.leida).length;
    const total    = noLeidas + alertasPend.length;
    if (total > 0) {
      badge.textContent  = total > 99 ? '99+' : total;
      badge.style.display = 'block';
    } else {
      badge.style.display = 'none';
    }
  }

  /* ── Marcar notificación como leída ────────────────────────────────── */
  function marcarLeida(id, el) {
    fetch(`${API_NOTIF}/${id}/leer`, { method: 'PATCH', headers: hdrs() })
      .then(r => r.json())
      .then(() => {
        const n = notificaciones.find(x => x.id === id);
        if (n) n.leida = 1;
        if (el) el.classList.add('notif-item--leida');
        actualizarBadge();
      })
      .catch(console.error);
  }

  /* ── Marcar todas las notificaciones como leídas ───────────────────── */
  leerTodo.addEventListener('click', () => {
    fetch(`${API_NOTIF}/leer-todo`, { method: 'PATCH', headers: hdrs() })
      .then(r => r.json())
      .then(() => {
        notificaciones.forEach(n => n.leida = 1);
        actualizarBadge();
        renderLista();
      })
      .catch(console.error);
  });

  /* ── Toast motivacional ─────────────────────────────────────────────── */
  function mostrarToast(n) {
    if (toastsVistos.has(n.id)) return;
    toastsVistos.add(n.id);
    const esSuperada = n.tipo === 'meta_superada';
    const toast = document.createElement('div');
    toast.className = `notif-toast${esSuperada ? ' notif-toast--superada' : ''}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <span class="toast-emoji">${esSuperada ? '🚀' : '🎯'}</span>
      <div class="toast-body">
        <div class="toast-titulo">${escHtml(n.titulo)}</div>
        <div class="toast-msg">${escHtml(n.mensaje)}</div>
      </div>
      <button class="toast-cerrar" aria-label="Cerrar notificación">✕</button>`;
    toast.querySelector('.toast-cerrar').addEventListener('click', () => quitarToast(toast, n.id));
    toastCnt.appendChild(toast);
    setTimeout(() => quitarToast(toast, n.id), 7000);
  }

  function quitarToast(toast, id) {
    if (!toast.parentNode) return;
    toast.classList.add('notif-toast--saliendo');
    setTimeout(() => toast.remove(), 280);
    marcarLeida(id, null);
  }

  /* ── Fetch notificaciones ─────────────────────────────────────────────── */
  function fetchNotificaciones() {
    fetch(`${API_NOTIF}?limit=30`, { headers: hdrs() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.ok) return;
        notificaciones = data.notificaciones || [];
        actualizarBadge();
        if (panelAbierto) renderLista();
        notificaciones
          .filter(n => !n.leida && (n.tipo === 'meta_cumplida' || n.tipo === 'meta_superada'))
          .forEach(mostrarToast);
      })
      .catch(() => {});
  }

  /* ── Fetch alertas pendientes ───────────────────────────────────────────── */
  function fetchAlertas() {
    fetch(`${API_ALERTA}/pendientes`, { headers: hdrs() })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.ok) return;
        alertasPend = data.data || [];
        actualizarBadge();
        if (panelAbierto) renderLista();
      })
      .catch(() => {});
  }

  /* ── Polling cada 30 s ─────────────────────────────────────────────────── */
  fetchNotificaciones();
  fetchAlertas();
  setInterval(() => { fetchNotificaciones(); fetchAlertas(); }, 30_000);

  /* ── Estilos inline para los nuevos elementos de alerta ───────────────── */
  const style = document.createElement('style');
  style.textContent = `
    .notif-seccion-header {
      list-style: none;
      padding: 6px 16px 4px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: var(--color-text-muted, #9ca3af);
      background: var(--color-surface-offset, #f3f0ec);
      border-top: 1px solid var(--color-border, #e5e7eb);
      margin-top: 4px;
    }
    .notif-seccion-header--alerta { color: #b45309; background: #fef9f0; }

    /* Alerta item en campana */
    .notif-item--alerta { cursor: pointer; }
    .notif-item--alerta:hover { background: var(--color-surface-offset, #f3f0ec); }

    .notif-icono--alerta { background: #fef3c7; color: #b45309; }

    /* Colores por urgencia */
    .notif-msg--dias        { font-weight: 600; font-size: .78rem; }
    .notif-msg--dias-critica { color: #dc2626; }
    .notif-msg--dias-urgente { color: #d97706; }
    .notif-msg--dias-normal  { color: #059669; }
    .notif-msg--dias-vencida { color: #6b7280; text-decoration: line-through; }

    /* Badge tipo en esquina */
    .notif-alerta-badge {
      font-size: .8rem;
      margin-left: auto;
      padding-left: 4px;
      align-self: flex-start;
      margin-top: 2px;
    }

    /* Origen propia/asignada */
    .notif-alerta-meta { margin-top: 3px; }
    .notif-alerta-origen {
      font-size: .7rem;
      padding: 1px 6px;
      border-radius: 999px;
      font-weight: 600;
    }
    .notif-alerta-origen--propia   { background: #e0f2fe; color: #0369a1; }
    .notif-alerta-origen--asignada { background: #f0fdf4; color: #15803d; }
  `;
  document.head.appendChild(style);

})();
