// taxonomy.mjs — 采购 taxonomy 单一 Source of Truth（纯函数，无 I/O，无依赖）
//
// 冻结依据：PROCUREMENT_ARCHETYPE_AUDIT.md §21-§27（DESIGN FREEZE）。
// 六层边界（§24.3）：
//   Archetype（职能，3 个）→ Seniority（职级 6 档 / internal L0-L5）→
//   Domain（公司行业，6 值）→ Category（花预算买什么，多选）→
//   Tag（附加属性 0-N）→ Capability（能力证据，10 桶）。
//
// 判定原则：title 永远不进 Archetype 判定；证据不足一律 unknown，禁止硬套；
// raw_title 原样保留，永不改写真实 title。
// Phase 1.1（Taxonomy Closure）：Archetype 判定升级为强/弱信号分层 +
// 最长匹配嵌套去重 + 弱信号子句语境归属（全部通用规则，无岗位特判）。

// ---------------------------------------------------------------------------
// 1. Archetype（恰好 3 个，冻结 §24.1；信号分层见 §21/§24.1 + Phase 1.1 裁决）
// ---------------------------------------------------------------------------

export const ARCHETYPES = [
  {
    key: 'execution_procurement',
    display: '执行采购',
    definition: '以日常采购执行、下单、交付跟进、供应协调、价格执行、订单闭环为主要工作',
    // Phase 1.1 新增：'核价'（价格核定=执行侧对价格的控制落实）、
    // '样品确认'（订单落地前的样品/配置确认，属执行闭环动作）
    signals: ['采购订单', '采购执行', '下单', '交付跟进', '交期', '供应协调', '采购计划执行', '价格执行', '对账', '日常供应商维护', '验货', '监柜', '跟单', '交货及时率', '出口单证', '核价', '样品确认'],
  },
  {
    key: 'sourcing',
    display: '寻源 / 供应商开发',
    definition: '以新供应商开发、RFQ、供应商筛选、比价、商务谈判、导入为主要工作',
    // Phase 1.1 调整（全部通用规则，无任何岗位特判）：
    //   - 移除 '比价' → 降为弱信号（孤立比价在中文采购 JD 中多为 buyer 日常工作）；
    //   - '导入' → 收窄为 '供应商导入'（裸 '导入' 会误命中"开发导入"及无关"导入"）；
    //   - 新增 '新供应商'（JD 常以顿号断开，如"新供应商、新产品的开发导入"，
    //     此时 '新供应商开发' 不连续，需靠短词命中）；
    //   - 新增 '供应商资源'（资源型硬要求，寻源强特征）、'RFQ'、'RFP'。
    signals: ['新供应商开发', '供应商开发', '寻源', 'supplier sourcing', '供应商筛选', '供应商导入', '商务谈判', '新资源开发', '源头工厂', '拓品', '开发上新', '新供应商', '供应商资源', 'RFQ', 'RFP'],
  },
  {
    key: 'strategic_category',
    display: '战略 / 品类采购',
    definition: '以品类策略、年度降本、供应策略、Should-cost、供应商组合、长期商务规划为主要工作',
    signals: ['品类策略', 'category strategy', '年度降本', 'should-cost', '成本拆解', '供应商组合', '供应策略', '长期成本规划', '品类 ownership', '品类ownership', '年度采购策略', '集中采购'],
  },
];

// ---------------------------------------------------------------------------
// 1.1 弱信号层（Phase 1.1 新增，全部通用规则）
//
// 设计依据：PROCUREMENT_ARCHETYPE_AUDIT.md §21/§24.1 + 主代理对 003 的裁决
// （primary_archetype=execution_procurement，依据 JD 职责占比：报价核价 +
// 样品配置对接 = 日常执行主体 2 条，新供应商/新产品开发导入 = 寻源 1 条，
// "供应商开发"仅出现在加分项）。实现为通用的信号分层，不含任何公司/岗位特判。
// ---------------------------------------------------------------------------

// 弱信号：询价/报价/比价/议价是执行与寻源岗共有的日常动作，单独出现不定案，
// 每个命中的【不同弱信号词】+0.5，归属由所在子句的 sourcing 语境标记决定。
export const WEAK_SIGNALS = ['询价', '报价', '比价', '议价'];
export const WEAK_SIGNAL_WEIGHT = 0.5;

