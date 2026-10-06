'use strict';

(function () {
  const headerDate = document.getElementById('headerDate');
  if (!headerDate) return;

  headerDate.textContent = new Intl.DateTimeFormat('es-CL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(new Date());
})();
