importScripts('config.js', 'management-core.js');

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(XA_CONFIG.DEFAULTS).then((stored) => {
    chrome.storage.local.set(XA_CONFIG.mergeSettings(stored));
  });
});

const M = XA_MANAGEMENT;
const DATA_KEY = 'xaManagerData';
const JOB_KEY = 'xaRelationJob';
let writes = Promise.resolve();
const serial = (work) => { const result = writes.catch(() => {}).then(work); writes = result; return result; };
const state = async () => ({ ...M.fresh(), ...(await chrome.storage.local.get(DATA_KEY))[DATA_KEY] });
const jobState = async () => (await chrome.storage.local.get(JOB_KEY))[JOB_KEY] || null;
const pageSender = (sender) => sender.id === chrome.runtime.id && /^https:\/\/(?:x\.com|twitter\.com)\//.test(sender.url || '') && sender.tab?.id !== undefined;
const extensionSender = (sender) => sender.id === chrome.runtime.id && (sender.url || '').startsWith(chrome.runtime.getURL(''));
const storeJob = (job) => chrome.storage.local.set({ [JOB_KEY]: job });

async function stopJob(job, note, status = 'partial') {
  if (!job || job.status !== 'running') return job;
  job.status = status; job.note = note; job.finishedAt = Date.now(); job.complete = false;
  await storeJob(job);
  chrome.tabs.sendMessage(job.tabId, { type: 'XA_RELATION_CANCEL', note }).catch(() => {});
  return job;
}

async function tabsWithViewer() {
  const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
  return Promise.all(tabs.map(async (tab) => {
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'XA_PAGE_STATUS' });
      return { tabId: tab.id, active: tab.active, viewer: result?.viewer || {}, ready: Boolean(M.id(result?.viewer?.id) && M.handle(result?.viewer?.handle)) };
    } catch (_) { return { tabId: tab.id, ready: false, viewer: {} }; }
  }));
}