// sourcing 语境标记：弱信号所在子句命中任一标记 → 该弱信号的 0.5 分归 sourcing；
// 否则归 execution（默认归属执行：中文采购 JD 中孤立的询价/报价/核价/比价/议价
// 多为 buyer 日常工作，而非寻源项目）。
export const SOURCING_CONTEXT_MARKERS = ['新供应商', '寻源', '源头', '筛选', '供应商导入', '供应商资源', '开发', '拓品', 'RFQ'];

// 子句切分符：换行 / 中文分号 / 句号 / 逗号 / 顿号（\r 兼容 CRLF）
const CLAUSE_DELIMITERS = new Set(['\n', '\r', '；', '。', '，', '、']);

/**
 * 单次扫描（longest-match + 消费）：从左到右扫描文本，在每个位置取【最长】命中
 * 信号（强弱信号统一参赛），命中后消费整个匹配跨度——跨度内的子串信号被遮蔽，
 * 不再重复计数。
 *   例：'新供应商开发' 命中后，其子串 '供应商开发' / '新供应商' 不重复计数；
 *       '新供应商开发导入' 中 '新供应商' 与 '新供应商开发' 按最长匹配只计一次；
 *       '新供应商、新产品的开发导入' 因顿号断开，'新供应商开发' 不连续，
 *       由 '新供应商' 命中（长短词不叠加）。
 * @param {string} t 已 lowercase 的文本
 * @returns {Array<{signal:string, archetype:string|null, weak:boolean, index:number}>}
 */
function scanSignals(t) {
  const candidates = [];
  for (const a of ARCHETYPES) {
    for (const s of a.signals) candidates.push({ signal: s, lower: s.toLowerCase(), archetype: a.key, weak: false });
  }
  for (const s of WEAK_SIGNALS) candidates.push({ signal: s, lower: s.toLowerCase(), archetype: null, weak: true });
  // 长词在前：同位置多命中时取最长（遮蔽其子串）
  candidates.sort((x, y) => y.lower.length - x.lower.length);

  const hits = [];
  let i = 0;
  while (i < t.length) {
    const matched = candidates.find(c => t.startsWith(c.lower, i));
    if (matched) {
      hits.push({ signal: matched.signal, archetype: matched.archetype, weak: matched.weak, index: i });
      i += matched.lower.length; // 消费整段：跨度内的子串信号被遮蔽
    } else {
      i += 1;
    }
  }
  return hits;
}

/**
 * 按子句切分并记录每个子句的文本区间（用于弱信号的语境归属）。
 * @param {string} t 已 lowercase 的文本
 * @returns {Array<{start:number, end:number, text:string}>} 非空子句区间
 */
function clauseRanges(t) {
  const ranges = [];
  let start = 0;
  for (let i = 0; i <= t.length; i++) {
    if (i === t.length || CLAUSE_DELIMITERS.has(t[i])) {
      if (i > start) ranges.push({ start, end: i, text: t.slice(start, i) });
      start = i + 1;
    }
  }
  return ranges;
}

/**
 * Archetype 加分明细（判定门槛：胜者加权分 ≥2 且严格大于第二名，否则 unknown）。
 * 计分规则：
 *   - 强信号：每个 archetype 命中的【不同强信号词】各 +1（同词多处出现不重复计）；
 *   - 弱信号：每个命中的【不同弱信号词】+0.5，按子句语境归属——
 *     该词出现的任一子句含 sourcing 语境标记 → sourcing +0.5；
 *     任一子句不含 → execution +0.5（默认归属执行）。同一弱信号在两种语境
 *     均出现时两侧各 +0.5（语义：既有寻源语境也有孤立执行语境）。
 *     弱信号单独出现（无任何强信号）时总分 < 2 → unknown，弱信号永远不能单独定案。
 * @param {string} text JD 文本（title 不参与判定，由调用方保证只传职责文本）
 * @returns {{totals: Object<string,number>, strongHits: Object<string,string[]>, weakHits: Array<{signal:string, attribution:string}>}}
 */
