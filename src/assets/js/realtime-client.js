'use strict';

(function () {
  if (window.GICOTEXRealtime) return;

  const POLL_MS = 60 * 1000;
  const TOAST_WRAP_ID = 'gicotexRealtimeToasts';
  const REALTIME_STYLE_ID = 'gicotexRealtimeStyles';

  const state = {
    pollTimer: null,
  };

  function getToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  }

  function getHeaders() {
    const token = getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function ensureStyles() {
    if (document.getElementById(REALTIME_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = REALTIME_STYLE_ID;
    style.textContent = `
      .gicotex-toast-wrap {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 4000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      }
      .gicotex-toast {
        min-width: 260px;
        max-width: 360px;
        background: rgba(10, 16, 25, 0.96);
        color: #fff;
        border-radius: 16px;
        padding: 12px 14px;
        box-shadow: 0 18px 36px rgba(0, 0, 0, 0.22);
        border: 1px solid rgba(255, 255, 255, 0.08);
        pointer-events: auto;
      }
      .gicotex-toast__title {
        font-weight: 800;
        font-size: 0.92rem;
        margin: 0 0 4px;
      }
      .gicotex-toast__body {
        font-size: 0.83rem;
        line-height: 1.35;
        color: rgba(255, 255, 255, 0.9);
        margin: 0;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureToastWrap() {
    ensureStyles();
    let wrap = document.getElementById(TOAST_WRAP_ID);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = TOAST_WRAP_ID;
      wrap.className = 'gicotex-toast-wrap';
      document.body.appendChild(wrap);
    }
    return wrap;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(title, body) {
    const wrap = ensureToastWrap();
    const toast = document.createElement('div');
    toast.className = 'gicotex-toast';
    toast.innerHTML = `
      <div class="gicotex-toast__title">${escapeHtml(title)}</div>
      <p class="gicotex-toast__body">${escapeHtml(body)}</p>
    `;
    wrap.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      toast.style.transition = 'opacity .2s ease, transform .2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  function setBadge(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const total = Number(value || 0);
    if (total > 0) {
      el.textContent = total > 99 ? '99+' : String(total);
      el.style.display = 'flex';
    } else {
      el.textContent = '0';
      el.style.display = 'none';
    }
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...getHeaders(),
      },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }

  async function refreshChatBadge() {
    try {
      const data = await fetchJson('/api/mensajeria/no-leidos');
      const total = Number(data?.data?.total || 0);
      setBadge('unreadHeaderCount', total);
      setBadge('texproMensajeriaBadge', total);
    } catch (err) {
      console.warn('[realtime] chat badge:', err.message);
    }
  }

  async function refreshAlertBadge() {
    try {
      const data = await fetchJson('/api/alertas/badge');
      const total = Number(data?.total || 0);
      setBadge('navBadgeAlertas', total);
      setBadge('texproAlertasCampanaBadge', total);
    } catch (err) {
      console.warn('[realtime] alert badge:', err.message);
    }
  }

  async function syncBadges() {
    await Promise.all([refreshChatBadge(), refreshAlertBadge()]);
  }

  async function syncPresence() {
    const apis = [window.GICOTEXMensajeriaRealtime, window.GICOTEXMensajeriaWidgetRealtime].filter(Boolean);
    await Promise.all(apis.map(api => (typeof api.refreshPresence === 'function' ? api.refreshPresence() : Promise.resolve())));
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = setInterval(syncBadges, POLL_MS);
  }

  function stopPolling() {
    if (!state.pollTimer) return;
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  async function connect() {
    return null;
  }

  async function init() {
    await syncBadges();
    await syncPresence();
    startPolling();
  }

  window.GICOTEXRealtime = {
    connect,
    syncBadges,
    showToast,
    refreshChatBadge,
    refreshAlertBadge,
    syncPresence,
    startPolling,
    stopPolling,
    isConnected: () => false,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