async function capture(message, sender) {
  const viewerId = M.id(message.viewer?.id);
  let job = await jobState();
  const data = await state();
  if (data.targets.length || (message.follower?.id === viewerId)) {
    M.capture(data, message.posts, message.follower?.id === viewerId ? message.follower : null, Date.now(), message.observedAt);
    M.fitStorage(data);
    await chrome.storage.local.set({ [DATA_KEY]: data });
  }
  const page = message.relation;
  if (!job || job.status !== 'running' || sender.tab.id !== job.tabId) return { jobStatus: job?.status };
  if (viewerId !== job.viewerId) {
    await stopJob(job, '登录账号已变化，已停止；未覆盖历史记录', 'error'); return { jobStatus: 'error' };
  }
  if (!page || M.id(page.ownerId) !== job.viewerId) return { jobStatus: job.status };
  if (!Number.isFinite(message.observedAt) || message.observedAt < job.startedAt) return { jobStatus: job.status };
  if (!page.valid || page.error) {
    await stopJob(job, page.error || '分页无法确认，结果不完整；未覆盖历史记录'); return { jobStatus: 'partial' };
  }
  const requestCursor = typeof page.requestCursor === 'string' ? page.requestCursor : '';
  const requestKey = requestCursor || '<first>';
  job.seenRequests ||= [];
  if (job.seenRequests.includes(requestKey)) return { jobStatus: job.status };
  if ((!job.sawFirst && (!page.first || requestCursor)) || (job.sawFirst && (page.first || requestCursor !== job.nextCursor))) {
    await stopJob(job, '分页不连续或首屏缺失；本次结果不完整，保留上次记录'); return { jobStatus: 'partial' };
  }
  job.sawFirst ||= page.first === true;
  job.seenRequests.push(requestKey);
  job.nextCursor = typeof page.cursor === 'string' ? page.cursor : null;
  job.lastDataAt = Date.now();
  if (Number.isSafeInteger(page.expectedTotal) && page.expectedTotal >= 0) job.expectedTotal = page.expectedTotal;
  for (const raw of (Array.isArray(page.users) ? page.users : []).slice(0, 2000)) {
    const user = M.normalizeUser(raw);
    if (!user || user.id === viewerId) continue;
    const previous = job.users[user.id];
    if (previous && user.followedBy === null) user.followedBy = previous.followedBy;
    job.users[user.id] = user;
  }
  job.count = Object.keys(job.users).length;
  job.unknown = Object.values(job.users).filter((user) => user.followedBy === null).length;
  if (job.count > M.LIMITS.relationUsers) {
    job.users = Object.fromEntries(Object.entries(job.users).slice(0, M.LIMITS.relationUsers)); job.count = M.LIMITS.relationUsers;
    await stopJob(job, `已达到 ${M.LIMITS.relationUsers} 个账号的本地扫描上限；本次不完整，保留历史`); return { jobStatus: 'partial' };
  }
  if (page.end === true) {
    if (!job.sawFirst || (Number.isFinite(job.expectedTotal) && job.count < job.expectedTotal)) {
      await stopJob(job, '未覆盖完整关注列表（可能存在不可见账号）；保留上次完整记录'); return { jobStatus: 'partial' };
    }
    job.complete = true; job.status = 'complete'; job.finishedAt = Date.now();
    job.note = `已读取到分页末尾；${job.unknown} 个账号关系未知，不计为未回关或取关`;
    M.applyRelations(data, job);
    M.fitStorage(data);
    await chrome.storage.local.set({ [DATA_KEY]: data, [JOB_KEY]: job });
  } else if (!job.nextCursor) await stopJob(job, '未找到下一页游标，无法确认完整；保留历史');
  else await storeJob(job);
  return { jobStatus: job.status, jobNote: job.note, jobCount: job.count };
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== 'string') return false;
  const fromPage = pageSender(sender), fromExtension = extensionSender(sender);
  if (!fromPage && !fromExtension) return false;
  const work = async () => {
    const type = message.type;
    if (type === 'get-settings') return XA_CONFIG.mergeSettings(await chrome.storage.local.get(XA_CONFIG.DEFAULTS));
    if (type === 'XA_CAPTURE' && fromPage) return capture(message, sender);
    if (type === 'XA_MANAGER_READY' && fromPage) {
      const job = await jobState();
      return { job: job?.status === 'running' && job.tabId === sender.tab.id && job.viewerId === M.id(message.viewer?.id) ?
        { id: job.id, viewerId: job.viewerId, handle: job.handle, startedAt: job.startedAt } : null };
    }
    if (type === 'XA_RELATION_HEARTBEAT' && fromPage) {
      const job = await jobState();
      if (!job || job.id !== message.jobId || job.tabId !== sender.tab.id) return { jobStatus: 'partial' };
      if (job.viewerId !== M.id(message.viewerId)) await stopJob(job, '账号已变化', 'error');
      else if (job.status === 'running' && Date.now() - (job.lastHeartbeatAt || 0) >= 15000) { job.lastHeartbeatAt = Date.now(); await storeJob(job); }
      return { jobStatus: job.status, jobNote: job.note, jobCount: job.count };
    }
    if (type === 'XA_RELATION_FINISH' && fromPage) {
      const job = await jobState();
      if (job?.id === message.jobId && job.tabId === sender.tab.id) await stopJob(job, String(message.note || '扫描中断').slice(0, 200));
      return { jobStatus: job?.status };
    }
    if (type === 'XA_RELATION_STOP' && (fromExtension || fromPage)) {
      const job = await jobState();
      if (job && (!message.jobId || message.jobId === job.id) && (fromExtension || job.tabId === sender.tab.id)) await stopJob(job, '已停止；部分结果仅作查看，未覆盖历史记录');
      return { ok: true };
    }
    if (!fromExtension) throw new Error('不支持此页面请求');
    if (type === 'XA_OPEN_MANAGER') {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`management.html#${message.view === 'trends' ? 'trends' : 'relationships'}`) }); return { ok: true };
    }
    if (type === 'XA_MANAGER_GET') {
      let job = await jobState();
      if (job?.status === 'running' && (Date.now() - job.startedAt > 31 * 60000 || Date.now() - (job.lastHeartbeatAt || job.startedAt) > 2 * 60000)) job = await stopJob(job, '扫描页面长时间未响应或任务已超过时限；结果不完整，未覆盖历史记录');
      const data = await state(); if (M.prune(data)) await chrome.storage.local.set({ [DATA_KEY]: data });
      return { data, job };
    }
    if (type === 'XA_MANAGER_TABS') return { tabs: await tabsWithViewer() };
    if (type === 'XA_RELATION_START') {
      const current = await jobState();
      if (current?.status === 'running') throw new Error('已有扫描任务，请先停止');
      const tabId = Number(message.tabId);
      const tab = await chrome.tabs.get(tabId);
      if (!/^https:\/\/(?:x\.com|twitter\.com)\//.test(tab.url || '')) throw new Error('请选择已登录 X 的页面');
      const page = await chrome.tabs.sendMessage(tabId, { type: 'XA_PAGE_STATUS' });
      const viewerId = M.id(page?.viewer?.id), handle = M.handle(page?.viewer?.handle);
      if (!viewerId || !handle || viewerId !== M.id(message.viewerId)) throw new Error('无法确认当前账号，请刷新 X 后重新读取账号');
      // A new own-following page ensures that a complete scan begins at the first page.
      const startedAt = Date.now();
      const scanTab = await chrome.tabs.create({ url: `https://x.com/${handle}/following`, active: true });
      const job = { id: crypto.randomUUID(), viewerId, handle, tabId: scanTab.id, startedAt, status: 'running',
        users: {}, count: 0, unknown: 0, sawFirst: false, complete: false, expectedTotal: null, note: '正在打开自己的关注页，只读滚动采集' };
      await storeJob(job);
      chrome.tabs.sendMessage(scanTab.id, { type: 'XA_RELATION_RUN', job }).catch(() => {});
      return { ok: true };
    }
    if (type === 'XA_MANAGER_REPLAY') {
      const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
      const result = await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'XA_MANAGER_REPLAY' }).then(() => true).catch(() => false)));
      return { pages: result.filter(Boolean).length };
    }
    if (type === 'XA_TARGET_ADD' || type === 'XA_TARGET_DELETE') {
      const data = await state();
      if (type === 'XA_TARGET_ADD') {
        const item = M.target(message.target);
        if (data.targets.some((old) => old.type === item.type && old.value === item.value)) throw new Error('已存在相同目标');
        if (data.targets.length >= M.LIMITS.targets) throw new Error(`最多保留 ${M.LIMITS.targets} 个目标`);
        data.targets.push(item);
      } else {
        data.targets = data.targets.filter((item) => item.id !== message.id);
        data.posts = data.posts.filter((post) => data.targets.some((item) => post.targetIds?.includes(item.id) || M.matches(post, item)));
        const ids = new Set(data.posts.map((post) => post.id)); data.snapshots = data.snapshots.filter((point) => ids.has(point.id));
      }
      await chrome.storage.local.set({ [DATA_KEY]: data }); return { ok: true };
    }
    if (type === 'XA_RELATION_IGNORE') {
      const data = await state(); const owner = data.relations[M.id(message.viewerId)]; const userId = M.id(message.userId);
      if (!owner || !owner.users.some((user) => user.id === userId)) throw new Error('找不到该账号记录');
      if (message.ignored) owner.ignored[userId] = true; else delete owner.ignored[userId];
      await chrome.storage.local.set({ [DATA_KEY]: data }); return { ok: true };
    }
    throw new Error('未知请求');
  };
  // Capture and storage mutations share one queue to avoid cross-tab lost updates.
  const readOnly = ['get-settings', 'XA_MANAGER_TABS', 'XA_MANAGER_READY', 'XA_MANAGER_REPLAY', 'XA_OPEN_MANAGER'];
  (readOnly.includes(message.type) ? work() : serial(work)).then(respond).catch((error) => respond({ error: error.message || '操作失败' }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serial(async () => { const job = await jobState(); if (job?.tabId === tabId) await stopJob(job, '扫描页面已关闭；本次不完整，未覆盖历史记录'); }).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status !== 'complete') return;
  jobState().then((job) => {
    if (job?.status === 'running' && job.tabId === tabId) chrome.tabs.sendMessage(tabId, { type: 'XA_RELATION_RUN', job }).catch(() => {});
  }).catch(() => {});
});
