// app.js — 求职决策中枢 Dashboard 前端（纯 vanilla，只读展示 + shortlist/status 写回）
//
// 三层结果彻底分离（Phase 6）：CV Match（0-100）/ Career Score（1-5）/ Recommendation
// （Runtime 枚举）各自独立展示；分数、推荐结论、资格、blocker 全部直接消费 Runtime
// 输出字段，前端零评分、零决策推导（展示层文案映射在 ./lib/view-model.mjs）。
/* eslint-env browser */
'use strict';

import {
  displayDimensions, dimStatusZh, gapLevelZh, blockerHits, gapItemText,
  traceLines, zhMetrics, reasonZh, verdictCards, recommendationCells, recClassOf, confClassOf,
  rankJobs,
} from './lib/view-model.mjs';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason)));

const state = {
  data: null,          // /api/state
  page: 'dash',
  activeRun: null,     // run file filter
  activeJobId: null,
  statusMutating: null, // per-job 写回锁（job_id），期间禁止第二次状态写入
  cache: {},
};

// ── utils ──
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t.__t);
  t.__t = setTimeout(() => t.classList.add('hidden'), 2600);
}
function confClass(percent) {
  return confClassOf(percent);
}
// confidence 展示守卫：percent 缺失/非有限数 → 不渲染可信度芯片（绝不显示 "null%"）
function hasConf(c) {
  return !!(c && c.percent != null && Number.isFinite(Number(c.percent)));
}
function fmtSalaryK(range) {
  if (range == null) return '—';
  if (range >= 99) return '15K+';
  return `${range}K`;
}
function salaryBucket(j) {
  const sMax = j.salary_max;
  if (sMax == null) return null;
  if (sMax < 5) return '0-5';
  if (sMax <= 10) return '5-10';
  if (sMax <= 15) return '10-15';
  return '15-99';
}
window.__salaryBucket = salaryBucket; // exposed for tests

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

// ── data ──
async function refresh() {
  try {
    state.data = await api('/api/state');
    $('#healthDot').className = 'dot ok';
    $('#healthText').textContent = `数据源已加载 · ${state.data.stats.total} 个岗位 · 127.0.0.1:8790`;
    renderAll();
  } catch (e) {
    $('#healthDot').className = 'dot bad';
    $('#healthText').textContent = `后端连接失败：${e.message}`;
    $('#jobList').innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-title">无法加载数据</div><div class="empty-sub">${esc(e.message)}</div></div>`;
    $('#jobList').classList.remove('hidden');
  }
}

// ── filters ──
function filteredJobs() {
  const d = state.data;
  if (!d) return [];
  let jobs = d.jobs;
  if (state.activeRun) jobs = jobs.filter(j => j.run_file === state.activeRun);
  if (state.page === 'shortlist') jobs = jobs.filter(j => j.shortlisted);
  else if (state.page === 'pending') jobs = jobs.filter(j => !j.status); // 待处理 = 无任何人工状态（tracker 无行）
  else if (state.page === 'closed') jobs = jobs.filter(j => ['Rejected', 'Discarded', 'SKIP'].includes(j.status));
  else if (['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer'].includes(state.page)) {
    jobs = jobs.filter(j => j.status === state.page);
  } else if (!['all', 'pending', 'shortlist', 'closed'].includes(state.page)) jobs = []; // dash/runs/settings don't show list

  const q = $('#searchInput').value.trim().toLowerCase();
  const district = $('#districtFilter').value;
  const salary = $('#salaryFilter').value;
  const rec = $('#recFilter').value;
  const status = $('#statusFilter').value;
  const shortOnly = $('#shortOnly').checked;

  if (q) jobs = jobs.filter(j => `${j.company} ${j.title}`.toLowerCase().includes(q));
  if (district) jobs = jobs.filter(j => (j.district || '') === district);
  if (salary) jobs = jobs.filter(j => salaryBucket(j) === salary);
  if (rec) jobs = jobs.filter(j => j.analysis.recommendation === rec);
  if (status) jobs = jobs.filter(j => j.status === status);
  if (shortOnly) jobs = jobs.filter(j => j.shortlisted);

  const by = $('#sortBy').value;
  if (by === 'rec') return rankJobs(jobs); // 默认：与 Dashboard Top 同一 SoT
  const cmp = {
    score: (a, b) => (b.analysis.career_ops_score ?? -1) - (a.analysis.career_ops_score ?? -1),
    cv: (a, b) => (b.analysis.cv_match_score ?? -1) - (a.analysis.cv_match_score ?? -1),
    salary: (a, b) => (b.salary_max ?? -1) - (a.salary_max ?? -1),
    time: (a, b) => String(b.collected_at || '').localeCompare(String(a.collected_at || '')),
  }[by];
  return jobs.slice().sort(cmp);
}
window.__filteredJobsRef = filteredJobs; // for tests via evaluate

