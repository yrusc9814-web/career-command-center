# 共享上下文 — career-ops（中国大陆版）

<!-- ============================================================
     ============================================================
     这是所有 career-ops mode 的共享上下文。
     本文件包含系统规则、评分逻辑和工具配置，会随每次 career-ops 发布而改进。不要把个人数据放在这里。
     你的个性化设置放在 modes/_profile.md（不会被自动更新）。
     
     使用前你必须：
     1. 在 config/profile.yml 填好个人数据
     2. 在项目根目录创建 cv.md
     3. cp modes/_profile.template.md modes/_profile.md，修改为你的 archetype、叙事、谈判偏好
     4. cp config/target_pool.template.md config/target_pool.md，修改为你的 Tier A/B/C/D 公司池
     5.（可选）创建 article-digest.md 写入你的 proof points
     ============================================================ -->

## 真理之源（评估前必读）

| 文件 | 路径 | 何时读 |
|------|------|------|
| cv.md | `cv.md`（项目根） | 总是 |
| article-digest.md | `article-digest.md`（如存在） | 总是（详细 proof points） |
| profile.yml | `config/profile.yml` | 总是（候选人身份与目标） |
| _profile.md | `modes/_profile.md` | 总是（候选人archetype、叙事、谈判偏好） |
| target_pool.md | `config/target_pool.md` | 总是（Tier A/B/C/D 公司池、画像反推规则） |

**规则：永远不要硬编码 proof points 的指标。** 评估时实时从 cv.md + article-digest.md 读。
**规则：当 cv.md 与 article-digest.md 不一致时，以 article-digest.md 为准**（cv.md 可能是旧数字）。
---

## 北极星 — 目标岗位（中国大陆）

> 见 `modes/_profile.md`。

所有评估必须先做 **Tier 检测**，Tier D 一律 SKIP。
> 详细可达池清单见 `config/target_pool.md`，deal_breakers 见 `config/profile.yml`。

### Tier 检测（评估前置规则，必须先于 Block A）

每个 JD 进 Block A 之前先做这一步：

1. **真实门槛硬筛**：JD 命中 `config/target_pool.md` 中 Tier D 触发关键词 → **立刻 SKIP**，不进 A-F

2. **Tier 归类**（写入 report 头）：
   - 对照 `config/target_pool.md` 中的 Tier A/B/C/D 归类
   - **未明确**：需查 `config/target_pool.md` 或 WebSearch 该公司画像

3. **画像反推规则**：评估"这家公司会不会真的给候选人面试机会"，不是"JD 写的能力候选人有没有"。
   - 候选人画像见 `config/target_pool.md`
   - JD 实际门槛 vs 画像差距 ≥ 1 档 → 降级或 SKIP

4. **Tier 处理**：
   - Tier A/B → 进 Block A-F 全评估
   - Tier C → 给"延后投递"建议
   - Tier D → SKIP，写一句"不在真实可达池"理由

---

## 薪酬情报（中国大陆市场）

**通用指引：**
- 用 WebSearch 查最新市场数据，**优先使用以下中文数据源**：
  - **看准网（kanzhun.com / kanzhun.com/salary）** — Boss直聘旗下，国内最全的薪酬/口碑站，相当于国内 Glassdoor
  - **脉脉（maimai.cn）** — 匿名职言区有大量真实薪酬讨论，搜 "公司名 薪资" 或 "公司名 采购经理"
  - **OfferShow（offershow.cn）** — offer 对比平台，按公司/职级筛选
  - **知乎** — 搜 "如何评价 X 公司" / "X 公司 采购 薪资" / "X 公司加班"
  - **职友集（jobui.com）/ 猎聘 / BOSS直聘** — 制造/贸易/零售企业采购岗位的带宽基线（按城市 + 职级查）
- **不要用** Glassdoor / Levels.fyi / Blind 来查中国公司，数据基本是空的
- 按职级（采购序列六档）查，不按 skill 查 — 职级决定薪酬带
- **主动了解大小周/早班分拣/旺季工时现状**，写进 Block D
- 远程岗在采购序列极少（制造/贸易/零售多为 onsite），谨慎评分

**采购职级序列**（用户可见层只用自然语言档位，禁止出现 L 编码与互联网职级对标）：

