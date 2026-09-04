// view-model.mjs — Dashboard 展示层纯函数（无 I/O、无评分、无决策）
//
// 职责边界（Phase 6 对齐）：
//   - 只做 Runtime 输出字段 → 用户可见文案的映射（十维中文名、四级缺口、blocker、
//     decision trace 透传、unknown/null 展示语义、旧品牌词清理）；
//   - 三层结果彻底分离：CV Match（0-100）/ Career Score（0-100）/ Recommendation
//     （Runtime 枚举）各自独立展示，绝不合成单一总分、绝不前端重推 Recommendation；
//   - 禁止出现任何评分计算（score×weight、矩阵、封顶等唯一 SoT 在 tools/lib 评分引擎，
//     本文件与 app.js 只消费其输出）。
//
// 本文件同时被浏览器（app.js，ESM import）与 node --test 直接引用，必须保持零依赖。

// ---------------------------------------------------------------------------
// 1. Career Score 冻结十维（key → 中文；与 tools/lib/scoring.mjs 的冻结评分定义卡
//    逐字一致、顺序一致，测试锁定两者同步。这里只有显示名映射，不含权重/计算。）
// ---------------------------------------------------------------------------

export const DIMENSION_ZH = Object.freeze({
  compensation: '薪酬竞争力',
  workload_workstyle: '工作制与强度',
  role_seniority: '职级质量与职责范围',
  career_growth: '成长空间',
  category_domain_value: '品类与行业价值',
  procurement_ownership: '采购自主权',
  company_stability: '公司与业务稳定性',
  location_fit: '地点与通勤',
  digital_tooling: '数字化与工具成熟度',
  hiring_process_quality: '招聘流程质量',
});

// 退役维度（Phase 3 维度表切换前）：不属于 Career Score 十维，Dashboard 一律不展示、
// 不为旧报告补算。旧 cv_match 1-5 也在此列（它不是 Career Score 维度）。
export const RETIRED_DIM_KEYS = Object.freeze([
  'north_star', 'cv_match', 'level', 'comp', 'growth', 'worklife',
  'stability', 'tech_modernity', 'process_speed', 'culture',
]);

/**
 * 评分明细 → 可展示维度：只保留冻结十维（旧 key/未知 key 过滤，不报错、不补算），
 * 显示名统一用 DIMENSION_ZH（不信任旧数据里的 name 字段）。
 * @param {{dimensions?:Array}|Array|null} breakdown
 * @returns {Array<{key,name,weight,score,weighted_value,status,reason,evidence}>}
 */
export function displayDimensions(breakdown) {
  const dims = Array.isArray(breakdown)
    ? breakdown
    : (breakdown && Array.isArray(breakdown.dimensions) ? breakdown.dimensions : []);
  return dims
    .filter(d => d && typeof d.key === 'string' && Object.prototype.hasOwnProperty.call(DIMENSION_ZH, d.key))
    .map(d => ({ ...d, name: DIMENSION_ZH[d.key] }));
}

/** 维度状态 → 用户可见文案：unknown/null 永不显示为 0/较差/失败 */
export function dimStatusZh(status) {
  return status === 'known' ? '已知' : '暂无数据';
}

// ---------------------------------------------------------------------------
// 2. 四级缺口模型（§22.1 BLOCKER / HARD_GAP / SOFT_GAP / UNKNOWN）用户可见映射
// ---------------------------------------------------------------------------

export const GAP_LEVEL_ZH = Object.freeze({
  BLOCKER: '硬性阻断（硬红线）',
  HARD_GAP: '硬性缺口',
  SOFT_GAP: '可弥补缺口',
  UNKNOWN: '信息不足（待确认）',
});

export function gapLevelZh(level) {
  return GAP_LEVEL_ZH[level] || '信息不足（待确认）';
}

// candidate-side blocker key → 中文（与 tools/lib/eligibility.mjs 六项一一对应）
export const BLOCKER_ZH = Object.freeze({
  current_employer_conflict: '现任雇主/关联主体岗位，不构成外部跳槽机会',
  salary_floor_breach: '低于候选人薪资底线',
  severe_level_downgrade: '职级严重倒退',
  location_blocker: 'JD 工作地点与候选人显式地点约束冲突',
  work_schedule_blocker: 'JD 明示工作制与候选人声明的不可接受项冲突',
  travel_refusal: 'JD 明示常驻出差/外派，候选人明确拒绝',
  eligibility_ineligible: '不满足岗位硬性要求',
});

