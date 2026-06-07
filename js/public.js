/**
 * ═══════════════════════════════════════════════════════════
 *  public.js — Lógica da visualização pública
 * ═══════════════════════════════════════════════════════════
 *
 *  Responsabilidades:
 *    - Buscar profissionais da API
 *    - Renderizar cards
 *    - Filtrar por área (checkboxes)
 *    - Buscar por texto (nome, área, tags, descrição)
 *    - Toggle de tema claro/escuro
 */

(() => {
  'use strict';

  // ─── Estado ─────────────────────────────────────────────

  /** @type {{ profissionais: Array<Object>, areas: Object, filters: Set<string>, searchTerm: string }} */
  const state = {
    profissionais: [],
    areas: {},
    filters: new Set(),
    searchTerm: '',
    filterOpen: false,
    infoOpen: false,
    legendOpen: false,
  };

  // ─── DOM ────────────────────────────────────────────────

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    grid: $('#professionalsGrid'),
    searchInput: $('#searchInput'),
    searchClear: $('#searchClear'),
    filterToggle: $('#filterToggleBtn'),
    filterDropdown: $('#filterDropdown'),
    filterOptions: $('#filterOptions'),
    filterSelectAll: $('#filterSelectAll'),
    filterDeselectAll: $('#filterDeselectAll'),
    resultsCount: $('#resultsCount'),
    infoCountBtn: $('#infoCountBtn'),
    infoCountPopover: $('#infoCountPopover'),
    legendToggleBtn: $('#legendToggleBtn'),
    legendPopover: $('#legendPopover'),
    themeToggle: $('#themeToggle'),
    loadingState: $('#loadingState'),
    emptyState: $('#emptyState'),
  };

  // ─── SWR Cache (localStorage) ─────────────────────────────

  /** @const {string} Chave do cache local de profissionais. */
  const SWR_CACHE_KEY = 'pub_profissionais_v1';

  /** @const {number} Idade máxima do cache local em ms (24h). Após isso, trata como miss. */
  const SWR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

  /**
   * Lê dados do cache local (localStorage).
   * @returns {{ data: Array<Object>, ts: number } | null} Cache ou null se vazio/expirado.
   */
  const getLocalCache = () => {
    try {
      const raw = localStorage.getItem(SWR_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed.data || !Array.isArray(parsed.data) || parsed.data.length === 0) return null;
      if (Date.now() - parsed.ts > SWR_MAX_AGE_MS) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  /**
   * Grava dados no cache local (localStorage).
   * @param {Array<Object>} profissionais - Lista de profissionais.
   * @returns {void}
   */
  const setLocalCache = (profissionais) => {
    try {
      localStorage.setItem(SWR_CACHE_KEY, JSON.stringify({
        data: profissionais,
        ts: Date.now(),
      }));
    } catch {
      // Storage cheio — falha silenciosa, cache é best-effort.
    }
  };

  // ─── Rendering Progressivo ────────────────────────────────

  /** @const {number} Cards no primeiro batch em mobile (< 768px). */
  const FIRST_BATCH_MOBILE = 2;

  /** @const {number} Cards no primeiro batch em desktop (>= 768px). */
  const FIRST_BATCH_DESKTOP = 4;

  /** @const {number} Cards por chunk após o primeiro batch. */
  const CHUNK_SIZE = 4;

  /**
   * Retorna o tamanho do primeiro batch baseado na largura da viewport.
   * @returns {number}
   */
  const getFirstBatchSize = () => (window.innerWidth < 768 ? FIRST_BATCH_MOBILE : FIRST_BATCH_DESKTOP);

  // ─── Tema ───────────────────────────────────────────────

  const initTheme = () => {
    const saved = localStorage.getItem('theme');
    const theme = (saved === 'light' || saved === 'dark') ? saved : 'dark';
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

  // ─── Photo Zoom (tap/click to expand) ────────────────────

  /** @const {number} Duração do toque longo para ativar zoom (ms). */
  const LONG_PRESS_MS = 300;

  /** @type {HTMLElement|null} Overlay singleton (criado lazy). */
  let zoomOverlay = null;

  /** @type {number|null} Timer do long-press pendente. */
  let longPressTimer = null;

  /** @type {boolean} Se o zoom está ativo no momento. */
  let zoomActive = false;

  /** @type {number} Timestamp do último touchend para ignorar ghost click no handler de clique. */
  let lastTouchEndTime = 0;

  // ─── Photo Zoom Hint (primeira visita) ──────────────────

  /** @const {string} Chave do localStorage para controlar exibição da hint de zoom. */
  const HINT_KEY = 'photo_zoom_hint_seen';

  /** @type {HTMLElement|null} Referência ao elemento da hint ativa. */
  let activeHint = null;

  /** @type {number|null} Timer de auto-dismiss da hint. */
  let hintAutoTimer = null;

  /**
   * Dispensa a hint de zoom e salva preferência no localStorage.
   * Seguro para chamadas múltiplas (idempotente).
   * @returns {void}
   */
  const dismissPhotoHint = () => {
    if (!activeHint) return;

    activeHint.classList.remove('active');

    const target = dom.grid?.querySelector('.photo-hint-target');
    if (target) target.classList.remove('photo-hint-target');

    clearTimeout(hintAutoTimer);
    hintAutoTimer = null;

    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ok */ }

    const el = activeHint;
    activeHint = null;
    setTimeout(() => el.remove(), 450);
  };

  /**
   * Exibe a hint de zoom para visitantes de primeira vez.
   * Detecta plataforma (touch vs mouse) e exibe texto adaptado.
   * Adiciona ring pulsante na primeira foto para chamar atenção.
   * @returns {void}
   */
  const showPhotoHint = () => {
    try {
      if (localStorage.getItem(HINT_KEY)) return;
    } catch {
      return;
    }

    // Só exibe se há pelo menos um card com foto real (não placeholder)
    const firstImg = dom.grid?.querySelector('.prof-photo-wrap img');
    const firstPhotoWrap = firstImg?.closest('.prof-photo-wrap');
    if (!firstPhotoWrap) return;

    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Ring pulsante na primeira foto
    firstPhotoWrap.classList.add('photo-hint-target');

    // Monta o hint card
    const hint = document.createElement('div');
    hint.className = 'photo-hint';
    hint.setAttribute('role', 'status');
    hint.setAttribute('aria-live', 'polite');

    const text = isTouchDevice
      ? 'Toque e segure na foto para expandir'
      : 'Clique na foto para expandir';

    hint.innerHTML = `
      <span class="photo-hint-icon" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          <line x1="11" y1="8" x2="11" y2="14"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      </span>
      <span class="photo-hint-text">${text}</span>
      <button class="photo-hint-dismiss" type="button">Entendi</button>
    `;

    document.body.appendChild(hint);
    activeHint = hint;

    // Entrada animada (duplo rAF garante que o browser registra o estado inicial)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        hint.classList.add('active');
      });
    });

    hint.querySelector('.photo-hint-dismiss').addEventListener('click', dismissPhotoHint);

    // Auto-dismiss após 12s (salva no localStorage igualmente)
    hintAutoTimer = setTimeout(dismissPhotoHint, 12000);
  };

  /**
   * Retorna (ou cria) o overlay singleton de zoom.
   * @returns {HTMLElement}
   */
  const getZoomOverlay = () => {
    if (zoomOverlay) return zoomOverlay;

    zoomOverlay = document.createElement('div');
    zoomOverlay.className = 'photo-zoom-overlay';
    zoomOverlay.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'photo-zoom-content';

    const img = document.createElement('img');
    img.className = 'photo-zoom-img';
    img.alt = '';
    img.draggable = false;

    const name = document.createElement('span');
    name.className = 'photo-zoom-name';

    content.appendChild(img);
    content.appendChild(name);
    zoomOverlay.appendChild(content);
    document.body.appendChild(zoomOverlay);

    // Fecha ao clicar/tocar fora da foto circular
    zoomOverlay.addEventListener('click', (e) => {
      if (!e.target.closest('.photo-zoom-img')) {
        hidePhotoZoom();
      }
    });

    // Impede scroll do body enquanto overlay está visível (iOS)
    zoomOverlay.addEventListener('touchmove', (e) => {
      e.preventDefault();
    }, { passive: false });

    return zoomOverlay;
  };

  /**
   * Exibe o zoom da foto no overlay.
   * @param {string} src - URL da foto (Drive thumbnail).
   * @param {string} profNome - Nome do profissional.
   */
  const showPhotoZoom = (src, profNome) => {
    const overlay = getZoomOverlay();
    const img = overlay.querySelector('.photo-zoom-img');
    const nameEl = overlay.querySelector('.photo-zoom-name');

    // Solicita resolução maior ao Drive para o zoom
    const hiResSrc = src.includes('sz=w400')
      ? src.replace('sz=w400', 'sz=w800')
      : src;

    img.src = hiResSrc;
    img.alt = `Foto de ${profNome}`;
    nameEl.textContent = profNome;

    zoomActive = true;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Dispensa a hint se ativa (usuário descobriu o recurso)
    dismissPhotoHint();

    // Haptic feedback sutil (Android)
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  };

  /** Oculta o overlay de zoom. */
  const hidePhotoZoom = () => {
    if (!zoomOverlay || !zoomActive) return;
    zoomActive = false;
    zoomOverlay.classList.remove('active');
    zoomOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };

  /**
   * Configura interação de zoom na foto.
   * - Mobile: long-press (300ms) abre o zoom; permanece aberto ao soltar o dedo.
   * - Desktop: clique simples abre o zoom.
   * - Ambos: fecha ao clicar/tocar fora da foto no overlay.
   * @param {HTMLElement} photoWrap - Elemento `.prof-photo-wrap`.
   * @param {string} src - URL da foto.
   * @param {string} profNome - Nome do profissional.
   */
  const setupPhotoLongPress = (photoWrap, src, profNome) => {
    let startX = 0;
    let startY = 0;

    photoWrap.style.cursor = 'pointer';

    photoWrap.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;

      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        showPhotoZoom(src, profNome);
      }, LONG_PRESS_MS);
    }, { passive: true });

    photoWrap.addEventListener('touchmove', (e) => {
      // Zoom já ativo — impede scroll sob o overlay
      if (zoomActive) {
        e.preventDefault();
        return;
      }
      // Timer pendente — cancela se o dedo moveu > 10px (scroll)
      if (longPressTimer) {
        const touch = e.touches[0];
        const dx = Math.abs(touch.clientX - startX);
        const dy = Math.abs(touch.clientY - startY);
        if (dx > 10 || dy > 10) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
    }, { passive: false });

    photoWrap.addEventListener('touchend', () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      lastTouchEndTime = Date.now();
      // Zoom permanece aberto — fecha via overlay
    });

    photoWrap.addEventListener('touchcancel', () => {
      clearTimeout(longPressTimer);
      longPressTimer = null;
      lastTouchEndTime = Date.now();
    });

    // Previne menu de contexto (Android "Salvar imagem")
    photoWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Desktop: clique simples abre o zoom
    photoWrap.addEventListener('click', () => {
      // Ignora ghost click que o browser dispara após touchend em mobile
      if (Date.now() - lastTouchEndTime < 500) return;
      if (!zoomActive) {
        showPhotoZoom(src, profNome);
      }
    });
  };

  // ─── Filtros ────────────────────────────────────────────

  /**
   * Ordem fixa das áreas para filtros e exibição.
   * @const {string[]}
   */
  const AREAS_ORDER = [
    'Clínica geral',
    'Dermatologia',
    'Ginecologia',
    'Nutrição',
    'Psicologia',
    'Psiquiatria',
    'Treinadores',
    'Veterinária',
  ];

  const buildFilterOptions = () => {
    if (!dom.filterOptions) return;
    dom.filterOptions.innerHTML = '';

    const areas = Object.entries(state.areas);
    areas.sort(([a], [b]) => {
      const ia = AREAS_ORDER.indexOf(a);
      const ib = AREAS_ORDER.indexOf(b);
      const oa = ia === -1 ? AREAS_ORDER.length : ia;
      const ob = ib === -1 ? AREAS_ORDER.length : ib;
      return oa - ob || a.localeCompare(b, 'pt-BR');
    });
    areas.forEach(([name, config]) => {
      const option = document.createElement('label');
      option.className = `filter-option${state.filters.has(name) ? ' checked' : ''}`;
      option.dataset.area = name;

      option.innerHTML = `
        <span class="filter-checkbox"></span>
        <span class="filter-area-dot" style="background:${config.color}"></span>
        <span class="filter-area-name">${name}</span>
      `;

      option.addEventListener('click', () => {
        if (state.filters.has(name)) {
          state.filters.delete(name);
          option.classList.remove('checked');
        } else {
          state.filters.add(name);
          option.classList.add('checked');
        }
        updateFilterBtnState();
        renderCards();
      });

      dom.filterOptions.appendChild(option);
    });
  };

  const selectAllFilters = () => {
    Object.keys(state.areas).forEach((name) => state.filters.add(name));
    $$('.filter-option').forEach((el) => el.classList.add('checked'));
    updateFilterBtnState();
    renderCards();
  };

  const deselectAllFilters = () => {
    state.filters.clear();
    $$('.filter-option').forEach((el) => el.classList.remove('checked'));
    updateFilterBtnState();
    renderCards();
  };

  const updateFilterBtnState = () => {
    if (!dom.filterToggle) return;
    const totalAreas = Object.keys(state.areas).length;
    const selected = state.filters.size;
    const isFiltering = selected > 0 && selected < totalAreas;

    dom.filterToggle.classList.toggle('has-filter', isFiltering);

    const label = dom.filterToggle.querySelector('.filter-btn-label');
    if (label) {
      label.textContent = isFiltering ? `Filtros (${selected})` : 'Filtrar';
    }
  };

  const toggleFilterDropdown = () => {
    state.filterOpen = !state.filterOpen;
    if (dom.filterDropdown) {
      dom.filterDropdown.classList.toggle('hidden', !state.filterOpen);
    }
  };

  const toggleInfoPopover = () => {
    state.infoOpen = !state.infoOpen;
    if (dom.infoCountPopover) {
      dom.infoCountPopover.classList.toggle('hidden', !state.infoOpen);
    }
    if (dom.infoCountBtn) {
      dom.infoCountBtn.setAttribute('aria-expanded', String(state.infoOpen));
    }
  };

  const toggleLegendPopover = () => {
    state.legendOpen = !state.legendOpen;
    if (dom.legendPopover) {
      dom.legendPopover.classList.toggle('hidden', !state.legendOpen);
    }
    if (dom.legendToggleBtn) {
      dom.legendToggleBtn.setAttribute('aria-expanded', String(state.legendOpen));
    }
  };

  // ─── Busca ──────────────────────────────────────────────

  const handleSearch = () => {
    state.searchTerm = (dom.searchInput?.value || '').trim().toLowerCase();
    if (dom.searchClear) {
      dom.searchClear.classList.toggle('visible', state.searchTerm.length > 0);
    }
    renderCards();
  };

  const clearSearch = () => {
    if (dom.searchInput) dom.searchInput.value = '';
    state.searchTerm = '';
    if (dom.searchClear) dom.searchClear.classList.remove('visible');
    renderCards();
  };

  // ─── Filtragem ──────────────────────────────────────────

  /**
   * Filtra profissionais por áreas selecionadas e termo de busca.
   * Resultado ordenado por área (ordem fixa) e nome (alfabético).
   * @returns {Array<Object>} Profissionais filtrados e ordenados.
   */
  const getFilteredProfissionais = () => {
    let list = state.profissionais;

    // Filtro por área (nenhuma selecionada = nenhum resultado)
    list = list.filter((p) => state.filters.has(p.area));

    // Filtro por busca (inclui tags invisíveis)
    if (state.searchTerm) {
      const term = state.searchTerm;
      list = list.filter((p) => {
        const searchableText = [
          p.nome,
          p.area,
          p.inscricao,
          p.descricao,
          ...(p.tags || []).map((t) => t.texto),
          ...(p.tagsInvisiveis || []),
        ].join(' ').toLowerCase();

        return searchableText.includes(term);
      });
    }

    // Ordenação: área (ordem fixa) → nome (alfabético)
    list.sort((a, b) => {
      const ia = AREAS_ORDER.indexOf(a.area);
      const ib = AREAS_ORDER.indexOf(b.area);
      const oa = ia === -1 ? AREAS_ORDER.length : ia;
      const ob = ib === -1 ? AREAS_ORDER.length : ib;
      if (oa !== ob) return oa - ob;
      return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    });

    return list;
  };

  // ─── Rendering ──────────────────────────────────────────

  /**
   * Cria o elemento de badge da área com a cor correspondente.
   * @param {string} area - Nome da área.
   * @returns {HTMLElement}
   */
  const createAreaBadge = (area) => {
    const config = state.areas[area] || { color: '#8a7da3' };
    const badge = document.createElement('span');
    badge.className = 'prof-area-badge';
    badge.textContent = area;
    badge.style.background = `${config.color}15`;
    badge.style.color = config.color;
    return badge;
  };

  /**
   * Cria os elementos de tags coloridas.
   * @param {Array<{texto: string, cor: string}>} tags - Tags do profissional.
   * @returns {HTMLElement}
   */
  const createTagsContainer = (tags) => {
    const container = document.createElement('div');
    container.className = 'prof-tags';

    (tags || []).forEach((tag) => {
      const el = document.createElement('span');
      el.className = 'prof-tag';
      el.textContent = tag.texto;
      el.style.background = `${tag.cor}18`;
      el.style.color = tag.cor;
      container.appendChild(el);
    });

    return container;
  };

  /**
   * Retorna a inicial do nome para placeholder de foto.
   * @param {string} nome - Nome completo.
   * @returns {string} Inicial maiúscula.
   */
  const getInitial = (nome) => (nome ? nome.charAt(0).toUpperCase() : '?');

  /**
   * Cria o card de um profissional.
   * @param {Object} prof - Dados do profissional.
   * @param {number} index - Índice para animação escalonada.
   * @returns {HTMLElement}
   */
  const createProfCard = (prof, index) => {
    const card = document.createElement('article');
    card.className = `prof-card${prof.indisponivel ? ' prof-card-unavailable' : ''}`;
    card.style.animationDelay = `${index * 0.06}s`;

    // Header (foto + info)
    const header = document.createElement('div');
    header.className = 'prof-header';

    const photoWrap = document.createElement('div');
    photoWrap.className = 'prof-photo-wrap';

    if (prof.fotoUrl) {
      const img = document.createElement('img');
      img.className = 'prof-photo';
      img.src = prof.fotoUrl;
      img.alt = `Foto de ${prof.nome}`;
      img.loading = 'lazy';
      img.onerror = () => {
        const placeholder = document.createElement('div');
        placeholder.className = 'prof-photo-placeholder';
        placeholder.textContent = getInitial(prof.nome);
        img.replaceWith(placeholder);
      };
      photoWrap.appendChild(img);

      // Long-press zoom (mobile)
      setupPhotoLongPress(photoWrap, prof.fotoUrl, prof.nome);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'prof-photo-placeholder';
      placeholder.textContent = getInitial(prof.nome);
      photoWrap.appendChild(placeholder);
    }

    const info = document.createElement('div');
    info.className = 'prof-info';

    const name = document.createElement('h3');
    name.className = 'prof-name';
    name.textContent = prof.nome;

    const badge = createAreaBadge(prof.area);

    info.appendChild(name);
    info.appendChild(badge);

    // Badge do tipo de serviço (Agendamento / Plantão / Avulso)
    const serviceType = AREA_SERVICE_TYPE[prof.area];
    if (serviceType) {
      const serviceBadge = createAreaBadge(prof.area);
      serviceBadge.textContent = serviceType;
      serviceBadge.className = 'prof-area-badge prof-service-badge';
      info.appendChild(serviceBadge);
    }

    if (prof.inscricao) {
      const inscricao = document.createElement('div');
      inscricao.className = 'prof-inscricao';
      inscricao.textContent = prof.inscricao;
      info.appendChild(inscricao);
    }

    // Badge de indisponível
    if (prof.indisponivel) {
      const unavail = document.createElement('div');
      unavail.className = 'prof-unavailable';
      unavail.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg><span>Temporariamente indisponível</span>';
      info.appendChild(unavail);
    }

    header.appendChild(photoWrap);
    header.appendChild(info);
    card.appendChild(header);

    // Tags
    if (prof.tags && prof.tags.length > 0) {
      card.appendChild(createTagsContainer(prof.tags));
    }

    // Descrição
    if (prof.descricao) {
      const descWrap = document.createElement('div');

      const desc = document.createElement('div');
      desc.className = 'prof-descricao prof-descricao-collapsed';
      desc.textContent = prof.descricao;
      descWrap.appendChild(desc);

      // Verifica se o texto é longo o suficiente para truncar
      // (será verificado após render com ResizeObserver ou requestAnimationFrame)
      const expandBtn = document.createElement('button');
      expandBtn.className = 'prof-expand-btn';
      expandBtn.textContent = 'Ver mais';
      expandBtn.style.display = 'none';

      expandBtn.addEventListener('click', () => {
        const isCollapsed = desc.classList.contains('prof-descricao-collapsed');
        desc.classList.toggle('prof-descricao-collapsed', !isCollapsed);
        expandBtn.textContent = isCollapsed ? 'Ver menos' : 'Ver mais';
      });

      descWrap.appendChild(expandBtn);
      card.appendChild(descWrap);

      // Após render, verifica se precisa do botão "Ver mais"
      requestAnimationFrame(() => {
        if (desc.scrollHeight > desc.clientHeight + 2) {
          expandBtn.style.display = '';
        }
      });
    }

    return card;
  };

  /**
   * ID do requestAnimationFrame pendente para cancelar se renderCards for chamada novamente.
   * @type {number|null}
   */
  let pendingRenderRAF = null;

  /**
   * Renderiza os cards na grid com rendering progressivo.
   * Primeiro batch (2 mobile / 4 desktop) renderizado imediatamente;
   * restante em chunks via requestAnimationFrame para não bloquear a main thread.
   */
  const renderCards = () => {
    if (!dom.grid) return;

    // Cancela chunks pendentes de render anterior (filtro/busca rápidos)
    if (pendingRenderRAF !== null) {
      cancelAnimationFrame(pendingRenderRAF);
      pendingRenderRAF = null;
    }

    const filtered = getFilteredProfissionais();

    dom.grid.innerHTML = '';

    if (dom.resultsCount) {
      dom.resultsCount.textContent = `${filtered.length} profissiona${filtered.length !== 1 ? 'is' : 'l'}`;
    }

    if (filtered.length === 0) {
      if (dom.emptyState) dom.emptyState.classList.remove('hidden');
      return;
    }

    if (dom.emptyState) dom.emptyState.classList.add('hidden');

    // ── Primeiro batch (imediato) ──
    const batchSize = getFirstBatchSize();
    const firstBatch = filtered.slice(0, batchSize);
    const rest = filtered.slice(batchSize);

    const fragment = document.createDocumentFragment();
    firstBatch.forEach((prof, i) => {
      fragment.appendChild(createProfCard(prof, i));
    });
    dom.grid.appendChild(fragment);

    // ── Restante em chunks (progressivo) ──
    if (rest.length > 0) {
      let offset = 0;
      const renderChunk = () => {
        const end = Math.min(offset + CHUNK_SIZE, rest.length);
        const chunk = document.createDocumentFragment();
        for (let i = offset; i < end; i += 1) {
          chunk.appendChild(createProfCard(rest[i], batchSize + i));
        }
        dom.grid.appendChild(chunk);
        offset = end;
        if (offset < rest.length) {
          pendingRenderRAF = requestAnimationFrame(renderChunk);
        } else {
          pendingRenderRAF = null;
        }
      };
      pendingRenderRAF = requestAnimationFrame(renderChunk);
    }
  };

  // ─── Inicialização ──────────────────────────────────────

  const showLoading = (show) => {
    if (dom.loadingState) dom.loadingState.classList.toggle('hidden', !show);
    if (dom.grid) dom.grid.classList.toggle('hidden', show);
  };

  const init = async () => {
    initTheme();

    // Event listeners
    if (dom.themeToggle) dom.themeToggle.addEventListener('click', toggleTheme);
    if (dom.searchInput) dom.searchInput.addEventListener('input', handleSearch);
    if (dom.searchClear) dom.searchClear.addEventListener('click', clearSearch);
    if (dom.filterToggle) dom.filterToggle.addEventListener('click', toggleFilterDropdown);
    if (dom.filterSelectAll) dom.filterSelectAll.addEventListener('click', selectAllFilters);
    if (dom.filterDeselectAll) dom.filterDeselectAll.addEventListener('click', deselectAllFilters);
    if (dom.infoCountBtn) dom.infoCountBtn.addEventListener('click', toggleInfoPopover);
    if (dom.legendToggleBtn) dom.legendToggleBtn.addEventListener('click', toggleLegendPopover);

    // Fechar dropdown e popover ao clicar fora
    document.addEventListener('click', (e) => {
      if (state.filterOpen && dom.filterDropdown && dom.filterToggle) {
        const isInside = dom.filterDropdown.contains(e.target) || dom.filterToggle.contains(e.target);
        if (!isInside) {
          state.filterOpen = false;
          dom.filterDropdown.classList.add('hidden');
        }
      }
      if (state.infoOpen && dom.infoCountPopover && dom.infoCountBtn) {
        const isInside = dom.infoCountPopover.contains(e.target) || dom.infoCountBtn.contains(e.target);
        if (!isInside) {
          state.infoOpen = false;
          dom.infoCountPopover.classList.add('hidden');
          dom.infoCountBtn.setAttribute('aria-expanded', 'false');
        }
      }
      if (state.legendOpen && dom.legendPopover && dom.legendToggleBtn) {
        const isInside = dom.legendPopover.contains(e.target) || dom.legendToggleBtn.contains(e.target);
        if (!isInside) {
          state.legendOpen = false;
          dom.legendPopover.classList.add('hidden');
          dom.legendToggleBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });

    // ── Áreas: inline do config.js, sem API call ──
    state.areas = AREAS;
    Object.keys(state.areas).forEach((name) => state.filters.add(name));
    buildFilterOptions();
    updateFilterBtnState();

    // ── SWR: cache hit → render imediato, revalidate em background ──
    const cached = getLocalCache();

    if (cached) {
      // Cache hit — render instantâneo, sem spinner
      state.profissionais = cached.data;
      renderCards();

      // Revalidate em background (sem retry agressivo — é best-effort)
      fetchPublicList()
        .then((res) => {
          if (!res.success || !res.data) return;
          const changed = JSON.stringify(res.data) !== JSON.stringify(state.profissionais);
          setLocalCache(res.data);
          if (changed) {
            state.profissionais = res.data;
            renderCards();
          }
        })
        .catch(() => { /* falha silenciosa — já temos dados do cache */ });
    } else {
      // Cache miss — loading clássico
      showLoading(true);

      try {
        const profResponse = await fetchPublicList();

        if (profResponse.success && profResponse.data) {
          state.profissionais = profResponse.data;
          setLocalCache(profResponse.data);
        } else {
          showToast(profResponse.message || 'Erro ao carregar profissionais.', 'error');
        }
      } catch (err) {
        console.error('[Public] Erro na inicialização:', err);
        showToast('Erro ao conectar com o servidor.', 'error');
      }

      showLoading(false);
      renderCards();
    }

    // Hint de zoom na foto (primeira visita)
    setTimeout(showPhotoHint, 1000);
  };

  // ─── Start ──────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
