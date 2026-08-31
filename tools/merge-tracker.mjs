#!/usr/bin/env node
/**
 * merge-tracker.mjs — Merge batch tracker additions into applications.md
 *
 * Handles multiple TSV formats:
 * - 9-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes
 * - 8-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport (no notes)
 * - Pipe-delimited (markdown table row): | col | col | ... |
 *
 * Dedup: company normalized + role fuzzy match + report number match
 * If duplicate with higher score → update in-place, update report link
 * Validates status against states.yml (rejects non-canonical, logs warning)
 *
 * Run: node tools/merge-tracker.mjs [--dry-run] [--verify]   (or: npm run merge)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readProfileTracker, normalizeCompany, roleFuzzyMatch } from './tracker-backend.mjs';

// fileURLToPath handles spaces in path correctly (vs .pathname which encodes them as %20)
// Script lives in tools/; project root is one level up.
const CAREER_OPS = join(dirname(fileURLToPath(import.meta.url)), '..');
// Support both layouts: data/applications.md (boilerplate) and applications.md (original)
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
const ADDITIONS_DIR = join(CAREER_OPS, 'batch/tracker-additions');
const MERGED_DIR = join(ADDITIONS_DIR, 'merged');
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

// Tracker backend: md | bitable (from config/profile.yml)
const TRACKER_CFG = readProfileTracker();
const BACKEND = TRACKER_CFG.backend || 'md';

// Canonical states (must match templates/states.yml — English labels)
const CANONICAL_STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];

function validateStatus(status) {
  const clean = status.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();

  for (const valid of CANONICAL_STATES) {
    if (valid.toLowerCase() === lower) return valid;
  }

  // Aliases — Chinese + common English synonyms
  const aliases = {
    'condicional': 'Evaluated', 'hold': 'Evaluated',
    'sent': 'Applied',
    'monitor': 'SKIP',
    'geo blocker': 'SKIP',
    // Chinese aliases (matching templates/states.yml)
    '已评估': 'Evaluated', '评估完成': 'Evaluated', '待决定': 'Evaluated',
    '已申请': 'Applied', '已投递': 'Applied', '已投': 'Applied', '投递': 'Applied',
    '已回复': 'Responded', '有回应': 'Responded', 'hr已联系': 'Responded',
    '面试中': 'Interview', '面试': 'Interview', '一面': 'Interview', '二面': 'Interview', '三面': 'Interview',
    '拿到offer': 'Offer', '已offer': 'Offer',
    '被拒': 'Rejected', '拒了': 'Rejected', '已拒': 'Rejected', '拒信': 'Rejected',
    '自己放弃': 'Discarded', '已放弃': 'Discarded', '撤回': 'Discarded', '关闭': 'Discarded',
    '不投': 'SKIP', '跳过': 'SKIP',
  };

  if (aliases[lower]) return aliases[lower];

  // Duplicate/Repost → Discarded
  if (/^(dup|repost)/i.test(lower)) return 'Discarded';

  console.warn(`⚠️  Non-canonical status "${status}" → defaulting to "Evaluated"`);
  return 'Evaluated';
}

// normalizeCompany + roleFuzzyMatch imported from tracker-backend.mjs
// (single source of truth; local copies removed — they had the CN-strip bug).

function extractReportNum(reportStr) {
  const m = reportStr.match(/\[(\d+)\]/);
  return m ? parseInt(m[1]) : null;
}

function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function parseAppLine(line) {
  const parts = line.split('|').map(s => s.trim());
  // parts.length = cells + 2 (leading + trailing empties from `|...|`).
  //   9-col legacy layout  → parts.length === 11
  //   11-col extended      → parts.length === 13
  const cellCount = parts.length - 2;
  if (cellCount < 9) return null;
  const num = parseInt(parts[1]);
  if (isNaN(num) || num === 0) return null;
  // 11-col layout (2026-04-20): | # | Date | Company | Role | Score | Status | PDF | URL | Report | Notes | Closed At |
  // 9-col legacy layout:         | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
  const hasExtended = cellCount >= 11;
  const row = {
    num,
    date: parts[2],
    company: parts[3],
    role: parts[4],
    score: parts[5],
    status: parts[6],
    pdf: parts[7],
    url: hasExtended ? parts[8] : '',
    report: hasExtended ? parts[9] : parts[8],
    notes: hasExtended ? (parts[10] || '') : (parts[9] || ''),
    closedAt: hasExtended ? (parts[11] || '') : '',
    raw: line,
  };
  // job_id 提取：Boss 岗位 ID 形态（16-32 位字母数字混合、非 URL）作为独立单元格存在于行内
  for (let i = 1; i < parts.length - 1; i++) {
    const c = parts[i];
    if (c && !/^https?:/.test(c) && /^[0-9A-Za-z]{16,32}$/.test(c) && /[0-9]/.test(c) && /[A-Za-z]/.test(c) && c !== row.company && c !== row.role) {
      row.job_id = c;
      break;
    }
  }
  return row;
}

/**
 * Parse a TSV file content into a structured addition object.
 * Handles: 9-col TSV, 8-col TSV, pipe-delimited markdown.
 */
