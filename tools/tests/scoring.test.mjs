// scoring.test.mjs — 评分引擎单元测试（node --test）
// Run: node --test tools/tests/scoring.test.mjs
//
// Phase 3：维度表 = PROCUREMENT_ARCHETYPE_AUDIT.md §23.2 冻结 10 维 × 权重 100；
// SCORING_RUBRIC 20/60/100 定义卡（Round 1 起 0-100 制，= 旧 1/3/5 × 20 数学等价）；
// 旧维度（north_star 等）退役——传入被忽略、必为 unknown、不进分子分母。
// Round 1（2026-09-03）：Career Score 正式量纲 1-5 → 0-100（含阈值/矩阵/文案同步迁移，
// 见文件尾 T22 数学等价 + T23 新旧决策表全格等价回归）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIMENSIONS, TOTAL_WEIGHT, SCORING_RUBRIC, RECOMMENDATION_LEVELS,
  computeScore, computeRecommendation, scoreBand, evaluate,
} from '../lib/scoring.mjs';

const allDims = (score) => DIMENSIONS.map(d => ({ key: d.key, score }));

// §23.2 维度定义卡冻结字面量（逐字）：rubric 0/50/100（旧 1/3/5 的 (x−1)×25 仿射像，文案不变）
// + evidence_hint + unknown_rule
const RUBRIC_FROZEN = [
  { key: 'compensation', name: '薪酬竞争力', weight: 20,
    rubric: { '0': '带宽触/低于用户区间下沿，或工时折算后时薪明显缩水', '50': '落在用户区间中段、总包结构正常', '100': '中位≥区间上限或市场中位上沿，且 13薪/期权等总包加分' },
    evidence_hint: 'JD 薪资福利段 + 同城同职级外部基准', unknown_rule: 'JD 未写→null' },
  { key: 'workload_workstyle', name: '工作制与强度', weight: 15,
    rubric: { '0': 'JD 明示大小周/早班分拣/长加班', '50': '未提及且无强加班信号', '100': '明确双休+标准工时原文' },
    evidence_hint: 'JD 作息段/小提示/福利', unknown_rule: '未写→null（禁行业刻板印象）' },
  { key: 'role_seniority', name: '职级质量与职责范围', weight: 13,
    rubric: { '0': '纯执行（下单/跟单），低于候选人现职级', '50': '高级专员级，独立负责完整品类执行无带人', '100': '主管级带人或独立背品类 KPI，职责含策略（寻源策略/供应商结构）' },
    evidence_hint: 'JD title+职责段+汇报线', unknown_rule: 'title 模糊且职责缺失→null' },
  { key: 'career_growth', name: '成长空间', weight: 10,
    rubric: { '0': '职责静态/业务收缩/单一品类无扩展', '50': '有上升叙事但无机制证据', '100': '写明晋升机制+时间窗（调薪/评审窗口）且业务扩张' },
    evidence_hint: 'JD 晋升段+公司规模/业务线', unknown_rule: '无叙事→null' },
  { key: 'category_domain_value', name: '品类与行业价值', weight: 10,
    rubric: { '0': '品类对目标履历无迁移价值', '50': '相邻品类（secondary/adjacent）', '100': '主路径品类（primary archetype）' },
    evidence_hint: 'JD 品类/行业 vs profile archetypes', unknown_rule: '品类不明→null' },
  { key: 'procurement_ownership', name: '采购自主权', weight: 9,
    rubric: { '0': '纯执行下单，权限极低，无供应商决策权', '50': '独立负责部分供应商/品类，有谈判与选择参与权', '100': '完整 sourcing/supplier strategy/category ownership' },
    evidence_hint: 'JD 职责动词（"负责/决策" vs "协助/跟进"）', unknown_rule: '无职责段→null' },
  { key: 'company_stability', name: '公司与业务稳定性', weight: 7,
    rubric: { '0': '成立<2 年/经营异常/裁员信号', '50': '存续 5 年+中型企业，单一信源无负面', '100': '规模大或细分头部+多年经营+自有产能/多客户' },
    evidence_hint: '工商信息+详情页+外部信源', unknown_rule: '工商缺失→null' },
  { key: 'location_fit', name: '地点与通勤', weight: 8,
    rubric: { '0': '非目标城市或需外派驻厂', '50': '目标城市其他区，通勤显著增加', '100': '目标区且通勤不恶化' },
    evidence_hint: 'JD 地址段', unknown_rule: '地址不明→null' },
  { key: 'digital_tooling', name: '数字化与工具成熟度', weight: 5,
    rubric: { '0': '纯 Excel+手工单据', '50': '有 ERP 日常使用', '100': '成熟 ERP+SRM/数字化采购平台或采购系统建设投入' },
    evidence_hint: 'JD 工具要求段+公司系统描述', unknown_rule: '无描述→null' },
  { key: 'hiring_process_quality', name: '招聘流程质量', weight: 3,
    rubric: { '0': '长期挂岗/重复发布/中介代招/付费陷阱', '50': '常规直招无异常', '100': '流程与时限透明或猎头/内推渠道' },
    evidence_hint: 'JD 元数据+渠道+面试观察', unknown_rule: '无证据→null（继承 process_speed 教训，故仅 3 分）' },
];

