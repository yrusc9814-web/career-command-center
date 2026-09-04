// phase6-fixtures.mjs — Phase 6 Dashboard 对齐测试夹具（匿名合成数据，非真实岗位）
//
// 隐私约束（Phase 6 验收硬性要求）：
//   - 禁止真实公司名 / 真实 Boss job id / Boss URL / 真实联系人 / 真实用户姓名 /
//     当前雇主 / 真实报告文件名 / 完整真实 JD / 真实私人薪资偏好；
//   - 岗位/公司/城市/人名全部为"示例"占位，job_id 固定 fixture-00N，job_url = null。
//
// 三个夹具对应三种必须同时成立并正确展示的语义：
//   fixture-001  CV 58 + Career 31（旧 2.24 → (2.24−1)×25）+ 不推荐 —— 原因围绕：严重职级下降、薪资、工作制、
//                真实采购能力（纯执行下单，无供应商决策权）。
//   fixture-002  CV 48 + Career 45（旧 2.8 → (2.8−1)×25）+ 不推荐 —— 必须表达"有供应商开发/寻源（sourcing）
//                能力"；真正硬缺口 = 目标品类（生鲜）供应商资源与渠道，禁止写成
//                "缺少采购能力 / 缺 sourcing 能力"。
//   fixture-003  CV 84 + Career 70（旧 3.8 → (3.8−1)×25）+ 不推荐 —— 高 CV Match + 较高 Career Score +
//                candidate-side blocker 同时成立；不推荐来自 blocker/决策链，
//                与"岗位价值不足"无关。

