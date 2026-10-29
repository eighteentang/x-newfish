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
      .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|(?:^|\s)'[^'\n]+'(?=\s|[.,;!?]|$)/g, ' [引用已省略] ')
      .split(/\n/).filter((line) => !/^\s*>/.test(line)).join('\n');
  }

  function statements(value) {
    return (unquoted(value).match(/[^\n。！？!?；;]+[。！？!?；;]?/g) || [])
      .map((part) => part.trim())
      .filter((part) => !/[？?]$/.test(part) &&
        !/(?:[吗么]|是吗|对吗|真的吗)(?:\s*[，,。.!！、]|\s*$)/.test(part) &&
        !/(?:,\s*|\s+)(?:right|correct|really|is that (?:true|correct)|is it)[.!]?\s*$/i.test(part) &&
        !/(?:说法|声明|断言|判断|结论|消息|传言|指控)[^，,。.!！\n]{0,12}(?:假|错误|不实|不正确|不成立|谣言)/.test(part) &&
        !/\b(?:that|this|it|the|such)\s+(?:(?:claim|statement|assertion|allegation)\s+)?(?:is|was)\s+(?:false|untrue|incorrect|wrong|a lie)\b/i.test(part) &&
        !/(?:并非|不是|并未|没有|未使用|不使用|不由|并不|并没有|未经过|未采用|未由|非AI|非人工智能|否认|是否|是不是|难道|难不成|\bnot\b|\bnever\b|\bwithout\b|\b(?:isn|wasn|aren|weren|don|doesn|didn|hasn|haven)['’]t\b)/i.test(part));
  }

  // Samples are observations from this account, not declarations about the current post.
  function observations(samples) {
    const seen = new Set();
    return (Array.isArray(samples) ? samples : []).slice(-200).filter((sample) => {
      if (!sample || sample.isRepost || !sample.id || typeof sample.text !== 'string' || !sample.text.trim()) return false;
      const id = String(sample.id);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function classify({ account = {}, text = '', samples = [] } = {}) {
    account = account && typeof account === 'object' ? account : {};
    const evidence = [];
    const warning = [];
    const add = (code, scope, points, reason) => evidence.push({ code, scope, points, reason });
    if (account.automated === true) add('platform_automated', 'account', 85, '账号：X 自动化标签；自动化不一定使用生成式 AI');
    const bioClauses = statements(account.bio);
    if (bioClauses.some((part) =>
      /^(?:本账号|本帐号|本号|此账号|这个账号)(?:(?:是|为)(?:一个)?(?:自动化账号|自动回复机器人|机器人)|由(?:机器人|自动化程序)(?:自动)?(?:运营|管理|回复))(?:[，。；,.]|$)/.test(part) ||
      /^(?:I am|I'm|this (?:account|bot) is)\s+(?:an?\s+)?(?:automated (?:account|bot)|bot)(?:[.,;|]|$)/i.test(part)
    )) add('bio_bot', 'account', 80, '账号：简介明确自述为自动化机器人；自动化不一定使用生成式 AI');
    if (bioClauses.some((part) =>
      /^(?:本账号|本帐号|本号|此账号|这个账号)(?:是|为)?(?:由|使用|采用|基于)\s*(?:AI|LLM|GPT(?:-?\d[\w.-]*)?|ChatGPT|Claude|Gemini|Grok|DeepSeek|人工智能|大语言模型)(?:\s*(?:模型|技术))?\s*(?:自动)?(?:驱动|运营|运行|生成|管理|回复)(?:[，。；,.]|$)/i.test(part) ||
      /^(?:(?:an?\s+)?(?:AI|LLM|GPT)[ -](?:powered|driven|generated)\s+(?:bot|account|agent|assistant)|(?:this\s+)?(?:account|bot)\s+(?:is\s+)?(?:powered|run|operated)\s+by\s+(?:AI|LLM|GPT|ChatGPT|Claude|Gemini|Grok|DeepSeek))(?:[.,;|，。·]|$)/i.test(part) ||
      /^(?:(?:I am|I'm)\s+)?(?:an?\s+)?(?:AI|LLM)[ -](?:bot|agent|assistant)(?:[.,;|，。·]|$)/i.test(part) ||
      /^(?:我是|这是|本号是)(?:一个|一名)?\s*(?:AI|人工智能)(?:机器人|助手|代理)(?:[，。；、]|$)/i.test(part)
    )) add('bio_ai_operated', 'account', 90, '账号：简介明确自述由 AI 自动运营；本地规则未核实自述真实性');

    const clauses = statements(text);
    const models = '(?:AI|LLM|GPT(?:-?\\d[\\w.-]*)?|ChatGPT|Claude|Gemini|Grok|DeepSeek|人工智能|大语言模型)';
    const subject = '(?:本文|本帖|本条推文|这条推文|这条帖子|这条回复|本回复|这段文字|以上内容)(?:内容)?(?:是)?(?:由|使用|采用|经过)\\s*';
    const end = '(?:[，。；,;：:]|$)';
    const generatedZh = new RegExp('^' + subject + models + '\\s*(?:生成|撰写|写作)' + end, 'i');
    const assistedZh = new RegExp('^' + subject + models + '\\s*(?:辅助\\s*(?:生成|撰写|写作|改写|润色|翻译)|改写|润色|翻译)' + end, 'i');
    const englishSubject = '^(?:this\\s+(?:post|tweet|reply|text|content)|the\\s+above)(?:\\s+was|\\s+is)?\\s+';
    const generatedEn = new RegExp(englishSubject + '(?:AI[ -](?:generated|written)|(?:generated|written)\\s+(?:with|by|using)\\s*' + models + ')' + end, 'i');
    const assistedEn = new RegExp(englishSubject + '(?:AI[ -](?:assisted|translated|polished)|(?:rewritten|translated|polished)\\s+(?:with|by|using)\\s*' + models + ')' + end, 'i');
    if (clauses.some((part) => generatedZh.test(part) || generatedEn.test(part))) {
      add('post_ai_generated', 'post', 90, '本帖：正文明确声明使用 AI 生成或撰写；仅针对当前帖子');
    }
    if (clauses.some((part) => assistedZh.test(part) || assistedEn.test(part))) {
      add('post_ai_assisted', 'post', 85, '本帖：正文明确声明使用 AI 辅助、修改或翻译；不代表全文由 AI 生成');
    }
    if (clauses.some((part) => /^(?:(?:作为|我是)(?:一个|一名)?\s*(?:AI|人工智能)(?:语言模型|助手)(?:[，,:：。.]|$)|(?:as an?|I am an?|I'm an?) (?:AI language model|large language model)\s*(?:[,.:]|$))/i.test(part))) {
      add('post_model_identity', 'post', 80, '本帖：出现完整模型身份自述式残留；可能是 AI 内容，仅针对当前帖子');
    }

    const observed = observations(samples);
    const eligible = observed.map((sample) => ({ ...sample, normalized: unquoted(sample.text).replace(/\s+/g, ' ').trim().toLowerCase() }))
      .filter((sample) => Array.from(sample.normalized.replace(/\[引用已省略\]/g, '')).length >= 20);
    let repetition = 0;
    if (eligible.length >= 10) {
      const groups = new Map();
      for (const sample of eligible) {
        const group = groups.get(sample.normalized) || [];
        group.push(sample);
        groups.set(sample.normalized, group);
      }
      const repeats = [...groups.values()].filter((group) => group.length >= 5 && group.length / eligible.length >= 0.5);
      if (repeats.length) repetition = 20;
      if (repeats.some((group) => new Set(group.filter((sample) => sample.replyToId).map((sample) => String(sample.replyToId))).size >= 5)) repetition = 30;
      if (repetition) add('observed_repetition', 'observation', repetition, `已观察 ${eligible.length} 条至少20字符的原创/回复；同文至少5条且占比至少50%${repetition === 30 ? '，涉及至少5个不同被回复帖子' : ''}；重复与跨讨论线索合并计分，无法证明无人值守`);
    }
    const timestamps = [...new Set(observed.map((sample) => {
      if (sample.createdAt === null || sample.createdAt === undefined || sample.createdAt === '') return NaN;
      return typeof sample.createdAt === 'number' ? sample.createdAt : Date.parse(sample.createdAt);
    }).filter(Number.isFinite))].sort((a, b) => a - b);
    if (timestamps.length >= 20 && timestamps.at(-1) - timestamps[0] >= 6 * 3600000) {
      const intervals = timestamps.slice(1).map((time, index) => time - timestamps[index]);
      const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
      const deviation = Math.sqrt(intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length);
      if (Math.min(...intervals) >= 60000 && deviation / mean <= 0.15) {
        add('observed_regular_timing', 'observation', 10, '至少20个不同发帖时间且跨度至少6小时；间隔变异系数≤0.15，仅是弱时间线索，定时发布也可能出现');
      }
    }
    // Only explicit protocol residue counts. Lists, polished prose, job titles and follower counts do not.
    const residue = clauses.join('\n').match(/<\|(?:im_start|im_end|assistant|endoftext|eot_id|start_header_id|end_header_id)\|>|\[\/?INST\]/g) || [];
    if (residue.length) add('post_protocol_residue', 'post', Math.min(25, residue.length * 15), '本帖：出现模型协议格式残留；引用或技术讨论仍可能遗漏，格式本身不能确认 AI 参与');
    const strongest = (scope) => Math.max(0, ...evidence.filter((item) => item.scope === scope && item.points >= 80).map((item) => item.points));
    const behavior = Math.min(50, evidence.filter((item) => item.scope === 'observation').reduce((sum, item) => sum + item.points, 0));
    const format = Math.min(40, evidence.filter((item) => item.code === 'post_protocol_residue').reduce((sum, item) => sum + item.points, 0));
    const automationScore = Math.max(strongest('account'), behavior);
    const contentScore = Math.max(strongest('post'), format);
    const score = Math.max(automationScore, contentScore);
    const level = score >= 80 ? 'high' : score >= 60 ? 'observe' : 'insufficient';
    const ai = score >= 80 ? evidence.filter((item) => item.points >= 80).map((item) => item.reason) : [];
    if (Object.hasOwn(RESTRICTED, account.restriction)) warning.push(`账号：${RESTRICTED[account.restriction]}（${account.restriction}）；不代表恶意账号`);
    return { ai, warning, automationScore, contentScore, score, level, evidence, sampleCount: observed.length };
  }

  const api = Object.freeze({ normalizeAccount, classify });
  global.XA_ACCOUNT_SIGNALS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
