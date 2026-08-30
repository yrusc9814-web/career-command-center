// phase6-dashboard.test.mjs — Phase 6 Dashboard 采购领域对齐（25 点验收）
// Run: node --test tools/tests/phase6-dashboard.test.mjs
//
// 覆盖：十维映射 / 退役维度不展示 / 三层结果分离（CV 0-100、Career 1-5、Recommendation
// 独立）/ blocker 只覆盖推荐 / 四级缺口与 unknown 语义 / decision trace 透传 / legacy
// 报告降级 / canonical 状态映射 / 品牌清理 / 单一分析入口 / 前端零评分 / aggregator
// 字段透传 / fixture 匿名 / 1280-1440-1680 静态布局锁定。
// 夹具全部为匿名合成数据（tools/tests/fixtures/phase6-fixtures.mjs）。
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildState, CANONICAL_STATES, STATE_ZH,
} from '../../dashboard-web/lib/aggregator.mjs';
import {
  DIMENSION_ZH, RETIRED_DIM_KEYS, displayDimensions, dimStatusZh,
  GAP_LEVEL_ZH, gapLevelZh, blockerHits, gapItemText, BLOCKER_ZH,
  traceLines, unknownZh, zhMetrics, reasonZh,
  verdictCards, recommendationCells, recClassOf, confClassOf,
} from '../../dashboard-web/lib/view-model.mjs';
// 冻结 SoT 只读引用：仅校验展示映射与之一致，不做任何计算
import { SCORING_RUBRIC } from '../../tools/lib/scoring.mjs';
import {
  FIXTURE_001, FIXTURE_002, FIXTURE_003, LEGACY_RUN, LEGACY_SCORED_RUN, PHASE6_RUN,
} from './fixtures/phase6-fixtures.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard-web');
const readWeb = f => fs.readFileSync(path.join(WEB_DIR, f), 'utf8');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'phase6dash-'));
}

let dir;
beforeEach(() => {
  dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
});

function writeRun(run, file) {
  fs.writeFileSync(path.join(dir, 'data', file), JSON.stringify(run));
}

const baseArgs = (d) => ({
  dataDir: path.join(d, 'data'),
  outputDir: path.join(d, 'output'),
  reportsDir: path.join(d, 'reports'),
  inboxDir: path.join(d, 'inbox'),
  profile: { candidate: { full_name: '候选人A', current_title: '采购主管' }, job_search: { target_titles: ['采购专员'] } },
  dashboardState: {},
});

function stateWith(run) {
  writeRun(run, 'search-results-20260829-1100.json');
  return buildState(baseArgs(dir));
}

// ---------------------------------------------------------------------------
// 1-5. Career Score 十维映射 / 退役维度不展示
// ---------------------------------------------------------------------------

test('P1 Career Score 冻结十维映射：key→中文与 SCORING_RUBRIC 逐字一致', () => {
  assert.equal(Object.keys(DIMENSION_ZH).length, 10);
  assert.deepEqual(Object.keys(DIMENSION_ZH), SCORING_RUBRIC.map(d => d.key));
  assert.deepEqual(Object.values(DIMENSION_ZH), SCORING_RUBRIC.map(d => d.name));
  const expect = {
    compensation: '薪酬竞争力', workload_workstyle: '工作制与强度',
    role_seniority: '职级质量与职责范围', career_growth: '成长空间',
    category_domain_value: '品类与行业价值', procurement_ownership: '采购自主权',
    company_stability: '公司与业务稳定性', location_fit: '地点与通勤',
    digital_tooling: '数字化与工具成熟度', hiring_process_quality: '招聘流程质量',
  };
  assert.deepEqual(DIMENSION_ZH, expect);
});

const MIXED_DIMS = [
  { key: 'north_star', name: '北极星对齐', weight: 25, score: 3, weighted_value: 75, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'tech_modernity', name: '技术栈现代度', weight: 10, score: 2.5, weighted_value: 25, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'process_speed', name: '流程速度', weight: 5, score: null, weighted_value: null, status: 'unknown', reason: '无证据', evidence: null },
  { key: 'cv_match', name: 'CV匹配', weight: 15, score: 3.6, weighted_value: 54, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'level', name: '级别', weight: 10, score: 2, weighted_value: 20, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'comp', name: 'Comp（含工时折算）', weight: 10, score: 1.5, weighted_value: 15, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'growth', name: '成长路径', weight: 5, score: 3, weighted_value: 15, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'worklife', name: '工时与生活', weight: 5, score: 2, weighted_value: 10, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'stability', name: '公司稳定性', weight: 5, score: 3, weighted_value: 15, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'culture', name: '文化信号', weight: 2, score: 2, weighted_value: 4, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'compensation', name: '旧名字会被覆盖', weight: 20, score: 3, weighted_value: 60, status: 'known', reason: 'r', evidence: 'e' },
  { key: 'procurement_ownership', name: '采购自主权', weight: 9, score: 2, weighted_value: 18, status: 'known', reason: 'r', evidence: 'e' },
];

