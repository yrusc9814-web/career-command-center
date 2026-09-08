# Mode: offer — 单岗位完整评估（A-F 六块）

候选人贴一个职位（文本或 URL）时，**必须按顺序输出 A-F 六个 block**。

> **输出守卫（最高优先级）**：本文件所有数值与档位遵守 `modes/_shared.md` 的「输出守卫 — 数值与文案」段——`cv_match_score`（0-100）/ coverage / `career_ops_score` / recommendation 五档全部来自运行时引擎（`tools/lib/{cv-match,scoring,eligibility}.mjs`），LLM 只解释不重算；高分不推荐是合法状态，decision trace 是唯一解释依据。

## Step 0 — Archetype 检测 + Tier 归类（评估前置，必须先于 Block A）

### 0.1 读 Archetype

读 `modes/_profile.md` 的核心 Archetypes 表，判定岗位的 primary_archetype（一岗一个：`execution_procurement` / `sourcing` / `strategic_category` 三选一；只看职责动词分布，title 不进判定；最高信号不足或并列 → unknown，禁止硬套；不允许输出两个并列 archetype，secondary 留待后续 Phase）。

Archetype 决定：
- Block B 优先突出哪些 proof points（见 `_profile.md` 的自适应包装表）
- Block E 怎么改写 summary
- Block F 准备哪种 STAR 故事

### 0.2 Tier 硬筛

`_profile.md` 中标记为"已弃用"的 archetype，JD 命中且与核心 archetype 无强重叠 → 直接 SKIP。

对未跳过的岗位，按 `modes/_shared.md` 的 Tier 检测规则执行（对照 `config/target_pool.md`）：

1. **真实门槛硬筛**：JD 命中 `target_pool.md` 中 Tier D 触发关键词 → **立刻 SKIP**，不浪费 token
2. **Tier 归类**（写入 report 头）：对照 `target_pool.md` 的 Tier A/B/C/D 清单 + 画像反推
3. Tier A/B → 正常进 Block A-F
4. Tier C → 进 A-F 但标注"延后投递"
5. Tier D → SKIP，写一句理由

## Block A — 角色摘要

输出一张表，包含：
- **primary_archetype**（三选一 + unknown，只看职责动词分布，title 不进判定）：
  - `execution_procurement` 执行采购 — 询比价/下单/跟单/催交/对账/单证/交货及时率占职责主体
  - `sourcing` 寻源 / 供应商开发 — 新供应商开发/源头工厂/寻源拓品/导入验证为第一职责
  - `strategic_category` 战略 / 品类采购 — 品类策略/年度降本/Should-cost/供应商组合规划为主体（title 叫"品类专员"也可能只是 execution + categories）
  - 最高信号不足 2 个或并列 → **unknown，禁止硬套**。权威定义与 signal 词表：`tools/lib/taxonomy.mjs`
- **Domain**（公司行业六值：automotive 汽车 / food 食品·生鲜 / electronics 电子 / industrial 工业·机械 / consumer 消费·零售 / trade 贸易；Domain=公司在哪个行业做生意，与 cross_border 正交）
- **Categories**（花预算买什么，多选：汽车零部件 / 生鲜食品 / 机械设备 / 电子元器件 / 原材料 / 包材 / MRO / 物流服务 等）
- **Tags**（附加属性 0-N：direct / indirect / production_material / non_production / international / domestic / cross_border / project_based）
- **Function**（采购执行 / 寻源开发 / 品类策略 / 交付协同）
- **Seniority**（raw_title 保留 JD 原文 + normalized_seniority 六档：助理 / 专员 / 高级专员 / 主管 / 经理（含高级经理） / 总监·负责人；附职责信号佐证，如"带 N 人小组 / 独立背品类 KPI"。internal L0-L5 仅用于引擎比较；**用户可见层禁止出现 L 编码，禁止出现互联网职级对标**）
- **业务方向**（生产物料 / 非生产物料 / 项目制 / 出口跨境 / 国内内贸 ...）
- **远程政策**（onsite / 混合 / 全远程）
- **Base 城市**（北京/上海/深圳/杭州/...）
- **团队规模**（如 JD 提到）
- **公司类型**（制造 / 贸易 / 零售 / 供应链服务 / 中小企业 / 外企 / 国企）
- **TL;DR**（一句话）

