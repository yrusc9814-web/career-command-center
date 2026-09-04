// persistence-gate.test.mjs — Round 2B Persistence Gate 测试族（P1–P15 + 集成 + bypass 负向）
// Run: node --test tools/tests/persistence-gate.test.mjs
//
// 夹具全部匿名合成；不使用真实 JD / 真实 job_id。
// 铁律覆盖：唯一 Gate（finalizeAnalysisForPersistence）/ engine > model merge precedence /
// writer enforcement（writeRunFile 拒绝 raw）/ schema_status 与 content_status 分离 /
// 批次 summary 契约 / legacy 读 → canonical 写。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ANALYSIS_SCHEMA_VERSION,
  finalizeAnalysisForPersistence, assertCanonicalAnalysis, isAnalyzed,
  computeContentStatus, buildBatchSummary, formatBatchSummary,
} from '../../dashboard-web/lib/analysis-contract.mjs';
import { writeRunFile, readRunFile, auditRunJobs } from '../lib/analysis-persistence.mjs';

// ── 夹具工厂（匿名合成）─────────────────────────────────────────────
const ENGINE_OK = (over = {}) => ({
  cv_match_score: 72,
  cv_match: '72%',
  career_ops_score: 63.75,
  score: 63.75,
  score_scale: '0-100',
  score_scale_version: 2,
  score_confidence: { percent: 90, level: '高' },
  score_breakdown: {
    total_weight: 100, effective_weight: 100,
    dimensions: [{ key: 'compensation', weight: 20, score: 75, weighted_value: 1500, status: 'known' }],
  },
  recommendation: '一般',
  recommendation_reason: '引擎判定：矩阵档位一般',
  decision_trace: [{ step: 1, rule: 'matrix', input: { career_ops_score: 63.75 }, outcome: '一般' }],
  eligibility_status: 'eligible',
  blockers: {},
  hard_redline: false,
  ...over,
});

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2b-gate-'));
  return path.join(dir, name);
}

// ── P1 canonical provider → PASS ────────────────────────────────────
test('P1 完整 canonical provider + engine → PASS，persistable', () => {
  const r = finalizeAnalysisForPersistence({
    provider: {
      strengths: ['同域执行经验完整'], gaps: ['品类缺口'], soft_gaps: [],
      cv_advice: '改写品类叙事。', interview_focus: '确认资源要求。',
      recommendation_reason: '模型解释文本', // 会被 engine 覆盖
    },
    engine: ENGINE_OK(),
    source: 'P1',
  });
  assert.equal(r.ok, true);
  assert.equal(r.schema_status, 'complete');
  const chk = assertCanonicalAnalysis(r.analysis);
  assert.deepEqual(chk, { ok: true, errors: [] });
});

// ── P2 missing narrative → normalize/repair 补 canonical 空值 → PASS ──
test('P2 缺 cv_advice → 归一补 canonical 空值，schema complete，PASS', () => {
  const r = finalizeAnalysisForPersistence({ provider: { strengths: ['x'] }, engine: ENGINE_OK() });
  assert.equal(r.ok, true);
  assert.equal(r.analysis.cv_advice, '');
  assert.equal(r.analysis.gaps.length, 0);
  assert.ok(r.repaired_actions.length > 0);
});

// ── P3 type drift → normalize 为正式类型 ─────────────────────────────
test('P3 interview_focus: [] → 归一为 string；cv_advice 数组 → string', () => {
  const r = finalizeAnalysisForPersistence({
    provider: { interview_focus: ['问题1', '问题2'], cv_advice: ['建议A', '建议B'] },
    engine: ENGINE_OK(),
  });
  assert.equal(r.ok, true);
  assert.equal(typeof r.analysis.interview_focus, 'string');
  assert.ok(r.analysis.interview_focus.includes('问题1'));
  assert.equal(typeof r.analysis.cv_advice, 'string');
});