/** blockers 布尔对象 → 命中项列表 [{key, zh}]（只透传 Runtime 命中结果，不做判定）。
 *  仅枚举 BLOCKER_ZH 已收录的 candidate-side blocker key——blockers 对象里还混有
 *  engine 上下文布尔（has_hard_gap / hard_redline / deal_breakers_hit 等），那些不是
 *  用户可见 blocker，透传会把内部 token 漏进 UI（P31 同类泄露）。 */
export function blockerHits(blockers) {
  if (!blockers || typeof blockers !== 'object') return [];
  return Object.entries(blockers)
    .filter(([key, hit]) => hit === true && key in BLOCKER_ZH)
    .map(([key]) => ({ key, zh: BLOCKER_ZH[key] }));
}

/**
 * 缺口条目 → 文本（Runtime hard_gaps/soft_gaps/gaps 兼容 string 与
 * {jd_text|description|reason|type|name} 两种形态；不做任何推断）。
 * 级别枚举值（{type:'UNKNOWN'} / 纯 "UNKNOWN" 字符串）按四级映射转用户文案，
 * 不把 "BLOCKER/HARD_GAP/SOFT_GAP/UNKNOWN" 字面量漏给用户。
 */
export function gapItemText(item) {
  if (item == null) return '';
  let text;
  if (typeof item === 'string') text = item.trim();
  else if (typeof item === 'object') {
    text = String(item.jd_text || item.description || item.reason || item.type || item.name || '').trim();
  } else {
    text = String(item).trim();
  }
  return GAP_LEVEL_ZH[text] || text;
}

// ---------------------------------------------------------------------------
// 3. Decision Trace 透传（Runtime decision_trace/trace：{step, rule, input, outcome}）
//    只做一行一条的透传展示，不新增 Timeline UI、不解释、不重放决策。
// ---------------------------------------------------------------------------

export function traceLines(trace) {
  if (!Array.isArray(trace)) return [];
  return trace.map(t => {
    if (typeof t === 'string') return t.trim();
    if (!t || typeof t !== 'object') return '';
    const step = t.step != null ? `Step ${t.step}` : '';
    const rule = String(t.rule || '');
    const outcome = t.outcome != null && t.outcome !== '' ? `→ ${t.outcome}` : '';
    return [step, rule, outcome].filter(Boolean).join(' ');
  }).filter(Boolean);
}

// ---------------------------------------------------------------------------
// 4. unknown / null 展示语义：暂无数据 / 信息不足 / JD 未披露 / 待确认
//    （缺失值禁止译为任何能力判词或失败语义，见 phase6 测试 P12 文件级扫描）
// ---------------------------------------------------------------------------

export function unknownZh(v, fallback = '暂无数据') {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return (s === '' || s === 'null' || s === 'undefined') ? fallback : s;
}

/** 能力证据状态展示边界说明：当前前端无 capability/因子状态渲染路径
 *  （capability_summary 仅透传），因此不保留无人调用的状态→文案映射函数；
 *  "no_evidence 不得译为能力判词"由用户可见文件级扫描测试锁定。 */

// ---------------------------------------------------------------------------
// 5. 旧品牌词 / 品牌指标名清理（仅文案映射，不改 Runtime 数据）
// ---------------------------------------------------------------------------

export function zhMetrics(s) {
  return String(s ?? '')
    .replace(/Career Ops Score/g, '综合评分')
    .replace(/Career Score/g, '综合评分');
}

// ---------------------------------------------------------------------------
// 5b. 推荐原因用户可见化（仅展示层；不改 Runtime 数据、不改评分/决策结果）
// ---------------------------------------------------------------------------

// 内部调试括号段：形如"（eligibility=ineligible，job-side blocker）"——括号内含
// eligibility= / job-side blocker / candidate-side blocker 字样的整段（全角括号，
// [^（）] 保证不跨段、不吞相邻正常括号）整体移除，不得出现在用户可见文本。
const DEBUG_PAREN_RE = /（[^（）]*(?:eligibility=|job-side blocker|candidate-side blocker)[^（）]*）/g;

// 通用守卫：BLOCKER_ZH 英文 key → 对应中文（复用 §2 现有冻结映射，不建立第二套规则）。
// BLOCKER_ZH 为冻结对象且各 key 互不为子串，模块级编译一次即可。
const BLOCKER_KEY_RE = new RegExp(Object.keys(BLOCKER_ZH).join('|'), 'g');