test('T1 10 维冻结：key/中文名/权重 = §23.2，权重和 = 100，SCORING_RUBRIC 与定义卡逐字一致', () => {
  assert.equal(DIMENSIONS.length, 10);
  assert.equal(TOTAL_WEIGHT, 100);
  assert.deepEqual(DIMENSIONS, RUBRIC_FROZEN.map(({ key, name, weight }) => ({ key, name, weight })));
  // SCORING_RUBRIC 是唯一 SoT：全 10 维 rubric（0/50/100 逐字，Round 1B 仿射锚点）+ evidence_hint + unknown_rule
  assert.deepEqual(
    SCORING_RUBRIC.map(({ key, name, weight, rubric, evidence_hint, unknown_rule }) => ({ key, name, weight, rubric, evidence_hint, unknown_rule })),
    RUBRIC_FROZEN
  );
  for (const r of SCORING_RUBRIC) {
    assert.deepEqual(Object.keys(r.rubric).sort(), ['0', '100', '50']);
    for (const v of Object.values(r.rubric)) assert.ok(typeof v === 'string' && v.length > 0);
    assert.ok(r.evidence_hint.length > 0);
    assert.ok(r.unknown_rule.includes('null'));
  }
});

test('T2 全维度 100 分 → 100，有效权重 100，置信度 100%/高', () => {
  const r = computeScore(allDims(100));
  assert.equal(r.career_ops_score, 100);
  assert.equal(r.score_breakdown.effective_weight, 100);
  assert.equal(r.score_breakdown.total_weight, 100);
  assert.deepEqual(r.score_confidence, { percent: 100, level: '高' });
});

test('T3 全维度 0 分 → 0（真 0 起评）', () => {
  assert.equal(computeScore(allDims(0)).career_ops_score, 0);
});

test('T4 100 权重归一化（异构分数手算校验：6700/97 = 69.07）', () => {
  const inputs = [
    { key: 'compensation', score: 100 },          // 2000（旧 5 → 100）
    { key: 'workload_workstyle', score: 50 },     // 750（旧 3 → 50）
    { key: 'role_seniority', score: 75 },         // 975（旧 4 → 75）
    { key: 'career_growth', score: 75 },          // 750
    { key: 'category_domain_value', score: 25 },  // 250（旧 2 → 25）
    { key: 'procurement_ownership', score: 50 },  // 450
    { key: 'location_fit', score: 100 },          // 800
    { key: 'company_stability', score: 50 },      // 350
    { key: 'digital_tooling', score: 75 },        // 375
    { key: 'hiring_process_quality', score: null }, // unknown → 出分母
  ];
  const r = computeScore(inputs);
  assert.equal(r.career_ops_score, 69.07); // 6700 / 97（旧 365/97 = 3.7629 的仿射像：(3.7629−1)×25 ≈ 69.07）
  assert.equal(r.score_breakdown.weighted_sum, 6700);
  assert.equal(r.score_breakdown.effective_weight, 97);
  assert.equal(r.score_confidence.percent, 97);
  assert.equal(r.score_confidence.level, '高');
});

test('T5 unknown 不入分母：null 不拉低总分（仅 compensation 100 分 → 100）', () => {
  const r = computeScore([{ key: 'compensation', score: 100 }]);
  assert.equal(r.career_ops_score, 100);
  assert.equal(r.score_breakdown.effective_weight, 20);
  assert.equal(r.score_confidence.percent, 20);
  assert.equal(r.score_confidence.level, '低');
});

test('T6 9 维 100 分 + hiring_process_quality unknown → 仍 100（97%）', () => {
  const inputs = allDims(100).map(d =>
    d.key === 'hiring_process_quality' ? { ...d, score: null, reason: '无证据' } : d
  );
  const r = computeScore(inputs);
  assert.equal(r.career_ops_score, 100);
  assert.equal(r.score_breakdown.effective_weight, 97);
  const hp = r.score_breakdown.dimensions.find(d => d.key === 'hiring_process_quality');
  assert.equal(hp.status, 'unknown');
  assert.equal(hp.score, null);
  assert.equal(hp.weighted_value, null);
  assert.equal(r.score_confidence.percent, 97);
  assert.equal(r.score_confidence.level, '高');
});

