'use strict';

(function () {
  const API = '/api/admin';
  const ADMIN_MENU_CODE = 'administracion';

  const MENU_GROUP_ORDER = [
    'Ventas',
    'Producción',
    'Bodega',
    'Servicio Técnico',
    'Facturación',
    'Contabilidad',
    'Administración',
    'Gerencia',
    'General',
  ];

  const state = {
    loading: true,
    error: '',
    activeTab: 'resumen',
    users: [],
    menus: [],
    profiles: [],
    areas: [],
    lastUpdated: null,
    filters: {
      search: '',
      area: '',
      status: '',
      admin: '',
    },
    selectedPermUserId: null,
    selectedProfileId: null,
    selectedProfileUserId: null,
    selectedVendorUserId: null,
    selectedAreaId: null,
    selectedAreaProfileId: null,
    permissionsDraft: new Set(),
    profileMenuDraft: new Set(),
    profileUserDraft: new Set(),
    vendorEditCode: '',
    vendorEditType: 'P',
    drawer: {
      open: false,
      type: 'user',
      mode: 'new',
      id: null,
      readOnly: false,
    },
    audit: [],
  };

  function parseJSONSafe(raw) {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function getStoredUser() {
    const raw = parseJSONSafe(sessionStorage.getItem('texpro_user'))
      || parseJSONSafe(localStorage.getItem('user'))
      || parseJSONSafe(localStorage.getItem('usuario'));
    const user = raw?.user || raw?.usuario || raw;
    return user || null;
  }

  function getCurrentUserId() {
    const user = getStoredUser();
    return Number(user?.id || user?.sub || user?.usuario_id || 0) || null;
  }

  async function verificarAccesoAdmin() {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    if (!token) {
      window.location.href = '/src/modulo/varios/login/index.html';
      return null;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok || !data?.user) {
        throw new Error(data?.error || 'Sesión no disponible');
      }

      const user = data.user;
      const menus = Array.isArray(user?.menus) ? user.menus : [];
      const tieneAdmin = Boolean(user?.is_admin)
        || menus.some(menu => normalizeKey(menu?.codigo) === ADMIN_MENU_CODE);

      if (!tieneAdmin) {
        window.location.href = '/src/modulo/varios/sin-acceso/index.html?modulo=Administración&from=/src/modulo/admin/admin/index.html';
        return null;
      }

      const payload = JSON.stringify(user);
      sessionStorage.setItem('texpro_user', payload);
      localStorage.setItem('user', payload);
      localStorage.setItem('usuario', payload);

      return user;
    } catch (error) {
      window.location.href = '/src/modulo/varios/login/index.html';
      return null;
    }
  }

  function normalizeText(value) {
    return String(value ?? '').trim();
  }

  function normalizeKey(value) {
    return normalizeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, '-');
  }

  function slugifyCodigo(value) {
    return normalizeText(value)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s_-]/g, '')
      .replace(/[\s-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function suggestProfileCodeForArea(area) {
    const key = normalizeKey(area);
    const areaRecord = areaByCode(key);
    if (areaRecord?.perfil_base_codigo) {
      return areaRecord.perfil_base_codigo;
    }
    if (areaRecord?.perfil_base_id) {
      const profile = profileById(areaRecord.perfil_base_id);
      if (profile?.codigo) return profile.codigo;
    }
    const map = {
      ventas: 'ventas',
      bodega: 'bodega',
      produccion: 'produccion',
      'servicio-tecnico': 'servicio_tecnico',
      facturacion: 'facturacion',
      contabilidad: 'contabilidad',
      rrhh: 'rrhh',
      gerencia: 'gerencia',
      administracion: 'administracion',
      admin: 'administracion',
    };
    return map[key] || '';
  }

  function friendlyAdminError(error) {
    const code = String(error?.code || '').toUpperCase();
    const fallback = String(error?.message || 'Ocurrió un error al guardar.').trim();
    const messages = {
      EMAIL_DUPLICADO: 'Ya existe un usuario registrado con este correo.',
      CODIGO_DUPLICADO: 'Este código ya está asociado a otro usuario.',
      MENU_DUPLICADO: 'Ya existe un menú con este código.',
      PERFIL_DUPLICADO: 'Ya existe un perfil con este código.',
      USUARIO_NO_EXISTE: 'El usuario seleccionado no existe.',
      PERFIL_NO_EXISTE: 'El perfil seleccionado no existe.',
      MENU_NO_EXISTE: 'El menú seleccionado no existe.',
    };
    return messages[code] || fallback;
  }

  function handleAdminError(error) {
    const message = friendlyAdminError(error);
    setMessage(message, 'error');
    toast('Administración', message, 'error');
  }

  function escHtml(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  function toBool(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = normalizeKey(value);
    return ['1', 'true', 'si', 'sí', 'yes', 'on'].includes(normalized)
      ? true
      : ['0', 'false', 'no', 'off'].includes(normalized)
        ? false
        : fallback;
  }

  function formatAreaLabel(value) {
    const key = normalizeKey(value);
    const labels = {
      general: 'General',
      ventas: 'Ventas',
      produccion: 'Producción',
      bodega: 'Bodega',
      'servicio-tecnico': 'Servicio Técnico',
      facturacion: 'Facturación',
      contabilidad: 'Contabilidad',
      rrhh: 'RRHH',
      gerencia: 'Gerencia',
      administracion: 'Administración',
      admin: 'Administración',
    };
    return labels[key] || normalizeText(value) || 'Sin área';
  }

  function buildSuggestions(areaCode) {
    const key = normalizeKey(areaCode);
    const map = {
      general: ['general', 'alertas', 'mensajeria'],
      ventas: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'mensajeria'],
      produccion: ['produccion', 'bodega', 'alertas', 'mensajeria'],
      bodega: ['bodega', 'alertas', 'mensajeria'],
      'servicio-tecnico': ['servicio_tecnico', 'alertas', 'mensajeria'],
      facturacion: ['facturacion', 'alertas', 'mensajeria'],
      contabilidad: ['contabilidad', 'cobranza', 'alertas', 'mensajeria'],
      rrhh: ['rrhh', 'alertas', 'mensajeria'],
      gerencia: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'gerencia', 'alertas', 'mensajeria'],
      administracion: ['general', 'ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'produccion', 'bodega', 'servicio_tecnico', 'facturacion', 'rrhh', 'contabilidad', 'cobranza', 'administracion', 'alertas', 'mensajeria', 'gerencia'],
      admin: ['general', 'ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'produccion', 'bodega', 'servicio_tecnico', 'facturacion', 'rrhh', 'contabilidad', 'cobranza', 'administracion', 'alertas', 'mensajeria', 'gerencia'],
    };
    return map[key] || [];
  }

  function setMessage(text, type = 'info') {
    const msg = document.getElementById('adminMessage');
    const note = document.getElementById('adminStatusNote');
    if (msg) {
      if (!text) {
        msg.hidden = true;
        msg.textContent = '';
      } else {
        msg.hidden = false;
        msg.textContent = text;
        msg.className = 'admin-message';
        if (type === 'error') msg.classList.add('is-error');
        if (type === 'success') msg.classList.add('is-success');
        if (type === 'warn') msg.classList.add('is-warn');
      }
    }
    if (note && text) note.textContent = text;
  }

  function toast(title, message, type = 'success') {
    const stack = document.getElementById('toastStack');
    if (!stack) return;

    const node = document.createElement('div');
    node.className = `toast ${type === 'error' ? 'toast--error' : type === 'warn' ? 'toast--warn' : ''}`;
    node.innerHTML = `
      <div class="toast__title">${escHtml(title)}</div>
      <div class="toast__msg">${escHtml(message)}</div>
    `;
    stack.appendChild(node);

    setTimeout(() => {
      node.remove();
    }, 3200);
  }

  function fieldHelp(helpText, feedbackFor = '') {
    const help = helpText ? `<small class="field-help">${escHtml(helpText)}</small>` : '';
    const feedback = feedbackFor
      ? `<small class="field-feedback" data-feedback-for="${escHtml(feedbackFor)}" hidden></small>`
      : '';
    return `${help}${feedback}`;
  }

  function setFieldFeedback(fieldId, status = '', message = '') {
    const field = document.querySelector(`[data-field-wrap="${fieldId}"]`) || document.getElementById(fieldId)?.closest('.drawer-field');
    if (!field) return;
    field.classList.remove('field-valid', 'field-invalid', 'field-warning');
    if (status) field.classList.add(`field-${status}`);
    const feedback = document.querySelector(`[data-feedback-for="${fieldId}"]`);
    if (feedback) {
      feedback.hidden = !message;
      feedback.textContent = message || '';
      feedback.classList.remove('field-error', 'field-warning', 'field-valid-message');
      if (status === 'invalid') feedback.classList.add('field-error');
      if (status === 'warning') feedback.classList.add('field-warning');
      if (status === 'valid') feedback.classList.add('field-valid-message');
    }
  }

  function clearFieldFeedback(scopeSelector = '#drawerBody') {
    const scope = document.querySelector(scopeSelector);
    if (!scope) return;
    scope.querySelectorAll('.drawer-field').forEach(field => {
      field.classList.remove('field-valid', 'field-invalid', 'field-warning');
    });
    scope.querySelectorAll('[data-feedback-for]').forEach(node => {
      node.hidden = true;
      node.textContent = '';
      node.classList.remove('field-error', 'field-warning', 'field-valid-message');
    });
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function isValidMenuUrl(value) {
    const text = String(value || '').trim();
    return text.startsWith('/') && /\/index\.html(\?.*)?$/i.test(text);
  }

  function uniqueCodeExists(list, code, currentId = null) {
    const normalized = normalizeKey(code);
    return list.some(item => normalizeKey(item.codigo) === normalized && Number(item.id) !== Number(currentId));
  }

  function currentUserMenuCodes(user) {
    return new Set((Array.isArray(user?.menus) ? user.menus : []).map(menu => normalizeKey(menu.codigo)));
  }

  function inheritedMenuCodes(user) {
    const codes = new Set();
    (Array.isArray(user?.perfiles) ? user.perfiles : []).forEach(profile => {
      (Array.isArray(profile.menus) ? profile.menus : []).forEach(menu => {
        if (menu?.codigo) codes.add(normalizeKey(menu.codigo));
      });
    });
    return codes;
  }

  function renderMenuStatusHint(menuCode, user) {
    const inherited = inheritedMenuCodes(user);
    const direct = currentUserMenuCodes(user);
    if (inherited.has(normalizeKey(menuCode)) && direct.has(normalizeKey(menuCode))) {
      return '<small class="field-warning">Este menú ya viene por perfil. No es necesario asignarlo como excepción.</small>';
    }
    if (inherited.has(normalizeKey(menuCode))) {
      return '<small class="field-valid-message">Heredado desde perfil.</small>';
    }
    return '';
  }

  function validateDrawerField(fieldId, status = '', message = '') {
    setFieldFeedback(fieldId, status, message);
    return status !== 'invalid';
  }

  function validateDrawerByType(type) {
    const result = { valid: true, warnings: [] };

    const mark = (fieldId, condition, invalidMessage, warningMessage = '') => {
      if (!condition) {
        validateDrawerField(fieldId, 'invalid', invalidMessage);
        result.valid = false;
        return false;
      }
      if (warningMessage) {
        validateDrawerField(fieldId, 'warning', warningMessage);
        result.warnings.push(warningMessage);
      } else {
        validateDrawerField(fieldId, 'valid', 'Listo');
      }
      return true;
    };

    if (type === 'user') {
      const isEditing = state.drawer.mode === 'edit';
      const nombre = document.getElementById('adminUserNombre')?.value.trim();
      const email = document.getElementById('adminUserEmail')?.value.trim();
      const codigo = slugifyCodigo(document.getElementById('adminUserCodigo')?.value);
      const area = document.getElementById('adminUserArea')?.value.trim();
      const currentId = state.drawer.mode === 'edit' ? state.drawer.id : null;

      mark('adminUserNombre', !!nombre, 'Este campo es obligatorio.');
      mark('adminUserEmail', !!email && isValidEmail(email), 'Ingresa un correo válido.');
      if (!isEditing) {
        validateDrawerField('adminUserCodigo', codigo ? 'valid' : 'warning', codigo ? 'Código válido.' : 'Se generará automáticamente desde el nombre.');
      } else {
        validateDrawerField('adminUserCodigo', 'valid', 'El código no se modifica desde esta vista.');
      }
      mark('adminUserArea', !!area, 'Este campo es obligatorio.');
      validateDrawerField('adminUserIsAdmin', '', '');
      validateDrawerField('adminUserIsActive', '', '');

      if (email && isValidEmail(email)) {
        const duplicated = uniqueCodeExists(state.users.map(user => ({ id: user.id, codigo: user.email })), email, currentId);
        validateDrawerField('adminUserEmail', duplicated ? 'invalid' : 'valid', duplicated ? 'Este correo ya existe.' : 'Correo válido');
        result.valid = result.valid && !duplicated;
      }

      if (!isEditing && codigo) {
        const duplicated = uniqueCodeExists(state.users, codigo, currentId);
        validateDrawerField('adminUserCodigo', duplicated ? 'invalid' : 'valid', duplicated ? 'Este código ya existe.' : 'Código disponible');
        result.valid = result.valid && !duplicated;
      }

      return result;
    }

    if (type === 'menu') {
      const nombre = document.getElementById('adminMenuNombre')?.value.trim();
      const codigo = slugifyCodigo(document.getElementById('adminMenuCodigo')?.value);
      const grupo = document.getElementById('adminMenuGrupo')?.value.trim();
      const url = document.getElementById('adminMenuUrl')?.value.trim();
      const orden = document.getElementById('adminMenuOrden')?.value.trim();
      const currentId = state.drawer.mode === 'edit' ? state.drawer.id : null;

      mark('adminMenuNombre', !!nombre, 'Este campo es obligatorio.');
      mark('adminMenuCodigo', !!codigo, 'Este campo es obligatorio.');
      mark('adminMenuUrl', !!url, 'Este campo es obligatorio.');

      if (codigo) {
        const duplicated = uniqueCodeExists(state.menus, codigo, currentId);
        validateDrawerField('adminMenuCodigo', duplicated ? 'invalid' : 'valid', duplicated ? 'Este código ya existe.' : 'Código disponible');
        result.valid = result.valid && !duplicated;
      }

      if (url) {
        const validUrl = isValidMenuUrl(url);
        validateDrawerField('adminMenuUrl', validUrl ? 'valid' : 'invalid', validUrl ? 'La URL parece válida.' : 'La URL debe comenzar con / y apuntar a un archivo index.html del módulo.');
        result.valid = result.valid && validUrl;
      }

      if (orden && Number.isNaN(Number(orden))) {
        validateDrawerField('adminMenuOrden', 'invalid', 'El orden debe ser numérico.');
        result.valid = false;
      } else if (orden) {
        validateDrawerField('adminMenuOrden', 'valid', 'Orden válido');
      }

      if (grupo) {
        validateDrawerField('adminMenuGrupo', 'valid', 'Grupo válido');
      }

      return result;
    }

    if (type === 'profile') {
      const nombre = document.getElementById('adminProfileNombre')?.value.trim();
      const codigo = slugifyCodigo(document.getElementById('adminProfileCodigo')?.value);
      const area = document.getElementById('adminProfileArea')?.value.trim();
      const currentId = state.drawer.mode === 'edit' ? state.drawer.id : null;

      mark('adminProfileNombre', !!nombre, 'Este campo es obligatorio.');
      mark('adminProfileCodigo', !!codigo, 'Este campo es obligatorio.');

      if (codigo) {
        const duplicated = uniqueCodeExists(state.profiles, codigo, currentId);
        validateDrawerField('adminProfileCodigo', duplicated ? 'invalid' : 'valid', duplicated ? 'Este código ya existe.' : 'Código disponible');
        result.valid = result.valid && !duplicated;
      }

      if (!area) {
        validateDrawerField('adminProfileArea', 'warning', 'Área opcional. Puede quedar sin área asociada.');
        result.warnings.push('Área no asociada');
      } else {
        validateDrawerField('adminProfileArea', 'valid', 'Área válida');
      }

      return result;
    }

    if (type === 'area') {
      const nombre = document.getElementById('adminAreaNombre')?.value.trim();
      const codigo = slugifyCodigo(document.getElementById('adminAreaCodigo')?.value);
      const perfilBaseId = document.getElementById('adminAreaPerfilBase')?.value.trim();

      mark('adminAreaNombre', !!nombre, 'Este campo es obligatorio.');
      mark('adminAreaCodigo', !!codigo, 'Este campo es obligatorio.');

      if (codigo) {
        const duplicated = uniqueCodeExists(state.areas, codigo, state.drawer.mode === 'edit' ? state.drawer.id : null);
        validateDrawerField('adminAreaCodigo', duplicated ? 'invalid' : 'valid', duplicated ? 'Este código ya existe.' : 'Código disponible');
        result.valid = result.valid && !duplicated;
      }

      if (perfilBaseId) {
        const profile = profileById(perfilBaseId);
        validateDrawerField('adminAreaPerfilBase', profile ? 'valid' : 'warning', profile ? 'Perfil base válido.' : 'Selecciona un perfil base existente.');
        if (!profile) result.warnings.push('Perfil base no encontrado');
      } else {
        validateDrawerField('adminAreaPerfilBase', 'warning', 'Área sin perfil base asociado.');
        result.warnings.push('Área sin perfil base');
      }

      return result;
    }

    return result;
  }

  function bindDrawerValidation() {
    const drawer = document.getElementById('drawerBody');
    if (!drawer || drawer.dataset.validationBound) return;
    const validate = () => validateDrawerByType(state.drawer.type);
    drawer.addEventListener('input', validate);
    drawer.addEventListener('change', validate);
    drawer.dataset.validationBound = '1';
    validate();
  }

  async function apiFetch(path, options = {}) {
    const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${API}${path}`, {
      ...options,
      headers,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok || payload?.ok === false) {
      const error = new Error(payload?.error || `Error HTTP ${response.status}`);
      error.code = payload?.code || '';
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  function groupMenus(menus) {
    const groups = new Map();
    menus.forEach(menu => {
      const key = menu.grupo || 'General';
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(menu);
    });

    return MENU_GROUP_ORDER
      .filter(group => groups.has(group))
      .map(group => ({
        group,
        items: groups.get(group).sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es')),
      }))
      .concat(
        Array.from(groups.entries())
          .filter(([group]) => !MENU_GROUP_ORDER.includes(group))
          .sort(([a], [b]) => a.localeCompare(b, 'es'))
          .map(([group, items]) => ({
            group,
            items: items.sort((a, b) => (a.orden - b.orden) || a.nombre.localeCompare(b.nombre, 'es')),
          }))
      );
  }

  function userById(id) {
    return state.users.find(user => Number(user.id) === Number(id)) || null;
  }

  function menuById(id) {
    return state.menus.find(menu => Number(menu.id) === Number(id)) || null;
  }

  function profileById(id) {
    return state.profiles.find(profile => Number(profile.id) === Number(id)) || null;
  }

  function profileByCode(code) {
    return state.profiles.find(profile => normalizeKey(profile.codigo) === normalizeKey(code)) || null;
  }

  function areaById(id) {
    return state.areas.find(area => Number(area.id) === Number(id)) || null;
  }

  function areaByCode(code) {
    return state.areas.find(area => normalizeKey(area.codigo) === normalizeKey(code)) || null;
  }

  function areaLabel(code) {
    return areaByCode(code)?.nombre || formatAreaLabel(code);
  }

  function activeProfiles() {
    return state.profiles.filter(profile => profile.activo !== false);
  }

  function activeAreas() {
    return state.areas.filter(area => area.activo !== false);
  }

  function profileOptionsHtml(selectedCode = '') {
    const selectedKey = normalizeKey(selectedCode);
    return [
      '<option value="">Sin perfil principal</option>',
      ...activeProfiles().map(profile => {
        const area = areaLabel(profile.area);
        const selected = normalizeKey(profile.codigo) === selectedKey ? 'selected' : '';
        return `<option value="${escHtml(profile.codigo)}" ${selected}>${escHtml(profile.nombre)}${area ? ` · ${escHtml(area)}` : ''}</option>`;
      }),
    ].join('');
  }

  function profileOptionsByIdHtml(selectedId = '') {
    const selectedKey = Number(selectedId);
    return [
      '<option value="">Sin perfil base</option>',
      ...activeProfiles().map(profile => {
        const area = areaLabel(profile.area);
        const selected = Number(profile.id) === selectedKey ? 'selected' : '';
        return `<option value="${escHtml(profile.id)}" ${selected}>${escHtml(profile.nombre)}${area ? ` · ${escHtml(area)}` : ''}</option>`;
      }),
    ].join('');
  }

  function currentUser() {
    return getStoredUser();
  }

  function currentUserName() {
    const user = currentUser();
    return user?.nombre || user?.name || user?.email || 'Usuario';
  }

  function currentUserArea() {
    const user = currentUser();
    return formatAreaLabel(user?.area);
  }

  function formatLastUpdated(value) {
    if (!value) return 'Sin datos aún';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Sin datos aún';
    return date.toLocaleString('es-CL', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getSummaryMetrics() {
    const totalUsers = state.users.length;
    const activeUsers = state.users.filter(user => user.is_active).length;
    const inactiveUsers = totalUsers - activeUsers;
    const adminUsers = state.users.filter(user => user.is_admin).length;
    const activeMenus = state.menus.filter(menu => menu.activo).length;
    const totalAreas = state.areas.length;
    const usersWithoutMenus = state.users.filter(user => !user.menus?.length).length;
    const profilesWithMenus = state.profiles.filter(profile => Array.isArray(profile.menus) && profile.menus.length > 0).length;
    const baseProfiles = state.profiles.filter(profile => toBool(profile.es_base)).length;

    return {
      totalUsers,
      activeUsers,
      inactiveUsers,
      adminUsers,
      activeMenus,
      totalAreas,
      usersWithoutMenus,
      profilesWithMenus,
      baseProfiles,
    };
  }

  function renderSummarySections() {
    const lastUpdated = document.getElementById('adminLastUpdated');
    const warningsList = document.getElementById('adminWarningsList');
    const changesList = document.getElementById('adminLatestChangesList');
    const metrics = getSummaryMetrics();

    if (lastUpdated) {
      lastUpdated.textContent = formatLastUpdated(state.lastUpdated);
    }

    if (warningsList) {
      const warnings = [];
      if (!metrics.totalUsers) warnings.push('No hay usuarios cargados todavía.');
      if (!metrics.activeMenus) warnings.push('No existen menús activos para heredar.');
      if (!metrics.baseProfiles) warnings.push('Aún no hay perfiles base marcados.');
      if (!warnings.length) warnings.push('Todo está listo: no hay alertas destacadas.');
      warningsList.innerHTML = warnings.map(text => `<div class="summary-item summary-item--warn">${escHtml(text)}</div>`).join('');
    }

    if (changesList) {
      const source = Array.isArray(state.audit) ? state.audit.slice(0, 4) : [];
      if (!source.length) {
        changesList.innerHTML = '<div class="summary-item">Sin cambios recientes registrados.</div>';
      } else {
        changesList.innerHTML = source.map(entry => `
          <div class="summary-item">
            <strong>${escHtml(entry.title || 'Cambio')}</strong>
            <span>${escHtml(entry.detail || entry.description || entry.message || 'Registro del sistema')}</span>
          </div>
        `).join('');
      }
    }
  }

  function renderHeader() {
    const user = currentUser();
    const name = currentUserName();
    const initials = String(name || '?')
      .split(' ')
      .slice(0, 2)
      .map(part => part[0] || '')
      .join('')
      .toUpperCase() || '?';

    const userName = document.getElementById('userName');
    const userArea = document.getElementById('userArea');
    const userAvatar = document.getElementById('userAvatar');
    const chipAvatar = document.getElementById('chipAvatar');
    const chipName = document.getElementById('chipName');
    const headerDate = document.getElementById('headerDate');

    if (userName) userName.textContent = name;
    if (userArea) userArea.textContent = currentUserArea();
    if (userAvatar) userAvatar.textContent = initials;
    if (chipAvatar) chipAvatar.textContent = initials;
    if (chipName) chipName.textContent = name.split(' ')[0];
    if (headerDate) {
      headerDate.textContent = new Date().toLocaleDateString('es-CL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    if (user?.is_admin) {
      setMessage('Datos cargados desde la API real.', 'success');
    }
  }

  function renderKpis() {
    const container = document.getElementById('adminKpis');
    if (!container) return;

    const metrics = getSummaryMetrics();

    const cards = [
      { label: 'Total usuarios', value: metrics.totalUsers },
      { label: 'Usuarios activos', value: metrics.activeUsers },
      { label: 'Usuarios inactivos', value: metrics.inactiveUsers },
      { label: 'Administradores', value: metrics.adminUsers },
      { label: 'Menús activos', value: metrics.activeMenus },
      { label: 'Usuarios sin menús', value: metrics.usersWithoutMenus },
    ];

    container.innerHTML = cards.map(card => `
      <article class="admin-kpi">
        <span class="admin-kpi__label">${escHtml(card.label)}</span>
        <span class="admin-kpi__value">${escHtml(card.value)}</span>
      </article>
    `).join('');

    const summaryGrid = document.getElementById('adminSummaryGrid');
    if (summaryGrid) {
      summaryGrid.innerHTML = [
        { label: 'Usuarios', value: metrics.totalUsers },
        { label: 'Activos', value: metrics.activeUsers },
        { label: 'Inactivos', value: metrics.inactiveUsers },
        { label: 'Perfiles', value: state.profiles.length },
        { label: 'Áreas', value: metrics.totalAreas },
        { label: 'Perfiles base', value: metrics.baseProfiles },
        { label: 'Menús', value: state.menus.length },
        { label: 'Menús activos', value: metrics.activeMenus },
        { label: 'Alertas', value: metrics.usersWithoutMenus },
      ].map(card => `
        <article class="summary-metric">
          <span class="summary-metric__label">${escHtml(card.label)}</span>
          <span class="summary-metric__value">${escHtml(card.value)}</span>
        </article>
      `).join('');
    }

    renderSummarySections();
  }

  function renderResumen() {
    renderKpis();
  }
  function renderTabs() {
    document.querySelectorAll('.admin-tab').forEach(button => {
      button.classList.toggle('is-active', button.dataset.tab === state.activeTab);
    });

    document.querySelectorAll('.admin-panel').forEach(panel => {
      const visible = panel.dataset.panel === state.activeTab;
      panel.hidden = !visible;
      panel.classList.toggle('is-active', visible);
    });
  }

  function filteredUsers() {
    const search = normalizeText(state.filters.search).toLowerCase();

    return state.users.filter(user => {
      const bySearch = !search || [user.nombre, user.email, user.codigo]
        .some(value => normalizeText(value).toLowerCase().includes(search));
      const byArea = !state.filters.area || normalizeKey(user.area) === normalizeKey(state.filters.area);
      const byStatus = !state.filters.status
        || (state.filters.status === 'activo' && user.is_active)
        || (state.filters.status === 'inactivo' && !user.is_active);
      const byAdmin = !state.filters.admin
        || (state.filters.admin === 'admin' && user.is_admin)
        || (state.filters.admin === 'no-admin' && !user.is_admin);
      return bySearch && byArea && byStatus && byAdmin;
    });
  }

  function renderUserFilters() {
    const areaFilter = document.getElementById('userAreaFilter');
    if (areaFilter && !areaFilter.dataset.ready) {
      const options = [
        '<option value="">Todas las áreas</option>',
        ...state.areas.map(area => `<option value="${escHtml(area.codigo)}">${escHtml(area.nombre)}</option>`),
      ];
      areaFilter.innerHTML = options.join('');
      areaFilter.dataset.ready = '1';
    }
  }

  function renderUsers() {
    renderUserFilters();
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    const rows = filteredUsers();
    if (!rows.length) {
      tbody.innerHTML = '<tr class="row-empty"><td colspan="10">No hay usuarios para los filtros seleccionados.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(user => `
      <tr>
        <td>${escHtml(user.nombre)}</td>
        <td>${escHtml(user.email)}</td>
        <td>${escHtml(user.codigo)}</td>
        <td>${escHtml(formatAreaLabel(user.area))}</td>
        <td>${Array.isArray(user.perfiles) && user.perfiles.length ? escHtml(user.perfiles[0].nombre || user.perfiles[0].codigo || '?') : '?'}</td>
        <td><span class="table-status ${user.is_active ? 'table-status--activo' : 'table-status--inactivo'}">${user.is_active ? 'Activo' : 'Inactivo'}</span></td>
        <td><span class="table-status ${user.is_admin ? 'table-status--admin' : 'table-status--inactivo'}">${user.is_admin ? 'Admin' : 'No'}</span></td>
        <td>${Array.isArray(user.menus) ? user.menus.length : 0}</td>
        <td>${escHtml(user.last_login || user.created_at || '?')}</td>
        <td>
          <div class="action-group">
            <button class="btn-secondary" data-user-action="edit" data-id="${user.id}" type="button">Editar</button>
            <button class="btn-secondary" data-user-action="permisos" data-id="${user.id}" type="button">Permisos</button>
            <button class="btn-secondary" data-user-action="vendedores" data-id="${user.id}" type="button">Vendedores</button>
            <button class="btn-secondary" data-user-action="toggle" data-id="${user.id}" type="button">${user.is_active ? 'Desactivar' : 'Activar'}</button>
            <button class="btn-danger" data-user-action="delete" data-id="${user.id}" type="button">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderMenusPreview() {
    const preview = document.getElementById('menusPreview');
    if (!preview) return;

    const groups = groupMenus(state.menus.filter(menu => menu.activo));
    if (!groups.length) {
      preview.innerHTML = '<div class="mini-empty">No hay menús activos.</div>';
      return;
    }

    preview.innerHTML = groups.map(group => `
      <div class="sidebar-preview__group">
        <h5>${escHtml(group.group)}</h5>
        ${group.items.map(menu => `
          <div class="sidebar-preview__item ${menu.activo ? '' : 'is-disabled'}">
            <span>${escHtml(menu.icono || '?')}</span>
            <span>${escHtml(menu.nombre)}</span>
            ${menu.activo ? '<span class="badge badge--ok">Activo</span>' : '<span class="badge badge--blocked">Inactivo</span>'}
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  function renderMenus() {
    const tbody = document.getElementById('menusTbody');
    if (!tbody) return;

    if (!state.menus.length) {
      tbody.innerHTML = '<tr class="row-empty"><td colspan="8">Sin menús configurados.</td></tr>';
      renderMenusPreview();
      return;
    }

    tbody.innerHTML = state.menus.map(menu => `
      <tr>
        <td>${escHtml(menu.icono || '?')}</td>
        <td>${escHtml(menu.nombre)}</td>
        <td>${escHtml(menu.codigo)}</td>
        <td>${escHtml(menu.grupo)}</td>
        <td>${escHtml(menu.url)}</td>
        <td>${escHtml(menu.orden)}</td>
        <td><span class="table-status ${menu.activo ? 'table-status--activo' : 'table-status--inactivo'}">${menu.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <div class="action-group">
            <button class="btn-secondary" data-menu-action="edit" data-id="${menu.id}" type="button">Editar</button>
            <button class="btn-secondary" data-menu-action="toggle" data-id="${menu.id}" type="button">${menu.activo ? 'Desactivar' : 'Activar'}</button>
            <button class="btn-danger" data-menu-action="delete" data-id="${menu.id}" type="button">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');

    renderMenusPreview();
  }

  function renderProfiles() {
    const tbody = document.getElementById('profilesTbody');
    if (!tbody) return;

    if (!state.profiles.length) {
      tbody.innerHTML = '<tr class="row-empty"><td colspan="7">Sin perfiles configurados.</td></tr>';
      return;
    }

    tbody.innerHTML = state.profiles.map(profile => `
      <tr>
        <td>${escHtml(profile.nombre)}</td>
        <td>${escHtml(profile.codigo)}</td>
        <td>${escHtml(areaLabel(profile.area) || '?')}</td>
        <td>${escHtml(profile.es_base ? 'Sí' : 'No')}</td>
        <td><span class="table-status ${profile.activo ? 'table-status--activo' : 'table-status--inactivo'}">${profile.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>${Array.isArray(profile.menus) ? profile.menus.length : 0}</td>
        <td>
          <div class="action-group">
            <button class="btn-secondary" data-profile-action="edit" data-id="${profile.id}" type="button">Editar</button>
            <button class="btn-secondary" data-profile-action="menus" data-id="${profile.id}" type="button">Menús</button>
            <button class="btn-secondary" data-profile-action="usuarios" data-id="${profile.id}" type="button">Usuarios</button>
            <button class="btn-secondary" data-profile-action="toggle" data-id="${profile.id}" type="button">${profile.activo ? 'Desactivar' : 'Activar'}</button>
            <button class="btn-danger" data-profile-action="delete" data-id="${profile.id}" type="button">Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderProfileMenuSummary() {
    const allowed = state.profileMenuDraft.size;
    const blocked = state.menus.length - allowed;
    const allowedCount = document.getElementById('profileMenuAllowedCount');
    const blockedCount = document.getElementById('profileMenuBlockedCount');
    const note = document.getElementById('profileMenuNote');
    if (allowedCount) allowedCount.textContent = String(allowed);
    if (blockedCount) blockedCount.textContent = String(Math.max(blocked, 0));
    if (note) {
      note.textContent = allowed
        ? 'Selecciona los módulos que heredarán todos los usuarios con este perfil.'
        : 'Este perfil no tiene menús asignados. Los usuarios con este perfil no recibirán accesos desde él.';
    }
  }

  function renderProfileMenuGroups() {
    const container = document.getElementById('profileMenuGroups');
    if (!container) return;

    const grouped = groupMenus(state.menus);
    if (!grouped.length) {
      container.innerHTML = '<div class="mini-empty">Sin menús para mostrar.</div>';
      return;
    }

    container.innerHTML = grouped.map(group => `
      <article class="permission-group">
        <div class="permission-group__header">
          <h4>${escHtml(group.group)}</h4>
          <span class="permission-group__count">${group.items.length} menús</span>
        </div>
        <div class="permission-list">
          ${group.items.map(menu => {
            const checked = state.profileMenuDraft.has(Number(menu.id));
            return `
              <label class="permission-item">
                <span class="permission-item__label">
                  <input type="checkbox" data-profile-menu-id="${escHtml(menu.id)}" ${checked ? 'checked' : ''} />
                  <strong>${escHtml(menu.nombre)}</strong>
                </span>
                <span class="badge ${checked ? 'badge--ok' : 'badge--blocked'}">${checked ? 'Asignado' : 'Bloqueado'}</span>
              </label>
            `;
          }).join('')}
        </div>
      </article>
    `).join('');
  }

  function renderProfileUserSelects() {
    const userSelect = document.getElementById('profileUserSelect');
    if (userSelect) {
      userSelect.innerHTML = state.users.map(user => `
        <option value="${escHtml(user.id)}">${escHtml(user.nombre)} - ${escHtml(user.email || 'sin correo')} - ${escHtml(formatAreaLabel(user.area))}</option>
      `).join('');
      if (state.selectedProfileUserId) {
        userSelect.value = String(state.selectedProfileUserId);
      }
    }
  }
  function renderProfileUserSummary() {
    const assignedCount = document.getElementById('profileUserAssignedCount');
    if (assignedCount) assignedCount.textContent = String(state.profileUserDraft.size);
  }

  function renderProfileUserList() {
    const container = document.getElementById('profileUserGroups');
    if (!container) return;

    if (!state.profiles.length) {
      container.innerHTML = '<div class="mini-empty">No hay perfiles para asignar.</div>';
      return;
    }

    const grouped = state.profiles
      .slice()
      .sort((a, b) => (Number(b.es_base) - Number(a.es_base)) || a.nombre.localeCompare(b.nombre, 'es'));

    container.innerHTML = grouped.map(profile => {
      const checked = state.profileUserDraft.has(Number(profile.id));
      const locked = profile.es_base && normalizeKey(profile.area) === normalizeKey(userById(state.selectedProfileUserId)?.area);
      return `
        <label class="permission-item">
          <span class="permission-item__label">
            <input type="checkbox" data-profile-user-id="${escHtml(profile.id)}" ${checked ? 'checked' : ''} ${locked ? 'disabled' : ''} />
            <strong>${escHtml(profile.nombre)}</strong>
          </span>
          <span class="badge ${profile.es_base ? 'badge--ok' : 'badge--blocked'}">${profile.es_base ? 'Base' : 'Manual'}</span>
        </label>
      `;
    }).join('');
  }

  async function syncProfileMenuDraft(profileId) {
    const profile = profileById(profileId);
    if (!profile) return;

    try {
      const response = await apiFetch(`/perfiles/${profileId}/menus`);
      const assigned = Array.isArray(response.data) ? response.data : [];
      state.profileMenuDraft = new Set(assigned.map(menu => Number(menu.id)));
      state.selectedProfileId = Number(profileId);
      renderProfileMenuSummary();
      renderProfileMenuGroups();
    } catch (error) {
      toast('Perfiles', error.message, 'error');
    }
  }

  async function syncProfileUserDraft(userId) {
    const user = userById(userId);
    if (!user) return;

    try {
      const response = await apiFetch(`/usuarios/${userId}/perfiles`);
      const assigned = Array.isArray(response.data) ? response.data : [];
      state.profileUserDraft = new Set(assigned.map(profile => Number(profile.id)));
      state.selectedProfileUserId = Number(userId);
      renderProfileUserSelects();
      renderProfileUserSummary();
      renderProfileUserList();
    } catch (error) {
      toast('Perfiles', error.message, 'error');
    }
  }

  function renderAreas() {
    const tbody = document.getElementById('areasTbody');
    if (tbody) {
      if (!state.areas.length) {
        tbody.innerHTML = '<tr class="row-empty"><td colspan="6">Sin áreas configuradas.</td></tr>';
      } else {
        tbody.innerHTML = state.areas.map(area => `
          <tr>
            <td>${escHtml(area.nombre)}</td>
            <td>${escHtml(area.codigo)}</td>
            <td>${escHtml(area.perfil_base_nombre || area.perfil_base_codigo || 'Sin perfil')}</td>
            <td>${escHtml(area.total_usuarios ?? 0)}</td>
            <td><span class="table-status ${area.activo ? 'table-status--activo' : 'table-status--inactivo'}">${area.activo ? 'Activo' : 'Inactivo'}</span></td>
            <td>
              <div class="action-group">
                <button class="btn-secondary" data-area-action="edit" data-id="${escHtml(area.id)}" type="button">Editar</button>
                <button class="btn-secondary" data-area-action="toggle" data-id="${escHtml(area.id)}" type="button">${area.activo ? 'Desactivar' : 'Activar'}</button>
                <button class="btn-secondary" data-area-action="users" data-area="${escHtml(area.codigo)}" type="button">Ver usuarios</button>
                <button class="btn-primary" data-area-action="apply-base" data-id="${escHtml(area.id)}" type="button">Aplicar perfil base</button>
              </div>
            </td>
          </tr>
        `).join('');
      }
    }

    renderAreaActionPanel();
  }

  function renderPermissionSelects() {
    const userSelect = document.getElementById('permUserSelect');
    if (userSelect) {
      userSelect.innerHTML = state.users.map(user => `
        <option value="${escHtml(user.id)}">${escHtml(user.nombre)} - ${escHtml(user.email || 'sin correo')} - ${escHtml(formatAreaLabel(user.area))}</option>
      `).join('');
      if (state.selectedPermUserId) {
        userSelect.value = String(state.selectedPermUserId);
      }
    }

    const areaSelect = document.getElementById('permAreaSelect');
    if (areaSelect && !areaSelect.dataset.ready) {
      areaSelect.innerHTML = [
        '<option value="">Aplicar por área...</option>',
        ...state.areas.map(area => `<option value="${escHtml(area.codigo)}">${escHtml(area.nombre)}</option>`),
      ].join('');
      areaSelect.dataset.ready = '1';
    }
  }
  async function syncPermissionDraft(userId) {
    const user = userById(userId);
    if (!user) return;

    try {
      const response = await apiFetch(`/usuarios/${userId}/menus`);
      const assigned = Array.isArray(response.data) ? response.data : [];
      state.permissionsDraft = new Set(assigned.map(menu => Number(menu.id)));
      state.selectedPermUserId = Number(userId);
      renderPermissionSelects();
      renderPermissionSummary();
      renderPermissionGroups();
    } catch (error) {
      toast('Permisos', error.message, 'error');
    }
  }

  function renderPermissionSummary() {
    const allowed = state.permissionsDraft.size;
    const blocked = state.menus.length - allowed;
    const allowedCount = document.getElementById('permAllowedCount');
    const blockedCount = document.getElementById('permBlockedCount');
    if (allowedCount) allowedCount.textContent = String(allowed);
    if (blockedCount) blockedCount.textContent = String(Math.max(blocked, 0));
  }

  function renderPermissionGroups() {
    const container = document.getElementById('permGroups');
    if (!container) return;

    const selected = selectedPermissionUser();
    const grouped = groupMenus(state.menus);
    if (!grouped.length) {
      container.innerHTML = '<div class="mini-empty">Sin menús para mostrar.</div>';
      return;
    }

    container.innerHTML = grouped.map(group => `
      <article class="permission-group">
        <div class="permission-group__header">
          <h4>${escHtml(group.group)}</h4>
          <span class="permission-group__count">${group.items.length} menús</span>
        </div>
        <div class="permission-list">
          ${group.items.map(menu => {
            const checked = state.permissionsDraft.has(Number(menu.id));
            const inheritedWarning = renderMenuStatusHint(menu.codigo, selected);
            return `
              <label class="permission-item">
                <span class="permission-item__label">
                  <input type="checkbox" data-permission-id="${escHtml(menu.id)}" ${checked ? 'checked' : ''} disabled />
                  <strong>${escHtml(menu.nombre)}</strong>
                </span>
                <span class="badge ${checked ? 'badge--ok' : 'badge--blocked'}">${checked ? 'Heredado' : 'Bloqueado'}</span>
                ${inheritedWarning}
              </label>
            `;
          }).join('')}
        </div>
      </article>
    `).join('');
  }
  function selectedPermissionUser() {
    return userById(state.selectedPermUserId || state.users[0]?.id || null);
  }

  async function renderPermissionPanel() {
    renderPermissionSelects();
    renderPermissionSummary();
    renderPermissionGroups();
    ['permSelectAll', 'permClearAll', 'permRestoreArea', 'permSave'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = true;
        el.title = 'Los accesos se gestionan desde perfiles.';
      }
    });
    const selected = selectedPermissionUser();
    if (selected) {
      await syncPermissionDraft(selected.id);
    }
  }

  function selectedProfile() {
    return profileById(state.selectedProfileId || state.profiles[0]?.id || null);
  }

  function selectedProfileUser() {
    return userById(state.selectedProfileUserId || state.users[0]?.id || null);
  }

  async function renderProfilePanel() {
    const selected = selectedProfile();
    const selectedUser = selectedProfileUser();
    if (selected) {
      await syncProfileMenuDraft(selected.id);
    } else {
      renderProfileMenuSummary();
      renderProfileMenuGroups();
    }
    if (selectedUser) {
      await syncProfileUserDraft(selectedUser.id);
    } else {
      renderProfileUserSelects();
      renderProfileUserSummary();
      renderProfileUserList();
    }
  }

  function renderVendorSelect() {
    const select = document.getElementById('assignUserSelect');
    if (!select) return;
    select.innerHTML = state.users.map(user => `
      <option value="${escHtml(user.id)}">${escHtml(user.nombre)} - ${escHtml(user.email || 'sin correo')} - ${escHtml(formatAreaLabel(user.area))}</option>
    `).join('');
    if (state.selectedVendorUserId) {
      select.value = String(state.selectedVendorUserId);
    }
  }
  async function loadVendorRows(userId) {
    const tbody = document.getElementById('assignmentsTbody');
    if (!tbody || !userId) return;
    try {
      const response = await apiFetch(`/usuarios/${userId}/vendedores`);
      const rows = Array.isArray(response.data) ? response.data : [];
      tbody.innerHTML = rows.length
        ? rows.map(row => `
            <tr>
              <td>${escHtml(userById(userId)?.nombre || '?')}</td>
              <td>${escHtml(row.cod_vendedor)}</td>
              <td><span class="table-status table-status--admin">${escHtml(row.tipo)}</span></td>
              <td>
                <div class="action-group">
                  <button class="btn-secondary" data-vendor-action="edit" data-user-id="${escHtml(userId)}" data-cod="${escHtml(row.cod_vendedor)}" data-tipo="${escHtml(row.tipo)}" type="button">Editar tipo</button>
                  <button class="btn-danger" data-vendor-action="delete" data-user-id="${escHtml(userId)}" data-cod="${escHtml(row.cod_vendedor)}" type="button">Quitar</button>
                </div>
              </td>
            </tr>
          `).join('')
        : '<tr class="row-empty"><td colspan="4">El usuario no tiene vendedores asociados.</td></tr>';
    } catch (error) {
      tbody.innerHTML = `<tr class="row-empty"><td colspan="4">${escHtml(error.message)}</td></tr>`;
    }
  }

  function setVendorEditor(userId, codVendedor, tipo) {
    state.selectedVendorUserId = Number(userId);
    state.vendorEditCode = normalizeText(codVendedor).toUpperCase();
    state.vendorEditType = normalizeText(tipo || 'P').toUpperCase();
    renderVendorSelect();

    const codeInput = document.getElementById('assignVendorCode');
    const typeSelect = document.getElementById('assignVendorType');
    const btn = document.getElementById('btnAddAssignment');
    if (codeInput) {
      codeInput.value = state.vendorEditCode;
      codeInput.disabled = true;
    }
    if (typeSelect) typeSelect.value = state.vendorEditType;
    if (btn) btn.textContent = 'Actualizar tipo';
  }

  function resetVendorEditor() {
    state.vendorEditCode = '';
    state.vendorEditType = 'P';
    const codeInput = document.getElementById('assignVendorCode');
    const typeSelect = document.getElementById('assignVendorType');
    const btn = document.getElementById('btnAddAssignment');
    if (codeInput) {
      codeInput.value = '';
      codeInput.disabled = false;
    }
    if (typeSelect) typeSelect.value = 'P';
    if (btn) btn.textContent = 'Agregar relación';
  }

  function renderAudit() {
    const container = document.getElementById('auditTimeline');
    const subtitle = document.getElementById('auditSubtitle');
    if (subtitle && !state.audit.length) {
      subtitle.textContent = 'Auditoría real pendiente de implementar.';
    }
    if (!container) return;

    if (!state.audit.length) {
      container.innerHTML = '<div class="mini-empty">Auditoría real pendiente de implementar.</div>';
      return;
    }

    container.innerHTML = state.audit.map(item => `
      <article class="audit-item">
        <div class="audit-item__top">
          <span class="audit-item__title">${escHtml(item.title)}</span>
          <span class="audit-item__meta">${escHtml(item.when)}</span>
        </div>
        <div class="audit-item__meta">${escHtml(item.actor)}</div>
        <div class="audit-item__detail">${escHtml(item.detail)}</div>
      </article>
    `).join('');
  }

  function pushAudit(title, detail) {
    state.audit.unshift({
      when: new Date().toLocaleString('es-CL'),
      actor: currentUserName(),
      title,
      detail,
    });
    renderAudit();
  }

  function openDrawer(type, mode = 'new', id = null, readOnly = false) {
    state.drawer = { open: true, type, mode, id, readOnly };
    renderDrawer();
    const overlay = document.getElementById('drawerOverlay');
    if (overlay) {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  function closeDrawer() {
    state.drawer.open = false;
    const overlay = document.getElementById('drawerOverlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function renderUserDrawer(user) {
    const readOnly = state.drawer.readOnly;
    const isEditing = state.drawer.mode === 'edit';
    const userNameSlugAttr = isEditing ? '' : 'data-slug-source="#adminUserCodigo"';
    const codeReadOnly = readOnly || isEditing;
    const suggestedProfile = profileByCode(suggestProfileCodeForArea(user?.area))
      || profileByCode(user?.perfil_principal)
      || profileByCode(user?.perfil_codigo)
      || null;

    return `
      <form class="drawer-form" id="adminUserForm">
        <div class="drawer-grid">
          <div class="drawer-field field-group" data-field-wrap="adminUserNombre">
            <label for="adminUserNombre">Nombre visible <span class="required-mark">*</span></label>
            <input class="input-control" id="adminUserNombre" ${userNameSlugAttr} type="text" value="${escHtml(user?.nombre || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Nombre visible del usuario dentro del sistema. Ejemplo: Claudia Rincones.', 'adminUserNombre')} 
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminUserEmail">
            <label for="adminUserEmail">Email <span class="required-mark">*</span></label>
            <input class="input-control" id="adminUserEmail" type="email" value="${escHtml(user?.email || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Debe ser único y válido. Se usará para iniciar sesión. Ejemplo: usuario@texpro.cl.', 'adminUserEmail')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminUserCodigo">
            <label for="adminUserCodigo">Código</label>
            <input class="input-control${isEditing ? ' is-readonly' : ''}" id="adminUserCodigo" type="text" value="${escHtml(user?.codigo || '')}" ${codeReadOnly ? 'readonly' : ''} ${readOnly && !isEditing ? 'disabled' : ''} />
            ${fieldHelp(isEditing
              ? 'El código no se modifica desde esta vista. Para cambiar códigos comerciales usa Vendedores asociados.'
              : 'Código interno opcional. Si aplica a ventas, respeta ceros a la izquierda.'
            , 'adminUserCodigo')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminUserArea">
            <label for="adminUserArea">Área <span class="required-mark">*</span></label>
            <select class="select-control" id="adminUserArea" data-profile-suggest="#adminUserPerfilPrincipal" ${readOnly ? 'disabled' : ''}>
              ${state.areas.map(area => `<option value="${escHtml(area.codigo)}" ${(area.codigo === normalizeKey(user?.area || 'ventas')) ? 'selected' : ''}>${escHtml(area.nombre)}</option>`).join('')}
            </select>
            ${fieldHelp('El área ayuda a sugerir perfiles y accesos base. Ejemplo: Ventas, Bodega, Administración.', 'adminUserArea')}
            <button class="btn-secondary" type="button" data-quick-action="create-area" ${readOnly ? 'disabled' : ''}>Crear nueva área</button>
          </div>
          <div class="drawer-field drawer-grid--single field-group" data-field-wrap="adminUserPerfilPrincipal">
            <label for="adminUserPerfilPrincipal">Perfil principal</label>
            <select class="select-control" id="adminUserPerfilPrincipal" ${readOnly ? 'disabled' : ''}>
              ${profileOptionsHtml(suggestedProfile?.codigo || '')}
            </select>
            ${fieldHelp('Define los accesos base del usuario. Puedes agregar excepciones después.', 'adminUserPerfilPrincipal')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminUserIsAdmin">
            <label for="adminUserIsAdmin">Es administrador</label>
            <select class="select-control" id="adminUserIsAdmin" ${readOnly ? 'disabled' : ''}>
              <option value="1" ${user?.is_admin ? 'selected' : ''}>Sí</option>
              <option value="0" ${!user?.is_admin ? 'selected' : ''}>No</option>
            </select>
            ${fieldHelp('Activar solo para usuarios que gestionarán usuarios, perfiles y permisos.', 'adminUserIsAdmin')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminUserIsActive">
            <label for="adminUserIsActive">Activo</label>
            <select class="select-control" id="adminUserIsActive" ${readOnly ? 'disabled' : ''}>
              <option value="1" ${user?.is_active !== false ? 'selected' : ''}>Sí</option>
              <option value="0" ${user?.is_active === false ? 'selected' : ''}>No</option>
            </select>
            ${fieldHelp('Si está inactivo, el usuario no podrá iniciar sesión.', 'adminUserIsActive')}
          </div>
        </div>
        ${isEditing ? `
          <section class="drawer-section drawer-section--accent">
            <div class="drawer-section__header">
              <div>
                <h4>Restablecimiento excepcional</h4>
                <p>Usa este bloque solo si necesitas cambiar la clave del usuario.</p>
              </div>
              <span class="drawer-section__tag">Caso excepcional</span>
            </div>
            <div class="drawer-field field-group" data-field-wrap="adminUserPassword">
              <label for="adminUserPassword">Nueva contraseña</label>
              <input class="input-control" id="adminUserPassword" type="password" placeholder="Déjala vacía si no cambias la clave" ${readOnly ? 'disabled' : ''} />
              ${fieldHelp('Si guardas una nueva clave, se actualizará el hash de acceso del usuario.', 'adminUserPassword')}
            </div>
          </section>
        ` : `
          <section class="drawer-section drawer-section--accent">
            <div class="drawer-section__header">
              <div>
                <h4>Seguridad de acceso</h4>
                <p>Define la clave inicial antes de activar el usuario.</p>
              </div>
              <span class="drawer-section__tag">Alta</span>
            </div>
            <div class="drawer-field field-group" data-field-wrap="adminUserPassword">
              <label for="adminUserPassword">Contraseña</label>
              <input class="input-control" id="adminUserPassword" type="password" placeholder="Opcional, pero recomendado" ${readOnly ? 'disabled' : ''} />
              ${fieldHelp('No usar contraseñas genéricas en producción. Debe cumplir la política definida.', 'adminUserPassword')}
            </div>
          </section>
        `}
      </form>
    `;
  }
    function renderMenuDrawer(menu) {
    const readOnly = state.drawer.readOnly;
    return `
      <form class="drawer-form" id="adminMenuForm">
        <div class="drawer-grid">
          <div class="drawer-field field-group" data-field-wrap="adminMenuNombre">
            <label for="adminMenuNombre">Nombre visible <span class="required-mark">*</span></label>
            <input class="input-control" id="adminMenuNombre" data-slug-source="#adminMenuCodigo" type="text" value="${escHtml(menu?.nombre || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Texto que verá el usuario en el menú lateral. Ejemplo: Ventas Asignadas.', 'adminMenuNombre')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminMenuCodigo">
            <label for="adminMenuCodigo">Código <span class="required-mark">*</span></label>
            <input class="input-control" id="adminMenuCodigo" type="text" value="${escHtml(menu?.codigo || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Identificador interno único. Se genera automáticamente. Ejemplo: ventas_asignadas.', 'adminMenuCodigo')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminMenuGrupo">
            <label for="adminMenuGrupo">Grupo</label>
            <input class="input-control" id="adminMenuGrupo" type="text" value="${escHtml(menu?.grupo || 'General')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Categoría donde aparecerá el menú. Ejemplo: Ventas, General, Administración.', 'adminMenuGrupo')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminMenuOrden">
            <label for="adminMenuOrden">Orden</label>
            <input class="input-control" id="adminMenuOrden" type="number" min="0" value="${escHtml(menu?.orden ?? 0)}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Número para ordenar el menú dentro del grupo. Mientras menor, aparece más arriba.', 'adminMenuOrden')}
          </div>
          <div class="drawer-field drawer-grid--single field-group" data-field-wrap="adminMenuUrl">
            <label for="adminMenuUrl">URL <span class="required-mark">*</span></label>
            <input class="input-control" id="adminMenuUrl" type="text" value="${escHtml(menu?.url || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Ruta interna del módulo. Debe comenzar con /. Ejemplo: /src/modulo/ventas/ventas/index.html.', 'adminMenuUrl')}
          </div>
          <div class="drawer-field drawer-grid--single field-group" data-field-wrap="adminMenuIcono">
            <label for="adminMenuIcono">Ícono</label>
            <input class="input-control" id="adminMenuIcono" type="text" value="${escHtml(menu?.icono || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Emoji o ícono corto para mostrar en el menú. Ejemplo: 🔔, 🏠, 📋.', 'adminMenuIcono')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminMenuActivo">
            <label for="adminMenuActivo">Activo</label>
            <select class="select-control" id="adminMenuActivo" ${readOnly ? 'disabled' : ''}>
              <option value="1" ${menu?.activo !== false ? 'selected' : ''}>Sí</option>
              <option value="0" ${menu?.activo === false ? 'selected' : ''}>No</option>
            </select>
            ${fieldHelp('Si está inactivo, no aparecerá aunque esté asignado.', 'adminMenuActivo')}
          </div>
        </div>
      </form>
    `;
  }
  function renderProfileDrawer(profile) {
    const readOnly = state.drawer.readOnly;
    return `
      <form class="drawer-form" id="adminProfileForm">
        <div class="drawer-grid">
          <div class="drawer-field field-group" data-field-wrap="adminProfileNombre">
            <label for="adminProfileNombre">Nombre del perfil <span class="required-mark">*</span></label>
            <input class="input-control" id="adminProfileNombre" data-slug-source="#adminProfileCodigo" type="text" value="${escHtml(profile?.nombre || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Nombre claro del rol o grupo de accesos. Ejemplo: Ventas, Gerencia, Bodega.', 'adminProfileNombre')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminProfileCodigo">
            <label for="adminProfileCodigo">Código <span class="required-mark">*</span></label>
            <input class="input-control" id="adminProfileCodigo" type="text" value="${escHtml(profile?.codigo || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Se genera automáticamente desde el nombre. Usar minúsculas, sin espacios ni tildes. Ejemplo: servicio_tecnico.', 'adminProfileCodigo')}
          </div>
          <div class="drawer-field drawer-grid--single field-group" data-field-wrap="adminProfileDescripcion">
            <label for="adminProfileDescripcion">Descripción</label>
            <input class="input-control" id="adminProfileDescripcion" type="text" value="${escHtml(profile?.descripcion || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Explica para qué sirve el perfil. Ejemplo: Acceso base para vendedores.', 'adminProfileDescripcion')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminProfileArea">
            <label for="adminProfileArea">Área asociada</label>
            <select class="select-control" id="adminProfileArea" ${readOnly ? 'disabled' : ''}>
              <option value="">Sin área</option>
              ${state.areas.map(area => `<option value="${escHtml(area.codigo)}" ${(area.codigo === normalizeKey(profile?.area || '')) ? 'selected' : ''}>${escHtml(area.nombre)}</option>`).join('')}
            </select>
            ${fieldHelp('Área sugerida para aplicar este perfil automáticamente a usuarios nuevos.', 'adminProfileArea')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminProfileEsBase">
            <label for="adminProfileEsBase">Base automática</label>
            <select class="select-control" id="adminProfileEsBase" ${readOnly ? 'disabled' : ''}>
              <option value="1" ${profile?.es_base ? 'selected' : ''}>Sí</option>
              <option value="0" ${!profile?.es_base ? 'selected' : ''}>No</option>
            </select>
            ${fieldHelp('Si está activo, se asignará automáticamente según el área.', 'adminProfileEsBase')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminProfileActivo">
            <label for="adminProfileActivo">Activo</label>
            <select class="select-control" id="adminProfileActivo" ${readOnly ? 'disabled' : ''}>
              <option value="1" ${profile?.activo !== false ? 'selected' : ''}>Sí</option>
              <option value="0" ${profile?.activo === false ? 'selected' : ''}>No</option>
            </select>
            ${fieldHelp('Si el perfil está inactivo, no debería asignarse a nuevos usuarios.', 'adminProfileActivo')}
          </div>
        </div>
      </form>
    `;
  }

  function renderAreaDrawer(area) {
    const readOnly = state.drawer.readOnly;
    const selectedProfileId = area?.perfil_base_id || '';
    return `
      <form class="drawer-form" id="adminAreaForm">
        <div class="drawer-grid">
          <div class="drawer-field field-group" data-field-wrap="adminAreaNombre">
            <label for="adminAreaNombre">Nombre visible <span class="required-mark">*</span></label>
            <input class="input-control" id="adminAreaNombre" data-slug-source="#adminAreaCodigo" type="text" value="${escHtml(area?.nombre || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Nombre visible del área. Ejemplo: Ventas, Bodega, Laboratorio.', 'adminAreaNombre')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminAreaCodigo">
            <label for="adminAreaCodigo">Código <span class="required-mark">*</span></label>
            <input class="input-control" id="adminAreaCodigo" type="text" value="${escHtml(area?.codigo || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Identificador interno. Se genera automáticamente, sin espacios ni tildes.', 'adminAreaCodigo')}
          </div>
          <div class="drawer-field drawer-grid--single field-group" data-field-wrap="adminAreaDescripcion">
            <label for="adminAreaDescripcion">Descripción</label>
            <input class="input-control" id="adminAreaDescripcion" type="text" value="${escHtml(area?.descripcion || '')}" ${readOnly ? 'disabled' : ''} />
            ${fieldHelp('Área sugerida para aplicar perfiles base y clasificar usuarios.', 'adminAreaDescripcion')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminAreaPerfilBase">
            <label for="adminAreaPerfilBase">Perfil base</label>
            <select class="select-control" id="adminAreaPerfilBase" ${readOnly ? 'disabled' : ''}>
              ${profileOptionsByIdHtml(selectedProfileId)}
            </select>
            ${fieldHelp('Perfil sugerido para los usuarios nuevos de esta área.', 'adminAreaPerfilBase')}
          </div>
          <div class="drawer-field field-group" data-field-wrap="adminAreaActivo">
            <label for="adminAreaActivo">Activo</label>
            <select class="select-control" id="adminAreaActivo" ${readOnly ? 'disabled' : ''}>
              <option value="1" ${(area?.activo !== false) ? 'selected' : ''}>Sí</option>
              <option value="0" ${(area?.activo === false) ? 'selected' : ''}>No</option>
            </select>
            ${fieldHelp('Si el área está inactiva, no debería usarse para nuevos usuarios.', 'adminAreaActivo')}
          </div>
        </div>
      </form>
    `;
  }

  function renderAreaActionPanel() {
    const areaSelect = document.getElementById('areaApplySelect');
    const profileSelect = document.getElementById('areaApplyProfileSelect');
    const preview = document.getElementById('areaApplyPreview');
    const baseHint = document.getElementById('areaApplyBaseHint');

    const selectedArea = areaById(state.selectedAreaId) || activeAreas()[0] || state.areas[0] || null;
    if (areaSelect) {
      areaSelect.innerHTML = state.areas.map(area => `<option value="${escHtml(area.id)}">${escHtml(area.nombre)}${area.activo ? '' : ' · Inactiva'}</option>`).join('');
    }
    if (selectedArea && areaSelect) {
      areaSelect.value = String(selectedArea.id);
    }

    const suggestedProfileId = selectedArea?.perfil_base_id || state.selectedAreaProfileId || '';
    if (profileSelect) {
      profileSelect.innerHTML = profileOptionsByIdHtml(suggestedProfileId);
    }
    if (profileSelect) {
      profileSelect.value = suggestedProfileId ? String(suggestedProfileId) : '';
    }

    const previewUsers = state.users.filter(user => user.is_active !== false && selectedArea && normalizeKey(user.area) === normalizeKey(selectedArea.codigo));
    if (preview) {
      preview.innerHTML = previewUsers.length
        ? previewUsers.slice(0, 8).map(user => `
            <div class="area-preview-item">
              <strong>${escHtml(user.nombre)}</strong>
              <span>${escHtml(user.email || 'sin correo')}</span>
            </div>
          `).join('') + (previewUsers.length > 8 ? `<div class="mini-empty">Y ${previewUsers.length - 8} usuario(s) más.</div>` : '')
        : '<div class="mini-empty">No hay usuarios activos en esta área.</div>';
    }

    if (baseHint) {
      baseHint.textContent = selectedArea?.perfil_base_nombre
        ? `Perfil base sugerido: ${selectedArea.perfil_base_nombre}.`
        : 'Esta área no tiene perfil base asociado todavía.';
    }
  }
  function renderDrawer() {
    const title = document.getElementById('drawerTitle');
    const subtitle = document.getElementById('drawerSubtitle');
    const body = document.getElementById('drawerBody');
    const secondary = document.getElementById('drawerSecondary');
    const danger = document.getElementById('drawerDanger');
    const del = document.getElementById('drawerDelete');
    const primary = document.getElementById('drawerPrimary');

    const drawerUser = state.drawer.type === 'user' ? userById(state.drawer.id) : null;
    const drawerMenu = state.drawer.type === 'menu' ? menuById(state.drawer.id) : null;
    const drawerProfile = state.drawer.type === 'profile' ? profileById(state.drawer.id) : null;
    const drawerArea = state.drawer.type === 'area' ? areaById(state.drawer.id) : null;

    if (title) {
      if (state.drawer.type === 'menu') {
        title.textContent = state.drawer.mode === 'new' ? 'Nuevo menú' : 'Editar menú';
      } else if (state.drawer.type === 'profile') {
        title.textContent = state.drawer.mode === 'new' ? 'Nuevo perfil' : 'Editar perfil';
      } else if (state.drawer.type === 'area') {
        title.textContent = state.drawer.mode === 'new' ? 'Nueva área' : 'Editar área';
      } else {
        title.textContent = state.drawer.mode === 'new' ? 'Nuevo usuario' : 'Editar usuario';
      }
    }

    if (subtitle) {
      if (state.drawer.type === 'menu') {
        subtitle.textContent = 'Mantén el catálogo de navegación sincronizado con los perfiles.';
      } else if (state.drawer.type === 'profile') {
        subtitle.textContent = 'Gestiona perfiles base y perfiles manuales como fuente única de accesos.';
      } else if (state.drawer.type === 'area') {
        subtitle.textContent = 'Gestiona el catálogo maestro de áreas y su perfil base sugerido.';
      } else {
        subtitle.textContent = state.drawer.mode === 'edit'
          ? 'Edita datos del usuario y, si corresponde, restablece su contraseña desde este mismo panel.'
          : 'Gestiona usuarios reales del sistema sin depender de datos mock.';
      }
    }

    if (body) {
      if (state.drawer.type === 'menu') {
        body.innerHTML = renderMenuDrawer(drawerMenu);
      } else if (state.drawer.type === 'profile') {
        body.innerHTML = renderProfileDrawer(drawerProfile);
      } else if (state.drawer.type === 'area') {
        body.innerHTML = renderAreaDrawer(drawerArea);
      } else {
        body.innerHTML = renderUserDrawer(drawerUser);
      }
      clearFieldFeedback();
    }

    if (secondary) secondary.textContent = state.drawer.readOnly ? 'Editar' : 'Cancelar';

    if (primary) primary.hidden = state.drawer.readOnly;
    if (danger) danger.hidden = !['user', 'menu', 'profile', 'area'].includes(state.drawer.type) || state.drawer.readOnly;
    if (del) del.hidden = state.drawer.type === 'area' || state.drawer.readOnly;
    if (danger) {
      danger.textContent = state.drawer.type === 'menu'
        ? 'Desactivar menú'
        : state.drawer.type === 'profile'
          ? 'Desactivar perfil'
          : state.drawer.type === 'area'
            ? 'Desactivar área'
            : 'Desactivar usuario';
    }
    if (del) {
      del.textContent = state.drawer.type === 'menu'
        ? 'Eliminar menú'
        : state.drawer.type === 'profile'
          ? 'Eliminar perfil'
          : 'Eliminar usuario';
    }
    if (primary) {
      primary.textContent = state.drawer.type === 'menu'
        ? 'Guardar menú'
        : state.drawer.type === 'profile'
          ? 'Guardar perfil'
          : state.drawer.type === 'area'
            ? 'Guardar área'
            : 'Guardar usuario';
    }

    bindDrawerValidation();
  }
  function openUserDrawer(id = null, mode = 'new', readOnly = false) {
    state.drawer.type = 'user';
    state.drawer.mode = mode;
    state.drawer.id = id;
    state.drawer.readOnly = readOnly;
    openDrawer('user', mode, id, readOnly);
  }

  function openMenuDrawer(id = null, mode = 'new') {
    state.drawer.type = 'menu';
    state.drawer.mode = mode;
    state.drawer.id = id;
    state.drawer.readOnly = false;
    openDrawer('menu', mode, id, false);
  }

  function openProfileDrawer(id = null, mode = 'new') {
    state.drawer.type = 'profile';
    state.drawer.mode = mode;
    state.drawer.id = id;
    state.drawer.readOnly = false;
    openDrawer('profile', mode, id, false);
  }

  function openAreaDrawer(id = null, mode = 'new') {
    state.drawer.type = 'area';
    state.drawer.mode = mode;
    state.drawer.id = id;
    state.drawer.readOnly = false;
    state.selectedAreaId = id ? Number(id) : state.selectedAreaId;
    state.selectedAreaProfileId = id ? (areaById(id)?.perfil_base_id || null) : state.selectedAreaProfileId;
    openDrawer('area', mode, id, false);
  }

  async function loadData() {
    state.loading = true;
    setMessage('Cargando información real desde la API...', 'info');
    renderLoadingState();

    try {
      const [usersRes, menusRes, areasRes, profilesRes] = await Promise.all([
        apiFetch('/usuarios'),
        apiFetch('/menus'),
        apiFetch('/areas'),
        apiFetch('/perfiles'),
      ]);

      state.users = Array.isArray(usersRes.data) ? usersRes.data : [];
      state.menus = Array.isArray(menusRes.data) ? menusRes.data : [];
      state.areas = Array.isArray(areasRes.data) ? areasRes.data : [];
      state.profiles = Array.isArray(profilesRes.data) ? profilesRes.data : [];
      state.selectedPermUserId = state.selectedPermUserId || state.users[0]?.id || null;
      state.selectedProfileId = state.selectedProfileId || state.profiles[0]?.id || null;
      state.selectedProfileUserId = state.selectedProfileUserId || state.users[0]?.id || null;
      state.selectedVendorUserId = state.selectedVendorUserId || state.users[0]?.id || null;
      state.selectedAreaId = state.selectedAreaId || state.areas[0]?.id || null;
      state.selectedAreaProfileId = state.selectedAreaProfileId || state.areas.find(area => Number(area.id) === Number(state.selectedAreaId))?.perfil_base_id || null;
      state.lastUpdated = new Date().toISOString();
      state.loading = false;
      state.error = '';

      renderAll();
      if (state.selectedPermUserId) {
        await syncPermissionDraft(state.selectedPermUserId);
      }
      if (state.activeTab === 'perfiles') {
        await renderProfilePanel();
      }
      if (state.selectedVendorUserId) {
        await loadVendorRows(state.selectedVendorUserId);
      }
      setMessage('Datos cargados desde la base de datos.', 'success');
    } catch (error) {
      state.loading = false;
      state.error = error.message;
      setMessage(error.message, 'error');
      renderLoadingState();
      toast('Administración', error.message, 'error');
    }
  }

  function renderLoadingState() {
    const usersBody = document.getElementById('usersTbody');
    const menusBody = document.getElementById('menusTbody');
    const profilesBody = document.getElementById('profilesTbody');
    const areasBody = document.getElementById('areasTbody');
    const areaApplyPreview = document.getElementById('areaApplyPreview');
    const permissions = document.getElementById('permGroups');
    const assignments = document.getElementById('assignmentsTbody');
    const audit = document.getElementById('auditTimeline');
    const summaryGrid = document.getElementById('adminSummaryGrid');
    const warningsList = document.getElementById('adminWarningsList');
    const changesList = document.getElementById('adminLatestChangesList');

    if (state.loading) {
      if (usersBody) usersBody.innerHTML = '<tr class="row-empty"><td colspan="10">Cargando usuarios...</td></tr>';
      if (menusBody) menusBody.innerHTML = '<tr class="row-empty"><td colspan="9">Cargando menús...</td></tr>';
      if (profilesBody) profilesBody.innerHTML = '<tr class="row-empty"><td colspan="8">Cargando perfiles...</td></tr>';
      if (areasBody) areasBody.innerHTML = '<tr class="row-empty"><td colspan="6">Cargando áreas...</td></tr>';
      if (areaApplyPreview) areaApplyPreview.innerHTML = '<div class="mini-empty">Cargando vista previa...</div>';
      if (permissions) permissions.innerHTML = '<div class="mini-empty">Cargando permisos...</div>';
      if (assignments) assignments.innerHTML = '<tr class="row-empty"><td colspan="4">Cargando vendedores...</td></tr>';
      if (audit) audit.innerHTML = '<div class="mini-empty">Cargando auditoría...</div>';
      if (summaryGrid) summaryGrid.innerHTML = '<div class="mini-empty">Cargando resumen...</div>';
      if (warningsList) warningsList.innerHTML = '<div class="mini-empty">Cargando alertas...</div>';
      if (changesList) changesList.innerHTML = '<div class="mini-empty">Cargando cambios...</div>';
    }
  }

  async function syncUserPrincipalProfile(userId, primaryProfileCode, existingProfiles = []) {
    const codes = new Set(
      existingProfiles
        .map(profile => profile?.codigo)
        .filter(Boolean)
    );

    if (primaryProfileCode) {
      codes.add(primaryProfileCode);
    }

    if (!codes.size) return;

    await apiFetch(`/usuarios/${userId}/perfiles`, {
      method: 'PUT',
      body: JSON.stringify({ perfiles: Array.from(codes) }),
    });
  }

  async function saveCurrentDrawer() {
    const validation = validateDrawerByType(state.drawer.type);
    if (!validation.valid) {
      toast('Validación', 'Revisa los campos marcados antes de guardar.', 'error');
      return;
    }

    if (state.drawer.type === 'user') {
      const nombre = document.getElementById('adminUserNombre')?.value.trim();
      const email = document.getElementById('adminUserEmail')?.value.trim();
      const area = document.getElementById('adminUserArea')?.value;
      const primaryProfileCode = document.getElementById('adminUserPerfilPrincipal')?.value.trim();
      const isAdmin = toBool(document.getElementById('adminUserIsAdmin')?.value, false);
      const isActive = toBool(document.getElementById('adminUserIsActive')?.value, true);
      const password = document.getElementById('adminUserPassword')?.value || '';
      const payload = { nombre, email, area, is_admin: isAdmin, is_active: isActive };
      if (state.drawer.mode === 'new') {
        const codigoInput = document.getElementById('adminUserCodigo');
        const codigo = slugifyCodigo(codigoInput?.value || nombre);
        if (codigo) payload.codigo = codigo;
      }
      if (password) payload.password = password;

      if (state.drawer.mode === 'new') {
        const created = await apiFetch('/usuarios', { method: 'POST', body: JSON.stringify(payload) });
        const createdUserId = created?.data?.id;
        if (createdUserId) {
          const existingProfiles = Array.isArray(created?.data?.perfiles) ? created.data.perfiles : [];
          await syncUserPrincipalProfile(createdUserId, primaryProfileCode, existingProfiles);
        }
        pushAudit('Usuario creado', `Se creó el usuario ${nombre}.`);
        toast('Usuarios', 'Usuario creado correctamente.', 'success');
      } else {
        const current = userById(state.drawer.id);
        if (current && Number(current.id) === getCurrentUserId() && !isAdmin) {
          const confirmed = window.confirm('Estás por quitarte el acceso de administrador. ¿Quieres continuar?');
          if (!confirmed) return;
          payload.confirmar = true;
        }
        await apiFetch(`/usuarios/${state.drawer.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        await syncUserPrincipalProfile(state.drawer.id, primaryProfileCode, current?.perfiles || []);
        if (password) {
          await apiFetch(`/usuarios/${state.drawer.id}/password`, {
            method: 'PATCH',
            body: JSON.stringify({ password }),
          });
        }
        pushAudit('Usuario actualizado', `Se actualizaron los datos de ${nombre}.`);
        toast('Usuarios', password ? 'Usuario actualizado y contraseña restablecida correctamente.' : 'Usuario actualizado correctamente.', 'success');
      }

      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'menu') {
      const payload = {
        codigo: slugifyCodigo(document.getElementById('adminMenuCodigo')?.value.trim()),
        nombre: document.getElementById('adminMenuNombre')?.value.trim(),
        grupo: document.getElementById('adminMenuGrupo')?.value.trim(),
        url: document.getElementById('adminMenuUrl')?.value.trim(),
        icono: document.getElementById('adminMenuIcono')?.value.trim(),
        orden: Number(document.getElementById('adminMenuOrden')?.value || 0),
        activo: toBool(document.getElementById('adminMenuActivo')?.value, true),
      };

      if (state.drawer.mode === 'new') {
        await apiFetch('/menus', { method: 'POST', body: JSON.stringify(payload) });
        pushAudit('Menú creado', `Se creó el menú ${payload.nombre}.`);
        toast('Menús', 'Menú creado correctamente.', 'success');
      } else {
        await apiFetch(`/menus/${state.drawer.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        pushAudit('Menú actualizado', `Se actualizó el menú ${payload.nombre}.`);
        toast('Menús', 'Menú actualizado correctamente.', 'success');
      }

      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'profile') {
      await saveProfileDrawer();
      return;
    }

    if (state.drawer.type === 'area') {
      await saveAreaDrawer();
      return;
    }
  }
  async function deleteCurrentDrawer() {
    if (state.drawer.type === 'user') {
      const current = userById(state.drawer.id);
      if (!current) return;
      if (!window.confirm(`¿Desactivar lógicamente al usuario ${current.nombre}?`)) return;
      await apiFetch(`/usuarios/${state.drawer.id}`, { method: 'DELETE', body: JSON.stringify({ confirmar: true }) });
      pushAudit('Usuario desactivado', `Se desactivó a ${current.nombre}.`);
      toast('Usuarios', 'Usuario desactivado.', 'success');
      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'profile') {
      const currentProfile = profileById(state.drawer.id);
      if (!currentProfile) return;
      if (!window.confirm(`¿Eliminar el perfil ${currentProfile.nombre}?`)) return;
      await apiFetch(`/perfiles/${state.drawer.id}`, { method: 'DELETE' });
      pushAudit('Perfil eliminado', `Se eliminó o desactivó el perfil ${currentProfile.nombre}.`);
      toast('Perfiles', 'Perfil procesado correctamente.', 'success');
      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'area') {
      return;
    }

    const current = menuById(state.drawer.id);
    if (!current) return;
    if (!window.confirm(`¿Eliminar el menú ${current.nombre}?`)) return;
    await apiFetch(`/menus/${state.drawer.id}`, { method: 'DELETE' });
    pushAudit('Menú eliminado', `Se eliminó o desactivó el menú ${current.nombre}.`);
    toast('Menús', 'Menú procesado correctamente.', 'success');
    closeDrawer();
    await loadData();
  }

  async function toggleCurrentDrawerStatus() {
    if (state.drawer.type === 'user') {
      const current = userById(state.drawer.id);
      if (!current) return;
      const nextActive = !current.is_active;
      const confirmed = nextActive || window.confirm(`¿Desactivar a ${current.nombre}?`);
      if (!confirmed) return;
      await apiFetch(`/usuarios/${state.drawer.id}/${nextActive ? 'activar' : 'desactivar'}`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmar: true }),
      });
      pushAudit(nextActive ? 'Usuario activado' : 'Usuario desactivado', `${current.nombre} cambió de estado.`);
      toast('Usuarios', `Usuario ${nextActive ? 'activado' : 'desactivado'}.`, 'success');
      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'menu') {
      const current = menuById(state.drawer.id);
      if (!current) return;
      await apiFetch(`/menus/${state.drawer.id}/${current.activo ? 'desactivar' : 'activar'}`, { method: 'PATCH' });
      pushAudit(current.activo ? 'Menú desactivado' : 'Menú activado', `${current.nombre} cambió de estado.`);
      toast('Menús', `Menú ${current.activo ? 'desactivado' : 'activado'}.`, 'success');
      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'profile') {
      const current = profileById(state.drawer.id);
      if (!current) return;
      await apiFetch(`/perfiles/${state.drawer.id}/${current.activo ? 'desactivar' : 'activar'}`, { method: 'PATCH' });
      pushAudit(current.activo ? 'Perfil desactivado' : 'Perfil activado', `${current.nombre} cambió de estado.`);
      toast('Perfiles', `Perfil ${current.activo ? 'desactivado' : 'activado'}.`, 'success');
      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'area') {
      const current = areaById(state.drawer.id);
      if (!current) return;
      const nextActive = !current.activo;
      const confirmed = nextActive || window.confirm(`¿Desactivar el área ${current.nombre}?`);
      if (!confirmed) return;
      await apiFetch(`/areas/${state.drawer.id}/${nextActive ? 'activar' : 'desactivar'}`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmar: true }),
      });
      pushAudit(nextActive ? 'Área activada' : 'Área desactivada', `${current.nombre} cambió de estado.`);
      toast('Áreas', `Área ${nextActive ? 'activada' : 'desactivada'}.`, 'success');
      closeDrawer();
      await loadData();
    }
  }

  async function savePermissions() {
    toast('Permisos', 'Los accesos ahora se administran desde perfiles y áreas.', 'warn');
  }

  async function saveProfileMenus() {
    const profile = selectedProfile();
    if (!profile) return;

    const menus = Array.from(state.profileMenuDraft)
      .map(id => menuById(id)?.codigo)
      .filter(Boolean);
    if (!menus.length) {
      const note = document.getElementById('profileMenuNote');
      if (note) note.textContent = 'Este perfil no tiene menús asignados. Los usuarios con este perfil no recibirán accesos desde él.';
      toast('Perfiles', 'Este perfil no tiene menús asignados. Los usuarios con este perfil no recibirán accesos desde él.', 'warn');
    }
    await apiFetch(`/perfiles/${profile.id}/menus`, {
      method: 'PUT',
      body: JSON.stringify({ menus }),
    });

    pushAudit('Menús por perfil', `Se guardaron los menús del perfil ${profile.nombre}.`);
    toast('Perfiles', 'Menús del perfil guardados correctamente.', 'success');
    await loadData();
    await syncProfileMenuDraft(profile.id);
  }
  async function saveProfileUserAssignments() {
    const user = selectedProfileUser();
    if (!user) return;

    const perfiles = Array.from(state.profileUserDraft)
      .map(id => profileById(id)?.codigo)
      .filter(Boolean);
    await apiFetch(`/usuarios/${user.id}/perfiles`, {
      method: 'PUT',
      body: JSON.stringify({ perfiles }),
    });

    pushAudit('Perfiles por usuario', `Se actualizaron los perfiles del usuario ${user.nombre}.`);
    toast('Perfiles', 'Perfiles del usuario guardados correctamente.', 'success');
    await loadData();
    await syncProfileUserDraft(user.id);
  }

  async function saveProfileDrawer() {
    const payload = {
      codigo: slugifyCodigo(document.getElementById('adminProfileCodigo')?.value.trim()),
      nombre: document.getElementById('adminProfileNombre')?.value.trim(),
      descripcion: document.getElementById('adminProfileDescripcion')?.value.trim(),
      area: document.getElementById('adminProfileArea')?.value.trim(),
      es_base: toBool(document.getElementById('adminProfileEsBase')?.value, false),
      activo: toBool(document.getElementById('adminProfileActivo')?.value, true),
    };

    const validation = validateDrawerByType('profile');
    if (!validation.valid) {
      toast('Validación', 'Revisa los campos marcados antes de guardar.', 'error');
      return;
    }

    if (state.drawer.mode === 'new') {
      await apiFetch('/perfiles', { method: 'POST', body: JSON.stringify(payload) });
      pushAudit('Perfil creado', `Se creó el perfil ${payload.nombre}.`);
      toast('Perfiles', 'Perfil creado correctamente.', 'success');
    } else {
      await apiFetch(`/perfiles/${state.drawer.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      pushAudit('Perfil actualizado', `Se actualiz? el perfil ${payload.nombre}.`);
      toast('Perfiles', 'Perfil actualizado correctamente.', 'success');
    }

    closeDrawer();
    await loadData();
  }

  async function applyAreaProfile(areaId, profileId = null) {
    const area = areaById(areaId);
    if (!area) return;

    const selectedProfile = profileId ? profileById(profileId) : profileById(area.perfil_base_id || state.selectedAreaProfileId);
    if (!selectedProfile) {
      toast('Áreas', 'Selecciona un perfil base antes de aplicar.', 'warn');
      return;
    }

    const affectedUsers = state.users.filter(user => user.is_active !== false && normalizeKey(user.area) === normalizeKey(area.codigo));
    if (!affectedUsers.length) {
      toast('Áreas', 'No hay usuarios activos en esta área.', 'warn');
      return;
    }

    const confirmed = window.confirm(`¿Aplicar el perfil ${selectedProfile.nombre} al área ${area.nombre}?`);
    if (!confirmed) return;

    const response = await apiFetch(`/areas/${area.id}/aplicar-perfil`, {
      method: 'POST',
      body: JSON.stringify({ perfil_id: selectedProfile.id }),
    });

    pushAudit('Perfil aplicado por área', `Se aplicó ${selectedProfile.nombre} al área ${area.nombre}.`);
    toast('Áreas', `Perfil aplicado a ${response.data?.afectados || affectedUsers.length} usuario(s).`, 'success');
    state.selectedAreaId = Number(area.id);
    state.selectedAreaProfileId = Number(selectedProfile.id);
    await loadData();
  }

  async function saveAreaDrawer() {
    const payload = {
      codigo: slugifyCodigo(document.getElementById('adminAreaCodigo')?.value.trim()),
      nombre: document.getElementById('adminAreaNombre')?.value.trim(),
      descripcion: document.getElementById('adminAreaDescripcion')?.value.trim(),
      perfil_base_id: Number(document.getElementById('adminAreaPerfilBase')?.value || 0) || null,
      activo: toBool(document.getElementById('adminAreaActivo')?.value, true),
    };

    const validation = validateDrawerByType('area');
    if (!validation.valid) {
      toast('Validación', 'Revisa los campos marcados antes de guardar.', 'error');
      return;
    }

    if (state.drawer.mode === 'new') {
      await apiFetch('/areas', { method: 'POST', body: JSON.stringify(payload) });
      pushAudit('Área creada', `Se creó el área ${payload.nombre}.`);
      toast('Áreas', 'Área creada correctamente.', 'success');
    } else {
      await apiFetch(`/areas/${state.drawer.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      pushAudit('Área actualizada', `Se actualizó el área ${payload.nombre}.`);
      toast('Áreas', 'Área actualizada correctamente.', 'success');
    }

    closeDrawer();
    await loadData();
  }

  async function applyAreaPermissions() {
    const areaSelect = document.getElementById('permAreaSelect');
    const areaCode = areaSelect?.value || state.areas[0]?.codigo || '';
    if (!areaCode) return;
    const area = state.areas.find(item => item.codigo === areaCode);
    const suggestions = area?.sugeridos || buildSuggestions(areaCode);
    const affectedUsers = state.users.filter(user => normalizeKey(user.area) === normalizeKey(areaCode) && user.is_active !== false);
    if (!suggestions.length) {
      toast('Áreas', 'No hay menús sugeridos para esta área.', 'warn');
      return;
    }

    await apiFetch('/accesos/asignar-por-area', {
      method: 'POST',
      body: JSON.stringify({ area: areaCode, menus: suggestions }),
    });

    pushAudit('Accesos por área', `Se actualizó el perfil base de ${formatAreaLabel(areaCode)}.`);
    setMessage(`Área ${formatAreaLabel(areaCode)}: se actualizó el perfil base y ${affectedUsers.length} usuario(s) quedaron alineados a la nueva herencia.`, 'success');
    toast('Áreas', `Perfil base actualizado para ${formatAreaLabel(areaCode)}.`, 'success');
    await loadData();
  }
  async function saveVendorRelation() {
    const userId = Number(document.getElementById('assignUserSelect')?.value || state.selectedVendorUserId || 0);
    const cod = document.getElementById('assignVendorCode')?.value.trim().toUpperCase();
    const tipo = document.getElementById('assignVendorType')?.value;
    if (!userId || !cod || !tipo) {
      toast('Validación', 'Selecciona usuario, código y tipo.', 'error');
      return;
    }

    const normalizedCode = cod.trim();
    const currentUser = userById(userId);
    const duplicateSameUser = Array.isArray(currentUser?.vendedores) && currentUser.vendedores.some(item => normalizeText(item.cod_vendedor).toUpperCase() === normalizedCode && state.vendorEditCode !== normalizedCode);
    const duplicateOtherUser = state.users.some(user => Number(user.id) !== Number(userId) && Array.isArray(user.vendedores) && user.vendedores.some(item => normalizeText(item.cod_vendedor).toUpperCase() === normalizedCode));

    if (!normalizedCode) {
      toast('Validación', 'El código vendedor no puede quedar vacío.', 'error');
      return;
    }
    if (duplicateSameUser) {
      toast('Vendedores', 'Este usuario ya tiene ese código vendedor.', 'warn');
      return;
    }
    if (duplicateOtherUser && !state.vendorEditCode) {
      toast('Vendedores', 'Este código ya está asociado a otro usuario. Revisa antes de continuar.', 'warn');
      return;
    }

    if (state.vendorEditCode) {
      await apiFetch(`/usuarios/${userId}/vendedores/${encodeURIComponent(state.vendorEditCode)}`, {
        method: 'PUT',
        body: JSON.stringify({ tipo }),
      });
      pushAudit('Vendedor actualizado', `Se cambió el tipo de ${state.vendorEditCode}.`);
      toast('Vendedores', 'Tipo actualizado correctamente.', 'success');
    } else {
      await apiFetch(`/usuarios/${userId}/vendedores`, {
        method: 'POST',
        body: JSON.stringify({ cod_vendedor: normalizedCode, tipo }),
      });
      pushAudit('Vendedor agregado', `Se agreg? ${normalizedCode} al usuario seleccionado.`);
      toast('Vendedores', 'Vendedor agregado correctamente.', 'success');
    }

    resetVendorEditor();
    await loadData();
    state.selectedVendorUserId = userId;
    renderVendorSelect();
    await loadVendorRows(userId);
  }
  async function handleVendorAction(action, userId, cod, tipo = '') {
    if (action === 'edit') {
      setVendorEditor(userId, cod, tipo);
      state.selectedVendorUserId = Number(userId);
      return;
    }

    if (!window.confirm(`¿Quitar el vendedor ${cod} del usuario?`)) return;
    await apiFetch(`/usuarios/${userId}/vendedores/${encodeURIComponent(cod)}`, { method: 'DELETE' });
    pushAudit('Vendedor eliminado', `Se quitó ${cod} del usuario seleccionado.`);
    toast('Vendedores', 'Relación eliminada.', 'success');
    await loadData();
    state.selectedVendorUserId = Number(userId);
    renderVendorSelect();
    await loadVendorRows(userId);
  }

  function openSelectedUserInPerms(id) {
    state.selectedPermUserId = Number(id);
    renderPermissionSelects();
    syncPermissionDraft(id);
    state.activeTab = 'permisos';
    renderTabs();
  }

  function openSelectedUserInVendors(id) {
    state.selectedVendorUserId = Number(id);
    renderVendorSelect();
    loadVendorRows(id);
    state.activeTab = 'asignaciones';
    renderTabs();
  }

  function openSelectedProfileInMenus(id) {
    state.selectedProfileId = Number(id);
    renderProfileMenuSummary();
    syncProfileMenuDraft(id);
    state.activeTab = 'perfiles';
    renderTabs();
  }

  function openSelectedProfileInUsers(id) {
    state.selectedProfileUserId = Number(id);
    renderProfileUserSelects();
    syncProfileUserDraft(id);
    state.activeTab = 'perfiles';
    renderTabs();
  }

  function bindEvents() {
    const search = document.getElementById('userSearch');
    if (search && !search.dataset.bound) {
      search.addEventListener('input', event => {
        state.filters.search = event.target.value;
        renderUsers();
      });
      search.dataset.bound = '1';
    }

    const area = document.getElementById('userAreaFilter');
    if (area && !area.dataset.bound) {
      area.addEventListener('change', event => {
        state.filters.area = event.target.value;
        renderUsers();
      });
      area.dataset.bound = '1';
    }

    const status = document.getElementById('userStatusFilter');
    if (status && !status.dataset.bound) {
      status.addEventListener('change', event => {
        state.filters.status = event.target.value;
        renderUsers();
      });
      status.dataset.bound = '1';
    }

    const admin = document.getElementById('userAdminFilter');
    if (admin && !admin.dataset.bound) {
      admin.addEventListener('change', event => {
        state.filters.admin = event.target.value;
        renderUsers();
      });
      admin.dataset.bound = '1';
    }

    const permUserSelect = document.getElementById('permUserSelect');
    if (permUserSelect && !permUserSelect.dataset.bound) {
      permUserSelect.addEventListener('change', event => {
        state.selectedPermUserId = Number(event.target.value);
        syncPermissionDraft(state.selectedPermUserId);
      });
      permUserSelect.dataset.bound = '1';
    }

    const permAreaSelect = document.getElementById('permAreaSelect');
    if (permAreaSelect && !permAreaSelect.dataset.bound) {
      permAreaSelect.dataset.bound = '1';
    }

    const areaApplySelect = document.getElementById('areaApplySelect');
    if (areaApplySelect && !areaApplySelect.dataset.bound) {
      areaApplySelect.addEventListener('change', event => {
        state.selectedAreaId = Number(event.target.value);
        const area = areaById(state.selectedAreaId);
        if (area) {
          state.selectedAreaProfileId = area.perfil_base_id || null;
        }
        renderAreas();
      });
      areaApplySelect.dataset.bound = '1';
    }

    const areaApplyProfileSelect = document.getElementById('areaApplyProfileSelect');
    if (areaApplyProfileSelect && !areaApplyProfileSelect.dataset.bound) {
      areaApplyProfileSelect.addEventListener('change', event => {
        state.selectedAreaProfileId = Number(event.target.value) || null;
        renderAreaActionPanel();
      });
      areaApplyProfileSelect.dataset.bound = '1';
    }

    const areaApplyButton = document.getElementById('areaApplyButton');
    if (areaApplyButton && !areaApplyButton.dataset.bound) {
      areaApplyButton.addEventListener('click', () => {
        const area = areaById(state.selectedAreaId || areaApplySelect?.value || null);
        if (!area) {
          toast('Áreas', 'Selecciona un área primero.', 'warn');
          return;
        }
        const profileId = Number(areaApplyProfileSelect?.value || area.perfil_base_id || 0) || null;
        applyAreaProfile(area.id, profileId).catch(handleAdminError);
      });
      areaApplyButton.dataset.bound = '1';
    }

    const btnNuevaArea = document.getElementById('btnNuevaArea');
    if (btnNuevaArea && !btnNuevaArea.dataset.bound) {
      btnNuevaArea.addEventListener('click', () => openAreaDrawer(null, 'new'));
      btnNuevaArea.dataset.bound = '1';
    }

    const vendorSelect = document.getElementById('assignUserSelect');
    if (vendorSelect && !vendorSelect.dataset.bound) {
      vendorSelect.addEventListener('change', event => {
        state.selectedVendorUserId = Number(event.target.value);
        resetVendorEditor();
        loadVendorRows(state.selectedVendorUserId);
      });
      vendorSelect.dataset.bound = '1';
    }

    if (!document.body.dataset.adminBindings) {
      document.body.addEventListener('click', event => {
        const tabButton = event.target.closest('[data-tab]');
        if (tabButton) {
          state.activeTab = tabButton.dataset.tab;
          renderTabs();
          if (state.activeTab === 'resumen') renderResumen();
          if (state.activeTab === 'permisos') renderPermissionPanel();
          if (state.activeTab === 'perfiles') renderProfilePanel();
          if (state.activeTab === 'asignaciones') {
            renderVendorSelect();
            loadVendorRows(state.selectedVendorUserId || state.users[0]?.id || null);
          }
          return;
        }

        const userAction = event.target.closest('[data-user-action]');
        if (userAction) {
          const userId = Number(userAction.dataset.id);
          const action = userAction.dataset.userAction;
          if (action === 'edit') openUserDrawer(userId, 'edit');
          if (action === 'permisos') openSelectedUserInPerms(userId);
          if (action === 'vendedores') openSelectedUserInVendors(userId);
          if (action === 'toggle') {
            state.drawer = { open: true, type: 'user', mode: 'edit', id: userId, readOnly: false };
            toggleCurrentDrawerStatus();
          }
          if (action === 'delete') {
            state.drawer = { open: true, type: 'user', mode: 'edit', id: userId, readOnly: false };
            deleteCurrentDrawer();
          }
          return;
        }

        const menuAction = event.target.closest('[data-menu-action]');
        if (menuAction) {
          const menuId = Number(menuAction.dataset.id);
          const action = menuAction.dataset.menuAction;
          if (action === 'edit') openMenuDrawer(menuId, 'edit');
          if (action === 'toggle') {
            state.drawer = { open: true, type: 'menu', mode: 'edit', id: menuId, readOnly: false };
            toggleCurrentDrawerStatus();
          }
          if (action === 'delete') {
            state.drawer = { open: true, type: 'menu', mode: 'edit', id: menuId, readOnly: false };
            deleteCurrentDrawer();
          }
          return;
        }

        const profileAction = event.target.closest('[data-profile-action]');
        if (profileAction) {
          const profileId = Number(profileAction.dataset.id);
          const action = profileAction.dataset.profileAction;
          if (action === 'edit') openProfileDrawer(profileId, 'edit');
          if (action === 'menus') openSelectedProfileInMenus(profileId);
          if (action === 'usuarios') openSelectedProfileInUsers(profileId);
          if (action === 'toggle') {
            state.drawer = { open: true, type: 'profile', mode: 'edit', id: profileId, readOnly: false };
            toggleCurrentDrawerStatus();
          }
          if (action === 'delete') {
            state.drawer = { open: true, type: 'profile', mode: 'edit', id: profileId, readOnly: false };
            deleteCurrentDrawer();
          }
          return;
        }

        const areaAction = event.target.closest('[data-area-action]');
        if (areaAction) {
          const areaId = Number(areaAction.dataset.id || 0);
          const areaCode = areaAction.dataset.area;
          if (areaAction.dataset.areaAction === 'edit') {
            openAreaDrawer(areaId, 'edit');
            return;
          }
          if (areaAction.dataset.areaAction === 'toggle') {
            state.drawer = { open: true, type: 'area', mode: 'edit', id: areaId, readOnly: false };
            toggleCurrentDrawerStatus();
            return;
          }
          if (areaAction.dataset.areaAction === 'users') {
            state.filters.area = areaCode;
            state.activeTab = 'usuarios';
            renderTabs();
            renderUsers();
            return;
          }
          if (areaAction.dataset.areaAction === 'apply-base') {
            applyAreaProfile(areaId, areaById(areaId)?.perfil_base_id || null);
            return;
          }
          if (areaAction.dataset.areaAction === 'view') {
            state.activeTab = 'permisos';
            renderTabs();
            const permAreaSelect = document.getElementById('permAreaSelect');
            if (permAreaSelect) permAreaSelect.value = areaCode;
            return;
          }
          if (areaAction.dataset.areaAction === 'apply') {
            const permAreaSelect = document.getElementById('permAreaSelect');
            if (permAreaSelect) permAreaSelect.value = areaCode;
            applyAreaPermissions();
          }
          return;
        }

        const permissionCheckbox = event.target.closest('[data-permission-id]');
        if (permissionCheckbox && permissionCheckbox.type === 'checkbox') {
          const menuId = Number(permissionCheckbox.dataset.permissionId);
          if (permissionCheckbox.checked) {
            state.permissionsDraft.add(menuId);
          } else {
            state.permissionsDraft.delete(menuId);
          }
          renderPermissionSummary();
          return;
        }

        const profileMenuCheckbox = event.target.closest('[data-profile-menu-id]');
        if (profileMenuCheckbox && profileMenuCheckbox.type === 'checkbox') {
          const menuId = Number(profileMenuCheckbox.dataset.profileMenuId);
          if (profileMenuCheckbox.checked) {
            state.profileMenuDraft.add(menuId);
          } else {
            state.profileMenuDraft.delete(menuId);
          }
          renderProfileMenuSummary();
          return;
        }

        const profileUserCheckbox = event.target.closest('[data-profile-user-id]');
        if (profileUserCheckbox && profileUserCheckbox.type === 'checkbox') {
          const profileId = Number(profileUserCheckbox.dataset.profileUserId);
          if (profileUserCheckbox.checked) {
            state.profileUserDraft.add(profileId);
          } else {
            state.profileUserDraft.delete(profileId);
          }
          renderProfileUserSummary();
          return;
        }

        const vendorAction = event.target.closest('[data-vendor-action]');
        if (vendorAction) {
          const action = vendorAction.dataset.vendorAction;
          const userId = Number(vendorAction.dataset.userId);
          const cod = vendorAction.dataset.cod;
          const tipo = vendorAction.dataset.tipo || 'P';
          handleVendorAction(action, userId, cod, tipo);
          return;
        }

        const quickAction = event.target.closest('[data-quick-action]');
        if (quickAction) {
          const action = quickAction.dataset.quickAction;
          if (action === 'create-user') openUserDrawer(null, 'new');
          if (action === 'create-profile') openProfileDrawer(null, 'new');
          if (action === 'create-menu') openMenuDrawer(null, 'new');
          if (action === 'create-area') openAreaDrawer(null, 'new');
          if (action === 'area-access') {
            state.activeTab = 'areas';
            renderTabs();
          }
          return;
        }
      });
      document.body.addEventListener('input', event => {
        const source = event.target.closest('[data-slug-source]');
        if (!source) return;
        const target = document.querySelector(source.dataset.slugSource);
        if (!target || target.disabled) return;
        if (target.dataset.manual === '1') return;
        target.value = slugifyCodigo(source.value);
        target.dataset.autoFilled = '1';
      });
      document.body.addEventListener('change', event => {
        const selector = event.target.closest('[data-profile-suggest]');
        if (!selector) return;
        const target = document.querySelector(selector.dataset.profileSuggest);
        if (!target || target.disabled) return;
        if (target.dataset.manual === '1' && target.value) return;
        target.value = suggestProfileCodeForArea(selector.value);
        target.dataset.autoSuggested = '1';
      });
      document.body.addEventListener('input', event => {
        const manualCode = event.target.closest('#adminUserCodigo, #adminMenuCodigo, #adminProfileCodigo');
        if (manualCode) {
          manualCode.dataset.manual = '1';
        }
      });
      document.body.dataset.adminBindings = '1';
    }

    const permSelectAll = document.getElementById('permSelectAll');
    if (permSelectAll && !permSelectAll.dataset.bound) {
      permSelectAll.addEventListener('click', () => {
        state.permissionsDraft = new Set(state.menus.map(menu => Number(menu.id)));
        renderPermissionGroups();
        renderPermissionSummary();
      });
      permSelectAll.dataset.bound = '1';
    }

    const permClearAll = document.getElementById('permClearAll');
    if (permClearAll && !permClearAll.dataset.bound) {
      permClearAll.addEventListener('click', () => {
        state.permissionsDraft = new Set();
        renderPermissionGroups();
        renderPermissionSummary();
      });
      permClearAll.dataset.bound = '1';
    }

    const permRestoreArea = document.getElementById('permRestoreArea');
    if (permRestoreArea && !permRestoreArea.dataset.bound) {
      permRestoreArea.addEventListener('click', applyAreaPermissions);
      permRestoreArea.dataset.bound = '1';
    }

    const permSave = document.getElementById('permSave');
    if (permSave && !permSave.dataset.bound) {
      permSave.addEventListener('click', () => savePermissions().catch(handleAdminError));
      permSave.dataset.bound = '1';
    }

    const profileMenuSave = document.getElementById('profileMenuSave');
    if (profileMenuSave && !profileMenuSave.dataset.bound) {
      profileMenuSave.addEventListener('click', () => saveProfileMenus().catch(handleAdminError));
      profileMenuSave.dataset.bound = '1';
    }

    const profileMenuSelectAll = document.getElementById('profileMenuSelectAll');
    if (profileMenuSelectAll && !profileMenuSelectAll.dataset.bound) {
      profileMenuSelectAll.addEventListener('click', () => {
        state.profileMenuDraft = new Set(state.menus.map(menu => Number(menu.id)));
        renderProfileMenuGroups();
        renderProfileMenuSummary();
      });
      profileMenuSelectAll.dataset.bound = '1';
    }

    const profileMenuClearAll = document.getElementById('profileMenuClearAll');
    if (profileMenuClearAll && !profileMenuClearAll.dataset.bound) {
      profileMenuClearAll.addEventListener('click', () => {
        state.profileMenuDraft = new Set();
        renderProfileMenuGroups();
        renderProfileMenuSummary();
      });
      profileMenuClearAll.dataset.bound = '1';
    }

    const profileUserSave = document.getElementById('profileUserSave');
    if (profileUserSave && !profileUserSave.dataset.bound) {
      profileUserSave.addEventListener('click', () => saveProfileUserAssignments().catch(handleAdminError));
      profileUserSave.dataset.bound = '1';
    }

    const profileUserSelect = document.getElementById('profileUserSelect');
    if (profileUserSelect && !profileUserSelect.dataset.bound) {
      profileUserSelect.addEventListener('change', event => {
        state.selectedProfileUserId = Number(event.target.value);
        syncProfileUserDraft(state.selectedProfileUserId);
      });
      profileUserSelect.dataset.bound = '1';
    }

    const addVendor = document.getElementById('btnAddAssignment');
    if (addVendor && !addVendor.dataset.bound) {
      addVendor.addEventListener('click', () => saveVendorRelation().catch(handleAdminError));
      addVendor.dataset.bound = '1';
    }

    const btnNewUser = document.getElementById('btnNuevoUsuario');
    if (btnNewUser && !btnNewUser.dataset.bound) {
      btnNewUser.addEventListener('click', () => openUserDrawer(null, 'new'));
      btnNewUser.dataset.bound = '1';
    }

    const btnNewMenu = document.getElementById('btnNuevoMenu');
    if (btnNewMenu && !btnNewMenu.dataset.bound) {
      btnNewMenu.addEventListener('click', () => openMenuDrawer(null, 'new'));
      btnNewMenu.dataset.bound = '1';
    }

    const btnNewProfile = document.getElementById('btnNuevoPerfil');
    if (btnNewProfile && !btnNewProfile.dataset.bound) {
      btnNewProfile.addEventListener('click', () => openProfileDrawer(null, 'new'));
      btnNewProfile.dataset.bound = '1';
    }

    const btnRefreshData = document.getElementById('btnRefreshData');
    if (btnRefreshData && !btnRefreshData.dataset.bound) {
      btnRefreshData.addEventListener('click', () => loadData());
      btnRefreshData.dataset.bound = '1';
    }

    const drawerClose = document.getElementById('drawerClose');
    if (drawerClose && !drawerClose.dataset.bound) {
      drawerClose.addEventListener('click', closeDrawer);
      drawerClose.dataset.bound = '1';
    }

    const drawerSecondary = document.getElementById('drawerSecondary');
    if (drawerSecondary && !drawerSecondary.dataset.bound) {
      drawerSecondary.addEventListener('click', () => {
        if (state.drawer.readOnly) {
          state.drawer.readOnly = false;
          renderDrawer();
          return;
        }
        closeDrawer();
      });
      drawerSecondary.dataset.bound = '1';
    }

    const drawerDanger = document.getElementById('drawerDanger');
    if (drawerDanger && !drawerDanger.dataset.bound) {
      drawerDanger.addEventListener('click', toggleCurrentDrawerStatus);
      drawerDanger.dataset.bound = '1';
    }

    const drawerDelete = document.getElementById('drawerDelete');
    if (drawerDelete && !drawerDelete.dataset.bound) {
      drawerDelete.addEventListener('click', deleteCurrentDrawer);
      drawerDelete.dataset.bound = '1';
    }

    const drawerPrimary = document.getElementById('drawerPrimary');
    if (drawerPrimary && !drawerPrimary.dataset.bound) {
      drawerPrimary.addEventListener('click', saveCurrentDrawer);
      drawerPrimary.dataset.bound = '1';
    }

    const overlay = document.getElementById('drawerOverlay');
    if (overlay && !overlay.dataset.bound) {
      overlay.addEventListener('click', event => {
        if (event.target === event.currentTarget) closeDrawer();
      });
      overlay.dataset.bound = '1';
    }

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout && !btnLogout.dataset.bound) {
      btnLogout.addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        localStorage.removeItem('usuario');
        sessionStorage.removeItem('texpro_user');
        window.location.href = '/src/modulo/varios/login/index.html';
      });
      btnLogout.dataset.bound = '1';
    }

    const sidebarToggle = document.getElementById('sidebarToggle');
    if (sidebarToggle && !sidebarToggle.dataset.bound) {
      sidebarToggle.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('sidebar--collapsed');
        document.getElementById('mainWrapper')?.classList.toggle('main-wrapper--expanded');
      });
      sidebarToggle.dataset.bound = '1';
    }

    const headerMenuBtn = document.getElementById('headerMenuBtn');
    if (headerMenuBtn && !headerMenuBtn.dataset.bound) {
      headerMenuBtn.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.toggle('mobile-open');
      });
      headerMenuBtn.dataset.bound = '1';
    }
  }

  function renderAll() {
    renderHeader();
    renderResumen();
    renderTabs();
    renderUsers();
    renderMenus();
    renderProfiles();
    renderAreas();
    renderPermissionSelects();
    renderPermissionSummary();
    renderPermissionGroups();
    renderProfileUserSelects();
    renderProfileUserSummary();
    renderProfileMenuSummary();
    renderVendorSelect();
    renderAudit();
    renderDrawer();
    bindEvents();
  }

  function setLoading(text = 'Cargando información real...', type = 'info') {
    state.loading = true;
    setMessage(text, type);
    renderLoadingState();
  }

  async function init() {
    const acceso = await verificarAccesoAdmin();
    if (!acceso) return;
    setLoading();
    await loadData();
  }

  window.__ADMIN_API__ = {
    state,
    loadData,
    renderAll,
    openUserDrawer,
    openMenuDrawer,
    openProfileDrawer,
    closeDrawer,
    renderProfilePanel,
  };
  window.__ADMIN_MOCK__ = window.__ADMIN_API__;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();




