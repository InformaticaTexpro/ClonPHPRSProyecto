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
  const DASHBOARD_URL = '../dashboard/index.html';

  // ── Referencias DOM ───────────────────────────────────────
  const form         = document.getElementById('loginForm');
  const inputUsuario = document.getElementById('usuario');
  const inputPass    = document.getElementById('password');
  const btnLogin     = document.getElementById('btnLogin');
  const btnText      = btnLogin.querySelector('.btn-text');
  const btnLoader    = document.getElementById('btnLoader');
  const alertError   = document.getElementById('alertError');
  const alertMsg     = document.getElementById('alertErrorMsg');
  const togglePass   = document.getElementById('togglePassword');
  const iconEye      = document.getElementById('icon-eye');
  const iconEyeOff   = document.getElementById('icon-eye-off');

  // ── Toggle mostrar/ocultar contraseña ─────────────────────
  togglePass.addEventListener('click', () => {
    const isPassword = inputPass.type === 'password';
    inputPass.type = isPassword ? 'text' : 'password';
    iconEye.style.display    = isPassword ? 'none'  : 'block';
    iconEyeOff.style.display = isPassword ? 'block' : 'none';
    togglePass.setAttribute('aria-label', isPassword ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });

  // ── Limpiar errores al escribir ─────────────────────────
  inputUsuario.addEventListener('input', () => clearFieldError('usuario'));
  inputPass.addEventListener('input',    () => clearFieldError('password'));

  // ── Validación de campos ──────────────────────────────
  function validateFields() {
    let valid = true;
    const email = inputUsuario.value.trim();
    const pass  = inputPass.value.trim();

    if (!email) {
      setFieldError('usuario', 'El correo es requerido.');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFieldError('usuario', 'Ingresa un correo válido.');
      valid = false;
    }

    if (!pass) {
      setFieldError('password', 'La contraseña es requerida.');
      valid = false;
    } else if (pass.length < 3) {
      setFieldError('password', 'Mínimo 3 caracteres.');
      valid = false;
    }

    return valid;
  }

  function setFieldError(field, msg) {
    const input = document.getElementById(field);
    const error = document.getElementById('error-' + field);
    input.classList.add('is-error');
    if (error) error.textContent = msg;
  }

  function clearFieldError(field) {
    const input = document.getElementById(field);
    const error = document.getElementById('error-' + field);
    input.classList.remove('is-error');
    if (error) error.textContent = '';
    alertError.style.display = 'none';
  }

  // ── Estado de carga ──────────────────────────────────
  function setLoading(state) {
    btnLogin.disabled       = state;
    btnText.style.display   = state ? 'none' : 'flex';
    btnLoader.style.display = state ? 'flex' : 'none';
  }

  // ── Guardar sesión en sessionStorage ─────────────────────
  function saveSession(token, user) {
  localStorage.setItem('token', token);
  sessionStorage.setItem('texpro_user', JSON.stringify({
    id:         user.id,
    nombre:     user.nombre,
    email:      user.email,
    area:       user.area,
    codigo:     user.codigo,
    tema:       user.tema,
    is_admin:   user.is_admin,
    vendedores: user.vendedores || [],
    metas:      user.metas      || []
  }));
}


  // ── Submit del formulario ────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertError.style.display = 'none';

    if (!validateFields()) return;

    setLoading(true);

    try {
      const response = await fetch(LOGIN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email:    inputUsuario.value.trim().toLowerCase(),
          password: inputPass.value
        })
      });

      const data = await response.json();

      if (!response.ok) {
        const msg = data.error || 'Error de autenticación.';
        if (response.status === 403) {
          showAlert('Cuenta inactiva. Contacta a soporte.');
        } else {
          showAlert(msg);
        }
        return;
      }

      // ✅ Login exitoso
      saveSession(data.token, data.user);
      window.location.href = DASHBOARD_URL;

    } catch {
      showAlert('No se pudo conectar con el servidor. Verifica tu conexión.');
    } finally {
      setLoading(false);
    }
  });

  function showAlert(msg) {
    alertMsg.textContent = msg;
    alertError.style.display = 'flex';
  }

  // ── Enter en campo email pasa al password ────────────────
  inputUsuario.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputPass.focus();
    }
  });

})();
