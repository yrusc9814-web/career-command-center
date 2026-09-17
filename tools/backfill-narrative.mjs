#!/usr/bin/node
// backfill-narrative.mjs — Dashboard 优化轮：narrative-only backfill（LOCAL ONLY）
//
// 范围（严格）：
//   只补 cv_advice / interview_focus 两个 narrative 字段（可用 --field 收窄到单字段）；
//   已达 complete 标准的岗位不动。
//   complete 标准（interview_focus 完整度收紧轮更新）：
//     - cv_advice：①-⑳ ≥3 条且 ≥60 字，或 ≥80 字且有分隔结构（不变）；
//     - interview_focus：结构实质 且 命中 ≥2 类"面试准备动作"信号
//       （isActionableInterviewFocus，SoT = analysis-contract.mjs）——
//       单纯复述 gap / JD 要求（无准备动作）不算完整，不论长度。
// 禁止改动（零漂移保护清单，写盘前后逐 job 哈希对比，任何漂移 → 退出码 1）：
//   Career Score / CV Match / Confidence / Recommendation / Eligibility /
//   score_breakdown / job_id / strengths / gaps / soft_gaps / decision_trace /
//   taxonomy / hard_requirements / blockers / title / company / description /
//   applications.md（人工状态）/ dashboard-state.json（shortlist）
// 链路：生成内容（仅以该岗位自身 persisted 数据为锚点，不虚构）→
//   finalizeAnalysisForPersistence(strict=false) 刷新 Gate 元数据 →
//   writeRunFile（全量 canonical 断言后才落盘）。
//
// 用法：node tools/backfill-narrative.mjs [--dry-run] [--field=cv_advice|interview_focus] [--refill=job_id,...]

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { finalizeAnalysisForPersistence, isActionableInterviewFocus } from '../dashboard-web/lib/analysis-contract.mjs';
import { writeRunFile } from './lib/analysis-persistence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');
// --field 收窄：本轮只允许动一个 narrative 字段时使用（默认 both = 历史行为）
const FIELD = process.argv.includes('--field=cv_advice') ? 'cv_advice'
  : process.argv.includes('--field=interview_focus') ? 'interview_focus'
  : 'both';
// --refill=job_id,...：对这些岗位强制重生成 interview_focus（即使当前判定 complete，
// 用于生成质量返工；仍走 Gate → writer，零漂移保护不变）
const REFILL_IDS = new Set(((process.argv.find(a => a.startsWith('--refill=')) || '').split('=')[1] || '').split(',').filter(Boolean));

// ── 零漂移保护清单 ──────────────────────────────────────────────────────────
const FROZEN_ANALYSIS_KEYS = [
  // 评分与置信度（Career Score / CV Match / Confidence）
  'cv_match_score', 'career_ops_score', 'career_score', 'score', 'score_confidence',
  'score_breakdown', 'cv_match_confidence', 'cv_match_factors', 'cv_match',
  'score_scale', 'score_scale_version', 'rule_score', 'rule_filter',
  // 决策 / 资格（Recommendation / Eligibility）
  'recommendation', 'recommendation_reason', 'decision_trace',
  'eligibility_status', 'eligibility_notes', 'hard_requirements', 'blockers',
  'hard_gaps', 'hard_redline', 'skip_reason', 'salary_fit', 'location_fit',
  // 其他 narrative 与引擎字段（本轮一律不动）
  'strengths', 'gaps', 'soft_gaps', 'taxonomy', 'capability_summary',
  'unknown_items', 'interview_traps', 'analysis_schema_version', 'analysis_gate',
];
const FROZEN_JOB_KEYS = ['job_id', 'title', 'description', 'company', 'salary', 'district'];

const hashOf = (v) => createHash('sha256').update(JSON.stringify(v ?? null)).digest('hex');