export const FIXTURE_001 = {
  job_id: 'fixture-001',
  title: '采购专员',
  company: '示例零部件制造公司',
  salary: '5-8K', salary_min: 5, salary_max: 8, salary_months: null,
  city: '示例市', district: '示例区A', experience: '1-3年', education: '大专',
  description: '【岗位职责】\n1. 负责生产物料下单、跟单与交期跟进；\n2. 对接供应商对账与来料异常处理。\n【任职要求】\n1. 1-3年采购执行经验；\n2. 熟悉ERP基本操作。\n【其他】\n大小周排班，包吃住。',
  benefits: '五险', company_industry: '零部件制造', company_size: '100-499人',
  recruiter_name: '示例招聘者', recruiter_title: '人事', recruiter_active_status: '近期活跃',
  job_url: null, published_at: null, collected_at: '2026-08-29T10:00:00+08:00',
  notes: null,
  analysis: {
    cv_match_score: 58,
    cv_match_confidence: { percent: 88, level: '高' },
    career_ops_score: 31.0,
    career_score: 31.0,
    rule_score: null,
    score_confidence: { percent: 90, level: '高' },
    score_breakdown: {
      total_weight: 100, effective_weight: 90, weighted_sum: 2715,
      dimensions: [
        { key: 'compensation', name: '薪酬竞争力', weight: 20, score: 12.5, weighted_value: 250, status: 'known', reason: '带宽低于候选人区间下沿，工时折算后时薪缩水', evidence: 'JD 薪资段' },
        { key: 'workload_workstyle', name: '工作制与强度', weight: 15, score: 0, weighted_value: 0, status: 'known', reason: 'JD 明示大小周排班', evidence: 'JD 作息段' },
        { key: 'role_seniority', name: '职级质量与职责范围', weight: 13, score: 0, weighted_value: 0, status: 'known', reason: '纯执行下单跟单，明显低于候选人现职级', evidence: 'JD 职责段' },
        { key: 'career_growth', name: '成长空间', weight: 10, score: 67.5, weighted_value: 675, status: 'known', reason: '有上升叙事但无机制证据', evidence: 'JD 晋升段' },
        { key: 'category_domain_value', name: '品类与行业价值', weight: 10, score: 66.5, weighted_value: 665, status: 'known', reason: '相邻品类（secondary）', evidence: 'JD 品类' },
        { key: 'procurement_ownership', name: '采购自主权', weight: 9, score: 0, weighted_value: 0, status: 'known', reason: '纯执行下单，无供应商决策权', evidence: 'JD 职责动词（协助/跟进）' },
        { key: 'company_stability', name: '公司与业务稳定性', weight: 7, score: null, weighted_value: null, status: 'unknown', reason: '工商信息未披露', evidence: null },
        { key: 'location_fit', name: '地点与通勤', weight: 8, score: 75, weighted_value: 600, status: 'known', reason: '目标城市其他区，通勤可接受', evidence: 'JD 地址段' },
        { key: 'digital_tooling', name: '数字化与工具成熟度', weight: 5, score: 75, weighted_value: 375, status: 'known', reason: '有 ERP 日常使用', evidence: 'JD 工具要求段' },
        { key: 'hiring_process_quality', name: '招聘流程质量', weight: 3, score: 50, weighted_value: 150, status: 'known', reason: '常规直招无异常', evidence: 'JD 元数据' },
      ],
    },
    recommendation: '不推荐',
    recommendation_reason: '职级严重倒退（Career Score 31.0/100）；同时命中 salary_floor_breach、work_schedule_blocker',
    decision_trace: [
      { step: 0, rule: 'hard_redline_or_deal_breakers', input: { hard_redline: false, deal_breakers_hit: false }, outcome: 'miss' },
      { step: 1, rule: 'candidate_side_blocker', input: { severe_level_downgrade: true, salary_floor_breach: true, work_schedule_blocker: true }, outcome: 'severe_level_downgrade+salary_floor_breach+work_schedule_blocker' },
      { step: 2, rule: 'job_side_ineligible', input: { eligibility_ineligible: false, eligibility_status: 'eligible' }, outcome: 'miss' },
      { step: 3, rule: 'decision_matrix', input: { career_ops_score: 31.0, cv_match_score: 58 }, outcome: '不推荐' },
      { step: 5, rule: 'career_below_50_with_gaps', input: { career_ops_score: 31.0, has_hard_gap: true, eligibility_status: 'eligible' }, outcome: '不推荐' },
    ],
    blockers: {
      current_employer_conflict: false, salary_floor_breach: true, severe_level_downgrade: true,
      location_blocker: false, work_schedule_blocker: true, travel_refusal: false,
    },
    hard_gaps: [],
    soft_gaps: ['无供应商开发与谈判主导经验（现有经历以执行下单为主）'],
    eligibility_status: 'eligible',
    taxonomy: { primary_archetype: null, secondary_archetypes: ['零部件制造品类'] },
    capability_summary: { sourcing: 'weak', category_management: 'no_evidence', digital_tools: 'medium' },
    strengths: ['同域零部件行业采购执行经验完整', 'ERP 日常操作熟练'],
    gaps: ['薪资低于底线', '大小周工作制与不可接受项冲突', '纯执行下单，无供应商开发与谈判主导证据'],
    cv_advice: '① 突出供应商开发主导经历；② 量化降本结果。',
    interview_focus: '确认职级与独立负责范围。',
    hard_redline: false,
  },
};

