'use strict';

(function () {
  const DEMO = {
    pendiente: 184500000, vencido: 42800000, diasCobro: 38, facturasVencidas: 57,
    antiguedad: { tramos: ['0–30 días', '31–60 días', '61–90 días', '+90 días'], montos: [141700000, 18500000, 12800000, 11500000] },
    evolucion: { pendiente: [162000000, 175000000, 168000000, 192000000, 181000000, 184500000], cobrado: [142000000, 153000000, 159000000, 166000000, 172000000, 169000000] },
  };
  const money = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
  document.getElementById('headerDate').textContent = new Intl.DateTimeFormat('es-CL', { dateStyle: 'long' }).format(new Date());
  document.getElementById('collectionKpis').innerHTML = [
    ['Total pendiente de cobro', money(DEMO.pendiente), 'Saldo de cartera', 'mint'],
    ['Total vencido', money(DEMO.vencido), 'Fuera de plazo', 'amber'],
    ['Días promedio de cobro', `${DEMO.diasCobro} días`, 'Tiempo de recuperación', 'blue'],
    ['Facturas vencidas', DEMO.facturasVencidas, 'Documentos pendientes', 'rose'],
  ].map(([label, value, caption, color]) => `<article class="collection-kpi collection-kpi--${color}"><span>${label}</span><strong>${value}</strong><small>${caption}</small></article>`).join('');
  if (!window.Chart) {
    document.getElementById('chartStatus').textContent = 'No fue posible cargar los gráficos. Los indicadores contienen datos demostrativos.';
    return;
  }
  Chart.defaults.font.family = "'Open Sans', sans-serif";
  Chart.defaults.color = '#64748b';
  const axis = { border: { display: false }, grid: { color: '#edf2f5' }, ticks: { callback: value => `$${Number(value) / 1000000} M` } };
  const tooltip = { callbacks: { label: item => `${item.dataset.label}: ${money(item.raw)}` } };
  new Chart(document.getElementById('debtAgeChart'), {
    type: 'bar', data: { labels: DEMO.antiguedad.tramos, datasets: [{ label: 'Pendiente', data: DEMO.antiguedad.montos, backgroundColor: ['#00a885', '#45b7d1', '#f5a623', '#e78182'], borderRadius: 7, maxBarThickness: 62 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip }, scales: { x: { grid: { display: false }, border: { display: false } }, y: { ...axis, beginAtZero: true } } },
  });
  const today = new Date();
  const months = Array.from({ length: 6 }, (_, i) => new Date(today.getFullYear(), today.getMonth() - 5 + i, 1).toLocaleDateString('es-CL', { month: 'short' }));
  new Chart(document.getElementById('collectionEvolutionChart'), {
    type: 'line', data: { labels: months, datasets: [
      { label: 'Pendiente', data: DEMO.evolucion.pendiente, borderColor: '#00a885', backgroundColor: '#00a88514', fill: true, tension: .3, pointRadius: 4 },
      { label: 'Cobrado', data: DEMO.evolucion.cobrado, borderColor: '#36a7cd', tension: .3, pointRadius: 4 },
    ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 22 } }, tooltip }, scales: { x: { grid: { display: false }, border: { display: false } }, y: axis } },
  });
})();
