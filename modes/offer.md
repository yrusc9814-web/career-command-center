# Mode: offer — 单岗位完整评估（A-F 六块）

候选人贴一个职位（文本或 URL）时，**必须按顺序输出 A-F 六个 block**。

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

**按 primary_archetype 调整证据优先级：**
- execution_procurement 执行采购 → 优先：交付/跟单、交期保障（交货及时率）、单证/对账准确性、异常处理证据（紧急插单、缺料、交期延误应对）
- sourcing 寻源 / 供应商开发 → 优先：开发数量、源头工厂、导入验证证据（0→1 案例、年开发 N 家、筛选-验证-导入闭环）
- strategic_category 战略 / 品类采购 → 优先：品类规模、降本百分比、Should-cost/成本拆解证据（年度降本目标拆解到品类动作）
- unknown → 通用采购证据（询比价、谈判、供应商管理、交付协同、降本）

输出一个 **gaps 段落**，对每个 gap 给出缓解策略：
1. 是 hard blocker 还是 nice-to-have？
2. 候选人能否用相邻经验论证？
3. 有没有作品集/GitHub 项目能填补这个 gap？
4. 具体的缓解动作（cover letter 的一句话 / 一个快速 side project / 引用某个开源贡献等）

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
| **一亩三分地** | `site:1point3acres.com {公司}` | 国内大厂讨论 |
| **leetcode.cn** | `site:leetcode.cn {公司} 面经` | 应届/社招面经 |
| **互联网职级对标** | `互联网 职级对标 {公司}` | 反推 JD 暗示的级别对应哪个 P/T/L |

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

**Comp Score（1-5）：**
- 5 = 头部分位，明显高于市场
- 4 = 高于市场
- 3 = 市场中位
- 2 = 略低于市场
- 1 = 明显低于市场或工时严重不匹配

> 细则权威：`tools/lib/scoring.mjs` 的 `SCORING_RUBRIC`（`compensation` 维 1/3/5 定义）；大小周/工时折算计入 `workload_workstyle` 维，不在 comp 内重复计。

## Career Score — 评分引擎维度（10 维 × 权重 100）

Career Score 由 `tools/lib/scoring.mjs` 产出：`career_ops_score`（1.0-5.0）+ `score_confidence`（effective_weight/total_weight，≥85% 高 / ≥60% 中）+ `score_breakdown`。**1/3/5 评分细则唯一权威 = 同文件 `SCORING_RUBRIC`**（每维 1/3/5 定义、证据来源与 unknown 规则）；prompt 不复制细则全文，只按下列 key+中文名+权重为每维提供打分输入（score + reason + evidence）：

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

## Block E — 个性化方案

| # | 部分 | 现状 | 修改建议 | 为什么 |
|---|------|------|---------|--------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

**Top 5 CV 修改 + Top 5 LinkedIn/脉脉资料修改**，最大化 ATS 匹配 + HR 第一眼注意力。

中国大陆 CV 的特殊建议：
- 是否需要加证件照（看公司类型决定，互联网大厂一般不需要）
- 出生年月 / 性别 / 婚育（互联网行业可省，国企/外企看情况）
- 项目经历的描述模式："**业务背景** → 我的角色 → 技术方案 → **量化结果**"
- 学历放显著位置（国内 HR 第一眼就要看）

## Block F — 面试准备

6-10 个 STAR+R（Situation + Task + Action + Result + **Reflection**）故事，对应 JD 的核心要求：

| # | JD 要求 | STAR+R 故事 | S | T | A | R | Reflection |
|---|--------|------------|---|---|---|---|-----------|

**Reflection 列**：当时学到了什么 / 现在回头看会怎么改。这是区分中级和高级的关键 — 中级讲做了什么，高级能从中提炼出 lesson。

**Story Bank**：如果 `interview-prep/story-bank.md` 存在，检查这些故事是否已入库，没有就追加。长期下来会形成 5-10 个 master story 可以应付各种行为面试题。

**按 archetype 选材：**
- 数据工程 → 强调链路稳定性、数据质量、降本提效的具体数字
- 数据仓库 → 强调建模决策、迭代取舍、查询提速对业务的影响
- 数据治理 → 强调跨部门推动、自上而下/自下而上的策略
- 大模型应用 → 强调 Eval 闭环、效果迭代、成本控制、业务影响
- AI Infra → 强调性能数字、稳定性事故复盘、降本
- 后端 → 强调高并发、可用性、复杂业务抽象
- 平台/架构 → 强调内部用户数、采纳率、平台演进决策
- 算法 → 强调 AB 实验设计、业务指标提升

**还要包含：**
- 1 个推荐主讲的 case study（哪个项目最适合主讲、怎么讲）
- 红线问题预演（如：「为什么从上一家离职？」「为什么频繁跳槽？」「能接受 996 吗？」「家庭情况能不能加班？」 — 这些国内 HR 真的会问，要准备好得体的应对话术）

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
**Score：** {X.X/5}
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
（仅当 score >= 4.5 — 申请表答案的草稿）

---

## 提取的关键词
（15-20 个 JD 关键词供 ATS 优化）
```

### 2. 写入 tracker

**永远** 写入 `data/applications.md` — 但是是通过 TSV 文件的方式（看 CLAUDE.md 中的 TSV 规范），由 `tools/merge-tracker.mjs` 自动合并。

字段：
- 序号
- 日期
- 公司
- 岗位
- Score（X.X/5）
- 状态：`Evaluated`（已评估）
- PDF：✅ 或 ❌
- Report：相对链接 `[NNN](reports/NNN-slug-date.md)`
- 备注（一句话总结）

> 注意：状态字段保持英文 canonical（`Evaluated`、`Applied` 等），因为 dashboard 和合并脚本依赖于此。Chinese 含义见 `templates/states.yml`。
