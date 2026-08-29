// scoring.test.mjs — 评分引擎单元测试（node --test）
// Run: node --test tools/tests/scoring.test.mjs
//
// Phase 3：维度表 = PROCUREMENT_ARCHETYPE_AUDIT.md §23.2 冻结 10 维 × 权重 100；
// SCORING_RUBRIC 1/3/5 定义卡逐字对齐 §23.2；旧维度（north_star 等）退役——
// 传入被忽略、必为 unknown、不进分子分母；数学与输出 schema 与上一版完全一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIMENSIONS, TOTAL_WEIGHT, SCORING_RUBRIC, RECOMMENDATION_LEVELS,
  computeScore, computeRecommendation, scoreBand, evaluate,
} from '../lib/scoring.mjs';

const allDims = (score) => DIMENSIONS.map(d => ({ key: d.key, score }));

// §23.2 维度定义卡冻结字面量（逐字）：rubric 1/3/5 + evidence_hint + unknown_rule
const RUBRIC_FROZEN = [
  { key: 'compensation', name: '薪酬竞争力', weight: 20,
    rubric: { '1': '带宽触/低于用户区间下沿，或工时折算后时薪明显缩水', '3': '落在用户区间中段、总包结构正常', '5': '中位≥区间上限或市场中位上沿，且 13薪/期权等总包加分' },
    evidence_hint: 'JD 薪资福利段 + 同城同职级外部基准', unknown_rule: 'JD 未写→null' },
  { key: 'workload_workstyle', name: '工作制与强度', weight: 15,
    rubric: { '1': 'JD 明示大小周/早班分拣/长加班', '3': '未提及且无强加班信号', '5': '明确双休+标准工时原文' },
    evidence_hint: 'JD 作息段/小提示/福利', unknown_rule: '未写→null（禁行业刻板印象）' },
  { key: 'role_seniority', name: '职级质量与职责范围', weight: 13,
    rubric: { '1': '纯执行（下单/跟单），低于候选人现职级', '3': '高级专员级，独立负责完整品类执行无带人', '5': '主管级带人或独立背品类 KPI，职责含策略（寻源策略/供应商结构）' },
    evidence_hint: 'JD title+职责段+汇报线', unknown_rule: 'title 模糊且职责缺失→null' },
  { key: 'career_growth', name: '成长空间', weight: 10,
    rubric: { '1': '职责静态/业务收缩/单一品类无扩展', '3': '有上升叙事但无机制证据', '5': '写明晋升机制+时间窗（调薪/评审窗口）且业务扩张' },
    evidence_hint: 'JD 晋升段+公司规模/业务线', unknown_rule: '无叙事→null' },
  { key: 'category_domain_value', name: '品类与行业价值', weight: 10,
    rubric: { '1': '品类对目标履历无迁移价值', '3': '相邻品类（secondary/adjacent）', '5': '主路径品类（primary archetype）' },
    evidence_hint: 'JD 品类/行业 vs profile archetypes', unknown_rule: '品类不明→null' },
  { key: 'procurement_ownership', name: '采购自主权', weight: 9,
    rubric: { '1': '纯执行下单，权限极低，无供应商决策权', '3': '独立负责部分供应商/品类，有谈判与选择参与权', '5': '完整 sourcing/supplier strategy/category ownership' },
    evidence_hint: 'JD 职责动词（"负责/决策" vs "协助/跟进"）', unknown_rule: '无职责段→null' },
  { key: 'company_stability', name: '公司与业务稳定性', weight: 7,
    rubric: { '1': '成立<2 年/经营异常/裁员信号', '3': '存续 5 年+中型企业，单一信源无负面', '5': '规模大或细分头部+多年经营+自有产能/多客户' },
    evidence_hint: '工商信息+详情页+外部信源', unknown_rule: '工商缺失→null' },
  { key: 'location_fit', name: '地点与通勤', weight: 8,
    rubric: { '1': '非目标城市或需外派驻厂', '3': '目标城市其他区，通勤显著增加', '5': '目标区且通勤不恶化' },
    evidence_hint: 'JD 地址段', unknown_rule: '地址不明→null' },
  { key: 'digital_tooling', name: '数字化与工具成熟度', weight: 5,
    rubric: { '1': '纯 Excel+手工单据', '3': '有 ERP 日常使用', '5': '成熟 ERP+SRM/数字化采购平台或采购系统建设投入' },
    evidence_hint: 'JD 工具要求段+公司系统描述', unknown_rule: '无描述→null' },
  { key: 'hiring_process_quality', name: '招聘流程质量', weight: 3,
    rubric: { '1': '长期挂岗/重复发布/中介代招/付费陷阱', '3': '常规直招无异常', '5': '流程与时限透明或猎头/内推渠道' },
    evidence_hint: 'JD 元数据+渠道+面试观察', unknown_rule: '无证据→null（继承 process_speed 教训，故仅 3 分）' },
];