## Block B — CV 匹配

读 `cv.md`。建一张表：JD 的每条要求 → 候选人 CV 中的具体行。

> **cv_match_score（0-100）由运行时引擎产出**（`tools/lib/cv-match.mjs`，因子与权重见其 `CV_MATCH_FACTORS`）。LLM 只解释该分数（哪些因子拉高 / 拉低、按 `trace` 口径），**禁止自算或自报"匹配度 X%"**。

**按 primary_archetype 调整证据优先级：**
- execution_procurement 执行采购 → 优先：交付/跟单、交期保障（交货及时率）、单证/对账准确性、异常处理证据（紧急插单、缺料、交期延误应对）
- sourcing 寻源 / 供应商开发 → 优先：开发数量、源头工厂、导入验证证据（0→1 案例、年开发 N 家、筛选-验证-导入闭环）
- strategic_category 战略 / 品类采购 → 优先：品类规模、降本百分比、Should-cost/成本拆解证据（年度降本目标拆解到品类动作）
- unknown → 通用采购证据（询比价、谈判、供应商管理、交付协同、降本）

输出一个 **gaps 段落**，按 Gap 四级 + 类型模型标注（权威枚举见 `_shared.md`「输出守卫」第 2 条）：

1. **四级标注**：`BLOCKER`（JD 硬性要求不满足，job-side blocker）/ `HARD_GAP`（无法靠简历包装解决）/ `SOFT_GAP`（可靠改写与证据补足）/ `UNKNOWN`（JD 未披露或信息不足）
2. **类型标注**：品类经验 / 行业经验 / 新供应商开发 / RFQ·询比价 / 商务谈判 / 降本 / 供应商管理 / 交期 / 质量异常 / 合同·账期 / ERP·SRM / 国际采购 / 管理经验 / 职级 / 学历 / 语言
3. **缓解策略按级别分流**：
   - `SOFT_GAP` 允许建议：改写已有经历（突出可迁移品类经验）、补量化证据、准备面试故事、准备供应商开发案例、补 ERP·SRM 叙述、补谈判降本证据
   - `HARD_GAP` 必须诚实写明"**简历包装不能解决**"（例：无目标品类供应商资源），只给"是否仍值得投 + 如何在面试中诚实应对"的判断
   - `UNKNOWN` 只写"当前信息不足 / JD 未披露 / 需面试确认"，禁止写成"不具备 / 没有 / 较差"
4. **"有能力但缺资源"守卫**：能力匹配（capability matched）但缺目标品类供应商资源，必须表述为"**具有供应商开发能力，但缺目标品类供应商资源**"，禁止写成"缺乏采购 / sourcing 能力"
5. **禁止默认建议**：补 GitHub / 开源项目 / 系统设计经验 / 技术栈 / side project —— 这些与采购岗评估无关

**结构化 Capability/Evidence 输出（必须，紧随 gaps 段）：**

能力 key 必须取自 `tools/lib/taxonomy.mjs` 的 10 桶（`sourcing_development` / `rfq_execution` / `cost_reduction` / `negotiation_contract` / `supplier_quality` / `delivery_collaboration` / `digital_tools` / `category_management` / `international_procurement` / `leadership`），判定规则与词表参考 `tools/lib/evidence.mjs`：

1. **JD 侧** `required_capabilities` / `preferred_capabilities`：每项含 `capability`（10 桶 key）、`requirement_level`（required / preferred；"必须/要求/需/具备"→ required，"优先/加分/更佳"→ preferred）、原文证据行（不得改写）、`strength`（strong / medium / weak；"沟通/协调/对接"严禁判为 negotiation；"熟悉采购流程"类泛句最多 rfq_execution weak）。
2. **CV 侧** `candidate_evidence`：每项含 `capability`、`source: cv`、原文摘录（不得改写）、`strength`、量化项（metric / value / raw；value 保留原文数值形式，禁止单位换算，薪资类数字不是采购量化证据）。
3. **Capability Coverage 表**（四列，紧跟两者输出）：

| capability | requirement_level | candidate_evidence_strength | coverage_status |
|---|---|---|---|
| （10 桶 key） | required / preferred | strong / medium / weak / no_evidence | matched / partial / no_evidence / unknown |

