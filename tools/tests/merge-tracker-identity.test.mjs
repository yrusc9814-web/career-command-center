// merge-tracker-identity.test.mjs — merge-tracker 真实子进程沙箱回归
// Run: node --test tools/tests/merge-tracker-identity.test.mjs
//
// 背景（POST_WRITE_VERIFY_FAILED 根因修复回归）：
//   1. parseAppLine 此前不认识 12 列布局（独立 Job ID 列），把 Job ID 当 Score、
//      Score 当 Status → job_id dedup 失效 → 同公司不同岗位被 fuzzy 误判 duplicate →
//      score 比较拒绝更新 → dashboard 写回 POST_WRITE_VERIFY_FAILED。
//   2. job_id 含 '-'（如 d369c8847c8dd30c03B-3dS8EFVS）此前提取失败。
//   3. job identity 合同：job_id 精确优先；fuzzy title 不得参与身份判定；
//      同公司不同 job_id = 不同岗位，禁止互相覆盖。
//
// 测试方式：把 merge-tracker.mjs + tracker-backend.mjs 复制到临时沙箱
// （CAREER_OPS 由脚本自身位置推导），spawn 真实子进程执行，断言 applications.md 结果。
// 不触碰仓库真实 data/。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-identity-'));

// ── 搭建沙箱：tools/ 脚本 + data/applications.md + batch/tracker-additions/ ──
fs.mkdirSync(path.join(SANDBOX, 'tools'), { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'data'), { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'batch', 'tracker-additions'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tools', 'merge-tracker.mjs'), path.join(SANDBOX, 'tools', 'merge-tracker.mjs'));
fs.copyFileSync(path.join(ROOT, 'tools', 'tracker-backend.mjs'), path.join(SANDBOX, 'tools', 'tracker-backend.mjs'));

const APPS = path.join(SANDBOX, 'data', 'applications.md');
const ADDITIONS = path.join(SANDBOX, 'batch', 'tracker-additions');

// 现行 12 列布局（独立 Job ID 列）：#10 与 TSV 是同公司不同岗位（不同 job_id）
const TWELVE_COL_TRACKER = `# Applications Tracker

| # | Date | Company | Role | Job ID | Score | Status | PDF | URL | Report | Notes | Closed At |
|---|------|---------|------|--------|-------|--------|-----|-----|--------|-------|-----------|
| 10 | 2026-08-31 | 士兰公司（某化合物半导体有限公司） | 采购专员 | 888985898424bdd80nJ82di1E1ZS | 48.5/100 | SKIP | ❌ |  | - | via dashboard status change | 2026-08-31 |
| 11 | 2026-09-01 | 橘右鲸公司（某网络科技有限公司） | 跨境电商采购主管 | 9bfb2d60aec758970nF-3ti7EVdZ | 61.2/100 | Applied | ❌ |  | - | via dashboard status change |  |
`;

function writeApps(text) { fs.writeFileSync(APPS, text, 'utf8'); }
function writeTsv(name, line) {
  fs.writeFileSync(path.join(ADDITIONS, name), line + '\n', 'utf8');
}
function runMerge() {
  const res = spawnSync(process.execPath, [path.join(SANDBOX, 'tools', 'merge-tracker.mjs')], {
    cwd: SANDBOX, encoding: 'utf8', timeout: 30000,
  });
  return { code: res.status, out: (res.stdout || '') + (res.stderr || '') };
}
function trackerRows() {
  return fs.readFileSync(APPS, 'utf8').split('\n').filter(l => /^\| \d+ /.test(l));
}
function clearAdditions() {
  for (const f of fs.readdirSync(ADDITIONS)) {
    const p = path.join(ADDITIONS, f);
    if (fs.statSync(p).isFile()) fs.unlinkSync(p);
  }
  const merged = path.join(ADDITIONS, 'merged');
  if (fs.existsSync(merged)) {
    for (const f of fs.readdirSync(merged)) fs.unlinkSync(path.join(merged, f));
    fs.rmdirSync(merged);
  }
}

after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('MT1 12 列布局 + 同公司不同 job_id 不同岗位：新增行，不误判 duplicate（POST_WRITE_VERIFY_FAILED 根因）', () => {
  writeApps(TWELVE_COL_TRACKER);
  clearAdditions();
  writeTsv('dashboard-04d8c6ed.tsv',
    '12\t2026-09-17\t士兰公司（某化合物半导体有限公司）\t采购\t04d8c6ed4d8a65720nB60t66FFZT\tApplied\t54.27/100\t❌\t-\tvia dashboard status change');
  const r = runMerge();
  assert.equal(r.code, 0, r.out);
  const rows = trackerRows();
  const newRow = rows.find(l => l.includes('04d8c6ed4d8a65720nB60t66FFZT'));
  assert.ok(newRow, '新岗位必须以独立行进入 tracker：' + r.out);
  assert.ok(newRow.includes('| Applied |'), '新行携带写入状态');
  const row10 = rows.find(l => /^\| 10 /.test(l));
  assert.ok(row10.includes('| SKIP |') && row10.includes('48.5/100'), '#10（采购专员）完全不被覆盖');
  assert.equal(rows.filter(l => l.includes('士兰公司')).length, 2, '同公司两行共存');
});

test('MT2 12 列布局 + 相同 job_id 再次合并：状态同步，不看 score 大小', () => {
  writeApps(TWELVE_COL_TRACKER);
  clearAdditions();
  // 相同 job_id、低分重写：必须走 job_id 状态同步，而不是被 score 比较挡掉
  writeTsv('dashboard-resync.tsv',
    '10\t2026-09-17\t士兰公司（某化合物半导体有限公司）\t采购专员\t888985898424bdd80nJ82di1E1ZS\tInterview\t48.5/100\t❌\t-\tvia dashboard status change');
  const r = runMerge();
  assert.equal(r.code, 0, r.out);
  const row = trackerRows().find(l => l.includes('888985898424bdd80nJ82di1E1ZS'));
  assert.ok(row, '行仍存在');
  assert.ok(row.includes('| Interview |'), `状态同步为 Interview：${row}`);
  assert.ok(row.includes('| 48.5/100 |'), 'Score 列不被改写');
  assert.equal(trackerRows().length, 2, '不产生 duplicate');
});

test('MT3 含连字符的 job_id（d369c…-… 形态）：正确提取并按身份同步', () => {
  writeApps(TWELVE_COL_TRACKER);
  clearAdditions();
  writeTsv('dashboard-dash-id.tsv',
    '11\t2026-09-17\t橘右鲸公司（某网络科技有限公司）\t跨境电商采购主管\t9bfb2d60aec758970nF-3ti7EVdZ\tResponded\t61.2/100\t❌\t-\tvia dashboard status change');
  const r = runMerge();
  assert.equal(r.code, 0, r.out);
  const row = trackerRows().find(l => l.includes('9bfb2d60aec758970nF-3ti7EVdZ'));
  assert.ok(row, 'dash job_id 行存在');
  assert.ok(row.includes('| Responded |'), `状态同步为 Responded：${row}`);
  assert.equal(trackerRows().length, 2, '不产生 duplicate');
});

test('MT4 同公司同 role 模糊但不精确（采购专员 vs 高级采购专员）不同 job_id：各成一行', () => {
  writeApps(TWELVE_COL_TRACKER);
  clearAdditions();
  writeTsv('dashboard-fuzzy-role.tsv',
    '12\t2026-09-17\t士兰公司（某化合物半导体有限公司）\t高级采购专员\taaaa1111bbbb2222cccc3333dddd4444\tEvaluated\t70/100\t❌\t-\tvia dashboard status change');
  const r = runMerge();
  assert.equal(r.code, 0, r.out);
  const rows = trackerRows();
  assert.ok(rows.some(l => l.includes('aaaa1111bbbb2222cccc3333dddd4444')), '不同岗位独立成行');
  const row10 = rows.find(l => /^\| 10 /.test(l));
  assert.ok(row10.includes('| SKIP |'), '#10 不被模糊命中覆盖');
});

test('MT5 legacy 11 列行（无 Job ID 列）+ eval TSV 回归：report num 同公司命中仍可高分覆盖', () => {
  writeApps(`# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | URL | Report | Notes | Closed At |
|---|------|---------|------|-------|--------|-----|-----|--------|-------|-----------|
| 3 | 2026-08-27 | 老公司（某贸易有限公司） | 采购专员 | 59.75/100 | Evaluated | ❌ |  | [004](reports/003-lincheng-2026-08-27.md) | n |  |
`);
  clearAdditions();
  writeTsv('003-legacy-eval.tsv',
    '4\t2026-09-17\t老公司（某贸易有限公司）\t采购专员\tEvaluated\t71.5/100\t✅\t[004](reports/003-lincheng-2026-08-27.md)\tre-score');
  const r = runMerge();
  assert.equal(r.code, 0, r.out);
  const row = trackerRows().find(l => /^\| 3 /.test(l));
  assert.ok(row, '原行保留');
  assert.ok(row.includes('| 71.5/100 |'), `高分覆盖生效：${row}`);
  assert.ok(row.includes('| Evaluated |'), '原状态保留（TSV 状态不覆盖人工状态）');
  assert.equal(trackerRows().length, 1, '不产生 duplicate');
});
