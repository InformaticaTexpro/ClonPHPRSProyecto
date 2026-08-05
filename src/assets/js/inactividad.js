'use strict';

/**
 * inactividad.js — RSProyecto Texpro v2.3.0
 *
 * Módulo reutilizable de alerta por inactividad.
 * Incluido automáticamente en todos los módulos del sistema.
 *
 * Comportamiento:
 *   1. Detecta actividad (mousemove, keydown, click, scroll, touchstart).
 *   2. Tras IDLE_MS sin actividad muestra un modal de advertencia con countdown.
 *   3. El usuario puede hacer clic en «Continuar» para extender la sesión.
 *   4. Si el countdown llega a 0 cierra sesión automáticamente.
 *
 * Configuración opcional (antes de cargar este script):
 *   window.TEXPRO_IDLE_MS   = 15 * 60 * 1000;  // tiempo inactividad (default 15 min)
 *   window.TEXPRO_WARN_SEC  = 60;               // segundos de countdown (default 60)
 *   window.TEXPRO_LOGIN_URL = '...';            // override ruta login (recomendado definirlo por página)
 */

(function () {

  // ── Configuración ─────────────────────────────────────────────────────────
  const IDLE_MS   = window.TEXPRO_IDLE_MS   || 15 * 60 * 1000;
  const WARN_SEC  = window.TEXPRO_WARN_SEC  || 60;
  const LOGIN_URL = window.TEXPRO_LOGIN_URL || _detectarLoginUrl();

  function _detectarLoginUrl() {
    // Estrategia: usar origin + ruta absoluta conocida del login.
    // Evita cálculos relativos frágiles basados en profundidad del path.
    return window.location.origin + '/src/modulo/varios/login/index.php';
  }

  // Solo activar si hay token activo
  if (!localStorage.getItem('token')) return;

  // ── Estado ────────────────────────────────────────────────────────────────
  let idleTimer     = null;
  let countTimer    = null;
  let countRestante = WARN_SEC;
  let modalVisible  = false;

  // ── Crear modal ───────────────────────────────────────────────────────────
  function crearModal() {
    if (document.getElementById('idleOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'idleOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'idleTitle');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)', 'backdrop-filter:blur(4px)',
      'opacity:0', 'pointer-events:none',
      'transition:opacity 250ms ease'
    ].join(';');

    overlay.innerHTML = [
      '<div id="idleCard" style="',
        'background:var(--color-surface,#fff);',
        'color:var(--color-text,#1a1a1a);',
        'border-radius:var(--radius-xl,16px);',
        'padding:2rem 2.5rem;',
        'max-width:420px;width:90%;',
        'box-shadow:0 24px 64px rgba(0,0,0,0.28);',
        'text-align:center;',
        'transform:translateY(12px);',
        'transition:transform 250ms ease;">',

      '<div style="margin-bottom:1rem">',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none"',
          ' stroke="var(--color-warning,#e67e22)" stroke-width="1.8"',
          ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
          '<circle cx="12" cy="12" r="10"/>',
          '<line x1="12" y1="8" x2="12" y2="12"/>',
          '<line x1="12" y1="16" x2="12.01" y2="16"/>',
        '</svg>',
      '</div>',

      '<h2 id="idleTitle" style="font-size:1.2rem;font-weight:700;margin-bottom:.5rem;font-family:var(--font-display,inherit)">',
        'Sesión por expirar',
      '</h2>',
      '<p style="font-size:.9rem;color:var(--color-text-muted,#666);margin-bottom:1.5rem;line-height:1.5">',
        'Por inactividad, tu sesión se cerrará en',
      '</p>',

      '<div style="position:relative;display:inline-flex;align-items:center;justify-content:center;margin-bottom:1.5rem">',
        '<svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">',
          '<circle cx="40" cy="40" r="34" fill="none" stroke="var(--color-surface-offset,#eee)" stroke-width="6"/>',
          '<circle id="idleRingArc" cx="40" cy="40" r="34" fill="none"',
            ' stroke="var(--color-primary,#01696f)" stroke-width="6"',
            ' stroke-linecap="round"',
            ' stroke-dasharray="213.6" stroke-dashoffset="0"',
            ' transform="rotate(-90 40 40)"',
            ' style="transition:stroke-dashoffset 1s linear,stroke .4s"/>',
        '</svg>',
        '<span id="idleCount" style="',
          'position:absolute;font-size:1.6rem;font-weight:800;',
          'font-family:var(--font-display,inherit);',
          'color:var(--color-primary,#01696f);letter-spacing:-.02em">',
          WARN_SEC,
        '</span>',
      '</div>',

      '<p style="font-size:.78rem;color:var(--color-text-faint,#aaa);margin-bottom:1.75rem">segundos</p>',

      '<div style="display:flex;gap:.75rem;justify-content:center">',
        '<button id="idleBtnContinuar" style="',
          'padding:.6rem 1.5rem;background:var(--color-primary,#01696f);color:#fff;',
          'border:none;border-radius:var(--radius-md,8px);font-weight:600;',
          'font-size:.9rem;cursor:pointer;transition:background 180ms">',
          'Continuar sesión',
        '</button>',
        '<button id="idleBtnSalir" style="',
          'padding:.6rem 1.2rem;background:transparent;',
          'color:var(--color-text-muted,#666);',
          'border:1px solid var(--color-border,#ddd);',
          'border-radius:var(--radius-md,8px);font-size:.9rem;',
          'cursor:pointer;transition:background 180ms">',
          'Cerrar sesión',
        '</button>',
      '</div>',

      '</div>' // #idleCard
    ].join('');

    document.body.appendChild(overlay);
    document.getElementById('idleBtnContinuar').addEventListener('click', extenderSesion);
    document.getElementById('idleBtnSalir').addEventListener('click', cerrarSesion);
  }

  // ── Mostrar / ocultar ─────────────────────────────────────────────────────
  function mostrarModal() {
    modalVisible = true;
    const overlay = document.getElementById('idleOverlay');
    const card    = document.getElementById('idleCard');
    if (!overlay) return;
    overlay.style.pointerEvents = 'all';
    overlay.offsetHeight;
    overlay.style.opacity = '1';
    if (card) card.style.transform = 'translateY(0)';
    setTimeout(function () {
      var btn = document.getElementById('idleBtnContinuar');
      if (btn) btn.focus();
    }, 260);
  }

  function ocultarModal() {
    modalVisible = false;
    var overlay = document.getElementById('idleOverlay');
    var card    = document.getElementById('idleCard');
    if (!overlay) return;
    overlay.style.opacity = '0';
    if (card) card.style.transform = 'translateY(12px)';
    setTimeout(function () { overlay.style.pointerEvents = 'none'; }, 260);
  }

  // ── Countdown ─────────────────────────────────────────────────────────────
  var CIRCUNFERENCIA = 2 * Math.PI * 34; // ≈ 213.6

  function iniciarCountdown() {
    countRestante = WARN_SEC;
    actualizarUI();
    clearInterval(countTimer);
    countTimer = setInterval(function () {
      countRestante--;
      actualizarUI();
      if (countRestante <= 0) {
        clearInterval(countTimer);
        cerrarSesion();
      }
    }, 1000);
  }

  function actualizarUI() {
    var numEl = document.getElementById('idleCount');
    var arcEl = document.getElementById('idleRingArc');
    if (numEl) numEl.textContent = countRestante;
    if (arcEl) {
      var progreso   = countRestante / WARN_SEC;
      var dashOffset = CIRCUNFERENCIA * (1 - progreso);
      arcEl.style.strokeDashoffset = dashOffset;
      var color;
      if (countRestante > WARN_SEC * 0.5) {
        color = 'var(--color-primary,#01696f)';
      } else if (countRestante > WARN_SEC * 0.2) {
        color = 'var(--color-warning,#e67e22)';
      } else {
        color = 'var(--color-error,#c0392b)';
      }
      arcEl.style.stroke = color;
      if (numEl) numEl.style.color = color;
    }
  }

  // ── Acciones ──────────────────────────────────────────────────────────────
  function extenderSesion() {
    clearInterval(countTimer);
    ocultarModal();
    resetIdle();
  }

  function cerrarSesion() {
    clearInterval(countTimer);
    clearTimeout(idleTimer);
    localStorage.removeItem('token');
    sessionStorage.removeItem('texpro_user');
    window.location.href = LOGIN_URL;
  }

  // ── Reset timer ───────────────────────────────────────────────────────────
  function resetIdle() {
    if (modalVisible) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      crearModal();
      mostrarModal();
      iniciarCountdown();
    }, IDLE_MS);
  }

  // ── Listeners de actividad ────────────────────────────────────────────────
  ['mousemove','mousedown','keydown','scroll','touchstart','wheel'].forEach(function (ev) {
    window.addEventListener(ev, resetIdle, { passive: true });
  });

  // ── Arranque ──────────────────────────────────────────────────────────────
  crearModal();
  resetIdle();

})();
