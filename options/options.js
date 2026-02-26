// SpoilerWall — Options Page Script

(async function () {
  'use strict';

  // ─── DOM refs ────────────────────────────────────────────────
  const tmdbKeyInput     = document.getElementById('tmdb-key');
  const btnShowKey       = document.getElementById('btn-show-key');
  const btnSaveKey       = document.getElementById('btn-save-key');
  const btnTestKey       = document.getElementById('btn-test-key');
  const apiStatus        = document.getElementById('api-status');
  const optProtectedList = document.getElementById('opt-protected-list');
  const optProtectedCount= document.getElementById('opt-protected-count');
  const disabledSitesList= document.getElementById('disabled-sites-list');
  const btnExport        = document.getElementById('btn-export');
  const btnImportTrigger = document.getElementById('btn-import-trigger');
  const importFile       = document.getElementById('import-file');
  const btnClearSites    = document.getElementById('btn-clear-sites');
  const blurAmount       = document.getElementById('blur-amount');
  const blurVal          = document.getElementById('blur-val');
  const colorPresets     = document.querySelectorAll('.color-preset');
  const overlayLang      = document.getElementById('overlay-lang');
  const btnSaveAppearance= document.getElementById('btn-save-appearance');
  const previewText      = document.getElementById('preview-text');
  const btnClearCache    = document.getElementById('btn-clear-cache');
  const btnResetAll      = document.getElementById('btn-reset-all');
  const toast            = document.getElementById('toast');

  // Data displays
  const dataTitles  = document.getElementById('data-titles');
  const dataSites   = document.getElementById('data-sites');
  const dataBlocked = document.getElementById('data-blocked');
  const dataCache   = document.getElementById('data-cache');

  // ─── Init ────────────────────────────────────────────────────
  async function init() {
    const data = await chrome.storage.local.get(null);

    // API key
    if (data.tmdbApiKey) tmdbKeyInput.value = data.tmdbApiKey;

    // Protected titles
    renderProtectedList(data.protectedTitles || []);

    // Disabled sites
    renderDisabledSites(data.disabledSites || []);

    // Appearance
    const appearance = data.appearance || {};
    blurAmount.value = appearance.blurAmount || 16;
    blurVal.textContent = `${blurAmount.value}px`;
    updatePreviewBlur();

    const activeColor = appearance.overlayColor || 'dark';
    colorPresets.forEach(btn => btn.classList.toggle('active', btn.dataset.color === activeColor));

    if (appearance.lang) overlayLang.value = appearance.lang;

    // Stats & data summary
    renderDataSummary(data);

    // Nav smooth scroll
    setupNav();
  }

  // ─── Nav ─────────────────────────────────────────────────────
  function setupNav() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        const target = document.querySelector(link.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Highlight nav on scroll
    const sections = document.querySelectorAll('.section');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.toggle('active', l.getAttribute('href') === `#${id}`);
          });
        }
      });
    }, { threshold: 0.3 });

    sections.forEach(s => observer.observe(s));
  }

  // ─── API Key ──────────────────────────────────────────────────
  btnShowKey.addEventListener('click', () => {
    const isPassword = tmdbKeyInput.type === 'password';
    tmdbKeyInput.type = isPassword ? 'text' : 'password';
    btnShowKey.textContent = isPassword ? '🙈' : '👁';
  });

  btnSaveKey.addEventListener('click', async () => {
    const key = tmdbKeyInput.value.trim();
    if (!key) {
      showToast('Ingresá una API key válida', 'error');
      return;
    }
    await chrome.storage.local.set({ tmdbApiKey: key });
    showToast('✓ API key guardada', 'success');
    apiStatus.textContent = '';
  });

  btnTestKey.addEventListener('click', async () => {
    const key = tmdbKeyInput.value.trim();
    if (!key) { showToast('Ingresá una API key primero', 'error'); return; }

    apiStatus.className = 'api-status loading';
    apiStatus.textContent = '⏳ Probando conexión...';

    try {
      const res = await fetch(
        `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`
      );
      if (res.ok) {
        apiStatus.className = 'api-status ok';
        apiStatus.textContent = '✅ Conexión exitosa — API key válida';
        await chrome.storage.local.set({ tmdbApiKey: key });
      } else if (res.status === 401) {
        apiStatus.className = 'api-status error';
        apiStatus.textContent = '❌ API key inválida. Revisá que la copiaste correctamente.';
      } else {
        apiStatus.className = 'api-status error';
        apiStatus.textContent = `❌ Error ${res.status}. Intentá de nuevo.`;
      }
    } catch (e) {
      apiStatus.className = 'api-status error';
      apiStatus.textContent = '❌ Error de red. Verificá tu conexión.';
    }
  });

  // ─── Protected list ───────────────────────────────────────────
  function renderProtectedList(titles) {
    optProtectedCount.textContent = `${titles.length} título${titles.length !== 1 ? 's' : ''} protegido${titles.length !== 1 ? 's' : ''}`;

    if (!titles.length) {
      optProtectedList.innerHTML = '<div class="empty-opt">No hay títulos protegidos todavía. Agregá uno desde el popup.</div>';
      return;
    }

    const typeEmoji = { tv: '📺', movie: '🎬', anime: '⛩️' };
    const typeLabel = { tv: 'Serie', movie: 'Película', anime: 'Anime' };

    optProtectedList.innerHTML = titles
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .map(t => {
        const posterHTML = t.poster
          ? `<img class="opt-poster" src="${t.poster}" alt="" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
          : '';
        const phHTML = `<div class="opt-poster-ph"${t.poster ? ' style="display:none"' : ''}>${typeEmoji[t.type] || '🎬'}</div>`;
        const aliasesStr = t.aliases?.length ? t.aliases.slice(0, 5).join(', ') : '';

        return `
          <div class="opt-protected-item">
            ${posterHTML}${phHTML}
            <div class="opt-item-info">
              <div class="opt-item-title" title="${sanitizeAttr(t.title)}">${sanitizeHTML(t.title)}</div>
              <div class="opt-item-meta">
                ${t.year ? t.year + ' · ' : ''}${typeLabel[t.type] || t.type}
                ${t.source === 'jikan' ? ' · Jikan' : '· TMDB'}
              </div>
              ${aliasesStr ? `<div class="opt-item-aliases" title="${sanitizeAttr(aliasesStr)}">Alias: ${sanitizeHTML(aliasesStr)}</div>` : ''}
            </div>
            <button class="opt-remove-btn" data-id="${sanitizeAttr(t.id)}" data-source="${sanitizeAttr(t.source)}" title="Eliminar">✕</button>
          </div>`;
      }).join('');

    optProtectedList.querySelectorAll('.opt-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { id, source } = btn.dataset;
        const { protectedTitles = [] } = await chrome.storage.local.get('protectedTitles');
        const updated = protectedTitles.filter(t => !(t.id === id && t.source === source));
        await chrome.storage.local.set({ protectedTitles: updated });
        renderProtectedList(updated);
        renderDataSummary({ protectedTitles: updated });
        showToast('Título eliminado', 'success');
      });
    });
  }

  // ─── Export / Import ──────────────────────────────────────────
  btnExport.addEventListener('click', async () => {
    const { protectedTitles = [] } = await chrome.storage.local.get('protectedTitles');
    const blob = new Blob(
      [JSON.stringify({ version: '1.0', protectedTitles }, null, 2)],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spoilerwall-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✓ Exportación exitosa', 'success');
  });

  btnImportTrigger.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = parsed.protectedTitles || (Array.isArray(parsed) ? parsed : []);
      if (!incoming.length) { showToast('Archivo inválido o vacío', 'error'); return; }

      const { protectedTitles = [] } = await chrome.storage.local.get('protectedTitles');
      const existingIds = new Set(protectedTitles.map(t => t.id + t.source));
      const merged = [...protectedTitles, ...incoming.filter(t => !existingIds.has(t.id + t.source))];
      await chrome.storage.local.set({ protectedTitles: merged });
      renderProtectedList(merged);
      showToast(`✓ ${incoming.length} título${incoming.length !== 1 ? 's' : ''} importado${incoming.length !== 1 ? 's' : ''}`, 'success');
    } catch (_) {
      showToast('Error al leer el archivo', 'error');
    }
    importFile.value = '';
  });

  // ─── Disabled sites ───────────────────────────────────────────
  function renderDisabledSites(sites) {
    if (!sites.length) {
      disabledSitesList.innerHTML = '<div class="empty-opt">Ningún sitio desactivado.</div>';
      return;
    }

    disabledSitesList.innerHTML = sites.map(site => `
      <div class="disabled-site-item">
        <span>🚫 ${sanitizeHTML(site)}</span>
        <button data-site="${sanitizeAttr(site)}" title="Reactivar en este sitio">✕</button>
      </div>`).join('');

    disabledSitesList.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', async () => {
        const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
        const updated = disabledSites.filter(s => s !== btn.dataset.site);
        await chrome.storage.local.set({ disabledSites: updated });
        renderDisabledSites(updated);
        showToast('Sitio reactivado', 'success');
      });
    });
  }

  btnClearSites.addEventListener('click', async () => {
    await chrome.storage.local.set({ disabledSites: [] });
    renderDisabledSites([]);
    showToast('Lista de sitios desactivados limpiada', 'success');
  });

  // ─── Appearance ───────────────────────────────────────────────
  blurAmount.addEventListener('input', () => {
    blurVal.textContent = `${blurAmount.value}px`;
    updatePreviewBlur();
  });

  colorPresets.forEach(btn => {
    btn.addEventListener('click', () => {
      colorPresets.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updatePreviewColor(btn.dataset.color);
    });
  });

  function updatePreviewBlur() {
    if (previewText) previewText.style.filter = `blur(${blurAmount.value}px)`;
  }

  function updatePreviewColor(color) {
    const colorMap = {
      dark:   'rgba(8, 5, 25, 0.82)',
      purple: 'rgba(30, 10, 80, 0.85)',
      blue:   'rgba(5, 20, 60, 0.85)',
      black:  'rgba(0, 0, 0, 0.9)',
    };
    const overlay = document.getElementById('preview-overlay');
    if (overlay) overlay.style.background = colorMap[color] || colorMap.dark;
  }

  overlayLang.addEventListener('change', () => {
    const desc = document.getElementById('preview-desc');
    if (desc) {
      desc.textContent = overlayLang.value === 'en'
        ? 'Possible spoiler about: Game of Thrones'
        : 'Posible spoiler sobre: Game of Thrones';
    }
  });

  btnSaveAppearance.addEventListener('click', async () => {
    const activeColor = document.querySelector('.color-preset.active')?.dataset.color || 'dark';
    const appearance = {
      blurAmount: parseInt(blurAmount.value, 10),
      overlayColor: activeColor,
      lang: overlayLang.value
    };
    await chrome.storage.local.set({ appearance });
    showToast('✓ Apariencia guardada', 'success');
  });

  // ─── Data summary & cache ─────────────────────────────────────
  async function renderDataSummary(data = null) {
    if (!data) data = await chrome.storage.local.get(null);
    const titles = (data.protectedTitles || []).length;
    const sites  = (data.disabledSites || []).length;
    const blocked= data.stats?.total || 0;

    if (dataTitles)  dataTitles.textContent  = titles;
    if (dataSites)   dataSites.textContent   = sites;
    if (dataBlocked) dataBlocked.textContent = blocked.toLocaleString();

    // Count cache entries
    const cacheCount = Object.keys(data).filter(k => k.startsWith('_c_')).length;
    if (dataCache) dataCache.textContent = `${cacheCount} entrada${cacheCount !== 1 ? 's' : ''}`;
  }

  btnClearCache.addEventListener('click', async () => {
    const all = await chrome.storage.local.get(null);
    const cacheKeys = Object.keys(all).filter(k => k.startsWith('_c_'));
    if (!cacheKeys.length) { showToast('No hay caché que limpiar', ''); return; }
    await chrome.storage.local.remove(cacheKeys);
    await renderDataSummary();
    showToast(`✓ ${cacheKeys.length} entrada${cacheKeys.length !== 1 ? 's' : ''} eliminada${cacheKeys.length !== 1 ? 's' : ''}`, 'success');
  });

  btnResetAll.addEventListener('click', async () => {
    const confirmed = confirm(
      '⚠️ ¿Estás seguro? Esto eliminará TODOS tus datos de SpoilerWall:\n' +
      '• Títulos protegidos\n• Configuración\n• API keys\n• Estadísticas\n\n' +
      'Esta acción no se puede deshacer.'
    );
    if (!confirmed) return;
    await chrome.storage.local.clear();
    showToast('Todos los datos eliminados', 'success');
    setTimeout(() => location.reload(), 1200);
  });

  // ─── Toast ────────────────────────────────────────────────────
  let toastTimer = null;

  function showToast(message, type = '') {
    toast.textContent = message;
    toast.className = `toast${type ? ` ${type}` : ''} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
  }

  // ─── Helpers ─────────────────────────────────────────────────
  function sanitizeHTML(str) {
    return String(str).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  }

  function sanitizeAttr(str) {
    return String(str).replace(/['"<>&]/g, c => ({ "'": '&#39;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  }

  // ─── Start ────────────────────────────────────────────────────
  init();
})();