/**
 * Extract URL from a report file's `**URL：**` or `**URL:**` header line.
 * Accepts report field like `[147](reports/147-foo.md)` or just `reports/147-foo.md`.
 * Returns first non-empty URL found, or '' if no file / no URL line.
 */
function extractUrlFromReport(reportField) {
  if (!reportField) return '';
  // Match `[NNN](reports/...)` or raw path; grab the path
  let path = '';
  const m = reportField.match(/\(([^)]+\.md)\)/) || reportField.match(/(reports\/[^\s\]]+\.md)/);
  if (m) path = m[1];
  if (!path) return '';
  const full = path.startsWith('/') ? path : join(CAREER_OPS, path);
  if (!existsSync(full)) return '';
  try {
    const text = readFileSync(full, 'utf-8');
    // Support both Chinese full-width colon `：` and ASCII `:`
    const urlMatch = text.match(/\*\*URL[：:]\*\*\s*(\S+)/);
    if (urlMatch) {
      const u = urlMatch[1].trim();
      // Skip placeholders like "pending", "—", "TBD"
      if (/^https?:\/\//.test(u)) return u;
    }
  } catch {}
  return '';
}

function parseTsvContent(content, filename) {
  content = content.trim();
  if (!content) return null;

  let parts;
  let addition;

  // Detect pipe-delimited (markdown table row)
  if (content.startsWith('|')) {
    parts = content.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed pipe-delimited ${filename}: ${parts.length} fields`);
      return null;
    }
    // Format: num | date | company | role | score | status | pdf | report | notes
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      score: parts[4],
      status: validateStatus(parts[5]),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
      job_id: '',
    };
  } else {
    // Tab-separated
    parts = content.split('\t');
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed TSV ${filename}: ${parts.length} fields`);
      return null;
    }

    // Detect column order: some TSVs have (status, score), others have (score, status)
    // Heuristic: if col4 looks like a score and col5 looks like a status, they're swapped
    const col4 = parts[4].trim();
    const col5 = parts[5].trim();
    const col4LooksLikeScore = /^\d+\.?\d*\/5$/.test(col4) || col4 === 'N/A' || col4 === 'DUP';
    const col5LooksLikeScore = /^\d+\.?\d*\/5$/.test(col5) || col5 === 'N/A' || col5 === 'DUP';
    const col4LooksLikeStatus = /^(evaluated|applied|responded|interview|offer|rejected|discarded|skip|dup|repost|condicional|hold|monitor)/i.test(col4);
    const col5LooksLikeStatus = /^(evaluated|applied|responded|interview|offer|rejected|discarded|skip|dup|repost|condicional|hold|monitor)/i.test(col5);

    let statusCol, scoreCol;
    if (col4LooksLikeStatus && !col4LooksLikeScore) {
      // Standard format: col4=status, col5=score
      statusCol = col4; scoreCol = col5;
    } else if (col4LooksLikeScore && col5LooksLikeStatus) {
      // Swapped format: col4=score, col5=status
      statusCol = col5; scoreCol = col4;
    } else if (col5LooksLikeScore && !col4LooksLikeScore) {
      // col5 is definitely score → col4 must be status
      statusCol = col4; scoreCol = col5;
    } else {
      // Default: standard format (status before score)
      statusCol = col4; scoreCol = col5;
    }

    // 10 列新格式：num, date, company, role, job_id, status, score, pdf, report, notes
    // 9 列旧格式：无 job_id（身份走 legacy 匹配）
    const hasJobIdCol = parts.length >= 10;
    const tsvJobId = hasJobIdCol ? (parts[4] || '').trim() : '';
    const statusIdx = hasJobIdCol ? 5 : 4;
    const scoreIdx = hasJobIdCol ? 6 : 5;
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      job_id: tsvJobId,
      status: validateStatus(hasJobIdCol ? parts[5] : statusCol),
      score: hasJobIdCol ? parts[6] : scoreCol,
      pdf: hasJobIdCol ? parts[7] : parts[6],
      report: hasJobIdCol ? parts[8] : parts[7],
      notes: (hasJobIdCol ? parts[9] : parts[8]) || '',
    };
  }

  if (isNaN(addition.num) || addition.num === 0) {
    console.warn(`⚠️  Skipping ${filename}: invalid entry number`);
    return null;
  }

  // Auto-extract URL from report file's `**URL：**` line.
  // TSV schema (9-col) has no URL column; report header carries it canonically.
  if (!addition.url) addition.url = extractUrlFromReport(addition.report);

  // Normalize Report field: `local:inbox/...json` is an internal hint used by
  // Bucket B/C TSVs to carry a URL source. After URL extraction, the Report
  // field should display `—` in the tracker (no actual report written).
  if (typeof addition.report === 'string' && addition.report.startsWith('local:inbox/')) {
    addition.report = '—';
  }

  return addition;
}

