// round3-ui.test.mjs — Round 3 展示层契约（U1–U15）
// Run: node --test tools/tests/round3-ui.test.mjs
//
// 2026-09-12 UI 替换说明：
//   驾驶舱前端已整体替换为成品单文件 UI（dashboard-web/index.html，HTML+CSS+JS 全内联）；
//   旧 app.js / styles.css 已随本次 UI 替换删除（曾短暂备份为 app-old.js / styles-old.css，
//   现已连同未被任何入口引用的 landing.html 一并清理）。品牌首页恢复为原成品入口，部署为
//   dashboard-web/home.html（server 根路径 / 返回它），驾驶舱仍是 dashboard-web/index.html。
//   本文件因此做两类处理，且不保留“对着已删除文件断言”的空测试：
//     1) 与实现无关的展示层纯函数契约（view-model / analysis-contract）→ 原样保留；
//     2) 原先写在旧 app.js 源码字符串上的锁 → 改为锁新 UI 的等价契约
//        （KPI 四项与真实值绑定、滚轮起点/终点、分类点击复位、评分条宽度绑定、无 /5、内部 token 不外漏）。
//   旧 U4（prefers-reduced-motion 直达终值）在成品 UI 中没有对应实现（滚轮用 CSS transition，
//   未做 reduce 分支），属于已知差异，记录在交付报告里，不在这里断言不存在的功能。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  overviewKpis, easeOutCounter, formatCounterValue, scoreSummary,
  recommendationCells, recClassOf,
} from '../../dashboard-web/lib/view-model.mjs';

const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dashboard-web');
const readWeb = f => fs.readFileSync(path.join(WEB_DIR, f), 'utf8');
const VM = readWeb('lib/view-model.mjs');
// 新 UI：单文件（旧 APP / CSS 两个变量的职责都由它承担）
const UI = readWeb('index.html');

// ── U1 概览 KPI：4 项指标口径固定 + 新 UI 绑定真实值（不写死均值）─────────────
test('U1 概览 KPI：4 项 = 已分析/想投/平均简历匹配度/平均综合评分（不新造指标，不写死均值）', () => {
  const k = overviewKpis({ total: 61, analyzed: 61, shortlisted: 0, avg_cv_match: 79.6, avg_career_ops_score: 57.3 });
  assert.deepEqual(k.map(x => x.id), ['analyzed', 'shortlisted', 'avg_cv', 'avg_career']);
  assert.deepEqual(k.map(x => x.value), [61, 0, 79.6, 57.3]);
  assert.equal(k[0].sub, '61 / 61 · 100%');
  // 不发明新业务指标
  for (const banned of ['价值指数', '求职指数', '成功率', '转化率']) {
    assert.ok(!VM.includes(banned), `view-model 不得出现新造指标 ${banned}`);
    assert.ok(!UI.includes(banned), `成品 UI 不得出现新造指标 ${banned}`);
  }
  // 指标缺位 → null（不当作 0）
  const missing = overviewKpis({});
  assert.equal(missing[2].value, null);
  assert.equal(missing[3].value, null);
  // 新 UI：4 个 KPI 数字位 + 平均值来自聚合层 stats（旧成品写死的 78.6 / 76.5 必须已清除）
  for (const id of ['k-num-analyzed', 'k-num-shortlist', 'k-num-cv', 'k-num-ops']) {
    assert.ok(UI.includes(`id="${id}"`), `KPI 数字位 ${id} 存在`);
  }
  assert.ok(!UI.includes("const valCv = '") && !UI.includes("const valOps = '"), '平均 CV / Career 不得再写死字面量');
  assert.ok(UI.includes('avg_cv_match') && UI.includes('avg_career_ops_score'), 'KPI 消费 /api/state 的真实均值');
});

// ── U2 计数动画：起点 0、终点精确等于真实值（新 UI = 垂直滚轮归零后滑到目标位）──
test('U2 动画起点/终点：插值终帧精确等于真实值；新 UI 滚轮先归零再滑到目标数字', () => {
  assert.equal(easeOutCounter(0, 61, 0), 0);
  assert.equal(easeOutCounter(0, 61, 1), 61);          // 终帧精确（无累计误差）
  assert.equal(easeOutCounter(0, 57.3, 1), 57.3);
  const seq = [0.2, 0.4, 0.6, 0.8].map(t => easeOutCounter(0, 61, t));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] > seq[i - 1], 'ease-out 前快后慢仍单调递增');
  assert.equal(formatCounterValue(61), '61');
  assert.equal(formatCounterValue(57.3), '57.3');
  assert.equal(formatCounterValue(78.91), '78.91');
  // 新 UI 滚轮：目标数字写在 data-target，先把 strip 归零，再 transition 到位移目标
  assert.ok(UI.includes('data-target="${char}"'), '每一位数字的目标值来自被展示的真实值');
  assert.ok(UI.includes("s.style.transform = 'translateY(0)'"), '播放前强制归零（起点 0）');
  assert.ok(/translateY\(-\$\{targetDigit \* 1\.2\}em\)/.test(UI), '终点 = 目标数字所在位（不跳字、不漂移）');
});

