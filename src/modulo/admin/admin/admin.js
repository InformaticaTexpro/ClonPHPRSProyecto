'use strict';

(function () {
  const MENU_GROUPS = ['Ventas', 'Producción', 'Bodega', 'Servicio Técnico', 'Facturación', 'Contabilidad', 'Administración', 'Gerencia', 'General'];

  const MENUS = [
    { id: 1, codigo: 'ventas_dashboard', nombre: 'Dashboard', grupo: 'Ventas', url: '/src/modulo/ventas/dashboard/index.html', icono: '🏠', orden: 1, activo: true },
    { id: 2, codigo: 'ventas_asignadas', nombre: 'Ventas Asignadas', grupo: 'Ventas', url: '/src/modulo/ventas/ventas/index.html', icono: '🤝', orden: 2, activo: true },
    { id: 3, codigo: 'historial_cliente', nombre: 'Historial Cliente', grupo: 'Ventas', url: '/src/modulo/ventas/historial-cliente/index.html', icono: '📋', orden: 3, activo: true },
    { id: 4, codigo: 'produccion', nombre: 'Producción', grupo: 'Producción', url: '/src/modulo/produccion/produccion/index.html', icono: '⚙️', orden: 1, activo: true },
    { id: 5, codigo: 'bodega', nombre: 'Bodega', grupo: 'Bodega', url: '/src/modulo/bodega/bodega/index.html', icono: '🏭', orden: 1, activo: true },
    { id: 6, codigo: 'servicio_tecnico', nombre: 'Servicio Técnico', grupo: 'Servicio Técnico', url: '/src/modulo/servtecnico/servicio-tecnico/index.html', icono: '🛠️', orden: 1, activo: true },
    { id: 7, codigo: 'facturacion', nombre: 'Facturación', grupo: 'Facturación', url: '/src/modulo/facturacion/facturacion/index.html', icono: '🧾', orden: 1, activo: true },
    { id: 8, codigo: 'rrhh', nombre: 'RRHH', grupo: 'General', url: '/src/modulo/rrhh/rrhh/index.html', icono: '👥', orden: 1, activo: true },
    { id: 9, codigo: 'contabilidad', nombre: 'Contabilidad', grupo: 'Contabilidad', url: '/src/modulo/contabilidad/contabilidad/index.html', icono: '📜', orden: 1, activo: true },
    { id: 10, codigo: 'cobranza', nombre: 'Cobranza', grupo: 'Contabilidad', url: '/src/modulo/cobranza/cobranza/index.html', icono: '💰', orden: 2, activo: true },
    { id: 11, codigo: 'administracion', nombre: 'Administración', grupo: 'Administración', url: '/src/modulo/admin/admin/index.html', icono: '🔧', orden: 1, activo: true },
    { id: 12, codigo: 'alertas', nombre: 'Alertas', grupo: 'General', url: '/src/modulo/varios/alertas/index.html', icono: '🔔', orden: 1, activo: true },
    { id: 13, codigo: 'gerencia', nombre: 'Gerencia', grupo: 'Gerencia', url: '/src/modulo/gerencia/index.html', icono: '📈', orden: 1, activo: true },
  ];

  const AREAS = [
    { codigo: 'ventas', nombre: 'Ventas', sugeridos: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente'] },
    { codigo: 'facturacion', nombre: 'Facturación', sugeridos: ['facturacion', 'alertas'] },
    { codigo: 'produccion', nombre: 'Producción', sugeridos: ['produccion', 'bodega', 'alertas'] },
    { codigo: 'bodega', nombre: 'Bodega', sugeridos: ['bodega', 'alertas'] },
    { codigo: 'servicio-tecnico', nombre: 'Servicio Técnico', sugeridos: ['servicio_tecnico', 'alertas'] },
    { codigo: 'contabilidad', nombre: 'Contabilidad', sugeridos: ['contabilidad', 'cobranza', 'alertas'] },
    { codigo: 'rrhh', nombre: 'RRHH', sugeridos: ['rrhh', 'alertas'] },
    { codigo: 'gerencia', nombre: 'Gerencia', sugeridos: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'gerencia', 'alertas'] },
    { codigo: 'admin', nombre: 'Administración', sugeridos: MENUS.map(menu => menu.codigo) },
  ];

  const USERS = [
    {
      id: 23,
      nombre: 'Claudia Rincones',
      email: 'claudia.rincones@texpro.cl',
      codigo: '496',
      area: 'ventas',
      tema: 'Claro',
      activo: true,
      is_admin: false,
      menus: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente'],
      updatedAt: '2026-07-02 08:40',
      vendedores: [{ codigo: '496', tipo: 'principal', estado: 'activo' }],
    },
    {
      id: 24,
      nombre: 'Norelby Oliveros',
      email: 'norelby.oliveros@texpro.cl',
      codigo: '629',
      area: 'ventas',
      tema: 'Claro',
      activo: true,
      is_admin: false,
      menus: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente'],
      updatedAt: '2026-07-02 08:10',
      vendedores: [{ codigo: '629', tipo: 'principal', estado: 'activo' }],
    },
    {
      id: 25,
      nombre: 'Macarena Sanchez',
      email: 'macarena.sanchez@texpro.cl',
      codigo: '437',
      area: 'gerencia',
      tema: 'Oscuro',
      activo: true,
      is_admin: false,
      menus: ['ventas_dashboard', 'ventas_asignadas', 'historial_cliente', 'gerencia', 'alertas'],
      updatedAt: '2026-07-01 14:55',
      vendedores: [{ codigo: '437', tipo: 'supervisor', estado: 'activo' }],
    },
    {
      id: 26,
      nombre: 'Carlos Muñoz',
      email: 'carlos.munoz@texpro.cl',
      codigo: '510',
      area: 'facturacion',
      tema: 'Claro',
      activo: true,
      is_admin: false,
      menus: ['facturacion', 'alertas'],
      updatedAt: '2026-06-29 12:35',
      vendedores: [{ codigo: '510', tipo: 'principal', estado: 'activo' }],
    },
    {
      id: 27,
      nombre: 'Soporte Informática',
      email: 'soporte.informatica@texpro.cl',
      codigo: '900',
      area: 'admin',
      tema: 'Claro',
      activo: true,
      is_admin: true,
      menus: MENUS.map(menu => menu.codigo),
      updatedAt: '2026-07-02 09:15',
      vendedores: [],
    },
    {
      id: 28,
      nombre: 'Luis Pérez',
      email: 'luis.perez@texpro.cl',
      codigo: '220',
      area: 'bodega',
      tema: 'Claro',
      activo: false,
      is_admin: false,
      menus: ['bodega'],
      updatedAt: '2026-06-18 10:20',
      vendedores: [{ codigo: '220', tipo: 'compartido', estado: 'inactivo' }],
    },
    {
      id: 29,
      nombre: 'Usuario sin permisos',
      email: 'sin.permisos@texpro.cl',
      codigo: '000',
      area: 'ventas',
      tema: 'Claro',
      activo: true,
      is_admin: false,
      menus: [],
      updatedAt: '2026-06-30 16:45',
      vendedores: [],
    },
  ];

  const ASSIGNMENTS = [
    { id: 1, userId: 23, codigo: '496', tipo: 'principal', estado: 'activo' },
    { id: 2, userId: 24, codigo: '629', tipo: 'principal', estado: 'activo' },
    { id: 3, userId: 25, codigo: '446', tipo: 'supervisor', estado: 'activo' },
    { id: 4, userId: 26, codigo: '510', tipo: 'compartido', estado: 'activo' },
  ];

  const AUDIT = [
    { fecha: '2026-07-02 09:14', operador: 'Soporte Informática', titulo: 'Usuario creado', detalle: 'Se preparó el usuario soporte.informatica@texpro.cl con acceso total en maqueta.' },
    { fecha: '2026-07-02 08:40', operador: 'Claudia Rincones', titulo: 'Permisos actualizados', detalle: 'Se mantuvieron los módulos de ventas permitidos para el perfil comercial.' },
    { fecha: '2026-07-01 14:50', operador: 'Macarena Sanchez', titulo: 'Menú desactivado', detalle: 'Se desactivó temporalmente un menú de pruebas en el catálogo visual.' },
    { fecha: '2026-06-29 10:20', operador: 'Carlos Muñoz', titulo: 'Usuario inactivo', detalle: 'El usuario quedó marcado como inactivo en la vista preliminar.' },
  ];

  const state = {
    activeTab: 'usuarios',
    users: clone(USERS),
    menus: clone(MENUS),
    areas: clone(AREAS),
    assignments: clone(ASSIGNMENTS),
    audit: clone(AUDIT),
    filters: {
      search: '',
      area: '',
      status: '',
      admin: '',
    },
    selectedPermUserId: USERS[0].id,
    permissionsDraft: new Set(USERS[0].menus),
    drawer: {
      open: false,
      type: 'user',
      mode: 'new',
      id: null,
    },
    editingAssignmentId: null,
  };

  const dom = {};

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
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
    if (!user) return null;
    return {
      nombre: user.nombre || user.name || user.usuario || user.email || 'Usuario',
      email: user.email || user.correo || '',
      area: user.area || user.Area || user.departamento || user.depto || '',
    };
  }

  function nowLabel() {
    return new Date().toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
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

  function openDrawer(type, mode = 'new', id = null) {
    state.drawer = { open: true, type, mode, id };
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

  function getUserInitials(user) {
    return String(user?.nombre || user?.email || '?')
      .split(' ')
      .slice(0, 2)
      .map(part => part[0] || '')
      .join('')
      .toUpperCase() || '?';
  }

  function getAreaLabel(code) {
    return AREAS.find(area => area.codigo === code)?.nombre || code || 'Sin área';
  }

  function getMenuByCode(code) {
    return state.menus.find(menu => menu.codigo === code) || null;
  }

  function getSuggestedMenus(areaCode) {
    const area = AREAS.find(item => item.codigo === areaCode);
    return area ? area.sugeridos : [];
  }

  function getPermittedMenus(user) {
    const allowed = new Set(user?.menus || []);
    return state.menus.filter(menu => allowed.has(menu.codigo));
  }

  function renderHeader() {
    const current = getStoredUser() || state.users.find(user => user.id === 27) || state.users[0];
    const initials = getUserInitials(current);
    setText('userName', current?.nombre || current?.email || 'Usuario');
    setText('userArea', getAreaLabel(current?.area));
    setText('userAvatar', initials);
    setText('chipAvatar', initials);
    setText('chipName', (current?.nombre || current?.email || 'Usuario').split(' ')[0]);
    setText('headerDate', new Date().toLocaleDateString('es-CL', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }));
  }

  function renderKpis() {
    const total = state.users.length;
    const activos = state.users.filter(user => user.activo).length;
    const inactivos = state.users.filter(user => !user.activo).length;
    const admins = state.users.filter(user => user.is_admin).length;
    const menusConfigurados = state.menus.filter(menu => menu.activo).length;
    const sinPermisos = state.users.filter(user => !user.menus.length).length;

    const cards = [
      { label: 'Total usuarios', value: total, hint: 'Mock local de usuarios' },
      { label: 'Usuarios activos', value: activos, hint: 'Disponibles para sesión' },
      { label: 'Usuarios inactivos', value: inactivos, hint: 'Suspendidos en maqueta' },
      { label: 'Administradores', value: admins, hint: 'Con bandera admin' },
      { label: 'Menús configurados', value: menusConfigurados, hint: 'Catálogo visual activo' },
      { label: 'Usuarios sin permisos', value: sinPermisos, hint: 'A la espera de asignación' },
    ];

    const container = document.getElementById('adminKpis');
    if (!container) return;

    container.innerHTML = cards.map(card => `
      <article class="admin-kpi">
        <span class="admin-kpi__label">${escHtml(card.label)}</span>
        <span class="admin-kpi__value">${escHtml(card.value)}</span>
        <span class="admin-kpi__hint">${escHtml(card.hint)}</span>
      </article>
    `).join('');
  }

  function renderTabs() {
    document.querySelectorAll('.admin-tab').forEach(button => {
      const active = button.dataset.tab === state.activeTab;
      button.classList.toggle('is-active', active);
    });

    document.querySelectorAll('.admin-panel').forEach(panel => {
      panel.hidden = panel.dataset.panel !== state.activeTab;
      panel.classList.toggle('is-active', panel.dataset.panel === state.activeTab);
    });
  }

  function renderUserFilters() {
    const areaFilter = document.getElementById('userAreaFilter');
    if (areaFilter && !areaFilter.dataset.ready) {
      areaFilter.innerHTML = `<option value="">Todas las áreas</option>` + AREAS.map(area => `<option value="${escHtml(area.codigo)}">${escHtml(area.nombre)}</option>`).join('');
      areaFilter.dataset.ready = '1';
    }
  }

  function filterUsers() {
    const search = normalizeText(state.filters.search);
    return state.users.filter(user => {
      const bySearch = !search || [user.nombre, user.email, user.codigo].some(value => normalizeText(value).includes(search));
      const byArea = !state.filters.area || user.area === state.filters.area;
      const byStatus = !state.filters.status || (state.filters.status === 'activo' ? user.activo : !user.activo);
      const byAdmin = !state.filters.admin
        || (state.filters.admin === 'admin' && user.is_admin)
        || (state.filters.admin === 'no-admin' && !user.is_admin);
      return bySearch && byArea && byStatus && byAdmin;
    });
  }

  function renderUsers() {
    renderUserFilters();
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    const users = filterUsers();
    if (!users.length) {
      tbody.innerHTML = '<tr class="row-empty"><td colspan="10">No hay usuarios para los filtros seleccionados.</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(user => {
      const menusCount = getPermittedMenus(user).length;
      return `
        <tr>
          <td><strong>${escHtml(user.id)}</strong></td>
          <td>${escHtml(user.nombre)}</td>
          <td>${escHtml(user.email)}</td>
          <td>${escHtml(user.codigo)}</td>
          <td>${escHtml(getAreaLabel(user.area))}</td>
          <td><span class="table-status ${user.activo ? 'table-status--activo' : 'table-status--inactivo'}">${user.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td><span class="table-status ${user.is_admin ? 'table-status--admin' : 'table-status--inactivo'}">${user.is_admin ? 'Admin' : 'No'}</span></td>
          <td>${menusCount}</td>
          <td>${escHtml(user.updatedAt)}</td>
          <td>
            <div class="action-group">
              <button class="btn-secondary" data-user-action="view" data-id="${user.id}" type="button">Ver</button>
              <button class="btn-secondary" data-user-action="edit" data-id="${user.id}" type="button">Editar</button>
              <button class="btn-secondary" data-user-action="toggle" data-id="${user.id}" type="button">${user.activo ? 'Desactivar' : 'Activar'}</button>
              <button class="btn-danger" data-user-action="delete" data-id="${user.id}" type="button">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderPermissionSelect() {
    const select = document.getElementById('permUserSelect');
    if (!select) return;

    select.innerHTML = state.users.map(user => `<option value="${escHtml(user.id)}">${escHtml(user.nombre)} — ${escHtml(getAreaLabel(user.area))}</option>`).join('');
    select.value = String(state.selectedPermUserId);
  }

  function getSelectedPermissionUser() {
    return state.users.find(user => user.id === state.selectedPermUserId) || state.users[0];
  }

  function syncPermissionsDraft() {
    const selected = getSelectedPermissionUser();
    state.permissionsDraft = new Set(selected ? selected.menus : []);
  }

  function renderPermissionSummary() {
    const allowed = state.permissionsDraft.size;
    const blocked = state.menus.length - allowed;
    setText('permAllowedCount', String(allowed));
    setText('permBlockedCount', String(blocked));
  }

  function renderPermissionGroups() {
    const container = document.getElementById('permGroups');
    if (!container) return;

    const grouped = MENU_GROUPS.map(group => {
      const items = state.menus.filter(menu => menu.grupo === group);
      if (!items.length) return null;

      return `
        <article class="permission-group">
          <div class="permission-group__header">
            <h4>${escHtml(group)}</h4>
            <span class="permission-group__count">${items.length} menús</span>
          </div>
          <div class="permission-list">
            ${items.map(menu => {
              const checked = state.permissionsDraft.has(menu.codigo);
              return `
                <label class="permission-item">
                  <span class="permission-item__label">
                    <input type="checkbox" data-permission-code="${escHtml(menu.codigo)}" ${checked ? 'checked' : ''} />
                    <strong>${escHtml(menu.nombre)}</strong>
                  </span>
                  <span class="badge ${checked ? 'badge--ok' : 'badge--blocked'}">${checked ? 'Permiso asignado' : 'Bloqueado'}</span>
                </label>
              `;
            }).join('')}
          </div>
        </article>
      `;
    }).filter(Boolean).join('');

    container.innerHTML = grouped || '<div class="mini-empty">Sin menús para mostrar.</div>';
    renderPermissionSummary();
  }

  function renderMenusPreview() {
    const preview = document.getElementById('menusPreview');
    if (!preview) return;

    const activeMenus = state.menus.filter(menu => menu.activo);
    if (!activeMenus.length) {
      preview.innerHTML = '<div class="mini-empty">No hay menús activos.</div>';
      return;
    }

    const grouped = MENU_GROUPS.map(group => ({
      group,
      items: activeMenus.filter(menu => menu.grupo === group),
    })).filter(group => group.items.length);

    preview.innerHTML = grouped.map(group => `
      <div class="sidebar-preview__group">
        <h5>${escHtml(group.group)}</h5>
        ${group.items.map(menu => `
          <div class="sidebar-preview__item ${menu.activo ? '' : 'is-disabled'} ${menu.codigo === 'ventas_dashboard' ? 'active' : ''}">
            <span>${escHtml(menu.icono)}</span>
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
      tbody.innerHTML = '<tr class="row-empty"><td colspan="9">Sin menús configurados.</td></tr>';
      renderMenusPreview();
      return;
    }

    tbody.innerHTML = state.menus.map(menu => `
      <tr>
        <td>${escHtml(menu.id)}</td>
        <td><strong>${escHtml(menu.codigo)}</strong></td>
        <td>${escHtml(menu.nombre)}</td>
        <td>${escHtml(menu.grupo)}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${escHtml(menu.url)}</td>
        <td>${escHtml(menu.icono)}</td>
        <td>${escHtml(menu.orden)}</td>
        <td><span class="table-status ${menu.activo ? 'table-status--activo' : 'table-status--inactivo'}">${menu.activo ? 'Activo' : 'Inactivo'}</span></td>
        <td>
          <div class="action-group">
            <button class="btn-secondary" data-menu-action="edit" data-id="${menu.id}" type="button">Editar</button>
            <button class="btn-secondary" data-menu-action="toggle" data-id="${menu.id}" type="button">${menu.activo ? 'Desactivar' : 'Activar'}</button>
          </div>
        </td>
      </tr>
    `).join('');

    renderMenusPreview();
  }

  function renderAreas() {
    const container = document.getElementById('areasGrid');
    if (!container) return;

    container.innerHTML = state.areas.map(area => {
      const users = state.users.filter(user => user.area === area.codigo);
      const suggestedMenus = area.sugeridos.map(code => getMenuByCode(code)).filter(Boolean);
      return `
        <article class="area-card">
          <div class="area-card__header">
            <div>
              <h4>${escHtml(area.nombre)}</h4>
              <p>${escHtml(users.length)} usuarios en esta área</p>
            </div>
            <span class="badge badge--neutral">${escHtml(area.codigo)}</span>
          </div>
          <div class="area-chip-list">
            ${suggestedMenus.map(menu => `<span class="area-chip">${escHtml(menu.nombre)}</span>`).join('')}
          </div>
          <div class="area-actions">
            <button class="btn-secondary" data-area-action="users" data-area="${escHtml(area.codigo)}" type="button">Ver usuarios</button>
            <button class="btn-primary" data-area-action="apply" data-area="${escHtml(area.codigo)}" type="button">Aplicar sugeridos</button>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderAssignments() {
    const tbody = document.getElementById('assignmentsTbody');
    if (!tbody) return;

    if (!state.assignments.length) {
      tbody.innerHTML = '<tr class="row-empty"><td colspan="5">Sin relaciones para mostrar.</td></tr>';
      return;
    }

    tbody.innerHTML = state.assignments.map(item => {
      const user = state.users.find(u => u.id === item.userId);
      return `
        <tr>
          <td>${escHtml(user?.nombre || 'Usuario eliminado')}</td>
          <td>${escHtml(item.codigo)}</td>
          <td>${escHtml(item.tipo)}</td>
          <td><span class="table-status ${item.estado === 'activo' ? 'table-status--activo' : 'table-status--inactivo'}">${escHtml(item.estado)}</span></td>
          <td>
            <div class="action-group">
              <button class="btn-secondary" data-assignment-action="edit" data-id="${item.id}" type="button">Editar</button>
              <button class="btn-danger" data-assignment-action="delete" data-id="${item.id}" type="button">Quitar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const userSelect = document.getElementById('assignUserSelect');
    if (userSelect) {
      const currentValue = userSelect.value;
      userSelect.innerHTML = state.users.map(user => `<option value="${escHtml(user.id)}">${escHtml(user.nombre)}</option>`).join('');
      if (currentValue) userSelect.value = currentValue;
    }

    const edit = state.assignments.find(item => item.id === state.editingAssignmentId);
    if (edit) {
      const userSelectValue = document.getElementById('assignUserSelect');
      const codeInput = document.getElementById('assignVendorCode');
      const typeSelect = document.getElementById('assignVendorType');
      const statusSelect = document.getElementById('assignStatus');
      if (userSelectValue) userSelectValue.value = String(edit.userId);
      if (codeInput) codeInput.value = edit.codigo;
      if (typeSelect) typeSelect.value = edit.tipo;
      if (statusSelect) statusSelect.value = edit.estado;
    }
  }

  function renderAudit() {
    const container = document.getElementById('auditTimeline');
    if (!container) return;

    container.innerHTML = state.audit.map(item => `
      <article class="audit-item">
        <div class="audit-item__top">
          <span class="audit-item__title">${escHtml(item.titulo)}</span>
          <span class="audit-item__meta">${escHtml(item.fecha)} · ${escHtml(item.operador)}</span>
        </div>
        <div class="audit-item__detail">${escHtml(item.detalle)}</div>
      </article>
    `).join('');
  }

  function renderUserDrawer(user, mode) {
    const title = mode === 'new' ? 'Nuevo usuario' : mode === 'view' ? 'Detalle de usuario' : 'Editar usuario';
    const subtitle = 'Datos mock y sin persistencia. La contraseña real se definirá por flujo seguro.';
    const readOnly = mode === 'view';

    setText('drawerTitle', title);
    setText('drawerSubtitle', subtitle);

    const body = document.getElementById('drawerBody');
    if (!body) return;

    body.innerHTML = `
      <div class="drawer-form">
        <div class="drawer-grid">
          <div class="drawer-field">
            <label for="adminUserNombre">Nombre</label>
            <input class="input-control" id="adminUserNombre" type="text" value="${escHtml(user?.nombre || '')}" ${readOnly ? 'disabled' : ''} />
          </div>
          <div class="drawer-field">
            <label for="adminUserEmail">Email</label>
            <input class="input-control" id="adminUserEmail" type="email" value="${escHtml(user?.email || '')}" ${readOnly ? 'disabled' : ''} />
          </div>
          <div class="drawer-field">
            <label for="adminUserCodigo">Código</label>
            <input class="input-control" id="adminUserCodigo" type="text" value="${escHtml(user?.codigo || '')}" ${readOnly ? 'disabled' : ''} />
          </div>
          <div class="drawer-field">
            <label for="adminUserArea">Área</label>
            <select class="select-control" id="adminUserArea" ${readOnly ? 'disabled' : ''}>
              ${AREAS.map(area => `<option value="${escHtml(area.codigo)}" ${area.codigo === (user?.area || 'ventas') ? 'selected' : ''}>${escHtml(area.nombre)}</option>`).join('')}
            </select>
          </div>
          <div class="drawer-field">
            <label for="adminUserTema">Tema</label>
            <select class="select-control" id="adminUserTema" ${readOnly ? 'disabled' : ''}>
              <option value="Claro" ${user?.tema !== 'Oscuro' ? 'selected' : ''}>Claro</option>
              <option value="Oscuro" ${user?.tema === 'Oscuro' ? 'selected' : ''}>Oscuro</option>
            </select>
          </div>
          <div class="drawer-field">
            <label for="adminUserPassword">Password temporal</label>
            <input class="input-control" id="adminUserPassword" type="password" disabled placeholder="Se definirá por flujo seguro de activación/reset" />
          </div>
        </div>
        <div class="drawer-grid drawer-grid--single">
          <label class="permission-item" style="align-items:flex-start">
            <span class="permission-item__label">
              <input type="checkbox" id="adminUserActivo" ${user?.activo !== false ? 'checked' : ''} ${readOnly ? 'disabled' : ''} />
              <strong>Estado activo</strong>
            </span>
            <span class="badge ${user?.activo !== false ? 'badge--ok' : 'badge--blocked'}">${user?.activo !== false ? 'Activo' : 'Inactivo'}</span>
          </label>
          <label class="permission-item" style="align-items:flex-start">
            <span class="permission-item__label">
              <input type="checkbox" id="adminUserAdmin" ${user?.is_admin ? 'checked' : ''} ${readOnly ? 'disabled' : ''} />
              <strong>Es administrador</strong>
            </span>
            <span class="badge ${user?.is_admin ? 'badge--ok' : 'badge--neutral'}">${user?.is_admin ? 'Admin' : 'Normal'}</span>
          </label>
        </div>
        <div class="drawer-note">
          La gestión real de contraseñas se implementará con flujo seguro backend.
        </div>
      </div>
    `;

    dom.drawerMode = 'user';
    dom.drawerUserId = user?.id || null;
    dom.drawerReadOnly = readOnly;

    const primary = document.getElementById('drawerPrimary');
    const secondary = document.getElementById('drawerSecondary');
    const danger = document.getElementById('drawerDanger');
    const remove = document.getElementById('drawerDelete');
    if (primary) primary.textContent = readOnly ? 'Editar' : 'Guardar borrador visual';
    if (secondary) secondary.textContent = readOnly ? 'Cerrar' : 'Cancelar';
    if (danger) {
      danger.style.display = readOnly ? 'none' : 'inline-flex';
      danger.textContent = user?.activo === false ? 'Activar usuario' : 'Desactivar usuario';
    }
    if (remove) {
      remove.style.display = readOnly ? 'none' : 'inline-flex';
    }
  }

  function renderMenuDrawer(menu, mode) {
    const title = mode === 'new' ? 'Nuevo menú' : mode === 'view' ? 'Detalle de menú' : 'Editar menú';
    setText('drawerTitle', title);
    setText('drawerSubtitle', 'Catálogo visual del sidebar central.');

    const body = document.getElementById('drawerBody');
    if (!body) return;

    body.innerHTML = `
      <div class="drawer-form">
        <div class="drawer-grid">
          <div class="drawer-field">
            <label for="adminMenuCodigo">Código</label>
            <input class="input-control" id="adminMenuCodigo" type="text" value="${escHtml(menu?.codigo || '')}" ${mode === 'view' ? 'disabled' : ''} />
          </div>
          <div class="drawer-field">
            <label for="adminMenuNombre">Nombre</label>
            <input class="input-control" id="adminMenuNombre" type="text" value="${escHtml(menu?.nombre || '')}" ${mode === 'view' ? 'disabled' : ''} />
          </div>
          <div class="drawer-field">
            <label for="adminMenuGrupo">Grupo</label>
            <select class="select-control" id="adminMenuGrupo" ${mode === 'view' ? 'disabled' : ''}>
              ${MENU_GROUPS.map(group => `<option value="${escHtml(group)}" ${group === (menu?.grupo || 'General') ? 'selected' : ''}>${escHtml(group)}</option>`).join('')}
            </select>
          </div>
          <div class="drawer-field">
            <label for="adminMenuUrl">URL</label>
            <input class="input-control" id="adminMenuUrl" type="text" value="${escHtml(menu?.url || '')}" ${mode === 'view' ? 'disabled' : ''} />
          </div>
          <div class="drawer-field">
            <label for="adminMenuIcono">Icono</label>
            <input class="input-control" id="adminMenuIcono" type="text" value="${escHtml(menu?.icono || '')}" ${mode === 'view' ? 'disabled' : ''} />
          </div>
          <div class="drawer-field">
            <label for="adminMenuOrden">Orden</label>
            <input class="input-control" id="adminMenuOrden" type="number" min="1" value="${escHtml(menu?.orden || 1)}" ${mode === 'view' ? 'disabled' : ''} />
          </div>
        </div>
        <label class="permission-item" style="align-items:flex-start">
          <span class="permission-item__label">
            <input type="checkbox" id="adminMenuActivo" ${menu?.activo !== false ? 'checked' : ''} ${mode === 'view' ? 'disabled' : ''} />
            <strong>Menú activo</strong>
          </span>
          <span class="badge ${menu?.activo !== false ? 'badge--ok' : 'badge--blocked'}">${menu?.activo !== false ? 'Activo' : 'Inactivo'}</span>
        </label>
        <div class="drawer-note">
          La previsualización del sidebar se actualiza solo en esta maqueta local.
        </div>
      </div>
    `;

    dom.drawerMode = 'menu';
    dom.drawerMenuId = menu?.id || null;
    dom.drawerReadOnly = mode === 'view';

    const primary = document.getElementById('drawerPrimary');
    const secondary = document.getElementById('drawerSecondary');
    const danger = document.getElementById('drawerDanger');
    if (primary) primary.textContent = mode === 'view' ? 'Editar' : 'Guardar borrador visual';
    if (secondary) secondary.textContent = mode === 'view' ? 'Cerrar' : 'Cancelar';
    if (danger) danger.style.display = 'none';
  }

  function renderDrawer() {
    if (!state.drawer.open) return;
    if (state.drawer.type === 'menu') {
      const menu = state.menus.find(item => item.id === state.drawer.id) || null;
      renderMenuDrawer(menu, state.drawer.mode);
      return;
    }

    const user = state.users.find(item => item.id === state.drawer.id) || null;
    renderUserDrawer(user, state.drawer.mode);
  }

  function upsertAudit(titulo, detalle) {
    state.audit.unshift({
      fecha: nowLabel(),
      operador: 'Vista preliminar',
      titulo,
      detalle,
    });
  }

  function saveCurrentDrawer() {
    if (dom.drawerReadOnly) {
      state.drawer.mode = 'edit';
      renderDrawer();
      toast('Modo edición', 'La ficha quedó lista para modificarla en la maqueta.', 'warn');
      return;
    }

    if (dom.drawerMode === 'menu') {
      const menu = {
        id: dom.drawerMenuId || nextId(state.menus),
        codigo: document.getElementById('adminMenuCodigo')?.value.trim(),
        nombre: document.getElementById('adminMenuNombre')?.value.trim(),
        grupo: document.getElementById('adminMenuGrupo')?.value,
        url: document.getElementById('adminMenuUrl')?.value.trim(),
        icono: document.getElementById('adminMenuIcono')?.value.trim() || '•',
        orden: Number(document.getElementById('adminMenuOrden')?.value || 0),
        activo: Boolean(document.getElementById('adminMenuActivo')?.checked),
      };

      if (!menu.codigo || !menu.nombre || !menu.url) {
        toast('Validación', 'Completa código, nombre y URL del menú.', 'error');
        return;
      }

      const question = state.drawerMenuId ? '¿Guardar cambios del menú mock?' : '¿Crear nuevo menú mock?';
      if (!window.confirm(question)) return;

      const idx = state.menus.findIndex(item => item.id === dom.drawerMenuId);
      if (idx >= 0) {
        state.menus[idx] = { ...state.menus[idx], ...menu };
      } else {
        state.menus.push(menu);
      }

      upsertAudit('Menú actualizado', `Se ${idx >= 0 ? 'editó' : 'creó'} el menú ${menu.nombre}.`);
      toast('Acción simulada', 'Menú actualizado en la maqueta local.', 'success');
      closeDrawer();
      renderAll();
      return;
    }

    const user = {
      id: dom.drawerUserId || nextId(state.users),
      nombre: document.getElementById('adminUserNombre')?.value.trim(),
      email: document.getElementById('adminUserEmail')?.value.trim(),
      codigo: document.getElementById('adminUserCodigo')?.value.trim(),
      area: document.getElementById('adminUserArea')?.value,
      tema: document.getElementById('adminUserTema')?.value,
      activo: Boolean(document.getElementById('adminUserActivo')?.checked),
      is_admin: Boolean(document.getElementById('adminUserAdmin')?.checked),
    };

    if (!user.nombre || !user.email || !user.codigo) {
      toast('Validación', 'Completa nombre, email y código.', 'error');
      return;
    }

    if (!window.confirm('¿Guardar borrador visual del usuario?')) return;

    const suggestedMenus = user.is_admin ? MENUS.map(menu => menu.codigo) : getSuggestedMenus(user.area);
    const idx = state.users.findIndex(item => item.id === dom.drawerUserId);
    const currentMenus = idx >= 0 ? state.users[idx].menus : suggestedMenus;
    const nextUser = {
      ...(idx >= 0 ? state.users[idx] : {}),
      ...user,
      menus: currentMenus && currentMenus.length ? currentMenus : suggestedMenus,
      updatedAt: nowLabel(),
      vendedores: idx >= 0 ? state.users[idx].vendedores || [] : [],
    };

    if (idx >= 0) {
      state.users[idx] = nextUser;
    } else {
      state.users.push(nextUser);
    }

    upsertAudit('Usuario guardado', `Se ${idx >= 0 ? 'actualizó' : 'creó'} el usuario ${user.nombre}.`);
    toast('Acción simulada', 'Usuario actualizado en la maqueta local.', 'success');
    closeDrawer();
    renderAll();
  }

  function deleteCurrentDrawer() {
    if (dom.drawerMode !== 'user' || dom.drawerReadOnly) return;
    const user = state.users.find(item => item.id === dom.drawerUserId);
    if (!user) return;
    if (!window.confirm(`¿Eliminar el usuario mock ${user.nombre}?`)) return;

    state.users = state.users.filter(item => item.id !== dom.drawerUserId);
    state.assignments = state.assignments.filter(item => item.userId !== dom.drawerUserId);
    upsertAudit('Usuario eliminado', `Se eliminó la ficha visual de ${user.nombre}.`);
    toast('Acción simulada', 'Usuario eliminado de la maqueta local.', 'success');
    if (!state.users.length) {
      state.users = clone(USERS);
    }
    closeDrawer();
    renderAll();
  }

  function toggleCurrentDrawerStatus() {
    if (dom.drawerMode !== 'user') return;
    const user = state.users.find(item => item.id === dom.drawerUserId);
    if (!user) return;

    const nextActive = !user.activo;
    if (!window.confirm(`¿${nextActive ? 'Activar' : 'Desactivar'} el usuario mock ${user.nombre}?`)) return;

    user.activo = nextActive;
    user.updatedAt = nowLabel();
    upsertAudit(nextActive ? 'Usuario activado' : 'Usuario desactivado', `${user.nombre} cambió a estado ${nextActive ? 'activo' : 'inactivo'}.`);
    toast('Acción simulada', `Usuario ${nextActive ? 'activado' : 'desactivado'} en la maqueta local.`, 'success');
    renderAll();
    renderDrawer();
  }

  function removeCurrentDrawerUser() {
    deleteCurrentDrawer();
  }

  function nextId(list) {
    return list.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
  }

  function toggleMenuActive(menuId) {
    const menu = state.menus.find(item => item.id === Number(menuId));
    if (!menu) return;
    menu.activo = !menu.activo;
    upsertAudit(menu.activo ? 'Menú activado' : 'Menú desactivado', `${menu.nombre} quedó ${menu.activo ? 'activo' : 'inactivo'} en la maqueta.`);
    toast('Acción simulada', `Menú ${menu.activo ? 'activado' : 'desactivado'} en la maqueta local.`, 'success');
    renderAll();
    renderDrawer();
  }

  function openMenuEditor(menuId = null, mode = 'edit') {
    const menu = menuId ? state.menus.find(item => item.id === Number(menuId)) : null;
    state.drawer.type = 'menu';
    state.drawer.mode = menuId ? mode : 'new';
    state.drawer.id = menu?.id || null;
    openDrawer('menu', menuId ? mode : 'new', menu?.id || null);
  }

  function openUserEditor(userId = null, mode = 'edit') {
    const user = userId ? state.users.find(item => item.id === Number(userId)) : null;
    state.drawer.type = 'user';
    state.drawer.mode = userId ? mode : 'new';
    state.drawer.id = user?.id || null;
    openDrawer('user', userId ? mode : 'new', user?.id || null);
  }

  function toggleUserActive(userId) {
    const user = state.users.find(item => item.id === Number(userId));
    if (!user) return;
    user.activo = !user.activo;
    user.updatedAt = nowLabel();
    upsertAudit(user.activo ? 'Usuario activado' : 'Usuario desactivado', `${user.nombre} quedó ${user.activo ? 'activo' : 'inactivo'} en la maqueta.`);
    toast('Acción simulada', `Usuario ${user.activo ? 'activado' : 'desactivado'} en la maqueta local.`, 'success');
    renderAll();
    if (state.drawer.open && dom.drawerMode === 'user' && dom.drawerUserId === user.id) {
      renderDrawer();
    }
  }

  function deleteUser(userId) {
    const user = state.users.find(item => item.id === Number(userId));
    if (!user) return;
    if (!window.confirm(`¿Eliminar el usuario mock ${user.nombre}?`)) return;

    state.users = state.users.filter(item => item.id !== Number(userId));
    state.assignments = state.assignments.filter(item => item.userId !== Number(userId));
    upsertAudit('Usuario eliminado', `Se eliminó ${user.nombre} de la maqueta local.`);
    toast('Acción simulada', 'Usuario eliminado de la maqueta local.', 'success');
    if (state.selectedPermUserId === Number(userId)) {
      state.selectedPermUserId = state.users[0]?.id || null;
      syncPermissionsDraft();
    }
    renderAll();
  }

  function setUserFilterArea(area) {
    state.filters.area = area;
    state.activeTab = 'usuarios';
    renderAll();
  }

  function handlePermissionUserChange(value) {
    state.selectedPermUserId = Number(value);
    syncPermissionsDraft();
    renderPermissionSummary();
    renderPermissionGroups();
  }

  function handlePermissionToggle(code, checked) {
    if (checked) state.permissionsDraft.add(code);
    else state.permissionsDraft.delete(code);
    renderPermissionSummary();
    renderPermissionGroups();
  }

  function savePermissions() {
    const user = getSelectedPermissionUser();
    if (!user) return;

    if (!window.confirm(`¿Guardar permisos mock de ${user.nombre}?`)) return;

    user.menus = Array.from(state.permissionsDraft);
    user.updatedAt = nowLabel();
    upsertAudit('Permisos actualizados', `Se ajustaron los menús permitidos de ${user.nombre}.`);
    toast('Acción simulada', 'Permisos actualizados en la maqueta local.', 'success');
    renderAll();
  }

  function selectAllPermissions() {
    state.permissionsDraft = new Set(state.menus.filter(menu => menu.activo).map(menu => menu.codigo));
    renderPermissionSummary();
    renderPermissionGroups();
  }

  function clearAllPermissions() {
    state.permissionsDraft = new Set();
    renderPermissionSummary();
    renderPermissionGroups();
  }

  function restoreSuggestedPermissions() {
    const user = getSelectedPermissionUser();
    if (!user) return;
    state.permissionsDraft = new Set(getSuggestedMenus(user.area));
    renderPermissionSummary();
    renderPermissionGroups();
    toast('Sugerencias aplicadas', `Se cargaron permisos sugeridos para el área ${getAreaLabel(user.area)}.`, 'success');
  }

  function saveAssignment() {
    const userId = Number(document.getElementById('assignUserSelect')?.value);
    const codigo = document.getElementById('assignVendorCode')?.value.trim();
    const tipo = document.getElementById('assignVendorType')?.value;
    const estado = document.getElementById('assignStatus')?.value;

    if (!userId || !codigo) {
      toast('Validación', 'Debes elegir un usuario y un código de vendedor.', 'error');
      return;
    }

    if (!window.confirm('¿Guardar relación usuario ↔ vendedor en la maqueta?')) return;

    if (state.editingAssignmentId) {
      const item = state.assignments.find(entry => entry.id === state.editingAssignmentId);
      if (item) {
        item.userId = userId;
        item.codigo = codigo;
        item.tipo = tipo;
        item.estado = estado;
      }
      upsertAudit('Asignación editada', `Se editó la relación del usuario ${userId}.`);
    } else {
      state.assignments.push({
        id: nextId(state.assignments),
        userId,
        codigo,
        tipo,
        estado,
      });
      upsertAudit('Asignación creada', `Se agregó el código ${codigo} para el usuario ${userId}.`);
    }

    state.editingAssignmentId = null;
    toast('Acción simulada', 'Relación usuario ↔ vendedor actualizada en la maqueta local.', 'success');
    renderAll();
  }

  function editAssignment(id) {
    const item = state.assignments.find(entry => entry.id === Number(id));
    if (!item) return;
    state.editingAssignmentId = item.id;
    const userSelect = document.getElementById('assignUserSelect');
    if (userSelect) userSelect.value = String(item.userId);
    const codeInput = document.getElementById('assignVendorCode');
    const typeSelect = document.getElementById('assignVendorType');
    const statusSelect = document.getElementById('assignStatus');
    if (codeInput) codeInput.value = item.codigo;
    if (typeSelect) typeSelect.value = item.tipo;
    if (statusSelect) statusSelect.value = item.estado;
    toast('Edición preparada', 'Puedes ajustar la relación y guardarla como mock.', 'warn');
  }

  function deleteAssignment(id) {
    const item = state.assignments.find(entry => entry.id === Number(id));
    if (!item) return;
    if (!window.confirm('¿Quitar esta relación mock?')) return;

    state.assignments = state.assignments.filter(entry => entry.id !== Number(id));
    upsertAudit('Asignación eliminada', `Se quitó el código ${item.codigo} de la maqueta.`);
    toast('Acción simulada', 'Relación eliminada en la maqueta local.', 'success');
    renderAll();
  }

  function saveAreasMock(areaCode) {
    const area = AREAS.find(item => item.codigo === areaCode);
    if (!area) return;
    upsertAudit('Sugeridos aplicados', `Se simularon permisos sugeridos para ${area.nombre}.`);
    toast('Acción simulada', `Se aplicaron sugeridos para ${area.nombre}.`, 'success');
  }

  function renderAll() {
    renderHeader();
    renderKpis();
    renderTabs();
    renderUsers();
    renderPermissionSelect();
    renderPermissionSummary();
    renderPermissionGroups();
    renderMenus();
    renderAreas();
    renderAssignments();
    renderAudit();
    bindFormControls();
  }

  function bindFormControls() {
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

    const permSelect = document.getElementById('permUserSelect');
    if (permSelect && !permSelect.dataset.bound) {
      permSelect.addEventListener('change', event => handlePermissionUserChange(event.target.value));
      permSelect.dataset.bound = '1';
    }

    if (!document.body.dataset.adminBound) {
      document.body.addEventListener('click', event => {
        const tabButton = event.target.closest('[data-tab]');
        if (tabButton) {
          state.activeTab = tabButton.dataset.tab;
          renderTabs();
          if (state.activeTab === 'permisos') renderPermissionGroups();
          return;
        }

        const userAction = event.target.closest('[data-user-action]');
        if (userAction) {
          const id = Number(userAction.dataset.id);
          const action = userAction.dataset.userAction;
          if (action === 'view') openUserEditor(id, 'view');
          if (action === 'edit') openUserEditor(id, 'edit');
          if (action === 'toggle') toggleUserActive(id);
          if (action === 'delete') deleteUser(id);
          return;
        }

        const menuAction = event.target.closest('[data-menu-action]');
        if (menuAction) {
          const id = Number(menuAction.dataset.id);
          const action = menuAction.dataset.menuAction;
          if (action === 'edit') openMenuEditor(id, 'edit');
          if (action === 'toggle') toggleMenuActive(id);
          return;
        }

        const areaAction = event.target.closest('[data-area-action]');
        if (areaAction) {
          const action = areaAction.dataset.areaAction;
          const areaCode = areaAction.dataset.area;
          if (action === 'users') {
            setUserFilterArea(areaCode);
          }
          if (action === 'apply') {
            saveAreasMock(areaCode);
          }
          return;
        }

        const assignAction = event.target.closest('[data-assignment-action]');
        if (assignAction) {
          const id = Number(assignAction.dataset.id);
          const action = assignAction.dataset.assignmentAction;
          if (action === 'edit') editAssignment(id);
          if (action === 'delete') deleteAssignment(id);
          return;
        }

        const checkbox = event.target.closest('[data-permission-code]');
        if (checkbox && checkbox.type === 'checkbox') {
          handlePermissionToggle(checkbox.dataset.permissionCode, checkbox.checked);
          return;
        }
      });
      document.body.dataset.adminBound = '1';
    }

    const nuevoUsuario = document.getElementById('btnNuevoUsuario');
    if (nuevoUsuario && !nuevoUsuario.dataset.bound) {
      nuevoUsuario.addEventListener('click', () => openUserEditor(null, 'new'));
      nuevoUsuario.dataset.bound = '1';
    }

    const nuevoMenu = document.getElementById('btnNuevoMenu');
    if (nuevoMenu && !nuevoMenu.dataset.bound) {
      nuevoMenu.addEventListener('click', () => openMenuEditor(null, 'new'));
      nuevoMenu.dataset.bound = '1';
    }

    const permSelectAll = document.getElementById('permSelectAll');
    if (permSelectAll && !permSelectAll.dataset.bound) {
      permSelectAll.addEventListener('click', selectAllPermissions);
      permSelectAll.dataset.bound = '1';
    }

    const permClearAll = document.getElementById('permClearAll');
    if (permClearAll && !permClearAll.dataset.bound) {
      permClearAll.addEventListener('click', clearAllPermissions);
      permClearAll.dataset.bound = '1';
    }

    const permRestoreArea = document.getElementById('permRestoreArea');
    if (permRestoreArea && !permRestoreArea.dataset.bound) {
      permRestoreArea.addEventListener('click', restoreSuggestedPermissions);
      permRestoreArea.dataset.bound = '1';
    }

    const permSave = document.getElementById('permSave');
    if (permSave && !permSave.dataset.bound) {
      permSave.addEventListener('click', savePermissions);
      permSave.dataset.bound = '1';
    }

    const addAssignment = document.getElementById('btnAddAssignment');
    if (addAssignment && !addAssignment.dataset.bound) {
      addAssignment.addEventListener('click', saveAssignment);
      addAssignment.dataset.bound = '1';
    }

    const drawerClose = document.getElementById('drawerClose');
    if (drawerClose && !drawerClose.dataset.bound) {
      drawerClose.addEventListener('click', closeDrawer);
      drawerClose.dataset.bound = '1';
    }

    const drawerSecondary = document.getElementById('drawerSecondary');
    if (drawerSecondary && !drawerSecondary.dataset.bound) {
      drawerSecondary.addEventListener('click', () => {
        if (dom.drawerReadOnly) {
          openDrawer(state.drawer.type, 'edit', state.drawer.id);
          return;
        }
        closeDrawer();
      });
      drawerSecondary.dataset.bound = '1';
    }

    const drawerPrimary = document.getElementById('drawerPrimary');
    if (drawerPrimary && !drawerPrimary.dataset.bound) {
      drawerPrimary.addEventListener('click', saveCurrentDrawer);
      drawerPrimary.dataset.bound = '1';
    }

    const drawerDanger = document.getElementById('drawerDanger');
    if (drawerDanger && !drawerDanger.dataset.bound) {
      drawerDanger.addEventListener('click', toggleCurrentDrawerStatus);
      drawerDanger.dataset.bound = '1';
    }

    const drawerDelete = document.getElementById('drawerDelete');
    if (drawerDelete && !drawerDelete.dataset.bound) {
      drawerDelete.addEventListener('click', removeCurrentDrawerUser);
      drawerDelete.dataset.bound = '1';
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

  function init() {
    renderAll();
    if (!state.drawer.open) closeDrawer();
    const overlay = document.getElementById('drawerOverlay');
    if (overlay) overlay.setAttribute('aria-hidden', 'true');
  }

  window.__ADMIN_MOCK__ = {
    state,
    renderAll,
    openUserEditor,
    openMenuEditor,
    closeDrawer,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