test('T7 输出恒在 [0,100] 且有限（NaN/Infinity/越界/字符串输入不炸）', () => {
  const inputs = [
    { key: 'compensation', score: 140 },          // 越界 → clamp 100
    { key: 'workload_workstyle', score: 0 },      // 0 合法（真 0 起评）
    { key: 'role_seniority', score: NaN },        // unknown
    { key: 'career_growth', score: Infinity },    // unknown
    { key: 'category_domain_value', score: 'abc' }, // unknown
    { key: 'procurement_ownership', score: -25 }, // <0 → clamp 0
  ];
  const r = computeScore(inputs);
  assert.ok(Number.isFinite(r.career_ops_score));
  assert.ok(r.career_ops_score >= 0 && r.career_ops_score <= 100);
  for (const d of r.score_breakdown.dimensions) {
    if (d.status === 'known') {
      assert.ok(d.score >= 0 && d.score <= 100, `dim ${d.key} score in range`);
      assert.ok(Number.isFinite(d.weighted_value));
    } else {
      assert.equal(d.weighted_value, null);
    }
  }
  // 100×20 + 0×15 + 0×9 = 2000 / 44 = 45.4545… → 45.45
  assert.equal(r.career_ops_score, 45.45);
  assert.equal(r.score_breakdown.effective_weight, 44);
});

test('T8 confidence 阈值边界（>=85 高 / 60-84 中 / <60 低；全 unknown → null）', () => {
  const known = (...keys) => keys.map(k => ({ key: k, score: 75 }));
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
  // 旧维度输入值沿用旧 1-5 制字面量（反正是 ignored，值无所谓）
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
    { key: 'compensation', score: 100 },
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
  assert.equal(r.career_ops_score, 100); // 旧 key 全部忽略，仅 compensation 计分
  assert.equal(r.score_breakdown.effective_weight, 20);
  assert.equal(r.score_breakdown.weighted_sum, 2000);
});

test('T11 输出 schema 字段名不变（dashboard 兼容）', () => {
  const r = computeScore(allDims(75));
  assert.deepEqual(Object.keys(r).sort(), ['career_ops_score', 'score_breakdown', 'score_confidence', 'score_scale', 'score_scale_version']);
  assert.equal(r.score_scale, '0-100');
  assert.equal(r.score_scale_version, 2);
  assert.deepEqual(Object.keys(r.score_confidence).sort(), ['level', 'percent']);
  assert.deepEqual(Object.keys(r.score_breakdown).sort(), ['dimensions', 'effective_weight', 'total_weight', 'weighted_sum']);
  const dimKeys = Object.keys(r.score_breakdown.dimensions[0]).sort();
  assert.deepEqual(dimKeys, ['evidence', 'key', 'name', 'reason', 'score', 'status', 'weight', 'weighted_value']);
  assert.ok(r.score_breakdown.dimensions.length === 10);
});

test('T12 十维各自的 0/50/100 单维评分经 computeScore 得到同值（加权归一冒烟）', () => {
  for (const d of DIMENSIONS) {
    for (const v of [0, 50, 100]) {
      const r = computeScore([{ key: d.key, score: v }]);
      assert.equal(r.career_ops_score, v, `${d.key} score=${v}`);
      assert.equal(r.score_breakdown.effective_weight, d.weight);
      const dim = r.score_breakdown.dimensions.find(x => x.key === d.key);
      assert.equal(dim.weighted_value, v * d.weight);
    }
  }
});

test('T13 computeRecommendation blocker 优先级链回归 + scoreBand + RECOMMENDATION_LEVELS（0-100 阈值 = 旧 (x−1)×25）', () => {
  const high = allDims(97.5);
  assert.equal(computeRecommendation({ career_ops_score: 98, hard_redline: true, redline_reason: '劳务派遣' }).recommendation, '硬红线跳过');
  assert.equal(computeRecommendation({ career_ops_score: 98, deal_breakers_hit: true }).recommendation, '硬红线跳过');
  assert.equal(computeRecommendation({ career_ops_score: 96, current_employer_conflict: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 94, salary_floor_breach: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 92, severe_level_downgrade: true }).recommendation, '不推荐');
  // 无 blocker → 按分数档位（旧 4.5/4.0/3.0 → 87.5/75/50）
  const r = evaluate(high);
  assert.equal(r.recommendation, '强烈推荐');
  assert.equal(scoreBand(87.5), '强烈推荐');
  assert.equal(scoreBand(79), '推荐');
  assert.equal(scoreBand(62.5), '一般');
  assert.equal(scoreBand(48), '不推荐');
  assert.equal(scoreBand(null), '不推荐');
  // 全 unknown → "有效维度不足"
  const none = evaluate([]);
  assert.equal(none.career_ops_score, null);
  assert.equal(none.recommendation, '不推荐');
  assert.ok(none.recommendation_reason.includes('有效维度不足'));
  assert.deepEqual(RECOMMENDATION_LEVELS, ['强烈推荐', '推荐', '一般', '不推荐', '硬红线跳过']);
});