规则：required + strong|medium → matched；required + weak → partial；required + 无证据 → no_evidence；preferred + 有证据 → matched（weak → partial）。**本表是证据覆盖状态，不是 CV Match 分数，不输出百分比，禁止汇总成任何分数。**

## Block C — 级别与策略

1. **JD 暗示的级别** vs **候选人在这个 archetype 下的自然级别**（用 `_shared.md` 的采购职级序列反推；输出只用自然语言档位，禁止 L 编码与互联网职级）
2. **「不撒谎卖资深」方案**：
   - 具体话术（适配 archetype）
   - 要重点拎出的成就
   - 把"独立从 0 到 1"经历包装成优势
   - 把"跨部门协作"或"踩过的坑"包装成 senior signal
3. **「如果被压级」方案**：
   - 如果 comp 合理可以接受 → 谈定 6 个月内 review 条件
   - 列清楚晋升标准
   - 接受降级的边界（薪酬不能低于 X / 不能进非核心团队）

## Block D — 薪酬与需求（中国大陆数据源）

⚠️ **不要用 Glassdoor / Levels.fyi / Blind**，国内公司在这些站基本没有数据。

用 WebSearch 查以下中文源：

| 源 | 用法 | 适合查什么 |
|----|------|----------|
| **看准网（kanzhun.com）** | `site:kanzhun.com {公司} 薪资` | 平均薪资、各级别区间、口碑评分 |
| **脉脉职言区（maimai.cn）** | `site:maimai.cn {公司} 薪资` 或 `{公司} 采购经理 脉脉` | 真实匿名薪酬讨论、近期发包情况 |
| **OfferShow（offershow.cn）** | `site:offershow.cn {公司} {职级}` | 应届/社招的真实 offer 数据 |
| **知乎** | `site:zhihu.com {公司} 薪资` 或 `如何评价 {公司}` | 详细的口碑、加班、文化讨论 |
| **职友集（jobui.com）/ 猎聘** | `{城市} 采购经理 薪资` / `{公司} 职级` | 制造/贸易/零售企业采购岗位的带宽基线（按城市 + 职级查） |
| **面试经验** | `{公司} 采购 面试` （看准 / 知乎 / 脉脉） | 采购序列的面经、面试流程与轮次 |

**Block D 输出表格：**

| 维度 | 数据 | 来源 |
|------|------|------|
| 薪资带宽（base + 年终） | xx-xx K × 16/15/14 | 看准/脉脉 |
| 股票/期权（如有） | xxx 万 RMB / 4 年 | 脉脉/OfferShow |
| 工时强度 | 大小周 / 996 / 11-9-6 / 双休 | 知乎/脉脉 |
| 公司口碑 | x.x / 5（看准） | 看准网 |
| 业务/团队近况 | 扩招 / 优化 / 稳定 / 风险 | 脉脉/新闻 |
| 这个岗位的市场需求 | 紧缺 / 普通 / 饱和 | 脉脉招聘讨论 |

**如果查不到数据，明说"未查到，建议向脉脉/知乎匿名提问"，不要编造。**

**Comp Score（0-100）：**
- 100 = 头部分位，明显高于市场
- 75 = 高于市场
- 50 = 市场中位
- 25 = 略低于市场
- 0 = 明显低于市场或工时严重不匹配

> 细则权威：`tools/lib/scoring.mjs` 的 `SCORING_RUBRIC`（`compensation` 维 0/50/100 定义）；大小周/工时折算计入 `workload_workstyle` 维，不在 comp 内重复计。

## Career Score — 评分引擎维度（10 维 × 权重 100）

Career Score 由 `tools/lib/scoring.mjs` 产出：`career_ops_score`（0-100）+ `score_confidence`（effective_weight/total_weight，≥85% 高 / ≥60% 中）+ `score_breakdown`。**0/50/100 评分细则唯一权威 = 同文件 `SCORING_RUBRIC`**（每维 0/50/100 定义、证据来源与 unknown 规则）；prompt 不复制细则全文，只按下列 key+中文名+权重为每维提供打分输入（score 取真 0-100 制，锚点 0/50/100，即旧 1/3/5 的 (x−1)×25；+ reason + evidence）：

