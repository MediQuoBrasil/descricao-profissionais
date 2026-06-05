/**
 * ═══════════════════════════════════════════════════════════
 *  admin.js — Lógica do painel administrativo
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *    - Login com Google Identity Services
 *    - Gerenciamento de sessão (sessionStorage)
 *    - CRUD de profissionais
 *    - Upload de foto (URL / arquivo → Drive)
 *    - Editor de tags com seletor de cores
 *    - Filtro e busca na lista de profissionais
 */

(() => {
  'use strict';

  // ─── Estado ─────────────────────────────────────────────

  /** @type {{ session: Object|null, profissionais: Array, areas: string[], searchTerm: string, filterArea: string, editingId: string|null, formTags: Array, selectedTagColor: string, photoMode: string, photoPreviewUrl: string, uploadedBase64: string|null, uploadedMime: string|null, saving: boolean }} */
  const state = {
    session: null,
    profissionais: [],
    areas: [],
    tipo: '',
    email: '',
    searchTerm: '',
    filterArea: '',
    editingId: null,
    formTags: [],
    selectedTagColor: '#7c3aed',
    photoMode: 'url',
    photoPreviewUrl: '',
    uploadedBase64: null,
    uploadedMime: null,
    saving: false,
  };

  /** @const {string[]} Cores predefinidas para tags. */
  const TAG_COLORS = [
    '#7c3aed', '#059669', '#d97706', '#0891b2',
    '#2563eb', '#db2777', '#e11d48', '#6d28d9',
    '#ef4444', '#f59e0b', '#10b981', '#6366f1',
    '#ec4899', '#14b8a6', '#8b5cf6', '#f97316',
  ];

  // ─── Rascunho automático ──────────────────────────────────

  /** @const {string} Chave do rascunho no localStorage. */
  const DRAFT_KEY = 'prof_form_draft';

  /** @const {number} Debounce em ms para salvar rascunho. */
  const DRAFT_DEBOUNCE_MS = 800;

  /**
   * @typedef {Object} FormDraft
   * @property {string} nome
   * @property {string} area
   * @property {string} inscricao
   * @property {string} descricao
   * @property {string} photoUrl
   * @property {string} photoMode
   * @property {Array<{texto: string, cor: string}>} tags
   * @property {string} selectedTagColor
   * @property {number} savedAt - Timestamp de quando o rascunho foi salvo.
   */

  /** @type {number|null} Timer do debounce de rascunho. */
  let draftTimer = null;

  /**
   * Salva o estado atual do formulário como rascunho no localStorage.
   * Só salva quando o modal está aberto e não está em modo de edição.
   * @returns {void}
   */
  const saveDraft = () => {
    // Não salvar rascunho para edições (só criação)
    if (state.editingId) return;

    const isModalOpen = dom.formModal && !dom.formModal.classList.contains('hidden');
    if (!isModalOpen) return;

    /** @type {FormDraft} */
    const draft = {
      nome: (dom.profNome?.value || '').trim(),
      area: (dom.profArea?.value || '').trim(),
      inscricao: (dom.profInscricao?.value || '').trim(),
      descricao: (dom.profDescricao?.value || '').trim(),
      photoUrl: (dom.photoUrlInput?.value || '').trim(),
      photoMode: state.photoMode,
      tags: state.formTags,
      selectedTagColor: state.selectedTagColor,
      savedAt: Date.now(),
    };

    // Não salvar se tudo estiver vazio
    const hasContent = draft.nome || draft.area || draft.inscricao
      || draft.descricao || draft.photoUrl || draft.tags.length > 0;
    if (!hasContent) return;

    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (err) {
      console.warn('[Draft] Falha ao salvar rascunho:', err.message);
    }
  };

  /** Agenda salvamento de rascunho com debounce. */
  const scheduleDraftSave = () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, DRAFT_DEBOUNCE_MS);
  };

  /**
   * Carrega rascunho do localStorage.
   * @returns {FormDraft|null}
   */
  const loadDraft = () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const draft = JSON.parse(raw);
      // Descartar rascunhos com mais de 24h
      if (draft.savedAt && Date.now() - draft.savedAt > 86400000) {
        clearDraft();
        return null;
      }
      return draft;
    } catch {
      return null;
    }
  };

  /** Remove rascunho do localStorage. */
  const clearDraft = () => {
    clearTimeout(draftTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ok */ }
  };

  /**
   * Restaura dados de um rascunho nos campos do formulário.
   * @param {FormDraft} draft
   */
  const restoreDraft = (draft) => {
    if (dom.profNome) dom.profNome.value = draft.nome || '';
    if (dom.profArea) dom.profArea.value = draft.area || '';
    if (dom.profInscricao) dom.profInscricao.value = draft.inscricao || '';
    if (dom.profDescricao) dom.profDescricao.value = draft.descricao || '';
    if (dom.photoUrlInput) dom.photoUrlInput.value = draft.photoUrl || '';

    state.formTags = Array.isArray(draft.tags) ? draft.tags : [];
    state.selectedTagColor = draft.selectedTagColor || TAG_COLORS[0];
    state.photoMode = draft.photoMode || 'url';

    setPhotoMode(state.photoMode);
    if (draft.photoUrl) {
      state.photoPreviewUrl = draft.photoUrl;
      updatePhotoPreview();
    }
    renderFormTags();
    renderTagColorPicker();

    console.info('[Draft] Rascunho restaurado.');
  };

  /**
   * Verifica se o formulário tem conteúdo não salvo.
   * @returns {boolean}
   */
  const isFormDirty = () => {
    if (state.saving) return false;
    const nome = (dom.profNome?.value || '').trim();
    const inscricao = (dom.profInscricao?.value || '').trim();
    const descricao = (dom.profDescricao?.value || '').trim();
    const photoUrl = (dom.photoUrlInput?.value || '').trim();
    return !!(nome || inscricao || descricao || photoUrl
      || state.formTags.length > 0 || state.uploadedBase64);
  };

  // ─── DOM ────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    loginScreen: $('#loginScreen'),
    dashboard: $('#dashboard'),
    googleSignInBtn: $('#googleSignInBtn'),
    loginError: $('#loginError'),
    adminEmail: $('#adminEmail'),
    logoutBtn: $('#logoutBtn'),
    themeToggle: $('#themeToggle'),
    addProfBtn: $('#addProfBtn'),
    adminSearch: $('#adminSearch'),
    adminFilterSelect: $('#adminFilterSelect'),
    adminList: $('#adminList'),
    adminLoading: $('#adminLoading'),
    adminEmpty: $('#adminEmpty'),
    formModal: $('#formModal'),
    formModalTitle: $('#formModalTitle'),
    formClose: $('#formClose'),
    formCancel: $('#formCancel'),
    formSave: $('#formSave'),
    profNome: $('#profNome'),
    profArea: $('#profArea'),
    profInscricao: $('#profInscricao'),
    profDescricao: $('#profDescricao'),
    photoTabUrl: $('#photoTabUrl'),
    photoTabFile: $('#photoTabFile'),
    photoUrlSection: $('#photoUrlSection'),
    photoFileSection: $('#photoFileSection'),
    photoUrlInput: $('#photoUrlInput'),
    photoDropArea: $('#photoDropArea'),
    photoFileInput: $('#photoFileInput'),
    photoPreview: $('#photoPreview'),
    tagsListEdit: $('#tagsListEdit'),
    tagAddInput: $('#tagAddInput'),
    tagAddBtn: $('#tagAddBtn'),
    tagColorPicker: $('#tagColorPicker'),
    tagColorHex: $('#tagColorHex'),
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    confirmCancel: $('#confirmCancel'),
    confirmOk: $('#confirmOk'),
  };

  // ─── Tema ───────────────────────────────────────────────

  const initTheme = () => {
    const saved = localStorage.getItem('theme');
    const theme = (saved === 'light' || saved === 'dark') ? saved : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
  };

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch { /* ok */ }
    updateThemeIcon(next);
  };

  /** @param {string} theme */
  const updateThemeIcon = (theme) => {
    const moon = $('#iconMoon');
    const sun = $('#iconSun');
    if (moon) moon.style.display = theme === 'dark' ? 'block' : 'none';
    if (sun) sun.style.display = theme === 'light' ? 'block' : 'none';
  };

  // ─── Toast ──────────────────────────────────────────────

  /** @type {number|null} */
  let toastTimer = null;

  /**
   * Exibe um toast temporário.
   * @param {string} msg - Mensagem.
   * @param {'success'|'error'|''} [type=''] - Tipo visual.
   */
  const showToast = (msg, type = '') => {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = `toast${type ? ` toast-${type}` : ''}`;
    el.textContent = msg;
    document.body.appendChild(el);

    requestAnimationFrame(() => { el.classList.add('show'); });

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.remove(); }, 400);
    }, 4000);
  };

  /**
   * Toast especial para restauração de rascunho, com botão "Descartar".
   * Tempo estendido (8s) para dar tempo do usuário decidir.
   * @param {Function} onDiscard - Callback ao clicar "Descartar".
   */
  const showDraftRestoredToast = (onDiscard) => {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'toast toast-success';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '0.75rem';

    const text = document.createElement('span');
    text.textContent = 'Rascunho restaurado.';
    el.appendChild(text);

    const btn = document.createElement('button');
    btn.textContent = 'Descartar';
    btn.style.cssText = 'background:none;border:1px solid currentColor;color:inherit;padding:0.15rem 0.5rem;border-radius:4px;cursor:pointer;font-size:0.78rem;white-space:nowrap;';
    btn.addEventListener('click', () => {
      el.remove();
      onDiscard();
    });
    el.appendChild(btn);

    document.body.appendChild(el);
    requestAnimationFrame(() => { el.classList.add('show'); });

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.remove(); }, 400);
    }, 8000);
  };

  // ─── Sessão ─────────────────────────────────────────────

  const SESSION_KEY = 'admin_session';

  const saveSession = (data) => {
    state.session = data;
    state.areas = data.areas || [];
    state.tipo = data.tipo || '';
    state.email = data.email || '';
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* ok */ }
  };

  const loadSession = () => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.sessionToken) {
          state.session = data;
          state.areas = data.areas || [];
          state.tipo = data.tipo || '';
          state.email = data.email || '';
          return true;
        }
      }
    } catch { /* ok */ }
    return false;
  };

  const clearSession = () => {
    state.session = null;
    state.areas = [];
    state.tipo = '';
    state.email = '';
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ok */ }
  };

  // ─── Google Identity Services ────────────────────────────

  /** @type {Object|null} Instância do GIS token client. */
  let gisClient = null;

  const initGoogleSignIn = () => {
    if (typeof google === 'undefined' || !google.accounts) {
      console.warn('[Admin] Google Identity Services não carregado.');
      return;
    }

    gisClient = google.accounts.oauth2.initTokenClient({
      client_id: GIS_CLIENT_ID,
      scope: 'email profile openid',
      callback: handleGisResponse,
    });
  };

  /**
   * Callback do Google Identity Services com a resposta do token.
   * Neste caso, usamos o fluxo de ID Token via popup.
   * @param {Object} response - Resposta do GIS.
   */
  const handleGisResponse = async (response) => {
    // GIS popup com initCodeClient / initTokenClient retorna access_token.
    // Para ID token, usaremos a abordagem via google.accounts.id.
  };

  /**
   * Inicializa Sign In With Google (renderiza botão ou usa prompt).
   */
  const initSignInWithGoogle = () => {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
      console.warn('[Admin] Google Identity Services (id) não carregado.');
      return;
    }

    google.accounts.id.initialize({
      client_id: GIS_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
  };

  /**
   * Callback da resposta de credencial do Google (ID Token).
   * @param {{ credential: string, select_by: string }} response
   */
  const handleCredentialResponse = async (response) => {
    if (!response.credential) {
      setLoginError('Falha na autenticação. Tente novamente.');
      return;
    }

    setLoginLoading(true);
    setLoginError('');

    try {
      const result = await loginAdmin(response.credential);

      if (result.success && result.data) {
        saveSession(result.data);
        showDashboard();
        await loadProfissionais();
        showToast('Login realizado com sucesso!', 'success');
      } else {
        setLoginError(result.message || 'Login não autorizado.');
      }
    } catch (err) {
      console.error('[Admin] Erro no login:', err);
      setLoginError('Erro ao conectar com o servidor.');
    }

    setLoginLoading(false);
  };

  /**
   * Abre o prompt do Google Sign In.
   */
  const triggerGoogleSignIn = () => {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) {
      setLoginError('Google Sign In não disponível. Recarregue a página.');
      return;
    }

    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed()) {
        // Fallback: renderiza botão padrão do Google
        renderGoogleButton();
      }
    });
  };

  /**
   * Renderiza botão padrão do Google como fallback.
   */
  const renderGoogleButton = () => {
    const container = $('#googleBtnContainer');
    if (!container) return;

    container.innerHTML = '';
    container.style.display = 'flex';
    container.style.justifyContent = 'center';

    google.accounts.id.renderButton(container, {
      theme: 'outline',
      size: 'large',
      width: 280,
      text: 'signin_with',
      locale: 'pt-BR',
    });

    if (dom.googleSignInBtn) {
      dom.googleSignInBtn.style.display = 'none';
    }
  };

  // ─── Login UI ────────────────────────────────────────────

  /** @param {boolean} loading */
  const setLoginLoading = (loading) => {
    if (dom.googleSignInBtn) {
      dom.googleSignInBtn.disabled = loading;
      const label = dom.googleSignInBtn.querySelector('.btn-label');
      const spinner = dom.googleSignInBtn.querySelector('.spinner');
      if (label) label.textContent = loading ? 'Entrando...' : 'Entrar com Google';
      if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
    }
  };

  /** @param {string} msg */
  const setLoginError = (msg) => {
    if (dom.loginError) dom.loginError.textContent = msg;
  };

  const showLogin = () => {
    if (dom.loginScreen) dom.loginScreen.classList.remove('hidden');
    if (dom.dashboard) dom.dashboard.classList.add('hidden');
  };

  const showDashboard = () => {
    if (dom.loginScreen) dom.loginScreen.classList.add('hidden');
    if (dom.dashboard) dom.dashboard.classList.remove('hidden');
    if (dom.adminEmail) dom.adminEmail.textContent = state.email;
    buildAreaFilterSelect();
  };

  // ─── Logout ──────────────────────────────────────────────

  const handleLogout = async () => {
    if (state.session?.sessionToken) {
      try {
        await logoutAdmin(state.session.sessionToken);
      } catch { /* ok */ }
    }

    clearSession();

    // Revoga o GIS
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
    }

    showLogin();
    showToast('Sessão encerrada.', 'success');
  };

  // ─── Carregar Profissionais ──────────────────────────────

  const loadProfissionais = async () => {
    if (!state.session?.sessionToken) return;

    setAdminLoading(true);

    try {
      const result = await fetchAdminList(state.session.sessionToken);

      if (result.success && result.data) {
        state.profissionais = result.data.profissionais || [];
        // Atualizar áreas da sessão (caso tenham mudado)
        if (result.data.areas) state.areas = result.data.areas;
        if (result.data.tipo) state.tipo = result.data.tipo;
        if (result.data.email) state.email = result.data.email;
      } else if (result.message && result.message.includes('Sessão expirada')) {
        clearSession();
        showLogin();
        showToast('Sessão expirada. Faça login novamente.', 'error');
        return;
      } else {
        showToast(result.message || 'Erro ao carregar profissionais.', 'error');
      }
    } catch (err) {
      console.error('[Admin] Erro ao carregar:', err);
      showToast('Erro ao conectar com o servidor.', 'error');
    }

    setAdminLoading(false);
    renderAdminList();
  };

  // ─── Admin List Rendering ───────────────────────────────

  /** @param {boolean} show */
  const setAdminLoading = (show) => {
    if (dom.adminLoading) dom.adminLoading.classList.toggle('hidden', !show);
    if (dom.adminList) dom.adminList.classList.toggle('hidden', show);
  };

  const buildAreaFilterSelect = () => {
    if (!dom.adminFilterSelect) return;
    dom.adminFilterSelect.innerHTML = '<option value="">Todas as áreas</option>';

    const areasToShow = state.tipo === 'master'
      ? Object.keys(AREAS)
      : state.areas;

    (areasToShow || []).forEach((area) => {
      if (area === '*') return;
      const opt = document.createElement('option');
      opt.value = area;
      opt.textContent = area;
      dom.adminFilterSelect.appendChild(opt);
    });
  };

  /**
   * Área color map local para badges.
   * @const {Object<string, string>}
   */
  const AREAS = {
    'Psicologia': '#7c3aed',
    'Nutrição': '#059669',
    'Treinadores': '#d97706',
    'Veterinária': '#0891b2',
    'Clínica médica': '#2563eb',
    'Ginecologia': '#db2777',
    'Dermatologia': '#e11d48',
    'Psiquiatria': '#6d28d9',
  };

  /**
   * Filtra profissionais pela busca e filtro de área.
   * @returns {Array<Object>}
   */
  const getFilteredList = () => {
    let list = state.profissionais;

    if (state.filterArea) {
      list = list.filter((p) => p.area === state.filterArea);
    }

    if (state.searchTerm) {
      const term = state.searchTerm.toLowerCase();
      list = list.filter((p) => {
        const text = [
          p.nome, p.area, p.inscricao, p.descricao,
          ...(p.tags || []).map((t) => t.texto),
        ].join(' ').toLowerCase();
        return text.includes(term);
      });
    }

    return list;
  };

  /**
   * Retorna a inicial do nome.
   * @param {string} nome
   * @returns {string}
   */
  const getInitial = (nome) => (nome ? nome.charAt(0).toUpperCase() : '?');

  /**
   * Renderiza a lista de profissionais no painel admin.
   */
  const renderAdminList = () => {
    if (!dom.adminList) return;

    const filtered = getFilteredList();
    dom.adminList.innerHTML = '';

    if (filtered.length === 0) {
      if (dom.adminEmpty) dom.adminEmpty.classList.remove('hidden');
      return;
    }

    if (dom.adminEmpty) dom.adminEmpty.classList.add('hidden');

    filtered.forEach((prof, i) => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      item.style.animationDelay = `${i * 0.04}s`;

      const areaColor = AREAS[prof.area] || '#8a7da3';

      // Foto
      const photoHtml = prof.fotoUrl
        ? `<img class="admin-item-photo" src="${prof.fotoUrl}" alt="" loading="lazy" onerror="this.outerHTML='<div class=\\'admin-item-photo-placeholder\\'>${getInitial(prof.nome)}</div>'">`
        : `<div class="admin-item-photo-placeholder">${getInitial(prof.nome)}</div>`;

      // Status
      const isAtivo = prof.ativo !== false;
      const statusClass = isAtivo ? 'status-ativo' : 'status-inativo';
      const statusText = isAtivo ? 'Ativo' : 'Inativo';

      item.innerHTML = `
        ${photoHtml}
        <div class="admin-item-info">
          <div class="admin-item-name">${escapeHtml(prof.nome)}</div>
          <div class="admin-item-meta">
            <span class="admin-item-area-dot" style="background:${areaColor}"></span>
            <span>${escapeHtml(prof.area)}</span>
            <span class="admin-item-status ${statusClass}">${statusText}</span>
          </div>
        </div>
        <div class="admin-item-actions">
          <button class="btn btn-icon btn-edit" data-id="${prof.id}" title="Editar" aria-label="Editar profissional">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="btn btn-icon btn-delete" data-id="${prof.id}" data-nome="${escapeHtml(prof.nome)}" title="Remover" aria-label="Remover profissional">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
      `;

      // Event listeners nos botões
      item.querySelector('.btn-edit').addEventListener('click', () => { openEditForm(prof); });
      item.querySelector('.btn-delete').addEventListener('click', () => { openDeleteConfirm(prof); });

      dom.adminList.appendChild(item);
    });
  };

  // ─── Escape HTML ─────────────────────────────────────────

  /**
   * Escapa caracteres HTML para prevenir XSS.
   * @param {string} str
   * @returns {string}
   */
  const escapeHtml = (str) => {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  // ─── Formulário: Abrir / Fechar ──────────────────────────

  const openNewForm = () => {
    state.editingId = null;
    state.formTags = [];
    state.photoPreviewUrl = '';
    state.uploadedBase64 = null;
    state.uploadedMime = null;
    state.selectedTagColor = TAG_COLORS[0];

    if (dom.formModalTitle) dom.formModalTitle.textContent = 'Novo Profissional';
    resetFormFields();
    populateAreaSelect();

    // Verificar rascunho salvo
    const draft = loadDraft();
    if (draft) {
      restoreDraft(draft);
      showDraftRestoredToast(() => {
        clearDraft();
        resetFormFields();
        state.formTags = [];
        state.selectedTagColor = TAG_COLORS[0];
        renderFormTags();
        renderTagColorPicker();
        setPhotoMode('url');
        updatePhotoPreview();
        showToast('Rascunho descartado.', 'success');
      });
      console.info('[Draft] Rascunho encontrado (salvo em %s). Restaurando.', new Date(draft.savedAt).toLocaleTimeString('pt-BR'));
    } else {
      renderFormTags();
      renderTagColorPicker();
      setPhotoMode('url');
      updatePhotoPreview();
    }

    openModal(dom.formModal);
  };

  /**
   * Abre o formulário em modo de edição.
   * @param {Object} prof - Profissional a editar.
   */
  const openEditForm = (prof) => {
    state.editingId = prof.id;
    state.formTags = (prof.tags || []).map((t) => ({ ...t }));
    state.photoPreviewUrl = prof.fotoUrl || '';
    state.uploadedBase64 = null;
    state.uploadedMime = null;
    state.selectedTagColor = TAG_COLORS[0];

    if (dom.formModalTitle) dom.formModalTitle.textContent = 'Editar Profissional';
    resetFormFields();
    populateAreaSelect();

    if (dom.profNome) dom.profNome.value = prof.nome || '';
    if (dom.profArea) dom.profArea.value = prof.area || '';
    if (dom.profInscricao) dom.profInscricao.value = prof.inscricao || '';
    if (dom.profDescricao) dom.profDescricao.value = prof.descricao || '';
    if (dom.photoUrlInput) dom.photoUrlInput.value = prof.fotoUrl || '';

    renderFormTags();
    renderTagColorPicker();
    setPhotoMode('url');
    updatePhotoPreview();
    openModal(dom.formModal);
  };

  /**
   * Fecha o modal do formulário. Se houver dados não salvos,
   * pede confirmação e preserva o rascunho automaticamente.
   * @param {boolean} [force=false] - Pular confirmação (usado após save com sucesso).
   */
  const closeFormModal = (force = false) => {
    if (!force && !state.editingId && isFormDirty()) {
      // Salvar rascunho imediato antes de pedir confirmação
      saveDraft();
      const shouldClose = window.confirm(
        'Há dados não salvos. Seu rascunho foi preservado e será restaurado na próxima vez que abrir o formulário.\n\nDeseja fechar mesmo assim?',
      );
      if (!shouldClose) return;
      console.info('[Draft] Modal fechado com rascunho preservado.');
    } else if (force) {
      // Save com sucesso — limpar rascunho
      clearDraft();
    }
    closeModal(dom.formModal);
  };

  const resetFormFields = () => {
    if (dom.profNome) dom.profNome.value = '';
    if (dom.profArea) dom.profArea.selectedIndex = 0;
    if (dom.profInscricao) dom.profInscricao.value = '';
    if (dom.profDescricao) dom.profDescricao.value = '';
    if (dom.photoUrlInput) dom.photoUrlInput.value = '';
    if (dom.tagAddInput) dom.tagAddInput.value = '';
    if (dom.photoFileInput) dom.photoFileInput.value = '';

    // Limpar erros
    $$('.field-error').forEach((el) => { el.textContent = ''; });
  };

  const populateAreaSelect = () => {
    if (!dom.profArea) return;
    dom.profArea.innerHTML = '<option value="">Selecione a área</option>';

    const areasToShow = state.tipo === 'master'
      ? Object.keys(AREAS)
      : state.areas.filter((a) => a !== '*');

    areasToShow.forEach((area) => {
      const opt = document.createElement('option');
      opt.value = area;
      opt.textContent = area;
      dom.profArea.appendChild(opt);
    });
  };

  // ─── Modal genérico ──────────────────────────────────────

  /** @param {HTMLElement} modal */
  const openModal = (modal) => {
    if (modal) modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  };

  /** @param {HTMLElement} modal */
  const closeModal = (modal) => {
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
  };

  // ─── Upload de Foto ──────────────────────────────────────

  /**
   * Alterna entre URL e upload de arquivo.
   * @param {'url'|'file'} mode
   */
  const setPhotoMode = (mode) => {
    state.photoMode = mode;

    if (dom.photoTabUrl) dom.photoTabUrl.classList.toggle('active', mode === 'url');
    if (dom.photoTabFile) dom.photoTabFile.classList.toggle('active', mode === 'file');
    if (dom.photoUrlSection) dom.photoUrlSection.classList.toggle('hidden', mode !== 'url');
    if (dom.photoFileSection) dom.photoFileSection.classList.toggle('hidden', mode !== 'file');
  };

  const updatePhotoPreview = () => {
    if (!dom.photoPreview) return;

    const url = state.photoMode === 'url'
      ? (dom.photoUrlInput?.value || '').trim()
      : state.photoPreviewUrl;

    if (url) {
      dom.photoPreview.innerHTML = `<img class="photo-preview-img" src="${escapeHtml(url)}" alt="Preview" onerror="this.outerHTML='<div class=\\'photo-preview-placeholder\\'>Erro</div>'">`;
    } else {
      dom.photoPreview.innerHTML = '<div class="photo-preview-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></div>';
    }
  };

  /**
   * Processa arquivo de foto para base64.
   * @param {File} file
   */
  const handlePhotoFile = (file) => {
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast('Formato inválido. Use JPEG, PNG ou WebP.', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('Arquivo muito grande. Máximo: 5MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Full = reader.result;
      const base64Data = base64Full.split(',')[1];
      state.uploadedBase64 = base64Data;
      state.uploadedMime = file.type;
      state.photoPreviewUrl = base64Full;
      updatePhotoPreview();
      showToast('Foto carregada com sucesso.', 'success');
    };
    reader.onerror = () => {
      showToast('Erro ao ler o arquivo.', 'error');
    };
    reader.readAsDataURL(file);
  };

  // ─── Tags Editor ─────────────────────────────────────────

  const renderFormTags = () => {
    if (!dom.tagsListEdit) return;
    dom.tagsListEdit.innerHTML = '';

    state.formTags.forEach((tag, i) => {
      const el = document.createElement('span');
      el.className = 'tag-edit-item';
      el.style.background = `${tag.cor}18`;
      el.style.color = tag.cor;

      const text = document.createTextNode(tag.texto);
      el.appendChild(text);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'tag-remove-btn';
      removeBtn.innerHTML = '✕';
      removeBtn.title = 'Remover tag';
      removeBtn.addEventListener('click', () => {
        state.formTags.splice(i, 1);
        renderFormTags();
        scheduleDraftSave();
      });

      el.appendChild(removeBtn);
      dom.tagsListEdit.appendChild(el);
    });
  };

  const addTag = () => {
    const input = dom.tagAddInput;
    if (!input) return;

    const texto = input.value.trim();
    if (!texto) return;

    if (state.formTags.length >= 15) {
      showToast('Máximo de 15 tags atingido.', 'error');
      return;
    }

    const duplicate = state.formTags.some(
      (t) => t.texto.toLowerCase() === texto.toLowerCase(),
    );
    if (duplicate) {
      showToast('Tag já existe.', 'error');
      return;
    }

    state.formTags.push({ texto, cor: state.selectedTagColor });
    input.value = '';
    renderFormTags();
    scheduleDraftSave();
  };

  const renderTagColorPicker = () => {
    if (!dom.tagColorPicker) return;
    dom.tagColorPicker.innerHTML = '';

    TAG_COLORS.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.className = `tag-color-swatch${color === state.selectedTagColor ? ' selected' : ''}`;
      swatch.style.background = color;
      swatch.title = color;
      swatch.type = 'button';
      swatch.addEventListener('click', () => {
        state.selectedTagColor = color;
        if (dom.tagColorHex) dom.tagColorHex.value = color;
        $$('.tag-color-swatch').forEach((s) => s.classList.remove('selected'));
        swatch.classList.add('selected');
      });
      dom.tagColorPicker.appendChild(swatch);
    });

    if (dom.tagColorHex) dom.tagColorHex.value = state.selectedTagColor;
  };

  const handleHexInput = () => {
    if (!dom.tagColorHex) return;
    let hex = dom.tagColorHex.value.trim();
    if (!hex.startsWith('#')) hex = `#${hex}`;

    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
      state.selectedTagColor = hex;
      $$('.tag-color-swatch').forEach((s) => s.classList.remove('selected'));
    }
  };

  // ─── Salvar Profissional ─────────────────────────────────

  const handleSave = async () => {
    if (state.saving) return;

    console.info('[Admin] handleSave: início. editingId=%s, photoMode=%s, uploadedBase64=%s, tags=%s',
      state.editingId || '(novo)', state.photoMode, state.uploadedBase64 ? 'sim' : 'não', state.formTags.length);

    // Validação
    const nome = (dom.profNome?.value || '').trim();
    const area = (dom.profArea?.value || '').trim();
    const inscricao = (dom.profInscricao?.value || '').trim();
    const descricao = (dom.profDescricao?.value || '').trim();

    let hasError = false;

    if (!nome) {
      setFieldError('profNome', 'Nome é obrigatório.');
      hasError = true;
    } else {
      setFieldError('profNome', '');
    }

    if (!area) {
      setFieldError('profArea', 'Selecione uma área.');
      hasError = true;
    } else {
      setFieldError('profArea', '');
    }

    if (!inscricao) {
      setFieldError('profInscricao', 'Inscrição é obrigatória.');
      hasError = true;
    } else {
      setFieldError('profInscricao', '');
    }

    if (!descricao) {
      setFieldError('profDescricao', 'Descrição é obrigatória.');
      hasError = true;
    } else {
      setFieldError('profDescricao', '');
    }

    if (hasError) {
      console.warn('[Admin] handleSave: validação frontend falhou.');
      return;
    }

    state.saving = true;
    setSaveLoading(true);

    try {
      // 1. Upload de foto (se necessário)
      let fotoUrl = '';

      if (state.photoMode === 'url') {
        fotoUrl = (dom.photoUrlInput?.value || '').trim();
        console.info('[Admin] Foto via URL: "%s"', fotoUrl ? fotoUrl.substring(0, 60) : '(vazio)');
      } else if (state.uploadedBase64) {
        // Upload para Drive
        console.info('[Admin] Foto via upload. mimeType=%s, base64.length=%s', state.uploadedMime, state.uploadedBase64?.length);
        const uploadResult = await uploadPhoto(
          state.session.sessionToken,
          state.uploadedBase64,
          state.uploadedMime,
          nome,
        );

        console.info('[Admin] Upload resultado: success=%s, url=%s', uploadResult.success, uploadResult.data?.url?.substring(0, 60) || '(sem url)');

        if (uploadResult.success && uploadResult.data?.url) {
          fotoUrl = uploadResult.data.url;
        } else {
          console.error('[Admin] Upload falhou: %s', uploadResult.message);
          showToast(uploadResult.message || 'Erro ao enviar foto.', 'error');
          state.saving = false;
          setSaveLoading(false);
          return;
        }
      } else if (state.editingId && state.photoPreviewUrl && !state.photoPreviewUrl.startsWith('data:')) {
        // Manter foto existente na edição
        fotoUrl = state.photoPreviewUrl;
        console.info('[Admin] Mantendo foto existente: "%s"', fotoUrl.substring(0, 60));
      } else {
        console.info('[Admin] Sem foto selecionada.');
      }

      // 2. Montar dados
      const data = {
        nome,
        area,
        fotoUrl,
        inscricao,
        descricao,
        tags: state.formTags,
      };

      console.info('[Admin] Enviando %s. fotoUrl=%s', state.editingId ? 'update' : 'create', fotoUrl ? fotoUrl.substring(0, 60) : '(vazio)');

      // 3. Criar ou atualizar
      let result;
      if (state.editingId) {
        result = await updateProf(state.session.sessionToken, state.editingId, data);
      } else {
        result = await createProf(state.session.sessionToken, data);
      }

      console.info('[Admin] Resposta do backend: success=%s, message=%s', result.success, result.message || '(sem mensagem)');

      if (result.success) {
        showToast(
          state.editingId ? 'Profissional atualizado!' : 'Profissional cadastrado!',
          'success',
        );
        closeFormModal(true);
        await loadProfissionais();
      } else if (result.message && result.message.includes('Sessão expirada')) {
        clearSession();
        showLogin();
        showToast('Sessão expirada. Faça login novamente.', 'error');
      } else {
        showToast(result.message || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      console.error('[Admin] Erro ao salvar:', err);
      showToast('Erro ao conectar com o servidor.', 'error');
    }

    state.saving = false;
    setSaveLoading(false);
  };

  /**
   * Define mensagem de erro de campo.
   * @param {string} fieldId - ID do campo (sem #).
   * @param {string} msg - Mensagem de erro (vazio para limpar).
   */
  const setFieldError = (fieldId, msg) => {
    const field = $(`#${fieldId}`);
    if (!field) return;
    const errorEl = field.parentElement?.querySelector('.field-error');
    if (errorEl) errorEl.textContent = msg;
  };

  /** @param {boolean} loading */
  const setSaveLoading = (loading) => {
    if (dom.formSave) {
      dom.formSave.disabled = loading;
      const label = dom.formSave.querySelector('.btn-label');
      const spinner = dom.formSave.querySelector('.spinner');
      if (label) label.textContent = loading ? 'Salvando...' : 'Salvar';
      if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
    }
  };

  // ─── Deletar Profissional ───────────────────────────────

  /** @type {string|null} ID do profissional a deletar. */
  let deleteTargetId = null;

  /**
   * Abre o modal de confirmação de exclusão.
   * @param {Object} prof - Profissional a remover.
   */
  const openDeleteConfirm = (prof) => {
    deleteTargetId = prof.id;
    if (dom.confirmText) {
      dom.confirmText.innerHTML = `Tem certeza que deseja remover <strong>${escapeHtml(prof.nome)}</strong>? Esta ação pode ser revertida pelo administrador master.`;
    }
    openModal(dom.confirmModal);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTargetId || !state.session?.sessionToken) return;

    try {
      const result = await deleteProf(state.session.sessionToken, deleteTargetId);

      if (result.success) {
        showToast('Profissional removido.', 'success');
        closeModal(dom.confirmModal);
        await loadProfissionais();
      } else if (result.message && result.message.includes('Sessão expirada')) {
        clearSession();
        showLogin();
        showToast('Sessão expirada. Faça login novamente.', 'error');
      } else {
        showToast(result.message || 'Erro ao remover.', 'error');
      }
    } catch (err) {
      console.error('[Admin] Erro ao deletar:', err);
      showToast('Erro ao conectar com o servidor.', 'error');
    }

    deleteTargetId = null;
  };

  // ─── Busca e Filtro (Admin) ──────────────────────────────

  const handleAdminSearch = () => {
    state.searchTerm = (dom.adminSearch?.value || '').trim();
    renderAdminList();
  };

  const handleAdminFilter = () => {
    state.filterArea = dom.adminFilterSelect?.value || '';
    renderAdminList();
  };

  // ─── Inicialização ──────────────────────────────────────

  const bindEvents = () => {
    // Theme
    if (dom.themeToggle) dom.themeToggle.addEventListener('click', toggleTheme);

    // Login
    if (dom.googleSignInBtn) {
      dom.googleSignInBtn.addEventListener('click', triggerGoogleSignIn);
    }

    // Logout
    if (dom.logoutBtn) dom.logoutBtn.addEventListener('click', handleLogout);

    // Add profissional
    if (dom.addProfBtn) dom.addProfBtn.addEventListener('click', openNewForm);

    // Busca e filtro
    if (dom.adminSearch) dom.adminSearch.addEventListener('input', handleAdminSearch);
    if (dom.adminFilterSelect) dom.adminFilterSelect.addEventListener('change', handleAdminFilter);

    // Modal form
    if (dom.formClose) dom.formClose.addEventListener('click', () => closeFormModal());
    if (dom.formCancel) dom.formCancel.addEventListener('click', () => closeFormModal());
    if (dom.formSave) dom.formSave.addEventListener('click', handleSave);

    // Foto tabs
    if (dom.photoTabUrl) dom.photoTabUrl.addEventListener('click', () => setPhotoMode('url'));
    if (dom.photoTabFile) dom.photoTabFile.addEventListener('click', () => setPhotoMode('file'));

    // URL preview + draft save
    if (dom.photoUrlInput) {
      dom.photoUrlInput.addEventListener('input', () => {
        state.photoPreviewUrl = dom.photoUrlInput.value.trim();
        updatePhotoPreview();
        scheduleDraftSave();
      });
    }

    // File upload
    if (dom.photoDropArea) {
      dom.photoDropArea.addEventListener('click', () => dom.photoFileInput?.click());

      dom.photoDropArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.photoDropArea.classList.add('dragover');
      });

      dom.photoDropArea.addEventListener('dragleave', () => {
        dom.photoDropArea.classList.remove('dragover');
      });

      dom.photoDropArea.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.photoDropArea.classList.remove('dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) handlePhotoFile(file);
      });
    }

    if (dom.photoFileInput) {
      dom.photoFileInput.addEventListener('change', () => {
        const file = dom.photoFileInput.files?.[0];
        if (file) handlePhotoFile(file);
      });
    }

    // Tags
    if (dom.tagAddBtn) dom.tagAddBtn.addEventListener('click', addTag);
    if (dom.tagAddInput) {
      dom.tagAddInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addTag();
        }
      });
    }
    if (dom.tagColorHex) dom.tagColorHex.addEventListener('input', handleHexInput);

    // Rascunho automático — campos de texto do formulário
    [dom.profNome, dom.profInscricao, dom.profDescricao].forEach((el) => {
      if (el) el.addEventListener('input', scheduleDraftSave);
    });
    if (dom.profArea) dom.profArea.addEventListener('change', scheduleDraftSave);

    // Confirm modal
    if (dom.confirmCancel) dom.confirmCancel.addEventListener('click', () => closeModal(dom.confirmModal));
    if (dom.confirmOk) dom.confirmOk.addEventListener('click', handleConfirmDelete);

    // Fechar modais com overlay click
    if (dom.formModal) {
      dom.formModal.addEventListener('click', (e) => {
        if (e.target === dom.formModal) closeFormModal();
      });
    }
    if (dom.confirmModal) {
      dom.confirmModal.addEventListener('click', (e) => {
        if (e.target === dom.confirmModal) closeModal(dom.confirmModal);
      });
    }

    // Fechar modais com Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (dom.formModal && !dom.formModal.classList.contains('hidden')) {
          closeFormModal();
        } else if (dom.confirmModal && !dom.confirmModal.classList.contains('hidden')) {
          closeModal(dom.confirmModal);
        }
      }
    });

    // Proteção contra fechamento acidental da aba/janela
    window.addEventListener('beforeunload', (e) => {
      const isModalOpen = dom.formModal && !dom.formModal.classList.contains('hidden');
      if (isModalOpen && isFormDirty()) {
        saveDraft();
        e.preventDefault();
      }
    });
  };

  const init = async () => {
    initTheme();
    bindEvents();

    // Verificar sessão existente
    const hasSession = loadSession();

    if (hasSession) {
      showDashboard();
      await loadProfissionais();
    } else {
      showLogin();
    }

    // Inicializar Google Sign In (quando a lib carrega)
    if (typeof google !== 'undefined' && google.accounts) {
      initSignInWithGoogle();
    } else {
      // Esperar a lib carregar
      window.addEventListener('load', () => {
        setTimeout(() => {
          initSignInWithGoogle();
        }, 500);
      });
    }
  };

  // ─── Start ──────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
