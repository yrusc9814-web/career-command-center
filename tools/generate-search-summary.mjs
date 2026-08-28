#!/usr/bin/env node
// generate-search-summary.mjs — browser-search 运行结果 → Markdown 汇总 + Excel 导出
//
// Usage:
//   node tools/generate-search-summary.mjs [data/search-results-YYYYMMDD-HHmm.json]
//   npm run search:report -- data/search-results-....json
//
// Input schema: see modes/browser-search.md ("Schema — run results").
// Outputs (next to repo root):
//   reports/browser-search-<YYYY-MM-DD-HHmm>.md
//   output/boss-jobs-<YYYY-MM-DD-HHmm>.xlsx

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const REPORTS = path.join(ROOT, 'reports');
const OUTPUT = path.join(ROOT, 'output');

function pickInput() {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^search-results-\d{8}-\d{4}\.json$/.test(f))
    .sort();
  if (!files.length) {
    console.error('未找到 data/search-results-*.json。先运行 /career-ops browser-search 采集岗位。');
    process.exit(1);
  }
  return path.join(DATA_DIR, files[files.length - 1]);
}

function readResults(inputPath) {
  const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(raw.jobs)) {
    console.error(`输入文件格式不对（缺少 jobs 数组）：${inputPath}`);
    process.exit(1);
  }
  return raw;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function stampFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
}

function parseRunStamp(runAt) {
  const d = runAt ? new Date(runAt) : new Date();
  return isNaN(d) ? stampFromDate(new Date()) : stampFromDate(d);
}

const s = (v) => v === null || v === undefined ? '' : String(v);
const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;

function effectiveScore(j) {
  const a = j.analysis || {};
  // 新字段 career_ops_score（评分引擎产出）优先，兼容旧 score / rule_score
  return num(a.career_ops_score) ?? num(a.score) ?? num(a.rule_score) ?? null;
}

function confidenceText(j) {
  const c = j.analysis?.score_confidence;
  if (!c || c.percent == null) return '';
  return `${c.percent}% · ${c.level}`;
}

function cvMatchText(j) {
  const a = j.analysis || {};
  if (a.cv_match_score != null) return `${a.cv_match_score}%`;
  return s(a.cv_match || '');
}

function salaryText(j) { return s(j.salary) || ''; }

function districtText(j) { return [s(j.city), s(j.district)].filter(Boolean).join('-'); }

function gapsText(a) { return Array.isArray(a.gaps) && a.gaps.length ? a.gaps.join('；') : s(a.gaps || ''); }

