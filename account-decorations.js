(function initAccountDecorations(global) {
  const LAYER_ID = 'xa-account-marks';
  const records = new Map();
  let layer;
  let frame;

  function restore(record) {
    record.element.remove();
    if (record.anchor.getAttribute('title') === record.title) {
      if (record.originalTitle === null) record.anchor.removeAttribute('title');
      else record.anchor.setAttribute('title', record.originalTitle);
    }
  }

  function position() {
    frame = null;
    const dialog = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
      .filter((node) => node.getBoundingClientRect().width > 0).pop();
    for (const [avatar, record] of records) {
      if (!avatar.isConnected || !record.article.contains(avatar)) {
        restore(record); records.delete(avatar); continue;
      }
      const box = avatar.getBoundingClientRect();
      let hidden = box.width < 20 || box.width > 120 || box.height < 20 || box.height > 120 ||
        box.bottom <= 0 || box.top >= global.innerHeight || box.right <= 0 || box.left >= global.innerWidth ||
        (dialog && !dialog.contains(avatar)) || avatar.getClientRects().length === 0;
      if (!hidden) {
        // Do not paint above sticky headers or menus that cover the avatar.
        const points = [[box.left + box.width / 2, box.top + 2], [box.left + box.width / 2, box.bottom - 2],
          [box.left + 2, box.top + box.height / 2], [box.right - 2, box.top + box.height / 2]];
        hidden = points.some(([x, y]) => !record.anchor.contains(document.elementFromPoint(x, y)));
      }
      record.element.hidden = Boolean(hidden);
      Object.assign(record.element.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    }
  }

  function schedulePosition() {
    if (records.size && frame == null) frame = global.requestAnimationFrame(position);
  }

  function ensureLayer() {
    if (layer?.isConnected) return;
    if (!document.getElementById('xa-account-mark-style')) {
      const style = document.createElement('style');
      style.id = 'xa-account-mark-style';
      style.textContent = `
        #${LAYER_ID} { position:fixed!important; inset:0!important; overflow:hidden!important; pointer-events:none!important; z-index:2147483000!important; }
        #${LAYER_ID} .xa-account-mark { position:absolute; pointer-events:none; box-sizing:border-box; }
        #${LAYER_ID} [hidden] { display:none!important; }
        #${LAYER_ID} .xa-account-ring { position:absolute; inset:-3px; border:2px solid #e8aa16; border-radius:50%; box-sizing:border-box; }
        #${LAYER_ID} .xa-account-ring-warning { border-color:#e44747; }
        #${LAYER_ID} .xa-account-mark-both .xa-account-ring-warning { inset:-6px; }
        #${LAYER_ID} .xa-account-tags { position:absolute; top:calc(100% - 1px); left:50%; transform:translateX(-50%); display:flex; gap:2px; font:700 10px/14px system-ui,sans-serif; white-space:nowrap; }
        #${LAYER_ID} .xa-account-tag { padding:0 3px; border:1px solid #e8aa16; border-radius:3px; background:#fff2bc; color:#503800; }
        #${LAYER_ID} .xa-account-tag-warning { color:#ffb84c; background:#3b1616; border-color:#e44747; }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
    layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }

  function avatarFor(article, author) {
    if (!/^[a-z0-9_]{1,15}$/i.test(author)) return null;
    return [...article.querySelectorAll('[data-testid^="UserAvatar-Container"] img, [data-testid="Tweet-User-Avatar"] img')].find((img) => {
      if (img.closest('article[data-testid="tweet"]') !== article || img.closest('div[role="link"], [data-testid="quoteTweet"], [data-testid="card.wrapper"]')) return false;
      try {
        const url = new URL(img.closest('a[href]')?.getAttribute('href') || '', location.href);
        return ['x.com', 'twitter.com', location.hostname].includes(url.hostname) &&
          new RegExp(`^/${author}(?:/photo)?/?$`, 'i').test(url.pathname);
      } catch (_) { return false; }
    }) || null;
  }

  function sync(articles, settings, resolve) {
    const active = new Set();
    if (settings.enabled && (settings.aiLabelsEnabled || settings.accountWarningsEnabled)) {
      const contexts = articles.map((article) => ({ article, ...resolve(article) }));
      const accounts = new Map();
      const authorIds = new Map();
      const samplesByAuthor = new Map();
      for (const context of contexts) {
        if (context.author && context.id) {
          const samples = samplesByAuthor.get(context.author) || [];
          samples.push({ id: context.id, text: context.text, createdAt: context.metric?.createdAt, replyToId: context.metric?.replyToId, isRepost: context.metric?.isRepost });
          samplesByAuthor.set(context.author, samples);
        }
        const account = context.metric?.account;
        if (!account?.id) continue;
        if (context.author) {
          const previousId = authorIds.get(context.author);
          authorIds.set(context.author, previousId === undefined || previousId === account.id ? account.id : null);
        }
        const previous = accounts.get(account.id);
        if (!previous || (account.observedAt || 0) >= (previous.observedAt || 0)) accounts.set(account.id, { ...previous, ...account });
      }
      for (const { article, metric, author, text, id } of contexts) {
        if (!id) continue; // Reply drafts do not represent posts.
        const avatar = avatarFor(article, author);
        if (!avatar) continue;
        const account = accounts.get(metric?.account?.id || authorIds.get(author)) || metric?.account || {};
        const signals = global.XA_ACCOUNT_SIGNALS.classify({ account, text, samples: samplesByAuthor.get(author) || [] });
        const ai = settings.aiLabelsEnabled ? signals.ai : [];
        const warning = settings.accountWarningsEnabled ? signals.warning : [];
        if (!ai.length && !warning.length && !(settings.aiLabelsEnabled && signals.score > 0)) continue;
        ensureLayer();
        active.add(avatar);
        let record = records.get(avatar);
        const anchor = avatar.closest('a[href]');
        if (record && (record.article !== article || record.anchor !== anchor || record.postId !== id || record.author !== author)) {
          restore(record); records.delete(avatar); record = null;
        }
        if (!record) {
          const element = document.createElement('span');
          layer.appendChild(element);
          record = { element, article, anchor, originalTitle: anchor.getAttribute('title'), postId: id, author, time: new Date().toLocaleString(), title: null };
          records.set(avatar, record);
        }
        if (!record.element.isConnected) layer.appendChild(record.element);
        record.element.className = `xa-account-mark${ai.length && warning.length ? ' xa-account-mark-both' : ''}`;
        record.element.replaceChildren();
        for (const kind of [...(ai.length ? ['ai'] : []), ...(warning.length ? ['warning'] : [])]) {
          const ring = document.createElement('span');
          ring.className = `xa-account-ring xa-account-ring-${kind}`;
          record.element.appendChild(ring);
        }
        const tags = document.createElement('span');
        tags.className = 'xa-account-tags';
        for (const [text, kind] of [...(ai.length ? [['AI', 'ai']] : []), ...(warning.length ? [['?', 'warning']] : [])]) {
          const tag = document.createElement('span'); tag.className = `xa-account-tag xa-account-tag-${kind}`; tag.textContent = text; tags.appendChild(tag);
        }
        record.element.appendChild(tags);
        if (record.title !== null && anchor.getAttribute('title') !== record.title) record.originalTitle = anchor.getAttribute('title');
        record.title = [record.originalTitle, 'X-Newfish · 本地规则提示', settings.aiLabelsEnabled ?
          `${signals.score >= 80 ? '疑似 AI 参与' : signals.score >= 60 ? '待观察' : '证据不足'} · 规则分 ${signals.score}/100（不是概率）\n账号自动化 ${signals.automationScore} / 本帖 AI ${signals.contentScore} · 已观察 ${signals.sampleCount} 条` : '',
          ...(settings.aiLabelsEnabled ? signals.evidence.map((item) => `+${item.points} ${item.reason}`) : []), ...warning,
          `检测时间：${record.time}`, '权重尚未校准；未标记不代表纯人工或正常账号。'].filter(Boolean).join('\n');
        anchor.setAttribute('title', record.title);
      }
    }
    for (const [avatar, record] of records) {
      if (!active.has(avatar)) { restore(record); records.delete(avatar); }
    }
    if (!records.size) { layer?.remove(); layer = null; }
    else position();
  }

  global.addEventListener('scroll', schedulePosition, { capture: true, passive: true });
  global.addEventListener('resize', schedulePosition, { passive: true });
  global.XA_ACCOUNT_MARKS = Object.freeze({ sync });
})(typeof globalThis !== 'undefined' ? globalThis : this);
