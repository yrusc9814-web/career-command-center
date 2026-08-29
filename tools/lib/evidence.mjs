// evidence.mjs — 能力证据层（Phase 2：Procurement Capability + Evidence Model）
//
// 设计依据：PROCUREMENT_ARCHETYPE_AUDIT.md §7（10 能力桶）、§22.2、§25（3 岗回放）。
// 三层分工（不混层）：
//   taxonomy.mjs 管"岗位是什么"（Archetype / Seniority / Domain / Category / Tag）；
//   本模块管"有什么能力证据"（Evidence / required-preferred / Coverage 状态）；
//   scoring.mjs 管"如何影响分数"（未来 Phase 3）。
//
// 硬约束：
//   - 纯函数、无 I/O、无第三方依赖（风格对齐 taxonomy.mjs）；
//   - 能力桶枚举 = taxonomy.mjs CAPABILITY_BUCKETS 恰好 10 个，禁止新增第 11 桶；
//   - evidence.text 为原文摘录，不得改写；quantitative.value 保留原文数值形式，
//     禁止任何单位换算（不把 3h→0.5h 折算成百分比；不把 120万 换成 1200000）；
//   - 本模块只产出"证据覆盖状态"枚举（matched/partial/no_evidence/unknown），
//     禁止输出百分比，禁止汇总成任何 CV Match / Career Score 分数。

import { CAPABILITY_BUCKETS } from './taxonomy.mjs';

// ---------------------------------------------------------------------------
// 1. 枚举（全部派生或冻结，不在本模块发明能力桶）
// ---------------------------------------------------------------------------

// 能力桶 key 集合：直接派生自 taxonomy.mjs 的 10 桶（顺序即 CAPABILITY_BUCKETS 定义序）
export const CAPABILITY_BUCKET_KEYS = Object.freeze(CAPABILITY_BUCKETS.map(b => b.key));

export const EVIDENCE_SOURCES = Object.freeze(['jd', 'cv', 'report', 'profile']);
export const EVIDENCE_TYPES = Object.freeze(['explicit', 'inferred']);
export const EVIDENCE_STRENGTHS = Object.freeze(['strong', 'medium', 'weak']);
export const EVIDENCE_CONFIDENCE = Object.freeze(['high', 'low']);
export const REQUIREMENT_LEVELS = Object.freeze(['required', 'preferred']);
export const COVERAGE_STATUSES = Object.freeze(['matched', 'partial', 'no_evidence', 'unknown']);
export const CANDIDATE_EVIDENCE_STRENGTHS = Object.freeze(['strong', 'medium', 'weak', 'no_evidence']);

// 强度排名（仅用于同桶多条证据取最强，禁止参与任何分数计算）
const STRENGTH_RANK = Object.freeze({ strong: 3, medium: 2, weak: 1 });

function assertBucket(capability) {
  if (!CAPABILITY_BUCKET_KEYS.includes(capability)) {
    throw new Error(`未知能力桶: ${capability}（能力桶枚举 = taxonomy.mjs CAPABILITY_BUCKETS 恰好 10 个）`);
  }
}

function assertSource(source) {
  if (!EVIDENCE_SOURCES.includes(source)) {
    throw new Error(`未知证据来源: ${source}（枚举 ${EVIDENCE_SOURCES.join('|')}）`);
  }
}

// ---------------------------------------------------------------------------
// 2. required / preferred 标记词表（§1.5）与 JD 分节标题
// ---------------------------------------------------------------------------

// required 标记：含偏好词的能力条款归 preferred；同一能力同时出现在必须与优先句 → required 优先。
// 注意：单字 '需' 用负向断言排除 '需求'（"对接……报价需求"不是要求标记）。
export const REQUIRED_MARKERS = Object.freeze([
  /必须/, /要求/, /至少/, /需具备/, /需有/, /具备/, /须具备/, /需(?!求)/,
  /mandatory/i, /required/i,
]);

export const PREFERRED_MARKERS = Object.freeze([
  /优先/, /加分/, /更佳/, /preferred/i, /plus/i,
]);

// JD 分节标题（【加分项】/【任职要求】/【岗位职责】…）：标题的偏好语境延续到后续各条，
// 直到下一个标题。条目内联标记词优先于继承语境。
export const SECTION_HEADER_RULES = Object.freeze([
  { level: 'preferred', re: /^[【\s\d０-９①-⑩一二三四五六七八九十.．、:：\-—*·]*(?:加分项|加分|优先条件|优先项)/ },
  { level: 'required', re: /^[【\s\d０-９①-⑩一二三四五六七八九十.．、:：\-—*·]*(?:任职要求|任职资格|岗位要求|职位要求|工作要求|任职资格要求|岗位职责|工作职责|职责要求|主要职责|职责)/ },
]);