test('T1 10 维冻结：key/中文名/权重 = §23.2，权重和 = 100，SCORING_RUBRIC 与定义卡逐字一致', () => {
  assert.equal(DIMENSIONS.length, 10);
  assert.equal(TOTAL_WEIGHT, 100);
  assert.deepEqual(DIMENSIONS, RUBRIC_FROZEN.map(({ key, name, weight }) => ({ key, name, weight })));
  // SCORING_RUBRIC 是唯一 SoT：全 10 维 rubric（1/3/5 逐字）+ evidence_hint + unknown_rule
  assert.deepEqual(
    SCORING_RUBRIC.map(({ key, name, weight, rubric, evidence_hint, unknown_rule }) => ({ key, name, weight, rubric, evidence_hint, unknown_rule })),
    RUBRIC_FROZEN
  );
  for (const r of SCORING_RUBRIC) {
    assert.deepEqual(Object.keys(r.rubric).sort(), ['1', '3', '5']);
    for (const v of Object.values(r.rubric)) assert.ok(typeof v === 'string' && v.length > 0);
    assert.ok(r.evidence_hint.length > 0);
    assert.ok(r.unknown_rule.includes('null'));
  }
});

test('T2 全维度 5 分 → 5.0，有效权重 100，置信度 100%/高', () => {
  const r = computeScore(allDims(5));
  assert.equal(r.career_ops_score, 5.0);
  assert.equal(r.score_breakdown.effective_weight, 100);
  assert.equal(r.score_breakdown.total_weight, 100);
  assert.deepEqual(r.score_confidence, { percent: 100, level: '高' });
});

test('T3 全维度 1 分 → 1.0', () => {
  assert.equal(computeScore(allDims(1)).career_ops_score, 1.0);
});

test('T4 100 权重归一化（异构分数手算校验：365/97 = 3.76）', () => {
  const inputs = [
    { key: 'compensation', score: 5 },            // 100
    { key: 'workload_workstyle', score: 3 },      // 45
    { key: 'role_seniority', score: 4 },          // 52
    { key: 'career_growth', score: 4 },           // 40
    { key: 'category_domain_value', score: 2 },   // 20
    { key: 'procurement_ownership', score: 3 },   // 27
    { key: 'location_fit', score: 5 },            // 40
    { key: 'company_stability', score: 3 },       // 21
    { key: 'digital_tooling', score: 4 },         // 20
    { key: 'hiring_process_quality', score: null }, // unknown → 出分母
  ];
  const r = computeScore(inputs);
  assert.equal(r.career_ops_score, 3.76); // 365 / 97
  assert.equal(r.score_breakdown.weighted_sum, 365);
  assert.equal(r.score_breakdown.effective_weight, 97);
  assert.equal(r.score_confidence.percent, 97);
  assert.equal(r.score_confidence.level, '高');
});

test('T5 unknown 不入分母：null 不拉低总分（仅 compensation 5 分 → 5.0）', () => {
  const r = computeScore([{ key: 'compensation', score: 5 }]);
  assert.equal(r.career_ops_score, 5.0);
  assert.equal(r.score_breakdown.effective_weight, 20);
  assert.equal(r.score_confidence.percent, 20);
  assert.equal(r.score_confidence.level, '低');
});

test('T6 9 维 5 分 + hiring_process_quality unknown → 仍 5.0（97%）', () => {
  const inputs = allDims(5).map(d =>
    d.key === 'hiring_process_quality' ? { ...d, score: null, reason: '无证据' } : d
  );
  const r = computeScore(inputs);
  assert.equal(r.career_ops_score, 5.0);
  assert.equal(r.score_breakdown.effective_weight, 97);
  const hp = r.score_breakdown.dimensions.find(d => d.key === 'hiring_process_quality');
  assert.equal(hp.status, 'unknown');
  assert.equal(hp.score, null);
  assert.equal(hp.weighted_value, null);
  assert.equal(r.score_confidence.percent, 97);
  assert.equal(r.score_confidence.level, '高');
});

