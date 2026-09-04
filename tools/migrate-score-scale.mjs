#!/usr/bin/env node
// migrate-score-scale.mjs — Career Score 量纲迁移工具（Round 1B 正式版）
//
// 正式迁移契约（Round 1B，2026-09-03）：
//
//   legacy 1-5  ──(x − 1) × 25──▶  true 0-100（score_scale_version: 2）
//
//   Round1 错误 20-100（old × 20，无 version 字段或 version=1）必须先经
//   --from-round1 反推旧值（old = current/20）再按正式映射迁移：
//     true = (current/20 − 1) × 25 = (current − 20) × 1.25
//   仅当原始 1-5 输入不可用时才允许该路径（数学上严格等价）。
//
// 处理三类文件：
//
//   1. data/search-results-*.json 已评分岗位（analysis.score_breakdown 存在）：
//      - 维度输入按映射转换后，经正式引擎 computeScore + computeRecommendation 重算；
//      - recommendation 证据（blockers/eligibility_status/hard_gaps/cv_match_score/
//        hard_redline）原样保留（布尔/枚举/0-100 量纲，本就与新契约一致）；
//      - recommendation_reason / decision_trace 由引擎重新生成；
//      - 迁移前 recommendation 逐岗比对，任何漂移 → 退出码 1（STOP，不写回）。
//
//   2. data/score-inputs-*.json 维度输入：按映射转换 + 写 score_scale_version: 2 标记
//      （rescore-results.mjs 据此守卫，无标记拒绝重算）。
//
//   3. data/applications.md tracker Score 列：`X.X/5` 或 Round1 `XX.X/100` → true 0-100。
//      （/5 按 (x−1)×25；Round1 /100 值按 (x−20)×1.25 反推等价转换，只动 Score 列）
//
// 模式（互斥）：
//   默认       —— 输入视为 legacy 1-5（(x−1)×25）；已带 version:2 的岗位跳过（幂等）；
//   --from-round1 —— 输入视为 Round1 错误 20-100（(x−20)×1.25）；仅 version 缺失/≠2 的处理。
//
// 安全：
//   - 每个被改写文件先备份到 .acceptance-tmp/backup-score-migration-1b/（LOCAL ONLY，gitignored）；
//   - 不改 job_id / 人工状态 / JD / 抓取历史 / eligibility / cv_match_score；
//   - 不做 "score <= 5 就当旧制" 的数值域猜测——量纲只由显式标记或 --from-round1 决定。
//
// Usage:
//   node tools/migrate-score-scale.mjs                 # legacy 1-5 → true 0-100
//   node tools/migrate-score-scale.mjs --from-round1   # Round1 20-100 → true 0-100

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeScore, computeRecommendation, DIMENSIONS } from './lib/scoring.mjs';
import { assertCanonicalAnalysis, isAnalyzed } from '../dashboard-web/lib/analysis-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const FROM_ROUND1 = process.argv.includes('--from-round1');
const BACKUP = path.join(ROOT, '.acceptance-tmp', FROM_ROUND1 ? 'backup-score-migration-1b' : 'backup-score-migration');

// legacy 1-5 → true 0-100：(x − 1) × 25
const affine25 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round((v - 1) * 25 * 100) / 100 : v);
// Round1 错误 20-100 → true 0-100：(current − 20) × 1.25 ≡ ((current/20) − 1) × 25
const fromRound1 = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round((v - 20) * 1.25 * 100) / 100 : v);
const convert = FROM_ROUND1 ? fromRound1 : affine25;

// 引擎模板产出的 reason 段（迁移后由引擎重新生成，不保留旧文本）
const ENGINE_CLAUSE_RE = new RegExp([
  '^决策矩阵：',
  '^eligibility=',
  '^存在资格缺口（',
  '^存在 HARD_GAP：',
  '^存在 HARD_GAP',
  '^硬性资格不满足',
  '^命中硬红线/deal_breakers',
  '^Career Ops Score ',
  '^Career Score ',
  '^有效维度不足',
  '^现任雇主/关联主体岗位',
  '^低于候选人薪资底线',
  '^职级严重倒退',
  '^JD 工作地点与候选人显式地点约束冲突',
  '^JD 明示工作制与候选人声明的不可接受项冲突',
  '^JD 明示常驻出差/外派',
].join('|'));

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2), 'utf8'); }
function backup(file) {
  fs.mkdirSync(BACKUP, { recursive: true });
  const dst = path.join(BACKUP, file);
  if (!fs.existsSync(dst)) fs.copyFileSync(path.join(DATA, file), dst);
}

