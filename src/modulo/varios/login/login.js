/**
 * login.js — RSProyecto Texpro
 * Frontend de autenticación conectado con POST /api/auth/login
 *
 * Entradas:
 *   - email y password ingresados por el usuario
 *
 * Salidas:
 *   - token JWT en localStorage
 *   - perfil resumido en sessionStorage (texpro_user)
 *   - perfil resumido en localStorage (user) para validaciones globales
 *
 * Dependencia backend:
 *   /api/auth/login devuelve { ok, token, user, ... }
 *
 * Flujo:
 *   1. Valida campos (email + password)
 *   2. Llama a POST /api/auth/login con fetch
 *   3. Guarda sesión del usuario autenticado
 *   4. Redirige al módulo principal según usuario.area
 */

(function () {
  'use strict';

  // ── Configuración ────────────────────────────────────────────
  const API_BASE  = window.API_BASE || window.location.origin;
  const LOGIN_URL = `${API_BASE}/api/auth/login`;

  const MODULOS_PRINCIPALES = {
    ventas: '../../ventas/dashboard/index.html',
    venta: '../../ventas/dashboard/index.html',
    vendedores: '../../ventas/dashboard/index.html',
    comercial: '../../ventas/dashboard/index.html',
    produccion: '../../produccion/produccion/index.html',
    bodega: '../../bodega/bodega/index.html',
    facturacion: '../../facturacion/facturacion/index.html',
    rrhh: '../../rrhh/rrhh/index.html',
    'recursos-humanos': '../../rrhh/rrhh/index.html',
    contabilidad: '../../contabilidad/contabilidad/index.html',
    cobranza: '../../contabilidad/contabilidad/index.html',
    'servicio-tecnico': '../../servtecnico/servicio-tecnico/index.html',
    servicio: '../../servtecnico/servicio-tecnico/index.html',
    'serv-tecnico': '../../servtecnico/servicio-tecnico/index.html',
    admin: '../../admin/admin/index.html',
    administracion: '../../admin/admin/index.html',
    gerencia: '../../ventas/dashboard/index.html',
  };

  const DASHBOARD_URL = '../../ventas/dashboard/index.html';

  // ── Referencias DOM ───────────────────────────────────────
  const form         = document.getElementById('loginForm');
  const inputUsuario = document.getElementById('usuario');
  const inputPass    = document.getElementById('password');
  const btnLogin     = document.getElementById('btnLogin');
  const btnText      = btnLogin.querySelector('.btn-text');
  const btnLoader    = document.getElementById('btnLoader');
  const alertError   = document.getElementById('alertError');
  const alertErrorMsg= document.getElementById('alertErrorMsg');
  const togglePass   = document.getElementById('togglePassword');

  // ── Toggle password ────────────────────────────────────────
  togglePass.addEventListener('click', () => {
    const isPassword = inputPass.type === 'password';
    inputPass.type = isPassword ? 'text' : 'password';
    document.getElementById('icon-eye').style.display     = isPassword ? 'none'  : 'block';
    document.getElementById('icon-eye-off').style.display = isPassword ? 'block' : 'none';
    togglePass.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });

  // ── Helpers UI ───────────────────────────────────────────────
  function mostrarError(msg) {
    alertErrorMsg.textContent = msg;
    alertError.style.display  = 'flex';
    document.getElementById('group-usuario').classList.add('error');
    document.getElementById('group-password').classList.add('error');
  }

  function limpiarError() {
    alertError.style.display  = 'none';
    alertErrorMsg.textContent = '';
    document.getElementById('group-usuario').classList.remove('error');
    document.getElementById('group-password').classList.remove('error');
  }

  function setLoading(state) {
    btnLogin.disabled       = state;
    btnText.style.display   = state ? 'none' : 'flex';
    btnLoader.style.display = state ? 'flex' : 'none';
  }

  function normalizarArea(area) {
    return String(area || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

  function getModuloPrincipal(user) {
    const area = normalizarArea(user?.area);
    if (area === 'admin' || area === 'administracion') {
      return DASHBOARD_URL;
    }
    if (!MODULOS_PRINCIPALES[area] && user?.is_admin) {
      return DASHBOARD_URL;
    }
    return MODULOS_PRINCIPALES[area] || DASHBOARD_URL;
  }

  function guardarUsuario(user) {
    if (!user) return;
    const payload = JSON.stringify(user);
    sessionStorage.setItem('texpro_user', payload);
    localStorage.setItem('user', payload);
    localStorage.setItem('usuario', payload);
  }

  // ── Limpiar error al escribir ───────────────────────────────
  [inputUsuario, inputPass].forEach(el =>
    el.addEventListener('input', limpiarError)
  );

  // ── Submit ─────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limpiarError();

    const usuario  = inputUsuario.value.trim();
    const password = inputPass.value;

    if (!usuario || !password) {
      mostrarError('Por favor ingresa usuario y contraseña.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(LOGIN_URL, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ usuario, password }),
      });

      let data;
      try { data = await res.json(); }
      catch { throw new Error('Respuesta inesperada del servidor.'); }

      if (!res.ok || !data.ok) {
        const mensajeFallback = res.status === 429
          ? 'Demasiados intentos. Intenta nuevamente en unos minutos.'
          : 'Credenciales incorrectas o usuario inactivo.';
        mostrarError(data.error || mensajeFallback);
        setLoading(false);
        return;
      }

      // ── Guardar sesión ──────────────────────────────────────────
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('usuario');
      sessionStorage.removeItem('texpro_user');
      if (data.token) localStorage.setItem('token', data.token);
      guardarUsuario(data.user);

      // ── Redirigir al módulo principal ───────────────────────────
      window.location.href = getModuloPrincipal(data.user);

    } catch (err) {
      console.error('[login] Error de red:', err);
      mostrarError('No se pudo conectar con el servidor. Intenta de nuevo.');
      setLoading(false);
    }
  });

  // ── Foco inicial ───────────────────────────────────────────────
  inputUsuario.focus();

})();