test('T7 输出恒在 [1,5] 且有限（NaN/Infinity/越界/字符串输入不炸）', () => {
  const inputs = [
    { key: 'compensation', score: 7 },            // 越界 → clamp 5
    { key: 'workload_workstyle', score: 0 },      // <1 → clamp 1
    { key: 'role_seniority', score: NaN },        // unknown
    { key: 'career_growth', score: Infinity },    // unknown
    { key: 'category_domain_value', score: 'abc' }, // unknown
    { key: 'procurement_ownership', score: -3 },  // clamp 1
  ];
  const r = computeScore(inputs);
  assert.ok(Number.isFinite(r.career_ops_score));
  assert.ok(r.career_ops_score >= 1 && r.career_ops_score <= 5);
  for (const d of r.score_breakdown.dimensions) {
    if (d.status === 'known') {
      assert.ok(d.score >= 1 && d.score <= 5, `dim ${d.key} score in range`);
      assert.ok(Number.isFinite(d.weighted_value));
    } else {
      assert.equal(d.weighted_value, null);
    }
  }
  // 5×20 + 1×15 + 1×9 = 124 / 44 = 2.8181… → 2.82
  assert.equal(r.career_ops_score, 2.82);
  assert.equal(r.score_breakdown.effective_weight, 44);
});

test('T8 confidence 阈值边界（>=85 高 / 60-84 中 / <60 低；全 unknown → null）', () => {
  const known = (...keys) => keys.map(k => ({ key: k, score: 4 }));
  // 84 → 中
  const mid84 = computeScore(known(
    'compensation', 'workload_workstyle', 'role_seniority', 'career_growth',
    'category_domain_value', 'procurement_ownership', 'company_stability'
  ));
  assert.equal(mid84.score_breakdown.effective_weight, 84);
  assert.equal(mid84.score_confidence.percent, 84);
  assert.equal(mid84.score_confidence.level, '中');
  // 85 → 高
  const hi85 = computeScore(known(
    'compensation', 'workload_workstyle', 'role_seniority', 'career_growth',
    'category_domain_value', 'procurement_ownership', 'location_fit'
  ));
  assert.equal(hi85.score_breakdown.effective_weight, 85);
  assert.equal(hi85.score_confidence.level, '高');
  // 58 → 低
  const lo58 = computeScore(known('compensation', 'workload_workstyle', 'role_seniority', 'career_growth'));
  assert.equal(lo58.score_breakdown.effective_weight, 58);
  assert.equal(lo58.score_confidence.level, '低');
  // 60 → 中（下边界）
  const mid60 = computeScore(known('compensation', 'workload_workstyle', 'role_seniority', 'digital_tooling', 'company_stability'));
  assert.equal(mid60.score_breakdown.effective_weight, 60);
  assert.equal(mid60.score_confidence.level, '中');
  // 全 unknown → score null，confidence 0/低
  const none = computeScore([]);
  assert.equal(none.career_ops_score, null);
  assert.deepEqual(none.score_confidence, { percent: 0, level: '低' });
});

test('T9 旧维度退役：旧 key 全传入 → 全 unknown → career_ops_score=null，且不出现在 dimensions', () => {
  const legacyInputs = [
    { key: 'north_star', score: 5 },
    { key: 'cv_match', score: 3.6 },
    { key: 'level', score: 2 },
    { key: 'comp', score: 1.5 },
    { key: 'growth', score: 3 },
    { key: 'worklife', score: 2 },
    { key: 'stability', score: 3 },
    { key: 'tech_modernity', score: 2.5 },
    { key: 'process_speed', score: null },
    { key: 'culture', score: 2 },
  ];
  const r = computeScore(legacyInputs);
  assert.equal(r.career_ops_score, null); // 有效维度不足
  assert.deepEqual(r.score_confidence, { percent: 0, level: '低' });
  assert.equal(r.score_breakdown.effective_weight, 0);
  const outKeys = r.score_breakdown.dimensions.map(d => d.key);
  assert.deepEqual(outKeys, DIMENSIONS.map(d => d.key)); // 恰为新 10 维，无旧 key
  for (const d of r.score_breakdown.dimensions) assert.equal(d.status, 'unknown');
  // 旧维度不在 DIMENSIONS/SCORING_RUBRIC
  for (const legacy of ['north_star', 'cv_match', 'level', 'comp', 'growth', 'worklife', 'stability', 'tech_modernity', 'process_speed', 'culture']) {
    assert.ok(!DIMENSIONS.some(d => d.key === legacy), `${legacy} 已退役`);
    assert.ok(!SCORING_RUBRIC.some(d => d.key === legacy), `${legacy} 不在 RUBRIC`);
  }
});

