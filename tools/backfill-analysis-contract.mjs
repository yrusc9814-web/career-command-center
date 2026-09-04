#!/usr/bin/env node
// backfill-analysis-contract.mjs — Round 2B 历史岗位 canonical 化 + gate metadata 增量回填（LOCAL ONLY）
//
// 目标：把 data/search-results-*.json 中全部已分析岗位过唯一 Persistence Gate
// （dashboard-web/lib/analysis-contract.mjs finalizeAnalysisForPersistence，strict=false
// = 既有对象刷新路径：narrative 与 engine 既有值全部保留，不重算、不派生第二来源），
// 写入 analysis_gate { schema_status, content_status, ... } 最小增量 metadata。
//
// 行为（严格范围，spec §16/§17）：
//   1. normalize（alias/类型/缺失 section 补 canonical 空值）——唯一合同实现，不在本工具重拼；
//   2. metadata：analysis_schema_version: 2 + analysis_gate{schema_status, content_status,
//      content_substantive, repaired, repaired_actions, source, gated_at}；
//      Round 2 的 analysis_completeness 同步为兼容值（status: 'complete'）；
//   3. 全量零漂移：cv_match_score / career_ops_score / dimensions / confidence /
//      recommendation / eligibility_status / blockers / job_id / title / description（JD）
//      / applications.md（人工状态）——逐 job_id 校验，任何漂移 → 退出码 1 且不写回。
//
// 用法：node tools/backfill-analysis-contract.mjs [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  finalizeAnalysisForPersistence,
} from '../dashboard-web/lib/analysis-contract.mjs';
import { writeRunFile } from './lib/analysis-persistence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');
const BACKUP = path.join(ROOT, '.acceptance-tmp', 'backup-analysis-contract');

function backup(file) {
  fs.mkdirSync(BACKUP, { recursive: true });
  const dst = path.join(BACKUP, file);
  if (!fs.existsSync(dst)) fs.copyFileSync(path.join(DATA, file), dst);
}

// 零漂移保护清单：决策/评分/身份/JD 全部原样保留（spec §17）
const NUMERIC_KEYS = ['cv_match_score', 'career_ops_score', 'career_score', 'score', 'score_confidence',
  'score_breakdown', 'cv_match_confidence', 'cv_match_factors', 'recommendation', 'recommendation_reason',
  'eligibility_status', 'blockers', 'hard_gaps', 'taxonomy', 'capability_summary', 'decision_trace',
  'score_scale', 'score_scale_version', 'unknown_items', 'hard_requirements', 'eligibility_notes',
  'rule_score', 'rule_filter', 'salary_fit', 'location_fit', 'hard_redline', 'skip_reason', 'cv_match'];
const JOB_KEYS = ['job_id', 'title', 'description', 'company', 'salary', 'district'];

let repaired = 0, normalizedOnly = 0, untouched = 0, rejected = 0;
const drift = [];
const perFile = {};
const contentDist = { rich: 0, partial: 0, sparse: 0 };

// 人工状态零漂移：本工具从不写 tracker；写回前 applications.md 哈希必须一致
const appsPath = path.join(DATA, 'applications.md');
const appsHashBefore = fs.existsSync(appsPath) ? createHash('sha256').update(fs.readFileSync(appsPath)).digest('hex') : null;

