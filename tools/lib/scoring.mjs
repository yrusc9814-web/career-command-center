// scoring.mjs — Career Ops 评分引擎（纯函数，可单测）
//
// Phase 3（2026-08-29）：维度表切换为 PROCUREMENT_ARCHETYPE_AUDIT.md §23.2 冻结的
// 采购 10 维 × 权重 100（Career Score 方向 = Job→Candidate Value，见 §22.3/§23）。
//
// 旧维度退役（§23.1）：north_star / cv_match / level / comp / growth / worklife /
// stability / tech_modernity / process_speed / culture 不再是评分维度。
//   - 旧 key 兼容读取但必为 unknown：传入 computeScore 一律忽略（不计入、不报错、
//     不出现在输出 dimensions 数组、不进分子与分母），不为兼容保留任何旧维度计算；
//   - 旧 score-inputs 数据重算 → 全 unknown → career_ops_score=null（"有效维度不足"）；
//   - north_star 的"背景对口"语义移入 CV Match 层（tools/lib/cv-match.mjs，
//     cv_match_score 0-100，与 Career Score 独立、互不引用对方字段）；
//   - tech_modernity/process_speed 分别由 digital_tooling / hiring_process_quality
//     接管；culture 并入 workload_workstyle——均为新定义，不是旧维度的别名计算。
//
// 1/3/5 评分细则唯一 SoT = 本文件 SCORING_RUBRIC；prompt 层
// （modes/offer.md、batch/batch-prompt.md）文本与其同步，prompt 只列 key+中文名+权重+指向。
//
// 数学与输出 schema（与上一版完全一致，仅总权重 115→100）：
//   career_ops_score = Σ(score_i × weight_i) / Σ(valid_weight_i)
//   unknown 维度（score=null）不进入分子与分母，输出 score_confidence = effective/total。
//   阈值 ≥85/≥60 维持不变。Dashboard 只展示本引擎的结果，不自行计算。
//
// Round 1 量纲迁移（2026-09-03）：Career Score 正式数据契约 1-5 → 0-100。
// Round 1B 修正（2026-09-03）：正式映射改为仿射等价 new = (old − 1) × 25（真正 0-100），
//   覆盖 Round 1 错误的线性 new = old × 20（那个把范围变成 20-100）。差异：
//   - 维度分与 career_ops_score 统一真 0-100（旧 1/3/5 定义卡 → 0/50/100）；
//   - 维度合法输入区间 [0,100]（旧 [1,5] 的仿射像：0 = 原 1 分，100 = 原 5 分）；
//   - 所有 recommendation 阈值等价迁移：4.5/4.0/3.0/2.0 → 87.5/75/50/25，
//     Step 5 career<3.0 → career<50；
//   - score_confidence 一直就是 0-100（effective/total×100），本轮无迁移；
//   - score_scale: '0-100' + score_scale_version: 2 随输出落盘（schema 版本标记，
//     区分 legacy 1-5 / Round1 错误 20-100 / 正式 true 0-100；旧 1-5 数据必须先跑
//     tools/migrate-score-scale.mjs，禁止运行时任何模糊猜测）；
//   - decision matrix / trace / recommendation_reason 文案同步换新量纲
//     （career_score ≥75 / Career Score 79/100），用户可见文案仍由
//     dashboard-web/lib/view-model.mjs reasonZh() 统一转译。
//
// Phase 4（2026-08-29）：computeRecommendation 扩展为 §22.4 决策链唯一 SoT——
// Step 0-5 优先级链 + 决策矩阵（行=career 档 × 列=cv 档）+ 缺口封顶，全部只在本文件
// 实现（eligibility.mjs 仅组装证据并调用本函数，禁止第二套决策实现）。新增入参全部
// 可选、缺省即 Phase 3 旧行为（legacy 布尔-only 调用逐字节兼容）；输出新增 trace[]
// 附加字段。铁律：blocker/封顶只覆盖 recommendation，绝不修改 cv_match_score、
// career_ops_score 或两套 confidence（测试以 deepEqual 前后对照锁定）。
//
// Phase 4.1（2026-08-29，P2-2 checkpoint 小修）：has_hard_gap 封顶加防御性 guard——仅
// eligibility_status='eligible'（或缺省 legacy 调用）时生效，显式非 eligible 状态不再应用
// 封顶（DESIGN FREEZE §22.4 裁决② precondition 强制；不改矩阵格子、不改 Step 顺序、
// 不改 blocker 行为），详见 computeRecommendation Step 5 内注释。

