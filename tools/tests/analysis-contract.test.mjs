// analysis-contract.test.mjs — Round 2 分析输出合同测试（schema / sections / provider 漂移 / 数值不可覆盖）
// Run: node --test tools/tests/analysis-contract.test.mjs
//
// 覆盖：canonical schema v2 / 必需 section / 类型校验 / 枚举校验 / engine 数值契约 /
// 别名归一（provider 漂移）/ 缺失补空 / golden 语义保留 / 数值不可被模型覆盖。
// 夹具全部匿名合成；真实数据仅存在于 LOCAL ONLY 审计报告（不进测试）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYSIS_SCHEMA_VERSION, REQUIRED_ANALYSIS_SECTIONS, RECOMMENDATION_LEVELS,
  ELIGIBILITY_STATUS, FIELD_ALIASES, SECTION_EMPTY_TEXT,
  normalizeAnalysis, validateAnalysis, isAnalyzed,
} from '../../dashboard-web/lib/analysis-contract.mjs';

// 完整 canonical fixture（匿名）
const CANONICAL = {
  recommendation: '推荐',
  recommendation_reason: '岗位整体质量和履历匹配度都较高，综合判断推荐',
  strengths: ['同域执行经验完整', 'ERP 日常操作熟练'],
  gaps: ['目标品类资源不足'],
  soft_gaps: ['无该品类直采经验'],
  hard_gaps: [],
  cv_advice: '① 补充品类迁移叙事；② 量化供应商引入数量。',
  interview_focus: '确认品类资源要求是否可放宽。',
  decision_trace: [{ step: 0, rule: 'hard_redline_or_deal_breakers', input: {}, outcome: 'miss' }],
  score_breakdown: {
    total_weight: 100, effective_weight: 100, weighted_sum: 7500,
    dimensions: [{ key: 'compensation', weight: 20, score: 75, weighted_value: 1500, status: 'known' }],
  },
  cv_match_score: 84,
  career_ops_score: 75,
  score_scale: '0-100',
  score_scale_version: 2,
  eligibility_status: 'eligible',
  blockers: {},
};

test('A1 canonical 完整 fixture → complete，schema v2 常量冻结', () => {
  assert.equal(ANALYSIS_SCHEMA_VERSION, 2);
  assert.deepEqual(Object.keys(REQUIRED_ANALYSIS_SECTIONS).sort(),
    ['cv_advice', 'decision_trace', 'gaps', 'recommendation_reason', 'score_breakdown', 'soft_gaps', 'strengths', 'interview_focus'].sort());
  assert.deepEqual(RECOMMENDATION_LEVELS, ['强烈推荐', '推荐', '一般', '不推荐', '硬红线跳过']);
  assert.deepEqual(ELIGIBILITY_STATUS, ['eligible', 'eligible_with_gaps', 'ineligible', 'unknown']);
  const v = validateAnalysis(CANONICAL);
  assert.deepEqual(v, { status: 'complete', missing_sections: [], type_errors: [] });
});

test('A2 缺 recommendation_reason / decision_trace / score_breakdown → FAIL（不可 repair 到 complete）', () => {
  for (const key of ['recommendation_reason', 'decision_trace', 'score_breakdown']) {
    const broken = { ...CANONICAL };
    delete broken[key];
    const v = validateAnalysis(broken);
    assert.equal(v.status, 'partial');
    assert.ok(v.missing_sections.includes(key), `缺 ${key} 应进 missing_sections`);
  }
});

test('A3 缺 narrative（strengths/gaps/cv_advice/interview_focus/soft_gaps）→ missing_sections 列出（normalize 可补空结构）', () => {
  for (const key of ['strengths', 'gaps', 'soft_gaps', 'cv_advice', 'interview_focus']) {
    const broken = { ...CANONICAL };
    delete broken[key];
    const v = validateAnalysis(broken);
    assert.ok(v.missing_sections.includes(key), `缺 ${key} 应 FAIL`);
    // normalize 后结构补齐，再 validate 不再缺
    const { analysis } = normalizeAnalysis(broken);
    const v2 = validateAnalysis(analysis);
    assert.ok(!v2.missing_sections.includes(key), `normalize 后 ${key} 结构应存在`);
  }
});

test('A4 类型校验：array 变 string / score 变非数 / enum 自由文本 → type_errors', () => {
  const t1 = validateAnalysis({ ...CANONICAL, strengths: '不是数组' });
  assert.ok(t1.type_errors.includes('strengths:not-array'));
  const t2 = validateAnalysis({ ...CANONICAL, cv_match_score: '84分' });
  assert.ok(t2.type_errors.includes('cv_match_score:not-number'));
  const t3 = validateAnalysis({ ...CANONICAL, recommendation: '建议投递' });
  assert.ok(t3.type_errors.some(e => e.startsWith('recommendation:invalid-enum')));
  const t4 = validateAnalysis({ ...CANONICAL, eligibility_status: 'half_ok' });
  assert.ok(t4.type_errors.some(e => e.startsWith('eligibility_status:invalid-enum')));
});

