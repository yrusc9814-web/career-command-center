#!/usr/bin/env node
/**
 * verify-pipeline.mjs — Health check for career-ops pipeline integrity
 *
 * Checks:
 * 1. All statuses are canonical (per states.yml)
 * 2. No duplicate company+role entries
 * 3. All report links point to existing files
 * 4. Scores match format XX.X/100 (0-100 制，Round 1 迁移后 canonical) or N/A or DUP
 *    （legacy X.XX/5 仍可读，但新写入必须为 /100）
 * 5. All rows have proper pipe-delimited format
 * 6. No pending TSVs in tracker-additions/ (only in merged/ or archived/)
 * 7. states.yml canonical IDs for cross-system consistency
 *
 * Run: node tools/verify-pipeline.mjs    (or: npm run verify)
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// fileURLToPath handles spaces in path correctly (vs .pathname which encodes them as %20)
// Script lives in tools/; project root is one level up.
const CAREER_OPS = join(dirname(fileURLToPath(import.meta.url)), '..');
// Support both layouts: data/applications.md (boilerplate) and applications.md (original)
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const ADDITIONS_DIR = join(CAREER_OPS, 'batch/tracker-additions');
const REPORTS_DIR = join(CAREER_OPS, 'reports');
const STATES_FILE = existsSync(join(CAREER_OPS, 'templates/states.yml'))
  ? join(CAREER_OPS, 'templates/states.yml')
  : join(CAREER_OPS, 'states.yml');

// English canonical (matches templates/states.yml)
const CANONICAL_STATUSES = [
  'evaluated', 'applied', 'responded', 'interview',
  'offer', 'rejected', 'discarded', 'skip',
];

const ALIASES = {
  'sent': 'applied',
  'monitor': 'skip',
  // Chinese (matches templates/states.yml)
  '已评估': 'evaluated', '已申请': 'applied', '已投递': 'applied', '投递': 'applied',
  '已回复': 'responded', '面试中': 'interview', '面试': 'interview',
  '拿到offer': 'offer', '已offer': 'offer',
  '被拒': 'rejected', '已拒': 'rejected', '拒了': 'rejected',
  '自己放弃': 'discarded', '已放弃': 'discarded', '撤回': 'discarded',
  '不投': 'skip', '跳过': 'skip',
};

let errors = 0;
let warnings = 0;

function error(msg) { console.log(`❌ ${msg}`); errors++; }
function warn(msg) { console.log(`⚠️  ${msg}`); warnings++; }
function ok(msg) { console.log(`✅ ${msg}`); }

// --- Read applications.md ---
if (!existsSync(APPS_FILE)) {
  console.log('\n📊 No applications.md found. This is normal for a fresh setup.');
  console.log('   The file will be created when you evaluate your first offer.\n');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

const entries = [];
// 列布局自适应：12 列新布局（含 Job ID，位于 Role 后）与旧 9/11 列 legacy 布局。
// 判定依据：该行 cell 数与表头（若含 Job ID 列则 +1 偏移）。
const headerLine = lines.find(l => l.startsWith('|') && /company/i.test(l) && /role/i.test(l));
const hasJobIdCol = !!headerLine && /job id/i.test(headerLine);
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  if (headerLine && line === headerLine) continue;
  if (/^\|\s*-{2,}/.test(line) || line.includes('---')) continue;
  const parts = line.split('|').map(s => s.trim());
  if (hasJobIdCol) {
    // | # | Date | Company | Role | Job ID | Score | Status | PDF | URL | Report | Notes | Closed At |
    if (parts.length < 9) continue;
    const num = parseInt(parts[1]);
    if (isNaN(num)) continue;
    entries.push({
      num, date: parts[2], company: parts[3], role: parts[4], job_id: parts[5] || '',
      score: parts[6], status: parts[7], pdf: parts[8], report: parts[10] || '',
      notes: parts[11] || '', url: parts[9] || '',
    });
  } else {
    if (parts.length < 9) continue;
    const num = parseInt(parts[1]);
    if (isNaN(num)) continue;
    entries.push({
      num, date: parts[2], company: parts[3], role: parts[4],
      score: parts[5], status: parts[6], pdf: parts[7], report: parts[8],
      notes: parts[9] || '', job_id: '',
    });
  }
}

console.log(`\n📊 Checking ${entries.length} entries in applications.md\n`);

// --- Check 1: Canonical statuses ---
let badStatuses = 0;
for (const e of entries) {
  const clean = e.status.replace(/\*\*/g, '').trim().toLowerCase();
  // Strip trailing dates
  const statusOnly = clean.replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();

  if (!CANONICAL_STATUSES.includes(statusOnly) && !ALIASES[statusOnly]) {
    error(`#${e.num}: Non-canonical status "${e.status}"`);
    badStatuses++;
  }

  // Check for markdown bold in status
  if (e.status.includes('**')) {
    error(`#${e.num}: Status contains markdown bold: "${e.status}"`);
    badStatuses++;
  }

  // Check for dates in status
  if (/\d{4}-\d{2}-\d{2}/.test(e.status)) {
    error(`#${e.num}: Status contains date: "${e.status}" — dates go in date column`);
    badStatuses++;
  }
}
if (badStatuses === 0) ok('All statuses are canonical');