// ---- Main ----

// Bitable backend: delegate to Bitable API, then regen applications.md from Bitable state.
if (BACKEND === 'bitable') {
  await mergeBitable();
  process.exit(0);
}

async function mergeBitable() {
  console.log(`📊 Backend: bitable (app_token=${TRACKER_CFG.bitable?.app_token?.slice(0,10)}...)\n`);

  if (!existsSync(ADDITIONS_DIR)) {
    console.log('No tracker-additions directory found.');
    return;
  }

  const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
  if (tsvFiles.length === 0) {
    console.log('✅ No pending additions to merge.');
    return;
  }

  tsvFiles.sort((a, b) => (parseInt(a.replace(/\D/g, '')) || 0) - (parseInt(b.replace(/\D/g, '')) || 0));
  console.log(`📥 Found ${tsvFiles.length} pending TSVs`);

  const mod = await import('./backends/bitable-backend.mjs');
  const backend = mod.create(TRACKER_CFG);

  let added = 0, skipped = 0, errors = 0;

  for (const file of tsvFiles) {
    const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
    const addition = parseTsvContent(content, file);
    if (!addition) { skipped++; continue; }

    if (DRY_RUN) {
      console.log(`  [dry] would add #${addition.num} ${addition.company} — ${addition.role}`);
      continue;
    }

    try {
      const result = await backend.addApplication(addition);
      if (result.inserted) {
        console.log(`➕ Added #${result.num}: ${addition.company} — ${addition.role} (${addition.score})`);
        added++;
      } else {
        console.log(`⏭  Dup (#${result.num}): ${addition.company} — ${addition.role}`);
        skipped++;
      }
    } catch (e) {
      console.error(`❌ ${file}: ${e.message.slice(0, 150)}`);
      errors++;
    }
  }

  // Move processed TSVs
  if (!DRY_RUN && (added + skipped) > 0) {
    if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
    for (const file of tsvFiles) {
      renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
    }
    console.log(`\n✅ Moved ${tsvFiles.length} TSVs to merged/`);
  }

  console.log(`\n📊 Summary: +${added} added, ⏭  ${skipped} skipped, ❌ ${errors} errors`);

  // Regen applications.md snapshot from Bitable
  if (!DRY_RUN && added > 0) {
    console.log('\nRegenerating applications.md from Bitable...');
    const { execSync } = await import('child_process');
    try {
      execSync(`node ${join(CAREER_OPS, 'tools/sync-md-from-bitable.mjs')}`, { stdio: 'inherit' });
    } catch (e) {
      console.warn('⚠️  sync-md-from-bitable failed (Bitable writes succeeded; md snapshot stale).');
    }
  }
}

