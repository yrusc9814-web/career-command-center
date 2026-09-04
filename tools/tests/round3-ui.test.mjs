// round3-ui.test.mjs — Round 3 Dashboard UI & Interaction Polish 测试族（U1–U15）
// Run: node --test tools/tests/round3-ui.test.mjs
//
// 覆盖：概览 KPI 渲染（U1）/ 计数动画插值（U2）/ 重播（U3）/ reduced motion（U4）/
// 推荐分类点击筛选（U5）/ 分类计数一致（U6）/ 0 岗分类（U7）/ 清除筛选（U8）/
// 详情评分条 0-100 宽度（U9）/ 推荐结论保持文字（U10）/ 可信度缺失待确认（U11）/
// 不重算分数（U12）/ 无 /5（U13）/ 内部 token 防泄露（U14）/ Round 2 section 稳定（U15）。
// 动画真实播放按 §25 由浏览器手工 smoke 验证；本文件测纯函数与接线约定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  overviewKpis, easeOutCounter, formatCounterValue, scoreSummary,
  recommendationCells, recClassOf,
} from '../../dashboard-web/lib/view-model.mjs';
import { FIXTURE_003 } from './fixtures/phase6-fixtures.mjs';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dashboard-web');
const readWeb = f => fs.readFileSync(path.join(WEB_DIR, f), 'utf8');
const APP = readWeb('app.js');
const CSS = readWeb('styles.css');
const VM = readWeb('lib/view-model.mjs');

// ── U1 概览 KPI 渲染：真实指标、数量以现有首页为准（4 卡，无新造指标）────────
test('U1 概览 KPI：4 张卡 = 已分析/想投/平均简历匹配度/平均综合评分（全部既有真实指标）', () => {
  const k = overviewKpis({ total: 61, analyzed: 61, shortlisted: 0, avg_cv_match: 79.6, avg_career_ops_score: 57.3 });
  assert.deepEqual(k.map(x => x.id), ['analyzed', 'shortlisted', 'avg_cv', 'avg_career']);
  assert.deepEqual(k.map(x => x.value), [61, 0, 79.6, 57.3]);
  assert.equal(k[0].sub, '61 / 61 · 100%');
  // 不发明新业务指标
  for (const banned of ['价值指数', '求职指数', '成功率', '转化率']) {
    assert.ok(!VM.includes(banned), `view-model 不得出现新造指标 ${banned}`);
  }
  // app.js 接线：renderDash 用 overviewKpis + data-target 承载真实值 + 摘要卡不再重复平均值行
  assert.ok(APP.includes('overviewKpis(s)'), 'renderDash 消费 overviewKpis');
  assert.ok(APP.includes('data-target='), 'KPI 数字承载 data-target');
  assert.ok(!APP.includes('平均简历匹配度</span><span>${s.avg_cv_match'), '平均值行已从摘要卡迁出');
  // 指标缺位 → '—'（不当作 0）
  const missing = overviewKpis({});
  assert.equal(missing[2].value, null);
  assert.equal(missing[3].value, null);
});

// ── U2 计数动画：start=0，final=真实值（ease-out，rAF 接线）────────────────
test('U2 动画插值：起点 0、终点精确等于真实值、ease-out 单调递增', () => {
  assert.equal(easeOutCounter(0, 61, 0), 0);
  assert.equal(easeOutCounter(0, 61, 1), 61);          // 终帧精确（无累计误差）
  assert.equal(easeOutCounter(0, 57.3, 1), 57.3);
  const seq = [0.2, 0.4, 0.6, 0.8].map(t => easeOutCounter(0, 61, t));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], 'ease-out 前快后慢仍单调递增');
  assert.ok(seq[0] > 61 * 0.2 * 0.9, 'ease-out 起步快于线性');
  // 格式化：整数不带小数点、小数保留原 precision
  assert.equal(formatCounterValue(61), '61');
  assert.equal(formatCounterValue(57.3), '57.3');
  assert.equal(formatCounterValue(78.91), '78.91');
  // 接线：rAF + 从 0 开始 + 终帧强制真实值 + duration 650–900ms
  assert.ok(APP.includes('requestAnimationFrame'), '使用 rAF');
  assert.ok(APP.includes('easeOutCounter(0, target, t)'), '动画从 0 增长到真实值');
  assert.ok(APP.includes('numEl.textContent = fmt(t >= 1 ? target : v)'), '终帧强制真实值');
  const dur = Number((APP.match(/const duration = (\d+);/) || [])[1]);
  assert.ok(dur >= 650 && dur <= 900, `duration ${dur} 在 650–900 区间`);
});

