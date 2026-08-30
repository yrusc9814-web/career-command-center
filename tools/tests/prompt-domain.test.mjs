// prompt-domain.test.mjs — Phase 5 Prompt/Analysis 输出层采购化 内容守卫测试
//
// 只读 tracked prompt 文件做内容断言（fs 读取，不 import SoT 引擎 —— 引擎行为由
// scoring/cv-match/eligibility/taxonomy/evidence 各自的测试覆盖）。
// 覆盖 Phase 5 任务书 prompt 侧条目：
//   1-5  主链路守卫（offer/_shared/offers/batch-prompt：引擎服从、Gap 四级、002 类文案、
//        高分不推荐、unknown≠不具备）
//   6-9  外圈 modes（pdf/story-sync/training/deep/project/scan/pipeline/inbox/auto-pipeline/
//        browser-search）无技术领域残留、示例匿名
//   10   interview-questions.md：15 主题 × 4 职级 + evidence-backed 规则
//   11   portals 两模板：采购词表、无技术主搜索词、企业池为匿名占位
//   12   README / docs / examples：采购版事实描述（3 archetype、十维 100、CV Match 0-100）
//   13   隐私自检 + tracked prompt 无本地审计文档引用
//
// Run: node --test tools/tests/prompt-domain.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// 真实公司名清单以拆分字符串构造（grep 自守卫：本测试源码自身不出现这些连续字面量）
const REAL_COMPANY_LITERALS = [
  '字' + '节跳动', '阿' + '里巴巴', '腾' + '讯', '华' + '为',
  'Deep' + 'Seek', 'Moo' + 'nshot', '智' + '谱', 'Mini' + 'Max',
];

// ---------------------------------------------------------------------------
// 1. 主链路 prompt 不含技术领域残留
// ---------------------------------------------------------------------------

test('P1 offer/offers/_shared/batch-prompt 无技术 archetype 主类型与 P6/P7/115 残留', () => {
  const files = ['modes/offer.md', 'modes/offers.md', 'modes/_shared.md', 'batch/batch-prompt.md'];
  const techTypes = ['数据工程', '数据治理', '数据仓库', '大模型应用', 'AI Infra', '平台架构', '大数据算法', '后端工程师'];
  for (const f of files) {
    const text = read(f);
    for (const t of techTypes) assert.ok(!text.includes(t), `${f} 不应含技术 archetype "${t}"`);
    assert.ok(!/\bP6\b/.test(text) && !/\bP7\b/.test(text), `${f} 不应含互联网职级 P6/P7`);
    assert.ok(!/115\s*权重|权重\s*115|总权重 115/.test(text), `${f} 不应含 115 权重描述`);
  }
});

test('P2 简历/Gap 建议无 GitHub/开源/side project 默认建议（禁止式黑名单除外）', () => {
  // 这些文件里出现的 GitHub/开源/side project 只允许出现在"禁止默认建议"黑名单句中
  const guardFiles = ['modes/offer.md', 'modes/_shared.md', 'batch/batch-prompt.md'];
  for (const f of guardFiles) {
    const lines = read(f).split('\n').filter(l => /GitHub|开源|side project/.test(l));
    for (const line of lines) {
      assert.ok(/禁止/.test(line), `${f} 中 GitHub/开源/side project 只能出现在禁止黑名单：${line.trim().slice(0, 60)}`);
    }
  }
  // 这些文件必须完全不出现
  const cleanFiles = [
    'modes/pdf.md', 'modes/training.md', 'modes/project.md', 'modes/story-sync.md',
    'modes/interview-questions.md', 'examples/sample-report.md', 'examples/cv-example.md',
    'examples/article-digest-example.md',
  ];
  for (const f of cleanFiles) {
    const text = read(f);
    assert.ok(!text.includes('GitHub'), `${f} 不应含 GitHub 建议`);
    assert.ok(!text.includes('开源'), `${f} 不应含开源建议`);
    assert.ok(!text.includes('side project'), `${f} 不应含 side project 建议`);
  }
});

