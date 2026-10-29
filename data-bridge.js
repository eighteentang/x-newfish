(() => {
  if (!window.__xaNet || !window.XA_METRICS || window.__xaManagerBridge) return;
  window.__xaManagerBridge = true;
  const packets = [];
  const idOf = (value) => /^\d{1,30}$/.test(String(value || '')) ? String(value) : '';
  const countOf = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const short = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  function unwrap(user) {
    return user?.__typename === 'UserWithVisibilityResults' ? user.user : user;
  }
  function following(url, payload, status) {
    let request;
    try { request = new URL(url, location.origin); } catch (_) { return null; }
    if (!/\/graphql\/[^/]+\/Following$/.test(request.pathname)) return null;
    let variables;
    try { variables = JSON.parse(request.searchParams.get('variables') || '{}'); } catch (_) { variables = {}; }
    const ownerId = idOf(variables.userId);
    const requestCursor = short(variables.cursor, 2000);
    const first = !requestCursor;
    const owner = unwrap(payload?.data?.user?.result);
    const instructions = owner?.timeline?.timeline?.instructions || owner?.timeline?.instructions;
    const relation = { ownerId, users: [], first, end: false, valid: false, requestCursor, cursor: null,
      expectedTotal: countOf(owner?.relationship_counts?.following) ?? countOf(owner?.legacy?.friends_count) };
    const followerCount = countOf(owner?.relationship_counts?.followers) ?? countOf(owner?.legacy?.followers_count);
    const follower = idOf(owner?.rest_id) === ownerId && followerCount !== null
      ? { id: ownerId, count: followerCount } : undefined;
    if (!ownerId || status < 200 || status >= 300 || payload?.errors?.length || !Array.isArray(instructions)) {
      relation.error = 'Following 响应不完整或无法识别';
      return { relation, follower };
    }
    let entriesSeen = false;
    let bottom = false;
    let terminated = false;
    let invalid = instructions.length > 100;
    let entryCount = 0;
    for (const instruction of instructions.slice(0, 100)) {
      if (instruction?.type === 'TimelineTerminateTimeline' && instruction.direction === 'Bottom') terminated = true;
      let entries = [];
      if (instruction?.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) {
        entriesSeen = true;
        entries = instruction.entries;
      } else if (instruction?.type === 'TimelineReplaceEntry' && instruction.entry) {
        entriesSeen = true;
        entries = [instruction.entry];
      }
      if (entries.length > 2000) invalid = true;
      entryCount += entries.length;
      for (const entry of entries.slice(0, 2000)) {
        const content = entry?.content;
        if (content?.cursorType === 'Bottom') {
          bottom = true;
          relation.cursor = short(content.value, 2000);
        }
        if (content?.cursorType || content?.entryType === 'TimelineTimelineCursor') continue;
        // Recommendation modules are excluded rather than flattened into following users.
        if (content?.entryType === 'TimelineTimelineModule') { invalid = true; continue; }
        // Only Following's actual user entries count; modules and unrelated users never do.
        const item = content?.itemContent;
        if (item?.itemType !== 'TimelineUser' && !/^user-\d+$/.test(entry?.entryId || '')) {
          // Unknown item structures must not turn a page into an apparently empty end page.
          invalid = true;
          continue;
        }
        const user = unwrap(item?.user_results?.result);
        const id = idOf(user?.rest_id || user?.legacy?.id_str);
        const handle = short(user?.core?.screen_name || user?.legacy?.screen_name, 30);
        if (!id || !/^[a-zA-Z0-9_]{1,15}$/.test(handle)) { invalid = true; continue; }
        const followed = user?.relationship_perspectives?.followed_by ?? user?.legacy?.followed_by;
        relation.users.push({ id, handle, name: short(user?.core?.name || user?.legacy?.name, 200),
          followedBy: typeof followed === 'boolean' ? followed : null,
          restriction: short(user?.profile_metadata?.profile_interstitial_type ||
            (user?.__typename === 'UserUnavailable' && user?.reason === 'Suspended' ? 'suspended' : ''), 100),
          blue: typeof user?.is_blue_verified === 'boolean' ? user.is_blue_verified : null,
          followers: countOf(user?.relationship_counts?.followers) ?? countOf(user?.legacy?.followers_count) });
      }
    }
    relation.valid = !invalid && (entriesSeen || terminated);
    // Only a stalled/empty bottom cursor on a valid empty later page is terminal evidence.
    const emptyLater = !first && entriesSeen && relation.users.length === 0;
    const exhausted = entryCount === 0 || (bottom && (!relation.cursor || relation.cursor === requestCursor));
    const emptyOwnFirst = first && entriesSeen && entryCount === 0 && relation.expectedTotal === 0;
    relation.end = relation.valid && (terminated || emptyOwnFirst || (emptyLater && exhausted));
    if (invalid) relation.error = '部分关注用户字段无法识别';
    return { relation, follower };
  }
  function boundedPosts(posts) {
    return posts.slice(0, 300).map((post) => ({ ...post, text: short(post.text, 20000),
      author: short(post.author, 30), language: short(post.language, 30),
      replyToAuthor: short(post.replyToAuthor, 30), quoteAuthor: short(post.quoteAuthor, 30),
      repostAuthor: short(post.repostAuthor, 30),
      urls: Array.isArray(post.urls) ? post.urls.slice(0, 30).map((url) => short(url, 2000)) : [],
      account: post.account ? { ...post.account, bio: short(post.account.bio, 2000) } : {} }));
  }
  function publish(packet) {
    window.postMessage(packet, location.origin);
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'XA_MANAGER_REPLAY') return;
    packets.forEach(publish);
  });
  window.__xaNet.onResponse(/\/graphql\//i, async ({ url, response }) => {
    const observedAt = Date.now();
    try {
      const text = await (typeof response.clone === 'function' ? response.clone() : response).text();
      if (text.length > 12000000) return;
      const parsed = JSON.parse(text);
      const posts = boundedPosts(window.XA_METRICS.parseResponseText(text));
      const details = following(url, parsed, response.status);
      if (!posts.length && !details) return;
      // Cache normalized public observations only, never request URLs or headers.
      const packet = { type: 'XA_MANAGER_CAPTURE', observedAt, packetId: crypto.randomUUID(), posts, ...(details || {}) };
      packets.push(packet);
      while (packets.length > 20) packets.shift();
      publish(packet);
    } catch (_) { /* A failed or non-JSON page response supplies no reliable observation. */ }
  });
})();