| key | 维度 | 权重 |
|---|---|---:|
| compensation | 薪酬竞争力 | 20 |
| workload_workstyle | 工作制与强度 | 15 |
| role_seniority | 职级质量与职责范围 | 13 |
| career_growth | 成长空间 | 10 |
| category_domain_value | 品类与行业价值 | 10 |
| procurement_ownership | 采购自主权 | 9 |
| company_stability | 公司与业务稳定性 | 7 |
| location_fit | 地点与通勤 | 8 |
| digital_tooling | 数字化与工具成熟度 | 5 |
| hiring_process_quality | 招聘流程质量 | 3 |

规则：
- 方向 = Job→Candidate Value（岗位本身对候选人的职业价值）；JD 未写证据的维度 score=null（不入分母，全 unknown 时如实输出"有效维度不足"），禁止按行业刻板印象补分；营销叙事一律不作证据。
- **cv_match_score（0-100）由 CV Match 层产出（`tools/lib/cv-match.mjs`，因子与权重见其 `CV_MATCH_FACTORS`），不参与 Career Score**；Career Score 输出不得包含 CV Match、hard_req_coverage、简历关键词覆盖、学历、是否会 SAP、是否有某 capability。
- **LLM 只解释不重算**：`career_ops_score`、`score_confidence`、`recommendation`（五档）全部来自运行时引擎 + `trace[]`；LLM 的职责是用人话解释各维 reason / evidence 与决策路径。
- **高分不推荐是合法状态**：cv 84 + career 71 + 不推荐 = 合法（candidate-side blocker / job-side 资格 / 缺口封顶都会覆盖分数）；decision trace 是唯一解释依据，禁止看到高分自动翻案。

## Block E — 个性化方案

| # | 部分 | 现状 | 修改建议 | 为什么 |
|---|------|------|---------|--------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

**Top 5 CV 修改 + Top 5 LinkedIn/脉脉资料修改**，最大化 ATS 匹配 + HR 第一眼注意力。

**优先搜寻的量化证据**（改写建议围绕这些补证据；数值一律来自 cv.md 真实经历，禁止编造）：
年采购额 / Spend ｜ 降本金额与比例 ｜ 供应商数量（在管 / 新开发导入 / 淘汰）｜ RFQ 询比价数量 ｜ 谈判结果（价格 / 账期 / MOQ / Lead Time）｜ OTD 交货及时率 ｜ 来料合格率 / PPM ｜ 库存下降 / 呆滞处理 ｜ 缺货率 ｜ 品类规模 ｜ 项目数量 ｜ 国际采购与合同金额 ｜ 团队人数 ｜ ERP·SRM 数字化成果

**建议句式 = 动作 + 规模 + 结果 + 业务影响**，示例（匿名占位）：
> "负责某品类年度采购，管理 N 家核心供应商，通过年度议价与替代导入实现成本下降 X%，同时将账期从 Y 天延长至 Z 天。"

中国大陆 CV 的特殊建议：
- 是否需要加证件照（看公司类型决定，外企 / 制造业国企常见放照片）
- 出生年月 / 性别 / 婚育（一般可省，国企看情况）
- 项目 / 专项经历的描述模式："**业务背景** → 我的角色 → **采购动作** → **量化结果**"
- 学历放显著位置（国内 HR 第一眼就要看）
- 简历里不写真实供应商名 / 报价 / 合同细节（保密），用"某品类 / N 家供应商 / X%"表述

## Block F — 面试准备

6-10 个 STAR+R（Situation + Task + Action + Result + **Reflection**）故事，对应 JD 的核心要求：

| # | JD 要求 | STAR+R 故事 | S | T | A | R | Reflection |
|---|--------|------------|---|---|---|---|-----------|

**STAR+R 定义**：S/T/A/R = Situation / Task / Action / Result；最后的 **R = Reflection / Relevance** — 回答"这段经历对当前 JD 的价值"。Reflection 列：当时学到了什么 / 现在回头看会怎么改 / 这段经历为什么能迁移到这个岗位。这是区分中级和高级的关键 — 中级讲做了什么，高级能从中提炼出 lesson 并挂回 JD。

**Evidence-backed（硬规则）**：故事素材**只能来自 candidate_evidence / cv.md / article-digest.md 已有事实**；CV 无对应案例时，如实输出"**待补充真实案例**"并提示候选人补充，**禁止自动生成假 STAR、禁止编造数字与经历**。

