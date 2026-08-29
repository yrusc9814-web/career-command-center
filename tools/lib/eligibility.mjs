// eligibility.mjs — Eligibility / Blocker 组装层（Phase 4，纯函数，无 I/O）
//
// 设计依据：PROCUREMENT_ARCHETYPE_AUDIT.md §22.1（hard_requirements 结构 / 判定四问 /
// 四级模型 BLOCKER-HARD_GAP-SOFT_GAP-UNKNOWN / candidate-side blocker / job-side blocker）
// 与 §22.4 Phase 4 落地裁决。
//
// 铁律（本模块为零决策组装层）：
//   - 决策链唯一 SoT = scoring.mjs computeRecommendation；本模块只做证据组装
//     （hard requirements 四问、四级判定、candidate-side blocker 布尔化），最终
//     必须（且只通过 decide()）调用 computeRecommendation，禁止第二套决策/矩阵实现；
//   - 缺失 preference = unknown / not_evaluated：不允许猜 salary floor / workstyle /
//     travel；no_evidence ≠ false；Hard Requirement ≠ Blocker；
//   - candidate-side blocker 未知即不触发（缺任一侧证据 → false + note，不猜测）；
//   - 本模块不修改任何分数（cv_match_score / career_ops_score / 两套 confidence）。
//
// 与既有层的复用关系（禁止第二套匹配引擎）：
//   - 必须性词表对齐 evidence.mjs 的 REQUIRED/PREFERRED 标记：必须/要求/至少/需/须/
//     及以上 → explicit；熟悉/具备 → likely；优先/加分/更佳 → preferred（PREFERRED_MARKERS
//     原样复用）；
//   - capability 类硬要求直接复用 analyzeJobCapabilities 的 required/preferred，
//     仅映射 3 个硬要求类型桶：category_management→category、leadership→management、
//     digital_tools→system_erp_srm（其余 7 桶属 CV Match 层能力评估，不进 Eligibility，
//     避免与 CV Match 双层重复）；
//   - 品类交集复用 taxonomy.normalizeCategories / detectCategories；行业复用 detectDomain；
//   - 年限/学历解析复用 cv-match.parseJdYearsFloor / parseJdEducation；语言词表复用
//     cv-match 的 JD_LANGUAGE_REQUIRED_RE / CV_LANGUAGE_SIGNAL_RE；
//   - 句段切分复用 evidence.splitSegments（分节语境与 Capability 层同源）；
//   - 职级差复用 taxonomy.seniorityGap（severe_level_downgrade = gap ≥ 2 档）；
//   - 候选侧能力证据强度复用 evidence.determineStrength（management/system_erp_srm 判定）。

import {
  seniorityGap,
  detectCategories,
  detectDomain,
  normalizeCategories,
} from './taxonomy.mjs';
import {
  analyzeJobCapabilities,
  determineStrength,
  PREFERRED_MARKERS,
  SECTION_HEADER_RULES,
  splitSegments,
} from './evidence.mjs';
import {
  parseJdYearsFloor,
  parseJdEducation,
  JD_LANGUAGE_REQUIRED_RE,
  CV_LANGUAGE_SIGNAL_RE,
} from './cv-match.mjs';
import { computeRecommendation } from './scoring.mjs';

// ---------------------------------------------------------------------------
// 1. 枚举与词表（复用/对齐既有层，不发明新领域词表）
// ---------------------------------------------------------------------------

// hard_requirements[].type（§22.1 冻结 10 类）
export const HARD_REQUIREMENT_TYPES = Object.freeze([
  'education', 'language', 'years', 'industry', 'category', 'management',
  'system_erp_srm', 'travel', 'schedule', 'location',
]);

// 四级模型（§22.1）：BLOCKER（job-side）/ HARD_GAP / SOFT_GAP / UNKNOWN；
// met 时不产生 level。candidate-side BLOCKER 不在本枚举（它由 blocker 布尔表达，
// 且按 §22.1 四级表：candidate-side blocker 期间 eligibility 仍为 eligible）。
export const GAP_LEVELS = Object.freeze(['BLOCKER', 'HARD_GAP', 'SOFT_GAP', 'UNKNOWN']);

// 必须性分级：explicit（硬性明示）> likely（软性必须）> preferred（加分）
export const MANDATORY_LEVELS = Object.freeze(['explicit', 'likely', 'preferred']);
const MANDATORY_RANK = { explicit: 3, likely: 2, preferred: 1 };

// explicit 词表 = evidence REQUIRED_MARKERS 中"硬性明示"子集（必须/要求/至少/需/须）+
// "及以上"（数字/学历阈值句式，如"1年以上"…"大专及以上"= 明确门槛）
const EXPLICIT_MANDATORY_RE = /必须|要求|至少|需(?!求)|须|及以上|mandatory|required/i;
// likely 词表：evidence REQUIRED_MARKERS 的软性子集（熟悉/具备 → required 但非硬性明示）
const LIKELY_MANDATORY_RE = /熟悉|具备/;

// 品类"需求动词"门：仅当品类词所在段含需求/经验类动词才构成品类硬要求——
// 防止"对大宗原材料价格波动保持敏感"这类市场感知表述被误提为硬要求
// （"有/具备/熟悉/了解/经验/资源/渠道/背景"等；判定仍交四问，不在此定级）
const CATEGORY_DEMAND_RE = /有|具备|拥有|熟悉|了解|经验|资源|渠道|货源|背景/;

