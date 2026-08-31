// dashboard.test.mjs — Dashboard 聚合层与状态写回单元测试
// Run: node --test tools/tests/dashboard.test.mjs
//
// 注意：RESULTS 里 job-a 的 score_breakdown 刻意使用旧维度 key（north_star /
// process_speed）与 total_weight 115 —— 这是 Phase 3 维度表切换前的历史 score-inputs
// 形态，用于锁定 aggregator 的向后兼容契约（旧 key 兼容读取、不为兼容保留计算）。
// 新增 fixture 请使用 scoring.mjs SCORING_RUBRIC 的采购十维 key 与 total_weight 100。
import { test, beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseApplications, matchTrackerRow, updateApplicationsStatus,
  buildState, buildTsvLine, makeStatusHandler, normalizeCompany, nextReportNum,
} from '../../dashboard-web/lib/aggregator.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codash-'));
}

const RESULTS = {
  run_at: '2026-08-27T14:00:00+08:00',
  config: { target_titles: ['采购专员'], target_city: ['示例市'], target_districts: ['示例区A', '示例区B'], salary_min_k: 5, salary_max_k: 10 },
  counters: { discovered: 15, opened: 3, collected: 3, skipped: 0, analyzed: 3, failed: 0 },
  jobs: [
    {
      job_id: 'job-a', title: '采购专员', company: '示例公司（示例市示例汽车配件有限公司）',
      salary: '5-8K', salary_min: 5, salary_max: 8, salary_months: null,
      city: '示例市', district: '示例区B', experience: '1-3年', education: '大专',
      description: 'JD-A', benefits: '五险一金', company_industry: '进出口贸易', company_size: '20-99人',
      recruiter_name: '戴群', recruiter_title: '外贸经理', recruiter_active_status: '刚刚活跃',
      job_url: 'https://www.zhipin.com/job_detail/a.html', collected_at: '2026-08-27T13:00:00+08:00',
      notes: null,
      analysis: {
        cv_match_score: 72, career_ops_score: 2.58, rule_score: 5.0,
        score_confidence: { percent: 95.7, level: '高' },
        score_breakdown: {
          total_weight: 115, effective_weight: 110, weighted_sum: 284,
          dimensions: [
            { key: 'north_star', name: '北极星对齐', weight: 25, score: 3, weighted_value: 75, status: 'known', reason: 'r', evidence: 'e' },
            { key: 'process_speed', name: '流程速度', weight: 5, score: null, weighted_value: null, status: 'unknown', reason: '无证据', evidence: null },
          ],
        },
        recommendation: '不推荐', recommendation_reason: '职级严重倒退（Career Ops Score 2.58/5）',
        strengths: ['s1'], gaps: ['g1'], cv_advice: 'adv', interview_focus: 'int', hard_redline: false,
      },
    },
    {
      job_id: 'job-b', title: '采购专员/采购主管', company: '示例供应链公司',
      salary: '7-10K', salary_min: 7, salary_max: 10, salary_months: null,
      city: '示例市', district: '示例区A', experience: '1-3年', education: '大专',
      description: 'JD-B', benefits: '五险', company_industry: '批发/零售', company_size: '100-499人',
      recruiter_name: '黄先生', recruiter_title: 'HR', recruiter_active_status: '刚刚活跃',
      job_url: 'https://www.zhipin.com/job_detail/b.html', collected_at: '2026-08-27T13:10:00+08:00',
      notes: null,
      analysis: {
        cv_match_score: 55, career_ops_score: 2.96, rule_score: 5.0,
        score_confidence: { percent: 82.6, level: '中' }, score_breakdown: null,
        recommendation: '不推荐', recommendation_reason: 'reason-b',
        strengths: [], gaps: [], cv_advice: null, interview_focus: null, hard_redline: false,
      },
    },
  ],
};

