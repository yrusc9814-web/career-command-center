// dashboard-ui.test.mjs — 原品牌首页 + 成品单文件驾驶舱的入口与数据接线契约
// Run: node --test tools/tests/dashboard-ui.test.mjs
//
// 背景：品牌首页恢复为原成品 index.html（部署为 dashboard-web/home.html，落在 /）；
// 驾驶舱保留为成品单文件 UI（dashboard-web/index.html，落在 /index.html）。
// 旧的 app.js / styles.css / landing 版接线测试（ui-refresh.test.mjs）随实现一起退役。
// 本文件接替它锁定"UI 只做数据接线"这件事：
//   U1 不依赖 mock/demo 数据；
//   U2 读只走 /api/state，写只走 shortlist / status / last-viewed / export；
//   U3 写回失败必须回滚（不允许留下与后端不一致的内存态）；
//   U4 真实数据进 innerHTML 前必须转义（含 JD 原文、缺口、决策链、维度依据）；
//   U5 概览 KPI 用聚合层真实均值，不得写死；
//   U6 默认页 / 是原品牌首页 home.html，/index.html 仍是驾驶舱；
//   U7-U10 真实 server + Chromium 行为回归（环境不具备时跳过，不阻塞静态契约）；
//   H1-H2 品牌首页数据边界静态契约：Top Picks 业务数据（岗位/公司/评分/薪资/Recommendation/
//        状态/计数）不得再硬编码，只能来自 /api/state；原成品 CSS/DOM/粒子引擎不得被接线改写；
//   H3-H4 品牌首页行为回归：demo 模式 Top Picks 来自 Demo Runtime；正式空数据 / 取数失败
//        整块隐藏（null fallback，绝不展示假岗位/假分数）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { rankJobs } from '../../dashboard-web/lib/view-model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WEB = path.join(ROOT, 'dashboard-web');
const UI = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const HOME = fs.readFileSync(path.join(WEB, 'home.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(WEB, 'server.mjs'), 'utf8');
const DEMO_DIR = path.join(ROOT, 'data-demo');

const readUiJs = () => UI.slice(UI.indexOf('<script type="module">'), UI.lastIndexOf('</script>'));
const UI_JS = readUiJs();

// ── U1 不依赖 mock/demo 数据 ────────────────────────────────────────────────
test('U1 正式前端不得引用 mock 数据文件', () => {
  // 允许在注释里说明"原来是 import ... mock-data.js"，但不允许真的存在这条 import
  const importLines = UI.split('\n').filter(l => /^\s*import\b/.test(l));
  assert.ok(!importLines.some(l => l.includes('mock-data')), '不得 import 原目录 / 本地 mock-data.js');
  assert.ok(!importLines.some(l => l.includes('MACRO_INTELLIGENCE')), '死导入 MACRO_INTELLIGENCE 必须移除');
  // mock-data.js 只作为字段形状参考留在目录里：既不被 import，也不在 server 白名单内
  assert.ok(!/\bfrom\s+['"]\.\/mock-data\.js['"]/.test(UI), '不得 import 本地 mock-data.js');
  assert.ok(!SERVER.includes("'mock-data.js'"), 'server 白名单不得放行 mock-data.js');
});

// ── U2 读 / 写的唯一入口 ────────────────────────────────────────────────────
test('U2 驾驶舱只消费 /api/state，写回走 shortlist / status / last-viewed / export', () => {
  assert.ok(UI.includes("fetch('/api/state'"), '数据读取只走 /api/state');
  for (const ep of ['/api/shortlist', '/api/status', '/api/last-viewed', '/api/export/latest-excel', '/api/export/latest-md']) {
    assert.ok(UI.includes(ep), `必须接线 ${ep}`);
  }
  // 不允许绕过 server 直接读本地数据文件或调用外部站点
  assert.ok(!/import\s+[^(]*from\s+['"][^'"]*\.json['"]/.test(UI), '不得 import 本地 json');
  assert.ok(!/fetch\(['"`]https?:/.test(UI), '前端不得直连外部 URL 取数');
  // API 契约字段：前端按后端真实字段名取身份（job_id），不猜
  assert.ok(UI.includes('id: j.job_id'), 'job 身份来自后端 job_id');
});

// ── U3 写回必须有回滚路径 ───────────────────────────────────────────────────
test('U3 写回失败一律回滚，不留与后端不一致的内存态', () => {
  assert.ok(UI.includes('job.shortlisted = prev;'), '想投写回失败 → 回滚 shortlisted');
  // 状态写回失败：必须把 job.status 回滚到「服务端已确认状态」（不再是某个点击前的瞬时旧值），
  // 且同岗位写回必须串行（per-job queue + request sequence），否则旧请求的失败/响应会污染新状态。
  assert.ok(/const statusMutations = new Map\(\)/.test(UI), '同岗位状态写回须有 per-job 串行控制结构（MAJOR-3）');
  assert.ok(/\.catch\(err => \{[\s\S]{0,400}Object\.assign\(job, ctl\.confirmed\)/.test(UI),
    '状态写回失败 → 回滚到服务端已确认状态');
  assert.ok(/if \(seq !== ctl\.seq\) return;/.test(UI), '过时请求的响应/失败不得回写 UI（request sequence）');
  assert.ok(/postJson\('\/api\/status'[\s\S]{0,400}data\.job/.test(UI), '状态写回成功后以服务端回读值为准');
  // 不允许残留"只改内存不写后端"的裸赋值
  assert.ok(!/job\.shortlisted = !job\.shortlisted;\s*\n\s*render/.test(UI), '不得残留裸内存写（列表星标）');
  assert.ok(!/job\.status = item\.dataset\.status;/.test(UI), '不得残留裸内存写（状态下拉）');
});

// ── U4 真实数据进 innerHTML 前转义 ──────────────────────────────────────────
test('U4 进入 innerHTML 的真实字段必须经过 esc()/listify()/jdHtml() 转义', () => {
  assert.ok(/function esc\(v\)/.test(UI) && UI.includes("'&quot;'"), 'esc() 覆盖标签与引号（含属性上下文）');
  assert.ok(UI.includes('const s = esc(String(text).trim());'), 'listify 先转义再排版');
  assert.ok(UI.includes('return esc(text)'), 'jdHtml 先转义再排版');
  // 抽样锁定：这些真实数据插值点必须包 esc()
  for (const re of [
    /\$\{esc\(j\.title\)\}/,                       // 列表标题
    /\$\{esc\(s\)\}<\/span><\/li>/.source ? /\$\{esc\(s\)\}/ : null,   // 优势条目
    /\$\{esc\(t\)\}/,                              // 决策链一行
    /\$\{esc\(dim\.name\)\}/,                      // 维度名
    /\$\{esc\(\(j\.collected_at \|\| ''\)\.slice\(0, 10\)\)\}/, // 采集时间
  ].filter(Boolean)) {
    assert.ok(re.test(UI_JS), `插值点缺少转义：${re}`);
  }
  assert.ok(!/\$\{job\.jd_original\}|\$\{job\.cv_advice\}|\$\{job\.interview_focus\}/.test(UI), '长文本字段不得裸插值');
  assert.ok(!/\$\{t\.question\}|\$\{t\.answer_strategy\}/.test(UI), '防雷真题不得裸插值');
  // 外链 href 只允许 http(s)
  assert.ok(UI.includes('function safeUrl(u)'), 'Boss 原链接经 safeUrl 过滤');
});

// ── U5 KPI 与侧栏计数来自真实数据 ───────────────────────────────────────────
test('U5 概览 KPI 用聚合层真实均值，不再写死；滚动动画机制保持', () => {
  assert.ok(!/const valCv = '/.test(UI) && !/const valOps = '/.test(UI), '平均 CV / Career 不得写死字面量');
  assert.ok(UI.includes('apiStats.avg_cv_match') && UI.includes('apiStats.avg_career_ops_score'), '优先消费 /api/state 的 stats');
  assert.ok(UI.includes("meanOf(MOCK_JOBS.map(j => j.cv_match_score))"), '兜底均值口径：仅有效数值');
  // 数字滚轮（老虎机）实现本身不得被改动
  assert.ok(UI.includes('function rollOdometer(container, targetValue'), 'rollOdometer 保持原实现');
  assert.ok(UI.includes("s.style.transform = 'translateY(0)'"), '滚轮起点归零保持');
  assert.ok(UI.includes('void container.offsetWidth'), '滚轮回流强制保持');
  assert.ok(UI.includes('.ticker-strip'), '滚轮 DOM 结构保持');
});

// ── U6 默认页与原品牌首页同源 ───────────────────────────────────────────────
test('U6 server 默认页即原品牌首页 home.html，且 API 路由仍优先于静态', () => {
  assert.ok(SERVER.includes("'index.html'"), 'index.html 必须在静态白名单内（驾驶舱）');
  assert.ok(SERVER.includes("'home.html'"), 'home.html 必须在静态白名单内（品牌首页）');
  assert.ok(SERVER.includes("urlPath === '/' ? 'home.html'"), "'/' 直接落到品牌首页 home.html");
  assert.ok(SERVER.includes("p === '/' ? '/home.html'"), "createServer 的 '/' 也落到 home.html");
  assert.ok(SERVER.includes("if (req.method === 'GET' && !p.startsWith('/api/'))"), 'API 优先于静态');
  // 品牌首页不依赖外置样式/脚本文件，且不是已退役的 landing.html
  assert.ok(!/<link rel="stylesheet" href="\/styles\.css">/.test(HOME), 'home.html 不得引用已退役的 /styles.css');
  assert.ok(!/<script type="module" src="\/app\.js">/.test(HOME), 'home.html 不得引用已退役的 /app.js');
  assert.ok(HOME.includes('启动驾驶舱'), '品牌首页保留原始启动驾驶舱入口');
  assert.ok(HOME.includes('href="/index.html"'), '驾驶舱链接指向 /index.html');
  assert.ok(HOME.includes('href="/home.html"'), '品牌 logo 自链指向 /home.html');
  assert.ok(UI.includes('id="claude-shell"'), '/index.html serve 出去的就是成品驾驶舱 UI');
  // 静态白名单不得再列已不存在的文件（app.js / styles.css / landing.html 已清理）
  const allowBlock = /const STATIC_ALLOW = new Set\(\[([\s\S]*?)\]\);/.exec(SERVER);
  assert.ok(allowBlock, '定位到 STATIC_ALLOW 白名单定义');
  const allowList = allowBlock[1];
  for (const stale of ["'app.js'", "'styles.css'", "'landing.html'"]) {
    assert.ok(!allowList.includes(stale), `STATIC_ALLOW 仍列着已删除的 ${stale}`);
  }
  // 白名单里的每一条都必须真实存在
  for (const m of allowList.matchAll(/'([^']+)'/g)) {
    assert.ok(fs.existsSync(path.join(WEB, m[1])), `STATIC_ALLOW 指向不存在的文件：${m[1]}`);
  }
  assert.ok(allowList.includes("'home.html'") && allowList.includes("'index.html'"),
    "STATIC_ALLOW 同时放行 home.html 与 index.html");
});

// ── U6b 页面文案不再残留成品的写死样本数字 ──────────────────────────────────
test('U6b 成品样例里的写死数字（86 / 42 / 24 / 78.6 / 76.5 / 8 个标的）不得残留在页面文案', () => {
  const js = UI.slice(UI.indexOf('<script type="module">'));
  for (const probe of ['86 岗位', '42 岗位', '分析：24 岗位', '共 86 份', "'78.6'", "'76.5'", '已研判 8 个', '共 3 个抓取批次']) {
    assert.ok(!js.includes(probe), `仍残留写死文案：${probe}`);
  }
});

// ── U6c 展示路径与 HTML 骨架都不得把缺值评分伪造为 0 / 残留成品示例数字 ──────
test('U6c 缺值评分不显示 0 分；HTML 骨架不残留成品示例分数', () => {
  // 1) JS 展示路径：不得再有把缺值评分当 0 的写法出现在“分数文本 / 进度条宽度”里
  //    （排序比较器里的 `|| 0` 只是 null 参与比较的兜底，不产生任何用户可见文本，允许保留）
  const displayLines = UI_JS.split('\n').filter(l =>
    /\.textContent\s*=|\.style\.width\s*=|innerHTML\s*=|\$\{/.test(l) && /分|%/.test(l));
  for (const line of displayLines) {
    assert.ok(!/(cv_match_score|career_ops_score)\s*(\?\?|\|\|)\s*0/.test(line),
      `展示路径仍把缺值评分当 0：${line.trim()}`);
  }
  // 也不得出现“无 null 守卫的裸插值分数文本”（`${cvScore} 分` 直接赋给 textContent）
  assert.ok(!/textContent = `\$\{(cvScore|opsScore|confScore)\} 分`;/.test(UI_JS),
    '缺值分数不得裸插值为 "0 分"');
  // 十维明细表：score=null 的维度不得用 Number(null)=0 算出 0.0 加权分
  assert.ok(/dimKnown \? \(\(Number\(d\.score\) \* Number\(d\.weight\)\) \/ 100\)\.toFixed\(1\) : '—'/.test(UI_JS),
    '十维加权分缺值显示 —');
  // 2) HTML 骨架（<script> 之前）不得残留成品的示例分数 / 计数 / 薪资
  const skeleton = UI.slice(0, UI.indexOf('<script type="module">'));
  for (const probe of ['88 分', '86.5', '92 分', 'width:88%', 'width:92%', 'width:86.5%',
    'id="cnt-all">8<', 'id="cnt-shortlist">4<', 'id="cnt-runs">3<', '18-25K · 14薪', '汇川智能']) {
    assert.ok(!skeleton.includes(probe), `HTML 骨架残留成品示例数据：${probe}`);
  }
  // 3) 三根量规的静态初值必须是中性占位（文本 — ，宽度 0%）
  for (const id of ['dt-cv-val', 'dt-ops-val', 'dt-conf-val']) {
    assert.ok(skeleton.includes(`id="${id}">—</span>`), `${id} 静态占位应为 —`);
  }
  for (const id of ['dt-cv-bar', 'dt-ops-bar', 'dt-conf-bar']) {
    assert.ok(skeleton.includes(`id="${id}" style="width:0%"`), `${id} 静态宽度应为 0%`);
  }
});

// ── H1 品牌首页数据边界：Top Picks 业务数据只能来自 /api/state ────────────────
test('H1 home.html 不再硬编码业务数据；岗位/评分/薪资/计数全部接线 /api/state', () => {
  // 1) 原成品 mock 岗位 / 公司 / 分数 / 薪资 / 状态 / 计数不得以任何形式残留在页面
  for (const probe of [
    '汇川智能', '天合光能', '迈为股份',
    '综合 86.5', '综合 83.0', '综合 91.5',
    '契合度 88%', '契合度 72%', '契合度 86%',
    '18-25K', '16-22K', '25-35K',
    '品类采购主管（精密机械与原材料）', '高级寻源采购工程师（电池模组/电气辅料）', '战略采购经理（电气及自动化组件）',
    '业务复试中', '年包 45W', '双休', '进入全部决策流 (8个)',
  ]) {
    assert.ok(!HOME.includes(probe), `home.html 仍残留 mock 业务数据：${probe}`);
  }
  // 2) 卡片网格在骨架中是空容器，只能由数据渲染填充（与原成品 tp-card 结构一致）
  assert.ok(/<div class="top-picks-grid" id="top-picks-grid"><\/div>/.test(HOME),
    'top-picks-grid 必须是数据驱动的空容器骨架');
  // 3) 读取唯一来源 /api/state；排序复用驾驶舱 rankJobs；真实数据转义；不外链取数
  assert.ok(HOME.includes("fetch('/api/state'"), '首页业务数据只能来自 /api/state');
  assert.ok(/import\s*\{\s*rankJobs\s*\}\s*from\s*['"]\.\/lib\/view-model\.mjs['"]/.test(HOME),
    'Top Picks 排序复用驾驶舱同一 rankJobs，不建立第二套排序');
  assert.ok(/function esc\(v\)/.test(HOME), '真实字段进 innerHTML 前必须经过 esc()');
  assert.ok(!/fetch\(['"`]https?:/.test(HOME), '首页不得直连外部 URL 取数');
  assert.ok(!/innerHTML\s*=\s*'[^']*\S[^']*'/.test(HOME.slice(HOME.indexOf('<script type="module">'))
    .replace(/grid\.innerHTML[\s\S]*?join\('\\n'\);/, '')), '除数据渲染外不得有静态 innerHTML 注入');
  // 4) 接线脚本依赖的 lib/view-model.mjs 必须在 server 静态白名单内
  assert.ok(SERVER.includes("'lib/view-model.mjs'"), 'STATIC_ALLOW 必须放行 lib/view-model.mjs');
});

// ── H2 原成品 UI 资产逐字保留（数据接线不得改写 CSS / DOM / 粒子引擎）────────
test('H2 home.html 原成品 CSS、品牌区 DOM 与 canvas 粒子引擎不被数据接线改写', () => {
  // 1) 页面样式全部内联；Top Picks 视觉规则原样保留（卡片仍由原 class 渲染）
  const style = HOME.slice(0, HOME.indexOf('</style>'));
  for (const probe of [
    '.tp-card {', '.tp-card:hover {', 'transform: translateY(-4px)',
    'transition: transform 0.3s var(--ease-monolog)', '.tp-rank {', '.tp-score-chip {',
    '.tp-body h4 {', '.tp-role {', '.tp-salary {', '.tp-cta {', '.top-picks-grid {',
  ]) {
    assert.ok(style.includes(probe), `CSS 缺失原成品规则：${probe}`);
  }
  // 2) 品牌区骨架：噪点层 / 粒子画布 / 顶栏 / Hero 雷达与 logo 保持原 DOM
  assert.ok(HOME.includes('class="grain-overlay"') && HOME.includes('id="ambient-canvas"'), '背景噪点与粒子画布骨架原样');
  assert.ok(HOME.includes('radar-compass-svg') && HOME.includes('class="navbar"'), '品牌区 Hero/顶栏 DOM 原样');
  // 3) 原成品动画脚本（第一个内联 <script>）零数据逻辑：不含 fetch / innerHTML / 接口路径
  const animScript = HOME.slice(HOME.indexOf('<script>'), HOME.indexOf('</script>'));
  assert.ok(animScript.length > 1000, '定位到原粒子引擎脚本');
  assert.ok(!/fetch\(|innerHTML|\/api\//.test(animScript), '原动画脚本不得混入数据接线逻辑');
  for (const probe of ['const PARTICLE_COUNT = 260;', 'function initParticles()', 'function render()',
    'function resizeCanvas()', 'requestAnimationFrame(render);']) {
    assert.ok(animScript.includes(probe), `粒子引擎被改动：${probe}`);
  }
  // 4) 驾驶舱的 rollOdometer / 滚轮 / KPI 动画机制不因首页接线被重写（U5 已锁实现，这里锁定调用面）
  assert.ok(UI.includes('rollOdometer(document.getElementById(\'k-num-analyzed\')'), '驾驶舱 KPI 滚动调用保持');
  // 5) 首页业务数据接线只有这一个 module 脚本，两个脚本之外页面不得再有内联脚本
  assert.equal((HOME.match(/<script/g) || []).length, 2, 'home.html 只允许 原动画 + 数据接线 两个脚本块');
});

// ── 行为回归：真实 server + Chromium（环境缺失即 skip）────────────────────────
function chromiumExes() {  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright'));
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!/^chromium(-headless_shell)?-\d+/.test(e.name)) continue;
    for (const rel of [['chrome-win64', 'chrome.exe'], ['chrome-headless-shell-win64', 'chrome-headless-shell.exe']]) {
      const p = path.join(dir, e.name, ...rel);
      if (fs.existsSync(p)) out.push(p);
    }
  }
  return out;
}
let chromium = null;
try { ({ chromium } = createRequire(path.join(ROOT, 'package.json'))('playwright')); } catch { chromium = null; }
async function launch() {
  if (!chromium) return null;
  for (const executablePath of [undefined, ...chromiumExes()]) {
    try { return await chromium.launch(executablePath ? { executablePath } : {}); } catch { }
  }
  return null;
}
async function startServer(demo = true) {
  const port = 19300 + Math.floor(Math.random() * 150);
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(WEB, 'server.mjs'), ...(demo ? ['--demo'] : [])], {
    cwd: ROOT, env: { ...process.env, DASHBOARD_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(`${base}/api/health`)).ok) return { base, child }; } catch { }
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('dashboard server 未启动：' + stderr);
}
const snapshotDemo = () => {
  const files = {};
  for (const f of ['dashboard-state.json', 'applications.md']) {
    const p = path.join(DEMO_DIR, f);
    if (fs.existsSync(p)) files[p] = fs.readFileSync(p, 'utf8');
  }
  return files;
};
const restoreDemo = (files) => { for (const [p, v] of Object.entries(files)) fs.writeFileSync(p, v, 'utf8'); };

test('U7-U10 行为：真实数据渲染 / 写回落盘 / 导出下载 / XSS 不执行', { skip: chromium ? false : '未安装 playwright，跳过浏览器行为回归' }, async () => {
  const before = snapshotDemo();
  const { base, child } = await startServer();
  const browser = await launch();
  assert.ok(browser, 'chromium 未能启动');
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    const reqs = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('request', r => { const p = new URL(r.url()).pathname; if (!reqs.some(x => x.method === r.method() && x.p === p)) reqs.push({ method: r.method(), p }); });

    // 品牌首页落在 /；驾驶舱落在 /index.html
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    assert.equal(errors.length, 0, '品牌首页零 console/page error：' + errors.join(' | '));
    assert.ok((await page.locator('body').innerText()).includes('启动驾驶舱'), 'GET / 返回品牌首页');
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    const state = await (await fetch(base + '/api/state')).json();
    const digitOf = id => page.evaluate((i) => Array.from(document.querySelectorAll(`#${i} .ticker-strip`)).map(s => s.dataset.target).join(''), id);
    assert.equal(errors.length, 0, '首屏零 console/page error：' + errors.join(' | '));
    assert.equal(await digitOf('k-num-analyzed'), String(state.stats.analyzed), 'KPI 已分析岗位 = Runtime stats.analyzed（不是 total 岗位数）');
    assert.equal(await digitOf('k-num-cv'), String(state.stats.avg_cv_match).replace('.', ''), 'KPI 平均 CV = 聚合层真实均值');
    assert.equal(await page.locator('#cnt-all').textContent(), String(state.jobs.length), '侧栏计数走真实数据');
    assert.equal(await page.locator('#btn-back-home').count(), 1, '/index.html 仍是驾驶舱');

    // 只读 GET 之外的请求必须都是已登记的后端端点
    await page.click('#btn-switch-view');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.job-card-c').count(), state.jobs.length, '列表卡片数 = jobs 数');

    // 想投写回落盘
    const id = await page.evaluate(() => document.querySelector('.job-card-c').dataset.id);
    const wasOn = state.jobs.find(j => j.job_id === id).shortlisted;
    await page.click('.job-card-c [data-star-id]');
    await page.waitForTimeout(900);
    const st1 = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'dashboard-state.json'), 'utf8'));
    assert.equal(!!st1.shortlisted[id], !wasOn, 'POST /api/shortlist 已落盘');
    assert.ok(reqs.some(r => r.method === 'POST' && r.p === '/api/shortlist'), '前端确实发出 /api/shortlist');
    await page.click('.job-card-c [data-star-id]');   // 复位
    await page.waitForTimeout(700);

    // 状态写回 tracker
    await page.click('#btn-flow-status');
    await page.waitForTimeout(200);
    await page.click('.status-dropdown-item[data-status="Applied"]');
    await page.waitForTimeout(2000);
    assert.ok(reqs.some(r => r.method === 'POST' && r.p === '/api/status'), '前端确实发出 /api/status');
    assert.ok(/Applied/.test(fs.readFileSync(path.join(DEMO_DIR, 'applications.md'), 'utf8')), 'canonical 状态写回 tracker');
    assert.equal((await page.locator('#dt-status-pill').textContent()).trim(), '已投递', '状态以服务端回读为准');

    // 切换岗位上报 last-viewed（点击一张既非当前高亮、也非刚才那张星标的卡片）
    let probeId = '';
    await page.evaluate(() => {
      const active = document.querySelector('.job-card-c.active');
      const other = Array.from(document.querySelectorAll('.job-card-c')).find(c => c !== active && !c.querySelector('.jc-star-btn.on'));
      other.querySelector('.jc-title').id = 'probe-title';
      window.__probeId = other.dataset.id;
    });
    await page.click('#probe-title');
    probeId = await page.evaluate(() => window.__probeId);
    await page.waitForTimeout(800);
    const st2 = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'dashboard-state.json'), 'utf8'));
    assert.equal(st2.last_viewed, probeId, 'POST /api/last-viewed 已落盘为被点击岗位');

    // 导出 = attachment 下载，不把当前页顶掉
    const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
    await page.click('#btn-export-excel');
    const download = await dl;
    assert.ok(download, '导出必须产生下载而不是页面跳转');
    assert.ok((page.url()).startsWith(base), '导出后仍停在 Dashboard');

    // XSS：注入探针字段（走真实渲染路径）
    const PROBE = '<img src=x onerror="window.__pwned=1">';
    await ctx.close();
    const ctx2 = await browser.newContext();
    await ctx2.route('**/api/state', async route => {
      const res = await route.fetch();
      const body = await res.json();
      const a = body.jobs[0].analysis;
      body.jobs[0].title = `${PROBE}标题`;
      a.strengths = [PROBE];
      a.cv_advice = `① ${PROBE}\n② 正常`;
      a.interview_focus = PROBE;
      a.recommendation_reason = PROBE;
      a.decision_trace = [{ step: 0, rule: PROBE, outcome: 'x' }];
      a.score_breakdown.dimensions[0].reason = PROBE;
      body.jobs[0].jd_original = `【岗位职责】${PROBE}`;
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
    });
    const page2 = await ctx2.newPage();
    await page2.addInitScript(() => { window.__pwned = 0; });
    await page2.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page2.click('#btn-switch-view');
    await page2.waitForTimeout(800);
    await page2.locator('.job-card-c').first().click();
    await page2.waitForTimeout(500);
    assert.equal(await page2.evaluate(() => window.__pwned), 0, '注入内容不得执行脚本');
    const html = await page2.evaluate(() => document.getElementById('detail-panel').innerHTML);
    assert.ok(html.includes('&lt;img'), '注入标签必须以文本呈现');
    assert.ok(!/<img src=x/.test(html), '不得出现未转义的注入标签');
    await ctx2.close();
  } finally {
    await browser.close();
    child.kill();
    restoreDemo(before);
  }
});

// ── H3 品牌首页行为（demo 模式）：Top Picks 渲染 Demo Runtime 真实数据 ────────
test('H3 demo 首页 Top Picks 来自 Demo Runtime；空数据/取数失败整块隐藏；首页↔驾驶舱互通', { skip: chromium ? false : '未安装 playwright，跳过浏览器行为回归' }, async () => {
  const before = snapshotDemo();
  const { base, child } = await startServer(true);
  const browser = await launch();
  assert.ok(browser, 'chromium 未能启动');
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));

    const state = await (await fetch(base + '/api/state')).json();
    assert.ok(state.jobs.length >= 3, '前提：Demo Runtime 至少有 3 条岗位');
    const top3 = rankJobs(state.jobs).slice(0, 3);   // 与页面同一排序（rankJobs 同源）

    await page.goto(base + '/', { waitUntil: 'networkidle' });
    assert.equal(errors.length, 0, '品牌首页零 console/page error：' + errors.join(' | '));
    assert.ok((await page.locator('body').innerText()).includes('启动驾驶舱'), '/ 仍是品牌首页');

    // 1) Top Picks = rankJobs 前 3，卡片字段与 /api/state 一致
    const cards = page.locator('#top-picks-grid .tp-card');
    assert.equal(await cards.count(), 3, 'Demo 数据 ≥3 时渲染 3 张原结构卡片');
    const texts = await cards.evaluateAll(els => els.map(e => e.innerText));
    top3.forEach((j, i) => {
      assert.ok(texts[i].includes(j.company), `卡片 #0${i + 1} 公司应为 ${j.company}`);
      assert.ok(texts[i].includes(j.title), `卡片 #0${i + 1} 岗位应为 ${j.title}`);
      assert.ok(texts[i].includes(`综合 ${j.analysis.career_ops_score}分`), `卡片 #0${i + 1} 综合分应为真实值`);
      assert.ok(texts[i].includes(`契合度 ${j.analysis.cv_match_score}%`), `卡片 #0${i + 1} CV Match 应为真实值`);
      assert.ok(j.salary ? texts[i].includes(j.salary) : true, `卡片 #0${i + 1} 薪资应为真实值`);
    });
    // 2) 「进入全部决策流」计数 = 真实岗位总数
    assert.ok((await page.locator('#tp-all-link').innerText()).includes(`(${state.stats.total}个)`),
      `总数计数应为真实 stats.total=${state.stats.total}`);
    // 3) 卡片深链指向岗位真实身份（驾驶舱支持 #job= 深链）
    const hrefs = await cards.evaluateAll(els => els.map(e => e.getAttribute('href')));
    top3.forEach((j, i) =>
      assert.equal(hrefs[i], `/index.html#job=${encodeURIComponent(j.job_id)}`, `卡片 #0${i + 1} 深链应指向该岗位`));
    assert.ok(texts[0].includes(top3[0].analysis.recommendation), 'Recommendation 标签来自 Runtime 字段');
    assert.equal(errors.length, 0, 'Top Picks 渲染零错误：' + errors.join(' | '));

    // 4) 首页 → 驾驶舱：点击卡片进入驾驶舱（原 UI 状态机：落地仍是概览视图，
    //    切到三栏后深链岗位即为选中详情 —— 不改驾驶舱行为，测试跟随原交互路径）
    await cards.first().click();
    await page.waitForURL(/\/index\.html#job=/);
    await page.click('#btn-switch-view');
    // dt-title 静态占位为 —，必须等到深链岗位真正渲染完成
    await page.waitForFunction(
      (t) => { const el = document.getElementById('dt-title'); return el && el.textContent === t; },
      top3[0].title, { timeout: 8000 });
    const dtTitle = await page.locator('#dt-title').innerText();
    assert.equal(dtTitle, top3[0].title, '驾驶舱深链选中了点击的岗位');

    // 5) 驾驶舱 → 首页：品牌首页返回入口可达
    await page.click('a[href="/home.html"]');
    await page.waitForURL(/\/home\.html/);
    assert.ok((await page.locator('body').innerText()).includes('启动驾驶舱'), '驾驶舱可返回品牌首页');

    // 6) null fallback：接口返回空 → 整块隐藏，不出现假岗位/假分数
    await ctx.route('**/api/state', route => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ jobs: [], stats: { total: 0 } }),
    }));
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.tp-card').count(), 0, '空数据不得渲染任何卡片');
    assert.equal(await page.locator('#section-preview').isVisible(), false, '空数据时透视区必须隐藏');
    const bodyEmpty = await page.locator('body').innerText();
    for (const fake of ['汇川智能', '天合光能', '迈为股份', '综合 86.5']) {
      assert.ok(!bodyEmpty.includes(fake), `空数据页面不得出现假数据：${fake}`);
    }

    // 7) 取数失败（HTTP 500）→ 同样隐藏（console.warn 提示，不抛 page error）
    await ctx.route('**/api/state', route => route.fulfill({ status: 500, body: 'boom' }));
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    assert.equal(await page.locator('.tp-card').count(), 0, '取数失败不得渲染任何卡片');
    assert.equal(await page.locator('#section-preview').isVisible(), false, '取数失败时透视区必须隐藏');
    assert.equal(errors.filter(e => !e.includes('Failed to load resource')).length, 0,
      '取数失败只 warn，不产生 console/page error：' + errors.join(' | '));
  } finally {
    await browser.close();
    child.kill();
    restoreDemo(before);
  }
});