test('T10 旧 key 与新 key 混传：旧 key 被忽略（不计入、不报错、不影响分数）', () => {
  const inputs = [
    { key: 'compensation', score: 5 },
    { key: 'north_star', score: 1 },
    { key: 'cv_match', score: 5 },
    { key: 'level', score: 1 },
    { key: 'comp', score: 1 },
    { key: 'growth', score: 1 },
    { key: 'worklife', score: 1 },
    { key: 'stability', score: 1 },
    { key: 'tech_modernity', score: 1 },
    { key: 'process_speed', score: 1 },
    { key: 'culture', score: 1 },
  ];
  const r = computeScore(inputs);
  assert.equal(r.career_ops_score, 5.0); // 旧 key 全部忽略，仅 compensation 计分
  assert.equal(r.score_breakdown.effective_weight, 20);
  assert.equal(r.score_breakdown.weighted_sum, 100);
});

test('T11 输出 schema 字段名不变（dashboard 兼容）', () => {
  const r = computeScore(allDims(4));
  assert.deepEqual(Object.keys(r).sort(), ['career_ops_score', 'score_breakdown', 'score_confidence']);
  assert.deepEqual(Object.keys(r.score_confidence).sort(), ['level', 'percent']);
  assert.deepEqual(Object.keys(r.score_breakdown).sort(), ['dimensions', 'effective_weight', 'total_weight', 'weighted_sum']);
  const dimKeys = Object.keys(r.score_breakdown.dimensions[0]).sort();
  assert.deepEqual(dimKeys, ['evidence', 'key', 'name', 'reason', 'score', 'status', 'weight', 'weighted_value']);
  assert.ok(r.score_breakdown.dimensions.length === 10);
});

test('T12 十维各自的 1/3/5 单维评分经 computeScore 得到同值（加权归一冒烟）', () => {
  for (const d of DIMENSIONS) {
    for (const v of [1, 3, 5]) {
      const r = computeScore([{ key: d.key, score: v }]);
      assert.equal(r.career_ops_score, v, `${d.key} score=${v}`);
      assert.equal(r.score_breakdown.effective_weight, d.weight);
      const dim = r.score_breakdown.dimensions.find(x => x.key === d.key);
      assert.equal(dim.weighted_value, v * d.weight);
    }
  }
});

test('T13 computeRecommendation blocker 优先级链回归 + scoreBand + RECOMMENDATION_LEVELS', () => {
  const high = allDims(4.9);
  assert.equal(computeRecommendation({ career_ops_score: 4.9, hard_redline: true, redline_reason: '劳务派遣' }).recommendation, '硬红线跳过');
  assert.equal(computeRecommendation({ career_ops_score: 4.9, deal_breakers_hit: true }).recommendation, '硬红线跳过');
  assert.equal(computeRecommendation({ career_ops_score: 4.8, current_employer_conflict: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.7, salary_floor_breach: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.6, severe_level_downgrade: true }).recommendation, '不推荐');
  // 无 blocker → 按分数档位
  const r = evaluate(high);
  assert.equal(r.recommendation, '强烈推荐');
  assert.equal(scoreBand(4.5), '强烈推荐');
  assert.equal(scoreBand(4.2), '推荐');
  assert.equal(scoreBand(3.5), '一般');
  assert.equal(scoreBand(2.9), '不推荐');
  assert.equal(scoreBand(null), '不推荐');
  // 全 unknown → "有效维度不足"
  const none = evaluate([]);
  assert.equal(none.career_ops_score, null);
  assert.equal(none.recommendation, '不推荐');
  assert.ok(none.recommendation_reason.includes('有效维度不足'));
  assert.deepEqual(RECOMMENDATION_LEVELS, ['强烈推荐', '推荐', '一般', '不推荐', '硬红线跳过']);
});

test('T14 evaluate 三指标严格独立（不含 cv_match_score；dimensions 恒 10）', () => {
  const r = evaluate(allDims(4.2), { current_employer_conflict: true });
  assert.equal(r.career_ops_score, 4.2);
  assert.equal(r.recommendation, '不推荐'); // 分数高也被冲突 blocker 覆盖
  assert.ok('cv_match_score' in r === false);
  assert.ok(r.score_breakdown.dimensions.length === 10);
});

