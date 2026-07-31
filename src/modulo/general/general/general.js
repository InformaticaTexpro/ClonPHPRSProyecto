'use strict';

(function () {
  function token() {
    return localStorage.getItem('token') || '';
  }

  function getSessionUser() {
    const candidates = [
      sessionStorage.getItem('texpro_user'),
      localStorage.getItem('user'),
      localStorage.getItem('usuario'),
    ].filter(Boolean);

    for (const raw of candidates) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch {
        // Ignore malformed session payloads.
      }
    }

    return null;
  }

  function initialsFromText(value, fallback = 'T') {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return fallback;

    const parts = cleaned.split(' ').filter(Boolean);
    const initials = parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
    return initials || fallback;
  }

  function displayNameFromUser(user) {
    return String(user?.nombre || user?.email || user?.area || 'General').trim();
  }

  function applyUser(user) {
    const nombre = displayNameFromUser(user);
    const area = String(user?.area || 'General').trim() || 'General';
    const avatar = initialsFromText(nombre, 'T');

    const userName = document.getElementById('userName');
    const userArea = document.getElementById('userArea');
    const userAvatar = document.getElementById('userAvatar');
    const chipAvatar = document.getElementById('chipAvatar');
    const chipName = document.getElementById('chipName');

    if (userName) userName.textContent = nombre;
    if (userArea) userArea.textContent = area;
    if (userAvatar) userAvatar.textContent = avatar;
    if (chipAvatar) chipAvatar.textContent = avatar;
    if (chipName) chipName.textContent = nombre.split(' ')[0] || 'General';
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.title = 'Texpro - General';

    const headerDate = document.getElementById('headerDate');
    if (headerDate) {
      headerDate.textContent = new Date().toLocaleDateString('es-CL', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      });
    }

    document.getElementById('btnLogout')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      window.location.href = '../../varios/login/index.html';
    });

    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper')?.classList.toggle('main-wrapper--expanded');
    });

    document.getElementById('headerMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--open');
    });

    const fallbackUser = getSessionUser();
    if (fallbackUser) applyUser(fallbackUser);

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      const user = data?.user || data?.usuario || data || {};

      if (user && typeof user === 'object') {
        applyUser(user);
      }
    } catch (err) {
      console.warn('[General] no se pudo cargar sesión:', err.message);
    }
  });
})();
