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
    selectedUserIds: new Set(),
    profileUserMode: 'bulk',
    profileUserSearch: '',
    profileUserLoading: false,
    profileUserDraftRequest: 0,
    selectedProfileIds: new Set(),
    replaceProfileAccesses: false,
    selectedVendorUserId: null,
    selectedAreaId: null,
    selectedAreaProfileId: null,
    permissionsDraft: new Set(),
    permissionAccess: null,
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

  function getAuthToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  }

  async function syncAuthContext({ redirectOnFail = false } = {}) {
    const token = getAuthToken();
    if (!token) {
      if (redirectOnFail) {
        window.location.href = '/src/modulo/varios/login/index.html';
      }
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
      window.dispatchEvent(new CustomEvent('texpro:auth-updated', { detail: { user } }));

      return user;
    } catch (error) {
      if (redirectOnFail) {
        window.location.href = '/src/modulo/varios/login/index.html';
      }
      return null;
    }
  }

  async function verificarAccesoAdmin() {
    const token = getAuthToken();
    if (!token) {
      window.location.href = '/src/modulo/varios/login/index.html';
      return null;
    }

    return syncAuthContext({ redirectOnFail: true });
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

    const rawText = await response.text();
    let payload = null;
    if (rawText.trim() !== '') {
      try {
        payload = JSON.parse(rawText);
      } catch (parseError) {
        const error = new Error(`Respuesta inválida desde ${path}: el backend no devolvió JSON válido.`);
        error.status = response.status;
        error.payload = rawText;
        error.cause = parseError;
        throw error;
      }
    }

    if (response.ok && payload === null) {
      const error = new Error(`Respuesta vacía desde ${path}: se esperaba JSON con data.`);
      error.status = response.status;
      error.payload = rawText;
      throw error;
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

  function groupKeyFromLabel(label) {
    return normalizeKey(label || 'general');
  }

  function formatMenuNodeLabel(segment) {
    const raw = String(segment || '').trim().replace(/[-_]+/g, ' ');
    if (!raw) return '';
    const normalized = normalizeKey(raw);
    const special = { rrhh: 'RRHH', ti: 'TI', it: 'IT' };
    if (special[normalized]) return special[normalized];
    return raw.replace(/\s+/g, ' ').replace(/\b\w/g, match => match.toUpperCase());
  }

  function getMenuPathSegments(menu) {
    const path = normalizeText(menu?.url || '').split('?')[0];
    if (!path) return [];

    const parts = path.split('/').filter(Boolean);
    const moduleIndex = parts.indexOf('modulo');
    let segments = moduleIndex >= 0 ? parts.slice(moduleIndex + 2) : parts.slice();

    if (segments.length && /index\.html$/i.test(segments[segments.length - 1])) {
      segments.pop();
    }

    if (!segments.length) return [];

    const groupKey = groupKeyFromLabel(menu?.grupo || '');
    if (normalizeKey(segments[0]) === groupKey) {
      segments = segments.slice(1);
    }

    return segments.map(segment => String(segment || '').trim()).filter(Boolean);
  }

  function createMenuTree(menus) {
    const grouped = groupMenus(menus);

    return grouped.map(group => {
      const groupNode = {
        key: `group:${groupKeyFromLabel(group.group)}`,
        type: 'group',
        label: group.group,
        icon: group.icono || '📁',
        orden: Number(group.orden) || 0,
        children: [],
      };

      const findOrCreateChild = (parent, key, label, type) => {
        parent.children ??= [];
        let child = parent.children.find(node => node.key === key);
        if (!child) {
          child = {
            key,
            type,
            label,
            children: [],
            orden: Number.MAX_SAFE_INTEGER,
          };
          parent.children.push(child);
        }
        return child;
      };

      group.items
        .slice()
        .sort((a, b) => (Number(a.orden) - Number(b.orden)) || a.nombre.localeCompare(b.nombre, 'es'))
        .forEach(menu => {
          const segments = getMenuPathSegments(menu);
          if (!segments.length) {
            groupNode.children.push({
              key: `menu:${menu.id}`,
              type: 'menu',
              label: menu.nombre,
              menu,
              children: [],
              orden: Number(menu.orden) || 0,
            });
            return;
          }

          const folders = segments.slice(0, -1);
          let parent = groupNode;
          let pathKey = groupNode.key;

          folders.forEach((segment, index) => {
            pathKey = `${pathKey}/${normalizeKey(segment) || `lvl${index + 1}`}`;
            parent = findOrCreateChild(parent, `folder:${pathKey}`, formatMenuNodeLabel(segment), 'folder');
            if (parent.orden === Number.MAX_SAFE_INTEGER) {
              parent.orden = Number(menu.orden) || 0;
            }
          });

          parent.children.push({
            key: `menu:${menu.id}`,
            type: 'menu',
            label: menu.nombre,
            menu,
            children: [],
            orden: Number(menu.orden) || 0,
          });
        });

      const sortChildren = node => {
        if (!Array.isArray(node.children) || !node.children.length) {
          return Number(node.orden) || 0;
        }

        node.children.forEach(sortChildren);
        node.children.sort((a, b) => {
          const aOrder = Number.isFinite(Number(a.orden)) ? Number(a.orden) : Number.MAX_SAFE_INTEGER;
          const bOrder = Number.isFinite(Number(b.orden)) ? Number(b.orden) : Number.MAX_SAFE_INTEGER;
          return (aOrder - bOrder) || a.label.localeCompare(b.label, 'es');
        });

        const childOrders = node.children
          .map(child => Number(child.orden))
          .filter(order => Number.isFinite(order));
        const minOrder = childOrders.length ? Math.min(...childOrders) : Number(node.orden) || 0;
        node.orden = Number.isFinite(minOrder) ? minOrder : Number(node.orden) || 0;
        return node.orden;
      };

      sortChildren(groupNode);
      return groupNode;
    });
  }

  function collectMenuIdsFromNode(node) {
    if (!node) return [];
    if (node.type === 'menu') {
      return node.menu?.id != null ? [Number(node.menu.id)] : [];
    }
    return (Array.isArray(node.children) ? node.children : []).flatMap(child => collectMenuIdsFromNode(child));
  }

  function computeNodeSelectionState(node, selectedIds) {
    const leafIds = collectMenuIdsFromNode(node);
    const total = leafIds.length;
    const selected = leafIds.reduce((count, id) => count + (selectedIds.has(Number(id)) ? 1 : 0), 0);

    return {
      total,
      selected,
      checked: total > 0 && selected === total,
      indeterminate: selected > 0 && selected < total,
      leafIds,
    };
  }

  function renderProfileMenuNode(node, selectedIds, depth = 0) {
    const stateInfo = computeNodeSelectionState(node, selectedIds);
    const ids = stateInfo.leafIds.join(',');
    const isLeaf = node.type === 'menu';
    const badgeClass = stateInfo.checked
      ? 'badge--ok'
      : stateInfo.indeterminate
        ? 'badge--info'
        : 'badge--blocked';
    const badgeText = isLeaf
      ? (stateInfo.checked ? 'Asignado' : 'Bloqueado')
      : stateInfo.indeterminate
        ? `${stateInfo.selected}/${stateInfo.total}`
        : stateInfo.checked
          ? `${stateInfo.total}/${stateInfo.total}`
          : `0/${stateInfo.total}`;
    const inactiveClass = isLeaf && node.menu?.activo === false ? ' is-inactive' : '';
    const indentStyle = depth > 0 ? ` style="--profile-menu-depth:${depth}"` : '';

    return `
      <div class="profile-menu-node profile-menu-node--${isLeaf ? 'leaf' : 'branch'}${inactiveClass}"${indentStyle}
           data-profile-menu-node="1"
           data-profile-menu-node-key="${escHtml(node.key)}"
           data-profile-menu-node-ids="${escHtml(ids)}"
           data-profile-menu-node-kind="${isLeaf ? 'menu' : 'branch'}">
        <label class="permission-item profile-menu-row">
          <span class="permission-item__label profile-menu-row__label">
            <input type="checkbox"
              data-profile-menu-id="${isLeaf ? escHtml(node.menu?.id ?? '') : escHtml(node.key)}"
              data-profile-menu-node-key="${escHtml(node.key)}"
              data-profile-menu-node-ids="${escHtml(ids)}"
              data-node-indeterminate="${stateInfo.indeterminate ? '1' : '0'}"
              ${stateInfo.checked ? 'checked' : ''}
              ${stateInfo.indeterminate ? 'aria-checked="mixed"' : ''}
            />
            <strong>${escHtml(node.label)}</strong>
          </span>
          <span class="badge ${badgeClass}">${escHtml(badgeText)}</span>
        </label>
        ${isLeaf
          ? `<small class="field-help profile-menu-row__meta">${node.menu?.activo === false ? 'Inactivo' : 'Activo'} · ${escHtml(node.menu?.grupo || 'General')}</small>`
          : ''
        }
        ${Array.isArray(node.children) && node.children.length
          ? `<div class="profile-menu-children">${node.children.map(child => renderProfileMenuNode(child, selectedIds, depth + 1)).join('')}</div>`
          : ''
        }
      </div>
    `;
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

  function areaMemberCodes(areaCode) {
    const area = areaByCode(areaCode);
    const baseCode = normalizeKey(area?.perfil_base_codigo || area?.codigo || areaCode);
    if (!baseCode) {
      return new Set();
    }
    return new Set([baseCode]);
  }

  function userBelongsToArea(user, areaCode) {
    const area = areaByCode(areaCode);
    const baseCode = normalizeKey(area?.perfil_base_codigo || area?.codigo || areaCode);
    if (!baseCode) {
      return true;
    }
    return Array.isArray(user.perfiles)
      && user.perfiles.some(profile => normalizeKey(profile.codigo) === baseCode && profile.activo !== false);
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
      const byArea = !state.filters.area || userBelongsToArea(user, state.filters.area);
      const byStatus = !state.filters.status
        || (state.filters.status === 'activo' && user.is_active)
        || (state.filters.status === 'inactivo' && !user.is_active);
      const byAdmin = !state.filters.admin
        || (state.filters.admin === 'admin' && user.is_admin)
        || (state.filters.admin === 'no-admin' && !user.is_admin);
      return bySearch && byArea && byStatus && byAdmin;
    });
  }

  function selectedUsers() {
    return state.users
      .filter(user => state.selectedUserIds.has(Number(user.id)))
      .filter(Boolean);
  }

  function filteredProfileUsers() {
    const search = normalizeText(state.profileUserSearch).toLowerCase();
    return state.users.filter(user => {
      if (!search) return true;
      return [user.nombre, user.email, user.codigo, formatAreaLabel(user.area)]
        .some(value => normalizeText(value).toLowerCase().includes(search));
    });
  }

  async function setProfileUserMode(mode) {
    if (!['bulk', 'single'].includes(mode) || state.profileUserMode === mode) {
      return;
    }

    state.profileUserMode = mode;
    state.profileUserSearch = '';

    if (mode === 'single') {
      state.selectedUserIds = new Set();
      const targetId = state.selectedProfileUserId || state.users[0]?.id || null;
      state.selectedProfileUserId = targetId ? Number(targetId) : null;
      if (targetId) {
        await syncProfileUserDraft(Number(targetId));
        return;
      }
    }

    renderProfileUserSelects();
    renderProfileUserSummary();
    renderProfileUserList();
    renderUsers();
  }

  function profileUserTargets() {
    if (isBulkProfileMode()) {
      const selected = selectedUsers();
      if (selected.length > 0) {
        return selected;
      }
      return [];
    }
    const single = selectedProfileUser();
    return single ? [single] : [];
  }

  function isBulkProfileMode() {
    return state.profileUserMode === 'bulk';
  }

  function manualProfiles() {
    return state.profiles.filter(profile => !profile.es_base);
  }

  function userProfileIdSet(user) {
    return new Set(
      Array.isArray(user?.perfiles)
        ? user.perfiles.map(profile => Number(profile.id)).filter(id => Number.isFinite(id) && id > 0)
        : []
    );
  }

  function profileAggregateState(profile, targets) {
    const total = targets.length;
    let selected = 0;
    targets.forEach(user => {
      if (userProfileIdSet(user).has(Number(profile.id))) {
        selected += 1;
      }
    });
    return {
      total,
      selected,
      checked: total > 0 && selected === total,
      indeterminate: selected > 0 && selected < total,
    };
  }

  function updateUserSelectionSummary() {
    const count = document.getElementById('selectedUsersCount');
    if (count) {
      count.textContent = String(state.selectedUserIds.size);
    }

    const selectAll = document.getElementById('usersSelectAllToggle');
    const rows = filteredUsers();
    const visibleSelected = rows.filter(user => state.selectedUserIds.has(Number(user.id))).length;
    if (selectAll) {
      selectAll.checked = rows.length > 0 && visibleSelected === rows.length;
      selectAll.indeterminate = visibleSelected > 0 && visibleSelected < rows.length;
      selectAll.disabled = !rows.length;
    }

    const clearButton = document.getElementById('usersClearSelection');
    if (clearButton) {
      clearButton.disabled = state.selectedUserIds.size === 0;
    }
  }

  function syncUserSelectionFromRows(ids) {
    state.selectedUserIds = new Set(ids);
    if (ids.length > 0) {
      state.profileUserMode = 'bulk';
    }
    updateUserSelectionSummary();
    renderProfileUserSelects();
    renderProfileUserSummary();
    renderProfileUserList();
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
      tbody.innerHTML = '<tr class="row-empty"><td colspan="11">No hay usuarios para los filtros seleccionados.</td></tr>';
      updateUserSelectionSummary();
      return;
    }

    tbody.innerHTML = rows.map(user => `
      <tr>
        <td class="table-select-cell">
          <input type="checkbox" data-user-select-id="${escHtml(user.id)}" ${state.selectedUserIds.has(Number(user.id)) ? 'checked' : ''} />
        </td>
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

    updateUserSelectionSummary();
  }

  function renderMenusPreview() {
    const preview = document.getElementById('menusPreview');
    if (!preview) return;

    const tree = createMenuTree(state.menus.filter(menu => menu.activo));
    if (!tree.length) {
      preview.innerHTML = '<div class="mini-empty">No hay menús activos.</div>';
      return;
    }

    const renderPreviewNode = (node, depth = 0) => {
      if (node.type === 'menu') {
        const menu = node.menu || {};
        return `
          <div class="sidebar-preview__item ${menu.activo ? '' : 'is-disabled'}" style="margin-left:${depth * 14}px">
            <span>${escHtml(menu.icono || '?')}</span>
            <span>${escHtml(menu.nombre)}</span>
            ${menu.activo ? '<span class="badge badge--ok">Activo</span>' : '<span class="badge badge--blocked">Inactivo</span>'}
          </div>
        `;
      }

      const children = Array.isArray(node.children) ? node.children.map(child => renderPreviewNode(child, depth + 1)).join('') : '';
      const groupBadge = node.type === 'group'
        ? `<span class="badge badge--neutral">${collectMenuIdsFromNode(node).length} menús</span>`
        : '';
      return `
        <div class="sidebar-preview__branch" style="margin-left:${depth * 14}px">
          <div class="sidebar-preview__item sidebar-preview__item--folder">
            <span>${node.icon || '📁'}</span>
            <span>${escHtml(node.label)}</span>
            ${groupBadge}
          </div>
          ${children}
        </div>
      `;
    };

    preview.innerHTML = tree.map(group => `
      <div class="sidebar-preview__group">
        <h5>${escHtml(group.label)}</h5>
        ${Array.isArray(group.children) ? group.children.map(child => renderPreviewNode(child, 1)).join('') : ''}
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
        ? 'Selecciona los módulos y submódulos que heredarán todos los usuarios con este perfil.'
        : 'Este perfil no tiene menús asignados. Los usuarios con este perfil no recibirán accesos desde él.';
    }
  }

  function renderProfileMenuGroups() {
    const container = document.getElementById('profileMenuGroups');
    if (!container) return;

    const tree = createMenuTree(state.menus);
    if (!tree.length) {
      container.innerHTML = '<div class="mini-empty">Sin menús para mostrar.</div>';
      return;
    }

    container.innerHTML = tree.map(group => {
      const stateInfo = computeNodeSelectionState(group, state.profileMenuDraft);
      const ids = stateInfo.leafIds.join(',');
      const badgeClass = stateInfo.checked
        ? 'badge--ok'
        : stateInfo.indeterminate
          ? 'badge--info'
          : 'badge--blocked';
      const badgeText = stateInfo.indeterminate
        ? `${stateInfo.selected}/${stateInfo.total}`
        : `${stateInfo.selected}/${stateInfo.total}`;

      return `
        <article class="permission-group profile-menu-group" data-profile-menu-group="${escHtml(group.key)}">
          <div class="permission-group__header profile-menu-group__header">
            <label class="profile-menu-group__title">
              <input type="checkbox"
                data-profile-menu-id="${escHtml(group.key)}"
                data-profile-menu-node-key="${escHtml(group.key)}"
                data-profile-menu-node-ids="${escHtml(ids)}"
                data-node-indeterminate="${stateInfo.indeterminate ? '1' : '0'}"
                ${stateInfo.checked ? 'checked' : ''}
                ${stateInfo.indeterminate ? 'aria-checked="mixed"' : ''}
              />
              <span>${escHtml(group.label)}</span>
            </label>
            <span class="permission-group__count">${stateInfo.selected}/${stateInfo.total} menús</span>
          </div>
          <div class="profile-menu-tree">
            ${Array.isArray(group.children) ? group.children.map(child => renderProfileMenuNode(child, state.profileMenuDraft, 1)).join('') : ''}
          </div>
        </article>
      `;
    }).join('');

    syncProfileMenuCheckboxStates(container);
  }

  function syncProfileMenuCheckboxStates(container) {
    if (!container) return;
    container.querySelectorAll('input[data-node-indeterminate="1"]').forEach(input => {
      if ('indeterminate' in input) {
        input.indeterminate = true;
      }
    });
  }

  function renderProfileUserSelects() {
    const bulkPanel = document.getElementById('profileUserBulkPanel');
    const singlePanel = document.getElementById('profileUserSinglePanel');
    const modeBulk = document.getElementById('profileUserModeBulk');
    const modeSingle = document.getElementById('profileUserModeSingle');
    const userSelect = document.getElementById('profileUserSelect');
    const bulkMode = isBulkProfileMode();

    if (modeBulk) {
      modeBulk.classList.toggle('is-active', bulkMode);
    }
    if (modeSingle) {
      modeSingle.classList.toggle('is-active', !bulkMode);
    }
    if (bulkPanel) {
      bulkPanel.hidden = !bulkMode;
    }
    if (singlePanel) {
      singlePanel.hidden = bulkMode;
    }

    if (userSelect) {
      userSelect.innerHTML = state.users.map(user => `
        <option value="${escHtml(user.id)}">${escHtml(user.nombre)} - ${escHtml(user.email || 'sin correo')} - ${escHtml(formatAreaLabel(user.area))}</option>
      `).join('');
      if (!bulkMode && state.selectedProfileUserId) {
        userSelect.value = String(state.selectedProfileUserId);
      }
    }

    const searchInput = document.getElementById('profileUserSearch');
    if (searchInput && searchInput.value !== state.profileUserSearch) {
      searchInput.value = state.profileUserSearch;
    }

    const picker = document.getElementById('profileUserPicker');
    if (picker) {
      const rows = filteredProfileUsers();
      if (!bulkMode) {
        picker.innerHTML = '<div class="mini-empty">La selección múltiple se activa desde este mismo bloque cuando la necesitas.</div>';
      } else if (!rows.length) {
        picker.innerHTML = '<div class="mini-empty">No hay usuarios que coincidan con el filtro.</div>';
      } else {
        picker.innerHTML = rows.map(user => `
          <label class="profile-user-item">
            <span class="profile-user-item__label">
              <input type="checkbox" data-user-id="${escHtml(user.id)}" ${state.selectedUserIds.has(Number(user.id)) ? 'checked' : ''} />
              <strong>${escHtml(user.nombre)}</strong>
            </span>
            <span class="profile-user-item__meta">${escHtml(user.email || 'sin correo')} · ${escHtml(formatAreaLabel(user.area))}</span>
          </label>
        `).join('');
      }
    }
  }
  function renderProfileUserSummary() {
    const assignedCount = document.getElementById('profileUserAssignedCount');
    if (assignedCount) assignedCount.textContent = String(isBulkProfileMode() ? state.selectedProfileIds.size : state.profileUserDraft.size);

    const selectedCount = document.getElementById('profileUserSelectionCount');
    if (selectedCount) {
      selectedCount.textContent = String(isBulkProfileMode() ? selectedUsers().length : (state.selectedProfileUserId ? 1 : 0));
    }

    const modeLabel = document.getElementById('profileUserModeLabel');
    if (modeLabel) {
      modeLabel.textContent = isBulkProfileMode() ? 'Selección múltiple' : 'Usuario único';
    }

    const heading = document.getElementById('profileUserHeading');
    if (heading) {
      heading.textContent = isBulkProfileMode()
        ? 'Perfiles para usuarios seleccionados'
        : 'Perfiles por usuario';
    }

    const singleButton = document.getElementById('profileUserSave');
    const bulkAssignButton = document.getElementById('profileBulkAssign');
    const bulkRemoveButton = document.getElementById('profileBulkRemove');
    if (singleButton) {
      singleButton.hidden = isBulkProfileMode();
      singleButton.disabled = isBulkProfileMode() || state.profileUserLoading;
      singleButton.textContent = 'Guardar perfiles';
    }
    if (bulkAssignButton) {
      bulkAssignButton.hidden = !isBulkProfileMode();
      bulkAssignButton.disabled = !isBulkProfileMode() || !state.selectedUserIds.size || !state.selectedProfileIds.size;
    }
    if (bulkRemoveButton) {
      bulkRemoveButton.hidden = !isBulkProfileMode();
      bulkRemoveButton.disabled = !isBulkProfileMode() || !state.selectedUserIds.size || !state.selectedProfileIds.size;
    }

    refreshProfileBulkReplaceState();

    const note = document.getElementById('profileUserNote');
    if (note) {
      note.textContent = isBulkProfileMode()
        ? 'Selecciona uno o varios usuarios en la lista, luego elige uno o varios perfiles y usa Asignar o Quitar. El perfil base del área se mantiene automático.'
        : 'Selecciona un usuario para editar sus perfiles manuales. El perfil base del área se mantiene automático.';
    }

    const preview = document.getElementById('profileUserSelectionList');
    if (preview) {
      const targets = isBulkProfileMode() ? selectedUsers() : [selectedProfileUser()].filter(Boolean);
      preview.innerHTML = targets.length
        ? targets.map(user => `
            <span class="summary-chip selected-user-chip">${escHtml(user.nombre)}<small>${escHtml(formatAreaLabel(user.area))}</small></span>
          `).join('')
        : '<div class="mini-empty">Selecciona uno o más usuarios para habilitar acciones masivas.</div>';
    }

    renderProfileBulkPreview();
  }

  function renderProfileUserList() {
    const container = document.getElementById('profileUserGroups');
    if (!container) return;

    if (!state.profiles.length) {
      container.innerHTML = '<div class="mini-empty">No hay perfiles para asignar.</div>';
      return;
    }

    const bulkMode = isBulkProfileMode();
    if (!bulkMode && state.profileUserLoading) {
      container.innerHTML = '<div class="mini-empty">Cargando perfiles del usuario seleccionado...</div>';
      return;
    }

    const grouped = state.profiles
      .slice()
      .sort((a, b) => (Number(b.es_base) - Number(a.es_base)) || a.nombre.localeCompare(b.nombre, 'es'));

    if (bulkMode) {
      container.innerHTML = grouped.map(profile => {
        const profileId = Number(profile.id);
        const checked = state.selectedProfileIds.has(profileId);
        return `
          <label class="permission-item permission-item--bulk">
            <span class="permission-item__label">
              <input type="checkbox" data-profile-id="${escHtml(profile.id)}" ${checked ? 'checked' : ''} />
              <strong>${escHtml(profile.nombre)}</strong>
            </span>
            <span class="badge ${profile.es_base ? 'badge--ok' : 'badge--blocked'}">${profile.es_base ? 'Base' : 'Manual'}</span>
          </label>
        `;
      }).join('');
      return;
    }

    container.innerHTML = grouped.map(profile => {
      const checked = state.profileUserDraft.has(Number(profile.id));
      const locked = !bulkMode && profile.es_base && normalizeKey(profile.area) === normalizeKey(userById(state.selectedProfileUserId)?.area);
      return `
        <label class="permission-item">
          <span class="permission-item__label">
            <input type="checkbox"
              data-profile-id="${escHtml(profile.id)}"
              ${checked ? 'checked' : ''}
              ${locked ? 'disabled' : ''}
            />
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

    const requestId = state.profileUserDraftRequest + 1;
    state.profileUserDraftRequest = requestId;
    state.profileUserLoading = true;
    renderProfileUserSummary();
    renderProfileUserList();

    try {
      const response = await apiFetch(`/usuarios/${userId}/perfiles`);
      if (requestId !== state.profileUserDraftRequest) {
        return;
      }
      const assigned = Array.isArray(response.data) ? response.data : [];
      state.profileUserDraft = new Set(assigned.map(profile => Number(profile.id)));
      state.selectedProfileUserId = Number(userId);
      state.selectedUserIds = new Set();
      state.profileUserMode = 'single';
      state.profileUserSearch = '';
    } catch (error) {
      if (requestId !== state.profileUserDraftRequest) {
        return;
      }
      toast('Perfiles', error.message, 'error');
    } finally {
      if (requestId === state.profileUserDraftRequest) {
        state.profileUserLoading = false;
        renderProfileUserSelects();
        renderProfileUserSummary();
        renderProfileUserList();
      }
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
      const access = response.data || {};
      const menus = Array.isArray(access.menus) ? access.menus : [];
      state.permissionAccess = access;
      state.permissionsDraft = new Set(menus.filter(menu => menu.permitido).map(menu => Number(menu.id)));
      state.selectedPermUserId = Number(userId);
      renderPermissionSelects();
      renderPermissionSummary();
      renderPermissionGroups();
    } catch (error) {
      toast('Permisos', error.message, 'error');
    }
  }

  function renderPermissionSummary() {
    const summary = state.permissionAccess?.resumen || {};
    const allowed = Number(summary.efectivos ?? state.permissionsDraft.size ?? 0);
    const direct = Number(summary.directos ?? 0);
    const inherited = Number(summary.heredados ?? Math.max(allowed - direct, 0));
    const blocked = Number(summary.bloqueados ?? Math.max(state.menus.length - allowed, 0));
    const allowedCount = document.getElementById('permAllowedCount');
    const directCount = document.getElementById('permDirectCount');
    const inheritedCount = document.getElementById('permInheritedCount');
    const blockedCount = document.getElementById('permBlockedCount');
    if (allowedCount) allowedCount.textContent = String(allowed);
    if (directCount) directCount.textContent = String(direct);
    if (inheritedCount) inheritedCount.textContent = String(inherited);
    if (blockedCount) blockedCount.textContent = String(Math.max(blocked, 0));
  }

  function renderPermissionGroups() {
    const container = document.getElementById('permGroups');
    if (!container) return;

    const sourceMenus = Array.isArray(state.permissionAccess?.menus) && state.permissionAccess.menus.length
      ? state.permissionAccess.menus
      : state.menus.map(menu => ({
          ...menu,
          permitido: false,
          origen: 'ninguno',
          perfiles: [],
          directo: false,
        }));

    const grouped = groupMenus(sourceMenus);
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
            const checked = Boolean(menu.permitido);
            const badgeLabel = !checked
              ? 'Bloqueado'
              : menu.origen === 'directo'
                ? 'Asignado'
                : 'Heredado';
            const perfiles = Array.isArray(menu.perfiles) && menu.perfiles.length
              ? menu.perfiles.map(perfil => perfil.nombre || perfil.codigo).filter(Boolean).join(', ')
              : '';
            return `
              <label class="permission-item">
                <span class="permission-item__label">
                  <input type="checkbox" data-permission-id="${escHtml(menu.id)}" ${checked ? 'checked' : ''} disabled />
                  <strong>${escHtml(menu.nombre)}</strong>
                </span>
                <span class="badge ${checked ? (menu.origen === 'directo' ? 'badge--info' : 'badge--ok') : 'badge--blocked'}">${escHtml(badgeLabel)}</span>
                ${perfiles ? `<small class="field-help">Perfil(es): ${escHtml(perfiles)}</small>` : ''}
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
    const selected = selectedPermissionUser();
    if (selected) {
      await syncPermissionDraft(selected.id);
    }
  }

  function selectedProfile() {
    return profileById(state.selectedProfileId || state.profiles[0]?.id || null);
  }

  function selectedProfileUser() {
    if (isBulkProfileMode()) {
      const bulk = selectedUsers();
      if (bulk.length === 1) {
        return bulk[0];
      }
    }
    return userById(state.selectedProfileUserId || state.users[0]?.id || null);
  }

  async function renderProfilePanel() {
    const selected = selectedProfile();
    if (selected) {
      await syncProfileMenuDraft(selected.id);
    } else {
      renderProfileMenuSummary();
      renderProfileMenuGroups();
    }

    if (isBulkProfileMode()) {
      renderProfileUserSelects();
      renderProfileUserSummary();
      renderProfileUserList();
    } else {
      const selectedUser = selectedProfileUser();
      if (selectedUser) {
        await syncProfileUserDraft(selectedUser.id);
      } else {
        renderProfileUserSelects();
        renderProfileUserSummary();
        renderProfileUserList();
      }
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
      subtitle.textContent = 'Historial real sincronizado desde la base de datos.';
    }
    if (!container) return;

    if (!state.audit.length) {
      container.innerHTML = '<div class="mini-empty">Todavía no hay eventos de auditoría registrados.</div>';
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

  function mapAuditItem(item) {
    return {
      id: item?.id || null,
      title: item?.accion || item?.title || 'Auditoría',
      when: item?.fecha_formato || item?.creado_en || new Date().toLocaleString('es-CL'),
      actor: item?.usuario_nombre || item?.actor || currentUserName(),
      detail: item?.detalle || item?.detail || '',
      entidad: item?.entidad || '',
      entidadId: item?.entidad_id || null,
    };
  }

  async function pushAudit(title, detail, entidad = 'administrador', entidadId = null) {
    try {
      const response = await apiFetch('/auditoria', {
        method: 'POST',
        body: JSON.stringify({
          accion: title,
          detalle: detail,
          entidad,
          entidad_id: entidadId,
        }),
      });
      const entry = mapAuditItem(response?.data || {
        accion: title,
        detalle: detail,
        entidad,
        entidad_id: entidadId,
        usuario_nombre: currentUserName(),
        creado_en: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      state.audit.unshift(entry);
      renderAudit();
    } catch (error) {
      console.warn('[admin.audit]', error);
    }
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
      const [usersRes, menusRes, areasRes, profilesRes, auditsRes] = await Promise.all([
        apiFetch('/usuarios'),
        apiFetch('/menus'),
        apiFetch('/areas'),
        apiFetch('/perfiles'),
        apiFetch('/auditoria?limit=20'),
      ]);

      state.users = Array.isArray(usersRes.data) ? usersRes.data : [];
      state.menus = Array.isArray(menusRes.data) ? menusRes.data : [];
      state.areas = Array.isArray(areasRes.data) ? areasRes.data : [];
      state.profiles = Array.isArray(profilesRes.data) ? profilesRes.data : [];
      state.audit = Array.isArray(auditsRes.data) ? auditsRes.data.map(mapAuditItem) : [];
      state.selectedUserIds = new Set(Array.from(state.selectedUserIds).filter(id => userById(id)));
      state.selectedPermUserId = state.selectedPermUserId || state.users[0]?.id || null;
      state.selectedProfileId = state.selectedProfileId || state.profiles[0]?.id || null;
      state.selectedProfileUserId = state.selectedProfileUserId || state.users[0]?.id || null;
      state.selectedVendorUserId = state.selectedVendorUserId || state.users[0]?.id || null;
      state.selectedAreaId = state.selectedAreaId || state.areas[0]?.id || null;
      state.selectedAreaProfileId = state.selectedAreaProfileId || state.areas.find(area => Number(area.id) === Number(state.selectedAreaId))?.perfil_base_id || null;
      state.lastUpdated = new Date().toISOString();
      state.loading = false;
      state.error = '';

      await syncAuthContext();
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
      if (usersBody) usersBody.innerHTML = '<tr class="row-empty"><td colspan="11">Cargando usuarios...</td></tr>';
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
        await pushAudit('Usuario creado', `Se creó el usuario ${nombre}.`);
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
        await pushAudit('Usuario actualizado', `Se actualizaron los datos de ${nombre}.`);
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
        await pushAudit('Menú creado', `Se creó el menú ${payload.nombre}.`);
        toast('Menús', 'Menú creado correctamente.', 'success');
      } else {
        await apiFetch(`/menus/${state.drawer.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        await pushAudit('Menú actualizado', `Se actualizó el menú ${payload.nombre}.`);
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
      await pushAudit('Usuario desactivado', `Se desactivó a ${current.nombre}.`);
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
      await pushAudit('Perfil eliminado', `Se eliminó o desactivó el perfil ${currentProfile.nombre}.`);
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
    await pushAudit('Menú eliminado', `Se eliminó o desactivó el menú ${current.nombre}.`);
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
      await pushAudit(nextActive ? 'Usuario activado' : 'Usuario desactivado', `${current.nombre} cambió de estado.`);
      toast('Usuarios', `Usuario ${nextActive ? 'activado' : 'desactivado'}.`, 'success');
      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'menu') {
      const current = menuById(state.drawer.id);
      if (!current) return;
      await apiFetch(`/menus/${state.drawer.id}/${current.activo ? 'desactivar' : 'activar'}`, { method: 'PATCH' });
      await pushAudit(current.activo ? 'Menú desactivado' : 'Menú activado', `${current.nombre} cambió de estado.`);
      toast('Menús', `Menú ${current.activo ? 'desactivado' : 'activado'}.`, 'success');
      closeDrawer();
      await loadData();
      return;
    }

    if (state.drawer.type === 'profile') {
      const current = profileById(state.drawer.id);
      if (!current) return;
      await apiFetch(`/perfiles/${state.drawer.id}/${current.activo ? 'desactivar' : 'activar'}`, { method: 'PATCH' });
      await pushAudit(current.activo ? 'Perfil desactivado' : 'Perfil activado', `${current.nombre} cambió de estado.`);
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
      await pushAudit(nextActive ? 'Área activada' : 'Área desactivada', `${current.nombre} cambió de estado.`);
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
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && menuById(id));
    if (!menus.length) {
      const note = document.getElementById('profileMenuNote');
      if (note) note.textContent = 'Este perfil no tiene menús asignados. Los usuarios con este perfil no recibirán accesos desde él.';
      toast('Perfiles', 'Este perfil no tiene menús asignados. Los usuarios con este perfil no recibirán accesos desde él.', 'warn');
    }
    await apiFetch(`/perfiles/${profile.id}/menus`, {
      method: 'PUT',
      body: JSON.stringify({ menus }),
    });

    await pushAudit('Menús por perfil', `Se guardaron los menús del perfil ${profile.nombre}.`);
    toast('Perfiles', 'Menús del perfil guardados correctamente.', 'success');
    await loadData();
    await syncProfileMenuDraft(profile.id);
  }

  async function saveProfileUserAssignments() {
    const user = selectedProfileUser();
    if (!user) return;
    if (state.profileUserLoading) {
      toast('Perfiles', 'Espera a que termine de cargar el usuario seleccionado antes de guardar.', 'warn');
      return;
    }

    const perfiles = Array.from(state.profileUserDraft)
      .map(id => Number(id))
      .filter(id => Number.isFinite(id) && profileById(id));

    await apiFetch(`/usuarios/${user.id}/perfiles`, {
      method: 'PUT',
      body: JSON.stringify({ perfiles }),
    });

    await pushAudit('Perfiles por usuario', `Se actualizaron los perfiles del usuario ${user.nombre}.`);
    toast('Perfiles', 'Perfiles del usuario guardados correctamente.', 'success');
    await loadData();
    await syncProfileUserDraft(user.id);
  }

  function selectedBulkProfiles() {
    return Array.from(state.selectedProfileIds)
      .map(id => profileById(id))
      .filter(Boolean);
  }

  function selectedBulkProfileLabels() {
    return selectedBulkProfiles()
      .map(profile => profile?.nombre || profile?.codigo || '')
      .filter(Boolean);
  }

  function selectedBulkDirectAccessCount() {
    return selectedUsers().reduce((total, user) => total + (Array.isArray(user.menus) ? user.menus.length : 0), 0);
  }

  function isReplaceAccessesEnabled() {
    return Boolean(state.replaceProfileAccesses);
  }

  function refreshProfileBulkReplaceState() {
    const toggle = document.getElementById('profileReplaceAccesses');
    if (toggle) {
      toggle.checked = state.replaceProfileAccesses;
      toggle.disabled = !isBulkProfileMode();
    }
    const container = document.getElementById('profileBulkReplaceBox');
    if (container) {
      container.hidden = !isBulkProfileMode();
    }
  }

  function renderProfileBulkPreview() {
    const preview = document.getElementById('profileBulkPreview');
    if (!preview) return;

    if (!isBulkProfileMode()) {
      preview.innerHTML = '<div class="mini-empty">Activa la selección múltiple para ver el impacto del reemplazo.</div>';
      return;
    }

    const users = selectedUsers();
    const profiles = selectedBulkProfileLabels();
    const userCount = users.length;
    const profileCount = profiles.length;
    const directAccessCount = selectedBulkDirectAccessCount();
    const replaceText = isReplaceAccessesEnabled()
      ? 'El reemplazo limpiará los accesos manuales/directos de estos usuarios y conservará solo los accesos derivados de los perfiles seleccionados y del perfil base obligatorio.'
      : 'El modo aditivo mantendrá los accesos manuales/directos actuales de estos usuarios.';

    preview.innerHTML = `
      <div class="profile-bulk-preview__grid">
        <div class="summary-chip">Usuarios: <strong>${escHtml(userCount)}</strong></div>
        <div class="summary-chip">Perfiles: <strong>${escHtml(profileCount)}</strong></div>
        <div class="summary-chip">Accesos directos actuales: <strong>${escHtml(directAccessCount)}</strong></div>
      </div>
      <div class="profile-bulk-preview__text">${escHtml(replaceText)}</div>
      <div class="profile-bulk-preview__profiles">
        ${profiles.length
          ? profiles.map(label => `<span class="summary-chip">${escHtml(label)}</span>`).join('')
          : '<span class="field-help">Selecciona al menos un perfil para continuar.</span>'}
      </div>
    `;
  }

  async function applyBulkProfileAction(action) {
    const users = selectedUsers();
    const profiles = selectedBulkProfiles();
    if (!users.length || !profiles.length) {
      toast('Perfiles', 'Selecciona usuarios y perfiles antes de continuar.', 'warn');
      return;
    }

    const userCount = users.length;
    const profileCount = profiles.length;
    const directAccessCount = selectedBulkDirectAccessCount();
    const replaceAccesses = action === 'assign' && isReplaceAccessesEnabled();
    const profileNames = selectedBulkProfileLabels();
    const confirmText = action === 'assign'
      ? replaceAccesses
        ? [
            `Se reemplazarán los accesos individuales de ${userCount} usuario(s).`,
            `Perfiles que quedarán: ${profileNames.join(', ')}.`,
            `Accesos directos actuales a eliminar: ${directAccessCount}.`,
            'El perfil base obligatorio del área se mantendrá si existe.',
          ].join('\n')
        : `Se asignarán ${profileCount} perfil(es) a ${userCount} usuario(s).`
      : `Se quitarán ${profileCount} perfil(es) de ${userCount} usuario(s).`;
    if (!window.confirm(confirmText)) {
      return;
    }

    const payload = {
      usuarios: users.map(user => Number(user.id)),
      perfiles: profiles.map(profile => Number(profile.id)),
    };
    if (replaceAccesses) {
      payload.reemplazar_accesos = true;
    }

    const endpoint = action === 'assign'
      ? '/usuarios/perfiles/asignar-masivo'
      : '/usuarios/perfiles/quitar-masivo';
    await apiFetch(endpoint, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    await pushAudit(
      action === 'assign' && replaceAccesses ? 'Perfiles reemplazados' : action === 'assign' ? 'Perfiles asignados' : 'Perfiles quitados',
      action === 'assign' && replaceAccesses
        ? `${profileCount} perfil(es) y ${directAccessCount} acceso(s) directo(s) procesados para ${userCount} usuario(s).`
        : `${profileCount} perfil(es) procesados para ${userCount} usuario(s).`
    );
    toast(
      'Perfiles',
      action === 'assign'
        ? replaceAccesses
          ? 'Perfiles reemplazados y accesos individuales limpiados correctamente.'
          : 'Perfiles asignados correctamente.'
        : 'Perfiles quitados correctamente.',
      'success'
    );
    state.selectedProfileIds = new Set();
    await loadData();
    renderProfileUserSelects();
    renderProfileUserSummary();
    renderProfileUserList();
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
      await pushAudit('Perfil creado', `Se creó el perfil ${payload.nombre}.`);
      toast('Perfiles', 'Perfil creado correctamente.', 'success');
    } else {
      await apiFetch(`/perfiles/${state.drawer.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      await pushAudit('Perfil actualizado', `Se actualiz? el perfil ${payload.nombre}.`);
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

    const affectedUsers = state.users.filter(user => userBelongsToArea(user, area.codigo));
    if (!affectedUsers.length) {
      toast('Áreas', 'No hay usuarios en esta área.', 'warn');
      return;
    }

    const confirmed = window.confirm(`¿Aplicar el perfil ${selectedProfile.nombre} al área ${area.nombre}?`);
    if (!confirmed) return;

    const response = await apiFetch(`/areas/${area.id}/aplicar-perfil`, {
      method: 'POST',
      body: JSON.stringify({ perfil_id: selectedProfile.id }),
    });

    await pushAudit('Perfil aplicado por área', `Se aplicó ${selectedProfile.nombre} al área ${area.nombre}.`);
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
      await pushAudit('Área creada', `Se creó el área ${payload.nombre}.`);
      toast('Áreas', 'Área creada correctamente.', 'success');
    } else {
      await apiFetch(`/areas/${state.drawer.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      await pushAudit('Área actualizada', `Se actualizó el área ${payload.nombre}.`);
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
    const affectedUsers = state.users.filter(user => userBelongsToArea(user, areaCode));
    if (!suggestions.length) {
      toast('Áreas', 'No hay menús sugeridos para esta área.', 'warn');
      return;
    }

    await apiFetch('/accesos/asignar-por-area', {
      method: 'POST',
      body: JSON.stringify({ area: areaCode, menus: suggestions }),
    });

    await pushAudit('Accesos por área', `Se actualizó el perfil base de ${formatAreaLabel(areaCode)}.`);
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
      await pushAudit('Vendedor actualizado', `Se cambió el tipo de ${state.vendorEditCode}.`);
      toast('Vendedores', 'Tipo actualizado correctamente.', 'success');
    } else {
      await apiFetch(`/usuarios/${userId}/vendedores`, {
        method: 'POST',
        body: JSON.stringify({ cod_vendedor: normalizedCode, tipo }),
      });
      await pushAudit('Vendedor agregado', `Se agreg? ${normalizedCode} al usuario seleccionado.`);
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
    await pushAudit('Vendedor eliminado', `Se quitó ${cod} del usuario seleccionado.`);
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
    state.selectedProfileId = Number(id);
    state.profileUserMode = 'bulk';
    state.selectedUserIds = new Set();
    state.profileUserSearch = '';
    renderProfileMenuSummary();
    renderProfileMenuGroups();
    renderProfileUserSelects();
    renderProfileUserSummary();
    renderProfileUserList();
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
        const userSelectCheckbox = event.target.closest('[data-user-select-id]');
        if (userSelectCheckbox && userSelectCheckbox.type === 'checkbox') {
          const userId = Number(userSelectCheckbox.dataset.userSelectId);
          if (userSelectCheckbox.checked) {
            state.selectedUserIds.add(userId);
          } else {
            state.selectedUserIds.delete(userId);
          }
          renderUsers();
          renderProfileUserSelects();
          renderProfileUserSummary();
          renderProfileUserList();
          return;
        }

        const profileUserCheckbox = event.target.closest('[data-user-id]');
        if (profileUserCheckbox && profileUserCheckbox.type === 'checkbox') {
          const userId = Number(profileUserCheckbox.dataset.userId);
          state.profileUserMode = 'bulk';
          if (profileUserCheckbox.checked) {
            state.selectedUserIds.add(userId);
          } else {
            state.selectedUserIds.delete(userId);
          }
          updateUserSelectionSummary();
          renderUsers();
          renderProfileUserSelects();
          renderProfileUserSummary();
          return;
        }

        const profileCheckbox = event.target.closest('[data-profile-id]');
        if (profileCheckbox && profileCheckbox.type === 'checkbox') {
          const profileId = Number(profileCheckbox.dataset.profileId);
          if (isBulkProfileMode()) {
            if (profileCheckbox.checked) {
              state.selectedProfileIds.add(profileId);
            } else {
              state.selectedProfileIds.delete(profileId);
            }
          } else if (profileCheckbox.checked) {
            state.profileUserDraft.add(profileId);
          } else {
            state.profileUserDraft.delete(profileId);
          }
          renderProfileUserSummary();
          return;
        }

        const profileMenuCheckbox = event.target.closest('input[data-profile-menu-node-key]');
        if (!profileMenuCheckbox) return;

        const ids = String(profileMenuCheckbox.dataset.profileMenuNodeIds || '')
          .split(',')
          .map(id => Number(id.trim()))
          .filter(id => Number.isFinite(id) && id > 0);
        if (profileMenuCheckbox.checked) {
          ids.forEach(id => state.profileMenuDraft.add(id));
        } else {
          ids.forEach(id => state.profileMenuDraft.delete(id));
        }
        renderProfileMenuSummary();
        renderProfileMenuGroups();
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

    const profileUserModeBulk = document.getElementById('profileUserModeBulk');
    if (profileUserModeBulk && !profileUserModeBulk.dataset.bound) {
      profileUserModeBulk.addEventListener('click', () => setProfileUserMode('bulk').catch(handleAdminError));
      profileUserModeBulk.dataset.bound = '1';
    }

    const profileUserModeSingle = document.getElementById('profileUserModeSingle');
    if (profileUserModeSingle && !profileUserModeSingle.dataset.bound) {
      profileUserModeSingle.addEventListener('click', () => setProfileUserMode('single').catch(handleAdminError));
      profileUserModeSingle.dataset.bound = '1';
    }

    const profileReplaceAccesses = document.getElementById('profileReplaceAccesses');
    if (profileReplaceAccesses && !profileReplaceAccesses.dataset.bound) {
      profileReplaceAccesses.addEventListener('change', event => {
        state.replaceProfileAccesses = Boolean(event.target.checked);
        renderProfileUserSummary();
      });
      profileReplaceAccesses.dataset.bound = '1';
    }

    const profileUserSearch = document.getElementById('profileUserSearch');
    if (profileUserSearch && !profileUserSearch.dataset.bound) {
      profileUserSearch.addEventListener('input', event => {
        state.profileUserSearch = String(event.target.value || '');
        renderProfileUserSelects();
        renderProfileUserSummary();
        renderProfileUserList();
      });
      profileUserSearch.dataset.bound = '1';
    }

    const profileUserSelectVisible = document.getElementById('profileUserSelectVisible');
    if (profileUserSelectVisible && !profileUserSelectVisible.dataset.bound) {
      profileUserSelectVisible.addEventListener('click', () => {
        const ids = filteredProfileUsers().map(user => Number(user.id));
        state.profileUserMode = 'bulk';
        syncUserSelectionFromRows(Array.from(new Set([...state.selectedUserIds, ...ids])));
        renderProfileUserSelects();
        renderProfileUserSummary();
        renderProfileUserList();
      });
      profileUserSelectVisible.dataset.bound = '1';
    }

    const profileUserClearSelection = document.getElementById('profileUserClearSelection');
    if (profileUserClearSelection && !profileUserClearSelection.dataset.bound) {
      profileUserClearSelection.addEventListener('click', () => {
        state.selectedUserIds = new Set();
        state.selectedProfileIds = new Set();
        updateUserSelectionSummary();
        renderUsers();
        renderProfileUserSelects();
        renderProfileUserSummary();
        renderProfileUserList();
      });
      profileUserClearSelection.dataset.bound = '1';
    }

    const profileBulkAssign = document.getElementById('profileBulkAssign');
    if (profileBulkAssign && !profileBulkAssign.dataset.bound) {
      profileBulkAssign.addEventListener('click', () => applyBulkProfileAction('assign').catch(handleAdminError));
      profileBulkAssign.dataset.bound = '1';
    }

    const profileBulkRemove = document.getElementById('profileBulkRemove');
    if (profileBulkRemove && !profileBulkRemove.dataset.bound) {
      profileBulkRemove.addEventListener('click', () => applyBulkProfileAction('remove').catch(handleAdminError));
      profileBulkRemove.dataset.bound = '1';
    }

    const profileUserSelect = document.getElementById('profileUserSelect');
    if (profileUserSelect && !profileUserSelect.dataset.bound) {
      profileUserSelect.addEventListener('change', event => {
        state.selectedProfileUserId = Number(event.target.value);
        state.profileUserMode = 'single';
        state.selectedUserIds = new Set();
        state.profileUserSearch = '';
        void syncProfileUserDraft(state.selectedProfileUserId);
        renderUsers();
      });
      profileUserSelect.dataset.bound = '1';
    }

    const usersSelectAllToggle = document.getElementById('usersSelectAllToggle');
    if (usersSelectAllToggle && !usersSelectAllToggle.dataset.bound) {
      usersSelectAllToggle.addEventListener('change', event => {
        const rows = filteredUsers().map(user => Number(user.id));
        if (!event.target.checked) {
          syncUserSelectionFromRows(Array.from(state.selectedUserIds).filter(id => !rows.includes(id)));
        } else {
          syncUserSelectionFromRows(Array.from(new Set([...state.selectedUserIds, ...rows])));
        }
        renderUsers();
      });
      usersSelectAllToggle.dataset.bound = '1';
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