test('P2 退役维度 north_star 不显示', () => {
  const keys = displayDimensions({ dimensions: MIXED_DIMS }).map(d => d.key);
  assert.ok(!keys.includes('north_star'));
});

test('P3 退役维度 tech_modernity 不显示', () => {
  const keys = displayDimensions({ dimensions: MIXED_DIMS }).map(d => d.key);
  assert.ok(!keys.includes('tech_modernity'));
});

test('P4 退役维度 process_speed（及其余旧维度）不显示', () => {
  const keys = displayDimensions({ dimensions: MIXED_DIMS }).map(d => d.key);
  assert.ok(!keys.includes('process_speed'));
  for (const legacy of RETIRED_DIM_KEYS) assert.ok(!keys.includes(legacy), `${legacy} 必须过滤`);
});

test('P5 旧 cv_match 1-5 不作为 Career Score 维度显示', () => {
  const keys = displayDimensions({ dimensions: MIXED_DIMS }).map(d => d.key);
  assert.ok(!keys.includes('cv_match'));
  // 十维显示名永远来自 DIMENSION_ZH，不信任旧数据 name 字段
  const comp = displayDimensions({ dimensions: MIXED_DIMS }).find(d => d.key === 'compensation');
  assert.equal(comp.name, '薪酬竞争力');
});

// ---------------------------------------------------------------------------
// 6-9. 三层结果分离
// ---------------------------------------------------------------------------

test('P6 CV Match 以 0-100 展示（%），null → 暂无数据语义（—）', () => {
  const cards = verdictCards(FIXTURE_003.analysis);
  assert.equal(cards[0].num, '84%');
  assert.equal(cards[0].label, '简历匹配度');
  assert.equal(verdictCards({ cv_match_score: 0 })[0].num, '0%');
  assert.equal(verdictCards({ cv_match_score: 100 })[0].num, '100%');
  assert.equal(verdictCards({})[0].num, '—');
  assert.equal(verdictCards({ cv_match_score: 200 })[0].num, '200%'); // 透传异常值供人工发现，不改写
});

test('P7 Career Score 以 1-5 展示（/5），null 不变 0', () => {
  const cards = verdictCards(FIXTURE_003.analysis);
  assert.equal(cards[1].num, '3.8');
  assert.equal(cards[1].label, '综合评分 / 5');
  assert.equal(verdictCards({})[1].num, '—');
  // 0 非契约值（Runtime 恒为 1-5 或 null）；若出现则原样透传供人工发现，不改写、不吞
  assert.equal(verdictCards({ career_ops_score: 0 })[1].num, '0');
});

test('P8 Recommendation 独立展示，前端不重推导（分数缺失也不改变推荐结论）', () => {
  const cards = verdictCards(FIXTURE_003.analysis);
  assert.equal(cards[2].num, '不推荐');
  assert.equal(cards[2].label, '推荐结论');
  // 模拟分数字段丢失：推荐结论仍直接消费 Runtime 字段，绝不由分数重新推导
  const degraded = verdictCards({ ...FIXTURE_003.analysis, career_ops_score: null, career_score: null, score: null, cv_match_score: null });
  assert.equal(degraded[2].num, '不推荐');
  assert.equal(degraded[0].num, '—');
  assert.equal(degraded[1].num, '—');
  assert.equal(recClassOf('一般'), 'rec-mid');
  assert.equal(confClassOf(90), 'conf-hi');
});

test('P9 fixture-003：CV 84% + Career 3.8 + 不推荐 三者同时成立', () => {
  const cards = verdictCards(FIXTURE_003.analysis);
  assert.deepEqual(
    cards.map(c => c.num),
    ['84%', '3.8', '不推荐', '100%'],
  );
});

// ---------------------------------------------------------------------------
// 10-12. blocker 只覆盖 Recommendation / 四级缺口与 unknown 语义
// ---------------------------------------------------------------------------

test('P10 blocker 命中不篡改两个 score 与两套 confidence', () => {
  const s = stateWith({ ...PHASE6_RUN, jobs: [FIXTURE_003] });
  const a = s.jobs[0].analysis;
  assert.equal(blockerHits(a.blockers).length, 1);
  assert.equal(a.blockers.location_blocker, true);
  assert.equal(a.career_ops_score, FIXTURE_003.analysis.career_ops_score);
  assert.equal(a.cv_match_score, FIXTURE_003.analysis.cv_match_score);
  assert.deepEqual(a.score_confidence, FIXTURE_003.analysis.score_confidence);
  assert.deepEqual(a.cv_match_confidence, FIXTURE_003.analysis.cv_match_confidence);
  // 命中 blocker 的条目只进入展示层，view-model 不改任何数值字段
  assert.deepEqual(blockerHits({ location_blocker: true, salary_floor_breach: false }), [{ key: 'location_blocker', zh: 'JD 工作地点与候选人显式地点约束冲突' }]);
});