export const FIXTURE_002 = {
  job_id: 'fixture-002',
  title: '生鲜采购专员',
  company: '示例生鲜供应链公司',
  salary: '6-9K', salary_min: 6, salary_max: 9, salary_months: 13,
  city: '示例市', district: '示例区B', experience: '1-3年', education: '不限',
  description: '【岗位职责】\n1. 负责生鲜品类供应商开发、比价与谈判；\n2. 维护品类供应商资源池。\n【任职要求】\n1. 有生鲜品类供应商资源/渠道者优先；\n2. 具备供应商开发经验。',
  benefits: '五险', company_industry: '生鲜供应链', company_size: '50-99人',
  recruiter_name: '示例招聘者B', recruiter_title: '采购负责人', recruiter_active_status: '近期活跃',
  job_url: null, published_at: null, collected_at: '2026-08-29T10:10:00+08:00',
  notes: null,
  analysis: {
    cv_match_score: 48,
    cv_match_confidence: { percent: 80, level: '中' },
    career_ops_score: 45.0,
    career_score: 45.0,
    rule_score: null,
    score_confidence: { percent: 72, level: '中' },
    score_breakdown: {
      total_weight: 100, effective_weight: 100, weighted_sum: 4500.25,
      dimensions: [
        { key: 'compensation', name: '薪酬竞争力', weight: 20, score: 37.5, weighted_value: 750, status: 'known', reason: '带宽贴近候选人区间下沿', evidence: 'JD 薪资段' },
        { key: 'workload_workstyle', name: '工作制与强度', weight: 15, score: 50, weighted_value: 750, status: 'known', reason: '未提及且无强加班信号', evidence: 'JD 作息段' },
        { key: 'role_seniority', name: '职级质量与职责范围', weight: 13, score: 50, weighted_value: 650, status: 'known', reason: '高级专员级，独立负责完整品类执行', evidence: 'JD 职责段' },
        { key: 'career_growth', name: '成长空间', weight: 10, score: 50, weighted_value: 500, status: 'known', reason: '有上升叙事但无机制证据', evidence: 'JD 晋升段' },
        { key: 'category_domain_value', name: '品类与行业价值', weight: 10, score: 0, weighted_value: 0, status: 'known', reason: '生鲜品类与既有履历为相邻迁移', evidence: 'JD 品类 vs 档案' },
        { key: 'procurement_ownership', name: '采购自主权', weight: 9, score: 62.5, weighted_value: 562.5, status: 'known', reason: '独立负责供应商开发与谈判参与', evidence: 'JD 职责动词（负责/开发）' },
        { key: 'company_stability', name: '公司与业务稳定性', weight: 7, score: 50, weighted_value: 350, status: 'known', reason: '存续 5 年+中型企业，单一信源无负面', evidence: '工商信息' },
        { key: 'location_fit', name: '地点与通勤', weight: 8, score: 50, weighted_value: 400, status: 'known', reason: '目标城市其他区，通勤增加', evidence: 'JD 地址段' },
        { key: 'digital_tooling', name: '数字化与工具成熟度', weight: 5, score: 25, weighted_value: 125, status: 'known', reason: '以 Excel+手工单据为主', evidence: 'JD 工具要求段' },
        { key: 'hiring_process_quality', name: '招聘流程质量', weight: 3, score: 54.25, weighted_value: 162.75, status: 'known', reason: '常规直招无异常', evidence: 'JD 元数据' },
      ],
    },
    recommendation: '不推荐',
    recommendation_reason: '决策矩阵：Career Score 45.0/100（career_score 25-49）× CV Match 48/100（cv 40-59）→ 不推荐',
    dimensions: { primary: '生鲜/食品品类采购', known_categories: ['生鲜'], effective_weight: 100 },
    decision_trace: [
      { step: 0, rule: 'hard_redline_or_deal_breakers', input: { hard_redline: false, deal_breakers_hit: false }, outcome: 'miss' },
      { step: 1, rule: 'candidate_side_blocker', input: {}, outcome: 'miss' },
      { step: 2, rule: 'job_side_ineligible', input: { eligibility_ineligible: false, eligibility_status: 'eligible_with_gaps' }, outcome: 'miss' },
      { step: 3, rule: 'decision_matrix', input: { career_ops_score: 45.0, cv_match_score: 48 }, outcome: '不推荐' },
      { step: 4, rule: 'eligible_with_gaps_downgrade_cap', input: { eligibility_status: 'eligible_with_gaps', base: '不推荐' }, outcome: '不推荐' },
    ],
    blockers: {
      current_employer_conflict: false, salary_floor_breach: false, severe_level_downgrade: false,
      location_blocker: false, work_schedule_blocker: false, travel_refusal: false,
    },
    hard_gaps: ['目标品类（生鲜）供应商资源与渠道不足：现有供应商开发经验集中在相邻品类，缺少生鲜品类的货源/渠道积累'],
    soft_gaps: ['无生鲜品类直采与损耗管理经验'],
    eligibility_status: 'eligible_with_gaps',
    taxonomy: { primary_archetype: '生鲜/食品品类采购', secondary_archetypes: ['食品供应链'] },
    capability_summary: { sourcing: 'strong', supplier_development: 'strong', category_management: 'no_evidence', negotiation: 'medium' },
    strengths: ['具备供应商开发与寻源（sourcing）能力：有主导新供应商引入与比价谈判的经历', '有品类降本与供应商绩效管理经验'],
    gaps: ['目标品类（生鲜）供应商资源与渠道不足'],
    cv_advice: '① 补充品类迁移叙事；② 量化供应商引入数量与降本幅度。',
    interview_focus: '确认生鲜品类资源要求是否可放宽。',
    hard_redline: false,
  },
};

