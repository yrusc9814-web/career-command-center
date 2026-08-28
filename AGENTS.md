# AGENTS.md — Career-Ops China（ZCode 适配版）

> 本文件由原 `CLAUDE.md` 迁移而来，供 ZCode 等兼容 AGENTS.md 规范的 agent 使用。
> 原 `CLAUDE.md` 保留未删除，内容与本项目业务逻辑一致。若两者有出入，以 mode 文件（`modes/*.md`）为准。

## What is career-ops

AI-powered job search automation（中国大陆求职指挥中心）: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing. In ZCode, it is invoked through the `career-ops` skill (`.zcode/skills/career-ops/SKILL.md`, 兼容导入自 `.claude/skills/career-ops/SKILL.md`)。

### Main Files

| File | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `portals.yml` | Query and company config |
| `templates/cv-template.html` | HTML template for CVs |
| `tools/generate-pdf.mjs` | Playwright: HTML to PDF |
| `article-digest.md` | Compact proof points from portfolio (optional) |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`) |

## First Run — Onboarding（重要）

**做任何事之前，先检查系统是否已配置。** 每个 session 开始都静默执行下面这些检查：

1. `cv.md` 是否存在？
2. `config/profile.yml` 是否存在（不只是 profile.example.yml）？
3. `modes/_profile.md` 是否存在？如果 `modes/_profile.template.md` 存在而 `_profile.md` 不存在，复制 template → `_profile.md`
4. `config/target_pool.md` 是否存在？如果 `config/target_pool.template.md` 存在而 `target_pool.md` 不存在，复制 template → `target_pool.md`
5. `portals.yml` 是否存在？（中国大陆版默认已存在，不需要重新创建）

> 注：本工作区已完成上述文件的初始化；但 `cv.md` 目前是空白模板、`config/profile.yml` 仍是 example 原文 — 用户首次使用时按下面 onboarding 流程引导填写。

**如果 cv.md 或 profile.yml 缺失/为空白模板，进入 onboarding 模式。** 在基础文件齐全之前，**不要** 跑评估、扫描或任何其他 mode。一步步引导用户：

#### Step 1: CV（必须）
如果 `cv.md` 不存在或是空白模板，问：
> "还没有你的简历。你可以：
> 1. 直接把简历内容贴过来，我帮你转成 markdown
> 2. 给我你的 LinkedIn 或 个人主页 URL，我提取关键信息
> 3. 告诉我你的经历（学校、工作、项目），我帮你起草一份
>
> 你想怎么做？"

不管他们给什么，创建/完善 `cv.md`。用干净的 markdown，标准段落：摘要、工作经历、项目经历、教育、技能。**注意中文 CV 的特殊约定**（看 `modes/pdf.md` 的"中国大陆 CV 的额外约定"段）。

#### Step 2: Profile（必须）
如果 `config/profile.yml` 仍是 example 原文，问：
> "我需要几个信息来个性化这个系统：
> - 你的姓名 + 邮箱 + 微信（不会写到生成的内容里，只本地存）
> - Base 城市 + 是否能搬迁
> - 目标岗位（数据工程师 / 数据仓库专家 / 大模型应用工程师 / 等）
> - 期望薪资区间（包不包含年终奖、股票）
> - 现在状态：在职 / 离职 / 在看
>
> 我帮你填好。"

把答案写进 `config/profile.yml`。把目标岗位映射到最接近的 archetype（在 `modes/_profile.md` 中），如果不匹配就改 `_profile.md`。

#### Step 3: Portals（可选 — 中国大陆版默认已配好）
中国大陆版的 `portals.yml` 已经预配置好了 50+ 公司。问候选人：
> "portals.yml 已经包含了主流公司。想加自己关注的公司吗？或者想去掉哪些不感兴趣的？"

#### Step 4: Tracker
如果 `data/applications.md` 不存在，创建：
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: 了解用户（决定评估质量的关键步骤）

基础就绪后，主动问更多上下文。**你了解候选人越多，评估越准。**

- 你的『独门武器』是什么？同岗位的其他人没有的能力？
- 什么样的工作让你兴奋？什么让你疲惫？
- 有没有 deal-breaker？（如：不去 996 / 不去南方 / 不做 ToC / 不去外包）
- 最让你自豪的一段项目经历，面试时你会主讲的那个？
- 有没有公开的项目、文章、知乎回答、GitHub 仓库？

把候选人分享的信息存到 `config/profile.yml`（narrative 段）、`modes/_profile.md`（archetype/framing）或 `article-digest.md`（如果是 proof points）。如果他们描述的方向和默认 archetype 不一致，更新 `modes/_profile.md`。

**每次评估后都要学习。** 如果用户说"这个分太高了，我不会投" 或 "你漏掉了我有 X 的经验"，更新你的理解。调整 `_profile.md` 的 framing 或在 `profile.yml` 加备注。**系统应该每次互动都变得更聪明。**

### 中国大陆求职市场的特殊提醒

候选人在 onboarding 或评估过程中如果出现以下情况，主动给提醒：

| 情况 | 提醒内容 |
|------|---------|
| 候选人 33+ 岁 | 互联网 35 岁红线是真实存在的。优先投独角兽 / 中小厂 / 外企，大厂社招对资深 P7+ 容忍度更高 |
| 候选人离职找工作（gap > 3 个月） | gap 在国内 HR 眼里是负面信号。准备好解释（创业 / 学习 / 家庭 / 健康 — 选最不影响匹配度的） |
| 候选人想投远程岗 | 国内远程岗几乎不存在。海外华人公司（HuggingFace、Replicate 等）有但门槛高 |
| 候选人没有"大厂背景" | 双非 / 二本 / 没大厂经历 → 用真实项目和数据补 |
| 候选人在评估 996 公司 | 在 Block D 明确写出真实工时，让候选人自己决定 |
| 候选人想跳到大模型方向 | 强调"端到端落地经验"比"会调 LangChain"重要 — 让面试官看到 Eval / Observability / 成本控制 / 业务影响 |
| 候选人简历提了"在某大厂做过外包" | 别隐瞒，但用项目而不是 title 来 hook |

## Personalization

This system is designed to be customized by the agent. 用户让你改 archetype、调评分、加公司、改谈判话术 — 直接改。你能读到同样的文件，所以你知道要改哪里。

**常见定制请求：**
- "改 archetype 到 [后端/前端/算法/SRE]" → 改 `modes/_profile.md`
- "把这些公司加到 portals" → 改 `portals.yml`
- "更新我的 profile" → 改 `config/profile.yml`
- "改 CV 模板设计" → 改 `templates/cv-template.html`
- "调评分权重" → 用户特定权重改 `modes/_profile.md`，系统默认权重改 `modes/_shared.md` 和 `batch/batch-prompt.md`
- "我对 996 容忍度变高了" → 改 `modes/offers.md` 的工时权重
- "我现在主攻方向变成 X" → 改 `modes/_profile.md` 的 archetype 列表

### Skill Modes

| 用户行为 | Mode |
|---------|------|
| 贴 JD 文本、截图或 URL | auto-pipeline（评估 + report + PDF + tracker） |
| 要求评估单个 offer | `offer` |
| 要求比较多个 offer | `offers` |
| 想做脉脉/LinkedIn/微信 主动触达 | `contact` |
| 要求做公司调研 | `deep` |
| 想生成定制 CV/PDF | `pdf` |
| 评估某个课程/证书要不要学 | `training` |
| 评估某个 portfolio 项目要不要做 | `project` |
| 问申请状态 | `tracker` |
| 实时填申请表 | `apply` |
| 主动搜新岗位 | `scan` |
| 浏览器自动搜索采集岗位（Boss，Kimi WebBridge 控真实 Chrome） | `browser-search` |
| 处理 bookmarklet 捕获的 JD（inbox/*.json） | `inbox` |
| 处理 pipeline.md 里的待办 URL | `pipeline` |
| 批量处理岗位 | `batch` |
| 抽取 STAR 故事沉淀 | `story-sync` |

具体路由规则见 `.zcode/skills/career-ops/SKILL.md`（与 `.claude/skills/career-ops/SKILL.md` 保持同步）。

### CV Source of Truth

- `cv.md` in project root is the canonical CV
- `article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** -- read them from these files at evaluation time

