// cv-match.mjs — CV Match 层（0-100，纯函数；Phase 3，2026-08-29）
//
// 冻结依据：PROCUREMENT_ARCHETYPE_AUDIT.md §22.2（含 "Phase 3 落地裁决" 段）。
//
// 边界（§22.2 冻结）：只回答"履历与岗位多匹配"；可因缺经验降分；禁止因已存在的
// blocker（现任雇主/薪资/地点/级别倒退）再叠加决策惩罚——大小周/薪资/通勤/稳定性/
// 雇主身份属 Career Score 与 Blocker 层，绝不进入本模块任何因子（见 CV_MATCH_FACTORS）。
//
// 因子全集 = §22.2 冻结因子表（Primary 55 / Secondary 30 / Low 15，合计 100）。
// 注：§22.2 裁决①冻结为"14 因子"（5+5+4）且权重和=100；
// 按表逐字实现 14 项，不发明第 15 项（最高规则：不发明因子/权重）。
// 裁决①：无独立 archetype 因子——archetype 可迁移性由能力覆盖（sourcing/谈判/降本等）
// 与品类/行业因子自然承载，不建数值 transfer matrix。
// 裁决⑤：旧 cv_match（1-5 维度）正式退役——本模块输出 cv_match_score 0-100。
//
// 数据源（裁决②，禁止第二套关键词匹配引擎）：
//   - 能力因子（供应商开发/谈判/降本/外贸/交付供应链/质量异常/ERP·SRM/管理经验）
//     = evidence.analyzeCapabilityCoverage 的 coverageMatrix 对应桶 coverage_status；
//   - 品类经验 = taxonomy.detectCategories（JD×CV）+ normalizeCategories 归一后交集；
//   - 行业 = taxonomy.detectDomain 交集；
//   - 职级匹配 = taxonomy.seniorityGap（需调用方提供 jdTitle 与 candidate.rawTitle）；
//   - 年限/学历/语言 = 输入或文本规则判定（裁决②明示归属本层）。
//
// 贡献映射（裁决③，确定性）：matched=1.0 / partial=0.5 / no_evidence=0.0 /
// unknown=该因子退出分母（unknown 绝不按 0 分）。
// 公式（裁决④）：cv_match_score = Σ(contribution_i × weight_i) / Σ(effective_weight_i) × 100，
// 0-100 取整；confidence = effective_weight/100（≥85 高 / ≥60 中 / 否则低）。

import {
  detectCategories,
  detectDomain,
  normalizeSeniority,
  seniorityGap,
  normalizeCategories,
} from './taxonomy.mjs';
import { analyzeCapabilityCoverage } from './evidence.mjs';

// ---------------------------------------------------------------------------
// 1. 冻结因子表（§22.2；key 即 §22.2 裁决②的数据源语义）
// ---------------------------------------------------------------------------

export const CV_MATCH_FACTORS = Object.freeze([
  // Primary 55 —— 采购首筛核心
  { key: 'category_experience',      group: 'primary',   weight: 15, label: '品类经验' },
  { key: 'sourcing_development',     group: 'primary',   weight: 12, label: '供应商开发' },
  { key: 'negotiation_contract',     group: 'primary',   weight: 10, label: '谈判' },
  { key: 'seniority_match',          group: 'primary',   weight: 10, label: '职级匹配' },
  { key: 'cost_reduction',           group: 'primary',   weight: 8,  label: '降本' },
  // Secondary 30 —— 职能纵深
  { key: 'domain_match',             group: 'secondary', weight: 8,  label: '行业' },
  { key: 'international_procurement', group: 'secondary', weight: 8, label: '外贸' },
  { key: 'delivery_collaboration',   group: 'secondary', weight: 6,  label: '交付/供应链' },
  { key: 'supplier_quality',         group: 'secondary', weight: 4,  label: '质量/异常' },
  { key: 'digital_tools',            group: 'secondary', weight: 4,  label: 'ERP/SRM' },
  // Low 15 —— 卫生因素
  { key: 'leadership',               group: 'low',       weight: 5,  label: '管理经验' },
  { key: 'years_experience',         group: 'low',       weight: 4,  label: '年限' },
  { key: 'education',                group: 'low',       weight: 3,  label: '学历' },
  { key: 'language',                 group: 'low',       weight: 3,  label: '语言' },
]);