// ---------------------------------------------------------------------------
// Phase 4：决策矩阵 + Step 0-5 优先级链 + trace（PROCUREMENT_ARCHETYPE_AUDIT.md §22.4
// + Phase 4 落地裁决；computeRecommendation 是决策链唯一 SoT）
// ---------------------------------------------------------------------------

// 矩阵 16 格便捷取值（有 cv_match_score → 查矩阵；无 → 回落 scoreBand）
const cell = (career, cv) => computeRecommendation({ career_ops_score: career, cv_match_score: cv }).recommendation;

test('T15 决策矩阵 16 格冻结（§22.4）：行=career 档 × 列=cv 档 + 档位边界', () => {
  // ≥4.0 行
  assert.equal(cell(4.0, 80), '强烈推荐');
  assert.equal(cell(4.5, 70), '推荐');   // 挑战岗（标注只进 reason，枚举恒五档）
  assert.equal(cell(4.0, 50), '一般');   // 挑战岗
  assert.equal(cell(4.0, 39), '不推荐');
  // 3.0-3.9 行
  assert.equal(cell(3.9, 80), '推荐');
  assert.equal(cell(3.5, 70), '推荐');   // 歧义格 Phase 4 裁决 = 推荐（无"挑战岗"标注）
  assert.equal(cell(3.5, 50), '一般');
  assert.equal(cell(3.0, 39), '不推荐');
  // 2.0-2.9 行
  assert.equal(cell(2.9, 80), '一般');
  assert.equal(cell(2.5, 70), '一般');
  assert.equal(cell(2.5, 50), '不推荐');
  assert.equal(cell(2.0, 39), '不推荐');
  // <2.0 行
  assert.equal(cell(1.99, 80), '不推荐');
  assert.equal(cell(1.0, 70), '不推荐');
  assert.equal(cell(1.0, 50), '不推荐');
  assert.equal(cell(1.0, 39), '不推荐');
  // cv 列边界（80/79、60/59、40/39）
  assert.equal(cell(3.5, 79), '推荐');
  assert.equal(cell(3.5, 60), '推荐');
  assert.equal(cell(3.5, 59), '一般');
  assert.equal(cell(3.5, 40), '一般');
  assert.equal(cell(3.5, 39), '不推荐');
  // "挑战岗"标注：仅 ≥4.0 行进入 reason；recommendation 本体恒为五档枚举
  const chal = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 70 });
  assert.equal(chal.recommendation, '推荐');
  assert.ok(chal.recommendation_reason.includes('挑战岗'));
  const amb = computeRecommendation({ career_ops_score: 3.5, cv_match_score: 70 });
  assert.ok(!amb.recommendation_reason.includes('挑战岗'));
  assert.ok(amb.recommendation_reason.includes('决策矩阵'));
});