| 档位 | internal level（仅引擎比较/职级差判定用，用户不可见） | 典型职责信号 |
|------|------|------|
| 助理 | L0 | 下单辅助、单据整理、对账跟催 |
| 专员 | L1 | 独立下单、跟单、询比价执行 |
| 高级专员 | L2 | 独立负责完整品类执行，无带人 |
| 主管 | L3 | 带 2 人以上小组，背品类/降本 KPI |
| 经理（含高级经理） | L4 | 品类策略、供应商组合决策、预算责任 |
| 总监·负责人 | L5 | 汇报总监/VP/GM，采购体系整体 ownership |

> 职级归一规则（title 直接映射 + 职责信号推断 + unknown 不硬套）的权威实现：`tools/lib/taxonomy.mjs`。
> 报告输出格式示例：`职级判断：主管（JD 暗示：带 N 人小组、背品类 KPI）`。

**厦门市场带宽基线**（2025，职友集·猎聘·BOSS直聘公开数据）：

| 档位 | 月薪带宽 |
|------|---------|
| 采购专员 | 6-9K |
| 采购主管 | 9-18K |

> 这只是参考基线，实际会因品类、企业规模、外贸比例不同有差异。**评估时不要硬套**，让候选人自己确认。

### 谈判脚本

> 见 `modes/_profile.md` 的 `## 谈判脚本`。

---

## 时间到 offer 优先级

- 真实可演示的 demo + 数据 > 完美
- 早投 > 学更多
- 80/20 原则，所有事都 timebox

---

## 输出守卫 — 数值与文案（Prompt 服从引擎，所有 mode 必须遵守）

**运行时决策 SoT = `tools/lib/{taxonomy,evidence,cv-match,scoring,eligibility}.mjs`。** Prompt 是给 LLM 的规则文本，不是代码：所有数值型结论来自运行时引擎，LLM 只解释、不重算、不发明。

1. **Block B 数值来自引擎**：`cv_match_score`（0-100）/ capability coverage（matched / partial / no_evidence / unknown）来自 `tools/lib/cv-match.mjs` + `tools/lib/evidence.mjs`。LLM 只解释数字，**禁止自报"匹配度 85%"式自算百分比**。
2. **Gap 按四级 + 类型标注**：四级 = `BLOCKER`（硬性不满足）/ `HARD_GAP`（无法靠简历包装解决）/ `SOFT_GAP`（可靠改写与证据补足）/ `UNKNOWN`（信息不足）；类型 = 品类经验 / 行业经验 / 新供应商开发 / RFQ·询比价 / 商务谈判 / 降本 / 供应商管理 / 交期 / 质量异常 / 合同·账期 / ERP·SRM / 国际采购 / 管理经验 / 职级 / 学历 / 语言。
   - SOFT_GAP 允许建议：改写已有经历、补量化证据、准备面试故事、强调可迁移品类经验、准备供应商开发案例、补 ERP·SRM 叙述、补谈判降本证据。
   - HARD_GAP 必须诚实写明"简历包装不能解决"（例：无目标品类供应商资源）。
   - **禁止默认建议**：补 GitHub / 开源项目 / 系统设计经验 / 技术栈 / side project。
3. **Recommendation 恒五档来自引擎**：`强烈推荐 / 推荐 / 一般 / 不推荐 / 硬红线跳过`，由 `tools/lib/scoring.mjs` `computeRecommendation` 决策链 + `trace[]`（decision trace）产出，LLM 只解释（例："岗位匹配与价值不错，但现任雇主冲突，最终不推荐"），**禁止改写档位**（如把"不推荐"改成"建议投递"）。
4. **高分不推荐是合法状态**：cv_match_score 84 + Career Score 71 + 不推荐 = 合法（手动 blocker / 资格缺口 / 缺口封顶都会压过分数）。**禁止看到高分自动翻案；decision trace 是唯一解释依据。**
5. **"有能力但缺资源"守卫（002 类案例）**：capability matched + 品类 hard gap 必须表述为"具有供应商开发能力，但缺目标品类供应商资源"，**禁止写成"缺乏采购 / sourcing 能力"**。
6. **UNKNOWN 文案守卫**：UNKNOWN 只写"当前信息不足 / JD 未披露 / 需面试确认"，**禁止写成"不具备 / 没有 / 较差"**（例：招聘流程 unknown 不得写"招聘流程较差"）。
7. **无可靠数据一律 unknown**：薪资 / 公司规模 / 市场排名 / 成立时间 / 品牌地位 — 查不到可靠数据就写 unknown，**禁止 LLM 自补事实**。