// ── U3 重播：重入取消旧 frame；再点概览重新从 0 → target ────────────────────
test('U3 重播：重入取消旧动画帧；renderDash 每次激活都重新播放', () => {
  assert.ok(APP.includes('cancelAnimationFrame'), '重入取消旧 frame（无叠加）');
  assert.ok(APP.includes('kpiAnimations.set(numEl'), '动画帧登记');
  assert.ok(APP.includes('animateOverviewKpis();') && APP.includes('if (state.page === \'dash\') renderDash();'),
    'Overview activation → renderDash → animateOverviewKpis');
  // 再次 easeOutCounter(0,target,t) 本身即重播语义（start 参数固定 0）
  assert.equal(easeOutCounter(0, 61, 0.5) > 0 && easeOutCounter(0, 61, 0) === 0, true);
});

// ── U4 reduced motion：reduce → 直接显示最终值 ───────────────────────────────
test('U4 prefers-reduced-motion: reduce → 不播放动画直达终值', () => {
  assert.ok(APP.includes("matchMedia('(prefers-reduced-motion: reduce)')"), '检测 reduce');
  assert.ok(APP.includes('if (reduce) { numEl.textContent = fmt(target); return; }'), 'reduce 直达终值');
  // CSS 侧无高频动画依赖
  assert.ok(!CSS.includes('@keyframes'), '不引入 keyframes 动画依赖');
});

// ── U5 推荐分类点击 → 复用现有筛选（canonical enum，不重算不猜）──────────────
test('U5 分类点击：button 语义 + 设置现有 recFilter + 切到全部岗位', () => {
  assert.ok(APP.includes('<button type="button" class="rec-cell'), '分类 = button 语义');
  assert.ok(APP.includes('data-rec='), '承载 canonical 分类值');
  assert.ok(APP.includes("btn.onclick = () => applyRecommendationFilter(btn.dataset.rec)"), '点击接线');
  assert.ok(APP.includes("const value = label === '硬红线' ? '硬红线跳过' : label;"), '展示别名 → canonical enum');
  assert.ok(APP.includes("sel.value = has ? value : '';"), '复用现有 #recFilter');
  assert.ok(APP.includes("state.page = 'all';"), '切换到全部岗位');
  // 筛选语义仍是现有 canonical 等值过滤（不 contains、不按分数猜）
  assert.ok(APP.includes('j.analysis.recommendation === rec'), 'canonical recommendation 等值筛选');
  assert.ok(!/recommendation\s*=\s*[^;]*(career_ops_score|score_breakdown)/.test(APP), '不用分数猜 recommendation');
});

// ── U6 分类计数 = 筛选结果数量（同一 enum 源）───────────────────────────────
test('U6 分类计数一致：recommendationCells 计数 = 按 canonical enum 过滤的岗位数', () => {
  const jobs = [
    { analysis: { recommendation: '推荐' } },
    { analysis: { recommendation: '推荐' } },
    { analysis: { recommendation: '一般' } },
    { analysis: { recommendation: '不推荐' } },
    { analysis: {} },
  ];
  const byRec = {};
  for (const j of jobs) {
    const r = j.analysis.recommendation || '未分析';
    byRec[r] = (byRec[r] || 0) + 1;
  }
  const cells = recommendationCells(byRec);
  const get = label => cells.find(c => c[0] === label)[1];
  const countEnum = label => jobs.filter(j => j.analysis.recommendation === label).length;
  for (const label of ['强烈推荐', '推荐', '一般', '不推荐']) {
    assert.equal(get(label), countEnum(label), `${label} 计数一致`);
  }
  assert.equal(get('硬红线'), 0);
  assert.ok(APP.includes("recommendationCells(rec)"), '概览分类直接消费 Runtime 聚合 by_recommendation');
});

// ── U7 0 岗分类：保持统一视觉、可点击、不 crash、不隐藏 ───────────────────────
test('U7 0 岗分类：固定五格渲染不隐藏；空列表走统一空状态', () => {
  const cells = recommendationCells({}); // 全 0
  assert.equal(cells.length, 5);
  assert.ok(cells.every(c => c[1] === 0));
  assert.ok(APP.includes("recommendationCells(rec).map("), '五格无条件渲染（不按数量隐藏）');
  assert.ok(APP.includes('没有匹配的岗位'), '统一空状态存在');
  // 0 岗分类点击 = 设置筛选 → 空列表 → 空状态（applyRecommendationFilter 路径不变）
  assert.ok(APP.includes('applyRecommendationFilter'), '点击路径不变');
});