// ---------------------------------------------------------------------------
// 3. 能力识别关键词表 EVIDENCE_SIGNALS（按 10 桶，每桶 strong/medium/weak 三级）
//
// 规则（§1.2-§1.4，确定性、可单测）：
//   strong = 量化结果类信号（正则），或 medium 信号 + 本桶量化桥接（RESULT_METRICS）
//   medium = 明确承担该能力动作；weak = 协助/参与/配合/了解类。
//   全无信号 → 不产生证据（诚实标注，不允许臆测）。
// 语义护栏：
//   - '沟通/协调/对接' 严禁判为 negotiation_contract（weak 层不收录，见该桶 weak 列表）；
//   - '询价/报价/比价/议价/核价' 为 rfq_execution 的 medium 及以下（与 taxonomy.mjs
//     Phase 1.1 弱信号语义一致），仅在有量化结果时经桥接升 strong；
//   - '供应商维护' 归 supplier_quality（§7：供应商管理并入该桶），不等价寻源开发。
// 字符串信号对 lowercase 文本做 includes；正则信号带 i 标志。
// ---------------------------------------------------------------------------

export const EVIDENCE_SIGNALS = Object.freeze({
  // ① 寻源与供应商开发：strong=开发动作+数量/导入成功；medium=明确承担开发寻源；weak=协助/参与
  sourcing_development: {
    strong: [
      /(?:年?开发|拓展|新增|发展)[^。\n\r；;，,]{0,8}?\d+\s*\+?\s*家/,
      /(?:开发|沉淀|储备)[^。\n\r；;]{0,6}?\d+\s*家(?:核心)?供应商/,
    ],
    medium: ['供应商开发', '新供应商开发', '供应商筛选', '供应商导入', '供应商资源', '寻源', 'sourcing', '源头工厂', '基地资源', '拓品', '开发上新', '新资源开发', '新供应商'],
    weak: ['协助开发', '协助供应商开发', '参与筛选', '参与寻源', '参与开发', '配合寻源', '协助寻源'],
  },
  // ② 询比价与采购执行：strong=询比价全流程/机制+结果；medium=询价/比价/下单/核价/跟单等执行动作；weak=协助下单跟单
  rfq_execution: {
    strong: [/(?:询比价|询价[^。\n\r；;]{0,3}比价)[^。\n\r；;]{0,16}?(?:全流程|机制|体系)/],
    medium: ['询比价', '询价', '报价', '比价', '议价', '核价', '下单', '跟单', '交期跟进', 'rfq', 'rfp', '样品确认', '采购订单', '订单管理', '采购执行', 'moq'],
    weak: ['协助下单', '协助跟单', '协助询价', '参与跟单', '配合下单', '采购流程', '采购工作流程'],
  },
  // ③ 成本管理与降本：strong=有金额或百分比；medium=明确降本动作无量化；weak=泛泛成本意识
  cost_reduction: {
    strong: [
      /(?:降本|节约|节省|成本\s*(?:下降|降低|缩减|优化))[^。\n\r；;]{0,10}?\d+(?:\.\d+)?\s*%/,
      /(?:节约|节省|降本|降低[^。\n\r；;]{0,6}成本)[^。\n\r；;]{0,10}?\d+(?:\.\d+)?\s*(?:万|亿)?\s*(?:元|美金|美元|人民币)/,
    ],
    medium: ['降本', '年度降本', '成本优化', '优化成本', '成本拆解', '成本下降', '降低成本', 'should-cost', 'should cost', 'cost saving', 'spend analysis', 'benchmark', '节约', '节省'],
    weak: ['控制成本', '成本控制', '控制采购成本', '关注成本', '成本意识', '成本敏感'],
  },
  // ④ 谈判与合同商务：strong=谈判对象+条件+结果（降价N%/账期延长/条款改善）；medium=独立商务谈判/合同/账期；weak 严禁收录沟通协调类词
  negotiation_contract: {
    strong: [
      /(?:谈判|议价)[^。\n\r；;]{0,12}?(?:降价|下降|降低|压到|压至)\s*\d+/,
      /账期[^。\n\r；;]{0,10}?(?:延长|延至|增加|提至|→)/,
    ],
    medium: ['商务谈判', '价格谈判', '合同谈判', '付款条件谈判', '谈判', '账期', '付款条件', '合同条款', '合同', '商务条款'],
    weak: ['协助谈判', '参与谈判', '配合谈判'],
  },
  // ⑤ 供应商质量与绩效：strong=质量异常闭环+结果（合格率提升/PPM下降/8D闭环）；medium=考核/评价/检验/异常处理；weak=关注质量
  supplier_quality: {
    strong: [
      /8d/,
      /(?:合格率|良率|直通率|ppm)[^。\n\r；;]{0,8}?(?:提升|提高|下降|降低|改善)/,
    ],
    medium: ['供应商考核', '供应商评价', '供应商绩效', '供应商评估', '供应商管理', '供应商维护', '供应商淘汰', '来料检验', '来料质检', 'iqc', '验货', '质检', '质量异常', 'sqe', 'sqm', '断供'],
    weak: ['关注质量', '质量意识'],
  },
  // ⑥ 交付与供应链协同：strong=交期/库存/OTD 量化结果；medium=交期管理/交付跟进/库存/供应链协同/跨部门/紧急交付；weak=配合交付
  delivery_collaboration: {
    strong: [
      /全批次按期交付/,
      /(?:交期|交付|交货及时率|otd|库存)[^。\n\r；;]{0,12}?(?:缩短|下降|降低|提升|达成|及时率达)/,
    ],
    medium: ['交期管理', '交期', '大货交期', '交付跟进', '交付', '交付异常', '交货及时率', '库存管理', '库存', '安全库存', '供应链协同', '供应链', '跨部门协作', '跨部门', '紧急交付', '催交', '仓储', '配送', '协同', '缺料', 'forecast'],
    weak: ['配合交付', '协助交付', '参与交付'],
  },
  // ⑦ 数字化与工具：strong=主导系统建设+效果；medium=ERP/SRM/SAP/采购平台日常使用；weak=了解某系统
  digital_tools: {
    strong: [/(?:主导|主导建设|负责搭建)[^。\n\r；;]{0,12}?(?:erp|srm|sap|系统|平台|数字化|信息化)[^。\n\r；;]{0,8}?(?:上线|落地|搭建|建设)/],
    medium: ['erp', 'srm', 'sap', '采购平台', '数字化', '采购系统', '报价系统', '信息化', '系统'],
    weak: ['了解erp', '了解sap', '了解srm', '了解系统', '了解数字化'],
  },
  // ⑧ 品类管理：strong=品类规模+策略结果（负责N个品类/品类年采购额N）；medium=品类管理/策略/规划；weak=参与品类事务
  category_management: {
    strong: [/(?:负责|管理|覆盖|主导)[^。\n\r；;]{0,40}?\d+\s*个(?:产品)?品类/],
    medium: ['品类管理', '品类策略', '品类规划', '品类采购', '品类'],
    weak: ['参与品类事务', '参与品类', '协助品类'],
  },
  // ⑨ 国际采购与外贸：strong=外贸全链路+结果（报关/船务/Incoterms+订单项目规模）；medium=外贸/进出口/报关/信用证/汇率；weak=了解外贸流程
  international_procurement: {
    strong: [/(?:报关|船务|国际物流|信用证|incoterms|国际贸易术语|进出口)[^。\n\r；;]{0,24}?(?:订单|项目|全链路|全流程|合规)/],
    medium: ['外贸采购', '进出口', '国际物流', '报关', '清关', '关务', '出口单证', '退税', '信用证', '汇率', '船务', 'incoterms', '国际贸易术语', '外贸', '跨境', '国际站'],
    weak: ['了解外贸流程', '了解外贸', '了解报关'],
  },
  // ⑩ 组织与领导力：strong=带团队+规模（管理N人小组/团队、带教培养）；medium=团队管理/SOP/KPI/带教；weak=参与协同
  leadership: {
    strong: [
      /(?:直接管理|管理|带领|领导|负责)\s*\d+\s*人(?:的)?(?:采购)?(?:小组|团队)/,
      /带教培养/,
    ],
    medium: ['团队管理', '团队建设', 'sop', 'kpi', '带教', '新人带教', '新人培训', '人才培养'],
    weak: ['参与协同', '参与协调', '协助带教'],
  },
});