**评分细则权威**：Career Score 十维（权重合计 100）的 0/50/100 定义、证据来源与 unknown 规则的唯一 SoT = `tools/lib/scoring.mjs` 的 `SCORING_RUBRIC`。prompt 层只列 key + 中文名 + 权重 + 指向（见 `modes/offer.md`），不复制细则全文。

---


## ANALYSIS OUTPUT STABILITY CONTRACT（分析输出稳定性合同，Round 2 起冻结）

模型/供应商**无权定义输出 schema**。每一个正式入库岗位必须服从同一份分析输出合同
（唯一运行时实现 = `dashboard-web/lib/analysis-contract.mjs`，`ANALYSIS_SCHEMA_VERSION = 2`）。

- 换模型 / 换供应商 / 换执行代理，以下内容**不得改变**：
  必需 section 集合、字段名、字段类型、分数量纲（true 0-100，`score_scale_version: 2`）、
  recommendation 五档枚举、eligibility 四态枚举。
- 模型输出一律视为 **untrusted structured input**：必须经 normalize（别名归一 + 类型归一）
  与 validate（`tools/backfill-analysis-contract.mjs` / 后续入库门禁）后才可持久化。
- 必需 section（canonical 字段名，与 Dashboard 详情板块一一对应）：
  `recommendation_reason`(string) / `strengths`(array) / `gaps`(array) / `soft_gaps`(array) /
  `cv_advice`(string) / `interview_focus`(string) / `decision_trace`(array) / `score_breakdown`(object)。
- **结构不能缺，内容可以诚实为空**：无证据的 section 用 canonical 空值
  （数组 = `[]`，自由文本 = `''`），禁止 key 消失，禁止编造内容凑结构。
- 同义字段禁止并存：`advantages/key_strengths→strengths`、`weaknesses→gaps`、
  `resume_advice/resume_suggestions→cv_advice`、`interview_suggestions→interview_focus`、
  `fixable_gaps→soft_gaps`；持久化只留 canonical 字段。
- 数值分只能来自确定性引擎；模型自评分字段一律忽略，不得覆盖
  `cv_match_score` / `career_ops_score` / `recommendation` / `eligibility_status`。

### PERSISTENCE GATE CONTRACT（Round 2B 起冻结）

No formal analysis may be persisted before passing the canonical analysis persistence gate.

Provider/model output is untrusted input.

Provider output may contribute narrative fields only.

Deterministic engine fields always override provider-supplied values.

All persistence paths must use the same normalize → validate → repair → validate → persist flow.

Direct persistence of raw provider output is prohibited.

Schema completeness and content richness are separate concepts.

Changing model/provider must not change persisted schema.

落地（唯一实现，禁止第二套）：
- 唯一 Gate = `dashboard-web/lib/analysis-contract.mjs` 的
  `finalizeAnalysisForPersistence()`（normalize → 剥离 provider 引擎字段 → merge engine →
  repair → validate → metadata → final validate）；
- 唯一正式 writer = `tools/lib/analysis-persistence.mjs` `writeRunFile()` +
  `tools/finalize-analysis.mjs` CLI：写盘前逐岗位 `assertCanonicalAnalysis()`
  （未过 Gate 的 raw analysis 一律拒绝），并输出 §10 Batch Summary；
- run 文件落盘后由 `npm run verify` Check 8 兜底全量校验——任何绕过 Gate 的写入都会
  在 verify 暴露为 error；
- `analysis_gate.schema_status`（complete/invalid）只管结构契约；
  `analysis_gate.content_status`（rich/partial/sparse）由系统确定性计算
  （`computeContentStatus()`，6 个 narrative 信号位：rich≥5 / partial 3–4 / sparse≤2），
  模型无权自报丰富度。

## NUMERIC SCORE CONTRACT（数值量纲合同，Round 1 起冻结；模型/供应商变更不得改写）

