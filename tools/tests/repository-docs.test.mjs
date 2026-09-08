// repository-docs.test.mjs — 仓库文档一致性防退化测试（docs cleanup round）
// Run: node --test tools/tests/repository-docs.test.mjs
//
// 覆盖（高价值不变量，不做 README 全文 snapshot）：
//   D1  当前正式 clone URL
//   D2  不再把 china-main 描述为当前分支
//   D3  README 不再以 "built on Claude Code" 作为产品定位
//   D4  README 展示全部 Agent 宿主示例
//   D5  README 存在兼容性 disclaimer（未标注 verified ≠ full E2E support）
//   D6  README 能识别三条 JD 采集路线（Manual / Bookmarklet / Browser Automation）
//   D7  Kimi 不被写成系统 required dependency
//   D8  Claude Skill Router 包含 browser-search mode
//   D9  package.json repository 指向当前 repo
//   D10 正式文档不宣称自动浏览器流程 "零风险 / 唯一稳定可靠"
//   D11 tools README 区分 localhost capture 与后续 AI 分析
//   D12 SETUP 不把上游 santifer/career-ops 当作当前安装目标
// 夹具全部来自 tracked 文档本身；不读取任何本地用户配置。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CURRENT_REPO = 'yrusc9814-web/career-command-center';
const HOST_EXAMPLES = [
  'Codex', 'Claude Code', 'Cursor', 'WorkBuddy', '千问办公', 'ZCode', 'DIM', 'Qoder',
];

test('D1: README and SETUP use the current official clone URL', () => {
  for (const file of ['README.md', 'docs/SETUP.md']) {
    const text = read(file);
    assert.ok(
      text.includes(`${CURRENT_REPO}.git`),
      `${file} should reference the https clone URL of ${CURRENT_REPO}`,
    );
    assert.ok(
      !text.includes('github.com/shuheng-mo/career-ops-china'),
      `${file} should not reference the obsolete shuheng-mo/career-ops-china repo`,
    );
  }
});

test('D2: no obsolete branch instruction (china-main) in README/SETUP', () => {
  for (const file of ['README.md', 'docs/SETUP.md']) {
    const text = read(file);
    assert.ok(
      !text.includes('china-main'),
      `${file} should not describe china-main as the current branch`,
    );
  }
});

test('D3: README is not positioned as "built on Claude Code"', () => {
  const readme = read('README.md');
  assert.ok(
    !readme.includes('built on Claude Code'),
    'README must not define the product as "built on Claude Code"',
  );
  assert.ok(
    /Agent-neutral/i.test(readme),
    'README must carry the agent-neutral positioning',
  );
});

test('D4: README lists all required host examples', () => {
  const readme = read('README.md');
  for (const host of HOST_EXAMPLES) {
    assert.ok(readme.includes(host), `README should mention host example: ${host}`);
  }
});

test('D5: README carries the compatibility disclaimer', () => {
  const readme = read('README.md');
  assert.match(
    readme,
    /not a claim that every feature has been fully E2E-tested on every host|不代表每个功能都已在每个宿主上完成完整 E2E 验证/,
    'README must state that unverified hosts are compatibility examples, not full E2E support',
  );
});

test('D6: README identifies the three JD acquisition paths', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('Manual Capture'), 'path A: Manual Capture');
  assert.ok(/Bookmarklet/i.test(readme), 'path B: Local Bookmarklet');
  assert.ok(/Browser Automation/i.test(readme), 'path C: Optional Browser Automation');
  assert.ok(
    readme.includes('`scan` 不等于 `browser-search`'),
    'README must state scan != browser-search',
  );
});

test('D7: Kimi is optional, not a system dependency', () => {
  const browserSearch = read('modes/browser-search.md');
  assert.ok(
    /不是 Career Command Center 的核心依赖/.test(browserSearch),
    'browser-search.md must state Kimi WebBridge is not a core dependency',
  );
  const readme = read('README.md');
  assert.ok(
    !readme.includes('Kimi WebBridge 版'),
    'README must not present Kimi WebBridge as the product identity of browser-search',
  );
});

test('D8: Claude Skill Router includes browser-search', () => {
  const router = read('.claude/skills/career-ops/SKILL.md');
  assert.ok(
    /\|\s*`?browser-search`?\s*\|/.test(router),
    'router mode table must include browser-search',
  );
  assert.ok(
    router.includes('browser-search'),
    'router must mention browser-search at least once',
  );
});