test('A5 engine 数值契约：>100 / <0 / version≠2 / dimensions 非法 → FAIL（true 0-100 锁）', () => {
  assert.ok(validateAnalysis({ ...CANONICAL, career_ops_score: 120 }).type_errors.some(e => e.startsWith('career_ops_score:out-of-scale')));
  assert.ok(validateAnalysis({ ...CANONICAL, cv_match_score: -5 }).type_errors.some(e => e.startsWith('cv_match_score:out-of-scale')));
  const v1 = validateAnalysis({ ...CANONICAL, score_scale_version: 1 });
  assert.ok(v1.type_errors.includes('score_scale_version:not-2'));
  const v2 = validateAnalysis({ ...CANONICAL, score_breakdown: { dimensions: [] } });
  assert.ok(v2.type_errors.includes('score_breakdown:missing-or-invalid-dimensions'));
  const v3 = validateAnalysis({ ...CANONICAL, score_breakdown: { dimensions: [{ key: 'compensation', score: 250 }] } });
  assert.ok(v3.type_errors.includes('score_breakdown:missing-or-invalid-dimensions'));
  // 旧 1-5 量纲值（如 4.16）落在 [0,100] 内不会触发 scale 错，但 version=1 会 —— 防止旧数据未迁移
  assert.ok(validateAnalysis({ ...CANONICAL, career_ops_score: 4.16, score_scale_version: 1 }).type_errors.includes('score_scale_version:not-2'));
});

test('A6 provider 漂移归一：同义字段 → canonical，别名 key 删除，内容不丢', () => {
  const providerB = {
    recommendation: '推荐',
    recommendation_reason: '理由',
    advantages: ['强项一'],
    key_strengths: ['强项二'],
    weaknesses: ['短板一'],
    fixable_gaps: ['可补缺口'],
    resume_advice: '① 建议一',
    resume_suggestions: '② 建议二',
    interview_questions: ['关注点'],
  };
  const { analysis, actions } = normalizeAnalysis(providerB);
  // canonical 内容 = 首个命中的别名（不覆盖 canonical 已有值）
  assert.deepEqual(analysis.strengths, ['强项一']);
  assert.deepEqual(analysis.gaps, ['短板一']);
  assert.deepEqual(analysis.soft_gaps, ['可补缺口']);
  assert.equal(analysis.cv_advice, '① 建议一');
  assert.equal(analysis.interview_focus, '关注点');
  for (const alias of ['advantages', 'key_strengths', 'weaknesses', 'fixable_gaps', 'resume_advice', 'resume_suggestions', 'interview_questions']) {
    assert.ok(!(alias in analysis), `别名 ${alias} 不得残留`);
  }
  assert.ok(actions.some(a => a.startsWith('alias:')));
  // canonical 已有值时别名不覆盖
  const keep = normalizeAnalysis({ ...providerB, strengths: ['原始强项'] });
  assert.deepEqual(keep.analysis.strengths, ['原始强项']);
});

test('A7 provider 类型漂移归一：string→array / array→string / null→空值', () => {
  const providerC = {
    recommendation: '推荐', recommendation_reason: '理由',
    strengths: '单条字符串',           // string → [string]
    gaps: null,                        // null → []
    cv_advice: ['① 建议', '② 建议'],   // array → '① 建议；② 建议'
    interview_focus: null,
  };
  const { analysis, actions } = normalizeAnalysis(providerC);
  assert.deepEqual(analysis.strengths, ['单条字符串']);
  assert.deepEqual(analysis.gaps, []);
  assert.equal(analysis.cv_advice, '① 建议；② 建议');
  assert.equal(analysis.interview_focus, '');
  assert.ok(actions.length >= 4);
  const v = validateAnalysis(analysis);
  assert.ok(!v.type_errors.some(e => e.includes('not-array') || e.includes('not-string')));
});

test('A8 缺失 section normalize 后全部存在（结构永不消失；空值诚实表示）', () => {
  const minimal = { recommendation: '一般', recommendation_reason: 'x' };
  const { analysis } = normalizeAnalysis(minimal);
  for (const key of Object.keys(REQUIRED_ANALYSIS_SECTIONS)) {
    assert.ok(key in analysis, `normalize 后 ${key} 必须存在`);
  }
  assert.deepEqual(analysis.strengths, []);
  assert.equal(analysis.cv_advice, '');
  // canonical 空值映射与展示文案一一存在（Dashboard fallback 用）
  for (const key of Object.keys(REQUIRED_ANALYSIS_SECTIONS)) {
    assert.ok(typeof SECTION_EMPTY_TEXT[key] === 'string' && SECTION_EMPTY_TEXT[key].length > 0);
  }
});