let migratedJobs = 0, skippedJobs = 0, drifted = [];
let migratedInputs = 0, migratedTrackerRows = 0;
const mode = FROM_ROUND1 ? 'Round1 20-100 → true 0-100（(x−20)×1.25）' : 'legacy 1-5 → true 0-100（(x−1)×25）';
console.log(`迁移模式: ${mode}`);

// ── 1. search-results-*.json ─────────────────────────────────────────────
for (const file of fs.readdirSync(DATA).filter(f => /^search-results-.*\.json$/.test(f)).sort()) {
  const p = path.join(DATA, file);
  let run;
  try { run = readJson(p); } catch (e) { console.warn(`⚠️ 跳过无法解析的 ${file}: ${e.message}`); continue; }
  let touched = 0;
  for (const job of run.jobs || []) {
    const a = job.analysis;
    if (!a || !a.score_breakdown || !Array.isArray(a.score_breakdown.dimensions)) continue;
    if (a.score_scale_version === 2) { skippedJobs++; continue; }

    // 维度输入按映射转换（null 保持 unknown；reason/evidence 原样保留）
    const dimInputs = a.score_breakdown.dimensions
      .filter(d => d && DIMENSIONS.some(x => x.key === d.key))
      .map(d => ({ key: d.key, score: d.score == null ? null : convert(d.score), reason: d.reason, evidence: d.evidence }));

    const scored = computeScore(dimInputs);

    // recommendation 证据镜像 eligibility.decide() 的原始传参
    const blockers = a.blockers || {};
    const recInput = {
      career_ops_score: scored.career_ops_score,
      cv_match_score: a.cv_match_score ?? null,
      hard_redline: a.hard_redline === true,
      deal_breakers_hit: a.deal_breakers_hit === true,
      current_employer_conflict: blockers.current_employer_conflict === true,
      salary_floor_breach: blockers.salary_floor_breach === true,
      severe_level_downgrade: blockers.severe_level_downgrade === true,
      location_blocker: blockers.location_blocker === true,
      work_schedule_blocker: blockers.work_schedule_blocker === true,
      travel_refusal: blockers.travel_refusal === true,
      eligibility_ineligible: a.eligibility_status === 'ineligible',
      has_hard_gap: Array.isArray(a.hard_gaps) && a.hard_gaps.length > 0,
      eligibility_status: a.eligibility_status ?? null,
    };
    const rec = computeRecommendation(recInput);

    // 决策稳定性守卫：量纲迁移不得改变 recommendation
    if (rec.recommendation !== a.recommendation) {
      drifted.push({ file, job_id: job.job_id, before: a.recommendation, after: rec.recommendation });
      continue; // 不写回漂移岗位
    }

    // 旧 reason 的自由评注段（extra_reason，非引擎模板）逐段保留
    const extraParts = String(a.recommendation_reason || '')
      .split('；').map(s => s.trim()).filter(s => s && !ENGINE_CLAUSE_RE.test(s));

    job.analysis = {
      ...a,
      career_ops_score: scored.career_ops_score,
      career_score: scored.career_ops_score,
      score: scored.career_ops_score, // 旧展示字段别名
      score_scale: scored.score_scale,
      score_scale_version: scored.score_scale_version,
      score_confidence: scored.score_confidence,
      score_breakdown: scored.score_breakdown,
      recommendation: rec.recommendation,
      recommendation_reason: [rec.recommendation_reason, ...extraParts].filter(Boolean).join('；'),
      decision_trace: rec.trace,
      score_scale_migration: {
        from: FROM_ROUND1 ? 'round1-20-100' : '1-5',
        to: '0-100',
        version: 2,
        tool: 'tools/migrate-score-scale.mjs',
        at: new Date().toISOString(),
      },
    };
    touched++; migratedJobs++;
  }
  if (touched > 0) {
    // Round 2B writer enforcement：正式写盘前逐岗位过 canonical 断言（未过 → 拒绝整个文件）
    for (const job of run.jobs) {
      if (!isAnalyzed(job.analysis || {})) continue;
      const chk = assertCanonicalAnalysis(job.analysis);
      if (!chk.ok) {
        console.error(`✗ STOP：${file} 的 ${job.job_id} 未通过 canonical analysis 断言：${chk.errors.join(';')}（未写回）`);
        process.exit(1);
      }
    }
    backup(file);
    run.rescored_at = new Date().toISOString();
    run.analysis_basis = {
      ...(run.analysis_basis || {}),
      score_scale: '0-100',
      score_scale_version: 2,
      score_scale_migration: FROM_ROUND1
        ? 'Round 1B (2026-09-03): Round1 20-100 → true 0-100 via tools/migrate-score-scale.mjs ((x−20)×1.25 math-equivalent)'
        : 'Round 1B (2026-09-03): 1-5 → true 0-100 via tools/migrate-score-scale.mjs ((x−1)×25 math-equivalent)',
    };
    writeJson(p, run);
    console.log(`✓ ${file}: 迁移 ${touched} 个岗位`);
  }
}