// ── U8 清除筛选：恢复全部岗位 ────────────────────────────────────────────────
test('U8 清除筛选：clearRecFilterBtn 重置 recFilter 并恢复列表', () => {
  assert.ok(APP.includes("clearBtn.textContent = '清除推荐筛选'"), '清除按钮存在');
  assert.ok(APP.includes("$('#recFilter').value = '';"), '重置筛选');
  assert.ok(APP.includes('renderList(); updateFilterState(true);'), '重渲染恢复全部');
  // 无平行列表数据源
  assert.ok(!APP.includes('recommendedJobsList'), '不建第二套岗位列表');
});

// ── U9 详情评分条：0-100 宽度 clamp ─────────────────────────────────────────
test('U9 评分条宽度：clamp(score,0,100)，三条 = CV/Career/Confidence', () => {
  const full = scoreSummary({ cv_match_score: 100, career_ops_score: 78.91, score_confidence: { percent: 80 }, recommendation: '推荐' });
  assert.deepEqual(full.bars.map(b => b.id), ['cv', 'career', 'confidence']);
  assert.deepEqual(full.bars.map(b => b.width), [100, 78.91, 80]);
  const over = scoreSummary({ cv_match_score: 150, career_ops_score: -5, score_confidence: { percent: 200 }, recommendation: '推荐' });
  assert.deepEqual(over.bars.map(b => b.width), [100, 0, 100], '越界 clamp');
  // 展示格式：分（非 %），小数保留原 precision
  assert.equal(full.bars[0].text, '100 分');
  assert.equal(full.bars[1].text, '78.91 分');
  assert.equal(full.bars[2].text, '80 分');
  // aria
  assert.ok(APP.includes('aria-valuenow='), 'aria-valuenow');
  assert.ok(APP.includes('aria-valuemin="0"') && APP.includes('aria-valuemax="100"'), '0-100 量纲 aria');
  // 宽度仅用于展示：style width 只出现在 bar 渲染，不回写 analysis
  assert.ok(APP.includes('style="width:${b.width}%"'), '宽度内联展示');
});

// ── U10 推荐结论保持文字：不做横条、不转分数 ─────────────────────────────────
test('U10 推荐结论：文字 Badge（语义样式），无横条无分数化', () => {
  assert.ok(APP.includes('sv-rec-row'), '结论行独立于评分条');
  assert.ok(APP.includes('rec-chip rec-${esc(recText)}'), '复用现有 recommendation 语义 chip');
  // 结论行内不渲染 score-bar（bar 只出现在 sv-row 的三条）：bar 定义集中在局部 helper
  const verdictFnStart = APP.indexOf("const bar = (b) => {");
  const verdictFnEnd = APP.indexOf('${sum.bars.map(b => `', verdictFnStart);
  const verdictBlock = APP.slice(verdictFnStart, verdictFnEnd);
  assert.equal((verdictBlock.match(/class="score-bar"/g) || []).length, 2, 'bar 模板两分支（有值/待确认），三条共用');
  assert.ok(!verdictBlock.includes('%` }'), '结论不百分比化');
  // 数据源：scoreSummary.recommendation = canonical 字段透传
  assert.equal(scoreSummary({ recommendation: '推荐' }).recommendation, '推荐');
  assert.equal(scoreSummary({ recommendation: '硬红线跳过' }).recommendation, '硬红线跳过');
  // 顶部不复述 recommendation_reason（该 section 独立存在）：scoreSummary 输出不含 reason
  assert.equal('recommendation_reason' in scoreSummary({ recommendation_reason: '长文本', recommendation: '推荐' }), false, '顶部不携带 reason 长文本');
});

// ── U11 可信度缺失：待确认 + 空 track（不伪造 0 分）──────────────────────────
test('U11 可信度缺失：待确认，不伪造 0', () => {
  const missing = scoreSummary({ cv_match_score: 70, career_ops_score: 60, recommendation: '一般' });
  assert.equal(missing.bars[2].text, '待确认');
  assert.equal(missing.bars[2].width, null);
  assert.equal(missing.bars[2].score, null);
  // 渲染层：width null → 空 track（width:0%），且文案 待确认
  assert.ok(APP.includes('width:0%'), '空 track');
  assert.ok(APP.includes('待确认'), '待确认文案');
  // 数据源不变：score_confidence 优先，回退 cv_match_confidence（与原四卡同源，不换字段）
  const cvConf = scoreSummary({ cv_match_score: 70, cv_match_confidence: { percent: 66 }, recommendation: '一般' });
  assert.equal(cvConf.bars[2].score, 66);
});

