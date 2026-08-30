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

import fs from 'node:fs';
import { evaluate } from './lib/scoring.mjs';

const [,, inPath, dimsPath, outPath] = process.argv;
if (!inPath || !dimsPath || !outPath) {
  console.error('Usage: node tools/rescore-results.mjs <results-in> <dims.json> <results-out>');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const dimsByJob = JSON.parse(fs.readFileSync(dimsPath, 'utf8'));

let changed = 0;
for (const job of results.jobs) {
  const input = dimsByJob[job.job_id];
  if (!input) {
    console.warn(`⚠️ 无 ${job.job_id}（${job.company}）的维度输入，保留原样`);
    continue;
  }
  const scored = evaluate(input.dimensions, input.blockers || {});
  const a = job.analysis || {};
  job.analysis = {
    ...a,
    cv_match_score: input.cv_match_score ?? null,
    cv_match: input.cv_match_score != null ? `${input.cv_match_score}%` : a.cv_match,
    career_ops_score: scored.career_ops_score,
    score: scored.career_ops_score, // 兼容旧展示字段
    score_confidence: scored.score_confidence,
    score_breakdown: scored.score_breakdown,
    recommendation: scored.recommendation,
    recommendation_reason: scored.recommendation_reason,
  };
  changed++;
}

results.rescored_at = new Date().toISOString();
results.analysis_basis = {
  ...(results.analysis_basis || {}),
  scoring_engine: 'tools/lib/scoring.mjs（采购十维 × 权重 100 归一化 + unknown 出分母 + confidence）',
  recommendation: '决策链唯一 SoT = computeRecommendation：评分 + 硬红线/deal_breakers + candidate-side blocker + job-side 资格 + 决策矩阵 + 缺口封顶（trace[] 可追溯）',
};
results.counters = { ...(results.counters || {}), analyzed: changed };

fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`✓ 重算 ${changed}/${results.jobs.length} 个岗位 → ${outPath}`);
for (const job of results.jobs) {
  const a = job.analysis;
  console.log(`  ${job.company} | CV ${a.cv_match_score}% | Score ${a.career_ops_score} | ${a.score_confidence.percent}% ${a.score_confidence.level} | ${a.recommendation}`);
}