export const FIXTURE_003 = {
  job_id: 'fixture-003',
  title: '采购主管',
  company: '示例装备制造公司',
  salary: '10-14K', salary_min: 10, salary_max: 14, salary_months: 13,
  city: '示例市', district: '示例区C', experience: '3-5年', education: '本科',
  description: '【岗位职责】\n1. 独立负责品类寻源策略与供应商结构优化；\n2. 主导年度降本与供应商绩效管理。\n【任职要求】\n1. 3-5年采购经验；\n2. 本科及以上。',
  benefits: '五险一金', company_industry: '装备制造', company_size: '500-999人',
  recruiter_name: '示例招聘者C', recruiter_title: 'HRBP', recruiter_active_status: '近期活跃',
  job_url: null, published_at: null, collected_at: '2026-08-29T10:20:00+08:00',
  notes: null,
  analysis: {
    cv_match_score: 84,
    cv_match_confidence: { percent: 92, level: '高' },
    career_ops_score: 70.0,
    career_score: 70.0,
    rule_score: null,
    score_confidence: { percent: 100, level: '高' },
    score_breakdown: {
      total_weight: 100, effective_weight: 100, weighted_sum: 6999.75,
      dimensions: [
        { key: 'compensation', name: '薪酬竞争力', weight: 20, score: 75, weighted_value: 1500, status: 'known', reason: '落在候选人区间中段，13薪加分', evidence: 'JD 薪资段' },
        { key: 'workload_workstyle', name: '工作制与强度', weight: 15, score: 75, weighted_value: 1125, status: 'known', reason: '标准工时，无强加班信号', evidence: 'JD 作息段' },
        { key: 'role_seniority', name: '职级质量与职责范围', weight: 13, score: 75, weighted_value: 975, status: 'known', reason: '主管级，独立背品类 KPI，职责含寻源策略', evidence: 'JD 职责段+汇报线' },
        { key: 'career_growth', name: '成长空间', weight: 10, score: 75, weighted_value: 750, status: 'known', reason: '写明晋升窗口且业务扩张', evidence: 'JD 晋升段' },
        { key: 'category_domain_value', name: '品类与行业价值', weight: 10, score: 75, weighted_value: 750, status: 'known', reason: '主路径品类（primary archetype）', evidence: 'JD 品类 vs 档案' },
        { key: 'procurement_ownership', name: '采购自主权', weight: 9, score: 87.5, weighted_value: 787.5, status: 'known', reason: '完整 sourcing/品类 ownership', evidence: 'JD 职责动词（负责/主导）' },
        { key: 'company_stability', name: '公司与业务稳定性', weight: 7, score: 75, weighted_value: 525, status: 'known', reason: '规模企业+多年经营+多客户', evidence: '工商信息+详情页' },
        { key: 'location_fit', name: '地点与通勤', weight: 8, score: 0, weighted_value: 0, status: 'known', reason: '工作地点与候选人显式地点约束冲突', evidence: 'JD 地址段' },
        { key: 'digital_tooling', name: '数字化与工具成熟度', weight: 5, score: 75, weighted_value: 375, status: 'known', reason: '成熟 ERP+SRM', evidence: 'JD 工具要求段' },
        { key: 'hiring_process_quality', name: '招聘流程质量', weight: 3, score: 70.75, weighted_value: 212.25, status: 'known', reason: '流程与时限透明', evidence: 'JD 元数据' },
      ],
    },
    recommendation: '不推荐',
    recommendation_reason: 'JD 工作地点与候选人显式地点约束冲突（Career Score 70.0/100）',
    decision_trace: [
      { step: 0, rule: 'hard_redline_or_deal_breakers', input: { hard_redline: false, deal_breakers_hit: false }, outcome: 'miss' },
      { step: 1, rule: 'candidate_side_blocker', input: { location_blocker: true }, outcome: 'location_blocker' },
    ],
    blockers: {
      current_employer_conflict: false, salary_floor_breach: false, severe_level_downgrade: false,
      location_blocker: true, work_schedule_blocker: false, travel_refusal: false,
    },
    hard_gaps: [],
    soft_gaps: [],
    eligibility_status: 'eligible',
    taxonomy: { primary_archetype: '装备制造品类采购', secondary_archetypes: [] },
    capability_summary: { sourcing: 'strong', supplier_development: 'strong', negotiation: 'strong', category_management: 'strong' },
    strengths: ['品类寻源策略经验与 JD 高度对口', '主导年度降本的量化结果完整'],
    gaps: ['工作地点在候选人显式约束之外'],
    cv_advice: '① 强调品类 KPI 背书经历。',
    interview_focus: '确认地点约束是否可协商。',
    hard_redline: false,
  },
};