// ── 2. score-inputs-*.json 维度输入转换 ──────────────────────────────────
for (const file of fs.readdirSync(DATA).filter(f => /^score-inputs-.*\.json$/.test(f)).sort()) {
  const p = path.join(DATA, file);
  let inputs;
  try { inputs = readJson(p); } catch { continue; }
  let touched = 0;
  for (const [jid, entry] of Object.entries(inputs)) {
    if (!entry || entry.score_scale_version === 2) continue;
    if (Array.isArray(entry.dimensions)) {
      entry.dimensions = entry.dimensions.map(d =>
        (d && d.score != null) ? { ...d, score: convert(d.score) } : d);
      entry.score_scale = '0-100';
      entry.score_scale_version = 2;
      touched++; migratedInputs++;
    }
  }
  if (touched > 0) {
    backup(file);
    writeJson(p, inputs);
    console.log(`✓ ${file}: 迁移 ${touched} 个岗位维度输入`);
  }
}

// ── 3. applications.md tracker Score 列 → true 0-100 ─────────────────────
const appsPath = fs.existsSync(path.join(DATA, 'applications.md')) ? path.join(DATA, 'applications.md') : null;
if (appsPath) {
  const lines = fs.readFileSync(appsPath, 'utf8').split('\n');
  let scoreCol = -1;
  const out = lines.map((line) => {
    if (!line.startsWith('|')) return line;
    const cells = line.split('|');
    if (cells.length < 6) return line;
    if (/^\s*#\s*$/.test(cells[1])) {
      scoreCol = cells.findIndex(c => /^\s*Score\s*$/i.test(c));
      return line;
    }
    if (/^\s*-{3,}\s*$/.test(cells[1] || '')) return line; // 表头分隔行
    if (scoreCol > 0 && cells[scoreCol]) {
      // legacy /5：值本身是旧 1-5 → (x−1)×25
      let m = cells[scoreCol].match(/^\s*(?:\*\*)?(\d+(?:\.\d+)?)\/5(?:\*\*)?\s*$/);
      if (m) {
        cells[scoreCol] = ` ${affine25(parseFloat(m[1]))}/100 `;
        migratedTrackerRows++;
        return cells.join('|');
      }
      // Round1 /100（无 version 落盘，按 --from-round1 反推）：(x−20)×1.25
      if (FROM_ROUND1) {
        m = cells[scoreCol].match(/^\s*(?:\*\*)?(\d+(?:\.\d+)?)\/100(?:\*\*)?\s*$/);
        if (m) {
          cells[scoreCol] = ` ${fromRound1(parseFloat(m[1]))}/100 `;
          migratedTrackerRows++;
          return cells.join('|');
        }
      }
    }
    return line;
  });
  if (migratedTrackerRows > 0) {
    backup('applications.md');
    fs.writeFileSync(appsPath, out.join('\n'), 'utf8');
  }
}

// ── 汇总 ────────────────────────────────────────────────────────────────
console.log(`\n岗位 analysis 迁移: ${migratedJobs}（跳过已迁移 ${skippedJobs}）`);
console.log(`score-inputs 维度输入迁移: ${migratedInputs}`);
console.log(`tracker Score 列迁移: ${migratedTrackerRows} 行`);
if (drifted.length > 0) {
  console.error(`\n✗ STOP：${drifted.length} 个岗位 recommendation 在量纲迁移后发生漂移（未写回）：`);
  for (const d of drifted) console.error(`  ${d.file} ${d.job_id}: ${d.before} → ${d.after}`);
  process.exit(1);
}
console.log('✓ Recommendation 分布迁移前后完全一致（0 漂移）');