// 限定词前缀：紧邻 medium/strong 信号之前出现 → 该次命中降级为 weak
// （"协助供应商开发"不是独立开发；"熟悉ERP"只是了解）。显式 weak 信号词不受影响。
export const QUALIFIER_PREFIXES = Object.freeze(['协助', '参与', '配合', '了解', '熟悉', '学习']);

// ---------------------------------------------------------------------------
// 4. 量化识别 extractQuantitative（§1.3）
//
// - metric 枚举 QUANT_METRICS 冻结（17 项）；每条产出 {metric, value, raw}；
// - value 仅在可靠解析（数字+单位识别）时给出数字，保留原文数值形式：
//   不做任何单位换算（120万 不换算成 1200000；"账期30→60天"取改善后 60）；
//   解析不可靠（如"3h→0.5-1h"区间）时 value=null 只留 raw（原文片段）；
// - 薪资不属采购量化证据：'13薪'、'8-12K'、'薪资增幅超50%' 均不在任何模式的
//   触发词内，明确排除；team_size 可匹配"4人采购小组"；
// - 跨模式区间去重（原文同一片段只产出一条量化项）。
// ---------------------------------------------------------------------------

export const QUANT_METRICS = Object.freeze([
  'cost_saving_percent', 'cost_saving_amount', 'annual_spend', 'supplier_count',
  'new_supplier_count', 'payment_terms_days', 'lead_time_change', 'otd',
  'quality_rate', 'ppm', 'inventory_reduction', 'shortage_rate', 'moq',
  'project_count', 'category_scale', 'team_size', 'cycle_time_change',
]);