test('P10b blocker 映射覆盖 job-side 资格阻断：eligibility_ineligible → 中文，原始 key 不外漏', () => {
  const hits = blockerHits({ eligibility_ineligible: true });
  assert.deepEqual(hits, [{ key: 'eligibility_ineligible', zh: '不满足岗位硬性要求' }]);
  // 用户可见输出（zh 文案）中不得再出现原始 key 字符串
  assert.ok(!hits.map(h => h.zh).join(' ').includes('eligibility_ineligible'));
  // 既有候选侧 blocker 映射逐字保持不变
  assert.equal(BLOCKER_ZH.current_employer_conflict, '现任雇主/关联主体岗位，不构成外部跳槽机会');
  assert.equal(BLOCKER_ZH.severe_level_downgrade, '职级严重倒退');
});

test('P11 UNKNOWN 映射为"信息不足（待确认）"，unknown 维度显示"暂无数据"', () => {
  assert.deepEqual(GAP_LEVEL_ZH, {
    BLOCKER: '硬性阻断（硬红线）', HARD_GAP: '硬性缺口',
    SOFT_GAP: '可弥补缺口', UNKNOWN: '信息不足（待确认）',
  });
  assert.equal(gapLevelZh('UNKNOWN'), '信息不足（待确认）');
  assert.equal(gapLevelZh('BLOCKER'), '硬性阻断（硬红线）');
  assert.equal(gapLevelZh('HARD_GAP'), '硬性缺口');
  assert.equal(gapLevelZh('SOFT_GAP'), '可弥补缺口');
  assert.equal(gapLevelZh(undefined), '信息不足（待确认）');
  assert.equal(dimStatusZh('unknown'), '暂无数据');
  assert.equal(dimStatusZh(null), '暂无数据');
  assert.equal(unknownZh(null), '暂无数据');
  assert.equal(unknownZh(''), '暂无数据');
  assert.equal(unknownZh('x'), 'x');
});

test('P12 no_evidence 不显示"不具备"（用户可见层与展示层均无该判词，无未接线死代码）', () => {
  // 展示层没有 capability/因子状态渲染路径（capability_summary 仅透传），
  // 因此不存在 no_evidence → 文案的映射函数；"不具备"判词在所有前端文件中被禁止。
  for (const f of ['app.js', 'index.html', 'lib/view-model.mjs']) {
    assert.ok(!readWeb(f).includes('不具备'), `${f} 不得出现"不具备"`);
  }
  // P1-1：级别枚举字面量不得漏给用户（{type:'UNKNOWN'} → 信息不足（待确认））
  assert.equal(gapItemText({ type: 'UNKNOWN' }), '信息不足（待确认）');
  assert.equal(gapItemText({ type: 'HARD_GAP' }), '硬性缺口');
  assert.equal(gapItemText('UNKNOWN'), '信息不足（待确认）');
  // 正常文本与 capability 类型不受影响
  assert.equal(gapItemText('目标品类（生鲜）供应商资源与渠道不足'), '目标品类（生鲜）供应商资源与渠道不足');
  assert.equal(gapItemText({ type: 'category', jd_text: '有生鲜品类货源' }), '有生鲜品类货源');
});

// ---------------------------------------------------------------------------
// 13-15. fixture-002 品类缺口 / fixture-003 trio / decision trace 透传
// ---------------------------------------------------------------------------

test('P13 fixture-002：正确表达 sourcing 能力，硬缺口=目标品类（生鲜）供应商资源', () => {
  const text = JSON.stringify(FIXTURE_002);
  // 禁止错误归因："缺少采购能力 / 缺 sourcing 能力"
  assert.ok(!/缺少采购能力|缺 sourcing|缺少 sourcing|采购能力不足/.test(text));
  // 优势必须表达供应商开发 / 寻源能力
  const strengths = FIXTURE_002.analysis.strengths.join('；');
  assert.match(strengths, /供应商开发/);
  assert.match(strengths, /sourcing/);
  // 真正的硬缺口 = 目标品类（生鲜）的供应商资源/渠道
  const hardGap = FIXTURE_002.analysis.hard_gaps.map(gapItemText).join('；');
  assert.match(hardGap, /生鲜/);
  assert.match(hardGap, /供应商资源/);
  const gap = stateWith({ ...PHASE6_RUN, jobs: [FIXTURE_002] }).jobs[0].analysis.hard_gaps;
  assert.deepEqual(gap, FIXTURE_002.analysis.hard_gaps);
});