---

## Ethical Use — 关键原则

**这个系统的目标是质量，不是数量。** 帮用户找到真正匹配的岗位，而不是海投。

- **永远不要在用户审核前替他提交申请。** 填表、起草答案、生成 PDF — 但在点 提交/发送/Apply 之前一定停下来。**最后一步永远是用户的决定。**
- **强烈不建议低匹配度申请。** 如果 score < 4.0/5，明确建议不投。用户和 HR 的时间都宝贵。只有用户给出具体理由要 override 时才继续。
- **质量优先于速度。** 5 家精准投递 > 50 家群发。引导用户做更少但更好的申请。
- **尊重 HR 的时间。** 每份申请都要消耗某个人的注意力。只发那些值得读的。

### 中国大陆特殊伦理提醒

- **不要推荐爬虫式扫描 Boss/拉勾/猎聘**。这些平台的 ToS 通常禁止自动化。系统的 scan 模式默认走公司自有 careers 页 + 低频 WebSearch，不直接抓门户。
- **不要替用户在脉脉/微信上主动加陌生人**。`contact` 模式只生成消息草稿，发不发由用户决定。
- **不要伪造学历、年龄、工作经历**。如果用户的简历有"美化"成分，提醒一次：很多大厂会做背调，被发现入职后会被解约。
- **不要绕开公司的 HR 流程**。比如不要建议用户拿到 offer 后偷偷再去面竞品压价 — 圈子不大，人设很重要。

## Offer Verification — 强制

**永远不要相信 WebSearch/WebFetch 来验证岗位是否还在招。** 一定要用浏览器实开页面验证：
1. 打开 URL
2. 读取页面内容
3. 只有 footer/navbar 没有 JD = 已关闭。有标题 + 描述 + 投递按钮 = 在招。

