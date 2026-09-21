'use strict';

(function () {
  const dashboardData = Object.freeze({
    kpis: [
      { label: 'Dotación Total', value: 86, tone: 'teal' },
      { label: 'Presentes Hoy', value: 74, tone: 'green' },
      { label: 'Ausentes', value: 4, tone: 'orange' },
      { label: 'Vacaciones', value: 5, tone: 'blue' },
      { label: 'Licencias', value: 3, tone: 'purple' },
    ],
    asistencia: [82, 80, 83, 81, 79, 84, 82, 83, 85, 81, 80, 84, 83, 82, 85, 84, 81, 83, 82, 86, 84, 83],
    areas: [
      { label: 'Producción', value: 32, color: '#0f766e' },
      { label: 'Comercial', value: 21, color: '#2563eb' },
      { label: 'Logística', value: 15, color: '#f59e0b' },
      { label: 'Administración', value: 11, color: '#8b5cf6' },
      { label: 'RRHH', value: 7, color: '#ec4899' },
    ],
    vacaciones: [
      { nombre: 'Camila Soto', area: 'Comercial', periodo: '23 sep — 04 oct' },
      { nombre: 'Diego Muñoz', area: 'Producción', periodo: '28 sep — 05 oct' },
      { nombre: 'Valentina Rojas', area: 'Logística', periodo: '07 oct — 18 oct' },
    ],
    cumpleanos: [
      { nombre: 'Paula Herrera', area: 'Administración', fecha: '08 sep' },
      { nombre: 'Tomás Silva', area: 'Producción', fecha: '19 sep' },
      { nombre: 'Fernanda Díaz', area: 'Comercial', fecha: '27 sep' },
    ],
  });
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function drawAttendance() {
    const canvas = $('rhdbAttendance'); if (!canvas) return;
    const width = Math.max(280, canvas.parentElement.getBoundingClientRect().width); const height = 250; const ratio = window.devicePixelRatio || 1; const pad = 28;
    canvas.width = width * ratio; canvas.height = height * ratio; canvas.style.width = '100%'; canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.strokeStyle = '#dce9e6'; ctx.lineWidth = 1;
    [0, 1, 2, 3].forEach(i => { const y = pad + i * ((height - pad * 2) / 3); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(width - pad, y); ctx.stroke(); });
    const values = dashboardData.asistencia; const min = Math.min(...values) - 2; const max = Math.max(...values) + 2;
    const points = values.map((value, i) => ({ x: pad + i * ((width - pad * 2) / (values.length - 1)), y: height - pad - ((value - min) / (max - min)) * (height - pad * 2) }));
    const fill = ctx.createLinearGradient(0, pad, 0, height); fill.addColorStop(0, 'rgba(15,118,110,.28)'); fill.addColorStop(1, 'rgba(15,118,110,0)');
    ctx.beginPath(); ctx.moveTo(points[0].x, height - pad); points.forEach(point => ctx.lineTo(point.x, point.y)); ctx.lineTo(points.at(-1).x, height - pad); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  }

  function drawAreas() {
    const canvas = $('rhdbAreas'); if (!canvas) return; const size = 220; const ratio = window.devicePixelRatio || 1;
    canvas.width = size * ratio; canvas.height = size * ratio; canvas.style.width = `${size}px`; canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); const total = dashboardData.areas.reduce((sum, row) => sum + row.value, 0); let angle = -Math.PI / 2;
    dashboardData.areas.forEach(row => { const arc = row.value / total * Math.PI * 2; ctx.beginPath(); ctx.arc(size / 2, size / 2, 84, angle, angle + arc); ctx.strokeStyle = row.color; ctx.lineWidth = 34; ctx.stroke(); angle += arc; });
    $('rhdbAreaTotal').textContent = total;
    $('rhdbAreaLegend').innerHTML = dashboardData.areas.map(row => `<div><i style="background:${row.color}"></i><span>${escapeHtml(row.label)}</span><strong>${row.value}</strong></div>`).join('');
  }

  function render() {
    $('rhdbKpis').innerHTML = dashboardData.kpis.map(row => `<article class="rhdb-kpi rhdb-kpi--${row.tone}"><span>${escapeHtml(row.label)}</span><strong>${row.value}</strong></article>`).join('');
    $('rhdbVacations').innerHTML = dashboardData.vacaciones.map(row => `<div class="rhdb-list-item"><b>${escapeHtml(row.nombre.split(' ').map(x => x[0]).join('').slice(0, 2))}</b><div><strong>${escapeHtml(row.nombre)}</strong><small>${escapeHtml(row.area)}</small></div><time>${escapeHtml(row.periodo)}</time></div>`).join('');
    $('rhdbBirthdays').innerHTML = dashboardData.cumpleanos.map(row => `<div class="rhdb-list-item"><b class="is-birthday">🎂</b><div><strong>${escapeHtml(row.nombre)}</strong><small>${escapeHtml(row.area)}</small></div><time>${escapeHtml(row.fecha)}</time></div>`).join('');
    drawAttendance(); drawAreas();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('headerDate').textContent = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    $('btnLogout')?.addEventListener('click', () => { localStorage.removeItem('token'); window.location.href = '../../varios/login/index.html'; });
    $('sidebarToggle')?.addEventListener('click', () => { $('sidebar')?.classList.toggle('sidebar--collapsed'); $('mainWrapper')?.classList.toggle('main-wrapper--expanded'); });
    $('headerMenuBtn')?.addEventListener('click', () => $('sidebar')?.classList.toggle('sidebar--open'));
    render(); let timer; window.addEventListener('resize', () => { clearTimeout(timer); timer = setTimeout(() => { drawAttendance(); drawAreas(); }, 120); });
  });
})();

if (false) {
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
}