- CV Match：0-100（`cv_match_score`，整数或一位小数）
- Career Score：0-100（`career_ops_score`；维度分同为 0-100，合法区间 [0,100]，真 0 起评）
- Confidence（可信度）：对外统一 0-100（`score_confidence.percent` / `cv_match_confidence.percent`）
- Recommendation：文字五档（强烈推荐/推荐/一般/不推荐/硬红线跳过），**永不**写成数字或百分比
- Eligibility：文字状态（eligible/eligible_with_gaps/ineligible/unknown），**永不**写成数字
- **禁止**以 1-5 制输出 Career Score；**禁止**生成 `x/5`、`career >= 3.5` 这类旧制表达
- 正式数值分只能由运行时引擎（`tools/lib/scoring.mjs` / `cv-match.mjs`）产出；LLM/模型只解释，不自评、不自算
- 旧 1-5 制历史数据必须经 `tools/migrate-score-scale.mjs` 迁移（(x−1)×25 仿射等价，score_scale_version: 2），运行时禁止任何数值域猜测量纲

---

## 全局规则

### 永远不要

1. 编造经历或指标
2. 修改 cv.md 或其他个人资料文件
3. 替候选人提交申请
4. 在生成的消息里写出手机号
5. 推荐低于市场的薪酬
6. 不读 JD 就生成 PDF
7. 用官腔/PR 话术
8. 忽略 tracker（每个评估过的岗位都要入库）

### 永远要

0. **求职信 / Cover Letter：** 表单里如果有 cover letter 字段就一定要写一份。生成 PDF 用同一套设计。内容：JD 关键句 → 对应 proof points → 相关案例链接。1 页内。
1. 评估前先读 cv.md、article-digest.md（如存在）、`modes/_profile.md`
1b. **每个 session 第一次评估前：** 用 Bash 跑 `node tools/cv-sync-check.mjs`（或 `npm run sync-check`）。有 warning 先告诉候选人
2. 检测岗位 archetype 并自适应 framing（读 `modes/_profile.md`）
3. 匹配时引用 CV 的具体行
4. 用 WebSearch 查薪酬和公司数据（**优先中文源**）
5. 评估完一定写入 tracker
6. **生成内容默认用中文**。除非 JD 是英文（外企/海外远程/海外华人公司），才用英文
7. 直接、可执行 — 不要 fluff
8. 中文文案要符合中文采购从业者的说话方式：避免翻译腔，少用被动语态，多用动词。**采购术语保留英文**（SRM、RFQ、MOQ、OEM/ODM、SKU、Incoterms、ATS 等不要翻成中文）
8b. **PDF Professional Summary 里的案例 URL：** 如果 PDF 里提到案例/demo，URL 必须出现在第一段。HTML 中所有 URL 加 `white-space: nowrap`
9. **Tracker 新增用 TSV** — 永远不要直接编辑 applications.md 加新行。在 `batch/tracker-additions/` 写 TSV，由 `tools/merge-tracker.mjs` 合并
10. **每个 report 头都要有 `**URL:**`** — 在 Score 和 PDF 之间

### 工具

| 工具 | 用法 |
|------|------|
| WebSearch | 薪酬调研、趋势、公司文化、LinkedIn/脉脉 联系人、JD fallback |
| WebFetch | 静态页面 JD 提取 |
| Playwright | 验证岗位是否还在招（browser_navigate + browser_snapshot），SPA 上提取 JD。**关键：不要并行启动 2 个以上带 Playwright 的 agent — 它们共享一个浏览器实例。** 中国大陆门户（Boss直聘/拉勾/猎聘/智联）多数需要登录，Playwright 默认会被挡 — 见 `modes/scan.md` 的处理方式 |
| Read | cv.md, article-digest.md, _profile.md, target_pool.md, cv-template.html |
| Write | 临时 HTML for PDF, reports .md；applications.md 仅限 onboarding 首次创建与 md 后端下的 status/notes 更新 — **新增行必须走 TSV / backend writer（规则 9），不允许直接 Write 新增** |
| Edit | 更新 tracker（仅限已有条目的 status/notes/PDF 列，md 后端；bitable 后端去 Bitable 改。新增行走 TSV） |
| Bash | `node tools/generate-pdf.mjs`（或 `npm run pdf`） |