const APPS = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-27 | 示例公司 | 采购专员 | 2.58/5 | SKIP | ❌ | [001](reports/001-example-2026-08-27.md) | note1 |
| 2 | 2026-08-27 | 示例供应链公司 | 采购专员/采购主管 | 2.96/5 | SKIP | ❌ | [002](reports/002-example-2026-08-27.md) | note2 |
`;

let dir;
beforeEach(() => {
  dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'search-results-20260827-1400.json'), JSON.stringify(RESULTS));
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), APPS);
  fs.writeFileSync(path.join(dir, 'reports', '001-example-2026-08-27.md'), '# 评估：示例公司');
});

const baseArgs = (d, dash = {}) => ({
  dataDir: path.join(d, 'data'),
  outputDir: path.join(d, 'output'),
  reportsDir: path.join(d, 'reports'),
  inboxDir: path.join(d, 'inbox'),
  profile: { candidate: { full_name: '候选人A', current_title: '采购主管' }, job_search: { target_titles: ['采购专员'] } },
  dashboardState: dash,
});

test('D1 正常聚合：3 项核心指标与 tracker 关联', () => {
  const s = buildState(baseArgs(dir));
  assert.equal(s.jobs.length, 2);
  const a = s.jobs[0];
  assert.equal(a.analysis.cv_match_score, 72);
  assert.equal(a.analysis.career_ops_score, 2.58);
  assert.equal(a.analysis.recommendation, '不推荐');
  assert.equal(a.status, 'SKIP');
  assert.equal(a.status_zh, '不投');
  assert.equal(a.report_file, 'reports/001-example-2026-08-27.md');
  assert.equal(s.stats.avg_cv_match, 63.5);
  assert.equal(s.stats.avg_career_ops_score, 2.8);
});

test('D2 空数据启动不崩（空目录 → 空状态）', () => {
  const empty = tmpDir();
  fs.mkdirSync(path.join(empty, 'data'), { recursive: true });
  fs.mkdirSync(path.join(empty, 'reports'), { recursive: true });
  const s = buildState(baseArgs(empty));
  assert.equal(s.jobs.length, 0);
  assert.equal(s.stats.total, 0);
  assert.equal(s.stats.avg_cv_match, null);
  assert.equal(s.tracker.rows, 0);
  assert.deepEqual(s.states.map(x => x.id).slice(0, 3), ['Evaluated', 'Applied', 'Responded']);
});

test('D3 null 不变 0：无 confidence/breakdown 的岗位保持 null', () => {
  const data = JSON.parse(JSON.stringify(RESULTS));
  data.jobs[1].analysis.score_confidence = null;
  fs.writeFileSync(path.join(dir, 'data', 'search-results-20260827-1400.json'), JSON.stringify(data));
  const s = buildState(baseArgs(dir));
  const b = s.jobs[1];
  assert.equal(b.analysis.score_confidence, null);
  assert.equal(b.analysis.score_breakdown, null);
  assert.equal(b.analysis.career_ops_score, 2.96); // 不因 null 变 0
});

test('D4 shortlist 聚合与 last_viewed', () => {
  const s = buildState(baseArgs(dir, { shortlisted: { 'job-b': true }, last_viewed: 'job-a' }));
  assert.equal(s.jobs[1].shortlisted, true);
  assert.equal(s.jobs[0].shortlisted, false);
  assert.equal(s.last_viewed, 'job-a');
  assert.equal(s.stats.shortlisted, 1);
});

test('D5 tracker 行匹配（公司括号内容归一化 + 角色包含）', () => {
  const rows = parseApplications(APPS);
  assert.equal(rows.length, 2);
  const row = matchTrackerRow(rows, RESULTS.jobs[0]);
  assert.equal(row.status, 'SKIP');
  assert.ok(normalizeCompany('示例公司（示例市示例汽车配件有限公司）').includes(normalizeCompany('示例公司')));
});

test('D6 状态原位写回：只改 Status 列，其他列不动', () => {
  const { text, updated } = updateApplicationsStatus(APPS, { company: RESULTS.jobs[1].company, role: RESULTS.jobs[1].title, status: 'Evaluated' });
  assert.equal(updated, true);
  const rows = parseApplications(text);
  assert.equal(rows[1].status, 'Evaluated');
  assert.equal(rows[1].score, '2.96/5');
  assert.equal(rows[1].company, '示例供应链公司');
  assert.equal(rows[0].status, 'SKIP'); // 另一行不受影响
  assert.ok(text.includes('| 2 | 2026-08-27 |'));
});

test('D7 状态写回 handler：已有行原位更新', () => {
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const job = JSON.parse(JSON.stringify(RESULTS.jobs[0]));
  job.report_file = 'reports/001-example-2026-08-27.md';
  const r = apply({ job, status: 'Evaluated' });
  assert.equal(r.ok, true);
  assert.equal(r.how, 'updated-in-place');
  const rows = parseApplications(fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8'));
  assert.equal(rows[0].status, 'Evaluated');
});

test('D8 非法状态被拒绝', () => {
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const r = apply({ job: RESULTS.jobs[0], status: '想投' });
  assert.equal(r.ok, false);
  assert.match(r.error, /非法状态/);
});

test('D9 TSV 生成 10 列制表符分隔（Job ID 在 role 后）', () => {
  const line = buildTsvLine({ num: '004', date: '2026-08-27', company: 'X', role: 'Y', job_id: 'JOB123', status: 'Evaluated', score: '4.0/5', pdf: '❌', report: '-', notes: 'n' });
  const cols = line.split('\t');
  assert.equal(cols.length, 10);
  assert.equal(cols[0], '004');
  assert.equal(cols[3], 'Y');
  assert.equal(cols[4], 'JOB123'); // Job ID 紧随 role
  assert.equal(cols[5], 'Evaluated'); // status BEFORE score
  assert.equal(cols[6], '4.0/5');
  // 旧 9 列调用兼容：不传 job_id → 空位落格
  const legacy = buildTsvLine({ num: '001', date: 'd', company: 'X', role: 'Y', status: 'SKIP', score: '1/5', pdf: '❌', report: '-', notes: 'n' });
  assert.equal(legacy.split('\t').length, 10);
  assert.equal(legacy.split('\t')[4], '');
});

test('D10 nextReportNum 取最大编号+1', () => {
  assert.equal(nextReportNum(path.join(dir, 'reports')), 2);
});

// ---------------------------------------------------------------------------
// SW 系列数据完整性测试（DASHBOARD_STATUS_WRITE_AND_SYNC_FIX，用户裁决 2026-08-31）
// 核心：岗位身份 = normalizeCompany(company) + role 模糊匹配（matchTrackerRow SoT）；
// report num / tracker 行号都不是岗位身份。写回必须命中唯一行，歧义拒绝，冲突不覆盖。
// ---------------------------------------------------------------------------

test('SW1 同 report num 不同岗位：更新 B 时 A 完全不变（P0 事故回归）', () => {
  const apps = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 4 | 2026-08-31 | 岗位A公司（甲乙丙丁贸易有限公司） | 采购专员 | 3.39/5 | Evaluated | ❌ | [004](reports/003-lincheng-2026-08-27.md) | via dashboard status change |
| 5 | 2026-08-31 | 岗位B公司（某集团有限公司） | 外协采购主管 | 3.76/5 | SKIP | ❌ | [004](reports/003-lincheng-2026-08-27.md) | via dashboard status change |
`;
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), apps, 'utf8');
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const jobB = { job_id: 'B', title: '外协采购主管', company: '岗位B公司（某集团有限公司）', analysis: {} };
  const r = apply({ job: jobB, status: 'Applied' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.how, 'updated-in-place');
  const rows = parseApplications(fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8'));
  const a = rows.find(x => x.company.includes('岗位A公司'));
  const b = rows.find(x => x.company.includes('岗位B公司'));
  assert.equal(a.status, 'Evaluated', '岗位 A 必须完全不变');
  assert.equal(a.company.includes('岗位A公司'), true, '岗位 A 公司字段不被覆盖');
  assert.equal(a.score, '3.39/5', '岗位 A 分数不被覆盖');
  assert.equal(b.status, 'Applied', '岗位 B 正确更新');
  // 写后验证已在 handler 内断言（POST_WRITE_VERIFY_FAILED 会走 ok:false）
});