// ── U3 重播：重入取消上一轮共享动画；概览每次激活都重放 ────────────────────────
test('U3 重播：重入先取消上一轮共享动画；概览激活即重放', () => {
  // KPI 动画已改为共享协调器（单一 rAF loop / startTime / duration / easing）：
  // 重入语义 = 取消上一轮共享循环，从零重排，不叠加。
  assert.ok(UI.includes('if (KPI_ANIM.rafId) cancelAnimationFrame(KPI_ANIM.rafId);'), '重入取消上一轮共享循环（不叠加）');
  assert.ok(/if \(mode === 'dash'\)[\s\S]*?renderDash\(\);/.test(UI), '概览激活 → renderDash（内部重新驱动全部滚轮）');
  // 再次从 0 起算本身即重播语义
  assert.equal(easeOutCounter(0, 61, 0), 0);
});

// ── U3b KPI 动画共享协调器：两排同帧开始 / 同 duration / 同 easing / 同时结束 ──
test('U3b KPI 动画同步：单一共享协调器，无 per-card timer/delay/duration', () => {
  // 单一 rAF loop + 单一 startTime + 单一 duration + 单一 easing
  assert.ok(UI.includes('const KPI_ANIM = {'), '共享协调器对象存在');
  assert.ok(/requestAnimationFrame\(tick\)/.test(UI), '动画由单一 requestAnimationFrame loop 驱动');
  assert.ok(/const start = performance\.now\(\);/.test(UI), '所有注册条目共用同一 startTime');
  assert.ok(/const duration = KPI_ANIM\.duration;/.test(UI), '所有注册条目共用同一 duration');
  assert.ok(UI.includes('function kpiEase(t)'), '共享 easing 函数唯一');
  assert.ok(UI.includes('kpiAnimStart();'), 'renderDash 注册完毕后统一开跑（同一帧开始）');
  // 每个条目只允许 target value 不同：rollOdometer 不再接收 per-call duration/delay
  assert.ok(!/rollOdometer\([^)]+,\s*\d+\s*,\s*\d+\)/.test(UI), '不再有 per-card duration/delay 参数');
  assert.ok(!/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?ticker-strip/.test(UI), '不再有 per-card setTimeout 动画 timer');
  // prefers-reduced-motion：开启后直接显示最终值
  assert.ok(UI.includes("window.matchMedia('(prefers-reduced-motion: reduce)')"), 'reduce 模式检测存在');
  assert.ok(UI.includes('kpiApplyStrips(strips, 1)'), 'reduce 模式直接落到最终值');
});

// ── U5 分类点击：data-rec 承载 canonical 值，点击后写入现有筛选并切到全部岗位 ──
test('U5 分类点击：canonical 分类值 → 现有 rec-filter → 全部岗位（不用分数猜推荐）', () => {
  assert.ok(UI.includes('class="rec-cell-btn" data-rec="强烈推荐"'), '分类格承载 canonical 推荐值');
  assert.ok(UI.includes("selectedRec = cell.dataset.rec;"), '点击即写入现有推荐筛选状态');
  assert.ok(UI.includes("document.getElementById('rec-filter').value = selectedRec;"), '筛选控件与状态同步');
  assert.ok(UI.includes("currentView = 'all';"), '点击后切到全部岗位');
  assert.ok(!/recommendation\s*=\s*[^;]*(career_ops_score|score_breakdown)/.test(UI), '不用分数反推 recommendation');
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
});

// ── U7 0 岗分类：固定五格渲染不隐藏；空列表走统一空状态 ──────────────────────
test('U7 0 岗分类：固定五格渲染不隐藏；空列表走统一空状态', () => {
  const cells = recommendationCells({}); // 全 0
  assert.equal(cells.length, 5);
  assert.ok(cells.every(c => c[1] === 0));
  assert.equal((UI.match(/class="rec-cell-btn"/g) || []).length, 5, '五格无条件渲染（不按数量隐藏）');
  assert.ok(UI.includes('当前筛选条件下没有匹配岗位'), '统一空状态存在');
  assert.ok(UI.includes("selectedRec = '';"), '清除筛选可回到全量（0 岗分类点击的退路）');
});