// ---------------------------------------------------------------------------
// 冻结 10 维 + 1/3/5 定义卡（PROCUREMENT_ARCHETYPE_AUDIT.md §23.2 逐字，合计权重 = 100）
// ---------------------------------------------------------------------------

export const SCORING_RUBRIC = [
  {
    key: 'compensation', name: '薪酬竞争力', weight: 20,
    rubric: {
      '0': '带宽触/低于用户区间下沿，或工时折算后时薪明显缩水',
      '50': '落在用户区间中段、总包结构正常',
      '100': '中位≥区间上限或市场中位上沿，且 13薪/期权等总包加分',
    },
    evidence_hint: 'JD 薪资福利段 + 同城同职级外部基准',
    unknown_rule: 'JD 未写→null',
  },
  {
    key: 'workload_workstyle', name: '工作制与强度', weight: 15,
    rubric: {
      '0': 'JD 明示大小周/早班分拣/长加班',
      '50': '未提及且无强加班信号',
      '100': '明确双休+标准工时原文',
    },
    evidence_hint: 'JD 作息段/小提示/福利',
    unknown_rule: '未写→null（禁行业刻板印象）',
  },
  {
    key: 'role_seniority', name: '职级质量与职责范围', weight: 13,
    rubric: {
      '0': '纯执行（下单/跟单），低于候选人现职级',
      '50': '高级专员级，独立负责完整品类执行无带人',
      '100': '主管级带人或独立背品类 KPI，职责含策略（寻源策略/供应商结构）',
    },
    evidence_hint: 'JD title+职责段+汇报线',
    unknown_rule: 'title 模糊且职责缺失→null',
  },
  {
    key: 'career_growth', name: '成长空间', weight: 10,
    rubric: {
      '0': '职责静态/业务收缩/单一品类无扩展',
      '50': '有上升叙事但无机制证据',
      '100': '写明晋升机制+时间窗（调薪/评审窗口）且业务扩张',
    },
    evidence_hint: 'JD 晋升段+公司规模/业务线',
    unknown_rule: '无叙事→null',
  },
  {
    key: 'category_domain_value', name: '品类与行业价值', weight: 10,
    rubric: {
      '0': '品类对目标履历无迁移价值',
      '50': '相邻品类（secondary/adjacent）',
      '100': '主路径品类（primary archetype）',
    },
    evidence_hint: 'JD 品类/行业 vs profile archetypes',
    unknown_rule: '品类不明→null',
  },
  {
    key: 'procurement_ownership', name: '采购自主权', weight: 9,
    rubric: {
      '0': '纯执行下单，权限极低，无供应商决策权',
      '50': '独立负责部分供应商/品类，有谈判与选择参与权',
      '100': '完整 sourcing/supplier strategy/category ownership',
    },
    evidence_hint: 'JD 职责动词（"负责/决策" vs "协助/跟进"）',
    unknown_rule: '无职责段→null',
  },
  {
    key: 'company_stability', name: '公司与业务稳定性', weight: 7,
    rubric: {
      '0': '成立<2 年/经营异常/裁员信号',
      '50': '存续 5 年+中型企业，单一信源无负面',
      '100': '规模大或细分头部+多年经营+自有产能/多客户',
    },
    evidence_hint: '工商信息+详情页+外部信源',
    unknown_rule: '工商缺失→null',
  },
  {
    key: 'location_fit', name: '地点与通勤', weight: 8,
    rubric: {
      '0': '非目标城市或需外派驻厂',
      '50': '目标城市其他区，通勤显著增加',
      '100': '目标区且通勤不恶化',
    },
    evidence_hint: 'JD 地址段',
    unknown_rule: '地址不明→null',
  },
  {
    key: 'digital_tooling', name: '数字化与工具成熟度', weight: 5,
    rubric: {
      '0': '纯 Excel+手工单据',
      '50': '有 ERP 日常使用',
      '100': '成熟 ERP+SRM/数字化采购平台或采购系统建设投入',
    },
    evidence_hint: 'JD 工具要求段+公司系统描述',
    unknown_rule: '无描述→null',
  },
  {
    key: 'hiring_process_quality', name: '招聘流程质量', weight: 3,
    rubric: {
      '0': '长期挂岗/重复发布/中介代招/付费陷阱',
      '50': '常规直招无异常',
      '100': '流程与时限透明或猎头/内推渠道',
    },
    evidence_hint: 'JD 元数据+渠道+面试观察',
    unknown_rule: '无证据→null（继承 process_speed 教训，故仅 3 分）',
  },
];