// ── render: nav/pages ──
function renderNav() {
  const d = state.data;
  const counts = {
    all: d.jobs.length,
    pending: d.jobs.filter(j => !j.status).length,
    short: d.stats.shortlisted,
    runs: d.runs.length,
    closed: d.jobs.filter(j => ['Rejected', 'Discarded', 'SKIP'].includes(j.status)).length,
  };
  for (const s of d.states) counts[s.id] = d.jobs.filter(j => j.status === s.id).length;
  $('#cnt-all').textContent = counts.all;
  $('#cnt-pending').textContent = counts.pending;
  $('#cnt-short').textContent = counts.short;
  $('#cnt-runs').textContent = counts.runs;
  $('#cnt-closed').textContent = counts.closed;
  for (const s of d.states) { const el = $(`#cnt-${s.id}`); if (el) el.textContent = counts[s.id]; }
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === state.page));
}

function pageLabel() {
  const d = state.data;
  const names = {
    dash: '概览', all: '全部岗位', pending: '待处理', shortlist: '⭐ 想投', runs: '搜索记录', settings: '数据与设置',
    closed: '已放弃 / 淘汰',
  };
  if (names[state.page]) return names[state.page];
  const s = d.states.find(x => x.id === state.page);
  return s ? s.zh : state.page;
}

function renderAll() {
  const d = state.data;
  renderNav();
  $('#pageTitle').textContent = pageLabel();
  const isList = ['all', 'pending', 'shortlist', 'closed', ...d.states.map(s => s.id)].includes(state.page);
  // 概览/记录/设置：隐藏右侧单岗位详情栏，中栏扩展为完整内容区
  $('#shell').classList.toggle('wide', !isList);
  $('#detailPanel').classList.toggle('hidden', !isList);
  $('#toolbar').classList.toggle('hidden', !isList);
  $('#jobList').classList.toggle('hidden', !isList);
  $('#dashView').classList.toggle('hidden', state.page !== 'dash');
  $('#runsView').classList.toggle('hidden', state.page !== 'runs');
  $('#settingsView').classList.toggle('hidden', state.page !== 'settings');
  $('#runBanner').classList.toggle('hidden', !state.activeRun);

  if (isList) renderList();
  if (state.page === 'dash') renderDash();
  if (state.page === 'runs') renderRuns();
  if (state.page === 'settings') renderSettings();
  renderRunBanner();
  updateFilterState(isList);

  // 选项动态填充
  const districts = [...new Set(d.jobs.map(j => j.district).filter(Boolean))];
  fillSelect($('#districtFilter'), districts, '全部区域');
  fillSelect($('#statusFilter'), d.states, '全部状态', s => s.zh, s => s.id);
  if (state.activeJobId) {
    const job = d.jobs.find(j => j.job_id === state.activeJobId);
    if (job) renderDetail(job); else { state.activeJobId = null; renderEmptyDetail(); }
  } else renderEmptyDetail();
  // 恢复 last_viewed
  if (!state.activeJobId && d.last_viewed) {
    const job = d.jobs.find(j => j.job_id === d.last_viewed);
    if (job) { state.activeJobId = job.job_id; renderDetail(job); }
  }
}

function fillSelect(sel, values, label, fmt, valOf) {
  // values 支持原始值数组或对象数组；valOf 提取 option value，fmt 提取用户可见文字。
  // 两者缺一不可——对象数组只传 fmt 会导致 option value 有值但 label 为空（空 option）。
  const getVal = valOf ?? (v => v);
  const getFmt = fmt ?? (v => v);
  const cur = sel.value;
  sel.innerHTML = `<option value="">${esc(label)}</option>` +
    values.map(v => `<option value="${esc(getVal(v))}">${esc(getFmt(v))}</option>`).join('');
  const curVal = cur instanceof Object ? '' : cur;
  const valList = values.map(getVal);
  if (valList.includes(curVal)) sel.value = curVal;
}

function updateFilterState(isList) {
  const n = isList ? filteredJobs().length : 0;
  const parts = [state.activeRun ? `仅搜索轮次 ${state.activeRun.replace('search-results-', '').replace('.json', '')}` : '全部轮次'];
  $('#filterState').textContent = `当前筛选：${parts.join(' · ')} · ${n} 个岗位`;
}