test('P14 fixture-003 语义完整入数据层：84 + 3.8 + blocker + 不推荐', () => {
  const s = stateWith({ ...PHASE6_RUN, jobs: [FIXTURE_003] });
  const j = s.jobs[0];
  assert.equal(j.analysis.cv_match_score, 84);
  assert.equal(j.analysis.career_ops_score, 3.8);
  assert.equal(j.analysis.recommendation, '不推荐');
  assert.ok(j.analysis.blockers.location_blocker);
  assert.match(j.analysis.recommendation_reason, /地点约束冲突/);
  assert.ok(!/岗位价值不足|价值不足/.test(j.analysis.recommendation_reason));
});

test('P15 decision_trace 逐条透传（Runtime 输出 → 展示行），aggregator 不吞字段', () => {
  const s = stateWith({ ...PHASE6_RUN, jobs: [FIXTURE_003] });
  assert.deepEqual(s.jobs[0].analysis.decision_trace, FIXTURE_003.analysis.decision_trace);
  const lines = traceLines(FIXTURE_003.analysis.decision_trace);
  assert.deepEqual(lines, [
    'Step 0 hard_redline_or_deal_breakers → miss',
    'Step 1 candidate_side_blocker → location_blocker',
  ]);
  // trace 别名兼容 + 非 trace 输入安全
  assert.deepEqual(traceLines(null), []);
  assert.equal(traceLines('not-array').length, 0);
});

// ---------------------------------------------------------------------------
// 16-17. legacy 报告降级 / canonical 状态映射
// ---------------------------------------------------------------------------

test('P16 legacy 报告缺新字段不崩：全退役维度 → 暂无可展示维度，分数不补算', () => {
  const s = stateWith(LEGACY_RUN);
  const j = s.jobs[0];
  assert.equal(j.analysis.career_ops_score, null);   // 不为旧报告补算
  assert.equal(j.analysis.cv_match_score, null);
  assert.equal(j.analysis.recommendation, null);
  assert.equal(j.analysis.decision_trace, null);
  // 旧 breakdown 透传保留，但展示层只认冻结十维 → 空列表（UI 显示"暂无可展示维度"）
  assert.deepEqual(displayDimensions(j.analysis.score_breakdown).map(d => d.key), []);
  const cards = verdictCards(j.analysis);
  assert.deepEqual(cards.map(c => c.num), ['—', '—', '—', '—']);
  assert.ok(readWeb('app.js').includes('暂无可展示维度')); // 旧报告空态文案存在
  // 无 breakdown / 无 dimensions 的极端 legacy 也不崩
  assert.deepEqual(displayDimensions(null), []);
  assert.deepEqual(displayDimensions(undefined), []);
  assert.deepEqual(displayDimensions({ dimensions: 'bad' }), []);
});

test('P17 canonical 状态映射与中文保留', () => {
  assert.deepEqual(CANONICAL_STATES, ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP']);
  assert.deepEqual(STATE_ZH, {
    Evaluated: '已分析（待决策）', Applied: '已投递', Responded: '招聘方回应', Interview: '面试',
    Offer: 'Offer（录用）', Rejected: '未通过', Discarded: '已放弃', SKIP: '不投',
  });
  // 聚合 states 输出与 canonical 一致（设置页/筛选下拉数据源）
  const s = stateWith(LEGACY_RUN);
  assert.deepEqual(s.states.map(x => x.id), CANONICAL_STATES);
});

// ---------------------------------------------------------------------------
// 18-20. 品牌清理 / 单一分析入口 / 前端零评分
// ---------------------------------------------------------------------------

test('P18 用户可见区域清理 Career Ops 旧产品名；zhMetrics 清理 Runtime 文案', () => {
  const html = readWeb('index.html');
  const app = readWeb('app.js');
  assert.ok(!/Career Ops|career-ops/i.test(html), 'index.html 不得残留 Career Ops');
  assert.ok(!/Career Ops|career-ops/i.test(app), 'app.js 不得残留 Career Ops');
  assert.ok(html.includes('求职指挥中心'));
  // Runtime 文案里的旧品牌指标名 → 中文（不修改数据）
  assert.equal(zhMetrics('职级严重倒退（Career Ops Score 2.24/5）'), '职级严重倒退（综合评分 2.24/5）');
  assert.equal(zhMetrics('Career Score 3.8/5'), '综合评分 3.8/5');
  assert.ok(!/Career Ops/.test(zhMetrics('Career Ops Score 2.5/5')));
});

// Agent A 审计（B 类 stale copy）：generate-search-summary.mjs 用户可见文案清理
test('P30 generate-search-summary 用户可见表头/日志无 Career Ops 残留，C 类兼容逻辑保留', () => {
  const summary = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'generate-search-summary.mjs'),
    'utf8',
  );
  // 该文件空格版品牌字样出现 0 次；斜杠命令形态同样清理。
  // （无空格下划线标识符 career_ops_score 为 C 类兼容逻辑合法保留，不在断言范围）
  assert.ok(!summary.includes('Career Ops'), '不得残留 "Career Ops" 品牌表头/文案');
  assert.ok(!summary.includes('career-ops'), '不得残留 "career-ops" 品牌字样');
  // Excel 表头「Career Ops评分」→「综合评分」（与 Markdown 表头/Dashboard zhMetrics 语义一致）
  assert.ok(summary.includes("['综合评分',         j => j.analysis?.career_ops_score]"));
  assert.ok(!summary.includes('Career Ops评分'));
  // 数值格式化查找同步改名（防表头改名后数字格式静默失效）
  assert.ok(summary.includes("for (const numericName of ['综合评分', '初筛分(rule)'])"));
  // C 类兼容逻辑保留不动（审计裁决：不执行清理）
  assert.ok(summary.includes('return num(a.career_ops_score) ?? num(a.score) ?? num(a.rule_score) ?? null;'));
  assert.ok(summary.includes("return s(a.cv_match || '');"));
  // Markdown 表头本就是「综合评分」，未被改动
  assert.ok(summary.includes("L.push('| 公司 | 岗位 | 区域 | 薪资 | 匹配度 | 综合评分 | 推荐 |');"));
});