// 品类资源型硬筛词（四问②：招聘方高概率真筛——"XX 供应商资源/渠道/货源"）
const CATEGORY_HARD_SCREEN_RE = /资源|渠道|货源/;
// 学历硬筛词（§22.1：大专岗学历常弹性；全日制/统招才算高概率真筛）
const EDUCATION_HARD_SCREEN_RE = /全日制|统招/;

// capability 桶 → 硬要求类型映射（仅 3 个；其余 7 桶属 CV Match 层，不进 Eligibility）
const CAPABILITY_TYPE_MAP = Object.freeze({
  category_management: 'category',
  leadership: 'management',
  digital_tools: 'system_erp_srm',
});
// JD 显式 travel / schedule / location 词（§22.1：无明示 → unknown，不触发）
const TRAVEL_WORDS = Object.freeze(['常驻出差', '长期出差', '经常出差', '频繁出差', '常驻外地', '外派', '驻厂', '出差']);
const SCHEDULE_WORDS = Object.freeze(['大小周', '单双休', '单休', '早班', '夜班', '晚班', '两班倒', '倒班']);
const LOCATION_HEADER_RE = /工作地点|工作城市|上班地址|上班地点|base/i;

// 薪资解析（统一折算为 K；解析不了 → null，不猜测；不做币种/年薪假设）
const SALARY_PATTERNS = [
  { re: /(\d+(?:\.\d+)?)\s*[-–—~～至到]\s*(\d+(?:\.\d+)?)\s*[kK]/, toK: v => v },
  { re: /(\d+(?:\.\d+)?)\s*[-–—~～至到]\s*(\d+(?:\.\d+)?)\s*千/, toK: v => v },
  { re: /(\d+(?:\.\d+)?)\s*[-–—~～至到]\s*(\d+(?:\.\d+)?)\s*万/, toK: v => v * 10 },
  { re: /(\d{4,6})\s*[-–—~～至到]\s*(\d{4,6})\s*元/, toK: v => v / 1000 },
];

const EDUCATION_RANKS = Object.freeze({
  '初中': 1, '高中': 2, '中专': 2, '中技': 2, '大专': 3,
  '本科': 4, '硕士': 5, '研究生': 5, '博士': 6,
});

function clip(s, n = 80) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

/**
 * 公司名归一化：去空格 / 括号内容（中英文）/ 大小写，用于 current_employer_conflict。
 * "示例集团（XYZ）" 与 "示例集团" → 同一主体。
 * @param {string|null} name
 * @returns {string|null} 归一化结果；空/非字符串 → null
 */
export function normalizeCompanyName(name) {
  if (typeof name !== 'string') return null;
  const t = name
    .replace(/（[^）]*）/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return t || null;
}

// ---------------------------------------------------------------------------
// 2. JD 事实解析 parseJdFacts（全部可为 null / 空数组——解析不了 = unknown，不猜测）
// ---------------------------------------------------------------------------

function detectSignals(text, words) {
  const hits = [];
  for (const w of words) {
    if (!text.includes(w)) continue;
    // 长词优先去重：已命中的更长信号包含该短词时不重复计（如"常驻出差"遮蔽"出差"）
    if (hits.some(h => h.includes(w))) continue;
    hits.push(w);
  }
  return hits;
}

function parseJdSalaryMaxK(text) {
  for (const { re, toK } of SALARY_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const v = Number(toK(Number(m[2])));
    if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  }
  return null;
}

/**
 * JD 事实解析：company / jdTitle / location 结构化字段由调用方覆盖传入（V1 不做
 * 正文公司名/区县解析——解析不可靠，宁可 null 交给 config/unknown 处理）；
 * salaryMaxK / scheduleSignals / travelSignals 从 JD 文本规则解析
 * （词表见 TRAVEL_WORDS / SCHEDULE_WORDS / SALARY_PATTERNS）。
 * @param {string} jdText
 * @param {{company?:string|null, jdTitle?:string|null, location?:string|null,
 *          salaryMaxK?:number|null, scheduleSignals?:string[], travelSignals?:string[]}} [overrides]
 * @returns {{company:string|null, jdTitle:string|null, location:string|null,
 *            salaryMaxK:number|null, scheduleSignals:string[], travelSignals:string[]}}
 */
export function parseJdFacts(jdText, overrides = {}) {
  const text = typeof jdText === 'string' ? jdText : '';
  const ov = overrides && typeof overrides === 'object' ? overrides : {};
  const pickStr = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    company: ov.company !== undefined ? pickStr(ov.company) : null,
    jdTitle: ov.jdTitle !== undefined ? pickStr(ov.jdTitle) : null,
    location: ov.location !== undefined ? pickStr(ov.location) : null,
    salaryMaxK: ov.salaryMaxK !== undefined ? ov.salaryMaxK : parseJdSalaryMaxK(text),
    scheduleSignals: Array.isArray(ov.scheduleSignals) ? ov.scheduleSignals : detectSignals(text, SCHEDULE_WORDS),
    travelSignals: Array.isArray(ov.travelSignals) ? ov.travelSignals : detectSignals(text, TRAVEL_WORDS),
  };
}