test('D9: package.json repository points to the current repo', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.repository.url, `https://github.com/${CURRENT_REPO}.git`);
  assert.ok(
    /agent-neutral/i.test(pkg.description),
    'package description must be agent-neutral',
  );
});

test('D10: no absolute zero-risk claims for automated browser flows', () => {
  for (const file of ['README.md', 'modes/scan.md', 'modes/browser-search.md']) {
    const text = read(file);
    assert.ok(!text.includes('零反爬风险'), `${file} must not claim 零反爬风险`);
    assert.ok(!text.includes('唯一稳定可靠'), `${file} must not claim 唯一稳定可靠`);
    assert.ok(!text.includes('绝对安全'), `${file} must not claim 绝对安全`);
  }
});

test('D11: tools README separates localhost capture from later AI processing', () => {
  const toolsReadme = read('tools/README.md');
  assert.match(toolsReadme, /捕获阶段/);
  assert.match(toolsReadme, /分析阶段/);
  assert.match(toolsReadme, /localhost/);
  assert.match(
    toolsReadme,
    /Agent \/ model provider/,
    'tools README must disclose that later analysis goes through the chosen agent/model provider',
  );
});

test('D12: SETUP does not use upstream santifer/career-ops as install target', () => {
  const setup = read('docs/SETUP.md');
  assert.ok(
    !setup.includes('git clone https://github.com/santifer/career-ops.git'),
    'SETUP must not instruct cloning the upstream repo as the install target',
  );
});

// ---- Closeout round: semantic consistency guards (D13-D25) ----

test('D13: no legacy Career Score scale in job-evaluation contexts', () => {
  assert.ok(!read('modes/auto-pipeline.md').includes('score >= 4.5'),
    'auto-pipeline must not use the legacy 1-5 application threshold');
  assert.ok(!read('modes/pipeline.md').match(/score\s*≥\s*3\.0/),
    'pipeline must not own a second legacy PDF threshold');
  assert.ok(!read('modes/offers.md').includes('X.X / 5'),
    'offers comparison must show Career Score on the 0-100 scale');
  assert.ok(!read('modes/batch.md').includes('\t4.2\t'),
    'batch state example must use the 0-100 score scale');
  // legal independent rubrics are NOT asserted against:
  // offer.md 看准网口碑 x.x/5, project.md ROI 1-5, browser-search 6b rule_score 0-5
});

test('D14: canonical Job Identity contract in main instructions', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const text = read(file);
    assert.match(text, /canonical Job Identity/, `${file} must state the canonical Job Identity`);
    assert.match(text, /job_id/, `${file} must reference job_id-first identity`);
    assert.ok(!text.includes('if company+role already exists'),
      `${file} must not define company+role as definitive identity`);
  }
});

test('D15: no workspace-specific state in public docs', () => {
  assert.ok(!read('AGENTS.md').includes('本工作区'),
    'AGENTS.md must not describe the local workspace state');
  assert.ok(!read('modes/browser-search.md').includes('当前默认状态'),
    'browser-search must use conditional onboarding wording only');
});

test('D16: portals onboarding uses template semantics, not preloaded claims', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    const text = read(file);
    assert.ok(!/预配置好了 50\+ 公司/.test(text), `${file} must not claim 50+ preloaded companies`);
    assert.match(text, /templates\/portals-china\.example\.yml/,
      `${file} must point new users to the tracked example template`);
  }
  assert.ok(!read('README.md').includes('50+ 中国公司预置'),
    'README must not claim the example template ships 50+ real companies');
});

test('D17: PDF engine documented as Playwright, consistently', () => {
  for (const file of ['CLAUDE.md', 'docs/ARCHITECTURE.md']) {
    assert.ok(!read(file).includes('Puppeteer'),
      `${file} must not reference the stale Puppeteer engine name`);
  }
});

test('D18: generic modes have no host-specific command leakage', () => {
  const genericModes = ['apply', 'contact', 'inbox', 'story-sync', 'auto-pipeline',
    'offer', 'pipeline', 'tracker', '_shared'];
  for (const mode of genericModes) {
    const text = read(`modes/${mode}.md`);
    assert.ok(!/Claude/.test(text), `modes/${mode}.md must not depend on Claude-only wording`);
  }
  // allowlisted host-specific content stays untouched:
  assert.ok(/Claude/.test(read('modes/batch.md')),
    'batch.md keeps its honest Claude-specific implementation status');
  assert.ok(/webbridge_/i.test(read('modes/browser-search.md')),
    'browser-search.md keeps its verified transport implementation');
});