test('P19 "查看完整分析"保持单一主入口', () => {
  const app = readWeb('app.js');
  assert.equal(app.split('查看完整分析').length - 1, 1, 'app.js 只能有一个"查看完整分析"入口');
  assert.equal(readWeb('index.html').includes('查看完整分析'), false);
  // toggle 按钮存在且复用同一 section（不存在第二个同级分析按钮）
  assert.ok(app.includes('id="toggleReportBtn"'));
});

test('P20 Dashboard 不实现 scoring（前端无重算，只消费 Runtime 字段）', () => {
  const forbidden = [
    /computeScore\s*\(/, /computeRecommendation\s*\(/, /SCORING_RUBRIC/, /RECOMMENDATION_MATRIX/,
    /GAP_DOWNGRADE/, /scoreBand\s*\(/, /\bscore\s*\*\s*weight\b/, /weightedSum\s*[+=]/,
    /effectiveWeight\s*\+=/, /^[ \t]*import\b[^;'"]*scoring\.mjs/m,
  ];
  for (const f of ['app.js', 'lib/view-model.mjs', 'lib/aggregator.mjs']) {
    const src = readWeb(f);
    for (const re of forbidden) {
      assert.ok(!re.test(src), `${f} 出现评分/决策实现痕迹：${re}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 21-22. aggregator 字段透传 / fixture 匿名
// ---------------------------------------------------------------------------

test('P21 aggregator 透传 Runtime 新字段，不吞关键字段', () => {
  const s = stateWith(PHASE6_RUN);
  assert.equal(s.jobs.length, 3);
  const a2 = s.jobs.find(j => j.job_id === 'fixture-002').analysis;
  assert.deepEqual(a2.cv_match_confidence, FIXTURE_002.analysis.cv_match_confidence);
  assert.equal(a2.career_score, 2.8);
  assert.equal(a2.career_ops_score, 2.8);
  assert.deepEqual(a2.score_confidence, FIXTURE_002.analysis.score_confidence);
  assert.equal(a2.recommendation, '不推荐');
  assert.deepEqual(a2.decision_trace, FIXTURE_002.analysis.decision_trace);
  assert.deepEqual(a2.blockers, FIXTURE_002.analysis.blockers);
  assert.deepEqual(a2.hard_gaps, FIXTURE_002.analysis.hard_gaps);
  assert.deepEqual(a2.soft_gaps, FIXTURE_002.analysis.soft_gaps);
  assert.deepEqual(a2.dimensions, FIXTURE_002.analysis.dimensions);
  assert.deepEqual(a2.taxonomy, FIXTURE_002.analysis.taxonomy);
  assert.deepEqual(a2.capability_summary, FIXTURE_002.analysis.capability_summary);
  assert.equal(a2.eligibility_status, 'eligible_with_gaps');
  const a1 = s.jobs.find(j => j.job_id === 'fixture-001').analysis;
  assert.deepEqual(a1.capability_summary, FIXTURE_001.analysis.capability_summary);
  // 兼容链：career_ops_score ← career_score ← score
  assert.deepEqual(s.jobs.find(j => j.job_id === 'fixture-legacy') || { analysis: {} }, { analysis: {} });
  assert.equal(a1.cv_match_confidence.percent, 88);
});

test('P22 新增 fixture 全部匿名（无真实公司 / Boss id / URL / 联系人 / 真实报告名）', () => {
  const src = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'phase6-fixtures.mjs'),
    'utf8',
  );
  assert.ok(!/zhipin\.com/i.test(src), '不得包含 Boss URL');
  assert.ok(!/https?:\/\//.test(src), 'fixture 不得包含任何 URL');
  assert.ok(!/KCTION|科圣博|一亩鲜生|临晟|LTMG|kction|yimuxiansheng|lincheng/i.test(src), '不得包含真实公司名');
  for (const j of [FIXTURE_001, FIXTURE_002, FIXTURE_003, LEGACY_RUN.jobs[0]]) {
    assert.match(j.job_id, /^fixture-/);
    assert.equal(j.job_url, null);
    assert.match(j.company, /^示例/);
    if (j.recruiter_name != null) assert.match(j.recruiter_name, /^示例/);
  }
  // fixture-001 禁止出现 P6/P7、GitHub、技术栈、系统设计等互联网语义
  const t1 = JSON.stringify(FIXTURE_001);
  assert.ok(!/P6|P7|GitHub|github|技术栈|系统设计/.test(t1));
});

// ---------------------------------------------------------------------------
// 23-25. 布局锁定（静态 CSS 断言，不起浏览器）
// ---------------------------------------------------------------------------

function parseMediaBlocks(css) {
  const blocks = [];
  const re = /@media([^{]*)\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    blocks.push({ cond: m[1].trim(), body: css.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return blocks;
}

function baseDecl(css, selector, prop) {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(css))) {
    const pm = m[1].match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`));
    if (pm) return pm[1].trim();
  }
  return null;
}

function declAtWidth(css, selector, prop, width) {
  let val = baseDecl(css, selector, prop);
  for (const b of parseMediaBlocks(css)) {
    const mm = b.cond.match(/max-width:\s*([\d.]+)px/);
    if (mm && width <= parseFloat(mm[1])) {
      const v = baseDecl(b.body, selector, prop);
      if (v) val = v;
    }
  }
  return val;
}

const CSS = readWeb('styles.css');
const SHELL_BASE = 'clamp(196px, 15vw, 250px) clamp(540px, 46vw, 650px) minmax(360px, 1fr)';

test('P23 1280px 布局：三栏 base 栅格 + 推荐结果 5 格 + 核心进度结构锁定', () => {
  assert.equal(declAtWidth(CSS, '.shell', 'grid-template-columns', 1280), SHELL_BASE);
  assert.equal(declAtWidth(CSS, '.rec-grid', 'grid-template-columns', 1280), 'repeat(5, minmax(0, 1fr))');
  // 核心进度：圆环/星形两段式 + 中间分隔（视觉验收锁定，零回归）
  assert.equal(baseDecl(CSS, '.core-ring-row', 'grid-template-columns'), '1fr auto 1fr');
  assert.ok(CSS.includes('.core-divider'));
  assert.ok(CSS.includes('.star-disc'));
  assert.ok(CSS.includes('.ring-stat'));
});

test('P24 1440px 布局：base 栅格 + 详情四卡一行 + 概览内容宽度上限', () => {
  assert.equal(declAtWidth(CSS, '.shell', 'grid-template-columns', 1440), SHELL_BASE);
  assert.equal(baseDecl(CSS, '.d-verdict', 'grid-template-columns'), 'repeat(4, 1fr)');
  assert.equal(baseDecl(CSS, '.dash-view', 'max-width'), '1060px');
});

test('P25 1680px 布局：base 栅格 + wide 两栏变体 + 内容区滚动收敛', () => {
  assert.equal(declAtWidth(CSS, '.shell', 'grid-template-columns', 1680), SHELL_BASE);
  assert.ok(declAtWidth(CSS, '.shell', 'grid-template-columns', 1680).includes('minmax(360px, 1fr)'));
  // 概览/记录/设置页 wide 变体（隐藏右栏）保持
  assert.equal(baseDecl(CSS, '.shell.wide', 'grid-template-columns'), 'clamp(196px, 15vw, 250px) minmax(0, 1fr)');
  assert.equal(baseDecl(CSS, '.content-area', 'overflow-y'), 'auto');
  // 断点仅 1220/1060/920：任何 ≤1280 的真实桌面宽度不会触发
  const breakpoints = parseMediaBlocks(CSS)
    .map(b => parseFloat((b.cond.match(/([\d.]+)px/) || [])[1]))
    .sort((a, b) => b - a);
  assert.deepEqual(breakpoints, [1220, 1060, 1060, 920]);
});

// ---------------------------------------------------------------------------
// P26-P28. Review 复核修复锁定（Phase 6 第二轮）
// ---------------------------------------------------------------------------

test('P26 报告原文区顶部含"旧版存档"提示（单处、位于原文之前，报告原文本身不被改写）', () => {
  const app = readWeb('app.js');
  assert.equal(app.split('旧版存档').length - 1, 1, '存档提示只能有一处');
  assert.ok(app.includes('该报告由旧版评分引擎生成，评分维度体系已更新，以下为历史存档原文'));
  // 提示在报告原文容器（reportContent）之前，且原文仍原样注入（textContent），不被改写
  const idxNotice = app.indexOf('旧版存档');
  const idxReport = app.indexOf('id="reportContent-');
  assert.ok(idxNotice > -1 && idxReport > -1 && idxNotice < idxReport);
  assert.ok(app.includes("el.textContent = r.content"));
  // 无第二分析入口（P19 联动）
  assert.equal(app.split('查看完整分析').length - 1, 1);
});

test('P27 真实旧格式形态锁定：四值照常展示 + 新字段缺失→暂无数据语义 + 明细空态（P0-1 裁决）', () => {
  const s = stateWith({ ...PHASE6_RUN, jobs: [LEGACY_SCORED_RUN.jobs[0]] });
  const a = s.jobs[0].analysis;
  // 存在且范围合法的旧字段继续展示，禁止整体降级为暂无数据（已验收视觉基于这些值）
  assert.equal(a.cv_match_score, 72);
  assert.equal(a.career_ops_score, 2.58);
  assert.equal(a.recommendation, '不推荐');
  assert.deepEqual(a.score_confidence, { percent: 95.7, level: '高' });
  assert.deepEqual(verdictCards(a).map(c => c.num), ['72%', '2.58', '不推荐', '95.7%']);
  // 第四卡 label 保持基线形态"可信度 · 高"（.v-label nowrap+ellipsis，长 label 三档宽度会截断）
  assert.deepEqual(verdictCards(a).map(c => c.label),
    ['简历匹配度', '综合评分 / 5', '推荐结论', '可信度 · 高']);
  // 零截断锁定：四卡 label 长度不超过基线最长卡（"综合评分 / 5" = 8 字符）
  for (const c of verdictCards(a)) assert.ok(c.label.length <= 8, `v-card label 过长会截断：${c.label}`);
  // "Career Score 层语义"由评分明细汇总行的长 label 承载（app.js），四值卡内不重复
  assert.equal(readWeb('app.js').split('评分可信度（Career Score）').length - 1, 1);
  // Phase 4+ 新字段缺失：aggregator 透传 null，不崩、不伪造、不补算
  assert.equal(a.decision_trace, null);
  assert.equal(a.blockers, null);
  assert.equal(a.hard_gaps, null);
  assert.equal(a.soft_gaps, null);
  assert.equal(a.cv_match_confidence, null);
  assert.equal(a.taxonomy, null);
  assert.equal(a.capability_summary, null);
  assert.equal(a.career_score, 2.58); // 兼容别名仍有值（同一来源，非补算）
  // 展示层缺失语义：无 trace 行、无 blocker 命中、旧维度明细不显示（空态文案存在）
  assert.deepEqual(traceLines(a.decision_trace), []);
  assert.deepEqual(blockerHits(a.blockers), []);
  assert.deepEqual(displayDimensions(a.score_breakdown).map(d => d.key), []);
  assert.ok(!JSON.stringify(displayDimensions(a.score_breakdown)).includes('north_star'));
  assert.ok(readWeb('app.js').includes('暂无可展示维度'));
  // 置信度 percent 缺失 → 绝不显示 "null%"（P1-1 联动锁定）
  assert.equal(verdictCards({ score_confidence: { percent: null, level: null } })[3].num, '—');
  assert.equal(verdictCards({ score_confidence: { percent: null, level: null } })[3].label, '可信度');
});

test('P28 推荐结果五格计数与聚合一致：真实旧格式形态 不推荐=3 与总数行一致；未知推荐不进格', () => {
  // 真实三岗位形态（recommendation 均为"不推荐"）：五格计数 = 岗位总数，"共 X 个岗位"行一致
  const s = stateWith(PHASE6_RUN);
  const cells = recommendationCells(s.stats.by_recommendation);
  assert.deepEqual(cells.map(c => `${c[0]}=${c[1]}`), ['强烈推荐=0', '推荐=0', '一般=0', '不推荐=3', '硬红线=0']);
  assert.equal(cells.reduce((n, c) => n + c[1], 0), s.stats.total);
  // 未知 recommendation（不在五档枚举内）不进任何格子、不虚增五格总数（聚合仍如实记录）
  const s2 = stateWith({
    ...PHASE6_RUN,
    jobs: [{ ...FIXTURE_001, job_id: 'fixture-rec-unknown', analysis: { ...FIXTURE_001.analysis, recommendation: '待定' } }],
  });
  assert.deepEqual(recommendationCells(s2.stats.by_recommendation).map(c => c[1]), [0, 0, 0, 0, 0]);
  assert.equal(s2.stats.by_recommendation['待定'], 1);
});

test('P29 平均值只对有效数值岗位求平均：缺失不当作 0 分，全无效 → null（展示层"暂无数据"）', () => {
  // 两个岗位：一个有 cv/score，一个完全没有 → 平均只看前者
  const s = stateWith({
    ...PHASE6_RUN,
    jobs: [
      { ...FIXTURE_001, job_id: 'fixture-avg-1' },
      { ...FIXTURE_003, job_id: 'fixture-avg-2', analysis: {} },
    ],
  });
  assert.equal(s.stats.avg_cv_match, 58);          // (58)/1，不是 (58+0)/2=29
  assert.equal(s.stats.avg_career_ops_score, 2.2); // 2.24 经既有 1 位小数展示舍入（非缺失当 0 的 (2.24+0)/2=1.1）
  // 全部无效 → null（概览"当前搜索摘要"显示暂无数据，不显示 0%/0.0）
  const s2 = stateWith({ ...PHASE6_RUN, jobs: [{ ...FIXTURE_002, job_id: 'fixture-avg-3', analysis: {} }] });
  assert.equal(s2.stats.avg_cv_match, null);
  assert.equal(s2.stats.avg_career_ops_score, null);
  assert.ok(readWeb('app.js').includes("'暂无数据'")); // 摘要行空态文案
});

// ---------------------------------------------------------------------------
// P31. 推荐原因用户可见化（reasonZh）：内部调试术语不外漏，rescored 数据与缺口语义不动
// ---------------------------------------------------------------------------

test('P31 reasonZh 推荐原因去内部术语：调试括号段移除 + 措辞统一 + BLOCKER key 守卫，001/003 逐字不变', () => {
  // 规则 1+2：002 原文（rescored 数据）→ 调试括号段整体移除 + 引擎措辞与 BLOCKER_ZH 对齐
  const raw002 = '硬性资格不满足（eligibility=ineligible，job-side blocker）（Career Ops Score 2.8/5）';
  const out002 = reasonZh(raw002);
  assert.ok(!out002.includes('eligibility=ineligible'));
  assert.ok(!out002.includes('job-side blocker'));
  assert.equal(out002, '不满足岗位硬性要求（综合评分 2.8/5）');
  // candidate-side blocker 括号段同样整体移除，且不吞相邻正常括号（评分括号保留）
  const candSide = reasonZh('不满足岗位硬性要求（candidate-side blocker）（Career Ops Score 2.8/5）');
  assert.ok(!candSide.includes('candidate-side blocker'));
  assert.equal(candSide, '不满足岗位硬性要求（综合评分 2.8/5）');
  // 规则 3：BLOCKER_ZH 英文 key → 对应中文（复用现有映射，P10b 映射继续成立）
  assert.equal(BLOCKER_ZH.eligibility_ineligible, '不满足岗位硬性要求');
  const guarded = reasonZh('同时命中 salary_floor_breach、work_schedule_blocker');
  assert.ok(!guarded.includes('salary_floor_breach') && !guarded.includes('work_schedule_blocker'));
  assert.ok(guarded.includes(BLOCKER_ZH.salary_floor_breach) && guarded.includes(BLOCKER_ZH.work_schedule_blocker));
  // 规则 4：001/003 原文无英文 key、无调试括号段 → 除 zhMetrics 外逐字不变
  assert.equal(reasonZh('职级严重倒退（Career Ops Score 2.24/5）'), '职级严重倒退（综合评分 2.24/5）');
  assert.equal(
    reasonZh('现任雇主/关联主体岗位，不构成外部跳槽机会（Career Ops Score 3.8/5）'),
    '现任雇主/关联主体岗位，不构成外部跳槽机会（综合评分 3.8/5）',
  );
  // 002 品类缺口语义不受影响：gaps/主要短板走 gapItemText 渲染路径，不经 reasonZh；
  // 缺口文本（含品类资源字样）原样保留，经 reasonZh 也逐字不变（P13 联动）
  const hardGap = FIXTURE_002.analysis.hard_gaps.map(gapItemText).join('；');
  assert.match(hardGap, /生鲜/);
  assert.match(hardGap, /供应商资源/);
  assert.equal(reasonZh(hardGap), hardGap);
  // rescored 数据三层结果不变（展示层零重算、零改写）：不推荐 + CV 48 + Career 2.8
  const a2 = FIXTURE_002.analysis;
  assert.equal(a2.recommendation, '不推荐');
  assert.equal(a2.cv_match_score, 48);
  assert.equal(a2.career_ops_score, 2.8);
  // 接线锁定：app.js 两处 recommendation_reason 展示点（列表行 + 详情 reason-box）均用 reasonZh
  const app = readWeb('app.js');
  assert.equal(app.split('reasonZh(a.recommendation_reason)').length - 1, 2);
});