function mdCell(v) {
  return s(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>').slice(0, 300);
}

// ---------- Markdown ----------

function buildMarkdown(data) {
  const jobs = data.jobs;
  const ranked = [...jobs].filter(j => effectiveScore(j) !== null)
    .sort((a, b) => effectiveScore(b) - effectiveScore(a));
  const top10 = ranked.slice(0, 10);
  const c = data.counters || {};

  const L = [];
  L.push(`# Browser Search 汇总 — ${parseRunStamp(data.run_at).replace('-', ' ')}`);
  const cfg = data.config || {};
  L.push('');
  L.push(`- 运行时间：${s(data.run_at)}`);
  L.push(`- 目标：${(cfg.target_titles || []).join(' / ')}｜城市：${(cfg.target_city || []).join('/')}｜区域：${(cfg.target_districts || []).join('/')}`);
  L.push(`- 薪资：${num(cfg.salary_min_k) ?? '?'}K - ${num(cfg.salary_max_k) ?? '?'}K`);
  L.push(`- 计数：发现 ${c.discovered ?? 0} ｜ 打开 ${c.opened ?? 0} ｜ 采集 ${c.collected ?? 0} ｜ 规则跳过 ${c.skipped ?? 0} ｜ 分析 ${c.analyzed ?? 0} ｜ 失败 ${c.failed ?? 0}`);
  L.push('');
  L.push('## 全部岗位');
  L.push('');
  L.push('| 公司 | 岗位 | 区域 | 薪资 | 匹配度 | 综合评分 | 推荐 |');
  L.push('| --- | --- | --- | --- | --- | ---: | --- |');
  for (const j of jobs) {
    const a = j.analysis || {};
    L.push(`| ${mdCell(j.company)} | ${mdCell(j.title)} | ${mdCell(districtText(j))} | ${mdCell(salaryText(j))} | ${mdCell(cvMatchText(j))} | ${effectiveScore(j) ?? ''} | ${mdCell(a.recommendation)} |`);
  }
  L.push('');
  L.push('## TOP 10 最值得投岗位');
  L.push('');
  L.push('| 排名 | 公司 | 岗位 | 区域 | 薪资 | 匹配度 | 综合评分 | 推荐 | 推荐原因 |');
  L.push('| --- | --- | --- | --- | --- | --- | ---: | --- | --- |');
  top10.forEach((j, i) => {
    const a = j.analysis || {};
    L.push(`| ${i + 1} | ${mdCell(j.company)} | ${mdCell(j.title)} | ${mdCell(districtText(j))} | ${mdCell(salaryText(j))} | ${mdCell(cvMatchText(j))} | ${effectiveScore(j) ?? ''} | ${mdCell(a.recommendation)} | ${mdCell(a.recommendation_reason)} |`);
  });
  L.push('');
  return L.join('\n');
}

// ---------- Excel ----------

const COLUMNS = [
  ['公司',            w => w.company],
  ['岗位',            j => j.title],
  ['薪资',            j => j.salary],
  ['城市',            j => j.city],
  ['区域',            j => j.district],
  ['经验',            j => j.experience],
  ['学历',            j => j.education],
  ['行业',            j => j.company_industry],
  ['公司规模',        j => j.company_size],
  ['招聘人',          j => j.recruiter_name],
  ['招聘人活跃状态',  j => j.recruiter_active_status],
  ['岗位链接',        j => j.job_url],
  ['完整JD',          j => j.description],
  ['CV匹配度',        j => cvMatchText(j)],
  ['Career Ops评分',  j => j.analysis?.career_ops_score],
  ['可信度',          j => confidenceText(j)],
  ['初筛分(rule)',    j => j.analysis?.rule_score],
  ['推荐等级',        j => j.analysis?.recommendation],
  ['推荐原因',        j => j.analysis?.recommendation_reason],
  ['主要Gap',         j => Array.isArray(j.analysis?.gaps) ? j.analysis.gaps.join('；') : j.analysis?.gaps],
  ['简历修改建议',    j => j.analysis?.cv_advice],
  ['采集时间',        j => j.collected_at],
];

async function buildExcel(data, outPath) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Boss岗位');

  ws.columns = COLUMNS.map(([name]) => ({ header: name, key: name, width: 14 }));
  // sensible per-column widths
  const widths = [22, 26, 12, 8, 10, 16, 8, 18, 12, 10, 14, 40, 70, 12, 12, 14, 12, 11, 44, 44, 44, 20];
  widths.forEach((w, i) => { if (ws.columns[i]) ws.columns[i].width = w; });

  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle' };
  header.height = 22;

  for (const j of data.jobs) {
    const a = j.analysis || {};
    const row = ws.addRow(COLUMNS.map(([, get]) => get({ ...j, analysis: a })));

    const linkColIdx = COLUMNS.findIndex(([n]) => n === '岗位链接') + 1;
    const linkVal = row.getCell(linkColIdx).value;
    if (linkVal && typeof linkVal === 'string' && linkVal.startsWith('http')) {
      row.getCell(linkColIdx).value = { text: '打开岗位', hyperlink: linkVal };
      row.getCell(linkColIdx).font = { color: { argb: 'FF0563C1' }, underline: true };
    }
    for (const numericName of ['Career Ops评分', '初筛分(rule)']) {
      const idx = COLUMNS.findIndex(([n]) => n === numericName) + 1;
      const cell = row.getCell(idx);
      const raw = cell.value;
      if (raw === null || raw === undefined || raw === '') continue;
      const v = Number(raw);
      cell.value = isFinite(v) ? Math.round(v * 100) / 100 : null;
      cell.numFmt = '0.00';
      cell.alignment = { horizontal: 'right', vertical: 'top' };
    }
    for (let i = 1; i <= COLUMNS.length; i++) {
      const cell = row.getCell(i);
      cell.alignment = cell.alignment?.horizontal
        ? { ...cell.alignment, vertical: 'top', wrapText: true }
        : { vertical: 'top', wrapText: true };
    }
  }

  ws.autoFilter = `A1:${String.fromCharCode(64 + COLUMNS.length)}${Math.max(ws.rowCount, 1)}`;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  await wb.xlsx.writeFile(outPath);
}

// ---------- main ----------

async function main() {
  const inputPath = pickInput();
  const data = readResults(inputPath);

  const stamp = parseRunStamp(data.run_at);
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.mkdirSync(OUTPUT, { recursive: true });

  const mdPath = path.join(REPORTS, `browser-search-${stamp}.md`);
  fs.writeFileSync(mdPath, buildMarkdown(data), 'utf8');

  const xlsxPath = path.join(OUTPUT, `boss-jobs-${stamp}.xlsx`);
  await buildExcel(data, xlsxPath);

  console.log(`✓ Markdown 汇总: ${path.relative(ROOT, mdPath)}`);
  console.log(`✓ Excel 导出:    ${path.relative(ROOT, xlsxPath)}`);
  console.log(`  岗位数: ${data.jobs.length}, TOP10 见 markdown 报告`);
}

main().catch(e => { console.error(e); process.exit(1); });
