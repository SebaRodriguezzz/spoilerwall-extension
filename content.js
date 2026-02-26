// SpoilerWall — Content Script
// Scans web pages for spoiler mentions and applies blur protection

(function () {
  'use strict';

  if (window.__SW_LOADED) return;
  window.__SW_LOADED = true;

  // ─── State ────────────────────────────────────────────────────────────────
  let globalEnabled = true;
  let siteEnabled = true;
  let protectedTitles = [];
  let patterns = []; // { titleName, regexCI, regexCS, titleData }
  let blockedCount = 0;
  let scanPending = false;

  const BLURRED = 'data-sw-blurred';
  const HOSTNAME = location.hostname.replace(/^www\./, '');

  // ─── Init ─────────────────────────────────────────────────────────────────
  async function init() {
    try {
      await loadSettings();
      if (isActive()) {
        buildPatterns();
        await scanPage();
        observeMutations();
      }
    } catch (e) {
      // Silent fail — extension shouldn't break pages
    }
  }

  function isActive() {
    return globalEnabled && siteEnabled;
  }

  async function loadSettings() {
    const data = await chrome.storage.local.get([
      'globalEnabled', 'disabledSites', 'protectedTitles'
    ]);
    globalEnabled = data.globalEnabled !== false;
    siteEnabled = !(data.disabledSites || []).includes(HOSTNAME);
    protectedTitles = data.protectedTitles || [];
  }

  // ─── Build Regex Patterns ─────────────────────────────────────────────────
  function buildPatterns() {
    patterns = [];

    for (const entry of protectedTitles) {
      const allTerms = new Set();

      // Main title variations
      const mainTitle = entry.title || '';
      if (mainTitle) allTerms.add(mainTitle);
      if (entry.originalTitle) allTerms.add(entry.originalTitle);

      // User-confirmed aliases
      for (const alias of entry.aliases || []) {
        if (alias && alias.trim()) allTerms.add(alias.trim());
      }

      // Separate: full phrases (case-insensitive) vs abbreviations (case-sensitive)
      const fullPhrases = [];
      const abbreviations = [];

      for (const term of allTerms) {
        if (!term || term.length < 2) continue;
        // Abbreviation: all uppercase, 2–6 chars, no spaces
        if (/^[A-Z0-9:×x&]{2,6}$/.test(term) && !term.includes(' ')) {
          abbreviations.push(escRx(term));
        } else {
          fullPhrases.push(escRx(term));
        }
      }

      if (fullPhrases.length === 0 && abbreviations.length === 0) continue;

      // Sort longest first to avoid partial matches
      fullPhrases.sort((a, b) => b.length - a.length);
      abbreviations.sort((a, b) => b.length - a.length);

      patterns.push({
        titleName: mainTitle,
        titleData: entry,
        regexCI: fullPhrases.length
          ? new RegExp(`\\b(${fullPhrases.join('|')})\\b`, 'i')
          : null,
        regexCS: abbreviations.length
          ? new RegExp(`\\b(${abbreviations.join('|')})\\b`)
          : null
      });
    }
  }

  function escRx(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── Page Scan ────────────────────────────────────────────────────────────
  async function scanPage() {
    if (patterns.length === 0) return;
    scanSubtree(document.body);
    reportBadge();
  }

  function scanSubtree(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const el = node.parentElement;
          if (!el) return NodeFilter.FILTER_REJECT;

          const tag = el.tagName.toLowerCase();
          const skipTags = new Set(['script','style','noscript','code','pre','kbd',
                                    'textarea','input','select','button','label',
                                    'meta','link','svg','math']);
          if (skipTags.has(tag)) return NodeFilter.FILTER_REJECT;

          // Skip already blurred subtrees
          if (el.closest(`[${BLURRED}]`)) return NodeFilter.FILTER_REJECT;

          // Skip our own UI and user-revealed content
          if (el.closest('.sw-overlay, .sw-reveal-btn, .sw-revealed')) return NodeFilter.FILTER_REJECT;

          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const toBlur = new Map(); // container → titleName

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      for (const { titleName, regexCI, regexCS } of patterns) {
        const matched = (regexCI && regexCI.test(text)) || (regexCS && regexCS.test(text));
        if (matched) {
          const container = findContainer(node.parentElement);
          if (container && !container.hasAttribute(BLURRED) && !toBlur.has(container)) {
            toBlur.set(container, titleName);
          }
          break;
        }
      }
    }

    for (const [container, titleName] of toBlur) {
      applyBlur(container, titleName);
    }

    // Also scan image alt text and aria-labels for more coverage
    scanAttributes(root);
  }

  // ─── Scan attributes (alt, aria-label, title) for title mentions ─────────
  function scanAttributes(root) {
    const candidates = root.querySelectorAll('[alt], [aria-label], [title]');
    for (const el of candidates) {
      if (!el.isConnected) continue;
      if (el.closest(`[${BLURRED}]`) || el.closest('.sw-overlay, .sw-revealed')) continue;

      const text = [
        el.getAttribute('alt') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || ''
      ].join(' ');

      if (!text.trim()) continue;

      for (const { titleName, regexCI, regexCS } of patterns) {
        if ((regexCI && regexCI.test(text)) || (regexCS && regexCS.test(text))) {
          const container = findContainer(el);
          if (container && !container.hasAttribute(BLURRED)) {
            applyBlur(container, titleName);
          }
          break;
        }
      }
    }
  }

  // ─── Find best container to blur ─────────────────────────────────────────
  function findContainer(element) {
    if (!element) return null;

    const PREFERRED = [
      '[data-testid="tweet"]',            // Twitter/X — full card with images
      '[data-testid="post-container"]',   // Reddit
      'shreddit-post',                    // Reddit new
      '.thing',                           // Reddit old
      'ytd-comment-renderer',             // YouTube comments
      'ytd-video-primary-info-renderer',  // YouTube video info
      'ytd-rich-item-renderer',           // YouTube feed cards
      '[data-ad-preview="message"]',
      '[data-testid="post_message"]',
      '[role="listitem"]',
      'article',
      '[role="article"]',
      '.entry',
      '.feed-item',
      '.post-card',
      '.status',
    ];

    let el = element;
    while (el && el !== document.body) {
      for (const sel of PREFERRED) {
        try { if (el.matches(sel)) return el; } catch (_) {}
      }
      el = el.parentElement;
    }

    // Fallback: walk up looking for a block container that includes images
    // or is large enough to be a full card. A plain <p> is not enough —
    // keep going until we find something that wraps the whole post/card.
    el = element;
    let candidate = null;
    while (el && el !== document.body) {
      const tag = el.tagName.toLowerCase();
      if (['div', 'li', 'section', 'figure', 'blockquote', 'td'].includes(tag)) {
        const rect = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        const isBlock = ['block', 'flex', 'grid', 'list-item'].includes(cs.display);
        if (isBlock && rect.height > 10) {
          candidate = el;
          // Prefer containers with images (full card) or tall/wide enough
          if (el.querySelector('img') || (rect.height > 80 && rect.width > 250)) {
            return el;
          }
        }
      }
      el = el.parentElement;
    }

    return candidate || element.parentElement || element;
  }

  // ─── Apply Blur ───────────────────────────────────────────────────────────
  function applyBlur(container, titleName) {
    if (container.hasAttribute(BLURRED)) return;
    container.setAttribute(BLURRED, 'true');
    container.classList.add('sw-blurred');

    const pos = window.getComputedStyle(container).position;
    if (pos === 'static') container.style.position = 'relative';

    // Overlay covers the container without touching its children.
    // Moving children would trigger React/framework re-renders which
    // immediately restore the DOM and wipe the overlay.
    const overlay = document.createElement('div');
    overlay.className = 'sw-overlay';
    overlay.setAttribute('role', 'button');
    overlay.setAttribute('tabindex', '0');
    overlay.setAttribute('aria-label', `SpoilerWall: click to reveal spoiler about ${titleName}`);

    overlay.innerHTML = `
      <div class="sw-overlay-inner">
        <svg class="sw-shield-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>
          <path d="M12 8v4"/>
          <path d="M12 16h.01"/>
        </svg>
        <div class="sw-overlay-text">
          <strong class="sw-brand">SpoilerWall</strong>
          <span class="sw-desc">Posible spoiler sobre: <em>${sanitize(titleName)}</em></span>
        </div>
        <button class="sw-reveal-btn" type="button">Revelar</button>
      </div>`;

    container.appendChild(overlay);
    blockedCount++;

    overlay.addEventListener('click', () => reveal(container, overlay));
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') reveal(container, overlay);
    });
  }

  function reveal(container, overlay) {
    container.classList.remove('sw-blurred');
    container.classList.add('sw-revealed');
    overlay.classList.add('sw-fade-out');
    setTimeout(() => {
      overlay.remove();
      container.removeAttribute(BLURRED);
      container.style.position = '';
    }, 280);
  }

  function sanitize(str) {
    return str.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  }

  // ─── Badge ────────────────────────────────────────────────────────────────
  function reportBadge() {
    try {
      chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count: blockedCount });
      if (blockedCount > 0) {
        chrome.runtime.sendMessage({ type: 'RECORD_BLOCKED', count: blockedCount });
      }
    } catch (_) {}
  }

  // ─── Remove all blurs (used when extension is disabled) ──────────────────
  function removeAllBlurs() {
    document.querySelectorAll(`[${BLURRED}]`).forEach(el => {
      el.removeAttribute(BLURRED);
      el.classList.remove('sw-blurred', 'sw-revealed');
      el.style.position = '';
      el.querySelectorAll('.sw-overlay').forEach(o => o.remove());
    });
    blockedCount = 0;
    reportBadge();
  }

  // ─── Mutation Observer (dynamic content) ─────────────────────────────────
  function observeMutations() {
    const observer = new MutationObserver((mutations) => {
      if (!isActive() || patterns.length === 0) return;
      if (scanPending) return;
      scanPending = true;

      // Use microtask delay to batch DOM mutations
      setTimeout(() => {
        scanPending = false;
        for (const mutation of mutations) {
          for (const addedNode of mutation.addedNodes) {
            if (addedNode.nodeType === Node.ELEMENT_NODE) {
              scanSubtree(addedNode);
            }
          }
        }
        reportBadge();
      }, 250);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Listen for storage changes ───────────────────────────────────────────
  chrome.storage.onChanged.addListener(async (changes) => {
    const relevant = ['globalEnabled', 'disabledSites', 'protectedTitles'];
    if (!relevant.some(k => k in changes)) return;

    await loadSettings();
    removeAllBlurs();

    if (isActive()) {
      buildPatterns();
      await scanPage();
      observeMutations();
    }
  });

  // ─── Start ────────────────────────────────────────────────────────────────
  init();
})();