test('SW2 新岗位写入 TSV 时 num = tracker maxNum+1 且 report 字段为 "-"（不伪造编号）', () => {
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const jobNew = { job_id: 'new-1', title: '采购工程师', company: '全新公司（全新贸易有限公司）', analysis: { career_ops_score: 3.4 } };
  apply({ job: jobNew, status: 'Evaluated' });
  const tsvDir = path.join(dir, 'batch/tracker-additions');
  const tsvFile = fs.readdirSync(tsvDir).find(f => f.startsWith('dashboard-new-1'));
  assert.ok(tsvFile, 'TSV 已生成');
  const cols = fs.readFileSync(path.join(tsvDir, tsvFile), 'utf8').trim().split('\t');
  assert.equal(cols.length, 10, 'TSV 10 列（含 Job ID）');
  assert.equal(cols[0], '003', 'num = 现有 maxNum(2)+1，不是报告编号');
  assert.equal(cols[4], 'new-1', 'Job ID 列携带岗位身份');
  assert.equal(cols[8], '-', 'report 字段为 "-"，不再携带 [num] 防止跨岗位误匹配');
});

test('SW3 身份匹配唯一：只更新目标 company/title 行', () => {
  const apps = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-27 | 目标公司（某某机械有限公司） | 采购专员 | 2.58/5 | SKIP | ❌ | [001](reports/001-x.md) | n1 |
| 2 | 2026-08-27 | 另一家公司（其他贸易有限公司） | 采购工程师 | 2.96/5 | SKIP | ❌ | [002](reports/002-x.md) | n2 |
`;
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), apps, 'utf8');
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const r = apply({ job: { job_id: 't', title: '采购专员', company: '目标公司（某某机械有限公司）', analysis: {} }, status: 'Evaluated' });
  assert.equal(r.ok, true);
  const rows = parseApplications(fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8'));
  assert.equal(rows[0].status, 'Evaluated');
  assert.equal(rows[1].status, 'SKIP', '另一行不动');
});

test('SW4 匹配歧义：命中多行必须拒绝且不修改任何数据', () => {
  const apps = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-27 | 同名公司 | 采购专员 | 2.58/5 | SKIP | ❌ | - | n1 |
| 2 | 2026-08-27 | 同名公司 | 采购专员 | 2.96/5 | Applied | ❌ | - | n2 |
`;
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), apps, 'utf8');
  const before = fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8');
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const r = apply({ job: { job_id: 'amb', title: '采购专员', company: '同名公司', analysis: {} }, status: 'Evaluated' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'AMBIGUOUS_JOB_MATCH');
  assert.equal(fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8'), before, '数据零修改');
});

