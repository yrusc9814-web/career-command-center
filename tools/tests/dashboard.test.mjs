// dashboard.test.mjs — Dashboard 聚合层与状态写回单元测试
// Run: node --test tools/tests/dashboard.test.mjs
import { test, beforeEach } from 'node:test';
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

test('D9 TSV 生成 9 列制表符分隔', () => {
  const line = buildTsvLine({ num: '004', date: '2026-08-27', company: 'X', role: 'Y', status: 'Evaluated', score: '4.0/5', pdf: '❌', report: '[004](reports/004-x.md)', notes: 'n' });
  const cols = line.split('\t');
  assert.equal(cols.length, 9);
  assert.equal(cols[0], '004');
  assert.equal(cols[4], 'Evaluated'); // status BEFORE score
  assert.equal(cols[5], '4.0/5');
});

test('D10 nextReportNum 取最大编号+1', () => {
  assert.equal(nextReportNum(path.join(dir, 'reports')), 2);
});
