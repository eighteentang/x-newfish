(function initContent(global) {
  const SELECTOR = 'article[data-testid="tweet"]';
  const BADGE_CLASS = 'xa-velocity-badge';
  const STYLE_ID = 'xa-content-style';
  const LEADERBOARD_ID = 'xa-velocity-board';
  const NOTICE_CLASS = 'xa-filter-notice';
  let settings = XA_CONFIG.mergeSettings({});
  const metricsById = new Map();
  const originalDisplays = new WeakMap();
  const filterNotices = new Map();
  const restoredPosts = new Set();
  const observerOptions = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'src', 'datetime', 'lang', 'aria-label', 'data-testid'] };
  let observer;
  let refreshTimer;
  let lastPagePath = global.location?.pathname || '';

  const formatVelocity = XA_METRICS.formatVelocity;

  function statusIdFromHref(href) {
    return String(href || '').match(/\/status\/(\d+)/)?.[1] || '';
  }

  function articleId(article) {
    const timeLink = ownNodes(article, 'time')[0]?.closest('a[href*="/status/"]');
    const links = ownNodes(article, 'a[href*="/status/"]');
    return statusIdFromHref(timeLink?.href) || links.map((link) => statusIdFromHref(link.href)).find(Boolean) || '';
  }

  // Quoted posts and cards have their own counts, timestamps and language.
  function ownNodes(article, selector) {
    return [...article.querySelectorAll(selector)].filter((node) => {
      const quote = node.closest('div[role="link"], [data-testid="quoteTweet"], [data-testid="card.wrapper"]');
      return node.closest(SELECTOR) === article && (!quote || !article.contains(quote));
    });
  }

  function domMetrics(article, id) {
    const time = ownNodes(article, 'time[datetime]')[0]?.getAttribute('datetime');
    const createdAt = Date.parse(time || '');
    const result = { id, createdAt: Number.isFinite(createdAt) ? createdAt : null, rounding: {} };
    const read = (key, node) => {
      const raw = [node.textContent, node.getAttribute('aria-label')].find((value) => XA_METRICS.parseCount(value) !== null) || '';
      result[key] = XA_METRICS.parseCount(raw);
      const short = raw.replace(/,/g, '').match(/(\d+)(?:\.(\d+))?\s*([km万亿])/i);
      result.rounding[key] = short ? ({ k: 1e3, m: 1e6, 万: 1e4, 亿: 1e8 }[short[3].toLowerCase()] / 10 ** (short[2]?.length || 0)) : 0;
    };
    const analytics = ownNodes(article, 'a[href*="/analytics"]')
      .find((link) => statusIdFromHref(link.getAttribute('href')) === id);
    if (analytics) read('views', analytics);
    for (const [key, testids] of Object.entries({ comments: ['reply'], reposts: ['retweet', 'unretweet'], likes: ['like', 'unlike'], bookmarks: ['bookmark', 'removeBookmark'] })) {
      const button = ownNodes(article, testids.map((testid) => `[data-testid="${testid}"]`).join(','))[0];
      if (!button) continue;
      // An absent count is not evidence of zero (detail pages can omit counts).
      read(key, button);
    }
    return result;
  }

  function getArticleMetrics(article) {
    const id = articleId(article);
    if (!id) return null;
    const network = metricsById.get(id);
    const dom = domMetrics(article, id);
    const metric = XA_METRICS.mergeTweet(dom, network || { id });
    // Keep exact network values unless the displayed count has moved beyond
    // the rounding interval of X's abbreviated label.
    let usedDom = !network;
    for (const key of ['views', 'comments', 'reposts', 'likes', 'bookmarks']) {
      if (!Number.isFinite(dom[key])) continue;
      if (!Number.isFinite(network?.[key])) usedDom = true;
      const tolerance = dom.rounding[key] || 0;
      if (!Number.isFinite(metric[key]) || Math.abs(metric[key] - dom[key]) > tolerance) {
        metric[key] = dom[key]; usedDom = true;
      }
    }
    metric.source = usedDom ? '页面读数（缩写值可能有舍入）' : 'X 网络数据';
    if (!network && !Number.isFinite(metric.views) && !Number.isFinite(metric.createdAt)) return null;
    const value = XA_METRICS.velocity(metric);
    return { ...metric, velocity: value, tier: XA_METRICS.velocityTier(value) };
  }

  function authorHandle(article, metrics) {
    const cached = XA_CONFIG.normalizeHandles([metrics?.author || ''])[0];
    if (cached) return cached;
    const timeLink = ownNodes(article, 'time')[0]?.closest('a[href*="/status/"]');
    const href = timeLink?.getAttribute('href') || '';
    try {
      const path = new URL(href, 'https://x.com').pathname;
      return path.match(/^\/([a-z0-9_]{1,15})\/status\/\d+/i)?.[1]?.toLowerCase() || '';
    } catch (_) { return ''; }
  }

  function articleText(article) {
    return ownNodes(article, '[data-testid="tweetText"]')
      .map((node) => node.textContent || '').join('\n');
  }

  function articleLanguage(article, metrics) {
    const network = XA_CONFIG.normalizeLanguages([metrics?.language || ''])[0];
    if (network) return network;
    const text = ownNodes(article, '[data-testid="tweetText"]')[0];
    const marked = text?.getAttribute('lang') || text?.querySelector('[lang]')?.getAttribute('lang');
    return XA_CONFIG.normalizeLanguages([marked || ''])[0] || '';
  }

  function articleScope(article) {
    return article.closest('[role="dialog"]') ? 'detail' : XA_FILTERS.pageType(global.location?.pathname || '');
  }

  function articleDomains(article, metrics) {
    const urls = [...(metrics?.urls || [])];
    ownNodes(article, '[data-testid="tweetText"] a[href]').forEach((link) => {
      urls.push(link.getAttribute('data-expanded-url') || '', link.getAttribute('title') || '', link.getAttribute('href') || '');
    });
    return XA_CONFIG.normalizeDomains(urls.filter((url) => /^https?:\/\//i.test(url)));
  }

  function extractDetails(article, metrics) {
    return {
      views: metrics?.views ?? null,
      comments: metrics?.comments ?? null,
      reposts: metrics?.reposts ?? null,
      likes: metrics?.likes ?? null,
      bookmarks: metrics?.bookmarks ?? null,
      publishedAt: metrics?.createdAt ? new Date(metrics.createdAt).toLocaleString() : '未知'
    };
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .${NOTICE_CLASS} {
        box-sizing: border-box; margin: 8px 0; padding: 12px 14px;
        border: 1px solid #657786; border-radius: 10px;
        color: inherit; background: rgba(127,127,127,.08);
        font: 13px/1.5 system-ui, sans-serif;
      }
      .${NOTICE_CLASS} .xa-filter-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
      .${NOTICE_CLASS} button {
        border: 1px solid #657786; border-radius: 6px; padding: 5px 9px;
        background: transparent; color: #1d9bf0; cursor: pointer; font: inherit;
      }
      .${NOTICE_CLASS} button:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 2px; }
      .${BADGE_CLASS} {
        all: initial;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 25px;
        padding: 0 8px;
        margin-left: 8px;
        border: 1px solid var(--xa-badge-border);
        border-radius: 8px;
        background: linear-gradient(145deg, var(--xa-badge-start), var(--xa-badge-end));
        color: var(--xa-badge-text);
        cursor: help;
        font: 700 12px/1 system-ui, sans-serif;
        box-shadow: 0 2px 8px var(--xa-badge-shadow);
        vertical-align: middle;
      }
      .${BADGE_CLASS}[data-tier="steady"] {
        --xa-badge-start: rgba(49, 105, 62, .48);
        --xa-badge-end: rgba(29, 74, 41, .72);
        --xa-badge-border: rgba(153, 207, 161, .52);
        --xa-badge-text: #e4f7e7;
        --xa-badge-shadow: rgba(29, 74, 41, .28);
      }
      .${BADGE_CLASS}[data-tier="rising"] {
        --xa-badge-start: rgba(170, 139, 32, .5);
        --xa-badge-end: rgba(123, 97, 16, .74);
        --xa-badge-border: rgba(232, 211, 117, .54);
        --xa-badge-text: #fff0ae;
        --xa-badge-shadow: rgba(123, 97, 16, .28);
      }
      .${BADGE_CLASS}[data-tier="accelerating"] {
        --xa-badge-start: rgba(178, 99, 32, .52);
        --xa-badge-end: rgba(140, 65, 17, .76);
        --xa-badge-border: rgba(240, 174, 103, .56);
        --xa-badge-text: #ffe0b6;
        --xa-badge-shadow: rgba(140, 65, 17, .3);
      }
      .${BADGE_CLASS}[data-tier="burst"] {
        --xa-badge-start: rgba(180, 59, 76, .54);
        --xa-badge-end: rgba(127, 36, 55, .78);
        --xa-badge-border: rgba(244, 139, 151, .58);
        --xa-badge-text: #ffd2d7;
        --xa-badge-shadow: rgba(127, 36, 55, .32);
      }
      .${BADGE_CLASS}[data-tier="viral"] {
        --xa-badge-start: rgba(101, 56, 118, .56);
        --xa-badge-end: rgba(62, 31, 85, .8);
        --xa-badge-border: rgba(196, 157, 215, .6);
        --xa-badge-text: #eedcf4;
        --xa-badge-shadow: rgba(62, 31, 85, .34);
      }
      .${BADGE_CLASS}[data-tier="unknown"] {
        --xa-badge-start: rgba(83, 100, 113, .26);
        --xa-badge-end: rgba(54, 67, 78, .48);
        --xa-badge-border: rgba(190, 202, 211, .3);
        --xa-badge-text: #d9e1e7;
        --xa-badge-shadow: rgba(54, 67, 78, .18);
      }
      .${BADGE_CLASS}:hover, .${BADGE_CLASS}:focus-visible {
        filter: saturate(1.08) brightness(.98);
        outline: 2px solid rgba(239, 35, 60, .28);
        outline-offset: 2px;
        backdrop-filter: blur(6px);
      }
      .xa-anchor-target {
        scroll-margin-top: 92px;
        outline: 2px solid rgba(239, 35, 60, .58);
        outline-offset: 4px;
        border-radius: 12px;
        animation: xa-anchor-pulse 1.25s ease-out;
      }
      @keyframes xa-anchor-pulse {
        0% { box-shadow: 0 0 0 0 rgba(239, 35, 60, .34); }
        100% { box-shadow: 0 0 0 12px rgba(239, 35, 60, 0); }
      }
      .xa-metrics-tooltip {
        position: fixed;
        z-index: 2147483647;
        width: 226px;
        padding: 12px 13px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 11px;
        background: rgba(17,24,39,.97);
        color: white;
        box-shadow: 0 12px 30px rgba(0,0,0,.24);
        pointer-events: none;
        font: 12px/1.45 system-ui, sans-serif;
      }
      .xa-metrics-tooltip strong { display: block; margin-bottom: 8px; color: #ff6171; font-size: 13px; }
      .xa-metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; }
      .xa-metrics-grid span { color: #b8c4d2; }
      .xa-metrics-grid b { color: white; font-weight: 650; }
      #${LEADERBOARD_ID} {
        position: fixed; top: 88px; right: 14px; z-index: 2147483000;
        width: 344px; max-height: min(560px, calc(100vh - 112px)); overflow: auto;
        box-sizing: border-box; padding: 12px;
        border: 1px solid rgba(255,255,255,.14); border-radius: 12px;
        background: rgba(25, 29, 35, var(--xa-board-opacity, .1)); color: #f3f5f7;
        box-shadow: 0 14px 38px rgba(15,20,25,.18);
        backdrop-filter: blur(16px) saturate(120%);
        font: 13px/1.35 system-ui, sans-serif;
      }
      #${LEADERBOARD_ID} .xa-board-title { display:flex; align-items:baseline; justify-content:space-between; margin-bottom: 8px; }
      #${LEADERBOARD_ID} .xa-board-title strong { font-size: 14px; }
      #${LEADERBOARD_ID} .xa-board-title span { color: #aeb7c2; font-size: 11px; }
      #${LEADERBOARD_ID} .xa-board-toggle { border: 1px solid #657786; border-radius: 5px; padding: 3px 8px; color: inherit; background: transparent; cursor: pointer; font: inherit; }
      #${LEADERBOARD_ID} .xa-board-controls { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 6px; }
      #${LEADERBOARD_ID} select { min-width: 0; flex: 1; padding: 5px 3px; border: 1px solid #657786; border-radius: 5px; background: #19232e; color: #f3f5f7; font: inherit; color-scheme: dark; }
      #${LEADERBOARD_ID} .xa-board-summary { margin: 7px 0; color: #aeb7c2; font-size: 11px; line-height: 1.5; }
      #${LEADERBOARD_ID} li { display: flex; align-items: center; gap: 3px; }
      #${LEADERBOARD_ID} .xa-board-open { flex: 0 0 auto; color: #9ed6ff; text-decoration: none; padding: 6px 4px; border-radius: 4px; font-size: 11px; }
      #${LEADERBOARD_ID} .xa-board-open:focus-visible { outline: 2px solid #9ed6ff; }
      #${LEADERBOARD_ID} .xa-board-copy { min-width: 0; display: grid; gap: 3px; }
      #${LEADERBOARD_ID} .xa-board-author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #aeb7c2; font-size: 11px; }
      #${LEADERBOARD_ID} .xa-board-empty { padding: 14px 4px; color: #aeb7c2; font-size: 12px; }
      #${LEADERBOARD_ID} ol { list-style: none; padding: 0; margin: 0; display: grid; gap: 5px; }
      #${LEADERBOARD_ID} { pointer-events: auto; }
      #${LEADERBOARD_ID} li button { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 7px; align-items: center; width: 100%; min-width: 0; padding: 7px 5px; border: 0; border-radius: 7px; background: transparent; color: inherit; cursor: pointer; text-align: left; pointer-events: auto; }
      #${LEADERBOARD_ID} li button:hover, #${LEADERBOARD_ID} li button:focus-visible { background: rgba(255,255,255,.09); outline: none; }
      #${LEADERBOARD_ID} .xa-board-rank { color: #aeb7c2; font-variant-numeric: tabular-nums; }
      #${LEADERBOARD_ID} .xa-board-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #${LEADERBOARD_ID} .xa-board-value {
        margin-left: 0;
        cursor: default;
        white-space: nowrap;
      }
      @media (max-width: 1180px) { #${LEADERBOARD_ID} { display: none; } }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function isExplainButton(element) {
    if (element.closest('[data-testid="tweetText"], [data-testid="User-Name"]')) return false;
    const label = `${element.getAttribute?.('aria-label') || ''} ${element.getAttribute?.('data-testid') || ''} ${element.getAttribute?.('title') || ''} ${element.textContent || ''}`.toLowerCase();
    return label.includes('explain this post') ||
      label.includes('解释这个帖子') ||
      label.includes('grok');
  }

  function getExplainButton(article) {
    return ownNodes(article, 'button, [role="button"], a[aria-label], a[title]')
      .find(isExplainButton) || null;
  }

  function getBadgeHost(article) {
    const time = ownNodes(article, 'time')[0];
    // closest() may find the reply dialog's group outside this article.
    // A badge placed there cannot be found on the next article refresh.
    return [time?.closest('div[role="group"]'), time?.parentElement?.parentElement,
      ownNodes(article, 'div[data-testid="User-Name"]')[0]?.parentElement]
      .find((candidate) => candidate && article.contains(candidate)) || article;
  }

  function placeBadge(article, badge) {
    const explainButton = getExplainButton(article);
    const explainHost = explainButton?.parentElement && article.contains(explainButton.parentElement) ? explainButton.parentElement : null;
    const host = explainHost || getBadgeHost(article);
    if (explainButton && explainHost) {
      if (badge.parentElement !== explainHost || badge.nextElementSibling !== explainButton) {
        explainHost.insertBefore(badge, explainButton);
      }
      return;
    }
    if (badge.parentElement !== host) host.appendChild(badge);
  }

  function showTooltip(badge) {
    hideTooltip();
    const tooltip = document.createElement('div');
    tooltip.className = 'xa-metrics-tooltip';
    tooltip.innerHTML = badge.dataset.tooltip || '';
    document.body.appendChild(tooltip);
    const rect = badge.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.right - tooltip.offsetWidth), window.innerWidth - tooltip.offsetWidth - 8);
    const top = rect.bottom + 8 + tooltip.offsetHeight < window.innerHeight
      ? rect.bottom + 8
      : Math.max(8, rect.top - tooltip.offsetHeight - 8);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    global.__XA_TOOLTIP = tooltip;
    global.__XA_TOOLTIP_BADGE = badge;
  }

  function hideTooltip() {
    global.__XA_TOOLTIP?.remove();
    global.__XA_TOOLTIP = null;
    global.__XA_TOOLTIP_BADGE = null;
  }

  function focusArticle(article, anchor = null) {
    const target = article?.isConnected ? article : anchor?.isConnected ? anchor : null;
    if (!target) return false;
    target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    const rect = target.getBoundingClientRect();
    if ((rect.top < 0 || rect.bottom > global.innerHeight) && typeof global.scrollTo === 'function') {
      global.scrollTo({
        top: Math.max(0, global.scrollY + rect.top - 92),
        behavior: 'auto'
      });
    }
    const highlight = article?.isConnected ? article : anchor?.closest?.(SELECTOR) || target;
    highlight.classList.remove('xa-anchor-target');
    void highlight.offsetWidth;
    highlight.classList.add('xa-anchor-target');
    clearTimeout(highlight.__xaAnchorTimer);
    highlight.__xaAnchorTimer = setTimeout(() => {
      highlight.classList.remove('xa-anchor-target');
    }, 1400);
    return true;
  }

  function findTweetTarget(tweetId) {
    const id = String(tweetId || '');
    if (!id) return null;
    const article = [...document.querySelectorAll(SELECTOR)]
      .find((candidate) => articleId(candidate) === id) || null;
    if (article) {
      const anchor = [...article.querySelectorAll('a[href*="/status/"]')]
        .find((link) => statusIdFromHref(link.href) === id) || null;
      return { article, anchor };
    }
    const anchor = [...document.querySelectorAll('a[href*="/status/"]')]
      .find((link) => statusIdFromHref(link.href) === id) || null;
    return anchor ? { article: anchor.closest(SELECTOR), anchor } : null;
  }

  function focusTweet(tweetId, attempt = 0) {
    const target = findTweetTarget(tweetId);
    if (target && focusArticle(target.article, target.anchor)) return true;
    if (attempt < 4) {
      setTimeout(() => focusTweet(tweetId, attempt + 1), 100);
    }
    return false;
  }

  function handleLeaderboardButton(event, tweetId) {
    const button = event.currentTarget;
    const now = Date.now();
    const handledAt = Number(button.dataset.xaPointerHandledAt || 0);
    if (event.type === 'click' && now - handledAt < 500) return;
    if (event.type === 'pointerdown') button.dataset.xaPointerHandledAt = String(now);
    event.preventDefault();
    event.stopPropagation();
    focusTweet(tweetId);
  }

  function ensureLeaderboard() {
    let board = document.getElementById(LEADERBOARD_ID);
    if (board) return board;
    board = document.createElement('aside');
    board.id = LEADERBOARD_ID;
    board.setAttribute('aria-label', '本页排行榜');
    const title = document.createElement('div');
    title.className = 'xa-board-title';
    const heading = document.createElement('strong');
    heading.textContent = '本页排行榜';
    const toggle = document.createElement('button');
    toggle.className = 'xa-board-toggle'; toggle.type = 'button';
    const body = document.createElement('div');
    body.id = 'xa-board-body'; toggle.setAttribute('aria-controls', body.id);
    const controls = document.createElement('div'); controls.className = 'xa-board-controls';
    const summary = document.createElement('p'); summary.className = 'xa-board-summary';
    const listHost = document.createElement('div');
    const savePreference = (next) => chrome.storage.local.set(next).catch(() => { summary.textContent = '榜单设置保存失败，请重试。'; });
    toggle.addEventListener('click', () => savePreference({ leaderboardCollapsed: !settings.leaderboardCollapsed }));
    const selects = {};
    const choices = [
      ['leaderboardSort', '榜单排序', [['velocity', '按平均流速'], ['views', '按浏览量'], ['likes', '按点赞数'], ['bookmarks', '按收藏数']]],
      ['leaderboardHours', '榜单发帖时间', [[0, '全部时间'], [1, '最近1小时'], [24, '最近24小时'], [168, '最近7天']]],
      ['leaderboardLimit', '榜单显示条数', [[10, 'Top 10'], [20, 'Top 20'], [50, 'Top 50']]]
    ];
    for (const [key, label, values] of choices) {
      const select = document.createElement('select'); select.setAttribute('aria-label', label);
      for (const [value, text] of values) {
        const option = document.createElement('option'); option.value = String(value); option.textContent = text; select.appendChild(option);
      }
      select.addEventListener('change', () => savePreference({ [key]: key === 'leaderboardSort' ? select.value : Number(select.value) }));
      selects[key] = select; controls.appendChild(select);
    }
    title.appendChild(heading); title.appendChild(toggle);
    body.appendChild(controls); body.appendChild(summary); body.appendChild(listHost);
    board.appendChild(title); board.appendChild(body);
    board.__xaParts = { toggle, body, summary, listHost, selects };
    document.body.appendChild(board);
    return board;
  }

  function renderLeaderboard() {
    const board = ensureLeaderboard();
    const opacity = Number(settings.leaderboardOpacity);
    board.style.setProperty('--xa-board-opacity', Number.isFinite(opacity) ? String(Math.min(1, Math.max(0, opacity))) : '0.1');
    board.style.display = settings.enabled && settings.leaderboardEnabled ? '' : 'none';
    const { toggle, body, summary, listHost, selects } = board.__xaParts;
    if (!settings.enabled || !settings.leaderboardEnabled) {
      listHost.replaceChildren();
      delete board.dataset.signature;
      return;
    }
    body.hidden = settings.leaderboardCollapsed;
    toggle.textContent = settings.leaderboardCollapsed ? '展开榜单' : '收起榜单';
    toggle.setAttribute('aria-expanded', String(!settings.leaderboardCollapsed));
    Object.entries(selects).forEach(([key, select]) => { select.value = String(settings[key]); });
    if (settings.leaderboardCollapsed) return;
    const candidates = [...document.querySelectorAll(SELECTOR)]
      .map((article) => ({ article, metric: getArticleMetrics(article) }))
      .filter((item) => item.article.style.display !== 'none');
    const { rows, total } = XA_METRICS.rankTweets(candidates, settings);
    const sort = settings.leaderboardSort;
    summary.textContent = `当前已加载且未被过滤的帖子 · 符合条件 ${total} 条，显示 ${rows.length} 条${sort === 'velocity' ? ' · 按发布以来平均流速' : ''}`;
    const signature = JSON.stringify([sort, settings.leaderboardHours, settings.leaderboardLimit, rows.map(({ article, metric }) =>
      [metric.id, metric[sort], articleText(article), authorHandle(article, metric), metric.createdAt])]);
    if (board.dataset.signature === signature) return;
    board.dataset.signature = signature;
    listHost.replaceChildren();
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'xa-board-empty';
      empty.textContent = '暂无符合条件的帖子。可放宽时间范围、切换指标，或继续浏览加载更多帖子。';
      listHost.appendChild(empty);
      return;
    }
    const list = document.createElement('ol');
    rows.forEach(({ article, metric }, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const tweetId = articleId(article);
      button.dataset.tweetId = tweetId;
      button.addEventListener('pointerdown', (event) => handleLeaderboardButton(event, tweetId));
      button.addEventListener('click', (event) => handleLeaderboardButton(event, tweetId));
      const rank = document.createElement('span');
      rank.className = 'xa-board-rank';
      rank.textContent = `${index + 1}`;
      const text = document.createElement('span');
      text.className = 'xa-board-text';
      text.textContent = articleText(article).trim() || `帖子 ${articleId(article)}`;
      text.title = text.textContent;
      const copy = document.createElement('span'); copy.className = 'xa-board-copy';
      const author = authorHandle(article, metric);
      const meta = document.createElement('span'); meta.className = 'xa-board-author';
      meta.textContent = `${author ? `@${author}` : '作者未知'}${metric.createdAt ? ` · ${new Date(metric.createdAt).toLocaleString()}` : ''}`;
      meta.title = meta.textContent;
      copy.appendChild(text); copy.appendChild(meta);
      const value = document.createElement('span');
      value.className = `${BADGE_CLASS} xa-board-value`;
      value.dataset.tier = sort === 'velocity' ? metric.tier?.key || 'unknown' : 'unknown';
      value.textContent = sort === 'velocity' ? `${metric.tier?.emoji || ''} ${formatVelocity(metric.velocity)}`.trim() : XA_METRICS.formatCount(metric[sort]);
      button.setAttribute('aria-label', `定位到第 ${index + 1} 条，${value.textContent}`);
      button.append(rank, copy, value);
      item.appendChild(button);
      const open = document.createElement('a'); open.className = 'xa-board-open';
      open.textContent = '原帖'; open.href = `https://x.com/i/status/${tweetId}`;
      open.target = '_blank'; open.rel = 'noopener noreferrer';
      open.setAttribute('aria-label', `在新标签页打开第 ${index + 1} 条原帖`);
      item.appendChild(open);
      list.appendChild(item);
    });
    listHost.appendChild(list);
  }

  function matchesKeyword(article) {
    return Boolean(XA_FILTERS.keywordMatch(settings, articleText(article)));
  }

  function removeNotice(article) {
    filterNotices.get(article)?.element.remove();
    filterNotices.delete(article);
  }

  function renderFilterNotice(article, key, author, reasons, restored) {
    if (!reasons.length) { removeNotice(article); return; }
    let record = filterNotices.get(article);
    if (!record) {
      const element = document.createElement('div');
      element.className = NOTICE_CLASS;
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', 'X-Newfish 过滤提示');
      record = { element, signature: '' };
      filterNotices.set(article, record);
    }
    const signature = JSON.stringify([key, author, reasons, restored]);
    if (record.signature !== signature) {
      record.signature = signature;
      const description = document.createElement('div');
      description.textContent = `${restored ? '已临时显示' : '已过滤'} · ${reasons.join('；')}`;
      const actions = document.createElement('div');
      actions.className = 'xa-filter-actions';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.textContent = restored ? '重新隐藏' : '显示这条';
      restore.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation();
        if (restored) restoredPosts.delete(key);
        else {
          restoredPosts.add(key);
          if (restoredPosts.size > 1000) restoredPosts.delete(restoredPosts.values().next().value);
        }
        scheduleRefresh();
      });
      actions.appendChild(restore);
      if (author) {
        const allow = document.createElement('button');
        allow.type = 'button';
        allow.textContent = `始终保留 @${author}`;
        allow.addEventListener('click', (event) => {
          event.preventDefault(); event.stopPropagation();
          allow.disabled = true;
          chrome.storage.local.get(XA_CONFIG.DEFAULTS).then((stored) => {
            const whitelist = XA_CONFIG.normalizeHandles([...XA_CONFIG.mergeSettings(stored).whitelist, author]);
            return chrome.storage.local.set({ whitelist });
          }).catch(() => { allow.disabled = false; description.textContent = '白名单保存失败，请重试。'; });
        });
        actions.appendChild(allow);
      }
      record.element.replaceChildren(description, actions);
    }
    if (record.element.nextElementSibling !== article) article.before(record.element);
  }

  function handleTweetMetrics(event) {
    if (event.source !== global || event.data?.type !== 'XA_TWEET_METRICS') return;
    XA_METRICS.cacheTweets(metricsById, event.data.tweets);
    scheduleRefresh();
  }

  function renderArticle(article) {
    if (!article.isConnected) return;
    const metrics = getArticleMetrics(article);
    const details = extractDetails(article, metrics);
    const text = articleText(article);
    const author = authorHandle(article, metrics);
    const scope = articleScope(article);
    const ruleSettings = XA_CONFIG.forPage(settings, scope);
    const key = `${scope}:${articleId(article) || `${author}:${text}`}`;
    const reasons = articleId(article) ? XA_FILTERS.reasons(ruleSettings, { text, author, language: articleLanguage(article, metrics), velocity: metrics?.velocity, domains: articleDomains(article, metrics) }) : [];
    const restored = restoredPosts.has(key);
    const hidden = reasons.length > 0 && !restored;
    renderFilterNotice(article, key, author, reasons, restored);
    if (hidden) {
      if (!originalDisplays.has(article)) originalDisplays.set(article, {
        value: article.style.getPropertyValue('display'), priority: article.style.getPropertyPriority('display')
      });
      article.style.setProperty('display', 'none', 'important');
    } else if (originalDisplays.has(article)) {
      const original = originalDisplays.get(article);
      if (original.value) article.style.setProperty('display', original.value, original.priority);
      else article.style.removeProperty('display');
      originalDisplays.delete(article);
    }

    const badges = [...article.querySelectorAll(`.${BADGE_CLASS}`)].filter((node) => node.closest(SELECTOR) === article);
    let badge = badges.shift();
    badges.forEach((duplicate) => {
      if (global.__XA_TOOLTIP_BADGE === duplicate) hideTooltip();
      duplicate.remove();
    });
    if (!settings.enabled || !settings.showVelocity || hidden || !articleId(article)) {
      if (global.__XA_TOOLTIP_BADGE === badge) hideTooltip();
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = BADGE_CLASS;
      badge.setAttribute('aria-label', 'X-Newfish 流速等级');
      badge.setAttribute('role', 'button');
      badge.tabIndex = 0;
      badge.textContent = '';
      badge.addEventListener('mouseenter', () => showTooltip(badge));
      badge.addEventListener('mouseleave', hideTooltip);
      badge.addEventListener('focus', () => showTooltip(badge));
      badge.addEventListener('blur', hideTooltip);
    }
    placeBadge(article, badge);
    const tier = metrics?.tier;
    const badgeText = Number.isFinite(metrics?.velocity)
      ? `${tier?.emoji || ''} ${formatVelocity(metrics.velocity)}`.trim()
      : '流速等待';
    if (badge.textContent !== badgeText) badge.textContent = badgeText;
    badge.dataset.tier = tier?.key || 'unknown';
    const exactCount = (value) => Number.isFinite(value) ? value.toLocaleString('zh-CN') : '未知';
    badge.dataset.tooltip = `<strong>X-Newfish 流量详情</strong><div class="xa-metrics-grid"><span>流速等级</span><b>${tier ? `${tier.emoji} ${tier.label}` : '未知'}</b><span>浏览量</span><b>${exactCount(details.views)}</b><span>评论</span><b>${exactCount(details.comments)}</b><span>转发</span><b>${exactCount(details.reposts)}</b><span>点赞</span><b>${exactCount(details.likes)}</b><span>收藏</span><b>${exactCount(details.bookmarks)}</b><span>平均流速</span><b>${formatVelocity(metrics?.velocity)}</b><span>发帖时间</span><b>${details.publishedAt}</b><span>数据来源</span><b>${metrics?.source || '等待数据'}</b></div><div>流速按发布以来计算；发布不足 5 分钟按 5 分钟计算。</div>`;
    if (global.__XA_TOOLTIP_BADGE === badge && global.__XA_TOOLTIP?.innerHTML !== badge.dataset.tooltip) showTooltip(badge);
    badge.dataset.state = Number.isFinite(metrics?.velocity) ? 'ready' : 'unknown';
  }

  function refresh() {
    observer?.disconnect();
    try {
      const pagePath = global.location?.pathname || '';
      if (pagePath !== lastPagePath) { restoredPosts.clear(); lastPagePath = pagePath; }
      document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => {
        if (!badge.closest(SELECTOR) && !badge.closest(`#${LEADERBOARD_ID}`)) badge.remove();
      });
      if (!settings.enabled || !settings.showVelocity || !global.__XA_TOOLTIP_BADGE?.isConnected) hideTooltip();
      for (const [article, record] of filterNotices) {
        if (!article.isConnected) { record.element.remove(); filterNotices.delete(article); }
      }
      document.querySelectorAll(SELECTOR).forEach(renderArticle);
      global.XA_ACCOUNT_MARKS?.sync([...document.querySelectorAll(SELECTOR)], settings, (article) => {
        const metric = getArticleMetrics(article);
        return { id: articleId(article), metric, author: authorHandle(article, metric), text: articleText(article) || metric?.text || '' };
      });
      renderLeaderboard();
    } finally {
      observer?.observe(document.body, observerOptions);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, 100);
  }

  function isExtensionNode(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    return Boolean(element?.closest?.(`#${LEADERBOARD_ID}, .${BADGE_CLASS}, .xa-metrics-tooltip, .${NOTICE_CLASS}, #${STYLE_ID}, #xa-account-marks, #xa-account-mark-style`));
  }

  function start() {
    injectStyles();
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      const relevant = mutations.some((mutation) => {
        if (isExtensionNode(mutation.target)) return false;
        if (mutation.type !== 'childList') return true;
        return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !isExtensionNode(node));
      });
      if (relevant) scheduleRefresh();
    });
    observer.observe(document.body, observerOptions);
    refresh();
    global.setInterval?.(() => {
      if (settings.enabled) scheduleRefresh();
    }, 60000);
    // X changes routes without reloading the document. Only refresh when the
    // path changes; do not scan the timeline on every poll.
    global.setInterval?.(() => {
      if ((global.location?.pathname || '') !== lastPagePath) scheduleRefresh();
    }, 1000);
  }

  chrome.storage.local.get(XA_CONFIG.DEFAULTS).then((stored) => {
    settings = XA_CONFIG.mergeSettings(stored);
    start();
  });

  function applySettings(next) {
    if (['enabled', 'filteringEnabled', 'pageFilters', 'blockedAccounts', 'blockedDomains', 'keywords', 'keywordFilterEnabled', 'whitelist', 'languageFilterEnabled', 'allowedLanguages', 'velocityFilterEnabled', 'minVelocity']
      .some((key) => key in next && JSON.stringify(next[key]) !== JSON.stringify(settings[key]))) restoredPosts.clear();
    settings = XA_CONFIG.mergeSettings({ ...settings, ...next });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const next = {};
    Object.keys(changes).forEach((key) => { next[key] = changes[key].newValue; });
    applySettings(next);
    scheduleRefresh();
  });

  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'XA_SETTINGS_APPLY') return false;
    chrome.storage.local.get(XA_CONFIG.DEFAULTS).then((stored) => {
      applySettings(stored);
      if (!observer) { sendResponse({ ready: false }); return; }
      refresh();
      const articles = [...document.querySelectorAll(SELECTOR)];
      sendResponse({ ready: true, total: articles.length,
        hidden: articles.filter((article) => originalDisplays.has(article)).length,
        velocity: articles.filter((article) => Number.isFinite(getArticleMetrics(article)?.velocity)).length,
        language: articles.filter((article) => articleLanguage(article, getArticleMetrics(article))).length });
    }).catch(() => sendResponse({ ready: false }));
    return true;
  });

  global.addEventListener?.('message', handleTweetMetrics);
  global.postMessage?.({ type: 'XA_METRICS_REQUEST' }, '*');

  global.XA_TEST = Object.freeze({ articleId, statusIdFromHref, findTweetTarget, getArticleMetrics, domMetrics, authorHandle, articleLanguage, articleScope, articleDomains, matchesKeyword, formatVelocity });
})(globalThis);