// 真实旧格式形态（Phase 3 前已评分报告；legacy 兼容夹具，保留旧 1-5 量纲字面量 2.58 ——
// 用于锁定 aggregator/loader 对旧数据不崩溃，不作为新制契约。Round 1 后真实数据已全部迁移）：
// 四值字段存在且范围合法（照常展示，不整体降级），
// 旧 115 权重 score_breakdown 为退役维度（不进评分明细），但完全没有 Phase 4+ 新字段
// （decision_trace / blockers / hard_gaps / soft_gaps / cv_match_confidence / taxonomy /
//  capability_summary / dimensions / hard_requirements / eligibility_status / career_score）。
export const LEGACY_SCORED_RUN = {
  run_at: '2026-08-27T14:00:00+08:00',
  config: { target_titles: ['采购专员'], target_city: ['示例市'], target_districts: ['示例区A'], salary_min_k: 5, salary_max_k: 10 },
  counters: { discovered: 15, opened: 1, collected: 1, skipped: 0, analyzed: 1, failed: 0 },
  jobs: [{
    job_id: 'fixture-legacy-scored',
    title: '采购专员',
    company: '示例存档制造公司',
    salary: '5-8K', salary_min: 5, salary_max: 8, salary_months: null,
    city: '示例市', district: '示例区A', experience: '1-3年', education: '大专',
    description: '【岗位职责】\n1. 负责物料下单与跟单。\n【任职要求】\n1. 1-3年采购执行经验。',
    benefits: '五险', company_industry: '零部件制造', company_size: '100-499人',
    recruiter_name: '示例招聘者D', recruiter_title: '人事', recruiter_active_status: '近期活跃',
    job_url: null, published_at: null, collected_at: '2026-08-27T13:00:00+08:00',
    notes: null,
    analysis: {
      cv_match: '72%',
      cv_match_score: 72,
      score: 2.58,
      career_ops_score: 2.58,
      rule_score: 5.0,
      score_confidence: { percent: 95.7, level: '高' },
      score_breakdown: {
        total_weight: 115, effective_weight: 110, weighted_sum: 284,
        dimensions: [
          { key: 'north_star', name: '北极星对齐', weight: 25, score: 3, weighted_value: 75, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'cv_match', name: 'CV匹配', weight: 15, score: 3.6, weighted_value: 54, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'level', name: '级别', weight: 10, score: 2, weighted_value: 20, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'comp', name: 'Comp（含工时折算）', weight: 10, score: 1.5, weighted_value: 15, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'growth', name: '成长路径', weight: 5, score: 3, weighted_value: 15, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'worklife', name: '工时与生活', weight: 5, score: 2, weighted_value: 10, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'stability', name: '公司稳定性', weight: 5, score: 3, weighted_value: 15, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'tech_modernity', name: '技术栈现代度', weight: 10, score: 2.5, weighted_value: 25, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'process_speed', name: '流程速度', weight: 5, score: null, weighted_value: null, status: 'unknown', reason: '无证据', evidence: null },
          { key: 'culture', name: '文化信号', weight: 2, score: 2, weighted_value: 4, status: 'known', reason: 'r', evidence: 'e' },
        ],
      },
      recommendation: '不推荐',
      recommendation_reason: '职级严重倒退（Career Ops Score 2.58/5）',
      strengths: ['同域执行经验完整'],
      gaps: ['纯执行下单，无供应商开发与谈判主导证据'],
      cv_advice: '① 突出供应商开发主导经历。',
      interview_focus: '确认职级与独立负责范围。',
      hard_redline: false,
    },
  }],
};

