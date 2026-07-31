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
  const loginRouter = window.TEXPRO_LOGIN_ROUTER || {};
  const resolverRutaInicialUsuario = typeof loginRouter.resolverRutaInicialUsuario === 'function'
    ? loginRouter.resolverRutaInicialUsuario
    : function (user) {
      const menus = Array.isArray(user?.menus) ? user.menus : [];
      const normalizar = (valor) => String(valor || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const area = normalizar(user?.area);
      const rutas = {
        ventas: '/src/modulo/ventas/dashboard/index.html',
        venta: '/src/modulo/ventas/dashboard/index.html',
        vendedores: '/src/modulo/ventas/dashboard/index.html',
        comercial: '/src/modulo/ventas/dashboard/index.html',
        gerencia: '/src/modulo/ventas/dashboard/index.html',
        produccion: '/src/modulo/produccion/produccion/index.html',
        bodega: '/src/modulo/bodega/bodega/index.html',
        facturacion: '/src/modulo/facturacion/facturacion/index.html',
        rrhh: '/src/modulo/rrhh/rrhh/index.html',
        'recursos_humanos': '/src/modulo/rrhh/rrhh/index.html',
        general: '/src/modulo/general/general/index.html',
        contabilidad: '/src/modulo/contabilidad/contabilidad/index.html',
        cobranza: '/src/modulo/contabilidad/contabilidad/index.html',
        servicio_tecnico: '/src/modulo/servtecnico/servicio-tecnico/index.html',
        servicio: '/src/modulo/servtecnico/servicio-tecnico/index.html',
        'serv_tecnico': '/src/modulo/servtecnico/servicio-tecnico/index.html',
        administracion: '/src/modulo/admin/admin/index.html',
        admin: '/src/modulo/admin/admin/index.html',
      };
      const rutaPreferida = rutas[area];
      if (rutaPreferida && menus.some(menu => String(menu?.url || '') === rutaPreferida)) {
        return rutaPreferida;
      }

      const menusUtiles = menus
      .filter(menu => normalizar(menu?.codigo) !== 'alertas' && normalizar(menu?.codigo) !== 'mensajeria' && String(menu?.url || '').trim())
      .sort((a, b) => (Number(a?.orden ?? 0) - Number(b?.orden ?? 0)) || String(a?.nombre || '').localeCompare(String(b?.nombre || ''), 'es'));
      if (menusUtiles.length) return menusUtiles[0].url;

      return '/src/sin-acceso.html';
    };

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
      window.location.href = resolverRutaInicialUsuario(data.user);

    } catch (err) {
      console.error('[login] Error de red:', err);
      mostrarError('No se pudo conectar con el servidor. Intenta de nuevo.');
      setLoading(false);
    }
  });

  // ── Foco inicial ───────────────────────────────────────────────
  inputUsuario.focus();

})();