// ── 内容锚点工具 ────────────────────────────────────────────────────────────
const cut = (s, n = 36) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const FACTOR_ZH = {
  category_experience: '品类经验', sourcing_development: '寻源开发',
  negotiation_contract: '谈判与合同', seniority_match: '资历职级',
  cost_reduction: '降本能力', digital_tools: '数字化工具（SRM/ERP）',
  supplier_management: '供应商管理', cross_team: '跨部门协作',
  logistics: '物流履约', quality: '质量体系', english: '外语能力',
  domain_match: '行业领域匹配', international_procurement: '国际采购',
  delivery_collaboration: '交付协同', supplier_quality: '供应商质量管理',
  leadership: '带队经验', years_experience: '工作年限', education: '学历背景',
  language: '语言能力',
};
const fzh = (f) => FACTOR_ZH[f.key] || f.name || f.key;
const dedupe = (items) => {
  const seen = new Set();
  return items.filter(it => {
    const k = it.replace(/\s+/g, '').slice(0, 16);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const number = (items) => items.map((t, i) => `${'①②③④⑤⑥⑦⑧⑨⑩'[i] || '-'} ${t}`).join('');

/** 简历建议：3-5 条，锚点 = 硬性要求 / 缺证据因子 / 证据不足维度 / 可弥补缺口 / 已确认短板 */
function buildCvAdvice(job) {
  const a = job.analysis || {};
  const items = [];
  const hrs = (Array.isArray(a.hard_requirements) ? a.hard_requirements : []).filter(h => h && h.jd_text);
  const met = hrs.filter(h => h.status === 'met');
  for (const h of met.slice(0, 1)) {
    items.push(`JD 硬性要求「${cut(h.jd_text)}」与已有背景匹配：在简历对应经历行显式写入与该要求一致的关键词，让 HR 首屏就能看到对应关系。`);
  }
  const weakFactors = (Array.isArray(a.cv_match_factors) ? a.cv_match_factors : [])
    .filter(f => f && (f.status === 'no_evidence' || f.status === 'partial'));
  for (const f of weakFactors.slice(0, 2)) {
    const ev = cut(String(f.evidence || '').split(/[｜;；]/)[0], 40);
    items.push(`「${fzh(f)}」目前缺少简历实证${ev ? `（评估依据：${ev}）` : ''}：把相关经历改写成可量化的结果（金额 / 百分比 / 规模）；确实没有就保持留白，不虚构。`);
  }
  const dims = (a.score_breakdown && Array.isArray(a.score_breakdown.dimensions)) ? a.score_breakdown.dimensions : [];
  for (const d of dims.filter(d => d && d.status === 'unknown').slice(0, 2)) {
    items.push(`评分维度「${d.name || d.key}」证据不足（${cut(d.reason, 30)}）：若确有相关经历，在简历补一句量化描述；没有则保留现状，避免空话。`);
  }
  for (const sg of (Array.isArray(a.soft_gaps) ? a.soft_gaps : []).slice(0, 1)) {
    const text = typeof sg === 'string' ? sg : sg?.text;
    const fix = typeof sg === 'object' ? (sg?.fix || sg?.mitigation) : '';
    if (!text) continue;
    items.push(`可弥补缺口「${cut(text, 30)}」：简历侧先落地——${cut(fix, 50) || '用相邻经历与学习方法论体现正在补齐'}。`);
  }
  for (const g of (Array.isArray(a.gaps) ? a.gaps : []).slice(0, 1)) {
    items.push(`已确认短板「${cut(g, 30)}」：不靠话术掩盖，用相邻可迁移经历以项目制写法对冲，不夸大职级与头衔。`);
  }
  return number(dedupe(items).slice(0, 5));
}

/** 面试准备点：4-6 条，锚点 = 硬性门槛 / 待验证要求 / 缺证据因子 / 短板口径 / 薪资冲突 / 反向提问 */
function buildInterviewFocus(job) {
  const a = job.analysis || {};
  const items = [];
  const hrs = (Array.isArray(a.hard_requirements) ? a.hard_requirements : []).filter(h => h && h.jd_text);
  const missing = hrs.filter(h => h.status !== 'met' || h.confirmed_missing);
  const met = hrs.filter(h => h.status === 'met');
  for (const h of missing.slice(0, 2)) {
    items.push(`「${cut(h.jd_text)}」是${h.mandatory === 'explicit' ? '明示' : '隐含'}硬性门槛且当前证据不足：准备被追问时的如实说明 + 相邻替代经验各一句话。`);
  }
  for (const h of met.slice(0, 1)) {
    items.push(`「${cut(h.jd_text)}」大概率被验证：准备一个能展开的实例（背景—动作—量化结果），对齐 JD 原文措辞。`);
  }
  const weakFactors = (Array.isArray(a.cv_match_factors) ? a.cv_match_factors : [])
    .filter(f => f && (f.status === 'no_evidence' || f.status === 'partial'));
  for (const f of weakFactors.slice(0, 2)) {
    items.push(`「${fzh(f)}」简历无实证：准备快速上手路径的说法（相邻品类迁移 / 方法论 / 学习计划），不空谈学习能力强。`);
  }
  // 锚点不足 3 条时多取 gaps（每条 = "如何解释该 gap"的准备点，承认+边界+动作框架）
  const gaps = (Array.isArray(a.gaps) ? a.gaps : []);
  for (const g of gaps.slice(0, items.length < 3 ? 3 : 1)) {
    items.push(`短板「${cut(g, 30)}」：口径 = 承认 + 边界 + 正在补的具体动作，不回避不辩解。`);
  }
  const dims = (a.score_breakdown && Array.isArray(a.score_breakdown.dimensions)) ? a.score_breakdown.dimensions : [];
  const comp = dims.find(d => d && d.key === 'compensation' && d.status === 'known' && typeof d.score === 'number' && d.score < 50);
  if (comp) items.push(`薪资带存在冲突信号（${cut(comp.reason, 36)}）：进面前定好底线、可谈项与让步顺序。`);
  const unknown = dims.filter(d => d && d.status === 'unknown');
  for (const d of unknown.slice(0, 1)) {
    items.push(`JD 未明示「${d.name || d.key}」：准备反向提问（工作制 / 汇报线 / 品类规模），带着问题清单进面。`);
  }
  // 兜底：以上锚点不足 4 条时，用已确认匹配（matched）且带强证据的因子做深挖准备点
  if (items.length < 4) {
    const matched = (Array.isArray(a.cv_match_factors) ? a.cv_match_factors : [])
      .filter(f => f && f.status === 'matched' && String(f.evidence || '').length > 20);
    for (const f of matched.slice(0, 4 - items.length)) {
      const ev = cut(String(f.evidence || '').split(/[｜;；]/)[0], 40);
      items.push(`「${fzh(f)}」是已确认的匹配项（${ev}）：把它打磨成 2-3 分钟的展开叙述（背景—动作—结果—复盘），防面试官追问细节。`);
    }
  }
  return number(dedupe(items).slice(0, 6));
}

/** complete 判定：
 *  - cv_advice（结构规则，不变）：①-⑳ ≥3 条且 ≥60 字，或 ≥80 字且有分隔结构
 *  - interview_focus（收紧轮）：结构实质 且 ≥2 类准备动作信号（gap/JD 复述 → 不完整） */
function isCompleteNarrative(v) {
  const t = String(v ?? '').trim();
  const bullets = (t.match(/[①-⑳]/g) || []).length;
  if (bullets >= 3 && t.length >= 60) return true;
  return t.length >= 80 && (bullets >= 1 || /[;；.。]/.test(t));
}
const isCompleteInterviewFocus = (v) => isActionableInterviewFocus(v);

// ── 主流程 ──────────────────────────────────────────────────────────────────
const appsPath = path.join(DATA, 'applications.md');
const statePath = path.join(DATA, 'dashboard-state.json');
const appsHashBefore = fs.existsSync(appsPath) ? hashOf(fs.readFileSync(appsPath, 'utf8')) : null;
const stateHashBefore = fs.existsSync(statePath) ? hashOf(fs.readFileSync(statePath, 'utf8')) : null;

const stats = {
  files: 0, jobsSeen: 0, cvBefore: 0, ivBefore: 0,
  cvAfter: 0, ivAfter: 0, jobsTouched: 0,
};
const drift = [];

for (const file of fs.readdirSync(DATA).filter(f => /^search-results-.*\.json$/.test(f) && !f.includes('ui-preview-demo')).sort()) {
  const p = path.join(DATA, file);
  let run;
  try { run = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  if (!run || !Array.isArray(run.jobs)) continue;
  let fileTouched = false;

  for (const job of run.jobs) {
    const a = job?.analysis;
    if (!a || !(a.career_ops_score != null || a.recommendation != null)) continue;
    stats.jobsSeen++;
    const cvBeforeOk = isCompleteNarrative(a.cv_advice);
    const ivBeforeOk = isCompleteInterviewFocus(a.interview_focus) && !REFILL_IDS.has(job.job_id);
    if (cvBeforeOk) stats.cvBefore++;
    if (ivBeforeOk) stats.ivBefore++;

    // --field 收窄：非目标字段永不改写（本轮 interview_focus-only → cv_advice 保持原值）
    const newCv = (FIELD === 'interview_focus' || cvBeforeOk) ? a.cv_advice : buildCvAdvice(job);
    const newIv = (FIELD === 'cv_advice' || ivBeforeOk) ? a.interview_focus : buildInterviewFocus(job);
    // after 统计：全部 analyzed entry（触达与否）按处理后的值直接判定，不做公式推导
    if (isCompleteNarrative(newCv)) stats.cvAfter++;
    if (isCompleteInterviewFocus(newIv)) stats.ivAfter++;
    const willTouch = newCv !== a.cv_advice || newIv !== a.interview_focus;
    if (!willTouch) continue;

    const beforeFrozen = {};
    for (const k of FROZEN_ANALYSIS_KEYS) beforeFrozen[k] = hashOf(a[k]);
    const beforeJob = {};
    for (const k of FROZEN_JOB_KEYS) beforeJob[k] = hashOf(job[k]);

    if (DRY) {
      const cvAct = newCv !== a.cv_advice ? 'fill' : 'keep';
      const ivAct = newIv !== a.interview_focus ? 'fill' : 'keep';
      console.log(`[dry] ${file} ${job.job_id} cv:${cvAct}(${cut(newCv, 30)}…) iv:${ivAct}(${cut(newIv, 30)}…)`);
      continue;
    }

    const gated = finalizeAnalysisForPersistence({
      provider: { ...a, cv_advice: newCv, interview_focus: newIv },
      engine: null, strict: false, source: 'backfill:narrative-round',
    });
    if (!gated.ok) {
      console.error(`GATE REJECTED ${job.job_id}: ${gated.reason}`);
      process.exit(1);
    }
    job.analysis = gated.analysis;
    fileTouched = true;
    stats.jobsTouched++;

    // 零漂移校验（写盘前逐字段）
    for (const k of FROZEN_ANALYSIS_KEYS) {
      if (k === 'analysis_gate') continue; // gate 元数据按设计刷新（gated_at / repaired_actions）
      if (hashOf(job.analysis[k]) !== beforeFrozen[k]) drift.push(`${file}:${job.job_id}:analysis.${k}`);
    }
    for (const k of FROZEN_JOB_KEYS) {
      if (hashOf(job[k]) !== beforeJob[k]) drift.push(`${file}:${job.job_id}:job.${k}`);
    }
  }

  if (fileTouched && !DRY) {
    writeRunFile(run, p, { label: file });
    stats.files++;
  }
}

if (DRY) { console.log('(dry-run — no changes written)'); process.exit(0); }

const appsHashAfter = fs.existsSync(appsPath) ? hashOf(fs.readFileSync(appsPath, 'utf8')) : null;
const stateHashAfter = fs.existsSync(statePath) ? hashOf(fs.readFileSync(statePath, 'utf8')) : null;
if (appsHashBefore !== appsHashAfter) drift.push('applications.md CHANGED');
if (stateHashBefore !== stateHashAfter) drift.push('dashboard-state.json CHANGED');

// after 统计 = 全部 analyzed entry 按处理后值直接判定（见循环内），无公式推导
console.log(`field scope: ${FIELD}`);
console.log(`files written: ${stats.files}`);
console.log(`analyzed jobs seen: ${stats.jobsSeen}, touched: ${stats.jobsTouched}`);
console.log(`cv_advice:        before complete=${stats.cvBefore}  after complete=${stats.cvAfter}  remaining=${stats.jobsSeen - stats.cvAfter}`);
console.log(`interview_focus:  before complete=${stats.ivBefore}  after complete=${stats.ivAfter}  remaining=${stats.jobsSeen - stats.ivAfter}`);
console.log(`drift: ${drift.length}`);
drift.slice(0, 20).forEach(d => console.error('  DRIFT:', d));
if (drift.length) process.exit(1);