// --- Check 2: Duplicates ---
// key 必须保留中文字符：此前 [^a-z0-9] 会把纯中文公司/岗位剥成空串，
// 导致任意两条中文行 key 相同（"::"）被误报 duplicates。
const companyRoleMap = new Map();
let dupes = 0;
for (const e of entries) {
  const key = e.company.toLowerCase().replace(/\s+/g, '') + '::' +
    e.role.toLowerCase().replace(/\s+/g, '');
  if (!companyRoleMap.has(key)) companyRoleMap.set(key, []);
  companyRoleMap.get(key).push(e);
}
for (const [key, group] of companyRoleMap) {
  if (group.length > 1) {
    warn(`Possible duplicates: ${group.map(e => `#${e.num}`).join(', ')} (${group[0].company} — ${group[0].role})`);
    dupes++;
  }
}
if (dupes === 0) ok('No exact duplicates found');

// --- Check 3: Report links ---
let brokenReports = 0;
for (const e of entries) {
  const match = e.report.match(/\]\(([^)]+)\)/);
  if (!match) continue;
  const reportPath = join(CAREER_OPS, match[1]);
  if (!existsSync(reportPath)) {
    error(`#${e.num}: Report not found: ${match[1]}`);
    brokenReports++;
  }
}
if (brokenReports === 0) ok('All report links valid');

// --- Check 4: Score format（Round 1 起 canonical = 0-100 制 `XX.X/100`；legacy `X.XX/5` 仍可读） ---
let badScores = 0;
for (const e of entries) {
  const s = e.score.replace(/\*\*/g, '').trim();
  if (!/^\d+\.?\d*\/100$/.test(s) && s !== 'N/A' && s !== 'DUP') {
    error(`#${e.num}: Invalid score format: "${e.score}" (expected XX.X/100, N/A or DUP)`);
    badScores++;
  }
}
if (badScores === 0) ok('All scores valid');

// --- Check 5: Row format ---
let badRows = 0;
for (const line of lines) {
  if (!line.startsWith('|')) continue;
  if (line.includes('---') || line.includes('Empresa')) continue;
  const parts = line.split('|');
  if (parts.length < 9) {
    error(`Row with <9 columns: ${line.substring(0, 80)}...`);
    badRows++;
  }
}
if (badRows === 0) ok('All rows properly formatted');

// --- Check 6: Pending TSVs ---
let pendingTsvs = 0;
if (existsSync(ADDITIONS_DIR)) {
  const files = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
  pendingTsvs = files.length;
  if (pendingTsvs > 0) {
    warn(`${pendingTsvs} pending TSVs in tracker-additions/ (not merged)`);
  }
}
if (pendingTsvs === 0) ok('No pending TSVs');

// --- Check 7: Bold in scores ---
let boldScores = 0;
for (const e of entries) {
  if (e.score.includes('**')) {
    warn(`#${e.num}: Score has markdown bold: "${e.score}"`);
    boldScores++;
  }
}
if (boldScores === 0) ok('No bold in scores');

// --- Check 8: Canonical analysis gate（Round 2B PERSISTENCE GATE CONTRACT）---
// 兜底防绕过：任何正式 analysis 落盘路径（无论是否经过 finalize CLI）产出的
// data/search-results-*.json，其全部已分析岗位必须通过 assertCanonicalAnalysis
// （validate complete + schema v2 + analysis_gate 封印）。绕过 Gate 的 raw 写入在这里暴露。
const DATA_DIR = join(CAREER_OPS, 'data');
let gateAnalyzed = 0;
let gateErrors = 0;
try {
  const { assertCanonicalAnalysis, isAnalyzed } = await import('../dashboard-web/lib/analysis-contract.mjs');
  const resultsFiles = readdirSync(DATA_DIR).filter(f => /^search-results-.*\.json$/.test(f)).sort();
  for (const f of resultsFiles) {
    let run;
    try { run = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')); } catch (e) {
      error(`${f}: 无法解析 run 文件（${e.message.slice(0, 80)}）`);
      gateErrors++;
      continue;
    }
    for (const job of run.jobs || []) {
      const a = job?.analysis;
      if (!a || !isAnalyzed(a)) continue;
      gateAnalyzed++;
      const chk = assertCanonicalAnalysis(a);
      if (!chk.ok) {
        error(`${f} ${job.job_id || '(no job_id)'}: canonical analysis gate 未通过 — ${chk.errors.join('; ')}`);
        gateErrors++;
      }
    }
  }
  if (gateErrors === 0) {
    ok(gateAnalyzed > 0
      ? `All ${gateAnalyzed} analyzed jobs pass canonical analysis gate`
      : 'No analyzed jobs found (analysis gate check vacuous)');
  }
} catch (e) {
  error(`Analysis gate check failed to run: ${e.message}`);
  gateErrors++;
}

// --- Summary ---
console.log('\n' + '='.repeat(50));
console.log(`📊 Pipeline Health: ${errors} errors, ${warnings} warnings`);
if (errors === 0 && warnings === 0) {
  console.log('🟢 Pipeline is clean!');
} else if (errors === 0) {
  console.log('🟡 Pipeline OK with warnings');
} else {
  console.log('🔴 Pipeline has errors — fix before proceeding');
}

process.exit(errors > 0 ? 1 : 0);
