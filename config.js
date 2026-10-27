(function initConfig(global) {
  const DEFAULTS = {
    enabled: true,
    showVelocity: true,
    aiLabelsEnabled: false,
    accountWarningsEnabled: false,
    keywordFilterEnabled: true,
    keywords: [],
    whitelist: [],
    filteringEnabled: true,
    blockedAccounts: [],
    blockedDomains: [],
    pageFilters: {},
    languageFilterEnabled: false,
    allowedLanguages: ['zh', 'en'],
    velocityFilterEnabled: false,
    minVelocity: 0,
    leaderboardOpacity: 0.1,
    leaderboardEnabled: true,
    leaderboardCollapsed: false,
    leaderboardSort: 'velocity',
    leaderboardHours: 0,
    leaderboardLimit: 10
  };

  const ICON = Object.freeze({
    viewBox: '0 0 64 64',
    red: '#ef233c',
    dark: '#111827',
    white: '#ffffff'
  });
  const FILTER_KEYS = Object.freeze(['filteringEnabled', 'keywordFilterEnabled', 'keywords', 'languageFilterEnabled', 'allowedLanguages', 'velocityFilterEnabled', 'minVelocity', 'blockedAccounts', 'blockedDomains']);
  const PAGE_TYPES = Object.freeze(['home', 'lists', 'profile', 'detail']);

  function filterValues(value, fallback = DEFAULTS) {
    const source = value && typeof value === 'object' ? value : {};
    const merged = { ...fallback, ...source };
    return Object.fromEntries(FILTER_KEYS.map((key) => {
      let result = merged[key];
      if (['filteringEnabled', 'keywordFilterEnabled', 'languageFilterEnabled', 'velocityFilterEnabled'].includes(key)) result = typeof result === 'boolean' ? result : fallback[key];
      if (key === 'keywords') result = normalizeKeywords(result);
      if (key === 'allowedLanguages') result = normalizeLanguages(result ?? fallback[key]);
      if (key === 'blockedAccounts') result = normalizeHandles(result);
      if (key === 'blockedDomains') result = normalizeDomains(result);
      if (key === 'minVelocity') result = Number.isFinite(Number(result)) ? Math.max(0, Number(result)) : 0;
      return [key, result];
    }));
  }

  function mergeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    const leaderboardOpacity = Number(source.leaderboardOpacity);
    const filters = filterValues(source);
    return {
      ...DEFAULTS,
      ...Object.fromEntries(Object.keys(DEFAULTS)
        .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
        .map((key) => [key, source[key]])),
      ...filters,
      aiLabelsEnabled: source.aiLabelsEnabled === true,
      accountWarningsEnabled: source.accountWarningsEnabled === true,
      pageFilters: Object.fromEntries(PAGE_TYPES.filter((key) => source.pageFilters?.[key] && typeof source.pageFilters[key] === 'object')
        .map((key) => [key, filterValues(source.pageFilters[key], filters)])),
      whitelist: normalizeHandles(source.whitelist || []),
      leaderboardSort: ['velocity', 'views', 'likes', 'bookmarks'].includes(source.leaderboardSort) ? source.leaderboardSort : 'velocity',
      leaderboardHours: [0, 1, 24, 168].includes(Number(source.leaderboardHours)) ? Number(source.leaderboardHours) : 0,
      leaderboardLimit: [10, 20, 50].includes(Number(source.leaderboardLimit)) ? Number(source.leaderboardLimit) : 10,
      leaderboardOpacity: Number.isFinite(leaderboardOpacity)
        ? Math.min(1, Math.max(0, leaderboardOpacity))
        : DEFAULTS.leaderboardOpacity
    };
  }

  function normalizeKeywords(value) {
    const input = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
    return [...new Set(input.map((item) => String(item).trim()).filter(Boolean))];
  }

  function normalizeHandles(value) {
    return [...new Set(normalizeKeywords(value).map((item) => item.replace(/^@/, '').toLowerCase())
      .filter((item) => /^[a-z0-9_]{1,15}$/.test(item)))];
  }

  function normalizeLanguages(value) {
    return [...new Set(normalizeKeywords(value).map((item) => item.toLowerCase().replace(/_/g, '-'))
      .filter((item) => /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(item))
      .map((item) => item.split('-')[0]).filter((item) => !['und', 'mul', 'zxx'].includes(item)))];
  }

  function normalizeDomains(value) {
    return [...new Set(normalizeKeywords(value).flatMap((item) => {
      try {
        const text = item.replace(/^\*\./, '');
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
        const host = url.hostname.toLowerCase().replace(/\.$/, '');
        return host.includes('.') && host.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)) ? [host] : [];
      } catch (_) { return []; }
    }))];
  }

  function forPage(settings, page) {
    return { ...settings, ...(settings.pageFilters[page] || {}) };
  }

  const api = Object.freeze({
    DEFAULTS,
    ICON,
    mergeSettings,
    normalizeKeywords,
    normalizeHandles,
    normalizeLanguages,
    normalizeDomains,
    filterValues,
    forPage,
    FILTER_KEYS,
    PAGE_TYPES
  });

  global.XA_CONFIG = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
