// SpoilerWall - Background Service Worker (MV3)
// Handles API calls to TMDB and Jikan, caching, and badge updates

// ─── Option 3: Embedded key as default — user can override in Settings ────────
// Fill in your TMDB API key here. Users who set their own key in Settings will
// use theirs instead (useful to avoid shared rate limits).
const BUILT_IN_KEY = ''; // <-- paste your TMDB API key here

const TMDB_BASE = 'https://api.themoviedb.org/3';
const JIKAN_BASE = 'https://api.jikan.moe/v4';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const POPULAR_CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

// ─── Known abbreviations / aliases database ───────────────────────────────────
const KNOWN_ALIASES = {
  // ── TV Shows ──
  'Game of Thrones':                   ['GOT', 'GoT'],
  'Breaking Bad':                      ['BB', 'BrBa'],
  'The Walking Dead':                  ['TWD'],
  'Stranger Things':                   ['ST'],
  'The Last of Us':                    ['TLOU'],
  'House of the Dragon':               ['HOTD', 'HotD'],
  'The Boys':                          ['TBoys'],
  'Squid Game':                        ['SG'],
  'Money Heist':                       ['LCDP', 'La Casa de Papel', 'Casa de Papel'],
  'Better Call Saul':                  ['BCS'],
  'Succession':                        ['Succession'],
  'Euphoria':                          ['Euphoria'],
  'The Mandalorian':                   ['Mando'],
  'Peaky Blinders':                    ['PB'],
  'The Witcher':                       ['Witcher'],
  'The Rings of Power':                ['ROP'],
  'Avatar: The Last Airbender':        ['ATLA', 'TLA', 'Avatar TLA'],
  'The Crown':                         ['The Crown'],
  'Bridgerton':                        ['Bridgerton'],
  'Severance':                         ['Severance'],
  'Arcane':                            ['Arcane'],
  'Ozark':                             ['Ozark'],
  'The Bear':                          ['The Bear'],
  'Ted Lasso':                         ['TL'],
  'Black Mirror':                      ['BM'],
  'Yellowstone':                       ['YS'],
  'WandaVision':                       ['WV'],
  'Loki':                              ['Loki'],
  'Andor':                             ['Andor'],
  'House':                             ['House MD', 'House M.D.'],
  'Friends':                           ['Friends'],
  'The Office':                        ['Office US'],
  'Parks and Recreation':              ['Parks and Rec', 'P&R'],
  'Emily in Paris':                    ['EIP'],
  'Wednesday':                         ['Wednesday'],
  'The White Lotus':                   ['TWL', 'White Lotus'],
  'Beef':                              ['Beef'],
  'Only Murders in the Building':      ['OMITB'],
  'Yellowjackets':                     ['YJ'],
  'Abbott Elementary':                 ['Abbott'],
  // ── Anime ──
  'Attack on Titan':                   ['AOT', 'AoT', 'Shingeki no Kyojin', 'SnK'],
  'Demon Slayer':                      ['KnY', 'Kimetsu no Yaiba'],
  'One Piece':                         ['OP'],
  'Naruto':                            ['Naruto'],
  'Naruto Shippuden':                  ['NS', 'Shippuden'],
  'Dragon Ball Z':                     ['DBZ'],
  'Dragon Ball Super':                 ['DBS'],
  'My Hero Academia':                  ['MHA', 'BNHA', 'Boku no Hero'],
  'Fullmetal Alchemist: Brotherhood':  ['FMAB', 'FMA:B', 'FMA Brotherhood'],
  'Death Note':                        ['DN'],
  'Bleach':                            ['Bleach'],
  'Chainsaw Man':                      ['CSM'],
  'Jujutsu Kaisen':                    ['JJK'],
  'Mob Psycho 100':                    ['MP100', 'Mob Psycho'],
  'Hunter x Hunter':                   ['HxH', 'Hunter × Hunter'],
  'Vinland Saga':                      ['VS'],
  'Spy x Family':                      ['SpyxFamily', 'Spy × Family'],
  'Cyberpunk: Edgerunners':            ['Edgerunners'],
  "Frieren: Beyond Journey's End":     ['Frieren', 'Sousou no Frieren'],
  'Oshi no Ko':                        ['ONK'],
  'Blue Lock':                         ['BL', 'Blue Lock'],
  'Tokyo Revengers':                   ['TR', 'TokyoRev'],
  // ── Movies ──
  'Avengers: Endgame':                 ['Endgame', 'Avengers Endgame'],
  'Avengers: Infinity War':            ['IW', 'Infinity War'],
  'Spider-Man: No Way Home':           ['NWH', 'No Way Home'],
  'The Dark Knight':                   ['TDK', 'Dark Knight'],
  'Oppenheimer':                       ['Oppy'],
  'Dune':                              ['Dune'],
  'Dune: Part Two':                    ['Dune 2', 'Dune Part Two'],
  'Top Gun: Maverick':                 ['Maverick', 'Top Gun 2'],
};