test('SW5 写入失败：merge 抛错上抛 / merge 静默未写入 → ok:false（前端据此回滚，不假成功）', () => {
  // a) merge 命令抛错 → 向上传播（server 500 → 前端 catch 回滚）
  const applyBoom = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => { throw new Error('merge exploded'); } });
  assert.throws(
    () => applyBoom({ job: { job_id: 'y', title: '采购专员', company: '缺席公司2', analysis: {} }, status: 'Applied' }),
    /merge exploded/
  );
  // b) merge 静默失败（返回 ok 但 tracker 里根本没有该岗位）→ 写后验证拦截
  const applySilent = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const r = applySilent({ job: { job_id: 'x', title: '采购专员', company: '缺席公司', analysis: {} }, status: 'Evaluated' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'POST_WRITE_VERIFY_FAILED');
});

test('SW6 成功写回后重新聚合：job.status 为最新值（前端 refresh 链路的数据基础）', () => {
  fs.writeFileSync(path.join(dir, 'data', 'search-results-20260831-1400.json'), JSON.stringify(RESULTS));
  // RESULTS.jobs[0] 本身就是 job-a（见 fixture），无需改 id
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const r = apply({ job: { job_id: 'job-a', title: RESULTS.jobs[0].title, company: RESULTS.jobs[0].company, analysis: {} }, status: 'Evaluated' });
  assert.equal(r.ok, true);
  const st = buildState(baseArgs(dir));
  assert.equal(st.jobs.find(j => j.job_id === 'job-a').status, 'Evaluated');
});