// 有序模式表：valueGroup = value 所在捕获组序号（1 起）；null = 仅留 raw。
// 顺序即优先级：先具体（带改善动词/箭头）后泛化，配合区间去重防误吞。
const QUANT_PATTERNS = [
  { metric: 'new_supplier_count', re: /(?:年?开发|拓展|新增|发展)[^。\n\r；;，,]{0,8}?(\d+)\s*\+?\s*家/i, valueGroup: 1 },
  { metric: 'supplier_count', re: /(?:沉淀|储备|维护|管理|现有|保留)\s*(\d+)\s*家(?:核心)?供应商/i, valueGroup: 1 },
  { metric: 'supplier_count', re: /(\d+)\s*家(?:核心)?供应商/i, valueGroup: 1 },
  { metric: 'category_scale', re: /(\d+)\s*个(?:产品)?品类/i, valueGroup: 1 },
  { metric: 'category_scale', re: /品类[^。\n\r；;]{0,4}?采购额[^。\n\r；;\d]{0,4}?(\d+(?:\.\d+)?)\s*(万|亿)?/i, valueGroup: 1 },
  { metric: 'team_size', re: /(?:管理|带领|领导|负责)\s*(\d+)\s*人(?:的)?(?:采购)?(?:小组|团队)/i, valueGroup: 1 },
  { metric: 'team_size', re: /(\d+)\s*人(?:的)?(?:采购)?(?:小组|团队)/i, valueGroup: 1 },
  { metric: 'cost_saving_percent', re: /(?:降本|节约|节省|成本\s*(?:下降|降低|缩减|优化))[^。\n\r；;]{0,10}?(\d+(?:\.\d+)?)\s*%/i, valueGroup: 1 },
  { metric: 'cost_saving_amount', re: /(?:节约|节省|降本|降低[^。\n\r；;]{0,6}成本)[^。\n\r；;]{0,10}?(\d+(?:\.\d+)?)\s*(万|亿)?\s*(?:元|美金|美元|人民币)/i, valueGroup: 1 },
  // 订单/项目金额：V1 metric 枚举无 order_amount，按 spend 规模类归 annual_spend，raw 保留供人工复核
  { metric: 'annual_spend', re: /(?:年采购额|年度采购额|采购额|采购规模)[^。\n\r；;\d]{0,4}?(\d+(?:\.\d+)?)\s*(万|亿)?\s*(?:元|美金|美元|人民币)?/i, valueGroup: 1 },
  { metric: 'annual_spend', re: /(\d+(?:\.\d+)?)\s*(万|亿)?\s*(?:美金|美元|元|人民币)[^。\n\r；;]{0,8}?(?:订单|项目)/i, valueGroup: 1 },
  { metric: 'payment_terms_days', re: /账期[^。\n\r；;]*?(\d+)\s*天[^。\n\r；;]*?(?:延长|延至|增加|提至|→)\s*(?:至|到|为)?\s*(\d+)\s*天/i, valueGroup: 2 },
  { metric: 'payment_terms_days', re: /账期\s*(\d+)\s*→\s*(\d+)\s*天/i, valueGroup: 2 },
  { metric: 'payment_terms_days', re: /(?:账期|付款条件|月结)[^。\n\r；;\d]{0,4}?(\d+)\s*(?:天|日)/i, valueGroup: 1 },
  { metric: 'lead_time_change', re: /(?:交期|货期|lead\s*time)[^。\n\r；;]{0,12}?(?:缩短|减少|降低|提前|压缩)[^。\n\r；;]{0,4}?(\d+(?:\.\d+)?)\s*(?:天|日|周|小时|%)/i, valueGroup: 1 },
  { metric: 'cycle_time_change', re: /(?:单据|流程|审批|报价|周转)(?:时间|周期|时长)?[^。\n\r；;]{0,6}?(?:由|从)?\s*\d+(?:\.\d+)?\s*(?:小时|h|天|日)\s*(?:缩短至|缩短到|降至|减少至|→)\s*[\d.]+\s*(?:-\s*[\d.]+\s*)?(?:小时|h|天|日)?/i, valueGroup: null },
  { metric: 'otd', re: /(?:交货及时率|准时交付率|准时交货率|otd)[^。\n\r；;\d%]{0,4}?(\d+(?:\.\d+)?)\s*%/i, valueGroup: 1 },
  { metric: 'quality_rate', re: /(?:来料合格率|合格率|良率|直通率)[^。\n\r；;\d%]{0,4}?(?:提升至|提高至|提升|提高|达到|达|为|降至)?\s*(\d+(?:\.\d+)?)\s*%/i, valueGroup: 1 },
  { metric: 'ppm', re: /(\d+(?:\.\d+)?)\s*(?:ppm)/i, valueGroup: 1 },
  { metric: 'ppm', re: /(?:ppm)[^。\n\r；;\d]{0,4}?(?:下降至|降至|下降|降低|减少|低于|≤|小于)?\s*(\d+(?:\.\d+)?)/i, valueGroup: 1 },
  { metric: 'inventory_reduction', re: /库存[^。\n\r；;]{0,10}?(?:下降|降低|减少|优化)[^。\n\r；;]{0,4}?(\d+(?:\.\d+)?)\s*(%|万元|万|天)?/i, valueGroup: 1 },
  { metric: 'shortage_rate', re: /(?:缺料率|缺货率|断料率|停线率|缺料)[^。\n\r；;\d%]{0,4}?(?:下降至|降至|下降|低于|≤|小于)?\s*(\d+(?:\.\d+)?)\s*%/i, valueGroup: 1 },
  { metric: 'moq', re: /(?:moq|最小起订量|起订量)[^。\n\r；;\d]{0,4}?(\d+)/i, valueGroup: 1 },
  { metric: 'project_count', re: /(?:主导|负责|完成|跟进|交付|管理)\s*(\d+)\s*个[^。\n\r；;]{0,8}?(?:项目|订单)/i, valueGroup: 1 },
  { metric: 'project_count', re: /(\d+)\s*个(?:重点|大型|机械|海外)?(?:采购)?项目/i, valueGroup: 1 },
];