// ---- md backend (below) ----

// Read applications.md
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to merge into.');
  process.exit(0);
}
const appContent = readFileSync(APPS_FILE, 'utf-8');
const appLines = appContent.split('\n');
const existingApps = [];
let maxNum = 0;

for (const line of appLines) {
  if (line.startsWith('|') && !line.includes('---') && !line.includes('Empresa')) {
    const app = parseAppLine(line);
    if (app) {
      existingApps.push(app);
      if (app.num > maxNum) maxNum = app.num;
    }
  }
}

console.log(`📊 Existing: ${existingApps.length} entries, max #${maxNum}`);

// Read tracker additions
if (!existsSync(ADDITIONS_DIR)) {
  console.log('No tracker-additions directory found.');
  process.exit(0);
}

const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
if (tsvFiles.length === 0) {
  console.log('✅ No pending additions to merge.');
  process.exit(0);
}

// Sort files numerically for deterministic processing
tsvFiles.sort((a, b) => {
  const numA = parseInt(a.replace(/\D/g, '')) || 0;
  const numB = parseInt(b.replace(/\D/g, '')) || 0;
  return numA - numB;
});

console.log(`📥 Found ${tsvFiles.length} pending additions`);

let added = 0;
let updated = 0;
let skipped = 0;
const newLines = [];