// 引擎 recommendation_reason 决策子句 → 用户可见中文。
// reason 是引擎按 '；' 拼接的多子句文本；子句形态由 tools/lib/scoring.mjs
// computeRecommendation 冻结（Step 0-5）。此处只把"决策矩阵 / 资格缺口封顶 / 资格不符"
// 等工程子句整体折叠为等价用户句（不暴露档位标识、枚举、阈值、"降档/封顶"工程词），
// 不重算任何结果；不命中已知形态的文本逐字透传。

// 决策矩阵最终档位 → 用户句（与矩阵语义对应，不使用行列档位标识）
const MATRIX_LEVEL_ZH = Object.freeze({
  '强烈推荐': '岗位整体质量和履历匹配度都非常高，综合判断强烈推荐',
  '推荐': '岗位整体质量和履历匹配度都较高，综合判断推荐',
  '一般': '岗位整体质量或履历匹配度处于中等水平，综合判断一般',
  '不推荐': '岗位整体质量或履历匹配度偏低，综合判断不推荐',
});
const LEVEL_ALT = '强烈推荐|推荐|一般|不推荐';

// 引擎档位区间标识兜底（决策矩阵行整体未命中时才做字面替换，不把 threshold 透出）。
// 正式制（true 0-100）、Round1 错误 20-100 与旧制（1-5，仅历史数据/兼容测试可达）
// token 都收敛到同一批用户中文（历史数据经迁移工具转正后不再出现旧 token）。
const ROW_BAND_ZH = Object.freeze({
  'career_score ≥75': '岗位价值非常高', 'career_score 50-74': '岗位价值较高',
  'career_score 25-49': '岗位价值中等', 'career_score <25': '岗位价值偏低',
  'career_score ≥80': '岗位价值非常高', 'career_score 60-79': '岗位价值较高',
  'career_score 40-59': '岗位价值中等', 'career_score <40': '岗位价值偏低',
  'career ≥4.0': '岗位价值非常高', 'career 3.0-3.9': '岗位价值较高',
  'career 2.0-2.9': '岗位价值中等', 'career <2.0': '岗位价值偏低',
  'career 未知（有效维度不足）': '岗位价值暂无法判断（信息不足）',
  'career_score 未知（有效维度不足）': '岗位价值暂无法判断（信息不足）',
});
const COL_BAND_ZH = Object.freeze({
  'cv ≥80': '履历匹配度很高', 'cv 60-79': '履历匹配度较高',
  'cv 40-59': '履历匹配度一般', 'cv <40': '履历匹配度偏低',
});

// 引擎内部 token（资格状态/缺口等级/字段名）→ 用户语言兜底（仅字面映射，先长后短避免误吞）
// 注：'career_score' 裸 token 兜底在档位区间映射之后执行（guardTokens 先换 ≥80/60-79 等
// 完整区间，剩余孤立出现的 career_score 前缀统一译为"岗位价值评分"，不透出变量名）。
const RAW_TOKEN_ZH = Object.freeze({
  'eligible_with_gaps': '存在部分需要确认或补足的条件',
  'candidate-side blocker': '',
  'job-side blocker': '',
  'eligibility_ineligible': '不满足岗位硬性要求',
  'eligibility=': '',
  'decision_trace': '',
  '/deal_breakers': '；',
  'career_score': '岗位价值评分',
  'hard_gaps': '硬性缺口',
  'soft_gaps': '可弥补缺口',
  'HARD_GAP': '硬性缺口',
  'eligible': '符合资格',
  'ineligible': '不符合资格',
});
const RAW_TOKEN_RE = new RegExp(
  Object.keys(RAW_TOKEN_ZH).sort((a, b) => b.length - a.length).join('|'), 'g',
);

/** 引擎单个决策子句 → 用户中文（按 computeRecommendation 冻结模板逐一识别；
 *  未来新形态未命中时原样返回，交由下方 debug 括号/兜底守卫处理）。 */
function zhClause(rawClause) {
  const c = String(rawClause ?? '').trim();
  if (!c) return rawClause;
  // 决策矩阵行（含可选"挑战岗"标注）：整行内部矩阵描述折叠为按最终档位的用户句
  let m = c.match(new RegExp(`^决策矩阵：.*?→ (${LEVEL_ALT})(（挑战岗）)?$`));
  if (m) return MATRIX_LEVEL_ZH[m[1]] + (m[2] ? '（挑战型岗位：需重点确认难度与匹配点）' : '');
  // Step 4：eligible_with_gaps → 降一档后封顶
  m = c.match(new RegExp(`^eligibility=eligible_with_gaps：.*?→ (${LEVEL_ALT})$`));
  if (m) return `存在部分需要确认或补足的条件，最终结论已相应下调为「${m[1]}」`;
  // Step 5：存在资格缺口且综合评分 < 3.0 → 不推荐
  if (/^存在资格缺口（.*?）且.*?→ 不推荐$/.test(c)) return '存在部分需要确认或补足的条件，且岗位价值评分偏低，最终不推荐';
  // Step 5：HARD_GAP → 封顶"推荐"
  m = c.match(new RegExp(`^存在 HARD_GAP：封顶"推荐"（.*?→ (${LEVEL_ALT})）$`));
  if (m) return `存在硬性缺口，最终结论已相应下调为「${m[1]}」`;
  // 有效维度不足（矩阵不适用）
  if (c.includes('矩阵不适用')) return '有效维度不足，暂时无法给出可信的综合评分';
  return rawClause;
}