// UI1-UI7：计数派生（单一 SoT = 最新 d.jobs；renderNav/renderList 每次 refresh 全量重算）
test('UI1-UI3 计数从 jobs 派生：pending/Applied/Evaluated 任意切换语义', () => {
  const counts = (jobs) => ({
    all: jobs.length,
    pending: jobs.filter(j => !j.status).length,
    Applied: jobs.filter(j => j.status === 'Applied').length,
    Evaluated: jobs.filter(j => j.status === 'Evaluated').length,
  });
  // UI1 pending → Applied：待处理 -1，已投递 +1，全部不变
  const base = [{ status: null }, { status: null }, { status: 'Applied' }, { status: 'Evaluated' }];
  const c1 = counts(base);
  assert.deepEqual(c1, { all: 4, pending: 2, Applied: 1, Evaluated: 1 });
  const after1 = [{ status: 'Applied' }, { status: null }, { status: 'Applied' }, { status: 'Evaluated' }];
  const c2 = counts(after1);
  assert.equal(c2.pending, 1); assert.equal(c2.Applied, 2); assert.equal(c2.all, 4);
  // UI3 Applied → Evaluated：已投递 -1，待决策 +1，pending 不变
  const after3 = [{ status: 'Evaluated' }, { status: null }, { status: 'Applied' }, { status: 'Evaluated' }];
  const c3 = counts(after3);
  assert.equal(c3.Applied, 1); assert.equal(c3.Evaluated, 2); assert.equal(c3.pending, 1); assert.equal(c3.all, 4);
});

test('UI4-UI5 当前页面同步语义（app.js 内容守卫）：pending 页过滤分支与 isList 白名单', () => {
  const app = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard-web', 'app.js'), 'utf8');
  // pending 页 = status null 过滤（卡片即时出列）；all 页无 status 过滤（卡片保留）
  assert.ok(app.includes("state.page === 'pending'"), 'pending 页过滤分支存在');
  assert.ok(app.includes("jobs = jobs.filter(j => !j.status)"), 'pending = 无人工状态');
  assert.ok(app.includes("['all', 'pending', 'shortlist', 'closed'"), 'isList 白名单含 pending');
  assert.ok(!/state\.page === 'pending'.*\n.*filter\(j => j\.status\)/.test(app), 'all 页不得按 status 过滤');
});

test('UI6-UI7 计数无独立缓存：app.js 不存在 sidebarCounts/pendingCount 等可变计数变量', () => {
  const app = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard-web', 'app.js'), 'utf8');
  assert.ok(!/const sidebarCounts|let pendingCount|let appliedCount/.test(app), '禁止独立计数缓存');
  assert.ok(app.includes("$('#cnt-pending').textContent = counts.pending;"), '计数全部由 renderNav 从 counts 派生');
  assert.ok(/statusMutating/.test(app), 'per-job 写回锁存在');
  assert.ok(app.includes('await refresh(); // 全量重派生所有计数与列表'), '写回成功后全量 refresh');
});

// ---------------------------------------------------------------------------
// ID/ST 系列：岗位身份模型（DASHBOARD_JOB_IDENTITY_FINAL_FIX）
// 身份 SoT = findTrackerRows：job_id → URL(job_detail/<id>) → 公司归一+role 精确相等。
// 禁止 fuzzy role / 子串参与人工状态身份；同公司不同 JD 各自成行互不影响。
// ---------------------------------------------------------------------------

import { findTrackerRows } from '../../dashboard-web/lib/aggregator.mjs';

const mkJob = (id, company, title, url) => ({ job_id: id, company, title, job_url: url || `https://www.zhipin.com/job_detail/${id}.html` });
const mkRow = (num, company, role, extra = {}) => ({
  '#': String(num), company, role, status: extra.status || null,
  job_id: extra.job_id || '', url: extra.url || '', score: extra.score || '', __line: `| ${num} | x | ${company} | ${role} |`,
});