// ---------------------------------------------------------------------------
// 3. extractHardRequirements（§22.1 结构 + 裁决：capability 类复用
//    analyzeJobCapabilities；travel/schedule/location 从显式词提取）
// ---------------------------------------------------------------------------

// 分节语境（与 evidence 同一套 SECTION_HEADER_RULES；标题语境延续到后续各条）
function sectionContexts(jdText) {
  const contexts = []; // 与 splitSegments(jdText) 等长：每段所处的 preferred/required/null
  let context = null;
  for (const seg of splitSegments(jdText)) {
    for (const rule of SECTION_HEADER_RULES) {
      if (rule.re.test(seg)) { context = rule.level; break; }
    }
    contexts.push(context);
  }
  return contexts;
}

/**
 * 必须性判定（四问①；词表对齐 evidence REQUIRED/PREFERRED 标记）：
 *   加分项分节语境优先（加分节里的条目不因"熟悉"升为硬要求）→
 *   explicit 词（必须/要求/至少/需/须/及以上）→ preferred 词（优先/加分/更佳）→
 *   likely 词（熟悉/具备）→ 兜底：required/无分节语境 = explicit（任职要求/岗位职责
 *   罗列的条目即岗位明示要求），preferred 语境 = preferred。
 * @param {string} segment
 * @param {'required'|'preferred'|null} context
 * @returns {'explicit'|'likely'|'preferred'}
 */
function mandatoryOf(segment, context) {
  if (context === 'preferred') return 'preferred';
  if (EXPLICIT_MANDATORY_RE.test(segment)) return 'explicit';
  if (PREFERRED_MARKERS.some(re => re.test(segment))) return 'preferred';
  if (LIKELY_MANDATORY_RE.test(segment)) return 'likely';
  return 'explicit';
}

/**
 * 从 JD 提取硬要求清单（§22.1 结构：{id, type, jd_text, mandatory}；候选侧评估字段
 * 由 evaluateRequirement 补齐）。去重：同 key 保留必须性最高的一条
 * （explicit > likely > preferred，同级取先出现）；capability 派生条目若其原文段
 * 已产出同 type 条目则跳过（防同段双计）。
 *
 * 来源与映射：
 *   - category：detectCategories 逐段（须含需求动词，见 CATEGORY_DEMAND_RE）
 *     + analyzeJobCapabilities 的 category_management 桶；
 *   - industry：detectDomain + 显式"行业"词；
 *   - education / years / language：parseJdEducation / parseJdYearsFloor /
 *     JD_LANGUAGE_REQUIRED_RE（"学历不限/经验不限"非要求）；
 *   - management / system_erp_srm：analyzeJobCapabilities 的 leadership / digital_tools 桶；
 *   - travel / schedule / location：显式词（TRAVEL_WORDS / SCHEDULE_WORDS /
 *     LOCATION_HEADER_RE），评估委派给 candidate-side blocker 层。
 * @param {string} jdText
 * @returns {Array<{id:string, type:string, jd_text:string, mandatory:string}>}
 */
