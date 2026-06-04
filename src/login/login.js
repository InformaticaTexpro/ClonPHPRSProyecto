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
 *
 * Dependencia backend:
 *   /api/auth/login devuelve { ok, token, user, ... }
 *
 * Flujo:
 *   1. Valida campos (email + password)
 *   2. Llama a POST /api/auth/login con fetch
 *   3. Guarda sesión en sessionStorage
 *   4. Redirige al dashboard
 */

(function () {
  'use strict';

  // ── Configuración ────────────────────────────────────────────
  const API_BASE    = window.API_BASE || window.location.origin;
  const LOGIN_URL   = `${API_BASE}/api/auth/login`;
  const DASHBOARD_URL = '../modulo/ventas/dashboard/index.html';

  // ── Referencias DOM ───────────────────────────────────────
  const form         = document.getElementById('loginForm');
  const inputUsuario = document.getElementById('usuario');
  const inputPass    = document.getElementById('password');
  const btnLogin     = document.getElementById('btnLogin');
  const btnText      = btnLogin.querySelector('.btn-text');
  const btnLoader    = btnLogin.querySelector('.btn-loader');
  const errorBox     = document.getElementById('errorBox');
  const errorMsg     = document.getElementById('errorMsg');
  const togglePass   = document.getElementById('togglePass');

  // ── Utilidades ────────────────────────────────────────────────
  function mostrarError(msg) {
    errorMsg.textContent = msg;
    errorBox.hidden = false;
    errorBox.setAttribute('role', 'alert');
    inputUsuario.setAttribute('aria-invalid', 'true');
    inputPass.setAttribute('aria-invalid', 'true');
  }

  function limpiarError() {
    errorBox.hidden = true;
    errorMsg.textContent = '';
    inputUsuario.removeAttribute('aria-invalid');
    inputPass.removeAttribute('aria-invalid');
  }

  function setLoading(on) {
    btnLogin.disabled = on;
    btnText.hidden    = on;
    btnLoader.hidden  = !on;
  }

  // ── Toggle visibilidad password ───────────────────────────────
  if (togglePass) {
    togglePass.addEventListener('click', () => {
      const isText = inputPass.type === 'text';
      inputPass.type = isText ? 'password' : 'text';
      togglePass.setAttribute('aria-label', isText ? 'Mostrar contraseña' : 'Ocultar contraseña');
      const iconShow = togglePass.querySelector('.icon-show');
      const iconHide = togglePass.querySelector('.icon-hide');
      if (iconShow && iconHide) {
        iconShow.hidden = !isText;
        iconHide.hidden = isText;
      }
    });
  }

  // ── Limpiar error al escribir ─────────────────────────────────
  [inputUsuario, inputPass].forEach(el =>
    el.addEventListener('input', limpiarError)
  );

  // ── Submit ─────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limpiarError();

    const usuario  = inputUsuario.value.trim();
    const password = inputPass.value;

    // Validación básica frontend
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
      try {
        data = await res.json();
      } catch {
        throw new Error('Respuesta inesperada del servidor.');
      }

      if (!res.ok || !data.ok) {
        mostrarError(data.error || 'Credenciales incorrectas.');
        setLoading(false);
        return;
      }

      // ── Guardar sesión ──────────────────────────────────────────
      if (data.token) {
        localStorage.setItem('token', data.token);
      }
      if (data.user) {
        sessionStorage.setItem('texpro_user', JSON.stringify(data.user));
      }

      // ── Redirigir al dashboard ──────────────────────────────────
      window.location.href = DASHBOARD_URL;

    } catch (err) {
      console.error('[login] Error de red:', err);
      mostrarError('No se pudo conectar con el servidor. Intenta de nuevo.');
      setLoading(false);
    }
  });

  // ── Foco inicial ───────────────────────────────────────────────
  inputUsuario.focus();

})();