test('T14 evaluate 三指标严格独立（不含 cv_match_score；dimensions 恒 10）', () => {
  const r = evaluate(allDims(80), { current_employer_conflict: true });
  assert.equal(r.career_ops_score, 80);
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

test('T15 决策矩阵 16 格冻结（§22.4）：行=career_score 档 × 列=cv 档 + 档位边界（行界 = 旧 (x−1)×25）', () => {
  // ≥75 行（旧 ≥4.0）
  assert.equal(cell(75, 80), '强烈推荐');
  assert.equal(cell(87.5, 70), '推荐');   // 挑战岗（标注只进 reason，枚举恒五档）
  assert.equal(cell(75, 50), '一般');     // 挑战岗
  assert.equal(cell(75, 39), '不推荐');
  // 50-74 行（旧 3.0-3.9）
  assert.equal(cell(74.99, 80), '推荐');  // 小数边界：74.99 仍属 <75 档
  assert.equal(cell(62.5, 70), '推荐');   // 歧义格 Phase 4 裁决 = 推荐（无"挑战岗"标注）
  assert.equal(cell(62.5, 50), '一般');
  assert.equal(cell(50, 39), '不推荐');
  // 25-49 行（旧 2.0-2.9）
  assert.equal(cell(49.99, 80), '一般');  // 小数边界
  assert.equal(cell(37.5, 70), '一般');
  assert.equal(cell(37.5, 50), '不推荐');
  assert.equal(cell(25, 39), '不推荐');
  // <25 行（旧 <2.0）
  assert.equal(cell(24.99, 80), '不推荐'); // 小数边界
  assert.equal(cell(0, 70), '不推荐');
  assert.equal(cell(0, 50), '不推荐');
  assert.equal(cell(0, 39), '不推荐');
  // cv 列边界（80/79、60/59、40/39）
  assert.equal(cell(62.5, 79), '推荐');
  assert.equal(cell(62.5, 60), '推荐');
  assert.equal(cell(62.5, 59), '一般');
  assert.equal(cell(62.5, 40), '一般');
  assert.equal(cell(62.5, 39), '不推荐');
  // "挑战岗"标注：仅 ≥75 行进入 reason；recommendation 本体恒为五档枚举
  const chal = computeRecommendation({ career_ops_score: 87.5, cv_match_score: 70 });
  assert.equal(chal.recommendation, '推荐');
  assert.ok(chal.recommendation_reason.includes('挑战岗'));
  const amb = computeRecommendation({ career_ops_score: 62.5, cv_match_score: 70 });
  assert.ok(!amb.recommendation_reason.includes('挑战岗'));
  assert.ok(amb.recommendation_reason.includes('决策矩阵'));
  // 新量纲文案：/100 + career_score ≥75 行标识，无旧 /5 表达
  assert.ok(chal.recommendation_reason.includes('Career Score 87.5/100'));
  assert.ok(chal.recommendation_reason.includes('career_score ≥75'));
  assert.ok(!chal.recommendation_reason.includes('/5'));
});

test('T16 legacy 回落与逐字节兼容：cv 缺失 → scoreBand；旧布尔-only 调用文案与 Phase 3 一致；trace 为附加字段', () => {
  // cv_match_score 缺失/非有限数值 → 不查矩阵，回落 scoreBand（legacy 路径）
  assert.equal(computeRecommendation({ career_ops_score: 87.5 }).recommendation, '强烈推荐');
  assert.equal(computeRecommendation({ career_ops_score: 62.5 }).recommendation, '一般');
  assert.equal(computeRecommendation({ career_ops_score: 48 }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 87.5, cv_match_score: 'n/a' }).recommendation, '强烈推荐');
  // career_ops_score=null + 有 cv → '不推荐'（理由"有效维度不足"）
  const nullCareer = computeRecommendation({ career_ops_score: null, cv_match_score: 85 });
  assert.equal(nullCareer.recommendation, '不推荐');
  assert.ok(nullCareer.recommendation_reason.includes('有效维度不足'));
  // 布尔-only 调用（无 eligibility_status/cv_match_score）逐字节回归（新量纲文案）
  const r1 = computeRecommendation({ career_ops_score: 97.5, hard_redline: true, redline_reason: '劳务派遣' });
  assert.deepEqual(
    { recommendation: r1.recommendation, recommendation_reason: r1.recommendation_reason },
    { recommendation: '硬红线跳过', recommendation_reason: '命中硬红线/deal_breakers：劳务派遣' }
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 95, current_employer_conflict: true }).recommendation_reason,
    '现任雇主/关联主体岗位，不构成外部跳槽机会（Career Score 95/100）'
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 92.5, salary_floor_breach: true }).recommendation_reason,
    '低于候选人薪资底线（Career Score 92.5/100）'
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 90, severe_level_downgrade: true }).recommendation_reason,
    '职级严重倒退（Career Score 90/100）'
  );
  assert.equal(
    computeRecommendation({ career_ops_score: 62.5 }).recommendation_reason,
    'Career Score 62.5/100'
  );
  // 混传多布尔：仍取首项文案（Phase 3 if-链语义），不追加具名
  assert.equal(
    computeRecommendation({ career_ops_score: 95, current_employer_conflict: true, salary_floor_breach: true }).recommendation_reason,
    '现任雇主/关联主体岗位，不构成外部跳槽机会（Career Score 95/100）'
  );
  // Phase 4 调用（带新参数）多命中 → 具名列出
  const multi = computeRecommendation({
    career_ops_score: 95, current_employer_conflict: true, salary_floor_breach: true, cv_match_score: 90,
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
  const tr2 = computeRecommendation({ career_ops_score: 95, current_employer_conflict: true });
  assert.equal(tr2.trace.find(t => t.step === 1).outcome, 'current_employer_conflict');
});