export function extractHardRequirements(jdText) {
  const text = typeof jdText === 'string' ? jdText : '';
  if (!text.trim()) return [];
  const segments = splitSegments(text);
  const contexts = sectionContexts(text);

  const collected = []; // { type, jd_text, mandatory, key, fromCapability, ...私有标注 }

  // --- 文本派生：品类（detectCategories 逐段 + 需求动词门）---
  const seenCategory = new Map(); // category -> index
  segments.forEach((seg, i) => {
    if (!CATEGORY_DEMAND_RE.test(seg)) return;
    for (const category of detectCategories(seg)) {
      const mandatory = mandatoryOf(seg, contexts[i]);
      const entry = { type: 'category', jd_text: seg, mandatory, key: `category:${category}`, fromCapability: false, categoryValue: category };
      if (seenCategory.has(category)) {
        const idx = seenCategory.get(category);
        if (MANDATORY_RANK[mandatory] > MANDATORY_RANK[collected[idx].mandatory]) collected[idx] = entry;
      } else {
        seenCategory.set(category, collected.length);
        collected.push(entry);
      }
    }
  });

  // --- 文本派生：行业（detectDomain + 显式"行业"词）---
  const seenIndustry = new Map();
  segments.forEach((seg, i) => {
    if (!/行业/.test(seg)) return;
    const domain = detectDomain(seg);
    if (!domain) return;
    const mandatory = mandatoryOf(seg, contexts[i]);
    const entry = { type: 'industry', jd_text: seg, mandatory, key: `industry:${domain}`, fromCapability: false, domainValue: domain };
    if (seenIndustry.has(domain)) {
      const idx = seenIndustry.get(domain);
      if (MANDATORY_RANK[mandatory] > MANDATORY_RANK[collected[idx].mandatory]) collected[idx] = entry;
    } else {
      seenIndustry.set(domain, collected.length);
      collected.push(entry);
    }
  });

  // --- 文本派生：学历 / 年限 / 语言（复用 cv-match 解析；"学历不限/经验不限"非要求）---
  const seenSimple = new Map(); // key -> index
  const pushSimple = (type, key, seg, ctx) => {
    const mandatory = mandatoryOf(seg, ctx);
    const entry = { type, jd_text: seg, mandatory, key, fromCapability: false };
    if (seenSimple.has(key)) {
      const idx = seenSimple.get(key);
      if (MANDATORY_RANK[mandatory] > MANDATORY_RANK[collected[idx].mandatory]) collected[idx] = entry;
    } else {
      seenSimple.set(key, collected.length);
      collected.push(entry);
    }
  };
  segments.forEach((seg, i) => {
    const edu = parseJdEducation(seg);
    if (edu && !edu.none) pushSimple('education', `education:${edu.label}`, seg, contexts[i]);
    const years = parseJdYearsFloor(seg);
    if (years && years.floor) pushSimple('years', `years:${years.floor}`, seg, contexts[i]);
    if (JD_LANGUAGE_REQUIRED_RE.test(seg)) pushSimple('language', 'language', seg, contexts[i]);
  });

  // --- 文本派生：travel / schedule / location（显式词；委派 candidate-side blocker 层）---
  segments.forEach((seg, i) => {
    const mandatory = mandatoryOf(seg, contexts[i]);
    if (detectSignals(seg, TRAVEL_WORDS).length) {
      collected.push({ type: 'travel', jd_text: seg, mandatory, key: `travel:${clip(seg, 20)}`, fromCapability: false, delegated: true });
    }
    const sched = detectSignals(seg, SCHEDULE_WORDS);
    if (sched.length) {
      collected.push({ type: 'schedule', jd_text: seg, mandatory, key: `schedule:${sched.join('+')}`, fromCapability: false, delegated: true, scheduleSignals: sched });
    }
    if (LOCATION_HEADER_RE.test(seg)) {
      collected.push({ type: 'location', jd_text: seg, mandatory, key: `location:${clip(seg, 20)}`, fromCapability: false, delegated: true });
    }
  });

  // --- capability 派生（复用 analyzeJobCapabilities；仅 3 个映射桶）---
  // 同 type 去重：capability 派生条目若其原文段已产出【同 type】条目则跳过（防同段双计）；
  // 不同 type 共用同一段落互不阻塞（如"品类采购 + 团队管理"同段 → category + management 各一条）
  const job = analyzeJobCapabilities(text);
  const coveredTextsByType = {
    category: new Set(collected.filter(c => c.type === 'category').map(c => c.jd_text)),
    management: new Set(),
    system_erp_srm: new Set(),
  };
  for (const item of [...job.required_capabilities, ...job.preferred_capabilities]) {
    const type = CAPABILITY_TYPE_MAP[item.capability];
    if (!type) continue; // 其余 7 桶属 CV Match 层，不进 Eligibility（防双层重复）
    const segText = item.evidence ? item.evidence.text : '';
    if (!segText || coveredTextsByType[type].has(segText)) continue;
    coveredTextsByType[type].add(segText);
    collected.push({
      type,
      jd_text: segText,
      // 段内标记词优先；无标记 → 继承 requirement_level（required→explicit / preferred→preferred）
      mandatory: mandatoryOf(segText, item.requirement_level === 'preferred' ? 'preferred' : 'required'),
      key: `${type}:${clip(segText, 20)}`,
      fromCapability: true,
      capability: item.capability,
    });
  }

  return collected.map((c, i) => ({
    id: `hr-${String(i + 1).padStart(2, '0')}`,
    type: c.type,
    jd_text: c.jd_text,
    mandatory: c.mandatory,
    _key: c.key,
    _fromCapability: !!c.fromCapability,
    _categoryValue: c.categoryValue || null,
    _domainValue: c.domainValue || null,
    _delegated: !!c.delegated,
    _scheduleSignals: c.scheduleSignals || null,
  }));
}

// ---------------------------------------------------------------------------
// 4. 判定四问 evaluateRequirement（§22.1：决定缺失项的级别，不自动成 blocker）
// ---------------------------------------------------------------------------

// 四问②：招聘方高概率硬筛（品类资源/必需语言/管理年限通常真筛；大专岗学历常弹性
// → 仅全日制/统招真筛；年限/行业/系统/出差等不默认真筛）
function hardScreenOf(req) {
  switch (req.type) {
    case 'category': return CATEGORY_HARD_SCREEN_RE.test(req.jd_text);
    case 'language': return req.mandatory === 'explicit';
    case 'management': return req.mandatory === 'explicit';
    case 'education': return EDUCATION_HARD_SCREEN_RE.test(req.jd_text);
    default: return false; // years / industry / system_erp_srm / travel / schedule / location
  }
}

// 四问③：能否用相邻经验替代（工程机械→汽配可替代；"XX 资源/渠道"型品类需求不可替代；
// 语言/学历/管理经验不可由相邻经验替代）
function substituteOkOf(req) {
  switch (req.type) {
    case 'category': return !CATEGORY_HARD_SCREEN_RE.test(req.jd_text);
    case 'language': case 'education': case 'management': return false;
    default: return true; // years / industry / system_erp_srm / travel / schedule / location
  }
}

// 候选人品类全集 = profile 品类（normalizeCategories 归一，§24.3 Category Alias）∪ CV 文本品类
function candidateCategories(candidate, cvText) {
  const raw = Array.isArray(candidate.categories) ? candidate.categories : [];
  const fromProfile = normalizeCategories(raw).map(x => x.normalized).filter(Boolean);
  const fromCv = detectCategories(typeof cvText === 'string' ? cvText : '');
  return [...new Set([...fromProfile, ...fromCv])];
}