/** 展示守卫：引擎档位标识 / 资格状态 / 缺口等级 / 字段名 → 用户中文或移除（仅字面映射，
 *  不把 threshold / enum / 变量名透出；不修改任何评分结果）。 */
function guardTokens(s) {
  let out = String(s ?? '');
  for (const map of [ROW_BAND_ZH, COL_BAND_ZH]) {
    for (const [k, v] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
      out = out.split(k).join(v);
    }
  }
  return out.replace(RAW_TOKEN_RE, m => RAW_TOKEN_ZH[m]);
}

/**
 * 推荐原因 → 用户可见文案（display-layer only）：
 *   1) 引擎决策子句（决策矩阵 / 资格缺口封顶 / 资格不符等）→ 语义等价用户中文（zhClause）；
 *   2) 复用 zhMetrics（Career Ops Score / Career Score → 综合评分）；
 *   3) 移除内部调试括号段（eligibility=… / job-side blocker / candidate-side blocker）；
 *   4) 引擎措辞"硬性资格不满足"→ 与 BLOCKER_ZH.eligibility_ineligible 一致的
 *      "不满足岗位硬性要求"（精确字符串替换，不做泛化匹配）；
 *   5) 文本中的 BLOCKER_ZH 英文 key → 对应中文（通用守卫）；
 *   6) 兜底：剩余内部档位/资格/字段形态 → 用户中文（guardTokens）。
 * 不含以上形态的文本逐字透传（如仅含评分括号的 reason，除 zhMetrics 外不变）。
 */
export function reasonZh(text) {
  return String(text ?? '')
    .split('；')
    .map(p => {
      const zh = zhMetrics(p);
      const s = zhClause(zh)
        .replace(DEBUG_PAREN_RE, '')
        .split('硬性资格不满足').join(BLOCKER_ZH.eligibility_ineligible)
        .replace(BLOCKER_KEY_RE, k => BLOCKER_ZH[k]);
      return guardTokens(s);
    })
    .map(s => s.trim())
    .filter(Boolean)
    .join('；');
}

// ---------------------------------------------------------------------------
// 6. 展示层 class 映射（与现有 styles.css 语义一致，零视觉改动）
// ---------------------------------------------------------------------------

export function recClassOf(rec) {
  if (rec === '强烈推荐' || rec === '推荐') return 'rec-good';
  if (rec === '一般') return 'rec-mid';
  return 'rec-bad';
}

export function confClassOf(percent) {
  return percent >= 85 ? 'conf-hi' : percent >= 60 ? 'conf-mid' : 'conf-lo';
}

// ---------------------------------------------------------------------------
// 6.1 概览"本轮岗位排序"（仅展示排序，不重算任何 Runtime 结果）
// 优先级：Recommendation（引擎枚举顺序）→ Career Score 降序 → CV Match 降序
// → 三者完全相同时保持原始稳定顺序。未知 Recommendation 不报错、不当作"不推荐"，
// 恒排在全部已知等级之后（rank = KNOWN 之后的最大值），同组保持稳定顺序。
// SoT：tools/lib/scoring.mjs RECOMMENDATION_LEVELS = ['强烈推荐','推荐','一般','不推荐','硬红线跳过']
// ---------------------------------------------------------------------------
export const RECOMMENDATION_RANK = Object.freeze({
  '强烈推荐': 0,
  '推荐': 1,
  '一般': 2,
  '不推荐': 3,
  '硬红线跳过': 4, // 引擎唯一枚举（scoring.mjs）
  '硬红线': 4,     // 展示层别名容错（recommendationCells 同款文案）
  'SKIP': 4,       // canonical 状态别名容错
});
const UNKNOWN_REC_RANK = 5;