test('ID1-ID2 同公司不同岗位（采购/采购专员/采购主管）identity 互不命中', () => {
  const rows = [mkRow(1, '测试科技', '采购'), mkRow(2, '测试科技', '采购专员'), mkRow(3, '测试科技', '采购主管')];
  assert.equal(findTrackerRows(rows, mkJob('x1', '测试科技', '采购')).length, 1);
  assert.equal(findTrackerRows(rows, mkJob('x2', '测试科技', '采购专员')).length, 1);
  assert.equal(findTrackerRows(rows, mkJob('x3', '测试科技', '采购主管')).length, 1);
  // 「采购」的 legacy 规则不得命中「采购专员」行（role 精确相等）
  const hits = findTrackerRows(rows, mkJob('x1', '测试科技', '采购'));
  assert.equal(hits[0].role, '采购');
});

test('ID3 同一 job_id 重抓 → identity 相同（跨 run/crawl batch 稳定）', () => {
  const rows = [mkRow(1, 'A公司', '采购专员', { job_id: 'testjob0001aaaaaaaaaaaa' })];
  const j1 = mkJob('testjob0001aaaaaaaaaaaa', 'A公司（全新后缀有限公司）', '采购专员');
  const j2 = mkJob('testjob0001aaaaaaaaaaaa', 'A公司', '采购专员');
  assert.equal(findTrackerRows(rows, j1)[0]['#'], '1');
  assert.equal(findTrackerRows(rows, j2)[0]['#'], '1');
});

test('ID4 同 title 不同 job_id → 不同岗位（0 命中，不共享 tracker 行）', () => {
  const rows = [mkRow(1, 'A公司', '采购专员', { job_id: 'aaaa1111bbbb2222C', url: 'https://www.zhipin.com/job_detail/aaaa1111bbbb2222C.html' })];
  const other = mkJob('dddd4444eeee5555F', 'A公司', '采购专员', 'https://www.zhipin.com/job_detail/dddd4444eeee5555F.html');
  // 层1 job_id 不中；层2 仅扫 legacy 行（有 job_id 的行被排除）→ 不同岗位 0 命中
  assert.equal(findTrackerRows(rows, other).length, 0, '不同 job_id 不得命中他人 tracker 行');
});

test('ID5 有 job_id 的双行：job_id 精确定位各自行', () => {
  const rows = [
    mkRow(1, 'A公司', '采购专员', { job_id: 'jobA' }),
    mkRow(2, 'A公司', '采购专员', { job_id: 'jobB' }),
  ];
  // 同 company+title 两行：jobA 只命中行1，jobB 只命中行2（job_id 优先分支）
  assert.equal(findTrackerRows(rows, mkJob('jobA', 'A公司', '采购专员'))[0].job_id, 'jobA');
  assert.equal(findTrackerRows(rows, mkJob('jobB', 'A公司', '采购专员'))[0].job_id, 'jobB');
});

test('ID5b 无 job_id 双行同 company+title：歧义拒绝（legacy 身份不足，不猜测）', () => {
  const rows = [
    mkRow(1, 'A公司', '采购专员'),
    mkRow(2, 'A公司', '采购专员'),
  ];
  const res = findTrackerRows(rows, mkJob('jobC', 'A公司', '采购专员'));
  // findTrackerRows 返回全部命中行；长度>1 → 调用方必须 AMBIGUOUS（applyStatus 层验证见 ID9）
  assert.equal(res.length, 2);
});