for (const file of fs.readdirSync(DATA).filter(f => /^search-results-.*\.json$/.test(f)).sort()) {
  const p = path.join(DATA, file);
  let run;
  try { run = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  let touched = 0;
  const before = JSON.stringify(run);

  for (const job of run.jobs || []) {
    const orig = job.analysis || {};
    const beforeJob = {};
    for (const k of JOB_KEYS) beforeJob[k] = JSON.stringify(job[k] ?? null);
    const beforeNumeric = {};
    for (const k of NUMERIC_KEYS) beforeNumeric[k] = JSON.stringify(orig[k] ?? null);

    // 唯一 Gate（strict=false：既有对象刷新；engine=null = 不重算，仅规范 + 校验 + metadata）
    const gate = finalizeAnalysisForPersistence({
      provider: orig, engine: null, strict: false,
      source: `backfill:${file}`,
    });
    if (!gate.ok) {
      rejected++;
      drift.push({ file, job_id: job.job_id, kind: 'gate-reject', detail: gate.reason });
      continue;
    }
    // 复跑幂等 + 审计轨迹保留：历史 repaired_actions 是"当初如何修到 canonical"的记录，
    // 复跑归一已无事可做（actions 变空）不等于历史未修——并集去重后保留。
    if (orig.analysis_gate && Array.isArray(orig.analysis_gate.repaired_actions)) {
      const hist = [...orig.analysis_gate.repaired_actions];
      for (const a of gate.analysis.analysis_gate.repaired_actions) if (!hist.includes(a)) hist.push(a);
      gate.analysis.analysis_gate.repaired_actions = hist;
      gate.analysis.analysis_gate.repaired = hist.length > 0;
      gate.analysis.analysis_completeness.repaired = hist.length > 0;
    }
    const analysis = gate.analysis;

    // 数值零漂移校验：只保护"原值存在"的字段（规范化对缺失 key 补 canonical 空值是合同行为，
    // 不算漂移）；原值存在的字段，归一前后必须逐字节一致。
    for (const k of NUMERIC_KEYS) {
      if (beforeNumeric[k] === 'null') continue;
      if (JSON.stringify(analysis[k] ?? null) !== beforeNumeric[k]) {
        drift.push({ file, job_id: job.job_id, kind: 'analysis-field', key: k });
      }
    }
    // 身份/JD 零漂移
    for (const k of JOB_KEYS) {
      if (JSON.stringify(job[k] ?? null) !== beforeJob[k]) {
        drift.push({ file, job_id: job.job_id, kind: 'job-field', key: k });
      }
    }

    // 幂等：若除 gated_at 时间戳外无任何变化，保留原时间戳并视为 untouched（不重写文件）
    let changed = JSON.stringify(orig) !== JSON.stringify(gate.analysis);
    if (changed && orig.analysis_gate) {
      const { gated_at, ...restGate } = gate.analysis.analysis_gate || {};
      const { gated_at: origAt, ...restOrigGate } = orig.analysis_gate;
      if (JSON.stringify({ ...gate.analysis, analysis_gate: restGate }) === JSON.stringify({ ...orig, analysis_gate: restOrigGate })) {
        gate.analysis.analysis_gate.gated_at = origAt;
        changed = false;
      }
    }
    if (changed) {
      job.analysis = gate.analysis;
      touched++;
      if (gate.analysis.analysis_gate.repaired) repaired++; else normalizedOnly++;
    } else {
      untouched++;
    }
    contentDist[analysis.analysis_gate.content_status]++;
  }

  if (touched > 0 && !DRY) {
    backup(file);
    // 唯一 writer 断言层：写盘前逐岗位 assertCanonicalAnalysis（未过 → 拒绝整个文件）
    writeRunFile(run, p, { label: `backfill:${file}` });
  }
  perFile[file] = { touched };
  void before;
}

// 人工状态零漂移终检
const appsHashAfter = fs.existsSync(appsPath) ? createHash('sha256').update(fs.readFileSync(appsPath)).digest('hex') : null;
if (appsHashBefore !== appsHashAfter) {
  drift.push({ file: 'data/applications.md', kind: 'manual-status', detail: 'applications.md hash changed' });
}

console.log(`模式: ${DRY ? 'DRY-RUN' : '写回'}`);
console.log(`岗位处理: repaired=${repaired} normalizedOnly=${normalizedOnly} untouched=${untouched} gateRejected=${rejected}`);
console.log(`content_status: rich=${contentDist.rich} partial=${contentDist.partial} sparse=${contentDist.sparse}`);
for (const [f, r] of Object.entries(perFile)) if (r.touched) console.log(`  ${f}: ${r.touched}`);
if (drift.length > 0) {
  console.error(`\n✗ STOP：${drift.length} 处漂移/Gate 拒绝（${DRY ? '' : '已'}写回）：`);
  drift.slice(0, 10).forEach(d => console.error(' ', JSON.stringify(d)));
  process.exit(1);
}
console.log('✓ 全量零漂移（分析字段 / job_id / JD / applications.md 人工状态）');