// ─── Message Router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'SEARCH_TMDB':
      searchTMDB(msg.query, msg.mediaType).then(sendResponse);
      return true;
    case 'SEARCH_ANIME':
      searchAnime(msg.query).then(sendResponse);
      return true;
    case 'GET_POPULAR_TMDB':
      getPopularTMDB(msg.mediaType).then(sendResponse);
      return true;
    case 'GET_ALIASES':
      fetchAliases(msg.titleId, msg.source, msg.title).then(sendResponse);
      return true;
    case 'GET_KNOWN_ALIASES':
      sendResponse({ aliases: KNOWN_ALIASES });
      break;
    case 'UPDATE_BADGE':
      setBadge(sender.tab?.id, msg.count);
      break;
    case 'RECORD_BLOCKED':
      recordBlockedStat(msg.count);
      break;
  }
});

// ─── TMDB Search ──────────────────────────────────────────────────────────────
async function searchTMDB(query, mediaType = 'multi') {
  try {
    const stored = await chrome.storage.local.get('tmdbApiKey');
    const tmdbApiKey = stored.tmdbApiKey || BUILT_IN_KEY;
    if (!tmdbApiKey) return { error: 'NO_API_KEY', results: [] };

    const cacheKey = `tmdb_search_${mediaType}_${query.toLowerCase().trim()}`;
    const cached = await getCache(cacheKey);
    if (cached) return { results: cached };

    const url = `${TMDB_BASE}/search/${mediaType}?query=${encodeURIComponent(query)}&api_key=${tmdbApiKey}&language=en-US&page=1`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 401) return { error: 'INVALID_API_KEY', results: [] };
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    const results = (data.results || [])
      .filter(item => item.poster_path)
      .slice(0, 10)
      .map(item => ({
        id: item.id,
        title: item.title || item.name,
        originalTitle: item.original_title || item.original_name,
        type: item.media_type || mediaType,
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
        poster: `https://image.tmdb.org/t/p/w92${item.poster_path}`,
        overview: (item.overview || '').slice(0, 150),
        source: 'tmdb',
        rating: item.vote_average ? item.vote_average.toFixed(1) : null
      }));

    await setCache(cacheKey, results);
    return { results };
  } catch (err) {
    console.error('[SW] TMDB search error:', err);
    return { error: err.message, results: [] };
  }
}

// ─── Jikan (Anime) Search ─────────────────────────────────────────────────────
async function searchAnime(query) {
  try {
    const cacheKey = `jikan_search_${query.toLowerCase().trim()}`;
    const cached = await getCache(cacheKey);
    if (cached) return { results: cached };

    const url = `${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=10&order_by=score&sort=desc&sfw=true`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 429) return { error: 'RATE_LIMIT', results: [] };
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();

    const results = (data.data || []).slice(0, 10).map(item => ({
      id: item.mal_id,
      title: item.title,
      originalTitle: item.title_japanese,
      englishTitle: item.title_english,
      type: 'anime',
      year: item.year || (item.aired?.from ? new Date(item.aired.from).getFullYear() : null),
      poster: item.images?.jpg?.image_url || null,
      overview: (item.synopsis || '').replace(/\[Written.*?\]/g, '').slice(0, 150),
      synonyms: item.title_synonyms || [],
      source: 'jikan',
      rating: item.score ? item.score.toFixed(1) : null
    }));

    await setCache(cacheKey, results);
    return { results };
  } catch (err) {
    console.error('[SW] Jikan search error:', err);
    return { error: err.message, results: [] };
  }
}