// 评分维度表（形状与旧版一致：{key, name, weight}；权重/中文名唯一来源 = SCORING_RUBRIC）
export const DIMENSIONS = SCORING_RUBRIC.map(({ key, name, weight }) => ({ key, name, weight }));

export const TOTAL_WEIGHT = DIMENSIONS.reduce((s, d) => s + d.weight, 0); // 100

export const RECOMMENDATION_LEVELS = ['强烈推荐', '推荐', '一般', '不推荐', '硬红线跳过'];

const round = (v, n) => {
  const p = 10 ** n;
  return Math.round(v * p) / p;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function validScore(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;           // NaN/Infinity/非数字 → unknown
  return clamp(Math.round(n * 100) / 100, 0, 100); // 有限数值夹到 [0,100]（旧 [1,5] 的 (x−1)×25 像），null 永不变 0
}

/**
 * @param {Array<{key:string,score:number|null,reason?:string,evidence?:string}>|Object} dimInputs
 *   按 key 索引或数组；score=null / 缺失 / 非有限值 → unknown，不入分母。
 *   仅接受 DIMENSIONS 中的 key；旧维度 key（north_star/cv_match/level/comp/growth/
 *   worklife/stability/tech_modernity/process_speed/culture）与其他未知 key 一律忽略，
 *   不计入、不报错、不出现在输出 dimensions 数组。
 */
export function computeScore(dimInputs) {
  const byKey = new Map(
    (Array.isArray(dimInputs) ? dimInputs : []).map(d => [d.key, d])
  );

  let weightedSum = 0;
  let effectiveWeight = 0;
  const dims = DIMENSIONS.map(({ key, name, weight }) => {
    const input = byKey.get(key) || {};
    const score = validScore(input.score);
    const known = score !== null;
    if (known) {
      weightedSum += score * weight;
      effectiveWeight += weight;
    }
    return {
      key, name, weight,
      score: known ? score : null,
      weighted_value: known ? round(score * weight, 2) : null,
      status: known ? 'known' : 'unknown',
      reason: input.reason || null,
      evidence: input.evidence || null,
    };
  });

  const careerOpsScore = effectiveWeight > 0
    ? clamp(round(weightedSum / effectiveWeight, 2), 0, 100)
    : null;

  const percent = round((effectiveWeight / TOTAL_WEIGHT) * 100, 1);
  const confidenceLevel = percent >= 85 ? '高' : percent >= 60 ? '中' : '低';

  return {
    career_ops_score: careerOpsScore,
    score_scale: '0-100', // Round 1B schema 标记：正式数值量纲（旧 1-5 数据须先迁移）
    score_scale_version: 2, // 2 = true 0-100（Round1 的 ×20 错误态无此字段，可据此识别）
    score_confidence: { percent, level: confidenceLevel },
    score_breakdown: {
      total_weight: TOTAL_WEIGHT,
      effective_weight: effectiveWeight,
      weighted_sum: round(weightedSum, 2),
      dimensions: dims,
    },
  };
}

/** 分数档位（仅当无 blocker 时作为 Recommendation 基础档；阈值 = 旧 4.5/4.0/3.0 的 (x−1)×25 仿射像） */
export function scoreBand(score) {
  if (score === null || score === undefined) return '不推荐';
  if (score >= 87.5) return '强烈推荐';
  if (score >= 75) return '推荐';
  if (score >= 50) return '一般';
  return '不推荐';
}

// ---------------------------------------------------------------------------
// Recommendation 决策链（PROCUREMENT_ARCHETYPE_AUDIT.md §22.4 + Phase 4 落地裁决；
// 决策矩阵与 Step 0-5 的唯一实现处 —— RECOMMENDATION_LEVELS 与矩阵只定义在本文件）
// ---------------------------------------------------------------------------

// 决策矩阵（§22.4 冻结表）：行 = career_ops_score 档位，列 = cv_match_score 档位。
// 值 = [recommendation 枚举, 挑战岗标注]；"挑战岗"只出现在 ≥75 行且只写入
// recommendation_reason（recommendation 本体恒为 RECOMMENDATION_LEVELS 五档枚举）。
// 歧义格裁决（Phase 4）：career_score 60-79 × cv 60-79 = 推荐（与 legacy band 最接近，
// 无"挑战岗"标注）。cv_match_score 缺失/非有限数值 → 不查矩阵，回落 scoreBand（legacy）。
// Round 1B 量纲迁移：行界 = 旧 4.0/3.0/2.0 的 (x−1)×25 仿射像 = 75/50/25，格子语义与旧表逐格等价。
// 注意小数边界：行归属由比较运算决定（≥75 / ≥50 / ≥25），74.99 仍属 50-74 档。
const RECOMMENDATION_MATRIX = Object.freeze({
  'ge75':    { ge80: ['强烈推荐', ''], '60_79': ['推荐', '挑战岗'], '40_59': ['一般', '挑战岗'], lt40: ['不推荐', ''] },
  '50-74':   { ge80: ['推荐', ''], '60_79': ['推荐', ''], '40_59': ['一般', ''], lt40: ['不推荐', ''] },
  '25-49':   { ge80: ['一般', ''], '60_79': ['一般', ''], '40_59': ['不推荐', ''], lt40: ['不推荐', ''] },
  'lt25':    { ge80: ['不推荐', ''], '60_79': ['不推荐', ''], '40_59': ['不推荐', ''], lt40: ['不推荐', ''] },
  // career_ops_score 不可判定（null/非数值）→ '不推荐'（理由"有效维度不足"）
  'unknown': { ge80: ['不推荐', ''], '60_79': ['不推荐', ''], '40_59': ['不推荐', ''], lt40: ['不推荐', ''] },
});

const CAREER_ROW_LABEL = Object.freeze({
  'ge75': 'career_score ≥75', '50-74': 'career_score 50-74', '25-49': 'career_score 25-49',
  'lt25': 'career_score <25', unknown: 'career_score 未知（有效维度不足）',
});
const CV_COL_LABEL = Object.freeze({ ge80: 'cv ≥80', '60_79': 'cv 60-79', '40_59': 'cv 40-59', lt40: 'cv <40' });

function careerRowOf(career) {
  if (career === null) return 'unknown';
  if (career >= 75) return 'ge75';
  if (career >= 50) return '50-74';
  if (career >= 25) return '25-49';
  return 'lt25';
}

function cvColOf(cv) {
  if (cv >= 80) return 'ge80';
  if (cv >= 60) return '60_79';
  if (cv >= 40) return '40_59';
  return 'lt40';
}

// eligible_with_gaps 整体降一档（§22.4 裁决②）
const GAP_DOWNGRADE = Object.freeze({ '强烈推荐': '推荐', '推荐': '一般', '一般': '不推荐', '不推荐': '不推荐' });
// 封顶"推荐"（HARD_GAP / eligible_with_gaps；禁强烈推荐）
const capAtRecommend = (level) => (level === '强烈推荐' ? '推荐' : level);

/**
 * Recommendation 独立于分数：综合 评分 + 硬红线 + candidate-side blocker（现任雇主/
 * 薪资底线/严重级别倒退/地点/工作制/出差）+ job-side 资格 blocker + deal_breakers
 * + 决策矩阵 + 缺口封顶。高分手动 blocker 不会被覆盖；任何路径绝不修改
 * cv_match_score / career_ops_score / 两套 confidence。
 *
 * 优先级链（§22.4，严格顺序）：
 *   Step 0  hard_redline || deal_breakers_hit → '硬红线跳过'
 *   Step 1  任一 candidate-side blocker → '不推荐'（reason 注明命中项）
 *   Step 2  eligibility_ineligible（job-side）→ '不推荐'
 *   Step 3  查矩阵（仅当 cv_match_score 为有限数值；否则回落 scoreBand = legacy 路径）
 *   Step 4  eligibility_status='eligible_with_gaps' → 降一档后封顶"推荐"
 *   Step 5  has_hard_gap → 封顶"推荐"（Phase 4.1 guard：仅 eligibility_status='eligible'
 *           或缺省 legacy 调用时生效，见 Step 5 内注释）；career < 50 时无论 ④⑤ 仍为'不推荐'
 *
 * 兼容性（Phase 3 legacy）：
 *   - 全部 Phase 4 新入参可选，缺省（false/null/缺字段）= Phase 3 旧行为；
 *   - 旧布尔-only 调用（无 eligibility_status/cv_match_score）的 recommendation 与
 *     recommendation_reason 逐字节一致（单 blocker 命中文案原样保留；多 blocker 时
 *     仅当调用含 Phase 4 新参数才追加具名列出，legacy 混传多布尔仍取首项文案）；
 *   - 输出新增 trace[]（{step, rule, input, outcome}，每步一行）为附加字段，
 *     旧调用方读取 recommendation/recommendation_reason 不受影响。
 *
 * @param {object} input
 * @param {number|null} [input.career_ops_score]
 * @param {boolean} [input.hard_redline] Step 0 硬红线
 * @param {string} [input.redline_reason]
 * @param {boolean} [input.deal_breakers_hit] Step 0
 * @param {boolean} [input.current_employer_conflict] Step 1 candidate-side
 * @param {boolean} [input.salary_floor_breach] Step 1 candidate-side
 * @param {boolean} [input.severe_level_downgrade] Step 1 candidate-side（判据 = seniorityGap ≥2 档）
 * @param {boolean} [input.location_blocker] Step 1 candidate-side（Phase 4 新增）
 * @param {boolean} [input.work_schedule_blocker] Step 1 candidate-side（Phase 4 新增）
 * @param {boolean} [input.travel_refusal] Step 1 candidate-side（Phase 4 新增）
 * @param {boolean} [input.eligibility_ineligible] Step 2 job-side（Phase 4 新增）
 * @param {boolean} [input.has_hard_gap] Step 5 封顶（Phase 4 新增；Phase 4.1 guard：仅
 *        eligibility_status='eligible' 或缺省 legacy 调用时生效，显式非 eligible 状态不封顶）
 * @param {string|null} [input.eligibility_status] 'eligible'|'eligible_with_gaps'|'ineligible'|'unknown'（Phase 4 新增）
 * @param {number|null} [input.cv_match_score] 0-100；缺失/非有限数值 → 回落 scoreBand（Phase 4 新增）
 * @param {string} [input.extra_reason]
 * @returns {{recommendation:string, recommendation_reason:string, trace:Array<{step:number, rule:string, input:object, outcome:string}>}}
 */
export function computeRecommendation(input = {}) {
  const {
    career_ops_score = null,
    hard_redline = false,
    redline_reason = '',
    deal_breakers_hit = false,
    current_employer_conflict = false,
    salary_floor_breach = false,
    severe_level_downgrade = false,
    location_blocker = false,
    work_schedule_blocker = false,
    travel_refusal = false,
    eligibility_ineligible = false,
    has_hard_gap = false,
    eligibility_status = null,
    cv_match_score = null,
    extra_reason = '',
  } = input;

  const trace = [];
  const record = (step, rule, inputRow, outcome) => { trace.push({ step, rule, input: inputRow, outcome }); };

  const scoreText = career_ops_score === null || career_ops_score === undefined
    ? '有效维度不足，无法给出可信分数'
    : `Career Score ${career_ops_score}/100`;

  // 矩阵查表用的数值归一（scoreText/reason 保留调用方原值格式）
  const careerNum = (career_ops_score === null || career_ops_score === undefined || !Number.isFinite(Number(career_ops_score)))
    ? null
    : Number(career_ops_score);
  const cvNum = (cv_match_score === null || cv_match_score === undefined || cv_match_score === '' || !Number.isFinite(Number(cv_match_score)))
    ? null
    : Number(cv_match_score);
  const hasCv = cvNum !== null;

  // 是否携带 Phase 4 新参数（决定 Step 1 多命中时是否追加具名列出，保证 legacy 逐字节兼容）
  const hasPhase4Signal = hasCv
    || (eligibility_status !== null && eligibility_status !== undefined)
    || !!location_blocker
    || !!work_schedule_blocker
    || !!travel_refusal
    || !!eligibility_ineligible
    || !!has_hard_gap;

  // --- Step 0：硬红线 / deal_breakers（沿用 Phase 3 truthy 语义，保证 legacy 兼容）---
  const redlineHit = !!(hard_redline || deal_breakers_hit);
  record(0, 'hard_redline_or_deal_breakers', { hard_redline: !!hard_redline, deal_breakers_hit: !!deal_breakers_hit },
    redlineHit ? 'hit' : 'miss');

  // --- Step 1：candidate-side blocker（链序 = Phase 3 顺序 + Phase 4 新三项；truthy 语义同上）---
  const candidateSideDefs = [
    ['current_employer_conflict', !!current_employer_conflict, '现任雇主/关联主体岗位，不构成外部跳槽机会'],
    ['salary_floor_breach', !!salary_floor_breach, '低于候选人薪资底线'],
    ['severe_level_downgrade', !!severe_level_downgrade, '职级严重倒退'],
    ['location_blocker', !!location_blocker, 'JD 工作地点与候选人显式地点约束冲突'],
    ['work_schedule_blocker', !!work_schedule_blocker, 'JD 明示工作制与候选人声明的不可接受项冲突'],
    ['travel_refusal', !!travel_refusal, 'JD 明示常驻出差/外派，候选人明确拒绝'],
  ];
  const candidateHits = candidateSideDefs.filter(([, hit]) => hit);
  record(1, 'candidate_side_blocker',
    Object.fromEntries(candidateSideDefs.map(([key, hit]) => [key, hit])),
    candidateHits.length ? candidateHits.map(([key]) => key).join('+') : 'miss');

  // --- Step 2：job-side 资格 blocker ---
  const jobSideHit = !!eligibility_ineligible || eligibility_status === 'ineligible';
  record(2, 'job_side_ineligible', { eligibility_ineligible: !!eligibility_ineligible, eligibility_status },
    jobSideHit ? 'hit' : 'miss');

  const parts = [];
  let recommendation;

  if (redlineHit) {
    recommendation = '硬红线跳过';
    parts.push(`命中硬红线/deal_breakers${redline_reason ? `：${redline_reason}` : ''}`);
  } else if (candidateHits.length > 0) {
    recommendation = '不推荐';
    if (candidateHits.length === 1 || !hasPhase4Signal) {
      // 单命中（或 legacy 混传多布尔）：沿用 Phase 3 首项文案，逐字节兼容
      parts.push(`${candidateHits[0][2]}（${scoreText}）`);
    } else {
      parts.push(`${candidateHits[0][2]}（${scoreText}）；同时命中 ${candidateHits.slice(1).map(([key]) => key).join('、')}`);
    }
  } else if (jobSideHit) {
    recommendation = '不推荐';
    parts.push(`硬性资格不满足（eligibility=ineligible，job-side blocker）（${scoreText}）`);
  } else {
    // --- Step 3：决策矩阵（仅当 cv_match_score 为有限数值）；否则回落 scoreBand（legacy）---
    let base;
    if (hasCv) {
      const row = careerRowOf(careerNum);
      const col = cvColOf(cvNum);
      const [level, tag] = RECOMMENDATION_MATRIX[row][col];
      base = level;
      if (careerNum === null) {
        parts.push('有效维度不足，无法给出可信分数（Career Score 缺失，矩阵不适用）');
      } else {
        parts.push(`决策矩阵：Career Score ${career_ops_score}/100（${CAREER_ROW_LABEL[row]}）× CV Match ${cvNum}/100（${CV_COL_LABEL[col]}）→ ${level}${tag ? `（${tag}）` : ''}`);
      }
    } else {
      base = scoreBand(career_ops_score);
      parts.push(scoreText);
    }
    record(3, hasCv ? 'decision_matrix' : 'score_band_fallback',
      { career_ops_score, cv_match_score: cvNum }, base);

    const gapsPresent = eligibility_status === 'eligible_with_gaps' || !!has_hard_gap;
    const careerBelow3 = careerNum !== null && careerNum < 50; // 旧 career<3.0 的 (x−1)×25 等价阈值

    // --- Step 4：eligible_with_gaps → 降一档后封顶"推荐"（career<50 由 Step 5 兜底为不推荐）---
    if (eligibility_status === 'eligible_with_gaps') {
      const post = capAtRecommend(GAP_DOWNGRADE[base]);
      record(4, 'eligible_with_gaps_downgrade_cap', { eligibility_status, base }, post);
      if (post !== base && !careerBelow3) {
        parts.push(`eligibility=eligible_with_gaps：${base} 降一档并封顶"推荐" → ${post}`);
      }
      base = post;
    }

    // --- Step 5：has_hard_gap 封顶"推荐"（Phase 4.1 防御性 guard）；career < 50 时无论 ④⑤ 仍为'不推荐' ---
    // guard（Phase 4.1 P2-2；DESIGN FREEZE §22.4 裁决②"has_hard_gap（且 eligibility=eligible）→
    // 仅封顶推荐"）：封顶仅在语义合法状态生效。显式传入 eligibility_status 的调用方仅
    // 'eligible' 时应用——'eligible_with_gaps' 已有 Step 4 降一档封顶路径（has_hard_gap 不叠加
    // 额外降档）、'ineligible' 已在 Step 2 短路、'unknown' 走矩阵不封顶，矛盾参数不再可达。
    // eligibility_status 缺省（null/undefined，legacy 布尔-only 协议；decide() 真实链路恒传
    // status，该组合不可达）保留 Phase 4 既有封顶行为，维持"legacy 调用逐字节兼容"冻结承诺。
    const hardGapCapApplies = !!has_hard_gap
      && (eligibility_status === 'eligible' || eligibility_status === null || eligibility_status === undefined);
    if (gapsPresent && careerBelow3) {
      base = '不推荐';
      const gapDesc = [
        eligibility_status === 'eligible_with_gaps' ? 'eligible_with_gaps' : null,
        has_hard_gap ? 'HARD_GAP' : null,
      ].filter(Boolean).join('+');
      parts.push(`存在资格缺口（${gapDesc}）且 Career Score ${career_ops_score}/100 < 50 → 不推荐`);
      record(5, 'career_below_50_with_gaps', { career_ops_score, has_hard_gap: !!has_hard_gap, eligibility_status }, '不推荐');
    } else if (hardGapCapApplies) {
      const post = capAtRecommend(base);
      record(5, 'has_hard_gap_cap', { has_hard_gap, base }, post);
      if (post !== base) parts.push(`存在 HARD_GAP：封顶"推荐"（${base} → ${post}）`);
      base = post;
    }

    recommendation = base;
  }

  if (extra_reason) parts.push(extra_reason);

  return { recommendation, recommendation_reason: parts.join('；'), trace };
}

/**
 * 一步完成：dimensions → score + confidence + breakdown + recommendation
 */
export function evaluate(dimInputs, recommendationInput = {}) {
  const s = computeScore(dimInputs);
  const r = computeRecommendation({ career_ops_score: s.career_ops_score, ...recommendationInput });
  return { ...s, ...r };
}