test('T16 legacy 回落与逐字节兼容：cv 缺失 → scoreBand；旧布尔-only 调用文案与 Phase 3 一致；trace 为附加字段', () => {
  // cv_match_score 缺失/非有限数值 → 不查矩阵，回落 scoreBand（legacy 路径）
  assert.equal(computeRecommendation({ career_ops_score: 4.5 }).recommendation, '强烈推荐');
  assert.equal(computeRecommendation({ career_ops_score: 3.5 }).recommendation, '一般');
  assert.equal(computeRecommendation({ career_ops_score: 2.9 }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.5, cv_match_score: 'n/a' }).recommendation, '强烈推荐');
  // career_ops_score=null + 有 cv → '不推荐'（理由"有效维度不足"）
  const nullCareer = computeRecommendation({ career_ops_score: null, cv_match_score: 85 });
  assert.equal(nullCareer.recommendation, '不推荐');
  assert.ok(nullCareer.recommendation_reason.includes('有效维度不足'));
  // 旧布尔-only 调用（无 eligibility_status/cv_match_score）逐字节回归
  const r1 = computeRecommendation({ career_ops_score: 4.9, hard_redline: true, redline_reason: '劳务派遣' });
  assert.deepEqual(
    { recommendation: r1.recommendation, recommendation_reason: r1.recommendation_reason },
    { recommendation: '硬红线跳过', recommendation_reason: '命中硬红线/deal_breakers：劳务派遣' }
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 4.8, current_employer_conflict: true }).recommendation_reason,
    '现任雇主/关联主体岗位，不构成外部跳槽机会（Career Ops Score 4.8/5）'
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 4.7, salary_floor_breach: true }).recommendation_reason,
    '低于候选人薪资底线（Career Ops Score 4.7/5）'
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 4.6, severe_level_downgrade: true }).recommendation_reason,
    '职级严重倒退（Career Ops Score 4.6/5）'
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 3.5 }).recommendation_reason,
    'Career Ops Score 3.5/5'
  );
  // legacy 混传多布尔：仍取首项文案（Phase 3 if-链语义），不追加具名
  assert.equal(
    computeRecommendation({ career_ops_score: 4.8, current_employer_conflict: true, salary_floor_breach: true }).recommendation_reason,
    '现任雇主/关联主体岗位，不构成外部跳槽机会（Career Ops Score 4.8/5）'
  );
  // Phase 4 调用（带新参数）多命中 → 具名列出
  const multi = computeRecommendation({
    career_ops_score: 4.8, current_employer_conflict: true, salary_floor_breach: true, cv_match_score: 90,
  });
  assert.ok(multi.recommendation_reason.includes('同时命中'));
  assert.ok(multi.recommendation_reason.includes('salary_floor_breach'));
  // trace：附加字段，每步含 step/rule/input/outcome 四键
  assert.ok(Array.isArray(r1.trace) && r1.trace.length >= 3);
  for (const t of r1.trace) {
    assert.deepEqual(Object.keys(t).sort(), ['input', 'outcome', 'rule', 'step']);
  }
  assert.deepEqual(r1.trace[0], { step: 0, rule: 'hard_redline_or_deal_breakers', input: { hard_redline: true, deal_breakers_hit: false }, outcome: 'hit' });
  // Step 1 命中后在 trace 中具名（outcome = 命中项 key）
  const tr2 = computeRecommendation({ career_ops_score: 4.8, current_employer_conflict: true });
  assert.equal(tr2.trace.find(t => t.step === 1).outcome, 'current_employer_conflict');
});

test('T17 封顶/降级语义（§22.4 裁决②）：eligible_with_gaps 降一档封顶推荐；has_hard_gap 仅封顶；career<3.0 缺口一律不推荐', () => {
  // eligible_with_gaps：矩阵结果降一档（强烈推荐→推荐→一般→不推荐）后封顶"推荐"
  assert.equal(computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' }).recommendation, '推荐');
  assert.equal(computeRecommendation({ career_ops_score: 3.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' }).recommendation, '一般');
  assert.equal(computeRecommendation({ career_ops_score: 4.5, cv_match_score: 70, eligibility_status: 'eligible_with_gaps' }).recommendation, '一般');
  // has_hard_gap（且未传 status）：仅封顶"推荐"，不降档
  assert.equal(computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, has_hard_gap: true }).recommendation, '推荐');
  assert.equal(computeRecommendation({ career_ops_score: 3.5, cv_match_score: 85, has_hard_gap: true }).recommendation, '推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.5, cv_match_score: 50, has_hard_gap: true }).recommendation, '一般');
  // eligible_with_gaps + has_hard_gap 同传：降一档封顶后再封顶（结果一致）
  assert.equal(computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps', has_hard_gap: true }).recommendation, '推荐');
  // career < 3.0 时无论 ④⑤ 仍为'不推荐'
  assert.equal(computeRecommendation({ career_ops_score: 2.9, cv_match_score: 80, eligibility_status: 'eligible_with_gaps' }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 2.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 2.5, cv_match_score: 85, has_hard_gap: true }).recommendation, '不推荐');
  // career < 3.0 无缺口 → 矩阵结果不受 floor 影响（2.0-2.9 × ≥80 = 一般）
  assert.equal(computeRecommendation({ career_ops_score: 2.5, cv_match_score: 85 }).recommendation, '一般');
  // eligibility_status='ineligible'（即使布尔漏传）→ Step 2 job-side 不推荐
  assert.equal(computeRecommendation({ career_ops_score: 4.5, eligibility_status: 'ineligible' }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.5, eligibility_ineligible: true }).recommendation, '不推荐');
  // Step 1 candidate-side 新三项：location/schedule/travel 任一命中 → 不推荐
  assert.equal(computeRecommendation({ career_ops_score: 4.5, location_blocker: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.5, work_schedule_blocker: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.5, travel_refusal: true }).recommendation, '不推荐');
  // Step 2 命中文案
  const inel = computeRecommendation({ career_ops_score: 4.5, eligibility_ineligible: true });
  assert.ok(inel.recommendation_reason.includes('硬性资格不满足'));
  // trace 记录 step 4/5
  const g4 = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' });
  assert.deepEqual(g4.trace.find(t => t.step === 4), {
    step: 4, rule: 'eligible_with_gaps_downgrade_cap',
    input: { eligibility_status: 'eligible_with_gaps', base: '强烈推荐' }, outcome: '推荐',
  });
  const g5 = computeRecommendation({ career_ops_score: 2.5, cv_match_score: 85, has_hard_gap: true });
  assert.equal(g5.trace.find(t => t.step === 5).rule, 'career_below_3_with_gaps');
  const g5b = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, has_hard_gap: true });
  assert.equal(g5b.trace.find(t => t.step === 5).rule, 'has_hard_gap_cap');
});