/**
 * 四问判定（§22.1）：决定缺失项的级别，绝不自动成 blocker。
 *   ① mandatory（explicit/likely/preferred）→ req.mandatory（extract 时已判）；
 *   ② 招聘方高概率硬筛 → hard_screen（类型默认 + 原文词）；
 *   ③ 可否相邻经验替代 → substitute_ok；
 *   ④ 证据是否 unknown → status='unknown'（绝不猜测，绝不自动 BLOCKER）。
 * 级别：BLOCKER = explicit + 硬筛 + 不可替代 + 确认缺失（unmet 且 confirmed_missing）；
 *       HARD_GAP = mandatory 缺失但可替代/非硬筛，或缺失非确认（弱证据）；
 *       SOFT_GAP = preferred 缺失；UNKNOWN = JD 或候选侧信息不足。
 * travel/schedule/location 委派给 candidate-side blocker 层（status=unknown + delegated，
 * 不产生 job-side 级别——§22.1 将出差/工作制/地点冲突归 candidate-side blocker）。
 * @param {object} req extractHardRequirements 输出项（可附 _jdCategories 整篇品类参照）
 * @param {object} candidate 候选人画像（categories/yearsExperience/educationLevel/domain 等）
 * @param {string} cvText 候选人 CV 文本
 * @returns {object} {id, type, jd_text, mandatory, candidate_evidence, status,
 *                    substitute_ok, hard_screen, level, delegated?}
 */
