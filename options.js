(function initOptions() {
  const globalKeys = ['enabled', 'showVelocity', 'aiLabelsEnabled', 'accountWarningsEnabled', 'leaderboardEnabled', 'leaderboardOpacity', 'leaderboardCollapsed', 'leaderboardSort', 'leaderboardHours', 'leaderboardLimit', 'whitelist'];
  const checks = new Set(['enabled', 'showVelocity', 'aiLabelsEnabled', 'accountWarningsEnabled', 'leaderboardEnabled', 'leaderboardCollapsed', 'inheritGlobal', 'filteringEnabled', 'keywordFilterEnabled', 'languageFilterEnabled', 'velocityFilterEnabled']);
  const field = (id) => document.querySelector(`#${id}`);
  let settings = XA_CONFIG.mergeSettings({});
  let scope = 'global';
  let ready = false;
  let revision = 0;
  let pendingWrites = 0;
  let writeQueue = Promise.resolve();

  function setStatus(text, error = false) {
    field('status').textContent = text;
    field('status').dataset.state = error ? 'error' : 'saved';
  }
  function readValue(key) { return checks.has(key) ? field(key).checked : field(key).value; }
  function showValue(key, value) {
    if (checks.has(key)) field(key).checked = value;
    else field(key).value = Array.isArray(value) ? value.map((item) => ['whitelist', 'blockedAccounts'].includes(key) ? `@${item}` : item).join('\n') : value;
  }
  function renderSummary() {
    field('powerState').textContent = settings.enabled ? '运行中' : '已暂停';
    field('keywordCount').textContent = settings.keywords.length;
    field('accountCount').textContent = settings.blockedAccounts.length;
    field('domainCount').textContent = settings.blockedDomains.length;
    field('leaderboardOpacityValue').textContent = `${Math.round(Number(field('leaderboardOpacity').value) * 100)}%`;
    field('globalSummary').textContent = `${Object.keys(settings.pageFilters).length} 个页面独立配置。${settings.filteringEnabled ? '其余跟随全局规则。' : '全局过滤已关闭。'}白名单始终保留。`;
  }
  function updateRuleVisibility() {
    const inherited = scope !== 'global' && field('inheritGlobal').checked;
    field('filterFields').disabled = inherited;
    field('scopeBadge').textContent = scope === 'global' ? '全局默认' : inherited ? '跟随全局' : '自定义';
    field('keywordField').hidden = !field('keywordFilterEnabled').checked;
    field('languageFields').hidden = !field('languageFilterEnabled').checked;
    field('velocityField').hidden = !field('velocityFilterEnabled').checked;
  }
  function renderRules() {
    const rules = XA_CONFIG.forPage(settings, scope);
    XA_CONFIG.FILTER_KEYS.forEach((key) => showValue(key, rules[key]));
    field('inheritRow').hidden = scope === 'global';
    field('inheritGlobal').checked = scope !== 'global' && !settings.pageFilters[scope];
    updateRuleVisibility();
  }
  function showTab(name, focus = false) {
    for (const key of ['common', 'filters', 'board']) {
      const tab = field(`tab-${key}`);
      tab.setAttribute('aria-selected', String(key === name));
      tab.tabIndex = key === name ? 0 : -1;
      field(`panel-${key}`).hidden = key !== name;
    }
    document.querySelector('.panels').scrollTop = 0;
    if (focus) field(`tab-${name}`).focus();
  }
  async function applyToPages() {
    if (!chrome.tabs?.query) return '已保存到本机';
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    if (!tabs.length) return '已保存，打开 X 页面后生效。';
    const replies = await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'XA_SETTINGS_APPLY' }).catch(() => null)));
    if (replies.some((reply) => !reply?.ready)) return '已保存；部分 X 页面未响应。请重新加载 X-Newfish，再刷新 X。';
    const sum = (key) => replies.reduce((total, reply) => total + reply[key], 0);
    return `已生效：检测到 ${sum('total')} 条帖子，已过滤 ${sum('hidden')} 条；${sum('velocity')} 条有流速，${sum('language')} 条有语言信息。`;
  }
  function validateHandles(value) {
    return XA_CONFIG.normalizeKeywords(value).every((item) => XA_CONFIG.normalizeHandles([item]).length);
  }
  function save(changedKey) {
    if (!ready) return;
    const ownRevision = ++revision;
    const selectedScope = scope;
    const inherited = selectedScope !== 'global' && field('inheritGlobal').checked;
    const globals = Object.fromEntries(globalKeys.map((key) => [key, readValue(key)]));
    const rawRules = Object.fromEntries(XA_CONFIG.FILTER_KEYS.map((key) => [key, readValue(key)]));
    const rules = XA_CONFIG.filterValues(rawRules);
    const isGlobalChange = globalKeys.includes(changedKey);
    const savingRules = !isGlobalChange && !inherited;
    updateRuleVisibility();
    if (savingRules && rules.filteringEnabled && rules.languageFilterEnabled && !rules.allowedLanguages.length) {
      setStatus('请至少填写一种有效语言代码，例如 zh 或 en。', true); return;
    }
    if (savingRules && (!validateHandles(rawRules.blockedAccounts) || !XA_CONFIG.normalizeKeywords(rawRules.blockedDomains).every((item) => XA_CONFIG.normalizeDomains([item]).length))) {
      setStatus('请检查屏蔽规则：账号使用 @用户名，域名使用 example.com。', true); return;
    }
    if ((!changedKey || changedKey === 'whitelist') && !validateHandles(globals.whitelist)) {
      setStatus('白名单账号格式有误，请使用 @用户名。', true); return;
    }
    pendingWrites++;
    setStatus('正在保存…');
    const write = writeQueue.catch(() => {}).then(async () => {
      const latest = XA_CONFIG.mergeSettings(await chrome.storage.local.get(XA_CONFIG.DEFAULTS));
      const patch = isGlobalChange ? { [changedKey]: globals[changedKey] } : !changedKey ? { ...globals } : {};
      if (!isGlobalChange) {
        if (selectedScope === 'global') Object.assign(patch, changedKey ? { [changedKey]: rules[changedKey] } : rules);
        else {
          const pages = { ...latest.pageFilters };
          if (inherited) delete pages[selectedScope]; else pages[selectedScope] = rules;
          patch.pageFilters = pages;
        }
      }
      const normalized = XA_CONFIG.mergeSettings({ ...latest, ...patch });
      const editable = Object.fromEntries(Object.keys(patch).map((key) => [key, normalized[key]]));
      await chrome.storage.local.set(editable);
      settings = normalized;
      renderSummary();
    });
    writeQueue = write;
    write.then(applyToPages).then((message) => {
      if (ownRevision === revision) setStatus(message);
    }).catch(() => {
      if (ownRevision === revision) setStatus('保存或应用失败，请重试。', true);
    }).finally(() => { pendingWrites--; });
  }

  chrome.storage.local.get(XA_CONFIG.DEFAULTS).then((stored) => {
    settings = XA_CONFIG.mergeSettings(stored);
    globalKeys.forEach((key) => showValue(key, settings[key]));
    renderRules(); renderSummary();
    ready = true; document.body.setAttribute('aria-busy', 'false');
    field('version').textContent = `v${chrome.runtime?.getManifest?.().version || '0.1.5'}`;
    setStatus('设置已载入 · 仅保存在本机');
  }).catch(() => setStatus('无法读取设置，请重新打开插件。', true));
  field('save').addEventListener('click', () => save());
  [...globalKeys, ...XA_CONFIG.FILTER_KEYS, 'inheritGlobal'].forEach((key) => field(key).addEventListener('change', () => save(key)));
  field('filterScope').addEventListener('change', () => { scope = field('filterScope').value; renderRules(); });
  field('leaderboardOpacity').addEventListener('input', () => {
    field('leaderboardOpacityValue').textContent = `${Math.round(Number(field('leaderboardOpacity').value) * 100)}%`;
    save('leaderboardOpacity');
  });
  for (const [index, name] of ['common', 'filters', 'board'].entries()) {
    const tab = field(`tab-${name}`);
    tab.addEventListener('click', () => showTab(name));
    tab.addEventListener('keydown', (event) => {
      const keys = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 };
      if (!(event.key in keys)) return;
      event.preventDefault(); showTab(['common', 'filters', 'board'][keys[event.key]], true);
    });
  }
  field('openFilters').addEventListener('click', () => showTab('filters', true));
  document.querySelectorAll('[data-languages]').forEach((button) => button.addEventListener('click', () => {
    field('allowedLanguages').value = button.dataset.languages;
    field('languageFilterEnabled').checked = true;
    // Both the switch and the language list are saved together.
    save();
  }));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    settings = XA_CONFIG.mergeSettings({ ...settings, ...Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])) });
    if (!pendingWrites) {
      globalKeys.filter((key) => changes[key] && document.activeElement !== field(key)).forEach((key) => showValue(key, settings[key]));
      const editingRule = XA_CONFIG.FILTER_KEYS.some((key) => document.activeElement === field(key));
      if (!editingRule && (changes.pageFilters || XA_CONFIG.FILTER_KEYS.some((key) => changes[key]))) renderRules();
    }
    renderSummary();
  });
})();