function renderRunBanner() {
  const el = $('#runBanner');
  if (!state.activeRun) { el.innerHTML = ''; return; }
  const run = state.data.runs.find(r => r.file === state.activeRun);
  el.innerHTML = `<span>🔍 仅显示 ${esc(run ? run.file : state.activeRun)} 的岗位</span><button class="btn ghost" id="clearRunBtn" style="padding:3px 10px;font-size:12px">清除</button>`;
  $('#clearRunBtn').onclick = () => { state.activeRun = null; renderAll(); };
}

// ── 概览（核心进度 / 推荐结果 / 搜索摘要 / 本轮岗位排序） ──
function renderDash() {
  const d = state.data;
  const s = d.stats;
  const cfg = d.search_config;
  const rec = s.by_recommendation;
  // 五格顺序/文案固定，数值全部来自 Runtime 聚合（不硬编码计数）
  const recCells = recommendationCells(rec).map(([label, n, cls]) =>
    `<div class="rec-cell ${cls}"><div class="rc2-num">${n}</div><div class="rc2-label">${esc(label)}</div></div>`).join('');
  const recTotal = recommendationCells(rec).reduce((n, x) => n + x[1], 0);
  const pct = (n) => s.total ? Math.round(n / s.total * 100) : 0;

  // 展示排序（仅排序，不改数据）：Recommendation 优先 → Career Score 降序 → CV Match 降序；
  // 默认预览前 10 个（<=10 全显示，>10 只显示前 10），不新增任何更多入口或切换控件。
  const topJobs = rankJobs(d.jobs).slice(0, 10);

  $('#dashView').innerHTML = `
    <section class="dash-card">
      <div class="dash-h-row"><h3 class="dash-h">核心进度</h3><span class="fine">共 ${s.total} 个岗位</span></div>
      <div class="core-ring-row">
        ${ringStat(pct(s.analyzed), '已分析', `${s.analyzed} / ${s.total}`, 'ring-green')}
        <div class="core-divider"></div>
        ${starStat('想投', s.shortlisted)}
      </div>
    </section>
    <section class="dash-card">
      <div class="dash-h-row"><h3 class="dash-h">推荐结果</h3><span class="fine">共 ${recTotal} 个岗位</span></div>
      <div class="rec-grid">${recCells}</div>
    </section>
    <section class="dash-card">
      <h3 class="dash-h">当前搜索摘要</h3>
      <div class="summary-cols">
        <div class="summary-group">
          <div class="sg-row"><span class="k">搜索岗位</span><span>${esc((cfg.target_titles || []).join(' / ') || '—')}</span></div>
          <div class="sg-row"><span class="k">城市</span><span>${esc((cfg.target_city || []).join('、') || '—')}</span></div>
          <div class="sg-row"><span class="k">区域</span><span>${esc((cfg.target_districts || []).join(' · ')) || '不限'}</span></div>
          <div class="sg-row"><span class="k">候选人</span><span>${esc(d.candidate.full_name || '—')}</span></div>
          <div class="sg-row"><span class="k">投递跟踪</span><span>${d.tracker.rows} 行</span></div>
        </div>
        <div class="summary-group">
          <div class="sg-row"><span class="k">平均简历匹配度</span><span>${s.avg_cv_match != null ? s.avg_cv_match + '%' : '暂无数据'}</span></div>
          <div class="sg-row"><span class="k">平均综合评分</span><span>${s.avg_career_ops_score != null ? s.avg_career_ops_score + ' / 5' : '暂无数据'}</span></div>
          <div class="sg-row"><span class="k">薪资</span><span>${cfg.salary_min_k ?? '?'}K–${cfg.salary_max_k ?? '?'}K</span></div>
          <div class="sg-row"><span class="k">最后运行</span><span>${esc((d.last_run_at || '—').replace('T', ' ').slice(0, 16))}</span></div>
          <div class="sg-row"><span class="k">收件箱待处理</span><span>${d.inbox_pending} 个</span></div>
        </div>
      </div>
    </section>
    <section class="dash-card">
      <div class="dash-h-row"><h3 class="dash-h">本轮岗位排序</h3><span class="fine">推荐优先，其次按综合评分排序</span></div>
      ${topJobs.length ? `<div class="top-jobs">${topJobs.map(topJobRow).join('')}</div>` : '<div class="fine">还没有岗位数据，运行 browser-search 采集后这里会出现本轮岗位</div>'}
    </section>
    <div class="note-card">💡 排名与推荐来自本地评分引擎（冻结采购十维权重归一化，无数据维度不计入分母）。Dashboard 只展示 Runtime 结果，不自行计算、不合成总分。想投（⭐）只是收藏，不等于已投递；状态修改会写回 data/applications.md 的 canonical 状态。</div>`;
  $$('.top-job-row', $('#dashView')).forEach(row => {
    row.onclick = () => {
      state.activeJobId = row.dataset.job;
      state.page = 'all';
      renderAll();
      api('/api/last-viewed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: row.dataset.job }) }).catch(() => {});
    };
  });
}
// 圆环指标（SVG donut）：环中央显示百分比，下方标签与数值，严格垂直中轴
function ringStat(pct, label, valueText, cls) {
  const R = 34, C = 2 * Math.PI * R;
  const dash = (C * Math.min(pct, 100) / 100).toFixed(2);
  return `<div class="ring-stat">
    <svg class="ring ${cls}" width="84" height="84" viewBox="0 0 84 84" role="img" aria-label="${esc(label)} ${pct}%">
      <circle class="ring-track" cx="42" cy="42" r="${R}"></circle>
      <circle class="ring-fill" cx="42" cy="42" r="${R}" stroke-dasharray="${dash} ${C.toFixed(2)}" transform="rotate(-90 42 42)"></circle>
      <text class="ring-num" x="42" y="42" text-anchor="middle" dominant-baseline="central">${pct}%</text>
    </svg>
    <div class="ring-label">${esc(label)}</div>
    <div class="ring-value">${esc(valueText)}</div>
  </div>`;
}
// 想投：暖黄圆形底 + 星形 icon（非百分比环），数值只显示数量
function starStat(label, num) {
  return `<div class="ring-stat">
    <div class="star-disc" role="img" aria-label="${esc(label)} ${num}">
      <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true"><path class="star-path" d="M12 2.4l2.94 5.95 6.57.96-4.75 4.63 1.12 6.54L12 17.37l-5.88 3.11 1.12-6.54-4.75-4.63 6.57-.96z"/></svg>
    </div>
    <div class="ring-label">${esc(label)}</div>
    <div class="ring-value">${esc(num)}</div>
  </div>`;
}
// 展示层文本映射（zhMetrics）在 ./lib/view-model.mjs：Runtime 文案中的旧品牌指标名 → 中文
// 多条建议字符串 → 逐条列表（仅在存在 ①-⑳ 明确编号边界时拆分，保留原编号）
function listify(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const parts = s.split(/(?=[①-⑳])/).map(x => x.trim()).filter(Boolean);
  if (parts.length >= 2 && /^[①-⑳]/.test(parts[1])) {
    const intro = /^[①-⑳]/.test(parts[0]) ? '' : `<p class="steps-intro">${esc(parts.shift())}</p>`;
    return `${intro}<ul class="plain-steps">${parts.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
  }
  return `<p>${esc(s)}</p>`;
}
// 评分维度显示名：统一来自 view-model DIMENSION_ZH（冻结十维，displayDimensions 已过滤退役维度）
// JD 原文逐行排版：保留【结构标题】与编号列表，不压成大段落（保守拆分，仅识别明确标志）
function jdHtml(text) {
  const s = String(text || '');
  if (!s.trim()) return '—';
  return s.split(/\r?\n/).map(raw => {
    const line = raw.trim();
    if (!line) return '';
    if (line.startsWith('【') && line.endsWith('】')) return `<div class="jd-line jd-head">${esc(line)}</div>`;
    const parts = line.split(/(?=[①-⑳])/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 2 && /^[①-⑳]/.test(parts[1])) return parts.map(p => `<div class="jd-line jd-item">${esc(p)}</div>`).join('');
    if (/^\d{1,2}[.、）)]/.test(line)) return `<div class="jd-line jd-item">${esc(line)}</div>`;
    return `<div class="jd-line">${esc(line)}</div>`;
  }).filter(Boolean).join('');
}
function topJobRow(j) {
  const a = j.analysis;
  const conf = a.score_confidence;
  return `<button class="top-job-row ${state.activeJobId === j.job_id ? 'active' : ''}" data-job="${esc(j.job_id)}">
    <div class="tj-line1">
      <span class="tj-company">${esc(j.company)}</span>
      <span class="tj-title">${esc(j.title)}</span>
    </div>
    <span class="tj-chips">
      <span class="score-chip cv">匹配 <b>${a.cv_match_score != null ? a.cv_match_score + '%' : '—'}</b></span>
      <span class="score-chip ops">综合 <b>${a.career_ops_score ?? '—'}</b>/5</span>
      ${hasConf(conf) ? `<span class="score-chip ${confClass(conf.percent)}">评分可信度 <b>${conf.percent}%</b>${conf.level != null ? ' · ' + esc(conf.level) : ''}</span>` : ''}
      ${a.recommendation ? `<span class="rec-chip rec-${esc(a.recommendation)}">${esc(a.recommendation)}</span>` : ''}
    </span>
    <div class="tj-reason">${esc(reasonZh(a.recommendation_reason) || '—')}</div>
  </button>`;
}

// ── 搜索记录 ──
function renderRuns() {
  const d = state.data;
  $('#runsView').innerHTML = d.runs.length ? d.runs.slice().reverse().map(r => `
    <button class="run-card ${state.activeRun === r.file ? 'active' : ''}" data-run="${esc(r.file)}">
      <h3>${esc(r.file.replace('search-results-', '').replace('.json', ''))} ${r.run_mode ? `<span class="pill">${esc(r.run_mode.slice(0, 24))}</span>` : ''}</h3>
      <div class="run-meta">
        <span class="pill">目标 ${(r.config.target_titles || []).join('/')}</span>
        <span class="pill">${esc((r.config.target_city || []).join('/'))} ${(r.config.target_districts || []).join('/')}</span>
        <span class="pill">${r.config.salary_min_k}-${r.config.salary_max_k}K</span>
        <span class="pill">发现 ${r.counters.discovered ?? '—'}</span>
        <span class="pill">采集 ${r.counters.collected ?? '—'}</span>
        <span class="pill">规则跳过 ${r.counters.skipped ?? '—'}</span>
        <span class="pill">分析 ${r.counters.analyzed ?? '—'}</span>
        <span class="pill">失败 ${r.counters.failed ?? '—'}</span>
        ${r.risk_events?.length ? `<span class="pill bad">风控 ${r.risk_events.length}</span>` : ''}
        <span class="pill">${r.job_count} 岗位</span>
      </div>
    </button>`).join('') : `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">还没有搜索记录</div><div class="empty-sub">完成一轮岗位采集后，这里会出现每轮采集记录</div></div>`;
  $$('.run-card', $('#runsView')).forEach(btn => {
    btn.onclick = () => {
      state.activeRun = state.activeRun === btn.dataset.run ? null : btn.dataset.run;
      state.page = 'all';
      renderAll();
    };
  });
}

// ── 数据与设置 ──
function renderSettings() {
  const d = state.data;
  $('#settingsView').innerHTML = `
    <div class="config-card"><h3 style="margin:0 0 8px">数据源（只读）</h3>
      <div class="kv">
        <span class="k">搜索结果</span><span>${d.health.files.results} 份 · data/search-results-*.json</span>
        <span class="k">投递跟踪</span><span>${d.tracker.rows} 行 · data/applications.md</span>
        <span class="k">分析报告</span><span>${d.health.files.reports_md} 份 · reports/*.md</span>
        <span class="k">待处理收件箱</span><span>${d.health.files.inbox_json} 个 · inbox/*.json</span>
        <span class="k">简历档案</span><span>config/profile.yml（${esc(d.candidate.full_name || '')}）</span>
      </div>
    </div>
    <div class="config-card"><h3 style="margin:0 0 8px">可写状态</h3>
      <div class="kv">
        <span class="k">想投 ⭐</span><span>data/dashboard-state.json（shortlisted）</span>
        <span class="k">岗位状态</span><span>写回 data/applications.md canonical 状态（不在 tracker 的岗位走 TSV + merge-tracker 管道）</span>
      </div>
    </div>
    <div class="config-card"><h3 style="margin:0 0 8px">状态代码 ↔ 中文显示</h3>
      <div class="kv">${d.states.map(s => `<span class="k">${s.id}</span><span>${s.zh}</span>`).join('')}</div>
      <div class="fine" style="margin-top:6px">写回数据文件时仍使用英文状态代码，界面一律显示中文。</div>
    </div>
    <div class="note-card">本面板是本地结果展示层：不抓取 Boss、不调用 AI、不上传任何数据，仅监听 127.0.0.1:8790。</div>`;
}

// ── 岗位列表 ──
function renderList() {
  const jobs = filteredJobs();
  const d = state.data;
  const el = $('#jobList');
  if (!jobs.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🗂️</div><div class="empty-title">没有匹配的岗位</div><div class="empty-sub">调整筛选条件，或采集新岗位后再回来查看</div></div>`;
    return;
  }
  el.innerHTML = jobs.map(j => {
    const a = j.analysis;
    const conf = a.score_confidence;
    const shortlisted = j.shortlisted;
    return `<button class="job-card ${state.activeJobId === j.job_id ? 'active' : ''}" data-job="${esc(j.job_id)}">
      <div class="job-title-line">
        <span class="star-btn ${shortlisted ? 'on' : ''}" data-star="${esc(j.job_id)}" title="想投">${shortlisted ? '⭐' : '☆'}</span>
        <span class="job-title">${esc(j.title)}</span>
        <span class="salary">${esc(j.salary)}</span>
      </div>
      <div class="job-meta-row">
        <span class="meta-item company">${esc(j.company)}</span>
        <span class="meta-item">${esc(j.city || '')}${j.district ? ' · ' + esc(j.district) : ''}</span>
        ${j.experience ? `<span class="meta-item">${esc(j.experience)}</span>` : ''}
        ${j.education ? `<span class="meta-item">${esc(j.education)}</span>` : ''}
        <span class="meta-item">${esc((j.collected_at || '').slice(0, 10))}</span>
      </div>
      <div class="job-score-row">
        <span class="score-chip cv">匹配 <b>${a.cv_match_score != null ? a.cv_match_score + '%' : '—'}</b></span>
        <span class="score-chip ops">综合 <b>${a.career_ops_score ?? '—'}</b>/5</span>
        ${hasConf(conf) ? `<span class="score-chip ${confClass(conf.percent)}">评分可信度 <b>${conf.percent}%</b>${conf.level != null ? ' · ' + esc(conf.level) : ''}</span>` : ''}
        ${a.recommendation ? `<span class="rec-chip rec-${esc(a.recommendation)}">${esc(a.recommendation)}</span>` : ''}
        ${j.status ? `<span class="status-chip">${esc(j.status_zh || j.status)}</span>` : ''}
      </div>
    </button>`;
  }).join('');

  $$('.job-card', el).forEach(card => {
    card.onclick = (ev) => {
      if (ev.target.closest('[data-star]')) return;
      selectJob(card.dataset.job);
    };
  });
  $$('[data-star]', el).forEach(star => {
    star.onclick = async (ev) => {
      ev.stopPropagation();
      const jobId = star.dataset.star;
      const target = !jobs.find(j => j.job_id === jobId).shortlisted;
      await api('/api/shortlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, shortlisted: target }) });
      toast(target ? '⭐ 已加入想投' : '已取消想投');
      await refresh();
    };
  });
}

// ── 详情 ──
function renderEmptyDetail() {
  $('#detailInner').innerHTML = `<div class="empty"><div class="empty-icon">👈</div><div class="empty-title">选择一个岗位</div><div class="empty-sub">在中栏点击岗位卡片，这里会显示完整评估</div></div>`;
}

async function selectJob(jobId) {
  state.activeJobId = jobId;
  const job = state.data.jobs.find(j => j.job_id === jobId);
  renderDetail(job);
  renderList();
  api('/api/last-viewed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }) }).catch(() => {});
  // 预取 report
  if (job.report_file) {
    try {
      const r = await api(`/api/report?file=${encodeURIComponent(job.report_file)}`);
      state.cache[jobId] = r.content;
      const el = $('#reportContent-' + CSS.escape(jobId));
      if (el) el.textContent = r.content;
    } catch { /* report 缺失时静默 */ }
  }
}

function renderDetail(j) {
  const a = j.analysis;
  const conf = a.score_confidence;
  const dims = displayDimensions(a.score_breakdown); // 只保留冻结十维，退役维度不展示
  const blockerList = blockerHits(a.blockers);
  const trace = traceLines(a.decision_trace);
  const hardGaps = Array.isArray(a.hard_gaps) ? a.hard_gaps : [];
  const softGaps = Array.isArray(a.soft_gaps) ? a.soft_gaps : [];
  const inner = $('#detailInner');
  inner.innerHTML = `
    <div class="d-head">
      <div>
        <h2>${esc(j.title)}</h2>
        <div class="d-company">
          <span class="meta-item company">${esc(j.company)}</span>
          <span class="meta-item">${esc(j.city || '')}${j.district ? ' · ' + esc(j.district) : ''}</span>
        </div>
      </div>
      <button class="star-btn d-star ${j.shortlisted ? 'on' : ''}" id="detailStar" title="想投">${j.shortlisted ? '⭐' : '☆'}</button>
    </div>

    <div class="d-verdict">
      ${verdictCards(a).map(c => `<div class="v-card"><div class="v-num ${esc(c.cls)}">${esc(c.num)}</div><div class="v-label">${esc(c.label)}</div></div>`).join('')}
    </div>

    <div class="d-actions">
      <span class="select-wrap"><select class="input status-select" id="statusSelect">
        <option value="">修改状态…</option>
        ${state.data.states.map(s => `<option value="${s.id}" ${j.status === s.id ? 'selected' : ''}>${s.zh}</option>`).join('')}
      </select></span>
      <a class="btn ghost" href="${esc(j.job_url)}" target="_blank" rel="noopener noreferrer">Boss 原链接 ↗</a>
      ${j.report_file ? `<button class="btn ghost" id="toggleReportBtn">查看完整分析</button>` : ''}
    </div>
    ${j.report_file ? `<div class="d-section hidden" id="reportSection">
      <div class="fine" style="margin:0 0 8px">旧版存档：该报告由旧版评分引擎生成，评分维度体系已更新，以下为历史存档原文。</div>
      <div class="report-meta"><span class="fine">来源：${esc(j.report_file)}</span><a class="d-link" href="/api/report?file=${encodeURIComponent(j.report_file)}" target="_blank" rel="noopener">打开 Markdown</a></div>
      <details class="report-details" open><summary>A-F 分析原文</summary><div class="report-text" id="reportContent-${esc(j.job_id)}">加载中…</div></details></div>` : ''}

    <div class="d-section">
      <h3>📌 推荐原因</h3>
      <div class="reason-box">${esc(reasonZh(a.recommendation_reason) || '—')}</div>
      <div class="kv-mini">
        <span class="k">薪资匹配</span><span>${esc(j.salary)}</span>
        <span class="k">地点匹配</span><span class="meta-item">${esc(j.city || '')}${j.district ? ' · ' + esc(j.district) : ''}</span>
        ${j.notes ? `<span class="k">备注</span><span>${esc(j.notes)}</span>` : ''}
        <span class="k">采集时间</span><span>${esc(j.collected_at || '—')}</span>
      </div>
    </div>

    ${a.strengths?.length ? `<div class="d-section"><h3>✅ 主要优势</h3><ul>${a.strengths.map(s => `<li class="strength-li">${esc(s)}</li>`).join('')}</ul></div>` : ''}
    ${a.gaps?.length ? `<div class="d-section"><h3>⚠️ 主要短板</h3><ul>${a.gaps.map(g => `<li class="gap-li">${esc(g)}</li>`).join('')}</ul></div>` : ''}
    ${blockerList.length ? `<div class="d-section"><h3>⛔ 硬性阻断（硬红线）</h3><ul>${blockerList.map(b => `<li class="gap-li">${esc(gapLevelZh('BLOCKER'))}：${esc(b.zh)}</li>`).join('')}</ul><div class="fine" style="margin-top:6px">阻断只覆盖最终推荐结论（不推荐），不修改简历匹配度与综合评分。</div></div>` : ''}
    ${hardGaps.length ? `<div class="d-section"><h3>⛔ 硬性缺口</h3><ul>${hardGaps.map(g => `<li class="gap-li">${esc(gapItemText(g) || '信息不足（待确认）')}</li>`).join('')}</ul></div>` : ''}
    ${softGaps.length ? `<div class="d-section"><h3>🩹 可弥补缺口</h3><ul>${softGaps.map(g => `<li class="gap-li">${esc(gapItemText(g) || '信息不足（待确认）')}</li>`).join('')}</ul></div>` : ''}
    ${a.cv_advice ? `<details class="d-section d-fold"><summary>📝 简历修改建议</summary><div class="fold-body">${listify(a.cv_advice)}</div></details>` : ''}
    ${a.interview_focus ? `<details class="d-section d-fold"><summary>🎤 面试建议</summary><div class="fold-body">${listify(a.interview_focus)}</div></details>` : ''}
    ${a.hard_redline ? `<div class="d-section"><h3>🚨 硬红线</h3><p>命中 deal_breaker / 红线条件</p></div>` : ''}
    ${trace.length ? `<details class="d-section d-fold"><summary>🧭 推荐决策链（Runtime 透传）</summary><div class="fold-body"><ul class="plain-steps">${trace.map(l => `<li>${esc(l)}</li>`).join('')}</ul><div class="fine" style="margin-top:6px">最终推荐结论 = Runtime 决策链输出；高简历匹配 + 较高综合评分仍可能因硬性阻断而不推荐。</div></div></details>` : ''}

    ${a.score_breakdown ? `<details class="d-section d-fold"><summary>🧮 评分明细</summary><div class="fold-body">
      ${dims.length ? `
      <table class="bd-table">
        <thead><tr><th>维度</th><th>得分</th><th>权重</th><th>加权值</th><th>状态</th></tr></thead>
        <tbody>
          ${dims.map(dim => `
            <tr class="dim-row" data-dim="${esc(dim.key)}">
              <td>${esc(dim.name)}</td>
              <td class="${dim.status === 'unknown' ? 'dim-unknown' : ''}">${dim.score ?? '—'}</td>
              <td>${dim.weight}</td>
              <td class="${dim.status === 'unknown' ? 'dim-unknown' : ''}">${dim.weighted_value ?? '—'}</td>
              <td class="${dim.status === 'unknown' ? 'dim-unknown' : ''}">${dimStatusZh(dim.status)}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<div class="fine">该报告为旧版评分明细（旧维度已退役，不再展示、不补算）：暂无可展示维度，暂无数据。</div>'}
      <div id="dimDetail" class="dim-detail hidden"></div>
      <div class="bd-summary">
        有效权重 ${a.score_breakdown.effective_weight} / ${a.score_breakdown.total_weight} · 评分可信度（Career Score）${hasConf(conf) ? conf.percent + '% · ' + conf.level : '暂无数据'}<br>
        综合评分<br>
        = Σ(加权值) ÷ 有效权重<br>
        = <b>${a.career_ops_score ?? '—'}</b> / 5
        ${a.rule_score != null ? `<br><span class="fine">旧初筛分 ${a.rule_score}（仅供参考，不作为最终评分）</span>` : ''}
      </div>
    </div></details>` : ''}

    <details class="d-section d-fold">
      <summary>📄 ${j.jd_completeness === 'complete' ? '完整 JD' : '已采集 JD'}<span class="jd-comp">JD 完整度：${{ complete: '完整', partial: '部分', unknown: 'JD 未披露' }[j.jd_completeness || 'unknown']}</span></summary>
      <div class="fold-body"><div class="jd-text">${jdHtml(j.jd_original || j.description)}${j.jd_completeness === 'complete' || !j.benefits ? '' : `\n\n【福利】\n${j.benefits}`}</div></div>
    </details>

    <div class="d-section">
      <h3>📦 导出</h3>
      <div class="d-actions" style="margin:0">
        <a class="btn ghost" href="/api/export/latest-excel">最新 Excel</a>
        <a class="btn ghost" href="/api/export/latest-md">最新 Markdown</a>
      </div>
    </div>`;

  // 事件
  $('#detailStar').onclick = async () => {
    await api('/api/shortlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: j.job_id, shortlisted: !j.shortlisted }) });
    toast(j.shortlisted ? '已取消想投' : '⭐ 已加入想投');
    await refresh();
  };
  // 状态写回：per-job mutation 锁（防连续 change 互相覆盖）；
  // 成功后 await refresh() 全量重拉 /api/state 并 renderAll → 导航计数/列表/待处理全部从最新 SoT 重新派生；
  // 失败则恢复 select 旧值并明确报错，绝不乐观伪更新。
  $('#statusSelect').onchange = async (ev) => {
    const status = ev.target.value;
    if (!status) return;
    if (state.statusMutating) { ev.target.value = j.status || ''; return; } // 上一次写回尚未完成
    state.statusMutating = j.job_id;
    const sel = ev.target;
    sel.disabled = true;
    const zh = (state.data.states.find(x => x.id === status) || {}).zh || status;
    try {
      const r = await api('/api/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: j.job_id, status }) });
      if (r && r.ok === false) throw new Error(r.error + (r.detail ? `：${r.detail}` : ''));
      toast(`状态已写回：${zh}${r.how === 'tsv+merge' ? '（经 TSV+merge 管道）' : ''}`);
      await refresh(); // 全量重派生所有计数与列表（不做任何手工 +/-）
    } catch (e) {
      toast(`写回失败：${e.message}`);
      sel.value = j.status || ''; // 恢复真实旧状态
    } finally {
      sel.disabled = false;
      state.statusMutating = null;
    }
  };
  const toggleReport = $('#toggleReportBtn');
  if (toggleReport) {
    toggleReport.onclick = () => {
      $('#reportSection').classList.toggle('hidden');
      if (state.cache[j.job_id]) {
        const el = $('#reportContent-' + CSS.escape(j.job_id));
        if (el) el.textContent = state.cache[j.job_id];
      }
    };
  }
  $$('.dim-row', inner).forEach(row => {
    row.onclick = () => {
      const dim = dims.find(d => d.key === row.dataset.dim);
      const box = $('#dimDetail');
      box.classList.remove('hidden');
      box.innerHTML = dim
        ? `<b>${esc(dim.name)}</b>（权重 ${dim.weight}）${dim.status === 'unknown' ? ' · 暂无数据，未计入分母' : ''}<br>依据：${esc(zhMetrics(dim.reason || '暂无数据'))}<br>证据：${esc(zhMetrics(dim.evidence || '暂无数据'))}`
        : '';
    };
  });
}

// ── events ──
$('#refreshBtn').onclick = refresh;
$('#searchInput').oninput = () => { renderList(); updateFilterState(true); };
['#districtFilter', '#salaryFilter', '#recFilter', '#statusFilter', '#shortOnly', '#sortBy'].forEach(sel => {
  $(sel).onchange = () => { renderList(); updateFilterState(true); };
});
$$('.nav-btn').forEach(btn => {
  btn.onclick = () => {
    state.page = btn.dataset.page;
    renderAll();
  };
});

refresh();
