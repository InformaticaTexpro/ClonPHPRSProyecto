'use strict';

/**
 * Gestor central de expiración absoluta de sesión. No observa inactividad.
 * Los plazos vienen del JWT firmado por PHP; el cliente solo programa la interfaz.
 */
(function () {
  if (window.TexproSession || !localStorage.getItem('token')) return;
  const LOGIN_URL = window.TEXPRO_LOGIN_URL || window.location.origin + '/src/modulo/varios/login/index.php';
  const rawFetch = window.fetch.bind(window);
  const halted = new Promise(() => {}); // Una sesión terminada no entrega errores funcionales a los módulos.
  const inertStates = new Map();
  let timer = null, ended = false, modalVisible = false, refreshing = null, previousFocus = null;

  function readSession(token) {
    try {
      const body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(body.padEnd(Math.ceil(body.length / 4) * 4, '=')));
      if (!Number.isFinite(claims.exp)) return null;
      // Compatibilidad con JWT anteriores: solo su último minuto; nunca se alarga su exp.
      const warningAt = Number.isFinite(claims.session_warning_at) ? claims.session_warning_at : claims.exp - 60;
      if (warningAt > claims.exp) return null;
      return { warningAt: warningAt * 1000, expiresAt: claims.exp * 1000 };
    } catch { return null; }
  }

  function crearModal() {
    if (document.getElementById('idleOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'idleOverlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'idleTitle');
    overlay.setAttribute('aria-describedby', 'idleDescription idleError');
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
        'padding:clamp(1rem,4vw,2rem);max-height:90vh;overflow-y:auto;box-sizing:border-box;',
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
        'Tu sesión está por finalizar',
      '</h2>',
      '<p id="idleDescription" style="font-size:.9rem;color:var(--color-text-muted,#666);margin-bottom:1.5rem;line-height:1.5">',
        'Por seguridad, tu sesión se cerrará automáticamente si no confirmas que deseas continuar.',
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
          0,
        '</span>',
      '</div>',

      '<p style="font-size:.78rem;color:var(--color-text-faint,#aaa);margin-bottom:1.75rem">segundos</p>',

      '<p id="idleError" role="status" style="font-size:.85rem;color:#a53b31"></p><div style="display:flex;gap:.75rem;justify-content:center;flex-wrap:wrap">',
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
    document.getElementById('idleBtnContinuar').addEventListener('click', refresh);
    document.getElementById('idleBtnSalir').addEventListener('click', () => logout('closed'));
  }


  function showWarning() {
    crearModal();
    const overlay = document.getElementById('idleOverlay');
    if (!modalVisible) {
      previousFocus = document.activeElement;
      for (const child of document.body.children) if (child !== overlay) { inertStates.set(child, child.inert); child.inert = true; }
      modalVisible = true;
      document.getElementById('idleBtnContinuar').focus();
    }
    overlay.setAttribute('aria-hidden', 'false'); overlay.style.pointerEvents = 'all'; overlay.style.opacity = '1';
    document.getElementById('idleCard').style.transform = 'translateY(0)';
  }
  function hideWarning() {
    if (!modalVisible) return;
    const overlay = document.getElementById('idleOverlay');
    overlay.setAttribute('aria-hidden', 'true'); overlay.style.pointerEvents = 'none'; overlay.style.opacity = '0';
    for (const [child, inert] of inertStates) child.inert = inert;
    inertStates.clear(); modalVisible = false; previousFocus?.focus?.();
  }
  function reschedule() {
    clearTimeout(timer);
    if (ended) return false;
    const token = localStorage.getItem('token'), session = readSession(token || '');
    if (!token || !session) { logout('expired'); return false; }
    const now = Date.now(), remaining = session.expiresAt - now;
    if (remaining <= 0 && !refreshing) { logout('expired'); return false; }
    if (now >= session.warningAt) {
      showWarning();
      document.getElementById('idleCount').textContent = String(Math.max(0, Math.ceil(remaining / 1000)));
      const ratio = Math.max(0, Math.min(1, remaining / (session.expiresAt - session.warningAt || 1)));
      document.getElementById('idleRingArc').style.strokeDashoffset = 213.6 * (1 - ratio);
      timer = setTimeout(reschedule, Math.max(1, Math.min(1000, remaining > 0 ? remaining : 1000)));
    } else {
      hideWarning();
      // 30 días exceden el máximo de setTimeout de varios navegadores.
      timer = setTimeout(reschedule, Math.min(session.warningAt - now, 2147483647));
    }
    return remaining > 0;
  }
  function logout(reason = 'expired', notifyServer = true) {
    if (ended) return;
    ended = true; clearTimeout(timer); showWarning();
    document.getElementById('idleTitle').textContent = 'Sesión finalizada';
    document.getElementById('idleDescription').textContent = 'Tu sesión finalizó por seguridad. Vuelve a ingresar tus credenciales.';
    document.getElementById('idleCount').textContent = '0'; document.getElementById('idleError').textContent = '';
    document.getElementById('idleBtnContinuar').disabled = true; document.getElementById('idleBtnSalir').disabled = true;
    for (const key of ['token', 'user', 'usuario']) localStorage.removeItem(key);
    sessionStorage.removeItem('texpro_user');
    const url = new URL(LOGIN_URL, window.location.href);
    url.searchParams.set('session', reason === 'closed' ? 'closed' : 'expired'); url.searchParams.set('logout', '1');
    let redirected = false;
    const redirect = () => { if (!redirected) { redirected = true; window.location.replace(url.href); } };
    // El GET de login también limpia la cookie si la red impide completar este POST.
    if (notifyServer) {
      rawFetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {}).finally(redirect);
      setTimeout(redirect, 1200);
    } else redirect();
  }
  function handleUnauthorized() { logout('expired'); return halted; }
  function refresh() {
    if (refreshing) return refreshing;
    if (ended) return halted;
    const token = localStorage.getItem('token'), session = readSession(token || '');
    if (!session || Date.now() >= session.expiresAt) return handleUnauthorized();
    refreshing = (async () => {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
      crearModal(); document.getElementById('idleBtnContinuar').disabled = true; document.getElementById('idleError').textContent = '';
      try {
        const response = await rawFetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', signal: controller.signal,
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
        if (response.status === 401) { logout('expired'); return false; }
        const data = await response.json();
        if (!response.ok || !data.ok || !readSession(data.token || '')) throw new Error('No fue posible renovar.');
        if (ended) { rawFetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(() => {}); return false; }
        // Otra pestaña puede haber renovado mientras esta petición estaba en tránsito.
        if (localStorage.getItem('token') !== token) return true;
        localStorage.setItem('token', data.token);
        if (data.user) {
          const user = JSON.stringify(data.user);
          localStorage.setItem('user', user); localStorage.setItem('usuario', user); sessionStorage.setItem('texpro_user', user);
        }
        return true;
      } catch {
        document.getElementById('idleError').textContent = 'No fue posible renovar la sesión. Inténtalo antes de que termine el plazo.';
        return false;
      } finally {
        clearTimeout(timeout); refreshing = null;
        if (!ended) { document.getElementById('idleBtnContinuar').disabled = false; reschedule(); }
      }
    })();
    return refreshing;
  }

  window.TexproSession = { refresh, logout, handleUnauthorized, reschedule, isEnded: () => ended };
  window.fetch = async function (input, init = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, window.location.href);
    const isApi = url.origin === window.location.origin && url.pathname.startsWith('/api/');
    if (!isApi || /^\/api\/auth\/(login|recuperar|verificar-otp|nueva-password|logout)$/.test(url.pathname)) return rawFetch(input, init);
    reschedule();
    if (ended) return halted;
    const current = readSession(localStorage.getItem('token') || '');
    if (refreshing && current && Date.now() >= current.expiresAt) await refreshing;
    if (ended) return halted;
    const headers = new Headers(init.headers || input.headers || {});
    // También actualiza módulos que capturaron un JWT anterior en una variable.
    if (/^Bearer\s/i.test(headers.get('Authorization') || '')) headers.set('Authorization', 'Bearer ' + (localStorage.getItem('token') || ''));
    const response = await rawFetch(input, { ...init, headers });
    if (ended) return halted;
    if (response.status === 401) return handleUnauthorized();
    return response;
  };
  document.addEventListener('visibilitychange', reschedule);
  window.addEventListener('pageshow', reschedule);
  window.addEventListener('focus', reschedule);
  window.addEventListener('storage', event => {
    if (event.key === 'token' || event.key === null) {
      if (!localStorage.getItem('token')) logout('expired', false);
      else reschedule();
    }
  });
  document.addEventListener('click', event => {
    if (event.target.closest?.('#btnLogout')) { event.preventDefault(); event.stopImmediatePropagation(); logout('closed'); }
  }, true);
  document.addEventListener('keydown', event => {
    if (!modalVisible) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); }
    if (event.key === 'Tab') {
      const buttons = ['idleBtnContinuar', 'idleBtnSalir'].map(id => document.getElementById(id)).filter(button => !button.disabled);
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reschedule, { once: true });
  else reschedule();
})();