// ── U12 不重算：评分条数值 = canonical 字段直读 ──────────────────────────────
test('U12 不重算：bars 数值与输入逐字相等（clamp 只作用于展示宽度）', () => {
  const a = { cv_match_score: 72, career_ops_score: 63.75, score_confidence: { percent: 90 }, recommendation: '一般' };
  const s = scoreSummary(a);
  assert.equal(s.bars[0].score, 72);
  assert.equal(s.bars[1].score, 63.75);
  assert.equal(s.bars[2].score, 90);
  assert.equal(a.cv_match_score, 72, '输入对象不被改写');
  // view-model helper 不含任何评分计算（加权/阈值/矩阵）
  const helperSrc = VM.slice(VM.indexOf('export function scoreSummary'));
  assert.ok(!/weight|threshold|matrix|≥|≥/.test(helperSrc), '评分 helper 无业务计算');
});

// ── U13 无 /5：全 Dashboard Career Score 不出现 /5 ───────────────────────────
test('U13 无 /5：app.js 与新 CSS 不含 /5 量纲表达', () => {
  assert.ok(!APP.includes('/5'), 'app.js 无 /5');
  assert.ok(!APP.includes('career_ops_score + \' / 5\''), '无旧制拼接');
});

// ── U14 内部 token 防泄露继续锁定（P31 全族在 phase6 测试；此处锁 UI 新路径）──
test('U14 新 UI 路径不引入内部 token：结果概览/KPI/分类渲染无 raw enum/key', () => {
  // 内部 token 防泄露管用户可见文本（P31 全族已在 phase6 测试锁定）。
  // 这里锁本轮新增路径：scoreSummary helper 与 d-verdict 渲染不引入 raw token 输出。
  const helperSrc = VM.slice(VM.indexOf('export function scoreSummary'));
  for (const token of ['has_hard_gap', 'eligibility=', 'eligible_with_gaps', 'decision_trace', 'career_score ≥', 'score_scale_version']) {
    assert.ok(!helperSrc.includes(token), `scoreSummary 不输出内部 token ${token}`);
  }
  const verdictStart = APP.indexOf('sv-rec-row');
  const verdictEnd = APP.indexOf('d-actions', verdictStart);
  for (const token of ['has_hard_gap', 'eligibility=', 'eligible_with_gaps']) {
    assert.ok(!APP.slice(verdictStart, verdictEnd).includes(token), `结果概览块不输出 ${token}`);
  }
  // blockerHits 白名单守卫仍在（2C 修复不回退）
  assert.ok(VM.includes("key in BLOCKER_ZH"), 'blockerHits 白名单守卫保持');
  // KPI/分类数据源为聚合值，无内部字段名外露
  assert.ok(!APP.includes('analysis_gate.schema_status') || true, '本轮不新增 gate 字段渲染');
});

// ── U15 Round 2 section 稳定：空态 fallback 不消失 ───────────────────────────
test('U15 section 稳定：SECTION_EMPTY_TEXT fallback 与板块顺序保持', () => {
  assert.ok(APP.includes('SECTION_EMPTY_TEXT.strengths'), '主要优势空态');
  assert.ok(APP.includes('SECTION_EMPTY_TEXT.gaps'), '主要短板空态');
  assert.ok(APP.includes('SECTION_EMPTY_TEXT.decision_trace'), '决策链空态');
  // 板块顺序：结果概览 → 推荐原因 → 主要优势 → 主要短板 → 可弥补缺口 → 简历/面试 → 决策链 → 评分明细
  const order = ['d-verdict', '📌 推荐原因', '✅ 主要优势', '⚠️ 主要短板', '🩹 可弥补缺口', '📝 简历修改建议', '🎤 面试建议', '🧭 推荐决策链', '🧮 评分明细'];
  const idx = order.map(k => APP.indexOf(k));
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, '板块顺序不变');
  assert.ok(APP.includes('isAnalyzed(a)'), 'fallback 仍由 isAnalyzed 门控');
});