test('P3 采购示例无 QPS/p99/SLA/高并发 工程话术；pdf.md 的黑名单守卫存在', () => {
  const files = [
    'modes/offer.md', 'modes/offers.md', 'modes/_shared.md', 'batch/batch-prompt.md',
    'modes/training.md', 'modes/project.md', 'modes/story-sync.md', 'modes/interview-questions.md',
    'examples/sample-report.md', 'examples/cv-example.md', 'examples/article-digest-example.md',
    'README.md', 'docs/ARCHITECTURE.md', 'docs/CUSTOMIZATION.md', 'docs/SETUP.md',
  ];
  for (const f of files) {
    const text = read(f);
    assert.ok(!text.includes('QPS'), `${f} 不应含 QPS`);
    assert.ok(!text.includes('p99'), `${f} 不应含 p99`);
    assert.ok(!text.includes('SLA'), `${f} 不应含 SLA`);
  }
  // pdf.md 的量化结果黑名单必须保留（守卫文案本身）
  const pdf = read('modes/pdf.md');
  assert.ok(/禁止\s*QPS\s*\/\s*p99\s*\/\s*SLA/.test(pdf), 'pdf.md 应保留 QPS/p99/SLA 黑名单守卫');
});

// ---------------------------------------------------------------------------
// 2. 输出文案守卫（Prompt 服从引擎）
// ---------------------------------------------------------------------------

test('P4 002 类文案守卫：能力+品类资源语义存在，禁止"缺乏 sourcing/采购能力"式表述', () => {
  const guard = '具有供应商开发能力，但缺目标品类供应商资源';
  for (const f of ['modes/offer.md', 'modes/_shared.md', 'batch/batch-prompt.md']) {
    assert.ok(read(f).includes(guard), `${f} 应含 002 类守卫文案`);
  }
  for (const f of ['modes/offer.md', 'modes/_shared.md', 'batch/batch-prompt.md', 'README.md']) {
    const text = read(f);
    assert.ok(!text.includes('缺乏 sourcing 能力'), `${f} 不应出现"缺乏 sourcing 能力"`);
    assert.ok(!text.includes('缺乏采购能力'), `${f} 不应出现"缺乏采购能力"`);
    assert.ok(!text.includes('缺采购能力'), `${f} 不应出现"缺采购能力"`);
  }
});

test('P5 高分不推荐守卫：合法状态 + decision trace 唯一解释依据', () => {
  for (const f of ['modes/offer.md', 'modes/_shared.md', 'modes/offers.md']) {
    const text = read(f);
    assert.ok(text.includes('高分不推荐'), `${f} 应含"高分不推荐"守卫`);
    assert.ok(text.includes('decision trace'), `${f} 应指明 decision trace 是唯一解释依据`);
  }
});

test('P6 unknown 文案守卫：只写信息不足，禁止写成不具备/没有/较差', () => {
  for (const f of ['modes/offer.md', 'modes/_shared.md']) {
    const text = read(f);
    assert.ok(text.includes('当前信息不足'), `${f} 应含 unknown 正向文案`);
    assert.ok(text.includes('JD 未披露'), `${f} 应含"JD 未披露"文案`);
    assert.ok(text.includes('需面试确认'), `${f} 应含"需面试确认"文案`);
  }
  const shared = read('modes/_shared.md');
  assert.ok(shared.includes('不具备 / 没有 / 较差'), '_shared.md 应明确禁止"不具备/没有/较差"式表述');
  assert.ok(shared.includes('禁止 LLM 自补事实'), '_shared.md 应禁止 LLM 自补事实');
});

test('P7 LLM 只解释不重算：cv_match_score / Career Score / Recommendation 来自引擎', () => {
  for (const f of ['modes/offer.md', 'modes/_shared.md', 'batch/batch-prompt.md']) {
    const text = read(f);
    assert.ok(text.includes('cv-match.mjs'), `${f} 应指向 cv-match.mjs`);
    assert.ok(text.includes('scoring.mjs'), `${f} 应指向 scoring.mjs`);
    assert.ok(/只解释/.test(text), `${f} 应声明 LLM 只解释不重算`);
  }
});

// ---------------------------------------------------------------------------
// 3. STAR+R 与 Story Bank
// ---------------------------------------------------------------------------