export function rankJobs(jobs) {
  const list = (Array.isArray(jobs) ? jobs : []).map((j, i) => ({ j, i }));
  list.sort((x, y) => {
    const a = x.j.analysis || {}, b = y.j.analysis || {};
    const rx = RECOMMENDATION_RANK[a.recommendation] ?? UNKNOWN_REC_RANK;
    const ry = RECOMMENDATION_RANK[b.recommendation] ?? UNKNOWN_REC_RANK;
    if (rx !== ry) return rx - ry;
    const cx = (a.career_ops_score != null && Number.isFinite(Number(a.career_ops_score))) ? Number(a.career_ops_score) : -1;
    const cy = (b.career_ops_score != null && Number.isFinite(Number(b.career_ops_score))) ? Number(b.career_ops_score) : -1;
    if (cx !== cy) return cy - cx;
    const vx = (a.cv_match_score != null && Number.isFinite(Number(a.cv_match_score))) ? Number(a.cv_match_score) : -1;
    const vy = (b.cv_match_score != null && Number.isFinite(Number(b.cv_match_score))) ? Number(b.cv_match_score) : -1;
    if (vx !== vy) return vy - vx;
    return x.i - y.i;
  });
  return list.map(x => x.j);
}

// confidence 展示守卫：percent/level 缺失（null/undefined/非有限数）→ "—" / 省略，绝不显示 "null%"
const confPercentText = (c) =>
  (c && c.percent != null && String(c.percent).trim() !== '' && Number.isFinite(Number(c.percent)))
    ? `${c.percent}%` : '—';
const confLevelSuffix = (c) =>
  (c && c.level != null && String(c.level).trim() !== '') ? ` · ${c.level}` : '';
const confCls = (c) =>
  (c && c.percent != null && Number.isFinite(Number(c.percent))) ? confClassOf(Number(c.percent)) : '';

/**
 * 三层结果卡（详情页 d-verdict 的四张卡数据）：
 *   卡1 CV Match 0-100（%）｜卡2 Career Score 0-100（/100）｜卡3 Recommendation（Runtime 枚举）
 *   ｜卡4 可信度 —— score_confidence = Career Score 可信度（评分引擎契约
 *   effective/total），cv_match_confidence = CV Match 层可信度；两者绝不平均/加权/
 *   合成第三个 confidence：有 Career Score 可信度就只显示它，否则回退显示 CV Match
 *   可信度。卡内 label 保持基线形态"可信度 · level"（.v-label 为 nowrap+ellipsis，
 *   长 label 会在三档宽度截断）；"Career Score 层语义"由详情评分明细汇总行的
 *   "评分可信度（Career Score）"长 label 承载（app.js），本卡不重复。
 * @param {object} a 聚合后的 analysis
 */
export function verdictCards(a = {}) {
  const cv = a.cv_match_score;
  const career = a.career_ops_score ?? a.career_score ?? a.score ?? null;
  const careerConf = a.score_confidence || null;
  const cvConf = a.cv_match_confidence || null;
  const conf = careerConf
    ? {
        num: confPercentText(careerConf),
        label: `可信度${confLevelSuffix(careerConf)}`,
        cls: confCls(careerConf),
      }
    : cvConf
      ? {
          num: confPercentText(cvConf),
          label: `可信度${confLevelSuffix(cvConf)}`,
          cls: confCls(cvConf),
        }
      : { num: '—', label: '可信度', cls: '' };
  return [
    { id: 'cv', num: cv != null ? `${cv}%` : '—', label: '简历匹配度', cls: 'cv' },
    { id: 'career', num: career != null ? String(career) : '—', label: '综合评分 / 100', cls: 'ops' },
    { id: 'rec', num: a.recommendation || '—', label: '推荐结论', cls: recClassOf(a.recommendation) },
    { id: 'conf', num: conf.num, label: conf.label, cls: conf.cls },
  ];
}

/**
 * 概览"推荐结果"五格（强烈推荐/推荐/一般/不推荐/硬红线）——顺序与文案固定，
 * 数值全部来自 Runtime 聚合 by_recommendation，不硬编码任何真实计数。
 */
export function recommendationCells(byRec) {
  const r = byRec && typeof byRec === 'object' ? byRec : {};
  return [
    ['强烈推荐', r['强烈推荐'] || 0, 'rc-strong'],
    ['推荐', r['推荐'] || 0, 'rc-good'],
    ['一般', r['一般'] || 0, 'rc-neutral'],
    ['不推荐', r['不推荐'] || 0, 'rc-neutral'],
    ['硬红线', r['硬红线跳过'] || 0, 'rc-neutral'],
  ];
}