test('T18 blocker 只覆盖 Recommendation：任何 blocker 组合不修改 career_ops_score/score_confidence/score_breakdown', () => {
  const dims = allDims(4.2);
  const baseline = computeScore(dims);
  const allBlockers = {
    current_employer_conflict: true, salary_floor_breach: true, severe_level_downgrade: true,
    location_blocker: true, work_schedule_blocker: true, travel_refusal: true,
    eligibility_ineligible: true, has_hard_gap: true, eligibility_status: 'eligible_with_gaps',
    hard_redline: false, deal_breakers_hit: false,
  };
  const blocked = computeRecommendation({ career_ops_score: baseline.career_ops_score, cv_match_score: 90, ...allBlockers });
  assert.equal(blocked.recommendation, '不推荐'); // blocker 生效
  // 分数引擎输出逐字节不变（blocker 不进分数层）
  assert.deepEqual(computeScore(dims), baseline);
  // evaluate 端到端：blocker 前后 career_ops_score / score_confidence / score_breakdown deepEqual 不变
  const clean = evaluate(dims, { cv_match_score: 90 });
  const dirty = evaluate(dims, { cv_match_score: 90, ...allBlockers });
  assert.deepEqual(dirty.career_ops_score, clean.career_ops_score);
  assert.deepEqual(dirty.score_confidence, clean.score_confidence);
  assert.deepEqual(dirty.score_breakdown, clean.score_breakdown);
  assert.notEqual(dirty.recommendation, clean.recommendation); // 只有 recommendation 被覆盖
});

// ---------------------------------------------------------------------------
// Phase 4.1 P2-2（checkpoint 小修）：has_hard_gap 防御性 guard 组合测试（仅追加，
// 不改上方既有断言）。guard 语义 = DESIGN FREEZE §22.4 裁决②"has_hard_gap（且
// eligibility=eligible）→ 仅封顶推荐"的 precondition 强制：
//   - 显式 eligibility_status='eligible' → 封顶生效（矩阵强烈推荐 → 推荐）；
//   - 'eligible_with_gaps' → 仅走 Step 4 降一档封顶路径，has_hard_gap 不叠加额外降档；
//   - 'ineligible' → Step 2 短路，封顶不可达；'unknown' → 走矩阵，不封顶；
//   - 缺省（null/undefined，legacy 布尔-only 协议，decide() 真实链路恒传 status 故不可达）
//     保留 Phase 4 既有封顶行为（T17 锁定），维持 legacy 逐字节兼容承诺。
// 矩阵格子 / Step 0-5 顺序 / blocker 行为零改动；封顶只覆盖 recommendation。
// ---------------------------------------------------------------------------

