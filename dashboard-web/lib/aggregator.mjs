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
  Evaluated: '待决定', Applied: '已投递', Responded: '招聘方已回应', Interview: '面试中',
  Offer: '录用', Rejected: '被拒', Discarded: '已放弃', SKIP: '不投',
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
  const header = lines[headerIdx].split('|').map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
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

/** 原位更新 applications.md 中某行 Status（不增删行、不动其他列） */
export function updateApplicationsStatus(text, { company, role, status }) {
  const lines = text.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => l.includes('|') && /company/i.test(l) && /role/i.test(l));
  if (headerIdx === -1) return { text, updated: false };
  const header = lines[headerIdx].split('|').map(c => c.trim().toLowerCase()).filter(c => c.length > 0);
  const statusCol = header.indexOf('status');
  const companyCol = header.indexOf('company');
  const roleCol = header.indexOf('role');
  let updated = false;
  const nTarget = normalizeCompany(company);
  const roleLc = String(role || '').toLowerCase();
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|')) break;
    const cells = line.split('|');
    const inner = cells.slice(1, -1);
    const rc = normalizeCompany(inner[companyCol]);
    const rr = String(inner[roleCol] || '').toLowerCase();
    const match = (rc.includes(nTarget) || nTarget.includes(rc)) &&
      (rr === roleLc || rr.includes(roleLc) || roleLc.includes(rr));
    if (match) {
      inner[statusCol] = status;
      lines[i] = `| ${inner.map(c => c.trim()).join(' | ')} |`;
      updated = true;
      break;
    }
  }
  return { text: lines.join('\n'), updated };
}

export function buildTsvLine({ num, date, company, role, status, score, pdf, report, notes }) {
  return [num, date, company, role, status, score, pdf, report, notes].join('\t');
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
      const trackerRow = matchTrackerRow(appRows, j);
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
          career_ops_score: a.career_ops_score ?? a.score ?? null,
          rule_score: a.rule_score ?? null,
          score_confidence: a.score_confidence || null,
          score_breakdown: a.score_breakdown || null,
          recommendation: a.recommendation || null,
          recommendation_reason: a.recommendation_reason || null,
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
  const avg = (arr, f) => arr.length ? Math.round(arr.reduce((s, x) => s + f(x), 0) / arr.length * 10) / 10 : null;
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
      avg_cv_match: avg(analyzed, j => j.analysis.cv_match_score ?? 0),
      avg_career_ops_score: avg(analyzed, j => j.analysis.career_ops_score ?? 0),
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
    const appsPath = path.join(dataDir, 'applications.md');
    let appsText = readTextSafe(appsPath);
    if (appsText == null) {
      appsText = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|------|---------|------|-------|--------|-----|--------|-------|\n';
    }
    const { text: newText, updated } = updateApplicationsStatus(appsText, {
      company: job.company, role: job.title, status,
    });
    if (updated) {
      fs.writeFileSync(appsPath, newText, 'utf8');
      return { ok: true, how: 'updated-in-place' };
    }
    // 不在 tracker → 走合规管道：TSV + merge-tracker
    fs.mkdirSync(additionsDir, { recursive: true });
    const num = String(nextReportNum(path.join(dataDir, '..', 'reports'))).padStart(3, '0');
    const date = new Date().toISOString().slice(0, 10);
    const tsv = buildTsvLine({
      num, date,
      company: job.company,
      role: job.title,
      status,
      score: job.analysis?.career_ops_score ? `${job.analysis.career_ops_score}/5` : '-/5',
      pdf: '❌',
      report: job.report_file ? `[${num}](${job.report_file})` : '-',
      notes: 'via dashboard status change',
    });
    const tsvPath = path.join(additionsDir, `dashboard-${job.job_id}.tsv`);
    fs.writeFileSync(tsvPath, tsv + '\n', 'utf8');
    const res = mergeCommand(); // 同步执行 node tools/merge-tracker.mjs
    return { ok: true, how: 'tsv+merge', tsv: path.basename(tsvPath), merge: res };
  };
}