test('A9 provider-shape stability：三种 provider 输出经 normalize→validate 后 canonical 形态一致', () => {
  const target = normalizeAnalysis(CANONICAL).analysis; // Provider A：canonical 全量
  const providerB = normalizeAnalysis({                 // Provider B：别名 + 顺序不同
    cv_match_score: CANONICAL.cv_match_score, career_ops_score: CANONICAL.career_ops_score,
    score_scale_version: 2, score_scale: '0-100', eligibility_status: 'eligible',
    blockers: {}, interview_questions: CANONICAL.interview_focus,
    resume_advice: CANONICAL.cv_advice, fixable_gaps: CANONICAL.soft_gaps,
    weaknesses: CANONICAL.gaps, advantages: CANONICAL.strengths,
    recommendation_reason: CANONICAL.recommendation_reason, recommendation: '推荐',
    score_breakdown: CANONICAL.score_breakdown, decision_trace: CANONICAL.decision_trace,
  }).analysis;
  const providerC = normalizeAnalysis({                 // Provider C：缺 narrative + 类型漂移
    ...CANONICAL, strengths: undefined, gaps: null, cv_advice: null, interview_focus: null, soft_gaps: undefined,
  }).analysis;
  // 合同管辖 key 的"存在性 + 类型"必须一致（内容完整性随 provider 证据而定，这正是合同语义）
  const shape = (a) => Object.keys(REQUIRED_ANALYSIS_SECTIONS).map(k =>
    `${k}:${a[k] === undefined ? 'absent' : Array.isArray(a[k]) ? 'array' : typeof a[k]}`).join('|');
  assert.equal(shape(providerB), shape(target));
  assert.equal(shape(normalizeAnalysis(providerC).analysis), shape(target));
  // B 的内容与 A 逐字段一致（别名搬运无丢失）
  assert.deepEqual(providerB.strengths, target.strengths);
  assert.deepEqual(providerB.gaps, target.gaps);
  assert.equal(providerB.cv_advice, target.cv_advice);
  assert.equal(providerB.interview_focus, target.interview_focus);
});

test('A10 数值/决策字段不可被模型覆盖（normalize/validate 均不写这些字段）', () => {
  const modelSelfScored = {
    ...CANONICAL,
    cv_match_score: 99,        // 模型自评分
    career_ops_score: 100,     // 模型自评分
    recommendation: '强烈推荐', // 模型改档
    eligibility_status: 'eligible',
  };
  const { analysis } = normalizeAnalysis(modelSelfScored);
  // normalize 不改写 engine 字段（透传）；门禁由 validator 数值契约 + rescore version 守卫承担
  assert.equal(analysis.cv_match_score, 99); // 原样透传（调用方管线负责用引擎输出覆盖）
  assert.equal(analysis.career_ops_score, 100);
  // validator 对越界/版本错误报 type_errors —— 模型自评 99/100 且 version 2 在值域内时，
  // 防覆盖的最后防线是管线：engine 输出永远后写。这里锁定 validator 会标记非法值：
  const bad = validateAnalysis({ ...CANONICAL, career_ops_score: 100, cv_match_score: 101 });
  assert.ok(bad.type_errors.some(e => e.startsWith('cv_match_score:out-of-scale')));
});

test('A11 golden 语义保留：normalize 不改写已有 narrative 内容（deepEqual）', () => {
  const { analysis } = normalizeAnalysis(CANONICAL);
  assert.deepEqual(analysis.strengths, CANONICAL.strengths);
  assert.deepEqual(analysis.gaps, CANONICAL.gaps);
  assert.deepEqual(analysis.soft_gaps, CANONICAL.soft_gaps);
  assert.deepEqual(analysis.hard_gaps, CANONICAL.hard_gaps);
  assert.equal(analysis.cv_advice, CANONICAL.cv_advice);
  assert.equal(analysis.interview_focus, CANONICAL.interview_focus);
  assert.equal(analysis.recommendation_reason, CANONICAL.recommendation_reason);
  assert.deepEqual(analysis.decision_trace, CANONICAL.decision_trace);
  assert.deepEqual(analysis.score_breakdown, CANONICAL.score_breakdown);
});

test('A12 isAnalyzed：有 recommendation 或 career_ops_score 即已分析；未分析行不强制 section', () => {
  assert.equal(isAnalyzed({ recommendation: '推荐' }), true);
  assert.equal(isAnalyzed({ career_ops_score: 75 }), true);
  assert.equal(isAnalyzed({}), false);
  assert.equal(isAnalyzed(null), false);
  assert.equal(isAnalyzed({ rule_score: 5 }), false); // 仅初筛分不算
});

test('A13 normalize 不 mutate 输入（纯函数）', () => {
  const input = { ...CANONICAL, weaknesses: ['别名'] };
  const snapshot = JSON.stringify(input);
  normalizeAnalysis(input);
  assert.equal(JSON.stringify(input), snapshot);
});

test('A14 别名映射冻结（不随 provider 扩散；新增别名必须进本 SoT）', () => {
  assert.deepEqual(FIELD_ALIASES.strengths, ['advantages', 'key_strengths', 'keyStrengths', 'pro']);
  assert.deepEqual(FIELD_ALIASES.gaps, ['weaknesses', 'weak_points', 'cons']);
  assert.deepEqual(FIELD_ALIASES.cv_advice, ['resume_advice', 'resume_suggestions', 'cv_suggestions', 'resume_improvements']);
  assert.deepEqual(FIELD_ALIASES.interview_focus, ['interview_suggestions', 'interview_questions', 'interview_prep']);
  assert.deepEqual(FIELD_ALIASES.soft_gaps, ['fixable_gaps']);
});