/**
 * 从文本提取采购量化证据（原文片段 raw 不改写；无匹配返回 []）。
 * @param {string} text
 * @returns {Array<{metric:string, value:number|null, raw:string}>}
 */
export function extractQuantitative(text) {
  if (typeof text !== 'string' || !text) return [];
  const found = [];
  QUANT_PATTERNS.forEach((entry, order) => {
    const m = entry.re.exec(text);
    if (!m) return;
    let value = null;
    if (entry.valueGroup !== null && m[entry.valueGroup] !== undefined) {
      const raw = m[entry.valueGroup];
      if (/^\d+(?:\.\d+)?$/.test(raw)) value = Number(raw);
    }
    found.push({ metric: entry.metric, value, raw: m[0], order, start: m.index, end: m.index + m[0].length });
  });
  // 区间去重：同一原文片段只保留一条（起点优先、同起点取更长者、再取模式序）
  found.sort((a, b) => a.start - b.start || b.end - a.end || a.order - b.order);
  const accepted = [];
  let lastEnd = -1;
  for (const item of found) {
    if (item.start < lastEnd) continue;
    accepted.push({ metric: item.metric, value: item.value, raw: item.raw });
    lastEnd = item.end;
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// 5. strength 判定 determineStrength（§1.4，确定性）
// ---------------------------------------------------------------------------

// 单模式首次命中：字符串 → includes（对 lowercase 文本）；正则 → exec 取 index
function findMatch(lowered, pattern) {
  if (pattern instanceof RegExp) {
    const m = pattern.exec(lowered);
    return m ? { index: m.index, length: m[0].length } : null;
  }
  const idx = lowered.indexOf(pattern.toLowerCase());
  return idx === -1 ? null : { index: idx, length: pattern.length };
}

// 限定词邻接：命中起点之前紧邻限定词（协助/参与/配合/了解/熟悉/学习）→ 降级 weak
function qualifierAdjacent(lowered, match) {
  const before = lowered.slice(Math.max(0, match.index - 4), match.index);
  return QUALIFIER_PREFIXES.some(q => before.endsWith(q));
}

/**
 * 单桶强度判定：strong 信号 → strong；medium 信号（+ 本桶量化桥接 → strong）→ medium；
 * weak 信号 → weak；全无 → null（不产生证据，调用方不得臆测）。
 * @param {string} capability 能力桶 key（taxonomy.mjs CAPABILITY_BUCKETS 之一）
 * @param {string} text 原文（句段级；量化桥接基于原文提取，保留原文大小写）
 * @returns {'strong'|'medium'|'weak'|null}
 */
export function determineStrength(capability, text) {
  assertBucket(capability);
  if (typeof text !== 'string' || !text.trim()) return null;
  const lowered = text.toLowerCase();
  const signals = EVIDENCE_SIGNALS[capability];

  // 1) strong：量化结果类信号（限定词邻接的 strong 命中不采信，落入 medium/weak 判定）
  for (const p of signals.strong) {
    const m = findMatch(lowered, p);
    if (m && !qualifierAdjacent(lowered, m)) return 'strong';
  }
  // 2) medium：明确承担动作；同段存在本桶量化结果（RESULT_METRICS 桥接）→ 升 strong
  for (const p of signals.medium) {
    const m = findMatch(lowered, p);
    if (m && !qualifierAdjacent(lowered, m)) {
      const metrics = extractQuantitative(text).map(q => q.metric);
      if ((RESULT_METRICS[capability] || []).some(rm => metrics.includes(rm))) return 'strong';
      return 'medium';
    }
  }
  // 3) weak：显式弱信号（含限定词组合词）
  for (const p of signals.weak) {
    if (findMatch(lowered, p)) return 'weak';
  }
  return null;
}

// 桶级量化桥接表：该桶出现 medium 信号、且同段提取到下列 metric 之一 → strong。
// （§1.2 各桶 strong 定义"量化结果类"；桥接让任意表述的量化结果可靠升级，
//  与 EVIDENCE_SIGNALS[桶].strong 的显式正则互为冗余备份，两条路径都确定性可单测。）
export const RESULT_METRICS = Object.freeze({
  sourcing_development: ['new_supplier_count', 'supplier_count'],
  rfq_execution: ['cost_saving_percent', 'cost_saving_amount'],
  cost_reduction: ['cost_saving_percent', 'cost_saving_amount'],
  negotiation_contract: ['payment_terms_days', 'cost_saving_percent', 'cost_saving_amount'],
  supplier_quality: ['quality_rate', 'ppm'],
  delivery_collaboration: ['lead_time_change', 'otd', 'inventory_reduction', 'shortage_rate'],
  digital_tools: ['cycle_time_change'],
  category_management: ['category_scale', 'annual_spend'],
  international_procurement: [],
  leadership: ['team_size'],
});

// ---------------------------------------------------------------------------
// 6. 句段切分与证据构建
// ---------------------------------------------------------------------------

// 句段切分：换行 + 中英文句号/分号/叹号/问号（保留逗号顿号于段内，
// 使"询比价机制……成本下降约15%"这类"动作+结果"同段可桥接）。
// 切分只在原文上进行，段文本即原文连续片段（trim 仅去首尾空白），不得改写。
// Phase 4 micro-export：eligibility.mjs 复用同一切分（分节语境/硬要求原文摘录须与
// Capability 层同源，禁止第二套切分实现）。
export function splitSegments(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  return text.split(/[\n\r]+|[。；;！？]+/g).map(s => s.trim()).filter(Boolean);
}

/**
 * 从一段原文构建证据列表（每桶每段最多一条 explicit 证据 + 可能的跨句 inferred 证据）。
 * explicit + confidence 'high' 为默认；inferred + 'low' 仅当：本段只有量化结果
 * （metric ∈ RESULT_METRICS[桶]）而无该桶信号词，且上一句段含该桶 medium 及以上
 * 信号（"文本明确职责但需跨句推断"）→ strength strong / confidence low。
 * @param {string} text
 * @param {'jd'|'cv'|'report'|'profile'} source
 * @param {{lookback?:boolean}} [options]
 * @returns {Array<{capability:string, source:string, evidence_type:string, text:string,
 *                   strength:string, quantitative:Array<{metric,value,raw}>|null, confidence:string}>}
 */
export function buildEvidence(text, source = 'cv', options = {}) {
  assertSource(source);
  const { lookback = true } = options;
  const out = [];
  let prev = '';
  for (const seg of splitSegments(text)) {
    const quant = extractQuantitative(seg);
    const emitted = new Set();
    for (const capability of CAPABILITY_BUCKET_KEYS) {
      const strength = determineStrength(capability, seg);
      if (!strength) continue;
      emitted.add(capability);
      const relevant = quant.filter(q => (RESULT_METRICS[capability] || []).includes(q.metric));
      out.push({
        capability,
        source,
        evidence_type: 'explicit',
        text: seg,
        strength,
        quantitative: relevant.length ? relevant : null,
        confidence: 'high',
      });
    }
    // 跨句推断（§1.4）：本段仅量化结果 + 上一段有该桶 medium+ 信号
    if (lookback && prev) {
      for (const capability of CAPABILITY_BUCKET_KEYS) {
        if (emitted.has(capability)) continue;
        const bridge = quant.filter(q => (RESULT_METRICS[capability] || []).includes(q.metric));
        if (!bridge.length) continue;
        const prevStrength = determineStrength(capability, prev);
        if (prevStrength === 'medium' || prevStrength === 'strong') {
          out.push({
            capability,
            source,
            evidence_type: 'inferred',
            text: bridge[0].raw,
            strength: 'strong',
            quantitative: bridge,
            confidence: 'low',
          });
        }
      }
    }
    prev = seg;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. JD 侧 analyzeJobCapabilities（§1.5）
// ---------------------------------------------------------------------------

function detectSectionHeader(segment) {
  for (const rule of SECTION_HEADER_RULES) {
    if (rule.re.test(segment)) return rule.level;
  }
  return null;
}

// 条目内联标记：preferred 与 required 同时出现 → required 优先；无内联标记 → null（继承分节语境）
function inlineRequirementLevel(segment) {
  const lowered = segment.toLowerCase();
  const hasPreferred = PREFERRED_MARKERS.some(re => re.test(lowered));
  const hasRequired = REQUIRED_MARKERS.some(re => re.test(lowered));
  if (hasPreferred && hasRequired) return 'required';
  if (hasPreferred) return 'preferred';
  if (hasRequired) return 'required';
  return null;
}

function toJobItem(entry) {
  return {
    capability: entry.capability,
    requirement_level: entry.requirement_level,
    evidence: { text: entry.text, strength: entry.strength, confidence: entry.confidence },
    evidence_type: entry.evidence_type,
  };
}

/**
 * JD 侧能力解析：逐句段识别 10 桶证据并归入 required / preferred。
 * - 含偏好词的能力条款归 preferred；同一能力同时出现在必须与优先句 → required 优先；
 * - 无任何标记的职责句段继承最近分节标题语境（【加分项】→ preferred，
 *   【任职要求】/【岗位职责】→ required），全文无分节 → 默认 required；
 * - "熟悉采购流程"这类泛句最多 rfq_execution weak 证据，禁止升 strong（词表保证）。
 * @param {string} jdText
 * @returns {{required_capabilities: Array, preferred_capabilities: Array}}
 */
export function analyzeJobCapabilities(jdText) {
  const collected = []; // { capability, requirement_level, text, strength, confidence, evidence_type }
  let context = null;
  for (const seg of splitSegments(jdText)) {
    const headerLevel = detectSectionHeader(seg);
    if (headerLevel) context = headerLevel;
    const entries = buildEvidence(seg, 'jd', { lookback: false });
    if (!entries.length) continue;
    const level = inlineRequirementLevel(seg) || context || 'required';
    for (const entry of entries) collected.push({ ...entry, requirement_level: level });
  }

  // 同桶同级去重取最强（同强度取先出现），随后 required 覆盖 preferred
  const byLevel = { required: new Map(), preferred: new Map() };
  for (const entry of collected) {
    const map = byLevel[entry.requirement_level];
    const cur = map.get(entry.capability);
    if (!cur || STRENGTH_RANK[entry.strength] > STRENGTH_RANK[cur.strength]) map.set(entry.capability, entry);
  }
  const pick = level => CAPABILITY_BUCKET_KEYS
    .filter(key => byLevel[level].has(key))
    .map(key => toJobItem(byLevel[level].get(key)));
  const required_capabilities = pick('required');
  const preferred_capabilities = pick('preferred')
    .filter(item => !byLevel.required.has(item.capability)); // required 优先，禁止双列
  return { required_capabilities, preferred_capabilities };
}

// ---------------------------------------------------------------------------
// 8. CV 侧 buildCandidateEvidence（§1.6）
// ---------------------------------------------------------------------------

/**
 * 候选人 CV 能力证据（source 固定 'cv'，规则同 EVIDENCE_SIGNALS / extractQuantitative）。
 * @param {string} cvText
 * @returns {Array} candidate_evidence[]
 */
export function buildCandidateEvidence(cvText) {
  return buildEvidence(cvText, 'cv', { lookback: true });
}

// ---------------------------------------------------------------------------
// 9. 覆盖 coverageMatrix（§1.7）与一站式入口（§1.8）
// ---------------------------------------------------------------------------

/**
 * 能力覆盖矩阵：只产出证据覆盖状态，禁止输出百分比，禁止汇总成分数。
 * 规则（V1 从简）：
 *   required + strong|medium → matched；required + weak → partial；
 *   required + 无证据 → no_evidence；preferred + 有证据 → matched（weak → partial）；
 *   preferred + 无证据 → no_evidence；
 *   unknown 仅当输入本身标记 unknown（requirement_level 或证据强度为 'unknown'）；
 *   CV 文本无该能力信息时一律 no_evidence（绝不是 false/undefined）。
 * candidate_evidence_strength 取该桶候选侧最强证据强度。
 * @param {Array<string|{capability:string, requirement_level:string}>} jobCaps
 * @param {Array} candidateEvidence buildCandidateEvidence 的输出
 * @returns {Array<{capability, requirement_level, candidate_evidence_strength, coverage_status}>}
 */
export function coverageMatrix(jobCaps, candidateEvidence = []) {
  const levelMap = new Map();
  for (const item of jobCaps) {
    const capability = typeof item === 'string' ? item : item.capability;
    const level = typeof item === 'string' ? 'required' : (item.requirement_level || 'required');
    assertBucket(capability);
    if (level !== 'required' && level !== 'preferred' && level !== 'unknown') {
      throw new Error(`未知 requirement_level: ${level}（枚举 ${REQUIREMENT_LEVELS.join('|')}，或 'unknown'）`);
    }
    const prev = levelMap.get(capability);
    if (prev === undefined || (prev !== 'required' && level === 'required')) levelMap.set(capability, level);
  }

  const strongest = new Map();
  for (const ev of candidateEvidence) {
    assertBucket(ev.capability);
    const cur = strongest.get(ev.capability);
    if (ev.strength === 'unknown') { strongest.set(ev.capability, 'unknown'); continue; }
    if (!cur || cur === 'unknown' || STRENGTH_RANK[ev.strength] > STRENGTH_RANK[cur]) {
      strongest.set(ev.capability, ev.strength);
    }
  }

  return CAPABILITY_BUCKET_KEYS
    .filter(key => levelMap.has(key))
    .map(capability => {
      const requirement_level = levelMap.get(capability);
      const candidate_evidence_strength = strongest.get(capability) || 'no_evidence';
      let coverage_status;
      if (requirement_level === 'unknown' || candidate_evidence_strength === 'unknown') {
        coverage_status = 'unknown';
      } else if (candidate_evidence_strength === 'strong' || candidate_evidence_strength === 'medium') {
        coverage_status = 'matched';
      } else if (candidate_evidence_strength === 'weak') {
        coverage_status = 'partial';
      } else {
        coverage_status = 'no_evidence';
      }
      return { capability, requirement_level, candidate_evidence_strength, coverage_status };
    });
}

/**
 * 一站式能力覆盖分析：JD 侧 required/preferred + CV 侧证据 + 覆盖矩阵。
 * 输出只有证据与状态，无任何分数/百分比/recommendation。
 * @param {string} jdText
 * @param {string} cvText
 * @returns {{job:{required_capabilities,preferred_capabilities}, candidate_evidence, coverage}}
 */
export function analyzeCapabilityCoverage(jdText, cvText) {
  const job = analyzeJobCapabilities(jdText);
  const candidate_evidence = buildCandidateEvidence(cvText);
  const jobCaps = [
    ...job.required_capabilities.map(x => ({ capability: x.capability, requirement_level: x.requirement_level })),
    ...job.preferred_capabilities.map(x => ({ capability: x.capability, requirement_level: x.requirement_level })),
  ];
  return { job, candidate_evidence, coverage: coverageMatrix(jobCaps, candidate_evidence) };
}
