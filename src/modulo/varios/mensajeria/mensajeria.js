'use strict';

(function () {
  const API_BASE = '/api/mensajeria';
  const state = {
    user: null,
    conversaciones: [],
    directorio: { usuarios: [], areas: [] },
    onlineUsers: new Set(),
    lastMessageIds: new Map(),
    drafts: new Map(),
    conversacionActivaId: null,
    mensajesActivos: [],
    search: '',
    panelActivo: 'usuarios',
    mobileView: 'list',
    cargandoMensajes: false,
    activeRefreshTimer: null,
  };

  const el = {};

  function qs(id) {
    return document.getElementById(id);
  }

  function getToken() {
    return localStorage.getItem('token');
  }

  async function api(path, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };

    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || data?.ok === false) {
      const error = new Error(data?.error || `Error HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }

    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function formatDateTime(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value));
    } catch {
      return String(value);
    }
  }

  function initials(name) {
    return String(name || 'T')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0].toUpperCase())
      .join('') || 'T';
  }

  function setHeaderUser(user) {
    const nombre = user?.nombre || 'Usuario';
    el.userName.textContent = nombre;
    el.userArea.textContent = user?.area ? `Área ${user.area}` : '';
    el.userAvatar.textContent = initials(nombre);
  }

  function conversationTitle(conversation) {
    if (conversation?.titulo) return conversation.titulo;
    if (conversation?.tipo === 'area') return `Área ${conversation.area_codigo || ''}`.trim();
    if (conversation?.tipo === 'grupo') return 'Grupo interno';

    const other = (conversation?.participantes || [])
      .find(part => Number(part.usuario_id) !== Number(state.user?.id));
    return other?.usuario?.nombre || 'Conversación directa';
  }

  function conversationSubtitle(conversation) {
    const participantes = (conversation?.participantes || [])
      .map(part => part.usuario?.nombre)
      .filter(Boolean);

    if (conversation?.tipo === 'area') {
      return `Área: ${conversation.area_codigo || 'general'} · ${participantes.length} participantes`;
    }

    if (conversation?.tipo === 'grupo') {
      return `${participantes.length} participantes`;
    }

    return participantes.filter(name => name !== state.user?.nombre).join(' · ') || 'Mensaje directo';
  }

  function conversationSnippet(conversation) {
    if (!conversation?.ultimo_mensaje) return 'Sin mensajes todavía';
    const prefix = Number(conversation.ultimo_mensaje.remitente_id) === Number(state.user?.id) ? 'Tú: ' : '';
    return `${prefix}${conversation.ultimo_mensaje.cuerpo}`;
  }

  function conversationNewMessageLabel(conversation) {
    const unread = Number(conversation?.no_leidos || 0);
    if (!unread || !conversation?.ultimo_mensaje) return '';
    const sender = conversation.ultimo_mensaje.remitente_nombre || 'Usuario';
    return unread === 1 ? `Nuevo de ${sender}` : `${unread} nuevos de ${sender}`;
  }

  function conversationAvatar(conversation) {
    return initials(conversationTitle(conversation));
  }

  function getDirectConversationForUser(userId) {
    return state.conversaciones.find(conversation => {
      if (conversation.tipo !== 'directa') return false;
      const participants = conversation.participantes || [];
      const hasSelf = participants.some(part => Number(part.usuario_id) === Number(state.user?.id));
      const hasTarget = participants.some(part => Number(part.usuario_id) === Number(userId));
      return hasSelf && hasTarget;
    }) || null;
  }

  function normalizeUserId(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function isUserOnline(userId) {
    const normalized = normalizeUserId(userId);
    return normalized ? state.onlineUsers.has(normalized) : false;
  }

  function setOnlineUsers(ids = []) {
    state.onlineUsers = new Set(
      (Array.isArray(ids) ? ids : [])
        .map(normalizeUserId)
        .filter(Boolean)
    );
  }

  function getConversationPeer(conversation) {
    return (conversation?.participantes || []).find(part => Number(part.usuario_id) !== Number(state.user?.id)) || null;
  }

  function conversationOnlineInfo(conversation) {
    if (!conversation) return { online: false, label: 'Desconectado' };
    if (conversation.tipo !== 'directa') {
      const connected = (conversation.participantes || [])
        .filter(part => Number(part.usuario_id) !== Number(state.user?.id) && isUserOnline(part.usuario_id))
        .length;
      return connected > 0
        ? { online: true, label: `${connected} conectado${connected === 1 ? '' : 's'}` }
        : { online: false, label: 'Grupo' };
    }

    const peer = getConversationPeer(conversation);
    const online = peer ? isUserOnline(peer.usuario_id) : false;
    return {
      online,
      label: online ? 'En línea' : 'Desconectado',
    };
  }

  function conversationPresenceClass(conversation) {
    return conversationOnlineInfo(conversation).online ? 'is-online' : 'is-offline';
  }

  function conversationPresenceLabel(conversation) {
    return conversationOnlineInfo(conversation).label;
  }

  function showIncomingMessageToast(conversation, message) {
    const notifier = window.GICOTEXRealtime?.showToast;
    if (typeof notifier !== 'function') return;
    const sender = message?.remitente_nombre || 'Usuario';
    const title = `Nuevo mensaje de ${sender}`;
    const body = `${conversationTitle(conversation)}: ${String(message?.cuerpo || '').slice(0, 120)}`;
    notifier(title, body);
  }

  function rememberConversationLastMessage(conversationId, messages = []) {
    const id = Number(conversationId);
    const latest = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
    const latestId = Number(latest?.id || 0);
    if (id > 0 && latestId > 0) {
      state.lastMessageIds.set(id, latestId);
    }
    return latest;
  }

  function isNearBottom(container) {
    if (!container) return true;
    return (container.scrollHeight - container.scrollTop - container.clientHeight) < 48;
  }

  function isMobileChatViewport() {
    return window.matchMedia && window.matchMedia('(max-width: 780px)').matches;
  }

  function syncSidebarLayout() {
    if (!el.mainWrapper || !el.sidebar) return;
    const collapsed = el.sidebar.classList.contains('sidebar--collapsed');
    const mobile = isMobileChatViewport();
    el.mainWrapper.classList.toggle('main-wrapper--expanded', collapsed && !mobile);
  }

  function syncMobileChatView() {
    if (!el.workspaceShell) return;

    const mobile = isMobileChatViewport();
    const showThread = mobile && state.mobileView === 'thread' && Boolean(state.conversacionActivaId);

    el.workspaceShell.classList.toggle('is-thread-open', showThread);
    if (el.btnBackToList) {
      el.btnBackToList.hidden = !mobile || !state.conversacionActivaId;
    }

    if (!mobile) {
      state.mobileView = state.conversacionActivaId ? 'thread' : 'list';
      el.workspaceShell.classList.remove('is-thread-open');
      if (el.btnBackToList) el.btnBackToList.hidden = true;
    }
  }

  function openChatThreadView() {
    state.mobileView = 'thread';
    syncMobileChatView();
  }

  function returnToConversationList() {
    state.mobileView = 'list';
    syncMobileChatView();
  }

  function updateCounter(total) {
    if (!el.conversationCount) return;
    el.conversationCount.textContent = String(total);
  }

  function renderPanelTabs() {
    document.querySelectorAll('.panel-tab').forEach(button => {
      const active = button.dataset.panel === state.panelActivo;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderConversationList() {
    const term = normalizeText(state.search);

    if (state.panelActivo === 'usuarios') {
      const usuarios = state.directorio.usuarios.filter(user => {
        if (!term) return true;
        const haystack = [
          user.nombre,
          user.email,
          user.area,
        ].map(normalizeText).join(' ');
        return haystack.includes(term);
      });

      updateCounter(usuarios.length);

      if (!usuarios.length) {
        el.conversationList.innerHTML = `
          <div class="empty-state">
            <div>
              <h3>No hay usuarios para mostrar</h3>
              <p>Prueba con otro filtro.</p>
            </div>
          </div>
        `;
        return;
      }

      el.conversationList.innerHTML = usuarios.map(user => {
        const directConversation = getDirectConversationForUser(user.id);
        const active = Number(directConversation?.id) === Number(state.conversacionActivaId);
        const online = isUserOnline(user.id);
        return `
          <button type="button" class="conversation-item user-item ${active ? 'active' : ''}" data-user-id="${user.id}">
            <div class="conversation-avatar">${escapeHtml(initials(user.nombre))}</div>
            <div>
              <div class="conversation-meta">
                <strong class="conversation-name">${escapeHtml(user.nombre)}</strong>
                <span>${escapeHtml(user.email || '')}</span>
              </div>
              <div class="conversation-subtitle">${escapeHtml(user.area || 'Sin área')}</div>
              <div class="conversation-presence">
                <span class="presence-dot ${online ? 'is-online' : 'is-offline'}" aria-hidden="true"></span>
                <span>${online ? 'En línea' : 'Desconectado'}</span>
              </div>
              <div class="conversation-snippet">${directConversation ? 'Chat abierto o disponible' : 'Abrir chat directo'}</div>
            </div>
            <div class="conversation-badges">
              ${directConversation?.no_leidos ? `<span class="badge badge--unread">${directConversation.no_leidos}</span>` : ''}
              ${active ? '<span class="badge badge--muted">Activo</span>' : ''}
            </div>
          </button>
        `;
      }).join('');

      el.conversationList.querySelectorAll('[data-user-id]').forEach(button => {
        button.addEventListener('click', () => {
          const userId = Number(button.dataset.userId);
          const user = state.directorio.usuarios.find(item => Number(item.id) === userId);
          if (user) {
            openOrCreateDirectChat(user);
          }
        });
      });
      return;
    }

    const conversaciones = state.conversaciones.filter(conversation => {
      if (!term) return true;
      const haystack = [
        conversationTitle(conversation),
        conversationSubtitle(conversation),
        conversationSnippet(conversation),
      ].map(normalizeText).join(' ');
      return haystack.includes(term);
    });

    updateCounter(conversaciones.length);

    if (!conversaciones.length) {
      el.conversationList.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>No hay chats para mostrar</h3>
            <p>Vuelve a revisar más tarde o abre un chat desde la pestaña de usuarios.</p>
          </div>
        </div>
      `;
      return;
    }

    el.conversationList.innerHTML = conversaciones.map(conversation => {
      const active = Number(conversation.id) === Number(state.conversacionActivaId);
      const unread = Number(conversation.no_leidos || 0);
      const newLabel = conversationNewMessageLabel(conversation);
      const presenceLabel = conversationPresenceLabel(conversation);
      const presenceClass = conversationPresenceClass(conversation);
      return `
        <button type="button" class="conversation-item ${active ? 'active' : ''} ${unread ? 'has-new-message' : ''}" data-conversation-id="${conversation.id}">
          <div class="conversation-avatar">${escapeHtml(conversationAvatar(conversation))}</div>
          <div>
            <div class="conversation-meta">
              <strong class="conversation-name">${escapeHtml(conversationTitle(conversation))}</strong>
              <span>${escapeHtml(formatDateTime(conversation.ultimo_mensaje?.created_at || conversation.updated_at || conversation.created_at))}</span>
            </div>
            <div class="conversation-subtitle">${escapeHtml(conversationSubtitle(conversation))}</div>
            <div class="conversation-presence">
              <span class="presence-dot ${presenceClass}" aria-hidden="true"></span>
              <span>${escapeHtml(presenceLabel)}</span>
            </div>
            <div class="conversation-snippet">${escapeHtml(conversationSnippet(conversation))}</div>
          </div>
          <div class="conversation-badges">
            ${newLabel ? `<span class="badge badge--new">${escapeHtml(newLabel)}</span>` : ''}
            ${unread ? `<span class="badge badge--unread">${unread}</span>` : ''}
            ${conversation.silenciada ? '<span class="badge badge--muted">Silenciada</span>' : ''}
          </div>
        </button>
      `;
    }).join('');

    el.conversationList.querySelectorAll('[data-conversation-id]').forEach(button => {
      button.addEventListener('click', () => openConversation(button.dataset.conversationId));
    });
  }

  function renderMessages() {
    const previousScrollTop = el.messagesFeed?.scrollTop || 0;
    if (!state.conversacionActivaId) {
      state.mobileView = 'list';
      syncMobileChatView();
      el.messagesFeed.innerHTML = `
        <div class="empty-thread">
          <h3>No hay un chat abierto todavía</h3>
          <p>Elige un usuario de la lista para iniciar o retomar una conversación.</p>
        </div>
      `;
      el.threadTitle.textContent = 'Selecciona un usuario';
      el.threadSubtitle.innerHTML = '<span>Aquí verás el historial del chat directo.</span>';
      el.messageInput.disabled = true;
      el.btnSendMessage.disabled = true;
      el.btnToggleArchivo.disabled = true;
      el.btnToggleSilencio.disabled = true;
      el.composerHint.textContent = 'Selecciona un usuario para responder.';
      return;
    }

    const conversation = state.conversaciones.find(item => Number(item.id) === Number(state.conversacionActivaId));
    if (!conversation) return;

    const stickToBottom = isNearBottom(el.messagesFeed);
    const presenceLabel = conversationPresenceLabel(conversation);
    const presenceClass = conversationPresenceClass(conversation);

    el.threadTitle.textContent = conversationTitle(conversation);
    el.threadSubtitle.innerHTML = `
      <span>${escapeHtml(conversationSubtitle(conversation))}</span>
      <span class="thread-status">
        <span class="presence-dot ${presenceClass}" aria-hidden="true"></span>
        <span>${escapeHtml(presenceLabel)}</span>
      </span>
    `;
    el.messageInput.disabled = false;
    el.btnSendMessage.disabled = false;
    el.btnToggleArchivo.disabled = false;
    el.btnToggleSilencio.disabled = false;
    el.btnToggleArchivo.textContent = conversation.archivada ? 'Desarchivar' : 'Archivar';
    el.btnToggleSilencio.textContent = conversation.silenciada ? 'Activar sonido' : 'Silenciar';
    el.composerHint.textContent = conversation.archivada
      ? 'El chat está archivado para ti, pero puedes responder para volver a activarlo.'
      : 'Escribe un mensaje y presiona Enviar.';

    if (!state.mensajesActivos.length) {
      el.messagesFeed.innerHTML = `
        <div class="empty-thread">
          <div>
            <h3>Aún no hay mensajes</h3>
            <p>Envía el primer mensaje para iniciar este chat.</p>
          </div>
        </div>
      `;
      return;
    }

    el.messagesFeed.innerHTML = state.mensajesActivos.map(message => {
      const self = Number(message.remitente_id) === Number(state.user?.id);
      return `
        <article class="message ${self ? 'self' : ''}">
          <div class="message-card">
            <div class="message-header">
              <strong>${self ? 'Tú' : escapeHtml(message.remitente_nombre || 'Usuario')}</strong>
              <span>${escapeHtml(formatDateTime(message.created_at))}</span>
            </div>
            <p class="message-body">${escapeHtml(message.cuerpo)}</p>
          </div>
        </article>
      `;
    }).join('');

    if (stickToBottom) {
      el.messagesFeed.scrollTop = el.messagesFeed.scrollHeight;
    } else if (previousScrollTop > 0) {
      el.messagesFeed.scrollTop = previousScrollTop;
    }

    syncMobileChatView();
  }

  async function loadHeaderBadge() {
    try {
      const data = await api('/no-leidos');
      const total = Number(data?.data?.total || 0);
      el.unreadHeaderCount.textContent = String(total);
    } catch {
      el.unreadHeaderCount.textContent = '0';
    }
  }

  async function loadPresence() {
    try {
      const data = await api('/usuarios-online');
      setOnlineUsers(data?.online || data?.data?.online || []);
      renderConversationList();
      renderMessages();
    } catch {
      setOnlineUsers([]);
      renderConversationList();
      renderMessages();
    }
  }

  async function loadConversations() {
    const data = await api('/conversaciones');
    state.conversaciones = Array.isArray(data?.data) ? data.data : [];
    state.conversaciones.forEach(conversation => {
      const latest = conversation?.ultimo_mensaje;
      const latestId = Number(latest?.id || 0);
      if (latestId > 0) {
        state.lastMessageIds.set(Number(conversation.id), latestId);
      }
    });

    if (state.conversacionActivaId) {
      const stillExists = state.conversaciones.some(item => Number(item.id) === Number(state.conversacionActivaId));
      if (!stillExists) {
        state.conversacionActivaId = null;
        state.mensajesActivos = [];
      }
    }

    renderConversationList();
    renderMessages();
    await loadHeaderBadge();
  }

  async function handleRealtimePresenceUpdate(payload = {}) {
    const userId = normalizeUserId(payload?.usuario_id);
    if (!userId) return;

    if (payload.online) {
      state.onlineUsers.add(userId);
    } else {
      state.onlineUsers.delete(userId);
    }

    renderConversationList();
    renderMessages();
  }

  async function loadDirectory() {
    const data = await api('/directorio');
    state.directorio = data?.data || { usuarios: [], areas: [] };
    renderConversationList();
  }

  async function loadMessages(conversationId, { silent = false } = {}) {
    if (!conversationId) return;
    if (state.cargandoMensajes && silent) return;
    state.cargandoMensajes = true;

    try {
      const data = await api(`/conversaciones/${conversationId}/mensajes`);
      state.conversacionActivaId = Number(conversationId);
      const mensajes = Array.isArray(data?.data?.mensajes) ? data.data.mensajes : [];
      const conversation = data?.data?.conversacion || state.conversaciones.find(item => Number(item.id) === Number(conversationId));
      const previousLastId = Number(state.lastMessageIds.get(Number(conversationId)) || 0);
      const latest = rememberConversationLastMessage(conversationId, mensajes);
      state.mensajesActivos = mensajes;

      const updatedConversation = data?.data?.conversacion;
      if (updatedConversation) {
        const index = state.conversaciones.findIndex(item => Number(item.id) === Number(conversationId));
        if (index >= 0) {
          state.conversaciones[index] = {
            ...state.conversaciones[index],
            ...updatedConversation,
            participantes: updatedConversation.participantes || state.conversaciones[index].participantes || [],
          };
        }
      }

      if (latest && previousLastId > 0 && Number(latest.id || 0) > previousLastId && Number(latest.remitente_id) !== Number(state.user?.id)) {
        showIncomingMessageToast(conversation || updatedConversation || {}, latest);
      }

      renderConversationList();
      renderMessages();
      await api(`/conversaciones/${conversationId}/leido`, { method: 'PATCH' });
      await loadHeaderBadge();
    } catch (error) {
      if (!silent) {
        alert(error.message);
      }
    } finally {
      state.cargandoMensajes = false;
    }
  }

  async function openConversation(conversationId) {
    openChatThreadView();
    await loadMessages(conversationId);
  }

  async function openOrCreateDirectChat(user) {
    try {
      const response = await api('/conversaciones', {
        method: 'POST',
        body: JSON.stringify({ tipo: 'directa', usuario_id: user.id }),
      });
      const conversationId = response?.data?.id;
      if (!conversationId) {
        throw new Error('No se pudo abrir el chat.');
      }

      await loadConversations();
      await openConversation(conversationId);
    } catch (error) {
      alert(error.message);
    }
  }

  function activatePanel(panel) {
    state.panelActivo = panel;
    renderPanelTabs();
    renderConversationList();
  }

  async function sendMessage(event) {
    event.preventDefault();
    const conversationId = state.conversacionActivaId;
    if (!conversationId) return;

    const body = el.messageInput.value.trim();
    if (!body) return;

    try {
      await api(`/conversaciones/${conversationId}/mensajes`, {
        method: 'POST',
        body: JSON.stringify({ cuerpo: body }),
      });
      el.messageInput.value = '';
      state.drafts.delete(Number(conversationId));
      await loadMessages(conversationId, { silent: true });
      await loadConversations();
    } catch (error) {
      alert(error.message);
    }
  }

  function startActiveConversationAutoRefresh() {
    if (state.activeRefreshTimer) {
      clearInterval(state.activeRefreshTimer);
    }

    state.activeRefreshTimer = setInterval(() => {
      if (!state.conversacionActivaId) return;
      if (document.hidden) return;
      if (document.activeElement === el.messageInput) return;
      if (String(el.messageInput?.value || '').trim()) return;
      loadMessages(state.conversacionActivaId, { silent: true }).catch(() => {});
    }, 3500);
  }

  async function toggleFlag(flag) {
    const conversationId = state.conversacionActivaId;
    if (!conversationId) return;

    const conversation = state.conversaciones.find(item => Number(item.id) === Number(conversationId));
    if (!conversation) return;

    const payload = flag === 'archivada'
      ? { archivada: !conversation.archivada }
      : { silenciada: !conversation.silenciada };

    try {
      await api(`/conversaciones/${conversationId}/${flag === 'archivada' ? 'archivar' : 'silenciar'}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await loadConversations();
      await loadMessages(conversationId, { silent: true });
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleRealtimeChatEvent(payload = {}) {
    const conversationId = Number(payload.conversacion_id || payload?.mensaje?.conversacion_id || payload?.conversacion?.id || 0);
    if (!conversationId) {
      await loadConversations();
      await loadHeaderBadge();
      return;
    }

    await loadConversations();
    if (Number(state.conversacionActivaId) === conversationId) {
      if (document.activeElement !== el.messageInput && !String(el.messageInput?.value || '').trim()) {
        await loadMessages(conversationId, { silent: true });
      }
    }
    await loadHeaderBadge();
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem('texpro_user') || localStorage.getItem('user') || localStorage.getItem('usuario');
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  window.GICOTEXMensajeriaRealtime = {
    refreshConversations: () => loadConversations(),
    refreshUnreadBadge: () => loadHeaderBadge(),
    refreshPresence: () => loadPresence(),
    refreshActiveConversation: () => (state.conversacionActivaId
      ? (document.activeElement === el.messageInput || String(el.messageInput?.value || '').trim()
        ? Promise.resolve()
        : loadMessages(state.conversacionActivaId, { silent: true }))
      : Promise.resolve()),
    handleRealtimeChatEvent,
    handleRealtimePresenceEvent: handleRealtimePresenceUpdate,
    getActiveConversationId: () => state.conversacionActivaId,
  };

  function bindEvents() {
    el.conversationSearch.addEventListener('input', event => {
      state.search = event.target.value || '';
      renderConversationList();
    });

    document.querySelectorAll('.panel-tab').forEach(button => {
      button.addEventListener('click', () => activatePanel(button.dataset.panel));
    });

    el.btnRefresh.addEventListener('click', async () => {
      await loadDirectory();
      await loadConversations();
      if (state.conversacionActivaId) {
        await loadMessages(state.conversacionActivaId, { silent: true });
      }
    });

    el.sidebarToggle?.addEventListener('click', () => {
      el.sidebar?.classList.toggle('sidebar--collapsed');
      syncSidebarLayout();
    });

    el.headerMenuBtn?.addEventListener('click', () => {
      el.sidebar?.classList.toggle('sidebar--open');
    });

    el.btnBackToList?.addEventListener('click', () => {
      returnToConversationList();
    });

    el.composerForm.addEventListener('submit', sendMessage);
    el.messageInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey) return;
      event.preventDefault();
      el.composerForm.requestSubmit();
    });
    el.messageInput.addEventListener('input', () => {
      if (!state.conversacionActivaId) return;
      state.drafts.set(Number(state.conversacionActivaId), el.messageInput.value);
    });
    el.btnToggleSilencio.addEventListener('click', () => toggleFlag('silenciada'));
    el.btnToggleArchivo.addEventListener('click', () => toggleFlag('archivada'));

    el.btnLogout.addEventListener('click', () => {
      localStorage.removeItem('token');
      sessionStorage.removeItem('texpro_user');
      window.location.href = '/src/modulo/varios/login/index.html';
    });
  }

  async function init() {
    el.sidebar = qs('sidebar');
    el.mainWrapper = qs('mainWrapper');
    el.workspaceShell = qs('workspaceShell');
    el.headerMenuBtn = qs('headerMenuBtn');
    el.sidebarToggle = qs('sidebarToggle');
    el.btnLogout = qs('btnLogout');
    el.userName = qs('userName');
    el.userArea = qs('userArea');
    el.userAvatar = qs('userAvatar');
    el.unreadHeaderCount = qs('unreadHeaderCount');
    el.btnRefresh = qs('btnRefresh');
    el.conversationSearch = qs('conversationSearch');
    el.conversationCount = qs('conversationCount');
    el.conversationList = qs('conversationList');
    el.threadTitle = qs('threadTitle');
    el.threadSubtitle = qs('threadSubtitle');
    el.btnToggleSilencio = qs('btnToggleSilencio');
    el.btnToggleArchivo = qs('btnToggleArchivo');
    el.btnBackToList = qs('btnBackToList');
    el.messagesFeed = qs('messagesFeed');
    el.composerForm = qs('composerForm');
    el.messageInput = qs('messageInput');
    el.btnSendMessage = qs('btnSendMessage');
    el.composerHint = qs('composerHint');

    state.user = loadSession();
    setHeaderUser(state.user);
    bindEvents();
    renderPanelTabs();
    syncSidebarLayout();
    syncMobileChatView();
    startActiveConversationAutoRefresh();
    window.addEventListener('focus', () => {
      if (state.conversacionActivaId) {
        if (document.activeElement !== el.messageInput && !String(el.messageInput?.value || '').trim()) {
          loadMessages(state.conversacionActivaId, { silent: true }).catch(() => {});
        }
      }
      loadHeaderBadge().catch(() => {});
    }, { passive: true });
    window.addEventListener('resize', () => {
      syncSidebarLayout();
      syncMobileChatView();
    }, { passive: true });

    try {
      await loadDirectory();
    } catch (error) {
      console.warn('[mensajeria] no se pudo cargar el directorio:', error.message);
      el.conversationList.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>No se pudo cargar el directorio</h3>
            <p>Revisa la conexión o vuelve a intentar más tarde.</p>
          </div>
        </div>
      `;
    }

    try {
      await loadConversations();
    } catch (error) {
      console.warn('[mensajeria] no se pudieron cargar las conversaciones:', error.message);
      el.conversationList.innerHTML = `
        <div class="empty-state">
          <div>
            <h3>No se pudieron cargar los chats</h3>
            <p>Intenta actualizar la vista para reintentar la carga.</p>
          </div>
        </div>
      `;
    }

    try {
      await loadPresence();
    } catch (error) {
      console.warn('[mensajeria] no se pudo cargar presencia en línea:', error.message);
    }

    try {
      await loadHeaderBadge();
    } catch (error) {
      console.warn('[mensajeria] no se pudo cargar el contador:', error.message);
    }

    if (state.user?.id) {
      document.title = 'Texpro - Mensajería interna';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