test('P8 STAR 禁编造 + 缺证据标"待补充真实案例"', () => {
  const offer = read('modes/offer.md');
  assert.ok(offer.includes('待补充真实案例'), 'offer.md Block F 应含"待补充真实案例"');
  assert.ok(offer.includes('禁止自动生成假 STAR'), 'offer.md 应禁止自动生成假 STAR');
  assert.ok(offer.includes('Evidence-backed'), 'offer.md Block F 应声明 Evidence-backed');

  const story = read('modes/story-sync.md');
  assert.ok(story.includes('待补充真实案例'), 'story-sync.md 应含"待补充真实案例"');
  assert.ok(story.includes('禁止编造'), 'story-sync.md 应禁止编造');

  const iq = read('modes/interview-questions.md');
  assert.ok(iq.includes('需要候选人补充真实案例'), 'interview-questions.md 应含"需要候选人补充真实案例"');
  assert.ok(iq.includes('禁止自动生成假 STAR'), 'interview-questions.md 应禁止自动生成假 STAR');
});

test('P9 Story Bank 18 类主题存在于 offer/story-sync', () => {
  const classes = ['降本谈判', '新供应商', '供应商涨价', '紧急交付', '供应中断', '单一来源',
    '多供应商导入', '质量事故', '供应商淘汰', '合同', '库存过高', '呆滞料', 'MOQ',
    'Lead Time', '跨部门冲突', 'ERP·SRM', '外贸', '团队管理'];
  for (const f of ['modes/offer.md', 'modes/story-sync.md']) {
    const text = read(f);
    const missing = classes.filter(c => !text.includes(c));
    assert.deepEqual(missing, [], `${f} 缺少 Story Bank 类别: ${missing.join(', ')}`);
  }
});

// ---------------------------------------------------------------------------
// 4. interview-questions.md 题库结构
// ---------------------------------------------------------------------------