// ── P4 alias provider → canonical，别名 key 不残留 ──────────────────
test('P4 advantages/resume_suggestions → strengths/cv_advice，alias key 移除', () => {
  const r = finalizeAnalysisForPersistence({
    provider: { advantages: ['优势'], resume_suggestions: '建议', weaknesses: ['w'], fixable_gaps: ['f'] },
    engine: ENGINE_OK(),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.analysis.strengths, ['优势']);
  assert.equal(r.analysis.cv_advice, '建议');
  assert.deepEqual(r.analysis.gaps, ['w']);
  assert.deepEqual(r.analysis.soft_gaps, ['f']);
  for (const k of ['advantages', 'resume_suggestions', 'weaknesses', 'fixable_gaps']) {
    assert.ok(!(k in r.analysis), `alias ${k} 不应残留`);
  }
});

// ── P5 provider 越权评分 → engine > model ────────────────────────────
test('P5 provider career_ops_score=99 → 最终 63.75（engine 覆盖）', () => {
  const r = finalizeAnalysisForPersistence({
    provider: { strengths: ['x'], career_ops_score: 99, cv_match_score: 100 },
    engine: ENGINE_OK(),
  });
  assert.equal(r.ok, true);
  assert.equal(r.analysis.career_ops_score, 63.75);
  assert.equal(r.analysis.cv_match_score, 72);
  assert.ok(r.overrides_removed.includes('career_ops_score'));
  assert.ok(r.overrides_removed.includes('cv_match_score'));
});

// ── P6 provider 越权 recommendation → engine > model ─────────────────
test('P6 provider recommendation=强烈推荐 → 最终 一般（engine 覆盖）', () => {
  const r = finalizeAnalysisForPersistence({
    provider: { strengths: ['x'], recommendation: '强烈推荐' },
    engine: ENGINE_OK(),
  });
  assert.equal(r.ok, true);
  assert.equal(r.analysis.recommendation, '一般');
  assert.ok(r.overrides_removed.includes('recommendation'));
});

// ── P7 missing engine field → FAIL persistence，不伪造 ───────────────
test('P7 缺 decision_trace → FAIL，不自动补假 trace', () => {
  const eng = ENGINE_OK();
  delete eng.decision_trace;
  const r = finalizeAnalysisForPersistence({ provider: { strengths: ['x'] }, engine: eng });
  assert.equal(r.ok, false);
  assert.equal(r.schema_status, 'invalid');
  assert.ok(r.reason.includes('decision_trace') || r.validate.missing_sections.includes('decision_trace'));
});

// ── P8 wrong score scale → FAIL ─────────────────────────────────────
test('P8 score_scale_version=1 → FAIL（量纲合同）', () => {
  const r = finalizeAnalysisForPersistence({
    provider: { strengths: ['x'] }, engine: ENGINE_OK({ score_scale_version: 1 }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('score_scale_version'));
});

// ── P9 invalid recommendation enum → FAIL ───────────────────────────
test('P9 recommendation=超级推荐（非法枚举）→ FAIL', () => {
  const r = finalizeAnalysisForPersistence({
    provider: { strengths: ['x'] }, engine: ENGINE_OK({ recommendation: '超级推荐' }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes('invalid-enum') || r.validate.type_errors.some(t => t.startsWith('recommendation')));
});

// ── P10 direct writer bypass → 必须拒绝 ──────────────────────────────
test('P10 未过 Gate 的 raw analysis 直接调 writer → 拒绝且不落盘', () => {
  const raw = { jobs: [{ job_id: 'raw_test_1', company: '公司A', title: '采购', analysis: ENGINE_OK() }] };
  // ENGINE_OK 形态上 validate complete，但没有 schema v2 标记与 gate 封印 → 必须被 writer 拒绝
  const out = tmpFile('raw-out.json');
  assert.throws(() => writeRunFile(raw, out, { label: 'P10' }), /analysis_gate:missing-or-not-complete/);
  assert.equal(fs.existsSync(out), false);
});

// ── P11 rescore preservation（narrative 不丢）────────────────────────
test('P11 strict=false（rescore 路径）→ 既有 narrative 保留 + gate 元数据刷新', () => {
  const persisted = finalizeAnalysisForPersistence({
    provider: { strengths: ['既有优势'], gaps: ['既有缺口'], soft_gaps: ['可弥补'], cv_advice: '既有建议', interview_focus: '既有关注' },
    engine: ENGINE_OK({ career_ops_score: 50 }),
  });
  assert.equal(persisted.ok, true);
  // rescore：provider = 既有 canonical 对象（含 gate 元数据），engine 重算
  const rescored = finalizeAnalysisForPersistence({
    provider: persisted.analysis,
    engine: ENGINE_OK({ career_ops_score: 70, score: 70 }),
    strict: false,
    source: 'rescore',
  });
  assert.equal(rescored.ok, true);
  assert.deepEqual(rescored.analysis.strengths, ['既有优势']);
  assert.equal(rescored.analysis.cv_advice, '既有建议');
  assert.equal(rescored.analysis.career_ops_score, 70);
  assert.equal(rescored.analysis.analysis_gate.content_status, 'rich');
});

// ── P12 legacy read → canonical write ────────────────────────────────
test('P12 legacy 形态（alias+缺 section）→ Gate 后 canonical v2 落盘', () => {
  const legacyRun = {
    run_at: '2026-01-01T00:00:00Z', counters: {},
    jobs: [{
      job_id: 'legacy_test_1', company: '公司B', title: '寻源专员',
      analysis: {
        advantages: ['谈判经验'], resume_advice: '补量化',
        recommendation: '一般', recommendation_reason: 'r',
        career_ops_score: 55, cv_match_score: 60, score_scale_version: 2,
        score_confidence: { percent: 70, level: '中' },
        score_breakdown: { dimensions: [{ key: 'compensation', weight: 20, score: 55, weighted_value: 1100, status: 'known' }] },
        decision_trace: [{ step: 1, rule: 'm', input: {}, outcome: '一般' }],
        eligibility_status: 'eligible',
      },
    }],
  };
  // legacy 读入后逐岗位过 Gate（strict=false，既有对象刷新）
  for (const job of legacyRun.jobs) {
    const g = finalizeAnalysisForPersistence({ provider: job.analysis, strict: false, source: 'legacy-import' });
    assert.equal(g.ok, true);
    job.analysis = g.analysis;
  }
  const out = tmpFile('legacy-out.json');
  const res = writeRunFile(legacyRun, out, { label: 'P12' });
  assert.equal(res.asserted, 1);
  const back = readRunFile(out);
  const a = back.jobs[0].analysis;
  assert.equal(a.analysis_schema_version, ANALYSIS_SCHEMA_VERSION);
  assert.deepEqual(a.strengths, ['谈判经验']);
  assert.equal(a.cv_advice, '补量化');
  assert.ok(!(('advantages') in a) && !(('resume_advice') in a));
});

// ── P13 provider A/B/C 形状一致性 ────────────────────────────────────
test('P13 三种 provider 形态 → persisted keys/types 完全一致', () => {
  const variants = [
    // A：完整 canonical
    { strengths: ['s1'], gaps: ['g1'], soft_gaps: ['f1'], cv_advice: 'c', interview_focus: 'i' },
    // B：缺 narrative
    {},
    // C：乱类型 + alias + 未知 key
    { advantages: ['s1'], weaknesses: 'g1', interview_suggestions: ['i'], random_extra: { x: 1 } },
  ];
  const shapes = variants.map(v => {
    const r = finalizeAnalysisForPersistence({ provider: v, engine: ENGINE_OK() });
    assert.equal(r.ok, true, `variant should pass: ${r.reason}`);
    const a = r.analysis;
    return JSON.stringify(Object.keys(a).sort()) + '|' + JSON.stringify(Object.entries(a).map(([k, val]) => [k, Array.isArray(val) ? 'array' : typeof val]).sort());
  });
  assert.equal(shapes[0], shapes[1]);
  assert.equal(shapes[0], shapes[2]);
});

// ── P14 content_status deterministic 锁定 ────────────────────────────
test('P14 rich/partial/sparse 判定 deterministic（模型无权自报）', () => {
  assert.equal(computeContentStatus({
    recommendation_reason: 'r', strengths: ['1', '2'], gaps: ['1'],
    soft_gaps: ['1'], cv_advice: 'c', interview_focus: 'i',
  }).status, 'rich');
  assert.equal(computeContentStatus({
    recommendation_reason: 'r', strengths: ['1', '2'], gaps: ['1'],
    soft_gaps: [], cv_advice: '', interview_focus: '',
  }).status, 'partial');
  assert.equal(computeContentStatus({
    recommendation_reason: 'r', strengths: ['1'], gaps: [], soft_gaps: [], cv_advice: '', interview_focus: '',
  }).status, 'sparse');
  // gate 元数据里的 content_status 与现算一致（gate 判定不被 provider 覆盖）
  const r = finalizeAnalysisForPersistence({
    provider: { strengths: ['1'], content_status: 'rich' }, engine: ENGINE_OK(),
  });
  assert.equal(r.analysis.analysis_gate.content_status, 'sparse');
  assert.ok(r.dropped_keys.includes('content_status'));
});

// ── P15 batch summary 契约 ───────────────────────────────────────────
test('P15 buildBatchSummary：22 accepted 模拟统计正确 + 格式化输出', () => {
  const entries = Array.from({ length: 22 }, (_, i) => {
    const repaired = i < 6;
    const content = ['rich', 'partial', 'sparse'][i % 3];
    return {
      ok: true,
      content_status: content,
      overrides_removed: i < 3 ? ['career_ops_score'] : i === 3 ? ['recommendation'] : [],
      analysis: { analysis_gate: { repaired, content_status: content } },
    };
  });
  entries.push({ ok: false }); // 1 个被拒
  const s = buildBatchSummary(entries);
  assert.deepEqual(
    { ...s, total: s.total },
    {
      total: 23, schema_pass: 22, schema_rejected: 1, repaired: 6,
      rich: 8, partial: 7, sparse: 7, persist_rejected: 1,
      numeric_drift: 3, recommendation_drift: 1, eligibility_drift: 0,
    },
  );
  const text = formatBatchSummary(s);
  assert.ok(text.includes('Schema PASS: 22/23'));
  assert.ok(text.includes('Rejected: 1'));
});

// ── 集成测试：fake provider → 真实 finalize CLI → 真实 writer → 读回 validate ──
test('集成：CLI finalize → writer → 读回 canonical；raw 直接写 writer 必败', async () => {
  // 1) fake provider 输入（finalize 指令文件形态）
  const input = {
    defaults: ENGINE_OK(),
    jobs: [{
      job: { job_id: 'intg_test_1', company: '公司C', title: '品类采购', description: 'JD 文本' },
      provider: { advantages: ['优势A'], career_ops_score: 99, recommendation: '强烈推荐' },
      engine: {},
      source: 'integration-test',
    }],
  };
  const inFile = tmpFile('intg-in.json');
  const outFile = tmpFile('intg-out.json');
  fs.writeFileSync(inFile, JSON.stringify(input));
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['tools/finalize-analysis.mjs', '--in', inFile, '--out', outFile], { encoding: 'utf8' });
  // 2) 读回：canonical + gate 封印 + engine > model
  const back = readRunFile(outFile);
  const a = back.jobs[0].analysis;
  assert.equal(assertCanonicalAnalysis(a).ok, true);
  assert.equal(a.career_ops_score, 63.75);        // D 的 99 被拒
  assert.equal(a.recommendation, '一般');
  assert.deepEqual(a.strengths, ['优势A']);
  // 3) raw object 直接 writer → 失败
  const rawOut = tmpFile('raw-intg.json');
  const rawRun = { jobs: [{ job_id: 'raw_intg', analysis: { recommendation: '一般' } }] };
  assert.throws(() => writeRunFile(rawRun, rawOut), /persistence rejected/);
  assert.equal(fs.existsSync(rawOut), false);
});

// ── 补充：未分析行（skipped_rule 早期行）不要求 gate 封印 ─────────────
test('未分析行（isAnalyzed=false）writer 不做 canonical 要求', () => {
  const run = { jobs: [{ job_id: 'skip_1', analysis: { rule_filter: 'skip', skip_reason: '区域不符', recommendation: '不推荐' } }] };
  // recommendation 有值 → isAnalyzed=true，但缺 engine 契约 → 仍需 gate；这里验证纯空 analysis 不校验
  const run2 = { jobs: [{ job_id: 'empty_1', analysis: { rule_filter: 'skip' } }] };
  const out = tmpFile('empty-out.json');
  const res = writeRunFile(run2, out, { label: 'empty' });
  assert.equal(res.asserted, 0);
  assert.ok(fs.existsSync(out));
  assert.ok(isAnalyzed(run.jobs[0].analysis)); // skip_1 带 recommendation → 走 gate 校验
});

// ── auditRunJobs 审计函数 ─────────────────────────────────────────────
test('auditRunJobs：schema_fail 与 content 分布统计正确', () => {
  const good = finalizeAnalysisForPersistence({
    provider: { strengths: ['1', '2'], gaps: ['1'], soft_gaps: ['1'], cv_advice: 'c', interview_focus: 'i', recommendation_reason: 'r' },
    engine: ENGINE_OK(),
  });
  const run = { jobs: [
    { job_id: 'a1', analysis: good.analysis },
    { job_id: 'a2', analysis: { recommendation: '一般', career_ops_score: 50 } }, // raw，无 gate
  ] };
  const r = auditRunJobs(run);
  assert.equal(r.analyzed, 2);
  assert.equal(r.schema_fail, 1);
  assert.equal(r.rich, 1);
  assert.equal(r.fail_detail[0].job_id, 'a2');
});

// ── Round 2C：生产路径集成测试（必须调用生产 CLI，不得只调纯函数）──────
const { execFileSync } = await import('node:child_process');

/** 生产 entry：node tools/finalize-analysis.mjs（browser-search Step 7 / batch Step 5b 唯一命令）。
 *  返回 { code, output }；非零退出不抛（调用方自行断言拒绝语义）。 */
function runFinalizeCli(inFile, outFile) {
  try {
    const stdout = execFileSync(process.execPath, ['tools/finalize-analysis.mjs', '--in', inFile, '--out', outFile],
      { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '../..') });
    return { code: 0, output: stdout };
  } catch (e) {
    return { code: e.status ?? 1, output: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const R2C_ENGINE_DEFAULTS = {
  cv_match_score: 72, cv_match: '72%', career_ops_score: 63.75, score: 63.75,
  score_scale: '0-100', score_scale_version: 2,
  score_confidence: { percent: 90, level: '高' },
  score_breakdown: { total_weight: 100, effective_weight: 100,
    dimensions: [{ key: 'compensation', name: '薪酬竞争力', weight: 20, score: 75, weighted_value: 1500, status: 'known' }] },
  recommendation: '一般', recommendation_reason: '引擎判定：决策矩阵一般档',
  decision_trace: [
    { step: 1, rule: 'hard_redline_or_deal_breakers', input: {}, outcome: 'miss' },
    { step: 2, rule: 'matrix', input: { career_ops_score: 63.75, cv_match_score: 72 }, outcome: '一般' },
  ],
  eligibility_status: 'eligible', blockers: {}, hard_redline: false, rule_filter: 'pass', rule_score: 0,
};

test('2C-A browser-search 生产 persistence entry：匿名 fixture 经真实 CLI → engine>provider + canonical', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-bs-'));
  const inFile = path.join(dir, 'bs-fixture.json');
  const outFile = path.join(dir, 'bs-persisted.json');
  // 按 modes/browser-search.md Step 7 的指令文件形态构造（provider 含越权 + alias + 垃圾 key）
  fs.writeFileSync(inFile, JSON.stringify({
    defaults: R2C_ENGINE_DEFAULTS,
    jobs: [{
      job: { platform: 'boss', job_id: 'fixture-browser-search-001', title: 'Procurement Specialist', company: 'Fixture Electronics', description: '【匿名 fixture】' },
      provider: {
        strengths: ['两年电子料采购执行经验'], gaps: ['无连接器品类资源'],
        interview_focus: ['确认品类资源要求'],
        resume_suggestions: ['量化降本战果'],           // alias → cv_advice
        trash_unknown_field: { x: 1 },                 // 垃圾 key
        career_ops_score: 99, cv_match_score: 100,     // 越权评分
        recommendation: '强烈推荐',                     // 越权决策
        eligibility_status: 'super_eligible',          // 非法枚举
        score_scale_version: 3,                         // 非法量纲
      },
      engine: {}, source: '2C-A-test',
    }],
  }));
  const { output } = runFinalizeCli(inFile, outFile);
  assert.ok(output.includes('Schema PASS: 1/1'));
  assert.ok(output.includes('Numeric Drift: 1') && output.includes('Recommendation Drift: 1') && output.includes('Eligibility Drift: 1'));
  const a = readRunFile(outFile).jobs[0].analysis;
  assert.equal(a.career_ops_score, 63.75);
  assert.equal(a.cv_match_score, 72);
  assert.equal(a.recommendation, '一般');
  assert.equal(a.eligibility_status, 'eligible');
  assert.equal(a.score_scale_version, 2);
  assert.equal(a.analysis_gate.schema_status, 'complete');
  assert.equal(a.analysis_gate.content_status, 'rich');
  assert.equal(typeof a.cv_advice, 'string');
  assert.ok('trash_unknown_field' in (a.analysis_gate.dropped_keys ?? []) === false && a.analysis_gate.dropped_keys.includes('trash_unknown_field'));
  assert.ok(!('trash_unknown_field' in a));
  assert.ok(assertCanonicalAnalysis(a).ok);
});

test('2C-A-neg browser-search 生产 entry：raw 完整对象（无 engine）→ CLI 拒绝且不落盘', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-bsn-'));
  const inFile = path.join(dir, 'bypass.json');
  const outFile = path.join(dir, 'must-not-exist.json');
  fs.writeFileSync(inFile, JSON.stringify({
    jobs: [{ job: { job_id: 'fixture-bypass-001', company: 'Fixture Bypass Co' },
      provider: {
        strengths: ['s'], gaps: [], soft_gaps: [], cv_advice: 'c', interview_focus: 'i',
        recommendation: '强烈推荐', recommendation_reason: '模型自评完美',
        cv_match_score: 95, career_ops_score: 88, score_scale_version: 2,
        score_confidence: { percent: 99, level: '高' },
        score_breakdown: { dimensions: [{ key: 'compensation', weight: 20, score: 88, weighted_value: 1760, status: 'known' }] },
        eligibility_status: 'eligible',
      }, engine: {}, source: 'bypass' }],
  }));
  const { code, output } = runFinalizeCli(inFile, outFile);
  assert.equal(code, 1);
  assert.ok(output.includes('Schema PASS: 0/1'));
  assert.equal(fs.existsSync(outFile), false);
});

test('2C-B batch 生产 persistence entry：双岗 fixture（A canonical / B alias+漂移+假分）→ 同一 Gate、形状一致、summary 实测', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-batch-'));
  const inFile = path.join(dir, 'batch-fixture.json');
  const outFile = path.join(dir, 'batch-persisted.json');
  fs.writeFileSync(inFile, JSON.stringify({
    defaults: { ...R2C_ENGINE_DEFAULTS, career_ops_score: 58.25, score: 58.25, recommendation_reason: '引擎判定：决策矩阵一般档（batch defaults）' },
    jobs: [
      { job: { job_id: 'fixture-batch-001-A', company: 'Fixture Manufacturing A', title: 'Senior Procurement Engineer' },
        provider: {
          strengths: ['机械品类五年寻源经验'], gaps: ['无 IATF 16949 体系经验'], soft_gaps: ['未主导过 VAVE'],
          cv_advice: '拆分降本矩阵', interview_focus: '追问降本口径',
        }, engine: {}, source: '2C-B-A' },
      { job: { job_id: 'fixture-batch-002-B', company: 'Fixture Trading B', title: 'Procurement Specialist' },
        provider: {
          advantages: ['执行层订单处理熟练'], weaknesses: 42,          // alias + 类型漂移
          resume_suggestions: ['统一量化口径'],                        // alias → cv_advice（第 3 信号位）
          fake_junk: { x: 1 },                                        // 垃圾 key
          career_ops_score: 91, recommendation: '强烈推荐',            // 假分/假决策
          eligibility_status: 'ineligible', score_scale_version: 7,   // 与 engine 冲突 + 非法量纲
        }, engine: {}, source: '2C-B-B' },
    ],
  }));
  const { code, output } = runFinalizeCli(inFile, outFile);
  assert.equal(code, 0);
  // §8 batch summary 字段由生产链真实输出
  for (const line of ['Total: 2', 'Schema PASS: 2/2', 'Repaired:', 'Rich: 1', 'Partial: 1', 'Sparse: 0',
    'Rejected: 0', 'Numeric Drift: 1', 'Recommendation Drift: 1', 'Eligibility Drift: 1']) {
    assert.ok(output.includes(line), `batch summary 缺字段: ${line}`);
  }
  const jobs = readRunFile(outFile).jobs;
  const [a, b] = jobs.map(j => j.analysis);
  // canonical 形状一致（P13 生产路径版）
  const shape = (x) => JSON.stringify(sortedShape(x));
  assert.equal(shape(a), shape(b));
  // engine > provider
  assert.equal(b.career_ops_score, 58.25);
  assert.equal(b.recommendation, '一般');
  assert.equal(b.eligibility_status, 'eligible');
  assert.equal(b.score_scale_version, 2);
  assert.deepEqual(b.gaps, []);            // weaknesses:42 → 类型归一 []（42 不是字符串数组内容）
  assert.deepEqual(b.strengths, ['执行层订单处理熟练']);
  assert.equal(b.analysis_gate.schema_status, 'complete');
  assert.ok(assertCanonicalAnalysis(a).ok && assertCanonicalAnalysis(b).ok);
});

test('2C-C recanonicalize 封印边界：无封印 raw 对象混入 sealed run → 整体拒绝；全 sealed → 照常刷新', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-seal-'));
  const sealed = finalizeAnalysisForPersistence({ provider: { strengths: ['s'] }, engine: ENGINE_OK() });
  const tampered = { jobs: [
    { job_id: 'sealed-ok', analysis: sealed.analysis },
    { job_id: 'bypass-sim-999', analysis: {  // 形态上 validate-complete，但从未过 Gate
      recommendation: '推荐', recommendation_reason: 'r', strengths: ['s'], gaps: [], soft_gaps: [],
      cv_advice: 'c', interview_focus: 'i', cv_match_score: 90, career_ops_score: 85, score_scale_version: 2,
      score_confidence: { percent: 90, level: '高' },
      score_breakdown: { dimensions: [{ key: 'compensation', weight: 20, score: 85, weighted_value: 1700, status: 'known' }] },
      decision_trace: [{ step: 1, rule: 'm', input: {}, outcome: '推荐' }], eligibility_status: 'eligible',
    } },
  ] };
  const inFile = path.join(dir, 'tampered.json');
  const outFile = path.join(dir, 'must-not-exist.json');
  fs.writeFileSync(inFile, JSON.stringify(tampered));
  const { code, output } = runFinalizeCli(inFile, outFile);
  assert.equal(code, 1);
  assert.ok(output.includes('recanonicalize refuses to seal'));
  assert.equal(fs.existsSync(outFile), false);
});

function sortedShape(obj) {
  return Object.keys(obj).sort().map(k => {
    const v = obj[k];
    return [k, Array.isArray(v) ? 'array' : typeof v];
  }).concat([['analysis_gate', 'object']]);
}
