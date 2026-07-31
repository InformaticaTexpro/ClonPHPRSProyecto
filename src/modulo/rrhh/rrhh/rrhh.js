'use strict';

(function () {
  function token() {
    return localStorage.getItem('token') || '';
  }

  function initialsFromText(value, fallback = 'T') {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) return fallback;
    const parts = cleaned.split(' ').filter(Boolean);
    const initials = parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
    return initials || fallback;
  }

  function displayNameFromUser(user) {
    return String(user?.nombre || user?.email || user?.area || 'RRHH').trim();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.title = 'Texpro - RRHH';

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

    document.getElementById('btnActualizarVista')?.addEventListener('click', () => {
      window.location.reload();
    });

    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--collapsed');
      document.getElementById('mainWrapper')?.classList.toggle('main-wrapper--expanded');
    });

    document.getElementById('headerMenuBtn')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('sidebar--open');
    });

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token()}` },
      });
      const data = await res.json();
      const user = data?.user || data?.usuario || data || {};

      const nombre = displayNameFromUser(user);
      const area = String(user?.area || 'RRHH').trim() || 'RRHH';
      const avatar = initialsFromText(nombre, 'T');
      const userName = document.getElementById('userName');
      const userArea = document.getElementById('userArea');
      const avatarEl = document.getElementById('userAvatar');

      if (userName) userName.textContent = nombre;
      if (userArea) userArea.textContent = area;
      if (avatarEl) avatarEl.textContent = avatar;
      const chipAvatar = document.getElementById('chipAvatar');
      const chipName = document.getElementById('chipName');
      if (chipAvatar) chipAvatar.textContent = avatar;
      if (chipName) chipName.textContent = nombre.split(' ')[0] || 'RRHH';
    } catch (err) {
      console.warn('[RRHH] no se pudo cargar sesión:', err.message);
    }
  });
})();
