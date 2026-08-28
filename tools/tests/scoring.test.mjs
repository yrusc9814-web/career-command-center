// scoring.test.mjs — 评分引擎单元测试（node --test）
// Run: node --test tools/tests/scoring.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIMENSIONS, TOTAL_WEIGHT,
  computeScore, computeRecommendation, scoreBand, evaluate,
} from '../lib/scoring.mjs';

const allDims = (score) => DIMENSIONS.map(d => ({ key: d.key, score }));

test('T1 全维度 5 分 → 5.0，置信度 100%/高', () => {
  const r = computeScore(allDims(5));
  assert.equal(r.career_ops_score, 5.0);
  assert.equal(r.score_breakdown.effective_weight, 115);
  assert.deepEqual(r.score_confidence, { percent: 100, level: '高' });
});

test('T2 全维度 1 分 → 1.0', () => {
  const r = computeScore(allDims(1));
  assert.equal(r.career_ops_score, 1.0);
});

test('T3 115 权重正确归一化（异构分数手算校验）', () => {
  // north_star=5(25) cv=3(15) level=4(15) 其余全 4（权重 10*3+5*3+15? 明确列出）
  const inputs = [
    { key: 'north_star', score: 5 },      // 125
    { key: 'cv_match', score: 3 },        // 45
    { key: 'level', score: 4 },           // 60
    { key: 'comp', score: 2 },            // 30
    { key: 'growth', score: 4 },          // 40
    { key: 'worklife', score: 5 },        // 50
    { key: 'stability', score: 3 },       // 30
    { key: 'tech_modernity', score: 4 },  // 20
    { key: 'process_speed', score: 2 },   // 10
    { key: 'culture', score: 1 },         // 5
  ];
  const r = computeScore(inputs);
  // Σ=415 / 115 = 3.6086… → 3.61
  assert.equal(r.career_ops_score, 3.61);
  assert.equal(r.score_breakdown.weighted_sum, 415);
  assert.equal(r.score_breakdown.effective_weight, 115);
});

test('T4 unknown 维度按有效权重归一化（9 维 5 分 + 1 维 unknown → 仍 5.0）', () => {
  const inputs = allDims(5).map(d =>
    d.key === 'process_speed' ? { ...d, score: null, reason: '无证据' } : d
  );
  const r = computeScore(inputs);
  assert.equal(r.career_ops_score, 5.0);
  assert.equal(r.score_breakdown.effective_weight, 110);
  assert.equal(r.score_breakdown.total_weight, 115);
  const ps = r.score_breakdown.dimensions.find(d => d.key === 'process_speed');
  assert.equal(ps.status, 'unknown');
  assert.equal(ps.score, null);
  assert.equal(ps.weighted_value, null);
  assert.equal(r.score_confidence.percent, 95.7);
  assert.equal(r.score_confidence.level, '高');
});

test('T5 null 不变成 0（unknown 不贡献 weighted_value，总分不被拉向 0）', () => {
  const inputs = [
    { key: 'north_star', score: 5 },
    { key: 'cv_match', score: null },
    { key: 'level', score: null },
  ];
  const r = computeScore(inputs);
  assert.equal(r.career_ops_score, 5.0); // 若 null 变 0 会是 125/155*?=… ≠5
  assert.equal(r.score_breakdown.effective_weight, 25);
  assert.equal(r.score_confidence.percent, 21.7);
  assert.equal(r.score_confidence.level, '低');
});

test('T6 输出恒在 [1,5] 且有限（NaN/Infinity/越界/字符串输入不炸）', () => {
  const inputs = [
    { key: 'north_star', score: 7 },        // 越界 → clamp 5
    { key: 'cv_match', score: 0 },          // <1 → clamp 1
    { key: 'level', score: NaN },           // unknown
    { key: 'comp', score: Infinity },       // unknown
    { key: 'growth', score: 'abc' },        // unknown
    { key: 'worklife', score: -3 },         // clamp 1
  ];
  const r = computeScore(inputs);
  assert.ok(Number.isFinite(r.career_ops_score));
  assert.ok(r.career_ops_score >= 1 && r.career_ops_score <= 5);
  for (const d of r.score_breakdown.dimensions) {
    if (d.status === 'known') {
      assert.ok(d.score >= 1 && d.score <= 5, `dim ${d.key} score in range`);
      assert.ok(Number.isFinite(d.weighted_value));
    } else {
      assert.equal(d.weighted_value, null);
    }
  }
  // 5(25) + 1(15) + 1(10) = 150 / 50 = 3.0
  assert.equal(r.career_ops_score, 3.0);
});

test('T7 三指标严格独立（字段不混用）', () => {
  const r = evaluate(
    allDims(4.2),
    { current_employer_conflict: true }
  );
  // cv_match_score 是调用方独立保存的字段，不参与分数计算
  assert.equal(r.career_ops_score, 4.2);
  assert.equal(r.recommendation, '不推荐'); // 分数高也被冲突 blocker 覆盖
  assert.ok('cv_match_score' in r === false);
  assert.ok(r.score_breakdown.dimensions.length === 10);
});

test('T8 confidence 分档（>=85 高 / 60-84 中 / <60 低）', () => {
  // 100/115 = 87.0% → 高
  const hi = computeScore(allDims(4));
  assert.equal(hi.score_confidence.level, '高');
  // 80/115 = 69.6% → 中
  const inputsMid = allDims(4).filter(d => !['tech_modernity', 'process_speed', 'culture', 'north_star'].includes(d.key));
  // 有效权重 = 115 - 25 - 5*3 = 75? 不对：north_star(25)+tech(5)+process(5)+culture(5)=40 → 75/115=65.2% 中
  const mid = computeScore(inputsMid);
  assert.equal(mid.score_breakdown.effective_weight, 75);
  assert.equal(mid.score_confidence.percent, 65.2);
  assert.equal(mid.score_confidence.level, '中');
  // 10/115 = 8.7% → 低
  const lo = computeScore([{ key: 'growth', score: 4 }]);
  assert.equal(lo.score_confidence.level, '低');
  // 全 unknown → score null，confidence 0/低
  const none = computeScore([]);
  assert.equal(none.career_ops_score, null);
  assert.deepEqual(none.score_confidence, { percent: 0, level: '低' });
});

test('T9 blocker 不被高分覆盖（四类 blocker 优先级）', () => {
  const high = allDims(4.9);
  assert.equal(computeRecommendation({ career_ops_score: 4.9, hard_redline: true, redline_reason: '劳务派遣' }).recommendation, '硬红线跳过');
  assert.equal(computeRecommendation({ career_ops_score: 4.9, deal_breakers_hit: true }).recommendation, '硬红线跳过');
  assert.equal(computeRecommendation({ career_ops_score: 4.8, current_employer_conflict: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.7, salary_floor_breach: true }).recommendation, '不推荐');
  assert.equal(computeRecommendation({ career_ops_score: 4.6, severe_level_downgrade: true }).recommendation, '不推荐');
  // 无 blocker → 按分数档位
  const r = evaluate(high);
  assert.equal(r.recommendation, '强烈推荐');
  assert.equal(scoreBand(4.2), '推荐');
  assert.equal(scoreBand(3.5), '一般');
  assert.equal(scoreBand(2.9), '不推荐');
  assert.equal(scoreBand(null), '不推荐');
});