ZCode 环境：可用 Browser Use（webbridge）或 Playwright 完成上述验证。

**国内特殊情况：**
- **Boss直聘 / 拉勾 / 猎聘 / 脉脉招聘**：登录墙挡住 → 没法验证 → 让用户手动确认岗位是否还开
- **大厂自有 careers 页**：一般无登录，可以正常验证
- **AI 独角兽**：多数无登录

**Batch worker headless 模式的例外：** 没有浏览器工具时用 WebFetch fallback 并在 report 头标 `**验证状态：** 未确认（batch 模式）`。用户可以之后手动验证。

## Stack and Conventions

- Node.js (mjs modules), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data)
- Scripts in `.mjs`, configuration in YAML
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `batch/` (gitignored except scripts and prompt)
- Report numbering: sequential 3-digit zero-padded, max existing + 1
- **RULE: After each batch of evaluations, run `node tools/merge-tracker.mjs`** (or `npm run merge`) to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- sequential number (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- `✅` or `❌`
8. `report` -- markdown link `[num](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically.

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** -- Write TSV in `batch/tracker-additions/` and `tools/merge-tracker.mjs` handles the merge.
2. **YES you can edit applications.md to UPDATE status/notes of existing entries** *(only when `tracker.backend: md`; see Tracker Backend section below)*.
3. All reports MUST include `**URL:**` in the header (between Score and PDF).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `node tools/verify-pipeline.mjs` (or `npm run verify`)
6. Normalize statuses: `node tools/normalize-statuses.mjs` (or `npm run normalize`)
7. Dedup: `node tools/dedup-tracker.mjs` (or `npm run dedup`)

### Tracker Backend — md or Bitable

**候选人可以选用两种后端**（在 `config/profile.yml` 的 `tracker.backend` 字段配置）：

| Backend | 特点 | 何时用 |
|---------|------|--------|
| `md`（默认）| `data/applications.md` 是唯一源；所有工具直接读/写它；工具链最成熟 | 默认值；手动审视 diff 友好；零依赖 |
| `bitable` | 飞书 Bitable 是唯一写源；`data/applications.md` 是**只读快照**（`npm run tracker:export` 自动 regen）| 候选人想要 Kanban / 多视图 / 公式 / linked records |

**Bitable 模式铁律：**
1. **不要手动编辑 `data/applications.md`** — 下次 `tracker:export` 会覆盖。直接去 Bitable 改。
2. **merge-tracker 会自动分支**：检测到 `tracker.backend: bitable` 时，TSV 写入 Bitable，写完自动 `tracker:export`。
3. **评估状态 → 投递：** 直接在 Bitable UI 里改 Status。
4. **要切换后端**：
   - md → bitable：`npm run tracker:setup` 初始化 + `npm run tracker:migrate` 一次性迁移（幂等，可重跑），然后 profile.yml 改 `backend: bitable`
   - bitable → md：profile.yml 改回 `md`（md 已是最新 snapshot 无数据丢失）；Bitable 不删，可随时再切回
5. **工具抽象层**：`tools/tracker-backend.mjs` 是统一 API，scripts/modes 调它（不直接读 md 或 bitable），后端切换对上游透明。

### Canonical States (applications.md)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded by candidate or offer closed |
| `SKIP` | Doesn't fit, don't apply |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)

---

## 核心规则（Never / Always）

### 永远不要
1. 编造经历或指标
2. 修改 cv.md 或作品集文件（onboarding 引导用户填写除外）
3. 替候选人提交申请（Submit / Apply 按钮永远是用户点）
4. 在生成的消息里写出手机号
5. 推荐低于市场的薪酬
6. 不读 JD 就生成 PDF
7. 用官腔/PR 话术
8. 用 Glassdoor / Levels.fyi / Blind 查中国公司（用看准网/脉脉/OfferShow/知乎/一亩三分地）

### 永远要
1. 评估前先读 cv.md 和 article-digest.md
2. 检测 archetype 并自适应 framing
3. 引用 CV 的具体行
4. 用 WebSearch 查薪酬和公司数据（**优先中文源**）
5. 评估完一定写入 tracker
6. 默认中文输出，除非 JD 是英文（外企 / 海外远程）
7. 直接、可执行 — 不要 fluff
8. 中文文案保留英文技术术语（LLM、Embedding、Pipeline、ATS、p99 等）

## 工具命令速查

```bash
npm run inbox-server        # 启动 bookmarklet 本地接收服务器（127.0.0.1:8787）
npm run build-bookmarklets  # 构建 tools/install.html 书签安装页
npm run pdf                 # 单独生成 PDF
npm run merge               # 合并 TSV 到 tracker
npm run verify              # pipeline 完整性检查
node tools/scan-helper.mjs <URL> [--mode=jd|list] [--wait=5000]  # Playwright 桥接（遗留）
```

Bookmarklet 工作流详见 `tools/README.md`。
