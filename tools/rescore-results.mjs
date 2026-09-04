#!/usr/bin/env node
// rescore-results.mjs — 用评分引擎重算 search results 的 Career Ops Score
//
// Usage:
//   node tools/rescore-results.mjs <results-in.json> <dims-inputs.json> <results-out.json>
//
// dims-inputs JSON 结构：
// {
//   "<job_id>": {
//     "cv_match_score": 72,               // 0-100，独立指标（tools/lib/cv-match.mjs 产出）
//     "dimensions": [ {"key":"compensation","score":3,"reason":"...","evidence":"..."}, ... ],
//     "blockers": { "current_employer_conflict": true, ... }
//   }
// }
//
// 维度 key 必须取自 scoring.mjs SCORING_RUBRIC 的十维（compensation / workload_workstyle /
// role_seniority / career_growth / category_domain_value / procurement_ownership /
// company_stability / location_fit / digital_tooling / hiring_process_quality）。
// 维度 score=null → unknown（不入分母）。输出包含完整 score_breakdown + score_confidence。
//
// Round 1B（2026-09-03）量纲契约：维度分与 career_ops_score 均为真 0-100（引擎 clamp [0,100]，
// 正式映射 new = (old − 1) × 25）。dims 输入必须带 score_scale_version: 2 标记
// （tools/migrate-score-scale.mjs 迁移产出）；无版本标记或 version≠2 一律拒绝，
// 防止 legacy 1-5 或 Round1 错误 20-100 数据被静默误算（不做任何数值域猜测）。

import fs from 'node:fs';
import { evaluate } from './lib/scoring.mjs';
import { finalizeAnalysisForPersistence, formatBatchSummary } from '../dashboard-web/lib/analysis-contract.mjs';
import { writeRunFile } from './lib/analysis-persistence.mjs';

const [,, inPath, dimsPath, outPath] = process.argv;
if (!inPath || !dimsPath || !outPath) {
  console.error('Usage: node tools/rescore-results.mjs <results-in> <dims.json> <results-out>');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const dimsByJob = JSON.parse(fs.readFileSync(dimsPath, 'utf8'));

// 量纲守卫：dims 输入必须显式声明 score_scale_version: 2（true 0-100 合同）。
// 无标记 / 旧 1-5 / Round1 错误 20-100 数据一律拒绝——禁止按数值域猜测量纲。
const BAD_VERSION = Object.entries(dimsByJob).filter(([, v]) => v?.score_scale_version !== 2);
if (BAD_VERSION.length > 0) {
  console.error(`✗ ${BAD_VERSION.length} 个岗位的 dims 输入缺少 score_scale_version: 2（示例: ${BAD_VERSION[0][0]}，实际: ${JSON.stringify(BAD_VERSION[0][1]?.score_scale_version ?? null)}）。`);
  console.error('  请先运行: node tools/migrate-score-scale.mjs（legacy 1-5 → true 0-100）');
  process.exit(1);
}

let changed = 0;
const gateEntries = [];
const gateRejected = [];
for (const job of results.jobs) {
  const input = dimsByJob[job.job_id];
  if (!input) {
    console.warn(`⚠️ 无 ${job.job_id}（${job.company}）的维度输入，保留原样`);
    continue;
  }
  const scored = evaluate(input.dimensions, input.blockers || {});
  // Round 2B persistence gate：narrative 不变（P11 复用既有 canonical narrative），
  // 引擎字段重算后整体过唯一 Gate（engine > model；strict=false = 既有对象刷新路径）。
  const gate = finalizeAnalysisForPersistence({
    provider: job.analysis || {},
    engine: {
      cv_match_score: input.cv_match_score ?? null,
      cv_match: input.cv_match_score != null ? `${input.cv_match_score}%` : null,
      career_ops_score: scored.career_ops_score,
      score: scored.career_ops_score, // 兼容旧展示字段
      score_scale: scored.score_scale,
      score_scale_version: scored.score_scale_version,
      score_confidence: scored.score_confidence,
      score_breakdown: scored.score_breakdown,
      recommendation: scored.recommendation,
      recommendation_reason: scored.recommendation_reason,
      decision_trace: scored.trace,
    },
    strict: false,
    source: 'tools/rescore-results.mjs',
  });
  if (!gate.ok) {
    gateRejected.push({ job_id: job.job_id, reason: gate.reason });
    continue;
  }
  job.analysis = gate.analysis;
  gateEntries.push({ ok: true, analysis: gate.analysis });
  changed++;
}

// 批次 summary（§10）：rescore 也是正式批次，数字全部来自 gate 结果
console.log(formatBatchSummary(buildRescoreSummary(gateEntries, gateRejected, results.jobs.length)));

if (gateRejected.length > 0) {
  console.error(`✗ STOP：${gateRejected.length} 个岗位未通过 persistence gate（未写 ${outPath}）：`);
  gateRejected.forEach(r => console.error(`  ${r.job_id}: ${r.reason}`));
  process.exit(1);
}

results.rescored_at = new Date().toISOString();
results.analysis_basis = {
  ...(results.analysis_basis || {}),
  score_scale: '0-100',
  scoring_engine: 'tools/lib/scoring.mjs（采购十维 × 权重 100 归一化 + unknown 出分母 + confidence；Round 1 起数值量纲 0-100）',
  recommendation: '决策链唯一 SoT = computeRecommendation：评分 + 硬红线/deal_breakers + candidate-side blocker + job-side 资格 + 决策矩阵 + 缺口封顶（trace[] 可追溯）',
};
results.counters = { ...(results.counters || {}), analyzed: changed };

// Round 2B writer enforcement：逐岗位 assertCanonicalAnalysis（gate 封印）后才落盘
try {
  writeRunFile(results, outPath, { label: outPath });
} catch (e) {
  console.error(`✗ writer 拒绝写入：${e.message}`);
  process.exit(1);
}
console.log(`✓ 重算 ${changed}/${results.jobs.length} 个岗位 → ${outPath}`);
for (const job of results.jobs) {
  const a = job.analysis;
  if (a.career_ops_score == null) continue;
  console.log(`  ${job.company} | CV ${a.cv_match_score}% | Score ${a.career_ops_score} | ${a.score_confidence.percent}% ${a.score_confidence.level} | ${a.recommendation}`);
}

function buildRescoreSummary(gateEntries, gateRejected, total) {
  return {
    total,
    schema_pass: gateEntries.length,
    schema_rejected: gateRejected.length,
    repaired: gateEntries.filter(e => e.analysis?.analysis_gate?.repaired).length,
    rich: gateEntries.filter(e => e.analysis?.analysis_gate?.content_status === 'rich').length,
    partial: gateEntries.filter(e => e.analysis?.analysis_gate?.content_status === 'partial').length,
    sparse: gateEntries.filter(e => e.analysis?.analysis_gate?.content_status === 'sparse').length,
    persist_rejected: gateRejected.length,
    numeric_drift: 0,          // 引擎字段全部由本轮 evaluate 产出，不存在 provider 覆盖面
    recommendation_drift: 0,
    eligibility_drift: 0,
  };
}
