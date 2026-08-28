// scoring.mjs — Career Ops 评分引擎（纯函数，可单测）
//
// 修复上游 115% 权重问题：10 维权重总和 = 115，统一使用归一化：
//   career_ops_score = Σ(score_i × weight_i) / Σ(valid_weight_i)
// unknown 维度（score=null）不进入分母，输出 score_confidence = effective/total。
// Dashboard 只展示本引擎的结果，不自行计算。

export const DIMENSIONS = [
  { key: 'north_star',     name: '北极星对齐',           weight: 25 },
  { key: 'cv_match',       name: 'CV匹配',               weight: 15 },
  { key: 'level',          name: '级别',                 weight: 15 },
  { key: 'comp',           name: 'Comp（含工时折算）',    weight: 15 },
  { key: 'growth',         name: '成长路径',             weight: 10 },
  { key: 'worklife',       name: '工时与生活',           weight: 10 },
  { key: 'stability',      name: '公司稳定性',           weight: 10 },
  { key: 'tech_modernity', name: '技术栈现代度',         weight: 5 },
  { key: 'process_speed',  name: '流程速度',             weight: 5 },
  { key: 'culture',        name: '文化信号',             weight: 5 },
];

export const TOTAL_WEIGHT = DIMENSIONS.reduce((s, d) => s + d.weight, 0); // 115

export const RECOMMENDATION_LEVELS = ['强烈推荐', '推荐', '一般', '不推荐', '硬红线跳过'];

const round = (v, n) => {
  const p = 10 ** n;
  return Math.round(v * p) / p;
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function validScore(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;          // NaN/Infinity/非数字 → unknown
  return clamp(Math.round(n * 100) / 100, 1, 5); // 有限数值夹到 [1,5]，null 永不变 0
}

/**
 * @param {Array<{key:string,score:number|null,reason?:string,evidence?:string}>|Object} dimInputs
 *   按 key 索引或数组；score=null / 缺失 / 非有限值 → unknown，不入分母。
 */
export function computeScore(dimInputs) {
  const byKey = new Map(
    (Array.isArray(dimInputs) ? dimInputs : []).map(d => [d.key, d])
  );

  let weightedSum = 0;
  let effectiveWeight = 0;
  const dims = DIMENSIONS.map(({ key, name, weight }) => {
    const input = byKey.get(key) || {};
    const score = validScore(input.score);
    const known = score !== null;
    if (known) {
      weightedSum += score * weight;
      effectiveWeight += weight;
    }
    return {
      key, name, weight,
      score: known ? score : null,
      weighted_value: known ? round(score * weight, 2) : null,
      status: known ? 'known' : 'unknown',
      reason: input.reason || null,
      evidence: input.evidence || null,
    };
  });

  const careerOpsScore = effectiveWeight > 0
    ? clamp(round(weightedSum / effectiveWeight, 2), 1, 5)
    : null;

  const percent = round((effectiveWeight / TOTAL_WEIGHT) * 100, 1);
  const confidenceLevel = percent >= 85 ? '高' : percent >= 60 ? '中' : '低';

  return {
    career_ops_score: careerOpsScore,
    score_confidence: { percent, level: confidenceLevel },
    score_breakdown: {
      total_weight: TOTAL_WEIGHT,
      effective_weight: effectiveWeight,
      weighted_sum: round(weightedSum, 2),
      dimensions: dims,
    },
  };
}

/** 分数档位（仅当无 blocker 时作为 Recommendation 基础档） */
export function scoreBand(score) {
  if (score === null || score === undefined) return '不推荐';
  if (score >= 4.5) return '强烈推荐';
  if (score >= 4.0) return '推荐';
  if (score >= 3.0) return '一般';
  return '不推荐';
}

/**
 * Recommendation 独立于分数：综合 评分 + 硬红线 + 现任雇主冲突 + 薪资底线
 * + 严重级别倒退 + deal_breakers。高分手动 blocker 不会被覆盖。
 *
 * @param {object} input
 * @returns {{recommendation:string, recommendation_reason:string}}
 */
export function computeRecommendation(input = {}) {
  const {
    career_ops_score = null,
    hard_redline = false,
    redline_reason = '',
    deal_breakers_hit = false,
    current_employer_conflict = false,
    salary_floor_breach = false,
    severe_level_downgrade = false,
    extra_reason = '',
  } = input;

  const band = scoreBand(career_ops_score);
  const scoreText = career_ops_score === null
    ? '有效维度不足，无法给出可信分数'
    : `Career Ops Score ${career_ops_score}/5`;

  const parts = [];
  let recommendation;

  if (hard_redline || deal_breakers_hit) {
    recommendation = '硬红线跳过';
    parts.push(`命中硬红线/deal_breakers${redline_reason ? `：${redline_reason}` : ''}`);
  } else if (current_employer_conflict) {
    recommendation = '不推荐';
    parts.push(`现任雇主/关联主体岗位，不构成外部跳槽机会（${scoreText}）`);
  } else if (salary_floor_breach) {
    recommendation = '不推荐';
    parts.push(`低于候选人薪资底线（${scoreText}）`);
  } else if (severe_level_downgrade) {
    recommendation = '不推荐';
    parts.push(`职级严重倒退（${scoreText}）`);
  } else {
    recommendation = band;
    parts.push(scoreText);
  }

  if (extra_reason) parts.push(extra_reason);

  return { recommendation, recommendation_reason: parts.join('；') };
}

/**
 * 一步完成：dimensions → score + confidence + breakdown + recommendation
 */
export function evaluate(dimInputs, recommendationInput = {}) {
  const s = computeScore(dimInputs);
  const r = computeRecommendation({ career_ops_score: s.career_ops_score, ...recommendationInput });
  return { ...s, ...r };
}