for (const file of tsvFiles) {
  const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
  const addition = parseTsvContent(content, file);
  if (!addition) { skipped++; continue; }

  // Check for duplicate by:
  // 1. report number match（仅在 company 归一相同时才视为同一岗位——report num 不是岗位身份，
  //    不同岗位共用编号时禁止跨岗位命中）
  // 2. exact entry num match（同样要求 company 归一相同）
  // 3. company + role fuzzy match（归一化公司 + 岗位模糊匹配）
  // 任一匹配规则命中多行（歧义）→ 拒绝合并该 TSV，不修改任何数据。
  const normAdditionCompany = normalizeCompany(addition.company);
  const byCompany = (app) => normalizeCompany(app.company) === normAdditionCompany;
  const reportNum = extractReportNum(addition.report);
  let duplicate = null;
  let ambiguous = false;

  // 身份优先级 1：job_id 精确（dashboard 写回携带；report num / tracker num / fuzzy 均不得单独决定身份）
  if (addition.job_id) {
    const hits = existingApps.filter(app => (app.job_id || '').trim() === addition.job_id);
    if (hits.length > 1) ambiguous = true;
    else if (hits.length === 1) duplicate = hits[0];
  }

  if (reportNum) {
    const hits = existingApps.filter(app => byCompany(app) && extractReportNum(app.report) === reportNum);
    if (hits.length > 1) ambiguous = true;
    else if (hits.length === 1) duplicate = hits[0];
  }

  if (!duplicate && !ambiguous) {
    const hits = existingApps.filter(app => byCompany(app) && app.num === addition.num);
    if (hits.length > 1) ambiguous = true;
    else if (hits.length === 1) duplicate = hits[0];
  }

  if (!duplicate && !ambiguous) {
    const hits = existingApps.filter(app => byCompany(app) && roleFuzzyMatch(addition.role, app.role));
    if (hits.length > 1) ambiguous = true;
    else if (hits.length === 1) duplicate = hits[0];
  }

  // 编号与既有岗位冲突但公司不同 → 不是同一岗位，禁止覆盖；换新行号安全追加
  const numTakenByOther = existingApps.find(app => app.num === addition.num && !byCompany(app));

  if (ambiguous) {
    console.warn(`⚠️  AMBIGUOUS_JOB_MATCH: ${addition.company} — ${addition.role} 命中多条 tracker 行，拒绝合并（未修改任何数据）`);
    skipped++;
    continue;
  }

  if (duplicate) {
    const newScore = parseScore(addition.score);
    const oldScore = parseScore(duplicate.score);

    // 同一 job_id 再次合并（dashboard/crawler 重写）：人工状态以最新一次写回为准
    if (addition.job_id && (duplicate.job_id || '') === addition.job_id) {
      const lineIdx = appLines.indexOf(duplicate.raw);
      if (lineIdx >= 0) {
        const cells = duplicate.raw.split('|').map(x => x.trim());
        const statusIdx = cells.findIndex((c, i) => i > 0 && /^(Evaluated|Applied|Responded|Interview|Offer|Rejected|Discarded|SKIP)$/.test(c));
        if (statusIdx > 0) {
          cells[statusIdx] = addition.status;
          appLines[lineIdx] = `| ${cells.slice(1, -1).join(' | ')} |`;
          updated++;
          console.log(`🔁 job_id 更新: #${duplicate.num} ${addition.company} — ${addition.role} → ${addition.status}`);
        }
      }
      skipped++; // 行已在 tracker，仅状态同步
      continue;
    }

    if (newScore > oldScore) {
      console.log(`🔄 Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`);
      const lineIdx = appLines.indexOf(duplicate.raw);
      if (lineIdx >= 0) {
        // Preserve existing URL / Closed At; auto-fill Closed At if transitioning to terminal
        const TERMINAL = new Set(['Rejected', 'Discarded', 'SKIP', 'Offer']);
        const keepClosedAt = duplicate.closedAt || (TERMINAL.has(duplicate.status) ? addition.date : '');
        const dupJobId = (duplicate.job_id || '').trim();
        const dupTail = dupJobId ? ` | ${dupJobId} |` : ' |';
        const updatedLine = `| ${duplicate.num} | ${addition.date} | ${addition.company} | ${addition.role} | ${addition.score} | ${duplicate.status} | ${duplicate.pdf} | ${duplicate.url || ''} | ${addition.report} | Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes} | ${keepClosedAt}${dupTail} |`;
        appLines[lineIdx] = updatedLine;
        updated++;
      }
    } else {
      console.log(`⏭️  Skip: ${addition.company} — ${addition.role} (existing #${duplicate.num} ${oldScore} >= new ${newScore})`);
      skipped++;
    }
  } else {
    // New entry — num taken by a different company → allocate a safe fresh number（绝不覆盖他人）
    const entryNum = numTakenByOther ? ++maxNum : (addition.num > maxNum ? addition.num : ++maxNum);
    if (entryNum > maxNum) maxNum = entryNum;
    if (numTakenByOther) {
      console.log(`⚠️  Num #${addition.num} belongs to another company (安全分配新编号 #${entryNum})`);
    }

    // Auto-set Closed At for new entries that arrive already in a terminal state.
    const TERMINAL = new Set(['Rejected', 'Discarded', 'SKIP', 'Offer']);
    const closedAt = TERMINAL.has(addition.status) ? addition.date : '';
    const url = addition.url || '';
    // 12 列布局：Job ID 在 role 之后（与表头 | # | Date | Company | Role | Job ID | Score | Status | PDF | URL | Report | Notes | Closed At | 一致）
    const newLine = `| ${entryNum} | ${addition.date} | ${addition.company} | ${addition.role} | ${addition.job_id || ''} | ${addition.score} | ${addition.status} | ${addition.pdf} | ${url} | ${addition.report} | ${addition.notes} | ${closedAt} |`;
    newLines.push(newLine);
    added++;
    console.log(`➕ Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score})`);
  }
}

// Insert new lines after the header (line index of first data row)
if (newLines.length > 0) {
  // Find header separator (|---|...) and insert after it
  let insertIdx = -1;
  for (let i = 0; i < appLines.length; i++) {
    if (appLines[i].includes('---') && appLines[i].startsWith('|')) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx >= 0) {
    appLines.splice(insertIdx, 0, ...newLines);
  }
}

// Write back
if (!DRY_RUN) {
  writeFileSync(APPS_FILE, appLines.join('\n'));

  // Move processed files to merged/
  if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
  for (const file of tsvFiles) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`\n✅ Moved ${tsvFiles.length} TSVs to merged/`);
}

console.log(`\n📊 Summary: +${added} added, 🔄${updated} updated, ⏭️${skipped} skipped`);
if (DRY_RUN) console.log('(dry-run — no changes written)');

// Optional verify
if (VERIFY && !DRY_RUN) {
  console.log('\n--- Running verification ---');
  const { execSync } = await import('child_process');
  try {
    execSync(`node ${join(CAREER_OPS, 'tools/verify-pipeline.mjs')}`, { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}
