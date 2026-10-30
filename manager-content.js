(() => {
  if (globalThis.__xaManagerContent) return;
  globalThis.__xaManagerContent = true;
  let active = null;
  let timer = null;
  let readyKey = '';
  let readyPending = false;
  let captureQueue = Promise.resolve();
  const trim = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  const idOf = (value) => /^\d{1,30}$/.test(String(value || '')) ? String(value) : '';
  const countOf = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  function viewer() {
    let id = '';
    try {
      const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('twid='));
      id = idOf(decodeURIComponent(cookie?.slice(5) || '').replace(/^u=/, ''));
    } catch (_) {}
    let handle = '';
    const profile = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
    try {
      const path = new URL(profile?.getAttribute('href') || '', location.origin).pathname;
      if (/^\/[a-zA-Z0-9_]{1,15}\/?$/.test(path)) handle = path.split('/')[1];
    } catch (_) {}
    return { id, handle };
  }
  function matches(job, current = viewer()) {
    return current.id && current.id === job.viewerId && current.handle &&
      current.handle.toLowerCase() === job.handle.toLowerCase() &&
      location.pathname.toLowerCase().replace(/\/$/, '') === `/${job.handle.toLowerCase()}/following`;
  }
  function removeUI() { document.getElementById('xa-relation-task')?.remove(); }
  function stop(note) {
    clearInterval(timer);
    timer = null;
    active = null;
    removeUI();
    if (note && document.body) {
      const box = document.createElement('div');
      box.id = 'xa-relation-task';
      box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;padding:14px;background:#17202a;color:#fff;border:1px solid #697b8a;border-radius:12px;font:14px/1.5 system-ui;max-width:320px;';
      const label = document.createElement('span');
      label.textContent = `X-Newfish：${note}。详细结果请回到关系管理页查看。 `;
      const close = document.createElement('button');
      close.type = 'button'; close.textContent = '关闭提示'; close.addEventListener('click', removeUI);
      box.append(label, close); document.body.append(box);
    }
  }
  async function send(message) {
    try {
      const reply = await chrome.runtime.sendMessage(message);
      if (reply?.error) { if (active) finish(`后台处理失败：${String(reply.error).slice(0, 100)}`); return null; }
      return reply;
    }
    catch (_) { stop('与扩展后台的连接已断开，请重新加载扩展并刷新此页'); return null; }
  }
  function finish(note) {
    if (!active) return;
    const jobId = active.id;
    stop(note);
    void send({ type: 'XA_RELATION_FINISH', jobId, complete: false, note });
  }
  function showUI() {
    if (!active || !document.body || document.getElementById('xa-relation-task')) return;
    const box = document.createElement('div');
    box.id = 'xa-relation-task';
    box.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;padding:14px;background:#17202a;color:#fff;border:1px solid #697b8a;border-radius:12px;font:14px/1.5 system-ui;box-shadow:0 4px 24px #0005;max-width:280px;';
    const label = document.createElement('span');
    label.textContent = '正在只读扫描关注列表… ';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '停止';
    button.style.cssText = 'padding:4px 10px;border-radius:6px;cursor:pointer;';
    button.addEventListener('click', () => {
      const jobId = active?.id;
      stop();
      if (jobId) void send({ type: 'XA_RELATION_STOP', jobId });
    });
    box.append(label, button);
    document.body.append(box);
  }
  function begin(job) {
    if (!job || typeof job.id !== 'string' || !job.id || job.id.length > 100 ||
      !idOf(job.viewerId) || !/^[a-zA-Z0-9_]{1,15}$/.test(job.handle || '') || !matches(job)) return false;
    if (active?.id === job.id) return true;
    stop();
    const now = Date.now();
    active = { id: job.id, viewerId: job.viewerId, handle: job.handle,
      startedAt: Number.isFinite(job.startedAt) ? Math.min(job.startedAt, now) : now, lastValid: now, busy: false };
    showUI();
    window.postMessage({ type: 'XA_MANAGER_REPLAY' }, location.origin);
    timer = setInterval(async () => {
      const jobState = active;
      if (!jobState || jobState.busy) return;
      if (!matches(jobState)) { finish('页面或登录账号已变化，扫描中断'); return; }
      if (Date.now() - jobState.startedAt >= 1800000) { finish('扫描达到三十分钟上限，未确认完整'); return; }
      if (Date.now() - jobState.lastValid >= 90000) { finish('90 秒未收到有效关注分页，可能加载缓慢或已被限流；未确认完整，保留历史记录'); return; }
      jobState.busy = true;
      showUI();
      const response = await send({ type: 'XA_RELATION_HEARTBEAT', jobId: jobState.id, viewerId: jobState.viewerId });
      if (active !== jobState) return;
      jobState.busy = false;
      if (['complete', 'partial', 'error'].includes(response?.jobStatus)) { stop(response.jobNote || '扫描已结束，完整性以管理页结果为准'); return; }
      const label = document.getElementById('xa-relation-task')?.querySelector('span');
      if (label) label.textContent = `正在只读扫描关注列表 · 已读取 ${response?.jobCount || 0} 个账号 · ${Math.floor((Date.now() - jobState.lastValid) / 1000)} 秒前收到分页… `;
      window.scrollTo({ top: window.scrollY + Math.max(400, window.innerHeight * 0.9), behavior: 'instant' });
    }, 1200);
    return true;
  }
  function normalizeCapture(data) {
    const posts = (Array.isArray(data.posts) ? data.posts : []).slice(0, 300)
      .filter((post) => post && idOf(post.id)).map((post) => ({
        id: idOf(post.id), text: trim(post.text, 20000), author: trim(post.author, 30), language: trim(post.language, 30),
        ...Object.fromEntries(['createdAt', 'views', 'comments', 'reposts', 'likes', 'bookmarks', 'repostedAt']
          .map((key) => [key, countOf(post[key])])),
        authorId: idOf(post.authorId), replyToId: idOf(post.replyToId), quoteId: idOf(post.quoteId),
        conversationId: idOf(post.conversationId), replyToAuthor: trim(post.replyToAuthor, 30),
        quoteText: trim(post.quoteText, 20000), repostText: trim(post.repostText, 20000),
        quoteAuthor: trim(post.quoteAuthor, 30), repostAuthor: trim(post.repostAuthor, 30),
        isRepost: post.isRepost === true, repostId: idOf(post.repostId),
        urls: Array.isArray(post.urls) ? post.urls.slice(0, 30).map((url) => trim(url, 2000)) : [],
        account: { id: idOf(post.account?.id), bio: trim(post.account?.bio, 2000),
          automated: typeof post.account?.automated === 'boolean' ? post.account.automated : null,
          restriction: trim(post.account?.restriction, 100), observedAt: countOf(post.account?.observedAt) }
      }));
    const message = { type: 'XA_CAPTURE', viewer: viewer(), posts, observedAt: Number.isFinite(data.observedAt) ? data.observedAt : null,
      packetId: trim(data.packetId, 80) };
    const relation = data.relation;
    if (relation && idOf(relation.ownerId) && Array.isArray(relation.users)) {
      message.relation = { ownerId: idOf(relation.ownerId), first: relation.first === true,
        end: relation.end === true, valid: relation.valid === true && relation.users.length <= 2000,
        expectedTotal: countOf(relation.expectedTotal), error: trim(relation.error, 300),
        requestCursor: trim(relation.requestCursor, 2000),
        cursor: relation.cursor === null ? null : trim(relation.cursor, 2000),
        users: relation.users.slice(0, 2000).filter((user) => user && idOf(user.id)).map((user) => ({
          id: idOf(user.id), handle: trim(user.handle, 30), name: trim(user.name, 200),
          followedBy: typeof user.followedBy === 'boolean' ? user.followedBy : null,
          restriction: trim(user.restriction, 100), blue: typeof user.blue === 'boolean' ? user.blue : null,
          followers: countOf(user.followers) })) };
    }
    if (idOf(data.follower?.id) && countOf(data.follower?.count) !== null) {
      message.follower = { id: idOf(data.follower.id), count: countOf(data.follower.count) };
    }
    return message;
  }
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'XA_MANAGER_CAPTURE') return;
    const message = normalizeCapture(event.data);
    if (active && message.relation?.valid && message.relation.ownerId === active.viewerId && matches(active)) active.lastValid = Date.now();
    // Serialize replay and live captures so the backend sees first pages before their tails.
    captureQueue = captureQueue.then(async () => {
      const jobId = active?.id;
      const response = await send(message);
      if (active?.id === jobId && ['complete', 'partial', 'error'].includes(response?.jobStatus)) stop(response.jobNote || '扫描已结束，完整性以管理页结果为准');
    }).catch(() => stop('处理页面数据失败，本次扫描未确认完整'));
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'XA_MANAGER_REPLAY') { window.postMessage({ type: 'XA_MANAGER_REPLAY' }, location.origin); respond({ ok: true }); return; }
    if (message?.type === 'XA_PAGE_STATUS') { respond({ viewer: viewer(), url: location.href }); return; }
    if (message?.type === 'XA_RELATION_RUN') { respond({ started: begin(message.job) }); return; }
    if (message?.type === 'XA_RELATION_CANCEL') { stop(message.note || '扫描已停止；本次结果可能不完整'); respond({ stopped: true }); }
  });
  async function ready() {
    const current = viewer();
    const key = `${current.id}:${current.handle}:${location.pathname}`;
    if (!current.id || !current.handle || readyPending || readyKey === key) return;
    readyPending = true;
    const response = await send({ type: 'XA_MANAGER_READY', viewer: current });
    readyPending = false;
    if (response === null) return;
    readyKey = key;
    if (response?.job) begin(response.job);
  }
  void ready();
  // X reveals identity asynchronously and navigates without full document loads.
  setInterval(() => { void ready(); }, 1500);
  window.addEventListener('pagehide', () => { if (active) finish('页面关闭或跳转，未确认完整'); });
  window.postMessage({ type: 'XA_MANAGER_REPLAY' }, location.origin);
})();
