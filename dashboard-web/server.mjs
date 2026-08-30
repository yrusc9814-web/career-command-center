#!/usr/bin/env node
// server.mjs — Career Ops Dashboard 本地展示层
//
//   npm run dashboard → http://127.0.0.1:8790
//
// 只读聚合 Career Ops 已有数据（results / history / inbox / reports / applications.md / profile.yml），
// 可写状态仅 data/dashboard-state.json（shortlist / UI 偏好 / last_viewed）与 canonical 状态写回
// （applications.md 原位更新，或 TSV + merge-tracker 合规管道）。
// 不调用 Boss、不控制 WebBridge、不调用任何 AI、不监听 0.0.0.0。

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import {
  buildState, makeStatusHandler, CANONICAL_STATES,
} from './lib/aggregator.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(ROOT, 'data');
const REPORTS = path.join(ROOT, 'reports');
const OUTPUT = path.join(ROOT, 'output');
const INBOX = path.join(ROOT, 'inbox');
const ADDITIONS = path.join(ROOT, 'batch', 'tracker-additions');
const STATE_FILE = path.join(DATA, 'dashboard-state.json');
const PROFILE_FILE = path.join(ROOT, 'config', 'profile.yml');

const PORT = 8790;
const HOST = '127.0.0.1';

function loadProfile() {
  const text = fs.readFileSync(PROFILE_FILE, 'utf8');
  return loadYaml(text) || {};
}

function loadDashboardState() {
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').toString() || '{}');
}

function saveDashboardState(state) {
  // 只允许保存三类字段，防污染
  const clean = {
    shortlisted: state.shortlisted || {},
    ui: state.ui || {},
    last_viewed: state.last_viewed ?? null,
  };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

function readDashboardState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

function currentJobState(jobId) {
  const state = buildState({
    dataDir: DATA, outputDir: OUTPUT, reportsDir: REPORTS, inboxDir: INBOX,
    profile: loadProfile(), dashboardState: readDashboardState(),
  });
  return state.jobs.find(j => j.job_id === jobId) || null;
}

const mergeTracker = () => {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'merge-tracker.mjs')], {
      cwd: ROOT, encoding: 'utf8', timeout: 30000,
    });
    return { ok: true, output: out.slice(-400) };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300) };
  }
};
const applyStatus = makeStatusHandler({
  dataDir: DATA, additionsDir: ADDITIONS, mergeCommand: mergeTracker,
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendJson(res, code, obj) { send(res, code, JSON.stringify(obj)); }

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB)) return sendJson(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'not found', 'text/plain; charset=utf-8');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

function newestFile(dir, prefix) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith(prefix))
      .sort();
    return files.length ? path.join(dir, files[files.length - 1]) : null;
  } catch { return null; }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = u.pathname;

  try {
    if (req.method === 'GET' && (p === '/' || p === '/index.html' || p === '/styles.css' || p === '/app.js' || p === '/lib/view-model.mjs')) {
      return serveStatic(res, p);
    }

    if (req.method === 'GET' && p === '/api/health') {
      return sendJson(res, 200, { ok: true, service: 'career-ops-dashboard', port: PORT, host: HOST });
    }

    if (req.method === 'GET' && p === '/api/state') {
      const state = buildState({
        dataDir: DATA, outputDir: OUTPUT, reportsDir: REPORTS, inboxDir: INBOX,
        profile: loadProfile(), dashboardState: readDashboardState(),
      });
      return sendJson(res, 200, state);
    }

    if (req.method === 'GET' && p === '/api/report') {
      const rel = u.searchParams.get('file') || '';
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(REPORTS) || !file.endsWith('.md') || !fs.existsSync(file)) {
        return sendJson(res, 404, { error: 'report not found' });
      }
      return sendJson(res, 200, { file: rel, content: fs.readFileSync(file, 'utf8') });
    }

    if (req.method === 'GET' && p === '/api/export/latest-excel') {
      const file = newestFile(OUTPUT, 'boss-jobs-');
      if (!file) return sendJson(res, 404, { error: 'no excel yet' });
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${path.basename(file)}"`,
      });
      return res.end(fs.readFileSync(file));
    }

    if (req.method === 'GET' && p === '/api/export/latest-md') {
      const file = newestFile(REPORTS, 'browser-search-');
      if (!file) return sendJson(res, 404, { error: 'no markdown yet' });
      return sendJson(res, 200, { file: path.basename(file), content: fs.readFileSync(file, 'utf8') });
    }

    if (req.method === 'POST' && (p === '/api/shortlist' || p === '/api/last-viewed')) {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
      return req.on('end', () => {
        const { job_id, shortlisted } = JSON.parse(body || '{}');
        const st = readDashboardState();
        if (p === '/api/shortlist') {
          st.shortlisted = st.shortlisted || {};
          if (shortlisted) st.shortlisted[job_id] = true;
          else delete st.shortlisted[job_id];
        } else {
          st.last_viewed = job_id || null;
        }
        saveDashboardState(st);
        return sendJson(res, 200, { ok: true, state: st });
      });
    }

    if (req.method === 'POST' && p === '/api/status') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 10000) req.destroy(); });
      return req.on('end', () => {
        const { job_id, status } = JSON.parse(body || '{}');
        if (!CANONICAL_STATES.includes(status)) {
          return sendJson(res, 400, { error: `非法状态 ${status}；canonical: ${CANONICAL_STATES.join('/')}` });
        }
        const job = currentJobState(job_id);
        if (!job) return sendJson(res, 404, { error: `job ${job_id} not found` });
        const result = applyStatus({ job, status });
        if (!result.ok) return sendJson(res, 400, result);
        const state = buildState({
          dataDir: DATA, outputDir: OUTPUT, reportsDir: REPORTS, inboxDir: INBOX,
          profile: loadProfile(), dashboardState: readDashboardState(),
        });
        return sendJson(res, 200, { ok: true, how: result.how, job: state.jobs.find(j => j.job_id === job_id) });
      });
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJson(res, 500, { error: String(e && e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`求职决策中枢 Dashboard → http://${HOST}:${PORT}`);
  console.log('  数据源: data/search-results-*.json, inbox/, reports/, data/applications.md, config/profile.yml');
  console.log('  只读展示层；可写仅 dashboard-state.json 与 canonical 状态写回');
});
