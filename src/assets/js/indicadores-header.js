'use strict';

/**
 * indicadores-header.js — RSProyecto Texpro
 *
 * - Carga USD y UF desde /api/indicadores y los muestra en #headerIndicadores.
 * - Fusiona ventas asignadas con ventas del mes solo en el Dashboard principal.
 * - Activa auto-refresh global de filtros mes/año reutilizando #btnActualizar,
 *   por lo que cada pantalla mantiene su overlay "Cargando datos..." actual.
 
 * - Agrega el acceso al módulo Gerencia en el sidebar para usuarios administradores.

 * - Carga la sidebar central por módulos desplegables cuando existe #sidebarNav.
 */

(function () {

  const REFRESH_MS = 5 * 60 * 1000;
  const originalFetch = window.fetch.bind(window);

  function debeFusionarVentasAsignadas() {
    return window.location.pathname.includes('/src/modulo/ventas/dashboard/');
  }

  function fmt(valor, decimales) {
    if (valor == null || Number.isNaN(Number(valor))) return '—';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }).format(Number(valor));
  }

  function getToken() {
    return localStorage.getItem('token') || '';
  }

  function formatFechaCL(fecha) {
    if (!fecha) return '—';
    const s = String(fecha).substring(0, 10);
    const parts = s.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return s;
  }

  function buildAssignedRows(compartidos) {
    return (compartidos || []).map(row => ({
      Folio: row.folio,
      fecha_formato: formatFechaCL(row.fecha),
      cliente: row.cliente || '',
      CodVendedor: row.cod_vendedor_principal || row.cod_vendedor_compartido || '',
      Tipo: 'F',
      monto: Number(row.monto_asignado || row.monto || 0),
      venta_real_folio: Number(row.monto_neto || row.monto_asignado || 0),
      TotLineaReal: Number(row.monto_asignado || row.monto || 0),
      pct_descuento: 0,
      es_compartido: true,
      es_asignado: true,
      monto_asignado: Number(row.monto_asignado || row.monto || 0),
      porcentaje_asignado: Number(row.porcentaje || 0),
      cod_vendedor_principal: row.cod_vendedor_principal,
      cod_vendedor_compartido: row.cod_vendedor_compartido,
      nombre_vendedor_compartido: row.nombre_vendedor_compartido,
    }));
  }

  function dedupeVentas(ventas) {
    const map = new Map();
    for (const venta of ventas || []) {
      const key = `${venta.Folio || venta.folio}|${venta.es_asignado ? 'asignado' : 'propio'}|${venta.cod_vendedor_compartido || ''}`;
      map.set(key, venta);
    }
    return Array.from(map.values());
  }

  async function fetchMergedVentasMes(input, init) {
    const res = await originalFetch(input, init);
    const clone = res.clone();

    try {
      if (!res.ok) return res;

      const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
      if (url.pathname !== '/api/dashboard/ventas-mes') return res;

      const data = await clone.json();
      if (!data.ok) return res;

      const qs = url.search || '';
      const resComp = await originalFetch(`/api/dashboard/compartidos${qs}`, init);
      if (!resComp.ok) return res;

      const compData = await resComp.json();
      if (!compData.ok) return res;

      const propias = data.ventas || [];
      const asignadas = buildAssignedRows(compData.compartidos || []);
      const merged = {
        ...data,
        ventas: dedupeVentas([...propias, ...asignadas]),
      };

      return new Response(JSON.stringify(merged), {
        status: res.status,
        statusText: res.statusText,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.warn('[ventas-mes asignadas] no se pudo fusionar:', err.message);
      return res;
    }
  }

  window.fetch = function patchedFetch(input, init) {
    try {
      const url = new URL(typeof input === 'string' ? input : input.url, window.location.origin);
      if (debeFusionarVentasAsignadas() && url.pathname === '/api/dashboard/ventas-mes') {
        return fetchMergedVentasMes(input, init);
      }
    } catch {
      // Mantener comportamiento original si no es una URL estándar.
    }
    return originalFetch(input, init);
  };

  function activarAutoRefreshFiltros() {
    const filtros = [
      document.getElementById('filtroMes'),
      document.getElementById('filtroAnio'),
    ].filter(Boolean);

    const boton = document.getElementById('btnActualizar');
    if (!filtros.length || !boton || boton.dataset.autoRefreshBound === '1') return;

    boton.dataset.autoRefreshBound = '1';
    let timer = null;

    const refrescar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!boton.disabled) boton.click();
      }, 150);
    };

    filtros.forEach(filtro => {
      filtro.addEventListener('change', refrescar);
    });
  }

  async function obtenerUsuarioActual() {
    const token = getToken();
    if (!token) return null;

    try {
      const res = await originalFetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return null;
      return data.user || null;
    } catch (err) {
      console.warn('[gerencia-menu] no se pudo validar usuario:', err.message);
      return null;
    }
  }

  function esAdmin(usuario) {
    return usuario?.is_admin === true || usuario?.is_admin === 1 || usuario?.is_admin === '1';
  }

  function insertarMenuGerencia() {
    const nav = document.getElementById('sidebarNav');
    if (!nav || nav.querySelector('[data-module="gerencia"]')) return false;

    const link = document.createElement('a');
    link.className = 'nav-item';
    link.href = '../../gerencia/index.html';
    link.dataset.module = 'gerencia';
    link.innerHTML = '<span style="font-size:1rem">📈</span><span class="nav-label">Gerencia</span>';

    const adminLink = Array.from(nav.querySelectorAll('.nav-item')).find(item =>
      item.textContent.trim().toLowerCase().includes('administración')
    );

    if (adminLink) nav.insertBefore(link, adminLink);
    else nav.appendChild(link);

    return true;
  }

  async function activarMenuGerenciaAdmin() {
  if (!debeFusionarVentasAsignadas()) return;

  const usuario = await obtenerUsuarioActual();
  if (!esAdmin(usuario)) return;

  let intentos = 0;
  const timer = setInterval(() => {
    intentos += 1;
    if (insertarMenuGerencia() || intentos >= 20) clearInterval(timer);
  }, 150);
}

