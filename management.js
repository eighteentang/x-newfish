(function initManagementPage() {
  'use strict';
  const M = XA_MANAGEMENT;
  const $ = (id) => document.getElementById(id);
  let data = M.fresh(), job = null, tabs = [], relationRows = [], relationLost = {}, report = null, loading = false, refreshTimer;
  const fmt = (at) => Number.isFinite(at) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(at) : '暂无';
  const fullTime = (at) => Number.isFinite(at) ? new Date(at).toISOString() : '';
  const userUrl = (handle) => `https://x.com/${M.handle(handle)}`;
  function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
  function option(select, value, label) { const node = el('option', label); node.value = value; select.appendChild(node); }
  function link(text, url, className) { const node = el('a', text, className); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node; }
  function status(text, error = false) { $('status').textContent = text; $('status').className = `status${error ? ' error' : ''}`; }
  async function send(message) {
    const reply = await chrome.runtime.sendMessage(message);
    if (!reply) throw new Error('插件后台未响应，请重新加载扩展并刷新此页面');
    if (reply.error) throw new Error(reply.error);
    return reply;
  }
  const act = (work) => Promise.resolve().then(work).catch((error) => status(error.message || '操作失败', true));
  function empty(tbody, text, columns) { const row = el('tr'), cell = el('td', text, 'empty'); cell.colSpan = columns; row.appendChild(cell); tbody.appendChild(row); }

  function selectOptions(select, rows, placeholder) {
    const selected = select.value; select.replaceChildren();
    if (!rows.length) option(select, '', placeholder);
    else { rows.forEach(([value, title]) => option(select, value, title)); if (rows.some(([value]) => value === selected)) select.value = selected; }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const reply = await send({ type: 'XA_MANAGER_GET' }); data = reply.data; job = reply.job;
      render(); status('本机记录已载入；所有时间按北京时间显示。');
    } finally { loading = false; }
  }

  function view() {
    const trends = location.hash === '#trends';
    $('relationships-panel').hidden = trends; $('trends-panel').hidden = !trends;
    $('nav-relationships').toggleAttribute('aria-current', !trends); $('nav-trends').toggleAttribute('aria-current', trends);
    (trends ? $('nav-trends') : $('nav-relationships')).setAttribute('aria-current', 'page');
    $('page-kicker').textContent = trends ? 'OBSERVATIONS' : 'RELATIONSHIPS';
    $('page-title').textContent = trends ? '把讨论的变化看清楚' : '看清关注关系';
    $('page-description').textContent = trends ? '从你实际加载的内容中，观察关键词、账号和帖子的变化。' : '记录现在的互关，观察之后的变化。';
  }

  function render() {
    view();
    const owners = Object.entries(data.relations).map(([id, value]) => [id, `@${value.handle} · ${fmt(value.lastScanAt)}`]);
    if (job && !owners.some(([id]) => id === job.viewerId)) owners.push([job.viewerId, `@${job.handle} · 当前扫描`]);
    selectOptions($('relation-owner'), owners, '暂无完整记录');
    selectOptions($('active-target'), data.targets.map((item) => [item.id, `${{ keyword: '关键词', account: '账号', post: '帖子' }[item.type]} · ${item.value}`]), '请先添加目标');
    $('stop-scan').disabled = job?.status !== 'running'; $('start-scan').disabled = job?.status === 'running';
    const progress = $('scan-progress'); progress.className = `notice job-${job?.status || 'idle'}`;
    progress.textContent = job ? `@${job.handle} · ${{ running: '扫描中', complete: '已到分页末尾', partial: '部分结果', error: '已停止' }[job.status] || job.status} · 已读取 ${job.count || 0}${Number.isFinite(job.expectedTotal) ? ` / ${job.expectedTotal}` : ''} 个账号。${job.note || ''}` : '首次扫描建立基线，不能追溯安装前的取关历史。';
    renderRelations(); renderTrends();
  }

  function relationLabel(user, lost) {
    if (user.restriction) return `账号受限 / ${user.restriction}`;
    if (user.followedBy === null) return '关系未知';
    if (user.followedBy === true) return '互关';
    return lost ? '发现取关' : '未回关';
  }

  function renderRelations() {
    const ownerId = $('relation-owner').value, owner = data.relations[ownerId];
    const partial = $('show-partial').checked && job?.viewerId === ownerId && job.status !== 'complete';
    const source = partial ? Object.values(job.users || {}) : owner?.users || [];
    const ignored = owner?.ignored || {}, lost = partial ? {} : owner?.lost || {};
    relationLost = lost;
    const query = $('relation-search').value.trim().toLocaleLowerCase(), kind = $('relation-kind').value;
    relationRows = source.filter((user) => {
      if (!$('show-ignored').checked && ignored[user.id]) return false;
      if ($('only-blue').checked && !user.blue) return false;
      if (query && !`${user.name} @${user.handle}`.toLocaleLowerCase().includes(query)) return false;
      if (kind === 'lost') return Boolean(lost[user.id]) && user.followedBy === false && !user.restriction;
      if (kind === 'unknown') return user.followedBy === null || Boolean(user.restriction);
      if (kind === 'nonfollowback') return user.followedBy === false && !user.restriction;
      return true;
    }).sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1));
    $('relation-summary').textContent = partial ? `来源：本次部分扫描，${source.length} 个账号；不能用于判定取关。筛选后 ${relationRows.length} 条。` :
      owner ? `来源：${fmt(owner.lastScanAt)} 的完整分页记录，共 ${source.length} 个账号，筛选后 ${relationRows.length} 条。首次基线 ${fmt(owner.firstScanAt)}。` : '还没有完整记录。扫描失败或中断不会替换已有记录，可勾选“查看最近部分扫描”。';
    const body = $('relation-rows'); body.replaceChildren();
    relationRows.slice(0, 100).forEach((user) => {
      const row = el('tr'), name = el('td'); name.append(link(user.name || `@${user.handle}`, userUrl(user.handle)), el('small', `@${user.handle}${user.blue ? ' · 蓝 V' : ''}${ignored[user.id] ? ' · 已忽略' : ''}`));
      row.append(name, el('td', relationLabel(user, lost[user.id])), el('td', Number.isFinite(user.followers) ? user.followers.toLocaleString() : '未知'), el('td', lost[user.id] ? fmt(lost[user.id].detectedAt) : '—'));
      const actions = el('td'); actions.appendChild(link('主页 ↗', userUrl(user.handle)));
      if (!partial && owner) { const button = el('button', ignored[user.id] ? '取消忽略' : '忽略'); button.type = 'button'; button.addEventListener('click', () => act(async () => { await send({ type: 'XA_RELATION_IGNORE', viewerId: ownerId, userId: user.id, ignored: !ignored[user.id] }); await refresh(); })); actions.append(' ', button); }
      row.appendChild(actions); body.appendChild(row);
    });
    if (!relationRows.length) empty(body, partial && kind === 'lost' ? '部分扫描无法判定取关，请等待完整扫描。' : '暂无符合条件的账号。', 5);
    if (relationRows.length > 100) { const row = el('tr'), cell = el('td', '仅展示前 100 条；CSV 可导出全部筛选结果。', 'hint'); cell.colSpan = 5; row.appendChild(cell); body.appendChild(row); }
  }

  function currentTarget() { return data.targets.find((item) => item.id === $('active-target').value); }
  function stat(label, value, note) { const card = el('div', undefined, 'stat'); card.append(el('span', label), el('b', value), el('small', note)); return card; }
  function postUrl(post) { return post.author ? `https://x.com/${post.author}/status/${post.id}` : `https://x.com/i/web/status/${post.id}`; }
  function renderTrends() {
    const item = currentTarget(), body = $('trend-rows'); body.replaceChildren(); $('trend-stats').replaceChildren(); $('trend-chart').replaceChildren();
    for (const id of ['open-search', 'capture-loaded', 'delete-target', 'export-trends']) $(id).disabled = !item;
    $('storage-summary').textContent = `本机保留最近 7 天，最多 ${M.LIMITS.posts} 条匹配帖子、${M.LIMITS.snapshots} 个按小时快照；摘要最多 1500 字。容量淘汰累计 ${data.dropped || 0} 条。没有全站覆盖保证。`;
    if (!item) {
      report = null; $('trend-summary').textContent = '添加一个监测目标，然后打开 X 搜索并滚动加载内容。';
      $('trend-comparison').textContent = ''; $('snapshot-summary').textContent = ''; $('follower-summary').textContent = '';
      $('trend-chart').appendChild(el('span', '尚无采集数据', 'chart-empty')); empty(body, '暂无记录。', 4); return;
    }
    report = M.trend(data, item, $('trend-window').value);
    const r = report;
    $('trend-summary').textContent = `${fmt(r.start)} — ${fmt(r.end)} · 最近一次采集 ${fmt(r.lastSeenAt)} · 本窗口采集到 ${r.events.length} 条匹配内容；采集覆盖不完整。`;
    $('trend-stats').append(stat('采集到的讨论帖', r.counts.discussion, '原创 + 回复 + 引用，排除纯转发'), stat('去重讨论参与者', r.participants, `按用户 ID；${r.unknownAuthors} 条作者 ID 缺失`),
      stat('引用帖', r.counts.quotes, '依据引用帖发布时间'), stat('回复帖', r.counts.replies, '依据回复发布时间'), stat('转发事件', r.counts.reposts, '仅有明确发布时间的转发帖子'), stat('去重转发者', r.reposters, '仅统计采集事件中可确认的用户 ID'));
    const max = Math.max(1, ...r.buckets.map((bucket) => bucket.discussion || 0));
    r.buckets.forEach((bucket) => { const slot = el('div', undefined, 'chart-slot'); slot.title = `${fmt(bucket.at)} · ${bucket.discussion === null ? '未采集到讨论数据，不能视作零' : `采集到 ${bucket.discussion} 条讨论`}`;
      const bar = el('div', undefined, bucket.discussion === null ? 'chart-missing' : 'chart-bar'); if (bucket.discussion !== null) bar.style.height = `${Math.max(3, bucket.discussion / max * 100)}%`; slot.appendChild(bar); $('trend-chart').appendChild(slot); });
    $('trend-comparison').textContent = `上一个等长窗口采集到 ${r.previousObserved} 条讨论；两个窗口覆盖可能不同，不计算全站涨跌幅。空白小时表示缺失，不是零。`;
    $('snapshot-summary').textContent = r.netReposts === null ? '转发累计净变化：暂无可比端点快照，无法事后还原。' :
      `转发累计净变化：${r.netReposts >= 0 ? '+' : ''}${r.netReposts}；可比原帖 ${r.deltas.length}/${r.totalOriginals}，各帖实际快照区间 ${fmt(Math.min(...r.deltas.map((p) => p.from)))} — ${fmt(Math.max(...r.deltas.map((p) => p.to)))}。不是期间转发次数或人数。`;
    const owner = item.type === 'account' ? Object.entries(data.relations).find(([, value]) => value.handle === item.value) : null;
    const points = owner ? data.followers.filter((point) => point.id === owner[0]).sort((a, b) => a.at - b.at) : [];
    const before = points.filter((point) => point.at <= r.start).at(-1), after = points.filter((point) => point.at <= r.end).at(-1);
    $('follower-summary').textContent = before && after && after.at > before.at ? `账号粉丝数净变化：${after.count - before.count}（${fmt(before.at)} — ${fmt(after.at)}），不能归因于某个关键词或帖子。` : '粉丝数净变化：需要本人账号的可比快照；当前没有足够数据，且不做帖子归因。';
    r.events.slice(0, 100).forEach((post) => { const row = el('tr'), cell = el('td'); cell.append(link(post.text || '查看原帖', postUrl(post), 'excerpt'), el('small', `@${post.author || '未知作者'}${post.textTruncated ? ' · 摘要已截短' : ''}`));
      row.append(cell, el('td', post.isRepost ? '转发事件' : post.quoteId ? '引用' : post.replyToId ? '回复' : '原创 / 提及'), el('td', fmt(post.createdAt)), el('td', fmt(post.observedAt))); body.appendChild(row); });
    if (!r.events.length) empty(body, '尚未采集到本时间窗口的匹配内容。没有数据不代表无人讨论。', 4);
  }

  function exportCsv(name, rows) {
    const csv = '\uFEFF' + rows.map((row) => row.map((value) => { let text = String(value ?? ''); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""')}"`; }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const anchor = el('a'); anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('read-accounts').addEventListener('click', () => act(async () => { tabs = (await send({ type: 'XA_MANAGER_TABS' })).tabs.filter((tab) => tab.ready);
    selectOptions($('x-tab'), tabs.map((tab) => [String(tab.tabId), `@${tab.viewer.handle}${tab.active ? ' · 当前页面' : ''}`]), '未找到可读取的已登录 X 页面'); status(tabs.length ? '账号已读取，请选择要扫描的账号。' : '先打开并登录 X，重新加载扩展，再刷新 X 页面。', !tabs.length); }));
  $('start-scan').addEventListener('click', () => act(async () => { const tab = tabs.find((item) => String(item.tabId) === $('x-tab').value); if (!tab) throw new Error('请先读取并选择 X 账号'); await send({ type: 'XA_RELATION_START', tabId: tab.tabId, viewerId: tab.viewer.id }); await refresh(); }));
  $('stop-scan').addEventListener('click', () => act(async () => { await send({ type: 'XA_RELATION_STOP', jobId: job?.id }); await refresh(); }));
  $('target-form').addEventListener('submit', (event) => { event.preventDefault(); act(async () => { await send({ type: 'XA_TARGET_ADD', target: { type: $('target-type').value, value: $('target-value').value } }); $('target-value').value = ''; await refresh(); $('active-target').value = data.targets.at(-1).id; renderTrends(); status('目标已添加。打开 X 搜索并滚动，或读取已加载页面。'); }); });
  $('open-search').addEventListener('click', () => { const item = currentTarget(); if (item) chrome.tabs.create({ url: M.searchUrl(item) }).catch((error) => status(error.message, true)); });
  $('capture-loaded').addEventListener('click', () => act(async () => { const reply = await send({ type: 'XA_MANAGER_REPLAY' }); await refresh(); status(`已请求读取 ${reply.pages} 个 X 页面已加载的结果；未额外搜索全站。`); }));
  $('delete-target').addEventListener('click', () => { const item = currentTarget(); if (!item || !confirm('删除这个监测目标及仅属于它的本机采集记录？')) return; act(async () => { await send({ type: 'XA_TARGET_DELETE', id: item.id }); await refresh(); }); });
  $('export-relations').addEventListener('click', () => exportCsv('x-newfish-relationships.csv', [['用户名', '名字', '关系', '粉丝数', '发现时间', '数据范围'], ...relationRows.map((user) => [user.handle, user.name, relationLabel(user, relationLost[user.id]), user.followers ?? '未知', fullTime(relationLost[user.id]?.detectedAt), $('relation-summary').textContent])]));
  $('export-trends').addEventListener('click', () => { if (report) exportCsv('x-newfish-observations.csv', [['帖子ID', '作者', '作者ID', '类型', '正文摘要', '发布时间UTC', '采集时间UTC', '原帖', '范围'], ...report.events.map((post) => [post.id, post.author, post.authorId, post.isRepost ? '转发事件' : post.quoteId ? '引用' : post.replyToId ? '回复' : '原创/提及', post.text, fullTime(post.createdAt), fullTime(post.observedAt), postUrl(post), '网页已采集样本，非全站总量'])]); });
  for (const id of ['relation-owner', 'relation-kind', 'only-blue', 'show-ignored', 'show-partial']) $(id).addEventListener('change', renderRelations);
  $('relation-search').addEventListener('input', renderRelations);
  for (const id of ['active-target', 'trend-window']) $(id).addEventListener('change', renderTrends);
  $('refresh').addEventListener('click', () => act(refresh)); window.addEventListener('hashchange', view);
  chrome.storage.onChanged.addListener((changes, area) => { if (area !== 'local' || (!changes.xaManagerData && !changes.xaRelationJob)) return; clearTimeout(refreshTimer); refreshTimer = setTimeout(() => act(refresh), 200); });
  act(refresh);
})();
