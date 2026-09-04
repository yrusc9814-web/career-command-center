// analysis-persistence.mjs — Round 2B 正式 analysis 落盘唯一 writer 层（node 侧）
//
// 职责（PERSISTENCE GATE CONTRACT 的 writer enforcement，spec §6）：
//   - writeRunFile：search-results run 文件的唯一正式写入函数；写盘前对每个
//     已分析岗位执行 assertCanonicalAnalysis（validate + schema v2 + gate 封印），
//     任一未过 Gate 的 raw analysis → 拒绝整个写入（throw），调用方不能绕过；
//   - readRunFile：读取兼容（legacy shape 可读，Gate 之后再写）；
//   - 归一化 canonical 布局（indent 2 + 结尾换行），与既有文件格式一致。
//
// 铁律：本模块不做任何 schema 判定逻辑——唯一判定 SoT =
// dashboard-web/lib/analysis-contract.mjs（finalizeAnalysisForPersistence /
// assertCanonicalAnalysis）。本模块只负责"未经判定不许落盘"。

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import {
  assertCanonicalAnalysis, isAnalyzed, computeContentStatus,
} from '../../dashboard-web/lib/analysis-contract.mjs';

/** 读取 run 文件（不存在 → null；JSON 损坏 → throw，调用方决定处置）。 */
export function readRunFile(p) {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** 断言单个已分析岗位 canonical；未过 → throw（附 job_id 与具体错误）。 */
export function requireCanonicalAnalysis(a, label = 'job') {
  const chk = assertCanonicalAnalysis(a);
  if (!chk.ok) {
    throw new Error(`persistence rejected (${label}): ${chk.errors.join('; ')}`);
  }
  return chk;
}

/**
 * run 文件唯一正式写入入口：全量断言通过才 writeFileSync。
 * 已分析岗位（isAnalyzed）必须 canonical + 带 Gate 封印；未分析行不校验。
 * @returns {{asserted:number}} 实际断言通过的已分析岗位数
 */
export function writeRunFile(run, outPath, { label = outPath } = {}) {
  if (!run || !Array.isArray(run.jobs)) {
    throw new Error(`persistence rejected (${label}): run.jobs[] missing`);
  }
  let asserted = 0;
  for (const job of run.jobs) {
    const a = job?.analysis;
    if (!a || !isAnalyzed(a)) continue;
    requireCanonicalAnalysis(a, `${label}:${job.job_id || '(no job_id)'}`);
    asserted++;
  }
  writeFileSync(outPath, JSON.stringify(run, null, 2) + '\n', 'utf8');
  return { asserted };
}

/** 从 job.analysis 提取 content_status（未过 Gate 的旧数据 → 现算 deterministic 判定）。 */
export function contentStatusOf(a) {
  return a?.analysis_gate?.content_status ?? computeContentStatus(a).status;
}

/**
 * 对一个 run 的全部已分析岗位做只读统计（§16/§18 审计用；不写盘）。
 * @returns {{analyzed:number, schema_fail:number, rich:number, partial:number,
 *            sparse:number, fail_detail:Array}}
 */
export function auditRunJobs(run) {
  const r = { analyzed: 0, schema_fail: 0, rich: 0, partial: 0, sparse: 0, fail_detail: [] };
  for (const job of run?.jobs || []) {
    const a = job?.analysis;
    if (!a || !isAnalyzed(a)) continue;
    r.analyzed++;
    const chk = assertCanonicalAnalysis(a);
    if (!chk.ok) {
      r.schema_fail++;
      r.fail_detail.push({ job_id: job.job_id, errors: chk.errors });
      continue;
    }
    const cs = contentStatusOf(a);
    if (cs === 'rich') r.rich++;
    else if (cs === 'partial') r.partial++;
    else r.sparse++;
  }
  return r;
}