test('T17 封顶/降级语义（§22.4 裁决②）：eligible_with_gaps 降一档封顶推荐；has_hard_gap 仅封顶；career<50 缺口一律不推荐', () => {
  // eligible_with_gaps：矩阵结果降一档（强烈推荐→推荐→一般→不推荐）后封顶"推荐"
  assert.equal(computeRecommendation({ career_ops_score: 87.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' }).recommendation, '推荐');
  assert.equal(computeRecommendation({ career_ops_score: 62.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' }).recommendation, '一般');
  assert.equal(computeRecommendation({ career_ops_score: 87.5, cv_match_score: 70, eligibility_status: 'eligible_with_gaps' }).recommendation, '一般');
  // has_hard_gap（且未传 status）：仅封顶"推荐"，不降档
  assert.equal(computeRecommendation({ career_ops_score: 87.5, cv_match_score: 85, has_hard_gap: true }).recommendation, '推荐');
  assert.equal(computeRecommendation({ career_ops_score: 62.5, cv_match_score: 85, has_hard_gap: true }).recommendation, '推荐');
  assert.equal(computeRecommendation({ career_ops_score: 87.5, cv_match_score: 50, has_hard_gap: true }).recommendation, '一般');
  // eligible_with_gaps + has_hard_gap 同传：降一档封顶后再封顶（结果一致）
  assert.equal(computeRecommendation({ career_ops_score: 87.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps', has_hard_gap: true }).recommendation, '推荐');
  // career < 50 时无论 ④⑤ 仍为'不推荐'
  assert.equal(computeRecommendation({ career_ops_score: 47.5, cv_match_score: 80, eligibility_status: 'eligible_with_gaps' }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 37.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 37.5, cv_match_score: 85, has_hard_gap: true }).recommendation, '不推荐');
  // career < 50 无缺口 → 矩阵结果不受 floor 影响（25-49 × ≥80 = 一般）
  assert.equal(computeRecommendation({ career_ops_score: 37.5, cv_match_score: 85 }).recommendation, '一般');
  // eligibility_status='ineligible'（即使布尔漏传）→ Step 2 job-side 不推荐
  assert.equal(computeRecommendation({ career_ops_score: 87.5, eligibility_status: 'ineligible' }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 87.5, eligibility_ineligible: true }).recommendation, '不推荐');
  // Step 1 candidate-side 新三项：location/schedule/travel 任一命中 → 不推荐
  assert.equal(computeRecommendation({ career_ops_score: 87.5, location_blocker: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 87.5, work_schedule_blocker: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 87.5, travel_refusal: true }).recommendation, '不推荐');
  // Step 2 命中文案
  const inel = computeRecommendation({ career_ops_score: 87.5, eligibility_ineligible: true });
  assert.ok(inel.recommendation_reason.includes('硬性资格不满足'));
  // trace 记录 step 4/5
  const g4 = computeRecommendation({ career_ops_score: 87.5, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' });
  assert.deepEqual(g4.trace.find(t => t.step === 4), {
    step: 4, rule: 'eligible_with_gaps_downgrade_cap',
    input: { eligibility_status: 'eligible_with_gaps', base: '强烈推荐' }, outcome: '推荐',
  });
  const g5 = computeRecommendation({ career_ops_score: 37.5, cv_match_score: 85, has_hard_gap: true });
  assert.equal(g5.trace.find(t => t.step === 5).rule, 'career_below_50_with_gaps');
  const g5b = computeRecommendation({ career_ops_score: 87.5, cv_match_score: 85, has_hard_gap: true });
  assert.equal(g5b.trace.find(t => t.step === 5).rule, 'has_hard_gap_cap');
});

test('T18 blocker 只覆盖 Recommendation：任何 blocker 组合不修改 career_ops_score/score_confidence/score_breakdown', () => {
  const dims = allDims(80);
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
  // ① eligible + has_hard_gap：矩阵 90×85 = 强烈推荐 → 封顶"推荐"（trace step5 = has_hard_gap_cap）
  const g1 = computeRecommendation({ career_ops_score: 90, cv_match_score: 85, eligibility_status: 'eligible', has_hard_gap: true });
  assert.equal(g1.recommendation, '推荐');
  assert.ok(g1.recommendation_reason.includes('HARD_GAP'));
  assert.equal(g1.trace.find(t => t.step === 5).rule, 'has_hard_gap_cap');
  // 封顶不升档：70×85 = 推荐 → 仍"推荐"，reason 不追加封顶文案
  const g1b = computeRecommendation({ career_ops_score: 70, cv_match_score: 85, eligibility_status: 'eligible', has_hard_gap: true });
  assert.equal(g1b.recommendation, '推荐');
  assert.ok(!g1b.recommendation_reason.includes('HARD_GAP'));
  // ② eligible_with_gaps + has_hard_gap：recommendation 与 reason 和只传 eligible_with_gaps 逐字节一致
  const ewgOnly = computeRecommendation({ career_ops_score: 90, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' });
  const ewgGap = computeRecommendation({ career_ops_score: 90, cv_match_score: 85, eligibility_status: 'eligible_with_gaps', has_hard_gap: true });
  assert.equal(ewgOnly.recommendation, '推荐'); // 强烈推荐 → 降一档封顶"推荐"
  assert.equal(ewgGap.recommendation, ewgOnly.recommendation);
  assert.equal(ewgGap.recommendation_reason, ewgOnly.recommendation_reason);
  // 70×85：推荐 → 降一档 → 一般（has_hard_gap 不再把"一般"二次降档/封顶）
  const ewgOnly2 = computeRecommendation({ career_ops_score: 70, cv_match_score: 85, eligibility_status: 'eligible_with_gaps' });
  const ewgGap2 = computeRecommendation({ career_ops_score: 70, cv_match_score: 85, eligibility_status: 'eligible_with_gaps', has_hard_gap: true });
  assert.equal(ewgOnly2.recommendation, '一般');
  assert.equal(ewgGap2.recommendation, ewgOnly2.recommendation);
  assert.equal(ewgGap2.recommendation_reason, ewgOnly2.recommendation_reason);
});

test('T20 P2-2 ③④：ineligible+has_hard_gap → Step 2 短路封顶不生效；unknown+has_hard_gap → 矩阵结果不封顶', () => {
  // ③ ineligible + has_hard_gap：Step 2 job-side 短路'不推荐'，无 step5 记录（封顶不可达）
  const g3 = computeRecommendation({ career_ops_score: 90, cv_match_score: 85, eligibility_status: 'ineligible', has_hard_gap: true });
  assert.equal(g3.recommendation, '不推荐');
  assert.ok(g3.recommendation_reason.includes('硬性资格不满足'));
  assert.ok(!g3.trace.some(t => t.step === 5), 'Step 2 短路后不得进入 Step 5 封顶');
  // ④ unknown + has_hard_gap：显式 unknown 走矩阵、不封顶——4.5×85 = 强烈推荐原样输出
  const g4 = computeRecommendation({ career_ops_score: 90, cv_match_score: 85, eligibility_status: 'unknown', has_hard_gap: true });
  assert.equal(g4.recommendation, '强烈推荐');
  assert.ok(!g4.trace.some(t => t.step === 5 && t.rule === 'has_hard_gap_cap'), 'unknown 不应用 has_hard_gap 封顶');
  // 同理 90×70 = 推荐（挑战岗）原样输出，无封顶记录
  const g4b = computeRecommendation({ career_ops_score: 90, cv_match_score: 70, eligibility_status: 'unknown', has_hard_gap: true });
  assert.equal(g4b.recommendation, '推荐');
  assert.ok(g4b.recommendation_reason.includes('挑战岗'));
  assert.ok(!g4b.trace.some(t => t.step === 5 && t.rule === 'has_hard_gap_cap'));
});

test('T21 P2-2 ⑤⑥：矛盾参数不能绕过更高优先级（Step 1/2 先于封顶）；blocker 优先级与文案不变', () => {
  // ⑤ Step 2 先于封顶：eligibility_ineligible=true + has_hard_gap=true + 高分高匹配 → 仍不推荐
  const g5 = computeRecommendation({ career_ops_score: 95, cv_match_score: 90, eligibility_ineligible: true, has_hard_gap: true });
  assert.equal(g5.recommendation, '不推荐');
  assert.equal(g5.trace.find(t => t.step === 2).outcome, 'hit');
  assert.ok(!g5.trace.some(t => t.step === 5), '封顶不得先于 Step 2 生效');
  // ⑥ Step 1 先于封顶：current_employer_conflict + has_hard_gap → 不推荐（与 Phase 4 既有行为一致）
  const g6 = computeRecommendation({ career_ops_score: 95, cv_match_score: 90, current_employer_conflict: true, has_hard_gap: true });
  assert.equal(g6.recommendation, '不推荐');
  assert.equal(g6.trace.find(t => t.step === 1).outcome, 'current_employer_conflict');
  assert.ok(!g6.trace.some(t => t.step === 5), '封顶不得先于 Step 1 生效');
  // Phase 4 既有单命中文案逐字节回归（legacy 协议不受 guard 影响）
  assert.equal(
    computeRecommendation({ career_ops_score: 95, current_employer_conflict: true, has_hard_gap: true }).recommendation_reason,
    '现任雇主/关联主体岗位，不构成外部跳槽机会（Career Score 95/100）'
  );
});

// ---------------------------------------------------------------------------
// Round 1（2026-09-03）量纲迁移回归：数学等价 + 新旧决策表全格等价
// ---------------------------------------------------------------------------

test('T22 数学等价：维度分与 career_ops_score = 旧 1-5 值的 (x−1)×25 仿射像（真 0-100）', () => {
  const mapping = [
    [1.0, 0], [2.0, 25], [2.5, 37.5], [3.0, 50], [3.5, 62.5],
    [4.0, 75], [4.16, 79], [4.5, 87.5], [5.0, 100],
  ];
  for (const [old5, expected100] of mapping) {
    const dimScore = Math.round((old5 - 1) * 25 * 100) / 100;
    const r = computeScore(allDims(dimScore));
    assert.equal(r.career_ops_score, expected100, `old ${old5} → new ${expected100}`);
    assert.equal(r.score_scale, '0-100');
    assert.equal(r.score_scale_version, 2);
  }
  // 维度输入 clamp 语义同构：旧 clamp [1,5] ↔ 新 clamp [0,100]
  assert.equal(computeScore([{ key: 'compensation', score: -10 }]).score_breakdown.dimensions[0].score, 0);  // 旧 0.6→1
  assert.equal(computeScore([{ key: 'compensation', score: 140 }]).score_breakdown.dimensions[0].score, 100); // 旧 6.6→5
  // 输出 schema 标记
  const r = computeScore(allDims(75));
  assert.equal(r.score_scale, '0-100');
  assert.equal(r.score_scale_version, 2);
  assert.ok(r.career_ops_score >= 0 && r.career_ops_score <= 100);
});

// Round 1B 精度边界：阈值判断必须使用未舍入值
test('T22b 阈值精度边界：74.99/75、87.49/87.5、49.99/50、24.99/25 档位归属精确', () => {
  assert.equal(scoreBand(87.49), '推荐');
  assert.equal(scoreBand(87.5), '强烈推荐');
  assert.equal(scoreBand(74.99), '一般');
  assert.equal(scoreBand(75), '推荐');
  assert.equal(scoreBand(49.99), '不推荐');
  assert.equal(scoreBand(50), '一般');
  assert.equal(scoreBand(24.99), '不推荐');
  assert.equal(scoreBand(25), '不推荐'); // legacy band 路径：<50 即不推荐（与旧 scoreBand(2.0) 同构）
  // 矩阵行边界同构（带 cv）
  assert.equal(cell(74.99, 85), '推荐');   // <75 → 50-74 行
  assert.equal(cell(75, 85), '强烈推荐');  // ≥75 行
  assert.equal(cell(49.99, 85), '一般');   // <50 → 25-49 行（25-49 × ≥80 = 一般）
  assert.equal(cell(50, 85), '推荐');      // ≥50 行
  assert.equal(cell(24.99, 85), '不推荐'); // <25 → lt25 行
  assert.equal(cell(25, 85), '一般');      // ≥25 行
});

// 旧 1-5 制决策逻辑冻结副本（Round 1B 迁移前 scoring.mjs 的 scoreBand + 矩阵语义，
// 仅用于本等价测试；运行时唯一 SoT 仍是 scoring.mjs 的新实现）
const LEGACY_BAND = (s) => {
  if (s === null || s === undefined) return '不推荐';
  if (s >= 4.5) return '强烈推荐';
  if (s >= 4.0) return '推荐';
  if (s >= 3.0) return '一般';
  return '不推荐';
};
const LEGACY_MATRIX = {
  ge4:  { ge80: '强烈推荐', c6079: '推荐', c4059: '一般', lt40: '不推荐' },
  c3040: { ge80: '推荐', c6079: '推荐', c4059: '一般', lt40: '不推荐' },
  c2030: { ge80: '一般', c6079: '一般', c4059: '不推荐', lt40: '不推荐' },
  lt2:  { ge80: '不推荐', c6079: '不推荐', c4059: '不推荐', lt40: '不推荐' },
  unknown: { ge80: '不推荐', c6079: '不推荐', c4059: '不推荐', lt40: '不推荐' },
};
function legacyRow(career) {
  if (career === null || !Number.isFinite(Number(career))) return 'unknown';
  if (career >= 4.0) return 'ge4';
  if (career >= 3.0) return 'c3040';
  if (career >= 2.0) return 'c2030';
  return 'lt2';
}
function legacyCol(cv) {
  if (cv === null || !Number.isFinite(Number(cv))) return null;
  if (cv >= 80) return 'ge80';
  if (cv >= 60) return 'c6079';
  if (cv >= 40) return 'c4059';
  return 'lt40';
}
function legacyRecommendation(career5, cv) {
  const col = legacyCol(cv);
  if (col === null) return LEGACY_BAND(career5);
  return LEGACY_MATRIX[legacyRow(career5)][col];
}
// 仿射迁移：旧 1-5 → 真 0-100（未舍入；引擎输入也用它保持同一精度语义）
const aff = (v) => (v - 1) * 25;

test('T23 新旧决策表全格等价：同一岗位输入在旧 1-5 阈值与新 0-100 阈值下 Recommendation 逐格一致', () => {
  const career5Values = [];
  for (let v = 1.0; v <= 5.001; v += 0.1) career5Values.push(Math.round(v * 10) / 10);
  // 任务书 §16D 边界集（旧制）+ 小数边界
  career5Values.push(4.16, 3.76, 2.98, 3.99, 4.01, 2.01, 1.99, 4.49, 4.51, 2.99, 3.01);
  const cvValues = [null, 0, 17, 39, 40, 59, 60, 79, 80, 85, 100];
  for (const c5 of career5Values) {
    for (const cv of cvValues) {
      const legacy = legacyRecommendation(c5, cv);
      const modern = computeRecommendation({ career_ops_score: aff(c5), cv_match_score: cv }).recommendation;
      assert.equal(modern, legacy, `career ${c5} (${aff(c5)}) × cv ${cv}: 旧=${legacy} 新=${modern}`);
    }
  }
  // blocker / 资格状态语义在新旧量纲下同样一致（代表格 + 边界格）
  const combos = [
    { cv_match_score: 85, eligibility_status: 'eligible_with_gaps' },
    { cv_match_score: 70, eligibility_status: 'eligible_with_gaps' },
    { cv_match_score: 85, has_hard_gap: true },
    { cv_match_score: 85, eligibility_status: 'eligible', has_hard_gap: true },
    { cv_match_score: 80, current_employer_conflict: true },
    { cv_match_score: 85, eligibility_status: 'ineligible' },
  ];
  for (const c5 of [1.0, 2.0, 2.99, 3.0, 3.5, 3.99, 4.0, 4.49, 4.5, 5.0]) {
    for (const combo of combos) {
      // legacy 语义：blocker → 不推荐；eligible_with_gaps → 降一档封顶；has_hard_gap(eligible) → 封顶
      const base = legacyRecommendation(c5, combo.cv_match_score ?? null);
      let expect;
      if (combo.current_employer_conflict || combo.eligibility_status === 'ineligible') expect = '不推荐';
      else if (c5 < 3.0 && (combo.eligibility_status === 'eligible_with_gaps' || combo.has_hard_gap)) expect = '不推荐';
      else if (combo.eligibility_status === 'eligible_with_gaps') {
        const down = { '强烈推荐': '推荐', '推荐': '一般', '一般': '不推荐', '不推荐': '不推荐' }[base];
        expect = down === '强烈推荐' ? '推荐' : down;
      } else if (combo.has_hard_gap) {
        if (combo.eligibility_status === 'eligible' || combo.eligibility_status === undefined || combo.eligibility_status === null) {
          expect = base === '强烈推荐' ? '推荐' : base;
        } else expect = base;
      } else expect = base;
      const modern = computeRecommendation({ career_ops_score: aff(c5), ...combo }).recommendation;
      assert.equal(modern, expect, `career ${c5}→${aff(c5)} + ${JSON.stringify(combo)}: 期望=${expect} 实际=${modern}`);
    }
  }
});
