(function initAccountSignals(global) {
  const RESTRICTED = { fake_account: 'X 返回账号真实性受限提示', timeout: 'X 返回账号暂时受限提示', suspended: 'X 返回账号停用提示' };

  function normalizeAccount(user) {
    if (user?.__typename === 'UserWithVisibilityResults') user = user.user;
    if (!user || typeof user !== 'object') return {};
    const out = {};
    const id = String(user.rest_id || user.legacy?.id_str || '');
    if (/^\d+$/.test(id)) out.id = id;
    const bio = user.profile_bio?.description ?? user.legacy?.description;
    if (typeof bio === 'string') out.bio = bio.slice(0, 2000);
    const label = user.affiliates_highlighted_label?.label?.userLabelType;
    if (['AutomatedLabel', 'Automated'].includes(label)) out.automated = true;
    else if (user.affiliates_highlighted_label && Object.hasOwn(user.affiliates_highlighted_label, 'label')) out.automated = false;
    const restriction = user.profile_metadata?.profile_interstitial_type;
    if (typeof restriction === 'string') out.restriction = restriction;
    if (user.__typename === 'UserUnavailable' && user.reason === 'Suspended') out.restriction = 'suspended';
    if (Object.keys(out).length) out.observedAt = Date.now();
    return out;
  }

  function unquoted(value) {
    return String(value || '').slice(0, 20000)
      .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g, ' [引用已省略] ')
      .split(/\n/).filter((line) => !/^\s*>/.test(line)).join('\n');
  }

  function statements(value) {
    return (unquoted(value).match(/[^\n。！？!?；;]+[。！？!?；;]?/g) || [])
      .map((part) => part.trim())
      .filter((part) => !/[？?]$/.test(part) && !/(?:并非|不是|并未|没有|未使用|不使用|是否|是不是|\bnot\b|\bnever\b|\bwithout\b|\b(?:isn|wasn|don|doesn|didn)['’]t\b)/i.test(part));
  }

  function classify({ account = {}, text = '' } = {}) {
    const ai = [];
    const warning = [];
    if (account.automated === true) ai.push('账号：X 自动化标签；自动化不一定使用生成式 AI');
    const bioClauses = statements(account.bio);
    if (bioClauses.some((part) =>
      /^(?:本账号|本帐号|本号|此账号|这个账号)(?:(?:是|为)(?:一个)?(?:自动化账号|自动回复机器人|机器人)|由(?:机器人|自动化程序)(?:自动)?(?:运营|管理|回复))(?:[，。；,.]|$)/.test(part) ||
      /^(?:I am|I'm|this (?:account|bot) is)\s+(?:an?\s+)?(?:automated (?:account|bot)|bot)(?:[.,;|]|$)/i.test(part)
    )) ai.push('账号：简介明确自述为自动化机器人；自动化不一定使用生成式 AI');
    if (bioClauses.some((part) =>
      /^(?:本账号|本帐号|本号|此账号|这个账号)(?:是|为)?(?:由|使用|采用|基于)\s*(?:AI|LLM|GPT(?:-?\d[\w.-]*)?|ChatGPT|Claude|Gemini|Grok|DeepSeek|人工智能|大语言模型)(?:\s*(?:模型|技术))?\s*(?:自动|驱动|运营|运行|生成|管理|回复)/i.test(part) ||
      /^(?:(?:an?\s+)?(?:AI|LLM|GPT)[ -](?:powered|driven|generated)\s+(?:bot|account|agent|assistant)|(?:this\s+)?(?:account|bot)\s+(?:is\s+)?(?:powered|run|operated)\s+by\s+(?:AI|LLM|GPT|ChatGPT|Claude|Gemini|Grok|DeepSeek)\b)/i.test(part) ||
      /^(?:(?:I am|I'm)\s+)?(?:an?\s+)?(?:AI|LLM)[ -](?:bot|agent|assistant)(?:[.,;|，。·]|$)/i.test(part) ||
      /^(?:我是|这是|本号是)(?:一个|一名)?\s*(?:AI|人工智能)(?:机器人|助手|代理)(?:[，。；、]|$)/i.test(part)
    )) ai.push('账号：简介明确自述由 AI 自动运营；本地规则未核实自述真实性');

    const clauses = statements(text);
    if (clauses.some((part) =>
      /^(?:本文|本帖|本条推文|这条推文|这条帖子|这条回复|本回复|这段文字|以上内容)(?:内容)?(?:是)?(?:由|使用|采用|经过)\s*(?:AI|LLM|GPT(?:-?\d[\w.-]*)?|ChatGPT|Claude|Gemini|Grok|DeepSeek|人工智能|大语言模型)\s*(?:辅助)?\s*(?:生成|撰写|写作|改写|润色|翻译)(?:[，。；,;：:]|$)/i.test(part) ||
      /^(?:this\s+(?:post|tweet|reply|text|content)|the\s+above)(?:\s+was|\s+is)?\s+(?:AI[ -](?:generated|written|assisted|translated)|(?:generated|written|rewritten|translated|polished)\s+(?:with|by|using)\s+(?:AI|ChatGPT|Claude|Gemini|Grok|DeepSeek))(?:[.,;:，。；]|$)/i.test(part)
    )) ai.push('本帖：正文明确声明使用 AI 生成、修改或翻译；仅针对当前帖子');
    if (clauses.some((part) => /^(?:作为(?:一个|一名)?\s*(?:AI|人工智能)(?:语言模型|助手)[，,:：]|as an? (?:AI language model|large language model)\s*[,.:])/i.test(part))) {
      ai.push('本帖：出现模型自述式残留；可能是 AI 内容，仅针对当前帖子');
    }
    if (Object.hasOwn(RESTRICTED, account.restriction)) warning.push(`账号：${RESTRICTED[account.restriction]}（${account.restriction}）；不代表恶意账号`);
    return { ai, warning };
  }

  const api = Object.freeze({ normalizeAccount, classify });
  global.XA_ACCOUNT_SIGNALS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