export const PHASE6_RUN = {
  run_at: '2026-08-29T11:00:00+08:00',
  config: { target_titles: ['采购专员', '采购主管'], target_city: ['示例市'], target_districts: ['示例区A', '示例区B'], salary_min_k: 6, salary_max_k: 14 },
  counters: { discovered: 30, opened: 3, collected: 3, skipped: 0, analyzed: 3, failed: 0 },
  run_mode: 'phase6-fixture',
  risk_events: [],
  jobs: [FIXTURE_001, FIXTURE_002, FIXTURE_003],
};

// 旧格式报告（Phase 3 前）：分析字段大面积缺失/退役维度，Dashboard 必须降级展示不崩溃
export const LEGACY_RUN = {
  run_at: '2026-08-20T11:00:00+08:00',
  config: { target_titles: ['采购专员'], target_city: ['示例市'], target_districts: [], salary_min_k: 6, salary_max_k: 12 },
  counters: { discovered: 10, opened: 1, collected: 1, skipped: 0, analyzed: 1, failed: 0 },
  jobs: [{
    job_id: 'fixture-legacy',
    title: '采购专员',
    company: '示例旧数据公司',
    salary: '7-10K', salary_min: 7, salary_max: 10, salary_months: null,
    city: '示例市', district: null, experience: '1-3年', education: '大专',
    description: '示例旧 JD 文本',
    benefits: null, company_industry: null, company_size: null,
    recruiter_name: null, recruiter_title: null, recruiter_active_status: null,
    job_url: null, published_at: null, collected_at: '2026-08-20T10:00:00+08:00',
    notes: null,
    analysis: {
      cv_match: '72%',
      score: null,
      score_breakdown: {
        total_weight: 115, effective_weight: 110, weighted_sum: 284,
        dimensions: [
          { key: 'north_star', name: '北极星对齐', weight: 25, score: 3, weighted_value: 75, status: 'known', reason: 'r', evidence: 'e' },
          { key: 'process_speed', name: '流程速度', weight: 5, score: null, weighted_value: null, status: 'unknown', reason: '无证据', evidence: null },
        ],
      },
      recommendation: null,
      recommendation_reason: null,
      strengths: [], gaps: [], cv_advice: null, interview_focus: null, hard_redline: false,
    },
  }],
};