// ─── Fetch Alternative Titles ─────────────────────────────────────────────────
async function fetchAliases(titleId, source, mainTitle) {
  try {
    // Start with known aliases from our DB
    const knownAliases = KNOWN_ALIASES[mainTitle] || [];
    const aliasSet = new Set(knownAliases);

    // Auto-generate abbreviation
    const abbr = makeAbbreviation(mainTitle);
    if (abbr.length >= 2 && abbr !== mainTitle) aliasSet.add(abbr);

    if (source === 'jikan') {
      const cacheKey = `jikan_aliases_${titleId}`;
      const cached = await getCache(cacheKey);
      if (cached) {
        cached.forEach(a => aliasSet.add(a));
        return { aliases: [...aliasSet] };
      }

      const res = await fetch(`${JIKAN_BASE}/anime/${titleId}`);
      if (res.ok) {
        const { data } = await res.json();
        if (data.title) aliasSet.add(data.title);
        if (data.title_english) aliasSet.add(data.title_english);
        if (data.title_japanese) aliasSet.add(data.title_japanese);
        (data.title_synonyms || []).forEach(s => aliasSet.add(s));
      }

      const list = [...aliasSet].filter(Boolean);
      await setCache(cacheKey, list);
      return { aliases: list };
    }

    if (source === 'tmdb') {
      const stored2 = await chrome.storage.local.get('tmdbApiKey');
      const tmdbApiKey = stored2.tmdbApiKey || BUILT_IN_KEY;
      if (!tmdbApiKey) return { aliases: [...aliasSet] };

      const [mediaType, id] = titleId.split('_');
      const cacheKey = `tmdb_aliases_${titleId}`;
      const cached = await getCache(cacheKey);
      if (cached) {
        cached.forEach(a => aliasSet.add(a));
        return { aliases: [...aliasSet] };
      }

      const res = await fetch(`${TMDB_BASE}/${mediaType}/${id}/alternative_titles?api_key=${tmdbApiKey}`);
      if (res.ok) {
        const data = await res.json();
        const titles = (data.titles || data.results || [])
          .filter(t => ['US', 'EN', ''].includes(t.iso_3166_1 || ''))
          .slice(0, 15)
          .map(t => t.title)
          .filter(Boolean);
        titles.forEach(t => aliasSet.add(t));
        await setCache(cacheKey, titles);
      }
    }

    return { aliases: [...aliasSet].filter(Boolean) };
  } catch (err) {
    console.error('[SW] Fetch aliases error:', err);
    return { aliases: [] };
  }
}

// ─── TMDB Popular ─────────────────────────────────────────────────────────────
async function getPopularTMDB(mediaType) {
  try {
    const stored3 = await chrome.storage.local.get('tmdbApiKey');
    const tmdbApiKey = stored3.tmdbApiKey || BUILT_IN_KEY;
    if (!tmdbApiKey) return { results: [] };

    const cacheKey = `tmdb_popular_${mediaType}`;
    const cached = await getCache(cacheKey);
    if (cached) return { results: cached };

    const endpoint = mediaType === 'movie' ? 'movie/popular' : 'tv/popular';
    const res = await fetch(`${TMDB_BASE}/${endpoint}?api_key=${tmdbApiKey}&language=en-US&page=1`);
    if (!res.ok) return { results: [] };

    const data = await res.json();
    const results = (data.results || [])
      .filter(item => item.poster_path)
      .slice(0, 12)
      .map(item => ({
        id: item.id,
        title: item.title || item.name,
        type: mediaType,
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
        poster: `https://image.tmdb.org/t/p/w92${item.poster_path}`,
        source: 'tmdb',
        rating: item.vote_average ? item.vote_average.toFixed(1) : null
      }));

    await setCache(cacheKey, results, POPULAR_CACHE_TTL);
    return { results };
  } catch (err) {
    return { results: [] };
  }
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function setBadge(tabId, count) {
  if (!tabId) return;
  const text = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  chrome.action.setBadgeText({ text, tabId });
  if (count > 0) {
    chrome.action.setBadgeBackgroundColor({ color: '#7c3aed', tabId });
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────
async function recordBlockedStat(count) {
  if (!count) return;
  const today = new Date().toISOString().slice(0, 10);
  const { stats = {} } = await chrome.storage.local.get('stats');
  stats.total = (stats.total || 0) + count;
  stats.daily = stats.daily || {};
  stats.daily[today] = (stats.daily[today] || 0) + count;

  // Keep only last 30 days
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  Object.keys(stats.daily).forEach(d => { if (d < cutoff) delete stats.daily[d]; });

  await chrome.storage.local.set({ stats });
}

// ─── Tab cleanup ──────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener(() => {
  // Nothing needed — badge is per-tab
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') setBadge(tabId, 0);
});

// ─── Cache Helpers ────────────────────────────────────────────────────────────
async function getCache(key) {
  const data = await chrome.storage.local.get(`_c_${key}`);
  const entry = data[`_c_${key}`];
  if (!entry || Date.now() > entry.exp) {
    if (entry) chrome.storage.local.remove(`_c_${key}`);
    return null;
  }
  return entry.d;
}

async function setCache(key, data, ttl = CACHE_TTL) {
  await chrome.storage.local.set({
    [`_c_${key}`]: { d: data, exp: Date.now() + ttl }
  });
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function makeAbbreviation(title) {
  if (!title) return '';
  const skip = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'x', '×']);
  return title
    .split(/[\s:]+/)
    .filter(w => w.length > 1 && !skip.has(w.toLowerCase()))
    .map(w => w[0].toUpperCase())
    .join('');
}
