// aggregator.mjs — Dashboard 数据聚合层（纯函数，可单测）
//
// 唯一数据源（不复制岗位到第二套存储）：
//   data/search-results-*.json  data/browser-search-history.json  inbox/*.json
//   reports/*.md  data/applications.md  templates/states.yml  config/profile.yml
// 可写状态仅 data/dashboard-state.json（shortlisted / UI 偏好 / last_viewed）。

import fs from 'node:fs';
import path from 'node:path';

export const CANONICAL_STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP'];
export const STATE_ZH = {
  Evaluated: '已分析（待决策）', Applied: '已投递', Responded: '招聘方回应', Interview: '面试',
  Offer: 'Offer（录用）', Rejected: '未通过', Discarded: '已放弃', SKIP: '不投',
};

const readJsonSafe = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readTextSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

// JD 完整度：只做确定性数据检查（长度 + 结构标志），不做 AI 主观判断
const JD_MARKERS = ['岗位职责', '任职要求', '工作内容', '职位描述', '我们希望你', '我们能给你的', '加入我们'];
export function jdCompleteness(text) {
  const s = String(text || '').trim();
  if (!s) return 'unknown';
  return (s.length >= 200 && JD_MARKERS.some(m => s.includes(m))) ? 'complete' : 'partial';
}

/** 从 inbox 原始采集文件回填完整 JD（results 中的 description 是 AI 压缩摘要，非原文） */
function loadInboxJd(history, inboxDir, jobId) {
  const file = history?.jobs?.[jobId]?.inbox_file;
  if (!file) return null;
  const data = readJsonSafe(path.join(inboxDir, path.basename(file)));
  const text = String(data?.extracted?.description || '').trim();
  return text || null;
}

export function normalizeCompany(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[（）()·\s]/g, '')   // 只删括号字符/间隔符，保留括号内公司主体词
    .replace(/有限公司|集团|股份/g, '')
    .replace(/厦门|福州|泉州|北京|上海|深圳|杭州|广州|南京|苏州|福建/g, ''); // 剥离城市前缀，便于品牌词包含匹配
}

export function listSorted(dataDir, prefix, suffix) {
  try {
    return fs.readdirSync(dataDir)
      .filter(f => f.startsWith(prefix) && f.endsWith(suffix))
      .sort()
      .map(f => path.join(dataDir, f));
  } catch { return []; }
}

export function loadRuns(dataDir) {
  return listSorted(dataDir, 'search-results-', '.json').map(p => {
    const j = readJsonSafe(p);
    return j ? { file: path.basename(p), ...j } : null;
  }).filter(Boolean);
}

export function loadHistory(dataDir) {
  return readJsonSafe(path.join(dataDir, 'browser-search-history.json')) || { jobs: {} };
}

/** 解析 applications.md（列顺序以表头为准，容忍工具插入的 URL / Closed At 等额外列） */
export function parseApplications(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => l.includes('|') && /company/i.test(l) && /role/i.test(l));
  if (headerIdx === -1) return [];
  // 'Job ID' 表头归一为 job_id（岗位身份列；8 状态 schema 的向后兼容扩展）
  const header = lines[headerIdx].split('|').map(c => c.trim().toLowerCase()).filter(c => c.length > 0)
    .map(c => (c === 'job id' ? 'job_id' : c));
  const rows = [];
  for (const line of lines.slice(headerIdx + 2)) {
    if (!line.includes('|')) break;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    const row = { __line: line };
    header.forEach((name, i) => { row[name] = cells[i] ?? ''; });
    // merge-tracker 会在数据行里插入 URL / Closed At 等额外列（无对应表头），
    // 弹性扫描：report 链接与岗位 URL 不依赖列位置
    const urlCell = cells.find(c => /^https?:\/\//.test(c));
    if (urlCell) row.url = urlCell;
    const reportCell = cells.find(c => /^\[\d+\]\([^)]+\.md\)/.test(c));
    if (reportCell) row.report = reportCell;
    rows.push(row);
  }
  return rows;
}

