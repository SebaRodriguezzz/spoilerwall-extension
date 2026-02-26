// SpoilerWall — Popup Script

(async function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────
  let currentTab   = 'tv';
  let hostname     = '';
  let searchTimer  = null;
  let lastQuery    = '';

  // ─── DOM refs ────────────────────────────────────────────────
  const toggleGlobal   = document.getElementById('toggle-global');
  const toggleSite     = document.getElementById('toggle-site');
  const siteRow        = document.getElementById('site-row');
  const siteHostname   = document.getElementById('site-hostname');
  const searchInput    = document.getElementById('search-input');
  const searchBtn      = document.getElementById('search-btn');
  const searchResults  = document.getElementById('search-results');
  const noKeyWarning   = document.getElementById('no-key-warning');
  const protectedList  = document.getElementById('protected-list');
  const emptyState     = document.getElementById('empty-state');
  const protectedCount = document.getElementById('protected-count');
  const badgeCount     = document.getElementById('badge-count');
  const statToday      = document.getElementById('stat-today');
  const statTotal      = document.getElementById('stat-total');
  const btnOptions     = document.getElementById('btn-options');
  const linkOptionsKey = document.getElementById('link-options-key');
  const ctaLink        = document.getElementById('cta-link');

  // ─── Init ────────────────────────────────────────────────────
  async function init() {
    hostname = await getCurrentHostname();
    siteHostname.textContent = hostname || 'sitio actual';

    const data = await chrome.storage.local.get([
      'globalEnabled', 'disabledSites', 'protectedTitles', 'tmdbApiKey', 'stats'
    ]);

    const globalEnabled = data.globalEnabled !== false;
    const disabledSites = data.disabledSites || [];
    const siteEnabled   = !disabledSites.includes(hostname);

    toggleGlobal.checked = globalEnabled;
    toggleSite.checked   = siteEnabled;

    syncToggleStates(globalEnabled);
    renderProtectedList(data.protectedTitles || []);
    renderStats(data.stats);
    // Option 3: warn only if user has no custom key AND there's no built-in key
    // The background knows BUILT_IN_KEY; we signal "needs key" via a search attempt
    checkApiKey(true); // assume ok; actual key check happens on search
    renderBadge();
  }

  async function getCurrentHostname() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return '';
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => location.hostname.replace(/^www\./, '')
      });
      return result || '';
    } catch (_) {
      return '';
    }
  }

  // ─── API key check ────────────────────────────────────────────
  function checkApiKey(hasKey) {
    noKeyWarning.style.display = hasKey ? 'none' : 'block';
  }

  // ─── Toggle handlers ──────────────────────────────────────────
  toggleGlobal.addEventListener('change', async () => {
    const enabled = toggleGlobal.checked;
    await chrome.storage.local.set({ globalEnabled: enabled });
    syncToggleStates(enabled);
  });

  toggleSite.addEventListener('change', async () => {
    const data = await chrome.storage.local.get('disabledSites');
    let disabledSites = data.disabledSites || [];
    if (!toggleSite.checked) {
      if (!disabledSites.includes(hostname)) disabledSites.push(hostname);
    } else {
      disabledSites = disabledSites.filter(s => s !== hostname);
    }
    await chrome.storage.local.set({ disabledSites });
  });

  function syncToggleStates(globalEnabled) {
    siteRow.classList.toggle('dimmed', !globalEnabled);
    toggleSite.disabled = !globalEnabled;
  }

  // ─── Tab bar ──────────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      searchResults.innerHTML = '';
      searchInput.value = '';
      lastQuery = '';
      searchInput.focus();
    });
  });

  // ─── Search ───────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q || q.length < 2) { searchResults.innerHTML = ''; return; }
    searchTimer = setTimeout(() => doSearch(q), 380);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length >= 2) doSearch(q);
    }
  });

  searchBtn.addEventListener('click', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q.length >= 2) doSearch(q);
  });

  async function doSearch(query) {
    if (query === lastQuery) return;
    lastQuery = query;
    searchBtn.disabled = true;

    showLoading();

    let response;
    if (currentTab === 'anime') {
      response = await chrome.runtime.sendMessage({ type: 'SEARCH_ANIME', query });
    } else {
      // Option 3: background uses built-in key or user's custom key automatically
      const mediaType = currentTab === 'movie' ? 'movie' : 'tv';
      response = await chrome.runtime.sendMessage({ type: 'SEARCH_TMDB', query, mediaType });
    }

    searchBtn.disabled = false;
    renderResults(response);
  }

  function showLoading() {
    searchResults.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <div>Buscando...</div>
      </div>`;
  }

  function renderResults({ results = [], error } = {}) {
    if (error === 'RATE_LIMIT') {
      searchResults.innerHTML = '<div class="empty-results">⏳ Demasiadas solicitudes. Esperá un momento e intentá de nuevo.</div>';
      return;
    }
    if (error === 'NO_API_KEY') {
      searchResults.innerHTML = '<div class="empty-results">⚠️ Configurá tu API key de TMDB en ajustes para buscar películas y series.</div>';
      noKeyWarning.style.display = 'block';
      return;
    }
    if (error === 'INVALID_API_KEY') {
      searchResults.innerHTML = '<div class="empty-results">❌ API key inválida. Revisala en ajustes.</div>';
      return;
    }
    if (!results.length) {
      searchResults.innerHTML = '<div class="empty-results">Sin resultados. Probá con otro nombre.</div>';
      return;
    }

    const data = chrome.storage.local.get('protectedTitles');
    chrome.storage.local.get('protectedTitles', ({ protectedTitles: existing = [] }) => {
      const existingIds = new Set(existing.map(e => e.id + '_' + e.source));

      searchResults.innerHTML = results.map(item => {
        const isAdded = existingIds.has(item.id + '_' + item.source);
        return buildResultHTML(item, isAdded);
      }).join('');

      searchResults.querySelectorAll('[data-add]').forEach(btn => {
        if (btn.dataset.added === 'true') return;
        btn.addEventListener('click', async () => {
          const item = JSON.parse(btn.dataset.add);
          await addTitle(item);
          btn.textContent = '✓ Agregado';
          btn.classList.add('done');
          btn.dataset.added = 'true';
        });
      });
    });
  }

  function buildResultHTML(item, isAdded) {
    const typeMap = { tv: 'Serie', movie: 'Película', anime: 'Anime' };
    const badgeClass = { tv: 'badge-tv', movie: 'badge-movie', anime: 'badge-anime' };
    const typeEmoji = { tv: '📺', movie: '🎬', anime: '⛩️' };
    const type = item.type || currentTab;

    const posterHTML = item.poster
      ? `<img class="result-poster" src="${item.poster}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      : '';
    const phHTML = `<div class="result-poster-placeholder"${item.poster ? ' style="display:none"' : ''}>${typeEmoji[type] || '🎬'}</div>`;

    const rating = item.rating ? `⭐ ${item.rating}` : '';
    const year = item.year ? item.year : '';

    return `
      <div class="result-item${isAdded ? ' added' : ''}">
        ${posterHTML}${phHTML}
        <div class="result-info">
          <div class="result-title" title="${sanitizeAttr(item.title)}">${sanitizeHTML(item.title)}</div>
          <div class="result-meta">
            <span class="result-type-badge ${badgeClass[type] || 'badge-tv'}">${typeMap[type] || type}</span>
            ${year ? `<span>${year}</span>` : ''}
            ${rating ? `<span>${rating}</span>` : ''}
          </div>
        </div>
        <button class="result-add-btn${isAdded ? ' done' : ''}"
          data-add='${JSON.stringify(item).replace(/'/g, '&#39;')}'
          data-added="${isAdded}"
        >${isAdded ? '✓ Agregado' : '+ Agregar'}</button>
      </div>`;
  }

  // ─── Add title to protected list ─────────────────────────────
  async function addTitle(item) {
    // Fetch aliases from background
    const titleId = item.source === 'tmdb'
      ? `${item.type}_${item.id}`
      : String(item.id);

    const { aliases = [] } = await chrome.runtime.sendMessage({
      type: 'GET_ALIASES',
      titleId,
      source: item.source,
      title: item.title
    });

    const entry = {
      id: String(item.id),
      title: item.title,
      originalTitle: item.originalTitle || null,
      type: item.type,
      year: item.year || null,
      poster: item.poster || null,
      source: item.source,
      aliases,
      addedAt: Date.now()
    };

    const { protectedTitles = [] } = await chrome.storage.local.get('protectedTitles');

    // Avoid duplicates
    const exists = protectedTitles.some(t => t.id === entry.id && t.source === entry.source);
    if (exists) return;

    protectedTitles.push(entry);
    await chrome.storage.local.set({ protectedTitles });
    renderProtectedList(protectedTitles);
  }

  // ─── Render protected list ────────────────────────────────────
  function renderProtectedList(titles) {
    protectedCount.textContent = titles.length;

    if (!titles.length) {
      protectedList.innerHTML = '';
      protectedList.appendChild(emptyState);
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    protectedList.innerHTML = titles
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .map(t => {
        const typeEmoji = { tv: '📺', movie: '🎬', anime: '⛩️' };
        const posterHTML = t.poster
          ? `<img class="protected-item-poster" src="${t.poster}" alt="" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
          : '';
        const phHTML = `<div class="protected-item-poster-ph"${t.poster ? ' style="display:none"' : ''}>${typeEmoji[t.type] || '🎬'}</div>`;

        return `
          <div class="protected-item">
            ${posterHTML}${phHTML}
            <div class="protected-item-info">
              <div class="protected-item-title" title="${sanitizeAttr(t.title)}">${sanitizeHTML(t.title)}</div>
              <div class="protected-item-meta">${t.year || ''} ${t.year ? '·' : ''} ${typeLabel(t.type)}</div>
            </div>
            <button class="protected-item-remove"
              data-id="${sanitizeAttr(t.id)}"
              data-source="${sanitizeAttr(t.source)}"
              title="Quitar protección"
            >✕</button>
          </div>`;
      }).join('');

    protectedList.querySelectorAll('.protected-item-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { id, source } = btn.dataset;
        await removeTitle(id, source);
      });
    });
  }

  async function removeTitle(id, source) {
    const { protectedTitles = [] } = await chrome.storage.local.get('protectedTitles');
    const updated = protectedTitles.filter(t => !(t.id === id && t.source === source));
    await chrome.storage.local.set({ protectedTitles: updated });
    renderProtectedList(updated);
    // Refresh result buttons if visible
    refreshResultButtons(id, source);
  }

  function refreshResultButtons(id, source) {
    const btn = searchResults.querySelector(`[data-added="true"]`);
    if (!btn) return;
    try {
      const item = JSON.parse(btn.dataset.add.replace(/&#39;/g, "'"));
      if (String(item.id) === id && item.source === source) {
        btn.textContent = '+ Agregar';
        btn.classList.remove('done');
        btn.dataset.added = 'false';
      }
    } catch (_) {}
  }

  // ─── Stats ────────────────────────────────────────────────────
  function renderStats(stats = {}) {
    const today = new Date().toISOString().slice(0, 10);
    statToday.textContent = (stats?.daily?.[today] || 0).toLocaleString();
    statTotal.textContent = (stats?.total || 0).toLocaleString();
  }

  function renderBadge() {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      // Badge is already set by background; we just reflect it
      chrome.action.getBadgeText({ tabId }, text => {
        if (text && text !== '0') {
          badgeCount.textContent = text;
          badgeCount.classList.add('visible');
        }
      });
    });
  }

  // ─── Navigation ───────────────────────────────────────────────
  btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  if (linkOptionsKey) {
    linkOptionsKey.addEventListener('click', e => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  ctaLink.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://spoilerwall.onrender.com/' });
  });

  // ─── Helpers ─────────────────────────────────────────────────
  function sanitizeHTML(str) {
    return String(str).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  function sanitizeAttr(str) {
    return String(str).replace(/['"<>&]/g, c => ({ "'": '&#39;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  }

  function typeLabel(type) {
    return { tv: 'Serie', movie: 'Película', anime: 'Anime' }[type] || type;
  }

  // ─── Start ────────────────────────────────────────────────────
  init();
})();