test('T19 P2-2 ①②：eligible+has_hard_gap 仅封顶"推荐"；eligible_with_gaps+has_hard_gap 与只传 eligible_with_gaps 完全一致（不叠加降档）', () => {
  // ① eligible + has_hard_gap：矩阵 4.5×85 = 强烈推荐 → 封顶"推荐"（trace step5 = has_hard_gap_cap）
  const g1 = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'eligible', has_hard_gap: true });
  assert.equal(g1.recommendation, '推荐');
  assert.ok(g1.recommendation_reason.includes('HARD_GAP'));
  assert.equal(g1.trace.find(t => t.step === 5).rule, 'has_hard_gap_cap');
  // 封顶不升档：3.5×85 = 推荐 → 仍"推荐"，reason 不追加封顶文案
  const g1b = computeRecommendation({ career_ops_score: 3.5, cv_match_score: 85, eligibility_status: 'eligible', has_hard_gap: true });
  assert.equal(g1b.recommendation, '推荐');
  assert.ok(!g1b.recommendation_reason.includes('HARD_GAP'));
  // ② eligible_with_gaps + has_hard_gap：recommendation 与 reason 和只传 eligible_with_gaps 逐字节一致
  const ewgOnly = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' });
  const ewgGap = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps', has_hard_gap: true });
  assert.equal(ewgOnly.recommendation, '推荐'); // 强烈推荐 → 降一档封顶"推荐"
  assert.equal(ewgGap.recommendation, ewgOnly.recommendation);
  assert.equal(ewgGap.recommendation_reason, ewgOnly.recommendation_reason);
  // 3.5×85：推荐 → 降一档 → 一般（has_hard_gap 不再把"一般"二次降档/封顶）
  const ewgOnly2 = computeRecommendation({ career_ops_score: 3.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' });
  const ewgGap2 = computeRecommendation({ career_ops_score: 3.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps', has_hard_gap: true });
  assert.equal(ewgOnly2.recommendation, '一般');
  assert.equal(ewgGap2.recommendation, ewgOnly2.recommendation);
  assert.equal(ewgGap2.recommendation_reason, ewgOnly2.recommendation_reason);
});

test('T20 P2-2 ③④：ineligible+has_hard_gap → Step 2 短路封顶不生效；unknown+has_hard_gap → 矩阵结果不封顶', () => {
  // ③ ineligible + has_hard_gap：Step 2 job-side 短路'不推荐'，无 step5 记录（封顶不可达）
  const g3 = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'ineligible', has_hard_gap: true });
  assert.equal(g3.recommendation, '不推荐');
  assert.ok(g3.recommendation_reason.includes('硬性资格不满足'));
  assert.ok(!g3.trace.some(t => t.step === 5), 'Step 2 短路后不得进入 Step 5 封顶');
  // ④ unknown + has_hard_gap：显式 unknown 走矩阵、不封顶——4.5×85 = 强烈推荐原样输出
  const g4 = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 85, eligibility_status: 'unknown', has_hard_gap: true });
  assert.equal(g4.recommendation, '强烈推荐');
  assert.ok(!g4.trace.some(t => t.step === 5 && t.rule === 'has_hard_gap_cap'), 'unknown 不应用 has_hard_gap 封顶');
  // 同理 4.5×70 = 推荐（挑战岗）原样输出，无封顶记录
  const g4b = computeRecommendation({ career_ops_score: 4.5, cv_match_score: 70, eligibility_status: 'unknown', has_hard_gap: true });
  assert.equal(g4b.recommendation, '推荐');
  assert.ok(g4b.recommendation_reason.includes('挑战岗'));
  assert.ok(!g4b.trace.some(t => t.step === 5 && t.rule === 'has_hard_gap_cap'));
});

test('T21 P2-2 ⑤⑥：矛盾参数不能绕过更高优先级（Step 1/2 先于封顶）；blocker 优先级与文案不变', () => {
  // ⑤ Step 2 先于封顶：eligibility_ineligible=true + has_hard_gap=true + 高分高匹配 → 仍不推荐
  const g5 = computeRecommendation({ career_ops_score: 4.8, cv_match_score: 90, eligibility_ineligible: true, has_hard_gap: true });
  assert.equal(g5.recommendation, '不推荐');
  assert.equal(g5.trace.find(t => t.step === 2).outcome, 'hit');
  assert.ok(!g5.trace.some(t => t.step === 5), '封顶不得先于 Step 2 生效');
  // ⑥ Step 1 先于封顶：current_employer_conflict + has_hard_gap → 不推荐（与 Phase 4 既有行为一致）
  const g6 = computeRecommendation({ career_ops_score: 4.8, cv_match_score: 90, current_employer_conflict: true, has_hard_gap: true });
  assert.equal(g6.recommendation, '不推荐');
  assert.equal(g6.trace.find(t => t.step === 1).outcome, 'current_employer_conflict');
  assert.ok(!g6.trace.some(t => t.step === 5), '封顶不得先于 Step 1 生效');
  // Phase 4 既有单命中文案逐字节回归（legacy 协议不受 guard 影响）
  assert.equal(
    computeRecommendation({ career_ops_score: 4.8, current_employer_conflict: true, has_hard_gap: true }).recommendation_reason,
    '现任雇主/关联主体岗位，不构成外部跳槽机会（Career Ops Score 4.8/5）'
  );
});