export const CV_MATCH_TOTAL_WEIGHT = CV_MATCH_FACTORS.reduce((s, f) => s + f.weight, 0); // 100

// 走 capability coverage（evidence.coverageMatrix）的因子桶（裁决②）
const CAPABILITY_COVERAGE_FACTORS = [
  'sourcing_development',
  'negotiation_contract',
  'cost_reduction',
  'international_procurement',
  'delivery_collaboration',
  'supplier_quality',
  'digital_tools',
  'leadership',
];

// 候选人学历枚举（裁决③：候选 educationLevel 参数枚举；rank 用于 ≥ 比较）
export const EDUCATION_RANKS = Object.freeze({
  '初中': 1,
  '高中': 2, '中专': 2, '中技': 2,
  '大专': 3,
  '本科': 4,
  '硕士': 5, '研究生': 5,
  '博士': 6,
});

// ---------------------------------------------------------------------------
// 2. 年限/学历/语言 的 JD 侧文本判定（裁决②明示："年限/学历/语言 = 输入或 CV 关键词判定"；
//    仅此三处允许本模块自带规则，能力/品类/行业/职级一律复用 taxonomy/evidence）
// ---------------------------------------------------------------------------

const CN_DIGIT = { '一': 1, '两': 2, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
const NUM_CLASS = '0-9一二两三四五六七八九十';

function parseNumToken(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (Object.prototype.hasOwnProperty.call(CN_DIGIT, s)) return CN_DIGIT[s];
  return null;
}

/**
 * JD 年限下限解析（"1-3年 / 一年及以上 / 经验不限"）。
 * @param {string} text
 * @returns {{unlimited:true}|{floor:number}|null} null=JD 未提年限（不可判定）
 */
export function parseJdYearsFloor(text) {
  if (typeof text !== 'string') return null;
  if (/经验不限|年限不限|不限经验/.test(text)) return { unlimited: true };
  // 顺序：区间（1-3年）→ 以上（一年及以上）→ 经验邻接（3年采购经验）；命中值须在 1..30 内（防"2019-2024年"类年份误配）
  const patterns = [
    new RegExp(`([${NUM_CLASS}]+)\\s*[-–—~～至到]\\s*[${NUM_CLASS}]+\\s*年`),
    new RegExp(`([${NUM_CLASS}]+)\\s*年\\s*(?:及)?以上`),
    new RegExp(`([${NUM_CLASS}]+)\\s*年[^，。；\\n]{0,10}?经验`),
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const n = parseNumToken(m[1]);
    if (n !== null && n >= 1 && n <= 30) return { floor: n };
  }
  return null;
}

/**
 * JD 学历要求解析（大专/本科/硕士/博士/学历不限）。
 * @param {string} text
 * @returns {{none:true}|{rank:number,label:string}|null} null=JD 未提学历（不可判定）
 */
export function parseJdEducation(text) {
  if (typeof text !== 'string') return null;
  if (/学历\s*不限|不限\s*学历/.test(text)) return { none: true };
  const patterns = [
    { re: /博士/, rank: 6, label: '博士' },
    { re: /硕士|研究生/, rank: 5, label: '硕士' },
    { re: /本科/, rank: 4, label: '本科' },
    { re: /大专/, rank: 3, label: '大专' },
  ];
  for (const p of patterns) {
    if (p.re.test(text)) return { rank: p.rank, label: p.label };
  }
  return null;
}

// JD 语言要求 / CV 语言信号（裁决③：有要求=英语/外语；CV 信号=英语/CET/四级六级/外贸/跨境/海外）
// Phase 4 micro-export：eligibility.mjs 复用同一词表判定 language 类硬要求（禁止第二套语言词表）
export const JD_LANGUAGE_REQUIRED_RE = /英语|英文|外语|四级|六级|CET/i;
export const CV_LANGUAGE_SIGNAL_RE = /英语|CET|四级|六级|外贸|跨境|海外/i;

// ---------------------------------------------------------------------------
// 3. 主计算
// ---------------------------------------------------------------------------

const STRENGTH_RANK = { strong: 3, medium: 2, weak: 1 };

function unique(list) {
  return [...new Set(list)];
}

function clip(s, n = 60) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function categoryFactorResult(jdCats, cvCats) {
  if (jdCats.length === 0) {
    return { status: 'unknown', evidence: 'JD 侧品类不可判定（未提及任何品类），退出分母' };
  }
  if (cvCats.length === 0) {
    return { status: 'no_evidence', contribution: 0.0, evidence: `CV 无任何品类信息（JD 品类：${jdCats.join('、')}）` };
  }
  const hit = jdCats.filter(c => cvCats.includes(c));
  if (hit.length > 0) {
    return { status: 'matched', contribution: 1.0, evidence: `品类交集命中：${hit.join('、')}（JD：${jdCats.join('、')} × CV：${cvCats.join('、')}）` };
  }
  return { status: 'no_evidence', contribution: 0.0, evidence: `品类已知但不相交：JD ${jdCats.join('、')} vs CV ${cvCats.join('、')}` };
}

function domainFactorResult(jdDomain, cvDomain) {
  if (jdDomain === null) {
    return { status: 'unknown', evidence: 'JD 侧行业不可判定，退出分母' };
  }
  if (cvDomain === null) {
    return { status: 'no_evidence', contribution: 0.0, evidence: `CV 无行业信息（JD 行业：${jdDomain}）` };
  }
  if (jdDomain === cvDomain) {
    return { status: 'matched', contribution: 1.0, evidence: `行业一致：${jdDomain}` };
  }
  return { status: 'no_evidence', contribution: 0.0, evidence: `行业不相交：JD ${jdDomain} vs CV ${cvDomain}` };
}

/**
 * CV Match（0-100）。纯函数；不 import scoring；不输出 recommendation/blocker。
 *
 * @param {object} input
 * @param {string} input.jdText JD 文本（职责/要求/加分项等原文）
 * @param {string} input.cvText 候选人 CV 文本
 * @param {string|null} [input.jdTitle] JD 原文 title（seniorityGap 用；缺省 → seniority_match unknown）
 * @param {object} [input.candidate]
 * @param {string|null} [input.candidate.rawTitle] 候选人现职 title（seniorityGap 用）
 * @param {number|null} [input.candidate.yearsExperience] 候选人年限（年）
 * @param {string|null} [input.candidate.educationLevel] 候选人学历（EDUCATION_RANKS 枚举）
 * @param {Array<string>} [input.candidate.categories] 候选人画像原始品类（profile raw 值，
 *        经 normalizeCategories 归一；§24.3 Category Alias 裁决）
 * @returns {{
 *   cv_match_score: number|null,
 *   confidence: {percent:number, level:string},
 *   factors: Array<{key:string, group:string, weight:number,
 *                   status:'matched'|'partial'|'no_evidence'|'unknown'|'ok',
 *                   contribution:number|null, evidence:string|null}>,
 * }}
 */
export function computeCvMatch(input = {}) {
  const jdText = typeof input.jdText === 'string' ? input.jdText : '';
  const cvText = typeof input.cvText === 'string' ? input.cvText : '';
  const jdTitle = typeof input.jdTitle === 'string' && input.jdTitle.trim() ? input.jdTitle : null;
  const candidate = input.candidate && typeof input.candidate === 'object' ? input.candidate : {};
  const rawTitle = typeof candidate.rawTitle === 'string' && candidate.rawTitle.trim() ? candidate.rawTitle : null;
  const years = typeof candidate.yearsExperience === 'number' && Number.isFinite(candidate.yearsExperience)
    ? candidate.yearsExperience
    : null;
  const educationLevel = typeof candidate.educationLevel === 'string' ? candidate.educationLevel.trim() : null;
  const profileCategories = Array.isArray(candidate.categories)
    ? candidate.categories.filter(c => typeof c === 'string' && c.trim())
    : [];

  // --- 共享证据层：一次计算，能力/品类/行业/职级全部复用既有引擎 ---
  const coverage = analyzeCapabilityCoverage(jdText, cvText);
  const coverageByCapability = new Map(coverage.coverage.map(row => [row.capability, row]));

  // 候选侧每桶最强证据原文（摘录用，不改写语义）
  const strongestCvByCapability = new Map();
  for (const ev of coverage.candidate_evidence) {
    const cur = strongestCvByCapability.get(ev.capability);
    if (!cur || (STRENGTH_RANK[ev.strength] || 0) > (STRENGTH_RANK[cur.strength] || 0)) {
      strongestCvByCapability.set(ev.capability, ev);
    }
  }
  // JD 侧每桶要求原文（no_evidence 时展示"JD 要求 → CV 证据"映射依据）
  const jdRequirementText = new Map();
  for (const item of [...coverage.job.required_capabilities, ...coverage.job.preferred_capabilities]) {
    if (!jdRequirementText.has(item.capability)) {
      jdRequirementText.set(item.capability, item.evidence ? item.evidence.text : '');
    }
  }

  // --- 品类（裁决②③）：detectCategories + normalizeCategories 归一后交集 ---
  const jdCategoryRaw = detectCategories(jdText);
  const candidateCategoryRaw = unique([...detectCategories(cvText), ...profileCategories]);
  const jdCategories = unique(normalizeCategories(jdCategoryRaw).map(x => x.normalized).filter(Boolean));
  const candidateCategories = unique(normalizeCategories(candidateCategoryRaw).map(x => x.normalized).filter(Boolean));

  // --- 行业（裁决②③）：detectDomain 交集 ---
  const jdDomain = detectDomain(jdText);
  const cvDomain = detectDomain(cvText);

  const results = new Map();
  const set = (key, status, contribution, evidence) => results.set(key, { status, contribution, evidence });

  // 1) 品类经验（primary 15）
  const cat = categoryFactorResult(jdCategories, candidateCategories);
  set('category_experience', cat.status, cat.contribution, cat.evidence);

  // 2) 行业（secondary 8，裁决②③：detectDomain 交集）
  const dom = domainFactorResult(jdDomain, cvDomain);
  set('domain_match', dom.status, dom.contribution, dom.evidence);

  // 3-10) 能力因子（裁决②③：coverage_status → contribution；JD 无该桶要求 → unknown 退出分母）
  for (const key of CAPABILITY_COVERAGE_FACTORS) {
    const row = coverageByCapability.get(key);
    if (!row) {
      set(key, 'unknown', null, 'JD 未提及该能力要求，无法评估（unknown 退出分母）');
      continue;
    }
    const jdTxt = jdRequirementText.get(key) || '';
    if (row.coverage_status === 'unknown') {
      set(key, 'unknown', null, '能力覆盖状态 unknown（证据不足），退出分母');
    } else if (row.coverage_status === 'matched') {
      const ev = strongestCvByCapability.get(key);
      set(key, 'matched', 1.0, `CV 证据（${row.candidate_evidence_strength}）：${clip(ev ? ev.text : '')}｜JD 要求：${clip(jdTxt)}`);
    } else if (row.coverage_status === 'partial') {
      const ev = strongestCvByCapability.get(key);
      set(key, 'partial', 0.5, `CV 仅弱证据（协助/参与类）：${clip(ev ? ev.text : '')}｜JD 要求：${clip(jdTxt)}`);
    } else {
      set(key, 'no_evidence', 0.0, `CV 无该能力证据；JD 要求：${clip(jdTxt)}`);
    }
  }

  // 11) 职级匹配（裁决③：seniorityGap 0→1.0 / ±1→0.5 / ≥2→0.0 / 任一端 unknown→退出分母）
  const gap = jdTitle && rawTitle ? seniorityGap(jdTitle, rawTitle) : null;
  if (gap === null) {
    set('seniority_match', 'unknown', null, `职级无法归一（JD title：${jdTitle || '缺失'} / 候选人 title：${rawTitle || '缺失'}），退出分母`);
  } else if (gap === 0) {
    set('seniority_match', 'ok', 1.0, `职级一致（差 0 档）：JD ${normalizeSeniority(jdTitle).display} vs 候选人 ${normalizeSeniority(rawTitle).display}`);
  } else if (gap === 1) {
    set('seniority_match', 'partial', 0.5, `职级差 1 档：JD ${normalizeSeniority(jdTitle).display} vs 候选人 ${normalizeSeniority(rawTitle).display}`);
  } else {
    set('seniority_match', 'no_evidence', 0.0, `职级差 ${gap} 档：JD ${normalizeSeniority(jdTitle).display} vs 候选人 ${normalizeSeniority(rawTitle).display}`);
  }

  // 12) 年限（裁决③：候选≥JD 下限→1.0 / 差 1 年内→0.5 / 其余→0 / 未提供或经验不限→unknown）
  const yearsReq = parseJdYearsFloor(jdText);
  if (!yearsReq) {
    set('years_experience', 'unknown', null, 'JD 未提及年限要求，退出分母');
  } else if (yearsReq.unlimited) {
    set('years_experience', 'unknown', null, 'JD 经验不限，年限不构成筛选，退出分母');
  } else if (years === null) {
    set('years_experience', 'unknown', null, `JD 要求 ${yearsReq.floor} 年以上，候选人年限未提供，退出分母`);
  } else if (years >= yearsReq.floor) {
    set('years_experience', 'ok', 1.0, `候选人 ${years} 年 ≥ JD 下限 ${yearsReq.floor} 年`);
  } else if (yearsReq.floor - years <= 1) {
    set('years_experience', 'partial', 0.5, `候选人 ${years} 年，距 JD 下限 ${yearsReq.floor} 年差 1 年内`);
  } else {
    set('years_experience', 'no_evidence', 0.0, `候选人 ${years} 年 < JD 下限 ${yearsReq.floor} 年（差 ${yearsReq.floor - years} 年）`);
  }

  // 13) 学历（裁决③：候选≥JD→1.0 / 否则→0 / 任一侧不明→unknown；JD 学历不限→无要求→unknown 退出）
  const jdEdu = parseJdEducation(jdText);
  const candEduRank = educationLevel && EDUCATION_RANKS[educationLevel] ? EDUCATION_RANKS[educationLevel] : null;
  if (!jdEdu) {
    set('education', 'unknown', null, 'JD 未提及学历要求，退出分母');
  } else if (jdEdu.none) {
    set('education', 'unknown', null, 'JD 学历不限，学历不构成筛选，退出分母');
  } else if (candEduRank === null) {
    set('education', 'unknown', null, `JD 要求 ${jdEdu.label}及以上，候选人学历未提供或不在枚举内，退出分母`);
  } else if (candEduRank >= jdEdu.rank) {
    set('education', 'ok', 1.0, `候选人 ${educationLevel} ≥ JD 要求 ${jdEdu.label}及以上`);
  } else {
    set('education', 'no_evidence', 0.0, `候选人 ${educationLevel} < JD 要求 ${jdEdu.label}及以上`);
  }

  // 14) 语言（裁决③：JD 无要求→unknown / 有要求且候选有信号→1.0 / 有要求无信号→0）
  if (!JD_LANGUAGE_REQUIRED_RE.test(jdText)) {
    set('language', 'unknown', null, 'JD 无语言要求，退出分母');
  } else if (CV_LANGUAGE_SIGNAL_RE.test(cvText)) {
    set('language', 'ok', 1.0, 'JD 有语言要求，CV 命中语言信号（英语/CET/四六级/外贸/跨境/海外）');
  } else {
    set('language', 'no_evidence', 0.0, 'JD 有语言要求，CV 无任何语言信号');
  }

  // --- 汇总（裁决④）：unknown 退出分母，绝不按 0 分 ---
  let weightedSum = 0;
  let effectiveWeight = 0;
  const factors = CV_MATCH_FACTORS.map(f => {
    const r = results.get(f.key) || { status: 'unknown', contribution: null, evidence: '' };
    const unknown = r.status === 'unknown';
    if (!unknown) {
      weightedSum += (r.contribution || 0) * f.weight;
      effectiveWeight += f.weight;
    }
    return {
      key: f.key,
      group: f.group,
      weight: f.weight,
      status: r.status,
      contribution: unknown ? null : r.contribution,
      evidence: r.evidence || null,
    };
  });

  const cvMatchScore = effectiveWeight > 0
    ? Math.min(100, Math.max(0, Math.round((weightedSum / effectiveWeight) * 100)))
    : null;
  const percent = CV_MATCH_TOTAL_WEIGHT > 0
    ? Math.round((effectiveWeight / CV_MATCH_TOTAL_WEIGHT) * 1000) / 10
    : 0;
  const level = percent >= 85 ? '高' : percent >= 60 ? '中' : '低';

  return {
    cv_match_score: cvMatchScore,
    confidence: { percent, level },
    factors,
  };
}