// ── U8 清除筛选：复位全部过滤状态并重渲染 ───────────────────────────────────
test('U8 清除筛选：#btn-clear-filters 重置全部过滤状态并恢复列表', () => {
  assert.ok(UI.includes("document.getElementById('btn-clear-filters').addEventListener('click'"), '清除按钮存在且接原生 click');
  for (const reset of ['selectedRec =', 'selectedDistrict =', 'selectedSalary =', 'selectedStatus =', 'isShortlistOnly =', 'searchKeyword =']) {
    assert.ok(UI.includes(reset + " '';") || UI.includes(reset + ' false;'), `清除时复位 ${reset.trim()}`);
  }
  assert.ok(!UI.includes('recommendedJobsList'), '不建第二套岗位列表');
});

// ── U9 详情评分条：0-100 宽度 clamp；新 UI 宽度只用于展示不回写数据 ──────────
test('U9 评分条宽度：clamp(score,0,100)，三条 = CV/Career/Confidence', () => {
  const full = scoreSummary({ cv_match_score: 100, career_ops_score: 78.91, score_confidence: { percent: 80 }, recommendation: '推荐' });
  assert.deepEqual(full.bars.map(b => b.id), ['cv', 'career', 'confidence']);
  assert.deepEqual(full.bars.map(b => b.width), [100, 78.91, 80]);
  const over = scoreSummary({ cv_match_score: 150, career_ops_score: -5, score_confidence: { percent: 200 }, recommendation: '推荐' });
  assert.deepEqual(over.bars.map(b => b.width), [100, 0, 100], '越界 clamp');
  assert.equal(full.bars[0].text, '100 分');
  assert.equal(full.bars[1].text, '78.91 分');
  assert.equal(full.bars[2].text, '80 分');
  // 新 UI：三根量规的宽度只由该岗位字段推导，数值文本与宽度同源；
  // 缺值保持缺值语义 —— 文本显示 —（不伪造 0 分），只有宽度在缺值时收到 0%（视觉空条）。
  assert.equal((UI.match(/class="mm-fill /g) || []).length, 3, '详情内恰好三根评分量规');
  assert.ok(UI.includes("const cvScore = Number.isFinite(job.cv_match_score) ? job.cv_match_score : null;"),
    'CV 数值直读 Runtime 字段，缺值为 null（不再 ?? 0 伪造 0 分）');
  assert.ok(UI.includes("document.getElementById('dt-cv-val').textContent = cvScore === null ? '—' : `${cvScore} 分`;"),
    'CV 缺值时数值文本显示 —');
  assert.ok(UI.includes("document.getElementById('dt-cv-bar').style.width = `${cvScore ?? 0}%`;"),
    'CV 宽度内联展示（缺值收到 0% 空条，不伪造长度）');
  assert.ok(UI.includes("const opsScore = Number.isFinite(job.career_ops_score) ? job.career_ops_score : null;"),
    'Career 数值直读 Runtime 字段，缺值为 null（不再 ?? 0 伪造 0 分）');
  assert.ok(UI.includes("document.getElementById('dt-ops-val').textContent = opsScore === null ? '—' : `${opsScore} 分`;"),
    'Career 缺值时数值文本显示 —');
  assert.ok(UI.includes("document.getElementById('dt-ops-bar').style.width = `${opsScore ?? 0}%`;"),
    'Career 宽度内联展示（缺值收到 0% 空条，不伪造长度）');
  assert.ok(UI.includes("const confScore = conf?.percent ?? null;"), 'Confidence 数值缺失时为 null（不再兜底写死 90%）');
  assert.ok(UI.includes("confScore === null ? '—' : `${confScore} 分`"), 'Confidence 缺失时数值文本显示 —');
  assert.ok(UI.includes("document.getElementById('dt-conf-bar').style.width = `${confScore ?? 0}%`;"), 'Confidence 宽度内联展示（缺失收到 0 不伪造长度）');
});

// ── U10 推荐结论保持文字：不做横条、不转分数 ─────────────────────────────────
test('U10 推荐结论：文字 Badge（语义样式），无横条无分数化', () => {
  assert.ok(UI.includes("recBadge.textContent = recMeta.label;"), '结论以文字渲染');
  assert.ok(UI.includes('vhc-rec-tag chip-rec'), '复用 recommendation 语义 chip 样式');
  assert.ok(UI.includes("recMeta.label"), '数据源 = canonical recommendation');
  // 结论看板标记区（HTML 侧，不是 CSS 规则）只有三根量规，结论本身是文字 chip
  // （动作操作条已并入标题右侧 .detail-head-actions，切片终点改为推荐原因卡片标记）
  const verdictMarkup = UI.slice(UI.indexOf('<div class="verdict-hero-card">'), UI.indexOf('<!-- 正文 3'));
  assert.ok(verdictMarkup.length > 100, '定位到结论看板标记');
  assert.equal((verdictMarkup.match(/class="mm-fill /g) || []).length, 3, '结论看板内只有三根量规');
  assert.ok(!/%/.test(verdictMarkup.split('\n').find(l => l.includes('vhc-rec-tag')) || ''), '结论 chip 不百分比化');
  // 数据源：scoreSummary.recommendation = canonical 字段透传
  assert.equal(scoreSummary({ recommendation: '推荐' }).recommendation, '推荐');
  assert.equal(scoreSummary({ recommendation: '硬红线跳过' }).recommendation, '硬红线跳过');
  assert.equal(recClassOf('强烈推荐'), 'rec-good');
  assert.equal('recommendation_reason' in scoreSummary({ recommendation_reason: '长文本', recommendation: '推荐' }), false, '顶部不携带 reason 长文本');
});

// ── U11 可信度缺失：待确认，不伪造 0 ─────────────────────────────────────────
test('U11 可信度缺失：待确认，不伪造 0', () => {
  const missing = scoreSummary({ cv_match_score: 70, career_ops_score: 60, recommendation: '一般' });
  assert.equal(missing.bars[2].text, '待确认');
  assert.equal(missing.bars[2].width, null);
  assert.equal(missing.bars[2].score, null);
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

// ── U13 无 /5：成品 UI 不含 /5 量纲表达 ─────────────────────────────────────
test('U13 无 /5：新 UI 与展示层 helper 不含 /5 量纲表达', () => {
  assert.ok(!UI.includes('/5'), 'index.html 无 /5');
  assert.ok(!VM.includes("career_ops_score + ' / 5'"), '无旧制拼接');
});

// ── U14 内部 token 防泄露继续锁定（P31 全族在 phase6 测试；此处锁 helper 与新 UI 渲染文本）──
test('U14 新 UI 路径不引入内部 token：helper 与渲染文案无 raw enum/key', () => {
  const helperSrc = VM.slice(VM.indexOf('export function scoreSummary'));
  for (const token of ['has_hard_gap', 'eligibility=', 'eligible_with_gaps', 'decision_trace', 'career_score ≥', 'score_scale_version']) {
    assert.ok(!helperSrc.includes(token), `scoreSummary 不输出内部 token ${token}`);
  }
  // 新 UI 的用户可见文案位（推荐结论看板 + 详情动作文案）不出现内部字段名
  const visible = UI.slice(UI.indexOf('verdict-hero-card'), UI.indexOf('dt-softgaps-card'));
  for (const token of ['has_hard_gap', 'eligible_with_gaps', 'analysis_gate', 'score_scale_version', 'analysis_schema_version']) {
    assert.ok(!visible.includes(token), `结论看板区不输出 ${token}`);
  }
  // blockerHits 白名单守卫仍在（2C 修复不回退）
  assert.ok(VM.includes('key in BLOCKER_ZH'), 'blockerHits 白名单守卫保持');
});

// ── U15 section 稳定：空态 fallback 与板块顺序保持（本轮顺序合同：JD 前置）────
test('U15 section 稳定：SECTION_EMPTY_TEXT fallback 与板块顺序保持', async () => {
  const { SECTION_EMPTY_TEXT } = await import('../../dashboard-web/lib/analysis-contract.mjs');
  assert.ok(SECTION_EMPTY_TEXT.strengths, '主要优势空态');
  assert.ok(SECTION_EMPTY_TEXT.gaps, '主要短板空态');
  assert.ok(SECTION_EMPTY_TEXT.decision_trace, '决策链空态（数据合同仍在）');
  // 板块顺序（Dashboard 优化轮调整）：完整 JD（默认展开）→ 裁决看板 → 推荐原因 → 主要优势
  //   → 主要短板 → 可弥补缺口 → 简历/面试 → 评分明细
  // 核心原则：先让用户看清楚 JD，再看系统判断。
  const order = ['📄 完整 JD', '<div class="verdict-hero-card">', '📌 推荐原因', '✅ 主要优势', '⚠️ 主要短板', '🩹 可弥补缺口', '📝 简历修改建议', '🎤 面试建议', '🧮 评分明细'];
  const idx = order.map(k => UI.indexOf(k));
  assert.ok(idx.every(i => i > -1), `新 UI 板块文案齐备：${order.filter((k, i) => idx[i] === -1).join(' / ')}`);
  assert.deepEqual([...idx].sort((a, b) => a - b), idx, '板块顺序符合本轮合同');
  // Runtime 决策链（内部 trace）不再出现在普通 UI
  assert.ok(!UI.includes('🧭 推荐决策链'), 'Runtime 决策链卡片已从普通 UI 移除');
  assert.ok(!UI.includes('dt-trace-body'), '决策链渲染容器已移除（decision_trace 数据仍由 API 透传）');
});