test('ID6 job_id 已在 tracker：applyStatus 只更新对应行', () => {
  const apps = `# Applications Tracker

| # | Date | Company | Role | Job ID | Score | Status | PDF | Report | Notes |
|---|------|---------|------|--------|-------|--------|-----|--------|-------|
| 1 | 2026-08-31 | 测试科技 | 采购专员 | testjob0001aaaaaaaaaaaa | 2.9/5 | Applied | ❌ | - | t |
| 2 | 2026-08-31 | 测试科技 | 采购 | testjob0002bbbbbbbbbbbb | 3.0/5 | SKIP | ❌ | - | t |
`;
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), apps, 'utf8');
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  const r = apply({ job: mkJob('testjob0001aaaaaaaaaaaa', '测试科技（全称有限公司）', '采购专员'), status: 'Evaluated' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = parseApplications(fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8'));
  assert.equal(rows.find(x => x.job_id === 'testjob0001aaaaaaaaaaaa').status, 'Evaluated');
  assert.equal(rows.find(x => x.role === '采购').status, 'SKIP', '同公司另一岗位不受影响');
});

test('ID7 不存在 tracker：新增独立行（同公司另一岗位保持 pending）', () => {
  const apps = `# Applications Tracker

| # | Date | Company | Role | Job ID | Score | Status | PDF | Report | Notes |
|---|------|---------|------|--------|-------|--------|-----|--------|-------|
| 1 | 2026-08-31 | 测试科技 | 采购 | testjob0002bbbbbbbbbbbb | 3.0/5 | Evaluated | ❌ | - | t |
`;
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), apps, 'utf8');
  const appsPath = path.join(dir, 'data', 'applications.md');
  const mergeStub = () => {
    // 模拟 merge-tracker：把待合并 TSV（10 列）追加为 tracker 行（列序与 Job ID 表头一致）
    const tsvDir = path.join(dir, 'batch/tracker-additions');
    for (const f of fs.readdirSync(tsvDir).filter(f => f.endsWith('.tsv'))) {
      const cols = fs.readFileSync(path.join(tsvDir, f), 'utf8').trim().split('\t');
      // TSV: num,date,company,role,job_id,status,score,pdf,report,notes
      // 行:  | # | Date | Company | Role | Job ID | Score | Status | PDF | Report | Notes |
      const line = `| ${parseInt(cols[0])} | ${cols[1]} | ${cols[2]} | ${cols[3]} | ${cols[4]} | ${cols[6]} | ${cols[5]} | ${cols[7]} | ${cols[8]} | ${cols[9]} |`;
      fs.writeFileSync(appsPath, fs.readFileSync(appsPath, 'utf8') + line + '\n', 'utf8');
    }
    return { ok: true };
  };
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: mergeStub });
  const r = apply({ job: mkJob('testjob0001aaaaaaaaaaaa', '测试科技', '采购专员', 'https://www.zhipin.com/job_detail/testjob0001aaaaaaaaaaaa.html'), status: 'Applied' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = parseApplications(fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8'));
  assert.equal(rows.find(x => x.job_id === 'testjob0001aaaaaaaaaaaa').status, 'Applied');
  assert.equal(rows.find(x => x.job_id === 'testjob0002bbbbbbbbbbbb').status, 'Evaluated', '同公司既有岗位不变');
});

test('ID8 legacy 行唯一匹配：URL 层命中（无 Job ID 列的旧行）', () => {
  const apps = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-27 | 示例科技公司 | 采购专员 | 2.58/5 | SKIP | ❌ | https://www.zhipin.com/job_detail/testjob0003cccccccccccc.html | [001](r.md) | n |
`;
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), apps, 'utf8');
  const rows = parseApplications(apps);
  const hits = findTrackerRows(rows, mkJob('testjob0003cccccccccccc', '示例科技公司（某汽车配件有限公司）', '采购专员'));
  assert.equal(hits.length, 1);
});

test('ID9 legacy 行多义：拒绝自动状态广播', () => {
  const apps = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
| 1 | 2026-08-27 | 同名公司 | 采购专员 | 2.58/5 | SKIP | ❌ | - | n1 |
| 2 | 2026-08-27 | 同名公司 | 采购专员 | 2.96/5 | Applied | ❌ | - | n2 |
`;
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), apps, 'utf8');
  const before = fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8');
  const apply = makeStatusHandler({ dataDir: path.join(dir, 'data'), additionsDir: path.join(dir, 'batch/tracker-additions'), mergeCommand: () => ({ ok: true }) });
  // 两行均无 Job ID/URL → legacy 严格层同时命中 2 行 → AMBIGUOUS
  const r = apply({ job: mkJob('zzzz9999yyyy8888X', '同名公司', '采购专员'), status: 'Evaluated' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'AMBIGUOUS_JOB_MATCH');
  assert.equal(fs.readFileSync(path.join(dir, 'data', 'applications.md'), 'utf8'), before, '数据零修改');
});

