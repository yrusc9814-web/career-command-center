#!/usr/bin/env node
// finalize-analysis.mjs — Round 2B 正式 analysis 持久化唯一 CLI（PERSISTENCE GATE CONTRACT）
//
// 用途：browser-search / batch 等产生新正式分析后，通过本工具落盘 run 文件：
//
//   provider/model narrative output + deterministic engine output（每岗）
//   → finalizeAnalysisForPersistence（唯一 Gate：normalize → strip → merge →
//     repair → validate → metadata → validate）
//   → 全部通过 → writeRunFile（逐 job assertCanonicalAnalysis 后写盘）
//   → 输出 Batch Summary（§10）
//
// 输入文件（--in）两种形态：
//   1. finalize 指令文件（新分析的正式形态，browser-search Step 7 / batch Step 5b）：
//        { "defaults": {...engine 公共字段...},
//          "jobs": [ { "job": {...per_job 采集字段...}, "provider": {...模型 narrative...},
//                      "engine": {...该岗引擎输出（覆盖 defaults 同名 key）...} } ] }
//      provider/engine 分离是信任边界的载体：strict=true 剥离 provider 越权引擎字段。
//   2. 已有 run 文件（data/search-results-*.json 形态）：整文件逐岗位重过 Gate
//      （provider = 既有 analysis，engine = null，strict=false）——旧数据 canonical 化。
//      ⚠️ 该路径信任既有 engine 数值（legacy 兼容）；新分析严禁先把 engine 字段混进
//      provider 再走此形态——verify Check 8 与本 CLI 的 summary 均不会替你守住该边界。
//
// 退出码：0 = 全部持久化成功；1 = 任一岗位被 Gate 拒绝（文件不写盘）。
//
// 用法：
//   node tools/finalize-analysis.mjs --in <finalize-input.json> --out <results-out.json>
//   node tools/finalize-analysis.mjs --in <existing-run.json> --out <same-or-new.json> [--dry-run]

import { finalizeAnalysisForPersistence, formatBatchSummary, buildBatchSummary, isAnalyzed } from '../dashboard-web/lib/analysis-contract.mjs';
import { readRunFile, writeRunFile } from './lib/analysis-persistence.mjs';

const args = process.argv.slice(2);
const getArg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const inPath = getArg('--in');
const outPath = getArg('--out');
const DRY = args.includes('--dry-run');

if (!inPath || !outPath) {
  console.error('Usage: node tools/finalize-analysis.mjs --in <input.json> --out <results.json> [--dry-run]');
  process.exit(1);
}

let input;
try {
  input = JSON.parse((await import('node:fs')).readFileSync(inPath, 'utf8'));
} catch (e) {
  console.error(`✗ 无法读取输入 ${inPath}: ${e.message}`);
  process.exit(1);
}

const isRunShape = Array.isArray(input?.jobs) && input.jobs.every(j => j && typeof j === 'object' && !('provider' in j));
const entries = [];

if (isRunShape) {
  // 形态 2：既有 run 文件整体重过 Gate（canonical 化；strict=false 保留未知 legacy key）
  // ⚠️ 封印边界：本形态只为**已有 analysis_gate 封印**的数据刷新元数据（Round 1B/2 历史数据
  // 合同升级用）。无封印的已分析 raw object 一律拒绝——否则该形态会变成"伪造引擎数值洗白
  // 通道"（非法枚举/量纲能被 validate 拦住，但合法区间内的假分拦不住）。新数据必须走形态 1
  // （provider/engine 分离，engine > model）。
  for (const job of input.jobs) {
    const raw = job.analysis || {};
    const unsealed = isAnalyzed(raw) && !(raw.analysis_gate && raw.analysis_gate.schema_status === 'complete');
    if (unsealed) {
      entries.push({
        job_id: job.job_id || null, ok: false,
        reason: `recanonicalize refuses to seal un-gated analysis for ${job.job_id || '(no job_id)'} — 用 finalize 指令文件形态（provider/engine 分离）重新持久化`,
      });
      continue;
    }
    const r = finalizeAnalysisForPersistence({
      provider: raw, engine: null, strict: false,
      source: `recanonicalize:${job.job_id || ''}`,
    });
    entries.push({ job_id: job.job_id || null, ...r });
    job.analysis = r.analysis;
  }
} else {
  // 形态 1：finalize 指令文件（browser-search / batch 的新分析路径）
  const defaults = input.defaults || {};
  for (const item of input.jobs || []) {
    const job = item.job || {};
    const engine = { ...defaults, ...(item.engine || {}) };
    const r = finalizeAnalysisForPersistence({
      provider: item.provider || {}, engine, strict: true,
      source: item.source || 'finalize-cli',
    });
    entries.push({ job_id: job.job_id || null, ...r });
    job.analysis = r.analysis;
  }
  input.jobs = (input.jobs || []).map(item => item.job);
}

const summary = buildBatchSummary(entries);
console.log(formatBatchSummary(summary));
for (const e of entries) {
  if (!e.ok) console.error(`  ✗ ${e.job_id || '(no job_id)'}: ${e.reason}`);
}

// Schema PASS != total accepted → 不报 PASS、不写盘（§10）
if (summary.schema_pass !== summary.total) {
  console.error(`✗ STOP：Schema PASS ${summary.schema_pass}/${summary.total} — 拒绝持久化（未写 ${outPath}）`);
  process.exit(1);
}

if (DRY) {
  console.log(`✓ DRY-RUN：${summary.total} 岗全部通过 Gate（未写盘）`);
  process.exit(0);
}

try {
  // 唯一 writer：逐岗位 assertCanonicalAnalysis（gate 封印）后才 writeFileSync
  const res = writeRunFile(input, outPath, { label: outPath });
  console.log(`✓ 持久化 ${summary.total} 岗（断言通过 ${res.asserted}）→ ${outPath}`);
} catch (e) {
  console.error(`✗ writer 拒绝写入：${e.message}`);
  process.exit(1);
}