// ── H4 正式模式品牌首页：data/ 无岗位时不展示假 Top Picks ────────────────────
test('H4 正式模式（data/ 当前为空）品牌首页不出现 mock 岗位/假分数', { skip: chromium ? false : '未安装 playwright，跳过浏览器行为回归' }, async () => {
  const { base, child } = await startServer(false);   // 正式模式：只读 data/，测试不触发任何写路径
  const browser = await launch();
  assert.ok(browser, 'chromium 未能启动');
  try {
    const state = await (await fetch(base + '/api/state')).json();
    const page = await (await browser.newContext()).newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    if (state.jobs.length === 0) {
      // 当前正式事实：data/ 无岗位 → 首页整块隐藏，绝不允许出现原 mock 三张卡
      assert.equal(await page.locator('.tp-card').count(), 0, '正式空数据不得渲染任何岗位卡');
      assert.equal(await page.locator('#section-preview').isVisible(), false, '正式空数据时透视区必须隐藏');
    } else {
      // 正式已有真实岗位时：卡片必须来自 /api/state（排序一致、无 mock 残留）
      const texts = await page.locator('#top-picks-grid .tp-card').evaluateAll(els => els.map(e => e.innerText));
      const top3 = rankJobs(state.jobs).slice(0, 3);
      top3.slice(0, Math.min(3, texts.length)).forEach((j, i) =>
        assert.ok(texts[i].includes(j.company), `正式首页卡片应来自真实数据 ${j.company}`));
    }
    const body = await page.locator('body').innerText();
    for (const fake of ['汇川智能', '天合光能', '迈为股份', '综合 86.5分 · 契合度 88%']) {
      assert.ok(!body.includes(fake), `正式首页出现 mock 残留：${fake}`);
    }
  } finally {
    await browser.close();
    child.kill();
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 独立终审 MAJOR-1 / MAJOR-2 / MAJOR-3 修复契约
//   M1  「已分析岗位 / 已研判」= Runtime analyzed 语义，不得再拿 total（岗位总数）
//   M1b Runtime 必须同时如实提供 total 与 analyzed，且两者口径可区分
//   M2  canonical Rejected 完整接入：筛选可单独筛 / 菜单可写入 / 闭合聚合仍含三态
//   M3  行为：Demo KPI（total=20、analyzed=19）+ Rejected 筛选与写回 + 闭合计数
//   M4  行为：同岗位连续状态写回串行化（per-job queue + request sequence），
//       慢响应不得覆盖新状态，UI 终态与服务端一致、不发生状态回退
// ══════════════════════════════════════════════════════════════════════════
test('M1「已分析岗位 / 已研判」取 Runtime stats.analyzed，不再拿岗位总数当已分析数', () => {
  assert.ok(!/const valAnalyzed = MOCK_JOBS\.length/.test(UI_JS),
    'KPI「已分析岗位」仍以 MOCK_JOBS.length（total）为数据源');
  assert.ok(!/已研判 \$\{MOCK_JOBS\.length\}/.test(UI_JS),
    '「当前大盘：已研判 N」仍以 total 为数据源');
  const fn = /function analyzedCount\(\)\s*\{([\s\S]*?)\n\s{4}\}/.exec(UI_JS);
  assert.ok(fn, '存在统一取数函数 analyzedCount()');
  assert.ok(fn[1].includes('DASH_STATE') && fn[1].includes('stats.analyzed'),
    'analyzedCount() 必须优先读 /api/state 的 stats.analyzed');
  assert.ok(fn[1].includes('career_ops_score != null'),
    'analyzedCount() 前端兜底口径须与聚合层一致（有 Career Score 才算已分析）');
  assert.ok(/const valAnalyzed = analyzedCount\(\);/.test(UI_JS), 'KPI 已分析岗位 = analyzedCount()');
  assert.ok(/已研判 \$\{analyzedCount\(\)\}/.test(UI_JS), '「已研判 N」= analyzedCount()');
  // total 语义的位置仍如实使用 total，不得反向改坏
  assert.ok(/stats\.total != null/.test(UI_JS) && /all: MOCK_JOBS\.length/.test(UI_JS),
    'total 语义（设置页岗位数 / 侧栏全部岗位）保持 total 口径');
});

test('M1b Runtime /api/state 分别提供 total 与 analyzed，未评分岗位不计入 analyzed', async () => {
  const { buildState } = await import('../../dashboard-web/lib/aggregator.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-analyzed-'));
  try {
    fs.writeFileSync(path.join(dir, 'search-results-20200101-fixture.json'), JSON.stringify({
      run_at: '2020-01-01T00:00:00Z',
      counters: { collected: 3 },
      jobs: [
        { job_id: 'a1', title: '采购专员A', company: '甲公司', analysis: { career_ops_score: 80 } },
        { job_id: 'a2', title: '采购专员B', company: '乙公司', analysis: { career_ops_score: 60 } },
        { job_id: 'a3', title: '采购专员C', company: '丙公司', analysis: {} },
      ],
    }), 'utf8');
    const state = buildState({
      dataDir: dir, outputDir: dir, reportsDir: dir, inboxDir: dir,
      profile: {}, dashboardState: {}, demoMode: false,
    });
    assert.equal(state.stats.total, 3, 'total = 全部岗位数');
    assert.equal(state.stats.analyzed, 2, 'analyzed = 有 Career Score 的岗位数');
    assert.notEqual(state.stats.total, state.stats.analyzed, 'fixture 必须能区分两种口径');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M2 canonical Rejected 完整接入：筛选可单独选、菜单可写入、闭合聚合仍含三态', async () => {
  const { CANONICAL_STATES } = await import('../../dashboard-web/lib/aggregator.mjs');
  assert.ok(CANONICAL_STATES.includes('Rejected'), 'Runtime canonical states 含 Rejected');

  // 1) 状态筛选下拉的数据源包含 Rejected，且保持 canonical 相对顺序
  const optBlock = /const statuses = \[([\s\S]*?)\];/.exec(UI_JS);
  assert.ok(optBlock, '定位到状态筛选数据源 statuses');
  const optIds = [...optBlock[1].matchAll(/id: '([A-Za-z]+)'/g)].map(m => m[1]);
  assert.ok(optIds.includes('Rejected'), '状态筛选缺少 Rejected');
  const canonicalPos = s => CANONICAL_STATES.indexOf(s);
  const sorted = [...optIds].sort((x, y) => canonicalPos(x) - canonicalPos(y));
  assert.deepEqual(optIds, sorted, '筛选项顺序必须跟随 canonical states');

  // 2) 状态修改菜单存在 Rejected 项，且复用既有 .status-dropdown-item 结构（未新造控件）
  const menuStart = UI.indexOf('<div class="status-dropdown-menu"');
  const bossLinkAt = UI.indexOf('btn-boss-link', menuStart);
  assert.ok(menuStart > -1 && bossLinkAt > menuStart, '定位到状态修改下拉菜单 DOM');
  const menuBlock = UI.slice(menuStart, bossLinkAt);
  const menuStatuses = [...menuBlock.matchAll(/class="status-dropdown-item" data-status="([A-Za-z]+)"/g)].map(m => m[1]);
  assert.ok(menuStatuses.includes('Rejected'), '状态修改菜单缺少 Rejected 项');
  assert.deepEqual(menuStatuses, CANONICAL_STATES, '状态菜单必须完整覆盖 8 个 canonical states');

  // 3) 菜单点击统一走 changeStatus(dataset.status) → Rejected 可写回，无需特例分支
  assert.ok(/changeStatus\(job, item\.dataset\.status, item\.dataset\.zh\)/.test(UI_JS),
    '菜单点击仍统一透传 data-status');

  // 4) 已放弃 / 淘汰闭合聚合仍同时包含 Rejected、Discarded、SKIP（侧栏计数与视图过滤两处）
  const closedHits = UI_JS.match(/\[\s*'Discarded',\s*'SKIP',\s*'Rejected'\s*\]/g) || [];
  assert.ok(closedHits.length >= 2, 'closed 聚合须同时用于侧栏计数与视图过滤');
});

test('M2b /api/status 写回接受 Rejected 并原位更新 tracker', async () => {
  const { makeStatusHandler } = await import('../../dashboard-web/lib/aggregator.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-rejected-'));
  try {
    const apps = ['# Applications Tracker', '',
      '| # | Date | Company | Role | Job ID | Status | Score | PDF | Report | Notes |',
      '|---|------|---------|------|--------|--------|-------|-----|--------|-------|',
      '| 001 | 2026-01-01 | 甲公司 | 采购专员 | a1 | Applied | 80/100 | ❌ | - | x |',
      ''].join('\n');
    fs.writeFileSync(path.join(dir, 'applications.md'), apps, 'utf8');
    const handler = makeStatusHandler({
      dataDir: dir, additionsDir: path.join(dir, 'additions'), mergeCommand: () => ({ ok: false }),
    });
    const job = { job_id: 'a1', title: '采购专员', company: '甲公司', analysis: { career_ops_score: 80 } };
    const r = handler({ job, status: 'Rejected' });
    assert.equal(r.ok, true, 'Rejected 属 canonical，必须允许写回');
    const after = fs.readFileSync(path.join(dir, 'applications.md'), 'utf8');
    assert.ok(/\| a1 \| Rejected \|/.test(after), 'tracker 行已原位更新为 Rejected');
    const bad = handler({ job, status: 'NotAState' });
    assert.equal(bad.ok, false, '非 canonical 状态仍必须拒绝');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// tracker 读出某 job_id 当前 Status（按表头列名解析，不假设列相邻）
async function demoTrackerStatus(jobId) {
  const { parseApplications } = await import('../../dashboard-web/lib/aggregator.mjs');
  const rows = parseApplications(fs.readFileSync(path.join(DEMO_DIR, 'applications.md'), 'utf8'));
  const row = rows.find(r => String(r.job_id || '').trim() === jobId);
  return row ? row.status : null;
}

// ── M3 行为：KPI 口径 + Rejected 筛选 / 写回（真实 Demo Runtime + Chromium）──
test('M3 行为：Demo 侧栏 total=20、KPI 已分析=19；Rejected 可单独筛选并可写回', { skip: chromium ? false : '未安装 playwright，跳过浏览器行为回归' }, async () => {
  const before = snapshotDemo();
  const { base, child } = await startServer(true);
  const browser = await launch();
  assert.ok(browser, 'chromium 未能启动');
  try {
    const state = await (await fetch(base + '/api/state')).json();
    // 前置事实（Demo Runtime 口径）：total 与 analyzed 必须不同，否则本用例失去区分力
    assert.equal(state.stats.total, 20, 'Demo 总岗位数应为 20');
    assert.equal(state.stats.analyzed, 19, 'Demo 已分析岗位数应为 19');
    const rejectedExpected = state.jobs.filter(j => j.status === 'Rejected').length;
    assert.equal(rejectedExpected, 2, 'Demo 应存在 2 条 Rejected 岗位');

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('dialog', d => d.dismiss().catch(() => { }));
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1600);   // 等滚轮动画落位

    const digitOf = id => page.evaluate((i) => Array.from(document.querySelectorAll(`#${i} .ticker-strip`)).map(s => s.dataset.target).join(''), id);
    assert.equal(await digitOf('k-num-analyzed'), String(state.stats.analyzed), 'KPI「已分析岗位」显示 analyzed（19）');
    assert.notEqual(await digitOf('k-num-analyzed'), String(state.stats.total), 'KPI「已分析岗位」不得显示 total（20）');
    assert.equal(await page.locator('#cnt-all').textContent(), String(state.stats.total), '侧栏「全部岗位」仍为 total');
    assert.equal(await page.locator('#cnt-closed').textContent(),
      String(state.jobs.filter(j => ['Discarded', 'SKIP', 'Rejected'].includes(j.status)).length),
      '侧栏「已放弃 / 淘汰」闭合计数包含 Rejected');

    // 列表视图 → 单独筛选 Rejected
    await page.click('#btn-switch-view');
    await page.waitForTimeout(400);
    const options = await page.locator('#status-filter option').evaluateAll(els => els.map(o => o.value));
    assert.ok(options.includes('Rejected'), '状态下拉缺少 Rejected 选项');
    await page.selectOption('#status-filter', 'Rejected');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('.job-card-c').count(), rejectedExpected, `单独筛选 Rejected 应得 ${rejectedExpected} 条`);
    await page.selectOption('#status-filter', '');
    await page.waitForTimeout(300);

    // 状态修改菜单 → 写回 Rejected
    const target = state.jobs.find(j => j.status === 'Applied' && j.tracker_num);
    assert.ok(target, 'Demo 需存在 Applied 且已进 tracker 的岗位作为写回样本');
    await page.locator(`.job-card-c[data-id="${target.job_id}"] .jc-title`).click();
    await page.waitForTimeout(400);
    await page.click('#btn-flow-status');
    await page.waitForTimeout(200);
    const menuStatuses = await page.locator('.status-dropdown-item').evaluateAll(els => els.map(e => e.dataset.status));
    assert.ok(menuStatuses.includes('Rejected'), '状态修改菜单缺少 Rejected');
    await page.click('.status-dropdown-item[data-status="Rejected"]');
    // 轮询等待落定（并发跑多测试文件时固定 sleep 不稳），最长 15s
    await page.waitForFunction(() => (document.getElementById('dt-status-pill')?.textContent || '').trim() === '未通过',
      null, { timeout: 15000 });
    assert.equal((await page.locator('#dt-status-pill').textContent()).trim(), '未通过', '写回后状态以服务端回读为准（未通过）');
    for (let t = Date.now(); await demoTrackerStatus(target.job_id) !== 'Rejected' && Date.now() - t < 15000; ) {
      await new Promise(r => setTimeout(r, 150));
    }
    assert.equal(await demoTrackerStatus(target.job_id), 'Rejected', 'Rejected 已写回 Demo tracker');
    assert.equal(errors.length, 0, '全程零 console/page error：' + errors.join(' | '));
    await ctx.close();
  } finally {
    await browser.close();
    child.kill();
    restoreDemo(before);
  }
});

// ── M4 行为：同岗位并发状态写回不得竞态（MAJOR-3 回归）─────────────────────
// 场景：连续点 Applied → Responded → Interview，且把第一笔 Applied 故意拖慢（模拟响应乱序）。
//   · 无保护实现：三笔并发，Interview 先落库、Applied 最后才响应 → 旧响应把 UI 拉回 Applied，
//     服务端 = Interview、UI = Applied，状态不一致（且中途出现回退）。
//   · 本实现：per-job 串行队列 + request sequence → 写回顺序 = 点击顺序，
//     旧一笔的迟到响应既不改 UI 也不覆盖服务端，UI 终态 = 服务端 = 最后一次意图。
test('M4 行为：同岗位快速连续状态写回串行化，慢响应不得覆盖新状态、不回退', { skip: chromium ? false : '未安装 playwright，跳过浏览器行为回归' }, async () => {
  const before = snapshotDemo();
  const { base, child } = await startServer(true);
  const browser = await launch();
  assert.ok(browser, 'chromium 未能启动');
  try {
    const state = await (await fetch(base + '/api/state')).json();
    const target = state.jobs.find(j => j.status === 'Evaluated' && j.tracker_num);
    assert.ok(target, 'Demo 需存在 Evaluated 且已在 tracker 的岗位（Applied→Responded→Interview 用例）');

    const DELAY = { Applied: 1400, Responded: 200, Interview: 200 };
    const seen = [];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/api/status', async route => {
      const payload = JSON.parse(route.request().postData() || '{}');
      const t0 = Date.now();
      const res = await route.fetch();
      const text = await res.text();
      await new Promise(r => setTimeout(r, DELAY[payload.status] ?? 0));
      seen.push({ job_id: payload.job_id, status: payload.status, t0, delivered: Date.now() });
      await route.fulfill({ status: res.status(), headers: { 'content-type': 'application/json' }, body: text });
    });
    const page = await ctx.newPage();
    page.on('dialog', d => d.dismiss().catch(() => { }));
    await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
    await page.click('#btn-switch-view');
    await page.waitForTimeout(400);
    await page.locator(`.job-card-c[data-id="${target.job_id}"] .jc-title`).click();
    await page.waitForTimeout(400);
    // 记录状态徽标文本变化时间线（Node 与页面同源时钟，用于检测“旧响应把 UI 拉回”）
    await page.evaluate(() => {
      window.__tl = [];
      const el = document.getElementById('dt-status-pill');
      const pill = () => document.getElementById('dt-status-pill') || el;
      const obs = () => {
        const t = pill();
        const txt = (t.textContent || '').trim();
        const last = window.__tl[window.__tl.length - 1];
        if (!last || last.text !== txt) window.__tl.push({ at: Date.now(), text: txt });
      };
      obs();
      window.__tlTimer = setInterval(obs, 25);
      const mo = new MutationObserver(obs);
      mo.observe(document.body, { subtree: true, childList: true, characterData: true });
    });

    // 不等待响应，连续点三次：Applied → Responded → Interview（最后一次是用户最新意图）
    const clickStatus = async s => {
      await page.click('#btn-flow-status');
      await page.click(`.status-dropdown-item[data-status="${s}"]`);
      await page.waitForTimeout(60);
    };
    await clickStatus('Applied');
    await clickStatus('Responded');
    await clickStatus('Interview');
    // 轮询等待三笔全部落定 + UI 收敛（并发跑多测试文件时固定 sleep 不稳）
    for (let t = Date.now(); seen.length < 3 && Date.now() - t < 20000; ) await new Promise(r => setTimeout(r, 100));
    await page.waitForFunction(() => (document.getElementById('dt-status-pill')?.textContent || '').trim() === '面试',
      null, { timeout: 15000 });
    await new Promise(r => setTimeout(r, 600));   // 留一个采样窗口给时间线，确认无回退

    // 1) 同一 job 的写回必须串行：后一笔不得在上一笔响应交付前发出（无竞争写入）
    const mine = seen.filter(s => s.job_id === target.job_id).sort((a, b) => a.t0 - b.t0);
    assert.equal(mine.length, 3, '三次点击应产生三笔 /api/status（不得丢写回）');
    for (let i = 1; i < mine.length; i++) {
      assert.ok(mine[i].t0 >= mine[i - 1].delivered - 50,
        `第 ${i + 1} 笔未等上一笔落定即发出 → 存在并发竞争写入：${JSON.stringify(mine)}`);
    }
    assert.deepEqual(mine.map(m => m.status), ['Applied', 'Responded', 'Interview'], '写回顺序 = 用户点击顺序');

    // 2) 服务端最终状态 = 最后一次意图（Interview），任何旧请求都不得覆盖
    assert.equal(await demoTrackerStatus(target.job_id), 'Interview', 'tracker 终态必须是 Interview');

    // 3) UI 终态与服务端一致，且第一笔迟到的 Applied 响应不得把 UI 拉回“已投递”
    const timeline = await page.evaluate(() => { clearInterval(window.__tlTimer); return window.__tl; });
    const uiText = (await page.locator('#dt-status-pill').textContent()).trim();
    assert.equal(uiText, '面试', `UI 终态须收敛到 Interview（面试），实际「${uiText}」`);
    const appliedDelivered = mine[0].delivered;
    const regression = timeline.filter(t => t.at > appliedDelivered + 100 && t.text === '已投递');
    assert.equal(regression.length, 0,
      `旧请求的迟到响应把 UI 拉回了 Applied（状态回退）：${JSON.stringify(timeline)}`);
    await ctx.close();
  } finally {
    await browser.close();
    child.kill();
    restoreDemo(before);
  }
});