test('ST1-ST5 同公司多岗位状态独立 + crawler 重抓保持（buildState 聚合级）', () => {
  // tracker：采购=Evaluated、采购专员=Applied（job_id 区分）
  fs.writeFileSync(path.join(dir, 'data', 'applications.md'), `# Applications Tracker

| # | Date | Company | Role | Job ID | Score | Status | PDF | Report | Notes |
|---|------|---------|------|--------|-------|--------|-----|--------|-------|
| 1 | 2026-08-31 | 测试科技 | 采购 | testjob0002bbbbbbbbbbbb | 3.0/5 | Evaluated | ❌ | - | t |
| 2 | 2026-08-31 | 测试科技 | 采购专员 | testjob0001aaaaaaaaaaaa | 2.9/5 | Applied | ❌ | - | t |
`, 'utf8');
  // ST4: crawler 重抓采购专员（新 run 文件，时间变化）
  const rerun = {
    run_at: '2026-08-31T18:00:00+08:00',
    config: { target_titles: ['采购专员'], target_city: ['示例市'], target_districts: [], salary_min_k: 5, salary_max_k: 10 },
    counters: { discovered: 3, opened: 3, collected: 3, skipped: 0, analyzed: 3, failed: 0 },
    jobs: [
      { job_id: 'testjob0002bbbbbbbbbbbb', title: '采购', company: '测试科技', salary: '8-12K', city: '示例市', job_url: 'https://www.zhipin.com/job_detail/testjob0002bbbbbbbbbbbb.html', collected_at: '2026-08-31T18:00:00+08:00', analysis: { cv_match_score: 60, career_ops_score: 3.0, recommendation: '推荐' } },
      { job_id: 'testjob0001aaaaaaaaaaaa', title: '采购专员', company: '测试科技', salary: '8-12K', city: '示例市', job_url: 'https://www.zhipin.com/job_detail/testjob0001aaaaaaaaaaaa.html', collected_at: '2026-08-31T18:00:00+08:00', analysis: { cv_match_score: 60, career_ops_score: 3.0, recommendation: '推荐' } },
      { job_id: 'newcai000000000000000X', title: '采购主管', company: '测试科技', salary: '8-12K', city: '示例市', job_url: 'https://www.zhipin.com/job_detail/newcai000000000000000X.html', collected_at: '2026-08-31T18:00:00+08:00', analysis: { cv_match_score: 60, career_ops_score: 3.0, recommendation: '推荐' } },
    ],
  };
  fs.writeFileSync(path.join(dir, 'data', 'search-results-20260831-1800.json'), JSON.stringify(rerun));
  const st = buildState(baseArgs(dir));
  const byId = Object.fromEntries(st.jobs.map(j => [j.job_id, j]));
  // ST1/ST2: 两岗位状态独立
  assert.equal(byId['testjob0002bbbbbbbbbbbb'].status, 'Evaluated');
  assert.equal(byId['testjob0001aaaaaaaaaaaa'].status, 'Applied');
  // ST3: 重聚合后仍独立（上面即重聚合结果）
  // ST4: crawler 重抓后 Applied 保持
  // ST5: 新抓「采购主管」进入 pending，不继承同公司状态
  assert.equal(byId['newcai000000000000000X'].status, null);
  // 计数锁定：同公司 3 岗 = Evaluated 1 + Applied 1 + pending 1，无重复广播
  const counts = { pending: 0, Evaluated: 0, Applied: 0 };
  for (const j of st.jobs.filter(x => x.company.includes('测试科技'))) {
    if (j.status === null) counts.pending++;
    else counts[j.status]++;
  }
  assert.deepEqual(counts, { pending: 1, Evaluated: 1, Applied: 1 });
});
