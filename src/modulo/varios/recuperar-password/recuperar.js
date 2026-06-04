// recuperar.js - RSProyecto Texpro
// Flujo de 3 pasos: Email -> Codigo OTP -> Nueva contraseña
// Conectado con API: /api/auth/recuperar, /verificar-otp, /nueva-password

(function () {
  'use strict';

  const API_BASE = window.API_BASE || window.location.origin;

  const steps     = [null, 'step1', 'step2', 'step3', 'step4'];
  const stepDots  = [null, 'stepDot1', 'stepDot2', 'stepDot3'];
  const stepLines = ['stepLine1', 'stepLine2'];

  let emailFlujo  = '';
  let resetToken  = '';

  function goToStep(next) {
    document.querySelectorAll('.step-content').forEach(el => el.classList.remove('active'));
    document.getElementById(steps[next]).classList.add('active');

    for (let i = 1; i <= 3; i++) {
      const dot = document.getElementById(stepDots[i]);
      if (i < next) {
        dot.classList.remove('active');
        dot.classList.add('done');
        if (i <= 2) document.getElementById(stepLines[i - 1]).classList.add('done');
      } else if (i === next) {
        dot.classList.add('active');
        dot.classList.remove('done');
      } else {
        dot.classList.remove('active', 'done');
      }
    }

    if (next === 4) {
      document.getElementById('stepsIndicator').style.display = 'none';
      document.getElementById('backLogin').style.display = 'none';
    }
  }

  document.getElementById('formStep1').addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('email');
    const errorEmail = document.getElementById('error-email');
    const btn        = document.getElementById('btnStep1');
    const loader     = document.getElementById('loaderStep1');
    const value      = emailInput.value.trim();

    if (!value) { setError(emailInput, errorEmail, 'El correo es requerido.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(emailInput, errorEmail, 'Ingresa un correo válido.'); return;
    }
    clearError(emailInput, errorEmail);
    setLoading(btn, loader, true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/recuperar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: value.toLowerCase() })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(emailInput, errorEmail, data.error || 'No se pudo enviar el código.');
        return;
      }

      emailFlujo = value.toLowerCase();
      document.getElementById('emailMostrado').textContent = maskEmail(value);
      goToStep(2);
      startResendTimer();
      document.getElementById('otp1').focus();
    } catch {
      setError(emailInput, errorEmail, 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(btn, loader, false);
    }
  });

  const otpInputs = Array.from({ length: 6 }, (_, i) => document.getElementById('otp' + (i + 1)));

  otpInputs.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val;
      if (val) { input.classList.add('is-filled'); if (idx < 5) otpInputs[idx + 1].focus(); }
      else { input.classList.remove('is-filled'); }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) otpInputs[idx - 1].focus();
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData('text')
        .replace(/[^0-9]/g, '').slice(0, 6);
      pasted.split('').forEach((digit, i) => {
        if (otpInputs[i]) { otpInputs[i].value = digit; otpInputs[i].classList.add('is-filled'); }
      });
      if (pasted.length === 6) otpInputs[5].focus();
    });
  });

  document.getElementById('formStep2').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otpValue = otpInputs.map(i => i.value).join('');
    const errorOtp = document.getElementById('error-otp');
    const btn      = document.getElementById('btnStep2');
    const loader   = document.getElementById('loaderStep2');

    if (otpValue.length < 6) {
      errorOtp.textContent = 'Ingresa los 6 dígitos del código.';
      otpInputs.forEach(i => i.classList.add('is-error')); return;
    }
    errorOtp.textContent = '';
    otpInputs.forEach(i => i.classList.remove('is-error'));
    setLoading(btn, loader, true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/verificar-otp`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: emailFlujo, otp: otpValue })
      });
      const data = await res.json();

      if (!res.ok) {
        errorOtp.textContent = data.error || 'Código incorrecto o expirado.';
        otpInputs.forEach(i => i.classList.add('is-error'));
        return;
      }

      resetToken = data.resetToken;
      goToStep(3);
      document.getElementById('newpass').focus();
    } catch {
      errorOtp.textContent = 'No se pudo conectar con el servidor.';
      otpInputs.forEach(i => i.classList.add('is-error'));
    } finally {
      setLoading(btn, loader, false);
    }
  });

  const newpassInput     = document.getElementById('newpass');
  const confirmpassInput = document.getElementById('confirmpass');

  newpassInput.addEventListener('input', () => {
    const strength = getStrength(newpassInput.value);
    const fill  = document.getElementById('strengthFill');
    const label = document.getElementById('strengthLabel');
    const levels = [
      { pct: '0%',   color: '',                     text: '' },
      { pct: '33%',  color: 'var(--color-danger)',  text: 'Débil' },
      { pct: '66%',  color: 'var(--color-warning)', text: 'Moderada' },
      { pct: '100%', color: 'var(--color-green)',   text: 'Segura' }
    ];
    const lvl = levels[strength];
    fill.style.width = lvl.pct; fill.style.background = lvl.color;
    label.textContent = lvl.text; label.style.color = lvl.color;
  });

  function getStrength(pass) {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 8)           score++;
    if (/[A-Z]/.test(pass))         score++;
    if (/[0-9]/.test(pass))         score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    return Math.min(score > 2 ? 3 : score > 1 ? 2 : 1, 3);
  }

  setupToggle('toggleNew',     'newpass',     'eyeNew',     'eyeNewOff');
  setupToggle('toggleConfirm', 'confirmpass', 'eyeConfirm', 'eyeConfirmOff');

  document.getElementById('formStep3').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newVal     = newpassInput.value;
    const confirmVal = confirmpassInput.value;
    const errorNew   = document.getElementById('error-newpass');
    const errorConf  = document.getElementById('error-confirmpass');
    const btn        = document.getElementById('btnStep3');
    const loader     = document.getElementById('loaderStep3');
    let valid        = true;

    if (!newVal || newVal.length < 8) {
      setError(newpassInput, errorNew, 'Mínimo 8 caracteres.'); valid = false;
    } else { clearError(newpassInput, errorNew); }

    if (!confirmVal) {
      setError(confirmpassInput, errorConf, 'Confirma tu contraseña.'); valid = false;
    } else if (newVal !== confirmVal) {
      setError(confirmpassInput, errorConf, 'Las contraseñas no coinciden.'); valid = false;
    } else { clearError(confirmpassInput, errorConf); }

    if (!valid) return;
    setLoading(btn, loader, true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/nueva-password`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ resetToken, password: newVal })
      });
      const data = await res.json();

      if (!res.ok) {
        setError(newpassInput, errorNew, data.error || 'No se pudo guardar. Intenta nuevamente.');
        return;
      }

      resetToken = '';
      goToStep(4);
    } catch {
      setError(newpassInput, errorNew, 'No se pudo conectar con el servidor.');
    } finally {
      setLoading(btn, loader, false);
    }
  });

  let timerInterval = null;

  function startResendTimer() {
    const btn   = document.getElementById('btnResend');
    const label = document.getElementById('resendTimer');
    let secs    = 60;
    btn.disabled = true;
    label.textContent = '(' + secs + 's)';
    timerInterval = setInterval(() => {
      secs--;
      label.textContent = '(' + secs + 's)';
      if (secs <= 0) {
        clearInterval(timerInterval);
        btn.disabled = false;
        label.textContent = '';
      }
    }, 1000);
  }

  document.getElementById('btnResend').addEventListener('click', async () => {
    startResendTimer();
    otpInputs.forEach(i => { i.value = ''; i.classList.remove('is-filled', 'is-error'); });
    otpInputs[0].focus();
    document.getElementById('error-otp').textContent = '';

    try {
      await fetch(`${API_BASE}/api/auth/recuperar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: emailFlujo })
      });
    } catch { /* silencioso */ }
  });

  function setError(input, span, msg) { input.classList.add('is-error'); span.textContent = msg; }
  function clearError(input, span) { input.classList.remove('is-error'); span.textContent = ''; }
  function setLoading(btn, loader, state) {
    btn.disabled = state;
    btn.querySelector('.btn-text').style.display = state ? 'none' : 'flex';
    loader.style.display = state ? 'flex' : 'none';
  }
  function setupToggle(btnId, inputId, eyeId, eyeOffId) {
    document.getElementById(btnId).addEventListener('click', () => {
      const inp = document.getElementById(inputId);
      const isPwd = inp.type === 'password';
      inp.type = isPwd ? 'text' : 'password';
      document.getElementById(eyeId).style.display    = isPwd ? 'none'  : 'block';
      document.getElementById(eyeOffId).style.display = isPwd ? 'block' : 'none';
    });
  }
  function maskEmail(email) {
    const [user, domain] = email.split('@');
    return user.slice(0, 2) + '***@' + domain;
  }

})();