test('P10 interview-questions.md 含 15 主题与 4 职级', () => {
  const text = read('modes/interview-questions.md');
  const topics = [
    'Supplier Sourcing', 'RFQ 比价', 'Negotiation', 'Cost Reduction', 'Supplier Performance',
    'Delivery', 'Quality', 'Supply Interruption', 'Contract', 'Category Strategy', 'Inventory',
    'Cross-functional Collaboration', 'ERP·SRM', 'International Procurement', 'Management',
  ];
  for (const t of topics) assert.ok(text.includes(t), `缺主题: ${t}`);
  for (const lvl of ['专员', '高级专员', '主管', '经理 · 总监']) {
    assert.ok(text.includes(lvl), `缺职级档: ${lvl}`);
  }
  // 15 个主题段（### 级，主题编号 1-15）
  const topicHeaders = (text.match(/^### \d{1,2}\. /gm) || []).length;
  assert.equal(topicHeaders, 15, `主题段应为 15 个，实际 ${topicHeaders}`);
  // offer.md Block F 引用题库
  assert.ok(read('modes/offer.md').includes('modes/interview-questions.md'), 'offer.md Block F 应引用题库');
});

// ---------------------------------------------------------------------------
// 5. offers.md 十维与三列分离
// ---------------------------------------------------------------------------

test('P11 offers.md 含新十维（权重和 100）且无旧维度残留', () => {
  const text = read('modes/offers.md');
  const dims = [
    ['compensation', 20], ['workload_workstyle', 15], ['role_seniority', 13],
    ['career_growth', 10], ['category_domain_value', 10], ['procurement_ownership', 9],
    ['company_stability', 7], ['location_fit', 8], ['digital_tooling', 5], ['hiring_process_quality', 3],
  ];
  let sum = 0;
  for (const [key, w] of dims) {
    assert.ok(text.includes(key), `offers.md 缺维度 key: ${key}`);
    const re = new RegExp(`\\|\\s*${key}\\s*\\|[^|]*\\|\\s*${w}\\s*\\|`);
    assert.ok(re.test(text), `offers.md 维度 ${key} 权重应为 ${w}`);
    sum += w;
  }
  assert.equal(sum, 100, `十维权重和应为 100，实际 ${sum}`);
  for (const old of ['北极星', 'north_star', 'tech_modernity', 'process_speed', '技术栈现代度', '流程速度', '文化信号', '工程师文化']) {
    assert.ok(!text.includes(old), `offers.md 不应含旧维度 "${old}"`);
  }
  assert.ok(text.includes('禁止'), 'offers.md 应禁止合成总分');
  assert.ok(text.includes('CV Match（0-100'), 'offers.md 应有三列分离的 CV Match 0-100');
  assert.ok(text.includes('Career Score（1-5'), 'offers.md 应有三列分离的 Career Score 1-5');
  assert.ok(!/cv_match\s*[（(]?\s*1-5/.test(text), 'offers.md 不应再用 1-5 版 cv_match');
});

// ---------------------------------------------------------------------------
// 6. portals 模板
// ---------------------------------------------------------------------------

test('P12 portals-china.example.yml：采购词表 + 无技术搜索词 + 匿名企业池', () => {
  const text = read('templates/portals-china.example.yml');
  for (const w of ['采购', '采购专员', '采购主管', '采购经理', '供应商开发', '寻源', '战略采购', '品类采购', 'Sourcing', 'Supplier Development', 'Category Procurement']) {
    assert.ok(text.includes(w), `positive 词表缺 "${w}"`);
  }
  for (const w of ['仓库', '物流专员', '销售', '跟单员', '计划员', 'PMC', 'SQE']) {
    assert.ok(text.includes(w), `negative 词表缺 "${w}"`);
  }
  // 不禁"供应链"整词
  assert.ok(!/\n\s*-\s*"供应链"\s*$/.test(text), '不应把"供应链"整词放入排除词');
  assert.ok(/seniority_boost:/.test(text), 'seniority_boost 应保留');
  // 无技术主搜索词
  for (const t of ['大模型', 'LLM', 'RAG', 'AI Infra', 'Spark', 'Flink', '数据工程', '数仓', 'StarRocks', 'Doris']) {
    assert.ok(!text.includes(t), `不应含技术搜索词 "${t}"`);
  }
  // 企业池为匿名占位（示例 + example 域名），enabled=false
  assert.ok(text.includes('某工程机械整机厂'), '企业池应含匿名示例占位');
  assert.ok(text.includes('example-oem'), '企业池应使用 example 占位域名');
  assert.ok(!/careers_url: https:\/\/(?!.*(example|某))/.test(text) || text.includes('enabled: false'), '占位企业应默认 disabled');
  // 城市占位
  assert.ok(text.includes('{city}'), 'search_queries 应使用 {city} 占位');
});

test('P13 portals.example.yml（英文）：采购词表 + 删除技术词 + 匿名企业池', () => {
  const text = read('templates/portals.example.yml');
  for (const w of ['Buyer', 'Procurement Specialist', 'Senior Buyer', 'Procurement Supervisor', 'Procurement Manager', 'Sourcing Specialist', 'Strategic Sourcing', 'Category Buyer', 'Category Manager', 'Supplier Development']) {
    assert.ok(text.includes(w), `positive 词表缺 "${w}"`);
  }
  for (const t of ['Data Engineer', 'ML Engineer', 'Backend', 'Staff Engineer', 'Principal', 'LLM', 'MLOps', 'Forward Deployed']) {
    assert.ok(!text.includes(t), `不应含技术词 "${t}"`);
  }
  assert.ok(/seniority_boost:/.test(text), 'seniority_boost 应保留');
  assert.ok(text.includes('example-manufacturer'), '企业池应使用 example 占位');
  assert.ok(!/Anthropic|OpenAI|PolyAI|ElevenLabs|Retool|Palantir/.test(text), '企业池不应含真实公司清单');
});

// ---------------------------------------------------------------------------
// 7. README / docs / examples 采购版事实描述
// ---------------------------------------------------------------------------

test('P14 README：3 archetype + 十维 100 + CV Match 0-100 + 四层决策，无旧评分表', () => {
  const text = read('README.md');
  assert.ok(text.includes('3 个采购 archetype'), 'README 应描述 3 个采购 archetype');
  assert.ok(text.includes('权重 100'), 'README 应描述十维 × 权重 100');
  assert.ok(text.includes('0-100'), 'README 应描述 CV Match 0-100');
  assert.ok(text.includes('Recommendation'), 'README 应描述四层决策的 Recommendation');
  for (const old of ['技术栈现代度', '北极星对齐', '流程速度', '文化信号', '大模型应用工程师', '数据工程师 / Data Engineer', 'AI Infra / 大模型基础设施']) {
    assert.ok(!text.includes(old), `README 不应含旧描述 "${old}"`);
  }
});

test('P15 docs/ARCHITECTURE.md 反映现架构（3 archetype 引擎 + 分数口径）', () => {
  const text = read('docs/ARCHITECTURE.md');
  assert.ok(text.includes('1 of 3 types'), 'ARCHITECTURE 应写 3 种 archetype');
  assert.ok(!text.includes('1 of 6 types'), 'ARCHITECTURE 不应再写 1 of 6 types');
  assert.ok(text.includes('cv_match_score'), 'ARCHITECTURE 应提 CV Match 0-100');
  assert.ok(text.includes('computeRecommendation'), 'ARCHITECTURE 应提决策链 SoT');
});

test('P16 docs/CUSTOMIZATION.md archetype 指引采购化', () => {
  const text = read('docs/CUSTOMIZATION.md');
  assert.ok(text.includes('strategic_category') || text.includes('procurement'), 'CUSTOMIZATION 应提采购 archetype');
  assert.ok(!text.includes('AI') || !/AI\/ML roles/.test(text), 'CUSTOMIZATION 不应保留 AI/ML 词表指引');
});

test('P17 examples 为采购匿名版（示例公司 + X/N 占位）', () => {
  const report = read('examples/sample-report.md');
  assert.ok(report.includes('某工程机械贸易公司'), 'sample-report 应用示例公司');
  assert.ok(report.includes('eligibility_status'), 'sample-report 应含 eligibility 字段');
  assert.ok(!/https:\/\/www\.zhipin\.com\/job_detail\/[a-z0-9]{16,}/i.test(report), 'sample-report 不应含真实 Boss job URL');
  const cv = read('examples/cv-example.md');
  assert.ok(cv.includes('示例'), 'cv-example 应标明匿名示例');
  assert.ok(!cv.includes('Alex Chen'), 'cv-example 不应再用旧人物');
  for (const real of ['15%', '100+家', '280万', '4 人小组', '4人小组']) {
    assert.ok(!report.includes(real) && !cv.includes(real) && !read('examples/article-digest-example.md').includes(real),
      `examples 不应复制真实数字 "${real}"`);
  }
});

// ---------------------------------------------------------------------------
// 8. 外圈 modes 领域置换
// ---------------------------------------------------------------------------

test('P18 browser-search 的 cv_match 字段语义 = cv_match_score 0-100（保持字段名）', () => {
  const text = read('modes/browser-search.md');
  // "x.x/5" 只允许出现在禁止黑名单句中
  for (const line of text.split('\n').filter(l => l.includes('x.x/5'))) {
    assert.ok(line.includes('禁止'), `browser-search 的 x.x/5 只能出现在禁止黑名单：${line.trim().slice(0, 50)}`);
  }
  assert.ok(text.includes('cv-match.mjs'), 'browser-search 应指向 CV Match 引擎');
  assert.ok(text.includes('"cv_match"'), '应保留 cv_match 字段名（脚本契约）');
  assert.ok(text.includes('cv_match_score'), '应写明 cv_match_score 0-100 语义');
});

test('P19 外圈 modes 深挖/学习/项目方向采购化', () => {
  const deep = read('modes/deep.md');
  assert.ok(deep.includes('品类'), 'deep.md 应含品类维度');
  assert.ok(!deep.includes('数仓') && !deep.includes('GitHub org'), 'deep.md 不应含技术深挖维度');
  const training = read('modes/training.md');
  assert.ok(training.includes('品类') && training.includes('谈判'), 'training.md 学习方向应采购化');
  assert.ok(!training.includes('Spark') && !training.includes('RAG'), 'training.md 不应含技术课程方向');
  const project = read('modes/project.md');
  assert.ok(project.includes('供应商开发') || project.includes('降本'), 'project.md 项目方向应采购化');
  assert.ok(!project.includes('QPS') && !project.includes('p99'), 'project.md 不应含工程指标');
});

test('P20 scan/pipeline/inbox/auto-pipeline 示例采购化且不含真实公司名', () => {
  const files = ['modes/scan.md', 'modes/pipeline.md', 'modes/inbox.md', 'modes/auto-pipeline.md'];
  for (const f of files) {
    const text = read(f);
    for (const c of REAL_COMPANY_LITERALS) {
      assert.ok(!text.includes(c), `${f} 不应含真实公司名`);
    }
  }
  const scan = read('modes/scan.md');
  assert.ok(scan.includes('采购'), 'scan.md 示例应采购化');
  assert.ok(scan.includes('search_queries') && scan.includes('title_filter') && scan.includes('tracked_companies'),
    'scan.md 应保留 portals 配置引用结构');
});

// ---------------------------------------------------------------------------
// 9. AGENTS / CLAUDE 术语与建议
// ---------------------------------------------------------------------------

test('P21 AGENTS/CLAUDE 术语保留段为采购术语，无 GitHub 仓库式 onboarding 建议', () => {
  // AGENTS.md（CLAUDE.md 的迁移版）有"永远要"术语段；CLAUDE.md 无该段，只做反向断言
  const agents = read('AGENTS.md');
  assert.ok(agents.includes('SRM、RFQ、MOQ'), 'AGENTS.md 术语段应改为采购术语');
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    const text = read(f);
    assert.ok(!text.includes('Embedding'), `${f} 不应含 Embedding`);
    assert.ok(!text.includes('p99'), `${f} 不应含 p99`);
    assert.ok(!text.includes('GitHub 仓库'), `${f} onboarding 不应建议 GitHub 仓库`);
    assert.ok(!/\bP7\b/.test(text), `${f} 不应含 P7 职级对标`);
  }
});

// ---------------------------------------------------------------------------
// 10. 隐私与本地文件守卫
// ---------------------------------------------------------------------------

test('P22 本测试文件自身匿名（无真实公司名 / Boss job id）——grep 自守卫', () => {
  const self = fs.readFileSync(new URL(import.meta.url), 'utf8');
  assert.ok(!/zhipin\.com\/job_detail\/[a-z0-9]{16,}/i.test(self), '测试源码不得内嵌真实 Boss job id');
  for (const c of REAL_COMPANY_LITERALS) {
    assert.ok(!self.includes(c), '测试源码不得内嵌真实公司名字面量（拆分构造清单自检失败）');
  }
});

test('P23 tracked prompt 文档无本地审计文档（PROCUREMENT_ARCHETYPE_AUDIT）引用', () => {
  const promptFiles = [
    'modes/offer.md', 'modes/offers.md', 'modes/_shared.md', 'modes/pdf.md', 'modes/story-sync.md',
    'modes/training.md', 'modes/deep.md', 'modes/project.md', 'modes/scan.md', 'modes/pipeline.md',
    'modes/inbox.md', 'modes/auto-pipeline.md', 'modes/browser-search.md', 'modes/interview-questions.md',
    'batch/batch-prompt.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/CUSTOMIZATION.md', 'docs/SETUP.md',
    'examples/sample-report.md', 'examples/cv-example.md', 'examples/article-digest-example.md',
    'AGENTS.md', 'CLAUDE.md',
  ];
  for (const f of promptFiles) {
    assert.ok(!read(f).includes('PROCUREMENT_ARCHETYPE_AUDIT'), `${f} 不应引用本地审计文档`);
  }
});

test('P24 target_pool 模板无 AI 分层残留', () => {
  const text = read('config/target_pool.template.md');
  for (const t of ['大模型', 'AI 独角兽', '数据工程', 'AI Infra', 'LLM']) {
    assert.ok(!text.includes(t), `target_pool.template.md 不应含 "${t}"`);
  }
});