**Story Bank 18 类（选题池，按 JD 核心要求挑）**：降本谈判 / 新供应商 0→1 开发 / 供应商涨价应对 / 紧急交付 / 供应中断 / 单一来源风险 / 多供应商导入 / 供应商质量事故 / 供应商淘汰 / 合同商务风险 / 库存过高 / 呆滞料 / MOQ 优化 / Lead Time 优化 / 跨部门冲突 / ERP·SRM 数字化采购 / 国际物流外贸异常 / 团队管理带新人。

**Story Bank 入库**：如果 `interview-prep/story-bank.md` 存在，检查这些故事是否已入库，没有就追加（`modes/story-sync.md` 依赖 Block F 作为 primary 源）。长期下来会形成 5-10 个 master story 可以应付各种行为面试题。

**面试题库**：题目与答题素材方向按 `modes/interview-questions.md`（15 主题 × 4 职级）选取——先按 JD 的 primary_archetype 与 JD seniority 档位锁定主题，再按候选人在该主题下的真实证据决定讲哪个故事。**题库只出题与素材方向，答案素材同样只来自 candidate_evidence。**

**还要包含：**
- 1 个推荐主讲的 case study（哪段采购经历最适合主讲、怎么讲、数字口径怎么背）
- 红线问题预演（如：「为什么从上一家离职？」「为什么频繁跳槽？」「能接受加班吗？」「家庭情况能不能加班？」 — 这些国内 HR 真的会问，要准备好得体的应对话术）

---

## 评估后必做

### 1. 写 report .md

把完整评估写到 `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`：
- `{###}` = 下一个序号（3 位补零）
- `{company-slug}` = 公司英文名小写、用连字符（中文公司可用拼音或常用英文，如 bytedance / alibaba / xiaohongshu）
- `{YYYY-MM-DD}` = 当前日期

**Report 模板：**

```markdown
# 评估：{公司} — {岗位}

**日期：** {YYYY-MM-DD}
**Archetype：** {检测到的}
**Score：** {XX.X/100}
**推荐等级：** {强烈推荐 | 推荐 | 一般 | 不推荐 | 硬红线跳过}——由 `tools/lib/scoring.mjs` `computeRecommendation` 决策链产出，格式恒为五档枚举
**Eligibility / Blocker：** `eligibility_status`（eligible / eligible_with_gaps / ineligible / unknown）+ 命中 blocker（candidate-side：现任雇主/薪资底线/职级倒退/地点/工作制/出差；job-side：硬要求 BLOCKER，见 hard_requirements[]）+ `trace[]` 摘要（Step 0-5 命中路径；由 `tools/lib/eligibility.mjs` 组装证据，决策链唯一 SoT = `computeRecommendation`）
**URL：** {岗位原始 URL}
**PDF：** {路径或 pending}

---

## A) 角色摘要
（Block A 的完整内容）

## B) CV 匹配
（Block B 的完整内容）

## Capability Coverage
（能力证据覆盖表：capability / requirement_level / candidate_evidence_strength / coverage_status；
枚举 matched / partial / no_evidence / unknown。本表是证据覆盖状态，不是 CV Match 分数，不输出百分比）

## C) 级别与策略
（Block C 的完整内容）

## D) 薪酬与需求
（Block D 的完整内容）

## E) 个性化方案
（Block E 的完整内容）

## F) 面试准备
（Block F 的完整内容）

## G) Draft Application Answers
（仅当 score >= 87.5 — 申请表答案的草稿）

---

## 提取的关键词
（15-20 个 JD 关键词供 ATS 优化）
```

### 2. 写入 tracker

**永远** 写入 `data/applications.md` — 但是是通过 TSV 文件的方式（TSV 规范见 `AGENTS.md` 与 `modes/_shared.md`），由 `tools/merge-tracker.mjs` 自动合并。

字段：
- 序号
- 日期
- 公司
- 岗位
- Score（XX.X/100）
- 状态：`Evaluated`（已评估）
- PDF：✅ 或 ❌
- Report：相对链接 `[NNN](reports/NNN-slug-date.md)`
- 备注（一句话总结）

> 注意：状态字段保持英文 canonical（`Evaluated`、`Applied` 等），因为 dashboard 和合并脚本依赖于此。Chinese 含义见 `templates/states.yml`。