export function archetypeScoreBreakdown(text) {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  const hits = scanSignals(t);
  const ranges = clauseRanges(t);

  const strongHits = Object.fromEntries(ARCHETYPES.map(a => [a.key, []]));
  for (const hit of hits.filter(h => !h.weak)) {
    if (!strongHits[hit.archetype].includes(hit.signal)) strongHits[hit.archetype].push(hit.signal);
  }

  // 弱信号语境归属：同一弱信号可能出现在多个子句，先按词聚合两侧语境
  const weakContext = new Map(); // signal → { sourcing: boolean, execution: boolean }
  for (const hit of hits.filter(h => h.weak)) {
    const clause = ranges.find(r => hit.index >= r.start && hit.index < r.end);
    const clauseText = clause ? clause.text : '';
    const inSourcingContext = SOURCING_CONTEXT_MARKERS.some(m => clauseText.includes(m.toLowerCase()));
    const entry = weakContext.get(hit.signal) || { sourcing: false, execution: false };
    if (inSourcingContext) entry.sourcing = true;
    else entry.execution = true;
    weakContext.set(hit.signal, entry);
  }
  const weakHits = [...weakContext.entries()].map(([signal, ctx]) => ({
    signal,
    attribution: ctx.sourcing && ctx.execution ? 'both' : (ctx.sourcing ? 'sourcing' : 'execution'),
  }));

  const totals = {};
  for (const a of ARCHETYPES) {
    totals[a.key] = strongHits[a.key].length;
  }
  totals.execution_procurement += weakHits.filter(w => w.attribution !== 'sourcing').length * WEAK_SIGNAL_WEIGHT; // execution 或 both
  totals.sourcing += weakHits.filter(w => w.attribution === 'sourcing' || w.attribution === 'both').length * WEAK_SIGNAL_WEIGHT;

  return { totals, strongHits, weakHits };
}

/**
 * Archetype 判定：强信号各 +1、弱信号按语境 +0.5（见 archetypeScoreBreakdown）。
 * 最高加权分 ≥2 且严格大于第二名 → 返回该 key；否则返回 'unknown'（禁止硬套）。
 * 通用护栏（Phase 1.1 规则细节）：全文无任何强信号命中时一律 unknown——
 * 弱信号永远不能单独定案（否则 4 个弱信号 = 2.0 会突破 ≥2 门槛）。
 * @param {string} text JD 文本（title 不参与判定，由调用方保证只传职责文本）
 * @returns {string} 'execution_procurement' | 'sourcing' | 'strategic_category' | 'unknown'
 */
