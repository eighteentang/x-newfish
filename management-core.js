(function initManagement(global) {
  'use strict';
  const DAY = 86400000;
  const LIMITS = Object.freeze({ posts: 2000, snapshots: 6000, targets: 10, relationUsers: 3000, relationAccounts: 3, days: 7 });
  const id = (value) => /^\d{1,30}$/.test(String(value || '')) ? String(value) : '';
  const handle = (value) => /^[a-z0-9_]{1,15}$/i.test(String(value || '').replace(/^@/, '')) ? String(value).replace(/^@/, '').toLowerCase() : '';
  const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const fresh = () => ({ version: 1, targets: [], posts: [], snapshots: [], followers: [], relations: {}, dropped: 0 });
  const own = (object, key) => Object.hasOwn(object, key);

  function target(input) {
    const type = input?.type;
    let value = String(input?.value || '').trim();
    if (!['keyword', 'account', 'post'].includes(type) || !value) throw new Error('请选择监测类型并填写内容');
    if (type === 'account') { value = handle(value); if (!value) throw new Error('账号格式为 @用户名'); }
    if (type === 'keyword' && (value.length > 80 || /[\u0000-\u001f]/.test(value))) throw new Error('关键词限 1–80 字符，不包含控制字符');
    let postId = '';
    if (type === 'post') {
      let url;
      try { url = new URL(value); } catch (_) { throw new Error('请填写完整的 X 帖子链接'); }
      if (!['x.com', 'twitter.com'].includes(url.hostname) || url.protocol !== 'https:' || url.username || url.password) throw new Error('仅支持 https://x.com 或 twitter.com 的帖子链接');
      postId = id(url.pathname.match(/\/status\/(\d+)/)?.[1]);
      if (!postId) throw new Error('链接需要包含 /status/帖子ID');
      value = `https://x.com/i/web/status/${postId}`;
    }
    return { id: typeof input.id === 'string' && /^[\w-]{1,50}$/.test(input.id) ? input.id : global.crypto.randomUUID(), type, value, postId,
      createdAt: Number.isFinite(input.createdAt) ? input.createdAt : Date.now() };
  }

  function matches(post, item) {
    if (item.type === 'keyword') return [post.text, post.quoteText, post.repostText].filter(Boolean).join('\n').toLocaleLowerCase().includes(item.value.toLocaleLowerCase());
    if (item.type === 'post') return [post.id, post.replyToId, post.conversationId, post.quoteId, post.repostId].includes(item.postId) ||
      (post.urls || []).some((url) => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && ['x.com', 'twitter.com'].includes(parsed.hostname) && id(parsed.pathname.match(/\/status\/(\d+)/)?.[1]) === item.postId; } catch (_) { return false; } });
    return [post.author, post.replyToAuthor, post.quoteAuthor, post.repostAuthor].some((name) => handle(name) === item.value) ||
      new RegExp(`(^|[^a-z0-9_])@${item.value}(?![a-z0-9_])`, 'i').test(post.text || '');
  }

  function normalizePost(raw, now) {
    if (!id(raw?.id) || !Number.isFinite(raw.createdAt) || raw.createdAt > now + 300000) return null;
    const post = { id: id(raw.id), author: handle(raw.author), authorId: id(raw.authorId || raw.account?.id),
      createdAt: raw.createdAt, text: String(raw.text || '').slice(0, 1500), textTruncated: String(raw.text || '').length > 1500,
      observedAt: now, isRepost: raw.isRepost === true, urls: (Array.isArray(raw.urls) ? raw.urls : []).slice(0, 15).filter((url) => typeof url === 'string').map((url) => url.slice(0, 500)) };
    post.quoteText = String(raw.quoteText || '').slice(0, 800); post.repostText = String(raw.repostText || '').slice(0, 800);
    for (const key of ['replyToId', 'conversationId', 'quoteId', 'repostId']) post[key] = id(raw[key]);
    for (const key of ['replyToAuthor', 'quoteAuthor', 'repostAuthor']) post[key] = handle(raw[key]);
    for (const key of ['views', 'reposts', 'comments', 'likes', 'bookmarks']) post[key] = count(raw[key]);
    return post;
  }

  function prune(state, now = Date.now()) {
    const before = [state.posts.length, state.snapshots.length, state.followers.length].join(':');
    state.posts = state.posts.filter((post) => post.observedAt >= now - LIMITS.days * DAY).slice(-LIMITS.posts);
    const ids = new Set(state.posts.map((post) => post.id));
    state.snapshots = state.snapshots.filter((point) => point.at >= now - LIMITS.days * DAY && ids.has(point.id)).slice(-LIMITS.snapshots);
    state.followers = state.followers.filter((point) => point.at >= now - LIMITS.days * DAY).slice(-1000);
    return before !== [state.posts.length, state.snapshots.length, state.followers.length].join(':');
  }

  function capture(state, rawPosts, follower, now = Date.now(), observedAt = now) {
    if (!Number.isFinite(observedAt) || observedAt > now + 300000 || observedAt < now - LIMITS.days * DAY) return state;
    const previous = new Map(state.posts.map((post) => [post.id, post]));
    const snaps = new Map(state.snapshots.map((point) => [`${point.id}:${Math.floor(point.at / 3600000)}`, point]));
    for (const raw of (Array.isArray(rawPosts) ? rawPosts : []).slice(0, 300)) {
      // Match full input before storing a bounded excerpt.
      const matched = state.targets.filter((item) => matches(raw, item)).map((item) => item.id);
      if (!matched.length) continue;
      const post = normalizePost(raw, observedAt);
      if (!post) continue;
      const old = previous.get(post.id);
      post.targetIds = [...new Set([...(old?.targetIds || []), ...matched])].filter((value) => state.targets.some((item) => item.id === value));
      // Missing counters do not erase previously observed values.
      for (const key of ['views', 'reposts', 'comments', 'likes', 'bookmarks']) if (post[key] === null && old?.[key] !== undefined) post[key] = old[key];
      if (!old || old.observedAt <= observedAt) { previous.delete(post.id); previous.set(post.id, post); }
      else old.targetIds = post.targetIds;
      const key = `${post.id}:${Math.floor(observedAt / 3600000)}`;
      // Keep the first observation of each hour; don't overwrite a boundary baseline.
      if (!snaps.has(key) || snaps.get(key).at > observedAt) snaps.set(key, { id: post.id, at: observedAt, reposts: count(raw.reposts) });
    }
    const posts = [...previous.values()].filter((post) => post.observedAt >= now - LIMITS.days * DAY);
    state.dropped += Math.max(0, posts.length - LIMITS.posts);
    state.posts = posts.slice(-LIMITS.posts);
    const kept = new Set(state.posts.map((post) => post.id));
    state.snapshots = [...snaps.values()].filter((point) => point.at >= now - LIMITS.days * DAY && kept.has(point.id)).slice(-LIMITS.snapshots);
    if (id(follower?.id) && count(follower?.count) !== null) {
      const key = Math.floor(observedAt / 3600000);
      const point = state.followers.find((point) => point.id === follower.id && Math.floor(point.at / 3600000) === key);
      if (!point) state.followers.push({ id: follower.id, at: observedAt, count: follower.count });
      else if (point.at > observedAt) { point.at = observedAt; point.count = follower.count; }
    }
    state.followers = state.followers.filter((point) => point.at >= now - LIMITS.days * DAY).slice(-1000);
    return state;
  }

  function fitStorage(state) {
    // Leave room for the active scan and ordinary settings under storage.local's quota.
    const bytes = () => new TextEncoder().encode(JSON.stringify(state)).length;
    while (state.posts.length && bytes() > 7 * 1024 * 1024) {
      const remove = Math.max(1, Math.ceil(state.posts.length / 8));
      state.posts.splice(0, remove); state.dropped += remove;
      const ids = new Set(state.posts.map((post) => post.id)); state.snapshots = state.snapshots.filter((point) => ids.has(point.id));
    }
    return state;
  }

  function normalizeUser(user) {
    if (!id(user?.id) || !handle(user?.handle)) return null;
    return { id: id(user.id), handle: handle(user.handle), name: String(user.name || '').slice(0, 80),
      followedBy: typeof user.followedBy === 'boolean' ? user.followedBy : null,
      restriction: String(user.restriction || '').slice(0, 80), blue: user.blue === true, followers: count(user.followers) };
  }

  function applyRelations(state, job, now = Date.now()) {
    if (!job.complete || !id(job.viewerId)) return;
    const old = state.relations[job.viewerId] || { users: [], mutual: {}, lost: {}, ignored: {}, lastScanAt: 0 };
    const users = Object.values(job.users || {}).map(normalizeUser).filter(Boolean);
    const current = new Map(users.map((user) => [user.id, user]));
    const mutual = { ...old.mutual };
    const lost = { ...old.lost };
    for (const [userId, user] of current) {
      if (user.followedBy === true) { mutual[userId] = true; delete lost[userId]; }
      else if (user.followedBy === false && own(mutual, userId) && !user.restriction) lost[userId] = { ...user, detectedAt: lost[userId]?.detectedAt || now };
      else if (user.restriction || user.followedBy === null) delete lost[userId];
    }
    // Absence is never an unfollow event. A completed own-following scan can remove stale own-following history.
    for (const userId of Object.keys(mutual)) if (!current.has(userId)) { delete mutual[userId]; delete lost[userId]; }
    state.relations[job.viewerId] = { users, mutual, lost, ignored: old.ignored || {}, handle: job.handle, lastScanAt: now, firstScanAt: old.firstScanAt || now };
    const owners = Object.keys(state.relations).sort((a, b) => state.relations[b].lastScanAt - state.relations[a].lastScanAt);
    owners.slice(LIMITS.relationAccounts).forEach((owner) => { delete state.relations[owner]; });
  }

  function windowRange(mode, now = Date.now()) {
    if (mode === 'yesterday') {
      const dayStart = Math.floor((now + 8 * 3600000) / DAY) * DAY - 8 * 3600000;
      return { start: dayStart - DAY, end: dayStart };
    }
    return { start: now - (mode === '72' ? 72 : 24) * 3600000, end: now };
  }

  function trend(state, item, mode, now = Date.now()) {
    const { start, end } = windowRange(mode, now);
    const related = state.posts.filter((post) => post.targetIds?.includes(item.id) || matches(post, item));
    const events = related.filter((post) => post.createdAt >= start && post.createdAt < end &&
      !(item.type === 'post' && post.id === item.postId) && !(item.type === 'account' && post.author === item.value));
    const counts = { discussion: 0, replies: 0, quotes: 0, reposts: 0, original: 0 };
    const people = new Set(), reposters = new Set();
    let unknownAuthors = 0;
    const buckets = new Map();
    for (let at = Math.floor(start / 3600000) * 3600000; at < end; at += 3600000) buckets.set(at, { at, discussion: null, reposts: null });
    for (const post of events) {
      const kind = post.isRepost ? 'reposts' : post.quoteId ? 'quotes' : post.replyToId ? 'replies' : 'original';
      counts[kind]++;
      if (kind !== 'reposts') { counts.discussion++; if (post.authorId) people.add(post.authorId); else unknownAuthors++; }
      else if (post.authorId) reposters.add(post.authorId);
      const bucket = buckets.get(Math.floor(post.createdAt / 3600000) * 3600000);
      if (bucket) { const key = kind === 'reposts' ? 'reposts' : 'discussion'; bucket[key] = (bucket[key] || 0) + 1; }
    }
    const originals = related.filter((post) => item.type === 'post' ? post.id === item.postId : item.type === 'account' ? post.author === item.value && !post.isRepost : !post.isRepost);
    const deltas = [];
    for (const post of originals) {
      const points = state.snapshots.filter((point) => point.id === post.id && Number.isFinite(point.reposts)).sort((a, b) => a.at - b.at);
      const before = points.filter((point) => point.at <= start).at(-1);
      const after = points.filter((point) => point.at <= end).at(-1);
      if (before && after && after.at > before.at) deltas.push({ id: post.id, change: after.reposts - before.reposts, from: before.at, to: after.at });
    }
    return { start, end, events: events.sort((a, b) => b.createdAt - a.createdAt), counts, participants: people.size, reposters: reposters.size,
      unknownAuthors, buckets: [...buckets.values()], deltas, totalOriginals: originals.length,
      netReposts: deltas.length ? deltas.reduce((total, row) => total + row.change, 0) : null,
      previousObserved: related.filter((post) => post.createdAt >= start - (end - start) && post.createdAt < start && !post.isRepost &&
        !(item.type === 'post' && post.id === item.postId) && !(item.type === 'account' && post.author === item.value)).length,
      lastSeenAt: related.length ? Math.max(...related.map((post) => post.observedAt)) : null };
  }

  function searchUrl(item) {
    const query = item.type === 'account' ? `@${item.value} OR to:${item.value}` : item.type === 'post' ? `conversation_id:${item.postId} OR url:${item.postId}` : item.value;
    return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
  }

  const api = Object.freeze({ LIMITS, fresh, target, matches, capture, prune, fitStorage, normalizeUser, applyRelations, windowRange, trend, searchUrl, id, handle });
  global.XA_MANAGEMENT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