export function matchTrackerRow(rows, job) {
  const nCompany = normalizeCompany(job.company);
  const role = String(job.title || '').toLowerCase();
  return rows.find(r => {
    const rc = normalizeCompany(r.company);
    const rr = String(r.role || '').toLowerCase();
    if (!rc || !rr) return false;
    const companyMatch = rc.includes(nCompany) || nCompany.includes(rc);
    const roleMatch = rr === role || rr.includes(role) || role.includes(rr);
    return companyMatch && roleMatch;
  }) || null;
}

// ---------------------------------------------------------------------------
// 岗位身份（DASHBOARD_JOB_IDENTITY_FINAL_FIX）：
// 单张岗位卡的稳定身份 = job_id（平台岗位唯一 ID，Boss 取自 URL，重抓稳定、跨帖唯一）。
// tracker 行身份匹配按优先级分层短路（禁止 fuzzy role 参与人工状态匹配）：
//   1) Job ID 列精确匹配 job.job_id —— 有命中即返回，不再看更低层
//   2) 无 Job ID 的 legacy 行：URL 列包含该 job 的稳定链接段（job_detail/<job_id>）
//   3) legacy 且两者皆无：normalizeCompany 相同 + Role 精确相等（严格等值，非模糊）
// 每层命中多行 → 返回多行，由调用方 AMBIGUOUS/DUPLICATE 拒绝；全层无命中 → 空数组。
// ---------------------------------------------------------------------------
export function findTrackerRows(rows, job) {
  const nCompany = normalizeCompany(job.company);
  const roleExact = String(job.title || '').trim().toLowerCase();
  const jid = String(job.job_id || '').trim();

  // 层 1：Job ID 精确
  if (jid) {
    const byId = rows.filter(r => String(r.job_id || '').trim() === jid);
    if (byId.length > 0) return byId;
  }
  const legacy = rows.filter(r => !String(r.job_id || '').trim());

  // 层 2：legacy URL 含 job_detail/<job_id>
  if (jid) {
    const byUrl = legacy.filter(r => String(r.url || '').includes(`job_detail/${jid}`));
    if (byUrl.length > 0) return byUrl;
  }

  // 层 3：legacy 公司归一互相包含 + role 精确相等
  return legacy.filter(r => {
    const rc = normalizeCompany(r.company);
    const rr = String(r.role || '').trim().toLowerCase();
    return rc && nCompany && (rc === nCompany || rc.includes(nCompany) || nCompany.includes(rc)) && rr && rr === roleExact;
  });
}

/** 原位更新 applications.md 中某行 Status（不增删行、不动其他列）；jobId 提供时回填 Job ID 列 */
export function updateApplicationsStatus(text, { company, role, status, job_id }) {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => l.includes('|') && /company/i.test(l) && /role/i.test(l));
  if (headerIdx === -1) return { text, updated: false };
  const header = lines[headerIdx].split('|').map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
  const statusCol = header.indexOf('status');
  const companyCol = header.indexOf('company');
  const roleCol = header.indexOf('role');
  const jobIdCol = header.indexOf('job id');
  let updated = false;
  const nTarget = normalizeCompany(company);
  const roleLc = String(role || '').trim().toLowerCase();
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) break;
    const cells = line.split('|');
    const inner = cells.slice(1, -1);
    const rc = normalizeCompany(inner[companyCol]);
    const rr = String(inner[roleCol] || '').trim().toLowerCase();
    const match = (rc.includes(nTarget) || nTarget.includes(rc)) &&
      (rr === roleLc || rr.includes(roleLc) || roleLc.includes(rr));
    if (match) {
      inner[statusCol] = status;
      if (job_id && jobIdCol !== -1) inner[jobIdCol] = job_id;
      lines[i] = `| ${inner.map(c => c.trim()).join(' | ')} |`;
      updated = true;
      break;
    }
  }
  return { text: lines.join('\n'), updated };
}

export function buildTsvLine({ num, date, company, role, status, score, pdf, report, notes, job_id }) {
  // 10 列：job_id 插在 role 后（与 applications.md 的 Job ID 列一致）；旧 9 列调用方兼容（job_id undefined → 空串落位）
  return [num, date, company, role, job_id ?? '', status, score, pdf, report, notes].join('\t');
}