export function classifyArchetype(text) {
  const { totals, strongHits } = archetypeScoreBreakdown(text);
  const hasAnyStrongHit = Object.values(strongHits).some(signals => signals.length > 0);
  if (!hasAnyStrongHit) return 'unknown'; // 弱信号永远不能单独定案

  const ranked = Object.entries(totals).sort((x, y) => y[1] - x[1]);

  const top = ranked[0];
  const second = ranked[1];
  if (top && top[1] >= 2 && (!second || top[1] > second[1])) {
    return top[0];
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 2. Seniority（用户可见 6 档 + internal L0-L5，冻结 §24.2）
// ---------------------------------------------------------------------------

export const SENIORITY_LEVELS = [
  { level: 0, display: '助理' },
  { level: 1, display: '专员' },
  { level: 2, display: '高级专员' },
  { level: 3, display: '主管' },
  { level: 4, display: '经理' },
  { level: 5, display: '总监·负责人' },
];

const DISPLAY_BY_LEVEL = new Map(SENIORITY_LEVELS.map(s => [s.level, s.display]));

// title 直接映射表（长词在前，避免“高级采购专员”被“采购专员”抢先命中）。
// 仅覆盖冻结清单中的 title；未列出的 title（含“负责人”“高级经理”等）一律走信号规则。
export const TITLE_DIRECT_MAP = [
  { title: '高级采购专员', level: 2 },
  { title: '资深采购专员', level: 2 },
  { title: '高级采购经理', level: 4 },
  { title: '采购助理', level: 0 },
  { title: '助理采购', level: 0 },
  { title: '采购专员', level: 1 },
  { title: '采购主管', level: 3 },
  { title: '采购经理', level: 4 },
  { title: '采购总监', level: 5 },
];

function matchTitleDirect(rawTitle) {
  if (typeof rawTitle !== 'string' || rawTitle.trim() === '') return null;
  const title = rawTitle.trim();
  // 精确匹配优先
  const exact = TITLE_DIRECT_MAP.find(m => m.title === title);
  if (exact) return exact;
  // 包含匹配（表序即优先级，长词在前）
  const contains = TITLE_DIRECT_MAP.find(m => title.includes(m.title));
  return contains || null;
}

/**
 * 职级归一：title 直接映射优先；未命中直接映射的 title（如“负责人”）
 * 用职责信号推断。信号定义（§24.2）：
 *   S1 teamManagement 团队管理 ≥2 人
 *   S2 annualTargetKpi 独立背年度降本或品类 KPI
 *   S3 supplierStrategyOwnership 供应商策略与组合决策权
 *   S4 budgetOwnership 品类预算责任
 *   S5 hrAuthority 人事权（面试/绩效/带教）
 *   S6 reportsToExec 汇报总监/VP/GM
 *   S7 moduleOwnerOnly 仅单模块 owner（如只管寻源）
 * 判定序（按冻结文档 §24.2 的规则顺序：组合规则先于“有效信号 <2”门槛——
 *   否则“仅 S2+S7（有效信号=1）”会被 <2 门槛吞掉，无法落到主管档）：
 *   S1+S2+S6 → L5；S1+S2+(S3..S6 任一) 且有效信号 ≥3 → L4；
 *   仅 S2+S7（无团队）→ L3；
 *   其余情形一律 unknown：含有效信号（S1-S6）<2，以及有 2 个信号但无组合命中
 *   （如 S1+S3 无 KPI、S1+S2 但缺 S3-S6）——不确定不硬套。
 * @param {string|null} rawTitle JD 原文 title（原样保留，不改写）
 * @param {{teamManagement?:boolean, annualTargetKpi?:boolean, supplierStrategyOwnership?:boolean,
 *          budgetOwnership?:boolean, hrAuthority?:boolean, reportsToExec?:boolean,
 *          moduleOwnerOnly?:boolean}} signals
 * @returns {{raw_title:string|null, level:number|null, display:string|null, unknown:boolean}}
 */
export function normalizeSeniority(rawTitle, signals = {}) {
  const direct = matchTitleDirect(rawTitle);
  if (direct) {
    return {
      raw_title: typeof rawTitle === 'string' ? rawTitle : null,
      level: direct.level,
      display: DISPLAY_BY_LEVEL.get(direct.level) || null,
      unknown: false,
    };
  }

  const S1 = signals.teamManagement === true;
  const S2 = signals.annualTargetKpi === true;
  const S3 = signals.supplierStrategyOwnership === true;
  const S4 = signals.budgetOwnership === true;
  const S5 = signals.hrAuthority === true;
  const S6 = signals.reportsToExec === true;
  const S7 = signals.moduleOwnerOnly === true;
  const validCount = [S1, S2, S3, S4, S5, S6].filter(Boolean).length;

  let level = null;
  if (S1 && S2 && S6) {
    level = 5;
  } else if (S1 && S2 && (S3 || S4 || S5 || S6) && validCount >= 3) {
    level = 4;
  } else if (S2 && S7 && !S1) {
    level = 3;
  }

  if (level === null) {
    // 无任何组合命中：无法归档（涵盖“有效信号 <2”与“有信号但组合不足”两类情形）
    return { raw_title: typeof rawTitle === 'string' ? rawTitle : null, level: null, display: null, unknown: true };
  }
  return {
    raw_title: typeof rawTitle === 'string' ? rawTitle : null,
    level,
    display: DISPLAY_BY_LEVEL.get(level) || null,
    unknown: false,
  };
}

/**
 * 两个已归一 title 的 internal level 差绝对值（用于未来 blocker 判定；
 * 本阶段不实现 blocker）。任一端无法归一（unknown）→ 返回 null。
 * @param {string} titleA
 * @param {string} titleB
 * @returns {number|null}
 */
export function seniorityGap(titleA, titleB) {
  const a = normalizeSeniority(titleA, {});
  const b = normalizeSeniority(titleB, {});
  if (a.unknown || b.unknown || a.level === null || b.level === null) return null;
  return Math.abs(a.level - b.level);
}

// ---------------------------------------------------------------------------
// 3. Domain（公司行业，6 值，冻结 §24.3）
// ---------------------------------------------------------------------------

export const DOMAINS = [
  { key: 'automotive', display: '汽车' },
  { key: 'food', display: '食品/生鲜' },
  { key: 'electronics', display: '电子' },
  { key: 'industrial', display: '工业/机械' },
  { key: 'consumer', display: '消费/零售' },
  { key: 'trade', display: '贸易' },
];

// 数组序即检测优先级（V1 启发式：无法从文本区分“制造商/贸易商”时，
// 按此顺序取第一个命中的行业；如需精确判定由上游 prompt 结合公司信息裁决）。
export const DOMAIN_KEYWORDS = [
  { domain: 'industrial', keywords: ['工程机械', '机械制造', '装备制造'] },
  { domain: 'automotive', keywords: ['汽配', '汽车', '汽车零部件'] },
  { domain: 'food', keywords: ['生鲜', '食品', '食材', '冻品'] },
  { domain: 'electronics', keywords: ['电子', '元器件'] },
  { domain: 'trade', keywords: ['进出口', '贸易', '跨境', '外贸'] },
  { domain: 'consumer', keywords: ['零售', '消费', '商超'] },
];

/**
 * @param {string} text
 * @returns {string|null} domain key 或 null（证据不足不臆测）
 */
export function detectDomain(text) {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  for (const { domain, keywords } of DOMAIN_KEYWORDS) {
    if (keywords.some(k => t.includes(k.toLowerCase()))) return domain;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 4. Category（花预算买什么，多选，冻结 §24.3 种子集，可扩展）
// ---------------------------------------------------------------------------

export const CATEGORIES = ['汽车零部件', '生鲜食品', '机械设备', '电子元器件', '原材料', '包材', 'MRO', '物流服务'];

// 关键词表 = 冻结种子词 + 品类名自映射（名称自映射为机械补全：JD 只写品类名时也应命中 Category）
export const CATEGORY_KEYWORDS = [
  { category: '汽车零部件', keywords: ['雨刷', '易损件', '汽配', '汽车零部件'] },
  { category: '生鲜食品', keywords: ['蔬菜', '水果', '肉类', '冻品', '生鲜', '生鲜食品'] },
  { category: '机械设备', keywords: ['发动机', '叉车', '装载机', '工程机械', '整机', '机械设备'] },
  { category: '电子元器件', keywords: ['芯片', '元器件', '电子元器件'] },
  { category: '原材料', keywords: ['钢材', '塑料', '原料', '原材料'] },
  { category: '包材', keywords: ['纸箱', '包材'] },
  { category: 'MRO', keywords: ['MRO', '备品备件'] },
  { category: '物流服务', keywords: ['海运', '空运', '货代', '物流', '物流服务'] },
];

/**
 * @param {string} text
 * @returns {string[]} 命中的品类数组（可为空；按 CATEGORIES 定义序去重）
 */
export function detectCategories(text) {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  const hits = [];
  for (const category of CATEGORIES) {
    const entry = CATEGORY_KEYWORDS.find(c => c.category === category);
    if (entry && entry.keywords.some(k => t.includes(k.toLowerCase()))) {
      hits.push(category);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// 4.1 Category Alias（Phase 3 落地裁决，PROCUREMENT_ARCHETYPE_AUDIT.md §24.3）
//
// 用户真实 config/profile.yml 中的品类值不改文件，匹配前经 normalizeCategories
// 归一：raw 值仅保留展示，CV Match 与未来 Eligibility 一律消费 normalized 值。
// 无法可靠归一的 raw → normalized=null（不强猜）。
// ---------------------------------------------------------------------------

export const CATEGORY_ALIASES = Object.freeze({
  '工程机械': '机械设备',
  '通用机械': '机械设备',
  '机械零部件': '机械设备',
});

/**
 * 品类归一（raw 保留 + normalized）：命中别名或本身就是 CATEGORIES 成员
 * → normalized=该值；否则 normalized=null，不强猜。
 * @param {Array<string>} rawList 原始品类值列表（如 profile.yml 的 categories）
 * @returns {Array<{raw:string, normalized:string|null}>} 与输入等长、顺序一致
 */
export function normalizeCategories(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(raw => {
    if (typeof raw !== 'string') return { raw, normalized: null };
    const key = raw.trim();
    let normalized = null;
    if (CATEGORY_ALIASES[key]) {
      normalized = CATEGORY_ALIASES[key];
    } else if (CATEGORIES.includes(key)) {
      normalized = key;
    }
    return { raw, normalized };
  });
}

// ---------------------------------------------------------------------------
// 5. Tag（附加属性 0-N，冻结 §24.3）
// ---------------------------------------------------------------------------

export const TAGS = ['direct', 'indirect', 'production_material', 'non_production', 'international', 'domestic', 'cross_border', 'project_based'];

// direct 与 production_material 成对产出（生产物料/直接物料/直接采购/生产性物料/生产性/直接材料）；
// indirect 与 non_production 成对产出（非生产性/间接/非生产物料/间接采购/间接物料）。
// 注意：无 mro tag——MRO 属 Category 层（见 CATEGORY_KEYWORDS 的 MRO 条目），与冻结 §24.3 的 8 值 tag 枚举一致。
export const TAG_KEYWORDS = [
  { tags: ['cross_border', 'international'], keywords: ['出口', '外贸', '跨境', '国际站'] },
  { tags: ['domestic'], keywords: ['国内', '内贸'] },
  { tags: ['project_based'], keywords: ['项目制', 'EPC', '交钥匙', '按项目', '项目采购'] },
  { tags: ['direct', 'production_material'], keywords: ['生产性', '直接材料', '生产物料', '直接物料', '直接采购', '生产性物料'] },
  { tags: ['non_production', 'indirect'], keywords: ['非生产性', '间接', '非生产物料', '间接采购', '间接物料'] },
];

// 否定前缀消歧：'非生产物料' 内含 '生产物料'、'非生产性' 内含 '生产性'、
// '非国内' 内含 '国内'——正向关键词的命中若紧邻“非”前缀则不计，避免同一处文本同时命中正反两条规则
function tagKeywordHit(text, keyword) {
  let idx = text.indexOf(keyword);
  while (idx !== -1) {
    if (idx > 0 && text[idx - 1] === '非') {
      idx = text.indexOf(keyword, idx + keyword.length);
      continue;
    }
    return true;
  }
  return false;
}

/**
 * 保守匹配：只认词表，不臆测（含“非”前缀否定消歧，见 tagKeywordHit）。
 * direct+production_material / indirect+non_production 分别成对产出（见 TAG_KEYWORDS 注释）。
 * @param {string} text
 * @returns {string[]} 命中的 tag 数组（按 TAGS 定义序去重）
 */
export function detectTags(text) {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  const hits = new Set();
  for (const { tags, keywords } of TAG_KEYWORDS) {
    if (keywords.some(k => tagKeywordHit(t, k.toLowerCase()))) {
      for (const tag of tags) hits.add(tag);
    }
  }
  return TAGS.filter(tag => hits.has(tag));
}

// ---------------------------------------------------------------------------
// 6. Capability（10 能力桶，冻结 §7 / §21；供应商管理并入 supplier_quality，不是 Archetype）
// ---------------------------------------------------------------------------

export const CAPABILITY_BUCKETS = [
  { key: 'sourcing_development', display: '寻源与供应商开发' },
  { key: 'rfq_execution', display: '询比价与采购执行' },
  { key: 'cost_reduction', display: '成本管理与降本' },
  { key: 'negotiation_contract', display: '谈判与合同商务' },
  { key: 'supplier_quality', display: '供应商质量与绩效' },
  { key: 'delivery_collaboration', display: '交付与供应链协同' },
  { key: 'digital_tools', display: '数字化与工具' },
  { key: 'category_management', display: '品类管理' },
  { key: 'international_procurement', display: '国际采购与外贸' },
  { key: 'leadership', display: '组织与领导力' },
];

// 细粒度 key → 桶（冻结映射）
export const CAPABILITY_ALIASES = {
  supplier_sourcing: 'sourcing_development',
  supplier_management: 'supplier_quality',
  rfq: 'rfq_execution',
  negotiation: 'negotiation_contract',
  cost_reduction: 'cost_reduction',
  delivery_management: 'delivery_collaboration',
  contract_management: 'negotiation_contract',
  erp_srm: 'digital_tools',
  incoterms: 'international_procurement',
  customs: 'international_procurement',
  international_logistics: 'international_procurement',
};

// 细粒度 key 的文本信号（V1 启发式词表，对齐 §7 各桶覆盖范围）
export const CAPABILITY_KEYWORDS = [
  { alias: 'supplier_sourcing', keywords: ['供应商开发', '寻源', 'sourcing', '源头工厂', '拓品', '新资源开发', '开发上新', '供应商导入'] },
  { alias: 'rfq', keywords: ['询价', '比价', 'rfq', 'rfp', '报价', '核价', 'moq', '紧急交付'] },
  { alias: 'cost_reduction', keywords: ['降本', '成本控制', '成本优化', 'cost saving', 'should-cost', '成本拆解', 'spend analysis', 'benchmark'] },
  { alias: 'negotiation', keywords: ['议价', '商务谈判', '谈判', '账期', '付款条件', '商务风险'] },
  { alias: 'contract_management', keywords: ['合同'] },
  { alias: 'supplier_management', keywords: ['供应商管理', '供应商绩效', '供应商评价', '供应商考核', '供应商淘汰', '质量异常', '验货', '质检', '来料检验', 'sqe', 'sqm', '断供'] },
  { alias: 'delivery_management', keywords: ['交期', '交付', '跟单', '催交', '库存', '安全库存', 'forecast', '仓储', '配送', '供应链协同', '跨部门'] },
  { alias: 'erp_srm', keywords: ['erp', 'srm', 'sap', '数字化采购', '采购系统', '报价系统'] },
  { alias: 'incoterms', keywords: ['incoterms', '国际贸易术语'] },
  { alias: 'customs', keywords: ['报关', '清关', '关务', '出口单证', '退税'] },
  { alias: 'international_logistics', keywords: ['国际物流', '船务', '海运', '空运', '货代', '国际站', '外贸', '跨境'] },
];

/**
 * @param {string} text
 * @returns {string[]} 命中的能力桶数组（去重，按 CAPABILITY_BUCKETS 定义序）
 */
export function detectCapabilities(text) {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  const buckets = new Set();
  for (const { alias, keywords } of CAPABILITY_KEYWORDS) {
    const bucket = CAPABILITY_ALIASES[alias];
    if (bucket && keywords.some(k => t.includes(k.toLowerCase()))) {
      buckets.add(bucket);
    }
  }
  return CAPABILITY_BUCKETS.map(b => b.key).filter(key => buckets.has(key));
}

// ---------------------------------------------------------------------------
// 7. 一站式入口
// ---------------------------------------------------------------------------

/**
 * 完整 taxonomy 标注。
 * @param {string} jdText JD 文本（职责 + 品类 + 行业 + 属性混合原文均可）
 * @param {string|null} rawTitle JD 原文 title（原样保留；不给则 seniority.unknown=true）
 * @param {object} [signals] normalizeSeniority 的职责信号（可选，供上游已提取信号时复用）
 * @returns {{
 *   primary_archetype: string,
 *   archetype_unknown: boolean,
 *   seniority: {raw_title: string|null, normalized_seniority: string|null, internal_level: number|null, unknown: boolean},
 *   domain: string|null,
 *   categories: string[],
 *   tags: string[],
 *   required_capabilities: string[],
 * }}
 */
export function classifyTaxonomy(jdText, rawTitle = null, signals = {}) {
  const primary = classifyArchetype(jdText);
  const sen = normalizeSeniority(rawTitle, signals);
  return {
    primary_archetype: primary,
    archetype_unknown: primary === 'unknown',
    seniority: {
      raw_title: sen.raw_title,
      normalized_seniority: sen.display,
      internal_level: sen.level,
      unknown: sen.unknown,
    },
    domain: detectDomain(jdText),
    categories: detectCategories(jdText),
    tags: detectTags(jdText),
    required_capabilities: detectCapabilities(jdText),
  };
}

// 导出 key 集合，供 prompt/扫描层做合法性校验（禁止在词表之外发明 archetype）
export const ARCHETYPE_KEYS = Object.freeze(ARCHETYPES.map(a => a.key));