test('D19: browser-search documents transport portability', () => {
  const text = read('modes/browser-search.md');
  assert.match(text, /不是 Career Command Center 的核心依赖/,
    'Kimi WebBridge must be marked as not a core dependency');
  assert.match(text, /verified browser transport|browser transport \/ capability implementation/,
    'Kimi WebBridge must be marked as the verified transport');
  assert.match(text, /browser adapter \/ tool mapping/,
    'other hosts must be told they need an equivalent adapter/tool mapping');
});

test('D20: browser-search run-results schema matches the analysis contract', () => {
  const text = read('modes/browser-search.md');
  const schemaStart = text.indexOf('per_job（analysis');
  assert.ok(schemaStart > -1, 'schema section must exist');
  const schema = text.slice(schemaStart);
  assert.equal((schema.match(/"strengths"/g) || []).length, 1,
    'schema must not contain duplicate strengths keys');
  assert.equal((schema.match(/"gaps"/g) || []).length, 1,
    'schema must not contain duplicate gaps keys');
  assert.ok(schema.includes('"score_breakdown"'),
    'schema must include score_breakdown per the frozen analysis contract');
  for (const key of ['recommendation_reason', 'soft_gaps', 'cv_advice', 'interview_focus', 'decision_trace']) {
    assert.ok(schema.includes(`"${key}"`), `schema must include ${key}`);
  }
});

test('D21: screenshot instructions are OS-neutral', () => {
  for (const file of ['README.md', 'modes/scan.md', 'modes/auto-pipeline.md']) {
    const text = read(file);
    if (text.includes('Cmd+Shift+4')) {
      assert.ok(text.includes('Win+Shift+S'),
        `${file} must not present macOS-only screenshot commands as the universal step`);
    }
  }
});

test('D22: star-history workflow targets the current repo', () => {
  const wf = read('.github/workflows/star-history.yml');
  assert.ok(!wf.includes('shuheng-mo/career-ops-china'),
    'star-history must not target the legacy fork');
  assert.ok(wf.includes('yrusc9814-web/career-command-center'),
    'star-history must target the current repository');
});

test('D23: tracker mode respects the md/bitable backend split', () => {
  const tracker = read('modes/tracker.md');
  assert.match(tracker, /bitable 后端/);
  assert.match(tracker, /唯一写源/);
  const contact = read('modes/contact.md');
  assert.match(contact, /bitable 后端 Bitable 是唯一写源/,
    'contact status upgrades must follow the backend rule');
});

test('D24: generic modes do not point at CLAUDE.md for business rules', () => {
  const genericModes = ['apply', 'contact', 'inbox', 'story-sync', 'auto-pipeline',
    'offer', 'pipeline', 'tracker', 'scan', '_shared'];
  for (const mode of genericModes) {
    const text = read(`modes/${mode}.md`);
    assert.ok(!text.includes('CLAUDE.md'),
      `modes/${mode}.md must not depend on CLAUDE.md as its rules SoT`);
  }
});

test('D25: README keeps host examples plus the compatibility disclaimer', () => {
  const readme = read('README.md');
  for (const host of HOST_EXAMPLES) {
    assert.ok(readme.includes(host), `README must keep host example: ${host}`);
  }
  assert.match(readme, /不代表每个功能都已在每个宿主上完成完整 E2E 验证/);
  assert.match(readme, /not a claim that every feature has been fully E2E-tested on every host/);
});

test('D26: bug report template routes support to the current repository, not upstream', () => {
  const tpl = read('.github/ISSUE_TEMPLATE/bug_report.yml');
  // current-repo support destination must be present
  assert.ok(
    tpl.includes('https://github.com/yrusc9814-web/career-command-center/issues'),
    'bug_report must point bug support at the current repository issue tracker',
  );
  assert.match(tpl, /use this issue tracker/,
    'bug_report must state that bugs go to this repository');
  // upstream discussions must not be the support/help destination
  assert.ok(
    !tpl.includes('santifer/career-ops/discussions'),
    'bug_report must not route bug support to the upstream discussions',
  );
  assert.ok(!/need direct help/.test(tpl),
    'bug_report must not frame the upstream link as direct help');
  // attribution is allowed and must remain
  assert.ok(tpl.includes('santifer'),
    'upstream attribution (santifer) must be retained');
});