export function nextReportNum(reportsDir) {
  let max = 0;
  try {
    for (const f of fs.readdirSync(reportsDir)) {
      const m = f.match(/^(\d{3})-/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch { /* dir missing */ }
  return max + 1;
}

export function countInbox(inboxDir) {
  try {
    return fs.readdirSync(inboxDir).filter(f => f.endsWith('.json')).length;
  } catch { return 0; }
}

function latestOf(files) { return files.length ? files[files.length - 1] : null; }

/**
 * 聚合 Dashboard 全量状态。
 * @param {object} p { dataDir, outputDir, reportsDir, inboxDir, profile, dashboardState }
 */
export function buildState(p) {
  const { dataDir, outputDir, reportsDir, inboxDir, profile, dashboardState } = p;
  const runs = loadRuns(dataDir);
  const history = loadHistory(dataDir);
  const appsText = readTextSafe(path.join(dataDir, 'applications.md')) || '';
  const appRows = parseApplications(appsText);
  const shortlisted = dashboardState?.shortlisted || {};

  const reportFiles = listSorted(reportsDir, '', '.md')
    .map(f => path.relative(path.dirname(reportsDir), f));
  const numberedReports = reportFiles.filter(f => /^\d{3}-/.test(path.basename(f)));

  const jobs = [];
  const runMetas = [];
  const jobsById = new Map(); // 同一岗位多轮采集时只保留最新一轮结果
  for (const run of runs) {
    runMetas.push({
      file: run.file,
      run_at: run.run_at || null,
      rescored_at: run.rescored_at || null,
      config: run.config || {},
      counters: run.counters || {},
      risk_events: run.risk_events || [],
      run_mode: run.run_mode || null,
      job_count: (run.jobs || []).length,
    });
    for (const j of run.jobs || []) {
      jobsById.set(j.job_id, { run, j });
    }
  }
  for (const { run, j } of jobsById.values()) {
      const a = j.analysis || {};
      // 岗位身份匹配（job_id → URL → 公司+精确岗位名）；歧义（多行命中）不广播状态，status 保持 null 由人工处理
      const trackerMatches = findTrackerRows(appRows, j);
      const trackerRow = trackerMatches.length === 1 ? trackerMatches[0] : null;
      const rowReport = trackerRow?.report?.match(/\(([^)]+\.md)\)/)?.[1] || null;
      const jdOriginal = loadInboxJd(history, inboxDir, j.job_id);
      const jdText = jdOriginal || String(j.description || '').trim();
      jobs.push({
        job_id: j.job_id,
        run_file: run.file,
        title: j.title,
        company: j.company,
        salary: j.salary,
        salary_min: j.salary_min ?? null,
        salary_max: j.salary_max ?? null,
        salary_months: j.salary_months ?? null,
        city: j.city,
        district: j.district,
        experience: j.experience,
        education: j.education,
        description: j.description,
        jd_original: jdOriginal,
        jd_completeness: jdCompleteness(jdText),
        benefits: j.benefits,
        company_industry: j.company_industry,
        company_size: j.company_size,
        recruiter_name: j.recruiter_name,
        recruiter_title: j.recruiter_title,
        recruiter_active_status: j.recruiter_active_status,
        job_url: j.job_url,
        collected_at: j.collected_at,
        notes: j.notes || null,
        analysis: {
          cv_match_score: a.cv_match_score ?? null,
          cv_match_confidence: a.cv_match_confidence ?? null,
          // Career Score：Phase 3+ SoT 字段为 career_ops_score；兼容 career_score / 旧 score 别名。
          // 只透传，不重算、不合成。
          career_ops_score: a.career_ops_score ?? a.career_score ?? a.score ?? null,
          career_score: a.career_ops_score ?? a.career_score ?? a.score ?? null,
          rule_score: a.rule_score ?? null,
          score_confidence: a.score_confidence || null,   // Career Score 层可信度（不与 CV Match 可信度混算）
          score_breakdown: a.score_breakdown || null,
          dimensions: a.dimensions || null,               // Runtime 新格式维度数据（若有）
          recommendation: a.recommendation || null,        // Runtime 最终推荐，前端禁止重推导
          recommendation_reason: a.recommendation_reason || null,
          decision_trace: a.decision_trace ?? a.trace ?? null, // 决策链透传（不重放、不解释）
          blockers: a.blockers || null,                    // candidate-side blocker 布尔（只覆盖 Recommendation）
          hard_gaps: a.hard_gaps || null,                  // §22.1 四级：HARD_GAP
          soft_gaps: a.soft_gaps || null,                  // §22.1 四级：SOFT_GAP
          hard_requirements: a.hard_requirements || null,  // Eligibility 明细（透传备用）
          eligibility_status: a.eligibility_status || null,
          taxonomy: a.taxonomy || null,                    // Archetype/品类归档（透传）
          capability_summary: a.capability_summary || a.capabilities_summary || a.capabilities || null,
          strengths: a.strengths || [],
          gaps: a.gaps || [],
          cv_advice: a.cv_advice || null,
          interview_focus: a.interview_focus || null,
          hard_redline: a.hard_redline || false,
        },
        status: trackerRow?.status ? trackerRow.status : null,
        status_zh: trackerRow?.status ? (STATE_ZH[trackerRow.status] || trackerRow.status) : null,
        tracker_num: trackerRow?.['#'] || null,
        report_file: rowReport,
        shortlisted: !!shortlisted[j.job_id],
      });
  }

  const analyzed = jobs.filter(j => j.analysis.career_ops_score != null);
  const byRec = {};
  for (const j of jobs) {
    const r = j.analysis.recommendation || '未分析';
    byRec[r] = (byRec[r] || 0) + 1;
  }
  // 平均值只对存在且有限数值的岗位求平均；缺失不当作 0 分；全无效 → null（展示层显示"暂无数据"）
  const avg = (arr, f) => {
    const vals = arr.map(f).filter(v => typeof v === 'number' && Number.isFinite(v));
    return vals.length ? Math.round(vals.reduce((s, x) => s + x, 0) / vals.length * 10) / 10 : null;
  };
  const newest = runs[runs.length - 1];
  const profileJobSearch = profile?.job_search || {};

  return {
    generated_at: new Date().toISOString(),
    candidate: {
      full_name: profile?.candidate?.full_name || null,
      location: profile?.candidate?.location || null,
      current_title: profile?.candidate?.current_title || null,
      current_employer: profile?.candidate?.current_employer || null,
    },
    search_config: {
      target_titles: profileJobSearch.target_titles || newest?.config?.target_titles || [],
      target_city: profileJobSearch.target_city || newest?.config?.target_city || [],
      target_districts: profileJobSearch.target_districts || newest?.config?.target_districts || [],
      salary_min_k: profileJobSearch.salary_min_k ?? newest?.config?.salary_min_k ?? null,
      salary_max_k: profileJobSearch.salary_max_k ?? newest?.config?.salary_max_k ?? null,
      max_jobs_per_run: profileJobSearch.max_jobs_per_run ?? null,
    },
    last_run_at: newest?.rescored_at || newest?.run_at || null,
    runs: runMetas,
    jobs,
    stats: {
      total: jobs.length,
      latest_run_new: newest ? (newest.counters?.collected ?? newest.jobs?.length ?? 0) : 0,
      analyzed: analyzed.length,
      shortlisted: jobs.filter(j => j.shortlisted).length,
      by_recommendation: byRec,
      avg_cv_match: avg(analyzed, j => j.analysis.cv_match_score),
      avg_career_ops_score: avg(analyzed, j => j.analysis.career_ops_score),
    },
    tracker: { file: 'data/applications.md', rows: appRows.length },
    inbox_pending: countInbox(inboxDir),
    states: CANONICAL_STATES.map(s => ({ id: s, zh: STATE_ZH[s] })),
    report_files: reportFiles,
    health: {
      ok: true,
      files: {
        results: runs.length,
        applications_md: appRows.length,
        reports_md: reportFiles.length,
        inbox_json: countInbox(inboxDir),
      },
    },
    last_viewed: dashboardState?.last_viewed || null,
  };
}

export function makeStatusHandler({ dataDir, additionsDir, mergeCommand }) {
  return function applyStatus({ job, status }) {
    if (!CANONICAL_STATES.includes(status)) {
      return { ok: false, error: `非法状态：${status}（canonical: ${CANONICAL_STATES.join('/')}）` };
    }
    if (!job.job_id) {
      return { ok: false, error: 'JOB_NOT_FOUND', detail: '岗位缺少稳定 job_id，拒绝模糊写回' };
    }
    const appsPath = path.join(dataDir, 'applications.md');
    let appsText = readTextSafe(appsPath);
    if (appsText == null) {
      appsText = '# Applications Tracker\n\n| # | Date | Company | Role | Job ID | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|--------|-------|--------|-----|--------|-------|\n';
    }

    // ── 岗位身份匹配（唯一 SoT = findTrackerRows：job_id → URL → 公司+精确岗位名，禁 fuzzy）──
    const appRows = parseApplications(appsText);
    const matched = findTrackerRows(appRows, job);
    if (matched.length > 1) {
      return { ok: false, error: 'AMBIGUOUS_JOB_MATCH', matches: matched.map(m => `#${m['#']} ${m.company} / ${m.role}`) };
    }
    const existing = matched[0] || null;

    if (existing) {
      // 已有岗位：原位只改目标行并回填 Job ID（legacy 行补齐身份）
      const { text: newText, updated } = updateApplicationsStatus(appsText, {
        company: existing.company || job.company, role: existing.role || job.title, status, job_id: job.job_id,
      });
      if (!updated) {
        return { ok: false, error: 'TRACKER_ROW_NOT_UPDATED', detail: `tracker 命中 #${existing['#']} 但原位更新失败（company=${job.company} role=${job.title}）` };
      }
      fs.writeFileSync(appsPath, newText, 'utf8');
      // 写后验证：重新读盘解析必须看到该 job_id 行的新状态
      const verifyRows = parseApplications(readTextSafe(appsPath) || '');
      const verify = findTrackerRows(verifyRows, job)[0] || null;
      if (!verify || verify.status !== status) {
        return { ok: false, error: 'POST_WRITE_VERIFY_FAILED', detail: `期望 ${status}，实际 ${verify ? verify.status : '未找到'}` };
      }
      return { ok: true, how: 'updated-in-place', status };
    }

    // ── 新岗位首次写入：TSV + merge-tracker 管道（行携带 Job ID，同公司不同岗位各自成行）──
    fs.mkdirSync(additionsDir, { recursive: true });
    const maxNum = appRows.reduce((m, r) => Math.max(m, parseInt(r['#'], 10) || 0), 0);
    const num = String(maxNum + 1).padStart(3, '0');
    const date = new Date().toISOString().slice(0, 10);
    const tsv = buildTsvLine({
      num, date,
      company: job.company,
      role: job.title,
      job_id: job.job_id,
      status,
      score: job.analysis?.career_ops_score ? `${job.analysis.career_ops_score}/5` : '-/5',
      pdf: '❌',
      report: '-',
      notes: 'via dashboard status change',
    });
    const tsvPath = path.join(additionsDir, `dashboard-${job.job_id}.tsv`);
    fs.writeFileSync(tsvPath, tsv + '\n', 'utf8');
    const res = mergeCommand(); // 同步执行 node tools/merge-tracker.mjs
    // 写后验证：merge 后该 job_id 必须以目标状态出现，否则向调用方报错（不静默）
    const afterText = readTextSafe(appsPath) || '';
    const verify = findTrackerRows(parseApplications(afterText), job)[0] || null;
    if (!verify || verify.status !== status) {
      return { ok: false, error: 'POST_WRITE_VERIFY_FAILED', detail: `merge 后未在 tracker 找到目标岗位的 ${status} 状态`, merge: res };
    }
    return { ok: true, how: 'tsv+merge', status, tsv: path.basename(tsvPath), merge: res };
  };
}