export function evaluateRequirement(req, candidate = {}, cvText = '') {
  const cv = typeof cvText === 'string' ? cvText : '';
  const cand = candidate && typeof candidate === 'object' ? candidate : {};
  const {
    _jdCategories: jdCategoriesFallback = null,
  } = req && typeof req === 'object' ? req : {};

  const hardScreen = hardScreenOf(req);
  const substituteOk = substituteOkOf(req);
  const out = {
    id: req.id,
    type: req.type,
    jd_text: req.jd_text,
    mandatory: req.mandatory,
    candidate_evidence: null,
    status: 'unknown',
    // confirmed_missing：候选侧属性已知且确认不满足（unmet 的"确认缺失"子态）。
    // §22.1：BLOCKER 需"确认缺失"；弱证据（协助/熟悉类）非确认缺失 → 至多 HARD_GAP。
    confirmed_missing: false,
    substitute_ok: substituteOk,
    hard_screen: hardScreen,
    level: null,
  };

  // 委派型（travel/schedule/location）：candidate-side blocker 层判定，不产生 job-side 级别
  if (req._delegated) {
    out.delegated = true;
    out.level = 'UNKNOWN';
    out.candidate_evidence = '由 candidate-side blocker 层判定（travel_refusal / work_schedule_blocker / location_blocker），不产生 job-side blocker';
    return out;
  }

  switch (req.type) {
    case 'category': {
      const jdCats = detectCategories(req.jd_text);
      if (jdCats.length === 0 && Array.isArray(jdCategoriesFallback)) {
        // capability 派生条目（段内无品类词）→ 以整篇 JD 品类为参照
        jdCats.push(...jdCategoriesFallback);
      }
      const candCats = candidateCategories(cand, cv);
      if (jdCats.length === 0) {
        out.status = 'unknown';
        out.candidate_evidence = 'JD 侧品类不可判定（unknown，不猜测）';
        break;
      }
      if (candCats.length === 0) {
        out.status = 'unknown';
        out.candidate_evidence = `JD 品类：${jdCats.join('、')}；候选人无任何品类信息（unknown，不猜测）`;
        break;
      }
      const hit = jdCats.filter(c => candCats.includes(c));
      if (hit.length > 0) {
        out.status = 'met';
        out.candidate_evidence = `品类交集命中：${hit.join('、')}（JD：${jdCats.join('、')} × 候选人：${candCats.join('、')}）`;
      } else {
        out.status = 'unmet';
        out.confirmed_missing = true; // 候选人品类已知且无交集 = 确认缺失
        out.candidate_evidence = `确认缺失：JD 品类 ${jdCats.join('、')} × 候选人品类 ${candCats.join('、')} 无交集`;
      }
      break;
    }
    case 'industry': {
      const jdDomain = detectDomain(req.jd_text) || req._domainValue;
      const candDomain = detectDomain(cv) || (typeof cand.domain === 'string' && cand.domain ? cand.domain : null);
      if (!jdDomain) { out.status = 'unknown'; out.candidate_evidence = 'JD 侧行业不可判定（unknown，不猜测）'; break; }
      if (!candDomain) { out.status = 'unknown'; out.candidate_evidence = `JD 行业：${jdDomain}；候选人无行业信息（unknown，不猜测）`; break; }
      if (jdDomain === candDomain) {
        out.status = 'met';
        out.candidate_evidence = `行业一致：${jdDomain}`;
      } else {
        out.status = 'unmet';
        out.confirmed_missing = true;
        out.candidate_evidence = `行业不相交：JD ${jdDomain} vs 候选人 ${candDomain}`;
      }
      break;
    }
    case 'education': {
      const jdEdu = parseJdEducation(req.jd_text);
      if (!jdEdu || jdEdu.none) { out.status = 'unknown'; out.candidate_evidence = 'JD 学历要求不可判定（unknown）'; break; }
      const candRank = cand.educationLevel && EDUCATION_RANKS[cand.educationLevel] ? EDUCATION_RANKS[cand.educationLevel] : null;
      if (candRank === null) {
        out.status = 'unknown';
        out.candidate_evidence = `JD 要求 ${jdEdu.label}及以上；候选人学历未提供（unknown，不猜测）`;
        break;
      }
      if (candRank >= jdEdu.rank) {
        out.status = 'met';
        out.candidate_evidence = `候选人 ${cand.educationLevel} ≥ JD 要求 ${jdEdu.label}及以上`;
      } else {
        out.status = 'unmet';
        out.confirmed_missing = true;
        out.candidate_evidence = `候选人 ${cand.educationLevel} < JD 要求 ${jdEdu.label}及以上`;
      }
      break;
    }
    case 'years': {
      const jdYears = parseJdYearsFloor(req.jd_text);
      if (!jdYears || jdYears.unlimited || !jdYears.floor) { out.status = 'unknown'; out.candidate_evidence = 'JD 年限要求不可判定（unknown）'; break; }
      const years = typeof cand.yearsExperience === 'number' && Number.isFinite(cand.yearsExperience) ? cand.yearsExperience : null;
      if (years === null) {
        out.status = 'unknown';
        out.candidate_evidence = `JD 要求 ${jdYears.floor} 年以上；候选人年限未提供（unknown，不猜测）`;
        break;
      }
      if (years >= jdYears.floor) {
        out.status = 'met';
        out.candidate_evidence = `候选人 ${years} 年 ≥ JD 下限 ${jdYears.floor} 年`;
      } else {
        out.status = 'unmet';
        out.confirmed_missing = true;
        out.candidate_evidence = `候选人 ${years} 年 < JD 下限 ${jdYears.floor} 年`;
      }
      break;
    }
    case 'language': {
      if (!JD_LANGUAGE_REQUIRED_RE.test(req.jd_text)) { out.status = 'unknown'; out.candidate_evidence = 'JD 语言要求不可判定（unknown）'; break; }
      if (!cv.trim()) {
        out.status = 'unknown';
        out.candidate_evidence = 'JD 有语言要求；候选人 CV 缺失（unknown，不猜测）';
        break;
      }
      if (CV_LANGUAGE_SIGNAL_RE.test(cv)) {
        out.status = 'met';
        out.candidate_evidence = 'CV 命中语言信号（英语/CET/四六级/外贸/跨境/海外）';
      } else {
        out.status = 'unmet';
        out.confirmed_missing = true;
        out.candidate_evidence = 'JD 有语言要求，CV 无任何语言信号';
      }
      break;
    }
    case 'management': case 'system_erp_srm': {
      // capability 桶：leadership / digital_tools（复用 evidence 词表，禁第二套关键词引擎）
      const capability = req.type === 'management' ? 'leadership' : 'digital_tools';
      if (!cv.trim()) {
        out.status = 'unknown';
        out.candidate_evidence = `JD 要求 ${capability}；候选人 CV 缺失（unknown，不猜测）`;
        break;
      }
      const strength = determineStrength(capability, cv);
      if (strength === 'strong' || strength === 'medium') {
        out.status = 'met';
        out.candidate_evidence = `CV 命中 ${capability} 证据（${strength}）`;
      } else if (strength === 'weak') {
        // 弱证据（协助/熟悉类）不满足硬要求，但非"确认完全缺失" → 至多 HARD_GAP
        out.status = 'unmet';
        out.confirmed_missing = false;
        out.candidate_evidence = `CV 仅弱证据（${strength}，协助/熟悉类），不满足硬要求`;
      } else {
        // CV 存在但无任何该能力信号 = 确认缺失（对齐 CV Match no_evidence=0 语义）
        out.status = 'unmet';
        out.confirmed_missing = true;
        out.candidate_evidence = `CV 无 ${capability} 证据`;
      }
      break;
    }
    default:
      out.status = 'unknown';
      out.candidate_evidence = '不可判定（unknown，不猜测）';
  }

  // 级别判定（§22.1 四级模型）：BLOCKER 需 explicit + 高概率硬筛 + 不可替代 + 确认缺失
  if (out.status === 'met') {
    out.level = null;
  } else if (out.status === 'unknown') {
    out.level = 'UNKNOWN';
  } else if (req.mandatory === 'preferred') {
    out.level = 'SOFT_GAP';
  } else if (req.mandatory === 'explicit' && out.hard_screen && !out.substitute_ok && out.confirmed_missing) {
    out.level = 'BLOCKER';
  } else {
    out.level = 'HARD_GAP';
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. candidate-side blockers（§22.1 清单 1-6；未知即不触发，不猜测）
// ---------------------------------------------------------------------------

/**
 * candidate-side blocker 布尔化（触发条件 = 可观察证据，双侧齐备才判定）：
 *   current_employer_conflict：公司名归一化（去空格/括号内容/大小写）后相等或互相包含；
 *     任一侧缺失 → false + note；
 *   salary_floor_breach：仅当双方数字齐备且 jdMax < floor；floor 未配置 → false +
 *     config_gap（不许猜）；
 *   location_blocker / work_schedule_blocker / travel_refusal：candidate 显式声明约束
 *     + JD 显式信号才 true；缺任一侧 → false + note '证据不足未评估'；
 *   severe_level_downgrade：seniorityGap(candidate.title, jdRawTitle) ≥ 2；gap null → false+note。
 * @param {{jdFacts?:object, candidate?:object}} input
 * @returns {{blockers:{current_employer_conflict:boolean, salary_floor_breach:boolean,
 *            severe_level_downgrade:boolean, location_blocker:boolean,
 *            work_schedule_blocker:boolean, travel_refusal:boolean},
 *           notes:string[], unknown_items:string[]}}
 */
export function evaluateCandidateBlockers(input = {}) {
  const jdFacts = (input.jdFacts && typeof input.jdFacts === 'object') ? input.jdFacts : {};
  const candidate = (input.candidate && typeof input.candidate === 'object') ? input.candidate : {};

  const blockers = {
    current_employer_conflict: false,
    salary_floor_breach: false,
    severe_level_downgrade: false,
    location_blocker: false,
    work_schedule_blocker: false,
    travel_refusal: false,
  };
  const notes = [];
  const unknown_items = [];

  // 1) current_employer_conflict（公司名归一化匹配）
  const candCo = normalizeCompanyName(candidate.currentEmployer);
  const jdCo = normalizeCompanyName(jdFacts.company);
  if (!candCo || !jdCo) {
    notes.push('current_employer_conflict：现任雇主或 JD 公司主体缺失 → 不触发（证据不足，未评估）');
    unknown_items.push('current_employer_conflict');
  } else {
    blockers.current_employer_conflict = candCo === jdCo || candCo.includes(jdCo) || jdCo.includes(candCo);
  }

  // 2) salary_floor_breach（底线未配置 = config_gap，不猜测）
  const floor = typeof candidate.salaryFloorK === 'number' && Number.isFinite(candidate.salaryFloorK)
    ? candidate.salaryFloorK : null;
  const jdMax = typeof jdFacts.salaryMaxK === 'number' && Number.isFinite(jdFacts.salaryMaxK)
    ? jdFacts.salaryMaxK : null;
  if (floor === null) {
    notes.push('薪资底线未配置（config_gap）：salary_floor_breach 不触发，不猜测底线');
    unknown_items.push('salary_floor_breach');
  } else if (jdMax === null) {
    notes.push('salary_floor_breach：JD 薪资上限缺失 → 不触发（证据不足，未评估）');
    unknown_items.push('salary_floor_breach');
  } else {
    blockers.salary_floor_breach = jdMax < floor;
  }

  // 3) location_blocker（需显式 acceptableLocations + JD 显式地点）
  const accLocs = Array.isArray(candidate.acceptableLocations)
    ? candidate.acceptableLocations.filter(s => typeof s === 'string' && s.trim()) : null;
  const jdLoc = typeof jdFacts.location === 'string' && jdFacts.location.trim() ? jdFacts.location.trim() : null;
  if (!accLocs || accLocs.length === 0 || !jdLoc) {
    notes.push('location_blocker：候选人 acceptableLocations 或 JD 地点缺失 → 不触发（证据不足未评估）');
    unknown_items.push('location_blocker');
  } else {
    const acceptable = accLocs.some(acc => {
      const a = acc.trim();
      return jdLoc.includes(a) || a.includes(jdLoc);
    });
    blockers.location_blocker = !acceptable;
  }

  // 4) work_schedule_blocker（需显式 workstyleConstraints + JD 显式工作制信号；
  //    大小周本身只是 workload 维度证据，须候选人声明后才升级——§22.1 #4）
  const wsConstraints = Array.isArray(candidate.workstyleConstraints)
    ? candidate.workstyleConstraints.filter(s => typeof s === 'string' && s.trim()) : null;
  const jdSched = Array.isArray(jdFacts.scheduleSignals) ? jdFacts.scheduleSignals : [];
  if (!wsConstraints || wsConstraints.length === 0 || jdSched.length === 0) {
    notes.push('work_schedule_blocker：候选人工作制约束或 JD 工作制信号缺失 → 不触发（证据不足未评估）');
    unknown_items.push('work_schedule_blocker');
  } else {
    blockers.work_schedule_blocker = jdSched.some(sig => wsConstraints.some(c => {
      const a = c.trim();
      return sig.includes(a) || a.includes(sig);
    }));
  }

  // 5) travel_refusal（JD 明示常驻出差/外派 vs 候选人明确拒绝；无明示 → unknown 不触发）
  const jdTravel = Array.isArray(jdFacts.travelSignals) ? jdFacts.travelSignals : [];
  const travelDeclared = candidate.travelWilling === true || candidate.travelWilling === false;
  if (jdTravel.length > 0 && candidate.travelWilling === false) {
    blockers.travel_refusal = true;
  } else if (jdTravel.length === 0 || !travelDeclared) {
    notes.push('travel_refusal：一侧证据缺失（JD 无出差/外派明示或候选人未显式声明）→ 不触发（证据不足未评估）');
    unknown_items.push('travel_refusal');
  }

  // 6) severe_level_downgrade（seniorityGap ≥ 2 档；任一端不可归一 → false + note）
  const candTitle = (typeof candidate.rawTitle === 'string' && candidate.rawTitle.trim())
    || (typeof candidate.title === 'string' && candidate.title.trim()) || null;
  const jdTitle = (typeof jdFacts.jdTitle === 'string' && jdFacts.jdTitle.trim()) || null;
  const gap = candTitle && jdTitle ? seniorityGap(jdTitle, candTitle) : null;
  if (gap === null) {
    notes.push('severe_level_downgrade：职级无法归一（title 缺失或不可归档）→ 不触发（gap=null）');
    unknown_items.push('severe_level_downgrade');
  } else {
    blockers.severe_level_downgrade = gap >= 2;
  }

  return { blockers, notes, unknown_items };
}

// ---------------------------------------------------------------------------
// 6. evaluateEligibility（§22.1 status 规则）与 decide（唯一决策出口）
// ---------------------------------------------------------------------------

/**
 * 组装 Eligibility：hard requirements 四问判定 + §22.1 status 规则 + candidate-side blockers。
 * status 规则（§22.1；candidate-side blocker 不改变 eligibility）：
 *   ineligible：≥1 条 job-side BLOCKER（explicit mandatory + 高概率硬筛 + 不可替代 + 确认缺失）；
 *   eligible_with_gaps：≥1 条 HARD_GAP，或存在 unknown 的 likely-hard 项（explicit/likely
 *     且未委派给 blocker 层）；
 *   eligible：全部 met 或仅 SOFT_GAP；
 *   unknown：JD 无任何硬要求信息（诚实降级）。
 * @param {{jdText:string, cvText?:string, candidate?:object, jdFacts?:object}} input
 * @returns {{eligibility_status:'eligible'|'eligible_with_gaps'|'ineligible'|'unknown',
 *            eligibility_ineligible:boolean, has_hard_gap:boolean,
 *            hard_requirements:Array, blockers:object, notes:string[], unknown_items:string[]}}
 */
export function evaluateEligibility(input = {}) {
  const jdText = typeof input.jdText === 'string' ? input.jdText : '';
  const cvText = typeof input.cvText === 'string' ? input.cvText : '';
  const candidate = (input.candidate && typeof input.candidate === 'object') ? input.candidate : {};
  const jdFacts = (input.jdFacts && typeof input.jdFacts === 'object')
    ? input.jdFacts
    : parseJdFacts(jdText, {});

  const hard_requirements = extractHardRequirements(jdText)
    .map(req => evaluateRequirement(
      { ...req, _jdCategories: detectCategories(jdText) },
      candidate,
      cvText,
    ));

  const hasJobSideBlocker = hard_requirements.some(r => r.level === 'BLOCKER');
  const hasHardGap = hard_requirements.some(r => r.level === 'HARD_GAP');
  const hasLikelyHardUnknown = hard_requirements.some(r =>
    r.status === 'unknown' && !r.delegated
    && (r.mandatory === 'explicit' || r.mandatory === 'likely'));

  let eligibility_status;
  if (hasJobSideBlocker) eligibility_status = 'ineligible';
  else if (hasHardGap || hasLikelyHardUnknown) eligibility_status = 'eligible_with_gaps';
  else if (hard_requirements.length === 0) eligibility_status = 'unknown';
  else eligibility_status = 'eligible';

  const { blockers, notes, unknown_items } = evaluateCandidateBlockers({ jdFacts, candidate });

  return {
    eligibility_status,
    eligibility_ineligible: eligibility_status === 'ineligible',
    has_hard_gap: hasHardGap,
    hard_requirements,
    blockers,
    notes,
    unknown_items,
  };
}

/**
 * 唯一决策出口：组装证据后调用 scoring.computeRecommendation（决策链唯一 SoT），
 * 本函数零决策——Step 0-5 / 决策矩阵 / 封顶全部在 computeRecommendation 内。
 * @param {{jdText:string, cvText?:string, candidate?:object, jdFacts?:object,
 *           scores?:{cv_match_score?:number|null, career_ops_score?:number|null},
 *           extra?:{hard_redline?:boolean, redline_reason?:string, deal_breakers_hit?:boolean,
 *                   extra_reason?:string}}} input
 * @returns {{eligibility:object, blockers:object, notes:string[],
 *            recommendation:{recommendation:string, recommendation_reason:string,
 *                            trace:Array<{step:number, rule:string, input:object, outcome:string}>}}}
 */
export function decide(input = {}) {
  const eligibility = evaluateEligibility({
    jdText: input.jdText,
    cvText: input.cvText,
    candidate: input.candidate,
    jdFacts: input.jdFacts,
  });
  const scores = (input.scores && typeof input.scores === 'object') ? input.scores : {};
  const extra = (input.extra && typeof input.extra === 'object') ? input.extra : {};

  const recommendation = computeRecommendation({
    career_ops_score: scores.career_ops_score !== undefined ? scores.career_ops_score : null,
    cv_match_score: scores.cv_match_score !== undefined ? scores.cv_match_score : null,
    eligibility_status: eligibility.eligibility_status,
    eligibility_ineligible: eligibility.eligibility_ineligible,
    has_hard_gap: eligibility.has_hard_gap,
    ...eligibility.blockers,
    ...extra,
  });

  return {
    eligibility,
    blockers: eligibility.blockers,
    notes: eligibility.notes,
    recommendation,
  };
}