function cargarSidebarModulos() {
  if (!document.getElementById('sidebarNav')) return;
  if (window.__APP_SIDEBAR_LOADED__) return;

  window.__APP_SIDEBAR_LOADED__ = true;
  const script = document.createElement('script');
  script.src = '/src/assets/js/app-sidebar.js?v=1.0.0';
  script.defer = true;
  document.head.appendChild(script);
}

  async function cargarIndicadores() {
    const el = document.getElementById('headerIndicadores');
    if (!el) return;

    try {
      const res = await originalFetch('/api/indicadores', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || 'HTTP ' + res.status);
      if (data.disponible === false) {
        el.innerHTML = '<span class="hind-error" title="Indicadores no disponibles temporalmente">USD/UF —</span>';
        el.title = 'Indicadores no disponibles temporalmente';
        return;
      }

      const horaActualiz = new Date(data.actualizadoEn || Date.now()).toLocaleTimeString('es-CL', {
        hour: '2-digit', minute: '2-digit',
      });

      el.innerHTML = `
        <span class="hind-item" title="USD/CLP — actualizado ${horaActualiz}">
          <span class="hind-label">USD</span>
          <span class="hind-valor hind-valor--usd">$${fmt(data.dolar?.valor, 2)}</span>
        </span>
        <span class="hind-sep" aria-hidden="true">|</span>
        <span class="hind-item" title="Unidad de Fomento — actualizado ${horaActualiz}">
          <span class="hind-label">UF</span>
          <span class="hind-valor hind-valor--uf">$${fmt(data.uf?.valor, 2)}</span>
        </span>
      `;
      el.title = `Fuente: ${data.fuente || 'indicadores'}${data.stale ? ' (caché)' : ''} | Última actualización: ${horaActualiz}`;
    } catch (err) {
      console.warn('[indicadores-header]', err.message);
      el.innerHTML = '<span class="hind-error" title="No se pudo consultar /api/indicadores">USD/UF —</span>';
    }
  }

  function init() {
    cargarSidebarModulos();
    cargarIndicadores();
    activarAutoRefreshFiltros();
    activarMenuGerenciaAdmin();
    setInterval(cargarIndicadores, REFRESH_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
